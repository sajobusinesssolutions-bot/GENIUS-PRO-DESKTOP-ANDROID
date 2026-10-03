/**
 * FINANCE — the live definition, reference `SCREENS.finance.body` line 12624
 * (which supersedes the earlier one at 5608), with the header from line 5608-5610.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Pressable } from '../components/Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { canFor, PermKey } from '../data/perms';
import {
  Card, Cap, Grid, Stat, KV, Button, Tile, EmptyState, ChipStrip, IconTile,
  Panel, ListRow, DetailRow, StatGrid, FilterChips, SectionLabel, AccentHead,
} from '../components/ui';
import { Icon } from '../components/icons';
import { AppBar, IconBtn } from '../components/AppBar';
import { REPORT_COUNT } from '../data/menuGroups';
import { useGo } from '../nav/navigate';
import { finRange, FIN_PERIODS, inRange, money0, plural } from '../data/helpers';
import type { IconName } from '../components/icons';

export default function FinanceScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const { db, money, partyBalance, accountBalance } = useAppData();
  const [period, setPeriod] = useState('month');

  const role = db?.session.role;
  const allowed = canFor(role, 'money');

  const d = useMemo(() => {
    if (!db || !allowed) return null;
    const R = finRange(period);
    let inP = 0, outP = 0;
    db.journal.forEach((e) => {
      if (!inRange(e.ts, R.from, R.to)) return;
      e.lines.forEach((l) => {
        if (db.accounts.some((a) => a.id === l.acc)) { inP += l.dr || 0; outP += l.cr || 0; }
      });
    });
    let owed = 0, owe = 0;
    db.parties.forEach((p) => { const b = partyBalance(p.id); if (b > 0) owed += b; else owe += -b; });

    const ss = db.sales.filter((s) => s.status !== 'void' && inRange(s.ts, R.from, R.to));
    const net = ss.reduce((a, s) => a + (s.total - s.tax), 0);
    const cogs = ss.reduce((a, s) => a + s.cogs, 0);
    const exp = db.entries.filter((e) => e.direction === 'out' && inRange(e.ts, R.from, R.to)).reduce((a, e) => a + e.amount, 0);
    const inc = db.entries.filter((e) => e.direction === 'in' && inRange(e.ts, R.from, R.to)).reduce((a, e) => a + e.amount, 0);
    const returns = (db.creditNotes || []).filter((c) => inRange(c.ts, R.from, R.to)).reduce((a, c) => a + c.total, 0);
    const profit = net - returns - cogs - exp + inc;
    const vat = ss.reduce((a, s) => a + s.tax, 0);

    const moved = (accId: string) => {
      let n = 0;
      db.journal.forEach((e) => {
        if (!inRange(e.ts, R.from, R.to)) return;
        e.lines.forEach((l) => { if (l.acc === accId) n += (l.dr || 0) - (l.cr || 0); });
      });
      return n;
    };
    return { R, inP, outP, owed, owe, ss, net, cogs, exp, inc, returns, profit, vat, moved };
  }, [db, period, allowed]);

  const right = <IconBtn name="plus" size={20} color={colors.accent} onPress={() => go('EntryNew')} />;

  if (!db) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  if (!allowed || !d) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <AppBar title="Finance" right={right} />
        <EmptyState
          icon="card"
          title="Not your job"
          subtitle="A cashier does not see the money side. Sign in as an owner or manager to open it."
        />
      </View>
    );
  }

  const taxOn = db.settings.taxRate > 0;
  const taxName = 'VAT';

  const goTo = ([
    { route: 'Money', i: 'card', n: 'Cash & bank', b: 'Every transaction' },
    { route: 'Reports', i: 'chart', n: 'Reports', b: REPORT_COUNT + ' of them', perm: 'reports' },
    { route: 'Accounting', i: 'pie', n: 'Accounting', b: 'Ledgers, P&L', perm: 'accounting' },
    // with tax not charged there is nothing to show under Tax
    ...(taxOn ? [{ route: 'Tax', i: 'receipt', n: 'Tax', b: taxName + ' ' + db.settings.taxRate + '%' }] : []),
    { route: 'Instalments', i: 'calendar', n: 'Instalments', b: 'Pay-in-parts' },
    { route: 'CreditNotes', i: 'swap', n: 'Returns', b: plural((db.creditNotes || []).length, 'note') },
  ] as { route: string; i: IconName; n: string; b: string; perm?: PermKey }[]).filter((x) => canFor(role, x.perm));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AppBar title="Finance" right={right} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 14 }}>
        <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14 }}>
          <FilterChips value={period} onChange={setPeriod} options={FIN_PERIODS.map(([v, l]) => ({ v, l }))} />
        </View>

        <View style={{ paddingHorizontal: 16, paddingBottom: 20 }}>
          <StatGrid
            items={[
              { icon: 'down', label: 'In · ' + d.R.label, value: money(d.inP), tone: 'good' },
              { icon: 'up', label: 'Out · ' + d.R.label, value: money(d.outP), tone: 'danger' },
              { icon: 'clock', label: 'Owed to you', value: money(d.owed), tone: 'warn' },
              { icon: 'card', label: 'You owe', value: money(d.owe), tone: 'accent' },
            ]}
          />
        </View>

        {/* Accounts */}
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <AccentHead title="Accounts" tone="good" />
          <View style={{ gap: 8 }}>
            {db.accounts.map((a) => {
              const tone = a.type === 'cash' ? colors.good : a.type === 'bank' ? colors.accent : colors.warn;
              const soft = a.type === 'cash' ? colors.goodSoft : a.type === 'bank' ? colors.accentSoft : colors.warnSoft;
              const icon: IconName = a.type === 'bank' ? 'bank' : a.type === 'wallet' ? 'phone' : 'cash';
              const mv = d.moved(a.id);
              return (
                <Pressable key={a.id} onPress={() => go('AccountDetail', { accountId: a.id })}>
                  <Card style={{ paddingVertical: 14, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <IconTile icon={icon} bg={soft} color={tone} size={44} round={14} iconSize={21} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{a.name}</Text>
                      <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: mv >= 0 ? colors.good : colors.danger, marginTop: 3 }}>
                        {(mv >= 0 ? '+' : '−') + ' ' + money0(Math.abs(mv))} in {d.R.label.toLowerCase()}
                      </Text>
                    </View>
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{money(accountBalance(a.id))}</Text>
                  </Card>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* period summary */}
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <AccentHead title={'Summary · ' + d.R.label} tone="accent" />
          <Panel>
            <DetailRow label="Sales" value={String(d.ss.length)} />
            <DetailRow label={'Sales' + (taxOn ? ', net of ' + taxName : '')} value={money(d.net)} tone={colors.good} />
            {d.returns ? <DetailRow label="Returns" value={'(' + money0(d.returns) + ')'} tone={colors.danger} /> : null}
            <DetailRow label="Cost of goods sold" value={'(' + money0(d.cogs) + ')'} tone={colors.danger} />
            <DetailRow label="Expenses" value={'(' + money0(d.exp) + ')'} tone={colors.danger} />
            {d.inc ? <DetailRow label="Other income" value={money(d.inc)} tone={colors.good} /> : null}
            <DetailRow label="Net profit" value={money(d.profit)} bold tone={d.profit >= 0 ? colors.good : colors.danger} last={!taxOn} />
            {taxOn ? <DetailRow label={taxName + ' collected'} value={money(d.vat)} tone={colors.warn} last /> : null}
          </Panel>
        </View>

        {/* record a movement */}
        <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
          <SectionLabel>Record a movement</SectionLabel>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button label="Money in" icon={<Icon name="down" size={16} color={colors.good} />} onPress={() => go('EntryNew', { direction: 'in' })} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Add expense" icon={<Icon name="up" size={16} color={colors.danger} />} onPress={() => go('EntryNew', { direction: 'out' })} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Transfer" icon={<Icon name="swap" size={16} color={colors.accent} />} onPress={() => go('Transfer')} />
            </View>
          </View>
        </View>

        {/* Go to */}
        <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
          <SectionLabel>Go to</SectionLabel>
          <Panel flush>
            {goTo.map((x, i) => (
              <ListRow
                key={x.route}
                icon={x.i}
                title={x.n}
                subtitle={x.b}
                onPress={() => go(x.route)}
                last={i === goTo.length - 1}
              />
            ))}
          </Panel>
        </View>
      </ScrollView>
    </View>
  );
}
