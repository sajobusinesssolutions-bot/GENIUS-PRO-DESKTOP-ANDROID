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
  const { db, setSync, licFeature } = useAppData();
  const { account } = useAuth();
  const { success, error } = useToast();
  const { run } = useSyncRun();
  const [busy, setBusy] = useState(false);

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
    offline: plural(waiting, 'change') + ' will go up by themselves as soon as there is internet.',
    behind: plural(waiting, 'change') + ' waiting. They go up by themselves every few minutes.',
    safe: s.lastPush ? 'Syncing by itself. Last sent ' + fmtDate(s.lastPush) + '.' : 'Syncing by itself.',
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
      label={!s.on ? 'Sync — and keep syncing' : waiting ? 'Sync ' + plural(waiting, 'change') + ' now' : 'Sync now'}
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
