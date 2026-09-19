/**
 * The live tab bar — reference lines 5408-5424 (BAR / TAB_OF) and 6203-6220
 * (the centre floating action button). Four tabs for every role, a `.fabslot`
 * between the second and third, and a raised accent `.fab` that opens the
 * `quickAll` sheet.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Keyboard } from 'react-native';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, fonts } from '../theme';
import { Icon, IconName } from '../components/icons';
import { QuickSheet } from '../components/Quick';

import DashboardScreen from '../screens/DashboardScreen';
import ItemsScreen from '../screens/ItemsScreen';
import MenuScreen from '../screens/MenuScreen';
import SalesListScreen from '../screens/SalesListScreen';

const Tab = createBottomTabNavigator();

/** reference `var BAR = [...]` line 5409 */
const BAR: { s: string; i: IconName; l: string }[] = [
  { s: 'DashboardTab', i: 'home', l: 'Dashboard' },
  { s: 'SalesTab', i: 'receipt', l: 'Sales' },
  { s: 'ItemsTab', i: 'box', l: 'Items' },
  { s: 'MenuTab', i: 'dots', l: 'Menu' },
];

function TabBar({ state, navigation }: BottomTabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [quick, setQuick] = useState(false);
  const current = state.routes[state.index].name;

  // The bar steps aside while typing. With the screen now lifted clear of the
  // keyboard, a tab bar riding up with it would take a row of space from the
  // very field being filled in.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => setTyping(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setTyping(false));
    return () => { a.remove(); b.remove(); };
  }, []);

  const btn = (t: typeof BAR[number]) => {
    const on = t.s === current;
    return (
      <Pressable
        key={t.s}
        onPress={() => navigation.navigate(t.s)}
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 8,
          minHeight: 60,
          borderRadius: 14,
          backgroundColor: on ? colors.accentSoft : 'transparent',
          marginHorizontal: 4,
        }}
      >
        <Icon name={t.i} size={20} color={on ? colors.accent : colors.faint} />
        <Text style={{ fontFamily: on ? fonts.uiBold : fonts.uiSemi, fontSize: 10, color: on ? colors.accent : colors.faint, marginTop: 4 }}>
          {t.l}
        </Text>
      </Pressable>
    );
  };

  return (
    <>
      {/* the sheet below must survive typing in its own search box, so only the bar hides */}
      <View style={{
        display: typing ? 'none' : 'flex',
        flexDirection: 'row', backgroundColor: colors.surface,
        borderTopWidth: 1, borderTopColor: colors.line,
        paddingTop: 8, paddingBottom: 10 + insets.bottom, paddingHorizontal: 10,
        alignItems: 'stretch',
        shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: -3 },
        elevation: 4,
      }}>
        {BAR.slice(0, 2).map(btn)}
        <View style={{ width: 70, alignItems: 'center', justifyContent: 'center', marginTop: -18 }}>
          <Pressable
            onPress={() => setQuick(true)}
            style={({ pressed }) => ({
              width: 58, height: 58, borderRadius: 18, backgroundColor: colors.accent,
              alignItems: 'center', justifyContent: 'center',
              transform: [{ scale: pressed ? 0.96 : 1 }],
              shadowColor: colors.accent, shadowOpacity: 0.28, shadowRadius: 16, shadowOffset: { width: 0, height: 7 },
              elevation: 10,
            })}
          >
            <Icon name="plus" size={24} color={colors.accentInk} />
          </Pressable>
        </View>
        {BAR.slice(2).map(btn)}
      </View>
      <QuickSheet visible={quick} onClose={() => setQuick(false)} />
    </>
  );
}

export default function MainTabs() {
  return (
    <Tab.Navigator tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tab.Screen name="DashboardTab" component={DashboardScreen} />
      <Tab.Screen name="SalesTab" component={SalesListScreen} />
      <Tab.Screen name="ItemsTab" component={ItemsScreen} />
      <Tab.Screen name="MenuTab" component={MenuScreen} />
    </Tab.Navigator>
  );
}
