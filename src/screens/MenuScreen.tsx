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
import { MENU_GROUPS, searchMenu, MenuCtx, itemShown, rowName } from '../data/menuGroups';
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
import { deleteAccount, refreshSession, requestDeleteCode } from '../data/authApi';
import { Field } from '../components/form';
import { useDeveloper } from '../data/useDeveloper';

import { BUILD } from '../data/defaults';
import { roleName } from '../data/perms';
export { BUILD };

export default function MenuScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const goReset = useGoReset();
  const { db, me, dueRecurring, activeShift, setSetting } = useAppData();
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

  const theme = (db.settings.theme as 'light' | 'dark' | 'auto') || 'auto';
  const tiles = groups.filter((g) => g.id !== 'help');
  const card = { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line } as const;
  const initial = (user?.name || '?').trim().charAt(0).toUpperCase();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* the same header as Activity and the other tabs; Lock hands the phone on */}
      <AppBar
        brand
        title="Menu"
        right={(
          <Pressable
            onPress={() => go('PinLock')}
            accessibilityLabel="Lock the till"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 13, height: 34, borderRadius: 999, backgroundColor: colors.ink }}
          >
            <Icon name="lock" size={14} color={colors.surface} />
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 13.5, color: colors.surface }}>Lock</Text>
          </Pressable>
        )}
      />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24, gap: 12 }} keyboardShouldPersistTaps="handled">
        {/* who is at the till, and the branch they are working in */}
        <Pressable onPress={() => go('PinLock')} style={{ ...card, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
          <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 17, color: '#FFFFFF' }}>{initial}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 16, color: colors.ink }}>{user?.name || '—'}</Text>
            <Text
              numberOfLines={1}
              onPress={isOwner ? () => go('Branches') : undefined}
              style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}
            >
              {(branch?.name || 'No branch') + ' · ' + (isOwner ? 'own stock and own books' : roleName(db, role))}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 34, borderRadius: 10, backgroundColor: colors.accentSoft }}>
            <Icon name="swap" size={14} color={colors.accent} />
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.accent }}>Switch</Text>
          </View>
        </Pressable>

        <Search value={q} onChange={setQ} placeholder="Search the menu" />

        {q.trim() ? (
          hits.length ? (
            <Panel flush>
              {hits.map((h, i) => (
                <ListRow
                  key={h.group.id + h.item.route + h.item.n}
                  icon={h.item.i}
                  title={rowName(h.item, db)}
                  subtitle={rowName(h.group, db)}
                  onPress={() => { setQ(''); go(h.item.route, h.item.params); }}
                  last={i === hits.length - 1}
                />
              ))}
            </Panel>
          ) : (
            <Panel>
              <EmptyState icon="dots" title={'Nothing matches "' + q.trim() + '"'} subtitle="Try the name of the thing itself — an item, a report, a setting." />
            </Panel>
          )
        ) : (
          <>
            {/* three across: a tinted icon over its name */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {tiles.map((g) => (
                <Pressable
                  key={g.id}
                  onPress={() => (g.open ? go(g.open) : go('MenuGroup', { groupId: g.id }))}
                  style={({ pressed }) => ({
                    ...card, width: '31.4%', aspectRatio: 1.08, alignItems: 'center', justifyContent: 'center', gap: 10,
                    backgroundColor: pressed ? colors.sunk : colors.surface,
                  })}
                >
                  <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={g.i} size={21} color={colors.accent} />
                  </View>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>{rowName(g, db)}</Text>
                </Pressable>
              ))}
            </View>

            {manyFirms ? (
              <Panel flush>
                <ListRow icon="swap" tone="warn" title="Work in another business" subtitle="Signs you out first — each book opens with its own PIN" onPress={() => go('Firms')} last />
              </Panel>
            ) : null}

            {developer ? (
              <Pressable
                onPress={() => go('Developer')}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 16, backgroundColor: '#1C1F27' }}
              >
                <View style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.10)', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="shield" size={19} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 15.5, color: '#FFFFFF' }}>Developer console</Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>Owners, licences, server health and backups</Text>
                </View>
                <Icon name="chev" size={16} color="rgba(255,255,255,0.7)" />
              </Pressable>
            ) : null}

            {/* how it looks, where to get help, and the way out */}
            <View style={card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, paddingLeft: 16, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>Appearance</Text>
                <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.sunk, borderRadius: 10, padding: 3 }}>
                  {([['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['auto', 'Auto', 'contrast']] as const).map(([v, l, i]) => {
                    const on = theme === v;
                    return (
                      <Pressable
                        key={v}
                        onPress={() => setSetting({ theme: v })}
                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 7, borderRadius: 8, backgroundColor: on ? colors.surface : 'transparent' }}
                      >
                        <Icon name={i} size={13} color={on ? colors.accent : colors.faint} />
                        <Text style={{ fontFamily: on ? fonts.uiSemi : fonts.ui, fontSize: 12.5, color: on ? colors.accent : colors.soft }}>{l}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <Pressable onPress={() => go('Help')} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: isOwner ? 1 : 0, borderBottomColor: colors.line }}>
                <Icon name="support" size={18} color={colors.soft} />
                <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 15, color: colors.ink }}>Help & Support</Text>
                <Icon name="chev" size={15} color={colors.faint} />
              </Pressable>
              {/* only the owner signs the shop out; staff lock the till instead */}
              {isOwner ? (
                <Pressable onPress={() => setSigningOut(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
                  <Icon name="arrow" size={18} color={colors.danger} />
                  <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 15, color: colors.danger }}>Sign out</Text>
                </Pressable>
              ) : null}
            </View>

            {/* the quiet footer */}
            <View style={{ paddingHorizontal: 4, gap: 6, marginTop: 4 }}>
              <FootRow label="Signed in as" value={account?.email || '—'} />
              <FootRow label="Till" value={db.session.till + (online ? " · online" : " · offline, " + db.queue.length + " waiting")} />
              <FootRow label="Version" value={'Genius POS ' + BUILD} />
              {isOwner && account && !account.localOnly ? (
                <Text onPress={() => setDeleting(true)} style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, textAlign: 'center', marginTop: 18, padding: 6 }}>Delete account</Text>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
      <DeleteAccountSheet
        visible={deleting}
        email={account?.email || ''}
        onClose={() => setDeleting(false)}
        onDelete={async (typed, code) => {
          if (!account?.refresh) return 'Sign in again first.';
          const session = await refreshSession(account.refresh);
          if (!session.ok) return 'Sign in again first.';
          const r = await deleteAccount(session.value.access, typed, code);
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
/**
 * Deleting the account: type its email, then the six-digit code emailed to
 * it. A phone left signed in is not enough on its own to wipe an account.
 */
function DeleteAccountSheet({ visible, email, onClose, onDelete }: {
  visible: boolean; email: string; onClose: () => void;
  /** Resolves to an error to show, or null when done. */
  onDelete: (typed: string, code: string) => Promise<string | null>;
}) {
  const { colors } = useTheme();
  const [typed, setTyped] = React.useState('');
  const [code, setCode] = React.useState('');
  const [sent, setSent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  React.useEffect(() => { if (visible) { setTyped(''); setCode(''); setSent(false); setErr(''); setBusy(false); } }, [visible]);
  const matches = typed.trim().toLowerCase() === email.trim().toLowerCase() && !!email;

  async function sendCode() {
    setBusy(true); setErr('');
    const r = await requestDeleteCode(email);
    setBusy(false);
    if (!r.ok) { setErr(r.error.message); return; }
    setSent(true);
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Delete account?">
      <Text style={{ fontFamily: fonts.ui, fontSize: 14, lineHeight: 20, color: colors.soft, marginBottom: 14 }}>
        This permanently deletes {email || 'this account'}, its businesses and cloud copies, licences and sign-ins from our server.
        It cannot be undone. Books on this phone stay until you remove the app.
      </Text>
      <Field label="Type your email to confirm" value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false} keyboard="email-address" readOnly={sent} />
      {sent ? (
        <>
          <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.soft, marginBottom: 8 }}>
            We emailed a 6-digit code to {email}. <Text onPress={busy ? undefined : sendCode} style={{ color: colors.accent }}>Send it again</Text>
          </Text>
          <Field label="Code from the email" value={code} onChangeText={(v) => setCode(v.replace(/[^0-9]/g, '').slice(0, 6))} numeric maxLength={6} autoFocus />
        </>
      ) : null}
      {err ? <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.danger, marginBottom: 10 }}>{err}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Button label="Cancel" onPress={onClose} disabled={busy} /></View>
        <View style={{ flex: 1 }}>
          {sent ? (
            <Button
              variant="dngr"
              label={busy ? 'Deleting…' : 'Delete'}
              loading={busy}
              disabled={code.length !== 6}
              onPress={async () => {
                setBusy(true); setErr('');
                try { const e = await onDelete(typed.trim(), code); if (e) setErr(e); } finally { setBusy(false); }
              }}
            />
          ) : (
            <Button variant="pri" label="Send code" loading={busy} disabled={!matches} onPress={sendCode} />
          )}
        </View>
      </View>
    </Sheet>
  );
}

function FootRow({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
      <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{label}</Text>
      <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.soft }}>{value}</Text>
    </View>
  );
}
