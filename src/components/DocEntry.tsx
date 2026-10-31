/**
 * The shared skeleton for raising a document — quotation, delivery note,
 * recurring schedule, instalment plan.
 *
 * They differ only in who they are for, what extra terms they carry and what
 * they post, so the party picker, the line editor, the totals and the sticky
 * commit bar live here once. The commit always passes through the "who is
 * recording this" prompt, so every document carries a name.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import ScrollView from './KeyScroll';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import {
  Button, Panel, SectionLabel, DetailRow, InfoBanner, StickyBar, FieldShell, Badge,
} from './ui';
import { Icon, IconName } from './icons';
import { LineEditor, CartLine } from './LineEditor';
import { useWho, WhoResult } from './WhoSheet';
import { CustomerPickerSheet, CustomerFormSheet, BalanceTag } from './CustomerSheets';
import PriceListPicker from './PriceListPicker';
import { priceFor, repriceLines } from '../data/priceLists';
import { Pressable } from './Press';

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
  /**
   * Opens the party picker as the screen opens, then the item entry once the
   * party is chosen. Off when changing a document already raised.
   */
  autoStart?: boolean;
  /** The item entry's title, e.g. "Add Items to Estimate/Quotation". */
  entryTitle?: string;
  /** The price list the lines are priced from; shown as a picker when given. */
  priceListId?: string | null;
  onPriceListChange?: (id: string | null) => void;
}

export default function DocEntry({
  kind, icon, tone = 'accent',
  partyType = 'customer', partyLabel, partyRequired, partyId, onPartyChange,
  lines, onLinesChange, priceOf = 'price', linesLabel = 'Items',
  children, summary, saveLabel, blockedReason, askWho, onSave, showTotals = true,
  autoStart = false, entryTitle, priceListId, onPriceListChange,
}: DocEntryProps) {
  const { colors } = useTheme();
  const { db, money, partyBalance, addParty } = useAppData();
  const who = useWho(askWho || ('Who is raising this ' + kind.toLowerCase() + '?'));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  /** Bumped to open the item entry. */
  const [entrySignal, setEntrySignal] = useState(0);
  // the screen may hold the choice (to save it); otherwise it lives here
  const [ownList, setOwnList] = useState<string | null>(null);
  const listId = priceListId !== undefined ? priceListId : ownList;
  const setListId = (id: string | null) => { if (priceListId === undefined) setOwnList(id); };
  const list = (db?.priceLists || []).find((l) => l.id === listId) || null;

  const parties = useMemo(
    () => (db?.parties || []).filter((p) => p.active && (partyType === 'none' || p.type === partyType)),
    [db, partyType],
  );
  const party = parties.find((p) => p.id === partyId);
  const partyWord = partyLabel || (partyType === 'supplier' ? 'Supplier' : 'Customer');

  // the order a document is typed in: who it is for, then what is on it
  useEffect(() => {
    if (!autoStart || lines.length) return;
    const t = setTimeout(() => {
      if (partyType !== 'none' && !partyId) setPickerOpen(true);
      else setEntrySignal((n) => n + 1);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A party was chosen: go straight on to the first item. */
  function chosen(id: string | null) {
    onPartyChange(id);
    // the customer's own price list comes with them
    const own = id ? db?.parties.find((x) => x.id === id)?.priceListId : undefined;
    if (priceOf === 'price' && own && (db?.priceLists || []).some((l) => l.id === own && l.status === 'Active') && own !== listId) {
      setListId(own);
      onPriceListChange?.(own);
      const l = (db?.priceLists || []).find((x) => x.id === own) || null;
      onLinesChange(repriceLines(lines as any, l, db?.products || []) as CartLine[]);
    }
    if (!lines.length) setTimeout(() => setEntrySignal((n) => n + 1), 350);
  }

  const products = useMemo(() => (db?.products || []).filter((p) => p.active), [db]);
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const units = lines.reduce((s, l) => s + l.qty, 0);

  const missingParty = partyRequired && !partyId;
  const blocked = !lines.length || missingParty || !!blockedReason;

  const fg = tone === 'good' ? colors.good : tone === 'warn' ? colors.warn : colors.accent;
  const bg = tone === 'good' ? colors.goodSoft : tone === 'warn' ? colors.warnSoft : colors.accentSoft;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 170 }} keyboardShouldPersistTaps="handled">
        {/* the details in one row, as on New sale: price list (on documents that sell) and what this is */}
        <View style={{ flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 4, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', marginBottom: 12 }}>
          {priceOf === 'price' ? (
            <>
              <PriceListPicker
                compact
                value={listId}
                onChange={(id) => {
                  setListId(id);
                  onPriceListChange?.(id);
                  const l = (db?.priceLists || []).find((x) => x.id === id) || null;
                  onLinesChange(repriceLines(lines as any, l, db?.products || []) as CartLine[]);
                }}
              />
              <View style={{ width: 1, backgroundColor: colors.line }} />
            </>
          ) : null}
          <View style={{ flex: 1.4, minWidth: 0, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name={icon} size={16} color={fg} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint }}>New</Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink, marginTop: 2 }}>{kind}</Text>
            </View>
          </View>
        </View>

        {partyType !== 'none' ? (
          <View style={{ backgroundColor: colors.surface, borderRadius: 4, overflow: 'hidden', borderWidth: 1, borderColor: missingParty ? colors.danger : colors.line, marginBottom: 12 }}>
            <Pressable onPress={() => setPickerOpen(true)} style={{ paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{partyWord}{partyRequired ? ' · required' : ''}</Text>
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 14, color: party ? colors.ink : colors.soft, marginTop: 3 }}>
                  {party ? party.name : partyRequired || partyType === 'supplier' ? 'Choose a ' + partyWord.toLowerCase() : 'Walk-in customer'}
                </Text>
                {party?.phone ? <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>{party.phone}</Text> : null}
              </View>
              {party ? <BalanceTag balance={partyBalance(party.id)} money={money} /> : null}
              <Icon name="chev" size={18} color={colors.faint} />
            </Pressable>
          </View>
        ) : null}

        {children}

        <View style={{ height: 4 }} />
        <LineEditor
          products={products}
          lines={lines}
          setLines={onLinesChange}
          priceOf={(p) => (priceOf === 'cost' ? p.cost : priceFor(list, p))}
          rateIs={priceOf}
          money={money}
          openSignal={entrySignal}
          entryTitle={entryTitle || 'Add Items to ' + kind}
        />


        {summary ? <View style={{ marginTop: 20 }}>{summary}</View> : null}

        {blockedReason ? (
          <View style={{ marginTop: 16 }}>
            <InfoBanner tone="warn" text={blockedReason} />
          </View>
        ) : null}

      </ScrollView>

      {who.sheet}

      {partyType !== 'none' ? (
        <>
          <CustomerPickerSheet
            kind={partyType}
            visible={pickerOpen}
            customers={parties}
            selectedId={partyId}
            balanceOf={partyBalance}
            money={money}
            onSelect={chosen}
            onCreate={() => { setPickerOpen(false); setFormOpen(true); }}
            onClose={() => setPickerOpen(false)}
          />
          <CustomerFormSheet
            kind={partyType}
            visible={formOpen}
            onClose={() => setFormOpen(false)}
            onSave={(p) => { const made = addParty(p); setFormOpen(false); chosen(made.id); }}
          />
        </>
      ) : null}

      <StickyBar>
        {showTotals ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
              {units} item{units === 1 ? '' : 's'}
            </Text>
            <Text style={{ fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink }}>{money(total)}</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label="Clear" disabled={!lines.length} onPress={() => onLinesChange([])} />
          </View>
          <View style={{ flex: 2 }}>
            <Button label={saveLabel} variant="pri" disabled={blocked} onPress={() => who.ask(onSave)} />
          </View>
        </View>
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
      unit: l.unit || p?.unit || '',
      qty: l.qty,
      price: l.price,
      cost: (p?.cost || 0) * (l.unitFactor || 1),
      taxRate: p?.taxRate || 0,
      ...(l.unitFactor && l.unitFactor !== 1 ? { unitFactor: l.unitFactor } : {}),
      ...(l.listPrice !== undefined ? { listPrice: l.listPrice, discountPct: l.discountPct || 0 } : {}),
      ...(l.note ? { note: l.note } : {}),
    };
  });
}
