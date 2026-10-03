import React, { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { Pressable } from './Press';
import { useTheme, fonts, radius } from '../theme';
import { Button, SegPill, SectionLabel, InfoBanner, Field, ProgressBar } from './ui';
import Sheet from './Sheet';
import { Icon } from './icons';
import { liveBatches, allocateFifo, expiryState, daysToExpiry, BatchPick } from '../data/batches';
import { ProductBatch } from '../data/types';

interface BatchPickerProps {
  visible: boolean;
  productName: string;
  batches: ProductBatch[];
  /** How many units the sale needs; FIFO uses it to pre-fill the split. */
  qty?: number;
  /** Called with every batch the line should draw from. */
  onConfirm?: (picks: BatchPick[]) => void;
  /** Kept for callers that still take a single batch. */
  onSelect?: (batch: ProductBatch) => void;
  onCancel: () => void;
}

function toneFor(state: ReturnType<typeof expiryState>) {
  return state === 'expired' ? 'danger' : state === 'critical' ? 'danger'
    : state === 'soon' ? 'warn' : 'good';
}

function expiryLabel(b: ProductBatch) {
  const d = daysToExpiry(b);
  if (d === null) return 'No expiry set';
  if (d < 0) return 'Expired ' + Math.abs(d) + 'd ago';
  if (d === 0) return 'Expires today';
  return d + ' days left';
}

/**
 * Picks the batches a sale line draws from. It opens on Auto — the batch that
 * expires soonest, already apportioned — and lets the operator switch to
 * Manual when they are holding a particular box.
 */
export default function BatchPicker({
  visible, productName, batches, qty = 1, onConfirm, onSelect, onCancel,
}: BatchPickerProps) {
  const { colors } = useTheme();
  const [mode, setMode] = useState<'fifo' | 'manual'>('fifo');
  const [manual, setManual] = useState<Record<string, number>>({});

  const product = useMemo(() => ({ batches } as any), [batches]);
  const live = useMemo(() => liveBatches(product), [product]);
  const fifo = useMemo(() => allocateFifo(product, qty), [product, qty]);

  // each time the sheet opens it starts on Auto, with nothing picked by hand
  React.useEffect(() => {
    if (visible) { setManual({}); setMode('fifo'); }
  }, [visible]);

  const manualTotal = Object.values(manual).reduce((s, n) => s + n, 0);
  const picks: BatchPick[] = mode === 'fifo'
    ? fifo.picks
    : live
      .filter((b) => (manual[b.no] || 0) > 0)
      .map((b) => ({ no: b.no, qty: manual[b.no], expiry: b.expiry }));

  const taken = mode === 'fifo' ? qty - fifo.shortfall : manualTotal;
  const ready = picks.length > 0 && taken === qty;
  const needColor = taken === qty ? colors.good : colors.warn;

  /** Sets one batch's share, kept between nothing and what that batch holds. */
  function setTake(b: ProductBatch, n: number) {
    setManual((prev) => ({ ...prev, [b.no]: Math.max(0, Math.min(b.qty, n)) }));
  }

  function confirm() {
    if (onConfirm) onConfirm(picks);
    else if (onSelect && picks[0]) {
      const b = live.find((x) => x.no === picks[0].no);
      if (b) onSelect(b);
    }
  }

  return (
    <Sheet
      visible={visible}
      title="Choose batch"
      subtitle={productName}
      icon="box"
      iconTone="warn"
      full
      onClose={onCancel}
      footer={
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Button label="Cancel" onPress={onCancel} /></View>
          <View style={{ flex: 2 }}>
            <Button
              label={ready ? 'Select' : taken + ' of ' + qty + ' picked'}
              variant="pri"
              disabled={!ready}
              onPress={confirm}
            />
          </View>
        </View>
      }
    >
      {!live.length ? (
        <InfoBanner tone="danger" text="This item has no batch in stock. Receive a purchase, or turn batch tracking off for it." />
      ) : (
        <>
          {/* how much is needed against how much the batches below cover */}
          <View style={{ borderRadius: radius.md, backgroundColor: colors.sunk, padding: 14, marginBottom: 14, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.faint }}>Quantity needed</Text>
              <Text style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: needColor }}>
                {taken}<Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.faint }}> / {qty}</Text>
              </Text>
            </View>
            <ProgressBar pct={qty > 0 ? (taken / qty) * 100 : 0} tone={needColor} />
          </View>

          <SegPill
            value={mode}
            onChange={setMode}
            tone="accent"
            options={[
              { v: 'fifo', l: 'Auto (FIFO)', i: 'clock' },
              { v: 'manual', l: 'Manual', i: 'tag' },
            ]}
          />
          <View style={{ height: 14 }} />

          {mode === 'fifo' ? (
            <>
              <InfoBanner
                tone={fifo.shortfall ? 'warn' : 'good'}
                icon={fifo.shortfall ? 'alert' : 'check'}
                text={fifo.shortfall
                  ? 'Only ' + (qty - fifo.shortfall) + ' of ' + qty + ' can be covered — ' + fifo.shortfall + ' short across every batch.'
                  : 'Takes from the batch that expires soonest first, so nothing goes bad on the shelf.'}
              />
              <View style={{ height: 14 }} />
              <SectionLabel>Batch list</SectionLabel>
              {live.map((b) => (
                <BatchRow key={b.no} batch={b} take={fifo.picks.find((p) => p.no === b.no)?.qty || 0} />
              ))}
            </>
          ) : (
            <>
              <SectionLabel right={
                <Pressable onPress={() => setManual({})} hitSlop={8}>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.accent }}>Clear</Text>
                </Pressable>
              }>
                Batch list
              </SectionLabel>
              {live.map((b) => {
                const n = manual[b.no] || 0;
                // the most this batch can take without going past what is needed
                const room = Math.min(b.qty, n + Math.max(0, qty - manualTotal));
                return (
                  <BatchRow key={b.no} batch={b} take={n} onPress={() => setTake(b, n > 0 ? 0 : room)}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
                      <StepBtn label="−" onPress={() => setTake(b, n - 1)} disabled={n <= 0} />
                      <Field
                        compact
                        numeric
                        decimal
                        label="Take"
                        value={String(n)}
                        onChangeText={(v) => setTake(b, Number(v.replace(/,/g, '')) || 0)}
                        style={{ flex: 1, marginBottom: 0, marginTop: 0 }}
                      />
                      <StepBtn label="+" onPress={() => setTake(b, n + 1)} disabled={n >= b.qty} />
                      <Pressable
                        onPress={() => setTake(b, room)}
                        disabled={room <= n}
                        style={{
                          height: 44, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                          backgroundColor: room > n ? colors.accent : colors.sunk,
                        }}
                      >
                        <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: room > n ? colors.accentInk : colors.faint }}>Fill</Text>
                      </Pressable>
                    </View>
                  </BatchRow>
                );
              })}
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

/** One batch: its number, how fresh it is, what is on hand and what this sale takes. */
function BatchRow({ batch, take, onPress, children }: {
  batch: ProductBatch; take: number; onPress?: () => void; children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const tone = toneFor(expiryState(batch));
  const fg = tone === 'danger' ? colors.danger : tone === 'warn' ? colors.warn : colors.good;
  const soft = tone === 'danger' ? colors.dangerSoft : tone === 'warn' ? colors.warnSoft : colors.goodSoft;
  const on = take > 0;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={{
        borderRadius: radius.md, borderWidth: 1.4, borderColor: on ? colors.accent : colors.line,
        backgroundColor: on ? colors.accentSoft : colors.surface,
        padding: 14, marginBottom: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: soft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="box" size={18} color={fg} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{batch.no}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: soft }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: fg }}>{expiryLabel(batch)}</Text>
            </View>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{batch.qty} on hand</Text>
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint }}>Take</Text>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: on ? colors.accent : colors.lineHard }}>{take}</Text>
        </View>
      </View>
      {children}
    </Pressable>
  );
}

function StepBtn({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        width: 44, height: 44, borderRadius: 12, borderWidth: 1.4, borderColor: colors.lineHard,
        alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 20, color: colors.ink }}>{label}</Text>
    </Pressable>
  );
}
