/**
 * Serial number entry.
 *
 * Serials arrive off a box one after another, so the field never loses focus:
 * type or scan, press enter, and it clears itself ready for the next. Duplicates
 * are refused as you type, because a repeated serial is always a mistake and is
 * painful to unpick once it is on a sale.
 */
import React, { useRef, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { useTheme, fonts, radius } from '../theme';
import { Button, Badge, SectionLabel, InfoBanner, EmptyBlock, Panel } from './ui';
import { Icon } from './icons';

export default function SerialEditor({ serials, onChange, onScan, expected }: {
  serials: string[];
  onChange: (next: string[]) => void;
  /** Opens the barcode scanner; the scanned code comes back through onChange. */
  onScan?: () => void;
  /** How many the stock count says there should be, when that is known. */
  expected?: number;
}) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<TextInput>(null);

  const trimmed = draft.trim().toUpperCase();
  const duplicate = !!trimmed && serials.some((s) => s.toUpperCase() === trimmed);

  function add() {
    if (!trimmed || duplicate) return;
    onChange([...serials, trimmed]);
    setDraft('');
    inputRef.current?.focus();
  }

  function remove(i: number) {
    onChange(serials.filter((_, idx) => idx !== i));
  }

  const short = expected !== undefined ? expected - serials.length : null;

  return (
    <View>
      <SectionLabel right={
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: colors.ink }}>
          {serials.length}{expected !== undefined ? ' / ' + expected : ''}
        </Text>
      }>
        Serial numbers
      </SectionLabel>

      {/* the entry row keeps focus so a box can be worked through in one go */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <View style={{
          flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 58,
          borderRadius: radius.md, borderWidth: 1.4,
          borderColor: duplicate ? colors.danger : colors.line,
          backgroundColor: colors.surface, paddingHorizontal: 14,
        }}>
          <Icon name="tag" size={19} color={duplicate ? colors.danger : colors.ink} />
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={add}
            blurOnSubmit={false}
            returnKeyType="next"
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="Type or scan a serial"
            placeholderTextColor={colors.faint}
            style={{ flex: 1, paddingVertical: 12, color: colors.ink, fontFamily: fonts.monoSemi, fontSize: 15 }}
          />
        </View>
        {onScan ? (
          <Pressable
            onPress={onScan}
            style={{
              width: 56, height: 58, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
              borderWidth: 1.4, borderColor: colors.line, backgroundColor: colors.surface,
            }}
          >
            <Icon name="box" size={21} color={colors.accent} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={add}
          disabled={!trimmed || duplicate}
          style={{
            width: 56, height: 58, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
            backgroundColor: !trimmed || duplicate ? colors.sunk : colors.accent,
          }}
        >
          <Icon name="plus" size={22} color={!trimmed || duplicate ? colors.faint : colors.accentInk} />
        </Pressable>
      </View>

      {duplicate ? (
        <View style={{ marginBottom: 12 }}>
          <InfoBanner tone="danger" text={'Serial ' + trimmed + ' has already been entered.'} />
        </View>
      ) : null}

      {short !== null && short > 0 ? (
        <View style={{ marginBottom: 12 }}>
          <InfoBanner tone="warn" text={short + ' more to enter to match the quantity on hand.'} />
        </View>
      ) : null}
      {short !== null && short < 0 ? (
        <View style={{ marginBottom: 12 }}>
          <InfoBanner tone="danger" text={Math.abs(short) + ' more serials than there is stock — one of the two is wrong.'} />
        </View>
      ) : null}

      {!serials.length ? (
        <Panel style={{ marginBottom: 12 }}>
          <EmptyBlock
            icon="tag"
            title="No serials yet"
            hint="Enter one per unit. Each is unique, so a warranty claim can be traced back to the exact piece sold."
          />
        </Panel>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 12 }}>
          {serials.map((sn, i) => (
            <View
              key={sn + i}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 8,
                borderRadius: radius.pill, borderWidth: 1.4, borderColor: colors.line,
                backgroundColor: colors.surface, paddingLeft: 14, paddingRight: 8, paddingVertical: 8,
              }}
            >
              <Text style={{ fontFamily: fonts.monoSemi, fontSize: 13.5, color: colors.ink }}>{sn}</Text>
              <Pressable onPress={() => remove(i)} hitSlop={8} style={{ padding: 2 }}>
                <Icon name="x" size={15} color={colors.danger} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {serials.length ? (
        <Button
          label="Clear all"
          variant="dngr"
          icon={<Icon name="trash" size={16} color={colors.danger} />}
          onPress={() => onChange([])}
        />
      ) : null}

      <View style={{ height: 12 }} />
      <InfoBanner
        tone="neutral"
        icon="bulb"
        text="A serialised item is sold one unit at a time, and the serial is stamped on the bill and on any warranty."
      />
    </View>
  );
}
