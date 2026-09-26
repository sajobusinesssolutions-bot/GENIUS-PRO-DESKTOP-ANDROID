/**
 * TALKING TO THE SYNC SERVER.
 *
 * The screen said "Cloud sync" and the books never left the phone. This is what
 * makes it true: it registers the device, makes sure the business exists on the
 * server, turns the local change queue into operations and pushes them.
 *
 * What it does *not* do yet is pull. Applying another device's operations means
 * a reducer that is the mirror image of every mutator in logic.ts, and writing
 * half of one would be worse than not having it: a partly-applied change is a
 * wrong figure rather than a missing one. So this is honest one-way sync — the
 * phone's work is copied somewhere safe — and the screen says exactly that
 * rather than implying two tills already agree.
 *
 * See docs/SYNC_BACKEND.md §11 for what remains.
 */
import type { DB } from './types';
import { Op, buildOp, OpKind, WIRE_SCHEMA } from './syncProtocol';
import { SERVER_URL, serverConfigured, Result, authError, AuthError } from './authApi';
import { activeBranchId } from './branch';
import * as Crypto from 'expo-crypto';

/**
 * A version-4 UUID for an operation id.
 *
 * The server stores op ids in a uuid column, because they are its idempotency
 * key. The first version of this used the app's own short ids, and the server
 * refused every one of them as malformed — a push that could never succeed.
 * expo-crypto supplies real randomness; the fallback exists only so tests and
 * odd runtimes still get a well-formed id.
 */
export function newOpId(): string {
  try {
    const u = Crypto.randomUUID();
    if (u) return u;
  } catch { /* fall through */ }
  const h = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return h(8) + '-' + h(4) + '-4' + h(3) + '-' + ((8 + Math.floor(Math.random() * 4)).toString(16)) + h(3) + '-' + h(12);
}

/* ---------------------------------------------------------------- */

async function call<T>(path: string, access: string, body?: unknown, method = 'POST', onProgress?: (pct: number) => void): Promise<Result<T>> {
  if (!serverConfigured()) return { ok: false, error: authError('notConfigured') };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(SERVER_URL.replace(/[/]$/, '') + path, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + access,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    let text = '';
    const total = Number(res.headers?.get?.('content-length') || 0);
    if (onProgress && total > 0 && res.body?.getReader) {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        chunks.push(part.value);
        received += part.value.length;
        onProgress(Math.min(95, Math.max(10, Math.round(received / total * 100))));
      }
      const bytes = new Uint8Array(received);
      let offset = 0;
      chunks.forEach((chunk) => { bytes.set(chunk, offset); offset += chunk.length; });
      text = new TextDecoder().decode(bytes);
    } else {
      text = await res.text();
    }
    const json = text ? JSON.parse(text) : {};
    if (res.ok) return { ok: true, value: json as T };
    return { ok: false, error: authError(json?.error || 'server', json?.message) };
  } catch (e: any) {
    return { ok: false, error: authError(e?.name === 'AbortError' ? 'timeout' : 'offline') };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------- */

export interface Wiring {
  businessId: string;
  deviceId: string;
}

/**
 * Makes sure this phone and this shop are known to the server.
 *
 * Idempotent from the caller's side: the ids are kept on the book once found,
 * so this is a no-op on every run after the first.
 */
export async function ensureWiring(d: DB, access: string): Promise<Result<Wiring>> {
  const existing = d.sync?.businessId && d.sync?.deviceId
    ? { businessId: d.sync.businessId, deviceId: d.sync.deviceId }
    : null;
  if (existing) return { ok: true, value: existing };

  const biz = await call<{ businesses: Array<{ id: string; local_id: string }> }>(
    '/v1/businesses', access, undefined, 'GET',
  );
  if (!biz.ok) return biz;

  const list = biz.value.businesses || [];
  // a business chosen from the list (see BusinessesScreen) is kept; otherwise
  // the one these books were first sent as, matched by the shop's own id
  let businessId = (d.sync?.businessId && list.find((b) => b.id === d.sync.businessId)?.id)
    // Matched by id only, never by name or by being the only one: two shops
    // can share a name, and guessing is how one shop's books end up in another.
    || list.find((b) => b.local_id === d.firm.id)?.id;
  if (!businessId) {
    const made = await call<{ id: string }>('/v1/businesses', access, {
      name: d.firm.name, tin: d.firm.tin, localId: d.firm.id,
    });
    if (!made.ok) return made;
    businessId = made.value.id;
  }

  const dev = await call<{ deviceId: string }>('/v1/devices', access, {
    name: d.session.till || 'This phone',
    kind: 'phone',
    platform: 'app',
  });
  if (!dev.ok) return dev;

  return { ok: true, value: { businessId, deviceId: dev.value.deviceId } };
}

/* ---------------------------------------------------------------- */

/* ---------------------------------------------------------------- */

export interface RemoteBusiness {
  id: string;
  name: string;
  tin: string | null;
  created_at: string;
  snapshot_at: string | null;
  snapshot_bytes: number | null;
  role?: 'owner' | 'manager' | 'staff';
  active?: boolean;
}

export async function createBusiness(access: string, input: { name: string; tin?: string; phone?: string; localId: string }): Promise<Result<{ id: string; name: string; local_id: string }>> {
  return call<{ id: string; name: string; local_id: string }>('/v1/businesses', access, input);
}

/** The businesses on this account, as the server knows them. */
export async function listBusinesses(access: string, includeInactive = false): Promise<Result<RemoteBusiness[]>> {
  const r = await call<{ businesses: RemoteBusiness[] }>('/v1/businesses' + (includeInactive ? '?all=true' : ''), access, undefined, 'GET');
  return r.ok ? { ok: true, value: r.value.businesses || [] } : r;
}

export async function setBusinessStatus(access: string, businessId: string, active: boolean): Promise<Result<{ active: boolean }>> {
  return call<{ active: boolean }>('/v1/businesses/' + businessId, access, { active }, 'PATCH');
}

export function filterVisibleBusinesses(list: RemoteBusiness[], currentBusinessId?: string | null, currentLocalId?: string | null): RemoteBusiness[] {
  const current = new Set<string>();
  if (currentBusinessId) current.add(currentBusinessId);
  if (currentLocalId) current.add(currentLocalId);
  return list.filter((b) => {
    if (current.has(b.id) || (currentLocalId && (b as any).local_id === currentLocalId)) return true;
    return !!b.snapshot_at && Number(b.snapshot_bytes || 0) > 0;
  });
}

export interface BusinessMember { id: string; email: string; name: string; role: string; created_at?: string }

export async function listBusinessMembers(access: string, businessId: string): Promise<Result<BusinessMember[]>> {
  const r = await call<{ members: BusinessMember[] }>('/v1/businesses/' + businessId + '/members', access, undefined, 'GET');
  return r.ok ? { ok: true, value: r.value.members || [] } : r;
}

export async function grantBusinessAccess(access: string, businessId: string, email: string, role = 'staff'): Promise<Result<BusinessMember>> {
  const r = await call<{ member: BusinessMember }>('/v1/businesses/' + businessId + '/members', access, { email, role });
  return r.ok ? { ok: true, value: r.value.member } : r;
}

export async function revokeBusinessAccess(access: string, businessId: string, accountId: string): Promise<Result<{ removed: boolean }>> {
  return call<{ removed: boolean }>('/v1/businesses/' + businessId + '/members/' + accountId, access, undefined, 'DELETE');
}

/**
 * Sends a whole copy of the books, so this business can be opened on another
 * phone. The queue is left out — it is this phone's unsent work, not the books.
 */
export async function uploadSnapshot(d: DB, access: string, wiring: Wiring): Promise<Result<{ bytes: number; version: number }>> {
  const version = Number(d.sync?.snapshotVersion || 0);
  const data = { ...d, sync: { ...d.sync, pending: [], log: [], snapshotVersion: version } };
  return call<{ bytes: number; version: number }>('/v1/businesses/' + wiring.businessId + '/snapshot', access,
    { data, device: wiring.deviceId, version }, 'PUT');
}

/** The last copy of a business's books that any phone sent up. */
export async function downloadSnapshot(access: string, businessId: string, onProgress?: (pct: number) => void): Promise<Result<{ data: DB; updatedAt: string; version: number }>> {
  onProgress?.(10);
  const result = await call<{ data: DB; updatedAt: string; version: number }>('/v1/businesses/' + businessId + '/snapshot', access, undefined, 'GET', onProgress);
  onProgress?.(result.ok ? 100 : 0);
  return result;
}

/** What kind of operation a queued record becomes. */
const KIND_OF: Record<string, OpKind> = {
  sale: 'sale.commit',
  purchase: 'purchase.create',
  payment: 'payment.record',
  'shift.open': 'shift.open',
  'shift.close': 'shift.close',
  entry: 'entry.record',
  journal: 'journal.post',
  movement: 'stock.move',
  creditNote: 'creditnote.create',
  product: 'record.upsert',
  party: 'record.upsert',
};

/** Finds the record a queue entry points at. */
function recordFor(d: DB, kind: string, ref: string): unknown {
  switch (kind) {
    case 'sale': return d.sales.find((x) => x.id === ref);
    case 'purchase': return d.purchases.find((x) => x.id === ref);
    case 'payment': return d.payments.find((x) => x.id === ref);
    case 'shift.open':
    case 'shift.close': return d.shifts.find((x) => x.id === ref);
    case 'entry': return d.entries.find((x) => x.id === ref);
    case 'journal': return d.journal.find((x) => x.id === ref);
    case 'movement': return d.movements.find((x) => x.id === ref);
    case 'creditNote': return (d.creditNotes || []).find((x) => x.id === ref);
    case 'product': return d.products.find((x) => x.id === ref);
    case 'party': return d.parties.find((x) => x.id === ref);
    default: return undefined;
  }
}

/**
 * Turns queued changes into operations.
 *
 * A queue entry whose record has since been deleted is dropped rather than sent
 * as an empty shell — the queue is a list of intentions, and an intention about
 * something that no longer exists is not worth a row in the log.
 */
export function opsFrom(d: DB, wiring: Wiring, limit = 200): { ops: Op[]; skipped: string[]; queueIds: string[] } {
  const ops: Op[] = [];
  // the queue entry each op came from, so an acknowledgement drops the right one
  const queueIds: string[] = [];
  const skipped: string[] = [];
  let lamport = d.sync?.lamport || 0;

  for (const q of (d.queue || []).slice(0, limit)) {
    const kind = KIND_OF[q.kind];
    const rec = recordFor(d, q.kind, q.ref);
    if (!kind || !rec) { skipped.push(q.id); continue; }

    lamport += 1;
    const payload = kind === 'record.upsert'
      ? { coll: q.kind === 'product' ? 'products' : 'parties', recId: q.ref, doc: rec }
      : rec;

    ops.push(buildOp(
      {
        business: wiring.businessId,
        device: wiring.deviceId,
        branch: activeBranchId(d),
        user: d.session.userId,
        schema: WIRE_SCHEMA,
        lamport,
        newId: newOpId,
      },
      kind,
      payload,
    ));
    queueIds.push(q.id);
  }
  return { ops, skipped, queueIds };
}

export interface PushOutcome {
  sent: number;
  skipped: number;
  rejected: number;
  /** Full rejection details from the server, including stale-revision reasons. */
  rejections: Array<{ opId: string; reason: string; note?: string }>;
  /** The business's sequence on the server after this push. */
  seq: number;
  /** Queue entry ids that may now be dropped. */
  done: string[];
}

/**
 * Sends what is waiting.
 *
 * Operations carry a device-generated id, so a push that times out after the
 * server committed it can be repeated without doubling anything — which is the
 * ordinary case on the connections this is built for, not an edge case.
 */
export async function pushQueue(d: DB, access: string, wiring: Wiring): Promise<Result<PushOutcome>> {
  const { ops, skipped, queueIds } = opsFrom(d, wiring);
  if (!ops.length) {
    return { ok: true, value: { sent: 0, skipped: skipped.length, rejected: 0, rejections: [], seq: d.sync?.cursor || 0, done: skipped } };
  }

  const r = await call<{ accepted: string[]; rejected: Array<{ opId: string; reason: string; note?: string }>; seq: number }>(
    '/v1/sync/push', access, { ops },
  );
  if (!r.ok) return r;

  const acceptedIds = new Set(r.value.accepted || []);
  const done = [...skipped];
  // Matched by the op itself, never by position: a skipped entry earlier in the
  // queue would otherwise shift every later one and drop the wrong records.
  ops.forEach((op, i) => { if (acceptedIds.has(op.opId)) done.push(queueIds[i]); });

  const rejections = r.value.rejected || [];
  return {
    ok: true,
    value: {
      sent: acceptedIds.size,
      skipped: skipped.length,
      rejected: rejections.length,
      rejections,
      seq: r.value.seq,
      done,
    },
  };
}

export async function pullOps(access: string, businessId: string, since: number, limit = 500): Promise<Result<{ ops: import('./syncProtocol').StoredOp[]; seq: number; more: boolean }>> {
  return call<{ ops: import('./syncProtocol').StoredOp[]; seq: number; more: boolean }>('/v1/sync/pull?business=' + encodeURIComponent(businessId) + '&since=' + since + '&limit=' + limit, access, undefined, 'GET');
}

/** What the server holds for this business. Used to show a real figure. */
export async function serverState(access: string): Promise<Result<{ seq: number; ops: number; lastPush: string | null }>> {
  return call('/v1/sync/state', access, undefined, 'GET');
}

export type { AuthError };
