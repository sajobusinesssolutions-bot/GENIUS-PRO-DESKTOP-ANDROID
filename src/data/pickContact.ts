/**
 * A customer or supplier from the phone's own contacts: asks for permission
 * the first time, opens the phone's contact picker, and hands back the name,
 * number, email and address to fill the form with.
 */
import * as Contacts from 'expo-contacts/legacy';

export interface PickedContact { name: string; phone: string; email: string; address: string }

/** null when nothing was picked; throws with a reason when contacts are not allowed. */
export async function pickContact(): Promise<PickedContact | null> {
  const perm = await Contacts.requestPermissionsAsync();
  if (perm.status !== 'granted') {
    throw new Error('Genius needs permission to read your contacts. Allow it in the phone\'s Settings → Apps → Genius → Permissions.');
  }
  const c = await Contacts.presentContactPickerAsync();
  if (!c) return null;
  const a = (c.addresses || [])[0];
  return {
    name: String(c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || '').trim(),
    phone: String(((c.phoneNumbers || []).find((p) => p.isPrimary) || (c.phoneNumbers || [])[0] || {}).number || '').replace(/[^\d+]/g, ''),
    email: String(((c.emails || [])[0] || {}).email || '').trim(),
    address: a ? [a.street, a.city, a.region, a.country].filter(Boolean).join(', ') : '',
  };
}
