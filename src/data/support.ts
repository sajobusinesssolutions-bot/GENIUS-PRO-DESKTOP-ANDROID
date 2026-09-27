/**
 * Where people reach the makers of the app. Change these here and every
 * button in Help & about follows.
 */
import { Linking, Share } from 'react-native';
import { BUILD } from './defaults';

export const PUBLISHER = 'Saljoe Tech';
export const SUPPORT_EMAIL = 'saljotech256@gmail.com';
/** International format, digits only — what wa.me expects. */
export const SUPPORT_WHATSAPP = '256753201462';
/** The store or download link to share. Empty leaves the link out of the message. */
export const APP_LINK = '';

function footer(till?: string): string {
  return '\n\n—\nGenius POS ' + BUILD + (till ? ' · till ' + till : '');
}

export function emailUrl(subject: string, body = '', till?: string): string {
  return 'mailto:' + SUPPORT_EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body + footer(till));
}

export function whatsappUrl(text: string): string {
  return 'https://wa.me/' + SUPPORT_WHATSAPP + '?text=' + encodeURIComponent(text);
}

export function shareMessage(): string {
  return 'I run my shop on Genius POS — sales, stock, receipts and books in one app, even offline.'
    + (APP_LINK ? '\n' + APP_LINK : '\nAsk ' + PUBLISHER + ' on WhatsApp +' + SUPPORT_WHATSAPP + ' to get it.');
}

export async function open(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

export async function shareApp(): Promise<void> {
  await Share.share({ message: shareMessage() });
}
