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
  const amt = num(amount);
  const after = direction === 'in' ? owed - amt : owed + amt;

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
          options={parties.map((p) => ({ v: p.id, l: p.name }))}
          onChange={setPartyId}
          placeholder={'Choose a ' + (direction === 'in' ? 'customer' : 'supplier')}
        />

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

        {partyId && owed > 0 && direction === 'in' ? (
          <View style={{ flexDirection: 'row', gap: 9, marginBottom: 14 }}>
            {[
              { l: 'Half', v: Math.round(owed / 2) },
              { l: 'All owed', v: Math.round(owed) },
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
              label={owed >= 0 ? 'They owe now' : 'In credit now'}
              value={money(Math.abs(owed))}
              tone={owed > 0 ? colors.danger : colors.good}
            />
            <DetailRow label={direction === 'in' ? 'Receiving' : 'Paying'} value={money(amt)} tone={colors.accent} />
            <DetailRow
              label={after > 0 ? 'Will still owe' : after < 0 ? 'Will be in credit' : 'Settled'}
              value={money(Math.abs(after))}
              bold
              tone={after > 0 ? colors.danger : colors.good}
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
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 21, color: colors.ink }}>{money(amt)}</Text>
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
