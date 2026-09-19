/**
 * Icon set mapped from the prototype's inline-SVG `ic(name, size, color, sw)` helper
 * (reference `var ICON = {...}` at line 1452) onto @expo/vector-icons.
 *
 * Reference names: home till doc box user card chart dots back chev plus search x
 * check alert clock shield gift cog factory receipt calendar cloud arrow swap print
 * trash tag pie owner cashier money (+ ICON_EXTRA: bank phone cash lock down cart ...)
 */
import React from 'react';
import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

export type IconName =
  | 'home' | 'till' | 'doc' | 'box' | 'user' | 'card' | 'chart' | 'dots' | 'back'
  | 'chev' | 'plus' | 'search' | 'x' | 'check' | 'alert' | 'clock' | 'shield'
  | 'gift' | 'cog' | 'factory' | 'receipt' | 'calendar' | 'cloud' | 'arrow'
  | 'swap' | 'print' | 'trash' | 'tag' | 'pie' | 'owner' | 'cashier' | 'money'
  | 'bank' | 'phone' | 'cash' | 'lock' | 'down' | 'up' | 'cart' | 'coins'
  | 'pencil' | 'tools' | 'wrench' | 'bulb' | 'chair' | 'brick' | 'food' | 'taxi';

type Fam = 'f' | 'm';

/** name -> [family, glyph] */
const MAP: Record<IconName, [Fam, string]> = {
  home: ['f', 'home'],
  till: ['m', 'cash-register'],
  doc: ['f', 'file-text'],
  box: ['f', 'box'],
  user: ['f', 'user'],
  card: ['f', 'credit-card'],
  chart: ['f', 'bar-chart-2'],
  dots: ['f', 'more-horizontal'],
  back: ['f', 'arrow-left'],
  chev: ['f', 'chevron-right'],
  plus: ['f', 'plus'],
  search: ['f', 'search'],
  x: ['f', 'x'],
  check: ['f', 'check'],
  alert: ['f', 'bell'],
  clock: ['f', 'clock'],
  shield: ['f', 'shield'],
  gift: ['f', 'gift'],
  cog: ['f', 'settings'],
  factory: ['m', 'factory'],
  receipt: ['m', 'receipt'],
  calendar: ['f', 'calendar'],
  cloud: ['f', 'cloud'],
  arrow: ['f', 'log-out'],
  swap: ['m', 'swap-horizontal'],
  print: ['f', 'printer'],
  trash: ['f', 'trash-2'],
  tag: ['f', 'tag'],
  pie: ['f', 'pie-chart'],
  owner: ['m', 'crown-outline'],
  cashier: ['m', 'account-cash-outline'],
  money: ['m', 'cash-multiple'],
  bank: ['m', 'bank-outline'],
  phone: ['f', 'smartphone'],
  cash: ['m', 'cash'],
  lock: ['f', 'lock'],
  down: ['f', 'chevron-down'],
  up: ['f', 'chevron-up'],
  cart: ['f', 'shopping-cart'],
  coins: ['m', 'cash-multiple'],
  pencil: ['f', 'edit-2'],
  tools: ['m', 'tools'],
  wrench: ['m', 'wrench-outline'],
  bulb: ['m', 'lightbulb-outline'],
  chair: ['m', 'chair-rolling'],
  brick: ['m', 'wall'],
  food: ['m', 'food-outline'],
  taxi: ['m', 'taxi'],
};

export function Icon({ name, size = 18, color = '#000' }: { name: IconName | string; size?: number; color?: string }) {
  const entry = MAP[name as IconName] || MAP.box;
  const [fam, glyph] = entry;
  const C: any = fam === 'f' ? Feather : MaterialCommunityIcons;
  return <C name={glyph} size={size} color={color} />;
}

/** Category emoji-ish glyphs — reference CAT_ICON at line 6185. */
export const CAT_ICON: Record<string, IconName> = {
  Building: 'brick', Food: 'food', Furniture: 'chair', Electrical: 'bulb',
  Services: 'tools', Tools: 'wrench', General: 'box', Groceries: 'cart', Transport: 'taxi',
};

/** Reference CAT_COLOR at line 6189. */
export const CAT_COLOR = ['#2563EB', '#F0851F', '#159E5F', '#7A3EA8', '#C93A3A', '#0F766E', '#B4652A'];

export default Icon;
