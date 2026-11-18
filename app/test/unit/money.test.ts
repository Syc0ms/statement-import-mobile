import { formatBytes, formatIsoDate, formatMinor, monthlyTotalMinor } from '../../src/core/money';
import { parseJob } from '../../src/core/importApi';

describe('money formatting from minor units', () => {
  it('formats the fixed ready result exactly', () => {
    expect(formatMinor(1999, 'AUD')).toBe('19.99 AUD');
    expect(formatMinor(13200, 'AUD')).toBe('132.00 AUD');
    expect(formatMinor(15199, 'AUD')).toBe('151.99 AUD');
  });

  it('groups thousands, keeps cents exact and handles zero-decimal currencies', () => {
    expect(formatMinor(123456789, 'AUD')).toBe('1 234 567.89 AUD');
    expect(formatMinor(5, 'AUD')).toBe('0.05 AUD');
    expect(formatMinor(1999, 'JPY')).toBe('1 999 JPY');
  });

  it('sums the monthly total of the fixed result to 151.99 AUD', () => {
    const job = parseJob({
      jobId: 'job-demo-001',
      status: 'ready',
      revision: 3,
      currency: 'AUD',
      items: [
        { id: 'rec-001', merchant: 'StreamBeam', amountMinor: 1999, cadence: 'monthly', lastSeen: '2026-10-01' },
        { id: 'rec-002', merchant: 'BrightGrid', amountMinor: 13200, cadence: 'monthly', lastSeen: '2026-10-03' },
      ],
    });
    expect(job?.result).toBeDefined();
    expect(formatMinor(monthlyTotalMinor(job?.result?.items ?? []), 'AUD')).toBe('151.99 AUD');
  });

  it('formats dates without time-zone drift and sizes in binary units', () => {
    expect(formatIsoDate('2026-10-01')).toBe('1 окт. 2026');
    expect(formatIsoDate('not-a-date')).toBe('not-a-date');
    expect(formatBytes(112)).toBe('112 Б');
    expect(formatBytes(33882)).toBe('33.1 КБ');
    expect(formatBytes(10 * 1024 * 1024 + 1)).toBe('10.0 МБ');
  });
});

describe('parseJob (untrusted server body)', () => {
  it('rejects malformed bodies instead of guessing', () => {
    expect(parseJob(null)).toBeNull();
    expect(parseJob({ jobId: 'job-demo-001', status: 'done', revision: 3 })).toBeNull();
    expect(parseJob({ jobId: 'job-demo-001', status: 'ready', revision: '3' })).toBeNull();
    expect(parseJob({ jobId: 'job-demo-001', status: 'ready', revision: 3, currency: 'AUD', items: [{ id: 1 }] })).toBeNull();
  });

  it('returns no result for non-ready states', () => {
    expect(parseJob({ jobId: 'job-demo-001', status: 'processing', revision: 2, items: [] })).toEqual({
      jobId: 'job-demo-001',
      status: 'processing',
      revision: 2,
    });
  });
});
