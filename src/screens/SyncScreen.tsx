/**
 * CLOUD SYNC.
 *
 * The old screen was a mock: it emptied the change queue, wrote "sent up" in a
 * log and nothing left the phone. This one does the work and reports exactly
 * what happened — including the part that is not built yet.
 *
 * The honest shape of it today is **one-way**. This phone's trading is copied
 * to the account, so a lost or stolen phone is no longer a lost business. What
 * it does not yet do is bring another device's work *down*; that needs a
 * reducer mirroring every mutator in the app, and a half-written one produces
 * wrong figures rather than missing ones. So the screen says "backed up", not
 * "in step", because saying the second would be a lie a shopkeeper could only
 * discover by trusting it.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useAuth } from '../data/AuthContext';
import { useToast } from '../components/Toast';
import {
  Panel, Button, SectionLabel, DetailRow, InfoBanner, Badge, ListRow, ToggleRow, ProgressBar,
} from '../components/ui';
import { Icon, IconName } from '../components/icons';
import { useGo } from '../nav/navigate';
import { plural, fmtDate } from '../data/helpers';
import * as api from '../data/authApi';
import { ensureWiring, pushQueue, serverState } from '../data/syncClient';

/* ---------------------------------------------------------------- */

type Health = 'off' | 'noAccount' | 'offline' | 'behind' | 'safe';

const LOOK: Record<Health, { tone: 'good' | 'warn' | 'danger' | 'accent'; icon: IconName; head: string }> = {
  off: { tone: 'warn', icon: 'cloud', head: 'Kept on this phone only' },
  noAccount: { tone: 'danger', icon: 'user', head: 'No account signed in' },
  offline: { tone: 'warn', icon: 'cloud', head: 'Waiting for a connection' },
  behind: { tone: 'accent', icon: 'up', head: 'Changes waiting to go up' },
  safe: { tone: 'good', icon: 'shield', head: 'Backed up to your account' },
};

/** The one card at the top that says where the books actually are. */
function StateCard({ health, note, busy }: { health: Health; note: string; busy: boolean }) {
  const { colors } = useTheme();
  const look = LOOK[health];
  const bg = look.tone === 'good' ? colors.goodSoft
    : look.tone === 'danger' ? colors.dangerSoft
      : look.tone === 'warn' ? colors.warnSoft : colors.accentSoft;
  const fg = look.tone === 'good' ? colors.good
    : look.tone === 'danger' ? colors.danger
      : look.tone === 'warn' ? colors.warn : colors.accent;

  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
      <View style={{
        backgroundColor: colors.surface, borderRadius: 18, padding: 16,
        borderWidth: 1, borderColor: colors.line,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
          <View style={{
            width: 46, height: 46, borderRadius: 15, backgroundColor: bg,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name={busy ? 'cloud' : look.icon} size={22} color={fg} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 17, color: colors.ink }}>
              {busy ? 'Sending…' : look.head}
            </Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 18, color: colors.faint, marginTop: 3 }}>
              {note}
            </Text>
          </View>
        </View>
        {busy ? <View style={{ marginTop: 13 }}><ProgressBar pct={100} /></View> : null}
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- */

export default function SyncScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const { db, setSync, logAudit, dropQueued } = useAppData();
  const { account } = useAuth();
  const { success, error } = useToast();

  const [busy, setBusy] = useState(false);
  const [access, setAccess] = useState<string | null>(null);
  const [server, setServer] = useState<{ seq: number; ops: number; lastPush: string | null } | null>(null);

  const isOwner = db?.session.role === 'owner';
  const online = db?.session.online !== false;
  const waiting = db?.queue.length || 0;
  const s = db?.sync;

  /**
   * A fresh access token, from the refresh token kept with the account.
   *
   * Access tokens last fifteen minutes, so one is fetched when the screen opens
   * rather than stored — a stale token would produce "sign in again" on a
   * button press for no reason the person could act on.
   */
  const getAccess = useCallback(async (): Promise<string | null> => {
    if (!account?.refresh) return null;
    const r = await api.refreshSession(account.refresh);
    if (!r.ok) return null;
    setAccess(r.value.access);
    return r.value.access;
  }, [account?.refresh]);

  useEffect(() => { void getAccess(); }, [getAccess]);

  // what the server actually holds, so the figure shown is not a guess
  useEffect(() => {
    (async () => {
      if (!access) return;
      const r = await serverState(access);
      if (r.ok) setServer(r.value);
    })();
  }, [access]);

  if (!db || !s) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  const health: Health = !s.on ? 'off'
    : !account ? 'noAccount'
      : !online ? 'offline'
        : waiting > 0 ? 'behind' : 'safe';

  const note = health === 'off'
    ? 'Nothing leaves this phone. If it is lost or stolen, the books go with it.'
    : health === 'noAccount'
      ? 'Sync is on but nobody is signed in, so there is no account to send anything to.'
      : health === 'offline'
        ? plural(waiting, 'change') + ' will go up as soon as there is internet.'
        : health === 'behind'
          ? plural(waiting, 'change') + ' has not been sent yet.'
          : s.lastPush
            ? 'Everything on this phone is on your account. Last sent ' + fmtDate(s.lastPush) + '.'
            : 'Everything on this phone is on your account.';

  /* ------------------------------------------------------------ */

  async function sendNow() {
    const s = db!.sync;
    if (!s.on) { error('Turn sync on first.'); return; }
    if (!account) { error('Sign in to your account first.'); return; }
    if (!online) { error('This phone has no internet right now.'); return; }

    setBusy(true);
    try {
      const token = access || await getAccess();
      if (!token) { error('Your session has expired. Sign out and in again.'); return; }

      const wiring = await ensureWiring(db!, token);
      if (!wiring.ok) { error(wiring.error.message); return; }
      setSync({ businessId: wiring.value.businessId, deviceId: wiring.value.deviceId });

      const r = await pushQueue(db!, token, wiring.value);
      if (!r.ok) { error(r.error.message); return; }

      const done = new Set(r.value.done);
      setSync({
        lastPush: new Date().toISOString(),
        lastAt: new Date().toISOString(),
        cursor: r.value.seq,
        lamport: (s.lamport || 0) + r.value.sent,
        pending: [],
        log: [
          ...(s.log || []).slice(-49),
          {
            id: 'sy_' + Date.now(), ts: new Date().toISOString(), how: 'manual',
            up: r.value.sent, down: 0,
            by: db!.users.find((u) => u.id === db!.session.userId)?.name || '',
            ok: true,
            note: r.value.sent
              ? plural(r.value.sent, 'change') + ' sent up'
              : 'Nothing was waiting',
          },
        ],
      });
      // only what the server confirmed is dropped from the queue
      dropQueued([...done]);

      const st = await serverState(token);
      if (st.ok) { setServer(st.value); setSync({ serverOps: st.value.ops }); }

      logAudit('Cloud sync', plural(r.value.sent, 'change') + ' sent up');
      success(r.value.sent
        ? plural(r.value.sent, 'change') + ' sent to your account'
        : 'Nothing was waiting — everything is already up');
    } finally {
      setBusy(false);
    }
  }

  function toggle(v: boolean) {
    if (!isOwner) { Alert.alert('Owner only', 'Only the owner can turn cloud sync on or off.'); return; }
    if (!v) { setSync({ on: false }); return; }
    Alert.alert(
      'Turn on cloud sync?',
      'Everything already on this phone will be sent to your account. From then on a sale '
      + 'can only be saved while the phone has internet, so nothing is recorded that your '
      + 'account does not know about.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Turn it on', onPress: () => setSync({ on: true }) },
      ],
    );
  }

  /* ------------------------------------------------------------ */

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        <StateCard health={health} note={note} busy={busy} />

        {/* the account it all hangs off */}
        <View style={{ paddingHorizontal: 16, paddingTop: 18 }}>
          <SectionLabel>The account</SectionLabel>
          <Panel flush>
            {account ? (
              <>
                <ListRow
                  icon="user"
                  title={account.email}
                  subtitle={account.localOnly
                    ? 'Made on this phone — not yet on the server'
                    : 'Signed in' + (account.method === 'google' ? ' with Google' : '')}
                  badge={<Badge tone={account.localOnly ? 'warn' : 'good'} label={account.localOnly ? 'Local' : 'Verified'} />}
                />
                <DetailRow label="Server" value={api.serverConfigured() ? 'Connected' : 'Not configured'} last />
              </>
            ) : (
              <ListRow
                icon="alert"
                tone="danger"
                title="Nobody is signed in"
                subtitle="Sync needs an account to send the books to"
                onPress={() => go('AuthGate')}
                last
              />
            )}
          </Panel>
        </View>

        {/* what is here and what is there */}
        <View style={{ paddingHorizontal: 16, paddingTop: 18 }}>
          <SectionLabel>Where things stand</SectionLabel>
          <Panel>
            <DetailRow label="Waiting on this phone" value={waiting ? plural(waiting, 'change') : 'Nothing'} />
            <DetailRow label="Held on your account" value={server ? plural(server.ops, 'record') : '—'} />
            <DetailRow label="Last sent" value={s.lastPush ? fmtDate(s.lastPush) : 'Never'} />
            <DetailRow label="This phone" value={s.deviceId ? 'Registered' : 'Not registered yet'} last />
          </Panel>
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          <Button
            label={waiting ? 'Send ' + plural(waiting, 'change') + ' now' : 'Check for anything to send'}
            variant="pri"
            loading={busy}
            disabled={!s.on || !account || !online}
            icon={<Icon name="up" size={17} color={colors.accentInk} />}
            onPress={sendNow}
          />
        </View>

        {/* settings */}
        <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
          <SectionLabel>Settings</SectionLabel>
          <Panel flush>
            <ToggleRow
              label="Keep this device synced"
              sub={isOwner
                ? 'Sends every sale to your account as it is made'
                : 'Only the owner can change this'}
              on={s.on}
              onChange={toggle}
            />
            <ToggleRow
              label="Only on Wi-Fi"
              sub="Saves mobile data on a metered connection"
              on={s.wifiOnly}
              onChange={(v) => setSync({ wifiOnly: v })}
            />
            <ListRow
              icon="cloud"
              title="Online mode"
              subtitle={s.on ? 'Every till reads the same books' : 'This device only'}
              onPress={() => go('Online')}
              last
            />
          </Panel>
        </View>

        {/* what it does and does not do */}
        <View style={{ paddingHorizontal: 16, paddingTop: 18 }}>
          <InfoBanner
            tone="neutral"
            icon="shield"
            text="Sync copies this phone's trading up to your account, so losing the phone does not lose the business. Bringing another device's work back down is not built yet — until it is, treat this as a backup rather than as two tills agreeing."
          />
        </View>

        {/* history */}
        {(s.log || []).length ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 18 }}>
            <SectionLabel>Recent</SectionLabel>
            <Panel flush>
              {[...(s.log || [])].reverse().slice(0, 6).map((l, i, a) => (
                <ListRow
                  key={l.id}
                  icon={l.ok ? 'check' : 'alert'}
                  tone={l.ok ? 'good' : 'danger'}
                  title={l.note}
                  subtitle={fmtDate(l.ts) + (l.by ? ' · ' + l.by : '')}
                  last={i === a.length - 1}
                />
              ))}
            </Panel>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
