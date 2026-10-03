/**
 * Moving over from Vyapar: choose the backup Vyapar saved (.vyb), pick which
 * of its businesses to bring in, and it is added to these books. Importing the
 * same backup again only adds what is new.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { pickReadableFile } from '../data/pickFile';
import { Pressable } from '../components/Press';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Button, InfoBanner, StickyBar } from '../components/ui';
import { Icon } from '../components/icons';
import { readVyaparBackup } from '../data/vyaparRead';
import { vyaparFirms, VyTables, VyFirm, ImportReport } from '../data/vyapar';

export default function VyaparImportScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { importFromVyapar } = useAppData();
  const [tables, setTables] = useState<VyTables | null>(null);
  const [fileName, setFileName] = useState('');
  const [firms, setFirms] = useState<VyFirm[]>([]);
  const [firmId, setFirmId] = useState<number | null>(null);
  const [busy, setBusy] = useState<'read' | 'import' | null>(null);
  const [err, setErr] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);

  async function choose() {
    setErr('');
    const picked = await pickReadableFile();
    if (!picked) return;
    const source = picked.file;
    const name = picked.name;
    setBusy('read');
    try {
      const t = await readVyaparBackup(source);
      const list = vyaparFirms(t);
      setTables(t);
      setFileName(name || 'Vyapar backup');
      setFirms(list);
      // the business with the most going on is the likely one
      const busiest = [...list].sort((a, b) => total(b) - total(a))[0];
      setFirmId(busiest?.id ?? null);
      setReport(null);
    } catch (e: any) {
      setErr(e?.message || 'That file could not be read.');
    } finally {
      setBusy(null);
    }
  }

  function run() {
    if (!tables || firmId == null) return;
    setBusy('import');
    // let the spinner paint before the work starts
    setTimeout(() => {
      try {
        setReport(importFromVyapar(tables, firmId));
      } catch (e: any) {
        setErr(e?.message || 'The import stopped.');
      } finally {
        setBusy(null);
      }
    }, 60);
  }

  const total = (f: VyFirm) => Object.values(f.counts).reduce((a, b) => a + b, 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 130 }}>
        {report ? (
          <>
            <View style={{ alignItems: 'center', paddingVertical: 18, gap: 8 }}>
              <View style={{ width: 60, height: 60, borderRadius: 20, backgroundColor: colors.goodSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="check" size={28} color={colors.good} />
              </View>
              <Text style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }}>{report.firm} is in</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, color: colors.faint, textAlign: 'center' }}>
                Everything below was added to these books{report.skipped ? ', and ' + report.skipped + ' record(s) already here were left alone' : ''}.
              </Text>
            </View>
            <View style={{ borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 8 }}>
              {([
                ['Customers & suppliers', report.parties], ['Items', report.items], ['Sales', report.sales],
                ['Purchases', report.purchases], ['Payments', report.payments], ['Expenses', report.expenses],
                ['Quotations & orders', report.quotes], ['Returns', report.returns], ['Opening balances', report.openings],
              ] as [string, number][]).map(([l, n]) => (
                <View key={l} style={{ flexDirection: 'row' }}>
                  <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 14, color: colors.soft }}>{l}</Text>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.ink }}>{n}</Text>
                </View>
              ))}
            </View>
            {report.details.length ? (
              <View style={{ marginTop: 10 }}>
                <InfoBanner tone="good" icon="check" text={'Business details taken from Vyapar: ' + report.details.join(', ') + '.'} />
              </View>
            ) : null}
            {report.notes.map((n) => (
              <View key={n} style={{ marginTop: 10 }}><InfoBanner tone="warn" icon="alert" text={n} /></View>
            ))}
          </>
        ) : (
          <>
            <View style={{ borderRadius: 16, backgroundColor: colors.accentSoft, padding: 14, gap: 6, marginBottom: 14 }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>Move from Vyapar</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, lineHeight: 19, color: colors.soft }}>
                In Vyapar, take a backup (Settings → Backup), then choose that .vyb file here. Customers, suppliers, items with their
                stock, sales, purchases, payments, expenses and quotations come across, and what is owed stays owed.
              </Text>
            </View>

            <Pressable
              onPress={busy ? undefined : choose}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.md,
                borderWidth: 1.4, borderStyle: tables ? 'solid' : 'dashed', borderColor: colors.accent, backgroundColor: colors.surface, marginBottom: 14,
              }}
            >
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                {busy === 'read' ? <ActivityIndicator color={colors.accent} /> : <Icon name={tables ? 'doc' : 'down'} size={19} color={colors.accent} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>
                  {busy === 'read' ? 'Reading the backup…' : tables ? fileName : 'Choose the Vyapar backup'}
                </Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
                  {tables ? 'Tap to choose a different file' : 'A .vyb file from Vyapar'}
                </Text>
              </View>
            </Pressable>

            {err ? <InfoBanner tone="danger" icon="alert" text={err} /> : null}

            {firms.length ? (
              <>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, letterSpacing: 0.6, color: colors.faint, textTransform: 'uppercase', marginBottom: 8 }}>
                  Which business to bring in
                </Text>
                {firms.map((f) => {
                  const on = f.id === firmId;
                  const c = f.counts;
                  return (
                    <Pressable
                      key={f.id}
                      onPress={() => setFirmId(f.id)}
                      style={{
                        padding: 14, borderRadius: 16, marginBottom: 10, gap: 4,
                        borderWidth: 1.4, borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accentSoft : colors.surface,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{f.name}</Text>
                        {on ? <Icon name="check" size={17} color={colors.accent} /> : null}
                      </View>
                      {f.phone || f.email ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{[f.phone, f.email].filter(Boolean).join(' · ')}</Text> : null}
                      <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.soft }}>
                        {[
                          c.sales && c.sales + ' sales', c.purchases && c.purchases + ' purchases', c.payments && c.payments + ' payments',
                          c.expenses && c.expenses + ' expenses', c.quotes && c.quotes + ' quotes', c.returns && c.returns + ' returns',
                        ].filter(Boolean).join(' · ') || 'Nothing recorded'}
                      </Text>
                    </Pressable>
                  );
                })}
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 18, color: colors.faint, marginTop: 4 }}>
                  It is added to the books you have open, and its business details — name, phones, address, TIN, bank details, logo and signature — replace this business's own (anything blank in Vyapar is kept). Customers and items already here are matched by name and reused.
                  Run it again for another business, or later with a newer backup — nothing comes in twice.
                </Text>
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      <StickyBar>
        {report ? (
          <Button variant="pri" label="Done" onPress={() => navigation.goBack()} />
        ) : (
          <Button
            variant="pri"
            label={busy === 'import' ? 'Importing…' : firmId != null && tables ? 'Import ' + (firms.find((f) => f.id === firmId)?.name || '') : 'Choose a backup first'}
            loading={busy === 'import'}
            disabled={!tables || firmId == null || !!busy}
            icon={<Icon name="down" size={17} color={colors.accentInk} />}
            onPress={run}
          />
        )}
      </StickyBar>
    </View>
  );
}
