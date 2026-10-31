/**
 * quickBlock() — reference line 5506 — and SHEETS.quickAll — reference line 6223.
 * The dashboard shows a 5-column `.qgrid` of `.qbtn` tiles that expand inline into
 * a 2-column `.g2` of `.tile.qact` actions; the centre FAB opens the same catalogue
 * as a bottom sheet titled "What are you doing?".
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Animated, ScrollView, Pressable as RNPressable } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pressable } from './Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { canFor } from '../data/perms';
import { QuickGroup, QuickTone, quickFor, COMMON_FOR } from '../data/quick';
import { editionOf } from '../data/editions';
import { Grid, Tile, Cap, Chip, Search, ListRow, EmptyBlock } from './ui';
import { Icon } from './icons';
import { Sheet } from './Sheet';
import { useGo } from '../nav/navigate';

export function useToneColor() {
  const { colors } = useTheme();
  // black icons on a quiet tile, whatever the group
  return (_t: QuickTone | 'soft'): [string, string] => [colors.ink, colors.sunk];
}

function useVisibleQuick(): QuickGroup[] {
  const { db } = useAppData();
  const role = db?.session.role;
  return quickFor(editionOf(db)).filter((g) => canFor(role, g.perm)).map((g) => ({
    ...g,
    items: g.items.filter((it) => canFor(role, it.perm)),
  }));
}

function ActionTiles({ group, onPick }: { group: QuickGroup; onPick: (route: string, params?: any) => void }) {
  const tone = useToneColor();
  const [fg] = tone(group.tone);
  return (
    <Grid cols={2}>
      {group.items.map((it) => (
        <Tile key={it.n} icon={it.i} iconColor={fg} name={it.n} horizontal onPress={() => onPick(it.route, it.params)} />
      ))}
    </Grid>
  );
}

/** The dashboard block. */
export function QuickBlock() {
  const { colors } = useTheme();
  const go = useGo();
  const groups = useVisibleQuick();
  const [open, setOpen] = useState<string>('');
  const tone = useToneColor();

  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 9 }}>
        <Cap>Quick actions</Cap>
        <Chip label={open === '__all' ? 'Close' : 'Show all'} onPress={() => setOpen(open === '__all' ? '' : '__all')} />
      </View>

      <Grid cols={5} gap={7}>
        {groups.map((g) => {
          const on = open === g.g || open === '__all';
          const [fg, bg] = tone(g.tone);
          return (
            <Pressable
              key={g.g}
              onPress={() => setOpen(on && open !== '__all' ? '' : g.g)}
              style={{
                backgroundColor: on ? colors.accentSoft : colors.surface,
                borderWidth: 1, borderColor: on ? colors.accent : colors.line, borderRadius: 4,
                paddingTop: 9, paddingBottom: 8, paddingHorizontal: 4, alignItems: 'center', gap: 5,
              }}
            >
              <View style={{ width: 30, height: 30, borderRadius: 4, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={g.i} size={17} color={fg} />
              </View>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: on ? colors.accent : colors.soft }}>{g.g}</Text>
            </Pressable>
          );
        })}
      </Grid>

      {groups.filter((g) => open === g.g || open === '__all').map((g) => (
        <View key={g.g}>
          <Cap style={{ marginTop: 12, marginBottom: 8 }}>{g.g}</Cap>
          <ActionTiles group={g} onPick={go} />
        </View>
      ))}
    </View>
  );
}

/** The centre-button sheet. */
/**
 * The centre-button sheet — the one list most people reach for.
 *
 * It used to be five stacked headings and forty-two tiles, which is a scroll
 * rather than a menu. Now it opens on the handful of things done most often,
 * with the rest a tap away by group, and a search over everything for people
 * who already know what they want. Typing skips the grouping entirely, which
 * is how anybody who has used the app for a week will actually use it.
 */
/** The section headings, in the words of what is done there. */
const SECTION: Record<string, string> = {
  Sell: 'Sale transactions', Money: 'Money', Stock: 'Stock & purchases', People: 'People', Day: 'Day & reports',
};

/* Each group keeps one colour through the sheet — its chip, its icons, its tiles —
   so the eye finds Money or Stock by colour before reading a word. */
const HUE: Record<QuickTone, string> = {
  accent: '#2563EB', good: '#0E9F6E', warnc: '#D97706', rail: '#7C3AED', danger: '#DB2777',
};
const soft = (hex: string, a = '1F') => hex + a;

/** What this phone added most recently, first — kept between visits. */
const RECENT_KEY = 'quick.recent';
let recentMem: string[] = [];

/** A tile that gives under the finger and springs back. */
function Pop({ onPress, style, children, label }: { onPress: () => void; style: any; children: React.ReactNode; label: string }) {
  const s = useRef(new Animated.Value(1)).current;
  const to = (v: number) => Animated.spring(s, { toValue: v, useNativeDriver: true, speed: 40, bounciness: v === 1 ? 10 : 0 }).start();
  return (
    <RNPressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onPressIn={() => to(0.94)} onPressOut={() => to(1)} style={{ width: style?.width }}>
      <Animated.View style={[style, { width: '100%', transform: [{ scale: s }] }]}>{children}</Animated.View>
    </RNPressable>
  );
}

export function QuickSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const go = useGo();
  const groups = useVisibleQuick();
  const [q, setQ] = useState('');
  /** The group chip picked; '' shows everything. */
  const [only, setOnly] = useState('');
  const [recent, setRecent] = useState<string[]>(recentMem);

  useEffect(() => {
    if (!visible) return;
    AsyncStorage.getItem(RECENT_KEY).then((v) => { try { const r = JSON.parse(v || '[]'); recentMem = r; setRecent(r); } catch { /* none kept */ } }).catch(() => {});
  }, [visible]);

  // the sheet rises with its tiles following a moment behind
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) { rise.setValue(0); return; }
    Animated.timing(rise, { toValue: 1, duration: 260, delay: 60, useNativeDriver: true }).start();
  }, [visible, rise]);

  const pick = (name: string, route: string, params?: Record<string, unknown>) => {
    const next = [name, ...recent.filter((x) => x !== name)].slice(0, 4);
    recentMem = next;
    setRecent(next);
    AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => {});
    onClose();
    setQ('');
    setOnly('');
    setTimeout(() => go(route, params), 120);
  };

  /** Everything, flattened, for the search. */
  const all = useMemo(
    () => groups.flatMap((g) => g.items.map((it) => ({ g, it }))),
    [groups],
  );

  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return all.filter(({ g, it }) => (it.n + ' ' + g.g + ' ' + (SECTION[g.g] || '')).toLowerCase().includes(needle));
  }, [all, q]);

  /** What a shop does all day: shown first, largest, so the common case is one tap. */
  const { db } = useAppData();
  const COMMON = COMMON_FOR[editionOf(db)];
  const common = useMemo(
    () => COMMON.map((n) => all.find((x) => x.it.n === n)).filter(Boolean) as typeof all,
    [all, COMMON],
  );
  const lately = recent.map((n) => all.find((x) => x.it.n === n)).filter(Boolean) as typeof all;

  const fade = (i: number) => ({
    opacity: rise,
    transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [10 + i * 4, 0] }) }],
  });

  const big = ({ g, it }: (typeof all)[number], i: number) => {
    const hue = HUE[g.tone];
    return (
      <Animated.View key={it.n} style={[{ width: '48.5%' }, fade(i)]}>
        <Pop label={it.n} onPress={() => pick(it.n, it.route, it.params)} style={{
          flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 4,
          backgroundColor: soft(hue, '14'), borderWidth: 1, borderColor: soft(hue, '40'),
        }}>
          <View style={{ width: 38, height: 38, borderRadius: 4, backgroundColor: hue, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={it.i} size={20} color="#fff" />
          </View>
          <Text numberOfLines={2} style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 13.5, lineHeight: 17, color: colors.ink }}>{it.n}</Text>
        </Pop>
      </Animated.View>
    );
  };

  const shown = groups.filter((g) => !only || g.g === only);

  return (
    <Sheet visible={visible} title="Quick add" subtitle="What are you recording?" onClose={onClose} full>
      <Search value={q} onChange={setQ} placeholder="Search: sale, expense, customer…" />

      {/* the groups as coloured chips: a tap narrows the sheet to that group */}
      {!q.trim() ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12, marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
          {[{ g: '', i: 'grid' as any, tone: 'accent' as QuickTone }, ...groups].map((g) => {
            const on = only === g.g;
            const hue = g.g ? HUE[g.tone] : colors.ink;
            return (
              <RNPressable key={g.g || 'all'} onPress={() => setOnly(on ? '' : g.g)} style={{
                flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999,
                backgroundColor: on ? hue : soft(g.g ? hue : '#64748B', '14'), borderWidth: 1, borderColor: on ? hue : 'transparent',
              }}>
                {g.g ? <Icon name={g.i} size={14} color={on ? '#fff' : hue} /> : null}
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: on ? (g.g ? '#fff' : colors.bg) : colors.ink }}>{g.g ? SECTION[g.g] || g.g : 'Everything'}</Text>
              </RNPressable>
            );
          })}
        </ScrollView>
      ) : null}

      {q.trim() ? (
        <View style={{ marginTop: 14 }}>
          {hits.length ? hits.map(({ g, it }) => (
            <ListRow key={g.g + it.n} icon={it.i} title={it.n} subtitle={SECTION[g.g] || g.g} onPress={() => pick(it.n, it.route, it.params)} />
          )) : (
            <EmptyBlock icon="dots" title={'Nothing matches "' + q.trim() + '"'} hint="Try the name of the thing itself — a sale, an expense, a customer." />
          )}
        </View>
      ) : (
        <>
          {!only && lately.length ? (
            <View style={{ paddingTop: 16 }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 11.5, letterSpacing: 0.6, color: colors.faint, marginBottom: 8 }}>LAST USED</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {lately.map(({ g, it }) => (
                  <RNPressable key={it.n} onPress={() => pick(it.n, it.route, it.params)} style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 4,
                    backgroundColor: pressed ? colors.sunk : colors.surface, borderWidth: 1, borderColor: colors.line,
                  })}>
                    <Icon name={it.i} size={15} color={HUE[g.tone]} />
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink }}>{it.n}</Text>
                  </RNPressable>
                ))}
              </View>
            </View>
          ) : null}

          {!only && common.length ? (
            <View style={{ paddingTop: 16, paddingBottom: 6 }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 11.5, letterSpacing: 0.6, color: colors.faint, marginBottom: 8 }}>MOST USED</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 }}>
                {common.map(big)}
              </View>
            </View>
          ) : null}

          {shown.map((g, gi) => {
            const rest = only ? g.items : g.items.filter((it) => !COMMON.includes(it.n));
            if (!rest.length) return null;
            const hue = HUE[g.tone];
            return (
              <Animated.View key={g.g} style={[{ paddingTop: 16 }, fade(gi + 2)]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <View style={{ width: 4, height: 14, borderRadius: 2, backgroundColor: hue }} />
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 11.5, letterSpacing: 0.6, color: colors.faint }}>{(SECTION[g.g] || g.g).toUpperCase()}</Text>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', rowGap: 8 }}>
                  {rest.map((it) => (
                    <Pop key={it.n} label={it.n} onPress={() => pick(it.n, it.route, it.params)} style={{ width: '25%', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 3 }}>
                      <View style={{ width: 48, height: 48, borderRadius: 4, backgroundColor: soft(hue), alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name={it.i} size={22} color={hue} />
                      </View>
                      <Text numberOfLines={2} style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, lineHeight: 14, color: colors.ink, textAlign: 'center', marginTop: 6 }}>
                        {it.n}
                      </Text>
                    </Pop>
                  ))}
                </View>
              </Animated.View>
            );
          })}
        </>
      )}
    </Sheet>
  );
}
