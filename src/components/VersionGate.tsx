/**
 * "Update required": shown instead of the app when these books were opened by
 * a newer version than this one. Update opens the Play Store listing; Close
 * leaves the app. Nothing can be recorded meanwhile, and sync is paused.
 */
import React from 'react';
import { View, Text, Linking, BackHandler, Platform } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppDataSafe } from '../data/AppDataContext';
import { APP_VERSION, needsNewerApp } from '../data/appVersion';
import { Button } from './ui';
import { Icon } from './icons';

const PACKAGE = 'tech.saljoetech.geniuspro';

export default function VersionGate({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const db = useAppDataSafe()?.db;
  if (!needsNewerApp(db)) return <>{children}</>;

  async function update() {
    const market = 'market://details?id=' + PACKAGE;
    const web = 'https://play.google.com/store/apps/details?id=' + PACKAGE;
    try { await Linking.openURL(Platform.OS === 'android' ? market : web); } catch { await Linking.openURL(web).catch(() => {}); }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: 'center' }}>
      <View style={{ alignItems: 'center' }}>
        <View style={{ width: 72, height: 72, borderRadius: 24, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="cloud" size={32} color={colors.accent} />
        </View>
        <Text style={{ fontFamily: fonts.uiExtra, fontSize: 22, color: colors.ink, marginTop: 18, textAlign: 'center' }}>Update required</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 15, lineHeight: 21, color: colors.soft, marginTop: 10, textAlign: 'center' }}>
          {db?.firm.name || 'These books'} {db?.firm.name ? 'was' : 'were'} last opened with Genius Pro {db?.firm.minAppVersion}. This phone has {APP_VERSION}.
          Update to the latest version to continue — your books are safe and waiting.
        </Text>
      </View>
      <View style={{ gap: 10, marginTop: 28 }}>
        <Button variant="pri" label="Update now" icon={<Icon name="down" size={17} color={colors.accentInk} />} onPress={() => void update()} />
        <Button label="Close" onPress={() => BackHandler.exitApp()} />
      </View>
    </View>
  );
}
