/**
 * GETTING IN — the first thing the app shows, once.
 *
 * Three screens:
 *
 *   · `AuthGateScreen`   — sign in, or start an account
 *   · `SignInScreen`     — email and password, Google, or a code by email
 *   · `CreateAccountScreen` — names, email, confirmation code, password
 *
 * After this the app never asks again: it asks for the PIN the owner set for
 * each member of staff. The account is the shop's, the PIN is the person's.
 *
 * Where the server is not yet configured, the screens say so plainly and let
 * the shop set itself up on this device alone rather than pretending to sign
 * in. Nothing here invents a code or reports a sign-in that did not happen.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { useTheme, fonts, radius } from '../theme';
import { useToast } from '../components/Toast';
import {
  Button, Field, Panel, SectionLabel, InfoBanner, StickyBar, ProgressBar, DetailRow,
} from '../components/ui';
import { Icon, IconName } from '../components/icons';
import { useAuth } from '../data/AuthContext';
import {
  emailLooksReal, checkPassword, codeLooksReal,
} from '../data/account';
import * as api from '../data/authApi';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

/* ================================================================
   Shared furniture
   ================================================================ */

function Hero({ title, sub }: { title: string; sub: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 9, marginBottom: 20 }}>
      <View style={{
        width: 52, height: 52, borderRadius: 17, backgroundColor: colors.rail,
        alignItems: 'center', justifyContent: 'center', marginBottom: 6,
      }}>
        <Icon name="till" size={26} color="#fff" />
      </View>
      <Text style={{ fontFamily: fonts.uiExtra, fontSize: 26, color: colors.ink, letterSpacing: -0.7 }}>
        {title}
      </Text>
      <Text style={{ fontFamily: fonts.ui, fontSize: 14, lineHeight: 20.5, color: colors.soft }}>
        {sub}
      </Text>
    </View>
  );
}

/** Shown wherever a screen would otherwise promise something the server must do. */
function NoServerNote({ what }: { what: string }) {
  return (
    <InfoBanner
      tone="warn"
      icon="cloud"
      text={'This app is not connected to an account server yet, so ' + what
        + ' Your books will live on this phone until it is connected, and nothing is backed up anywhere else.'}
    />
  );
}

/* ================================================================
   1 — sign in, or start
   ================================================================ */

type GateProps = NativeStackScreenProps<RootStackParamList, 'AuthGate'>;

export function AuthGateScreen({ navigation }: GateProps) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{
        flex: 1, margin: 12, borderRadius: 26, padding: 26,
        justifyContent: 'flex-end', gap: 12, backgroundColor: colors.rail,
      }}>
        <View style={{
          width: 60, height: 60, borderRadius: 19, marginBottom: 'auto',
          backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="till" size={30} color="#fff" />
        </View>
        <Text style={{ color: '#fff', fontFamily: fonts.uiExtra, fontSize: 34, letterSpacing: -0.8 }}>
          Genius POS
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.86)', fontFamily: fonts.ui, fontSize: 14.5, maxWidth: 300, lineHeight: 21 }}>
          Billing, stock and money for your shop. Sign in with the email that owns
          the business, or start a new account.
        </Text>
      </View>

      <View style={{ padding: 16, gap: 10 }}>
        <Button
          label="Create an account"
          variant="pri"
          icon={<Icon name="plus" size={17} color={colors.accentInk} />}
          onPress={() => navigation.navigate('CreateAccount')}
        />
        <Button
          label="I already have one"
          icon={<Icon name="user" size={17} color={colors.ink} />}
          onPress={() => navigation.navigate('SignIn')}
        />
      </View>
    </View>
  );
}

/* ================================================================
   2 — signing in
   ================================================================ */

type SignInProps = NativeStackScreenProps<RootStackParamList, 'SignIn'>;

export function SignInScreen({ navigation }: SignInProps) {
  const { colors } = useTheme();
  const { adopt } = useAuth();
  const { error, success } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  /** Reset-by-code, shown in place of the password once asked for. */
  const [resetting, setResetting] = useState(false);
  const [code, setCode] = useState('');
  const [fresh, setFresh] = useState('');

  const configured = api.serverConfigured();
  const emailOk = emailLooksReal(email);

  async function doSignIn() {
    if (!emailOk) { error('Check the email address.'); return; }
    if (!password) { error('Enter your password.'); return; }
    setBusy(true);
    const r = await api.signIn(email.trim(), password);
    setBusy(false);
    if (!r.ok) { error(r.error.message); return; }
    await adopt({
      email: r.value.email, name: r.value.name, method: 'password',
      verified: true, localOnly: false, id: r.value.accountId, refresh: r.value.refresh,
    });
    success('Signed in as ' + r.value.email);
  }

  async function doGoogle() {
    // The Google flow needs a client id issued against the server's redirect,
    // so it cannot work before the server exists. Said plainly rather than
    // opening a browser that will fail.
    if (!configured) {
      Alert.alert(
        'Not connected yet',
        'Signing in with Google needs the account server, which this copy of the app is not connected to yet.',
      );
      return;
    }
    navigation.navigate('GoogleSignIn');
  }

  async function askCode() {
    if (!emailOk) { error('Enter your email first, and we will send a code to it.'); return; }
    setBusy(true);
    const r = await api.requestResetCode(email.trim());
    setBusy(false);
    if (!r.ok) { error(r.error.message); return; }
    setResetting(true);
    success('A six-digit code is on its way to ' + email.trim());
  }

  async function doReset() {
    if (!codeLooksReal(code)) { error('The code is six digits.'); return; }
    const v = checkPassword(fresh, email);
    if (!v.ok) { error(v.why); return; }
    setBusy(true);
    const r = await api.resetPassword(email.trim(), code.trim(), fresh);
    setBusy(false);
    if (!r.ok) { error(r.error.message); return; }
    await adopt({
      email: r.value.email, name: r.value.name, method: 'otp',
      verified: true, localOnly: false, id: r.value.accountId, refresh: r.value.refresh,
    });
    success('Password changed, and you are signed in');
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 130 }} keyboardShouldPersistTaps="handled">
        <Hero
          title={resetting ? 'Check your email' : 'Welcome back'}
          sub={resetting
            ? 'Enter the six-digit code we sent to ' + email.trim() + ', then choose a new password.'
            : 'Sign in with the email that owns the business.'}
        />

        {!configured ? <><NoServerNote what="it cannot sign you in." /><View style={{ height: 14 }} /></> : null}

        {resetting ? (
          <>
            <Panel>
              <Field icon="lock" label="Six-digit code" value={code} onChangeText={setCode} numeric maxLength={6} placeholder="000000" />
              <Field icon="lock" label="New password" value={fresh} onChangeText={setFresh} secure placeholder="At least 8 characters" />
            </Panel>
            <View style={{ height: 12 }} />
            <Button label="Send the code again" onPress={askCode} />
            <View style={{ height: 8 }} />
            <Button label="Back to password" onPress={() => setResetting(false)} />
          </>
        ) : (
          <>
            <Panel>
              <Field
                icon="user" label="Owner email" value={email} onChangeText={setEmail}
                placeholder="owner@example.com" autoCapitalize="none"
              />
              <Field icon="lock" label="Password" value={password} onChangeText={setPassword} secure placeholder="Your password" />
            </Panel>

            <Pressable onPress={askCode} hitSlop={8} style={{ paddingVertical: 14, alignSelf: 'flex-start' }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.accent }}>
                Forgotten it? Send a code by email
              </Text>
            </Pressable>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 6 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
              <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>or</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
            </View>

            <Button
              label="Continue with Google"
              icon={<Icon name="cloud" size={17} color={colors.ink} />}
              onPress={doGoogle}
            />

            <View style={{ height: 14 }} />
            <Pressable onPress={() => navigation.replace('CreateAccount')} hitSlop={8}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, color: colors.soft, textAlign: 'center' }}>
                No account yet?{' '}
                <Text style={{ fontFamily: fonts.uiBold, color: colors.accent }}>Create one</Text>
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      <StickyBar>
        <Button
          label={resetting ? 'Change password and sign in' : 'Sign in'}
          variant="pri"
          loading={busy}
          onPress={resetting ? doReset : doSignIn}
        />
      </StickyBar>
    </View>
  );
}

/* ================================================================
   3 — creating an account
   ================================================================ */

const STEPS = ['You', 'Email', 'Confirm', 'Password'] as const;

const HEADS: { title: string; sub: string; icon: IconName }[] = [
  { title: 'Who owns the business?', sub: 'Your name goes on the account and on the licence.', icon: 'user' },
  { title: 'Your email address', sub: 'This is how you sign in, recover the books and hold the licence.', icon: 'doc' },
  { title: 'Confirm your email', sub: 'We have sent you a six-digit code.', icon: 'lock' },
  { title: 'Choose a password', sub: 'The one thing standing between someone and your books.', icon: 'lock' },
];

type CreateProps = NativeStackScreenProps<RootStackParamList, 'CreateAccount'>;

export function CreateAccountScreen({ navigation }: CreateProps) {
  const { colors } = useTheme();
  const { adopt } = useAuth();
  const { error, success } = useToast();

  const [at, setAt] = useState(0);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const configured = api.serverConfigured();
  const verdict = useMemo(() => checkPassword(password, email), [password, email]);

  /**
   * Without a server there is nobody to send a code, so that step is skipped
   * rather than faked. The account is marked unverified and local-only, and the
   * app says so instead of implying the address was checked.
   */
  const steps = configured ? STEPS : STEPS.filter((s) => s !== 'Confirm');
  const head = HEADS[STEPS.indexOf(steps[at])];

  async function next() {
    const which = steps[at];

    if (which === 'You') {
      if (name.trim().length < 2) { error('Enter your name.'); return; }
    }

    if (which === 'Email') {
      if (!emailLooksReal(email)) { error('Check the email address.'); return; }
      if (configured && !sent) {
        setBusy(true);
        const r = await api.requestSignUpCode(email.trim(), name.trim());
        setBusy(false);
        if (!r.ok) { error(r.error.message); return; }
        setSent(true);
        success('A six-digit code is on its way to ' + email.trim());
      }
    }

    if (which === 'Confirm') {
      if (!codeLooksReal(code)) { error('The code is six digits.'); return; }
    }

    if (which === 'Password') {
      if (!verdict.ok) { error(verdict.why); return; }
      if (password !== again) { error('The two passwords do not match.'); return; }
      await finish();
      return;
    }

    setAt((i) => i + 1);
  }

  async function finish() {
    if (configured) {
      setBusy(true);
      const r = await api.completeSignUp({
        email: email.trim(), name: name.trim(), phone: phone.trim() || undefined,
        code: code.trim(), password,
      });
      setBusy(false);
      if (!r.ok) { error(r.error.message); return; }
      await adopt({
        email: r.value.email, name: r.value.name, phone: phone.trim(), method: 'password',
        verified: true, localOnly: false, id: r.value.accountId, refresh: r.value.refresh,
      });
    } else {
      // Honest about what this is: an account on this phone and nowhere else.
      await adopt({
        email: email.trim(), name: name.trim(), phone: phone.trim(),
        method: 'password', verified: false, localOnly: true,
      });
    }
    navigation.replace('Onboarding');
  }

  async function resend() {
    setBusy(true);
    const r = await api.requestSignUpCode(email.trim(), name.trim());
    setBusy(false);
    if (!r.ok) { error(r.error.message); return; }
    success('Sent again to ' + email.trim());
  }

  const strengthWord = ['Too short', 'Weak', 'Good', 'Strong'][verdict.strength];
  const strengthTone = [colors.danger, colors.danger, colors.warn, colors.good][verdict.strength];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 130 }} keyboardShouldPersistTaps="handled">
        <ProgressBar pct={((at + 1) / steps.length) * 100} />
        <View style={{ height: 16 }} />
        <Hero title={head.title} sub={head.sub} />

        {steps[at] === 'You' ? (
          <>
            <Panel>
              <Field icon="user" label="Your full name" value={name} onChangeText={setName} placeholder="e.g. Ada Nakato" />
              <Field icon="phone" label="Phone" value={phone} onChangeText={setPhone} placeholder="Optional" />
            </Panel>
            {!configured ? <><View style={{ height: 14 }} /><NoServerNote what="it cannot create your account online yet." /></> : null}
          </>
        ) : null}

        {steps[at] === 'Email' ? (
          <>
            <Panel>
              <Field
                icon="doc" label="Owner email" value={email} onChangeText={(t) => { setEmail(t); setSent(false); }}
                placeholder="owner@example.com" autoCapitalize="none"
              />
            </Panel>
            <View style={{ height: 14 }} />
            <InfoBanner
              tone="neutral"
              icon="bulb"
              text="Use an address you will still have in a few years. It is how you sign in, how a lost phone is recovered, and what your licence is tied to."
            />
          </>
        ) : null}

        {steps[at] === 'Confirm' ? (
          <>
            <Panel>
              <Field icon="lock" label="Six-digit code" value={code} onChangeText={setCode} numeric maxLength={6} placeholder="000000" />
              <DetailRow label="Sent to" value={email.trim()} last />
            </Panel>
            <View style={{ height: 12 }} />
            <Button label="Send it again" onPress={resend} loading={busy} />
          </>
        ) : null}

        {steps[at] === 'Password' ? (
          <>
            <Panel>
              <Field icon="lock" label="Password" value={password} onChangeText={setPassword} secure placeholder="At least 8 characters" />
              <Field icon="lock" label="Type it again" value={again} onChangeText={setAgain} secure placeholder="The same password" />
            </Panel>
            {password ? (
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: strengthTone, marginTop: 10 }}>
                {strengthWord}{verdict.ok ? '' : ' — ' + verdict.why}
              </Text>
            ) : null}
            <View style={{ height: 14 }} />
            <InfoBanner
              tone="neutral"
              icon="bulb"
              text="This password is for the account. Day to day, you and your staff will unlock the app with a four-digit PIN instead."
            />
          </>
        ) : null}
      </ScrollView>

      <StickyBar>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button
              label={at === 0 ? 'Back' : 'Back'}
              onPress={() => (at === 0 ? navigation.goBack() : setAt((i) => i - 1))}
            />
          </View>
          <View style={{ flex: 1.4 }}>
            <Button
              label={steps[at] === 'Password' ? 'Create account' : 'Next'}
              variant="pri"
              loading={busy}
              onPress={next}
            />
          </View>
        </View>
      </StickyBar>
    </View>
  );
}
