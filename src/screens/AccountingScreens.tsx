/**
 * The accounting module: a real chart of accounts, a ledger you can read back
 * posting by posting, a manual double-entry form, and a trial balance that
 * proves the books tie out.
 *
 * Every posting the app already makes names its ledger, so these screens read
 * the same journal the reports do — nothing here is a parallel set of figures.
 */
import React, { useMemo, useState } from 'react';
import { useCan, Denied } from '../components/Gate';
import { View, Text, ScrollView, FlatList, Platform, Alert } from 'react-native';
import { Pressable } from '../components/Press';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from '../components/Toast';
import {
  Panel, Badge, StatGrid, SectionLabel, FilterChips, EmptyBlock, Search, InfoBanner,
  Button, Field, SelectField, SegPill, StickyBar, DetailRow, TopTabs, ListRow, FieldShell,
} from '../components/ui';
import SegmentSlider from '../components/SegmentSlider';
import LedgerPicker from '../components/LedgerPicker';
import { Icon, IconName } from '../components/icons';
import Sheet from '../components/Sheet';
import { useWho } from '../components/WhoSheet';
import { useGo } from '../nav/navigate';
import { useOwnerPin } from '../components/OwnerPin';
import {
  LEDGER_TYPES, LedgerType, Ledger, ledgerBalance, ledgerBalances, ledgerHistory, trialBalance, debitPositive,
} from '../data/coa';
import type { JournalLine } from '../data/types';
import { candidateJournalEntries, importStatementCsv } from '../data/reconciliation';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

const TYPE_ICON: Record<LedgerType, IconName> = {
  asset: 'box', liability: 'card', equity: 'owner', income: 'coins', expense: 'money',
};
const TYPE_TONE: Record<LedgerType, 'good' | 'warn' | 'danger' | 'accent' | 'neutral'> = {
  asset: 'accent', liability: 'warn', equity: 'neutral', income: 'good', expense: 'danger',
};

const num = (v: string) => Number(String(v).replace(/[^0-9.]/g, '')) || 0;

/* ================= chart of accounts ================= */

export function ChartOfAccountsScreen(p: any) {
  // checked before the body runs, so nothing inside it can post first
  const allowed = useCan('finance.manage_accounts');
  if (!allowed) return <Denied title="Accounting is closed to you" hint="The chart of accounts decides where every posting lands, so it needs the finance permission. Ask the owner to grant it." />;
  return <ChartOfAccountsScreenBody  />;
}

function ChartOfAccountsScreenBody() {
  const { colors } = useTheme();
  const { db, money, addLedger, updateLedger } = useAppData();
  const { success, error } = useToast();
  const go = useGo();

  const [q, setQ] = useState('');
  const [type, setType] = useState<'all' | LedgerType>('all');
  const [showOff, setShowOff] = useState(false);
  const [editing, setEditing] = useState<Ledger | null>(null);
  const [adding, setAdding] = useState(false);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LedgerType>('expense');

  const ledgers = db?.coa || [];

  // one pass over the journal for the whole list, not one per row
  const balances = useMemo(() => (db ? ledgerBalances(db) : new Map<string, number>()), [db]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ledgers
      .filter((l) => (showOff ? true : l.active))
      .filter((l) => (type === 'all' ? true : l.type === type))
      .filter((l) => !needle || l.name.toLowerCase().includes(needle) || l.code.includes(needle))
      .map((l) => ({ l, balance: balances.get(l.id) || 0 }));
  }, [ledgers, q, type, showOff, balances]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    ledgers.filter((l) => l.active).forEach((l) => { c[l.type] = (c[l.type] || 0) + 1; });
    return c;
  }, [ledgers]);

  function openAdd() {
    setCode(''); setName(''); setKind('expense');
    setAdding(true);
  }

  function saveNew() {
    if (!code.trim() || !name.trim()) { error('A ledger needs a code and a name.'); return; }
    if (ledgers.some((l) => l.code === code.trim())) { error('That code is already used.'); return; }
    addLedger({ code: code.trim(), name: name.trim(), type: kind });
    setAdding(false);
    success(name.trim() + ' added');
  }

  if (!db) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.l.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 110, flexGrow: 1 }}
        ListHeaderComponent={
          <View style={{ paddingTop: 14, gap: 14, marginBottom: 14 }}>
            <StatGrid
              items={[
                { icon: 'doc', label: 'Ledgers', value: String(ledgers.filter((l) => l.active).length), tone: 'accent' },
                { icon: 'chart', label: 'Postings', value: String(db.journal.length), tone: 'good' },
              ]}
            />
            <Search value={q} onChange={setQ} placeholder="Search name or code" />
            <FilterChips
              value={type}
              onChange={setType}
              options={[
                { v: 'all', l: 'All' },
                ...LEDGER_TYPES.map((t) => ({ v: t.v, l: t.l + ' ' + (counts[t.v] || 0) })),
              ]}
            />
            <Pressable
              onPress={() => setShowOff(!showOff)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}
            >
              <Icon name={showOff ? 'check' : 'box'} size={16} color={showOff ? colors.accent : colors.faint} />
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: showOff ? colors.accent : colors.faint }}>
                {showOff ? 'Showing deactivated' : 'Show deactivated too'}
              </Text>
            </Pressable>
          </View>
        }
        ListEmptyComponent={
          <Panel><EmptyBlock icon="doc" title="No ledger matches" /></Panel>
        }
        renderItem={({ item }) => {
          const { l, balance } = item;
          const tone = TYPE_TONE[l.type];
          const fg = tone === 'good' ? colors.good : tone === 'warn' ? colors.warn
            : tone === 'danger' ? colors.danger : tone === 'accent' ? colors.accent : colors.soft;
          const bg = tone === 'good' ? colors.goodSoft : tone === 'warn' ? colors.warnSoft
            : tone === 'danger' ? colors.dangerSoft : tone === 'accent' ? colors.accentSoft : colors.sunk;
          return (
            <Pressable
              onPress={() => go('LedgerDetail', { ledgerId: l.id })}
              onLongPress={() => setEditing(l)}
              style={{
                backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 14,
                marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12,
                opacity: l.active ? 1 : 0.55,
                shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2,
              }}
            >
              <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={TYPE_ICON[l.type]} size={20} color={fg} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{l.name}</Text>
                  {!l.active ? <Badge label="Off" tone="neutral" /> : null}
                </View>
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                  {l.code} · {l.type}{l.builtin ? ' · built in' : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 3 }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: balance < 0 ? colors.danger : colors.ink }}>
                  {money(Math.abs(balance))}
                </Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
                  {debitPositive(l.type) ? (balance < 0 ? 'credit' : 'debit') : (balance < 0 ? 'debit' : 'credit')}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />

      <StickyBar>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label="Trial balance" icon={<Icon name="chart" size={16} color={colors.ink} />} onPress={() => go('TrialBalance')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="New ledger" variant="pri" icon={<Icon name="plus" size={16} color={colors.accentInk} />} onPress={openAdd} />
          </View>
        </View>
      </StickyBar>

      {/* add */}
      <Sheet
        visible={adding}
        title="New ledger"
        icon="doc"
        onClose={() => setAdding(false)}
        footer={<Button label="Add ledger" variant="pri" onPress={saveNew} />}
      >
        <Field icon="doc" label="Code" value={code} onChangeText={setCode} placeholder="A free code number" numeric />
        <Field icon="tag" label="Ledger name" value={name} onChangeText={setName} placeholder="What this ledger is called" />
        <SelectField
          icon="chart"
          label="Type"
          value={kind}
          options={LEDGER_TYPES.map((t) => ({ v: t.v, l: t.l }))}
          onChange={(v) => setKind(v as LedgerType)}
        />
        <InfoBanner
          tone="neutral"
          icon="bulb"
          text="Assets and expenses rise on a debit. Income, liabilities and equity rise on a credit."
        />
      </Sheet>

      {/* edit / deactivate */}
      <Sheet
        visible={!!editing}
        title={editing?.name || 'Ledger'}
        subtitle={editing ? editing.code + ' · ' + editing.type : undefined}
        icon="pencil"
        onClose={() => setEditing(null)}
        footer={<Button label="Done" variant="pri" onPress={() => setEditing(null)} />}
      >
        {editing ? (
          <>
            <Field
              icon="tag"
              label="Ledger name"
              value={editing.name}
              onChangeText={(v) => setEditing({ ...editing, name: v })}
              onBlur={() => updateLedger(editing.id, { name: editing.name })}
            />
            <ListRow
              card
              icon="chart"
              title="Open its history"
              subtitle="Every posting, with a running balance"
              onPress={() => { const id = editing.id; setEditing(null); go('LedgerDetail', { ledgerId: id }); }}
            />
            {editing.builtin ? (
              <InfoBanner
                tone="neutral"
                icon="shield"
                text="This ledger is built in — the app posts to it automatically, so it can be renamed but not switched off."
              />
            ) : (
              <>
                <View style={{ height: 6 }} />
                <Button
                  label={editing.active ? 'Deactivate this ledger' : 'Reactivate this ledger'}
                  variant={editing.active ? 'dngr' : 'default'}
                  onPress={() => {
                    updateLedger(editing.id, { active: !editing.active });
                    success(editing.active ? editing.name + ' deactivated' : editing.name + ' active again');
                    setEditing(null);
                  }}
                />
                <View style={{ height: 10 }} />
                <InfoBanner
                  tone="warn"
                  text="Deactivating hides it from new entries. Its past postings stay in the books, so the history still adds up."
                />
              </>
            )}
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

/* ================= one ledger ================= */

type LedgerProps = NativeStackScreenProps<RootStackParamList, 'LedgerDetail'>;

export function LedgerDetailScreen(p: any) {
  // checked before the body runs, so nothing inside it can post first
  const allowed = useCan('finance.view');
  if (!allowed) return <Denied title="Ledgers are closed to you" hint="Ledger history shows every posting against an account. Ask the owner for the finance permission." />;
  return <LedgerDetailScreenBody {...p} />;
}

function LedgerDetailScreenBody({ route, navigation }: LedgerProps) {
  const { colors } = useTheme();
  const { db, money } = useAppData();
  const id = route.params.ledgerId;
  const l = (db?.coa || []).find((x) => x.id === id);

  const rows = useMemo(() => (db && l ? ledgerHistory(db, l.id) : []), [db, l]);

  React.useEffect(() => {
    navigation.setOptions({ title: l?.name || 'Ledger' });
  }, [navigation, l?.name]);

  if (!db || !l) return null;

  const dr = rows.reduce((s, r) => s + r.dr, 0);
  const cr = rows.reduce((s, r) => s + r.cr, 0);
  const opening = (db.journal || []).reduce((sum, e) => {
    if (new Date(e.ts).getTime() >= Date.now()) return sum;
    const before = e.lines.filter((line) => line.acc === l.id);
    return sum + before.reduce((a, line) => a + (line.dr || 0) - (line.cr || 0), 0);
  }, 0);
  const balance = ledgerBalance(db, l.id);
  const closing = opening + balance;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 }}
        ListHeaderComponent={
          <View style={{ paddingTop: 14, marginBottom: 14 }}>
            <Panel>
              <View style={{ alignItems: 'center', gap: 4 }}>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
                  {l.code} · {l.type}
                </Text>
                <Text style={{ fontFamily: fonts.uiExtra, fontSize: 32, letterSpacing: -0.8, color: balance < 0 ? colors.danger : colors.ink }}>
                  {money(Math.abs(balance))}
                </Text>
                <Badge
                  label={debitPositive(l.type) ? (balance < 0 ? 'Credit balance' : 'Debit balance') : (balance < 0 ? 'Debit balance' : 'Credit balance')}
                  tone={balance < 0 ? 'warn' : 'good'}
                />
              </View>
            </Panel>

            <View style={{ height: 16 }} />
            <StatGrid
              items={[
                { icon: 'clock', label: 'Opening', value: money(opening), tone: 'neutral' },
                { icon: 'down', label: 'Total debits', value: money(dr), tone: 'accent' },
                { icon: 'up', label: 'Total credits', value: money(cr), tone: 'warn' },
                { icon: 'check', label: 'Closing', value: money(closing), tone: 'good' },
              ]}
            />

            <View style={{ height: 20 }} />
            <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{rows.length} postings</Text>}>
              History
            </SectionLabel>
          </View>
        }
        ListEmptyComponent={
          <Panel>
            <EmptyBlock icon="clock" title="Nothing posted here yet" hint="Postings to this ledger will appear with a running balance." />
          </Panel>
        }
        renderItem={({ item }) => (
          <View
            style={{
              backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13,
              marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12,
              shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2,
            }}
          >
            <View style={{
              width: 40, height: 40, borderRadius: 13,
              backgroundColor: item.dr ? colors.accentSoft : colors.warnSoft,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name={item.dr ? 'down' : 'up'} size={19} color={item.dr ? colors.accent : colors.warn} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{item.memo}</Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                {new Date(item.ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                {' · '} {item.ref} · {db?.sales.some((s) => s.no === item.ref) ? 'Sales' : db?.purchases.some((p) => p.no === item.ref) ? 'Purchase' : 'Journal'}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 3 }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: item.dr ? colors.accent : colors.warn }}>
                {item.dr ? money(item.dr) : money(item.cr)}
              </Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>bal {money(item.balance)}</Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}

/* ================= manual journal entry ================= */

interface DraftLine { acc: string; dr: string; cr: string }

export function JournalEntryScreen(p: any) {
  // checked before the body runs, so nothing inside it can post first
  const allowed = useCan('finance.manage_accounts');
  if (!allowed) return <Denied title="Journal entries are owner work" hint="A journal entry writes straight into the books without a bill behind it, so it needs the finance permission." />;
  return <JournalEntryScreenBody {...p} />;
}

function JournalEntryScreenBody({ navigation }: NativeStackScreenProps<RootStackParamList, 'JournalEntry'>) {
  const { colors } = useTheme();
  const { db, money, postJournal } = useAppData();
  const { success, error } = useToast();
  const who = useWho('Who is posting this entry?');

  /** Simple posts one ledger against a contra account; advanced is free-form. */
  const [mode, setMode] = useState<'simple' | 'advanced'>('simple');
  const [side, setSide] = useState<'credit' | 'debit'>('debit');

  const [ledger, setLedger] = useState('');
  const [contra, setContra] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [partyName, setPartyName] = useState('');
  const [notes, setNotes] = useState('');
  const [at, setAt] = useState(() => new Date());
  const [picking, setPicking] = useState(false);

  const [lines, setLines] = useState<DraftLine[]>([
    { acc: '', dr: '', cr: '' },
    { acc: '', dr: '', cr: '' },
  ]);

  const active = (db?.coa || []).filter((l) => l.active);
  const cashish = active.filter((l) => l.type === 'asset');

  React.useEffect(() => {
    if (!contra && cashish.length) setContra(cashish[0].id);
  }, [cashish.length]);

  const amt = num(amount);

  /* advanced totals */
  const totalDr = lines.reduce((s, l) => s + num(l.dr), 0);
  const totalCr = lines.reduce((s, l) => s + num(l.cr), 0);
  const diff = totalDr - totalCr;
  const advBalanced = Math.abs(diff) < 0.01 && totalDr > 0;
  const advNamed = lines.every((l) => (!num(l.dr) && !num(l.cr)) ? true : !!l.acc);

  const simpleReady = !!ledger && !!contra && ledger !== contra && amt > 0 && !!memo.trim();
  const ready = mode === 'simple' ? simpleReady : (advBalanced && advNamed && !!memo.trim());

  function patch(i: number, p: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...p } : l)));
  }

  /** The two lines a simple entry posts. */
  function simpleLines(): JournalLine[] {
    return side === 'credit'
      ? [{ acc: ledger, cr: amt }, { acc: contra, dr: amt }]
      : [{ acc: ledger, dr: amt }, { acc: contra, cr: amt }];
  }

  function post() {
    const jl: JournalLine[] = mode === 'simple'
      ? simpleLines()
      : lines
        .filter((l) => l.acc && (num(l.dr) || num(l.cr)))
        .map((l) => (num(l.dr) ? { acc: l.acc, dr: num(l.dr) } : { acc: l.acc, cr: num(l.cr) }));

    const full = [memo.trim(), partyName.trim(), notes.trim()].filter(Boolean).join(' · ');

    who.ask((server) => {
      const ok = postJournal({ memo: full, ref: 'JNL', ts: at.toISOString(), lines: jl, userId: server.userId });
      if (!ok) { error('That entry does not balance.'); return; }
      success('Posted by ' + server.userName);
      navigation.goBack();
    });
  }

  if (!db) return null;

  const chosen = active.find((l) => l.id === ledger);
  const against = active.find((l) => l.id === contra);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 150 }} keyboardShouldPersistTaps="handled">
        <SegmentSlider
          value={mode}
          onChange={setMode}
          style={{ marginBottom: 12 }}
          options={[
            { v: 'simple', l: 'Simple', i: 'bulb' },
            { v: 'advanced', l: 'Advanced', i: 'chart' },
          ]}
        />

        <FieldShell
          label="Entry date"
          icon="calendar"
          onPress={() => setPicking(true)}
          style={{ marginBottom: 10 }}
          right={<Icon name="down" size={16} color={colors.faint} />}
        >
          <Text style={{ fontFamily: fonts.ui, fontSize: 15, color: colors.ink }}>
            {at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
          </Text>
        </FieldShell>

        {mode === 'simple' ? (
          <>
            {/* the two sides of the entry, both in view and both changeable */}
            <View style={{ borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: 12, marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', backgroundColor: colors.sunk, borderRadius: 12, padding: 3, marginBottom: 6 }}>
                {([
                  { v: 'debit' as const, l: 'Debit', tint: colors.accent },
                  { v: 'credit' as const, l: 'Credit', tint: colors.warn },
                ]).map((o) => {
                  const on = side === o.v;
                  return (
                    <Pressable
                      key={o.v}
                      onPress={() => setSide(o.v)}
                      style={{ flex: 1, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? colors.surface : 'transparent' }}
                    >
                      <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: on ? o.tint : colors.faint }}>{o.l}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <LedgerPicker
                label={side === 'debit' ? 'Ledger debited' : 'Ledger credited'}
                value={ledger}
                onChange={setLedger}
                canCreate
                style={{ marginBottom: 6 }}
              />
              <View style={{ alignItems: 'center', marginVertical: -4, zIndex: 1 }}>
                <Pressable
                  onPress={() => { const l = ledger; setLedger(contra); setContra(l); }}
                  accessibilityLabel="Swap the two ledgers"
                  style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icon name="swap" size={14} color={colors.accent} />
                </Pressable>
              </View>
              <LedgerPicker
                label={side === 'debit' ? 'Credited to' : 'Debited to'}
                value={contra}
                onChange={setContra}
                icon="bank"
                canCreate
                style={{ marginBottom: 0 }}
              />
            </View>

            <Field label="Amount" value={amount} onChangeText={setAmount} numeric decimal placeholder="0" style={{ marginBottom: 10 }} />
            <Field icon="doc" label="Description" value={memo} onChangeText={setMemo} placeholder="What it is for" style={{ marginBottom: 10 }} />
            <Field icon="user" label="Party name (optional)" value={partyName} onChangeText={setPartyName} style={{ marginBottom: 10 }} />
            <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline style={{ marginBottom: 10 }} />

            {simpleReady ? (
              <View style={{ borderRadius: 14, backgroundColor: colors.sunk, padding: 12, gap: 6 }}>
                <PostLine dr label={(side === 'debit' ? chosen : against)?.name || ''} value={money(amt)} />
                <PostLine label={(side === 'debit' ? against : chosen)?.name || ''} value={money(amt)} />
              </View>
            ) : null}
          </>
        ) : (
          <>
            <Field icon="doc" label="Description" value={memo} onChangeText={setMemo} placeholder="What this entry is for" style={{ marginBottom: 10 }} />

            <SectionLabel right={
              <Badge
                label={advBalanced ? 'Balanced' : diff > 0 ? money(diff) + ' to credit' : money(-diff) + ' to debit'}
                tone={advBalanced ? 'good' : 'danger'}
              />
            }>
              Postings
            </SectionLabel>

            {lines.map((l, i) => (
              <View key={i} style={{ borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: 10, marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <LedgerPicker compact label={'Line ' + (i + 1)} value={l.acc} onChange={(v) => patch(i, { acc: v })} canCreate style={{ marginBottom: 0 }} />
                  </View>
                  {lines.length > 2 ? (
                    <Pressable onPress={() => setLines(lines.filter((_, x) => x !== i))} hitSlop={8} style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center', marginTop: 6 }}>
                      <Icon name="trash" size={15} color={colors.danger} />
                    </Pressable>
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                  <Field compact label="Debit" value={l.dr} onChangeText={(v) => patch(i, { dr: v, cr: '' })} numeric decimal style={{ flex: 1, marginBottom: 0 }} />
                  <Field compact label="Credit" value={l.cr} onChangeText={(v) => patch(i, { cr: v, dr: '' })} numeric decimal style={{ flex: 1, marginBottom: 0 }} />
                </View>
              </View>
            ))}

            <Pressable
              onPress={() => setLines([...lines, { acc: '', dr: '', cr: '' }])}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 42, borderRadius: radius.md, borderWidth: 1.2, borderStyle: 'dashed', borderColor: colors.accent, marginBottom: 10 }}
            >
              <Icon name="plus" size={15} color={colors.accent} />
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.accent }}>Add a line</Text>
            </Pressable>

            <View style={{ borderRadius: 14, backgroundColor: colors.sunk, padding: 12, gap: 6 }}>
              <View style={{ flexDirection: 'row' }}>
                <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 13.5, color: colors.soft }}>Debits · credits</Text>
                <Text style={{ fontFamily: fonts.monoSemi, fontSize: 13.5, color: colors.ink }}>{money(totalDr)} · {money(totalCr)}</Text>
              </View>
              <View style={{ flexDirection: 'row' }}>
                <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 13.5, color: advBalanced ? colors.good : colors.danger }}>{advBalanced ? 'Balanced' : 'Out by'}</Text>
                <Text style={{ fontFamily: fonts.monoSemi, fontSize: 13.5, color: advBalanced ? colors.good : colors.danger }}>{advBalanced ? '✓' : money(Math.abs(diff))}</Text>
              </View>
            </View>
          </>
        )}

        {picking ? (
          <DateTimePicker
            value={at}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onDismiss={() => setPicking(false)}
            onValueChange={(_e, d) => { setPicking(false); if (d) setAt(d); }}
          />
        ) : null}
      </ScrollView>

      {who.sheet}

      <StickyBar>
        <Button
          label="Save entry"
          variant="pri"
          disabled={!ready}
          icon={<Icon name="check" size={17} color={colors.accentInk} />}
          onPress={post}
        />
      </StickyBar>
    </View>
  );
}

/* ================= trial balance ================= */

export function TrialBalanceScreen(p: any) {
  // checked before the body runs, so nothing inside it can post first
  const allowed = useCan('finance.view');
  if (!allowed) return <Denied title="Trial balance is closed to you" hint="The trial balance shows every account in the business. Ask the owner for the finance permission." />;
  return <TrialBalanceScreenBody  />;
}

function TrialBalanceScreenBody() {
  const { colors } = useTheme();
  const { db, money } = useAppData();
  const tb = useMemo(() => (db ? trialBalance(db) : null), [db]);

  if (!db || !tb) return null;
  const off = Math.abs(tb.totalDebit - tb.totalCredit) >= 0.01;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
      <StatGrid
        items={[
          { icon: 'down', label: 'Total debits', value: money(tb.totalDebit), tone: 'accent' },
          { icon: 'up', label: 'Total credits', value: money(tb.totalCredit), tone: 'warn' },
        ]}
      />

      <View style={{ height: 14 }} />
      <InfoBanner
        tone={off ? 'danger' : 'good'}
        icon={off ? 'alert' : 'check'}
        text={off
          ? 'The two sides differ by ' + money(Math.abs(tb.totalDebit - tb.totalCredit)) + '. A posting has gone in unbalanced.'
          : 'Debits equal credits — the books tie out.'}
      />

      <View style={{ height: 20 }} />
      <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{tb.rows.length} ledgers</Text>}>
        Trial balance
      </SectionLabel>

      <Panel>
        {tb.rows.map((r, i) => (
          <View
            key={r.ledger.id}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11,
              borderBottomWidth: i === tb.rows.length - 1 ? 0 : 1, borderBottomColor: colors.line,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{r.ledger.name}</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
                {r.ledger.code} · {r.ledger.type}
              </Text>
            </View>
            <Text style={{ width: 92, textAlign: 'right', fontFamily: fonts.monoSemi, fontSize: 12.5, color: r.debit ? colors.accent : colors.lineHard }}>
              {r.debit ? money(r.debit) : '—'}
            </Text>
            <Text style={{ width: 92, textAlign: 'right', fontFamily: fonts.monoSemi, fontSize: 12.5, color: r.credit ? colors.warn : colors.lineHard }}>
              {r.credit ? money(r.credit) : '—'}
            </Text>
          </View>
        ))}
        {!tb.rows.length ? <EmptyBlock icon="chart" title="Nothing posted yet" /> : null}
      </Panel>
    </ScrollView>
  );
}

/* ================= the accounting hub ================= */

export function AccountingHubScreen(p: any) {
  // checked before the body runs, so nothing inside it can post first
  const allowed = useCan('finance.view');
  if (!allowed) return <Denied title="Accounting is closed to you" hint="Ask the owner to grant you the finance permission." />;
  return <AccountingHubScreenBody  />;
}

export function ReconciliationScreen() {
  const { colors } = useTheme();
  const { db, money, importBankStatement, matchBankStatementLine, bankReconciliationSummary, completeBankReconciliation } = useAppData();
  const { success, error } = useToast();
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [closing, setClosing] = useState('');
  const [csv, setCsv] = useState('');

  if (!db) return null;
  const bankAccounts = db.accounts.filter((a) => a.type === 'bank');
  const selected = accountId || bankAccounts[0]?.id || '';
  const lines = (db.bankStatementLines || []).filter((x) => x.accountId === selected && x.date === date);
  const summary = bankReconciliationSummary(selected, date, date, Number(closing) || 0);

  function addLine() {
    const value = Number(amount);
    if (!selected) { error('Add a bank account first.'); return; }
    if (!description.trim() || !Number.isFinite(value)) { error('Enter a description and amount.'); return; }
    importBankStatement(selected, [{ date, description, amount: value }]);
    setDescription(''); setAmount('');
    success('Statement line added');
  }

  function importCsv() {
    if (!db) return;
    if (!selected) { error('Add a bank account first.'); return; }
    const parsed = importStatementCsv(db, selected, csv);
    if (parsed.rows.length) success(parsed.rows.length + ' statement line' + (parsed.rows.length === 1 ? '' : 's') + ' imported');
    if (parsed.errors.length) Alert.alert('Some rows were skipped', parsed.errors.join('\n'));
    if (!parsed.rows.length && !parsed.errors.length) error('Paste a CSV statement first.');
    setCsv('');
  }

  function finish() {
    if (!selected || !Number.isFinite(Number(closing))) { error('Enter the statement closing balance.'); return; }
    if (!completeBankReconciliation(selected, date, date, Number(closing))) {
      Alert.alert('Reconciliation not ready', 'Match every line and make sure the statement closing balance equals the book balance.');
      return;
    }
    success('Bank period reconciled');
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 36 }}>
      <InfoBanner tone="accent" icon="bank" text="Match the bank statement to posted journal entries. Differences must be explained before the period can be completed." />
      <View style={{ height: 16 }} />
      <SelectField label="Bank account" value={selected} options={bankAccounts.map((a) => ({ v: a.id, l: a.name }))} onChange={setAccountId} />
      <Field label="Statement date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
      <Panel style={{ padding: 12 }}>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink, marginBottom: 8 }}>Add statement line</Text>
        <Field label="Description" value={description} onChangeText={setDescription} placeholder="Bank charge or deposit" />
        <Field label="Amount" value={amount} onChangeText={setAmount} placeholder="250.00" numeric />
        <Button label="Add line" icon={<Icon name="plus" size={16} color={colors.ink} />} onPress={addLine} />
      </Panel>
      <View style={{ height: 12 }} />
      <Panel style={{ padding: 12 }}>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink, marginBottom: 8 }}>Paste CSV statement</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginBottom: 8 }}>Use Date, Description, Amount, or Debit and Credit columns.</Text>
        <Field value={csv} onChangeText={setCsv} placeholder={'Date,Description,Amount\n2026-09-20,Deposit,250'} multiline autoCapitalize="none" />
        <Button label="Import CSV rows" onPress={importCsv} />
      </Panel>

      <View style={{ height: 18 }} />
      <SectionLabel>Lines for {date}</SectionLabel>
      <Panel flush>
        {lines.map((line, index) => {
          const candidates = candidateJournalEntries(db, line);
          return (
            <View key={line.id} style={{ padding: 12, borderBottomWidth: index === lines.length - 1 ? 0 : 1, borderBottomColor: colors.line }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink }}>{line.description}</Text>
                  <Text style={{ fontFamily: fonts.mono, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>{money(line.amount)} · {line.status}</Text>
                </View>
                {line.status === 'matched' ? <Badge label="Matched" tone="good" /> : null}
              </View>
              {line.status === 'unmatched' && candidates.length ? (
                <View style={{ marginTop: 8, gap: 6 }}>
                  {candidates.slice(0, 3).map((entry) => (
                    <Pressable key={entry.id} onPress={() => matchBankStatementLine(line.id, entry.id)} style={{ paddingVertical: 7, paddingHorizontal: 9, backgroundColor: colors.accentSoft, borderRadius: radius.sm }}>
                      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink }}>Match {entry.memo} · {entry.ref}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {line.status === 'unmatched' && !candidates.length ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.warn, marginTop: 7 }}>No posted journal match found.</Text> : null}
            </View>
          );
        })}
        {!lines.length ? <EmptyBlock icon="bank" title="No statement lines yet" /> : null}
      </Panel>

      <View style={{ height: 18 }} />
      <SectionLabel>Reconciliation</SectionLabel>
      <Panel>
        <Field label="Statement closing balance" value={closing} onChangeText={setClosing} placeholder="0.00" numeric />
        <DetailRow label="Book closing" value={money(summary.bookClosing)} />
        <DetailRow label="Difference" value={money(summary.difference)} />
        <DetailRow label="Matched / unmatched" value={summary.matched + ' / ' + summary.unmatched} />
        <View style={{ height: 10 }} />
        <Button variant="pri" label="Complete reconciliation" disabled={summary.unmatched > 0 || Math.abs(summary.difference) > 0.005} onPress={finish} />
      </Panel>
    </ScrollView>
  );
}

function AccountingHubScreenBody() {
  const { colors } = useTheme();
  const { db, money, lockAccountingPeriod, unlockAccountingPeriod } = useAppData();
  const go = useGo();
  const owner = useOwnerPin();

  const tb = useMemo(() => (db ? trialBalance(db) : null), [db]);
  if (!db || !tb) return null;

  const off = Math.abs(tb.totalDebit - tb.totalCredit) >= 0.01;
  const locked = !!db.settings.accountingLock;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
      <StatGrid
        items={[
          { icon: 'doc', label: 'Ledgers', value: String((db.coa || []).filter((l) => l.active).length), tone: 'accent' },
          { icon: 'chart', label: 'Postings', value: String(db.journal.length), tone: 'good' },
          { icon: 'down', label: 'Debits', value: money(tb.totalDebit), tone: 'accent' },
          { icon: 'up', label: 'Credits', value: money(tb.totalCredit), tone: 'warn' },
        ]}
      />

      {off ? (
        <View style={{ marginTop: 14 }}>
          <InfoBanner tone="danger" text={'The books are out by ' + money(Math.abs(tb.totalDebit - tb.totalCredit)) + '.'} />
        </View>
      ) : null}

      <View style={{ height: 20 }} />
      <SectionLabel>{locked ? 'Accounting closed' : 'Books'}</SectionLabel>
      <Panel flush>
        <ListRow icon="doc" tone="accent" title="Chart of accounts" subtitle="Add, rename or switch off a ledger" onPress={() => go('ChartOfAccounts')} />
        <ListRow icon="pencil" tone="good" title="New journal entry" subtitle="Post a manual double entry" onPress={() => go('JournalEntry')} />
        <ListRow icon="chart" tone="warn" title="Trial balance" subtitle="Prove the books tie out" onPress={() => go('TrialBalance')} />
        <ListRow icon="clock" tone="accent" title="All postings" subtitle="Every entry the app has made" onPress={() => go('Journals')} last />
      </Panel>

      <View style={{ height: 20 }} />
      <SectionLabel>Period control</SectionLabel>
      <Panel>
        <InfoBanner
          tone={locked ? 'warn' : 'good'}
          icon={locked ? 'lock' : 'check'}
          text={locked
            ? 'The current accounting period is locked. No new postings can be made until it is reopened.'
            : 'The current accounting period is open and accepting new postings.'}
        />
        <View style={{ height: 10 }} />
        <Button
          label={locked ? 'Reopen accounting period' : 'Lock accounting period'}
          variant={locked ? 'default' : 'pri'}
          icon={<Icon name={locked ? 'unlock' : 'lock'} size={16} color={locked ? colors.ink : colors.accentInk} />}
          onPress={() => {
            const action = locked ? 'Reopen the current accounting period so new postings can be made again.' : 'Lock the current accounting period so no new postings can be recorded.';
            owner.ask(action, () => locked ? unlockAccountingPeriod() : lockAccountingPeriod('Month-end close'));
          }}
        />
      </Panel>

      <View style={{ height: 20 }} />
      <SectionLabel>Statements</SectionLabel>
      <Panel flush>
        <ListRow icon="bank" tone="good" title="Bank reconciliation" subtitle="Match statement lines to posted entries" onPress={() => go('Reconciliation')} />
        <ListRow icon="pie" tone="good" title="Profit and loss" subtitle="Revenue against cost" onPress={() => go('Accounting')} last={db?.settings.taxEnabled === false} />
        {db?.settings.taxEnabled === false ? null : (
          <ListRow icon="bank" tone="accent" title="Tax" subtitle="What is collected and owed" onPress={() => go('Tax')} last />
        )}
      </Panel>
    </ScrollView>
  );
}

/** One side of what a journal entry will post. */
function PostLine({ dr, label, value }: { dr?: boolean; label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={{ width: 26, fontFamily: fonts.uiBold, fontSize: 12, color: dr ? colors.accent : colors.warn }}>{dr ? 'Dr' : 'Cr'}</Text>
      <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink, paddingLeft: dr ? 0 : 14 }}>{label}</Text>
      <Text style={{ fontFamily: fonts.monoSemi, fontSize: 14, color: colors.ink }}>{value}</Text>
    </View>
  );
}
