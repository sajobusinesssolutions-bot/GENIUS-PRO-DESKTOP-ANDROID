import React from 'react';
import { ScrollView, View } from 'react-native';
import { useTheme } from '../theme';
import { useAppData } from '../data/AppDataContext';
import {
  Panel, Badge, ListRow, AccentHead, EmptyBlock, StatGrid,
} from '../components/ui';

export default function WarrantiesScreen() {
  const { colors } = useTheme();
  const { db, product, party } = useAppData();

  function expiry(w: any) {
    const d = new Date(w.soldAt);
    d.setMonth(d.getMonth() + w.months);
    return d;
  }

  const warranties = db?.warranties || [];
  const claims = db?.claims || [];
  const open = claims.filter((c) => c.status !== 'resolved').length;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
      <StatGrid
        items={[
          { icon: 'shield', label: 'Warranties', value: String(warranties.length), tone: 'accent' },
          { icon: 'alert', label: 'Open claims', value: String(open), tone: open ? 'warn' : 'good' },
        ]}
      />

      <View style={{ height: 20 }} />
      <AccentHead title="Active warranties" tone="accent" />
      <Panel flush>
        {warranties.length ? warranties.map((w, i) => (
          <ListRow
            key={w.id}
            icon="shield"
            tone={w.status === 'claim' ? 'warn' : w.status === 'resolved' ? 'good' : 'accent'}
            title={product(w.productId)?.name || 'Item'}
            subtitle={(w.partyId ? party(w.partyId)?.name || 'Walk-in' : 'Walk-in') + ' · expires ' + expiry(w).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            right={<Badge label={w.status} tone={w.status === 'claim' ? 'warn' : w.status === 'resolved' ? 'good' : 'accent'} />}
            last={i === warranties.length - 1}
          />
        )) : (
          <EmptyBlock icon="shield" title="No warranties registered" hint="Warranties are created when you sell an item that carries one." />
        )}
      </Panel>

      <View style={{ height: 20 }} />
      <AccentHead title="Claims" tone="warn" />
      <Panel flush>
        {claims.length ? claims.map((c, i) => (
          <ListRow
            key={c.id}
            icon="tools"
            tone={c.status === 'resolved' ? 'good' : 'warn'}
            title={c.fault}
            subtitle={'Opened ' + new Date(c.openedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            right={<Badge label={c.status} tone={c.status === 'resolved' ? 'good' : 'warn'} />}
            last={i === claims.length - 1}
          />
        )) : (
          <EmptyBlock icon="tools" title="No claims filed" hint="Faults raised against a warranty appear here." />
        )}
      </Panel>
    </ScrollView>
  );
}
