/**
 * Stock destinations for the quick actions: Adjust stock, Move between stores,
 * Batches & expiry (reference QUICK "Stock" group, lines 5484-5494).
 */
import React, { useState } from 'react';
import { View, Text, FlatList, TextInput, Alert } from 'react-native';
import ScrollView from '../components/KeyScroll';
import { Pressable } from '../components/Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Card, Cap, Button, Chip, SearchBar, Field, EmptyState, IconTile, Grid, Stat } from '../components/ui';
import { Icon } from '../components/icons';
import { fmtDay } from '../data/helpers';
import DocEntry from '../components/DocEntry';
import { CartLine } from '../components/LineEditor';
import { SelectField } from '../components/form';

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

/* Move between stores: the shared document layout (DocEntry), so it reads
   like a sale — several items at once, each checked against what the store
   it leaves from holds. */
export function StockTransferScreen({ navigation }: any) {
  const { db, transferStock } = useAppData();
  const stores = db?.warehouses || [];
  const [from, setFrom] = useState(stores[0]?.id || '');
  const [to, setTo] = useState(stores[1]?.id || stores[0]?.id || '');
  const [lines, setLines] = useState<CartLine[]>([]);
  if (!db) return null;
  const qtyOf = (l: CartLine) => l.qty * (l.unitFactor || 1);
  const short = lines.find((l) => (db.products.find((p) => p.id === l.productId)?.stock?.[from] || 0) < qtyOf(l));
  const blocked = stores.length < 2 ? 'Add a second store first (Settings → Stores).'
    : from === to ? 'Pick two different stores.'
    : short ? short.name + ': only ' + (db.products.find((p) => p.id === short.productId)?.stock?.[from] || 0) + ' in ' + (stores.find((w) => w.id === from)?.name || 'that store') + '.'
    : undefined;
  return (
    <DocEntry
      kind="Move between stores"
      icon="swap"
      tone="accent"
      partyType="none"
      partyId={null}
      onPartyChange={() => undefined}
      lines={lines}
      onLinesChange={setLines}
      priceOf="cost"
      showTotals={false}
      saveLabel="Move stock"
      askWho="Who moved this stock?"
      blockedReason={lines.length ? blocked : undefined}
      onSave={() => {
        lines.forEach((l) => transferStock(l.productId, from, to, qtyOf(l), 'Warehouse transfer'));
        navigation.goBack();
      }}
    >
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <SelectField label="From" icon="box" value={from} onChange={setFrom} options={stores.map((w) => ({ v: w.id, l: w.name }))} />
        </View>
        <View style={{ flex: 1 }}>
          <SelectField label="To" icon="box" value={to} onChange={setTo} options={stores.map((w) => ({ v: w.id, l: w.name }))} />
        </View>
      </View>
    </DocEntry>
  );
}
