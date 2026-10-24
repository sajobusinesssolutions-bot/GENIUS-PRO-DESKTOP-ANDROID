/* A real Vyapar backup through the importer, compared with Vyapar's own stock and balances.
   Export its tables to JSON and run with KTL_JSON=that.json npx jest vyaparRealBackup; skipped otherwise. */
import { emptyBook } from '../seed';
import { importVyapar } from '../vyapar';
import { partyBalance } from '../logic';

const FILE = process.env.KTL_JSON as string;
const held = (p: any) => Object.values(p.stock || {}).reduce((a: number, q: any) => a + (Number(q) || 0), 0);

(FILE ? test : test.skip)('KTL backup matches Vyapar', () => {
  const t = JSON.parse(require('fs').readFileSync(FILE, 'utf8'));
  const d: any = emptyBook();
  const rep = importVyapar(d, t, 1);
  console.log(JSON.stringify(rep).slice(0, 800));
  const key = (s: any) => String(s).trim().toLowerCase();
  const iBad: any[] = [];
  for (const v of t.kb_items.filter((i: any) => Number(i.item_type) === 1)) {
    const l = d.products.filter((p: any) => key(p.name) === key(v.item_name));
    const have = l.reduce((a: number, p: any) => a + held(p), 0);
    if (Math.abs(have - Number(v.item_stock_quantity)) > 0.001) iBad.push([v.item_name, Number(v.item_stock_quantity), have, l.length]);
  }
  const pBad: any[] = [];
  for (const v of t.kb_names.filter((n: any) => Number(n.name_type) === 1)) {
    const l = d.parties.filter((p: any) => key(p.name) === key(v.full_name));
    const have = l.reduce((a: number, p: any) => a + (p.kind === 'supplier' ? -1 : 1) * partyBalance(d, p.id), 0);
    if (Math.abs(have - Number(v.amount)) > 0.5) pBad.push([v.full_name, Number(v.amount), have, l.map((p: any) => p.kind).join('+')]);
  }
  console.log('items differ', iBad.length, JSON.stringify(iBad.slice(0, 20)));
  console.log('parties differ', pBad.length, JSON.stringify(pBad.slice(0, 30)));
});
