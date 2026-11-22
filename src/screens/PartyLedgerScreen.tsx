/**
 * A party's ledger for a period: the balance brought forward, every sale,
 * purchase and payment in the period with its debit and credit, the running
 * balance after each, and the balance carried forward at the end.
 *
 * Debit is what increases what they owe you (a sale, money paid out to them);
 * credit is what reduces it (money received, a purchase from them). A positive
 * balance means they owe you, the same sign partyBalance uses.
 *
 * Laid out as the other reports are: search and Period under the bar, each
 * entry a row (what it was, its date and number, the balance after it) that
 * opens to its debit, credit and the items on the bill, and the closing
 * balance on the bar at the foot.
 */
import { tsMs } from '../data/helpers';
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Alert } from 'react-native';
import { Pressable } from '../components/Press';
import { fonts } from '../theme';
import * as Sharing from 'expo-sharing';
import { IconBtn } from '../components/AppBar';
import { printPdfToCache } from '../data/docPrint';
import { useAppData } from '../data/AppDataContext';
import { useBookFrom } from '../data/useBookFrom';
import { broughtForward } from '../data/reports';
import { listPeriod, ListPeriod } from '../components/DocList';
import { ControlRow, SearchBox, PeriodPill, MetaLine, FactRow, TotalBar, NothingHere, amt, amtDrCr, useReportPalette } from '../components/ReportList';
import { shortRange } from '../data/reportShape';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PartyLedger'>;

/** `items`: what was on the bill, for the detailed statement. */
interface Entry { ts: string; memo: string; ref: string; debit: number; credit: number; items?: Array<{ name: string; qty: number; unit?: string; price: number }>;
  /** A quotation: listed for the record, never owed, so no debit or credit. */
  info?: string }
interface Line extends Entry { balance: number }

export default function PartyLedgerScreen({ route, navigation }: Props) {
  const pal = useReportPalette();
  const { db, money, party } = useAppData();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const pt = party(route.params.partyId);
  const [period, setPeriod] = useState<ListPeriod>(() => listPeriod('month'));
  /* the period's entries read from disk when it starts before what is in memory */
  const { book: rangeBook, reading } = useBookFrom(db, period.from);

  // the party's name is the title, so nothing on the page repeats it; Share sits beside it
  useEffect(() => {
    if (!pt) return;
    navigation.setOptions({
      title: pt.name,
      subtitle: 'Ledger · every sale, purchase and payment',
      headerRight: () => <IconBtn name="share" size={22} color={pal.primary} onPress={() => askShare()} />,
    } as any);
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
      // on the ledger of whoever settled it; only the part that came off the bill (the rest was paid from the till)
      if (!s || (e.offsetPartyId || s.partyId) !== pt.id) return;
      out.push({ ts: e.ts, memo: 'Charged against — ' + e.category, ref: s.no, debit: 0, credit: e.offset ?? e.amount });
    });
    (db.estimates || []).forEach((e) => {
      if (e.partyId !== pt.id || e.status === 'void') return;
      out.push({ ts: e.ts, memo: 'Quotation' + (e.status === 'converted' ? ' · turned into a sale' : ''), ref: e.no, debit: 0, credit: 0,
        info: 'Quoted ' + amt(e.total) + ' · not owed', items: e.lines.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit, price: l.price })) });
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
      ${l.info ? '<div class="it">' + esc(l.info) + '</div>' : ''}</td><td class="n">${l.debit ? money(l.debit) : ''}</td><td class="n">${l.credit ? money(l.credit) : ''}</td><td class="n">${b(l.balance)}</td></tr>`).join('');
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
  const day = (ts: string) => new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
  const needle = q.trim().toLowerCase();
  const lines = view.lines.map((l, i) => ({ l, i })).filter(({ l }) => !needle || (l.memo + ' ' + l.ref + ' ' + day(l.ts)).toLowerCase().includes(needle));

  return (
    <View style={{ flex: 1, backgroundColor: pal.bg }}>
      <ControlRow>
        <SearchBox value={q} onChange={(v) => { setQ(v); setOpen(null); }} placeholder="Search this ledger" />
        <PeriodPill value={period} onChange={(p) => { setPeriod(p); setOpen(null); }} />
      </ControlRow>
      <FlatList
        data={lines}
        keyExtractor={(x) => String(x.i)}
        extraData={open}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={14}
        windowSize={9}
        ListHeaderComponent={
          <View>
            <MetaLine left={lines.length + ' entr' + (lines.length === 1 ? 'y' : 'ies') + (needle ? ' of ' + view.lines.length : '') + (reading ? ' · reading older records…' : '')} right={shortRange(period.from, period.to)} />
            <LedgerHead />
            {needle ? null : <FactRow strong title="Opening balance" sub={period.from > 0 ? new Date(period.from).toLocaleDateString('en-GB') : 'From the start'} value={amtDrCr(view.opening)} valueLabel={word(view.opening)} zero={Math.abs(view.opening) < 0.005} />}
          </View>
        }
        ListFooterComponent={<View style={{ height: 16 }} />}
        ListEmptyComponent={needle
          ? <NothingHere text={'No results for \u201C' + q + '\u201D'} clear="Clear search" onClear={() => setQ('')} />
          : <NothingHere text="Nothing in this period. Choose another period above." />}
        renderItem={({ item: { l, i } }) => (
          <LedgerRow
            memo={l.memo} sub={day(l.ts) + (l.ref ? ' · ' + l.ref : '') + (l.info ? ' · ' + l.info : '')}
            debit={l.debit} credit={l.credit} balance={l.balance} info={!!l.info}
            open={open === i} onToggle={() => setOpen((o) => (o === i ? null : i))}
            lines={[
              { label: 'Date', value: new Date(l.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) },
              ...(l.ref ? [{ label: 'Reference', value: l.ref }] : []),
              { label: 'Debit', value: amt(l.debit) },
              { label: 'Credit', value: amt(l.credit) },
              ...(l.items || []).map((it) => ({ label: it.name, value: it.qty + (it.unit ? ' ' + it.unit : '') + ' × ' + amt(it.price) + ' = ' + amt(it.qty * it.price) })),
              { label: 'Balance after', value: amtDrCr(l.balance), bold: true },
            ]}
          />
        )}
      />
      <TotalBar label={'Closing balance · ' + word(view.closing)} value={amtDrCr(view.closing)} others={[
        { label: 'Debit', value: amt(view.dr) },
        { label: 'Credit', value: amt(view.cr) },
      ]} />
    </View>
  );
}

/* the three figure columns, the same width on every row so they line up */
const COL = 78;
function LedgerHead() {
  const p = useReportPalette();
  const h = (t: string) => <Text style={{ width: COL, textAlign: 'right', fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 0.3, color: p.muted }}>{t}</Text>;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: p.chip, borderBottomWidth: 1, borderBottomColor: p.row }}>
      <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 0.3, color: p.muted }}>DETAILS</Text>
      {h('DEBIT')}{h('CREDIT')}{h('BALANCE')}
    </View>
  );
}
/** One entry: what it was, its date and number, then its debit, credit and the balance after it; tapped, its lines. */
function LedgerRow({ memo, sub, debit, credit, balance, info, open, onToggle, lines }: {
  memo: string; sub: string; debit: number; credit: number; balance: number; info?: boolean;
  open: boolean; onToggle: () => void; lines: Array<{ label: string; value: string; bold?: boolean }>;
}) {
  const p = useReportPalette();
  const num = (v: string, bold?: boolean, faint?: boolean) => (
    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
      style={{ width: COL, textAlign: 'right', fontFamily: bold ? fonts.uiBold : fonts.ui, fontSize: 13, color: faint ? p.faint : p.text, fontVariant: ['tabular-nums'] }}>{v}</Text>
  );
  return (
    <View style={{ backgroundColor: open ? p.open : p.card, borderBottomWidth: 1, borderBottomColor: p.row }}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={{ minHeight: 52, paddingHorizontal: 16, paddingVertical: 9, flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1, minWidth: 0, paddingRight: 6 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: info ? p.muted : p.text }}>{memo}</Text>
          <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 11.5, color: p.muted, marginTop: 2 }}>{sub}</Text>
        </View>
        {num(amt(debit), false, !debit)}
        {num(amt(credit), false, !credit)}
        {num(amtDrCr(balance), true)}
      </Pressable>
      {open ? (
        <View style={{ marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: p.openLine, backgroundColor: p.card }}>
          {lines.map((x, k) => (
            <View key={x.label + k} style={{ flexDirection: 'row', gap: 12, paddingVertical: 5 }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 14, color: p.muted, flexShrink: 0, maxWidth: '55%' }}>{x.label}</Text>
              <Text style={{ flex: 1, textAlign: 'right', fontFamily: x.bold ? fonts.uiBold : fonts.ui, fontSize: 14, color: p.text }}>{x.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
