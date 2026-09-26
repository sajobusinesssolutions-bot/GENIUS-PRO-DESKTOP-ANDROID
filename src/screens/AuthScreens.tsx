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
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, Extrapolation, interpolate, interpolateColor, useAnimatedProps, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useTheme, fonts, radius } from '../theme';
import { useToast } from '../components/Toast';
import {
  Button, Field, Panel, SectionLabel, InfoBanner, StickyBar, ProgressBar, DetailRow,
} from '../components/ui';
import { Icon, IconName } from '../components/icons';
import { useAuth } from '../data/AuthContext';
import { useAppData } from '../data/AppDataContext';
import { useAfterSignIn } from '../nav/afterSignIn';
import {
  emailLooksReal, checkPassword, codeLooksReal,
} from '../data/account';
import * as api from '../data/authApi';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

const AnimatedIcon = Animated.createAnimatedComponent(Icon);

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

type LaunchWord = { label: string; icon: IconName };

function CarouselWord({ word, index, progress }: { word: LaunchWord; index: number; progress: { value: number } }) {
  const style = useAnimatedStyle(() => {
    // Keep the phase centred around zero. A centred modulo avoids the old
    // 0 -> 2.9 jump, which skipped the visible fade when a word left centre.
    const phase = ((index - progress.value + 1.5) % 3 + 3) % 3 - 1.5;
    return {
      opacity: interpolate(phase, [-1.5, -1, 0, 1, 1.5], [0, 0.42, 1, 0.42, 0], Extrapolation.CLAMP),
      transform: [
        { translateY: interpolate(phase, [-1.5, -1, 0, 1, 1.5], [-87, -58, 0, 58, 87], Extrapolation.CLAMP) },
        { scale: interpolate(phase, [-1.5, -1, 0, 1, 1.5], [0.72, 0.86, 1.04, 0.86, 0.72], Extrapolation.CLAMP) },
      ],
    };
  });

  const iconStyle = useAnimatedStyle(() => {
    const phase = ((index - progress.value + 1.5) % 3 + 3) % 3 - 1.5;
    return {
      backgroundColor: interpolateColor(phase, [-1, 0, 1], ['rgba(91,145,206,0.18)', '#D7F7FF', 'rgba(91,145,206,0.18)']),
    };
  });

  const iconProps = useAnimatedProps(() => {
    const phase = ((index - progress.value + 1.5) % 3 + 3) % 3 - 1.5;
    return { color: interpolateColor(phase, [-1, 0, 1], ['#6B8FB9', '#176AC9', '#6B8FB9']) };
  });

  const textStyle = useAnimatedStyle(() => {
    const phase = ((index - progress.value + 1.5) % 3 + 3) % 3 - 1.5;
    return { color: interpolateColor(phase, [-1, 0, 1], ['#6485AD', '#123B79', '#6485AD']) };
  });

  return (
    <Animated.View style={[{ position: 'absolute', top: 88, left: 0, flexDirection: 'row', alignItems: 'center', gap: 12 }, style]}>
      <Animated.View style={[{ width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, iconStyle]}>
        <AnimatedIcon name={word.icon} size={20} animatedProps={iconProps} />
      </Animated.View>
      <Animated.Text style={[{ fontFamily: fonts.uiExtra, fontSize: 40, letterSpacing: -1.1, lineHeight: 46 }, textStyle]}>
        {word.label}
      </Animated.Text>
    </Animated.View>
  );
}

export function AuthGateScreen({ navigation }: GateProps) {
  const { colors } = useTheme();
  const words: LaunchWord[] = [
    { label: 'Sell', icon: 'cart' },
    { label: 'Stock', icon: 'box' },
    { label: 'Profit', icon: 'coins' },
  ];
  const progress = useSharedValue(1);

  useEffect(() => {
    progress.value = withRepeat(withTiming(4, { duration: 4800, easing: Easing.inOut(Easing.cubic) }), -1, false);
  }, [progress]);

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <LinearGradient
        colors={['#FFFFFF', '#FAFDFF', '#B9F7FF', '#11C5EB', '#0874E7', '#2E1992']}
        locations={[0, 0.26, 0.48, 0.66, 0.86, 1]}
        style={{ flex: 1 }}
      >
        <View style={{ flex: 1, paddingHorizontal: 26, paddingTop: 78, paddingBottom: 28 }}>
          <View style={{ height: 220, alignItems: 'flex-start', paddingLeft: 6, paddingTop: 12, overflow: 'hidden' }}>
            {words.map((word, index) => <CarouselWord key={word.label} word={word} index={index} progress={progress} />)}
          </View>

          <View style={{ flex: 1, justifyContent: 'flex-end' }}>
            <View style={{ paddingBottom: 12 }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                <Icon name="till" size={20} color="#171A22" />
              </View>
              <Text style={{ color: '#FFFFFF', fontFamily: fonts.uiExtra, fontSize: 38, letterSpacing: -1.2, lineHeight: 43 }}>
                Genius Pro
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.78)', fontFamily: fonts.uiSemi, fontSize: 15, lineHeight: 20, marginTop: 7, maxWidth: 245 }}>
                Your money, upgraded.
              </Text>
            </View>

            <View style={{ gap: 10 }}>
              <Button
                label="Sign in with account"
                variant="default"
                icon={<Icon name="user" size={16} color={colors.ink} />}
                onPress={() => navigation.navigate('SignIn')}
              />
              <Button
                label="Create account"
                variant="pri"
                icon={<Icon name="plus" size={16} color={colors.accentInk} />}
                onPress={() => navigation.navigate('CreateAccount')}
              />
            </View>
          </View>
        </View>
      </LinearGradient>
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
  const afterSignIn = useAfterSignIn();
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
    const { replacedBooks } = afterSignIn(r.value.email);
    success(replacedBooks
      ? 'Signed in as ' + r.value.email + ' — starting fresh books for this account'
      : 'Signed in as ' + r.value.email);
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

    // The code is checked on its own first, so a wrong one is reported as a
    // wrong code rather than as a failed password change.
    setBusy(true);
    const check = await api.verifyCode(email.trim(), code.trim(), 'reset');
    if (!check.ok) { setBusy(false); error(check.error.message); return; }

    const r = await api.resetPassword(email.trim(), code.trim(), fresh);
    setBusy(false);
    if (!r.ok) { error(r.error.message); return; }
    await adopt({
      email: r.value.email, name: r.value.name, method: 'otp',
      verified: true, localOnly: false, id: r.value.accountId, refresh: r.value.refresh,
    });
    afterSignIn(r.value.email);
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
                placeholder="Your email address" autoCapitalize="none"
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
  const { startFreshBook } = useAppData();
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
      // Checked here, not at the end. Discovering a mistyped digit only after
      // choosing a password means being thrown back three screens for something
      // that could have been said immediately.
      setBusy(true);
      const v = await api.verifyCode(email.trim(), code.trim(), 'signup');
      setBusy(false);
      if (!v.ok) { error(v.error.message); return; }
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
    // A new account opens on empty books. The demo shop the app ships with is
    // useful for looking around and wrong for somebody who has just signed up:
    // they would have to find and delete a stranger's stock and five million
    // shillings of opening balances before any figure could be trusted.
    startFreshBook({ ownerName: name.trim(), ownerEmail: email.trim() });
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
              <Field icon="user" label="Your full name" value={name} onChangeText={setName} placeholder="Your full name" />
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
                placeholder="Your email address" autoCapitalize="none"
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
