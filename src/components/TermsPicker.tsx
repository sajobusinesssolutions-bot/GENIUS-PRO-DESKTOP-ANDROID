/**
 * Which terms this document carries: the shop's named sets as chips, the
 * chosen text underneath, still editable for this one document.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Pressable } from './Press';
import { Field } from './form';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { termsSets } from '../data/docDefaults';

export default function TermsPicker({ value, onChange, chosenId, onChoose }: {
  value: string; onChange: (text: string) => void;
  chosenId: string | null; onChoose: (id: string | null, text: string) => void;
}) {
  const { colors } = useTheme();
  const { db } = useAppData();
  const sets = termsSets(db);
  return (
    <View>
      {sets.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {[...sets, { id: '', name: 'None', text: '' }].map((s) => {
            const on = (chosenId || '') === s.id;
            return (
              <Pressable key={s.id || 'none'} onPress={() => onChoose(s.id || null, s.text)}
                style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1.2,
                  borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accentSoft : colors.surface }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: on ? colors.accent : colors.ink }}>{s.name}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <Field icon="doc" label="Terms & conditions" value={value} onChangeText={onChange} placeholder="Printed on the document" multiline style={{ marginBottom: 0 }} />
    </View>
  );
}
