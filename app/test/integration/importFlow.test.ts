/**
 * End-to-end behaviour of the import controller against the real, unmodified kit mock
 * (kit/mock-server.mjs via createMockServer) on a random port with a temp state file.
 * Counters are read from GET /__test/state, not from the client.
 */
import { promises as fs, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FetchLike } from '../../src/core/importApi';
import type { ImportView } from '../../src/core/importController';
import type { LogRecord } from '../../src/core/logger';
import { OPERATION_STORAGE_KEY } from '../../src/core/operationStore';
import type { ImportOperation } from '../../src/core/types';
import {
  FIXTURES,
  MemoryStorage,
  NodeFiles,
  disposeAll,
  launchApp,
  makeOversize,
  nodeFetch,
  nodeUploader,
  opOf,
  sha256File,
  sleep,
  startMock,
  waitFor,
  type RunningMock,
} from '../support/harness';

const CSV = join(FIXTURES, 'statement.csv');
const PDF = join(FIXTURES, 'statement.pdf');
const SPOOFED = join(FIXTURES, 'spoofed.pdf');

let mock: RunningMock;
let files: NodeFiles;
let storage: MemoryStorage;

beforeEach(async () => {
  mock = await startMock();
  files = await NodeFiles.create();
  storage = new MemoryStorage();
});

afterEach(async () => {
  disposeAll();
  await mock.stop();
  await files.dispose();
});

function persisted(): ImportOperation | null {
  const raw = storage.data.get(OPERATION_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as ImportOperation) : null;
}

async function pickAndConfirm(app: ReturnType<typeof launchApp>, source: string, name: string) {
  await app.controller.selectFile(await files.pick(source, name));
  expect(app.controller.getSnapshot().kind).toBe('confirm');
  await app.controller.confirm();
}

const isReady = (view: ImportView) => view.kind === 'operation' && view.op.job?.status === 'ready';

describe('happy path', () => {
  it.each([
    ['statement.csv', CSV],
    ['statement.pdf', PDF],
  ])('%s: real bytes reach the mock, 202 is queued (not ready), ready shows the fixed result', async (name, source) => {
    const uploader = nodeUploader();
    const app = launchApp({ mock, storage, files, uploader });
    await app.controller.selectFile(await files.pick(source, name));
    await app.controller.confirm();

    const op = opOf(app.controller.getSnapshot());
    // Right after the 202 the job is queued or processing, never presented as ready.
    const firstStatus = op.history.find((entry) => entry.kind === 'server_status');
    expect(firstStatus).toMatchObject({ status: 'queued', revision: 1 });

    const ready = opOf(await waitFor(app.controller, isReady));
    expect(ready.job?.revision).toBe(3);
    expect(ready.job?.result?.currency).toBe('AUD');
    expect(ready.job?.result?.items.map((item) => [item.merchant, item.amountMinor, item.cadence, item.lastSeen])).toEqual([
      ['StreamBeam', 1999, 'monthly', '2026-10-01'],
      ['BrightGrid', 13200, 'monthly', '2026-10-03'],
    ]);

    const state = await mock.state();
    const size = statSync(source).size;
    expect(state.stats).toEqual({ createRequests: 1, newJobs: 1, duplicateHits: 0, acceptedBytes: size, deleteRequests: 0 });
    // The mock hashed exactly the bytes of the fixture, and the client recorded the same hash.
    expect(state.jobs[0].sha256).toBe(await sha256File(source));
    expect(ready.file.sha256).toBe(state.jobs[0].sha256);
    expect(uploader.calls).toHaveLength(1);
    expect(uploader.calls[0].headers['Content-Type']).toBe('application/octet-stream');
    expect(uploader.calls[0].headers['X-File-Name']).toBe(name);
    // The private copy is gone once the server has the job.
    expect(ready.file.uri).toBeNull();
    expect(await files.stagedFiles()).toEqual([]);
  });
});

describe('durable idempotency key', () => {
  it('is persisted with phase "sending" before the POST leaves, and matches the header', async () => {
    const uploader = nodeUploader();
    let atSend: ImportOperation | null = null;
    uploader.beforeSend = () => {
      atSend = persisted();
    };
    const app = launchApp({ mock, storage, files, uploader });
    await pickAndConfirm(app, CSV, 'statement.csv');
    const snapshot = atSend as ImportOperation | null;
    expect(snapshot).not.toBeNull();
    expect(snapshot?.upload.phase).toBe('sending');
    expect(snapshot?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(uploader.calls[0].headers['Idempotency-Key']).toBe(snapshot?.idempotencyKey);
    expect(snapshot?.file).toMatchObject({ size: statSync(CSV).size, format: 'csv' });
    expect(snapshot?.file.sha256).toBe(await sha256File(CSV));
    expect(snapshot?.file.uri).toMatch(/statement-import\/.+\.bin$/);
  });

  it('a normal relaunch restores the job without resending the file', async () => {
    const uploader = nodeUploader();
    const first = launchApp({ mock, storage, files, uploader });
    await pickAndConfirm(first, CSV, 'statement.csv');
    const key = opOf(first.controller.getSnapshot()).idempotencyKey;
    await waitFor(first.controller, isReady);
    first.controller.dispose();

    const second = launchApp({ mock, storage, files, uploader });
    await second.controller.restore();
    const view = await waitFor(second.controller, isReady);
    expect(opOf(view).idempotencyKey).toBe(key);
    expect(uploader.calls).toHaveLength(1);
    expect((await mock.state()).stats).toMatchObject({ createRequests: 1, newJobs: 1, duplicateHits: 0 });
  });
});

describe('lost_ack', () => {
  it('relaunch after a lost response: by-key finds the job, exactly one job, nothing resent', async () => {
    await mock.scenario('lost_ack');
    const uploader = nodeUploader();
    // Long lookup backoff so the first "launch" is killed before it recovers by itself.
    const first = launchApp({ mock, storage, files, uploader, timing: { lookupBackoffMs: [60_000], pollBackoffMs: [50] } });
    await pickAndConfirm(first, CSV, 'statement.csv');
    const lost = opOf(first.controller.getSnapshot());
    expect(lost.upload.phase).toBe('unknown');
    expect(lost.job).toBeNull();
    expect(persisted()?.upload.phase).toBe('unknown');
    first.controller.dispose(); // the app is killed

    const second = launchApp({ mock, storage, files, uploader });
    await second.controller.restore();
    const recovered = opOf(await waitFor(second.controller, isReady));
    expect(recovered.idempotencyKey).toBe(lost.idempotencyKey);
    expect(recovered.history.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(['upload_started', 'upload_unknown', 'upload_accepted']),
    );
    expect(uploader.calls).toHaveLength(1);
    const state = await mock.state();
    expect(state.stats).toMatchObject({ createRequests: 1, newJobs: 1, duplicateHits: 0 });
    expect(state.jobs).toHaveLength(1);
  });

  it('app killed mid-POST (record still "sending"): relaunch treats it as unknown and looks up by key', async () => {
    await mock.scenario('lost_ack');
    const uploader = nodeUploader();
    const first = launchApp({ mock, storage, files, uploader, timing: { lookupBackoffMs: [60_000], pollBackoffMs: [50] } });
    // Simulate the process dying after the request left: restore the "sending" record afterwards.
    let sendingSnapshot: string | undefined;
    uploader.beforeSend = () => {
      sendingSnapshot = storage.data.get(OPERATION_STORAGE_KEY);
    };
    await pickAndConfirm(first, CSV, 'statement.csv');
    first.controller.dispose();
    storage.data.set(OPERATION_STORAGE_KEY, sendingSnapshot as string);
    expect(persisted()?.upload.phase).toBe('sending');

    const second = launchApp({ mock, storage, files, uploader });
    await second.controller.restore();
    await waitFor(second.controller, isReady);
    expect(uploader.calls).toHaveLength(1);
    expect((await mock.state()).stats).toMatchObject({ createRequests: 1, newJobs: 1 });
  });

  it('user retry with the same key returns the same job (duplicate hit, still one job)', async () => {
    await mock.scenario('lost_ack');
    const uploader = nodeUploader();
    const app = launchApp({ mock, storage, files, uploader, timing: { lookupBackoffMs: [60_000], pollBackoffMs: [50] } });
    await pickAndConfirm(app, CSV, 'statement.csv');
    expect(opOf(app.controller.getSnapshot()).upload.phase).toBe('unknown');
    await app.controller.retryUpload();
    await waitFor(app.controller, isReady);
    expect(uploader.calls).toHaveLength(2);
    expect(uploader.calls[1].headers['Idempotency-Key']).toBe(uploader.calls[0].headers['Idempotency-Key']);
    expect((await mock.state()).stats).toMatchObject({ createRequests: 2, newJobs: 1, duplicateHits: 1 });
  });
});

describe('by-key 404', () => {
  it('offers a retry that reuses the key and bytes, and creates exactly one job', async () => {
    const uploader = nodeUploader();
    uploader.failNext = 1; // the first POST never reaches the server
    const app = launchApp({ mock, storage, files, uploader });
    await pickAndConfirm(app, CSV, 'statement.csv');
    const notFound = opOf(await waitFor(app.controller, (view) => view.kind === 'operation' && view.op.upload.phase === 'not_found'));
    expect(notFound.file.uri).not.toBeNull(); // the copy is kept for the retry
    expect((await mock.state()).stats.createRequests).toBe(0);

    await app.controller.retryUpload();
    await waitFor(app.controller, isReady);
    expect(uploader.calls[1].headers['Idempotency-Key']).toBe(uploader.calls[0].headers['Idempotency-Key']);
    expect((await mock.state()).stats).toMatchObject({ createRequests: 1, newJobs: 1 });
  });

  it('refuses to resend if the private copy changed, so a key never carries other bytes', async () => {
    const uploader = nodeUploader();
    uploader.failNext = 1;
    const app = launchApp({ mock, storage, files, uploader });
    await pickAndConfirm(app, CSV, 'statement.csv');
    const op = opOf(await waitFor(app.controller, (view) => view.kind === 'operation' && view.op.upload.phase === 'not_found'));
    await fs.appendFile((op.file.uri as string).replace('file://', ''), 'tampered');
    await app.controller.retryUpload();
    expect(opOf(app.controller.getSnapshot()).upload.lastError).toBe('copy_changed');
    expect(uploader.calls).toHaveLength(1);
    expect((await mock.state()).stats.createRequests).toBe(0);
  });
});

describe('stale_status', () => {
  it('processing/2 after ready/3 is ignored and the UI stays ready', async () => {
    await mock.scenario('stale_status');
    const app = launchApp({ mock, storage, files, uploader: nodeUploader() });
    await pickAndConfirm(app, CSV, 'statement.csv');
    await waitFor(app.controller, isReady); // 1st GET of the job: ready/3
    await app.controller.pollOnce(true); // 2nd GET: processing/2 (stale)
    const op = opOf(app.controller.getSnapshot());
    expect(op.job).toMatchObject({ status: 'ready', revision: 3 });
    expect(op.job?.result?.items).toHaveLength(2);
    expect(op.history.at(-1)).toMatchObject({ kind: 'stale_ignored', status: 'processing', revision: 2 });
    expect(persisted()?.job).toMatchObject({ status: 'ready', revision: 3 });
    await app.controller.pollOnce(true); // 3rd GET: ready/3 again (no change)
    expect(opOf(app.controller.getSnapshot()).job).toMatchObject({ status: 'ready', revision: 3 });
  });
});

describe('delete', () => {
  it('delete_failure: 503 never claims deletion; after happy, retry with the same key reaches deleted', async () => {
    const app = launchApp({ mock, storage, files, uploader: nodeUploader() });
    await pickAndConfirm(app, CSV, 'statement.csv');
    await waitFor(app.controller, isReady);

    await mock.scenario('delete_failure');
    let keyBeforeDelete: string | undefined;
    const deleteKeys: string[] = [];
    const spyFetch: FetchLike = async (url, init) => {
      if (init.method === 'DELETE') {
        keyBeforeDelete = persisted()?.deletion?.key;
        deleteKeys.push(init.headers?.['Idempotency-Key'] ?? '');
      }
      return nodeFetch(url, init);
    };
    const withSpy = launchApp({ mock, storage, files, uploader: nodeUploader(), fetch: spyFetch });
    app.controller.dispose();
    await withSpy.controller.restore();
    await waitFor(withSpy.controller, isReady);

    await withSpy.controller.requestDelete();
    const failed = opOf(withSpy.controller.getSnapshot());
    expect(failed.deletion).toMatchObject({ phase: 'failed', lastError: 'server_unavailable', attempts: 1 });
    expect(failed.job?.status).toBe('ready');
    expect(keyBeforeDelete).toBe(deleteKeys[0]); // persisted before the DELETE left
    // The server still has it.
    await withSpy.controller.pollOnce(true);
    expect(opOf(withSpy.controller.getSnapshot()).job?.status).toBe('ready');
    expect((await mock.state()).jobs[0].status).toBe('ready');

    await mock.scenario('happy');
    await withSpy.controller.requestDelete();
    expect(deleteKeys).toHaveLength(2);
    expect(deleteKeys[1]).toBe(deleteKeys[0]);
    const deleting = opOf(withSpy.controller.getSnapshot());
    expect(deleting.deletion?.phase).toBe('accepted');
    expect(deleting.job?.status).not.toBe('deleted'); // 202 alone is not a confirmation

    const deleted = opOf(await waitFor(withSpy.controller, (view) => view.kind === 'operation' && view.op.job?.status === 'deleted'));
    expect(deleted.job?.revision).toBe(5);
    const state = await mock.state();
    expect(state.stats.deleteRequests).toBe(2);
    expect(state.jobs[0].status).toBe('deleted');
  });

  it('a late ready/3 response arriving after deleted/5 cannot resurrect the job', async () => {
    let hold: (() => void) | null = null;
    let holding = false;
    const gatedFetch: FetchLike = async (url, init) => {
      const response = await nodeFetch(url, init);
      if (holding && init.method === 'GET') {
        holding = false;
        const body = await response.text();
        await new Promise<void>((release) => {
          hold = release;
        });
        return { status: response.status, text: async () => body };
      }
      return response;
    };
    const app = launchApp({ mock, storage, files, uploader: nodeUploader(), fetch: gatedFetch });
    await pickAndConfirm(app, CSV, 'statement.csv');
    await waitFor(app.controller, isReady);

    holding = true;
    const latePoll = app.controller.pollOnce(); // server answers ready/3 now; delivery is held
    await sleep(50);
    await app.controller.requestDelete();
    await waitFor(app.controller, (view) => view.kind === 'operation' && view.op.job?.status === 'deleted');
    (hold as unknown as () => void)(); // deliver the old ready/3
    await latePoll;
    expect(opOf(app.controller.getSnapshot()).job).toMatchObject({ status: 'deleted', revision: 5 });
    expect(persisted()?.job).toMatchObject({ status: 'deleted', revision: 5 });
  });
});

describe('local rejection before POST', () => {
  it('spoofed.pdf and oversize.csv are rejected with createRequests unchanged', async () => {
    const tmp = await fs.mkdtemp(join(tmpdir(), 'oversize-'));
    const oversize = await makeOversize(tmp);
    const uploader = nodeUploader();
    const app = launchApp({ mock, storage, files, uploader });
    const before = (await mock.state()).stats.createRequests;

    await app.controller.selectFile(await files.pick(SPOOFED, 'spoofed.pdf'));
    expect(app.controller.getSnapshot()).toMatchObject({
      kind: 'rejected_locally',
      rejection: { reason: 'unsupported_content', claimed: 'pdf' },
    });
    await app.controller.cancelDraft();

    const readsBefore = files.readCount;
    await app.controller.selectFile(await files.pick(oversize, 'oversize.csv'));
    expect(app.controller.getSnapshot()).toMatchObject({
      kind: 'rejected_locally',
      rejection: { reason: 'too_large', size: statSync(oversize).size, limit: 10 * 1024 * 1024 },
    });
    expect(files.readCount).toBe(readsBefore); // rejected from metadata, content never read

    expect(uploader.calls).toHaveLength(0);
    expect((await mock.state()).stats.createRequests).toBe(before);
    expect(persisted()).toBeNull();
    expect(await files.stagedFiles()).toEqual([]); // rejected copies were deleted
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('cancel on the confirmation screen deletes the private copy and sends nothing', async () => {
    const uploader = nodeUploader();
    const app = launchApp({ mock, storage, files, uploader });
    await app.controller.selectFile(await files.pick(CSV, 'statement.csv'));
    expect(await files.stagedFiles()).toHaveLength(1);
    await app.controller.cancelDraft();
    expect(app.controller.getSnapshot().kind).toBe('idle');
    expect(await files.stagedFiles()).toEqual([]);
    expect(uploader.calls).toHaveLength(0);
  });

  it('a CSV with a BOM passes local sniffing; the mock answers 415 and the client shows a server rejection', async () => {
    const tmp = await fs.mkdtemp(join(tmpdir(), 'bom-'));
    const bom = join(tmp, 'bom.csv');
    await fs.writeFile(bom, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), await fs.readFile(CSV)]));
    const app = launchApp({ mock, storage, files, uploader: nodeUploader() });
    await pickAndConfirm(app, bom, 'bom.csv');
    const op = opOf(app.controller.getSnapshot());
    expect(op.upload).toMatchObject({ phase: 'rejected', lastError: 'unsupported_content' });
    expect(op.file.uri).toBeNull();
    expect((await mock.state()).stats).toMatchObject({ createRequests: 1, newJobs: 0 });
    await fs.rm(tmp, { recursive: true, force: true });
  });
});

describe('temp files and privacy', () => {
  it('launch sweep removes orphaned copies but keeps the one owned by the active operation', async () => {
    const uploader = nodeUploader();
    uploader.failNext = 1;
    const first = launchApp({ mock, storage, files, uploader, timing: { lookupBackoffMs: [60_000], pollBackoffMs: [50] } });
    await pickAndConfirm(first, CSV, 'statement.csv');
    first.controller.dispose();
    const owned = persisted()?.file.uri as string;
    await fs.writeFile(join(files.staging, 'orphan.bin'), 'x');
    await fs.writeFile(join(files.pickerCache, 'left-by-picker.csv'), 'x');

    const second = launchApp({ mock, storage, files, uploader });
    await second.controller.restore();
    expect(await files.stagedFiles()).toEqual([owned.split('/').pop()]);
  });

  it('logs never contain the file name, the key, merchants or file content', async () => {
    const logs: LogRecord[] = [];
    await mock.scenario('lost_ack');
    const app = launchApp({ mock, storage, files, uploader: nodeUploader(), logs });
    await pickAndConfirm(app, CSV, 'statement.csv');
    await waitFor(app.controller, isReady);
    await mock.scenario('happy');
    await app.controller.requestDelete();
    await waitFor(app.controller, (view) => view.kind === 'operation' && view.op.job?.status === 'deleted');
    const key = opOf(app.controller.getSnapshot()).idempotencyKey;
    const dump = JSON.stringify(logs);
    expect(logs.length).toBeGreaterThan(5);
    for (const secret of ['statement', '.csv', key, 'StreamBeam', 'BrightGrid', 'description', 'file://']) {
      expect(dump).not.toContain(secret);
    }
  });

  it('forget clears the record and every private copy', async () => {
    const uploader = nodeUploader();
    uploader.failNext = 1;
    const app = launchApp({ mock, storage, files, uploader });
    await pickAndConfirm(app, CSV, 'statement.csv');
    await waitFor(app.controller, (view) => view.kind === 'operation' && view.op.upload.phase === 'not_found');
    await app.controller.forget();
    expect(persisted()).toBeNull();
    expect(await files.stagedFiles()).toEqual([]);
    expect(app.controller.getSnapshot()).toEqual({ kind: 'idle', notice: null });
  });
});

describe('concurrency guards (double taps, overlapping requests)', () => {
  it('a double-tapped «Отправить» creates one operation, one key and one job', async () => {
    const uploader = nodeUploader();
    const app = launchApp({ mock, storage, files, uploader });
    await app.controller.selectFile(await files.pick(CSV, 'statement.csv'));
    await Promise.all([app.controller.confirm(), app.controller.confirm()]);
    await waitFor(app.controller, isReady);
    expect(uploader.calls).toHaveLength(1);
    expect((await mock.state()).stats).toMatchObject({ createRequests: 1, newJobs: 1 });
  });

  it('a double-tapped retry sends once more, not twice', async () => {
    await mock.scenario('lost_ack');
    const uploader = nodeUploader();
    const app = launchApp({ mock, storage, files, uploader, timing: { lookupBackoffMs: [60_000], pollBackoffMs: [50] } });
    await pickAndConfirm(app, CSV, 'statement.csv');
    await Promise.all([app.controller.retryUpload(), app.controller.retryUpload()]);
    await waitFor(app.controller, isReady);
    expect(uploader.calls).toHaveLength(2);
    expect((await mock.state()).stats).toMatchObject({ createRequests: 2, newJobs: 1, duplicateHits: 1 });
  });

  it('a double-tapped delete sends one DELETE', async () => {
    const app = launchApp({ mock, storage, files, uploader: nodeUploader() });
    await pickAndConfirm(app, CSV, 'statement.csv');
    await waitFor(app.controller, isReady);
    await Promise.all([app.controller.requestDelete(), app.controller.requestDelete()]);
    await waitFor(app.controller, (view) => view.kind === 'operation' && view.op.job?.status === 'deleted');
    expect((await mock.state()).stats.deleteRequests).toBe(1);
  });

  it('a poll that finishes during a pending DELETE does not clear the delete lock', async () => {
    const held: Record<string, (() => void) | null> = { GET: null, DELETE: null };
    let gate = false;
    const gatedFetch: FetchLike = async (url, init) => {
      const response = await nodeFetch(url, init);
      if (gate && (init.method === 'GET' || init.method === 'DELETE') && !url.includes('/__test/')) {
        const body = await response.text();
        await new Promise<void>((release) => {
          held[init.method] = release;
        });
        return { status: response.status, text: async () => body };
      }
      return response;
    };
    const app = launchApp({ mock, storage, files, uploader: nodeUploader(), fetch: gatedFetch });
    await pickAndConfirm(app, CSV, 'statement.csv');
    await waitFor(app.controller, isReady);
    gate = true;
    const poll = app.controller.pollOnce(); // automatic poll, response held
    await sleep(50);
    const del = app.controller.requestDelete(); // takes the lock, response held
    await sleep(50);
    gate = false;
    (held.GET as () => void)();
    await poll;
    const during = app.controller.getSnapshot();
    expect(during.kind === 'operation' && during.activity.busy).toBe('deleting');
    (held.DELETE as () => void)();
    await del;
    await waitFor(app.controller, (view) => view.kind === 'operation' && view.op.job?.status === 'deleted');
  });
});

describe('temp copy cleanup on read errors', () => {
  it('removes the staged copy if reading its header fails after it was moved', async () => {
    class FailingHead extends NodeFiles {
      async readHead(): Promise<Uint8Array<ArrayBuffer>> {
        throw new Error('read failed');
      }
    }
    const failing = new FailingHead(files.root);
    const app = launchApp({ mock, storage, files: failing, uploader: nodeUploader() });
    await app.controller.selectFile(await files.pick(CSV, 'statement.csv'));
    expect(app.controller.getSnapshot()).toEqual({ kind: 'idle', notice: 'pick_failed' });
    expect(await files.stagedFiles()).toEqual([]);
  });
});

