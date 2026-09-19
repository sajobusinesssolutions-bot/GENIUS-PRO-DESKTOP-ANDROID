/**
 * Shifts & day close.
 *
 * Reference: SCREENS.shifts (line 2585) — the live-shift card, the two stats,
 * the drawer breakdown and the past-shift list with its balanced/over/short
 * tag — plus the live SHEETS.openShift (7233) and SHEETS.closeShift (7262),
 * including shiftVar()'s over/short reconciliation note at 7294.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import {
  Card, Cap, Button, Pill, KV, Grid, Stat, Avatar, EmptyState,
  BigAmount, Field, FieldNote, ActionChip, Badge, DetailRow, StatGrid, AccentHead,
} from '../components/ui';
import { useGo } from '../nav/navigate';
import { Icon } from '../components/icons';
import { Sheet } from '../components/Sheet';
import { Foot } from '../components/AppBar';
import { fmtDate, money0 } from '../data/helpers';
import { shiftVariance } from '../data/logic';

const num = (v: string) => Number(String(v).replace(/[^0-9.]/g, '')) || 0;

/** Reference shiftVar(expected, counted), line 7294. */
function VarianceCard({ expected, counted }: { expected: number; counted: number }) {
  const { colors } = useTheme();
  const { money } = useAppData();
  const v = shiftVariance(expected, counted);
  if (v.state === 'balanced') {
    return (
      <View style={{ backgroundColor: colors.goodSoft, borderRadius: radius.md, padding: 14, alignItems: 'center', marginBottom: 12 }}>
        <Cap style={{ color: colors.good }}>Balanced</Cap>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.good, marginTop: 4 }}>
          The drawer matches the till
        </Text>
      </View>
    );
  }
  const short = v.state === 'short';
  const bg = short ? colors.dangerSoft : colors.warnSoft;
  const fg = short ? colors.danger : colors.warn;
  return (
    <View style={{
      backgroundColor: bg, borderRadius: radius.md, padding: 14, marginBottom: 12,
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12,
    }}>
      <View>
        <Cap style={{ color: fg }}>{short ? 'Short' : 'Over'}</Cap>
        <Text style={{ fontFamily: fonts.monoSemi, fontSize: 18, color: fg, marginTop: 3 }}>{money(Math.abs(v.diff))}</Text>
      </View>
      <Text style={{ flex: 1, maxWidth: '58%', textAlign: 'right', fontFamily: fonts.ui, fontSize: 11.5, lineHeight: 16.5, color: fg }}>
        Posted as {short ? 'an expense' : 'other income'} so the books still tie out
      </Text>
    </View>
  );
}

export default function ShiftScreen({ route }: any) {
  const { colors } = useTheme();
  const ctx = useAppData();
  const go = useGo();
  const { db, money, cur, me, user, activeShift, openShift, closeShift, shiftTotals, lastClosedShift } = ctx;

  const shift = activeShift();
  const [sheet, setSheet] = useState<null | 'open' | 'close'>(
    route?.params?.open ? 'open' : route?.params?.close ? 'close' : null,
  );

  const last = lastClosedShift();
  const [floatAmt, setFloatAmt] = useState(String(last?.countedCash ?? 150000));
  const [till, setTill] = useState(db?.session.till || 'Till 1');
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');

  if (!db) return null;

  const z = shift ? shiftTotals(shift) : null;

  // the close sheet opens with the expected amount already typed in — reference 7288
  function openClose() {
    if (!shift) return;
    setCounted(String(shiftTotals(shift).expected));
    setNote('');
    setSheet('close');
  }

  const past = db.shifts.filter((s) => s.closedAt).slice().reverse();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        {shift && z ? (
          <>
            {/* the open-register card — reference 7 */}
            <Card style={{ padding: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.good }} />
                <Text style={{ flex: 1, fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink }}>Register open</Text>
                <Badge label={shift.till} tone="good" />
              </View>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.soft, marginTop: 9 }}>
                Opened {fmtDate(shift.openedAt)}
              </Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
                Opened by {user(shift.userId)?.name}
              </Text>

              <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 14 }} />

              <DetailRow label="Opening float" value={money(shift.openingFloat)} />
              <DetailRow label="Cash sales" value={money(z.cash)} />
              <DetailRow label="Receipts into drawer" value={money(z.recv)} />
              <DetailRow label="Cash paid out" value={'− ' + money(z.paidOut)} tone={colors.danger} />
              <DetailRow label="Mobile money" value={money(z.momo)} />
              <DetailRow label="Bank" value={money(z.bank)} />
              <DetailRow label="On credit" value={money(z.credit)} tone={colors.warn} />
              <DetailRow label="Expected in drawer" value={money(z.expected)} bold last />

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label="Cash in"
                    icon={<Icon name="down" size={16} color={colors.good} />}
                    onPress={() => go('EntryNew', { direction: 'in' })}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label="Cash out"
                    icon={<Icon name="up" size={16} color={colors.danger} />}
                    onPress={() => go('EntryNew', { direction: 'out' })}
                  />
                </View>
              </View>
            </Card>

            <View style={{ height: 14 }} />
            <StatGrid
              items={[
                { icon: 'receipt', label: 'Bills this shift', value: String(z.count), tone: 'accent' },
                { icon: 'coins', label: 'Sales this shift', value: money(z.total), tone: 'good' },
              ]}
            />
          </>
        ) : (
          <Card>
            <EmptyState
              icon="clock"
              title="No shift open"
              subtitle="Open a shift with the cash you are starting with. Every sale is tagged to it."
              action={<Button size="sm" variant="pri" label="Open shift" onPress={() => setSheet('open')} />}
            />
          </Card>
        )}

        <View style={{ height: 18 }} />
        <AccentHead title="Session history" />
        <Card>
          {past.length ? past.map((s, i) => {
            const v = (s.countedCash || 0) - (s.expected || 0);
            const balanced = Math.abs(v) < 1;
            return (
              <View key={s.id} style={{
                flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14,
                borderBottomWidth: i === past.length - 1 ? 0 : 1, borderBottomColor: colors.line,
              }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }} numberOfLines={1}>
                    {user(s.userId)?.name} · {s.till}
                  </Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 1 }} numberOfLines={1}>
                    {fmtDate(s.openedAt)} → {fmtDate(s.closedAt as string)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontFamily: fonts.monoSemi, fontSize: 13, color: colors.ink }}>{money(s.countedCash || 0)}</Text>
                  <Text style={{
                    fontFamily: fonts.ui, fontSize: 11, marginTop: 1,
                    color: balanced ? colors.good : v < 0 ? colors.danger : colors.warn,
                  }}>
                    {balanced ? 'balanced' : (v > 0 ? '+' : '') + money0(v)}
                  </Text>
                </View>
              </View>
            );
          }) : (
            <View style={{ paddingVertical: 20 }}>
              <Text style={{ textAlign: 'center', fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>
                No closed shifts yet.
              </Text>
            </View>
          )}
        </Card>
      </ScrollView>

      <Foot>
        {shift ? (
          <Button variant="pri" label="Close shift" icon={<Icon name="lock" size={16} color={colors.accentInk} />} onPress={openClose} />
        ) : (
          <Button variant="pri" label="Open shift" icon={<Icon name="clock" size={16} color={colors.accentInk} />} onPress={() => setSheet('open')} />
        )}
      </Foot>

      {/* SHEETS.openShift — reference 7233 */}
      <Sheet
        visible={sheet === 'open'}
        title="Open a shift"
        icon="till"
        onClose={() => setSheet(null)}
        footer={<Button variant="pri" label="Start selling" onPress={() => {
          openShift(num(floatAmt), till);
          setSheet(null);
        }} />}
      >
        <Card style={{ padding: 13, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 11 }}>
          <Avatar name={me()?.name || ''} id={me()?.id} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{me()?.name}</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 1 }}>
              {fmtDate(new Date().toISOString())}
            </Text>
          </View>
        </Card>

        <BigAmount caption="Cash you are starting with" value={floatAmt} onChangeText={setFloatAmt} currency={cur()} />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 14 }}>
          {[50000, 100000, 150000, 200000].map((v) => (
            <ActionChip key={v} label={money0(v)} onPress={() => setFloatAmt(String(v))} />
          ))}
        </View>

        <Field label="Till" value={till} onChangeText={setTill} />

        {last ? (
          <Card style={{ paddingVertical: 4, paddingHorizontal: 14 }}>
            <KV label="Last shift closed" value={fmtDate(last.closedAt as string)} />
            <KV label="Counted then" value={money(last.countedCash || 0)} />
            <KV
              label="Variance"
              value={money(Math.abs((last.countedCash || 0) - (last.expected || 0)))}
              valueColor={Math.abs((last.countedCash || 0) - (last.expected || 0)) < 1 ? colors.good : colors.danger}
              last
            />
          </Card>
        ) : (
          <FieldNote>Count the float before you start — the day close compares it against what the till says.</FieldNote>
        )}
      </Sheet>

      {/* SHEETS.closeShift — reference 7262 */}
      <Sheet
        visible={sheet === 'close'}
        title="Close the shift"
        icon="lock"
        onClose={() => setSheet(null)}
        footer={
          <Button variant="pri" label="Close & post" disabled={!counted.trim()} onPress={() => {
            if (!shift) return;
            const v = shiftVariance(shiftTotals(shift).expected, num(counted));
            const go = () => { closeShift(shift.id, num(counted), note); setSheet(null); };
            if (v.state === 'balanced') { go(); return; }
            Alert.alert(
              'The drawer is ' + v.state,
              money(Math.abs(v.diff)) + ' ' + v.state + '. It will be posted as ' +
                (v.state === 'short' ? 'an expense' : 'other income') + ' so the books tie out.',
              [{ text: 'Cancel', style: 'cancel' }, { text: 'Close & post', onPress: go }],
            );
          }} />
        }
      >
        {shift && z ? (
          <>
            <Card style={{ paddingVertical: 4, paddingHorizontal: 14, marginBottom: 12 }}>
              <KV label="Opened" value={fmtDate(shift.openedAt)} />
              <KV label="Bills rung up" value={String(z.count)} />
              <KV label="Sold" value={money(z.total)} last />
            </Card>

            <Card style={{ paddingVertical: 4, paddingHorizontal: 14, marginBottom: 12 }}>
              <KV label="Opening float" value={money(shift.openingFloat)} />
              <KV label="Cash sales" value={money(z.cash)} />
              <KV label="Receipts in" value={money(z.recv)} />
              <KV label="Paid out" value={'− ' + money(z.paidOut)} valueColor={colors.danger} />
              <KV label="Drawer should hold" value={money(z.expected)} bold last />
            </Card>

            <BigAmount caption="Count the drawer" value={counted} onChangeText={setCounted} currency={cur()} />
            <VarianceCard expected={z.expected} counted={num(counted)} />
            <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="Anything that explains a difference" />
          </>
        ) : (
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>No shift is open.</Text>
        )}
      </Sheet>
    </View>
  );
}
