/**
 * CHECK THE BOOKS. The computer sends what its books say for each of the last
 * 30 days (sync engine, pcCheck); this sets the phone's own figures beside
 * them. A day where the two disagree is a record that went missing, arrived
 * twice, or has not synced yet — so the owner finds out from this screen, not
 * from a customer's statement.
 */
import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import ScrollView from '../components/KeyScroll';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Panel, SectionLabel } from '../components/kit';
import { InfoBanner } from '../components/ui';
import { activeBranchId } from '../data/branch';

type Kind = 'sales' | 'purchases' | 'expenses';
const WORD: Record<Kind, string> = { sales: 'Sales', purchases: 'Purchases', expenses: 'Expenses' };

export default function BooksCheckScreen() {
  const { colors } = useTheme();
  const { db, money } = useAppData();

  const rows = useMemo(() => {
    const pc = db?.firm.pcCheck;
    if (!db || !pc) return null;
    const here = activeBranchId(db);
    const mine = (b?: string) => !b || b === here;
    const phone: Record<string, Partial<Record<Kind, [number, number]>>> = {};
    const add = (day: string, k: Kind, v: number) => {
      if (day < pc.since) return;
      const d = (phone[day] = phone[day] || {});
      const x = d[k] || [0, 0];
      d[k] = [x[0] + 1, x[1] + v];
    };
    db.sales.forEach((s) => { if (s.status !== 'void' && !s.deletedAt && mine((s as any).branch ?? s.warehouse)) add(s.ts.slice(0, 10), 'sales', s.total); });
    db.purchases.forEach((x) => { if (x.status !== 'void' && !x.deletedAt && mine(x.branch)) add(x.ts.slice(0, 10), 'purchases', x.total); });
    db.entries.forEach((e) => { if (e.direction === 'out' && mine(e.branch)) add(e.ts.slice(0, 10), 'expenses', e.amount); });
    const days = [...new Set([...Object.keys(pc.days), ...Object.keys(phone)])].filter((d) => d >= pc.since).sort().reverse();
    return days.map((day) => {
      const diffs = (['sales', 'purchases', 'expenses'] as Kind[]).map((k) => {
        const a = pc.days[day]?.[k] || [0, 0], b = phone[day]?.[k] || [0, 0];
        return { k, pc: a, phone: b, off: a[0] !== b[0] || Math.abs(a[1] - b[1]) > 1 };
      }).filter((x) => x.off);
      return { day, diffs };
    });
  }, [db]);

  if (!db) return null;
  const pc = db.firm.pcCheck;
  const bad = (rows || []).filter((r) => r.diffs.length);
  const waiting = db.queue.length;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 40 }}>
      {!pc ? (
        <InfoBanner tone="accent" icon="alert" text="The computer has not sent its figures yet. Make sure Sync is on in Genius POS on the computer (1.83 or newer); they arrive with the next sync." />
      ) : (
        <>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>
            Computer's figures from {new Date(pc.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · last 30 days
          </Text>
          {waiting ? <InfoBanner tone="warn" icon="alert" text={waiting + ' change' + (waiting === 1 ? '' : 's') + ' on this phone not sent yet — sync first, or those days will differ.'} /> : null}
          {!bad.length ? (
            <InfoBanner tone="good" icon="check" text="The phone and the computer agree on every day: sales, purchases and expenses." />
          ) : (
            <>
              <InfoBanner tone="danger" icon="alert" text={bad.length + ' day' + (bad.length === 1 ? '' : 's') + ' disagree. Open that day on both and compare the bills.'} />
              {bad.map((r) => (
                <View key={r.day}>
                  <SectionLabel>{new Date(r.day + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</SectionLabel>
                  <Panel>
                    {r.diffs.map((x, i) => (
                      <View key={x.k} style={{ paddingVertical: 8, borderBottomWidth: i === r.diffs.length - 1 ? 0 : 1, borderBottomColor: colors.line }}>
                        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>{WORD[x.k]}</Text>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 }}>
                          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.soft }}>Computer: {x.pc[0]} · {money(x.pc[1])}</Text>
                          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.danger }}>Phone: {x.phone[0]} · {money(x.phone[1])}</Text>
                        </View>
                      </View>
                    ))}
                  </Panel>
                </View>
              ))}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}
