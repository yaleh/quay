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
//
// ── SCOPE WIDENED (gap-judgment-rewrites-route-through-proc-identity-leaf, 2026-09-20) ──────────
// The extraction above left ~6 real call sites in `plugin/scripts` + `packages/quay/src` still
// hand-rolling their own `/proc/<pid>/cmdline` read + NUL parse (detected by
// `plugin/scripts/identity-replication-check.ts`'s AC2 section). This file is now the single
// implementation of the READ as well, in two forms:
//   · `readProcCmdlineText` — NUL→space text (what the name-matching callers compare against);
//   · `readProcCmdline`     — the argv array.
// Both take an optional `procRoot` (the mechanism layer's fake-procDir test seam) and an optional
// `reader` (send-to-session's `readFile` test seam). ⛔ The failure value is per-call-site and was
// preserved verbatim in the migration: this leaf returns `null` for "the read failed", and callers
// whose own contract is `[]` / `"unknown"` map it themselves — folding the three into one value is
// exactly the 硬规则 3b failure the migration was required not to introduce.

import fs from "node:fs";
import path from "node:path";

/** The reader seam: the RAW text of a `…/cmdline` file, or null when the read itself failed.
 *  Default = `fs`. It exists so a caller that already owns a file-reading seam can delegate the
 *  parse without losing its unit-test injection point (send-to-session.ts's `readFile`); the seam
 *  never changes WHAT is read — only WHO performs the bytes-on-disk read. */
export type ProcCmdlineReader = (procPath: string) => string | null;

const defaultReader: ProcCmdlineReader = (p) => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
};

/** The one place the `…/cmdline` path is constructed. `procRoot` is the /proc override the
 *  mechanism layer's own tests inject (a fake procDir) — `path.join` normalises exactly as the call
 *  sites did before they were routed here. */
function procCmdlinePath(pid: number | string, procRoot: string): string {
  return path.join(procRoot, String(pid), "cmdline");
}

/** Read the raw text behind a pid's cmdline. Returns null when the read FAILED; a readable-but-empty
 *  cmdline yields `""`, which is a MEASUREMENT (a zombie / a process with no argv), NOT "could not
 *  tell" (硬规则 3). Callers that must tell those two apart read THIS form — worker-driver's
 *  `probePidLiveness` maps `""` → "exited" and null → "unknown". The path is joined with spaces
 *  (`/proc/<pid>/cmdline` is NUL-separated); trimming stays the caller's call. */
export function readProcCmdlineText(
  pid: number | string,
  procRoot = "/proc",
  reader: ProcCmdlineReader = defaultReader,
): string | null {
  const raw = readRaw(pid, procRoot, reader);
  return raw === null ? null : raw.replace(/\0/g, " ");
}

/** Full argv from /proc/<pid>/cmdline (NUL-separated, trailing empty field dropped). null when
 *  unreadable — which is NOT the same as "no arguments" (硬规则 3b): a caller that must recognise
 *  a specific invocation treats null as "could not tell", never as "does not match". */
export function readProcCmdline(
  pid: number | string,
  procRoot = "/proc",
  reader: ProcCmdlineReader = defaultReader,
): string[] | null {
  const raw = readRaw(pid, procRoot, reader);
  if (!raw) return null;
  const parts = raw.split("\0");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts.length > 0 ? parts : null;
}

/** The read itself, with the failure branch folded to ONE value (null) for the two forms above.
 *  A reader seam that throws is a read failure, not a crash — same as the try/catch each call site
 *  used to carry locally. */
function readRaw(pid: number | string, procRoot: string, reader: ProcCmdlineReader): string | null {
  try {
    return reader(procCmdlinePath(pid, procRoot));
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
