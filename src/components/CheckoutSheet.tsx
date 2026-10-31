import React, { useState } from 'react';
import { View, Text, TextInput, FlatList } from 'react-native';
import { Pressable } from './Press';
import { useTheme, fonts, spacing } from '../theme';
import { Button, Chip, Field, SectionLabel, DetailRow, InfoBanner, Panel } from './ui';
import { SelectField } from './form';
import TermsPicker from './TermsPicker';
import { Icon } from './icons';
import { PayMethod, PaymentAllocation } from '../data/types';

export interface CheckoutSheetProps {
  total: number;
  /** The tax on the bill: added on top when taxAdded, otherwise already inside the prices. */
  tax?: number;
  taxAdded?: boolean;
  taxName?: string;
  /** Withholding tax the customer keeps back: off what they pay. */
  less?: number;
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
  termsId?: string | null;
  onTermsChoose?: (id: string | null, text: string) => void;
  /** Print the shop's payment details on this invoice; absent when the shop has none. */
  showPayment?: boolean;
  onShowPaymentChange?: (v: boolean) => void;
  partyId: string | null;
  onPartyChange: (id: string | null) => void;
  parties: Array<{ id: string; name: string }>;
  onCheckout: () => void;
  loading?: boolean;
  canCheckout: boolean;
  /** Part payment taken against a credit sale. */
  received?: number;
  onReceivedChange?: (n: number) => void;
  /** How the part taken against a credit sale was paid. */
  receivedVia?: 'cash' | 'momo' | 'bank';
  onReceivedViaChange?: (m: 'cash' | 'momo' | 'bank') => void;
  momoNetwork?: 'mtn' | 'airtel';
  onMomoNetworkChange?: (n: 'mtn' | 'airtel') => void;
  momoRef?: string;
  onMomoRefChange?: (v: string) => void;
}

export default function CheckoutSheet({
  total, tax = 0, taxAdded = false, taxName = 'Tax', less = 0, money, method, onMethodChange, methods, onMethodsChange, discount, onDiscountChange,
  additionalCharges, onAdditionalChargesChange, description, onDescriptionChange, terms, onTermsChange, termsId = null, onTermsChoose, showPayment, onShowPaymentChange,
  partyId, onPartyChange, parties, onCheckout, loading, canCheckout,
  received = 0, onReceivedChange, receivedVia = 'cash', onReceivedViaChange,
  momoNetwork = 'mtn', onMomoNetworkChange, momoRef = '', onMomoRefChange,
}: CheckoutSheetProps) {
  const { colors } = useTheme();
  const [discountText, setDiscountText] = useState(String(discount));
  const [splitMode, setSplitMode] = useState(!!methods && methods.length > 1);
  /** What the customer handed over on a cash sale, to work out the change. Not saved. */
  const [given, setGiven] = useState('');
  const [splitMethods, setSplitMethods] = useState<PaymentAllocation[]>(methods || [{ method, amount: 0 }]);

  const netTotal = Math.max(0, total - discount) + (taxAdded ? tax : 0) + Math.max(0, additionalCharges) - Math.max(0, less);
  // While the amount received is being typed, everything above it folds away,
  // so the box sits at the top of the sheet instead of under the keypad.
  const [typingReceived, setTypingReceived] = useState(false);
  const [typingAdditionalCharges, setTypingAdditionalCharges] = useState(false);
  const splitTotal = splitMethods.reduce((s, m) => s + m.amount, 0);
  const splitRemaining = Math.max(0, netTotal - splitTotal);
  const splitOver = Math.max(0, splitTotal - netTotal);
  const splitValid = !splitMode || Math.abs(splitTotal - netTotal) < 0.01;

  const additionalChargesField = (
    <Field
      icon="plus"
      label="Charges"
      value={String(additionalCharges || 0)}
      numeric
      decimal
      placeholder="0"
      onChangeText={(v) => onAdditionalChargesChange(Math.max(0, parseFloat(v) || 0))}
      onFocus={() => setTypingAdditionalCharges(true)}
      onBlur={() => setTypingAdditionalCharges(false)}
      style={{ marginBottom: 0 }}
    />
  );

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
      {typingReceived ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.ink }}>Credit sale · total</Text>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink }}>{money(netTotal)}</Text>
        </View>
      ) : (<>
      {/* the bill as it is worked out: subtotal, then the discount and charges typed straight under it, then tax, then the total */}
      <View style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>Subtotal</Text>
          <Text style={{ fontFamily: fonts.monoSemi, fontSize: 12.5, color: colors.ink }}>{money(total)}</Text>
        </View>
        {/* discount and charges are entered on the sale page, under its items; here they are only read */}
        {discount > 0 ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>Discount</Text>
            <Text style={{ fontFamily: fonts.monoSemi, fontSize: 12.5, color: colors.good }}>−{money(discount)}</Text>
          </View>
        ) : null}
        {additionalCharges > 0 ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>Charges</Text>
            <Text style={{ fontFamily: fonts.monoSemi, fontSize: 12.5, color: colors.ink }}>+{money(additionalCharges)}</Text>
          </View>
        ) : null}
        {tax > 0 && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{taxAdded ? taxName + ' added' : taxName + ' included'}</Text>
            <Text style={{ fontFamily: fonts.monoSemi, fontSize: 12.5, color: colors.ink }}>{taxAdded ? '+' : ''}{money(tax)}</Text>
          </View>
        )}
        {less > 0 ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>WHT kept back</Text>
            <Text style={{ fontFamily: fonts.monoSemi, fontSize: 12.5, color: colors.danger }}>−{money(less)}</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.line }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.ink }}>Total</Text>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink }}>{money(netTotal)}</Text>
        </View>
      </View>

      {/*
        Two separate questions. Is this bill paid now, or does it go on the
        customer's account? And, for whatever money changes hands, how was it
        paid? Credit used to be the fourth payment method, so choosing mobile
        money for a part-payment silently turned a credit sale into a paid one.
      */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        {[
          { v: 'now', l: 'Paid now', i: 'cash' as const },
          { v: 'credit', l: 'On credit', i: 'clock' as const },
        ].map((o) => {
          const on = o.v === 'credit' ? method === 'credit' : method !== 'credit';
          return (
            <Pressable
              key={o.v}
              onPress={() => onMethodChange(o.v === 'credit' ? 'credit' : (method === 'credit' ? 'cash' : method))}
              style={{
                flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
                height: 48, borderRadius: 4, borderWidth: 1.4,
                borderColor: on ? colors.accent : colors.line,
                backgroundColor: on ? colors.accent : colors.surface,
              }}
            >
              <Icon name={o.i} size={16} color={on ? colors.accentInk : colors.soft} />
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: on ? colors.accentInk : colors.soft }}>{o.l}</Text>
            </Pressable>
          );
        })}
      </View>
      </>)}

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
            onFocus={() => setTypingReceived(true)}
            onBlur={() => setTypingReceived(false)}
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
                  flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 4,
                  borderWidth: 1.4,
                  borderColor: received === q.v ? colors.accent : colors.line,
                  backgroundColor: received === q.v ? colors.accentSoft : colors.surface,
                }}
              >
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: received === q.v ? colors.accent : colors.soft }}>{q.l}</Text>
              </Pressable>
            ))}
          </View>
          <Panel>
            <DetailRow label="Sale total" value={money(netTotal)} />
            <DetailRow label="Received now" value={money(received)} tone={colors.good} />
            <DetailRow
              label="Balance on account"
              value={money(Math.max(0, netTotal - received))}
              bold
              tone={netTotal - received > 0 ? colors.danger : colors.good}
              last
            />
          </Panel>
          {received > 0 && onReceivedViaChange ? (
            <View style={{ marginTop: 14 }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginBottom: 8 }}>
                The {money(received)} was paid by
              </Text>
              <SelectField
                value={receivedVia}
                options={[{ v: 'cash', l: 'Cash' }, { v: 'momo', l: 'Mobile money' }, { v: 'bank', l: 'Bank' }]}
                onChange={(m) => onReceivedViaChange(m as 'cash' | 'momo' | 'bank')}
                icon="cash"
                style={{ marginBottom: 0 }}
              />
            </View>
          ) : null}
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

      {method === 'credit' ? null : !splitMode ? (
        <View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint }}>Payment method</Text>
            <Pressable onPress={toggleSplit}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.accent }}>Split →</Text>
            </Pressable>
          </View>
          <SelectField
            value={method}
            options={[{ v: 'cash', l: 'Cash' }, { v: 'momo', l: 'Mobile money' }, { v: 'bank', l: 'Bank' }]}
            onChange={(m) => onMethodChange(m as PayMethod)}
            icon="cash"
            style={{ marginBottom: 0 }}
          />
          {method === 'cash' ? (() => {
            const g = parseFloat(given) || 0;
            const change = g - netTotal;
            return (
              <View style={{ marginTop: 12 }}>
                <Field icon="cash" label="Amount given" value={given} onChangeText={setGiven} numeric decimal placeholder="What the customer hands over" style={{ marginBottom: 8 }} />
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                  {[netTotal, ...[1000, 5000, 10000, 20000, 50000].filter((n) => n > netTotal).slice(0, 3)].map((n, i) => (
                    <Pressable key={i} onPress={() => setGiven(String(n))}
                      style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 4, borderWidth: 1.2, borderColor: colors.line, backgroundColor: colors.surface }}>
                      <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: colors.ink }}>{i === 0 ? 'Exact' : money(n)}</Text>
                    </Pressable>
                  ))}
                </View>
                {g > 0 ? (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', padding: 12, borderRadius: 4,
                    backgroundColor: change >= 0 ? colors.goodSoft : colors.dangerSoft }}>
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: change >= 0 ? colors.good : colors.danger }}>{change >= 0 ? 'Change to give' : 'Still short'}</Text>
                    <Text style={{ fontFamily: fonts.uiExtra, fontSize: 22, color: change >= 0 ? colors.good : colors.danger }}>{money(Math.abs(change))}</Text>
                  </View>
                ) : null}
              </View>
            );
          })() : null}
          {(receivedVia === 'momo' || method === 'momo') && onMomoNetworkChange && onMomoRefChange ? (
            <View style={{ marginTop: 14 }}>
              <Panel>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginBottom: 8 }}>MoMo details</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                  {([
                    { value: 'mtn', label: 'MTN MoMo' },
                    { value: 'airtel', label: 'Airtel Money' },
                  ] as const).map((net) => (
                    <Pressable
                      key={net.value}
                      onPress={() => onMomoNetworkChange(net.value)}
                      style={{
                        flex: 1, alignItems: 'center', paddingVertical: 10,
                        borderRadius: 4, borderWidth: 1.4,
                        borderColor: momoNetwork === net.value ? colors.accent : colors.line,
                        backgroundColor: momoNetwork === net.value ? colors.accentSoft : colors.surface,
                      }}
                    >
                      <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: momoNetwork === net.value ? colors.accent : colors.ink }}>{net.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Field
                  icon="phone"
                  label="Transaction ID"
                  value={momoRef}
                  onChangeText={onMomoRefChange}
                  placeholder="e.g. 456789"
                  style={{ marginBottom: 0 }}
                />
              </Panel>
            </View>
          ) : null}
        </View>
      ) : (
        <View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint }}>Split payment ({splitMethods.length} methods)</Text>
            <Pressable onPress={toggleSplit}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.accent }}>← Back</Text>
            </Pressable>
          </View>
          <View style={{ gap: spacing.sm }}>
            {splitMethods.map((m, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Field
                    compact
                    style={{ marginBottom: 0 }}
                    label={m.method.charAt(0).toUpperCase() + m.method.slice(1)}
                    numeric
                    decimal
                    value={String(m.amount || 0)}
                    onChangeText={(v) => {
                      const amt = parseFloat(v) || 0;
                      const next = splitMethods.map((x, j) => j === i ? { ...x, amount: Math.max(0, amt) } : x);
                      setSplitMethods(next);
                      onMethodsChange?.(next);
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
                    style={{ width: 36, height: 36, borderRadius: 4, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ fontFamily: fonts.uiBold, color: colors.danger }}>−</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
          {splitRemaining > 0 && (
            <View style={{ marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>Remaining: {money(splitRemaining)}</Text>
            </View>
          )}
          {splitOver > 0 && (
            <View style={{ marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.danger }}>Over by: {money(splitOver)}</Text>
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
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.accent }}>+ Add method</Text>
          </Pressable>
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
        <TermsPicker value={terms} onChange={onTermsChange} chosenId={termsId} onChoose={(id, text) => (onTermsChoose ? onTermsChoose(id, text) : onTermsChange(text))} />
        {showPayment !== undefined && onShowPaymentChange ? (
          <Pressable onPress={() => onShowPaymentChange(!showPayment)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 }}>
            <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: showPayment ? colors.accent : colors.lineHard, backgroundColor: showPayment ? colors.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {showPayment ? <Icon name="check" size={13} color={colors.accentInk} /> : null}
            </View>
            <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 13, color: colors.ink }}>Print payment details on this invoice</Text>
          </Pressable>
        ) : null}
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
