import React, { useMemo, useState } from 'react';
import { docDefaults, defaultTermsFor } from '../data/docDefaults';
import TermsPicker from '../components/TermsPicker';
import { useAppData } from '../data/AppDataContext';
import DocEntry, { toSaleLines } from '../components/DocEntry';
import { Field } from '../components/ui';
import { useToast } from '../components/Toast';
import type { CartLine } from '../components/LineEditor';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'EstimateNew'>;

/** A quotation — priced, but nothing moves until it is converted to a sale. Also changes an open one. */
export default function EstimateNewScreen({ navigation, route }: Props) {
  const { db, money, createEstimate, updateEstimate } = useAppData();
  const { success, error } = useToast();
  const editing = db?.estimates.find((e) => e.id === route.params?.editEstimateId && e.status === 'open');
  const [partyId, setPartyId] = useState<string | null>(editing?.partyId ?? null);
  const [lines, setLines] = useState<CartLine[]>(() => (editing?.lines || []).map((l) => ({
    productId: l.productId, name: l.name, qty: l.qty, price: l.price, unit: l.unit,
    unitFactor: l.unitFactor, listPrice: l.listPrice, discountPct: l.discountPct, note: l.note,
  })));
  const [discount, setDiscount] = useState(editing?.discount ? String(editing.discount) : '');
  const [validFor, setValidFor] = useState(String(docDefaults(db).quoteValidDays));
  /* printed on the quotation: the shop's standing terms to start with, and a note */
  const startTerms = defaultTermsFor(db, 'estimate');
  const [terms, setTerms] = useState(editing ? editing.terms || '' : startTerms.text);
  const [termsId, setTermsId] = useState<string | null>(editing ? null : startTerms.id);
  const [note, setNote] = useState(editing?.note ?? docDefaults(db).description);

  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const disc = Math.min(Number(discount) || 0, total);

  const until = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + (Number(validFor) || 0));
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }, [validFor]);

  return (
    <DocEntry
      kind="Quotation"
      icon="doc"
      tone="accent"
      partyType="customer"
      partyId={partyId}
      onPartyChange={setPartyId}
      lines={lines}
      onLinesChange={setLines}
      linesLabel="What is quoted"
      entryTitle="Add Items to Estimate/Quotation"
      autoStart={!editing}
      saveLabel={editing ? 'Save changes' : 'Save quotation'}
      askWho={editing ? 'Who changed this quotation?' : 'Who prepared this quotation?'}
      summary={
        <Field
          icon="clock"
          label="Valid for (days)"
          value={validFor}
          onChangeText={setValidFor}
          numeric
          style={{ marginBottom: 0 }}
        />
      }
      onSave={() => {
        const payload = { partyId, lines: toSaleLines(lines, db!.products), discount: disc, note: note.trim() || undefined, terms: terms.trim() || undefined };
        if (editing) {
          if (!updateEstimate(editing.id, payload)) { error('This quotation is closed and can no longer be changed.'); return; }
          success(editing.no + ' updated');
          navigation.goBack();
          return;
        }
        const days = Number(validFor) || 0;
        const until = new Date();
        until.setDate(until.getDate() + days);
        const est = createEstimate({ ...payload, ...(days > 0 ? { validUntil: until.toISOString() } : {}) });
        navigation.replace('EstimateDetail', { estimateId: est.id });
      }}
    >
      <Field
        icon="tag"
        label="Discount"
        value={discount}
        onChangeText={setDiscount}
        numeric
        decimal
        placeholder="0"
      />
      {Number(validFor) > 0 ? (
        <Field icon="calendar" label="Holds until" value={until} readOnly onChangeText={() => {}} />
      ) : null}
      <TermsPicker value={terms} onChange={setTerms} chosenId={termsId} onChoose={(id, text) => { setTermsId(id); setTerms(text); }} />
      <Field icon="pencil" label="Note to the customer" value={note} onChangeText={setNote} placeholder="Anything else they should know" multiline />
    </DocEntry>
  );
}
