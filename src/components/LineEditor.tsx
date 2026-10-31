import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Pressable } from './Press';
import { useTheme, fonts, radius } from '../theme';
import { Icon } from './icons';
import { Product } from '../data/types';
import { useAppData } from '../data/AppDataContext';
import ItemEntrySheet, { useNewItem } from './ItemEntrySheet';
import BilledItems from './BilledItems';
import BarcodeScannerModal from './BarcodeScannerModal';
import { Button } from './ui';

export interface CartLine {
  productId: string; name: string; qty: number;
  /** Net rate, after any line discount. */
  price: number;
  unit?: string; unitFactor?: number;
  listPrice?: number; discountPct?: number;
  note?: string;
}

// Shared item entry + billed-items list used by Estimates, Challans, Credit
// notes, Purchase orders, Recurring invoices and Instalment plans — one way of
// adding a line everywhere: the full-screen entry, then a card per line.
export function LineEditor({ products, lines, setLines, priceOf, money, openSignal, entryTitle = 'Add Items', rateLabel, rateIs = 'price' }: {
  products: Product[]; lines: CartLine[]; setLines: (l: CartLine[]) => void;
  priceOf: (p: Product) => number; money: (n: number) => string;
  /** Bump to open the item entry from outside, as soon as a party is chosen. */
  openSignal?: number;
  entryTitle?: string;
  rateLabel?: string;
  /** Whether the rate is what the item sells for, or what it costs (an order to a supplier). */
  rateIs?: 'price' | 'cost';
}) {
  const { colors } = useTheme();
  const { stockOf } = useAppData();
  const isCost = rateIs === 'cost';
  const newItem = useNewItem(isCost ? 'cost' : 'price');
  const [open, setOpen] = useState(false);
  const [editAt, setEditAt] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [startProduct, setStartProduct] = useState<Product | null>(null);
  const byCode = (code: string) => { const c = code.trim().toLowerCase(); return products.find((p) => p.sku.toLowerCase() === c || (p.barcodes || []).some((b) => b.toLowerCase() === c)); };

  useEffect(() => {
    if (openSignal) { setEditAt(null); setOpen(true); }
  }, [openSignal]);

  const editing = editAt !== null ? lines[editAt] : null;

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button label={lines.length ? 'Add another item' : 'Add item'} variant="pri" icon={<Icon name="plus" size={16} color={colors.accentInk} />}
            onPress={() => { setEditAt(null); setStartProduct(null); setOpen(true); }} />
        </View>
        <Pressable
          onPress={() => setScanning(true)}
          accessibilityLabel="Scan a barcode"
          style={({ pressed }: { pressed: boolean }) => ({
            width: 56, borderRadius: radius.md, borderWidth: 1.4, borderColor: colors.line,
            alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.sunk : colors.surface,
          })}
        >
          <Icon name="barcode" size={24} color={colors.ink} />
        </Pressable>
      </View>

      <BarcodeScannerModal
        visible={scanning}
        describe={(code) => { const p = byCode(code); return p ? { title: p.name, subtitle: money(priceOf(p)), ok: true } : { title: 'Unknown code', subtitle: code, ok: false }; }}
        onClose={() => setScanning(false)}
        onScan={(code) => { const p = byCode(code); if (p) { setScanning(false); setEditAt(null); setStartProduct(p); setOpen(true); } }}
      />

      <BilledItems
        lines={lines.map((l) => ({ ...l, unit: l.unit || products.find((p) => p.id === l.productId)?.unit }))}
        money={money}
        onPress={(i) => { setEditAt(i); setOpen(true); }}
        empty={(
          <View style={{ alignItems: 'center', paddingVertical: 24, gap: 7 }}>
            <Icon name="cart" size={26} color={colors.lineHard} />
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint }}>Nothing added yet</Text>
          </View>
        )}
      />

      <ItemEntrySheet
        visible={open}
        title={editing ? 'Edit Item' : entryTitle}
        products={products}
        money={money}
        stockOf={stockOf}
        priceOf={priceOf}
        rateLabel={rateLabel || (isCost ? 'Rate (Cost/Unit)' : 'Rate (Price/Unit)')}
        startProduct={editing ? null : startProduct}
        start={editing ? { productId: editing.productId, qty: editing.qty, unit: editing.unit, listPrice: editing.listPrice ?? editing.price, discountPct: editing.discountPct, note: editing.note } : null}
        canCreate={newItem.canCreate}
        units={newItem.units}
        onCreateProduct={newItem.create}
        askSellPrice={isCost}
        onRemove={() => { setLines(lines.filter((_, i) => i !== editAt)); setOpen(false); setEditAt(null); }}
        onClose={() => { setOpen(false); setEditAt(null); setStartProduct(null); }}
        onSave={(e, andNew) => {
          const line: CartLine = {
            productId: e.product.id, name: e.product.name, qty: e.qty, price: e.price,
            unit: e.unit, unitFactor: e.unitFactor, listPrice: e.listPrice, discountPct: e.discountPct, note: e.note || undefined,
          };
          setLines(editAt !== null ? lines.map((l, i) => (i === editAt ? line : l)) : [...lines, line]);
          setEditAt(null);
          if (!andNew) setOpen(false);
        }}
      />
    </View>
  );
}
