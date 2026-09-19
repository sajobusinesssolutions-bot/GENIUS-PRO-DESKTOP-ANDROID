/**
 * quickBlock() — reference line 5506 — and SHEETS.quickAll — reference line 6223.
 * The dashboard shows a 5-column `.qgrid` of `.qbtn` tiles that expand inline into
 * a 2-column `.g2` of `.tile.qact` actions; the centre FAB opens the same catalogue
 * as a bottom sheet titled "What are you doing?".
 */
import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { canFor } from '../data/perms';
import { QUICK, QuickGroup, QuickTone } from '../data/quick';
import { Grid, Tile, Cap, Chip } from './ui';
import { Icon } from './icons';
import { Sheet } from './Sheet';
import { useGo } from '../nav/navigate';

export function useToneColor() {
  const { colors } = useTheme();
  return (t: QuickTone | 'soft'): [string, string] => {
    switch (t) {
      case 'accent': return [colors.accent, colors.accentSoft];
      case 'good': return [colors.good, colors.goodSoft];
      case 'warnc': return [colors.warn, colors.warnSoft];
      case 'rail': return [colors.rail, colors.sunk];
      case 'danger': return [colors.danger, colors.dangerSoft];
      default: return [colors.soft, colors.sunk];
    }
  };
}

function useVisibleQuick(): QuickGroup[] {
  const { db } = useAppData();
  const role = db?.session.role;
  return QUICK.filter((g) => canFor(role, g.perm)).map((g) => ({
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
                borderWidth: 1, borderColor: on ? colors.accent : colors.line, borderRadius: 12,
                paddingTop: 9, paddingBottom: 8, paddingHorizontal: 4, alignItems: 'center', gap: 5,
              }}
            >
              <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={g.i} size={17} color={fg} />
              </View>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 10, color: on ? colors.accent : colors.soft }}>{g.g}</Text>
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
export function QuickSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const go = useGo();
  const groups = useVisibleQuick();
  return (
    <Sheet visible={visible} title="What are you doing?" icon="bulb" onClose={onClose}>
      {groups.map((g) => (
        <View key={g.g} style={{ marginBottom: 14 }}>
          <Cap style={{ marginTop: 4, marginBottom: 8 }}>{g.g}</Cap>
          <ActionTiles group={g} onPick={(r, p) => { onClose(); setTimeout(() => go(r, p), 120); }} />
        </View>
      ))}
    </Sheet>
  );
}
