/**
 * THE IMEIs OF THE PHONES ON A SALE LINE.
 *
 * One slot per unit sold. Each slot takes an IMEI from the phones in stock (a
 * tap), typed, or scanned off the box with the camera. What the stock already
 * knows about that phone — its second IMEI, whether it is new or used — fills
 * in by itself; anything it does not know is asked here, so the receipt and
 * any warranty claim name the exact handset.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView } from 'react-native';
import { Pressable } from './Press';
import { Sheet } from './Sheet';
import { Button, Field } from './ui';
import { Icon } from './icons';
import BarcodeScannerModal from './BarcodeScannerModal';
import { conditionLabel } from './SerialEditor';
import { useTheme, fonts, radius } from '../theme';
import type { Product, SoldSerial } from '../data/types';

export default function ImeiSheet({ visible, product, qty, value, taken, onClose, onDone }: {
  visible: boolean;
  product: Product | null;
  qty: number;
  value: SoldSerial[];
  /** IMEIs already on other lines of this bill. */
  taken: string[];
  onClose: () => void;
  onDone: (serials: SoldSerial[]) => void;
}) {
  const { colors } = useTheme();
  const [slots, setSlots] = useState<SoldSerial[]>([]);
  const [scanFor, setScanFor] = useState<{ i: number; which: 1 | 2 } | null>(null);
  const [err, setErr] = useState('');
  const n = Math.max(1, Math.floor(qty));

  useEffect(() => {
    if (!visible) return;
    setErr('');
    setSlots(Array.from({ length: n }, (_, i) => value[i] || { imei: '' }));
  }, [visible, n]);

  const clean = (s: string) => s.replace(/\s+/g, '').toUpperCase();
  const info = product?.serialInfo || {};
  const inStock = useMemo(() => {
    const used = new Set([...taken, ...slots.map((s) => s.imei)].map((x) => x.toUpperCase()).filter(Boolean));
    return (product?.serials || []).filter((s) => !used.has(s.toUpperCase()));
  }, [product, taken, slots]);

  if (!product) return null;
  const dual = !!product.dualImei;
  const ask = !!product.askCondition;

  /** Sets a slot's IMEI 1, and fills in what stock knows about that phone. */
  function setImei(i: number, raw: string) {
    const imei = clean(raw);
    const known = Object.keys(info).find((k) => k.toUpperCase() === imei);
    const x = known ? info[known] : undefined;
    setSlots((prev) => prev.map((s, j) => (j === i ? {
      imei, imei2: x?.imei2 ?? (s.imei === imei ? s.imei2 : undefined), condition: x?.condition ?? s.condition,
    } : s)));
  }
  const patch = (i: number, p: Partial<SoldSerial>) => setSlots((prev) => prev.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const firstEmpty = slots.findIndex((s) => !s.imei);

  function done() {
    const seen = new Set<string>();
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s.imei) return setErr('Enter the IMEI of phone ' + (i + 1) + '.');
      if (dual && !s.imei2) return setErr('Phone ' + (i + 1) + ' is dual SIM: enter its second IMEI too.');
      if (ask && !s.condition) return setErr('Say whether phone ' + (i + 1) + ' is new or used.');
      for (const x of [s.imei, s.imei2].filter(Boolean) as string[]) {
        if (seen.has(x) || taken.map((t) => t.toUpperCase()).includes(x)) return setErr(x + ' is on this sale twice.');
        seen.add(x);
      }
    }
    onDone(slots.map((s) => ({ imei: s.imei, ...(s.imei2 ? { imei2: s.imei2 } : null), ...(s.condition ? { condition: s.condition } : null) })));
  }

  const input = (i: number, which: 1 | 2) => {
    const s = slots[i];
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <Field
          label={dual ? 'IMEI ' + which : 'IMEI'}
          value={which === 1 ? s?.imei || '' : s?.imei2 || ''}
          onChangeText={(t) => (which === 1 ? setImei(i, t) : patch(i, { imei2: clean(t) }))}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder={which === 1 ? 'Type, scan or pick below' : 'Second IMEI'}
          style={{ flex: 1, marginBottom: 0 }}
        />
        <Pressable
          onPress={() => setScanFor({ i, which })}
          accessibilityLabel="Scan with the camera"
          style={({ pressed }) => ({
            width: 50, height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
            borderWidth: 1.4, borderColor: colors.accent, backgroundColor: pressed ? colors.accentSoft : colors.surface,
          })}
        >
          <Icon name="camera" size={20} color={colors.accent} />
        </Pressable>
      </View>
    );
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      icon="phone"
      title={'IMEI · ' + product.name}
      subtitle={n === 1 ? 'The phone being sold' : 'One for each of the ' + n + ' phones'}
      footer={<Button variant="pri" label="Save IMEI" onPress={done} />}
    >
      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }}>
        {slots.map((s, i) => (
          <View key={i} style={{ marginBottom: 14 }}>
            {n > 1 ? <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, letterSpacing: 0.6, color: colors.faint }}>PHONE {i + 1}</Text> : null}
            {input(i, 1)}
            {dual ? input(i, 2) : null}
            {ask ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                {(['new', 'used'] as const).map((c) => {
                  const on = s?.condition === c;
                  return (
                    <Pressable key={c} onPress={() => patch(i, { condition: c })} style={{
                      flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, borderWidth: 1.4,
                      borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accentSoft : colors.surface,
                    }}>
                      <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: on ? colors.accent : colors.soft }}>{conditionLabel(c)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        ))}

        {inStock.length ? (
          <>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, letterSpacing: 0.6, color: colors.faint, marginBottom: 8 }}>IN STOCK · TAP TO USE</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {inStock.slice(0, 40).map((sn) => {
                const x = info[sn];
                return (
                  <Pressable
                    key={sn}
                    onPress={() => setImei(firstEmpty >= 0 ? firstEmpty : slots.length - 1, sn)}
                    style={({ pressed }) => ({
                      paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1.2,
                      borderColor: colors.line, backgroundColor: pressed ? colors.accentSoft : colors.surface,
                    })}
                  >
                    <Text style={{ fontFamily: fonts.monoSemi, fontSize: 12.5, color: colors.ink }}>
                      {sn}{x?.condition ? '  ·  ' + conditionLabel(x.condition) : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {err ? <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.danger, marginTop: 12 }}>{err}</Text> : null}
      </ScrollView>

      <BarcodeScannerModal
        visible={scanFor !== null}
        onClose={() => setScanFor(null)}
        onScan={(code) => {
          if (scanFor) { if (scanFor.which === 1) setImei(scanFor.i, code); else patch(scanFor.i, { imei2: clean(code) }); }
          setScanFor(null);
        }}
      />
    </Sheet>
  );
}
