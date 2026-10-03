/**
 * CONTINUE WITH GOOGLE — the whole exchange happens on our own server.
 *
 * The app never talks to Google directly. It opens one URL on our server, and
 * waits for the browser to come back to us:
 *
 *   app  → https://<server>/v1/auth/google/start?redirect=geniuspos://oauth
 *   srv  → 302 to accounts.google.com with our client id and state
 *   user → consents
 *   goog → 302 back to https://<server>/v1/auth/google/callback?code=…
 *   srv  → exchanges the code using the client secret, makes OUR session
 *   srv  → 302 to geniuspos://oauth?session=…    (the app catches this)
 *
 * Why this way round rather than the usual on-device PKCE dance:
 *
 *  · The client secret never leaves the VPS. An APK can be unzipped by anyone,
 *    so a secret shipped inside one is not a secret.
 *  · Google will not accept a custom scheme such as `geniuspos://` as a
 *    redirect URI on a Web client, and a Web client is what holds a secret.
 *    Registering an https callback we own is the only combination that works.
 *  · One OAuth client covers Android, iOS and web. No package name, no SHA-1
 *    fingerprint, and nothing to re-register when a signing key changes.
 *  · It works in Expo Go. A native redirect does not.
 *
 * The app therefore needs no Google client id of its own, which is why there is
 * no longer one in this file.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Linking, AppState } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { useTheme, fonts } from '../theme';
import { useToast } from '../components/Toast';
import { Button, Panel, InfoBanner, DetailRow, StickyBar } from '../components/ui';
import { Icon } from '../components/icons';
import { useAuth } from '../data/AuthContext';
import { useAfterSignIn } from '../nav/afterSignIn';
import * as api from '../data/authApi';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

WebBrowser.maybeCompleteAuthSession();

/**
 * Where the browser is sent back to once our server has finished.
 *
 * This cannot be a fixed string. Expo Go does not register custom schemes at
 * all, so `geniuspos://` opens nothing there and the browser simply sits on the
 * server's page for ever — which is exactly what it did. `makeRedirectUri`
 * returns whatever the thing actually running can receive: an `exp://…` address
 * under Expo Go, and `geniuspos://oauth` in a development or standalone build.
 */
export function returnUrl(): string {
  return AuthSession.makeRedirectUri({ scheme: 'geniuspos', path: 'oauth' });
}

type Props = NativeStackScreenProps<RootStackParamList, 'GoogleSignIn'>;

export default function GoogleSignInScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { adopt } = useAuth();
  const afterSignIn = useAfterSignIn();
  const { error, success } = useToast();
  const [busy, setBusy] = useState(false);
  const handled = useRef(false);
  // worked out once, and shown on the screen so a mismatch is visible
  const back = useMemo(() => returnUrl(), []);

  const ready = api.serverConfigured();

  /**
   * Reads the deep link our server sends the browser back to.
   *
   * The server puts a one-time ticket in the URL, never a session token: a URL
   * ends up in browser history and in the system log, and a token there would
   * outlive the sign-in. The ticket is exchanged once, over TLS, and dies.
   */
  const handleReturn = useCallback(async (url: string) => {
    if (handled.current) return;
    if (!url.startsWith(back)) return;
    handled.current = true;

    const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
    const params = new URLSearchParams(query);

    const denied = params.get('error');
    if (denied) {
      setBusy(false);
      handled.current = false;
      error(denied === 'access_denied'
        ? 'Google sign-in was cancelled.'
        : 'Google sign-in did not finish. Try again, or use your email and password.');
      return;
    }

    const ticket = params.get('ticket');
    if (!ticket) {
      setBusy(false);
      handled.current = false;
      error('The sign-in came back without a ticket. Try again.');
      return;
    }

    const r = await api.redeemGoogleTicket(ticket);
    setBusy(false);
    if (!r.ok) { handled.current = false; error(r.error.message); return; }

    const email = String(r.value.email || '').trim().toLowerCase();
    if (!email) { handled.current = false; error('Google sign-in returned no email address. Try again.'); return; }
    await adopt({
      email, name: String(r.value.name || email.split('@')[0]), method: 'google',
      verified: true, localOnly: false, id: r.value.accountId, refresh: r.value.refresh,
    });
    // Claims the books and goes where this person belongs. Without this the
    // sign-in succeeded — ticket redeemed, session issued — and the screen
    // simply stayed on 'Continue with Google', which looks like a failure.
    const { replacedBooks } = afterSignIn(email);
    success(replacedBooks
      ? 'Signed in as ' + email + ' — starting fresh books for this account'
      : 'Signed in as ' + email);
  }, [adopt, error, success, back, afterSignIn]);

  useEffect(() => {
    const sub = Linking.addEventListener('url', (e) => { void handleReturn(e.url); });
    // the app may have been cold-started by the redirect itself
    Linking.getInitialURL().then((url) => { if (url) void handleReturn(url); });
    return () => sub.remove();
  }, [handleReturn]);

  /**
   * If the person backs out of the browser without finishing, nothing ever
   * comes back — so the spinner is cleared when the app is looked at again.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !handled.current) setBusy(false);
    });
    return () => sub.remove();
  }, []);

  async function go() {
    if (!ready) return;
    handled.current = false;
    setBusy(true);
    try {
      const result = await WebBrowser.openAuthSessionAsync(api.googleStartUrl(back), back);
      // On iOS the session returns the URL directly; on Android the deep-link
      // listener above usually fires first. Both paths are guarded by `handled`.
      if (result.type === 'success' && result.url) {
        await handleReturn(result.url);
      } else if (result.type === 'cancel' || result.type === 'dismiss') {
        setBusy(false);
      }
    } catch (e: any) {
      setBusy(false);
      error(e?.message || 'The browser could not be opened.');
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
        <View style={{
          width: 52, height: 52, borderRadius: 17, backgroundColor: colors.rail,
          alignItems: 'center', justifyContent: 'center', marginBottom: 16,
        }}>
          <Icon name="cloud" size={26} color="#fff" />
        </View>
        <Text style={{ fontFamily: fonts.uiExtra, fontSize: 24, color: colors.ink, letterSpacing: -0.6 }}>
          Continue with Google
        </Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 15, lineHeight: 20.5, color: colors.soft, marginTop: 8 }}>
          Google will ask which account to use. We only receive your name and email address.
        </Text>

        <View style={{ height: 18 }} />

        {ready ? (
          <InfoBanner
            tone="neutral"
            icon="shield"
            text="The sign-in finishes on your own server, so no Google secret is ever stored in this app."
          />
        ) : (
          <>
            <InfoBanner
              tone="warn"
              icon="cloud"
              text="Google sign-in is not available yet. It runs through your own server, which this copy of the app is not connected to. Use an email and password for now."
            />
            <View style={{ height: 14 }} />
            <Panel>
              <DetailRow label="Server" value="Not set" />
              <DetailRow label="Returns to" value={back} last />
            </Panel>
          </>
        )}
      </ScrollView>

      <StickyBar>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label="Back" onPress={() => navigation.goBack()} />
          </View>
          <View style={{ flex: 1.4 }}>
            <Button
              label={ready ? 'Continue with Google' : 'Not available yet'}
              variant="pri"
              disabled={!ready}
              loading={busy}
              onPress={go}
            />
          </View>
        </View>
      </StickyBar>
    </View>
  );
}
