/**
 * The dashboard's two SVG figures, ported from the prototype:
 *  - arcGauge()  reference line 6236  (4 nested semicircles, r 64/52/40/28, stroke 11)
 *  - weekRings() reference line 6263  (seven 28px progress rings, S M T W T F S)
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Pressable } from './Press';
import Svg, { Path, Circle, Line, Defs, LinearGradient, Stop } from 'react-native-svg';
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
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.faint, marginTop: 3 }}>
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
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: on ? colors.bg : colors.faint }}>
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
export function TrendBars({ days, height = 44, selected, onSelect }: {
  days: { v: number; idx: number }[]; height?: number;
  /** Which bar is picked (an index into days); today when none is. */
  selected?: number | null;
  /** Makes each day tappable. */
  onSelect?: (i: number) => void;
}) {
  const { colors } = useTheme();
  const todayIdx = new Date().getDay();
  const max = Math.max(1, ...days.map((d) => d.v));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 7 }}>
      {days.map((x, i) => {
        const on = selected != null ? i === selected : x.idx === todayIdx;
        // a day with takings never shows as nothing at all
        const h = x.v > 0 ? Math.max(4, Math.round((x.v / max) * height)) : 3;
        const bar = (
          <>
            <View style={{
              width: '100%', height: h, borderRadius: 4,
              backgroundColor: x.v > 0 ? (on ? colors.accent : colors.lineHard) : on ? colors.accentSoft : colors.line,
            }} />
            <Text style={{
              fontFamily: on ? fonts.uiBold : fonts.ui,
              fontSize: 12.5, color: on ? colors.accent : colors.faint,
            }}>
              {DAY_LABELS[x.idx]}
            </Text>
          </>
        );
        return onSelect ? (
          <Pressable
            key={i}
            onPress={() => onSelect(i)}
            hitSlop={{ top: 12, bottom: 4 }}
            accessibilityLabel={'Show ' + DAY_NAMES[x.idx]}
            style={{ flex: 1, alignItems: 'center', gap: 6, minHeight: height + 22, justifyContent: 'flex-end' }}
          >
            {bar}
          </Pressable>
        ) : (
          <View key={i} style={{ flex: 1, alignItems: 'center', gap: 6 }}>{bar}</View>
        );
      })}
    </View>
  );
}

const DAY_SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** A smooth path through the points (Catmull–Rom turned into cubic curves). */
function smooth(pts: { x: number; y: number }[]): string {
  if (!pts.length) return '';
  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
  }
  return d;
}

/**
 * The week as a soft line with a shaded fill. Tapping a day drops a marker on
 * the line, with a dashed guide down to its label and the day's figure in a
 * small bubble above it; tapping it again lets it go.
 */
export function TrendLine({ days, height = 92, selected, onSelect, format }: {
  days: { v: number; idx: number }[];
  height?: number;
  selected?: number | null;
  onSelect?: (i: number) => void;
  /** How the bubble shows a figure — the shop's money format. */
  format?: (v: number) => string;
}) {
  const { colors } = useTheme();
  const [w, setW] = React.useState(0);
  const max = Math.max(1, ...days.map((d) => d.v));
  const pad = 14;
  const top = 26; // room for the bubble
  const pts = days.map((d, i) => ({
    x: pad + (days.length > 1 ? (i * (w - pad * 2)) / (days.length - 1) : (w - pad * 2) / 2),
    y: top + (1 - d.v / max) * (height - top - 4),
  }));
  const line = w ? smooth(pts) : '';
  const area = w ? line + ` L${pts[pts.length - 1].x} ${height} L${pts[0].x} ${height} Z` : '';
  const pick = selected != null ? pts[selected] : null;
  const label = selected != null ? (format ? format(days[selected].v) : String(days[selected].v)) : '';
  const bubbleW = Math.max(44, label.length * 7 + 16);
  const bubbleX = pick ? Math.min(Math.max(pick.x - bubbleW / 2, 0), Math.max(0, w - bubbleW)) : 0;

  return (
    <View>
      <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {w ? (
          <Svg width={w} height={height}>
            <Defs>
              <LinearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.accent} stopOpacity={0.24} />
                <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Path d={area} fill="url(#trendFill)" />
            <Path d={line} fill="none" stroke={colors.accent} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
            {pick ? (
              <>
                <Line x1={pick.x} y1={top - 4} x2={pick.x} y2={height} stroke={colors.faint} strokeWidth={1} strokeDasharray="3 3" />
                <Circle cx={pick.x} cy={pick.y} r={5} fill={colors.accent} stroke={colors.surface} strokeWidth={2} />
              </>
            ) : null}
          </Svg>
        ) : null}
        {pick ? (
          <View pointerEvents="none" style={{
            position: 'absolute', top: 0, left: bubbleX, minWidth: bubbleW, height: 22, paddingHorizontal: 8,
            borderRadius: 11, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 11.5, color: colors.ink }}>{label}</Text>
          </View>
        ) : null}
        {/* a tap anywhere in a day's column picks it */}
        {onSelect ? (
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row' }}>
            {days.map((d, i) => (
              <Pressable key={i} onPress={() => onSelect(i)} accessibilityLabel={'Show ' + DAY_NAMES[d.idx]} style={{ flex: 1 }} />
            ))}
          </View>
        ) : null}
      </View>
      {/* the days, with a tick over each */}
      <View style={{ flexDirection: 'row', marginTop: 6 }}>
        {days.map((d, i) => {
          const on = selected != null ? i === selected : false;
          return (
            <Pressable key={i} onPress={onSelect ? () => onSelect(i) : undefined} disabled={!onSelect} style={{ flex: 1, alignItems: 'center' }}>
              <View style={{ width: 1, height: 4, backgroundColor: colors.lineHard, marginBottom: 4 }} />
              <Text style={{ fontFamily: on ? fonts.uiBold : fonts.uiSemi, fontSize: 10.5, letterSpacing: 0.4, color: on ? colors.accent : colors.faint }}>
                {DAY_SHORT[d.idx]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
