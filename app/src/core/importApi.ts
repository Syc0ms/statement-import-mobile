import type { FileUploader } from './ports';
import type { ErrorCode, JobSnapshot, JobStatus, ReadyResult, RecurringCharge } from './types';
import { JOB_STATUSES } from './types';

export type FetchLike = (url: string, init: {
  method: string;
  headers?: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}) => Promise<{ status: number; text(): Promise<string> }>;

/** Outcome of a request whose effect on the server is unknown to the client. */
export type Unreachable = { kind: 'unreachable'; code: 'network' | 'timeout' };

export type CreateOutcome =
  | { kind: 'accepted'; job: JobSnapshot }
  | { kind: 'rejected'; status: number; code: ErrorCode }
  /** Network failure, timeout, closed socket, 5xx or an unreadable 202: the job may or may not exist. */
  | { kind: 'unknown'; code: ErrorCode };

export type LookupOutcome =
  | { kind: 'found'; job: JobSnapshot }
  | { kind: 'not_found' }
  | Unreachable
  | { kind: 'error'; status: number; code: ErrorCode };

export type DeleteOutcome =
  | { kind: 'accepted'; job: JobSnapshot | null }
  | { kind: 'failed'; status: number; code: ErrorCode }
  | { kind: 'not_found' }
  | { kind: 'unknown'; code: ErrorCode };

export interface MockStats {
  createRequests: number;
  newJobs: number;
  duplicateHits: number;
  acceptedBytes: number;
  deleteRequests: number;
}

export interface MockJob {
  jobId: string;
  status: JobStatus;
  revision: number;
  bytes: number;
  sha256: string;
}

export interface MockState {
  mode: string;
  stats: MockStats;
  jobs: MockJob[];
}

export type MockScenario = 'happy' | 'lost_ack' | 'stale_status' | 'delete_failure';
export const MOCK_SCENARIOS: readonly MockScenario[] = ['happy', 'lost_ack', 'stale_status', 'delete_failure'];

export interface ImportApiOptions {
  baseUrl: () => string;
  fetch: FetchLike;
  uploader: FileUploader;
  /** Per-request timeout for JSON calls. */
  requestTimeoutMs?: number;
  /** Timeout for the upload. Expiry is treated as "outcome unknown", never as failure. */
  uploadTimeoutMs?: number;
}

export class ImportApi {
  private readonly requestTimeoutMs: number;
  private readonly uploadTimeoutMs: number;

  constructor(private readonly options: ImportApiOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.uploadTimeoutMs = options.uploadTimeoutMs ?? 60_000;
  }

  private url(path: string): string {
    return `${this.options.baseUrl().replace(/\/+$/, '')}${path}`;
  }

  async createImport(input: { key: string; fileName: string; fileUri: string }): Promise<CreateOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.uploadTimeoutMs);
    let response;
    try {
      response = await this.options.uploader.upload({
        url: this.url('/imports'),
        fileUri: input.fileUri,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Idempotency-Key': input.key,
          'X-File-Name': headerSafeName(input.fileName),
        },
        signal: controller.signal,
      });
    } catch {
      return { kind: 'unknown', code: controller.signal.aborted ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 202 || response.status === 200) {
      const job = parseJob(safeJson(response.body));
      return job ? { kind: 'accepted', job } : { kind: 'unknown', code: 'bad_response' };
    }
    if (response.status >= 500) return { kind: 'unknown', code: 'server_error' };
    return { kind: 'rejected', status: response.status, code: codeForStatus(response.status) };
  }

  async lookupByKey(key: string): Promise<LookupOutcome> {
    return this.lookup(`/imports/by-key/${encodeURIComponent(key)}`);
  }

  async getJob(jobId: string): Promise<LookupOutcome> {
    return this.lookup(`/imports/${encodeURIComponent(jobId)}`);
  }

  async deleteJob(jobId: string, key: string): Promise<DeleteOutcome> {
    const result = await this.request('DELETE', `/imports/${encodeURIComponent(jobId)}`, { 'Idempotency-Key': key });
    if (result.kind === 'unreachable') return { kind: 'unknown', code: result.code };
    if (result.status === 202 || result.status === 200) {
      return { kind: 'accepted', job: parseJob(safeJson(result.body)) };
    }
    if (result.status === 404) return { kind: 'not_found' };
    return { kind: 'failed', status: result.status, code: codeForStatus(result.status) };
  }

  // Test-control routes of the mock (diagnostics screen only).

  async health(): Promise<boolean> {
    const result = await this.request('GET', '/health');
    return result.kind === 'response' && result.status === 200;
  }

  async mockState(): Promise<MockState | null> {
    const result = await this.request('GET', '/__test/state');
    if (result.kind !== 'response' || result.status !== 200) return null;
    return parseMockState(safeJson(result.body));
  }

  async setScenario(mode: MockScenario): Promise<boolean> {
    const result = await this.request('POST', '/__test/scenario', { 'Content-Type': 'application/json' }, JSON.stringify({ mode }));
    return result.kind === 'response' && result.status === 200;
  }

  async resetMock(): Promise<boolean> {
    const result = await this.request('POST', '/__test/reset');
    return result.kind === 'response' && result.status === 200;
  }

  private async lookup(path: string): Promise<LookupOutcome> {
    const result = await this.request('GET', path);
    if (result.kind === 'unreachable') return result;
    if (result.status === 200) {
      const job = parseJob(safeJson(result.body));
      return job ? { kind: 'found', job } : { kind: 'error', status: result.status, code: 'bad_response' };
    }
    if (result.status === 404) return { kind: 'not_found' };
    return { kind: 'error', status: result.status, code: codeForStatus(result.status) };
  }

  private async request(
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: string,
  ): Promise<{ kind: 'response'; status: number; body: string } | Unreachable> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.options.fetch(this.url(path), { method, headers, body, signal: controller.signal });
      const text = await response.text();
      return { kind: 'response', status: response.status, body: text };
    } catch {
      return { kind: 'unreachable', code: controller.signal.aborted ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
  }
}

function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'bad_request';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 413:
      return 'too_large';
    case 415:
      return 'unsupported_content';
    case 503:
      return 'server_unavailable';
    default:
      return status >= 500 ? 'server_error' : 'bad_request';
  }
}

/** HTTP header values must be Latin-1 without control characters; replace anything else. */
export function headerSafeName(name: string): string {
  const cleaned = name.replace(/[^\x20-\x7e]/g, '_').trim();
  return (cleaned.length > 0 ? cleaned : 'statement').slice(0, 255);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === 'string' && (JOB_STATUSES as readonly string[]).includes(value);
}

function parseCharge(value: unknown): RecurringCharge | null {
  if (!isRecord(value)) return null;
  const { id, merchant, amountMinor, cadence, lastSeen } = value;
  if (
    typeof id !== 'string' ||
    typeof merchant !== 'string' ||
    typeof amountMinor !== 'number' ||
    !Number.isInteger(amountMinor) ||
    typeof cadence !== 'string' ||
    typeof lastSeen !== 'string'
  ) {
    return null;
  }
  return { id, merchant, amountMinor, cadence, lastSeen };
}

/** Validates an untrusted job body. Returns null if it does not match the contract. */
export function parseJob(value: unknown): JobSnapshot | null {
  if (!isRecord(value)) return null;
  const { jobId, status, revision } = value;
  if (typeof jobId !== 'string' || !isJobStatus(status) || typeof revision !== 'number' || !Number.isInteger(revision)) {
    return null;
  }
  if (status !== 'ready') return { jobId, status, revision };
  const { currency, items } = value;
  if (typeof currency !== 'string' || !Array.isArray(items)) return null;
  const charges = items.map(parseCharge);
  if (charges.some((charge) => charge === null)) return null;
  const result: ReadyResult = { currency, items: charges.filter((charge): charge is RecurringCharge => charge !== null) };
  return { jobId, status, revision, result };
}

function parseMockState(value: unknown): MockState | null {
  if (!isRecord(value) || !isRecord(value.stats) || !Array.isArray(value.jobs) || typeof value.mode !== 'string') return null;
  const stats = value.stats;
  const number = (key: string): number => (typeof stats[key] === 'number' ? (stats[key] as number) : 0);
  const jobs: MockJob[] = [];
  for (const raw of value.jobs) {
    if (!isRecord(raw) || typeof raw.jobId !== 'string' || !isJobStatus(raw.status)) continue;
    jobs.push({
      jobId: raw.jobId,
      status: raw.status,
      revision: typeof raw.revision === 'number' ? raw.revision : 0,
      bytes: typeof raw.bytes === 'number' ? raw.bytes : 0,
      sha256: typeof raw.sha256 === 'string' ? raw.sha256 : '',
    });
  }
  return {
    mode: value.mode,
    stats: {
      createRequests: number('createRequests'),
      newJobs: number('newJobs'),
      duplicateHits: number('duplicateHits'),
      acceptedBytes: number('acceptedBytes'),
      deleteRequests: number('deleteRequests'),
    },
    jobs,
  };
}
