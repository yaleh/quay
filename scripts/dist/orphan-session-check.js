#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/orphan-session-check.ts
import fs3 from "node:fs";
import path2 from "node:path";
import { fileURLToPath } from "node:url";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
function helpExit(usage) {
  process.stdout.write(usage.endsWith("\n") ? usage : usage + "\n");
  process.exit(0);
}

// packages/quay/src/kernel/proc-identity.ts
import fs from "node:fs";
import path from "node:path";
var defaultReader = (p) => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
};
function procCmdlinePath(pid, procRoot) {
  return path.join(procRoot, String(pid), "cmdline");
}
function readProcCmdline(pid, procRoot = "/proc", reader = defaultReader) {
  const raw = readRaw(pid, procRoot, reader);
  if (!raw) return null;
  const parts = raw.split("\0");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts.length > 0 ? parts : null;
}
function readRaw(pid, procRoot, reader) {
  try {
    return reader(procCmdlinePath(pid, procRoot));
  } catch {
    return null;
  }
}

// packages/quay/src/primitives/session-liveness.mjs
import fs2 from "node:fs";
function readProcStat(pid) {
  try {
    const raw = fs2.readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeIdx = raw.lastIndexOf(")");
    if (closeIdx === -1) return null;
    const rest = raw.slice(closeIdx + 2).trim().split(/\s+/);
    const starttime = rest[19];
    return starttime !== void 0 ? { starttime } : null;
  } catch {
    return null;
  }
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/process-kill-lib.ts
function killProcs(pids, graceMs = 3e3) {
  let killed = 0;
  let sigkilled = 0;
  let failed = 0;
  if (pids.length === 0) return { killed, sigkilled, failed };
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      continue;
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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/orphan-session-check.ts
function classifyArgv(argv, pid, etimes = null) {
  if (!Array.isArray(argv) || argv.length === 0) return null;
  const argv0 = argv[0] ?? "";
  const argv0Base = path2.basename(argv0);
  if (argv0Base !== "claude") return null;
  const flagIdx = argv.indexOf("--settings");
  if (flagIdx === -1) return null;
  const settingsValue = argv[flagIdx + 1] ?? null;
  if (settingsValue === null || settingsValue.length === 0) {
    return { pid, etimes, argv, settingsValue: null, settingsKind: "missing", workspace: null };
  }
  const inlineJson = settingsValue.trimStart().startsWith("{");
  const kind = inlineJson ? "inline-json" : "path";
  const workspace = kind === "path" ? workspaceRootOf(settingsValue) : null;
  return { pid, etimes, argv, settingsValue, settingsKind: kind, workspace };
}
function workspaceRootOf(settingsPath) {
  const dir = path2.resolve(path2.dirname(settingsPath));
  if (path2.basename(dir) === ".claude") return path2.resolve(dir, "..");
  return dir;
}
function isOrphan(proc) {
  return proc.settingsKind === "path" && proc.workspace !== null && !fs3.existsSync(proc.workspace);
}
function classifySessions(procs) {
  const orphans = [];
  const live = [];
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
function sessionsUnderWorkspace(procs, workspace) {
  const ws = path2.resolve(workspace);
  return procs.filter((p) => p.workspace !== null && (p.workspace === ws || p.workspace.startsWith(ws + path2.sep)));
}
function readProcArgv(pid) {
  const argv = readProcCmdline(pid);
  return argv === null ? null : argv.filter((s) => s.length > 0);
}
function readProcEtimes(pid) {
  const stat = readProcStat(pid);
  if (!stat) return null;
  const starttimeTick = Number(stat.starttime);
  if (!Number.isFinite(starttimeTick)) return null;
  try {
    const hertz = 100;
    const uptime = Number(fs3.readFileSync("/proc/uptime", "utf8").split(/\s+/)[0] ?? "0");
    if (!Number.isFinite(uptime)) return null;
    return Math.max(0, Math.floor(uptime - starttimeTick / hertz));
  } catch {
    return null;
  }
}
function enumerateClaudeProcesses() {
  const seam = process.env.ORPHAN_SESSION_CHECK_PS_SOURCE;
  const out = [];
  if (seam) {
    const content = fs3.readFileSync(seam, "utf8");
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
  let entries;
  try {
    entries = fs3.readdirSync("/proc");
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
function summary(proc) {
  const ws = proc.workspace ?? proc.settingsValue ?? "(none)";
  return `pid=${proc.pid}${proc.etimes !== null ? ` etimes=${proc.etimes}s` : ""} kind=${proc.settingsKind} workspace=${ws} ${proc.argv.slice(0, 4).join(" ")}`;
}
function printHuman(procs) {
  if (procs.length === 0) {
    process.stdout.write("orphan-session-check: no claude --settings processes found\n");
    return;
  }
  const cls = classifySessions(procs);
  process.stdout.write(`orphan-session-check: ${cls.total} claude --settings process(es); ${cls.orphanCount} orphan(s) (workspace dir gone), ${cls.live.length} live, ${cls.inlineJson} inline-json (skipped), ${cls.missing} missing-value (skipped)
`);
  for (const p of cls.orphans) process.stdout.write(`  ORPHAN ${summary(p)}
`);
  for (const p of cls.live) process.stdout.write(`  live   ${summary(p)}
`);
}
function printJson(procs) {
  const cls = classifySessions(procs);
  const trim = (p) => ({
    pid: p.pid,
    etimes: p.etimes,
    settings: p.settingsValue,
    settingsKind: p.settingsKind,
    workspace: p.workspace
  });
  const payload = {
    orphan_count: cls.orphanCount,
    total: cls.total,
    path_kind: cls.pathKind,
    inline_json: cls.inlineJson,
    missing: cls.missing,
    orphans: cls.orphans.map(trim),
    live: cls.live.map(trim)
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}
`);
  return cls.orphanCount > 0 ? 1 : 0;
}
async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) helpExit("usage: node orphan-session-check.ts [--json] [--kill-workspace <path>] [--list|--dry-run]");
  const procs = enumerateClaudeProcesses();
  if (argv.includes("--json")) {
    return printJson(procs);
  }
  const kwIdx = argv.indexOf("--kill-workspace");
  if (kwIdx !== -1) {
    const workspace = path2.resolve(argv[kwIdx + 1] ?? "");
    if (!workspace || workspace === path2.resolve("/")) {
      process.stderr.write("orphan-session-check: --kill-workspace requires a non-root workspace path\n");
      return 2;
    }
    const under = sessionsUnderWorkspace(procs, workspace);
    const dryRun = argv.includes("--list") || argv.includes("--dry-run");
    if (dryRun) {
      process.stdout.write(
        JSON.stringify({
          workspace,
          dryRun: true,
          found: under.length,
          killed: 0,
          sigkilled: 0,
          failed: 0,
          pids: under.map((p) => p.pid),
          sessions: under.map((p) => ({ pid: p.pid, etimes: p.etimes, settings: p.settingsValue, workspace: p.workspace }))
        }, null, 2) + "\n"
      );
      return 0;
    }
    const res = killProcs(under.map((p) => p.pid));
    process.stdout.write(
      JSON.stringify({
        workspace,
        dryRun: false,
        found: under.length,
        killed: res.killed,
        sigkilled: res.sigkilled,
        failed: res.failed,
        pids: under.map((p) => p.pid)
      }, null, 2) + "\n"
    );
    return 0;
  }
  printHuman(procs);
  return 0;
}
var isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path2.resolve(process.argv[1]);
if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(`orphan-session-check: ${err instanceof Error ? err.stack : String(err)}
`);
      process.exitCode = 2;
    }
  );
}
export {
  classifyArgv,
  classifySessions,
  enumerateClaudeProcesses,
  isOrphan,
  killProcs,
  main,
  readProcArgv,
  readProcEtimes,
  sessionsUnderWorkspace,
  workspaceRootOf
};
