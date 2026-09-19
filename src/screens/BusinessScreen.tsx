/**
 * THE BUSINESS — what is printed on every receipt, and where it trades.
 *
 * Everything here ends up on a document a customer keeps, so it is editable in
 * place rather than being a read-only summary pointing at Settings. The logo
 * and the signature are images the shop owns: both are copied into permanent
 * storage the moment they are chosen, because the picker hands back a cache
 * path that the operating system is free to delete — which is how an invoice
 * ends up printing a broken image three weeks later.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Image, Pressable, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from '../components/Toast';
import {
  Panel, Badge, ListRow, SectionLabel, DetailRow, Field, Button, StickyBar, InfoBanner, SelectField,
} from '../components/ui';
import { Icon, IconName } from '../components/icons';
import { useGo } from '../nav/navigate';
import { keepPhoto, dropPhoto } from '../data/photos';
import { canFor } from '../data/perms';

const TYPES = [
  { v: 'retail', l: 'Retail shop' },
  { v: 'hardware', l: 'Hardware' },
  { v: 'restaurant', l: 'Restaurant / bar' },
  { v: 'pharmacy', l: 'Pharmacy' },
  { v: 'salon', l: 'Salon / services' },
  { v: 'wholesale', l: 'Wholesale' },
  { v: 'electronics', l: 'Electronics' },
  { v: 'other', l: 'Other' },
];

/* ---------------------------------------------------------------- */

/**
 * An image the shop owns — its logo or the signature on its invoices.
 *
 * Offers the camera as well as the gallery: a shopkeeper with a paper letterhead
 * or a signed sheet in front of them will photograph it, not go looking for a
 * file.
 */
function ImageSlot({ label, hint, uri, onPick, onClear, tall }: {
  label: string; hint: string; uri?: string;
  onPick: (uri: string) => void; onClear: () => void; tall?: boolean;
}) {
  const { colors } = useTheme();
  const { error } = useToast();

  async function fromGallery() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { error('Allow photo access to choose an image.'); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsEditing: true });
    if (!r.canceled && r.assets?.[0]?.uri) onPick(r.assets[0].uri);
  }

  async function fromCamera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { error('Allow camera access to take a picture.'); return; }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: true });
    if (!r.canceled && r.assets?.[0]?.uri) onPick(r.assets[0].uri);
  }

  return (
    <View style={{ gap: 10 }}>
      <View>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{label}</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, lineHeight: 16.5, color: colors.faint, marginTop: 2 }}>
          {hint}
        </Text>
      </View>

      <View style={{
        height: tall ? 96 : 120,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.lineHard,
        borderStyle: uri ? 'solid' : 'dashed',
        backgroundColor: colors.sunk,
        alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
      }}>
        {uri ? (
          <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
        ) : (
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Icon name="camera" size={22} color={colors.lineHard} />
            <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>Nothing chosen</Text>
          </View>
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button size="sm" label="Take a picture" icon={<Icon name="camera" size={15} color={colors.ink} />} onPress={fromCamera} />
        </View>
        <View style={{ flex: 1 }}>
          <Button size="sm" label="Choose a file" icon={<Icon name="box" size={15} color={colors.ink} />} onPress={fromGallery} />
        </View>
        {uri ? (
          <Button size="sm" variant="dngr" label="Remove" onPress={onClear} />
        ) : null}
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- */

export default function BusinessScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const { db, setWarehouse, updateFirm } = useAppData();
  const { success, error } = useToast();
  const warehouses = db?.warehouses || [];
  const firm = db?.firm;

  const mayEdit = canFor(db?.session.role, 'settings');

  const [name, setName] = useState('');
  const [type, setType] = useState('retail');
  const [tin, setTin] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [phone2, setPhone2] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [footer, setFooter] = useState('');
  const [logo, setLogo] = useState<string | undefined>();
  const [signature, setSignature] = useState<string | undefined>();

  // loaded once the book is there, and again if the firm is switched
  useEffect(() => {
    if (!firm) return;
    setName(firm.name || '');
    setType(firm.businessType || 'retail');
    setTin(firm.tin || '');
    setEmail(firm.email || '');
    setPhone(firm.phone || '');
    setPhone2(firm.phone2 || '');
    setAddress(firm.address || '');
    setDescription(firm.description || '');
    setFooter(firm.footer || '');
    setLogo(firm.logo);
    setSignature(firm.signature);
  }, [firm?.id]);

  const dirty = useMemo(() => {
    if (!firm) return false;
    return name !== (firm.name || '')
      || type !== (firm.businessType || 'retail')
      || tin !== (firm.tin || '')
      || email !== (firm.email || '')
      || phone !== (firm.phone || '')
      || phone2 !== (firm.phone2 || '')
      || address !== (firm.address || '')
      || description !== (firm.description || '')
      || footer !== (firm.footer || '')
      || logo !== firm.logo
      || signature !== firm.signature;
  }, [firm, name, type, tin, email, phone, phone2, address, description, footer, logo, signature]);

  if (!db || !firm) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  function save() {
    if (!name.trim()) { error('The business needs a name — it is printed on every receipt.'); return; }
    updateFirm({
      name: name.trim(),
      businessType: type,
      tin: tin.trim(),
      email: email.trim(),
      phone: phone.trim(),
      phone2: phone2.trim(),
      address: address.trim(),
      description: description.trim(),
      footer: footer.trim(),
      logo,
      signature,
    });
    success('Saved — this is what prints on your documents');
  }

  /** Copies the picked image somewhere it will survive, then keeps it. */
  function takeImage(setter: (u: string | undefined) => void, current: string | undefined, prefix: string) {
    return (uri: string) => {
      const kept = keepPhoto(uri, prefix);
      if (current && current !== kept) dropPhoto(current);
      setter(kept);
    };
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: mayEdit ? 120 : 28 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* what a customer sees */}
        <Panel>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
            <View style={{
              width: 56, height: 56, borderRadius: 17, overflow: 'hidden',
              backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center',
            }}>
              {logo
                ? <Image source={{ uri: logo }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
                : <Icon name="factory" size={25} color={colors.accent} />}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiExtra, fontSize: 19, color: colors.ink }}>
                {name || firm.name}
              </Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                {description || address || 'No address set'}
              </Text>
            </View>
          </View>
        </Panel>

        {!mayEdit ? (
          <>
            <View style={{ height: 14 }} />
            <InfoBanner
              tone="neutral"
              icon="lock"
              text="These details print on every receipt, so only someone with settings permission can change them."
            />
          </>
        ) : null}

        <View style={{ height: 18 }} />
        <SectionLabel>Printed on every document</SectionLabel>
        <Panel>
          <Field icon="factory" label="Business name" value={name} onChangeText={setName} readOnly={!mayEdit} placeholder="The name on your receipts" />
          <SelectField
            icon="tag" label="What kind of business" value={type}
            options={TYPES} onChange={setType}
          />
          <Field icon="doc" label="What it does" value={description} onChangeText={setDescription} readOnly={!mayEdit} placeholder="One line under the name, if you want one" />
          <Field icon="receipt" label="TIN" value={tin} onChangeText={setTin} readOnly={!mayEdit} placeholder="Tax number, if you have one" />
        </Panel>

        <View style={{ height: 18 }} />
        <SectionLabel>How customers reach you</SectionLabel>
        <Panel>
          <Field icon="phone" label="Phone" value={phone} onChangeText={setPhone} readOnly={!mayEdit} placeholder="The number on your receipts" />
          <Field icon="phone" label="Second phone" value={phone2} onChangeText={setPhone2} readOnly={!mayEdit} placeholder="Optional" />
          <Field icon="doc" label="Email" value={email} onChangeText={setEmail} readOnly={!mayEdit} autoCapitalize="none" placeholder="Optional" />
          <Field icon="home" label="Address" value={address} onChangeText={setAddress} readOnly={!mayEdit} multiline placeholder="Where the shop is" />
        </Panel>

        <View style={{ height: 18 }} />
        <SectionLabel>Logo and signature</SectionLabel>
        <Panel>
          <ImageSlot
            label="Logo"
            hint="Printed at the top of every receipt and invoice."
            uri={logo}
            onPick={takeImage(setLogo, logo, 'logo')}
            onClear={() => { dropPhoto(logo); setLogo(undefined); }}
          />
          <View style={{ height: 20 }} />
          <ImageSlot
            tall
            label="Signature"
            hint="Printed above the signature line on invoices and delivery notes. Photograph a signed sheet of paper."
            uri={signature}
            onPick={takeImage(setSignature, signature, 'sign')}
            onClear={() => { dropPhoto(signature); setSignature(undefined); }}
          />
        </Panel>

        <View style={{ height: 18 }} />
        <SectionLabel>The last line</SectionLabel>
        <Panel>
          <Field
            icon="pencil" label="Footer" value={footer} onChangeText={setFooter} readOnly={!mayEdit}
            multiline placeholder="Thank you for your business"
          />
        </Panel>

        <View style={{ height: 18 }} />
        <SectionLabel right={<Badge label={warehouses.length + ' branches'} tone="neutral" />}>Branches</SectionLabel>
        <Panel flush>
          {warehouses.map((w, i) => {
            const current = w.id === db.session.warehouse;
            return (
              <ListRow
                key={w.id}
                icon="home"
                title={w.name}
                subtitle={w.address || (current ? 'You are selling from here' : 'Tap to sell from here')}
                badge={current ? <Badge label="Current" tone="good" /> : undefined}
                onPress={() => { setWarehouse(w.id); success('Now selling from ' + w.name); }}
                last={i === warehouses.length - 1}
              />
            );
          })}
        </Panel>

        <View style={{ height: 14 }} />
        <InfoBanner
          tone="neutral"
          icon="bulb"
          text="A logo needs to be a clear picture on a plain background. Receipt printers print in black and white, so a pale or detailed one will come out as a grey smudge."
        />
      </ScrollView>

      {mayEdit ? (
        <StickyBar>
          <Button
            label={dirty ? 'Save business details' : 'Saved'}
            variant="pri"
            disabled={!dirty}
            icon={<Icon name="check" size={17} color={colors.accentInk} />}
            onPress={save}
          />
        </StickyBar>
      ) : null}
    </View>
  );
}
