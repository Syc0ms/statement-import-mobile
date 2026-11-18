import { randomUUID } from 'expo-crypto';
import { Directory, File, FileMode, Paths } from 'expo-file-system';

import type { FileGateway } from '../core/ports';

/**
 * App-private staging for picked statements.
 *
 * - The system picker (expo-document-picker, copyToCacheDirectory: true) copies the chosen
 *   document out of the iOS security-scoped Files URL / Android content:// URI into
 *   `<cache>/DocumentPicker/`. We never keep a reference to the original URI.
 * - The copy is then moved into `<cache>/statement-import/<random>.bin`, so the original
 *   file name never appears on disk.
 * - iOS: Library/Caches of the app sandbox (not backed up, may be purged by the OS).
 *   Android: Context.getCacheDir() (internal storage, private to the app).
 */
const STAGING_DIR_NAME = 'statement-import';
const PICKER_DIR_NAME = 'DocumentPicker';

function stagingDir(): Directory {
  const dir = new Directory(Paths.cache, STAGING_DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function isInsideCache(uri: string): boolean {
  return uri.startsWith(Paths.cache.uri);
}

function randomName(): string {
  return `${randomUUID()}.bin`;
}

export const expoFiles: FileGateway = {
  async size(uri) {
    const file = new File(uri);
    if (!file.exists) return null;
    // Reads the size from file-system metadata; the content is not loaded.
    return file.size;
  },

  async readHead(uri, length) {
    const handle = new File(uri).open(FileMode.ReadOnly);
    try {
      return await handle.readBytes(length);
    } finally {
      handle.close();
    }
  },

  async sha256(uri) {
    // Hashed natively in chunks; the bytes never enter the JS heap.
    return new File(uri).digest('SHA-256');
  },

  async exists(uri) {
    return new File(uri).exists;
  },

  async adopt(uri) {
    if (!isInsideCache(uri)) throw new Error('picked file is not an app-private copy');
    const target = new File(stagingDir(), randomName());
    const source = new File(uri);
    await source.move(target);
    return target.uri;
  },

  async delete(uri) {
    if (!isInsideCache(uri)) throw new Error('refusing to delete outside the app cache');
    const file = new File(uri);
    if (file.exists) file.delete();
  },

  async sweep(keep) {
    let removed = 0;
    const dirs = [new Directory(Paths.cache, STAGING_DIR_NAME), new Directory(Paths.cache, PICKER_DIR_NAME)];
    for (const dir of dirs) {
      if (!dir.exists) continue;
      for (const entry of dir.list()) {
        if (entry.uri === keep) continue;
        entry.delete();
        removed += 1;
      }
    }
    return removed;
  },
};
