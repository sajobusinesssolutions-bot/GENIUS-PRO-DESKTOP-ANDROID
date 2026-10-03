/**
 * Adjust Money — money in, an expense — and Move money.
 *
 * What the money was for is a ledger, picked from a searchable list that can
 * also create one, so every expense and every income lands on its own line of
 * the books. Opened for an expense it is only that: "Add expense", no income
 * switch. Money in sits beside a customer's payment, and an expense beside
 * paying a supplier, so the person picks what happened rather than which
 * screen to go to.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { Pressable } from '../components/Press';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Button, Field, SelectField, InfoBanner, StickyBar, Badge } from '../components/ui';
import { Icon } from '../components/icons';
import { Foot } from '../components/AppBar';
import { useWho } from '../components/WhoSheet';
import SegmentSlider from '../components/SegmentSlider';
import LedgerPicker from '../components/LedgerPicker';

const num = (v: string) => Number(String(v).replace(/[^0-9.]/g, '')) || 0;

/** A small sum: where the account stands now and after this. */
function Effect({ rows }: { rows: { l: string; v: string; tone?: string; bold?: boolean }[] }) {
  const { colors } = useTheme();
  return (
    <View style={{ borderRadius: 14, backgroundColor: colors.sunk, padding: 12, gap: 6 }}>
      {rows.map((r) => (
        <View key={r.l} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: r.bold ? fonts.uiBold : fonts.ui, fontSize: 13.5, color: r.bold ? colors.ink : colors.soft }}>{r.l}</Text>
          <Text style={{ fontFamily: fonts.monoSemi, fontSize: 13.5, color: r.tone || colors.ink }}>{r.v}</Text>
        </View>
      ))}
    </View>
  );
}

export function EntryNewScreen({ route, navigation }: any) {
  const { colors } = useTheme();
  const { db, recordEntry, money, accountBalance, party } = useAppData();
  const who = useWho('Who is recording this?');

  /** Opened for one direction it stays that; opened plainly it can be either. */
  const fixed: 'in' | 'out' | undefined = route?.params?.direction;
  const [direction, setDirection] = useState<'in' | 'out'>(fixed || 'out');
  const [amount, setAmount] = useState('');
  const [ledgerId, setLedgerId] = useState(direction === 'out' ? 'n_expense' : 'n_income');
  const [accountId, setAccountId] = useState(db?.accounts[0]?.id || '');
  const [note, setNote] = useState('');
  const [offsetSaleId, setOffsetSaleId] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: fixed === 'out' ? 'Add expense' : fixed === 'in' ? 'Money in' : 'Adjust Money' });
  }, [navigation, fixed]);

  if (!db) return null;

  const out = direction === 'out';
  const ledger = (db.coa || []).find((l) => l.id === ledgerId);
  const acc = db.accounts.find((a) => a.id === accountId);
  const n = num(amount);

  function flip(d: 'in' | 'out') {
    setDirection(d);
    setLedgerId(d === 'out' ? 'n_expense' : 'n_income');
    setOffsetSaleId(null);
  }

  function save() {
    if (!n) { Alert.alert('Amount', 'Enter an amount first.'); return; }
    if (!ledger) { Alert.alert('Ledger', 'Choose what it was for.'); return; }
    who.ask((server) => {
      recordEntry({
        direction, accountId, category: ledger.name, ledgerId: ledger.id, amount: n, note,
        userId: server.userId,
        offsetSaleId: out ? offsetSaleId || undefined : undefined,
      });
      navigation.goBack();
    });
  }

  const openBills = (db.sales || [])
    .filter((x) => x.status !== 'void' && x.due > 0.01)
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, 40);
  const offsetBill = offsetSaleId ? db.sales.find((x) => x.id === offsetSaleId) : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 130 }} keyboardShouldPersistTaps="handled">
        {!fixed ? (
          <SegmentSlider
            value={direction}
            onChange={flip}
            style={{ marginBottom: 10 }}
            options={[
              { v: 'out', l: 'Add expense', i: 'up' },
              { v: 'in', l: 'Money in', i: 'down' },
            ]}
          />
        ) : null}

        {/* what happened: the everyday case, or the same money with a party behind it */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          {[
            { k: 'here', l: out ? 'An expense' : 'Other income', s: out ? 'Rent, fuel, wages…' : 'Commission, refunds…', i: out ? 'receipt' : 'coins' },
            { k: 'party', l: out ? 'Pay a supplier' : 'Customer payment', s: out ? 'Settle what you owe' : 'Money a customer owed', i: 'user' },
          ].map((o) => {
            const on = o.k === 'here';
            return (
              <Pressable
                key={o.k}
                onPress={() => { if (!on) navigation.replace('PaymentNew', { direction: out ? 'out' : 'in' }); }}
                style={{
                  flex: 1, padding: 12, borderRadius: 14, gap: 6,
                  borderWidth: 1.4, borderColor: on ? colors.accent : colors.line,
                  backgroundColor: on ? colors.accentSoft : colors.surface,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Icon name={o.i as any} size={16} color={on ? colors.accent : colors.soft} />
                  <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 14, color: on ? colors.accent : colors.ink }}>{o.l}</Text>
                  {!on ? <Icon name="chev" size={13} color={colors.faint} /> : null}
                </View>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{o.s}</Text>
              </Pressable>
            );
          })}
        </View>

        <Field big label="Amount" value={amount} onChangeText={setAmount} numeric decimal style={{ marginBottom: 10 }} />

        <LedgerPicker
          label={out ? 'Expense ledger' : 'Income ledger'}
          value={ledgerId}
          onChange={setLedgerId}
          types={out ? ['expense'] : ['income']}
          icon={out ? 'receipt' : 'coins'}
          canCreate
          style={{ marginBottom: 10 }}
        />

        <SelectField
          icon={out ? 'up' : 'down'}
          label={out ? 'Paid from' : 'Paid into'}
          value={accountId}
          options={db.accounts.map((a) => ({ v: a.id, l: a.name + ' · ' + money(accountBalance(a.id)) }))}
          onChange={setAccountId}
          style={{ marginBottom: 10 }}
        />

        {out && openBills.length ? (
          <SelectField
            icon="receipt"
            label="Charge it against a sale (optional)"
            value={offsetSaleId || ''}
            options={[
              { v: '', l: 'No — pay it from the account' },
              ...openBills.map((b) => ({
                v: b.id,
                l: b.no + ' · ' + (b.partyId ? (party(b.partyId)?.name || 'Walk-in') : 'Walk-in') + ' · ' + money(b.due) + ' owing',
              })),
            ]}
            onChange={(v) => setOffsetSaleId(v || null)}
            style={{ marginBottom: 10 }}
          />
        ) : null}

        <Field icon="doc" label="Note (optional)" value={note} onChangeText={setNote} placeholder="Who, what, which month" style={{ marginBottom: 12 }} />

        {offsetBill ? (
          <Effect rows={[
            { l: offsetBill.no + ' owes', v: money(offsetBill.due) },
            { l: 'Charged against it', v: money(Math.min(offsetBill.due, n)), tone: colors.good },
            { l: 'Still owing after', v: money(Math.max(0, offsetBill.due - n)), bold: true, tone: offsetBill.due - n > 0 ? colors.danger : colors.good },
          ]} />
        ) : acc ? (
          <Effect rows={[
            { l: acc.name + ' now', v: money(accountBalance(acc.id)) },
            {
              l: 'After this', v: money(accountBalance(acc.id) + (out ? -n : n)), bold: true,
              tone: out && accountBalance(acc.id) - n < 0 ? colors.danger : colors.ink,
            },
          ]} />
        ) : null}
        {ledger ? (
          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 10 }}>
            Posts to {ledger.name} in the books and shows in the profit and loss.
          </Text>
        ) : null}
      </ScrollView>

      {who.sheet}

      <StickyBar>
        <Button
          variant="pri"
          label={(out ? 'Save expense' : 'Save money in') + (n ? ' · ' + money(n) : '')}
          disabled={!n || !ledger}
          icon={<Icon name="check" size={17} color={colors.accentInk} />}
          onPress={save}
        />
      </StickyBar>
    </View>
  );
}

/** Moving money between two of the shop's own accounts. */
export function TransferScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { db, recordEntry, money, accountBalance } = useAppData();

  const [from, setFrom] = useState(db?.accounts[0]?.id || '');
  const [to, setTo] = useState(db?.accounts[1]?.id || db?.accounts[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  if (!db) return null;

  const n = num(amount);
  const fromAcc = db.accounts.find((a) => a.id === from);
  const toAcc = db.accounts.find((a) => a.id === to);
  const short = fromAcc ? accountBalance(fromAcc.id) - n < 0 : false;
  const options = db.accounts.map((a) => ({ v: a.id, l: a.name + ' · ' + money(accountBalance(a.id)) }));

  function save() {
    if (!n) { Alert.alert('Amount', 'Enter an amount first.'); return; }
    if (from === to) { Alert.alert('Accounts', 'Pick two different accounts.'); return; }
    recordEntry({ direction: 'out', accountId: from, category: 'Transfer', amount: n, note: note || 'To ' + (toAcc?.name || '') });
    recordEntry({ direction: 'in', accountId: to, category: 'Transfer', amount: n, note: note || 'From ' + (fromAcc?.name || '') });
    navigation.goBack();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <Field big label="Amount to move" value={amount} onChangeText={setAmount} numeric decimal style={{ marginBottom: 10 }} />

        <View style={{ borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: 12, marginBottom: 12 }}>
          <SelectField icon="up" label="From" value={from} options={options} onChange={setFrom} style={{ marginBottom: 6 }} />
          <View style={{ alignItems: 'center', marginVertical: -4, zIndex: 1 }}>
            <Pressable
              onPress={() => { setFrom(to); setTo(from); }}
              accessibilityLabel="Swap the accounts"
              style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="swap" size={14} color={colors.accent} />
            </Pressable>
          </View>
          <SelectField icon="down" label="To" value={to} options={options} onChange={setTo} style={{ marginBottom: 0 }} />
        </View>

        <Field icon="doc" label="Note (optional)" value={note} onChangeText={setNote} placeholder="Banked the day's takings" style={{ marginBottom: 12 }} />

        {from === to ? (
          <InfoBanner tone="warn" icon="alert" text="Pick two different accounts." />
        ) : (
          <View style={{ borderRadius: 14, backgroundColor: colors.sunk, padding: 12, gap: 6 }}>
            <View style={{ flexDirection: 'row' }}>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.ui, fontSize: 13.5, color: colors.soft }}>{fromAcc?.name} after</Text>
              <Text style={{ fontFamily: fonts.monoSemi, fontSize: 13.5, color: short ? colors.danger : colors.ink }}>{money(accountBalance(from) - n)}</Text>
            </View>
            <View style={{ flexDirection: 'row' }}>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.ui, fontSize: 13.5, color: colors.soft }}>{toAcc?.name} after</Text>
              <Text style={{ fontFamily: fonts.monoSemi, fontSize: 13.5, color: colors.good }}>{money(accountBalance(to) + n)}</Text>
            </View>
            {short ? <Badge label="More than the account holds" tone="danger" /> : null}
          </View>
        )}
      </ScrollView>

      <Foot>
        <Button
          variant="pri"
          label={'Transfer' + (n ? ' · ' + money(n) : '')}
          icon={<Icon name="swap" size={16} color={colors.accentInk} />}
          onPress={save}
          disabled={from === to || !n}
        />
      </Foot>
    </View>
  );
}
