import React, { useMemo, useState } from 'react';
import { useAppData } from '../data/AppDataContext';
import DocEntry, { toSaleLines } from '../components/DocEntry';
import { Field } from '../components/ui';
import type { CartLine } from '../components/LineEditor';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'EstimateNew'>;

/** A quotation — priced, but nothing moves until it is converted to a sale. */
export default function EstimateNewScreen({ navigation }: Props) {
  const { db, money, createEstimate } = useAppData();
  const [partyId, setPartyId] = useState<string | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState('');
  const [validFor, setValidFor] = useState('14');

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
      saveLabel={'Create quotation · ' + money(Math.max(0, total - disc))}
      askWho="Who prepared this quotation?"
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
        createEstimate({
          partyId,
          lines: toSaleLines(lines, db!.products),
          discount: disc,
        });
        navigation.goBack();
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
    </DocEntry>
  );
}
