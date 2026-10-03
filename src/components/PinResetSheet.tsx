/**
 * FORGOT THE OWNER PIN.
 *
 * The PIN lives on this phone, so an owner who forgot it was locked out of
 * their own shop with nobody to ask — staff cannot reset the owner. The way
 * back is the one thing only the owner has: the account's email. A six-digit
 * code goes to that address (never one typed here, so staff cannot send it to
 * themselves), and once it is confirmed the owner chooses a new PIN.
 */
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Sheet } from './Sheet';
import { Field } from './form';
import { Button } from './ui';
import { Icon } from './icons';
import { useTheme, fonts } from '../theme';
import { requestPinCode, confirmPinCode, serverConfigured } from '../data/authApi';
import { CodeInput, CodeSentNote, CodeState, useCooldown } from './CodeInput';

type Step = 'send' | 'code' | 'pin';

/** a•••@gmail.com — enough to recognise, not enough to read over a shoulder. */
export function maskEmail(e: string): string {
  const [user, host] = e.split('@');
  if (!host) return e;
  return (user.slice(0, 2) || user) + '•••@' + host;
}

export function PinResetSheet({ visible, email, onClose, onDone }: {
  visible: boolean;
  /** The owner's account email. Nothing else is ever offered. */
  email: string;
  onClose: () => void;
  /** Called with the new PIN once the code has been confirmed. */
  onDone: (pin: string) => void;
}) {
  const { colors } = useTheme();
  const [step, setStep] = useState<Step>('send');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [codeState, setCodeState] = useState<CodeState>('idle');
  const [codeMsg, setCodeMsg] = useState('');
  const cooldown = useCooldown();

  useEffect(() => {
    if (visible) { setStep('send'); setCode(''); setPin(''); setPin2(''); setErr(''); setCodeState('idle'); }
  }, [visible]);

  async function send() {
    if (cooldown.left > 0) return;
    setBusy(true); setErr('');
    const r = await requestPinCode(email);
    setBusy(false);
    if (!r.ok) return setErr(r.error.message);
    setCode(''); setCodeState('idle'); setCodeMsg('');
    cooldown.restart();
    setStep('code');
  }

  /** Checked as soon as all six digits are in; right goes straight to the new PIN. */
  async function confirm(c = code.trim()) {
    setCodeState('checking'); setCodeMsg(''); setErr('');
    const r = await confirmPinCode(email, c);
    if (!r.ok) { setCodeState('bad'); setCodeMsg(r.error.message); return; }
    setCodeState('ok');
    setTimeout(() => setStep('pin'), 650);
  }

  function save() {
    if (!/^[0-9]{4}$/.test(pin)) return setErr('The PIN is four digits.');
    if (pin !== pin2) return setErr('Those PINs do not match.');
    onDone(pin);
  }

  const note = (t: string) => (
    <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, lineHeight: 20, marginBottom: 14 }}>{t}</Text>
  );

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      icon="lock"
      title={step === 'pin' ? 'Choose a new PIN' : 'Reset the owner PIN'}
      subtitle={step === 'pin' ? 'Four digits you will remember' : 'A code goes to the owner\'s email'}
      footer={
        step === 'send' ? (
          <Button variant="pri" label="Send the code" loading={busy} disabled={busy || !email || !serverConfigured()} onPress={send} />
        ) : step === 'code' ? (
          <Button variant="pri" label="Confirm the code" loading={codeState === 'checking'} disabled={codeState === 'checking' || codeState === 'ok' || code.trim().length !== 6} onPress={() => confirm()} />
        ) : (
          <Button variant="pri" label="Save the new PIN" disabled={pin.length !== 4 || pin2.length !== 4} onPress={save} />
        )
      }
    >
      {step === 'send' ? (
        <>
          {!email
            ? note('This shop has no owner email on record, so a code cannot be sent. Sign out, sign in with the owner\'s account, and set the PIN again.')
            : !serverConfigured()
              ? note('This copy of the app is not connected to a server, so a code cannot be sent.')
              : note('We will email a six-digit one-time code to the owner. If you are not the owner, ask them to read it to you — a PIN is never reset without them.')}
          {email ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, backgroundColor: colors.sunk }}>
              <Icon name="shield" size={18} color={colors.accent} />
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{maskEmail(email)}</Text>
            </View>
          ) : null}
        </>
      ) : step === 'code' ? (
        <>
          {note('Enter the six-digit one-time code we emailed. It lasts ten minutes.')}
          <CodeInput
            value={code}
            onChange={(v) => { setCode(v); if (codeState === 'bad') setCodeState('idle'); }}
            onComplete={(c) => confirm(c)}
            state={codeState}
            message={codeState === 'ok' ? 'Code confirmed' : codeMsg}
          />
          <CodeSentNote to={maskEmail(email)} left={cooldown.left} busy={busy} onResend={send} />
        </>
      ) : (
        <>
          <Field label="New PIN" value={pin} onChangeText={(v) => setPin(v.replace(/[^0-9]/g, ''))} numeric secure maxLength={4} />
          <Field label="Type it again" value={pin2} onChangeText={(v) => setPin2(v.replace(/[^0-9]/g, ''))} numeric secure maxLength={4} />
        </>
      )}
      {err ? (
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.danger, marginTop: 10 }}>{err}</Text>
      ) : null}
    </Sheet>
  );
}

export default PinResetSheet;
