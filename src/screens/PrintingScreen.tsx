/**
 * PRINTING — `SCREENS.printer` as redefined at reference line 19701 (the
 * earlier definition at 5844 is superseded). Four panes behind a chip row:
 * Printers, Templates, Print server, Wording; plus the default-printer card
 * at the top and the receipt preview (`samplePrint`, 5893, with the code
 * block and the POWERED_BY mark added by the wrapper at 19660).
 *
 * Every setting is persisted through AppDataContext — DB.printer,
 * DB.printers, DB.printServer, DB.templates and DB.templateFor.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, TextInput, Switch, Pressable, Alert, Platform } from 'react-native';
import { pickSystemPrinter, printOptsFor, paperOf } from '../data/printSetup';
import { printDoc, DocMeta } from '../data/docPrint';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { canFor } from '../data/perms';
import {
  Card, Cap, KV, KVNode, Button, Chip, ChipStrip, EmptyState, IconTile, Pill, Grid,
  Panel, Badge, TopTabs, SectionLabel, InfoBanner, ListRow,
} from '../components/ui';
import { Icon, IconName } from '../components/icons';
import { Sheet } from '../components/Sheet';
import { useGo } from '../nav/navigate';
import {
  PRINTER_KINDS, kindLabel, CODE_KINDS, CODE_DATA, DOC_KINDS_TPL, POWERED_BY,
} from '../data/defaults';
import type { Printer, PrintTemplate, Paper, DocKind } from '../data/types';
import { fmtDate, money0, plural } from '../data/helpers';

/** A4 templates only — the coloured bar under the shop name (PrintTemplate.accentColor). */
const ACCENT_COLORS = ['#1A7AE6', '#1DA362', '#D97706', '#DC2626', '#7C3AED', '#111827'];

function Field({ label, value, onChangeText, placeholder, numeric, multiline }: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; numeric?: boolean; multiline?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: 11 }}>
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: colors.faint, marginBottom: 5 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        keyboardType={numeric ? 'numeric' : 'default'}
        multiline={multiline}
        style={{
          backgroundColor: colors.sunk, borderRadius: 10, paddingHorizontal: 12,
          paddingVertical: multiline ? 10 : 0, height: multiline ? 84 : 42,
          fontFamily: numeric ? fonts.mono : fonts.ui, fontSize: 13.5, color: colors.ink,
          textAlignVertical: multiline ? 'top' : 'center',
        }}
      />
    </View>
  );
}

/** `printToggle(label, key)` — reference line 5887. */
function ToggleRow({ label, note, value, onChange, last }: {
  label: string; note?: string; value: boolean; onChange: (v: boolean) => void; last?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 16,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.line,
    }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>{label}</Text>
        {note ? <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 1 }}>{note}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

/**
 * An A4 template used to preview as the exact same narrow receipt-shaped card
 * as an 80mm roll — same width, same single centred column — which is not
 * what an A4 invoice looks like on paper, and not what docHtml() actually
 * produces for one (see the classic/modern layouts there). This mocks the
 * real shape instead: a wide page with a firm/invoice-details header row,
 * a ruled item grid for "classic", or a coloured bar and a grey details
 * panel for "modern".
 */
function A4Preview({ tpl }: { tpl?: PrintTemplate }) {
  const { colors } = useTheme();
  const { db } = useAppData();
  if (!db) return null;
  const s = db.sales.filter((x) => x.status !== 'void').slice(-1)[0];
  const boxed = !!tpl?.boxed;
  const accent = tpl?.accentColor;
  const partyName = s?.partyId ? db.parties.find((p) => p.id === s.partyId)?.name : undefined;
  const lines = (s?.lines || []).slice(0, 2);

  if (!s) {
    return (
      <View style={{ width: 320, alignSelf: 'center', padding: 20, alignItems: 'center' }}>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>Nothing sold yet</Text>
      </View>
    );
  }

  const money = (n: number) => money0(n);
  const row = (name: string, qty: number, price: number) => (
    <View key={name} style={{ flexDirection: 'row', marginBottom: boxed ? 0 : 5, borderBottomWidth: boxed ? 1 : 0, borderBottomColor: '#000' }}>
      <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.mono, fontSize: 9, color: '#222', padding: boxed ? 4 : 0 }}>{name}</Text>
      <Text style={{ width: 32, textAlign: 'right', fontFamily: fonts.mono, fontSize: 9, color: '#222', padding: boxed ? 4 : 0 }}>{qty}</Text>
      <Text style={{ width: 58, textAlign: 'right', fontFamily: fonts.mono, fontSize: 9, color: '#222', padding: boxed ? 4 : 0 }}>{money(qty * price)}</Text>
    </View>
  );

  return (
    <View style={{
      width: 320, alignSelf: 'center', backgroundColor: '#fff',
      borderWidth: boxed ? 1.6 : 1, borderColor: boxed ? '#000' : colors.lineHard,
      borderRadius: boxed ? 2 : 6, padding: 14,
    }}>
      {accent ? <View style={{ height: 5, borderRadius: 3, backgroundColor: accent, marginBottom: 10 }} /> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: accent || '#111' }}>{db.firm.name}</Text>
          {db.firm.address ? <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 8.5, color: '#666' }}>{db.firm.address}</Text> : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: accent ? 14 : 10.5, color: accent || '#111', textTransform: 'uppercase' }}>
            {accent ? 'Invoice' : 'Tax Invoice'}
          </Text>
          <Text style={{ fontFamily: fonts.mono, fontSize: 8.5, color: '#444' }}>{s.no}</Text>
          <Text style={{ fontFamily: fonts.mono, fontSize: 8.5, color: '#444' }}>{fmtDate(s.ts)}</Text>
        </View>
      </View>

      {partyName ? (
        <View style={{
          marginTop: 10, padding: 8, borderRadius: accent ? 6 : 0,
          backgroundColor: accent ? colors.sunk : 'transparent',
          borderWidth: boxed ? 1 : 0, borderColor: '#000',
        }}>
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 8, color: '#777', textTransform: 'uppercase', marginBottom: 1 }}>
            Customer
          </Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 9.5, color: '#222' }}>{partyName}</Text>
        </View>
      ) : null}

      <View style={{ marginTop: 10, borderWidth: boxed ? 1 : 0, borderColor: '#000' }}>
        <View style={{
          flexDirection: 'row', paddingBottom: 4, marginBottom: 4,
          borderBottomWidth: boxed ? 1 : 1.4, borderBottomColor: boxed ? '#000' : (accent || '#111'),
          padding: boxed ? 4 : 0,
        }}>
          <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 8, color: '#555', textTransform: 'uppercase' }}>
            {boxed ? 'Description of Goods' : 'Product/service'}
          </Text>
          <Text style={{ width: 32, textAlign: 'right', fontFamily: fonts.uiBold, fontSize: 8, color: '#555', textTransform: 'uppercase' }}>Qty</Text>
          <Text style={{ width: 58, textAlign: 'right', fontFamily: fonts.uiBold, fontSize: 8, color: '#555', textTransform: 'uppercase' }}>Amount</Text>
        </View>
        {lines.map((l) => row(l.name, l.qty, l.price))}
      </View>

      {boxed ? (
        <Text style={{ marginTop: 8, fontFamily: fonts.ui, fontSize: 8, color: '#333' }}>
          <Text style={{ fontFamily: fonts.uiBold }}>Amount Chargeable (in words): </Text>
          {(db.settings.currencyName || 'Amount')} {numberToWordsPreview(s.total)} Only
        </Text>
      ) : (
        <View style={{ marginTop: 8, flexDirection: 'row', justifyContent: 'flex-end' }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 11, color: '#111' }}>Total {money(s.total)}</Text>
        </View>
      )}

      {boxed ? (
        <View style={{ marginTop: 10, flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#000', paddingTop: 6 }}>
          <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 7.5, color: '#444', lineHeight: 10.5 }}>
            Declaration: We declare that this invoice shows the actual price of the goods described.
          </Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 7.5, color: '#444' }}>Authorised{'\n'}Signatory</Text>
        </View>
      ) : null}

      <Text style={{ textAlign: 'center', fontFamily: fonts.ui, fontSize: 8, color: '#999', marginTop: 10 }}>{POWERED_BY}</Text>
    </View>
  );
}

/** A short stand-in for numberToWords() in docPrint.ts — good enough for a settings-screen mock. */
function numberToWordsPreview(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/**
 * `samplePrint()` — reference 5893, wrapped at 19660. The width drives the
 * type size, the logo/header/footer come from DB.printer, and the maker's
 * mark is printed always and cannot be switched off.
 */
function ReceiptPreview({ template }: { template?: PrintTemplate } = {}) {
  const { colors } = useTheme();
  const { db, templateFor } = useAppData();
  if (!db) return null;
  const pr = db.printer;
  const tpl = template || templateFor('receipt');
  const paper: Paper = tpl?.paper || pr.width;
  if (paper === 'A4') {
    return (
      <View style={{ gap: 8 }}>
        <A4Preview tpl={tpl} />
        <Text style={{ textAlign: 'center', fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>
          A4 · {pr.copies === 1 ? 'one copy' : pr.copies + ' copies'} per bill
        </Text>
      </View>
    );
  }
  const narrow = paper === '58mm';
  const size = narrow ? 9.5 : 11.5;
  const s = db.sales.filter((x) => x.status !== 'void').slice(-1)[0];

  const showAddress = !!tpl?.showAddress || !!db.firm.address;
  const showRate = !!tpl?.showRate;
  const showUnit = !!tpl?.showUnit;
  const showBatch = !!tpl?.showBatch;
  const showExpiry = !!tpl?.showExpiry;
  const showImei = !!tpl?.showImei;
  const showWarranty = !!tpl?.showWarranty;
  const showServed = !!tpl?.showServed;
  // boxed/accentColor are A4-only (see A4Preview above) — paper here is
  // always thermal, since the A4 branch already returned.

  const sheet = (
    <View style={{
      backgroundColor: '#FFFFFF', borderRadius: 8, borderWidth: 1, borderColor: colors.lineHard,
      paddingVertical: 14, paddingHorizontal: narrow ? 12 : 16,
      width: narrow ? 210 : 280, alignSelf: 'center',
    }}>
      {!s ? (
        <Text style={{ textAlign: 'center', fontFamily: fonts.mono, fontSize: size, color: '#333' }}>
          Nothing sold yet
        </Text>
      ) : (
        <>
          {tpl?.showLogo || pr.showLogo ? (
            <Text style={{ textAlign: 'center', fontFamily: fonts.uiBold, fontSize: size + 1.5, color: '#111' }}>{db.firm.name}</Text>
          ) : null}
          {pr.header ? <Text style={{ textAlign: 'center', fontFamily: fonts.mono, fontSize: size, color: '#333' }}>{pr.header}</Text> : null}
          {showAddress ? <Text style={{ textAlign: 'center', fontFamily: fonts.mono, fontSize: size, color: '#333' }}>{db.firm.address}</Text> : null}
          {db.firm.tin ? <Text style={{ textAlign: 'center', fontFamily: fonts.mono, fontSize: size, color: '#333' }}>TIN {db.firm.tin}</Text> : null}
          <View style={{ height: 1, backgroundColor: '#CCC', marginVertical: 7 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: fonts.mono, fontSize: size, color: '#333' }}>{s.no}</Text>
            <Text style={{ fontFamily: fonts.mono, fontSize: size, color: '#333' }}>{fmtDate(s.ts)}</Text>
          </View>
          {showServed ? <Text style={{ fontFamily: fonts.mono, fontSize: size - 0.5, color: '#333' }}>Served by {db.users.find((u) => u.id === s.userId)?.name || 'Cashier'}</Text> : null}
          <View style={{ height: 1, backgroundColor: '#CCC', marginVertical: 7 }} />
          {s.lines.slice(0, 3).map((l, i) => (
            <View key={i} style={{ marginBottom: 5 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text numberOfLines={2} style={{ flex: 1, fontFamily: fonts.mono, fontSize: size, color: '#333' }}>{l.name}</Text>
                <Text style={{ fontFamily: fonts.mono, fontSize: size, color: '#333' }}>{money0(l.qty * l.price)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                {showUnit ? <Text style={{ fontFamily: fonts.mono, fontSize: size - 1, color: '#666' }}>{l.qty} {l.unit}</Text> : null}
                {showRate ? <Text style={{ fontFamily: fonts.mono, fontSize: size - 1, color: '#666' }}>{money0(l.price)} each</Text> : null}
              </View>
              {showBatch && l.batchNo ? <Text style={{ fontFamily: fonts.mono, fontSize: size - 1, color: '#666' }}>Batch {l.batchNo}</Text> : null}
              {showExpiry && (l as any).expiry ? <Text style={{ fontFamily: fonts.mono, fontSize: size - 1, color: '#666' }}>Expiry {(l as any).expiry}</Text> : null}
              {showImei && (l as any).serialNo ? <Text style={{ fontFamily: fonts.mono, fontSize: size - 1, color: '#666' }}>IMEI {(l as any).serialNo}</Text> : null}
              {showWarranty && (l as any).warranty ? <Text style={{ fontFamily: fonts.mono, fontSize: size - 1, color: '#666' }}>Warranty {(l as any).warranty}</Text> : null}
            </View>
          ))}
          <View style={{ height: 1, backgroundColor: '#CCC', marginVertical: 7 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: size, color: '#111' }}>TOTAL</Text>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: size, color: '#111' }}>{money0(s.total)}</Text>
          </View>
          {tpl?.showTax ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
              <Text style={{ fontFamily: fonts.mono, fontSize: size - 1, color: '#666' }}>Tax included</Text>
              <Text style={{ fontFamily: fonts.mono, fontSize: size - 1, color: '#666' }}>{money0(s.tax)}</Text>
            </View>
          ) : null}
          <View style={{ height: 1, backgroundColor: '#CCC', marginVertical: 7 }} />
          {String(pr.footer || '').split('\n').filter((x) => x.trim()).map((line, i) => (
            <Text key={i} style={{ textAlign: 'center', fontFamily: fonts.mono, fontSize: size, color: '#333' }}>{line.trim()}</Text>
          ))}
          {tpl && tpl.code !== 'none' ? (
            <View style={{ alignItems: 'center', marginTop: 10, gap: 3 }}>
              <View style={{ flexDirection: 'row', gap: 1.5, height: narrow ? 30 : 38, alignItems: 'flex-end' }}>
                {Array.from({ length: narrow ? 26 : 34 }).map((_, i) => (
                  <View key={i} style={{ width: i % 3 === 0 ? 2.4 : 1.2, height: '100%', backgroundColor: '#111' }} />
                ))}
              </View>
              {tpl.codeCaption ? <Text style={{ fontFamily: fonts.mono, fontSize: 8.5, color: '#666' }}>{s.no}</Text> : null}
            </View>
          ) : null}
          <Text style={{ textAlign: 'center', fontFamily: fonts.ui, fontSize: 9.5, color: '#666', marginTop: 6 }}>{POWERED_BY}</Text>
        </>
      )}
    </View>
  );

  return (
    <View style={{ gap: 8 }}>
      {sheet}
      <Text style={{ textAlign: 'center', fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>
        {paper} · {pr.copies === 1 ? 'one copy' : pr.copies + ' copies'} per bill
      </Text>
    </View>
  );
}

/* ---------------- panes ---------------- */

function PrintersPane() {
  const { colors } = useTheme();
  const { db, money, setPrinter, makeDefaultPrinter, removePrinter, addPrinter, updatePrinter } = useAppData();
  const [edit, setEdit] = useState<Partial<Printer> | null>(null);
  const [testing, setTesting] = useState(false);
  if (!db) return null;
  const pr = db.printer;

  const testPrint = async () => {
    const def = db.printers.find((x) => x.dflt) || db.printers[0];
    if (!def) { Alert.alert('Test print', 'No printer is set up on this till yet.'); return; }
    const doc: DocMeta = {
      kind: 'Test Print', no: 'TEST-0001', ts: new Date().toISOString(),
      firmName: db.firm.name, firmAddress: db.firm.address, firmPhone: db.firm.phone,
      lines: [{ name: 'Sample item', qty: 2, price: 5000, unit: 'pc' }],
      subtotal: 10000, total: 10000,
      footer: 'This confirms ' + def.name + ' (' + kindLabel(def.kind) + ', ' + paperOf(def) + ') is set up correctly.',
    };
    setTesting(true);
    try {
      await printDoc(doc, money, printOptsFor(db, 'receipt', def));
    } catch (e: any) {
      Alert.alert('Test print', e?.message || 'The test page could not be sent to ' + def.name + '.');
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    if (!edit) return;
    const name = String(edit.name || '').trim();
    if (!name) { Alert.alert('Printer', 'Give the printer a name first.'); return; }
    const body = {
      name, kind: (edit.kind || 'wifi') as Printer['kind'], width: (edit.width || '80mm') as Paper,
      address: String(edit.address || ''), port: Number(edit.port) || 9100,
      dflt: !!edit.dflt, online: edit.online !== false, note: String(edit.note || ''),
      url: edit.url || undefined,
    };
    if (edit.id) updatePrinter(edit.id, body); else addPrinter(body);
    setEdit(null);
  };

  return (
    <View>
      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
        <InfoBanner
          tone="accent"
          icon="bulb"
          text="Choose the printer this phone should use. Tap Use this printer to make it the default."
        />
        <View style={{ height: 12 }} />
        <SectionLabel>Printers on this till</SectionLabel>
        <Panel flush>
          {db.printers.map((p, i) => (
            <View
              key={p.id}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 15,
                minHeight: 66,
                borderBottomWidth: i === db.printers.length - 1 ? 0 : 1, borderBottomColor: colors.line,
              }}
            >
              <View style={{
                width: 42, height: 42, borderRadius: 14,
                backgroundColor: p.online ? colors.goodSoft : colors.sunk,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon name="print" size={20} color={p.online ? colors.good : colors.faint} />
              </View>
              <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => setEdit({ ...p })}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{p.name}</Text>
                  {p.dflt ? <Badge label="Default" tone="accent" /> : null}
                </View>
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                  {kindLabel(p.kind)} · {p.width}{p.address ? ' · ' + p.address + (p.port ? ':' + p.port : '') : ''}
                </Text>
              </Pressable>
              {p.dflt
                ? <Icon name="check" size={20} color={colors.good} />
                : <Button size="sm" label="Use this printer" onPress={() => makeDefaultPrinter(p.id)} />}
            </View>
          ))}
          {!db.printers.length ? (
            <EmptyState
              icon="print"
              title="No printers yet"
              subtitle="Add a Bluetooth or network thermal printer to print receipts."
            />
          ) : null}
        </Panel>
        <View style={{ flexDirection: 'row', gap: 9, marginTop: 10 }}>
          <View style={{ flex: 1 }}>
            <Button size="sm" label="Add a printer" icon={<Icon name="plus" size={15} color={colors.ink} />}
              onPress={() => setEdit({ kind: 'wifi', width: '80mm', port: 9100, online: true })} />
          </View>
          <View style={{ flex: 1 }}>
            <Button size="sm" label="Test print" loading={testing} onPress={testPrint} />
          </View>
        </View>
        <Text style={{ fontFamily: fonts.ui, fontSize: 11, lineHeight: 16, color: colors.faint, marginTop: 9 }}>
          Tap “Use this printer” once. It becomes the printer used by every Print button on this phone.
        </Text>
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <Cap style={{ marginBottom: 8 }}>Behaviour</Cap>
        <Card>
          <ToggleRow label="Print automatically after a sale" value={pr.autoPrint} onChange={(v) => setPrinter({ autoPrint: v })} />
          <ToggleRow label="Kick the cash drawer open on a cash sale" value={pr.openDrawer} onChange={(v) => setPrinter({ openDrawer: v })} />
          <ToggleRow label="Print the business name at the top" value={pr.showLogo} onChange={(v) => setPrinter({ showLogo: v })} last />
        </Card>

        <Cap style={{ marginBottom: 8, marginTop: 14 }}>Defaults</Cap>
        <Card style={{ paddingVertical: 11, paddingHorizontal: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.line }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>Copies per bill</Text>
              <Text style={{ fontFamily: fonts.monoSemi, fontSize: 15, color: colors.accent, marginTop: 1 }}>{pr.copies}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Button size="sm" label="−" onPress={() => setPrinter({ copies: Math.max(1, pr.copies - 1) })} />
              <Button size="sm" label="+" onPress={() => setPrinter({ copies: Math.min(5, pr.copies + 1) })} />
            </View>
          </View>
          <KVNode label="Receipts print at" last>
            <View style={{ flexDirection: 'row', gap: 7 }}>
              {(['58mm', '80mm'] as Paper[]).map((w) => (
                <Chip key={w} label={w} on={pr.width === w} onPress={() => setPrinter({ width: w })} />
              ))}
            </View>
          </KVNode>
        </Card>
      </View>

      <Sheet visible={!!edit} title={edit?.id ? 'Edit printer' : 'Add a printer'} icon="print" onClose={() => setEdit(null)}
        footer={
          <View style={{ flexDirection: 'row', gap: 9 }}>
            {edit?.id && db.printers.length > 1 ? (
              <View style={{ flex: 1 }}>
                <Button variant="dngr" label="Remove" onPress={() => { removePrinter(edit.id!); setEdit(null); }} />
              </View>
            ) : null}
            <View style={{ flex: 2 }}><Button variant="pri" label="Save printer" onPress={save} /></View>
          </View>
        }
      >
        {edit ? (
          <View>
            <Field label="What to call it" value={String(edit.name || '')} onChangeText={(v) => setEdit({ ...edit, name: v })} placeholder="What this printer is called" />
            <Cap style={{ marginBottom: 8 }}>How it connects</Cap>
            <View style={{ gap: 7, marginBottom: 12 }}>
              {PRINTER_KINDS.map((k) => (
                <Pressable
                  key={k.v}
                  onPress={() => setEdit({ ...edit, kind: k.v })}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 10,
                    borderWidth: 1, borderColor: edit.kind === k.v ? colors.accent : colors.line,
                    backgroundColor: edit.kind === k.v ? colors.accentSoft : colors.surface,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>{k.l}</Text>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>{k.n}</Text>
                  </View>
                  {edit.kind === k.v ? <Icon name="check" size={16} color={colors.accent} /> : null}
                </Pressable>
              ))}
            </View>
            <Cap style={{ marginBottom: 8 }}>Paper</Cap>
            <View style={{ flexDirection: 'row', gap: 7, marginBottom: 12 }}>
              {(['58mm', '80mm', 'A4'] as Paper[]).map((w) => (
                <Chip key={w} label={w} on={edit.width === w} onPress={() => setEdit({ ...edit, width: w })} />
              ))}
            </View>
            {edit.kind === 'wifi' || edit.kind === 'server' ? (
              <>
                <Field label="Host or IP" value={String(edit.address || '')} onChangeText={(v) => setEdit({ ...edit, address: v })} placeholder="192.168.1.44" />
                <Field label="Port" value={String(edit.port ?? 9100)} numeric onChangeText={(v) => setEdit({ ...edit, port: Number(v) || 0 })} />
              </>
            ) : null}
            {Platform.OS === 'ios' ? (
              <Pressable
                onPress={async () => { const p = await pickSystemPrinter(); if (p) setEdit({ ...edit, url: p.url, name: edit.name || p.name }); }}
                style={{ paddingVertical: 12, marginBottom: 12 }}
              >
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 13.5, color: colors.accent }}>
                  {edit.url ? 'AirPrint printer chosen · change' : 'Choose the AirPrint printer, so it prints without asking'}
                </Text>
              </Pressable>
            ) : null}
            <Field label="Note" value={String(edit.note || '')} onChangeText={(v) => setEdit({ ...edit, note: v })} placeholder="Where it sits" />
            <ToggleRow label="Make this the default" value={!!edit.dflt} onChange={(v) => setEdit({ ...edit, dflt: v })} last />
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

function TemplatesPane() {
  const { colors } = useTheme();
  const { db, updateTemplate, setTemplateFor, templateFor } = useAppData();
  const [edit, setEdit] = useState<PrintTemplate | null>(null);
  const [pick, setPick] = useState<DocKind | null>(null);
  if (!db) return null;

  const presets: Array<{ id: string; name: string; blurb: string; kind: 'thermal' | 'page'; icon: IconName; swatch?: string }> = [
    { id: 'pos', name: 'POS receipt', blurb: 'Fast sales, clear totals, who served — compact for the till', kind: 'thermal', icon: 'print' },
    { id: 'tally', name: 'Tally', blurb: 'Boxed ledger grid with batch and expiry per line', kind: 'page', icon: 'doc' },
    { id: 'quickbooks', name: 'QuickBooks', blurb: 'Clean invoice with a coloured accent bar', kind: 'page', icon: 'doc', swatch: '#1DA362' },
    { id: 'compact', name: 'Compact', blurb: 'Slim 58mm format for busy counters', kind: 'thermal', icon: 'print' },
  ];

  const applyPreset = (preset: typeof presets[number]) => {
    const source = db.templates.find((t) => t.paper === (preset.id === 'compact' ? '58mm' : preset.id === 'pos' ? '80mm' : 'A4') && t.name.toLowerCase().includes(preset.name.toLowerCase().split(' ')[0].toLowerCase()))
      || db.templates.find((t) => t.paper === (preset.id === 'compact' ? '58mm' : preset.id === 'pos' ? '80mm' : 'A4'))
      || db.templates[0];
    // Batch and expiry matter for a stock-heavy paper trail (Tally) and less
    // for a fast counter sale (POS) or a service-style invoice (QuickBooks) —
    // still one tap away in "What it shows" either way.
    setEdit({
      ...source, name: preset.name,
      paper: preset.id === 'compact' ? '58mm' : preset.id === 'pos' ? '80mm' : 'A4', kind: preset.kind,
      showLogo: true, showTax: preset.id !== 'compact', showParty: preset.id !== 'compact',
      showServed: preset.id !== 'compact', showSaved: preset.id === 'pos',
      showAddress: preset.id !== 'compact', showBatch: preset.id === 'tally', showExpiry: preset.id === 'tally',
      showRate: true, showUnit: true,
      boxed: preset.id === 'tally',
      accentColor: preset.id === 'quickbooks' ? '#1DA362' : undefined,
    });
  };

  return (
    <View>
      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
        <InfoBanner
          tone="accent"
          icon="bulb"
          text="Tap any template to preview it and change what appears on the printed document."
        />
        <View style={{ height: 12 }} />
        <Cap style={{ marginBottom: 8 }}>Popular templates</Cap>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {presets.map((preset) => (
            <Pressable
              key={preset.id}
              onPress={() => applyPreset(preset)}
              style={({ pressed }) => ({
                width: '48%', backgroundColor: colors.surface, borderRadius: 14,
                borderWidth: 1, borderColor: colors.line, padding: 12,
                minHeight: 108, opacity: pressed ? 0.85 : 1,
              })}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <IconTile icon={preset.icon} bg={preset.swatch ? preset.swatch + '22' : colors.sunk} color={preset.swatch || colors.rail} size={30} round={9} iconSize={15} />
                <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>{preset.name}</Text>
                {preset.swatch ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: preset.swatch }} /> : null}
              </View>
              <Text style={{ fontFamily: fonts.ui, fontSize: 11, lineHeight: 15, color: colors.faint }}>{preset.blurb}</Text>
              <Text style={{ marginTop: 6, fontFamily: fonts.uiSemi, fontSize: 10, letterSpacing: 0.4, color: colors.faint, textTransform: 'uppercase' }}>
                {preset.kind === 'thermal' ? 'Roll printer' : 'A4 page'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <Cap style={{ marginBottom: 8 }}>Templates</Cap>
        <Card>
          {db.templates.map((t, i) => {
            const code = CODE_KINDS.find((c) => c[0] === t.code)?.[1] || 'Nothing';
            const style = [t.boxed ? 'Boxed' : '', t.accentColor ? 'Accent' : ''].filter(Boolean).join(' · ');
            return (
              <Pressable
                key={t.id}
                onPress={() => setEdit({ ...t })}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 16,
                  borderBottomWidth: i === db.templates.length - 1 ? 0 : 1, borderBottomColor: colors.line,
                }}
              >
                <IconTile icon="doc" bg={t.accentColor ? t.accentColor + '22' : colors.sunk} color={t.accentColor || colors.rail} size={32} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{t.name}</Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 1 }}>
                    {t.paper} · {code}{style ? ' · ' + style : ''}
                  </Text>
                </View>
                {t.accentColor ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.accentColor, marginRight: 2 }} /> : null}
                <Icon name="chev" size={14} color={colors.faint} />
              </Pressable>
            );
          })}
        </Card>
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <Cap style={{ marginBottom: 8 }}>Which template each document uses</Cap>
        <Card>
          {DOC_KINDS_TPL.map(([k, label], i) => {
            const t = templateFor(k);
            return (
              <Pressable
                key={k}
                onPress={() => setPick(k)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 16,
                  borderBottomWidth: i === DOC_KINDS_TPL.length - 1 ? 0 : 1, borderBottomColor: colors.line,
                }}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{label}</Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 1 }}>{t?.name || '—'}</Text>
                </View>
                <Icon name="chev" size={14} color={colors.faint} />
              </Pressable>
            );
          })}
        </Card>
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <Cap style={{ marginBottom: 8 }}>Live preview</Cap>
        <ReceiptPreview />
      </View>

      <Sheet visible={!!pick} title="Which template?" icon="doc" onClose={() => setPick(null)}>
        {db.templates.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => { if (pick) setTemplateFor(pick, t.id); setPick(null); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12 }}
          >
            <IconTile icon="doc" bg={colors.sunk} color={colors.rail} size={32} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{t.name}</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>{t.paper}</Text>
            </View>
            {pick && db.templateFor[pick] === t.id ? <Icon name="check" size={17} color={colors.good} /> : null}
          </Pressable>
        ))}
      </Sheet>

      <Sheet
        visible={!!edit} title={edit?.name || 'Template'} onClose={() => setEdit(null)}
        icon="doc"
        footer={<Button variant="pri" label="Save template" onPress={() => { if (edit) updateTemplate(edit.id, edit); setEdit(null); }} />}
      >
        {edit ? (
          <View>
            <Cap style={{ marginBottom: 8 }}>Live preview</Cap>
            <Card style={{ marginBottom: 14, paddingVertical: 14, backgroundColor: colors.sunk }}>
              <ReceiptPreview template={edit} />
              <Text style={{ textAlign: 'center', fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 8 }}>
                This preview updates as you change the template.
              </Text>
            </Card>
            <Field label="What to call it" value={edit.name} onChangeText={(v) => setEdit({ ...edit, name: v })} />
            <Cap style={{ marginBottom: 8 }}>Paper</Cap>
            <View style={{ flexDirection: 'row', gap: 7, marginBottom: 12 }}>
              {(['58mm', '80mm', 'A4'] as Paper[]).map((w) => (
                <Chip key={w} label={w} on={edit.paper === w} onPress={() => setEdit({ ...edit, paper: w, kind: w === 'A4' ? 'page' : 'thermal' })} />
              ))}
            </View>
            <Cap style={{ marginBottom: 8 }}>Shop and sale details</Cap>
            <Card style={{ marginBottom: 12 }}>
              <ToggleRow label="Business name" value={edit.showLogo} onChange={(v) => setEdit({ ...edit, showLogo: v })} />
              <ToggleRow label="Address" value={edit.showAddress ?? false} onChange={(v) => setEdit({ ...edit, showAddress: v })} />
              <ToggleRow label="Tax line" value={edit.showTax} onChange={(v) => setEdit({ ...edit, showTax: v })} />
              <ToggleRow label="Salesperson (who served)" value={edit.showServed} onChange={(v) => setEdit({ ...edit, showServed: v })} />
              <ToggleRow label="Customer" value={edit.showParty} onChange={(v) => setEdit({ ...edit, showParty: v })} />
              <ToggleRow label="Saved / posted info" value={edit.showSaved} onChange={(v) => setEdit({ ...edit, showSaved: v })} last />
            </Card>
            <Cap style={{ marginBottom: 8 }}>Per item</Cap>
            <Card style={{ marginBottom: 12 }}>
              <ToggleRow label="Item unit" value={edit.showUnit ?? true} onChange={(v) => setEdit({ ...edit, showUnit: v })} />
              <ToggleRow label="Rate / price" value={edit.showRate ?? true} onChange={(v) => setEdit({ ...edit, showRate: v })} />
              <ToggleRow label="Batch number" note="Which lot an item shipped in" value={edit.showBatch ?? false} onChange={(v) => setEdit({ ...edit, showBatch: v })} />
              <ToggleRow label="Expiry date" note="For perishables and pharmacy stock" value={edit.showExpiry ?? false} onChange={(v) => setEdit({ ...edit, showExpiry: v })} />
              <ToggleRow label="IMEI / serial" value={edit.showImei ?? false} onChange={(v) => setEdit({ ...edit, showImei: v })} last />
            </Card>
            {edit.paper === 'A4' ? (
              <>
                <Cap style={{ marginBottom: 8 }}>Style</Cap>
                <Card style={{ marginBottom: 12 }}>
                  <ToggleRow
                    label="Boxed, ledger-style"
                    note="Ruled borders around every block, like a classic printed account book"
                    value={!!edit.boxed}
                    onChange={(v) => setEdit({ ...edit, boxed: v })}
                    last
                  />
                </Card>
                <Cap style={{ marginBottom: 8 }}>Accent colour</Cap>
                <View style={{ flexDirection: 'row', gap: 9, marginBottom: 12 }}>
                  <Pressable
                    onPress={() => setEdit({ ...edit, accentColor: undefined })}
                    style={{
                      width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
                      borderWidth: 1.5, borderColor: !edit.accentColor ? colors.ink : colors.line, backgroundColor: colors.surface,
                    }}
                  >
                    <Icon name="x" size={14} color={colors.faint} />
                  </Pressable>
                  {ACCENT_COLORS.map((c) => (
                    <Pressable
                      key={c}
                      onPress={() => setEdit({ ...edit, accentColor: c })}
                      style={{
                        width: 34, height: 34, borderRadius: 17, backgroundColor: c,
                        borderWidth: edit.accentColor === c ? 2.5 : 0, borderColor: colors.ink,
                      }}
                    />
                  ))}
                </View>
              </>
            ) : null}
            <Cap style={{ marginBottom: 8 }}>Code at the foot</Cap>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>
              {CODE_KINDS.map(([v, l]) => (
                <Chip key={v} label={l} on={edit.code === v} onPress={() => setEdit({ ...edit, code: v })} />
              ))}
            </View>
            {edit.code !== 'none' ? (
              <>
                <Cap style={{ marginBottom: 8 }}>What the code carries</Cap>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>
                  {CODE_DATA.map(([v, l]) => (
                    <Chip key={v} label={l} on={edit.codeData === v} onPress={() => setEdit({ ...edit, codeData: v })} />
                  ))}
                </View>
                <Card style={{ marginBottom: 12 }}>
                  <ToggleRow label="Print the code as text underneath" value={edit.codeCaption} onChange={(v) => setEdit({ ...edit, codeCaption: v })} last />
                </Card>
              </>
            ) : null}
            <Field label="Extra line at the top" value={edit.head} onChangeText={(v) => setEdit({ ...edit, head: v })} />
            <Field label="Footer" value={edit.foot} onChangeText={(v) => setEdit({ ...edit, foot: v })} multiline />
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

function ServerPane() {
  const { colors } = useTheme();
  const { db, setPrintServer } = useAppData();
  const [draft, setDraft] = useState(() => db?.printServer);
  const [testing, setTesting] = useState(false);
  if (!db || !draft) return null;
  const s = db.printServer;
  const url = (draft.secure ? 'https://' : 'http://') + (draft.host || '') + (draft.port ? ':' + draft.port : '') + (draft.path || '');
  const tone = s.status === 'ok' ? 'g' : s.status === 'bad' ? 'd' : 'w';

  // A real reachability check, not a canned message: this used to save the
  // draft and describe what *would* happen without ever actually asking the
  // server anything, so "Not checked" could sit there forever looking tested.
  const test = async () => {
    setPrintServer({ ...draft });
    if (!draft.host) { Alert.alert('Print server', 'Give it a host or IP first.'); return; }
    setTesting(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, draft.timeout || 8) * 1000);
    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      const ok = res.ok;
      setPrintServer({ status: ok ? 'ok' : 'bad', lastSeen: new Date().toISOString() });
      Alert.alert('Print server', ok ? url + ' answered.' : url + ' answered with an error (' + res.status + ').');
    } catch (e: any) {
      setPrintServer({ status: 'bad', lastSeen: new Date().toISOString() });
      Alert.alert('Print server', 'Could not reach ' + url + (e?.name === 'AbortError' ? ' — no answer within ' + draft.timeout + 's.' : '.'));
    } finally {
      clearTimeout(timer);
      setTesting(false);
    }
  };

  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
      <Card style={{ paddingVertical: 13, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 11 }}>
        <IconTile icon="cloud" bg={s.on ? colors.goodSoft : colors.warnSoft} color={s.on ? colors.good : colors.warn} size={36} round={9} iconSize={18} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{s.name || 'Print server'}</Text>
          <Text numberOfLines={2} style={{ fontFamily: fonts.mono, fontSize: 10.5, color: colors.faint, marginTop: 1 }}>{url}</Text>
        </View>
        <Pill tone={tone as any} label={s.status === 'ok' ? 'Reachable' : s.status === 'bad' ? 'No answer' : 'Not checked'} />
      </Card>

      <Card style={{ marginTop: 9 }}>
        <ToggleRow label="Send jobs through the server" value={s.on} onChange={(v) => { setDraft({ ...draft, on: v }); setPrintServer({ on: v }); }} last />
      </Card>

      <Card style={{ marginTop: 9, paddingVertical: 12, paddingHorizontal: 14 }}>
        <Field label="What to call it" value={draft.name} onChangeText={(v) => setDraft({ ...draft, name: v })} placeholder="Shop print server" />
        <Grid cols={2}>
          <Field label="Host or IP" value={draft.host} onChangeText={(v) => setDraft({ ...draft, host: v })} placeholder="192.168.1.10" />
          <Field label="Port" value={String(draft.port)} numeric onChangeText={(v) => setDraft({ ...draft, port: Number(v) || 0 })} />
        </Grid>
        <Field label="Path" value={draft.path} onChangeText={(v) => setDraft({ ...draft, path: v })} placeholder="/print" />
        <Field label="Access key" value={draft.key} onChangeText={(v) => setDraft({ ...draft, key: v })} placeholder="Leave empty if none" />
        <Field label="Give up after (seconds)" value={String(draft.timeout)} numeric onChangeText={(v) => setDraft({ ...draft, timeout: Number(v) || 0 })} />

        <Cap style={{ marginBottom: 8 }}>If it fails</Cap>
        <View style={{ gap: 7, marginBottom: 12 }}>
          {([['retry', 'Hold the job and retry'], ['local', 'Fall back to this phone'], ['drop', 'Drop it and tell me']] as const).map(([v, l]) => (
            <Pressable
              key={v}
              onPress={() => setDraft({ ...draft, queue: v })}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 10, borderWidth: 1,
                borderColor: draft.queue === v ? colors.accent : colors.line,
                backgroundColor: draft.queue === v ? colors.accentSoft : colors.surface,
              }}
            >
              <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>{l}</Text>
              {draft.queue === v ? <Icon name="check" size={16} color={colors.accent} /> : null}
            </Pressable>
          ))}
        </View>

        <Card style={{ marginBottom: 12 }}>
          <ToggleRow label="Use HTTPS" note="Only if the server has a certificate" value={draft.secure} onChange={(v) => setDraft({ ...draft, secure: v })} last />
        </Card>

        <View style={{ flexDirection: 'row', gap: 9 }}>
          <View style={{ flex: 1 }}><Button size="sm" label="Save" onPress={() => { setPrintServer({ ...draft }); Alert.alert('Print server', 'Saved.'); }} /></View>
          <View style={{ flex: 1 }}><Button size="sm" variant="pri" label="Test connection" loading={testing} onPress={test} /></View>
        </View>
      </Card>

      {s.lastSeen ? (
        <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 8 }}>Last answered {fmtDate(s.lastSeen)}</Text>
      ) : null}
      <Text style={{ fontFamily: fonts.ui, fontSize: 11, lineHeight: 16, color: colors.faint, marginTop: 8 }}>
        “Test connection” only checks that this address answers. Sending print jobs
        through it is not built yet — every printer still prints straight from this device.
      </Text>
    </View>
  );
}

function WordingPane() {
  const { colors } = useTheme();
  const { db, setPrinter } = useAppData();
  const [header, setHeader] = useState(db?.printer.header || '');
  const [footer, setFooter] = useState(db?.printer.footer || '');
  if (!db) return null;

  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
      <Cap style={{ marginBottom: 8 }}>Wording on the receipt</Cap>
      <Card style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
        <Field label="Extra line at the top" value={header} onChangeText={setHeader} placeholder="Branch, phone, anything" />
        <Field label="Footer" value={footer} onChangeText={setFooter} multiline />
        <Button size="sm" variant="pri" label="Save wording" onPress={() => { setPrinter({ header, footer }); Alert.alert('Wording', 'Saved.'); }} />
      </Card>

      <Card style={{ marginTop: 10, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: colors.sunk, borderColor: 'transparent' }}>
        <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>Every printed page ends with</Text>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink, marginTop: 3, letterSpacing: 0.4 }}>{POWERED_BY}</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 5 }}>
          This line is part of the product and cannot be turned off.
        </Text>
      </Card>

      <Cap style={{ marginTop: 14, marginBottom: 8 }}>Preview</Cap>
      <ReceiptPreview />
    </View>
  );
}

/* ---------------- the screen ---------------- */

export default function PrintingScreen() {
  const { colors } = useTheme();
  const { db } = useAppData();
  const go = useGo();

  if (!db) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (!canFor(db.session.role, 'settings')) {
    return <EmptyState icon="print" title="Not available" subtitle="Your role does not include settings." />;
  }

  const dp = db.printers.find((p) => p.dflt) || db.printers[0];
  const s = db.printServer;
  const wordingSet = !!(db.printer.header || db.printer.footer);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>
        <Card style={{ paddingVertical: 13, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 11 }}>
          <IconTile icon="print" bg={colors.goodSoft} color={colors.good} size={36} round={9} iconSize={18} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 16, color: colors.ink }}>{dp?.name || 'No printer'}</Text>
            <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
              {dp ? 'Default · ' + kindLabel(dp.kind) + ' · ' + dp.width : 'Add one below'}
            </Text>
          </View>
          <Badge tone={dp?.online ? 'good' : 'warn'} label={dp?.online ? 'Ready' : 'Offline'} />
        </Card>
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
        <SectionLabel>Set up</SectionLabel>
        <Panel flush>
          <ListRow
            icon="print" tone="accent"
            title="Printers"
            subtitle={db.printers.length ? plural(db.printers.length, 'printer') + (dp ? ' · default ' + dp.name : '') : 'None added yet'}
            onPress={() => go('PrintingPrinters')}
          />
          <ListRow
            icon="doc" tone="accent"
            title="Templates"
            subtitle={plural(db.templates.length, 'template') + ' — what a receipt or invoice shows'}
            onPress={() => go('PrintingTemplates')}
          />
          <ListRow
            icon="cloud" tone={s.on ? 'good' : 'neutral'}
            title="Print server"
            subtitle={s.on ? 'On · ' + (s.status === 'ok' ? 'reachable' : s.status === 'bad' ? 'not answering' : 'not checked') : 'Off — every printer prints from this device'}
            onPress={() => go('PrintingServer')}
          />
          <ListRow
            icon="pencil" tone="accent"
            title="Wording"
            subtitle={wordingSet ? 'A header or footer line is set' : 'Nothing extra printed yet'}
            onPress={() => go('PrintingWording')}
            last
          />
        </Panel>
      </View>
    </ScrollView>
  );
}

/* ---------------- the four destinations — each its own screen, not a tab ---------------- */

function paneShell(Pane: () => React.ReactElement | null) {
  return function Shell() {
    const { colors } = useTheme();
    const { db } = useAppData();
    if (!db) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
    if (!canFor(db.session.role, 'settings')) {
      return <EmptyState icon="print" title="Not available" subtitle="Your role does not include settings." />;
    }
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <Pane />
      </ScrollView>
    );
  };
}

export const PrintersScreen = paneShell(PrintersPane);
export const PrintingTemplatesScreen = paneShell(TemplatesPane);
export const PrintServerScreen = paneShell(ServerPane);
export const PrintWordingScreen = paneShell(WordingPane);
