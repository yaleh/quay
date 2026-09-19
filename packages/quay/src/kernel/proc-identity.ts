// proc-identity.ts — the two /proc-based process-IDENTITY predicates, extracted as a kernel leaf.
// (tasks/gap-arch-reverse-edges-zero; extracted from plugin/scripts/worktree-process-reaper.ts)
//
// ── WHY THIS FILE EXISTS AT ALL (why not just import the reaper) ─────────────────════════════════
// `packages/quay/src/serve.ts` needs exactly these two predicates for its admission lock's pid-reuse
// guard (a recycled pid that is alive but is NOT a `quay serve` must be judged STALE, not "held").
// It used to import them from `plugin/scripts/worktree-process-reaper.ts` — a `packages/**` →
// `plugin/**` reverse edge. The reaper CANNOT simply be moved down instead: it imports
// `./gate-script-base.ts` (186 dependents) and `./suite-lock-slots.ts`, so relocating the whole file
// would drag the whole mechanism layer into the kernel and violate the kernel boundary rule
// outright. The two predicates below are the LEAF part of it — their bodies touch only `node:fs`
// (`readProcCmdline`) and `node:path` (`isQuayServe`) — so they are what gets extracted, and the
// reaper keeps every one of its own imports and re-exports these two from here.
//
// ── the reachability argument (both sides) ──────────────────────────────────────────────────────
//   · PRODUCT side: serve.ts imports this file in-package. Before, that import was a reverse edge
//     into the mechanism layer.
//   · MECHANISM side: `plugin/scripts/worktree-process-reaper.ts` imports and re-exports these, so
//     every existing consumer of `readProcCmdline` / `isQuayServe` (the reaper's own callers, the
//     reaper's tests, `serve.ts`'s former import site) keeps its import site. That is a FORWARD edge
//     (`plugin/` → `packages/`), the sanctioned direction.
// NOTE on the shipped artifact: `worktree-process-reaper.ts` is NOT in build-plugin-dist's derived
// entry set, so it has no `dist/*.js` form and ff-merge.ts:585-592 already documents it as
// "resolvable in the dev tree only … an unresolvable reaper is reported and skipped, never silently
// counted as reaped". This extraction does not change that status.
// Kernel boundary: no import outside `kernel/` except bare specifiers (node:*). Checked by
// `plugin/scripts/import-graph-check.ts`.

import fs from "node:fs";
import path from "node:path";

/** Full argv from /proc/<pid>/cmdline (NUL-separated, trailing empty field dropped). null when
 *  unreadable — which is NOT the same as "no arguments" (硬规则 3b): a caller that must recognise
 *  a specific invocation treats null as "could not tell", never as "does not match". */
export function readProcCmdline(pid: number): string[] | null {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
    if (!raw) return null;
    const parts = raw.split("\0");
    if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
    return parts.length > 0 ? parts : null;
  } catch {
    return null;
  }
}

/** Is this argv a `quay … serve` invocation? Needs the FULL cmdline (argv0 is only the node
 *  binary). Matches either source-execution entry (`bin/quay.ts`) or the version-probe shim
 *  (`bin/quay.js`), with `serve` among the arguments. A null cmdline ⇒ false, and every caller
 *  must treat "could not read argv" as its own state rather than folding it into this `false`. */
export function isQuayServe(cmdline: string[] | null | undefined): boolean {
  if (!cmdline || cmdline.length === 0) return false;
  const isEntry = cmdline.some((a) => {
    const b = path.basename(a);
    return b === "quay.ts" || b === "quay.js";
  });
  return isEntry && cmdline.includes("serve");
}
