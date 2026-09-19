/** SCREENS.menuGroup — reference line 6605. A plain card list of the group's items. */
import React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { canFor } from '../data/perms';
import { menuGroup } from '../data/menuGroups';
import { EmptyState, Panel, ListRow } from '../components/ui';
import { Icon } from '../components/icons';
import { useGo } from '../nav/navigate';

export default function MenuGroupScreen({ route }: any) {
  const { colors } = useTheme();
  const go = useGo();
  const { db, dueRecurring, activeShift } = useAppData();
  const g = menuGroup(route?.params?.groupId);

  if (!db) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (!g) return <EmptyState icon="dots" title="Not found" />;

  const ctx = { db, dueRecurring, activeShift };
  const items = g.items.filter((it) => canFor(db.session.role, it.perm));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <Panel flush>
        {items.map((it, i) => (
          <ListRow
            key={it.route + it.n}
            icon={it.i}
            title={it.n}
            subtitle={it.b(ctx)}
            onPress={() => go(it.route, it.params)}
            last={i === items.length - 1}
          />
        ))}
      </Panel>
    </ScrollView>
  );
}
