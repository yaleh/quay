#!/usr/bin/env node
// plugin/scripts/manager-tick-readings.ts — 管理者 tick 的机械读数（单命令产出）
//
// tasks/gap-manager-tick-mechanical-checks-are-eight-loose-bash-blocks-in-prose.md: 并入 quay-session 入口
//   （node --experimental-strip-types plugin/scripts/quay-session.ts manager-tick-readings），把 tick 散文里
//   的 8 个散落 bash 块（orchestration/manager-loop-tick.md §1.a/§1.b/§1.4）收成一条命令。AC1。
//
// 契约：
//   - tmux 纯只读：只用 `list-panes`（含 -a 全量枚举）；零破坏性 tmux 子命令（kill 族一律不用）。AC2。
//   - 身份判据：`pane_pid` + `pane_current_command`（cmd=claude 才算认出会话）；不用 pgrep 的 `-P` 子进程寻址。AC4。
//   - 监视器实例枚举按 argv[0..1]（argv[1] basename == session-liveness.sh），不 grep 整条 cmdline
//     （§1.4c 自匹配教训；monitor-mount-check.sh 同一谓词）。
//   - 输出固定结构、逐行带标签：人为跳过一项 ⇒ 该标签行缺失，可被机械检出，不是静默少几行。AC3。
//
// 用法:
//   node --experimental-strip-types plugin/scripts/quay-session.ts manager-tick-readings
//   node --experimental-strip-types plugin/scripts/manager-tick-readings.ts        # 等价直接运行
//
// 测试/环境接缝（生产调用不设 → 行为不变）:
//   MTR_PROJECTS           项目表 name=dir 空格分隔（默认 quay/archguard/meta-cc 于 /home/yale/work）
//   MTR_TMUX_LIST_PANES    直接给定 `list-panes -a` 输出（tmux 只读接缝，测试用）
//   MTR_ENTRY_LAST_COMMIT  直接给定 quay-session.ts 最后改动 epoch（git 接缝，测试用）
//   TMUX_TMPDIR            tmux socket 覆盖（同 session-liveness.sh 的测试机制）

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";

export const NAME = "manager-tick-readings";
export const TMUX_LIST_PANES_SEAM = "MTR_TMUX_LIST_PANES";
export const ENTRY_LAST_COMMIT_SEAM = "MTR_ENTRY_LAST_COMMIT";
export const PROJECTS_SEAM = "MTR_PROJECTS";
export const HZ = 100; // Linux USER_HZ（/proc/<pid>/stat starttime 的 tick 速率）

export interface Project {
  name: string;
  dir: string;
}

export const DEFAULT_PROJECTS: Project[] = [
  { name: "quay", dir: "/home/yale/work/quay" },
  { name: "archguard", dir: "/home/yale/work/archguard" },
  { name: "meta-cc", dir: "/home/yale/work/meta-cc" },
];

export function parseProjects(env: NodeJS.ProcessEnv = process.env): Project[] {
  const raw = env[PROJECTS_SEAM];
  if (!raw || !raw.trim()) return DEFAULT_PROJECTS;
  return raw.trim().split(/\s+/).map((pair) => {
    const eq = pair.indexOf("=");
    if (eq < 0) return { name: pair, dir: "" };
    return { name: pair.slice(0, eq), dir: pair.slice(eq + 1) };
  });
}

export function defaultTmuxSocket(env: NodeJS.ProcessEnv = process.env): string {
  const uid = typeof process.getuid === "function" ? String(process.getuid()) : "";
  const tmp = env.TMUX_TMPDIR || env.TMPDIR || "/tmp";
  return path.join(tmp, `tmux-${uid}`, "default");
}

export interface PaneInfo {
  session: string;
  window: string;
  panePid: string;
  cmd: string;
}

/** 只读 tmux：`env -u TMUX tmux -S <socket> list-panes -a`（读真实默认服务端，同 session-liveness.sh AC3）。 */
export function tmuxListPanes(socket: string, env: NodeJS.ProcessEnv = process.env): PaneInfo[] {
  const seam = env[TMUX_LIST_PANES_SEAM];
  const raw = seam !== undefined ? seam : runTmuxListPanes(socket, env);
  if (!raw) return [];
  return raw.split("\n").filter(Boolean).map((line) => {
    const [sw, panePid, cmd] = line.split("\t");
    const colon = sw.lastIndexOf(":");
    return {
      session: colon >= 0 ? sw.slice(0, colon) : sw,
      window: colon >= 0 ? sw.slice(colon + 1) : "",
      panePid: panePid ?? "",
      cmd: cmd ?? "",
    };
  });
}

function runTmuxListPanes(socket: string, env: NodeJS.ProcessEnv): string {
  const res = spawnSync(
    "env",
    ["-u", "TMUX", "tmux", "-S", socket, "list-panes", "-a", "-F", "#{session_name}:#{window_name}\t#{pane_pid}\t#{pane_current_command}"],
    { encoding: "utf8", env },
  );
  if (res.status !== 0) return "";
  return res.stdout || "";
}

export function projectStatus(project: Project): string {
  if (!project.dir) return "no-dir";
  const halt = path.join(project.dir, ".halt");
  if (fs.existsSync(halt)) {
    const first = (fs.readFileSync(halt, "utf8").split("\n")[0] || "").trim();
    return first ? `paused: ${first.slice(0, 60)}` : "paused";
  }
  return "running";
}

export interface ResourceReadings {
  cpuSomeAvg10: string;
  load1: string;
  nodeCount: number;
  memAvailMb: number;
}

export function resourceReadings(procRoot = "/proc", selfPid = process.pid): ResourceReadings {
  let cpuSomeAvg10 = "";
  try {
    const s = fs.readFileSync(path.join(procRoot, "pressure", "cpu"), "utf8");
    const m = s.match(/some\s+avg10=([0-9.]+)/);
    if (m) cpuSomeAvg10 = m[1];
  } catch {
    cpuSomeAvg10 = "";
  }

  let load1 = "";
  try {
    load1 = fs.readFileSync(path.join(procRoot, "loadavg"), "utf8").trim().split(/\s+/)[0] || "";
  } catch {
    load1 = "";
  }

  let nodeCount = 0;
  try {
    const self = String(selfPid);
    for (const d of fs.readdirSync(procRoot)) {
      if (!/^\d+$/.test(d) || d === self) continue;
      try {
        // 与 `pgrep -c node` 同语义：comm 是正则匹配（node 进程 comm=node-MainThread），排除自身。
        const comm = fs.readFileSync(path.join(procRoot, d, "comm"), "utf8").trim();
        if (/node/.test(comm)) nodeCount++;
      } catch {
        /* 进程已退出，跳过 */
      }
    }
  } catch {
    nodeCount = 0;
  }

  let memAvailMb = 0;
  try {
    const s = fs.readFileSync(path.join(procRoot, "meminfo"), "utf8");
    const m = s.match(/MemAvailable:\s+(\d+) kB/);
    if (m) memAvailMb = Math.round(Number(m[1]) / 1024);
  } catch {
    memAvailMb = 0;
  }

  return { cpuSomeAvg10, load1, nodeCount, memAvailMb };
}

export interface OuterReading {
  project: string;
  target: string;
  exists: boolean;
  panePid: string;
  cmd: string;
}

/** 按窗口名寻址（会话前缀匹配 + 窗口名 == outer），不按 pane 索引（索引会漂，§1.b 已成文）。 */
export function outerReadings(projects: Project[], panes: PaneInfo[]): OuterReading[] {
  const readings: OuterReading[] = [];
  for (const p of projects) {
    const matches = panes.filter(
      (pn) => pn.window === "outer" && (pn.session === p.name || pn.session.startsWith(`${p.name}-`)),
    );
    if (matches.length === 0) {
      readings.push({ project: p.name, target: `${p.name}:outer`, exists: false, panePid: "", cmd: "" });
    } else {
      for (const m of matches) {
        readings.push({ project: p.name, target: `${m.session}:${m.window}`, exists: true, panePid: m.panePid, cmd: m.cmd });
      }
    }
  }
  return readings;
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 3)}...`;
}

/** 各外层最新的那一行 tick 日志。
 *  格式一（quay/meta-cc）：`| 2026-...`，最新在最前 → 取第一个匹配行。
 *  格式二（archguard）：表格行 `| N | 时刻 | ...`，最新在最后 → 取最后一个匹配行。
 *  （散文里的 `grep -m1 '^| 2026'` 只认格式一，对 archguard 恒零命中 —— §4「零命中当没发生」的实例。） */
export function latestTickLog(project: Project, maxLen = 200): string {
  if (!project.dir) return "no-dir";
  const p = path.join(project.dir, "orchestration", "tick-log.md");
  if (!fs.existsSync(p)) return "no-tick-log";
  const text = fs.readFileSync(p, "utf8");
  const dated = text.match(/^\| 2026[^\n]*/m);
  if (dated) return truncate(dated[0], maxLen);
  const tableRows = text.match(/^\|\s*\d+\s*\|[^\n]*/gm) || [];
  if (tableRows.length > 0) return truncate(tableRows[tableRows.length - 1], maxLen);
  return "no-tick-row";
}

export interface StatInfo {
  ppid: number;
  startEpoch: number;
}

/** 读 /proc/<pid>/stat：ppid（字段 4）与 starttime（字段 22）→ epoch。 */
export function readStat(pid: number, procRoot = "/proc"): StatInfo {
  let stat = "";
  try {
    stat = fs.readFileSync(path.join(procRoot, String(pid), "stat"), "utf8");
  } catch {
    return { ppid: 0, startEpoch: 0 };
  }
  const close = stat.lastIndexOf(")");
  const rest = close >= 0 ? stat.slice(close + 1).trim().split(/\s+/) : [];
  const ppid = Number(rest[1] ?? 0);
  const startTicks = Number(rest[19] ?? 0);
  return { ppid, startEpoch: startTicksToEpoch(startTicks, procRoot) };
}

export function startTicksToEpoch(startTicks: number, procRoot = "/proc"): number {
  if (!startTicks) return 0;
  let btime = 0;
  try {
    const s = fs.readFileSync(path.join(procRoot, "stat"), "utf8");
    const m = s.match(/^btime\s+(\d+)/m);
    if (m) btime = Number(m[1]);
  } catch {
    btime = 0;
  }
  return btime + Math.floor(startTicks / HZ);
}

export function readCmdline(pid: number, procRoot = "/proc"): string[] {
  try {
    const buf = fs.readFileSync(path.join(procRoot, String(pid), "cmdline"));
    return buf.toString("utf8").split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

export interface MonitorInstance {
  pid: number;
  ppid: number;
  startEpoch: number;
  stale: boolean;
}

/** 枚举 session-liveness 监视器实例：argv[0]=bash 且 argv[1] basename == session-liveness.sh。 */
export function monitorInstances(entryLastCommit: number, procRoot = "/proc"): MonitorInstance[] {
  const out: MonitorInstance[] = [];
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(procRoot);
  } catch {
    return out;
  }
  for (const d of entries) {
    if (!/^\d+$/.test(d)) continue;
    const pid = Number(d);
    const argv = readCmdline(pid, procRoot);
    if (argv.length < 2 || argv[0] !== "bash") continue;
    if (path.basename(argv[1]) !== "session-liveness.sh") continue;
    const { ppid, startEpoch } = readStat(pid, procRoot);
    out.push({
      pid,
      ppid,
      startEpoch,
      stale: entryLastCommit > 0 && startEpoch > 0 && entryLastCommit > startEpoch,
    });
  }
  out.sort((a, b) => a.pid - b.pid);
  return out;
}

/** quay-session.ts 最后一次改动（§1.4 的「我跑的是不是旧版」的入口面信号）。 */
export function entryLastCommitEpoch(repoRoot: string, env: NodeJS.ProcessEnv = process.env): number {
  const seam = env[ENTRY_LAST_COMMIT_SEAM];
  if (seam !== undefined) {
    const n = Number(seam);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  const res = spawnSync(
    "git",
    ["log", "-1", "--format=%ct", "--", "plugin/scripts/quay-session.ts"],
    { cwd: repoRoot, encoding: "utf8", env },
  );
  const n = Number((res.stdout || "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export interface GoalReading {
  total: number;
  checked: number;
  file: string;
}

/** §0.5 目标复核的机械读数：manager-phase-goal.md 里 AC 勾选计数。 */
export function goalReading(repoRoot: string): GoalReading {
  const p = path.join(repoRoot, "orchestration", "manager-phase-goal.md");
  if (!fs.existsSync(p)) return { total: 0, checked: 0, file: "no-manager-phase-goal.md" };
  const text = fs.readFileSync(p, "utf8");
  const total = (text.match(/- \[[ xX]\]/g) || []).length;
  const checked = (text.match(/- \[[xX]\]/g) || []).length;
  return { total, checked, file: p };
}

export interface RenderOpts {
  socket: string;
  repoRoot: string;
  procRoot?: string;
  env?: NodeJS.ProcessEnv;
}

export function render(projects: Project[], opts: RenderOpts): string {
  const env = opts.env ?? process.env;
  const procRoot = opts.procRoot ?? "/proc";
  const panes = tmuxListPanes(opts.socket, env);
  const resources = resourceReadings(procRoot);
  const outer = outerReadings(projects, panes);
  const entryCommit = entryLastCommitEpoch(opts.repoRoot, env);
  const monitors = monitorInstances(entryCommit, procRoot);
  const goal = goalReading(opts.repoRoot);

  const lines: string[] = [];
  lines.push(`manager-tick-readings ts=${Date.now()}`);
  for (const p of projects) lines.push(`project.status ${p.name} ${projectStatus(p)}`);
  lines.push(`resource.cpu_some_avg10 ${resources.cpuSomeAvg10 || "unmeasurable"}`);
  lines.push(`resource.load1 ${resources.load1 || "unmeasurable"}`);
  lines.push(`resource.node_count ${resources.nodeCount}`);
  lines.push(`resource.mem_available_mb ${resources.memAvailMb}`);
  for (const o of outer) {
    if (o.exists) lines.push(`outer.liveness ${o.target} pane_pid=${o.panePid} cmd=${o.cmd}`);
    else lines.push(`outer.liveness ${o.target} window-missing`);
  }
  for (const p of projects) lines.push(`outer.ticklog ${p.name} ${latestTickLog(p)}`);
  lines.push(`goal.phase_ac_checked ${goal.checked}/${goal.total} ${goal.file}`);
  lines.push(`monitor.mounted ${monitors.length > 0}`);
  lines.push(`monitor.instances ${monitors.length}`);
  lines.push(`monitor.entry_last_commit ${entryCommit || "unknown"}`);
  for (const m of monitors) {
    const iso = m.startEpoch ? new Date(m.startEpoch * 1000).toISOString() : "unknown";
    lines.push(`monitor.instance ${m.pid} start=${m.startEpoch}(${iso}) ppid=${m.ppid} stale=${m.stale}`);
  }
  return `${lines.join("\n")}\n`;
}

export function main(argv: string[], opts?: { env?: NodeJS.ProcessEnv }): number {
  const env = opts?.env ?? process.env;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "..", "..");
  const projects = parseProjects(env);
  const socket = defaultTmuxSocket(env);
  process.stdout.write(render(projects, { socket, repoRoot, env }));
  return 0;
}

if (isDirectEntry(import.meta)) {
  process.exitCode = main(process.argv);
}
