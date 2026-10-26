/**
 * The shop's rules that the Windows till keeps too, so they are set once and
 * hold on every device: selling below cost, selling without stock, needing a
 * shift open, tax, rounding, the idle lock and the rest. A change to any of
 * these goes out as one "settings" record (syncClient.ts) and one arriving is
 * merged in (AppDataContext applyRemoteOps). Windows maps each to its own key
 * (phonesync/engine.js SHARED_SETTINGS).
 */
import type { DB } from './types';

export const SHARED_SETTINGS = [
  'belowCost', 'blockNegativeStock', 'allowNegativeStock', 'requireShift', 'taxEnabled', 'pricesIncludeTax',
  'autoLockMins', 'lowStockAlerts', 'roundTo', 'askWhoOnSave', 'serviceChargePct', 'kitchenDisplay',
] as const;

export function sharedSettingsDoc(d: DB): Record<string, unknown> {
  const s = d.settings as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of SHARED_SETTINGS) if (s[k] !== undefined) out[k] = s[k];
  return out;
}
