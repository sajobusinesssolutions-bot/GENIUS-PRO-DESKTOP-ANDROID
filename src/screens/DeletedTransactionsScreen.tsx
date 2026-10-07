/**
 * DELETED TRANSACTIONS — More → Deleted transactions.
 *
 * Deleting a sale, purchase or payment takes it out of the activity lists, but
 * nothing is lost: the delete posted a reversal, and the record waits here.
 * Each card says what it was, who deleted it and when, and offers the two
 * things that can be done with it: Restore (the reversal is undone, stock and
 * money go back as they were) or Delete forever — which only clears it from
 * this list; the reversal stays in the books and the audit log.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, Alert } from 'react-native';
import { Pressable } from '../components/Press';
import { useAppData } from '../data/AppDataContext';
import { useTheme, fonts } from '../theme';
import { useToast } from '../components/Toast';
import { Icon, IconName } from '../components/icons';
import { Field } from '../components/form';
import { explain } from '../data/refusal';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'DeletedTransactions'>;
type Kind = 'sale' | 'purchase' | 'payment';
type Filter = 'all' | Kind;

interface Item {
  id: string; kind: Kind; no: string; who: string; amount: number; lines: number;
  ts: string; deletedAt: string; by: string; reason: string;
}

const KIND: Record<Kind, { label: string; icon: IconName }> = {
  sale: { label: 'Sale', icon: 'receipt' },
  purchase: { label: 'Purchase', icon: 'cart' },
  payment: { label: 'Payment', icon: 'cash' },
};

const DAY = 864e5;
/** "Today 14:05", "Yesterday", "3 Oct" — how long ago it went. */
function ago(ts: string): string {
  const t = new Date(ts);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / DAY);
  const time = t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (days <= 0) return 'Today ' + time;
  if (days === 1) return 'Yesterday ' + time;
  return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined });
}

export default function DeletedTransactionsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, party, restoreDeleted, purgeDeleted } = useAppData();
  const { success } = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');

  const all = useMemo<Item[]>(() => {
    if (!db) return [];
    const userName = (id?: string) => db.users.find((u) => u.id === id)?.name || 'Someone';
    const partyName = (id?: string | null) => (id ? party(id)?.name || 'Walk-in' : 'Walk-in');
    const out: Item[] = [];
    db.sales.forEach((s) => {
      if (!s.deletedAt || s.purgedAt) return;
      out.push({ id: s.id, kind: 'sale', no: s.no, who: partyName(s.partyId), amount: s.total, lines: s.lines.length, ts: s.ts, deletedAt: s.deletedAt, by: userName(s.deletedBy), reason: s.voidReason || '' });
    });
    db.purchases.forEach((x) => {
      if (!x.deletedAt || x.purgedAt) return;
      out.push({ id: x.id, kind: 'purchase', no: x.ref || x.no, who: partyName(x.partyId), amount: x.total, lines: x.lines.length, ts: x.ts, deletedAt: x.deletedAt, by: userName(x.deletedBy), reason: x.voidReason || '' });
    });
    (db.deletedPayments || []).forEach((p) => {
      if (p.purgedAt) return;
      out.push({ id: p.id, kind: 'payment', no: p.direction === 'in' ? 'Payment received' : 'Payment made', who: partyName(p.partyId), amount: p.amount, lines: 0, ts: p.ts, deletedAt: p.deletedAt, by: userName(p.deletedBy), reason: p.deleteReason || '' });
    });
    return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }, [db, party]);

  const needle = q.trim().toLowerCase();
  const list = all.filter((x) => (filter === 'all' || x.kind === filter)
    && (!needle || (x.no + ' ' + x.who + ' ' + x.by).toLowerCase().includes(needle)));
  const count = (k: Filter) => (k === 'all' ? all.length : all.filter((x) => x.kind === k).length);
  const total = list.reduce((s, x) => s + x.amount, 0);

  const open = (x: Item) => (x.kind === 'sale' ? () => navigation.navigate('SaleDetail', { saleId: x.id })
    : x.kind === 'purchase' ? () => navigation.navigate('PurchaseDetail', { purchaseId: x.id }) : undefined);

  function restore(x: Item) {
    Alert.alert('Restore ' + x.no + '?', money(x.amount) + ' · ' + x.who + '\n\n'
      + (x.kind === 'payment' ? 'The money and the balance it settled come back.' : 'The stock and the money go back exactly as they were before it was deleted.')
      + ' It returns to your activity.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Restore', onPress: () => { try { restoreDeleted(x.kind, x.id); success(x.no + ' restored'); } catch (e) { explain(e); } } },
    ]);
  }

  function purge(x: Item) {
    Alert.alert('Delete ' + x.no + ' forever?', 'It can no longer be restored. Its reversal stays in the books and the audit log.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Delete forever', style: 'destructive', onPress: () => { try { purgeDeleted(x.kind, x.id); success(x.no + ' deleted forever'); } catch (e) { explain(e); } } },
    ]);
  }

  function purgeAll() {
    Alert.alert('Empty the bin?', list.length + ' item' + (list.length === 1 ? '' : 's') + ' shown here will be deleted forever.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Empty', style: 'destructive', onPress: () => { try { list.forEach((x) => purgeDeleted(x.kind, x.id)); success('Bin emptied'); } catch (e) { explain(e); } } },
    ]);
  }

  const chip = (v: Filter, l: string) => {
    const on = filter === v;
    return (
      <Pressable
        key={v}
        onPress={() => setFilter(v)}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999,
          borderWidth: 1.4, borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accentSoft : colors.surface,
        }}
      >
        <Text style={{ fontFamily: on ? fonts.uiSemi : fonts.ui, fontSize: 14, color: on ? colors.accent : colors.ink }}>{l}</Text>
        <View style={{ minWidth: 20, paddingHorizontal: 5, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? colors.accent : colors.sunk }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 11.5, color: on ? colors.accentInk : colors.faint }}>{count(v)}</Text>
        </View>
      </Pressable>
    );
  };

  const header = (
    <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
      {/* what the bin holds */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, backgroundColor: colors.dangerSoft, marginBottom: 14 }}>
        <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="trash" size={22} color={colors.danger} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink }}>{list.length} deleted</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.soft, marginTop: 2 }}>Worth {money(total)} · restore anything you need</Text>
        </View>
        {list.length ? (
          <Pressable onPress={purgeAll} hitSlop={8} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.surface }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.danger }}>Empty</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {chip('all', 'All')}{chip('sale', 'Sales')}{chip('purchase', 'Purchases')}{chip('payment', 'Payments')}
      </View>
      <Field icon="search" label="Search number, party or who deleted it" value={q} onChangeText={setQ} autoCorrect={false} />
    </View>
  );

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
      data={list}
      keyExtractor={(x) => x.kind + x.id}
      ListHeaderComponent={header}
      ListEmptyComponent={(
        <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32, gap: 10 }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.goodSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={28} color={colors.good} />
          </View>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 16, color: colors.ink }}>{q || filter !== 'all' ? 'Nothing matches' : 'The bin is empty'}</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, color: colors.faint, textAlign: 'center' }}>
            Deleted sales, purchases and payments wait here, so they can be restored.
          </Text>
        </View>
      )}
      renderItem={({ item: x }) => {
        const k = KIND[x.kind];
        const go = open(x);
        return (
          <View style={{ marginHorizontal: 16, marginBottom: 12, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }}>
            <Pressable onPress={go} disabled={!go} style={{ padding: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={k.icon} size={19} color={colors.soft} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15.5, color: colors.ink }}>{x.who}</Text>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
                    {k.label} · {x.no}{x.lines ? ' · ' + x.lines + ' item' + (x.lines === 1 ? '' : 's') : ''}
                  </Text>
                </View>
                <Text style={{ fontFamily: fonts.uiExtra, fontSize: 16, color: colors.faint, textDecorationLine: 'line-through' }}>{money(x.amount)}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}>
                <Icon name="clock" size={13} color={colors.danger} />
                <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.ui, fontSize: 12.5, color: colors.soft }}>
                  Deleted {ago(x.deletedAt)} by {x.by}{x.reason && x.reason !== 'Deleted' ? ' · ' + x.reason : ''}
                </Text>
              </View>
            </Pressable>
            <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.line }}>
              <Pressable
                onPress={() => purge(x)}
                accessibilityLabel={'Delete ' + x.no + ' forever'}
                style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 48, backgroundColor: pressed ? colors.dangerSoft : 'transparent' })}
              >
                <Icon name="trash" size={16} color={colors.danger} />
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.danger }}>Delete forever</Text>
              </Pressable>
              <View style={{ width: 1, backgroundColor: colors.line }} />
              <Pressable
                onPress={() => restore(x)}
                accessibilityLabel={'Restore ' + x.no}
                style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 48, backgroundColor: pressed ? colors.goodSoft : 'transparent' })}
              >
                <Icon name="swap" size={16} color={colors.good} />
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.good }}>Restore</Text>
              </Pressable>
            </View>
          </View>
        );
      }}
    />
  );
}
