import type { ImportApi } from './importApi';
import { reduceJob } from './jobReducer';
import { keySuffix, type SafeLogger } from './logger';
import type { OperationStore } from './operationStore';
import type { FileGateway, Scheduler } from './ports';
import type {
  FileFormat,
  HistoryEntry,
  ImportOperation,
  JobSnapshot,
} from './types';
import { MAX_UPLOAD_BYTES, SNIFF_BYTES, validateFile, type Rejection } from './validation';

/** A file that passed local validation and waits for the user's confirmation. Not persisted. */
export interface Draft {
  uri: string;
  name: string;
  size: number;
  format: FileFormat;
}

export type BusyAction = 'sending' | 'looking_up' | 'refreshing' | 'deleting' | 'reattaching';

export interface Activity {
  busy: BusyAction | null;
  /** When the next automatic lookup/poll fires (ms since epoch), if one is scheduled. */
  nextCheckAt: number | null;
  /** The last automatic request could not reach the server. */
  unreachable: boolean;
  lastCheckedAt: number | null;
  foreground: boolean;
}

export type IdleNotice = 'storage_failed' | 'pick_failed' | 'cleared';

export type ImportView =
  | { kind: 'restoring' }
  | { kind: 'idle'; notice: IdleNotice | null }
  | { kind: 'checking' }
  | { kind: 'rejected_locally'; rejection: Rejection; name: string }
  | { kind: 'confirm'; draft: Draft }
  | { kind: 'operation'; op: ImportOperation; activity: Activity };

export interface PickedFile {
  uri: string;
  name: string;
  /** Size reported by the picker, used only if the file system cannot report one. */
  size: number | null;
}

export interface ControllerTiming {
  /** Delays between automatic by-key lookups while the POST outcome is unknown. */
  lookupBackoffMs: readonly number[];
  /** Delays between job polls while the job is not in a terminal state. */
  pollBackoffMs: readonly number[];
}

export const DEFAULT_TIMING: ControllerTiming = {
  lookupBackoffMs: [1500, 3000, 6000, 12_000, 20_000],
  pollBackoffMs: [300, 500, 800, 1300, 2000, 3000, 5000],
};

export interface ControllerDeps {
  api: ImportApi;
  store: OperationStore;
  files: FileGateway;
  scheduler: Scheduler;
  newKey: () => string;
  logger: SafeLogger;
  timing?: ControllerTiming;
}

const HISTORY_LIMIT = 40;

/**
 * Owns the single import operation: validation, the durable record, the upload,
 * recovery after an unknown outcome, polling, and deletion.
 *
 * Invariants:
 * - The idempotency key is generated once per operation and persisted before the first POST.
 *   Every resend of the same operation uses the same key and the same verified bytes.
 * - Nothing resends the file automatically. Resends happen only from `retryUpload()`.
 * - Server job states go through `reduceJob` only.
 * - "Deleted" is shown only when a GET returned `deleted` (stored in `op.job.status`).
 */
export class ImportController {
  private view: ImportView = { kind: 'restoring' };
  private readonly listeners = new Set<() => void>();
  private op: ImportOperation | null = null;
  private activity: Activity = {
    busy: null,
    nextCheckAt: null,
    unreachable: false,
    lastCheckedAt: null,
    foreground: true,
  };
  private timer: unknown = null;
  private lookupAttempt = 0;
  private pollAttempt = 0;
  private disposed = false;
  private readonly timing: ControllerTiming;

  constructor(private readonly deps: ControllerDeps) {
    this.timing = deps.timing ?? DEFAULT_TIMING;
  }

  // ---- React binding -------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ImportView => this.view;

  private setView(view: ImportView): void {
    this.view = view;
    for (const listener of this.listeners) listener();
  }

  private renderOperation(): void {
    if (this.op) this.setView({ kind: 'operation', op: this.op, activity: { ...this.activity } });
  }

  private setActivity(patch: Partial<Activity>): void {
    this.activity = { ...this.activity, ...patch };
    this.renderOperation();
  }

  // ---- Lifecycle -----------------------------------------------------------------------------

  /** Called once on launch. Restores the record and resumes without resending anything. */
  async restore(): Promise<void> {
    let op: ImportOperation | null = null;
    try {
      op = await this.deps.store.load();
    } catch {
      op = null;
    }
    const removed = await this.deps.files.sweep(op?.file.uri ?? null).catch(() => 0);
    if (removed > 0) this.deps.logger.log('info', 'temp.sweep', { count: removed });
    if (!op) {
      this.setView({ kind: 'idle', notice: null });
      return;
    }
    let next = op;
    if (next.file.uri && !(await this.deps.files.exists(next.file.uri))) {
      next = { ...next, file: { ...next.file, uri: null } };
    }
    if (next.upload.phase === 'sending') {
      // The app stopped while a POST was in flight: its outcome is unknown. Do not resend.
      next = this.withHistory({ ...next, upload: { ...next.upload, phase: 'unknown' } }, { kind: 'upload_unknown' });
    }
    if (next.deletion?.phase === 'sending') {
      next = this.withHistory({ ...next, deletion: { ...next.deletion, phase: 'unknown' } }, { kind: 'delete_unknown' });
    }
    this.op = next;
    this.deps.logger.log('info', 'operation.restored', { phase: next.upload.phase, keySuffix: keySuffix(next.idempotencyKey) });
    if (next !== op) await this.persist(next).catch(() => undefined);
    this.renderOperation();
    this.resume();
  }

  /** Foreground/background from AppState. Background stops all timers. */
  setForeground(foreground: boolean): void {
    if (this.activity.foreground === foreground) return;
    this.activity = { ...this.activity, foreground };
    this.deps.logger.log('debug', 'app.state', { foreground });
    if (foreground) {
      this.resume();
    } else {
      this.cancelTimer();
      this.renderOperation();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
    this.listeners.clear();
  }

  private resume(): void {
    const op = this.op;
    if (!op || !this.activity.foreground || this.disposed) return;
    if (op.upload.phase === 'unknown' || op.upload.phase === 'not_found') {
      this.lookupAttempt = 0;
      void this.lookupNow();
      return;
    }
    if (op.job && !op.jobMissing && op.job.status !== 'deleted') {
      this.pollAttempt = 0;
      void this.pollOnce();
    }
  }

  // ---- Picking and local validation ----------------------------------------------------------

  /**
   * Validates a picked file. The size comes from file metadata and is checked before any
   * content is read; then only the first bytes are read. Rejected copies are deleted at once.
   */
  async selectFile(picked: PickedFile): Promise<void> {
    if (this.op) return;
    this.setView({ kind: 'checking' });
    const { files } = this.deps;
    try {
      const size = (await files.size(picked.uri)) ?? picked.size;
      if (size === null) throw new Error('size unavailable');
      if (size > MAX_UPLOAD_BYTES) {
        // Rejected from metadata alone: not a single byte of content is read.
        await files.delete(picked.uri).catch(() => undefined);
        this.deps.logger.log('info', 'validation.rejected', { reason: 'too_large', bytes: size });
        this.setView({
          kind: 'rejected_locally',
          rejection: { reason: 'too_large', size, limit: MAX_UPLOAD_BYTES },
          name: picked.name,
        });
        return;
      }
      const uri = await files.adopt(picked.uri);
      const head = size > 0 ? await files.readHead(uri, SNIFF_BYTES) : null;
      const result = validateFile({ size, head, name: picked.name });
      if (!result.ok) {
        await files.delete(uri).catch(() => undefined);
        this.deps.logger.log('info', 'validation.rejected', { reason: result.rejection.reason, bytes: size });
        this.setView({ kind: 'rejected_locally', rejection: result.rejection, name: picked.name });
        return;
      }
      this.deps.logger.log('info', 'validation.accepted', { format: result.format, bytes: size });
      this.setView({ kind: 'confirm', draft: { uri, name: picked.name, size, format: result.format } });
    } catch {
      await files.delete(picked.uri).catch(() => undefined);
      this.setView({ kind: 'idle', notice: 'pick_failed' });
    }
  }

  /** Cancel on the confirmation screen, or dismiss a local rejection. */
  async cancelDraft(): Promise<void> {
    if (this.view.kind === 'confirm') {
      await this.deps.files.delete(this.view.draft.uri).catch(() => undefined);
    }
    if (!this.op) this.setView({ kind: 'idle', notice: null });
  }

  // ---- Upload --------------------------------------------------------------------------------

  /** Generates the key, persists the record, and only then sends the bytes. */
  async confirm(): Promise<void> {
    if (this.view.kind !== 'confirm' || this.op) return;
    const { draft } = this.view;
    const now = this.deps.scheduler.now();
    let op: ImportOperation;
    try {
      const sha256 = await this.deps.files.sha256(draft.uri);
      op = {
        schema: 1,
        idempotencyKey: this.deps.newKey(),
        createdAt: now,
        updatedAt: now,
        file: { uri: draft.uri, name: draft.name, size: draft.size, format: draft.format, sha256 },
        upload: { phase: 'sending', attempts: 1 },
        job: null,
        jobMissing: false,
        deletion: null,
        history: [{ at: now, kind: 'upload_started', attempt: 1 }],
      };
      await this.persist(op);
    } catch {
      // Without a durable record the upload must not start.
      await this.deps.files.delete(draft.uri).catch(() => undefined);
      this.setView({ kind: 'idle', notice: 'storage_failed' });
      return;
    }
    this.op = op;
    this.deps.logger.log('info', 'upload.start', { attempt: 1, format: op.file.format, bytes: op.file.size, keySuffix: keySuffix(op.idempotencyKey) });
    await this.send(op);
  }

  /** User-initiated resend of the same operation: same key, same verified bytes. */
  async retryUpload(): Promise<void> {
    const op = this.op;
    if (!op || this.activity.busy) return;
    if (op.upload.phase !== 'unknown' && op.upload.phase !== 'not_found') return;
    this.cancelTimer();
    const uri = op.file.uri;
    if (!uri || !(await this.deps.files.exists(uri))) {
      await this.commit({ ...op, file: { ...op.file, uri: null }, upload: { ...op.upload, lastError: 'copy_missing' } });
      return;
    }
    const sha256 = await this.deps.files.sha256(uri).catch(() => null);
    if (sha256 !== op.file.sha256) {
      // Never send different bytes under the same key.
      await this.commit({ ...op, upload: { ...op.upload, lastError: 'copy_changed' } });
      return;
    }
    const attempt = op.upload.attempts + 1;
    const next = this.withHistory(
      { ...op, upload: { phase: 'sending', attempts: attempt } },
      { kind: 'upload_started', attempt },
    );
    await this.commit(next);
    this.deps.logger.log('info', 'upload.retry', { attempt, keySuffix: keySuffix(op.idempotencyKey) });
    await this.send(next);
  }

  /**
   * The private copy disappeared (for example the OS purged the cache). The user picks the
   * file again; it is accepted only if its SHA-256 matches, so the key keeps its bytes.
   */
  async reattachFile(picked: PickedFile): Promise<'reattached' | 'different_file' | 'failed'> {
    const op = this.op;
    if (!op || op.file.uri || (op.upload.phase !== 'unknown' && op.upload.phase !== 'not_found')) return 'failed';
    this.setActivity({ busy: 'reattaching' });
    try {
      const uri = await this.deps.files.adopt(picked.uri);
      const sha256 = await this.deps.files.sha256(uri);
      if (sha256 !== op.file.sha256) {
        await this.deps.files.delete(uri).catch(() => undefined);
        return 'different_file';
      }
      await this.commit({ ...this.requireOp(), file: { ...op.file, uri }, upload: { ...op.upload, lastError: undefined } });
      return 'reattached';
    } catch {
      await this.deps.files.delete(picked.uri).catch(() => undefined);
      return 'failed';
    } finally {
      this.setActivity({ busy: null });
    }
  }

  private async send(op: ImportOperation): Promise<void> {
    const key = op.idempotencyKey;
    const uri = op.file.uri;
    if (!uri) return;
    this.setActivity({ busy: 'sending' });
    const outcome = await this.deps.api.createImport({ key, fileName: op.file.name, fileUri: uri });
    if (!this.isCurrent(key)) return;
    this.setActivity({ busy: null, lastCheckedAt: this.deps.scheduler.now() });
    switch (outcome.kind) {
      case 'accepted':
        this.deps.logger.log('info', 'upload.accepted', { jobId: outcome.job.jobId, revision: outcome.job.revision });
        await this.acceptJob(outcome.job);
        return;
      case 'rejected': {
        this.deps.logger.log('warn', 'upload.rejected', { httpStatus: outcome.status, error: outcome.code });
        const current = this.requireOp();
        await this.commit(
          this.withHistory(
            { ...current, upload: { ...current.upload, phase: 'rejected', lastError: outcome.code } },
            { kind: 'upload_rejected', error: outcome.code },
          ),
        );
        await this.dropCopy();
        return;
      }
      case 'unknown': {
        this.deps.logger.log('warn', 'upload.unknown', { error: outcome.code });
        const current = this.requireOp();
        await this.commit(
          this.withHistory(
            { ...current, upload: { ...current.upload, phase: 'unknown', lastError: outcome.code } },
            { kind: 'upload_unknown', error: outcome.code },
          ),
        );
        this.lookupAttempt = 0;
        this.scheduleLookup();
        return;
      }
    }
  }

  /** Recovery after an unknown outcome: ask the server whether this key created a job. */
  async lookupNow(): Promise<void> {
    const op = this.op;
    if (!op || this.activity.busy) return;
    if (op.upload.phase !== 'unknown' && op.upload.phase !== 'not_found') return;
    this.cancelTimer();
    const key = op.idempotencyKey;
    this.setActivity({ busy: 'looking_up' });
    const outcome = await this.deps.api.lookupByKey(key);
    if (!this.isCurrent(key)) return;
    this.setActivity({ busy: null, lastCheckedAt: this.deps.scheduler.now() });
    const current = this.requireOp();
    switch (outcome.kind) {
      case 'found':
        this.setActivity({ unreachable: false });
        this.deps.logger.log('info', 'recovery.found', { jobId: outcome.job.jobId });
        await this.acceptJob(outcome.job);
        return;
      case 'not_found':
        this.setActivity({ unreachable: false });
        this.deps.logger.log('info', 'recovery.not_found', { keySuffix: keySuffix(key) });
        if (current.upload.phase !== 'not_found') {
          await this.commit(
            this.withHistory({ ...current, upload: { ...current.upload, phase: 'not_found' } }, { kind: 'lookup_not_found' }),
          );
        }
        return;
      default:
        this.setActivity({ unreachable: true });
        this.deps.logger.log('warn', 'recovery.unreachable', { error: outcome.code });
        if (current.upload.phase === 'unknown') this.scheduleLookup();
    }
  }

  private scheduleLookup(): void {
    const delays = this.timing.lookupBackoffMs;
    const delay = delays[Math.min(this.lookupAttempt, delays.length - 1)];
    this.lookupAttempt += 1;
    this.schedule(delay, () => void this.lookupNow());
  }

  /** The server acknowledged the job: record it, drop the private copy, start polling. */
  private async acceptJob(job: JobSnapshot): Promise<void> {
    const current = this.requireOp();
    const reduced = reduceJob(current.job, job);
    let next = this.withHistory(
      { ...current, upload: { phase: 'accepted', attempts: current.upload.attempts }, job: reduced.job },
      { kind: 'upload_accepted' },
    );
    if (reduced.applied) next = this.withHistory(next, { kind: 'server_status', status: job.status, revision: job.revision });
    await this.commit(next);
    // The server has the bytes now; a resend can never be needed for this operation.
    await this.dropCopy();
    this.pollAttempt = 0;
    if (this.needsPolling(this.requireOp())) this.schedulePoll(true);
  }

  private async dropCopy(): Promise<void> {
    const op = this.requireOp();
    const uri = op.file.uri;
    if (!uri) return;
    await this.commit({ ...op, file: { ...op.file, uri: null } });
    await this.deps.files.delete(uri).catch(() => undefined);
    this.deps.logger.log('debug', 'temp.removed', { reason: op.upload.phase });
  }

  // ---- Polling -------------------------------------------------------------------------------

  private needsPolling(op: ImportOperation): boolean {
    if (!op.job || op.jobMissing) return false;
    if (op.job.status === 'deleted') return false;
    if (op.job.status === 'queued' || op.job.status === 'processing') return true;
    if (op.job.status === 'deleting') return true;
    return op.deletion?.phase === 'accepted';
  }

  private schedulePoll(immediate = false): void {
    const delays = this.timing.pollBackoffMs;
    const delay = immediate ? 0 : delays[Math.min(this.pollAttempt, delays.length - 1)];
    this.pollAttempt += 1;
    this.schedule(delay, () => void this.pollOnce());
  }

  /** One GET of the job. Also used by the manual "refresh" action. */
  async pollOnce(manual = false): Promise<void> {
    const op = this.op;
    if (!op?.job || op.jobMissing || this.activity.busy) return;
    this.cancelTimer();
    const key = op.idempotencyKey;
    if (manual) this.setActivity({ busy: 'refreshing' });
    const outcome = await this.deps.api.getJob(op.job.jobId);
    if (!this.isCurrent(key)) return;
    this.setActivity({ busy: null, lastCheckedAt: this.deps.scheduler.now() });
    switch (outcome.kind) {
      case 'found': {
        this.setActivity({ unreachable: false });
        const changed = await this.applyServerJob(outcome.job);
        if (changed) this.pollAttempt = 0;
        break;
      }
      case 'not_found': {
        this.setActivity({ unreachable: false });
        this.deps.logger.log('warn', 'job.missing', { jobId: op.job.jobId });
        const current = this.requireOp();
        await this.commit(this.withHistory({ ...current, jobMissing: true }, { kind: 'job_missing' }));
        return;
      }
      default:
        this.setActivity({ unreachable: true });
        this.deps.logger.log('warn', 'poll.unreachable', { error: outcome.code });
    }
    if (this.needsPolling(this.requireOp()) && this.activity.foreground) this.schedulePoll();
  }

  /** Feeds a server snapshot through the reducer. Returns true if it was applied. */
  private async applyServerJob(incoming: JobSnapshot): Promise<boolean> {
    const current = this.requireOp();
    const result = reduceJob(current.job, incoming);
    if (!result.applied) {
      // Record only genuinely older snapshots; an equal revision is just "no change".
      if (result.reason === 'stale' && current.job && incoming.revision < current.job.revision) {
        this.deps.logger.log('info', 'job.stale_ignored', { status: incoming.status, revision: incoming.revision });
        await this.commit(this.withHistory(current, { kind: 'stale_ignored', status: incoming.status, revision: incoming.revision }));
      }
      return false;
    }
    this.deps.logger.log('info', 'job.status', { status: incoming.status, revision: incoming.revision });
    let next = this.withHistory({ ...current, job: result.job }, {
      kind: 'server_status',
      status: incoming.status,
      revision: incoming.revision,
    });
    // A GET that shows deleting/deleted settles an unknown or failed delete outcome.
    if ((result.job.status === 'deleting' || result.job.status === 'deleted') && next.deletion && next.deletion.phase !== 'accepted') {
      next = { ...next, deletion: { ...next.deletion, phase: 'accepted', lastError: undefined } };
    }
    await this.commit(next);
    return true;
  }

  // ---- Deletion ------------------------------------------------------------------------------

  /** Starts or retries deletion. The delete key is persisted before the first DELETE. */
  async requestDelete(): Promise<void> {
    const op = this.op;
    if (!op?.job || op.jobMissing || this.activity.busy) return;
    if (op.job.status === 'deleted' || op.job.status === 'deleting') return;
    if (op.deletion && op.deletion.phase !== 'failed' && op.deletion.phase !== 'unknown') return;
    this.cancelTimer();
    const deletion = op.deletion
      ? { ...op.deletion, phase: 'sending' as const, attempts: op.deletion.attempts + 1, lastError: undefined }
      : { key: this.deps.newKey(), phase: 'sending' as const, attempts: 1 };
    const started = this.withHistory({ ...op, deletion }, { kind: 'delete_started', attempt: deletion.attempts });
    await this.commit(started);
    const key = op.idempotencyKey;
    const jobId = op.job.jobId;
    this.deps.logger.log('info', 'delete.start', { attempt: deletion.attempts, jobId, keySuffix: keySuffix(deletion.key) });
    this.setActivity({ busy: 'deleting' });
    const outcome = await this.deps.api.deleteJob(jobId, deletion.key);
    if (!this.isCurrent(key)) return;
    this.setActivity({ busy: null, lastCheckedAt: this.deps.scheduler.now() });
    const current = this.requireOp();
    const currentDeletion = current.deletion ?? deletion;
    switch (outcome.kind) {
      case 'accepted': {
        this.deps.logger.log('info', 'delete.accepted', { jobId });
        await this.commit(
          this.withHistory({ ...current, deletion: { ...currentDeletion, phase: 'accepted' } }, { kind: 'delete_accepted' }),
        );
        // A 202 body of `deleting` is a real server state. A `deleted` body is not trusted
        // here: only a later GET may confirm deletion.
        if (outcome.job && outcome.job.status === 'deleting') await this.applyServerJob(outcome.job);
        this.pollAttempt = 0;
        this.schedulePoll(true);
        return;
      }
      case 'failed':
        this.deps.logger.log('warn', 'delete.failed', { httpStatus: outcome.status, error: outcome.code });
        await this.commit(
          this.withHistory(
            { ...current, deletion: { ...currentDeletion, phase: 'failed', lastError: outcome.code } },
            { kind: 'delete_failed', error: outcome.code },
          ),
        );
        return;
      case 'not_found':
        await this.commit(this.withHistory({ ...current, jobMissing: true }, { kind: 'job_missing' }));
        return;
      case 'unknown':
        this.deps.logger.log('warn', 'delete.unknown', { error: outcome.code });
        await this.commit(
          this.withHistory(
            { ...current, deletion: { ...currentDeletion, phase: 'unknown', lastError: outcome.code } },
            { kind: 'delete_unknown', error: outcome.code },
          ),
        );
        // Ask the server what happened; a GET of deleting/deleted settles it.
        await this.pollOnce();
        return;
    }
  }

  // ---- Ending an operation -------------------------------------------------------------------

  /** Removes the local record and any private copy. Never touches server data. */
  async forget(): Promise<void> {
    this.cancelTimer();
    const op = this.op;
    this.op = null;
    this.activity = { ...this.activity, busy: null, nextCheckAt: null, unreachable: false, lastCheckedAt: null };
    if (op?.file.uri) await this.deps.files.delete(op.file.uri).catch(() => undefined);
    await this.deps.store.clear().catch(() => undefined);
    await this.deps.files.sweep(null).catch(() => 0);
    this.deps.logger.log('info', 'operation.forgotten', {});
    this.setView({ kind: 'idle', notice: null });
  }

  /** Diagnostics: wipe all local data of this fragment. */
  async clearLocalData(): Promise<void> {
    await this.forget();
    this.setView({ kind: 'idle', notice: 'cleared' });
  }

  // ---- Helpers -------------------------------------------------------------------------------

  private requireOp(): ImportOperation {
    if (!this.op) throw new Error('no active operation');
    return this.op;
  }

  private isCurrent(key: string): boolean {
    return !this.disposed && this.op?.idempotencyKey === key;
  }

  private withHistory(op: ImportOperation, entry: Omit<HistoryEntry, 'at'>): ImportOperation {
    const history = [...op.history, { ...entry, at: this.deps.scheduler.now() }].slice(-HISTORY_LIMIT);
    return { ...op, history };
  }

  private persist(op: ImportOperation): Promise<void> {
    return this.deps.store.save(op);
  }

  /** Every transition goes through here: memory, UI, then durable storage. */
  private async commit(next: ImportOperation): Promise<void> {
    const stamped = { ...next, updatedAt: this.deps.scheduler.now() };
    this.op = stamped;
    this.renderOperation();
    await this.persist(stamped).catch(() => {
      this.deps.logger.log('error', 'storage.write_failed', {});
    });
  }

  private schedule(delay: number, run: () => void): void {
    this.cancelTimer();
    if (!this.activity.foreground || this.disposed) return;
    const at = this.deps.scheduler.now() + delay;
    this.timer = this.deps.scheduler.setTimeout(() => {
      this.timer = null;
      this.activity = { ...this.activity, nextCheckAt: null };
      run();
    }, delay);
    this.setActivity({ nextCheckAt: at });
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.deps.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.activity.nextCheckAt !== null) this.activity = { ...this.activity, nextCheckAt: null };
  }
}
