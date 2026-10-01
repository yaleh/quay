#!/usr/bin/env node
// plugin/scripts/manager-tick-readings.ts — 管理者 tick 的机械读数（单命令产出）
//
// tasks/gap-manager-tick-mechanical-checks-are-eight-loose-bash-blocks-in-prose.md: 并入 quay-session 入口
//   （node --experimental-strip-types plugin/scripts/quay-session.ts manager-tick-readings），把 tick 散文里
//   的 8 个散落 bash 块（orchestration/manager-loop-tick.md §1.a/§1.b/§1.4）收成一条命令。AC1。
//
// 契约：
//   - 输出固定结构、逐行带标签：人为跳过一项 ⇒ 该标签行缺失，可被机械检出，不是静默少几行。AC3。
//
// 用法:
//   node --experimental-strip-types plugin/scripts/quay-session.ts manager-tick-readings
//   node --experimental-strip-types plugin/scripts/manager-tick-readings.ts        # 等价直接运行
//   node --experimental-strip-types plugin/scripts/manager-tick-readings.ts nonblock-ledger  # 只读台账读数
//
// 测试/环境接缝（生产调用不设 → 行为不变）:
//   MTR_PROJECTS           项目表 name=dir 空格分隔（默认 quay/archguard/meta-cc 于 /home/yale/work）
//   MTR_REPO_ROOT          主检出 root（默认 moduleRepoRoot()）——台账读数读 <root>/.quay/…；
//                          一次性 verify worktree 里 .quay/ 运行时载体结构上不存在 ⇒ 取证时要显式指主检出
//
// 2026-09-06 退役 `outer.liveness`（gap-manager-liveness-field-outer-tmux-gone，方案 A）：
//   outer 独立 tmux 会话/窗口已由 gap-retire-outer-tmux-window-logic 删除，`outer.liveness` 字段结构上
//   恒返回 `window-missing`（一个恒返回固定值的伪观测，本任务 DoD 明令禁止）。连同 `outerReadings()` 与
//   仅服务于该字段的 tmux 读管线（tmuxListPanes/remoteTmuxListPanes/parsePanes/defaultTmuxSocket/
//   resolvePanes 及相关 seam）以及 Project 的 session/host 字段（仅 outer.liveness 消费）一并删除。
//   判层活性的正本已是直接量（git log 提交时刻 / worktree 活进程）。
//   `outer.ticklog`（读文件，非 tmux）保留。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntry, flagValue } from "./gate-script-base.ts";
import { readProcCmdline } from "../../packages/quay/src/kernel/proc-identity.ts";
import { repoRoot as moduleRepoRoot } from "./repo-root.ts";
// 读侧消费（gap-coverage-nonblock-ledger-has-no-consumer）：`--no-block` 覆盖率台账此前只有写者，
// 没有读者 —— RED 落进一份没人打开的 jsonl，等于取值轴断开（硬规则 9）。本文件是它**唯一的**消费面：
// manager tick 每轮读一次，未处置条目以显式标签行报到管理者面前。⛔ 本读数**不**阻断任何东西
// （断言：它不在 run_static_checks 的 run_checker 名单里），它只让「有未处置条目」这件事每轮可见。
import { readNonBlockLedger } from "./gate-event-coverage-check.ts";
// 读侧消费（gap-task-file-violation-ledger-has-no-consumer）：第二份 grow-only `--no-block` 台账
// （`.quay/task-file-violation-ledger.jsonl`）此前同样只有写者 —— 而且它由**两个**写者共用
// （task-contract-check + task-ac-carryover-check），所以读取面既不属于其中任何一个，也就一直没人接。
// 两个 collector 是写侧那套谓词的**同一实现**（提取自各自 runCli），读者据此判「条目还在不在」。
import { NO_BLOCK_LEDGER_REL, listTaskFiles, collectContractViolations } from "./task-contract-check.ts";
import { collectUnownedAcs } from "./task-ac-carryover-check.ts";

export const NAME = "manager-tick-readings";
export const PROJECTS_SEAM = "MTR_PROJECTS";
/** 主检出 root 的测试/取证接缝（生产不设 ⇒ `moduleRepoRoot()`，与既有行为一致）。
 *  它存在的理由：一次性 verify worktree 里 `.quay/` 运行时载体**结构上不存在**（台账必然缺席），
 *  而这份读数的对象是**主检出**的运行态 ⇒ 没有这个缝，在 worktree 里跑永远只得 not-evaluated。 */
export const REPO_ROOT_SEAM = "MTR_REPO_ROOT";

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

/** 读 + NUL 切分由 kernel leaf `readProcCmdline` 单点实现（本文件原有第二份手搓副本 —
 *  gap-judgment-rewrites-route-through-proc-identity-leaf）；`procRoot` 是本调用点的测试缝，
 *  原样透传给 leaf。⛔ 失败值仍是 []（本调用点的口径，与 orphan-session-check 的 null 相反，
 *  迁移不得把两者折叠成同一个值）。
 *  ⚠️ 本函数名刻意保留：instrument-failure-check 把 `readCmdline(pid, procRoot)[0] ?? ""` 当作
 *  /proc 读取的【安全形】样本，改名会让那条负控制失去已知真样本。 */
export function readCmdline(pid: number, procRoot = "/proc"): string[] {
  const argv = readProcCmdline(pid, procRoot);
  return argv === null ? [] : argv.filter(Boolean);
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
  repoRoot: string;
  procRoot?: string;
}

export function render(projects: Project[], opts: RenderOpts): string {
  const procRoot = opts.procRoot ?? "/proc";
  const resources = resourceReadings(procRoot);

  const lines: string[] = [];
  lines.push(`manager-tick-readings ts=${Date.now()}`);
  for (const p of projects) lines.push(`project.status ${p.name} ${projectStatus(p)}`);
  lines.push(`resource.cpu_some_avg10 ${resources.cpuSomeAvg10 || "unmeasurable"}`);
  lines.push(`resource.load1 ${resources.load1 || "unmeasurable"}`);
  lines.push(`resource.node_count ${resources.nodeCount}`);
  lines.push(`resource.node_comm_literal ${resources.nodeCommLiteral}`);
  lines.push(`resource.node_dual_read ${resources.nodeInstrumentFailure ? "INSTRUMENT-FAILURE" : "ok"}`);
  lines.push(`resource.mem_available_mb ${resources.memAvailMb}`);
  for (const p of projects) lines.push(`outer.ticklog ${p.name} ${latestTickLog(p, 200, { full: true })}`);
  lines.push(...nonBlockCoverageLines(opts.repoRoot));
  lines.push(...taskFileViolationLedgerLines(opts.repoRoot));
  return `${lines.join("\n")}\n`;
}

/** `--no-block` 覆盖率台账的读取行（每轮报到处置面）。
 *
 *  三态**在标签行里显式区分**（硬规则 3b）：`not_evaluated` 有自己的一行取值，⛔ 绝不把
 *  「台账缺席 / 读不懂」印成 `0` —— 那样「没评估」与「查过且干净」在记录上同形。
 *  处置是推导的（见 gate-event-coverage-check.ts 的 `readNonBlockLedger`），⛔ 不是豁免 id 表：
 *  某条目一旦有了对应的 `complete` 事件就不再出现在 `unresolved`。
 *  这些行落在 manager tick 的机械读数里 —— 每轮都读、且管理者有处置动作（立案/补写事件），
 *  这正是「把未处置条目送到处置面」。 */
export function nonBlockCoverageLines(repoRoot: string): string[] {
  const r = readNonBlockLedger(repoRoot);
  if (!r.evaluated) {
    return [
      `gate_event_coverage_nonblock.state not_evaluated`,
      `gate_event_coverage_nonblock.unresolved -`,
      `gate_event_coverage_nonblock.detail ${r.carrier} — ${r.reason}`,
    ];
  }
  const detail = r.unresolved!.length
    ? r.unresolved!.map((e) => `${e.day}|${e.task}`).join(",")
    : "none";
  return [
    `gate_event_coverage_nonblock.state ${r.unresolved!.length ? "UNRESOLVED" : "ok"}`,
    `gate_event_coverage_nonblock.unresolved ${r.unresolved!.length} (entries ${r.entries}, disposed ${r.disposed})`,
    `gate_event_coverage_nonblock.detail ${detail}`,
  ];
}

// ── 任务文件违规台账的读侧（gap-task-file-violation-ledger-has-no-consumer） ────────────────────────
// 处置轴选型 = ②（本任务 AC2；③②① 的取舍与反例见任务体）：**台账不再是「只增不减的账」，
// 而是「曾经记过什么」的集合；一条条目此刻还成不成立，由读者**对全量 store 重算**得出。**
//
// 为什么不是 ①（写者追加 resolved）：写者的作用域**不是 store**。`runner-static-gate.ts:226` 的
// `@static-scoped-mode subset-touched` 会在 scoped 层把该 checker 收窄成
// `--strict-subset <touched task files>`（select-static-checks-for-touches.ts:708）——子集运行里
// 「没看见」既可能是「已修」也可能是「根本没扫」，写者拿不到这个区分（硬规则 4c：这个 bit 在到达
// 写者之前就被中间层抹掉了）⇒ 照 ① 做会把未扫描的条目静默标成已处置。选 ② 的读侧形态绕开了它：
// **读者自己跑全量**，与最近一次写入者跑的是不是子集无关。
//
// 处置 = 「曾经记过 ∧ 此刻不再成立」。它是**推导量**，⛔ 不是手维护的豁免 id 表：把违规真修掉
// （或该任务文件消失 / 该 done 任务不再 done），条目下一轮就落到 disposed，读者不再报它。
// 生产证据：2026-10-01 的 230 条里，58 条已经这样沉默（修复前记过、现在不再成立）。
//
// 三态（硬规则 3b，⛔ 不与「零未处置」同形）：
//   absent      —— 载体缺席（「没有人报过」⛔ 不等于「报过且都处置了」）
//   unreadable  —— 载体在、但**全部**行不可解析（读不懂 ⛔ 不等于零未处置）
//   read        —— 读到且判定完成（`unresolved` 此时才是一个数组）
// 另有第四态 `live-unavailable`：台账读到了、但全量重算跑不成（store 读不了）⇒ 处置不可判，
// 同样 not-evaluated（「查不成」⛔ 不等于「查过且干净」）。
export interface TaskFileViolationLedgerEntry {
  key: string;
  checker: string;
  violation: string;
  at: string;
}

export interface TaskFileViolationLedgerReading {
  evaluated: boolean;
  carrier: "absent" | "unreadable" | "read";
  ledger: string;
  entries: number;
  disposed: number;
  /** ⛔ null 表示「未评估」——**不是** `[]`（空数组会被读成「查过且干净」）。 */
  unresolved: TaskFileViolationLedgerEntry[] | null;
  malformedLines: number;
  /** 台账里出现过、但读者没有对应重算器的 checker 名 —— 保守计入 unresolved，绝不静默判 disposed。 */
  unknownCheckers: string[];
  reason: string;
}

/** 全量重算：checker 名 → 此刻仍然成立的 violation 字符串集合。两个 collector 都与写侧同一实现。 */
function liveViolationsByChecker(root: string): Map<string, Set<string>> {
  return new Map<string, Set<string>>([
    ["task-contract-check", new Set(collectContractViolations(root, listTaskFiles(root, [])).entries)],
    ["task-ac-carryover-check", new Set(collectUnownedAcs(root).entries)],
  ]);
}

export function readTaskFileViolationLedger(root: string): TaskFileViolationLedgerReading {
  const ledger = path.join(root, NO_BLOCK_LEDGER_REL);
  const base = { ledger, entries: 0, disposed: 0, unresolved: null, malformedLines: 0, unknownCheckers: [] as string[] };
  let raw: string;
  try {
    raw = fs.readFileSync(ledger, "utf8");
  } catch {
    return {
      ...base,
      evaluated: false,
      carrier: "absent",
      reason: `NOT-EVALUATED: 违规台账载体缺席（${ledger}）——「没有人报过」⛔ 不与「报过且都处置了」同形`,
    };
  }

  const entries: TaskFileViolationLedgerEntry[] = [];
  let malformed = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      malformed++;
      continue;
    }
    if (typeof d?.key !== "string" || typeof d?.checker !== "string" || typeof d?.violation !== "string") {
      malformed++;
      continue;
    }
    entries.push({ key: d.key, checker: d.checker, violation: d.violation, at: typeof d.at === "string" ? d.at : "" });
  }
  if (entries.length === 0 && malformed > 0) {
    return {
      ...base,
      evaluated: false,
      carrier: "unreadable",
      malformedLines: malformed,
      reason: `NOT-EVALUATED: 台账存在但 ${malformed} 行全部不可解析（读不懂 ⛔ 不等于零未处置）`,
    };
  }

  let live: Map<string, Set<string>>;
  try {
    live = liveViolationsByChecker(root);
  } catch (e: any) {
    return {
      ...base,
      evaluated: false,
      carrier: "read",
      entries: entries.length,
      malformedLines: malformed,
      reason: `NOT-EVALUATED: 全量重算跑不成（${e?.message ?? e}）⇒ 处置不可判，⛔ 不与「零未处置」同形`,
    };
  }

  const unresolved: TaskFileViolationLedgerEntry[] = [];
  const unknown = new Set<string>();
  let disposed = 0;
  for (const e of entries) {
    const set = live.get(e.checker);
    if (!set) {
      // 读者没有这个 checker 的重算器 ⇒ 处置**不可判**。保守计入 unresolved 并点名，⛔ 不算 disposed
      //（把「没查成」印成「已处置」正是硬规则 3b 禁的那一侧）。
      unknown.add(e.checker);
      unresolved.push(e);
      continue;
    }
    if (set.has(e.violation)) unresolved.push(e);
    else disposed++;
  }
  const unknownCheckers = [...unknown].sort();
  return {
    evaluated: true,
    carrier: "read",
    unresolved,
    disposed,
    entries: entries.length,
    malformedLines: malformed,
    unknownCheckers,
    ledger,
    reason:
      (unresolved.length ? `${unresolved.length} 条未处置（已处置 ${disposed}/${entries.length}）` : `零未处置（${disposed}/${entries.length} 条均已处置）`) +
      (unknownCheckers.length ? ` · ⚠️ 无重算器的 checker: ${unknownCheckers.join(", ")}（保守计入未处置）` : ""),
  };
}

/** 人可读形态（⚠️ `not-evaluated` 有独立一行取值，⛔ 不打印成 0）。 */
export function formatTaskFileViolationLedger(r: TaskFileViolationLedgerReading): string {
  if (!r.evaluated) return `${r.reason}\n  carrier=${r.carrier} ledger=${r.ledger}`;
  const head = `task-file-violation ledger — ${r.ledger}`;
  const body = `entries=${r.entries} disposed=${r.disposed} unresolved=${r.unresolved!.length} malformed_lines=${r.malformedLines}`;
  const detail = r.unresolved!.map((e) => `  UNRESOLVED ${e.checker} ${e.violation} · recorded ${e.at || "(no at)"}`);
  return [head, body, ...detail].join("\n");
}

/** 台账的 tick 标签行（每轮报到处置面）。
 *
 *  与 `nonBlockCoverageLines` 同形：三态**在标签行里显式区分**（硬规则 3b），未评估有自己的一行取值，
 *  ⛔ 绝不印成 `0`。明细**有界**（前 12 条 + 余数）——tick 面是「队列」不是「全文」，全量清单由
 *  `--ledger` 子命令给出；计数始终是**全量计数**，不是被截断后的长度。 */
export function taskFileViolationLedgerLines(repoRoot: string): string[] {
  return taskFileViolationLedgerLinesFrom(readTaskFileViolationLedger(repoRoot));
}

export function taskFileViolationLedgerLinesFrom(r: TaskFileViolationLedgerReading): string[] {
  if (!r.evaluated) {
    return [
      `task_file_violation_ledger.state not_evaluated`,
      `task_file_violation_ledger.unresolved -`,
      `task_file_violation_ledger.detail ${r.carrier} — ${r.reason}`,
    ];
  }
  const head = r.unresolved!.slice(0, 12).map((e) => e.key);
  const detail = r.unresolved!.length
    ? head.join(",") + (r.unresolved!.length > head.length ? `,…(+${r.unresolved!.length - head.length})` : "")
    : "none";
  return [
    `task_file_violation_ledger.state ${r.unresolved!.length ? "UNRESOLVED" : "ok"}`,
    `task_file_violation_ledger.unresolved ${r.unresolved!.length} (entries ${r.entries}, disposed ${r.disposed})`,
    `task_file_violation_ledger.detail ${detail}`,
    ...(r.unknownCheckers.length ? [`task_file_violation_ledger.unknown_checkers ${r.unknownCheckers.join(",")}`] : []),
  ];
}

/** 单读数子命令（Contract invoke）：`manager-tick-readings.ts outer.ticklog [name…]`。 */
export function renderSelected(cmd: string, args: string[], projects: Project[], repoRoot?: string): string {
  const lines: string[] = [];

  if (cmd === "outer.ticklog") {
    const names = args.length > 0 ? new Set(args) : null;
    for (const p of projects) {
      if (names && !names.has(p.name)) continue;
      lines.push(`outer.ticklog ${p.name} ${latestTickLog(p, 200, { full: true })}`);
    }
  }
  // 按需复核对读侧读数（同一实现，⛔ 不另写一份判定）：manager 想单独看台账时用。
  if (cmd === "nonblock-ledger" && repoRoot) {
    lines.push(...nonBlockCoverageLines(repoRoot));
  }
  // 任务文件违规台账：取证/复核用的单读数出口。默认打印**与 tick 面逐字相同**的标签行
  //（面与命令一致 ⇒ 贴出来的读数就是管理者看到的那几行），`--root <dir>` 换载体，`--json` 出机器形。
  if (cmd === "task-file-violation-ledger") {
    const root = flagValue(args, "--root") ?? repoRoot;
    if (root) {
      const r = readTaskFileViolationLedger(root);
      lines.push(...(args.includes("--json") ? [JSON.stringify(r, null, 2)] : taskFileViolationLedgerLinesFrom(r)));
    }
  }
  return `${lines.join("\n")}\n`;
}

export function main(argv: string[], opts?: { env?: NodeJS.ProcessEnv }): number {
  const env = opts?.env ?? process.env;
  const repoRoot = env[REPO_ROOT_SEAM]?.trim() || moduleRepoRoot();
  const projects = parseProjects(env);
  const args = argv.slice(2);
  const cmd = args[0] ?? "";
  if (cmd === "outer.ticklog" || cmd === "nonblock-ledger" || cmd === "task-file-violation-ledger") {
    process.stdout.write(renderSelected(cmd, args.slice(1), projects, repoRoot));
    // 台账读数：读到 ⇒ 0；**未评估**（载体缺席 / 读不懂 / 全量重算跑不成）⇒ 3，与「零未处置」分形
    //（硬规则 3b；同 gate-event-coverage-check --ledger 的既有约定）。
    if (cmd === "task-file-violation-ledger") {
      const root = flagValue(args.slice(1), "--root") ?? repoRoot;
      if (root && !readTaskFileViolationLedger(root).evaluated) return 3;
    }
    return 0;
  }
  process.stdout.write(render(projects, { repoRoot }));
  return 0;
}

if (isDirectEntry(import.meta, undefined, "manager-tick-readings")) {
  process.exitCode = main(process.argv);
}
