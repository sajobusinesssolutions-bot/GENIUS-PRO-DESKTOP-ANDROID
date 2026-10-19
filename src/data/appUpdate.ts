/**
 * Updates for the APK handed out from saljoetech.tech (not the Play build —
 * Play forbids an app installing updates of itself, and updates it anyway).
 *
 * The API names the newest build (server/src/updates.js):
 *
 *   { "versionCode": 6, "versionName": "1.5.1",
 *     "url": "/v1/app/apk/genius-pro-1.5.1-6.apk", "size": 48000000, "notes": "Faster reports" }
 *
 * Both the check and the download need a signed-in account: the APK is not on
 * the website, so it cannot be fetched by anyone or hammered to load the server.
 *
 * The app reads it at launch and every few hours. A newer build is downloaded
 * in the background on Wi-Fi (on mobile data it waits to be asked, since the
 * APK is large), then the person is offered "Install". Android always asks
 * them to confirm, and only installs it if it is signed with the same key as
 * the app already on the phone — so a tampered file cannot replace it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import NetInfo from '@react-native-community/netinfo';
import { Directory, File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { PLAY_BUILD } from './store';
import { SERVER_URL, refreshSession } from './authApi';

export const UPDATE_PATH = '/v1/app/latest';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FLAG_GRANT_READ_URI_PERMISSION = 1;

export type UpdateInfo = { versionCode: number; versionName: string; url: string; size?: number; notes?: string };

export type UpdateState =
  | { stage: 'none' }
  | { stage: 'available'; info: UpdateInfo }
  | { stage: 'downloading'; info: UpdateInfo; progress: number }
  | { stage: 'ready'; info: UpdateInfo; file: File }
  | { stage: 'failed'; info: UpdateInfo };

export const updatesEnabled = Platform.OS === 'android' && !PLAY_BUILD && !__DEV__;

export function currentVersionCode(): number {
  return Number(Constants.expoConfig?.android?.versionCode) || 0;
}

/** Asks the server for the newest build; returns it only when it is newer than this one. */
export async function fetchUpdate(access: string): Promise<UpdateInfo | null> {
  const res = await fetch(SERVER_URL + UPDATE_PATH, { headers: { authorization: 'Bearer ' + access, 'cache-control': 'no-cache' } });
  if (!res.ok) return null;
  const info = (await res.json()) as UpdateInfo;
  if (!info || typeof info.versionCode !== 'number' || typeof info.url !== 'string' || !/^\/v1\/app\/apk\//.test(info.url)) return null;
  return info.versionCode > currentVersionCode() ? { ...info, url: SERVER_URL + info.url } : null;
}

function updatesDir(): Directory {
  const dir = new Directory(Paths.cache, 'updates');
  if (!dir.exists) dir.create();
  return dir;
}

function apkFor(info: UpdateInfo): File {
  return new File(updatesDir(), 'genius-pro-' + info.versionCode + '.apk');
}

/** Removes downloaded APKs other than `keep` (old ones, or all once installed). */
function clearOld(keep?: File) {
  try {
    for (const item of updatesDir().list()) {
      if (item instanceof File && item.uri !== keep?.uri) item.delete();
    }
  } catch { /* nothing to clear */ }
}

export async function downloadUpdate(info: UpdateInfo, access: string, onProgress?: (p: number) => void): Promise<File> {
  const target = apkFor(info);
  clearOld(target);
  // A complete earlier download is reused; a partial one is replaced.
  if (target.exists && (!info.size || target.size === info.size)) return target;
  if (target.exists) target.delete();
  const task = File.createDownloadTask(info.url, target, {
    headers: { authorization: 'Bearer ' + access },
    onProgress: ({ bytesWritten, totalBytes }) => {
      const total = totalBytes > 0 ? totalBytes : info.size;
      if (total && onProgress) onProgress(Math.min(1, bytesWritten / total));
    },
  });
  const file = await task.downloadAsync();
  if (!file) throw new Error('Download cancelled');
  if (info.size && file.size !== info.size) {
    file.delete();
    throw new Error('Download incomplete');
  }
  return file;
}

/** Hands the APK to Android's installer. If installs from this app are not yet allowed, Android asks first. */
export async function installUpdate(file: File): Promise<void> {
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: file.contentUri,
    type: 'application/vnd.android.package-archive',
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}

async function freshAccess(refresh: string | undefined): Promise<string | null> {
  if (!refresh) return null;
  const s = await refreshSession(refresh);
  return s.ok ? s.value.access : null;
}

/**
 * Checks at launch, when the app comes back after a while, and downloads on Wi-Fi.
 * `refresh` is the signed-in account's refresh token; without one (a business
 * kept only on this phone) there is no way to ask, so nothing is checked.
 */
export function useAppUpdate(refresh: string | undefined) {
  const [state, setState] = useState<UpdateState>({ stage: 'none' });
  const lastCheck = useRef(0);
  const busy = useRef(false);

  const download = useCallback(async (info: UpdateInfo) => {
    if (busy.current) return;
    busy.current = true;
    setState({ stage: 'downloading', info, progress: 0 });
    try {
      const access = await freshAccess(refresh);
      if (!access) throw new Error('Not signed in');
      const file = await downloadUpdate(info, access, (progress) => setState({ stage: 'downloading', info, progress }));
      setState({ stage: 'ready', info, file });
    } catch {
      setState({ stage: 'failed', info });
    } finally {
      busy.current = false;
    }
  }, [refresh]);

  const check = useCallback(async () => {
    if (!updatesEnabled || busy.current || !refresh) return;
    lastCheck.current = Date.now();
    try {
      const access = await freshAccess(refresh);
      if (!access) return;
      const info = await fetchUpdate(access);
      if (!info) { clearOld(); setState({ stage: 'none' }); return; }
      const file = apkFor(info);
      if (file.exists && (!info.size || file.size === info.size)) { setState({ stage: 'ready', info, file }); return; }
      const net = await NetInfo.fetch();
      if (net.type === 'wifi' || net.type === 'ethernet') await download(info);
      else setState({ stage: 'available', info });
    } catch { /* offline or server down — try again later */ }
  }, [download, refresh]);

  useEffect(() => {
    if (!updatesEnabled) return;
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && Date.now() - lastCheck.current > CHECK_EVERY_MS) check();
    });
    return () => sub.remove();
  }, [check]);

  const install = useCallback(async () => {
    if (state.stage === 'ready') await installUpdate(state.file).catch(() => setState({ stage: 'failed', info: state.info }));
  }, [state]);

  return { state, download, install };
}
