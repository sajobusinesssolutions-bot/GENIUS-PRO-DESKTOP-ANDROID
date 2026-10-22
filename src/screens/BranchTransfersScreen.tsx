/**
 * Transfers to and from another business you run — the phone's end of the
 * computer's stock journal.
 *
 * The account server holds each transfer and its story (server/src/
 * transfers.core.js); this phone moves its own stock and books
 * (logic.ts branchSendOut / branchReceiveIn / branchCallBack):
 *
 *   Coming in   count each line as it comes off the vehicle, say why a line
 *               is short, match it to one of this business's products, receive
 *   Sent        see when it was opened and received; call back what has not
 *               been received; reconcile a short delivery with a note
 *   New         pick the business, the items and quantities, send
 *
 * Receiving and calling back take the transfer on the server first, so a
 * computer and a phone can never both receive it.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Alert, TextInput, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pressable } from '../components/Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useAuth } from '../data/AuthContext';
import { refreshSession } from '../data/authApi';
import { transfersApi, type RemoteTransfer } from '../data/syncClient';
import { Card, Cap, Button, Chip, ChipStrip, EmptyState } from '../components/ui';
import { Field } from '../components/form';
import { uid } from '../data/uid';
import { activeBranchId } from '../data/branch';
import type { Product } from '../data/types';

type Tab = 'in' | 'out' | 'new';
const PENDING = 'genius.transfers.pending';
const STATUS: Record<string, string> = {
  in_transit: 'On the road', receiving: 'Being received', cancelling: 'Being called back', editing: 'Being changed',
  received: 'Received', short: 'Short — to reconcile', reconciled: 'Reconciled', cancelled: 'Called back',
};
const norm = (x: string) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** A step that did not reach the server: sent again the next time this screen opens. */
interface Pending { kind: 'send' | 'step'; business: string; body: any; id?: number; step?: 'finish' }
async function readPending(): Promise<Pending[]> { try { return JSON.parse((await AsyncStorage.getItem(PENDING)) || '[]'); } catch { return []; } }
async function writePending(p: Pending[]) { try { await AsyncStorage.setItem(PENDING, JSON.stringify(p)); } catch { /* next time */ } }

export default function BranchTransfersScreen() {
  const { colors } = useTheme();
  const { db, money, me, branchSendOut, branchReceiveIn, branchCallBack, can } = useAppData();
  const { account } = useAuth();
  const [tab, setTab] = useState<Tab>('in');
  const [list, setList] = useState<RemoteTransfer[] | null>(null);
  const [problem, setProblem] = useState('');
  const [open, setOpen] = useState<RemoteTransfer | null>(null);
  const [busy, setBusy] = useState(false);
  const business = db?.sync?.on ? db?.sync?.businessId || '' : '';
  const by = me()?.name || 'Phone';

  const token = useCallback(async (): Promise<string | null> => {
    if (!account?.refresh) return null;
    const r = await refreshSession(account.refresh);
    return r.ok ? r.value.access : null;
  }, [account?.refresh]);

  const flush = useCallback(async (t: string) => {
    const left: Pending[] = [];
    for (const p of await readPending()) {
      const r = p.kind === 'send' ? await transfersApi.send(t, p.body) : await transfersApi.step(t, p.business, p.id!, p.step!, p.body);
      if (!r.ok && (r.error.failure === 'offline' || r.error.failure === 'timeout')) left.push(p);
    }
    await writePending(left);
  }, []);

  const load = useCallback(async () => {
    setProblem('');
    if (!business) { setList([]); return; }
    const t = await token();
    if (!t) { setProblem('Sign in to your Genius account on this phone to see transfers.'); setList([]); return; }
    await flush(t);
    const r = await transfersApi.list(t, business);
    if (!r.ok) { setProblem(r.error.message || 'The account server did not answer.'); setList([]); return; }
    setList(r.value.transfers);
  }, [business, token, flush]);
  useEffect(() => { load(); }, [load]);

  if (!db) return null;
  if (!business) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16 }}>
        <EmptyState icon="arrow" title="Turn on Cloud sync first"
          subtitle="Stock moves between your businesses through your Genius account. Switch on sync for this business, then come back." />
      </View>
    );
  }

  const shown = (list || []).filter((t) => t.direction === tab);
  const waiting = (list || []).filter((t) => t.direction === 'in' && t.status === 'in_transit').length;

  if (open) {
    return <Detail t={open} business={business} by={by} busy={busy} setBusy={setBusy} token={token} money={money}
      products={db.products.filter((p) => p.active !== false)} can={can}
      hasSent={(ref) => db.movements.some((m) => m.ref === ref && m.type === 'transfer_out')}
      onReceive={branchReceiveIn} onCallBack={branchCallBack}
      onClose={() => { setOpen(null); load(); }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ChipStrip options={[['in', 'Coming in' + (waiting ? ' · ' + waiting : '')], ['out', 'Sent'], ['new', 'Send stock']]} value={tab} onChange={(v) => setTab(v as Tab)} />
      {tab === 'new' ? (
        <SendForm business={business} by={by} token={token} products={db.products.filter((p) => p.active !== false)}
          stockOf={(p) => p.stock[activeBranchId(db)] || 0} money={money}
          onSend={branchSendOut} onSent={() => { setTab('out'); load(); }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
          {problem ? <Text style={{ fontFamily: fonts.ui, color: colors.danger }}>{problem}</Text> : null}
          {list === null ? <ActivityIndicator /> : shown.length === 0 ? (
            <EmptyState icon="arrow" title={tab === 'in' ? 'Nothing on its way here' : 'Nothing sent yet'}
              subtitle={tab === 'in' ? 'Stock another of your businesses sends lands here.' : 'Send stock to another of your businesses from the Send stock tab.'} />
          ) : shown.map((t) => (
            <Pressable key={t.id} onPress={async () => {
              const tk = await token();
              if (tk && t.direction === 'in' && t.status === 'in_transit' && !t.seen_at) {
                const r = await transfersApi.open(tk, business, t.id, by);
                if (r.ok) { setOpen(r.value.transfer); return; }
              }
              setOpen(t);
            }}>
              <Card style={{ padding: 14 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{t.transfer_no}</Text>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: t.status === 'short' ? colors.warn : t.status === 'in_transit' ? colors.accent : colors.faint }}>{STATUS[t.status] || t.status}</Text>
                </View>
                <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.soft, marginTop: 3 }}>
                  {t.direction === 'in' ? 'from ' + t.from_name : 'to ' + t.to_name} · {t.lines.length} line{t.lines.length === 1 ? '' : 's'} · {money(t.value)}
                </Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 2 }}>
                  {new Date(t.sent_at).toLocaleString()}{t.status === 'in_transit' ? (t.seen_at ? ' · seen' : tab === 'out' ? ' · not opened yet' : ' · new') : ''}
                </Text>
              </Card>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/* ---------------- one transfer: count in, call back, reconcile ---------------- */
function Detail({ t, business, by, busy, setBusy, token, money, products, can, hasSent, onReceive, onCallBack, onClose }: {
  t: RemoteTransfer; business: string; by: string; busy: boolean; setBusy: (b: boolean) => void; token: () => Promise<string | null>;
  money: (n: number) => string; products: Product[]; can: (k: string) => boolean; hasSent: (ref: string) => boolean;
  onReceive: (lines: any[], ref: string, fromName: string, value: number) => { shortValue: number };
  onCallBack: (ref: string, toName: string) => number; onClose: () => void;
}) {
  const { colors } = useTheme();
  const receiving = t.direction === 'in' && t.status === 'in_transit' && can('inventory.transfer');
  const [got, setGot] = useState<Record<number, string>>({});
  const [why, setWhy] = useState<Record<number, string>>({});
  const [note, setNote] = useState('');
  const [pick, setPick] = useState<Record<number, string>>({});
  const [find, setFind] = useState<Record<number, string>>({});
  /* each line's product here: same code with a like name, then the same name */
  const auto = useMemo(() => t.lines.map((l) => {
    const byCode = l.item_code ? products.find((p) => p.sku && p.sku.toLowerCase() === l.item_code.toLowerCase() && norm(p.name).split(' ')[0] === norm(l.name).split(' ')[0]) : undefined;
    return byCode || products.find((p) => norm(p.name) === norm(l.name));
  }), [t, products]);
  const productOf = (i: number) => (pick[i] ? products.find((p) => p.id === pick[i]) : auto[i]);
  const counted = (i: number) => (got[i] === undefined ? t.lines[i].quantity : Number(got[i]) || 0);
  const shortLines = t.lines.map((l, i) => i).filter((i) => counted(i) < t.lines[i].quantity);
  const unmatched = t.lines.map((l, i) => i).filter((i) => !productOf(i));

  async function receive() {
    if (unmatched.length) { Alert.alert('Match every line', 'Pick which of your products each line is.'); return; }
    if (shortLines.some((i) => !(why[i] || '').trim()) && !note.trim()) { Alert.alert('A line is short', 'Say what happened — damaged, missing…'); return; }
    if (t.lines.some((l, i) => counted(i) > l.quantity)) { Alert.alert('Too many', 'More cannot arrive than was sent.'); return; }
    setBusy(true);
    try {
      const tk = await token();
      if (!tk) throw new Error('Sign in again to receive.');
      const c = await transfersApi.step(tk, business, t.id, 'claim', { as: 'receiving' });
      if (!c.ok) throw new Error(c.error.message);
      let shortValue = 0;
      try {
        shortValue = onReceive(t.lines.map((l, i) => ({ productId: productOf(i)!.id, received: counted(i), sent: l.quantity, unitCost: l.unit_cost })), 'trf-' + t.id, t.from_name, t.value).shortValue;
      } catch (e: any) {
        await transfersApi.step(tk, business, t.id, 'release');
        throw e;
      }
      const body = { status: shortLines.length ? 'short' : 'received', short_value: shortValue, by, note,
        received_lines: t.lines.map((l, i) => ({ name: l.name, unit: l.unit, sent: l.quantity, received: counted(i), note: why[i] || '' })) };
      const f = await transfersApi.step(tk, business, t.id, 'finish', body);
      if (!f.ok) { const p = await readPending(); p.push({ kind: 'step', business, id: t.id, step: 'finish', body }); await writePending(p); }
      Alert.alert('Received', shortLines.length ? 'Received with ' + shortLines.length + ' line(s) short — the sender is told.' : 'Everything is on the shelf.');
      onClose();
    } catch (e: any) { Alert.alert('Not received', e?.message || 'Try again.'); }
    setBusy(false);
  }
  async function callBack() {
    if (!hasSent(t.ref)) { Alert.alert('Sent from another device', 'Call it back there, where the stock left.'); return; }
    setBusy(true);
    try {
      const tk = await token();
      if (!tk) throw new Error('Sign in again.');
      const c = await transfersApi.step(tk, business, t.id, 'claim', { as: 'cancelling' });
      if (!c.ok) throw new Error(c.error.message);
      try { onCallBack(t.ref, t.to_name); } catch (e) { await transfersApi.step(tk, business, t.id, 'release'); throw e; }
      const f = await transfersApi.step(tk, business, t.id, 'finish', { by, note });
      if (!f.ok) { const p = await readPending(); p.push({ kind: 'step', business, id: t.id, step: 'finish', body: { by, note } }); await writePending(p); }
      Alert.alert('Called back', 'The goods are back on this shelf.');
      onClose();
    } catch (e: any) { Alert.alert('Not called back', e?.message || 'Try again.'); }
    setBusy(false);
  }
  async function reconcile() {
    if (!note.trim()) { Alert.alert('How was it settled?', 'Write a note — driver to pay, written off, sent again…'); return; }
    const tk = await token();
    const r = tk ? await transfersApi.step(tk, business, t.id, 'reconcile', { note, by }) : null;
    if (!r || !r.ok) { Alert.alert('Not reconciled', r && !r.ok ? r.error.message : 'Sign in again.'); return; }
    onClose();
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Card style={{ padding: 14 }}>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 17, color: colors.ink }}>{t.transfer_no}</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.soft, marginTop: 4 }}>{t.from_name} → {t.to_name}{t.vehicle ? ' · ' + t.vehicle : ''}</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>{STATUS[t.status] || t.status} · {money(t.value)}{t.note ? ' · “' + t.note + '”' : ''}</Text>
      </Card>

      {t.lines.map((l, i) => {
        const p = productOf(i), c = counted(i), short = receiving && c < l.quantity;
        const q = norm(find[i] || '');
        const options = !p && receiving ? products.filter((x) => !q || norm(x.name).includes(q)).slice(0, 8) : [];
        return (
          <Card key={i} style={{ padding: 14, borderColor: short ? colors.warn : colors.line, borderWidth: 1 }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{l.name}</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>sent {l.quantity} {l.unit} · {money(l.unit_cost)} each</Text>
            {receiving ? (
              <>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: p ? colors.good : colors.warn, marginTop: 6 }}>
                  {p ? 'into ' + p.name : 'Not in your products — pick one:'}
                </Text>
                {!p ? (
                  <>
                    <TextInput value={find[i] || ''} onChangeText={(v) => setFind((f) => ({ ...f, [i]: v }))} placeholder="Find a product"
                      style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 4, padding: 8, marginTop: 6, color: colors.ink }} />
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      {options.map((x) => <Chip key={x.id} label={x.name} onPress={() => setPick((m) => ({ ...m, [i]: x.id }))} />)}
                    </View>
                  </>
                ) : pick[i] ? <Chip label="change" onPress={() => setPick((m) => { const n = { ...m }; delete n[i]; return n; })} /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <Button size="sm" label="−" onPress={() => setGot((g) => ({ ...g, [i]: String(Math.max(0, c - 1)) }))} />
                  <TextInput value={got[i] === undefined ? String(l.quantity) : got[i]} keyboardType="decimal-pad"
                    onChangeText={(v) => setGot((g) => ({ ...g, [i]: v.replace(/[^0-9.]/g, '') }))}
                    style={{ width: 70, textAlign: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 4, padding: 6, color: colors.ink, fontFamily: fonts.uiBold }} />
                  <Button size="sm" label="+" onPress={() => setGot((g) => ({ ...g, [i]: String(Math.min(l.quantity, c + 1)) }))} />
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>arrived</Text>
                </View>
                {short ? <TextInput value={why[i] || ''} onChangeText={(v) => setWhy((w) => ({ ...w, [i]: v }))} placeholder={(l.quantity - c) + ' short — what happened?'}
                  style={{ borderWidth: 1, borderColor: colors.warn, borderRadius: 4, padding: 8, marginTop: 8, color: colors.ink }} /> : null}
              </>
            ) : t.received_lines && t.received_lines[i] ? (
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.soft, marginTop: 4 }}>arrived {t.received_lines[i].received}{t.received_lines[i].note ? ' — ' + t.received_lines[i].note : ''}</Text>
            ) : null}
          </Card>
        );
      })}

      <Card style={{ padding: 14 }}>
        <Cap style={{ marginBottom: 6 }}>Story</Cap>
        {(t.events || []).map((e, i) => (
          <Text key={i} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.soft, marginBottom: 4 }}>
            {new Date(e.at).toLocaleString()} · {e.what.replace('_', ' ')} · {e.by}{e.branch ? ' at ' + e.branch : ''}{e.note ? ' — ' + e.note : ''}
          </Text>
        ))}
      </Card>

      <Field label={receiving ? 'Note for the sender (optional)' : t.status === 'short' && t.direction === 'out' ? 'How was the shortage settled?' : 'Note'} value={note} onChangeText={setNote} />
      {receiving ? <Button variant="pri" label={busy ? 'Receiving…' : shortLines.length ? 'Receive what arrived' : 'Receive all'} disabled={busy} onPress={receive} /> : null}
      {t.direction === 'out' && t.status === 'in_transit' && can('inventory.transfer') ? <Button label={busy ? 'Calling back…' : 'Call back'} variant="dngr" disabled={busy} onPress={callBack} /> : null}
      {t.direction === 'out' && t.status === 'short' ? <Button variant="pri" label="Reconcile" onPress={reconcile} /> : null}
      <Button label="Back" onPress={onClose} />
    </ScrollView>
  );
}

/* ---------------- send stock to another business ---------------- */
function SendForm({ business, by, token, products, stockOf, money, onSend, onSent }: {
  business: string; by: string; token: () => Promise<string | null>; products: Product[]; stockOf: (p: Product) => number;
  money: (n: number) => string; onSend: (lines: any[], ref: string, toName: string) => { lines: any[]; value: number }; onSent: () => void;
}) {
  const { colors } = useTheme();
  const [dests, setDests] = useState<Array<{ id: string; name: string }> | null>(null);
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [vehicle, setVehicle] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { (async () => {
    const t = await token(); if (!t) { setDests([]); return; }
    const r = await transfersApi.destinations(t, business);
    setDests(r.ok ? r.value.businesses : []);
    if (r.ok && r.value.businesses.length === 1) setTo(r.value.businesses[0].id);
  })(); }, [business, token]);

  const lines = Object.entries(qty).map(([productId, v]) => ({ productId, qty: Number(v) || 0 })).filter((l) => l.qty > 0);
  const found = products.filter((p) => stockOf(p) > 0 && (!q || norm(p.name + ' ' + p.sku).includes(norm(q)))).slice(0, 30);
  const value = lines.reduce((a, l) => a + l.qty * (products.find((p) => p.id === l.productId)?.cost || 0), 0);

  async function send() {
    const dest = (dests || []).find((d) => d.id === to);
    if (!dest) { Alert.alert('Where to?', 'Pick the business to send to.'); return; }
    if (!lines.length) { Alert.alert('What?', 'Enter a quantity for at least one product.'); return; }
    setBusy(true);
    const ref = 'ph-' + uid('trf');
    try {
      const out = onSend(lines, ref, dest.name);
      const body = { business, to_business: dest.id, ref, lines: out.lines, value: out.value, vehicle, note, by };
      const t = await token();
      const r = t ? await transfersApi.send(t, body) : null;
      if (!r || !r.ok) { const p = await readPending(); p.push({ kind: 'send', business, body }); await writePending(p); }
      Alert.alert('Sent', r && r.ok ? r.value.transfer.transfer_no + ' is on its way to ' + dest.name + '.' : 'The stock has left this shelf; ' + dest.name + ' is told as soon as this phone is online.');
      setQty({}); setNote(''); setVehicle('');
      onSent();
    } catch (e: any) { Alert.alert('Not sent', e?.message || 'Try again.'); }
    setBusy(false);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
      <Cap>Send to</Cap>
      {dests === null ? <ActivityIndicator /> : dests.length === 0 ? (
        <Text style={{ fontFamily: fonts.ui, color: colors.faint }}>No other business on your account. Each business you run is a branch you can send to.</Text>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>{dests.map((d) => <Chip key={d.id} label={d.name} on={d.id === to} onPress={() => setTo(d.id)} />)}</View>
      )}
      <Field label="Find a product" value={q} onChangeText={setQ} />
      {found.map((p) => (
        <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>{p.name}</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{stockOf(p)} {p.unit} on the shelf</Text>
          </View>
          <TextInput value={qty[p.id] || ''} keyboardType="decimal-pad" placeholder="0"
            onChangeText={(v) => setQty((m) => ({ ...m, [p.id]: v.replace(/[^0-9.]/g, '') }))}
            style={{ width: 70, textAlign: 'center', borderWidth: 1, borderColor: Number(qty[p.id]) > stockOf(p) ? colors.danger : colors.line, borderRadius: 4, padding: 6, color: colors.ink }} />
        </View>
      ))}
      <Field label="Vehicle / driver (optional)" value={vehicle} onChangeText={setVehicle} />
      <Field label="Note (optional)" value={note} onChangeText={setNote} />
      <Text style={{ fontFamily: fonts.uiSemi, color: colors.soft }}>{lines.length} item{lines.length === 1 ? '' : 's'} · {money(value)} at cost</Text>
      <Button variant="pri" label={busy ? 'Sending…' : 'Send stock'} disabled={busy || !lines.length || !to} onPress={send} />
    </ScrollView>
  );
}
