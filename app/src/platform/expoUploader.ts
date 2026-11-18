import { File, UploadType } from 'expo-file-system';

import type { FileUploader } from '../core/ports';

/**
 * Sends the staged file as the raw request body (BINARY_CONTENT). The native layer
 * streams it from disk (NSURLSession upload-from-file on iOS, OkHttp file body on
 * Android), so the up-to-10 MiB file is never loaded into JS memory.
 *
 * `foreground` session on iOS: a background session would keep sending after the app
 * is killed, which is safe with the idempotency key, but makes the "unknown" window
 * harder to reason about and does not run against plain-HTTP loopback reliably.
 */
export const expoUploader: FileUploader = {
  async upload({ url, fileUri, headers, signal }) {
    const result = await new File(fileUri).upload(url, {
      httpMethod: 'POST',
      uploadType: UploadType.BINARY_CONTENT,
      headers,
      sessionType: 'foreground',
      signal,
    });
    return { status: result.status, body: result.body };
  },
};
