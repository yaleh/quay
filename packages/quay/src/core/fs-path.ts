// fs-path.ts — THE one "give me this path with its symlinks resolved" implementation.
//
// WHY this is a leaf of its own (tasks/gap-routine-semantic-dedup-scan-normalize-path-triple):
// a `try { fs.realpathSync(p) } catch { path.resolve(p) }` helper was written out three times —
// `plugin/scripts/archguard-runner.ts` (`normalizeFsPath`),
// `plugin/scripts/resolve-quay-cli.ts` (`normalisePath`) and
// `packages/quay/src/core/loaded-version.ts` (`normalizeProjectPath`) — all three comparing a path
// Claude Code / archguard wrote against one this process derived. `realpathOrSelf` already existed
// here (in `goal-store-criterion-address.ts`), so the copies were copy-instead-of-call debt, not a
// missing abstraction. It now lives in this dependency-free leaf so Core modules can import it
// without dragging in the goal-store closure; `goal-store-criterion-address.ts` re-exports it, so
// every historical importer keeps its path (hard rule 5b: one implementation, not a re-write).
//
// ⚠️ TWO PREDICATES ON PURPOSE — this one and `plugin/scripts/fs-path.ts#realpathOrResolve`:
//   · This one is the WIDER form (realpath; on ENOENT resolve the longest EXISTING ancestor and
//     re-append the remaining segments) — used where a not-yet-created goal/criterion worktree path
//     must compare equal to what git will record for it.
//   · The kernel leaf is the EXACT `realpath, else path.resolve` fallback the kernel tools always
//     used. It cannot live here-and-be-imported by the kernel alone: Core may not import the
//     plugin, resolve-quay-cli ships into a plugin cache with no `packages/` tree, and the shipped
//     kernel bundles only inline `packages/quay/src` at BUILD time. The two differ ONLY when the
//     path does not exist, where both are used for string comparison.
//   ⇒ `resolve-quay-cli.ts` and `loaded-version.ts` implement the SAME session-tier rule (the
//     catalog records that they must move together); both compare project paths, and on a
//     nonexistent projectPath neither spelling can match an existing `root`, so the wider form
//     here cannot flip a match either way.

import fs from "node:fs";
import path from "node:path";

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
