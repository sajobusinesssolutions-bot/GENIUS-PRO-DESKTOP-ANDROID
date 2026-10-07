/**
 * The pieces of the money forms — Add expense, Record payment — so both look
 * and behave the same:
 *
 *  · AmountCard   a large amount, the whole card focuses the keyboard
 *  · RowGroup/PickRow   grouped rows that open a searchable list
 *  · AccountTiles cash drawer / bank / mobile money as tiles
 *  · NoteBox      a note field that focuses wherever it is tapped
 *  · PickSheet    a searchable list in a sheet, for any choice
 *  · SumCard      "now / this / after" in figures
 */
import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { Pressable } from './Press';
import { useTheme, fonts } from '../theme';
import { Icon, IconName } from './icons';
import Sheet from './Sheet';
import { Field, groupDigits } from './form';

export function AmountCard({ label, value, onChange, prefix = 'Sh', tone, hint, sign }: {
  label: string; value: string; onChange: (v: string) => void;
  prefix?: string; tone?: string; hint?: React.ReactNode; sign?: '+' | '−';
}) {
  const { colors } = useTheme();
  const ref = useRef<TextInput>(null);
  const empty = !value;
  return (
    <Pressable onPress={() => ref.current?.focus()} style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 16 }}>
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.soft }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 20, color: tone || colors.faint, marginRight: 6 }}>{(sign ? sign + ' ' : '') + prefix}</Text>
        <TextInput
          ref={ref}
          value={groupDigits(value)}
          onChangeText={(v) => onChange(v.replace(/[^0-9.]/g, ''))}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={colors.lineHard}
          style={{ flex: 1, padding: 0, fontFamily: fonts.uiExtra, fontSize: 36, color: empty ? colors.faint : (tone || colors.ink) }}
        />
      </View>
      {hint ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 6 }}>{hint}</Text> : null}
    </Pressable>
  );
}

export function RowGroup({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }}>
      {rows.map((c, i) => (
        <View key={i} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>{c}</View>
      ))}
    </View>
  );
}

export function PickRow({ icon, label, value, placeholder, onPress }: {
  icon: IconName; label?: string; value?: string; placeholder?: string; onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: pressed ? colors.sunk : colors.surface })}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={16} color={colors.soft} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {label ? <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{label}</Text> : null}
        <Text numberOfLines={1} style={{ fontFamily: value ? fonts.uiBold : fonts.ui, fontSize: 15, color: value ? colors.ink : colors.faint, marginTop: label ? 2 : 0 }}>
          {value || placeholder}
        </Text>
      </View>
      <Icon name="chev" size={15} color={colors.faint} />
    </Pressable>
  );
}

export function AccountTiles({ accounts, value, onChange, tone }: {
  accounts: { id: string; name: string; type: string }[]; value: string; onChange: (id: string) => void; tone?: string;
}) {
  const { colors } = useTheme();
  const t = tone || colors.accent;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {accounts.map((a) => {
        const on = a.id === value;
        const icon: IconName = a.type === 'cash' ? 'cash' : a.type === 'bank' ? 'bank' : 'phone';
        return (
          <Pressable
            key={a.id}
            onPress={() => onChange(a.id)}
            style={{
              flexGrow: 1, flexBasis: '30%', alignItems: 'center', gap: 6, paddingVertical: 14, paddingHorizontal: 6, borderRadius: 14,
              borderWidth: on ? 1.6 : 1, borderColor: on ? t : colors.line, backgroundColor: colors.surface,
            }}
          >
            <Icon name={icon} size={19} color={on ? t : colors.soft} />
            <Text numberOfLines={1} style={{ fontFamily: on ? fonts.uiBold : fonts.uiSemi, fontSize: 13, color: colors.ink }}>{a.name.split('—')[0].trim()}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function NoteBox({ value, onChange, placeholder = 'Add a note (optional)' }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const { colors } = useTheme();
  const ref = useRef<TextInput>(null);
  return (
    // the whole box answers a tap, not only the words in it
    <Pressable onPress={() => ref.current?.focus()} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="doc" size={16} color={colors.soft} />
      </View>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        multiline
        style={{ flex: 1, padding: 0, minHeight: 22, fontFamily: fonts.ui, fontSize: 15, color: colors.ink }}
      />
    </Pressable>
  );
}

export interface PickItem { id: string; title: string; sub?: string; right?: string; rightTone?: string }

/** A searchable list in a sheet. */
export function PickSheet({ visible, title, items, selected, onPick, onClose, searchHint = 'Search', footer }: {
  visible: boolean; title: string; items: PickItem[]; selected?: string | null;
  onPick: (id: string) => void; onClose: () => void; searchHint?: string; footer?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? items.filter((it) => (it.title + ' ' + (it.sub || '')).toLowerCase().includes(n)) : items;
  }, [items, q]);
  const close = () => { setQ(''); onClose(); };
  return (
    <Sheet visible={visible} title={title} full onClose={close} footer={footer}>
      <Field icon="search" label={searchHint} value={q} onChangeText={setQ} autoCorrect={false} style={{ marginBottom: 8 }} />
      <View>
        {hits.map((it) => (
          <Pressable
            key={it.id}
            onPress={() => { onPick(it.id); close(); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.line }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{it.title}</Text>
              {it.sub ? <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>{it.sub}</Text> : null}
            </View>
            {it.right ? <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: it.rightTone || colors.ink }}>{it.right}</Text> : null}
            {selected === it.id ? <Icon name="check" size={17} color={colors.good} /> : null}
          </Pressable>
        ))}
        {!hits.length ? (
          <Text style={{ paddingVertical: 24, textAlign: 'center', fontFamily: fonts.ui, fontSize: 13, color: colors.faint }}>Nothing matches “{q.trim()}”</Text>
        ) : null}
      </View>
    </Sheet>
  );
}

export function SumCard({ rows }: { rows: { l: string; v: string; tone?: string; bold?: boolean }[] }) {
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: colors.sunk, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 8 }}>
      {rows.map((r) => (
        <View key={r.l} style={{ flexDirection: 'row', alignItems: 'center', ...(r.bold ? { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10, marginTop: 2 } : {}) }}>
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: r.bold ? fonts.uiBold : fonts.ui, fontSize: r.bold ? 15 : 13.5, color: r.bold ? colors.ink : colors.soft }}>{r.l}</Text>
          <Text style={{ fontFamily: r.bold ? fonts.uiExtra : fonts.monoSemi, fontSize: r.bold ? 15 : 13.5, color: r.tone || colors.ink }}>{r.v}</Text>
        </View>
      ))}
    </View>
  );
}
