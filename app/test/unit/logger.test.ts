import { createSafeLogger, keySuffix, type LogRecord } from '../../src/core/logger';

function capture() {
  const records: LogRecord[] = [];
  return { records, logger: createSafeLogger((record) => records.push(record)) };
}

describe('safe logger', () => {
  it('drops the file name, whatever field it is passed in', () => {
    const { records, logger } = capture();
    logger.log('info', 'upload.start', {
      fileName: 'statement.csv',
      name: 'statement.csv',
      uri: 'file:///cache/statement.csv',
      status: 'statement.csv', // allowed field, unsafe value
      phase: 'sending',
    });
    expect(records).toHaveLength(1);
    expect(records[0].fields).toEqual({ phase: 'sending' });
    expect(JSON.stringify(records)).not.toContain('statement');
  });

  it('drops transaction descriptions, raw bytes and free text', () => {
    const { records, logger } = capture();
    logger.log('warn', 'upload.unknown', {
      description: 'StreamBeam',
      body: 'date,description,amount\n2026-10-01,StreamBeam,-19.99',
      bytes: new Uint8Array([0x25, 0x50]),
      error: 'socket hang up while sending StreamBeam',
      reason: 'network',
    });
    expect(records[0].fields).toEqual({ reason: 'network' });
    expect(JSON.stringify(records)).not.toMatch(/StreamBeam|description|%P/);
  });

  it('keeps allow-listed safe values', () => {
    const { records, logger } = capture();
    logger.log('info', 'job.status', { jobId: 'job-demo-001', status: 'ready', revision: 3, foreground: true, keySuffix: keySuffix('ABCD-1234-ef09') });
    expect(records[0].fields).toEqual({ jobId: 'job-demo-001', status: 'ready', revision: 3, foreground: true, keySuffix: 'ef09' });
  });

  it('drops a record whose event name is not a plain identifier', () => {
    const { records, logger } = capture();
    logger.log('info', 'picked statement.csv from Files', {});
    expect(records).toHaveLength(0);
  });
});
