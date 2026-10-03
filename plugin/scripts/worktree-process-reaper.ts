#!/usr/bin/env node
// @instrument "Which live processes are anchored under a worktree that is about to be removed (test-fixture claude-probe probes + hung suite/runner processes), and which orphaned probes / stale full-suite.lock holders survive with a cwd pointing at a deleted worktree (the worktree-removed-before-test-cleanup orphan family)?"
// plugin/scripts/worktree-process-reaper.ts — gap-worktree-remove-orphans-probes.
//
// Two failure shapes (same root: test/runner child processes nobody reaps):
//   1. `exec -a claude-probe sleep 10000` test fixtures (session-liveness/session-topology/
//      orphan-session-check families, 15+ files reuse them) are orphaned when fan-in runs
//      `git worktree remove` while the probe is still alive — the probe's cwd was the worktree,
//      and after removal it becomes "<worktree> (deleted)". Measured 133-136 live, 100% pointing
//      at deleted worktrees.
//   2. A hung suite/runner process (a detached `setsid bash scripts/test.sh` that never exited)
//      holds `<git-common-dir>/full-suite.lock.0/.1` open and blocks the next fan-in ff (the
//      同族扩展 on 2026-08-17). Its cwd is the deleted/live worktree.
//
// This reaper is the cleanup primitive for BOTH shapes:
//   --worktree <path>   Reap processes whose cwd is under <path> (the worktree being removed):
//                       test-fixture probes + hung runner leftovers. NEVER a real claude session
//                       (argv[0] basename exactly `claude` — AC2), NEVER the caller's own process
//                       tree (self + ancestors). Runs BEFORE `git worktree remove` so removal
//                       cannot orphan anything.
//   --orphans           Reap ALREADY-orphaned residue: (a) probe processes whose cwd ends with
//                       " (deleted)" AND argv[0] basename contains `claude-probe`; (b) stale
//                       full-suite.lock holders — processes holding a full-suite.lock* file open
//                       whose cwd ends with " (deleted)" (a suite whose worktree was removed
//                       without first stopping it). Both are safe-by-construction: a legitimately
//                       running suite has a LIVE cwd (never matched), a real claude session has
//                       argv[0] `claude` (never matched by (a) and excluded from (b)).
//   ⛔ The two modes cover MUTUALLY EXCLUSIVE residue classes, not a strong/weak relationship:
//      `--orphans` matches ONLY a " (deleted)" cwd suffix (a worktree already removed) — a
//      PPID=1 zombie whose cwd still points at a LIVE worktree is `--worktree` territory and is
//      NEVER matched by `--orphans`. Running `--orphans` therefore does NOT mean the live
//      worktrees were swept; `--worktree <path>` is the tool for that (and it in turn does not
//      touch deleted-cwd residue).
//
// Safety envelope (the 2026-08-08 two-layer-blind incident's rule, same invariant the
// session-liveness sweepers pin): a name-based batch kill of LIVE processes is forbidden. This
// reaper NEVER kills by process name — it kills by ORPHAN STATE: cwd under a worktree being
// removed, or cwd pointing at a DELETED directory (a deleted dir has no owner). A live observer
// (session-liveness monitor) has cwd = the live repo root, never a task worktree / deleted dir.
//
// Modes:
//   worktree-process-reaper.ts --worktree <path> [--root <repo>] [--list|--dry-run] [--json]
//   worktree-process-reaper.ts --orphans [--root <repo>] [--list|--dry-run] [--json]
//   worktree-process-reaper.ts --orphans --stale-lock-holders-only [--root <repo>] [--json]
//   worktree-process-reaper.ts --orphan-serves --root <repo> [--list|--dry-run] [--json]
//   worktree-process-reaper.ts --help
//
// --orphan-serves: reap leaked `quay … serve` WEB-UI HOSTS — a serve whose parent is dead
// (ppid === 1), which is under <root> OR under the workspace's worktree namespace, and which
// nothing vouches for. Each one holds
// 0.65–1.7 GB, so a few of them exhaust a 16 GB box (2026-09-17: three such leaks contributed to a
// global OOM whose victims were dbus-daemon/systemd/an unrelated chrome batch). The leak's ROOT
// CAUSE — the `bin/quay.js` shim blocking in `spawnSync`, so it could never forward the signal that
// killed it — is fixed in the shim itself; this mode is the defensive sweep for residue from any
// other source, and for hosts leaked before that fix.
//
//   ⛔ It refuses (exit 0, kills nothing, prints NOT-EVALUATED) whenever the registration is
//   absent, unreadable, or names a DEAD pid. That is not timidity: ANY `quay serve` overwrites
//   `.quay/server.json` on startup, so a transient host hijacks the registration — measured, the
//   orphan that prompted this work had left it pointing at its own dead pid. In that state a live
//   host and a leaked one are indistinguishable, and killing on a guess would take down the UI.
//
//   ⚠️ A `quay serve` started in the BACKGROUND has ppid === 1 whether it is a legitimate host of
//   some OTHER workspace root or a leak — the dead parent alone cannot separate them. The voucher
//   is the registration at the process's OWN root: when `<its cwd>/.quay/server.json` names that
//   very pid, it is the registered host of the workspace it runs in and is spared. This is what
//   makes a goal preview instance survivable — a serve whose workspace root is the preview
//   worktree, started detached (SPEC-goal-branch-2026-10-03 §4.10): the `--root` registration
//   cannot vouch for it (different root), so the old rule reaped it. Such processes are reported
//   under `recognizedServes` — never silently dropped (硬规则 3b: "evaluated and spared" must not
//   share an output with "never looked at").
//   ⛔ A MISSING or unreadable carrier, or one naming a DIFFERENT pid, vouches for nothing: the
//   process stays in the reap set. This is NOT "cwd != main root ⇒ let it go" (2026-09-17: a global
//   OOM whose victims were dbus-daemon/systemd came from exactly the un-vouched leaked hosts).
//
// --stale-lock-holders-only (with --orphans): reclaim ONLY stale full-suite.lock holders for the
// given --root (cwd deleted + holding one of <root>'s lock files open), skipping the global
// claude-probe orphan sweep. The probe sweep is global by design (orphaned probes live in DELETED
// worktrees which are siblings of the repo, never under it), so fan-in-ff-merge's stale-lock
// reclaim — whose PURPOSE is unblocking the ff from a held slot — must NOT run it: an unrelated
// concurrent test's live orphan probe would be killed mid-assertion (cross-test race, 2026-08-17).
// The global probe sweep stays on the standalone --orphans and full-suite-runner's pre-suite path,
// where nothing else depends on an orphan probe staying alive.
//
// Exit: 0 always (best-effort reaper — a reap failure must never fail a removal/ff); 2 = usage.
//
// Env seams (hermetic tests):
//   WORKTREE_PROCESS_REAPER_PS_SOURCE=<path> — read the process list from a file instead of /proc.
//       Each line: `<pid>\0<cwd>\0<argv0>\0<state>\0<ppid>\0<fd1>,<fd2>,...>` (NUL-separated;
//       cwd may carry a literal " (deleted)" suffix; fds is a comma-joined list of open file
//       paths, empty when none).

import fs from "node:fs";
import path from "node:path";
// The direct-entry guard below is bundle-safe and single-sourced (see its call site).
import { isDirectEntry } from "./gate-script-base.ts";
// gap-suite-concurrency-ff-gate-and-slot-ssot — the CANONICAL suite-slot implementation (single
// definition point). fullSuiteLockFiles() reads it so the stale-lock reclaim covers ALL S slots
// (S=3 ⇒ `.2` stale holders are reclaimable, never invisible to the fixed `.0`/`.1` list).
import { suiteLockSlotPaths, suiteLockBase } from "./suite-lock-slots.ts";
// The workspace's worktree namespace (loop.worktree_root from .quay/config.yml, falling back to the
// historical <parent-of-root>/quay-worktrees convention) — where this repo's goal-preview worktrees
// live (SPEC-goal-branch-2026-10-03 §4.10). Resolved through the SINGLE resolver the read side
// (observation.ts) and fast-mode-telemetry.ts already share: spelling the segment as a literal here
// would be exactly the drift `worktree-namespace-literal-check.ts` exists to catch.
import { resolveWorktreeNamespace } from "../../packages/quay/src/worktree-namespace.ts";
// The two process-IDENTITY predicates (`readProcCmdline` / `isQuayServe`, re-exported below for
// every existing caller) now live in the kernel leaf `packages/quay/src/kernel/proc-identity.ts`
// (tasks/gap-arch-reverse-edges-zero). They are the ONLY part of this file `packages/quay/src/
// serve.ts` needs, and serve.ts may not import this file: that would be a `packages/**` →
// `plugin/**` reverse edge. This file keeps every one of its OWN imports — which is exactly why the
// extraction was of the two leaf predicates rather than of the whole file: relocating the whole file
// would drag ./gate-script-base.ts (186 dependents) and ./suite-lock-slots.ts into the kernel and
// break the kernel boundary rule outright.
import { readProcCmdline, isQuayServe } from "../../packages/quay/src/kernel/proc-identity.ts";
export { readProcCmdline, isQuayServe };

export interface ProcInfo {
  pid: number;
  /** resolved cwd with any " (deleted)" suffix stripped; null when unreadable */
  cwd: string | null;
  /** true when readlink showed a " (deleted)" suffix (the workspace dir is gone) */
  cwdDeleted: boolean;
  /** first NUL field of cmdline (argv[0]); null when unreadable */
  argv0: string | null;
  /** process state char from /proc/<pid>/stat (Z = zombie); null when unreadable */
  state: string | null;
  /** parent pid from /proc/<pid>/stat; null when unreadable */
  ppid: number | null;
  /** resolved readlink targets of /proc/<pid>/fd/* (empty when unreadable/none) */
  openFiles: string[];
  /** the FULL argv (cmdline is NUL-separated; argv0 is its first field). Read only for orphan
   *  candidates (ppid === 1) and only needed by `--orphan-serves`: argv0 alone is just the node
   *  binary, so it cannot tell a `quay … serve` host from any other node process. null when the
   *  seam did not supply it. */
  cmdline?: string[] | null;
}

const DELETED_SUFFIX = " (deleted)";

/** Split a raw readlink cwd into { path, deleted }. The "(deleted)" suffix is how the kernel
 * reports a cwd whose directory was removed — the orphan shape. */
export function splitCwd(raw: string | null): { path: string | null; deleted: boolean } {
  if (raw === null) return { path: null, deleted: false };
  if (raw.endsWith(DELETED_SUFFIX)) {
    return { path: raw.slice(0, -DELETED_SUFFIX.length), deleted: true };
  }
  return { path: raw, deleted: false };
}

export function readProcCwd(pid: number): string | null {
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

export function readProcArgv0(pid: number): string | null {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
    if (!raw) return null;
    return raw.split("\0")[0] || null;
  } catch {
    return null;
  }
}

// `readProcCmdline` is imported from ../../packages/quay/src/kernel/proc-identity.ts and re-exported
// at the top of this file (see the import block) — its body lives there now, not here.

/** Read { state, ppid } from /proc/<pid>/stat (comm may contain spaces/parens — match the LAST
 * ')' then split the tail; after comm: state(3) ppid(4)). */
export function readProcStat(pid: number): { state: string | null; ppid: number | null } {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    if (close === -1) return { state: null, ppid: null };
    const tail = stat.slice(close + 1).trim().split(/\s+/);
    return { state: tail[0] ?? null, ppid: tail[1] ? Number(tail[1]) : null };
  } catch {
    return { state: null, ppid: null };
  }
}

/** The resolved readlink targets of /proc/<pid>/fd/* — used to detect full-suite.lock holders. */
export function readProcOpenFiles(pid: number): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(`/proc/${pid}/fd`);
  } catch {
    return out;
  }
  for (const e of entries) {
    try {
      const target = fs.readlinkSync(`/proc/${pid}/fd/${e}`);
      if (target) out.push(target);
    } catch {
      /* fd vanished mid-scan */
    }
  }
  return out;
}

/** argv[0] basename exactly `claude` = a REAL claude session (orphan-session-check.ts's exact
 * predicate). NEVER reaped by this tool (AC2 — normal claude sessions unaffected). `claude-probe`
 * fakes are NOT `claude` (the distinction the whole test-fixture family relies on). */
export function isRealClaude(argv0: string | null): boolean {
  if (!argv0) return false;
  return path.basename(argv0) === "claude";
}

/** argv[0] basename contains `claude-probe` = a test fixture probe (`exec -a claude-probe sleep
 * 10000` → argv[0]="claude-probe"). Safe to reap: it is a fixture by construction. */
export function isProbe(argv0: string | null): boolean {
  if (!argv0) return false;
  return path.basename(argv0).includes("claude-probe");
}

/** cwd is under/equal the given workspace path. Paths are resolved; a deleted cwd (raw had the
 * " (deleted)" suffix) matches against its stripped path so a half-removed worktree's probes are
 * still addressable. */
export function cwdUnder(cwd: string | null, workspace: string): boolean {
  if (!cwd) return false;
  const ws = path.resolve(workspace);
  const c = path.resolve(cwd);
  return c === ws || c.startsWith(ws + path.sep);
}

/** The caller's own pid + ancestor chain — the reaper must never kill the process tree that is
 * executing it (a fan-in subagent's bash has cwd = the worktree in the ff-merge phase; killing it
 * would kill the caller). */
export function selfAndAncestors(): Set<number> {
  const set = new Set<number>();
  let pid: number | null = process.pid;
  for (let i = 0; i < 64 && pid !== null && !set.has(pid); i++) {
    set.add(pid);
    pid = readProcStat(pid).ppid;
  }
  return set;
}

/** Enumerate process records from /proc (real mode). */
export function enumerateProcs(): ProcInfo[] {
  const out: ProcInfo[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync("/proc");
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    const pid = Number(e);
    const rawCwd = readProcCwd(pid);
    const { path: cwd, deleted } = splitCwd(rawCwd);
    const argv0 = readProcArgv0(pid);
    const { state, ppid } = readProcStat(pid);
    // fd table is expensive — only read it for processes whose cwd is deleted (the ONLY class
    // that can be a stale full-suite.lock holder; a live-cwd process is never matched by --orphans).
    let openFiles: string[] = [];
    if (deleted) {
      openFiles = readProcOpenFiles(pid);
    }
    // full argv is read only for orphan candidates (ppid === 1) — the ONLY class `--orphan-serves`
    // can match. Same cost discipline as the fd table above: the expensive per-class read happens
    // only where a predicate could consume it.
    const cmdline = ppid === 1 ? readProcCmdline(pid) : null;
    out.push({ pid, cwd, cwdDeleted: deleted, argv0, state, ppid, openFiles, cmdline });
  }
  return out;
}

/** Enumerate process records from a seam file (hermetic tests): one NUL-separated record per line,
 * `<pid>\0<cwd>\0<argv0>\0<state>\0<ppid>\0<fds>`. */
export function enumerateProcsFromSeam(file: string): ProcInfo[] {
  const content = fs.readFileSync(file, "utf8");
  const out: ProcInfo[] = [];
  for (const rawLine of content.split("\n")) {
    if (!rawLine) continue;
    const fields = rawLine.split("\0");
    const pid = Number(fields[0]);
    if (!Number.isFinite(pid)) continue;
    const { path: cwd, deleted } = splitCwd(fields[1] ?? null);
    const fds = (fields[5] ?? "").split(",").filter(Boolean);
    // Field 7 (optional, added for --orphan-serves) carries the full argv as a JSON array. A
    // pre-existing 6-field fixture yields null ⇒ "could not tell", never "does not match".
    let cmdline: string[] | null = null;
    const rawCmd = fields[6];
    if (rawCmd) {
      try {
        const parsed = JSON.parse(rawCmd);
        if (Array.isArray(parsed) && parsed.every((a) => typeof a === "string")) cmdline = parsed;
      } catch {
        cmdline = null;
      }
    }
    out.push({ pid, cwd, cwdDeleted: deleted, argv0: fields[2] ?? null, state: fields[3] ?? null, ppid: fields[4] ? Number(fields[4]) : null, openFiles: fds, cmdline });
  }
  return out;
}

/** Reap candidates for --worktree: cwd under the worktree, not a real claude session, not the
 * caller's own tree. Pure on the given process list (the predicate — testable via seam). */
export function classifyForWorktree(procs: ProcInfo[], worktree: string, exclude: Set<number>): ProcInfo[] {
  return procs.filter(
    (p) => !exclude.has(p.pid) && !isRealClaude(p.argv0) && cwdUnder(p.cwd, worktree),
  );
}

export interface OrphanClassification {
  /** probe processes: cwd deleted + claude-probe argv0 */
  probes: ProcInfo[];
  /** stale full-suite.lock holders: holding a lock file open + cwd deleted + not a real claude */
  staleLockHolders: ProcInfo[];
}

/** Reap candidates for --orphans: (a) orphan probes, (b) stale full-suite.lock holders. Pure —
 * testable via seam. A legitimately-running suite has a LIVE cwd ⇒ never matched. */
export function classifyOrphans(procs: ProcInfo[], lockFiles: string[], exclude: Set<number>): OrphanClassification {
  const probes: ProcInfo[] = [];
  const staleLockHolders: ProcInfo[] = [];
  for (const p of procs) {
    if (exclude.has(p.pid)) continue;
    if (p.cwdDeleted && isProbe(p.argv0)) {
      probes.push(p);
      continue;
    }
    if (p.cwdDeleted && !isRealClaude(p.argv0) && lockFiles.length > 0 && lockFiles.some((lf) => p.openFiles.includes(lf))) {
      staleLockHolders.push(p);
    }
  }
  return { probes, staleLockHolders };
}

// `isQuayServe` is imported from ../../packages/quay/src/kernel/proc-identity.ts and re-exported at
// the top of this file (see the import block) — its body lives there now, not here.

/** The `.quay/server.json` reading, THREE-VALUED on purpose (硬规则 3b).
 *
 *  This carrier is the only place that says which pid is the live Web-UI host. It is NOT a
 *  tamper-proof registry: ANY `quay serve` writes itself into it on startup, so a transient host
 *  spawned by a test or a criterion OVERWRITES the real host's entry. Measured 2026-09-17: an
 *  orphaned criterion-spawned host had hijacked it, leaving it pointing at a pid that no longer
 *  existed while the legitimate UI ran on unaffected.
 *
 *  ⇒ `present` alone is not enough information to reap on: the registration must also name a LIVE
 *  pid. `absent` / `unreadable` / `present-but-dead` are all "I cannot tell which host is the live
 *  one", and the caller must refuse rather than treat them as "nothing is registered". */
export interface ServeRegistration {
  state: "present" | "absent" | "unreadable";
  pid: number | null;
  /** whether `pid` names a live process; only meaningful when state === "present" */
  alive: boolean;
  detail?: string;
}

export function readServeRegistration(root: string): ServeRegistration {
  const file = path.join(root, ".quay", "server.json");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return { state: "absent", pid: null, alive: false, detail: "no .quay/server.json" };
    return { state: "unreadable", pid: null, alive: false, detail: e.message };
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return { state: "unreadable", pid: null, alive: false, detail: `not valid JSON: ${(err as Error).message}` };
  }
  const candidate = doc && typeof doc === "object" ? (doc as { pid?: unknown }).pid : undefined;
  if (typeof candidate !== "number" || !Number.isInteger(candidate) || candidate <= 0) {
    return { state: "unreadable", pid: null, alive: false, detail: "carries no usable numeric pid" };
  }
  let alive = false;
  try {
    process.kill(candidate, 0);
    alive = true;
  } catch (err) {
    // EPERM means the pid EXISTS but belongs to someone else — still a live process.
    alive = (err as NodeJS.ErrnoException).code === "EPERM";
  }
  return { state: "present", pid: candidate, alive };
}

export interface OrphanServeClassification {
  serves: ProcInfo[];
  /** ppid === 1 `quay … serve` processes that ARE in this workspace's scope but were SPARED because
   *  the registration at their OWN workspace root (their cwd) names this very pid — a goal preview
   *  instance (§4.10), or any other background host that is the registered host of the root it runs
   *  in. Reported separately so "evaluated and spared" is distinguishable from "never looked at"
   *  (硬规则 3b). ⛔ Never merged into `serves`. */
  recognizedServes: ProcInfo[];
  /** true ⇔ the predicate could not be evaluated at all ⇒ the caller must kill NOTHING.
   *  ⛔ Distinct from `serves: []` + `notEvaluated: false`, which means "evaluated, nothing found"
   *  (硬规则 3b: an unevaluable predicate must not share an output with a clean one). */
  notEvaluated: boolean;
  reason?: string;
}

/** Is this process the REGISTERED host of the workspace it is running in — i.e. does
 *  `<its cwd>/.quay/server.json` name this very pid?
 *
 *  ⛔ Read from the process's OWN cwd (its workspace root), not from the `--root` we were asked
 *  about: those are the same file only when the process runs in the main checkout. That difference
 *  is the whole point — a goal preview instance's root is the preview worktree, so the `--root`
 *  registration can never vouch for it.
 *
 *  ⛔ Deliberately does NOT require the registration to be "alive": the process IS this pid and it
 *  is in the proc table, so a matching registration is a live self-registration by construction.
 *  Requiring the `process.kill(pid, 0)` ping would add nothing and would make the pure predicate
 *  untestable with injected (non-existent) pids.
 *  ⛔ `absent` / `unreadable` / a different pid all return false — a carrier that cannot name this
 *  pid vouches for nothing, and the process stays in the reap set. */
export function isSelfRegisteredServe(p: ProcInfo): boolean {
  if (!p.cwd) return false;
  const own = readServeRegistration(p.cwd);
  return own.state === "present" && own.pid === p.pid;
}

/** Reap candidates for `--orphan-serves`: a `quay … serve` process whose PARENT IS DEAD
 *  (ppid === 1), which is in THIS workspace's scope, and which nothing vouches for.
 *
 *  WHY THE REGISTRATION GATE IS LOAD-BEARING: the orphan state alone is NOT enough. A legitimate
 *  host is spawned `detached: true` + `unref()` (server.ts `spawnHost`), so its parent is ALSO
 *  gone — it is ppid === 1 too. What separates the two is ownership, and the owner-of-record is
 *  `.quay/server.json`. When that registration is missing, unreadable, or names a dead pid, the
 *  reaper CANNOT tell them apart and refuses (see readServeRegistration for the hijack that makes
 *  the dead-pid case real). ⛔ Never widen this to "any ppid === 1 quay serve" — that kills the UI.
 *
 *  `worktreeNamespace` (the workspace's `loop.worktree_root`, resolved by the caller through the
 *  single resolver — null ⇒ not consulted) widens the SCOPE, not the voucher: goal preview
 *  instances live in that namespace as SIBLINGS of the main checkout, so without it a preview
 *  serve is not even a candidate. Once in scope, though, the same rule decides its fate as for any
 *  other candidate — a preview serve is spared only because it registers ITSELF at ITS OWN root
 *  (isSelfRegisteredServe); a namespace sibling that registers nothing is still residue and is
 *  reaped. */
export function classifyOrphanServes(
  procs: ProcInfo[],
  reg: ServeRegistration,
  exclude: Set<number>,
  root: string,
  worktreeNamespace: string | null = null,
): OrphanServeClassification {
  if (reg.state !== "present" || reg.pid === null) {
    return {
      serves: [],
      recognizedServes: [],
      notEvaluated: true,
      reason: `serve registration is ${reg.state}${reg.detail ? ` (${reg.detail})` : ""} — without it a leaked host is indistinguishable from the live one`,
    };
  }
  if (!reg.alive) {
    return {
      serves: [],
      recognizedServes: [],
      notEvaluated: true,
      reason: `serve registration names pid ${reg.pid}, which is DEAD — a stale registration cannot vouch for any live host, so nothing may be reaped (this is precisely the state a hijacking transient host leaves behind)`,
    };
  }
  // ⚠️ The SCOPE gate is LOAD-BEARING, and its absence was MEASURED, not theorised.
  //
  // The enumeration is SYSTEM-WIDE (every pid), while the registration gate only vouches for hosts
  // of THIS root. Without a scope, every OTHER repository's legitimately-running serve — and this
  // repository's own, when `--root` points somewhere else — is ppid === 1, is a quay serve, and is
  // not named by this root's registration ⇒ it matched and was killed. Observed on the first real
  // run: the reaper killed the live production Web UI (bound to the tailnet address, serving real
  // traffic) while the deliberate orphan it was aimed at survived untouched.
  //
  // ⇒ A candidate must belong to the workspace we were asked about: under `root`, or under that
  // workspace's worktree namespace (where its task AND goal-preview worktrees live). Foreign
  // repositories match neither and are never candidates. The voucher (isSelfRegisteredServe) then
  // answers the only remaining question — is it the host of its own root, or residue.
  const ns = worktreeNamespace ? path.resolve(worktreeNamespace) : null;
  const serves: ProcInfo[] = [];
  const recognizedServes: ProcInfo[] = [];
  for (const p of procs) {
    if (exclude.has(p.pid)) continue;
    if (p.pid === reg.pid) continue; // the --root's own registered host
    if (p.ppid !== 1) continue; // parent alive ⇒ not an orphan
    if (!isQuayServe(p.cmdline)) continue; // not a serve host
    const underRoot = cwdUnder(p.cwd, root);
    const underNamespace = ns !== null && cwdUnder(p.cwd, ns);
    if (!underRoot && !underNamespace) continue; // another repo we were not asked about
    if (isSelfRegisteredServe(p)) {
      recognizedServes.push(p); // its own root's carrier vouches for it (preview instance etc.)
      continue;
    }
    serves.push(p);
  }
  return { serves, recognizedServes, notEvaluated: false };
}

/** The repo's full-suite lock files for --orphans: the CANONICAL slot implementation
 *  (plugin/scripts/suite-lock-slots.ts — the SINGLE definition point, gap-suite-concurrency-
 *  ff-gate-and-slot-ssot): <git-common-dir>/full-suite.lock.0 .. .S-1 where S = QUAY_MAX_CONCURRENT_SUITES.
 *  Reading the canonical means a S=3 config's `.2` stale holder is ALSO reclaimed (the old fixed
 *  `.0`/`.1` list could never see it). */
export function fullSuiteLockFiles(root: string): string[] {
  return suiteLockSlotPaths(suiteLockBase(root));
}

/** Stop a set of pids: SIGTERM each, wait a bounded grace for exit, SIGKILL survivors. Fail-open
 * per pid (an already-exited process is not an error). Same contract as orphan-session-check.ts. */
export function killProcs(pids: number[], graceMs = 3000): { killed: number; sigkilled: number; failed: number } {
  let killed = 0;
  let sigkilled = 0;
  let failed = 0;
  if (pids.length === 0) return { killed, sigkilled, failed };
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      continue; // already gone (ESRCH) or not ours (EPERM) — counted once below
    }
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    const stillAlive = pids.filter((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
    if (stillAlive.length === 0) break;
    const sleepMs = Math.min(200, Math.max(0, deadline - Date.now()));
    if (sleepMs <= 0) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleepMs);
  }
  for (const pid of pids) {
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch {
      alive = false;
    }
    if (!alive) {
      killed += 1;
      continue;
    }
    try {
      process.kill(pid, "SIGKILL");
      sigkilled += 1;
      killed += 1;
    } catch {
      failed += 1;
    }
  }
  return { killed, sigkilled, failed };
}

function summary(p: ProcInfo): string {
  const cwd = p.cwd !== null ? `${p.cwd}${p.cwdDeleted ? " (deleted)" : ""}` : "(unreadable)";
  return `pid=${p.pid} cwd=${cwd} argv0=${p.argv0 ?? "?"} state=${p.state ?? "?"}`;
}

export function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function main(argv: string[]): number {
  const listOnly = argv.includes("--list") || argv.includes("--dry-run");
  const json = argv.includes("--json");
  const orphanMode = argv.includes("--orphans");
  // --orphan-serves: reap leaked `quay … serve` hosts (ppid === 1 AND not the registered host).
  // A THIRD mode, mutually exclusive with the other two — see classifyOrphanServes for why the
  // registration gate is load-bearing rather than a nicety.
  const orphanServeMode = argv.includes("--orphan-serves");
  // --orphans scope: when set, reclaim ONLY stale full-suite.lock holders for --root, skipping the
  // global claude-probe orphan sweep. fan-in-ff-merge's stale-lock reclaim uses this — its purpose
  // is unblocking the ff from a held slot, and the global probe sweep would race with unrelated
  // concurrent tests that rely on a live orphan probe (see header comment). Requires --orphans.
  const staleLockOnly = argv.includes("--stale-lock-holders-only");

  const wtIdx = argv.indexOf("--worktree");
  const rootIdx = argv.indexOf("--root");

  if (staleLockOnly && !orphanMode) {
    process.stderr.write("worktree-process-reaper: --stale-lock-holders-only requires --orphans\n");
    return 2;
  }
  if (orphanMode && wtIdx !== -1) {
    process.stderr.write("worktree-process-reaper: --orphans and --worktree are mutually exclusive\n");
    return 2;
  }
  if (orphanServeMode && (orphanMode || wtIdx !== -1)) {
    process.stderr.write("worktree-process-reaper: --orphan-serves is mutually exclusive with --worktree and --orphans\n");
    return 2;
  }
  if (!orphanMode && !orphanServeMode && wtIdx === -1) {
    process.stderr.write("worktree-process-reaper: one of --worktree <path>, --orphans or --orphan-serves is required\n");
    return 2;
  }

  let root = rootIdx !== -1 ? path.resolve(argv[rootIdx + 1] ?? "") : "";
  if (rootIdx !== -1 && (!root || root === path.resolve("/"))) {
    process.stderr.write("worktree-process-reaper: --root requires a non-root repo path\n");
    return 2;
  }

  const seam = process.env.WORKTREE_PROCESS_REAPER_PS_SOURCE;
  const procs = seam ? enumerateProcsFromSeam(seam) : enumerateProcs();
  const exclude = seam ? new Set<number>() : selfAndAncestors();

  let targets: ProcInfo[] = [];
  let probes: ProcInfo[] = [];
  let staleLockHolders: ProcInfo[] = [];
  let lockFiles: string[] = [];
  let serveReg: ServeRegistration | null = null;
  let serveNotEvaluated = false;
  let serveReason: string | undefined;
  let recognizedServes: ProcInfo[] = [];

  if (orphanMode) {
    lockFiles = fullSuiteLockFiles(root);
    const cls = classifyOrphans(procs, lockFiles, exclude);
    probes = staleLockOnly ? [] : cls.probes;
    staleLockHolders = cls.staleLockHolders;
    targets = [...probes, ...staleLockHolders];
  } else if (orphanServeMode) {
    if (rootIdx === -1) {
      // The owner-of-record lives at <root>/.quay/server.json; without an explicit repo root the
      // reaper would be guessing which registration to trust. Fail closed rather than default.
      process.stderr.write("worktree-process-reaper: --orphan-serves requires --root <repo> (the .quay/server.json carrier lives under it)\n");
      return 2;
    }
    serveReg = readServeRegistration(root);
    // The worktree namespace is resolved THROUGH THE SINGLE RESOLVER (never a literal): it is where
    // goal preview instances live, and `classifyOrphanServes` must see them in order to RECOGNIZE
    // them (a preview serve's own root registrar vouches for it) rather than reap them (§4.10).
    const cls = classifyOrphanServes(procs, serveReg, exclude, root, resolveWorktreeNamespace(root).dir);
    serveNotEvaluated = cls.notEvaluated;
    serveReason = cls.reason;
    recognizedServes = cls.recognizedServes;
    targets = cls.serves;
  } else {
    const worktree = path.resolve(argv[wtIdx + 1] ?? "");
    if (!worktree || worktree === path.resolve("/")) {
      process.stderr.write("worktree-process-reaper: --worktree requires a non-root worktree path\n");
      return 2;
    }
    targets = classifyForWorktree(procs, worktree, exclude);
  }

  const pids = targets.map((p) => p.pid);
  let res = { killed: 0, sigkilled: 0, failed: 0 };
  if (!listOnly && pids.length > 0) {
    res = killProcs(pids);
  }

  if (json) {
    const payload = {
      mode: orphanServeMode ? "orphan-serves" : orphanMode ? "orphans" : "worktree",
      dryRun: listOnly,
      found: targets.length,
      killed: res.killed,
      sigkilled: res.sigkilled,
      failed: res.failed,
      pids,
      // Three-state on purpose (硬规则 3b): `notEvaluated: true` means the predicate could not be
      // run at all and NOTHING was killed — never to be read as "evaluated, found none".
      serveRegistration: orphanServeMode && serveReg ? serveReg : undefined,
      serveNotEvaluated: orphanServeMode ? serveNotEvaluated : undefined,
      serveNotEvaluatedReason: orphanServeMode ? serveReason : undefined,
      // In-scope candidates that were SPARED because their own root's registration names them
      // (硬规则 3b: "evaluated and spared" must be readable, not inferred from an absence).
      recognizedServes: orphanServeMode
        ? recognizedServes.map((p) => ({ pid: p.pid, cwd: p.cwd, argv0: p.argv0, state: p.state }))
        : [],
      probes: orphanMode ? probes.map((p) => ({ pid: p.pid, cwd: p.cwd, argv0: p.argv0, state: p.state })) : [],
      staleLockHolders: orphanMode ? staleLockHolders.map((p) => ({ pid: p.pid, cwd: p.cwd, argv0: p.argv0, state: p.state })) : [],
      lockFiles: orphanMode ? lockFiles : [],
      targets: targets.map((p) => ({ pid: p.pid, cwd: p.cwd, cwdDeleted: p.cwdDeleted, argv0: p.argv0, state: p.state })),
    };
    printJson(payload);
  } else {
    if (orphanMode) {
      process.stdout.write(
        `worktree-process-reaper: orphans — ${probes.length} probe(s), ${staleLockHolders.length} stale full-suite.lock holder(s)${listOnly ? " [dry-run]" : ""}\n`,
      );
    } else if (orphanServeMode) {
      if (serveNotEvaluated) {
        // ⛔ Deliberately NOT the same sentence shape as the reaped case: "could not evaluate" must
        // never read as "evaluated and clean" (硬规则 3b).
        process.stdout.write(
          `worktree-process-reaper: orphan-serves — NOT-EVALUATED: 0 reaped, ${serveReason}\n`,
        );
      } else {
        process.stdout.write(
          `worktree-process-reaper: orphan-serves — ${targets.length} leaked serve host(s)${listOnly ? " [dry-run]" : ""} (registered live host pid=${serveReg?.pid ?? "?"}; ${recognizedServes.length} self-registered host(s) spared)\n`,
        );
      }
    } else {
      process.stdout.write(
        `worktree-process-reaper: worktree — ${targets.length} process(es) anchored under the worktree${listOnly ? " [dry-run]" : ""}\n`,
      );
    }
    for (const t of targets) process.stdout.write(`  ${listOnly ? "WOULD-KILL" : "KILLED"} ${summary(t)}\n`);
  }
  return 0;
}

// ⛔ NAME-based, never URL-based (gap-serve-same-root-admission-lock, 2026-09-18 — measured):
// when `packages/quay/src/serve.ts` imported this module for `readProcCmdline` + `isQuayServe`, the
// reaper was INLINED into the shipped `quay` bundle. In that form EVERY inlined module shares the
// bundle's `import.meta.url`, so the old `fileURLToPath(import.meta.url) === resolve(argv[1])` check
// was TRUE inside `quay serve`: this top-level block ran the reaper's own CLI with `serve`'s argv,
// printed "one of --worktree/--orphans/--orphan-serves is required" on stderr, and set exit code 2 —
// which then OVERRODE the refusal path's documented `exit 0` (measured: serve.test.mjs AC1 failed
// with exit 2 on the refused second start). `isDirectEntry` is the repo's single source for this
// check and takes the script's own basename, which is the entry's in both source and bundle form and
// can never match an inlined library (see its header: the bare form is gone on purpose).
// ⚠️ The INLINING that made the old check wrong is gone as of tasks/gap-arch-reverse-edges-zero:
// serve.ts now takes those two predicates from the kernel leaf, so this file is no longer part of
// the `quay` bundle. The NAME-based guard stays regardless — this file is still inlined into the
// PLUGIN bundles that import it, and is still spawned directly as a sibling script by
// `fan-in/ff-merge.ts`, so it is entered both as an entry and as a library.
const isDirect = isDirectEntry(import.meta, undefined, "worktree-process-reaper");
if (isDirect) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`worktree-process-reaper: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 2;
  }
}
