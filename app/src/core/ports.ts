/**
 * Boundaries between the import state machine and the platform. The app wires
 * Expo implementations (src/platform); the tests wire Node implementations.
 */

/** Minimal async key-value storage (AsyncStorage in the app). */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** App-private staging area for file copies. */
export interface FileGateway {
  /** Size in bytes from file-system metadata, without reading the content. Null if missing. */
  size(uri: string): Promise<number | null>;
  /** Reads at most `length` leading bytes. */
  readHead(uri: string, length: number): Promise<Uint8Array>;
  /** Hex SHA-256 computed outside the JS heap where the platform allows it. */
  sha256(uri: string): Promise<string>;
  exists(uri: string): Promise<boolean>;
  /** Moves a picked file into the private staging directory and returns the new URI. */
  adopt(uri: string): Promise<string>;
  /** Deletes a file, but only inside the app's own cache directories. Missing files are fine. */
  delete(uri: string): Promise<void>;
  /**
   * Removes every staged or picker-cached copy except `keep` (the copy owned by the
   * active operation). Returns how many files were removed.
   */
  sweep(keep: string | null): Promise<number>;
}

export interface HttpResult {
  status: number;
  body: string;
}

/** Sends the bytes of a local file as the raw request body. */
export interface FileUploader {
  upload(request: {
    url: string;
    fileUri: string;
    headers: Record<string, string>;
    signal: AbortSignal;
  }): Promise<HttpResult>;
}

export interface Scheduler {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
