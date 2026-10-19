/**
 * Which records a commit changed — so a save writes those and nothing else.
 *
 * Every change to the book goes through `commit(mut)` in AppDataContext. While
 * `mut` runs, it is handed the book wrapped in Proxies. Any write to a record
 * in a tracked collection (a field, a nested line, a push, a splice) marks
 * that record's id as changed. Outside a commit nothing is wrapped, so reports
 * and screens read plain objects at full speed.
 *
 * The rules that keep this honest:
 *  - Only plain objects and arrays are wrapped. Dates, Maps and the like are
 *    returned as they are.
 *  - Whatever is written into the book is unwrapped first, deeply, so a Proxy
 *    never ends up stored inside the book.
 *  - Anything the tracker cannot attribute to one record marks the whole
 *    collection, and the saver then reconciles it in full.
 */

export interface Changes {
  /** coll -> ids written or removed in place */
  ids: Map<string, Set<string>>;
  /** collections that were replaced, reordered or shrunk: reconcile in full */
  whole: Set<string>;
}

export const emptyChanges = (): Changes => ({ ids: new Map(), whole: new Set() });

export function mergeChanges(into: Changes, from: Changes): Changes {
  from.ids.forEach((set, coll) => {
    const t = into.ids.get(coll) || new Set<string>();
    set.forEach((id) => t.add(id));
    into.ids.set(coll, t);
  });
  from.whole.forEach((c) => into.whole.add(c));
  return into;
}

let active: Changes | null = null;
let colls: ReadonlySet<string> = new Set();
let proxyOf = new WeakMap<object, object>();
const targetOf = new WeakMap<object, object>();

const OBJ = Object.prototype;
const isPlain = (v: unknown): v is Record<string, unknown> | unknown[] => {
  if (v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return true;
  const p = Object.getPrototypeOf(v);
  return p === OBJ || p === null;
};
/** "12" is an array index; "length", "find" and symbols are not. Runs on every read, so no regex. */
const isIndex = (k: string | symbol): k is string => {
  if (typeof k !== 'string' || k.length === 0) return false;
  for (let i = 0; i < k.length; i++) { const x = k.charCodeAt(i); if (x < 48 || x > 57) return false; }
  return true;
};

/** The real object behind a Proxy — and, for plain values, a copy with no Proxies inside. */
export function unwrap<T>(v: T, depth = 0): T {
  if (!v || typeof v !== 'object') return v;
  const t = targetOf.get(v as unknown as object);
  if (t) return t as unknown as T;
  if (!isPlain(v) || depth > 40) return v;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const x = v[i];
      if (x && typeof x === 'object') { const u = unwrap(x, depth + 1); if (u !== x) v[i] = u; }
    }
  } else {
    for (const k of Object.keys(v)) {
      const x = (v as Record<string, unknown>)[k];
      if (x && typeof x === 'object') { const u = unwrap(x, depth + 1); if (u !== x) (v as Record<string, unknown>)[k] = u; }
    }
  }
  return v;
}

function mark(coll: string, id: unknown) {
  if (!active) return;
  if (typeof id !== 'string' || !id) { active.whole.add(coll); return; }
  const s = active.ids.get(coll) || new Set<string>();
  s.add(id);
  active.ids.set(coll, s);
}

/** A record (or anything nested inside one): writes mark the record. */
function wrapIn(obj: object, coll: string, id: unknown): object {
  const known = proxyOf.get(obj);
  if (known) return known;
  const p = new Proxy(obj, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      return active !== null && typeof v === 'object' && v !== null && isPlain(v) ? wrapIn(v as object, coll, id) : v;
    },
    set(t, k, v) {
      mark(coll, id);
      return Reflect.set(t, k, unwrap(v));
    },
    deleteProperty(t, k) {
      mark(coll, id);
      return Reflect.deleteProperty(t, k);
    },
    defineProperty(t, k, d) {
      mark(coll, id);
      return Reflect.defineProperty(t, k, d.value !== undefined ? { ...d, value: unwrap(d.value) } : d);
    },
  });
  proxyOf.set(obj, p);
  targetOf.set(p, obj);
  return p;
}

/** A tracked collection: pushes, overwrites, splices and shrinks are seen. */
function wrapColl(arr: unknown[], coll: string): object {
  const known = proxyOf.get(arr);
  if (known) return known;
  const p = new Proxy(arr, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (active !== null && typeof v === 'object' && v !== null && isIndex(k)) {
        return wrapIn(v as object, coll, (v as { id?: unknown }).id);
      }
      return v;
    },
    set(t, k, v) {
      if (k === 'length') {
        if (typeof v === 'number' && v < t.length) active?.whole.add(coll);
        return Reflect.set(t, k, v);
      }
      if (isIndex(k)) {
        const i = Number(k);
        const nv = unwrap(v) as { id?: unknown } | undefined;
        if (i < t.length) {
          /* An existing slot overwritten: either the same record replaced by a
             new copy (fine), or the array being shifted (splice/unshift/sort). */
          const old = t[i] as { id?: unknown } | undefined;
          if (!old || !nv || old.id !== nv.id) active?.whole.add(coll);
          else mark(coll, nv.id);
        } else if (nv) mark(coll, nv.id);
        return Reflect.set(t, k, nv);
      }
      active?.whole.add(coll);
      return Reflect.set(t, k, unwrap(v));
    },
    deleteProperty(t, k) {
      active?.whole.add(coll);
      return Reflect.deleteProperty(t, k);
    },
  });
  proxyOf.set(arr, p);
  targetOf.set(p, arr);
  return p;
}

/**
 * Runs `mut` on the book with tracking on, and returns what it changed.
 * Replacing a whole collection (`d.queue = d.queue.filter(…)`) marks it whole.
 */
export function tracked<D extends object>(book: D, collections: ReadonlySet<string>, mut: (d: D) => void, sink?: (c: Changes) => void): Changes {
  const outer = active;
  const ch = emptyChanges();
  active = ch;
  colls = collections;
  proxyOf = new WeakMap();
  const root = new Proxy(book, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (typeof k === 'string' && colls.has(k) && Array.isArray(v)) return wrapColl(v, k);
      return v;
    },
    set(t, k, v) {
      if (typeof k === 'string' && colls.has(k)) ch.whole.add(k);
      return Reflect.set(t, k, unwrap(v));
    },
    deleteProperty(t, k) {
      if (typeof k === 'string' && colls.has(k)) ch.whole.add(k);
      return Reflect.deleteProperty(t, k);
    },
  });
  targetOf.set(root, book);
  try {
    mut(root as D);
  } finally {
    active = outer;
    if (outer) mergeChanges(outer, ch);
    /* Even when mut throws part-way: what it already changed must still be saved. */
    if (sink) sink(ch);
  }
  return ch;
}
