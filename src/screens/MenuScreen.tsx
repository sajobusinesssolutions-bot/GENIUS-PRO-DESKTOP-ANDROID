/**
 * MENU
 *
 * Six cards, a search field and a footer. The regrouping itself lives in
 * ../data/menuGroups, which records what was merged into what and why.
 *
 * The search is the important part of this screen: thirty-odd rows across six
 * cards is more than anyone will hunt through twice, and people reach for the
 * name of a thing ("stock take", "vat", "backup") rather than the group it was
 * filed under. Typing skips the grid entirely.
 *
 * The branch a person is working in is now shown on the header card rather than
 * buried in a "This device" panel at the bottom, because a branch keeps its own
 * stock and its own books — which one is open changes what every other screen
 * will say.
 *
 * Reference: SCREENS.menu, line 6565, with the firm-switching card from 12515.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { canFor } from '../data/perms';
import { MENU_GROUPS, searchMenu, MenuCtx } from '../data/menuGroups';
import {
  Card, Grid, Avatar, Button, Panel, Badge, ListRow, SectionLabel, Search, EmptyState,
} from '../components/ui';
import { AppBar } from '../components/AppBar';
import { Icon } from '../components/icons';
import { useGo, useGoReset } from '../nav/navigate';
import { useToneColor } from '../components/Quick';
import { useAuth } from '../data/AuthContext';
import { useDeveloper } from '../data/useDeveloper';

export const BUILD = '1.0.0';

export default function MenuScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const goReset = useGoReset();
  const { db, me, dueRecurring, activeShift } = useAppData();
  const { account, signOut } = useAuth();
  // asked of the server, so a phone cannot talk itself into the console
  const { developer } = useDeveloper();
  const tone = useToneColor();
  const [q, setQ] = useState('');

  const role = db?.session.role;
  const isOwner = role === 'owner';

  const groups = useMemo(() => MENU_GROUPS.filter((g) => {
    if (g.perm && !canFor(role, g.perm)) return false;
    return g.items.some((it) => canFor(role, it.perm));
  }), [role]);

  // a row the signed-in person cannot open should not be findable either
  const hits = useMemo(
    () => searchMenu(q).filter((h) => canFor(role, h.item.perm) && (!h.group.perm || canFor(role, h.group.perm))),
    [q, role],
  );

  if (!db) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  const user = me();
  const ctx: MenuCtx = { db, dueRecurring, activeShift };
  const online = db.session.online !== false;
  const branch = db.warehouses.find((w) => w.id === db.session.warehouse);
  const manyFirms = (db.firms || []).length > 1;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AppBar title="Menu" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 20 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* who, and which branch — one card instead of a card and a panel */}
        <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
          <Card style={{ borderRadius: 18, overflow: 'hidden' }}>
            <Pressable
              onPress={() => go('PinLock')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 15 }}
            >
              <Avatar name={user?.name || '?'} id={user?.id} size={46} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 16, color: colors.ink }}>
                  {user?.name || '—'}
                </Text>
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                  {(role || '').charAt(0).toUpperCase() + (role || '').slice(1)} · {db.firm.name}
                </Text>
              </View>
              <Badge tone="accent" label="Switch" />
            </Pressable>

            <View style={{ height: 1, backgroundColor: colors.line }} />

            {/*
              Only the owner can open the branch panel, so only the owner is
              offered it. Everyone else sees which branch they are working in —
              which changes what every other screen says, and is worth knowing —
              as a plain line rather than a button onto a locked door.
            */}
            <Pressable
              onPress={isOwner ? () => go('Branches') : undefined}
              disabled={!isOwner}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12, paddingHorizontal: 15 }}
            >
              <View style={{
                width: 30, height: 30, borderRadius: 10, backgroundColor: colors.accentSoft,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon name="home" size={15} color={colors.accent} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>
                  {branch?.name || 'No branch chosen'}
                </Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 2 }}>
                  {isOwner ? 'Working branch · own stock and own books' : 'The branch you are working in'}
                </Text>
              </View>
              <Badge tone={online ? 'good' : 'warn'} label={online ? 'Online' : db.queue.length + ' queued'} />
              {isOwner ? <Icon name="chev" size={14} color={colors.faint} /> : null}
            </Pressable>
          </Card>
        </View>

        {/* search across every row in every group */}
        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          <Search value={q} onChange={setQ} placeholder="Search the menu" />
        </View>

        {q.trim() ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            {hits.length ? (
              <Panel flush>
                {hits.map((h, i) => (
                  <ListRow
                    key={h.group.id + h.item.route + h.item.n}
                    icon={h.item.i}
                    title={h.item.n}
                    subtitle={h.group.n + ' · ' + h.item.b(ctx)}
                    onPress={() => { setQ(''); go(h.item.route, h.item.params); }}
                    last={i === hits.length - 1}
                  />
                ))}
              </Panel>
            ) : (
              <Panel>
                <EmptyState
                  icon="dots"
                  title={'Nothing matches "' + q.trim() + '"'}
                  subtitle="Try the name of the thing itself — an item, a report, a setting."
                />
              </Panel>
            )}
          </View>
        ) : (
          <>
            {developer ? (
              <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
                <Panel flush>
                  <ListRow
                    icon="shield"
                    tone="accent"
                    title="Developer console"
                    subtitle="Owners, licences, server health and backups"
                    onPress={() => go('Developer')}
                    last
                  />
                </Panel>
              </View>
            ) : null}

            {/* more than one book: moving between them signs you out first */}
            {manyFirms ? (
              <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
                <Panel flush>
                  <ListRow
                    icon="swap"
                    tone="warn"
                    title="Work in another business"
                    subtitle="Signs you out first — each book opens with its own PIN"
                    onPress={() => go('Firms')}
                    last
                  />
                </Panel>
              </View>
            ) : null}

            <View style={{ paddingHorizontal: 16, paddingTop: 18 }}>
              <SectionLabel>Everything</SectionLabel>
              <Grid cols={2} gap={12}>
                {groups.map((g) => {
                  const [fg, bg] = tone(g.tone as any);
                  const shown = g.items.filter((it) => canFor(role, it.perm)).length;
                  return (
                    <Pressable
                      key={g.id}
                      onPress={() => (g.open ? go(g.open) : go('MenuGroup', { groupId: g.id }))}
                      style={({ pressed }) => ({
                        backgroundColor: pressed ? colors.sunk : colors.surface,
                        borderRadius: 18, paddingVertical: 15, paddingHorizontal: 14,
                        gap: 4, flex: 1, minHeight: 126,
                        shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14,
                        shadowOffset: { width: 0, height: 4 }, elevation: 2,
                      })}
                    >
                      <View style={{
                        width: 44, height: 44, borderRadius: 14, backgroundColor: bg,
                        alignItems: 'center', justifyContent: 'center', marginBottom: 8,
                      }}>
                        <Icon name={g.i} size={21} color={fg} />
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                        <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{g.n}</Text>
                        <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>{shown}</Text>
                      </View>
                      <Text numberOfLines={2} style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, lineHeight: 16 }}>
                        {g.b(ctx)}
                      </Text>
                    </Pressable>
                  );
                })}
              </Grid>
            </View>

            {/* one quiet footer line, rather than a panel repeating the Business card */}
            <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
              {/*
                Two different ways out, and they were conflated.

                "Lock the till" is for handing the phone to the next person on
                the counter — it asks for a PIN and the shop stays signed in.
                "Sign out" leaves the account itself, and the next thing anyone
                sees is the sign-in page. Logging out and being asked only for a
                PIN is not logging out.
              */}
              <Button
                label="Lock the till"
                icon={<Icon name="lock" size={17} color={colors.ink} />}
                onPress={() => go('PinLock')}
              />
              <Text style={{
                fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint,
                textAlign: 'center', marginTop: 14,
              }}>
                {account?.email ? account.email + ' · ' : ''}Genius POS {BUILD} · till {db.session.till}
              </Text>
              {/*
                Sign out sat ten points under "Lock the till", and staff pressing
                the wrong one signed the whole shop out — then the owner had to
                come and sign in again. So only the owner sees it, and it sits
                apart, below everything, as a quiet link rather than a big red
                button next to the one staff press every day.
              */}
              {isOwner ? (
                <View style={{ marginTop: 44, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.line, alignItems: 'center' }}>
                  <Pressable
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => Alert.alert(
                      'Sign out of ' + (account?.email || 'this account') + '?',
                      'Staff will not be able to use this phone until you sign in again with the account '
                      + 'email and password. To hand the till over, use "Lock the till" instead. '
                      + 'The shop\'s books stay on this phone.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Sign out',
                          style: 'destructive',
                          onPress: async () => { await signOut(); goReset('AuthGate'); },
                        },
                      ],
                    )}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12 }}
                  >
                    <Icon name="arrow" size={14} color={colors.danger} />
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.danger }}>Sign out of the account</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
