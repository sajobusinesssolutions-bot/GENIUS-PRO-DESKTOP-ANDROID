/**
 * A party's ledger for a period: the balance brought forward, every sale,
 * purchase and payment in the period with its debit and credit, the running
 * balance after each, and the balance carried forward at the end.
 *
 * Debit is what increases what they owe you (a sale, money paid out to them);
 * credit is what reduces it (money received, a purchase from them). A positive
 * balance means they owe you, the same sign partyBalance uses.
 */
import { tsMs, groupNum } from '../data/helpers';
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Alert } from 'react-native';
import * as Sharing from 'expo-sharing';
import { Pressable } from '../components/Press';
import { Icon } from '../components/icons';
import { printPdfToCache } from '../data/docPrint';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useBookFrom } from '../data/useBookFrom';
import { broughtForward } from '../data/reports';
import { Empty } from '../components/ui';
import { PeriodBar, listPeriod, ListPeriod } from '../components/DocList';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PartyLedger'>;

/** `items`: what was on the bill, for the detailed statement. */
interface Entry { ts: string; memo: string; ref: string; debit: number; credit: number; items?: Array<{ name: string; qty: number; unit?: string; price: number }> }
interface Line extends Entry { balance: number }

export default function PartyLedgerScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, party } = useAppData();
  const pt = party(route.params.partyId);
  const [period, setPeriod] = useState<ListPeriod>(() => listPeriod('month'));
  /* the period's entries read from disk when it starts before what is in memory */
  const { book: rangeBook, reading } = useBookFrom(db, period.from);

  // the party's name is the title, so nothing on the page repeats it; Share sits beside it
  useEffect(() => {
    if (!pt) return;
    navigation.setOptions({
      title: pt.name + ' · Ledger',
      headerRight: () => (
        <Pressable onPress={() => askShare()} hitSlop={10} accessibilityLabel="Share the statement" style={{ padding: 6 }}>
          <Icon name="share" size={20} color={colors.ink} />
        </Pressable>
      ),
    });
  });   // eslint-disable-line react-hooks/exhaustive-deps

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
      out.push({ ts: s.ts, memo: 'Sale', ref: s.no, debit: s.total, credit: 0, items: s.lines.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit, price: l.price })) });
      const paidThen = s.paidAtSale ?? (s.method === 'credit' ? 0 : s.total);
      if (paidThen > 0) out.push({ ts: s.ts, memo: 'Paid at sale', ref: s.no, debit: 0, credit: paidThen });
    });
    db.purchases.forEach((x) => {
      if (x.partyId !== pt.id || x.status === 'void') return;
      out.push({ ts: x.ts, memo: 'Purchase', ref: x.ref || x.no, debit: 0, credit: x.total, items: x.lines.map((l) => ({ name: db.products.find((p) => p.id === l.productId)?.name || 'Item', qty: l.qty, price: l.cost })) });
      // only what was paid when it was bought: later payments are their own lines
      const paidThen = x.method === 'credit' ? 0 : x.total;
      if (paidThen > 0) out.push({ ts: x.ts, memo: 'Paid at purchase', ref: x.ref || x.no, debit: paidThen, credit: 0 });
    });
    (db.creditNotes || []).forEach((c) => {
      if (c.partyId !== pt.id) return;
      // refunded in cash: the goods came back and the money went out, so the balance does not move — one line shows both
      const refunded = c.refund && c.refund !== 'account';
      out.push({ ts: c.ts, memo: refunded ? 'Goods returned — refunded in ' + (c.refund === 'momo' ? 'mobile money' : c.refund) : 'Goods returned' + (c.reason ? ' — ' + c.reason : ''),
        ref: c.no, debit: refunded ? c.total : 0, credit: c.total,
        items: c.lines.map((l) => ({ name: l.name, qty: l.qty, price: l.price })) });
    });
    db.payments.forEach((p) => {
      if (p.partyId !== pt.id) return;
      out.push({
        ts: p.ts, memo: (p.direction === 'in' ? 'Payment received' : 'Payment made') + (p.note ? ' — ' + p.note : ''), ref: '',
        debit: p.direction === 'out' ? p.amount : 0, credit: p.direction === 'in' ? p.amount : 0,
      });
      // withholding tax kept back settles the bill as much as the money does
      if (p.taxDeducted) out.push({ ts: p.ts, memo: 'Withholding tax ' + (p.direction === 'in' ? 'they kept' : 'kept back'), ref: '',
        debit: p.direction === 'out' ? p.taxDeducted : 0, credit: p.direction === 'in' ? p.taxDeducted : 0 });
    });
    // an expense the customer paid for the shop, charged off their bill
    db.entries.forEach((e) => {
      if (!e.offsetSaleId) return;
      const s = db.sales.find((x) => x.id === e.offsetSaleId);
      if (!s || s.partyId !== pt.id) return;
      out.push({ ts: e.ts, memo: 'Charged against — ' + e.category, ref: s.no, debit: 0, credit: e.amount });
    });
    return out.sort((a, b) => tsMs(a.ts) - tsMs(b.ts));
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

  /* the statement as a PDF: the summary (one line per document) or detailed (with what was on each bill) */
  function askShare() {
    Alert.alert('Share statement', 'How much detail?', [
      { text: 'Summary', onPress: () => void share(false) },
      { text: 'Detailed with items', onPress: () => void share(true) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }
  async function share(detailed: boolean) {
    if (!db || !pt) return;
    const esc = (s: string) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c]);
    const d = (ts: string) => new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const b = (n: number) => money(Math.abs(n)) + (n > 0.01 ? ' Dr' : n < -0.01 ? ' Cr' : '');
    const rows = view.lines.map((l) => `<tr><td>${d(l.ts)}</td><td>${esc(l.memo)}${l.ref ? ' · ' + esc(l.ref) : ''}${detailed && l.items?.length
      ? '<div class="it">' + l.items.map((i) => esc(i.name) + ' — ' + i.qty + (i.unit ? ' ' + esc(i.unit) : '') + ' × ' + money(i.price) + ' = ' + money(i.qty * i.price)).join('<br/>') + '</div>' : ''}</td>
      <td class="n">${l.debit ? money(l.debit) : ''}</td><td class="n">${l.credit ? money(l.credit) : ''}</td><td class="n">${b(l.balance)}</td></tr>`).join('');
    const firm = db.firm;
    const html = `<html><head><meta charset="utf-8"/><style>
      body{font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#111;margin:24px}
      h1{font-size:16px;margin:0} .m{color:#555;margin:2px 0}
      table{width:100%;border-collapse:collapse;margin-top:14px} th,td{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left;vertical-align:top}
      th{background:#f2f2f2;font-size:10px;text-transform:uppercase} .n{text-align:right;white-space:nowrap} .it{color:#555;font-size:10px;margin-top:3px}
      .tot td{font-weight:bold;border-top:2px solid #111}
    </style></head><body>
      <h1>${esc(firm.name)}</h1><div class="m">${esc(firm.address || '')} ${esc(firm.phone || '')}</div>
      <h1 style="margin-top:14px">Statement of account — ${esc(pt.name)}</h1>
      <div class="m">${d(new Date(period.from || Date.now()).toISOString())} to ${d(new Date(Math.min(period.to, Date.now())).toISOString())} · ${detailed ? 'Detailed' : 'Summary'}</div>
      <table><tr><th>Date</th><th>Details</th><th class="n">Debit</th><th class="n">Credit</th><th class="n">Balance</th></tr>
      <tr><td></td><td><b>Opening balance</b></td><td></td><td></td><td class="n"><b>${b(view.opening)}</b></td></tr>
      ${rows}
      <tr class="tot"><td></td><td>Totals · closing balance</td><td class="n">${money(view.dr)}</td><td class="n">${money(view.cr)}</td><td class="n">${b(view.closing)}</td></tr>
      </table></body></html>`;
    try {
      const uri = await printPdfToCache({ html }, 'Statement-' + pt.name.replace(/[^A-Za-z0-9]+/g, '-') + '.pdf');
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Statement — ' + pt.name });
    } catch (e: any) {
      Alert.alert('Statement', e?.message || 'The statement could not be made.');
    }
  }

  if (!db || !pt) return null;

  const word = (b: number) => (b > 0.01 ? 'Owes you' : b < -0.01 ? (pt.type === 'supplier' ? 'You owe' : 'In credit') : 'Settled');
  /* figures in the table without the currency, so the columns read cleanly */
  const fig = (n: number) => groupNum(Math.abs(n), db.settings.decimals === 2 ? 2 : 0, true);
  const bal = (b: number) => fig(b) + (b > 0.01 ? ' Dr' : b < -0.01 ? ' Cr' : '');
  const day = (ts: string) => new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
  const head = { fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 0.5, color: colors.faint } as const;
  const num = { width: 78, textAlign: 'right' as const, fontFamily: fonts.monoSemi, fontSize: 12.5 };

  const boxRow = (label: string, b: number, strong?: boolean) => (
    <View style={{
      flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
      backgroundColor: strong ? colors.accentSoft : colors.sunk,
    }}>
      <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 13, color: strong ? colors.accent : colors.ink }}>{label}</Text>
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
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>{item.memo}</Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 2 }}>{day(item.ts)}{item.ref ? ' · ' + item.ref : ''}</Text>
            </View>
            <Text style={[num, { color: item.debit ? colors.danger : colors.faint }]}>{item.debit ? fig(item.debit) : '—'}</Text>
            <Text style={[num, { color: item.credit ? colors.good : colors.faint }]}>{item.credit ? fig(item.credit) : '—'}</Text>
            <Text style={[num, { width: 86, fontFamily: fonts.monoSemi, color: colors.ink }]}>{bal(item.balance)}</Text>
          </View>
        )}
        ListFooterComponent={
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.line }}>
              <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 13, color: colors.ink }}>Totals for the period</Text>
              <Text style={[num, { color: colors.danger }]}>{fig(view.dr)}</Text>
              <Text style={[num, { color: colors.good }]}>{fig(view.cr)}</Text>
              <View style={{ width: 86 }} />
            </View>
            {boxRow('Closing balance · ' + new Date(Math.min(period.to, Date.now())).toLocaleDateString('en-GB'), view.closing, true)}
          </View>
        }
      />
    </View>
  );
}
