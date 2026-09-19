/**
 * OPENING A BRANCH — a staged setup, not a form.
 *
 * A branch here is a business in its own right: it holds its own stock, takes
 * its own money into its own drawer, keeps its own books and issues its own
 * paperwork. Opening one asks the same questions as opening the first shop did,
 * so it is asked the same way — a few at a time, in the order someone actually
 * decides them, with a review before anything is written.
 *
 * Nothing is committed until the last step. `logic.openBranch` then does the
 * whole thing in one act, so there is no state in which a branch exists but its
 * float does not, or its stock moved but its drawer was never created.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from '../components/Toast';
import {
  Panel, SectionLabel, Button, Field, StickyBar, DetailRow, InfoBanner,
  Badge, ListRow, Search, EmptyBlock, ProgressBar, SelectField, ToggleRow,
} from '../components/ui';
import { Icon, IconName } from '../components/icons';
import { useGo } from '../nav/navigate';
import { useIsOwner, Denied } from '../components/Gate';
import { branchStockUnits } from '../data/branch';

type StepId = 'shop' | 'papers' | 'money' | 'stock' | 'people' | 'review';

const STEPS: { id: StepId; n: string; hint: string; icon: IconName }[] = [
  { id: 'shop', n: 'The shop', hint: 'Where it is and what it is called', icon: 'home' },
  { id: 'papers', n: 'Paperwork', hint: 'How its bills are numbered, and tax', icon: 'doc' },
  { id: 'money', n: 'Money', hint: 'Its own drawer and what it opens with', icon: 'cash' },
  { id: 'stock', n: 'Opening stock', hint: 'What it starts with on the shelf', icon: 'box' },
  { id: 'people', n: 'Who runs it', hint: 'The name on the door', icon: 'user' },
  { id: 'review', n: 'Review', hint: 'Check it over, then open', icon: 'check' },
];

/* ---------------------------------------------------------------- */

function StepHead({ index, step }: { index: number; step: typeof STEPS[number] }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 10, marginBottom: 16 }}>
      <ProgressBar pct={((index + 1) / STEPS.length) * 100} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
        <View style={{
          width: 38, height: 38, borderRadius: 13, backgroundColor: colors.accentSoft,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name={step.icon} size={19} color={colors.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 17, color: colors.ink }}>{step.n}</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
            {step.hint}
          </Text>
        </View>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: colors.faint }}>
          {index + 1} of {STEPS.length}
        </Text>
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- */

export default function NewBranchScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const { db, money, openBranch } = useAppData();
  const { success, error } = useToast();
  const owner = useIsOwner();

  const [at, setAt] = useState(0);

  // step 1
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  // step 2
  const [prefix, setPrefix] = useState('');
  const [taxEnabled, setTaxEnabled] = useState(true);
  // step 3
  const [drawerName, setDrawerName] = useState('');
  const [float, setFloat] = useState('');
  const [wantExtra, setWantExtra] = useState(false);
  const [extraName, setExtraName] = useState('');
  const [extraType, setExtraType] = useState<'bank' | 'wallet'>('wallet');
  // step 4
  const [stockFrom, setStockFrom] = useState<string>('');
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  // step 5
  const [managerId, setManagerId] = useState<string>('');
  const [makeActive, setMakeActive] = useState(true);

  const [busy, setBusy] = useState(false);

  const sources = useMemo(
    () => (db?.warehouses || []).filter((w) => w.active !== false),
    [db],
  );

  const pickable = useMemo(() => {
    if (!db || !stockFrom) return [];
    const needle = q.trim().toLowerCase();
    return db.products
      .filter((p) => p.active && p.kind !== 'service' && (p.stock?.[stockFrom] || 0) > 0)
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle))
      .slice(0, 60);
  }, [db, stockFrom, q]);

  const chosenLines = useMemo(
    () => Object.entries(qtys)
      .map(([productId, v]) => ({ productId, qty: Math.max(0, Math.round(Number(v) || 0)) }))
      .filter((l) => l.qty > 0),
    [qtys],
  );

  if (!db) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (!owner) {
    return (
      <Denied
        title="Opening a branch is owner work"
        hint="A branch holds its own stock and its own money, so only the owner account can open one."
      />
    );
  }

  const step = STEPS[at];
  const staff = db.users.filter((u) => u.active);
  const clash = db.warehouses.some((w) => w.name.trim().toLowerCase() === name.trim().toLowerCase());

  /** What stops the current step being left. Empty means it may be. */
  function blocker(): string {
    if (step.id === 'shop') {
      if (!name.trim()) return 'Give the branch a name first.';
      if (clash) return 'There is already a branch called ' + name.trim() + '.';
    }
    if (step.id === 'stock' && stockFrom && !chosenLines.length) {
      return 'Enter a quantity, or choose to open with an empty shelf.';
    }
    return '';
  }

  function next() {
    const why = blocker();
    if (why) { error(why); return; }
    setAt((i) => Math.min(STEPS.length - 1, i + 1));
  }

  function open() {
    setBusy(true);
    try {
      const out = openBranch({
        name: name.trim(),
        address: address.trim() || undefined,
        phone: phone.trim() || undefined,
        prefix: prefix.trim() || undefined,
        taxEnabled,
        managerId: managerId || undefined,
        drawerName: drawerName.trim() || undefined,
        openingFloat: Number(float) || 0,
        extraAccount: wantExtra && extraName.trim() ? { name: extraName.trim(), type: extraType } : null,
        stockFrom: stockFrom || null,
        stockLines: chosenLines,
        makeActive,
      });

      if (out.shortfalls.length) {
        // Said plainly rather than swallowed: the shelf will not match the plan.
        error(
          out.shortfalls.length + ' item(s) had less on hand than asked for — '
          + out.shortfalls.slice(0, 2).map((s) => s.name + ' (' + s.had + ' of ' + s.wanted + ')').join(', ')
          + '. What was there was moved.',
        );
      } else {
        success(name.trim() + ' is open' + (makeActive ? ' — you are now working in it' : ''));
      }
      go('Branches');
    } catch (e: any) {
      error(e?.message || 'The branch could not be opened.');
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------------------ */

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 130 }}
        keyboardShouldPersistTaps="handled"
      >
        <StepHead index={at} step={step} />

        {step.id === 'shop' ? (
          <>
            <Panel>
              <Field icon="home" label="Branch name" value={name} onChangeText={setName} placeholder="e.g. Ntinda shop" error={name.trim() && clash ? 'There is already a branch with this name' : undefined} />
              <Field icon="doc" label="Address" value={address} onChangeText={setAddress} placeholder="Optional" multiline />
              <Field icon="phone" label="Phone" value={phone} onChangeText={setPhone} placeholder="Optional" />
            </Panel>
            <View style={{ height: 14 }} />
            <InfoBanner
              tone="neutral"
              icon="bulb"
              text="A branch is run as a business of its own. It keeps its own stock, its own drawer and its own books — the item list, customers and staff stay shared with the rest of the firm."
            />
          </>
        ) : null}

        {step.id === 'papers' ? (
          <>
            <Panel>
              <Field
                icon="tag" label="Document prefix" value={prefix} onChangeText={setPrefix}
                placeholder="INV" autoCapitalize="characters" maxLength={8}
              />
              <DetailRow label="A bill will read" value={(prefix.trim().toUpperCase() || 'INV') + '-00042'} last />
            </Panel>
            <View style={{ height: 14 }} />
            <SectionLabel>Tax</SectionLabel>
            <Panel flush>
              <ToggleRow
                label="Charge VAT at this branch"
                sub="A branch can trade under a different tax arrangement from the rest of the firm"
                on={taxEnabled}
                onChange={setTaxEnabled}
              />
            </Panel>
            <View style={{ height: 14 }} />
            <InfoBanner
              tone="neutral"
              icon="bulb"
              text="The running number stays shared across the firm, so no two bills anywhere can carry the same number — only the prefix differs."
            />
          </>
        ) : null}

        {step.id === 'money' ? (
          <>
            <SectionLabel>Its own drawer</SectionLabel>
            <Panel>
              <Field
                icon="cash" label="Drawer name" value={drawerName} onChangeText={setDrawerName}
                placeholder={(name.trim() || 'Branch') + ' drawer'}
              />
              <Field
                icon="coins" label="Opening float" value={float} onChangeText={setFloat}
                placeholder="0" decimal suffix={db.settings.currency}
              />
            </Panel>

            <View style={{ height: 14 }} />
            <SectionLabel>A second account</SectionLabel>
            <Panel flush>
              <ToggleRow label="It also has a bank or mobile-money account" on={wantExtra} onChange={setWantExtra} />
            </Panel>
            {wantExtra ? (
              <>
                <View style={{ height: 10 }} />
                <Panel>
                  <Field icon="bank" label="Account name" value={extraName} onChangeText={setExtraName} placeholder="e.g. Stall MoMo" />
                  <SelectField
                    icon="card" label="Kind" value={extraType}
                    options={[{ v: 'wallet' as const, l: 'Mobile money' }, { v: 'bank' as const, l: 'Bank' }]}
                    onChange={setExtraType}
                  />
                </Panel>
              </>
            ) : null}

            <View style={{ height: 14 }} />
            <InfoBanner
              tone="neutral"
              icon="bulb"
              text="The float is posted into this branch's books against owner equity. It will not appear in any other branch's cash figure."
            />
          </>
        ) : null}

        {step.id === 'stock' ? (
          <>
            <SectionLabel>Move stock in from</SectionLabel>
            <Panel flush>
              <ListRow
                icon="box"
                title="Open with an empty shelf"
                subtitle="Receive a purchase against it later"
                tone={stockFrom ? undefined : 'accent'}
                onPress={() => { setStockFrom(''); setQtys({}); }}
              />
              {sources.map((w, i) => (
                <ListRow
                  key={w.id}
                  icon="home"
                  title={w.name}
                  subtitle={branchStockUnits(db, w.id) + ' units on hand'}
                  tone={stockFrom === w.id ? 'accent' : undefined}
                  onPress={() => setStockFrom(w.id)}
                  last={i === sources.length - 1}
                />
              ))}
            </Panel>

            {stockFrom ? (
              <>
                <View style={{ height: 14 }} />
                <Search value={q} onChange={setQ} placeholder="Search the item list" />
                <View style={{ height: 10 }} />
                {pickable.length ? (
                  <Panel>
                    {pickable.map((p) => {
                      const had = p.stock?.[stockFrom] || 0;
                      const v = qtys[p.id] || '';
                      const over = Math.round(Number(v) || 0) > had;
                      return (
                        <View
                          key={p.id}
                          style={{
                            flexDirection: 'row', alignItems: 'center', gap: 10,
                            paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.line,
                          }}
                        >
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>
                              {p.name}
                            </Text>
                            <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: over ? colors.danger : colors.faint, marginTop: 2 }}>
                              {had + ' ' + p.unit + ' available' + (over ? ' — more than that is there to move' : '')}
                            </Text>
                          </View>
                          <View style={{ width: 92 }}>
                            <Field
                              label="Qty"
                              value={v}
                              onChangeText={(t) => setQtys((m) => ({ ...m, [p.id]: t }))}
                              placeholder="0"
                              decimal
                              error={over ? 'Only ' + had + ' there' : undefined}
                            />
                          </View>
                        </View>
                      );
                    })}
                  </Panel>
                ) : (
                  <Panel>
                    <EmptyBlock
                      icon="box"
                      title={q.trim() ? 'Nothing matches' : 'That branch holds no stock'}
                      hint="Pick another branch, or open with an empty shelf."
                    />
                  </Panel>
                )}
                <View style={{ height: 12 }} />
                <InfoBanner
                  tone="neutral"
                  icon="swap"
                  text={chosenLines.length
                    ? chosenLines.reduce((s, l) => s + l.qty, 0) + ' units will move across. This is a transfer — the firm ends up with exactly what it has now.'
                    : 'Enter a quantity against the items to move.'}
                />
              </>
            ) : null}
          </>
        ) : null}

        {step.id === 'people' ? (
          <>
            <SectionLabel>Who runs it</SectionLabel>
            <Panel flush>
              <ListRow
                icon="user"
                title="Decide later"
                subtitle="Nobody named yet"
                tone={managerId ? undefined : 'accent'}
                onPress={() => setManagerId('')}
              />
              {staff.map((u, i) => (
                <ListRow
                  key={u.id}
                  icon="user"
                  title={u.name}
                  subtitle={u.role.charAt(0).toUpperCase() + u.role.slice(1)}
                  tone={managerId === u.id ? 'accent' : undefined}
                  onPress={() => setManagerId(u.id)}
                  last={i === staff.length - 1}
                />
              ))}
            </Panel>
            <View style={{ height: 14 }} />
            <Panel flush>
              <ToggleRow
                label="Start working in this branch straight away"
                sub="Everything you sell and every figure you read will be this branch's"
                on={makeActive}
                onChange={setMakeActive}
              />
            </Panel>
            <View style={{ height: 14 }} />
            <InfoBanner
              tone="neutral"
              icon="bulb"
              text="Staff are shared across the firm. Naming a manager records who answers for this branch; it does not move anyone off another one."
            />
          </>
        ) : null}

        {step.id === 'review' ? (
          <>
            <SectionLabel>The shop</SectionLabel>
            <Panel>
              <DetailRow label="Name" value={name.trim() || '—'} />
              <DetailRow label="Address" value={address.trim() || 'Not given'} />
              <DetailRow label="Phone" value={phone.trim() || 'Not given'} last />
            </Panel>

            <View style={{ height: 14 }} />
            <SectionLabel>Paperwork</SectionLabel>
            <Panel>
              <DetailRow label="Bills read" value={(prefix.trim().toUpperCase() || 'INV') + '-00042'} />
              <DetailRow label="VAT" value={taxEnabled ? 'Charged here' : 'Not charged here'} last />
            </Panel>

            <View style={{ height: 14 }} />
            <SectionLabel>Money</SectionLabel>
            <Panel>
              <DetailRow label="Drawer" value={drawerName.trim() || name.trim() + ' drawer'} />
              <DetailRow label="Opening float" value={money(Number(float) || 0)} />
              <DetailRow
                label="Second account"
                value={wantExtra && extraName.trim()
                  ? extraName.trim() + ' · ' + (extraType === 'bank' ? 'bank' : 'mobile money')
                  : 'None'}
                last
              />
            </Panel>

            <View style={{ height: 14 }} />
            <SectionLabel>Opening stock</SectionLabel>
            <Panel>
              {chosenLines.length ? (
                <>
                  <DetailRow
                    label="Moved from"
                    value={db.warehouses.find((w) => w.id === stockFrom)?.name || '—'}
                  />
                  <DetailRow label="Lines" value={String(chosenLines.length)} />
                  <DetailRow label="Units" value={String(chosenLines.reduce((s, l) => s + l.qty, 0))} last />
                </>
              ) : (
                <DetailRow label="Starting stock" value="Empty shelf" last />
              )}
            </Panel>

            <View style={{ height: 14 }} />
            <SectionLabel>Who runs it</SectionLabel>
            <Panel>
              <DetailRow label="Manager" value={staff.find((u) => u.id === managerId)?.name || 'Not named yet'} />
              <DetailRow label="After opening" value={makeActive ? 'Work in this branch' : 'Stay where you are'} last />
            </Panel>

            <View style={{ height: 14 }} />
            <InfoBanner
              tone="warn"
              icon="alert"
              text="Opening the branch creates its drawer, posts the float and moves the stock in one go. Nothing has been written yet."
            />
          </>
        ) : null}
      </ScrollView>

      <StickyBar>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button
              label={at === 0 ? 'Cancel' : 'Back'}
              onPress={() => (at === 0 ? go('Branches') : setAt((i) => i - 1))}
            />
          </View>
          <View style={{ flex: 1.4 }}>
            {step.id === 'review' ? (
              <Button
                label={'Open ' + (name.trim() || 'branch')}
                variant="pri"
                loading={busy}
                icon={<Icon name="check" size={17} color={colors.accentInk} />}
                onPress={open}
              />
            ) : (
              <Button
                label="Next"
                variant="pri"
                icon={<Icon name="chev" size={17} color={colors.accentInk} />}
                onPress={next}
              />
            )}
          </View>
        </View>
      </StickyBar>
    </View>
  );
}
