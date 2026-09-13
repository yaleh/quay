// plugin/scripts/quality-gate-driver.ts — AC144: 质量把关按【形状】分开驱动化。
// (tasks/gap-ac144-quality-gate-shape-separated-driver)
//
// WHY THIS EXISTS（manager-phase-goal.md ### AC144）：「质量把关」不是一件事——一股脑并入
// promotion-driver 会造 god-object（其 scope 是任务合格化，不是冲突解析/止损判断）。本 driver 是
// 【例程型】kind（继承 Layer 0 + 1b，同 manager-kind AC143），只承接四种形状里【可机械/机械触发】的
// 两件，其余两件结构上不能是 driver（driver 读不出「听起来自洽但错了」的因果故事）；另承接第三条例程
// ——架构复核（gap-quality-driver-architecture-review-routine：把 P1/P2/P4 三个检测器接上轮子），以及
// 第四条例程——打包卫生常设检查（gap-packaging-hygiene-standing-check：把 config-key-consumer-check
// + shipped-entry-runnable 两个机械检测接上轮子，漂移时 spawn gap-filing agent 经 ABI 立案）：
//
//   B15 pool 质量语义闸   机械触发 + LLM judge + JS 聚合（ADR-033）⇒ 本 driver 跑
//                         （原调用方 = outer tick 的 B15 步，本任务把调用方换成 driver）
//   B17 判据消费纪律       纯机械审计（judgment-consumer-check.ts）⇒ 本 driver 跑
//   架构复核               机械聚类（identity-replication / deletion-closure / guard-lineage 三
//                         检测器 --json）→ LLM judge → JS 合并 → 判词载体 ⇒ 本 driver 跑
//                         ＋ **语义结论 → 立案**（gap-arch-review-judge-verdicts-never-reach-the-
//                         existing-gap-filing-channel：judge 标 actionable=true 的簇 ⇒ 经
//                         quay-file-task 的**机制查重**立 gap 任务；结论键台账节流，同一结论只付费一次）
//   packaging-hygiene     机械两维度检查（config-key 消费者 + shipped-entry 可运行性）→ 漂移非空
//                         ⇒ spawn gap-filing agent（quay-file-task）⇒ 本 driver 跑
//   B16-C 冲突意图        要读两边意图 ⇒ ⛔ 不在本 driver，归 AC145 语义面 subagent
//   B18 止损义务          对一个【活场景】的判断 ⇒ ⛔ 不在本 driver，归 AC145 语义面 subagent
//
// 取假（AC1，一条命令可验）：
//   ① 上述四项被并入同一个 driver kind ⇒ 假（god-object）。本文件只有 B15/B17 + 架构复核 +
//      packaging-hygiene 四条例程；B16-C/B18 的归属指针在 orchestration/manager-phase-goal.md
//      （归 AC145），本文件不写它们的执行路径（grep 本文件无「B16-C」「B18」的运行分支）。
//   ② B16-C / B18 被声称「已驱动化」而无 LLM 参与 ⇒ 假。本文件的 LLM 参与只有 B15 与架构复核的
//      judge spawn（launchArgv role=pool-judge）；B16-C/B18 没有机械运行路径，谈不上「伪装成机械判断」。
//
// 分层（AC151 两级抽象）：
//   - 本文件继承 Layer 0（driver-runtime：launchArgv / isHalted / resourceGateCheck / 心跳 append）
//     与 Layer 1b（routine 契约：RoutineSpec / Fact / scheduleIsDue）。
//   - ⛔ 不继承 Layer 1a（无候选池 source / 无任务选择 select / 无 verify 复核）——本 driver 的单元
//     是【例程】不是【任务】，产出是【读数】不是【任务终态】（manager-kind 同款判据，SPEC §2.1）。

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";
// Layer 0（driver-runtime 单一实现）：DRIVER_KINDS registry（controlFile/carriers 单源）、launchArgv
// （LLM judge spawn）、isHalted / resourceGateCheck（判停/资源门）。Layer 1b：RoutineSpec / Fact /
// scheduleIsDue（例程契约）。⛔ 不从 worker/promotion-driver 中转（两 driver 平级继承同一层）。
import {
  DRIVER_KINDS,
  launchArgv,
  runAsync,
  scheduleIsDue,
  isHalted,
  registerKindStop,
  resourceGateCheck,
  type DriverKind,
  type Fact,
  type RoutineSpec,
} from "./driver-runtime.ts";
// B15 判词聚合的单一实现（ADR-033：判定用 agent、聚合用 JS 算术）。⛔ 不复制一份平行版本——
// should-remove → remove-or-rescope 的路由表只有一个（pool-quality-judge.ts actionFor）。
// 判词载体的写端也在此单一真相源（appendQualityRound / buildQualityRoundRecord）——driver 与
// workflow（--record-round 子命令）都经同一函数写，⛔ 不各写一份（双 writer 同形）。
import {
  aggregateVerdicts,
  appendQualityRound,
  buildQualityRoundRecord,
  qualityRoundVerdicts,
  readCurrentRound,
  type VerdictRecord,
  type QualityRoundRecord,
} from "./pool-quality-judge.ts";
// 架构复核例程的确定性一半（机械聚类纯函数 + 判词载体单一真相源，gap-quality-driver-architecture-
// review-routine）。⛔ 聚类不重新实现三个检测器——只读它们的 --json 输出（本文件负责 spawn）。
import {
  actionableConclusions,
  appendArchReviewRound,
  appendSubmission,
  buildArchReviewRoundRecord,
  clusterDetectorOutputs,
  computeArchReviewTrigger,
  conclusionKey,
  deletionClosureComponents,
  mergeClusterVerdicts,
  readSubmittedKeys,
  unsentConclusions,
  type ArchReviewClusterVerdict,
  type ArchReviewRoundRecord,
  type Cluster,
  type DeletionReportView,
  type IdentityReportView,
  type JudgeClusterVerdict,
  type LineageReportView,
} from "./architecture-review-cluster.ts";
// AC155：轮询间隔的单一真相源（drivers.yml 经 driver-config 加载，⛔ 不各写一份字面量——同
// outer-driver / promotion-driver 的接法）。quality 段由此前的「字面量 60_000」改为从
// loadDriverConfig(root).quality.intervalMs 派生（缺省 30000，与 outer 例程型 kind 对齐）。
import { defaultDriverConfig, loadDriverConfig } from "./driver-config.ts";
// SPEC-capability-planes-and-mechanism-lifecycle §5.2：probe 轨道（`.quay/config.yml` `loop.routines:`
// 的 interval 例程 → 派 fresh-context 探针 → 结构化 finding 落载体）。本 driver 是承载它的活调用点
// （§5.1：⛔ 不为 probe 新造 driver kind——Layer 1b 的 RoutineSpec 已经是 probe 抽象）。
import { PROBE_ROLE_DEFAULT, probeRoutinesFromConfig } from "./probe-routine.ts";

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

/** 四条例程各自的缺省复核间隔（分钟）。同上——占位节奏，非未测量过的阈值。 */
export const POOL_JUDGE_INTERVAL_MIN_DEFAULT = 10;
export const JUDGMENT_INTERVAL_MIN_DEFAULT = 30;
export const ARCH_REVIEW_INTERVAL_MIN_DEFAULT = 60;
export const PACKAGING_HYGIENE_INTERVAL_MIN_DEFAULT = 60;

/** packaging-hygiene 的机械 check spawn 上限（毫秒）——config-key 枚举是纯函数、shipped-entry 是
 *  npm pack --dry-run + dist build（实测 ~2s / ~0.2s），180s 是给足余量的机械上限（⛔ 不是成本阈值，
 *  是 liveness 安全界——同 ROUTINE_TIMEOUT_MS 语义，全部是快速机械 node 调用）。 */
export const PACKAGING_CHECK_TIMEOUT_MS = 180_000;

/** packaging-hygiene gap-filing agent spawn 的 wall-clock 上限【缺省回退值】（毫秒）。gap-filing 角色
 *  （读 drift → 查重 → 撰四件套 → 过 ABI 落盘）与 goal-driver 的 gap-filing 同族——其单次墙钟实测
 *  elapsed_s=602.9（goal-driver GAP_WORKER_TIMEOUT_MS_DEFAULT 的同一实测导出，⛔ 不另起测量），
 *  900_000（900s）> 602.9s 留 ~1.5x 余量。 */
export const PACKAGING_GAP_WORKER_TIMEOUT_MS_DEFAULT = 900_000;

/** 机械 spawn 的 wall-clock 上限（毫秒）——--plan 枚举 / --record-last-round / B17 审计共用（全部是
 *  快速机械 node 调用，非 LLM）。⛔ LLM judge spawn 不设固定上限（runAsync timeoutMs=Infinity，
 *  unbounded）——judge 真实耗时在并发负载下无实测上界，设 180_000 字面量正是
 *  gap-quality-gate-driver-pool-judge-spawn-timeout 的病根（硬规则 4 推论：成本结构未知前不设数值阈值）。 */
export const ROUTINE_TIMEOUT_MS = 180_000;

/** 例程看门狗缺省（毫秒）——【循环】这一侧的 caller 兜底，⛔ 不是 judge 耗时的指标。
 *  judge spawn（runAsync timeoutMs=Infinity）无上限 ⇒ 挂死的 claude 子进程会让常驻循环冻结在
 *  `await r.run()` 上（.quay/quality-round.jsonl 冻结、进程仍活 ⇒ supervisor 永不重生）。
 *  driver-runtime 的 runAsync 注释已写明「死持有者由调用侧的 watchdog 兜底，不靠此处 SIGKILL」——
 *  那个「调用侧」就是本循环。本看门狗在例程 wall-clock 超界时记一条 failed Fact（routine timed out）
 *  并继续下一例程/写心跳，⛔ 不 await 已挂的 routine promise（那会让循环同死）。
 *  ⛔ 这不是给 judge 成本设数值阈值（judge 无实测上界，硬规则 4）——是 liveness 安全界（同 suite-driver
 *  SILENCE_MS_DEFAULT 15min 的语义：给「活着但不动」一个上限，防静默冻结）。生产可用 --routine-watchdog
 *  覆盖；测试经 env QUAY_TEST_QUALITY_GATE_DRIVER_ROUTINE_WATCHDOG_MS 或 --routine-watchdog 传小值。 */
export const ROUTINE_WATCHDOG_MS_DEFAULT = Number(process.env.QUAY_TEST_QUALITY_GATE_DRIVER_ROUTINE_WATCHDOG_MS ?? 30 * 60_000);

// ── B17 · 判据消费纪律（纯机械审计）────────────────────────────────────────────────────────

/** 缺省 judgment-consumer-check 命令（--json 机器面）。输出 = audit report JSON。 */
export function defaultJudgmentConsumerArgv(root: string): string[] {
  return [
    "node", "--experimental-strip-types",
    path.join(root, "plugin", "scripts", "judgment-consumer-check.ts"),  // kernel-sibling-dev-tree-only: dev-tree-only — repo-local plugin/scripts use, not third-party sibling resolution.
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
export async function runJudgmentConsumerCheck(root: string, cmd: string[] | null): Promise<Fact<JudgmentConsumerFactValue | null>> {
  const argv = cmd ?? defaultJudgmentConsumerArgv(root);
  const r = await runAsync(argv, { timeoutMs: ROUTINE_TIMEOUT_MS });
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

// ── packaging-hygiene · 打包卫生常设检查（机械检测 + 漂移时 gap-filing）────────────────────────
// 任务 gap-packaging-hygiene-standing-check：GOAL-015 的 files 白名单误装 / 配置键悬空类缺陷会随
// 代码演化复发，本 routine 把两个既有机械检测（config-key-consumer-check + shipped-entry-runnable
// test）接上轮子——每轮跑 packaging-hygiene-check.ts（机械，零 LLM），漂移非空且过 halt/资源门时
// spawn 一个短命 gap-filing agent 经 ABI（quay-file-task）立案。⛔ driver 自己仍不手写 tasks/*.md
// （同 goal-driver G9 的边界：spawn 即达成，下一轮/下一次漂移消解独立复核，⛔ 不信 agent 自述）。

/** 缺省 packaging-hygiene-check 命令（--json 机器面）。输出 = 两维度审计 report JSON。 */
export function defaultPackagingCheckArgv(root: string): string[] {
  return [
    "node", "--no-warnings", "--experimental-strip-types",
    path.join(root, "plugin", "scripts", "packaging-hygiene-check.ts"),  // kernel-sibling-dev-tree-only: dev-tree-only — repo-local plugin/scripts use, not third-party sibling resolution.
    "--root", root, "--json",
  ];
}

/** packaging-hygiene-check --json 输出的解析面（driver 关心的字段）。 */
export interface PackagingHygieneReport {
  mode: string;
  configKeys: { keysTotal: number; noConsumerToWire: string[]; state: string };
  shippedEntries: { state: string; violations: string[]; reason: string | null };
  drift: string[];
}

/** 解析 packaging-hygiene-check --json 输出。读不懂 ⇒ null（调用方记 not-evaluated，⛔ 不伪装合格）。 */
export function parsePackagingHygieneReport(stdout: string): PackagingHygieneReport | null {
  try {
    const j = JSON.parse(String(stdout ?? "").trim());
    if (j && j.mode === "packaging-hygiene-audit" && Array.isArray(j.drift)
        && j.configKeys && Array.isArray(j.configKeys.noConsumerToWire)
        && j.shippedEntries && typeof j.shippedEntries.state === "string") {
      return {
        mode: j.mode,
        configKeys: {
          keysTotal: typeof j.configKeys.keysTotal === "number" ? j.configKeys.keysTotal : 0,
          noConsumerToWire: j.configKeys.noConsumerToWire.filter((x: unknown) => typeof x === "string"),
          state: j.configKeys.state,
        },
        shippedEntries: {
          state: j.shippedEntries.state,
          violations: Array.isArray(j.shippedEntries.violations)
            ? j.shippedEntries.violations.filter((x: unknown) => typeof x === "string")
            : [],
          reason: j.shippedEntries.reason ?? null,
        },
        drift: j.drift.filter((x: unknown) => typeof x === "string"),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** gap-filing prompt：把漂移清单交给短命 agent，经 quay-file-task 立案（同 goal-driver G9 的措辞，
 *  mechanism-based dedup）。 */
export function buildPackagingGapWorkerPrompt(root: string, drift: string[]): string {
  return [
    "You are a gap-filing agent in the quay repo. A packaging-hygiene standing check found drift — delivered artifacts that are structurally broken (a config key with no consumer, or a shipped entry-like file not runnable from an install location) and will recur until fixed in source.",
    `Repo root: ${root}.`,
    "Drift items:",
    ...drift.map((d) => `  - ${d}`),
    "Read the named check (plugin/scripts/config-key-consumer-check.ts and/or plugin/test/shipped-entry-runnable.test.mjs) to understand the exact defect, then file ONE gap task that closes this drift via the `quay-file-task` skill (Skill tool).",
    "The quay-file-task skill performs MECHANISM-BASED dedup: if a task already claims this drift (ANY status), do NOT file a duplicate — report the existing task id instead.",
  ].join("\n");
}

/** gap-filing agent argv = launchArgv("fix-worker", <prompt>)。gapWorkerCmd 覆盖【前缀】时把 prompt
 *  作为末参数追加（测试缝捕获真实 prompt，同 goal-driver 的 buildGapWorkerArgv）。 */
export function buildPackagingGapWorkerArgv(root: string, drift: string[], cmd?: string | null): string[] {
  const prompt = buildPackagingGapWorkerPrompt(root, drift);
  if (cmd != null) {
    const prefix = splitArgs(cmd);
    if (prefix.length === 0) return launchArgv("fix-worker", prompt, root);
    return [...prefix, prompt];
  }
  return launchArgv("fix-worker", prompt, root);
}

/** packaging-hygiene 例程的 fact.value（写进 round record）。gapFiled = 本轮是否 spawn 了 gap-filing。 */
export interface PackagingHygieneFactValue {
  mode: string;
  configKeysTotal: number;
  noConsumerToWire: string[];
  shippedEntryState: string;
  drift: string[];
  gapFiled: boolean;
  gapExitCode: number | null;
  gapError: string | null;
}

/** packaging-hygiene 例程：跑一次两维度打包卫生检查。clean ⇒ verified；drift ⇒ failed（并 spawn
 *  gap-filing，除非 halted / 资源门 WAIT）；读不懂/读不到 ⇒ not-evaluated（硬规则 3b：读不懂 ≠ 合格）。 */
export async function runPackagingHygiene(
  root: string,
  opts: {
    checkCmd?: string[] | null;
    gapWorkerCmd?: string | null;
    gapWorkerTimeoutMs?: number;
    resourceGateArgv?: string[] | null;
    halted?: boolean;
  } = {},
): Promise<Fact<PackagingHygieneFactValue | null>> {
  const argv = opts.checkCmd ?? defaultPackagingCheckArgv(root);
  const r = await runAsync(argv, { timeoutMs: PACKAGING_CHECK_TIMEOUT_MS, collectStderr: true });
  if (r.error) {
    return { name: "packaging-hygiene", value: null, state: "not-evaluated", reason: `spawn error: ${r.error.message}` };
  }
  const report = parsePackagingHygieneReport(r.stdout ?? "");
  if (report === null) {
    return { name: "packaging-hygiene", value: null, state: "not-evaluated", reason: `unparseable output (exit ${r.status})` };
  }
  const value: PackagingHygieneFactValue = {
    mode: report.mode,
    configKeysTotal: report.configKeys.keysTotal,
    noConsumerToWire: report.configKeys.noConsumerToWire,
    shippedEntryState: report.shippedEntries.state,
    drift: report.drift,
    gapFiled: false,
    gapExitCode: null,
    gapError: null,
  };
  // gap-filing（AC3）：drift 非空且未 halt 且资源门 GO ⇒ spawn 短命 agent 经 ABI 立案。
  if (report.drift.length > 0 && opts.halted !== true) {
    const gate = resourceGateCheck(root, opts.resourceGateArgv ?? null);
    if (gate.go) {
      const gapArgv = buildPackagingGapWorkerArgv(root, report.drift, opts.gapWorkerCmd ?? null);
      const timeoutMs = opts.gapWorkerTimeoutMs ?? PACKAGING_GAP_WORKER_TIMEOUT_MS_DEFAULT;
      const g = await runAsync(gapArgv, { timeoutMs, collectStderr: true });
      value.gapFiled = true;
      value.gapExitCode = g.status;
      value.gapError = g.error
        ? g.error.message
        : g.status === 0
          ? null
          : (String(g.stderr ?? "").slice(0, 200) || null);
    }
  }
  const state = report.drift.length > 0
    ? "failed"
    : report.configKeys.state === "not-evaluated" || report.shippedEntries.state === "not-evaluated"
      ? "not-evaluated"
      : "verified";
  const reason = state === "failed"
    ? `drift: ${report.drift.length} item(s)${value.gapFiled ? `; gap-filing spawned (exit ${value.gapExitCode})` : "; gap-filing deferred (halted/resource-gate)"}`
    : state === "not-evaluated"
      ? "a dimension could not be evaluated (see configKeys.state / shippedEntries.state)"
      : null;
  return { name: "packaging-hygiene", value, state, reason };
}

// ── B15 · pool 质量语义闸（机械触发 + LLM judge + JS 聚合）──────────────────────────────────

/** 缺省 pool-quality-judge --plan 命令（机械触发评估 + 池枚举 + 每任务机械 AC 计数，零 LLM）。 */
export function defaultPoolQualityPlanArgv(root: string): string[] {
  return [
    "node", "--no-warnings", "--experimental-strip-types",
    path.join(root, "plugin", "scripts", "pool-quality-judge.ts"),  // kernel-sibling-dev-tree-only: dev-tree-only — repo-local plugin/scripts use, not third-party sibling resolution.
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

/** 写端（B15）：judge 完成后持久化 lastRound（every-10-rounds 触发重置）。单写者 = 本 driver 完成路径。
 *  机械 node 调用（快速，非 LLM）——runAsync 非阻塞替代 spawnSync（同 gap-worker-driver-async-
 *  selector-readypool 的循环体异步化修法）。 */
async function recordLastJudgeRound(root: string): Promise<{ recorded: boolean; lastRound: number | null }> {
  const argv = [
    "node", "--no-warnings", "--experimental-strip-types",
    path.join(root, "plugin", "scripts", "pool-quality-judge.ts"),  // kernel-sibling-dev-tree-only: dev-tree-only — repo-local plugin/scripts use, not third-party sibling resolution.
    "--root", root, "--record-last-round",
  ];
  const r = await runAsync(argv, { timeoutMs: ROUTINE_TIMEOUT_MS });
  if (r.error || r.status !== 0) return { recorded: false, lastRound: null };
  try {
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

/** 判词载体写失败不致命（运行时日志，⛔ 不因日志炸循环）。 */
function appendQualityRoundSafe(root: string, record: QualityRoundRecord): void {
  try { appendQualityRound(root, record); } catch { /* 载体写失败不致命 */ }
}

/** 构造一条 failed 判词载体记录（AC3：判词解析/执行失败 ⇒ state=failed，⛔ 与 judged 不同形）。 */
function failedQualityRoundRecord(root: string, reasons: string[], reason: string): QualityRoundRecord {
  return buildQualityRoundRecord({
    round: readCurrentRound(root),
    judgedAt: new Date().toISOString(),
    state: "failed",
    triggerReasons: reasons,
    distribution: null,
    shouldRemoveIds: [],
    verdicts: [],
    reason,
  });
}

/** B15 例程：机械触发（--plan）→ 命中则 LLM judge → JS 聚合（aggregateVerdicts 单一实现）→
 *  写端（--record-last-round + 判词载体 .quay/quality-round.jsonl）。读不懂 --plan ⇒ not-evaluated
 *  （硬规则 3b）；judge 失败 ⇒ failed（落 failed 载体记录）；未命中 ⇒ verified（查过且无需 judge——
 *  fired=false 是真实测量，非「读不懂装合格」）。
 *  ⛔ 循环体异步化（gap-quality-gate-driver-pool-judge-spawn-timeout AC1）：--plan / judge / 写端全部
 *  spawnSync → runAsync（非阻塞 spawn，同 gap-worker-driver-async-selector-readypool）。judge（真实
 *  claude -p）不再设 180_000 固定字面量上限（缺省 unbounded，judge 完成是唯一唤醒源——硬规则 4
 *  推论：成本结构未知前不设数值阈值）。judgeTimeoutMs 是 AC5 负控制缝（测试注入「明显不够的值」复现
 *  timeout 失败），生产缺省 Infinity。 */
export async function runPoolQualityJudge(
  root: string,
  planCmd: string[] | null,
  judgeArgv: string[] | null,
  resourceGateArgv: string[] | null = null,
  recordVerdicts: boolean = true,
  judgeTimeoutMs: number = Infinity,
  halted: boolean = false,
): Promise<Fact<PoolQualityFactValue | null>> {
  const planArgv = planCmd ?? defaultPoolQualityPlanArgv(root);
  const planR = await runAsync(planArgv, { timeoutMs: ROUTINE_TIMEOUT_MS });
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
  // 判词载体写端开关（AC6 负控制缝）：recordVerdicts=false ⇒ 判词/失败记录均不落盘，载体不增长。
  const writeRecord = (record: QualityRoundRecord): void => {
    if (recordVerdicts) appendQualityRoundSafe(root, record);
  };
  if (!plan.triggers.fired) {
    return { name: "pool-quality-judge", value: base, state: "verified", reason: `not-triggered (${plan.triggers.reasons.length} reasons: ${plan.triggers.reasons.join(",") || "none"})` };
  }
  // halt 闸（gap-drain-on-routine-driver-empties-round-and-respawn-loops）：halted ⇒ 只挡受闸动作
  // （LLM judge spawn），机械 --plan 读数照跑（fired 已读出）。⛔ 不 spawn judge、不落判词载体。
  if (halted) {
    return { name: "pool-quality-judge", value: base, state: "verified", reason: "halted: judge deferred (mechanical --plan read; no LLM spawn)" };
  }
  // 资源门（AC150-1 同族）：spawn LLM judge 前经 resourceGateCheck 判定，WAIT ⇒ 退避本轮（⛔ 机械 --plan
  // 不受约束，零 LLM）。资源门 WAIT 是瞬时态（⛔ 不 latch），下一轮重读。resourceGateArgv = 测试缝。
  const gate = resourceGateCheck(root, resourceGateArgv);
  if (!gate.go) {
    return { name: "pool-quality-judge", value: base, state: "not-evaluated", reason: `resource-gate-wait: ${gate.reason} (judge deferred)` };
  }
  const argv = judgeArgv ?? defaultPoolJudgeArgv(plan, root);
  const judgeR = await runAsync(argv, { timeoutMs: judgeTimeoutMs, collectStderr: true });
  if (judgeR.error || judgeR.status !== 0) {
    const reason = `judge exited ${judgeR.status ?? "null"}: ${judgeR.error?.message ?? String(judgeR.stderr ?? "").slice(0, 200)}`;
    writeRecord(failedQualityRoundRecord(root, plan.triggers.reasons, reason));
    return { name: "pool-quality-judge", value: base, state: "failed", reason };
  }
  let verdicts: VerdictRecord[];
  try {
    const parsed = JSON.parse(String(judgeR.stdout ?? "").trim());
    verdicts = Array.isArray(parsed) ? parsed : [];
  } catch {
    writeRecord(failedQualityRoundRecord(root, plan.triggers.reasons, "judge output not a JSON array"));
    return { name: "pool-quality-judge", value: base, state: "failed", reason: "judge output not a JSON array" };
  }
  // JS 聚合（单一实现 aggregateVerdicts——should-remove → remove-or-rescope 路由）。
  const agg = aggregateVerdicts(verdicts);
  const recorded = await recordLastJudgeRound(root);
  // 判词载体写端（AC1）：判过且有结果 ⇒ 追加一条 judged 记录；判词为空 ⇒ 不写空记录（AC1）。
  const judgedAt = new Date().toISOString();
  const round = recorded.lastRound ?? 0;
  if (verdicts.length > 0) {
    writeRecord(buildQualityRoundRecord({
      round,
      judgedAt,
      state: "judged",
      triggerReasons: plan.triggers.reasons,
      distribution: agg.distribution,
      shouldRemoveIds: agg.shouldRemoveIds,
      verdicts: qualityRoundVerdicts(verdicts, agg.actions, judgedAt, round),
    }));
  }
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

// ── 架构复核 · 机械聚类（复用三个既有检测器，⛔ 不重新实现）────────────────────────────────

/** 缺省 identity-replication-check --json 命令（P2 身份复制）。 */
export function defaultIdentityReplicationArgv(root: string): string[] {
  return [
    "node", "--experimental-strip-types",
    path.join(root, "plugin", "scripts", "identity-replication-check.ts"),  // kernel-sibling-dev-tree-only: dev-tree-only — repo-local plugin/scripts use, not third-party sibling resolution.
    "--root", root, "--json",
  ];
}

/** 缺省 guard-lineage-check --json 命令（P4 守卫谱系）。 */
export function defaultGuardLineageArgv(root: string): string[] {
  return [
    "node", "--experimental-strip-types",
    path.join(root, "plugin", "scripts", "guard-lineage-check.ts"),  // kernel-sibling-dev-tree-only: dev-tree-only — repo-local plugin/scripts use, not third-party sibling resolution.
    "--root", root, "--json",
  ];
}

/** 缺省 deletion-closure-check --json 命令（P1 删除闭包）。components 由 identity 报告推导（硬编码
 *  实体）；无候选构件时不 spawn 本检测器。 */
export function defaultDeletionClosureArgv(root: string, components: string[]): string[] {
  return [
    "node", "--experimental-strip-types",
    path.join(root, "plugin", "scripts", "deletion-closure-check.ts"),  // kernel-sibling-dev-tree-only: dev-tree-only — repo-local plugin/scripts use, not third-party sibling resolution.
    ...components, "--root", root, "--json",
  ];
}

/** 解析一个检测器的 --json 输出为最小结构视图。读不懂/非对象 ⇒ null（调用方记 not-evaluated，⛔ 不伪装合格）。 */
function parseDetectorJson<T>(stdout: string): T | null {
  try {
    const j = JSON.parse(String(stdout ?? "").trim());
    if (!j || typeof j !== "object" || Array.isArray(j)) return null;
    return j as T;
  } catch {
    return null;
  }
}

/** 架构复核 judge prompt（单个 `claude -p` 判整批候选簇；机械聚类来自三个检测器，判定交给 LLM）。
 *  ⛔ 不按簇拆 schema agent（那是 Workflow 工具的形态，driver 进程没有）——本 driver 用单一批判
 *  `claude -p`，输出 JSON 数组，聚合仍走 architecture-review-cluster.ts 的单一 JS 算术。
 *  `actionable` 是本任务（gap-arch-review-judge-verdicts-never-reach-the-existing-gap-filing-
 *  channel）加的**结构化**立案判定：⛔ 不让下游解析 suggestedAction 的自由文本（那会把判定从 LLM
 *  挪进正则）。语义定义写在 prompt 里，三态由 mergeClusterVerdicts 兜底（缺失 ⇒ 未评估，非 false）。 */
function archReviewJudgePrompt(clusters: Cluster[], root: string): string {
  const summary = clusters
    .map((c) => `  ${c.clusterId} [${c.primitive}] files=${c.files.length} rawCount=${c.rawCount} — ${c.label} — ${c.files.slice(0, 12).join(", ")}${c.files.length > 12 ? ", …" : ""}`)
    .join("\n");
  return [
    "You are the architecture-review judge for the quay repo (docs/proposals/archguard-generation-era-primitives.md §3).",
    "Mechanical clustering already grouped suspicious files into candidate clusters — trust it as arithmetic, NOT a verdict.",
    `Repo root: ${root}. Candidate clusters:`,
    summary || "(none)",
    "For EACH cluster decide: does it warrant abstracting/merging (real identity replication / deletion-closure debt), or is it coincidental similarity to keep as-is?",
    "Also set `actionable`: true iff this cluster names a defect that should be FIXED BY A TASK — either (a) real replication/deletion debt to merge, or (b) a defect in the detector/pipeline that produced this cluster (e.g. generated directories or worktree snapshots polluting the measured dependency graph, so the number is an artifact rather than a real signal).",
    "Set `actionable` false when the cluster is coincidental similarity, or mere load-bearing centrality that is correct by design — no task should be filed for those.",
    "Reply with ONLY a JSON array, one object per cluster:",
    '[{"clusterId":"<id>","verdict":"abstract|coincidental|uncertain","reasoning":"<one line>","suggestedAction":"<one line>","actionable":true|false}]',
  ].join("\n");
}

/** 缺省架构复核 judge 命令（launchArgv role=pool-judge → 短命 claude -p，复用 B15 的 profile 机制）。 */
export function defaultArchReviewJudgeArgv(clusters: Cluster[], root: string): string[] {
  return launchArgv("pool-judge", archReviewJudgePrompt(clusters, root), root);
}

/** 架构复核 gap-filing agent spawn 的 wall-clock 上限【缺省回退值】（毫秒）。同 PACKAGING_…_DEFAULT
 *  ——**同一个 gap-filing 角色的同一次实测导出**（elapsed_s=602.9，900s 留 ~1.5x 余量），
 *  ⛔ 不另起测量、不写第二个字面量（单一真相源；硬规则 4 推论）。 */
export const ARCH_GAP_WORKER_TIMEOUT_MS_DEFAULT = PACKAGING_GAP_WORKER_TIMEOUT_MS_DEFAULT;

/** 架构复核的 gap-filing prompt：把**够格立案**的语义结论交给短命 agent，经 quay-file-task 立案。
 *  与 packaging-hygiene 的 buildPackagingGapWorkerPrompt **同构**（同一通道、同一查重、同一 spawn
 *  原语），差别只在证据形状——故两段措辞不同而机制相同。⛔ 本 prompt 不得让 agent 顺手修缺陷：
 *  「排除 .archguard/output 与 .claude/worktrees」那类结论该由**立出来的任务**去做（本任务 DoD）。 */
export function buildArchGapWorkerPrompt(root: string, conclusions: ArchReviewClusterVerdict[]): string {
  return [
    "You are a gap-filing agent in the quay repo. The architecture-review routine judged some candidate clusters and marked them ACTIONABLE — each one names a defect that must be closed by a task (real replication/deletion debt to merge, or a defect in the detector/pipeline that produced the cluster). Nothing has been filed for them yet.",
    `Repo root: ${root}.`,
    "Actionable conclusions:",
    ...conclusions.flatMap((c) => [
      `  - cluster ${c.clusterId} [${c.primitive}] verdict=${c.verdict} (round ${c.round}): ${c.label}`,
      `      judge reasoning: ${c.reasoning}`,
      `      judge suggested action: ${c.suggestedAction}`,
    ]),
    "File exactly ONE gap task PER actionable conclusion above — do NOT merge two conclusions into one task, and do NOT file a task for anything not listed here.",
    "Use the `quay-file-task` skill (Skill tool) to file each one; the task must carry runnable Acceptance Criteria and declare ## Touches.",
    "The quay-file-task skill performs MECHANISM-BASED dedup: if a task already claims the same defect (ANY status), do NOT file a duplicate — report the existing task id instead.",
    "⛔ Do NOT fix the defect here, and ⛔ do NOT touch the detector sources — filing the task is the whole deliverable.",
  ].join("\n");
}

/** gap-filing agent argv = launchArgv("fix-worker", <prompt>)。archGapWorkerCmd 覆盖【前缀】时把 prompt
 *  作为末参数追加（测试缝捕获真实 prompt，同 buildPackagingGapWorkerArgv）。 */
export function buildArchGapWorkerArgv(root: string, conclusions: ArchReviewClusterVerdict[], cmd?: string | null): string[] {
  const prompt = buildArchGapWorkerPrompt(root, conclusions);
  if (cmd != null) {
    const prefix = splitArgs(cmd);
    if (prefix.length === 0) return launchArgv("fix-worker", prompt, root);
    return [...prefix, prompt];
  }
  return launchArgv("fix-worker", prompt, root);
}

/** 架构复核读数的值面（写进 round record 的 fact.value）。fired=false ⇒ 候选簇为空，不 judge。 */
export interface ArchReviewFactValue {
  fired: boolean;
  reasons: string[];
  clusterCount: number;
  judgedCount: number;
  distribution: Record<string, number> | null;
  /** 够格立案的结论数（judge 的 actionable===true）。 */
  actionableCount: number;
  /** 本轮**新**提交给立案通道的结论键（节流后）——空数组 = 全部已提交过或没有够格的。 */
  submittedKeys: string[];
  /** actionable 字段读不出的簇数（硬规则 3b：⛔ 与 actionable===false 不同形）。 */
  actionabilityNotEvaluated: number;
  gapFiled: boolean;
  gapExitCode: number | null;
  gapError: string | null;
}

/** 判词载体写失败不致命（运行时日志，⛔ 不因日志炸循环）。 */
function appendArchReviewRoundSafe(root: string, record: ArchReviewRoundRecord): void {
  try { appendArchReviewRound(root, record); } catch { /* 载体写失败不致命 */ }
}

/** 架构复核例程：机械聚类（三个检测器 --json）→ 命中则 LLM judge → JS 合并 → 判词载体
 *  （.quay/architecture-review-round.jsonl）。读不懂任一检测器输出 ⇒ not-evaluated（硬规则 3b）；
 *  judge 失败/判词为空 ⇒ failed（落 failed 载体记录）；候选簇为空 ⇒ not-triggered（fired=false 是
 *  真实测量，非「读不懂装合格」）。
 *  ⛔ 循环体异步化（同 B15 的 runAsync 修法）；judge（真实 claude -p）不设固定字面量上限（缺省
 *  unbounded）；judgeTimeoutMs 是负控制缝（测试注入「明显不够的值」），生产缺省 Infinity。 */
export async function runArchitectureReview(
  root: string,
  identityCmd: string[] | null,
  lineageCmd: string[] | null,
  deletionCmd: string[] | null,
  judgeArgv: string[] | null,
  resourceGateArgv: string[] | null = null,
  recordVerdicts: boolean = true,
  judgeTimeoutMs: number = Infinity,
  halted: boolean = false,
  gapWorkerCmd: string | null = null,
  gapWorkerTimeoutMs: number = ARCH_GAP_WORKER_TIMEOUT_MS_DEFAULT,
): Promise<Fact<ArchReviewFactValue | null>> {
  // 1. P2 身份复制（必需——既产 P2 簇又推导 P1 候选构件）。
  const identityArgv = identityCmd ?? defaultIdentityReplicationArgv(root);
  const identityR = await runAsync(identityArgv, { timeoutMs: ROUTINE_TIMEOUT_MS });
  if (identityR.error) {
    return { name: "architecture-review", value: null, state: "not-evaluated", reason: `identity-replication spawn error: ${identityR.error.message}` };
  }
  const identity = parseDetectorJson<IdentityReportView>(identityR.stdout ?? "");
  if (identity === null) {
    return { name: "architecture-review", value: null, state: "not-evaluated", reason: `unparseable identity-replication output (exit ${identityR.status})` };
  }

  // 2. P4 守卫谱系（必需）。
  const lineageArgv = lineageCmd ?? defaultGuardLineageArgv(root);
  const lineageR = await runAsync(lineageArgv, { timeoutMs: ROUTINE_TIMEOUT_MS });
  if (lineageR.error) {
    return { name: "architecture-review", value: null, state: "not-evaluated", reason: `guard-lineage spawn error: ${lineageR.error.message}` };
  }
  const lineage = parseDetectorJson<LineageReportView>(lineageR.stdout ?? "");
  if (lineage === null) {
    return { name: "architecture-review", value: null, state: "not-evaluated", reason: `unparseable guard-lineage output (exit ${lineageR.status})` };
  }

  // 3. P1 删除闭包（候选构件由 identity 报告推导；无候选 ⇒ 空报告，跳过 spawn）。
  const components = deletionClosureComponents(identity);
  let deletion: DeletionReportView = { components: [], dc: [], counts: { dcTotal: 0, callGraphTotal: 0, ratio: null } };
  if (components.length > 0) {
    const deletionArgv = deletionCmd ?? defaultDeletionClosureArgv(root, components);
    const deletionR = await runAsync(deletionArgv, { timeoutMs: ROUTINE_TIMEOUT_MS });
    if (deletionR.error) {
      return { name: "architecture-review", value: null, state: "not-evaluated", reason: `deletion-closure spawn error: ${deletionR.error.message}` };
    }
    const parsed = parseDetectorJson<DeletionReportView>(deletionR.stdout ?? "");
    if (parsed === null) {
      return { name: "architecture-review", value: null, state: "not-evaluated", reason: `unparseable deletion-closure output (exit ${deletionR.status})` };
    }
    deletion = parsed;
  }

  // 4. 机械聚类 → 触发评估。
  const clusters = clusterDetectorOutputs({ identity, lineage, deletion });
  const trigger = computeArchReviewTrigger(clusters);
  const base: ArchReviewFactValue = {
    fired: trigger.fired,
    reasons: trigger.reasons,
    clusterCount: trigger.clusterCount,
    judgedCount: 0,
    distribution: null,
    actionableCount: 0,
    submittedKeys: [],
    actionabilityNotEvaluated: 0,
    gapFiled: false,
    gapExitCode: null,
    gapError: null,
  };
  const writeRecord = (record: ArchReviewRoundRecord): void => {
    if (recordVerdicts) appendArchReviewRoundSafe(root, record);
  };
  if (!trigger.fired) {
    writeRecord(buildArchReviewRoundRecord({
      round: readCurrentRound(root),
      judgedAt: new Date().toISOString(),
      state: "not-triggered",
      triggerReasons: trigger.reasons,
      clusters: [],
      reason: "no candidate clusters (three detectors produced zero suspicious groupings)",
    }));
    return { name: "architecture-review", value: base, state: "verified", reason: `not-triggered (no candidate clusters)` };
  }

  // 5. halt 闸（gap-drain-on-routine-driver-empties-round-and-respawn-loops）：halted ⇒ 只挡受闸动作
  // （LLM judge spawn），机械聚类读数照跑（fired 已读出）。⛔ 不 spawn judge、不落判词载体。
  if (halted) {
    return { name: "architecture-review", value: base, state: "verified", reason: "halted: judge deferred (mechanical clustering read; no LLM spawn)" };
  }

  // 6. 资源门（spawn LLM judge 前判定，同 B15）。WAIT ⇒ 退避本轮。
  const gate = resourceGateCheck(root, resourceGateArgv);
  if (!gate.go) {
    return { name: "architecture-review", value: base, state: "not-evaluated", reason: `resource-gate-wait: ${gate.reason} (judge deferred)` };
  }

  // 7. LLM judge（真实 claude -p，单批）。
  const argv = judgeArgv ?? defaultArchReviewJudgeArgv(clusters, root);
  const judgeR = await runAsync(argv, { timeoutMs: judgeTimeoutMs, collectStderr: true });
  if (judgeR.error || judgeR.status !== 0) {
    const reason = `judge exited ${judgeR.status ?? "null"}: ${judgeR.error?.message ?? String(judgeR.stderr ?? "").slice(0, 200)}`;
    writeRecord(buildArchReviewRoundRecord({
      round: readCurrentRound(root),
      judgedAt: new Date().toISOString(),
      state: "failed",
      triggerReasons: trigger.reasons,
      clusters: [],
      reason,
    }));
    return { name: "architecture-review", value: base, state: "failed", reason };
  }
  let verdicts: JudgeClusterVerdict[];
  try {
    const parsed = JSON.parse(String(judgeR.stdout ?? "").trim());
    verdicts = Array.isArray(parsed) ? parsed : [];
  } catch {
    const reason = "judge output not a JSON array";
    writeRecord(buildArchReviewRoundRecord({
      round: readCurrentRound(root),
      judgedAt: new Date().toISOString(),
      state: "failed",
      triggerReasons: trigger.reasons,
      clusters: [],
      reason,
    }));
    return { name: "architecture-review", value: base, state: "failed", reason };
  }

  // 7. JS 合并（判词 → 逐簇载体记录）。判词为空 ⇒ failed（⛔ 不写空 judged 记录）。
  const judgedAt = new Date().toISOString();
  const round = readCurrentRound(root);
  const merged: ArchReviewClusterVerdict[] = mergeClusterVerdicts(clusters, verdicts, judgedAt, round);
  if (merged.length === 0) {
    const reason = "judge produced no valid cluster verdicts";
    writeRecord(buildArchReviewRoundRecord({
      round, judgedAt, state: "failed", triggerReasons: trigger.reasons, clusters: [], reason,
    }));
    return { name: "architecture-review", value: base, state: "failed", reason };
  }
  const distribution: Record<string, number> = {};
  for (const m of merged) distribution[m.verdict] = (distribution[m.verdict] ?? 0) + 1;
  writeRecord(buildArchReviewRoundRecord({ round, judgedAt, state: "judged", triggerReasons: trigger.reasons, clusters: merged }));

  // 8. 语义结论 → 既有立案通道（gap-arch-review-judge-verdicts-never-reach-the-existing-gap-filing-
  //    channel）。**接法选择 = 单开一条同构路径，⛔ 不并入 packaging 的 `report.drift`**，理由：
  //    ① `report.drift` 是另一条例程（packaging-hygiene-check.ts）自己的机械检测输出，且 Layer 1b
  //       的契约是「一条例程 → 一批 Facts」，routine 之间无共享可变状态——把语义结论倒进别人的
  //       report 要么让本 routine 去调 packaging 的检测器（荒谬耦合），要么凭空造一个跨例程的
  //       漂移累加器（破契约，且让每条 routine 的单元从「例程」变成 god-object）。
  //    ② `report.drift` 的消费者（buildPackagingGapWorkerPrompt）逐字要求 agent「去读那个具名
  //       机械检测以理解缺陷」——对语义簇判词这句是错的，会误导 agent 去读一个无关的脚本。
  //    ③ 通道本身（quay-file-task 技能 + 其机制查重 + launchArgv spawn + halt/资源门）**完全复用**，
  //       所以这只是同构的第二条入口，不是第二套机制。
  //    节流：读提交台账（结论键）⇒ 已提交过的不再 spawn（同一结论 25 次 ⇒ 1 次付费、1 条任务）。
  const { filable, notEvaluated } = actionableConclusions(merged);
  const toSend = unsentConclusions(filable, readSubmittedKeys(root));
  const value: ArchReviewFactValue = {
    ...base,
    judgedCount: merged.length,
    distribution,
    actionableCount: filable.length,
    submittedKeys: toSend.map(conclusionKey),
    actionabilityNotEvaluated: notEvaluated.length,
  };
  if (toSend.length > 0) {
    const gapArgv = buildArchGapWorkerArgv(root, toSend, gapWorkerCmd);
    const g = await runAsync(gapArgv, { timeoutMs: gapWorkerTimeoutMs, collectStderr: true });
    value.gapFiled = true;
    value.gapExitCode = g.status;
    value.gapError = g.error
      ? g.error.message
      : g.status === 0
        ? null
        : (String(g.stderr ?? "").slice(0, 200) || null);
    // 台账只记【已投递】（进程真的起来了），⛔ 不记 spawn 失败/超时——那些情形下通道根本没接手，
    // 记下来会**永久静默**封掉这个结论（恒零收益，正是本任务要消灭的形态）。非零退出仍记（agent
    // 起过、跑过，submit-once 语义，同 goal-driver G9「spawn 即达成，不信 agent 自述」）；exit code
    // 与 stderr 留在 Fact 里供下一轮/外部复核消解，⛔ 本 driver 不复核 agent 的自述。
    if (g.error === null) {
      const at = new Date().toISOString();
      for (const c of toSend) {
        try {
          appendSubmission(root, { key: conclusionKey(c), clusterId: c.clusterId, verdict: c.verdict, submittedAt: at, round });
        } catch { /* 台账写失败不致命：下一轮至多重放一次（方向安全） */ }
      }
    }
  }
  const summary = Object.entries(distribution).map(([k, v]) => `${k}=${v}`).join(" ");
  const filing = `; actionable=${filable.length} submitted=${toSend.length}${value.gapFiled ? ` gap-filing spawned (exit ${value.gapExitCode})` : ""}`;
  // 硬规则 3b：把「判词没给 actionable」与「判过且不够格」在**读数上**分开（⛔ 不靠读者自觉）。
  const unreadable = notEvaluated.length > 0
    ? `; actionability unreadable for ${notEvaluated.length} cluster(s) — ⛔ NOT "judged not-actionable"`
    : "";
  return {
    name: "architecture-review",
    value,
    state: "verified",
    reason: `judged ${merged.length} cluster(s): ${summary || "none"}${filing}${unreadable}`,
  };
}

// ── 例程表（Layer 1b：routines = [{name, schedule, run() → Facts}]）──────────────────────────

/** 例程装配缝（测试可注入覆盖命令/间隔；缺省 = 生产缺省）。 */
export interface QualityGateOptions {
  planCmd: string[] | null;
  judgeArgv: string[] | null;
  judgmentCmd: string[] | null;
  identityCmd: string[] | null;
  lineageCmd: string[] | null;
  deletionCmd: string[] | null;
  archJudgeArgv: string[] | null;
  resourceGateArgv: string[] | null;
  poolJudgeIntervalMinutes: number;
  judgmentIntervalMinutes: number;
  archReviewIntervalMinutes: number;
  packagingCheckCmd: string[] | null;
  packagingGapWorkerCmd: string | null;
  packagingGapWorkerTimeoutMs: number;
  packagingHygieneIntervalMinutes: number;
  /** 架构复核的 gap-filing agent 命令（测试缝；prompt 末参数追加）。缺省 null ⇒ 生产 launchArgv。 */
  archGapWorkerCmd: string | null;
  archGapWorkerTimeoutMs: number;
  /** probe 轨道（SPEC-capability-planes-and-mechanism-lifecycle §5.2）的例程表：由调用方
   *  （main()）从 `.quay/config.yml` `loop.routines:` 装配后**注入**，⛔ 本函数不自己读配置
   *  （读配置会让 qualityGateRoutines 的行为依赖工作区的 gitignored 状态 ⇒ 测试不再确定）。
   *  缺省 [] = 无 probe 轨道（老行为）。 */
  probeRoutines?: RoutineSpec[];
}

/** 四条例程（B15 pool-quality-judge + B17 judgment-consumer-check + 架构复核 + packaging-hygiene）。
 *  ⛔ 只此四条——B16-C/B18 归 AC145（本 driver 不承接）；架构复核与 packaging-hygiene 是本 driver 承接的
 *  第三/四条例程（读数非任务终态）。 */
export function qualityGateRoutines(root: string, opts: QualityGateOptions): RoutineSpec[] {
  return [
    {
      name: "pool-quality-judge",
      schedule: { kind: "interval", minutes: opts.poolJudgeIntervalMinutes },
      // ctx.halted ⇒ 只挡 LLM judge spawn（机械 --plan 仍跑）——halt 是轮内闸，⛔ 不挡观测。
      run: async (ctx) => [await runPoolQualityJudge(root, opts.planCmd, opts.judgeArgv, opts.resourceGateArgv, true, Infinity, ctx?.halted === true)],
    },
    {
      name: "judgment-consumer-check",
      schedule: { kind: "interval", minutes: opts.judgmentIntervalMinutes },
      // 纯机械审计（零 LLM），halt 不挡——观测照跑。⛔ runJudgmentConsumerCheck 是 async（runAsync），
      // 例程 run 也 async：挂死的审计子进程由 caller 侧看门狗兜底，⛔ 不同步阻塞事件循环。
      run: async () => [await runJudgmentConsumerCheck(root, opts.judgmentCmd)],
    },
    {
      name: "architecture-review",
      schedule: { kind: "interval", minutes: opts.archReviewIntervalMinutes },
      // ctx.halted ⇒ 只挡 LLM judge spawn（机械聚类仍跑）——halt 是轮内闸，⛔ 不挡观测。
      // halted ⇒ 早返回 ⇒ 到达不了「语义结论 → 立案」那一步（受闸动作一并被挡）。
      run: async (ctx) => [await runArchitectureReview(
        root, opts.identityCmd, opts.lineageCmd, opts.deletionCmd, opts.archJudgeArgv, opts.resourceGateArgv,
        true, Infinity, ctx?.halted === true, opts.archGapWorkerCmd, opts.archGapWorkerTimeoutMs,
      )],
    },
    {
      name: "packaging-hygiene",
      schedule: { kind: "interval", minutes: opts.packagingHygieneIntervalMinutes },
      // ctx.halted ⇒ 只挡 gap-filing spawn（机械两维度检查仍跑）——halt 是轮内闸，⛔ 不挡观测。
      run: async (ctx) => [await runPackagingHygiene(root, {
        checkCmd: opts.packagingCheckCmd,
        gapWorkerCmd: opts.packagingGapWorkerCmd,
        gapWorkerTimeoutMs: opts.packagingGapWorkerTimeoutMs,
        resourceGateArgv: opts.resourceGateArgv,
        halted: ctx?.halted === true,
      })],
    },
    // 第五类：**声明式** probe 轨道（SPEC §5.2）。与前四条的区别是「例程不是写在这个文件里的，
    // 是工作区 `.quay/config.yml` 声明的」——这才是让 `loop.routines:` 从死配置变回活机制的那条线。
    // ⛔ 与 fan-in/scoped-gate 无任何关系（gap-fan-in-remove-archguard-gate 的教训：深扫成本高得多的
    //   东西更不能上每任务必经的热路径）。
    ...(opts.probeRoutines ?? []),
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
  /** 例程看门狗（毫秒）：单条例程 wall-clock 上限（caller 侧兜底，防挂死的 judge spawn 冻结循环）。
   *  缺省 = ROUTINE_WATCHDOG_MS_DEFAULT（30min liveness 安全界）。Infinity / ≤0 = 显式不设限
   *  （⛔ 生产不传，测试负控制用它复现「无看门狗 ⇒ 冻结」）。 */
  routineWatchdogMs?: number;
  /** 控制态文件（相对 root）。缺省 = quality 自己的。**参数化的理由**：本循环体除这一处外
   *  已经是【通用的例程型常驻循环】（收 RoutineSpec[]、评估 due、汇 Facts、写轮记录），
   *  复用它比让下一个例程型 driver 再抄 95 行样板正确（SPEC §4 正是要消灭那种重复）。
   *  ⛔ 不同 kind 必须用各自的控制面——共用会让一个 kind 的 halt 误停另一个。 */
  controlStateRel?: string;
  /** AC-255（SPEC §7 阶段 C）：本循环是哪个 kind 的。用来登记**进程内**停机信号（`registerKindStop`），
   *  使 anchor 能只停这一个 kind 的循环。缺省 "quality"（本循环的原生 kind）。 */
  kind?: DriverKind;
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

/** 单条例程的 caller 侧看门狗：race `r.run(ctx)` 对 `watchdogMs`。例程 wall-clock 超界 ⇒ 返回一条
 *  failed Fact（routine timed out）并继续——⛔ 不 await 已挂的 routine promise。judge spawn 是
 *  runAsync(Infinity)，挂死时该 promise 永不 settle，await 它会让常驻循环同死（心跳冻结）。
 *  Infinity / ≤0 ⇒ 直跑（显式不设限，测试负控制用）；例程自身 throw / reject 自然传播，交外层
 *  try/catch 记「routine threw」（与既有语义一致，⛔ 本函数只处理超时这一态）。 */
async function runRoutineWithWatchdog(r: RoutineSpec, ctx: { halted: boolean }, watchdogMs: number): Promise<Fact<unknown>[]> {
  if (!Number.isFinite(watchdogMs) || watchdogMs <= 0) {
    return await r.run(ctx);
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutFact: Fact<unknown>[] = [
      { name: r.name, value: null, state: "failed", reason: `routine timed out after ${watchdogMs}ms (caller-side watchdog)` },
    ];
    return await Promise.race([
      r.run(ctx),
      new Promise<Fact<unknown>[]>((resolve) => { timer = setTimeout(() => resolve(timeoutFact), watchdogMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 常驻循环：每轮读控制态（halt ⇒ 记 halted 轮【继续循环】，⛔ 不退出——halt 是轮内闸，只挡受闸动作
 *  spawn，观测/心跳照跑，见 gap-drain-on-routine-driver-empties-round-and-respawn-loops）→ 评估 due 例程
 *  （scheduleIsDue + 内存 lastRun）→ 跑 due 例程 → 汇集 Facts → 写 round 心跳。SIGINT/SIGTERM / --once /
 *  --max-rounds 停。lastRun 是进程内存态（例程 interval 调度用）；重启 ⇒ never-ran ⇒ 首轮例程均 due（该跑）。 */
export async function runResidentQualityGateLoop(opts: QualityGateLoopOptions): Promise<number> {
  const { root, intervalMs, once, maxRounds, roundLogFile, runId, json, pidFile, routines } = opts;
  const controlStateRel = opts.controlStateRel ?? QUALITY_CONTROL_STATE_REL;
  const routineWatchdogMs = opts.routineWatchdogMs ?? ROUTINE_WATCHDOG_MS_DEFAULT;
  if (pidFile) {
    try { fs.writeFileSync(pidFile, `${process.pid}\n`, "utf8"); } catch { /* pid-file 只供外部观测，写失败不致命 */ }
  }
  let stopRequested = false;
  let wakeResolve: (() => void) | null = null;
  const requestStop = () => { stopRequested = true; if (wakeResolve) { const w = wakeResolve; wakeResolve = null; w(); } };
  // AC-255（SPEC §7 阶段 C）：停机登记 —— 进程信号仍停本 kind，同时 anchor 可经 `requestKindStop`
  // 只停【这一个】循环（收敛后多个 kind 同进程，`kill -TERM <pid>` 不再能只停一个）。
  registerKindStop(opts.kind ?? "quality", requestStop);
  const sleep = (ms: number) => new Promise<void>((resolve) => {
    wakeResolve = resolve;
    setTimeout(() => { if (wakeResolve === resolve) wakeResolve = null; resolve(); }, ms);
  });

  const lastRun: Record<string, number> = {};
  let round = 0;
  while (!stopRequested) {
    round += 1;
    // 控制面（halt）：读 <kind>-control.json 单一真相源。halted ⇒ 本轮【不做受闸动作（spawn）】，但
    // 【观测继续、心跳继续、循环继续】——halt 是轮内的闸，⛔ 不是进程的终止条件
    // （gap-drain-on-routine-driver-empties-round-and-respawn-loops：旧的 break 让进程 return 0 结束，
    //  supervisor 每 5s 重生一次 ⇒ 无限 respawn 循环 + 空轮记录）。halted 经 ctx 传给例程：只挡
    // 受闸动作（LLM spawn），机械读数照跑（goal 的 criterion/缺口、quality 的 --plan/聚类均零 LLM）。
    const halted = isHalted(root, process.env, controlStateRel);
    const facts: Fact<unknown>[] = [];
    for (const r of routines) {
      const state = { now: Date.now(), lastRun: lastRun[r.name] };
      if (!scheduleIsDue(r.schedule, state)) continue;
      lastRun[r.name] = state.now;
      try {
        // caller 侧看门狗（gap-meta-quality-gate-driver）：judge spawn runAsync(Infinity) 挂死时，
        // 看门狗在例程 wall-clock 超界后返回 failed Fact 继续写心跳，⛔ 不 await 已挂的 promise。
        facts.push(...(await runRoutineWithWatchdog(r, { halted }, routineWatchdogMs)));
      } catch (e) {
        facts.push({ name: r.name, value: null, state: "failed", reason: `routine threw: ${(e as Error).message}` });
      }
    }
    const rec = computeRoundRecord({ round, runId, pid: process.pid, at: new Date().toISOString(), facts, halted });
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
  "每轮评估 due 例程（B15 pool-quality-judge + B17 judgment-consumer-check + 架构复核 + packaging-hygiene）→ 跑 due → 汇集 Facts → 写 round 心跳。",
  "  --root <repo> [--interval <ms>] [--once] [--max-rounds <n>] [--round-log <p>] [--run-id <id>] [--pid-file <p>] [--json]",
  "  --interval <ms>           轮间隔（缺省 30000，来自 drivers.yml quality.interval_ms；测试缝传小值）",
  "  --once                    跑一轮即退出（手动单发 / 测试）",
  "  --max-rounds <n>          跑满 N 轮退出（测试缝，防常驻环无限跑）",
  "  --routine-watchdog <ms>   例程看门狗（毫秒，缺省 30min；测试传小值）",
  "  --pool-judge-interval <m> B15 例程复核间隔（分钟，缺省 10）",
  "  --judgment-interval <m>   B17 例程复核间隔（分钟，缺省 30）",
  "  --arch-review-interval <m> 架构复核例程间隔（分钟，缺省 60）",
  "  --packaging-hygiene-interval <m> 打包卫生例程间隔（分钟，缺省 60）",
  "  --plan-cmd <argv>         覆盖 --plan 命令（测试缝）",
  "  --judge-cmd <argv>        覆盖 LLM judge 命令（测试缝；prompt 由驱动拼，末参数追加）",
  "  --judgment-cmd <argv>     覆盖 judgment-consumer-check 命令（测试缝）",
  "  --identity-cmd <argv>     覆盖 identity-replication-check 命令（测试缝）",
  "  --lineage-cmd <argv>      覆盖 guard-lineage-check 命令（测试缝）",
  "  --deletion-cmd <argv>     覆盖 deletion-closure-check 命令（测试缝）",
  "  --arch-judge-cmd <argv>   覆盖架构复核 LLM judge 命令（测试缝）",
  "  --resource-gate-cmd <argv> 覆盖 resource-gate 命令（测试缝；起 judge 前判定，exit 0=GO）",
  "  --packaging-check-cmd <argv> 覆盖 packaging-hygiene-check 命令（测试缝）",
  "  --packaging-gap-worker-cmd <argv> 覆盖 gap-filing agent 命令（测试缝；prompt 末参数追加）",
  "  --packaging-gap-worker-timeout <ms> gap-filing spawn 上限（毫秒，缺省 900000）",
  "  --arch-gap-worker-cmd <argv> 覆盖架构复核的 gap-filing agent 命令（测试缝；prompt 末参数追加）",
  "  --arch-gap-worker-timeout <ms> 架构复核 gap-filing spawn 上限（毫秒，缺省 900000，与 packaging 同源）",
  "  --probe-runner-cmd <argv> 覆盖 probe 轨道（.quay/config.yml loop.routines: 的 interval 例程）的",
  "                            探针 agent 命令（测试缝；prompt 末参数追加）。⛔ 不传 = 真 LLM spawn",
  "  --probe-state-dir <dir>   probe 轨道的状态目录（载体 routine-findings.jsonl + last-run.json；",
  "                            缺省 <root>/.quay）。测试缝：⛔ 别让测试写进真工作区的载体",
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
  let archReviewIntervalRaw: string | undefined;
  let packagingHygieneIntervalRaw: string | undefined;
  let routineWatchdogRaw: string | undefined;
  let planCmd: string | undefined;
  let judgeCmd: string | undefined;
  let judgmentCmd: string | undefined;
  let identityCmd: string | undefined;
  let lineageCmd: string | undefined;
  let deletionCmd: string | undefined;
  let archJudgeCmd: string | undefined;
  let resourceGateCmd: string | undefined;
  let packagingCheckCmd: string | undefined;
  let packagingGapWorkerCmd: string | undefined;
  let packagingGapWorkerTimeoutRaw: string | undefined;
  let archGapWorkerCmd: string | undefined;
  let archGapWorkerTimeoutRaw: string | undefined;
  let probeRunnerCmd: string | undefined;
  let probeStateDirRaw: string | undefined;

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
    else if (a === "--arch-review-interval") archReviewIntervalRaw = args[++i];
    else if (a === "--packaging-hygiene-interval") packagingHygieneIntervalRaw = args[++i];
    else if (a === "--routine-watchdog") routineWatchdogRaw = args[++i];
    else if (a === "--plan-cmd") planCmd = args[++i];
    else if (a === "--judge-cmd") judgeCmd = args[++i];
    else if (a === "--judgment-cmd") judgmentCmd = args[++i];
    else if (a === "--identity-cmd") identityCmd = args[++i];
    else if (a === "--lineage-cmd") lineageCmd = args[++i];
    else if (a === "--deletion-cmd") deletionCmd = args[++i];
    else if (a === "--arch-judge-cmd") archJudgeCmd = args[++i];
    else if (a === "--resource-gate-cmd") resourceGateCmd = args[++i];
    else if (a === "--packaging-check-cmd") packagingCheckCmd = args[++i];
    else if (a === "--packaging-gap-worker-cmd") packagingGapWorkerCmd = args[++i];
    else if (a === "--packaging-gap-worker-timeout") packagingGapWorkerTimeoutRaw = args[++i];
    else if (a === "--arch-gap-worker-cmd") archGapWorkerCmd = args[++i];
    else if (a === "--arch-gap-worker-timeout") archGapWorkerTimeoutRaw = args[++i];
    else if (a === "--probe-runner-cmd") probeRunnerCmd = args[++i];
    else if (a === "--probe-state-dir") probeStateDirRaw = args[++i];
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
  const archReviewIntervalMinutes = archReviewIntervalRaw !== undefined && isNonNegInt(archReviewIntervalRaw)
    ? Number(archReviewIntervalRaw) : ARCH_REVIEW_INTERVAL_MIN_DEFAULT;
  const packagingHygieneIntervalMinutes = packagingHygieneIntervalRaw !== undefined && isNonNegInt(packagingHygieneIntervalRaw)
    ? Number(packagingHygieneIntervalRaw) : PACKAGING_HYGIENE_INTERVAL_MIN_DEFAULT;
  const packagingGapWorkerTimeoutMs = packagingGapWorkerTimeoutRaw !== undefined && isNonNegInt(packagingGapWorkerTimeoutRaw)
    ? Number(packagingGapWorkerTimeoutRaw) : PACKAGING_GAP_WORKER_TIMEOUT_MS_DEFAULT;
  const archGapWorkerTimeoutMs = archGapWorkerTimeoutRaw !== undefined && isNonNegInt(archGapWorkerTimeoutRaw)
    ? Number(archGapWorkerTimeoutRaw) : ARCH_GAP_WORKER_TIMEOUT_MS_DEFAULT;
  const routineWatchdogMs = routineWatchdogRaw !== undefined && isNonNegInt(routineWatchdogRaw)
    ? Number(routineWatchdogRaw) : ROUTINE_WATCHDOG_MS_DEFAULT;

  // 心跳落点 = .quay/。ROUND_LOG_REL 是 .quay/-相对路径（registry carriers[0]），⛔ 直接 join rootDir
  // 会把心跳写到 repo-root quality-round.jsonl，与 driver-runtime carrierStats 读 .quay/ 分叉 ⇒
  // liveness 监测读不到心跳、假报 stall（gap-meta-round-log-rel）。
  const roundLogFile = roundLogPath ? path.resolve(roundLogPath) : path.join(rootDir, ".quay", ROUND_LOG_REL);
  const resolvedRunId = runId || `qg-${Date.now()}`;

  // probe 轨道（SPEC §5.2）：声明在 `.quay/config.yml` `loop.routines:` 里、由本 driver 的例程表承载。
  // spawn 上限**从例程看门狗派生**（⛔ 不另立字面量，硬规则 4 推论二）：探针必须在看门狗判定之前
  // 自己返回，否则被放弃的是仍在跑的 spawn（子进程泄漏 + 记一条 failed 而真相未知）。
  const probeTimeoutMs = Math.max(60_000, routineWatchdogMs - 60_000);
  const probeStateDir = probeStateDirRaw ? path.resolve(probeStateDirRaw) : undefined;
  const probeArgv = probeRunnerCmd
    ? (prompt: string) => {
      const prefix = splitArgs(probeRunnerCmd as string);
      return prefix.length === 0 ? launchArgv(PROBE_ROLE_DEFAULT, prompt, rootDir) : [...prefix, prompt];
    }
    : undefined;
  const probeSelection = probeRoutinesFromConfig(rootDir, {
    pluginRoot: path.join(rootDir, "plugin"),
    probeTimeoutMs,
    ...(probeStateDir ? { stateDir: probeStateDir } : {}),
    ...(probeArgv ? { probeArgv } : {}),
  });
  // ⛔ 可见地报告跳过/读不出的例程：一条声明了却不被驱动的 routine，与「没有这条声明」在记录上
  //    本来同形（硬规则 3b/9），故此处把理由打到 stderr（配置坏了 ⇒ driver 照常起，但说出原因）。
  if (probeSelection.error) {
    console.error(`quality-gate-driver: probe 轨道未装配 — ${probeSelection.error}`);
  }
  for (const s of probeSelection.skipped) {
    console.error(`quality-gate-driver: routine "${s.name}" (${s.trigger}) 未被 probe 轨道驱动 — ${s.reason}`);
  }
  if (probeSelection.routines.length > 0) {
    console.error(`quality-gate-driver: probe 轨道已装配 ${probeSelection.routines.length} 条例程（${probeSelection.routines.map((r) => r.name).join(", ")}）`);
  }

  const routines = qualityGateRoutines(rootDir, {
    planCmd: planCmd ? splitArgs(planCmd) : null,
    judgeArgv: judgeCmd ? splitArgs(judgeCmd) : null,
    judgmentCmd: judgmentCmd ? splitArgs(judgmentCmd) : null,
    identityCmd: identityCmd ? splitArgs(identityCmd) : null,
    lineageCmd: lineageCmd ? splitArgs(lineageCmd) : null,
    deletionCmd: deletionCmd ? splitArgs(deletionCmd) : null,
    archJudgeArgv: archJudgeCmd ? splitArgs(archJudgeCmd) : null,
    resourceGateArgv: resourceGateCmd ? splitArgs(resourceGateCmd) : null,
    poolJudgeIntervalMinutes,
    judgmentIntervalMinutes,
    archReviewIntervalMinutes,
    packagingCheckCmd: packagingCheckCmd ? splitArgs(packagingCheckCmd) : null,
    packagingGapWorkerCmd: packagingGapWorkerCmd ?? null,
    packagingGapWorkerTimeoutMs,
    packagingHygieneIntervalMinutes,
    archGapWorkerCmd: archGapWorkerCmd ?? null,
    archGapWorkerTimeoutMs,
    probeRoutines: probeSelection.routines,
  });

  return runResidentQualityGateLoop({ root: rootDir, intervalMs: interval, once, maxRounds, roundLogFile, runId: resolvedRunId, json, pidFile, routines, routineWatchdogMs, kind: "quality" });
}

// Direct entry guard (gate-script-base convention)：仅当本文件是入口时跑 main()。
if (isDirectEntry(import.meta, undefined, "quality-gate-driver")) {
  main(process.argv).then((code) => { process.exitCode = code; });
}
