/**
 * The phone's notification bar.
 *
 *   · Reminders — the bell's list (alerts.ts): stock to reorder, overdue
 *     bills, repeating sales due or coming up, expired quotations. Each kind
 *     is one notification, replaced when its count changes and repeated at
 *     most once a day, so the bar is never a pile of the same thing.
 *   · News — adverts the developer console marked "send to phones"
 *     (server/src/admin.js). Each is shown once on this phone.
 *   · The app update, once it has downloaded (appUpdate.ts).
 *
 * The app checks when it opens and comes back to the front (NotifyKeeper),
 * and Android wakes it about every hour in the background to check again
 * (the task below), so a reminder arrives even when nobody opened the app.
 * Everything here is a local notification: no push service is involved, the
 * phone asks the server for adverts itself.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { alertsOf, type Alert } from './alerts';
import { stockOfImpl } from './logic';
import { SERVER_URL, refreshSession } from './authApi';
import { loadAccount } from './account';

const SHOWN_KEY = 'notify.shown';
const ADS_KEY = 'notify.ads';
const TASK = 'genius-notify-check';
export const CHANNEL_REMINDERS = 'reminders';
export const CHANNEL_NEWS = 'news';
export const CHANNEL_UPDATES = 'updates';

let ready: Promise<boolean> | null = null;

/** Channels, how a notification shows while the app is open, and permission (asked once). */
export function setupNotifications(): Promise<boolean> {
  if (ready) return ready;
  ready = (async () => {
    if (Platform.OS !== 'android') return false;
    try {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
      });
      await Notifications.setNotificationChannelAsync(CHANNEL_REMINDERS, { name: 'Reminders', description: 'Stock to reorder, overdue bills, repeating sales, expired quotations', importance: Notifications.AndroidImportance.DEFAULT });
      await Notifications.setNotificationChannelAsync(CHANNEL_NEWS, { name: 'News and offers', description: 'Offers and news from Genius POS', importance: Notifications.AndroidImportance.DEFAULT });
      await Notifications.setNotificationChannelAsync(CHANNEL_UPDATES, { name: 'App updates', importance: Notifications.AndroidImportance.HIGH });
      const now = await Notifications.getPermissionsAsync();
      if (now.granted) return true;
      if (!now.canAskAgain) return false;
      return (await Notifications.requestPermissionsAsync()).granted;
    } catch {
      return false;
    }
  })();
  return ready;
}

async function readMap(key: string): Promise<Record<string, string>> {
  try { return JSON.parse((await AsyncStorage.getItem(key)) || '{}') || {}; } catch { return {}; }
}

/** Puts something in the bar now. The same `id` replaces what is there. */
export async function showNow(id: string, title: string, body: string, data: Record<string, unknown>, channelId: string): Promise<void> {
  if (!(await setupNotifications())) return;
  await Notifications.scheduleNotificationAsync({ identifier: id, content: { title, body, data }, trigger: { channelId } }).catch(() => {});
}

/** The bell's list in the bar: new or changed alerts, each kind at most once a day. */
export async function notifyAlerts(alerts: Alert[], business: string, now = new Date()): Promise<void> {
  const shown = await readMap(SHOWN_KEY);
  const today = now.toISOString().slice(0, 10);
  const next: Record<string, string> = {};
  for (const a of alerts) {
    // shown as "YYYY-MM-DD:count"; again only on a new day, or when more have come up today
    const [was, n] = (shown[a.key] || ':').split(':');
    if (was === today && a.count <= Number(n)) { next[a.key] = shown[a.key]; continue; }
    await showNow('alert-' + a.key, a.title, a.sub + (business ? ' · ' + business : ''), { route: a.route }, CHANNEL_REMINDERS);
    next[a.key] = today + ':' + a.count;
  }
  // an alert that has cleared is taken out of the bar
  for (const k of Object.keys(shown)) {
    if (!alerts.some((a) => a.key === k)) await Notifications.dismissNotificationAsync('alert-' + k).catch(() => {});
  }
  await AsyncStorage.setItem(SHOWN_KEY, JSON.stringify(next)).catch(() => {});
}

type Advert = { id: number; title: string; body?: string | null; link_url?: string | null; push?: boolean };

/** Adverts sent to phones: each shown once. `refresh` is the account's refresh token. */
export async function notifyAdverts(refresh: string | undefined): Promise<void> {
  if (!refresh) return;
  try {
    const s = await refreshSession(refresh);
    if (!s.ok) return;
    const res = await fetch(SERVER_URL + '/v1/adverts', { headers: { authorization: 'Bearer ' + s.value.access } });
    if (!res.ok) return;
    const ads = (((await res.json()) as { adverts?: Advert[] }).adverts || []).filter((a) => a.push);
    if (!ads.length) return;
    const seen = await readMap(ADS_KEY);
    for (const a of ads) {
      if (seen[a.id]) continue;
      await showNow('ad-' + a.id, a.title, a.body || '', { link: a.link_url || '', advert: a.id }, CHANNEL_NEWS);
      seen[a.id] = new Date().toISOString();
    }
    await AsyncStorage.setItem(ADS_KEY, JSON.stringify(seen)).catch(() => {});
  } catch { /* offline: next time */ }
}

/* ── in the background ───────────────────────────────────────────────────
   Android runs this about once an hour (it decides exactly when, and waits
   for the battery to allow it). The book is read from the phone's own store;
   nothing is changed. */
TaskManager.defineTask(TASK, async () => {
  try {
    const { loadDB } = await import('./storage');
    const db = await loadDB();
    if (db) await notifyAlerts(alertsOf(db, (p) => stockOfImpl(p)), db.firm?.name || '');
    const account = await loadAccount();
    if (account && !account.localOnly) await notifyAdverts(account.refresh);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Asks Android to wake the app now and then to check (once is enough; it is remembered). */
export async function startBackgroundChecks(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (!(await TaskManager.isTaskRegisteredAsync(TASK))) await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 60 });
  } catch { /* not available on this phone */ }
}
