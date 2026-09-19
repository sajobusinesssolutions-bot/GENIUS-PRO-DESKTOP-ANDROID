import React, { useState } from 'react';
import { View, Text, Pressable, TextInput, FlatList } from 'react-native';
import { useTheme, fonts, spacing } from '../theme';
import { Button, Chip, Field, SectionLabel, DetailRow, InfoBanner, Panel } from './ui';
import { Icon } from './icons';
import { PayMethod, PaymentAllocation } from '../data/types';

export interface CheckoutSheetProps {
  total: number;
  money: (n: number) => string;
  method: PayMethod;
  onMethodChange: (m: PayMethod) => void;
  methods?: PaymentAllocation[];
  onMethodsChange?: (m: PaymentAllocation[]) => void;
  discount: number;
  onDiscountChange: (d: number) => void;
  additionalCharges: number;
  onAdditionalChargesChange: (n: number) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  terms: string;
  onTermsChange: (v: string) => void;
  partyId: string | null;
  onPartyChange: (id: string | null) => void;
  parties: Array<{ id: string; name: string }>;
  onCheckout: () => void;
  loading?: boolean;
  canCheckout: boolean;
  /** Part payment taken against a credit sale. */
  received?: number;
  onReceivedChange?: (n: number) => void;
}

export default function CheckoutSheet({
  total, money, method, onMethodChange, methods, onMethodsChange, discount, onDiscountChange,
  additionalCharges, onAdditionalChargesChange, description, onDescriptionChange, terms, onTermsChange,
  partyId, onPartyChange, parties, onCheckout, loading, canCheckout,
  received = 0, onReceivedChange,
}: CheckoutSheetProps) {
  const { colors } = useTheme();
  const [discountText, setDiscountText] = useState(String(discount));
  const [splitMode, setSplitMode] = useState(!!methods && methods.length > 1);
  const [splitMethods, setSplitMethods] = useState<PaymentAllocation[]>(methods || [{ method, amount: 0 }]);

  const netTotal = Math.max(0, total - discount) + Math.max(0, additionalCharges);
  const splitTotal = splitMethods.reduce((s, m) => s + m.amount, 0);
  const splitRemaining = Math.max(0, netTotal - splitTotal);
  const splitOver = Math.max(0, splitTotal - netTotal);
  const splitValid = !splitMode || Math.abs(splitTotal - netTotal) < 0.01;

  const toggleSplit = () => {
    if (splitMode) {
      // Exit split mode
      setSplitMode(false);
      onMethodsChange?.([]);
    } else {
      // Enter split mode
      setSplitMode(true);
      const next = [{ method, amount: Math.round(netTotal / 2) }, { method: 'cash' as PayMethod, amount: netTotal - Math.round(netTotal / 2) }];
      setSplitMethods(next);
      onMethodsChange?.(next);
    }
  };

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>Subtotal</Text>
          <Text style={{ fontFamily: fonts.monoSemi, fontSize: 13, color: colors.ink }}>{money(total)}</Text>
        </View>
        {discount > 0 && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>Discount</Text>
            <Text style={{ fontFamily: fonts.monoSemi, fontSize: 13, color: colors.accent }}>−{money(discount)}</Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.line }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: colors.ink }}>Total</Text>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }}>{money(netTotal)}</Text>
        </View>
      </View>

      <View>
        <Field
          icon="tag"
          label="Discount"
          value={discountText}
          numeric
          decimal
          placeholder="0"
          onChangeText={(v) => {
            setDiscountText(v);
            const d = parseFloat(v) || 0;
            onDiscountChange(Math.min(d, total));
          }}
          style={{ marginBottom: 0 }}
        />
        <View style={{ height: 14 }} />
        <Field
          icon="plus"
          label="Additional charges"
          value={String(additionalCharges || 0)}
          numeric
          decimal
          placeholder="0"
          onChangeText={(v) => onAdditionalChargesChange(Math.max(0, parseFloat(v) || 0))}
          style={{ marginBottom: 0 }}
        />
      </View>

      {/* part payment against a credit sale */}
      {method === 'credit' && onReceivedChange ? (
        <View>
          <SectionLabel>Received now</SectionLabel>
          <Field
            icon="cash"
            label="Amount received"
            value={received ? String(received) : ''}
            numeric
            decimal
            placeholder="0"
            onChangeText={(v) => onReceivedChange(Math.max(0, Math.min(netTotal, parseFloat(v) || 0)))}
            style={{ marginBottom: 10 }}
          />
          <View style={{ flexDirection: 'row', gap: 9, marginBottom: 12 }}>
            {[
              { l: 'Nothing', v: 0 },
              { l: 'Half', v: Math.round(netTotal / 2) },
              { l: 'Full', v: netTotal },
            ].map((q) => (
              <Pressable
                key={q.l}
                onPress={() => onReceivedChange(q.v)}
                style={{
                  flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12,
                  borderWidth: 1.4,
                  borderColor: received === q.v ? colors.accent : colors.line,
                  backgroundColor: received === q.v ? colors.accentSoft : colors.surface,
                }}
              >
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 13.5, color: received === q.v ? colors.accent : colors.soft }}>{q.l}</Text>
              </Pressable>
            ))}
          </View>
          <Panel>
            <DetailRow label="Bill total" value={money(netTotal)} />
            <DetailRow label="Received now" value={money(received)} tone={colors.good} />
            <DetailRow
              label="Balance on account"
              value={money(Math.max(0, netTotal - received))}
              bold
              tone={netTotal - received > 0 ? colors.danger : colors.good}
              last
            />
          </Panel>
          {netTotal - received > 0 ? (
            <View style={{ marginTop: 12 }}>
              <InfoBanner
                tone="warn"
                text={money(netTotal - received) + ' will be added to the customer\u2019s account as money owed.'}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {!splitMode ? (
        <View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11, color: colors.faint }}>Payment method</Text>
            <Pressable onPress={toggleSplit}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.accent }}>Split →</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            {(['cash', 'momo', 'bank', 'credit'] as PayMethod[]).map((m) => (
              <Pressable
                key={m}
                onPress={() => onMethodChange(m)}
                style={{
                  backgroundColor: m === method ? colors.accentSoft : colors.sunk,
                  borderWidth: 1,
                  borderColor: m === method ? colors.accent : colors.line,
                  borderRadius: 999,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                }}
              >
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: m === method ? colors.accent : colors.ink, textTransform: 'capitalize' }}>{m}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11, color: colors.faint }}>Split payment ({splitMethods.length} methods)</Text>
            <Pressable onPress={toggleSplit}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.accent }}>← Back</Text>
            </Pressable>
          </View>
          <View style={{ gap: spacing.sm }}>
            {splitMethods.map((m, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 10, color: colors.faint, marginBottom: 2, textTransform: 'capitalize' }}>{m.method}</Text>
                  <TextInput
                    value={String(m.amount || 0)}
                    onChangeText={(v) => {
                      const amt = parseFloat(v) || 0;
                      const next = splitMethods.map((x, j) => j === i ? { ...x, amount: Math.max(0, amt) } : x);
                      setSplitMethods(next);
                      onMethodsChange?.(next);
                    }}
                    keyboardType="decimal-pad"
                    style={{
                      height: 36, borderRadius: 8, borderWidth: 1, borderColor: colors.lineHard,
                      paddingHorizontal: spacing.sm, fontFamily: fonts.monoSemi, fontSize: 13,
                      backgroundColor: colors.sunk, color: colors.ink,
                    }}
                  />
                </View>
                {splitMethods.length > 1 && (
                  <Pressable
                    onPress={() => {
                      const next = splitMethods.filter((_, j) => j !== i);
                      setSplitMethods(next);
                      onMethodsChange?.(next);
                    }}
                    style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ fontFamily: fonts.uiBold, color: colors.danger }}>−</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
          {splitRemaining > 0 && (
            <View style={{ marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>Remaining: {money(splitRemaining)}</Text>
            </View>
          )}
          {splitOver > 0 && (
            <View style={{ marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.danger }}>Over by: {money(splitOver)}</Text>
            </View>
          )}
          <Pressable
            onPress={() => {
              const next = [...splitMethods, { method: 'cash' as PayMethod, amount: 0 }];
              setSplitMethods(next);
              onMethodsChange?.(next);
            }}
            style={{ marginTop: spacing.sm }}
          >
            <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.accent }}>+ Add method</Text>
          </Pressable>
        </View>
      )}

      {method === 'credit' && (
        <View>
          <SectionLabel>Customer</SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
            {parties.slice(0, 12).map((item) => (
              <Pressable
                key={item.id}
                onPress={() => onPartyChange(item.id)}
                style={{
                  backgroundColor: item.id === partyId ? colors.accentSoft : colors.surface,
                  borderWidth: 1.4,
                  borderColor: item.id === partyId ? colors.accent : colors.line,
                  borderRadius: 999,
                  paddingVertical: 10,
                  paddingHorizontal: 15,
                }}
              >
                <Text style={{ fontFamily: item.id === partyId ? fonts.uiBold : fonts.uiSemi, fontSize: 13.5, color: item.id === partyId ? colors.accent : colors.ink }}>
                  {item.name}
                </Text>
              </Pressable>
            ))}
            {!parties.length ? (
              <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint }}>No customers yet.</Text>
            ) : null}
          </View>
        </View>
      )}

      <View>
        <Field
          icon="doc"
          label="Description"
          value={description}
          onChangeText={onDescriptionChange}
          placeholder="Optional note for this sale"
          multiline
        />
        <Field
          icon="clock"
          label="Terms"
          value={terms}
          onChangeText={onTermsChange}
          placeholder="Payment terms, if any"
          style={{ marginBottom: 0 }}
        />
      </View>
    </View>
  );
}

/**
 * The commit button. It lives in the sheet's pinned footer rather than at the
 * end of the scroll, so it is reachable no matter how long the form runs.
 */
export function CheckoutButton({ label, onPress, disabled, loading }: {
  label: string; onPress: () => void; disabled?: boolean; loading?: boolean;
}) {
  return <Button label={label} variant="pri" onPress={onPress} disabled={disabled} loading={loading} />;
}
