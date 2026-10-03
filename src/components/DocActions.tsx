/**
 * The print / share / more trio that sits on every document the shop raises,
 * plus the helpers that turn a stored record into something printable.
 */
import React, { useState } from 'react';
import { View, Text, ActivityIndicator, Alert } from 'react-native';
import { Pressable } from './Press';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from './Toast';
import { Icon, IconName } from './icons';
import Sheet from './Sheet';
import { ListRow } from './kit';
import { printDoc, shareDoc, docText, DocMeta } from '../data/docPrint';
import { printOptsFor, docKindOf, defaultPrinter, paperOf, shareOptsFor } from '../data/printSetup';
import { reportError } from '../data/crashReporter';
import SendSheet from './SendSheet';
import { docMessage } from '../data/messages';
import { PrinterError } from '../data/rawPrinter';
import type { Sale, Purchase, Payment, Printer } from '../data/types';

/** Builds the printable form of a sale, including batch and expiry per line. */
export function useDocBuilder() {
  const { db, party, user, product } = useAppData();

  function saleDoc(sale: Sale, kind = 'Tax Invoice'): DocMeta {
    const pt = sale.partyId ? party(sale.partyId) : undefined;
    return {
      kind,
      // paid in full at the counter it is a receipt; money still owed makes it an invoice
      docKind: sale.due > 0 ? 'invoice' : 'receipt',
      no: sale.no,
      ts: sale.ts,
      firmName: db?.firm.name || '',
      firmAddress: db?.firm.address,
      firmTin: db?.firm.tin,
      firmPhone: db?.firm.phone,
      firmEmail: db?.firm.email,
      firmWhatsapp: db?.firm.phone2,
      firmWebsite: db?.firm.website,
      firmBank: db?.firm.bankDetails,
      firmTerms: db?.firm.terms,
      taxLabel: db?.settings.taxName,
      firmDescription: db?.firm.description,
      logo: db?.firm.logo,
      signature: db?.firm.signature,
      footer: db?.firm.footer,
      partyName: pt?.name,
      partyPhone: pt?.phone,
      partyAddress: pt?.address,
      currencyName: db?.settings.currencyName,
      lines: sale.lines.map((l) => {
        const p = product(l.productId);
        const b = l.batchNo ? (p?.batches || []).find((x) => x.no === l.batchNo) : undefined;
        return {
          name: l.name, qty: l.qty, price: l.price, unit: l.unit,
          batchNo: l.batchNo, expiry: b?.expiry,
          serials: l.serials || (l.serialNo ? [{ imei: l.serialNo }] : undefined),
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
      firmPhone: db?.firm.phone,
      firmEmail: db?.firm.email,
      firmWhatsapp: db?.firm.phone2,
      firmWebsite: db?.firm.website,
      firmBank: db?.firm.bankDetails,
      firmTerms: db?.firm.terms,
      taxLabel: db?.settings.taxName,
      firmDescription: db?.firm.description,
      logo: db?.firm.logo,
      signature: db?.firm.signature,
      footer: db?.firm.footer,
      partyName: pt?.name,
      partyPhone: pt?.phone,
      currencyName: db?.settings.currencyName,
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
      servedBy: x.userId ? user(x.userId)?.name : undefined,
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
      firmPhone: db?.firm.phone,
      firmEmail: db?.firm.email,
      firmWhatsapp: db?.firm.phone2,
      firmWebsite: db?.firm.website,
      firmBank: db?.firm.bankDetails,
      firmTerms: db?.firm.terms,
      taxLabel: db?.settings.taxName,
      firmDescription: db?.firm.description,
      logo: db?.firm.logo,
      signature: db?.firm.signature,
      footer: db?.firm.footer,
      partyName: pt?.name,
      partyPhone: pt?.phone,
      currencyName: db?.settings.currencyName,
      // the printed receipt names each invoice it paid, so the customer's copy traces too
      lines: p.allocations && p.allocations.length
        ? [
          ...p.allocations.map((a) => ({ name: (p.direction === 'in' ? 'Invoice ' : 'Bill ') + a.no, qty: 1, price: a.amount })),
          ...(p.unapplied ? [{ name: 'Advance on account', qty: 1, price: p.unapplied }] : []),
        ]
        : [{ name: p.note || (p.direction === 'in' ? 'Amount received' : 'Amount paid'), qty: 1, price: p.amount }],
      subtotal: p.amount,
      total: p.amount,
      paid: p.amount,
      method: p.method,
      note: p.note,
      servedBy: p.userId ? user(p.userId)?.name : undefined,
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
export function DocActions({ doc, more, compact, phone, email }: {
  doc: () => DocMeta;
  more?: MoreAction[];
  compact?: boolean;
  /** When given, a WhatsApp entry is offered in the more menu. */
  phone?: string;
  email?: string;
}) {
  const { colors } = useTheme();
  const { money, db } = useAppData();
  const { error, success } = useToast();
  const [busy, setBusy] = useState<'print' | 'share' | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [sending, setSending] = useState<DocMeta | null>(null);
  const printers = db?.printers || [];
  const dflt = defaultPrinter(db);

  async function run(what: 'print' | 'share', printer?: Printer) {
    setBusy(what);
    try {
      const d = doc();
      const opts = printOptsFor(db, d.docKind || docKindOf(d.kind), printer);
      if (what === 'print') await printDoc(d, money, opts);
      else {
        // a shared copy is A4 unless it is a receipt for a roll
        const ok = await shareDoc(d, money, shareOptsFor(db, d.docKind || docKindOf(d.kind)));
        if (!ok) error('Sharing is not available on this device.');
      }
    } catch (e: any) {
      error(e?.message || 'That could not be ' + (what === 'print' ? 'printed' : 'shared'));
      // a printer that is off is not a bug; anything else is worth a report
      if (!(e instanceof PrinterError)) void reportError(e, { extra: { where: what, printer: printer?.kind || dflt?.kind } });
    } finally {
      setBusy(null);
    }
  }

  /** The document as a ready-written message, to send by WhatsApp, SMS, email or any app. */
  function message() {
    setMoreOpen(false);
    const d = doc();
    setTimeout(() => setSending(d), 250);
  }

  function copyText() {
    setMoreOpen(false);
    const d = doc();
    Alert.alert(d.kind + ' ' + d.no, docText(d, money));
  }

  const btn = (icon: IconName, onPress: () => void, loading?: boolean, tint?: string, label?: string) => (
    <Pressable
      onPress={loading ? undefined : onPress}
      hitSlop={6}
      accessibilityLabel={label}
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
        {btn('print', () => run('print'), busy === 'print', colors.accent, 'Print')}
        {btn('swap', () => run('share'), busy === 'share', colors.good, 'Share')}
        {btn('dots', () => setMoreOpen(true), false, undefined, 'More options')}
      </View>

      <Sheet
        visible={moreOpen}
        title="More options"
        icon="dots"
        onClose={() => setMoreOpen(false)}
      >
        <ListRow card icon="phone" tone="good" title="Send as message" subtitle="WhatsApp, SMS, email or another app" onPress={message} />
        <ListRow card icon="doc" tone="accent" title="Show as text" subtitle="Copy the figures by hand" onPress={copyText} />
        <ListRow
          card
          icon="print"
          tone="accent"
          title="Print on another printer"
          subtitle={dflt ? 'Now goes to ' + dflt.name + ' · ' + paperOf(dflt) : 'Choose the printer and paper'}
          onPress={() => { setMoreOpen(false); setChoosing(true); }}
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

      <SendSheet
        visible={!!sending}
        onClose={() => setSending(null)}
        title={sending ? 'Send ' + sending.kind.toLowerCase() + ' ' + sending.no : 'Send'}
        to={sending?.partyName}
        phone={phone || sending?.partyPhone}
        email={email}
        subject={sending ? sending.kind + ' ' + sending.no + ' from ' + sending.firmName : undefined}
        text={sending ? docMessage(sending, money) : ''}
      />

      <Sheet visible={choosing} title="Print on" icon="print" onClose={() => setChoosing(false)}>
        {printers.map((p) => (
          <ListRow
            key={p.id}
            card
            icon="print"
            tone={p.dflt ? 'accent' : 'neutral'}
            title={p.name + (p.dflt ? ' · default' : '')}
            subtitle={paperOf(p) + (paperOf(p) === 'A4' ? ' page' : ' roll') + (p.note ? ' · ' + p.note : '')}
            onPress={() => { setChoosing(false); void run('print', p); }}
          />
        ))}
        {!printers.length ? (
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, paddingVertical: 12 }}>
            No printers are set up. Add them under Settings, Printing.
          </Text>
        ) : null}
      </Sheet>
    </>
  );
}
