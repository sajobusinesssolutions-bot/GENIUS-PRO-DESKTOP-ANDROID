/**
 * The till is named after the phone it runs on, so in reports, shifts and the
 * sync log each device reads as itself ("Amar's Galaxy A54") rather than as
 * one of several "Till 1"s.
 */
import * as Device from 'expo-device';

/** The phone's own name, or its model when it has none. */
export function deviceTillName(): string | null {
  const name = (Device.deviceName || Device.modelName || '').trim();
  return name || null;
}

/** Whether a till still carries a made-up default name rather than one someone chose. */
export function isDefaultTillName(till?: string): boolean {
  return !till || /^till\s*\d*$/i.test(till.trim());
}
