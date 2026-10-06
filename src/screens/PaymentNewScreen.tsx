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
import { Pressable } from '../components/Press';
import { AmountCard, RowGroup, PickRow, NoteBox, AccountTiles, SumCard } from '../components/MoneyForm';
import { CustomerPickerSheet, CustomerFormSheet } from '../components/CustomerSheets';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PaymentNew'>;

const num = (v: string) => Number(String(v).replace(/[^0-9.]/g, '')) || 0;

function accIcon(type: string): IconName {
  return type === 'cash' ? 'cash' : type === 'bank' ? 'bank' : 'phone';
}

export default function PaymentNewScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, recordPayment, partyBalance, addParty } = useAppData();
  const { success } = useToast();
  const who = useWho('Who took this payment?');

  const [direction, setDirection] = useState<'in' | 'out'>(route.params?.direction === 'out' ? 'out' : 'in');
  const [partyId, setPartyId] = useState<string | null>(route.params?.partyId || null);
  const [accountId, setAccountId] = useState(db?.accounts[0]?.id || 'acc_cash');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [showAllocation, setShowAllocation] = useState(false);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);

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

  const inbound = direction === 'in';
  const tone = inbound ? colors.good : colors.danger;
  const chosen = partyId ? (db.parties || []).find((p) => p.id === partyId) : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 170, gap: 12 }} keyboardShouldPersistTaps="handled">
        {/* money in or money out */}
        <View style={{ flexDirection: 'row', backgroundColor: colors.sunk, borderRadius: 12, padding: 3 }}>
          {([['in', 'Money in', 'down', colors.good], ['out', 'Money out', 'up', colors.danger]] as const).map(([v, l, i, t]) => {
            const on = direction === v;
            return (
              <Pressable
                key={v}
                onPress={() => { setDirection(v); setPartyId(null); }}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: on ? colors.surface : 'transparent' }}
              >
                <Icon name={i} size={14} color={on ? t : colors.soft} />
                <Text style={{ fontFamily: on ? fonts.uiBold : fonts.uiSemi, fontSize: 14, color: on ? t : colors.soft }}>{l}</Text>
              </Pressable>
            );
          })}
        </View>

        <AmountCard label={inbound ? 'Amount received' : 'Amount paid'} value={amount} onChange={setAmount} tone={tone} sign={inbound ? '+' : '−'} />

        {partyId && pending > 0.01 ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: -4 }}>
            {[{ l: 'Half', v: Math.round(pending / 2) }, { l: inbound ? 'All owed' : 'All pending', v: Math.round(pending) }].map((qk) => (
              <Pressable key={qk.l} onPress={() => setAmount(String(qk.v))} style={{ flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center' }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>{qk.l} · {money(qk.v)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.soft, marginBottom: -4, paddingHorizontal: 4 }}>{inbound ? 'From which customer' : 'To which supplier'}</Text>
        <RowGroup>
          <PickRow
            icon={inbound ? 'user' : 'factory'}
            value={chosen?.name}
            placeholder={'Choose a ' + (inbound ? 'customer' : 'supplier')}
            onPress={() => setPicking(true)}
          />
          {chosen ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, backgroundColor: pending > 0.01 ? colors.dangerSoft : colors.goodSoft }}>
              <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 13, color: colors.soft }}>
                {pending > 0.01 ? (inbound ? 'They owe you' : 'You owe them') : pending < -0.01 ? (inbound ? 'They are in credit' : 'You have paid ahead') : 'Nothing pending'}
              </Text>
              <Text style={{ fontFamily: fonts.uiExtra, fontSize: 15, color: pending > 0.01 ? colors.danger : colors.good }}>{money(Math.abs(pending))}</Text>
            </View>
          ) : null}
        </RowGroup>

        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.soft, marginBottom: -4, paddingHorizontal: 4 }}>{inbound ? 'Paid into' : 'Paid from'}</Text>
        <AccountTiles accounts={db.accounts || []} value={accountId} onChange={setAccountId} tone={tone} />

        <NoteBox value={note} onChange={setNote} />

        {chosen && amt ? (
          <SumCard rows={[
            { l: inbound ? 'They owe now' : 'You owe now', v: money(Math.abs(pending)) },
            { l: inbound ? 'Receiving' : 'Paying', v: money(amt), tone },
            { l: left > 0.01 ? 'Still owing after' : left < -0.01 ? 'In credit after' : 'Settled', v: money(Math.abs(left)), bold: true, tone: left > 0.01 ? colors.danger : colors.good },
          ]} />
        ) : null}

        {openBills.length > 0 && inbound ? (
          <InfoBanner tone="accent" text={openBills.length + ' unpaid bill' + (openBills.length === 1 ? '' : 's') + ' — you will choose which the money settles.'} />
        ) : null}
      </ScrollView>

      {who.sheet}

      <CustomerPickerSheet
        kind={inbound ? 'customer' : 'supplier'}
        visible={picking}
        customers={parties}
        selectedId={partyId}
        balanceOf={partyBalance}
        money={money}
        onSelect={(id) => { if (id) setPartyId(id); }}
        onCreate={() => { setPicking(false); setCreating(true); }}
        onClose={() => setPicking(false)}
      />
      <CustomerFormSheet
        kind={inbound ? 'customer' : 'supplier'}
        visible={creating}
        onClose={() => setCreating(false)}
        onSave={(p) => { const made = addParty(p); setPartyId(made.id); setCreating(false); }}
      />

      <StickyBar>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint }}>{inbound ? 'Receiving' : 'Paying out'}</Text>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: tone }}>{money(amt)}</Text>
        </View>
        <Button
          label={inbound ? 'Record receipt' : 'Record payment'}
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
