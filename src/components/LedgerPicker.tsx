/**
 * Choosing a ledger: a box that shows the one chosen, and a sheet to change
 * it — searchable, grouped by type, and able to create a ledger that is not
 * there yet without leaving the form.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ViewStyle } from 'react-native';
import { Pressable } from './Press';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Icon, IconName } from './icons';
import Sheet from './Sheet';
import { Field, FieldShell, Button, SegPill } from './ui';
import type { Ledger, LedgerType } from '../data/coa';

const TYPE_LABEL: Record<LedgerType, string> = {
  asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses',
};
const TYPE_ORDER: LedgerType[] = ['asset', 'liability', 'equity', 'income', 'expense'];

/** The next free code in the block a type's codes sit in (1000s assets, 6000s expenses…). */
function nextCode(all: Ledger[], type: LedgerType): string {
  const base = { asset: 1000, liability: 2000, equity: 3000, income: 4000, expense: 6000 }[type];
  const used = all.map((l) => Number(l.code)).filter((n) => n >= base && n < base + 1000);
  return String(used.length ? Math.max(...used) + 10 : base + 100);
}

export default function LedgerPicker({
  label, value, onChange, types, icon = 'doc', placeholder = 'Choose a ledger', canCreate, style, compact,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  /** Only ledgers of these types are offered (and created). All types when left out. */
  types?: LedgerType[];
  icon?: IconName;
  placeholder?: string;
  /** Offer "create" for a name that matches nothing. */
  canCreate?: boolean;
  style?: ViewStyle;
  /** A slimmer box, for rows in a list. */
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const { db, addLedger } = useAppData();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [making, setMaking] = useState<{ name: string; type: LedgerType } | null>(null);
  const [waitFor, setWaitFor] = useState<string | null>(null);

  const all = (db?.coa || []) as Ledger[];
  const offered = useMemo(
    () => all.filter((l) => l.active && (!types || types.includes(l.type))),
    [all, types],
  );
  const chosen = all.find((l) => l.id === value);

  // a ledger just created is chosen as soon as it exists
  useEffect(() => {
    if (!waitFor) return;
    const made = all.find((l) => l.name.toLowerCase() === waitFor.toLowerCase());
    if (made) { onChange(made.id); setWaitFor(null); }
  }, [all, waitFor, onChange]);

  const needle = q.trim().toLowerCase();
  const hits = offered.filter((l) => !needle || l.name.toLowerCase().includes(needle) || l.code.includes(needle));
  const exact = offered.some((l) => l.name.toLowerCase() === needle);
  const groups = TYPE_ORDER.map((t) => ({ t, list: hits.filter((l) => l.type === t) })).filter((g) => g.list.length);

  function close() { setOpen(false); setQ(''); setMaking(null); }

  function create() {
    if (!making || !making.name.trim()) return;
    addLedger({ code: nextCode(all, making.type), name: making.name.trim(), type: making.type });
    setWaitFor(making.name.trim());
    close();
  }

  return (
    <>
      <FieldShell
        label={label}
        icon={icon}
        onPress={() => setOpen(true)}
        style={style}
        right={<Icon name="down" size={16} color={colors.faint} />}
      >
        <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: compact ? 14 : 15, color: chosen ? colors.ink : colors.faint }}>
          {chosen ? chosen.name : placeholder}
        </Text>
        {chosen && !compact ? (
          <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 1 }}>{chosen.code} · {TYPE_LABEL[chosen.type]}</Text>
        ) : null}
      </FieldShell>

      <Sheet
        visible={open}
        title={making ? 'New ledger' : label}
        icon={making ? 'plus' : icon}
        full
        onClose={close}
        footer={making ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Button label="Back" onPress={() => setMaking(null)} /></View>
            <View style={{ flex: 2 }}><Button label="Create and use" variant="pri" disabled={!making.name.trim()} onPress={create} /></View>
          </View>
        ) : undefined}
      >
        {making ? (
          <>
            <Field label="Ledger name" value={making.name} onChangeText={(v) => setMaking({ ...making, name: v })} autoFocus />
            {(types || TYPE_ORDER).length > 1 ? (
              <SegPill
                value={making.type}
                onChange={(t) => setMaking({ ...making, type: t })}
                tone="accent"
                options={(types || TYPE_ORDER).map((t) => ({ v: t, l: TYPE_LABEL[t] }))}
              />
            ) : null}
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 10 }}>
              It joins the chart of accounts as {nextCode(all, making.type)} under {TYPE_LABEL[making.type]}.
            </Text>
          </>
        ) : (
          <>
            <Field
              icon="search"
              label="Search ledgers"
              value={q}
              onChangeText={setQ}
              autoCorrect={false}
              trailing={q ? <Pressable onPress={() => setQ('')} hitSlop={8}><Icon name="x" size={16} color={colors.faint} /></Pressable> : null}
            />
            {canCreate && needle && !exact ? (
              <Pressable
                onPress={() => setMaking({ name: q.trim(), type: (types && types[0]) || 'expense' })}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginBottom: 10, borderRadius: radius.md, backgroundColor: colors.accentSoft }}
              >
                <Icon name="plus" size={16} color={colors.accent} />
                <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 14.5, color: colors.accent }}>Create “{q.trim()}”</Text>
              </Pressable>
            ) : null}
            {groups.map((g) => (
              <View key={g.t} style={{ marginBottom: 10 }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 11.5, letterSpacing: 0.6, color: colors.faint, textTransform: 'uppercase', marginBottom: 4 }}>{TYPE_LABEL[g.t]}</Text>
                {g.list.map((l) => {
                  const on = l.id === value;
                  return (
                    <Pressable
                      key={l.id}
                      onPress={() => { onChange(l.id); close(); }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46, borderBottomWidth: 1, borderBottomColor: colors.line }}
                    >
                      <Text style={{ width: 46, fontFamily: fonts.mono, fontSize: 12.5, color: colors.faint }}>{l.code}</Text>
                      <Text numberOfLines={1} style={{ flex: 1, fontFamily: on ? fonts.uiBold : fonts.ui, fontSize: 15, color: on ? colors.accent : colors.ink }}>{l.name}</Text>
                      {on ? <Icon name="check" size={16} color={colors.accent} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}
            {!groups.length ? (
              <Text style={{ fontFamily: fonts.ui, fontSize: 14, color: colors.faint, paddingVertical: 14, textAlign: 'center' }}>
                No ledger matches{canCreate ? ' — create it above.' : '.'}
              </Text>
            ) : null}
            {canCreate && !needle ? (
              <Pressable
                onPress={() => setMaking({ name: '', type: (types && types[0]) || 'expense' })}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 44, marginTop: 4, borderRadius: radius.md, borderWidth: 1.2, borderStyle: 'dashed', borderColor: colors.accent }}
              >
                <Icon name="plus" size={15} color={colors.accent} />
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.accent }}>New ledger</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </Sheet>
    </>
  );
}
