/**
 * The "Business" and "People" menu destinations plus Notifications:
 * Settings, Printing, Data tools, Loyalty, Instalments, Notifications.
 * Reference MENU_GROUPS 'admin' (lines 6558-6563) and SCREENS.notifications (2797).
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Switch, Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useSyncRun } from '../data/useSyncRun';
import { Card, Cap, KV, KVNode, Button, Chip, EmptyState, IconTile } from '../components/ui';
import { useGo } from '../nav/navigate';
import { ageOfDays, plural, fmtDate } from '../data/helpers';
import { validateBackup } from '../data/storage';

function Input({ value, onChangeText, keyboardType }: any) {
  const { colors } = useTheme();
  return (
    <TextInput
      value={value} onChangeText={onChangeText} keyboardType={keyboardType}
      style={{
        backgroundColor: colors.sunk, borderRadius: 10, height: 40, paddingHorizontal: 12,
        fontFamily: fonts.ui, fontSize: 14, color: colors.ink, minWidth: 110, textAlign: 'right',
      }}
    />
  );
}

/** Settings moved to its own file when it was rebuilt from SCREENS.settings (6712). */
export { default as SettingsScreen } from './SettingsScreen';

export function DataToolsScreen() {
  const { colors } = useTheme();
  const { db, startFinancialYear, restoreBackup, addProduct, setSetting } = useAppData();
  const { run } = useSyncRun();
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!db) return;
    const schedule = db.settings.backupSchedule || 'off';
    if (schedule === 'off') return;
    const interval = schedule === 'daily' ? 86400000 : 604800000;
    if (db.settings.lastBackupAt && Date.now() - new Date(db.settings.lastBackupAt).getTime() < interval) return;
    try {
      const file = new File(Paths.document, 'genius-pos-scheduled-backup.json');
      if (file.exists) file.delete();
      file.create({ overwrite: true, intermediates: true });
      file.write(JSON.stringify(db));
      setSetting({ lastBackupAt: new Date().toISOString() });
    } catch {
      // A scheduled backup must never block the data tools screen.
    }
  }, [db]);
  if (!db) return null;

  const counts: [string, number][] = [
    ['Products', db.products.length],
    ['Customers & suppliers', db.parties.length],
    ['Sales', db.sales.length],
    ['Purchases', db.purchases.length],
    ['Journal entries', db.journal.length],
    ['Waiting to sync', db.queue.length],
  ];

  const shareFile = async (name: string, content: string, mimeType: string) => {
    try {
      const file = new File(Paths.cache, name);
      if (file.exists) file.delete();
      file.create({ overwrite: true, intermediates: true });
      file.write(content);
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this phone.');
      await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
      return true;
    } catch (e: any) {
      Alert.alert('Could not share', e?.message || 'The file could not be shared.');
      return false;
    }
  };

  const backup = async () => {
    try {
      const raw = JSON.stringify(db);
      const checked = validateBackup(raw);
      if (!checked.ok) { Alert.alert('Backup failed', checked.reason); return; }
      await shareFile('genius-pos-backup.json', raw, 'application/json');
      setSetting({ lastBackupAt: new Date().toISOString() });
      Alert.alert('Backup verified', 'This backup passed a local integrity check before sharing.');
    } catch {
      Alert.alert('Backup', 'Could not open the share sheet on this device.');
    }
  };

  const importFile = async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/csv', 'text/plain'], copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets?.[0]?.uri) return;
    try {
      const raw = await (await fetch(picked.assets[0].uri)).text();
      if (picked.assets[0].name.toLowerCase().endsWith('.json')) {
        const checked = validateBackup(raw);
        if (!checked.ok || !checked.db) throw new Error(checked.reason || 'Invalid backup.');
        Alert.alert('Restore this backup?', 'This replaces the books currently on this phone.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Restore', style: 'destructive', onPress: () => { restoreBackup(checked.db!); Alert.alert('Restored', 'Your backup is now open on this phone.'); } },
        ]);
        return;
      }
      const rows = raw.split(/\r?\n/).map((line) => line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''))).filter((r) => r.some(Boolean));
      const head = rows.shift()?.map((x) => x.toLowerCase()) || [];
      const at = (r: string[], key: string) => r[head.indexOf(key)] || '';
      let count = 0;
      rows.forEach((r) => {
        const name = at(r, 'name');
        if (!name) return;
        const kind = at(r, 'kind') === 'service' ? 'service' : 'product';
        addProduct({
          name, sku: at(r, 'sku') || name.slice(0, 8).toUpperCase(), kind,
          category: at(r, 'category') || 'General', unit: at(r, 'unit') || (kind === 'service' ? 'HR' : 'PC'),
          cost: Number(at(r, 'cost')) || 0, price: Number(at(r, 'price')) || 0,
          taxRate: Number(at(r, 'taxrate')) || db.settings.taxRate, stock: {}, reorder: Number(at(r, 'reorder')) || 0,
          warrantyMonths: 0, active: true, trackInventory: kind !== 'service', batches: [],
          barcodes: at(r, 'barcodes') ? at(r, 'barcodes').split('|') : [],
          secondaryUnit: at(r, 'secondaryunit') || undefined,
          conversionRate: Number(at(r, 'conversionrate')) || undefined,
          secondaryPrice: Number(at(r, 'secondaryprice')) || undefined,
          trackBatches: at(r, 'trackbatches').toLowerCase() === 'true',
          rateType: (['fixed', 'hour', 'day', 'unit'].includes(at(r, 'ratetype')) ? at(r, 'ratetype') : 'fixed') as any,
          duration: at(r, 'duration') || undefined,
        });
        count++;
      });
      Alert.alert('Items imported', count + ' item(s) added.');
    } catch (e: any) {
      Alert.alert('Import failed', e?.message || 'Choose a Genius POS backup or item CSV file.');
    }
  };

  const itemTemplate = () => shareFile(
    'genius-pos-item-import-template.csv',
    'name,sku,kind,category,unit,cost,price,taxRate,reorder,barcodes,secondaryUnit,conversionRate,secondaryPrice,trackBatches,rateType,duration\nExample item,ITEM-001,product,General,PC,0,0,18,0,,,,false,,\nExample service,SVC-001,service,Services,HR,0,0,18,0,,,,false,fixed,',
    'text/csv',
  );

  const priceList = () => shareFile(
    'genius-pos-price-list.csv',
    ['name,sku,kind,category,unit,cost,price', ...db.products.filter((p) => p.active).map((p) => [p.name, p.sku, p.kind || 'product', p.category, p.unit, p.cost, p.price].map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(','))].join('\n'),
    'text/csv',
  );

  const sendWaiting = async () => {
    setSyncing(true);
    try {
      const r = await run('manual');
      Alert.alert('Sync', r.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, gap: 14 }}>
      <View>
        <Cap style={{ marginBottom: 8 }}>What is in this book</Cap>
        <Card style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
          {counts.map(([l, n], i) => <KV key={l} label={l} value={String(n)} last={i === counts.length - 1} />)}
        </Card>
      </View>
      <Button variant="pri" label="Back up now" onPress={backup} />
      <Card style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
        <KV label="Last backup" value={db.settings.lastBackupAt ? new Date(db.settings.lastBackupAt).toLocaleString() : 'Never'} />
        <KV label="Scheduled backup" value={db.settings.backupSchedule || 'off'} last />
      </Card>
      <Button label="Import items or restore backup" onPress={importFile} />
      <Button label="Download item import template" onPress={itemTemplate} />
      <Button label="Download price list" onPress={priceList} />
      <Card style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
        <KV label="Backup schedule" value={db.settings.backupSchedule || 'off'} />
        <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 10 }}>
          {(['off', 'daily', 'weekly'] as const).map((v) => (
            <Button key={v} size="sm" label={v[0].toUpperCase() + v.slice(1)} variant={db.settings.backupSchedule === v ? 'pri' : 'default'} onPress={() => setSetting({ backupSchedule: v })} />
          ))}
        </View>
        <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint }}>The app creates the next scheduled backup when it is opened. For off-device protection, share it to Drive or email.</Text>
      </Card>
      <Card style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
        <KV label="Archived financial years" value={String(db.archivedFinancialYears?.length || 0)} />
        <KV label="Current year" value={db.financialYear?.start ? db.financialYear.start.slice(0, 10) : 'Not started'} last />
      </Card>
      <Button label="Send anything waiting" onPress={sendWaiting} loading={syncing} />
      <Button
        label="Start a new financial year"
        onPress={() => Alert.alert(
          'Start a new financial year?',
          'Current sales, purchases, payments and journals will be closed into opening balances. Products, stock, customers, suppliers, users and settings stay. Take a backup first.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Start year', onPress: () => {
              try {
                const out = startFinancialYear(new Date());
                Alert.alert('New financial year started', out.openingLines + ' ledger balance(s) and ' + (out.customersCarried + out.suppliersCarried) + ' party balance(s) carried forward.');
              } catch (e: any) {
                Alert.alert('Cannot start the new year', e?.message || 'Send waiting sync changes first.');
              }
            } },
          ],
        )}
      />
    </ScrollView>
  );
}

export function LoyaltyScreen() {
  const { colors } = useTheme();
  const { db, setLoyalty, money } = useAppData();
  if (!db) return null;
  const r = db.loyaltyRules;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Card style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
        <KVNode label="Loyalty points"><Switch value={r.enabled} onValueChange={(v) => setLoyalty({ enabled: v })} /></KVNode>
        <KVNode label="Spend per point"><Input value={String(r.earnPer)} keyboardType="numeric" onChangeText={(v: string) => setLoyalty({ earnPer: Number(v) || 0 })} /></KVNode>
        <KVNode label="A point is worth"><Input value={String(r.pointValue)} keyboardType="numeric" onChangeText={(v: string) => setLoyalty({ pointValue: Number(v) || 0 })} /></KVNode>
        <KVNode label="Least points to redeem" last><Input value={String(r.redeemMin)} keyboardType="numeric" onChangeText={(v: string) => setLoyalty({ redeemMin: Number(v) || 0 })} /></KVNode>
      </Card>
      <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, lineHeight: 16 }}>
        A customer earns one point for every {money(r.earnPer)} spent, and can redeem from {r.redeemMin} points at {money(r.pointValue)} each.
      </Text>
      <View>
        <Cap style={{ marginBottom: 8 }}>Who has points</Cap>
        <Card>
          {db.parties.filter((p) => p.points > 0).length ? db.parties.filter((p) => p.points > 0).map((p, i, arr) => (
            <View key={p.id} style={{
              flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 16,
              borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderBottomColor: colors.line,
            }}>
              <IconTile icon="gift" bg={colors.sunk} color={colors.rail} />
              <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{p.name}</Text>
              <Text style={{ fontFamily: fonts.monoSemi, fontSize: 13.5, color: colors.ink }}>{p.points}</Text>
            </View>
          )) : <EmptyState icon="gift" title="Nobody yet" subtitle="Points start collecting on the next sale to a named customer." />}
        </Card>
      </View>
    </ScrollView>
  );
}

/** SCREENS.notifications — what alertCount() counts, listed out. */
export function NotificationsScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const { db, stockOf, dueRecurring } = useAppData();
  if (!db) return null;

  // each list is shown only if its alert is switched on in Settings
  const st = db.settings;
  const low = st.lowStockAlerts === false || st.notifyLowStock === false
    ? [] : db.products.filter((p) => p.active && p.kind !== 'service' && stockOf(p) <= p.reorder);
  const overdue = st.notifyOverdue === false
    ? [] : db.sales.filter((s) => s.due > 0 && s.status !== 'void' && ageOfDays(s.ts) > 30);
  const claims = db.claims.filter((c) => c.status === 'open');
  const due = dueRecurring();

  const rows: { t: string; s: string; route: string; tone: string }[] = [];
  if (low.length) rows.push({ t: plural(low.length, 'item') + ' to restock', s: 'At or below the reorder level', route: 'ItemsTab', tone: colors.warn });
  if (overdue.length) rows.push({ t: plural(overdue.length, 'bill') + ' overdue', s: 'Unpaid for more than 30 days', route: 'Sales', tone: colors.danger });
  if (claims.length) rows.push({ t: plural(claims.length, 'warranty claim') + ' open', s: 'Waiting on a decision', route: 'Warranties', tone: colors.warn });
  if (due.length) rows.push({ t: plural(due.length, 'recurring bill') + ' due', s: 'Ready to be raised', route: 'Recurring', tone: colors.accent });

  if (!rows.length) return <EmptyState icon="check" title="Nothing needs you" subtitle="Stock, bills and claims are all in order." />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <Card>
        {rows.map((r, i) => (
          <View key={r.t} style={{
            flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 16,
            borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: colors.line,
          }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: r.tone, marginHorizontal: 4 }} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{r.t}</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 1 }}>{r.s}</Text>
            </View>
            <Button size="sm" label="Open" onPress={() => go(r.route)} />
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}
