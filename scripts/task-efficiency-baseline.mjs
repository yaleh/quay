#!/usr/bin/env node
// task-efficiency-baseline.mjs — task-level end-to-end efficiency baseline (E1).
//
// 只读、可复跑。把「任务→尝试→会话→fan-in run→suite run→落地 SHA」关联起来，分别报告
// 费用 / 时间 / 计算。⛔ 不改调度、模型、上下文 cap 或任何质量门；只读真实遥测，缺失即
// not-evaluated（缺值 = 未查，不与 0/成功共用取值）。
//
// 数据来源（全部只读）：
//   worker-outcome.jsonl    尝试级记录（task, started_at, ended_at, wall_clock_ms, run_id, final_state）
//   .quay/fan-in-<task>-<runIdSafe>.log    fan-in 过程日志（per-step wall_ms：acquire-fan-in-lock /
//                            merge-develop / delta / typecheck / scoped-gate / suite-start / suite-end / ff …）
//   .quay/fan-in-lock-events.jsonl         fan-in 锁 acquire/release 事件
//   .quay/verification-round.jsonl         suite run 记录（round/durationMs/lock_wait_ms/lock_hold_ms/
//                            cpu_time_s/cpu_source/taskId/runId/terminalCommit/commit/…）
//   milestones/fast-mode-telemetry/*.json  每日任务快照（taskId/runId/minutes/outcome/fanInCommit）
//   .workflow-events/fm-<runId>.jsonl      per-run start/end 事件（queuedAtMs/startedAtMs/endedAtMs）
//   <sessions-dir>/*.jsonl                 Claude Code 会话（worker 会话 = 首条 user 消息以
//                            "You are a per-task worker" 开头且含 "Task: <id>"）
//   --csv                                 用户费用 CSV（缺省不传 ⇒ 费用维度 not-evaluated）
//
// 身份规则（E2 可复用）：
//   · task        = taskId 字符串（唯一键，任务文件 id）
//   · attempt     = (task, started_at) —— ⛔ run_id 不是尝试键：常驻 driver 的 run_id 是进程级常量，
//                  同一 run_id 被多个 task、多次尝试复用（本工具会计量 run_id 复用并告警）
//   · session     = sessionId（jsonl 文件名去后缀）；worker 会话通过首条 user 消息的 "Task: <id>" 归属任务
//   · fan-in run  = fan-in-<task>-<runIdSafe>.log 内落在某次尝试 [started_at, ended_at] 窗口的步骤
//   · suite run   = verification-round.jsonl 的一条记录（以 round 为唯一身份）
//   · landing     = 目标 ref（develop）成功更新的直接事件：fan-in 日志中 ok:true 的 ff 步骤。
//                   ⛔ verification-round 的 commit/terminalCommit 只是「受测 SHA」，不是落地证据；
//                   ⛔ final_state=completed 与 suite green 都不是落地证据。
//
// 关联结果三分（Plan §2）：proven（已证明关联）/ ambiguous（无法唯一关联）/ missing（数据缺失）。
// 只有 proven 的记录参与确定归属聚合（CPU 合计、验证时长、suite 覆盖）；ambiguous/missing 单列。
//
// 输出：默认 markdown（人类可读报告，可直接落盘 docs/analysis/task-efficiency-baseline.md），
//       --json 输出机器可核的 JSON（AC 覆盖用）。
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

// ── 常量 ─────────────────────────────────────────────────────────────────────
const HELP = `task-efficiency-baseline — task-level end-to-end efficiency baseline (E1)

usage: node scripts/task-efficiency-baseline.mjs [flags]

只读报告：关联 task → attempt → session → fan-in run → suite run → landing，
分开报告 费用/时间/计算。缺失维度明确 not-evaluated，绝不把缺失当 0/成功。

flags:
  --root <dir>         主检出根（遥测在 <dir>/.quay/ 与 <dir>/milestones/）。
                       缺省：从本脚本位置解析 git common dir 得到主检出。
  --sessions-dir <dir> Claude Code 会话目录。缺省 ~/.claude/projects/-data-home-yale-work-quay
  --csv <path>         用户费用 CSV（含 attempt→cost 映射）。不传 ⇒ 费用维度 not-evaluated。
  --window-start <iso> 窗口起点（含，ISO8601）。缺省 = 数据全集最早 started_at。
  --window-end <iso>   窗口终点（含，ISO8601）。缺省 = 数据全集最晚 ended_at。
  --task <id>          只分析单个任务（抽查用）。
  --json               输出 JSON（机器可核）。
  --help               本帮助，exit 0。

身份关联规则（E2 复用面）：
  attempt 键 = (task, started_at)；run_id 是 driver 进程级常量，⛔ 不是尝试键。
  fan-in 步骤按尝试窗口 [started_at, ended_at] 归属；窗口外/无日志 ⇒ 未归属（不兜底）。
  suite 记录以 round 为唯一身份，按 (taskId, startedAt) 关联尝试窗口；缺 taskId/startedAt ⇒
    无法唯一关联（单独计量）；窗口内无唯一证据 ⇒ 不回填同 task 的全部历史 recs。
  landing 证据 = fan-in 日志中 ok:true 的 ff 步骤（目标 ref 成功更新的直接事件）∪
    fan-in-step-trace.jsonl 中 step=ff 的 step-end ok:true（近期 run 缺 .log 载体时由此补充）。
    两处都读到按 (task, runId) 归并计一次（来源 log/step-trace/both）；两处都没有 ⇒ unknown。
    verification-round.commit / terminalCommit（受测 SHA）、suite green、final_state=completed
    都不构成落地证明；无法确认的样本显式 unknown，不并入成功分母，也不说成已失败。

轮数口径（E1 计数修正）：
  轮 = 按 message.id 去重后的 assistant 消息。同一个 message.id 会被 apiBlockIndex 拆成多条
  assistant jsonl 记录（thinking/text/tool_use 各一条），按行数会把一轮多 block 重复计；
  本工具合并同 id 的全部 block 后再计 1 轮（分类取该轮工具动作并集）。缺 message.id 的记录
  逐条计 1 轮，写进独立的 roundsMissingId 计数器，⛔ 不与去重后的轮数合并。

时间口径：wall-clock 用记录自带时间戳差；CPU-seconds 只取 cpu_time_s 且
  cpu_source=gnu-time 的实测值，⛔ 不用 wall-time 换算。

窗口语义（每小节独立，同一 --window-start/--window-end 过滤口径）：
  attempts/summary    按 worker-outcome.started_at（既有行为）。
  rounds（会话轮数）  按会话首条记录时间戳过滤；窗口外/缺时间戳的会话单列 unwindowed，不计入窗口读数。
  e5.queueDelay       按 workflow-event.recordedAtMs 过滤；窗口外/缺 recordedAtMs 的记录单列 queueUnwindowed。
  e5.stopReason       按 worker-round.ts 过滤；窗口外/缺 ts 的记录单列 stopReasonUnwindowed。
  unwindowed          窗口外或取不到时间戳的记录——「无法评估」有独立取值（missing）与「窗口外」（outside）
                      分列，⛔ 不与「已按窗口统计」的读数共用输出，也不得静默丢弃成 0/成功。
`;

// fan-in 日志文件名（与 worker-fan-in.ts 的 fanInLogFileName 同形：runId 非 [A-Za-z0-9_.-] 换成 _）。
function fanInLogFileName(task, runId) {
  const runIdSafe = String(runId).replace(/[^A-Za-z0-9_.-]/g, "_");
  return `fan-in-${task}-${runIdSafe}.log`;
}

// ── 小工具 ───────────────────────────────────────────────────────────────────
function readFileSafe(p) {
  try { return readFileSync(p, "utf8"); } catch { return null; }
}
// 流式统计 gate-events.jsonl 的 gate 种类（大文件，不整读 JSON；坏行跳过）。
function countGateEventKinds(p) {
  const counts = {};
  let text;
  try { text = readFileSync(p, "utf8"); } catch { return counts; }
  const re = /"gate":"([^"]+)"/g;
  let m;
  while ((m = re.exec(text)) !== null) counts[m[1]] = (counts[m[1]] || 0) + 1;
  return counts;
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
// 时间戳统一到 epoch ms：ISO 字符串走 Date.parse，数字按 epoch ms（如 workflow-event 的 recordedAtMs）。
function tsToMs(x) {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string") return parseIso(x);
  return null;
}
// 窗口归属三分（缺值 = 未查，不得与「在窗口内」共用取值）：
//   inside   在窗口内（或未指定窗口 ⇒ 全集）
//   outside  有时间戳但落在窗口外
//   missing  取不到时间戳（无法评估）
function windowMembership(tsMs, winStart, winEnd) {
  if (winStart == null && winEnd == null) return "inside";
  if (tsMs == null) return "missing";
  if (winStart != null && tsMs < winStart) return "outside";
  if (winEnd != null && tsMs > winEnd) return "outside";
  return "inside";
}
function pct(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}
function median(sorted) {
  if (sorted.length === 0) return null;
  if (sorted.length % 2 === 1) return sorted[Math.floor(sorted.length / 2)];
  const a = sorted[sorted.length / 2 - 1], b = sorted[sorted.length / 2];
  return (a + b) / 2;
}
function fmtMs(ms) {
  if (ms == null) return "not-evaluated";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}
function fmtSec(s) {
  if (s == null) return "not-evaluated";
  if (s < 60) return `${s.toFixed(1)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}min`;
  return `${(s / 3600).toFixed(2)}h`;
}
function inventoryFields(records) {
  const fields = new Map(); // field -> count present
  for (const r of records) {
    for (const k of Object.keys(r)) {
      if (r[k] !== undefined && r[k] !== null) fields.set(k, (fields.get(k) || 0) + 1);
    }
  }
  return fields;
}
function num(x) { return typeof x === "number" && Number.isFinite(x) ? x : null; }
function sha256(s) { return createHash("sha256").update(s).digest("hex"); }

// 解析主检出根：worktree 的 git common dir = <主检出>/.git。
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
  const args = {
    root: null, sessionsDir: null, csv: null,
    windowStart: null, windowEnd: null, task: null, json: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => (i + 1 < argv.length ? argv[++i] : null);
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--json") args.json = true;
    else if (a === "--root") args.root = next();
    else if (a === "--sessions-dir") args.sessionsDir = next();
    else if (a === "--csv") args.csv = next();
    else if (a === "--window-start") args.windowStart = next();
    else if (a === "--window-end") args.windowEnd = next();
    else if (a === "--task") args.task = next();
  }
  return args;
}

// ── 来源读取 ───────────────────────────────────────────────────────────────
function readSources(args) {
  const root = args.root || resolveMainCheckout();
  const sessionsDir = args.sessionsDir || join(homedir(), ".claude", "projects", "-data-home-yale-work-quay");
  const src = { root, sessionsDir, csv: args.csv };

  // 1) worker-outcome.jsonl
  src.workerOutcome = readJsonl(join(root, ".quay", "worker-outcome.jsonl"));

  // 2) fan-in 过程日志（按磁盘扫描，去重）。
  // ⛔ 不能按文件名排除 "suite"：`fan-in-<task>-<runIdSafe>.log` 的 task 名里含 "suite" 是合法任务
  // （如 gap-*-suite-*），旧 `!f.includes("suite")` 会把它们的落地/套件日志整体排除，制造「缺 .log 载体」假象。
  const qdir = join(root, ".quay");
  src.fanInTraceFiles = readdirSync(qdir).filter((f) => f.startsWith("fan-in-") && f.endsWith(".log"));
  const traceByName = new Map();
  for (const f of src.fanInTraceFiles) {
    const records = readJsonl(join(qdir, f)).filter((r) => typeof r.step === "string");
    if (records.length > 0) traceByName.set(f, records);
  }
  src.fanInTraceByName = traceByName;

  // 2c) fan-in-step-trace.jsonl —— 近期 run 缺 .log 载体时的落地证据补充（step=ff 的 step-end ok:true）。
  src.stepTrace = readJsonl(join(qdir, "fan-in-step-trace.jsonl"));

  // 3) fan-in-lock-events.jsonl
  src.fanInLockEvents = readJsonl(join(qdir, "fan-in-lock-events.jsonl"));

  // 4) verification-round.jsonl
  src.verificationRound = readJsonl(join(qdir, "verification-round.jsonl"));

  // 4b) worker-round.jsonl（每轮派发环的 stop_reason：pool-empty / resource-gate-wait / filtered-empty /
  //     backoff / mcp-halt —— AC5 的资源门拒绝与 ready 池空证据）
  src.workerRound = readJsonl(join(qdir, "worker-round.jsonl"));

  // 4c) gate-events.jsonl（205MB 级，流式只数 gate 类型，不整读）—— ready 事件 = gate=promote。
  src.gateEventCounts = countGateEventKinds(join(qdir, "gate-events.jsonl"));

  // 5) fast-mode telemetry（每日快照是【累计】的——windowStart 固定、tasks 数组逐日累积到 340 封顶。
  //    按 runId 去重、保留【最后一次】出现（最新快照的 fanInCommit 才是终值）。⛔ 其 runId 是 `fm-*`
  //    空间，与 worker-outcome 的 `wk-prod-*` 不同 ⇒ 只盘点、不 join 到 worker-driver 尝试。）
  src.fastModeTelemetry = [];
  const tdir = join(root, "milestones", "fast-mode-telemetry");
  if (existsSync(tdir)) {
    const byRunId = new Map();
    const files = readdirSync(tdir).filter((x) => x.endsWith(".json")).sort();
    for (const f of files) {
      const j = readFileSafe(join(tdir, f));
      if (j == null) continue;
      try {
        const o = JSON.parse(j);
        if (Array.isArray(o.tasks)) for (const t of o.tasks) if (t.runId) byRunId.set(t.runId, { ...t, _file: f });
      } catch { /* skip */ }
    }
    src.fastModeTelemetry = [...byRunId.values()];
  }

  // 6) workflow events
  src.workflowEvents = [];
  const wdir = join(root, ".workflow-events");
  if (existsSync(wdir)) {
    for (const f of readdirSync(wdir).filter((x) => x.startsWith("fm-") && x.endsWith(".jsonl"))) {
      src.workflowEvents.push(...readJsonl(join(wdir, f)));
    }
  }

  // 7) 会话
  src.workerSessions = [];
  if (existsSync(sessionsDir)) {
    for (const f of readdirSync(sessionsDir).filter((x) => x.endsWith(".jsonl"))) {
      const p = join(sessionsDir, f);
      const text = readFileSafe(p);
      if (text == null) continue;
      const firstUser = firstUserMessageText(text);
      if (firstUser && /^You are a per-task worker in the quay repo/.test(firstUser)) {
        const m = /Task:\s*([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)/.exec(firstUser);
        if (m) {
          src.workerSessions.push({ sessionId: f.replace(/\.jsonl$/, ""), task: m[1].replace(/\.$/, ""), file: f, firstUser });
        }
      }
    }
  }

  // 8) CSV（可选）
  src.csvPresent = src.csv != null && existsSync(src.csv);
  src.csvRecords = [];
  if (src.csvPresent) {
    src.csvRecords = parseCsv(readFileSafe(src.csv));
  }

  return src;
}

function firstUserMessageText(text) {
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type === "user") {
      const c = o.message?.content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) return c.map((x) => x.text || "").join("");
      return "";
    }
  }
  return null;
}

// 会话首条记录时间戳：逐行找第一条带可解析 `timestamp` 字段的记录（worker 会话 = queue-operation enqueue）。
// 取不到 ⇒ null（由窗口归属函数落为 missing，⛔ 不静默丢弃）。
function sessionFirstTsMs(text) {
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.timestamp === undefined || o.timestamp === null) continue;
    const t = tsToMs(o.timestamp);
    if (t != null) return t;
  }
  return null;
}

// 极简 CSV（header 行 + 逗号分隔）。只取首行表头；无表头 ⇒ 空数组（费用维度 not-evaluated）。
function parseCsv(text) {
  if (text == null) return [];
  const lines = text.trim().split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim());
    const rec = {};
    header.forEach((h, j) => { rec[h] = cells[j]; });
    out.push(rec);
  }
  return out;
}

// ── 窗口与尝试 ─────────────────────────────────────────────────────────────
function buildAttempts(src, args) {
  // 窗口默认 = 全集范围
  let minStart = Infinity, maxEnd = -Infinity;
  for (const o of src.workerOutcome) {
    const s = parseIso(o.started_at), e = parseIso(o.ended_at);
    if (s != null) minStart = Math.min(minStart, s);
    if (e != null) maxEnd = Math.max(maxEnd, e);
  }
  const winStart = args.windowStart ? parseIso(args.windowStart) : (minStart === Infinity ? null : minStart);
  const winEnd = args.windowEnd ? parseIso(args.windowEnd) : (maxEnd === -Infinity ? null : maxEnd);

  // 尝试 = worker-outcome 落在窗口内（按 started_at）的记录，键 = (task, started_at, ts)
  const seen = new Set();
  const attempts = [];
  const duplicates = [];
  let missingStart = 0; // 缺 started_at（缺值 = 未查，⛔ 不是 0，也不静默丢弃——单独计数）
  let missingEnd = 0;   // 缺 ended_at（尝试可纳入，但时长 not-evaluable）
  for (const o of src.workerOutcome) {
    const s = parseIso(o.started_at);
    if (s == null) { missingStart++; continue; }
    if (winStart != null && s < winStart) continue;
    if (winEnd != null && s > winEnd) continue;
    const key = `${o.task}\u0000${o.started_at}\u0000${o.ts}`;
    if (seen.has(key)) { duplicates.push(o); continue; }
    seen.add(key);
    if (parseIso(o.ended_at) == null) missingEnd++;
    attempts.push({ ...o, startedAtMs: s, endedAtMs: parseIso(o.ended_at) });
  }
  attempts.sort((a, b) => a.startedAtMs - b.startedAtMs);

  // run_id 复用计量
  const runIdTasks = new Map();
  for (const a of attempts) {
    if (!runIdTasks.has(a.run_id)) runIdTasks.set(a.run_id, new Set());
    runIdTasks.get(a.run_id).add(a.task);
  }
  const reusedRunIds = [...runIdTasks.entries()].filter(([, s]) => s.size > 1).length;

  return { winStart, winEnd, attempts, duplicates, reusedRunIds, missingStart, missingEnd };
}

// fan-in 步骤归属：按尝试窗口从 fan-in-<task>-<runIdSafe>.log 选记录。
// 落地证据补充：fan-in-step-trace.jsonl 的 step=ff step-end ok:true（按 (task, runId) 归并）。
// ff 发生在 worker 的 ended_at 之后（driver 在 worker 退出后再 fan-in），⛔ 不能以 ended_at 作上界
// 过滤落地证据 —— 只保留下界 started_at；「只归给该任务最后一条尝试」的门控在 attachLanding。
function attachFanInTrace(src, attempts) {
  // step-trace ff-ok 索引：按 `task\u0000runId` 归并，同一 (task, runId) 的重复 ff ok 只作一次存在性判定。
  const stepFfOkByKey = new Map();
  for (const r of (src.stepTrace || [])) {
    if (r.event !== "step-end" || r.step !== "ff" || r.ok !== true) continue;
    const key = `${r.task}\u0000${String(r.runId)}`;
    if (!stepFfOkByKey.has(key)) stepFfOkByKey.set(key, []);
    stepFfOkByKey.get(key).push(r);
  }

  for (const a of attempts) {
    a.trace = [];
    a.traceSource = null;
    a.traceAvailable = false;
    a.fanInLockWaitMs = null;
    a.suiteExecMs = null;
    a.suiteSkipped = false;
    a.fanInStepMs = {};
    a.ffOkLog = false;
    a.ffOkStepTrace = false;
    a.releaseOk = false;

    // step-trace 落地证据（不依赖 .log 载体；只保留下界 started_at，上界留给 attachLanding 的最后尝试门控）。
    const stepRecs = stepFfOkByKey.get(`${a.task}\u0000${String(a.run_id)}`) || [];
    const stepInWin = stepRecs.filter((r) => {
      const t = parseIso(r.ts);
      return t != null && (a.startedAtMs == null || t >= a.startedAtMs);
    });
    a.ffOkStepTrace = stepInWin.length > 0;

    const file = fanInLogFileName(a.task, a.run_id);
    const records = src.fanInTraceByName.get(file);
    if (!records) {
      a.suiteOutcome = "missing-log";
    } else {
      a.traceAvailable = true;
      a.traceSource = file;
      const inWin = records.filter((r) => {
        const t = parseIso(r.ts);
        return t != null && (a.startedAtMs == null || t >= a.startedAtMs) && (a.endedAtMs == null || t <= a.endedAtMs);
      });
      a.trace = inWin;
      // ff 落地证据：只保留下界 started_at（ff 可能晚于 ended_at）。
      const ffRecs = records.filter((r) => {
        const t = parseIso(r.ts);
        return t != null && (a.startedAtMs == null || t >= a.startedAtMs);
      });
      a.ffOkLog = ffRecs.some((r) => r.step === "ff" && r.ok === true);
      a.releaseOk = inWin.some((r) => r.step === "release-fan-in-lock");
      a.fanInLockWaitMs = stepWall(a.trace, "acquire-fan-in-lock");
      a.suiteExecMs = stepWall(a.trace, "suite-end") ?? stepWall(a.trace, "suite-start") ?? null;
      a.suiteSkipped = a.trace.some((r) => r.step === "suite-skip");
      a.fanInStepMs = {};
      for (const r of a.trace) {
        if (typeof r.wall_ms === "number") a.fanInStepMs[r.step] = (a.fanInStepMs[r.step] || 0) + r.wall_ms;
      }
      a.suiteOutcome = classifySuiteOutcome(a.trace);
    }
  }
}

// suite 结局分类（AC5）：每个尝试的 fan-in run 只能落在互斥的一类。
//   missing-log          无 fan-in 日志（缺日志）
//   classifier-failure   分类器【明确】失败证据（instrument-probe ok≠true 或 classifier=unavailable/failed/missing）
//   pre-commit-abort     有日志、未到 suite-start（前序拒绝：delta/doc-check/typecheck/ac-precheck/anti-drift …）
//   suite-skipped        有 suite-skip（doc-only delta）
//   missing-end-event    有 suite-start 但无 suite-end/skip/incomplete（缺结束事件）
//   suite-ran            有 suite-end（其下再分 green/red/incomplete 三种真实 verdict）
function classifySuiteOutcome(trace) {
  if (!trace || trace.length === 0) return "missing-log";
  const steps = new Set(trace.map((r) => r.step));
  const hasSuiteStart = steps.has("suite-start");
  const hasSuiteEnd = steps.has("suite-end");
  const hasSuiteSkip = steps.has("suite-skip");
  const hasSuiteIncomplete = steps.has("suite-incomplete");
  const classifierFailed = trace.some((r) => r.step === "instrument-probe"
    && (r.ok !== true || /classifier=(unavailable|failed|missing)/.test(r.reason || "")));
  if (classifierFailed && !hasSuiteEnd) return "classifier-failure";
  if (hasSuiteEnd) return "suite-ran";
  if (hasSuiteSkip) return "suite-skipped";
  if (hasSuiteStart) return "missing-end-event";
  return "pre-commit-abort";
}

// suite verdict 细分（仅在 suite-ran 时）。
function suiteVerdict(trace) {
  const end = trace.find((r) => r.step === "suite-end");
  const incomplete = trace.some((r) => r.step === "suite-incomplete");
  if (end && end.ok === true) return "green";
  if (incomplete) return "incomplete";
  return "red";
}

function stepWall(trace, step) {
  const rs = trace.filter((r) => r.step === step);
  if (rs.length === 0) return null;
  const walls = rs.map((r) => r.wall_ms).filter((w) => typeof w === "number");
  if (walls.length === 0) return null;
  return walls[walls.length - 1];
}

// verification-round 记录的唯一身份：round 字段在本店是全局单调唯一（实测 3270/3270 唯一）。
function recordKey(r) { return String(r.round ?? `${r.taskId ?? "?"}\u0000${r.startedAt ?? "?"}`); }

// suite 关联（Plan §2 / AC1/AC3）：verification-round 按 (taskId, startedAt) 关联尝试窗口。
// 窗口内没有唯一证据 ⇒ 不回填同 task 的全部历史 recs（旧实现的行 405 兜底已移除）。
// 同一 round 的重复记录先按身份去重（一条真实 suite 被重复记录不翻倍）；只有 proven 的记录
// 参与确定归属聚合；ambiguous/missing 单列。
function attachSuite(src, attempts) {
  // 去重：verification-round 以 round 为唯一身份，重复行只保留第一条。
  const seenRounds = new Set();
  const rounds = [];
  let dupCount = 0;
  for (const v of src.verificationRound) {
    const k = recordKey(v);
    if (seenRounds.has(k)) { dupCount++; continue; }
    seenRounds.add(k);
    rounds.push(v);
  }
  src.verificationRoundUnique = rounds;
  src.verificationRoundDuplicates = dupCount;

  const byTask = new Map();
  for (const v of rounds) {
    if (!v.taskId) continue;
    if (!byTask.has(v.taskId)) byTask.set(v.taskId, []);
    byTask.get(v.taskId).push(v);
  }

  // 反向索引：record key -> 命中它的尝试索引集合（用于判定「唯一归属」）。
  const attemptsForRecord = new Map();
  const recordByKey = new Map();
  const candidatesForAttempt = new Map();
  attempts.forEach((a, ai) => {
    const recs = byTask.get(a.task) || [];
    const inWin = recs.filter((v) => {
      const s = parseIso(v.startedAt);
      if (s == null) return false; // 缺 startedAt ⇒ 无法归属到任何尝试（缺值 = 未查，不是 0）
      return (a.startedAtMs == null || s >= a.startedAtMs) && (a.endedAtMs == null || s <= a.endedAtMs);
    });
    a.suiteRecords = inWin;
    candidatesForAttempt.set(ai, inWin);
    for (const r of inWin) {
      const k = recordKey(r);
      recordByKey.set(k, r);
      if (!attemptsForRecord.has(k)) attemptsForRecord.set(k, new Set());
      attemptsForRecord.get(k).add(ai);
    }
  });
  src.attemptsForRecord = attemptsForRecord;
  src.recordByKey = recordByKey;

  attempts.forEach((a, ai) => {
    const recs = candidatesForAttempt.get(ai);
    // 「唯一归属」的判定对象是【记录】，不是【尝试】：
    //   - 一条记录被多个尝试命中 ⇒ 该记录歧义（backfill 问题），不参与确定归属聚合。
    //   - 一条记录被且只被本尝试命中 ⇒ proven，即使本尝试窗口内有其它多条（各自真实、各自计一次）。
    const uniqueRecs = recs.filter((r) => attemptsForRecord.get(recordKey(r)).size === 1);
    a.suiteUniqueRecords = uniqueRecs;
    a.suiteAssociation = recs.length === 0 ? "missing" : (uniqueRecs.length > 0 ? "proven" : "ambiguous");
    a.suiteUnique = a.suiteAssociation === "proven";
    a.suiteUniqueRecord = uniqueRecs.length > 0 ? uniqueRecs[uniqueRecs.length - 1] : null;

    if (a.suiteUniqueRecord) {
      const r = a.suiteUniqueRecord;
      a.suiteLockWaitMs = num(r.lock_wait_ms);
      a.suiteLockHoldMs = num(r.lock_hold_ms);
      a.suiteDurationMs = num(r.durationMs);
      a.cpuTimeS = num(r.cpu_time_s);
      a.cpuSource = r.cpu_source ?? null;
    } else {
      a.suiteLockWaitMs = null;
      a.suiteLockHoldMs = null;
      a.suiteDurationMs = null;
      a.cpuTimeS = null;
      a.cpuSource = null;
    }
  });
}

// 落地证据（AC2）：权威 = fan-in 日志中 ok:true 的 ff 步骤（目标 ref 成功更新的直接事件）∪
// fan-in-step-trace 的 step=ff step-end ok:true。两处都读到按 (task, runId) 归并计一次。
// ⛔ verification-round 的 commit/terminalCommit（受测 SHA）不是落地证据，只作 corroborative SHA。
// 三分：landed（证明已落地）/ not-landed（证明未落地：fan-in 已收尾但无 ok ff）/ unknown（证据不足）。
// ff 是任务级终态事件、发生在 worker ended_at 之后 ⇒ 只归给该任务最后一条尝试（按 startedAtMs），
// ⛔ 不把后一次落地回填给前一次（同一任务多条尝试共享同一 run_id）。
function attachLanding(src, attempts) {
  // 每个任务的最后一条尝试 = 落地尝试（attempts 已按 startedAtMs 升序，最后一次覆盖即最大 startedAtMs）。
  const lastByTask = new Map();
  for (const a of attempts) lastByTask.set(a.task, a);

  for (const a of attempts) {
    a.landingStatus = "unknown";
    a.landed = false;
    a.landedEvidence = null;
    a.landingSource = "unknown";
    a.fanInCommit = null;
    a.landedSha = null;

    const isLast = lastByTask.get(a.task) === a;
    const hasFf = a.ffOkLog || a.ffOkStepTrace;

    if (isLast && hasFf) {
      a.landingStatus = "landed";
      a.landed = true;
      a.landingSource = a.ffOkLog && a.ffOkStepTrace ? "both" : (a.ffOkLog ? "log" : "step-trace");
      a.landedEvidence = a.ffOkLog && a.ffOkStepTrace
        ? "fan-in-trace.ff(ok)+step-trace.ff(ok)"
        : (a.ffOkLog ? "fan-in-trace.ff(ok)" : "step-trace.ff(ok)");
    } else if (a.releaseOk) {
      // fan-in 明确收尾（release-fan-in-lock）却没有 ok 的 ff ⇒ 该 run 未落地（明确失败）。
      a.landingStatus = "not-landed";
      a.landedEvidence = "fan-in-trace.released-without-ff";
    } else {
      // 无日志、或日志既无 ff 也无收尾 ⇒ 无法确认（未知 ≠ 已失败）。
      a.landingStatus = "unknown";
      a.landedEvidence = null;
    }

    // corroborative SHA：仅当 proven suite 记录存在时，取 terminalCommit（否则 commit）。
    // ⛔ 这只是「受测 SHA」，与落地判定无关；落地判定只看 ff ok。
    if (a.suiteUniqueRecord) {
      const v = a.suiteUniqueRecord;
      a.fanInCommit = (typeof v.terminalCommit === "string" && v.terminalCommit) ? v.terminalCommit
        : ((typeof v.commit === "string" && v.commit) ? v.commit : null);
    }
    if (a.landed) a.landedSha = a.fanInCommit;
  }
}

// ── 汇总 ───────────────────────────────────────────────────────────────────
function summarize(src, args, ctx) {
  const attempts = ctx.attempts.filter((a) => (args.task ? a.task === args.task : true));
  const byTask = new Map();
  for (const a of attempts) {
    if (!byTask.has(a.task)) byTask.set(a.task, []);
    byTask.get(a.task).push(a);
  }

  // 任务级落地三分：landed（任一尝试证明落地）/ not-landed（无落地且全部尝试明确未落地）/ unknown（其余）。
  const landedTasks = new Set();
  const notLandedTasks = new Set();
  const unknownTasks = new Set();
  for (const [task, as] of byTask) {
    if (as.some((a) => a.landed)) landedTasks.add(task);
    else if (as.every((a) => a.landingStatus === "not-landed")) notLandedTasks.add(task);
    else unknownTasks.add(task);
  }

  const wallClocks = attempts.map((a) => a.wall_clock_ms).filter((x) => typeof x === "number" && x > 0).sort((x, y) => x - y);
  const lockWaits = attempts.map((a) => a.fanInLockWaitMs).filter((x) => typeof x === "number").sort((x, y) => x - y);
  const suiteDurations = attempts.map((a) => a.suiteExecMs).filter((x) => typeof x === "number").sort((x, y) => x - y);

  // 唯一归属的 suite 记录（全局按 round 去重），供 CPU/验证时长/锁等待聚合使用（AC3 身份去重）。
  const uniqueRecordsByKey = new Map();
  for (const a of attempts) {
    for (const r of (a.suiteUniqueRecords || [])) uniqueRecordsByKey.set(recordKey(r), r);
  }
  const uniqueRecords = [...uniqueRecordsByKey.values()];
  const gnuUnique = uniqueRecords.filter((r) => r.cpu_source === "gnu-time" && num(r.cpu_time_s) != null);
  const cpuValues = gnuUnique.map((r) => num(r.cpu_time_s)).sort((x, y) => x - y);
  const cpuUniqueSumS = cpuValues.reduce((s, v) => s + v, 0);
  const cpuUniqueCount = gnuUnique.length;
  const suiteSlotWaits = uniqueRecords.map((r) => num(r.lock_wait_ms)).filter((x) => x != null).sort((x, y) => x - y);
  const suiteDurationValues = uniqueRecords.map((r) => num(r.durationMs)).filter((x) => x != null).sort((x, y) => x - y);

  // 分阶段合计（有 trace 的尝试）
  const phaseTotals = {};
  let withTrace = 0, withSuiteRec = 0, withCpu = 0, withLock = 0;
  for (const a of attempts) {
    if (a.trace && a.trace.length > 0) {
      withTrace++;
      for (const [k, v] of Object.entries(a.fanInStepMs || {})) phaseTotals[k] = (phaseTotals[k] || 0) + v;
    }
    if (a.suiteUniqueRecords && a.suiteUniqueRecords.length > 0) withSuiteRec++;
    if ((a.suiteUniqueRecords || []).some((r) => r.cpu_source === "gnu-time" && num(r.cpu_time_s) != null)) withCpu++;
    if (a.fanInLockWaitMs != null) withLock++;
  }

  // 墙钟归属覆盖率（取代旧「ITE / Idle Time Efficiency」误名）：attributedWallMs / endToEndWallMs，
  // ⛔ 不截断到 1——重叠/重复累计会让比值 >1，这正是要暴露的信号而不是要掩盖的。
  const wallAttr = [];
  let wallAttrOverlap = 0;
  for (const a of attempts) {
    const hasTrace = a.trace && a.trace.length > 0;
    const attr = hasTrace && a.fanInStepMs ? Object.values(a.fanInStepMs).reduce((s, v) => s + v, 0) : null;
    if (a.wall_clock_ms != null && attr != null && a.wall_clock_ms > 0) {
      const ratio = attr / a.wall_clock_ms;
      wallAttr.push({ task: a.task, ratio, attrMs: attr, wallMs: a.wall_clock_ms });
      if (ratio > 1 + 1e-9) wallAttrOverlap++;
    }
  }
  wallAttr.sort((x, y) => x.ratio - y.ratio);

  // suite 身份覆盖（AC3）：唯一 suite 数 = proven 关联到的 verification-round 记录数。
  const uniqueSuiteKeys = new Set(uniqueRecordsByKey.keys());
  const totalVerificationRounds = (src.verificationRoundUnique || src.verificationRound).length;
  const unattributedRounds = totalVerificationRounds - uniqueSuiteKeys.size;

  // 未归属/歧义的 gnu-time CPU 记录（有真实计量但无法唯一归属 ⇒ 单列，不参与聚合）。
  const gnuAll = (src.verificationRoundUnique || src.verificationRound).filter((r) => r.cpu_source === "gnu-time" && num(r.cpu_time_s) != null);
  const cpuUnattributedGnu = gnuAll.length - cpuUniqueCount;

  // suite 结局计数（AC5，互斥：suite-ran 只含完整 verdict green/red，incomplete 单列）
  const suiteOutcomes = { "suite-ran": 0, "suite-skipped": 0, "suite-incomplete": 0, "missing-end-event": 0, "pre-commit-abort": 0, "classifier-failure": 0, "missing-log": 0 };
  const suiteVerdicts = { green: 0, red: 0, incomplete: 0 };
  for (const a of attempts) {
    const cat = a.suiteOutcome || "missing-log";
    if (cat === "suite-ran") {
      const v = suiteVerdict(a.trace);
      suiteVerdicts[v]++;
      if (v === "incomplete") suiteOutcomes["suite-incomplete"]++;
      else suiteOutcomes["suite-ran"]++;
    } else if (Object.prototype.hasOwnProperty.call(suiteOutcomes, cat)) {
      suiteOutcomes[cat]++;
    }
  }

  // 每任务明细
  const perTask = [...byTask.entries()].map(([task, as]) => {
    const wallSum = as.reduce((s, a) => s + (typeof a.wall_clock_ms === "number" ? a.wall_clock_ms : 0), 0);
    const ratios = as.map((a) => {
      const hasTrace = a.trace && a.trace.length > 0;
      const attr = hasTrace && a.fanInStepMs ? Object.values(a.fanInStepMs).reduce((s2, v) => s2 + v, 0) : null;
      return (a.wall_clock_ms != null && attr != null && a.wall_clock_ms > 0) ? attr / a.wall_clock_ms : null;
    }).filter((x) => x != null);
    const wallAttrMean = ratios.length ? ratios.reduce((s, v) => s + v, 0) / ratios.length : null;
    return {
      task,
      attempts: as.length,
      rework: Math.max(0, as.length - 1),
      cumulativeWallMs: wallSum,
      wallAttrMean,
      cost: null, // 费用 not-evaluated（无 CSV）
      landed: as.some((a) => a.landed),
      notLanded: !as.some((a) => a.landed) && as.every((a) => a.landingStatus === "not-landed"),
      unknown: !as.some((a) => a.landed) && !as.every((a) => a.landingStatus === "not-landed"),
    };
  }).sort((a, b) => b.attempts - a.attempts || b.cumulativeWallMs - a.cumulativeWallMs);

  return {
    attemptsTotal: attempts.length,
    tasksTotal: byTask.size,
    landedTasks: landedTasks.size,
    notLandedTasks: notLandedTasks.size,
    unknownTasks: unknownTasks.size,
    reworkTasks: [...byTask.entries()].filter(([, as]) => as.length > 1).length,
    maxAttempts: Math.max(0, ...[...byTask.values()].map((as) => as.length)),
    wallClockP50: median(wallClocks),
    wallClockP90: pct(wallClocks, 90),
    lockWaitP50: median(lockWaits),
    lockWaitP90: pct(lockWaits, 90),
    suiteP50: median(suiteDurations),
    suiteP90: pct(suiteDurations, 90),
    suiteSlotWaitP50: median(suiteSlotWaits),
    suiteSlotWaitP90: pct(suiteSlotWaits, 90),
    suiteSlotWaitCount: suiteSlotWaits.length,
    suiteDurationUniqueP50: median(suiteDurationValues),
    suiteDurationUniqueP90: pct(suiteDurationValues, 90),
    suiteDurationUniqueCount: suiteDurationValues.length,
    cpuP50: median(cpuValues),
    cpuP90: pct(cpuValues, 90),
    cpuUniqueSumS,
    cpuUniqueCount,
    cpuUnattributedGnu,
    withTrace, withSuiteRec, withCpu, withLock,
    phaseTotals,
    wallAttrP50: median(wallAttr.map((i) => i.ratio)),
    wallAttrP90: pct(wallAttr.map((i) => i.ratio), 90),
    wallAttrOverlap,
    wallAttr,
    perTask,
    suiteOutcomes,
    suiteVerdicts,
    uniqueSuiteCount: uniqueSuiteKeys.size,
    totalVerificationRounds,
    unattributedRounds,
    suiteAssociationCounts: countBy(attempts, "suiteAssociation"),
    landingStatusCounts: countBy(attempts, "landingStatus"),
    landingSourceCounts: countBy(attempts, "landingSource"),
    finalStateCounts: countBy(attempts, "final_state"),
  };
}
function countBy(arr, k) {
  const m = {};
  for (const a of arr) m[a[k]] = (m[a[k]] || 0) + 1;
  return m;
}

// ── 轮数分解（会话）───────────────────────────────────────────────────────
function classifyRounds(src, args, ctx) {
  // 每个 worker 会话，按 message.id 去重后的 assistant 消息（round）分类。
  const sessions = args.task
    ? src.workerSessions.filter((s) => s.task === args.task)
    : src.workerSessions;
  const categories = ["exploration", "tool-wait", "repeated-read", "verification", "fix", "unclassified"];
  const catCounts = Object.fromEntries(categories.map((c) => [c, 0]));
  const perSession = [];
  const sessionsDir = src.sessionsDir;
  const { winStart, winEnd } = ctx;
  let totalRounds = 0;
  let roundsMissingId = 0; // 缺 message.id 的 assistant 记录逐条计 1 轮，独立计数，⛔ 不与去重后的轮数合并
  let unwindowed = 0, unwindowedOutside = 0, unwindowedMissing = 0;
  const readCacheBySession = new Map();

  for (const s of sessions) {
    const p = join(sessionsDir, s.file);
    const text = readFileSafe(p);
    if (text == null) continue;
    // 会话按首条记录时间戳落入窗口才纳入；窗口外/缺时间戳单列 unwindowed（不静默丢弃）。
    const m = windowMembership(sessionFirstTsMs(text), winStart, winEnd);
    if (m !== "inside") {
      unwindowed++;
      if (m === "missing") unwindowedMissing++; else unwindowedOutside++;
      continue;
    }
    // 按 message.id 分组 assistant 记录：同一个 message.id 被 apiBlockIndex 拆成多条记录
    // （thinking/text/tool_use 各一条），合并同 id 的全部 block 后再计 1 轮。
    const byId = new Map();
    const missingIdRecords = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type !== "assistant") continue;
      const id = o.message?.id;
      if (id == null) { missingIdRecords.push(o); continue; }
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(o);
    }
    const rounds = [];
    const readSet = new Set();
    for (const recs of byId.values()) {
      const toolUses = [];
      for (const r of recs) toolUses.push(...collectToolUses(r));
      const cat = classifyOneRound(toolUses, readSet);
      rounds.push(cat);
      totalRounds++;
    }
    // 缺 message.id 的记录逐条计 1 轮，写进独立计数器，⛔ 不并入分类、也不与去重后的轮数合并。
    roundsMissingId += missingIdRecords.length;

    readCacheBySession.set(s.sessionId, readSet);
    const sc = {};
    for (const c of categories) sc[c] = rounds.filter((r) => r === c).length;
    perSession.push({ sessionId: s.sessionId, task: s.task, rounds: rounds.length, ...sc });
  }
  for (const p of perSession) for (const c of categories) catCounts[c] += p[c];
  // sessionsTotal = 窗口内会话数（不是任务过滤后的全集数）；unwindowed 单列。
  return { totalRounds, roundsMissingId, catCounts, perSession, categories, sessionsTotal: perSession.length, unwindowed, unwindowedOutside, unwindowedMissing };
}

function collectToolUses(o) {
  const msgs = o.message?.content;
  return (Array.isArray(msgs) ? msgs : []).filter((m) => m && m.type === "tool_use");
}

function classifyOneRound(toolUses, readSet) {
  // 无任何工具动作的 assistant 轮 = 等待/思考（tool-wait）。
  if (toolUses.length === 0) return "tool-wait";

  // 本轮 Read 的文件（在【本轮之前】的 readSet 里出现过才算 repeated-read）。
  const readFilesThisRound = toolUses.filter((t) => t.name === "Read" && t.input?.file_path).map((t) => t.input.file_path);
  const repeated = readFilesThisRound.some((f) => readSet.has(f));
  for (const f of readFilesThisRound) readSet.add(f);

  const hasWrite = toolUses.some((t) => t.name === "Edit" || t.name === "Write");
  const hasBash = toolUses.some((t) => t.name === "Bash");
  const bashCmds = toolUses.filter((t) => t.name === "Bash").map((t) => String(t.input?.command || ""));
  const hasTest = toolUses.some((t) => (t.name === "Bash" || t.name === "mcp__plugin_quay_quay__task_check")
    && /test|node --test|task_check|gate_run|task-efficiency|test\.sh|task check/.test(JSON.stringify(t.input || {})));
  const hasVerify = toolUses.some((t) => /task_check|task_get|gate_run|gate_log|lifecycle_/.test(t.name || ""));

  if (hasTest || hasVerify) return "verification";
  if (hasWrite) return "fix";
  if (repeated) return "repeated-read";
  if (toolUses.some((t) => t.name === "Read" || t.name === "Grep" || t.name === "Glob")) return "exploration";
  if (hasBash) {
    // 依命令内容分类；保守——无法判断就 unclassified。
    const all = bashCmds.join(" ");
    if (/^(git\s+(add|commit|reset|merge|checkout|branch|rm|mv)|mv\s|cp\s|mkdir\s|rm\s|sed\s|node\s+.*\.mjs)/.test(all)) return "fix";
    if (/^(find|grep|ls|cat|head|tail|wc|which|ps\s)/.test(all)) return "exploration";
    return "unclassified";
  }
  return "unclassified";
}

// ── E5 证据：锁等待 + 队列等待 + 供给/资源拒绝（只输出直接读数，不做无依据推断）──
function e5Evidence(src, ctx) {
  const { winStart, winEnd } = ctx;
  // 锁等待：fan-in 锁 acquire 的 wall_ms（描述性分位数，⛔ 不据此下「显著」结论）。
  const fanInLockWaits = [];
  for (const a of ctx.attempts) if (typeof a.fanInLockWaitMs === "number") fanInLockWaits.push(a.fanInLockWaitMs);
  fanInLockWaits.sort((x, y) => x - y);

  // 队列等待（workflow-event start 记录 queuedAtMs→startedAtMs）。fm-* 时代多数 queuedAtMs=null ⇒
  // not-evaluated（缺值 = 未查，⛔ 不与 0 共用取值）。这是「等待区间」的直接证据载体。
  // 先按 recordedAtMs 落入窗口；窗口外/缺 recordedAtMs 单列 queueUnwindowed（不静默丢弃）。
  const queueDelays = [];
  let queueMeasurable = 0, queueMissing = 0;
  let queueUnwindowed = 0, queueUnwindowedOutside = 0, queueUnwindowedMissing = 0;
  for (const e of src.workflowEvents) {
    if (e.eventKind !== "start") continue;
    const m = windowMembership(tsToMs(e.recordedAtMs), winStart, winEnd);
    if (m !== "inside") {
      queueUnwindowed++;
      if (m === "missing") queueUnwindowedMissing++; else queueUnwindowedOutside++;
      continue;
    }
    const q = e.timing?.queuedAtMs, st = e.timing?.startedAtMs;
    if (typeof q === "number" && typeof st === "number") { queueMeasurable++; if (st >= q) queueDelays.push(st - q); }
    else queueMissing++;
  }
  queueDelays.sort((x, y) => x - y);

  // 派发环 stop_reason：供给状态（pool-empty）与资源拒绝（resource-gate-wait）各自单列，
  // ⛔ 不把两者相加当「持续队列」。持续队列需要待处理量/等待区间的直接证据。
  // 先按 ts 落入窗口；窗口外/缺 ts 单列 stopReasonUnwindowed（不静默丢弃）。
  const stopReasonCounts = {};
  let stopReasonUnwindowed = 0, stopReasonUnwindowedOutside = 0, stopReasonUnwindowedMissing = 0;
  for (const r of src.workerRound) {
    const m = windowMembership(tsToMs(r.ts), winStart, winEnd);
    if (m !== "inside") {
      stopReasonUnwindowed++;
      if (m === "missing") stopReasonUnwindowedMissing++; else stopReasonUnwindowedOutside++;
      continue;
    }
    const s = r.stop_reason;
    const key = s == null ? "dispatched(no-stop)" : String(s).replace(/\s*\(.*$/, "").split(":")[0];
    stopReasonCounts[key] = (stopReasonCounts[key] || 0) + 1;
  }

  // 持续队列判定：只有当存在「等待区间」直接证据（可测 queuedAt→startedAt 延迟）时才评估；
  // 否则 unknown（缺值 = 未查，不是「无队列」，也不是「有队列」）。
  let persistentQueue = "not-evaluated";
  if (queueMeasurable > 0 && queueDelays.length > 0) {
    persistentQueue = median(queueDelays) != null ? "measured" : "not-evaluated";
  }

  return {
    fanInLockWaitP50: median(fanInLockWaits),
    fanInLockWaitP90: pct(fanInLockWaits, 90),
    fanInLockWaitMax: fanInLockWaits.length ? fanInLockWaits[fanInLockWaits.length - 1] : null,
    fanInLockWaitCount: fanInLockWaits.length,
    queueDelayP50: median(queueDelays),
    queueDelayP90: pct(queueDelays, 90),
    queueDelayCount: queueDelays.length,
    queueMeasurable,
    queueMissing,
    queueUnwindowed,
    queueUnwindowedOutside,
    queueUnwindowedMissing,
    stopReasonCounts,
    stopReasonUnwindowed,
    stopReasonUnwindowedOutside,
    stopReasonUnwindowedMissing,
    resourceGateRounds: stopReasonCounts["resource-gate-wait"] || 0,
    poolEmptyRounds: stopReasonCounts["pool-empty"] || 0,
    persistentQueue,
  };
}

// ── 输入指纹（AC6：代码版本 + 输入指纹，供复跑核对）────────────────────────
function inputFingerprint(src, args, ctx) {
  const codeVer = sha256(readFileSafe(new URL(import.meta.url).pathname) || "");
  const canon = JSON.stringify({
    window: [ctx.winStart, ctx.winEnd],
    counts: {
      workerOutcome: src.workerOutcome.length,
      fanInTraceFiles: src.fanInTraceByName.size,
      stepTrace: src.stepTrace.length,
      fanInLockEvents: src.fanInLockEvents.length,
      verificationRound: src.verificationRound.length,
      workerRound: src.workerRound.length,
      fastModeTelemetry: src.fastModeTelemetry.length,
      workflowEvents: src.workflowEvents.length,
      workerSessions: src.workerSessions.length,
    },
    firstWorkerOutcomeTs: src.workerOutcome[0]?.ts ?? null,
    lastWorkerOutcomeTs: src.workerOutcome[src.workerOutcome.length - 1]?.ts ?? null,
    csv: args.csv ?? null,
  });
  return { codeSha256: codeVer, codeSha256Short: codeVer.slice(0, 12), inputSha256: sha256(canon), inputSha256Short: sha256(canon).slice(0, 12) };
}

// ── 报告渲染 ───────────────────────────────────────────────────────────────
function renderMarkdown(args, src, ctx, sum, rounds, e5, fp) {
  const L = [];
  const p = (...xs) => L.push(xs.join(""));
  const windowStartIso = ctx.winStart != null ? new Date(ctx.winStart).toISOString() : "n/a";
  const windowEndIso = ctx.winEnd != null ? new Date(ctx.winEnd).toISOString() : "n/a";
  const gitHead = (() => {
    const r = spawnSync("git", ["-C", src.root, "rev-parse", "HEAD"], { encoding: "utf8" });
    return r.status === 0 && r.stdout.trim() ? r.stdout.trim().slice(0, 12) : "n/a";
  })();

  p("# 任务级端到端效率基线（E1）\n");
  p("> 只读、可复跑。本文件由 `scripts/task-efficiency-baseline.mjs` 生成。\n");
  p("> 身份关联规则见工具 `--help`；费用/CPU 缺失维度明确 not-evaluated。\n");
  p("\n## 复跑命令\n");
  p("```bash\n");
  const cmd = [
    "node", "scripts/task-efficiency-baseline.mjs",
    "--root", src.root,
    "--sessions-dir", src.sessionsDir,
    ...(args.csv ? ["--csv", args.csv] : []),
    "--window-start", windowStartIso,
    "--window-end", windowEndIso,
  ];
  p(cmd.join(" "));
  p("\n```\n");
  p("\n窗口（含）：`", windowStartIso, "` → `", windowEndIso, "`（时区 UTC）。\n");
  p("\n代码版本 / 输入指纹：`git HEAD=", gitHead, "`，脚本 sha256=`", fp.codeSha256Short, "`，输入 sha256=`", fp.inputSha256Short, "`。\n");

  p("\n## 数据来源与字段清单\n");
  p("| 来源 | 记录数 | 字段 | 身份键 |\n|---|---|---|---|\n");
  const srcTable = [
    ["worker-outcome.jsonl", src.workerOutcome.length, inventoryFields(src.workerOutcome), "(task, started_at, ts)"],
    ["fan-in 过程日志", src.fanInTraceByName.size, "step/ts/wall_ms/ok", "(task, run_id) + 尝试窗口"],
    ["fan-in-lock-events.jsonl", src.fanInLockEvents.length, inventoryFields(src.fanInLockEvents), "(taskId, pid, ts)"],
    ["verification-round.jsonl", src.verificationRound.length, inventoryFields(src.verificationRound), "round（全局唯一）→ (taskId, startedAt)"],
    ["worker-round.jsonl", src.workerRound.length, inventoryFields(src.workerRound), "(round, run_id, ts)"],
    ["fast-mode telemetry（按 runId 去重）", src.fastModeTelemetry.length, inventoryFields(src.fastModeTelemetry), "(taskId, runId) — fm-* 空间，只盘点不 join"],
    ["workflow events", src.workflowEvents.length, inventoryFields(src.workflowEvents), "runId"],
    ["worker 会话", src.workerSessions.length, "sessionId/task/file", "sessionId → taskId"],
    ["CSV", src.csvPresent ? src.csvRecords.length : 0, src.csvPresent ? inventoryFields(src.csvRecords) : new Map(), src.csvPresent ? "CSV 表头" : "缺失（费用 not-evaluated）"],
  ];
  for (const [name, n, fields, key] of srcTable) {
    const fl = fields instanceof Map
      ? [...fields.keys()].slice(0, 14).join(", ") + (fields.size > 14 ? ", …" : "")
      : fields;
    p("| ", name, " | ", String(n), " | ", fl, " | ", key, " |\n");
  }

  p("\n## 两套分母与聚合\n");
  p("| 量 | 值 |\n|---|---|\n");
  p("| 尝试总数（窗口内，去重后） | ", String(sum.attemptsTotal), " |\n");
  p("| 去重丢弃的重复记录 | ", String(ctx.duplicates.length), " |\n");
  p("| 缺 started_at 的记录（未纳入尝试） | ", String(ctx.missingStart), " |\n");
  p("| 缺 ended_at 的尝试（时长 not-evaluable） | ", String(ctx.missingEnd), " |\n");
  p("| 不同任务数 | ", String(sum.tasksTotal), " |\n");
  p("| 成功落地任务数（分母①，仅 ff ok 证明） | ", String(sum.landedTasks), " |\n");
  p("| 明确未落地任务数 | ", String(sum.notLandedTasks), " |\n");
  p("| 落地未知任务数（证据不足，不计入成功分母） | ", String(sum.unknownTasks), " |\n");
  p("| 所有尝试（分母②） | ", String(sum.attemptsTotal), " |\n");
  p("| 落地任务 / 所有尝试 | ", sum.attemptsTotal ? (sum.landedTasks / sum.attemptsTotal).toFixed(3) : "n/a", " |\n");
  p("| 有返工（>1 次尝试）的任务 | ", String(sum.reworkTasks), " |\n");
  p("| 单任务最大尝试数 | ", String(sum.maxAttempts), " |\n");
  p("| 被复用到 >1 任务的 run_id 数 | ", String(ctx.reusedRunIds), " |\n");
  p("| 尝试 wall-clock p50 / p90 | ", fmtMs(sum.wallClockP50), " / ", fmtMs(sum.wallClockP90), " |\n");
  p("| fan-in 锁等待 p50 / p90 | ", fmtMs(sum.lockWaitP50), " / ", fmtMs(sum.lockWaitP90), " |\n");
  p("| suite 执行 p50 / p90（fan-in 日志） | ", fmtMs(sum.suiteP50), " / ", fmtMs(sum.suiteP90), " |\n");
  p("| suite 等槽 p50 / p90（verification-round lock_wait_ms，真实锁计量） | ", fmtMs(sum.suiteSlotWaitP50), " / ", fmtMs(sum.suiteSlotWaitP90), " |\n");
  p("| suite 等槽可测记录数（唯一 suite） | ", String(sum.suiteSlotWaitCount), " |\n");
  p("| 验证时长 p50 / p90（verification-round durationMs，身份去重） | ", fmtMs(sum.suiteDurationUniqueP50), " / ", fmtMs(sum.suiteDurationUniqueP90), "（", String(sum.suiteDurationUniqueCount), " 条唯一 suite） |\n");
  p("| CPU-seconds p50 / p90（仅 gnu-time 实测，身份去重） | ", fmtSec(sum.cpuP50), " / ", fmtSec(sum.cpuP90), " |\n");
  p("| CPU-seconds 合计（仅 gnu-time 实测，身份去重后） | ", fmtSec(sum.cpuUniqueSumS), "（", String(sum.cpuUniqueCount), " 条唯一 suite；另有 ", String(sum.cpuUnattributedGnu), " 条 gnu-time 记录未唯一归属，不参与聚合） |\n");
  p("| 墙钟归属覆盖率 p50 / p90（attributedWallMs / endToEndWallMs） | ",
    sum.wallAttrP50 != null ? sum.wallAttrP50.toFixed(3) : "not-evaluated", " / ",
    sum.wallAttrP90 != null ? sum.wallAttrP90.toFixed(3) : "not-evaluated", " |\n");
  p("| 墙钟归属覆盖率 >1（重叠/重复累计，不截断）的尝试 | ", String(sum.wallAttrOverlap), " |\n");
  p("\nfinal_state 分布：`", JSON.stringify(sum.finalStateCounts), "`\n");
  p("落地状态分布：`", JSON.stringify(sum.landingStatusCounts), "`\n");
  p("落地证据来源分布（log / step-trace / both / unknown）：`", JSON.stringify(sum.landingSourceCounts), "`\n");
  p("suite 关联分布：`", JSON.stringify(sum.suiteAssociationCounts), "`\n");

  p("\n## 分阶段墙钟（有 fan-in 日志的尝试）\n");
  p("> 只有真实可测部分可宣称已建立基线；CPU 只取真实 CPU 计量（cpu_source=gnu-time），⛔ 不用 wall-time 换算。\n");
  p("| 阶段 | 累计 wall_ms | 覆盖尝试数（", String(sum.withTrace), "） |\n|---|---|---|\n");
  for (const [k, v] of Object.entries(sum.phaseTotals).sort((a, b) => b[1] - a[1])) {
    p("| ", k, " | ", String(Math.round(v)), " | ", String(sum.withTrace), " |\n");
  }
  p("\n- 有 trace 的尝试：", String(sum.withTrace), " / ", String(sum.attemptsTotal), "\n");
  p("- 有 proven suite 记录关联的尝试：", String(sum.withSuiteRec), "\n");
  p("- 有 gnu-time CPU 实测（且 proven 关联）的尝试：", String(sum.withCpu), "（", sum.attemptsTotal ? (sum.withCpu / sum.attemptsTotal * 100).toFixed(1) : "0", "%）\n");
  p("- 有 fan-in 锁等待读数的尝试：", String(sum.withLock), "\n");

  p("\n### 费用维度\n");
  if (src.csvPresent) {
    p("CSV 存在（", String(src.csv), "），记录数 ", String(src.csvRecords.length), "。\n");
  } else {
    p("**not-evaluated**：未提供 `--csv`。所缺输入：把 attempt→费用 映射的 CSV（含 task/attempt 身份与计费额）。⛔ 不把 token 估计写成实际账单。\n");
  }

  p("\n### CPU 维度\n");
  p("只取 `verification-round.jsonl` 中 `cpu_time_s` 且 `cpu_source=gnu-time` 的实测值，且该记录被**唯一**关联到某次尝试（proven）。歧义/未归属记录单列、不参与 CPU 聚合。\n");

  p("\n### ready 事件维度\n");
  const readyEvents = src.gateEventCounts["promote"];
  if (readyEvents != null) {
    p("ready 事件 = `gate-events.jsonl` 中 gate=promote 的条数：**", String(readyEvents), "**。gate 分布：`", JSON.stringify(src.gateEventCounts), "`\n");
  } else {
    p("**not-evaluated**：`gate-events.jsonl` 无 gate=promote 记录或文件缺失。所缺字段：gate（promote）。\n");
  }

  p("\n## suite 结局分类（AC5，尝试级互斥）\n");
  p("| 类别 | 尝试数 | 说明 |\n|---|---|---|\n");
  p("| suite 跑完（suite-end，完整 verdict） | ", String(sum.suiteOutcomes["suite-ran"]), " | green=", String(sum.suiteVerdicts.green), " red=", String(sum.suiteVerdicts.red), " |\n");
  p("| suite 未完成（suite-incomplete verdict） | ", String(sum.suiteOutcomes["suite-incomplete"]), " | suite-end 为 red 且 files 不完整 |\n");
  p("| suite 跳过（suite-skip，doc-only） | ", String(sum.suiteOutcomes["suite-skipped"]), " | |\n");
  p("| 缺结束事件（suite-start 无 end/skip/incomplete） | ", String(sum.suiteOutcomes["missing-end-event"]), " | 日志不足，⛔ 不算分类失败 |\n");
  p("| 前序中止（有日志、未到 suite-start） | ", String(sum.suiteOutcomes["pre-commit-abort"]), " | delta/doc-check/typecheck/ac-precheck/anti-drift 等前序拒绝 |\n");
  p("| 分类器失败（明确证据） | ", String(sum.suiteOutcomes["classifier-failure"]), " | instrument-probe 明确 classifier≠available |\n");
  p("| 缺日志（无 fan-in trace） | ", String(sum.suiteOutcomes["missing-log"]), " | 无法判断 |\n");
  p("> ⛔ 「无 suite-end/skip」不再自动判为分类失败；分类失败只认 instrument-probe 的明确失败证据。\n");

  p("\n## 每任务明细（AC3：累计墙钟/墙钟归属覆盖率/返工；费用 not-evaluated，无 CSV）\n");
  p("> 只列尝试数最多的前 20 个任务。cost=not-evaluated（未提供费用 CSV）。landed=证明落地；not-landed=明确未落地；unknown=证据不足。\n");
  p("| task | 尝试 | 返工 | 累计 wall | 墙钟归属覆盖均值 | 落地 |\n|---|---|---|---|---|---|\n");
  for (const t of sum.perTask.slice(0, 20)) {
    const landing = t.landed ? "landed" : (t.notLanded ? "not-landed" : "unknown");
    p("| ", t.task, " | ", String(t.attempts), " | ", String(t.rework), " | ", fmtMs(t.cumulativeWallMs), " | ",
      t.wallAttrMean != null ? t.wallAttrMean.toFixed(3) : "not-evaluated", " | ", landing, " |\n");
  }

  p("\n## 无法关联记录与覆盖率（AC3）\n");
  p("| 量 | 值 |\n|---|---|\n");
  p("| verification-round.jsonl 总量 | ", String(sum.totalVerificationRounds), " |\n");
  p("| 唯一 suite 数（proven 关联） | ", String(sum.uniqueSuiteCount), " |\n");
  p("| 关联覆盖率（唯一 suite / 总量） | ", sum.totalVerificationRounds ? (sum.uniqueSuiteCount / sum.totalVerificationRounds).toFixed(3) : "n/a", " |\n");
  p("| 未归属/歧义/缺身份记录 | ", String(sum.unattributedRounds), " |\n");
  p("| fan-in 过程日志（尝试级）：有 trace | ", String(sum.withTrace), " / ", String(sum.attemptsTotal), " |\n");

  p("\n## 轮数分解（可下钻至原会话）\n");
  p("窗口：`", windowStartIso, "` → `", windowEndIso, "`；unwindowed 会话：", String(rounds.unwindowed),
    "（窗口外 ", String(rounds.unwindowedOutside), "，缺时间戳 ", String(rounds.unwindowedMissing), "，不计入窗口读数）。\n");
  p("> 分类是启发式（每轮 = 一条按 message.id 去重后的 assistant 消息）：exploration（首次 Read/Grep/Glob/find）/ tool-wait（本轮无工具动作，等待/思考）/ repeated-read（再读已读文件）/ verification（测试/task_check/gate）/ fix（Edit/Write/git 变更）/ unclassified（无法判断，保守单列）。下钻靠 sessionId（会话 jsonl）。\n");
  p("| 类别 | 轮数 |\n|---|---|\n");
  for (const c of rounds.categories) p("| ", c, " | ", String(rounds.catCounts[c]), " |\n");
  p("\n- worker 会话数：", String(rounds.sessionsTotal), "；总轮数（按 message.id 去重）：", String(rounds.totalRounds), "\n");
  p("- 缺 message.id 逐条计 1 轮的记录（roundsMissingId，⛔ 不与去重后的轮数合并）：", String(rounds.roundsMissingId), "\n");
  p("- 不能分类者单列（unclassified）：", String(rounds.catCounts.unclassified), "\n");

  p("\n## E5 证据（锁等待 + 队列等待 + 供给/资源拒绝；只输出直接读数，不做无依据推断）\n");
  p("窗口：`", windowStartIso, "` → `", windowEndIso, "`；队列等待 unwindowed：", String(e5.queueUnwindowed),
    "（窗口外 ", String(e5.queueUnwindowedOutside), "，缺 recordedAtMs ", String(e5.queueUnwindowedMissing), "）；stop_reason unwindowed：",
    String(e5.stopReasonUnwindowed), "（窗口外 ", String(e5.stopReasonUnwindowedOutside), "，缺 ts ", String(e5.stopReasonUnwindowedMissing), "）。\n");
  p("| 量 | 值 |\n|---|---|\n");
  p("| fan-in 锁等待 p50 / p90 / max | ", fmtMs(e5.fanInLockWaitP50), " / ", fmtMs(e5.fanInLockWaitP90), " / ", fmtMs(e5.fanInLockWaitMax), " |\n");
  p("| fan-in 锁等待可测尝试数 | ", String(e5.fanInLockWaitCount), " |\n");
  p("| 队列等待（queuedAt→startedAt）p50 / p90 | ", fmtMs(e5.queueDelayP50), " / ", fmtMs(e5.queueDelayP90), " |\n");
  p("| 队列等待可测记录 / 缺 queuedAtMs 记录 | ", String(e5.queueMeasurable), " / ", String(e5.queueMissing), "（缺值 = 未查，⛔ 不是 0） |\n");
  p("| ready 池空轮数（pool-empty，供给状态） | ", String(e5.poolEmptyRounds), " |\n");
  p("| 资源门阻塞轮数（resource-gate-wait，资源拒绝） | ", String(e5.resourceGateRounds), " |\n");
  p("| 派发环 stop_reason 分布 | `", JSON.stringify(e5.stopReasonCounts), "` |\n");
  p("| 持续队列判定 | ", String(e5.persistentQueue), "（需要待处理量/等待区间直接证据；pool-empty + resource-gate-wait 相加不等于持续队列） |\n");
  p("\n结论：吞吐瓶颈是否成立，本报告保持未知——只给锁等待、队列等待、供给/资源拒绝的直接读数；不修改锁、fail-closed、AC/DoD 或 G3。\n");

  p("\n## 抽查实例（AC6：历史重派任务 / 误关联验证轮 / 受测但未证实落地）\n");
  // (a) 历史重派任务：尝试数最多的任务，逐尝试给落地状态与 suite 关联。
  const byTaskAttempts = new Map();
  for (const a of ctx.attempts) { if (!byTaskAttempts.has(a.task)) byTaskAttempts.set(a.task, []); byTaskAttempts.get(a.task).push(a); }
  const multiTask = [...byTaskAttempts.entries()].sort((x, y) => y[1].length - x[1].length)[0];
  if (multiTask) {
    const [t, as] = multiTask;
    p("重派任务：`", t, "`（", String(as.length), " 次尝试）\n");
    p("| started_at | final_state | wall | suite 关联 | 落地 |\n|---|---|---|---|---|\n");
    for (const a of as) {
      p("| ", a.started_at, " | ", a.final_state, " | ", fmtMs(a.wall_clock_ms), " | ", a.suiteAssociation, " | ", a.landingStatus, " |\n");
    }
  }
  // (b) 误关联验证轮（旧兜底会回填）：某尝试窗口内无 suite 记录（missing），但同任务其它尝试有
  //     proven suite 记录 ⇒ 旧实现会把其它尝试的记录回填给本尝试。
  const backfillExample = ctx.attempts.find((a) => a.suiteAssociation === "missing"
    && byTaskAttempts.get(a.task)?.some((o) => o.suiteUniqueRecords?.length > 0)
    && byTaskAttempts.get(a.task)?.length > 1);
  if (backfillExample) {
    const others = byTaskAttempts.get(backfillExample.task).filter((o) => o.suiteUniqueRecords?.length > 0);
    p("误关联验证轮示例：`", backfillExample.task, "` 尝试 started_at=", backfillExample.started_at, " 窗口内无 suite 记录（association=missing），旧实现会回填同任务其它 ", String(others.length), " 条记录；新口径判 missing/unknown，不把后一次落地回填给前一次。\n");
  }
  // (c) 受测但未证实落地：有 proven 受测 SHA 但没有 ff ok。
  const testedNotLanded = ctx.attempts.find((a) => a.suiteUniqueRecords?.length > 0 && a.landingStatus !== "landed");
  if (testedNotLanded) {
    const r = testedNotLanded.suiteUniqueRecords[0];
    p("受测但未证实落地示例：`", testedNotLanded.task, "` started_at=", testedNotLanded.started_at, " 受测 SHA=`", String(r.terminalCommit ?? r.commit ?? "?"), "`（suite 记录 round=", String(r.round ?? "?"), "）但无 ff ok ⇒ 落地=", testedNotLanded.landingStatus, "（受测 SHA 不是落地证据）。\n");
  }

  p("\n## 旧报告撤回与修正（口径修正）\n");
  p("> 本任务（gap-e1-round-count-and-landing-carrier）撤回旧口径下的下列读数，并给修正值。复跑命令见文首。\n");
  p("| 旧口径读数 | 旧值 | 修正值 | 原因 |\n|---|---|---|---|\n");
  p("| 轮数（同窗口 totalRounds） | 22,863 | ", String(rounds.totalRounds),
    " | 旧口径按 `type:assistant` 行数计，同一 `message.id` 被 apiBlockIndex 拆成多条记录（thinking/text/tool_use）重复计 ⇒ 2.2× 高估；这是「未按 message.id 去重的行数口径」。现在按 message.id 去重（缺 id 单列 roundsMissingId=", String(rounds.roundsMissingId), "） |\n");
  p("| 成功落地任务数（同窗口 landedTasks） | 77 | ", String(sum.landedTasks),
    " | 旧口径只读 `.log` 且 (a) 按文件名 `!f.includes(\"suite\")` 误排除 task 名含 suite 的 `.log`、(b) 以尝试窗口 `[started_at, ended_at]` 上界过滤 ff（而 ff 发生在 worker ended_at 之后）⇒ 少算 17 个落地任务。现在修复 `.log` 扫描、并集 `fan-in-step-trace.jsonl` 的 `step=ff` 的 `step-end` 且 `ok:true`，且 ff 只归给任务最后一条尝试（落地证据来源分布 log/step-trace/both/unknown=`", JSON.stringify(sum.landingSourceCounts), "`） |\n");

  return L.join("");
}

function renderJson(args, src, ctx, sum, rounds, e5, fp) {
  return JSON.stringify({
    window: { start: ctx.winStart ? new Date(ctx.winStart).toISOString() : null, end: ctx.winEnd ? new Date(ctx.winEnd).toISOString() : null },
    fingerprint: fp,
    sources: {
      workerOutcome: src.workerOutcome.length,
      fanInTraceFiles: src.fanInTraceByName.size,
      stepTrace: src.stepTrace.length,
      fanInLockEvents: src.fanInLockEvents.length,
      verificationRound: src.verificationRound.length,
      fastModeTelemetry: src.fastModeTelemetry.length,
      workflowEvents: src.workflowEvents.length,
      workerSessions: src.workerSessions.length,
      csvPresent: src.csvPresent,
      csvRecords: src.csvRecords.length,
    },
    duplicatesDropped: ctx.duplicates.length,
    missingStart: ctx.missingStart,
    missingEnd: ctx.missingEnd,
    reusedRunIds: ctx.reusedRunIds,
    summary: sum,
    rounds,
    e5,
  }, null, 2);
}

// ── main ────────────────────────────────────────────────────────────────────
function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { process.stdout.write(HELP); return 0; }
  const src = readSources(args);
  const ctx = buildAttempts(src, args);
  attachFanInTrace(src, ctx.attempts);
  attachSuite(src, ctx.attempts);
  attachLanding(src, ctx.attempts);
  const sum = summarize(src, args, ctx);
  const rounds = classifyRounds(src, args, ctx);
  const e5 = e5Evidence(src, ctx);
  const fp = inputFingerprint(src, args, ctx);
  if (args.json) process.stdout.write(renderJson(args, src, ctx, sum, rounds, e5, fp) + "\n");
  else process.stdout.write(renderMarkdown(args, src, ctx, sum, rounds, e5, fp));
  return 0;
}

// 直接执行时跑 main；被 import（单测）时只导出函数，不执行。
import { pathToFileURL } from "node:url";
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = main(process.argv.slice(2));

export {
  parseArgs, readSources, buildAttempts, attachFanInTrace, attachSuite, attachLanding,
  summarize, classifyRounds, e5Evidence, fanInLogFileName, parseIso, pct, median,
  firstUserMessageText, parseCsv, classifySuiteOutcome, suiteVerdict, recordKey,
  tsToMs, windowMembership, sessionFirstTsMs,
};
