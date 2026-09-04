// plugin/scripts/outer-driver.ts — AC143 (tasks/gap-ac143-observability-ledger-closing-driver):
// the outer's PURE-MECHANICAL A/B segments (A1/A6/A9/A10/A18/A21 读数 · B1/B2/B6 收尾留痕 ·
// B12/B17 自查审计) absorbed into a resident routine-type driver.
//
// WHY THIS EXISTS（manager-phase-goal.md ### AC143 · SPEC-unified-driver-architecture §2.1）：
// outer 执行核里「读 → 比较 → 报」的纯机械段（读数/收尾/自查）过去靠 outer 会话每轮记得调（角色意志，
// 换会话/换模型即丢失）。本驱动是常驻【机械】进程：每轮跑一遍例程（routine），把结构化读数（Fact）
// 写进载体（.quay/outer-round.jsonl，gitignored，manager/语义层可消费）。与 promotion/worker 的差异
// （人 2026-08-23 裁定分层）：它没有任务池、没有任务选择、没有「spawn 执行者再复核其自述」——它的
// 单元是【例程】不是【任务】，产出是【读数】不是【任务终态】。故它继承 Layer 0 + 1b（routine），
// ⛔ 不继承 Layer 1a（task-processing：source/select/verify 三段）。
//
// 权责边界（⛔ 只做 AC143 判据的机械面，不越界到语义判断——那是 AC145 manager 的事）：
//   驱动  ✅ 每轮跑一遍例程：A1 挂载读数 · A6 占用率 · A9 not-yet-flipped ·
//             A10 closure-lag 信号 · A18 slot-refill 读数 · A21 直接量活性（driver 活性：
//             develop 提交时距 + worktree 条数——⛔ 旧 A3 .halt 读数已退役，stall 判据换成
//             driver 活性直接量，gap-retire-halt-file-driver-based）· B1 收尾 pass ·
//             B2 留痕 · B6 落盘聚合 · B12 自身停止条件 · B17 判据消费审计
//         ✅ 每个例程读不到输入 ⇒ 产出 not-evaluated Fact（⛔ 与「合格」不同形，硬规则 3b / AC153）
//         ✅ 每轮无条件写一条 round 记录（.quay/outer-round.jsonl，AC1 生产载体）
//         ✅ 运行期 halt = 读 .quay/outer-control.json（单一真相源，与 promotion/worker 同族）
//   驱动  ⛔ 不做语义判断（升级/因果/「听来自洽但错了」的分诊——归 AC145 manager）
//         ⛔ 不做 commit（收尾 pass 写 status 到 tasks/<id>.md，同 --apply 晋升的写类，非 commit）
//
// Run:
//   node --experimental-strip-types plugin/scripts/outer-driver.ts \
//     --root <repo> [--interval <ms>] [--once] [--max-rounds <n>]
//     [--round-log <path>] [--run-id <id>] [--pid-file <path>] [--json]
//   --interval <ms>       轮间隔（缺省 30000；测试缝传小值）
//   --once                跑一轮即退出（手动单发 / 测试）
//   --max-rounds <n>      跑满 N 轮退出（测试缝，防常驻环无限跑）
//   --round-log <path>    轮记录文件（缺省 <root>/.quay/outer-round.jsonl）
//   --run-id <id>         轮记录里的 run_id（缺省 outer-<epoch>）
//   --pid-file <path>     把驱动自身 pid 写到该文件（外部观测 + kill 抓手）
//   --json                每轮向 stdout 打一条 JSON 事件行
// Exit: 0 = 正常（信号停机 / --once / --max-rounds 跑完）；2 = 参数错误。

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";
// Layer 0 + 1b（driver-runtime.ts）：splitArgs / ts / appendHeartbeatLine（心跳单一落点）/ Fact /
// RoutineSpec / scheduleIsDue / collectFacts。⛔ 不 import Layer 1a 的 source/select/verify——
// 本 kind 是例程型（1b），结构上不被迫实现任务处理三段（AC151 取假①）。
import { splitArgs, ts, appendHeartbeatLine, scheduleIsDue, collectFacts, type Fact, type RoutineSpec } from "./driver-runtime.ts";
// Layer 0 · controlPlane（driver-shared.ts）：运行期 halt = 读控制态单一真相源（与 promotion/worker 同族）。
import { isHalted } from "./driver-shared.ts";
// AC155：轮询间隔的单一真相源（drivers.yml 经 driver-config 加载，⛔ 不各写一份字面量）。
import { defaultDriverConfig, loadDriverConfig } from "./driver-config.ts";

/** round 记录的仓库相对路径（gitignored 运行时日志，promotion-round.jsonl 同族；AC1 生产载体）。 */
export const ROUND_LOG_REL = ".quay/outer-round.jsonl";

/** 控制态文件的仓库相对路径（运行期 halt 单一真相源，与 worker/promotion-control.json 同族）。 */
export const OUTER_CONTROL_STATE_REL = ".quay/outer-control.json";

/** 轮间隔缺省（毫秒）。AC155：值从 drivers.yml 派生（单一真相源）；生产由 --interval 覆盖，测试传小值。 */
export const INTERVAL_MS_DEFAULT = defaultDriverConfig().outer.intervalMs;

/** 例程的「每轮必跑」触发（outer 的 A/B 段全部是每 tick 必跑；schedule 字段供未来分化用，⛔ 非硬编码死值）。 */
export const EVERY_ROUND = { kind: "every" as const, n: 1 };

/** 单条命令 spawn 的 wall-clock 上限（spawnSync timeout，毫秒）。 */
export const ROUTINE_TIMEOUT_MS = 120_000;

// ── 纯函数（可单测）：解析各脚本输出为结构化值 ─────────────────────────────────────────────────────

/** 解析 ready-pool-check --json 输出，抽取 not-yet-flipped 计数（excluded[] 里 reasons 含
 *  not-yet-flipped 的条数，AC9 判据字段）。解析失败 ⇒ null。 */
export function parseNotYetFlipped(text: string): { nyf: number; pool: number } | null {
  try {
    const j = JSON.parse(text);
    if (!j || typeof j !== "object") return null;
    const excluded = Array.isArray(j.excluded) ? j.excluded : [];
    const nyf = excluded.filter(
      (e) =>
        e && typeof e === "object" &&
        (Array.isArray(e.reasons) ? e.reasons.includes("not-yet-flipped") : e.reason === "not-yet-flipped"),
    ).length;
    return { nyf, pool: typeof j.pool === "number" ? j.pool : 0 };
  } catch {
    return null;
  }
}

/** 解析 slot-refill --json 输出，抽取空槽读数（A18）与占用率（A6）字段。解析失败 ⇒ null。 */
export function parseSlotRefill(text: string): {
  shouldRefill: boolean;
  recommended: string[];
  slotsFree: number;
  effectiveCap: number;
  noRefillReason: string | null;
  inFlight: number;
  occupiedSlots: number;
} | null {
  try {
    const j = JSON.parse(text);
    if (!j || typeof j !== "object") return null;
    return {
      shouldRefill: !!j.should_refill,
      recommended: Array.isArray(j.recommended) ? j.recommended.map(String) : [],
      slotsFree: typeof j.slots_free === "number" ? j.slots_free : 0,
      effectiveCap: typeof j.effective_cap === "number" ? j.effective_cap : (typeof j.cap === "number" ? j.cap : 0), // concurrency-default-fallback: parse fallback not-a-number → 0 (⛔ not a cap literal)
      noRefillReason: typeof j.no_refill_reason === "string" ? j.no_refill_reason : null,
      inFlight: typeof j.in_flight_count === "number" ? j.in_flight_count : 0,
      occupiedSlots: typeof j.occupied_slots === "number" ? j.occupied_slots : 0, // concurrency-default-fallback: parse fallback not-a-number → 0 (⛔ not a cap literal)
    };
  } catch {
    return null;
  }
}

/** 解析 judgment-consumer-check --json 输出，抽取 wired/unfinished/drift。解析失败 ⇒ null。 */
export function parseJudgmentConsumer(text: string): { wired: number; unfinished: string[]; drift: boolean } | null {
  try {
    const j = JSON.parse(text);
    if (!j || typeof j !== "object") return null;
    return {
      wired: typeof j.wired === "number" ? j.wired : 0,
      unfinished: Array.isArray(j.unfinished) ? j.unfinished.map(String) : [],
      drift: !!j.drift,
    };
  } catch {
    return null;
  }
}

/** 解析 closure-lag-check.sh --close-terminal --json 输出，抽取 { scanned, closed }（closed = 本轮
 *  实际闭合的终态括号数——B12 自身停止条件的进展信号）。解析失败 ⇒ null。 */
export function parseClosureTerminal(text: string): { scanned: number; closed: number } | null {
  try {
    const j = JSON.parse(text);
    if (!j || typeof j !== "object") return null;
    return {
      scanned: typeof j.scanned === "number" ? j.scanned : 0,
      closed: Array.isArray(j.closed) ? j.closed.length : 0,
    };
  } catch {
    return null;
  }
}

/** B12 自身停止条件：连续 no-progress 轮计数。progress=true（本轮推进了任务状态）⇒ 归零；false ⇒ 递增。
 *  纯函数，可单测。返回 { counter, shouldStop }——counter >= 3 ⇒ shouldStop（连续 3 轮零推进）。 */
export function computeSelfStop(counter: number, progress: boolean): { counter: number; shouldStop: boolean } {
  const next = progress ? 0 : counter + 1;
  return { counter: next, shouldStop: next >= 3 };
}

// ── 例程（routine）：每个 = 「跑一条机械命令/读文件 → 解析 → 产出 Fact」 ─────────────────────────

/** 跑一条命令并解析 JSON。读失败/非零退出/解析失败 ⇒ 返回 null（⛔ 不抛——例程读不到输入报
 *  not-evaluated，不是崩溃）。 */
function runJson(argv: string[], root: string): unknown | null {
  if (!Array.isArray(argv) || argv.length === 0) return null;
  try {
    const r = spawnSync(argv[0], argv.slice(1), {
      cwd: root, encoding: "utf8", timeout: ROUTINE_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (r.error || r.status !== 0) return null;
    return JSON.parse(String(r.stdout ?? "").trim());
  } catch {
    return null;
  }
}

/** 跑一条命令，只关心退出码（信号类例程用）。返回 { exit, ok }。读失败 ⇒ ok=false。 */
function runExit(argv: string[], root: string): { exit: number | null; ok: boolean } {
  if (!Array.isArray(argv) || argv.length === 0) return { exit: null, ok: false };
  try {
    const r = spawnSync(argv[0], argv.slice(1), {
      cwd: root, encoding: "utf8", timeout: ROUTINE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (r.error || r.status === null) return { exit: null, ok: false };
    return { exit: r.status, ok: true };
  } catch {
    return { exit: null, ok: false };
  }
}

/** 把「读到的结构化值」包成 verified Fact；读不到（null）⇒ not-evaluated Fact（⛔ 与合格不同形）。 */
function factOf<T>(name: string, value: T | null, notEvaluatedReason: string): Fact {
  if (value === null) return { name, value: null, state: "not-evaluated", reason: notEvaluatedReason };
  return { name, value, state: "verified", reason: null };
}

/** A6 · 占用率：`slot-refill --cap 5 --json` → in_flight / occupied_slots / effective_cap。 */
export function occupancyRoutine(root: string, cmd: string[] | null): () => Fact[] {
  return () => {
    const argv = cmd ?? ["node", "--no-warnings", "--experimental-strip-types",
      path.join(root, "plugin", "scripts", "slot-refill.ts"), "--root", root, "--cap", "5", "--json"];
    const parsed = runJson(argv, root);
    const v = parsed && typeof parsed === "object" ? parseSlotRefill(JSON.stringify(parsed)) : null;
    const value = v === null ? null : { in_flight: v.inFlight, occupied_slots: v.occupiedSlots, cap: v.effectiveCap };
    return [factOf("occupancy", value, "slot-refill unreadable/unparseable")];
  };
}

/** A9 · not-yet-flipped：`ready-pool-check --cap 5 --json` → excluded[] not-yet-flipped 计数。 */
export function notYetFlippedRoutine(root: string, cmd: string[] | null): () => Fact[] {
  return () => {
    const argv = cmd ?? ["node", "--no-warnings", "--experimental-strip-types",
      path.join(root, "plugin", "scripts", "ready-pool-check.ts"), "--root", root, "--cap", "5", "--json"];
    const parsed = runJson(argv, root);
    const v = parsed && typeof parsed === "object" ? parseNotYetFlipped(JSON.stringify(parsed)) : null;
    return [factOf("not_yet_flipped", v, "ready-pool-check unreadable/unparseable")];
  };
}

/** A10 · closure-lag 信号：`closure-lag-check.sh`（无参信号检查），退出非 0 ⇒ 报出。 */
export function closureLagRoutine(root: string, cmd: string[] | null): () => Fact[] {
  return () => {
    const argv = cmd ?? ["bash", path.join(root, "plugin", "scripts", "closure-lag-check.sh")];
    const r = runExit(argv, root);
    if (!r.ok) return [{ name: "closure_lag", value: null, state: "not-evaluated", reason: "closure-lag-check unreadable" }];
    // exit 0 = 正常（无信号）；非 0 = 信号触发（报出，但这是读数不是门控——判断归 manager）。
    return [{ name: "closure_lag", value: { signal: r.exit !== 0, exit: r.exit }, state: "verified", reason: null }];
  };
}

/** A18 · slot-refill 空槽读数：`slot-refill --cap 5 --json` → should_refill/recommended/slots_free。 */
export function slotRefillRoutine(root: string, cmd: string[] | null): () => Fact[] {
  return () => {
    const argv = cmd ?? ["node", "--no-warnings", "--experimental-strip-types",
      path.join(root, "plugin", "scripts", "slot-refill.ts"), "--root", root, "--cap", "5", "--json"];
    const parsed = runJson(argv, root);
    const v = parsed && typeof parsed === "object" ? parseSlotRefill(JSON.stringify(parsed)) : null;
    const value = v === null ? null : {
      should_refill: v.shouldRefill, recommended: v.recommended, slots_free: v.slotsFree,
      effective_cap: v.effectiveCap, no_refill_reason: v.noRefillReason,
    };
    return [factOf("slot_refill", value, "slot-refill unreadable/unparseable")];
  };
}

/** A21 · 直接量活性：develop 最后提交时距 + 任务 worktree 条数 + 活进程数。⛔ 不用心跳/自报量判活性
 *  （硬规则 4b：被测对象自己产生的量不能判它是否活着）。 */
export function livenessDirectRoutine(root: string): () => Fact[] {
  return () => {
    try {
      const facts: Fact[] = [];
      // ① develop 最后提交时距（git 客观，inner 提交落 develop）。
      let commitAge: number | null = null;
      try {
        const r = spawnSync("git", ["-C", root, "log", "--oneline", "develop", "-1", "--format=%ci"], {
          encoding: "utf8", timeout: ROUTINE_TIMEOUT_MS,
        });
        if (!r.error && r.status === 0) {
          const m = String(r.stdout ?? "").trim().match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
          if (m) commitAge = Math.max(0, Math.floor((Date.now() - Date.parse(m[1].replace(" ", "T") + "Z")) / 1000));
        }
      } catch { /* git 读失败 ⇒ null */ }
      facts.push(factOf("liveness_commit_age", commitAge, "git log develop unreadable"));
      // ② 任务 worktree 条数（git worktree list，⛔ 不是 ls /tmp）。
      let worktreeCount: number | null = null;
      try {
        const r = spawnSync("git", ["-C", root, "worktree", "list", "--porcelain"], {
          encoding: "utf8", timeout: ROUTINE_TIMEOUT_MS,
        });
        if (!r.error && r.status === 0) {
          worktreeCount = String(r.stdout ?? "").split("\n").filter((l) => l.startsWith("worktree ")).length;
        }
      } catch { /* git 读失败 ⇒ null */ }
      facts.push(factOf("liveness_worktree_count", worktreeCount, "git worktree list unreadable"));
      return facts;
    } catch {
      return [{ name: "liveness_direct", value: null, state: "not-evaluated", reason: "liveness direct unreadable" }];
    }
  };
}

/** B1 · 收尾 pass：`closure-lag-check.sh --close-terminal --json`（机械闭合终态括号）→ { scanned, closed }。 */
export function closurePassRoutine(root: string, cmd: string[] | null): () => Fact[] {
  return () => {
    const argv = cmd ?? ["bash", path.join(root, "plugin", "scripts", "closure-lag-check.sh"), "--close-terminal", "--json"];
    const parsed = runJson(argv, root);
    const v = parsed && typeof parsed === "object" ? parseClosureTerminal(JSON.stringify(parsed)) : null;
    return [factOf("closure_pass", v, "closure pass unreadable/unparseable")];
  };
}

/** B2 · 留痕：`closure-lag-check.sh --record --flipped <N>`（零收尾也写 0）。 */
export function closureRecordRoutine(root: string, flipped: number, cmd: string[] | null): () => Fact[] {
  return () => {
    const argv = cmd ?? ["bash", path.join(root, "plugin", "scripts", "closure-lag-check.sh"), "--record", "--flipped", String(flipped)];
    const r = runExit(argv, root);
    if (!r.ok) return [{ name: "closure_record", value: null, state: "not-evaluated", reason: "closure record unreadable" }];
    return [{ name: "closure_record", value: { exit: r.exit, flipped }, state: "verified", reason: null }];
  };
}

/** B6 · 落盘聚合：`fast-mode-telemetry.ts --snapshot`。 */
export function telemetrySnapshotRoutine(root: string, cmd: string[] | null): () => Fact[] {
  return () => {
    const argv = cmd ?? ["node", "--no-warnings", "--experimental-strip-types",
      path.join(root, "plugin", "scripts", "fast-mode-telemetry.ts"), "--snapshot", "--root", root];
    const r = runExit(argv, root);
    if (!r.ok) return [{ name: "telemetry_snapshot", value: null, state: "not-evaluated", reason: "telemetry snapshot unreadable" }];
    return [{ name: "telemetry_snapshot", value: { exit: r.exit }, state: "verified", reason: null }];
  };
}

/** B17 · 判据消费审计：`judgment-consumer-check.ts --json` → wired/unfinished/drift。 */
export function judgmentConsumerRoutine(root: string, cmd: string[] | null): () => Fact[] {
  return () => {
    const argv = cmd ?? ["node", "--no-warnings", "--experimental-strip-types",
      path.join(root, "plugin", "scripts", "judgment-consumer-check.ts"), "--json"];
    const parsed = runJson(argv, root);
    const v = parsed && typeof parsed === "object" ? parseJudgmentConsumer(JSON.stringify(parsed)) : null;
    return [factOf("judgment_consumer", v, "judgment-consumer-check unreadable/unparseable")];
  };
}

// ── 例程表（Layer 1b：RoutineSpec[]，全部「每轮必跑」） ────────────────────────────────────────────

/** 装配 outer 的例程表。所有例程的 schedule 都是「每轮必跑」（outer 的 A/B 段是每 tick 必跑）；
 *  schedule 字段保留供未来把低频例程（如 B17 每 N 轮）分化出来。cmd 覆盖是测试缝（同 promotion 的
 *  --ready-pool-cmd），缺省用真实命令。 */
export function outerRoutines(root: string, opts: {
  readyPoolCmd?: string[] | null;
  slotRefillCmd?: string[] | null;
  closureLagCmd?: string[] | null;
  closurePassCmd?: string[] | null;
  closureRecordCmd?: string[] | null;
  telemetryCmd?: string[] | null;
  judgmentConsumerCmd?: string[] | null;
} = {}): RoutineSpec[] {
  return [
    { name: "occupancy", schedule: EVERY_ROUND, run: occupancyRoutine(root, opts.slotRefillCmd ?? null) },
    { name: "not_yet_flipped", schedule: EVERY_ROUND, run: notYetFlippedRoutine(root, opts.readyPoolCmd ?? null) },
    { name: "closure_lag", schedule: EVERY_ROUND, run: closureLagRoutine(root, opts.closureLagCmd ?? null) },
    { name: "slot_refill", schedule: EVERY_ROUND, run: slotRefillRoutine(root, opts.slotRefillCmd ?? null) },
    { name: "liveness_direct", schedule: EVERY_ROUND, run: livenessDirectRoutine(root) },
    { name: "closure_pass", schedule: EVERY_ROUND, run: closurePassRoutine(root, opts.closurePassCmd ?? null) },
    // B2 的 flipped=N 依赖 A9 的 not-yet-flipped 计数——但「零收尾也写 0」；本轮先按 0 写（真实计数由
    // 下一轮/manager 消费 A9 读数后回填；⛔ 不把「写 0」伪装成「真计数」，reason 里标记）。
    { name: "closure_record", schedule: EVERY_ROUND, run: closureRecordRoutine(root, 0, opts.closureRecordCmd ?? null) },
    { name: "telemetry_snapshot", schedule: EVERY_ROUND, run: telemetrySnapshotRoutine(root, opts.telemetryCmd ?? null) },
    { name: "judgment_consumer", schedule: EVERY_ROUND, run: judgmentConsumerRoutine(root, opts.judgmentConsumerCmd ?? null) },
  ];
}

// ── 常驻循环（Layer 0 循环 + 1b 例程） ────────────────────────────────────────────────────────────

/** 常驻循环的选项（`main` 装配后传入）。 */
export interface ResidentOuterLoopOptions {
  root: string;
  intervalMs: number;
  once: boolean;
  maxRounds: number | null;
  roundLogFile: string;
  runId: string;
  json: boolean;
  pidFile?: string;
  routines: RoutineSpec[];
}

/** 一条 round 记录（字段：ts · round · run_id · pid · action · facts · halted）。action ∈
 *  facts | halted | error。facts = 本轮各例程的结构化读数（Fact[]）。 */
export function computeOuterRoundRecord(opts: {
  round: number;
  runId: string;
  pid: number;
  at: string;
  facts: Fact[];
  halted: boolean;
  error: string | null;
}) {
  return {
    ts: opts.at,
    round: opts.round,
    run_id: opts.runId,
    pid: opts.pid,
    action: opts.error ? "error" : opts.halted ? "halted" : "facts",
    facts: opts.facts,
    halted: opts.halted,
    error: opts.error,
  };
}

/** 跑常驻循环：每轮跑一遍例程（collectFacts）→ 写 round 记录 → 按间隔进入下一轮，直到信号停机或
 *  --once/--max-rounds。halted ⇒ 写一条 halted round 后退出（与 promotion/worker 同族）。 */
export async function runResidentOuterLoop(opts: ResidentOuterLoopOptions): Promise<number> {
  const { root, intervalMs, once, maxRounds, roundLogFile, runId, json, pidFile, routines } = opts;

  if (pidFile) {
    try { fs.writeFileSync(pidFile, `${process.pid}\n`, "utf8"); } catch { /* pid-file 只供外部观测 */ }
  }

  let stopRequested = false;
  let wakeResolve: (() => void) | null = null;
  const requestStop = () => { stopRequested = true; if (wakeResolve) { const w = wakeResolve; wakeResolve = null; w(); } };
  process.on("SIGINT", requestStop);
  process.on("SIGTERM", requestStop);

  const sleep = (ms: number) => new Promise<void>((resolve) => {
    wakeResolve = resolve;
    setTimeout(() => { if (wakeResolve === resolve) wakeResolve = null; resolve(); }, ms);
  });

  let round = 0;
  let selfStopCounter = 0;
  while (!stopRequested) {
    round += 1;
    // 控制面：起新一轮前读控制态（.quay/outer-control.json 单一真相源）。halted ⇒ 写 halted round 退出。
    if (isHalted(root, process.env, OUTER_CONTROL_STATE_REL)) {
      const record = computeOuterRoundRecord({ round, runId, pid: process.pid, at: ts(), facts: [], halted: true, error: null });
      try { appendHeartbeatLine(roundLogFile, record); } catch { /* 日志写失败不致命 */ }
      if (json) process.stdout.write(`${JSON.stringify({ event: "halted", round })}\n`);
      break;
    }

    // 例程调度（Layer 1b schedule）：每轮跑 due 的例程。全部是 EVERY_ROUND ⇒ 每轮全跑。
    const due = routines.filter((r) => scheduleIsDue(r.schedule, { iteration: round }));
    let facts: Fact[] = [];
    try {
      facts = await collectFacts(due);
    } catch {
      // collectFacts 里某个 run() 抛了（⛔ 各 run 自身应吞错，但兜底不炸循环）。
      facts = [{ name: "collect", value: null, state: "not-evaluated", reason: "collectFacts threw" }];
    }

    // B12 自身停止条件：本轮是否推进了任务状态 = 收尾 pass（B1）实际闭合的终态括号数 > 0。
    // ⛔ 进展信号取 B1 的 closed 计数（直接量：闭合了几个终态括号），不是「跑没跑成」的退出码、也不是
    // 心跳/自报量（硬规则 4b）。closure_pass 读不到（not-evaluated）⇒ 视为无进展（fail-closed 方向）。
    const closurePass = facts.find((f) => f.name === "closure_pass");
    const closedCount =
      closurePass && closurePass.state === "verified" && closurePass.value && typeof closurePass.value === "object"
        ? Number((closurePass.value as { closed?: number }).closed ?? 0)
        : 0;
    const progress = Number.isFinite(closedCount) && closedCount > 0;
    const selfStop = computeSelfStop(selfStopCounter, progress);
    selfStopCounter = selfStop.counter;
    if (selfStop.shouldStop) {
      facts.push({ name: "self_stop", value: { counter: selfStop.counter }, state: "failed", reason: "consecutive 3 rounds no task progress (0 terminal brackets closed)" });
    } else {
      facts.push({ name: "self_stop", value: { counter: selfStop.counter }, state: "verified", reason: null });
    }

    const record = computeOuterRoundRecord({ round, runId, pid: process.pid, at: ts(), facts, halted: false, error: null });
    try { appendHeartbeatLine(roundLogFile, record); } catch { /* 日志写失败不致命 */ }
    if (json) process.stdout.write(`${JSON.stringify({ event: "round", ...record })}\n`);

    if (once) break;
    if (maxRounds !== null && round >= maxRounds) break;
    await sleep(intervalMs);
  }

  if (json && stopRequested) {
    process.stdout.write(`${JSON.stringify({ event: "stop", reason: "signal", round })}\n`);
  }
  return 0;
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────

const HELP = [
  "outer-driver — AC143：常驻循环，每轮跑一遍 outer 纯机械 A/B 段（读数/收尾/自查）例程，把结构化",
  "读数（Fact）写进 .quay/outer-round.jsonl。跑完一轮不退出、按 --interval 进入下一轮。SIGINT/SIGTERM 优雅停机。",
  "  --root <repo> [--interval <ms>] [--once] [--max-rounds <n>] [--round-log <p>] [--run-id <id>]",
  "  [--pid-file <p>] [--json]",
  "  --interval <ms>       轮间隔（缺省 30000；测试缝传小值）",
  "  --once                跑一轮即退出（手动单发 / 测试）",
  "  --max-rounds <n>      跑满 N 轮退出（测试缝）",
  "  --round-log <path>    轮记录文件（缺省 <root>/.quay/outer-round.jsonl）",
  "  --run-id <id>         轮记录里的 run_id（缺省 outer-<epoch>）",
  "  --pid-file <path>     把驱动自身 pid 写到该文件",
  "  --json                每轮向 stdout 打一条 JSON 事件行",
].join("\n");

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  let root: string | undefined;
  let intervalRaw: string | undefined;
  let once = false;
  let maxRounds: number | null = null;
  let roundLogPath: string | undefined;
  let runId: string | undefined;
  let json = false;
  let pidFile: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") root = args[++i];
    else if (a === "--interval") intervalRaw = args[++i];
    else if (a === "--once") once = true;
    else if (a === "--max-rounds") maxRounds = Number(args[++i]);
    else if (a === "--round-log") roundLogPath = args[++i];
    else if (a === "--run-id") runId = args[++i];
    else if (a === "--pid-file") pidFile = args[++i];
    else if (a === "--json") json = true;
    else if (a === "--help" || a === "-h") { console.log(HELP); return 0; }
    else { console.error(`outer-driver: unknown argument: ${a}`); return 2; }
  }

  const rootDir = root ? path.resolve(root) : path.resolve(process.cwd());

  let intervalMs: number;
  if (intervalRaw === undefined) {
    intervalMs = loadDriverConfig(rootDir).outer.intervalMs;
  } else {
    const n = Number(intervalRaw);
    if (!Number.isFinite(n) || n < 0) { console.error(`outer-driver: invalid --interval: ${intervalRaw}`); return 2; }
    intervalMs = n;
  }
  if (maxRounds !== null && (!Number.isInteger(maxRounds) || maxRounds < 1)) {
    console.error("outer-driver: --max-rounds must be a positive integer");
    return 2;
  }

  const roundLogFile = roundLogPath ? path.resolve(roundLogPath) : path.join(rootDir, ROUND_LOG_REL);
  const resolvedRunId = runId || `outer-${Math.floor(Date.now() / 1000)}`;

  return runResidentOuterLoop({
    root: rootDir,
    intervalMs,
    once,
    maxRounds,
    roundLogFile,
    runId: resolvedRunId,
    json,
    pidFile,
    routines: outerRoutines(rootDir),
  });
}

// Direct entry guard (gate-script-base convention)：仅当本文件是入口时跑 main()。
if (isDirectEntry(import.meta, undefined, "outer-driver")) {
  main(process.argv).then((code) => { process.exitCode = code; });
}
