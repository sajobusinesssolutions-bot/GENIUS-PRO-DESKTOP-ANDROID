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
import { View, Text, Alert, ActivityIndicator } from 'react-native';
import ScrollView from '../components/KeyScroll';
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
import { EDITIONS, editionOfType, licensedEdition, licensedEditions, editionLockReason, businessAllowance, businessLimitWords } from '../data/editions';
import { refreshSession, serverConfigured } from '../data/authApi';
import { useSyncRun } from '../data/useSyncRun';
import { fmtDate } from '../data/helpers';
import { parkBook, listParked, readParked, forgetParked, ParkedBook } from '../data/parkedBooks';
import { businessExtras, renameBusiness, BusinessExtra } from '../data/businessExtra';
import Sheet from '../components/Sheet';
import { Field } from '../components/form';
import { Button } from '../components/ui';

/** Enough of the unique id to tell two shops with the same name apart. */
const shortId = (id: string) => 'ID ' + id.replace(/-/g, '').slice(0, 8).toUpperCase();

export default function BusinessesScreen({ route }: { route?: { params?: { stay?: boolean } } } = {}) {
  const { colors } = useTheme();
  const { db, adoptBook, startFreshBook, restoreBackup } = useAppData();
  const { account, signOut } = useAuth();
  const goReset = useGoReset();
  const { run } = useSyncRun();

  const [list, setList] = useState<RemoteBusiness[] | null>(null);
  const [problem, setProblem] = useState('');
  // the sign-in itself has ended (signed out elsewhere, device removed): retrying cannot help
  const [ended, setEnded] = useState(false);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(0);
  /** Businesses whose books were kept on this phone when another was opened. */
  const [parked, setParked] = useState<ParkedBook[]>(() => listParked());
  const [extra, setExtra] = useState<Record<string, BusinessExtra>>({});
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

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
    setExtra(await businessExtras(token));
    setParked(listParked());
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

  /** Puts the open business away in its own book on this phone before another is opened. */
  async function keepCurrent(): Promise<boolean> {
    if (!hasBooks || !db) return true;
    // send what it has up while there is a connection; the book stays here either way
    if (db.sync.on) { try { await run('manual'); } catch { /* offline: kept below */ } }
    let kept = false;
    try { kept = !!(await parkBook(db)); } catch { kept = false; }
    if (kept || (db.sync.on && !(db.queue || []).length && db.sync.businessId)) return true;
    return new Promise((resolve) => Alert.alert(
      '"' + db.firm.name + '" could not be kept on this phone',
      'It is not on your account either. If you open another business, its books are removed and cannot be brought back.',
      [
        { text: 'Stay here', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Switch anyway', style: 'destructive', onPress: () => resolve(true) },
      ],
    ));
  }

  /* books on this phone that are on no account list: made here, never synced */
  const onlyHere = parked.filter((p) => p.id !== (db?.firm.id || '').replace(/[^A-Za-z0-9_-]/g, '_') && !(list || []).some((b) => b.id === p.businessId));

  /** This business's own book on this phone, if it has one. */
  const bookHere = (b: RemoteBusiness) => listParked().find((p) => p.businessId === b.id);

  async function open(b: RemoteBusiness) {
    if (isHere(b)) { goReset('PinLock'); return; }
    // a business of another kind needs that edition's licence
    const allowed = licensedEditions(lastAccountLicence(), db?.licence?.licence);
    const kind = b.business_type ? editionOfType(b.business_type) : null;
    if (lastAccountLicence()?.plan && kind && !allowed.includes(kind)) {
      Alert.alert(b.name + ' is a ' + EDITIONS[kind].name.toLowerCase() + ' business', editionLockReason(allowed, kind));
      return;
    }
    setBusy(b.id);
    try {
      if (!(await keepCurrent())) return;
      // its own book is on this phone: open that, and sync brings it up to date
      const mine = bookHere(b);
      if (mine) {
        try {
          restoreBackup(await readParked(mine.id));
          forgetParked(mine.id);
          goReset('PinLock');
          return;
        } catch { /* unreadable: fetch it from the account below */ }
      }
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
    let room = businessAllowance(lastAccountLicence(), db);
    /* At the limit, ask the server again first: a limit raised since the list
       was read (a quote, Developer → licence) counts at once. */
    if (room.left <= 0) {
      const a = await access();
      if ('token' in a) { await listBusinesses(a.token); room = businessAllowance(lastAccountLicence(), db); }
    }
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

  /** Vouchers recorded in the last seven days in the books on this phone. */
  const localWeek = () => {
    if (!db) return 0;
    const since = Date.now() - 7 * 864e5;
    const n = (xs: Array<{ ts: string }>) => xs.filter((x) => new Date(x.ts).getTime() >= since).length;
    return n(db.sales) + n(db.purchases) + n(db.payments) + n(db.entries) + n(db.creditNotes || []);
  };

  function details(b: { name: string; id?: string; created?: string | null; type?: string | null; saved?: string | null; sync?: boolean | null; week?: number }) {
    Alert.alert(b.name, [
      b.type ? 'Kind: ' + b.type : '',
      b.created ? 'Created: ' + fmtDate(b.created) : '',
      'Vouchers this week: ' + (b.week ?? '—'),
      b.saved ? 'Last saved to your account: ' + fmtDate(b.saved) : 'Not saved to your account yet',
      'Cloud sync: ' + (b.sync ? 'on' : 'off'),
      b.id ? shortId(b.id) : '',
    ].filter(Boolean).join('\n'));
  }

  async function saveName() {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) return;
    const a = await access();
    if (!('token' in a)) { Alert.alert('Could not reach your account', a.why); return; }
    const r = await renameBusiness(a.token, renaming.id, name);
    if (!r.ok) { Alert.alert('Not renamed', r.why); return; }
    setRenaming(null);
    await load();
  }

  async function restoreKept(p: ParkedBook) {
    setBusy('restore:' + p.id);
    try {
      if (!(await keepCurrent())) return;
      const book = await readParked(p.id);
      restoreBackup(book);
      forgetParked(p.id);
      goReset('PinLock');
    } catch (e: any) {
      Alert.alert('Could not restore ' + p.name, e?.message || 'The kept copy could not be read.');
    } finally {
      setBusy('');
    }
  }

  function more(b: RemoteBusiness) {
    const kind = b.business_type ? EDITIONS[editionOfType(b.business_type)].name : null;
    Alert.alert(b.name, undefined, [
      { text: 'View business details', onPress: () => details({ name: b.name, id: b.id, created: b.created_at, type: kind, saved: b.snapshot_at, sync: b.sync_on ?? !!b.snapshot_at, week: isHere(b) ? localWeek() : extra[b.id]?.vouchersWeek }) },
      { text: 'Rename', onPress: () => setRenaming({ id: b.id, name: b.name }) },
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
        flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 4, marginBottom: 10,
        backgroundColor: pressed ? colors.sunk : colors.surface,
        borderWidth: o.current ? 1.6 : 1, borderColor: o.current ? colors.accent : colors.line,
        opacity: o.off ? 0.55 : 1,
      })}
    >
      <View style={{
        width: 46, height: 46, borderRadius: 4, alignItems: 'center', justifyContent: 'center',
        backgroundColor: o.current ? colors.accent : colors.accentSoft,
      }}>
        <Text style={{ fontFamily: fonts.uiExtra, fontSize: 18, color: o.current ? colors.accentInk : colors.accent }}>
          {(o.name.trim()[0] || '?').toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.ink }}>{o.name}</Text>
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
      <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 14, color: colors.faint, marginTop: 6, marginBottom: 24 }}>
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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderRadius: 4, backgroundColor: colors.dangerSoft, marginBottom: 16 }}>
              <Icon name="alert" size={17} color={colors.danger} />
              <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.danger }}>{problem}</Text>
              <Pressable onPress={() => (ended ? void signOut() : void load())} hitSlop={8}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.danger }}>{ended ? 'Sign in again' : 'Retry'}</Text>
              </Pressable>
            </View>
          ) : null}

          {hasBooks && db ? card({
            key: 'here', name: here?.name || db.firm.name, current: true,
            sub: (here ? 'On this phone' : 'On this phone · not saved to your account yet') + ' · ' + localWeek() + ' vouchers this week'
              + (here?.created_at ? ' · since ' + fmtDate(here.created_at) : ''),
            onMore: here ? () => more(here) : () => details({ name: db.firm.name, week: localWeek(), sync: !!db.sync?.on }),
            idLine: here && named(here) ? shortId(here.id) : undefined,
            // the books on this phone say for themselves
            sync: !!db.sync?.on,
            syncedAt: db.sync?.on ? db.sync.lastAt || null : null,
            onPress: () => goReset('PinLock'),
          }) : null}

          {others.map((b) => card({
            key: b.id, name: b.name, off: b.active === false, loading: busy === b.id,
            sub: (b.business_type ? EDITIONS[editionOfType(b.business_type)].name + ' · ' : '')
              + (b.active === false ? 'Deactivated' : (parked.some((p) => p.businessId === b.id) ? 'On this phone · ' : '') + (extra[b.id] ? extra[b.id].vouchersWeek + ' vouchers this week · ' : '') + 'created ' + fmtDate(b.created_at)),
            idLine: named(b) ? shortId(b.id) : undefined,
            // The server says, from the last copy of the books. An older server says
            // nothing — then a saved copy is the answer: copies only go up while
            // cloud sync is on, so a business with one has been syncing.
            sync: b.active === false ? false : typeof b.sync_on === 'boolean' ? b.sync_on : !!b.snapshot_at,
            syncedAt: b.snapshot_at,
            onPress: () => void open(b),
            onMore: b.active === false ? undefined : () => more(b),
          }))}

          {onlyHere.length ? (
            <View style={{ marginTop: 6, marginBottom: 6 }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, letterSpacing: 0.6, color: colors.faint, marginBottom: 8 }}>ON THIS PHONE ONLY</Text>
              {onlyHere.map((p) => (
                <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 4, marginBottom: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.ink }}>{p.name}</Text>
                    <Text numberOfLines={2} style={{ fontFamily: fonts.ui, fontSize: 12, color: p.unsynced ? colors.warn : colors.faint, marginTop: 3 }}>
                      {p.sales} sales · kept {fmtDate(p.keptAt)}{p.createdAt ? ' · since ' + fmtDate(p.createdAt) : ''}{p.unsynced ? ' · not on your account' : ''}
                    </Text>
                  </View>
                  {busy === 'restore:' + p.id ? <ActivityIndicator color={colors.accent} /> : (
                    <>
                      <Pressable onPress={() => void restoreKept(p)} hitSlop={6} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4, backgroundColor: colors.accent }}>
                        <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.accentInk }}>Restore</Text>
                      </Pressable>
                      <Pressable onPress={() => Alert.alert('Remove the copy of ' + p.name + '?', p.unsynced ? 'It is not on your account: once removed, its books are gone.' : 'It is on your account too, and can still be opened from there.', [
                        { text: 'Keep', style: 'cancel' },
                        { text: 'Remove', style: 'destructive', onPress: () => { forgetParked(p.id); setParked(listParked()); } },
                      ])} hitSlop={8} style={{ padding: 4 }}>
                        <Icon name="trash" size={18} color={colors.faint} />
                      </Pressable>
                    </>
                  )}
                </View>
              ))}
            </View>
          ) : null}

          <Tap
            feel="soft"
            disabled={!!busy}
            onPress={() => void startNew()}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8, padding: 16,
              borderRadius: 4, borderWidth: 1.4, borderStyle: 'dashed', borderColor: colors.lineHard,
              backgroundColor: pressed ? colors.sunk : 'transparent',
            })}
          >
            {busy === 'new' ? <ActivityIndicator color={colors.accent} /> : <Icon name="plus" size={18} color={colors.accent} />}
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.accent }}>Start a new business</Text>
          </Tap>
          {lastAccountLicence() ? (
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, textAlign: 'center', marginTop: 10 }}>
              {licensedEditions(lastAccountLicence(), db?.licence?.licence).map((e) => EDITIONS[e].name).join(' + ')} edition · {businessAllowance(lastAccountLicence(), db).used} of {businessAllowance(lastAccountLicence(), db).max} business{businessAllowance(lastAccountLicence(), db).max === 1 ? '' : 'es'} used
            </Text>
          ) : null}
        </>
      )}
      <Sheet visible={!!renaming} title="Rename business" icon="pencil" onClose={() => setRenaming(null)}
        footer={<Button label="Save" variant="pri" onPress={() => void saveName()} />}>
        <Field label="Business name" value={renaming?.name || ''} onChangeText={(v) => setRenaming((r) => (r ? { ...r, name: v } : r))} autoFocus />
      </Sheet>
    </ScrollView>
  );
}
