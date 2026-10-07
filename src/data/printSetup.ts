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
import type { DB, DocKind, Paper, Printer, PrintPurpose } from './types';
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

/** What a printer prints; an older printer without the choice prints bills, not kitchen tickets. */
export function printsOf(p: Printer): PrintPurpose[] {
  return p.prints && p.prints.length ? p.prints : ['invoice', 'cash'];
}

/** What a document is for, so it goes to the printer set up for it. */
export function purposeOf(d: { method?: string; due?: number; docKind?: DocKind; kind: string }): PrintPurpose {
  const k = d.docKind || docKindOf(d.kind);
  if (k !== 'invoice' && k !== 'receipt') return 'invoice';
  const credit = (d.due || 0) > 0 || /credit/i.test(d.method || '');
  return credit ? 'invoice' : 'cash';
}

/** The printer for a purpose: the default if it prints that, else the first that does, else the default. */
export function printerFor(db: DB | null | undefined, purpose: PrintPurpose): Printer | undefined {
  const all = db?.printers || [];
  const able = all.filter((p) => printsOf(p).includes(purpose));
  if (purpose === 'order') return able.find((p) => p.dflt) || able[0];
  return able.find((p) => p.dflt) || able[0] || defaultPrinter(db);
}

/** The paper a printer takes. "Save as PDF" is A4. */
export function paperOf(p: Printer | undefined, fallback: Paper = '80mm'): Paper {
  if (!p) return fallback;
  return p.kind === 'pdf' ? 'A4' : p.width || fallback;
}

/** Everything printDoc needs for one document on one printer. */
export function printOptsFor(db: DB | null | undefined, docKind: DocKind, printer?: Printer, purpose?: PrintPurpose): PrintOpts {
  // Receipt settings, "Print receipts as": an A4 page uses the invoice layout and the print dialog
  if (docKind === 'receipt' && db?.printer?.receiptMode === 'a4' && !printer) {
    const a4 = printOptsFor(db, 'invoice');
    const p = defaultPrinter(db);
    return { ...a4, paper: 'A4', printer: p && p.kind !== 'bluetooth' && p.kind !== 'wifi' ? p : undefined, openDrawer: !!db.printer.openDrawer };
  }
  const tplId = db?.templateFor?.[docKind];
  const found = db?.templates?.find((t) => t.id === tplId);
  // "Copies per bill" under Printing is the shop's rule; the template's is its own default
  const tpl = found && db?.printer?.copies ? { ...found, copies: Math.max(found.copies || 1, db.printer.copies) } : found;
  const p = printer || (purpose ? printerFor(db, purpose) : defaultPrinter(db));
  return {
    tpl,
    // 'Save as PDF' takes the template's own paper: a thermal receipt stays roll-sized,
    // an invoice stays A4. Only a real printer's paper overrides the template.
    paper: p && p.kind !== 'pdf' ? paperOf(p) : tpl?.paper || (p ? paperOf(p) : undefined),
    printerUrl: Platform.OS === 'ios' ? p?.url : undefined,
    printer: p,
    // the drawer opens for a sale, not for reprinting a quotation
    openDrawer: docKind === 'receipt' && !!db?.printer?.openDrawer,
  };
}

/**
 * How a document is laid out when it is shared as a PDF: always an A4 page.
 * A receipt set up for a roll printer borrows the shop's A4 invoice layout,
 * so what lands in WhatsApp or an email is a full page, not a till strip.
 */
export function shareOptsFor(db: DB | null | undefined, docKind: DocKind): PrintOpts {
  const own = printOptsFor(db, docKind);
  const base = own.tpl?.kind === 'thermal' || own.tpl?.paper !== 'A4' ? printOptsFor(db, 'invoice') : own;
  return { ...base, paper: 'A4', printer: undefined, printerUrl: undefined, openDrawer: false };
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
