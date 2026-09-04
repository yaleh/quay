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
//   - 输出固定结构、逐行带标签：人为跳过一项 ⇒ 该标签行缺失，可被机械检出，不是静默少几行。AC3。
//
// 用法:
//   node --experimental-strip-types plugin/scripts/quay-session.ts manager-tick-readings
//   node --experimental-strip-types plugin/scripts/manager-tick-readings.ts        # 等价直接运行
//
// 测试/环境接缝（生产调用不设 → 行为不变）:
//   MTR_PROJECTS           项目表 name=dir 空格分隔（默认 quay/archguard/meta-cc 于 /home/yale/work）
//   MTR_TMUX_LIST_PANES    直接给定 `list-panes -a` 输出（tmux 只读接缝，测试用）
//   TMUX_TMPDIR            tmux socket 覆盖（同 tmux 只读的测试机制）

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";

export const NAME = "manager-tick-readings";
export const TMUX_LIST_PANES_SEAM = "MTR_TMUX_LIST_PANES";
export const PROJECTS_SEAM = "MTR_PROJECTS";

export interface Project {
  name: string;
  dir: string;
  /** 配置的 tmux 会话名。为空时回退 `name` / `name-*` 前缀推导（本地项目）。
   *  archguard 真名 `archguard-0` 且在 ad-arm1（跨主机）——从配置取，不硬编码推导
   *  （gap-manager-tick-readings-stale-readings 缺陷②）。 */
  session?: string;
  /** 跨主机 fqdn（空 = 本机）。跨主机 liveness 走 supervisor-deliver.sh 的 `<host>:<target>` 形态
   *  （a15dc33c；supervisor-deliver.sh 交叉标注）。 */
  host?: string;
}

export const DEFAULT_PROJECTS: Project[] = [
  { name: "quay", dir: "/home/yale/work/quay" },
  { name: "archguard", dir: "/home/yale/work/archguard", session: "archguard-0", host: "ad-arm1.wan.hwang.men" },
  { name: "meta-cc", dir: "/home/yale/work/meta-cc" },
];

export function parseProjects(env: NodeJS.ProcessEnv = process.env): Project[] {
  const raw = env[PROJECTS_SEAM];
  if (!raw || !raw.trim()) return DEFAULT_PROJECTS;
  return raw.trim().split(/\s+/).map((pair) => {
    const eq = pair.indexOf("=");
    if (eq < 0) return { name: pair, dir: "" };
    const name = pair.slice(0, eq);
    const [dir, session, host] = pair.slice(eq + 1).split(":");
    const project: Project = { name, dir: dir ?? "" };
    if (session) project.session = session;
    if (host) project.host = host;
    return project;
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

export const PANE_FMT = "#{session_name}:#{window_name}\t#{pane_pid}\t#{pane_current_command}";
/** 跨主机 tmux 只读接缝（测试模拟 `ssh <host> tmux list-panes` 输出，不经网络）。 */
export const REMOTE_TMUX_LIST_PANES_SEAM = "MTR_REMOTE_TMUX_LIST_PANES";
/** ssh 二进制接缝（测试 mock 替换；同 supervisor-deliver.sh 的 SUPERVISOR_DELIVER_SSH 机制）。 */
export const SSH_SEAM = "MTR_SSH";

/** 共享的 pane 行解析：`<session>:<window>\t<pane_pid>\t<pane_current_command>`。 */
export function parsePanes(raw: string): PaneInfo[] {
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

/** 只读 tmux：`env -u TMUX tmux -S <socket> list-panes -a`（读真实默认服务端）。 */
export function tmuxListPanes(socket: string, env: NodeJS.ProcessEnv = process.env): PaneInfo[] {
  const seam = env[TMUX_LIST_PANES_SEAM];
  const raw = seam !== undefined ? seam : runTmuxListPanes(socket, env);
  return parsePanes(raw);
}

/** 跨主机只读 tmux：`ssh <host> tmux list-panes -a -F ...`（supervisor-deliver.sh 的
 *  `<host>:<target>` 形态——同一跨主机寻址约定，a15dc33c 落地）。失败/不可达 ⇒ 空（window-missing，fail-safe）。 */
export function remoteTmuxListPanes(host: string, env: NodeJS.ProcessEnv = process.env): PaneInfo[] {
  const seam = env[REMOTE_TMUX_LIST_PANES_SEAM];
  const raw = seam !== undefined ? seam : runRemoteTmuxListPanes(host, env);
  return parsePanes(raw);
}

function runRemoteTmuxListPanes(host: string, env: NodeJS.ProcessEnv): string {
  const ssh = env[SSH_SEAM] || "ssh";
  // 远端命令整体作为 ssh 的单个参数（ssh 会吞 -F 当自己的 config 选项——必须整体引号，同
  // supervisor-deliver.sh 的 `printf %q` 处理）。tmux -F 不解释 `\t`，故制表符用 bash `$'\t'`
  // ANSI-C 引用在远端展开成真 tab（远端 shell 为 bash）。
  const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const fmt = PANE_FMT.split("\t").map(sq).join("$'\\t'");
  const res = spawnSync(ssh, [host, `tmux list-panes -a -F ${fmt}`], { encoding: "utf8", env });
  if (res.status !== 0) return "";
  return res.stdout || "";
}

function runTmuxListPanes(socket: string, env: NodeJS.ProcessEnv): string {
  const res = spawnSync(
    "env",
    ["-u", "TMUX", "tmux", "-S", socket, "list-panes", "-a", "-F", PANE_FMT],
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
  /** comm 字面量精确计数（`node-MainThread`）——双读互校的交叉侧，不是主读数。 */
  nodeCommLiteral: number;
  /** 双读互校：comm 字面量恒 0 而 cmdline 见 node 进程 ⇒ 报【仪器故障】（读法坏，非机器空闲）。 */
  nodeInstrumentFailure: boolean;
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

  // AC1b (gap-manager-tick-readings-constant-zero-instruments)：node 进程数 = cmdline 枚举
  // （host 无关——comm 字面量读法在本机 Node v24 上恒零，0 vs 真实 50），
  // 交叉侧 = comm 字面量精确计数（双读互校：comm 恒 0 而 cmdline 见 node ⇒ 报【仪器故障】）。
  const nodeCount = listNodePids(procRoot, selfPid).length;
  const nodeCommLiteral = countNodeCommLiteral(procRoot, selfPid);
  const nodeInstrumentFailure = nodeCommLiteral === 0 && nodeCount > 0;

  let memAvailMb = 0;
  try {
    const s = fs.readFileSync(path.join(procRoot, "meminfo"), "utf8");
    const m = s.match(/MemAvailable:\s+(\d+) kB/);
    if (m) memAvailMb = Math.round(Number(m[1]) / 1024);
  } catch {
    memAvailMb = 0;
  }

  return { cpuSomeAvg10, load1, nodeCount, nodeCommLiteral, nodeInstrumentFailure, memAvailMb };
}

/** 枚举 node 进程 pid：cmdline argv[0] == "node" 或路径以 /node 结尾（host 无关）。
 *  (gap-manager-tick-readings-constant-zero-instruments) 与 resource-gate.sh 的 list_node_cmdline
 *  同形态——/proc/<pid>/comm 字面量是宿主/Node 版本相关的（boheidc Node v24 comm=`MainThread`），
 *  cmdline argv[0] 才是 node 二进制（node / 路径以 /node 结尾），跨宿主稳定。排除自身 pid。 */
export function listNodePids(procRoot = "/proc", selfPid = process.pid): number[] {
  const pids: number[] = [];
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(procRoot);
  } catch {
    return pids;
  }
  for (const d of entries) {
    if (!/^\d+$/.test(d) || Number(d) === selfPid) continue;
    const exe = readCmdline(Number(d), procRoot)[0] ?? "";
    if (exe === "node" || exe.endsWith("/node")) pids.push(Number(d));
  }
  return pids;
}

/** comm 字面量精确计数（`node-MainThread`，旧宿主 Node comm）——仅作双读互校的交叉侧，不是主读数。
 *  boheidc Node v24 comm=`MainThread` ⇒ 恒 0 而 cmdline 见 node 进程 ⇒ 报【仪器故障】。
 *  与 resource-gate.sh 的 count_comm_node_mainthread 同形态（读关系，不读硬编码「正确」字面量）。 */
export function countNodeCommLiteral(procRoot = "/proc", selfPid = process.pid): number {
  let count = 0;
  try {
    const self = String(selfPid);
    for (const d of fs.readdirSync(procRoot)) {
      if (!/^\d+$/.test(d) || d === self) continue;
      try {
        const comm = fs.readFileSync(path.join(procRoot, d, "comm"), "utf8").trim();
        if (comm === "node-MainThread") count++;
      } catch {
        /* 进程已退出，跳过 */
      }
    }
  } catch {
    count = 0;
  }
  return count;
}

export interface OuterReading {
  project: string;
  target: string;
  exists: boolean;
  panePid: string;
  cmd: string;
  host: string;
  session: string;
}

/** 按窗口名寻址（窗口名 == outer），不按 pane 索引（索引会漂，§1.b 已成文）。
 *  `panes` 可以是 pane 数组（所有项目同一来源，向后兼容）或按项目解析的函数——
 *  跨主机项目（`p.host` 非空）经 `remoteTmuxListPanes` 查远端 tmux，会话名取 `p.session`（配置），
 *  不硬编码推导（缺陷②）。 */
export function outerReadings(projects: Project[], panes: PaneInfo[] | ((p: Project) => PaneInfo[])): OuterReading[] {
  const listPanes = typeof panes === "function" ? panes : () => panes;
  const readings: OuterReading[] = [];
  for (const p of projects) {
    const sessionName = p.session ?? p.name;
    const matches = listPanes(p).filter(
      (pn) => pn.window === "outer" &&
        (pn.session === sessionName || (p.session == null && pn.session.startsWith(`${p.name}-`))),
    );
    if (matches.length === 0) {
      readings.push({ project: p.name, target: `${p.name}:outer`, exists: false, panePid: "", cmd: "", host: p.host ?? "", session: sessionName });
    } else {
      for (const m of matches) {
        readings.push({ project: p.name, target: `${m.session}:${m.window}`, exists: true, panePid: m.panePid, cmd: m.cmd, host: p.host ?? "", session: sessionName });
      }
    }
  }
  return readings;
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 3)}...`;
}

/** 各外层最新的那一行 tick 日志（多时代解析，缺陷①修复）。
 *
 *  四个时代/格式：
 *    1. 旧倒序 dated（quay/meta-cc）：`| 2026-08-09 10:04Z | ...`，最新在最前，386→463 条；
 *    2. 新追加顺序（inner 节 / blockquote）：`## 2026-08-12 03:2xZ tick — ...` / `> **01:3xZ ...**`，
 *       按追加顺序无（或部分有）日期；
 *    3. archguard 式：`| N | HH:MMZ | ...`，最新在最后；
 *    4. quay 当前 dash tick：`- \`04:09Z\` \`unblock\` — …`（追加顺序，无日期，AC2 修复——修复前
 *       四谓词全不命中 ⇒ 恒 no-tick-row，真文件 348 行/291 tick 行读成零）。
 *  全局最新：dated 行取最大 epoch（跨时代可比）；无日期行按位置（append-only 顺序）取最后，
 *  若其位置晚于最新 dated 行则它是更新的追加内容。无日期且无 mtime 锚定 ⇒ 显式 `stale-unknown`
 *  （不再返回「看似正常」的旧行——调用方无从分辨「外层面多天没 tick」与「读数解析不到」）。 */
export type TickFreshness = "dated" | "positional" | "unknown" | "none";

export interface TickLogReading {
  row: string;
  freshness: TickFreshness;
  dateEpoch?: number;
}

const DATED_RE = /^(?:\|\s*|#{1,3}\s*|>\s*\*\*\s*|-\s*`)(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{1,2})/;
const UNDATED_QUOTE_RE = /^>\s*\*\*\s*\d{1,2}:\d{1,2}/;
const UNDATED_HEADER_RE = /^#{1,3}\s*\d{1,2}:\d{1,2}/;
const UNDATED_TABLE_RE = /^\|\s*\d+\s*\|/;
// quay 当前 tick-log 行形：`- \`04:09Z\` \`unblock\` — …`（追加顺序，无日期）。
// (gap-manager-tick-readings-constant-zero-instruments AC2) 修复前四谓词全不命中 ⇒ 恒 no-tick-row。
const UNDATED_DASH_RE = /^-\s*`\d{1,2}:\d{1,2}/;

function datedEpoch(m: RegExpMatchArray): number {
  // 分钟可能被外层匿名化（`03:2xZ`）——按已给数字解析，同日同小时不影响「哪个最新」的跨日比较。
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) / 1000;
}

export function latestTickLogReading(project: Project, opts?: { mtimeEpoch?: number }): TickLogReading {
  if (!project.dir) return { row: "no-dir", freshness: "none" };
  const p = path.join(project.dir, "orchestration", "tick-log.md");
  if (!fs.existsSync(p)) return { row: "no-tick-log", freshness: "none" };
  const text = fs.readFileSync(p, "utf8");
  const lines = text.split("\n");

  let mtimeEpoch = opts?.mtimeEpoch;
  if (mtimeEpoch === undefined) {
    try { mtimeEpoch = Math.floor(fs.statSync(p).mtimeMs / 1000); } catch { mtimeEpoch = 0; }
  }

  let bestDated: { epoch: number; row: string; pos: number } | null = null;
  let bestUndated: { row: string; pos: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dm = line.match(DATED_RE);
    if (dm) {
      const epoch = datedEpoch(dm);
      if (!bestDated || epoch > bestDated.epoch || (epoch === bestDated.epoch && i > bestDated.pos)) {
        bestDated = { epoch, row: line, pos: i };
      }
      continue;
    }
    if (UNDATED_QUOTE_RE.test(line) || UNDATED_HEADER_RE.test(line) || UNDATED_TABLE_RE.test(line) || UNDATED_DASH_RE.test(line)) {
      if (!bestUndated || i > bestUndated.pos) bestUndated = { row: line, pos: i };
    }
  }

  if (!bestDated && !bestUndated) return { row: "no-tick-row", freshness: "none" };

  // 全局最新：dated 取最大 epoch（覆盖旧倒序表与新 ## 节）；无日期行按位置（append-only）。
  // 若无日期行的位置晚于最新 dated 行 ⇒ 它是之后追加的内容（更可能更新），取它但标注 freshness=positional。
  if (bestDated && (!bestUndated || bestDated.pos >= bestUndated.pos)) {
    return { row: bestDated.row, freshness: "dated", dateEpoch: bestDated.epoch };
  }
  // 无日期行是全局最新：回退到文件 mtime 锚定（mtime 可得 ⇒ positional；不可得 ⇒ 显式 stale-unknown）。
  if (bestUndated && (mtimeEpoch ?? 0) > 0) {
    return { row: bestUndated.row, freshness: "positional" };
  }
  return { row: "stale-unknown", freshness: "unknown" };
}

/** 字符串形态（向后兼容）：返回最新行（截断）或显式哨兵。`opts.mtimeEpoch` 供测试注入 mtime。
 * ⚠️ 2026-08-15 A0 截断缺陷（manager ③ 立案）：默认 maxLen=200 会把 outer tick-log 行（实测 500-1000+ 字符）
 * 截断到 A11 之前，判准⑥′ 无法判 outer tick 完整性。A0 feed 走 `full:true`（完整行）；显式传 maxLen
 * 仍是截断语义（测试/其它消费者向后兼容）。 */
export function latestTickLog(project: Project, maxLen = 200, opts?: { mtimeEpoch?: number; full?: boolean }): string {
  const r = latestTickLogReading(project, opts);
  if (r.freshness === "none" || r.freshness === "unknown") return r.row;
  if (opts?.full) return r.row;
  return truncate(r.row, maxLen);
}

export function readCmdline(pid: number, procRoot = "/proc"): string[] {
  try {
    const buf = fs.readFileSync(path.join(procRoot, String(pid), "cmdline"));
    return buf.toString("utf8").split("\0").filter(Boolean);
  } catch {
    return [];
  }
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

/** 跨主机 pane 解析：本地项目一次 list-panes；跨主机项目按 host 走 ssh（带缓存）。 */
export function resolvePanes(
  projects: Project[],
  socket: string,
  env: NodeJS.ProcessEnv,
): (p: Project) => PaneInfo[] {
  const localPanes = tmuxListPanes(socket, env);
  const remoteCache = new Map<string, PaneInfo[]>();
  return (p: Project): PaneInfo[] => {
    if (!p.host) return localPanes;
    if (!remoteCache.has(p.host)) remoteCache.set(p.host, remoteTmuxListPanes(p.host, env));
    return remoteCache.get(p.host)!;
  };
}

export function render(projects: Project[], opts: RenderOpts): string {
  const env = opts.env ?? process.env;
  const procRoot = opts.procRoot ?? "/proc";
  const resources = resourceReadings(procRoot);
  const outer = outerReadings(projects, resolvePanes(projects, opts.socket, env));

  const lines: string[] = [];
  lines.push(`manager-tick-readings ts=${Date.now()}`);
  for (const p of projects) lines.push(`project.status ${p.name} ${projectStatus(p)}`);
  lines.push(`resource.cpu_some_avg10 ${resources.cpuSomeAvg10 || "unmeasurable"}`);
  lines.push(`resource.load1 ${resources.load1 || "unmeasurable"}`);
  lines.push(`resource.node_count ${resources.nodeCount}`);
  lines.push(`resource.node_comm_literal ${resources.nodeCommLiteral}`);
  lines.push(`resource.node_dual_read ${resources.nodeInstrumentFailure ? "INSTRUMENT-FAILURE" : "ok"}`);
  lines.push(`resource.mem_available_mb ${resources.memAvailMb}`);
  for (const o of outer) {
    if (o.exists) {
      const hostPart = o.host ? ` host=${o.host}` : "";
      lines.push(`outer.liveness ${o.target} alive pane_pid=${o.panePid} cmd=${o.cmd}${hostPart}`);
    } else {
      lines.push(`outer.liveness ${o.target} window-missing`);
    }
  }
  for (const p of projects) lines.push(`outer.ticklog ${p.name} ${latestTickLog(p, 200, { full: true })}`);
  return `${lines.join("\n")}\n`;
}

/** 单读数子命令（Contract invoke）：`manager-tick-readings.ts outer.ticklog [name…]`
 *  / `outer.liveness <target>`。target 形态 `<project>[:<window>]` 或 `<host>:<session>:<window>`。 */
export function renderSelected(cmd: string, args: string[], projects: Project[], opts: RenderOpts): string {
  const env = opts.env ?? process.env;
  const lines: string[] = [];

  if (cmd === "outer.ticklog") {
    const names = args.length > 0 ? new Set(args) : null;
    for (const p of projects) {
      if (names && !names.has(p.name)) continue;
      lines.push(`outer.ticklog ${p.name} ${latestTickLog(p, 200, { full: true })}`);
    }
  } else if (cmd === "outer.liveness") {
    const target = args[0] ?? "";
    const parts = target.split(":");
    let projName: string;
    let window = "outer";
    if (parts.length === 1) projName = parts[0];
    else if (parts.length === 2) { projName = parts[0]; window = parts[1]; }
    else { projName = parts[1]; window = parts[2]; }
    const project = projects.find((p) => p.name === projName);
    if (!project) {
      lines.push(`outer.liveness ${target || "<missing>"} unknown-project`);
      return `${lines.join("\n")}\n`;
    }
    const panes = project.host ? remoteTmuxListPanes(project.host, env) : tmuxListPanes(opts.socket, env);
    const sessionName = project.session ?? project.name;
    const matches = panes.filter(
      (pn) => pn.window === window &&
        (pn.session === sessionName || (project.session == null && pn.session.startsWith(`${project.name}-`))),
    );
    const canonical = `${projName}:${window}`;
    if (matches.length === 0) {
      lines.push(`outer.liveness ${canonical} window-missing`);
    } else {
      for (const m of matches) {
        const hostPart = project.host ? ` host=${project.host}` : "";
        lines.push(`outer.liveness ${canonical} alive pane_pid=${m.panePid} cmd=${m.cmd} session=${m.session}${hostPart}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

export function main(argv: string[], opts?: { env?: NodeJS.ProcessEnv }): number {
  const env = opts?.env ?? process.env;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "..", "..");
  const projects = parseProjects(env);
  const socket = defaultTmuxSocket(env);
  const args = argv.slice(2);
  const cmd = args[0] ?? "";
  if (cmd === "outer.ticklog" || cmd === "outer.liveness") {
    process.stdout.write(renderSelected(cmd, args.slice(1), projects, { socket, repoRoot, env }));
    return 0;
  }
  process.stdout.write(render(projects, { socket, repoRoot, env }));
  return 0;
}

if (isDirectEntry(import.meta)) {
  process.exitCode = main(process.argv);
}
