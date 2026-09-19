/**
 * Users and roles.
 *
 * Reference: SCREENS.roles (line 7613) — the Profiles / Roles & permissions
 * chips, the profile rows with their "you" and "on shift" pills and 30-day
 * takings, and the `.rolecard` with its `.rolebar` progress and
 * "n of N permissions · n profiles" footer — and SCREENS.roleEdit (7677), the
 * grouped `.permgroup` editor: a `.permhead` that toggles the whole group and
 * a `.permacts` two-column grid of `.permrow` checkboxes, driven by the
 * per-action PERM_MATRIX at 7543. SHEETS.user (7768) is the profile sheet.
 *
 * Beyond the reference the screen also lets you duplicate a role, shows who is
 * sitting on each role, and refuses any change that would leave nobody able to
 * manage staff and settings.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import {
  Card, Cap, Button, Pill, Avatar, EmptyState, ChipStrip, Grid,
  Field, SelectField, FieldNote, Checkbox, ProgressBar, ActionChip,
  Panel, Badge, TopTabs, StatGrid, SectionLabel, InfoBanner, FAB,
} from '../components/ui';
import { Icon } from '../components/icons';
import { Sheet } from '../components/Sheet';
import { Foot } from '../components/AppBar';
import { PERM_MATRIX, allPermKeys, permCount } from '../data/perms';
import { plural, startOfDay, daysAgo } from '../data/helpers';
import type { RoleDef, User } from '../data/types';

type Draft = { id: string | null; name: string; description: string; builtin: boolean; perms: Record<string, boolean> };

export default function UsersRolesScreen() {
  const { colors } = useTheme();
  const ctx = useAppData();
  const {
    db, money, can, roles, role, saveRole, duplicateRole, removeRole,
    updateUser, addUser, canRemoveUser,
  } = ctx;

  const [view, setView] = useState<'people' | 'roles'>('people');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [userSheet, setUserSheet] = useState<null | { id: string | null }>(null);

  if (!db) return null;

  /* Reference the first line of the roles body, 7625. */
  if (!can('profiles.view')) {
    return <EmptyState icon="user" title="Not available" subtitle="Your role does not include staff." />;
  }

  const roleList = roles();
  const total = allPermKeys().length;

  /* ------------------------ the role editor ------------------------ */
  if (draft) {
    return (
      <RoleEditor
        draft={draft}
        onChange={setDraft}
        onCancel={() => setDraft(null)}
        onSave={() => {
          if (!draft.name.trim()) { Alert.alert('Name', 'Give the role a name.'); return; }
          saveRole({ id: draft.id, name: draft.name.trim(), description: draft.description, perms: draft.perms });
          setDraft(null);
          setView('roles');
        }}
        onDelete={() => {
          if (!draft.id) return;
          const on = db.users.filter((u) => u.role === draft.id);
          if (on.length) { Alert.alert('Still in use', plural(on.length, 'profile') + ' still use this role.'); return; }
          Alert.alert('Delete this role', draft.name + ' will be removed.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => { if (removeRole(draft.id as string)) { setDraft(null); setView('roles'); } },
            },
          ]);
        }}
      />
    );
  }

  /* ------------------------ profiles ------------------------ */
  const t0 = startOfDay(daysAgo(29));

  const activeCount = db.users.filter((u) => u.active).length;
  const onShiftCount = db.users.filter((u) => db.shifts.some((s) => s.userId === u.id && !s.closedAt)).length;

  const people = (
    <>
      <StatGrid
        items={[
          { icon: 'user', label: 'Profiles', value: String(db.users.length), tone: 'accent' },
          { icon: 'check', label: 'Active', value: String(activeCount), tone: 'good' },
          { icon: 'till', label: 'On shift now', value: String(onShiftCount), tone: 'warn' },
          { icon: 'shield', label: 'Roles', value: String(roleList.length), tone: 'accent' },
        ]}
      />
      <View style={{ height: 20 }} />
      <SectionLabel>Staff profiles</SectionLabel>
      <Panel flush>
        {db.users.map((u, i) => {
          const ss = db.sales.filter((s) => s.userId === u.id && s.status !== 'void' && new Date(s.ts).getTime() >= t0);
          const v = ss.reduce((a, s) => a + s.total, 0);
          const onShift = db.shifts.some((s) => s.userId === u.id && !s.closedAt);
          const r = role(u.role);
          return (
            <Pressable
              key={u.id}
              onPress={() => setUserSheet({ id: u.id })}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 15,
                minHeight: 66,
                borderBottomWidth: i === db.users.length - 1 ? 0 : 1, borderBottomColor: colors.line,
                opacity: u.active ? 1 : 0.55,
              }}
            >
              <Avatar name={u.name} id={u.id} size={44} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{u.name}</Text>
                  {u.id === db.session.userId ? <Badge label="You" tone="accent" /> : null}
                  {onShift ? <Badge label="On shift" tone="good" /> : null}
                  {!u.active ? <Badge label="Disabled" tone="neutral" /> : null}
                </View>
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                  {r?.name} · {plural(ss.length, 'bill')} in 30 days
                </Text>
              </View>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{money(v)}</Text>
            </Pressable>
          );
        })}
      </Panel>
    </>
  );

  /* ------------------------ roles ------------------------ */
  const rolesView = (
    <>
      <InfoBanner
        tone="accent"
        icon="shield"
        text="A role is a set of switches. Change one and every profile on that role feels it immediately."
      />
      <View style={{ height: 16 }} />
      <SectionLabel>Roles</SectionLabel>

      {roleList.map((r) => {
        const on = permCount(r);
        const staff = db.users.filter((u) => u.role === r.id && u.active);
        return (
          <Card key={r.id} style={{ padding: 14, marginBottom: 10 }}>
            <Pressable onPress={() => setDraft({ id: r.id, name: r.name, description: r.description, builtin: r.builtin, perms: { ...r.perms } })}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 15.5, color: colors.ink }}>{r.name}</Text>
                    {r.builtin ? <Badge label="Built in" tone="neutral" /> : null}
                  </View>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, lineHeight: 16.5, color: colors.faint, marginTop: 3 }}>
                    {r.description || 'No description'}
                  </Text>
                </View>
                <Icon name="chev" size={15} color={colors.faint} />
              </View>

              <View style={{ height: 10 }} />
              <ProgressBar
                pct={on / total * 100}
                tone={on === total ? colors.good : on === 0 ? colors.lineHard : colors.accent}
              />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>{on} of {total} permissions</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>{plural(staff.length, 'profile')}</Text>
              </View>
            </Pressable>

            {/* who is on this role — the reference only counts them */}
            {staff.length ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                {staff.slice(0, 6).map((u) => <Avatar key={u.id} name={u.name} id={u.id} size={24} />)}
                <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>
                  {staff.map((u) => u.name.split(' ')[0]).join(', ')}
                </Text>
              </View>
            ) : (
              <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 10 }}>Nobody is on this role yet.</Text>
            )}

            <View style={{ flexDirection: 'row', gap: 7, marginTop: 11 }}>
              <ActionChip label="Duplicate" onPress={() => {
                const copy = duplicateRole(r.id);
                if (copy) setDraft({ id: copy.id, name: copy.name, description: copy.description, builtin: false, perms: { ...copy.perms } });
              }} />
              <ActionChip label="Edit permissions" onPress={() => setDraft({ id: r.id, name: r.name, description: r.description, builtin: r.builtin, perms: { ...r.perms } })} />
            </View>
          </Card>
        );
      })}


    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopTabs
        value={view}
        onChange={(v) => setView(v as any)}
        options={[
          { v: 'people', l: 'Profiles', i: 'user' },
          { v: 'roles', l: 'Roles', i: 'shield' },
        ]}
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
        {view === 'people' ? people : rolesView}
      </ScrollView>

      {view === 'people' ? (
        <FAB label="Add someone" icon="plus" tone="accent" onPress={() => setUserSheet({ id: null })} />
      ) : (
        <FAB
          label="New role"
          icon="plus"
          tone="accent"
          onPress={() => {
            const perms: Record<string, boolean> = {};
            allPermKeys().forEach((k) => { perms[k] = false; });
            setDraft({ id: null, name: '', description: '', builtin: false, perms });
          }}
        />
      )}

      <UserSheet
        state={userSheet}
        onClose={() => setUserSheet(null)}
        roles={roleList}
        onSave={(id, patch) => {
          if (id) {
            if ((patch.role !== undefined || patch.active !== undefined) && !canRemoveUser(id, patch)) {
              Alert.alert(
                'Someone has to hold the keys',
                'This is the last profile that can manage staff and settings. Give somebody else that role first.',
              );
              return;
            }
            updateUser(id, patch);
          } else {
            addUser({
              name: patch.name || 'New person',
              role: patch.role || 'cashier',
              pin: patch.pin || '0000',
              active: patch.active !== false,
            });
          }
          setUserSheet(null);
        }}
      />
    </View>
  );
}

/* ================= the permission editor — reference SCREENS.roleEdit, 7677 ================= */

function RoleEditor({ draft, onChange, onCancel, onSave, onDelete }: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const { colors } = useTheme();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const total = allPermKeys().length;
  const on = allPermKeys().filter((k) => draft.perms[k]).length;
  const locked = draft.id === 'owner';

  function setPerms(next: Record<string, boolean>) {
    if (locked) { Alert.alert('The owner keeps every permission', 'Create another role if you need a narrower one.'); return; }
    onChange({ ...draft, perms: next });
  }

  function tick(key: string) {
    setPerms({ ...draft.perms, [key]: !draft.perms[key] });
  }

  function setGroup(k: string, value: boolean) {
    const next = { ...draft.perms };
    (PERM_MATRIX.find((g) => g.k === k) || { acts: [] as [string, string][] }).acts.forEach((a) => { next[k + '.' + a[0]] = value; });
    setPerms(next);
  }

  function setAll(value: boolean) {
    const next: Record<string, boolean> = {};
    allPermKeys().forEach((k) => { next[k] = value; });
    setPerms(next);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 26 }} keyboardShouldPersistTaps="handled">
        <Card style={{ padding: 14, marginBottom: 14 }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>
            {draft.id ? 'Edit this role' : 'Define the role'}
          </Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 3, marginBottom: 12 }}>
            Give it a name, then tick what it may do.
          </Text>
          <Field
            label="Role name"
            value={draft.name}
            onChangeText={(v) => onChange({ ...draft, name: v })}
            placeholder="What this role is called"
            readOnly={draft.builtin}
          />
          <Field
            label="Description"
            value={draft.description}
            onChangeText={(v) => onChange({ ...draft, description: v })}
            placeholder="Brief description of what this role is for"
            style={{ marginBottom: 0 }}
          />
        </Card>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 9 }}>
          <Cap>Permissions · {on} of {total}</Cap>
          <View style={{ flexDirection: 'row', gap: 7 }}>
            <ActionChip label="All" onPress={() => setAll(true)} />
            <ActionChip label="None" onPress={() => setAll(false)} />
          </View>
        </View>
        <ProgressBar pct={on / total * 100} tone={on === total ? colors.good : colors.accent} />
        <View style={{ height: 12 }} />

        {locked ? (
          <View style={{
            flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: colors.warnSoft,
            borderRadius: radius.md, padding: 12, marginBottom: 12,
          }}>
            <Icon name="alert" size={15} color={colors.warn} />
            <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 11.5, lineHeight: 16.5, color: colors.warn }}>
              The owner always has everything. These stay on.
            </Text>
          </View>
        ) : null}

        {PERM_MATRIX.map((g) => {
          const gon = g.acts.filter((a) => draft.perms[g.k + '.' + a[0]]).length;
          const shut = !!collapsed[g.k];
          return (
            <Card key={g.k} style={{ marginBottom: 10 }}>
              {/* `.permhead` — tapping the head flips the whole group, reference 7703 */}
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 9,
                paddingVertical: 11, paddingHorizontal: 13,
                borderBottomWidth: shut ? 0 : 1, borderBottomColor: colors.line,
                backgroundColor: colors.sunk,
              }}>
                <Pressable hitSlop={6} onPress={() => setCollapsed({ ...collapsed, [g.k]: !shut })}>
                  <Icon name={shut ? 'chev' : 'down'} size={15} color={colors.faint} />
                </Pressable>
                <Icon name={g.i} size={15} color={colors.rail} />
                <Pressable style={{ flex: 1 }} onPress={() => setGroup(g.k, gon !== g.acts.length)}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>{g.n}</Text>
                </Pressable>
                <Pressable onPress={() => setGroup(g.k, gon !== g.acts.length)}>
                  <Pill label={gon + '/' + g.acts.length} tone={gon === g.acts.length ? 'g' : gon ? 'a' : 'default'} />
                </Pressable>
              </View>

              {/* `.permacts` — a two-column grid of `.permrow` checkboxes, reference 7707 */}
              {shut ? null : (
                <View style={{ padding: 10 }}>
                  <Grid cols={2} gap={7}>
                    {g.acts.map((a) => {
                      const key = g.k + '.' + a[0];
                      const yes = !!draft.perms[key];
                      return (
                        <Pressable
                          key={key}
                          onPress={() => tick(key)}
                          style={{
                            flexDirection: 'row', alignItems: 'center', gap: 8,
                            paddingVertical: 9, paddingHorizontal: 10, borderRadius: radius.sm,
                            borderWidth: 1, borderColor: yes ? colors.accent : colors.line,
                            backgroundColor: yes ? colors.accentSoft : colors.surface,
                          }}
                        >
                          <Checkbox on={yes} onPress={() => tick(key)} size={18} />
                          <Text numberOfLines={2} style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 11.5, color: yes ? colors.ink : colors.soft }}>
                            {a[1]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </Grid>
                </View>
              )}
            </Card>
          );
        })}

        {draft.id && !draft.builtin ? (
          <Button variant="dngr" label="Delete this role" onPress={onDelete} />
        ) : null}
      </ScrollView>

      <Foot>
        <View style={{ flexDirection: 'row', gap: 9 }}>
          <View style={{ flex: 1 }}><Button label="Cancel" onPress={onCancel} /></View>
          <View style={{ flex: 1.4 }}>
            <Button
              variant="pri"
              label={draft.id ? 'Save role' : 'Create role'}
              icon={<Icon name="check" size={16} color={colors.accentInk} />}
              onPress={onSave}
            />
          </View>
        </View>
      </Foot>
    </View>
  );
}

/* ================= SHEETS.user — reference line 7768 ================= */

function UserSheet({ state, onClose, roles, onSave }: {
  state: null | { id: string | null };
  onClose: () => void;
  roles: RoleDef[];
  onSave: (id: string | null, patch: Partial<User>) => void;
}) {
  const { colors } = useTheme();
  const { db, user } = useAppData();
  const existing = state?.id ? user(state.id) : undefined;

  const [name, setName] = useState('');
  const [roleId, setRoleId] = useState('cashier');
  const [pin, setPin] = useState('');
  const [active, setActive] = useState(true);
  const [seeded, setSeeded] = useState<string | null>(null);

  // reseed whenever the sheet is opened on a different profile
  const key = state ? String(state.id) : null;
  if (state && seeded !== key) {
    setSeeded(key);
    setName(existing?.name || '');
    setRoleId(existing?.role || 'cashier');
    setPin(existing?.pin || '');
    setActive(existing?.active !== false);
  }
  if (!state) { if (seeded !== null) setSeeded(null); return null; }
  if (!db) return null;

  const bills = existing ? db.sales.filter((s) => s.userId === existing.id && s.status !== 'void').length : 0;

  return (
    <Sheet
      visible
      title={existing ? 'Edit profile' : 'New profile'}
      icon="user"
      onClose={onClose}
      footer={
        <Button
          variant="pri"
          label="Save"
          onPress={() => onSave(state.id, { name: name.trim(), role: roleId, pin, active })}
        />
      }
    >
      {existing ? (
        <Card style={{ padding: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 11 }}>
          <Avatar name={existing.name} id={existing.id} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{existing.name}</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 1 }}>
              {plural(bills, 'bill')} all time
            </Text>
          </View>
        </Card>
      ) : null}

      <Field icon="user" label="Full name" value={name} onChangeText={setName} placeholder="Their name" />
      <SelectField
        icon="shield"
        label="Role"
        value={roleId}
        options={roles.map((r) => ({ v: r.id, l: r.name + ' — ' + permCount(r) + ' permissions' }))}
        onChange={setRoleId}
      />
      <Field icon="lock" label="4-digit PIN" value={pin} onChangeText={setPin} placeholder="0000" numeric secure maxLength={4} />
      <SelectField
        icon="check"
        label="Status"
        value={active ? 'true' : 'false'}
        options={[{ v: 'true', l: 'Active' }, { v: 'false', l: 'Disabled' }]}
        onChange={(v) => setActive(v === 'true')}
      />
      <FieldNote>The PIN is what they type on the lock screen.</FieldNote>
    </Sheet>
  );
}
