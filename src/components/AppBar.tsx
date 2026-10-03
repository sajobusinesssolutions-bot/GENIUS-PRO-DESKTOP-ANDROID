/**
 * The one shared header used by every screen.
 * Reference: render() lines 1529-1536, `.statusbar` / `.appbar` / `.iconbtn` / `.foot` CSS
 * (lines 46-50, 88).
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { useTheme, fonts } from '../theme';
import { useAppDataSafe } from '../data/AppDataContext';
import { Icon, IconName } from './icons';
import { Tap } from './Tap';

function pad(n: number) { return n < 10 ? '0' + n : String(n); }

/** The thin strip above the app bar: clock on the left, online/offline pill on the right. */
export function StatusStrip() {
  const { colors } = useTheme();
  const ctx = useAppDataSafe();
  const db = ctx?.db;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20000);
    return () => clearInterval(t);
  }, []);
  const online = db?.session.online !== false;
  const queued = db?.queue.length || 0;
  return (
    <View style={{
      height: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 18, backgroundColor: colors.surface,
    }}>
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint }}>
        {pad(now.getHours())}:{pad(now.getMinutes())}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: online ? colors.good : colors.warn }} />
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint }}>
          {online ? 'online' : 'offline' + (queued ? ' · ' + queued + ' queued' : '')}
        </Text>
      </View>
    </View>
  );
}

export function IconBtn({ name, onPress, color, size = 19, children }: {
  name?: IconName; onPress?: () => void; color?: string; size?: number; children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Tap
      scaleTo={0.84}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        padding: 5, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
        backgroundColor: pressed ? colors.sunk : 'transparent',
      })}
    >
      {children ?? <Icon name={name || 'dots'} size={size} color={color || colors.ink} />}
    </Tap>
  );
}

export type AppBarProps = {
  title: string;
  onBack?: (() => void) | null;
  right?: React.ReactNode;
  /** Off by default: the phone's own status bar already shows the time, and the
      strip covered its icons. Offline is shown on the dashboard instead. */
  statusStrip?: boolean;
  /**
   * The business itself as the title — its logo (or initials) and name — on
   * the main tabs, so every one of them reads as this shop's app. The title
   * given is then a fallback for books not yet loaded.
   */
  brand?: boolean;
};

export function AppBar({ title, onBack, right, statusStrip = false, brand }: AppBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const firm = useAppDataSafe()?.db?.firm;
  const name = brand && firm?.name ? firm.name : title;
  return (
    <View style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      {statusStrip ? <StatusStrip /> : null}
      <View style={{
        backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.line,
        paddingLeft: 14, paddingRight: 14, paddingTop: 10, paddingBottom: 12,
        flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60,
      }}>
        {onBack ? <IconBtn name="back" size={23} onPress={onBack} /> : null}
        {brand ? (
          firm?.logo ? (
            <Image source={{ uri: firm.logo }} style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.sunk }} />
          ) : (
            <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: fonts.uiExtra, fontSize: 15, color: colors.accentInk }}>
                {(name || '?').split(' ').map((w) => w[0] || '').slice(0, 2).join('').toUpperCase()}
              </Text>
            </View>
          )
        ) : null}
        <Text
          numberOfLines={1}
          style={{ flex: 1, minWidth: 0, fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink, letterSpacing: -0.4 }}
        >
          {name}
        </Text>
        {right}
      </View>
    </View>
  );
}

/** Sticky footer slot below the body — reference `.foot` / `def.foot`. */
export function Foot({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{
      backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line,
      paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11 + insets.bottom,
    }}>
      {children}
    </View>
  );
}

/**
 * Adapter so a React Navigation native-stack screen renders the very same header.
 * Wired once in RootNavigator's screenOptions, so every pushed screen matches.
 */
export function NavHeader({ navigation, options, back, route }: NativeStackHeaderProps) {
  const title = options.title ?? route.name;
  const right = options.headerRight ? options.headerRight({ canGoBack: !!back, tintColor: undefined }) : null;
  return <AppBar title={String(title)} onBack={back ? () => navigation.goBack() : null} right={right} />;
}

export default AppBar;
