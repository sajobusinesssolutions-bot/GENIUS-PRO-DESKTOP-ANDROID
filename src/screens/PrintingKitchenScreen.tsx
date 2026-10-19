/**
 * Settings → Printing → Kitchen & restaurant receipts.
 *
 * The kitchen ticket is what the cooks read: big, no prices, the table, the
 * choices and the notes. Each part can be switched on or off, and the heading
 * changed (a bar printer might say "BAR"). Below it, the two restaurant
 * touches on the customer's receipt: each dish's choices, and the table.
 * A live preview shows the ticket as the switches are changed.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from '../components/Toast';
import { Button } from '../components/ui';
import { Field, ToggleRow } from '../components/form';
import { Icon } from '../components/icons';
import { kitchenOf } from '../data/restaurant';
import { printKitchenTicket } from '../data/docPrint';
import { printsOf } from '../data/printSetup';
import { explain } from '../data/refusal';
import type { KitchenSettings } from '../data/types';

export default function PrintingKitchenScreen() {
  const { colors } = useTheme();
  const { db, setPrinter } = useAppData();
  const { success, error } = useToast();
  const [k, setK] = useState<KitchenSettings>(() => kitchenOf(db));
  const [showMods, setShowMods] = useState(db?.printer?.showModifiers !== false);
  const [showTable, setShowTable] = useState(db?.printer?.showTable !== false);

  if (!db) return null;
  const set = (patch: Partial<KitchenSettings>) => setK((x) => ({ ...x, ...patch }));
  const kitchens = db.printers.filter((p) => printsOf(p).includes('order'));

  function save() {
    try {
      setPrinter({ kitchen: { ...k, title: k.title.trim() || 'KITCHEN ORDER', copies: Math.max(1, Math.min(5, Number(k.copies) || 1)) }, showModifiers: showMods, showTable });
      success('Kitchen ticket and receipt settings saved');
    } catch (e) { explain(e); }
  }

  async function test() {
    if (!kitchens.length) { error('No printer is set to print kitchen orders. Tick "Kitchen orders" on a printer first.'); return; }
    const doc = {
      kind: 'Kitchen Order', no: 'T001', ts: new Date().toISOString(), firmName: db!.firm.name, table: 'Table 4', servedBy: 'Sarah',
      lines: [
        { name: 'Chicken burger', qty: 2, price: 0, mods: ['Large', 'Extra cheese'], note: 'One without onions' },
        { name: 'Passion juice', qty: 1, price: 0, mods: ['No ice'] },
      ],
      subtotal: 0, total: 0, note: 'Test ticket',
    };
    for (const p of kitchens) {
      try { await printKitchenTicket(doc, p, k); success('Test ticket sent to ' + p.name); } catch (e: any) { error(e?.message || 'It did not print on ' + p.name); }
    }
  }

  const mono = { fontFamily: fonts.mono, fontSize: 12, color: '#222' } as const;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {/* preview */}
      <View style={{ backgroundColor: '#fff', borderRadius: 4, padding: 14, width: 260, alignSelf: 'center', marginBottom: 18, borderWidth: 1, borderColor: colors.line }}>
        <Text style={{ textAlign: 'center', fontFamily: fonts.uiExtra, fontSize: 18, color: '#111' }}>{k.title || 'KITCHEN ORDER'}</Text>
        {k.showTable ? <Text style={{ textAlign: 'center', fontFamily: fonts.uiExtra, fontSize: 16, color: '#111' }}>Table 4</Text> : null}
        <Text style={mono}>--------------------------------</Text>
        <Text style={mono}>Order                       T001</Text>
        {k.showTime ? <Text style={mono}>Time               14 Oct 19:42</Text> : null}
        {k.showServer ? <Text style={mono}>Server                     Sarah</Text> : null}
        <Text style={mono}>================================</Text>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: k.bigText ? 16 : 12.5, color: '#111' }}>2 x Chicken burger</Text>
        <Text style={mono}>   + Large</Text>
        <Text style={mono}>   + Extra cheese</Text>
        {k.showNotes ? <Text style={mono}>   * One without onions</Text> : null}
        <Text style={{ fontFamily: fonts.uiBold, fontSize: k.bigText ? 16 : 12.5, color: '#111' }}>1 x Passion juice</Text>
        <Text style={mono}>   + No ice</Text>
        <Text style={mono}>================================</Text>
        {k.footer ? <Text style={[mono, { textAlign: 'center' }]}>{k.footer}</Text> : null}
      </View>

      <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, letterSpacing: 0.6, color: colors.faint, textTransform: 'uppercase', marginBottom: 8 }}>Kitchen ticket</Text>
      <View style={{ borderRadius: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: 14, marginBottom: 18 }}>
        <Field label="Heading" value={k.title} onChangeText={(v) => set({ title: v })} placeholder="KITCHEN ORDER" />
        <ToggleRow bare label="Large print for the dishes" on={k.bigText} onChange={(v) => set({ bigText: v })} />
        <ToggleRow bare label="Table or ticket name" on={k.showTable} onChange={(v) => set({ showTable: v })} />
        <ToggleRow bare label="Time of the order" on={k.showTime} onChange={(v) => set({ showTime: v })} />
        <ToggleRow bare label="Who took the order" on={k.showServer} onChange={(v) => set({ showServer: v })} />
        <ToggleRow bare label="Notes for the kitchen" on={k.showNotes} onChange={(v) => set({ showNotes: v })} />
        <Field label="Copies" numeric money={false} value={String(k.copies)} onChangeText={(v) => set({ copies: Number(v) || 1 })} />
        <Field label="Line at the bottom" value={k.footer} onChangeText={(v) => set({ footer: v })} placeholder="Optional" />
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
          {kitchens.length ? 'Prints on: ' + kitchens.map((p) => p.name).join(', ') : 'No printer prints kitchen orders yet. In Printing, tick "Kitchen orders" on a printer.'}
        </Text>
      </View>

      <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, letterSpacing: 0.6, color: colors.faint, textTransform: 'uppercase', marginBottom: 8 }}>Customer receipt and bill</Text>
      <View style={{ borderRadius: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: 14, marginBottom: 18 }}>
        <ToggleRow bare label="Show each dish's choices" sub="+ Large, Extra cheese under the dish" on={showMods} onChange={setShowMods} />
        <ToggleRow bare label="Show the table or ticket name" on={showTable} onChange={setShowTable} />
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 6 }}>Header, footer, logo and paper are set in Receipt settings.</Text>
      </View>

      <View style={{ gap: 10 }}>
        <Button variant="pri" label="Save" icon={<Icon name="check" size={17} color={colors.accentInk} />} onPress={save} />
        <Button label="Print a test kitchen ticket" icon={<Icon name="print" size={16} color={colors.ink} />} onPress={test} />
      </View>
    </ScrollView>
  );
}
