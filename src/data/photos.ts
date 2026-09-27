import { Directory, File, Paths } from 'expo-file-system';

/**
 * Where picked photographs live.
 *
 * The image picker and the camera both hand back a URI inside the cache
 * directory, which the operating system is free to empty whenever the phone
 * runs low on storage. Saving that URI on the product means the picture
 * quietly turns into a broken image some weeks later. Everything the user
 * attaches is therefore copied into the document directory, which is only
 * cleared when the app is uninstalled.
 */
const FOLDER = 'photos';

function folder(): Directory {
  const dir = new Directory(Paths.document, FOLDER);
  // idempotent, so two pickers finishing at once cannot race each other
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function extensionOf(uri: string): string {
  const clean = uri.split('?')[0].split('#')[0];
  const dot = clean.lastIndexOf('.');
  const ext = dot > -1 ? clean.slice(dot).toLowerCase() : '';
  return /^\.(jpg|jpeg|png|webp|heic|gif)$/.test(ext) ? ext : '.jpg';
}

/**
 * Copies a picked image into permanent storage and returns the new URI.
 *
 * On any failure the original URI is returned rather than nothing at all: a
 * picture that may not survive is still better than losing the user's pick,
 * and the form stays usable.
 */
export async function keepPhoto(uri: string, prefix = 'img'): Promise<string> {
  if (!uri) return uri;
  try {
    if (uri.startsWith(Paths.document.uri)) return uri; // already ours
    const name = prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + extensionOf(uri);
    const dest = new File(folder(), name);
    // copy() is async on SDK 57; returning before it finished pointed at a file that might never arrive
    await new File(uri).copy(dest);
    return dest.exists ? dest.uri : uri;
  } catch {
    return uri;
  }
}

/** Removes a photograph this app owns. Anything else is left alone. */
export function dropPhoto(uri?: string | null): void {
  if (!uri) return;
  try {
    if (!uri.startsWith(Paths.document.uri)) return;
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // a photograph that will not delete is not worth interrupting the user for
  }
}
