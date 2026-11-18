import type { FileFormat } from './types';

/** 10 MiB, the same limit the mock enforces. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** How many leading bytes are read for content sniffing. Never the whole file. */
export const SNIFF_BYTES = 64;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const CSV_HEADER = 'date,description,amount';

export type Rejection =
  | { reason: 'too_large'; size: number; limit: number }
  | { reason: 'empty' }
  | { reason: 'unsupported_content'; claimed: FileFormat | null };

export type ValidationResult = { ok: true; format: FileFormat } | { ok: false; rejection: Rejection };

/** Detects the format from the leading bytes only. Extension and MIME type are ignored. */
export function sniffFormat(head: Uint8Array): FileFormat | null {
  if (head.length >= PDF_MAGIC.length && PDF_MAGIC.every((byte, index) => head[index] === byte)) {
    return 'pdf';
  }
  let offset = 0;
  // UTF-8 byte order mark.
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
    offset = 3;
  }
  const text = asciiPrefix(head.subarray(offset), CSV_HEADER.length + 2);
  // The header line must end right after the column names (LF or CRLF).
  if (text.startsWith(`${CSV_HEADER}\n`) || text.startsWith(`${CSV_HEADER}\r\n`)) {
    return 'csv';
  }
  return null;
}

function asciiPrefix(bytes: Uint8Array, length: number): string {
  let out = '';
  const end = Math.min(bytes.length, length);
  for (let index = 0; index < end; index += 1) {
    out += String.fromCharCode(bytes[index]);
  }
  return out;
}

/** What the file name claims, used only to word the error message. Never to accept a file. */
export function claimedFormat(name: string): FileFormat | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.csv')) return 'csv';
  return null;
}

/**
 * Validates a picked file from its size (file-system metadata) and its first bytes.
 * The size check runs first so an oversized file is rejected without reading it.
 */
export function validateFile(input: { size: number; head: Uint8Array | null; name: string }): ValidationResult {
  if (input.size > MAX_UPLOAD_BYTES) {
    return { ok: false, rejection: { reason: 'too_large', size: input.size, limit: MAX_UPLOAD_BYTES } };
  }
  if (input.size === 0 || input.head === null || input.head.length === 0) {
    return { ok: false, rejection: { reason: 'empty' } };
  }
  const format = sniffFormat(input.head);
  if (format === null) {
    return { ok: false, rejection: { reason: 'unsupported_content', claimed: claimedFormat(input.name) } };
  }
  return { ok: true, format };
}
