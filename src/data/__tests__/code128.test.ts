import { code128b, code128Html, encodable } from '../code128';

/** Widths back to the symbol values, so a test can read what was encoded. */
function symbols(widths: number[]): number[] {
  const out: number[] = [];
  // the trailing two-module bar of the stop pattern is not part of a symbol
  const body = widths.slice(0, widths.length - 1);
  for (let i = 0; i < body.length; i += 6) {
    out.push(Number(body.slice(i, i + 6).join('')));
  }
  return out;
}

describe('code128b', () => {
  it('starts in code set B and stops', () => {
    const s = symbols(code128b('A'));
    expect(s[0]).toBe(211214);   // START B
    expect(s[s.length - 1]).toBe(233111); // STOP
  });

  it('encodes each character as its value less 32', () => {
    // 'A' is 65, so symbol 33, whose pattern is the 34th entry
    const s = symbols(code128b('A'));
    expect(s[1]).toBe(111323);
  });

  it('appends the modulo-103 check character', () => {
    // START(104) + 33*1 = 137, 137 % 103 = 34
    const s = symbols(code128b('A'));
    expect(s[2]).toBe(131123); // pattern for value 34
  });

  it('works out the check character over several characters', () => {
    const text = 'PRO-12';
    const codes = [104, ...text.split('').map((c) => c.charCodeAt(0) - 32)];
    let sum = 104;
    for (let i = 1; i < codes.length; i += 1) sum += codes[i] * i;
    const s = symbols(code128b(text));
    // start + 6 characters + check + stop
    expect(s.length).toBe(9);
    expect(s[s.length - 2]).toBe(Number(
      ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
        '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
        '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
        '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
        '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
        '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
        '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
        '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
        '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
        '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
        '114131', '311141', '411131', '211412', '211214', '211232', '233111'][sum % 103],
    ));
  });

  it('alternates bar and space, always starting and ending on a bar', () => {
    const w = code128b('SKU-9');
    expect(w.length % 2).toBe(1); // odd, so the last element is a bar
  });

  it('refuses a code it cannot carry', () => {
    expect(code128b('')).toEqual([]);
    expect(code128b('naïve')).toEqual([]);
    expect(encodable('naïve')).toBe(false);
    expect(encodable('WIDGET-001')).toBe(true);
  });
});

describe('code128Html', () => {
  it('draws one span per width, inked on the bars', () => {
    const html = code128Html('A', 40, 2);
    const spans = html.split('<span').length - 1;
    expect(spans).toBe(code128b('A').length);
    expect(html.indexOf('background:#000')).toBeGreaterThan(-1);
    expect(html.indexOf('background:#fff')).toBeGreaterThan(-1);
  });

  it('scales every bar by the module width', () => {
    const one = code128Html('A', 40, 1);
    const two = code128Html('A', 40, 2);
    const first = (s: string) => Number(s.match(/width:(\d+)px/)![1]);
    expect(two === one).toBe(false);
    expect(first(two)).toBe(first(one) * 2);
  });

  it('gives nothing back for a code it cannot encode', () => {
    expect(code128Html('naïve', 40)).toBe('');
  });
});
