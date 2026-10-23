// FIXTURE — the TRUE-POSITIVE sample of the unencapsulated-state concern (task
// gap-unencapsulated-state-clue-judge-e2e, GOAL-911 AC-924).
//
// PROVENANCE: this is the HISTORICAL shape of the serve-dashboard snapshot cluster, before it was
// collected into `DashboardSnapshotStore`. The measured inventory of that cluster (several module-level
// Maps + one `let` hook + a clear/rebuild lifecycle living beside them) is recorded in
// tasks/gap-dashboard-snapshot-store-encapsulate-state.md. The live code no longer looks like this —
// the store class replaced it — so this file is a VENDORED copy of the shape, not a live excerpt.
// That is exactly why it is a fixture: the clue reader must still fire on the shape, and the judge
// must still confirm it, even after the one production instance was encapsulated away.
//
// ⛔ Do not "fix" this file: its state is the thing under test. It is never imported by production code.

export interface SnapshotRow {
  readonly sessionId: string;
  readonly ts: number;
  readonly payload: string;
}

/** Per-session snapshot ring — module-level mutable state #1. */
export const snapshots = new Map<string, SnapshotRow>();

/** Per-session event buffer — module-level mutable state #2. */
const eventLog = new Map<string, string[]>();

/** Per-session subscriber list — module-level mutable state #3. */
let subscribers = new Map<string, Set<(row: SnapshotRow) => void>>();

/** The "when did we last rebuild" hook — module-level mutable state #4 (a bare `let`). */
let lastRebuildAt: number | null = null;

/** And the rebuild counter beside it — module-level mutable state #5. */
let rebuildCount = 0;

export function recordSnapshot(row: SnapshotRow): void {
  snapshots.set(row.sessionId, row);
  const log = eventLog.get(row.sessionId) ?? [];
  log.push(row.payload);
  eventLog.set(row.sessionId, log);
}

export function subscribe(sessionId: string, fn: (row: SnapshotRow) => void): void {
  const set = subscribers.get(sessionId) ?? new Set();
  set.add(fn);
  subscribers.set(sessionId, set);
}

/** The lifecycle pair that makes the cluster "unencapsulated": clear + rebuild mutate the SAME
 *  module-level collections from outside any owning object. */
export function clearSession(sessionId: string): void {
  snapshots.delete(sessionId);
  eventLog.delete(sessionId);
  subscribers.delete(sessionId);
}

export function rebuild(rows: SnapshotRow[]): void {
  snapshots.clear();
  eventLog.clear();
  subscribers = new Map();
  for (const row of rows) recordSnapshot(row);
  lastRebuildAt = Date.now();
  rebuildCount += 1;
}

export function rebuildStats(): { at: number | null; count: number } {
  return { at: lastRebuildAt, count: rebuildCount };
}
