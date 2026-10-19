/**
 * A party's ledger for a period: the balance brought forward, every sale,
 * purchase and payment in the period with its debit and credit, the running
 * balance after each, and the balance carried forward at the end.
 *
 * Debit is what increases what they owe you (a sale, money paid out to them);
 * credit is what reduces it (money received, a purchase from them). A positive
 * balance means they owe you, the same sign partyBalance uses.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useBookFrom } from '../data/useBookFrom';
import { broughtForward } from '../data/reports';
import { Empty } from '../components/ui';
import { PeriodBar, listPeriod, ListPeriod } from '../components/DocList';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PartyLedger'>;

interface Entry { ts: string; memo: string; ref: string; debit: number; credit: number }
interface Line extends Entry { balance: number }

export default function PartyLedgerScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, party } = useAppData();
  const pt = party(route.params.partyId);
  const [period, setPeriod] = useState<ListPeriod>(() => listPeriod('month'));
  /* the period's entries read from disk when it starts before what is in memory */
  const { book: rangeBook, reading } = useBookFrom(db, period.from);

  // the party's name is the title, so nothing on the page repeats it
  useEffect(() => { if (pt) navigation.setOptions({ title: pt.name + ' · Ledger' }); }, [navigation, pt?.name]);

  /** Every entry for the party, oldest first. */
  const entries = useMemo<Entry[]>(() => {
    const db = rangeBook;
    if (!db || !pt) return [];
    const out: Entry[] = [];
    /* everything older than the book in memory, as one line */
    const older = broughtForward(db, pt.id);
    if (older) out.push({ ts: older.ts, memo: 'Brought forward', ref: '', debit: older.debit, credit: older.credit });
    db.sales.forEach((s) => {
      if (s.partyId !== pt.id || s.status === 'void') return;
      out.push({ ts: s.ts, memo: 'Sale', ref: s.no, debit: s.total, credit: 0 });
      const paidThen = s.paidAtSale ?? (s.method === 'credit' ? 0 : s.total);
      if (paidThen > 0) out.push({ ts: s.ts, memo: 'Paid at sale', ref: s.no, debit: 0, credit: paidThen });
    });
    db.purchases.forEach((x) => {
      if (x.partyId !== pt.id || x.status === 'void') return;
      out.push({ ts: x.ts, memo: 'Purchase', ref: x.ref || x.no, debit: 0, credit: x.total });
      // only what was paid when it was bought: later payments are their own lines
      const paidThen = x.method === 'credit' ? 0 : x.total;
      if (paidThen > 0) out.push({ ts: x.ts, memo: 'Paid at purchase', ref: x.ref || x.no, debit: paidThen, credit: 0 });
    });
    db.payments.forEach((p) => {
      if (p.partyId !== pt.id) return;
      out.push({
        ts: p.ts, memo: (p.direction === 'in' ? 'Payment received' : 'Payment made') + (p.note ? ' — ' + p.note : ''), ref: '',
        debit: p.direction === 'out' ? p.amount : 0, credit: p.direction === 'in' ? p.amount : 0,
      });
    });
    return out.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  }, [rangeBook, pt]);

  const view = useMemo(() => {
    const start = pt?.openingBalance || 0;
    let opening = start;
    const lines: Line[] = [];
    let run = 0;
    let dr = 0, cr = 0;
    entries.forEach((e) => {
      const t = new Date(e.ts).getTime();
      if (t < period.from) { opening += e.debit - e.credit; return; }
      if (t > period.to) return;
      if (!lines.length) run = opening;
      run += e.debit - e.credit;
      dr += e.debit; cr += e.credit;
      lines.push({ ...e, balance: run });
    });
    return { opening, lines, dr, cr, closing: opening + dr - cr };
  }, [entries, period, pt?.openingBalance]);

  if (!db || !pt) return null;

  const word = (b: number) => (b > 0.01 ? 'Owes you' : b < -0.01 ? (pt.type === 'supplier' ? 'You owe' : 'In credit') : 'Settled');
  const bal = (b: number) => money(Math.abs(b)) + (b > 0.01 ? ' Dr' : b < -0.01 ? ' Cr' : '');
  const day = (ts: string) => new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
  const head = { fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 0.5, color: colors.faint } as const;
  const num = { width: 78, textAlign: 'right' as const, fontFamily: fonts.monoSemi, fontSize: 12.5 };

  const boxRow = (label: string, b: number, strong?: boolean) => (
    <View style={{
      flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
      backgroundColor: strong ? colors.accentSoft : colors.sunk,
    }}>
      <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 13.5, color: strong ? colors.accent : colors.ink }}>{label}</Text>
      <Text style={{ fontFamily: fonts.uiExtra, fontSize: 14, color: b > 0.01 ? colors.danger : b < -0.01 ? colors.good : colors.ink }}>{bal(b)}</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <PeriodBar value={period} onChange={setPeriod} />
      <FlatList
        data={view.lines}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}
        ListHeaderComponent={
          <View>
            {/* the period at a glance */}
            <View style={{ flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, borderRadius: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
              {[
                { l: 'Opening', v: view.opening },
                { l: 'Closing', v: view.closing },
              ].map((x, i) => (
                <View key={x.l} style={{ flex: 1, padding: 14, borderLeftWidth: i ? 1 : 0, borderLeftColor: colors.line }}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: colors.faint }}>{x.l} balance</Text>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: fonts.uiExtra, fontSize: 18, color: x.v > 0.01 ? colors.danger : x.v < -0.01 ? colors.good : colors.ink, marginTop: 4 }}>{money(Math.abs(x.v))}</Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 2 }}>{word(x.v)}</Text>
                </View>
              ))}
            </View>

            <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line }}>
              <Text style={[head, { flex: 1 }]}>DATE · DETAILS</Text>
              <Text style={[head, { width: 78, textAlign: 'right' }]}>DEBIT</Text>
              <Text style={[head, { width: 78, textAlign: 'right' }]}>CREDIT</Text>
              <Text style={[head, { width: 86, textAlign: 'right' }]}>BALANCE</Text>
            </View>
            {boxRow('Opening balance · ' + new Date(period.from || entries[0]?.ts || Date.now()).toLocaleDateString('en-GB'), view.opening)}
          </View>
        }
        ListEmptyComponent={<Empty title="Nothing in this period" subtitle="Choose another period above." />}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.bg }}>
            <View style={{ flex: 1, minWidth: 0, paddingRight: 6 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{item.memo}</Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 2 }}>{day(item.ts)}{item.ref ? ' · ' + item.ref : ''}</Text>
            </View>
            <Text style={[num, { color: item.debit ? colors.danger : colors.faint }]}>{item.debit ? money(item.debit) : '—'}</Text>
            <Text style={[num, { color: item.credit ? colors.good : colors.faint }]}>{item.credit ? money(item.credit) : '—'}</Text>
            <Text style={[num, { width: 86, fontFamily: fonts.monoSemi, color: colors.ink }]}>{bal(item.balance)}</Text>
          </View>
        )}
        ListFooterComponent={
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.line }}>
              <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 13.5, color: colors.ink }}>Totals for the period</Text>
              <Text style={[num, { color: colors.danger }]}>{money(view.dr)}</Text>
              <Text style={[num, { color: colors.good }]}>{money(view.cr)}</Text>
              <View style={{ width: 86 }} />
            </View>
            {boxRow('Closing balance · ' + new Date(Math.min(period.to, Date.now())).toLocaleDateString('en-GB'), view.closing, true)}
          </View>
        }
      />
    </View>
  );
}
