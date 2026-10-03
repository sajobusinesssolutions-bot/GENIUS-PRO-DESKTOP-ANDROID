/**
 * INSTALMENT PLANS — the live definitions:
 *   · `SCREENS.instalments` at reference line 11919 (the earlier one at 2693
 *     is superseded): the "Still owed"/"Behind" stats and a row per plan with
 *     a progress bar.
 *   · `SCREENS.planDetail` at 11869: the plan document, the "Still to come"
 *     card and the `.schedrow` schedule with its `.n` / `.n.paid` / `.n.late`
 *     numbers and a Receive button per instalment.
 *   · the plan builder from the `instal` branch of the document composer
 *     (11653 for the form, 11739 for what it commits).
 *
 * A plan sells the goods on credit through the ordinary commitSale, and every
 * instalment received posts through recordPayment, so the customer's balance
 * and the ledger stay correct.
 */
import { ListPage, DocRow, StatusChips, SummaryTiles } from '../components/DocList';
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import {
  Card, Cap, Grid, Stat, Button, Chip, EmptyState, KV, Pill, IconTile,
  Panel, SectionLabel, DetailRow, InfoBanner, Badge, FilterChips, StatGrid, StickyBar, ActionGrid, ProgressBar,
} from '../components/ui';
import { Icon } from '../components/icons';
import { IconBtn } from '../components/AppBar';
import { LineEditor, CartLine } from '../components/LineEditor';
import DocEntry from '../components/DocEntry';
import { useGo } from '../nav/navigate';
import { plural, fmtDay, fmtDate } from '../data/helpers';
import { instalSchedule, planPaid, planOutstanding, planPct, planNext, planIsLate } from '../data/logic';
import type { InstalmentPlan } from '../data/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

/** `.bar` — the thin progress rail under a plan row. */
function Bar({ pct, done }: { pct: number; done?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ height: 5, borderRadius: 3, backgroundColor: colors.sunk, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', backgroundColor: done ? colors.good : colors.accent }} />
    </View>
  );
}

/* ================= the list ================= */

export function InstalmentsScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const { db, money, party } = useAppData();
  const [filter, setFilter] = React.useState<'all' | 'behind' | 'paying' | 'cleared'>('all');
  const [q, setQ] = React.useState('');
  const all = (db?.instalmentPlans || []).slice().reverse();
  const cleared = (pl: typeof all[number]) => planOutstanding(pl) <= 0.5;
  const needle = q.trim().toLowerCase();
  const list = all.filter((pl) => {
    if (filter === 'behind' && !planIsLate(pl)) return false;
    if (filter === 'paying' && (cleared(pl) || planIsLate(pl))) return false;
    if (filter === 'cleared' && !cleared(pl)) return false;
    return !needle || ((party(pl.partyId || '')?.name || '') + ' ' + pl.no).toLowerCase().includes(needle);
  });
  return (
    <ListPage
      top={(
        <>
          <StatusChips value={filter} onChange={setFilter} options={[{ v: 'all', l: 'All' }, { v: 'behind', l: 'Behind' }, { v: 'paying', l: 'Paying' }, { v: 'cleared', l: 'Cleared' }]} />
          <SummaryTiles tiles={[
            { label: 'Still owed', value: money(all.reduce((a, pl) => a + planOutstanding(pl), 0)), tone: colors.danger },
            { label: 'Behind', value: String(all.filter((pl) => planIsLate(pl)).length) },
          ]} />
        </>
      )}
      search={{ value: q, onChange: setQ, placeholder: 'Search by customer or plan' }}
      data={list}
      keyExtractor={(pl) => pl.id}
      empty={{ text: 'No instalment plans. Let a customer pay in parts with Add instalment plan.' }}
      add={{ label: 'Add instalment plan', onPress: () => go('PlanNew') }}
      renderItem={({ item: pl }) => {
        const next = planNext(pl);
        const late = planIsLate(pl);
        const done = cleared(pl);
        return (
          <DocRow
            title={party(pl.partyId || '')?.name || 'Customer'}
            pill={done ? { label: 'Cleared', tone: 'good' } : late ? { label: 'Behind', tone: 'danger' } : { label: 'Paying', tone: 'accent' }}
            amount={money(pl.total)}
            refText={'Plan #' + pl.no}
            ts={pl.createdAt}
            lines={done ? [{ label: 'Paid', value: '100%' }] : [
              { label: 'Balance', value: money(planOutstanding(pl)), tone: colors.danger },
              ...(next ? [{ label: late ? 'Overdue since' : 'Next due', value: fmtDay(next.due), tone: late ? colors.danger : undefined }] : []),
              { label: 'Paid', value: planPct(pl) + '%' },
            ]}
            onPress={() => go('PlanDetail', { planId: pl.id })}
          />
        );
      }}
    />
  );
}

/* ================= one plan ================= */

type DetailProps = NativeStackScreenProps<RootStackParamList, 'PlanDetail'>;

export function PlanDetailScreen({ route }: DetailProps) {
  const { colors } = useTheme();
  const go = useGo();
  const { db, money, party, payInstalment } = useAppData();

  const pl: InstalmentPlan | undefined = db?.instalmentPlans.find((x) => x.id === route.params?.planId);
  if (!db || !pl) return <EmptyState icon="calendar" title="Plan not found" />;

  const sale = db.sales.find((s) => s.id === pl.saleId);
  const paid = planPaid(pl);
  const outstanding = planOutstanding(pl);
  const next = planNext(pl);
  const pct = planPct(pl);
  const customer = party(pl.partyId || '');

  const receive = (index: number) => {
    const x = pl.schedule[index];
    Alert.alert(
      'Receive instalment',
      'Take ' + money(x.amount) + ' from ' + (customer?.name || 'the customer') +
      ' into ' + (db.accounts[0]?.name || 'the cash drawer') + '?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Receive',
          onPress: () => {
            if (!payInstalment(pl.id, index)) Alert.alert('Instalment', 'That one is already settled.');
          },
        },
      ],
    );
  };

  const overdue = pl.schedule.filter((x) => !x.paidAt && new Date(x.due).getTime() < Date.now());

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 150 }}>
        {/* the plan head */}
        <Panel>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
            <View style={{
              width: 48, height: 48, borderRadius: 15,
              backgroundColor: pct === 100 ? colors.goodSoft : overdue.length ? colors.dangerSoft : colors.warnSoft,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="calendar" size={22} color={pct === 100 ? colors.good : overdue.length ? colors.danger : colors.warn} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }}>{pl.no}</Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                {customer?.name || 'Walk-in'} · started {fmtDay(pl.createdAt)}
              </Text>
            </View>
            <Badge
              label={pct === 100 ? 'Cleared' : overdue.length ? overdue.length + ' overdue' : 'On track'}
              tone={pct === 100 ? 'good' : overdue.length ? 'danger' : 'warn'}
            />
          </View>

          <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 14 }} />

          <View style={{ alignItems: 'center', gap: 4 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>Still to come</Text>
            <Text style={{ fontFamily: fonts.uiExtra, fontSize: 32, letterSpacing: -0.8, color: outstanding > 0 ? colors.ink : colors.good }}>
              {money(outstanding)}
            </Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
              of {money(pl.total)} · {Math.round(pct)}% settled
            </Text>
          </View>
          <View style={{ marginTop: 14 }}><ProgressBar pct={pct} tone={pct === 100 ? colors.good : colors.warn} /></View>
        </Panel>

        {overdue.length ? (
          <View style={{ marginTop: 14 }}>
            <InfoBanner
              tone="danger"
              text={overdue.length + ' payment' + (overdue.length === 1 ? ' is' : 's are') + ' past due, worth '
                + money(overdue.reduce((n, x) => n + x.amount, 0)) + '.'}
            />
          </View>
        ) : null}

        <View style={{ height: 16 }} />
        <StatGrid
          items={[
            { icon: 'coins', label: 'Plan total', value: money(pl.total), tone: 'accent' },
            { icon: 'check', label: 'Paid so far', value: money(paid + (pl.down || 0)), tone: 'good' },
            { icon: 'clock', label: 'Next due', value: next ? fmtDay(next.due) : 'Cleared', tone: next && new Date(next.due).getTime() < Date.now() ? 'danger' : 'warn' },
            { icon: 'receipt', label: 'Payments', value: pl.schedule.filter((x) => x.paidAt).length + ' / ' + pl.schedule.length, tone: 'accent' },
          ]}
        />

        {sale?.lines.length ? (
          <>
            <View style={{ height: 20 }} />
            <SectionLabel>Goods on the plan</SectionLabel>
            <Panel>
              {sale.lines.map((l, i) => (
                <DetailRow
                  key={i}
                  label={l.qty + ' × ' + l.name}
                  value={money(l.qty * l.price)}
                  last={i === sale.lines.length - 1}
                />
              ))}
            </Panel>
          </>
        ) : null}

        <View style={{ height: 20 }} />
        <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{pl.schedule.length} payments</Text>}>
          Schedule
        </SectionLabel>

        {pl.schedule.map((x, i) => {
          const od = !x.paidAt && new Date(x.due).getTime() < Date.now();
          const fg = x.paidAt ? colors.good : od ? colors.danger : colors.warn;
          const bg = x.paidAt ? colors.goodSoft : od ? colors.dangerSoft : colors.warnSoft;
          return (
            <View
              key={i}
              style={{
                backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 14,
                marginBottom: 10, borderLeftWidth: 5, borderLeftColor: fg,
                shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
                  {x.paidAt
                    ? <Icon name="check" size={19} color={fg} />
                    : <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: fg }}>{i + 1}</Text>}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{fmtDay(x.due)}</Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: od ? colors.danger : colors.faint, marginTop: 3 }}>
                    {x.paidAt ? 'paid ' + fmtDay(x.paidAt) : od ? 'overdue' : 'scheduled'}
                  </Text>
                </View>
                <Text style={{ fontFamily: fonts.uiExtra, fontSize: 15, color: colors.ink }}>{money(x.amount)}</Text>
              </View>

              {!x.paidAt ? (
                <View style={{ marginTop: 12 }}>
                  <Button
                    size="sm"
                    variant="pri"
                    label={'Receive ' + money(x.amount)}
                    icon={<Icon name="cash" size={15} color={colors.accentInk} />}
                    onPress={() => receive(i)}
                  />
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      <StickyBar>
        <ActionGrid
          actions={[
            ...(sale ? [{ label: 'Open the sale', icon: 'receipt' as const, tone: 'accent' as const, onPress: () => go('SaleDetail', { saleId: sale.id }) }] : []),
            ...(customer ? [{ label: 'Customer', icon: 'user' as const, tone: 'accent' as const, onPress: () => go('PartyDetail', { partyId: customer.id }) }] : []),
            { label: 'New plan', icon: 'plus', tone: 'warn', filled: true, onPress: () => go('PlanNew') },
          ]}
        />
      </StickyBar>
    </View>
  );
}

/* ================= create a plan ================= */

type NewProps = NativeStackScreenProps<RootStackParamList, 'PlanNew'>;

const COUNTS = [2, 3, 4, 6, 12];
const EVERY: [number, string][] = [[7, 'Weekly'], [14, 'Every 2 weeks'], [30, 'Monthly']];

export function PlanNewScreen({ navigation }: NewProps) {
  const { colors } = useTheme();
  const { db, money, createInstalmentPlan } = useAppData();

  const [partyId, setPartyId] = useState<string | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [count, setCount] = useState(3);
  const [every, setEvery] = useState(30);
  const [downPct, setDownPct] = useState(20);

  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const down = Math.round((total * downPct) / 100 / 1000) * 1000;
  const preview = useMemo(
    () => (total ? instalSchedule(total, down, count, every, 0) : []),
    [total, down, count, every],
  );

  const wholeBill = total > 0 && down >= total;
  const each = preview.length ? preview[0].amount : 0;

  return (
    <DocEntry
      kind="Instalment plan"
      icon="calendar"
      tone="warn"
      partyType="customer"
      partyRequired
      partyLabel="Who is taking it"
      partyId={partyId}
      onPartyChange={setPartyId}
      lines={lines}
      onLinesChange={setLines}
      linesLabel="Goods on the plan"
      saveLabel={'Create the plan · ' + money(total)}
      askWho="Who arranged this plan?"
      blockedReason={wholeBill ? 'The down payment is the whole sale — lower it, or just sell it outright.' : undefined}
      summary={
        preview.length ? (
          <Panel>
            <SectionLabel right={<Badge label={count + ' payments'} tone="warn" />}>The schedule</SectionLabel>
            {preview.map((x, i) => (
              <View
                key={i}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10,
                  borderBottomWidth: i === preview.length - 1 ? 0 : 1, borderBottomColor: colors.line,
                }}
              >
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.warnSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.warn }}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{fmtDay(x.due)}</Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
                    {i === 0 && down ? 'after the down payment' : 'due in ' + ((i + 1) * every) + ' days'}
                  </Text>
                </View>
                <Text style={{ fontFamily: fonts.monoSemi, fontSize: 15, color: colors.ink }}>{money(x.amount)}</Text>
              </View>
            ))}
            <View style={{ height: 12 }} />
            <InfoBanner
              tone="neutral"
              icon="bulb"
              text={'The goods leave now on credit. Each instalment you mark paid posts a receipt against the account.'}
            />
          </Panel>
        ) : undefined
      }
      onSave={() => {
        if (!db || !partyId) return;
        const saleLines = lines.map((l) => {
          const prod = db.products.find((x) => x.id === l.productId)!;
          return { productId: prod.id, name: prod.name, sku: prod.sku, unit: prod.unit, qty: l.qty, price: l.price, cost: prod.cost, taxRate: prod.taxRate };
        });
        const pl = createInstalmentPlan({ partyId, lines: saleLines, discount: 0, down, count, every });
        if (!pl) { Alert.alert('Instalment plan', 'That could not be scheduled — check the customer and the down payment.'); return; }
        navigation.replace('PlanDetail', { planId: pl.id });
      }}
    >
      <SectionLabel>Split it into</SectionLabel>
      <View style={{ marginBottom: 16 }}>
        <FilterChips
          value={String(count)}
          onChange={(v) => setCount(Number(v))}
          options={COUNTS.map((n) => ({ v: String(n), l: n + ' payments' }))}
          tone="warn"
        />
      </View>

      <SectionLabel>Payable</SectionLabel>
      <View style={{ marginBottom: 16 }}>
        <FilterChips
          value={String(every)}
          onChange={(v) => setEvery(Number(v))}
          options={EVERY.map(([v, l]) => ({ v: String(v), l }))}
          tone="warn"
        />
      </View>

      <SectionLabel>Down payment today</SectionLabel>
      <View style={{ marginBottom: 12 }}>
        <FilterChips
          value={String(downPct)}
          onChange={(v) => setDownPct(Number(v))}
          options={[0, 10, 20, 30, 50].map((n) => ({ v: String(n), l: n + '%' }))}
          tone="warn"
        />
      </View>

      {total > 0 ? (
        <Panel style={{ marginBottom: 16 }}>
          <DetailRow label="Sale total" value={money(total)} />
          <DetailRow label="Down payment today" value={money(down)} tone={colors.good} />
          <DetailRow label="Spread over" value={count + ' × ' + money(each)} />
          <DetailRow label="Left on account" value={money(Math.max(0, total - down))} bold tone={colors.warn} last />
        </Panel>
      ) : null}
    </DocEntry>
  );
}

/** The "+" in the header of the instalments list — reference SCREENS.instalments.right. */
export function InstalmentsHeaderRight() {
  const { colors } = useTheme();
  const go = useGo();
  return <IconBtn name="plus" size={20} color={colors.accent} onPress={() => go('PlanNew')} />;
}
