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
import { View, Text, ScrollView, TextInput, Switch, Pressable, Alert } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { canFor } from '../data/perms';
import {
  Card, Cap, KV, KVNode, Button, Chip, ChipStrip, EmptyState, IconTile, Pill, Grid,
  Panel, Badge, TopTabs, SectionLabel, InfoBanner,
} from '../components/ui';
import { Icon } from '../components/icons';
import { Sheet } from '../components/Sheet';
import {
  PRINTER_KINDS, kindLabel, CODE_KINDS, CODE_DATA, DOC_KINDS_TPL, POWERED_BY,
} from '../data/defaults';
import type { Printer, PrintTemplate, Paper, DocKind } from '../data/types';
import { fmtDate, money0 } from '../data/helpers';

const TABS: [string, string][] = [
  ['printers', 'Printers'], ['templates', 'Templates'],
  ['server', 'Print server'], ['wording', 'Wording'],
];

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
 * `samplePrint()` — reference 5893, wrapped at 19660. The width drives the
 * type size, the logo/header/footer come from DB.printer, and the maker's
 * mark is printed always and cannot be switched off.
 */
function ReceiptPreview() {
  const { colors } = useTheme();
  const { db, templateFor } = useAppData();
  if (!db) return null;
  const pr = db.printer;
  const tpl = templateFor('receipt');
  const paper: Paper = tpl?.paper || pr.width;
  const narrow = paper === '58mm';
  const size = narrow ? 10 : 11.5;
  const s = db.sales.filter((x) => x.status !== 'void').slice(-1)[0];

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
          {pr.showLogo ? (
            <Text style={{ textAlign: 'center', fontFamily: fonts.uiBold, fontSize: size + 1.5, color: '#111' }}>{db.firm.name}</Text>
          ) : null}
          {pr.header ? (
            <Text style={{ textAlign: 'center', fontFamily: fonts.mono, fontSize: size, color: '#333' }}>{pr.header}</Text>
          ) : null}
          <Text style={{ textAlign: 'center', fontFamily: fonts.mono, fontSize: size, color: '#333' }}>{db.firm.address}</Text>
          <Text style={{ textAlign: 'center', fontFamily: fonts.mono, fontSize: size, color: '#333' }}>TIN {db.firm.tin}</Text>
          <View style={{ height: 1, backgroundColor: '#CCC', marginVertical: 7 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: fonts.mono, fontSize: size, color: '#333' }}>{s.no}</Text>
            <Text style={{ fontFamily: fonts.mono, fontSize: size, color: '#333' }}>{fmtDate(s.ts)}</Text>
          </View>
          <View style={{ height: 1, backgroundColor: '#CCC', marginVertical: 7 }} />
          {s.lines.slice(0, 3).map((l, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.mono, fontSize: size, color: '#333' }}>{l.name}</Text>
              <Text style={{ fontFamily: fonts.mono, fontSize: size, color: '#333' }}>{money0(l.qty * l.price)}</Text>
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
              <View style={{
                flexDirection: 'row', gap: 1.5, height: narrow ? 30 : 38, alignItems: 'flex-end',
              }}>
                {/* a stand-in for the Code 128 / QR block the printer draws */}
                {Array.from({ length: narrow ? 26 : 34 }).map((_, i) => (
                  <View key={i} style={{ width: i % 3 === 0 ? 2.4 : 1.2, height: '100%', backgroundColor: '#111' }} />
                ))}
              </View>
              {tpl.codeCaption ? (
                <Text style={{ fontFamily: fonts.mono, fontSize: 8.5, color: '#666' }}>{s.no}</Text>
              ) : null}
            </View>
          ) : null}
          <Text style={{ textAlign: 'center', fontFamily: fonts.ui, fontSize: 9.5, color: '#666', marginTop: 6 }}>
            {POWERED_BY}
          </Text>
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
  const { db, setPrinter, makeDefaultPrinter, removePrinter, addPrinter, updatePrinter } = useAppData();
  const [edit, setEdit] = useState<Partial<Printer> | null>(null);
  if (!db) return null;
  const pr = db.printer;

  const save = () => {
    if (!edit) return;
    const name = String(edit.name || '').trim();
    if (!name) { Alert.alert('Printer', 'Give the printer a name first.'); return; }
    const body = {
      name, kind: (edit.kind || 'wifi') as Printer['kind'], width: (edit.width || '80mm') as Paper,
      address: String(edit.address || ''), port: Number(edit.port) || 9100,
      dflt: !!edit.dflt, online: edit.online !== false, note: String(edit.note || ''),
    };
    if (edit.id) updatePrinter(edit.id, body); else addPrinter(body);
    setEdit(null);
  };

  return (
    <View>
      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
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
                : <Button size="sm" label="Make default" onPress={() => makeDefaultPrinter(p.id)} />}
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
            <Button
              size="sm" label="Test print"
              onPress={() => {
                const def = db.printers.find((x) => x.dflt) || db.printers[0];
                Alert.alert('Test print', def
                  ? 'A test page has been queued to ' + def.name + ' (' + kindLabel(def.kind) + ', ' + def.width + ').'
                  : 'No printer is set up on this till yet.');
              }}
            />
          </View>
        </View>
        <Text style={{ fontFamily: fonts.ui, fontSize: 11, lineHeight: 16, color: colors.faint, marginTop: 9 }}>
          The default is what every Print button uses. A printer on the server prints even when
          this phone is not the one holding it.
        </Text>
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <Cap style={{ marginBottom: 8 }}>Behaviour</Cap>
        <Card>
          <ToggleRow label="Print automatically after a sale" value={pr.autoPrint} onChange={(v) => setPrinter({ autoPrint: v })} />
          <ToggleRow label="Kick the cash drawer open on a cash sale" value={pr.openDrawer} onChange={(v) => setPrinter({ openDrawer: v })} />
          <ToggleRow label="Print the business name at the top" value={pr.showLogo} onChange={(v) => setPrinter({ showLogo: v })} last />
        </Card>

        <Card style={{ marginTop: 9, paddingVertical: 11, paddingHorizontal: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>Copies per bill</Text>
              <Text style={{ fontFamily: fonts.monoSemi, fontSize: 15, color: colors.ink, marginTop: 1 }}>{pr.copies}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Button size="sm" label="−" onPress={() => setPrinter({ copies: Math.max(1, pr.copies - 1) })} />
              <Button size="sm" label="+" onPress={() => setPrinter({ copies: Math.min(5, pr.copies + 1) })} />
            </View>
          </View>
        </Card>

        <View style={{ marginTop: 14 }}>
          <Cap style={{ marginBottom: 8 }}>Paper width</Cap>
          <Card style={{ paddingVertical: 11, paddingHorizontal: 16 }}>
            <KVNode label="Receipts print at" last>
              <View style={{ flexDirection: 'row', gap: 7 }}>
                {(['58mm', '80mm'] as Paper[]).map((w) => (
                  <Chip key={w} label={w} on={pr.width === w} onPress={() => setPrinter({ width: w })} />
                ))}
              </View>
            </KVNode>
          </Card>
        </View>
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
            <Field label="What to call it" value={String(edit.name || '')} onChangeText={(v) => setEdit({ ...edit, name: v })} placeholder="Front counter" />
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

  return (
    <View>
      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
        <Cap style={{ marginBottom: 8 }}>Templates</Cap>
        <Card>
          {db.templates.map((t, i) => {
            const code = CODE_KINDS.find((c) => c[0] === t.code)?.[1] || 'Nothing';
            return (
              <Pressable
                key={t.id}
                onPress={() => setEdit({ ...t })}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 16,
                  borderBottomWidth: i === db.templates.length - 1 ? 0 : 1, borderBottomColor: colors.line,
                }}
              >
                <IconTile icon="doc" bg={colors.sunk} color={colors.rail} size={32} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{t.name}</Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 1 }}>{t.paper} · {code}</Text>
                </View>
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
        <Cap style={{ marginBottom: 8 }}>Preview</Cap>
        <ReceiptPreview />
      </View>

      {/* pick the template one document kind uses */}
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

      {/* edit one template */}
      <Sheet
        visible={!!edit} title={edit?.name || 'Template'} onClose={() => setEdit(null)}
        icon="doc"
        footer={<Button variant="pri" label="Save template" onPress={() => { if (edit) updateTemplate(edit.id, edit); setEdit(null); }} />}
      >
        {edit ? (
          <View>
            <Field label="What to call it" value={edit.name} onChangeText={(v) => setEdit({ ...edit, name: v })} />
            <Cap style={{ marginBottom: 8 }}>Paper</Cap>
            <View style={{ flexDirection: 'row', gap: 7, marginBottom: 12 }}>
              {(['58mm', '80mm', 'A4'] as Paper[]).map((w) => (
                <Chip key={w} label={w} on={edit.paper === w} onPress={() => setEdit({ ...edit, paper: w, kind: w === 'A4' ? 'page' : 'thermal' })} />
              ))}
            </View>
            <Cap style={{ marginBottom: 8 }}>What it shows</Cap>
            <Card style={{ marginBottom: 12 }}>
              <ToggleRow label="Business name" value={edit.showLogo} onChange={(v) => setEdit({ ...edit, showLogo: v })} />
              <ToggleRow label="Tax line" value={edit.showTax} onChange={(v) => setEdit({ ...edit, showTax: v })} />
              <ToggleRow label="Who served" value={edit.showServed} onChange={(v) => setEdit({ ...edit, showServed: v })} />
              <ToggleRow label="The customer" value={edit.showParty} onChange={(v) => setEdit({ ...edit, showParty: v })} />
              <ToggleRow label="What they saved" value={edit.showSaved} onChange={(v) => setEdit({ ...edit, showSaved: v })} last />
            </Card>
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
  if (!db || !draft) return null;
  const s = db.printServer;
  const url = (draft.secure ? 'https://' : 'http://') + (draft.host || '') + (draft.port ? ':' + draft.port : '') + (draft.path || '');
  const tone = s.status === 'ok' ? 'g' : s.status === 'bad' ? 'd' : 'w';

  const test = () => {
    setPrintServer({ ...draft });
    Alert.alert(
      'Print server',
      'Genius POS will try ' + url + ' the next time a job is sent. ' +
      'If it does not answer, jobs ' +
      (draft.queue === 'retry' ? 'are held and retried.'
        : draft.queue === 'local' ? 'fall back to this phone.' : 'are dropped and you are told.'),
    );
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
          <View style={{ flex: 1 }}><Button size="sm" variant="pri" label="Test connection" onPress={test} /></View>
        </View>
      </Card>

      {s.lastSeen ? (
        <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 8 }}>Last answered {fmtDate(s.lastSeen)}</Text>
      ) : null}
      <Text style={{ fontFamily: fonts.ui, fontSize: 11, lineHeight: 16, color: colors.faint, marginTop: 8 }}>
        Printers set to “On the print server” send their jobs here. Everything else prints straight
        from this device.
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
        <Button size="sm" variant="pri" label="Save wording" onPress={() => setPrinter({ header, footer })} />
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
  const [tab, setTab] = useState('printers');

  if (!db) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (!canFor(db.session.role, 'settings')) {
    return <EmptyState icon="print" title="Not available" subtitle="Your role does not include settings." />;
  }

  const dp = db.printers.find((p) => p.dflt) || db.printers[0];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
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

      <View style={{ paddingBottom: 12 }}>
        <TopTabs
          value={tab}
          onChange={setTab}
          options={[
            { v: 'printers', l: 'Printers', i: 'print' },
            { v: 'templates', l: 'Templates', i: 'doc' },
            { v: 'server', l: 'Print server', i: 'cloud' },
            { v: 'wording', l: 'Wording', i: 'pencil' },
          ]}
        />
      </View>

      {tab === 'printers' ? <PrintersPane />
        : tab === 'templates' ? <TemplatesPane />
          : tab === 'server' ? <ServerPane />
            : <WordingPane />}
    </ScrollView>
  );
}
