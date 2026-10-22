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
import { APP_VERSION } from './appVersion';
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
        // the server refuses books opened by a newer version than this
        'x-app-version': APP_VERSION,
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
export async function ensureWiring(d: DB, access: string, linkedDeviceId?: string): Promise<Result<Wiring>> {
  // the device signing in linked (DeviceGate) is the one this phone syncs as
  const deviceId = linkedDeviceId || d.sync?.deviceId;
  if (d.sync?.businessId && deviceId) return { ok: true, value: { businessId: d.sync.businessId, deviceId } };

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

  if (deviceId) return { ok: true, value: { businessId, deviceId } };
  // No linked device yet: claim the one tied to this sign-in. The server
  // returns the same device to the same session, so this never takes a second seat.
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
  /** Whether cloud sync was switched on in the last copy of its books. Absent from an older server. */
  sync_on?: boolean | null;
  /** The kind of business in its last copy: retail, restaurant, pharmacy. */
  business_type?: string | null;
  role?: 'owner' | 'manager' | 'staff';
  active?: boolean;
}

export async function createBusiness(access: string, input: { name: string; tin?: string; phone?: string; localId: string }): Promise<Result<{ id: string; name: string; local_id: string }>> {
  return call<{ id: string; name: string; local_id: string }>('/v1/businesses', access, input);
}

/** The businesses on this account, as the server knows them. */
/** What the account is licensed for: its edition and how many businesses it may run. */
export interface AccountLicence { plan: string | null; edition: string; maxBusinesses: number; owned: number }
let accountLicence: AccountLicence | null = null;
/** The last answer the server gave, kept for onboarding a new business. Null before the first list. */
export function lastAccountLicence(): AccountLicence | null { return accountLicence; }

export async function listBusinesses(access: string, includeInactive = false): Promise<Result<RemoteBusiness[]>> {
  const r = await call<{ businesses: RemoteBusiness[]; licence?: AccountLicence }>('/v1/businesses' + (includeInactive ? '?all=true' : ''), access, undefined, 'GET');
  if (r.ok && r.value.licence) accountLicence = r.value.licence;
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
export async function uploadSnapshot(d: DB, access: string, wiring: Wiring, cursor = d.sync?.cursor || 0): Promise<Result<{ bytes: number; version: number }>> {
  /* Never upload part of the book as if it were all of it (storage.ts wholeBook). */
  if ((d as { __window?: unknown }).__window) {
    return { ok: false, error: { failure: 'partialBook' as AuthError['failure'], message: 'The books on this phone are only partly loaded; the snapshot was not sent.' } };
  }
  const version = Number(d.sync?.snapshotVersion || 0);
  const data = { ...d, sync: { ...d.sync, pending: [], log: [], snapshotVersion: version } };
  return call<{ bytes: number; version: number }>('/v1/businesses/' + wiring.businessId + '/snapshot', access,
    { data, device: wiring.deviceId, version, cursor }, 'PUT');
}

/* ---------------- Google Drive backups ---------------- */

export interface DriveStatus { linked: boolean; email?: string; lastBackupAt?: string }

/** Whether this account has a Google Drive linked for backups. */
export async function driveStatus(access: string): Promise<Result<DriveStatus>> {
  return call<DriveStatus>('/v1/drive/status', access, undefined, 'GET');
}

/** Emails the owner's day summary from the server, so it arrives without opening a mail app. */
export async function emailSummary(access: string, to: string, subject: string, text: string): Promise<Result<{ sent: boolean }>> {
  return call<{ sent: boolean }>('/v1/summary/email', access, { to, subject, text });
}

/** The Google page where the person allows backups to their Drive. */
export async function driveLinkUrl(access: string, redirect: string): Promise<Result<{ url: string }>> {
  return call<{ url: string }>('/v1/drive/link', access, { redirect });
}

export async function unlinkDrive(access: string): Promise<Result<{ linked: boolean }>> {
  return call<{ linked: boolean }>('/v1/drive/link', access, undefined, 'DELETE');
}

/** Puts an encrypted backup into the account's "Genius Pro Backups" folder on Drive. */
export async function uploadDriveBackup(access: string, name: string, base64: string): Promise<Result<{ id: string; name: string; size: number; folder: string }>> {
  return call<{ id: string; name: string; size: number; folder: string }>('/v1/drive/backup', access, { name, data: base64 });
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
  estimate: 'record.upsert',
  ledger: 'record.upsert',
  firm: 'record.upsert',
  challan: 'record.upsert',
  purchaseOrder: 'record.upsert',
  recurring: 'record.upsert',
  plan: 'record.upsert',
  user: 'record.upsert',
  role: 'record.upsert',
  ticket: 'record.upsert',
  modifierGroup: 'record.upsert',
  menuGroup: 'record.upsert',
  menu: 'record.upsert',
  priceList: 'record.upsert',
  kitchenOrder: 'record.upsert',
  approval: 'record.upsert',
};

/** Which collection a record.upsert lands in, by queue kind. */
const COLL_OF: Record<string, string> = {
  product: 'products', party: 'parties', estimate: 'estimates', ledger: 'coa', firm: 'firm',
  challan: 'challans', purchaseOrder: 'purchaseOrders', recurring: 'recurringInvoices', plan: 'instalmentPlans',
  user: 'users', role: 'roles', ticket: 'tickets', modifierGroup: 'modifierGroups', menuGroup: 'menuGroups', menu: 'menus', priceList: 'priceLists', kitchenOrder: 'kitchenOrders', approval: 'approvals',
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
    case 'estimate': return (d.estimates || []).find((x) => x.id === ref);
    case 'ledger': return (d.coa || []).find((x) => x.id === ref);
    case 'challan': return (d.challans || []).find((x) => x.id === ref);
    case 'purchaseOrder': return (d.purchaseOrders || []).find((x) => x.id === ref);
    case 'recurring': return (d.recurringInvoices || []).find((x) => x.id === ref);
    case 'plan': return (d.instalmentPlans || []).find((x) => x.id === ref);
    // staff and what their roles allow, so a change made by the owner reaches every phone
    case 'user': return (d.users || []).find((x) => x.id === ref);
    case 'role': return (d.roles || []).find((x) => x.id === ref);
    // restaurant: open tickets are shared, so any waiter can pick one up
    case 'ticket': return (d.tickets || []).find((x) => x.id === ref);
    case 'modifierGroup': return (d.modifierGroups || []).find((x) => x.id === ref);
    case 'menuGroup': return (d.menuGroups || []).find((x) => x.id === ref);
    case 'menu': return (d.menus || []).find((x) => x.id === ref);
    case 'priceList': return (d.priceLists || []).find((x) => x.id === ref);
    case 'kitchenOrder': return (d.kitchenOrders || []).find((x) => x.id === ref);
    case 'approval': return (d.approvals || []).find((x) => x.id === ref);
    // the business's own details: name, phones, address, logo, signature…
    case 'firm': return d.firm?.id === ref ? d.firm : undefined;
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
      ? { coll: COLL_OF[q.kind] || 'parties', recId: q.ref, doc: rec }
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

/* ---------------------------------------------------------------- */
/* Transfers to and from another business (server/src/transfers.core.js) */
/* ---------------------------------------------------------------- */

export interface RemoteTransferLine { name: string; item_code: string; unit: string; quantity: number; unit_cost: number; sale_price: number; batch_no: string; expiry_date: string | null }
export interface RemoteTransfer {
  id: number; transfer_no: string; from_business: string; to_business: string; ref: string;
  status: 'in_transit' | 'receiving' | 'cancelling' | 'editing' | 'received' | 'short' | 'reconciled' | 'cancelled';
  lines: RemoteTransferLine[]; value: number; note: string | null; vehicle: string | null;
  sent_by: string | null; sent_at: string; seen_at: string | null; seen_by: string | null;
  received_at: string | null; received_by: string | null; received_lines: Array<{ name: string; sent: number; received: number; note?: string }> | null;
  short_value: number; events: Array<{ at: string; what: string; by: string; branch: string; note: string }>;
  from_name: string; to_name: string; direction: 'in' | 'out';
}
const tq = (business: string) => '?business=' + encodeURIComponent(business);
export const transfersApi = {
  list: (access: string, business: string) => call<{ transfers: RemoteTransfer[] }>('/v1/transfers' + tq(business), access, undefined, 'GET'),
  destinations: (access: string, business: string) => call<{ businesses: Array<{ id: string; name: string }> }>('/v1/transfers/destinations' + tq(business), access, undefined, 'GET'),
  incoming: (access: string, business: string) => call<{ count: number; unseen: number }>('/v1/transfers/incoming' + tq(business), access, undefined, 'GET'),
  open: (access: string, business: string, id: number, by: string) => call<{ transfer: RemoteTransfer }>('/v1/transfers/' + id + tq(business) + '&by=' + encodeURIComponent(by), access, undefined, 'GET'),
  send: (access: string, body: { business: string; to_business: string; ref: string; lines: RemoteTransferLine[]; value: number; note?: string; vehicle?: string; by?: string }) =>
    call<{ transfer: RemoteTransfer }>('/v1/transfers', access, body),
  step: (access: string, business: string, id: number, step: 'claim' | 'finish' | 'release' | 'reconcile' | 'note', body: Record<string, unknown> = {}) =>
    call<{ transfer: RemoteTransfer }>('/v1/transfers/' + id + '/' + step, access, { business, ...body }),
};
