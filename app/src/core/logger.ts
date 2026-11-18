/**
 * The only logger in the app. It accepts an allow-listed set of fields whose
 * values are restricted to safe shapes, and silently drops everything else.
 *
 * It never sees file bytes, file names, URIs or transaction descriptions: those
 * fields are not in the allow-list, and string values must match a strict
 * pattern (identifiers, status words), so a file name smuggled into an allowed
 * field is dropped too.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  level: LogLevel;
  event: string;
  fields: Readonly<Record<string, string | number | boolean>>;
}

export type LogSink = (record: LogRecord) => void;

type FieldRule = 'number' | 'boolean' | 'token';

const ALLOWED_FIELDS: Readonly<Record<string, FieldRule>> = {
  phase: 'token',
  status: 'token',
  revision: 'number',
  httpStatus: 'number',
  attempt: 'number',
  bytes: 'number',
  delayMs: 'number',
  format: 'token',
  error: 'token',
  reason: 'token',
  jobId: 'token',
  keySuffix: 'token',
  mode: 'token',
  count: 'number',
  foreground: 'boolean',
};

/** Lowercase identifiers such as `ready`, `job-demo-001`, `not_found`. No dots, so no file names. */
const TOKEN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const EVENT = /^[a-z][a-z0-9_.]{0,63}$/;

export function sanitizeFields(fields: Readonly<Record<string, unknown>>): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  for (const [name, value] of Object.entries(fields)) {
    const rule = ALLOWED_FIELDS[name];
    if (rule === undefined) continue;
    if (rule === 'number' && typeof value === 'number' && Number.isFinite(value)) safe[name] = value;
    if (rule === 'boolean' && typeof value === 'boolean') safe[name] = value;
    if (rule === 'token' && typeof value === 'string' && TOKEN.test(value)) safe[name] = value;
  }
  return safe;
}

export interface SafeLogger {
  log(level: LogLevel, event: string, fields?: Readonly<Record<string, unknown>>): void;
}

export function createSafeLogger(sink: LogSink): SafeLogger {
  return {
    log(level, event, fields = {}) {
      if (!EVENT.test(event)) return;
      sink({ level, event, fields: sanitizeFields(fields) });
    },
  };
}

/** Last 4 characters of a key: enough to correlate, useless to replay. */
export function keySuffix(key: string): string {
  return key.slice(-4).toLowerCase();
}

/** Default sink: development console only. Release builds log nothing. */
export const consoleSink: LogSink = (record) => {
  const isDev = (globalThis as { __DEV__?: boolean }).__DEV__ === true;
  if (!isDev) return;
  // eslint-disable-next-line no-console
  console.log(`[import] ${record.level} ${record.event}`, record.fields);
};

export const logger: SafeLogger = createSafeLogger(consoleSink);
