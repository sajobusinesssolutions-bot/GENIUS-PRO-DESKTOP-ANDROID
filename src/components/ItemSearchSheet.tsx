import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, Pressable, TextInput, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, fonts } from '../theme';
import { Icon } from './icons';
import type { Product } from '../data/types';

/**
 * The results list is inverted and sits directly on top of an input pinned above
 * the keyboard, so matches always grow into the visible area instead of sliding
 * underneath it.
 */
export default function ItemSearchSheet({ visible, products, categories, money, stockOf, onPick, onScan, onClose, canSell, title = 'Add item', priceOf, onCreate }: {
  visible: boolean;
  products: Product[];
  categories: string[];
  money: (n: number) => string;
  stockOf: (p: Product) => number;
  onPick: (p: Product) => void;
  onScan: () => void;
  onClose: () => void;
  /**
   * Whether an item may be picked. Defaults to "has stock", which on its own
   * made every service unsellable — a service has no stock to have.
   */
  canSell?: (p: Product) => boolean;
  title?: string;
  /** The figure shown on each row: the selling price unless told otherwise (a purchase shows cost). */
  priceOf?: (p: Product) => number;
  /**
   * Offers "Create a new item" with whatever was typed — so a delivery with
   * something new on it does not mean leaving the purchase to go and add it.
   */
  onCreate?: (name: string) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setQ('');
      setCat('All');
      const t = setTimeout(() => inputRef.current?.focus(), 250);
      return () => clearTimeout(t);
    }
  }, [visible]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products.filter((p) => p.active
      && (cat === 'All' || p.category === cat)
      && (!needle || p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle)
        || (p.barcodes || []).some((b) => b.toLowerCase().includes(needle))));
  }, [products, q, cat]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={{
            paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 10,
            flexDirection: 'row', alignItems: 'center', gap: 10,
            backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.line,
          }}>
            <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 17, color: colors.ink }}>{title}</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>
              {results.length} match{results.length === 1 ? '' : 'es'}
            </Text>
            <Pressable onPress={onClose} hitSlop={10} style={{ padding: 4 }}>
              <Icon name="x" size={20} color={colors.faint} />
            </Pressable>
          </View>

          {/* Inverted so the first match sits against the input, immediately above the keyboard. */}
          <FlatList
            data={results}
            inverted
            keyboardShouldPersistTaps="always"
            keyboardDismissMode="none"
            keyExtractor={(p) => p.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10 }}
            // inverted: the header sits at the bottom, right above the search box
            ListHeaderComponent={onCreate ? (
              <Pressable
                onPress={() => onCreate(q.trim())}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8,
                  borderRadius: 14, borderWidth: 1.4, borderStyle: 'dashed', borderColor: colors.accent,
                  backgroundColor: colors.accentSoft, paddingHorizontal: 12, paddingVertical: 12,
                }}
              >
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="plus" size={18} color={colors.accentInk} />
                </View>
                <Text numberOfLines={1} style={{ flex: 1, color: colors.accent, fontFamily: fonts.uiBold, fontSize: 14 }}>
                  {q.trim() ? 'Create “' + q.trim() + '” as a new item' : 'Create a new item'}
                </Text>
              </Pressable>
            ) : null}
            ListFooterComponent={results.length || onCreate ? null : (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.faint }}>No items match “{q}”</Text>
              </View>
            )}
            renderItem={({ item: p }) => {
              const stock = stockOf(p);
              const out = canSell ? !canSell(p) : stock <= 0;
              return (
                <Pressable
                  onPress={out ? undefined : () => onPick(p)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 12,
                    backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.line,
                    paddingHorizontal: 12, paddingVertical: 12, marginBottom: 8, opacity: out ? 0.55 : 1,
                  }}
                >
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: colors.accent, fontFamily: fonts.uiBold, fontSize: 16 }}>{p.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: colors.ink, fontFamily: fonts.uiSemi, fontSize: 14 }}>{p.name}</Text>
                    <Text numberOfLines={1} style={{ color: out ? colors.danger : colors.faint, fontFamily: fonts.ui, fontSize: 11, marginTop: 2 }}>
                      {p.sku} · {p.kind === 'service' ? 'Service' : out ? 'Out of stock' : stock + ' ' + p.unit + ' in stock'}
                    </Text>
                  </View>
                  <Text style={{ color: colors.ink, fontFamily: fonts.monoSemi, fontSize: 13 }}>{money(priceOf ? priceOf(p) : p.price)}</Text>
                </Pressable>
              );
            }}
          />

          <View style={{
            backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line,
            paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10 + insets.bottom,
          }}>
            <FlatList
              data={categories}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="always"
              keyExtractor={(c) => c}
              contentContainerStyle={{ gap: 8, paddingBottom: 10, paddingHorizontal: 2 }}
              renderItem={({ item: c }) => (
                <Pressable
                  onPress={() => setCat(c)}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
                    backgroundColor: cat === c ? colors.accent : colors.sunk,
                    borderWidth: 1, borderColor: cat === c ? colors.accent : colors.line,
                  }}
                >
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: cat === c ? colors.accentInk : colors.soft }}>{c}</Text>
                </Pressable>
              )}
            />

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.sunk, borderRadius: 14, borderWidth: 1, borderColor: colors.lineHard, paddingLeft: 12 }}>
              <Icon name="search" size={17} color={colors.faint} />
              <TextInput
                ref={inputRef}
                value={q}
                onChangeText={setQ}
                placeholder="Search name, SKU or barcode"
                placeholderTextColor={colors.faint}
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={() => {
                  if (results.length !== 1) return;
                  const ok = canSell ? canSell(results[0]) : stockOf(results[0]) > 0;
                  if (ok) onPick(results[0]);
                }}
                style={{ flex: 1, paddingVertical: 13, color: colors.ink, fontFamily: fonts.uiSemi, fontSize: 15 }}
              />
              {q.length > 0 && (
                <Pressable onPress={() => setQ('')} hitSlop={8} style={{ paddingHorizontal: 4 }}>
                  <Icon name="x" size={16} color={colors.faint} />
                </Pressable>
              )}
              <Pressable onPress={onScan} style={{ paddingHorizontal: 14, paddingVertical: 13, borderLeftWidth: 1, borderLeftColor: colors.line }}>
                <Icon name="box" size={18} color={colors.accent} />
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
