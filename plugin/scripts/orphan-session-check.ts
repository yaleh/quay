#!/usr/bin/env node
// @instrument "Are there live claude sessions whose workspace has been deleted/orphaned — claude --settings <path> processes whose workspace dir no longer exists (the 4-orphan 109-120h leak)?"
// plugin/scripts/orphan-session-check.ts — gap-suite-leaks-live-claude-sessions: the orphan detector.
//
// Enumerates live `claude --settings <path>` processes (the launch-settings form the quay launcher
// uses) and classifies each by whether its WORKSPACE DIRECTORY still exists. A process whose workspace
// was deleted (a fixture teardown that only `rm -rf`'d the dir without reclaiming the process, or a
// worktree unregistered without first stopping its sessions) is an ORPHAN — a leaked live claude
// session. orphan_count > 0 ⇒ red: "泄漏了" vs "没泄漏" becomes mechanically recordable (硬规则 9).
//
// The `--settings` value is read from /proc/<pid>/cmdline (NUL-separated argv) so the INLINE-JSON
// form the manager uses (`claude --settings {json...}`, no file path) is cleanly separable from the
// PATH form (`claude --settings <ws>/.claude/launch.settings.json`) — the inline form has no
// filesystem workspace to check and is never an orphan candidate.
//
// Modes:
//   (no args)            human-readable listing; exit 0
//   --json               machine-readable { orphan_count, total, orphans[], live[] }; prints the JSON
//                        and exits 1 iff orphan_count > 0 (red) — usable both as a measure (the JSON
//                        field) and a gate (the exit code)
//   --kill-workspace <p> stop (SIGTERM → SIGKILL) every claude session whose workspace is under/equal
//                        <p>. This is the shared "回收进程" primitive the teardown sites call BEFORE
//                        deleting/removing a worktree: provision-verify-worktree.sh --teardown,
//                        integration-batch-merge.sh (worktree 注销前停会话). exit 0.
//   --kill-workspace <p> --list   dry-run: print exactly which sessions WOULD be stopped (found /
//                        pids / per-session detail) with killed=0 and kill nothing. Used to verify
//                        the gate logic (which sessions a teardown path would target) WITHOUT killing
//                        anything — the negative control never runs real SIGTERM in the live loop
//                        (manager 116a770c: 验证闸门逻辑用 list-only/dry-run，不在活的生产进程空间
//                        里零隔离地杀任何东西). --dry-run is accepted as an alias for --list.
//   --list               (with no --kill-workspace) same as no-args: human-readable listing, exit 0,
//                        kills nothing.
//
// Contract (task body):
//   measure   orphan_sessions = `node --no-warnings --experimental-strip-types plugin/scripts/orphan-session-check.ts --json` 的 orphan_count 字段
//   invoke    `node --no-warnings --experimental-strip-types plugin/scripts/orphan-session-check.ts --json`（贴孤儿计数）
//
// Env seams (hermetic tests):
//   ORPHAN_SESSION_CHECK_PS_SOURCE=<path>  — read the process list from a file instead of /proc
//                                            (one NUL-separated argv per pid; see the test fixture).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { helpExit } from "./gate-script-base.ts";
import { readProcCmdline } from "../../packages/quay/src/kernel/proc-identity.ts";
// Shared session-liveness primitive — ONE copy, byte-identical to the pinned quay-fleet blob
// (packages/quay/src/primitives/PROVENANCE.md). The `/proc/<pid>/stat` field-22 read below used to
// be a local hand-rolled copy; it is not any more (SPEC §3.3: a second implementation is the one
// unacceptable outcome).
import { readProcStat } from "../../packages/quay/src/primitives/session-liveness.mjs";
// The stop-the-pids primitive — ONE implementation shared with worktree-process-reaper.ts (the
// routine semantic-dedup-scan finding `kill-procs-pair`). Re-exported below so every existing
// caller (this file's --kill-workspace path + its tests, which import it from here) keeps its
// import site; see process-kill-lib.ts for the contract.
import { killProcs } from "./process-kill-lib.ts";
export { killProcs };

export interface ClaudeSessionProc {
  pid: number;
  etimes: number | null; // elapsed wall seconds (from /proc stat starttime when parseable, else null)
  argv: string[];
  /** raw value of the --settings flag (may be a path OR an inline JSON blob) */
  settingsValue: string | null;
  settingsKind: "path" | "inline-json" | "missing";
  /** workspace root derived from a path-kind settings value (dirname, or <dir>/.claude → <dir>) */
  workspace: string | null;
}

/**
 * Classify ONE process's argv (from /proc/<pid>/cmdline, NUL-split) as a claude launch-settings
 * session or not. Pure — no I/O — so tests can feed arbitrary argv shapes.
 *
 * Matches only processes whose argv[0] basename is `claude` (never `claude-probe` fakes or a shell
 * wrapper) AND that carry a `--settings` flag. Returns null for everything else.
 */
export function classifyArgv(argv: string[], pid: number, etimes: number | null = null): ClaudeSessionProc | null {
  if (!Array.isArray(argv) || argv.length === 0) return null;
  const argv0 = argv[0] ?? "";
  const argv0Base = path.basename(argv0);
  // exact `claude` — `claude-probe`, `claude-deepseek`-wrapped args, `node cli.js`, bash wrappers are NOT in scope.
  if (argv0Base !== "claude") return null;
  const flagIdx = argv.indexOf("--settings");
  if (flagIdx === -1) return null;
  const settingsValue = argv[flagIdx + 1] ?? null;
  if (settingsValue === null || settingsValue.length === 0) {
    return { pid, etimes, argv, settingsValue: null, settingsKind: "missing", workspace: null };
  }
  const inlineJson = settingsValue.trimStart().startsWith("{");
  const kind: ClaudeSessionProc["settingsKind"] = inlineJson ? "inline-json" : "path";
  const workspace = kind === "path" ? workspaceRootOf(settingsValue) : null;
  return { pid, etimes, argv, settingsValue, settingsKind: kind, workspace };
}

/**
 * Derive the workspace root a launch-settings file path belongs to. The quay launcher writes
 * `<workspace>/.claude/launch.settings.json` ⇒ workspace = dirname(dirname(path)) when the immediate
 * parent is `.claude`; otherwise the file's own directory is the workspace. Resolves to absolute.
 */
export function workspaceRootOf(settingsPath: string): string {
  const dir = path.resolve(path.dirname(settingsPath));
  if (path.basename(dir) === ".claude") return path.resolve(dir, "..");
  return dir;
}

/** Is a process an orphan — a path-kind session whose workspace directory no longer exists on disk? */
export function isOrphan(proc: ClaudeSessionProc): boolean {
  return proc.settingsKind === "path" && proc.workspace !== null && !fs.existsSync(proc.workspace);
}

export interface Classification {
  total: number;
  pathKind: number;
  inlineJson: number;
  missing: number;
  orphans: ClaudeSessionProc[];
  live: ClaudeSessionProc[];
  orphanCount: number;
}

/** Partition path-kind sessions into orphans (workspace gone) vs live (workspace present). Pure on disk. */
export function classifySessions(procs: ClaudeSessionProc[]): Classification {
  const orphans: ClaudeSessionProc[] = [];
  const live: ClaudeSessionProc[] = [];
  let pathKind = 0;
  let inlineJson = 0;
  let missing = 0;
  for (const p of procs) {
    if (p.settingsKind === "path") {
      pathKind += 1;
      (isOrphan(p) ? orphans : live).push(p);
    } else if (p.settingsKind === "inline-json") {
      inlineJson += 1;
    } else {
      missing += 1;
    }
  }
  return { total: procs.length, pathKind, inlineJson, missing, orphans, live, orphanCount: orphans.length };
}

/**
 * The subset of processes whose workspace is the given workspace path or a path beneath it.
 * Pure — used by --kill-workspace (and its --list dry-run) and by the limited-path teardown callers
 * (provision-verify-worktree.sh --teardown, integration-batch-merge.sh).
 */
export function sessionsUnderWorkspace(procs: ClaudeSessionProc[], workspace: string): ClaudeSessionProc[] {
  const ws = path.resolve(workspace);
  return procs.filter((p) => p.workspace !== null && (p.workspace === ws || p.workspace.startsWith(ws + path.sep)));
}

/**
 * Read one process's argv from /proc/<pid>/cmdline (NUL-separated). Returns null if the process is
 * already gone / unreadable (transient — a teardown racing a process exit must not fabricate a hit).
 *
 * 读 + NUL 切分由 kernel leaf `readProcCmdline` 单点实现（本文件原有第二份手搓副本 —
 * gap-judgment-rewrites-route-through-proc-identity-leaf）。本处只保留【调用点自己的口径】：
 * 丢弃空字段。⛔ 失败值仍是 null，不折成 []（两者语义不同：null = 读不成，[] = 读到了但无参数）。
 */
export function readProcArgv(pid: number): string[] | null {
  const argv = readProcCmdline(pid);
  return argv === null ? null : argv.filter((s) => s.length > 0);
}

/**
 * Read one process's elapsed wall-seconds from /proc/<pid>/stat field 22 (starttime); null on failure.
 *
 * The field-22 read (including the "comm may contain spaces/parens ⇒ count fields from the LAST ')'
 * rule) is the SHARED session-liveness primitive's job — this function only does the elapsed-time
 * arithmetic around it, so there is one implementation of the parse in the repo.
 */
export function readProcEtimes(pid: number): number | null {
  const stat = readProcStat(pid);
  if (!stat) return null;
  const starttimeTick = Number(stat.starttime);
  if (!Number.isFinite(starttimeTick)) return null;
  try {
    const hertz = 100; // CONFIG_HZ on Linux — good enough for a display value
    const uptime = Number(fs.readFileSync("/proc/uptime", "utf8").split(/\s+/)[0] ?? "0");
    if (!Number.isFinite(uptime)) return null;
    return Math.max(0, Math.floor(uptime - starttimeTick / hertz));
  } catch {
    return null;
  }
}

/**
 * Enumerate ALL claude launch-settings sessions from /proc (or the ORPHAN_SESSION_CHECK_PS_SOURCE file
 * seam in tests). The seam file is one NUL-separated argv per pid: `<pid>\0<argv[0]>\0<argv[1]>\0...\n`.
 */
export function enumerateClaudeProcesses(): ClaudeSessionProc[] {
  const seam = process.env.ORPHAN_SESSION_CHECK_PS_SOURCE;
  const out: ClaudeSessionProc[] = [];
  if (seam) {
    const content = fs.readFileSync(seam, "utf8");
    for (const rawLine of content.split("\n")) {
      if (!rawLine) continue;
      const fields = rawLine.split("\0");
      const pid = Number(fields.shift());
      if (!Number.isFinite(pid)) continue;
      const proc = classifyArgv(fields, pid);
      if (proc) out.push(proc);
    }
    return out;
  }
  let entries: string[];
  try {
    entries = fs.readdirSync("/proc");
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    const pid = Number(e);
    const argv = readProcArgv(pid);
    if (!argv) continue;
    const proc = classifyArgv(argv, pid, readProcEtimes(pid));
    if (proc) out.push(proc);
  }
  return out;
}

function summary(proc: ClaudeSessionProc): string {
  const ws = proc.workspace ?? proc.settingsValue ?? "(none)";
  return `pid=${proc.pid}${proc.etimes !== null ? ` etimes=${proc.etimes}s` : ""} kind=${proc.settingsKind} workspace=${ws} ${proc.argv.slice(0, 4).join(" ")}`;
}

function printHuman(procs: ClaudeSessionProc[]): void {
  if (procs.length === 0) {
    process.stdout.write("orphan-session-check: no claude --settings processes found\n");
    return;
  }
  const cls = classifySessions(procs);
  process.stdout.write(`orphan-session-check: ${cls.total} claude --settings process(es); ` +
    `${cls.orphanCount} orphan(s) (workspace dir gone), ${cls.live.length} live, ` +
    `${cls.inlineJson} inline-json (skipped), ${cls.missing} missing-value (skipped)\n`);
  for (const p of cls.orphans) process.stdout.write(`  ORPHAN ${summary(p)}\n`);
  for (const p of cls.live) process.stdout.write(`  live   ${summary(p)}\n`);
}

function printJson(procs: ClaudeSessionProc[]): number {
  const cls = classifySessions(procs);
  const trim = (p: ClaudeSessionProc) => ({
    pid: p.pid,
    etimes: p.etimes,
    settings: p.settingsValue,
    settingsKind: p.settingsKind,
    workspace: p.workspace,
  });
  const payload = {
    orphan_count: cls.orphanCount,
    total: cls.total,
    path_kind: cls.pathKind,
    inline_json: cls.inlineJson,
    missing: cls.missing,
    orphans: cls.orphans.map(trim),
    live: cls.live.map(trim),
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  return cls.orphanCount > 0 ? 1 : 0;
}

export async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) helpExit("usage: node orphan-session-check.ts [--json] [--kill-workspace <path>] [--list|--dry-run]");
  const procs = enumerateClaudeProcesses();

  if (argv.includes("--json")) {
    return printJson(procs);
  }

  const kwIdx = argv.indexOf("--kill-workspace");
  if (kwIdx !== -1) {
    const workspace = path.resolve(argv[kwIdx + 1] ?? "");
    if (!workspace || workspace === path.resolve("/")) {
      process.stderr.write("orphan-session-check: --kill-workspace requires a non-root workspace path\n");
      return 2;
    }
    const under = sessionsUnderWorkspace(procs, workspace);
    // list-only / dry-run: --list (or --dry-run) prints EXACTLY which sessions would be stopped and
    // kills nothing. This is how the teardown gate logic is verified WITHOUT running a real SIGTERM
    // in the live loop (manager 116a770c: 验证闸门逻辑用 list-only/dry-run). `--list` with no
    // --kill-workspace falls through to the human listing below.
    const dryRun = argv.includes("--list") || argv.includes("--dry-run");
    if (dryRun) {
      process.stdout.write(
        JSON.stringify({ workspace, dryRun: true, found: under.length, killed: 0, sigkilled: 0, failed: 0,
          pids: under.map((p) => p.pid),
          sessions: under.map((p) => ({ pid: p.pid, etimes: p.etimes, settings: p.settingsValue, workspace: p.workspace })) }, null, 2) + "\n",
      );
      return 0;
    }
    const res = killProcs(under.map((p) => p.pid));
    process.stdout.write(
      JSON.stringify({ workspace, dryRun: false, found: under.length, killed: res.killed, sigkilled: res.sigkilled, failed: res.failed,
        pids: under.map((p) => p.pid) }, null, 2) + "\n",
    );
    return 0;
  }

  printHuman(procs);
  return 0;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(`orphan-session-check: ${err instanceof Error ? err.stack : String(err)}\n`);
      process.exitCode = 2;
    },
  );
}
