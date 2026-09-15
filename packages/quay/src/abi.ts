// Provider ABI view-model types (ADR-012 single-source ABI contract).
// All providers (native, github) and Core are type-checked against these
// interfaces via tsc --noEmit; runtime enforcement remains in
// provider-abi-conformance.test.mjs.

export interface Task {
  id: string;
  title: string;
  status: 'todo' | 'ready' | 'done' | 'needs-human' | 'superseded';
  role: 'primitive' | 'compound';
  labels: string[];
  parent: string | null;
  children: string[];
  body: string;
  extra: Record<string, unknown>;
  // goal_ac — owning goal AC id (task→AC linkage, G7). Top-level single scalar; null = unset
  // (缺值 = 未查, never conflated with a concrete AC id). gap-webui-goal-task-rollup-via-shared-
  // summary-cache: surfaced in the view-model so provider-agnostic read surfaces (the web UI's
  // /goal rollup) can consume the structured relationship through taskList — previously goal_ac
  // was WRITE-only through the ABI (task_write accepted it, task_list never returned it).
  goal_ac?: string | null;
}

// ── Task-status lifecycle vocabulary: the SINGLE source (gap-abi-status-lifecycle-
//    vocab-scattered-no-named-type). The lifecycle words were scattered as raw string
//    literals across ~30 files; consumers now import `TaskStatus` / `TASK_STATUS` /
//    `TASK_STATUSES` / `isTaskStatus` here instead of hardcoding `"done"` etc., and
//    disk-read parse boundaries guard with `isTaskStatus` (fail-closed on illegal
//    values — hard rule 3b: an unreadable value must not look like a valid one).
export type TaskStatus = Task['status'];

/** All valid task-status values, in canonical order (todo → ready → done → terminal). */
export const TASK_STATUSES: readonly TaskStatus[] = ['todo', 'ready', 'done', 'needs-human', 'superseded'];

/** Named status constants so consumers never write a raw lifecycle literal. */
export const TASK_STATUS = {
  TODO: 'todo',
  READY: 'ready',
  DONE: 'done',
  NEEDS_HUMAN: 'needs-human',
  SUPERSEDED: 'superseded',
} as const;

const TASK_STATUS_SET: ReadonlySet<string> = new Set<string>(TASK_STATUSES);

/** Type guard: is `value` one of the five task-status lifecycle words? */
export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && TASK_STATUS_SET.has(value);
}

export interface AdrRecord {
  id: string;
  title: string;
  status: string;
  body: string;
}

// ── Goal view-model (SPEC-goal-mechanism-2026-09-06.md §5.2): the goal store is
//    PROVIDER-BACKED (storage lives in quay-native; Core keeps only this view-model
//    + the delegation shim). GoalRecord mirrors the native store's view-model shape —
//    the goal's criterion is the conjunction of its ACs, so a GOAL record carries no
//    `criterion` (only AC records do); `goal` is the owning GOAL id on AC records.
export interface GoalRecord {
  id: string;
  title: string;
  status: string;
  kind: string;
  goal?: string;
  criterion?: string;
  expect?: string;
  origin?: string;
  evidence?: { at?: string; verdict?: string; reading?: string };
  supersedes: string[];
  supersededBy: string[];
  body: string;
  updatedAt?: number;
  /** Derived by the PROVIDER (never stored): whether this GOAL's own `status` field may no longer
   *  reflect its children, because a criterion was filed under it while it read `achieved`
   *  (gap-goal-status-stale-achieved-after-new-active-criterion-filed). Declared here because it is
   *  now part of what a provider must be able to REPORT — a GOAL row that could only say `achieved`
   *  made "genuinely closed" and "closed, then re-opened by a new child" the same token, which is
   *  the defect the field exists to remove (hard rule 3b). `state` is three-valued: `clean` /
   *  `stale` / `not-evaluated` — ⛔ an unreadable carrier must never read as `clean`. */
  staleness?: {
    state: "clean" | "stale" | "not-evaluated";
    signals: Array<{
      goalId: string;
      staleSince: string;
      triggeringAcId: string;
      goalStatusAtTime: string;
    }>;
    reason?: string;
  };
}

/** All valid goal-status values (draft → active → achieved / superseded / retired, plus the human
 *  channel `needs-human`). ⛔ `needs-human` is a REAL goal status, not a task-only one: the store
 *  accepts it and it is the most-frequent reopen source (goal-store's transition table records
 *  `needs-human→active` as 3 of 5 observed reopen paths — a human re-arms a record after a ruling).
 *  It was missing here until 2026-09-13, i.e. the ABI **under-declared** the vocabulary: a consumer
 *  validating against this list would reject a status the store produces. This constant is the
 *  single source (ADR-036); goal-store's VALID_GOAL_STATUSES derives from it. */
export const GOAL_STATUSES: readonly string[] = ['draft', 'active', 'achieved', 'superseded', 'retired', 'needs-human'];

// ── Meta view-model (gap-meta-records-should-be-a-first-class-store-kind-not-a-task-label): the
//    meta store is PROVIDER-BACKED like the goal store — Core keeps only this view-model + the
//    delegation shim. A META record is a message SENT TO the meta-driver, whose answer (`reply`)
//    is embedded on the SAME record (proposed → answered lifecycle, never done/achieved/accepted).
export interface MetaRecord {
  id: string;
  title: string;
  status: string;
  handler: string;
  reply?: string | null;
  body: string;
  updatedAt?: number;
}

/** All valid meta-status values (proposed → answered). */
export const META_STATUSES: readonly string[] = ['proposed', 'answered'];

/** task_delete result (gap-abi-missing-commit-delete-dependson-primitives): the native provider's
 *  delete returns an honest, distinguishable shape — `ok:false` (not-found) is a normal result the
 *  Core surface maps to isError, never a silent no-op. */
export interface TaskDeleteResult {
  id: string;
  ok: boolean;
  reason: string;
  committed: boolean;
  propagated: boolean;
}

export interface Manifest {
  [key: string]: unknown;
}
