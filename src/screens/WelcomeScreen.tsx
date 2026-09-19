import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Button } from '../components/ui';
import { Icon } from '../components/icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Welcome'>;

export default function WelcomeScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db } = useAppData();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{
        flex: 1, margin: 12, borderRadius: 26, padding: 26, justifyContent: 'flex-end', gap: 12,
        backgroundColor: colors.rail, overflow: 'hidden',
      }}>
        <View style={{ width: 60, height: 60, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', alignItems: 'center', justifyContent: 'center', marginBottom: 'auto' }}>
          <Icon name="till" size={30} color="#fff" />
        </View>
        <Text style={{ color: '#fff', fontFamily: fonts.uiExtra, fontSize: 34, letterSpacing: -0.8 }}>Genius POS</Text>
        <Text style={{ color: 'rgba(255,255,255,0.86)', fontFamily: fonts.ui, fontSize: 14.5, maxWidth: 280, lineHeight: 21 }}>
          Billing, stock and money — all in one app for your shop.
        </Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          {[
            { n: db?.products.length ?? 0, l: 'Products' },
            { n: db?.parties.length ?? 0, l: 'Contacts' },
            { n: db?.sales.length ?? 0, l: 'Sales' },
          ].map((s) => (
            <View key={s.l} style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 12 }}>
              <Text style={{ color: '#fff', fontFamily: fonts.uiExtra, fontSize: 20 }}>{s.n}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.76)', fontFamily: fonts.uiSemi, fontSize: 11.5, marginTop: 3 }}>{s.l}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={{ padding: 16, gap: 10 }}>
        <Button
          label="Continue"
          variant="pri"
          icon={<Icon name="arrow" size={17} color={colors.accentInk} />}
          onPress={() => navigation.replace('PinLock', {})}
        />
        <Button label="Set up a new business" onPress={() => navigation.replace('Onboarding')} />
      </View>
    </View>
  );
}
