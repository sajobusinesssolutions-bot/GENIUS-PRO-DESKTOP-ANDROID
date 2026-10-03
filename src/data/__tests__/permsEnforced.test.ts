/**
 * Every switch in Users & roles must do something. A permission that is
 * offered but never checked anywhere tells the owner a person is limited when
 * they are not — which is how this list once came to include tasks, deleting
 * customers and half the Home figures, none of which were enforced.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PERM_MATRIX, LEGACY_PERM } from '../perms';

function sources(dir: string, out: string[] = []): string[] {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { if (f !== '__tests__') sources(p, out); }
    else if (/\.(ts|tsx)$/.test(f) && !p.endsWith('perms.ts')) out.push(fs.readFileSync(p, 'utf8'));
  }
  return out;
}

it('checks every permission it offers somewhere in the app', () => {
  const code = sources(path.join(__dirname, '..', '..')).join('\n');
  const unchecked: string[] = [];
  PERM_MATRIX.forEach((g) => g.acts.forEach(([act]) => {
    const key = g.k + '.' + act;
    const coarse = Object.entries(LEGACY_PERM).filter(([, v]) => v === key).map(([k]) => k);
    const used = code.includes("'" + key + "'") || code.includes('"' + key + '"')
      || coarse.some((k) => new RegExp("(can|useCan|perm)\s*[:(]\s*'" + k + "'|canFor\([^,]+,\s*'" + k + "'").test(code));
    if (!used) unchecked.push(key);
  }));
  expect(unchecked).toEqual([]);
});
