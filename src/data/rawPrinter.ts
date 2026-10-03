/**
 * TALKING TO A RECEIPT PRINTER DIRECTLY.
 *
 * Bluetooth: most till printers are Bluetooth Classic (serial), so they are
 * found with a Classic scan, connected to over SPP and sent ESC/POS bytes.
 * Network: the printer listens on a raw TCP port (9100 by convention); being
 * able to open that port and hand it a page is the test that it is there.
 *
 * Both are native modules, so they are loaded lazily: tests and the web build
 * run without them and get a plain "not available" instead of a crash.
 */
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

export interface FoundDevice {
  name: string;
  address: string;
  paired: boolean;
  /** Android's Bluetooth class, when the device reports one. */
  majorClass?: number;
  deviceClass?: number;
}

export class PrinterError extends Error {}

/*
 * The libraries' JavaScript is always there; their native half is only in
 * the installed app. Expo Go has no native half, so check for it first and
 * say so plainly, rather than failing with a null-pointer message.
 */
function bt(): any {
  if (!NativeModules.RNBluetoothClassic) return null;
  try { return require('react-native-bluetooth-classic').default; } catch { return null; }
}
function tcp(): any {
  if (!NativeModules.TcpSockets) return null;
  try { return require('react-native-tcp-socket').default; } catch { return null; }
}
const NOT_HERE = ' This copy of the app cannot use it (Expo Go has no Bluetooth or network printing). Install the Genius Pro app (APK) to print.';

/* ---------------- permissions ---------------- */

async function askBluetooth(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const api = Number(Platform.Version);
  const want = api >= 31
    ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
    : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const got = await PermissionsAndroid.requestMultiple(want);
  if (want.some((p) => got[p] === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)) {
    throw new PrinterError('Bluetooth permission was turned off for Genius Pro, so Android will not ask again. '
      + 'Open the phone\'s Settings, Apps, Genius Pro, Permissions, and allow ' + (api >= 31 ? '"Nearby devices".' : '"Location".'));
  }
  if (!want.every((p) => got[p] === PermissionsAndroid.RESULTS.GRANTED)) {
    throw new PrinterError(api >= 31
      ? 'Allow "Nearby devices" for Genius Pro so it can find Bluetooth printers.'
      : 'Allow location for Genius Pro. Android needs it to scan for Bluetooth printers.');
  }
}

async function ready(): Promise<any> {
  const B = bt();
  if (!B) throw new PrinterError('Bluetooth printing is not available here.' + NOT_HERE);
  await askBluetooth();
  let on = false;
  try { on = await B.isBluetoothEnabled(); } catch { on = false; }
  if (!on) {
    try { on = await B.requestBluetoothEnabled(); } catch { on = false; }
    if (!on) throw new PrinterError('Turn Bluetooth on to find printers.');
  }
  return B;
}

/* ---------------- what a device is ---------------- */

const MAJOR = {
  computer: 0x0100, phone: 0x0200, network: 0x0300, audio: 0x0400,
  peripheral: 0x0500, imaging: 0x0600, wearable: 0x0700, toy: 0x0800, health: 0x0900,
};
const MAJOR_WORD: Record<number, string> = {
  [MAJOR.computer]: 'a computer', [MAJOR.phone]: 'a phone', [MAJOR.network]: 'a network device',
  [MAJOR.audio]: 'an audio device (headphones or a speaker)', [MAJOR.peripheral]: 'a keyboard, mouse or similar',
  [MAJOR.wearable]: 'a watch or wearable', [MAJOR.toy]: 'a toy', [MAJOR.health]: 'a health device',
};

/**
 * Why a device is not a printer, or null when it may be one.
 *
 * Only a device that says what it is gets refused. Many cheap receipt printers
 * report no class at all ("uncategorised"), so silence is let through and the
 * connection itself decides.
 */
export function notAPrinter(d: FoundDevice): string | null {
  const major = d.majorClass;
  if (major == null) return null;
  if (major === MAJOR.imaging) {
    // imaging minor bits: 0x10 display, 0x20 camera, 0x40 scanner, 0x80 printer
    const minor = (d.deviceClass || 0) & 0xF0;
    if (minor && !(minor & 0x80)) return (d.name || 'That device') + ' is a camera, scanner or display, not a printer.';
    return null;
  }
  const word = MAJOR_WORD[major];
  return word ? (d.name || 'That device') + ' is ' + word + ', not a printer.' : null;
}

function toFound(x: any, paired: boolean): FoundDevice {
  const c = x?.deviceClass && typeof x.deviceClass === 'object' ? x.deviceClass : null;
  return {
    name: String(x?.name || '').trim() || 'Unnamed device',
    address: String(x?.address || x?.id || ''),
    paired: paired || !!x?.bonded,
    majorClass: c ? Number(c.majorClass) : undefined,
    deviceClass: c ? Number(c.deviceClass) : undefined,
  };
}

/* ---------------- Bluetooth ---------------- */

/** Paired devices at once, then whatever a scan finds nearby (about 12 seconds). */
export async function scanBluetooth(onPaired?: (list: FoundDevice[]) => void): Promise<FoundDevice[]> {
  const B = await ready();
  const byAddr = new Map<string, FoundDevice>();
  try {
    for (const d of await B.getBondedDevices()) {
      const f = toFound(d, true);
      if (f.address) byAddr.set(f.address, f);
    }
  } catch { /* none paired */ }
  onPaired?.(sortFound([...byAddr.values()]));
  try {
    for (const d of await B.startDiscovery()) {
      const f = toFound(d, false);
      if (f.address && !byAddr.has(f.address)) byAddr.set(f.address, f);
    }
  } catch (e: any) {
    if (!byAddr.size) throw new PrinterError('The scan could not run: ' + (e?.message || 'Bluetooth refused it') + '.');
  }
  return sortFound([...byAddr.values()]);
}

export async function stopScan(): Promise<void> {
  try { await bt()?.cancelDiscovery(); } catch { /* not scanning */ }
}

/** Printers first, then paired devices, then by name. */
function sortFound(list: FoundDevice[]): FoundDevice[] {
  const rank = (d: FoundDevice) => (notAPrinter(d) ? 2 : 0) + (d.paired ? 0 : 1);
  return list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * Connect to a Bluetooth printer and print a test page on it. Refuses a device
 * that says it is something else, and explains a connection that fails.
 */
export async function testBluetooth(d: FoundDevice, page: Uint8Array): Promise<void> {
  const why = notAPrinter(d);
  if (why) throw new PrinterError(why);
  const B = await ready();
  await stopScan();
  try {
    await B.connectToDevice(d.address, { delimiter: '', charset: 'ISO-8859-1' });
  } catch (e: any) {
    throw new PrinterError('Could not connect to ' + d.name + '. Check it is a receipt printer, switched on and not connected to another phone. (' + (e?.message || 'no answer') + ')');
  }
  try {
    const ok = await B.writeToDevice(d.address, toBase64(page), 'base64');
    if (ok === false) throw new Error('the printer did not take the page');
  } catch (e: any) {
    throw new PrinterError(d.name + ' connected but would not take a page, so it is probably not a receipt printer. (' + (e?.message || 'write failed') + ')');
  } finally {
    // let the bytes drain before letting go
    setTimeout(() => { B.disconnectFromDevice(d.address).catch(() => {}); }, 1500);
  }
}

/** Send a page to a Bluetooth printer saved earlier. */
export async function printBluetooth(address: string, page: Uint8Array): Promise<void> {
  await testBluetooth({ name: 'The printer', address, paired: true }, page);
}

/* ---------------- network ---------------- */

/**
 * Open the printer's raw port and hand it a page. No answer within the time
 * limit means nothing is listening at that address — that is the error shown.
 */
export function testNetwork(host: string, port: number, page: Uint8Array, timeoutMs = 5000): Promise<void> {
  const T = tcp();
  if (!T) return Promise.reject(new PrinterError('Network printing is not available here.' + NOT_HERE));
  return new Promise((resolve, reject) => {
    let done = false;
    let sock: any;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock?.destroy(); } catch { /* already closed */ }
      err ? reject(err) : resolve();
    };
    const timer = setTimeout(() => finish(new PrinterError(
      'No reply from ' + host + ':' + port + '. Check the IP address, that the printer is on, and that this phone is on the same Wi-Fi.')), timeoutMs);
    try {
      sock = T.createConnection({ host, port }, () => {
        sock.write(toBase64(page), 'base64', (err?: Error) => {
          if (err) return finish(new PrinterError('Reached ' + host + ' but the page could not be sent: ' + err.message));
          // give the printer a moment to take the bytes before closing
          setTimeout(() => { try { sock.end(); } catch { /* closed */ } finish(); }, 400);
        });
      });
      sock.on('error', (e: any) => finish(new PrinterError(
        'Could not reach a printer at ' + host + ':' + port + '. ' + (e?.message ? '(' + e.message + ')' : ''))));
    } catch (e: any) {
      finish(new PrinterError('Could not reach ' + host + ':' + port + ': ' + (e?.message || 'failed')));
    }
  });
}

/* ---------------- the test page ---------------- */

const ESC = 0x1b, GS = 0x1d, LF = 0x0a;

/** A short ESC/POS page: shop name, what printer this is, and a cut. */
export function testPage(shop: string, printerName: string, paper: '58mm' | '80mm' | string): Uint8Array {
  const width = paper === '58mm' ? 32 : 48;
  const out: number[] = [ESC, 0x40]; // reset
  const text = (s: string) => { for (const ch of s) out.push(ch.charCodeAt(0) < 256 ? ch.charCodeAt(0) : 0x3f); };
  const line = (s = '') => { text(s); out.push(LF); };
  out.push(ESC, 0x61, 1); // centre
  out.push(ESC, 0x45, 1, GS, 0x21, 0x11); // bold, double size
  line(shop.slice(0, Math.floor(width / 2)));
  out.push(GS, 0x21, 0x00, ESC, 0x45, 0);
  line('TEST PRINT');
  line('-'.repeat(width));
  out.push(ESC, 0x61, 0); // left
  line('Printer: ' + printerName.slice(0, width - 9));
  line('Paper:   ' + paper);
  line('Time:    ' + new Date().toLocaleString());
  line('-'.repeat(width));
  out.push(ESC, 0x61, 1);
  line('If you can read this,');
  line('the printer is ready.');
  line();
  line('Genius Pro');
  out.push(LF, LF, LF, GS, 0x56, 0x42, 0x00); // feed and partial cut
  return Uint8Array.from(out);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
      + (b === undefined ? '=' : B64[(n >> 6) & 63])
      + (c === undefined ? '=' : B64[n & 63]);
  }
  return s;
}
