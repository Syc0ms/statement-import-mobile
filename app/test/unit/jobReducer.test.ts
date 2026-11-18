import { reduceJob } from '../../src/core/jobReducer';
import type { JobSnapshot } from '../../src/core/types';

const ready: JobSnapshot = {
  jobId: 'job-demo-001',
  status: 'ready',
  revision: 3,
  result: {
    currency: 'AUD',
    items: [{ id: 'rec-001', merchant: 'StreamBeam', amountMinor: 1999, cadence: 'monthly', lastSeen: '2026-10-01' }],
  },
};
const queued: JobSnapshot = { jobId: 'job-demo-001', status: 'queued', revision: 1 };
const processing: JobSnapshot = { jobId: 'job-demo-001', status: 'processing', revision: 2 };
const deleting: JobSnapshot = { jobId: 'job-demo-001', status: 'deleting', revision: 4 };
const deleted: JobSnapshot = { jobId: 'job-demo-001', status: 'deleted', revision: 5 };

describe('reduceJob (revision rule)', () => {
  it('applies the first snapshot', () => {
    expect(reduceJob(null, queued)).toEqual({ applied: true, job: queued });
  });

  it('applies strictly newer revisions in order', () => {
    let job = reduceJob(null, queued).job;
    job = reduceJob(job, processing).job;
    job = reduceJob(job, ready).job;
    expect(job).toEqual(ready);
  });

  it('keeps ready/3 when processing/2 arrives late (stale_status)', () => {
    const outcome = reduceJob(ready, processing);
    expect(outcome).toEqual({ applied: false, job: ready, reason: 'stale' });
  });

  it('ignores an equal revision', () => {
    expect(reduceJob(ready, { ...ready }).applied).toBe(false);
  });

  it('treats deleting/4 and deleted/5 as later states and keeps the ready result while deleting', () => {
    const afterDeleting = reduceJob(ready, deleting);
    expect(afterDeleting.applied).toBe(true);
    expect(afterDeleting.job?.status).toBe('deleting');
    expect(afterDeleting.job?.result).toEqual(ready.result);
    const afterDeleted = reduceJob(afterDeleting.job, deleted);
    expect(afterDeleted.job?.status).toBe('deleted');
  });

  it('never resurrects a deleted job, whatever arrives later', () => {
    for (const late of [queued, processing, ready, deleting, { ...ready, revision: 99 }]) {
      const outcome = reduceJob(deleted, late);
      expect(outcome.applied).toBe(false);
      expect(outcome.job).toEqual(deleted);
    }
  });

  it('ignores snapshots of another job', () => {
    const outcome = reduceJob(ready, { ...deleted, jobId: 'job-demo-002' });
    expect(outcome).toEqual({ applied: false, job: ready, reason: 'foreign' });
  });

  it('does not mutate its inputs', () => {
    const current = Object.freeze({ ...ready });
    const incoming = Object.freeze({ ...deleting });
    expect(() => reduceJob(current, incoming)).not.toThrow();
  });
});
