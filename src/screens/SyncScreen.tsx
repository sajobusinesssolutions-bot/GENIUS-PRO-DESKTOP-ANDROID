/**
 * CLOUD SYNC — the connection, the queue's health, the devices on the account,
 * and the cloud copy of the books.
 *
 * Sync runs by itself once it is on (see SyncKeeper). "Back up now" sends
 * whatever is queued and then a whole copy of the books; "Load cloud backup"
 * fetches that copy so it can be checked or restored. Cloud sync is a Pro
 * feature, so a till on Starter sees why rather than a switch that does nothing.
 *
 * refreshSession() is a plain static import. It used to be reached through a
 * dynamic import(), which threw "a dynamic import callback was invoked
 * without --experimental-vm-modules" under Jest and could plausibly fail the
 * same way under the bundler.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { Pressable } from '../components/Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useAuth } from '../data/AuthContext';
import { useToast } from '../components/Toast';
import { Button } from '../components/ui';
import { Icon } from '../components/icons';
import { ToolCard, CountPill, SectionCap } from '../components/ToolCard';
import { useGo } from '../nav/navigate';
import { plural, fmtDate } from '../data/helpers';
import { useSyncRun } from '../data/useSyncRun';
import { listDevices, revokeDevice, refreshSession } from '../data/authApi';
import { downloadSnapshot } from '../data/syncClient';
import { writeBackup } from '../data/deviceBackup';
import { validateBackup } from '../data/storage';

interface Device { id: string; name: string; kind: string; platform: string; created_at: string; last_seen: string }
interface CloudCopy { version: number; updatedAt: string; data: any }

/** Failed runs since the last one that worked. */
export function failedRuns(log: { ok: boolean }[] = []): number {
  let n = 0;
  for (let i = log.length - 1; i >= 0 && !log[i].ok; i -= 1) n += 1;
  return n;
}

export default function SyncScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const { db, setSync, licFeature, refreshLicence, restoreBackup } = useAppData();
  const { account } = useAuth();
  const { success, error } = useToast();
  const { run } = useSyncRun();
  const [busy, setBusy] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [copy, setCopy] = useState<CloudCopy | null>(null);

  const isOwner = db?.session.role === 'owner';
  const signedIn = !!account && !account.localOnly;
  const pro = licFeature('sync');

  const token = useCallback(async () => {
    if (!account?.refresh) throw new Error('Sign in to your account first.');
    const r = await refreshSession(account.refresh);
    if (!r.ok) throw new Error(r.error.message);
    return r.value.access;
  }, [account?.refresh]);

  const loadDevices = useCallback(async (withLicence = false) => {
    setBusy('devices');
    try {
      const access = await token();
      const [list] = await Promise.all([
        listDevices(access),
        withLicence && account ? refreshLicence(access, account.id) : Promise.resolve(null),
      ]);
      if (!list.ok) throw new Error(list.error.message);
      setDevices(list.value.devices || []);
    } catch (e: any) {
      error(e?.message || 'Could not load the linked devices.');
    } finally {
      setBusy(null);
    }
  }, [token, account, refreshLicence, error]);

  useEffect(() => {
    if (isOwner && signedIn && pro) void loadDevices();
    // only on first open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!db) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  const s = db.sync;
  const online = db.session.online !== false;
  const pending = db.queue.length;
  const deferred = (s.pending || []).length;
  const failed = failedRuns(s.log);
  const lastFail = failed ? [...(s.log || [])].reverse().find((l) => !l.ok) : undefined;
  const max = db.licence.licence?.limits?.devices;

  async function turnOn() {
    if (!isOwner) { Alert.alert('Owner only', 'Only the owner can switch cloud sync on.'); return; }
    try { setSync({ on: true }); } catch (e: any) { error(e?.message || 'Sync could not be switched on.'); return; }
    await backUpNow();
  }

  function turnOff() {
    Alert.alert(
      'Disconnect from the cloud?',
      'The books stay on this phone and nothing more goes to your account until you connect again.'
        + (pending ? ' ' + plural(pending, 'change') + ' not yet sent will wait here.' : ''),
      [
        { text: 'Stay connected', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => setSync({ on: false }) },
      ],
    );
  }

  async function backUpNow() {
    setBusy('backup');
    try {
      const r = await run('manual');
      if (r.ok) success(r.message); else error(r.message);
    } finally {
      setBusy(null);
    }
  }

  async function loadCloudCopy() {
    if (!db) return;
    setBusy('load');
    try {
      const businessId = db.sync.businessId;
      if (!businessId) throw new Error('This shop has not been backed up to the cloud yet. Tap Back up now first.');
      const r = await downloadSnapshot(await token(), businessId);
      if (!r.ok) throw new Error(r.error.message);
      setCopy({ version: r.value.version, updatedAt: r.value.updatedAt, data: r.value.data });
    } catch (e: any) {
      error(e?.message || 'The cloud backup could not be loaded.');
    } finally {
      setBusy(null);
    }
  }

  function restoreCopy() {
    if (!copy || !db) return;
    Alert.alert(
      'Restore the cloud backup?',
      'This replaces the books on this phone with the copy from ' + fmtDate(copy.updatedAt)
        + '. An encrypted backup of the books as they are now is saved on this phone first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore', style: 'destructive',
          onPress: () => {
            try {
              const checked = validateBackup(JSON.stringify(copy.data));
              if (!checked.ok || !checked.db) throw new Error(checked.reason);
              writeBackup(db, false);
              restoreBackup(checked.db);
              setCopy(null);
              success('Cloud backup restored');
            } catch (e: any) {
              error(e?.message || 'The cloud backup could not be restored.');
            }
          },
        },
      ],
    );
  }

  function removeDevice(d: Device) {
    Alert.alert('Remove ' + (d.name || 'this device') + '?', 'It is signed out of the account and frees a place on the licence.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          setBusy('dev:' + d.id);
          try {
            const res = await revokeDevice(await token(), d.id);
            if (!res.ok) throw new Error(res.error.message);
            setDevices((cur) => (cur || []).filter((x) => x.id !== d.id));
            success('Device removed');
          } catch (e: any) {
            error(e?.message || 'The device could not be removed.');
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  /* ---- not ready: Pro, account, switched off ---- */
  if (!pro || !signedIn) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
        <ToolCard
          icon={!pro ? 'lock' : 'user'} tone="warn"
          title={!pro ? 'Cloud sync is part of Pro' : 'No account signed in'}
          sub={!pro ? 'Your licence does not include cloud sync.' : 'Sign in so the books have somewhere to go.'}
        >
          <Button
            variant="pri"
            label={!pro ? 'See plans and licence' : 'Sign in'}
            onPress={() => go(!pro ? 'Plans' : 'AuthGate')}
          />
        </ToolCard>
      </ScrollView>
    );
  }

  const connected = s.on && online;
  const head = !s.on ? 'Cloud sync is off' : !online ? 'Waiting for a connection' : 'Connected to the cloud';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <ToolCard
        icon="cloud"
        tone={connected ? 'good' : 'warn'}
        title={head}
        titleColor={connected ? colors.good : undefined}
        sub={s.lastPush ? 'Last sent ' + fmtDate(s.lastPush) : account?.email}
        border={connected ? colors.good : undefined}
        action={s.on && isOwner ? { icon: 'x', label: 'Disconnect', onPress: turnOff } : undefined}
      >
        {!s.on ? (
          <Button variant="pri" label="Connect and back up" loading={busy === 'backup'} icon={<Icon name="cloud" size={17} color={colors.accentInk} />} onPress={turnOn} />
        ) : null}
      </ToolCard>

      {s.on ? (
        <ToolCard
          icon="shield" tone={failed ? 'danger' : 'good'} title="Queue health"
          border={failed ? colors.danger : colors.good}
          action={{ icon: 'swap', label: 'Sync the queue now', onPress: backUpNow, busy: busy === 'backup' }}
        >
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <CountPill label="Pending" n={pending} tone="accent" />
            <CountPill label="Deferred" n={deferred} tone="warn" />
            <CountPill label="Failed" n={failed} tone="danger" />
          </View>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 19, color: colors.faint, marginTop: 12 }}>
            {failed && lastFail
              ? 'The last ' + plural(failed, 'attempt') + ' failed: ' + lastFail.note
              : pending || deferred
                ? plural(pending + deferred, 'change') + ' waiting — sent automatically when the phone is online.'
                : 'Queue is healthy. No pending, deferred or failed items.'}
          </Text>
        </ToolCard>
      ) : null}

      {isOwner ? (
        <View style={{ marginBottom: 16 }}>
          <SectionCap
            right={(
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.faint }}>
                  {(devices ? devices.length : '–') + (max ? ' / ' + max : '')}
                </Text>
                <Pressable hitSlop={10} accessibilityLabel="Check devices linked" onPress={() => loadDevices(true)}>
                  <Icon name="swap" size={19} color={colors.faint} />
                </Pressable>
              </View>
            )}
          >
            Linked devices
          </SectionCap>
          {(devices || []).map((d) => {
            const me = d.id === s.deviceId;
            return (
              <View key={d.id} style={{
                flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, marginBottom: 10,
                backgroundColor: colors.surface, borderWidth: 1.2, borderColor: me ? colors.good : colors.line,
              }}>
                <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: colors.goodSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="phone" size={20} color={colors.good} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{d.name || 'Device'}</Text>
                    {me ? (
                      <View style={{ backgroundColor: colors.goodSoft, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.good }}>This device</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                    {(d.platform && d.platform !== 'app' ? d.platform : d.kind || 'phone') + ' · Linked ' + fmtDate(d.created_at)}
                  </Text>
                </View>
                <Pressable
                  hitSlop={10}
                  accessibilityLabel={'Remove ' + (d.name || 'device')}
                  disabled={busy === 'dev:' + d.id}
                  onPress={() => removeDevice(d)}
                >
                  <Icon name="arrow" size={20} color={colors.faint} />
                </Pressable>
              </View>
            );
          })}
          {devices && !devices.length ? (
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>No devices are linked yet.</Text>
          ) : null}
          {!devices ? (
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{busy === 'devices' ? 'Checking…' : 'Tap refresh to check the linked devices.'}</Text>
          ) : null}
        </View>
      ) : null}

      <ToolCard icon="up" tone="danger" title="Cloud backup" sub="A full copy of the books kept with your account">
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 2 }}>
            <Button variant="pri" label="Back up now" loading={busy === 'backup'} disabled={!s.on || !online} icon={<Icon name="up" size={17} color={colors.accentInk} />} onPress={backUpNow} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Refresh" disabled={!!busy} onPress={loadCloudCopy} />
          </View>
        </View>
        <View style={{ height: 10 }} />
        <Button label="Load cloud backup" loading={busy === 'load'} icon={<Icon name="down" size={17} color={colors.ink} />} onPress={loadCloudCopy} />
        {copy ? (
          <View style={{ marginTop: 12, padding: 14, borderRadius: 12, backgroundColor: colors.sunk, gap: 4 }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>Latest cloud copy · version {copy.version}</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
              {'Saved ' + fmtDate(copy.updatedAt) + ' · ' + plural((copy.data?.sales || []).length, 'sale') + ' · ' + plural((copy.data?.products || []).length, 'item')}
            </Text>
            {isOwner ? <View style={{ marginTop: 8 }}><Button variant="dngr" label="Restore this copy" onPress={restoreCopy} /></View> : null}
          </View>
        ) : null}
      </ToolCard>

      {(s.log || []).length ? (
        <View>
          <SectionCap>Recent activity</SectionCap>
          {[...(s.log || [])].reverse().slice(0, 5).map((l) => (
            <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 }}>
              <Icon name={l.ok ? 'check' : 'alert'} size={16} color={l.ok ? colors.good : colors.danger} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink }}>{l.note}</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{fmtDate(l.ts) + (l.how === 'auto' ? ' · automatic' : l.by ? ' · ' + l.by : '')}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
