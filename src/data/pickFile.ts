/**
 * Choosing a file the app can then read. The file system's own picker hands
 * back the file with Android's permission to read it attached; a copy in the
 * document picker's cache can sit where the app is not allowed to read
 * ("missing read permission"), so that one is only the fallback.
 */
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

export async function pickReadableFile(mimeTypes?: string[]): Promise<{ file: File; name: string } | null> {
  try {
    const pick = await File.pickFileAsync(mimeTypes ? { mimeTypes } as any : undefined);
    if (pick.canceled || !pick.result) return null;
    return { file: pick.result, name: pick.result.name };
  } catch {
    const pick = await DocumentPicker.getDocumentAsync({ type: mimeTypes || '*/*', copyToCacheDirectory: true, multiple: false });
    if (pick.canceled || !pick.assets?.[0]) return null;
    return { file: new File(pick.assets[0].uri), name: pick.assets[0].name || '' };
  }
}
