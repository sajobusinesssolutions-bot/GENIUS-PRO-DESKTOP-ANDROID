/**
 * The app update, asked rather than announced: a pop-up says a new version is
 * out, with what it fixes under "More", and Wait or Update. Update downloads
 * it in the background (a small bar at the foot shows how far it is) and,
 * once it is in, asks to install. Wait puts it off for a day.
 */
import React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, fonts } from '../theme';
import { Icon } from './icons';
import { useAuth } from '../data/AuthContext';
import { useAppUpdate } from '../data/appUpdate';

const WAIT_KEY = 'update.waitUntil';
const WAIT_MS = 24 * 60 * 60 * 1000;

export default function UpdatePrompt() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { account } = useAuth();
  const { state, download, install, manual } = useAppUpdate(account?.localOnly ? undefined : account?.refresh);
  const [waitUntil, setWaitUntil] = React.useState<Record<string, number> | null>(null);
  const [more, setMore] = React.useState(false);
  const [laterReady, setLaterReady] = React.useState(false);

  React.useEffect(() => {
    AsyncStorage.getItem(WAIT_KEY).then((v) => setWaitUntil(JSON.parse(v || '{}') || {})).catch(() => setWaitUntil({}));
  }, []);

  if (state.stage === 'none' || !waitUntil) return null;
  const info = state.info;
  const code = String(info.versionCode);
  // asked for from Settings: shown even if Wait had put it off
  const waiting = !manual && (waitUntil[code] || 0) > Date.now();
  const mb = info.size ? Math.round(info.size / 1e6) + ' MB' : '';
  const notes = String(info.notes || '').split(/\n|•|;\s+/).map((x) => x.replace(/^[-*\s]+/, '').trim()).filter(Boolean);

  const wait = () => {
    const next = { ...waitUntil, [code]: Date.now() + WAIT_MS };
    setWaitUntil(next);
    AsyncStorage.setItem(WAIT_KEY, JSON.stringify(next)).catch(() => {});
  };

  const ask = state.stage === 'available' && !waiting;
  const askInstall = state.stage === 'ready' && !laterReady;

  const btn = (label: string, onPress: () => void, primary?: boolean) => (
    <Pressable onPress={onPress} style={({ pressed }) => ({
      flex: 1, height: 46, borderRadius: 4, alignItems: 'center', justifyContent: 'center',
      backgroundColor: primary ? colors.accent : pressed ? colors.sunk : colors.surface,
      borderWidth: primary ? 0 : 1, borderColor: colors.lineHard, opacity: pressed && primary ? 0.88 : 1,
    })}>
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14.5, color: primary ? '#fff' : colors.ink }}>{label}</Text>
    </Pressable>
  );

  return (
    <>
      <Modal visible={ask || askInstall} transparent animationType="fade" onRequestClose={() => (askInstall ? setLaterReady(true) : wait())}>
        <View style={{ flex: 1, backgroundColor: 'rgba(10,16,28,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ width: '100%', maxWidth: 380, borderRadius: 8, backgroundColor: colors.surface, padding: 20 }}>
            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}>
              <Icon name="down" size={24} color={colors.accent} />
            </View>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 18, color: colors.ink, textAlign: 'center', marginTop: 12 }}>
              {askInstall ? 'Update ready to install' : 'New update available'}
            </Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, textAlign: 'center', marginTop: 4 }}>
              Genius POS {info.versionName}{mb && !askInstall ? ' · ' + mb : ''}
            </Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, lineHeight: 19, color: colors.soft, textAlign: 'center', marginTop: 10 }}>
              {askInstall
                ? 'It has downloaded. Installing takes a minute; your books stay as they are.'
                : 'Update now and it downloads in the background while you keep working. You will be asked to install it when it is in.'}
            </Text>

            {notes.length ? (
              <View style={{ marginTop: 12 }}>
                <Pressable onPress={() => setMore((m) => !m)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.accent }}>{more ? 'Less' : 'More — what is fixed'}</Text>
                  <Icon name={more ? 'up' : 'down'} size={13} color={colors.accent} />
                </Pressable>
                {more ? (
                  <ScrollView style={{ maxHeight: 200, marginTop: 10, borderRadius: 4, backgroundColor: colors.sunk }} contentContainerStyle={{ padding: 12, gap: 7 }}>
                    {notes.map((n, i) => (
                      <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
                        <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: colors.accent, marginTop: 7 }} />
                        <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: colors.ink }}>{n}</Text>
                      </View>
                    ))}
                  </ScrollView>
                ) : null}
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
              {askInstall
                ? <>{btn('Later', () => setLaterReady(true))}{btn('Install', () => { setLaterReady(true); install(); }, true)}</>
                : <>{btn('Wait', wait)}{btn('Update', () => download(info), true)}</>}
            </View>
          </View>
        </View>
      </Modal>

      {/* the download, out of the way at the foot of the screen */}
      {state.stage === 'downloading' || state.stage === 'failed' || (state.stage === 'ready' && laterReady) ? (
        <Pressable
          onPress={state.stage === 'failed' ? () => download(info) : state.stage === 'ready' ? install : undefined}
          disabled={state.stage === 'downloading'}
          style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 72, borderRadius: 6, backgroundColor: colors.ink, paddingVertical: 10, paddingHorizontal: 14, elevation: 6 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="down" size={16} color="#fff" />
            <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 13, color: '#fff' }}>
              {state.stage === 'downloading' ? 'Downloading update… ' + Math.round(state.progress * 100) + '%'
                : state.stage === 'failed' ? 'Update did not finish — tap to try again'
                : 'Update ready — tap to install'}
            </Text>
          </View>
          {state.stage === 'downloading' ? (
            <View style={{ height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', marginTop: 8, overflow: 'hidden' }}>
              <View style={{ width: `${Math.round(state.progress * 100)}%` as `${number}%`, height: 3, backgroundColor: colors.accent }} />
            </View>
          ) : null}
        </Pressable>
      ) : null}
    </>
  );
}
