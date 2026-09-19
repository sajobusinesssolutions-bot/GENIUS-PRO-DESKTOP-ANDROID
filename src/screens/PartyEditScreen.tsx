import React, { useState } from 'react';
import { View, ScrollView } from 'react-native';
import { useTheme } from '../theme';
import { useAppData } from '../data/AppDataContext';
import {
  Button, Field, SegPill, StatGrid, SectionLabel, StickyBar, ListRow, Panel,
} from '../components/ui';
import { Icon } from '../components/icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PartyEdit'>;

const num = (v: string) => Number(String(v).replace(/[^0-9.-]/g, '')) || 0;

export default function PartyEditScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const { party, partyBalance, updateParty, addParty, money } = useAppData();
  const existing = route.params?.partyId ? party(route.params.partyId) : undefined;

  const [name, setName] = useState(existing?.name || '');
  const [phone, setPhone] = useState(existing?.phone || '');
  const [email, setEmail] = useState(existing?.email || '');
  const [address, setAddress] = useState(existing?.address || '');
  const [gstin, setGstin] = useState(existing?.gstin || '');
  const [type, setType] = useState<'customer' | 'supplier'>(existing?.type || 'customer');
  const [openingBalance, setOpeningBalance] = useState(String(existing?.openingBalance ?? ''));
  const [creditLimit, setCreditLimit] = useState(String(existing?.creditLimit ?? ''));

  function save() {
    const patch = {
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
      address: address.trim(),
      gstin: gstin.trim(),
      type,
      openingBalance: num(openingBalance),
      creditLimit: num(creditLimit),
    };
    if (existing) updateParty(existing.id, patch);
    else addParty({ ...patch, points: 0, active: true });
    navigation.goBack();
  }

  const balance = existing ? partyBalance(existing.id) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 130 }} keyboardShouldPersistTaps="handled">
        {existing ? (
          <>
            <StatGrid
              items={[
                {
                  icon: balance > 0 ? 'alert' : 'check',
                  label: balance > 0 ? 'Owes you' : balance < 0 ? 'In credit' : 'Settled',
                  value: money(Math.abs(balance)),
                  tone: balance > 0 ? 'danger' : 'good',
                },
                { icon: 'gift', label: 'Loyalty points', value: String(existing.points), tone: 'accent' },
              ]}
            />
            <View style={{ height: 16 }} />
            <Panel flush>
              <ListRow
                icon="doc"
                title="View ledger"
                subtitle="Every bill, payment and adjustment"
                onPress={() => navigation.navigate('PartyLedger', { partyId: existing.id })}
                last
              />
            </Panel>
            <View style={{ height: 20 }} />
          </>
        ) : null}

        <SectionLabel>Contact type</SectionLabel>
        <SegPill
          value={type}
          onChange={setType}
          tone="accent"
          options={[
            { v: 'customer', l: 'Customer', i: 'user' },
            { v: 'supplier', l: 'Supplier', i: 'factory' },
          ]}
        />

        <View style={{ height: 20 }} />
        <SectionLabel>Details</SectionLabel>
        <Field icon="user" label="Name" value={name} onChangeText={setName} placeholder="Required" />
        <Field icon="phone" label="Phone" value={phone} onChangeText={setPhone} placeholder="Optional" />
        <Field icon="doc" label="Email" value={email} onChangeText={setEmail} placeholder="Optional" />
        <Field icon="home" label="Address" value={address} onChangeText={setAddress} placeholder="Street, city" multiline />
        <Field icon="bank" label="Tax / TIN number" value={gstin} onChangeText={setGstin} placeholder="Optional" />

        <View style={{ height: 8 }} />
        <SectionLabel>Balances</SectionLabel>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Field label="Opening balance" value={openingBalance} onChangeText={setOpeningBalance} numeric placeholder="0" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Credit limit" value={creditLimit} onChangeText={setCreditLimit} numeric placeholder="0" />
          </View>
        </View>
      </ScrollView>

      <StickyBar>
        <Button
          label={existing ? 'Save changes' : 'Add contact'}
          variant="pri"
          disabled={!name.trim()}
          icon={<Icon name="check" size={17} color={colors.accentInk} />}
          onPress={save}
        />
      </StickyBar>
    </View>
  );
}
