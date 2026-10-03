/**
 * Settings.
 *
 * Reference: the live SCREENS.settings (line 6712) — the business profile card
 * then the grouped cards "Money & language", "Tax", "Selling & the till",
 * "Stock", "Document numbers", "Alerts", "Security", "Appearance", "This
 * device" and the version card — composed with every later wrapper:
 * Company / Selling rules (15393), the second-unit switch (16994), "Changing
 * what is recorded" (17923), Account (19186), Cloud (20531), About (21174) and
 * This phone (21708).
 *
 * Its sheets are ported too: SHEETS.money / locale / taxSettings / tillSettings
 * / stockSettings / numbering / security (6839-6899), belowCost (15417) and
 * editWindow (17935). EFRIS is deliberately left out of this port.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import {
  Card, Cap, Button, Avatar, KV, EmptyState, TopTabs,
  SettingGroup, SettingRow, SettingToggle, SettingSeg, Field, SelectField, FieldNote,
} from '../components/ui';
import { Pressable } from '../components/Press';
import { Icon, IconName } from '../components/icons';
import { Sheet } from '../components/Sheet';
import { useGo } from '../nav/navigate';
import { plural } from '../data/helpers';
import { planSummary } from '../data/logic';
import { NUMBER_LABEL, BUILD } from '../data/defaults';
import type { NumberingKey, Settings, BelowCost, Costing } from '../data/types';

const num = (v: string) => Number(String(v).replace(/[^0-9.]/g, '')) || 0;

type SheetName =
  | 'firm' | 'money' | 'locale' | 'tax' | 'till' | 'stock'
  | 'numbering' | 'security' | 'belowCost' | 'editWindow' | 'device';

type SettingsTab = 'general' | 'selling' | 'stock' | 'security' | 'system';

export default function SettingsScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const {
    db, setSetting, updateFirm, can, setDocNumbering, isPro,
  } = useAppData();
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [tab, setTab] = useState<SettingsTab>('general');

  if (!db) return null;
  const s = db.settings;

  /* Reference the very first line of SCREENS.settings body, 6715. */
  if (!can('settings')) {
    return <EmptyState icon="cog" title="Not available" subtitle="Your role does not include settings." />;
  }

  const set = (patch: Partial<Settings>) => setSetting(patch);
  const wh = db.warehouses.find((w) => w.id === s.defaultWarehouse);
  const activePeople = db.users.filter((u) => u.active).length;
  const plan = planSummary(db);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopTabs
        value={tab}
        onChange={setTab}
        options={[
          { v: 'general', l: 'General', i: 'cog' },
          { v: 'selling', l: 'Selling', i: 'till' },
          { v: 'stock', l: 'Stock', i: 'box' },
          { v: 'security', l: 'Security', i: 'shield' },
          { v: 'system', l: 'System', i: 'phone' },
        ]}
      />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 26 }}>
        {tab === 'general' ? (
          <>
            {/* the business profile card, reference 6718 */}
            {/* the business, and the one way in to all its details */}
            <Pressable onPress={() => go('Business')} accessibilityLabel="Edit business details" style={{ marginBottom: 20 }}>
              <Card style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Avatar name={db.firm.name} id={db.firm.id} size={44} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{db.firm.name}</Text>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                    {[db.firm.tin ? 'TIN ' + db.firm.tin : '', db.firm.phone].filter(Boolean).join(' · ') || 'Add your phone, address and logo'}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: 11, borderRadius: 10, backgroundColor: colors.accentSoft }}>
                  <Icon name="pencil" size={13} color={colors.accent} />
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: colors.accent }}>Edit</Text>
                </View>
              </Card>
            </Pressable>

            {/* Company — reference the wrapper at 15396 */}
            <SettingGroup title="Company">
              <SettingRow icon="factory" label="Businesses on this device" value={plural(db.firms.length, 'business', 'businesses')} onPress={() => go('Firms')} />
            </SettingGroup>

            {/* Date format, week start and language were switches with nothing behind them —
                dates are shown in fixed forms and the app has one language — so they
                are not offered until they do something. */}
            <SettingGroup title="Money">
              <SettingRow icon="coins" label="Currency" value={s.currency + ' · ' + s.currencyName} onPress={() => setSheet('money')} />
              <SettingRow icon="money" label="Symbol" value={s.symbolBefore ? 'Before the number' : 'After the number'} onPress={() => setSheet('money')} />
              <SettingRow icon="pie" label="Decimals" value={String(s.decimals)} onPress={() => setSheet('money')} />
            </SettingGroup>

          </>
        ) : null}

        {tab === 'selling' ? (
          <>
            <SettingGroup title="Payment reminders">
              <SettingRow icon="share" label="Reminders and their messages" value={s.reminders?.enabled === false ? 'Off' : 'On'} onPress={() => go('ReminderSettings')} />
            </SettingGroup>

            <SettingGroup title="Selling & the till">
              <SettingRow icon="cash" label="Default payment" value={s.defaultMethod} onPress={() => setSheet('till')} />
              <SettingRow icon="coins" label="Round totals to" value={s.roundTo ? 'nearest ' + s.roundTo : 'no rounding'} onPress={() => setSheet('till')} />
              <SettingRow icon="tag" label="Biggest discount a cashier may give" value={s.maxDiscountPct + '%'} onPress={() => setSheet('till')} />
              <SettingToggle icon="clock" label="A shift must be open to sell" on={s.requireShift} onChange={(v) => set({ requireShift: v })} />
              <SettingToggle icon="user" label="Ask for the customer on every sale" on={s.askCustomer} onChange={(v) => set({ askCustomer: v })} />
              <SettingToggle icon="pencil" label="Let staff change the price at the till" on={s.allowPriceEdit} onChange={(v) => set({ allowPriceEdit: v })} />
            </SettingGroup>

            {/* Selling rules — reference the wrapper at 15407 */}
            <SettingGroup title="Selling rules">
              <SettingToggle icon="box" label="Refuse to sell what is not in stock" on={s.blockNegativeStock} onChange={(v) => set({ blockNegativeStock: v, allowNegativeStock: !v })} />
              <SettingRow
                icon="alert"
                label="Stop selling below cost"
                value={s.belowCost === 'block' ? 'On — refuse it' : s.belowCost === 'warn' ? 'Ask before selling' : 'Off — allow it'}
                onPress={() => setSheet('belowCost')}
              />
            </SettingGroup>

            <SettingGroup title="Tax">
              <SettingToggle
                icon="pie" label="Charge tax on sales"
                sub="Off means no tax is added, shown on a bill, or reported"
                on={s.taxEnabled !== false}
                onChange={(v) => set({ taxEnabled: v })}
              />
              {s.taxEnabled !== false ? (
                <SettingRow icon="bank" label="Tax name" value={s.taxName} onPress={() => setSheet('tax')} />
              ) : null}
              {s.taxEnabled !== false ? (
                <SettingRow icon="pie" label="Rate" value={s.taxRate + '%'} onPress={() => setSheet('tax')} />
              ) : null}
              {s.taxEnabled !== false ? (
                <SettingToggle icon="receipt" label="Prices already include tax" on={s.pricesIncludeTax} onChange={(v) => set({ pricesIncludeTax: v })} />
              ) : null}
            </SettingGroup>
          </>
        ) : null}

        {tab === 'stock' ? (
          <>
            <SettingGroup title="Stock">
              <SettingRow icon="box" label="Sell stock from" value={wh?.name || '—'} onPress={() => setSheet('stock')} />
              <SettingRow icon="chart" label="Costing" value={s.costing === 'average' ? 'Weighted average' : 'Last cost'} onPress={() => setSheet('stock')} />
              <SettingToggle icon="swap" label="Buy and sell in a second unit" on={s.useSecondaryUnit} onChange={(v) => set({ useSecondaryUnit: v })} />
              <SettingToggle icon="alert" label="Warn when stock runs low" on={s.lowStockAlerts} onChange={(v) => set({ lowStockAlerts: v })} />
              <SettingToggle icon="down" label="Allow selling below zero" on={s.allowNegativeStock} onChange={(v) => set({ allowNegativeStock: v, blockNegativeStock: !v })} />
              <SettingToggle icon="calendar" label="Track batches and expiry" on={s.trackBatches} onChange={(v) => set({ trackBatches: v })} />
            </SettingGroup>

            {/* Document numbers — reference 6817 */}
            <SettingGroup title="Document numbers">
              {(Object.keys(db.numbering) as NumberingKey[]).map((k) => (
                <SettingRow
                  key={k}
                  icon="doc"
                  label={NUMBER_LABEL[k] || k}
                  value={db.numbering[k] + '-00001'}
                  onPress={() => setSheet('numbering')}
                />
              ))}
            </SettingGroup>
          </>
        ) : null}

        {tab === 'security' ? (
          <>
            <SettingGroup title="Security">
              <SettingToggle icon="lock" label="Ask for a PIN when the app opens" on={s.lockOnOpen} onChange={(v) => set({ lockOnOpen: v })} />
              <SettingRow icon="lock" label="Lock after" value={s.autoLockMins ? s.autoLockMins + ' minutes idle' : 'never'} onPress={() => setSheet('security')} />
              <SettingToggle icon="shield" label="Hide cost prices from cashiers" on={s.hideCostFromCashier} onChange={(v) => set({ hideCostFromCashier: v })} />
              <SettingRow icon="user" label="Users and roles" value={plural(activePeople, 'person', 'people')} onPress={() => go('UsersRoles')} />
            </SettingGroup>

            <SettingGroup title="Accounting">
              <SettingRow
                icon="lock"
                label="Accounting period"
                value={s.accountingLock ? 'Locked — ' + new Date(s.accountingLock.from).toLocaleDateString() : 'Open'}
                onPress={() => {
                  if (s.accountingLock) {
                    set({ accountingLock: null });
                  } else {
                    set({ accountingLock: { from: new Date().toISOString(), reason: 'Month-end close', lockedAt: new Date().toISOString(), approvedBy: db.session.userId } });
                  }
                }}
              />
            </SettingGroup>

            {/* Changing what is recorded — reference the wrapper at 17926 */}
            <SettingGroup title="Accountability">
              <SettingToggle
                icon="user" label="Ask who is recording each entry"
                sub="Every sale, payment and count is stamped with a name"
                on={s.askWhoOnSave !== false}
                onChange={(v) => set({ askWhoOnSave: v })}
              />
              <SettingToggle
                icon="lock" label="That person must enter their PIN"
                sub="Stops one person recording work as another"
                on={s.requirePinOnSave === true}
                onChange={(v) => set({ requirePinOnSave: v })}
              />
              <SettingRow icon="chart" label="Staff performance" value="Who sold what" onPress={() => go('StaffReport')} />
            </SettingGroup>

            <SettingGroup title="Changing what is recorded">
              <SettingToggle icon="pencil" label="A PIN is needed to edit a transaction" on={s.requirePinToEdit} onChange={(v) => set({ requirePinToEdit: v })} />
              <SettingToggle icon="trash" label="A PIN is needed to delete one" on={s.requirePinToDelete} onChange={(v) => set({ requirePinToDelete: v })} />
              <SettingRow
                icon="clock"
                label="Edits allowed for"
                value={s.editWindowDays > 0 ? plural(s.editWindowDays, 'day') + ' after the sale' : 'any sale, any age'}
                onPress={() => setSheet('editWindow')}
              />
              <SettingRow icon="shield" label="Audit log" value={plural(db.auditLog.length, 'entry', 'entries')} onPress={() => go('AuditLog')} />
            </SettingGroup>

            <SettingGroup title="Alerts">
              <SettingToggle icon="box" label="Low stock" on={s.notifyLowStock} onChange={(v) => set({ notifyLowStock: v })} />
              <SettingToggle icon="clock" label="Overdue bills" on={s.notifyOverdue} onChange={(v) => set({ notifyOverdue: v })} />
            </SettingGroup>
          </>
        ) : null}

        {tab === 'system' ? (
          <>
            <SettingGroup title="This device">
              <SettingRow icon="till" label="Till name" value={db.session.till} onPress={() => setSheet('device')} />
              <SettingRow icon="print" label="Printer" value={db.printer.device || '—'} onPress={() => go('Printing')} />
              <SettingRow icon="cloud" label="Connection" value={db.session.online ? 'Online' : 'Offline'} />
              <SettingRow icon="swap" label="Backup & data tools" value="Export, restore, health check" onPress={() => go('DataTools')} />
            </SettingGroup>

            {/* Account / Cloud / This phone / About — the later wrappers */}
            <SettingGroup title="Account">
              <SettingRow icon="gift" label="Plan & licence" sub={plan.name} value={plan.left} onPress={() => go('Licence')} />
            </SettingGroup>

            <SettingGroup title="Cloud">
              <SettingRow
                icon="cloud"
                label="Cloud sync"
                value={plan.name === 'Free trial' || plan.left === 'Choose a plan' || plan.left === 'Renew' ? 'Paid plans only' : !isPro() ? 'On Pro' : db.sync.on ? (db.sync.pending.length ? plural(db.sync.pending.length, 'change') + ' waiting' : 'On this phone only') : 'Off'}
                onPress={() => go('Sync')}
              />
            </SettingGroup>

            <SettingGroup title="About">
              <SettingRow icon="bulb" label="Version" value={BUILD} onPress={() => go('About')} />
            </SettingGroup>

            {/* the version card at the foot, reference 6790 */}
            <Card style={{ paddingVertical: 4, paddingHorizontal: 16, marginBottom: 16 }}>
              <KV label="App version" value={'Genius POS ' + BUILD} />
              <KV label="Books on this device" value={plural(db.firms.length, 'business', 'businesses')} />
              <KV
                label="Records"
                value={(db.sales.length + db.purchases.length + db.journal.length).toLocaleString('en-US')}
                last
              />
            </Card>

          </>
        ) : null}
      </ScrollView>

      {/* ----------------------------- the sheets ----------------------------- */}


      {/* SHEETS.money — reference 6839 */}
      <SimpleSheet visible={sheet === 'money'} title="Money" icon="coins" onClose={() => setSheet(null)}>
        <Field label="Currency symbol" value={s.currency} onChangeText={(v) => set({ currency: v })} />
        <Field label="Currency name" value={s.currencyName} onChangeText={(v) => set({ currencyName: v })} />
        <SelectField
          label="Where the symbol goes"
          value={String(s.symbolBefore)}
          options={[{ v: 'true', l: 'Before — ' + s.currency + ' 1,000' }, { v: 'false', l: 'After — 1,000 ' + s.currency }]}
          onChange={(v) => set({ symbolBefore: v === 'true' })}
        />
        <SelectField
          label="Decimal places"
          value={String(s.decimals)}
          options={[{ v: '0', l: 'None — 1,000' }, { v: '2', l: 'Two — 1,000.00' }]}
          onChange={(v) => set({ decimals: (v === '2' ? 2 : 0) as 0 | 2 })}
        />
      </SimpleSheet>

      {/* SHEETS.locale — reference 6849 */}
      <SimpleSheet visible={sheet === 'locale'} title="Dates & language" icon="calendar" onClose={() => setSheet(null)}>
        <SelectField
          label="Date format"
          value={s.dateFormat}
          options={[{ v: 'd M yyyy', l: '22 Aug 2026' }, { v: 'dd/mm/yyyy', l: '22/08/2026' }, { v: 'mm/dd/yyyy', l: '08/22/2026' }]}
          onChange={(v) => set({ dateFormat: v })}
        />
        <SelectField
          label="Week starts on"
          value={s.firstDay}
          options={[{ v: 'Mon' as const, l: 'Monday' }, { v: 'Sun' as const, l: 'Sunday' }]}
          onChange={(v) => set({ firstDay: v })}
        />
        <SelectField
          label="Language"
          value={s.language}
          options={[{ v: 'English', l: 'English' }, { v: 'Luganda', l: 'Luganda' }, { v: 'Swahili', l: 'Kiswahili' }]}
          onChange={(v) => set({ language: v })}
        />
        <Field label="Time zone" value={s.timezone} onChangeText={(v) => set({ timezone: v })} />
      </SimpleSheet>

      {/* SHEETS.taxSettings — reference 6860 */}
      <SimpleSheet visible={sheet === 'tax'} title="Tax" icon="bank" onClose={() => setSheet(null)}>
        <Field label="What it is called" value={s.taxName} onChangeText={(v) => set({ taxName: v })} placeholder="VAT" />
        <Field label="Rate %" value={String(s.taxRate)} onChangeText={(v) => set({ taxRate: num(v) })} numeric />
        <Field label="TIN" value={db.firm.tin} onChangeText={(v) => updateFirm({ tin: v })} />
        <FieldNote>
          Changing the rate affects new bills only. Bills already raised keep the tax they were charged.
        </FieldNote>
      </SimpleSheet>

      {/* SHEETS.tillSettings — reference 6867 */}
      <SimpleSheet visible={sheet === 'till'} title="Selling & the till" icon="till" onClose={() => setSheet(null)}>
        <SelectField
          label="Default payment method"
          value={s.defaultMethod}
          options={[{ v: 'cash' as const, l: 'Cash' }, { v: 'momo' as const, l: 'Mobile money' }, { v: 'bank' as const, l: 'Bank' }]}
          onChange={(v) => set({ defaultMethod: v })}
        />
        <SelectField
          label="Round totals to"
          value={String(s.roundTo)}
          options={[{ v: '0', l: 'Do not round' }, { v: '50', l: 'Nearest 50' }, { v: '100', l: 'Nearest 100' }, { v: '500', l: 'Nearest 500' }]}
          onChange={(v) => set({ roundTo: num(v) as 0 | 50 | 100 | 500 })}
        />
        <Field label="Biggest discount a cashier may give (%)" value={String(s.maxDiscountPct)} onChangeText={(v) => set({ maxDiscountPct: num(v) })} numeric />
        <SelectField
          label="Quick items shown on the till"
          value={String(s.quickItems)}
          options={['3', '6', '9', '12'].map((v) => ({ v, l: v }))}
          onChange={(v) => set({ quickItems: num(v) })}
        />
      </SimpleSheet>

      {/* SHEETS.stockSettings — reference 6878 */}
      <SimpleSheet visible={sheet === 'stock'} title="Stock" icon="box" onClose={() => setSheet(null)}>
        <SelectField
          label="Sell stock from"
          value={s.defaultWarehouse}
          options={db.warehouses.map((w) => ({ v: w.id, l: w.name }))}
          onChange={(v) => set({ defaultWarehouse: v })}
        />
        <SelectField
          label="Costing method"
          value={s.costing}
          options={[{ v: 'average' as Costing, l: 'Weighted average' }, { v: 'last' as Costing, l: 'Last purchase cost' }]}
          onChange={(v) => set({ costing: v })}
        />
        <FieldNote>Weighted average smooths price swings between deliveries.</FieldNote>
      </SimpleSheet>

      {/* SHEETS.numbering — reference 6887 */}
      <SimpleSheet visible={sheet === 'numbering'} title="Document numbers" icon="doc" onClose={() => setSheet(null)}>
        <FieldNote>
          The prefix in front of each document number. Changing it only affects new documents.
        </FieldNote>
        {(Object.keys(db.numbering) as NumberingKey[]).map((k) => (
          <Field
            key={k}
            label={NUMBER_LABEL[k] || k}
            value={db.numbering[k]}
            onChangeText={(v) => setDocNumbering({ [k]: v.toUpperCase() } as Partial<Record<NumberingKey, string>>)}
          />
        ))}
      </SimpleSheet>

      {/* SHEETS.security — reference 6893 */}
      <SimpleSheet visible={sheet === 'security'} title="Security" icon="lock" onClose={() => setSheet(null)}>
        <SelectField
          label="Lock the app after"
          value={String(s.autoLockMins)}
          options={[{ v: '0', l: 'Never' }, { v: '2', l: '2 minutes idle' }, { v: '5', l: '5 minutes idle' }, { v: '15', l: '15 minutes idle' }]}
          onChange={(v) => set({ autoLockMins: num(v) })}
        />
        <FieldNote>Staff sign back in with their PIN. Anything half-typed at the till is kept.</FieldNote>
      </SimpleSheet>

      {/* SHEETS.belowCost — reference 15417 */}
      <SimpleSheet visible={sheet === 'belowCost'} title="Selling below cost" icon="alert" onClose={() => setSheet(null)}>
        <SelectField
          label="When a price is under what it cost"
          value={s.belowCost}
          options={[
            { v: 'allow' as BelowCost, l: 'Allow it quietly' },
            { v: 'warn' as BelowCost, l: 'Warn me first' },
            { v: 'block' as BelowCost, l: 'Refuse it' },
          ]}
          onChange={(v) => set({ belowCost: v })}
        />
        <FieldNote>A clearance price is fine — this is about catching the ones that were a mistake.</FieldNote>
      </SimpleSheet>

      {/* SHEETS.editWindow — reference 17935 */}
      <SimpleSheet visible={sheet === 'editWindow'} title="How long may a bill be edited?" icon="clock" onClose={() => setSheet(null)}>
        <SelectField
          label="Edits allowed for"
          value={String(s.editWindowDays)}
          options={[
            { v: '0', l: 'Any sale, any age' }, { v: '1', l: 'The same day' },
            { v: '7', l: '7 days after the sale' }, { v: '30', l: '30 days after the sale' },
          ]}
          onChange={(v) => set({ editWindowDays: num(v) })}
        />
        <FieldNote>Older sales can still be corrected with a credit note, which leaves a trail.</FieldNote>
      </SimpleSheet>

      {/* SHEETS.device */}
      <SimpleSheet visible={sheet === 'device'} title="This device" icon="phone" onClose={() => setSheet(null)}>
        <Card style={{ padding: 12, marginBottom: 12 }}>
          <KV label="Till" value={db.session.till} />
          <KV label="Warehouse" value={wh?.name || '—'} last />
        </Card>
        <FieldNote>
          The till name is stamped on every bill and on every shift, so each drawer reconciles on its own.
        </FieldNote>
      </SimpleSheet>
    </View>
  );
}

/** A sheet whose fields save as you type — the port's stand-in for submit-on-close. */
function SimpleSheet({ visible, title, onClose, children, icon }: {
  visible: boolean; title: string; onClose: () => void; children: React.ReactNode; icon?: IconName;
}) {
  return (
    <Sheet visible={visible} title={title} icon={icon} onClose={onClose} footer={<Button variant="pri" label="Done" onPress={onClose} />}>
      {children}
    </Sheet>
  );
}

/** SHEETS.firm — the business details behind the profile card. */
function FirmSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { db, updateFirm } = useAppData();
  if (!db) return null;
  return (
    <SimpleSheet visible={visible} title="Business details" icon="owner" onClose={onClose}>
      <Field label="Name" value={db.firm.name} onChangeText={(v) => updateFirm({ name: v })} />
      <Field label="TIN" value={db.firm.tin} onChangeText={(v) => updateFirm({ tin: v })} />
      <Field label="Phone" value={db.firm.phone} onChangeText={(v) => updateFirm({ phone: v })} />
      <Field label="Address" value={db.firm.address} onChangeText={(v) => updateFirm({ address: v })} multiline />
    </SimpleSheet>
  );
}
