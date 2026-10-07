/**
 * WHICH BUSINESS.
 *
 * After signing in, the owner sees the businesses on their account and picks
 * one; then the lock screen asks who is at the till, then their PIN. Before,
 * signing in went straight to whatever books happened to be on the phone, and
 * an owner with two shops had no way to reach the second one.
 *
 * Choosing a business the phone does not hold fetches the last copy of its
 * books that any phone sent up (see useSyncRun). The books already on this
 * phone are sent up first, so switching never throws away work.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { Pressable } from '../components/Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useAuth } from '../data/AuthContext';
import { ProgressBar } from '../components/ui';
import { Tap } from '../components/Tap';
import { Logo } from '../components/Logo';

import { Icon } from '../components/icons';
import { useGoReset } from '../nav/navigate';
import { listBusinesses, downloadSnapshot, setBusinessStatus, RemoteBusiness, filterVisibleBusinesses, lastAccountLicence } from '../data/syncClient';
import { EDITIONS, editionOfType, licensedEdition, editionLockReason, businessAllowance, businessLimitWords } from '../data/editions';
import { refreshSession, serverConfigured } from '../data/authApi';
import { useSyncRun } from '../data/useSyncRun';
import { fmtDate } from '../data/helpers';

/** Enough of the unique id to tell two shops with the same name apart. */
const shortId = (id: string) => 'ID ' + id.replace(/-/g, '').slice(0, 8).toUpperCase();

export default function BusinessesScreen({ route }: { route?: { params?: { stay?: boolean } } } = {}) {
  const { colors } = useTheme();
  const { db, adoptBook, startFreshBook } = useAppData();
  const { account, signOut } = useAuth();
  const goReset = useGoReset();
  const { run } = useSyncRun();

  const [list, setList] = useState<RemoteBusiness[] | null>(null);
  const [problem, setProblem] = useState('');
  // the sign-in itself has ended (signed out elsewhere, device removed): retrying cannot help
  const [ended, setEnded] = useState(false);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(0);

  /** A fresh access token, or the reason there is none, in words that say what to do. */
  const access = useCallback(async (): Promise<{ token: string } | { why: string; ended: boolean }> => {
    if (!account?.refresh) return { why: 'This phone is not signed in to an account.', ended: true };
    const r = await refreshSession(account.refresh);
    if (r.ok) return { token: r.value.access };
    const f = r.error.failure;
    if (f === 'badCredentials') return { why: 'Your sign-in on this phone has ended. Sign in again to see your businesses.', ended: true };
    if (f === 'deviceRemoved') return { why: r.error.message, ended: true };
    return { why: r.error.message, ended: false };
  }, [account?.refresh]);

  const load = useCallback(async () => {
    setProblem('');
    if (!serverConfigured() || !account || account.localOnly) { setList([]); return; }
    setEnded(false);
    const a = await access();
    if (!('token' in a)) { setProblem(a.why); setEnded(a.ended); setList([]); return; }
    const token = a.token;
    const r = await listBusinesses(token);
    if (!r.ok) { setProblem(r.error.message); setList([]); return; }
    setList(r.value);
  }, [access, account]);

  useEffect(() => { void load(); }, [load]);

  const hereId = db?.sync.businessId;
  const hasBooks = !!db?.onboarded;
  const isHere = (b: RemoteBusiness) => b.id === hereId || (!!db && (b as any).local_id === db.firm.id);
  const here = list?.find(isHere);
  const visible = list ? filterVisibleBusinesses(list, hereId, db?.firm.id) : [];
  const others = visible.filter((b) => !isHere(b));

  // A brand-new account with nothing anywhere: straight into setting up.
  useEffect(() => {
    if (list && list.length === 0 && !problem && !hasBooks && !route?.params?.stay) goReset('Onboarding');
  }, [list, problem, hasBooks, goReset]);

  /** Sends this phone's books up before they are replaced. */
  async function keepCurrent(): Promise<boolean> {
    if (!hasBooks || !db) return true;
    if (db.sync.on) {
      const r = await run('manual');
      if (r.ok) return true;
    }
    return new Promise((resolve) => Alert.alert(
      'The books on this phone are not on your account',
      '"' + db.firm.name + '" is a separate business and is not saved to your account' + (db.sync.on ? ' right now' : ', because cloud sync is off')
      + '. Nothing is merged: if you open the other business, the books of "' + db.firm.name + '" are removed from this phone and cannot be brought back.',
      [
        { text: 'Keep them', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Switch anyway', style: 'destructive', onPress: () => resolve(true) },
      ],
    ));
  }

  async function open(b: RemoteBusiness) {
    if (isHere(b)) { goReset('PinLock'); return; }
    // a business of another kind needs that edition's licence
    const allowed = licensedEdition(lastAccountLicence(), db?.licence?.licence);
    const kind = b.business_type ? editionOfType(b.business_type) : null;
    if (lastAccountLicence()?.plan && kind && kind !== allowed) {
      Alert.alert(b.name + ' is a ' + EDITIONS[kind].name.toLowerCase() + ' business', editionLockReason(allowed, kind));
      return;
    }
    setBusy(b.id);
    try {
      if (!(await keepCurrent())) return;
      const a = await access();
      if (!('token' in a)) { Alert.alert('Could not reach your account', a.why); return; }
      const token = a.token;
      setProgress(10);
      const r = await downloadSnapshot(token, b.id, setProgress);
      if (!r.ok) {
        const old = /route/i.test(r.error.message) && /not found/i.test(r.error.message);
        Alert.alert('Could not open ' + b.name, old
          ? 'The account server has not been updated to hand out saved businesses yet. Contact the developer.'
          : r.error.message);
        return;
      }
      adoptBook(r.value.data, { businessId: b.id, ownerEmail: account!.email, snapshotVersion: r.value.version });
        goReset('PinLock');
        setProgress(0);
    } finally {
      setBusy('');
    }
  }

  async function deactivate(b: RemoteBusiness) {
    const a = await access();
    if (!('token' in a)) { Alert.alert('Could not reach your account', a.why); return; }
    const token = a.token;
    setBusy('deactivate:' + b.id);
    try {
      const r = await setBusinessStatus(token, b.id, false);
      if (!r.ok) { Alert.alert('Could not deactivate ' + b.name, r.error.message); return; }
      await load();
    } finally {
      setBusy('');
    }
  }

  async function startNew() {
    // only as many businesses as the licence allows; the server refuses more too
    const room = businessAllowance(lastAccountLicence(), db);
    if (room.left <= 0) {
      Alert.alert('Business limit reached', businessLimitWords(room));
      return;
    }
    setBusy('new');
    try {
      if (!(await keepCurrent())) return;
      startFreshBook({ ownerEmail: account?.email, ownerName: account?.name });
      goReset('Onboarding');
    } finally {
      setBusy('');
    }
  }

  /* An id only earns its place when two businesses share a name. */
  const named = (b: { name: string }) => (list || []).filter((x) => x.name === b.name).length > 1;

  function more(b: RemoteBusiness) {
    Alert.alert(b.name, undefined, [
      { text: 'Open', onPress: () => void open(b) },
      {
        text: 'Deactivate', style: 'destructive',
        onPress: () => Alert.alert('Deactivate ' + b.name + '?', 'It will no longer appear on this account or open on another device.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Deactivate', style: 'destructive', onPress: () => void deactivate(b) },
        ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  /** How long ago, in a few words: 'just now', '5 min ago', '3 h ago', '2 days ago'. */
  const ago = (iso?: string | null) => {
    if (!iso) return '';
    const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' day' + (Math.round(m / 1440) === 1 ? '' : 's') + ' ago';
  };

  /** Sync on or off, at a glance, with when it last reached the account. */
  const syncPill = (on: boolean | null | undefined, when?: string | null) => (on === undefined ? null : (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: on ? colors.goodSoft : colors.sunk }}>
      <Icon name="cloud" size={12} color={on ? colors.good : colors.faint} />
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 11.5, color: on ? colors.good : colors.faint }}>{on ? 'Sync on' : 'Sync off'}{when ? ' · ' + ago(when) : ''}</Text>
    </View>
  ));

  const card = (o: { key: string; name: string; sub: string; current?: boolean; off?: boolean; loading?: boolean; onPress?: () => void; onMore?: () => void; idLine?: string; sync?: boolean | null; syncedAt?: string | null }) => (
    <Tap
      key={o.key}
      feel="soft"
      disabled={!!busy || o.off}
      onPress={o.onPress}
      accessibilityLabel={'Open ' + o.name}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, marginBottom: 10,
        backgroundColor: pressed ? colors.sunk : colors.surface,
        borderWidth: o.current ? 1.6 : 1, borderColor: o.current ? colors.accent : colors.line,
        opacity: o.off ? 0.55 : 1,
      })}
    >
      <View style={{
        width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
        backgroundColor: o.current ? colors.accent : colors.accentSoft,
      }}>
        <Text style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: o.current ? colors.accentInk : colors.accent }}>
          {(o.name.trim()[0] || '?').toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{o.name}</Text>
        <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: o.current ? colors.accent : colors.faint, marginTop: 3 }}>
          {o.sub}{o.idLine ? ' · ' + o.idLine : ''}
        </Text>
        {syncPill(o.sync, o.syncedAt)}
      </View>
      {o.loading ? <ActivityIndicator color={colors.accent} /> : o.onMore ? (
        <Pressable onPress={o.onMore} hitSlop={10} accessibilityLabel={'More for ' + o.name} style={{ padding: 4 }}>
          <Icon name="dots" size={20} color={colors.faint} />
        </Pressable>
      ) : <Icon name="chev" size={18} color={colors.faint} />}
    </Tap>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 64, paddingBottom: 40 }}>
      <View style={{ marginBottom: 18 }}><Logo size={48} /></View>
      <Text style={{ fontFamily: fonts.uiExtra, fontSize: 28, color: colors.ink, letterSpacing: -0.5 }}>Your businesses</Text>
      <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 15, color: colors.faint, marginTop: 6, marginBottom: 24 }}>
        {account?.email ? 'Signed in as ' + account.email : 'Choose the one to open'}
      </Text>

      {list === null ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <>
          {progress > 0 && progress < 100 ? (
            <View style={{ marginBottom: 16 }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink, marginBottom: 7 }}>Opening… {progress}%</Text>
              <ProgressBar pct={progress} />
            </View>
          ) : null}
          {problem ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderRadius: 14, backgroundColor: colors.dangerSoft, marginBottom: 16 }}>
              <Icon name="alert" size={17} color={colors.danger} />
              <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.danger }}>{problem}</Text>
              <Pressable onPress={() => (ended ? void signOut() : void load())} hitSlop={8}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.danger }}>{ended ? 'Sign in again' : 'Retry'}</Text>
              </Pressable>
            </View>
          ) : null}

          {hasBooks && db ? card({
            key: 'here', name: here?.name || db.firm.name, current: true,
            sub: here ? 'On this phone' : 'On this phone · not saved to your account yet',
            idLine: here && named(here) ? shortId(here.id) : undefined,
            // the books on this phone say for themselves
            sync: !!db.sync?.on,
            syncedAt: db.sync?.on ? db.sync.lastAt || null : null,
            onPress: () => goReset('PinLock'),
          }) : null}

          {others.map((b) => card({
            key: b.id, name: b.name, off: b.active === false, loading: busy === b.id,
            sub: (b.business_type ? EDITIONS[editionOfType(b.business_type)].name + ' · ' : '')
              + (b.active === false ? 'Deactivated' : b.snapshot_at ? 'Saved ' + fmtDate(b.snapshot_at) : 'Nothing saved yet'),
            idLine: named(b) ? shortId(b.id) : undefined,
            // The server says, from the last copy of the books. An older server says
            // nothing — then a saved copy is the answer: copies only go up while
            // cloud sync is on, so a business with one has been syncing.
            sync: b.active === false ? false : typeof b.sync_on === 'boolean' ? b.sync_on : !!b.snapshot_at,
            syncedAt: b.snapshot_at,
            onPress: () => void open(b),
            onMore: b.active === false ? undefined : () => more(b),
          }))}

          <Tap
            feel="soft"
            disabled={!!busy}
            onPress={() => void startNew()}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8, padding: 16,
              borderRadius: 18, borderWidth: 1.4, borderStyle: 'dashed', borderColor: colors.lineHard,
              backgroundColor: pressed ? colors.sunk : 'transparent',
            })}
          >
            {busy === 'new' ? <ActivityIndicator color={colors.accent} /> : <Icon name="plus" size={18} color={colors.accent} />}
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.accent }}>Start a new business</Text>
          </Tap>
          {lastAccountLicence() ? (
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, textAlign: 'center', marginTop: 10 }}>
              {EDITIONS[licensedEdition(lastAccountLicence(), db?.licence?.licence)].name} edition · {businessAllowance(lastAccountLicence(), db).used} of {businessAllowance(lastAccountLicence(), db).max} business{businessAllowance(lastAccountLicence(), db).max === 1 ? '' : 'es'} used
            </Text>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
