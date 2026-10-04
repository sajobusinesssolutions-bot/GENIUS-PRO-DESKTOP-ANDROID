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
import { View, Text, ScrollView, Alert } from 'react-native';
import { Pressable } from '../components/Press';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { canFor } from '../data/perms';
import { MENU_GROUPS, searchMenu, MenuCtx, itemShown } from '../data/menuGroups';
import {
  Card, Grid, Avatar, Button, Panel, Badge, ListRow, SectionLabel, Search, EmptyState,
} from '../components/ui';
import { AppBar } from '../components/AppBar';
import { Sheet } from '../components/Sheet';
import ThemePicker from '../components/ThemePicker';
import { Icon } from '../components/icons';
import { useGo, useGoReset } from '../nav/navigate';
import { useToneColor } from '../components/Quick';
import { useAuth } from '../data/AuthContext';
import { deleteAccount, refreshSession } from '../data/authApi';
import { Field } from '../components/form';
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
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const role = db?.session.role;
  const isOwner = role === 'owner';

  const groups = useMemo(() => MENU_GROUPS.filter((g) => {
    if (g.perm && !canFor(role, g.perm)) return false;
    return g.items.some((it) => canFor(role, it.perm) && itemShown(it, db));
  }), [role]);

  // a row the signed-in person cannot open should not be findable either
  const hits = useMemo(
    () => searchMenu(q).filter((h) => canFor(role, h.item.perm) && itemShown(h.item, db) && (!h.group.perm || canFor(role, h.group.perm))),
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
      <AppBar brand title="Menu" />
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
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>
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
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink }}>
                  {branch?.name || 'No branch chosen'}
                </Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
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
                    subtitle={h.group.n}
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
                  const shown = g.items.filter((it) => canFor(role, it.perm) && itemShown(it, db)).length;
                  return (
                    <Pressable
                      key={g.id}
                      onPress={() => (g.open ? go(g.open) : go('MenuGroup', { groupId: g.id }))}
                      style={({ pressed }) => ({
                        backgroundColor: pressed ? colors.sunk : colors.surface,
                        borderRadius: 18, paddingVertical: 14, paddingHorizontal: 14,
                        gap: 10, flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 64,
                        shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14,
                        shadowOffset: { width: 0, height: 4 }, elevation: 2,
                      })}
                    >
                      <View style={{
                        width: 38, height: 38, borderRadius: 12, backgroundColor: colors.sunk,
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Icon name={g.i} size={19} color={colors.ink} />
                      </View>
                      <Text numberOfLines={2} style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 14.5, color: colors.ink }}>{g.n}</Text>
                    </Pressable>
                  );
                })}
              </Grid>
            </View>

            {/* how the app looks — moved here from Settings, where it was buried */}
            <View style={{ paddingHorizontal: 16, paddingTop: 18 }}>
              <ThemePicker />
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
                fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint,
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
                    onPress={() => setSigningOut(true)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12 }}
                  >
                    <Icon name="arrow" size={14} color={colors.danger} />
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.danger }}>Sign out</Text>
                  </Pressable>
                  {account && !account.localOnly ? (
                    <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setDeleting(true)} style={{ paddingVertical: 8, paddingHorizontal: 12 }}>
                      <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>Delete account</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
      <DeleteAccountSheet
        visible={deleting}
        email={account?.email || ''}
        onClose={() => setDeleting(false)}
        onDelete={async (typed) => {
          if (!account?.refresh) return 'Sign in again first.';
          const session = await refreshSession(account.refresh);
          if (!session.ok) return 'Sign in again first.';
          const r = await deleteAccount(session.value.access, typed);
          if (!r.ok) return r.error.message || 'The account could not be deleted.';
          await signOut();
          setDeleting(false);
          goReset('AuthGate');
          return null;
        }}
      />
      <SignOutSheet
        visible={signingOut}
        email={account?.email || ''}
        till={db?.session.till || ''}
        onClose={() => setSigningOut(false)}
        onLock={() => { setSigningOut(false); go('PinLock'); }}
        onSignOut={async () => { await signOut(); setSigningOut(false); goReset('AuthGate'); }}
      />
    </View>
  );
}

/**
 * Signing out, explained. The two ways out were easy to confuse: locking hands
 * the phone to the next person, signing out leaves the account. So the safe
 * choice sits first, and signing out is a clear red action of its own.
 */
function SignOutSheet({ visible, email, till, onClose, onLock, onSignOut }: {
  visible: boolean; email: string; till: string;
  onClose: () => void; onLock: () => void; onSignOut: () => Promise<void>;
}) {
  const { colors } = useTheme();
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (visible) setBusy(false); }, [visible]);
  const initial = (email.trim()[0] || '?').toUpperCase();
  return (
    <Sheet visible={visible} onClose={onClose} title="Sign out?">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: colors.sunk }}>
        <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 15, color: colors.accentInk }}>{initial}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{email || 'This account'}</Text>
          <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 1 }}>{till || 'This phone'}</Text>
        </View>
      </View>

      <Pressable onPress={onLock} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14 }}>
        <Icon name="lock" size={16} color={colors.accent} />
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.accent }}>Lock the till instead</Text>
      </Pressable>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Button label="Cancel" onPress={onClose} disabled={busy} /></View>
        <View style={{ flex: 1 }}>
          <Button
            variant="dngr"
            label={busy ? 'Signing out…' : 'Sign out'}
            loading={busy}
            onPress={async () => { setBusy(true); try { await onSignOut(); } finally { setBusy(false); } }}
          />
        </View>
      </View>
    </Sheet>
  );
}

/**
 * Deleting the account: what goes, said plainly, and the email typed to make
 * sure. Google Play requires an app with sign-up to offer this.
 */
function DeleteAccountSheet({ visible, email, onClose, onDelete }: {
  visible: boolean; email: string; onClose: () => void;
  /** Resolves to an error to show, or null when done. */
  onDelete: (typed: string) => Promise<string | null>;
}) {
  const { colors } = useTheme();
  const [typed, setTyped] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  React.useEffect(() => { if (visible) { setTyped(''); setErr(''); setBusy(false); } }, [visible]);
  const matches = typed.trim().toLowerCase() === email.trim().toLowerCase() && !!email;
  return (
    <Sheet visible={visible} onClose={onClose} title="Delete account?">
      <Text style={{ fontFamily: fonts.ui, fontSize: 14, lineHeight: 20, color: colors.soft, marginBottom: 14 }}>
        This permanently deletes {email || 'this account'}, its businesses and cloud copies, licences and sign-ins from our server.
        It cannot be undone. Books on this phone stay until you remove the app.
      </Text>
      <Field label="Type your email to confirm" value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false} keyboard="email-address" />
      {err ? <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.danger, marginBottom: 10 }}>{err}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Button label="Cancel" onPress={onClose} disabled={busy} /></View>
        <View style={{ flex: 1 }}>
          <Button
            variant="dngr"
            label={busy ? 'Deleting…' : 'Delete'}
            loading={busy}
            disabled={!matches}
            onPress={async () => {
              setBusy(true); setErr('');
              try { const e = await onDelete(typed.trim()); if (e) setErr(e); } finally { setBusy(false); }
            }}
          />
        </View>
      </View>
    </Sheet>
  );
}
