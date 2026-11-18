import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';

import { ImportApi, type FetchLike, type MockScenario, type MockState } from '../../src/core/importApi';
import { ImportController, type ControllerTiming, type ImportView } from '../../src/core/importController';
import { createSafeLogger, type LogRecord } from '../../src/core/logger';
import { OperationStore } from '../../src/core/operationStore';
import type { FileGateway, FileUploader, HttpResult, KeyValueStore } from '../../src/core/ports';
import { systemScheduler } from '../../src/core/ports';

export const KIT_DIR = resolve(__dirname, '../../../kit');
export const FIXTURES = join(KIT_DIR, 'fixtures');

// ---- Real kit mock in a child process -------------------------------------------------------

export interface RunningMock {
  baseUrl: string;
  state(): Promise<MockState>;
  scenario(mode: MockScenario): Promise<void>;
  stop(): Promise<void>;
}

export async function startMock(): Promise<RunningMock> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'import-mock-'));
  const child: ChildProcess = spawn(process.execPath, [join(__dirname, 'start-mock.mjs'), join(dir, 'state.json')], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const port = await new Promise<number>((resolvePort, reject) => {
    let buffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const line = buffer.split('\n')[0];
      if (buffer.includes('\n')) resolvePort((JSON.parse(line) as { port: number }).port);
    });
    child.once('exit', (code) => reject(new Error(`mock exited early with ${code}`)));
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const api = new ImportApi({ baseUrl: () => baseUrl, fetch: nodeFetch, uploader: nodeUploader() });
  return {
    baseUrl,
    async state() {
      const state = await api.mockState();
      if (!state) throw new Error('mock state unavailable');
      return state;
    },
    async scenario(mode) {
      if (!(await api.setScenario(mode))) throw new Error(`could not set scenario ${mode}`);
    },
    async stop() {
      await new Promise<void>((done) => {
        child.once('exit', () => done());
        child.kill('SIGTERM');
      });
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

// ---- Node implementations of the ports ------------------------------------------------------

export const nodeFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, init);
  return { status: response.status, text: () => response.text() };
};

export interface RecordingUploader extends FileUploader {
  calls: { url: string; headers: Record<string, string>; bytes: number }[];
  /** Hook that runs right before the request leaves the client. */
  beforeSend?: (headers: Record<string, string>) => Promise<void> | void;
  /** Number of upcoming calls that fail as if the connection was refused (nothing reaches the server). */
  failNext: number;
}

/** Streams the file from disk as the raw body, like the app's native upload. */
export function nodeUploader(): RecordingUploader {
  const uploader: RecordingUploader = {
    calls: [],
    failNext: 0,
    async upload({ url, fileUri, headers, signal }): Promise<HttpResult> {
      const path = fileUri.replace(/^file:\/\//, '');
      const { size } = await fs.stat(path);
      uploader.calls.push({ url, headers, bytes: size });
      await uploader.beforeSend?.(headers);
      if (uploader.failNext > 0) {
        uploader.failNext -= 1;
        throw new TypeError('fetch failed: connect ECONNREFUSED');
      }
      const body = Readable.toWeb(createReadStream(path)) as unknown as ReadableStream<Uint8Array>;
      const response = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Length': String(size) },
        body,
        signal,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });
      return { status: response.status, body: await response.text() };
    },
  };
  return uploader;
}

/** In-memory AsyncStorage stand-in. Survives "relaunches" because tests keep the same instance. */
export class MemoryStorage implements KeyValueStore {
  readonly data = new Map<string, string>();
  async getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  async removeItem(key: string) {
    this.data.delete(key);
  }
}

/** File gateway over a temp directory that plays the role of the app cache. */
export class NodeFiles implements FileGateway {
  readonly staging: string;
  readonly pickerCache: string;

  constructor(readonly root: string) {
    this.staging = join(root, 'statement-import');
    this.pickerCache = join(root, 'DocumentPicker');
  }

  static async create(): Promise<NodeFiles> {
    const files = new NodeFiles(await fs.mkdtemp(join(tmpdir(), 'import-cache-')));
    await fs.mkdir(files.staging, { recursive: true });
    await fs.mkdir(files.pickerCache, { recursive: true });
    return files;
  }

  private path(uri: string) {
    return uri.replace(/^file:\/\//, '');
  }

  /** Simulates the system picker copying a file into the app cache. */
  async pick(source: string, name: string) {
    const target = join(this.pickerCache, `${randomUUID()}-${name}`);
    await fs.copyFile(source, target);
    return { uri: `file://${target}`, name, size: (await fs.stat(target)).size };
  }

  async size(uri: string) {
    try {
      return (await fs.stat(this.path(uri))).size;
    } catch {
      return null;
    }
  }
  readCount = 0;
  async readHead(uri: string, length: number) {
    this.readCount += 1;
    const handle = await fs.open(this.path(uri), 'r');
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      return new Uint8Array(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  }
  async sha256(uri: string) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(this.path(uri))) hash.update(chunk as Buffer);
    return hash.digest('hex');
  }
  async exists(uri: string) {
    return (await this.size(uri)) !== null;
  }
  async adopt(uri: string) {
    const target = join(this.staging, `${randomUUID()}.bin`);
    await fs.rename(this.path(uri), target);
    return `file://${target}`;
  }
  async delete(uri: string) {
    const path = this.path(uri);
    if (!path.startsWith(this.root)) throw new Error('refusing to delete outside the cache');
    await fs.rm(path, { force: true });
  }
  async sweep(keep: string | null) {
    let removed = 0;
    for (const dir of [this.staging, this.pickerCache]) {
      for (const name of await fs.readdir(dir)) {
        const uri = `file://${join(dir, name)}`;
        if (uri === keep) continue;
        await fs.rm(join(dir, name), { force: true });
        removed += 1;
      }
    }
    return removed;
  }
  async stagedFiles() {
    return [...(await fs.readdir(this.staging)), ...(await fs.readdir(this.pickerCache))];
  }
  async dispose() {
    await fs.rm(this.root, { recursive: true, force: true });
  }
}

// ---- Controller factory ---------------------------------------------------------------------

export const FAST_TIMING: ControllerTiming = {
  lookupBackoffMs: [50, 100, 200],
  pollBackoffMs: [50, 100, 150, 200],
};

export interface AppInstance {
  controller: ImportController;
  store: OperationStore;
  logs: LogRecord[];
}

const launched: ImportController[] = [];

/** Disposes every controller created by launchApp (call in afterEach). */
export function disposeAll(): void {
  while (launched.length > 0) launched.pop()?.dispose();
}

/** Builds one "app launch": a fresh store and controller over persistent storage and files. */
export function launchApp(options: {
  mock: RunningMock;
  storage: KeyValueStore;
  files: FileGateway;
  uploader: FileUploader;
  fetch?: FetchLike;
  timing?: ControllerTiming;
  logs?: LogRecord[];
}): AppInstance {
  const logs = options.logs ?? [];
  const store = new OperationStore(options.storage);
  const api = new ImportApi({
    baseUrl: () => options.mock.baseUrl,
    fetch: options.fetch ?? nodeFetch,
    uploader: options.uploader,
    requestTimeoutMs: 5000,
    uploadTimeoutMs: 10_000,
  });
  const controller = new ImportController({
    api,
    store,
    files: options.files,
    scheduler: systemScheduler,
    newKey: () => randomUUID(),
    logger: createSafeLogger((record) => logs.push(record)),
    timing: options.timing ?? FAST_TIMING,
  });
  launched.push(controller);
  return { controller, store, logs };
}

export async function waitFor(
  controller: ImportController,
  predicate: (view: ImportView) => boolean,
  timeoutMs = 8000,
): Promise<ImportView> {
  const started = Date.now();
  for (;;) {
    const view = controller.getSnapshot();
    if (predicate(view)) return view;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out waiting; last view: ${JSON.stringify(view, null, 2)}`);
    }
    await new Promise((done) => setTimeout(done, 20));
  }
}

export function opOf(view: ImportView) {
  if (view.kind !== 'operation') throw new Error(`expected operation view, got ${view.kind}`);
  return view.op;
}

export const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Same logic as kit/make-oversize.mjs, written to a temp dir so kit/ is never touched. */
export async function makeOversize(dir: string): Promise<string> {
  const header = 'date,description,amount\n';
  const row = '2026-09-01,Synthetic,-1.00\n';
  const limit = 10 * 1024 * 1024;
  const rows = Math.ceil((limit + 1 - Buffer.byteLength(header)) / Buffer.byteLength(row));
  const target = join(dir, 'oversize.csv');
  await fs.writeFile(target, Buffer.from(header + row.repeat(rows)));
  return target;
}

export function sha256File(path: string): Promise<string> {
  return new NodeFiles('/').sha256(`file://${path}`);
}
