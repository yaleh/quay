// DIR-039 (A): generic provider-to-provider migration over the Provider ABI.
// The Core is written against the task view-model only (CLAUDE.md) — this
// module reads EVERY task from a source provider client via `taskList`/
// `taskGet` and writes it to a target provider client via `taskWrite`,
// knowing NOTHING about either provider's concrete backend. It is the same
// proof `quay-github` already gave the ABI (Core reads A, writes B): here
// Core reads A, writes B, where A and B are themselves interchangeable.
//
// SINGLE-SOURCE constraint (DIR-039 AC/DoD, ADR-004): this module is the
// ONE place that decides "how a task view-model becomes a `taskWrite` call".
// The Backlog.md importer (DIR-039-B, see backlog-importer.js) does NOT
// re-implement this decision — it emits the SAME task view-model shape this
// module already consumes and calls `migrateTasks()` (or the lower-level
// `writeOneTask()` this file also exports) so there is exactly one native-
// write call site for both import paths, not two parallel ones.

import type { ProviderClient } from "./provider-client.ts";
import type { Task } from "./abi.ts";

/**
 * Write one task view-model through the target provider's `taskWrite` ABI
 * call. This is the SINGLE native-write chokepoint both (A) generic
 * migration and (B) the Backlog.md importer funnel through — grep for
 * `writeOneTask` to confirm no second task-writing code path exists.
 *
 * @param target a connected provider client (provider-client.js's
 *   connectProvider() return shape: { taskWrite, ... })
 * @param task the source task view-model
 *   ({ id, title, status, labels, parent, children, body, extra? })
 * @returns the target provider's resulting task view-model
 */
export async function writeOneTask(target: Pick<ProviderClient, "taskWrite">, task: Task): Promise<Task> {
  const patch: Record<string, unknown> = {
    id: task.id,
    title: task.title,
    status: task.status,
    labels: task.labels ?? [],
    body: task.body ?? "",
  };
  // parent/children are relational fields some providers (e.g. quay-github)
  // implement via cross-issue body mutation with real referential
  // constraints (the referenced id must already exist as a real task in the
  // TARGET store) -- a naive pass-through during a bulk migrate would fail
  // or corrupt state whenever the source's parent/child ids don't already
  // exist as target ids (e.g. archguard's own numbering vs. the fresh
  // native store's). Out of scope for DIR-039's migrate/import proof (which
  // is about id/title/status/body fidelity, per its own AC) -- deliberately
  // NOT forwarded here so every provider's taskWrite receives only fields
  // every provider is known to support safely in a fresh-store bulk import.
  if (task.extra !== undefined) patch.extra = task.extra;
  return target.taskWrite(patch);
}

/**
 * Migrate every task from `source` to `target`, both already-connected
 * provider clients (the Provider ABI shape returned by connectProvider()).
 * Reads via `source.taskList()` (the ABI's data.read surface), writes via
 * `writeOneTask()` (the single native-write chokepoint) for every task
 * returned. Provider-agnostic: this function never branches on which
 * concrete provider `source`/`target` are.
 */
export async function migrateTasks({ source, target, onTask }: {
  source: Pick<ProviderClient, "taskList">;
  target: Pick<ProviderClient, "taskWrite">;
  onTask?: (task: Task) => void;
}): Promise<{ total: number; migrated: Task[]; errors: Array<{ id: string; error: string }> }> {
  const tasks = await source.taskList({});
  const migrated: Task[] = [];
  const errors: Array<{ id: string; error: string }> = [];
  for (const task of tasks) {
    try {
      const written = await writeOneTask(target, task);
      migrated.push(written);
      if (onTask) onTask(task);
    } catch (err) {
      errors.push({ id: task.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { total: tasks.length, migrated, errors };
}
