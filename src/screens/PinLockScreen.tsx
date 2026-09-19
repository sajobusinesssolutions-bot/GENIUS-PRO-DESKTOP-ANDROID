/**
 * WHO IS AT THE TILL.
 *
 * The order is business, then person, then PIN. It used to open straight onto
 * the first profile's keypad, so a cashier had to notice "Not you?" before
 * doing anything, and nothing on the screen said which shop's books these were.
 *
 * Two ways this screen used to leave people stuck:
 *  - A new shop's owner had a PIN of 0000 they never chose. Now a profile with
 *    no PIN is asked to choose one here, twice, before it opens.
 *  - An owner who forgot the PIN had nobody to ask. "Forgot PIN?" emails a
 *    code to the owner's account address (see PinResetSheet). Staff are told to
 *    ask the owner, who resets theirs under Staff & roles.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, Alert, ScrollView } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useAuth } from '../data/AuthContext';
import { Avatar, Panel, ListRow, SectionLabel } from '../components/ui';
import { Icon } from '../components/icons';
import { PinResetSheet } from '../components/PinResetSheet';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PinLock'>;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function PinLockScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, login, updateUser } = useAppData();
  const { account } = useAuth();
  const users = (db?.users || []).filter((u) => u.active);
  // one profile: nothing to choose. Several: ask, rather than assume the first.
  const [selected, setSelected] = useState(users.length === 1 ? users[0].id : '');
  const [pin, setPin] = useState('');
  const [first, setFirst] = useState(''); // when choosing a PIN, the first entry
  const [err, setErr] = useState('');
  const [resetOpen, setResetOpen] = useState(false);

  const user = users.find((u) => u.id === selected);
  const choosing = !!user && !user.pin;
  const ownerEmail = db?.ownerEmail || account?.email || '';

  function fail(msg: string) {
    setErr(msg);
    setTimeout(() => { setErr(''); setPin(''); }, 450);
  }

  function enter(next: string) {
    if (!user) return;
    if (choosing) {
      if (user.role !== 'owner') return;
      if (!first) { setFirst(next); setPin(''); return; }
      if (first !== next) { setFirst(''); return fail('Those did not match. Choose it again.'); }
      updateUser(user.id, { pin: next });
      if (login(user.id, next)) navigation.replace('Main');
      return;
    }
    if (login(user.id, next)) navigation.replace('Main');
    else fail('That PIN is not right.');
  }

  function press(d: string) {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) setTimeout(() => enter(next), 80);
  }

  function forgot() {
    if (!user) return;
    if (user.role === 'owner') { setResetOpen(true); return; }
    Alert.alert(
      'Forgot your PIN?',
      'Ask the owner to set you a new one under Settings, Staff & roles. For the shop\'s safety, staff PINs cannot be reset from this screen.',
    );
  }

  function resetDone(newPin: string) {
    if (!user) return;
    updateUser(user.id, { pin: newPin });
    setResetOpen(false);
    if (login(user.id, newPin)) navigation.replace('Main');
  }

  /* the shop these books belong to, so nobody unlocks the wrong one */
  const shopHead = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="home" size={20} color={colors.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15.5, color: colors.ink }}>{db?.firm.name || 'This shop'}</Text>
        <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
          {account?.email ? account.email : 'On this phone'}
        </Text>
      </View>
      {account ? (
        <Pressable hitSlop={8} onPress={() => navigation.navigate('Businesses' as never)}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: colors.accent }}>Switch</Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (!user) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingTop: 52 }}>
        {shopHead}
        <View style={{ alignItems: 'center', paddingVertical: 26 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="lock" size={32} color={colors.accent} />
          </View>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 22, color: colors.ink, marginTop: 16 }}>Who is at the till?</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, color: colors.faint, marginTop: 6 }}>Pick your profile, then enter its PIN.</Text>
        </View>
        <SectionLabel>Profiles</SectionLabel>
        <Panel flush>
          {users.map((u, i, arr) => (
            <ListRow
              key={u.id}
              icon={u.role === 'owner' ? 'owner' : 'user'}
              title={u.name}
              subtitle={cap(u.role) + (u.pin ? '' : ' · no PIN yet')}
              onPress={() => { setSelected(u.id); setPin(''); setFirst(''); setErr(''); }}
              last={i === arr.length - 1}
            />
          ))}
        </Panel>
      </ScrollView>
    );
  }

  const staffWithoutPin = choosing && user.role !== 'owner';
  const prompt = staffWithoutPin
    ? 'No PIN has been set for this profile. Ask the owner to set one under Staff & roles.'
    : choosing
      ? (first ? 'Type the same PIN again' : 'Choose a four-digit PIN')
      : 'Enter your PIN';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 52 }}>{shopHead}</View>
      <View style={{ alignItems: 'center', paddingTop: 22 }}>
        <Avatar name={user.name} id={user.id} size={70} />
        <Text style={{ fontFamily: fonts.uiExtra, fontSize: 21, color: colors.ink, marginTop: 14 }}>{user.name}</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, color: colors.faint, marginTop: 5, textAlign: 'center', paddingHorizontal: 30 }}>
          {cap(user.role)} · {prompt}
        </Text>
        {users.length > 1 ? (
          <Pressable onPress={() => { setSelected(''); setPin(''); setFirst(''); }} hitSlop={8} style={{ marginTop: 10 }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 13.5, color: colors.accent }}>Not you? Switch profile</Text>
          </Pressable>
        ) : null}
      </View>
      {staffWithoutPin ? null : (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, paddingVertical: 26 }}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={{
                width: 15, height: 15, borderRadius: 8,
                backgroundColor: err ? colors.danger : i < pin.length ? colors.accent : colors.lineHard,
              }} />
            ))}
          </View>
          <Text style={{ textAlign: 'center', fontFamily: fonts.uiSemi, fontSize: 13, color: colors.danger, marginTop: -12, minHeight: 18 }}>
            {err}
          </Text>
          {!choosing ? (
            <Pressable onPress={forgot} hitSlop={8} style={{ alignSelf: 'center', marginTop: 4 }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 13.5, color: colors.accent }}>Forgot PIN?</Text>
            </Pressable>
          ) : null}
        </>
      )}
      <View style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: 30 }}>
        {staffWithoutPin ? null : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: 28, gap: 12 }}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k, i) => (
              <Pressable
                key={i}
                disabled={!k}
                accessibilityLabel={k === 'del' ? 'Delete' : k}
                onPress={() => (k === 'del' ? setPin(pin.slice(0, -1)) : k ? press(k) : undefined)}
                style={({ pressed }) => ({
                  width: '30%', height: 62, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: k && k !== 'del' ? (pressed ? colors.accentSoft : colors.surface) : 'transparent',
                  ...(k && k !== 'del' ? { shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 2 } : null),
                })}
              >
                {k === 'del'
                  ? <Icon name="back" size={24} color={colors.faint} />
                  : <Text style={{ fontFamily: fonts.uiBold, fontSize: 25, color: colors.ink }}>{k}</Text>}
              </Pressable>
            ))}
          </View>
        )}
      </View>
      <PinResetSheet visible={resetOpen} email={ownerEmail} onClose={() => setResetOpen(false)} onDone={resetDone} />
    </View>
  );
}
