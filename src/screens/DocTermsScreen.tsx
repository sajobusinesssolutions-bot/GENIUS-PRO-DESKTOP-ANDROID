/**
 * Settings → Documents & terms. Named sets of terms and which document each
 * starts with, the default description, the copy label, how long quotations
 * hold, when invoices fall due, and the payment details printed at the foot.
 * Shared with the computer, so both print the same paper.
 */
import React, { useState } from 'react';
import { View, Text, Alert } from 'react-native';
import ScrollView from '../components/KeyScroll';
import { Pressable } from '../components/Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Button } from '../components/ui';
import { Field } from '../components/form';
import { Icon } from '../components/icons';
import { termsSets, docDefaults, TermsSet, DocFor, DocDefaults } from '../data/docDefaults';

const uidT = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

export default function DocTermsScreen() {
  const { colors } = useTheme();
  const { db, setSetting } = useAppData();
  const [sets, setSets] = useState<TermsSet[]>(() => termsSets(db));
  const start = docDefaults(db);
  const [termsFor, setTermsFor] = useState(start.termsFor);
  const [description, setDescription] = useState(start.description);
  const [copyLabel, setCopyLabel] = useState(start.copyLabel);
  const [quoteDays, setQuoteDays] = useState(String(start.quoteValidDays));
  const [dueDays, setDueDays] = useState(String(start.invoiceDueDays || ''));
  const [payment, setPayment] = useState(start.paymentDetails);
  const [payOnInvoice, setPayOnInvoice] = useState(start.paymentOnInvoice);
  const [editing, setEditing] = useState<string | null>(null);
  if (!db) return null;

  const card = { backgroundColor: colors.surface, borderRadius: 6, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 10 } as const;
  const head = (t: string, sub?: string) => (
    <View style={{ marginTop: 6 }}>
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, letterSpacing: 0.6, color: colors.accent }}>{t.toUpperCase()}</Text>
      {sub ? <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 2 }}>{sub}</Text> : null}
    </View>
  );
  const seg = <T extends string>(value: T, opts: Array<[T, string]>, set: (v: T) => void) => (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {opts.map(([v, l]) => (
        <Pressable key={v} onPress={() => set(v)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 4, borderWidth: 1.2,
          borderColor: value === v ? colors.accent : colors.line, backgroundColor: value === v ? colors.accentSoft : colors.surface }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: value === v ? colors.accent : colors.ink }}>{l}</Text>
        </Pressable>
      ))}
    </View>
  );

  const save = () => {
    const clean = sets.map((s) => ({ ...s, name: s.name.trim() || 'Terms', text: s.text.trim() })).filter((s) => s.text);
    const dd: DocDefaults = {
      termsFor, description: description.trim(), copyLabel,
      quoteValidDays: Math.max(0, Number(quoteDays) || 0), invoiceDueDays: Math.max(0, Number(dueDays) || 0),
      paymentDetails: payment.trim(), paymentOnInvoice: payOnInvoice,
    };
    setSetting({ docTerms: clean, docDefaults: dd } as any);
    setSets(clean);
    Alert.alert('Saved', 'New sales, quotations and delivery notes start with these, here and on the computer.');
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 110 }}>
        {head('Terms & conditions', 'Keep several — standard, warranty, wholesale — and pick one on each document')}
        {sets.map((s) => (
          <View key={s.id} style={card}>
            <Pressable onPress={() => setEditing(editing === s.id ? null : s.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="doc" size={16} color={colors.accent} />
              <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>{s.name || 'Terms'}</Text>
              {(['invoice', 'estimate', 'challan'] as DocFor[]).filter((k) => termsFor[k] === s.id).map((k) => (
                <Text key={k} style={{ fontFamily: fonts.uiSemi, fontSize: 10.5, color: colors.accent, backgroundColor: colors.accentSoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 }}>
                  {k === 'invoice' ? 'Sales' : k === 'estimate' ? 'Quotes' : 'Delivery'}
                </Text>
              ))}
              <Icon name={editing === s.id ? 'up' : 'down'} size={15} color={colors.faint} />
            </Pressable>
            {editing === s.id ? (
              <>
                <Field label="Name" value={s.name} onChangeText={(v) => setSets((x) => x.map((y) => (y.id === s.id ? { ...y, name: v } : y)))} />
                <Field label="Terms" value={s.text} multiline onChangeText={(v) => setSets((x) => x.map((y) => (y.id === s.id ? { ...y, text: v } : y)))} />
                <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>Start these documents with this set</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {(['invoice', 'estimate', 'challan'] as DocFor[]).map((k) => {
                    const on = termsFor[k] === s.id;
                    return (
                      <Pressable key={k} onPress={() => setTermsFor((t) => ({ ...t, [k]: on ? undefined : s.id }))}
                        style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 4, borderWidth: 1.2, borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accentSoft : colors.surface }}>
                        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: on ? colors.accent : colors.ink }}>{k === 'invoice' ? 'Sales' : k === 'estimate' ? 'Quotations' : 'Delivery notes'}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Pressable onPress={() => { setSets((x) => x.filter((y) => y.id !== s.id)); setEditing(null); }} style={{ alignSelf: 'flex-start', paddingVertical: 6 }}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.danger }}>Remove this set</Text>
                </Pressable>
              </>
            ) : (
              <Text numberOfLines={2} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.soft }}>{s.text || 'Empty — tap to write it'}</Text>
            )}
          </View>
        ))}
        <Button label="Add a terms set" icon={<Icon name="plus" size={16} color={colors.ink} />}
          onPress={() => { const id = uidT(); setSets((x) => [...x, { id, name: x.length ? 'Terms ' + (x.length + 1) : 'Standard', text: '' }]); setEditing(id); }} />

        {head('Description', 'What a new sale or quotation\'s description starts as')}
        <Field label="Default description" value={description} onChangeText={setDescription} multiline placeholder="e.g. Goods once sold are not returnable" />

        {head('Copies', 'The label printed at the top of each copy')}
        {seg(copyLabel, [['none', 'No label'], ['original', 'ORIGINAL'], ['auto', 'Original, duplicate…']], setCopyLabel)}

        {head('Due dates')}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Field label="Quotation valid for (days)" value={quoteDays} onChangeText={setQuoteDays} numeric /></View>
          <View style={{ flex: 1 }}><Field label="Credit invoice due in (days)" value={dueDays} onChangeText={setDueDays} numeric placeholder="0 — no due date" /></View>
        </View>

        {head('Payment details', 'Bank and mobile money details printed at the foot of an invoice')}
        <Field label="How to pay" value={payment} onChangeText={setPayment} multiline placeholder={'Stanbic Bank · 9030012345678 · Saljoe Tech\nMTN MoMo · 0772 000000 · Saljoe Tech'} />
        <Pressable onPress={() => setPayOnInvoice((x) => !x)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
          <View style={{ width: 22, height: 22, borderRadius: 4, borderWidth: 1.5, borderColor: payOnInvoice ? colors.accent : colors.lineHard, backgroundColor: payOnInvoice ? colors.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
            {payOnInvoice ? <Icon name="check" size={14} color={colors.accentInk} /> : null}
          </View>
          <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 13.5, color: colors.ink }}>Print them on invoices unless a sale switches them off</Text>
        </Pressable>
      </ScrollView>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line }}>
        <Button label="Save" variant="pri" onPress={save} />
      </View>
    </View>
  );
}
