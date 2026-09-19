import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Avatar, Panel, ListRow, SectionLabel } from '../components/ui';
import { Icon } from '../components/icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PinLock'>;

export default function PinLockScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, login } = useAppData();
  const users = (db?.users || []).filter((u) => u.active);
  const [selected, setSelected] = useState(users[0]?.id || '');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);

  const user = users.find((u) => u.id === selected);

  function press(d: string) {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) {
      const ok = login(selected, next);
      if (ok) {
        navigation.replace('Main');
      } else {
        setErr(true);
        setTimeout(() => { setErr(false); setPin(''); }, 350);
      }
    }
  }

  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16 }}>
        <View style={{ alignItems: 'center', paddingVertical: 26 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="lock" size={32} color={colors.accent} />
          </View>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 22, color: colors.ink, marginTop: 16 }}>Who is signing in?</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, color: colors.faint, marginTop: 6 }}>Pick your profile, then enter its PIN.</Text>
        </View>
        <SectionLabel>Profiles</SectionLabel>
        <Panel flush>
          {(db?.users || []).map((u, i, arr) => (
            <ListRow
              key={u.id}
              icon="user"
              title={u.name}
              subtitle={u.role.charAt(0).toUpperCase() + u.role.slice(1)}
              onPress={() => setSelected(u.id)}
              last={i === arr.length - 1}
            />
          ))}
        </Panel>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ alignItems: 'center', paddingTop: 52 }}>
        <Avatar name={user.name} id={user.id} size={76} />
        <Text style={{ fontFamily: fonts.uiExtra, fontSize: 21, color: colors.ink, marginTop: 16 }}>{user.name}</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, color: colors.faint, marginTop: 5 }}>
          {user.role.charAt(0).toUpperCase() + user.role.slice(1)} · enter your PIN
        </Text>
        <Pressable onPress={() => setSelected('')} hitSlop={8} style={{ marginTop: 10 }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 13.5, color: colors.accent }}>Not you? Switch profile</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, paddingVertical: 30 }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={{
            width: 15, height: 15, borderRadius: 8,
            backgroundColor: err ? colors.danger : i < pin.length ? colors.accent : colors.lineHard,
          }} />
        ))}
      </View>
      {err ? (
        <Text style={{ textAlign: 'center', fontFamily: fonts.uiSemi, fontSize: 13, color: colors.danger, marginTop: -16 }}>
          That PIN is not right.
        </Text>
      ) : null}
      <View style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: 30 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: 28, gap: 12 }}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k, i) => (
            <Pressable
              key={i}
              disabled={!k}
              onPress={() => (k === 'del' ? setPin(pin.slice(0, -1)) : k ? press(k) : undefined)}
              style={({ pressed }) => ({
                width: '30%', height: 66, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
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
      </View>
    </View>
  );
}
