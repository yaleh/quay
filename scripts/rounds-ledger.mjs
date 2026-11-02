#!/usr/bin/env node
// rounds-ledger.mjs — 只读轮数台账：按【落地任务】聚合 loop 内 worker 会话，
// 把轮数拆成 inspect / edit / verify / fix / orchestration 五类，并把每个非首次会话
// 归因到返工原因。⛔ 只读真实遥测，缺失即 not-evaluated（缺值 = 未查，不与 0/成功共用取值）。
//
// 数据来源（全部只读）：
//   <sessions-dir>/*.jsonl             Claude Code 会话。worker 会话 = 首条 user 消息以
//                                      "You are a per-task worker" 开头且含 "Task: <id>"。
//   .quay/fan-in-step-trace.jsonl      fan-in 步骤轨迹（step-begin/step-end 事件）。落地证据 =
//                                      窗口内 step=ff 的 step-end 且 ok:true；fan-in-red 证据 =
//                                      窗口内任一 step-end 的 ok:false。
//   .quay/worker-outcome.jsonl         尝试级记录（task/started_at/ended_at/final_state/timed_out/signal）。
//
// 身份与口径（与 E1 同源处明确标注）：
//   · task         = taskId 字符串（任务文件 id）
//   · session      = sessionId（jsonl 文件名去后缀）；worker 会话通过首条 user 消息的 "Task: <id>" 归属任务
//   · round        = 按 message.id 去重后的 assistant 消息数。⛔ 不按 jsonl 行数——同一个 message.id 会
//                   被 apiBlockIndex 拆成多条 assistant 记录（thinking/text/tool_use 各一条），
//                   按行数会把一轮多 block 重复计。
//   · 落地         = fan-in-step-trace.jsonl 中 step=ff 的 step-end 且 ok:true（沿用 E1 的 ff ok 语义；
//                   任务状态 / 受测 SHA / final_state=completed 都不是落地证据）
//   · 成本（eq）    = input_tokens(fresh) + 0.1 × cache_read_input_tokens + 5 × output_tokens。
//                   同时给 0.05× 口径（input + 0.05 × cache_read + 5 × output）。权重写在本 --help。
//   · 窗口         = 会话首条记录时间戳（含端点）；窗口外/缺时间戳的会话单列 unwindowed，不计入窗口读数。
//
// 只读：不改 driver、不减少测试/检查、不新增会跳过验证的分支。

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

// ── 常量 ─────────────────────────────────────────────────────────────────────
const COST_CACHE_READ = 0.1;
const COST_CACHE_READ_05 = 0.05;
const COST_OUTPUT = 5;

const PHASES = ["verify", "edit", "inspect", "fix", "orchestration"]; // 优先级降序（0 最高）

const HELP = `rounds-ledger — 只读轮数台账（按落地任务聚合）

usage: node scripts/rounds-ledger.mjs [flags]

只读报告：把 loop 内 worker 会话按落地任务聚合，把每轮（= 一条按 message.id 去重后的
assistant 消息）归到 inspect / edit / verify / fix / orchestration 五类之一，并把每个
非首次会话归因到返工原因。缺失维度明确 not-evaluated。

flags:
  --root <dir>           主检出根（遥测在 <dir>/.quay/）。缺省：从本脚本位置解析 git common dir。
  --sessions-dir <dir>   Claude Code 会话目录。缺省 ~/.claude/projects/-data-home-yale-work-quay
  --window-start <iso>   窗口起点（含，ISO8601）。缺省 = 会话数据最早首条时间戳。
  --window-end <iso>     窗口终点（含，ISO8601）。缺省 = 会话数据最晚首条时间戳。
  --task <id>            只分析单个任务（抽查用）。
  --json                 输出 JSON（机器可核）。
  --help                 本帮助，exit 0。

会话→任务关联规则（与 E1 同源）：
  首条 user 消息以 "You are a per-task worker" 开头且含 "Task: <id>" 的会话才算 worker 会话；
  task id 用 /Task:\\s*([A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*)/ 提取。首条 user 消息读不到
  （无 user 记录 / 无 Task: 模式）⇒ not-evaluated，⛔ 不猜、不并入任何任务。

轮数去重规则：
  轮 = 按 message.id 去重后的 assistant 消息数。同一个 message.id 可能被 apiBlockIndex 拆成
  多条 assistant jsonl 记录（thinking / text / tool_use 各一条，usage 相同），按 jsonl 行数会把
  一轮多 block 重复计；本工具合并同 id 的全部 block 后再计 1 轮。缺 message.id 的记录无法去重，
  逐条计 1 轮并计入 missingMessageId（读不懂 ≠ 读成 0/成功）。

阶段优先级（一轮内混合工具按优先级取一，原始工具名计数保留在 --json 的 rawToolCounts）：
  verify > edit > inspect > fix > orchestration
  - verify         task_check / gate_run / gate_log / gate_list / lifecycle_* / goal_gate；
                   或 Bash 运行测试/检查（node --test / test.sh / --for-task / scoped-gate / anti-drift …）
  - edit           Edit / Write / task_write（结构化文件/任务体写入）
  - inspect        Read / Grep / Glob / ToolSearch / 各类 MCP 查询（task_get/task_list/meta-cc/archguard…）；
                   或 Bash 读取（find / grep / ls / cat / git status/log/diff/…）
  - fix            Bash 变更（git add/commit/reset/rm/mv/rebase/stash/tag/cherry-pick；mv/cp/mkdir/rm/sed/
                   chmod/touch；node <script>.mjs）——「fix-marker」即这类 shell 变更
  - orchestration  driver/fan-in/dispatch/worktree 管理（worker-driver / quay driver / fan-in / dispatch /
                   dispatch-worktree-setup / git worktree add|remove|merge|checkout）；或
                   ListAgents / SendMessage / EnterWorktree / ExitWorktree / Workflow / Agent /
                   ScheduleWakeup / TaskStop / Monitor
  无工具调用或无法映射的轮 ⇒ unclassified 单列（⛔ 不并入五个阶段）。

落地证据定义（沿用 E1 的 ff ok 语义）：
  落地任务 = fan-in-step-trace.jsonl 中窗口内 step=ff 的 step-end 且 ok:true。任务状态 / 受测 SHA /
  final_state=completed 都不是落地证据。无 step-trace 记录 ⇒ not-evaluated（⛔ 不读成「未落地」）。

成本权重（写死，不隐藏）：
  eq     = input_tokens + 0.1 × cache_read_input_tokens + 5 × output_tokens
  eq05   = input_tokens + 0.05 × cache_read_input_tokens + 5 × output_tokens
  usage 取该 message.id 首条记录的 usage（同 id 的多 block 拆分共享同一 usage，只取一次不重复计）；
  一轮无 usage ⇒ 该轮成本 not-evaluated（计入 roundsMissingUsage，不读成 0）。

返工归因（同一任务第 2..n 个会话，按任务级归因后广播到每个返工会话）：
  crash-or-timeout  worker-outcome 任一尝试 final_state∈{failed,killed} 或 timed_out=true 或 signal≠null
  fan-in-red        fan-in-step-trace 窗口内任一 step-end ok:false（校验/套件红）
  worker-exited     任一尝试 final_state=exited-not-landed（无 crash、无 fan-in-red 证据）
  superseded        已落地且无上述任何失败证据（前一版工作被取代/重定范围）
  unknown           无法判定（⛔ 单列，不并入任一已知类）
  优先级：crash-or-timeout > fan-in-red > worker-exited > superseded > unknown。

窗口语义：
  会话按首条记录时间戳（含端点）落入窗口；窗口外/缺时间戳的会话单列 unwindowed（outside/missing 分列），
  ⛔ 不计入窗口读数，也不静默丢弃。
`;

// ── 小工具 ───────────────────────────────────────────────────────────────────
function readFileSafe(p) {
  try { return readFileSync(p, "utf8"); } catch { return null; }
}
function readJsonl(p) {
  const text = readFileSafe(p);
  if (text == null) return [];
  const out = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* 坏行跳过，best-effort */ }
  }
  return out;
}
function parseIso(s) {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}
function tsToMs(x) {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string") return parseIso(x);
  return null;
}
function windowMembership(tsMs, winStart, winEnd) {
  if (winStart == null && winEnd == null) return "inside";
  if (tsMs == null) return "missing";
  if (winStart != null && tsMs < winStart) return "outside";
  if (winEnd != null && tsMs > winEnd) return "outside";
  return "inside";
}
function median(sorted) {
  if (sorted.length === 0) return null;
  if (sorted.length % 2 === 1) return sorted[Math.floor(sorted.length / 2)];
  return (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
}
function num(x) { return typeof x === "number" && Number.isFinite(x) ? x : null; }
function sha256(s) { return createHash("sha256").update(s).digest("hex"); }
function round1(x, d = 0) { return typeof x === "number" && Number.isFinite(x) ? Number(x.toFixed(d)) : null; }

// 主检出根：worktree 的 git common dir = <主检出>/.git（同 E1）。
function resolveMainCheckout() {
  const here = dirname(new URL(import.meta.url).pathname);
  const r = spawnSync("git", ["-C", here, "rev-parse", "--git-common-dir"], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) {
    const cd = resolve(here, r.stdout.trim());
    if (basename(cd) === ".git") return dirname(cd);
    return cd;
  }
  const t = spawnSync("git", ["-C", here, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (t.status === 0 && t.stdout.trim()) return t.stdout.trim();
  return process.cwd();
}

// ── 参数解析 ───────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { root: null, sessionsDir: null, windowStart: null, windowEnd: null, task: null, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => (i + 1 < argv.length ? argv[++i] : null);
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--json") args.json = true;
    else if (a === "--root") args.root = next();
    else if (a === "--sessions-dir") args.sessionsDir = next();
    else if (a === "--window-start") args.windowStart = next();
    else if (a === "--window-end") args.windowEnd = next();
    else if (a === "--task") args.task = next();
  }
  return args;
}

// ── 会话扫描与窗口 ───────────────────────────────────────────────────────────
// 首条 user 消息文本（同 E1）。
function firstUserMessageText(text) {
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type === "user") {
      const c = o.message?.content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) return c.map((x) => x.text || "").join("");
      return "";
    }
  }
  return null;
}
// 会话首条记录时间戳（同 E1）。
function sessionFirstTsMs(text) {
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.timestamp === undefined || o.timestamp === null) continue;
    const t = tsToMs(o.timestamp);
    if (t != null) return t;
  }
  return null;
}

const WORKER_RE = /^You are a per-task worker/;
const TASK_RE = /Task:\s*([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)/;

// 扫描 sessions-dir，把 worker 会话的 (sessionId, task, firstTs, file) 收进来。
// notEvaluated = 首条 user 消息像 worker 会话但读不到 Task id（缺值 = 未查，不猜）。
function scanSessions(src) {
  const dir = src.sessionsDir;
  const sessions = [];
  let scanned = 0, notWorker = 0, notEvaluated = 0;
  if (!existsSync(dir)) return { sessions, scanned, notWorker, notEvaluated };
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    scanned++;
    const text = readFileSafe(join(dir, f));
    if (text == null) continue;
    const firstUser = firstUserMessageText(text);
    if (!firstUser || !WORKER_RE.test(firstUser)) { notWorker++; continue; }
    const m = TASK_RE.exec(firstUser);
    if (!m) { notEvaluated++; continue; }
    const task = m[1].replace(/\.$/, "");
    sessions.push({ sessionId: f.replace(/\.jsonl$/, ""), task, file: f, firstTs: sessionFirstTsMs(text) });
  }
  return { sessions, scanned, notWorker, notEvaluated };
}

// ── 轮数 + 阶段 + 成本 ───────────────────────────────────────────────────────
// Bash 命令 → 阶段（启发式，优先级 orchestration > verify > fix > inspect）。
const BASH_ORCH_RE = /worker-driver|quay\s+driver|fan-in|dispatch|worktree-setup|worktree-include|git\s+worktree\s+(add|remove|prune)|git\s+(merge|checkout)|driver\s+(start|stop|drain|status|restart)/;
const BASH_VERIFY_RE = /node\s+--test|--test\b|test\.sh|task\s+check|task_check|--for-task|full-suite|scoped-gate|anti-drift|typecheck|runner-static-gate|select-static-checks|tick-core-static-check|\.test\.(mjs|ts|js)|npm\s+test/;
const BASH_FIX_RE = /\bgit\s+(add|commit|reset|rm|mv|rebase|stash|tag|cherry-pick)\b|\bmv\s+|\bcp\s+|\bmkdir\s+|\brm\s+|\bsed\s+|\bchmod\s+|\btouch\s+|\bnode\s+\S+\.mjs\b/;
const BASH_INSPECT_RE = /\b(find|grep|ls|cat|head|tail|wc|which|ps)\b|\bgit\s+(status|log|diff|show|rev-parse|blame|ls-files|branch|worktree\s+list|merge-base)\b/;

function classifyBashPhase(cmd) {
  if (BASH_ORCH_RE.test(cmd)) return "orchestration";
  if (BASH_VERIFY_RE.test(cmd)) return "verify";
  if (BASH_FIX_RE.test(cmd)) return "fix";
  if (BASH_INSPECT_RE.test(cmd)) return "inspect";
  return null;
}

// 非 Bash 工具 → 阶段。
function classifyToolPhase(name, input) {
  if (name === "Bash") return classifyBashPhase(String(input?.command || ""));
  const n = String(name);
  // verify：校验/门禁动词
  if (/(^|__)(task_check|gate_run|gate_log|gate_list|lifecycle_promote|lifecycle_complete|lifecycle_adjudicate|lifecycle_retreat|goal_gate)(__|$)/.test(n)) return "verify";
  // edit：结构化写入
  if (n === "Edit" || n === "Write" || n.endsWith("task_write")) return "edit";
  // orchestration：跨会话驱动 / 生命周期管理
  if (["ListAgents", "SendMessage", "EnterWorktree", "ExitWorktree", "Workflow", "Agent", "ScheduleWakeup", "TaskStop", "Monitor"].includes(n)) return "orchestration";
  // inspect：读取/查询（含 quay 读动词、archguard/meta-cc 查询）
  if (["Read", "Grep", "Glob", "ToolSearch", "ReadMcpResourceTool", "ListMcpResourcesTool", "WebFetch", "WebSearch"].includes(n)) return "inspect";
  if (/(^|__)(task_get|task_list|meta_get|meta_list|goal_get|goal_list|driver_log|adr_get|adr_list|action_list|config_validate)(__|$)/.test(n)) return "inspect";
  if (/archguard|meta-cc/.test(n)) return "inspect";
  return null;
}

// 一轮（已合并同一 message.id 的全部 assistant 记录）→ 阶段 + 原始工具计数。
function classifyRound(toolUses) {
  const phaseRank = new Map(PHASES.map((p, i) => [p, i]));
  const rawToolCounts = {};
  let best = null;
  for (const t of toolUses) {
    const name = String(t.name || "");
    rawToolCounts[name] = (rawToolCounts[name] || 0) + 1;
    const phase = classifyToolPhase(name, t.input);
    if (phase && (best == null || phaseRank.get(phase) < phaseRank.get(best))) best = phase;
  }
  return { phase: best || "unclassified", rawToolCounts, toolCount: toolUses.length };
}

// 解析单个会话的轮。返回 { rounds, phaseCounts, costEq, costEq05, missingMessageId, roundsMissingUsage, perRound }。
function analyzeSession(text) {
  // 按 message.id 分组 assistant 记录（合并同 id 的 apiBlockIndex 拆分）。
  const byId = new Map();
  let missingMessageId = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== "assistant") continue;
    const id = o.message?.id;
    if (id == null) { missingMessageId++; continue; }
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(o);
  }

  const phaseCounts = { verify: 0, edit: 0, inspect: 0, fix: 0, orchestration: 0, unclassified: 0 };
  let costEq = 0, costEq05 = 0;
  let roundsMissingUsage = 0;
  const perRound = [];

  for (const [id, recs] of byId) {
    const toolUses = [];
    let usage = null;
    for (const r of recs) {
      const content = r.message?.content;
      if (Array.isArray(content)) for (const c of content) if (c && c.type === "tool_use") toolUses.push(c);
      if (!usage && r.message?.usage) usage = r.message.usage;
    }
    const { phase, rawToolCounts, toolCount } = classifyRound(toolUses);
    phaseCounts[phase]++;
    let eq = null, eq05 = null;
    if (usage) {
      const fresh = num(usage.input_tokens) ?? 0;
      const cache = num(usage.cache_read_input_tokens) ?? 0;
      const out = num(usage.output_tokens) ?? 0;
      eq = fresh + COST_CACHE_READ * cache + COST_OUTPUT * out;
      eq05 = fresh + COST_CACHE_READ_05 * cache + COST_OUTPUT * out;
      costEq += eq;
      costEq05 += eq05;
    } else {
      roundsMissingUsage++;
    }
    perRound.push({ messageId: id, phase, rawToolCounts, toolCount, eq, eq05 });
  }

  return {
    rounds: byId.size,
    phaseCounts,
    costEq,
    costEq05,
    missingMessageId,
    roundsMissingUsage,
    perRound,
  };
}

// ── 来源读取 ───────────────────────────────────────────────────────────────
function readSources(args) {
  const root = args.root || resolveMainCheckout();
  const sessionsDir = args.sessionsDir || join(homedir(), ".claude", "projects", "-data-home-yale-work-quay");
  const src = { root, sessionsDir, args };
  const qdir = join(root, ".quay");
  src.workerOutcome = readJsonl(join(qdir, "worker-outcome.jsonl"));
  src.stepTrace = readJsonl(join(qdir, "fan-in-step-trace.jsonl"));
  const scanned = scanSessions(src);
  src.sessions = scanned.sessions;
  src.sessionsScanned = scanned.scanned;
  src.notWorker = scanned.notWorker;
  src.notEvaluatedSessions = scanned.notEvaluated;
  return src;
}

// ── 落地与 fan-in-red（任务级，全量 step-trace）───────────────────────────────
// 落地 = 任务在 fan-in-step-trace.jsonl 中有一条 step=ff 的 step-end 且 ok:true（沿用 E1 的
// ff ok 语义，任务级终态，不按窗口/尝试窗口过滤——台账范围是「落地任务」这个终态属性）。
// fan-in-red = 任务在全量 step-trace 中任一 step-end ok:false（任务级证据）。
function attachFanInFacts(src) {
  const landedTasks = new Set();
  const redTasks = new Set();
  const stepTraceCount = src.stepTrace.length;
  let ffOkCount = 0, redStepCount = 0;
  for (const r of src.stepTrace) {
    if (r.event !== "step-end") continue;
    if (r.step === "ff" && r.ok === true) { landedTasks.add(r.task); ffOkCount++; }
    else if (r.ok === false) { redTasks.add(r.task); redStepCount++; }
  }
  return { landedTasks, redTasks, stepTraceCount, ffOkCount, redStepCount };
}

// ── 返工归因（任务级，广播到返工会话）────────────────────────────────────────
function attributeRework(src, task, landedTasks, redTasks, winStart, winEnd) {
  const attempts = [];
  let crash = false, workerExited = false;
  for (const o of src.workerOutcome) {
    if (o.task !== task) continue;
    const s = parseIso(o.started_at);
    if (s == null) continue;
    if (winStart != null && s < winStart) continue;
    if (winEnd != null && s > winEnd) continue;
    attempts.push(o);
    if (o.final_state === "failed" || o.final_state === "killed" || o.timed_out === true || o.signal != null) crash = true;
    if (o.final_state === "exited-not-landed") workerExited = true;
  }
  if (crash) return "crash-or-timeout";
  if (redTasks.has(task)) return "fan-in-red";
  if (workerExited) return "worker-exited";
  if (landedTasks.has(task)) return "superseded";
  return "unknown";
}

// ── 聚合 ─────────────────────────────────────────────────────────────────────
function buildLedger(src, args) {
  // 窗口默认 = 会话首条时间戳范围
  let minTs = Infinity, maxTs = -Infinity;
  for (const s of src.sessions) {
    if (s.firstTs != null) { minTs = Math.min(minTs, s.firstTs); maxTs = Math.max(maxTs, s.firstTs); }
  }
  const winStart = args.windowStart ? parseIso(args.windowStart) : (minTs === Infinity ? null : minTs);
  const winEnd = args.windowEnd ? parseIso(args.windowEnd) : (maxTs === -Infinity ? null : maxTs);

  const fan = attachFanInFacts(src);

  // 会话窗口三分
  let unwindowed = 0, unwindowedOutside = 0, unwindowedMissing = 0;
  const inWindow = [];
  for (const s of src.sessions) {
    const m = windowMembership(s.firstTs, winStart, winEnd);
    if (m !== "inside") {
      unwindowed++;
      if (m === "missing") unwindowedMissing++; else unwindowedOutside++;
      continue;
    }
    if (args.task && s.task !== args.task) continue;
    inWindow.push(s);
  }

  // 逐会话分析
  const sessionsByTask = new Map();
  let totalRounds = 0, totalCostEq = 0, totalCostEq05 = 0;
  let totalMissingMessageId = 0, totalRoundsMissingUsage = 0;
  const globalPhaseCounts = { verify: 0, edit: 0, inspect: 0, fix: 0, orchestration: 0, unclassified: 0 };

  for (const s of inWindow) {
    const text = readFileSafe(join(src.sessionsDir, s.file));
    const a = text == null
      ? { rounds: null, phaseCounts: null, costEq: null, costEq05: null, missingMessageId: 0, roundsMissingUsage: 0, perRound: [] }
      : analyzeSession(text);
    if (a.rounds != null) {
      totalRounds += a.rounds;
      totalCostEq += a.costEq;
      totalCostEq05 += a.costEq05;
      totalMissingMessageId += a.missingMessageId;
      totalRoundsMissingUsage += a.roundsMissingUsage;
      for (const p of Object.keys(globalPhaseCounts)) globalPhaseCounts[p] += a.phaseCounts[p];
    }
    if (!sessionsByTask.has(s.task)) sessionsByTask.set(s.task, []);
    sessionsByTask.get(s.task).push({ ...s, ...a });
  }

  // 范围 = 落地任务。有 worker 会话但 step-trace 无 ff ok 的任务 ⇒ 落地 not-evaluated
  // （缺值 = 未查，⛔ 不是「已失败」，也不是「0 个落地」——单列）。
  const landedTaskIds = new Set();
  const landingNotEvaluatedTaskIds = new Set();
  for (const [task] of sessionsByTask) {
    if (fan.landedTasks.has(task)) landedTaskIds.add(task);
    else landingNotEvaluatedTaskIds.add(task);
  }

  // perTask（只含落地任务）
  const perTask = [];
  for (const [task, sessions] of sessionsByTask) {
    if (!fan.landedTasks.has(task)) continue;
    const sessWithRounds = sessions.filter((s) => s.rounds != null);
    const taskRounds = sessWithRounds.reduce((sum, s) => sum + s.rounds, 0);
    const taskCost = sessWithRounds.reduce((sum, s) => sum + s.costEq, 0);
    const taskCost05 = sessWithRounds.reduce((sum, s) => sum + s.costEq05, 0);
    const phases = { verify: 0, edit: 0, inspect: 0, fix: 0, orchestration: 0, unclassified: 0 };
    for (const s of sessWithRounds) for (const p of Object.keys(phases)) phases[p] += s.phaseCounts[p];
    const reworkReason = sessions.length >= 2 ? attributeRework(src, task, fan.landedTasks, fan.redTasks, winStart, winEnd) : null;
    // 会话级下钻（AC4）：按首条时间戳排序，最后一条 = 落地会话，其余 = 返工会话。
    const sessionDetails = [...sessions].sort((a, b) => (a.firstTs ?? 0) - (b.firstTs ?? 0)).map((s, i, arr) => ({
      sessionId: s.sessionId,
      rounds: s.rounds,
      costEq: s.costEq,
      phases: s.phaseCounts,
      isLandingSession: i === arr.length - 1,
    }));
    perTask.push({ task, sessions: sessions.length, reworkSessions: Math.max(0, sessions.length - 1), rounds: taskRounds, costEq: taskCost, costEq05: taskCost05, phases, reworkReason, sessionDetails });
  }
  perTask.sort((a, b) => b.rounds - a.rounds);

  // 返工台账：每个非首次会话
  const reworkLedger = [];
  const reworkCounts = { "crash-or-timeout": 0, "fan-in-red": 0, "worker-exited": 0, superseded: 0, unknown: 0 };
  let reworkSessionCount = 0;
  for (const t of perTask) {
    if (t.reworkReason == null) continue;
    reworkCounts[t.reworkReason] += t.reworkSessions;
    reworkSessionCount += t.reworkSessions;
    reworkLedger.push({ task: t.task, reason: t.reworkReason, reworkSessions: t.reworkSessions, rounds: t.rounds });
  }

  // 落地证据不足的任务（有 worker 会话但无 step-trace ff ok）——单列（not-evaluated）
  const landingNotEvaluatedTasks = [...landingNotEvaluatedTaskIds].map((task) => {
    const sessions = sessionsByTask.get(task);
    return { task, sessions: sessions.length, rounds: sessions.reduce((sum, s) => sum + (s.rounds ?? 0), 0) };
  }).sort((a, b) => b.rounds - a.rounds);

  return {
    winStart, winEnd,
    sessionsScanned: src.sessionsScanned,
    notWorker: src.notWorker,
    notEvaluatedSessions: src.notEvaluatedSessions,
    unwindowed, unwindowedOutside, unwindowedMissing,
    sessionsTotal: inWindow.length,
    tasksTotal: landedTaskIds.size,
    landingNotEvaluatedCount: landingNotEvaluatedTaskIds.size,
    totalRounds,
    totalCostEq,
    totalCostEq05,
    roundsPerTask: landedTaskIds.size ? totalRounds / landedTaskIds.size : null,
    totalMissingMessageId,
    totalRoundsMissingUsage,
    globalPhaseCounts,
    perTask,
    reworkLedger,
    reworkCounts,
    reworkSessionCount,
    landingNotEvaluatedTasks,
    fan,
  };
}

// ── 输入指纹 ───────────────────────────────────────────────────────────────
function inputFingerprint(src, args, ctx) {
  const codeVer = sha256(readFileSafe(new URL(import.meta.url).pathname) || "");
  const canon = JSON.stringify({
    window: [ctx.winStart, ctx.winEnd],
    counts: {
      sessionsScanned: src.sessionsScanned,
      workerSessions: src.sessions.length,
      notEvaluated: src.notEvaluatedSessions,
      workerOutcome: src.workerOutcome.length,
      stepTrace: src.stepTrace.length,
    },
  });
  return { codeSha256: codeVer, codeSha256Short: codeVer.slice(0, 12), inputSha256: sha256(canon), inputSha256Short: sha256(canon).slice(0, 12) };
}

// ── 渲染 ───────────────────────────────────────────────────────────────────
function fmtNum(x) { return typeof x === "number" && Number.isFinite(x) ? String(Math.round(x)) : "not-evaluated"; }
function fmtM(x) { return typeof x === "number" && Number.isFinite(x) ? (x / 1e6).toFixed(3) + "M" : "not-evaluated"; }

function renderMarkdown(args, src, ctx, fp) {
  const L = [];
  const p = (...xs) => L.push(xs.join(""));
  const winStartIso = ctx.winStart != null ? new Date(ctx.winStart).toISOString() : "n/a";
  const winEndIso = ctx.winEnd != null ? new Date(ctx.winEnd).toISOString() : "n/a";
  const gitHead = (() => { const r = spawnSync("git", ["-C", src.root, "rev-parse", "HEAD"], { encoding: "utf8" }); return r.status === 0 && r.stdout.trim() ? r.stdout.trim().slice(0, 12) : "n/a"; })();

  p("# 轮数台账（按落地任务）\n");
  p("> 只读、可复跑。本文件由 `scripts/rounds-ledger.mjs` 生成。\n");
  p("> 轮 = 按 `message.id` 去重后的 assistant 消息；落地 = fan-in-step-trace 的 `ff` 步骤 `ok:true`。\n");

  p("\n## 复跑命令\n");
  p("```bash\n");
  p("node scripts/rounds-ledger.mjs --root ", src.root, " --sessions-dir ", src.sessionsDir,
    " --window-start ", winStartIso, " --window-end ", winEndIso, "\n");
  p("```\n");
  p("\n窗口（含）：`", winStartIso, "` → `", winEndIso, "`（UTC）。\n");
  p("代码版本 / 输入指纹：git HEAD=`", gitHead, "`，脚本 sha256=`", fp.codeSha256Short, "`，输入 sha256=`", fp.inputSha256Short, "`。\n");

  p("\n## 基线复现（AC3）\n");
  p("| 量 | 值 | 目标 |\n|---|---|---|\n");
  p("| 落地任务数 | ", String(ctx.tasksTotal), " | 94 |\n");
  p("| worker 会话数 | ", String(ctx.sessionsTotal), " | 129 |\n");
  p("| 轮数 | ", String(ctx.totalRounds), " | 10,392 |\n");
  p("| 轮 / 任务 | ", ctx.roundsPerTask != null ? ctx.roundsPerTask.toFixed(2) : "not-evaluated", " | 110.6 |\n");
  p("| 加权 eq（0.1×/5×） | ", fmtM(ctx.totalCostEq), " | 185.8M |\n");
  p("| 加权 eq（0.05×/5×） | ", fmtM(ctx.totalCostEq05), " | （仅记录） |\n");

  p("\n## 数据来源\n");
  p("| 来源 | 记录数 | 用途 |\n|---|---|---|\n");
  p("| 会话文件（扫描） | ", String(ctx.sessionsScanned), " | 会话→任务 / 轮数 / 阶段 / 成本 |\n");
  p("| 其中非 worker 会话 | ", String(ctx.notWorker), " | 排除 |\n");
  p("| worker 但读不到 Task id（not-evaluated） | ", String(ctx.notEvaluatedSessions), " | 单列，不猜 |\n");
  p("| 窗口外/缺时间戳会话（unwindowed） | ", String(ctx.unwindowed), "（窗口外 ", String(ctx.unwindowedOutside), "，缺时间戳 ", String(ctx.unwindowedMissing), "） | 不计入窗口读数 |\n");
  p("| worker-outcome.jsonl | ", String(src.workerOutcome.length), " | 返工归因 |\n");
  p("| fan-in-step-trace.jsonl | ", String(ctx.fan.stepTraceCount), " | 落地 / fan-in-red（任务级，全量） |\n");
  p("| 全量 ff ok 事件 | ", String(ctx.fan.ffOkCount), " | 落地证据 |\n");
  p("| 全量 ok:false 步骤 | ", String(ctx.fan.redStepCount), " | fan-in-red 证据 |\n");

  p("\n## 全局阶段占比（AC4）\n");
  p("> 阶段是启发式（每轮 = 一条按 message.id 去重后的 assistant 消息）；无工具/无法映射的轮单列 unclassified。\n");
  p("| 阶段 | 轮数 | 占比 |\n|---|---|---|\n");
  const order = ["verify", "edit", "inspect", "fix", "orchestration", "unclassified"];
  for (const ph of order) {
    const c = ctx.globalPhaseCounts[ph] || 0;
    const share = ctx.totalRounds ? (c / ctx.totalRounds * 100).toFixed(1) + "%" : "not-evaluated";
    p("| ", ph, " | ", String(c), " | ", share, " |\n");
  }
  p("\n- 总轮数：", String(ctx.totalRounds), "；缺 message.id 逐条计 1 轮的记录：", String(ctx.totalMissingMessageId), "；缺 usage 的轮（成本 not-evaluated）：", String(ctx.totalRoundsMissingUsage), "\n");

  p("\n## top 10 任务阶段拆解（AC4）\n");
  p("| task | 会话 | 轮 | eq(0.1×) | verify | edit | inspect | fix | orchestration | unclassified | 返工 |\n|---|---|---|---|---|---|---|---|---|---|---|\n");
  for (const t of ctx.perTask.slice(0, 10)) {
    p("| ", t.task, " | ", String(t.sessions), " | ", String(t.rounds), " | ", fmtM(t.costEq), " | ",
      String(t.phases.verify), " | ", String(t.phases.edit), " | ", String(t.phases.inspect), " | ",
      String(t.phases.fix), " | ", String(t.phases.orchestration), " | ", String(t.phases.unclassified), " | ",
      t.reworkReason ?? "—", " |\n");
  }

  p("\n## 会话级下钻（AC4，top 1 任务）\n");
  if (ctx.perTask.length > 0) {
    const top = ctx.perTask[0];
    p("任务：`", top.task, "`（", String(top.sessions), " 会话，", String(top.rounds), " 轮）\n");
    p("| 会话 | 轮 | verify | edit | inspect | fix | orchestration | unclassified | 结局 |\n|---|---|---|---|---|---|---|---|---|\n");
    for (const s of top.sessionDetails) {
      const outcome = s.isLandingSession ? "landed" : (top.reworkReason ?? "rework");
      p("| ", s.sessionId, " | ", String(s.rounds ?? "not-evaluated"), " | ",
        String(s.phases?.verify ?? 0), " | ", String(s.phases?.edit ?? 0), " | ",
        String(s.phases?.inspect ?? 0), " | ", String(s.phases?.fix ?? 0), " | ",
        String(s.phases?.orchestration ?? 0), " | ", String(s.phases?.unclassified ?? 0), " | ", outcome, " |\n");
    }
  }

  p("\n## 返工台账（AC5）\n");
  p("> 非首次会话按任务级归因后广播到每个返工会话；unknown 单列、不并入已知类。\n");
  p("| 原因 | 返工会话数 | 占比 |\n|---|---|---|\n");
  for (const [reason, count] of Object.entries(ctx.reworkCounts)) {
    const share = ctx.reworkSessionCount ? (count / ctx.reworkSessionCount * 100).toFixed(1) + "%" : "not-evaluated";
    p("| ", reason, " | ", String(count), " | ", share, " |\n");
  }
  p("\n- 返工会话总数：", String(ctx.reworkSessionCount), "；落地证据不足的任务（有会话但无 step-trace ff ok，not-evaluated）单列：", String(ctx.landingNotEvaluatedCount), "\n");
  if (ctx.reworkLedger.length > 0) {
    p("| task | 原因 | 返工会话 | 轮 |\n|---|---|---|---|\n");
    for (const r of ctx.reworkLedger) p("| ", r.task, " | ", r.reason, " | ", String(r.reworkSessions), " | ", String(r.rounds), " |\n");
  }
  if (ctx.landingNotEvaluatedTasks.length > 0) {
    p("\n落地证据不足的任务（有 worker 会话但 step-trace 无 ff ok ⇒ not-evaluated，⛔ 不是已失败）：\n");
    for (const t of ctx.landingNotEvaluatedTasks) p("- `", t.task, "`（", String(t.sessions), " 会话，", String(t.rounds), " 轮）\n");
  }

  return L.join("");
}

function renderJson(args, src, ctx, fp) {
  return JSON.stringify({
    window: { start: ctx.winStart ? new Date(ctx.winStart).toISOString() : null, end: ctx.winEnd ? new Date(ctx.winEnd).toISOString() : null },
    fingerprint: fp,
    sources: {
      sessionsScanned: ctx.sessionsScanned,
      notWorker: ctx.notWorker,
      notEvaluatedSessions: ctx.notEvaluatedSessions,
      unwindowed: ctx.unwindowed,
      unwindowedOutside: ctx.unwindowedOutside,
      unwindowedMissing: ctx.unwindowedMissing,
      workerOutcome: src.workerOutcome.length,
      stepTrace: src.stepTrace.length,
    },
    landing: { landedTasks: ctx.fan.landedTasks.size, ffOkCount: ctx.fan.ffOkCount, redStepCount: ctx.fan.redStepCount, redTasks: ctx.fan.redTasks.size },
    summary: {
      sessionsTotal: ctx.sessionsTotal,
      tasksTotal: ctx.tasksTotal,
      totalRounds: ctx.totalRounds,
      roundsPerTask: round1(ctx.roundsPerTask, 3),
      costEq: ctx.totalCostEq,
      costEq05: ctx.totalCostEq05,
      totalMissingMessageId: ctx.totalMissingMessageId,
      totalRoundsMissingUsage: ctx.totalRoundsMissingUsage,
      phaseCounts: ctx.globalPhaseCounts,
      reworkCounts: ctx.reworkCounts,
      reworkSessionCount: ctx.reworkSessionCount,
    },
    perTask: ctx.perTask.map((t) => ({ task: t.task, sessions: t.sessions, rounds: t.rounds, costEq: t.costEq, phases: t.phases, reworkReason: t.reworkReason, sessionDetails: t.sessionDetails })),
    reworkLedger: ctx.reworkLedger,
    landingNotEvaluatedTasks: ctx.landingNotEvaluatedTasks,
  }, null, 2);
}

// ── main ────────────────────────────────────────────────────────────────────
function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { process.stdout.write(HELP); return 0; }
  const src = readSources(args);
  const ctx = buildLedger(src, args);
  const fp = inputFingerprint(src, args, ctx);
  if (args.json) process.stdout.write(renderJson(args, src, ctx, fp) + "\n");
  else process.stdout.write(renderMarkdown(args, src, ctx, fp));
  return 0;
}

import { pathToFileURL } from "node:url";
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = main(process.argv.slice(2));

export {
  parseArgs, readSources, buildLedger, analyzeSession, classifyRound, classifyToolPhase, classifyBashPhase,
  scanSessions, firstUserMessageText, sessionFirstTsMs, windowMembership, tsToMs, parseIso, median,
  attachFanInFacts, attributeRework, inputFingerprint, PHASES,
};
