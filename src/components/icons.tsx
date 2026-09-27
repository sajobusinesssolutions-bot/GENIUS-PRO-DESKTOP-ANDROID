/**
 * The app's icons — Phosphor, one consistent family in several weights.
 *
 * Every screen asks for an icon by the app's own name ("receipt", "till")
 * and this maps it to a Phosphor glyph, so the whole set changes here and
 * nowhere else. Each glyph is imported on its own path, so only the icons
 * listed here are bundled, not all ~1,500.
 *
 * Weights: "regular" by default, "fill" for a selected tab, "duotone" for the
 * icon tiles, and "bold" where an icon has to read at a glance on a button.
 */
import React from 'react';
import type { IconWeight } from 'phosphor-react-native';

type Glyph = React.ComponentType<{ size?: number; color?: string; weight?: IconWeight }>;

// Plain require() per glyph: Metro bundles only these files, and the library's
// .tsx source stays out of this project's type-check (its svg prop types clash).
/* eslint-disable @typescript-eslint/no-require-imports */
const HouseIcon: Glyph = require('phosphor-react-native/src/icons/House').HouseIcon;
const CashRegisterIcon: Glyph = require('phosphor-react-native/src/icons/CashRegister').CashRegisterIcon;
const FileTextIcon: Glyph = require('phosphor-react-native/src/icons/FileText').FileTextIcon;
const PackageIcon: Glyph = require('phosphor-react-native/src/icons/Package').PackageIcon;
const UserIcon: Glyph = require('phosphor-react-native/src/icons/User').UserIcon;
const CreditCardIcon: Glyph = require('phosphor-react-native/src/icons/CreditCard').CreditCardIcon;
const ChartBarIcon: Glyph = require('phosphor-react-native/src/icons/ChartBar').ChartBarIcon;
const DotsThreeIcon: Glyph = require('phosphor-react-native/src/icons/DotsThree').DotsThreeIcon;
const ArrowLeftIcon: Glyph = require('phosphor-react-native/src/icons/ArrowLeft').ArrowLeftIcon;
const CaretRightIcon: Glyph = require('phosphor-react-native/src/icons/CaretRight').CaretRightIcon;
const PlusIcon: Glyph = require('phosphor-react-native/src/icons/Plus').PlusIcon;
const MagnifyingGlassIcon: Glyph = require('phosphor-react-native/src/icons/MagnifyingGlass').MagnifyingGlassIcon;
const XIcon: Glyph = require('phosphor-react-native/src/icons/X').XIcon;
const CheckIcon: Glyph = require('phosphor-react-native/src/icons/Check').CheckIcon;
const BellIcon: Glyph = require('phosphor-react-native/src/icons/Bell').BellIcon;
const ClockIcon: Glyph = require('phosphor-react-native/src/icons/Clock').ClockIcon;
const ShieldCheckIcon: Glyph = require('phosphor-react-native/src/icons/ShieldCheck').ShieldCheckIcon;
const GiftIcon: Glyph = require('phosphor-react-native/src/icons/Gift').GiftIcon;
const GearIcon: Glyph = require('phosphor-react-native/src/icons/Gear').GearIcon;
const FactoryIcon: Glyph = require('phosphor-react-native/src/icons/Factory').FactoryIcon;
const ReceiptIcon: Glyph = require('phosphor-react-native/src/icons/Receipt').ReceiptIcon;
const CalendarBlankIcon: Glyph = require('phosphor-react-native/src/icons/CalendarBlank').CalendarBlankIcon;
const CloudIcon: Glyph = require('phosphor-react-native/src/icons/Cloud').CloudIcon;
const SignOutIcon: Glyph = require('phosphor-react-native/src/icons/SignOut').SignOutIcon;
const ArrowsLeftRightIcon: Glyph = require('phosphor-react-native/src/icons/ArrowsLeftRight').ArrowsLeftRightIcon;
const PrinterIcon: Glyph = require('phosphor-react-native/src/icons/Printer').PrinterIcon;
const TrashIcon: Glyph = require('phosphor-react-native/src/icons/Trash').TrashIcon;
const TagIcon: Glyph = require('phosphor-react-native/src/icons/Tag').TagIcon;
const ChartPieIcon: Glyph = require('phosphor-react-native/src/icons/ChartPie').ChartPieIcon;
const CrownIcon: Glyph = require('phosphor-react-native/src/icons/Crown').CrownIcon;
const UserCircleIcon: Glyph = require('phosphor-react-native/src/icons/UserCircle').UserCircleIcon;
const WalletIcon: Glyph = require('phosphor-react-native/src/icons/Wallet').WalletIcon;
const BankIcon: Glyph = require('phosphor-react-native/src/icons/Bank').BankIcon;
const DeviceMobileIcon: Glyph = require('phosphor-react-native/src/icons/DeviceMobile').DeviceMobileIcon;
const MoneyIcon: Glyph = require('phosphor-react-native/src/icons/Money').MoneyIcon;
const LockIcon: Glyph = require('phosphor-react-native/src/icons/Lock').LockIcon;
const CaretDownIcon: Glyph = require('phosphor-react-native/src/icons/CaretDown').CaretDownIcon;
const CaretUpIcon: Glyph = require('phosphor-react-native/src/icons/CaretUp').CaretUpIcon;
const ShoppingCartIcon: Glyph = require('phosphor-react-native/src/icons/ShoppingCart').ShoppingCartIcon;
const CoinsIcon: Glyph = require('phosphor-react-native/src/icons/Coins').CoinsIcon;
const PencilSimpleIcon: Glyph = require('phosphor-react-native/src/icons/PencilSimple').PencilSimpleIcon;
const ToolboxIcon: Glyph = require('phosphor-react-native/src/icons/Toolbox').ToolboxIcon;
const WrenchIcon: Glyph = require('phosphor-react-native/src/icons/Wrench').WrenchIcon;
const LightbulbIcon: Glyph = require('phosphor-react-native/src/icons/Lightbulb').LightbulbIcon;
const ChairIcon: Glyph = require('phosphor-react-native/src/icons/Chair').ChairIcon;
const WallIcon: Glyph = require('phosphor-react-native/src/icons/Wall').WallIcon;
const ForkKnifeIcon: Glyph = require('phosphor-react-native/src/icons/ForkKnife').ForkKnifeIcon;
const TaxiIcon: Glyph = require('phosphor-react-native/src/icons/Taxi').TaxiIcon;
const WifiHighIcon: Glyph = require('phosphor-react-native/src/icons/WifiHigh').WifiHighIcon;
const BluetoothIcon: Glyph = require('phosphor-react-native/src/icons/Bluetooth').BluetoothIcon;
const ImageIcon: Glyph = require('phosphor-react-native/src/icons/Image').ImageIcon;
const EnvelopeIcon: Glyph = require('phosphor-react-native/src/icons/Envelope').EnvelopeIcon;
const MapPinIcon: Glyph = require('phosphor-react-native/src/icons/MapPin').MapPinIcon;
const SquaresFourIcon: Glyph = require('phosphor-react-native/src/icons/SquaresFour').SquaresFourIcon;
const ListIcon: Glyph = require('phosphor-react-native/src/icons/List').ListIcon;
const CameraIcon: Glyph = require('phosphor-react-native/src/icons/Camera').CameraIcon;

export type IconName =
  | 'home' | 'till' | 'doc' | 'box' | 'user' | 'card' | 'chart' | 'dots' | 'back'
  | 'chev' | 'plus' | 'search' | 'x' | 'check' | 'alert' | 'clock' | 'shield'
  | 'gift' | 'cog' | 'factory' | 'receipt' | 'calendar' | 'cloud' | 'arrow'
  | 'swap' | 'print' | 'trash' | 'tag' | 'pie' | 'owner' | 'cashier' | 'money'
  | 'bank' | 'phone' | 'cash' | 'lock' | 'down' | 'up' | 'cart' | 'coins'
  | 'pencil' | 'tools' | 'wrench' | 'bulb' | 'chair' | 'brick' | 'food' | 'taxi'
  | 'wifi' | 'bluetooth' | 'image' | 'mail' | 'pin' | 'dashboard' | 'menu' | 'camera';

export type { IconWeight };

const MAP: Record<IconName, Glyph> = {
  home: HouseIcon,
  till: CashRegisterIcon,
  doc: FileTextIcon,
  box: PackageIcon,
  user: UserIcon,
  card: CreditCardIcon,
  chart: ChartBarIcon,
  dots: DotsThreeIcon,
  back: ArrowLeftIcon,
  chev: CaretRightIcon,
  plus: PlusIcon,
  search: MagnifyingGlassIcon,
  x: XIcon,
  check: CheckIcon,
  alert: BellIcon,
  clock: ClockIcon,
  shield: ShieldCheckIcon,
  gift: GiftIcon,
  cog: GearIcon,
  factory: FactoryIcon,
  receipt: ReceiptIcon,
  calendar: CalendarBlankIcon,
  cloud: CloudIcon,
  arrow: SignOutIcon,
  swap: ArrowsLeftRightIcon,
  print: PrinterIcon,
  trash: TrashIcon,
  tag: TagIcon,
  pie: ChartPieIcon,
  owner: CrownIcon,
  cashier: UserCircleIcon,
  money: WalletIcon,
  bank: BankIcon,
  phone: DeviceMobileIcon,
  cash: MoneyIcon,
  lock: LockIcon,
  down: CaretDownIcon,
  up: CaretUpIcon,
  cart: ShoppingCartIcon,
  coins: CoinsIcon,
  pencil: PencilSimpleIcon,
  tools: ToolboxIcon,
  wrench: WrenchIcon,
  bulb: LightbulbIcon,
  chair: ChairIcon,
  brick: WallIcon,
  food: ForkKnifeIcon,
  taxi: TaxiIcon,
  wifi: WifiHighIcon,
  bluetooth: BluetoothIcon,
  image: ImageIcon,
  mail: EnvelopeIcon,
  pin: MapPinIcon,
  dashboard: SquaresFourIcon,
  menu: ListIcon,
  camera: CameraIcon,
};

/** Small glyphs that are pure direction or punctuation read better a touch heavier. */
const HEAVIER = new Set<IconName>(['chev', 'down', 'up', 'back', 'plus', 'x', 'check']);

export function Icon({ name, size = 18, color = '#000', weight }: {
  name: IconName | string; size?: number; color?: string; weight?: IconWeight;
}) {
  const key = (name in MAP ? name : 'box') as IconName;
  const Glyph = MAP[key];
  return <Glyph size={size} color={color} weight={weight || (HEAVIER.has(key) ? 'bold' : 'regular')} />;
}

/** Category glyphs — reference CAT_ICON at line 6185. */
export const CAT_ICON: Record<string, IconName> = {
  Building: 'brick', Food: 'food', Furniture: 'chair', Electrical: 'bulb',
  Services: 'tools', Tools: 'wrench', General: 'box', Groceries: 'cart', Transport: 'taxi',
};

/** Reference CAT_COLOR at line 6189. */
export const CAT_COLOR = ['#2563EB', '#F0851F', '#159E5F', '#7A3EA8', '#C93A3A', '#0F766E', '#B4652A'];

export default Icon;
