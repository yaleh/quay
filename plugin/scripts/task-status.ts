// task-status.ts — the plugin tree's SELF-CONTAINED copy of the task-status lifecycle
// vocabulary (gap-abi-status-lifecycle-vocab-scattered-no-named-type). The PRODUCT type's
// canonical source is packages/quay/src/abi.ts (`Task['status']`); the plugin is a
// separately-bundled deliverable (build-plugin-dist.mjs stages plugin/ → packages/quay/
// plugin/), so a static `../../packages/quay/src/abi.ts` import cannot resolve in the
// shipped artifact (sync-vendor.sh's documented rationale: paths reaching outside plugin/
// do not survive install scopes). This module is the plugin tree's single source — keep
// the five words in lockstep with abi.ts's TASK_STATUSES.
export type TaskStatus = 'todo' | 'ready' | 'done' | 'needs-human' | 'superseded';

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
