import React, { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { Pressable } from './Press';
import { useTheme, fonts, radius, shadow } from '../theme';
import { Icon } from './icons';
import { Search } from './kit';
import { Product } from '../data/types';

export interface CartLine { productId: string; name: string; qty: number; price: number; }

// Shared product-picker + line-item cart editor used by Estimates, Challans,
// Credit notes, Purchase orders, and Recurring invoices — keeps those screens
// small and consistent instead of re-implementing a product grid each time.
export function LineEditor({ products, lines, setLines, priceOf, money }: {
  products: Product[]; lines: CartLine[]; setLines: (l: CartLine[]) => void;
  priceOf: (p: Product) => number; money: (n: number) => string;
}) {
  const { colors } = useTheme();
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return products
      .filter((p) => p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle))
      .slice(0, 20);
  }, [products, q]);

  function add(p: Product) {
    const existing = lines.find((l) => l.productId === p.id);
    if (existing) setLines(lines.map((l) => l.productId === p.id ? { ...l, qty: l.qty + 1 } : l));
    else setLines([...lines, { productId: p.id, name: p.name, qty: 1, price: priceOf(p) }]);
    setQ('');
  }

  function setQty(id: string, qty: number) {
    setLines(qty <= 0 ? lines.filter((l) => l.productId !== id) : lines.map((l) => l.productId === id ? { ...l, qty } : l));
  }

  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);

  return (
    <View style={{ gap: 12 }}>
      <Search value={q} onChange={setQ} placeholder="Search a product to add" />

      {filtered.length > 0 && (
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden', ...shadow.card }}>
          {filtered.map((p, i) => (
            <Pressable
              key={p.id}
              onPress={() => add(p)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 12,
                paddingHorizontal: 14, paddingVertical: 12, minHeight: 60,
                borderBottomWidth: i === filtered.length - 1 ? 0 : 1, borderBottomColor: colors.line,
              }}
            >
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.accent }}>{p.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{p.name}</Text>
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>{p.sku}</Text>
              </View>
              <Text style={{ fontFamily: fonts.monoSemi, fontSize: 12.5, color: colors.ink }}>{money(priceOf(p))}</Text>
              <Icon name="plus" size={19} color={colors.accent} />
            </Pressable>
          ))}
        </View>
      )}

      <View style={{ gap: 10 }}>
        {lines.map((l) => (
          <View
            key={l.productId}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 10,
              backgroundColor: colors.surface, borderRadius: radius.lg,
              paddingHorizontal: 12, paddingVertical: 11, ...shadow.card,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{l.name}</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
                {l.qty} × {money(l.price)}
              </Text>
            </View>

            <Pressable
              onPress={() => setQty(l.productId, l.qty - 1)}
              style={{ width: 36, height: 36, borderRadius: 12, borderWidth: 1.4, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ color: colors.ink, fontFamily: fonts.uiBold, fontSize: 20 }}>−</Text>
            </Pressable>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, minWidth: 28, textAlign: 'center', color: colors.ink }}>{l.qty}</Text>
            <Pressable
              onPress={() => setQty(l.productId, l.qty + 1)}
              style={{ width: 36, height: 36, borderRadius: 12, borderWidth: 1.4, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ color: colors.ink, fontFamily: fonts.uiBold, fontSize: 20 }}>+</Text>
            </Pressable>

            <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, width: 84, textAlign: 'right', color: colors.ink }}>
              {money(l.qty * l.price)}
            </Text>
          </View>
        ))}

        {!lines.length ? (
          <View style={{ alignItems: 'center', paddingVertical: 28, gap: 7 }}>
            <Icon name="cart" size={26} color={colors.lineHard} />
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint }}>Nothing added yet</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>Search above to add a product.</Text>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6, paddingHorizontal: 4 }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint }}>
              {lines.length} line{lines.length === 1 ? '' : 's'}
            </Text>
            <Text style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }}>{money(total)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}
