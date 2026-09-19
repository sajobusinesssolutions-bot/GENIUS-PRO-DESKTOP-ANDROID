/**
 * The dashboard's two SVG figures, ported from the prototype:
 *  - arcGauge()  reference line 6236  (4 nested semicircles, r 64/52/40/28, stroke 11)
 *  - weekRings() reference line 6263  (seven 28px progress rings, S M T W T F S)
 */
import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useTheme, fonts } from '../theme';
import { Icon, CAT_ICON, CAT_COLOR } from './icons';

export type CatRow = { cat: string; v: number };

export function ArcGauge({ rows, total, width }: { rows: CatRow[]; total: number; width: number }) {
  const { colors } = useTheme();
  const R = [64, 52, 40, 28];
  const SW = 11, cx = 76, cy = 78;
  const used = rows.slice(0, 4);
  const top = used[0];
  const height = Math.round((width * 86) / 152);
  return (
    <View style={{ position: 'relative' }}>
      <Svg width={width} height={height} viewBox="0 0 152 86">
        {used.map((row, i) => {
          const r = R[i];
          const frac = total ? Math.max(0.05, Math.min(1, row.v / total)) : 0.05;
          const circ = Math.PI * r;
          const d = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
          return (
            <React.Fragment key={row.cat}>
              <Path d={d} fill="none" stroke={colors.sunk} strokeWidth={SW} strokeLinecap="round" />
              <Path
                d={d}
                fill="none"
                stroke={CAT_COLOR[i % CAT_COLOR.length]}
                strokeWidth={SW}
                strokeLinecap="round"
                strokeDasharray={`${(circ * frac).toFixed(1)} ${circ.toFixed(1)}`}
              />
            </React.Fragment>
          );
        })}
      </Svg>
      {top ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 6, alignItems: 'center' }} pointerEvents="none">
          <Icon name={CAT_ICON[top.cat] || 'box'} size={19} color={colors.soft} />
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 10.5, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.faint, marginTop: 3 }}>
            {top.cat}
          </Text>
          <Text style={{ fontFamily: fonts.monoSemi, fontSize: 12.5, color: colors.ink }}>
            {total ? Math.round((top.v / total) * 100) : 0}%
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function WeekRings({ days }: { days: { v: number; idx: number }[] }) {
  const { colors } = useTheme();
  const todayIdx = new Date().getDay();
  const max = Math.max(1, ...days.map((d) => d.v));
  const C = 2 * Math.PI * 11;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 4 }}>
      {days.map((x, i) => {
        const frac = Math.min(1, x.v / max);
        const on = x.idx === todayIdx;
        return (
          <View key={i} style={{ alignItems: 'center', gap: 5 }}>
            <Svg width={28} height={28} viewBox="0 0 28 28">
              <Circle cx={14} cy={14} r={11} fill="none" stroke={colors.sunk} strokeWidth={3} />
              <Circle
                cx={14} cy={14} r={11} fill="none"
                stroke={colors.accent} strokeWidth={3} strokeLinecap="round"
                strokeDasharray={`${(C * frac).toFixed(1)} ${C.toFixed(1)}`}
                transform="rotate(-90 14 14)"
              />
            </Svg>
            <View style={{
              width: 19, height: 19, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
              backgroundColor: on ? colors.ink : 'transparent',
            }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 10.5, color: on ? colors.bg : colors.faint }}>
                {DAY_LABELS[x.idx]}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Seven plain bars for the last seven days.
 *
 * The dashboard used to carry a ring per day, which reads as seven separate
 * gauges to be decoded one by one. Bars on a shared baseline answer the only
 * question the strip is there for — which days were good — without being read
 * at all. Today is inked so the eye lands on it first.
 */
export function TrendBars({ days, height = 44 }: { days: { v: number; idx: number }[]; height?: number }) {
  const { colors } = useTheme();
  const todayIdx = new Date().getDay();
  const max = Math.max(1, ...days.map((d) => d.v));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 7 }}>
      {days.map((x, i) => {
        const on = x.idx === todayIdx;
        // a day with takings never shows as nothing at all
        const h = x.v > 0 ? Math.max(4, Math.round((x.v / max) * height)) : 3;
        return (
          <View key={i} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
            <View style={{
              width: '100%', height: h, borderRadius: 4,
              backgroundColor: x.v > 0 ? (on ? colors.accent : colors.lineHard) : colors.line,
            }} />
            <Text style={{
              fontFamily: on ? fonts.uiBold : fonts.ui,
              fontSize: 10, color: on ? colors.ink : colors.faint,
            }}>
              {DAY_LABELS[x.idx]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
