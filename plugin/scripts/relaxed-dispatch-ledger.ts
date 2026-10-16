#!/usr/bin/env node
/**
 * relaxed-dispatch-ledger.ts — 放宽派发的**账本写入器**与**成本连接报告**（GOAL-037 / AC-363）。
 *
 * ── 它回答什么问题 ──────────────────────────────────────────────────────────────────────
 * 「一个被 touches 谓词单独挡住的派发，被**放宽**之后多花了多少成本？」
 * 拆成两个必须分开的机件（本模块就这两件，⛔ 不含策略）：
 *   · **账本**（`.quay/relaxed-dispatch.jsonl`）：每次放宽**追加一行**——task / blockers /
 *     overlapFiles / waitedMinutes / dispatchedAt。放宽一旦生效，谁被放宽、放过的对手是谁、
 *     等了多久，从这一行起有据可查。
 *   · **报告**（`buildRelaxedDispatchReport`）：把每条账本记录与该任务在 `.quay/worker-outcome.jsonl`
 *     里的**全部**运行**按任务 id**连接，给出 attempts / workerMinutes / fanInFailureSteps，
 *     并与**同期未放宽**的任务同口径对照，给出 `extraWorkerMinutes`。
 *
 * ── 为什么这是缺口而不是「以后再加」（硬规则 4 推论三）────────────────────────────────────
 * GOAL-037 的生效（AC-365/366）与自动收紧（AC-367）都要读「放宽比不放宽多花多少」才能设名额、才能收紧。
 * 而放宽之后产生的合并冲突会出现在 **worker 运行段**里——这一段此前**没有任何账本**。所以次序是：
 * 先把量做成一条能穿过所有中间层、在验收那一刻仍取得到的记录，才谈得上给它设阈值/名额。
 *
 * ── 硬规则（本模块按它们实现，不是注释里的口号）──────────────────────────────────────────
 * · **3b / 6（缺值 ≠ 合格）**：五键任一不合法 ⇒ `appendRelaxedDispatch` **拒写且一个字节都不写**，
 *   `reason` 指名具体字段。⛔ **绝不把读不到的 `waitedMinutes` 写成 0** —— 缺值与「等了 0 分钟」
 *   形状必须不同。报告侧同理：任一侧可测任务数 < `MIN_COMPARABLE_TASKS` ⇒ `evaluated:false` 且
 *   `extraWorkerMinutes` / 对照组中位数取 `NOT_EVALUATED`（**不是 0、不是空均值**）。
 * · **2（按位置判定）**：连接键是**任务 id 的取值**，⛔ 不是数组下标 / 行号。两侧的记录顺序在本模块
 *   任何地方都不参与连接（测试用「按位置投影必须不同」把这一条钉成可判定的）。
 * · **1（单一来源）**：worker-outcome 的载体路径**复用** `driver-filters.ts` 导出的
 *   `WORKER_OUTCOME_REL`；统计口径**复用** `duration-report.ts` 的 `toAttemptRecord` / `percentile`
 *   / `NOT_EVALUATED`。⛔ 本模块不写第二个字面量、不手搓第二个 median。
 * · **4c（判据要穿过中间层）**：本模块的读数全部**从载体文件回读**（append 后由 `readRelaxedDispatchLedger`
 *   解析、报告由 `readJsonl` 解析），⛔ 不把内存对象当成「已落盘」。
 *
 * ── 两条口径的**结构性质**，不是约定 ────────────────────────────────────────────────────
 * · **worker 运行段 = `worker_exited_at − dispatched_at`**，⛔ **不是** `wall_clock_ms`——后者含 fan-in
 *   （merge / suite 的时间），用它会把「合并成本」混进「worker 多花了多少」。
 * · 放宽组与对照组**用同一个归一化函数**（`toAttemptRecord`）与**同一个换算函数**（`msToMinutes`）
 *   ⇒ 「口径相同」是代码结构决定的，⛔ 不靠两处各写一遍再声称一致。
 *
 * ── 词表隔离（⛔ 不得互串）──────────────────────────────────────────────────────────────
 * `fanInFailureSteps` 的取值逐字来自 `mechanical_fan_in.step`（如 `merge-develop` / `suite` / `ff`）；
 * 它**不是** `final_state` 的词表（`worker-driver.ts` 的 `FINAL_STATES`：`completed` /
 * `exited-not-landed` / …）——`worker-driver.ts` 记录过 `landed` 被写进 `final_state` 的实测事故
 * （吞吐读数变 0 且与「系统停摆」同形）。故本模块把两者放在**两个字段**里分别投影，且**没有
 * `mechanical_fan_in` 的失败运行不产出 step 值**（⛔ 不写 `"unknown"`、⛔ 不折成 0），单独计入
 * `failuresWithoutStep`。
 *
 * ── ⛔ 本模块不越界 ─────────────────────────────────────────────────────────────────────
 * 不碰 `plugin/scripts/driver-filters.ts` / `plugin/scripts/worker-driver.ts`；不新增放宽谓词、
 * 不读配置、不碰 `.quay/config.yml`。放宽决策点与接线归 AC-364/365/366/367。
 *
 * Usage:
 *   node --experimental-strip-types plugin/scripts/relaxed-dispatch-ledger.ts --report [--root <dir>] [--json]
 * 退出码：0 = `evaluated:true` · 2 = 用法错误 · 3 = NOT-EVALUATED（任一侧样本不足，
 * 与 `plugin/scripts/rework-predictors.ts` 的退出码约定一致）。
 */
import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";
import { NOT_EVALUATED, percentile, readJsonl, toAttemptRecord, type MaybeNum } from "./duration-report.ts";
// 单一来源：worker-outcome 载体路径复用 driver-filters 的导出（硬规则 1：⛔ 本模块不复写这个字面量）。
import { WORKER_OUTCOME_REL } from "./driver-filters.ts";

/** 放宽账本的仓内相对路径。**路径的单一来源**：调用方一律 import 它，⛔ 不各写一份字面量。 */
export const RELAXED_DISPATCH_REL = ".quay/relaxed-dispatch.jsonl";

/** 可测任务数的**下限常量**（具名导出，读者据此判读，⛔ 测试不得复写这个数字）。
 *
 *  取 1 的理由（硬规则 4：成本结构未知前不要设数值阈值）：本报告此刻的任务是**把量做出来**，
 *  不是宣称统计强度。1 是最小的、能把「有可测样本」与「一条都测不出」分开的取值；任何大于 1 的
 *  取值都会凭空断言一个此刻并未测量的统计充分性。两侧的**实际计数**（`measurableTasks`）与
 *  逐任务明细一并报出，样本够不够由读者判读——报告不替读者下这个结论。 */
export const MIN_COMPARABLE_TASKS = 1;

/** 一次放宽的账本记录——**恰好五个键**，逐一对应 AC-363 点名的量。
 *  ⛔ 不再加第二个时间字段：`dispatchedAt` 是这一件事的**唯一时刻**，再加一个 `ts` 就是这个仓库
 *  明令禁止的同义字段漂移（两个同义字段各算一次 ⇒ 必然漂移）。 */
export interface RelaxedDispatchRecord {
  /** 被放宽的任务 id（非空）。 */
  task: string;
  /** 这次放宽放过的 touches 重叠对手 id（**非空**数组——放宽若无对手，就不是放宽）。 */
  blockers: string[];
  /** 重叠文件路径（`checkTouchesPair().overlaps` 的交集，沿用其排序）。 */
  overlapFiles: string[];
  /** 等了多久才放宽（有限非负数，分钟）。 */
  waitedMinutes: number;
  /** 放宽发生的时刻（可 `Date.parse` 的 ISO 字符串）。 */
  dispatchedAt: string;
}

export type ValidationResult =
  | { ok: true; record: RelaxedDispatchRecord }
  | { ok: false; reason: string };

/** 值的可读描述——`reason` 要指名**具体字段与具体取值形状**，否则「拒写」与「读不懂」同形。 */
function describeValue(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "number") return String(v); // 含 NaN / Infinity：`waitedMinutes` 的非法形态要能逐字看见
  if (typeof v === "string") return `string ${JSON.stringify(v)}`;
  if (Array.isArray(v)) return `array(${v.length})`;
  return typeof v;
}

/** 非空字符串取值；否则 null（⛔ 不把空白串当成有值）。 */
function asNonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** **fail-closed** 校验（同族先例 `dispatch-record.ts` 的理由不足即拒写）：五键任一不合法 ⇒
 *  拒绝，且 `reason` 指名该字段。⛔ 不做任何「缺了就补个默认」的兜底——那正是把「未查」伪装成
 *  「查了且正常」（硬规则 3b/6）。 */
export function validateRelaxedDispatchRecord(raw: unknown): ValidationResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: `record: expected a JSON object (got ${describeValue(raw)})` };
  }
  const o = raw as Record<string, unknown>;

  const task = asNonEmptyString(o.task);
  if (task === null) return { ok: false, reason: `task: expected a non-empty task id (got ${describeValue(o.task)})` };

  if (!Array.isArray(o.blockers) || o.blockers.length === 0) {
    return { ok: false, reason: `blockers: expected a non-empty array of task ids (got ${describeValue(o.blockers)})` };
  }
  for (const b of o.blockers) {
    if (asNonEmptyString(b) === null) return { ok: false, reason: `blockers: every entry must be a non-empty task id (got ${describeValue(b)})` };
  }

  if (!Array.isArray(o.overlapFiles)) {
    return { ok: false, reason: `overlapFiles: expected an array of file paths (got ${describeValue(o.overlapFiles)})` };
  }
  for (const f of o.overlapFiles) {
    if (asNonEmptyString(f) === null) return { ok: false, reason: `overlapFiles: every entry must be a non-empty path (got ${describeValue(f)})` };
  }

  const waited = o.waitedMinutes;
  if (typeof waited !== "number" || !Number.isFinite(waited) || waited < 0) {
    return { ok: false, reason: `waitedMinutes: expected a finite number >= 0 (got ${describeValue(waited)})` };
  }

  const dispatchedAt = o.dispatchedAt;
  if (typeof dispatchedAt !== "string" || !Number.isFinite(Date.parse(dispatchedAt))) {
    return { ok: false, reason: `dispatchedAt: expected a Date.parse-able timestamp (got ${describeValue(dispatchedAt)})` };
  }

  return {
    ok: true,
    record: {
      task,
      blockers: o.blockers.map((b) => b as string),
      overlapFiles: o.overlapFiles.map((f) => f as string),
      waitedMinutes: waited,
      dispatchedAt,
    },
  };
}

export interface AppendResult {
  ok: boolean;
  reason: string | null;
  file: string;
  /** 真的写进去了才非 null（⛔ 被拒时不得返回一个「看起来写成了」的记录）。 */
  record: RelaxedDispatchRecord | null;
}

/** **追加写**一行账本（一次一行 JSON + `\n`）。⛔ 不读改写、不重排、不截断。
 *
 *  **末尾换行是载体完整性的一部分**：若文件末尾无换行（外部写入者 / 被截断的中间态），先补一个
 *  换行再写——否则新记录与旧行粘成一行，**整份载体从那一行起不可解析**（一个记录换一份载体）。
 *  这一条的产物是 AC2 的「粘行后 `malformed` 不增加」。 */
export function appendRelaxedDispatch(root: string, raw: unknown): AppendResult {
  const file = path.join(root, RELAXED_DISPATCH_REL);
  const v = validateRelaxedDispatchRecord(raw);
  // FAIL-CLOSED：一个字节都不写（调用方据 `reason` 指名字段，而不是拿到一条半真半假的记录）。
  if (!v.ok) return { ok: false, reason: v.reason, file, record: null };

  fs.mkdirSync(path.dirname(file), { recursive: true });
  let needsNewline = false;
  try {
    const size = fs.statSync(file).size;
    if (size > 0) {
      const fd = fs.openSync(file, "r");
      try {
        const last = Buffer.alloc(1);
        fs.readSync(fd, last, 0, 1, size - 1);
        needsNewline = last[0] !== 0x0a;
      } finally {
        fs.closeSync(fd);
      }
    }
  } catch {
    /* 文件不存在 ⇒ 不需要补换行（不是「读不懂」——新建文件这件事没有前一行可言） */
    needsNewline = false;
  }
  fs.appendFileSync(file, (needsNewline ? "\n" : "") + JSON.stringify(v.record) + "\n", "utf8");
  return { ok: true, reason: null, file, record: v.record };
}

export interface LedgerRead {
  /** 载体**在不在**——与 `records:[]` 不同形（硬规则 3b：文件没有 ≠ 文件在但一条都读不出）。 */
  present: boolean;
  records: RelaxedDispatchRecord[];
  /** 解析不出 / 校验不过的行（行号 + 原因）。⛔ 坏行不报废整份载体，但也**不假装读到了它**。 */
  malformed: { line: number; reason: string }[];
}

/** 从**载体文件**回读账本（⛔ 不读内存对象——「落盘了没」只有文件说得清，硬规则 4c）。 */
export function readRelaxedDispatchLedger(root: string): LedgerRead {
  const file = path.join(root, RELAXED_DISPATCH_REL);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { present: false, records: [], malformed: [] };
  }
  const records: RelaxedDispatchRecord[] = [];
  const malformed: { line: number; reason: string }[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue; // 空行（含**末尾换行**留下的那一格）不是坏行
    let parsed: unknown;
    try {
      parsed = JSON.parse(t);
    } catch (e) {
      malformed.push({ line: i + 1, reason: `not JSON: ${(e as Error).message}` });
      continue;
    }
    const v = validateRelaxedDispatchRecord(parsed);
    if (!v.ok) malformed.push({ line: i + 1, reason: v.reason });
    else records.push(v.record);
  }
  return { present: true, records, malformed };
}

// ── 连接与读数 ──────────────────────────────────────────────────────────────────────────────

/** 一个任务在 `worker-outcome` 里的运行读数（**两端用同一个归一化函数**，见模块头）。 */
export interface RunStats {
  /** 能归一成一条运行记录的 outcome 行数。 */
  attempts: number;
  /** 归一失败的 outcome 行数（读不出 task/ts）——如实计数，⛔ 不静默丢。 */
  runsUnparseable: number;
  completedRuns: number;
  /** `final_state` 读得出且不是 `completed` 的运行数。 */
  failedRuns: number;
  /** `final_state` **读不出**的运行数（未评估 ≠ 失败，硬规则 3b）。 */
  unknownFinalStateRuns: number;
  /** 各运行段（`worker_exited_at − dispatched_at`）求和，分钟；**任一段不可测 ⇒ `NOT_EVALUATED`**
   *  （⛔ 不用部分和冒充「这个任务花了多少」——部分和与全和同形）。 */
  workerMinutes: MaybeNum;
  /** 运行段不可测的运行数（缺 `worker_exited_at` 或 `dispatched_at`）。 */
  runsWithoutSegment: number;
  /** 该任务**失败运行**的 `mechanical_fan_in.step` **逐字取值**，按出现序去重。
   *  ⛔ 这是**另一个词表**（`merge-develop` / `suite` / `ff` …），与 `final_state` 不同源、不同字段。 */
  fanInFailureSteps: string[];
  /** 失败但**产不出** step 值的运行数（无 `mechanical_fan_in`，或它没有 step）。
   *  ⛔ 不写 `"unknown"`、⛔ 不折成 0——「没有 step」本身就是读数。 */
  failuresWithoutStep: number;
  finalStates: Record<string, number>;
}

function collectRunStats(rawRecords: Record<string, unknown>[]): RunStats {
  let attempts = 0;
  let runsUnparseable = 0;
  let completedRuns = 0;
  let failedRuns = 0;
  let unknownFinalStateRuns = 0;
  let runsWithoutSegment = 0;
  let segmentMsTotal = 0;
  const fanInFailureSteps: string[] = [];
  let failuresWithoutStep = 0;
  const finalStates: Record<string, number> = {};

  for (const raw of rawRecords) {
    const rec = toAttemptRecord(raw);
    if (rec === null) {
      runsUnparseable++;
      continue;
    }
    attempts++;
    if (rec.finalState !== null) finalStates[rec.finalState] = (finalStates[rec.finalState] ?? 0) + 1;

    // worker 运行段：两键都在才算（⛔ 不用 wall_clock_ms——它含 fan-in）。
    if (rec.workerExitedAtMs === null || rec.dispatchedAtMs === null) runsWithoutSegment++;
    else segmentMsTotal += rec.workerExitedAtMs - rec.dispatchedAtMs;

    if (rec.finalState === null) {
      unknownFinalStateRuns++; // 读不出 ⇒ 既不是完成也不是失败（硬规则 3b）
      continue;
    }
    if (rec.finalState === "completed") {
      completedRuns++;
      continue;
    }
    failedRuns++;
    const mfi = raw.mechanical_fan_in;
    const step =
      mfi !== null && typeof mfi === "object" && !Array.isArray(mfi)
        ? asNonEmptyString((mfi as Record<string, unknown>).step)
        : null;
    if (step === null) failuresWithoutStep++;
    else if (!fanInFailureSteps.includes(step)) fanInFailureSteps.push(step);
  }

  return {
    attempts,
    runsUnparseable,
    completedRuns,
    failedRuns,
    unknownFinalStateRuns,
    workerMinutes: attempts > 0 && runsWithoutSegment === 0 ? msToMinutes(segmentMsTotal) : NOT_EVALUATED,
    runsWithoutSegment,
    fanInFailureSteps,
    failuresWithoutStep,
    finalStates,
  };
}

/** 毫秒 → 分钟的**唯一**换算点（两组共用它 ⇒ 「口径相同」是结构性质，不是约定）。 */
function msToMinutes(ms: number): number {
  return ms / 60_000;
}

/** 一条放宽任务的报告行：账本五键 + 它在 outcome 里的运行读数 + 与对照组的差。 */
export interface RelaxedRow extends RunStats {
  task: string;
  blockers: string[];
  overlapFiles: string[];
  waitedMinutes: number;
  dispatchedAt: string;
  /** 本任务分钟 − 对照组中位数（⛔ 任一侧不可测 ⇒ `NOT_EVALUATED`，不是 0）。 */
  extraWorkerMinutes: MaybeNum;
}

export interface ControlRow extends RunStats {
  task: string;
}

export interface RelaxedDispatchReport {
  evaluated: boolean;
  reason: string | null;
  minComparableTasks: number;
  /** 本次读取的时刻（报告自身的直接量）——读者据此判「这份读数有多旧」。 */
  readAtMs: number;
  ledger: { present: boolean; records: number; malformed: { line: number; reason: string }[] };
  window:
    | { sinceMs: number; sinceIso: string; untilMs: number; untilIso: string }
    | null;
  sources: Record<string, { path: string; present: boolean; records: MaybeNum }>;
  relaxed: { tasks: number; measurableTasks: number; workerMinutesMedian: MaybeNum; rows: RelaxedRow[] };
  control: { tasks: number; measurableTasks: number; workerMinutesMedian: MaybeNum; rows: ControlRow[] };
  /** 放宽组分钟中位数 − 对照组分钟中位数。任一侧可测任务数 < `MIN_COMPARABLE_TASKS` ⇒ `NOT_EVALUATED`。 */
  extraWorkerMinutes: MaybeNum;
  /** 对照组中位数取自哪一组任务的清单（⛔ 不靠读者自己从 rows 里数）。 */
  controlTaskIds: string[];
}

/** 组装报告（纯读；⛔ 不写任何文件）。
 *
 *  **连接键 = 任务 id**：每条账本记录 ⇒ 该 `task` 在 `worker-outcome` 里的**全部**运行。
 *  ⛔ 数组下标 / 行号在任何地方都不参与连接。
 *
 *  **时间窗** = 账本记录 `dispatchedAt` 的最早 → 最晚。**对照组** = 窗口内出现过运行、
 *  且**未出现在账本**、且 ≥1 条 `final_state === "completed"` 的任务；两组用**同一个**
 *  `toAttemptRecord` 归一化、**同一个** `msToMinutes` 换算。 */
export function buildRelaxedDispatchReport(root: string, opts: { nowMs?: number } = {}): RelaxedDispatchReport {
  const ledger = readRelaxedDispatchLedger(root);
  const outcomePath = path.join(root, WORKER_OUTCOME_REL);
  const outcome = readJsonl(outcomePath);

  // 按任务 id 归组（**取值**归组，⛔ 不是按行号）。
  const byTask = new Map<string, Record<string, unknown>[]>();
  for (const raw of outcome.records) {
    const t = asNonEmptyString(raw.task);
    if (t === null) continue;
    const bucket = byTask.get(t);
    if (bucket) bucket.push(raw);
    else byTask.set(t, [raw]);
  }

  const dispatchTimes = ledger.records.map((r) => Date.parse(r.dispatchedAt));
  const window =
    dispatchTimes.length === 0
      ? null
      : {
          sinceMs: Math.min(...dispatchTimes),
          untilMs: Math.max(...dispatchTimes),
        };

  const relaxedTaskIds = new Set(ledger.records.map((r) => r.task));

  const controlRows: ControlRow[] = [];
  if (window !== null) {
    for (const [task, raws] of byTask) {
      if (relaxedTaskIds.has(task)) continue;
      const stats = collectRunStats(raws);
      if (stats.completedRuns === 0) continue;
      const activeInWindow = raws.some((raw) => {
        const rec = toAttemptRecord(raw);
        return rec !== null && rec.tsMs >= window.sinceMs && rec.tsMs <= window.untilMs;
      });
      if (!activeInWindow) continue;
      controlRows.push({ task, ...stats });
    }
  }
  controlRows.sort((a, b) => (a.task < b.task ? -1 : a.task > b.task ? 1 : 0));

  const relaxedRowsBase = ledger.records.map((rec) => ({ rec, stats: collectRunStats(byTask.get(rec.task) ?? []) }));

  const measurable = (v: MaybeNum): v is number => v !== NOT_EVALUATED;
  const relaxedMinutes = relaxedRowsBase.map((r) => r.stats.workerMinutes).filter(measurable).sort((a, b) => a - b);
  const controlMinutes = controlRows.map((r) => r.workerMinutes).filter(measurable).sort((a, b) => a - b);
  const relaxedMedian = percentile(relaxedMinutes, 0.5);
  const controlMedian = percentile(controlMinutes, 0.5);

  // 三态，⛔ 不伪装（硬规则 3b）：任一侧可测任务数不足 ⇒ evaluated:false，
  // 且两个数值字段取 NOT_EVALUATED —— 绝不是 0、不是空均值。
  const deficiencies: string[] = [];
  if (relaxedMinutes.length < MIN_COMPARABLE_TASKS) {
    deficiencies.push(`relaxed side: ${relaxedMinutes.length} measurable task(s) < MIN_COMPARABLE_TASKS=${MIN_COMPARABLE_TASKS}`);
  }
  if (controlMinutes.length < MIN_COMPARABLE_TASKS) {
    deficiencies.push(`control side: ${controlMinutes.length} measurable task(s) < MIN_COMPARABLE_TASKS=${MIN_COMPARABLE_TASKS}`);
  }
  const evaluated = deficiencies.length === 0;
  const reason = evaluated
    ? null
    : `${deficiencies.join("; ")} — both counts: relaxed=${relaxedMinutes.length}, control=${controlMinutes.length}` +
      ` (ledger records=${ledger.records.length}, ledger present=${ledger.present}, window=${window === null ? "none" : "set"})`;

  const extraWorkerMinutes: MaybeNum =
    evaluated && measurable(relaxedMedian) && measurable(controlMedian) ? relaxedMedian - controlMedian : NOT_EVALUATED;

  const relaxedRows: RelaxedRow[] = relaxedRowsBase.map(({ rec, stats }) => ({
    task: rec.task,
    blockers: rec.blockers,
    overlapFiles: rec.overlapFiles,
    waitedMinutes: rec.waitedMinutes,
    dispatchedAt: rec.dispatchedAt,
    ...stats,
    extraWorkerMinutes:
      evaluated && measurable(stats.workerMinutes) && measurable(controlMedian) ? stats.workerMinutes - controlMedian : NOT_EVALUATED,
  }));

  return {
    evaluated,
    reason,
    minComparableTasks: MIN_COMPARABLE_TASKS,
    readAtMs: opts.nowMs ?? Date.now(),
    ledger: { present: ledger.present, records: ledger.records.length, malformed: ledger.malformed },
    window:
      window === null
        ? null
        : {
            sinceMs: window.sinceMs,
            sinceIso: new Date(window.sinceMs).toISOString(),
            untilMs: window.untilMs,
            untilIso: new Date(window.untilMs).toISOString(),
          },
    sources: {
      "relaxed-dispatch.jsonl": {
        path: RELAXED_DISPATCH_REL,
        present: ledger.present,
        records: ledger.present ? ledger.records.length : NOT_EVALUATED,
      },
      "worker-outcome.jsonl": {
        path: WORKER_OUTCOME_REL,
        present: outcome.present,
        records: outcome.present ? outcome.records.length : NOT_EVALUATED,
      },
    },
    relaxed: {
      tasks: relaxedRows.length,
      measurableTasks: relaxedMinutes.length,
      workerMinutesMedian: relaxedMedian,
      rows: relaxedRows,
    },
    control: {
      tasks: controlRows.length,
      measurableTasks: controlMinutes.length,
      workerMinutesMedian: controlMedian,
      rows: controlRows,
    },
    extraWorkerMinutes,
    controlTaskIds: controlRows.map((r) => r.task),
  };
}

// ── 渲染 ────────────────────────────────────────────────────────────────────────────────
function fmtNum(v: MaybeNum, digits = 1): string {
  return v === NOT_EVALUATED ? NOT_EVALUATED : v.toFixed(digits);
}

export function renderLedgerReport(r: RelaxedDispatchReport): string {
  const L: string[] = [];
  L.push(`evaluated: ${r.evaluated}${r.reason ? `  — ${r.reason}` : ""}`);
  L.push(
    `window: ${r.window === null ? "NONE (账本无记录)" : `${r.window.sinceIso} .. ${r.window.untilIso}`}` +
      `   minComparableTasks=${r.minComparableTasks}`,
  );
  L.push("");
  L.push("sources:");
  for (const [k, v] of Object.entries(r.sources)) {
    L.push(`  ${k}: ${v.present ? `present (${v.records} records)` : "ABSENT → 该侧 NOT-EVALUATED"}`);
  }
  if (r.ledger.malformed.length > 0) L.push(`  ⚠️ ledger malformed lines: ${r.ledger.malformed.length}`);
  L.push("");
  L.push(`relaxed (records: ${r.relaxed.tasks} · measurable: ${r.relaxed.measurableTasks} · median worker-min: ${fmtNum(r.relaxed.workerMinutesMedian)})`);
  for (const row of r.relaxed.rows) {
    L.push(
      `  ${row.task}  waited=${row.waitedMinutes}min  blockers=[${row.blockers.join(",")}]  attempts=${row.attempts}` +
        `  workerMin=${fmtNum(row.workerMinutes)}  extra=${fmtNum(row.extraWorkerMinutes)}` +
        `  fanInFailureSteps=[${row.fanInFailureSteps.join(",")}]  withoutStep=${row.failuresWithoutStep}`,
    );
  }
  L.push("");
  L.push(`control (tasks: ${r.control.tasks} · measurable: ${r.control.measurableTasks} · median worker-min: ${fmtNum(r.control.workerMinutesMedian)})`);
  for (const row of r.control.rows) {
    L.push(`  ${row.task}  attempts=${row.attempts}  workerMin=${fmtNum(row.workerMinutes)}  finalStates=${JSON.stringify(row.finalStates)}`);
  }
  L.push("");
  L.push(`extraWorkerMinutes = relaxed median − control median = ${fmtNum(r.extraWorkerMinutes)}`);
  return L.join("\n");
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────
const USAGE = `relaxed-dispatch-ledger.ts — 放宽派发账本与成本连接报告（GOAL-037 / AC-363）
用法: node --experimental-strip-types plugin/scripts/relaxed-dispatch-ledger.ts --report [--root <dir>] [--json]
  --report        读出账本并打印连接报告（本模块的唯一 CLI 动词）
  --root <dir>    数据根（\`tasks/\` 与 \`.quay/\` 所在；默认 = 当前工作目录）
  --json          以 JSON 打印（默认人读文本）
退出码: 0 = evaluated:true · 2 = 用法错误 · 3 = NOT-EVALUATED（任一侧样本不足）`;

interface CliArgs {
  ok: boolean;
  reason: string | null;
  root: string;
  json: boolean;
  report: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const out: CliArgs = { ok: true, reason: null, root: process.cwd(), json: false, report: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--report") out.report = true;
    else if (a === "--json") out.json = true;
    else if (a === "--root") {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) {
        out.ok = false;
        out.reason = "--root requires a directory argument";
        return out;
      }
      out.root = v;
    } else {
      out.ok = false;
      out.reason = `unknown argument: ${a}`;
      return out;
    }
  }
  if (!out.report) {
    out.ok = false;
    out.reason = "missing --report (this module's only CLI verb)";
  }
  return out;
}

export function main(argv: string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const args = parseCliArgs(argv);
  if (!args.ok) {
    process.stderr.write(`relaxed-dispatch-ledger: bad usage — ${args.reason}\n${USAGE}\n`);
    return 2;
  }
  const root = path.resolve(args.root);
  const report = buildRelaxedDispatchReport(root, { nowMs: Date.now() });
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${renderLedgerReport(report)}\n`);
  // 3 = NOT-EVALUATED：任一侧样本不足**不是**「零额外成本」的读数（与 rework-predictors 同约定）。
  return report.evaluated ? 0 : 3;
}

// 直接执行才跑 CLI（被 import 时是纯库——与 dispatch-record.ts 的 isDirectEntry 同形）。
if (isDirectEntry(import.meta, undefined, "relaxed-dispatch-ledger")) {
  process.exitCode = main(process.argv.slice(2));
}
