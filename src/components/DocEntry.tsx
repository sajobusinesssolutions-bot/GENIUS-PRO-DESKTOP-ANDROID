/**
 * The shared skeleton for raising a document — quotation, delivery note,
 * recurring schedule, instalment plan.
 *
 * They differ only in who they are for, what extra terms they carry and what
 * they post, so the party picker, the line editor, the totals and the sticky
 * commit bar live here once. The commit always passes through the "who is
 * recording this" prompt, so every document carries a name.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import {
  Button, Panel, SectionLabel, DetailRow, InfoBanner, StickyBar, SelectField, Badge, EmptyBlock,
} from './ui';
import { Icon, IconName } from './icons';
import { LineEditor, CartLine } from './LineEditor';
import { useWho, WhoResult } from './WhoSheet';

export interface DocEntryProps {
  /** What the document is, in the operator's words. */
  kind: string;
  icon: IconName;
  tone?: 'accent' | 'good' | 'warn';
  /** Who it is raised for. `none` hides the picker entirely. */
  partyType?: 'customer' | 'supplier' | 'none';
  partyLabel?: string;
  partyRequired?: boolean;
  partyId: string | null;
  onPartyChange: (id: string | null) => void;

  lines: CartLine[];
  onLinesChange: (l: CartLine[]) => void;
  /** Which price the lines are costed at — sale price, or supplier cost. */
  priceOf?: 'price' | 'cost';
  linesLabel?: string;

  /** Anything the document needs beyond lines — frequency, terms, dates. */
  children?: React.ReactNode;
  /** Shown under the totals; use for a schedule preview or a warning. */
  summary?: React.ReactNode;

  saveLabel: string;
  /** Extra reasons the document cannot be saved yet. */
  blockedReason?: string;
  askWho?: string;
  onSave: (who: WhoResult) => void;
  /** Hides the money column for documents that move goods, not money. */
  showTotals?: boolean;
}

export default function DocEntry({
  kind, icon, tone = 'accent',
  partyType = 'customer', partyLabel, partyRequired, partyId, onPartyChange,
  lines, onLinesChange, priceOf = 'price', linesLabel = 'Items',
  children, summary, saveLabel, blockedReason, askWho, onSave, showTotals = true,
}: DocEntryProps) {
  const { colors } = useTheme();
  const { db, money } = useAppData();
  const who = useWho(askWho || ('Who is raising this ' + kind.toLowerCase() + '?'));

  const parties = useMemo(
    () => (db?.parties || []).filter((p) => p.active && (partyType === 'none' || p.type === partyType)),
    [db, partyType],
  );

  const products = useMemo(() => (db?.products || []).filter((p) => p.active), [db]);
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const units = lines.reduce((s, l) => s + l.qty, 0);

  const missingParty = partyRequired && !partyId;
  const blocked = !lines.length || missingParty || !!blockedReason;

  const fg = tone === 'good' ? colors.good : tone === 'warn' ? colors.warn : colors.accent;
  const bg = tone === 'good' ? colors.goodSoft : tone === 'warn' ? colors.warnSoft : colors.accentSoft;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 170 }} keyboardShouldPersistTaps="handled">
        <Panel style={{ marginBottom: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
            <View style={{ width: 48, height: 48, borderRadius: 15, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={icon} size={22} color={fg} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: fonts.uiExtra, fontSize: 19, color: colors.ink }}>{kind}</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                {lines.length ? lines.length + ' line' + (lines.length === 1 ? '' : 's') + ' · ' + units + ' units' : 'Nothing added yet'}
              </Text>
            </View>
            {showTotals && total > 0 ? <Badge label={money(total)} tone={tone} /> : null}
          </View>
        </Panel>

        {partyType !== 'none' ? (
          <>
            <SectionLabel right={missingParty ? <Badge label="Required" tone="danger" /> : undefined}>
              {partyLabel || (partyType === 'supplier' ? 'Supplier' : 'Customer')}
            </SectionLabel>
            <SelectField
              icon={partyType === 'supplier' ? 'factory' : 'user'}
              label={partyLabel || (partyType === 'supplier' ? 'Supplier' : 'Customer')}
              value={partyId || ''}
              options={parties.map((p) => ({ v: p.id, l: p.name }))}
              onChange={onPartyChange}
              placeholder={partyRequired ? 'Required' : 'Optional — leave blank for walk-in'}
            />
          </>
        ) : null}

        {children}

        <View style={{ height: 8 }} />
        <SectionLabel right={
          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>
            {lines.length} line{lines.length === 1 ? '' : 's'}
          </Text>
        }>
          {linesLabel}
        </SectionLabel>
        <LineEditor
          products={products}
          lines={lines}
          setLines={onLinesChange}
          priceOf={(p) => (priceOf === 'cost' ? p.cost : p.price)}
          money={money}
        />

        {showTotals && lines.length ? (
          <View style={{ marginTop: 20 }}>
            <SectionLabel>Totals</SectionLabel>
            <Panel>
              <DetailRow label="Lines" value={String(lines.length)} />
              <DetailRow label="Units" value={String(units)} />
              <DetailRow label="Value" value={money(total)} bold last />
            </Panel>
          </View>
        ) : null}

        {summary ? <View style={{ marginTop: 20 }}>{summary}</View> : null}

        {blockedReason ? (
          <View style={{ marginTop: 16 }}>
            <InfoBanner tone="warn" text={blockedReason} />
          </View>
        ) : null}

        {!lines.length ? (
          <View style={{ marginTop: 16 }}>
            <InfoBanner tone="neutral" icon="bulb" text={'A ' + kind.toLowerCase() + ' needs at least one line before it can be raised.'} />
          </View>
        ) : null}
      </ScrollView>

      {who.sheet}

      <StickyBar>
        {showTotals ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
              {units} unit{units === 1 ? '' : 's'}
            </Text>
            <Text style={{ fontFamily: fonts.uiExtra, fontSize: 21, color: colors.ink }}>{money(total)}</Text>
          </View>
        ) : null}
        <Button
          label={saveLabel}
          variant="pri"
          disabled={blocked}
          icon={<Icon name="check" size={17} color={colors.accentInk} />}
          onPress={() => who.ask(onSave)}
        />
      </StickyBar>
    </View>
  );
}

/** Turns the editor's cart lines into the SaleLine shape the store expects. */
export function toSaleLines(lines: CartLine[], products: ReturnType<typeof useAppData>['db'] extends null ? never : any) {
  return lines.map((l) => {
    const p = products.find((x: any) => x.id === l.productId);
    return {
      productId: l.productId,
      name: p?.name || l.name,
      sku: p?.sku || '',
      unit: p?.unit || '',
      qty: l.qty,
      price: l.price,
      cost: p?.cost || 0,
      taxRate: p?.taxRate || 0,
    };
  });
}
