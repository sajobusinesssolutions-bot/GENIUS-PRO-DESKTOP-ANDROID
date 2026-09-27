/**
 * PRINTING — three screens.
 *
 *  - The hub: Receipt settings and Invoice PDF settings, then the printer this
 *    phone uses — Bluetooth or Network — with a test page.
 *  - Receipt settings: what a till receipt shows, edited against a live preview.
 *  - Invoice PDF settings: what a shared or A4 invoice shows, likewise.
 *
 * Every control here changes the printout: receipt fields land on the receipt
 * template (templateFor('receipt')), invoice fields on the invoice template,
 * and shop details (logo, phones, address) on the firm, which both share.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert, Image, Linking, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { canFor } from '../data/perms';
import { Button, EmptyState } from '../components/ui';
import { Badge, InfoBanner } from '../components/kit';
import { Field, ToggleRow, SelectField } from '../components/form';
import { Icon, IconName } from '../components/icons';
import { useToast } from '../components/Toast';
import { useGo } from '../nav/navigate';
import { printDoc, DocMeta } from '../data/docPrint';
import { printOptsFor, paperOf, defaultPrinter } from '../data/printSetup';
import { keepPhoto, dropPhoto } from '../data/photos';
import { kindLabel, CODE_DATA, POWERED_BY } from '../data/defaults';
import type { Printer, CodeKind, CodeData } from '../data/types';

const ACCENT_COLORS = ['#1A7AE6', '#1DA362', '#D97706', '#DC2626', '#7C3AED', '#111827'];
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function validHost(host: string): boolean {
  const h = host.trim();
  const m = h.match(IPV4);
  if (m) return m.slice(1).every((x) => Number(x) <= 255);
  return /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/.test(h) && /[A-Za-z]/.test(h);
}

/* ---------------- shared pieces ---------------- */

function Section({ icon, title, hint, children }: { icon: IconName; title: string; hint?: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{
      backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line,
      padding: 16, marginBottom: 14,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={icon} size={16} color={colors.accent} />
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.soft }}>{title}</Text>
      </View>
      {hint ? <Text style={{ fontFamily: fonts.ui, fontSize: 12, lineHeight: 17, color: colors.faint, marginTop: 5 }}>{hint}</Text> : null}
      <View style={{ marginTop: 12 }}>{children}</View>
    </View>
  );
}

function Guard({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const { db } = useAppData();
  if (!db) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (!canFor(db.session.role, 'settings')) {
    return <EmptyState icon="print" title="Not available" subtitle="Your role does not include settings." />;
  }
  return <>{children}</>;
}

function LogoSlot({ uri, onChange, hint }: { uri?: string; onChange: (uri?: string) => void; hint: string }) {
  const { colors } = useTheme();
  const { error } = useToast();
  async function pick() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { error('Allow photo access to choose a logo.'); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsEditing: true });
    if (!r.canceled && r.assets?.[0]?.uri) onChange(r.assets[0].uri);
  }
  return (
    <Section icon="image" title="Store logo" hint={hint}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{
          width: 86, height: 64, borderRadius: radius.md, backgroundColor: colors.sunk,
          borderWidth: 1, borderColor: colors.lineHard, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}>
          {uri
            ? <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
            : <Icon name="image" size={24} color={colors.faint} />}
        </View>
        <View style={{ flex: 1, gap: 8 }}>
          <Button size="sm" label={uri ? 'Change logo' : 'Pick from gallery'} icon={<Icon name="image" size={15} color={colors.ink} />} onPress={pick} />
          {uri ? <Button size="sm" variant="dngr" label="Remove" onPress={() => onChange(undefined)} /> : null}
        </View>
      </View>
    </Section>
  );
}

function SaveBar({ onSave }: { onSave: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginTop: 4 }}>
      <Button variant="pri" label="Save settings" icon={<Icon name="check" size={17} color={colors.accentInk} />} onPress={onSave} />
    </View>
  );
}

const CODE_CHOICES: { v: CodeKind; l: string }[] = [
  { v: 'none', l: 'Nothing' }, { v: 'qr', l: 'QR code' }, { v: 'barcode', l: 'Barcode' }, { v: 'both', l: 'QR and barcode' },
];
const CODE_DATA_CHOICES = CODE_DATA.map(([v, l]) => ({ v, l }));

function sampleLines() {
  return [
    { name: 'Product A', qty: 2, price: 5000, batch: 'B-102', expiry: 'Mar 2027' },
    { name: 'Product B', qty: 1, price: 10000, batch: 'B-311', expiry: 'Jan 2027' },
  ];
}

/** A tiny QR / barcode stand-in for the previews. */
function CodeMock({ code, caption }: { code: CodeKind; caption?: string }) {
  if (code === 'none') return null;
  const qr = (
    <View style={{ width: 54, height: 54, borderWidth: 1, borderColor: '#999', padding: 5, flexDirection: 'row', flexWrap: 'wrap' }}>
      {Array.from({ length: 36 }).map((_, i) => (
        <View key={i} style={{ width: '16.66%', height: 7, backgroundColor: [0, 1, 5, 6, 8, 13, 15, 20, 22, 27, 29, 30, 34, 35].includes(i) ? '#111' : '#fff' }} />
      ))}
    </View>
  );
  const bars = (
    <View style={{ flexDirection: 'row', gap: 1.2, height: 30, alignItems: 'flex-end' }}>
      {Array.from({ length: 30 }).map((_, i) => (
        <View key={i} style={{ width: i % 3 === 0 ? 2.2 : 1, height: '100%', backgroundColor: '#111' }} />
      ))}
    </View>
  );
  return (
    <View style={{ alignItems: 'center', marginTop: 10, gap: 4 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        {code === 'qr' || code === 'both' ? qr : null}
        {code === 'barcode' || code === 'both' ? bars : null}
      </View>
      {caption ? <Text style={{ fontFamily: fonts.mono, fontSize: 8.5, color: '#666' }}>{caption}</Text> : null}
    </View>
  );
}

/* ---------------- the hub ---------------- */

function NavCard({ icon, title, sub, onPress }: { icon: IconName; title: string; sub: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 16,
        backgroundColor: pressed ? colors.sunk : colors.surface, borderWidth: 1, borderColor: colors.line, marginBottom: 10,
      })}
    >
      <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={20} color={colors.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 15.5, color: colors.ink }}>{title}</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>{sub}</Text>
      </View>
      <Icon name="chev" size={18} color={colors.faint} />
    </Pressable>
  );
}

export default function PrintingScreen() {
  const { colors } = useTheme();
  const { db, money, addPrinter, updatePrinter, makeDefaultPrinter, removePrinter } = useAppData();
  const { success, error } = useToast();
  const go = useGo();
  const dp = defaultPrinter(db);
  const wifi = db?.printers.find((p) => p.kind === 'wifi' && p.dflt) || db?.printers.find((p) => p.kind === 'wifi');
  const [mode, setMode] = useState<'bluetooth' | 'network'>(dp?.kind === 'bluetooth' ? 'bluetooth' : 'network');
  const [host, setHost] = useState(wifi?.address || '');
  const [port, setPort] = useState(String(wifi?.port || 9100));
  const [btName, setBtName] = useState('');
  const [busy, setBusy] = useState(false);

  if (!db) return <Guard>{null}</Guard>;

  async function testPage(p: Printer) {
    if (!db) return;
    const doc: DocMeta = {
      kind: 'Test Print', no: 'TEST-0001', ts: new Date().toISOString(),
      firmName: db.firm.name, firmAddress: db.firm.address, firmPhone: db.firm.phone,
      lines: [{ name: 'Sample item', qty: 2, price: 5000, unit: 'pc' }],
      subtotal: 10000, total: 10000,
      footer: 'This confirms ' + p.name + ' (' + kindLabel(p.kind) + ', ' + paperOf(p) + ') is set up correctly.',
    };
    setBusy(true);
    try {
      await printDoc(doc, money, printOptsFor(db, 'receipt', p));
    } catch (e: any) {
      error(e?.message || 'The test page could not be sent to ' + p.name + '.');
    } finally {
      setBusy(false);
    }
  }

  async function connectNetwork() {
    if (!db) return;
    const h = host.trim();
    const n = Number(port);
    if (!validHost(h)) { error('Enter the printer\'s IP address, such as 192.168.1.50.'); return; }
    if (!Number.isInteger(n) || n < 1 || n > 65535) { error('The port must be a number from 1 to 65535.'); return; }
    const same = db.printers.find((p) => p.kind === 'wifi' && p.address === h);
    let p: Printer;
    if (same) {
      updatePrinter(same.id, { port: n, online: true });
      p = { ...same, port: n, online: true };
    } else {
      p = addPrinter({
        name: 'Network printer ' + h, kind: 'wifi', width: db.printer.width === 'A4' ? '80mm' : db.printer.width,
        address: h, port: n, dflt: true, online: true, note: '',
      });
    }
    makeDefaultPrinter(p.id);
    success(p.name + ' is now the printer for this phone');
    await testPage(p);
  }

  function addBluetooth() {
    if (!db) return;
    const name = btName.trim();
    if (!name) { error('Type the printer\'s name as it appears in Bluetooth settings.'); return; }
    const p = addPrinter({
      name, kind: 'bluetooth', width: db.printer.width === 'A4' ? '80mm' : db.printer.width,
      address: '', port: 0, dflt: true, online: true, note: '',
    });
    makeDefaultPrinter(p.id);
    setBtName('');
    success(name + ' added and set as this phone\'s printer');
  }

  function openBluetoothSettings() {
    const open = Platform.OS === 'android'
      ? Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS')
      : Linking.openSettings();
    Promise.resolve(open).catch(() => error('Open Bluetooth from the phone\'s own settings.'));
  }

  const saved = db.printers.filter((p) => (mode === 'bluetooth' ? p.kind === 'bluetooth' : p.kind === 'wifi'));
  const seg = (v: 'bluetooth' | 'network', label: string, icon: IconName) => {
    const on = mode === v;
    return (
      <Pressable
        onPress={() => setMode(v)}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        style={{
          flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48,
          backgroundColor: on ? colors.good : 'transparent',
        }}
      >
        <Icon name={on ? 'check' : icon} size={17} color={on ? '#fff' : colors.ink} />
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: on ? '#fff' : colors.ink }}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <Guard>
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <NavCard icon="receipt" title="Receipt settings" sub="Paper size, header, footer, what prints" onPress={() => go('PrintingReceipt')} />
        <NavCard icon="doc" title="Invoice PDF settings" sub="Tagline, accent colour, footer, contact info" onPress={() => go('PrintingInvoice')} />

        <View style={{
          flexDirection: 'row', borderRadius: 999, borderWidth: 1.4, borderColor: colors.lineHard,
          overflow: 'hidden', marginTop: 12, marginBottom: 14,
        }}>
          {seg('bluetooth', 'Bluetooth', 'bluetooth')}
          <View style={{ width: 1.4, backgroundColor: colors.lineHard }} />
          {seg('network', 'Network', 'wifi')}
        </View>

        <InfoBanner
          tone="accent"
          icon="alert"
          text={mode === 'network'
            ? 'Connect to a Wi-Fi/LAN printer on the same network as this phone. Typical port: 9100. The page goes out through the phone\'s print service, so the printer must also appear in the print dialog.'
            : 'Pair the printer in the phone\'s Bluetooth settings first, then add it here by name. Pages go out through the phone\'s print dialog, where the paired printer is chosen.'}
        />

        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 16,
          backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, marginTop: 14,
        }}>
          <Icon name="print" size={22} color={dp ? colors.good : colors.faint} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>Connected printer</Text>
            <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, marginTop: 2 }}>
              {dp ? dp.name + ' · ' + kindLabel(dp.kind) + ' · ' + paperOf(dp) : 'None'}
            </Text>
          </View>
          {dp ? <Button size="sm" label="Test print" loading={busy} onPress={() => testPage(dp)} /> : null}
        </View>

        <View style={{ marginTop: 14 }}>
          {mode === 'network' ? (
            <>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Field icon="wifi" placeholder="Printer IP address" value={host} onChangeText={setHost} autoCapitalize="none" />
                </View>
                <View style={{ width: 104 }}>
                  <Field label="Port" value={port} onChangeText={setPort} numeric />
                </View>
              </View>
              <Button variant="pri" label="Connect / Test" loading={busy} icon={<Icon name="wifi" size={17} color={colors.accentInk} />} onPress={connectNetwork} />
            </>
          ) : (
            <>
              <Button label="Open Bluetooth settings to pair" icon={<Icon name="bluetooth" size={17} color={colors.ink} />} onPress={openBluetoothSettings} />
              <View style={{ height: 12 }} />
              <Field icon="bluetooth" placeholder="Paired printer's name" value={btName} onChangeText={setBtName} />
              <Button variant="pri" label="Add Bluetooth printer" icon={<Icon name="plus" size={17} color={colors.accentInk} />} onPress={addBluetooth} />
            </>
          )}
        </View>

        <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.faint, marginTop: 22, marginBottom: 8 }}>
          Saved {mode === 'network' ? 'network' : 'Bluetooth'} printers
        </Text>
        {saved.length ? saved.map((p) => (
          <View key={p.id} style={{
            flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14,
            backgroundColor: colors.surface, borderWidth: 1, borderColor: p.dflt ? colors.good : colors.line, marginBottom: 8,
          }}>
            <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => { makeDefaultPrinter(p.id); success(p.name + ' is now the printer for this phone'); }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>{p.name}</Text>
                {p.dflt ? <Badge label="In use" tone="good" /> : null}
              </View>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 2 }}>
                {paperOf(p)}{p.address ? ' · ' + p.address + (p.port ? ':' + p.port : '') : ''}{p.dflt ? '' : ' · tap to use'}
              </Text>
            </Pressable>
            {db.printers.length > 1 ? (
              <Pressable
                hitSlop={8}
                accessibilityLabel={'Remove ' + p.name}
                onPress={() => Alert.alert('Remove ' + p.name + '?', 'It will no longer be offered for printing.', [
                  { text: 'Keep it', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: () => removePrinter(p.id) },
                ])}
              >
                <Icon name="trash" size={18} color={colors.danger} />
              </Pressable>
            ) : null}
          </View>
        )) : (
          <View style={{ alignItems: 'center', paddingVertical: 24, gap: 6 }}>
            <Icon name={mode === 'network' ? 'wifi' : 'bluetooth'} size={34} color={colors.lineHard} />
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.faint }}>No {mode === 'network' ? 'network' : 'Bluetooth'} printers yet</Text>
          </View>
        )}
      </ScrollView>
    </Guard>
  );
}

/* ---------------- receipt settings ---------------- */

function ReceiptPreview({ d }: { d: ReceiptDraft }) {
  const { db, money } = useAppData();
  if (!db) return null;
  const narrow = d.paper === '58mm';
  const size = narrow ? 9.5 : 11;
  const lines = sampleLines();
  const sub = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const tax = Math.round(sub * (db.settings.taxRate || 0) / 100);
  const t = (s: string, extra?: object) => <Text style={[{ fontFamily: fonts.mono, fontSize: size, color: '#333' }, extra]}>{s}</Text>;
  const rule = <View style={{ borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#555', marginVertical: 6 }} />;
  const kv = (k: string, v: string) => (
    <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>{t(k)}{t(v)}</View>
  );
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 8, padding: 14, width: narrow ? 220 : 290, alignSelf: 'center' }}>
      {d.showLogo && d.logo ? <Image source={{ uri: d.logo }} style={{ height: 34, marginBottom: 4 }} resizeMode="contain" /> : null}
      <Text style={{ textAlign: 'center', fontFamily: fonts.uiBold, fontSize: size + 3, color: '#111' }}>{db.firm.name}</Text>
      {[d.head1, d.head2, d.address, d.phone, d.whatsapp ? 'WhatsApp ' + d.whatsapp : ''].filter(Boolean).map((x, i) => (
        <Text key={i} style={{ textAlign: 'center', fontFamily: fonts.mono, fontSize: size - 1, color: '#444' }}>{x}</Text>
      ))}
      <Text style={{ textAlign: 'center', fontFamily: fonts.uiBold, fontSize: size, color: '#111', marginTop: 6, letterSpacing: 1 }}>RECEIPT</Text>
      {rule}
      {kv('Number', 'INV-001')}
      {kv('Date', new Date().toLocaleDateString('en-GB'))}
      {d.showParty ? kv('Customer', 'Walk-in customer') : null}
      {kv('Paid by', 'Cash')}
      {d.showServed ? kv('Served by', 'Cashier') : null}
      {rule}
      {lines.map((l) => (
        <View key={l.name} style={{ marginBottom: 3 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>{t(l.name)}{t(money(l.qty * l.price))}</View>
          {t(l.qty + ' × ' + money(l.price), { fontSize: size - 1.5, color: '#666' })}
          {d.showBatch || d.showExpiry
            ? t([d.showBatch ? 'Batch ' + l.batch : '', d.showExpiry ? 'Exp ' + l.expiry : ''].filter(Boolean).join(' · '), { fontSize: size - 1.5, color: '#666' })
            : null}
        </View>
      ))}
      {rule}
      {kv('Subtotal', money(sub))}
      {d.showTax && tax ? kv(d.taxName || 'Tax', money(tax)) : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: size + 1.5, color: '#111' }}>TOTAL</Text>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: size + 1.5, color: '#111' }}>{money(sub + tax)}</Text>
      </View>
      <CodeMock code={d.code} caption={d.code !== 'none' ? 'INV-001' : undefined} />
      <Text style={{ textAlign: 'center', fontFamily: fonts.mono, fontSize: size - 0.5, color: '#333', marginTop: 8 }}>
        {d.foot || db.firm.footer || 'Thank you for your business'}
      </Text>
      <Text style={{ textAlign: 'center', fontFamily: fonts.ui, fontSize: 8.5, color: '#999', marginTop: 4 }}>{POWERED_BY}</Text>
    </View>
  );
}

interface ReceiptDraft {
  logo?: string; showLogo: boolean; paper: '58mm' | '80mm';
  head1: string; head2: string; phone: string; whatsapp: string; address: string;
  foot: string; taxName: string;
  showTax: boolean; showParty: boolean; showServed: boolean; showBatch: boolean; showExpiry: boolean; tight: boolean;
  code: CodeKind; codeData: CodeData; autoPrint: boolean; copies: number;
}

export function ReceiptSettingsScreen() {
  const { colors } = useTheme();
  const nav = useNavigation<any>();
  const { db, templateFor, updateTemplate, updateFirm, setSetting, setPrinter, updatePrinter } = useAppData();
  const { success } = useToast();
  const tpl = templateFor('receipt');
  const [d, setD] = useState<ReceiptDraft | null>(() => {
    if (!db) return null;
    const [head1 = '', ...rest] = (tpl?.head || '').split('\n');
    const paper = tpl?.paper === '58mm' || tpl?.paper === '80mm' ? tpl.paper : db.printer.width === '58mm' ? '58mm' : '80mm';
    return {
      logo: db.firm.logo, showLogo: tpl?.showLogo ?? true, paper,
      head1, head2: rest.join(' '), phone: db.firm.phone || '', whatsapp: db.firm.phone2 || '', address: db.firm.address || '',
      foot: tpl?.foot || '', taxName: db.settings.taxName || 'Tax',
      showTax: tpl?.showTax ?? true, showParty: tpl?.showParty ?? true, showServed: tpl?.showServed ?? true,
      showBatch: tpl?.showBatch ?? false, showExpiry: tpl?.showExpiry ?? false, tight: tpl?.density === 'tight',
      code: tpl?.code || 'none', codeData: tpl?.codeData || 'no',
      autoPrint: db.printer.autoPrint, copies: db.printer.copies || 1,
    };
  });
  if (!db || !d) return <Guard>{null}</Guard>;
  const set = (patch: Partial<ReceiptDraft>) => setD({ ...d, ...patch });

  function save() {
    if (!db || !d) return;
    let logo = d.logo;
    if (logo !== db.firm.logo) {
      if (logo) logo = keepPhoto(logo, 'logo');
      dropPhoto(db.firm.logo);
    }
    updateFirm({ logo, phone: d.phone.trim(), phone2: d.whatsapp.trim(), address: d.address.trim() });
    setSetting({ taxName: d.taxName.trim() || 'Tax' });
    if (tpl) {
      updateTemplate(tpl.id, {
        paper: d.paper, kind: 'thermal', showLogo: d.showLogo,
        head: [d.head1.trim(), d.head2.trim()].filter(Boolean).join('\n'), foot: d.foot.trim(),
        showTax: d.showTax, showParty: d.showParty, showServed: d.showServed,
        showBatch: d.showBatch, showExpiry: d.showExpiry, density: d.tight ? 'tight' : 'normal',
        code: d.code, codeData: d.codeData, codeCaption: d.code !== 'none',
      });
    }
    setPrinter({ width: d.paper, autoPrint: d.autoPrint, copies: d.copies });
    // the paper in the default roll printer is what actually decides the layout
    const dp = defaultPrinter(db);
    if (dp && dp.kind !== 'pdf' && dp.width !== 'A4') updatePrinter(dp.id, { width: d.paper });
    success('Receipt settings saved');
    nav.goBack?.();
  }

  const paperTile = (p: '58mm' | '80mm', chars: number) => {
    const on = d.paper === p;
    return (
      <Pressable
        key={p}
        onPress={() => set({ paper: p })}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        style={{
          flex: 1, alignItems: 'center', gap: 6, paddingVertical: 14, borderRadius: 14,
          backgroundColor: on ? colors.accent : colors.sunk, borderWidth: 1, borderColor: on ? colors.accent : colors.line,
        }}
      >
        <Icon name="receipt" size={20} color={on ? colors.accentInk : colors.soft} />
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 16, color: on ? colors.accentInk : colors.ink }}>{p.replace('mm', ' mm')}</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: on ? colors.accentInk : colors.faint }}>≈ {chars} chars/line</Text>
      </Pressable>
    );
  };

  return (
    <Guard>
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <LogoSlot uri={d.logo} onChange={(logo) => set({ logo })} hint="Shown at the top of printed receipts and PDF invoices." />

        <Section icon="receipt" title="Paper size" hint="The width of the roll in your receipt printer.">
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {paperTile('58mm', 32)}
            {paperTile('80mm', 48)}
          </View>
        </Section>

        <Section icon="pencil" title="Receipt header" hint="Printed below the store name — use it for a tagline or opening hours.">
          <Field icon="pencil" placeholder="Header line 1" value={d.head1} onChangeText={(v) => set({ head1: v })} />
          <Field icon="pencil" placeholder="Header line 2" value={d.head2} onChangeText={(v) => set({ head2: v })} />
        </Section>

        <Section icon="phone" title="Contact information" hint="Printed below the store name. Shared with invoices.">
          <Field icon="phone" placeholder="Phone number" value={d.phone} onChangeText={(v) => set({ phone: v })} numeric />
          <Field icon="phone" placeholder="WhatsApp number" value={d.whatsapp} onChangeText={(v) => set({ whatsapp: v })} numeric />
          <Field icon="pin" placeholder="Shop address" value={d.address} onChangeText={(v) => set({ address: v })} />
        </Section>

        <Section icon="doc" title="Receipt footer">
          <Field label="Footer message" placeholder="Thank you for your business!" value={d.foot} onChangeText={(v) => set({ foot: v })} multiline />
        </Section>

        <Section icon="pie" title="Tax" hint="What the tax line is called on paper. Shared with invoices.">
          <Field label="Tax label" icon="receipt" value={d.taxName} onChangeText={(v) => set({ taxName: v })} />
        </Section>

        <Section icon="tools" title="Options">
          <ToggleRow bare label="Show logo" sub="Print the store logo at the top" on={d.showLogo} onChange={(v) => set({ showLogo: v })} />
          <ToggleRow bare label="Show tax line" sub={'Print the ' + (d.taxName || 'tax') + ' amount in the totals'} on={d.showTax} onChange={(v) => set({ showTax: v })} />
          <ToggleRow bare label="Show customer" sub="Print the customer's name and phone if given" on={d.showParty} onChange={(v) => set({ showParty: v })} />
          <ToggleRow bare label="Show who served" sub="Print the cashier's name" on={d.showServed} onChange={(v) => set({ showServed: v })} />
          <ToggleRow bare label="Show batch number" sub="Which lot each item came from" on={d.showBatch} onChange={(v) => set({ showBatch: v })} />
          <ToggleRow bare label="Show expiry date" sub="For perishables and pharmacy stock" on={d.showExpiry} onChange={(v) => set({ showExpiry: v })} />
          <ToggleRow bare label="Compact spacing" sub="Tighter lines — uses less paper" on={d.tight} onChange={(v) => set({ tight: v })} />
          <ToggleRow bare label="Print automatically after a sale" on={d.autoPrint} onChange={(v) => set({ autoPrint: v })} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 14.5, color: colors.ink }}>Copies per sale</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>{d.copies === 1 ? 'One copy' : d.copies + ' copies'}</Text>
            </View>
            <View style={{ width: 44 }}><Button size="sm" label="−" onPress={() => set({ copies: Math.max(1, d.copies - 1) })} /></View>
            <View style={{ width: 44 }}><Button size="sm" label="+" onPress={() => set({ copies: Math.min(5, d.copies + 1) })} /></View>
          </View>
        </Section>

        <Section icon="tag" title="Code at the bottom" hint="A QR code or barcode customers or staff can scan.">
          <SelectField label="Print" value={d.code} options={CODE_CHOICES} onChange={(v) => set({ code: v })} />
          {d.code !== 'none' ? (
            <SelectField label="What it holds" value={d.codeData} options={CODE_DATA_CHOICES} onChange={(v) => set({ codeData: v })} />
          ) : null}
        </Section>

        <Section icon="search" title="Preview">
          <View style={{ backgroundColor: colors.sunk, borderRadius: 12, paddingVertical: 14 }}>
            <ReceiptPreview d={d} />
          </View>
        </Section>

        <SaveBar onSave={save} />
      </ScrollView>
    </Guard>
  );
}

/* ---------------- invoice PDF settings ---------------- */

type InvStyle = 'plain' | 'modern' | 'classic';
interface InvoiceDraft {
  logo?: string; showLogo: boolean;
  tagline: string; phone: string; whatsapp: string; email: string; address: string;
  foot: string; taxName: string; style: InvStyle; accent: string;
  showTax: boolean; showParty: boolean; showServed: boolean; showBatch: boolean; showExpiry: boolean;
  code: CodeKind; codeData: CodeData;
}

function InvoicePreview({ d }: { d: InvoiceDraft }) {
  const { db, money } = useAppData();
  if (!db) return null;
  const accent = d.style === 'modern' ? d.accent : '#111';
  const boxed = d.style === 'classic';
  const lines = sampleLines();
  const sub = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const tax = Math.round(sub * (db.settings.taxRate || 0) / 100);
  const small = { fontFamily: fonts.ui, fontSize: 8.5, color: '#666' };
  const cell = (s: string, w?: number, bold?: boolean) => (
    <Text numberOfLines={1} style={{
      ...(w ? { width: w, textAlign: 'right' as const } : { flex: 1 }),
      fontFamily: bold ? fonts.uiBold : fonts.ui, fontSize: 9, color: bold ? '#fff' : '#222', padding: 4,
    }}>{s}</Text>
  );
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: boxed ? 2 : 8, padding: 14, borderWidth: boxed ? 1.4 : 0, borderColor: '#000' }}>
      {d.style === 'modern' ? <View style={{ height: 5, backgroundColor: accent, borderRadius: 3, marginBottom: 10 }} /> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
        <View style={{ flex: 1 }}>
          {d.showLogo && d.logo ? <Image source={{ uri: d.logo }} style={{ width: 60, height: 26, marginBottom: 4 }} resizeMode="contain" /> : null}
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: '#111' }}>{db.firm.name}</Text>
          {[d.tagline, d.address, d.phone, d.whatsapp ? 'WhatsApp ' + d.whatsapp : '', d.email].filter(Boolean).map((x, i) => (
            <Text key={i} numberOfLines={1} style={small}>{x}</Text>
          ))}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <View style={{ backgroundColor: accent, borderRadius: 4, paddingVertical: 4, paddingHorizontal: 8 }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 10, color: '#fff', letterSpacing: 0.8 }}>INVOICE</Text>
          </View>
          <Text style={[small, { marginTop: 4 }]}>INV-001</Text>
          <Text style={small}>{new Date().toLocaleDateString('en-GB')}</Text>
        </View>
      </View>
      {d.showParty ? (
        <View style={{ marginTop: 10, padding: 7, backgroundColor: boxed ? '#fff' : '#f3f4f6', borderWidth: boxed ? 1 : 0, borderColor: '#000', borderRadius: boxed ? 0 : 6 }}>
          <Text style={[small, { fontSize: 7.5, textTransform: 'uppercase' }]}>Billed to</Text>
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 10, color: '#222' }}>Customer name</Text>
        </View>
      ) : null}
      <View style={{ marginTop: 10, borderWidth: boxed ? 1 : 0, borderColor: '#000' }}>
        <View style={{ flexDirection: 'row', backgroundColor: accent }}>
          {cell('Description', undefined, true)}{cell('Qty', 30, true)}{cell('Amount', 70, true)}
        </View>
        {lines.map((l) => (
          <View key={l.name} style={{ borderBottomWidth: 1, borderBottomColor: boxed ? '#000' : '#eee' }}>
            <View style={{ flexDirection: 'row' }}>{cell(l.name)}{cell(String(l.qty), 30)}{cell(money(l.qty * l.price), 70)}</View>
            {d.showBatch || d.showExpiry ? (
              <Text style={[small, { paddingHorizontal: 4, paddingBottom: 3 }]}>
                {[d.showBatch ? 'Batch ' + l.batch : '', d.showExpiry ? 'Exp ' + l.expiry : ''].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
      <View style={{ alignItems: 'flex-end', marginTop: 8, gap: 2 }}>
        <Text style={small}>Subtotal {money(sub)}</Text>
        {d.showTax && tax ? <Text style={small}>{d.taxName || 'Tax'} {money(tax)}</Text> : null}
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, color: '#111' }}>Total {money(sub + tax)}</Text>
      </View>
      {d.showServed ? <Text style={[small, { textAlign: 'center', marginTop: 8 }]}>Served by Cashier</Text> : null}
      <CodeMock code={d.code} />
      <Text style={[small, { textAlign: 'center', marginTop: 8 }]}>{d.foot || db.firm.footer || 'Thank you for your business'}</Text>
    </View>
  );
}

export function InvoiceSettingsScreen() {
  const { colors } = useTheme();
  const nav = useNavigation<any>();
  const { db, templateFor, updateTemplate, updateFirm, setSetting } = useAppData();
  const { success } = useToast();
  const tpl = templateFor('invoice');
  const receiptTpl = templateFor('receipt');
  const [d, setD] = useState<InvoiceDraft | null>(() => {
    if (!db) return null;
    return {
      logo: db.firm.logo, showLogo: tpl?.showLogo ?? true,
      tagline: db.firm.description || '', phone: db.firm.phone || '', whatsapp: db.firm.phone2 || '',
      email: db.firm.email || '', address: db.firm.address || '',
      foot: tpl?.foot || '', taxName: db.settings.taxName || 'Tax',
      style: tpl?.boxed ? 'classic' : tpl?.accentColor ? 'modern' : 'plain',
      accent: tpl?.accentColor || ACCENT_COLORS[1],
      showTax: tpl?.showTax ?? true, showParty: tpl?.showParty ?? true, showServed: tpl?.showServed ?? true,
      showBatch: tpl?.showBatch ?? false, showExpiry: tpl?.showExpiry ?? false,
      code: tpl?.code || 'none', codeData: tpl?.codeData || 'verify',
    };
  });
  if (!db || !d) return <Guard>{null}</Guard>;
  const set = (patch: Partial<InvoiceDraft>) => setD({ ...d, ...patch });

  function save() {
    if (!db || !d) return;
    let logo = d.logo;
    if (logo !== db.firm.logo) {
      if (logo) logo = keepPhoto(logo, 'logo');
      dropPhoto(db.firm.logo);
    }
    updateFirm({
      logo, description: d.tagline.trim(), phone: d.phone.trim(), phone2: d.whatsapp.trim(),
      email: d.email.trim(), address: d.address.trim(),
    });
    setSetting({ taxName: d.taxName.trim() || 'Tax' });
    if (tpl) {
      updateTemplate(tpl.id, {
        showLogo: d.showLogo, foot: d.foot.trim(),
        boxed: d.style === 'classic', accentColor: d.style === 'modern' ? d.accent : undefined,
        showTax: d.showTax, showParty: d.showParty, showServed: d.showServed,
        showBatch: d.showBatch, showExpiry: d.showExpiry,
        code: d.code, codeData: d.codeData, codeCaption: d.code !== 'none',
        // a template shared with receipts keeps its roll paper
        ...(tpl.id !== receiptTpl?.id ? { paper: 'A4' as const, kind: 'page' as const } : null),
      });
    }
    success('Invoice settings saved');
    nav.goBack?.();
  }

  const styleChip = (v: InvStyle, label: string, sub: string) => {
    const on = d.style === v;
    return (
      <Pressable
        key={v}
        onPress={() => set({ style: v })}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        style={{
          flex: 1, padding: 10, borderRadius: 12, borderWidth: 1.4,
          borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accentSoft : colors.surface,
        }}
      >
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: on ? colors.accent : colors.ink }}>{label}</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 2 }}>{sub}</Text>
      </Pressable>
    );
  };

  return (
    <Guard>
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <LogoSlot uri={d.logo} onChange={(logo) => set({ logo })} hint="Shown at the top of PDF invoices and printed receipts." />

        <Section icon="owner" title="Business information" hint="Displayed at the top of every invoice.">
          <Field icon="pencil" placeholder="Business tagline" value={d.tagline} onChangeText={(v) => set({ tagline: v })} />
          <Field icon="phone" placeholder="Phone number" value={d.phone} onChangeText={(v) => set({ phone: v })} numeric />
          <Field icon="phone" placeholder="WhatsApp number" value={d.whatsapp} onChangeText={(v) => set({ whatsapp: v })} numeric />
          <Field icon="mail" placeholder="Email address" value={d.email} onChangeText={(v) => set({ email: v })} autoCapitalize="none" />
          <Field icon="pin" placeholder="Business address" value={d.address} onChangeText={(v) => set({ address: v })} multiline />
        </Section>

        <Section icon="doc" title="Invoice footer">
          <Field label="Footer message" placeholder="Thank you for your business!" value={d.foot} onChangeText={(v) => set({ foot: v })} multiline />
        </Section>

        <Section icon="pie" title="Tax">
          <Field label="Tax label" icon="receipt" value={d.taxName} onChangeText={(v) => set({ taxName: v })} />
        </Section>

        <Section icon="tag" title="Layout and accent colour">
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {styleChip('plain', 'Plain', 'Clean, no colour')}
            {styleChip('modern', 'Modern', 'Coloured bar')}
            {styleChip('classic', 'Classic', 'Ruled boxes')}
          </View>
          {d.style === 'modern' ? (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              {ACCENT_COLORS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => set({ accent: c })}
                  accessibilityLabel={'Accent ' + c}
                  style={{
                    width: 36, height: 36, borderRadius: 18, backgroundColor: c, alignItems: 'center', justifyContent: 'center',
                    borderWidth: d.accent === c ? 3 : 0, borderColor: colors.ink,
                  }}
                >
                  {d.accent === c ? <Icon name="check" size={16} color="#fff" /> : null}
                </Pressable>
              ))}
            </View>
          ) : null}
        </Section>

        <Section icon="tools" title="Options">
          <ToggleRow bare label="Show logo" on={d.showLogo} onChange={(v) => set({ showLogo: v })} />
          <ToggleRow bare label="Show tax line" on={d.showTax} onChange={(v) => set({ showTax: v })} />
          <ToggleRow bare label="Show customer" sub="Name, phone and address of who is billed" on={d.showParty} onChange={(v) => set({ showParty: v })} />
          <ToggleRow bare label="Show who served" on={d.showServed} onChange={(v) => set({ showServed: v })} />
          <ToggleRow bare label="Show batch number" on={d.showBatch} onChange={(v) => set({ showBatch: v })} />
          <ToggleRow bare label="Show expiry date" on={d.showExpiry} onChange={(v) => set({ showExpiry: v })} />
          <View style={{ height: 10 }} />
          <SelectField label="QR / barcode on the invoice" value={d.code} options={CODE_CHOICES} onChange={(v) => set({ code: v })} />
          {d.code !== 'none' ? (
            <SelectField label="What it holds" value={d.codeData} options={CODE_DATA_CHOICES} onChange={(v) => set({ codeData: v })} />
          ) : null}
        </Section>

        <Section icon="search" title="Preview">
          <View style={{ backgroundColor: colors.sunk, borderRadius: 12, padding: 10 }}>
            <InvoicePreview d={d} />
          </View>
        </Section>

        <SaveBar onSave={save} />
      </ScrollView>
    </Guard>
  );
}
