/**
 * TAKING AN ORDER — the restaurant till (Loyverse-style).
 *
 * The menu fills the screen as tiles, by category. Tapping an item puts it on
 * the ticket; an item with modifiers first asks for its choices (size,
 * extras…). The ticket is held at the bottom:
 *
 *   Save    — keeps it as an open ticket for its table, sends what the kitchen
 *             has not had yet to the kitchen printer, and offers the customer
 *             a printed bill.
 *   Charge  — takes the payment, records the order as a sale and closes the
 *             ticket, then offers the customer's receipt.
 *
 * Open tickets are shared with every phone, so any waiter can add to a table's
 * order or charge it.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, ScrollView, Alert, Image, useWindowDimensions } from 'react-native';
import { Pressable } from '../components/Press';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from '../components/Toast';
import { Icon } from '../components/icons';
import Sheet from '../components/Sheet';
import { Button } from '../components/ui';
import { Field } from '../components/form';
import { useDocBuilder } from '../components/DocActions';
import { printDoc, printKitchenTicket, DocMeta } from '../data/docPrint';
import { printOptsFor, printsOf } from '../data/printSetup';
import { groupsFor, kitchenOf, modifierText, sameOrderLine, menuSections, stationOf, printsStation, ORDER_TYPES, orderTypeWord } from '../data/restaurant';
import { explain } from '../data/refusal';
import { AppBar } from '../components/AppBar';
import type { OrderType, PayMethod, Product, SaleLine, SaleModifier, Ticket } from '../data/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Order'>;


export default function OrderScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { db, money, saveTicket, closeTicket, voidTicket, commitSale, user, can, sendKitchenOrder } = useAppData();
  // what this person may do here (Staff & roles → Restaurant)
  const mayCharge = can('restaurant.charge');
  const mayCancel = can('restaurant.cancel');
  const seeAll = can('restaurant.all_tickets');
  const mayBill = can('restaurant.print_bill');
  const maySwitch = can('restaurant.switch_menu');
  const { saleDoc } = useDocBuilder();
  const { success, error } = useToast();

  const [ticketId, setTicketId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [sent, setSent] = useState<number[]>([]);
  const [category, setCategory] = useState('All');
  const [q, setQ] = useState('');
  const [modsFor, setModsFor] = useState<Product | null>(null);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [ticketOpen, setTicketOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [openList, setOpenList] = useState(false);
  const [paying, setPaying] = useState(false);
  const [method, setMethod] = useState<PayMethod>('cash');
  const [received, setReceived] = useState('');
  const [orderNote, setOrderNote] = useState('');
  /** Splitting the bill: how many of each line this payer takes; null when not splitting. */
  const [split, setSplit] = useState<number[] | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [people, setPeople] = useState(2);
  const [openView, setOpenView] = useState<'tables' | 'list'>((db?.settings.tables || []).length ? 'tables' : 'list');
  const [orderType, setOrderType] = useState<OrderType>(db?.settings.defaultOrderType || 'dine');
  // which menu is being sold from: someone kept to one menu (a bartender) cannot change it
  const menus = db?.menus || [];
  const meUser = db?.users.find((u) => u.id === db?.session.userId);
  const lockedMenu = meUser?.menuId ? menus.find((x) => x.id === meUser.menuId) : undefined;
  const [menuId, setMenuId] = useState<string>(lockedMenu?.id || '__all');
  const [menuPick, setMenuPick] = useState(false);
  const activeMenu = lockedMenu || menus.find((x) => x.id === menuId);

  // without "See other waiters' tickets", a waiter sees only their own tables
  const open = (db?.tickets || []).filter((t) => t.status === 'open' && (seeAll || t.userId === db?.session.userId));

  // opened on a ticket from elsewhere (Activity, a notification)
  useEffect(() => {
    const id = route.params?.ticketId;
    const t = id ? open.find((x) => x.id === id) : undefined;
    if (t) load(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.ticketId]);


  const menu = useMemo(() => (db?.products || []).filter((p) => p.active !== false && !p.ingredient), [db]);
  const allSections = useMemo(() => menuSections(db), [db]);
  // only the sections of the menu being sold from
  const sections = activeMenu ? allSections.filter((x) => activeMenu.sections.includes(x.name)) : allSections;
  const colorOf = (cat?: string) => allSections.find((s) => s.name === (cat || 'Other'))?.color || '#ECEFF1';
  const categories = ['All', ...sections.map((s) => s.name)];
  const needle = q.trim().toLowerCase();
  // in the menu's own order: section by section, available dishes first
  const rank = new Map(sections.map((s, i) => [s.name, i]));
  const onMenu = (p: Product) => !activeMenu || activeMenu.sections.includes(p.category || 'Other');
  const shown = menu.filter((p) => onMenu(p) && (category === 'All' || (p.category || 'Other') === category)
    && (!needle || p.name.toLowerCase().includes(needle) || (p.sku || '').toLowerCase().includes(needle)))
    .sort((a, b) => ((rank.get(a.category || 'Other') ?? 99) - (rank.get(b.category || 'Other') ?? 99))
      || (Number(!!a.soldOut) - Number(!!b.soldOut)) || a.name.localeCompare(b.name));

  const cols = width >= 700 ? 5 : width >= 420 ? 3 : 2;
  const tileW = (width - 32 - (cols - 1) * 10) / cols;

  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
  // the service charge is for eating in
  const servicePct = orderType === 'dine' ? Number(db?.settings.serviceChargePct) || 0 : 0;
  const service = Math.round(subtotal * servicePct / 100);
  const total = subtotal + service;
  const splitSub = split ? lines.reduce((s, l, i) => s + (split[i] || 0) * l.price, 0) : 0;
  const splitService = split ? Math.round(splitSub * servicePct / 100) : 0;
  const due = split ? splitSub + splitService : total;
  const count = lines.reduce((s, l) => s + l.qty, 0);
  /** At least one dish with a quantity: only then can the ticket be saved or charged. */
  const hasDish = lines.some((l) => l.qty > 0);
  const unsent = lines.reduce((s, l, i) => s + Math.max(0, l.qty - (sent[i] || 0)), 0);
  const me = user(db?.session.userId || '')?.name;

  function clear() {
    setTicketId(null); setName(''); setLines([]); setSent([]); setTicketOpen(false); setEditing(null); setOrderNote('');
    setOrderType(db?.settings.defaultOrderType || 'dine');
  }

  function load(t: Ticket) {
    setTicketId(t.id); setName(t.name); setLines(t.lines.map((l) => ({ ...l }))); setSent([...t.sent]);
    setOrderType(t.orderType || 'dine');
    setOrderNote(t.note || '');
    setOpenList(false); setTicketOpen(true);
  }

  /* ---------------- adding to the ticket ---------------- */

  function tap(p: Product) {
    if (p.soldOut) { error(p.name + ' is sold out.'); return; }
    if (groupsFor(db, p).length) { setPicked({}); setModsFor(p); return; }
    add(p, []);
  }

  function add(p: Product, mods: SaleModifier[]) {
    const line: SaleLine = {
      productId: p.id, name: p.name, sku: p.sku, unit: p.unit, qty: 1,
      price: p.price + mods.reduce((s, m) => s + m.price, 0), cost: p.cost, taxRate: p.taxRate,
      ...(mods.length ? { modifiers: mods } : {}),
    };
    setLines((prev) => {
      const i = prev.findIndex((l) => sameOrderLine(l, line));
      if (i >= 0) return prev.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, line];
    });
  }

  function confirmMods() {
    if (!modsFor) return;
    const groups = groupsFor(db, modsFor);
    const missing = groups.find((g) => g.required && !(picked[g.id] || []).length);
    if (missing) { error('Choose a ' + missing.name.toLowerCase() + '.'); return; }
    const mods: SaleModifier[] = [];
    groups.forEach((g) => (picked[g.id] || []).forEach((oid) => {
      const o = g.options.find((x) => x.id === oid);
      if (o) mods.push({ group: g.name, name: o.name, price: o.price });
    }));
    add(modsFor, mods);
    setModsFor(null);
  }

  function toggleOption(groupId: string, optionId: string, multi: boolean) {
    setPicked((prev) => {
      const now = prev[groupId] || [];
      const next = multi ? (now.includes(optionId) ? now.filter((x) => x !== optionId) : [...now, optionId]) : [optionId];
      return { ...prev, [groupId]: next };
    });
  }

  function changeQty(i: number, by: number) {
    setLines((prev) => prev.map((l, k) => (k === i ? { ...l, qty: Math.max(0, l.qty + by) } : l)).filter((l) => l.qty > 0 || (sent[i] || 0) > 0));
  }

  function removeLine(i: number) {
    const go = () => {
      setLines((prev) => prev.filter((_, k) => k !== i));
      setSent((prev) => prev.filter((_, k) => k !== i));
      setEditing(null);
    };
    if ((sent[i] || 0) > 0) {
      Alert.alert('Remove a sent item?', lines[i].name + ' was already sent to the kitchen. Tell the kitchen it is cancelled.', [
        { text: 'Keep it', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: go },
      ]);
      return;
    }
    go();
  }

  /* ---------------- the kitchen and the bill ---------------- */

  function docOf(ls: DocMeta['lines'], kind: string, no: string, priced = false): DocMeta {
    const sub = ls.reduce((s, l) => s + l.qty * l.price, 0);
    return {
      kind, no, ts: new Date().toISOString(), firmName: db?.firm.name || '', firmPhone: db?.firm.phone, firmAddress: db?.firm.address,
      // the kitchen reads the type off its banner; the customer's bill says it beside the table
      table: (priced ? [name.trim(), orderTypeWord(orderType)].filter(Boolean).join(' · ') : name.trim()) || undefined, orderType, servedBy: me, lines: ls,
      ...(orderNote.trim() ? { note: orderNote.trim() } : {}),
      subtotal: priced ? sub : 0, total: priced ? sub + Math.round(sub * servicePct / 100) : 0,
      ...(priced && servicePct ? { charges: Math.round(sub * servicePct / 100) } : {}),
    };
  }

  const docLine = (l: SaleLine, qty: number) => ({
    name: l.name, qty, price: l.price, unit: l.unit,
    ...(l.modifiers?.length ? { mods: l.modifiers.map((m) => m.name) } : {}),
    ...(l.note ? { note: l.note } : {}),
  });

  /** Sends only what the kitchen has not had yet. Quiet when there is nothing new. */
  async function sendToKitchen(no: string) {
    if (!db) return;
    const fresh = lines.map((l, i) => ({ l, n: l.qty - (sent[i] || 0) })).filter((x) => x.n > 0)
      .map((x) => ({ station: stationOf(db, db.products.find((p) => p.id === x.l.productId)), line: docLine(x.l, x.n) }));
    if (!fresh.length) return;
    // the kitchen display gets every round, with or without printers
    if (db.settings.kitchenDisplay) {
      try {
        sendKitchenOrder({
          ticketId: ticketId || undefined, no, table: name.trim() || undefined, orderType, by: me,
          note: orderNote.trim() || undefined,
          lines: fresh.map((f) => ({ name: f.line.name, qty: f.line.qty, mods: f.line.mods, note: f.line.note, station: f.station })),
        });
      } catch (e) { explain(e); }
    }
    const kitchens = db.printers.filter((p) => printsOf(p).includes('order'));
    if (!kitchens.length) {
      if (!db.settings.kitchenDisplay) error('No kitchen printer is set up. Add one under Settings, Printing, and tick "Kitchen orders" — or switch on the kitchen display.');
      return;
    }
    const missed = new Set(fresh.map((f) => f.station));
    await Promise.all(kitchens.map((p) => {
      const mine = fresh.filter((f) => printsStation(p, f.station));
      mine.forEach((f) => missed.delete(f.station));
      if (!mine.length) return Promise.resolve();
      const k = kitchenOf(db);
      const stationsHere = [...new Set(mine.map((f) => f.station))];
      return printKitchenTicket(docOf(mine.map((f) => f.line), 'Kitchen Order', no), p, { ...k, title: p.stations?.length === 1 ? stationsHere[0].toUpperCase() : k.title })
        .catch((e) => error('The order did not print on ' + p.name + ': ' + (e?.message || 'the printer did not answer')));
    }));
    if (missed.size) error('No printer is set for ' + [...missed].join(', ') + '. Tick it on a printer under Settings, Printing.');
  }

  async function printBill(no: string) {
    if (!db) return;
    try {
      await printDoc(docOf(lines.filter((l) => l.qty > 0).map((l) => docLine(l, l.qty)), 'Bill', no, true), money, printOptsFor(db, 'receipt', undefined, 'cash'));
    } catch (e: any) {
      error(e?.message || 'The bill did not print.');
    }
  }

  async function save() {
    // a ticket with nothing on it is not an order: every dish taken off counts as nothing
    if (!hasDish) { error('Add at least one dish before saving the ticket.'); return; }
    let t: Ticket;
    try {
      t = saveTicket({ id: ticketId || undefined, name: name.trim(), lines, sent: lines.map((l) => l.qty), orderType, note: orderNote.trim() });
    } catch (e) { explain(e); return; }
    await sendToKitchen(t.no);
    const saved = lines;
    const tableName = t.name;
    clear();
    success(tableName + ' saved' + (unsent ? ' · sent to the kitchen' : ''));
    if (!mayBill) { Alert.alert(tableName + ' saved', unsent ? 'The new items went to the kitchen.' : 'Nothing new for the kitchen.'); return; }
    Alert.alert(tableName + ' saved', unsent ? 'The new items went to the kitchen.' : 'Nothing new for the kitchen.', [
      { text: 'Done', style: 'cancel' },
      {
        text: 'Print bill for customer', onPress: () => {
          if (!db) return;
          const ls = saved.filter((l) => l.qty > 0).map((l) => docLine(l, l.qty));
          printDoc({ ...docOf(ls, 'Bill', t.no, true), table: [tableName, orderTypeWord(t.orderType)].filter(Boolean).join(' · '), orderType: t.orderType }, money, printOptsFor(db, 'receipt', undefined, 'cash'))
            .catch((e: any) => error(e?.message || 'The bill did not print.'));
        },
      },
    ]);
  }

  async function charge() {
    if (!lines.some((l) => l.qty > 0)) return;
    const taking = split ? lines.map((l, i) => ({ ...l, qty: split[i] || 0 })).filter((l) => l.qty > 0) : lines.filter((l) => l.qty > 0);
    if (!taking.length) { error('Choose what this person is paying for.'); return; }
    const paid = method === 'cash' ? Number(received) || due : due;
    if (method === 'cash' && paid < due - 0.005) { error('The cash received is less than the total.'); return; }
    let sale;
    try {
      sale = commitSale({
        lines: taking, partyId: null, method, discount: 0,
        additionalCharges: (split ? splitService : service) || undefined,
        ticketName: (name.trim() || '') + (split ? ' (split)' : '') || undefined, orderType,
        description: orderNote.trim() || undefined,
      });
    } catch (e) { explain(e); return; }
    // anything not yet cooked still goes to the kitchen
    await sendToKitchen(sale.no);
    const change = Math.max(0, paid - due);
    // a split: what is left stays on the ticket for the next payer
    const rest = split ? lines.map((l, i) => ({ ...l, qty: l.qty - (split[i] || 0) })) : [];
    if (split && rest.some((l) => l.qty > 0)) {
      const keep = rest.filter((l) => l.qty > 0);
      try {
        const t = saveTicket({ id: ticketId || undefined, name: name.trim(), lines: keep, sent: keep.map((l) => l.qty), orderType, note: orderNote.trim() });
        setTicketId(t.id); setLines(keep); setSent(keep.map((l) => l.qty));
      } catch (e) { explain(e); }
      setSplit(null); setPaying(false); setReceived(''); setMethod('cash');
      success(sale.no + ' paid' + (change ? ' · change ' + money(change) : '') + ' · ' + money(keep.reduce((n, l) => n + l.qty * l.price, 0)) + ' left on the ticket');
      if (db?.printer?.autoPrint) printDoc(saleDoc(sale, 'Receipt'), money, printOptsFor(db, 'receipt', undefined, 'cash')).catch(() => {});
      return;
    }
    if (ticketId) closeTicket(ticketId, sale.id);
    setSplit(null);
    clear();
    setPaying(false); setReceived(''); setMethod('cash');
    if (db?.printer?.autoPrint) {
      printDoc(saleDoc(sale, 'Receipt'), money, printOptsFor(db, 'receipt', undefined, 'cash')).catch((e: any) => error(e?.message || 'The receipt did not print.'));
      success(sale.no + ' paid' + (change ? ' · change ' + money(change) : ''));
      return;
    }
    Alert.alert('Paid · ' + money(sale.total), change ? 'Change due: ' + money(change) : 'Thank you.', [
      { text: 'No receipt', style: 'cancel' },
      {
        text: 'Print receipt', onPress: () => {
          if (!db) return;
          printDoc(saleDoc(sale!, 'Receipt'), money, printOptsFor(db, 'receipt', undefined, 'cash')).catch((e: any) => error(e?.message || 'The receipt did not print.'));
        },
      },
    ]);
  }

  if (!db) return null;

  const modGroups = modsFor ? groupsFor(db, modsFor) : [];
  const modExtra = modGroups.reduce((s, g) => s + (picked[g.id] || []).reduce((a, oid) => a + (g.options.find((o) => o.id === oid)?.price || 0), 0), 0);
  const line = editing !== null ? lines[editing] : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AppBar
        title="Order"
        onBack={route.name === 'Order' ? () => navigation.goBack() : undefined}
        right={(
          <Pressable onPress={() => setOpenList(true)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.ink }}>
            <Icon name="receipt" size={15} color={colors.bg} />
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: colors.bg }}>Open tickets {open.length}</Text>
          </Pressable>
        )}
      />
      {/* the menu */}
      <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Field icon="search" label="Search the menu" value={q} onChangeText={setQ} autoCorrect={false} style={{ marginBottom: 8 }} />
          </View>
          {menus.length ? (
            <Pressable
              onPress={() => (lockedMenu ? error('You sell from the ' + lockedMenu.name + ' menu. The owner can change it in Menu & modifiers.')
                : !maySwitch ? error('Your role cannot change the menu. Ask the owner to allow it under Staff & roles.') : setMenuPick(true))}
              accessibilityLabel="Choose the menu"
              style={{ marginTop: 6, height: 56, maxWidth: 150, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1.4, borderColor: colors.ink, backgroundColor: colors.surface }}
            >
              <Icon name={lockedMenu ? 'lock' : 'doc'} size={16} color={colors.ink} />
              <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.uiBold, fontSize: 13.5, color: colors.ink }}>{activeMenu ? activeMenu.name : 'All menus'}</Text>
              {lockedMenu ? null : <Icon name="down" size={14} color={colors.ink} />}
            </Pressable>
          ) : null}
        </View>
      </View>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 10 }}>
          {categories.map((c) => {
            const on = c === category;
            return (
              <Pressable key={c} onPress={() => setCategory(c)} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: on ? colors.ink : colors.surface, borderWidth: 1, borderColor: on ? colors.ink : colors.line }}>
                {c !== 'All' ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colorOf(c), borderWidth: 1, borderColor: on ? colors.bg : colors.lineHard }} /> : null}
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: on ? colors.bg : colors.ink }}>{c}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <FlatList
        key={cols}
        data={shown}
        numColumns={cols}
        keyExtractor={(p) => p.id}
        columnWrapperStyle={{ gap: 10, paddingHorizontal: 16 }}
        contentContainerStyle={{ gap: 10, paddingBottom: 120 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={(
          <View style={{ alignItems: 'center', padding: 40, gap: 8 }}>
            <Icon name="food" size={34} color={colors.faint} />
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.faint, textAlign: 'center' }}>
              {menu.length ? 'Nothing matches.' : 'Your menu is empty. Add dishes under More, Menu & modifiers.'}
            </Text>
          </View>
        )}
        renderItem={({ item: p }) => {
          const inTicket = lines.filter((l) => l.productId === p.id).reduce((s, l) => s + l.qty, 0);
          return (
            <Pressable
              onPress={() => tap(p)}
              style={({ pressed }) => ({
                width: tileW, minHeight: 96, borderRadius: 16, overflow: 'hidden', justifyContent: 'space-between',
                backgroundColor: colorOf(p.category), opacity: p.soldOut ? 0.45 : pressed ? 0.7 : 1,
                borderWidth: inTicket ? 2 : 0, borderColor: colors.ink,
              })}
            >
              {p.photo ? <Image source={{ uri: p.photo }} style={{ width: '100%', height: tileW * 0.62 }} resizeMode="cover" /> : null}
              {p.soldOut ? (
                <View style={{ position: 'absolute', top: 8, left: 8, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: '#1B1B1F' }}>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 10.5, color: '#fff' }}>SOLD OUT</Text>
                </View>
              ) : null}
              <View style={{ padding: 12, paddingTop: p.photo ? 8 : 12, flex: 1, justifyContent: 'space-between' }}>
              <Text numberOfLines={p.photo ? 2 : 3} style={{ fontFamily: fonts.uiBold, fontSize: 14.5, color: '#1B1B1F' }}>{p.name}</Text>
              {p.tags?.length ? <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 11, color: '#3C3C43', marginTop: 2 }}>{p.tags.join(' · ')}</Text> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: '#3C3C43' }}>{money(p.price)}</Text>
                {inTicket ? (
                  <View style={{ minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: '#1B1B1F', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, color: '#fff' }}>{inTicket}</Text>
                  </View>
                ) : groupsFor(db, p).length ? <Icon name="dots" size={16} color="#3C3C43" /> : null}
              </View>
              </View>
            </Pressable>
          );
        }}
      />

      {/* the ticket bar */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, paddingBottom: 12 + insets.bottom, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line, flexDirection: 'row', gap: 10 }}>
        <Pressable
          onPress={() => setTicketOpen(true)}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, height: 52, borderRadius: 14, backgroundColor: colors.sunk }}
        >
          <Icon name="receipt" size={19} color={colors.ink} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.ink }}>{name.trim() || (ticketId ? 'Ticket' : 'New ticket')} · {count} item{count === 1 ? '' : 's'}</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{unsent ? unsent + ' not sent to kitchen' : lines.length ? 'All sent to kitchen' : 'Tap dishes to add them'}</Text>
          </View>
        </Pressable>
        <Pressable
          disabled={!lines.length}
          onPress={() => (mayCharge ? setPaying(true) : error('Your role cannot take payment. Save the ticket and the cashier charges it.'))}
          style={{ minWidth: 120, height: 52, borderRadius: 14, backgroundColor: lines.length ? colors.good : colors.sunk, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 }}
        >
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 15, color: lines.length ? '#fff' : colors.faint }}>Charge</Text>
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: lines.length ? '#fff' : colors.faint }}>{money(total)}</Text>
        </Pressable>
      </View>

      {/* choosing the menu */}
      <Sheet visible={menuPick} title="Sell from" icon="doc" onClose={() => setMenuPick(false)}>
        {[{ id: '__all', name: 'All menus', sections: allSections.map((x) => x.name) }, ...menus].map((mn) => {
          const on = (activeMenu?.id || '__all') === mn.id;
          return (
            <Pressable
              key={mn.id}
              onPress={() => { setMenuId(mn.id); setCategory('All'); setMenuPick(false); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 14, borderWidth: 1.4, borderColor: on ? colors.ink : colors.line, backgroundColor: on ? colors.sunk : colors.surface }}
            >
              <Icon name="doc" size={18} color={colors.ink} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{mn.name}</Text>
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>{mn.sections.join(' · ')}</Text>
              </View>
              {on ? <Icon name="check" size={18} color={colors.ink} /> : null}
            </Pressable>
          );
        })}
      </Sheet>

      {/* choosing the item's modifiers */}
      <Sheet
        visible={!!modsFor}
        title={modsFor?.name || ''}
        subtitle={modsFor ? money(modsFor.price + modExtra) : undefined}
        icon="food"
        full
        onClose={() => setModsFor(null)}
        footer={<Button variant="pri" label={'Add to ticket · ' + money((modsFor?.price || 0) + modExtra)} onPress={confirmMods} />}
      >
        {modGroups.map((g) => (
          <View key={g.id} style={{ marginBottom: 16 }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: colors.faint, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {g.name}{g.required ? ' · required' : ''}{g.multi ? ' · choose any' : ' · choose one'}
            </Text>
            {g.options.map((o) => {
              const on = (picked[g.id] || []).includes(o.id);
              return (
                <Pressable
                  key={o.id}
                  onPress={() => toggleOption(g.id, o.id, g.multi)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, marginBottom: 6, borderRadius: 12, borderWidth: 1.4, borderColor: on ? colors.ink : colors.line, backgroundColor: on ? colors.sunk : colors.surface }}
                >
                  <View style={{ width: 20, height: 20, borderRadius: g.multi ? 5 : 10, borderWidth: 2, borderColor: on ? colors.ink : colors.lineHard, backgroundColor: on ? colors.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                    {on ? <Icon name="check" size={12} color={colors.bg} /> : null}
                  </View>
                  <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{o.name}</Text>
                  {o.price ? <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.soft }}>+{money(o.price)}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </Sheet>

      {/* the ticket */}
      <Sheet
        visible={ticketOpen}
        title={ticketId ? 'Ticket' : 'New ticket'}
        subtitle={count + ' item' + (count === 1 ? '' : 's') + ' · ' + money(total)}
        icon="receipt"
        full
        onClose={() => { setTicketOpen(false); setEditing(null); }}
        footer={(
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Button label={unsent ? 'Save · send ' + unsent : 'Save'} icon={<Icon name="print" size={16} color={colors.ink} />} disabled={!hasDish} onPress={save} /></View>
            {mayCharge ? (
              <View style={{ flex: 1 }}><Button variant="pri" label={'Charge ' + money(total)} disabled={!lines.length} onPress={() => { setTicketOpen(false); setTimeout(() => setPaying(true), 250); }} /></View>
            ) : null}
          </View>
        )}
      >
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          {ORDER_TYPES.map((o) => {
            const on = orderType === o.v;
            return (
              <Pressable key={o.v} onPress={() => setOrderType(o.v)} style={{ flex: 1, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1.4, borderColor: on ? colors.ink : colors.line, backgroundColor: on ? colors.ink : colors.surface }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 13.5, color: on ? colors.bg : colors.ink }}>{o.l}</Text>
              </Pressable>
            );
          })}
        </View>
        <Field icon="chair" label={orderType === 'dine' ? 'Table' : orderType === 'delivery' ? 'Customer and address' : 'Name'} value={name} onChangeText={setName} placeholder={orderType === 'dine' ? 'Table 4' : orderType === 'delivery' ? 'John, Ntinda' : 'John'} />
        {lines.map((l, i) => {
          const s = sent[i] || 0;
          return (
            <View key={i} style={{ borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Pressable onPress={() => setEditing(editing === i ? null : i)} style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{l.name}</Text>
                  {l.modifiers?.length ? <Text numberOfLines={2} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.soft, marginTop: 1 }}>+ {modifierText(l.modifiers)}</Text> : null}
                  {l.note ? <Text numberOfLines={2} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.warn, marginTop: 1 }}>* {l.note}</Text> : null}
                  <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: s >= l.qty ? colors.good : colors.faint, marginTop: 2 }}>
                    {s >= l.qty ? 'Sent to kitchen' : s ? s + ' sent · ' + (l.qty - s) + ' new' : 'Not sent yet'}
                  </Text>
                </Pressable>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Pressable onPress={() => changeQty(i, -1)} hitSlop={6} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 18, color: colors.ink }}>−</Text>
                  </Pressable>
                  <Text style={{ minWidth: 22, textAlign: 'center', fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{l.qty}</Text>
                  <Pressable onPress={() => changeQty(i, 1)} hitSlop={6} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 18, color: colors.ink }}>+</Text>
                  </Pressable>
                </View>
                <Text style={{ width: 84, textAlign: 'right', fontFamily: fonts.uiBold, fontSize: 14, color: colors.ink }}>{money(l.qty * l.price)}</Text>
              </View>
              {editing === i && line ? (
                <View style={{ marginTop: 10 }}>
                  <Field label="Note for the kitchen" value={line.note || ''} onChangeText={(v) => setLines((prev) => prev.map((x, k) => (k === i ? { ...x, note: v } : x)))} placeholder="Well done, no ice…" />
                  <Button variant="dngr" size="sm" label="Remove from ticket" icon={<Icon name="trash" size={15} color={colors.danger} />} onPress={() => removeLine(i)} />
                </View>
              ) : null}
            </View>
          );
        })}
        {lines.length ? (
          <Field icon="doc" label="Note for the whole order" multiline value={orderNote} onChangeText={setOrderNote} placeholder="Allergic to nuts, serve together…" style={{ marginTop: 12 }} />
        ) : null}
        {!lines.length ? (
          <Text style={{ fontFamily: fonts.ui, fontSize: 14, color: colors.faint, textAlign: 'center', paddingVertical: 24 }}>The ticket is empty. Tap dishes on the menu to add them.</Text>
        ) : (
          <View style={{ paddingVertical: 10, gap: 4 }}>
            <View style={{ flexDirection: 'row' }}><Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 13.5, color: colors.soft }}>Subtotal</Text><Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{money(subtotal)}</Text></View>
            {service ? <View style={{ flexDirection: 'row' }}><Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 13.5, color: colors.soft }}>Service charge {servicePct}%</Text><Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{money(service)}</Text></View> : null}
            <View style={{ flexDirection: 'row' }}><Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>Total</Text><Text style={{ fontFamily: fonts.uiExtra, fontSize: 15, color: colors.ink }}>{money(total)}</Text></View>
          </View>
        )}
        {lines.length ? (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            {mayCharge && count > 1 ? (
              <View style={{ flex: 1 }}><Button size="sm" label="Split bill" icon={<Icon name="swap" size={15} color={colors.ink} />} onPress={() => { setSplit(lines.map(() => 0)); setTicketOpen(false); setTimeout(() => setSplitOpen(true), 250); }} /></View>
            ) : null}
            {mayBill ? (
              <View style={{ flex: 1 }}><Button size="sm" label="Print bill" icon={<Icon name="print" size={15} color={colors.ink} />} onPress={() => printBill(ticketId ? (open.find((t) => t.id === ticketId)?.no || 'BILL') : 'BILL')} /></View>
            ) : null}
            {!ticketId || mayCancel ? <View style={{ flex: 1 }}>
              <Button size="sm" variant="dngr" label={ticketId ? 'Cancel ticket' : 'Clear'} onPress={() => Alert.alert(ticketId ? 'Cancel this ticket?' : 'Clear the ticket?', 'Everything on it is removed.' + (ticketId ? ' Tell the kitchen if food was already sent.' : ''), [
                { text: 'Keep it', style: 'cancel' },
                { text: ticketId ? 'Cancel ticket' : 'Clear', style: 'destructive', onPress: () => { try { if (ticketId) voidTicket(ticketId); clear(); } catch (e) { explain(e); } } },
              ])} />
            </View> : null}
          </View>
        ) : null}
      </Sheet>

      {/* open tickets */}
      <Sheet visible={openList} title={openView === 'tables' ? 'Tables' : 'Open tickets'} subtitle={open.length + ' waiting to be paid'} icon="receipt" full onClose={() => setOpenList(false)}>
        {(db.settings.tables || []).length ? (
          <View style={{ flexDirection: 'row', padding: 4, borderRadius: 12, backgroundColor: colors.sunk, marginBottom: 12 }}>
            {(['tables', 'list'] as const).map((v) => (
              <Pressable key={v} onPress={() => setOpenView(v)} style={{ flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center', backgroundColor: openView === v ? colors.surface : 'transparent' }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: openView === v ? colors.ink : colors.faint }}>{v === 'tables' ? 'Table plan' : 'All open tickets'}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {openView === 'tables' && (db.settings.tables || []).length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {(db.settings.tables || []).map((tn) => {
              // a table is busy while a ticket is open under its name (anyone's: two waiters must not seat the same table)
              const t = (db.tickets || []).find((x) => x.status === 'open' && x.name.trim().toLowerCase() === tn.trim().toLowerCase());
              const mine = !t || seeAll || t.userId === db.session.userId;
              const mins = t ? Math.round((Date.now() - new Date(t.ts).getTime()) / 60000) : 0;
              const amt = t ? t.lines.reduce((s, l) => s + l.qty * l.price, 0) : 0;
              const long = mins >= 90;
              return (
                <Pressable
                  key={tn}
                  onPress={() => {
                    if (t && !mine) { error(tn + ' is being served by another waiter.'); return; }
                    if (t) { load(t); return; }
                    // a free table: a new ticket under its name, eaten in
                    if (lines.length && !ticketId) { error('Save or clear the ticket you are on first.'); return; }
                    clear(); setName(tn); setOrderType('dine'); setOpenList(false);
                  }}
                  style={{
                    width: '31%', minHeight: 84, padding: 10, borderRadius: 14, justifyContent: 'space-between',
                    backgroundColor: t ? (long ? colors.dangerSoft : colors.warnSoft) : colors.goodSoft,
                    borderWidth: ticketId && t?.id === ticketId ? 2 : 0, borderColor: colors.ink, opacity: mine ? 1 : 0.55,
                  }}
                >
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 14.5, color: colors.ink }}>{tn}</Text>
                  {t ? (
                    <>
                      {(db.kitchenOrders || []).some((k) => k.ticketId === t.id && k.status === 'ready') ? (
                        <Text style={{ fontFamily: fonts.uiExtra, fontSize: 11.5, color: colors.good }}>● READY</Text>
                      ) : null}
                      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: long ? colors.danger : colors.warn }}>{money(amt)}</Text>
                      <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.soft }}>{mins < 60 ? mins + ' min' : Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min'}</Text>
                    </>
                  ) : (
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.good }}>Free</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        ) : open.length ? open.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((t) => {
          const amt = t.lines.reduce((s, l) => s + l.qty * l.price, 0);
          return (
            <Pressable
              key={t.id}
              onPress={() => {
                if (lines.length && ticketId !== t.id) {
                  Alert.alert('Switch tickets?', 'The ticket you are on has not been saved.', [
                    { text: 'Stay', style: 'cancel' }, { text: 'Switch', onPress: () => load(t) },
                  ]);
                  return;
                }
                load(t);
              }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 14, borderWidth: 1, borderColor: ticketId === t.id ? colors.ink : colors.line, backgroundColor: pressed ? colors.sunk : colors.surface })}
            >
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="chair" size={19} color={colors.ink} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{t.name}</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
                  {t.no}{t.orderType ? ' · ' + orderTypeWord(t.orderType) : ''} · {t.lines.reduce((s, l) => s + l.qty, 0)} items · {new Date(t.updatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{money(amt)}</Text>
            </Pressable>
          );
        }) : (
          <Text style={{ fontFamily: fonts.ui, fontSize: 14, color: colors.faint, textAlign: 'center', paddingVertical: 24 }}>No open tickets. Save a ticket to keep a table's order open.</Text>
        )}
        {ticketId || lines.length ? <Button label="Start a new ticket" icon={<Icon name="plus" size={16} color={colors.ink} />} onPress={() => { clear(); setOpenList(false); }} /> : null}
      </Sheet>

      {/* splitting the bill */}
      <Sheet
        visible={splitOpen && !!split}
        title="Split the bill"
        subtitle={'Choose what this person pays for · ' + money(due)}
        icon="swap"
        full
        onClose={() => { setSplitOpen(false); setSplit(null); }}
        footer={(
          <Button variant="pri" label={'Charge this share · ' + money(due)} disabled={!splitSub} onPress={() => { setSplitOpen(false); setTimeout(() => setPaying(true), 250); }} />
        )}
      >
        {/* evenly: what each pays */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.sunk, marginBottom: 14 }}>
          <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>Split evenly between</Text>
          <Pressable onPress={() => setPeople(Math.max(2, people - 1))} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 18, color: colors.ink }}>−</Text></Pressable>
          <Text style={{ minWidth: 24, textAlign: 'center', fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{people}</Text>
          <Pressable onPress={() => setPeople(Math.min(30, people + 1))} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 18, color: colors.ink }}>+</Text></Pressable>
        </View>
        <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.soft, marginBottom: 14 }}>
          {people} people pay {money(Math.ceil(total / people / 100) * 100)} each (of {money(total)}). To give each their own receipt, pick their dishes below.
        </Text>
        {split ? lines.map((l, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 14.5, color: colors.ink }}>{l.name}</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{l.qty} on the ticket · {money(l.price)} each</Text>
            </View>
            <Pressable onPress={() => setSplit(split.map((q, k) => (k === i ? Math.max(0, q - 1) : q)))} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 18, color: colors.ink }}>−</Text></Pressable>
            <Text style={{ minWidth: 22, textAlign: 'center', fontFamily: fonts.uiBold, fontSize: 15, color: split[i] ? colors.accent : colors.faint }}>{split[i] || 0}</Text>
            <Pressable onPress={() => setSplit(split.map((q, k) => (k === i ? Math.min(l.qty, q + 1) : q)))} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 18, color: colors.ink }}>+</Text></Pressable>
          </View>
        )) : null}
        {split ? (
          <Pressable onPress={() => setSplit(lines.map((l) => l.qty))} style={{ alignSelf: 'center', paddingVertical: 12 }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 13.5, color: colors.accent }}>Everything left</Text>
          </Pressable>
        ) : null}
      </Sheet>

      {/* payment */}
      <Sheet
        visible={paying}
        title={(split ? 'Charge a share · ' : 'Charge ') + money(due)}
        subtitle={name.trim() || undefined}
        icon="cash"
        iconTone="good"
        onClose={() => { setPaying(false); setSplit(null); }}
        footer={<Button variant="pri" label={'Take payment · ' + money(due)} onPress={charge} />}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {([['cash', 'Cash', 'cash'], ['momo', 'Mobile money', 'phone'], ['bank', 'Card / bank', 'card']] as const).map(([v, l, i]) => {
            const on = method === v;
            return (
              <Pressable key={v} onPress={() => setMethod(v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 11, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1.4, borderColor: on ? colors.ink : colors.line, backgroundColor: on ? colors.ink : colors.surface }}>
                <Icon name={i} size={16} color={on ? colors.bg : colors.ink} />
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: on ? colors.bg : colors.ink }}>{l}</Text>
              </Pressable>
            );
          })}
        </View>
        {method === 'cash' ? (
          <>
            <Field label="Cash received" numeric decimal value={received} onChangeText={setReceived} placeholder={String(due)} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {[due, Math.ceil(due / 5000) * 5000, Math.ceil(due / 10000) * 10000, Math.ceil(due / 50000) * 50000]
                .filter((v, i, a) => v > 0 && a.indexOf(v) === i).map((v) => (
                  <Pressable key={v} onPress={() => setReceived(String(v))} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.sunk }}>
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{money(v)}</Text>
                  </Pressable>
                ))}
            </View>
            {Number(received) > due ? (
              <Text style={{ fontFamily: fonts.uiExtra, fontSize: 18, color: colors.good, textAlign: 'center', marginVertical: 6 }}>Change {money(Number(received) - due)}</Text>
            ) : null}
          </>
        ) : null}
      </Sheet>
    </View>
  );
}
