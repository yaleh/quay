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
