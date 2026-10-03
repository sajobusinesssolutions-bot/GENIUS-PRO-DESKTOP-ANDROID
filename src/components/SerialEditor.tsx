/**
 * IMEI / serial number entry.
 *
 * Units arrive off a box one after another, so the first field never loses
 * focus: type or scan, press enter, and it clears itself for the next. A
 * dual-SIM phone has a second IMEI, entered beside the first, and a shop that
 * sells used phones marks each unit New or Used. Either IMEI can be scanned
 * off the box with the camera. Duplicates are refused as you type, because a
 * repeated IMEI is always a mistake and is painful to unpick once it is sold.
 */
import React, { useRef, useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { Pressable } from './Press';
import { useTheme, fonts, radius } from '../theme';
import { Button, SectionLabel, InfoBanner, EmptyBlock, Panel, Field } from './ui';
import { Icon } from './icons';
import BarcodeScannerModal from './BarcodeScannerModal';
import type { ItemCondition, SerialInfo } from '../data/types';

export const conditionLabel = (c?: ItemCondition) => (c === 'used' ? 'Used' : c === 'new' ? 'New' : '');

export default function SerialEditor({ serials, onChange, info = {}, onInfoChange, dual, askCondition, expected }: {
  serials: string[];
  onChange: (next: string[]) => void;
  /** IMEI 2 and condition per unit, keyed by IMEI 1. */
  info?: Record<string, SerialInfo>;
  onInfoChange?: (next: Record<string, SerialInfo>) => void;
  /** Dual-SIM phones: ask for a second IMEI. */
  dual?: boolean;
  /** Ask New or Used for each unit. */
  askCondition?: boolean;
  /** How many the stock count says there should be, when that is known. */
  expected?: number;
}) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState('');
  const [draft2, setDraft2] = useState('');
  const [condition, setCondition] = useState<ItemCondition>('new');
  const [scanInto, setScanInto] = useState<1 | 2 | null>(null);
  const inputRef = useRef<TextInput>(null);
  const input2Ref = useRef<TextInput>(null);

  const clean = (s: string) => s.replace(/\s+/g, '').toUpperCase();
  const t1 = clean(draft);
  const t2 = clean(draft2);
  const all = new Set<string>();
  serials.forEach((s) => { all.add(s.toUpperCase()); const i2 = info[s]?.imei2; if (i2) all.add(i2.toUpperCase()); });
  const dup1 = !!t1 && all.has(t1);
  const dup2 = !!t2 && (all.has(t2) || t2 === t1);
  const ready = !!t1 && !dup1 && !dup2 && (!dual || !!t2);

  function add() {
    if (!ready) {
      if (t1 && !dup1 && dual && !t2) input2Ref.current?.focus();
      return;
    }
    onChange([...serials, t1]);
    const extra: SerialInfo = {};
    if (dual && t2) extra.imei2 = t2;
    if (askCondition) extra.condition = condition;
    if (Object.keys(extra).length && onInfoChange) onInfoChange({ ...info, [t1]: extra });
    setDraft(''); setDraft2('');
    inputRef.current?.focus();
  }

  function remove(i: number) {
    const sn = serials[i];
    onChange(serials.filter((_, idx) => idx !== i));
    if (onInfoChange && info[sn]) { const next = { ...info }; delete next[sn]; onInfoChange(next); }
  }

  const short = expected !== undefined ? expected - serials.length : null;

  const field = (n: 1 | 2) => {
    const bad = n === 1 ? dup1 : dup2;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Field
          label={dual ? 'IMEI ' + n : 'IMEI'}
          inputRef={n === 1 ? inputRef : input2Ref}
          value={n === 1 ? draft : draft2}
          onChangeText={n === 1 ? setDraft : setDraft2}
          onSubmitEditing={() => (n === 1 && dual ? input2Ref.current?.focus() : add())}
          keepFocus
          returnKeyType={n === 1 && dual ? 'next' : 'done'}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder={n === 1 ? 'Type or scan' : 'Second IMEI'}
          error={bad ? ' ' : undefined}
          style={{ flex: 1, marginBottom: 0 }}
        />
        <Pressable
          onPress={() => setScanInto(n)}
          accessibilityLabel={'Scan IMEI ' + n + ' with the camera'}
          style={({ pressed }) => ({
            width: 54, height: 54, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
            borderWidth: 1.4, borderColor: colors.accent, backgroundColor: pressed ? colors.accentSoft : colors.surface,
          })}
        >
          <Icon name="camera" size={21} color={colors.accent} />
        </Pressable>
      </View>
    );
  };

  return (
    <View>
      <SectionLabel right={
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.ink }}>
          {serials.length}{expected !== undefined ? ' / ' + expected : ''}
        </Text>
      }>
        {dual ? 'Phones in stock' : 'IMEI / serial numbers'}
      </SectionLabel>

      {field(1)}
      {dual ? field(2) : null}

      {askCondition ? (
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
          {(['new', 'used'] as const).map((c) => {
            const on = condition === c;
            return (
              <Pressable
                key={c}
                onPress={() => setCondition(c)}
                style={{
                  flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, borderWidth: 1.4,
                  borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accentSoft : colors.surface,
                }}
              >
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: on ? colors.accent : colors.soft }}>{conditionLabel(c)}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Button
        variant="pri"
        label={dual ? 'Add this phone' : 'Add'}
        icon={<Icon name="plus" size={17} color={colors.accentInk} />}
        disabled={!ready}
        onPress={add}
      />
      <View style={{ height: 12 }} />

      {dup1 || dup2 ? (
        <View style={{ marginBottom: 12 }}>
          <InfoBanner tone="danger" text={(dup1 ? t1 : t2) + ' has already been entered.'} />
        </View>
      ) : null}
      {short !== null && short > 0 ? (
        <View style={{ marginBottom: 12 }}>
          <InfoBanner tone="warn" text={short + ' more to enter to match the quantity on hand.'} />
        </View>
      ) : null}
      {short !== null && short < 0 ? (
        <View style={{ marginBottom: 12 }}>
          <InfoBanner tone="danger" text={Math.abs(short) + ' more than there is stock — one of the two is wrong.'} />
        </View>
      ) : null}

      {!serials.length ? (
        <Panel style={{ marginBottom: 12 }}>
          <EmptyBlock
            icon="tag"
            title="None entered yet"
            hint="One per unit. Each is unique, so a warranty claim can be traced back to the exact phone sold."
          />
        </Panel>
      ) : (
        <View style={{ gap: 8, marginBottom: 12 }}>
          {serials.map((sn, i) => {
            const x = info[sn] || {};
            return (
              <View key={sn + i} style={{
                flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, borderWidth: 1.2,
                borderColor: colors.line, backgroundColor: colors.surface, paddingVertical: 10, paddingHorizontal: 12,
              }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontFamily: fonts.monoSemi, fontSize: 12.5, color: colors.ink }}>{sn}</Text>
                  {x.imei2 ? <Text style={{ fontFamily: fonts.mono, fontSize: 12.5, color: colors.soft, marginTop: 2 }}>{x.imei2}</Text> : null}
                </View>
                {x.condition ? (
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: x.condition === 'used' ? colors.warn : colors.good }}>{conditionLabel(x.condition)}</Text>
                ) : null}
                <Pressable onPress={() => remove(i)} hitSlop={8} style={{ padding: 2 }}>
                  <Icon name="x" size={16} color={colors.danger} />
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      {serials.length ? (
        <Button
          label="Clear all"
          variant="dngr"
          icon={<Icon name="trash" size={16} color={colors.danger} />}
          onPress={() => { onChange([]); onInfoChange?.({}); }}
        />
      ) : null}

      <BarcodeScannerModal
        visible={scanInto !== null}
        onClose={() => setScanInto(null)}
        onScan={(code) => {
          const c = clean(code);
          if (scanInto === 2) setDraft2(c); else setDraft(c);
          setScanInto(null);
          setTimeout(() => (scanInto === 1 && dual ? input2Ref.current?.focus() : inputRef.current?.focus()), 250);
        }}
      />
    </View>
  );
}
