/**
 * BuyPlanSheet — buying or renewing a Genius plan by Mobile Money, on the phone.
 *
 * The number to pay from, then "Approve it on your phone", then Paid (with the
 * date the plan now runs to) or why not. The account server
 * (server/src/geniusbuy.js) asks MTN and grants the licence when it is paid;
 * this sheet only asks how it stands, every few seconds for three minutes.
 * Closed while waiting, the payment is still listed on the Licence screen with
 * "Check payment". Opened with `existing`, it checks that one again.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pressable } from './Press';
import { useTheme, fonts } from '../theme';
import { SERVER_URL } from '../data/authApi';

export interface Purchase { id: number; plan: string; term: string; amount: number; phone?: string; status: 'pending' | 'paid' | 'failed'; reason?: string | null; txn?: string | null; expiresAt?: string | null; at?: string }

const ugx = (n: number) => 'UGX ' + Math.round(Number(n) || 0).toLocaleString('en-US');
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const WAIT_MS = 3 * 60 * 1000, EVERY_MS = 4000;
const PHONE_KEY = 'gp.buyPhone';

function nice(r?: string | null): string {
  const s = String(r || '').toUpperCase();
  if (!s) return 'The payment did not go through.';
  if (/REJECT|DECLIN/.test(s)) return 'It was declined on the phone.';
  if (/NOT_ENOUGH|INSUFFICIENT/.test(s)) return 'There was not enough money on Mobile Money.';
  if (/EXPIRED|TIMEOUT/.test(s)) return 'It was not approved in time.';
  if (/NOT_FOUND|INVALID/.test(s)) return 'That number is not on Mobile Money.';
  return 'Mobile Money said: ' + String(r) + '.';
}

export default function BuyPlanSheet({ visible, plan, term, amount, label, edition, existing, getAccess, onClose }: {
  visible: boolean; plan: 'starter' | 'pro'; term: 'month' | 'quarter' | 'year'; amount: number; label: string; edition?: string;
  existing?: Purchase | null; getAccess: () => Promise<string | null>; onClose: (paid: Purchase | null) => void;
}) {
  const { colors } = useTheme();
  const [phone, setPhone] = useState('');
  const [stage, setStage] = useState<'ask' | 'sending' | 'waiting' | 'paid' | 'failed' | 'late'>('ask');
  const [p, setP] = useState<Purchase | null>(null);
  const [msg, setMsg] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const until = useRef(0);
  const alive = useRef(true);

  const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const access = await getAccess();
    if (!access) throw new Error('Sign in to your Genius account first.');
    const res = await fetch(SERVER_URL + path, { method, headers: { authorization: 'Bearer ' + access, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.message || 'The Genius server did not answer.');
    return j as Purchase;
  };
  const stop = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const poll = (id: number, quick?: boolean) => {
    stop();
    timer.current = setTimeout(async () => {
      if (!alive.current) return;
      try {
        const r = await call('GET', '/v1/genius/buy/' + id);
        setP(r);
        if (r.status === 'paid') { setStage('paid'); return; }
        if (r.status === 'failed') { setStage('failed'); setMsg(nice(r.reason)); return; }
      } catch { /* a dropped check: try again */ }
      if (Date.now() > until.current) { setStage('late'); return; }
      poll(id);
    }, quick ? 300 : EVERY_MS);
  };

  useEffect(() => {
    alive.current = true;
    if (!visible) { stop(); return undefined; }
    setMsg('');
    if (existing) { setP(existing); setStage('waiting'); until.current = Date.now() + WAIT_MS; poll(existing.id, true); }
    else { setP(null); setStage('ask'); AsyncStorage.getItem(PHONE_KEY).then((v) => { if (v) setPhone(v); }).catch(() => {}); }
    return () => { alive.current = false; stop(); };
  }, [visible]);   // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (phone.replace(/\D/g, '').length < 9) { setMsg('Type the Mobile Money number to pay from'); return; }
    AsyncStorage.setItem(PHONE_KEY, phone).catch(() => {});
    setStage('sending'); setMsg('');
    try {
      const r = await call('POST', '/v1/genius/buy', { plan, term, phone, edition });
      setP(r); setStage('waiting'); until.current = Date.now() + WAIT_MS; poll(r.id);
    } catch (e) { setStage('ask'); setMsg((e as Error).message); }
  };
  const close = () => { stop(); onClose(stage === 'paid' ? p : null); };

  const btn = (text: string, onPress: () => void, primary?: boolean, disabled?: boolean) => (
    <Pressable onPress={onPress} disabled={disabled} style={{ flex: 1, height: 48, borderRadius: 4, alignItems: 'center', justifyContent: 'center',
      backgroundColor: primary ? colors.accent : 'transparent', borderWidth: primary ? 0 : 1.2, borderColor: colors.line, opacity: disabled ? 0.6 : 1 }}>
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 14.5, color: primary ? '#fff' : colors.ink }}>{text}</Text>
    </Pressable>
  );
  const circle = (bg: string, fg: string, t: string) => (
    <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 10 }}>
      <Text style={{ fontFamily: fonts.uiExtra, fontSize: 26, color: fg }}>{t}</Text>
    </View>
  );
  const shown = p ? p.amount : amount;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 20, paddingBottom: 28 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <View style={{ width: 44, height: 44, borderRadius: 6, backgroundColor: '#FFCC00', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: fonts.uiExtra, fontSize: 12, color: '#000' }}>MoMo</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.uiExtra, fontSize: 17, color: colors.ink }}>{label}</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint }}>{ugx(shown)} · paid by Mobile Money</Text>
            </View>
          </View>

          {stage === 'ask' || stage === 'sending' ? (
            <>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink, marginBottom: 6 }}>Pay from this MTN number</Text>
              <TextInput value={phone} onChangeText={setPhone} placeholder="077… or 078…" placeholderTextColor={colors.faint} keyboardType="phone-pad" autoFocus
                style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 4, paddingHorizontal: 12, height: 50, fontFamily: fonts.uiSemi, fontSize: 17, color: colors.ink }} />
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 8 }}>Your phone will ask you to approve {ugx(amount)} with your Mobile Money PIN.</Text>
              {msg ? <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: '#C62828', marginTop: 10 }}>{msg}</Text> : null}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
                {btn('Cancel', close)}
                {btn(stage === 'sending' ? 'Sending…' : 'Pay ' + ugx(amount), send, true, stage === 'sending')}
              </View>
            </>
          ) : null}

          {stage === 'waiting' ? (
            <View style={{ alignItems: 'center', paddingVertical: 8 }}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink, marginTop: 12, textAlign: 'center' }}>Approve it on your phone</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, marginTop: 6, textAlign: 'center' }}>
                Look for the Mobile Money prompt{p && p.phone ? ' on +' + p.phone : ''} and enter your PIN. This screen moves on by itself.
              </Text>
              <View style={{ flexDirection: 'row', marginTop: 18, alignSelf: 'stretch' }}>{btn('Close', close)}</View>
            </View>
          ) : null}

          {stage === 'paid' && p ? (
            <View>
              {circle('#E7F6EC', '#1B7F3B', '✓')}
              <Text style={{ fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink, textAlign: 'center' }}>Paid — thank you</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 14, color: colors.ink, textAlign: 'center', marginTop: 6 }}>
                {p.plan === 'pro' ? 'Pro' : 'Starter'} is on{p.expiresAt ? ' until ' + day(p.expiresAt) : ''}.
              </Text>
              {p.txn ? <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, textAlign: 'center', marginTop: 4 }}>Mobile Money reference {p.txn}</Text> : null}
              <View style={{ flexDirection: 'row', marginTop: 18 }}>{btn('Done', close, true)}</View>
            </View>
          ) : null}

          {stage === 'failed' ? (
            <View>
              {circle('#FDECEC', '#C62828', '!')}
              <Text style={{ fontFamily: fonts.uiExtra, fontSize: 17, color: colors.ink, textAlign: 'center' }}>Not paid</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, color: colors.ink, textAlign: 'center', marginTop: 6 }}>{msg} Nothing was taken.</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
                {btn('Close', close)}
                {btn('Try again', () => { setStage('ask'); setMsg(''); setP(null); }, true)}
              </View>
            </View>
          ) : null}

          {stage === 'late' ? (
            <View>
              <Text style={{ fontFamily: fonts.uiExtra, fontSize: 16, color: colors.ink, textAlign: 'center' }}>Still waiting for Mobile Money</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, color: colors.ink, textAlign: 'center', marginTop: 6 }}>
                If you approved it, it will show soon. You can close this — the payment is listed on this screen with Check payment.
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
                {btn('Close', close)}
                {btn('Check again', () => { if (p) { setStage('waiting'); until.current = Date.now() + WAIT_MS; poll(p.id, true); } }, true)}
              </View>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
