# Persistence split plan

## Current constraint

The app stores the complete `DB` under `genius.pos.v1`. `scheduleSave()` already coalesces writes and guarantees that the newest queued book is written, but each settled write still JSON-serializes the complete book. Snapshot sync also sends a complete book copy.

This is acceptable for small shops and is the compatibility baseline. The split must not change the mutation API, offline behavior, accounting folds, or snapshot meaning.

## Target shape

Keep one logical book while storing independent physical partitions:

| Partition | Contents | Write pattern |
| --- | --- | --- |
| `core` | schema, firm, settings, roles, numbering, users, warehouses, accounts, sync metadata | infrequent, last-write-wins |
| `catalog` | products, parties, offers, units, categories | frequent edits, last-write-wins |
| `transactions/<period>` | sales, purchases, payments, entries, journal, credit notes, estimates, challans | append-heavy |
| `stock/<period>` | movements, stock takes, production runs | append-heavy |
| `operations` | shifts, audit log, revisions, queue | append-heavy with bounded cleanup |
| `archive/<period>` | closed financial-year transaction and stock partitions | immutable, lazy-loaded |

The application continues to expose one `DB` object through `AppDataContext`. Partitioning belongs behind `storage.ts`, so screens and business logic do not learn storage keys.

## Migration stages

### 0. Measure before moving

Add development-only timings and byte counts around `JSON.stringify`, `saveDB`, `loadDB`, and snapshot preparation. Record p50 and p95 by book size, plus the largest collections. Do not collect customer data in logs.

Proceed when a representative device shows either repeated save latency above 100 ms or the serialized book regularly exceeds 2 MB. These are planning thresholds, not product limits.

### 1. Add an envelope and manifest

Introduce a versioned manifest under `genius.pos.manifest.v1`:

```ts
interface StorageManifest {
  format: 1;
  dbVersion: 1;
  businessId?: string;
  partitions: Record<string, { key: string; bytes: number; updatedAt: string }>;
}
```

Write the manifest last. Each partition includes the existing `v` and a checksum. A missing or invalid manifest falls back to the current monolithic key.

### 2. Dual-write, then verify

Continue writing `genius.pos.v1` while writing the new partitions. After each write, reassemble the partitions and compare stable hashes of the normalized `DB` in development and tests. Keep dual-write for one release so rollback is simply deleting the manifest and using the old key.

The old key remains authoritative until verification has passed for a full release cycle.

### 3. Split append-heavy collections first

Move only `transactions`, `stock`, and `operations` first. Keep `core` and `catalog` together until the append partitions are stable. The save queue should mark dirty partitions so editing a product does not rewrite transaction history.

Do not store derived `Product.stock`, account balances, or report totals as independent truth. Rebuild those folds from movements and journal lines exactly as the current logic does.

### 4. Archive closed financial years

When `startFinancialYear()` closes a year, move its immutable transaction and stock partitions under `archive/<period>`. Keep opening balances and the archive manifest in `core`. Reports request an archive partition explicitly; normal POS screens load only the current period.

Archiving must be atomic from the app's point of view: write the archive, verify its checksum, update the manifest, then clear the current-period rows. A crash before the manifest update leaves the old data usable.

### 5. Change snapshot assembly, not the sync contract

`uploadSnapshot()` still sends a logical `DB` snapshot for compatibility. `storage.ts` assembles it only when requested. Later, add a server snapshot format with a manifest and partition payloads, but accept both formats during rollout.

Operations remain the durable multi-device path. A snapshot is a bootstrap and recovery copy, not the conflict-resolution mechanism.

## Invariants and failure handling

- A committed mutation is visible either in the old monolith or in every required new partition, never partially in one logical read.
- `flushSave()` waits for all partition writes before backgrounding or closing.
- The manifest is written last and is never used when its checksum or partition set is incomplete.
- Restore validates every partition before replacing live data.
- `businessId`, `activeFirmId`, `financialYear`, `sync.cursor`, and `sync.snapshotVersion` must survive migration unchanged.
- Queue entries are never discarded because a partition migration failed; retry is explicit and idempotent.
- A failed migration keeps the monolithic key and reports a recoverable warning.

## Testing gates

1. Round-trip every fixture through monolith -> partitions -> `DB` and compare normalized output.
2. Interrupt each write step and verify the previous complete state still loads.
3. Verify migration with old fixtures that lack newer optional fields.
4. Verify current-period reports ignore archives and archive reports include only the selected period.
5. Verify snapshot upload and restore produce the same logical `DB` and preserve sync version metadata.
6. Benchmark saves for small, medium, and large books on a low-end device profile.

## Rollback and rollout

Release 1: instrumentation only.

Release 2: dual-write and verification, monolith remains authoritative.

Release 3: partitioned reads behind a feature flag, with automatic fallback to the monolith on any validation error.

Release 4: partitioned writes become authoritative after telemetry shows no fallback for one release cycle. Keep the monolith as an export/rollback copy for at least two releases.

Never delete `genius.pos.v1` in the same release that first enables partitioned writes.
