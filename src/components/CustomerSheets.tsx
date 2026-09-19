import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { useTheme, fonts } from '../theme';
import { Button } from './ui';
import { Icon } from './icons';
import Sheet from './Sheet';
import type { Party } from '../data/types';

function Field({ label, value, onChangeText, placeholder, keyboardType, multiline, prefix }: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder?: string;
  keyboardType?: 'default' | 'phone-pad' | 'numeric' | 'email-address'; multiline?: boolean; prefix?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: colors.faint, letterSpacing: 0.3 }}>{label.toUpperCase()}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.sunk, borderRadius: 12, borderWidth: 1, borderColor: colors.lineHard, paddingHorizontal: 12 }}>
        {prefix ? <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.faint, marginRight: 6 }}>{prefix}</Text> : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.faint}
          keyboardType={keyboardType}
          multiline={multiline}
          style={{ flex: 1, paddingVertical: multiline ? 10 : 12, minHeight: multiline ? 66 : undefined, textAlignVertical: multiline ? 'top' : 'center', color: colors.ink, fontFamily: fonts.uiSemi, fontSize: 14.5 }}
        />
      </View>
    </View>
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
      footer={<Button label={'Create new ' + kind} variant="pri" icon={<Icon name="plus" size={16} color={colors.accentInk} />} onPress={onCreate} />}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.sunk, borderRadius: 12, borderWidth: 1, borderColor: colors.lineHard, paddingHorizontal: 12, marginBottom: 12 }}>
        <Icon name="search" size={16} color={colors.faint} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name or phone"
          placeholderTextColor={colors.faint}
          style={{ flex: 1, paddingVertical: 11, color: colors.ink, fontFamily: fonts.uiSemi, fontSize: 14 }}
        />
      </View>

      {kind === 'customer' ? <Pressable
        onPress={() => { onSelect(null); onClose(); }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line }}
      >
        <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="user" size={16} color={colors.faint} />
        </View>
        <Text style={{ flex: 1, color: colors.soft, fontFamily: fonts.uiSemi, fontSize: 14 }}>Walk-in customer</Text>
        {!selectedId ? <Icon name="check" size={17} color={colors.good} /> : null}
      </Pressable> : null}

      {list.map((c) => (
        <Pressable
          key={c.id}
          onPress={() => { onSelect(c.id); onClose(); }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line }}
        >
          <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colors.accent, fontFamily: fonts.uiBold, fontSize: 14 }}>{c.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: colors.ink, fontFamily: fonts.uiSemi, fontSize: 14 }}>{c.name}</Text>
            <Text numberOfLines={1} style={{ color: colors.faint, fontFamily: fonts.ui, fontSize: 11, marginTop: 2 }}>
              {c.phone || 'No phone'}{c.address ? ' · ' + c.address : ''}
            </Text>
          </View>
          {selectedId === c.id ? <Icon name="check" size={17} color={colors.good} /> : null}
        </Pressable>
      ))}

      {!list.length && (
        <Text style={{ paddingVertical: 24, textAlign: 'center', color: colors.faint, fontFamily: fonts.ui, fontSize: 13 }}>
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
