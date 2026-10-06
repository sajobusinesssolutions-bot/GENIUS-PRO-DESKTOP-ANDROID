/**
 * Makes the Google Sans files measure like an ordinary UI font.
 *
 * Google Sans covers many scripts, so its files declare glyphs reaching 2.25 em
 * from top to bottom (head yMax/yMin, OS/2 winAscent/winDescent). Android pads
 * every line of text to those extremes, which made each row about 60% taller
 * than with Inter and clipped the text inside fixed-height fields. The line's
 * real metrics (hhea ascender 966, descender -286) are untouched; only the
 * extremes are brought in to just outside them.
 *
 * Run once after updating @expo-google-fonts/google-sans:
 *   node scripts/trim-font-metrics.js
 * It writes the trimmed copies into assets/fonts, which App.tsx loads.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'node_modules', '@expo-google-fonts', 'google-sans');
const OUT = path.join(__dirname, '..', 'assets', 'fonts');
const WEIGHTS = ['400Regular', '500Medium', '600SemiBold', '700Bold'];
/** How far past the line's own ascender and descender the extremes may reach, in font units. */
const MARGIN = 40;

function tables(b) {
  const out = {};
  const n = b.readUInt16BE(4);
  for (let i = 0; i < n; i += 1) {
    const o = 12 + i * 16;
    out[b.toString('ascii', o, o + 4)] = b.readUInt32BE(o + 8);
  }
  return out;
}

fs.mkdirSync(OUT, { recursive: true });
for (const w of WEIGHTS) {
  const name = 'GoogleSans_' + w + '.ttf';
  const b = Buffer.from(fs.readFileSync(path.join(SRC, w, name)));
  const t = tables(b);
  const asc = b.readInt16BE(t.hhea + 4);
  const desc = b.readInt16BE(t.hhea + 6);
  const top = asc + MARGIN;
  const bottom = desc - MARGIN;
  b.writeInt16BE(top, t.head + 42);           // head.yMax
  b.writeInt16BE(bottom, t.head + 38);        // head.yMin
  b.writeUInt16BE(top, t['OS/2'] + 74);       // OS/2.usWinAscent
  b.writeUInt16BE(-bottom, t['OS/2'] + 76);   // OS/2.usWinDescent
  fs.writeFileSync(path.join(OUT, name), b);
  console.log(name, 'extremes now', top, '/', bottom);
}
