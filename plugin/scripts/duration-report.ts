#!/usr/bin/env node
/**
 * duration-report.ts — 按窗口报出「尝试 / 任务」的时长读数，含**分阶段**拆分与**右删失**在飞态。
 *
 * ── 它回答什么问题 ──────────────────────────────────────────────────────────────────────
 * 「给定一个时间窗：完成的尝试/任务各花多久、pending 的有几个、排队等锁多久？」
 * 以及三个**必须分开报**的子问题（混在一起就是本模块诞生的原因）：
 *   · **实现段**（dispatch → worker 退出）——worker 真正干活的时间；
 *   · **fan-in 段**（worker 退出 → fan-in 结束）——合并/测试/落地的时间；
 *   · **锁等待**（request → acquire）——排队，不是干活。
 *
 * ── 为什么需要它（诊断缺口，2026-10-14）────────────────────────────────────────────────────
 * 诊断当时只能报「整段」（`worker-outcome.jsonl` 的 started_at..ended_at **含** fan-in），
 * 「实现完成时刻」「测试起止」「锁等待」都只能记成「现有载体算不出」。本模块把三者变成可复算读数。
 *
 * ── 右删失（right-censoring）是本模块的一等输出，不是脚注 ────────────────────────────────
 * 「窗口内完成的 N 个任务的中位时长」若不同时报出「同一窗口里已有尝试、却还没终态的任务数与年龄」，
 * 读者会把「还活着的长任务」当成不存在，从而**系统性低估**时长分布。故每个窗口都并列三段：
 * finished / in-progress（`terminal:false`，带 age）/ 以及**未开始**的 ready（queue）。
 *
 * ── 硬规则（本模块按它们实现，不是注释里的口号）────────────────────────────────────────────
 * · **3b / 6（缺值 ≠ 合格）**：任何载体缺失、字段缺失、旧记录没有新阶段字段 ⇒ 该量取
 *   `NOT-EVALUATED`，⛔ **绝不落 0**、绝不静默跳过。`0` 只可能是**真的量出来的 0**。
 * · **2（按位置判定）**：终态取自 `tasks/*.md` frontmatter 的 `status` 与
 *   `.quay/task-status-events.jsonl` 的 `to` 字段**取值**，⛔ 不 grep 提交主题文本。
 * · **4b（直接量优先）**：在飞尝试取自**盘上的派发记录**（`.quay/worker-dispatch.json`，由 driver
 *   在 spawn 后立刻写、终态时删），⛔ 不用「最近有没有新 outcome」这类自证心跳推断。
 * · **4c（判据要穿过中间层）**：本模块**不改任何载体**，只把已有/新增的字段读出来；因此它对新旧记录
 *   都能跑——旧记录缺阶段字段 ⇒ 那几段报 `NOT-EVALUATED`，而不是报 0。
 *
 * ── ⛔ 已退役的口径（本模块同时是它的负控制读者）───────────────────────────────────────────
 * 旧读法把 per-run 过程日志 `.quay/fan-in-<task>-<runId>.log` 里 `acquire-fan-in-lock` 步的
 * `wall_ms` 当作「这一次尝试的排队时延」（`fan-in-queueing-model.ts` 的注释就是这么写的）。
 * **归属键 (task, runId) 不是尝试**：常驻 anchor 的 runId 是**进程级常量**（实测
 * `.quay/worker-outcome.jsonl` 里 `wk-prod-anchor` = 1148 条尝试 / 635 个任务），一个日志文件装着
 * 同一任务**多轮**的 acquire ⇒ 「取最后一组」会跨轮配对，读出**大于整段尝试**的锁等待（诊断实测
 * P90 264 分钟 vs 全程中位 18 分钟）。新记录里的 `lock_requested_at`/`lock_acquired_at` 按**尝试窗口**
 * 归属；旧口径的读数保留在 `legacy_lock_join`（同名并存，⛔ 不删除）供对照——本报告报出
 * `legacyLockJoinMismatches`（旧口径与窗口口径不一致的条数），它就是「旧算法错在哪」的可复算证据。
 *
 * Usage:
 *   node --experimental-strip-types plugin/scripts/duration-report.ts [--root <dir>] [--since <ISO>] [--until <ISO>] [--json]
 *   缺省窗口 = 最近 7 天（now - 7d .. now）。--since/--until 接受任何 `Date.parse` 认得的字符串。
 *
 * 退出码：0 = 报出（含 NOT-EVALUATED 段）；1 = 用法错误（参数读不懂）。载体缺失**不是**错误——
 * 报告里以 NOT-EVALUATED 呈现（缺值 = 未查，硬规则 6）。
 */
import fs from "node:fs";
import path from "node:path";
import { parseFrontmatterCompletely, frontmatterStatus } from "./task-schema.ts";
import { listTaskIds } from "./fast-mode-telemetry.ts";
// 入口判定按**文件名**认身份（bundle-safe，见文件末尾的注释）。
import { isDirectEntry } from "./gate-script-base.ts";

// ── 取值词表：三态，⛔「未评估」不得与数值共用形状（硬规则 3b）──────────────────────────────
export const NOT_EVALUATED = "NOT-EVALUATED" as const;
export type MaybeNum = number | typeof NOT_EVALUATED;

/** 一条尝试记录里本模块读的全部字段（其余原样忽略；⛔ 不复制一份完整 schema）。 */
export interface AttemptRecord {
  task: string;
  tsMs: number;
  runId: string | null;
  finalState: string | null;
  wallClockMs: number | null;
  dispatchedAtMs: number | null;
  /** `true` ⟺ `dispatchedAtMs` 是回退读 `started_at` 得来的（旧记录无 `dispatched_at`）。 */
  dispatchedAtFromLegacyStart: boolean;
  workerExitedAtMs: number | null;
  faninEndedAtMs: number | null;
  lockRequestedAtMs: number | null;
  lockAcquiredAtMs: number | null;
  lockWaitMs: number | null;
  suiteStartedAtMs: number | null;
  suiteEndedAtMs: number | null;
  legacyLockJoinMismatch: boolean | null;
}

/** 分段时长（全部 ms；`null` 的输入 ⇒ NOT-EVALUATED，⛔ 不折成 0）。 */
export interface PhaseDurations {
  attemptMs: MaybeNum;
  implementationMs: MaybeNum;
  faninMs: MaybeNum;
  lockWaitMs: MaybeNum;
  suiteMs: MaybeNum;
}

export interface Dist {
  n: number;
  min: MaybeNum;
  median: MaybeNum;
  p90: MaybeNum;
  max: MaybeNum;
  mean: MaybeNum;
}

/** 在飞（右删失）一条尝试的读数。 */
export interface InFlightAttempt {
  task: string;
  runId: string | null;
  workerPid: number | null;
  dispatchedAtMs: number | null;
  ageMs: MaybeNum;
  /** 恒 `false`——in-flight 尝试**不得**进任何时长统计；这个字段让读者不必靠「记录缺席」去猜。 */
  terminal: false;
  source: string;
}

/** 一条任务的报告行。 */
export interface TaskRow {
  task: string;
  /** 进入 ready 池的时刻（`.quay/task-status-events.jsonl` 里 `to:"ready"` 的第一条）。 */
  readyAtMs: number | null;
  /** 首次派发时刻（本任务最早一条尝试的 dispatched_at / started_at）。 */
  firstDispatchedAtMs: number | null;
  /** 排队时长（ready → 首次派发）；任一端缺 ⇒ NOT-EVALUATED。 */
  queueWaitMs: MaybeNum;
  /** 任务当前终态与否：`tasks/*.md` 的 status 读得出才算；读不出 ⇒ `null`（未评估）。 */
  terminal: boolean | null;
  status: string | null;
  attempts: number;
}

/** 窗口内一个任务「已 ready、未终态」——任务级右删失。 */
export interface InFlightTask {
  task: string;
  readyAtMs: number | null;
  ageMs: MaybeNum;
  terminal: false;
  status: string | null;
}

export interface DurationReport {
  window: { sinceMs: number; sinceIso: string; untilMs: number; untilIso: string };
  sources: Record<string, { path: string; present: boolean; records: MaybeNum }>;
  attempts: {
    finished: number;
    attemptMs: Dist;
    implementationMs: Dist;
    faninMs: Dist;
    lockWaitMs: Dist;
    suiteMs: Dist;
    /** 终态分布（`final_state` 取值 → 条数）。 */
    finalStates: Record<string, number>;
    /** 旧归属口径与窗口口径**不一致**的条数（旧算法错在哪的可复算证据）；窗口内无对照记录 ⇒ NOT-EVALUATED。 */
    legacyLockJoinMismatches: MaybeNum;
    legacyLockJoinComparable: MaybeNum;
  };
  /** 右删失：有派发记录、无终态（`terminal:false`）。 */
  inFlightAttempts: { count: number; rows: InFlightAttempt[]; agesMs: Dist };
  tasks: {
    finished: number;
    /** 任务级：ready → 首次派发（排队）。 */
    queueWaitMs: Dist;
    /** 任务级：首次派发 → 末次尝试结束（近似「任务占用墙钟」）。 */
    spanMs: Dist;
    /** 有尝试、但 status 读不出（**未评估**，⛔ 不计入 in-flight）的任务数——它界定了右删失集的
     *  **不完整边界**：这些任务的「是不是还活着」本报告答不了，故如实报出，⛔ 不静默丢。 */
    nonTerminalUnknownReadyAt: number;
    /** 首次派发时刻取自回退字段 `started_at`（旧记录）的任务数。 */
    firstDispatchFromLegacyStart: number;
    rows: TaskRow[];
  };
  /** 右删失：已 ready、未终态的任务。 */
  inFlightTasks: { count: number; rows: InFlightTask[]; agesMs: Dist };
}

// ── 统计小工具（⛔ 不引第三方）────────────────────────────────────────────────────────────
export function percentile(sorted: number[], p: number): MaybeNum {
  if (sorted.length === 0) return NOT_EVALUATED;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))];
}

export function dist(xs: number[]): Dist {
  if (xs.length === 0) {
    return { n: 0, min: NOT_EVALUATED, median: NOT_EVALUATED, p90: NOT_EVALUATED, max: NOT_EVALUATED, mean: NOT_EVALUATED };
  }
  const s = [...xs].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s[0],
    median: percentile(s, 0.5),
    p90: percentile(s, 0.9),
    max: s[s.length - 1],
    mean: s.reduce((a, b) => a + b, 0) / s.length,
  };
}

/** 差值两态：任一端缺 ⇒ NOT-EVALUATED（⛔ 不用 0 冒充「没有差」）。 */
export function deltaMs(endMs: number | null, startMs: number | null): MaybeNum {
  if (endMs === null || startMs === null) return NOT_EVALUATED;
  return endMs - startMs;
}

// ── 载体读取（只读；坏行/缺文件一律 fail-soft 成 null，⛔ 不抛）────────────────────────────
/** 逐行 JSONL 读取；返回 {present, records} —— present 与 records 分开，使「文件没有」与
 *  「文件在但一条都读不出」不同形（硬规则 3b）。 */
export function readJsonl(file: string): { present: boolean; records: Record<string, unknown>[] } {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { present: false, records: [] };
  }
  const records: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const r = JSON.parse(t);
      if (r && typeof r === "object" && !Array.isArray(r)) records.push(r);
    } catch {
      /* 坏行：跳过（运行态载体；⛔ 不因一行坏而报废整份报告，但也不假装读到了它） */
    }
  }
  return { present: true, records };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function iso(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** 把一条 `worker-outcome.jsonl` 记录归一成 AttemptRecord（缺字段 ⇒ null，⛔ 不从别处推）。 */
export function toAttemptRecord(rec: Record<string, unknown>): AttemptRecord | null {
  const task = str(rec.task);
  if (task === null) return null;
  const tsMs = iso(rec.ts) ?? iso(rec.ended_at);
  if (tsMs === null) return null;
  const legacy = rec.legacy_lock_join;
  const legacyMismatch =
    legacy && typeof legacy === "object" && typeof (legacy as { mismatch?: unknown }).mismatch === "boolean"
      ? ((legacy as { mismatch: boolean }).mismatch)
      : null;
  return {
    task,
    tsMs,
    runId: str(rec.run_id),
    finalState: str(rec.final_state),
    wallClockMs: num(rec.wall_clock_ms),
    // 新阶段字段：旧记录没有 ⇒ null（未评估）。`dispatched_at` 缺时**不**回退去读 `started_at`——
    // 那正是本任务要消灭的「同义字段悄悄兜底」，读者会以为读到了新口径。（两者同源，新记录必同时有。）
    // `dispatched_at` 是 `started_at` 的**正名**（同一个 startedAtMs 单一来源，见 computeOutcome 的注释）。
    // 故任务级的「首次派发」回退读 `started_at` 是**读同一个量**、不是同义字段兜底；回退发生过就如实标在
    // TaskRow.firstDispatchedSource 上（读者能分辨这条记录是哪一版写的）。⚠️ 但**尝试级**的分段差值
    // 不这样兜底（见上）：那需要 `worker_exited_at` 一起在，回退只会造出半真半假的段。
    dispatchedAtMs: iso(rec.dispatched_at) ?? iso(rec.started_at),
    dispatchedAtFromLegacyStart: iso(rec.dispatched_at) === null,
    workerExitedAtMs: iso(rec.worker_exited_at),
    faninEndedAtMs: iso(rec.fanin_ended_at),
    lockRequestedAtMs: iso(rec.lock_requested_at),
    lockAcquiredAtMs: iso(rec.lock_acquired_at),
    lockWaitMs: num(rec.fan_in_lock_wait_ms),
    suiteStartedAtMs: iso(rec.suite_started_at),
    suiteEndedAtMs: iso(rec.suite_ended_at),
    legacyLockJoinMismatch: legacyMismatch,
  };
}

/** 读 `.quay/worker-dispatch.json`（在飞尝试的**直接量**载体：driver 在 spawn 后立刻写、终态清）。 */
export function readInFlightAttempts(root: string, nowMs: number): InFlightAttempt[] {
  const file = path.join(root, ".quay", "worker-dispatch.json");
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: InFlightAttempt[] = [];
  for (const [task, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const dispatchedAtMs = num(o.startedAtMs);
    out.push({
      task,
      runId: str(o.runId),
      workerPid: num(o.workerPid),
      dispatchedAtMs,
      ageMs: dispatchedAtMs === null ? NOT_EVALUATED : nowMs - dispatchedAtMs,
      terminal: false,
      source: ".quay/worker-dispatch.json",
    });
  }
  return out;
}

/** 任务级：`ready_at`（status-events 里第一条 `to:"ready"`）与终态。 */
export function readTaskStatuses(root: string): Map<string, { readyAtMs: number | null; status: string | null }> {
  const out = new Map<string, { readyAtMs: number | null; status: string | null }>();
  const events = readJsonl(path.join(root, ".quay", "task-status-events.jsonl"));
  for (const rec of events.records) {
    const task = str(rec.taskId);
    if (task === null) continue;
    const cur = out.get(task) ?? { readyAtMs: null, status: null };
    if (rec.to === "ready") {
      // ⚠️ 两种方言并存：v1（`schema:"task-status-event/v1"`）用 `at` + `recordedAt`；旧记录用 `ts`。
      // 先读 v1 的 `at`、再退到 `ts`——两者都是这条事件**自己**的时刻，⛔ 不用别的字段推算。
      const ms = iso(rec.at) ?? iso(rec.recordedAt) ?? iso(rec.ts);
      // 只记**最早**一次进入 ready（ready→todo→ready 的重入不重置排队起点）。
      if (ms !== null && (cur.readyAtMs === null || ms < cur.readyAtMs)) cur.readyAtMs = ms;
    }
    const to = str(rec.to);
    if (to !== null) cur.status = to;
    out.set(task, cur);
  }
  // 盘上任务文件的 frontmatter 是 status 的**权威面**（status-events 可能缺早期事件）。
  for (const id of listTaskIds(root)) {
    let status: string | null = null;
    try {
      const text = fs.readFileSync(path.join(root, "tasks", `${id}.md`), "utf8");
      const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (m) status = frontmatterStatus(parseFrontmatterCompletely(m[1]));
    } catch {
      status = null;
    }
    const cur = out.get(id) ?? { readyAtMs: null, status: null };
    out.set(id, { readyAtMs: cur.readyAtMs, status: status ?? cur.status });
  }
  return out;
}

/** 任务的终态判定：`done` / `needs-human` / `superseded` 为终态。读不出 status ⇒ `null`（未评估）。 */
export const TERMINAL_STATUSES = Object.freeze(["done", "needs-human", "superseded"]);
export function isTerminalStatus(status: string | null): boolean | null {
  if (status === null) return null;
  return TERMINAL_STATUSES.includes(status);
}

export interface BuildOptions {
  root: string;
  sinceMs: number;
  untilMs: number;
  nowMs?: number;
}

/** 组装整份报告（纯读；⛔ 不写任何文件）。 */
export function buildDurationReport(opts: BuildOptions): DurationReport {
  const { root, sinceMs, untilMs } = opts;
  const nowMs = opts.nowMs ?? Date.now();

  const outcomeFile = path.join(root, ".quay", "worker-outcome.jsonl");
  const outcome = readJsonl(outcomeFile);
  const inWindow = outcome.records
    .map(toAttemptRecord)
    .filter((r): r is AttemptRecord => r !== null)
    .filter((r) => r.tsMs >= sinceMs && r.tsMs <= untilMs)
    .sort((a, b) => a.tsMs - b.tsMs);

  const attemptMs: number[] = [];
  const implementationMs: number[] = [];
  const faninMs: number[] = [];
  const lockWaitMs: number[] = [];
  const suiteMs: number[] = [];
  const finalStates: Record<string, number> = {};
  let legacyComparable = 0;
  let legacyMismatch = 0;

  for (const r of inWindow) {
    if (r.wallClockMs !== null) attemptMs.push(r.wallClockMs);
    // ⚠️ 尝试级分段**要求新记录**：`worker_exited_at` 只有新写入点才有。旧记录 ⇒ 该段 NOT-EVALUATED
    // （⛔ 不拿 `ended_at` 顶替——那正是本任务要分开的那一对，用它会让「实现段」变成「整段」）。
    const impl = r.workerExitedAtMs === null ? NOT_EVALUATED : deltaMs(r.workerExitedAtMs, r.dispatchedAtMs);
    if (impl !== NOT_EVALUATED) implementationMs.push(impl);
    const fi = deltaMs(r.faninEndedAtMs, r.workerExitedAtMs);
    if (fi !== NOT_EVALUATED) faninMs.push(fi);
    if (r.lockWaitMs !== null) lockWaitMs.push(r.lockWaitMs);
    const suite = deltaMs(r.suiteEndedAtMs, r.suiteStartedAtMs);
    if (suite !== NOT_EVALUATED) suiteMs.push(suite);
    const fs2 = r.finalState ?? "unknown";
    finalStates[fs2] = (finalStates[fs2] ?? 0) + 1;
    if (r.legacyLockJoinMismatch !== null) {
      legacyComparable++;
      if (r.legacyLockJoinMismatch) legacyMismatch++;
    }
  }

  // 在飞尝试：直接量载体。⛔ 不按窗口过滤——右删失的意义正是「此刻还活着」。
  const inFlight = readInFlightAttempts(root, nowMs);
  const inFlightAges = inFlight
    .map((a) => a.ageMs)
    .filter((a): a is number => a !== NOT_EVALUATED);

  // 任务级
  const statuses = readTaskStatuses(root);
  const inFlightTaskSet = new Set(inFlight.map((a) => a.task));
  const firstDispatch = new Map<string, number>();
  const firstDispatchLegacy = new Set<string>();
  const lastAttemptEnd = new Map<string, number>();
  const attemptsByTask = new Map<string, number>();
  for (const r of outcome.records.map(toAttemptRecord)) {
    if (r === null) continue;
    const t = r.task;
    attemptsByTask.set(t, (attemptsByTask.get(t) ?? 0) + 1);
    const d = r.dispatchedAtMs ?? null;
    if (d !== null && (!firstDispatch.has(t) || d < (firstDispatch.get(t) as number))) {
      firstDispatch.set(t, d);
      if (r.dispatchedAtFromLegacyStart) firstDispatchLegacy.add(t);
      else firstDispatchLegacy.delete(t);
    }
    if (r.tsMs && (!lastAttemptEnd.has(t) || r.tsMs > (lastAttemptEnd.get(t) as number))) lastAttemptEnd.set(t, r.tsMs);
  }
  const rows: TaskRow[] = [];
  const queueWaits: number[] = [];
  const spans: number[] = [];
  const inFlightTasks: InFlightTask[] = [];
  // ⚠️ 右删失是**「截至此刻」**的量，故 in-flight 集**不按窗口过滤**（窗口过滤会把「还活着的长任务」
  // 筛掉——那正是右删失要防的系统性低估）。窗口只约束「已完成」那一半。
  let nonTerminalUnknownReadyAt = 0;
  for (const [task, st] of statuses) {
    const first = firstDispatch.get(task) ?? null;
    const readyAt = st.readyAtMs;
    const terminal = isTerminalStatus(st.status);
    const attempts = attemptsByTask.get(task) ?? 0;
    const relevant =
      (first !== null && first >= sinceMs && first <= untilMs) || (readyAt !== null && readyAt >= sinceMs && readyAt <= untilMs);
    if (relevant) {
      const qw = deltaMs(first, readyAt);
      if (qw !== NOT_EVALUATED) queueWaits.push(qw);
      const span = deltaMs(lastAttemptEnd.get(task) ?? null, first);
      if (span !== NOT_EVALUATED) spans.push(span);
      rows.push({ task, readyAtMs: readyAt, firstDispatchedAtMs: first, queueWaitMs: qw, terminal, status: st.status, attempts });
    }
    // 任务级右删失 = 「有过尝试 ∧ 还没终态」（AC 的原文形状）。`terminal === null`（status 读不出）
    // **不进**这一集——未评估 ≠ 在飞（硬规则 3b）；它单独计数报出，⛔ 不静默丢。
    // 「有过尝试」= **有已落盘的 attempt** ∨ **此刻有在飞派发**（后者的 attempt 还没写 outcome——
    // 只数 attemptsByTask 会把正在跑的任务漏掉，而那正是右删失要看见的那一批）。
    const hasAttempt = attempts > 0 || inFlightTaskSet.has(task);
    if (terminal === null) {
      if (hasAttempt) nonTerminalUnknownReadyAt++;
      continue;
    }
    if (terminal === false && hasAttempt) {
      // 年龄基准：ready_at（任务进入池子的时刻，最宽）→ 首次派发 → **此刻在飞那次派发**（最窄但一定
      // 有）。三级都是直接量，逐级收窄；三级全缺 ⇒ NOT-EVALUATED（⛔ 不报 0）。
      const inflightDispatch = inFlight.find((a) => a.task === task)?.dispatchedAtMs ?? null;
      const ageBase = readyAt ?? first ?? inflightDispatch;
      inFlightTasks.push({
        task,
        readyAtMs: readyAt,
        ageMs: ageBase !== null ? nowMs - ageBase : NOT-EVALUATED,
        terminal: false,
        status: st.status,
      });
    }
  }
  inFlightTasks.sort((a, b) => (a.ageMs === NOT_EVALUATED ? 1 : b.ageMs === NOT_EVALUATED ? -1 : Number(b.ageMs) - Number(a.ageMs)));
  const inFlightTaskAges = inFlightTasks.map((t) => t.ageMs).filter((a): a is number => a !== NOT_EVALUATED);

  return {
    window: { sinceMs, sinceIso: new Date(sinceMs).toISOString(), untilMs, untilIso: new Date(untilMs).toISOString() },
    sources: {
      "worker-outcome.jsonl": { path: ".quay/worker-outcome.jsonl", present: outcome.present, records: outcome.present ? outcome.records.length : NOT_EVALUATED },
      "worker-dispatch.json": { path: ".quay/worker-dispatch.json", present: fs.existsSync(path.join(root, ".quay", "worker-dispatch.json")), records: fs.existsSync(path.join(root, ".quay", "worker-dispatch.json")) ? inFlight.length : NOT_EVALUATED },
      "task-status-events.jsonl": {
        path: ".quay/task-status-events.jsonl",
        present: fs.existsSync(path.join(root, ".quay", "task-status-events.jsonl")),
        records: fs.existsSync(path.join(root, ".quay", "task-status-events.jsonl")) ? readJsonl(path.join(root, ".quay", "task-status-events.jsonl")).records.length : NOT_EVALUATED,
      },
    },
    attempts: {
      finished: inWindow.length,
      attemptMs: dist(attemptMs),
      implementationMs: dist(implementationMs),
      faninMs: dist(faninMs),
      lockWaitMs: dist(lockWaitMs),
      suiteMs: dist(suiteMs),
      finalStates,
      legacyLockJoinComparable: legacyComparable === 0 ? NOT_EVALUATED : legacyComparable,
      legacyLockJoinMismatches: legacyComparable === 0 ? NOT_EVALUATED : legacyMismatch,
    },
    inFlightAttempts: { count: inFlight.length, rows: inFlight, agesMs: dist(inFlightAges) },
    tasks: {
      finished: rows.length - inFlightTasks.length,
      queueWaitMs: dist(queueWaits),
      spanMs: dist(spans),
      nonTerminalUnknownReadyAt,
      firstDispatchFromLegacyStart: firstDispatchLegacy.size,
      rows,
    },
    inFlightTasks: { count: inFlightTasks.length, rows: inFlightTasks, agesMs: dist(inFlightTaskAges) },
  };
}

// ── 渲染 ────────────────────────────────────────────────────────────────────────────────
function fmtMs(v: MaybeNum): string {
  if (v === NOT_EVALUATED) return NOT_EVALUATED;
  const s = v / 1000;
  return `${s.toFixed(s >= 100 ? 0 : 1)}s`;
}
function fmtDist(d: Dist): string {
  if (d.n === 0) return `n=0  ${NOT_EVALUATED}`;
  return `n=${d.n}  min=${fmtMs(d.min)}  median=${fmtMs(d.median)}  p90=${fmtMs(d.p90)}  max=${fmtMs(d.max)}  mean=${fmtMs(d.mean)}`;
}

export function renderReport(r: DurationReport): string {
  const L: string[] = [];
  L.push(`window: ${r.window.sinceIso} .. ${r.window.untilIso}`);
  L.push("");
  L.push("sources:");
  for (const [k, v] of Object.entries(r.sources)) {
    L.push(`  ${k}: ${v.present ? `present (${v.records} records)` : "ABSENT → 该段 NOT-EVALUATED"}`);
  }
  L.push("");
  L.push(`attempts (finished in window: ${r.attempts.finished})`);
  L.push(`  attempt        ${fmtDist(r.attempts.attemptMs)}`);
  L.push(`  implementation ${fmtDist(r.attempts.implementationMs)}   (dispatched_at → worker_exited_at)`);
  L.push(`  fan-in         ${fmtDist(r.attempts.faninMs)}   (worker_exited_at → fanin_ended_at)`);
  L.push(`  lock wait      ${fmtDist(r.attempts.lockWaitMs)}   (lock_requested_at → lock_acquired_at; 新窗口口径)`);
  L.push(`  suite          ${fmtDist(r.attempts.suiteMs)}   (suite_started_at → suite_ended_at)`);
  L.push(`  final_state    ${Object.entries(r.attempts.finalStates).map(([k, v]) => `${k}=${v}`).join(" ") || NOT_EVALUATED}`);
  L.push(
    `  legacy lock join: comparable=${r.attempts.legacyLockJoinComparable} mismatched=${r.attempts.legacyLockJoinMismatches}` +
      `   (旧 (task,runId) 口径与尝试窗口口径不一致的条数——负控制)`,
  );
  L.push("");
  L.push(`right-censored · in-flight attempts: ${r.inFlightAttempts.count}   ages ${fmtDist(r.inFlightAttempts.agesMs)}`);
  for (const a of r.inFlightAttempts.rows.slice(0, 20)) {
    L.push(`  terminal=false  ${a.task}  run=${a.runId ?? "?"}  pid=${a.workerPid ?? "?"}  age=${fmtMs(a.ageMs)}  (${a.source})`);
  }
  if (r.inFlightAttempts.count > 20) L.push(`  … 另 ${r.inFlightAttempts.count - 20} 条`);
  L.push("");
  L.push(`tasks (in window: ${r.tasks.finished} finished; right-censored set: ${r.inFlightTasks.count})`);
  L.push(`  queue wait     ${fmtDist(r.tasks.queueWaitMs)}   (ready_at → first dispatch)`);
  L.push(`  task span      ${fmtDist(r.tasks.spanMs)}   (first dispatch → last attempt end)`);
  if (r.tasks.firstDispatchFromLegacyStart > 0) {
    L.push(`  ⚠️ ${r.tasks.firstDispatchFromLegacyStart} 个任务的首次派发取自回退字段 started_at（旧记录无 dispatched_at，二者同源同一读数）`);
  }
  if (r.tasks.nonTerminalUnknownReadyAt > 0) {
    L.push(
      `  ⚠️ ${r.tasks.nonTerminalUnknownReadyAt} 个有尝试的任务 status 读不出 ⇒ 未评估（⛔ 不计入下面的 in-flight，也不计为 finished）` +
        ` —— 右删失集在这条边界上不完整，读者据此判读`,
    );
  }
  L.push("");
  L.push(`right-censored · in-flight tasks (has attempt, no terminal event): ${r.inFlightTasks.count}   ages ${fmtDist(r.inFlightTasks.agesMs)}`);
  for (const t of r.inFlightTasks.rows.slice(0, 20)) {
    L.push(`  terminal=false  ${t.task}  status=${t.status ?? "?"}  age=${fmtMs(t.ageMs)}`);
  }
  if (r.inFlightTasks.count > 20) L.push(`  … 另 ${r.inFlightTasks.count - 20} 条`);
  return L.join("\n");
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────
const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function parseWindow(argv: string[], nowMs: number): { sinceMs: number; untilMs: number } | null {
  let sinceMs = nowMs - DEFAULT_WINDOW_MS;
  let untilMs = nowMs;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--since") {
      const raw = argv[++i];
      const ms = raw !== undefined ? Date.parse(raw) : NaN;
      if (!Number.isFinite(ms)) return null;
      sinceMs = ms;
    } else if (argv[i] === "--until") {
      const raw = argv[++i];
      const ms = raw !== undefined ? Date.parse(raw) : NaN;
      if (!Number.isFinite(ms)) return null;
      untilMs = ms;
    }
  }
  if (sinceMs > untilMs) return null;
  return { sinceMs, untilMs };
}

function flagValue(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

function main(argv: string[]): number {
  const root = flagValue(argv, "--root") ?? process.cwd();
  const win = parseWindow(argv, Date.now());
  if (win === null) {
    process.stderr.write(
      "duration-report: bad usage — --since/--until must be Date.parse-able and since <= until\n" +
        "usage: duration-report.ts [--root <dir>] [--since <ISO>] [--until <ISO>] [--json]\n",
    );
    return 1;
  }
  const report = buildDurationReport({ root, sinceMs: win.sinceMs, untilMs: win.untilMs });
  if (argv.includes("--json")) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${renderReport(report)}\n`);
  return 0;
}

// 直接执行才跑 CLI（被 import 时是纯库）。用 gate-script-base 的 isDirectEntry —— 它按**文件名**
// 认身份，故在源码布局与打包布局下都成立，且对被 inline 进别的 bundle 的本模块恒为 false。
//
// ⛔ 这里原来是一段「本地实现」的 URL 相等判定（`realpathSync(argv[1]) === realpathSync(import.meta.url)`），
// 注释却写着「与 isDirectEntry 同形」—— 它**不同形**：打包后整个 inline 模块集共用 bundle 的
// `import.meta.url`，于是本模块的 `process.exit(main(...))` 会在**别的**入口里先跑（实测 2026-10-17：
// `worker-driver.ts` 经 AC-363 的 `relaxed-dispatch-ledger.ts` → 本模块新引入了一条 import 边，
// `dist/worker-driver.js --help` 打印的不再是 worker-driver 的 banner 而是本报告并 exit 0）。
// 正是 gate-script-base `isDirectEntry` 上方那段注释记载的 `gap-drivers-yml-interval-not-honored-for-routine-kinds`
// 事故形态（`dist/{goal,quality-gate,meta}-driver.js` 全跑 pool-quality-judge 的 main）——本模块是当时
// 未随迁移扫到的**残留实例**，只因此前无人 import 它故从未显形。
if (isDirectEntry(import.meta, undefined, "duration-report")) process.exit(main(process.argv.slice(2)));
