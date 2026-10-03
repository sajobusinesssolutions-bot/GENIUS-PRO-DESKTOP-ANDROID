/**
 * The report list — every report in the catalogue, grouped by category,
 * with a search box and the five most-used pinned on top.
 * Reference SCREENS.reports.body, line 5355.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Pressable } from '../components/Press';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useGo } from '../nav/navigate';
import { canFor } from '../data/perms';
import { mayCreate } from '../data/logic';
import { isPremiumReport , reportPermission } from '../data/reports';
import { Card, Cap, SearchBar, EmptyState, Pad, Badge } from '../components/ui';
import Icon from '../components/icons';
import {
  REPORTS, REPORT_CATEGORIES, FAVOURITE_REPORTS, ReportDef, isImplemented, reportEntries, ReportEntry, groupOf,
} from '../data/reports';
import type { RootStackParamList } from '../nav/types';

function ReportRow({ r, last, onPress, icon, isFav, onToggleFav }: {
  r: ReportEntry; last?: boolean; onPress: () => void; icon?: boolean; isFav?: boolean; onToggleFav?: () => void;
}) {
  const { colors } = useTheme();
  const { db } = useAppData();
  const live = isImplemented(r.id);
  const locked = !!db && !mayCreate(db)
    && (r.group ? r.group.views.every((v) => isPremiumReport(v.id)) : isPremiumReport(r.id));
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingVertical: 13, paddingHorizontal: 15, minHeight: 62,
        borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.line,
        backgroundColor: pressed ? colors.sunk : 'transparent',
      })}
    >
      <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: live ? colors.accentSoft : colors.sunk, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="chart" size={19} color={live ? colors.accent : colors.faint} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }} numberOfLines={1}>
          {r.name}
        </Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }} numberOfLines={1}>
          {r.sub}
        </Text>
        {r.group ? (
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.accent, marginTop: 3 }} numberOfLines={1}>
            {r.group.views.length} views · {r.group.views.map((v) => v.label).join(' · ')}
          </Text>
        ) : null}
      </View>
      {!live ? <Badge label="Soon" tone="neutral" /> : locked ? <Icon name="lock" size={16} color={colors.faint} /> : null}
      {onToggleFav && (
        <Pressable onPress={onToggleFav} hitSlop={8} style={{ paddingHorizontal: 6 }}>
          <Icon name="tag" size={18} color={isFav ? colors.accent : colors.lineHard} />
        </Pressable>
      )}
      <Icon name="chev" size={17} color={colors.faint} />
    </Pressable>
  );
}

export default function ReportsScreen() {
  const { colors } = useTheme();
  const { db } = useAppData();
  const go = useGo();
  const nav = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'Reports'>>();
  const [q, setQ] = useState('');
  const [favs, setFavs] = useState<Set<string>>(new Set(db?.settings?.favReports || []));

  // The till's quick actions push Reports with a report id — reference quick.ts.
  const jumpTo = route.params?.id;
  useEffect(() => {
    if (!jumpTo) return;
    nav.setParams({ id: undefined });
    nav.navigate('ReportDetail', { id: jumpTo });
  }, [jumpTo, nav]);

  const role = db?.session.role;
  const allowed = canFor(role, 'reports');

  /* Each group of similar reports is one row; searching finds a group by any of its views. */
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const words = (e: ReportEntry) => e.name + ' ' + e.sub + ' ' + e.cat + ' '
      + (e.group ? e.group.views.map((v) => { const d = REPORTS.find((x) => x.id === v.id); return v.label + ' ' + (d ? d.name + ' ' + d.sub : ''); }).join(' ') : '');
    // a report this role may not open is not listed at all
    // a tax report means nothing to a shop that charges no tax
    const taxOff = db?.settings.taxEnabled === false;
    const may = (id: string) => { if (taxOff && id === 'tax-summary') return false; const p = reportPermission(id); return !p || canFor(role, p); };
    const all = reportEntries().filter((e) => (e.group ? e.group.views.some((v) => may(v.id)) : may(e.id)));
    const list = needle ? all.filter((e) => words(e).toLowerCase().includes(needle)) : all;
    return REPORT_CATEGORIES
      .map((cat) => ({
        cat,
        items: list.filter((r) => r.cat === cat).sort((a, b) => {
          const aFav = favs.has(a.id);
          const bFav = favs.has(b.id);
          return aFav && !bFav ? -1 : !aFav && bFav ? 1 : 0;
        }),
      }))
      .filter((g) => g.items.length);
  }, [q, favs, role, db?.settings.taxEnabled]);

  const favourites = useMemo(
    () => FAVOURITE_REPORTS.map((id) => REPORTS.find((r) => r.id === id)).filter(Boolean) as ReportDef[],
    [],
  );

  if (!db) return null;

  if (!allowed) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <EmptyState
          icon="lock"
          title="Reports are not open to you"
          subtitle="Ask the owner to give your role report access."
        />
      </View>
    );
  }

  const open = (id: string) => {
    const g = groupOf(id);
    const free = g && !mayCreate(db) ? g.views.find((v) => !isPremiumReport(v.id)) : undefined;
    go('ReportDetail', { id: free && isPremiumReport(id) ? free.id : id });
  };
  const toggleFav = (id: string) => {
    setFavs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SearchBar value={q} onChange={setQ} placeholder="Search reports" />
      <ScrollView contentContainerStyle={{ paddingBottom: 22 }}>
        {!q && Array.from(favs).length ? (
          <Pad style={{ paddingTop: 12, paddingBottom: 4 }}>
            <Cap style={{ marginBottom: 8 }}>Favorites</Cap>
            <Card>
              {REPORTS.filter((r) => favs.has(r.id)).map((r, i, arr) => (
                <ReportRow
                  key={r.id}
                  r={r}
                  icon
                  last={i === arr.length - 1}
                  isFav
                  onPress={() => open(r.id)}
                  onToggleFav={() => toggleFav(r.id)}
                />
              ))}
            </Card>
          </Pad>
        ) : null}

        {groups.length === 0 ? (
          <EmptyState icon="search" title="No report matches" subtitle="Try a shorter word." />
        ) : (
          groups.map((g) => (
            <Pad key={g.cat} style={{ paddingTop: 10, paddingBottom: 4 }}>
              <Cap style={{ marginBottom: 8 }}>{g.cat} — {g.items.length}</Cap>
              <Card>
                {g.items.map((r, i) => (
                  <ReportRow
                    key={r.id}
                    r={r}
                    last={i === g.items.length - 1}
                    isFav={favs.has(r.id)}
                    onPress={() => open(r.id)}
                    onToggleFav={() => toggleFav(r.id)}
                  />
                ))}
              </Card>
            </Pad>
          ))
        )}
      </ScrollView>
    </View>
  );
}
