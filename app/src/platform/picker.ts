import * as DocumentPicker from 'expo-document-picker';

import type { PickedFile } from '../core/importController';

/**
 * Opens the system document picker (UIDocumentPickerViewController on iOS, the Storage
 * Access Framework on Android). No runtime permission is needed for either.
 *
 * The type filter only narrows what the picker offers; it is not trusted. The content is
 * validated afterwards by its leading bytes.
 */
export async function pickStatement(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'text/csv', 'text/comma-separated-values', 'application/csv'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, name: asset.name, size: asset.size ?? null };
}
