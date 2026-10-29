// quay Core: WHICH TREE a goal criterion runs on — the criterion ADDRESS derivation family.
//
// Extracted verbatim from `./goal-store.ts` (tasks/gap-routine-architecture-analysis-god-function-
// creatgoalstore). Every criterion-running entry point (the gate, I5 `checkAchievedFailing`, the
// frozen rotation) asks the same two questions — "where is this AC's cwd?" and "which tree was that
// verdict obtained on?" — and the answers must be ONE derivation (hard rule 5b). Re-exported from
// `core/goal-store.ts`, so every historical importer keeps its path.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { goalBranchRefExists } from "./branch-model.ts";
import { resolveWorktreeNamespace } from "./worktree-namespace.ts";
import { isGoalId } from "./goal-store-types.ts";

// ── WHICH TREE a goal verdict was obtained on (SPEC-goal-branch-2026-10-03 §7 辛 / §9.2-2, 硬规则 4c) ─
// §7 辛 ("至少 1 个 live-probe AC 的 pass GateEvent 早于其 goal 的并入提交，且该次求值的 cwd 是预览
// worktree，不是主检出") is unjudgeable while a goal GateEvent names no cwd: measured 2026-10-03, the
// `AC-272` event carried only `id/item_id/gate/actor/verdict/timestamp/payload.reason` — the "which
// tree" reading does not survive the carrier (硬规则 4c). EVERY writer of a `gate:"goal"` event now
// records this fragment; ⛔ without a value in the CARRIER, the reading is only assumed.

/** `git rev-parse HEAD^{tree}` at `cwd`, or null when it cannot be read (not a git work tree, or no
 *  HEAD yet). ⛔ null is a VALUE meaning "the tree could not be read" — never an omitted field
 *  (硬规则 3/3b: an absent `treeSha` would be indistinguishable from a pre-change event). */
export function gitTreeSha(cwd: string): string | null {
  const r = spawnSync("git", ["-C", cwd, "rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (r.status !== 0 || typeof r.stdout !== "string") return null;
  const sha = r.stdout.trim();
  return sha === "" ? null : sha;
}

/** The payload fragment naming WHERE a goal criterion was evaluated — the quantity §7 辛 reads to
 *  tell a preview-worktree pass from a main-checkout one. `evaluationRoot` is the criterion cwd's
 *  **realpath**: ⛔ the unresolved path is not recorded, because this host's `/home/yale` is a symlink
 *  to `/data/home/yale` and an unresolved reading would make the preview worktree and the main
 *  checkout indistinguishable by string comparison. `treeSha` is the tree at that root (null when
 *  unreadable). */
export function evaluationContext(root: string): { evaluationRoot: string; treeSha: string | null } {
  let evaluationRoot = root;
  try {
    evaluationRoot = fs.realpathSync(root);
  } catch {
    // A missing/unresolvable root keeps the given path; `treeSha: null` still marks it unreadable
    // rather than dropping the field (硬规则 3/3b — "could not read" must have its own value).
  }
  return { evaluationRoot, treeSha: gitTreeSha(evaluationRoot) };
}

/** `fs.realpathSync`, but NEVER throws and resolves a path that does not exist yet.
 *
 *  When `p` (or a suffix of it) is absent, resolve the symlinks of the **longest existing ancestor**
 *  and re-append the remaining segments — so a normal `<namespace>/goal-<id>` worktree dir resolves
 *  to the SAME string git will record for it. This is the fix for
 *  `gap-goal-criterion-worktree-registered-check-blind-to-symlinked-root`: `git worktree add` records
 *  the **realpath** (`/data/home/yale/...`) while `goalCriterionWorktreeDir` derives the **alias**
 *  (`/home/yale/...`, a symlink to it), so a `path.resolve` comparison never matched, the registered
 *  worktree was re-`add`ed each round and failed (`already exists`) — the criterion tree froze on its
 *  first tip. Both sides of that comparison now go through here.
 *
 *  ⛔ Never throws (hard rule 3b): an unresolvable path falls back to its `path.resolve` form, so
 *  "could not resolve" is never conflated with "resolved to a different place". */
export function realpathOrSelf(p: string): string {
  const resolved = path.resolve(p);
  try {
    return fs.realpathSync(resolved);
  } catch {
    // ENOENT/EACCES on the leaf — walk up to the nearest existing ancestor below.
  }
  let head = resolved;
  const tail: string[] = [];
  for (;;) {
    const parent = path.dirname(head);
    if (parent === head) return resolved; // hit the filesystem root without resolving anything
    tail.unshift(path.basename(head));
    head = parent;
    try {
      return path.join(fs.realpathSync(head), ...tail);
    } catch {
      // this ancestor is absent too — keep walking up
    }
  }
}

// ── WHICH TREE a BRANCH-MODE goal's criteria run on (SPEC-goal-branch-2026-10-03 §5 B1, ruling ⑩) ─
//
// THE DEFECT (B1): a criterion's cwd was unconditionally the MAIN checkout's git root. The main
// checkout follows `develop`, while a branch-mode goal's code lives only on `goal/<id>` until it is
// merged. A pre-merge AC whose criterion reads a goal-branch file therefore could never pass ⇒ the
// goal could never reach `achieved` ⇒ §4.7's merge never triggers ⇒ **deadlock, not delay**. The I5
// sweep (checkAchievedFailing) had the same cwd, so it re-ran ALREADY-ACHIEVED criteria on the main
// checkout, reported them all as achieved-but-failing, and filed a batch of phantom gaps.
//
// THE FIX: one DETACHED criterion worktree per branch-mode goal (`goal-driver` owns its lifecycle —
// create / refresh / delete, ruling ㉒), and the criterion cwd is chosen per AC from the AC's GOAL:
// branch-mode ∧ `goal/<id>` still exists ⇒ the worktree; anything else ⇒ the main root (which is
// also what a MERGED goal falls back to, §4.2: branch gone ⇒ back to the main checkout).
// ⛔ The worktree is DETACHED, never a checkout of `goal/<id>` itself — a branch checked out in a
// second worktree cannot be pushed to (`git push . <sha>:refs/heads/goal/<id>` is refused for the
// checked-out branch), which would break the goal branch's own fast-forward.
// ⛔ The path is DERIVED from the config-resolved worktree namespace (`loop.worktree_root`), never
// from a hardcoded `quay-worktrees` segment (worktree-namespace.ts is the ONE resolution).

/** Directory-name prefix of a goal's criterion worktree inside the worktree namespace:
 *  `<namespace>/goal-<GOAL-NNN>`. Sibling of the task worktrees, in the SAME resolved namespace. */
export const GOAL_CRITERION_WORKTREE_PREFIX = "goal-";

/** The criterion worktree path for `goalId` — derived, ⛔ never stored (hard rule 4b: the branch name
 *  and its worktree are both functions of the goal id + the workspace's worktree namespace). */
export function goalCriterionWorktreeDir(root: string, goalId: string): string {
  return path.join(resolveWorktreeNamespace(root).dir, `${GOAL_CRITERION_WORKTREE_PREFIX}${goalId}`);
}

/** Where an AC's criterion ran: `goal-worktree` (branch-mode goal, branch still present) or `main`
 *  (everything else — incl. a branch-mode goal whose branch is already merged/discarded). */
export type CriterionRootSource = "main" | "goal-worktree";

export interface CriterionRoot {
  cwd: string;
  source: CriterionRootSource;
}

/** Resolve ONE goal's criterion root. `mainRoot` is the main checkout's git root (⛔ the caller
 *  already resolved it robustly; this never re-derives it with `path.dirname`). */
export function resolveCriterionRoot(
  mainRoot: string,
  goal: { id?: unknown; branch?: unknown } | null | undefined,
): CriterionRoot {
  const id = typeof goal?.id === "string" ? goal.id : "";
  if (goal?.branch !== true || !isGoalId(id)) return { cwd: mainRoot, source: "main" };
  // Branch gone (merged per §4.7, or discarded per §4.2) ⇒ the goal's code is on the main checkout
  // again. ⛔ Derived from git, never from a stored flag: after an external `git branch -D` the
  // stored bit would still say `true` while the reading must already be the main root.
  if (!goalBranchRefExists(mainRoot, id)) return { cwd: mainRoot, source: "main" };
  return { cwd: goalCriterionWorktreeDir(mainRoot, id), source: "goal-worktree" };
}

/** Per-GOAL resolution map for a whole listing — one `git` probe per GOAL, not one per AC (the sweep
 *  and I5 walk every achieved AC, and a per-AC probe would spawn a process per record). */
export function buildCriterionRoots(
  mainRoot: string,
  goals: Array<Record<string, unknown>>,
): Map<string, CriterionRoot> {
  const byGoal = new Map<string, CriterionRoot>();
  for (const g of goals) {
    const id = String(g.id ?? "");
    if (!isGoalId(id)) continue;
    byGoal.set(id, resolveCriterionRoot(mainRoot, g as { id?: unknown; branch?: unknown }));
  }
  return byGoal;
}

/** The criterion cwd for one AC row, given its goal's resolved root (absent goal id / unknown goal
 *  ⇒ the main root — the same tree today's behaviour used). */
export function criterionCwdFor(
  mainRoot: string,
  byGoal: Map<string, CriterionRoot>,
  ac: { goal?: unknown },
): string {
  const gid = typeof ac.goal === "string" ? ac.goal : "";
  return byGoal.get(gid)?.cwd ?? mainRoot;
}
