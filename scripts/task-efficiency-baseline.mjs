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
//                            cpu_time_s/cpu_source/taskId/runId/…）
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
//   · suite run   = verification-round.jsonl 的一条记录（runId/taskId 若缺 ⇒ 无法唯一关联，如实报告）
//   · landing     = fanInCommit SHA（fast-mode telemetry）或 fan-in 日志的 ff 步骤
//
// 输出：默认 markdown（人类可读报告，可直接落盘 docs/analysis/task-efficiency-baseline.md），
//       --json 输出机器可核的 JSON（AC 覆盖用）。
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

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
  fan-in 步骤按尝试窗口 [started_at, ended_at] 归属；窗口外/无日志 ⇒ 未归属。
  suite 记录按 (runId, taskId) 关联；两键缺一 ⇒ 无法唯一关联（单独计量）。
  landing 证据 = fast-mode telemetry 的 fanInCommit，或 fan-in 日志的 ff 步骤。
  completed outcome（worker 退出码 0 的 final_state=completed）≠ 权威落地证据
  （权威落地 = fanInCommit SHA 在 git 历史中可核到）。

时间口径：wall-clock 用记录自带时间戳差；CPU-seconds 只取 cpu_time_s 且
  cpu_source=gnu-time 的实测值，⛔ 不用 wall-time 换算。
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

  // 2) fan-in 过程日志（按磁盘扫描，去重）
  const qdir = join(root, ".quay");
  src.fanInTraceFiles = readdirSync(qdir).filter((f) => f.startsWith("fan-in-") && f.endsWith(".log") && !f.includes("suite"));
  const traceByName = new Map();
  for (const f of src.fanInTraceFiles) {
    const records = readJsonl(join(qdir, f)).filter((r) => typeof r.step === "string");
    if (records.length > 0) traceByName.set(f, records);
  }
  src.fanInTraceByName = traceByName;

  // 3) fan-in-lock-events.jsonl
  src.fanInLockEvents = readJsonl(join(qdir, "fan-in-lock-events.jsonl"));

  // 4) verification-round.jsonl
  src.verificationRound = readJsonl(join(qdir, "verification-round.jsonl"));

  // 4b) worker-round.jsonl（每轮派发环的 stop_reason：pool-empty / resource-gate-wait / filtered-empty /
  //     backoff / mcp-halt —— AC5 的资源门拒绝与 ready 池空证据）
  src.workerRound = readJsonl(join(qdir, "worker-round.jsonl"));

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
function attachFanInTrace(src, attempts) {
  const root = src.root;
  for (const a of attempts) {
    a.trace = [];
    a.traceSource = null;
    a.traceAvailable = false;
    a.fanInLockWaitMs = null;
    a.suiteExecMs = null;
    a.suiteSkipped = false;
    a.fanInStepMs = {};
    const file = fanInLogFileName(a.task, a.run_id);
    const records = src.fanInTraceByName.get(file);
    if (!records) continue;
    a.traceAvailable = true;
    a.traceSource = file;
    const inWin = records.filter((r) => {
      const t = parseIso(r.ts);
      return t != null && (a.startedAtMs == null || t >= a.startedAtMs) && (a.endedAtMs == null || t <= a.endedAtMs);
    });
    a.trace = inWin;
    a.fanInLockWaitMs = stepWall(a.trace, "acquire-fan-in-lock");
    a.suiteExecMs = stepWall(a.trace, "suite-end") ?? stepWall(a.trace, "suite-start") ?? null;
    a.suiteSkipped = a.trace.some((r) => r.step === "suite-skip");
    a.fanInStepMs = {};
    for (const r of a.trace) {
      if (typeof r.wall_ms === "number") a.fanInStepMs[r.step] = (a.fanInStepMs[r.step] || 0) + r.wall_ms;
    }
  }
}
function stepWall(trace, step) {
  const rs = trace.filter((r) => r.step === step);
  if (rs.length === 0) return null;
  const walls = rs.map((r) => r.wall_ms).filter((w) => typeof w === "number");
  if (walls.length === 0) return null;
  return walls[walls.length - 1];
}

// 落地证据：权威 = verification-round 的 terminalCommit/commit（按 taskId+窗口 归属）；
// 回退 = fan-in 日志 ff 步骤 ok。fast-mode telemetry 的 fanInCommit 属于 `fm-*` 空间，不 join。
function attachLanding(src, attempts) {
  // 由 attachSuite 先行填好 a.suiteRecords；这里只从 suiteRecords 里取权威 SHA。
  for (const a of attempts) {
    let sha = null;
    for (const v of a.suiteRecords || []) {
      const c = typeof v.terminalCommit === "string" && v.terminalCommit ? v.terminalCommit
        : (typeof v.commit === "string" && v.commit ? v.commit : null);
      if (c) sha = c;
    }
    if (!sha && a.trace && a.trace.some((r) => r.step === "ff" && r.ok === true)) {
      a.ffStepOk = true;
    }
    a.fanInCommit = sha;
    a.landed = sha != null;
    a.landedEvidence = sha != null ? "verification-round.commit" : (a.ffStepOk ? "fan-in-trace.ff" : null);
  }
}

// suite 关联：verification-round 按 taskId 关联（runId 空间不一致——worker-outcome 是 wk-prod-*，
// verification-round 是 fm-*/mfi-*/少数 wk-*，⛔ 不能用 runId 当唯一键）；再按尝试窗口过滤。
function attachSuite(src, attempts) {
  const byTask = new Map();
  for (const v of src.verificationRound) {
    if (!v.taskId) continue;
    if (!byTask.has(v.taskId)) byTask.set(v.taskId, []);
    byTask.get(v.taskId).push(v);
  }
  for (const a of attempts) {
    const recs = byTask.get(a.task) || [];
    const inWin = recs.filter((v) => {
      const s = parseIso(v.startedAt);
      if (s == null) return true; // 无 startedAt ⇒ 保留（仍按 taskId 关联）
      return (a.startedAtMs == null || s >= a.startedAtMs - 60_000) && (a.endedAtMs == null || s <= a.endedAtMs + 60_000);
    });
    a.suiteRecords = inWin.length > 0 ? inWin : recs;
    a.suiteUnique = recs.length <= 1;
    if (a.suiteRecords.length > 0) {
      const last = a.suiteRecords[a.suiteRecords.length - 1];
      a.suiteLockWaitMs = num(last.lock_wait_ms);
      a.suiteLockHoldMs = num(last.lock_hold_ms);
      a.suiteDurationMs = num(last.durationMs);
      a.cpuTimeS = num(last.cpu_time_s);
      a.cpuSource = last.cpu_source ?? null;
    }
  }
}
function num(x) { return typeof x === "number" && Number.isFinite(x) ? x : null; }

// ── 汇总 ───────────────────────────────────────────────────────────────────
function summarize(src, args, ctx) {
  const attempts = ctx.attempts.filter((a) => (args.task ? a.task === args.task : true));
  const byTask = new Map();
  for (const a of attempts) {
    if (!byTask.has(a.task)) byTask.set(a.task, []);
    byTask.get(a.task).push(a);
  }
  const landedTasks = new Set([...byTask.entries()].filter(([, as]) => as.some((a) => a.landed)).map(([t]) => t));
  const wallClocks = attempts.map((a) => a.wall_clock_ms).filter((x) => typeof x === "number" && x > 0).sort((x, y) => x - y);
  const lockWaits = attempts.map((a) => a.fanInLockWaitMs).filter((x) => typeof x === "number").sort((x, y) => x - y);
  const suiteDurations = attempts.map((a) => a.suiteExecMs).filter((x) => typeof x === "number").sort((x, y) => x - y);
  const cpus = attempts.map((a) => a.cpuTimeS).filter((x) => typeof x === "number").sort((x, y) => x - y);

  // 分阶段合计（有 trace 的尝试）
  const phaseTotals = {};
  let withTrace = 0, withSuiteRec = 0, withCpu = 0, withLock = 0;
  for (const a of attempts) {
    if (a.trace && a.trace.length > 0) {
      withTrace++;
      for (const [k, v] of Object.entries(a.fanInStepMs || {})) phaseTotals[k] = (phaseTotals[k] || 0) + v;
    }
    if (a.suiteRecords && a.suiteRecords.length > 0) withSuiteRec++;
    if (a.cpuTimeS != null && a.cpuSource === "gnu-time") withCpu++;
    if (a.fanInLockWaitMs != null) withLock++;
  }

  // 尝试级 ITE = 已归属阶段墙钟 / 端到端墙钟（缺归属 ⇒ null，不伪造 0）
  const ites = [];
  for (const a of attempts) {
    const attr = a.fanInStepMs ? Object.values(a.fanInStepMs).reduce((s, v) => s + v, 0) : null;
    if (a.wall_clock_ms != null && attr != null && a.wall_clock_ms > 0) {
      ites.push({ task: a.task, ite: Math.min(1, attr / a.wall_clock_ms), attrMs: attr, wallMs: a.wall_clock_ms });
    }
  }
  ites.sort((x, y) => x.ite - y.ite);

  return {
    attemptsTotal: attempts.length,
    tasksTotal: byTask.size,
    landedTasks: landedTasks.size,
    reworkTasks: [...byTask.entries()].filter(([, as]) => as.length > 1).length,
    maxAttempts: Math.max(0, ...[...byTask.values()].map((as) => as.length)),
    wallClockP50: median(wallClocks),
    wallClockP90: pct(wallClocks, 90),
    lockWaitP50: median(lockWaits),
    lockWaitP90: pct(lockWaits, 90),
    suiteP50: median(suiteDurations),
    suiteP90: pct(suiteDurations, 90),
    cpuP50: median(cpus),
    cpuP90: pct(cpus, 90),
    cpuSumS: cpus.reduce((s, v) => s + v, 0),
    withTrace, withSuiteRec, withCpu, withLock,
    phaseTotals,
    iteP50: median(ites.map((i) => i.ite)),
    iteP90: pct(ites.map((i) => i.ite), 90),
    ites,
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
  // 每个 worker 会话，逐条 assistant 消息（round）分类。
  const sessions = args.task
    ? src.workerSessions.filter((s) => s.task === args.task)
    : src.workerSessions;
  const categories = ["exploration", "tool-wait", "repeated-read", "verification", "fix", "unclassified"];
  const catCounts = Object.fromEntries(categories.map((c) => [c, 0]));
  const perSession = [];
  const sessionsDir = src.sessionsDir;
  let totalRounds = 0;
  const readCacheBySession = new Map();

  for (const s of sessions) {
    const p = join(sessionsDir, s.file);
    const text = readFileSafe(p);
    if (text == null) continue;
    const rounds = [];
    const readSet = new Set();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type !== "assistant") continue;
      const cat = classifyOneRound(o, readSet);
      rounds.push(cat);
      totalRounds++;
    }
    readCacheBySession.set(s.sessionId, readSet);
    const sc = {};
    for (const c of categories) sc[c] = rounds.filter((r) => r === c).length;
    perSession.push({ sessionId: s.sessionId, task: s.task, rounds: rounds.length, ...sc });
  }
  for (const p of perSession) for (const c of categories) catCounts[c] += p[c];
  return { totalRounds, catCounts, perSession, categories, sessionsTotal: sessions.length };
}

function classifyOneRound(o, readSet) {
  const msgs = o.message?.content;
  const toolUses = (Array.isArray(msgs) ? msgs : []).filter((m) => m.type === "tool_use");

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

// ── E5 证据：锁等待 + 持续队列 + 资源门/ready 池空 ─────────────────────────
function e5Evidence(src, ctx) {
  // 锁等待：fan-in 锁 acquire 的 wall_ms。
  const fanInLockWaits = [];
  for (const a of ctx.attempts) if (typeof a.fanInLockWaitMs === "number") fanInLockWaits.push(a.fanInLockWaitMs);
  fanInLockWaits.sort((x, y) => x - y);

  // 队列等待（workflow-event start 记录 queuedAtMs→startedAtMs）。fm-* 时代多数 queuedAtMs=null ⇒
  // not-evaluated（缺值 = 未查，⛔ 不与 0 共用取值）。
  const queueDelays = [];
  let queueMeasurable = 0, queueMissing = 0;
  for (const e of src.workflowEvents) {
    if (e.eventKind !== "start") continue;
    const q = e.timing?.queuedAtMs, st = e.timing?.startedAtMs;
    if (typeof q === "number" && typeof st === "number") { queueMeasurable++; if (st >= q) queueDelays.push(st - q); }
    else queueMissing++;
  }
  queueDelays.sort((x, y) => x - y);

  // 派发环 stop_reason：ready 池空 / 资源门 / 过滤空 / 退避 / 停泊。持续队列 = 这些非派发轮的存在。
  const stopReasonCounts = {};
  for (const r of src.workerRound) {
    const s = r.stop_reason;
    const key = s == null ? "dispatched(no-stop)" : String(s).replace(/\s*\(.*$/, "").split(":")[0];
    stopReasonCounts[key] = (stopReasonCounts[key] || 0) + 1;
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
    stopReasonCounts,
    resourceGateRounds: stopReasonCounts["resource-gate-wait"] || 0,
    poolEmptyRounds: stopReasonCounts["pool-empty"] || 0,
    persistentQueueEvidence: (stopReasonCounts["pool-empty"] || 0) + (stopReasonCounts["resource-gate-wait"] || 0),
    lockWaitSignificant: median(fanInLockWaits) != null && median(fanInLockWaits) > 60_000,
  };
}

// ── 报告渲染 ───────────────────────────────────────────────────────────────
function renderMarkdown(args, src, ctx, sum, rounds, e5) {
  const L = [];
  const p = (...xs) => L.push(xs.join(""));
  const windowStartIso = ctx.winStart != null ? new Date(ctx.winStart).toISOString() : "n/a";
  const windowEndIso = ctx.winEnd != null ? new Date(ctx.winEnd).toISOString() : "n/a";

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

  p("\n## 数据来源与字段清单\n");
  p("| 来源 | 记录数 | 字段 | 身份键 |\n|---|---|---|---|\n");
  const srcTable = [
    ["worker-outcome.jsonl", src.workerOutcome.length, inventoryFields(src.workerOutcome), "(task, started_at, ts)"],
    ["fan-in 过程日志", src.fanInTraceByName.size, "step/ts/wall_ms/ok", "(task, run_id) + 尝试窗口"],
    ["fan-in-lock-events.jsonl", src.fanInLockEvents.length, inventoryFields(src.fanInLockEvents), "(taskId, pid, ts)"],
    ["verification-round.jsonl", src.verificationRound.length, inventoryFields(src.verificationRound), "(taskId, startedAt) — runId 是 fm-*/mfi-* 空间"],
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
  p("| 成功落地任务数（分母①） | ", String(sum.landedTasks), " |\n");
  p("| 所有尝试（分母②） | ", String(sum.attemptsTotal), " |\n");
  p("| 落地任务 / 所有尝试 | ", sum.attemptsTotal ? (sum.landedTasks / sum.attemptsTotal).toFixed(3) : "n/a", " |\n");
  p("| 有返工（>1 次尝试）的任务 | ", String(sum.reworkTasks), " |\n");
  p("| 单任务最大尝试数 | ", String(sum.maxAttempts), " |\n");
  p("| 被复用到 >1 任务的 run_id 数 | ", String(ctx.reusedRunIds), " |\n");
  p("| 尝试 wall-clock p50 / p90 | ", fmtMs(sum.wallClockP50), " / ", fmtMs(sum.wallClockP90), " |\n");
  p("| fan-in 锁等待 p50 / p90 | ", fmtMs(sum.lockWaitP50), " / ", fmtMs(sum.lockWaitP90), " |\n");
  p("| suite 执行 p50 / p90（fan-in 日志） | ", fmtMs(sum.suiteP50), " / ", fmtMs(sum.suiteP90), " |\n");
  p("| CPU-seconds p50 / p90（仅 gnu-time 实测） | ", fmtSec(sum.cpuP50), " / ", fmtSec(sum.cpuP90), " |\n");
  p("| CPU-seconds 合计（仅 gnu-time 实测） | ", fmtSec(sum.cpuSumS), " |\n");
  p("| ITE（Idle Time Efficiency，已归属墙钟/端到端）p50 / p90 | ",
    sum.iteP50 != null ? sum.iteP50.toFixed(3) : "not-evaluated", " / ",
    sum.iteP90 != null ? sum.iteP90.toFixed(3) : "not-evaluated", " |\n");
  p("\nfinal_state 分布：`", JSON.stringify(sum.finalStateCounts), "`\n");

  p("\n## 分阶段墙钟（有 fan-in 日志的尝试）\n");
  p("> 只有真实可测部分可宣称已建立基线；CPU 只取真实 CPU 计量（cpu_source=gnu-time），⛔ 不用 wall-time 换算。\n");
  p("| 阶段 | 累计 wall_ms | 覆盖尝试数（", String(sum.withTrace), "） |\n|---|---|---|\n");
  for (const [k, v] of Object.entries(sum.phaseTotals).sort((a, b) => b[1] - a[1])) {
    p("| ", k, " | ", String(Math.round(v)), " | ", String(sum.withTrace), " |\n");
  }
  p("\n- 有 trace 的尝试：", String(sum.withTrace), " / ", String(sum.attemptsTotal), "\n");
  p("- 有 suite 记录关联的尝试：", String(sum.withSuiteRec), "\n");
  p("- 有 gnu-time CPU 实测的尝试：", String(sum.withCpu), "（", sum.attemptsTotal ? (sum.withCpu / sum.attemptsTotal * 100).toFixed(1) : "0", "%）\n");
  p("- 有 fan-in 锁等待读数的尝试：", String(sum.withLock), "\n");

  p("\n### 费用维度\n");
  if (src.csvPresent) {
    p("CSV 存在（", String(src.csv), "），记录数 ", String(src.csvRecords.length), "。\n");
  } else {
    p("**not-evaluated**：未提供 `--csv`。所缺输入：把 attempt→费用 映射的 CSV（含 task/attempt 身份与计费额）。⛔ 不把 token 估计写成实际账单。\n");
  }

  p("\n### CPU 维度\n");
  p("只取 `verification-round.jsonl` 中 `cpu_time_s` 且 `cpu_source=gnu-time` 的实测值。其余记录不参与 CPU 聚合。\n");

  p("\n## 无法关联记录与覆盖率\n");
  p("| 载体 | 总量 | 可关联 | 无法唯一关联/未归属 |\n|---|---|---|---|\n");
  const unassocSuite = src.verificationRound.filter((v) => !v.runId || !v.taskId).length;
  p("| verification-round.jsonl | ", String(src.verificationRound.length), " | ", String(src.verificationRound.length - unassocSuite), " | ", String(unassocSuite), "（缺 runId/taskId） |\n");
  p("| fan-in 过程日志（尝试级） | ", String(ctx.attempts.length), " | ", String(sum.withTrace), " | ", String(ctx.attempts.length - sum.withTrace), "（无日志/窗口外） |\n");

  p("\n## 轮数分解（可下钻至原会话）\n");
  p("> 分类是启发式（每轮 = 一条 assistant 消息）：exploration（首次 Read/Grep/Glob/find）/ tool-wait（本轮无工具动作，等待/思考）/ repeated-read（再读已读文件）/ verification（测试/task_check/gate）/ fix（Edit/Write/git 变更）/ unclassified（无法判断，保守单列）。下钻靠 sessionId（会话 jsonl）。\n");
  p("| 类别 | 轮数 |\n|---|---|\n");
  for (const c of rounds.categories) p("| ", c, " | ", String(rounds.catCounts[c]), " |\n");
  p("\n- worker 会话数：", String(rounds.sessionsTotal), "；总轮数：", String(rounds.totalRounds), "\n");
  p("- 不能分类者单列（unclassified）：", String(rounds.catCounts.unclassified), "\n");
  p("\n抽查（每任务尝试数与 sessionId 可见，下钻到 `", src.sessionsDir, "/<sessionId>.jsonl`）：\n");
  p("| task | sessionId | 轮数 | exploration | verification | fix | unclassified |\n|---|---|---|---|---|---|---|\n");
  for (const s of rounds.perSession.slice(0, 20)) {
    p("| ", s.task, " | ", s.sessionId, " | ", String(s.rounds), " | ", String(s.exploration), " | ", String(s.verification), " | ", String(s.fix), " | ", String(s.unclassified), " |\n");
  }

  p("\n## E5 证据（锁等待 + 持续队列 + 资源门/ready 池空；只输出证据，不启动锁改造）\n");
  p("| 量 | 值 |\n|---|---|\n");
  p("| fan-in 锁等待 p50 / p90 / max | ", fmtMs(e5.fanInLockWaitP50), " / ", fmtMs(e5.fanInLockWaitP90), " / ", fmtMs(e5.fanInLockWaitMax), " |\n");
  p("| fan-in 锁等待可测尝试数 | ", String(e5.fanInLockWaitCount), " |\n");
  p("| 队列等待（queuedAt→startedAt）p50 / p90 | ", fmtMs(e5.queueDelayP50), " / ", fmtMs(e5.queueDelayP90), " |\n");
  p("| 队列等待可测记录 / 缺 queuedAtMs 记录 | ", String(e5.queueMeasurable), " / ", String(e5.queueMissing), "（缺值 = 未查，⛔ 不是 0） |\n");
  p("| ready 池空轮数（pool-empty） | ", String(e5.poolEmptyRounds), " |\n");
  p("| 资源门阻塞轮数（resource-gate-wait） | ", String(e5.resourceGateRounds), " |\n");
  p("| 派发环 stop_reason 分布 | `", JSON.stringify(e5.stopReasonCounts), "` |\n");
  p("| 持续队列/阻塞证据（pool-empty + resource-gate-wait） | ", String(e5.persistentQueueEvidence), " 轮 |\n");
  p("| 锁等待显著（p50>60s）？ | ", String(e5.lockWaitSignificant), " |\n");
  p("\n结论：吞吐瓶颈是否成立，本报告保持未知——只给锁等待与队列/阻塞的直接读数；不修改锁、fail-closed、AC/DoD 或 G3。\n");

  p("\n## 抽查实例（DoD：至少一个多次尝试任务 + 一个无法关联实例）\n");
  const multiAttempt = [...new Map(sum.ites.map((i) => [i.task, i])).values()].filter(() => true).slice(0, 0);
  // 找多次尝试任务
  const byTaskAttempts = new Map();
  for (const a of ctx.attempts) { if (!byTaskAttempts.has(a.task)) byTaskAttempts.set(a.task, []); byTaskAttempts.get(a.task).push(a); }
  const multiTask = [...byTaskAttempts.entries()].filter(([, as]) => as.length > 1).slice(0, 1);
  if (multiTask.length) {
    const [t, as] = multiTask[0];
    p("多次尝试任务：`", t, "`（", String(as.length), " 次尝试）\n");
    for (const a of as) {
      p("- started_at ", a.started_at, " final_state=", a.final_state, " wall=", fmtMs(a.wall_clock_ms), " fanInLockWait=", fmtMs(a.fanInLockWaitMs), " suiteExec=", fmtMs(a.suiteExecMs), " landed=", String(a.landed), "\n");
    }
  }
  const unassocSuiteSample = src.verificationRound.find((v) => !v.runId || !v.taskId);
  if (unassocSuiteSample) {
    p("无法唯一关联实例（verification-round 缺 runId/taskId）：`", JSON.stringify({ round: unassocSuiteSample.round, startedAt: unassocSuiteSample.startedAt, runId: unassocSuiteSample.runId ?? null, taskId: unassocSuiteSample.taskId ?? null }).slice(0, 300), "`\n");
  }

  return L.join("");
}

function renderJson(args, src, ctx, sum, rounds, e5) {
  return JSON.stringify({
    window: { start: ctx.winStart ? new Date(ctx.winStart).toISOString() : null, end: ctx.winEnd ? new Date(ctx.winEnd).toISOString() : null },
    sources: {
      workerOutcome: src.workerOutcome.length,
      fanInTraceFiles: src.fanInTraceByName.size,
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
  if (args.json) process.stdout.write(renderJson(args, src, ctx, sum, rounds, e5) + "\n");
  else process.stdout.write(renderMarkdown(args, src, ctx, sum, rounds, e5));
  return 0;
}

// 直接执行时跑 main；被 import（单测）时只导出函数，不执行。
import { pathToFileURL } from "node:url";
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = main(process.argv.slice(2));

export {
  parseArgs, readSources, buildAttempts, attachFanInTrace, attachSuite, attachLanding,
  summarize, classifyRounds, e5Evidence, fanInLogFileName, parseIso, pct, median,
  firstUserMessageText, parseCsv,
};
