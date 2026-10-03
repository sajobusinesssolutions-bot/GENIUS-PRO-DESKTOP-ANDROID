/**
 * Signing on the screen. Strokes are drawn with a finger and kept as SVG
 * paths; "Use signature" hands back the drawing as an SVG image (a data URI),
 * which prints on invoices exactly like a photographed one and needs no file.
 */
import React, { useMemo, useRef, useState } from 'react';
import { View, Text, PanResponder, LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme, fonts, radius } from '../theme';
import Sheet from './Sheet';
import { Button } from './ui';

/** An SVG data URI from strokes drawn in a box of the given size. */
export function signatureSvg(paths: string[], w: number, h: number): string {
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(w)} ${Math.round(h)}" width="${Math.round(w)}" height="${Math.round(h)}">`
    + paths.map((d) => `<path d="${d}" fill="none" stroke="#111" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`).join('')
    + '</svg>';
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(xml);
}

/** The SVG markup inside a signature data URI, for showing it on screen. */
export function svgFromUri(uri: string): string | null {
  const m = /^data:image\/svg\+xml;utf8,(.*)$/.exec(uri);
  return m ? decodeURIComponent(m[1]) : null;
}

export default function SignaturePad({ visible, onClose, onSave }: {
  visible: boolean; onClose: () => void; onSave: (uri: string) => void;
}) {
  const { colors } = useTheme();
  const [paths, setPaths] = useState<string[]>([]);
  const [live, setLive] = useState('');
  const liveRef = useRef('');
  const size = useRef({ w: 320, h: 180 });

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const { locationX: x, locationY: y } = e.nativeEvent;
      liveRef.current = `M${x.toFixed(1)} ${y.toFixed(1)}`;
      setLive(liveRef.current);
    },
    onPanResponderMove: (e) => {
      const { locationX: x, locationY: y } = e.nativeEvent;
      liveRef.current += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
      setLive(liveRef.current);
    },
    onPanResponderRelease: () => {
      const done = liveRef.current;
      liveRef.current = '';
      setLive('');
      // a tap with no movement leaves a dot
      if (done) setPaths((p) => [...p, done.includes('L') ? done : done + ' l0.1 0']);
    },
  }), []);

  function close() { setPaths([]); setLive(''); onClose(); }

  return (
    <Sheet
      visible={visible}
      title="Draw your signature"
      subtitle="Sign with your finger in the box"
      icon="pencil"
      onClose={close}
      footer={
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Button label="Clear" onPress={() => setPaths([])} disabled={!paths.length} /></View>
          <View style={{ flex: 2 }}>
            <Button
              label="Use signature"
              variant="pri"
              disabled={!paths.length}
              onPress={() => { onSave(signatureSvg(paths, size.current.w, size.current.h)); close(); }}
            />
          </View>
        </View>
      }
    >
      <View
        {...responder.panHandlers}
        onLayout={(e: LayoutChangeEvent) => { size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }; }}
        style={{ height: 200, borderRadius: radius.md, borderWidth: 1.4, borderColor: colors.lineHard, backgroundColor: '#FFFFFF', overflow: 'hidden' }}
      >
        <Svg width="100%" height="100%">
          {paths.map((d, i) => <Path key={i} d={d} fill="none" stroke="#111" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />)}
          {live ? <Path d={live} fill="none" stroke="#111" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" /> : null}
        </Svg>
        {/* the line it is signed on */}
        <View pointerEvents="none" style={{ position: 'absolute', left: 20, right: 20, bottom: 40, height: 1, backgroundColor: '#C9CED6' }} />
        {!paths.length && !live ? (
          <Text pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 80, textAlign: 'center', fontFamily: fonts.ui, fontSize: 13, color: '#9AA3AE' }}>
            Sign here
          </Text>
        ) : null}
      </View>
    </Sheet>
  );
}
