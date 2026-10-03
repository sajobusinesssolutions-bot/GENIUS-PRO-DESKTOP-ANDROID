/**
 * PURCHASES — supplier bills in a period: what was bought, what is still owed,
 * and one tap to print or share any bill.
 */
import React, { useMemo, useState } from 'react';
import { useTheme } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useDocBuilder } from '../components/DocActions';
import { ListPage, DocRow, StatusChips, SummaryTiles, PeriodBar, listPeriod, inPeriod, useQuickDoc } from '../components/DocList';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, any>;
type Status = 'all' | 'paid' | 'due';

export default function PurchasesScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, party } = useAppData();
  const { purchaseDoc } = useDocBuilder();
  const quick = useQuickDoc();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const [period, setPeriod] = useState(listPeriod('month'));

  const inRange = useMemo(
    () => [...(db?.purchases || [])].filter((p) => inPeriod(p.ts, period))
      .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()),
    [db?.purchases, period],
  );
  const needle = q.trim().toLowerCase();
  const list = inRange.filter((p) => {
    if (status === 'paid' && p.due > 0.01) return false;
    if (status === 'due' && p.due <= 0.01) return false;
    return !needle || (p.no + ' ' + (party(p.partyId)?.name || '')).toLowerCase().includes(needle);
  });

  return (
    <ListPage
      top={(
        <>
          <PeriodBar value={period} onChange={setPeriod} />
          <SummaryTiles tiles={[
            { label: 'Total purchases', value: money(inRange.reduce((s, p) => s + p.total, 0)) },
            { label: 'Balance due', value: money(inRange.reduce((s, p) => s + Math.max(0, p.due), 0)), tone: colors.danger },
          ]} />
          <StatusChips value={status} onChange={setStatus} options={[{ v: 'all', l: 'All' }, { v: 'paid', l: 'Paid' }, { v: 'due', l: 'Unpaid' }]} />
        </>
      )}
      search={{ value: q, onChange: setQ, placeholder: 'Search bill no. or supplier' }}
      data={list}
      keyExtractor={(p) => p.id}
      empty={{ text: 'No supplier bills in this period. Try a wider date range, or add a purchase.' }}
      add={{ label: 'Add purchase', onPress: () => navigation.navigate('PurchaseNew') }}
      renderItem={({ item: p }) => {
        const owed = p.due > 0.01;
        const part = owed && p.paid > 0.01;
        return (
          <DocRow
            title={party(p.partyId)?.name || 'Supplier'}
            pill={!owed ? { label: 'Paid', tone: 'good' } : part ? { label: 'Partial', tone: 'warn' } : { label: 'Unpaid', tone: 'danger' }}
            amount={money(p.total)}
            refText={'Purchase #' + p.no}
            ts={p.ts}
            lines={owed ? [{ label: 'Balance', value: money(p.due), tone: colors.danger }] : [{ label: 'Items', value: String(p.lines.length) }]}
            onPress={() => navigation.navigate('PurchaseDetail', { purchaseId: p.id })}
            onPrint={() => void quick(() => purchaseDoc(p), 'print')}
            onShare={() => void quick(() => purchaseDoc(p), 'share')}
          />
        );
      }}
    />
  );
}
