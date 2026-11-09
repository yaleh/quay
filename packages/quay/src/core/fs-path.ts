// fs-path.ts — THE one "give me this path with its symlinks resolved" implementation.
//
// WHY this is a leaf of its own (tasks/gap-routine-semantic-dedup-scan-normalize-path-triple):
// a `try { fs.realpathSync(p) } catch { path.resolve(p) }` helper was written out three times —
// `plugin/scripts/archguard-runner.ts` (`normalizeFsPath`),
// `plugin/scripts/resolve-quay-cli.ts` (`normalisePath`) and
// `packages/quay/src/core/loaded-version.ts` (`normalizeProjectPath`) — all three comparing a path
// Claude Code / archguard wrote against one this process derived. `realpathOrSelf` already existed
// here (in `goal-store-criterion-address.ts`), so the copies were copy-instead-of-call debt, not a
// missing abstraction. It now lives in this dependency-free leaf so BOTH surfaces can reach it:
//   · Core (`loaded-version.ts`) imports `./fs-path.ts`;
//   · the kernel (`plugin/scripts/*`) imports `../../packages/quay/src/core/fs-path.ts`
//     (plugin → packages is the recognised direction; the reverse is the `reverseEdges` ratchet).
// `goal-store-criterion-address.ts` re-exports it, so every historical importer keeps its path
// (hard rule 5b: one implementation, not a re-write).
//
// ⛔ It is deliberately NOT imported by `plugin/scripts/resolve-quay-cli.ts`: that file is the
// zero-dependency reference implementation of `docs/references/external-consumer-cli-location.md`
// and runs from a plugin cache directory that carries no `packages/` tree (see its own header).
// That one residual copy is a packaging constraint, not an oversight — recorded in the task's
// disposition.

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
