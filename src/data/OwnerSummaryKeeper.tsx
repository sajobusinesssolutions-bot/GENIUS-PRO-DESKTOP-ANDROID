/**
 * Sends the owner's daily summary at the hour set for it.
 *
 * Checks when the app opens and every five minutes after. Whichever phone is
 * open past the hour sends it, once: the day it went is written to the books
 * and synced, so the other phones see it was done. By email it goes on its
 * own; WhatsApp asks the owner (WhatsApp sends nothing without a tap).
 */
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useAppData } from './AppDataContext';
import { useAuthSafe } from './AuthContext';
import { emailToday, pastHour, summaryDue, todayKey, whatsappToday } from './ownerSummarySend';

const CHECK_MS = 5 * 60 * 1000;

export default function OwnerSummaryKeeper() {
  const app = useAppData();
  const refresh = useAuthSafe()?.account?.refresh;
  const ref = useRef({ app, refresh });
  ref.current = { app, refresh };
  const busy = useRef(false);
  // 'Later' is asked once a day, not every five minutes
  const askedOn = useRef('');

  useEffect(() => {
    const check = async () => {
      const { app: a, refresh: r } = ref.current;
      const d = a.db;
      if (!d || busy.current) return;
      const o = d.settings.ownerSummary;
      if (!o?.on || !pastHour(d)) return;
      const isOwner = d.users.find((u) => u.id === d.session.userId)?.role === 'owner';
      busy.current = true;
      try {
        // email: from whichever phone is open, once a day across them all
        if (summaryDue(d) && o.autoEmail !== false && o.email) {
          const res = await emailToday(d, a.money, r);
          if (res.ok) a.setSetting({ ownerSummarySentOn: todayKey() });
        }
        // WhatsApp needs a person: asked once a day, on the owner's phone
        if (o.askWhatsapp && o.whatsapp && isOwner && askedOn.current !== todayKey()) {
          askedOn.current = todayKey();
          await new Promise<void>((resolve) => Alert.alert("Today's summary", "Send the day's takings and financial report to WhatsApp?", [
            { text: 'Later', style: 'cancel', onPress: () => resolve() },
            { text: 'Send', onPress: () => { void whatsappToday(d, a.money); resolve(); } },
          ]));
        }
      } catch {
        // tried again on the next check; a summary must never get in the way of selling
      } finally {
        busy.current = false;
      }
    };
    const first = setTimeout(() => { void check(); }, 15000);
    const every = setInterval(() => { void check(); }, CHECK_MS);
    return () => { clearTimeout(first); clearInterval(every); };
  }, []);

  return null;
}
