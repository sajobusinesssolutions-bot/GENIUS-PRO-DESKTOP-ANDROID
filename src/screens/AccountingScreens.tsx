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
import { View, Text, ScrollView, FlatList, Pressable, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from '../components/Toast';
import {
  Panel, Badge, StatGrid, SectionLabel, FilterChips, EmptyBlock, Search, InfoBanner,
  Button, Field, SelectField, SegPill, StickyBar, DetailRow, TopTabs, ListRow,
} from '../components/ui';
import { Icon, IconName } from '../components/icons';
import Sheet from '../components/Sheet';
import { useWho } from '../components/WhoSheet';
import { useGo } from '../nav/navigate';
import {
  LEDGER_TYPES, LedgerType, Ledger, ledgerBalance, ledgerBalances, ledgerHistory, trialBalance, debitPositive,
} from '../data/coa';
import type { JournalLine } from '../data/types';
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
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: showOff ? colors.accent : colors.faint }}>
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
                <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>
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
  const balance = ledgerBalance(db, l.id);

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
                { icon: 'down', label: 'Total debits', value: money(dr), tone: 'accent' },
                { icon: 'up', label: 'Total credits', value: money(cr), tone: 'warn' },
              ]}
            />

            <View style={{ height: 20 }} />
            <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{rows.length} postings</Text>}>
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
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 14.5, color: colors.ink }}>{item.memo}</Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 3 }}>
                {item.ref} · {new Date(item.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 3 }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 14.5, color: item.dr ? colors.accent : colors.warn }}>
                {item.dr ? money(item.dr) : money(item.cr)}
              </Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>bal {money(item.balance)}</Text>
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
  const [side, setSide] = useState<'credit' | 'debit'>('credit');

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
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 170 }} keyboardShouldPersistTaps="handled">
        <SegPill
          value={mode}
          onChange={setMode}
          tone="accent"
          options={[
            { v: 'simple', l: 'Simple', i: 'bulb' },
            { v: 'advanced', l: 'Advanced', i: 'chart' },
          ]}
        />

        <View style={{ height: 20 }} />

        {mode === 'simple' ? (
          <>
            {/* the credit / debit pair from the reference */}
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 18 }}>
              {([
                { v: 'credit' as const, l: 'Credit', i: 'down' as IconName, tint: colors.good, soft: colors.goodSoft },
                { v: 'debit' as const, l: 'Debit', i: 'up' as IconName, tint: colors.danger, soft: colors.dangerSoft },
              ]).map((o) => {
                const on = side === o.v;
                return (
                  <Pressable
                    key={o.v}
                    onPress={() => setSide(o.v)}
                    style={{
                      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
                      paddingVertical: 15, borderRadius: radius.md,
                      borderWidth: 1.6, borderColor: on ? o.tint : colors.line,
                      backgroundColor: on ? o.soft : colors.surface,
                    }}
                  >
                    <Icon name={o.i} size={19} color={on ? o.tint : colors.faint} />
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 16.5, color: on ? o.tint : colors.faint }}>{o.l}</Text>
                  </Pressable>
                );
              })}
            </View>

            <SelectField
              icon="tag"
              label="Category"
              value={ledger}
              options={active.map((x) => ({ v: x.id, l: x.code + ' · ' + x.name }))}
              onChange={setLedger}
              placeholder="Which ledger"
            />

            <Field
              label="Amount *"
              value={amount}
              onChangeText={setAmount}
              numeric
              decimal
              placeholder="0"
            />

            <Field label="Description" value={memo} onChangeText={setMemo} placeholder="What it is for" />

            <Field icon="user" label="Party name" value={partyName} onChangeText={setPartyName} placeholder="Optional" />

            <Pressable
              onPress={() => setPicking(true)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 74, marginBottom: 14,
                borderRadius: radius.md, borderWidth: 1.4, borderColor: colors.line,
                backgroundColor: colors.surface, paddingHorizontal: 15,
              }}
            >
              <Icon name="calendar" size={22} color={colors.ink} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 17, color: colors.ink }}>
                  {at.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
                </Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, marginTop: 3 }}>Entry date</Text>
              </View>
            </Pressable>

            <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Anything else worth recording" multiline />

            <SectionLabel>Posted against</SectionLabel>
            <SelectField
              icon="bank"
              label="Contra account"
              value={contra}
              options={cashish.map((x) => ({ v: x.id, l: x.code + ' · ' + x.name }))}
              onChange={setContra}
              placeholder="Cash, bank or wallet"
            />

            {/* what the entry will actually do, in plain words */}
            {simpleReady ? (
              <Panel>
                <SectionLabel>This will post</SectionLabel>
                <DetailRow
                  label={side === 'credit' ? 'Credit ' + (chosen?.name || '') : 'Debit ' + (chosen?.name || '')}
                  value={money(amt)}
                  tone={side === 'credit' ? colors.good : colors.danger}
                />
                <DetailRow
                  label={side === 'credit' ? 'Debit ' + (against?.name || '') : 'Credit ' + (against?.name || '')}
                  value={money(amt)}
                  bold
                  last
                />
              </Panel>
            ) : (
              <InfoBanner
                tone="neutral"
                icon="bulb"
                text="A simple entry moves one amount between two ledgers, so it always balances. Use Advanced for an entry with more than two sides."
              />
            )}
          </>
        ) : (
          <>
            <InfoBanner
              tone="accent"
              icon="bulb"
              text="Every entry must balance — the debits and the credits have to come to the same figure before it can be posted."
            />

            <View style={{ height: 18 }} />
            <Field icon="doc" label="Description" value={memo} onChangeText={setMemo} placeholder="What this entry is for" />

            <Pressable
              onPress={() => setPicking(true)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 74, marginBottom: 14,
                borderRadius: radius.md, borderWidth: 1.4, borderColor: colors.line,
                backgroundColor: colors.surface, paddingHorizontal: 15,
              }}
            >
              <Icon name="calendar" size={22} color={colors.ink} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 17, color: colors.ink }}>
                  {at.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
                </Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, marginTop: 3 }}>Entry date</Text>
              </View>
            </Pressable>

            <SectionLabel right={
              <Badge
                label={advBalanced ? 'Balanced' : diff > 0 ? money(diff) + ' to credit' : money(-diff) + ' to debit'}
                tone={advBalanced ? 'good' : 'danger'}
              />
            }>
              Postings
            </SectionLabel>

            {lines.map((l, i) => (
              <Panel key={i} style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 14.5, color: colors.ink }}>Line {i + 1}</Text>
                  {lines.length > 2 ? (
                    <Pressable onPress={() => setLines(lines.filter((_, x) => x !== i))} hitSlop={8}>
                      <Icon name="trash" size={18} color={colors.danger} />
                    </Pressable>
                  ) : null}
                </View>

                <SelectField
                  icon="doc"
                  label="Ledger"
                  value={l.acc}
                  options={active.map((x) => ({ v: x.id, l: x.code + ' · ' + x.name }))}
                  onChange={(v) => patch(i, { acc: v })}
                  placeholder="Choose a ledger"
                />

                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Field label="Debit" value={l.dr} onChangeText={(v) => patch(i, { dr: v, cr: '' })} numeric decimal placeholder="0" style={{ marginBottom: 0 }} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label="Credit" value={l.cr} onChangeText={(v) => patch(i, { cr: v, dr: '' })} numeric decimal placeholder="0" style={{ marginBottom: 0 }} />
                  </View>
                </View>
              </Panel>
            ))}

            <Button
              label="Add another line"
              icon={<Icon name="plus" size={16} color={colors.ink} />}
              onPress={() => setLines([...lines, { acc: '', dr: '', cr: '' }])}
            />

            <View style={{ height: 20 }} />
            <Panel>
              <DetailRow label="Total debits" value={money(totalDr)} tone={colors.accent} />
              <DetailRow label="Total credits" value={money(totalCr)} tone={colors.warn} />
              <DetailRow
                label={advBalanced ? 'Balanced' : 'Out by'}
                value={advBalanced ? '—' : money(Math.abs(diff))}
                bold
                tone={advBalanced ? colors.good : colors.danger}
                last
              />
            </Panel>
          </>
        )}

        {picking ? (
          <DateTimePicker
            value={at}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(_e, d) => { setPicking(false); if (d) setAt(d); }}
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
      <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{tb.rows.length} ledgers</Text>}>
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
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 14.5, color: colors.ink }}>{r.ledger.name}</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 2 }}>
                {r.ledger.code} · {r.ledger.type}
              </Text>
            </View>
            <Text style={{ width: 92, textAlign: 'right', fontFamily: fonts.monoSemi, fontSize: 13, color: r.debit ? colors.accent : colors.lineHard }}>
              {r.debit ? money(r.debit) : '—'}
            </Text>
            <Text style={{ width: 92, textAlign: 'right', fontFamily: fonts.monoSemi, fontSize: 13, color: r.credit ? colors.warn : colors.lineHard }}>
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

function AccountingHubScreenBody() {
  const { colors } = useTheme();
  const { db, money } = useAppData();
  const go = useGo();

  const tb = useMemo(() => (db ? trialBalance(db) : null), [db]);
  if (!db || !tb) return null;

  const off = Math.abs(tb.totalDebit - tb.totalCredit) >= 0.01;

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
      <SectionLabel>Books</SectionLabel>
      <Panel flush>
        <ListRow icon="doc" tone="accent" title="Chart of accounts" subtitle="Add, rename or switch off a ledger" onPress={() => go('ChartOfAccounts')} />
        <ListRow icon="pencil" tone="good" title="New journal entry" subtitle="Post a manual double entry" onPress={() => go('JournalEntry')} />
        <ListRow icon="chart" tone="warn" title="Trial balance" subtitle="Prove the books tie out" onPress={() => go('TrialBalance')} />
        <ListRow icon="clock" tone="accent" title="All postings" subtitle="Every entry the app has made" onPress={() => go('Journals')} last />
      </Panel>

      <View style={{ height: 20 }} />
      <SectionLabel>Statements</SectionLabel>
      <Panel flush>
        <ListRow icon="pie" tone="good" title="Profit and loss" subtitle="Revenue against cost" onPress={() => go('Accounting')} />
        <ListRow icon="bank" tone="accent" title="Tax" subtitle="What is collected and owed" onPress={() => go('Tax')} last />
      </Panel>
    </ScrollView>
  );
}
