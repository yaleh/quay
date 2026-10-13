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
import { parse as parseYaml } from "yaml";
import { isDirectEntry } from "./gate-script-base.ts";
// 同族例程的 trigger 解析器（`interval:<N>m` 的单一实现——⛔ 不再写第二个正则，
// arch_discovery / cross_project_dogfood / probe 轨道都经它解析各自的 interval 声明）。
import { parseTrigger } from "./routine-scheduler.ts";
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
  residentLoopStop,
  resourceGateCheck,
  kernelSiblingArgv,
  splitArgs,
  isNonNegInt,
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
// arch-DISCOVERY 轨道（gap-arch-discovery-not-wired-into-routine-track-report-only）：把两个已验证的
// 静态仪器（docs/analysis/arch-discovery-{space,time}.mjs）的 `--scan` 接上轮子。**只读、只报**——
// 该例程不 import 任何立案/撰写函数，唯一持久化是 gitignored 载体 + 既有的 quality-round Fact。
// ⛔ 与 fan-in/scoped-gate 无关（同上：深扫更不能上每任务必经的热路径）。
import { archDiscoveryRoutineFromConfig } from "./arch-discovery-routine.ts";
// DISCOVERY-METHOD 轨道（gap-discovery-method-routine-report-only）：把已落地的 Discovery Method loop
// （docs/analysis/discovery-{experience-ledger,reflection,method-registry}.mjs）接上轮子——每轮
// watermarked ingest → 一次有界 reflect → 对新候选的 held-out 泛化验证。**只读、只报**：该例程不 import
// 任何立案/撰写函数，唯一新增持久化是 gitignored 载体 `.quay/discovery-method-findings.jsonl` 的一行
// scan-round + 既有 Discovery 载体 + 既有的 quality-round Fact。⛔ 与 fan-in/scoped-gate 无关。
import { classifyModelFailure, discoveryMethodRoutineFromConfig, liveDiscoveryModel, readDiscoveryMethodConfig } from "./discovery-method-routine.ts";
// OPEN-SEMANTIC-DISCOVERY 轨道（gap-open-semantic-discovery-routine-track）：把**开放式语义架构发现**
// （docs/analysis/arch-hypothesis-generation.mjs —— 假设生成 + 读源码核实 + 独立反驳 + 价值评估）接上例程环。
// **只读、只报**：该例程不 import 任何立案/撰写函数，唯一新增持久化是 gitignored 载体
// `.quay/open-semantic-discovery-findings.jsonl` 的一行 scan-round + 每簇记录，外加它自己那份预留台账。
// ⛔ 与 fan-in/scoped-gate 无关。
// 架构复核 judge 调用的**失败归因 + 有界重试**也从 OSD 来（gap-architecture-review-judge-call-shares-
// no-diagnostics-or-retry-with-osd，硬规则 5b：修好一个实例 ≠ 修好一类）。⛔ 不复刻第二套分类器/
// 流读取器/捕获写端——`callFailureClass`（枚举类）、`RETRYABLE_CALL_FAILURES`（可重试类清单）、
// `writeCallCapture`（有界 head/tail 捕获取证）、`loadStreamDiagnostics`（【同一个】engine 流读取器）
// 全部是 OSD 已有的单一实现。**范围**：只接在 judge（真 LLM 调用）上——三个机械检测器是本地脚本
// spawn，`callFailureClass` 的 `claude -p` 流分类表对它们不适用（它们的既有 terminal-on-error 行为不动）。
import {
  openSemanticDiscoveryRoutineFromConfig,
  RETRYABLE_CALL_FAILURES,
  RETRY_BACKOFF_MS,
  callFailureClass,
  writeCallCapture,
  loadStreamDiagnostics,
} from "./open-semantic-discovery-routine.ts";
// CROSS-PROJECT-DOGFOOD 轨道（gap-cross-project-semantic-dogfooding-routine-configurable-source-projects）：
// 同族的第五条语义例程，**主语不同**——它的输入不是本仓库的源码，而是**别的 Quay 宿主项目真实使用载体**
// （tasks/、worker-outcome、fan-in 升级/重试、needs-human 原因）的一段有界近期切片。**只读、只报**：源项目
// 一律只读打开（无任何 fs 写到达已声明源根；模型子进程 cwd 是本轮 scratch，⛔ 不是源项目，工具面只有
// Read/Grep/Glob），唯一新增持久化是 gitignored 载体 `.quay/cross-project-dogfood-findings.jsonl` + 它自己
// 那份预留台账；confirmed 的发现才写 Portfolio / 经 ABI 立一条 todo。⛔ 与 fan-in/scoped-gate 无关。
import { crossProjectDogfoodRoutineFromConfig } from "./cross-project-dogfood-routine.ts";

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

// ── 失败面诊断片段（gap-cross-project-dogfood-quay-self-usage-c1-a7wnts）───────────────────────

/** 把仪器 / LLM judge 的原始 stdout 压成【单行、有界】的诊断片段，供失败 reason 携带。
 *
 *  why：读不懂输出的失败路径此前只写一条【固定】reason 串（如 `judge output not a JSON array`），
 *  原始输出被丢弃 ⇒ operator 分不清失败到底是 markdown 围栏、prose 前言、空输出、还是「对象而非
 *  数组」——`.quay/quality-round.jsonl` 里 33 条 failed 正是这条（同族证据：`unparseable --plan
 *  output (exit 1)`）。**失败必须可诊断**：judge-exit 分支本就把 stderr slice(0,200) 并入 reason，
 *  本 helper 让「读不懂」分支同形。
 *  有界：先压单行（⛔ 防多行输出把载体行撕开），再截到 ≤max 字符（防一条巨型输出撑爆载体行）；
 *  空输出显式标注（空 ≠ 有内容）；截断带 `+N chars`，使「输出其实很大」不被误读成「输出就这么点」。
 *  ⛔ 不改变 state（failed 仍是 failed，not-evaluated 仍是 not-evaluated）——只让失败可诊断。 */
export function diagnosticExcerpt(raw: unknown, max = 500): string {
  const oneLine = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (oneLine === "") return "(empty output)";
  return oneLine.length > max ? `${oneLine.slice(0, max)}…(+${oneLine.length - max} chars, truncated)` : oneLine;
}

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
    return { name: "judgment-consumer-check", value: null, state: "not-evaluated", reason: `unparseable output (exit ${r.status}): ${diagnosticExcerpt(r.stdout)}` };
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
    return { name: "packaging-hygiene", value: null, state: "not-evaluated", reason: `unparseable output (exit ${r.status}): ${diagnosticExcerpt(r.stdout)}` };
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
    return { name: "pool-quality-judge", value: null, state: "not-evaluated", reason: `unparseable --plan output (exit ${planR.status}): ${diagnosticExcerpt(planR.stdout)}` };
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
    const reason = `judge output not a JSON array: ${diagnosticExcerpt(judgeR.stdout)}`;
    writeRecord(failedQualityRoundRecord(root, plan.triggers.reasons, reason));
    return { name: "pool-quality-judge", value: base, state: "failed", reason };
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

/** 一条检测器 argv 的【脚本解析半边】——单一实现，⛔ 三个 builder 不各拼一次。
 *
 *  WHY NOT `path.join(root, "plugin", "scripts", <name>)`（2026-10-13，本任务的 Gap 2）：
 *  那条拼接里 `root` 是**被分析的 TARGET 工作区**，而检测器脚本是**本 kernel 自己的 sibling**。
 *  两者只在「root 恰好就是 quay 自己的开发检出」时重合——那正是本仓库 dev-loop 的常态，所以它
 *  结构上无法在自测里暴露：换到任何别的宿主（装了插件、自己的项目根下没有 `plugin/scripts/`），
 *  每次 spawn 都 ENOENT ⇒ `runArchitectureReview` 每轮返回
 *  `not-evaluated: identity-replication spawn error: …`，永远如此。这与
 *  `gap-drivers-resolve-quay-scripts-under-project-root-not-plugin-root`（2026-09-13 第三方项目实测）
 *  是同一类缺陷，`resolveKernelScriptsDir()`（⛔ 不是 opts.root，AC-203）是该类缺陷的既定单一入口。
 *  `--root` 仍传 TARGET root（那部分本来就对：它是【被分析的东西】，⛔ 不是检测器代码住哪）。
 *
 *  ⛔ 但「用对了目录解析器」不等于「解析得到产物」——**那条 `.ts` 直跑形态在只有 dist 的出厂安装里
 *  结构性 ENOENT**（2026-10-14 实测，`gap-architecture-review-detectors-not-runnable-off-quay-repo`）：
 *  官方 dist-plugin 产物里 `<plugin>/scripts/identity-replication-check.ts` 不存在、
 *  `<plugin>/scripts/dist/identity-replication-check.js` 存在 ⇒ `node --experimental-strip-types
 *  <不存在的 .ts>` exit 1、stdout 空 ⇒ 每轮 `unparseable identity-replication output (exit 1)`（真实宿主
 *  ClaudeCodeUI 上 164 次全此形）。**同类机件的既定单一入口是 `driver-runtime.kernelSiblingArgv()`**
 *  （它做 `.ts`→`scripts/dist/<name>.js` 回退、按形态选解释器、都缺席时返回 null）——旧注释把「换过去」
 *  记作「另一件事」，实际它才是**同一件事的另一半**（硬规则 5b：修好一个实例 ≠ 修好一类）。
 *
 *  ⛔ 同时，**每个 builder 里的脚本名是出厂产物的入口派生源**：`build-plugin-dist.mjs` 的
 *  `scanPluginSiblingReferences` 按 `kernelSiblingArgv` + 字面 `<name>.ts` 这个 SHAPE 派生 bundle
 *  入口 ⇒ 在 builder 里写一个字面脚本名 = 该脚本随产物出厂，不需要改构建脚本（单一真相源；旧形态
 *  `path.join(<dir>, "<name>.ts")` 正是那条扫描覆盖不到、于是两个检测器在产物里**整份消失**的形状）。
 *  ⛔ 不要再插入一层把名字变成参数的包装：那样名字退化成变量，派生面重新变瞎（本任务实测）。 */

/** 缺省 identity-replication-check --json 命令（P2 身份复制）。 */
export function defaultIdentityReplicationArgv(root: string): string[] | null {
  return kernelSiblingArgv("identity-replication-check.ts", ["--root", root, "--json"]);
}

/** 缺省 guard-lineage-check --json 命令（P4 守卫谱系）。 */
export function defaultGuardLineageArgv(root: string): string[] | null {
  return kernelSiblingArgv("guard-lineage-check.ts", ["--root", root, "--json"]);
}

/** 缺省 deletion-closure-check --json 命令（P1 删除闭包）。components 由 identity 报告推导（硬编码
 *  实体）；无候选构件时不 spawn 本检测器。构件必须在脚本与 --root 之间（既有位置语义不变）。 */
export function defaultDeletionClosureArgv(root: string, components: string[]): string[] | null {
  return kernelSiblingArgv("deletion-closure-check.ts", [...components, "--root", root, "--json"]);
}

/** 检测器脚本体解析不出的统一 fail-closed 读数（硬规则 3b：不是 spawn error、不是「跑过了」，
 *  而是一个**具名的、可区分的**未评估态；token 点名是哪一个检测器）。 */
export function detectorUnresolvedFact(name: string): Fact<null> {
  return {
    name: "architecture-review",
    value: null,
    state: "not-evaluated",
    reason: `not-evaluated:detector-script-unresolved:${name} (kernel install carries neither the raw .ts nor scripts/dist/<name>.js — see resolveKernelSibling)`,
  };
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

// ── judge 调用的失败归因 + 有界重试（gap-architecture-review-judge-call-shares-no-diagnostics-or-retry-with-osd）──

/** judge 调用的有界 head/tail 捕获目录。⛔ 与 OSD 的 `.quay/open-semantic-discovery-call-captures` 同形
 *  的**兄弟**目录而非共用同一个：两条例程的调用 id 空间不同，混住会让「这行是哪条例程写的」不可读；
 *  而「同形」正是要保住的那一点——两处的捕获都是 `writeCallCapture` 的同一实现写的。 */
export const ARCH_REVIEW_CALL_CAPTURE_DIR_REL = path.posix.join(".quay", "architecture-review-call-captures");

/** 本 routine 给【失败】的 judge 轮记录追加的诊断字段（与 OSD 调用记录同名同义）。
 *  ⛔ `ArchReviewRoundRecord` 本体住在 `architecture-review-cluster.ts`（不在本任务 Touches）⇒ 由本
 *  driver 在写载体前按**同一 JSON 形状**附加，⛔ 不改兄弟模块的公开接口（硬规则 5：既有的 `reason`
 *  字段【保留】——下游读 `.quay/architecture-review-round.jsonl` 的消费者靠它）。 */
export interface ArchReviewJudgeDiagnostics {
  /** 复用的 `callFailureClass` 读出的枚举类；`null` = 字节自带 `result` 事件（「读不懂」与「没东西可报」
   *  不同形，硬规则 3b）。 */
  call_failure?: string | null;
  stdout_bytes?: number;
  has_result?: boolean;
  api_error_event?: boolean;
  /** `writeCallCapture` 的有界描述（含 path/bytes/截断标志）；写失败时 `{path:null,error}`。 */
  stdout_capture?: Record<string, unknown> | null;
  /** 本次失败调用**之后**是否还发过一次重试（可重试类才可能为 true）。 */
  retry_attempted?: boolean;
  /** 重试被【资源门】拒绝的原因（本 routine 的支出闸；⛔ 不是第二个预算台账）。null = 未发生拒绝。 */
  retry_refused?: string | null;
}

/** 一次 judge 调用（含其字节读数与分类）的读数。三处失败分支与重试判定都只读这一个对象，⛔ 不各自
 *  重解析一遍 stdout（第二套解析必然是第二套真相）。 */
interface ArchReviewJudgeAttempt {
  r: { status: number | null; stdout: string; stderr: string; error: Error | null };
  /** judge 输出的逐簇判词；`null` = stdout 不是 JSON 数组（⛔ 与「判过但为空」不同形，硬规则 3b）。 */
  verdicts: JudgeClusterVerdict[] | null;
  /** 复用的 `callFailureClass` 读数。 */
  failure: string | null;
  apiErrorEvent: boolean;
  hasResult: boolean;
  stdoutBytes: number;
  diagnostic: string;
  capture: Record<string, unknown> | null;
}

/** 一次 judge 调用是否【产出了可用判词】。⛔ `false` 同时覆盖「进程失败」与「进程成功但输出读不出
 *  判词」——两者都不是「判过」。PURE。 */
function judgeAttemptAnswered(a: ArchReviewJudgeAttempt): boolean {
  return a.r.error === null && a.r.status === 0 && a.verdicts !== null && a.verdicts.length > 0;
}

/** 架构复核例程：机械聚类（三个检测器 --json）→ 命中则 LLM judge → JS 合并 → 判词载体
 *  （.quay/architecture-review-round.jsonl）。读不懂任一检测器输出 ⇒ not-evaluated（硬规则 3b）；
 *  judge 失败/判词为空 ⇒ failed（落 failed 载体记录）；候选簇为空 ⇒ not-triggered（fired=false 是
 *  真实测量，非「读不懂装合格」）。
 *  ⛔ 循环体异步化（同 B15 的 runAsync 修法）；judge（真实 claude -p）不设固定字面量上限（缺省
 *  unbounded）；judgeTimeoutMs 是负控制缝（测试注入「明显不够的值」），生产缺省 Infinity。
 *
 *  judge 调用的失败归因与**恰一次**重试（gap-architecture-review-judge-call-shares-no-diagnostics-
 *  or-retry-with-osd）：可重试类（`RETRYABLE_CALL_FAILURES`）失败后经退避重发一次，重发**前**重读
 *  资源门（本 routine 的支出闸——⛔ 不新开预算台账、⛔ 不改任何 config 上限）。`judgeRetryBackoffMs`
 *  是退避缝（测试传 0 ⇒ 不 sleep），生产缺省 = OSD 的 `RETRY_BACKOFF_MS`。 */
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
  judgeRetryBackoffMs: number = RETRY_BACKOFF_MS,
): Promise<Fact<ArchReviewFactValue | null>> {
  // 1. P2 身份复制（必需——既产 P2 簇又推导 P1 候选构件）。
  const identityArgv = identityCmd ?? defaultIdentityReplicationArgv(root);
  // ⛔ 解析不到脚本体 ⇒ not-evaluated（硬规则 3b：不得 spawn 一个不存在的路径再把它读成「跑过且无数据」）。
  if (identityArgv === null) return detectorUnresolvedFact("identity-replication-check.ts");
  const identityR = await runAsync(identityArgv, { timeoutMs: ROUTINE_TIMEOUT_MS });
  if (identityR.error) {
    return { name: "architecture-review", value: null, state: "not-evaluated", reason: `identity-replication spawn error: ${identityR.error.message}` };
  }
  const identity = parseDetectorJson<IdentityReportView>(identityR.stdout ?? "");
  if (identity === null) {
    return { name: "architecture-review", value: null, state: "not-evaluated", reason: `unparseable identity-replication output (exit ${identityR.status}): ${diagnosticExcerpt(identityR.stdout)}` };
  }

  // 2. P4 守卫谱系（必需）。
  const lineageArgv = lineageCmd ?? defaultGuardLineageArgv(root);
  if (lineageArgv === null) return detectorUnresolvedFact("guard-lineage-check.ts");
  const lineageR = await runAsync(lineageArgv, { timeoutMs: ROUTINE_TIMEOUT_MS });
  if (lineageR.error) {
    return { name: "architecture-review", value: null, state: "not-evaluated", reason: `guard-lineage spawn error: ${lineageR.error.message}` };
  }
  const lineage = parseDetectorJson<LineageReportView>(lineageR.stdout ?? "");
  if (lineage === null) {
    return { name: "architecture-review", value: null, state: "not-evaluated", reason: `unparseable guard-lineage output (exit ${lineageR.status}): ${diagnosticExcerpt(lineageR.stdout)}` };
  }

  // 3. P1 删除闭包（候选构件由 identity 报告推导；无候选 ⇒ 空报告，跳过 spawn）。
  const components = deletionClosureComponents(identity);
  let deletion: DeletionReportView = { components: [], dc: [], counts: { dcTotal: 0, callGraphTotal: 0, ratio: null } };
  if (components.length > 0) {
    const deletionArgv = deletionCmd ?? defaultDeletionClosureArgv(root, components);
    if (deletionArgv === null) return detectorUnresolvedFact("deletion-closure-check.ts");
    const deletionR = await runAsync(deletionArgv, { timeoutMs: ROUTINE_TIMEOUT_MS });
    if (deletionR.error) {
      return { name: "architecture-review", value: null, state: "not-evaluated", reason: `deletion-closure spawn error: ${deletionR.error.message}` };
    }
    const parsed = parseDetectorJson<DeletionReportView>(deletionR.stdout ?? "");
    if (parsed === null) {
      return { name: "architecture-review", value: null, state: "not-evaluated", reason: `unparseable deletion-closure output (exit ${deletionR.status}): ${diagnosticExcerpt(deletionR.stdout)}` };
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

  // 7. LLM judge（真实 claude -p，单批）。失败归因/有界重试【复用 OSD 机件】（硬规则 5b）。
  const argv = judgeArgv ?? defaultArchReviewJudgeArgv(clusters, root);
  // ⛔ 取不到流读取器 ⇒ 分类与重试边界都无从谈起 ⇒ fail-closed 成 not-evaluated（硬规则 3b）。
  //    ⛔ 也不是 failed：failed 需要一个分类读数，而正是它读不出——「读不懂」不得伪装成任一合格态。
  let streamDiagnostics: Awaited<ReturnType<typeof loadStreamDiagnostics>>;
  try {
    streamDiagnostics = await loadStreamDiagnostics(root);
  } catch (e) {
    return { name: "architecture-review", value: base, state: "not-evaluated", reason: `judge stream reader unresolved: ${(e as Error).message}` };
  }

  const captureDir = path.join(root, ARCH_REVIEW_CALL_CAPTURE_DIR_REL);
  /** ONE ATTEMPT：spawn → 读字节 → 分类 → 记捕获。⛔ 从调用点提出【同一个函数】，重试就是同一次调用
   *  再做一遍——不是第二条会漂移的代码路径（硬规则 5b，同 OSD `attemptCall` 的形状）。 */
  const attemptJudge = async (attemptNo: number): Promise<ArchReviewJudgeAttempt> => {
    const r = await runAsync(argv, { timeoutMs: judgeTimeoutMs, collectStderr: true });
    const stdout = String(r.stdout ?? "");
    const stderr = String(r.stderr ?? "");
    const diag = streamDiagnostics(stdout);
    // ⛔ 超时是【自己的】一种收尾（子进程被 SIGKILL、无 exit code），复用 discovery-method 的分类器
    //    ——`killed-by-timeout` 正是重试策略不该命中的那一类（它不在 RETRYABLE_CALL_FAILURES 里）。
    const timedOut = r.error ? classifyModelFailure(r.error) === "timeout" : false;
    const stdoutBytes = typeof diag.bytes === "number" ? diag.bytes : Buffer.byteLength(stdout, "utf8");
    const hasResult = diag.has_result === true;
    const apiErrorEvent = diag.api_error_event === true;
    const failure = callFailureClass({
      timed_out: timedOut, stdout_bytes: stdoutBytes,
      json_lines: diag.json_lines, truncated_json: diag.truncated_json,
      api_error_event: apiErrorEvent, has_result: hasResult,
    });
    let verdicts: JudgeClusterVerdict[] | null = null;
    try {
      const parsed = JSON.parse(stdout.trim());
      if (Array.isArray(parsed)) verdicts = parsed;
    } catch { /* 非 JSON ⇒ verdicts 保持 null（⛔ 不伪装成「判过但为空」） */ }
    // 捕获：只在**没有产出可用判词**的调用上留痕（与 OSD 同形——成功调用的判词已逐簇落在载体上，
    // 再存一份流就是 transcript 而不是诊断）。写失败【报在记录上】，⛔ 不是静默缺失（硬规则 3b：
    // 「无字节可看」与「没有捕获文件」必须不同形）。
    let capture: Record<string, unknown> | null = null;
    const attempt: ArchReviewJudgeAttempt = { r, verdicts, failure, apiErrorEvent, hasResult, stdoutBytes, diagnostic: diagnosticExcerpt(stdout), capture: null };
    if (!judgeAttemptAnswered(attempt)) {
      try {
        capture = writeCallCapture(root, path.join(captureDir, `arch-judge-${process.pid}-${attemptNo}-${Date.now()}.txt`), { stdout, stderr });
      } catch (e) {
        capture = { path: null, error: String((e as Error).message ?? e).slice(0, 200) };
      }
      attempt.capture = capture;
    }
    return attempt;
  };

  // ── 恰一次重试（仅 RETRYABLE 类）────────────────────────────────────────────────────────────────
  const first = await attemptJudge(0);
  const firstFailure = first.failure;
  let attempt = first;
  let retryAttempted = false;
  let retryRefused: string | null = null;
  if (!judgeAttemptAnswered(first) && firstFailure !== null && RETRYABLE_CALL_FAILURES.includes(firstFailure)) {
    if (judgeRetryBackoffMs > 0) await new Promise((resolve) => setTimeout(resolve, judgeRetryBackoffMs));
    // 重试前重读【资源门】——本 routine 的支出闸就是它（⛔ 没有第二条预算台账，⛔ 不改任何 config
    // 上限）：重试的支出记在同一条闸上，不加并行额度。WAIT ⇒ 重试被拒，保留第一次调用的读数并落
    // failed（「闸拒绝时就不重试」，同 OSD「台账拒绝时不重试」）。
    const regate = resourceGateCheck(root, resourceGateArgv);
    if (!regate.go) {
      retryRefused = regate.reason;
    } else {
      attempt = await attemptJudge(1);
      retryAttempted = true;
    }
  }

  // 失败面：三态 reason 前缀【逐字保留】（下游 grep 不回归），后缀附上复用分类器的读数与重试结果。
  const retryNote = retryAttempted
    ? `; retried once (first=${firstFailure})`
    : retryRefused !== null
      ? `; retry refused by resource gate: ${retryRefused}`
      : "";
  const diagSuffix = ` [call_failure=${attempt.failure ?? "null"}${retryNote}]`;
  const failedRecord = (reason: string): ArchReviewRoundRecord & ArchReviewJudgeDiagnostics => ({
    ...buildArchReviewRoundRecord({
      round: readCurrentRound(root), judgedAt: new Date().toISOString(), state: "failed",
      triggerReasons: trigger.reasons, clusters: [], reason,
    }),
    call_failure: attempt.failure,
    stdout_bytes: attempt.stdoutBytes,
    has_result: attempt.hasResult,
    api_error_event: attempt.apiErrorEvent,
    stdout_capture: attempt.capture,
    retry_attempted: retryAttempted,
    retry_refused: retryRefused,
  });

  if (attempt.r.error || attempt.r.status !== 0) {
    const reason = `judge exited ${attempt.r.status ?? "null"}: ${attempt.r.error?.message ?? String(attempt.r.stderr ?? "").slice(0, 200)}${diagSuffix}`;
    writeRecord(failedRecord(reason));
    return { name: "architecture-review", value: base, state: "failed", reason };
  }
  if (attempt.verdicts === null) {
    const reason = `judge output not a JSON array: ${attempt.diagnostic}${diagSuffix}`;
    writeRecord(failedRecord(reason));
    return { name: "architecture-review", value: base, state: "failed", reason };
  }

  // 8. JS 合并（判词 → 逐簇载体记录）。判词为空 ⇒ failed（⛔ 不写空 judged 记录）。
  const verdicts: JudgeClusterVerdict[] = attempt.verdicts;
  const judgedAt = new Date().toISOString();
  const round = readCurrentRound(root);
  const merged: ArchReviewClusterVerdict[] = mergeClusterVerdicts(clusters, verdicts, judgedAt, round);
  if (merged.length === 0) {
    const reason = `judge produced no valid cluster verdicts: ${attempt.diagnostic}${diagSuffix}`;
    writeRecord(failedRecord(reason));
    return { name: "architecture-review", value: base, state: "failed", reason };
  }
  const distribution: Record<string, number> = {};
  for (const m of merged) distribution[m.verdict] = (distribution[m.verdict] ?? 0) + 1;
  writeRecord(buildArchReviewRoundRecord({ round, judgedAt, state: "judged", triggerReasons: trigger.reasons, clusters: merged }));

  // 9. 语义结论 → 既有立案通道（gap-arch-review-judge-verdicts-never-reach-the-existing-gap-filing-
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

// ── 架构复核的 config 入口（`.quay/config.yml` `loop.architecture_review:`）─────────────────────
// Gap 1（本任务）：同族五条例程各自经 `read<Name>Config(rootDir)` 从 config 段装配
// （readDiscoveryMethodConfig / readArchDiscoveryConfig / readCrossProjectDogfoodConfig…），
// 而 architecture-review 此前**只能**由 CLI flag `--arch-review-interval` 驱动（缺省落到
// ARCH_REVIEW_INTERVAL_MIN_DEFAULT）——宿主既不能启停也不能改节奏，它不是一个 operator 可编辑的
// 每项目设置。本段把它接成同族的第六条：`.quay/config.yml`
//   loop:
//     architecture_review:
//       enabled: true
//       interval: "interval:60m"
// 与同族的两点差异（不是抄漏，是主语不同，逐条写出以免读者以为本段写坏了）：
//   ① **默认是开**（这座例程本来就是内建的四条之一），故「段缺席」= 老行为（enabled + CLI/缺省节奏），
//      ⛔ 不是同族 declarative 例程的「段缺席 ⇒ 不装配」。`enabled` 在段内是**必填**布尔（同族判据），
//      于是「只想改节奏、忘了写 enabled」会 fail-closed 报出来，⛔ 不会被读成「悄悄关掉」。
//   ② 节奏的优先级 = **显式 CLI flag > config > 硬编码缺省**（与 `QUAY_PLUGIN_ROOT` 同族的接法）。
//      CLI flag 保留（本仓库 dev-loop 与既有测试都用它），只是不再是唯一入口。
// 「读不懂 ⇒ 不许伪装成合格」（硬规则 3b）：段写坏 ⇒ 例程仍装配，但每轮记 `failed` + 零 spawn，
// ⛔ 不回退到缺省节奏照跑——那会让一个写坏的声明与「声明正确」在读数上同形。
/** `loop.architecture_review:` 的解析结果。`enabled:false` ⇒ `intervalMinutes:null`（不参与调度）。 */
export interface ArchitectureReviewConfig {
  enabled: boolean;
  intervalMinutes: number | null;
}

/** `present` = 段存在；`config` = 解析结果（段写坏时 null）；`error` = fail-closed 理由。 */
export interface ArchitectureReviewConfigRead {
  present: boolean;
  config: ArchitectureReviewConfig | null;
  error: string | null;
}

/** 节奏下限（分钟）——与同族两条例程（arch_discovery / cross_project_dogfood 的
 *  `MIN_INTERVAL_MINUTES = 60`）取同一个界：一轮要 spawn 三个 node 检测器（+ 命中时的 LLM judge），
 *  低于此界的一轮不是「更快」，是把成本乘上去 ⇒ 拒绝而不是静默取整。 */
export const ARCH_REVIEW_MIN_INTERVAL_MINUTES = 60;

const cfgBad = (msg: string) => `loop.architecture_review ${msg}`;

/** 纯解析一个 `loop.architecture_review` 值。`enabled` 必填且为布尔；disabled 段立即返回（kill switch
 *  必须在别的键缺席/写坏时也能生效）；enabled 段必须携带合法的 `interval:<N>m` 且不低于下限。 */
export function parseArchitectureReviewSection(raw: unknown): { config: ArchitectureReviewConfig | null; error: string | null } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { config: null, error: cfgBad(`must be a mapping (got ${Array.isArray(raw) ? "array" : raw === null ? "null" : typeof raw})`) };
  }
  const rec = raw as Record<string, unknown>;
  if (typeof rec.enabled !== "boolean") {
    return { config: null, error: cfgBad(`needs a boolean 'enabled' (got ${rec.enabled === undefined ? "missing" : JSON.stringify(rec.enabled)})`) };
  }
  if (rec.enabled === false) return { config: { enabled: false, intervalMinutes: null }, error: null };
  if (typeof rec.interval !== "string") {
    return { config: null, error: cfgBad(`needs an 'interval' string of the form interval:<N>m (got ${rec.interval === undefined ? "missing" : JSON.stringify(rec.interval)})`) };
  }
  let trigger: { kind: string; minutes?: number };
  try {
    trigger = parseTrigger(rec.interval) as { kind: string; minutes?: number };
  } catch (e) {
    return { config: null, error: cfgBad(`invalid 'interval' — ${(e as Error).message}`) };
  }
  if (trigger.kind !== "interval" || typeof trigger.minutes !== "number") {
    return { config: null, error: cfgBad(`'interval' must be interval:<N>m (got kind '${trigger.kind}')`) };
  }
  if (trigger.minutes < ARCH_REVIEW_MIN_INTERVAL_MINUTES) {
    return { config: null, error: cfgBad(`interval ${trigger.minutes}m is below the ${ARCH_REVIEW_MIN_INTERVAL_MINUTES}m floor — refused, not silently rounded`) };
  }
  return { config: { enabled: true, intervalMinutes: trigger.minutes }, error: null };
}

/** 读 `.quay/config.yml` `loop.architecture_review:`（同族读法：无 config 文件 / 无 `loop:` / 无段
 *  ⇒ `present:false`；YAML 或段写坏 ⇒ `error` 置位，fail-closed）。 */
export function readArchitectureReviewConfig(workspaceRoot: string): ArchitectureReviewConfigRead {
  const file = path.join(workspaceRoot, ".quay", "config.yml");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { present: false, config: null, error: null };
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (e) {
    return { present: true, config: null, error: `.quay/config.yml is not valid YAML — ${(e as Error).message}` };
  }
  const loop = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).loop : undefined;
  if (loop === null || loop === undefined) return { present: false, config: null, error: null };
  if (typeof loop !== "object" || Array.isArray(loop)) return { present: true, config: null, error: "FAIL-CLOSED: .quay/config.yml 'loop:' must be a mapping" };
  const raw = (loop as Record<string, unknown>).architecture_review;
  if (raw === undefined || raw === null) return { present: false, config: null, error: null };
  const { config, error } = parseArchitectureReviewSection(raw);
  return { present: true, config, error };
}

/** 门态（三态枚举，⛔ 不是布尔——硬规则 3：「读不懂」与「读到了 enabled:false」必须不同形）。
 *  `main()` 从 config 解析后注入 `qualityGateRoutines`（⛔ 那个函数自己不读配置：读配置会让它的行为
 *  依赖工作区 gitignored 的状态 ⇒ 测试不再确定，见 QualityGateOptions 的注入纪律）。 */
export type ArchReviewGate =
  | { state: "enabled" }
  | { state: "not-evaluated"; reason: string }
  | { state: "failed"; reason: string };

/** 把门态压成一条 Fact（disabled ⇒ not-evaluated + 零 spawn；段写坏 ⇒ failed + 零 spawn）。 */
export function archReviewGateFact(gate: Exclude<ArchReviewGate, { state: "enabled" }>): Fact<null> {
  return { name: "architecture-review", value: null, state: gate.state, reason: gate.reason };
}

/** The architecture-review ASSEMBLY LINE, as ONE string（同族 formatDiscoveryMethodAssembly 的手法）。
 *
 *  ⛔ WHY IT NAMES THE CADENCE'S SOURCE（硬规则 3b/9）：本轨的节奏有三个来源（CLI flag / config /
 *  硬编码缺省），而「config 段写坏了、悄悄回退到缺省 60m」与「config 段装配成功、就是 60m」在读数上
 *  本来同形——只打一个 interval 数字无法区分。故本行把**这次装配真正携带的东西**连来源一起写出。
 *  ⛔ 另：本行也是「anchor 是否真的重载了新代码」的可见证据（self-refresh 只看 kind 的 driver 文件
 *  与共享 kernel 文件，routine 模块不在其中——同族 formatOpenSemanticDiscoveryAssembly 的同一理由）。 */
export function formatArchitectureReviewAssembly(a: {
  present: boolean;
  error: string | null;
  enabled: boolean;
  intervalMinutes: number;
  intervalSource: "cli" | "config" | "default";
}): string {
  if (a.error !== null) {
    return `architecture-review 例程已装配（${a.error} — 每轮记 failed，零 spawn；⛔ 不回退到缺省节奏照跑）`;
  }
  if (!a.enabled) {
    return "architecture-review 例程已装配（enabled:false — 每轮记 not-evaluated:disabled，零 spawn）";
  }
  const declared = a.present ? "" : "（未声明 loop.architecture_review — 用 CLI/缺省节奏；本内建例程默认开启）";
  return `architecture-review 例程已装配（enabled, interval=${a.intervalMinutes}m [来源: ${a.intervalSource}]，检测器脚本经 kernelSiblingArgv() 解析到本 kernel 自己的安装位置（raw .ts 或 scripts/dist/<name>.js，都缺席 ⇒ not-evaluated:detector-script-unresolved:<name>，⛔ 不 spawn 不存在的路径），⛔ 不是目标 root 的；--root 仍传目标工作区${declared}）`;
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
  /** 架构复核的门态：由 main() 从 `.quay/config.yml` `loop.architecture_review:` 解析后**注入**
   *  （⛔ 本函数不自己读配置——同 probeRoutines/archDiscoveryRoutine 的注入纪律：读配置会让
   *  qualityGateRoutines 的行为依赖工作区 gitignored 的状态 ⇒ 测试不再确定）。
   *  缺省 undefined = 「段未声明」⇒ 老行为（enabled）。`enabled:false` ⇒ 例程仍装配，但每轮记
   *  `not-evaluated:disabled` 且**零 spawn**；段写坏 ⇒ `failed` 且零 spawn（硬规则 3b：读不懂
   *  ⛔ 不得伪装成「跑过了」。例程留在表里是刻意的——「不跑」必须可观测，同族 kill switch 判据）。 */
  archReviewGate?: ArchReviewGate;
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
  /** arch-discovery 例程：由调用方（main()）从 `.quay/config.yml` `loop.arch_discovery:` 装配后注入，
   *  ⛔ 同 probeRoutines 的理由——本函数不自己读配置（读配置会让行为依赖工作区的 gitignored 状态）。
   *  缺省 null = 未装配（老行为）。**只有 section 已声明时才装配**（off by default：未声明的工作区例程表
   *  不变）——声明了但 enabled:false/写坏 ⇒ 仍装配，因为「不跑」必须可观测（disabled / failed 读数）。 */
  archDiscoveryRoutine?: RoutineSpec | null;
  /** discovery-method 例程：同 archDiscoveryRoutine 的注入纪律（main() 从 `.quay/config.yml`
   *  `loop.discovery_method:` 装配后注入，⛔ 本函数不自己读配置）。缺省 null = 未装配（老行为）。
   *  与 arch-discovery 同一套「off by default + 声明即可观测」语义：未声明 ⇒ 例程表不变；声明了但
   *  enabled:false/写坏 ⇒ 仍装配（disabled / failed 必须可观测，硬规则 3b）。 */
  discoveryMethodRoutine?: RoutineSpec | null;
  /** open-semantic-discovery 例程：同 archDiscoveryRoutine / discoveryMethodRoutine 的注入纪律（main()
   *  从 `.quay/config.yml` `loop.open_semantic_discovery:` 装配后注入，⛔ 本函数不自己读配置）。
   *  缺省 null = 未装配（老行为）。未声明 ⇒ 例程表不变；声明了但 enabled:false/写坏 ⇒ 仍装配，
   *  因为「不跑」必须可观测（disabled / failed 读数）。 */
  openSemanticDiscoveryRoutine?: RoutineSpec | null;
  /** cross-project-dogfood 例程：同前四条的注入纪律（main() 从 `.quay/config.yml`
   *  `loop.cross_project_dogfood:` 装配后注入，⛔ 本函数不自己读配置）。缺省 null = 未装配（老行为）。
   *  未声明 ⇒ 例程表不变；声明了但 enabled:false/写坏 ⇒ 仍装配，因为「不跑」必须可观测（disabled /
   *  failed 读数，硬规则 3b）。 */
  crossProjectDogfoodRoutine?: RoutineSpec | null;
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
      // 门态 ≠ enabled ⇒ 早返回一条门态 Fact，**零 spawn**（连机械检测器都不 spawn：「关掉」必须是
      // 关掉整条例程，⛔ 不是「还跑一半」——否则 kill switch 在读数上不可证）。
      run: async (ctx) => {
        const gate = opts.archReviewGate ?? { state: "enabled" as const };
        if (gate.state !== "enabled") return [archReviewGateFact(gate)];
        return [await runArchitectureReview(
          root, opts.identityCmd, opts.lineageCmd, opts.deletionCmd, opts.archJudgeArgv, opts.resourceGateArgv,
          true, Infinity, ctx?.halted === true, opts.archGapWorkerCmd, opts.archGapWorkerTimeoutMs,
        )];
      },
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
    // 第六类：arch-DISCOVERY 例程（同上「声明式」一族的近亲——间隔与开关来自 `.quay/config.yml`
    // `loop.arch_discovery:`，但它的 run 体是写在本文件 import 的模块里的）。缺席 ⇒ 不加入（老行为）；
    // 加入而 section 缺席 ⇒ 该例程记 `not-evaluated:disabled` 且零 spawn（kill switch 的可观测面）。
    ...(opts.archDiscoveryRoutine ? [opts.archDiscoveryRoutine] : []),
    // 第七类：DISCOVERY-METHOD 例程（同一「声明式 + 可观测」族：间隔与开关来自 `.quay/config.yml`
    // `loop.discovery_method:`）。缺席 ⇒ 不加入（老行为）；加入而 section 缺席 ⇒ 记
    // `not-evaluated:disabled` 且零 spawn（kill switch 的可观测面）。
    ...(opts.discoveryMethodRoutine ? [opts.discoveryMethodRoutine] : []),
    // 第八类：OPEN-SEMANTIC-DISCOVERY 例程（同一「声明式 + 可观测」族：间隔与开关来自
    // `.quay/config.yml` `loop.open_semantic_discovery:`）。缺席 ⇒ 不加入（老行为）；加入而 section
    // 缺席 ⇒ 记 `not-evaluated:disabled` 且零 spawn（kill switch 的可观测面）。
    ...(opts.openSemanticDiscoveryRoutine ? [opts.openSemanticDiscoveryRoutine] : []),
    // 第九类：CROSS-PROJECT-DOGFOOD 例程（同一「声明式 + 可观测」族：间隔与开关来自 `.quay/config.yml`
    // `loop.cross_project_dogfood:`）。缺席 ⇒ 不加入（老行为）；加入而 section 缺席 ⇒ 记
    // `not-evaluated:disabled` 且零 spawn（kill switch 的可观测面）。**与上面四条的区别是主语**：它的
    // 输入是别的 Quay 宿主项目的真实使用载体，⛔ 不是本仓库的源码。
    ...(opts.crossProjectDogfoodRoutine ? [opts.crossProjectDogfoodRoutine] : []),
  ];
}

/** The discovery-method ASSEMBLY LINE, as ONE string.
 *
 *  ⛔ WHY THIS IS A FUNCTION AND NOT AN INLINE `console.error` (gap-discovery-method-24h-budget-hard-
 *  reservation, Plan item 7 — DEPLOYMENT): the anchor's self-refresh watches only the kind's driver file
 *  plus the shared kernel files (`driver-runtime.ts` `watchedSourceFiles`), NOT routine modules. A delta
 *  confined to `discovery-method-routine.ts` would therefore land INERT and production would keep running
 *  the old soft budget indefinitely. Touching THIS file is what makes the anchor reload — and the reload
 *  is observable exactly here, because this line is what startup prints.
 *
 *  It names every constraint the assembly actually CARRIED:
 *   • `interval` — and whether a temporary `interval_until` window is still in force (a 60m cadence that
 *     had silently reverted to 360m must not look like a correctly-assembled 60m one, 硬规则 3b/9);
 *   • `max_model_calls_per_24h` — the ceiling, with its HARD-RESERVATION semantics: it bounds
 *     RESERVATIONS over the trailing 24h (one taken before EVERY subprocess), not a pre-round snapshot;
 *   • the PER-ROUND values (`max_experiences` / `max_model_calls` / `max_wall_ms`) plus `verify_reserve`
 *     and the reflection ceiling that follows from it — because "what did this round actually carry?"
 *     must be answerable from the reload line, not by re-parsing a config that may since have changed
 *     (task gap-discovery-method-per-round-quota-verify-reserve-deep-reflection, Plan item 4);
 *   • `reflection_tools` / `reflection_max_turns` — the reflection launcher's own argv parameters, so the
 *     reload line says whether DEPTH (code access) is on, not only how MANY calls there are;
 *   • `verifier_max_turns` + the computed worst case — because `max_model_calls` bounds subprocess
 *     INVOCATIONS, so the 24h API-turn worst case is `cap × max(reflection turns, verifier turns)`, and
 *     that product is only knowable here, at assembly time. */
export function formatDiscoveryMethodAssembly(dm: {
  enabled: boolean;
  intervalMinutes: number | null;
  intervalUntil: number | null;
  maxModelCallsPer24h: number | null;
  maxExperiences: number | null;
  maxModelCalls: number | null;
  maxWallMs: number | null;
  verifyReserve: number | null;
  reflectionMaxModelCalls: number | null;
  reflectionTools: string | null;
  reflectionMaxTurns: number | null;
  verifierMaxTurns: number | null;
  worstCaseTurns24h: number | null;
}): string {
  if (!dm.enabled) return "discovery-method 例程已装配（enabled:false — 每轮记 not-evaluated:disabled，零 spawn）";
  const until = dm.intervalUntil === null ? "" : `, interval_until=${new Date(dm.intervalUntil).toISOString()}`;
  const cap = dm.maxModelCallsPer24h === null
    ? ", max_model_calls_per_24h=<none — no cross-round ceiling>"
    : `, max_model_calls_per_24h=${dm.maxModelCallsPer24h} (HARD: pre-spawn reservation per call, trailing-24h; a reservation with no outcome still counts as spent)`;
  const perRound = dm.maxModelCalls === null
    ? ""
    : `, max_experiences=${dm.maxExperiences}, max_model_calls=${dm.maxModelCalls} (per round), verify_reserve=${dm.verifyReserve} (held back from reflection ⇒ reflection <= ${dm.reflectionMaxModelCalls}), max_wall_ms=${dm.maxWallMs}`;
  const refl = dm.reflectionTools === null
    ? ""
    : `, reflection_tools=${JSON.stringify(dm.reflectionTools)} (${dm.reflectionTools === "" ? "BASELINE arm: no tools, so reflection cannot read the code at the pin" : "SEMANTIC FIRST: reflection reads a stripped pin at HEAD"}), reflection_max_turns=${dm.reflectionMaxTurns}`;
  const turns = dm.verifierMaxTurns === null ? "" : `, verifier_max_turns=${dm.verifierMaxTurns}`;
  const worst = dm.worstCaseTurns24h === null ? "" : `, worst_case_api_turns_per_24h=${dm.worstCaseTurns24h} (cap × max(effective reflection turns, verifier turns))`;
  return `discovery-method 例程已装配（enabled, interval=${dm.intervalMinutes}m${until}${cap}${perRound}${refl}${turns}${worst}）`;
}

/** The OPEN-SEMANTIC-DISCOVERY ASSEMBLY LINE, as ONE string (task gap-open-semantic-discovery-routine-track).
 *
 * ⛔ WHY IT IS A FUNCTION PRINTED FROM `main()`. The anchor's self-refresh watches only the kind's driver
 * file plus the shared kernel files (`driver-runtime.ts` `watchedSourceFiles`) — a routine MODULE is not
 * watched, so a delta confined to `open-semantic-discovery-routine.ts` would land INERT, with production
 * running the old assembly indefinitely. Touching this file is what makes the anchor reload it, and this
 * line is the reload's own evidence.
 * ⛔ WHAT IT MUST NAME: the cadence that was actually assembled (a declared `interval_until` can already
 * have expired ⇒ the round reverts to the permanent default), BOTH 24h ceilings (they are per-routine and
 * are not shared with discovery-method's 240), and the per-step turn bounds — because "which bounds are
 * production actually running under" is answerable at startup ONLY from this line (硬规则 3b/9: an
 * assembly that cannot say what it assembled is indistinguishable from one that assembled nothing).
 * It ALSO names the METHOD-GUIDANCE policy the loaded module carries (task
 * gap-open-discovery-method-guidance-active-shadow): a routine module is not a watched source file, so
 * the only visible evidence that the resident driver reloaded a routine whose PROMPT policy changed is a
 * line in this file. */
export function formatOpenSemanticDiscoveryAssembly(od: {
  enabled: boolean;
  intervalMinutes: number | null;
  intervalUntil: number | null;
  maxModelCallsPer24h: number | null;
  maxUsdPer24h: number | null;
  investigatorRuns: number | null;
  maxClustersVerified: number | null;
  verifierMaxTurns: number | null;
  refutationMaxTurns: number | null;
}): string {
  // The policy the loaded routine module implements, stated as what it IS rather than as config:
  // `active` ⇒ production guidance, `draft`/`trial` ⇒ an isolated shadow arm, retired/quarantined/
  // contaminated ⇒ never, none ⇒ baseline. A routine module is NOT in `watchedSourceFiles`, so this
  // clause is the reload's evidence for a prompt-policy change.
  const methods = ", methods: active ⇒ 生产轮 guidance / draft|trial ⇒ shadow 臂（shadow:true，不入 Portfolio）/ retired|quarantined|contaminated ⇒ 永不选取 / 无 ⇒ baseline（不抑制轮次）";
  if (!od.enabled) return "open-semantic-discovery 例程已装配（enabled:false — 每轮记 not-evaluated:disabled，零 spawn）";
  const until = od.intervalUntil === null ? "" : `, interval_until=${new Date(od.intervalUntil).toISOString()}`;
  const calls = od.maxModelCallsPer24h === null ? "" : `, max_model_calls_per_24h=${od.maxModelCallsPer24h} (HARD: pre-spawn reservation per subprocess, trailing-24h; a reservation with no outcome still counts as spent)`;
  const usd = od.maxUsdPer24h === null ? "" : `, max_usd_per_24h=$${od.maxUsdPer24h} (HARD: realized gateway cost from the same ledger; an unknown price counts as the per-call ceiling, never 0)`;
  const shape = od.investigatorRuns === null ? "" : `, investigator_runs=${od.investigatorRuns}, max_clusters_verified=${od.maxClustersVerified}`;
  const turns = od.verifierMaxTurns === null ? "" : `, verifier_max_turns=${od.verifierMaxTurns}, refutation_max_turns=${od.refutationMaxTurns}`;
  return `open-semantic-discovery 例程已装配（enabled, interval=${od.intervalMinutes}m${until}${calls}${usd}${shape}${turns}${methods}, report-only: 不立案、不写 tasks/ 或 goals/）`;
}

/** The CROSS-PROJECT-DOGFOOD assembly line, as ONE string. It names what makes this routine different
 *  from the four above — its SUBJECT is the configured source projects' usage artifacts, opened
 *  read-only — because that difference is exactly what an operator reads this line to confirm. */
export function formatCrossProjectDogfoodAssembly(cpd: { enabled: boolean; present: boolean }): string {
  if (!cpd.enabled) return "cross-project-dogfood 例程已装配（enabled:false — 每轮记 not-evaluated:disabled，零 spawn）";
  return "cross-project-dogfood 例程已装配（enabled, 源项目清单与间隔取自 .quay/config.yml loop.cross_project_dogfood:, 源项目一律只读打开、模型子进程 cwd 是本轮 scratch ⛔ 不是源项目、两个 24h 天花板是 spawn 前硬预留；undetermined/refuted 一律不立案、不写 Portfolio，只有 confirmed 才写 Portfolio / 经 ABI 立一条 todo）";
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
  // Layer 0（driver-shared）：停机标志 + 可唤醒 sleep 单一实现（finding `driver-sleep-requeststop-triple`）。
  const stopCtl = residentLoopStop();
  // AC-255（SPEC §7 阶段 C）：停机登记 —— 进程信号仍停本 kind，同时 anchor 可经 `requestKindStop`
  // 只停【这一个】循环（收敛后多个 kind 同进程，`kill -TERM <pid>` 不再能只停一个）。
  registerKindStop(opts.kind ?? "quality", stopCtl.requestStop);

  const lastRun: Record<string, number> = {};
  let round = 0;
  while (!stopCtl.isStopRequested()) {
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
    await stopCtl.sleep(intervalMs);
  }
  if (json && stopCtl.isStopRequested()) {
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
  "  --arch-review-interval <m> 架构复核例程间隔（分钟）——**显式 override**，优先级高于",
  "                            .quay/config.yml loop.architecture_review.interval（缺省 60）",
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
  "",
  ".quay/config.yml 的架构复核段（本轨道**默认开**——段缺席 = 老行为：enabled + CLI/缺省节奏）：",
  "  loop:",
  "    architecture_review:",
  "      enabled: true          # 必填布尔；false ⇒ 每轮记 not-evaluated:disabled 且零 spawn",
  "      interval: \"interval:60m\"  # enabled:true 时必填，不得低于 60m；显式 --arch-review-interval 覆盖它",
  "  段写坏 ⇒ 每轮记 failed 且零 spawn（⛔ 不回退到缺省节奏照跑——读不懂不得伪装成合格，硬规则 3b）",
].join("\n");

// splitArgs / isNonNegInt：单一实现已上收 driver-runtime.ts（routine semantic-dedup-scan finding
// `splitArgs-isNonNegInt-trio`，runId semantic-dedup-scan-1791733865369——三份 byte-identical 副本
// 归并为一份，同 process-kill-lib 的手法）。splitArgs 仍从本模块 re-export，保留既有 import 面。
export { splitArgs };

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
  // 架构复核轨道的 config 入口（Gap 1）：读 `.quay/config.yml` `loop.architecture_review:`。优先级 =
  // **显式 CLI flag > config > 硬编码缺省**（同 `QUAY_PLUGIN_ROOT` 的接法）。`--arch-review-interval`
  // 保留为文档化的 override（本仓库 dev-loop 与既有测试都用它），只是不再是唯一入口。
  const archReviewRead = readArchitectureReviewConfig(rootDir);
  const archReviewCliInterval = archReviewIntervalRaw !== undefined && isNonNegInt(archReviewIntervalRaw)
    ? Number(archReviewIntervalRaw) : null;
  const archReviewIntervalSource: "cli" | "config" | "default" =
    archReviewCliInterval !== null ? "cli"
      : archReviewRead.config?.intervalMinutes != null ? "config"
        : "default";
  const archReviewIntervalMinutes = archReviewCliInterval
    ?? archReviewRead.config?.intervalMinutes
    ?? ARCH_REVIEW_INTERVAL_MIN_DEFAULT;
  // 门态三态（硬规则 3）：段写坏 ⇒ failed（⛔ 不回退到缺省照跑——那会让写坏的声明与正确的声明同形）；
  // 段声明 enabled:false ⇒ not-evaluated:disabled；其余 ⇒ enabled。段缺席 ⇒ enabled（本内建例程默认开）。
  const archReviewGate: ArchReviewGate =
    archReviewRead.error !== null ? { state: "failed", reason: archReviewRead.error }
      : archReviewRead.config !== null && !archReviewRead.config.enabled
        ? { state: "not-evaluated", reason: "not-evaluated:disabled — .quay/config.yml loop.architecture_review.enabled=false（kill switch：零 spawn）" }
        : { state: "enabled" };
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

  // arch-discovery 轨道：读 `.quay/config.yml` `loop.arch_discovery:`（同一注入纪律，见 QualityGateOptions）。
  // section 缺席/enabled:false ⇒ 例程仍装配，但每轮只记 `not-evaluated:disabled` 且零 spawn；配置坏 ⇒ 记
  // failed 并在此**可见地**报告（硬规则 3b：读不懂 ≠ 合格）。装配后由常驻环按 interval 评估。
  const archDiscovery = archDiscoveryRoutineFromConfig(rootDir);
  if (archDiscovery.error) {
    console.error(`quality-gate-driver: arch-discovery 例程配置无效 — ${archDiscovery.error}`);
  } else if (!archDiscovery.present) {
    console.error("quality-gate-driver: 未声明 loop.arch_discovery — arch-discovery 例程未装配（off by default，零 spawn；例程表与未接此轨时一致）");
  } else {
    console.error(`quality-gate-driver: arch-discovery 例程已装配（${archDiscovery.enabled ? "enabled" : "enabled:false — 每轮记 not-evaluated:disabled，零 spawn"}）`);
  }

  // discovery-method 轨道：读 `.quay/config.yml` `loop.discovery_method:`（同一注入纪律）。
  // section 缺席/enabled:false ⇒ 例程仍装配，但每轮只记 `not-evaluated:disabled` 且零 spawn；配置坏 ⇒ 记
  // failed 并在此**可见地**报告（硬规则 3b：读不懂 ≠ 合格）。
  // ⛔ 模型缝在这里**不**装配：liveModelFactory 只在轮内（ingested > 0 时）才需要，把它的加载推迟到
  // run 里（`liveDiscoveryModel`），否则每个 driver 启动都要付一次 launcher 解析的代价。
  // ⛔ 模型缝是**惰性**的（`modelFactory`）：`liveDiscoveryModel` 只在轮内 `ingested > 0` 那一刻才被
  // 调用，所以「没东西可反思」的轮（生产常态）零 launcher 成本，driver 启动也不付这笔。
  // ⛔ `modelFactory` 现在要拿到**已解析的 config**：验证器 seam 的 `--max-turns` 来自
  // `verifier_max_turns`，而 seam 是在轮内才建的。装配用的那一份 read 直接传进去，
  // ⛔ 不在 seam 里再读一次盘——第二份 config 读取就是第二份真相（硬规则 5b）。
  const discoveryMethodRead = readDiscoveryMethodConfig(rootDir);
  const discoveryMethod = discoveryMethodRoutineFromConfig(rootDir, {
    modelFactory: () => liveDiscoveryModel(rootDir, discoveryMethodRead.config),
  }, discoveryMethodRead);
  if (discoveryMethod.error) {
    console.error(`quality-gate-driver: discovery-method 例程配置无效 — ${discoveryMethod.error}`);
  } else if (!discoveryMethod.present) {
    console.error("quality-gate-driver: 未声明 loop.discovery_method — discovery-method 例程未装配（off by default，零 spawn；例程表与未接此轨时一致）");
  } else {
    // ⛔ 装配行必须**点名装配出来的 interval**，⛔ 不是只说「enabled」：本轨可以配一个**临时**的快节奏
    // （`interval_until` 到期后回落到 360m，见 discovery-method-routine.ts 头注释），而"到底是 60m 还是
    // 360m 被装进例程表"这件事，在启动那一刻只有这一行能回答——只写 enabled 的话，配置写错（或临时窗口
    // 已过期）与"装配正确"在启动记录上同形（硬规则 3b/9）。`interval_until` / `max_model_calls_per_24h`
    // 一并打出：它们是这次装配真正携带的约束，⛔ 不是可以从别处推出来的。
    console.error(`quality-gate-driver: ${formatDiscoveryMethodAssembly(discoveryMethod)}`);
  }

  // open-semantic-discovery 轨道：读 `.quay/config.yml` `loop.open_semantic_discovery:`（同一注入纪律）。
  // section 缺席/enabled:false ⇒ 例程仍装配，但每轮只记 `not-evaluated:disabled` 且零 spawn；配置坏 ⇒ 记
  // failed 并在此**可见地**报告（硬规则 3b：读不懂 ≠ 合格）。
  const openDiscovery = openSemanticDiscoveryRoutineFromConfig(rootDir);
  if (openDiscovery.error) {
    console.error(`quality-gate-driver: open-semantic-discovery 例程配置无效 — ${openDiscovery.error}`);
  } else if (!openDiscovery.present) {
    console.error("quality-gate-driver: 未声明 loop.open_semantic_discovery — open-semantic-discovery 例程未装配（off by default，零 spawn；例程表与未接此轨时一致）");
  } else {
    console.error(`quality-gate-driver: ${formatOpenSemanticDiscoveryAssembly(openDiscovery)}`);
  }

  // cross-project-dogfood 轨道：读 `.quay/config.yml` `loop.cross_project_dogfood:`（同一注入纪律）。
  // section 缺席/enabled:false ⇒ 例程仍装配，但每轮只记 `not-evaluated:disabled` 且零 spawn；配置坏 ⇒ 记
  // failed 并在此**可见地**报告（硬规则 3b：读不懂 ≠ 合格）。
  const crossProject = crossProjectDogfoodRoutineFromConfig(rootDir);
  if (crossProject.error) {
    console.error(`quality-gate-driver: cross-project-dogfood 例程配置无效 — ${crossProject.error}`);
  } else if (!crossProject.present) {
    console.error("quality-gate-driver: 未声明 loop.cross_project_dogfood — cross-project-dogfood 例程未装配（off by default，零 spawn；例程表与未接此轨时一致）");
  } else {
    console.error(`quality-gate-driver: ${formatCrossProjectDogfoodAssembly(crossProject)}`);
  }

  // architecture-review 轨道：读 `.quay/config.yml` `loop.architecture_review:`（同族注入纪律；
  // 与上面五条的差异是**默认开**——它是内建的四条例程之一，故段缺席 = 老行为，见本段的正本注释）。
  // ⛔ 装配行**总是**打（含段缺席）：这条例程在段缺席时也真的在跑，「没声明」不等于「没装配」，
  //    只打「未声明」会让「跑着缺省节奏」与「没跑」在启动记录上同形（硬规则 3b/9）。
  console.error(`quality-gate-driver: ${formatArchitectureReviewAssembly({
    present: archReviewRead.present,
    error: archReviewRead.error,
    enabled: archReviewGate.state === "enabled",
    intervalMinutes: archReviewIntervalMinutes,
    intervalSource: archReviewIntervalSource,
  })}`);

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
    archReviewGate,
    packagingCheckCmd: packagingCheckCmd ? splitArgs(packagingCheckCmd) : null,
    packagingGapWorkerCmd: packagingGapWorkerCmd ?? null,
    packagingGapWorkerTimeoutMs,
    packagingHygieneIntervalMinutes,
    archGapWorkerCmd: archGapWorkerCmd ?? null,
    archGapWorkerTimeoutMs,
    probeRoutines: probeSelection.routines,
    archDiscoveryRoutine: archDiscovery.routine,
    discoveryMethodRoutine: discoveryMethod.routine,
    openSemanticDiscoveryRoutine: openDiscovery.routine,
    crossProjectDogfoodRoutine: crossProject.routine,
  });

  return runResidentQualityGateLoop({ root: rootDir, intervalMs: interval, once, maxRounds, roundLogFile, runId: resolvedRunId, json, pidFile, routines, routineWatchdogMs, kind: "quality" });
}

// Direct entry guard (gate-script-base convention)：仅当本文件是入口时跑 main()。
if (isDirectEntry(import.meta, undefined, "quality-gate-driver")) {
  main(process.argv).then((code) => { process.exitCode = code; });
}
