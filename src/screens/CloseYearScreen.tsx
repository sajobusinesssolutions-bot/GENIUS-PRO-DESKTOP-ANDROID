/**
 * Close a financial year and start new books (yearSplit.ts, useSyncRun closeYear).
 *
 * The owner picks the year's last day. Every balance on that day becomes the
 * opening of the next: each ledger, what each customer and supplier owes, the
 * stock. The year's sales, bills, payments and journals move to a business of
 * their own, "NAME · to DATE", kept on this phone and (for a business on the
 * account) online, locked, to open from Businesses any time.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Alert } from 'react-native';
import ScrollView from '../components/KeyScroll';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useSyncRun } from '../data/useSyncRun';
import DateRow from '../components/DateRow';
import { Button } from '../components/ui';
import { ToolCard } from '../components/ToolCard';
import { previewYearSplit, dayOf } from '../data/yearSplit';

const lastYearEnd = () => new Date(new Date().getFullYear() - 1, 11, 31, 12, 0, 0);

export default function CloseYearScreen({ navigation }: { navigation?: any }) {
  const { db } = useAppData();
  if (!db) return null;
  return <CloseYear db={db} navigation={navigation} />;
}

function CloseYear({ db, navigation }: { db: import('../data/types').DB; navigation?: any }) {
  const { colors } = useTheme();
  const { closeYear } = useSyncRun();
  const [at, setAt] = useState(lastYearEnd);
  const [busy, setBusy] = useState(false);
  const to = dayOf(at.toISOString());
  const pv = useMemo(() => previewYearSplit(db, to), [db, to]);
  const online = !!(db.sync?.on && db.sync?.businessId);
  const owner = db.session.role === 'owner';
  const archive = db.settings.yearArchiveOf;
  const name = db.firm.name || 'this business';
  const moving = ([[pv.sales, 'sale'], [pv.purchases, 'bill'], [pv.payments, 'payment'], [pv.entries, 'money entry', 'money entries'], [pv.returns, 'return'], [pv.journal, 'ledger entry', 'ledger entries']] as Array<[number, string, string?]>)
    .filter(([n]) => n > 0).map(([n, one, many]) => n + ' ' + (n === 1 ? one : many || one + 's'));

  const go = () => Alert.alert(
    'Close the year to ' + to + '?',
    'Every balance on ' + to + ' becomes the opening of ' + pv.opens + '. The year\'s records move to “' + name + ' · to ' + to + '”'
      + (online ? ', kept on this phone and on the account. Every phone and computer on the account closes its copy at the same day when it next syncs.' : ', kept on this phone.')
      + ' This is not undone from here.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close the year', style: 'destructive', onPress: async () => {
          setBusy(true);
          const r = await closeYear(to);
          setBusy(false);
          Alert.alert(r.ok ? 'New books started' : 'The year was not closed', r.message);
          if (r.ok) navigation?.goBack?.();
        },
      },
    ],
  );

  const p = (t: string, faint = false) => <Text style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 19, color: faint ? colors.faint : colors.soft, marginBottom: 8 }}>{t}</Text>;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {archive ? (
        <ToolCard icon="calendar" tone="accent" title={'The year to ' + (db.settings.yearArchiveTo || '')} sub="Kept for reference">
          {p('These are the books of a closed year. Nothing new goes in, and they cannot be closed again. Open the business carrying on from Businesses to record new work.')}
        </ToolCard>
      ) : (
        <ToolCard icon="calendar" tone="warn" title="Close the year and start new books" sub={db.settings.yearClosedTo ? 'Last closed to ' + db.settings.yearClosedTo : 'No year closed yet'}>
          {p('The new year opens with every balance carried in: each ledger, what each customer and supplier owes, and the stock. The closed year is kept whole as a business of its own, locked. Open it from Businesses any time to look back.')}
          <DateRow value={at} onChange={setAt} label="Last day of the year" withTime={false} />
          <View style={{ marginTop: 10, marginBottom: 6 }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>New books open on {pv.opens}</Text>
            {p(moving.length ? 'To the closed year: ' + moving.join(', ') + '.' : 'Nothing is dated in that year.')}
            {!online ? p('This business is not on the account, so the closed year is kept on this phone only. Turn on sync first to keep it online too.', true) : null}
            {!owner ? p('Only the owner can close a year.', true) : null}
          </View>
          <Button variant="pri" label="Close the year" loading={busy} disabled={!owner || busy || (!!pv.closedTo && pv.closedTo >= to)} onPress={go} />
        </ToolCard>
      )}
    </ScrollView>
  );
}
