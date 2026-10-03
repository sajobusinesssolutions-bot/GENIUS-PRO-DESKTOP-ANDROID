import React, { useMemo, useState } from 'react';
import { View, Text, FlatList } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Empty, Search, SectionLabel } from '../components/ui';
import { Icon } from '../components/icons';

export default function AuditLogScreen() {
  const { colors } = useTheme();
  const { db } = useAppData();
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (db?.auditLog || []).filter((r) =>
      !needle
      || r.action.toLowerCase().includes(needle)
      || r.details.toLowerCase().includes(needle)
      || r.userName.toLowerCase().includes(needle));
  }, [db, q]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20, flexGrow: 1 }}
        ListHeaderComponent={
          <View style={{ paddingTop: 14, gap: 14, marginBottom: 14 }}>
            <Search value={q} onChange={setQ} placeholder="Filter by action, user or detail" />
            {rows.length ? (
              <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{rows.length} entries</Text>}>
                Audit trail
              </SectionLabel>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <Empty
            title={q ? 'Nothing matches that' : 'No audit entries'}
            subtitle={q ? 'Try a shorter word.' : 'Edits, voids and deletions are recorded here.'}
          />
        }
        renderItem={({ item }) => (
          <View
            style={{
              backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 13,
              marginBottom: 10, flexDirection: 'row', gap: 12,
              shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2,
            }}
          >
            <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="shield" size={19} color={colors.accent} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{item.action}</Text>
              {item.details ? (
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 18, color: colors.soft, marginTop: 3 }}>{item.details}</Text>
              ) : null}
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 5 }}>
                {item.userName} · {new Date(item.ts).toLocaleString()}
              </Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}
