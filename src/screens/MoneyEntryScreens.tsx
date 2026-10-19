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
import { AmountCard, RowGroup, PickRow, NoteBox, PickSheet, SumCard, AccountTiles } from '../components/MoneyForm';

const num = (v: string) => Number(String(v).replace(/[^0-9.]/g, '')) || 0;

/** A small sum: where the account stands now and after this. */
function Effect({ rows }: { rows: { l: string; v: string; tone?: string; bold?: boolean }[] }) {
  const { colors } = useTheme();
  return (
    <View style={{ borderRadius: 4, backgroundColor: colors.sunk, padding: 12, gap: 6 }}>
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
  const [picking, setPicking] = useState<'account' | 'bill' | null>(null);

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
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  const offsetBill = offsetSaleId ? db.sales.find((x) => x.id === offsetSaleId) : undefined;
  const nameOf = (id: string | null) => (id ? party(id)?.name || 'Walk-in' : 'Walk-in');
  const balance = acc ? accountBalance(acc.id) : 0;
  const after = balance + (out ? -n : n);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 130, gap: 12 }} keyboardShouldPersistTaps="handled">
        {!fixed ? (
          <SegmentSlider
            value={direction}
            onChange={flip}
            options={[
              { v: 'out', l: 'Add expense', i: 'up' },
              { v: 'in', l: 'Money in', i: 'down' },
            ]}
          />
        ) : null}

        <AmountCard
          label="Amount"
          value={amount}
          onChange={setAmount}
          hint={out
            ? <>Rent, fuel, wages and other running costs. <Text onPress={() => navigation.replace('PaymentNew', { direction: 'out' })} style={{ color: colors.accent }}>Paying a supplier?</Text></>
            : <>Commission, refunds and other income. <Text onPress={() => navigation.replace('PaymentNew', { direction: 'in' })} style={{ color: colors.accent }}>A customer paying?</Text></>}
        />

        <RowGroup>
          <LedgerPicker
            label={out ? 'Expense ledger' : 'Income ledger'}
            value={ledgerId}
            onChange={setLedgerId}
            types={out ? ['expense'] : ['income']}
            icon={out ? 'receipt' : 'coins'}
            canCreate
            trigger={(open, chosen) => (
              <PickRow icon={out ? 'receipt' : 'coins'} label={out ? 'Expense ledger' : 'Income ledger'} value={chosen ? chosen.name + ' · ' + chosen.code : undefined} placeholder="Choose a ledger" onPress={open} />
            )}
          />
          <PickRow
            icon="cash"
            label={out ? 'Paid from' : 'Paid into'}
            value={acc ? acc.name + ' · ' + money(balance) : undefined}
            placeholder="Choose an account"
            onPress={() => setPicking('account')}
          />
          {out && openBills.length ? (
            <PickRow
              icon="receipt"
              label="Charge it against a sale (optional)"
              value={offsetBill ? offsetBill.no + ' · ' + nameOf(offsetBill.partyId) : 'No, pay it from the account'}
              onPress={() => setPicking('bill')}
            />
          ) : null}
        </RowGroup>

        <NoteBox value={note} onChange={setNote} />

        {offsetBill ? (
          <SumCard rows={[
            { l: offsetBill.no + ' owes', v: money(offsetBill.due) },
            { l: 'Charged against it', v: money(Math.min(offsetBill.due, n)), tone: colors.good },
            { l: 'Still owing after', v: money(Math.max(0, offsetBill.due - n)), bold: true, tone: offsetBill.due - n > 0 ? colors.danger : colors.good },
          ]} />
        ) : acc ? (
          <SumCard rows={[
            { l: acc.name + ' now', v: money(balance) },
            { l: out ? 'This expense' : 'This money in', v: money(n), tone: out ? colors.danger : colors.good },
            { l: 'After this', v: money(after), bold: true, tone: after < 0 ? colors.danger : colors.ink },
          ]} />
        ) : null}
        {ledger ? (
          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, paddingHorizontal: 4 }}>
            Posts to {ledger.name} in the books and shows in the profit and loss.
          </Text>
        ) : null}
      </ScrollView>

      {who.sheet}

      <PickSheet
        visible={picking === 'account'}
        title={out ? 'Paid from' : 'Paid into'}
        searchHint="Search accounts"
        items={db.accounts.map((a) => ({ id: a.id, title: a.name, right: money(accountBalance(a.id)) }))}
        selected={accountId}
        onPick={setAccountId}
        onClose={() => setPicking(null)}
      />
      <PickSheet
        visible={picking === 'bill'}
        title="Charge it against a sale"
        searchHint="Search by number or customer"
        items={[
          { id: '', title: 'No, pay it from the account' },
          ...openBills.map((b) => ({ id: b.id, title: b.no + ' · ' + nameOf(b.partyId), sub: new Date(b.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }), right: money(b.due) + ' owing', rightTone: colors.danger })),
        ]}
        selected={offsetSaleId || ''}
        onPick={(id) => setOffsetSaleId(id || null)}
        onClose={() => setPicking(null)}
      />

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

        <View style={{ borderRadius: 4, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: 12, marginBottom: 12 }}>
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
          <View style={{ borderRadius: 4, backgroundColor: colors.sunk, padding: 12, gap: 6 }}>
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
