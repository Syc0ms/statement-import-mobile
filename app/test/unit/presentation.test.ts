import type { Activity } from '../../src/core/importController';
import { presentOperation } from '../../src/core/presentation';
import type { ImportOperation, JobSnapshot } from '../../src/core/types';

const activity: Activity = { busy: null, nextCheckAt: null, unreachable: false, lastCheckedAt: null, foreground: true };

const readyJob: JobSnapshot = {
  jobId: 'job-demo-001',
  status: 'ready',
  revision: 3,
  result: {
    currency: 'AUD',
    items: [
      { id: 'rec-001', merchant: 'StreamBeam', amountMinor: 1999, cadence: 'monthly', lastSeen: '2026-10-01' },
      { id: 'rec-002', merchant: 'BrightGrid', amountMinor: 13200, cadence: 'monthly', lastSeen: '2026-10-03' },
    ],
  },
};

function op(patch: Partial<ImportOperation>): ImportOperation {
  return {
    schema: 1,
    idempotencyKey: '7d3f4c2e-0000-4000-8000-000000000001',
    createdAt: 0,
    updatedAt: 0,
    file: { uri: null, name: 'statement.csv', size: 112, format: 'csv', sha256: 'ab' },
    upload: { phase: 'accepted', attempts: 1 },
    job: null,
    jobMissing: false,
    deletion: null,
    history: [],
    ...patch,
  };
}

const allText = (p: ReturnType<typeof presentOperation>) =>
  [p.title, p.body, p.resultNote ?? '', ...p.steps.map((step) => `${step.label} ${step.state}`)].join(' | ');

describe('presentation honesty rules', () => {
  it('202 queued is never shown as ready and shows no result', () => {
    const p = presentOperation(op({ job: { jobId: 'job-demo-001', status: 'queued', revision: 1 } }), activity);
    expect(p.title).toBe('В очереди');
    expect(p.showResult).toBe(false);
    expect(p.steps.find((step) => step.id === 'ready')?.state).toBe('pending');
  });

  it('ready shows the result and the 151.99 AUD monthly total', () => {
    const p = presentOperation(op({ job: readyJob }), activity);
    expect(p.showResult).toBe(true);
    expect(p.body).toContain('151.99 AUD');
    expect(p.actions.map((a) => a.id)).toContain('delete');
    expect(p.actions.map((a) => a.label).join(' ').toLowerCase()).not.toMatch(/отмен|cancel|отписа/);
  });

  it('a failed delete says "not deleted", keeps the data visible and offers a retry', () => {
    const p = presentOperation(
      op({ job: readyJob, deletion: { key: 'del-key-000001', phase: 'failed', attempts: 1, lastError: 'server_unavailable' } }),
      activity,
    );
    expect(p.title).toBe('Не удалено');
    expect(p.body).toContain('503');
    expect(p.showResult).toBe(true);
    expect(p.actions[0].id).toBe('retry_delete');
    expect(allText(p)).not.toMatch(/Удалено с сервера done/);
  });

  it('a 202 delete is "deleting", never "deleted"', () => {
    const p = presentOperation(op({ job: readyJob, deletion: { key: 'del-key-000001', phase: 'accepted', attempts: 1 } }), activity);
    expect(p.title).toBe('Удаляется');
    expect(p.steps.find((step) => step.id === 'deleted')?.state).toBe('pending');
  });

  it('"deleted from server" appears only when the stored job status is deleted', () => {
    const deleted = presentOperation(
      op({ job: { jobId: 'job-demo-001', status: 'deleted', revision: 5 }, deletion: { key: 'del-key-000001', phase: 'accepted', attempts: 2 } }),
      activity,
    );
    expect(deleted.title).toBe('Удалено с сервера');
    expect(deleted.steps.find((step) => step.id === 'deleted')?.state).toBe('done');
  });

  it('unknown upload outcome offers a key lookup first and a same-key resend second', () => {
    const p = presentOperation(op({ upload: { phase: 'unknown', attempts: 1, lastError: 'network' }, file: { uri: 'file:///c/x.bin', name: 'a', size: 1, format: 'csv', sha256: 'ab' } }), activity);
    expect(p.actions.map((a) => a.id)).toEqual(['check_now', 'retry_upload']);
    expect(p.steps[0]).toMatchObject({ state: 'problem', detail: 'исход неизвестен' });
  });

  it('by-key 404 offers "retry upload" as the primary action', () => {
    const p = presentOperation(op({ upload: { phase: 'not_found', attempts: 1 }, file: { uri: 'file:///c/x.bin', name: 'a', size: 1, format: 'csv', sha256: 'ab' } }), activity);
    expect(p.actions[0]).toMatchObject({ id: 'retry_upload', variant: 'primary' });
  });

  it('notes an ignored stale status on the ready step', () => {
    const p = presentOperation(
      op({
        job: readyJob,
        history: [
          { at: 1, kind: 'server_status', status: 'ready', revision: 3 },
          { at: 2, kind: 'stale_ignored', status: 'processing', revision: 2 },
        ],
      }),
      activity,
    );
    expect(p.title).toBe('Отчёт готов');
    expect(p.steps.find((step) => step.id === 'ready')?.detail).toContain('processing/2 проигнорирован');
  });

  it('labels a job recovered by key after a lost response, not as a plain 202', () => {
    const p = presentOperation(
      op({
        job: readyJob,
        history: [
          { at: 1, kind: 'upload_started', attempt: 1 },
          { at: 2, kind: 'upload_unknown', error: 'network' },
          { at: 3, kind: 'upload_accepted' },
        ],
      }),
      activity,
    );
    expect(p.steps[0]).toMatchObject({ state: 'done', detail: 'найдено по ключу после потери ответа' });
  });
});
