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

/**
 * @typedef {Object} GateEvent
 * @property {string} id          uuid/random per run
 * @property {string} item_id     task id
 * @property {string} pipeline_id task id (single-pipeline v0) — filter key
 * @property {string} gate        gate name, e.g. "dod"
 * @property {string} actor       who ran it (default "quay-cli")
 * @property {string} verdict     "pass" | "fail"
 * @property {string} timestamp   ISO 8601
 * @property {unknown} payload    opaque: { reason, ... }; engine never matches on it
 */

/**
 * @typedef {Object} GateEventFilter
 * @property {string=} pipeline_id
 * @property {string=} gate
 * @property {string=} actor
 * @property {string=} since  inclusive lower bound on `timestamp` (ISO 8601 string compare)
 * @property {string=} until  inclusive upper bound on `timestamp` (ISO 8601 string compare)
 * @property {number=} limit  max events to return, applied after `offset`
 * @property {number=} offset number of matching events to skip, in log order
 */

/**
 * Append `event` to the log at `logPath`. Append-only: there is no exported
 * update/delete/rewrite. A repeated call (even with a reused `id`) only ever
 * adds a new line — it can never alter or remove a previously written line.
 * Parent directories are created as needed.
 *
 * @param {string} logPath
 * @param {GateEvent} event
 */
export function appendGateEvent(logPath, event) {
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
 *
 * @param {string} logPath
 * @param {GateEventFilter} [filter]
 * @returns {GateEvent[]}
 */
export function queryGateEvents(logPath, filter = {}) {
  if (!existsSync(logPath)) return [];
  const events = readFileSync(logPath, "utf8")
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
