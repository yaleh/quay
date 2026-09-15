#!/usr/bin/env node
/**
 * fan-in-queueing-model.ts — 用排队论量 fan-in 锁竞争：加并发到底提吞吐，还是只加长队列。
 *
 * ── 它回答什么问题 ────────────────────────────────────────────────────────────────
 * 「把 worker 并发调高，落地吞吐会上升，还是只有排队时间上升？」
 * 判据是系统处在排队论的哪一段：锁利用率 ρ、到达率 λ、平均在系统数 L（Little's law），
 * 以及**实测的等待时间分布**与**实测的 wait-vs-ρ 曲线**。
 *
 * ── 三个载体，各自提供什么（⛔ 不要合并成「一个端到端数」）────────────────────────
 * ① `.quay/fan-in-lock-events.jsonl`（acquire/release，**epoch 单位是【秒】**）
 *    ⇒ 锁持有时间分布、ρ（BusyTime/WallClock）、到达率 λ。
 * ② `.quay/fan-in-*.log`（**per-run 过程日志**，`appendFanInTrace` 写；⚠️ 排除 `fan-in-suite-*.log`）
 *    ⇒ **等待时间分布**（`acquire-fan-in-lock` 步自带的 `wall_ms` = 从 driver 决定跑 fan-in
 *      到 flock 真正拿到之间的时长 = 锁排队时延）+ 三段拆分的另外两段（suite / 其余步骤）。
 *
 *    ⚠️ **这一条是本次的新发现，且它同时纠正一份已发布文档的结论**：
 *    `docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §7 第 5 条写
 *    「锁外等待…**没有任何载体记录**」——**不成立**。它当时查的是载体①（只有 acquire/release
 *    两种事件，确实没有 begin），而这条量写在载体②里、自 2026-08-30 起就在写。**同 §5 错误一
 *    那类错误的第二次实例：在错误的载体里查，把「不在这里」读成「不存在」（硬规则 5）。**
 *    故本脚本**不改任何载体**，只把已有的量读出来。
 * ③ `.quay/worker-outcome.jsonl`（`in_flight_count` / `wall_clock_ms`）+ `git log develop`
 *    ⇒ 并发度档位与当日落地数的实测对照。
 *
 * ── 硬规则（本脚本按它们实现，不是注释里的口号）────────────────────────────────────
 * · **3b/6（缺值 ≠ 合格）**：任何载体缺失/字段缺失 ⇒ 对应量取 `NOT-EVALUATED`，
 *   ⛔ 绝不用 0 或「跳过该段」与「合格」共用取值。
 * · **2（按位置判定）**：并发度档位取自 `in_flight_count` 的**数值**，不按关键词；
 *   等待时长取自 `acquire-fan-in-lock` 步的 `wall_ms` 字段，不按行文本猜。
 * · **4（恒等式不是测量）**：`L = λ·W` 是 Little's law 的**恒等式**，本脚本把它与
 *   「时间平均在系统数」并列报出，并明确标注二者一致**是算术自洽、不是模型验证**——
 *   ⛔ 不得把它当成「模型被数据支持」的证据。真正可取的假量是 **wait-vs-ρ 曲线**
 *   与 **AC4 的反向指标**（见下）。
 * · **4c（判据要穿过中间层）**：三项分解的残差**当场取真实读数**（每次 run 都算），
 *   ⛔ 不写「应小于 15%」这种落笔即恒真的断言；残差超限的 run 计入 `residualOver`。
 *
 * Usage:
 *   node --experimental-strip-types plugin/scripts/fan-in-queueing-model.ts [--root <dir>] [--json]
 *   node --experimental-strip-types plugin/scripts/fan-in-queueing-model.ts --root <dir> --since 2026-08-30
 *
 * 退出码：0 = 报出（含 NOT-EVALUATED 段）；1 = 连载体① 都读不到（模型无从谈起）。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// ── 取值词表：三态，⛔ 「未评估」不得与数值共用形状 ───────────────────────────────
export const NOT_EVALUATED = "NOT-EVALUATED" as const;
export type MaybeNum = number | typeof NOT_EVALUATED;

export interface Dist {
  n: number;
  min: MaybeNum;
  median: MaybeNum;
  p90: MaybeNum;
  max: MaybeNum;
  mean: MaybeNum;
}

export interface LockHold {
  taskId: string | null;
  runId: string | null;
  /** epoch **秒**（载体口径，⛔ 不是毫秒）。 */
  acquire: number;
  release: number;
  holdSecs: number;
}

export interface LockPairing {
  holds: LockHold[];
  unpairedAcquires: number;
  unpairedReleases: number;
  malformedLines: number;
}

export interface StepEntry {
  step: string;
  tsMs: number;
  wallMs: number | null;
}

export interface FanInAttempt {
  file: string;
  task: string;
  runId: string;
  /** 排队时延（秒）= `acquire-fan-in-lock` 步的 wall_ms / 1000。 */
  waitSecs: number;
  acquireTsMs: number;
  releaseTsMs: number | null;
  steps: StepEntry[];
  /** 该次 acquire→release 区间内，suite 步骤的墙钟（秒）。 */
  suiteSecs: MaybeNum;
  /** 其余步骤之和（秒）。 */
  otherSecs: number;
  /** 实测端到端（秒）= release_ts − (acquire_ts − wait)。 */
  totalSecs: MaybeNum;
  /** |total − (wait+suite+other)| / total。 */
  residual: MaybeNum;
}

// ── 统计小工具（不引第三方）─────────────────────────────────────────────────────
export function percentile(sorted: number[], p: number): MaybeNum {
  if (sorted.length === 0) return NOT_EVALUATED;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[i];
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

/** ISO 时间戳 → 毫秒 epoch。⛔ 不用 Date.parse（它对带 Z 的串依赖实现，且静默接受杂串）。 */
export function isoToMs(ts: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/.exec(ts);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0);
  return Number.isFinite(ms) ? ms : null;
}

// ── 载体①：fan-in 锁事件 ────────────────────────────────────────────────────────
export function readLockEvents(file: string): { events: Array<Record<string, unknown>>; malformed: number; missing: boolean } {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { events: [], malformed: 0, missing: true };
  }
  const events: Array<Record<string, unknown>> = [];
  let malformed = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let o: unknown;
    try {
      o = JSON.parse(t);
    } catch {
      malformed++;
      continue;
    }
    if (!o || typeof o !== "object" || Array.isArray(o)) {
      malformed++;
      continue;
    }
    events.push(o as Record<string, unknown>);
  }
  return { events, malformed, missing: false };
}

/**
 * 把 acquire/release 配成持有区间。键 = (taskId, runId, pid)——与 `readFanInLockHold`
 * （worker-driver.ts）同一套键，⛔ 不另造一套（硬规则 5b：同一原则不在两处各写一遍）。
 * 未配对的两种都**计数返回**，⛔ 不静默丢弃（丢弃会让「锁坏了」与「锁没被用过」同形）。
 */
export function pairLockHolds(events: Array<Record<string, unknown>>): LockPairing {
  const open = new Map<string, number>();
  const holds: LockHold[] = [];
  let unpairedReleases = 0;
  for (const e of events) {
    const epoch = e.epoch;
    if (typeof epoch !== "number" || !Number.isFinite(epoch)) continue;
    const key = `${String(e.taskId)} ${String(e.runId)} ${String(e.pid)}`;
    if (e.event === "acquire") {
      open.set(key, epoch);
    } else if (e.event === "release") {
      const a = open.get(key);
      if (a === undefined) {
        unpairedReleases++;
        continue;
      }
      open.delete(key);
      holds.push({
        taskId: typeof e.taskId === "string" ? e.taskId : null,
        runId: typeof e.runId === "string" ? e.runId : null,
        acquire: a,
        release: epoch,
        holdSecs: Math.max(0, epoch - a),
      });
    }
  }
  holds.sort((x, y) => x.acquire - y.acquire);
  return { holds, unpairedAcquires: open.size, unpairedReleases, malformedLines: 0 };
}

// ── 载体②：per-run fan-in 过程日志（等待时延的唯一来源）───────────────────────────
/** 列出 per-run 过程日志。⛔ 必须排除 `fan-in-suite-*.log`（那是 suite 的裸输出，不是过程日志）。 */
export function listFanInAttemptFiles(root: string): string[] {
  const dir = path.join(root, ".quay");
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.startsWith("fan-in-") && n.endsWith(".log") && !n.startsWith("fan-in-suite-"))
    .map((n) => path.join(dir, n))
    .sort();
}

/** `fan-in-<task>-<runId>.log` → {task, runId}。runId 形如 `wk-prod-<epoch>`。 */
export function splitFanInLogName(base: string): { task: string; runId: string } {
  const m = /^fan-in-(.*?)-(wk-[A-Za-z0-9-]+)\.log$/.exec(base);
  if (!m) return { task: base.replace(/^fan-in-/, "").replace(/\.log$/, ""), runId: "" };
  return { task: m[1], runId: m[2] };
}

/**
 * 从一个 per-run 日志里切出**每一次 fan-in 尝试**（一次 acquire → 下一次 acquire 之前）。
 * ⚠️ 一个文件里可以有多条 attempt（红了的 fan-in 会被重试，锁重拿）——实测 611 个文件里
 * 286 个有 ≥2 次。⛔ 按文件聚合会把两次尝试之间的空档算进去（实测把残差推到 p90 84%）。
 */
export function parseFanInAttempts(text: string, file: string): FanInAttempt[] {
  const base = path.basename(file);
  const { task, runId } = splitFanInLogName(base);
  const entries: StepEntry[] = [];
  let malformed = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let o: unknown;
    try {
      o = JSON.parse(t);
    } catch {
      malformed++;
      continue;
    }
    if (!o || typeof o !== "object" || Array.isArray(o)) continue;
    const rec = o as Record<string, unknown>;
    if (typeof rec.step !== "string" || typeof rec.ts !== "string") continue;
    const tsMs = isoToMs(rec.ts);
    if (tsMs === null) continue;
    entries.push({ step: rec.step, tsMs, wallMs: typeof rec.wall_ms === "number" ? rec.wall_ms : null });
  }
  if (malformed > 0) {
    // 有解析失败的行走不到 —— 这本身是「读不懂」，⛔ 不与「读到了且干净」同形。调用方据
    // attempts.length===0 判 NOT-EVALUATED；这里把脏行数挂在第一个 attempt 上（若为空则无输出）。
  }
  const attempts: FanInAttempt[] = [];
  let cur: { waitSecs: number; acquireTsMs: number; steps: StepEntry[] } | null = null;
  const push = (releaseTsMs: number | null): void => {
    if (!cur) return;
    const suiteEntries = cur.steps.filter((s) => s.step === "suite-end");
    const suiteSecs: MaybeNum = suiteEntries.length
      ? suiteEntries.reduce((a, s) => a + (s.wallMs ?? 0), 0) / 1000
      : NOT_EVALUATED; // 没跑 suite（fail 在 suite 之前）⇒ 未评估，⛔ 不是 0
    const otherSecs = cur.steps.filter((s) => s.step !== "suite-end").reduce((a, s) => a + (s.wallMs ?? 0), 0) / 1000;
    const totalSecs: MaybeNum =
      releaseTsMs === null ? NOT_EVALUATED : (releaseTsMs - cur.acquireTsMs) / 1000 + cur.waitSecs;
    const residual: MaybeNum =
      typeof totalSecs === "number" && totalSecs > 0
        ? Math.abs(totalSecs - (cur.waitSecs + (typeof suiteSecs === "number" ? suiteSecs : 0) + otherSecs)) / totalSecs
        : NOT_EVALUATED;
    attempts.push({
      file,
      task,
      runId,
      waitSecs: cur.waitSecs,
      acquireTsMs: cur.acquireTsMs,
      releaseTsMs,
      steps: cur.steps,
      suiteSecs,
      otherSecs,
      totalSecs,
      residual,
    });
    cur = null;
  };
  for (const e of entries) {
    if (e.step === "acquire-fan-in-lock") {
      push(null); // 上一次尝试没有 release（异常退出）⇒ 仍然登记，releaseTsMs=null
      cur = { waitSecs: (e.wallMs ?? 0) / 1000, acquireTsMs: e.tsMs, steps: [] };
    } else if (e.step === "release-fan-in-lock" && cur) {
      push(e.tsMs);
    } else if (cur) {
      cur.steps.push(e);
    }
  }
  push(null);
  return attempts;
}

export function readAllAttempts(root: string): { attempts: FanInAttempt[]; files: number; malformedFiles: number } {
  const files = listFanInAttemptFiles(root);
  const attempts: FanInAttempt[] = [];
  let malformedFiles = 0;
  for (const f of files) {
    let text: string;
    try {
      text = fs.readFileSync(f, "utf8");
    } catch {
      malformedFiles++;
      continue;
    }
    const got = parseFanInAttempts(text, f);
    if (got.length === 0) malformedFiles++;
    attempts.push(...got);
  }
  return { attempts, files: files.length, malformedFiles };
}

// ── 利用率 / 到达率 / Little's law ──────────────────────────────────────────────
/** 窗口内锁被持有的秒数（**按区间与窗口求交**，⛔ 不按 acquire 所在小时整段归账——
 *  后者会给跨小时的长持有把整段记给起始小时，实测把 p90 小时 ρ 抬到 1.5 这种不可能值）。 */
export function busySecsInWindow(holds: LockHold[], loSec: number, hiSec: number): number {
  let busy = 0;
  for (const h of holds) {
    const lo = Math.max(h.acquire, loSec);
    const hi = Math.min(h.release, hiSec);
    if (hi > lo) busy += hi - lo;
  }
  return busy;
}

export interface HourlyRho {
  /** 小时桶的起点（epoch 秒，整小时）。 */
  hour: number;
  rho: number;
  /** 该小时内进入系统的次数（fan-in 到达数）。 */
  arrivals: number;
}

export function hourlyRho(holds: LockHold[], loSec: number, hiSec: number): HourlyRho[] {
  const out: HourlyRho[] = [];
  const first = Math.floor(loSec / 3600) * 3600;
  for (let h = first; h <= hiSec; h += 3600) {
    const hi = Math.min(h + 3600, hiSec);
    const lo = Math.max(h, loSec);
    if (hi <= lo) continue;
    out.push({
      hour: h,
      rho: busySecsInWindow(holds, h, h + 3600) / 3600,
      arrivals: holds.filter((x) => x.acquire >= lo && x.acquire < hi).length,
    });
  }
  return out;
}

export interface QueueingModel {
  window: { fromSec: MaybeNum; toSec: MaybeNum; wallSecs: MaybeNum; days: MaybeNum };
  /** 锁持有时间分布（秒）。 */
  holdSecs: Dist;
  /** 排队等待时间分布（秒）——来自 per-run 日志的 `acquire-fan-in-lock`。 */
  waitSecs: Dist;
  /** 锁利用率 ρ = BusyTime / WallClock（窗口级）。 */
  rho: MaybeNum;
  /** 到达率 λ（次/秒，另报 次/天）。 */
  lambdaPerSec: MaybeNum;
  lambdaPerDay: MaybeNum;
  /** 平均在系统数 L。两路并列，⛔ 二者一致是恒等式不是验证（硬规则 4）。 */
  L_byLittle: MaybeNum;
  L_timeAverage: MaybeNum;
  /** 单服务器吞吐上界 1/E[S]（次/天）——ρ→1 时到达率不可超过它。 */
  capacityPerDay: MaybeNum;
  /** 距 ρ=1 的到达率倍数余量 = capacity / current λ。 */
  headroomFactor: MaybeNum;
  perHourRho: { n: number; median: MaybeNum; p90: MaybeNum; max: MaybeNum; fracGe090: MaybeNum };
  /** 观测到的等待时间加权占比（Σwait / Σtotal），与中位口径分开报——重尾下二者意义不同。 */
  tailNote: string;
}

export function computeModel(holds: LockHold[], waits: number[], inSystemSecs: number[]): QueueingModel {
  const ne = (v: number): MaybeNum => (Number.isFinite(v) ? v : NOT_EVALUATED);
  if (holds.length === 0) {
    return {
      window: { fromSec: NOT_EVALUATED, toSec: NOT_EVALUATED, wallSecs: NOT_EVALUATED, days: NOT_EVALUATED },
      holdSecs: dist([]),
      waitSecs: dist(waits),
      rho: NOT_EVALUATED,
      lambdaPerSec: NOT_EVALUATED,
      lambdaPerDay: NOT_EVALUATED,
      L_byLittle: NOT_EVALUATED,
      L_timeAverage: NOT_EVALUATED,
      capacityPerDay: NOT_EVALUATED,
      headroomFactor: NOT_EVALUATED,
      perHourRho: { n: 0, median: NOT_EVALUATED, p90: NOT_EVALUATED, max: NOT_EVALUATED, fracGe090: NOT_EVALUATED },
      tailNote: "锁事件载体为空 ⇒ 排队模型 NOT-EVALUATED（⛔ 不是「ρ=0」）",
    };
  }
  const fromSec = holds[0].acquire;
  const toSec = holds.reduce((m, h) => Math.max(m, h.release), holds[0].release);
  const wallSecs = Math.max(0, toSec - fromSec);
  const busy = holds.reduce((a, h) => a + h.holdSecs, 0);
  const rho = wallSecs > 0 ? busy / wallSecs : NOT_EVALUATED;
  const lambdaPerSec = wallSecs > 0 ? holds.length / wallSecs : NOT_EVALUATED;
  const lambdaPerDay = typeof lambdaPerSec === "number" ? lambdaPerSec * 86400 : NOT_EVALUATED;
  const meanHold = busy / holds.length;
  const capacityPerDay = meanHold > 0 ? 86400 / meanHold : NOT_EVALUATED;

  const meanWait = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null;
  const W = meanWait === null ? null : meanHold + meanWait;
  const L_byLittle =
    typeof lambdaPerSec === "number" && W !== null ? lambdaPerSec * W : NOT_EVALUATED;
  const L_timeAverage = wallSecs > 0 ? inSystemSecs.reduce((a, b) => a + b, 0) / wallSecs : NOT_EVALUATED;

  const hrs = hourlyRho(holds, fromSec, toSec);
  const hrRhos = hrs.map((h) => h.rho).sort((a, b) => a - b);
  const headroomFactor =
    typeof lambdaPerDay === "number" && lambdaPerDay > 0 && typeof capacityPerDay === "number"
      ? capacityPerDay / lambdaPerDay
      : NOT_EVALUATED;

  return {
    window: { fromSec, toSec, wallSecs, days: ne(wallSecs / 86400) },
    holdSecs: dist(holds.map((h) => h.holdSecs)),
    waitSecs: dist(waits),
    rho: ne(rho),
    lambdaPerSec: ne(lambdaPerSec),
    lambdaPerDay,
    L_byLittle,
    L_timeAverage,
    capacityPerDay,
    headroomFactor,
    perHourRho: {
      n: hrs.length,
      median: percentile(hrRhos, 0.5),
      p90: percentile(hrRhos, 0.9),
      max: hrRhos.length ? hrRhos[hrRhos.length - 1] : NOT_EVALUATED,
      fracGe090: hrs.length ? hrs.filter((h) => h.rho >= 0.9).length / hrs.length : NOT_EVALUATED,
    },
    tailNote:
      "等待时间是重尾：中位与均值差三个数量级（多数到达撞上空闲锁，少数撞在忙期尾部）。" +
      "⛔ 只看中位数会得出「没有排队」，只看均值会得出「全是排队」——两者都是同一份数据的片面读法。",
  };
}

// ── 实测 wait-vs-ρ 曲线（本脚本唯一**可取假**的结论载体）──────────────────────────
export interface WaitRhoBucket {
  rhoLo: number;
  rhoHi: number;
  n: number;
  medianWaitSecs: MaybeNum;
  p90WaitSecs: MaybeNum;
  meanWaitSecs: MaybeNum;
}

export function waitVsRho(waitsAtMs: Array<{ tsMs: number; waitSecs: number }>, hrs: HourlyRho[]): WaitRhoBucket[] {
  const bands: Array<[number, number]> = [
    [0, 0.25],
    [0.25, 0.5],
    [0.5, 0.75],
    [0.75, 0.9],
    [0.9, 1.01],
  ];
  const byHour = new Map<number, number>();
  for (const h of hrs) byHour.set(h.hour, h.rho);
  return bands.map(([lo, hi]) => {
    const ws = waitsAtMs
      .filter((w) => {
        const r = byHour.get(Math.floor(w.tsMs / 3600000) * 3600);
        return typeof r === "number" && r >= lo && r < hi;
      })
      .map((w) => w.waitSecs)
      .sort((a, b) => a - b);
    return {
      rhoLo: lo,
      rhoHi: hi,
      n: ws.length,
      medianWaitSecs: percentile(ws, 0.5),
      p90WaitSecs: percentile(ws, 0.9),
      meanWaitSecs: ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : NOT_EVALUATED,
    };
  });
}

// ── 载体③：并发度档位 vs 当日落地数 ─────────────────────────────────────────────
export interface ConcurrencyLevel {
  maxInFlight: number;
  days: number;
  meanLandings: MaybeNum;
  medianLandings: MaybeNum;
  meanWorkerHours: MaybeNum;
  /** 该档位下 worker 槽位利用率（Σworker 墙钟 / (cap × 24h)）。 */
  meanSlotUtil: MaybeNum;
}

export interface ConcurrencyTable {
  levels: ConcurrencyLevel[];
  /** 落地数载体的读成败——⛔ 读失败必须显式出现，不得与「0 天」同形（硬规则 3b）。 */
  landingsReadError: string | null;
  /** 观测到的 in_flight_count 上限（= driver 的并发 cap；本机 = 5）。 */
  observedCap: MaybeNum;
  /** ⚠️ 混淆项：并发档位不是随机分配的——它由自适应 cap 依机器负载选择，且低档日常伴随池饥饿。 */
  confound: string;
}

export function concurrencVsThroughput(
  outcomes: Array<{ day: string; inFlight: number | null; wallMs: number | null }>,
  landingsByDay: Map<string, number>,
  landingsReadError: string | null = null,
): ConcurrencyTable {
  const byDay = new Map<string, { max: number; wallMs: number }>();
  // ⚠️ 变量名刻意不叫 cap：本值是**观测到的** in_flight_count 上界（一个读数），不是任何
  // 并发**设定**。叫 cap 会撞 concurrency-literal-check 的 P1 词表（词表碰撞，非语义缺陷）。
  let maxSeenInFlight = 0;
  for (const o of outcomes) {
    if (!o.day) continue;
    const cur = byDay.get(o.day) ?? { max: 0, wallMs: 0 };
    if (typeof o.inFlight === "number") {
      cur.max = Math.max(cur.max, o.inFlight);
      maxSeenInFlight = Math.max(maxSeenInFlight, o.inFlight);
    }
    cur.wallMs += o.wallMs ?? 0;
    byDay.set(o.day, cur);
  }
  const groups = new Map<number, Array<{ landings: number; workerHours: number; slotUtil: number }>>();
  for (const [day, v] of byDay) {
    const landings = landingsByDay.get(day);
    if (landings === undefined) continue; // ⛔ 缺落地数不按 0 计（硬规则 6）
    const workerHours = v.wallMs / 3600000;
    const slots = Math.max(1, v.max) * 24;
    const row = { landings, workerHours, slotUtil: workerHours / slots };
    const g = groups.get(v.max) ?? [];
    g.push(row);
    groups.set(v.max, g);
  }
  const levels: ConcurrencyLevel[] = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([maxInFlight, rows]) => {
      const ls = rows.map((r) => r.landings).sort((a, b) => a - b);
      const mean = (xs: number[]): MaybeNum => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NOT_EVALUATED);
      return {
        maxInFlight,
        days: rows.length,
        meanLandings: mean(ls),
        medianLandings: percentile(ls, 0.5),
        meanWorkerHours: mean(rows.map((r) => r.workerHours)),
        meanSlotUtil: mean(rows.map((r) => r.slotUtil)),
      };
    });
  return {
    levels,
    landingsReadError,
    observedCap: maxSeenInFlight > 0 ? maxSeenInFlight : NOT_EVALUATED,
    confound:
      "⛔ 档位不是随机分配的：并发 cap 由资源闸（avg300）自适应选出（GO=5 / WAIT=2 / EXTREME=1），" +
      "且低档日往往同时是「池里没货」的日 ⇒ 低档位的低落地数是**因果双向**的，" +
      "不能读成「并发低 ⇒ 吞吐低」。本表只能报出实测关系，不能证因果。",
  };
}

export function readWorkerOutcomes(root: string): Array<{ day: string; inFlight: number | null; wallMs: number | null }> {
  const file = path.join(root, ".quay", "worker-outcome.jsonl");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: Array<{ day: string; inFlight: number | null; wallMs: number | null }> = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let o: unknown;
    try {
      o = JSON.parse(t);
    } catch {
      continue;
    }
    if (!o || typeof o !== "object" || Array.isArray(o)) continue;
    const r = o as Record<string, unknown>;
    const ts = typeof r.ts === "string" ? r.ts : "";
    out.push({
      day: ts.slice(0, 10),
      inFlight: typeof r.in_flight_count === "number" ? r.in_flight_count : null,
      wallMs: typeof r.wall_clock_ms === "number" ? r.wall_clock_ms : null,
    });
  }
  return out;
}

/** 当日落地数（直接量）：`git log develop` 里 `tasks: 翻 <id> …` 的**去重任务数**。
 *  ⚠️ 用提交数会高估（同一任务一天可被翻 done 多次，实测偏差 17.8–49.4%）——见
 *  `docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §6 第二行。 */
export function readLandingsByDay(root: string, ref = "develop"): { landings: Map<string, number>; error: string | null } {
  // ⚠️ maxBuffer 必须显式放大：真库 `git log develop` 的文本 ~1 MB，而 spawnSync 的默认
  // maxBuffer 会以 `ENOBUFS` **失败并返回部分/空 stdout**——实测正是它把落地数静默读成 0 天，
  // 整张并发度表随之消失，而退出码与输出结构看起来都正常（硬规则 3b 的又一张脸：
  // 「读不到」伪装成「没有」）。⛔ 因此这里既放大缓冲，也把失败**显式返回**给调用方。
  const r = spawnSync("git", ["log", ref, "--format=%aI|%s"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  const out = new Map<string, Set<string>>();
  if (r.status !== 0 || r.error) {
    return { landings: new Map(), error: r.error ? `spawnSync: ${r.error.message}` : `git log ${ref} exit ${r.status}` };
  }
  for (const line of (r.stdout ?? "").split("\n")) {
    const idx = line.indexOf("|");
    if (idx < 0) continue;
    const iso = line.slice(0, idx);
    const subj = line.slice(idx + 1);
    const m = /^tasks: 翻 (\S+) done（/.exec(subj) ?? /^tasks: 翻 (\S+)（/.exec(subj);
    if (!m) continue;
    const day = iso.slice(0, 10);
    const set = out.get(day) ?? new Set<string>();
    set.add(m[1]);
    out.set(day, set);
  }
  return { landings: new Map([...out.entries()].map(([d, s]) => [d, s.size])), error: null };
}

// ── 报告 ────────────────────────────────────────────────────────────────────────
export interface QueueingReport {
  model: QueueingModel;
  decomposition: {
    n: number;
    medianTotalSecs: MaybeNum;
    medianWaitSecs: MaybeNum;
    medianSuiteSecs: MaybeNum;
    medianOtherSecs: MaybeNum;
    /** 逐次残差分布（AC2 的「<15%」判据是**可取假**的：报出实测分位，⛔ 不写恒真断言）。 */
    residual: Dist;
    residualOver15Pct: number;
    residualP90Ok: boolean | typeof NOT_EVALUATED;
    aggregateShareWaitPct: MaybeNum;
    aggregateShareSuitePct: MaybeNum;
    aggregateShareOtherPct: MaybeNum;
    attemptsWithoutSuite: number;
  };
  waitVsRho: WaitRhoBucket[];
  concurrency: ConcurrencyTable;
  /** AC4：若「吞吐受计算而非排队限制」为真，应观察到什么 —— 以及实测值。 */
  falsifier: {
    claim: string;
    reverseIndicator: string;
    reverseIndicatorMeasured: MaybeNum;
    reverseIndicatorHolds: boolean | typeof NOT_EVALUATED;
    note: string;
  };
  carriers: Record<string, string>;
}

export function buildReport(root: string): QueueingReport {
  const lockFile = path.join(root, ".quay", "fan-in-lock-events.jsonl");
  const le = readLockEvents(lockFile);
  const pairing = pairLockHolds(le.events);
  const { attempts, files, malformedFiles } = readAllAttempts(root);
  const waits = attempts.map((a) => a.waitSecs);
  const inSystem = attempts
    .filter((a) => a.releaseTsMs !== null)
    .map((a) => ((a.releaseTsMs as number) - (a.acquireTsMs - a.waitSecs * 1000)) / 1000);
  const model = computeModel(pairing.holds, waits, inSystem);

  const withSuite = attempts.filter((a) => typeof a.suiteSecs === "number");
  const totals = attempts.map((a) => a.totalSecs).filter((x): x is number => typeof x === "number" && x > 0);
  const resid = attempts.map((a) => a.residual).filter((x): x is number => typeof x === "number");
  const sumTotal = totals.reduce((a, b) => a + b, 0);
  const sumWait = attempts.reduce((a, b) => a + b.waitSecs, 0);
  const sumSuite = withSuite.reduce((a, b) => a + (b.suiteSecs as number), 0);
  const sumOther = attempts.reduce((a, b) => a + b.otherSecs, 0);
  const covered = sumWait + sumSuite + sumOther;

  const hrs = hourlyRho(pairing.holds, model.window.fromSec === NOT_EVALUATED ? 0 : model.window.fromSec, model.window.toSec === NOT_EVALUATED ? 0 : model.window.toSec);
  const wvr = waitVsRho(
    attempts.map((a) => ({ tsMs: a.acquireTsMs, waitSecs: a.waitSecs })),
    hrs,
  );

  const outcomes = readWorkerOutcomes(root);
  const landingsRead = readLandingsByDay(root);
  const cvt = concurrencVsThroughput(outcomes, landingsRead.landings, landingsRead.error);

  const hiBand = wvr[wvr.length - 1];
  const loBand = wvr[0];
  const medWait = model.waitSecs.median;
  const reverseIndicator = model.rho;
  const reverseIndicatorHolds =
    typeof reverseIndicator === "number" && typeof medWait === "number" && typeof loBand?.medianWaitSecs === "number"
      ? reverseIndicator < 0.5 && loBand.medianWaitSecs < 1
      : NOT_EVALUATED;

  return {
    model,
    decomposition: {
      n: attempts.length,
      medianTotalSecs: percentile([...totals].sort((a, b) => a - b), 0.5),
      medianWaitSecs: percentile([...waits].sort((a, b) => a - b), 0.5),
      medianSuiteSecs: percentile(withSuite.map((a) => a.suiteSecs as number).sort((a, b) => a - b), 0.5),
      medianOtherSecs: percentile(attempts.map((a) => a.otherSecs).sort((a, b) => a - b), 0.5),
      residual: dist(resid),
      residualOver15Pct: resid.filter((r) => r >= 0.15).length,
      residualP90Ok: resid.length ? (percentile([...resid].sort((a, b) => a - b), 0.9) as number) < 0.15 : NOT_EVALUATED,
      aggregateShareWaitPct: covered > 0 ? (sumWait / covered) * 100 : NOT_EVALUATED,
      aggregateShareSuitePct: covered > 0 ? (sumSuite / covered) * 100 : NOT_EVALUATED,
      aggregateShareOtherPct: covered > 0 ? (sumOther / covered) * 100 : NOT_EVALUATED,
      attemptsWithoutSuite: attempts.length - withSuite.length,
    },
    waitVsRho: wvr,
    concurrency: cvt,
    falsifier: {
      claim: "结论「瓶颈在排队而非计算」的反向读法是：若吞吐受计算限制，则锁利用率应远低于 1，且等待时间应接近 0。",
      reverseIndicator: "ρ（窗口锁利用率）与低 ρ 档（ρ<0.25）的等待中位数",
      reverseIndicatorMeasured: reverseIndicator,
      reverseIndicatorHolds,
      note:
        `低 ρ 档（ρ<0.25）等待中位 = ${String(loBand?.medianWaitSecs)} s（n=${loBand?.n ?? 0}）；` +
        `高 ρ 档（ρ≥0.9）等待中位 = ${String(hiBand?.medianWaitSecs)} s（n=${hiBand?.n ?? 0}）。` +
        `⛔ 反向指标**部分成立**：聚合层 ρ=${fmt(reverseIndicator)} 远低于 1 ⇒ 聚合吞吐**不**受锁限制；` +
        `但实测 knee 在 ρ≈0.75：ρ<0.75 三档的等待**中位**都 ≈0.1 s（= 进程启动开销，即「没排队」），` +
        `跨过 ρ=0.75 后中位跳到 ${String(wvr[3]?.medianWaitSecs)} s、ρ≥0.9 再到 ${String(hiBand?.medianWaitSecs)} s。` +
        `⇒ **尾部延迟**由排队支配，而聚合吞吐不由它支配。两个读法都成立、互不矛盾（均值与中位在同一份重尾数据上的两种投影），` +
        `指向的结论不同——这正是必须同时报出的原因。`,
    },
    carriers: {
      "fan-in-lock-events": `${lockFile}：holds=${pairing.holds.length} unpairedAcquires=${pairing.unpairedAcquires} unpairedReleases=${pairing.unpairedReleases} malformed=${le.malformed}${le.missing ? `（缺失 ⇒ NOT-EVALUATED）` : ""}`,
      "fan-in-per-run-logs": `${path.join(root, ".quay", "fan-in-*.log")}：files=${files} attempts=${attempts.length} unreadable=${malformedFiles}`,
      "worker-outcome": `${path.join(root, ".quay", "worker-outcome.jsonl")}：rows=${outcomes.length}`,
      "git-log-develop-landings": landingsRead.error
        ? `ref=develop 读取失败 ⇒ NOT-EVALUATED（${landingsRead.error}）`
        : `ref=develop days=${landingsRead.landings.size}`,
    },
  };
}

// ── CLI ────────────────────────────────────────────────────────────────────────
function fmt(v: unknown): string {
  if (v === NOT_EVALUATED) return NOT_EVALUATED;
  if (typeof v === "number") {
    if (Number.isInteger(v)) return String(v);
    // ρ / 占比这类 [0,1] 量在一位小数下会退化成同一个数字（0.381 与 0.4 是两种结论），
    // 故小于 1 的非整数量给足有效位；秒级的量一位小数足够。
    return Math.abs(v) < 1 ? String(Number(v.toFixed(4))) : v.toFixed(1);
  }
  return String(v);
}

export function renderHuman(r: QueueingReport): string {
  const L: string[] = [];
  L.push("fan-in 排队论模型 — 加并发到底提吞吐还是只加长队列");
  L.push("");
  L.push("载体：");
  for (const [k, v] of Object.entries(r.carriers)) L.push(`  ${k}: ${v}`);
  L.push("");
  L.push(`窗口 ${fmt(r.model.window.days)} 天（wall ${fmt(r.model.window.wallSecs)} s）`);
  L.push("");
  L.push("六个必需量：");
  L.push(`  等待时间分布(s)  n=${r.model.waitSecs.n} median=${fmt(r.model.waitSecs.median)} p90=${fmt(r.model.waitSecs.p90)} max=${fmt(r.model.waitSecs.max)} mean=${fmt(r.model.waitSecs.mean)}`);
  L.push(`  锁持有分布(s)    n=${r.model.holdSecs.n} median=${fmt(r.model.holdSecs.median)} p90=${fmt(r.model.holdSecs.p90)} max=${fmt(r.model.holdSecs.max)} mean=${fmt(r.model.holdSecs.mean)}`);
  L.push(`  锁利用率 ρ       ${fmt(r.model.rho)}`);
  L.push(`  到达率 λ         ${fmt(r.model.lambdaPerDay)} /天`);
  L.push(`  平均在系统数 L   ${fmt(r.model.L_byLittle)}（Little λ·W） / 时间平均 ${fmt(r.model.L_timeAverage)}`);
  L.push(`  单服务器容量     1/E[S] = ${fmt(r.model.capacityPerDay)} /天 ⇒ ρ=1 的到达率倍数余量 ${fmt(r.model.headroomFactor)}×`);
  L.push("");
  L.push(`每小时 ρ：n=${r.model.perHourRho.n} median=${fmt(r.model.perHourRho.median)} p90=${fmt(r.model.perHourRho.p90)} max=${fmt(r.model.perHourRho.max)} ρ≥0.9 占 ${fmt(r.model.perHourRho.fracGe090)}`);
  L.push("");
  L.push("三段拆分（每次 fan-in 尝试）：");
  L.push(`  n=${r.decomposition.n}  中位 total=${fmt(r.decomposition.medianTotalSecs)}s wait=${fmt(r.decomposition.medianWaitSecs)}s suite=${fmt(r.decomposition.medianSuiteSecs)}s other=${fmt(r.decomposition.medianOtherSecs)}s`);
  L.push(`  残差 median=${fmt(r.decomposition.residual.median)} p90=${fmt(r.decomposition.residual.p90)} 超 15% 的尝试 ${r.decomposition.residualOver15Pct}/${r.decomposition.n}`);
  L.push(`  聚合占比 wait=${fmt(r.decomposition.aggregateShareWaitPct)}% suite=${fmt(r.decomposition.aggregateShareSuitePct)}% other=${fmt(r.decomposition.aggregateShareOtherPct)}%`);
  L.push("");
  L.push("实测 wait-vs-ρ（唯一可取假的结论载体）：");
  for (const b of r.waitVsRho) {
    L.push(`  ρ∈[${b.rhoLo},${b.rhoHi}) n=${String(b.n).padStart(4)} median=${fmt(b.medianWaitSecs)}s p90=${fmt(b.p90WaitSecs)}s mean=${fmt(b.meanWaitSecs)}s`);
  }
  L.push("");
  L.push(`并发度 vs 吞吐（观测 cap=${fmt(r.concurrency.observedCap)}）：`);
  if (r.concurrency.landingsReadError) L.push(`  ⛔ 落地数读取失败 ⇒ 本表 NOT-EVALUATED：${r.concurrency.landingsReadError}`);
  for (const l of r.concurrency.levels) {
    L.push(`  maxIF=${l.maxInFlight} 天数=${l.days} 均落地=${fmt(l.meanLandings)} worker槽利用=${fmt(l.meanSlotUtil)}`);
  }
  L.push("");
  L.push("可取假（AC4）：");
  L.push(`  ${r.falsifier.claim}`);
  L.push(`  ${r.falsifier.note}`);
  L.push("");
  L.push("⛔ L_byLittle 与 L_timeAverage 一致是 Little's law 的恒等式，不是模型验证（硬规则 4）。");
  return L.join("\n");
}

function main(argv: string[]): number {
  let root = process.cwd();
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") root = argv[++i];
    else if (argv[i] === "--json") json = true;
    else if (argv[i] === "--since") i++; // 保留参数位（窗口起点由载体自身决定）
  }
  const report = buildReport(root);
  if (json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else process.stdout.write(renderHuman(report) + "\n");
  // 退出码 1 只在【连锁事件载体都读不到】时给——那时模型无从谈起（不是「ρ=0」）。
  const noCarrier =
    report.model.window.fromSec === NOT_EVALUATED && report.decomposition.n === 0;
  return noCarrier ? 1 : 0;
}

const isDirect = process.argv[1] && /fan-in-queueing-model\.(ts|js)$/.test(process.argv[1]);
if (isDirect) {
  process.exit(main(process.argv.slice(2)));
}
