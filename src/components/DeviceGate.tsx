/**
 * THIS DEVICE'S PLACE ON THE ACCOUNT.
 *
 * Signing in is the only way a device is linked. Right after a sign-in this
 * claims the device's seat, tied to that sign-in's session:
 *
 *  · When the plan's devices are all in use, a popup lists them and asks for
 *    one to be removed before this one can be used. Nothing is removed
 *    behind anyone's back.
 *  · When this device is removed from Linked devices on another phone, its
 *    session ends. This notices within half a minute (and whenever the app
 *    comes back to the front), and the app is locked behind a notice until
 *    someone signs in again. The books on the phone are left alone.
 *
 * A dropped connection never locks anyone out: only an explicit answer from
 * the server ("removed", "too many", "sign in again") does.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, View, Text, ScrollView, Alert, AppState, ActivityIndicator, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable } from './Press';
import { Button } from './ui';
import { Icon } from './icons';
import { useTheme, fonts } from '../theme';
import { useAuth } from '../data/AuthContext';
import { useAppData } from '../data/AppDataContext';
import { refreshSession, registerDevice, deviceStatus, revokeDevice, listDevices, LinkedDevice, AuthError } from '../data/authApi';
import { deviceTillName } from '../data/deviceName';
import { navRef } from '../nav/RootNavigator';

/** How often a linked device checks it is still linked. */
const CHECK_EVERY_MS = 30 * 1000;

type Gate =
  | { kind: 'ok' }
  | { kind: 'full'; devices: LinkedDevice[]; seats?: number; message: string }
  | { kind: 'removed'; message: string };

/** The answers that mean "this device may not carry on without signing in". */
const SIGNED_OUT = new Set(['deviceRemoved', 'badCredentials']);

export default function DeviceGate() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { account, patch, signOut } = useAuth();
  const { db, setSync } = useAppData();
  const [gate, setGate] = useState<Gate>({ kind: 'ok' });
  const [busy, setBusy] = useState<string | null>(null);
  const running = useRef(false);

  const online = !!account && !account.localOnly && !!account.refresh && db?.session.online !== false;

  /** A fresh access token, or the reason there is none. */
  const access = useCallback(async (): Promise<{ token?: string; error?: AuthError }> => {
    if (!account?.refresh) return {};
    const r = await refreshSession(account.refresh);
    return r.ok ? { token: r.value.access } : { error: r.error };
  }, [account?.refresh]);

  const signedOut = (e: AuthError) => {
    setGate({
      kind: 'removed',
      message: e.failure === 'deviceRemoved'
        ? 'This device was removed from your linked devices. Sign in to keep using the app.'
        : 'You were signed out of your account on this device. Sign in to keep using the app.',
    });
  };

  /** Claims this device's seat; on a full plan, asks which device to remove. */
  const link = useCallback(async () => {
    if (running.current || !online) return;
    running.current = true;
    try {
      const a = await access();
      if (a.error) { if (SIGNED_OUT.has(a.error.failure)) signedOut(a.error); return; }
      if (!a.token) return;
      const r = await registerDevice(a.token, {
        name: db?.session.till || deviceTillName() || 'This phone',
        kind: 'phone',
        platform: Platform.OS,
      });
      if (r.ok) {
        await patch({ deviceId: r.value.deviceId });
        setSync({ deviceId: r.value.deviceId });
        setGate({ kind: 'ok' });
        return;
      }
      if (r.error.failure === 'tooManyDevices') {
        setGate({ kind: 'full', devices: r.error.detail?.devices || [], seats: r.error.detail?.seats, message: r.error.message });
      } else if (SIGNED_OUT.has(r.error.failure)) {
        signedOut(r.error);
      }
      // offline or the server having a moment: tried again on the next check
    } finally {
      running.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, access, db?.session.till, patch, setSync]);

  /** Is this device still linked? A removed one locks the app behind a sign-in. */
  const check = useCallback(async () => {
    if (running.current || !online || !account?.deviceId) return;
    running.current = true;
    try {
      const a = await access();
      if (a.error) { if (SIGNED_OUT.has(a.error.failure)) signedOut(a.error); return; }
      if (!a.token) return;
      const r = await deviceStatus(a.token);
      if (r.ok) {
        if (!r.value.linked) signedOut({ failure: 'deviceRemoved', message: '' });
        return;
      }
      if (SIGNED_OUT.has(r.error.failure)) { signedOut(r.error); return; }
      // A server without the "still linked?" check: look for this device in
      // the account's list instead. Gone from the list means it was removed.
      if (r.error.failure === 'server') {
        const list = await listDevices(a.token);
        if (list.ok && !list.value.devices.some((d) => d.id === account.deviceId)) {
          signedOut({ failure: 'deviceRemoved', message: '' });
        }
      }
    } finally {
      running.current = false;
    }
  }, [online, account?.deviceId, access]);

  const tick = useRef<() => void>(() => {});
  tick.current = () => {
    if (gate.kind === 'removed') return;
    if (account?.deviceId) void check(); else void link();
  };

  // straight after a sign-in, then every half minute and whenever the app returns to the front
  useEffect(() => {
    if (!online) return;
    tick.current();
    const t = setInterval(() => tick.current(), CHECK_EVERY_MS);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') tick.current(); });
    return () => { clearInterval(t); sub.remove(); };
  }, [online, account?.deviceId]);

  // a new sign-in clears whatever the last one was told
  useEffect(() => { setGate({ kind: 'ok' }); }, [account?.refresh]);

  function remove(d: LinkedDevice) {
    Alert.alert('Remove ' + (d.name || 'this device') + '?', 'It is signed out and has to sign in again to be used. Its books stay on it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          setBusy(d.id);
          const a = await access();
          const r = a.token ? await revokeDevice(a.token, d.id) : null;
          setBusy(null);
          if (!r || !r.ok) { Alert.alert('Not removed', r?.error.message || a.error?.message || 'Try again.'); return; }
          setGate({ kind: 'ok' });
          void link();
        },
      },
    ]);
  }

  async function goSignIn() {
    setGate({ kind: 'ok' });
    await signOut();
    if (navRef.isReady()) navRef.reset({ index: 0, routes: [{ name: 'AuthGate' }] });
  }

  if (gate.kind === 'ok') return null;

  const removed = gate.kind === 'removed';
  return (
    // cannot be dismissed: the only ways on are removing a device or signing in
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={{ flex: 1, backgroundColor: 'rgba(10,12,18,0.6)', justifyContent: 'center', padding: 20, paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 20, maxHeight: '100%' }}>
          <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: removed ? colors.dangerSoft : colors.warnSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <Icon name={removed ? 'lock' : 'phone'} size={24} color={removed ? colors.danger : colors.warn} />
          </View>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }}>
            {removed ? 'Sign in to continue' : 'Too many devices'}
          </Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 14.5, lineHeight: 20, color: colors.soft, marginTop: 8 }}>
            {gate.message}
          </Text>

          {gate.kind === 'full' ? (
            <>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginTop: 16, marginBottom: 6 }}>
                LINKED DEVICES{gate.seats ? ' · ' + gate.devices.length + ' OF ' + gate.seats : ''}
              </Text>
              <ScrollView style={{ maxHeight: 320 }}>
                {gate.devices.map((d, i) => (
                  <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: i === gate.devices.length - 1 ? 0 : 1, borderBottomColor: colors.line }}>
                    <Icon name="phone" size={18} color={colors.faint} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{d.name || 'Device'}</Text>
                      <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
                        Last seen {d.last_seen ? new Date(d.last_seen).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'never'}
                      </Text>
                    </View>
                    {busy === d.id ? <ActivityIndicator color={colors.danger} /> : (
                      <Pressable
                        onPress={() => remove(d)}
                        accessibilityLabel={'Remove ' + (d.name || 'device')}
                        style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.dangerSoft }}
                      >
                        <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: colors.danger }}>Remove</Text>
                      </Pressable>
                    )}
                  </View>
                ))}
              </ScrollView>
              <View style={{ height: 14 }} />
              <Button label="Sign out instead" onPress={goSignIn} />
            </>
          ) : (
            <View style={{ marginTop: 18 }}>
              <Button label="Sign in" variant="pri" onPress={goSignIn} />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
