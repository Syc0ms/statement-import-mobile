import type { KeyValueStore } from './ports';
import type { ImportOperation } from './types';

export const OPERATION_STORAGE_KEY = 'statement-import/operation/v1';

/**
 * Persists the single active import operation. Writes are serialised so a
 * slower earlier write can never overwrite a newer record.
 */
export class OperationStore {
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly storage: KeyValueStore) {}

  async load(): Promise<ImportOperation | null> {
    await this.chain;
    const raw = await this.storage.getItem(OPERATION_STORAGE_KEY);
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isOperation(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  save(operation: ImportOperation): Promise<void> {
    const serialised = JSON.stringify(operation);
    const next = this.chain.then(() => this.storage.setItem(OPERATION_STORAGE_KEY, serialised));
    this.chain = next.catch(() => undefined);
    return next;
  }

  clear(): Promise<void> {
    const next = this.chain.then(() => this.storage.removeItem(OPERATION_STORAGE_KEY));
    this.chain = next.catch(() => undefined);
    return next;
  }
}

function isOperation(value: unknown): value is ImportOperation {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const upload = record.upload as Record<string, unknown> | undefined;
  const file = record.file as Record<string, unknown> | undefined;
  return (
    record.schema === 1 &&
    typeof record.idempotencyKey === 'string' &&
    typeof upload === 'object' &&
    upload !== null &&
    typeof upload.phase === 'string' &&
    typeof file === 'object' &&
    file !== null &&
    typeof file.sha256 === 'string' &&
    Array.isArray(record.history)
  );
}
