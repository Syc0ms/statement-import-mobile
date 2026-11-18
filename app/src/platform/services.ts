import { randomUUID } from 'expo-crypto';

import { ImportApi, type FetchLike } from '../core/importApi';
import { ImportController } from '../core/importController';
import { logger } from '../core/logger';
import { OperationStore } from '../core/operationStore';
import { systemScheduler } from '../core/ports';
import { expoFiles } from './expoFiles';
import { expoUploader } from './expoUploader';
import { ApiSettings, asyncStorage } from './storage';

const appFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  return { status: response.status, text: () => response.text() };
};

/** Composition root: the only place Expo implementations meet the platform-free core. */
export const settings = new ApiSettings();

export const api = new ImportApi({
  baseUrl: () => settings.baseUrl,
  fetch: appFetch,
  uploader: expoUploader,
});

export const controller = new ImportController({
  api,
  store: new OperationStore(asyncStorage),
  files: expoFiles,
  scheduler: systemScheduler,
  // Cryptographically random v4 UUID from the platform CSPRNG.
  newKey: () => randomUUID(),
  logger,
});
