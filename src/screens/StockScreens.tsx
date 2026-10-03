/**
 * Stock destinations for the quick actions: Adjust stock, Move between stores,
 * Batches & expiry (reference QUICK "Stock" group, lines 5484-5494).
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, FlatList, TextInput, Alert } from 'react-native';
import { Pressable } from '../components/Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Card, Cap, Button, Chip, SearchBar, Field, EmptyState, IconTile, Grid, Stat } from '../components/ui';
import { Icon } from '../components/icons';
import { fmtDay } from '../data/helpers';

export function StockAdjustScreen() {
  const { colors } = useTheme();
  const { db, stockOf, adjustStock } = useAppData();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  // For a batch-tracked item the count can be one batch's: the shelf holds lots,
  // and "we found 3 more of lot A12" is what a count actually turns up.
  const [batchNo, setBatchNo] = useState<string | undefined>(undefined);

  if (!db) return null;
  const wh = db.session.warehouse;
  const list = db.products.filter((p) => p.active && (p.name + ' ' + p.sku).toLowerCase().includes(q.toLowerCase()));

  const apply = (id: string) => {
    const n = Number(value);
    if (Number.isNaN(n)) { Alert.alert('Count', 'Enter a number.'); return; }
    adjustStock(id, wh, n, batchNo ? 'Batch count' : 'Manual stock count', batchNo);
    setEditing(null); setValue(''); setBatchNo(undefined);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SearchBar value={q} onChange={setQ} placeholder="Search product or code" />
      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        // the same catalog as ItemsScreen, so the same reason: nothing off
        // screen should stay mounted just because a ScrollView never unmounts it
        ListEmptyComponent={<EmptyState icon="box" title="Nothing here" subtitle="Clear the search, or add a product first." />}
        renderItem={({ item: p, index: i }) => (
          <View style={{
            backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 11,
            borderBottomWidth: i === list.length - 1 ? 0 : 1, borderBottomColor: colors.line,
          }}>
            <Pressable
              onPress={() => { setEditing(editing === p.id ? null : p.id); setValue(String(stockOf(p))); setBatchNo(undefined); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}
            >
              <IconTile icon="box" bg={colors.sunk} color={colors.faint} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink }}>{p.name}</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 1 }}>{p.sku}</Text>
              </View>
              <Text style={{ fontFamily: fonts.monoSemi, fontSize: 12.5, color: colors.ink }}>{stockOf(p)} {p.unit}</Text>
            </Pressable>
            {editing === p.id && p.trackBatches && (p.batches || []).length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
                <Chip label={'Whole item · ' + stockOf(p)} on={!batchNo} onPress={() => { setBatchNo(undefined); setValue(String(stockOf(p))); }} />
                {(p.batches || []).map((b) => (
                  <Chip
                    key={b.no}
                    label={'Batch ' + b.no + ' · ' + b.qty + (b.expiry ? ' · exp ' + fmtDay(b.expiry) : '')}
                    on={batchNo === b.no}
                    onPress={() => { setBatchNo(b.no); setValue(String(b.qty)); }}
                  />
                ))}
              </View>
            ) : null}
            {editing === p.id ? (
              <View style={{ flexDirection: 'row', gap: 9, marginTop: 10, alignItems: 'center' }}>
                <Field label="Counted" value={value} onChangeText={setValue} numeric decimal autoFocus style={{ flex: 1, marginBottom: 0 }} />
                <Button size="sm" variant="pri" label={batchNo ? 'Set batch count' : 'Set count'} onPress={() => apply(p.id)} />
              </View>
            ) : null}
          </View>
        )}
      />
    </View>
  );
}

export function StockTransferScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { db, stockOf, transferStock } = useAppData();
  const [productId, setProductId] = useState(db?.products[0]?.id || '');
  const [from, setFrom] = useState(db?.warehouses[0]?.id || '');
  const [to, setTo] = useState(db?.warehouses[1]?.id || db?.warehouses[0]?.id || '');
  const [qty, setQty] = useState('');
  const [q, setQ] = useState('');

  if (!db) return null;
  const list = db.products.filter((p) => p.active && (p.name + ' ' + p.sku).toLowerCase().includes(q.toLowerCase())).slice(0, 25);
  const p = db.products.find((x) => x.id === productId);

  const move = () => {
    const n = Number(qty);
    if (!p || !n || n <= 0) { Alert.alert('Quantity', 'Pick a product and a quantity.'); return; }
    if (from === to) { Alert.alert('Stores', 'Pick two different stores.'); return; }
    if ((p.stock[from] || 0) < n) { Alert.alert('Stock', 'Not enough stock in the selected source store.'); return; }
    transferStock(p.id, from, to, n, 'Warehouse transfer');
    navigation.goBack();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SearchBar value={q} onChange={setQ} placeholder="Search product" />
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Card style={{ padding: 14 }}>
          <Cap style={{ marginBottom: 6 }}>Product</Cap>
          <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
            {list.map((x) => <Chip key={x.id} label={x.name} on={x.id === productId} onPress={() => setProductId(x.id)} />)}
          </View>
          <Cap style={{ marginBottom: 6 }}>From</Cap>
          <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
            {db.warehouses.map((w) => <Chip key={w.id} label={w.name} on={w.id === from} onPress={() => setFrom(w.id)} />)}
          </View>
          <Cap style={{ marginBottom: 6 }}>To</Cap>
          <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
            {db.warehouses.map((w) => <Chip key={w.id} label={w.name} on={w.id === to} onPress={() => setTo(w.id)} />)}
          </View>
          <Field label="Quantity" value={qty} onChangeText={setQty} numeric decimal />
          {p ? (
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginBottom: 12 }}>
              {p.name}: {p.stock[from] || 0} in {db.warehouses.find((w) => w.id === from)?.name}, total {stockOf(p)} {p.unit}.
            </Text>
          ) : null}
          <Button variant="pri" label="Move stock" onPress={move} />
        </Card>
      </ScrollView>
    </View>
  );
}
