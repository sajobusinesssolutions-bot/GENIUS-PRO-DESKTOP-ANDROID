/**
 * CASH IN / CASH OUT — the money put into or taken out of the drawer and the
 * accounts, in a period: what it was for, from which account, and who.
 */
import React, { useMemo, useState } from 'react';
import { useTheme } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { ListPage, DocRow, SummaryTiles, PeriodBar, listPeriod, inPeriod } from '../components/DocList';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'CashEntries'>;

export default function CashEntriesScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const { db, money } = useAppData();
  const dir = route.params?.direction === 'out' ? 'out' : 'in';
  const [period, setPeriod] = useState(listPeriod('month'));
  const [q, setQ] = useState('');

  React.useEffect(() => { navigation.setOptions({ title: dir === 'in' ? 'Cash in' : 'Cash out' }); }, [dir, navigation]);

  const inRange = useMemo(
    () => (db?.entries || []).filter((e) => e.direction === dir && inPeriod(e.ts, period))
      .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()),
    [db?.entries, dir, period],
  );
  const accName = (id: string) => db?.accounts.find((a) => a.id === id)?.name || 'Account';
  const userName = (id?: string) => (id ? db?.users.find((u) => u.id === id)?.name : undefined);
  const needle = q.trim().toLowerCase();
  const list = inRange.filter((e) => !needle || (e.category + ' ' + e.note + ' ' + accName(e.accountId)).toLowerCase().includes(needle));
  const total = inRange.reduce((s, e) => s + e.amount, 0);
  const cats = new Set(inRange.map((e) => e.category)).size;
  const tone = dir === 'in' ? colors.good : colors.danger;

  return (
    <ListPage
      top={(
        <>
          <PeriodBar value={period} onChange={setPeriod} />
          <SummaryTiles tiles={[
            { label: dir === 'in' ? 'Total in' : 'Total out', value: money(total), tone },
            { label: 'Entries', value: String(inRange.length) + (cats ? ' · ' + cats + ' kind' + (cats === 1 ? '' : 's') : '') },
          ]} />
        </>
      )}
      search={{ value: q, onChange: setQ, placeholder: 'Search what it was for' }}
      data={list}
      keyExtractor={(e) => e.id}
      empty={{ text: 'No money ' + (dir === 'in' ? 'in' : 'out') + ' in this period. Record one with Add cash ' + dir + '.' }}
      add={{ label: 'Add cash ' + dir, onPress: () => navigation.navigate('EntryNew', { direction: dir }) }}
      renderItem={({ item: e }) => (
        <DocRow
          title={e.category || (dir === 'in' ? 'Money in' : 'Money out')}
          pill={{ label: dir === 'in' ? 'In' : 'Out', tone: dir === 'in' ? 'good' : 'danger' }}
          amount={(dir === 'in' ? '+' : '−') + money(e.amount)}
          amountTone={tone}
          refText={accName(e.accountId)}
          ts={e.ts}
          lines={[
            ...(e.note ? [{ label: 'Note', value: e.note }] : []),
            ...(userName(e.userId) ? [{ label: 'By', value: userName(e.userId)! }] : []),
          ]}
        />
      )}
    />
  );
}
