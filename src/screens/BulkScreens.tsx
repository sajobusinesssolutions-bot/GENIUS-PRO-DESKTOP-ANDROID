/**
 * BULK CHANGES — reference `SHEETS.bulkMenu` (17152), the four forms behind it
 * (bulkPrices 17178, bulkNames 17189, bulkActive 17198, bulkTags 17206),
 * `buildBulkPlan` (17242) and `SCREENS.bulkPreview` (17285).
 *
 * The shape is the reference's: pick a scope and the change, preview exactly
 * which items move and to what, then apply. Nothing is written until the
 * preview's Change button is tapped.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput, Switch, Alert, Share } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Card, Cap, Chip, Button, EmptyState, KVNode } from '../components/ui';
import { Icon, IconName } from '../components/icons';
import { plural } from '../data/helpers';
import { buildBulkPlan, bulkScope, categoriesOf } from '../data/logic';
import type { BulkKind, BulkForm, BulkPlan } from '../data/logic';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

export const BULK_ACTIONS: { kind: BulkKind; icon: IconName; title: string; sub: string }[] = [
  { kind: 'bulkPrices', icon: 'coins', title: 'Price list', sub: 'Raise or drop prices by a percentage or an amount' },
  { kind: 'bulkNames', icon: 'pencil', title: 'Names and descriptions', sub: 'Find and replace across item names' },
  { kind: 'bulkActive', icon: 'check', title: 'Activate or deactivate', sub: 'Take a whole category off the list, or bring it back' },
  { kind: 'bulkTags', icon: 'tag', title: 'Category', sub: 'Move a group of items into another category' },
];

const TITLES: Record<BulkKind, string> = {
  bulkPrices: 'Adjust prices',
  bulkNames: 'Find and replace',
  bulkActive: 'Activate or deactivate',
  bulkTags: 'Change category',
};

function Note({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text style={{ fontFamily: fonts.ui, fontSize: 11, lineHeight: 16, color: colors.faint, marginTop: 4 }}>
      {children}
    </Text>
  );
}

function Field({ label, value, onChangeText, placeholder, numeric }: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; numeric?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: colors.faint, marginBottom: 5 }}>{label}</Text>
      <TextInput
        value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.faint}
        keyboardType={numeric ? 'numbers-and-punctuation' : 'default'}
        style={{
          backgroundColor: colors.sunk, borderRadius: 10, height: 42, paddingHorizontal: 12,
          fontFamily: numeric ? fonts.mono : fonts.ui, fontSize: 13.5, color: colors.ink,
        }}
      />
    </View>
  );
}

function ChipRow({ options, value, onChange }: {
  options: [string, string][]; value: string; onChange: (v: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 14 }} contentContainerStyle={{ gap: 7 }}>
      {options.map(([v, l]) => <Chip key={v} label={l} on={value === v} onPress={() => onChange(v)} />)}
    </ScrollView>
  );
}

/* ================= the form ================= */

type EditProps = NativeStackScreenProps<RootStackParamList, 'BulkChange'>;

export function BulkChangeScreen({ route, navigation }: EditProps) {
  const { colors } = useTheme();
  const { db, money } = useAppData();
  const kind = (route.params?.kind || 'bulkPrices') as BulkKind;

  const [form, setForm] = useState<BulkForm>({
    scope: 'all', includeOff: kind === 'bulkActive',
    field: kind === 'bulkNames' ? 'name' : 'price',
    mode: 'pct', value: 10, round: 50,
    find: '', replace: '', act: 'off', kind: 'all',
  });

  const set = (patch: Partial<BulkForm>) => setForm((f) => ({ ...f, ...patch }));

  const cats = db ? categoriesOf(db) : [];
  const scopeOptions: [string, string][] = [['all', 'Every item'], ...cats.map((c) => [c, c] as [string, string])];
  const affected = db ? bulkScope(db, form).length : 0;

  const preview = useMemo(
    () => (db ? buildBulkPlan(db, kind, form, money) : null),
    [db, kind, form],
  );

  if (!db) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  const go = () => {
    if (!preview || !preview.rows.length) {
      Alert.alert(TITLES[kind], kind === 'bulkNames' && !form.find
        ? 'Type the text to find first.'
        : kind === 'bulkTags' && !String(form.replace || '').trim()
          ? 'Type the category to move them into.'
          : 'Nothing would change.');
      return;
    }
    navigation.navigate('BulkPreview', { plan: preview });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <Cap style={{ marginBottom: 8 }}>Which items</Cap>
        <ChipRow options={scopeOptions} value={form.scope || 'all'} onChange={(v) => set({ scope: v })} />

        {kind === 'bulkPrices' ? (
          <>
            <Cap style={{ marginBottom: 8 }}>Change the</Cap>
            <ChipRow
              options={[['price', 'Selling price'], ['cost', 'Buying price']]}
              value={form.field || 'price'} onChange={(v) => set({ field: v })}
            />
            <Cap style={{ marginBottom: 8 }}>By</Cap>
            <ChipRow
              options={[['pct', 'A percentage'], ['amt', 'An amount'], ['set', 'Set it to']]}
              value={form.mode || 'pct'} onChange={(v) => set({ mode: v as BulkForm['mode'] })}
            />
            <Field label="Amount" numeric value={String(form.value ?? '')} onChangeText={(v) => set({ value: Number(v) || 0 })} placeholder="10" />
            <Field label="Round to nearest" numeric value={String(form.round ?? '')} onChangeText={(v) => set({ round: Number(v) || 1 })} placeholder="50" />
            <Note>A percentage can be negative to drop prices — type -10 for ten percent off.</Note>
          </>
        ) : null}

        {kind === 'bulkNames' ? (
          <>
            <Field label="Find this text" value={String(form.find || '')} onChangeText={(v) => set({ find: v })} placeholder="Text to find" />
            <Field label="Replace it with" value={String(form.replace || '')} onChangeText={(v) => set({ replace: v })} placeholder="50 kg" />
            <Note>Case matters. Leave the replacement blank to remove the text.</Note>
          </>
        ) : null}

        {kind === 'bulkActive' ? (
          <>
            <Cap style={{ marginBottom: 8 }}>Do what</Cap>
            <ChipRow
              options={[['off', 'Take off the list'], ['on', 'Put back on the list']]}
              value={form.act || 'off'} onChange={(v) => set({ act: v as BulkForm['act'] })}
            />
            <Note>
              Deactivating hides an item from the till and new documents. Nothing already recorded
              changes, and the stock stays counted.
            </Note>
          </>
        ) : null}

        {kind === 'bulkTags' ? (
          <>
            <Field label="Move them into" value={String(form.replace || '')} onChangeText={(v) => set({ replace: v })} placeholder="Category" />
            {cats.length ? (
              <>
                <Cap style={{ marginBottom: 8 }}>Categories already in use</Cap>
                <ChipRow options={cats.map((c) => [c, c] as [string, string])} value={String(form.replace || '')} onChange={(v) => set({ replace: v })} />
              </>
            ) : null}
            <Note>Reports already run are not redrawn. Items keep their codes, prices and stock.</Note>
          </>
        ) : null}

        {kind !== 'bulkActive' ? (
          <Card style={{ marginTop: 10, paddingVertical: 4, paddingHorizontal: 16 }}>
            <KVNode label="Include items that are off the list" last>
              <Switch value={!!form.includeOff} onValueChange={(v) => set({ includeOff: v })} />
            </KVNode>
          </Card>
        ) : null}

        <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 12 }}>
          {plural(affected, 'item')} in that group. {preview ? plural(preview.rows.length, 'item') + ' would actually change.' : ''}
        </Text>
      </ScrollView>

      <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface }}>
        <Button variant="pri" label="Preview the change" onPress={go} />
      </View>
    </View>
  );
}

/* ================= the preview ================= */

type PreviewProps = NativeStackScreenProps<RootStackParamList, 'BulkPreview'>;

export function BulkPreviewScreen({ route, navigation }: PreviewProps) {
  const { colors } = useTheme();
  const { applyBulkPlan } = useAppData();
  const plan: BulkPlan | undefined = route.params?.plan;

  if (!plan || !plan.rows.length) return <EmptyState icon="box" title="Nothing to preview" />;

  const SHOWN = 60;
  const rows = plan.rows.slice(0, SHOWN);

  const apply = () => {
    const n = applyBulkPlan(plan);
    // back past the form to the items list the change belongs to
    navigation.navigate('Main', { screen: 'ItemsTab' });
    setTimeout(() => Alert.alert('Bulk change', plural(n, 'item') + ' changed.'), 150);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
        <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>
          <Card style={{ paddingVertical: 13, paddingHorizontal: 14 }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{plan.title}</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 11, lineHeight: 16, color: colors.faint, marginTop: 3 }}>
              {plural(plan.rows.length, 'item')} will change. {plan.note}
            </Text>
          </Card>
        </View>

        {rows.map((r, i) => (
          <View
            key={r.id}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingHorizontal: 16,
              backgroundColor: colors.surface, borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: colors.line,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{r.name}</Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 1 }}>{String(r.from)}</Text>
            </View>
            <Icon name="chev" size={14} color={colors.faint} />
            <Text numberOfLines={1} style={{ fontFamily: fonts.monoSemi, fontSize: 13, color: colors.ink, maxWidth: 130, textAlign: 'right' }}>
              {String(r.to)}
            </Text>
          </View>
        ))}

        {plan.rows.length > SHOWN ? (
          <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, textAlign: 'center', paddingVertical: 12 }}>
            …and {plan.rows.length - SHOWN} more, all included in the change
          </Text>
        ) : null}
      </ScrollView>

      <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface, flexDirection: 'row', gap: 9 }}>
        <View style={{ flex: 1 }}><Button label="Cancel" onPress={() => navigation.goBack()} /></View>
        <View style={{ flex: 1 }}><Button variant="pri" label={'Change ' + plan.rows.length} onPress={apply} /></View>
      </View>
    </View>
  );
}

/**
 * "Print price tags" — the reference's fourth bulk action (17206). There is no
 * print dialog on a phone, so the tag sheet goes out through the share sheet,
 * which is how everything else printable leaves this app.
 */
export async function sharePriceTags(
  products: { name: string; sku: string; price: number }[],
  shopName: string,
  money: (n: number) => string,
) {
  if (!products.length) {
    Alert.alert('Price tags', 'Nothing in that group.');
    return;
  }
  const body = products
    .map((p) => `${p.name}\n${p.sku}   ${money(p.price)}`)
    .join('\n\n----------------\n\n');
  try {
    await Share.share({ title: shopName + ' — price tags', message: shopName + '\n\n' + body });
  } catch {
    Alert.alert('Price tags', 'Could not open the share sheet on this device.');
  }
}
