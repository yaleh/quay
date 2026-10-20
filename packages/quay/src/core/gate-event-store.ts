// GateEvent store — append-only JSONL log + query API.
//
// Ported from epicd `src/core/gate-event-store.ts` (QENG-1). quay's lighter,
// provider-based JS keeps the same minimal API (CLAUDE.md simplicity-first):
//   - appendGateEvent  — append-only write; there is no update/delete.
//   - queryGateEvents  — read + filter + paginate.
//
// Storage: JSONL, one GateEvent per line, written with `appendFileSync` — the
// same primitive quay-native `store.js` already uses for task writes. Path is
// injected by the caller (engine / gate-log resolver), so this module has no
// side effect except the file I/O against the given `logPath` — which keeps the
// coverage run driving real I/O against a tmp path (proposal §Risks).
//
// `payload` is opaque end to end (epicd ADR-011 boundary): this module never
// inspects, matches, or special-cases any field name inside it.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export interface GateEvent {
  /** uuid/random per run */
  id: string;
  /** task id */
  item_id: string;
  /** task id (single-pipeline v0) — filter key */
  pipeline_id: string;
  /** gate name, e.g. "dod" */
  gate: string;
  /** who ran it (default "quay-cli") */
  actor: string;
  /** "pass" | "fail" */
  verdict: string;
  /** ISO 8601 */
  timestamp: string;
  /** opaque: { reason, ... }; engine never matches on it */
  payload: unknown;
}

export interface GateEventFilter {
  pipeline_id?: string;
  gate?: string;
  actor?: string;
  /** inclusive lower bound on `timestamp` (ISO 8601 string compare) */
  since?: string;
  /** inclusive upper bound on `timestamp` (ISO 8601 string compare) */
  until?: string;
  /** max events to return, applied after `offset` */
  limit?: number;
  /** number of matching events to skip, in log order */
  offset?: number;
}

/**
 * Append `event` to the log at `logPath`. Append-only: there is no exported
 * update/delete/rewrite. A repeated call (even with a reused `id`) only ever
 * adds a new line — it can never alter or remove a previously written line.
 * Parent directories are created as needed.
 *
 * **Single-writer constraint (M161):** this function uses `appendFileSync`
 * without advisory file locking or an atomic-write guard. Concurrent writes to
 * the same `logPath` from separate processes (e.g. parallel `quay gate`
 * invocations, or concurrent HTTP handlers in `quay serve`) can interleave
 * output lines, producing corrupted JSONL. The current callers (gate engine,
 * gate-log resolver) are all single-writer by construction — there is no
 * multi-process write path to the same `.quay/gate-events.jsonl` in normal
 * operation — so this is a documented constraint, not a live bug.
 *
 * If concurrent writes ever become a real risk, the proven advisory-lock
 * pattern from the native task store (`packages/quay-native/src/store.ts`,
 * `acquireLock`/`releaseLock`/`withLock`, lines 191-238) can be ported here:
 * `acquireLock` uses `fs.openSync(lockPath, "wx")` (exclusive-create) as the
 * atomic primitive, with stale-lock reclamation after 5s and a configurable
 * retry timeout. The gate-event-store's `appendGateEvent` is a simpler
 * operation (no read-modify-write), so a single `acquireLock`/`releaseLock`
 * pair around the `appendFileSync` call would suffice.
 */
export function appendGateEvent(logPath: string, event: GateEvent): void {
  const dir = dirname(logPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  appendFileSync(logPath, JSON.stringify(event) + "\n");
}

/**
 * Read + filter + paginate events from the log at `logPath`. A missing file
 * yields `[]`. Filters are AND-combined. Pagination (`offset`/`limit`) applies
 * after filtering, in on-disk (append) order.
 */
export function queryGateEvents(logPath: string, filter: GateEventFilter = {}): GateEvent[] {
  if (!existsSync(logPath)) return [];
  const events: GateEvent[] = readFileSync(logPath, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));

  const filtered = events.filter((event) => {
    if (filter.pipeline_id !== undefined && event.pipeline_id !== filter.pipeline_id) return false;
    if (filter.gate !== undefined && event.gate !== filter.gate) return false;
    if (filter.actor !== undefined && event.actor !== filter.actor) return false;
    if (filter.since !== undefined && event.timestamp < filter.since) return false;
    if (filter.until !== undefined && event.timestamp > filter.until) return false;
    return true;
  });

  const offset = filter.offset ?? 0;
  const page = filtered.slice(offset);
  return filter.limit !== undefined ? page.slice(0, filter.limit) : page;
}
