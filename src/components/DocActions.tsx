/**
 * The print / share / more trio that sits on every document the shop raises,
 * plus the helpers that turn a stored record into something printable.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert, Linking } from 'react-native';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from './Toast';
import { Icon, IconName } from './icons';
import Sheet from './Sheet';
import { ListRow } from './kit';
import { printDoc, shareDoc, docText, DocMeta } from '../data/docPrint';
import type { Sale, Purchase, Payment } from '../data/types';

/** Builds the printable form of a sale, including batch and expiry per line. */
export function useDocBuilder() {
  const { db, party, user, product } = useAppData();

  function saleDoc(sale: Sale, kind = 'Tax Invoice'): DocMeta {
    const pt = sale.partyId ? party(sale.partyId) : undefined;
    return {
      kind,
      no: sale.no,
      ts: sale.ts,
      firmName: db?.firm.name || '',
      firmAddress: db?.firm.address,
      firmTin: db?.firm.tin,
      partyName: pt?.name,
      partyPhone: pt?.phone,
      partyAddress: pt?.address,
      lines: sale.lines.map((l) => {
        const p = product(l.productId);
        const b = l.batchNo ? (p?.batches || []).find((x) => x.no === l.batchNo) : undefined;
        return {
          name: l.name, qty: l.qty, price: l.price, unit: l.unit,
          batchNo: l.batchNo, expiry: b?.expiry,
        };
      }),
      subtotal: sale.gross,
      discount: sale.discount,
      tax: sale.tax,
      charges: sale.additionalCharges,
      total: sale.total,
      paid: sale.paid,
      due: sale.due,
      method: sale.method,
      note: sale.note,
      terms: sale.terms,
      servedBy: user(sale.userId)?.name,
    };
  }

  function purchaseDoc(x: Purchase): DocMeta {
    const pt = party(x.partyId);
    return {
      kind: 'Purchase Bill',
      no: x.no,
      ts: x.ts,
      firmName: db?.firm.name || '',
      firmAddress: db?.firm.address,
      firmTin: db?.firm.tin,
      partyName: pt?.name,
      partyPhone: pt?.phone,
      lines: x.lines.map((l) => ({
        name: product(l.productId)?.name || l.productId,
        qty: l.qty, price: l.cost, unit: product(l.productId)?.unit,
        batchNo: l.batchNo, expiry: l.expiry,
      })),
      subtotal: x.total,
      total: x.total,
      paid: x.paid,
      due: x.due,
      method: x.method,
      note: x.note,
    };
  }

  function paymentDoc(p: Payment): DocMeta {
    const pt = party(p.partyId);
    return {
      kind: p.direction === 'in' ? 'Receipt' : 'Payment Voucher',
      no: p.id.slice(-8).toUpperCase(),
      ts: p.ts,
      firmName: db?.firm.name || '',
      firmAddress: db?.firm.address,
      firmTin: db?.firm.tin,
      partyName: pt?.name,
      partyPhone: pt?.phone,
      lines: [{ name: p.note || (p.direction === 'in' ? 'Amount received' : 'Amount paid'), qty: 1, price: p.amount }],
      subtotal: p.amount,
      total: p.amount,
      paid: p.amount,
      method: p.method,
      note: p.note,
    };
  }

  return { saleDoc, purchaseDoc, paymentDoc };
}

export interface MoreAction {
  label: string;
  sub?: string;
  icon: IconName;
  tone?: 'accent' | 'good' | 'warn' | 'danger' | 'neutral';
  onPress: () => void;
}

/**
 * Print, share and a kebab for everything else. `compact` renders the icon-only
 * row that sits on a list card; the full form spells the actions out.
 */
export function DocActions({ doc, more, compact, phone }: {
  doc: () => DocMeta;
  more?: MoreAction[];
  compact?: boolean;
  /** When given, a WhatsApp entry is offered in the more menu. */
  phone?: string;
}) {
  const { colors } = useTheme();
  const { money } = useAppData();
  const { error, success } = useToast();
  const [busy, setBusy] = useState<'print' | 'share' | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  async function run(what: 'print' | 'share') {
    setBusy(what);
    try {
      const d = doc();
      if (what === 'print') await printDoc(d, money);
      else {
        const ok = await shareDoc(d, money);
        if (!ok) error('Sharing is not available on this device.');
      }
    } catch (e: any) {
      error(e?.message || 'That could not be ' + (what === 'print' ? 'printed' : 'shared'));
    } finally {
      setBusy(null);
    }
  }

  async function whatsapp() {
    setMoreOpen(false);
    const d = doc();
    const body = encodeURIComponent(docText(d, money));
    const to = (phone || '').replace(/[^0-9]/g, '');
    const url = to ? `whatsapp://send?phone=${to}&text=${body}` : `whatsapp://send?text=${body}`;
    try {
      const can = await Linking.canOpenURL(url);
      if (!can) { error('WhatsApp is not installed.'); return; }
      await Linking.openURL(url);
    } catch {
      error('WhatsApp could not be opened.');
    }
  }

  function copyText() {
    setMoreOpen(false);
    const d = doc();
    Alert.alert(d.kind + ' ' + d.no, docText(d, money));
  }

  const btn = (icon: IconName, onPress: () => void, loading?: boolean, tint?: string) => (
    <Pressable
      onPress={loading ? undefined : onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: compact ? 38 : 44, height: compact ? 38 : 44,
        borderRadius: compact ? 12 : 14,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: pressed ? colors.sunk : colors.surface,
        borderWidth: 1.4, borderColor: colors.line,
      })}
    >
      {loading ? <ActivityIndicator size="small" color={colors.accent} /> : <Icon name={icon} size={compact ? 17 : 19} color={tint || colors.soft} />}
    </Pressable>
  );

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {btn('print', () => run('print'), busy === 'print', colors.accent)}
        {btn('swap', () => run('share'), busy === 'share', colors.good)}
        {btn('dots', () => setMoreOpen(true))}
      </View>

      <Sheet
        visible={moreOpen}
        title="More options"
        icon="dots"
        onClose={() => setMoreOpen(false)}
      >
        <ListRow card icon="phone" tone="good" title="Send on WhatsApp" subtitle="As a message the customer can keep" onPress={whatsapp} />
        <ListRow card icon="doc" tone="accent" title="Show as text" subtitle="Copy the figures by hand" onPress={copyText} />
        <ListRow
          card
          icon="print"
          tone="accent"
          title="Print"
          subtitle="Open the system print dialog"
          onPress={() => { setMoreOpen(false); run('print'); }}
        />
        {(more || []).map((a) => (
          <ListRow
            key={a.label}
            card
            icon={a.icon}
            tone={a.tone || 'neutral'}
            title={a.label}
            subtitle={a.sub}
            onPress={() => { setMoreOpen(false); a.onPress(); }}
          />
        ))}
      </Sheet>
    </>
  );
}
