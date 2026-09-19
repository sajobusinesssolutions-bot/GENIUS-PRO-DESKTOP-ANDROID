/**
 * Money in / money out and Move money.
 *
 * Reference: the live SHEETS.entry (line 7208) — a segmented Expense/Income
 * switch, the `.bigfield` amount, a live category chip row that swaps with the
 * direction (expCats, 7226), a "Paid from" account chip row, a note and the
 * closing field note — and SHEETS.transfer2 (4247).
 *
 * Rendered as full screens because this port uses a navigation stack.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import {
  Card, Cap, Button, KV, Seg, BigAmount, ChipRow, Field, FieldNote, Grid, Stat,
  Panel, SegPill, SectionLabel, DetailRow, InfoBanner, StickyBar, OptionTiles, SelectField, Badge,
} from '../components/ui';
import { Icon, IconName } from '../components/icons';
import { Foot } from '../components/AppBar';
import { useWho } from '../components/WhoSheet';
import { EXP_CATS, INC_CATS } from '../data/defaults';

const num = (v: string) => Number(String(v).replace(/[^0-9.]/g, '')) || 0;

function accIcon(type: string): IconName {
  return type === 'cash' ? 'cash' : type === 'bank' ? 'bank' : 'phone';
}

/** Reference expCats(dir, current), line 7226. */
function catsFor(dir: 'in' | 'out') {
  return (dir === 'in' ? INC_CATS : EXP_CATS).map((c) => ({ v: c.v, l: c.v, i: c.i }));
}

export function EntryNewScreen({ route, navigation }: any) {
  const { colors } = useTheme();
  const { db, recordEntry, money, cur, accountBalance, party } = useAppData();
  const who = useWho('Who is recording this?');
  /** A credit bill this expense comes off, instead of the drawer. */
  const [offsetSaleId, setOffsetSaleId] = useState<string | null>(null);

  const [direction, setDirection] = useState<'in' | 'out'>(route?.params?.direction === 'in' ? 'in' : 'out');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(EXP_CATS[0].v);
  const [accountId, setAccountId] = useState(db?.accounts[0]?.id || '');
  const [note, setNote] = useState('');

  if (!db) return null;

  const cats = catsFor(direction);
  const cat = cats.some((c) => c.v === category) ? category : cats[0].v;

  function flip(d: 'in' | 'out') {
    setDirection(d);
    const next = catsFor(d);
    if (!next.some((c) => c.v === category)) setCategory(next[0].v);
  }

  function save() {
    const n = num(amount);
    if (!n) { Alert.alert('Amount', 'Enter an amount first.'); return; }
    who.ask((server) => {
      recordEntry({
        direction, accountId, category: cat, amount: n, note,
        userId: server.userId,
        offsetSaleId: direction === 'out' ? offsetSaleId || undefined : undefined,
      });
      navigation.goBack();
    });
  }

  const acc = db.accounts.find((a) => a.id === accountId);

  /** Credit bills with something still outstanding. */
  const openBills = React.useMemo(
    () => (db.sales || [])
      .filter((x) => x.status !== 'void' && x.due > 0.01)
      .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
      .slice(0, 40),
    [db.sales],
  );
  const offsetBill = offsetSaleId ? db.sales.find((x) => x.id === offsetSaleId) : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 130 }} keyboardShouldPersistTaps="handled">
        <SegPill
          value={direction}
          tone={direction === 'out' ? 'danger' : 'good'}
          options={[
            { v: 'out' as const, l: 'Expense', i: 'up' as IconName },
            { v: 'in' as const, l: 'Income', i: 'down' as IconName },
          ]}
          onChange={flip}
        />
        <View style={{ height: 16 }} />

        <BigAmount
          caption={direction === 'out' ? 'Money going out' : 'Money coming in'}
          value={amount}
          onChangeText={setAmount}
          currency={cur()}
        />

        <SectionLabel>Category</SectionLabel>
        <ChipRow value={cat} options={cats} onChange={setCategory} style={{ marginBottom: 20 }} />

        <SectionLabel>{direction === 'out' ? 'Paid from' : 'Paid into'}</SectionLabel>
        <OptionTiles
          value={accountId}
          tone={direction === 'out' ? 'danger' : 'good'}
          options={db.accounts.map((a) => ({ v: a.id, l: a.name.split('—')[0].trim(), i: accIcon(a.type) }))}
          onChange={setAccountId}
        />
        <View style={{ height: 20 }} />

        {direction === 'out' ? (
          <>
            <SectionLabel right={offsetSaleId ? <Badge label="Off a bill" tone="accent" /> : undefined}>
              Charge it against a bill
            </SectionLabel>
            <SelectField
              icon="receipt"
              label="Unpaid bill"
              value={offsetSaleId || ''}
              options={[
                { v: '', l: 'No — pay it from the account' },
                ...openBills.map((b) => ({
                  v: b.id,
                  l: b.no + ' · ' + (b.partyId ? (party(b.partyId)?.name || 'Walk-in') : 'Walk-in') + ' · ' + money(b.due) + ' owing',
                })),
              ]}
              onChange={(v) => setOffsetSaleId(v || null)}
              placeholder="No — pay it from the account"
            />
            {offsetSaleId ? (
              <InfoBanner
                tone="accent"
                icon="bulb"
                text={'The customer settled this, so it comes off what they owe on that bill rather than out of '
                  + (acc?.name || 'the account') + '. Anything above the balance still leaves the drawer.'}
              />
            ) : null}
            <View style={{ height: 20 }} />
          </>
        ) : null}

        <SectionLabel>Note</SectionLabel>
        <Field icon="doc" value={note} onChangeText={setNote} placeholder="Who, what, which month" />

        {offsetBill ? (
          <Panel>
            <DetailRow label={offsetBill.no + ' owes'} value={money(offsetBill.due)} />
            <DetailRow label="Charged against it" value={money(Math.min(offsetBill.due, num(amount)))} tone={colors.good} />
            <DetailRow
              label="Still owing after"
              value={money(Math.max(0, offsetBill.due - num(amount)))}
              bold
              tone={offsetBill.due - num(amount) > 0 ? colors.danger : colors.good}
              last
            />
          </Panel>
        ) : acc ? (
          <Panel>
            <DetailRow label={acc.name + ' now'} value={money(accountBalance(acc.id))} />
            <DetailRow
              label="After this"
              value={money(accountBalance(acc.id) + (direction === 'out' ? -num(amount) : num(amount)))}
              bold
              tone={direction === 'out' && accountBalance(acc.id) - num(amount) < 0 ? colors.danger : colors.ink}
              last
            />
          </Panel>
        ) : null}

        <View style={{ height: 14 }} />
        <InfoBanner tone="neutral" icon="doc" text="Goes straight to the ledger and shows in the profit and loss." />
      </ScrollView>

      {who.sheet}

      <StickyBar>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Button label="Cancel" onPress={() => navigation.goBack()} /></View>
          <View style={{ flex: 2 }}>
            <Button
              variant="pri"
              label={direction === 'out' ? 'Record expense' : 'Record income'}
              icon={<Icon name="check" size={17} color={colors.accentInk} />}
              onPress={save}
            />
          </View>
        </View>
      </StickyBar>
    </View>
  );
}

/** SHEETS.transfer2 — reference line 4247. */
export function TransferScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { db, recordEntry, money, cur, accountBalance, party } = useAppData();

  const [from, setFrom] = useState(db?.accounts[0]?.id || '');
  const [to, setTo] = useState(db?.accounts[1]?.id || db?.accounts[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  if (!db) return null;

  const n = num(amount);
  const fromAcc = db.accounts.find((a) => a.id === from);
  const toAcc = db.accounts.find((a) => a.id === to);
  const short = fromAcc ? accountBalance(fromAcc.id) - n < 0 : false;

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
        <BigAmount caption="How much to move" value={amount} onChangeText={setAmount} currency={cur()} />

        <Cap style={{ marginBottom: 8 }}>From</Cap>
        <ChipRow
          value={from}
          options={db.accounts.map((a) => ({ v: a.id, l: a.name.split('—')[0].trim(), i: accIcon(a.type) }))}
          onChange={setFrom}
          style={{ marginBottom: 14 }}
        />

        <View style={{ alignItems: 'center', marginBottom: 12 }}>
          <View style={{
            width: 34, height: 34, borderRadius: 17, backgroundColor: colors.sunk,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="swap" size={17} color={colors.rail} />
          </View>
        </View>

        <Cap style={{ marginBottom: 8 }}>To</Cap>
        <ChipRow
          value={to}
          options={db.accounts.map((a) => ({ v: a.id, l: a.name.split('—')[0].trim(), i: accIcon(a.type) }))}
          onChange={setTo}
          style={{ marginBottom: 14 }}
        />

        <Grid cols={2}>
          <Stat label="Out of" value={money(accountBalance(from) - n)} tone={short ? 'd' : 'default'} />
          <Stat label="Into" value={money(accountBalance(to) + n)} tone="g" />
        </Grid>

        <View style={{ height: 12 }} />
        <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="Banked the day's takings" />

        {from === to ? (
          <View style={{ backgroundColor: colors.warnSoft, borderRadius: radius.md, padding: 12, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Icon name="alert" size={15} color={colors.warn} />
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: colors.warn, flex: 1 }}>
              Pick two different accounts.
            </Text>
          </View>
        ) : (
          <FieldNote>
            Recorded as one payment out and one in, so both accounts and the ledger agree.
          </FieldNote>
        )}
      </ScrollView>

      <Foot>
        <View style={{ flexDirection: 'row', gap: 9 }}>
          <View style={{ flex: 1 }}><Button label="Cancel" onPress={() => navigation.goBack()} /></View>
          <View style={{ flex: 1.5 }}>
            <Button
              variant="pri"
              label="Transfer"
              icon={<Icon name="swap" size={16} color={colors.accentInk} />}
              onPress={save}
              disabled={from === to}
            />
          </View>
        </View>
      </Foot>
    </View>
  );
}
