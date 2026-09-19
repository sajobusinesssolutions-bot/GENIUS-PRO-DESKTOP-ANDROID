import React, { useState } from 'react';
import { Modal, View, Text, Pressable } from 'react-native';
import { useTheme, fonts } from '../theme';
import { Button } from './ui';
import { Icon } from './icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

let CameraView: any = null;
let useCameraPermissions: any = null;
try {
  // expo-camera works on iOS/Android; on web it can throw or behave oddly in
  // some environments, so this whole module is loaded defensively.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('expo-camera');
  CameraView = mod.CameraView;
  useCameraPermissions = mod.useCameraPermissions;
} catch {
  CameraView = null;
}

export default function BarcodeScannerModal({ visible, onClose, onScan, describe }: {
  visible: boolean; onClose: () => void; onScan: (code: string) => void;
  /** Resolves a detected code to a label so the operator can confirm before it is added. */
  describe?: (code: string) => { title: string; subtitle: string; ok: boolean };
}) {
  const { colors } = useTheme();
  const [detected, setDetected] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions ? useCameraPermissions() : [null, async () => {}];

  if (!visible) return null;

  // Camera module unavailable (e.g. some web setups) — show a manual fallback
  // instead of crashing.
  if (!CameraView) {
    return (
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <View style={{ flex: 1, backgroundColor: '#000000cc', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 20, width: '100%', maxWidth: 360 }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink, marginBottom: 8 }}>Camera unavailable</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginBottom: 16 }}>
              Barcode scanning needs a native camera (not available on this platform/build). Enter the code or SKU manually from the product screen instead.
            </Text>
            <Button label="Close" onPress={onClose} />
          </View>
        </View>
      </Modal>
    );
  }

  if (!permission) {
    return (
      <Modal visible transparent onRequestClose={onClose}>
        <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontFamily: fonts.ui }}>Loading camera…</Text>
        </View>
      </Modal>
    );
  }

  if (!permission.granted) {
    return (
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <View style={{ flex: 1, backgroundColor: '#000000cc', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 20, width: '100%', maxWidth: 360, gap: 10 }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>Camera permission needed</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
              Allow camera access to scan product barcodes.
            </Text>
            <Button label="Grant permission" variant="pri" onPress={requestPermission} />
            <Button label="Cancel" onPress={onClose} />
          </View>
        </View>
      </Modal>
    );
  }

  const info = detected ? (describe ? describe(detected) : { title: detected, subtitle: 'Tap add to put this on the bill', ok: true }) : null;

  function close() {
    setDetected(null);
    onClose();
  }

  const edge = info ? (info.ok ? '#4ADE97' : '#F87A7A') : '#FFFFFF';

  /** One corner of the reticle — four of these frame the scan area. */
  const corner = (pos: { top?: number; bottom?: number; left?: number; right?: number }) => {
    const v = pos.top !== undefined ? 'top' : 'bottom';
    const h = pos.left !== undefined ? 'left' : 'right';
    return (
      <View
        style={{
          position: 'absolute', width: 34, height: 34,
          ...pos,
          [`border${v === 'top' ? 'Top' : 'Bottom'}Width`]: 4,
          [`border${h === 'left' ? 'Left' : 'Right'}Width`]: 4,
          borderColor: edge,
          [`border${v === 'top' ? 'Top' : 'Bottom'}${h === 'left' ? 'Left' : 'Right'}Radius`]: 14,
        } as any}
      />
    );
  };

  return (
    <Modal visible animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {/* the title bar, on solid black so it reads over any scene */}
        <View style={{ paddingTop: insets.top + 14, paddingBottom: 16, paddingHorizontal: 20, backgroundColor: '#000' }}>
          <Text style={{ textAlign: 'center', fontFamily: fonts.uiBold, fontSize: 19, color: '#fff' }}>
            Scan Barcode
          </Text>
        </View>

        <View style={{ flex: 1 }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'itf14', 'qr'] }}
            onBarcodeScanned={(result: { data: string }) => {
              if (result.data !== detected) setDetected(result.data);
            }}
          />

          {/* the reticle: four corners over a dimmed surround */}
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 280, height: 180 }}>
              {corner({ top: 0, left: 0 })}
              {corner({ top: 0, right: 0 })}
              {corner({ bottom: 0, left: 0 })}
              {corner({ bottom: 0, right: 0 })}
              <View style={{ position: 'absolute', top: '50%', left: 10, right: 10, height: 2, backgroundColor: edge, opacity: 0.75 }} />
            </View>
            <Text style={{ marginTop: 22, fontFamily: fonts.uiSemi, fontSize: 14, color: 'rgba(255,255,255,0.88)' }}>
              {info ? (info.ok ? 'Found it — tap Add below' : 'Not sellable') : 'Line the barcode up inside the frame'}
            </Text>
          </View>

          {/* torch */}
          <Pressable
            onPress={() => setTorch((t) => !t)}
            style={{
              position: 'absolute', top: 18, right: 18,
              width: 48, height: 48, borderRadius: 24,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: torch ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.55)',
            }}
          >
            <Icon name="bulb" size={22} color={torch ? '#111' : '#fff'} />
          </Pressable>
        </View>

        {/* the result and the actions, on solid black */}
        <View style={{ backgroundColor: '#000', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14 + insets.bottom, gap: 12 }}>
          <View
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 12,
              backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 16, padding: 14,
              borderWidth: 1.4, borderColor: info ? edge : 'rgba(255,255,255,0.18)',
            }}
          >
            <View style={{
              width: 42, height: 42, borderRadius: 13,
              backgroundColor: info ? (info.ok ? 'rgba(74,222,151,0.18)' : 'rgba(248,122,122,0.18)') : 'rgba(255,255,255,0.12)',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name={info ? (info.ok ? 'check' : 'alert') : 'box'} size={20} color={info ? edge : 'rgba(255,255,255,0.7)'} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 16, color: '#fff' }}>
                {info ? info.title : 'Nothing detected yet'}
              </Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: 'rgba(255,255,255,0.7)', marginTop: 3 }}>
                {info ? info.subtitle : 'Hold the code steady inside the frame'}
              </Text>
            </View>
          </View>

          <Pressable
            onPress={() => { if (detected && info?.ok) { const code = detected; setDetected(null); onScan(code); } }}
            disabled={!info || !info.ok}
            style={{
              height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
              flexDirection: 'row', gap: 9,
              backgroundColor: info && info.ok ? '#16976A' : 'rgba(255,255,255,0.12)',
            }}
          >
            <Icon name="plus" size={20} color={info && info.ok ? '#fff' : 'rgba(255,255,255,0.45)'} />
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 16, color: info && info.ok ? '#fff' : 'rgba(255,255,255,0.45)' }}>
              Add to bill
            </Text>
          </Pressable>

          <Pressable onPress={close} style={{ height: 50, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 17, color: '#fff' }}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
