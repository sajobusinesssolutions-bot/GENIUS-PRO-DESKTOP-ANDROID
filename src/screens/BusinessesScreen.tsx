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
import { View, Text, ScrollView, Alert, ActivityIndicator, Pressable } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useAuth } from '../data/AuthContext';
import { Panel, ListRow, SectionLabel, ProgressBar, DetailRow, Badge, StatGrid } from '../components/ui';
import { Button } from '../components/ui';
import { Icon } from '../components/icons';
import { useGoReset } from '../nav/navigate';
import { listBusinesses, downloadSnapshot, setBusinessStatus, RemoteBusiness, filterVisibleBusinesses } from '../data/syncClient';
import { refreshSession, serverConfigured } from '../data/authApi';
import { useSyncRun } from '../data/useSyncRun';
import { fmtDate } from '../data/helpers';

/** Enough of the unique id to tell two shops with the same name apart. */
const shortId = (id: string) => 'ID ' + id.replace(/-/g, '').slice(0, 8).toUpperCase();
const snapshotSize = (bytes: number | null) => {
  if (!bytes) return 'No saved data';
  if (bytes < 1024) return bytes + ' B saved';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB saved';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB saved';
};

export default function BusinessesScreen() {
  const { colors } = useTheme();
  const { db, adoptBook, startFreshBook } = useAppData();
  const { account } = useAuth();
  const goReset = useGoReset();
  const { run } = useSyncRun();

  const [list, setList] = useState<RemoteBusiness[] | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(0);

  const access = useCallback(async () => {
    if (!account?.refresh) return null;
    const r = await refreshSession(account.refresh);
    return r.ok ? r.value.access : null;
  }, [account?.refresh]);

  const load = useCallback(async () => {
    setProblem('');
    if (!serverConfigured() || !account || account.localOnly) { setList([]); return; }
    const token = await access();
    if (!token) { setProblem('Could not reach your account. Check the internet and try again.'); setList([]); return; }
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
    if (list && list.length === 0 && !problem && !hasBooks) goReset('Onboarding');
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
    setBusy(b.id);
    try {
      if (!(await keepCurrent())) return;
      const token = await access();
      if (!token) { Alert.alert('Not signed in', 'Your session has expired. Sign in again.'); return; }
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
    const token = await access();
    if (!token) { Alert.alert('Not signed in', 'Your session has expired. Sign in again.'); return; }
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
    setBusy('new');
    try {
      if (!(await keepCurrent())) return;
      startFreshBook({ ownerEmail: account?.email, ownerName: account?.name });
      goReset('Onboarding');
    } finally {
      setBusy('');
    }
  }

  const row = (b: RemoteBusiness, current: boolean, i: number, n: number) => (
    <ListRow
      key={b.id}
      icon="home"
      title={b.name}
      subtitle={shortId(b.id) + ' · ' + (b.role ? b.role.toUpperCase() + ' · ' : '') + (current
        ? 'On this phone'
        : b.snapshot_at ? 'Last saved ' + fmtDate(b.snapshot_at) : 'Not saved to the account yet')}
      right={busy === b.id ? <ActivityIndicator color={colors.accent} /> : !current ? (
        <Pressable onPress={() => Alert.alert('Deactivate ' + b.name + '?', 'It will no longer appear on this account or open on another device.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Deactivate', style: 'destructive', onPress: () => void deactivate(b) },
        ])} hitSlop={8}>
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11, color: colors.danger }}>Deactivate</Text>
        </Pressable>
      ) : undefined}
      onPress={busy ? undefined : () => void open(b)}
      last={i === n - 1}
    />
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingTop: 56, paddingBottom: 40 }}>
      <View style={{ alignItems: 'center', paddingBottom: 22 }}>
        <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="home" size={30} color={colors.accent} />
        </View>
        <Text style={{ fontFamily: fonts.uiExtra, fontSize: 22, color: colors.ink, marginTop: 14 }}>Choose a business</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, color: colors.faint, marginTop: 6 }}>{account?.email || ''}</Text>
      </View>

      {list === null ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} />
      ) : (
        <>
          {progress > 0 && progress < 100 ? (
            <View style={{ marginBottom: 16 }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink, marginBottom: 7 }}>Downloading business data {progress}%</Text>
              <ProgressBar pct={progress} />
            </View>
          ) : null}
          {problem ? (
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.danger, marginBottom: 12 }}>{problem}</Text>
          ) : null}

          {hasBooks && db ? (
            <>
              <SectionLabel>On this phone</SectionLabel>
              <Panel flush>
                {here ? row(here, true, 0, 1) : (
                  <ListRow icon="home" title={db.firm.name} subtitle={(hereId ? shortId(hereId) + ' · ' : '') + 'On this phone · not on the account yet'} onPress={() => goReset('PinLock')} last />
                )}
              </Panel>
            </>
          ) : null}

          {others.length ? (
            <>
              <SectionLabel style={{ marginTop: 18 }} right={<Badge label={others.length + ' to compare'} tone="accent" />}>Compare account businesses</SectionLabel>
              <StatGrid
                items={[
                  { icon: 'home', label: 'Businesses', value: String(visible.length), tone: 'accent' },
                  { icon: 'check', label: 'Available', value: String(visible.filter((b) => b.active !== false).length), tone: 'good' },
                  { icon: 'cloud', label: 'With snapshots', value: String(visible.filter((b) => !!b.snapshot_at && Number(b.snapshot_bytes || 0) > 0).length), tone: 'warn' },
                ]}
              />
              <View style={{ height: 10 }} />
              {others.map((b, i) => (
                <Panel key={b.id} style={{ marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                    <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: b.active === false ? colors.sunk : colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="factory" size={19} color={b.active === false ? colors.faint : colors.accent} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{b.name}</Text>
                      <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 2 }}>{shortId(b.id)}</Text>
                    </View>
                    <Badge label={b.active === false ? 'Disabled' : b.role || 'Available'} tone={b.active === false ? 'neutral' : 'accent'} />
                  </View>
                  <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 11 }} />
                  <DetailRow label="Access" value={(b.role || 'available').toUpperCase()} />
                  <DetailRow label="Last saved" value={b.snapshot_at ? fmtDate(b.snapshot_at) : 'Not saved yet'} />
                  <DetailRow label="Saved data" value={snapshotSize(b.snapshot_bytes)} last />
                  <Button label="Open business" size="sm" variant="pri" onPress={() => void open(b)} loading={busy === b.id} />
                </Panel>
              ))}
            </>
          ) : null}

          <View style={{ marginTop: 22 }}>
            <Button
              label="Start a new business"
              icon={<Icon name="plus" size={17} color={colors.ink} />}
              loading={busy === 'new'}
              disabled={!!busy}
              onPress={() => void startNew()}
            />
          </View>
          {problem ? (
            <Pressable onPress={() => void load()} style={{ alignSelf: 'center', marginTop: 14 }} hitSlop={8}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 13.5, color: colors.accent }}>Try again</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
