import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Button, Field, SectionLabel, InfoBanner, StickyBar } from '../components/ui';
import { Icon, IconName } from '../components/icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;

// Fuller multi-step wizard modeled on the prototype's `.onbbar` (step dots),
// `.onbtitle` (step heading) and `.typegrid` / `.typecard` (business-type
// picker) elements: business type -> business details -> branch -> currency
// & tax -> owner PIN -> done.
const STEPS = ['Type', 'Business', 'Branch', 'Tax', 'PIN', 'Done'];

const STEP_HEAD: Array<{ icon: IconName; title: string; sub: string }> = [
  { icon: 'till', title: 'What kind of business?', sub: 'This sets up sensible defaults you can change later.' },
  { icon: 'owner', title: 'Set up your store', sub: 'The name and number printed on every receipt.' },
  { icon: 'home', title: 'Your first branch', sub: 'Each branch counts its own stock and its own till.' },
  { icon: 'bank', title: 'Currency & tax', sub: 'How money and tax are handled on every bill.' },
  { icon: 'lock', title: 'Set your owner PIN', sub: 'Four digits that unlock the app for the owner account.' },
  { icon: 'check', title: 'You are all set', sub: 'Everything is ready — you can start selling.' },
];

const BUSINESS_TYPES = [
  { id: 'retail', label: 'Retail shop', emoji: '🛒', sub: 'General goods over the counter' },
  { id: 'hardware', label: 'Hardware', emoji: '🧱', sub: 'Building and construction supply' },
  { id: 'restaurant', label: 'Restaurant / bar', emoji: '🍽️', sub: 'Food and drink service' },
  { id: 'pharmacy', label: 'Pharmacy', emoji: '💊', sub: 'Medicines, batches and expiry' },
  { id: 'salon', label: 'Salon / services', emoji: '💈', sub: 'Services sold by time' },
  { id: 'wholesale', label: 'Wholesale', emoji: '📦', sub: 'Bulk supply and distribution' },
  { id: 'electronics', label: 'Electronics', emoji: '🔌', sub: 'Serials and warranties' },
  { id: 'other', label: 'Other', emoji: '🏪', sub: 'Something else entirely' },
];

export default function OnboardingScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { setOnboarded, db, updateUser, updateFirm, me } = useAppData();
  const [step, setStep] = useState(0);
  const [businessType, setBusinessType] = useState('retail');
  const [name, setName] = useState(db?.firm.name || '');
  const [phone, setPhone] = useState(db?.firm.phone || '');
  const [branchName, setBranchName] = useState(db?.warehouses[0]?.name || 'Main shop');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');

  const canNext = step === 1 ? name.trim().length > 0 : step === 4 ? pin.length === 4 && pin === pinConfirm : true;
  const head = STEP_HEAD[step];

  function next() {
    if (step === 1) updateFirm({ name, phone, businessType });
    if (step === 4 && pin.length === 4 && me()) updateUser(me()!.id, { pin });
    if (step < STEPS.length - 1) setStep(step + 1);
    else {
      setOnboarded(true);
      navigation.replace('PinLock', {});
    }
  }
  function back() { if (step > 0) setStep(step - 1); }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
        {/* progress */}
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 26 }}>
          {STEPS.map((_, i) => (
            <View key={i} style={{ flex: 1, height: 5, borderRadius: 99, backgroundColor: i <= step ? colors.accent : colors.lineHard }} />
          ))}
        </View>

        {/* the centred hero — reference 12 */}
        <View style={{ alignItems: 'center', marginBottom: 26 }}>
          <View style={{ width: 78, height: 78, borderRadius: 39, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={head.icon} size={34} color={colors.accent} />
          </View>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 23, color: colors.ink, marginTop: 16, textAlign: 'center', letterSpacing: -0.4 }}>
            {head.title}
          </Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, lineHeight: 20, color: colors.faint, marginTop: 7, textAlign: 'center' }}>
            {head.sub}
          </Text>
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, letterSpacing: 0.5, color: colors.faint, marginTop: 12 }}>
            STEP {step + 1} OF {STEPS.length}
          </Text>
        </View>

        {step === 0 && (
          <View style={{ gap: 10 }}>
            {BUSINESS_TYPES.map((t) => {
              const on = businessType === t.id;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setBusinessType(t.id)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 13,
                    borderRadius: radius.lg, borderWidth: 1.5, paddingHorizontal: 15, paddingVertical: 14,
                    borderColor: on ? colors.accent : colors.line,
                    backgroundColor: on ? colors.accentSoft : colors.surface,
                  }}
                >
                  <Text style={{ fontSize: 26 }}>{t.emoji}</Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{t.label}</Text>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>{t.sub}</Text>
                  </View>
                  {on ? <Icon name="check" size={20} color={colors.accent} /> : <Icon name="chev" size={18} color={colors.faint} />}
                </Pressable>
              );
            })}
          </View>
        )}

        {step === 1 && (
          <>
            <SectionLabel>Store details</SectionLabel>
            <Field icon="owner" label="Business name *" value={name} onChangeText={setName} placeholder="The name on your receipts" />
            <Field icon="phone" label="Phone number" value={phone} onChangeText={setPhone} placeholder="Optional" />
          </>
        )}

        {step === 2 && (
          <>
            <SectionLabel>First branch</SectionLabel>
            <Field icon="home" label="Branch name" value={branchName} onChangeText={setBranchName} placeholder="What the branch is called" />
            <InfoBanner
              tone="accent"
              text="Name your first branch or till location. You can add more later under Business & Branches."
            />
          </>
        )}

        {step === 3 && (
          <InfoBanner
            tone="accent"
            icon="bank"
            text="Currency is set to Sh (Ugandan Shilling) with VAT at 18%, and EFRIS e-invoicing enabled for URA reporting. You can change all of this later in Settings."
          />
        )}

        {step === 4 && (
          <>
            <SectionLabel>Owner PIN</SectionLabel>
            <Field
              icon="lock"
              label="4-digit PIN *"
              value={pin}
              onChangeText={setPin}
              numeric
              secure
              maxLength={4}
              placeholder="····"
            />
            <Field
              icon="lock"
              label="Confirm PIN *"
              value={pinConfirm}
              onChangeText={setPinConfirm}
              numeric
              secure
              maxLength={4}
              placeholder="····"
              error={pin.length === 4 && pinConfirm.length === 4 && pin !== pinConfirm ? 'Those PINs do not match.' : undefined}
            />
          </>
        )}

        {step === 5 && (
          <InfoBanner
            tone="good"
            icon="check"
            text="Sample products, customers and demo history have been loaded so you can explore Genius POS right away."
          />
        )}
      </ScrollView>

      <StickyBar>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {step > 0 ? (
            <View style={{ flex: 1 }}>
              <Button label="Back" onPress={back} />
            </View>
          ) : null}
          <View style={{ flex: 2 }}>
            <Button
              label={step === STEPS.length - 1 ? 'Get started' : 'Continue'}
              variant="pri"
              disabled={!canNext}
              icon={<Icon name={step === STEPS.length - 1 ? 'check' : 'arrow'} size={17} color={colors.accentInk} />}
              onPress={next}
            />
          </View>
        </View>
      </StickyBar>
    </View>
  );
}
