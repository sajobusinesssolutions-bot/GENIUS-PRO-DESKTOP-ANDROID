/**
 * DOCUMENTS & TERMS — what every printed sale, quotation and delivery note
 * starts with: named sets of terms, a default description, the copy label,
 * how long a quotation holds, when an invoice falls due, and the payment
 * details printed at the foot. Kept in Settings and shared with the computer
 * (sharedSettings.ts), so both print the same paper.
 */
import type { DB } from './types';

export interface TermsSet { id: string; name: string; text: string }
export type DocFor = 'invoice' | 'estimate' | 'challan';
export interface DocDefaults {
  /** Which terms set each kind of document starts with. */
  termsFor?: Partial<Record<DocFor, string>>;
  /** What a new sale or quotation's description starts as. */
  description?: string;
  /** "auto": ORIGINAL on the first copy, DUPLICATE, TRIPLICATE after; or always ORIGINAL; or none. */
  copyLabel?: 'auto' | 'original' | 'none';
  /** A quotation holds for this many days. */
  quoteValidDays?: number;
  /** A credit invoice falls due this many days after it is raised; 0 for no due date. */
  invoiceDueDays?: number;
  /** Bank, mobile money and account names, printed at the foot. */
  paymentDetails?: string;
  /** Whether an invoice prints the payment details unless the sale says otherwise. */
  paymentOnInvoice?: boolean;
}

export function termsSets(db: DB | null | undefined): TermsSet[] {
  const own = (db?.settings as any)?.docTerms as TermsSet[] | undefined;
  if (own && own.length) return own;
  // a book from before: its one standing set of terms is the first set
  const t = db?.firm.terms?.trim();
  return t ? [{ id: 'standard', name: 'Standard', text: t }] : [];
}

export function docDefaults(db: DB | null | undefined): Required<Omit<DocDefaults, 'termsFor'>> & { termsFor: Partial<Record<DocFor, string>> } {
  const d = ((db?.settings as any)?.docDefaults || {}) as DocDefaults;
  return {
    termsFor: d.termsFor || {},
    description: d.description || '',
    copyLabel: d.copyLabel || 'none',
    quoteValidDays: d.quoteValidDays ?? 14,
    invoiceDueDays: d.invoiceDueDays ?? 0,
    paymentDetails: d.paymentDetails ?? db?.firm.bankDetails ?? '',
    paymentOnInvoice: d.paymentOnInvoice ?? true,
  };
}

/** The terms a new document of this kind starts with. */
export function defaultTermsFor(db: DB | null | undefined, kind: DocFor): { id: string | null; text: string } {
  const sets = termsSets(db);
  const want = docDefaults(db).termsFor[kind];
  const s = sets.find((x) => x.id === want) || (kind === 'challan' ? undefined : sets[0]);
  return s ? { id: s.id, text: s.text } : { id: null, text: '' };
}

/** The label for each printed copy, in order. */
export function copyLabels(mode: 'auto' | 'original' | 'none' | undefined, copies: number): string[] {
  const names = ['ORIGINAL', 'DUPLICATE', 'TRIPLICATE', 'QUADRUPLICATE', 'COPY'];
  return Array.from({ length: copies }, (_, i) => (mode === 'auto' ? names[Math.min(i, names.length - 1)] : mode === 'original' ? 'ORIGINAL' : ''));
}
