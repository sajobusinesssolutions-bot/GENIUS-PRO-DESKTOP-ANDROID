/**
 * Turning the local change queue into operations for the server.
 *
 * Two bugs lived here before this existed: sales and purchases were queued by
 * document number while records are found by id, so every one was quietly
 * skipped; and nothing was queued at all while the phone was online, so a
 * connected phone with sync on never sent anything new.
 */
import { opsFrom, pushQueue, uploadSnapshot } from '../syncClient';
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
    shifts: [],
    payments: [], entries: [], journal: [], movements: [], creditNotes: [],
    products: [{ id: 'prd1', name: 'Sugar' }],
    parties: [],
    ...over,
  };
}

const wiring = { businessId: 'biz1', deviceId: 'dev1' };

describe('snapshot compare-and-swap', () => {
  it('uploads the current snapshot version so stale writes are rejected', async () => {
    const d = book({ sync: { on: true, lamport: 0, snapshotVersion: 7 } });
    const fetchMock = jest.fn(async () => ({
      ok: true,
      headers: { get: () => '0' },
      text: async () => JSON.stringify({ bytes: 99, version: 8 }),
    }));
    const prev = global.fetch;
    // @ts-expect-error mock fetch for the request
    global.fetch = fetchMock;
    try {
      const r = await uploadSnapshot(d, 'access-token', wiring);
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error('snapshot upload failed');
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/businesses/biz1/snapshot'),
        expect.objectContaining({
          body: expect.stringContaining('"version":7'),
        }),
      );
      expect(r.value.version).toBe(8);
    } finally {
      global.fetch = prev;
    }
  });
});

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

describe('business roles', () => {
  it('keeps the role the server returns for each business', async () => {
    const prev = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      headers: { get: () => '0' },
      text: async () => JSON.stringify({ businesses: [{ id: 'biz1', name: 'Main', tin: null, created_at: '2026-01-01', snapshot_at: null, snapshot_bytes: null, role: 'manager', active: true }] }),
    })) as any;
    try {
      const r = await require('../syncClient').listBusinesses('token');
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error('list failed');
      expect(r.value[0]).toMatchObject({ id: 'biz1', role: 'manager' });
    } finally {
      global.fetch = prev;
    }
  });

  it('hides businesses that have no saved snapshot yet', () => {
    const { filterVisibleBusinesses } = require('../syncClient');
    const list = [
      { id: 'biz1', name: 'Saved', snapshot_at: '2026-01-02T00:00:00.000Z', snapshot_bytes: 123, active: true },
      { id: 'biz2', name: 'Not saved', snapshot_at: null, snapshot_bytes: null, active: true },
      { id: 'biz3', name: 'Current phone', snapshot_at: null, snapshot_bytes: null, active: true },
    ];
    expect(filterVisibleBusinesses(list, 'biz3', 'firm-3')).toEqual([
      { id: 'biz1', name: 'Saved', snapshot_at: '2026-01-02T00:00:00.000Z', snapshot_bytes: 123, active: true },
      { id: 'biz3', name: 'Current phone', snapshot_at: null, snapshot_bytes: null, active: true },
    ]);
  });
});

describe('opsFrom', () => {
  it('sends a shift close so other tills can receive the day close', () => {
    const shift = { id: 'shift1', userId: 'u1', till: 'Till 1', closedAt: '2026-09-19T18:00:00.000Z' };
    const d = book({ shifts: [shift], queue: [{ id: 'q1', ts: '', kind: 'shift.close', ref: 'shift1' }] });
    const op = opsFrom(d, wiring).ops[0];
    expect(op.kind).toBe('shift.close');
    expect(op.payload).toEqual(shift);
  });

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

  it('returns rejected operation details when the server refuses stale work', async () => {
    const d = book({ queue: [{ id: 'q1', ts: '', kind: 'sale', ref: 's1' }, { id: 'q2', ts: '', kind: 'sale', ref: 's1' }] });
    const prev = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      headers: { get: () => '0' },
      text: async () => JSON.stringify({ accepted: ['op_1'], rejected: [{ opId: 'op_2', reason: 'stale_rev', note: 'Older than server' }], seq: 2 }),
    })) as any;
    try {
      const r = await pushQueue(d, 'token', wiring);
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error('push should be reported');
      expect(r.value.rejected).toBe(1);
      expect(r.value.rejections).toEqual([{ opId: 'op_2', reason: 'stale_rev', note: 'Older than server' }]);
    } finally {
      global.fetch = prev;
    }
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
