/**
 * Shared domain types. Nothing in `src/core` imports React Native or Expo, so the
 * whole state machine runs under plain Node in the tests.
 */

export type FileFormat = 'pdf' | 'csv';

/** Server job states, exactly as the mock API reports them. */
export type JobStatus = 'queued' | 'processing' | 'ready' | 'deleting' | 'deleted';

export const JOB_STATUSES: readonly JobStatus[] = [
  'queued',
  'processing',
  'ready',
  'deleting',
  'deleted',
];

export interface RecurringCharge {
  id: string;
  merchant: string;
  amountMinor: number;
  cadence: string;
  lastSeen: string;
}

export interface ReadyResult {
  currency: string;
  items: RecurringCharge[];
}

/** One authoritative server view of a job. `result` is present only when status is ready. */
export interface JobSnapshot {
  jobId: string;
  status: JobStatus;
  revision: number;
  result?: ReadyResult;
}

/**
 * Upload phase of a persisted operation.
 * - sending: key and record are persisted; the POST is in flight (or the app died while it was).
 * - unknown: the POST outcome is unknown (network error, timeout, socket closed, 5xx).
 * - not_found: a by-key lookup answered 404; the user may retry with the same key and bytes.
 * - accepted: the server acknowledged the job (202 from POST or 200 from by-key).
 * - rejected: the server refused the bytes (4xx). Terminal.
 */
export type UploadPhase = 'sending' | 'unknown' | 'not_found' | 'accepted' | 'rejected';

/**
 * Delete phase. Deletion is only ever *confirmed* by a GET that returns `deleted`
 * (stored in `job.status`), never by this phase.
 * - sending: delete key persisted; DELETE in flight.
 * - unknown: the DELETE outcome is unknown.
 * - failed: the server answered with an error (for example 503). Nothing was deleted.
 * - accepted: the server answered 202 deleting.
 */
export type DeletePhase = 'sending' | 'unknown' | 'failed' | 'accepted';

export type ErrorCode =
  | 'network'
  | 'timeout'
  | 'server_unavailable'
  | 'server_error'
  | 'conflict'
  | 'unsupported_content'
  | 'too_large'
  | 'bad_request'
  | 'not_found'
  | 'bad_response'
  | 'copy_missing'
  | 'copy_changed';

export interface StagedFile {
  /** URI of the app-private copy, or null once the copy has been removed. */
  uri: string | null;
  /** Original display name. Kept only on the device; sent once as X-File-Name. */
  name: string;
  size: number;
  format: FileFormat;
  /** Hex SHA-256 of the bytes, computed natively before the first POST. */
  sha256: string;
}

export type HistoryKind =
  | 'upload_started'
  | 'upload_unknown'
  | 'lookup_not_found'
  | 'upload_accepted'
  | 'upload_rejected'
  | 'server_status'
  | 'stale_ignored'
  | 'delete_started'
  | 'delete_failed'
  | 'delete_unknown'
  | 'delete_accepted'
  | 'job_missing';

/** Timeline entry. Contains only state metadata, never file data. */
export interface HistoryEntry {
  at: number;
  kind: HistoryKind;
  status?: JobStatus;
  revision?: number;
  attempt?: number;
  error?: ErrorCode;
}

export interface DeletionState {
  key: string;
  phase: DeletePhase;
  attempts: number;
  lastError?: ErrorCode;
}

/** The durable operation record. Persisted before the first POST and on every transition. */
export interface ImportOperation {
  schema: 1;
  idempotencyKey: string;
  createdAt: number;
  updatedAt: number;
  file: StagedFile;
  upload: {
    phase: UploadPhase;
    attempts: number;
    lastError?: ErrorCode;
  };
  /** Latest server snapshot applied through the revision reducer. */
  job: JobSnapshot | null;
  /** The server says this job does not exist (for example after a mock reset). */
  jobMissing: boolean;
  deletion: DeletionState | null;
  history: HistoryEntry[];
}
