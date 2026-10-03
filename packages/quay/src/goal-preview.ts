// goal-preview.ts — the goal PREVIEW INSTANCE (SPEC-goal-branch-2026-10-03 §4.10, rulings ⑮⑫㉒㉓).
//
// WHAT A PREVIEW INSTANCE IS. One branch-mode goal = one preview instance = the criterion worktree
// (`goalCriterionWorktreeDir`, detached at the `goal/<id>` tip — §5 B1) PLUS a `quay serve` whose
// workspace root IS that worktree. The human tries the goal's changes there before the merge; the
// pre-merge ACs are evaluated on the SAME tree, so "what the human tried" and "what the criterion
// verified" are the same object (⑮).
//
// WHO OWNS WHAT (ruling ㉒):
//   · the WORKTREE — goal-driver creates / refreshes / deletes it (it already evaluates there);
//   · the SERVE   — the human starts and stops it with `quay goal preview <GOAL> start|stop|status`.
// There is deliberately NO "has been tried" flag: an un-started preview means a live-probe AC reads
// `not-evaluated`, which blocks `quay goal merge`. 「人确实试用过」IS that reading.
//
// WHY IT CAN COEXIST WITH PRODUCTION (read from the code, 2026-10-03):
//   · `quay serve`'s admission lock is per WORKSPACE ROOT (`serve.ts` SERVE_LOCK_REL under the root)
//     ⇒ a preview root ≠ the main checkout ⇒ the two do not exclude each other.
//   · `quay serve` hosts only `web` + `control` (cli/driver-vocab.ts HOSTED_SERVICE_NAMES) — no
//     driver ⇒ a preview never dispatches tasks and never adopts production workers.
//   · a live-probe criterion finds its server by "cwd == `git rev-parse --show-toplevel`" (AC-288)
//     ⇒ evaluated in the preview worktree it matches the preview serve, with no criterion edit.
//
// ── the `.quay/` snapshot (ruling ㉓) ────────────────────────────────────────────────────────────
// A new worktree has NO `.quay/` (it is gitignored) while the serve needs at least `config.yml`.
// Each refresh copies a SNAPSHOT of the main checkout's `.quay/` into the preview — the same
// mechanism `plugin/scripts/refresh-worktree-quay.sh` already uses for task worktrees (snapshot, ⛔
// never a symlink; the preview's writes land on its own copy and are discarded on the next refresh —
// memory `task-worktree-gate-ledger-is-not-durable`).
// ⛔ INSTANCE IDENTITY FILES ARE NEVER COPIED: `server.json` (`SERVER_STATE_REL`, server-state.ts),
// `server.lock` (`SERVE_LOCK_REL`, serve.ts) and `server-services.json` (`SERVICE_STATE_REL`,
// serve.ts) name WHICH process is the host of a root. Copying the production ones would make the
// preview read the PRODUCTION instance's registration — the exact hijack the reaper's
// `isSelfRegisteredServe` guard was built to survive. So the preview starts with none of them and
// its own serve publishes its own.
// ⛔ PREVIEW CODE NEVER READS OR WRITES PRODUCTION DATA: everything the preview mutates lives under
// its own root and is thrown away by the next refresh.
//
// The heavy/wasteful exclusions below MIRROR `refresh-worktree-quay.sh`'s set (that script is the
// sibling implementation; the difference is exactly the instance-identity files above): this repo's
// `.quay/` is multi-GB (measured 5.4 GB on 2026-10-03, `node-compile-cache` alone 4 GB), so an
// unfiltered copy is not a "snapshot", it is an outage.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { goalCriterionWorktreeDir } from "./goal-store.ts";
import { readServerState, pidAlive } from "./server-state.ts";

/** The serve-lock file, restated from `serve.ts`'s `SERVE_LOCK_REL` — see the header. Not imported
 *  from `serve.ts` on purpose: this module is a LEAF (it is re-exported through the drivers' Layer 0
 *  import face), and `serve.ts` pulls the whole web/handler graph in. The two literals are pinned by
 *  this task's test (the snapshot must not carry them). */
export const PREVIEW_SERVE_LOCK_BASENAME = "server.lock";
/** The unified serve carrier, restated from `server-state.ts`'s `SERVER_STATE_REL`. */
export const PREVIEW_SERVER_STATE_BASENAME = "server.json";
/** The per-service liveness carrier, restated from `serve.ts`'s `SERVICE_STATE_REL`. */
export const PREVIEW_SERVICE_STATE_BASENAME = "server-services.json";

/** Files that identify a RUNNING INSTANCE of a root. Never copied into a preview (header). */
export const PREVIEW_INSTANCE_FILES: readonly string[] = [
  PREVIEW_SERVER_STATE_BASENAME,
  PREVIEW_SERVE_LOCK_BASENAME,
  PREVIEW_SERVICE_STATE_BASENAME,
];

/** Heavy/wasteful `.quay/` entries a snapshot skips — the same set `refresh-worktree-quay.sh`
 *  excludes (a compile cache is regenerable; dated logs and machine-local inboxes are irrelevant to
 *  a preview). Entries are workspace-relative to `.quay/`. */
export const PREVIEW_SNAPSHOT_SKIP_DIRS: readonly string[] = ["node-compile-cache", "manager-inbox", "outer-inbox"];
/** Skip predicate for a whole file name matching the dated full-suite log convention. */
export function isPreviewSnapshotSkippedLog(name: string): boolean {
  return /^full-suite-.*\.log$/.test(name);
}

/** The preview worktree path for a goal — the SAME derivation the criterion evaluation uses
 *  (`goalCriterionWorktreeDir`): one worktree serves both roles, so they can never diverge. */
export function previewWorktreeDir(mainRoot: string, goalId: string): string {
  return goalCriterionWorktreeDir(mainRoot, goalId);
}

// ── the `.quay/` snapshot ────────────────────────────────────────────────────────────────────────

export interface QuaySnapshotReading {
  /** `copied`      — the snapshot ran (≥0 files copied);
   *  `target-is-source` — the preview root IS the main checkout (no-op, nothing copied);
   *  `source-absent`    — the main checkout has no `.quay/` (nothing to snapshot). */
  state: "copied" | "target-is-source" | "source-absent";
  copied: string[];
  /** Instance-identity files that EXIST at the source and were deliberately not copied (enumerated,
   *  ⛔ never folded into `copied` — 硬规则 3). */
  excluded: string[];
  reasons: string[];
}

function samePath(a: string, b: string): boolean {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

/**
 * Copy the main checkout's `.quay/` into `previewRoot` as a snapshot, skipping instance-identity
 * files and the heavy/wasteful entries. Idempotent (overwrites stale copies). Returns an ENUMERATED
 * reading — what was copied, what was excluded, and (when nothing was copied) why (硬规则 3/3b).
 */
export function snapshotQuayDirInto(mainRoot: string, previewRoot: string): QuaySnapshotReading {
  const src = path.join(mainRoot, ".quay");
  const dst = path.join(previewRoot, ".quay");
  if (samePath(src, dst)) {
    return { state: "target-is-source", copied: [], excluded: [], reasons: [`${previewRoot} is the main checkout — nothing to snapshot`] };
  }
  if (!fs.existsSync(src)) {
    return { state: "source-absent", copied: [], excluded: [], reasons: [`no ${src} to snapshot`] };
  }
  const copied: string[] = [];
  const excluded: string[] = [];
  const reasons: string[] = [];
  fs.mkdirSync(dst, { recursive: true });
  const walk = (rel: string): void => {
    const abs = path.join(src, rel);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch (err) {
      reasons.push(`cannot read ${abs}: ${String((err as Error)?.message ?? err)}`);
      return;
    }
    for (const e of entries) {
      const childRel = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) {
        if (rel === "" && PREVIEW_SNAPSHOT_SKIP_DIRS.includes(e.name)) {
          excluded.push(`${childRel}/`);
          continue;
        }
        fs.mkdirSync(path.join(dst, childRel), { recursive: true });
        walk(childRel);
        continue;
      }
      if (!e.isFile()) continue; // symlinks / sockets: not part of a data snapshot
      if (rel === "" && PREVIEW_INSTANCE_FILES.includes(e.name)) {
        excluded.push(childRel);
        continue;
      }
      if (rel === "" && isPreviewSnapshotSkippedLog(e.name)) {
        excluded.push(childRel);
        continue;
      }
      try {
        fs.copyFileSync(path.join(src, childRel), path.join(dst, childRel));
        copied.push(childRel);
      } catch (err) {
        reasons.push(`cannot copy ${childRel}: ${String((err as Error)?.message ?? err)}`);
      }
    }
  };
  walk("");
  return { state: "copied", copied, excluded, reasons };
}

// ── reading the preview's carrier ────────────────────────────────────────────────────────────────

export interface PreviewStatusReading {
  /** Four DISTINCT outcomes (硬规则 3b): `running` (carrier present, pid alive), `stale` (carrier
   *  present, pid DEAD — a killed host masquerading as a live one), `not-running` (no carrier),
   *  `not-evaluated` (carrier unreadable — could not tell, ⛔ not "not running"). */
  state: "running" | "stale" | "not-running" | "not-evaluated";
  previewRoot: string;
  pid: number | null;
  host: string | null;
  /** The `web` service port recorded in the carrier (kernel-assigned ports are knowable only here). */
  port: number | null;
  detail: string;
}

/** Read a preview instance's state from ITS OWN root's `.quay/server.json` (never the main one). */
export function readPreviewStatus(previewRoot: string): PreviewStatusReading {
  const read = readServerState(previewRoot);
  if (read.kind === "absent") {
    return { state: "not-running", previewRoot, pid: null, host: null, port: null, detail: read.reason };
  }
  if (read.kind === "unreadable") {
    return { state: "not-evaluated", previewRoot, pid: null, host: null, port: null, detail: read.reason };
  }
  const st = read.state;
  const web = st.services.find((s) => s.name === "web") ?? null;
  if (!pidAlive(st.pid)) {
    return { state: "stale", previewRoot, pid: st.pid, host: web?.host ?? null, port: web?.port ?? null, detail: `carrier names pid ${st.pid}, which is DEAD` };
  }
  return {
    state: "running",
    previewRoot,
    pid: st.pid,
    host: web?.host ?? null,
    port: web?.port ?? null,
    detail: `pid ${st.pid} alive${web ? `, web on ${web.host}:${web.port}` : " (no web service entry)"}`,
  };
}

// ── stopping a preview serve ─────────────────────────────────────────────────────────────────────

export interface PreviewStopReading {
  /** `stopped`    — a host was signalled and its carrier removed;
   *  `not-running`— no live host registered at this root (idempotent);
   *  `not-evaluated` — the carrier could not be read (could not tell);
   *  `failed`     — a live host was found but not all of it could be stopped (reported, ⛔ not a lie). */
  state: "stopped" | "not-running" | "not-evaluated" | "failed";
  pid: number | null;
  /** `group` = the whole process group was signalled (the `node --watch` supervisor + its child),
   *  `pid` = only the registered pid. `null` when nothing was signalled. */
  signalled: "group" | "pid" | null;
  detail: string;
}

/**
 * Read `/proc/<pid>/stat`'s process-group id. Returns null when it cannot be read (⛔ never 0 —
 * "could not read" must not look like a real pgid, 硬规则 3b). `comm` (field 2) may contain spaces
 * and parentheses, so the parse starts after its LAST ')'.
 */
export function readProcessGroupId(pid: number): number | null {
  let raw: string;
  try {
    raw = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return null;
  }
  const close = raw.lastIndexOf(")");
  if (close < 0) return null;
  // After ")": state ppid pgrp session ...
  const fields = raw.slice(close + 1).trim().split(/\s+/);
  const pgrp = Number.parseInt(fields[2] ?? "", 10);
  return Number.isInteger(pgrp) && pgrp > 0 ? pgrp : null;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The pid recorded in a root's serve LOCK (a bare `<pid>\n`), or null when absent/unreadable. */
function readLockPid(lockPath: string): number | null {
  try {
    const n = Number.parseInt(fs.readFileSync(lockPath, "utf8").trim(), 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Remove a bare-pid lock only when it still names `pid`. ⛔ Never delete a successor's record:
 *  after a kill+restart the file belongs to the NEW host. */
function removeLockIfOwned(lockPath: string, pid: number): void {
  if (readLockPid(lockPath) !== pid) return;
  try {
    fs.rmSync(lockPath, { force: true });
  } catch {
    /* best-effort: the admission lock's own stale-pid path still handles a leftover */
  }
}

/** Remove the JSON carrier only when it still names `pid` (⛔ the carrier is JSON, not a bare pid —
 *  reading it with the lock parser would silently never match and leak the file). */
function removeCarrierIfOwned(carrierPath: string, pid: number): void {
  try {
    const parsed = JSON.parse(fs.readFileSync(carrierPath, "utf8")) as { pid?: unknown };
    if (parsed?.pid !== pid) return;
    fs.rmSync(carrierPath, { force: true });
  } catch {
    /* absent / unreadable — nothing to remove */
  }
}

/**
 * Stop the preview serve registered at `previewRoot` by reading ITS OWN `.quay/server.json`.
 * ⛔ NEVER `pkill -f`: the supervisor's argv literally contains the pattern the caller searched for,
 * so a pattern kill can match the caller itself (or an unrelated workspace's host).
 *
 * The registered pid is the serve CHILD under `node --watch`; the supervisor is its own process
 * group leader (start spawns detached), so the whole group is signalled — otherwise killing the
 * child would leave `node --watch` waiting for a file change forever.
 */
export function stopPreviewServe(previewRoot: string, opts: { graceMs?: number } = {}): PreviewStopReading {
  const graceMs = opts.graceMs ?? 5000;
  const read = readServerState(previewRoot);
  if (read.kind === "absent") return { state: "not-running", pid: null, signalled: null, detail: read.reason };
  if (read.kind === "unreadable") return { state: "not-evaluated", pid: null, signalled: null, detail: read.reason };
  const pid = read.state.pid;
  const carrierPath = read.path;
  const lockPath = path.join(previewRoot, ".quay", PREVIEW_SERVE_LOCK_BASENAME);
  if (!pidAlive(pid)) {
    // A stale carrier names a dead host. Clean it (and a matching stale lock) so the next start is
    // not blocked by residue — but report `not-running`, not `stopped` (nothing was signalled).
    removeCarrierIfOwned(carrierPath, pid);
    removeLockIfOwned(lockPath, pid);
    return { state: "not-running", pid, signalled: null, detail: `carrier names pid ${pid}, which is already DEAD — carrier cleared` };
  }
  const pgid = readProcessGroupId(pid);
  // ⛔ Never group-kill our OWN group: a host that shares the caller's group (e.g. one started with
  // `detached: false`) must be signalled by pid only, or we would kill ourselves and our parent.
  const ownPgid = readProcessGroupId(process.pid);
  const useGroup = pgid !== null && (ownPgid === null || pgid !== ownPgid);
  let signalled: "group" | "pid" = "pid";
  let signalErr: string | null = null;
  try {
    if (useGroup) {
      process.kill(-(pgid as number), "SIGTERM");
      signalled = "group";
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch (err) {
    signalErr = String((err as NodeJS.ErrnoException)?.code ?? (err as Error)?.message ?? err);
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && pidAlive(pid)) sleepSync(100);
  if (pidAlive(pid)) {
    try {
      if (useGroup) process.kill(-(pgid as number), "SIGKILL");
      else process.kill(pid, "SIGKILL");
    } catch {
      /* fall through to the liveness re-read below */
    }
    const killDeadline = Date.now() + 2000;
    while (Date.now() < killDeadline && pidAlive(pid)) sleepSync(100);
  }
  if (pidAlive(pid)) {
    return {
      state: "failed",
      pid,
      signalled,
      detail: `pid ${pid} is STILL ALIVE after SIGTERM+SIGKILL${signalErr ? ` (first signal failed: ${signalErr})` : ""}`,
    };
  }
  removeCarrierIfOwned(carrierPath, pid);
  removeLockIfOwned(lockPath, pid);
  return { state: "stopped", pid, signalled, detail: `stopped ${signalled === "group" ? `process group ${pgid}` : `pid ${pid}`}; carrier cleared` };
}

// ── starting a preview serve ─────────────────────────────────────────────────────────────────────

export interface PreviewStartReading {
  state: "started" | "already-running" | "failed";
  pid: number | null;
  host: string | null;
  port: number | null;
  detail: string;
}

/** The preview serve runs the PREVIEW WORKTREE'S OWN quay code — that is the whole point (the human
 *  is trying the goal branch's changes). A worktree that carries no such entry cannot host a
 *  preview: fail with that reason rather than silently serving the main checkout's code. */
export function previewServeEntry(previewRoot: string): string {
  return path.join(previewRoot, "packages", "quay", "bin", "quay.ts");
}

export interface StartPreviewOptions {
  previewRoot: string;
  /** Explicit port, ≥ 1. `0` (kernel-assigned) is refused: a preview the human cannot address is
   *  not a preview (and it is the DEFAULT this flag exists to override — SPEC §4.10). */
  port: number;
  host?: string;
  /** `node --watch` (the dev-mode entry, CLAUDE.md): the serve restarts itself when a refresh
   *  rewrites the worktree, so no extra restart logic is needed. Off only for tests. */
  watch?: boolean;
  timeoutMs?: number;
  logPath?: string;
}

/**
 * Start a preview serve for `previewRoot` as a DETACHED process (its own process group, so `stop`
 * can signal the `node --watch` supervisor together with the serve it spawned). Waits until the
 * root's own `.quay/server.json` names a live pid, then reports it.
 *
 * Idempotent: a preview whose carrier already names a live host is reported `already-running`
 * without spawning a second host (a second host would only be refused by the admission lock).
 */
export async function startPreviewServe(opts: StartPreviewOptions): Promise<PreviewStartReading> {
  const { previewRoot, port } = opts;
  if (!Number.isInteger(port) || port < 1) {
    return { state: "failed", pid: null, host: null, port: null, detail: `--port must be an integer ≥ 1 (got ${JSON.stringify(port)}); a preview on an unknown port cannot be used` };
  }
  const before = readPreviewStatus(previewRoot);
  if (before.state === "running") {
    return { state: "already-running", pid: before.pid, host: before.host, port: before.port, detail: `a preview serve is already registered at ${previewRoot} (${before.detail})` };
  }
  const entry = previewServeEntry(previewRoot);
  if (!fs.existsSync(entry)) {
    return { state: "failed", pid: null, host: null, port: null, detail: `no quay CLI entry at ${entry} — the preview worktree is missing or not provisioned (the preview must run the goal branch's OWN code)` };
  }
  const logPath = opts.logPath ?? path.join(previewRoot, ".quay", "preview-serve.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const argv: string[] = [];
  if (opts.watch !== false) argv.push("--watch");
  argv.push("--experimental-strip-types", entry, "serve", "--port", String(port));
  if (opts.host) argv.push("--host", opts.host);
  let logFd: number;
  try {
    logFd = fs.openSync(logPath, "a");
  } catch (err) {
    return { state: "failed", pid: null, host: null, port: null, detail: `cannot open preview log ${logPath}: ${String((err as Error)?.message ?? err)}` };
  }
  let childPid: number | undefined;
  try {
    const child = spawn(process.execPath, argv, {
      cwd: previewRoot,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: process.env,
    });
    childPid = child.pid;
    child.unref();
  } catch (err) {
    fs.closeSync(logFd);
    return { state: "failed", pid: null, host: null, port: null, detail: `spawn failed: ${String((err as Error)?.message ?? err)}` };
  } finally {
    try {
      fs.closeSync(logFd);
    } catch {
      /* already closed */
    }
  }
  const timeoutMs = opts.timeoutMs ?? 30000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = readPreviewStatus(previewRoot);
    if (st.state === "running") {
      return { state: "started", pid: st.pid, host: st.host, port: st.port, detail: `preview serve pid ${st.pid} up at ${previewRoot} (log ${logPath})` };
    }
    if (st.state === "stale") break; // a dead pid landed in the carrier — the spawn is not coming up
    sleepSync(200);
  }
  return {
    state: "failed",
    pid: childPid ?? null,
    host: null,
    port: null,
    detail: `no live preview serve registered at ${previewRoot} within ${timeoutMs}ms (supervisor pid ${childPid ?? "?"}; see ${logPath})`,
  };
}
