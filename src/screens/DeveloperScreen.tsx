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
import { View, Text, Alert, RefreshControl } from 'react-native';
import ScrollView from '../components/KeyScroll';
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
import { EDITIONS, EDITION_LIST, Edition } from '../data/editions';
import { money0 } from '../data/helpers';
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

/** Retail, Restaurant or Pharmacy, with what each one is and costs. */
function EditionPick({ value, onChange, plan }: { value: Edition; onChange: (e: Edition) => void; plan: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 8, marginBottom: 6 }}>
      {EDITION_LIST.map((e) => {
        const d = EDITIONS[e];
        const on = value === e;
        const p = d.plans[plan === 'starter' ? 'starter' : 'pro'];
        return (
          <Pressable key={e} onPress={() => onChange(e)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 4, borderWidth: 1.4, borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accentSoft : colors.surface }}>
            <Icon name={d.icon} size={20} color={colors.ink} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 13.5, color: colors.ink }}>{d.name}</Text>
              <Text numberOfLines={2} style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 2 }}>{d.tagline}</Text>
              {plan !== 'trial' ? <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: colors.soft, marginTop: 2 }}>{p.name}: {money0(p.prices.month)}/month · {money0(p.prices.year)}/year</Text> : null}
            </View>
            {on ? <Icon name="check" size={18} color={colors.accent} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function licenceLabel(o: Owner): string {
  if (o.blocked) return 'Blocked';
  if (!o.licence) return 'No licence';
  const l = o.licence;
  const name = (EDITIONS[(l.edition || 'retail') as Edition]?.name || 'Retail') + ' ' + l.plan.charAt(0).toUpperCase() + l.plan.slice(1);
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
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>
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
            style={{ backgroundColor: colors.surface, borderRadius: 4, borderWidth: 1, borderColor: c.fatal ? colors.danger : colors.line, padding: 13, marginBottom: 8 }}
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
  const [edition, setEdition] = useState<Edition>('retail');
  const [period, setPeriod] = useState('365');
  const [seats, setSeats] = useState('2');
  const [businesses, setBusinesses] = useState('');
  const [invite, setInvite] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) { setEmail(''); setName(''); setPlan('pro'); setEdition('retail'); setPeriod('365'); setSeats('2'); setInvite(true); }
  }, [visible]);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function save() {
    const days = PERIODS.find((p) => p.v === period)?.days ?? 365;
    const n = Math.max(1, Math.min(100, Number(seats) || 1));
    const a = await access();
    if (!a) return;
    setBusy(true);
    const r = await dev.addOwner(a, { email: email.trim().toLowerCase(), name: name.trim() || undefined, plan, days, seats: n, invite, edition, businesses: businesses.trim() ? Number(businesses) : null });
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
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginBottom: 8 }}>Edition</Text>
      <EditionPick value={edition} onChange={setEdition} plan={plan} />
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginTop: 8, marginBottom: 8 }}>Plan</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {['trial', 'starter', 'pro'].map((p) => chip(p.charAt(0).toUpperCase() + p.slice(1), plan === p, () => setPlan(p)))}
      </View>
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginTop: 14, marginBottom: 8 }}>For how long, from today</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {PERIODS.map((p) => chip(p.l, period === p.v, () => setPeriod(p.v)))}
      </View>
      <View style={{ height: 14 }} />
      <Field icon="phone" label="Devices allowed" value={seats} onChangeText={setSeats} numeric maxLength={3} />
      <Field icon="home" label={'Businesses allowed · blank = ' + (plan === 'pro' ? '5 (Pro)' : '1 (' + plan + ')')} value={businesses} onChangeText={setBusinesses} numeric money={false} maxLength={2} />
      <Pressable onPress={() => setInvite(!invite)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
        <View style={{
          width: 22, height: 22, borderRadius: 4, borderWidth: 1.5,
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
  const [edition, setEdition] = useState<Edition>('retail');
  const [period, setPeriod] = useState('365');
  const [seats, setSeats] = useState('2');
  const [businesses, setBusinesses] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!owner) return;
    setPlan(owner.licence?.plan === 'trial' ? 'pro' : owner.licence?.plan || 'pro');
    setSeats(String(owner.licence?.seats || 2));
    setEdition(((owner.licence?.edition || 'retail') as Edition));
    setPeriod('365');
    setReason(owner.blockedReason || '');
  }, [owner?.id]);

  if (!owner) return null;
  const o = owner;

  async function grant() {
    const days = PERIODS.find((p) => p.v === period)?.days ?? 365;
    const n = Math.max(1, Math.min(100, Number(seats) || 1));
    const what = EDITIONS[edition].name + ' ' + plan.toUpperCase() + ', ' + (days === null ? 'lifetime' : PERIODS.find((p) => p.v === period)!.l) + ', ' + n + ' device' + (n === 1 ? '' : 's');
    Alert.alert('License ' + o.email + '?', what, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Grant',
        onPress: async () => {
          const a = await access();
          if (!a) return;
          setBusy(true);
          const r = await dev.grantLicence(a, o.id, { plan, days, seats: n, edition, businesses: businesses.trim() ? Number(businesses) : null });
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
        <DetailRow label="Edition" value={o.licence ? EDITIONS[(o.licence.edition || 'retail') as Edition]?.name || 'Retail' : '—'} />
        <DetailRow label="Plan" value={o.licence ? o.licence.plan + ' · ' + o.licence.term : 'None'} />
        <DetailRow label="Status" value={o.blocked ? 'Blocked' : o.licence?.status || '—'} />
        <DetailRow label="Devices allowed" value={String(o.licence?.seats ?? '—')} />
        <DetailRow label="Businesses" value={(o.businesses?.length ?? 0) + ' of ' + (o.licence?.maxBusinesses ?? '—') + ' allowed'} />
        <DetailRow
          label="Ends"
          value={!o.licence ? '—' : o.licence.daysLeft === null ? 'Never (lifetime)'
            : new Date(o.licence.expiresAt!).toLocaleDateString('en-GB') + ' (' + o.licence.daysLeft + ' days)'}
          last
        />
      </Panel>

      <SubscriptionPanel ownerId={o.id} access={access} onChanged={onChanged} />

      <View style={{ height: 14 }} />
      <SectionLabel>Grant a licence</SectionLabel>
      <Panel>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginBottom: 8 }}>Edition</Text>
        <EditionPick value={edition} onChange={setEdition} plan={plan} />
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginTop: 8, marginBottom: 8 }}>Plan</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {['trial', 'starter', 'pro'].map((p) => chip(p.charAt(0).toUpperCase() + p.slice(1), plan === p, () => setPlan(p)))}
        </View>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginTop: 14, marginBottom: 8 }}>For how long, from today</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {PERIODS.map((p) => chip(p.l, period === p.v, () => setPeriod(p.v)))}
        </View>
        <View style={{ height: 14 }} />
        <Field icon="phone" label="Devices allowed" value={seats} onChangeText={setSeats} numeric maxLength={3} />
      <Field icon="home" label={'Businesses allowed · blank = ' + (plan === 'pro' ? '5 (Pro)' : '1 (' + plan + ')')} value={businesses} onChangeText={setBusinesses} numeric money={false} maxLength={2} />
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

/**
 * One owner's subscription: what is owed and paid, money received (for a
 * licence granted without amounts, or paid in parts), the client's own fees —
 * which their Plan & License shows instead of the standard prices — and every
 * licence they have held, each of which can be reset and reinstated.
 */
function SubscriptionPanel({ ownerId, access, onChanged }: { ownerId: string; access: () => Promise<string | null>; onChanged: () => void }) {
  const { colors } = useTheme();
  const { success, error } = useToast();
  const [sub, setSub] = useState<dev.Subscription | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Mobile money');
  const [note, setNote] = useState('');
  const [licFee, setLicFee] = useState('');
  const [renFee, setRenFee] = useState('');
  const [feeNote, setFeeNote] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const a = await access(); if (!a) return;
    const r = await dev.subscription(a, ownerId);
    if (!r.ok) { error(r.error.message); return; }
    setSub(r.value);
    setLicFee(r.value.fees?.licence_fee != null ? String(Math.round(Number(r.value.fees.licence_fee))) : '');
    setRenFee(r.value.fees?.renewal_fee != null ? String(Math.round(Number(r.value.fees.renewal_fee))) : '');
    setFeeNote(r.value.fees?.note || '');
  }, [ownerId]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  const run = async (fn: (a: string) => Promise<{ ok: boolean; error?: { message: string } } & any>, done: string) => {
    const a = await access(); if (!a) return;
    setBusy(true);
    const r = await fn(a);
    setBusy(false);
    if (!r.ok) { error(r.error?.message || 'That did not go through.'); return; }
    success(done); await load(); onChanged();
  };
  const fmt = (n: number | string | null | undefined) => money0(Number(n) || 0);
  const day = (t?: string | null) => (t ? new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
  if (!sub) return <View style={{ marginTop: 14 }}><SectionLabel>Subscription</SectionLabel><Panel><Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint }}>Loading…</Text></Panel></View>;
  return (
    <View style={{ marginTop: 14 }}>
      <SectionLabel>Subscription</SectionLabel>
      <Panel>
        <DetailRow label="Fees on their licences (with VAT)" value={fmt(sub.totals.due)} />
        <DetailRow label="Received" value={fmt(sub.totals.paid)} />
        <DetailRow label={sub.totals.balance > 0 ? 'Still owed' : 'Paid ahead'} value={fmt(Math.abs(sub.totals.balance))} bold last />
      </Panel>

      <View style={{ height: 10 }} />
      <Panel>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: colors.ink, marginBottom: 8 }}>Receive money</Text>
        <Field icon="cash" label="Amount received" value={amount} onChangeText={setAmount} numeric money />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {['Mobile money', 'Bank', 'Cash'].map((m) => (
            <Pressable key={m} onPress={() => setMethod(m)} style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: method === m ? colors.accent : colors.line, backgroundColor: method === m ? colors.accentSoft : colors.surface }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: method === m ? colors.accent : colors.soft }}>{m}</Text>
            </Pressable>
          ))}
        </View>
        <Field icon="pencil" label="Note" value={note} onChangeText={setNote} placeholder="Reference, period it covers…" />
        <Button label="Record payment" variant="pri" loading={busy}
          onPress={() => { const n = Number(amount) || 0; if (!n) { error('Enter the amount received.'); return; }
            void run((a) => dev.addPayment(a, ownerId, { amount: n, method, note: note.trim() || undefined }), fmt(n) + ' recorded').then(() => { setAmount(''); setNote(''); }); }} />
        {sub.payments.length ? (
          <View style={{ marginTop: 12 }}>
            {sub.payments.map((p, i) => (
              <Pressable key={p.id} onLongPress={() => Alert.alert('Remove this payment?', fmt(p.amount) + ' on ' + day(p.received_at), [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void run((a) => dev.removePayment(a, p.id), 'Payment removed') }])}
                style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>{day(p.received_at)} · {p.method || 'Payment'}</Text>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{[p.note, p.received_by].filter(Boolean).join(' · ')}</Text>
                </View>
                <Text style={{ fontFamily: fonts.monoSemi, fontSize: 13, color: colors.good }}>{fmt(p.amount)}</Text>
              </Pressable>
            ))}
            <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 4 }}>Hold a payment to remove it.</Text>
          </View>
        ) : null}
      </Panel>

      <View style={{ height: 10 }} />
      <Panel>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: colors.ink }}>Their own fees</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 2, marginBottom: 8 }}>Shown in their Plan & License instead of the standard prices. Empty both to go back to the standard prices.</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Field label="Licence fee" value={licFee} onChangeText={setLicFee} numeric money /></View>
          <View style={{ flex: 1 }}><Field label="Renewal fee" value={renFee} onChangeText={setRenFee} numeric money /></View>
        </View>
        <Field icon="pencil" label="Note shown to them" value={feeNote} onChangeText={setFeeNote} placeholder="e.g. Agreed rate for two branches" />
        <Button label="Save their fees" loading={busy}
          onPress={() => void run((a) => dev.setFees(a, ownerId, { licenceFee: licFee.trim() ? Number(licFee) : null, renewalFee: renFee.trim() ? Number(renFee) : null, note: feeNote.trim() || undefined }),
            licFee.trim() || renFee.trim() ? 'Their fees are set' : 'Back to the standard prices')} />
      </Panel>

      <View style={{ height: 10 }} />
      <Panel>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: colors.ink, marginBottom: 6 }}>Licence history</Text>
        {sub.licences.map((l, i) => {
          const reset = l.status === 'revoked';
          return (
            <View key={l.id} style={{ paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line, gap: 3 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{l.plan.toUpperCase()} · {l.term}{l.edition && l.edition !== 'retail' ? ' · ' + l.edition : ''}</Text>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, color: reset ? colors.danger : l.status === 'active' ? colors.good : colors.warn }}>{reset ? 'RESET' : l.status.toUpperCase()}</Text>
              </View>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{day(l.started_at)} → {l.expires_at ? day(l.expires_at) : 'lifetime'} · by {l.issued_by || '—'}</Text>
              {l.renewal_fee || l.installation_fee ? <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>Renewal {fmt(l.renewal_fee)} · installation {fmt(l.installation_fee)}</Text> : null}
              {reset ? <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.danger }}>Reset {day(l.reset_at)} by {l.reset_by}{l.reset_reason ? ' — ' + l.reset_reason : ''}</Text> : null}
              {l.reinstated_at && !reset ? <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.good }}>Reinstated {day(l.reinstated_at)}</Text> : null}
              <View style={{ flexDirection: 'row', marginTop: 4 }}>
                {reset ? (
                  <Pressable onPress={() => Alert.alert('Reinstate this licence?', 'It goes back to ' + (l.prev_status || 'active') + ' and their apps pick it up at the next check-in.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Reinstate', onPress: () => void run((a) => dev.reinstateLicence(a, l.id), 'Licence reinstated') }])}>
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.accent }}>Reinstate</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={() => Alert.prompt
                    ? Alert.prompt('Reset this licence?', 'It stops working at their next check-in. Why? (kept in the history)', (why) => void run((a) => dev.resetLicence(a, l.id, why), 'Licence reset'))
                    : Alert.alert('Reset this licence?', 'It stops working at their next check-in. You can reinstate it from here.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Reset', style: 'destructive', onPress: () => void run((a) => dev.resetLicence(a, l.id), 'Licence reset') }])}>
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.danger }}>Reset</Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}
        {!sub.licences.length ? <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint }}>No licence yet.</Text> : null}
      </Panel>
    </View>
  );
}
