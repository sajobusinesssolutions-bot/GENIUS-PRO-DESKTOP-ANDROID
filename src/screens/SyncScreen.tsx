/**
 * CLOUD SYNC.
 *
 * One card that says where the books are, and one button. The first press
 * turns sync on — from then on it runs by itself (see SyncKeeper) — and later
 * presses send whatever is waiting straight away. Everything that was here
 * before and changed nothing a shopkeeper could see (Wi-Fi only, online mode,
 * server counters, a separate on/off toggle) is gone.
 *
 * Cloud sync is a Pro feature. The licence comes from the account and only the
 * developer can grant or remove it, so a till on Starter sees why the button is
 * locked rather than a switch that silently does nothing.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Alert, Pressable } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useAuth } from '../data/AuthContext';
import { useToast } from '../components/Toast';
import { Panel, Button, SectionLabel, ListRow, ProgressBar } from '../components/ui';
import { Icon, IconName } from '../components/icons';
import { useGo } from '../nav/navigate';
import { plural, fmtDate } from '../data/helpers';
import { useSyncRun } from '../data/useSyncRun';
import { listDevices, revokeDevice } from '../data/authApi';

type Health = 'locked' | 'noAccount' | 'off' | 'offline' | 'behind' | 'safe';

const LOOK: Record<Health, { tone: 'good' | 'warn' | 'danger' | 'accent'; icon: IconName; head: string }> = {
  locked: { tone: 'warn', icon: 'lock', head: 'Cloud sync is part of Pro' },
  noAccount: { tone: 'danger', icon: 'user', head: 'No account signed in' },
  off: { tone: 'warn', icon: 'cloud', head: 'Kept on this phone only' },
  offline: { tone: 'warn', icon: 'cloud', head: 'Waiting for a connection' },
  behind: { tone: 'accent', icon: 'up', head: 'Changes waiting to go up' },
  safe: { tone: 'good', icon: 'shield', head: 'Backed up to your account' },
};

export default function SyncScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const { db, setSync, licFeature, refreshLicence } = useAppData();
  const { account } = useAuth();
  const { success, error } = useToast();
  const { run } = useSyncRun();
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<Array<{ id: string; name: string; kind: string; platform: string; created_at: string; last_seen: string }>>([]);
  const [deviceBusy, setDeviceBusy] = useState<string | null>(null);

  if (!db) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  const s = db.sync;
  const isOwner = db.session.role === 'owner';
  const online = db.session.online !== false;
  const waiting = db.queue.length;
  const pro = licFeature('sync');
  const signedIn = !!account && !account.localOnly;

  const health: Health = !pro ? 'locked'
    : !signedIn ? 'noAccount'
      : !s.on ? 'off'
        : !online ? 'offline'
          : waiting > 0 ? 'behind' : 'safe';

  const note = {
    locked: 'Your licence does not include cloud sync. The developer switches it on when you move to Pro.',
    noAccount: 'Sign in to the owner\'s account so the books have somewhere to go.',
    off: 'Nothing leaves this phone. If it is lost or stolen, the books go with it.',
    offline: plural(waiting, 'change') + ' is queued. Automatic sync will retry as soon as the connection is back.',
    behind: plural(waiting, 'change') + ' queued for automatic sync. It retries in the background and keeps the books current.',
    safe: s.lastPush ? 'Automatic sync is running. Last sent ' + fmtDate(s.lastPush) + '.' : 'Automatic sync is running.',
  }[health];

  const look = LOOK[health];
  const fg = { good: colors.good, danger: colors.danger, warn: colors.warn, accent: colors.accent }[look.tone];
  const bg = { good: colors.goodSoft, danger: colors.dangerSoft, warn: colors.warnSoft, accent: colors.accentSoft }[look.tone];

  async function syncNow() {
    if (!s.on) {
      if (!isOwner) { Alert.alert('Owner only', 'Only the owner can switch cloud sync on.'); return; }
      try { setSync({ on: true }); } catch (e: any) { error(e?.message || 'Sync could not be switched on.'); return; }
    }
    setBusy(true);
    try {
      const r = await run('manual');
      if (r.ok) success(r.message); else error(r.message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshAccountLicence() {
    const refreshToken = account?.refresh;
    if (!refreshToken) return;
    setBusy(true);
    try {
      const r = await import('../data/authApi').then((m) => m.refreshSession(refreshToken));
      if (!r.ok) { error(r.error.message); return; }
      const next = await refreshLicence(r.value.access, account.id);
      success(next === 'active' || next === 'trial' ? 'Licence refreshed.' : 'Licence refreshed: ' + next);
      await loadDevices();
    } catch (e: any) {
      error(e?.message || 'The licence could not be refreshed.');
    } finally {
      setBusy(false);
    }
  }

  async function loadDevices() {
    const refreshToken = account?.refresh;
    if (!refreshToken || !isOwner) return;
    try {
      const r = await import('../data/authApi').then((m) => m.refreshSession(refreshToken));
      if (!r.ok) { error(r.error.message); return; }
      const devicesResult = await listDevices(r.value.access);
      if (!devicesResult.ok) { error(devicesResult.error.message); return; }
      setDevices(devicesResult.value.devices || []);
    } catch (e: any) {
      error(e?.message || 'Could not load devices.');
    }
  }

  async function removeDevice(id: string, name: string) {
    const refreshToken = account?.refresh;
    if (!refreshToken) return;
    Alert.alert('Remove device?', 'This removes ' + name + ' from the account licence count.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          setDeviceBusy(id);
          try {
            const r = await import('../data/authApi').then((m) => m.refreshSession(refreshToken));
            if (!r.ok) { error(r.error.message); return; }
            const res = await revokeDevice(r.value.access, id);
            if (!res.ok) { error(res.error.message); return; }
            success('Device removed.');
            setDevices((current) => current.filter((d) => d.id !== id));
          } catch (e: any) {
            error(e?.message || 'The device could not be removed.');
          } finally {
            setDeviceBusy(null);
          }
        },
      },
    ]);
  }

  function turnOff() {
    Alert.alert(
      'Stop syncing?',
      'The books stay on this phone and nothing more goes to your account until you sync again.'
        + (waiting ? ' ' + plural(waiting, 'change') + ' not yet sent will wait here.' : ''),
      [
        { text: 'Keep syncing', style: 'cancel' },
        { text: 'Stop', style: 'destructive', onPress: () => setSync({ on: false }) },
      ],
    );
  }

  const button = !pro ? (
    <Button label="See what Pro includes" variant="pri" icon={<Icon name="lock" size={17} color={colors.accentInk} />} onPress={() => go('Licence')} />
  ) : !signedIn ? (
    <Button label="Sign in" variant="pri" icon={<Icon name="user" size={17} color={colors.accentInk} />} onPress={() => go('AuthGate')} />
  ) : (
    <Button
      label={!s.on ? 'Turn on automatic sync' : waiting ? 'Queued for auto sync' : 'Sync now'}
      variant="pri"
      loading={busy}
      disabled={busy || !online}
      icon={<Icon name="cloud" size={17} color={colors.accentInk} />}
      onPress={syncNow}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: colors.line, alignItems: 'center' }}>
          <View style={{ width: 64, height: 64, borderRadius: 22, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={busy ? 'cloud' : look.icon} size={30} color={fg} />
          </View>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 19, color: colors.ink, marginTop: 14, textAlign: 'center' }}>
            {busy ? 'Syncing…' : look.head}
          </Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, lineHeight: 20, color: colors.faint, marginTop: 6, textAlign: 'center' }}>
            {note}
          </Text>
          {busy ? <View style={{ alignSelf: 'stretch', marginTop: 14 }}><ProgressBar pct={100} /></View> : null}

          <View style={{ flexDirection: 'row', alignSelf: 'stretch', marginTop: 18, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 14 }}>
            {[
              ['Waiting', waiting ? String(waiting) : '0'],
              ['Last sent', s.lastPush ? fmtDate(s.lastPush) : 'Never'],
              ['Automatic', s.on && pro ? 'On' : 'Off'],
            ].map(([k, v], i) => (
              <View key={k} style={{ flex: 1, alignItems: 'center', borderLeftWidth: i ? 1 : 0, borderLeftColor: colors.line }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.ink }} numberOfLines={1}>{v}</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 2 }}>{k}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ marginTop: 16 }}>{button}</View>
        {pro && signedIn && s.on && isOwner ? (
          <Pressable onPress={turnOff} hitSlop={8} style={{ alignSelf: 'center', marginTop: 14 }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.faint }}>Stop syncing</Text>
          </Pressable>
        ) : null}

        {isOwner && signedIn && pro ? (
          <View style={{ marginTop: 20 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint }}>Devices on this account</Text>
              <Pressable onPress={loadDevices} hitSlop={8}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: colors.accent }}>Refresh</Text>
              </Pressable>
            </View>
            <Panel flush>
              {devices.length ? devices.map((device, index) => (
                <View key={device.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: index === devices.length - 1 ? 0 : 1, borderBottomColor: colors.line }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>{device.name || 'This phone'}</Text>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 2 }}>{device.kind || 'phone'} · {fmtDate(device.last_seen || device.created_at)}</Text>
                  </View>
                  <Button
                    size="sm"
                    label={deviceBusy === device.id ? 'Removing…' : 'Remove'}
                    variant="dngr"
                    disabled={deviceBusy !== null}
                    onPress={() => removeDevice(device.id, device.name || 'This phone')}
                  />
                </View>
              )) : (
                <View style={{ padding: 16 }}>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>No devices are registered yet.</Text>
                </View>
              )}
            </Panel>
            <View style={{ marginTop: 12 }}>
              <Button label="Refresh licence" variant="default" onPress={refreshAccountLicence} />
            </View>
          </View>
        ) : null}

        {account ? (
          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, textAlign: 'center', marginTop: 18 }}>
            {account.email}{s.businessId ? ' · business ' + s.businessId.slice(0, 8).toUpperCase() : ''}
          </Text>
        ) : null}

        {(s.log || []).length ? (
          <View style={{ marginTop: 22 }}>
            <SectionLabel>Recent</SectionLabel>
            <Panel flush>
              {[...(s.log || [])].reverse().slice(0, 5).map((l, i, a) => (
                <ListRow
                  key={l.id}
                  icon={l.ok ? 'check' : 'alert'}
                  tone={l.ok ? 'good' : 'danger'}
                  title={l.note}
                  subtitle={fmtDate(l.ts) + (l.how === 'auto' ? ' · automatic' : l.by ? ' · ' + l.by : '')}
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
