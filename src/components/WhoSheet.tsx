/**
 * "Who is recording this?"
 *
 * Every posting the shop makes is stamped with a person. The signed-in user is
 * offered first as a single big tap, so the common case costs one touch, but a
 * shared till can hand the sale to whoever actually served it. When the shop
 * asks for a PIN, the chosen person confirms with theirs — that is what makes
 * the stamp worth trusting.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Button, SectionLabel, InfoBanner, Avatar } from './ui';
import { Icon } from './icons';
import Sheet from './Sheet';

export interface WhoResult {
  userId: string;
  userName: string;
}

/**
 * Drives the sheet. Call `ask(fn)` where you would have saved; `fn` runs with
 * the chosen person once they confirm. Render `sheet` somewhere in the screen.
 */
export function useWho(title = 'Who is recording this?') {
  const { db, me } = useAppData();
  const [pending, setPending] = useState<null | ((who: WhoResult) => void)>(null);

  function ask(run: (who: WhoResult) => void) {
    const enabled = db?.settings.askWhoOnSave !== false;
    const current = me();
    if (!enabled || !current) {
      // Accountability is switched off, or nobody is signed in — stamp the session.
      run({ userId: current?.id || db?.session.userId || '', userName: current?.name || 'Unknown' });
      return;
    }
    setPending(() => run);
  }

  const sheet = (
    <WhoSheet
      visible={pending !== null}
      title={title}
      onCancel={() => setPending(null)}
      onPick={(who) => {
        const run = pending;
        setPending(null);
        run?.(who);
      }}
    />
  );

  return { ask, sheet };
}

function WhoSheet({ visible, title, onPick, onCancel }: {
  visible: boolean; title: string; onPick: (w: WhoResult) => void; onCancel: () => void;
}) {
  const { colors } = useTheme();
  const { db, me } = useAppData();
  const current = me();

  /** Who the sheet will record, highlighted until it is confirmed. */
  const [picked, setPicked] = useState<string | null>(null);
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);

  const staff = useMemo(() => (db?.users || []).filter((u) => u.active), [db]);
  const needPin = db?.settings.requirePinOnSave === true;

  // default to the signed-in person each time the sheet opens
  React.useEffect(() => {
    if (visible) {
      setPicked(current?.id || staff[0]?.id || null);
      setPinFor(null); setPin(''); setWrong(false);
    }
  }, [visible]);

  function close() {
    setPicked(null); setPinFor(null); setPin(''); setWrong(false);
    onCancel();
  }

  function finish() {
    const u = staff.find((x) => x.id === picked);
    if (!u) return;
    if (needPin) { setPinFor(u.id); setPin(''); setWrong(false); return; }
    close();
    onPick({ userId: u.id, userName: u.name });
  }

  function press(d: string) {
    if (!pinFor) return;
    const next = pin + d;
    setPin(next);
    if (next.length < 4) return;
    const u = staff.find((x) => x.id === pinFor);
    if (u && u.pin === next) {
      close();
      onPick({ userId: u.id, userName: u.name });
    } else {
      setWrong(true);
      setTimeout(() => { setPin(''); setWrong(false); }, 400);
    }
  }

  const who = staff.find((x) => x.id === pinFor);
  const chosen = staff.find((x) => x.id === picked);

  return (
    <Sheet
      visible={visible}
      title={who ? who.name + '\u2019s PIN' : title}
      subtitle={who ? 'Four digits to confirm' : 'The person who served this goes on the record'}
      icon={who ? 'lock' : 'user'}
      iconTone="accent"
      onClose={close}
      footer={
        who ? (
          <Button label="Choose somebody else" onPress={() => { setPinFor(null); setPin(''); }} />
        ) : (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Button label="Cancel" onPress={close} /></View>
            <View style={{ flex: 2 }}>
              <Button
                label={chosen ? 'Confirm \u00b7 ' + chosen.name : 'Confirm'}
                variant="pri"
                disabled={!chosen}
                icon={<Icon name="check" size={17} color={colors.accentInk} />}
                onPress={finish}
              />
            </View>
          </View>
        )
      }
    >
      {!who ? (
        <>
          <SectionLabel>Recording as</SectionLabel>
          <View style={{ gap: 10 }}>
            {staff.map((u) => {
              const on = u.id === picked;
              return (
                <Pressable
                  key={u.id}
                  onPress={() => setPicked(u.id)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 13,
                    borderRadius: radius.md, borderWidth: 1.5,
                    borderColor: on ? colors.accent : colors.line,
                    backgroundColor: on ? colors.accentSoft : colors.surface,
                    paddingHorizontal: 15, paddingVertical: 14,
                  }}
                >
                  <Avatar name={u.name} id={u.id} size={46} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 16, color: colors.ink }}>{u.name}</Text>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                      {u.id === current?.id ? 'Signed in' : u.role.charAt(0).toUpperCase() + u.role.slice(1)}
                    </Text>
                  </View>
                  {on ? <Icon name="check" size={23} color={colors.accent} /> : null}
                </Pressable>
              );
            })}
          </View>

          <View style={{ height: 16 }} />
          <InfoBanner
            tone="neutral"
            icon="shield"
            text="Whoever is chosen is stamped on the record and counts towards their figures."
          />
        </>
      ) : (
        <View>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, paddingVertical: 22 }}>
            {[0, 1, 2, 3].map((i) => (
              <View
                key={i}
                style={{
                  width: 15, height: 15, borderRadius: 8,
                  backgroundColor: wrong ? colors.danger : i < pin.length ? colors.accent : colors.lineHard,
                }}
              />
            ))}
          </View>
          {wrong ? (
            <Text style={{ textAlign: 'center', fontFamily: fonts.uiSemi, fontSize: 13, color: colors.danger, marginBottom: 10 }}>
              That PIN is not right.
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
                  backgroundColor: k && k !== 'del' ? (pressed ? colors.accentSoft : colors.sunk) : 'transparent',
                })}
              >
                {k === 'del'
                  ? <Icon name="back" size={22} color={colors.faint} />
                  : <Text style={{ fontFamily: fonts.uiBold, fontSize: 23, color: colors.ink }}>{k}</Text>}
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </Sheet>
  );
}
