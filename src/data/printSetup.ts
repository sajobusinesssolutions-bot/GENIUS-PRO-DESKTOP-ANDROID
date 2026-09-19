/**
 * WHERE A DOCUMENT PRINTS, AND HOW.
 *
 * Settings, Printing holds printers (each with its paper) and templates (what a
 * document shows, and its barcode or QR). Printing ignored both. This picks the
 * template for the document and the paper from the printer it is going to, so
 * a receipt sent to the 58mm till printer comes out 58mm wide and the same bill
 * sent to the office printer comes out as an A4 invoice.
 */
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import type { DB, DocKind, Paper, Printer } from './types';
import type { PrintOpts } from './docPrint';

/** The template key for a document, from its printed title. */
export function docKindOf(kind: string): DocKind {
  const k = kind.toLowerCase();
  if (k.includes('purchase')) return 'purchase';
  if (k.includes('quotation') || k.includes('estimate')) return 'estimate';
  if (k.includes('delivery') || k.includes('challan')) return 'challan';
  if (k.includes('credit') || k.includes('return')) return 'ret';
  if (k.includes('instal')) return 'instal';
  if (k.includes('receipt') || k.includes('voucher')) return 'receipt';
  return 'invoice';
}

export function defaultPrinter(db: DB | null | undefined): Printer | undefined {
  return db?.printers?.find((p) => p.dflt) || db?.printers?.[0];
}

/** The paper a printer takes. "Save as PDF" is A4. */
export function paperOf(p: Printer | undefined, fallback: Paper = '80mm'): Paper {
  if (!p) return fallback;
  return p.kind === 'pdf' ? 'A4' : p.width || fallback;
}

/** Everything printDoc needs for one document on one printer. */
export function printOptsFor(db: DB | null | undefined, docKind: DocKind, printer?: Printer): PrintOpts {
  const tplId = db?.templateFor?.[docKind];
  const found = db?.templates?.find((t) => t.id === tplId);
  // "Copies per bill" under Printing is the shop's rule; the template's is its own default
  const tpl = found && db?.printer?.copies ? { ...found, copies: Math.max(found.copies || 1, db.printer.copies) } : found;
  const p = printer || defaultPrinter(db);
  return {
    tpl,
    paper: p ? paperOf(p) : tpl?.paper,
    printerUrl: Platform.OS === 'ios' ? p?.url : undefined,
  };
}

/**
 * iOS can remember a printer and print to it without a dialog. Android always
 * goes through its print dialog, where the printer is chosen.
 */
export async function pickSystemPrinter(): Promise<{ name: string; url: string } | null> {
  if (Platform.OS !== 'ios') return null;
  try {
    const p = await Print.selectPrinterAsync();
    return p?.url ? { name: p.name, url: p.url } : null;
  } catch {
    return null;
  }
}
