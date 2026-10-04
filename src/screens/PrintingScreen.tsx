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
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Alert, Image, Linking, Platform, ActivityIndicator } from 'react-native';
import { Pressable } from '../components/Press';
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
import {
  FoundDevice, scanBluetooth, stopScan, notAPrinter, testBluetooth, printBluetooth, testNetwork,
  testPage as rawTestPage,
} from '../data/rawPrinter';
import { keepPhoto, dropPhoto } from '../data/photos';
import { kindLabel, CODE_DATA, POWERED_BY } from '../data/defaults';
import type { Printer, CodeKind, CodeData, PrintTemplate, ReceiptStyle } from '../data/types';
import { dmy, numberToWords, InvoiceStyle } from '../data/invoiceLayouts';

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
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<FoundDevice[] | null>(null);
  const [joining, setJoining] = useState('');
  const [problem, setProblem] = useState('');
  useEffect(() => () => { stopScan(); }, []);

  if (!db) return <Guard>{null}</Guard>;

  const rollPaper = () => (db!.printer.width === 'A4' ? '80mm' : db!.printer.width);

  /** A printer this phone talks to directly gets the ESC/POS page; the rest go through the print dialog. */
  async function testPage(p: Printer) {
    if (!db) return;
    if ((p.kind === 'bluetooth' || p.kind === 'wifi') && p.address) {
      setBusy(true);
      setProblem('');
      try {
        const page = rawTestPage(db.firm.name, p.name, paperOf(p));
        if (p.kind === 'bluetooth') await printBluetooth(p.address, page);
        else await testNetwork(p.address, p.port || 9100, page);
        success('Test page sent to ' + p.name);
      } catch (e: any) {
        setProblem(e?.message || 'The test page could not be sent.');
        error(e?.message || 'The test page could not be sent to ' + p.name + '.');
      } finally {
        setBusy(false);
      }
      return;
    }
    await dialogTestPage(p);
  }

  async function dialogTestPage(p: Printer) {
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
    const name = same?.name || 'Network printer ' + h;
    // the test page is the check: nothing is saved unless the printer answered
    setBusy(true);
    setProblem('');
    try {
      await testNetwork(h, n, rawTestPage(db.firm.name, name, same ? paperOf(same) : rollPaper()));
    } catch (e: any) {
      setProblem(e?.message || 'No printer answered at ' + h + ':' + n + '.');
      error(e?.message || 'No printer answered at ' + h + ':' + n + '.');
      return;
    } finally {
      setBusy(false);
    }
    let p: Printer;
    if (same) {
      updatePrinter(same.id, { port: n, online: true });
      p = { ...same, port: n, online: true };
    } else {
      p = addPrinter({ name, kind: 'wifi', width: rollPaper(), address: h, port: n, dflt: true, online: true, note: '' });
    }
    makeDefaultPrinter(p.id);
    success('Test page sent. ' + p.name + ' is now the printer for this phone');
  }

  async function scan() {
    setProblem('');
    setScanning(true);
    setFound([]);
    try {
      const list = await scanBluetooth((paired) => setFound(paired));
      setFound(list);
      if (!list.length) setProblem('No Bluetooth devices found. Switch the printer on, keep it near the phone and scan again.');
    } catch (e: any) {
      setProblem(e?.message || 'The scan could not run.');
      error(e?.message || 'The scan could not run.');
    } finally {
      setScanning(false);
    }
  }

  /** Tap a found device: refuse it if it is not a printer, else connect, print a test page and keep it. */
  async function join(d: FoundDevice) {
    if (!db || joining) return;
    const why = notAPrinter(d);
    if (why) { setProblem(why); error(why); return; }
    setJoining(d.address);
    setProblem('');
    const same = db.printers.find((p) => p.kind === 'bluetooth' && p.address === d.address);
    try {
      await testBluetooth(d, rawTestPage(db.firm.name, d.name, same ? paperOf(same) : rollPaper()));
    } catch (e: any) {
      setProblem(e?.message || 'Could not connect to ' + d.name + '.');
      error(e?.message || 'Could not connect to ' + d.name + '.');
      return;
    } finally {
      setJoining('');
    }
    const p = same || addPrinter({
      name: d.name, kind: 'bluetooth', width: rollPaper(), address: d.address, port: 0, dflt: true, online: true, note: '',
    });
    makeDefaultPrinter(p.id);
    success('Connected. A test page was printed on ' + d.name);
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
            ? 'Enter the IP address of a Wi-Fi/LAN receipt printer on the same network as this phone. Typical port: 9100. Connect sends a test page; if nothing answers you will be told.'
            : 'Switch the printer on and tap Scan. Tap your printer in the list to connect; a test page prints to confirm it.'}
        />
        {problem ? (
          <View style={{ marginTop: 10 }}>
            <InfoBanner tone="danger" icon="alert" text={problem} />
          </View>
        ) : null}

        {/* the receipt printer in use — only a real one, found or tested here */}
        {(() => {
          const real = dp && (dp.kind === 'bluetooth' || dp.kind === 'wifi') ? dp : undefined;
          return (
            <View style={{
              padding: 16, borderRadius: 18, marginTop: 14,
              backgroundColor: colors.surface, borderWidth: 1, borderColor: real ? colors.good : colors.line,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
                <View style={{
                  width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: real ? colors.goodSoft : colors.sunk,
                }}>
                  <Icon name={real ? (real.kind === 'bluetooth' ? 'bluetooth' : 'wifi') : 'print'} size={20} color={real ? colors.good : colors.faint} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>
                    {real ? real.name : 'No receipt printer yet'}
                  </Text>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
                    {real
                      ? kindLabel(real.kind) + ' · ' + paperOf(real) + (real.kind === 'wifi' && real.address ? ' · ' + real.address + ':' + (real.port || 9100) : '')
                      : mode === 'bluetooth' ? 'Scan below to find one' : 'Enter its IP address below'}
                  </Text>
                </View>
                {real ? <Badge label="In use" tone="good" /> : null}
              </View>
              {real ? (
                <View style={{ marginTop: 14 }}>
                  <Button size="sm" label="Print a test page" loading={busy} icon={<Icon name="print" size={15} color={colors.ink} />} onPress={() => testPage(real)} />
                </View>
              ) : null}
            </View>
          );
        })()}

        <View style={{ marginTop: 18 }}>
          {mode === 'network' ? (
            <>
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Field label="Printer IP address" icon="wifi" placeholder="192.168.1.50" value={host} onChangeText={setHost} autoCapitalize="none" />
                </View>
                <View style={{ width: 96 }}>
                  <Field label="Port" placeholder="9100" value={port} onChangeText={setPort} numeric />
                </View>
              </View>
              <Button variant="pri" label={busy ? 'Sending a test page…' : 'Connect and test'} loading={busy} icon={<Icon name="wifi" size={17} color={colors.accentInk} />} onPress={connectNetwork} />
            </>
          ) : (
            <>
              <Button
                variant="pri"
                label={scanning ? 'Scanning for printers…' : found ? 'Scan again' : 'Scan for printers'}
                loading={scanning}
                icon={<Icon name="search" size={17} color={colors.accentInk} />}
                onPress={scan}
              />
              {found ? (
                (['paired', 'available'] as const).map((group) => {
                  const list = found.filter((d) => (group === 'paired') === d.paired);
                  if (!list.length && !(group === 'available' && scanning)) return null;
                  return (
                    <View key={group} style={{ marginTop: 16 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, marginLeft: 4 }}>
                        <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.faint }}>
                          {group === 'paired' ? 'Paired with this phone' : 'Available nearby'}
                        </Text>
                        {group === 'available' && scanning ? <ActivityIndicator size="small" color={colors.accent} /> : null}
                      </View>
                      <View style={{ gap: 8 }}>
                        {list.map((d) => {
                          const not = notAPrinter(d);
                          const inUse = db.printers.some((p) => p.kind === 'bluetooth' && p.address === d.address && p.dflt);
                          return (
                            <Pressable
                              key={d.address}
                              onPress={() => join(d)}
                              disabled={!!joining}
                              accessibilityRole="button"
                              accessibilityLabel={'Connect to ' + d.name}
                              style={({ pressed }) => ({
                                flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14,
                                backgroundColor: pressed ? colors.sunk : colors.surface, borderWidth: 1,
                                borderColor: inUse ? colors.good : colors.line, opacity: not ? 0.55 : 1,
                              })}
                            >
                              <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: not ? colors.sunk : colors.accentSoft }}>
                                <Icon name={not ? 'bluetooth' : 'print'} size={18} color={not ? colors.faint : colors.accent} />
                              </View>
                              <View style={{ flex: 1, minWidth: 0 }}>
                                <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 14.5, color: colors.ink }}>{d.name}</Text>
                                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 2 }}>
                                  {not ? 'Not a printer' : inUse ? 'In use' : d.address}
                                </Text>
                              </View>
                              {joining === d.address
                                ? <ActivityIndicator size="small" color={colors.accent} />
                                : inUse ? <Icon name="check" size={18} color={colors.good} />
                                  : <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: not ? colors.faint : colors.accent }}>Connect</Text>}
                            </Pressable>
                          );
                        })}
                        {!list.length ? (
                          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginLeft: 4 }}>Looking for printers that are switched on…</Text>
                        ) : null}
                      </View>
                    </View>
                  );
                })
              ) : null}
              <Pressable onPress={openBluetoothSettings} hitSlop={8} style={{ alignSelf: 'center', paddingVertical: 14 }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.accent }}>Printer not listed? Open Bluetooth settings</Text>
              </Pressable>
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

/** The four looks a roll receipt can take, and the switches each one starts from. */
const RECEIPT_STYLES: { v: ReceiptStyle; l: string; sub: string; preset: Partial<ReceiptDraft> }[] = [
  { v: 'classic', l: 'Classic', sub: 'Every item on two lines, the usual till receipt', preset: { tight: false, showRate: true, showUnit: true, showServed: true } },
  { v: 'compact', l: 'Compact', sub: 'One line per item, least paper', preset: { tight: true, showServed: false } },
  { v: 'detailed', l: 'Detailed', sub: 'Everything, with item and quantity counts', preset: { tight: false, showRate: true, showUnit: true, showServed: true, showParty: true, showImei: true, showPaid: true } },
  { v: 'bold', l: 'Bold total', sub: 'A large total in a box, easy to read at a glance', preset: { tight: false } },
];

function ReceiptPreview({ d }: { d: ReceiptDraft }) {
  const { db, money } = useAppData();
  if (!db) return null;
  const narrow = d.paper === '58mm';
  const size = narrow ? 9.5 : 11;
  const compact = d.style === 'compact';
  const lines = sampleLines();
  const sub = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const tax = Math.round(sub * (db.settings.taxRate || 0) / 100);
  const total = sub + tax;
  const paid = Math.ceil((total + 1) / 10000) * 10000;
  const t = (s: string, extra?: object) => <Text style={[{ fontFamily: fonts.mono, fontSize: size, color: '#333' }, extra]}>{s}</Text>;
  const rule = <View style={{ borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#555', marginVertical: compact ? 3 : 6 }} />;
  const kv = (k: string, v: string) => (
    <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>{t(k)}{t(v)}</View>
  );
  const qtyLine = (l: ReturnType<typeof sampleLines>[number]) =>
    l.qty + (d.showUnit ? ' pcs' : '') + (d.showRate ? ' × ' + money(l.price) : '');
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 8, padding: 14, width: narrow ? 220 : 290, alignSelf: 'center' }}>
      {d.showLogo && d.logo ? <Image source={{ uri: d.logo }} style={{ height: 34, marginBottom: 4 }} resizeMode="contain" /> : null}
      <Text style={{ textAlign: 'center', fontFamily: fonts.uiBold, fontSize: size + (d.style === 'bold' ? 5 : 3), color: '#111' }}>{db.firm.name}</Text>
      {(compact ? [d.phone] : [d.head1, d.head2, d.address, d.phone, d.whatsapp ? 'WhatsApp ' + d.whatsapp : '']).filter(Boolean).map((x, i) => (
        <Text key={i} style={{ textAlign: 'center', fontFamily: fonts.mono, fontSize: size - 1, color: '#444' }}>{x}</Text>
      ))}
      <Text style={{ textAlign: 'center', fontFamily: fonts.uiBold, fontSize: size, color: '#111', marginTop: 6, letterSpacing: 1 }}>{(d.title.trim() || 'Receipt').toUpperCase()}</Text>
      {rule}
      {kv('Number', 'INV-001')}
      {kv('Date', new Date().toLocaleDateString('en-GB'))}
      {d.showParty ? kv('Customer', 'Walk-in customer') : null}
      {compact ? null : kv('Paid by', 'Cash')}
      {d.showServed && !compact ? kv('Served by', 'Cashier') : null}
      {rule}
      {lines.map((l, i) => (
        <View key={i + ':' + l.name} style={{ marginBottom: compact ? 1 : 3 }}>
          {compact
            ? <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>{t(l.qty + ' ' + l.name)}{t(money(l.qty * l.price))}</View>
            : <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>{t(l.name)}{t(money(l.qty * l.price))}</View>
              {t(qtyLine(l), { fontSize: size - 1.5, color: '#666' })}
            </>}
          {d.showImei && i === 0 ? t('IMEI 356789104512345 / 356789104512352 · Used', { fontSize: size - 1.5, color: '#000' }) : null}
          {!compact && (d.showBatch || d.showExpiry)
            ? t([d.showBatch ? 'Batch ' + l.batch : '', d.showExpiry ? 'Exp ' + l.expiry : ''].filter(Boolean).join(' · '), { fontSize: size - 1.5, color: '#666' })
            : null}
        </View>
      ))}
      {rule}
      {d.style === 'detailed' ? <>{kv('Items: ' + lines.length, 'Qty: ' + lines.reduce((a, l) => a + l.qty, 0))}{rule}</> : null}
      {d.style === 'bold' ? (
        <View style={{ borderTopWidth: 2, borderBottomWidth: 2, borderColor: '#000', paddingVertical: 6, marginVertical: 4, alignItems: 'center' }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: size, color: '#111', letterSpacing: 1 }}>TOTAL</Text>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: size + 10, color: '#111' }}>{money(total)}</Text>
        </View>
      ) : null}
      {kv('Subtotal', money(sub))}
      {d.showTax && tax ? kv(d.taxName || 'Tax', money(tax)) : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: size + 1.5, color: '#111' }}>TOTAL</Text>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: size + 1.5, color: '#111' }}>{money(total)}</Text>
      </View>
      {d.showPaid ? <>{kv('Paid', money(paid))}{kv('Change', money(paid - total))}</> : null}
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
  showRate: boolean; showUnit: boolean; showImei: boolean; showPaid: boolean;
  title: string; style: ReceiptStyle; mode: 'thermal' | 'a4';
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
      showRate: tpl?.showRate !== false, showUnit: tpl?.showUnit !== false, showImei: tpl?.showImei !== false, showPaid: tpl?.showPaid !== false,
      title: tpl?.title || '', style: tpl?.receiptStyle || 'classic', mode: db.printer.receiptMode || 'thermal',
      code: tpl?.code || 'none', codeData: tpl?.codeData || 'no',
      autoPrint: db.printer.autoPrint, copies: db.printer.copies || 1,
    };
  });
  if (!db || !d) return <Guard>{null}</Guard>;
  const set = (patch: Partial<ReceiptDraft>) => setD({ ...d, ...patch });

  async function save() {
    if (!db || !d) return;
    let logo = d.logo;
    if (logo !== db.firm.logo) {
      if (logo) logo = await keepPhoto(logo, 'logo');
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
        showRate: d.showRate, showUnit: d.showUnit, showImei: d.showImei, showPaid: d.showPaid,
        title: d.title.trim(), receiptStyle: d.style,
        code: d.code, codeData: d.codeData, codeCaption: d.code !== 'none',
      });
    }
    setPrinter({ width: d.paper, autoPrint: d.autoPrint, copies: d.copies, receiptMode: d.mode });
    // the paper in the default roll printer is what actually decides the layout
    const dp = defaultPrinter(db);
    if (dp && dp.kind !== 'pdf' && dp.width !== 'A4') updatePrinter(dp.id, { width: d.paper });
    success('Receipt settings saved');
    nav.goBack?.();
  }

  const tile = (on: boolean, onPress: () => void, icon: IconName, title: string, sub: string) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={{
        flex: 1, alignItems: 'center', gap: 6, paddingVertical: 14, paddingHorizontal: 6, borderRadius: 14,
        backgroundColor: on ? colors.accent : colors.sunk, borderWidth: 1, borderColor: on ? colors.accent : colors.line,
      }}
    >
      <Icon name={icon} size={20} color={on ? colors.accentInk : colors.soft} />
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: on ? colors.accentInk : colors.ink }}>{title}</Text>
      <Text style={{ fontFamily: fonts.ui, fontSize: 11, textAlign: 'center', color: on ? colors.accentInk : colors.faint }}>{sub}</Text>
    </Pressable>
  );

  return (
    <Guard>
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <Section icon="print" title="Print receipts as" hint="How a sale's receipt comes out by default. Any receipt can still be shared as a PDF.">
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {tile(d.mode === 'thermal', () => set({ mode: 'thermal' }), 'receipt', 'Thermal roll', 'The till printer, 58 or 80 mm')}
            {tile(d.mode === 'a4', () => set({ mode: 'a4' }), 'doc', 'A4 page', 'A full page, laid out like an invoice')}
          </View>
        </Section>

        <Section icon="doc" title="Template" hint="How the receipt looks. Pick one, then fine-tune the switches below.">
          <View style={{ gap: 8 }}>
            {RECEIPT_STYLES.map((s) => {
              const on = d.style === s.v;
              return (
                <Pressable
                  key={s.v}
                  onPress={() => set({ style: s.v, ...s.preset })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1.4,
                    borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accentSoft : colors.surface,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: on ? colors.accent : colors.ink }}>{s.l}</Text>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 2 }}>{s.sub}</Text>
                  </View>
                  {on ? <Icon name="check" size={18} color={colors.accent} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Section icon="search" title="Preview">
          <View style={{ backgroundColor: colors.sunk, borderRadius: 12, paddingVertical: 14 }}>
            <ReceiptPreview d={d} />
          </View>
        </Section>

        <Section icon="pencil" title="Title" hint="The heading printed on every receipt. Leave empty for 'Receipt'.">
          <Field icon="pencil" placeholder="Receipt" value={d.title} onChangeText={(v) => set({ title: v })} />
        </Section>

        <LogoSlot uri={d.logo} onChange={(logo) => set({ logo })} hint="Shown at the top of printed receipts and PDF invoices." />

        <Section icon="receipt" title="Paper size" hint="The width of the roll in your receipt printer.">
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {tile(d.paper === '58mm', () => set({ paper: '58mm' }), 'receipt', '58 mm', '≈ 32 chars/line')}
            {tile(d.paper === '80mm', () => set({ paper: '80mm' }), 'receipt', '80 mm', '≈ 48 chars/line')}
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

        <Section icon="tools" title="What prints">
          <ToggleRow bare label="Show logo" sub="Print the store logo at the top" on={d.showLogo} onChange={(v) => set({ showLogo: v })} />
          <ToggleRow bare label="Show rate" sub="The price of one, beside the quantity" on={d.showRate} onChange={(v) => set({ showRate: v })} />
          <ToggleRow bare label="Show unit" sub="pcs, kg, box after the quantity" on={d.showUnit} onChange={(v) => set({ showUnit: v })} />
          <ToggleRow bare label="Show IMEI & condition" sub="The phone's IMEI(s) and New / Used under the item" on={d.showImei} onChange={(v) => set({ showImei: v })} />
          <ToggleRow bare label="Show tax line" sub={'Print the ' + (d.taxName || 'tax') + ' amount in the totals'} on={d.showTax} onChange={(v) => set({ showTax: v })} />
          <ToggleRow bare label="Show paid & change" sub="What the customer handed over and got back" on={d.showPaid} onChange={(v) => set({ showPaid: v })} />
          <ToggleRow bare label="Show customer" sub="Print the customer's name and phone if given" on={d.showParty} onChange={(v) => set({ showParty: v })} />
          <ToggleRow bare label="Show who served" sub="Print the cashier's name" on={d.showServed} onChange={(v) => set({ showServed: v })} />
          <ToggleRow bare label="Show batch number" sub="Which lot each item came from" on={d.showBatch} onChange={(v) => set({ showBatch: v })} />
          <ToggleRow bare label="Show expiry date" sub="For perishables and pharmacy stock" on={d.showExpiry} onChange={(v) => set({ showExpiry: v })} />
          <ToggleRow bare label="Compact spacing" sub="Tighter lines — uses less paper" on={d.tight} onChange={(v) => set({ tight: v })} />
        </Section>

        <Section icon="print" title="After a sale">
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

        <SaveBar onSave={save} />
      </ScrollView>
    </Guard>
  );
}

/* ---------------- invoice PDF settings ---------------- */

const STYLE_ACCENT: Record<InvoiceStyle, string> = { plain: '#111827', tally: '#111827', quickbooks: '#2CA01C', gst: '#1E2A78' };
const INVOICE_STYLES: { v: InvoiceStyle; l: string; sub: string }[] = [
  { v: 'tally', l: 'Tally', sub: 'Ruled ledger, amount in words, declaration' },
  { v: 'quickbooks', l: 'QuickBooks', sub: 'Clean, colour bar, Bill to / Ship to band' },
  { v: 'gst', l: 'GST tax invoice', sub: 'Letterhead band, tax summary, bank and QR' },
  { v: 'plain', l: 'Plain', sub: 'Simple and airy' },
];

interface InvoiceDraft {
  logo?: string; showLogo: boolean;
  tagline: string; phone: string; whatsapp: string; email: string; website: string; address: string;
  bank: string; terms: string;
  foot: string; taxName: string; style: InvoiceStyle; accent: string; title: string;
  showTax: boolean; showParty: boolean; showServed: boolean; showBatch: boolean; showExpiry: boolean;
  code: CodeKind; codeData: CodeData;
}

/** The items grid shared by the thumbnails — batch and expiry as their own columns. */
function ItemsMock({ d, head, headInk, ruled, tall }: { d: InvoiceDraft; head: string; headInk: string; ruled: boolean; tall?: number }) {
  const { money } = useAppData();
  const lines = sampleLines();
  const b = ruled ? { borderRightWidth: 1, borderColor: '#000' } : {};
  const t = (s: string, w: number | undefined, bold: boolean, ink: string, align: 'left' | 'right' | 'center' = 'left', last = false) => (
    <Text numberOfLines={1} style={[{
      ...(w ? { width: w } : { flex: 1 }), textAlign: align, padding: 3,
      fontFamily: bold ? fonts.uiBold : fonts.ui, fontSize: 7.5, color: ink,
    }, last ? null : b]}>{s}</Text>
  );
  const row = (cells: [string, number | undefined, 'left' | 'right' | 'center'][], bold: boolean, ink: string, bg?: string) => (
    <View style={{ flexDirection: 'row', backgroundColor: bg }}>
      {cells.map(([s, w, al], i) => <React.Fragment key={i}>{t(s, w, bold, ink, al, i === cells.length - 1)}</React.Fragment>)}
    </View>
  );
  const cols = (l?: ReturnType<typeof sampleLines>[number]): [string, number | undefined, 'left' | 'right' | 'center'][] => [
    [l ? l.name : 'Description', undefined, 'left'],
    ...(d.showBatch ? [[l ? l.batch : 'Batch', 34, 'center'] as [string, number, 'center']] : []),
    ...(d.showExpiry ? [[l ? l.expiry : 'Expiry', 40, 'center'] as [string, number, 'center']] : []),
    [l ? String(l.qty) : 'Qty', 24, 'right'],
    [l ? money(l.price) : 'Rate', 44, 'right'],
    [l ? money(l.qty * l.price) : 'Amount', 50, 'right'],
  ];
  return (
    <View style={{ marginTop: 8, borderWidth: ruled ? 1 : 0, borderColor: '#000' }}>
      <View style={{ borderBottomWidth: 1, borderColor: ruled ? '#000' : '#ccc' }}>{row(cols(), true, headInk, head)}</View>
      {lines.map((l, i) => <View key={i + ':' + l.name}>{row(cols(l), false, '#222')}</View>)}
      {tall ? <View style={{ height: tall }} /> : null}
    </View>
  );
}

function InvoicePreview({ d }: { d: InvoiceDraft }) {
  const { db, money } = useAppData();
  if (!db) return null;
  const lines = sampleLines();
  const sub = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const tax = d.showTax ? Math.round(sub * (db.settings.taxRate || 0) / 100) : 0;
  const total = sub + tax;
  const small = { fontFamily: fonts.ui, fontSize: 7.5, color: '#555' } as const;
  const bold = { fontFamily: fonts.uiBold, fontSize: 8, color: '#111' } as const;
  const logo = d.showLogo && d.logo ? <Image source={{ uri: d.logo }} style={{ width: 56, height: 24 }} resizeMode="contain" /> : null;
  const contact = [d.address, d.phone, d.whatsapp ? 'WhatsApp ' + d.whatsapp : '', d.email, d.website].filter(Boolean);
  const footer = <Text style={[small, { textAlign: 'center', marginTop: 8 }]}>{d.foot || db.firm.footer || 'Thank you for your business'}</Text>;

  if (d.style === 'tally') {
    const box = (k: string, v = '') => (
      <View style={{ flex: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderColor: '#000', padding: 2, minHeight: 18 }}>
        <Text style={[small, { fontSize: 6.5 }]}>{k}</Text><Text style={bold}>{v}</Text>
      </View>
    );
    return (
      <View style={{ backgroundColor: '#fff', padding: 10 }}>
        <Text style={{ textAlign: 'center', fontFamily: fonts.uiBold, fontSize: 11, color: '#111' }}>INVOICE</Text>
        <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: '#000' }}>
          <View style={{ flex: 1 }}>
            <View style={{ padding: 3, borderBottomWidth: 1, borderColor: '#000' }}>
              {logo}<Text style={bold}>{db.firm.name}</Text>
              {contact.slice(0, 3).map((x, i) => <Text key={i} numberOfLines={1} style={small}>{x}</Text>)}
            </View>
            <View style={{ padding: 3 }}>
              <Text style={[small, { fontSize: 6.5 }]}>Buyer</Text>
              {d.showParty ? <Text style={bold}>Taylor & Company</Text> : null}
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row' }}>{box('Invoice No.', 'INV-001')}{box('Dated', dmy(new Date().toISOString()))}</View>
            <View style={{ flexDirection: 'row' }}>{box('Delivery Note')}{box('Mode/Terms of Payment', 'Cash')}</View>
            <View style={{ flexDirection: 'row' }}>{box("Supplier's Ref.")}{box('Other Reference(s)')}</View>
            <View style={{ flexDirection: 'row' }}>{box('Despatched through')}{box('Destination')}</View>
          </View>
        </View>
        <ItemsMock d={d} head="#fff" headInk="#111" ruled tall={36} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderWidth: 1, borderTopWidth: 0, borderColor: '#000', padding: 3 }}>
          <Text style={bold}>Total</Text><Text style={bold}>{money(total)}</Text>
        </View>
        <View style={{ borderWidth: 1, borderTopWidth: 0, borderColor: '#000', padding: 3 }}>
          <Text style={[small, { fontSize: 6.5 }]}>Amount Chargeable (in words)</Text>
          <Text style={bold}>{[db.settings.currencyName, numberToWords(total), 'Only'].filter(Boolean).join(' ')}</Text>
        </View>
        <View style={{ flexDirection: 'row', borderWidth: 1, borderTopWidth: 0, borderColor: '#000' }}>
          <Text style={[small, { flex: 1, padding: 3, fontSize: 6.5 }]}>Declaration: We declare that this invoice shows the actual price of the goods described.</Text>
          <View style={{ width: 110, borderLeftWidth: 1, borderColor: '#000', padding: 3, alignItems: 'flex-end' }}>
            <Text style={bold}>for {db.firm.name}</Text><Text style={[small, { marginTop: 10 }]}>Authorised Signatory</Text>
          </View>
        </View>
        <Text style={[small, { textAlign: 'center', marginTop: 4 }]}>This is a Computer Generated Invoice</Text>
      </View>
    );
  }

  if (d.style === 'gst') {
    return (
      <View style={{ backgroundColor: '#fff', padding: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.uiExtra, fontSize: 15, color: d.accent }}>{db.firm.name.toUpperCase()}</Text>
          {logo}
        </View>
        <View style={{ backgroundColor: '#1A9E8F', paddingVertical: 3, paddingHorizontal: 6, width: '75%', marginTop: 2 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 8, color: '#fff' }}>{d.tagline || ' '}</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
          <Text style={[small, { flex: 1 }]}>{d.address}</Text>
          <View style={{ alignItems: 'flex-end' }}>
            {d.phone ? <Text style={small}>Tel : {d.phone}</Text> : null}
            {d.website ? <Text style={small}>Web : {d.website}</Text> : null}
            {d.email ? <Text style={small}>Email : {d.email}</Text> : null}
          </View>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderWidth: 1, borderColor: '#000', padding: 3, marginTop: 5 }}>
          <Text style={bold}>{db.firm.tin ? 'TIN : ' + db.firm.tin : ' '}</Text>
          <Text style={[bold, { fontSize: 9 }]}>TAX INVOICE</Text>
          <Text style={[small, { fontFamily: fonts.uiBold }]}>ORIGINAL FOR RECIPIENT</Text>
        </View>
        <View style={{ flexDirection: 'row', borderWidth: 1, borderTopWidth: 0, borderColor: '#000' }}>
          <View style={{ flex: 1, borderRightWidth: 1, borderColor: '#000', padding: 3 }}>
            <Text style={[bold, { textAlign: 'center' }]}>Customer Detail</Text>
            <Text style={small}>M/S  {d.showParty ? 'Taylor & Company' : ''}</Text>
            <Text style={small}>Phone</Text>
          </View>
          <View style={{ flex: 1, padding: 3 }}>
            <Text style={small}>Invoice No.  <Text style={bold}>INV-001</Text></Text>
            <Text style={small}>Invoice Date  <Text style={bold}>{dmy(new Date().toISOString())}</Text></Text>
            <Text style={small}>Payment  Cash</Text>
          </View>
        </View>
        <ItemsMock d={d} head="#fff" headInk="#111" ruled tall={24} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderWidth: 1, borderTopWidth: 0, borderColor: '#000', padding: 3 }}>
          <Text style={bold}>Total</Text><Text style={bold}>{money(total)}</Text>
        </View>
        <Text style={[bold, { borderWidth: 1, borderTopWidth: 0, borderColor: '#000', padding: 3 }]}>
          {numberToWords(total).toUpperCase()} ONLY
        </Text>
        <View style={{ flexDirection: 'row', borderWidth: 1, borderTopWidth: 0, borderColor: '#000' }}>
          <View style={{ flex: 1, borderRightWidth: 1, borderColor: '#000', padding: 3 }}>
            <Text style={[bold, { textAlign: 'center' }]}>Bank Details</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={[small, { flex: 1 }]}>{d.bank || 'Add bank details below'}</Text>
              <CodeMock code={d.code === 'none' ? 'none' : 'qr'} />
            </View>
          </View>
          <View style={{ flex: 1, padding: 3, alignItems: 'center' }}>
            <Text style={[bold, { textAlign: 'center' }]}>For {db.firm.name}</Text>
            <Text style={[small, { marginTop: 16 }]}>Authorised Signatory</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', borderWidth: 1, borderTopWidth: 0, borderColor: '#000' }}>
          <View style={{ flex: 1, borderRightWidth: 1, borderColor: '#000', padding: 3 }}>
            <Text style={[bold, { textAlign: 'center' }]}>Terms and Conditions</Text>
            <Text style={small}>{d.terms}</Text>
          </View>
          <View style={{ flex: 1, padding: 3, justifyContent: 'flex-end' }}><Text style={bold}>Customer Signature</Text></View>
        </View>
        {footer}
      </View>
    );
  }

  if (d.style === 'quickbooks') {
    return (
      <View style={{ backgroundColor: '#fff', padding: 10 }}>
        <View style={{ height: 4, width: '45%', alignSelf: 'flex-end', backgroundColor: d.accent }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
          {logo || <Text style={{ fontFamily: fonts.uiExtra, fontSize: 13, color: '#111' }}>{db.firm.name}</Text>}
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: '#111' }}>Invoice</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 14, marginTop: 6 }}>
          <View style={{ flex: 1 }}><Text style={bold}>{db.firm.name}</Text><Text style={small}>{d.address}</Text></View>
          <View style={{ flex: 1 }}>
            {d.phone ? <Text style={small}><Text style={bold}>Phone # </Text>{d.phone}</Text> : null}
            {d.email ? <Text style={small}><Text style={bold}>Email </Text>{d.email}</Text> : null}
            {d.website ? <Text style={small}><Text style={bold}>Website </Text>{d.website}</Text> : null}
          </View>
        </View>
        <View style={{ flexDirection: 'row', backgroundColor: '#f2f2f2', padding: 6, marginTop: 8, gap: 6 }}>
          <View style={{ flex: 1 }}><Text style={small}>Bill to</Text>{d.showParty ? <Text style={bold}>Taylor & Co</Text> : null}</View>
          <View style={{ flex: 1 }}><Text style={small}>Ship to</Text>{d.showParty ? <Text style={bold}>Taylor & Co</Text> : null}</View>
          <View style={{ flex: 1 }}><Text style={small}>Details</Text><Text style={bold}>INV-001</Text></View>
        </View>
        <ItemsMock d={d} head="#fff" headInk="#111" ruled={false} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, borderTopWidth: 1, borderColor: '#bbb', paddingTop: 5 }}>
          <View style={{ flex: 1 }}><Text style={small}>Customer message</Text><Text style={small}>{d.foot || 'Thank you for your business.'}</Text></View>
          <View style={{ width: 120, gap: 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={small}>Subtotal</Text><Text style={small}>{money(sub)}</Text></View>
            {tax ? <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={small}>{d.taxName || 'Tax'}</Text><Text style={small}>{money(tax)}</Text></View> : null}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderColor: '#222', marginTop: 3, paddingTop: 3 }}>
              <Text style={[bold, { fontSize: 11 }]}>Total</Text><Text style={[bold, { fontSize: 11 }]}>{money(total)}</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={{ backgroundColor: '#fff', padding: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>{logo}<Text style={[bold, { fontSize: 12 }]}>{db.firm.name}</Text>
          {[d.tagline, ...contact].filter(Boolean).slice(0, 4).map((x, i) => <Text key={i} numberOfLines={1} style={small}>{x}</Text>)}
        </View>
        <View style={{ alignItems: 'flex-end' }}><Text style={[bold, { fontSize: 11 }]}>INVOICE</Text><Text style={small}>INV-001</Text></View>
      </View>
      {d.showParty ? <View style={{ backgroundColor: '#f4f4f4', padding: 5, marginTop: 6 }}><Text style={small}>Customer</Text><Text style={bold}>Taylor & Company</Text></View> : null}
      <ItemsMock d={d} head="#fff" headInk="#555" ruled={false} />
      <Text style={[bold, { textAlign: 'right', marginTop: 6, fontSize: 11 }]}>TOTAL {money(total)}</Text>
      {footer}
    </View>
  );
}

export function InvoiceSettingsScreen() {
  const { colors } = useTheme();
  const nav = useNavigation<any>();
  const { db, money, templateFor, updateTemplate, updateFirm, setSetting } = useAppData();
  const { success, error } = useToast();
  const tpl = templateFor('invoice');
  const receiptTpl = templateFor('receipt');
  const [d, setD] = useState<InvoiceDraft | null>(() => {
    if (!db) return null;
    const style: InvoiceStyle = tpl?.style || (tpl?.boxed ? 'tally' : tpl?.accentColor ? 'quickbooks' : 'plain');
    return {
      logo: db.firm.logo, showLogo: tpl?.showLogo ?? true,
      tagline: db.firm.description || '', phone: db.firm.phone || '', whatsapp: db.firm.phone2 || '',
      email: db.firm.email || '', website: db.firm.website || '', address: db.firm.address || '',
      bank: db.firm.bankDetails || '', terms: db.firm.terms || '',
      foot: tpl?.foot || '', taxName: db.settings.taxName || 'Tax',
      style, accent: tpl?.accentColor || STYLE_ACCENT[style], title: tpl?.title || '',
      showTax: tpl?.showTax ?? true, showParty: tpl?.showParty ?? true, showServed: tpl?.showServed ?? true,
      showBatch: tpl?.showBatch ?? false, showExpiry: tpl?.showExpiry ?? false,
      code: tpl?.code || 'none', codeData: tpl?.codeData || 'verify',
    };
  });
  const [opening, setOpening] = useState(false);
  if (!db || !d) return <Guard>{null}</Guard>;
  const set = (patch: Partial<InvoiceDraft>) => setD({ ...d, ...patch });
  const coloured = d.style === 'quickbooks' || d.style === 'gst';

  function templatePatch(): Partial<PrintTemplate> {
    if (!d) return {};
    return {
      style: d.style, showLogo: d.showLogo, foot: d.foot.trim(), title: d.title.trim(),
      boxed: d.style === 'tally', accentColor: coloured ? d.accent : undefined,
      showTax: d.showTax, showParty: d.showParty, showServed: d.showServed,
      showBatch: d.showBatch, showExpiry: d.showExpiry,
      code: d.code, codeData: d.codeData, codeCaption: d.code !== 'none',
    };
  }

  function firmPatch() {
    if (!d) return {};
    return {
      description: d.tagline.trim(), phone: d.phone.trim(), phone2: d.whatsapp.trim(), email: d.email.trim(),
      website: d.website.trim(), address: d.address.trim(), bankDetails: d.bank.trim(), terms: d.terms.trim(),
    };
  }

  async function save() {
    if (!db || !d || !tpl) return;
    let logo = d.logo;
    if (logo !== db.firm.logo) {
      if (logo) logo = await keepPhoto(logo, 'logo');
      dropPhoto(db.firm.logo);
    }
    updateFirm({ logo, ...firmPatch() });
    setSetting({ taxName: d.taxName.trim() || 'Tax' });
    updateTemplate(tpl.id, {
      ...templatePatch(),
      // a template shared with receipts keeps its roll paper
      ...(tpl.id !== receiptTpl?.id ? { paper: 'A4' as const, kind: 'page' as const } : null),
    });
    success('Invoice settings saved');
    nav.goBack?.();
  }

  /** The real page, from the real print engine, with the settings as they stand on screen. */
  async function openReal() {
    if (!db || !d || !tpl) return;
    const f = firmPatch();
    const sample: DocMeta = {
      kind: 'Tax Invoice', no: 'INV-001', ts: new Date().toISOString(),
      firmName: db.firm.name, firmAddress: f.address, firmTin: db.firm.tin, firmPhone: f.phone, firmWhatsapp: f.phone2,
      firmEmail: f.email, firmWebsite: f.website, firmDescription: f.description, firmBank: f.bankDetails, firmTerms: f.terms,
      logo: d.logo, taxLabel: d.taxName, currencyName: db.settings.currencyName,
      partyName: 'Taylor & Company', partyPhone: '0700 000 000', partyAddress: 'P.O. Box 45865',
      lines: sampleLines().map((l) => ({ name: l.name, qty: l.qty, price: l.price, unit: 'pcs', batchNo: l.batch, expiry: '2027-03-31' })),
      subtotal: 20000, tax: Math.round(20000 * (db.settings.taxRate || 0) / 100),
      total: 20000 + Math.round(20000 * (db.settings.taxRate || 0) / 100), method: 'Cash', servedBy: 'Cashier',
    };
    setOpening(true);
    try {
      await printDoc(sample, money, { paper: 'A4', tpl: { ...tpl, ...templatePatch(), paper: 'A4', kind: 'page', copies: 1 } });
    } catch (e: any) {
      error(e?.message || 'The preview could not be opened.');
    } finally {
      setOpening(false);
    }
  }

  return (
    <Guard>
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <Section icon="doc" title="Template" hint="How a shared or A4 invoice is laid out.">
          <View style={{ gap: 8 }}>
            {INVOICE_STYLES.map((s) => {
              const on = d.style === s.v;
              return (
                <Pressable
                  key={s.v}
                  onPress={() => set({ style: s.v, accent: STYLE_ACCENT[s.v] })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1.4,
                    borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accentSoft : colors.surface,
                  }}
                >
                  <View style={{ width: 10, height: 34, borderRadius: 3, backgroundColor: STYLE_ACCENT[s.v] }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: on ? colors.accent : colors.ink }}>{s.l}</Text>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 2 }}>{s.sub}</Text>
                  </View>
                  {on ? <Icon name="check" size={18} color={colors.accent} /> : null}
                </Pressable>
              );
            })}
          </View>
          {coloured ? (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              {[STYLE_ACCENT[d.style], ...ACCENT_COLORS.filter((c) => c !== STYLE_ACCENT[d.style])].map((c) => (
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

        <Section icon="search" title="Preview">
          <View style={{ backgroundColor: colors.sunk, borderRadius: 12, padding: 10 }}>
            <InvoicePreview d={d} />
          </View>
          <View style={{ height: 10 }} />
          <Button label="See the real page" loading={opening} icon={<Icon name="doc" size={16} color={colors.ink} />} onPress={openReal} />
        </Section>

        <Section icon="pencil" title="Title" hint="The heading on the page, e.g. Tax invoice or Proforma invoice. Leave empty to use the document's own name.">
          <Field icon="pencil" placeholder="Invoice" value={d.title} onChangeText={(v) => set({ title: v })} />
        </Section>

        <LogoSlot uri={d.logo} onChange={(logo) => set({ logo })} hint="Shown at the top of PDF invoices and printed receipts." />

        <Section icon="owner" title="Business information" hint="Displayed at the top of every invoice.">
          <Field icon="pencil" placeholder="Business tagline" value={d.tagline} onChangeText={(v) => set({ tagline: v })} />
          <Field icon="phone" placeholder="Phone number" value={d.phone} onChangeText={(v) => set({ phone: v })} numeric />
          <Field icon="phone" placeholder="WhatsApp number" value={d.whatsapp} onChangeText={(v) => set({ whatsapp: v })} numeric />
          <Field icon="mail" placeholder="Email address" value={d.email} onChangeText={(v) => set({ email: v })} autoCapitalize="none" />
          <Field icon="cloud" placeholder="Website" value={d.website} onChangeText={(v) => set({ website: v })} autoCapitalize="none" />
          <Field icon="pin" placeholder="Business address" value={d.address} onChangeText={(v) => set({ address: v })} multiline />
        </Section>

        <Section icon="bank" title="Payment details" hint="Printed in the Bank Details box of the GST tax invoice.">
          <Field label="Bank details" placeholder={'Bank, account name and number, branch'} value={d.bank} onChangeText={(v) => set({ bank: v })} multiline />
        </Section>

        <Section icon="doc" title="Terms and footer">
          <Field label="Terms and conditions" placeholder="Goods once sold will not be taken back." value={d.terms} onChangeText={(v) => set({ terms: v })} multiline />
          <Field label="Footer message" placeholder="Thank you for your business!" value={d.foot} onChangeText={(v) => set({ foot: v })} multiline />
        </Section>

        <Section icon="pie" title="Tax">
          <Field label="Tax label" icon="receipt" value={d.taxName} onChangeText={(v) => set({ taxName: v })} />
        </Section>

        <Section icon="tools" title="Options">
          <ToggleRow bare label="Show logo" on={d.showLogo} onChange={(v) => set({ showLogo: v })} />
          <ToggleRow bare label="Show tax line" on={d.showTax} onChange={(v) => set({ showTax: v })} />
          <ToggleRow bare label="Show customer" sub="Name, phone and address of who is billed" on={d.showParty} onChange={(v) => set({ showParty: v })} />
          <ToggleRow bare label="Show who served" on={d.showServed} onChange={(v) => set({ showServed: v })} />
          <ToggleRow bare label="Batch column" sub="Which lot each item came from" on={d.showBatch} onChange={(v) => set({ showBatch: v })} />
          <ToggleRow bare label="Expiry column" sub="For perishables and pharmacy stock" on={d.showExpiry} onChange={(v) => set({ showExpiry: v })} />
          <View style={{ height: 10 }} />
          <SelectField label="QR / barcode on the invoice" value={d.code} options={CODE_CHOICES} onChange={(v) => set({ code: v })} />
          {d.code !== 'none' ? (
            <SelectField label="What it holds" value={d.codeData} options={CODE_DATA_CHOICES} onChange={(v) => set({ codeData: v })} />
          ) : null}
        </Section>

        <SaveBar onSave={save} />
      </ScrollView>
    </Guard>
  );
}
