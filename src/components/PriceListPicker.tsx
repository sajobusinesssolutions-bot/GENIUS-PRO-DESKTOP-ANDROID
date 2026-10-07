/**
 * Which price list a document is priced from: the shop's standard prices, or
 * one of its Active price lists (Wholesale, a customer group, a promotion).
 * Hidden entirely while there are no Active lists, so nothing changes for a
 * shop that does not use them.
 */
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { Pressable } from './Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { FieldShell } from './ui';
import { Icon } from './icons';
import Sheet from './Sheet';
import { activeLists, adjLabel, listProducts } from '../data/priceLists';

export default function PriceListPicker({ value, onChange, style }: {
  value: string | null; onChange: (id: string | null) => void; style?: object;
}) {
  const { colors } = useTheme();
  const { db } = useAppData();
  const [open, setOpen] = useState(false);
  const lists = activeLists(db);
  if (!lists.length) return null;
  const chosen = lists.find((l) => l.id === value);

  const row = (id: string | null, name: string, sub: string) => {
    const on = (value || null) === id;
    return (
      <Pressable
        key={id || 'standard'}
        onPress={() => { onChange(id); setOpen(false); }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 14, borderWidth: 1.4, borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accentSoft : colors.surface }}
      >
        <Icon name="coins" size={18} color={on ? colors.accent : colors.ink} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{name}</Text>
          <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>{sub}</Text>
        </View>
        {on ? <Icon name="check" size={18} color={colors.accent} /> : null}
      </Pressable>
    );
  };

  return (
    <>
      <FieldShell
        label="Price list"
        icon="coins"
        onPress={() => setOpen(true)}
        style={style as any}
        right={<Icon name="down" size={16} color={colors.faint} />}
      >
        <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 15, color: colors.ink }}>{chosen ? chosen.name : 'Standard prices'}</Text>
        {chosen ? <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 1 }}>{adjLabel(chosen.adj)}</Text> : null}
      </FieldShell>
      <Sheet visible={open} title="Price list" subtitle="Prices on this document come from it" icon="coins" onClose={() => setOpen(false)}>
        {row(null, 'Standard prices', "Each item's own selling price")}
        {lists.map((l) => row(l.id, l.name, listProducts(db, l).length + ' items · ' + adjLabel(l.adj)))}
      </Sheet>
    </>
  );
}
