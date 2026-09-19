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

  useEffect(() => {
    if (visible) { setStep('send'); setCode(''); setPin(''); setPin2(''); setErr(''); }
  }, [visible]);

  async function send() {
    setBusy(true); setErr('');
    const r = await requestPinCode(email);
    setBusy(false);
    if (!r.ok) return setErr(r.error.message);
    setStep('code');
  }

  async function confirm() {
    setBusy(true); setErr('');
    const r = await confirmPinCode(email, code.trim());
    setBusy(false);
    if (!r.ok) return setErr(r.error.message);
    setStep('pin');
  }

  function save() {
    if (!/^[0-9]{4}$/.test(pin)) return setErr('The PIN is four digits.');
    if (pin !== pin2) return setErr('Those PINs do not match.');
    onDone(pin);
  }

  const note = (t: string) => (
    <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, color: colors.faint, lineHeight: 20, marginBottom: 14 }}>{t}</Text>
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
          <Button variant="pri" label="Confirm the code" loading={busy} disabled={busy || code.trim().length !== 6} onPress={confirm} />
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
              : note('We will send a six-digit code to the owner\'s email. Only the owner can read it, so only the owner can reset this PIN.')}
          {email ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, backgroundColor: colors.sunk }}>
              <Icon name="shield" size={18} color={colors.accent} />
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14.5, color: colors.ink }}>{maskEmail(email)}</Text>
            </View>
          ) : null}
        </>
      ) : step === 'code' ? (
        <>
          {note('Enter the code sent to ' + maskEmail(email) + '. It lasts ten minutes. Check spam if it has not arrived.')}
          <Field label="Six-digit code" value={code} onChangeText={(v) => setCode(v.replace(/[^0-9]/g, ''))} numeric maxLength={6} />
          <Button size="sm" label="Send another code" disabled={busy} onPress={send} />
        </>
      ) : (
        <>
          <Field label="New PIN" value={pin} onChangeText={(v) => setPin(v.replace(/[^0-9]/g, ''))} numeric secure maxLength={4} />
          <Field label="Type it again" value={pin2} onChangeText={(v) => setPin2(v.replace(/[^0-9]/g, ''))} numeric secure maxLength={4} />
        </>
      )}
      {err ? (
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.danger, marginTop: 10 }}>{err}</Text>
      ) : null}
    </Sheet>
  );
}

export default PinResetSheet;
