import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MAX_UPLOAD_BYTES, sniffFormat, validateFile } from '../../src/core/validation';
import { FIXTURES } from '../support/harness';

const bytes = (text: string) => new Uint8Array(Buffer.from(text, 'utf8'));
const head = (path: string) => new Uint8Array(readFileSync(join(FIXTURES, path)).subarray(0, 64));

describe('content sniffing', () => {
  it('accepts the kit PDF and CSV by content', () => {
    expect(sniffFormat(head('statement.pdf'))).toBe('pdf');
    expect(sniffFormat(head('statement.csv'))).toBe('csv');
  });

  it('rejects spoofed.pdf: text with a .pdf name', () => {
    expect(sniffFormat(head('spoofed.pdf'))).toBeNull();
    const result = validateFile({ size: 84, head: head('spoofed.pdf'), name: 'spoofed.pdf' });
    expect(result).toEqual({ ok: false, rejection: { reason: 'unsupported_content', claimed: 'pdf' } });
  });

  it('ignores the extension: a real PDF named .csv is a PDF, a CSV named .pdf is a CSV', () => {
    expect(validateFile({ size: 100, head: head('statement.pdf'), name: 'x.csv' })).toEqual({ ok: true, format: 'pdf' });
    expect(validateFile({ size: 100, head: head('statement.csv'), name: 'x.pdf' })).toEqual({ ok: true, format: 'csv' });
  });

  it('handles a UTF-8 BOM and CRLF line endings in the CSV header', () => {
    expect(sniffFormat(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('date,description,amount\n')]))).toBe('csv');
    expect(sniffFormat(bytes('date,description,amount\r\n2026-10-01,X,-1'))).toBe('csv');
  });

  it('rejects near misses of the CSV header and of the PDF magic', () => {
    expect(sniffFormat(bytes('date,description,amount,extra\n'))).toBeNull();
    expect(sniffFormat(bytes('Date,Description,Amount\n'))).toBeNull();
    expect(sniffFormat(bytes('%PDF'))).toBeNull();
    expect(sniffFormat(bytes(' %PDF-1.4'))).toBeNull();
  });

  it('rejects empty files', () => {
    expect(validateFile({ size: 0, head: new Uint8Array(), name: 'a.csv' })).toEqual({ ok: false, rejection: { reason: 'empty' } });
  });
});

describe('size limit', () => {
  it('accepts exactly 10 MiB and rejects one byte more, from the size alone', () => {
    expect(validateFile({ size: MAX_UPLOAD_BYTES, head: bytes('date,description,amount\n'), name: 'a.csv' }).ok).toBe(true);
    // No head bytes are needed: an oversized file is rejected before any content is read.
    expect(validateFile({ size: MAX_UPLOAD_BYTES + 1, head: null, name: 'a.csv' })).toEqual({
      ok: false,
      rejection: { reason: 'too_large', size: MAX_UPLOAD_BYTES + 1, limit: 10 * 1024 * 1024 },
    });
  });
});
