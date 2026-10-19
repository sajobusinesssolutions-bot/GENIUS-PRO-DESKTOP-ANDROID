/**
 * TABLE PLAN EDITOR — Menu & modifiers → Settings → Tables.
 *
 * Tables are grouped into areas (Inside, Patio, VIP, Bar) and each has its
 * seats, so the order screen can show the floor area by area and a waiter can
 * seat a party of six at a table that fits them. Tables are added in runs
 * ("8 tables, Patio 1 to Patio 8, 4 seats each"), renamed, moved between areas
 * or removed one by one. A table with an open ticket cannot be removed or
 * renamed, so a running bill is never orphaned.
 *
 * Stored as settings.tables (the names, in floor order, which every older
 * screen reads) and settings.tableInfo (area and seats by name).
 */
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { Pressable } from './Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from './Toast';
import { Icon } from './icons';
import Sheet from './Sheet';
import { Button } from './ui';
import { Field, SelectField } from './form';
import { explain } from '../data/refusal';

const NO_AREA = 'Main floor';

interface Draft { mode: 'add' | 'edit'; was?: string; name: string; area: string; newArea: string; seats: number; count: string; prefix: string; from: string }

export default function TablePlanEditor() {
  const { colors } = useTheme();
  const { db, setSetting } = useAppData();
  const { success, error } = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  if (!db) return null;

  const tables = db.settings.tables || [];
  const info = db.settings.tableInfo || {};
  const areaOf = (t: string) => info[t]?.area || NO_AREA;
  const areas = [...new Set(tables.map(areaOf))];
  const busy = (t: string) => (db.tickets || []).some((x) => x.status === 'open' && x.name.trim().toLowerCase() === t.trim().toLowerCase());
  const seatsTotal = tables.reduce((n, t) => n + (info[t]?.seats || 0), 0);

  function save(list: string[], map: Record<string, { area?: string; seats?: number }>, msg: string) {
    const keep: typeof map = {};
    list.forEach((t) => { if (map[t]) keep[t] = map[t]; });
    try { setSetting({ tables: list, tableInfo: keep }); success(msg); setDraft(null); } catch (e) { explain(e); }
  }

  function startAdd(area?: string) {
    const a = area || areas[0] || NO_AREA;
    const inArea = tables.filter((t) => areaOf(t) === a).length;
    setDraft({ mode: 'add', name: '', area: a, newArea: '', seats: 4, count: '4', prefix: a === NO_AREA ? 'Table' : a, from: String(inArea + 1) });
  }

  function commitDraft() {
    if (!draft) return;
    const area = (draft.area === '__new' ? draft.newArea.trim() : draft.area) || NO_AREA;
    const meta = { ...(area !== NO_AREA ? { area } : {}), ...(draft.seats ? { seats: draft.seats } : {}) };
    const taken = new Set(tables.map((t) => t.toLowerCase()));
    if (draft.mode === 'add') {
      const n = Math.min(100, Math.max(1, Number(draft.count) || 0));
      const start = Math.max(1, Number(draft.from) || 1);
      const prefix = draft.prefix.trim();
      const names = Array.from({ length: n }, (_, i) => (prefix ? prefix + ' ' : '') + (start + i));
      const clash = names.find((x) => taken.has(x.toLowerCase()));
      if (clash) { error('There is already a table called ' + clash + '. Start the numbers higher or change the name.'); return; }
      // a new run sits with its area, after that area's last table
      const lastOfArea = tables.map(areaOf).lastIndexOf(area);
      const list = lastOfArea >= 0 ? [...tables.slice(0, lastOfArea + 1), ...names, ...tables.slice(lastOfArea + 1)] : [...tables, ...names];
      const map = { ...info };
      names.forEach((x) => { map[x] = meta; });
      save(list, map, n + ' table' + (n === 1 ? '' : 's') + ' added to ' + area);
      return;
    }
    const name = draft.name.trim();
    if (!name) { error('Give the table a name.'); return; }
    if (name.toLowerCase() !== draft.was!.toLowerCase() && taken.has(name.toLowerCase())) { error('There is already a table called ' + name + '.'); return; }
    if (name !== draft.was && busy(draft.was!)) { error(draft.was + ' has an open ticket. Rename it after the bill is paid.'); return; }
    const list = tables.map((t) => (t === draft.was ? name : t));
    const map = { ...info };
    delete map[draft.was!];
    map[name] = meta;
    save(list, map, name + ' saved');
  }

  function remove(t: string) {
    if (busy(t)) { error(t + ' has an open ticket. Remove it after the bill is paid.'); return; }
    save(tables.filter((x) => x !== t), info, t + ' removed');
  }

  const stepper = (v: number, set: (n: number) => void) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Pressable onPress={() => set(Math.max(0, v - 1))} style={{ width: 40, height: 40, borderRadius: 4, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 20, color: colors.ink }}>−</Text></Pressable>
      <Text style={{ minWidth: 30, textAlign: 'center', fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink }}>{v || '—'}</Text>
      <Pressable onPress={() => set(Math.min(40, v + 1))} style={{ width: 40, height: 40, borderRadius: 4, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 20, color: colors.ink }}>+</Text></Pressable>
    </View>
  );

  return (
    <View style={{ borderRadius: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, marginBottom: 12, overflow: 'hidden' }}>
      <View style={{ padding: 14, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="chair" size={18} color={colors.ink} />
          <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>Tables</Text>
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint }}>
            {tables.length} table{tables.length === 1 ? '' : 's'}{seatsTotal ? ' · ' + seatsTotal + ' seats' : ''}
          </Text>
        </View>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
          The floor the waiters see when they start a dine-in order. Group tables by area and give each its seats. Tap a table to rename it or move it.
        </Text>
      </View>

      {areas.map((a) => {
        const list = tables.filter((t) => areaOf(t) === a);
        const seats = list.reduce((n, t) => n + (info[t]?.seats || 0), 0);
        return (
          <View key={a} style={{ borderTopWidth: 1, borderTopColor: colors.line, padding: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.faint }}>
                {a} · {list.length}{seats ? ' · ' + seats + ' seats' : ''}
              </Text>
              <Pressable hitSlop={8} onPress={() => startAdd(a)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon name="plus" size={15} color={colors.accent} />
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: colors.accent }}>Add</Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {list.map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setDraft({ mode: 'edit', was: t, name: t, area: areaOf(t), newArea: '', seats: info[t]?.seats || 0, count: '', prefix: '', from: '' })}
                  style={({ pressed }) => ({ minWidth: 88, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 4, borderWidth: 1.4, borderColor: busy(t) ? colors.warn : colors.line, backgroundColor: pressed ? colors.sunk : colors.bg })}
                >
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.ink }}>{t}</Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: busy(t) ? colors.warn : colors.faint, marginTop: 2 }}>
                    {busy(t) ? 'Open ticket' : info[t]?.seats ? info[t]!.seats + ' seats' : 'Seats not set'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}

      <View style={{ borderTopWidth: tables.length ? 1 : 0, borderTopColor: colors.line, padding: 14 }}>
        {!tables.length ? (
          <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, color: colors.soft, marginBottom: 10 }}>
            No tables yet. Without them, waiters type a table name on each order.
          </Text>
        ) : null}
        <Button size="sm" label={tables.length ? 'Add tables or a new area' : 'Set up your tables'} icon={<Icon name="plus" size={15} color={colors.ink} />} onPress={() => startAdd()} />
      </View>

      <Sheet
        visible={!!draft}
        title={draft?.mode === 'edit' ? draft.was! : 'Add tables'}
        icon="chair"
        onClose={() => setDraft(null)}
        footer={draft ? <Button variant="pri" label={draft.mode === 'edit' ? 'Save table' : 'Add ' + (Math.min(100, Math.max(1, Number(draft.count) || 0)) || '') + ' table' + (Number(draft.count) === 1 ? '' : 's')} onPress={commitDraft} /> : undefined}
      >
        {draft ? (
          <>
            {draft.mode === 'edit' ? (
              <Field label="Table name" value={draft.name} onChangeText={(v) => setDraft({ ...draft, name: v })} placeholder="Table 4" />
            ) : null}
            <SelectField
              label="Area"
              icon="menu"
              value={draft.area}
              options={[...new Set([...areas, NO_AREA, draft.area])].filter((x) => x !== '__new').map((v) => ({ v, l: v })).concat([{ v: '__new', l: 'A new area…' }])}
              onChange={(v) => setDraft({ ...draft, area: v, ...(draft.mode === 'add' && v !== '__new' ? { prefix: v === NO_AREA ? 'Table' : v, from: String(tables.filter((t) => areaOf(t) === v).length + 1) } : {}) })}
            />
            {draft.area === '__new' ? (
              <Field label="New area" value={draft.newArea} onChangeText={(v) => setDraft({ ...draft, newArea: v, ...(draft.mode === 'add' ? { prefix: v, from: '1' } : {}) })} placeholder="Patio, VIP, Rooftop, Bar" />
            ) : null}
            {draft.mode === 'add' ? (
              <>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}><Field label="How many" numeric money={false} value={draft.count} onChangeText={(v) => setDraft({ ...draft, count: v })} /></View>
                  <View style={{ flex: 1 }}><Field label="Numbers start at" numeric money={false} value={draft.from} onChangeText={(v) => setDraft({ ...draft, from: v })} /></View>
                </View>
                <Field label="Name before the number" value={draft.prefix} onChangeText={(v) => setDraft({ ...draft, prefix: v })} placeholder="Table, Patio, T" />
                {(() => {
                  const n = Math.min(100, Math.max(1, Number(draft.count) || 0));
                  const s = Math.max(1, Number(draft.from) || 1);
                  const p = draft.prefix.trim() ? draft.prefix.trim() + ' ' : '';
                  return (
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.soft, marginBottom: 12 }}>
                      Adds {p}{s}{n > 1 ? ' to ' + p + (s + n - 1) : ''}
                    </Text>
                  );
                })()}
              </>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, marginBottom: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 14.5, color: colors.ink }}>Seats{draft.mode === 'add' ? ' at each' : ''}</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>Helps seat a party at a table that fits</Text>
              </View>
              {stepper(draft.seats, (n) => setDraft({ ...draft, seats: n }))}
            </View>
            {draft.mode === 'edit' ? (
              <Button variant="dngr" size="sm" label={'Remove ' + draft.was} icon={<Icon name="trash" size={15} color={colors.danger} />} onPress={() => remove(draft.was!)} />
            ) : null}
          </>
        ) : null}
      </Sheet>
    </View>
  );
}
