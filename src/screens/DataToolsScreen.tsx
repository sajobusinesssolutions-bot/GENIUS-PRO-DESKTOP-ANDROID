/**
 * DATA TOOLS — device backups first, then import/export and the financial year.
 *
 * Backups are encrypted .sa files (see data/backupCrypto) kept in the app's own
 * storage, on a schedule or by hand, and each can be shared off the phone or
 * restored. The old plain-JSON scheduled backup, which left the whole book
 * readable in the documents folder, is removed the first time this opens.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Alert, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useAuthSafe } from '../data/AuthContext';
import { refreshSession } from '../data/authApi';
import { driveStatus, driveLinkUrl, unlinkDrive, uploadDriveBackup, DriveStatus } from '../data/syncClient';
import { returnUrl } from './GoogleSignInScreen';
import { Pressable } from '../components/Press';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Button } from '../components/ui';
import { Icon } from '../components/icons';
import { useToast } from '../components/Toast';
import { ToolCard, ChoiceChips } from '../components/ToolCard';
import { fmtDate } from '../data/helpers';
import { BACKUP_MIME } from '../data/backupCrypto';
import { pickReadableFile } from '../data/pickFile';
import {
  BackupSchedule, DeviceBackup, backupFolderPath, deleteBackup, listBackups, readBackup, writeBackup,
  chooseBackupFolder, chosenFolderText, forgetBackupFolder, loadChosenFolder, backupBase64,
} from '../data/deviceBackup';

const SCHEDULES: { v: BackupSchedule; l: string }[] = [
  { v: 'off', l: 'Manual' }, { v: 'daily', l: 'Daily' }, { v: 'weekly', l: 'Weekly' }, { v: 'monthly', l: 'Monthly' },
];

export function sizeText(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

export default function DataToolsScreen({ navigation }: { navigation?: any } = {}) {
  const { colors } = useTheme();
  const { db, startFinancialYear, restoreBackup, addProduct, setSetting } = useAppData();
  const { success, error } = useToast();
  const [backups, setBackups] = useState<DeviceBackup[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(() => setBackups(listBackups()), []);
  const account = useAuthSafe()?.account;
  const [folder, setFolder] = useState<string | null>(chosenFolderText());
  const [drive, setDrive] = useState<DriveStatus | null>(null);

  /** A short-lived session token for the account, for the Drive calls. */
  const token = useCallback(async () => {
    if (!account?.refresh || account.localOnly) return null;
    const r = await refreshSession(account.refresh);
    return r.ok ? r.value.access : null;
  }, [account?.refresh, account?.localOnly]);

  const loadDrive = useCallback(async () => {
    const t = await token();
    if (!t) { setDrive(null); return; }
    const r = await driveStatus(t);
    setDrive(r.ok ? r.value : null);
  }, [token]);

  useEffect(() => {
    void loadChosenFolder().then(() => setFolder(chosenFolderText()));
    void loadDrive();
  }, [loadDrive]);

  async function pickFolder() {
    try {
      const uri = await chooseBackupFolder();
      setFolder(chosenFolderText());
      if (uri) success('Backups will also be saved to ' + (chosenFolderText() || 'Downloads'));
    } catch (e: any) {
      error(e?.message || 'That folder could not be used. Choose Downloads.');
    }
  }

  async function connectDrive() {
    const t = await token();
    if (!t) { error('Sign in to your Genius Pro account first.'); return; }
    setBusy('drive');
    try {
      const back = returnUrl();
      const r = await driveLinkUrl(t, back);
      if (!r.ok) { error(r.error.message); return; }
      const res = await WebBrowser.openAuthSessionAsync(r.value.url, back);
      if (res.type === 'success' && /drive=linked/.test(res.url)) success('Google Drive connected');
      else if (res.type === 'success') error('Google Drive was not connected. Try again.');
      await loadDrive();
    } finally {
      setBusy(null);
    }
  }

  function disconnectDrive() {
    Alert.alert('Disconnect Google Drive?', 'Backups already in Drive stay there. New ones will not go up until you connect again.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Disconnect', style: 'destructive', onPress: async () => {
          const t = await token();
          if (t) await unlinkDrive(t);
          await loadDrive();
        },
      },
    ]);
  }

  /** Makes a fresh encrypted backup and sends it to the Drive folder. */
  async function backupToDrive(existing?: DeviceBackup) {
    if (!db) return;
    const t = await token();
    if (!t) { error('Sign in to your Genius Pro account first.'); return; }
    setBusy('driveUp');
    try {
      const b = existing || writeBackup(db, false);
      if (!existing) { setSetting({ lastBackupAt: new Date().toISOString() }); reload(); }
      const r = await uploadDriveBackup(t, b.name, await backupBase64(b.uri));
      if (!r.ok) { error(r.error.message); return; }
      success('Backed up to Google Drive · ' + r.value.folder);
      await loadDrive();
    } catch (e: any) {
      error(e?.message || 'The backup could not be sent to Google Drive.');
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    reload();
    try {
      const legacy = new File(Paths.document, 'genius-pos-scheduled-backup.json');
      if (legacy.exists) legacy.delete();
    } catch { /* nothing to tidy */ }
  }, [reload]);

  if (!db) return null;

  function backupNow() {
    if (!db) return;
    // the first time, offer the Downloads folder, so the backup outlives the app
    if (Platform.OS === 'android' && !folder) {
      Alert.alert(
        'Save backups to Downloads?',
        'Choose Downloads on the next screen and tap "Use this folder". A "Genius Pro Backups" folder is made there, and every backup is saved into it as well as in the app.',
        [
          { text: 'Only in the app', onPress: () => writeNow() },
          { text: 'Choose Downloads', onPress: async () => { await pickFolder(); writeNow(); } },
        ],
      );
      return;
    }
    writeNow();
  }

  function writeNow() {
    if (!db) return;
    setBusy('backup');
    try {
      const b = writeBackup(db, false);
      setSetting({ lastBackupAt: new Date().toISOString() });
      reload();
      success('Encrypted backup saved' + (b.outside ? ' to ' + (chosenFolderText() || 'Downloads') : '') + ' · ' + sizeText(b.size));
    } catch (e: any) {
      error(e?.message || 'The backup could not be saved.');
    } finally {
      setBusy(null);
    }
  }

  async function share(b: DeviceBackup) {
    try {
      if (!(await Sharing.isAvailableAsync())) { error('Sharing is not available on this phone.'); return; }
      await Sharing.shareAsync(b.uri, { mimeType: BACKUP_MIME, dialogTitle: b.name });
    } catch (e: any) {
      error(e?.message || 'The backup could not be shared.');
    }
  }

  function confirmRestore(load: () => Promise<any>, from: string) {
    Alert.alert(
      'Restore this backup?',
      'This replaces the books on this phone with ' + from + '. A backup of the books as they are now is saved first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore', style: 'destructive',
          onPress: async () => {
            if (!db) return;
            setBusy('restore');
            try {
              const next = await load();
              writeBackup(db, false);
              restoreBackup(next);
              reload();
              success('Backup restored');
            } catch (e: any) {
              error(e?.message || 'This backup could not be restored.');
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  }

  function remove(b: DeviceBackup) {
    Alert.alert('Delete this backup?', b.name + ' will be removed from this phone.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { deleteBackup(b.uri); reload(); } },
    ]);
  }

  async function restoreFromFile() {
    const a = await pickReadableFile();
    if (!a) return;
    if (!/\.(sa|json)$/i.test(a.name || '')) { error('Choose a Genius POS backup — a file ending in .sa'); return; }
    confirmRestore(() => readBackup(a.file), a.name);
  }

  async function importItems() {
    if (!db) return;
    const picked = await pickReadableFile(['text/csv', 'text/comma-separated-values', 'text/plain']);
    if (!picked) return;
    try {
      const raw = await picked.file.text();
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
      success(count + ' item' + (count === 1 ? '' : 's') + ' imported');
    } catch (e: any) {
      error(e?.message || 'Choose an item CSV file.');
    }
  }

  async function shareText(name: string, content: string) {
    try {
      const file = new File(Paths.cache, name);
      if (file.exists) file.delete();
      file.create({ overwrite: true, intermediates: true });
      file.write(content);
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this phone.');
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: name });
    } catch (e: any) {
      error(e?.message || 'The file could not be shared.');
    }
  }

  const schedule = (db.settings.backupSchedule || 'off') as BackupSchedule;
  const counts: [string, number][] = [
    ['Items', db.products.length], ['Customers & suppliers', db.parties.length],
    ['Sales', db.sales.length], ['Purchases', db.purchases.length],
  ];

  const row = (icon: any, label: string, onPress: () => void, tone?: string) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13,
        borderTopWidth: 1, borderTopColor: colors.line, opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={18} color={tone || colors.soft} />
      <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 15, color: tone || colors.ink }}>{label}</Text>
      <Icon name="chev" size={16} color={colors.faint} />
    </Pressable>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <ToolCard
        icon="shield" tone="good" title="Device backup" sub="Save an encrypted copy to this phone."
        action={{ icon: 'swap', label: 'Refresh backups', onPress: reload }}
      >
        <Pressable
          onPress={() => Alert.alert(
            'Where backups are kept',
            backupFolderPath() + '\n\nBackups are encrypted .sa files that only Genius POS can open. They stay in the app\'s own storage, which is removed if the app is uninstalled — share one to Drive, email or WhatsApp to keep a copy off this phone.',
          )}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
        >
          <Icon name="box" size={17} color={colors.good} />
          <Text numberOfLines={1} ellipsizeMode="middle" style={{ flex: 1, fontFamily: fonts.mono, fontSize: 12.5, color: colors.faint }}>{backupFolderPath()}</Text>
          <Icon name="alert" size={17} color={colors.faint} />
        </Pressable>

        {Platform.OS === 'android' ? (
          <Pressable
            onPress={folder ? () => Alert.alert('Backup folder', 'Backups are also saved to ' + folder + '.', [
              { text: 'OK', style: 'cancel' },
              { text: 'Choose another', onPress: pickFolder },
              { text: 'Stop saving there', style: 'destructive', onPress: async () => { await forgetBackupFolder(); setFolder(null); } },
            ]) : pickFolder}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}
          >
            <Icon name="down" size={17} color={folder ? colors.good : colors.accent} />
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 13, color: folder ? colors.ink : colors.accent }}>
              {folder ? 'Also saved to ' + folder : 'Save backups to a Downloads folder'}
            </Text>
            <Icon name="chev" size={16} color={colors.faint} />
          </Pressable>
        ) : null}

        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginTop: 16, marginBottom: 10 }}>Auto-backup schedule</Text>
        <ChoiceChips value={schedule} options={SCHEDULES} onChange={(v) => setSetting({ backupSchedule: v })} />

        <View style={{ marginTop: 16 }}>
          <Button variant="pri" label="Backup now" loading={busy === 'backup'} icon={<Icon name="up" size={17} color={colors.accentInk} />} onPress={backupNow} />
        </View>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 8, textAlign: 'center' }}>
          Last backup: {db.settings.lastBackupAt ? fmtDate(db.settings.lastBackupAt) : 'never'}
        </Text>

        <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 14 }} />

        {backups.length ? backups.map((b) => (
          <View key={b.uri} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line }}>
            <Icon name="lock" size={17} color={colors.good} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink }}>{b.name}</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
                {(b.at ? fmtDate(new Date(b.at).toISOString()) : '') + ' · ' + sizeText(b.size) + (b.auto ? ' · scheduled' : '')}
              </Text>
            </View>
            {drive?.linked ? (
              <Pressable hitSlop={8} accessibilityLabel={'Send ' + b.name + ' to Google Drive'} onPress={() => backupToDrive(b)}><Icon name="cloud" size={18} color={colors.accent} /></Pressable>
            ) : null}
            <Pressable hitSlop={8} accessibilityLabel={'Share ' + b.name} onPress={() => share(b)}><Icon name="up" size={18} color={colors.accent} /></Pressable>
            <Pressable hitSlop={8} accessibilityLabel={'Restore ' + b.name} onPress={() => confirmRestore(() => readBackup(b.uri), b.name)}><Icon name="down" size={18} color={colors.good} /></Pressable>
            <Pressable hitSlop={8} accessibilityLabel={'Delete ' + b.name} onPress={() => remove(b)}><Icon name="trash" size={18} color={colors.danger} /></Pressable>
          </View>
        )) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.sunk, borderRadius: 12, padding: 16 }}>
            <Icon name="box" size={20} color={colors.faint} />
            <Text style={{ fontFamily: fonts.ui, fontSize: 15, color: colors.faint }}>No device backups found.</Text>
          </View>
        )}

        <View style={{ marginTop: 14 }}>
          <Button label="Restore from a file" loading={busy === 'restore'} icon={<Icon name="down" size={17} color={colors.ink} />} onPress={restoreFromFile} />
        </View>
      </ToolCard>

      <ToolCard
        icon="cloud" tone="accent" title="Google Drive"
        sub={drive?.linked ? 'Backups go to "Genius Pro Backups" in ' + (drive.email || 'your Drive') : 'Keep encrypted backups in the Google Drive of ' + (account?.email || 'your account')}
      >
        {!account || account.localOnly ? (
          <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint }}>Sign in to a Genius Pro account to back up to Google Drive.</Text>
        ) : drive?.linked ? (
          <>
            <Button variant="pri" label="Back up to Google Drive now" loading={busy === 'driveUp'} icon={<Icon name="cloud" size={17} color={colors.accentInk} />} onPress={() => backupToDrive()} />
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 8, textAlign: 'center' }}>
              Last sent: {drive.lastBackupAt ? fmtDate(drive.lastBackupAt) : 'never'}
            </Text>
            {row('x', 'Disconnect Google Drive', disconnectDrive, colors.danger)}
          </>
        ) : (
          <>
            <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, marginBottom: 12 }}>
              Google asks once to let Genius Pro add files to your Drive. It can only see the backups it puts there.
            </Text>
            <Button variant="pri" label="Connect Google Drive" loading={busy === 'drive'} icon={<Icon name="cloud" size={17} color={colors.accentInk} />} onPress={connectDrive} />
          </>
        )}
      </ToolCard>

      <ToolCard icon="swap" tone="accent" title="Import and export" sub="Items in and out as spreadsheet files.">
        {row('swap', 'Move from Vyapar (.vyb backup)', () => navigation?.navigate('VyaparImport'))}
        {row('down', 'Import items from a CSV file', importItems)}
        {row('doc', 'Download the item import template', () => shareText(
          'genius-pos-item-import-template.csv',
          'name,sku,kind,category,unit,cost,price,taxRate,reorder,barcodes,secondaryUnit,conversionRate,secondaryPrice,trackBatches,rateType,duration\nExample item,ITEM-001,product,General,PC,0,0,18,0,,,,false,,\nExample service,SVC-001,service,Services,HR,0,0,18,0,,,,false,fixed,',
        ))}
        {row('tag', 'Download the price list', () => shareText(
          'genius-pos-price-list.csv',
          ['name,sku,kind,category,unit,cost,price', ...db.products.filter((p) => p.active).map((p) => [p.name, p.sku, p.kind || 'product', p.category, p.unit, p.cost, p.price].map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(','))].join('\n'),
        ))}
      </ToolCard>

      <ToolCard icon="calendar" tone="warn" title="Financial year" sub={db.financialYear?.start ? 'Current year began ' + db.financialYear.start.slice(0, 10) : 'No year started yet'}>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginBottom: 4 }}>
          {(db.archivedFinancialYears?.length || 0) + ' year' + ((db.archivedFinancialYears?.length || 0) === 1 ? '' : 's') + ' archived · '}
          {counts.map(([l, n]) => n + ' ' + l.toLowerCase()).join(' · ')}
        </Text>
        {row('calendar', 'Start a new financial year', () => Alert.alert(
          'Start a new financial year?',
          'Current sales, purchases, payments and journals will be closed into opening balances. Products, stock, customers, suppliers, users and settings stay. Take a backup first.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Start year', onPress: () => {
                try {
                  const out = startFinancialYear(new Date());
                  Alert.alert('New financial year started', out.openingLines + ' ledger balance(s) and ' + (out.customersCarried + out.suppliersCarried) + ' party balance(s) carried forward.');
                } catch (e: any) {
                  Alert.alert('Cannot start the new year', e?.message || 'Send waiting sync changes first.');
                }
              },
            },
          ],
        ), colors.warn)}
      </ToolCard>
    </ScrollView>
  );
}
