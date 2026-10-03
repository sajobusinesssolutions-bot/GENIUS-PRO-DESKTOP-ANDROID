/**
 * The live tab bar — reference lines 5408-5424 (BAR / TAB_OF).
 * Four tabs for every role, evenly spaced. The quick-add button that sat
 * in the middle of the bar is now a floating button on Home.
 */
import React, { useEffect, useState } from 'react';
import { requestSync } from '../data/SyncKeeper';
import { View, Text, Keyboard } from 'react-native';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, fonts } from '../theme';
import { Icon, IconName } from '../components/icons';
import { Tap } from '../components/Tap';

import DashboardScreen from '../screens/DashboardScreen';
import ItemsScreen from '../screens/ItemsScreen';
import MenuScreen from '../screens/MenuScreen';
import SalesListScreen from '../screens/SalesListScreen';

const Tab = createBottomTabNavigator();

/** reference `var BAR = [...]` line 5409 */
const BAR: { s: string; i: IconName; l: string }[] = [
  { s: 'DashboardTab', i: 'home', l: 'Home' },
  { s: 'SalesTab', i: 'receipt', l: 'Activity' },
  { s: 'ItemsTab', i: 'box', l: 'Items' },
  { s: 'MenuTab', i: 'menu', l: 'Menu' },
];

function TabBar({ state, navigation }: BottomTabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
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
      <Tap
        key={t.s}
        scaleTo={0.9}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={t.l}
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
        <Icon name={t.i} size={22} color={on ? colors.accent : colors.faint} weight={on ? 'fill' : 'regular'} />
        <Text style={{ fontFamily: on ? fonts.uiBold : fonts.uiSemi, fontSize: 12.5, color: on ? colors.accent : colors.faint, marginTop: 4 }}>
          {t.l}
        </Text>
      </Tap>
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
        {BAR.map(btn)}
      </View>
    </>
  );
}


export default function MainTabs() {
  const { colors } = useTheme();
  return (
    <Tab.Navigator
      tabBar={(props) => <TabBar {...props} />}
      screenListeners={{ focus: () => requestSync() }}
      /* A quick cross-fade on the native thread. 'shift' slid a screen that was
         often still being built on first visit, which stuttered. The tabs are
         built once up front and kept current while hidden (not frozen: a frozen
         tab has to catch up on every change the moment it is shown, which is
         exactly the frame the fade needs), so a switch has nothing to render. */
      screenOptions={{
        headerShown: false,
        // solid, so the cross-fade never shows the window behind the tabs
        sceneStyle: { backgroundColor: colors.bg },
        // instant, as on most Android apps: a fade drew the cards' shadows as dark blocks
        animation: 'none',
        lazy: false,
        freezeOnBlur: false,
      }}
    >
      <Tab.Screen name="DashboardTab" component={DashboardScreen} />
      <Tab.Screen name="SalesTab" component={SalesListScreen} />
      <Tab.Screen name="ItemsTab" component={ItemsScreen} />
      <Tab.Screen name="MenuTab" component={MenuScreen} />
    </Tab.Navigator>
  );
}
