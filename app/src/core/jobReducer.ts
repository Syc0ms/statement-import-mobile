import type { JobSnapshot } from './types';

export type ReduceOutcome =
  | { applied: true; job: JobSnapshot }
  | { applied: false; job: JobSnapshot | null; reason: 'stale' | 'terminal' | 'foreign' };

/**
 * The single place where server job states are merged into local state.
 *
 * Rules:
 * 1. A snapshot for another jobId is ignored (`foreign`).
 * 2. Once `deleted` is stored nothing can replace it (`terminal`), so a late
 *    response can never resurrect a deleted job.
 * 3. Otherwise a snapshot is applied only if its revision is strictly greater
 *    than the stored one (`stale` otherwise). `ready`/3 is never replaced by
 *    `processing`/2, and `deleting`/4 and `deleted`/5 are later states.
 *
 * Pure: no I/O, no clock, no mutation of the inputs.
 */
export function reduceJob(current: JobSnapshot | null, incoming: JobSnapshot): ReduceOutcome {
  if (current === null) {
    return { applied: true, job: incoming };
  }
  if (incoming.jobId !== current.jobId) {
    return { applied: false, job: current, reason: 'foreign' };
  }
  if (current.status === 'deleted') {
    return { applied: false, job: current, reason: 'terminal' };
  }
  if (incoming.revision <= current.revision) {
    return { applied: false, job: current, reason: 'stale' };
  }
  // Keep a previously received ready result if a later snapshot (deleting) has none,
  // so the UI can keep showing what the server reported while deletion is pending.
  if (incoming.result === undefined && current.result !== undefined && incoming.status === 'deleting') {
    return { applied: true, job: { ...incoming, result: current.result } };
  }
  return { applied: true, job: incoming };
}

/** Upload-side terminal: polling stops here until the user starts a deletion. */
export function isUploadTerminal(job: JobSnapshot | null): boolean {
  return job !== null && (job.status === 'ready' || job.status === 'deleted');
}
