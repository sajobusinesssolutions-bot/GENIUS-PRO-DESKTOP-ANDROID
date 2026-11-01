/**
 * Keeps the notification bar in step with the book (notify.ts): the bell's
 * alerts a few seconds after the book changes, adverts at launch and every
 * few hours, and a tap on a notification opening what it is about.
 */
import { useEffect, useRef } from 'react';
import { AppState, Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useAppData } from './AppDataContext';
import { useAuth } from './AuthContext';
import { alertsOf } from './alerts';
import { notifyAdverts, notifyAlerts, setupNotifications, startBackgroundChecks } from './notify';
import { navRef } from '../nav/RootNavigator';

const ADS_EVERY_MS = 3 * 60 * 60 * 1000;

function openFrom(data: Record<string, unknown> | undefined) {
  if (!data) return;
  if (typeof data.link === 'string' && data.link) { Linking.openURL(data.link).catch(() => {}); return; }
  if (typeof data.route === 'string' && data.route) {
    const go = () => { if (navRef.isReady()) navRef.navigate(data.route as never); };
    if (navRef.isReady()) go(); else setTimeout(go, 1500);
  }
}

export default function NotifyKeeper() {
  const { db, stockOf } = useAppData();
  const { account } = useAuth();
  const refresh = account && !account.localOnly ? account.refresh : undefined;
  const lastAds = useRef(0);

  useEffect(() => {
    setupNotifications().then((ok) => { if (ok) startBackgroundChecks(); });
    // a tap that started the app, then every tap while it runs
    Notifications.getLastNotificationResponseAsync().then((r) => { if (r) { openFrom(r.notification.request.content.data); Notifications.clearLastNotificationResponseAsync().catch(() => {}); } }).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener((r) => openFrom(r.notification.request.content.data));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const check = () => {
      if (Date.now() - lastAds.current < ADS_EVERY_MS) return;
      lastAds.current = Date.now();
      notifyAdverts(refresh);
    };
    check();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => sub.remove();
  }, [refresh]);

  // the alerts, once the book has been still for a few seconds
  useEffect(() => {
    if (!db) return;
    const t = setTimeout(() => { notifyAlerts(alertsOf(db, stockOf), db.firm?.name || '').catch(() => {}); }, 5000);
    return () => clearTimeout(t);
  }, [db, stockOf]);

  return null;
}
