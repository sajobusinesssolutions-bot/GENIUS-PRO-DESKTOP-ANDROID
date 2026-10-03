import React, { useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Button, Card, Cap, KV } from '../components/ui';
import { Field, SelectField } from '../components/form';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PaymentDetail'>;

/**
 * A single receipt or payment — reference SCREENS.paymentDetail (18629):
 * the tinted amount card, the when / into / reference / taken by / note
 * block, then the actions. Edit is the inline form of SHEETS.editPayment
 * (17690) which reposts through repostPayment (17700); Delete is
 * A.deletePayment (17745) — reverse the journal, hand the money back to the
 * bills it settled, and log it.
 */
export default function PaymentDetailScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, party, account, editPayment, deletePayment, canEditPayment, can, logAudit } = useAppData();
  const pay = db?.payments.find((p) => p.id === route.params.paymentId);

  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(pay?.amount || ''));
  const [accountId, setAccountId] = useState(pay?.accountId || '');
  const [note, setNote] = useState(pay?.note || '');

  if (!pay) return null;
  const gate = canEditPayment(pay.id);
  const inbound = pay.direction === 'in';
  const pt = party(pay.partyId);
  /* the matrix has no finance.delete — finance.edit covers changing money (reference PERM_MATRIX, 7543) */
  const mayChange = can('finance.edit');

  function refuse(why: string) { Alert.alert('Cannot change this payment', why); }

  function onEdit() {
    if (!mayChange) return refuse('Your role cannot change a payment.');
    if (!gate.ok) return refuse(gate.why);
    setEditing(true);
  }

  function onSave() {
    const amt = Number(amount) || 0;
    if (amt <= 0) { Alert.alert('An amount is needed', 'Enter what actually changed hands.'); return; }
    const fresh = canEditPayment(pay!.id);
    if (!fresh.ok) { Alert.alert('Cannot change this payment', fresh.why); return; }
    Alert.alert(
      'Save the change?',
      'The old ' + (inbound ? 'receipt' : 'payment') + ' of ' + money(pay!.amount) + ' is reversed off the bills it settled, and ' + money(amt) + ' is posted in its place.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save', onPress: () => {
            const out = editPayment(pay!.id, { amount: amt, accountId, note });
            if (!out) { Alert.alert('Not saved', 'That payment could not be changed.'); return; }
            logAudit('Payment edited', money(pay!.amount) + ' to ' + money(amt) + ' — ' + (pt?.name || ''));
            setEditing(false);
          },
        },
      ],
    );
  }

  function onDelete() {
    if (!mayChange) return refuse('Your role cannot delete a payment.');
    if (!gate.ok) return refuse(gate.why);
    Alert.alert(
      'Delete this payment?',
      money(pay!.amount) + ' is reversed: ' + (pt?.name || 'their') + ' balance goes back up and the bills it settled reopen. The reversal stays in the audit log.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: () => {
            deletePayment(pay!.id, 'Deleted from the payment');
            logAudit('Payment deleted', money(pay!.amount) + ' — ' + (pt?.name || ''));
            navigation.goBack();
          },
        },
      ],
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 8 }}>
        <View style={{ padding: 16, borderRadius: 14, alignItems: 'center', backgroundColor: inbound ? colors.goodSoft : colors.dangerSoft }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, letterSpacing: 0.6, color: colors.faint }}>
            {(inbound ? 'RECEIVED FROM' : 'PAID TO')}
          </Text>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink, marginTop: 2 }}>{pt?.name || '—'}</Text>
          <Text style={{ fontFamily: fonts.monoSemi, fontSize: 26, color: colors.ink, marginTop: 6 }}>{money(pay.amount)}</Text>
        </View>

        <Card>
          <View style={{ padding: 12 }}>
            <KV label="When" value={new Date(pay.ts).toLocaleString()} />
            <KV label={inbound ? 'Into' : 'From'} value={account(pay.accountId)?.name || pay.accountId} />
            <KV label="Paid by" value={pay.method} />
            <KV label="Note" value={pay.note || '—'} />
            <KV label="Changed" value={pay.editedAt ? new Date(pay.editedAt).toLocaleString() : 'never'} last />
          </View>
        </Card>

        {/* the bills this payment settled, each one tappable */}
        {pay.allocations && pay.allocations.length ? (
          <>
            <Cap>{inbound ? 'Paid against these invoices' : 'Paid against these bills'}</Cap>
            <Card>
              <View style={{ padding: 12 }}>
                {pay.allocations.map((a, i, arr) => (
                  <Text
                    key={a.docId}
                    onPress={() => (inbound
                      ? navigation.navigate('SaleDetail', { saleId: a.docId } as any)
                      : navigation.navigate('PurchaseDetail', { purchaseId: a.docId } as any))}
                    style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.accent, paddingVertical: 7, borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderBottomColor: colors.line }}
                  >
                    {a.no}  ·  {money(a.amount)}
                  </Text>
                ))}
                {pay.unapplied ? (
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 6 }}>
                    {money(pay.unapplied)} not applied to a bill — held on the account as an advance.
                  </Text>
                ) : null}
              </View>
            </Card>
          </>
        ) : null}

        {editing && (
          <>
            <Cap>Change it</Cap>
            <Field label="Amount" value={amount} onChangeText={setAmount} numeric />
            <SelectField
              label={inbound ? 'Into' : 'Out of'}
              value={accountId}
              options={(db?.accounts || []).map((a) => ({ v: a.id, l: a.name }))}
              onChange={setAccountId}
            />
            <Field label="Note" value={note} onChangeText={setNote} />
          </>
        )}
      </ScrollView>

      <View style={{ padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface }}>
        {!gate.ok && <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{gate.why}</Text>}
        {editing ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Button label="Cancel" size="sm" onPress={() => setEditing(false)} /></View>
            <View style={{ flex: 1 }}><Button label="Save" size="sm" variant="pri" onPress={onSave} /></View>
          </View>
        ) : (
          <>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button label="Their account" size="sm" onPress={() => navigation.navigate('PartyLedger', { partyId: pay.partyId })} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Edit" size="sm" variant="pri" disabled={!gate.ok} onPress={onEdit} />
              </View>
            </View>
            <Button label="Delete this payment" size="sm" variant="dngr" disabled={!gate.ok} onPress={onDelete} />
          </>
        )}
      </View>
    </View>
  );
}
