/**
 * THE DEVELOPER CONSOLE — for whoever runs the service, not for shop owners.
 *
 * Four questions, one tab each:
 *
 *   Owners   who is on the service, what they hold, when they were last seen;
 *            and from any one of them, grant a licence or block the account.
 *   Reports  who needs acting on: lapsed, lapsing within a fortnight, on trial.
 *   Server   how the machine is coping, live, so upscaling is decided on
 *            figures rather than on a hunch after it has already fallen over.
 *   Backups  a dump of every tenant at once, and a way to get it off the box.
 *
 * The server refuses every call unless the signed-in email is on its own
 * developer list. This screen showing up means nothing on its own; it is the
 * server that decides.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Alert, RefreshControl } from 'react-native';
import { Pressable } from '../components/Press';
import { useTheme, fonts, radius } from '../theme';
import { useToast } from '../components/Toast';
import {
  Panel, SectionLabel, DetailRow, Badge, Button, Search, EmptyBlock, InfoBanner, SegTabs,
  StatGrid, Field, ListRow,
} from '../components/ui';
import { Icon } from '../components/icons';
import Sheet from '../components/Sheet';
import { useDeveloper } from '../data/useDeveloper';
import * as dev from '../data/devApi';
import type { Owner, Reports, ServerStats, Backup } from '../data/devApi';

type Tab = 'owners' | 'reports' | 'server' | 'backups' | 'crashes';

/* ================================================================
   Small pieces
   ================================================================ */

function licenceTone(o: Owner): 'good' | 'warn' | 'danger' | 'accent' | 'neutral' {
  if (o.blocked) return 'danger';
  const s = o.licence?.status;
  if (s === 'expired' || s === 'revoked' || s === 'blocked') return 'danger';
  if (s === 'trial') return 'accent';
  if (o.licence?.daysLeft !== null && o.licence?.daysLeft !== undefined && o.licence.daysLeft <= 14) return 'warn';
  if (s === 'active') return 'good';
  return 'neutral';
}

function licenceLabel(o: Owner): string {
  if (o.blocked) return 'Blocked';
  if (!o.licence) return 'No licence';
  const l = o.licence;
  const name = l.plan.charAt(0).toUpperCase() + l.plan.slice(1);
  if (l.status === 'expired') return name + ' · expired';
  if (l.daysLeft === null) return name + ' · lifetime';
  return name + ' · ' + l.daysLeft + 'd left';
}

function OwnerRow({ o, onPress, last }: { o: Owner; onPress: () => void; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: 13, paddingHorizontal: 15, gap: 5,
        borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.line,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>
          {o.email}
        </Text>
        <Badge tone={licenceTone(o)} label={licenceLabel(o)} />
      </View>
      <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
        {(o.businesses.map((b) => b.name).join(', ') || 'No business yet')
          + ' · signed in ' + dev.ago(o.lastLoginAt)}
      </Text>
    </Pressable>
  );
}

/** A labelled bar, for the load, memory and disk figures. */
function Meter({ label, pct, detail }: { label: string; pct: number; detail: string }) {
  const { colors } = useTheme();
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const tone = p >= 85 ? colors.danger : p >= 70 ? colors.warn : colors.good;
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink }}>{label}</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{detail}</Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.sunk, overflow: 'hidden' }}>
        <View style={{ height: 8, borderRadius: 4, width: (p + '%') as `${number}%`, backgroundColor: tone }} />
      </View>
    </View>
  );
}

/** Requests per minute across the last hour, as plain bars. */
function Traffic({ history }: { history: ServerStats['requests']['history'] }) {
  const { colors } = useTheme();
  const max = Math.max(1, ...history.map((h) => h.n));
  if (!history.length) {
    return <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>No requests yet.</Text>;
  }
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 70, gap: 2 }}>
        {history.map((h) => (
          <View
            key={h.t}
            style={{
              flex: 1,
              height: Math.max(2, Math.round((h.n / max) * 70)),
              borderRadius: 2,
              backgroundColor: h.errors ? colors.danger : colors.accent,
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
          {new Date(history[0].t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>peak {max}/min</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>now</Text>
      </View>
    </View>
  );
}

/**
 * Plain-language advice from the live figures. Thresholds are deliberately
 * conservative: the point is to upscale before shops notice, not after.
 */
function advice(s: ServerStats): string[] {
  const out: string[] = [];
  const load = s.machine.load[1] / Math.max(1, s.machine.cpus);
  const mem = 1 - s.machine.memFree / s.machine.memTotal;
  const disk = s.machine.disk ? 1 - s.machine.disk.free / s.machine.disk.total : 0;
  const conns = s.database.connections / Math.max(1, s.database.max_connections);
  if (load > 0.7) out.push('CPU has averaged over 70% for five minutes. Add a core before it reaches 100%.');
  if (mem > 0.85) out.push('Memory is over 85% used. More RAM, or move Postgres to its own box.');
  if (disk > 0.8) out.push('Disk is over 80% full. Copy old backups off the box, then grow the disk.');
  if (conns > 0.6) out.push('Database connections are over 60% of the limit. Put PgBouncer in front.');
  if (s.requests.p95Ms > 800) out.push('The slowest 5% of requests take over 0.8s. Check the database figures below.');
  if (s.process.loopLagP99Ms > 200) out.push('The API is stalling for over 200ms at times. It is CPU-bound — more cores or a second instance.');
  if (s.requests.errors5m > 0) out.push(s.requests.errors5m + ' server error(s) in the last five minutes. Check the logs.');
  return out;
}

/* ================================================================
   The screen
   ================================================================ */

export default function DeveloperScreen() {
  const { colors } = useTheme();
  const { success, error } = useToast();
  const { developer, access } = useDeveloper();

  const [tab, setTab] = useState<Tab>('owners');
  const [owners, setOwners] = useState<Owner[] | null>(null);
  const [reports, setReports] = useState<Reports | null>(null);
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [backups, setBackups] = useState<Backup[] | null>(null);
  const [crashes, setCrashes] = useState<dev.Crashes | null>(null);
  const [openCrash, setOpenCrash] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Owner | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async (which: Tab) => {
    const a = await access();
    if (!a) { error('Your session has expired. Sign out and in again.'); return; }
    setLoading(true);
    try {
      if (which === 'owners') {
        const r = await dev.listOwners(a);
        if (r.ok) setOwners(r.value.owners); else error(r.error.message);
      } else if (which === 'reports') {
        const r = await dev.getReports(a);
        if (r.ok) setReports(r.value); else error(r.error.message);
      } else if (which === 'server') {
        const r = await dev.getServer(a);
        if (r.ok) setStats(r.value); else error(r.error.message);
      } else if (which === 'crashes') {
        const r = await dev.listCrashes(a);
        if (r.ok) setCrashes(r.value); else error(r.error.message);
      } else {
        const r = await dev.listBackups(a);
        if (r.ok) setBackups(r.value.backups); else error(r.error.message);
      }
    } finally {
      setLoading(false);
    }
  }, [access, error]);

  useEffect(() => { if (developer) void load(tab); }, [developer, tab]);

  // the server tab is live: polled every few seconds while it is on screen
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (polling.current) clearInterval(polling.current);
    if (developer && tab === 'server') {
      polling.current = setInterval(async () => {
        const a = await access();
        if (!a) return;
        const r = await dev.getServer(a);
        if (r.ok) setStats(r.value);
      }, 4000);
    }
    return () => { if (polling.current) clearInterval(polling.current); };
  }, [developer, tab, access]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (owners || []).filter((o) => !needle
      || o.email.toLowerCase().includes(needle)
      || (o.name || '').toLowerCase().includes(needle)
      || o.businesses.some((b) => b.name.toLowerCase().includes(needle)));
  }, [owners, q]);

  if (!developer) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16, justifyContent: 'center' }}>
        <Panel>
          <EmptyBlock icon="lock" title="Developers only" hint="This account is not on the server's developer list." />
        </Panel>
      </View>
    );
  }

  /* ------------------------------------------------------------ */

  const ownersTab = (
    <>
      <Button
        label="Add an owner and subscription"
        variant="pri"
        icon={<Icon name="plus" size={17} color={colors.accentInk} />}
        onPress={() => setAdding(true)}
      />
      <View style={{ height: 12 }} />
      <Search value={q} onChange={setQ} placeholder="Search email, name or business" />
      <View style={{ height: 12 }} />
      {owners && owners.length ? (
        <Panel flush>
          {shown.map((o, i) => (
            <OwnerRow key={o.id} o={o} onPress={() => setOpen(o)} last={i === shown.length - 1} />
          ))}
        </Panel>
      ) : (
        <Panel><EmptyBlock icon="user" title={owners ? 'No owners yet' : 'Loading…'} /></Panel>
      )}
    </>
  );

  const section = (title: string, list: Owner[], empty: string) => (
    <View style={{ marginTop: 18 }}>
      <SectionLabel right={<Badge tone="neutral" label={String(list.length)} />}>{title}</SectionLabel>
      {list.length ? (
        <Panel flush>
          {list.map((o, i) => <OwnerRow key={o.id} o={o} onPress={() => setOpen(o)} last={i === list.length - 1} />)}
        </Panel>
      ) : (
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, paddingHorizontal: 4 }}>{empty}</Text>
      )}
    </View>
  );

  const reportsTab = reports ? (
    <>
      <StatGrid items={[
        { icon: 'user', label: 'Owners', value: String(reports.totals.owners), tone: 'accent' },
        { icon: 'home', label: 'Businesses', value: String(reports.totals.businesses), tone: 'neutral' },
        { icon: 'check', label: 'Paying', value: String(reports.totals.paying), tone: 'good' },
        { icon: 'clock', label: 'On trial', value: String(reports.totals.trial), tone: 'accent' },
        { icon: 'alert', label: 'Expired', value: String(reports.totals.expired), tone: 'danger' },
        { icon: 'calendar', label: 'Ending soon', value: String(reports.totals.expiringSoon), tone: 'warn' },
      ]} />
      {section('Expired licences', reports.expired, 'Nobody has lapsed.')}
      {section('Ending within ' + reports.soonDays + ' days', reports.expiringSoon, 'Nothing ends in the next fortnight.')}
      {section('Trial users', reports.trial, 'Nobody is on a trial.')}
      {reports.blocked.length ? section('Blocked', reports.blocked, '') : null}
    </>
  ) : <Panel><EmptyBlock icon="chart" title="Loading…" /></Panel>;

  const serverTab = stats ? (() => {
    const s = stats;
    const loadPct = (s.machine.load[0] / Math.max(1, s.machine.cpus)) * 100;
    const memUsed = s.machine.memTotal - s.machine.memFree;
    const diskUsed = s.machine.disk ? s.machine.disk.total - s.machine.disk.free : 0;
    const tips = advice(s);
    return (
      <>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.good }} />
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
            Live · updates every few seconds · {new Date(s.at).toLocaleTimeString('en-GB')}
          </Text>
        </View>

        {tips.length ? (
          <View style={{ marginBottom: 14, gap: 8 }}>
            {tips.map((t) => <InfoBanner key={t} tone="warn" icon="alert" text={t} />)}
          </View>
        ) : (
          <View style={{ marginBottom: 14 }}>
            <InfoBanner tone="good" icon="check" text="Nothing needs upscaling right now." />
          </View>
        )}

        <SectionLabel>The machine</SectionLabel>
        <Panel>
          <Meter
            label="CPU"
            pct={loadPct}
            detail={s.machine.cpus + ' core' + (s.machine.cpus === 1 ? '' : 's') + ' · load ' + s.machine.load.map((x) => x.toFixed(2)).join(' / ')}
          />
          <Meter label="Memory" pct={(memUsed / s.machine.memTotal) * 100} detail={dev.bytes(memUsed) + ' of ' + dev.bytes(s.machine.memTotal)} />
          {s.machine.disk ? (
            <Meter label="Disk" pct={(diskUsed / s.machine.disk.total) * 100} detail={dev.bytes(s.machine.disk.free) + ' free'} />
          ) : null}
          <DetailRow label="Up for" value={dev.duration(s.machine.uptime)} last />
        </Panel>

        <View style={{ height: 16 }} />
        <SectionLabel>Traffic, last hour</SectionLabel>
        <Panel>
          <Traffic history={s.requests.history} />
          <View style={{ height: 14 }} />
          <DetailRow label="Requests a minute" value={String(s.requests.perMinute)} />
          <DetailRow label="Average response" value={s.requests.avgMs + ' ms'} />
          <DetailRow label="Slowest 5%" value={s.requests.p95Ms + ' ms'} />
          <DetailRow label="Server errors, 5 min" value={String(s.requests.errors5m)} last />
        </Panel>

        <View style={{ height: 16 }} />
        <SectionLabel>The API process</SectionLabel>
        <Panel>
          <DetailRow label="Memory" value={dev.bytes(s.process.rss)} />
          <DetailRow label="Stalls (average / worst)" value={s.process.loopLagMs + ' / ' + s.process.loopLagP99Ms + ' ms'} />
          <DetailRow label="Running for" value={dev.duration(s.process.uptime)} last />
        </Panel>

        <View style={{ height: 16 }} />
        <SectionLabel>The database</SectionLabel>
        <Panel>
          <DetailRow label="Size" value={dev.bytes(s.database.size)} />
          <DetailRow label="Connections" value={s.database.connections + ' of ' + s.database.max_connections + ' (' + s.database.active + ' busy)'} />
          <DetailRow label="Read from memory" value={(s.database.cache_hit ?? 0) + '%'} last />
        </Panel>
        <View style={{ height: 10 }} />
        <Panel flush>
          {s.database.tables.map((t, i) => (
            <ListRow
              key={t.name}
              icon="doc"
              title={t.name}
              subtitle={t.rows.toLocaleString('en-GB') + ' rows'}
              value={dev.bytes(t.bytes)}
              last={i === s.database.tables.length - 1}
            />
          ))}
        </Panel>
      </>
    );
  })() : <Panel><EmptyBlock icon="chart" title="Loading…" /></Panel>;

  async function backupNow() {
    const a = await access();
    if (!a) return;
    setLoading(true);
    const r = await dev.runBackup(a);
    setLoading(false);
    if (!r.ok) { error(r.error.message); return; }
    success('Backed up every tenant — ' + dev.bytes(r.value.backup.bytes) + ' in ' + (r.value.backup.ms / 1000).toFixed(1) + 's');
    void load('backups');
  }

  async function share(b: Backup) {
    const a = await access();
    if (!a) return;
    setLoading(true);
    const r = await dev.downloadAndShare(a, b);
    setLoading(false);
    if (!r.ok) error(r.error.message);
  }

  const backupsTab = (
    <>
      <InfoBanner
        tone="warn"
        icon="alert"
        text="These dumps are written on the server they protect. If the server is lost, so are they — share each one somewhere else (Drive, email, a laptop). One is also made automatically every night."
      />
      <View style={{ height: 14 }} />
      <Button
        label="Back up every tenant now"
        variant="pri"
        loading={loading}
        icon={<Icon name="cloud" size={17} color={colors.accentInk} />}
        onPress={backupNow}
      />
      <View style={{ height: 18 }} />
      <SectionLabel right={<Badge tone="neutral" label={String((backups || []).length)} />}>Kept on the server</SectionLabel>
      {backups && backups.length ? (
        <Panel flush>
          {backups.map((b, i) => (
            <ListRow
              key={b.name}
              icon="shield"
              title={new Date(b.at).toLocaleString('en-GB')}
              subtitle={dev.bytes(b.bytes) + ' · tap to share off the server'}
              onPress={() => share(b)}
              last={i === backups.length - 1}
            />
          ))}
        </Panel>
      ) : (
        <Panel><EmptyBlock icon="shield" title={backups ? 'No backups yet' : 'Loading…'} /></Panel>
      )}
    </>
  );

  /* What broke on people's phones: the most frequent first, then every report, newest first. */
  const crashesTab = (
    <>
      <SectionLabel right={<Badge tone="neutral" label={String((crashes?.top || []).length)} />}>Most frequent · 30 days</SectionLabel>
      {crashes && crashes.top.length ? (
        <Panel flush>
          {crashes.top.map((t, i) => (
            <ListRow
              key={t.message}
              icon="alert"
              title={t.message}
              subtitle={t.n + (t.n === 1 ? ' time' : ' times') + ' · last ' + dev.ago(t.last) + (t.fatal ? ' · closed the app' : '')}
              last={i === crashes.top.length - 1}
            />
          ))}
        </Panel>
      ) : (
        <Panel><EmptyBlock icon="check" title={crashes ? 'Nothing reported' : 'Loading…'} hint={crashes ? 'No phone has reported a problem in the last 30 days.' : undefined} /></Panel>
      )}
      <View style={{ height: 18 }} />
      <SectionLabel right={<Badge tone="neutral" label={String((crashes?.reports || []).length)} />}>Latest</SectionLabel>
      {(crashes?.reports || []).map((c) => {
        const expanded = openCrash === c.id;
        return (
          <Pressable
            key={c.id}
            onPress={() => setOpenCrash(expanded ? null : c.id)}
            style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: c.fatal ? colors.danger : colors.line, padding: 13, marginBottom: 8 }}
          >
            <Text numberOfLines={expanded ? undefined : 2} style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink }}>{c.message}</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 4 }}>
              {[dev.ago(c.received_at), c.kind, c.route ? 'on ' + c.route : '', c.device, c.os_version ? 'Android ' + c.os_version : '', c.app_version ? 'app ' + c.app_version : '', c.email || '']
                .filter(Boolean).join(' · ')}
            </Text>
            {expanded && c.stack ? (
              <Text selectable style={{ fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 17, color: colors.soft, marginTop: 10 }}>{c.stack.slice(0, 4000)}</Text>
            ) : null}
          </Pressable>
        );
      })}
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SegTabs
        value={tab}
        onChange={setTab}
        options={[
          { v: 'owners', l: 'Owners' },
          { v: 'reports', l: 'Reports' },
          { v: 'server', l: 'Server' },
          { v: 'backups', l: 'Backups' },
          { v: 'crashes', l: 'Crashes' },
        ]}
      />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading && tab !== 'server'} onRefresh={() => load(tab)} />}
      >
        {tab === 'owners' ? ownersTab : tab === 'reports' ? reportsTab : tab === 'server' ? serverTab : tab === 'crashes' ? crashesTab : backupsTab}
      </ScrollView>

      <AddOwnerSheet
        visible={adding}
        onClose={() => setAdding(false)}
        access={access}
        onAdded={() => { setAdding(false); void load('owners'); }}
      />
      <OwnerSheet
        owner={open}
        onClose={() => setOpen(null)}
        access={access}
        onChanged={() => { setOpen(null); void load(tab); }}
      />
    </View>
  );
}

/* ================================================================
   One owner — details, licensing, blocking
   ================================================================ */

const PERIODS: Array<{ v: string; l: string; days: number | null }> = [
  { v: '30', l: '1 month', days: 30 },
  { v: '90', l: '3 months', days: 90 },
  { v: '180', l: '6 months', days: 180 },
  { v: '365', l: '1 year', days: 365 },
  { v: 'life', l: 'Lifetime', days: null },
];

/* ================================================================
   Adding an owner by email, with a subscription
   ================================================================ */

function AddOwnerSheet({ visible, onClose, access, onAdded }: {
  visible: boolean; onClose: () => void;
  access: () => Promise<string | null>; onAdded: () => void;
}) {
  const { colors } = useTheme();
  const { success, error } = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [plan, setPlan] = useState('pro');
  const [period, setPeriod] = useState('365');
  const [seats, setSeats] = useState('2');
  const [invite, setInvite] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) { setEmail(''); setName(''); setPlan('pro'); setPeriod('365'); setSeats('2'); setInvite(true); }
  }, [visible]);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function save() {
    const days = PERIODS.find((p) => p.v === period)?.days ?? 365;
    const n = Math.max(1, Math.min(100, Number(seats) || 1));
    const a = await access();
    if (!a) return;
    setBusy(true);
    const r = await dev.addOwner(a, { email: email.trim().toLowerCase(), name: name.trim() || undefined, plan, days, seats: n, invite });
    setBusy(false);
    if (!r.ok) { error(r.error.message); return; }
    const who = email.trim().toLowerCase();
    success(
      (r.value.created ? who + ' added' : who + ' already had an account — subscription granted')
      + (r.value.invited ? ' · invitation sent' : r.value.inviteError ? ' · ' + r.value.inviteError : ''),
    );
    onAdded();
  }

  const chip = (label: string, on: boolean, press: () => void) => (
    <Pressable
      key={label}
      onPress={press}
      style={{
        paddingVertical: 9, paddingHorizontal: 13, borderRadius: radius.pill, borderWidth: 1,
        borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accent : colors.surface,
      }}
    >
      <Text style={{ fontFamily: on ? fonts.uiBold : fonts.uiSemi, fontSize: 12.5, color: on ? colors.accentInk : colors.soft }}>{label}</Text>
    </Pressable>
  );

  return (
    <Sheet
      visible={visible}
      title="Add an owner"
      subtitle="An account and a subscription, in one step"
      icon="user"
      onClose={onClose}
      full
      footer={<Button label="Add and grant" variant="pri" loading={busy} disabled={!valid || busy} onPress={save} />}
    >
      <Field icon="user" label="Owner's email *" value={email} onChangeText={setEmail} autoCapitalize="none" placeholder="name@example.com" />
      <Field icon="pencil" label="Name (optional)" value={name} onChangeText={setName} />
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginBottom: 8 }}>Plan</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {['trial', 'starter', 'pro'].map((p) => chip(p.charAt(0).toUpperCase() + p.slice(1), plan === p, () => setPlan(p)))}
      </View>
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginTop: 14, marginBottom: 8 }}>For how long, from today</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {PERIODS.map((p) => chip(p.l, period === p.v, () => setPeriod(p.v)))}
      </View>
      <View style={{ height: 14 }} />
      <Field icon="phone" label="Devices allowed" value={seats} onChangeText={setSeats} numeric maxLength={3} />
      <Pressable onPress={() => setInvite(!invite)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
        <View style={{
          width: 22, height: 22, borderRadius: 6, borderWidth: 1.5,
          borderColor: invite ? colors.accent : colors.lineHard, backgroundColor: invite ? colors.accent : 'transparent',
          alignItems: 'center', justifyContent: 'center',
        }}>
          {invite ? <Icon name="check" size={14} color={colors.accentInk} /> : null}
        </View>
        <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 12.5, color: colors.ink }}>
          Email them how to get in (Google, or "Forgot password" to set one)
        </Text>
      </Pressable>
    </Sheet>
  );
}

function OwnerSheet({ owner, onClose, access, onChanged }: {
  owner: Owner | null; onClose: () => void;
  access: () => Promise<string | null>; onChanged: () => void;
}) {
  const { colors } = useTheme();
  const { success, error } = useToast();
  const [plan, setPlan] = useState('pro');
  const [period, setPeriod] = useState('365');
  const [seats, setSeats] = useState('2');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!owner) return;
    setPlan(owner.licence?.plan === 'trial' ? 'pro' : owner.licence?.plan || 'pro');
    setSeats(String(owner.licence?.seats || 2));
    setPeriod('365');
    setReason(owner.blockedReason || '');
  }, [owner?.id]);

  if (!owner) return null;
  const o = owner;

  async function grant() {
    const days = PERIODS.find((p) => p.v === period)?.days ?? 365;
    const n = Math.max(1, Math.min(100, Number(seats) || 1));
    const what = plan.toUpperCase() + ', ' + (days === null ? 'lifetime' : PERIODS.find((p) => p.v === period)!.l) + ', ' + n + ' device' + (n === 1 ? '' : 's');
    Alert.alert('License ' + o.email + '?', what, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Grant',
        onPress: async () => {
          const a = await access();
          if (!a) return;
          setBusy(true);
          const r = await dev.grantLicence(a, o.id, { plan, days, seats: n });
          setBusy(false);
          if (!r.ok) { error(r.error.message); return; }
          success(o.email + ' licensed — ' + what + '. Their phones pick it up at their next check-in.');
          onChanged();
        },
      },
    ]);
  }

  async function toggleBlock() {
    const blocking = !o.blocked;
    Alert.alert(
      blocking ? 'Block ' + o.email + '?' : 'Unblock ' + o.email + '?',
      blocking
        ? 'They are signed out everywhere, cannot sign back in, and their phones stop recording at their next check-in. Their books stay on their phones.'
        : 'They can sign in and record again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: blocking ? 'Block' : 'Unblock',
          style: blocking ? 'destructive' : 'default',
          onPress: async () => {
            const a = await access();
            if (!a) return;
            setBusy(true);
            const r = await dev.setBlocked(a, o.id, blocking, reason.trim() || undefined);
            setBusy(false);
            if (!r.ok) { error(r.error.message); return; }
            success(blocking ? o.email + ' is blocked' : o.email + ' is unblocked');
            onChanged();
          },
        },
      ],
    );
  }

  const chip = (label: string, on: boolean, press: () => void) => (
    <Pressable
      key={label}
      onPress={press}
      style={{
        paddingVertical: 9, paddingHorizontal: 13, borderRadius: radius.pill, borderWidth: 1,
        borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accent : colors.surface,
      }}
    >
      <Text style={{ fontFamily: on ? fonts.uiBold : fonts.uiSemi, fontSize: 12.5, color: on ? colors.accentInk : colors.soft }}>{label}</Text>
    </Pressable>
  );

  return (
    <Sheet visible title={o.email} icon="user" onClose={onClose} full>
      <Panel>
        <DetailRow label="Name" value={o.name || '—'} />
        <DetailRow label="Joined" value={new Date(o.createdAt).toLocaleDateString('en-GB')} />
        <DetailRow label="Last signed in" value={o.lastLoginAt ? new Date(o.lastLoginAt).toLocaleString('en-GB') : 'Never'} />
        <DetailRow label="Last opened the app" value={dev.ago(o.lastSeenAt)} />
        <DetailRow label="Devices" value={String(o.devices)} />
        <DetailRow label="Data on the server" value={dev.bytes(o.bytes) + ' · ' + o.ops.toLocaleString('en-GB') + ' records'} last />
      </Panel>

      <View style={{ height: 14 }} />
      <SectionLabel>Businesses under this email</SectionLabel>
      <Panel flush>
        {o.businesses.length ? o.businesses.map((b, i) => (
          <ListRow key={b.id} icon="home" title={b.name} subtitle={'Created ' + new Date(b.created).toLocaleDateString('en-GB')} last={i === o.businesses.length - 1} />
        )) : <ListRow icon="home" title="None yet" subtitle="Appears after the owner's first sync" last />}
      </Panel>

      <View style={{ height: 14 }} />
      <SectionLabel>Current licence</SectionLabel>
      <Panel>
        <DetailRow label="Plan" value={o.licence ? o.licence.plan + ' · ' + o.licence.term : 'None'} />
        <DetailRow label="Status" value={o.blocked ? 'Blocked' : o.licence?.status || '—'} />
        <DetailRow label="Devices allowed" value={String(o.licence?.seats ?? '—')} />
        <DetailRow
          label="Ends"
          value={!o.licence ? '—' : o.licence.daysLeft === null ? 'Never (lifetime)'
            : new Date(o.licence.expiresAt!).toLocaleDateString('en-GB') + ' (' + o.licence.daysLeft + ' days)'}
          last
        />
      </Panel>

      <View style={{ height: 14 }} />
      <SectionLabel>Grant a licence</SectionLabel>
      <Panel>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginBottom: 8 }}>Plan</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {['trial', 'starter', 'pro'].map((p) => chip(p.charAt(0).toUpperCase() + p.slice(1), plan === p, () => setPlan(p)))}
        </View>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginTop: 14, marginBottom: 8 }}>For how long, from today</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {PERIODS.map((p) => chip(p.l, period === p.v, () => setPeriod(p.v)))}
        </View>
        <View style={{ height: 14 }} />
        <Field icon="phone" label="Devices allowed" value={seats} onChangeText={setSeats} numeric maxLength={3} />
        <Button label="Grant licence" variant="pri" loading={busy} icon={<Icon name="check" size={17} color={colors.accentInk} />} onPress={grant} />
      </Panel>

      <View style={{ height: 14 }} />
      <SectionLabel>{o.blocked ? 'Blocked' : 'Block this account'}</SectionLabel>
      <Panel>
        <Field icon="pencil" label="Reason (kept on record)" value={reason} onChangeText={setReason} placeholder="Why, for the record" />
        <Button
          label={o.blocked ? 'Unblock account' : 'Block account'}
          variant={o.blocked ? 'default' : 'dngr'}
          loading={busy}
          onPress={toggleBlock}
        />
      </Panel>
    </Sheet>
  );
}
