#!/usr/bin/env node
// @instrument "Which live processes are anchored under a worktree that is about to be removed (test-fixture claude-probe probes + hung suite/runner processes), and which orphaned probes / stale full-suite.lock holders survive with a cwd pointing at a deleted worktree (the worktree-removed-before-test-cleanup orphan family)?"
// plugin/scripts/worktree-process-reaper.ts — gap-worktree-remove-orphans-probes.
//
// Two failure shapes (same root: test/runner child processes nobody reaps):
//   1. `exec -a claude-probe sleep 10000` test fixtures (session-observation/session-topology/
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
// session-observation sweepers pin): a name-based batch kill of LIVE processes is forbidden. This
// reaper NEVER kills by process name — it kills by ORPHAN STATE: cwd under a worktree being
// removed, or cwd pointing at a DELETED directory (a deleted dir has no owner). A live observer
// (session-observation monitor) has cwd = the live repo root, never a task worktree / deleted dir.
//
// Modes:
//   worktree-process-reaper.ts --worktree <path> [--root <repo>] [--list|--dry-run] [--json]
//   worktree-process-reaper.ts --orphans [--root <repo>] [--list|--dry-run] [--json]
//   worktree-process-reaper.ts --orphans --stale-lock-holders-only [--root <repo>] [--json]
//   worktree-process-reaper.ts --help
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
import { fileURLToPath } from "node:url";
// gap-suite-concurrency-ff-gate-and-slot-ssot — the CANONICAL suite-slot implementation (single
// definition point). fullSuiteLockFiles() reads it so the stale-lock reclaim covers ALL S slots
// (S=3 ⇒ `.2` stale holders are reclaimable, never invisible to the fixed `.0`/`.1` list).
import { suiteLockSlotPaths, suiteLockBase } from "./suite-lock-slots.ts";

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
    out.push({ pid, cwd, cwdDeleted: deleted, argv0, state, ppid, openFiles });
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
    out.push({ pid, cwd, cwdDeleted: deleted, argv0: fields[2] ?? null, state: fields[3] ?? null, ppid: fields[4] ? Number(fields[4]) : null, openFiles: fds });
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
  if (!orphanMode && wtIdx === -1) {
    process.stderr.write("worktree-process-reaper: one of --worktree <path> or --orphans is required\n");
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

  if (orphanMode) {
    lockFiles = fullSuiteLockFiles(root);
    const cls = classifyOrphans(procs, lockFiles, exclude);
    probes = staleLockOnly ? [] : cls.probes;
    staleLockHolders = cls.staleLockHolders;
    targets = [...probes, ...staleLockHolders];
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
      mode: orphanMode ? "orphans" : "worktree",
      dryRun: listOnly,
      found: targets.length,
      killed: res.killed,
      sigkilled: res.sigkilled,
      failed: res.failed,
      pids,
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
    } else {
      process.stdout.write(
        `worktree-process-reaper: worktree — ${targets.length} process(es) anchored under the worktree${listOnly ? " [dry-run]" : ""}\n`,
      );
    }
    for (const t of targets) process.stdout.write(`  ${listOnly ? "WOULD-KILL" : "KILLED"} ${summary(t)}\n`);
  }
  return 0;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirect) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`worktree-process-reaper: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 2;
  }
}
