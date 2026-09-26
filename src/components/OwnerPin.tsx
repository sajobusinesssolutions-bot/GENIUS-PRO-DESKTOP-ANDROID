/**
 * The owner's PIN, asked before a change that rewrites many records at once.
 *
 * A bulk edit cannot be undone line by line, so it is gated on the person who
 * carries the loss if it is wrong — not merely on whoever is signed in.
 */
import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { verifyPin } from '../data/pinHash';
import { Button, InfoBanner, Avatar, SectionLabel } from './ui';
import { Icon } from './icons';
import Sheet from './Sheet';

/**
 * `ask(fn)` runs `fn` once an owner has entered their PIN. Render `sheet`.
 * `summary` is shown above the keypad so the owner sees what they are approving.
 */
export function useOwnerPin() {
  const { db } = useAppData();
  const [pending, setPending] = useState<null | (() => void)>(null);
  const [summary, setSummary] = useState('');

  function ask(what: string, run: () => void) {
    const owners = (db?.users || []).filter((u) => u.active && u.role === 'owner');
    if (!owners.length) {
      // No owner account exists, so there is nobody to approve it — let it through.
      run();
      return;
    }
    setSummary(what);
    setPending(() => run);
  }

  const sheet = (
    <OwnerPinSheet
      visible={pending !== null}
      summary={summary}
      onCancel={() => setPending(null)}
      onOk={() => {
        const run = pending;
        setPending(null);
        run?.();
      }}
    />
  );

  return { ask, sheet };
}

function OwnerPinSheet({ visible, summary, onOk, onCancel }: {
  visible: boolean; summary: string; onOk: () => void; onCancel: () => void;
}) {
  const { colors } = useTheme();
  const { db } = useAppData();
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);

  const owners = (db?.users || []).filter((u) => u.active && u.role === 'owner');

  function close() {
    setPin(''); setWrong(false);
    onCancel();
  }

  function press(d: string) {
    const next = pin + d;
    setPin(next);
    if (next.length < 4) return;
    if (owners.some((o) => verifyPin(next, o.pin))) {
      setPin(''); setWrong(false);
      onOk();
    } else {
      setWrong(true);
      setTimeout(() => { setPin(''); setWrong(false); }, 400);
    }
  }

  return (
    <Sheet
      visible={visible}
      title="Owner approval"
      subtitle="This changes many records at once"
      icon="lock"
      iconTone="warn"
      onClose={close}
      footer={<Button label="Cancel" onPress={close} />}
    >
      <InfoBanner tone="warn" icon="alert" text={summary} />

      <View style={{ height: 18 }} />
      <SectionLabel>Any owner can approve</SectionLabel>
      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        {owners.map((o) => (
          <View key={o.id} style={{ alignItems: 'center', gap: 6, width: 72 }}>
            <Avatar name={o.name} id={o.id} size={44} />
            <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: colors.faint }}>{o.name}</Text>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, paddingVertical: 20 }}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={{
              width: 15, height: 15, borderRadius: 8,
              backgroundColor: wrong ? colors.danger : i < pin.length ? colors.warn : colors.lineHard,
            }}
          />
        ))}
      </View>
      {wrong ? (
        <Text style={{ textAlign: 'center', fontFamily: fonts.uiSemi, fontSize: 13, color: colors.danger, marginBottom: 10 }}>
          That is not an owner PIN.
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 11 }}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k, i) => (
          <Pressable
            key={i}
            disabled={!k}
            onPress={() => (k === 'del' ? setPin(pin.slice(0, -1)) : k ? press(k) : undefined)}
            style={({ pressed }) => ({
              width: '29%', height: 58, borderRadius: 16,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: k && k !== 'del' ? (pressed ? colors.warnSoft : colors.sunk) : 'transparent',
            })}
          >
            {k === 'del'
              ? <Icon name="back" size={22} color={colors.faint} />
              : <Text style={{ fontFamily: fonts.uiBold, fontSize: 23, color: colors.ink }}>{k}</Text>}
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}
