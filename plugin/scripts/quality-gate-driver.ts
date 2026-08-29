// plugin/scripts/quality-gate-driver.ts — AC144: 质量把关按【形状】分开驱动化。
// (tasks/gap-ac144-quality-gate-shape-separated-driver)
//
// WHY THIS EXISTS（manager-phase-goal.md ### AC144）：「质量把关」不是一件事——一股脑并入
// promotion-driver 会造 god-object（其 scope 是任务合格化，不是冲突解析/止损判断）。本 driver 是
// 【例程型】kind（继承 Layer 0 + 1b，同 manager-kind AC143），只承接四种形状里【可机械/机械触发】的
// 两件，其余两件结构上不能是 driver（driver 读不出「听起来自洽但错了」的因果故事）：
//
//   B15 pool 质量语义闸   机械触发 + LLM judge + JS 聚合（ADR-033）⇒ 本 driver 跑
//                         （原调用方 = outer tick 的 B15 步，本任务把调用方换成 driver）
//   B17 判据消费纪律       纯机械审计（judgment-consumer-check.ts）⇒ 本 driver 跑
//   B16-C 冲突意图        要读两边意图 ⇒ ⛔ 不在本 driver，归 AC145 语义面 subagent
//   B18 止损义务          对一个【活场景】的判断 ⇒ ⛔ 不在本 driver，归 AC145 语义面 subagent
//
// 取假（AC1，一条命令可验）：
//   ① 上述四项被并入同一个 driver kind ⇒ 假（god-object）。本文件只有 B15/B17 两条例程；
//      B16-C/B18 的归属指针在 orchestration/manager-phase-goal.md（归 AC145），本文件不写它们的
//      执行路径（grep 本文件无「B16-C」「B18」的运行分支）。
//   ② B16-C / B18 被声称「已驱动化」而无 LLM 参与 ⇒ 假。本文件的 LLM 参与只有 B15 的 judge spawn
//      （launchArgv role=pool-judge）；B16-C/B18 没有机械运行路径，谈不上「伪装成机械判断」。
//
// 分层（AC151 两级抽象）：
//   - 本文件继承 Layer 0（driver-runtime：launchArgv / isHalted / resourceGateCheck / 心跳 append）
//     与 Layer 1b（routine 契约：RoutineSpec / Fact / scheduleIsDue）。
//   - ⛔ 不继承 Layer 1a（无候选池 source / 无任务选择 select / 无 verify 复核）——本 driver 的单元
//     是【例程】不是【任务】，产出是【读数】不是【任务终态】（manager-kind 同款判据，SPEC §2.1）。

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";
// Layer 0（driver-runtime 单一实现）：DRIVER_KINDS registry（controlFile/carriers 单源）、launchArgv
// （LLM judge spawn）、isHalted / resourceGateCheck（判停/资源门）。Layer 1b：RoutineSpec / Fact /
// scheduleIsDue（例程契约）。⛔ 不从 worker/promotion-driver 中转（两 driver 平级继承同一层）。
import {
  DRIVER_KINDS,
  launchArgv,
  scheduleIsDue,
  isHalted,
  resourceGateCheck,
  type Fact,
  type RoutineSpec,
} from "./driver-runtime.ts";
// B15 判词聚合的单一实现（ADR-033：判定用 agent、聚合用 JS 算术）。⛔ 不复制一份平行版本——
// should-remove → remove-or-rescope 的路由表只有一个（pool-quality-judge.ts actionFor）。
import { aggregateVerdicts, type VerdictRecord } from "./pool-quality-judge.ts";
// AC155：轮询间隔的单一真相源（drivers.yml 经 driver-config 加载，⛔ 不各写一份字面量——同
// outer-driver / promotion-driver 的接法）。quality 段由此前的「字面量 60_000」改为从
// loadDriverConfig(root).quality.intervalMs 派生（缺省 30000，与 outer 例程型 kind 对齐）。
import { defaultDriverConfig, loadDriverConfig } from "./driver-config.ts";

// ── 常量（由 DRIVER_KINDS registry 派生，⛔ 不另写一份路径字面量）──────────────────────────
const QUALITY_SPEC = DRIVER_KINDS.quality;
/** 轮记录载体（.quay/quality-round.jsonl，gitignored 运行时日志——heartbeat，与 round 记录同族）。 */
export const ROUND_LOG_REL = QUALITY_SPEC.carriers[0];
/** 控制态文件（.quay/quality-control.json，halt 单一真相源，与 promotion/worker-control.json 同族）。 */
export const QUALITY_CONTROL_STATE_REL = path.posix.join(".quay", QUALITY_SPEC.controlFile);

/** 轮间隔缺省（毫秒）。AC155：值从 drivers.yml 派生（单一真相源，同 outer/promotion 的接法）；
 *  AC144 判据不设数值阈值（硬规则 4）——此值只是例程驱动的占位节奏，生产部署由启动命令传
 *  --interval 覆盖；测试传小值。 */
export const INTERVAL_MS_DEFAULT = defaultDriverConfig().quality.intervalMs;

/** 两条例程各自的缺省复核间隔（分钟）。同上——占位节奏，非未测量过的阈值。 */
export const POOL_JUDGE_INTERVAL_MIN_DEFAULT = 10;
export const JUDGMENT_INTERVAL_MIN_DEFAULT = 30;

/** 单次 spawn 的 wall-clock 上限（毫秒）。LLM judge spawn 与 mechanical plan/audit spawn 共用
 *  一个上限（⛔ 不为 judge 另设阈值——硬规则 4 推论；与 promotion-driver 的 ROUND_TIMEOUT_MS 同族）。 */
export const ROUTINE_TIMEOUT_MS = 180_000;

// ── B17 · 判据消费纪律（纯机械审计）────────────────────────────────────────────────────────

/** 缺省 judgment-consumer-check 命令（--json 机器面）。输出 = audit report JSON。 */
export function defaultJudgmentConsumerArgv(root: string): string[] {
  return [
    "node", "--experimental-strip-types",
    path.join(root, "plugin", "scripts", "judgment-consumer-check.ts"),
    "--root", root, "--json",
  ];
}

/** B17 读数的值面（写进 round record 的 fact.value）。drift=true ⇒ 有判据声明 wired 而消费动作缺失。 */
export interface JudgmentConsumerFactValue {
  mode: string;
  judgmentsTotal: number;
  wired: number;
  unfinished: string[];
  drift: boolean;
}

/** 解析 judgment-consumer-check --json 输出。读不懂 ⇒ null（调用方记 not-evaluated，⛔ 不伪装合格）。 */
export function parseJudgmentConsumerReport(stdout: string): JudgmentConsumerFactValue | null {
  try {
    const j = JSON.parse(String(stdout ?? "").trim());
    if (j && j.mode === "judgment-consumer-audit" && Array.isArray(j.unfinished)) {
      return {
        mode: j.mode,
        judgmentsTotal: typeof j.judgments_total === "number" ? j.judgments_total : 0,
        wired: typeof j.wired === "number" ? j.wired : 0,
        unfinished: j.unfinished.filter((x: unknown) => typeof x === "string"),
        drift: !!j.drift,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** B17 例程：跑一次判据消费审计。exit 0（无 drift）⇒ verified；exit 1（drift）⇒ failed；
 *  exit 2 / spawn 失败 / 读不懂 ⇒ not-evaluated（硬规则 3b：读不懂 ≠ 合格）。 */
export function runJudgmentConsumerCheck(root: string, cmd: string[] | null): Fact<JudgmentConsumerFactValue | null> {
  const argv = cmd ?? defaultJudgmentConsumerArgv(root);
  let r: ReturnType<typeof spawnSync>;
  try {
    r = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", timeout: ROUTINE_TIMEOUT_MS });
  } catch (e) {
    return { name: "judgment-consumer-check", value: null, state: "not-evaluated", reason: `spawn failed: ${(e as Error).message}` };
  }
  if (r.error) {
    return { name: "judgment-consumer-check", value: null, state: "not-evaluated", reason: `spawn error: ${r.error.message}` };
  }
  const value = parseJudgmentConsumerReport(r.stdout ?? "");
  if (value === null) {
    return { name: "judgment-consumer-check", value: null, state: "not-evaluated", reason: `unparseable output (exit ${r.status})` };
  }
  if (r.status === 1 || value.drift) {
    return { name: "judgment-consumer-check", value, state: "failed", reason: `drift: ${value.unfinished.length} judgment(s) without a wired consumer` };
  }
  if (r.status !== 0) {
    return { name: "judgment-consumer-check", value, state: "not-evaluated", reason: `exit ${r.status}` };
  }
  return { name: "judgment-consumer-check", value, state: "verified", reason: null };
}

// ── B15 · pool 质量语义闸（机械触发 + LLM judge + JS 聚合）──────────────────────────────────

/** 缺省 pool-quality-judge --plan 命令（机械触发评估 + 池枚举 + 每任务机械 AC 计数，零 LLM）。 */
export function defaultPoolQualityPlanArgv(root: string): string[] {
  return [
    "node", "--no-warnings", "--experimental-strip-types",
    path.join(root, "plugin", "scripts", "pool-quality-judge.ts"),
    "--root", root, "--plan",
  ];
}

/** --plan 输出里本 driver 关心的面（triggers + pool 枚举）。其余字段透传 judge prompt 用。 */
export interface PoolQualityPlan {
  triggers: { fired: boolean; reasons: string[]; poolCount: number; oldestUnreviewedAgeMs: number; roundsSinceLastJudge: number };
  pool: string[];
  tasks: Array<Record<string, unknown>>;
  lastJudgeState: { status: string };
  error?: string;
}

/** 解析 --plan JSON。读不懂/结构不完整 ⇒ null（调用方记 not-evaluated）。 */
export function parsePoolQualityPlan(stdout: string): PoolQualityPlan | null {
  try {
    const j = JSON.parse(String(stdout ?? "").trim());
    if (!j || typeof j.triggers !== "object" || j.triggers === null || !Array.isArray(j.pool)) return null;
    const t = j.triggers;
    return {
      triggers: {
        fired: !!t.fired,
        reasons: Array.isArray(t.reasons) ? t.reasons.filter((x: unknown) => typeof x === "string") : [],
        poolCount: typeof t.poolCount === "number" ? t.poolCount : 0,
        oldestUnreviewedAgeMs: typeof t.oldestUnreviewedAgeMs === "number" ? t.oldestUnreviewedAgeMs : 0,
        roundsSinceLastJudge: typeof t.roundsSinceLastJudge === "number" ? t.roundsSinceLastJudge : 0,
      },
      pool: j.pool.filter((x: unknown) => typeof x === "string"),
      tasks: Array.isArray(j.tasks) ? j.tasks : [],
      lastJudgeState: j.lastJudgeState && typeof j.lastJudgeState.status === "string" ? j.lastJudgeState : { status: "unknown" },
      error: typeof j.error === "string" ? j.error : undefined,
    };
  } catch {
    return null;
  }
}

/** B15 judge prompt（单个 `claude -p` worker 判整个 pool；机械输入来自 --plan，判定交给 LLM——ADR-033）。
 *  ⛔ 不按任务拆 schema agent（那是 Workflow 工具的形态，driver 进程没有）——本 driver 用单一批判
 *  `claude -p`，输出 JSON 数组，聚合仍走 pool-quality-judge.ts 的单一 JS 算术。 */
function poolJudgePrompt(plan: PoolQualityPlan, root: string): string {
  const ids = plan.pool.join(", ");
  return [
    `You are the pool-quality gate for the quay task pool (ADR-033: mechanical script only counts AC boxes; the VERDICT is your semantic job).`,
    `Repo root: ${root}. Pool task ids: ${ids || "(empty)"}.`,
    `Mechanical input per task (trust it as arithmetic, NOT a verdict): ${JSON.stringify(plan.tasks)}.`,
    `For EACH pool task, read ${root}/tasks/<id>.md and decide ONE verdict:`,
    `  ready        — work truly landed, premise holds, dispatchable.`,
    `  needs-work   — real work remains; premise holds but not finishable as-is.`,
    `  should-remove — PREMISE FALSIFIED (the gap does not exist, or the mechanism was retired/replaced); remove or rescope, NOT dispatch.`,
    `  uncertain    — verification-window ACs or genuinely ambiguous; needs human.`,
    `Reply with ONLY a JSON array, one object per task:`,
    `[{"id":"<id>","verdict":"ready|needs-work|should-remove|uncertain","acCompleteness":"all-checked|partial|none","premiseSound":true|false,"evidence":"<one line>","recommendation":"<one line>"}]`,
  ].join(" ");
}

/** 缺省 B15 judge 命令（launchArgv role=pool-judge → 短命 claude -p，AC140 单一构造点）。 */
export function defaultPoolJudgeArgv(plan: PoolQualityPlan, root: string): string[] {
  return launchArgv("pool-judge", poolJudgePrompt(plan, root), root);
}

/** 写端（B15）：judge 完成后持久化 lastRound（every-10-rounds 触发重置）。单写者 = 本 driver 完成路径。 */
function recordLastJudgeRound(root: string): { recorded: boolean; lastRound: number | null } {
  const argv = [
    "node", "--no-warnings", "--experimental-strip-types",
    path.join(root, "plugin", "scripts", "pool-quality-judge.ts"),
    "--root", root, "--record-last-round",
  ];
  try {
    const r = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", timeout: ROUTINE_TIMEOUT_MS });
    if (r.error || r.status !== 0) return { recorded: false, lastRound: null };
    const j = JSON.parse(String(r.stdout ?? "").trim());
    return { recorded: !!j.recorded, lastRound: typeof j.lastRound === "number" ? j.lastRound : null };
  } catch {
    return { recorded: false, lastRound: null };
  }
}

/** B15 读数的值面（写进 round record 的 fact.value）。fired=false ⇒ 本轮机械触发未命中，不 judge。 */
export interface PoolQualityFactValue {
  fired: boolean;
  reasons: string[];
  poolCount: number;
  distribution: { ready: number; "needs-work": number; "should-remove": number; uncertain: number } | null;
  shouldRemoveIds: string[];
  lastJudgeRecorded: number | null;
}

/** B15 例程：机械触发（--plan）→ 命中则 LLM judge → JS 聚合（aggregateVerdicts 单一实现）→
 *  写端（--record-last-round）。读不懂 --plan ⇒ not-evaluated（硬规则 3b）；judge 失败 ⇒ failed；
 *  未命中 ⇒ verified（查过且无需 judge——fired=false 是真实测量，非「读不懂装合格」）。 */
export function runPoolQualityJudge(
  root: string,
  planCmd: string[] | null,
  judgeArgv: string[] | null,
  resourceGateArgv: string[] | null = null,
): Fact<PoolQualityFactValue | null> {
  const planArgv = planCmd ?? defaultPoolQualityPlanArgv(root);
  let planR: ReturnType<typeof spawnSync>;
  try {
    planR = spawnSync(planArgv[0], planArgv.slice(1), { encoding: "utf8", timeout: ROUTINE_TIMEOUT_MS });
  } catch (e) {
    return { name: "pool-quality-judge", value: null, state: "not-evaluated", reason: `plan spawn failed: ${(e as Error).message}` };
  }
  if (planR.error) {
    return { name: "pool-quality-judge", value: null, state: "not-evaluated", reason: `plan spawn error: ${planR.error.message}` };
  }
  const plan = parsePoolQualityPlan(planR.stdout ?? "");
  if (plan === null) {
    return { name: "pool-quality-judge", value: null, state: "not-evaluated", reason: `unparseable --plan output (exit ${planR.status})` };
  }
  const base: PoolQualityFactValue = {
    fired: plan.triggers.fired,
    reasons: plan.triggers.reasons,
    poolCount: plan.triggers.poolCount,
    distribution: null,
    shouldRemoveIds: [],
    lastJudgeRecorded: null,
  };
  if (!plan.triggers.fired) {
    return { name: "pool-quality-judge", value: base, state: "verified", reason: `not-triggered (${plan.triggers.reasons.length} reasons: ${plan.triggers.reasons.join(",") || "none"})` };
  }
  // 资源门（AC150-1 同族）：spawn LLM judge 前经 resourceGateCheck 判定，WAIT ⇒ 退避本轮（⛔ 机械 --plan
  // 不受约束，零 LLM）。资源门 WAIT 是瞬时态（⛔ 不 latch），下一轮重读。resourceGateArgv = 测试缝。
  const gate = resourceGateCheck(root, resourceGateArgv);
  if (!gate.go) {
    return { name: "pool-quality-judge", value: base, state: "not-evaluated", reason: `resource-gate-wait: ${gate.reason} (judge deferred)` };
  }
  const argv = judgeArgv ?? defaultPoolJudgeArgv(plan, root);
  let judgeR: ReturnType<typeof spawnSync>;
  try {
    judgeR = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", timeout: ROUTINE_TIMEOUT_MS });
  } catch (e) {
    return { name: "pool-quality-judge", value: base, state: "failed", reason: `judge spawn failed: ${(e as Error).message}` };
  }
  if (judgeR.error || judgeR.status !== 0) {
    return { name: "pool-quality-judge", value: base, state: "failed", reason: `judge exited ${judgeR.status ?? "null"}: ${judgeR.error?.message ?? String(judgeR.stderr ?? "").slice(0, 200)}` };
  }
  let verdicts: VerdictRecord[];
  try {
    const parsed = JSON.parse(String(judgeR.stdout ?? "").trim());
    verdicts = Array.isArray(parsed) ? parsed : [];
  } catch {
    return { name: "pool-quality-judge", value: base, state: "failed", reason: "judge output not a JSON array" };
  }
  // JS 聚合（单一实现 aggregateVerdicts——should-remove → remove-or-rescope 路由）。
  const agg = aggregateVerdicts(verdicts);
  const recorded = recordLastJudgeRound(root);
  return {
    name: "pool-quality-judge",
    value: {
      ...base,
      distribution: agg.distribution,
      shouldRemoveIds: agg.shouldRemoveIds,
      lastJudgeRecorded: recorded.recorded ? recorded.lastRound : null,
    },
    state: "verified",
    reason: `judged ${verdicts.length} task(s): ready=${agg.distribution.ready} needs-work=${agg.distribution["needs-work"]} should-remove=${agg.distribution["should-remove"]} uncertain=${agg.distribution.uncertain}`,
  };
}

// ── 例程表（Layer 1b：routines = [{name, schedule, run() → Facts}]）──────────────────────────

/** 例程装配缝（测试可注入覆盖命令/间隔；缺省 = 生产缺省）。 */
export interface QualityGateOptions {
  planCmd: string[] | null;
  judgeArgv: string[] | null;
  judgmentCmd: string[] | null;
  resourceGateArgv: string[] | null;
  poolJudgeIntervalMinutes: number;
  judgmentIntervalMinutes: number;
}

/** 两条例程（B15 pool-quality-judge + B17 judgment-consumer-check）。⛔ 只此两条——B16-C/B18 归 AC145。 */
export function qualityGateRoutines(root: string, opts: QualityGateOptions): RoutineSpec[] {
  return [
    {
      name: "pool-quality-judge",
      schedule: { kind: "interval", minutes: opts.poolJudgeIntervalMinutes },
      run: () => [runPoolQualityJudge(root, opts.planCmd, opts.judgeArgv, opts.resourceGateArgv)],
    },
    {
      name: "judgment-consumer-check",
      schedule: { kind: "interval", minutes: opts.judgmentIntervalMinutes },
      run: () => [runJudgmentConsumerCheck(root, opts.judgmentCmd)],
    },
  ];
}

// ── 常驻循环（例程型：每轮评估 due 例程 → 跑 due → 汇集 Facts → 写 round 心跳）────────────────

/** 常驻循环选项（main 装配后传入）。 */
export interface QualityGateLoopOptions {
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

/** 组装一条 round 记录（heartbeat carrier 的一行）。facts 是轮内跑出的全部例程读数。 */
export function computeRoundRecord(args: {
  round: number;
  runId: string;
  pid: number;
  at: string;
  facts: Fact<unknown>[];
  halted?: boolean;
}): Record<string, unknown> {
  const { round, runId, pid, at, facts, halted = false } = args;
  return { round, run_id: runId, pid, ts: at, halted, facts };
}

/** 常驻循环：每轮读控制态（halt ⇒ 记 halted 轮退出）→ 评估 due 例程（scheduleIsDue + 内存 lastRun）→
 *  跑 due 例程 → 汇集 Facts → 写 round 心跳。SIGINT/SIGTERM / --once / --max-rounds 停。
 *  lastRun 是进程内存态（例程 interval 调度用）；重启 ⇒ never-ran ⇒ 首轮两例程均 due（该跑）。 */
export async function runResidentQualityGateLoop(opts: QualityGateLoopOptions): Promise<number> {
  const { root, intervalMs, once, maxRounds, roundLogFile, runId, json, pidFile, routines } = opts;
  if (pidFile) {
    try { fs.writeFileSync(pidFile, `${process.pid}\n`, "utf8"); } catch { /* pid-file 只供外部观测，写失败不致命 */ }
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

  const lastRun: Record<string, number> = {};
  let round = 0;
  while (!stopRequested) {
    round += 1;
    // 控制面（halt）：读 .quay/quality-control.json 单一真相源，halted ⇒ 记 halted 轮后退出。
    if (isHalted(root, process.env, QUALITY_CONTROL_STATE_REL)) {
      const rec = computeRoundRecord({ round, runId, pid: process.pid, at: new Date().toISOString(), facts: [], halted: true });
      try { fs.appendFileSync(roundLogFile, JSON.stringify(rec) + "\n", "utf8"); } catch { /* 记录写失败不致命 */ }
      if (json) process.stdout.write(`${JSON.stringify({ event: "halted", round })}\n`);
      break;
    }
    const facts: Fact<unknown>[] = [];
    for (const r of routines) {
      const state = { now: Date.now(), lastRun: lastRun[r.name] };
      if (!scheduleIsDue(r.schedule, state)) continue;
      lastRun[r.name] = state.now;
      try {
        facts.push(...(await r.run()));
      } catch (e) {
        facts.push({ name: r.name, value: null, state: "failed", reason: `routine threw: ${(e as Error).message}` });
      }
    }
    const rec = computeRoundRecord({ round, runId, pid: process.pid, at: new Date().toISOString(), facts });
    try {
      fs.mkdirSync(path.dirname(roundLogFile), { recursive: true });
      fs.appendFileSync(roundLogFile, JSON.stringify(rec) + "\n", "utf8");
    } catch { /* 记录写失败不致命（运行时日志，⛔ 不因日志炸循环） */ }
    if (json) process.stdout.write(`${JSON.stringify({ event: "round", ...rec })}\n`);
    if (once) break;
    if (maxRounds !== null && round >= maxRounds) break;
    await sleep(intervalMs);
  }
  if (json && stopRequested) {
    process.stdout.write(`${JSON.stringify({ event: "stop", reason: "signal", round })}\n`);
  }
  return 0;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────

const HELP = [
  "quality-gate-driver — AC144：质量把关按【形状】分开驱动化（例程型，继承 Layer 0 + 1b）。",
  "每轮评估 due 例程（B15 pool-quality-judge + B17 judgment-consumer-check）→ 跑 due → 汇集 Facts → 写 round 心跳。",
  "  --root <repo> [--interval <ms>] [--once] [--max-rounds <n>] [--round-log <p>] [--run-id <id>] [--pid-file <p>] [--json]",
  "  --interval <ms>           轮间隔（缺省 30000，来自 drivers.yml quality.interval_ms；测试缝传小值）",
  "  --once                    跑一轮即退出（手动单发 / 测试）",
  "  --max-rounds <n>          跑满 N 轮退出（测试缝，防常驻环无限跑）",
  "  --pool-judge-interval <m> B15 例程复核间隔（分钟，缺省 10）",
  "  --judgment-interval <m>   B17 例程复核间隔（分钟，缺省 30）",
  "  --plan-cmd <argv>         覆盖 --plan 命令（测试缝）",
  "  --judge-cmd <argv>        覆盖 LLM judge 命令（测试缝；prompt 由驱动拼，末参数追加）",
  "  --judgment-cmd <argv>     覆盖 judgment-consumer-check 命令（测试缝）",
  "  --resource-gate-cmd <argv> 覆盖 resource-gate 命令（测试缝；起 judge 前判定，exit 0=GO）",
  "  --round-log <path>        轮记录文件（缺省 <root>/.quay/quality-round.jsonl）",
  "  --pid-file <path>         把驱动自身 pid 写到该文件（外部观测 + kill 抓手）",
  "  --json                    每轮向 stdout 打一条 JSON 事件行",
].join("\n");

/** 空格分隔 argv 切分（与 driver-runtime.splitArgs 同族；测试缝注入覆盖命令）。 */
export function splitArgs(cmd: string): string[] {
  return cmd.trim().split(/\s+/).filter(Boolean);
}

function isNonNegInt(s: string): boolean {
  return /^\d+$/.test(s);
}

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  let root: string | undefined;
  let intervalRaw: string | undefined;
  let once = false;
  let maxRounds: number | null = null;
  let roundLogPath: string | undefined;
  let runId: string | undefined;
  let pidFile: string | undefined;
  let json = false;
  let poolJudgeIntervalRaw: string | undefined;
  let judgmentIntervalRaw: string | undefined;
  let planCmd: string | undefined;
  let judgeCmd: string | undefined;
  let judgmentCmd: string | undefined;
  let resourceGateCmd: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") root = args[++i];
    else if (a === "--interval") intervalRaw = args[++i];
    else if (a === "--once") once = true;
    else if (a === "--max-rounds") maxRounds = Number(args[++i]);
    else if (a === "--round-log") roundLogPath = args[++i];
    else if (a === "--run-id") runId = args[++i];
    else if (a === "--pid-file") pidFile = args[++i];
    else if (a === "--pool-judge-interval") poolJudgeIntervalRaw = args[++i];
    else if (a === "--judgment-interval") judgmentIntervalRaw = args[++i];
    else if (a === "--plan-cmd") planCmd = args[++i];
    else if (a === "--judge-cmd") judgeCmd = args[++i];
    else if (a === "--judgment-cmd") judgmentCmd = args[++i];
    else if (a === "--resource-gate-cmd") resourceGateCmd = args[++i];
    else if (a === "--json") json = true;
    else if (a === "--help" || a === "-h") { console.log(HELP); return 0; }
    else { console.error(`quality-gate-driver: unknown argument: ${a}`); return 2; }
  }

  const rootDir = root ? path.resolve(root) : path.resolve(process.cwd());
  const interval = intervalRaw !== undefined && isNonNegInt(intervalRaw) ? Number(intervalRaw) : loadDriverConfig(rootDir).quality.intervalMs;
  if (maxRounds !== null && (!Number.isInteger(maxRounds) || maxRounds < 1)) {
    console.error("quality-gate-driver: --max-rounds must be a positive integer");
    return 2;
  }
  const poolJudgeIntervalMinutes = poolJudgeIntervalRaw !== undefined && isNonNegInt(poolJudgeIntervalRaw)
    ? Number(poolJudgeIntervalRaw) : POOL_JUDGE_INTERVAL_MIN_DEFAULT;
  const judgmentIntervalMinutes = judgmentIntervalRaw !== undefined && isNonNegInt(judgmentIntervalRaw)
    ? Number(judgmentIntervalRaw) : JUDGMENT_INTERVAL_MIN_DEFAULT;

  const roundLogFile = roundLogPath ? path.resolve(roundLogPath) : path.join(rootDir, ROUND_LOG_REL);
  const resolvedRunId = runId || `qg-${Date.now()}`;
  const routines = qualityGateRoutines(rootDir, {
    planCmd: planCmd ? splitArgs(planCmd) : null,
    judgeArgv: judgeCmd ? splitArgs(judgeCmd) : null,
    judgmentCmd: judgmentCmd ? splitArgs(judgmentCmd) : null,
    resourceGateArgv: resourceGateCmd ? splitArgs(resourceGateCmd) : null,
    poolJudgeIntervalMinutes,
    judgmentIntervalMinutes,
  });

  return runResidentQualityGateLoop({ root: rootDir, intervalMs: interval, once, maxRounds, roundLogFile, runId: resolvedRunId, json, pidFile, routines });
}

// Direct entry guard (gate-script-base convention)：仅当本文件是入口时跑 main()。
if (isDirectEntry(import.meta, undefined, "quality-gate-driver")) {
  main(process.argv).then((code) => { process.exitCode = code; });
}
