/**
 * Bulk editors.
 *
 * These are for the job a shop actually does — going down the list and changing
 * many things at once — rather than a find-and-replace run blind. Everything is
 * edited in place, unsaved rows are marked, and nothing is written until an
 * owner approves it, because a bulk write cannot be unpicked line by line.
 */
import React, { useMemo, useState } from 'react';
import { useCan, Denied } from '../components/Gate';
import { View, Text, FlatList, TextInput } from 'react-native';
import { Pressable } from '../components/Press';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from '../components/Toast';
import {
  Panel, Badge, StatGrid, SectionLabel, FilterChips, EmptyBlock, Search, InfoBanner,
  Button, StickyBar, DetailRow, TopTabs, Field,
} from '../components/ui';
import { Icon } from '../components/icons';
import { useOwnerPin } from '../components/OwnerPin';
import type { Product } from '../data/types';

type Kind = 'product' | 'service';

/** An edited cell, kept as text until it is saved. */
interface Draft { cost?: string; price?: string; name?: string; note?: string }

const num = (v: string) => Number(String(v).replace(/[^0-9.]/g, '')) || 0;

function isService(p: Product) {
  return p.kind === 'service';
}

/* ================= price list ================= */

export function PriceListScreen(p: any) {
  // checked before the body runs, so nothing inside it can post first
  const allowed = useCan('inventory.edit');
  if (!allowed) return <Denied title="Prices are closed to you" hint="The price list changes what every item sells for, so it needs the inventory edit permission." />;
  return <PriceListScreenBody  />;
}

function PriceListScreenBody() {
  const { colors } = useTheme();
  const { db, money, updateProduct } = useAppData();
  const { success, error } = useToast();
  const owner = useOwnerPin();

  const [kind, setKind] = useState<Kind>('product');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const all = db?.products || [];

  const cats = useMemo(() => {
    const set = new Set<string>();
    all.filter((p) => (kind === 'service') === isService(p)).forEach((p) => p.category && set.add(p.category));
    return [...set].sort();
  }, [all, kind]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((p) => (kind === 'service') === isService(p))
      .filter((p) => cat === 'all' || p.category === cat)
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [all, kind, cat, q]);

  const dirty = Object.keys(drafts).filter((id) => {
    const p = all.find((x) => x.id === id);
    const d = drafts[id];
    if (!p || !d) return false;
    return (d.cost !== undefined && num(d.cost) !== p.cost)
      || (d.price !== undefined && num(d.price) !== p.price);
  });

  function set(id: string, patch: Draft) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  /** Applies a percentage to every row currently shown. */
  function applyPct(field: 'cost' | 'price', pct: number) {
    const next = { ...drafts };
    rows.forEach((p) => {
      const base = field === 'cost' ? p.cost : p.price;
      const v = Math.round(base * (1 + pct / 100));
      next[p.id] = { ...next[p.id], [field]: String(v) };
    });
    setDrafts(next);
  }

  function save() {
    if (!dirty.length) return;
    owner.ask(
      dirty.length + ' item' + (dirty.length === 1 ? '' : 's') + ' will have their prices rewritten. This cannot be undone.',
      () => {
        dirty.forEach((id) => {
          const d = drafts[id];
          const patch: Partial<Product> = {};
          if (d.cost !== undefined) patch.cost = num(d.cost);
          if (d.price !== undefined) patch.price = num(d.price);
          updateProduct(id, patch);
        });
        setDrafts({});
        success(dirty.length + ' price' + (dirty.length === 1 ? '' : 's') + ' updated');
      },
    );
  }

  if (!db) return null;

  const shownValue = rows.reduce((s, p) => s + p.price, 0);
  const shownCost = rows.reduce((s, p) => s + p.cost, 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopTabs
        value={kind}
        onChange={(v) => { setKind(v); setCat('all'); }}
        options={[
          { v: 'product', l: 'Items', i: 'box' },
          { v: 'service', l: 'Services', i: 'tools' },
        ]}
      />

      <FlatList
        data={rows}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: dirty.length ? 160 : 24, flexGrow: 1 }}
        ListHeaderComponent={
          <View style={{ paddingTop: 14, gap: 14, marginBottom: 14 }}>
            <StatGrid
              items={[
                { icon: 'box', label: kind === 'service' ? 'Services' : 'Items', value: String(rows.length), tone: 'accent' },
                { icon: 'coins', label: 'Sell total', value: money(shownValue), tone: 'good' },
                { icon: 'money', label: 'Cost total', value: money(shownCost), tone: 'warn' },
                { icon: 'pencil', label: 'Unsaved', value: String(dirty.length), tone: dirty.length ? 'danger' : 'good' },
              ]}
            />
            <Search value={q} onChange={setQ} placeholder="Search name or code" />
            {cats.length ? (
              <FilterChips
                value={cat}
                onChange={setCat}
                options={[{ v: 'all', l: 'All' }, ...cats.map((c) => ({ v: c, l: c }))]}
              />
            ) : null}

            <View>
              <SectionLabel>Move every row shown</SectionLabel>
              <View style={{ flexDirection: 'row', gap: 9, flexWrap: 'wrap' }}>
                {[-10, -5, 5, 10, 20].map((pct) => (
                  <Pressable
                    key={pct}
                    onPress={() => applyPct('price', pct)}
                    style={{
                      paddingVertical: 10, paddingHorizontal: 15, borderRadius: radius.pill,
                      borderWidth: 1.4, borderColor: pct < 0 ? colors.danger : colors.good,
                      backgroundColor: pct < 0 ? colors.dangerSoft : colors.goodSoft,
                    }}
                  >
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: pct < 0 ? colors.danger : colors.good }}>
                      {pct > 0 ? '+' : ''}{pct}% sell
                    </Text>
                  </Pressable>
                ))}
                {Object.keys(drafts).length ? (
                  <Pressable
                    onPress={() => setDrafts({})}
                    style={{
                      paddingVertical: 10, paddingHorizontal: 15, borderRadius: radius.pill,
                      borderWidth: 1.4, borderColor: colors.line, backgroundColor: colors.surface,
                    }}
                  >
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.soft }}>Reset</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          <Panel>
            <EmptyBlock
              icon={kind === 'service' ? 'tools' : 'box'}
              title={q ? 'Nothing matches' : kind === 'service' ? 'No services yet' : 'No items yet'}
            />
          </Panel>
        }
        renderItem={({ item: p }) => {
          const d = drafts[p.id] || {};
          const costV = d.cost !== undefined ? d.cost : String(p.cost);
          const priceV = d.price !== undefined ? d.price : String(p.price);
          const changed = num(costV) !== p.cost || num(priceV) !== p.price;
          const margin = num(priceV) ? ((num(priceV) - num(costV)) / num(priceV)) * 100 : 0;
          const loss = num(priceV) > 0 && num(priceV) < num(costV);
          return (
            <View
              style={{
                backgroundColor: colors.surface, borderRadius: 16, padding: 14, marginBottom: 10,
                borderWidth: changed ? 1.5 : 0, borderColor: colors.accent,
                shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 2,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{p.name}</Text>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                    {p.sku}{p.category ? ' · ' + p.category : ''}
                  </Text>
                </View>
                {changed ? <Badge label="Edited" tone="accent" /> : null}
                {loss ? <Badge label="Below cost" tone="danger" /> : null}
              </View>

              <View style={{ flexDirection: 'row', gap: 12, marginTop: 13 }}>
                <Field style={{ flex: 1, marginBottom: 0 }} label="Cost" value={costV} onChangeText={(v) => set(p.id, { cost: v })} numeric decimal />
                <Field style={{ flex: 1, marginBottom: 0 }} label="Sell" value={priceV} onChangeText={(v) => set(p.id, { price: v })} numeric decimal error={loss ? ' ' : undefined} />
                <View style={{ width: 74 }}>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginBottom: 6 }}>Margin</Text>
                  <View style={{ height: 48, alignItems: 'flex-end', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: loss ? colors.danger : margin < 10 ? colors.warn : colors.good }}>
                      {Math.round(margin)}%
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          );
        }}
      />

      {owner.sheet}

      {dirty.length ? (
        <StickyBar>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
              {dirty.length} unsaved change{dirty.length === 1 ? '' : 's'}
            </Text>
            <Pressable onPress={() => setDrafts({})}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.danger }}>Discard</Text>
            </Pressable>
          </View>
          <Button
            label="Save with owner approval"
            variant="pri"
            icon={<Icon name="lock" size={17} color={colors.accentInk} />}
            onPress={save}
          />
        </StickyBar>
      ) : null}
    </View>
  );
}

/* ================= names & descriptions ================= */

export function NamesEditorScreen(p: any) {
  // checked before the body runs, so nothing inside it can post first
  const allowed = useCan('inventory.edit');
  if (!allowed) return <Denied title="Item names are closed to you" hint="Renaming in bulk rewrites the catalogue, so it needs the inventory edit permission." />;
  return <NamesEditorScreenBody  />;
}

function NamesEditorScreenBody() {
  const { colors } = useTheme();
  const { db, updateProduct } = useAppData();
  const { success } = useToast();
  const owner = useOwnerPin();

  const [kind, setKind] = useState<Kind>('product');
  const [q, setQ] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');

  const all = db?.products || [];

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((p) => (kind === 'service') === isService(p))
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [all, kind, q]);

  const dirty = Object.keys(drafts).filter((id) => {
    const p = all.find((x) => x.id === id);
    const d = drafts[id];
    if (!p || !d) return false;
    return (d.name !== undefined && d.name !== p.name) || (d.note !== undefined && d.note !== (p.note || ''));
  });

  function set(id: string, patch: Draft) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  /** Find and replace across the rows currently shown. */
  function runReplace() {
    if (!find.trim()) return;
    const next = { ...drafts };
    let hits = 0;
    rows.forEach((p) => {
      const cur = next[p.id]?.name ?? p.name;
      if (!cur.toLowerCase().includes(find.toLowerCase())) return;
      const re = new RegExp(find.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&'), 'gi');
      next[p.id] = { ...next[p.id], name: cur.replace(re, replace) };
      hits += 1;
    });
    setDrafts(next);
    if (hits) success(hits + ' name' + (hits === 1 ? '' : 's') + ' changed — review then save');
  }

  function save() {
    if (!dirty.length) return;
    owner.ask(
      dirty.length + ' item' + (dirty.length === 1 ? '' : 's') + ' will be renamed or re-described. This cannot be undone.',
      () => {
        dirty.forEach((id) => {
          const d = drafts[id];
          const patch: Partial<Product> = {};
          if (d.name !== undefined) patch.name = d.name.trim();
          if (d.note !== undefined) patch.note = d.note;
          updateProduct(id, patch);
        });
        setDrafts({});
        success(dirty.length + ' item' + (dirty.length === 1 ? '' : 's') + ' updated');
      },
    );
  }

  if (!db) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopTabs
        value={kind}
        onChange={setKind}
        options={[
          { v: 'product', l: 'Items', i: 'box' },
          { v: 'service', l: 'Services', i: 'tools' },
        ]}
      />

      <FlatList
        data={rows}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: dirty.length ? 160 : 24, flexGrow: 1 }}
        ListHeaderComponent={
          <View style={{ paddingTop: 14, gap: 14, marginBottom: 14 }}>
            <Search value={q} onChange={setQ} placeholder="Search name or code" />

            <Panel>
              <SectionLabel>Find and replace in names</SectionLabel>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Field label="Find" value={find} onChangeText={setFind} placeholder="Text to find" style={{ marginBottom: 0 }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="Replace with" value={replace} onChangeText={setReplace} placeholder="Replace it with" style={{ marginBottom: 0 }} />
                </View>
              </View>
              <View style={{ height: 12 }} />
              <Button
                label="Apply to the rows shown"
                disabled={!find.trim()}
                icon={<Icon name="swap" size={16} color={colors.ink} />}
                onPress={runReplace}
              />
              <View style={{ height: 10 }} />
              <InfoBanner tone="neutral" icon="bulb" text="Nothing is written yet — every change is staged for you to check first." />
            </Panel>

            <SectionLabel right={
              dirty.length ? <Badge label={dirty.length + ' unsaved'} tone="accent" /> : undefined
            }>
              {rows.length} {kind === 'service' ? 'services' : 'items'}
            </SectionLabel>
          </View>
        }
        ListEmptyComponent={<Panel><EmptyBlock icon="box" title="Nothing matches" /></Panel>}
        renderItem={({ item: p }) => {
          const d = drafts[p.id] || {};
          const nameV = d.name !== undefined ? d.name : p.name;
          const noteV = d.note !== undefined ? d.note : (p.note || '');
          const changed = nameV !== p.name || noteV !== (p.note || '');
          return (
            <View
              style={{
                backgroundColor: colors.surface, borderRadius: 16, padding: 14, marginBottom: 10,
                borderWidth: changed ? 1.5 : 0, borderColor: colors.accent,
                shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 2,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{p.sku}</Text>
                {changed ? <Badge label="Edited" tone="accent" /> : null}
              </View>

              <Field label="Item name" value={nameV} onChangeText={(v) => set(p.id, { name: v })} error={nameV.trim() ? undefined : 'A name is needed'} style={{ marginBottom: 10 }} />
              <Field label="Description" placeholder="What staff should know when selling it" value={noteV} onChangeText={(v) => set(p.id, { note: v })} multiline style={{ marginBottom: 0 }} />

              {changed && nameV !== p.name ? (
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 8 }}>
                  was “{p.name}”
                </Text>
              ) : null}
            </View>
          );
        }}
      />

      {owner.sheet}

      {dirty.length ? (
        <StickyBar>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
              {dirty.length} unsaved change{dirty.length === 1 ? '' : 's'}
            </Text>
            <Pressable onPress={() => setDrafts({})}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.danger }}>Discard</Text>
            </Pressable>
          </View>
          <Button
            label="Save with owner approval"
            variant="pri"
            icon={<Icon name="lock" size={17} color={colors.accentInk} />}
            onPress={save}
          />
        </StickyBar>
      ) : null}
    </View>
  );
}

/* ================= activate / deactivate ================= */

export function ActivateScreen(p: any) {
  // checked before the body runs, so nothing inside it can post first
  const allowed = useCan('inventory.edit');
  if (!allowed) return <Denied title="This is closed to you" hint="Taking items in and out of use needs the inventory edit permission." />;
  return <ActivateScreenBody  />;
}

function ActivateScreenBody() {
  const { colors } = useTheme();
  const { db, money, stockOf, updateProduct } = useAppData();
  const { success } = useToast();
  const owner = useOwnerPin();

  const [show, setShow] = useState<'active' | 'off' | 'all'>('active');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  const all = db?.products || [];

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((p) => (show === 'all' ? true : show === 'active' ? p.active : !p.active))
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [all, show, q]);

  const chosen = Object.keys(picked).filter((id) => picked[id]);
  const activeCount = all.filter((p) => p.active).length;

  function apply(next: boolean) {
    if (!chosen.length) return;
    owner.ask(
      chosen.length + ' item' + (chosen.length === 1 ? '' : 's') + ' will be ' + (next ? 'put back on sale' : 'taken off sale') + '.',
      () => {
        chosen.forEach((id) => updateProduct(id, { active: next }));
        setPicked({});
        success(chosen.length + ' item' + (chosen.length === 1 ? '' : 's') + (next ? ' back on sale' : ' taken off sale'));
      },
    );
  }

  if (!db) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={rows}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: chosen.length ? 170 : 24, flexGrow: 1 }}
        ListHeaderComponent={
          <View style={{ paddingTop: 14, gap: 14, marginBottom: 14 }}>
            <StatGrid
              items={[
                { icon: 'check', label: 'On sale', value: String(activeCount), tone: 'good' },
                { icon: 'lock', label: 'Off sale', value: String(all.length - activeCount), tone: 'neutral' },
              ]}
            />
            <Search value={q} onChange={setQ} placeholder="Search name or code" />
            <FilterChips
              value={show}
              onChange={(v) => { setShow(v); setPicked({}); }}
              options={[
                { v: 'active', l: 'On sale ' + activeCount },
                { v: 'off', l: 'Off sale ' + (all.length - activeCount) },
                { v: 'all', l: 'All ' + all.length },
              ]}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button
                  size="sm"
                  label={chosen.length === rows.length && rows.length ? 'Clear all' : 'Select all shown'}
                  onPress={() => {
                    if (chosen.length === rows.length) { setPicked({}); return; }
                    const next: Record<string, boolean> = {};
                    rows.forEach((p) => { next[p.id] = true; });
                    setPicked(next);
                  }}
                />
              </View>
            </View>
            <InfoBanner
              tone="neutral"
              icon="bulb"
              text="Taking an item off sale hides it from the till. Its stock and its history stay exactly as they are."
            />
          </View>
        }
        ListEmptyComponent={<Panel><EmptyBlock icon="box" title="Nothing matches" /></Panel>}
        renderItem={({ item: p }) => {
          const on = !!picked[p.id];
          const st = stockOf(p);
          return (
            <Pressable
              onPress={() => setPicked((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
              style={{
                backgroundColor: on ? colors.accentSoft : colors.surface,
                borderRadius: 16, paddingHorizontal: 15, paddingVertical: 14, marginBottom: 10,
                flexDirection: 'row', alignItems: 'center', gap: 12,
                borderWidth: on ? 1.5 : 0, borderColor: colors.accent,
                opacity: p.active ? 1 : 0.6,
                shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 2,
              }}
            >
              <View style={{
                width: 26, height: 26, borderRadius: 8, borderWidth: 1.8,
                borderColor: on ? colors.accent : colors.lineHard,
                backgroundColor: on ? colors.accent : 'transparent',
                alignItems: 'center', justifyContent: 'center',
              }}>
                {on ? <Icon name="check" size={16} color={colors.accentInk} /> : null}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{p.name}</Text>
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                  {p.sku} · {st} {p.unit} · {money(p.price)}
                </Text>
              </View>
              <Badge label={p.active ? 'On sale' : 'Off sale'} tone={p.active ? 'good' : 'neutral'} />
            </Pressable>
          );
        }}
      />

      {owner.sheet}

      {chosen.length ? (
        <StickyBar>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
              {chosen.length} selected
            </Text>
            <Pressable onPress={() => setPicked({})}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.danger }}>Clear</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button label="Take off sale" variant="dngr" onPress={() => apply(false)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Put on sale" variant="pri" onPress={() => apply(true)} />
            </View>
          </View>
        </StickyBar>
      ) : null}
    </View>
  );
}
