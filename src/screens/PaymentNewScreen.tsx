import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from '../components/Toast';
import {
  Button, SectionLabel, SegPill, OptionTiles, Field, Panel, DetailRow, InfoBanner,
  StickyBar, SelectField, Badge,
} from '../components/ui';
import { Icon, IconName } from '../components/icons';
import { useWho } from '../components/WhoSheet';
import PaymentAllocationSheet from '../components/PaymentAllocationSheet';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PaymentNew'>;

const num = (v: string) => Number(String(v).replace(/[^0-9.]/g, '')) || 0;

function accIcon(type: string): IconName {
  return type === 'cash' ? 'cash' : type === 'bank' ? 'bank' : 'phone';
}

export default function PaymentNewScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, recordPayment, partyBalance } = useAppData();
  const { success } = useToast();
  const who = useWho('Who took this payment?');

  const [direction, setDirection] = useState<'in' | 'out'>(route.params?.direction === 'out' ? 'out' : 'in');
  const [partyId, setPartyId] = useState<string | null>(route.params?.partyId || null);
  const [accountId, setAccountId] = useState(db?.accounts[0]?.id || 'acc_cash');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [showAllocation, setShowAllocation] = useState(false);

  const parties = useMemo(
    () => (db?.parties || []).filter((p) => (direction === 'in' ? p.type === 'customer' : p.type === 'supplier')),
    [db, direction],
  );

  const openBills = useMemo(() => {
    if (!partyId || direction !== 'in') return [];
    return (db?.sales || []).filter((s) => s.partyId === partyId && s.due > 0 && s.status !== 'void');
  }, [db, partyId, direction]);

  const owed = partyId ? partyBalance(partyId) : 0;
  /** What is outstanding with this person: what a customer owes us, or what we owe a supplier. */
  const pending = direction === 'in' ? owed : -owed;
  const amt = num(amount);
  const left = pending - amt;
  /** Each person's outstanding amount, by id, for the list. */
  const pendingOf = (id: string) => (direction === 'in' ? partyBalance(id) : -partyBalance(id));

  function save() {
    if (!partyId || !amt) return;
    if (openBills.length > 0) { setShowAllocation(true); return; }
    who.ask((server) => {
      recordPayment({ partyId, amount: amt, direction, accountId, note, userId: server.userId });
      success('Recorded by ' + server.userName);
      setAmount(''); setNote('');
      navigation.goBack();
    });
  }

  function handleAllocate(allocations: Array<{ saleId: string; amount: number }>) {
    const total = allocations.reduce((s, a) => s + a.amount, 0);
    setShowAllocation(false);
    who.ask((server) => {
      recordPayment({ partyId: partyId!, amount: total, direction, accountId, note, allocations, userId: server.userId });
      success(money(total) + ' applied by ' + server.userName);
      setAmount(''); setNote('');
      navigation.goBack();
    });
  }

  if (!db) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 150 }} keyboardShouldPersistTaps="handled">
        <SegPill
          value={direction}
          tone={direction === 'in' ? 'good' : 'danger'}
          onChange={(v) => { setDirection(v); setPartyId(null); }}
          options={[
            { v: 'in' as const, l: 'Money in', i: 'down' },
            { v: 'out' as const, l: 'Money out', i: 'up' },
          ]}
        />

        <View style={{ height: 20 }} />
        <SectionLabel>{direction === 'in' ? 'From which customer' : 'To which supplier'}</SectionLabel>
        <SelectField
          icon={direction === 'in' ? 'user' : 'factory'}
          label={direction === 'in' ? 'Customer' : 'Supplier'}
          value={partyId || ''}
          options={parties.map((p) => {
            const due = pendingOf(p.id);
            return { v: p.id, l: p.name + (due > 0.01 ? ' · ' + money(due) + (direction === 'in' ? ' owed' : ' pending') : '') };
          })}
          onChange={setPartyId}
          placeholder={'Choose a ' + (direction === 'in' ? 'customer' : 'supplier')}
        />

        {partyId ? (
          <View style={{
            flexDirection: 'row', alignItems: 'center', marginTop: -4, marginBottom: 16, padding: 12, borderRadius: 14,
            backgroundColor: pending > 0.01 ? colors.dangerSoft : colors.goodSoft,
          }}>
            <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.soft }}>
              {pending > 0.01 ? (direction === 'in' ? 'They owe you' : 'Pending to pay them') : pending < -0.01 ? (direction === 'in' ? 'They are in credit' : 'You have paid ahead') : 'Nothing pending'}
            </Text>
            <Text style={{ fontFamily: fonts.uiExtra, fontSize: 17, color: pending > 0.01 ? colors.danger : colors.good }}>{money(Math.abs(pending))}</Text>
          </View>
        ) : null}

        <SectionLabel>{direction === 'in' ? 'Paid into' : 'Paid from'}</SectionLabel>
        <OptionTiles
          value={accountId}
          onChange={setAccountId}
          tone={direction === 'in' ? 'good' : 'danger'}
          options={(db.accounts || []).map((a) => ({
            v: a.id, l: a.name.split('—')[0].trim(), i: accIcon(a.type),
          }))}
        />

        <View style={{ height: 20 }} />
        <SectionLabel>How much</SectionLabel>
        <Field icon="coins" label="Amount" value={amount} onChangeText={setAmount} numeric decimal placeholder="0" />

        {partyId && pending > 0.01 ? (
          <View style={{ flexDirection: 'row', gap: 9, marginBottom: 14 }}>
            {[
              { l: 'Half', v: Math.round(pending / 2) },
              { l: direction === 'in' ? 'All owed' : 'All pending', v: Math.round(pending) },
            ].map((qk) => (
              <View key={qk.l} style={{ flex: 1 }}>
                <Button size="sm" label={qk.l + ' · ' + money(qk.v)} onPress={() => setAmount(String(qk.v))} />
              </View>
            ))}
          </View>
        ) : null}

        <Field icon="doc" label="Note" value={note} onChangeText={setNote} placeholder="What it was for" />

        {partyId ? (
          <Panel>
            <DetailRow
              label={direction === 'in' ? (pending >= 0 ? 'They owe now' : 'In credit now') : (pending >= 0 ? 'You owe them now' : 'Paid ahead now')}
              value={money(Math.abs(pending))}
              tone={pending > 0 ? colors.danger : colors.good}
            />
            <DetailRow label={direction === 'in' ? 'Receiving' : 'Paying'} value={money(amt)} tone={colors.accent} />
            <DetailRow
              label={left > 0.01 ? (direction === 'in' ? 'They will still owe' : 'You will still owe') : left < -0.01 ? (direction === 'in' ? 'They will be in credit' : 'You will have paid ahead') : 'Settled'}
              value={money(Math.abs(left))}
              bold
              tone={left > 0.01 ? colors.danger : colors.good}
              last
            />
          </Panel>
        ) : null}

        {openBills.length > 0 && direction === 'in' ? (
          <View style={{ marginTop: 14 }}>
            <InfoBanner
              tone="accent"
              text={openBills.length + ' unpaid bill' + (openBills.length === 1 ? '' : 's')
                + ' — you will choose which the money settles.'}
            />
          </View>
        ) : null}
      </ScrollView>

      {who.sheet}

      <StickyBar>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
            {direction === 'in' ? 'Receiving' : 'Paying out'}
          </Text>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }}>{money(amt)}</Text>
        </View>
        <Button
          label={direction === 'in' ? 'Record receipt' : 'Record payment'}
          variant="pri"
          disabled={!partyId || !amt}
          icon={<Icon name="check" size={17} color={colors.accentInk} />}
          onPress={save}
        />
      </StickyBar>

      {showAllocation && (
        <PaymentAllocationSheet
          amount={amt}
          money={money}
          bills={openBills}
          onConfirm={handleAllocate}
          onCancel={() => setShowAllocation(false)}
        />
      )}
    </View>
  );
}
