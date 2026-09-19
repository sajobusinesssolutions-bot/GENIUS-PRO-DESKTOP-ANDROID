/**
 * LICENCE · INSTALL · UPDATE · CLOUD SYNC · ONLINE MODE · VERSIONS
 *
 * Built from the live reference definitions:
 *   SCREENS.sync        20298, with the conflict banner wrapper at 21182
 *   SCREENS.versions    20980, superseded by the body at 21432
 *   SCREENS.install     21603   (a PWA "add to home screen"; adapted below)
 *   SCREENS.licence     21930, with the guard-card wrapper at 22315
 *   SCREENS.licenceStop 22014
 *   SCREENS.online      22755
 *   SCREENS.update      23198
 *
 * Two deliberate adaptations to React Native:
 *   · The reference "Install" screen walks a browser through adding a PWA to
 *     the home screen. There is no browser here, so the screen reports how
 *     this build is installed and what running as a real app gives you,
 *     reading expo-constants rather than adding a native module.
 *   · The reference "Update" screen swaps in a waiting service worker. There
 *     is none here, so it checks the same publish feed and tells you plainly
 *     where a newer build has to come from.
 * EFRIS is deliberately not carried into this port.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Switch, Pressable, Alert, ActivityIndicator, Platform, Linking } from 'react-native';
import Constants from 'expo-constants';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useAuth } from '../data/AuthContext';
import { refreshSession } from '../data/authApi';
import { canFor } from '../data/perms';
import {
  Card, Cap, KV, Button, Pill, EmptyState, IconTile, Grid, Stat,
  Panel, Badge, SectionLabel, StatGrid, Sw, ListRow,
} from '../components/ui';
import { Icon, IconName } from '../components/icons';
import { useGo } from '../nav/navigate';
import { plural, fmtDate, fmtDay } from '../data/helpers';
import {
  BUILD, SCHEMA_VERSION, CHANGELOG, PLANS, LIC_WORDS, LIC_GRACE, LIC_SERVER_DEFAULT,
  SYNC_FREQ, CONFLICT_RULES, UPDATE_FEED_DEFAULT, POWERED_BY,
} from '../data/defaults';
import { verCmp, subDaysLeft, subState } from '../data/logic';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

/* ---------------- shared bits ---------------- */

type Tone = 'good' | 'warn' | 'danger' | 'accent';

function toneColors(colors: ReturnType<typeof useTheme>['colors'], t: Tone): [string, string] {
  if (t === 'good') return [colors.goodSoft, colors.good];
  if (t === 'warn') return [colors.warnSoft, colors.warn];
  if (t === 'danger') return [colors.dangerSoft, colors.danger];
  return [colors.accentSoft, colors.accent];
}

/** The big tinted state card every one of these screens opens with. */
function StateCard({ tone, cap, headline, note, icon, busy, children }: {
  tone: Tone; cap: string; headline: string; note: string; icon: IconName;
  busy?: boolean; children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const [bg, fg] = toneColors(colors, tone);
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>
      <Panel style={{ borderWidth: 1.5, borderColor: bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
          <View style={{ width: 52, height: 52, borderRadius: 17, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
            {busy ? <ActivityIndicator color={fg} /> : <Icon name={icon} size={25} color={fg} />}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontFamily: fonts.uiExtra, fontSize: 19, color: colors.ink, letterSpacing: -0.4 }}>{headline}</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 18, color: colors.faint, marginTop: 3 }}>{note}</Text>
          </View>
          <Badge label={cap} tone={tone === 'accent' ? 'accent' : tone} />
        </View>
        {children ? <View style={{ marginTop: 16 }}>{children}</View> : null}
      </Panel>
    </View>
  );
}

/** A tinted note card — reference `guardCard` at 22337. */
function GuardCard({ tone, title, note }: { tone: Tone; title: string; note: string }) {
  const { colors } = useTheme();
  const [bg, fg] = toneColors(colors, tone);
  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 11, backgroundColor: bg, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 14 }}>
        <Icon name="alert" size={18} color={fg} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: fg }}>{title}</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 18, color: fg, marginTop: 3 }}>{note}</Text>
        </View>
      </View>
    </View>
  );
}

function ToggleRow({ label, note, value, onChange, last }: {
  label: string; note?: string; value: boolean; onChange: (v: boolean) => void; last?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 15, minHeight: 60,
        borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.line,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14.5, color: colors.ink }}>{label}</Text>
        {note ? <Text style={{ fontFamily: fonts.ui, fontSize: 12, lineHeight: 17, color: colors.faint, marginTop: 2 }}>{note}</Text> : null}
      </View>
      <Sw on={value} onPress={() => onChange(!value)} />
    </Pressable>
  );
}

/** A row that picks one of a set — the `data-a="…Set"` rows in the reference. */
function PickRow({ label, note, on, onPress, last }: {
  label: string; note?: string; on: boolean; onPress: () => void; last?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 15, minHeight: 60,
        backgroundColor: on ? colors.accentSoft : 'transparent',
        borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.line,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14.5, color: colors.ink }}>{label}</Text>
        {note ? <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 2 }}>{note}</Text> : null}
      </View>
      {on ? <Icon name="check" size={20} color={colors.accent} /> : null}
    </Pressable>
  );
}

/** The "what this gives you" explainer list every one of these screens carries. */
function ExplainerList({ rows }: { rows: [IconName, string, string][] }) {
  const { colors } = useTheme();
  return (
    <Card>
      {rows.map(([icon, title, sub], i) => (
        <View
          key={title}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 16,
            borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: colors.line,
          }}
        >
          <IconTile icon={icon} bg={colors.sunk} color={colors.rail} size={32} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>{title}</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 11, lineHeight: 15, color: colors.faint, marginTop: 1 }}>{sub}</Text>
          </View>
        </View>
      ))}
    </Card>
  );
}

function Field({ label, value, onChangeText, placeholder, mono, autoCaps }: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; mono?: boolean; autoCaps?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: 11 }}>
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: colors.faint, marginBottom: 5 }}>{label}</Text>
      <TextInput
        value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.faint}
        autoCapitalize={autoCaps ? 'characters' : 'none'} autoCorrect={false}
        style={{
          backgroundColor: colors.sunk, borderRadius: 10, height: 42, paddingHorizontal: 12,
          fontFamily: mono ? fonts.mono : fonts.ui, fontSize: 13, color: colors.ink,
        }}
      />
    </View>
  );
}

/** The Pro wall these screens show instead of breaking — reference 18790. */
function ProWall({ what, blurb }: { what: string; blurb: string }) {
  const { colors } = useTheme();
  const go = useGo();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingTop: 18 }}>
      <View style={{ backgroundColor: colors.accentSoft, borderRadius: 13, padding: 18, alignItems: 'center' }}>
        <Icon name="lock" size={26} color={colors.accent} />
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 16, color: colors.ink, marginTop: 8, textAlign: 'center' }}>{what} is on Pro</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12, lineHeight: 17, color: colors.soft, marginTop: 4, textAlign: 'center' }}>{blurb}</Text>
        <View style={{ width: '100%', marginTop: 14 }}>
          <Button variant="pri" label="See the plans" onPress={() => go('Plans')} />
        </View>
      </View>
      <Card style={{ marginTop: 12, paddingVertical: 13, paddingHorizontal: 14 }}>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>Your books are safe either way</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, lineHeight: 16, color: colors.faint, marginTop: 3 }}>
          Backup &amp; restore works on Starter — it writes a full copy you can move yourself.
        </Text>
        <View style={{ marginTop: 10 }}>
          <Button size="sm" label="Open backup" onPress={() => go('DataTools', { backup: true })} />
        </View>
      </Card>
    </ScrollView>
  );
}

/* ============================================================
   LICENCE — SCREENS.licence (21930) + the wrapper at 22315
   ============================================================ */

export function LicenceScreen() {
  const { colors } = useTheme();
  const { db, setLicence, licState, refreshLicence } = useAppData();
  const { account } = useAuth();

  /** Asks the account server for this owner's licence, as the app does by itself every few hours. */
  const checkAccount = async () => {
    if (!account?.refresh) return;
    setBusy(true);
    try {
      const r = await refreshSession(account.refresh);
      if (!r.ok) { Alert.alert('Licence', r.error.message); return; }
      const now = await refreshLicence(r.value.access, account.id);
      Alert.alert('Licence', now === 'active' || now === 'trial' ? 'Your licence is up to date.' : 'The account answered: ' + now + '.');
    } finally {
      setBusy(false);
    }
  };
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(db?.licence.key || '');
  const [server, setServer] = useState(db?.licence.server || LIC_SERVER_DEFAULT);

  if (!db) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  const l = db.licence;
  const st = licState();
  const w = LIC_WORDS[st] || LIC_WORDS.none;
  const lic = l.licence;

  const tone: Tone = st === 'active' ? 'good' : st === 'stale' ? 'warn' : st === 'none' ? 'accent' : 'danger';

  const base = (s: string) => (s || LIC_SERVER_DEFAULT).replace(/\/+$/, '');

  /** POST to the author's server. Reference licPost (21818). */
  const post = async (path: string, body: unknown, srv: string) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(base(srv) + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  };

  const remember = (d: any) => {
    setLicence({
      status: d.status || (d.ok ? 'active' : 'unknown'),
      reason: d.reason || '',
      licence: d.licence || l.licence,
      checkedAt: new Date().toISOString(),
      offlineSince: '',
    });
  };

  const activate = async () => {
    const k = key.trim().toUpperCase();
    if (!k) { Alert.alert('Licence', 'Type the key first.'); return; }
    setLicence({ key: k, server: server.trim() });
    setBusy(true);
    try {
      const d = await post('/v1/activate', { key: k, device: { id: 'dev_this', name: db.session.till, kind: 'phone' }, app: { build: BUILD } }, server);
      remember(d);
      Alert.alert('Licence', d.ok ? 'This till is licensed.' : (d.reason || 'That did not work.'));
    } catch {
      setLicence({ offlineSince: l.offlineSince || new Date().toISOString() });
      Alert.alert('Licence', 'Could not reach the licence server.');
    } finally {
      setBusy(false);
    }
  };

  const checkNow = async () => {
    setBusy(true);
    try {
      const d = await post('/v1/check', { key: l.key, deviceId: 'dev_this' }, l.server || server);
      remember(d);
      Alert.alert('Licence', d.ok ? 'Licence confirmed.' : (d.reason || 'Refused.'));
    } catch {
      setLicence({ offlineSince: l.offlineSince || new Date().toISOString() });
      Alert.alert('Licence', 'Could not reach the server. The till keeps selling on the last answer.');
    } finally {
      setBusy(false);
    }
  };

  const forget = () => Alert.alert(
    'Remove the licence',
    'Take this licence off this till?\n\nYour books are untouched.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: () => { setLicence({ key: '', status: 'none', checkedAt: '', licence: null, reason: '', offlineSince: '' }); setKey(''); },
      },
    ],
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
      <StateCard
        tone={tone} cap={w[0]} icon={st === 'active' ? 'check' : 'lock'} busy={busy}
        headline={lic ? (lic.planName || lic.plan) : 'Not licensed'}
        note={l.reason || w[1]}
      />

      {lic ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <Card style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
            <KV label="Licence" value={lic.no} />
            <KV label="Plan" value={lic.planName + ' · ' + lic.term} />
            <KV label="Runs until" value={fmtDay(lic.expiresAt) + (lic.daysLeft != null ? ' (' + plural(Math.max(0, lic.daysLeft), 'day') + ')' : '')} />
            <KV label="Devices" value={lic.devices + ' of ' + (lic.limits ? lic.limits.devices : '—')} />
            {lic.owner ? <KV label="Held by" value={lic.owner.name} /> : null}
            <KV label="Last checked" value={l.checkedAt ? fmtDate(l.checkedAt) : 'never'} last />
          </Card>
        </View>
      ) : null}

      {/*
        The licence comes from the owner's account and is granted, or taken
        away, by the developer only. The key box and "Remove the licence"
        button that were here let a till drop its own licence or bypass the
        account, so they are gone.
      */}
      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
        <Button
          variant="pri"
          label={busy ? 'Checking…' : 'Check with my account'}
          disabled={busy || !account?.refresh}
          onPress={checkAccount}
        />
        <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, lineHeight: 17, color: colors.faint, marginTop: 9 }}>
          {account
            ? 'Your licence belongs to ' + account.email + '. To change plan, add devices or renew, contact the developer. The change reaches this till by itself.'
            : "Sign in with the owner's account to receive its licence."}
        </Text>
      </View>

      {l.offlineSince ? (
        <View style={{ paddingTop: 12 }}>
          <GuardCard
            tone="warn" title="Working from the last answer"
            note={'The server has not been reachable since ' + fmtDate(l.offlineSince) +
              '. The till keeps selling for ' + LIC_GRACE + ' days from the last check.'}
          />
        </View>
      ) : null}

      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <Cap style={{ marginBottom: 8 }}>How this works</Cap>
        <ExplainerList
          rows={[
            ['cloud', 'The server decides', 'This till asks the author’s server, and does what it says'],
            ['clock', 'It keeps selling offline', 'Up to ' + LIC_GRACE + ' days on the last answer'],
            ['shield', 'Your books are yours', 'A stopped licence never deletes or locks away what you recorded'],
            ['phone', 'One key, several tills', 'As many devices as the plan allows, each bound once'],
          ]}
        />
      </View>
    </ScrollView>
  );
}

/** SCREENS.licenceStop — 22014. The door a stopped till cannot open. */
export function LicenceStopScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const { db, licState } = useAppData();
  if (!db) return null;
  const st = licState();
  const w = LIC_WORDS[st] || LIC_WORDS.none;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingTop: 22 }}>
      <View style={{ backgroundColor: colors.dangerSoft, borderRadius: 13, padding: 20, alignItems: 'center' }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="lock" size={26} color={colors.danger} />
        </View>
        <Text style={{ fontFamily: fonts.uiExtra, fontSize: 17, color: colors.ink, marginTop: 12, textAlign: 'center' }}>{w[0]}</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12, lineHeight: 17, color: colors.soft, marginTop: 4, textAlign: 'center' }}>
          {db.licence.reason || w[1]}
        </Text>
        {db.licence.licence ? (
          <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.faint, marginTop: 8 }}>{db.licence.licence.no}</Text>
        ) : null}
      </View>

      <Card style={{ marginTop: 12, paddingVertical: 13, paddingHorizontal: 14 }}>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>Nothing has been lost</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, lineHeight: 16, color: colors.faint, marginTop: 3 }}>
          Every sale, customer and figure is still on this phone. You can read the books and take a
          backup out — you just cannot record anything new until the licence is put right.
        </Text>
      </Card>

      <View style={{ flexDirection: 'row', gap: 9, marginTop: 12 }}>
        <View style={{ flex: 1 }}><Button size="sm" label="The licence" onPress={() => go('Licence')} /></View>
        <View style={{ flex: 1 }}><Button size="sm" label="Take a backup" onPress={() => go('DataTools', { backup: true })} /></View>
      </View>
      <View style={{ marginTop: 8 }}>
        <Button size="sm" label="Read the reports" onPress={() => go('Reports')} />
      </View>

      <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, textAlign: 'center', marginTop: 14 }}>{POWERED_BY}</Text>
    </ScrollView>
  );
}

/* ============================================================
   INSTALL — SCREENS.install (21603), adapted to a native build
   ============================================================ */

export function InstallScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const cfg = Constants.expoConfig;
  // In a dev client or Expo Go the bundle is served over the network; in a
  // release build it is baked in. That is this port's honest "standalone".
  const installed = Constants.appOwnership !== 'expo' && !(Constants.expoGoConfig);
  const channel = (Constants as any).expoConfig?.updates?.channel || (Constants as any).manifest2?.extra?.expoClient?.channel || '';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 24 }}>
      <StateCard
        tone={installed ? 'good' : 'warn'}
        cap={installed ? 'Installed' : 'Running from a development host'}
        headline="Genius POS"
        note={installed
          ? 'This is the installed app — it opens straight from the home screen and needs no browser.'
          : 'The bundle is being served to this device. Build a release to run it with nothing attached.'}
        icon="phone"
      />

      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
        <Cap style={{ marginBottom: 8 }}>What installing gives you</Cap>
        <ExplainerList
          rows={[
            ['till', 'Opens like any other app', 'No address bar, no tabs — it fills the screen'],
            ['cloud', 'Works with no network', 'The whole app is kept on the phone'],
            ['clock', 'Starts faster', 'Nothing is fetched when it opens'],
            ['shield', 'Your books stay on the device', 'Installing does not send anything anywhere'],
          ]}
        />
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <Cap style={{ marginBottom: 8 }}>This copy</Cap>
        <Card style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
          <KV label="Running as" value={installed ? 'Installed app' : 'Development build'} />
          <KV label="Platform" value={Platform.OS === 'android' ? 'Android' : Platform.OS === 'ios' ? 'iOS' : String(Platform.OS)} />
          <KV label="App version" value={cfg?.version || BUILD} />
          <KV label="Shell build" value={BUILD} />
          {channel ? <KV label="Release channel" value={String(channel)} /> : null}
          <KV label="Books kept" value="On this device" last />
        </Card>
        <Text style={{ fontFamily: fonts.ui, fontSize: 11, lineHeight: 16, color: colors.faint, marginTop: 9 }}>
          Nothing about this app needs a connection to open. Everything you record is written to this
          phone first, and a backup takes a full copy out whenever you want one.
        </Text>
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 9 }}>
        <Button label="Check for a newer build" onPress={() => go('Update')} />
        <Button label="Take a backup" onPress={() => go('DataTools', { backup: true })} />
      </View>
    </ScrollView>
  );
}

/* ============================================================
   UPDATE — SCREENS.update (23198)
   ============================================================ */

type FeedBuild = { build: string; note?: string; at?: string; url?: string };
type UpdState = { state: 'idle' | 'checking' | 'available' | 'current' | 'failed'; latest: FeedBuild | null; why: string };

export function UpdateScreen() {
  const { colors } = useTheme();
  const { db, setUpdateCfg } = useAppData();
  const [upd, setUpd] = useState<UpdState>({ state: 'idle', latest: null, why: '' });
  const [feedEdit, setFeedEdit] = useState<string | null>(null);

  const u = db?.update;

  const check = useCallback(async (loud: boolean) => {
    if (!u) return;
    setUpd((s) => ({ ...s, state: 'checking' }));
    const url = u.feed + (u.feed.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now();
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12000);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) throw new Error('The update server answered ' + res.status);
      const d = await res.json();
      const m: FeedBuild | undefined = d?.mobile;
      if (!m || !m.build) throw new Error('The update feed did not answer properly');
      setUpdateCfg({ lastCheck: new Date().toISOString() });
      const newer = verCmp(m.build, BUILD) > 0;
      setUpd({ state: newer ? 'available' : 'current', latest: m, why: '' });
      if (loud) Alert.alert('Updates', newer ? 'Build ' + m.build + ' is available.' : 'This is the newest build.');
    } catch (e: any) {
      const why = e?.name === 'AbortError' ? 'The update server did not answer' : (e?.message || 'No connection');
      setUpdateCfg({ lastCheck: new Date().toISOString() });
      setUpd({ state: 'failed', latest: null, why });
      if (loud) Alert.alert('Updates', why);
    } finally {
      clearTimeout(t);
    }
  }, [u?.feed]);

  // the first look is delayed: opening the till must not wait on the internet
  useEffect(() => {
    if (!u?.on) return;
    const id = setTimeout(() => { check(false); }, 1200);
    return () => clearTimeout(id);
  }, [u?.on, check]);

  if (!db || !u) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  const l = upd.latest;
  const skipped = !!l && l.build === u.skip;

  const head = upd.state === 'available' && l && !skipped
    ? { tone: 'warn' as Tone, cap: 'A newer build is out', headline: 'Build ' + l.build, note: (l.note || 'A newer build has been published.') + (l.at ? ' Published ' + fmtDate(l.at) + '.' : '') }
    : upd.state === 'failed'
      ? { tone: 'warn' as Tone, cap: 'Could not check', headline: 'Build ' + BUILD, note: upd.why + ' The till carries on working exactly as it is.' }
      : upd.state === 'checking'
        ? { tone: 'accent' as Tone, cap: 'Looking', headline: 'Build ' + BUILD, note: 'Asking the update server…' }
        : { tone: 'good' as Tone, cap: 'Up to date', headline: 'Build ' + BUILD, note: 'Running build ' + BUILD + '.' + (u.lastCheck ? ' Last looked ' + fmtDate(u.lastCheck) + '.' : '') };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
      <StateCard tone={head.tone} cap={head.cap} headline={head.headline} note={head.note} icon="down" busy={upd.state === 'checking'}>
        {upd.state === 'available' && l && !skipped ? (
          <View style={{ gap: 8 }}>
            {l.url ? (
              <Button variant="pri" label="Get it" onPress={() => Linking.openURL(l.url!).catch(() => Alert.alert('Updates', 'Could not open ' + l.url))} />
            ) : (
              <Button variant="pri" label="Check again" onPress={() => check(true)} />
            )}
            <Button label="Not this one" onPress={() => { setUpdateCfg({ skip: l.build }); Alert.alert('Updates', 'This build will not be offered again.'); }} />
          </View>
        ) : null}
      </StateCard>

      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
        <Cap style={{ marginBottom: 8 }}>How it works</Cap>
        <Card>
          <ToggleRow
            label="Look for new builds by itself"
            note="Every few hours, when there is a connection"
            value={u.on}
            onChange={(v) => { setUpdateCfg({ on: v }); }}
          />
          <Pressable
            onPress={() => check(true)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.line }}
          >
            <Icon name="down" size={18} color={colors.rail} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>Check now</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 1 }}>
                {u.lastCheck ? 'Last looked ' + fmtDate(u.lastCheck) : 'Not looked yet'}
              </Text>
            </View>
          </Pressable>
          <Pressable
            onPress={() => setFeedEdit(u.feed)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 16 }}
          >
            <Icon name="cloud" size={18} color={colors.rail} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>Where it looks</Text>
              <Text numberOfLines={2} style={{ fontFamily: fonts.mono, fontSize: 10.5, color: colors.faint, marginTop: 1 }}>{u.feed}</Text>
            </View>
            <Icon name="chev" size={14} color={colors.faint} />
          </Pressable>
        </Card>
      </View>

      {feedEdit != null ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          <Cap style={{ marginBottom: 8 }}>Where to look for new builds</Cap>
          <Card style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 11, lineHeight: 16, color: colors.faint, marginBottom: 10 }}>
              A small file that says which build is newest. Leave it as it is unless your supplier
              gave you another address — a shop on a slow line may be given a copy on the office computer.
            </Text>
            <Field label="Address" value={feedEdit} onChangeText={setFeedEdit} mono placeholder={UPDATE_FEED_DEFAULT} />
            <View style={{ flexDirection: 'row', gap: 9 }}>
              <View style={{ flex: 1 }}><Button size="sm" label="Cancel" onPress={() => setFeedEdit(null)} /></View>
              <View style={{ flex: 1 }}>
                <Button
                  size="sm" variant="pri" label="Save"
                  onPress={() => { setUpdateCfg({ feed: feedEdit.trim() || UPDATE_FEED_DEFAULT }); setFeedEdit(null); }}
                />
              </View>
            </View>
          </Card>
        </View>
      ) : null}

      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <Text style={{ fontFamily: fonts.ui, fontSize: 11, lineHeight: 16, color: colors.faint }}>
          An update replaces the app, never the books. Your sales, stock and customers live on this
          device and are untouched by it. Take a backup first if it would make you happier.
        </Text>
      </View>
    </ScrollView>
  );
}

/* ============================================================
   CLOUD SYNC — SCREENS.sync (20298) + the conflict banner (21182)
   ============================================================ */


/* ============================================================
   ONLINE MODE — SCREENS.online (22755)
   ============================================================ */

export function OnlineScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const { db, setSync, licFeature, toggleOnline, flushQueue } = useAppData();

  if (!db) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (!licFeature('sync')) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingTop: 18 }}>
        <View style={{ backgroundColor: colors.accentSoft, borderRadius: 13, padding: 18, alignItems: 'center' }}>
          <Icon name="cloud" size={26} color={colors.accent} />
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 16, color: colors.ink, marginTop: 8 }}>Online mode needs Pro</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12, lineHeight: 17, color: colors.soft, marginTop: 4, textAlign: 'center' }}>
            Starter keeps everything on one device. Pro puts the books in the cloud so every till in
            the shop agrees.
          </Text>
          <View style={{ width: '100%', marginTop: 14 }}>
            <Button variant="pri" label="The licence" onPress={() => go('Licence')} />
          </View>
        </View>
      </ScrollView>
    );
  }

  const s = db.sync;
  const on = s.on;
  const online = db.session.online !== false;
  const pend = db.queue.length + s.pending.length;

  const st: { t: string; tone: Tone; n: string } = !on
    ? { t: 'Off', tone: 'warn', n: 'The books stay on this device' }
    : online
      ? { t: 'Live', tone: 'good', n: 'Every change is going straight up' }
      : { t: 'No line', tone: 'danger', n: 'This device cannot reach the cloud' };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 24 }}>
      <StateCard
        tone={st.tone} cap={st.t} icon="cloud" note={st.n}
        headline={on ? (pend ? plural(pend, 'change') + ' waiting' : 'Everything is up') : 'This device only'}
      >
        {on ? <Button variant="pri" label="Sync now" onPress={() => { flushQueue(); setSync({ lastPush: new Date().toISOString(), lastAt: new Date().toISOString() }); }} /> : null}
      </StateCard>

      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
        <Card>
          <ToggleRow
            label="Keep this shop’s books in the cloud"
            note="Every device on the licence shares one set of books"
            value={on}
            onChange={(v) => {
              if (!v && pend) {
                Alert.alert(
                  'Online mode',
                  plural(pend, 'change') + ' have not reached the cloud yet.\n\nTurn online mode off anyway? They will stay on this device only.',
                  [{ text: 'Cancel', style: 'cancel' }, { text: 'Turn off', style: 'destructive', onPress: () => setSync({ on: false }) }],
                );
                return;
              }
              if (v && !canFor(db.session.role, 'settings')) { Alert.alert('Online mode', 'Only the owner can turn this on.'); return; }
              setSync({ on: v });
            }}
            last={!on}
          />
          {on ? (
            <ToggleRow
              label="Refuse to record anything while offline"
              note="Off, this device will queue changes instead — the tills can then disagree"
              value={s.strict}
              onChange={(v) => setSync({ strict: v })}
              last
            />
          ) : null}
        </Card>
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <Card>
          <ToggleRow label="This device has a line" note="Turn it off to keep selling with no network" value={online} onChange={() => toggleOnline()} last />
        </Card>
      </View>

      {on ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
          <Card style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
            <KV label="Books" value={db.firm.name} />
            <KV label="This device" value={s.devices.find((x) => x.me)?.name || 'This phone'} />
            <KV label="Waiting to go up" value={plural(pend, 'change')} />
            <KV label="Last sent" value={s.lastPush ? fmtDate(s.lastPush) : 'never'} />
            <KV label="Last received" value={s.lastPull ? fmtDate(s.lastPull) : 'never'} />
            <KV label="Cloud position" value={'#' + (s.cursor || 0)} last />
          </Card>
        </View>
      ) : null}

      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <Cap style={{ marginBottom: 8 }}>What online mode changes</Cap>
        <ExplainerList
          rows={[
            ['cloud', 'The cloud holds the books', 'Not a copy — the shop’s working set'],
            ['phone', 'Every device agrees', 'A sale on the counter phone is on the laptop at once'],
            ['lock', 'Nothing is written blind', 'A change that cannot be reported is not recorded'],
            ['shield', 'Your data stays yours', 'One account, one shop. No other business can see it'],
          ]}
        />
      </View>
    </ScrollView>
  );
}

/* ============================================================
   VERSIONS — SCREENS.versions, the body at 21432
   ============================================================ */

type VersionsProps = NativeStackScreenProps<RootStackParamList, 'Versions'>;

const FIELD_LABELS: Record<string, string> = {
  total: 'Total', due: 'Due', paid: 'Paid', partyId: 'Customer', method: 'Payment',
  discount: 'Discount', tax: 'Tax', status: 'Status', no: 'Number', name: 'Name',
  price: 'Price', cost: 'Cost', qty: 'Quantity', amount: 'Amount',
  accountId: 'Account', ref: 'Reference', note: 'Note', unit: 'Unit',
  sku: 'Code', phone: 'Phone', type: 'Type', warehouse: 'Store',
};
/** The fields worth showing a shopkeeper — reference SHOWN_FIELDS at 21418. */
const SHOWN_FIELDS = Object.keys(FIELD_LABELS);

export function VersionsScreen({ route }: VersionsProps) {
  const { colors } = useTheme();
  const { db, revisionsFor, user, party, product, money } = useAppData();

  const coll = route.params?.coll || 'sales';
  const id = route.params?.recordId || '';
  const rec: any = db ? ((db as any)[coll] || []).find((x: any) => x.id === id) : null;

  if (!db) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (!rec) return <EmptyState icon="clock" title="Not found" subtitle="That record is no longer here." />;

  const list = revisionsFor(rec.id);

  const shortVal = (v: unknown): string => {
    if (v == null || v === '') return '—';
    if (typeof v === 'number') return money(v);
    const s = String(v);
    const named = party(s)?.name || product(s)?.name || user(s)?.name || db.accounts.find((a) => a.id === s)?.name;
    const out = named || s;
    return out.length > 22 ? out.slice(0, 21) + '…' : out;
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>
        <Card style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
          <KV label="Record" value={String(rec.no || rec.name || rec.id)} />
          <KV label="Now at" value={'Version ' + (rec._v || 1)} />
          <KV label="Last changed" value={rec._at ? fmtDate(rec._at) : '—'} />
          <KV label="By" value={user(rec._by)?.name || '—'} last />
        </Card>
      </View>

      {list.length ? list.map((r) => {
        const current = r.v === (rec._v || 1);
        const shown = (r.changed || []).filter((c) => SHOWN_FIELDS.indexOf(c.f) > -1);
        return (
          <View key={r.id} style={{ paddingHorizontal: 16, paddingBottom: 9 }}>
            <Card style={{ paddingVertical: 12, paddingHorizontal: 14, borderColor: current ? colors.accent : colors.line }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>Version {r.v}</Text>
                  {current ? <Pill tone="a" label="Now" /> : null}
                </View>
                <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>{fmtDate(r.ts)}</Text>
              </View>
              <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 2 }}>
                {r.why || 'Changed'} · {user(r.by)?.name || ''}
              </Text>
              {shown.length ? (
                <View style={{ marginTop: 8, gap: 3 }}>
                  {shown.slice(0, 8).map((c, i) => (
                    <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                      <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.soft }}>{FIELD_LABELS[c.f] || c.f}</Text>
                      <Text numberOfLines={1} style={{ flex: 1, textAlign: 'right', fontFamily: fonts.mono, fontSize: 11.5, color: colors.faint }}>
                        {shortVal(c.from)} → <Text style={{ fontFamily: fonts.monoSemi, color: colors.ink }}>{shortVal(c.to)}</Text>
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </Card>
          </View>
        );
      }) : (
        <View style={{ paddingHorizontal: 16 }}>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>
            Nothing has changed since it was created.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

/* ============================================================
   ABOUT — SCREENS.about (21109) with the wrapper at 21716
   ============================================================ */

export function AboutScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const { db, setNumbering, isPro } = useAppData();
  if (!db) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  const cfg = Constants.expoConfig;
  const installed = Constants.appOwnership !== 'expo' && !Constants.expoGoConfig;
  const sub = db.subscription;
  const st = subState(sub);
  const mode = db.numberSafe?.mode || 'auto';
  const manyDevices = db.sync.devices.length > 1 && db.sync.on;
  const tagged = mode === 'tag' || (mode === 'auto' && manyDevices);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>
        <Card style={{ padding: 16, alignItems: 'center' }}>
          <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: colors.rail, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <Icon name="till" size={26} color="#fff" />
          </View>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink, letterSpacing: -0.4 }}>Genius POS</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 2 }}>Version {BUILD}</Text>
        </Card>
      </View>

      {/* the wrapper at 21716 — how this copy is running */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <Card style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
          <KV label="Running as" value={installed ? 'Installed app' : 'Development build'} />
          <KV label="Books kept" value="On this device" last />
        </Card>
      </View>

      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <Card style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
          <KV label="App version" value={cfg?.version || BUILD} />
          <KV label="Shell build" value={BUILD} />
          <KV label="Data format" value={'v' + SCHEMA_VERSION} />
          <KV label="This device" value={db.sync.devices.find((x) => x.me)?.name || 'This phone'} />
          <KV label="Document numbers" value={tagged ? 'tagged' : 'plain'} />
          <KV label="Records tracked" value={(db.revisions || []).length + ' revisions'} />
          <KV label="Plan" value={(isPro() ? PLANS.pro.name : PLANS.starter.name) + ' · ' + st.label.toLowerCase()} last />
        </Card>
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 6 }}>
        <Cap style={{ marginBottom: 8 }}>Numbering when several devices share a book</Cap>
        <Card>
          {([
            ['auto', 'Tag them only when a second device is linked'],
            ['tag', 'Always add the device tag'],
            ['plain', 'Never — I only use one device'],
          ] as const).map(([v, l], i) => (
            <PickRow key={v} label={l} on={mode === v} onPress={() => setNumbering(v)} last={i === 2} />
          ))}
        </Card>
        <Text style={{ fontFamily: fonts.ui, fontSize: 11, lineHeight: 16, color: colors.faint, marginTop: 8 }}>
          A tag looks like INV-0042/A3. Without it, two tills offline at once will both write
          INV-0042 and one of them has to be renumbered later.
        </Text>
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 9 }}>
        <Button label="Licence" onPress={() => go('Licence')} />
        <Button label="Updates" onPress={() => go('Update')} />
        <Button label="Install on this phone" onPress={() => go('Install')} />
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <Cap style={{ marginBottom: 8 }}>What changed</Cap>
        <Card>
          {CHANGELOG.map((c, i) => (
            <View
              key={c[0]}
              style={{
                flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingVertical: 9, paddingHorizontal: 16,
                borderBottomWidth: i === CHANGELOG.length - 1 ? 0 : 1, borderBottomColor: colors.line,
              }}
            >
              <View style={{ width: 40 }}>
                <Pill tone={c[0] === BUILD ? 'a' : 'default'} label={c[0]} />
              </View>
              <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 11.5, lineHeight: 16, color: colors.faint }}>{c[1]}</Text>
            </View>
          ))}
        </Card>
      </View>

      <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, textAlign: 'center', marginTop: 16 }}>{POWERED_BY}</Text>
    </ScrollView>
  );
}

/* ============================================================
   PLANS — the price list, reached from the menu banner
   ============================================================ */

export function PlansScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const { db, money, setSubscription, isPro } = useAppData();
  const [term, setTerm] = useState<'month' | 'quarter' | 'year'>('month');
  if (!db) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  const sub = db.subscription;
  const st = subState(sub);
  const left = subDaysLeft(sub);
  const current = isPro() ? 'pro' : 'starter';

  const choose = (id: 'starter' | 'pro') => {
    const renews = new Date();
    renews.setDate(renews.getDate() + (term === 'month' ? 30 : term === 'quarter' ? 91 : 365));
    Alert.alert(
      PLANS[id].name,
      'Take ' + PLANS[id].name + ' ' + term + 'ly at ' + money(PLANS[id].prices[term]) + '?\n\n' +
      'Plans are switched on by the developer, on your account. Once paid, the new plan reaches ' +
      'every till by itself; nothing needs typing in.',
      [
        { text: 'Close', style: 'cancel' },
        {
          text: 'My licence',
          onPress: () => {
            go('Licence');
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 24 }}>
      <StateCard
        tone={st.tone === 'warn' ? 'warn' : st.tone}
        cap={st.label}
        headline={isPro() ? PLANS.pro.name : PLANS.starter.name}
        note={sub.status === 'trial' && left >= 0 ? plural(left, 'day') + ' of Pro left' : st.note}
        icon="lock"
      />

      <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 }}>
        <Grid cols={3}>
          {(['month', 'quarter', 'year'] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => setTerm(t)}
              style={{
                paddingVertical: 9, borderRadius: 10, borderWidth: 1, alignItems: 'center',
                borderColor: term === t ? colors.accent : colors.line,
                backgroundColor: term === t ? colors.accentSoft : colors.surface,
              }}
            >
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: term === t ? colors.accent : colors.soft }}>
                {t === 'month' ? 'Monthly' : t === 'quarter' ? '3 months' : 'Yearly'}
              </Text>
            </Pressable>
          ))}
        </Grid>
      </View>

      {(['starter', 'pro'] as const).map((id) => {
        const p = PLANS[id];
        const mine = current === id;
        return (
          <View key={id} style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
            <View style={{
              backgroundColor: mine ? colors.accentSoft : colors.surface,
              borderWidth: mine ? 2 : 1, borderColor: mine ? colors.accent : colors.line,
              borderRadius: 14, padding: 16, gap: 8,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 16, color: colors.ink }}>{p.name}</Text>
                {mine ? <Pill tone="a" label="Yours" /> : null}
              </View>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12, lineHeight: 17, color: colors.faint }}>{p.blurb}</Text>
              <Text style={{ fontFamily: fonts.uiExtra, fontSize: 24, color: colors.ink }}>
                {money(p.prices[term])}
                <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>
                  {term === 'month' ? ' /month' : term === 'quarter' ? ' /3 months' : ' /year'}
                </Text>
              </Text>
              <View style={{ gap: 4, marginTop: 2 }}>
                {p.has.map((f) => (
                  <View key={f} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <Icon name="check" size={13} color={colors.good} />
                    <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 12, color: colors.soft }}>{f}</Text>
                  </View>
                ))}
              </View>
              <View style={{ marginTop: 6 }}>
                <Button variant={mine ? 'default' : 'pri'} label={mine ? 'This is your plan' : 'Upgrade to ' + p.name} onPress={() => choose(id)} disabled={mine} />
              </View>
            </View>
          </View>
        );
      })}

      <Text style={{ fontFamily: fonts.ui, fontSize: 11, lineHeight: 16, color: colors.faint, textAlign: 'center', paddingHorizontal: 22 }}>
        Everything you have already recorded stays yours, on Starter or Pro.
      </Text>
    </ScrollView>
  );
}

/* Cloud sync moved to its own module when it stopped being a mock. */
export { default as SyncScreen } from './SyncScreen';
