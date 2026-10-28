// ancestry.ts — the ONE definition in Core of "is <ancestor> reachable from <descendant>"
// (`git merge-base --is-ancestor`).
//
// gap-routine-semantic-dedup-scan-is-ancestor-three-semantics (routine `semantic-dedup-scan`,
// runId `semantic-dedup-scan-1793162251891`, finding `is-ancestor-three-semantics`): the same
// git question lived in Core three times with three DIFFERENT value sets —
//   core/branch-model.ts  already tri-state (true / false / null)
//   goal-merge.ts         `status === 0`, folding EVERY git failure to false (fail-OPEN for its
//                         `already-merged` check, which only survives because the callers check
//                         the branch exists first)
//   observation.ts        a 10s-timeout `try/catch` folding every failure to false
// The plugin layer had already consolidated onto exactly this tri-state shape
// (plugin/scripts/git-runner.ts `ancestry`). Core cannot import that module (plugin/scripts is
// not part of the `packages/quay` module graph, and the plugin is vendored separately), so the
// shared home has to be a Core-layer LEAF — this module — with each caller keeping its own fold,
// the same disposition ../observation/model.ts and ../pad.ts took.
//
// THREE states, not two: `true` = git ANSWERED yes (exit 0), `false` = git ANSWERED no (exit 1
// — a measured negative), `null` = git could not be ASKED (unknown object, not a repository,
// the process never ran, or the timeout killed it). Folding "could not look" into a value prints
// an instrument failure in the same shape as a real answer (hard rule 3b), so that fold stays at
// the CALL SITES — where the caller knows which direction is conservative. ⛔ Do not push any
// caller's fold down into this module.

import { spawnSync } from "node:child_process";

/**
 * Is `ancestor` an ancestor of (or equal to) `descendant`?
 *
 * `timeoutMs` is the caller's own liveness policy, not part of the predicate — it is forwarded
 * verbatim so a caller that had a timeout keeps exactly that timeout (a timeout is a NOT-ASKED
 * outcome ⇒ `null`, never `false`).
 */
export function ancestry(
  root: string,
  ancestor: string,
  descendant: string,
  { timeoutMs }: { timeoutMs?: number } = {},
): boolean | null {
  const r = spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", ancestor, descendant], {
    stdio: "ignore",
    ...(timeoutMs == null ? {} : { timeout: timeoutMs }),
  });
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  return null; // process never ran, or killed (timeout) — the question was never ANSWERED
}
