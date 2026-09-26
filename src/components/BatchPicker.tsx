import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useTheme, fonts, radius } from '../theme';
import { Button, Badge, SegPill, SectionLabel, InfoBanner } from './ui';
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
 * Picks the batches a sale line draws from. It opens on FIFO — the batch that
 * expires soonest, already apportioned — and lets the operator switch to
 * choosing by hand when they are holding a particular box.
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

  const manualTotal = Object.values(manual).reduce((s, n) => s + n, 0);
  const picks: BatchPick[] = mode === 'fifo'
    ? fifo.picks
    : live
      .filter((b) => (manual[b.no] || 0) > 0)
      .map((b) => ({ no: b.no, qty: manual[b.no], expiry: b.expiry }));

  const taken = mode === 'fifo' ? qty - fifo.shortfall : manualTotal;
  const ready = picks.length > 0 && taken === qty;

  function bump(b: ProductBatch, by: number) {
    setManual((prev) => {
      const cur = prev[b.no] || 0;
      const next = Math.max(0, Math.min(b.qty, cur + by));
      return { ...prev, [b.no]: next };
    });
  }

  function confirm() {
    if (onConfirm) onConfirm(picks);
    else if (onSelect && picks[0]) {
      const b = live.find((x) => x.no === picks[0].no);
      if (b) onSelect(b);
    }
    setManual({});
    setMode('fifo');
  }

  function cancel() {
    setManual({});
    setMode('fifo');
    onCancel();
  }

  return (
    <Sheet
      visible={visible}
      title="Choose batch"
      subtitle={productName + ' · ' + qty + ' needed'}
      icon="box"
      iconTone="warn"
      full
      onClose={cancel}
      footer={
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Button label="Cancel" onPress={cancel} /></View>
          <View style={{ flex: 2 }}>
            <Button
              label={ready ? 'Use these batches' : taken + ' of ' + qty + ' picked'}
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
          <SegPill
            value={mode}
            onChange={setMode}
            tone="accent"
            options={[
              { v: 'fifo', l: 'Auto (FIFO)', i: 'clock' },
              { v: 'manual', l: 'Pick by hand', i: 'tag' },
            ]}
          />

          <View style={{ height: 16 }} />

          {mode === 'fifo' ? (
            <>
              <InfoBanner
                tone={fifo.shortfall ? 'warn' : 'good'}
                icon={fifo.shortfall ? 'alert' : 'check'}
                text={fifo.shortfall
                  ? 'Only ' + (qty - fifo.shortfall) + ' of ' + qty + ' can be covered — ' + fifo.shortfall + ' short across every batch.'
                  : 'Drawing from the batch that expires soonest, so nothing goes bad on the shelf.'}
              />
              <View style={{ height: 16 }} />
              <SectionLabel>Will draw from</SectionLabel>
              {fifo.picks.map((pick) => {
                const b = live.find((x) => x.no === pick.no)!;
                const state = expiryState(b);
                return (
                  <View
                    key={pick.no}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      borderRadius: radius.md, borderLeftWidth: 4,
                      borderLeftColor: state === 'expired' || state === 'critical' ? colors.danger : state === 'soon' ? colors.warn : colors.good,
                      backgroundColor: colors.sunk, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 10,
                    }}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>Batch {pick.no}</Text>
                      <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                        {expiryLabel(b)} · {b.qty} on hand
                      </Text>
                    </View>
                    <Badge label={'take ' + pick.qty} tone={toneFor(state) as any} />
                  </View>
                );
              })}
              {!fifo.picks.length ? (
                <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint }}>Nothing available to draw.</Text>
              ) : null}
            </>
          ) : (
            <>
              <SectionLabel right={
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: taken === qty ? colors.good : colors.warn }}>
                  {taken} / {qty}
                </Text>
              }>
                Take from each batch
              </SectionLabel>
              {live.map((b) => {
                const state = expiryState(b);
                const n = manual[b.no] || 0;
                return (
                  <View
                    key={b.no}
                    style={{
                      borderRadius: radius.md, borderLeftWidth: 4,
                      borderLeftColor: state === 'expired' || state === 'critical' ? colors.danger : state === 'soon' ? colors.warn : colors.good,
                      backgroundColor: n > 0 ? colors.accentSoft : colors.sunk,
                      paddingHorizontal: 14, paddingVertical: 13, marginBottom: 10, gap: 12,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>Batch {b.no}</Text>
                        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                          {expiryLabel(b)} · {b.qty} on hand
                        </Text>
                      </View>
                      <Badge
                        label={state === 'expired' ? 'Expired' : state === 'critical' ? 'Expiring' : state === 'soon' ? 'Use soon' : 'Fresh'}
                        tone={toneFor(state) as any}
                      />
                    </View>

                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <Pressable
                        onPress={() => bump(b, -1)}
                        style={{ width: 40, height: 40, borderRadius: 13, borderWidth: 1.4, borderColor: colors.lineHard, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }}
                      >
                        <Text style={{ fontFamily: fonts.uiBold, fontSize: 19, color: colors.ink }}>−</Text>
                      </Pressable>
                      <Text style={{ flex: 1, textAlign: 'center', fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink }}>{n}</Text>
                      <Pressable
                        onPress={() => bump(b, 1)}
                        style={{ width: 40, height: 40, borderRadius: 13, borderWidth: 1.4, borderColor: colors.lineHard, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }}
                      >
                        <Text style={{ fontFamily: fonts.uiBold, fontSize: 19, color: colors.ink }}>+</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setManual((prev) => {
                          const total = Object.values(prev).reduce((sum, value) => sum + value, 0);
                          const needed = Math.max(0, qty - total);
                          const fill = Math.min(b.qty, Math.max(0, needed));
                          return { ...prev, [b.no]: Math.min(b.qty, (prev[b.no] || 0) + fill) };
                        })}
                        style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 11, backgroundColor: colors.surface, borderWidth: 1.4, borderColor: colors.line }}
                      >
                        <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: colors.accent }}>Fill</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
