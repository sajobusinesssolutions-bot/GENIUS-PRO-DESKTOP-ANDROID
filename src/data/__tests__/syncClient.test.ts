/**
 * Turning the local change queue into operations for the server.
 *
 * Two bugs lived here before this existed: sales and purchases were queued by
 * document number while records are found by id, so every one was quietly
 * skipped; and nothing was queued at all while the phone was online, so a
 * connected phone with sync on never sent anything new.
 */
import { opsFrom } from '../syncClient';
import { enqueue } from '../logic';

function book(over: any = {}): any {
  return {
    session: { online: true, userId: 'u1', warehouse: 'w1', till: 'Till 1' },
    settings: { defaultWarehouse: 'w1' },
    warehouses: [{ id: 'w1', name: 'Main' }],
    sync: { on: true, lamport: 0 },
    queue: [],
    sales: [{ id: 's1', no: 'INV-00001', total: 1000 }],
    purchases: [{ id: 'p1', no: 'PUR-00001', total: 500 }],
    payments: [], entries: [], journal: [], movements: [], creditNotes: [],
    products: [{ id: 'prd1', name: 'Sugar' }],
    parties: [],
    ...over,
  };
}

const wiring = { businessId: 'biz1', deviceId: 'dev1' };

describe('what gets queued', () => {
  it('queues while online once sync is on', () => {
    const d = book();
    enqueue(d, 'sale', 's1');
    expect(d.queue.length).toBe(1);
  });

  it('does not queue while online with sync off, as before', () => {
    const d = book({ sync: { on: false } });
    enqueue(d, 'sale', 's1');
    expect(d.queue.length).toBe(0);
  });

  it('still queues offline work with sync off', () => {
    const d = book({ sync: { on: false }, session: { online: false, userId: 'u1', warehouse: 'w1' } });
    enqueue(d, 'sale', 's1');
    expect(d.queue.length).toBe(1);
  });
});

describe('opsFrom', () => {
  it('finds a sale by its id and sends the whole record', () => {
    const d = book({ queue: [{ id: 'q1', ts: '', kind: 'sale', ref: 's1' }] });
    const { ops, skipped } = opsFrom(d, wiring);
    expect(skipped).toEqual([]);
    expect(ops[0].kind).toBe('sale.commit');
    expect(ops[0].payload).toMatchObject({ id: 's1', total: 1000 });
  });

  it('skips an entry queued by document number — the old bug — rather than sending nothing', () => {
    const d = book({ queue: [{ id: 'q1', ts: '', kind: 'sale', ref: 'INV-00001' }] });
    const { ops, skipped } = opsFrom(d, wiring);
    expect(ops).toEqual([]);
    expect(skipped).toEqual(['q1']);
  });

  it('stamps business, device, branch and who did it', () => {
    const d = book({ queue: [{ id: 'q1', ts: '', kind: 'purchase', ref: 'p1' }] });
    const op = opsFrom(d, wiring).ops[0];
    expect(op.business).toBe('biz1');
    expect(op.device).toBe('dev1');
    expect(op.branch).toBe('w1');
    expect(op.user).toBe('u1');
    expect(op.kind).toBe('purchase.create');
  });

  it('sends catalogue records as last-write-wins upserts', () => {
    const d = book({ queue: [{ id: 'q1', ts: '', kind: 'product', ref: 'prd1' }] });
    const op = opsFrom(d, wiring).ops[0];
    expect(op.kind).toBe('record.upsert');
    expect(op.payload).toMatchObject({ coll: 'products', recId: 'prd1' });
  });

  it('gives every operation its own id, so a retried push cannot double anything', () => {
    const d = book({
      queue: [
        { id: 'q1', ts: '', kind: 'sale', ref: 's1' },
        { id: 'q2', ts: '', kind: 'purchase', ref: 'p1' },
      ],
    });
    const { ops } = opsFrom(d, wiring);
    expect(new Set(ops.map((o) => o.opId)).size).toBe(2);
  });

  it('keeps the device counter climbing from where it left off', () => {
    const d = book({
      sync: { on: true, lamport: 41 },
      queue: [
        { id: 'q1', ts: '', kind: 'sale', ref: 's1' },
        { id: 'q2', ts: '', kind: 'purchase', ref: 'p1' },
      ],
    });
    expect(opsFrom(d, wiring).ops.map((o) => o.lamport)).toEqual([42, 43]);
  });

  it('drops a queue entry whose record no longer exists', () => {
    const d = book({ queue: [{ id: 'q1', ts: '', kind: 'sale', ref: 'gone' }] });
    expect(opsFrom(d, wiring).skipped).toEqual(['q1']);
  });

  it('sends a page at a time rather than everything at once', () => {
    const queue = Array.from({ length: 250 }, (_, i) => ({ id: 'q' + i, ts: '', kind: 'sale', ref: 's1' }));
    expect(opsFrom(book({ queue }), wiring).ops.length).toBe(200);
  });
});

describe('operation ids', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('are real UUIDs, because the server stores them in a uuid column', () => {
    const d = book({ queue: [{ id: 'q1', ts: '', kind: 'sale', ref: 's1' }] });
    expect(opsFrom(d, wiring).ops[0].opId).toMatch(UUID);
  });

  it('never repeat', () => {
    const { newOpId } = require('../syncClient');
    const seen = new Set(Array.from({ length: 500 }, () => newOpId()));
    expect(seen.size).toBe(500);
    seen.forEach((id: string) => expect(id).toMatch(UUID));
  });
});

describe('matching acknowledgements back to the queue', () => {
  it('pairs each op with the queue entry it came from, even after a skip', () => {
    const d = book({
      queue: [
        { id: 'q-gone', ts: '', kind: 'sale', ref: 'missing' },
        { id: 'q-sale', ts: '', kind: 'sale', ref: 's1' },
        { id: 'q-pur', ts: '', kind: 'purchase', ref: 'p1' },
      ],
    });
    const { ops, queueIds, skipped } = opsFrom(d, wiring);
    expect(skipped).toEqual(['q-gone']);
    expect(queueIds).toEqual(['q-sale', 'q-pur']);
    expect(ops[0].kind).toBe('sale.commit');
    expect(ops[1].kind).toBe('purchase.create');
  });
});
