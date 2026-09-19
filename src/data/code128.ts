/**
 * Code 128 B, as bar widths.
 *
 * The price-tag screen used to draw decorative bars derived from the item code,
 * which looked right on paper and then would not scan at the till — the one
 * thing a price tag has to do. This encodes the code properly, so a tag printed
 * from the app reads back the same string the item is stored under.
 *
 * Code set B is used throughout: it covers ASCII 32–126, which is every
 * character an item code in this app can hold, and avoids the set switching
 * that a mixed encoder would need.
 */

/** The 107 symbol patterns, each six digits of alternating bar/space widths. */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '233111',
];

const START_B = 104;
const STOP = 106;

/** True when every character can be carried by code set B. */
export function encodable(text: string): boolean {
  return /^[\x20-\x7E]+$/.test(text);
}

/**
 * Returns the bar widths for `text`, starting with a bar and alternating.
 * An empty array means the text cannot be encoded.
 */
export function code128b(text: string): number[] {
  if (!text || !encodable(text)) return [];
  const codes: number[] = [START_B];
  for (let i = 0; i < text.length; i += 1) {
    codes.push(text.charCodeAt(i) - 32);
  }
  // the check character is the start value plus each symbol times its position
  let sum = START_B;
  for (let i = 1; i < codes.length; i += 1) sum += codes[i] * i;
  codes.push(sum % 103);
  codes.push(STOP);

  const widths: number[] = [];
  codes.forEach((c) => {
    PATTERNS[c].split('').forEach((d) => widths.push(Number(d)));
  });
  // the stop pattern carries a final bar of two modules
  widths.push(2);
  return widths;
}

/**
 * The same bars as an inline SVG, for anything printed.
 *
 * These were coloured <span>s, and print engines leave out background colours
 * unless "print backgrounds" is switched on — so every barcode came out as a
 * blank strip. SVG shapes are ink, and always print.
 *
 * `module` is the width of one narrow bar in pixels — 1 is too fine for most
 * thermal printers, so callers pass 2 where there is room.
 */
export function code128Html(text: string, height: number, module = 2): string {
  const widths = code128b(text);
  if (!widths.length) return '';
  let x = 0;
  const bars: string[] = [];
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${w * module}" height="${height}"/>`);
    x += w * module;
  });
  // ten modules of quiet space either side, which scanners need to find the start
  const quiet = 10 * module;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${x + quiet * 2}" height="${height}" `
    + `viewBox="${-quiet} 0 ${x + quiet * 2} ${height}" shape-rendering="crispEdges" style="max-width:100%">`
    + `<g fill="#000">${bars.join('')}</g></svg>`;
}
