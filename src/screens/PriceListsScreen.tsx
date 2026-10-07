/**
 * PRICE LISTS — Items (or Drugs) → ⋯ → Price list.
 *
 * Ported element for element from the PriceLists design (PriceLists.tsx):
 *
 *   List    — "Price lists", a search pill, All / Active / Draft chips, one
 *             card per list with its item count and margin, and the status
 *             badge; "New price list" floats at the bottom right.
 *   Detail  — back, the list's name and Rename; currency, status and margin
 *             chips; every item with its code and cost and the selling price
 *             in an editable box (tinted once changed); a bar with Discard and
 *             Save while anything is unsaved.
 *   Sheet   — the name with a counter and its error, then for a new list:
 *             start blank or copy another list with a ± adjustment, and
 *             Activate now.
 *
 * Added for the app, where the design left a gap: a back arrow on the list,
 * the status chip switches a list between Draft and Active, and "Add products"
 * opens a picker of the shop's items.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppData } from '../data/AppDataContext';
import { fonts, useTheme } from '../theme';
import { explain } from '../data/refusal';
import { adjLabel, listPriceOf, listProducts, round100 } from '../data/priceLists';
import { vocab } from '../data/editions';
import type { PriceList, Product } from '../data/types';

type Status = 'Active' | 'Draft';
type Filter = 'All' | Status;
type SheetMode = 'create' | 'rename' | null;
type Form = { name: string; source: 'blank' | 'copy'; copyFrom: string; adj: number; active: boolean };

/* the design's own palette; in dark mode the app's dark theme is used instead (see fromApp) */
const LIGHT = {
  bg: '#f7faf8', surface: '#ffffff', fill: '#e6ebe8', ink: '#191c1b', muted: '#56605b',
  outline: '#707975', outlineSoft: '#c0c9c3', primary: '#0b6b57', primaryDark: '#07493b',
  chipOn: '#cde8df', fab: '#bfe9da', fabInk: '#05372b', changed: '#e3f4ed', error: '#ba1a1a',
  onPrimary: '#ffffff', soft: '#404944', rule: '#edf1ee', ruleBar: '#e2e7e4', handle: '#8a948f',
  off: '#dfe3e0', offInk: '#8a948f', snack: '#2e3230', snackInk: '#eff1ef', scrim: 'rgba(25,28,27,0.36)',
  activeBg: '#cdeee2', activeFg: '#05372b', draftBg: '#e6e8e6', draftFg: '#404944', thumb: '#ffffff',
};
type Palette = typeof LIGHT;

/** The design's roles, filled from the app's dark theme. */
function fromApp(c: ReturnType<typeof useTheme>['colors']): Palette {
  return {
    bg: c.bg, surface: c.surface, fill: c.sunk, ink: c.ink, muted: c.faint,
    outline: c.lineHard, outlineSoft: c.line, primary: c.accent, primaryDark: c.accent,
    chipOn: c.accentSoft, fab: c.accentSoft, fabInk: c.accent, changed: c.accentSoft, error: c.danger,
    onPrimary: c.accentInk, soft: c.soft, rule: c.line, ruleBar: c.line, handle: c.lineHard,
    off: c.sunk, offInk: c.faint, snack: c.ink, snackInk: c.bg, scrim: 'rgba(0,0,0,0.55)',
    activeBg: c.goodSoft, activeFg: c.good, draftBg: c.sunk, draftFg: c.soft, thumb: c.accentInk,
  };
}
const MONO = fonts.mono;
const commas = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const statusColors = (C: Palette, s: Status) => (s === 'Active' ? { bg: C.activeBg, fg: C.activeFg } : { bg: C.draftBg, fg: C.draftFg });

export default function PriceListsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { dark, colors } = useTheme();
  // light keeps the design's palette; dark is the app's own dark theme, so it matches every other screen
  const C = useMemo<Palette>(() => (dark ? fromApp(colors) : LIGHT), [dark, colors]);
  const st = useMemo(() => makeStyles(C), [C]);
  const { db, savePriceList } = useAppData();
  const V = vocab(db);
  const cur = db?.settings.currency || 'UGX';
  const fmt = (n: number) => cur + ' ' + commas(n);
  const lists = db?.priceLists || [];

  const [screen, setScreen] = useState<'list' | 'detail'>('list');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const [pending, setPending] = useState<Record<string, Record<string, number>>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sheet, setSheet] = useState<SheetMode>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [touched, setTouched] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [picking, setPicking] = useState<string[] | null>(null);
  const [pickQuery, setPickQuery] = useState('');
  const [itemQuery, setItemQuery] = useState('');
  const nameRef = useRef<TextInput>(null);
  const snackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => { navigation?.setOptions?.({ headerShown: false }); }, [navigation]);
  useEffect(() => { if (sheet) setTimeout(() => nameRef.current?.focus(), 30); }, [sheet]);
  useEffect(() => () => { if (snackTimer.current) clearTimeout(snackTimer.current); }, []);

  const current = lists.find((l) => l.id === currentId) ?? null;
  const showSnack = (t: string) => {
    if (snackTimer.current) clearTimeout(snackTimer.current);
    setSnack(t);
    snackTimer.current = setTimeout(() => setSnack(null), 2600);
  };
  const priceOf = (l: PriceList, p: Product) => pending[l.id]?.[p.id] ?? listPriceOf(l, p);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lists.filter((l) => (filter === 'All' || l.status === filter) && l.name.toLowerCase().includes(q));
  }, [lists, query, filter]);

  const blankForm = (): Form => ({ name: '', source: 'blank', copyFrom: lists[0]?.id ?? '', adj: 0, active: false });
  const openCreate = () => { setForm(blankForm()); setTouched(false); setSheet('create'); };
  const openRename = () => { if (!current) return; setForm({ ...blankForm(), name: current.name }); setTouched(false); setSheet('rename'); };
  const patchForm = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));

  const nameError = (): string | null => {
    if (!form) return null;
    const n = form.name.trim();
    if (!n) return 'Enter a name';
    if (lists.some((l) => l.name.toLowerCase() === n.toLowerCase() && !(sheet === 'rename' && l.id === currentId))) {
      return 'A price list with this name already exists';
    }
    return null;
  };
  const err = nameError();
  const showErr = !!err && (touched || err !== 'Enter a name');
  const valid = !!form && !err;

  const submit = () => {
    if (!form || !db) return;
    if (err) { setTouched(true); return; }
    const name = form.name.trim();
    try {
      if (sheet === 'rename' && current) {
        savePriceList({ ...current, name });
        setSheet(null);
        showSnack('Price list renamed');
        return;
      }
      const src = lists.find((l) => l.id === form.copyFrom);
      const copy = form.source === 'copy' && src ? src : null;
      const prices: Record<string, number> = {};
      if (copy) listProducts(db, copy).forEach((p) => { prices[p.id] = round100(priceOf(copy, p) * (1 + form.adj / 100)); });
      const nl = savePriceList({
        name, currency: cur, status: form.active ? 'Active' : 'Draft',
        adj: copy ? copy.adj + form.adj : 0, prices,
        productIds: copy ? (copy.productIds ? [...copy.productIds] : undefined) : [],
      });
      setSheet(null); setScreen('detail'); setCurrentId(nl.id); setItemQuery(''); setQuery(''); setFilter('All');
      showSnack('“' + name + '” created');
    } catch (e) { explain(e); }
  };

  const setPrice = (lid: string, pid: string, raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '').slice(0, 12);
    setDrafts((d) => ({ ...d, [lid + pid]: digits }));
    if (digits) setPending((p) => ({ ...p, [lid]: { ...(p[lid] || {}), [pid]: Number(digits) } }));
  };
  const clearDraft = (key: string) => setDrafts((d) => { const n = { ...d }; delete n[key]; return n; });

  const pendingCount = current ? Object.keys(pending[current.id] || {}).length : 0;
  const save = () => {
    if (!current) return;
    try {
      savePriceList({ ...current, prices: { ...(current.prices || {}), ...(pending[current.id] || {}) } });
      setPending((p) => ({ ...p, [current.id]: {} }));
      setDrafts({});
      showSnack('Selling prices saved');
    } catch (e) { explain(e); }
  };
  const discard = () => {
    if (!current) return;
    setPending((p) => ({ ...p, [current.id]: {} }));
    setDrafts({});
    showSnack('Changes discarded');
  };
  const toggleStatus = () => {
    if (!current) return;
    try {
      const status: Status = current.status === 'Active' ? 'Draft' : 'Active';
      savePriceList({ ...current, status });
      showSnack(status === 'Active' ? 'Active — it can be chosen on sales' : 'Back to draft');
    } catch (e) { explain(e); }
  };

  if (!db) return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  const onListAll = current ? listProducts(db, current) : [];
  const iq = itemQuery.trim().toLowerCase();
  const products = iq ? onListAll.filter((p) => (p.name + ' ' + p.sku + ' ' + (p.genericName || '')).toLowerCase().includes(iq)) : onListAll;
  const allItems = db.products.filter((p) => p.active !== false);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      {/* ---------------- list ---------------- */}
      {screen === 'list' && (
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Pressable onPress={() => navigation?.goBack?.()} accessibilityLabel="Back" style={st.iconBtn}>
                <Text style={{ fontSize: 24, color: C.ink }}>←</Text>
              </Pressable>
              <Text style={{ fontSize: 28, color: C.ink, fontFamily: fonts.ui }}>Price lists</Text>
            </View>
            <View style={st.search}>
              <View style={{ width: 16, height: 16, borderWidth: 2, borderColor: C.soft, borderRadius: 8 }} />
              <TextInput value={query} onChangeText={setQuery} placeholder="Search price lists" placeholderTextColor={C.muted} style={st.searchInput} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['All', 'Active', 'Draft'] as Filter[]).map((f) => (
                <Pressable key={f} onPress={() => setFilter(f)} style={[st.chip, { backgroundColor: filter === f ? C.chipOn : 'transparent', borderColor: filter === f ? C.chipOn : C.outline }]}>
                  <Text style={{ fontSize: 14, fontFamily: fonts.uiSemi, color: C.ink }}>{f}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 120, gap: 8 }}>
            {visible.map((l) => {
              const sc = statusColors(C, l.status);
              const n = listProducts(db, l).length;
              return (
                <Pressable key={l.id} onPress={() => { setCurrentId(l.id); setItemQuery(''); setScreen('detail'); }} style={st.listRow}>
                  <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                    <Text numberOfLines={1} style={{ fontSize: 16, fontFamily: fonts.uiSemi, color: C.ink }}>{l.name}</Text>
                    <Text style={{ fontSize: 13, color: C.muted, fontFamily: fonts.ui }}>{n} {n === 1 ? V.item.toLowerCase() : V.items.toLowerCase()} · {adjLabel(l.adj)}</Text>
                  </View>
                  <View style={[st.badge, { backgroundColor: sc.bg }]}><Text style={{ fontSize: 12, fontFamily: fonts.uiSemi, color: sc.fg }}>{l.status}</Text></View>
                </Pressable>
              );
            })}
            {visible.length === 0 && (
              <Text style={{ paddingVertical: 40, paddingHorizontal: 16, textAlign: 'center', fontSize: 14, color: C.muted, fontFamily: fonts.ui }}>
                {lists.length ? 'No price lists found.' : 'No price lists yet. Make one for wholesale, a customer group or a promotion.'}
              </Text>
            )}
          </ScrollView>
          <Pressable onPress={openCreate} style={[st.fab, { bottom: 32 + insets.bottom }]}>
            <Text style={{ fontSize: 26, lineHeight: 28, color: C.fabInk }}>+</Text>
            <Text style={{ fontSize: 15, fontFamily: fonts.uiSemi, color: C.fabInk }}>New price list</Text>
          </Pressable>
        </View>
      )}

      {/* ---------------- detail ---------------- */}
      {screen === 'detail' && current && (
        <View style={{ flex: 1 }}>
          <View style={{ height: 64, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 }}>
            <Pressable onPress={() => setScreen('list')} accessibilityLabel="Back" style={st.iconBtn}><Text style={{ fontSize: 24, color: C.ink }}>←</Text></Pressable>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 20, color: C.ink, fontFamily: fonts.ui }}>{current.name}</Text>
            <Pressable onPress={openRename} style={st.textBtn}><Text style={st.textBtnText}>Rename</Text></Pressable>
          </View>
          <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <View style={st.metaChip}><Text style={{ fontSize: 13, fontFamily: MONO, color: C.ink }}>{current.currency || cur}</Text></View>
            <Pressable onPress={toggleStatus} accessibilityLabel="Switch between active and draft" style={[st.metaChip, { borderWidth: 0, backgroundColor: statusColors(C, current.status).bg }]}>
              <Text style={{ fontSize: 13, fontFamily: fonts.uiSemi, color: statusColors(C, current.status).fg }}>{current.status} ⇄</Text>
            </Pressable>
            <View style={st.metaChip}><Text style={{ fontSize: 13, color: C.ink, fontFamily: fonts.ui }}>{adjLabel(current.adj)}</Text></View>
          </View>
          {onListAll.length ? (
            <View style={[st.search, { marginHorizontal: 16, marginBottom: 12 }]}>
              <View style={{ width: 16, height: 16, borderWidth: 2, borderColor: C.soft, borderRadius: 8 }} />
              <TextInput value={itemQuery} onChangeText={setItemQuery} placeholder={'Search ' + V.items.toLowerCase()} placeholderTextColor={C.muted} style={st.searchInput} />
            </View>
          ) : null}
          <View style={st.tableHead}>
            <Text style={st.tableHeadText}>{onListAll.length} {V.items.toUpperCase()}</Text>
            <Pressable onPress={() => { setPickQuery(''); setPicking(current.productIds ? [...current.productIds] : allItems.map((p) => p.id)); }} hitSlop={8}>
              <Text style={[st.tableHeadText, { color: C.primary }]}>Choose {V.items.toLowerCase()}</Text>
            </Pressable>
            <Text style={st.tableHeadText}>SELLING PRICE ({cur})</Text>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            {iq && !products.length ? (
              <Text style={{ paddingVertical: 32, textAlign: 'center', fontSize: 14, color: C.muted, fontFamily: fonts.ui }}>Nothing on this list matches “{itemQuery.trim()}”.</Text>
            ) : products.length > 0 ? (
              <View style={{ backgroundColor: C.surface, borderRadius: 16, overflow: 'hidden' }}>
                {products.map((p) => {
                  const key = current.id + p.id;
                  const changed = pending[current.id]?.[p.id] !== undefined;
                  const d = drafts[key];
                  const value = d !== undefined ? (d ? commas(Number(d)) : '') : commas(priceOf(current, p));
                  return (
                    <View key={p.id} style={st.productRow}>
                      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                        <Text numberOfLines={1} style={{ fontSize: 15, color: C.ink, fontFamily: fonts.ui }}>{p.name}</Text>
                        <Text numberOfLines={1} style={{ fontSize: 12, color: C.muted, fontFamily: MONO }}>{p.sku} · cost {fmt(p.cost)}</Text>
                      </View>
                      <TextInput
                        value={value}
                        keyboardType="number-pad"
                        accessibilityLabel={'Selling price for ' + p.name}
                        onChangeText={(t) => setPrice(current.id, p.id, t)}
                        onBlur={() => clearDraft(key)}
                        style={[st.priceInput, { borderColor: changed ? C.primary : C.outlineSoft, backgroundColor: changed ? C.changed : C.bg }]}
                      />
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={{ paddingVertical: 64, paddingHorizontal: 24, alignItems: 'center', gap: 12 }}>
                <Text style={{ fontSize: 18, color: C.ink, fontFamily: fonts.ui }}>No {V.items.toLowerCase()} yet</Text>
                <Text style={{ fontSize: 14, color: C.muted, maxWidth: 260, textAlign: 'center', fontFamily: fonts.ui }}>Add {V.items.toLowerCase()} to set prices for this list.</Text>
                <Pressable onPress={() => { setPickQuery(''); setPicking([]); }} style={[st.filledBtn, { marginTop: 8 }]}>
                  <Text style={st.filledBtnText}>Add {V.items.toLowerCase()}</Text>
                </Pressable>
              </View>
            )}
          </ScrollView>
          {pendingCount > 0 && (
            <View style={[st.saveBar, { paddingBottom: 20 + insets.bottom }]}>
              <Text style={{ flex: 1, fontSize: 14, color: C.soft, fontFamily: fonts.ui }}>{pendingCount === 1 ? '1 unsaved change' : pendingCount + ' unsaved changes'}</Text>
              <Pressable onPress={discard} style={st.textBtn}><Text style={st.textBtnText}>Discard</Text></Pressable>
              <Pressable onPress={save} style={st.filledBtn}><Text style={st.filledBtnText}>Save</Text></Pressable>
            </View>
          )}
        </View>
      )}

      {/* ---------------- create / rename ---------------- */}
      <Modal visible={!!sheet && !!form} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <Pressable onPress={() => setSheet(null)} style={st.scrim}>
            <Pressable onPress={() => {}} style={[st.sheet, { paddingBottom: 32 + insets.bottom }]}>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 20 }}>
                <View style={{ width: 32, height: 4, borderRadius: 2, backgroundColor: C.handle, alignSelf: 'center', marginBottom: 4 }} />
                <Text style={{ fontSize: 22, color: C.ink, fontFamily: fonts.ui }}>{sheet === 'rename' ? 'Rename price list' : 'New price list'}</Text>

                {form ? (
                  <View style={{ gap: 4 }}>
                    <View>
                      <TextInput
                        ref={nameRef}
                        value={form.name}
                        maxLength={60}
                        placeholder="Name"
                        placeholderTextColor={C.muted}
                        onChangeText={(t) => patchForm({ name: t })}
                        onSubmitEditing={submit}
                        style={[st.nameInput, { borderColor: showErr ? C.error : C.primary }]}
                      />
                      <Text style={{ position: 'absolute', left: 12, top: -9, paddingHorizontal: 4, backgroundColor: C.bg, fontSize: 12, color: showErr ? C.error : C.primary, fontFamily: fonts.ui }}>Price list name</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16 }}>
                      <Text style={{ flex: 1, fontSize: 12, color: showErr ? C.error : C.muted, fontFamily: fonts.ui }}>{showErr ? err : 'Shown to your team and on customer invoices'}</Text>
                      <Text style={{ fontSize: 12, color: C.muted, fontFamily: fonts.ui }}>{form.name.length}/60</Text>
                    </View>
                  </View>
                ) : null}

                {sheet === 'create' && form ? (
                  <View style={{ gap: 20 }}>
                    <View style={{ gap: 4 }}>
                      <Text style={{ fontSize: 14, fontFamily: fonts.uiSemi, color: C.ink, marginBottom: 4 }}>Start from</Text>
                      {([
                        { key: 'blank', label: 'Blank list', sub: 'Add ' + V.items.toLowerCase() + ' and prices later' },
                        { key: 'copy', label: 'Copy an existing list', sub: 'Reuse its ' + V.items.toLowerCase() + ' and prices' },
                      ] as const).filter((o) => o.key === 'blank' || lists.length).map((o) => {
                        const on = form.source === o.key;
                        return (
                          <Pressable key={o.key} onPress={() => patchForm({ source: o.key })} style={st.radioRow}>
                            <View style={[st.radioRing, { borderColor: on ? C.primary : C.outline }]}>
                              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: on ? C.primary : 'transparent' }} />
                            </View>
                            <View style={{ gap: 2, flex: 1 }}>
                              <Text style={{ fontSize: 16, color: C.ink, fontFamily: fonts.ui }}>{o.label}</Text>
                              <Text style={{ fontSize: 13, color: C.muted, fontFamily: fonts.ui }}>{o.sub}</Text>
                            </View>
                          </Pressable>
                        );
                      })}
                      {form.source === 'copy' && (
                        <View style={{ gap: 12, paddingTop: 8, paddingLeft: 40 }}>
                          <Pressable onPress={() => setCopyOpen(!copyOpen)} style={st.select}>
                            <Text style={{ flex: 1, fontSize: 15, color: C.ink, fontFamily: fonts.ui }}>{lists.find((l) => l.id === form.copyFrom)?.name || 'Choose a list'}</Text>
                            <Text style={{ color: C.muted }}>▾</Text>
                          </Pressable>
                          {copyOpen ? (
                            <View style={{ borderWidth: 1, borderColor: C.outlineSoft, borderRadius: 6, overflow: 'hidden' }}>
                              {lists.map((l) => (
                                <Pressable key={l.id} onPress={() => { patchForm({ copyFrom: l.id }); setCopyOpen(false); }} style={{ paddingVertical: 12, paddingHorizontal: 12, backgroundColor: l.id === form.copyFrom ? C.chipOn : C.surface }}>
                                  <Text style={{ fontSize: 15, color: C.ink, fontFamily: fonts.ui }}>{l.name}</Text>
                                </Pressable>
                              ))}
                            </View>
                          ) : null}
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                            <Text style={{ fontSize: 14, color: C.ink, fontFamily: fonts.ui }}>Adjust prices</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                              <Pressable onPress={() => patchForm({ adj: Math.max(-90, form.adj - 5) })} style={st.stepBtn}><Text style={{ fontSize: 20, color: C.ink }}>−</Text></Pressable>
                              <Text style={{ width: 64, textAlign: 'center', fontSize: 15, fontFamily: MONO, color: C.ink }}>{form.adj > 0 ? '+' : ''}{form.adj}%</Text>
                              <Pressable onPress={() => patchForm({ adj: Math.min(200, form.adj + 5) })} style={st.stepBtn}><Text style={{ fontSize: 20, color: C.ink }}>+</Text></Pressable>
                            </View>
                          </View>
                        </View>
                      )}
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                      <View style={{ gap: 2, flex: 1 }}>
                        <Text style={{ fontSize: 16, color: C.ink, fontFamily: fonts.ui }}>Activate now</Text>
                        <Text style={{ fontSize: 13, color: C.muted, fontFamily: fonts.ui }}>Off saves it as a draft</Text>
                      </View>
                      <Pressable
                        accessibilityRole="switch"
                        accessibilityState={{ checked: form.active }}
                        onPress={() => patchForm({ active: !form.active })}
                        style={[st.switchTrack, { borderColor: form.active ? C.primary : C.outline, backgroundColor: form.active ? C.primary : C.fill }]}
                      >
                        <View style={{
                          position: 'absolute', top: '50%', borderRadius: 12,
                          left: form.active ? 22 : 6, width: form.active ? 24 : 16, height: form.active ? 24 : 16,
                          marginTop: form.active ? -12 : -8, backgroundColor: form.active ? C.thumb : C.outline,
                        }} />
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
                  <Pressable onPress={() => setSheet(null)} style={st.textBtn}><Text style={st.textBtnText}>Cancel</Text></Pressable>
                  <Pressable onPress={submit} style={[st.filledBtn, { backgroundColor: valid ? C.primary : C.off }]}>
                    <Text style={[st.filledBtnText, { color: valid ? C.onPrimary : C.offInk }]}>{sheet === 'rename' ? 'Save' : 'Create'}</Text>
                  </Pressable>
                </View>
              </ScrollView>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* ---------------- choosing the items on a list ---------------- */}
      <Modal visible={!!picking} transparent animationType="slide" onRequestClose={() => setPicking(null)}>
        <Pressable onPress={() => setPicking(null)} style={st.scrim}>
          <Pressable onPress={() => {}} style={[st.sheet, { maxHeight: '88%', paddingBottom: 20 + insets.bottom }]}>
            <View style={{ width: 32, height: 4, borderRadius: 2, backgroundColor: C.handle, alignSelf: 'center', marginBottom: 12 }} />
            <Text style={{ fontSize: 22, color: C.ink, fontFamily: fonts.ui, marginBottom: 12 }}>{V.items} on this list</Text>
            <View style={[st.search, { marginBottom: 8 }]}>
              <View style={{ width: 16, height: 16, borderWidth: 2, borderColor: C.soft, borderRadius: 8 }} />
              <TextInput value={pickQuery} onChangeText={setPickQuery} placeholder={'Search ' + V.items.toLowerCase()} placeholderTextColor={C.muted} style={st.searchInput} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
              <Pressable onPress={() => setPicking(allItems.map((p) => p.id))} style={[st.chip, { borderColor: C.outline }]}><Text style={{ fontSize: 14, color: C.ink, fontFamily: fonts.uiSemi }}>All</Text></Pressable>
              <Pressable onPress={() => setPicking([])} style={[st.chip, { borderColor: C.outline }]}><Text style={{ fontSize: 14, color: C.ink, fontFamily: fonts.uiSemi }}>None</Text></Pressable>
              <Text style={{ alignSelf: 'center', fontSize: 13, color: C.muted, fontFamily: fonts.ui }}>{picking?.length || 0} chosen</Text>
            </View>
            <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled">
              {allItems.filter((p) => !pickQuery.trim() || (p.name + ' ' + p.sku).toLowerCase().includes(pickQuery.trim().toLowerCase())).map((p) => {
                const on = !!picking?.includes(p.id);
                return (
                  <Pressable key={p.id} onPress={() => setPicking((x) => (x ? (on ? x.filter((i) => i !== p.id) : [...x, p.id]) : x))} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.rule }}>
                    <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: on ? C.primary : C.outline, backgroundColor: on ? C.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                      {on ? <Text style={{ color: C.onPrimary, fontSize: 12, lineHeight: 14 }}>✓</Text> : null}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontSize: 15, color: C.ink, fontFamily: fonts.ui }}>{p.name}</Text>
                      <Text style={{ fontSize: 12, color: C.muted, fontFamily: MONO }}>{p.sku} · cost {fmt(p.cost)}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingTop: 16 }}>
              <Pressable onPress={() => setPicking(null)} style={st.textBtn}><Text style={st.textBtnText}>Cancel</Text></Pressable>
              <Pressable
                onPress={() => {
                  if (!current || !picking) return;
                  try {
                    // every item chosen is the same as "the whole range", which then follows new items too
                    const ids = picking.length === allItems.length ? undefined : picking;
                    savePriceList({ ...current, productIds: ids });
                    setPicking(null);
                    showSnack(picking.length + ' ' + (picking.length === 1 ? V.item.toLowerCase() : V.items.toLowerCase()) + ' on the list');
                  } catch (e) { explain(e); }
                }}
                style={st.filledBtn}
              >
                <Text style={st.filledBtnText}>Done</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {snack ? (
        <View style={[st.snack, { bottom: 28 + insets.bottom }]}>
          <Text style={{ color: C.snackInk, fontSize: 14, fontFamily: fonts.ui }}>{snack}</Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (C: Palette) => ({
  search: { height: 52, borderRadius: 26, backgroundColor: C.fill, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18 } as const,
  searchInput: { flex: 1, fontSize: 16, minWidth: 0, color: C.ink, fontFamily: fonts.ui, padding: 0 } as const,
  chip: { height: 32, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' } as const,
  listRow: { width: '100%', padding: 16, borderRadius: 16, backgroundColor: C.surface, flexDirection: 'row', alignItems: 'center', gap: 14 } as const,
  badge: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 8 } as const,
  fab: { position: 'absolute', right: 16, height: 56, paddingLeft: 16, paddingRight: 20, borderRadius: 16, backgroundColor: C.fab, flexDirection: 'row', alignItems: 'center', gap: 12, elevation: 4, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } } as const,
  iconBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' } as const,
  textBtn: { height: 40, paddingHorizontal: 16, borderRadius: 20, alignItems: 'center', justifyContent: 'center' } as const,
  textBtnText: { color: C.primary, fontSize: 14, fontFamily: fonts.uiSemi } as const,
  filledBtn: { height: 40, paddingHorizontal: 24, borderRadius: 20, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' } as const,
  filledBtnText: { color: C.onPrimary, fontSize: 14, fontFamily: fonts.uiSemi } as const,
  metaChip: { height: 32, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: C.outlineSoft, alignItems: 'center', justifyContent: 'center' } as const,
  tableHead: { paddingHorizontal: 20, paddingBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' } as const,
  tableHeadText: { fontSize: 12, fontFamily: fonts.uiSemi, letterSpacing: 0.5, color: C.muted } as const,
  productRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: C.rule } as const,
  priceInput: { width: 116, height: 40, paddingHorizontal: 10, borderWidth: 1, borderRadius: 8, textAlign: 'right', fontSize: 15, fontFamily: MONO, color: C.ink } as const,
  saveBar: { paddingTop: 12, paddingHorizontal: 16, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.ruleBar, flexDirection: 'row', alignItems: 'center', gap: 8 } as const,
  scrim: { flex: 1, backgroundColor: C.scrim, justifyContent: 'flex-end' } as const,
  sheet: { backgroundColor: C.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 8, paddingHorizontal: 24, maxHeight: '92%' } as const,
  nameInput: { width: '100%', height: 56, paddingHorizontal: 16, borderRadius: 6, borderWidth: 2, fontSize: 16, color: C.ink, fontFamily: fonts.ui } as const,
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 12 } as const,
  radioRing: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' } as const,
  select: { height: 48, paddingHorizontal: 12, borderWidth: 1, borderColor: C.outline, borderRadius: 6, flexDirection: 'row', alignItems: 'center' } as const,
  stepBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: C.outlineSoft, alignItems: 'center', justifyContent: 'center' } as const,
  switchTrack: { width: 52, height: 32, borderRadius: 16, borderWidth: 2 } as const,
  snack: { position: 'absolute', left: 16, right: 16, minHeight: 48, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 6, backgroundColor: C.snack, justifyContent: 'center', elevation: 6 } as const,
});
