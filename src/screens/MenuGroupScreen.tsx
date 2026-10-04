/** One menu group: its own name as the title, and a tidy list of what is in it. */
import React, { useEffect } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Pressable } from '../components/Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { canFor } from '../data/perms';
import { menuGroup, itemShown } from '../data/menuGroups';
import { EmptyState } from '../components/ui';
import { Icon } from '../components/icons';
import { useGo } from '../nav/navigate';

export default function MenuGroupScreen({ route, navigation }: any) {
  const { colors } = useTheme();
  const go = useGo();
  const { db } = useAppData();
  const g = menuGroup(route?.params?.groupId);

  // the title is the name that was tapped
  useEffect(() => { if (g) navigation?.setOptions?.({ title: g.n }); }, [navigation, g]);

  if (!db) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (!g) return <EmptyState icon="dots" title="Not found" />;

  const items = g.items.filter((it) => canFor(db.session.role, it.perm) && itemShown(it, db));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <View style={{ borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }}>
        {items.map((it, i) => (
          <Pressable
            key={it.route + it.n}
            onPress={() => go(it.route, it.params)}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52, paddingHorizontal: 16,
              backgroundColor: pressed ? colors.sunk : 'transparent',
              borderBottomWidth: i === items.length - 1 ? 0 : 1, borderBottomColor: colors.line,
            })}
          >
            <Icon name={it.i} size={20} color={colors.ink} />
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{it.n}</Text>
            <Icon name="chev" size={14} color={colors.faint} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
