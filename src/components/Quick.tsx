/**
 * quickBlock() — reference line 5506 — and SHEETS.quickAll — reference line 6223.
 * The dashboard shows a 5-column `.qgrid` of `.qbtn` tiles that expand inline into
 * a 2-column `.g2` of `.tile.qact` actions; the centre FAB opens the same catalogue
 * as a bottom sheet titled "What are you doing?".
 */
import React, { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
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

export function QuickSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const go = useGo();
  const groups = useVisibleQuick();
  const tone = useToneColor();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string>('');

  const pick = (route: string, params?: Record<string, unknown>) => {
    onClose();
    setQ('');
    setOpen('');
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
    return all.filter(({ g, it }) => (it.n + ' ' + g.g).toLowerCase().includes(needle));
  }, [all, q]);

  /**
   * What a shop does all day. Shown first so the common case is one tap, not
   * one tap after a scroll past everything it is not.
   */
  const { db } = useAppData();
  const COMMON = COMMON_FOR[editionOf(db)];
  const common = useMemo(
    () => COMMON.map((n) => all.find((x) => x.it.n === n)).filter(Boolean) as typeof all,
    [all, COMMON],
  );

  return (
    <Sheet visible={visible} title="Quick add" onClose={onClose} full>
      <Search value={q} onChange={setQ} placeholder="Search everything you can add" />

      {q.trim() ? (
        <View style={{ marginTop: 14 }}>
          {hits.length ? hits.map(({ g, it }) => {
            const [fg] = tone(g.tone);
            return (
              <ListRow
                key={g.g + it.n}
                icon={it.i}
                title={it.n}
                subtitle={g.g}
                onPress={() => pick(it.route, it.params)}
              />
            );
          }) : (
            <EmptyBlock
              icon="dots"
              title={'Nothing matches "' + q.trim() + '"'}
              hint="Try the name of the thing itself — a sale, an expense, a customer."
            />
          )}
        </View>
      ) : (
        <>
          {/* the jobs done all day, first and largest */}
          {common.length ? (
            <View style={{ paddingTop: 16, paddingBottom: 10 }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 16, color: colors.ink, marginBottom: 10 }}>Most used</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {common.map(({ it }) => (
                  <Pressable
                    key={it.n}
                    onPress={() => pick(it.route, it.params)}
                    style={({ pressed }) => ({
                      width: '31.5%', alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 6, borderRadius: 4,
                      backgroundColor: pressed ? colors.sunk : colors.surface, borderWidth: 1, borderColor: colors.line,
                    })}
                  >
                    <Icon name={it.i} size={28} color={colors.ink} />
                    <Text numberOfLines={2} style={{ fontFamily: fonts.uiSemi, fontSize: 13, lineHeight: 17, color: colors.ink, textAlign: 'center' }}>
                      {it.n}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {/* everything else, by group, without repeating the above */}
          {groups.map((g) => {
            const rest = g.items.filter((it) => !COMMON.includes(it.n));
            if (!rest.length) return null;
            return (
              <View
                key={g.g}
                style={{ paddingTop: 14, paddingBottom: 4, marginHorizontal: -16, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: colors.line }}
              >
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.faint, marginBottom: 8 }}>{SECTION[g.g] || g.g}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {rest.map((it) => (
                    <Pressable
                      key={it.n}
                      onPress={() => pick(it.route, it.params)}
                      style={({ pressed }) => ({
                        width: '25%', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 3, borderRadius: 4,
                        backgroundColor: pressed ? colors.sunk : 'transparent',
                      })}
                    >
                      <View style={{ width: 46, height: 46, borderRadius: 4, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name={it.i} size={21} color={colors.ink} />
                      </View>
                      <Text numberOfLines={2} style={{ fontFamily: fonts.ui, fontSize: 12, lineHeight: 15, color: colors.soft, textAlign: 'center', marginTop: 6 }}>
                        {it.n}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            );
          })}
        </>
      )}
    </Sheet>
  );
}
