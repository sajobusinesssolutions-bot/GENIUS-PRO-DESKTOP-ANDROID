/**
 * Report exporters — PDF, print preview, spreadsheet and share.
 *
 * Reference precedents in the prototype: exportCsv()/saveFile() (~8095-8115),
 * rcShare() (8039) and the receipt screen's "Share as PDF" (6040).
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { File, Paths } from 'expo-file-system';
import * as XLSX from 'xlsx';
import { Platform } from 'react-native';
import { ReportResult, Cell, cellText, cellTone } from './reports';
import { printPdfToCache } from './docPrint';

export interface ExportMeta {
  /** The shop name printed at the head of the sheet. */
  firm?: string;
  /** "Last 30 days", "1 Jan 2026 – 31 Jan 2026" — printed under the title. */
  range?: string;
}

export type ShareTarget = 'whatsapp' | 'system';

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

function slug(s: string): string {
  return (s || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report';
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function fileNameFor(result: ReportResult, ext: string): string {
  return `${slug(result.title)}-${stamp()}.${ext}`;
}

/**
 * Write a payload into the app's document directory and hand back its URI.
 * SDK 54 replaced `writeAsStringAsync` with the `File` / `Paths` objects, so
 * this is the current API rather than the legacy one.
 */
function writeFile(name: string, content: string, encoding: 'utf8' | 'base64'): string {
  const file = new File(Paths.document, name);
  file.create({ overwrite: true, intermediates: true });
  file.write(content, { encoding });
  return file.uri;
}

/* ------------------------------------------------------------------ */
/* HTML — the printed sheet, styled to match the app                    */
/* ------------------------------------------------------------------ */

function esc(s: string): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const TONE_CSS: Record<string, string> = {
  good: '#0A7346', warn: '#8C5A08', danger: '#C93A3A', muted: '#6B7387', accent: '#2563EB',
};

function cellHtml(c: Cell): string {
  const tone = cellTone(c);
  const text = esc(cellText(c));
  return tone ? `<span style="color:${TONE_CSS[tone] || '#161A22'}">${text}</span>` : text;
}

/** The report as a standalone A4 sheet — the same palette as the light theme. */
export function toHtml(result: ReportResult, meta: ExportMeta = {}): string {
  const head = result.cols
    .map((c) => `<th class="${c.r ? 'r' : ''}">${esc(c.h)}</th>`)
    .join('');

  const body = result.rows.length
    ? result.rows
      .map((r) => '<tr>' + result.cols
        .map((c, i) => `<td class="${c.r ? 'r num' : ''}">${cellHtml(r[i])}</td>`)
        .join('') + '</tr>')
      .join('')
    : `<tr><td colspan="${result.cols.length}" class="empty">No data in this period. Try a wider date range.</td></tr>`;

  const foot = result.foot
    ? '<tfoot><tr>' + result.cols
      .map((c, i) => `<td class="${c.r ? 'r num' : ''}">${cellHtml(result.foot![i] ?? '')}</td>`)
      .join('') + '</tr></tfoot>'
    : '';

  const stats = result.stats && result.stats.length
    ? '<div class="stats">' + result.stats
      .map((s) => `<div class="stat"><div class="cap">${esc(s.k)}</div><div class="v">${esc(s.v)}</div></div>`)
      .join('') + '</div>'
    : '';

  return `<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(result.title)}</title>
<style>
  @page { margin: 16mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color: #161A22; background: #FFFFFF; margin: 0; font-size: 11px; }
  .firm { font-size: 11px; color: #6B7387; letter-spacing: .04em; text-transform: uppercase; }
  h1 { font-size: 19px; margin: 3px 0 2px; font-weight: 700; letter-spacing: -0.01em; }
  .range { font-size: 11.5px; color: #4B5568; margin-bottom: 14px; }
  .stats { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
  .stat { flex: 1 1 140px; border: 1px solid #E4E7EE; border-radius: 9px; padding: 9px 11px; background: #F1F3F7; }
  .cap { font-size: 9.5px; text-transform: uppercase; letter-spacing: .06em; color: #6B7387; margin-bottom: 3px; }
  .v { font-size: 14px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 7px 9px; border-bottom: 1px solid #E4E7EE; text-align: left; vertical-align: top; }
  th { font-size: 9.5px; text-transform: uppercase; letter-spacing: .06em; color: #6B7387;
       background: #F1F3F7; border-bottom: 1px solid #D3D8E3; font-weight: 600; }
  td.r, th.r { text-align: right; }
  td.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  tfoot td { background: #F1F3F7; font-weight: 700; border-top: 1px solid #D3D8E3; border-bottom: none; }
  .empty { text-align: center; color: #6B7387; padding: 28px 10px; }
  .note { margin-top: 12px; font-size: 10.5px; color: #6B7387; line-height: 1.5; }
  .foot { margin-top: 20px; padding-top: 9px; border-top: 1px solid #E4E7EE;
          font-size: 9.5px; color: #8A92A3; display: flex; justify-content: space-between; }
</style></head><body>
  ${meta.firm ? `<div class="firm">${esc(meta.firm)}</div>` : ''}
  <h1>${esc(result.title)}</h1>
  ${meta.range ? `<div class="range">${esc(meta.range)}</div>` : ''}
  ${stats}
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>
  ${result.note ? `<div class="note">${esc(result.note)}</div>` : ''}
  <div class="foot"><span>Genius POS</span><span>${esc(new Date().toLocaleString())}</span></div>
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

/** Render to a PDF file and return its URI. */
export async function toPdf(result: ReportResult, meta: ExportMeta = {}): Promise<string> {
  // PDF reports are shared documents, so keep them on a predictable A4 page
  // instead of letting the platform choose a device-specific paper size.
  return printPdfToCache({ html: toHtml(result, meta), width: 595, height: 842 }, fileNameFor(result, 'pdf'));
}

/** Open the system print/preview dialog. */
export async function preview(result: ReportResult, meta: ExportMeta = {}): Promise<void> {
  await Print.printAsync({ html: toHtml(result, meta), width: 595, height: 842 });
}

/* ------------------------------------------------------------------ */
/* Spreadsheet                                                         */
/* ------------------------------------------------------------------ */

/** Rows as an array-of-arrays: header, body, then the totals row. */
function sheetMatrix(result: ReportResult): (string | number)[][] {
  const num = (c: Cell) => {
    if (typeof c === 'number') return c;
    if (c && typeof c === 'object' && typeof c.n === 'number') return c.n;
    return cellText(c);
  };
  const out: (string | number)[][] = [result.cols.map((c) => c.h)];
  result.rows.forEach((r) => out.push(result.cols.map((_, i) => num(r[i] ?? ''))));
  if (result.foot) out.push(result.cols.map((_, i) => num(result.foot![i] ?? '')));
  return out;
}

/**
 * A real `.xlsx`, written by SheetJS as base64 through expo-file-system.
 * Returns the file URI.
 */
export async function toExcel(result: ReportResult, meta: ExportMeta = {}): Promise<string> {
  const head: (string | number)[][] = [];
  if (meta.firm) head.push([meta.firm]);
  head.push([result.title]);
  if (meta.range) head.push([meta.range]);
  head.push([]);

  const ws = XLSX.utils.aoa_to_sheet([...head, ...sheetMatrix(result)]);
  ws['!cols'] = result.cols.map((c, i) => ({
    wch: Math.max(c.h.length + 2, ...result.rows.slice(0, 200).map((r) => cellText(r[i]).length + 2), 10),
  }));
  const wb = XLSX.utils.book_new();
  // Excel caps sheet names at 31 characters and bans []:*?/\
  XLSX.utils.book_append_sheet(wb, ws, result.title.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Report');
  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string;
  return writeFile(fileNameFor(result, 'xlsx'), base64, 'base64');
}

function csvCell(c: Cell): string {
  const t = cellText(c);
  return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}

/** CSV — reference exportCsv(), ~8095. Kept as the plain-text fallback. */
export function toCsvText(result: ReportResult): string {
  const lines = [result.cols.map((c) => csvCell(c.h)).join(',')];
  result.rows.forEach((r) => lines.push(result.cols.map((_, i) => csvCell(r[i] ?? '')).join(',')));
  if (result.foot) lines.push(result.cols.map((_, i) => csvCell(result.foot![i] ?? '')).join(','));
  return lines.join('\n');
}

export async function toCsv(result: ReportResult): Promise<string> {
  return writeFile(fileNameFor(result, 'csv'), toCsvText(result), 'utf8');
}

/* ------------------------------------------------------------------ */
/* Sharing                                                             */
/* ------------------------------------------------------------------ */

/** A short plain-text digest — what goes into a WhatsApp message. */
export function toSummaryText(result: ReportResult, meta: ExportMeta = {}): string {
  const out: string[] = [];
  if (meta.firm) out.push(meta.firm);
  out.push('*' + result.title + '*');
  if (meta.range) out.push(meta.range);
  out.push('');
  (result.stats || []).forEach((s) => out.push(s.k + ': ' + s.v));
  if (result.stats && result.stats.length) out.push('');
  result.rows.slice(0, 12).forEach((r) => {
    out.push(result.cols.map((c, i) => cellText(r[i])).filter(Boolean).join(' · '));
  });
  if (result.rows.length > 12) out.push('…and ' + (result.rows.length - 12) + ' more rows');
  if (result.foot) {
    out.push('');
    out.push(result.cols.map((c, i) => cellText(result.foot![i])).filter(Boolean).join(' · '));
  }
  return out.join('\n');
}

function reportAmount(result: ReportResult): string {
  if (!result.foot) return '';
  const values = result.foot.map((cell) => cellText(cell)).filter(Boolean);
  return values.length ? values[values.length - 1] : '';
}

export function reportShareMessage(result: ReportResult, meta: ExportMeta = {}): string {
  const amount = reportAmount(result);
  return [
    'Hello,',
    '',
    'Please find attached the ' + result.title + '.',
    meta.firm ? 'Business: ' + meta.firm : '',
    meta.range ? 'Period: ' + meta.range : '',
    amount ? 'Document amount/total: ' + amount : '',
    '',
    'Regards,',
    meta.firm || 'Genius POS',
  ].filter(Boolean).join('\n');
}

/**
 * Hand a generated file to the system share sheet.
 *
 * A failure here used to come back as a bare `false`, so every caller could
 * only ever say "it was saved instead" — never *why* the share sheet did not
 * open. On Android that swallowed the real reason (most often the file's
 * `file://` URI not being one the share target is allowed to read), leaving
 * "PDF written to file://…" as the only thing anyone ever saw, indistinguishable
 * from sharing genuinely being unavailable.
 */
export async function shareFile(uri: string, mime: string, title: string): Promise<{ ok: boolean; reason?: string }> {
  const available = await Sharing.isAvailableAsync();
  if (available === false) return { ok: false, reason: 'Sharing is not available on this device.' };
  try {
    await Sharing.shareAsync(uri, { mimeType: mime, dialogTitle: title, UTI: mime === 'application/pdf' ? 'com.adobe.pdf' : undefined });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: e?.message || 'The share sheet could not be opened.' };
  }
}

async function sharePdfWithAndroidIntent(uri: string, result: ReportResult, meta: ExportMeta): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const file = new File(uri);
    await IntentLauncher.startActivityAsync('android.intent.action.SEND', {
      type: 'application/pdf',
      flags: 1 | 2,
      extra: {
        'android.intent.extra.STREAM': file.contentUri || uri,
        'android.intent.extra.TEXT': reportShareMessage(result, meta),
        'android.intent.extra.SUBJECT': result.title,
      },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Share the report.
 *
 * - `system` renders a PDF and opens the share sheet (WhatsApp appears there
 *   alongside mail and Drive).
 * - `whatsapp` creates the same strict A4 PDF as the system target and opens
 *   the native share sheet, where WhatsApp can receive the document.
 */
export async function shareTo(
  result: ReportResult,
  target: ShareTarget = 'system',
  meta: ExportMeta = {},
): Promise<{ ok: boolean; how: 'whatsapp' | 'sheet' | 'none'; reason?: string }> {
  const uri = await toPdf(result, meta);
  if (!uri) return { ok: false, how: 'none', reason: 'The PDF could not be created.' };

  // Android's direct SEND intent is unreliable for PDFs and loses the attachment in
  // WhatsApp / email share flows; the system share sheet preserves the file and lets the
  // user choose the destination app, which is what the app and tests expect. The intent
  // is only a fallback for when the share sheet itself could not open at all.
  const shared = await shareFile(uri, 'application/pdf', result.title);
  const ok = shared.ok || await sharePdfWithAndroidIntent(uri, result, meta);
  return { ok, how: ok ? (target === 'whatsapp' ? 'whatsapp' : 'sheet') : 'none', reason: ok ? undefined : shared.reason };
}
