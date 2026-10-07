/**
 * MENU & MODIFIERS — More → Menu & modifiers (restaurants).
 *
 *   Sections  — Starters, Mains, Drinks… in the order they show on the order
 *               screen, each with a colour and the station that makes it.
 *   Dishes    — each with a photo, price, description, section, station,
 *               dietary tags, preparation time, the modifier groups it offers,
 *               and a Sold out switch for the night it runs out.
 *   Modifiers — the choices a waiter is asked for when a dish is tapped.
 *   Settings  — stations (Kitchen, Bar, Grill…), service charge, and what a
 *               new ticket starts as.
 *
 * Dishes made here are not stock-counted: a kitchen sells plates, not pieces.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Alert, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Pressable } from '../components/Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from '../components/Toast';
import { Icon } from '../components/icons';
import Sheet from '../components/Sheet';
import { Button } from '../components/ui';
import { Field, ToggleRow, SelectField, MultiSelectField } from '../components/form';
import SegmentSlider from '../components/SegmentSlider';
import { explain } from '../data/refusal';
import { keepPhoto } from '../data/photos';
import { DISH_TAGS, GROUP_COLORS, ORDER_TYPES, menuSections, stationOf, stationsOf } from '../data/restaurant';
import type { ModifierGroup, ModifierOption, OrderType, Product } from '../data/types';

type Tab = 'menus' | 'sections' | 'dishes' | 'mods' | 'settings';

interface DishDraft {
  id?: string; name: string; price: string; cost: string; description: string; category: string;
  station: string; tags: string[]; prepMins: string; groups: string[]; soldOut: boolean; photo: string;
}
interface GroupDraft { id?: string; name: string; required: boolean; multi: boolean; options: (ModifierOption & { priceText: string })[] }
interface SectionDraft { id?: string; name: string; color: string; station: string }
interface MenuDraft { id?: string; name: string; sections: string[] }

let tmp = 0;
const tmpId = () => 'mo_' + Date.now().toString(36) + (tmp++).toString(36);

export default function MenuEditorScreen() {
  const { colors } = useTheme();
  const {
    db, money, addProduct, updateProduct, saveModifierGroup, removeModifierGroup,
    saveMenuGroup, removeMenuGroup, moveMenuGroup, setSetting, saveMenu, removeMenu, updateUser,
  } = useAppData();
  const { success, error } = useToast();
  const [tab, setTab] = useState<Tab>('dishes');
  const [q, setQ] = useState('');
  const [dish, setDish] = useState<DishDraft | null>(null);
  const [group, setGroup] = useState<GroupDraft | null>(null);
  const [section, setSection] = useState<SectionDraft | null>(null);
  const [menuDraft, setMenuDraft] = useState<MenuDraft | null>(null);
  const [newStation, setNewStation] = useState('');
  const [service, setService] = useState(String(db?.settings.serviceChargePct || ''));

  const sections = useMemo(() => menuSections(db), [db]);
  const items = useMemo(() => (db?.products || []).filter((p) => p.active !== false), [db]);
  const groups = db?.modifierGroups || [];
  const stations = stationsOf(db);
  const menus = db?.menus || [];

  if (!db) return null;

  const needle = q.trim().toLowerCase();
  const inSection = (name: string) => items.filter((p) => (p.category || 'Other') === name
    && (!needle || p.name.toLowerCase().includes(needle)));

  /* ---------------- dishes ---------------- */

  function newDish(category?: string) {
    const sec = category || sections[0]?.name || 'Food';
    setDish({ name: '', price: '', cost: '', description: '', category: sec, station: '', tags: [], prepMins: '', groups: [], soldOut: false, photo: '' });
  }

  function editDish(p: Product, copy = false) {
    setDish({
      id: copy ? undefined : p.id, name: copy ? p.name + ' (copy)' : p.name, price: String(p.price || ''), cost: p.cost ? String(p.cost) : '',
      description: p.description || '', category: p.category || 'Other', station: p.station || '', tags: p.tags || [],
      prepMins: p.prepMins ? String(p.prepMins) : '', groups: p.modifierGroups || [], soldOut: !!p.soldOut, photo: p.photo || '',
    });
  }

  async function pickPhoto(camera: boolean) {
    if (!dish) return;
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { error(camera ? 'Allow camera access to take a photo.' : 'Allow access to your photos to add one.'); return; }
    const opts = { quality: 0.6, allowsEditing: true, aspect: [4, 3] as [number, number] };
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (!r.canceled && r.assets?.[0]?.uri) {
      const kept = await keepPhoto(r.assets[0].uri, 'dish');
      setDish((d) => (d ? { ...d, photo: kept } : d));
    }
  }

  function saveDish() {
    if (!dish) return;
    const name = dish.name.trim();
    if (!name) { error('Give the dish a name.'); return; }
    const patch = {
      name, price: Number(dish.price) || 0, cost: Number(dish.cost) || 0, category: dish.category.trim() || 'Other',
      description: dish.description.trim() || undefined, station: dish.station || undefined, tags: dish.tags,
      prepMins: Number(dish.prepMins) || undefined, modifierGroups: dish.groups, soldOut: dish.soldOut, photo: dish.photo || undefined,
    };
    try {
      if (dish.id) updateProduct(dish.id, patch);
      else {
        addProduct({
          ...patch, sku: name.slice(0, 8).toUpperCase().replace(/\s+/g, ''), kind: 'product', unit: 'PC',
          taxRate: db!.settings.taxRate || 0, stock: {}, reorder: 0, warrantyMonths: 0, active: true,
          trackInventory: false, batches: [], barcodes: [],
        } as Omit<Product, 'id'>);
      }
      success(name + (dish.id ? ' updated' : ' added to the menu'));
      setDish(null);
    } catch (e) { explain(e); }
  }

  function toggleSoldOut(p: Product) {
    try { updateProduct(p.id, { soldOut: !p.soldOut }); success(p.name + (p.soldOut ? ' is back on' : ' marked sold out')); } catch (e) { explain(e); }
  }

  /* ---------------- sections ---------------- */

  function saveSection() {
    if (!section) return;
    if (!section.name.trim()) { error('Give the section a name.'); return; }
    if (!section.id && sections.some((s) => s.name.toLowerCase() === section.name.trim().toLowerCase() && !s.id.startsWith('cat:'))) { error('There is already a section with that name.'); return; }
    try {
      // a category already used by dishes becomes a proper section under the same name
      saveMenuGroup({ id: section.id?.startsWith('cat:') ? undefined : section.id, name: section.name, color: section.color, station: section.station || undefined });
      success(section.name.trim() + ' saved');
      setSection(null);
    } catch (e) { explain(e); }
  }

  /* ---------------- modifier groups ---------------- */

  function saveGroup() {
    if (!group) return;
    if (!group.name.trim()) { error('Give the group a name, such as Size or Extras.'); return; }
    const options = group.options.filter((o) => o.name.trim()).map((o) => ({ id: o.id, name: o.name, price: Number(o.priceText) || 0 }));
    if (!options.length) { error('Add at least one choice.'); return; }
    try {
      saveModifierGroup({ id: group.id, name: group.name, required: group.required, multi: group.multi, options });
      success(group.name.trim() + ' saved');
      setGroup(null);
    } catch (e) { explain(e); }
  }

  function editGroup(g?: ModifierGroup) {
    setGroup(g
      ? { id: g.id, name: g.name, required: g.required, multi: g.multi, options: g.options.map((o) => ({ ...o, priceText: o.price ? String(o.price) : '' })) }
      : { name: '', required: false, multi: true, options: [{ id: tmpId(), name: '', price: 0, priceText: '' }] });
  }

  /* ---------------- pieces ---------------- */

  const card = { borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, marginBottom: 12, overflow: 'hidden' as const };
  const label = (t: string) => <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginBottom: 8, marginTop: 4 }}>{t}</Text>;
  const chips = (list: string[], on: (v: string) => boolean, tap: (v: string) => void) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
      {list.map((v) => {
        const yes = on(v);
        return (
          <Pressable key={v} onPress={() => tap(v)} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.4, borderColor: yes ? colors.ink : colors.line, backgroundColor: yes ? colors.ink : colors.surface }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: yes ? colors.bg : colors.ink }}>{v}</Text>
          </Pressable>
        );
      })}
    </View>
  );
  const thumb = (p: { photo?: string; name: string }, color: string, size = 48) => (
    <View style={{ width: size, height: size, borderRadius: 12, overflow: 'hidden', backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      {p.photo ? <Image source={{ uri: p.photo }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        : <Text style={{ fontFamily: fonts.uiExtra, fontSize: size / 2.6, color: '#1B1B1F' }}>{p.name.slice(0, 2).toUpperCase()}</Text>}
    </View>
  );

  const addLabel = tab === 'dishes' ? 'Add dish' : tab === 'sections' ? 'Add section' : tab === 'mods' ? 'Add modifier group' : tab === 'menus' ? 'Add menu' : '';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <SegmentSlider
          value={tab}
          onChange={setTab}
          options={[
            { v: 'menus', l: 'Menus', i: 'doc' }, { v: 'sections', l: 'Sections', i: 'menu' }, { v: 'dishes', l: 'Dishes', i: 'food' },
            { v: 'mods', l: 'Modifiers', i: 'tag' }, { v: 'settings', l: 'Settings', i: 'cog' },
          ]}
        />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 110 }} keyboardShouldPersistTaps="handled">
        {/* ---------- menus ---------- */}
        {tab === 'menus' ? (
          <>
            <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, marginBottom: 12 }}>
              A menu is a set of sections sold together — a Food menu, a Bar menu, Breakfast. When taking an order the menu can be chosen,
              and a member of staff can be kept to one menu, so the bar sells bar items only.
            </Text>
            {menus.map((mn) => (
              <Pressable key={mn.id} onPress={() => setMenuDraft({ id: mn.id, name: mn.name, sections: mn.sections })} style={({ pressed }) => ({ ...card, padding: 14, backgroundColor: pressed ? colors.sunk : colors.surface })}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Icon name="doc" size={18} color={colors.ink} />
                  <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 15.5, color: colors.ink }}>{mn.name}</Text>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: colors.faint }}>
                    {items.filter((p) => mn.sections.includes(p.category || 'Other')).length} dishes
                  </Text>
                  <Icon name="chev" size={16} color={colors.faint} />
                </View>
                <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.soft, marginTop: 6 }}>{mn.sections.join(' · ') || 'No sections yet'}</Text>
              </Pressable>
            ))}
            {!menus.length ? (
              <Text style={{ fontFamily: fonts.ui, fontSize: 14, color: colors.faint, textAlign: 'center', paddingVertical: 20 }}>
                One menu with every section is used until you add menus here.
              </Text>
            ) : null}

            {menus.length ? (
              <View style={[card, { padding: 14 }]}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink, marginBottom: 4 }}>Who sells from which menu</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginBottom: 10 }}>
                  Someone kept to a menu sees only its dishes when taking orders. "Any menu" lets them switch.
                </Text>
                {db.users.filter((u) => u.active).map((u) => (
                  <SelectField
                    key={u.id}
                    label={u.name}
                    icon="user"
                    value={u.menuId && menus.some((x) => x.id === u.menuId) ? u.menuId : '__any'}
                    options={[{ v: '__any', l: 'Any menu' }, ...menus.map((x) => ({ v: x.id, l: x.name }))]}
                    onChange={(v) => { try { updateUser(u.id, { menuId: v === '__any' ? undefined : v }); } catch (e) { explain(e); } }}
                  />
                ))}
              </View>
            ) : null}
          </>
        ) : null}

        {/* ---------- sections ---------- */}
        {tab === 'sections' ? (
          <>
            <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, marginBottom: 12 }}>
              The order screen shows sections in this order. Use the arrows to move one, tap it to rename it, change its colour or its station.
            </Text>
            {sections.map((s, i) => {
              const n = items.filter((p) => (p.category || 'Other') === s.name).length;
              const real = !s.id.startsWith('cat:');
              return (
                <View key={s.id} style={[card, { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }]}>
                  <View style={{ width: 14, height: 40, borderRadius: 4, backgroundColor: s.color, borderWidth: 1, borderColor: colors.line }} />
                  <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => setSection({ id: s.id, name: s.name, color: s.color, station: s.station || '' })}>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{s.name}</Text>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
                      {n} dish{n === 1 ? '' : 'es'} · {s.station || stations[0]}{real ? '' : ' · not yet a section'}
                    </Text>
                  </Pressable>
                  {real ? (
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <Pressable hitSlop={6} disabled={i === 0} onPress={() => moveMenuGroup(s.id, -1)} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center', opacity: i === 0 ? 0.35 : 1 }}>
                        <Icon name="up" size={16} color={colors.ink} />
                      </Pressable>
                      <Pressable hitSlop={6} onPress={() => moveMenuGroup(s.id, 1)} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="down" size={16} color={colors.ink} />
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            })}
            {!sections.length ? <Text style={{ fontFamily: fonts.ui, fontSize: 14, color: colors.faint, textAlign: 'center', paddingVertical: 30 }}>No sections yet. Add Starters, Mains, Drinks…</Text> : null}
          </>
        ) : null}

        {/* ---------- dishes ---------- */}
        {tab === 'dishes' ? (
          <>
            <Field icon="search" label="Search dishes" value={q} onChangeText={setQ} autoCorrect={false} />
            {sections.map((s) => {
              const list = inSection(s.name);
              if (!list.length && needle) return null;
              return (
                <View key={s.id} style={card}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: s.color, borderWidth: 1, borderColor: colors.lineHard }} />
                    <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.faint }}>{s.name} · {list.length}</Text>
                    <Pressable hitSlop={8} onPress={() => newDish(s.name)}><Icon name="plus" size={18} color={colors.ink} /></Pressable>
                  </View>
                  {list.map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => editDish(p)}
                      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: pressed ? colors.sunk : 'transparent', opacity: p.soldOut ? 0.55 : 1 })}
                    >
                      {thumb(p, s.color)}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{p.name}</Text>
                        <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 2 }}>
                          {[stationOf(db, p), (p.tags || []).join(', '), p.modifierGroups?.length ? p.modifierGroups.length + ' modifier group(s)' : ''].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <Text style={{ fontFamily: fonts.uiBold, fontSize: 14.5, color: colors.ink }}>{money(p.price)}</Text>
                        <Pressable hitSlop={6} onPress={() => toggleSoldOut(p)} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: p.soldOut ? colors.dangerSoft : colors.goodSoft }}>
                          <Text style={{ fontFamily: fonts.uiBold, fontSize: 11, color: p.soldOut ? colors.danger : colors.good }}>{p.soldOut ? 'SOLD OUT' : 'AVAILABLE'}</Text>
                        </Pressable>
                      </View>
                    </Pressable>
                  ))}
                  {!list.length ? <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, paddingHorizontal: 14, paddingBottom: 12 }}>No dishes in this section yet.</Text> : null}
                </View>
              );
            })}
            {!sections.length ? <Text style={{ fontFamily: fonts.ui, fontSize: 14, color: colors.faint, textAlign: 'center', paddingVertical: 30 }}>No dishes yet. Add your first with Add dish.</Text> : null}
          </>
        ) : null}

        {/* ---------- modifiers ---------- */}
        {tab === 'mods' ? (
          <>
            <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, marginBottom: 12 }}>
              Choices the waiter is asked for when a dish is ordered. Give each dish its groups in the dish itself.
            </Text>
            {groups.map((g) => (
              <Pressable key={g.id} onPress={() => editGroup(g)} style={({ pressed }) => ({ ...card, padding: 14, backgroundColor: pressed ? colors.sunk : colors.surface })}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 15.5, color: colors.ink }}>{g.name}</Text>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: colors.faint }}>{g.required ? 'Required' : 'Optional'} · {g.multi ? 'many' : 'one'}</Text>
                  <Icon name="chev" size={16} color={colors.faint} />
                </View>
                <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.soft, marginTop: 6 }}>{g.options.map((o) => o.name + (o.price ? ' +' + money(o.price) : '')).join(' · ')}</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 4 }}>On {items.filter((p) => p.modifierGroups?.includes(g.id)).length} dish(es)</Text>
              </Pressable>
            ))}
            {!groups.length ? <Text style={{ fontFamily: fonts.ui, fontSize: 14, color: colors.faint, textAlign: 'center', paddingVertical: 30 }}>No modifier groups yet.</Text> : null}
          </>
        ) : null}

        {/* ---------- settings ---------- */}
        {tab === 'settings' ? (
          <>
            <View style={[card, { padding: 14 }]}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink, marginBottom: 4 }}>Stations</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginBottom: 10 }}>
                Where dishes are made. Each station's dishes print on the printers ticked for it in Printing.
              </Text>
              {stations.map((st) => (
                <View key={st} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.line }}>
                  <Icon name="food" size={16} color={colors.ink} />
                  <Text style={{ flex: 1, marginLeft: 10, fontFamily: fonts.uiSemi, fontSize: 14.5, color: colors.ink }}>{st}</Text>
                  {stations.length > 1 ? (
                    <Pressable hitSlop={8} onPress={() => { try { setSetting({ stations: stations.filter((x) => x !== st) }); } catch (e) { explain(e); } }}>
                      <Icon name="x" size={17} color={colors.danger} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
                <View style={{ flex: 1 }}><Field compact label="New station" value={newStation} onChangeText={setNewStation} placeholder="Grill, Pastry…" /></View>
                <View style={{ marginTop: 6 }}>
                  <Button size="sm" label="Add" onPress={() => {
                    const v = newStation.trim();
                    if (!v || stations.includes(v)) return;
                    try { setSetting({ stations: [...stations, v] }); setNewStation(''); } catch (e) { explain(e); }
                  }} />
                </View>
              </View>
            </View>

            <View style={[card, { padding: 14 }]}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink, marginBottom: 4 }}>Service charge</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginBottom: 10 }}>Added to dine-in bills only. Leave blank for none.</Text>
              <Field label="Service charge %" numeric decimal money={false} value={service} onChangeText={setService} suffix="%" />
              <Button size="sm" label="Save service charge" onPress={() => {
                const v = Math.max(0, Math.min(50, Number(service) || 0));
                try { setSetting({ serviceChargePct: v }); success(v ? v + '% service charge on dine-in' : 'No service charge'); } catch (e) { explain(e); }
              }} />
            </View>

            <View style={[card, { padding: 14 }]}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink, marginBottom: 10 }}>A new ticket starts as</Text>
              {chips(ORDER_TYPES.map((o) => o.l), (v) => ORDER_TYPES.find((o) => o.l === v)?.v === (db.settings.defaultOrderType || 'dine'),
                (v) => { try { setSetting({ defaultOrderType: ORDER_TYPES.find((o) => o.l === v)!.v as OrderType }); } catch (e) { explain(e); } })}
            </View>
          </>
        ) : null}
      </ScrollView>

      {addLabel ? (
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 20 }}>
          <Button
            variant="pri"
            label={addLabel}
            icon={<Icon name="plus" size={17} color={colors.accentInk} />}
            onPress={() => (tab === 'dishes' ? newDish() : tab === 'menus' ? setMenuDraft({ name: '', sections: [] }) : tab === 'sections'
              ? setSection({ name: '', color: GROUP_COLORS[sections.length % GROUP_COLORS.length], station: '' }) : editGroup())}
          />
        </View>
      ) : null}

      {/* ---------- a dish ---------- */}
      <Sheet
        visible={!!dish}
        title={dish?.id ? 'Edit dish' : 'New dish'}
        icon="food"
        full
        onClose={() => setDish(null)}
        footer={<Button variant="pri" label="Save dish" onPress={saveDish} />}
      >
        {dish ? (
          <>
            {/* the photo */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 }}>
              <View style={{ width: 96, height: 72, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line }}>
                {dish.photo ? <Image source={{ uri: dish.photo }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <Icon name="image" size={26} color={colors.faint} />}
              </View>
              <View style={{ flex: 1, gap: 8 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}><Button size="sm" label="Gallery" icon={<Icon name="image" size={15} color={colors.ink} />} onPress={() => pickPhoto(false)} /></View>
                  <View style={{ flex: 1 }}><Button size="sm" label="Camera" icon={<Icon name="camera" size={15} color={colors.ink} />} onPress={() => pickPhoto(true)} /></View>
                </View>
                {dish.photo ? <Pressable onPress={() => setDish({ ...dish, photo: '' })}><Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.danger }}>Remove photo</Text></Pressable> : null}
              </View>
            </View>

            <Field label="Dish name" value={dish.name} onChangeText={(v) => setDish({ ...dish, name: v })} placeholder="Chicken burger" />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Field label="Price" numeric decimal value={dish.price} onChangeText={(v) => setDish({ ...dish, price: v })} /></View>
              <View style={{ flex: 1 }}><Field label="Cost (optional)" numeric decimal value={dish.cost} onChangeText={(v) => setDish({ ...dish, cost: v })} /></View>
            </View>
            <Field label="Description (optional)" multiline value={dish.description} onChangeText={(v) => setDish({ ...dish, description: v })} placeholder="Grilled chicken, lettuce, house sauce" />

            <SelectField
              label="Section"
              icon="menu"
              value={dish.category}
              options={[...new Set([...sections.map((x) => x.name), dish.category, 'Food', 'Drinks'])].filter(Boolean).map((v) => ({ v, l: v }))}
              onChange={(v) => setDish({ ...dish, category: v })}
            />
            <SelectField
              label="Made at"
              icon="food"
              value={dish.station || '__section'}
              options={[{ v: '__section', l: 'Its section\'s station (' + (sections.find((x) => x.name === dish.category)?.station || stations[0]) + ')' }, ...stations.map((v) => ({ v, l: v }))]}
              onChange={(v) => setDish({ ...dish, station: v === '__section' ? '' : v })}
            />
            <MultiSelectField
              label="Tags"
              icon="tag"
              value={dish.tags}
              placeholder="No tags"
              options={DISH_TAGS.map((v) => ({ v, l: v }))}
              onChange={(v) => setDish({ ...dish, tags: v })}
            />

            <Field label="Preparation time (minutes, optional)" numeric money={false} value={dish.prepMins} onChangeText={(v) => setDish({ ...dish, prepMins: v })} />

            {label('Modifiers offered with it')}
            {groups.map((g) => {
              const on = dish.groups.includes(g.id);
              return (
                <Pressable key={g.id} onPress={() => setDish({ ...dish, groups: on ? dish.groups.filter((x) => x !== g.id) : [...dish.groups, g.id] })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 6, borderRadius: 12, borderWidth: 1.4, borderColor: on ? colors.ink : colors.line }}>
                  <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: on ? colors.ink : colors.lineHard, backgroundColor: on ? colors.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                    {on ? <Icon name="check" size={12} color={colors.bg} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14.5, color: colors.ink }}>{g.name}</Text>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{g.options.map((o) => o.name).join(', ')}</Text>
                  </View>
                </Pressable>
              );
            })}
            {!groups.length ? <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, marginBottom: 8 }}>No modifier groups yet — add them under the Modifiers tab.</Text> : null}

            <ToggleRow label="Sold out for now" sub="Shown greyed on the order screen and cannot be ordered" on={dish.soldOut} onChange={(v) => setDish({ ...dish, soldOut: v })} />

            {dish.id ? (
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button size="sm" label="Duplicate" icon={<Icon name="doc" size={15} color={colors.ink} />} onPress={() => { const p = items.find((x) => x.id === dish.id); if (p) editDish(p, true); }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button size="sm" variant="dngr" label="Remove" icon={<Icon name="trash" size={15} color={colors.danger} />} onPress={() => Alert.alert('Take ' + dish.name + ' off the menu?', 'It stops showing on the order screen. Past orders keep it.', [
                    { text: 'Keep it', style: 'cancel' },
                    { text: 'Remove', style: 'destructive', onPress: () => { try { updateProduct(dish.id!, { active: false }); setDish(null); } catch (e) { explain(e); } } },
                  ])} />
                </View>
              </View>
            ) : null}
          </>
        ) : null}
      </Sheet>

      {/* ---------- a menu ---------- */}
      <Sheet
        visible={!!menuDraft}
        title={menuDraft?.id ? 'Edit menu' : 'New menu'}
        icon="doc"
        full
        onClose={() => setMenuDraft(null)}
        footer={<Button variant="pri" label="Save menu" onPress={() => {
          if (!menuDraft) return;
          if (!menuDraft.name.trim()) { error('Give the menu a name, such as Bar or Food.'); return; }
          if (!menuDraft.sections.length) { error('Choose the sections on this menu.'); return; }
          try { saveMenu(menuDraft); success(menuDraft.name.trim() + ' saved'); setMenuDraft(null); } catch (e) { explain(e); }
        }} />}
      >
        {menuDraft ? (
          <>
            <Field label="Menu name" value={menuDraft.name} onChangeText={(v) => setMenuDraft({ ...menuDraft, name: v })} placeholder="Bar menu, Food menu, Breakfast…" />
            <MultiSelectField
              label="Sections on this menu"
              icon="menu"
              value={menuDraft.sections}
              placeholder="Choose sections"
              options={sections.map((x) => ({ v: x.name, l: x.name + ' · ' + items.filter((p) => (p.category || 'Other') === x.name).length + ' dishes' }))}
              onChange={(v) => setMenuDraft({ ...menuDraft, sections: v })}
            />
            {menuDraft.id ? (
              <Button variant="dngr" label="Delete menu" icon={<Icon name="trash" size={15} color={colors.danger} />} onPress={() => Alert.alert('Delete ' + menuDraft.name + '?', 'Its sections and dishes stay. Staff kept to it can sell from any menu.', [
                { text: 'Keep it', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => { try { removeMenu(menuDraft.id!); setMenuDraft(null); } catch (e) { explain(e); } } },
              ])} />
            ) : null}
          </>
        ) : null}
      </Sheet>

      {/* ---------- a section ---------- */}
      <Sheet
        visible={!!section}
        title={section?.id && !section.id.startsWith('cat:') ? 'Edit section' : 'New section'}
        icon="menu"
        onClose={() => setSection(null)}
        footer={<Button variant="pri" label="Save section" onPress={saveSection} />}
      >
        {section ? (
          <>
            <Field label="Section name" value={section.name} onChangeText={(v) => setSection({ ...section, name: v })} placeholder="Starters, Mains, Drinks…" />
            {label('Colour on the order screen')}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
              {GROUP_COLORS.map((c) => (
                <Pressable key={c} onPress={() => setSection({ ...section, color: c })} style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c, borderWidth: section.color === c ? 3 : 1, borderColor: section.color === c ? colors.ink : colors.line }} />
              ))}
            </View>
            {label('Its dishes are made at')}
            {chips(stations, (v) => (section.station || stations[0]) === v, (v) => setSection({ ...section, station: v }))}
            {section.id && !section.id.startsWith('cat:') ? (
              <Button variant="dngr" label="Delete section" icon={<Icon name="trash" size={15} color={colors.danger} />} onPress={() => Alert.alert('Delete ' + section.name + '?', 'Its dishes stay on the menu, under Other.', [
                { text: 'Keep it', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => { try { removeMenuGroup(section.id!); setSection(null); } catch (e) { explain(e); } } },
              ])} />
            ) : null}
          </>
        ) : null}
      </Sheet>

      {/* ---------- a modifier group ---------- */}
      <Sheet
        visible={!!group}
        title={group?.id ? 'Edit modifier group' : 'New modifier group'}
        icon="tag"
        full
        onClose={() => setGroup(null)}
        footer={<Button variant="pri" label="Save group" onPress={saveGroup} />}
      >
        {group ? (
          <>
            <Field label="Group name" value={group.name} onChangeText={(v) => setGroup({ ...group, name: v })} placeholder="Size, Extras, Cooking…" />
            <ToggleRow label="A choice is required" sub="The waiter must pick one before the dish goes on the ticket" on={group.required} onChange={(v) => setGroup({ ...group, required: v })} />
            <ToggleRow label="More than one may be chosen" sub="Off: exactly one, like a size" on={group.multi} onChange={(v) => setGroup({ ...group, multi: v })} />
            {label('Choices')}
            {group.options.map((o, i) => (
              <View key={o.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <View style={{ flex: 2 }}>
                  <Field compact label={'Choice ' + (i + 1)} value={o.name} onChangeText={(v) => setGroup({ ...group, options: group.options.map((x, k) => (k === i ? { ...x, name: v } : x)) })} />
                </View>
                <View style={{ flex: 1.3 }}>
                  <Field compact label="Extra price" numeric decimal value={o.priceText} onChangeText={(v) => setGroup({ ...group, options: group.options.map((x, k) => (k === i ? { ...x, priceText: v } : x)) })} />
                </View>
                <Pressable hitSlop={8} onPress={() => setGroup({ ...group, options: group.options.filter((_, k) => k !== i) })} style={{ marginTop: 18 }}>
                  <Icon name="x" size={18} color={colors.danger} />
                </Pressable>
              </View>
            ))}
            <Pressable
              onPress={() => setGroup({ ...group, options: [...group.options, { id: tmpId(), name: '', price: 0, priceText: '' }] })}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 44, borderRadius: 12, borderWidth: 1.2, borderStyle: 'dashed', borderColor: colors.ink, marginBottom: 12 }}
            >
              <Icon name="plus" size={15} color={colors.ink} />
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.ink }}>Add a choice</Text>
            </Pressable>
            {group.id ? (
              <Button variant="dngr" label="Delete this group" icon={<Icon name="trash" size={15} color={colors.danger} />} onPress={() => Alert.alert('Delete ' + group.name + '?', 'It is taken off every dish that offered it.', [
                { text: 'Keep it', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => { try { removeModifierGroup(group.id!); setGroup(null); } catch (e) { explain(e); } } },
              ])} />
            ) : null}
          </>
        ) : null}
      </Sheet>
    </View>
  );
}
