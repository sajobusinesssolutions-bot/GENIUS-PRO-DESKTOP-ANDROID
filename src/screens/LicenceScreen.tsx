/**
 * PLAN & LICENCE.
 *
 * One page that answers, in this order: what am I on, how long have I got,
 * what does it let me do, and what would the other plan give me.
 *
 *  · The card at the top is the licence: edition, plan, status, when it ends
 *    and how much of it is left.
 *  · Four tiles: days left, devices, businesses, cloud sync.
 *  · What works today, and what is paused when a plan runs out.
 *  · This edition's two plans side by side in price, with a table comparing
 *    them line by line, and how to pay.
 *  · The other editions, for a business that does something else.
 *
 * Nothing is bought in the app: a plan is paid for and Genius Pro switches it
 * on for the account, and it reaches every phone by itself.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Alert, ActivityIndicator, Linking } from 'react-native';
import ScrollView from '../components/KeyScroll';
import { Pressable } from '../components/Press';
import { PLAY_BUILD } from '../data/store';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useAuth } from '../data/AuthContext';
import { refreshSession, SERVER_URL } from '../data/authApi';
import { Icon, IconName } from '../components/icons';
import { plural, fmtDate, fmtDay } from '../data/helpers';
import { LIC_GRACE } from '../data/defaults';
import { access, accessDaysLeft, TRIAL_DAYS } from '../data/logic';
import { EDITIONS, EDITION_LIST, Edition, editionOf, businessAllowance } from '../data/editions';
import { lastAccountLicence } from '../data/syncClient';
import { emailUrl, whatsappUrl, open as openLink } from '../data/support';

type Term = 'month' | 'quarter' | 'year';
const TERM_WORD: Record<Term, string> = { month: '/ month', quarter: '/ 3 months', year: '/ year' };

export default function LicenceScreen() {
  const { colors } = useTheme();
  const { db, money, refreshLicence } = useAppData();
  const { account } = useAuth();
  const [busy, setBusy] = useState(false);
  const [term, setTerm] = useState<Term>('month');
  const [showEditions, setShowEditions] = useState(false);
  /* A discount run from an advert (Developer → Adverts) comes off the plan prices here too. */
  const [deal, setDeal] = useState<{ starter: number; pro: number; until: string | null }>({ starter: 0, pro: 0, until: null });
  const QUOTES = ['More devices', 'More businesses', 'Syncing businesses together', 'A discount for paying ahead'];
  const [picks, setPicks] = useState<string[]>(['More businesses']);
  /** Fees set for this client (Developer → Subscription): shown in place of the standard prices. */
  const [fees, setFees] = useState<{ licenceFee: number | null; renewalFee: number | null; currency: string; note: string | null } | null>(null);
  const [paid, setPaid] = useState(0);

  const checkAccount = useCallback(async (quiet = false) => {
    if (!account?.refresh) return;
    setBusy(true);
    try {
      const r = await refreshSession(account.refresh);
      if (!r.ok) { if (!quiet) Alert.alert('Licence', r.error.message); return; }
      await refreshLicence(r.value.access, account.id);
      try {
        const res = await fetch(SERVER_URL + '/v1/adverts', { headers: { authorization: 'Bearer ' + r.value.access } });
        const ads: { discount_pct?: number; discount_plan?: string; ends_at?: string | null }[] = res.ok ? ((await res.json()).adverts || []) : [];
        const best = (plan: string) => ads.filter((x) => (x.discount_plan || 'all') === 'all' || x.discount_plan === plan)
          .reduce((m, x) => Math.max(m, Number(x.discount_pct) || 0), 0);
        const ending = ads.filter((x) => Number(x.discount_pct) > 0 && x.ends_at).map((x) => String(x.ends_at)).sort()[0] || null;
        setDeal({ starter: best('starter'), pro: best('pro'), until: ending });
      } catch { /* no offer shown */ }
      try {
        const res = await fetch(SERVER_URL + '/v1/account/fees', { headers: { authorization: 'Bearer ' + r.value.access } });
        if (res.ok) { const j = await res.json(); setFees(j.fees || null); setPaid(Number(j.paid) || 0); }
      } catch { /* the standard prices show */ }
    } finally {
      setBusy(false);
    }
  }, [account?.refresh, account?.id, refreshLicence]);

  // the newest answer each time the page opens
  useEffect(() => { void checkAccount(true); }, [checkAccount]);

  if (!db) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  const a = access(db);
  const left = accessDaysLeft(db);
  const lic = db.licence.licence;
  /* a licence can cover several editions ("retail,restaurant"): this business's own when it is one of them,
     else the first — read as a whole, the list named no edition and the Editions card crashed the page */
  const licensed = String(lic?.edition || '').split(',').map((x) => x.trim()).filter((x): x is Edition => !!EDITIONS[x as Edition]);
  const edition: Edition = licensed.includes(editionOf(db)) ? editionOf(db) : licensed[0] || editionOf(db);
  const ed = EDITIONS[edition] || EDITIONS.retail;
  const isPro = lic ? lic.plan === 'pro' || lic.plan === 'lifetime' : db.subscription.plan === 'pro';
  const planId: 'starter' | 'pro' = isPro ? 'pro' : 'starter';
  const trialing = a === 'trial' || a === 'trialOver';
  const planName = trialing ? ed.name + ' free trial' : (lic?.planName || ed.plans[planId].name);
  const ends = lic?.expiresAt || (db.subscription.status === 'trial' ? db.subscription.trialUntil : db.subscription.renewsAt);
  const lifetime = a === 'paid' && left === null;
  const open = a === 'paid' || a === 'trial';
  const room = businessAllowance(lastAccountLicence(), db);

  const status = {
    paid: { chip: lifetime ? 'Lifetime' : 'Active', tone: colors.good, icon: 'check' as IconName,
      line: lifetime ? 'It does not run out' : left !== null && left <= 7 ? 'Renew within ' + plural(Math.max(0, left), 'day') : 'Paid up until ' + fmtDay(ends) },
    trial: { chip: 'Trial', tone: '#7CB7FF', icon: 'gift' as IconName, line: plural(Math.max(0, left || 0), 'day') + ' left of ' + TRIAL_DAYS },
    trialOver: { chip: 'Trial ended', tone: '#FF8A80', icon: 'lock' as IconName, line: 'Ended ' + fmtDay(ends) + ' — choose a plan to carry on' },
    lapsed: { chip: 'Expired', tone: '#FF8A80', icon: 'lock' as IconName, line: 'Ran out ' + fmtDay(ends) + ' — renew to carry on' },
  }[a];

  // how much of the period is left, for the bar under the dates
  const span = trialing ? TRIAL_DAYS : lic?.term === 'yearly' ? 365 : lic?.term === 'monthly' ? 30 : 30;
  const pctLeft = lifetime ? 100 : left === null ? 0 : Math.max(0, Math.min(100, (left / span) * 100));

  // Restaurant and Pharmacy are priced per shop: setup, data migration and
  // training vary, so they are quoted by sales rather than listed.
  const quoted = (e: Edition) => e === 'restaurant' || e === 'pharmacy';
  /* Contact us: straight to WhatsApp, with what they are asking about already written */
  const contactUs = (about: string) => void openLink(whatsappUrl('Hello, ' + about + (account?.email ? ' My account: ' + account.email : '')));
  const contactSales = (planName?: string) => contactUs('I would like pricing for Genius Pro POS ' + ed.name + ' edition'
    + (planName ? ', ' + planName + ' plan' : '') + ', including setup fees and data migration.');

  const choose = (id: 'starter' | 'pro') => Alert.alert(
    ed.plans[id].name + ' · ' + money(ed.plans[id].prices[term]) + ' ' + TERM_WORD[term],
    'Pay Genius Pro for ' + ed.plans[id].name + ' and it is switched on for ' + (account?.email || 'your account')
      + '. It reaches every phone by itself — there is nothing to type in.',
    [{ text: 'Later', style: 'cancel' }, { text: 'Contact us', onPress: () => contactUs('I would like ' + ed.plans[id].name + ', paid ' + TERM_WORD[term] + '.') }],
  );

  const ink = '#FFFFFF';
  const soft = 'rgba(255,255,255,0.72)';
  const cap = (t: string, right?: React.ReactNode) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 26, marginBottom: 10, marginHorizontal: 4 }}>
      <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 12.5, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.faint }}>{t}</Text>
      {right}
    </View>
  );
  const tile = (icon: IconName, label: string, value: string, note: string, tone?: string) => (
    <View style={{ width: '48.5%', borderRadius: 4, padding: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
      <Icon name={icon} size={18} color={tone || colors.ink} />
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: tone || colors.ink, marginTop: 10 }}>{value}</Text>
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink, marginTop: 2 }}>{label}</Text>
      <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 2 }}>{note}</Text>
    </View>
  );

  const works: [IconName, string, boolean, string][] = [
    ['till', 'New sales, items and expenses', open, open ? 'Record, change and delete' : 'Paused until a plan is chosen'],
    ['chart', 'Premium reports', open, open ? 'Profit, ageing, ledgers and more' : 'Everyday reports stay open'],
    ['cloud', 'Cloud sync across phones', a === 'paid', a === 'paid' ? 'Every phone in step' : 'Paid plans only'],
    ['shield', 'Read, print, export and back up', true, 'Always — your books are never locked away'],
  ];

  // Starter against Pro, line by line
  const compare: [string, string, string][] = [
    ['Businesses', '1', 'Up to 3'],
    ['Phones and tills', '1', 'As many as you add'],
    ['POS till', '✓', '✓'],
    ['Cloud sync and backup', '✓', '✓'],
    ['Branches', '—', '✓'],
    ...(edition === 'restaurant' ? [
      ['Kitchen printers', '1', 'Every station'],
      ['Several menus', '—', '✓'],
      ['Tickets on every phone', '—', '✓'],
    ] as [string, string, string][] : edition === 'pharmacy' ? [
      ['Batches and expiry', '✓', '✓'],
      ['Stock between branches', '—', '✓'],
      ['Audit log and approvals', '—', '✓'],
    ] as [string, string, string][] : [
      ['Serials and IMEI', '—', '✓'],
      ['Recurring and instalments', '—', '✓'],
      ['Audit log and approvals', '—', '✓'],
    ] as [string, string, string][]),
  ];

  const saving = (p: { month: number; quarter: number; year: number }) => {
    const full = term === 'year' ? p.month * 12 : term === 'quarter' ? p.month * 3 : p.month;
    const pct = full ? Math.round((1 - p[term] / full) * 100) : 0;
    /* what a month comes to, and what the longer term saves against paying monthly */
    const months = term === 'year' ? 12 : term === 'quarter' ? 3 : 1;
    return pct > 0 ? money(Math.round(p[term] / months)) + ' a month · you save ' + money(full - p[term]) : '';
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 36 }}>
      {/* ---------- the licence ---------- */}
      <View style={{ borderRadius: 4, padding: 20, backgroundColor: '#14161B' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 40, height: 40, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={ed.icon} size={20} color={ink} />
          </View>
          <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 13, color: soft }}>{ed.name} edition</Text>
          {busy ? <ActivityIndicator color={ink} /> : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' }}>
              <Icon name={status.icon} size={13} color={status.tone} />
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: status.tone }}>{status.chip}</Text>
            </View>
          )}
        </View>

        <Text style={{ fontFamily: fonts.uiExtra, fontSize: 30, color: ink, marginTop: 18, letterSpacing: -0.6 }}>{planName}</Text>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: status.tone, marginTop: 4 }}>{status.line}</Text>

        <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.14)', marginTop: 18, overflow: 'hidden' }}>
          <View style={{ width: (pctLeft + '%') as any, height: 6, borderRadius: 3, backgroundColor: status.tone }} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: soft }}>{lifetime ? 'Lifetime licence' : left === null ? '' : plural(Math.max(0, left), 'day') + ' left'}</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: soft }}>{lifetime ? '' : 'Ends ' + fmtDay(ends)}</Text>
        </View>

        {account?.email ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)' }}>
            <Icon name="user" size={15} color={soft} />
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.ui, fontSize: 12.5, color: soft }}>{String(account.email).replace(/^(.).*(@.*)$/, '$1•••$2')}</Text>
            {lic?.no ? <Text style={{ fontFamily: fonts.mono, fontSize: 11.5, color: soft }}>{lic.no}</Text> : null}
          </View>
        ) : null}
      </View>

      {/* ---------- at a glance ---------- */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginTop: 14 }}>
        {tile('clock', 'Time left', lifetime ? '∞' : left === null ? '—' : String(Math.max(0, left)), lifetime ? 'Lifetime' : 'days', !open ? colors.danger : left !== null && left <= 7 ? colors.warn : undefined)}
        {tile('phone', 'Phones', lic?.devices ? String(lic.devices) : '—', 'allowed on this licence')}
        {tile('home', 'Businesses', room.used + ' / ' + room.max, room.left ? room.left + ' more can be added' : 'Limit reached', room.left ? undefined : colors.warn)}
        {tile('cloud', 'Cloud sync', db.sync?.on ? 'On' : 'Off', a === 'paid' ? 'included' : 'paid plans only', db.sync?.on ? colors.good : undefined)}
      </View>

      {/* ---------- what works ---------- */}
      {cap(open ? 'Working now' : 'Paused until you renew')}
      <View style={{ borderRadius: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }}>
        {works.map(([icon, title, on, sub], i) => (
          <View key={title} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
            <Icon name={icon} size={18} color={on ? colors.ink : colors.faint} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: on ? colors.ink : colors.soft }}>{title}</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 2 }}>{sub}</Text>
            </View>
            <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? colors.goodSoft : colors.sunk }}>
              <Icon name={on ? 'check' : 'lock'} size={13} color={on ? colors.good : colors.faint} />
            </View>
          </View>
        ))}
      </View>

      {/* ---------- this client's own fees, in place of the standard prices ---------- */}
      {fees ? (
        <>
          {cap('Your fees')}
          <View style={{ backgroundColor: colors.surface, borderRadius: 6, borderWidth: 1.4, borderColor: colors.accent, padding: 16, gap: 10, marginBottom: 12 }}>
            {fees.licenceFee != null ? (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.soft }}>Licence fee</Text>
                <Text style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }}>{fees.currency} {Number(fees.licenceFee).toLocaleString('en-US')}</Text>
              </View>
            ) : null}
            {fees.renewalFee != null ? (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.soft }}>Renewal fee</Text>
                <Text style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }}>{fees.currency} {Number(fees.renewalFee).toLocaleString('en-US')}</Text>
              </View>
            ) : null}
            {paid > 0 ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.good }}>Received so far: {fees.currency} {paid.toLocaleString('en-US')}</Text> : null}
            {fees.note ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{fees.note}</Text> : null}
            <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>Agreed for your business. To renew or change, contact us.</Text>
          </View>
        </>
      ) : null}

      {/* ---------- the plans (hidden when this client has fees of their own) ---------- */}
      {fees ? null : cap(ed.name + ' plans')}
      {fees || PLAY_BUILD || quoted(edition) ? null : (
        <View style={{ flexDirection: 'row', padding: 4, borderRadius: 4, backgroundColor: colors.sunk, marginBottom: 12 }}>
          {(['month', 'quarter', 'year'] as const).map((t) => (
            <Pressable key={t} onPress={() => setTerm(t)} style={{ flex: 1, paddingVertical: 10, borderRadius: 4, alignItems: 'center', backgroundColor: term === t ? colors.surface : 'transparent' }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: term === t ? colors.ink : colors.faint }}>
                {t === 'month' ? 'Monthly' : t === 'quarter' ? '3 months' : 'Yearly'}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {(fees ? [] : (['starter', 'pro'] as const)).map((id) => {
        const p = ed.plans[id];
        const mine = a === 'paid' && planId === id;
        const pro = id === 'pro';
        const off = saving(p.prices);
        const pct = deal[id];
        const price = Math.round(p.prices[term] * (1 - pct / 100));
        return (
          <View key={id} style={{
            borderRadius: 4, padding: 18, marginBottom: 12,
            backgroundColor: pro ? colors.ink : colors.surface,
            borderWidth: mine ? 2 : 1, borderColor: mine ? colors.good : pro ? colors.ink : colors.line,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1, fontFamily: fonts.uiExtra, fontSize: 19, color: pro ? colors.bg : colors.ink }}>{p.name}</Text>
              {mine ? (
                <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.good }}>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 11.5, color: '#fff' }}>Your plan</Text>
                </View>
              ) : pro ? (
                <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.bg }}>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 11.5, color: colors.ink }}>Most chosen</Text>
                </View>
              ) : null}
            </View>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 18, color: pro ? colors.line : colors.faint, marginTop: 4 }}>{p.blurb}</Text>
            {PLAY_BUILD ? null : quoted(edition) ? (
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: pro ? colors.bg : colors.ink, marginTop: 12 }}>Priced for your business</Text>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 12 }}>
                <Text style={{ fontFamily: fonts.uiExtra, fontSize: 28, color: pro ? colors.bg : colors.ink, letterSpacing: -0.5 }}>{money(price)}</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: pro ? colors.line : colors.faint, marginBottom: 5 }}>{TERM_WORD[term]}</Text>
                {off && !pct ? <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, color: colors.good, marginBottom: 6 }}>{off}</Text> : null}
              </View>
            )}
            {pct && !PLAY_BUILD && !quoted(edition) ? (
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.accent, marginTop: 4 }}>
                <Text style={{ textDecorationLine: 'line-through', fontFamily: fonts.ui, color: pro ? colors.line : colors.faint }}>{money(p.prices[term])}</Text>
                {'  ' + pct + '% off' + (deal.until ? ' until ' + fmtDay(deal.until) : '')}
              </Text>
            ) : null}
            <View style={{ gap: 7, marginTop: 12, marginBottom: 16 }}>
              {p.has.map((f) => (
                <View key={f} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Icon name="check" size={14} color={pro ? colors.bg : colors.good} />
                  <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 13, color: pro ? colors.bg : colors.soft }}>{f}</Text>
                </View>
              ))}
            </View>
            {PLAY_BUILD ? null : (
              <Pressable
                disabled={mine}
                onPress={() => (quoted(edition) && !mine ? contactSales(p.name) : choose(id))}
                style={{ height: 48, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: mine ? 'transparent' : pro ? colors.bg : colors.ink, borderWidth: mine ? 1.4 : 0, borderColor: pro ? colors.bg : colors.line }}
              >
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: mine ? (pro ? colors.bg : colors.faint) : pro ? colors.ink : colors.bg }}>
                  {mine ? 'Your current plan' : quoted(edition) ? 'Contact us' : (a === 'paid' ? 'Switch to ' : 'Get ') + p.name}
                </Text>
              </Pressable>
            )}
          </View>
        );
      })}

      {/* ---------- more than three businesses ---------- */}
      {PLAY_BUILD ? null : (
        <View style={{ borderRadius: 4, borderWidth: 1.4, borderStyle: 'dashed', borderColor: colors.accent, padding: 16, marginTop: 4, gap: 6 }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>Need more than Pro gives?</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 19, color: colors.soft }}>
            Tick what you need and get one quote for all of it — set up and moved across for you.
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
            {QUOTES.map((q) => {
              const on = picks.includes(q);
              return (
                <Pressable key={q} onPress={() => setPicks((p) => (on ? p.filter((x) => x !== q) : [...p, q]))}
                  style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4, borderWidth: 1, borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accent : 'transparent' }}>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: on ? colors.accentInk : colors.soft }}>{(on ? '✓ ' : '') + q}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable disabled={!picks.length} onPress={() => contactUs('I would like a quote for Genius Pro POS ' + ed.name + ' for: ' + picks.join(', ') + '.')}
            style={{ height: 46, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, marginTop: 8 }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.accentInk }}>Get a quote</Text>
          </Pressable>
        </View>
      )}

      {/* ---------- side by side ---------- */}
      {cap('Starter and Pro compared')}
      <View style={{ borderRadius: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.sunk }}>
          <Text style={{ flex: 1.4, fontFamily: fonts.uiBold, fontSize: 12, color: colors.faint }}> </Text>
          <Text style={{ flex: 1, textAlign: 'center', fontFamily: fonts.uiBold, fontSize: 12, color: colors.faint }}>STARTER</Text>
          <Text style={{ flex: 1, textAlign: 'center', fontFamily: fonts.uiBold, fontSize: 12, color: colors.ink }}>PRO</Text>
        </View>
        {compare.map(([k, s, p], i) => (
          <View key={k} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
            <Text style={{ flex: 1.4, fontFamily: fonts.ui, fontSize: 13, color: colors.soft }}>{k}</Text>
            <Text style={{ flex: 1, textAlign: 'center', fontFamily: fonts.uiSemi, fontSize: 13, color: s === '—' ? colors.faint : colors.ink }}>{s}</Text>
            <Text style={{ flex: 1, textAlign: 'center', fontFamily: fonts.uiBold, fontSize: 13, color: p === '✓' ? colors.good : colors.ink }}>{p}</Text>
          </View>
        ))}
      </View>

      {/* ---------- how to pay ---------- */}
      {PLAY_BUILD ? null : (
        <>
          {cap('How to pay')}
          <View style={{ borderRadius: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 12 }}>
            {[
              ['1', 'Choose the plan and how often you pay'],
              ['2', 'Pay Genius Pro by mobile money or bank'],
              ['3', 'It is switched on for ' + (account?.email || 'your account') + ' and reaches every phone by itself'],
            ].map(([n, t]) => (
              <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.bg }}>{n}</Text>
                </View>
                <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 13, color: colors.soft }}>{t}</Text>
              </View>
            ))}
            <Pressable
              onPress={() => (quoted(edition) ? contactSales() : contactUs('I would like to pay for a Genius Pro POS ' + ed.name + ' plan.'))}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: 4, borderWidth: 1.4, borderColor: colors.ink, marginTop: 4 }}
            >
              <Icon name="chat" size={16} color={colors.ink} />
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 13.5, color: colors.ink }}>Contact us</Text>
            </Pressable>
          </View>
        </>
      )}

      {/* ---------- other editions ---------- */}
      {cap('Editions', (
        <Pressable onPress={() => setShowEditions(!showEditions)} hitSlop={8}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.accent }}>{showEditions ? 'Hide' : 'Show all three'}</Text>
        </Pressable>
      ))}
      {(showEditions ? EDITION_LIST : [edition]).map((e) => {
        const d = EDITIONS[e];
        const here = e === edition;
        return (
          <View key={e} style={{ borderRadius: 18, padding: 16, marginBottom: 10, backgroundColor: colors.surface, borderWidth: here ? 2 : 1, borderColor: here ? colors.ink : colors.line }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: 4, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={d.icon} size={18} color={colors.ink} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.ink }}>{d.name}</Text>
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 1 }}>{d.tagline}</Text>
              </View>
              {here ? <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, color: colors.good }}>Yours</Text> : null}
            </View>
            <Text style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 19, color: colors.soft, marginTop: 10 }}>{d.about}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {d.special.map((f) => (
                <View key={f} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.sunk }}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: colors.soft }}>{f}</Text>
                </View>
              ))}
            </View>
            {PLAY_BUILD ? null : (
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink, marginTop: 10 }}>
                {quoted(e) ? 'Priced for your business · contact sales' : 'From ' + money(d.plans.starter.prices.month) + ' a month'}
              </Text>
            )}
          </View>
        );
      })}

      {/* ---------- check ---------- */}
      <Pressable
        disabled={busy || !account?.refresh}
        onPress={() => void checkAccount(false)}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 50, borderRadius: 4, backgroundColor: colors.sunk, marginTop: 14, opacity: busy || !account?.refresh ? 0.5 : 1 }}
      >
        {busy ? <ActivityIndicator color={colors.ink} /> : <Icon name="cloud" size={17} color={colors.ink} />}
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.ink }}>{busy ? 'Checking…' : 'Check my plan now'}</Text>
      </Pressable>
      <Text style={{ fontFamily: fonts.ui, fontSize: 12, lineHeight: 18, color: colors.faint, textAlign: 'center', marginTop: 10, paddingHorizontal: 10 }}>
        {db.licence.checkedAt ? 'Last checked ' + fmtDate(db.licence.checkedAt) + '. ' : ''}
        A new plan reaches this phone by itself. With no internet it keeps working on the last answer for up to {LIC_GRACE} days.
      </Text>
    </ScrollView>
  );
}
