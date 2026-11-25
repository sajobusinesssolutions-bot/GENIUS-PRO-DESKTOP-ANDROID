/**
 * BuyPlanSheet — buying or renewing a Genius plan by Mobile Money, on the phone.
 *
 * Like a payment page: the MoMo mark and the number to pay from; then waiting
 * for the PIN; then a seal — paid (what it bought and until when), failed
 * (retry, a tip, and help in case money was taken anyway) or pending (check
 * again). Every payment has a transaction ID (GP-000123) from the moment it is
 * sent, shown on every step and written into the help message, so a payment
 * that hangs can be traced. The account server (server/src/geniusbuy.js) asks
 * MTN and grants the licence when it is paid; this sheet only asks how it
 * stands. Opened with `existing`, it checks that one again.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Share, Linking } from 'react-native';
import Svg, { Rect, Path, Circle, Defs, LinearGradient, Stop, ClipPath, G } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pressable } from './Press';
import { useTheme, fonts } from '../theme';
import { SERVER_URL } from '../data/authApi';
import { SUPPORT_WHATSAPP, whatsappUrl } from '../data/support';

export interface Purchase { id: number; txnId?: string; ref?: string | null; plan: string; term: string; amount: number; phone?: string; status: 'pending' | 'paid' | 'failed'; reason?: string | null; txn?: string | null; expiresAt?: string | null; at?: string }

const ugx = (n: number) => 'UGX ' + Math.round(Number(n) || 0).toLocaleString('en-US');
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
export const txnIdOf = (p?: Purchase | null) => (p ? p.txnId || 'GP-' + String(p.id).padStart(6, '0') : '');
const supportShown = '0' + SUPPORT_WHATSAPP.replace(/^256/, '').replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
const WAIT_MS = 3 * 60 * 1000, EVERY_MS = 4000;
const PHONE_KEY = 'gp.buyPhone';

function nice(r?: string | null): string {
  const s = String(r || '').toUpperCase();
  if (!s) return '';
  if (/REJECT|DECLIN/.test(s)) return 'It was declined on the phone.';
  if (/NOT_ENOUGH|INSUFFICIENT/.test(s)) return 'There was not enough money on Mobile Money.';
  if (/EXPIRED|TIMEOUT/.test(s)) return 'It was not approved in time.';
  if (/NOT_FOUND|INVALID/.test(s)) return 'That number is not on Mobile Money.';
  return 'Mobile Money said: ' + String(r) + '.';
}

/** The MoMo mark, drawn so it stays sharp at any size. */
export function MomoLogo({ size = 56 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <ClipPath id="mmTile"><Rect x="4" y="4" width="92" height="92" rx="16" /></ClipPath>
        <LinearGradient id="mmSheen" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#0E6A8F" /><Stop offset="1" stopColor="#004A6B" /></LinearGradient>
      </Defs>
      <G clipPath="url(#mmTile)">
        <Rect x="0" y="0" width="100" height="100" fill="url(#mmSheen)" />
        <Rect x="0" y="80" width="100" height="20" fill="#FFCC00" />
      </G>
      <Path d="M62 14 C71 25 75 41 72 60 L66 58 C68 44 66 29 62 14 Z" fill="#FFCC00" />
      <Path d="M24 64 C29 45 43 28 58 20 C55 33 56 47 60 62 C49 58 36 59 24 64 Z" fill="#FFCC00" />
      <Circle cx="46" cy="47" r="7.5" fill="#004A6B" stroke="#FFCC00" strokeWidth="2.2" />
    </Svg>
  );
}

function sealPath(r = 40, n = 14, depth = 3.2) {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n - Math.PI / 2, rr = i % 2 ? r - depth : r;
    pts.push((50 + rr * Math.cos(a)).toFixed(2) + ',' + (50 + rr * Math.sin(a)).toFixed(2));
  }
  return 'M' + pts.join(' L') + ' Z';
}
const SEAL = sealPath();
/** paid (green tick), failed (red !), pending (amber clock) */
export function Seal({ kind, size = 80 }: { kind: 'paid' | 'failed' | 'pending'; size?: number }) {
  const c = { paid: ['#E7F6EC', '#1B7F3B'], failed: ['#FDECEC', '#C62828'], pending: ['#FFF4DE', '#B45309'] }[kind];
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path d={SEAL} fill={c[0]} stroke={c[1]} strokeOpacity={0.25} strokeWidth={1.5} />
      {kind === 'paid' ? <Path d="M33 51 L45 63 L68 38" fill="none" stroke={c[1]} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" /> : null}
      {kind === 'failed' ? <><Rect x="46" y="27" width="8" height="30" rx="4" fill={c[1]} /><Circle cx="50" cy="69" r="5" fill={c[1]} /></> : null}
      {kind === 'pending' ? <><Circle cx="50" cy="50" r="20" fill="none" stroke={c[1]} strokeWidth={6} /><Path d="M50 38 V51 L58 57" fill="none" stroke={c[1]} strokeWidth={6} strokeLinecap="round" /></> : null}
    </Svg>
  );
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
  const id = txnIdOf(p);

  const big = (text: string, onPress: () => void, bg: string, fg = '#fff', disabled?: boolean) => (
    <Pressable onPress={onPress} disabled={disabled} style={{ height: 52, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, marginTop: 16, opacity: disabled ? 0.6 : 1 }}>
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 16, color: fg }}>{text}</Text>
    </Pressable>
  );
  const link = (text: string, onPress: () => void) => (
    <Pressable onPress={onPress} style={{ alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 16 }}>
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.faint }}>{text}</Text>
    </Pressable>
  );
  const title = (t: string) => <Text style={{ fontFamily: fonts.uiExtra, fontSize: 22, color: colors.ink, textAlign: 'center', marginTop: 10 }}>{t}</Text>;
  const body = (t: React.ReactNode, size = 14.5) => <Text style={{ fontFamily: fonts.ui, fontSize: size, lineHeight: size * 1.45, color: colors.soft, textAlign: 'center', marginTop: 6, paddingHorizontal: 6 }}>{t}</Text>;
  const txnRow = id ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14 }}>
      <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>Transaction ID</Text>
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 13.5, color: colors.ink, letterSpacing: 0.6 }}>{id}</Text>
      <Pressable onPress={() => void Share.share({ message: 'Genius payment ' + id + (p?.txn ? ' · MTN ' + p.txn : '') })}
        style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 }}>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: colors.ink }}>Share</Text>
      </Pressable>
    </View>
  ) : null;
  const help = (about: string) => (
    <Pressable onPress={() => void Linking.openURL(whatsappUrl('Hello SALJOE TECH, I need help with ' + about + '.' + (id ? ' Transaction ID: ' + id + '.' : '')))}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'center', marginTop: 14, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.line, borderRadius: 6 }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#16A34A', alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={18} height={18} viewBox="0 0 24 24"><Path fill="#fff" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" /></Svg>
      </View>
      <View>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>We're happy to help you</Text>
        <Text style={{ fontFamily: fonts.uiExtra, fontSize: 16, color: colors.ink, letterSpacing: 0.4 }}>{supportShown}</Text>
      </View>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', padding: 18, backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 22 }}>
            {stage === 'ask' || stage === 'sending' ? (
              <>
                <View style={{ alignItems: 'center' }}><MomoLogo size={62} /></View>
                {title('Pay ' + ugx(amount))}
                {body(label + ' — paid by Mobile Money. Your phone will ask you to approve it with your PIN.')}
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink, marginTop: 18, marginBottom: 6 }}>Pay from this MTN number</Text>
                <TextInput value={phone} onChangeText={setPhone} placeholder="077… or 078…" placeholderTextColor={colors.faint} keyboardType="phone-pad" autoFocus
                  style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingHorizontal: 12, height: 52, fontFamily: fonts.uiSemi, fontSize: 18, color: colors.ink }} />
                {msg ? <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: '#C62828', marginTop: 10 }}>{msg}</Text> : null}
                {big(stage === 'sending' ? 'Sending to your phone…' : 'Pay ' + ugx(amount), send, '#FFCC00', '#111', stage === 'sending')}
                {link('Cancel', close)}
              </>
            ) : null}

            {stage === 'waiting' ? (
              <View style={{ alignItems: 'stretch' }}>
                <ActivityIndicator size="large" color="#004A6B" style={{ marginTop: 6 }} />
                {title('Approve it on your phone')}
                {body('Look for the Mobile Money prompt' + (p && p.phone ? ' on +' + p.phone : '') + ' and enter your PIN to pay ' + ugx(p ? p.amount : amount) + '. This moves on by itself.')}
                {txnRow}
                {link("Close — I'll check later", close)}
              </View>
            ) : null}

            {stage === 'paid' && p ? (
              <View>
                <View style={{ alignItems: 'center' }}><Seal kind="paid" /></View>
                {title('Payment successful')}
                {body((p.plan === 'pro' ? 'Pro' : 'Starter') + ' is on' + (p.expiresAt ? ' until ' + day(p.expiresAt) : '') + '. Thank you.')}
                <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 6, marginTop: 16 }}>
                  {[['Plan', (p.plan === 'pro' ? 'Pro' : 'Starter') + ' · ' + (p.term === 'month' ? '1 month' : p.term === 'quarter' ? '3 months' : '1 year')], ['Amount', ugx(p.amount)], ['Paid from', p.phone ? '+' + p.phone : '—'], ['Mobile Money reference', p.txn || '—']].map(([k, v], i) => (
                    <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
                      <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, color: colors.faint }}>{k}</Text>
                      <Text style={{ fontFamily: fonts.uiBold, fontSize: 13.5, color: colors.ink }}>{v}</Text>
                    </View>
                  ))}
                </View>
                {txnRow}
                {big('Done', close, '#1B7F3B')}
              </View>
            ) : null}

            {stage === 'failed' ? (
              <View>
                <View style={{ alignItems: 'center' }}><Seal kind="failed" /></View>
                {title('Payment failed')}
                {body((msg ? msg + ' ' : '') + 'In case your money was not deducted, you can give it another try.')}
                {big('Retry payment', () => { setStage('ask'); setMsg(''); setP(null); }, '#C62828')}
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.ink, textAlign: 'center', marginTop: 8 }}>
                  <Text style={{ fontFamily: fonts.uiBold }}>Tip: </Text>check the number is on Mobile Money with enough balance, or pay from another number.
                </Text>
                {body("Don't worry if your money has been deducted — send us the transaction ID and our team will sort it out.", 13)}
                {help('paying for my Genius plan')}
                {txnRow}
                {link('Close', close)}
              </View>
            ) : null}

            {stage === 'late' ? (
              <View>
                <View style={{ alignItems: 'center' }}><Seal kind="pending" /></View>
                {title('Payment pending')}
                {body('We have not heard back from Mobile Money yet. If you approved it, it will show soon — this payment stays on the Licence screen with Check payment.')}
                {big('Check again', () => { if (p) { setStage('waiting'); until.current = Date.now() + WAIT_MS; poll(p.id, true); } }, '#004A6B')}
                {body('Money deducted but still pending? Send us the transaction ID.', 13)}
                {help('a pending payment for my Genius plan')}
                {txnRow}
                {link('Close', close)}
              </View>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
