import React, { useMemo, useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { Pressable } from './Press';
import { useTheme, fonts } from '../theme';
import { Button } from './ui';
import { Icon } from './icons';
import Sheet from './Sheet';
import type { Party } from '../data/types';

import { Field as FloatField } from './form';
function Field({ label, value, onChangeText, placeholder, keyboardType, multiline }: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder?: string;
  keyboardType?: 'default' | 'phone-pad' | 'numeric' | 'email-address'; multiline?: boolean;
}) {
  return (
    <FloatField
      label={label} value={value} onChangeText={onChangeText} placeholder={placeholder}
      multiline={multiline} numeric={keyboardType === 'numeric'}
      keyboard={keyboardType === 'phone-pad' || keyboardType === 'email-address' ? keyboardType : undefined}
      style={{ marginBottom: 0 }}
    />
  );
}

export function CustomerPickerSheet({ visible, customers, selectedId, onSelect, onCreate, onClose, kind = 'customer' }: {
  visible: boolean; customers: Party[]; selectedId: string | null;
  onSelect: (id: string | null) => void; onCreate: () => void; onClose: () => void;
  /** The same sheet picks a supplier on a purchase — there is no walk-in supplier. */
  kind?: 'customer' | 'supplier';
}) {
  const { colors } = useTheme();
  const [search, setSearch] = useState('');

  const list = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return customers.filter((c) => !needle || c.name.toLowerCase().includes(needle) || (c.phone || '').includes(needle));
  }, [customers, search]);

  return (
    <Sheet
      visible={visible}
      title={'Choose ' + kind}
      onClose={onClose}
      full
      footer={<Button label={'Create new ' + kind} variant="pri" icon={<Icon name="plus" size={16} color={colors.accentInk} />} onPress={onCreate} />}
    >
      <FloatField
        icon="search"
        label="Search by name or phone"
        value={search}
        onChangeText={setSearch}
        autoCorrect={false}
        style={{ marginBottom: 12 }}
        trailing={search ? <Pressable onPress={() => setSearch('')} hitSlop={8}><Icon name="x" size={16} color={colors.faint} /></Pressable> : null}
      />

      {kind === 'customer' ? <Pressable
        onPress={() => { onSelect(null); onClose(); }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line }}
      >
        <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="user" size={16} color={colors.faint} />
        </View>
        <Text style={{ flex: 1, color: colors.soft, fontFamily: fonts.uiSemi, fontSize: 15 }}>Walk-in customer</Text>
        {!selectedId ? <Icon name="check" size={17} color={colors.good} /> : null}
      </Pressable> : null}

      {list.map((c) => (
        <Pressable
          key={c.id}
          onPress={() => { onSelect(c.id); onClose(); }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line }}
        >
          <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colors.accent, fontFamily: fonts.uiBold, fontSize: 15 }}>{c.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: colors.ink, fontFamily: fonts.uiSemi, fontSize: 15 }}>{c.name}</Text>
            <Text numberOfLines={1} style={{ color: colors.faint, fontFamily: fonts.ui, fontSize: 12.5, marginTop: 2 }}>
              {c.phone || 'No phone'}{c.address ? ' · ' + c.address : ''}
            </Text>
          </View>
          {selectedId === c.id ? <Icon name="check" size={17} color={colors.good} /> : null}
        </Pressable>
      ))}

      {!list.length && (
        <Text style={{ paddingVertical: 24, textAlign: 'center', color: colors.faint, fontFamily: fonts.ui, fontSize: 12.5 }}>
          {customers.length ? 'No ' + kind + ' matches that search.' : 'No ' + kind + 's yet. Create the first one below.'}
        </Text>
      )}
    </Sheet>
  );
}

export function CustomerFormSheet({ visible, onClose, onSave, kind = 'customer' }: {
  visible: boolean; onClose: () => void; onSave: (p: Omit<Party, 'id'>) => void;
  kind?: 'customer' | 'supplier';
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [balance, setBalance] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [gstin, setGstin] = useState('');

  function reset() {
    setName(''); setPhone(''); setEmail(''); setAddress(''); setBalance(''); setCreditLimit(''); setGstin('');
  }

  function save() {
    onSave({
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
      address: address.trim(),
      gstin: gstin.trim(),
      type: kind,
      openingBalance: Number(balance) || 0,
      creditLimit: Number(creditLimit) || 0,
      points: 0,
      active: true,
    });
    reset();
  }

  return (
    <Sheet
      visible={visible}
      title={'New ' + kind}
      onClose={() => { reset(); onClose(); }}
      full
      footer={<Button label={'Save ' + kind} variant="pri" disabled={!name.trim()} onPress={save} />}
    >
      <View style={{ gap: 14 }}>
        <Field label={kind === 'supplier' ? 'Supplier name' : 'Customer name'} value={name} onChangeText={setName} placeholder="Required" />
        <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="Optional" keyboardType="phone-pad" />
        <Field label="Email" value={email} onChangeText={setEmail} placeholder="Optional" keyboardType="email-address" />
        <Field label="Billing address" value={address} onChangeText={setAddress} placeholder="Street, city" multiline />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Field label="Opening balance" value={balance} onChangeText={setBalance} placeholder="0" keyboardType="numeric" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Credit limit" value={creditLimit} onChangeText={setCreditLimit} placeholder="0" keyboardType="numeric" />
          </View>
        </View>
        <Field label="Tax / TIN number" value={gstin} onChangeText={setGstin} placeholder="Optional" />
      </View>
    </Sheet>
  );
}
