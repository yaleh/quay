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
  kindStopProbe,
  residentLoopStop,
  DISK_STOP_POLL_MS_DEFAULT,
  STOPPED_MID_ROUND,
  resourceGateCheck,
  kernelSiblingArgv,
  resolveKernelPluginRoot,
  splitArgs,
  isNonNegInt,
  type DriverKind,
  type Fact,
  type RoutineRunContext,
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
  ARCH_REVIEW_DETECTOR_IDS,
  actionableConclusions,
  appendArchReviewRound,
  appendSubmission,
  buildArchReviewRoundRecord,
  clusterByDetector,
  computeArchReviewTrigger,
  conclusionKey,
  deletionClosureComponents,
  deletionDetectorEvaluation,
  detectorEvalFromSurface,
  flattenDetectorClusters,
  mergeClusterVerdicts,
  mergePriorFindingRulings,
  priorFindingsCheckState,
  readPriorRoundFindings,
  readSubmittedKeys,
  unsentConclusions,
  type ArchReviewClusterVerdict,
  type ArchReviewDetectorState,
  type ArchReviewPriorRound,
  type ArchReviewRoundRecord,
  type Cluster,
  type DeletionReportView,
  type IdentityReportView,
  type JudgeClusterVerdict,
  type JudgePriorRuling,
  type LineageReportView,
  type PriorFinding,
  type PriorFindingRuling,
  type PriorFindingsCheckState,
} from "./architecture-review-cluster.ts";
// AC155：轮询间隔的单一真相源（drivers.yml 经 driver-config 加载，⛔ 不各写一份字面量——同
// outer-driver / promotion-driver 的接法）。quality 段由此前的「字面量 60_000」改为从
// loadDriverConfig(root).quality.intervalMs 派生（缺省 30000，与 outer 例程型 kind 对齐）。
import { defaultDriverConfig, loadDriverConfig } from "./driver-config.ts";
// SPEC-capability-planes-and-mechanism-lifecycle §5.2：probe 轨道（`.quay/config.yml` `loop.routines:`
// 的 interval 例程 → 派 fresh-context 探针 → 结构化 finding 落载体）。本 driver 是承载它的活调用点
// （§5.1：⛔ 不为 probe 新造 driver kind——Layer 1b 的 RoutineSpec 已经是 probe 抽象）。
import { PROBE_ROLE_DEFAULT, llmProbeRoutine, probeRoutinesFromConfig, type RoutineDecl } from "./probe-routine.ts";
// arch-DISCOVERY 轨道（gap-arch-discovery-not-wired-into-routine-track-report-only）：把两个已验证的
// 静态仪器（docs/analysis/arch-discovery-{space,time}.mjs）的 `--scan` 接上轮子。**只读、只报**——
// 该例程不 import 任何立案/撰写函数，唯一持久化是 gitignored 载体 + 既有的 quality-round Fact。
// ⛔ 与 fan-in/scoped-gate 无关（同上：深扫更不能上每任务必经的热路径）。
import { archDiscoveryRoutineFromConfig } from "./arch-discovery-routine.ts";
// RESOURCE-DIAGNOSTIC 轨道（gap-quality-continuous-resource-diagnostic-routine-mechanical-filter-then-
// semantic）：Quality 的**持续资源诊断**——机械采集+筛选在前（零模型调用），只有**机械旗标出的
// 新 anomaly** 才走语义面，且语义面复用**既有的** verifier/refuter + 立案通道 + 机制查重 + 提交台账。
// 与上面四条内建例程的区别同 arch-discovery：它是**声明式**的（间隔与开关来自 `.quay/config.yml`
// `loop.resource_diagnostic:`），所以 `qualityGateRoutines()` 的内建四条不变（AC1 的「恰好四条」仍成立）。
import { resourceDiagnosticRoutineFromConfig } from "./resource-anomaly-detector.ts";
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
// ARCH-COVERAGE 轨道（gap-arch-coverage-report-report-only-not-run-in-production）：把既有的
// **覆盖面自报**（plugin/scripts/arch-coverage-report.ts）接上例程环——在此之前它只有自己的测试
// 引用，「哪些语言/目录没有任何分析器到达」在生产上不可查。**只读、只报**：本轨不 import 任何
// 立案/撰写函数，唯一新增持久化是 gitignored 载体 `.quay/arch-coverage-history.jsonl` 的一行基线
// + 既有的 quality-round Fact。⛔ 不 ratchet：NOT-EVALUATED 非零是该例程的**内容**，不是 failed
// （区别于「红了」——硬规则 3b）。⛔ 与 fan-in/scoped-gate 无关。
import {
  runReport as runCoverageReport,
  appendHistoryRecord as appendCoverageHistory,
  buildHistoryRecord as buildCoverageHistoryRecord,
  type Report as ArchCoverageReport,
} from "./arch-coverage-report.ts";
// ARCH-CYCLE 轨道（gap-arch-cycle-report-only-routine）：目录级环读数此前只存在于按需 runner 的
// **闸**里（gap-fan-in-remove-archguard-gate 已把它从 fan-in 移除 ⇒ 新能力无消费者，自 10-11
// 没跑过）。本轨把同一个读数接成周期 report-only 例程：每 due 轮读一次「上次 analyze 落盘的」
// moduleGraph 环，append 一行到 `.quay/arch-cycle-history.jsonl`。analyze 只在这一轮里为**到期**
// 的 scope 补跑（每 scope 每间隔至多一次；⛔ 不进 fan-in / per-task 热路径）。⛔ 不 ratchet、
// 不立案——环非空是该例程的**读数内容**，不会使轮 failed（那是闸的语义，不是本轨的）。
import {
  downgradeStaleScopes,
  readDirectoryCycleReading,
  readGraphSummaryReading,
  refreshBehindScopes,
  resolveArchguardCli,
  selectRefreshTargets,
  type ArchCycleRefreshResult,
  type DirectoryCycle,
  type DirectoryCycleReading,
  type TopOutDegreeEntry,
} from "./archguard-runner.ts";
// GRAPH-SUMMARY（gap-quality-round-facts-surface-top-out-degree-god-functions）：arch-cycle 例程
// 同一批多读两条非环读数——topByOutDegree（god functions）与 relationCountByType（图的能力边界）。
// 它们与目录环来自**同一份** `.archguard/query/<globalScopeKey>/arch.json`，因此仍是零 spawn 的纯
// 文件读；⛔ 不在这里重新 analyze（`gap-fan-in-remove-archguard-gate`：不把 27s/task 拉进每轮）。

// DESIGN-EVOLUTION-READINGS 轨道（gap-design-evolution-readings-report-only-routine）：RM1（分解后
// 增量落回中心文件的占比）与 RM2（热点文件并发争用）此前只是写在元机制 finding 正文里的**一次性
// 命令**——同一天里它们的口径不一致、改路径后读空、把搬家读成增长（三次都有实测）。本轨把两条读数
// 接成与 arch_cycle_report 同族的声明式 report-only 例程：每 due 轮读一次 git 历史 + worker-outcome
// 载体，append 一行到 `.quay/design-evolution-history.jsonl`。**零 LLM、零 spawn 模型**；读数本身
// （占比、争用计数）是**内容**，⛔ 不是 failed，也不 ratchet。读数实现全在 design-evolution-readings.ts
// （本文件只做装配），因为同一段逻辑还要给直接入口（人 / GOAL-909 评价）复用——两处实现必然漂移。
// ⚠️ `takeEvolutionRound` is the ONE orchestration: read previous → read → judge → persist → append
// findings. This file only assembles and reports — ⛔ it must not grow a second copy of that order.
import {
  takeEvolutionRound,
  readDesignEvolutionConfig,
  cfgBad as deCfgBad,
  DESIGN_EVOLUTION_ROUTINE_NAME,
  DESIGN_EVOLUTION_INTERVAL_MIN_DEFAULT,
  DESIGN_EVOLUTION_MIN_INTERVAL_MINUTES,
  DESIGN_EVOLUTION_HISTORY_REL,
  DESIGN_EVOLUTION_MODE,
  EVOLUTION_FINDINGS_REL,
  type DesignEvolutionReadingsRecord,
  type DesignEvolutionSectionConfig,
  type DesignEvolutionVerdict,
  type SectionRead as DesignEvolutionSectionRead,
  type ContentionPredicates,
} from "./design-evolution-readings.ts";
// 常量与例程名在本文件再导出一次：同族（arch-cycle-report）的常量就定义在本文件，读者/测试从本
// driver 取它们是一致的取法；⛔ 值只有一份，仍定义在 design-evolution-readings.ts。
export {
  DESIGN_EVOLUTION_HISTORY_REL,
  DESIGN_EVOLUTION_ROUTINE_NAME,
  DESIGN_EVOLUTION_INTERVAL_MIN_DEFAULT,
  DESIGN_EVOLUTION_MIN_INTERVAL_MINUTES,
  EVOLUTION_FINDINGS_REL,
} from "./design-evolution-readings.ts";

// INSTRUMENT-DECAY 轨道（gap-instrument-decay-check-unwired-and-blind-to-content-dark）：
// `plugin/scripts/instrument-decay-check.ts` 自称「常驻检测器」，但此前没有任何例程调用它——它只在
// 人手动跑的时候存在。本轨把它接成与 arch_cycle_report 同族的声明式只读例程（`loop.instrument_decay:`）：
// 每 due 轮跑一次四项读数（写手停写 A/B、内容全暗 C、过期的已评估 D、未覆盖清单），产出一条
// `state: "instrument-dark"` 的 Fact（⛔ 与 verified / not-evaluated 都不同形），并对每个
// （载体，形态）经**既有** gap-filing 通道立案（按机制去重：上一轮的 Fact 里已立案的 pair 不再 spawn）。
// **零模型调用**：读数本身是纯文件 + git 读；只有「有新腐烂」才 spawn 一个短命 gap-filing agent。
// ⛔ 与 fan-in/scoped-gate 无关（不在每任务必经的热路径上）。
import {
  analyzeAll as analyzeInstrumentDecay,
  DEFAULT_STALE_SECONDS as INSTRUMENT_DECAY_DEFAULT_STALE_SECONDS,
  type AnalyzeOutcome as InstrumentDecayOutcome,
  type DecayFinding as InstrumentDecayFinding,
  type CarrierSpec as InstrumentDecayCarrierSpec,
} from "./instrument-decay-check.ts";

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

/** arch-coverage-report 例程（声明式，`loop.arch_coverage_report:`）的缺省间隔。360m = 与
 *  arch_discovery / cross_project_dogfood 的**永久缺省节奏**同族（同族两条都把 360m 定为 floor）。
 *  这一轮的成本只是 `git ls-files` + 读 manifest（实测亚秒级），节奏取长的理由是**读数不需要更密**：
 *  覆盖面随提交缓慢变化，每小时一条基线只会把载体撑长而不增加信息。 */
export const ARCH_COVERAGE_INTERVAL_MIN_DEFAULT = 360;

/** 声明的 interval 下限（分钟）——与同族 declarative 例程（`MIN_INTERVAL_MINUTES = 60`）同一个界：
 *  低于此界不是「更快的观测」，是把一条慢变量的读数重复写进载体。 */
export const ARCH_COVERAGE_MIN_INTERVAL_MINUTES = 60;

/** 例程名（也是它写进 quality-round 的 Fact 名字与 `.quay/routine-last-run.json` 的键）。 */
export const ARCH_COVERAGE_ROUTINE_NAME = "arch-coverage-report";

/** arch-cycle-report 例程（声明式，`loop.arch_cycle_report:`）的缺省间隔。360m = 与 arch-coverage-report
 *  同一个理由：每轮只是读 `.archguard/query/` 的既有产物（零 spawn、亚秒级），而目录环随提交缓慢
 *  变化——每小时一条只会把载体撑长，不增加信息。 */
export const ARCH_CYCLE_INTERVAL_MIN_DEFAULT = 360;

/** 声明 interval 的下限（分钟）——同 ARCH_COVERAGE_MIN_INTERVAL_MINUTES 的同一个界（慢变量不因
 *  「更密的观测」变准）。 */
export const ARCH_CYCLE_MIN_INTERVAL_MINUTES = 60;

/** 例程名（Fact 名 + `.quay/routine-last-run.json` 的键）。 */
export const ARCH_CYCLE_ROUTINE_NAME = "arch-cycle-report";

/** 载体（gitignored，docs/carrier-registry.json 已登记）。 */
export const ARCH_CYCLE_HISTORY_REL = path.posix.join(".quay", "arch-cycle-history.jsonl");

/** instrument-decay 例程（声明式，`loop.instrument_decay:`）的缺省间隔。360m 与同族一致：每轮只是
 *  读既有的 jsonl 载体 + 每个作用域一次 `git log -1`（零 spawn 模型、亚秒级），而「仪器是否在腐烂」
 *  是慢变量——更密的观测不会让结论更准，只会把读数写得更频繁。 */
export const INSTRUMENT_DECAY_INTERVAL_MIN_DEFAULT = 360;

/** 声明 interval 的下限（分钟）——同族同一个界。 */
export const INSTRUMENT_DECAY_MIN_INTERVAL_MINUTES = 60;

/** 例程名（Fact 名 + `.quay/routine-last-run.json` 的键）。 */
export const INSTRUMENT_DECAY_ROUTINE_NAME = "instrument-decay";

/** gap-filing agent 的 wall-clock 上限【缺省回退值】（毫秒）。与 packaging-hygiene / architecture-review
 *  的 gap-filing 角色同源（同一次实测 elapsed_s=602.9），⛔ 不另起测量。 */
export const INSTRUMENT_DECAY_GAP_WORKER_TIMEOUT_MS_DEFAULT = 900_000;

/** packaging-hygiene 的机械 check spawn 上限（毫秒）——config-key 枚举是纯函数、shipped-entry 是
 *  npm pack --dry-run + dist build（实测 ~2s / ~0.2s），180s 是给足余量的机械上限（⛔ 不是成本阈值，
 *  是 liveness 安全界——同 ROUTINE_TIMEOUT_MS 语义，全部是快速机械 node 调用）。 */
export const PACKAGING_CHECK_TIMEOUT_MS = 180_000;

/** packaging-hygiene gap-filing agent spawn 的 wall-clock 上限【缺省回退值】（毫秒）。gap-filing 角色
 *  （读 drift → 查重 → 撰四件套 → 过 ABI 落盘）与 goal-driver 的 gap-filing 同族——其单次墙钟实测
 *  elapsed_s=602.9（goal-driver GAP_WORKER_TIMEOUT_MS_DEFAULT 的同一实测导出，⛔ 不另起测量），
 *  900_000（900s）> 602.9s 留 ~1.5x 余量。 */
export const PACKAGING_GAP_WORKER_TIMEOUT_MS_DEFAULT = 900_000;

// ── 默认 probe 例程 + 主仪器可用性前置 ─────────────────────────────────────────────────────────────
// gap-architecture-analysis-probe-not-wired-into-driver-routine-or-init。实测接线缺口（2026-10-20）：
// `plugin/probes/architecture-analysis.md`（唯一真正调 archguard 的机件）此前只被
// `external-dogfooding-check.ts` 的例程引用（且只针对外来目标）；通用 driver 从不调度它，而 dev
// 工作区 `loop.routines:` 里那条是 `every(10)`（随 ADR-022 退役的迭代计数 ⇒ 两层模式永不 due，
// 启动时只打一行「未被驱动」）。⇒ 下游项目装好 quay 后没有任何 driver 主动跑浅层架构分析。

/** 默认装配的 probe 例程声明（工作区内**没有**可装配的同名 interval 声明时加入）。
 *
 *  为什么默认装配而不是只靠配置：`loop.routines:` 是工作区配置（本仓库里 gitignored），「每个工作区
 *  都恰好声明了它」不是一个能被本仓库保证的事实——本 gap 的形态正是「声明了但永不 due」。默认装配让
 *  「装了 quay 就有这条 standing routine」成为机制事实，配置声明仍可按名覆盖节奏。
 *
 *  `interval:1440m`（每日一次）与 semantic-dedup-scan 同节奏：它要 spawn 一个 fresh-context agent
 *  跑一遍全树，⛔ 不是每任务热路径（gap-fan-in-remove-archguard-gate 的教训）。 */
export const DEFAULT_PROBE_ROUTINE_DECLS: readonly RoutineDecl[] = [
  { name: "architecture-analysis", trigger: "interval:1440m", probe: "architecture-analysis", dispatch: null },
];

/** workspace 级 Claude 设置里是否登记了 archguard（MCP server 或插件）。
 *  只认**启用面**字段：`enabledMcpjsonServers` / `mcpServers` / `enabledPlugins`（值为真）。 */
function jsonDeclaresArchguard(doc: unknown): boolean {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return false;
  const rec = doc as Record<string, unknown>;
  const entries = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  if (entries(rec.enabledMcpjsonServers).some((s) => s.toLowerCase().includes("archguard"))) return true;
  for (const key of ["mcpServers", "enabledPlugins"] as const) {
    const v = rec[key];
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    for (const [name, on] of Object.entries(v as Record<string, unknown>)) {
      if (on !== false && name.toLowerCase().includes("archguard")) return true;
    }
  }
  return false;
}

/** 本主机是否装有 archguard 仪器——两个**独立**的宿主信号，任一即可：
 *   (a) CLI：复用 `archguard-runner.ts` 的解析器（`ARCHGUARD_RUNNER_CLI` 或 PATH）——⛔ 不写第二份；
 *   (b) 工作区 `.claude/settings*.json` 里登记了 archguard MCP/插件（quay init 只登记 quay 自己，
 *       所以一个**全新**第三方工作区天然没有这个信号）。
 *  读不出/都没有 ⇒ `unavailable`（fail-closed：探针**零 spawn**、记 not-evaluated 并点名查过什么）。
 *  ⚠️ 不声称「MCP 此刻连得上」：只回答「本主机有没有这个仪器的任何安装形态」。 */
export function resolveArchguardInstrumentAvailability(root: string): { state: "available" | "unavailable"; detail: string } {
  const cli = resolveArchguardCli();
  if (cli) return { state: "available", detail: `archguard CLI resolved at ${cli}` };
  const checked: string[] = [];
  for (const rel of [".claude/settings.json", ".claude/settings.local.json"]) {
    const p = path.join(root, rel);
    checked.push(rel);
    if (!fs.existsSync(p)) continue;
    let doc: unknown;
    try { doc = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
    if (jsonDeclaresArchguard(doc)) return { state: "available", detail: `archguard MCP/plugin registered in ${rel}` };
  }
  return {
    state: "unavailable",
    detail: `no archguard CLI on PATH (ARCHGUARD_RUNNER_CLI unset/unresolvable) and no archguard MCP/plugin in ${checked.join(" / ")}`,
  };
}

/** 注入给 probe 轨道的宿主前置：只对**本主机可判定**的仪器作答；其它仪器 `unknown` ⇒ 不阻断
 *  （硬规则 3b：没有可用性探针 ≠ 不可用）。
 *
 *  ⚠️ **只对 `architecture-analysis` probe 生效**（按 `decl.probe` 判定，⛔ 不按例程名——工作区可以给
 *  同一条规格起任意 name）。理由：`semantic-dedup-scan` 的规格同样声明 `instrument: archguard`，但它的
 *  真实产物来自 git-lens 的深扫臂、在没有 archguard 的主机上**本来就能跑**（生产上一直在跑）——把
 *  「仪器缺失」前置套到它身上会把一条活着的例程停掉。本 gap 的判据只针对 architecture-analysis。 */
export function archguardInstrumentPreflight(root: string): (instrument: string, decl: RoutineDecl) => { state: "available" | "unavailable" | "unknown"; detail: string } {
  return (instrument, decl) => {
    if (decl.probe !== "architecture-analysis") return { state: "unknown", detail: `instrument preflight not applied to probe '${decl.probe}'` };
    if (instrument !== "archguard") return { state: "unknown", detail: `no host-level availability probe for instrument '${instrument}'` };
    return resolveArchguardInstrumentAvailability(root);
  };
}

/** 默认 probe 例程的装配：与配置声明的例程**同一条机制**（`llmProbeRoutine`），只额外带上宿主前置。 */
export function buildDefaultProbeRoutines(
  root: string,
  opts: { pluginRoot: string; probeTimeoutMs: number; stateDir?: string; probeArgv?: (prompt: string, decl: RoutineDecl) => string[]; kernelPluginRoot?: string | null },
  declaredNames: ReadonlySet<string>,
): { routines: ReturnType<typeof llmProbeRoutine>[]; decls: RoutineDecl[] } {
  const decls = DEFAULT_PROBE_ROUTINE_DECLS.filter((d) => !declaredNames.has(d.name));
  // 出厂布局下 task store CLI 的锚点（`resolveTaskCliEntry` 的第二分支）。缺省从本 kernel 的安装
  // 位置解析——⛔ 不让「调用方忘了传」重新变成「第三方宿主永不立案」（硬规则 4 推论二：依赖宿主的
  // ambient 常量不可作为能力前提；这里是同一形态的 fail-closed 缺省）。
  const kernelPluginRoot = opts.kernelPluginRoot !== undefined ? opts.kernelPluginRoot : resolveKernelPluginRoot();
  const routines = decls.map((d) => llmProbeRoutine(d, {
    root,
    pluginRoot: opts.pluginRoot,
    kernelPluginRoot,
    probeTimeoutMs: opts.probeTimeoutMs,
    ...(opts.stateDir ? { stateDir: opts.stateDir } : {}),
    ...(opts.probeArgv ? { probeArgv: opts.probeArgv } : {}),
    instrumentPreflight: archguardInstrumentPreflight(root),
  }));
  return { routines, decls };
}

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
    "The quay-file-task skill performs MECHANISM-BASED dedup. Apply the TWO rules below — an OPEN claim and a DONE claim are NOT the same case — and report every existing task id you matched:",
    "  • OPEN claim (existing task in todo/ready/needs-human) — it claims the same drift ⇒ a real duplicate: do NOT file; report that task id instead.",
    "  • DONE/superseded claim — a done task claiming the same drift is NOT proof the drift is gone (a task can be closed while the drift is still visible in the current source; done ≠ absent, hard rule 5b). Verify against the CURRENT SOURCE before deciding: re-read the named check / file:line you named above. STILL visible ⇒ FILE the task, and carry the old task id in the body as traceability (`prior-claim: <id>`) — that is not a duplicate. GONE from the current source ⇒ do NOT file; report 'the old task already fixed it' together with the evidence you checked.",
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
 *  `claude -p`，输出 JSON 对象，聚合仍走 architecture-review-cluster.ts 的单一 JS 算术。
 *  `actionable` 是本任务（gap-arch-review-judge-verdicts-never-reach-the-existing-gap-filing-
 *  channel）加的**结构化**立案判定：⛔ 不让下游解析 suggestedAction 的自由文本（那会把判定从 LLM
 *  挪进正则）。语义定义写在 prompt 里，三态由 mergeClusterVerdicts 兜底（缺失 ⇒ 未评估，非 false）。
 *
 *  `priorFindings`（gap-arch-review-judge-consumes-prior-round-findings）是**上一轮 judged 记录里
 *  的逐簇判词**：judge 必须对每条给 survived / resolved / denied（给不出 ⇒ not-evaluated），且
 *  resolved/denied 的依据必须是 **current-source 核对**（file:line 或 grep 命中），⛔ 不是「任务库
 *  里有一条 done 任务」。⚠️ prompt 只是**输入侧**；执行点在 `mergePriorFindingRulings()` 的机械
 *  降级（⛔ 不把判据寄托在措辞上，硬规则 9）。 */
export function archReviewJudgePrompt(clusters: Cluster[], root: string, priorFindings: PriorFinding[] = []): string {
  const summary = clusters
    .map((c) => `  ${c.clusterId} [${c.primitive}] files=${c.files.length} rawCount=${c.rawCount} — ${c.label} — ${c.files.slice(0, 12).join(", ")}${c.files.length > 12 ? ", …" : ""}`)
    .join("\n");
  const prior = priorFindings
    .map((p) => `  ${p.clusterId} [${p.primitive}] priorVerdict=${p.priorVerdict || "(none)"} round=${p.priorRound} — ${p.label} — files: ${p.files.slice(0, 12).join(", ")}${p.files.length > 12 ? ", …" : ""}${p.priorReasoning ? ` — prior reasoning: ${p.priorReasoning}` : ""}`)
    .join("\n");
  const priorBlock = priorFindings.length > 0
    ? [
        `Prior-round findings (round ${priorFindings[0].priorRound}, judged ${priorFindings[0].priorJudgedAt || "unknown"}) — you MUST rule on EVERY one of them:`,
        prior,
        "For EACH prior finding, re-check it against the CURRENT source tree (`root`) and set `state` to exactly one of:",
        "  survived      — the defect/problem is STILL visible in the current source.",
        "  resolved      — the prior finding named a real defect that is NO LONGER visible in the current source.",
        "  denied        — the prior finding was WRONG / not a real defect (it was a misreading of the source).",
        "  not-evaluated — you could not verify it against the current source. ⛔ Do NOT guess, and do NOT downgrade it to denied.",
        "Every survived/resolved/denied ruling MUST carry `evidence`: the CURRENT-SOURCE check you actually ran —",
        '  either a `path:line` reference (e.g. "plugin/scripts/x.ts:42 still imports y") or a grep hit (e.g. `grep -rn "Foo" plugin/scripts → 3 hits`).',
        "⛔ Do NOT cite the task store as evidence: an existing/done task (tasks/<id>.md) is NOT proof that the defect is resolved — it is a proxy and can be wrong.",
      ]
    : [
        "No prior-round findings are available (this is the first judged round) — emit an empty `priorFindings` array.",
      ];
  return [
    "You are the architecture-review judge for the quay repo (docs/proposals/archguard-generation-era-primitives.md §3).",
    "Mechanical clustering already grouped suspicious files into candidate clusters — trust it as arithmetic, NOT a verdict.",
    `Repo root: ${root}. Candidate clusters:`,
    summary || "(none)",
    "For EACH cluster decide: does it warrant abstracting/merging (real identity replication / deletion-closure debt), or is it coincidental similarity to keep as-is?",
    "Also set `actionable`: true iff this cluster names a defect that should be FIXED BY A TASK — either (a) real replication/deletion debt to merge, or (b) a defect in the detector/pipeline that produced this cluster (e.g. generated directories or worktree snapshots polluting the measured dependency graph, so the number is an artifact rather than a real signal).",
    "Set `actionable` false when the cluster is coincidental similarity, or mere load-bearing centrality that is correct by design — no task should be filed for those.",
    ...priorBlock,
    "Reply with ONLY a JSON object (no prose, no code fence):",
    '{"clusters":[{"clusterId":"<id>","verdict":"abstract|coincidental|uncertain","reasoning":"<one line>","suggestedAction":"<one line>","actionable":true|false}],"priorFindings":[{"clusterId":"<prior cluster id, verbatim>","state":"survived|resolved|denied|not-evaluated","evidence":"<path:line or grep hit>"}]}',
  ].join("\n");
}

/** 缺省架构复核 judge 命令（launchArgv role=pool-judge → 短命 claude -p，复用 B15 的 profile 机制）。 */
export function defaultArchReviewJudgeArgv(
  clusters: Cluster[],
  root: string,
  priorFindings: PriorFinding[] = [],
): string[] {
  return launchArgv("pool-judge", archReviewJudgePrompt(clusters, root, priorFindings), root);
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
    "The quay-file-task skill performs MECHANISM-BASED dedup. Apply the TWO rules below — an OPEN claim and a DONE claim are NOT the same case — and report every existing task id you matched:",
    "  • OPEN claim (existing task in todo/ready/needs-human) — it claims the same mechanism ⇒ a real duplicate: do NOT file; report that task id instead.",
    "  • DONE/superseded claim — a done task claiming the same mechanism is NOT proof the defect is gone (a task can be closed while the defect is still visible in the current source; done ≠ absent, hard rule 5b). Verify against the CURRENT SOURCE before deciding: grep/read the file:line you named above. STILL visible ⇒ FILE the task, and carry the old task id in the body as traceability (`prior-claim: <id>`) — that is not a duplicate. GONE from the current source ⇒ do NOT file; report 'the old task already fixed it' together with the file:line / grep hit you checked.",
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
  /** 本轮复核的上一轮 finding 数（gap-arch-review-judge-consumes-prior-round-findings）。 */
  priorFindingCount?: number;
  /** 逐条复核的聚合态（none/checked/partial/not-evaluated）——**只在 judge 真的跑过时**出现：
   *  早退路径（halt / 资源门 / 判词失败）根本没做这一步，⛔ 不得在那里写 "none"（那会把「没做」
   *  伪装成「上一轮没有 findings」，硬规则 3b）。 */
  priorFindingsState?: PriorFindingsCheckState;
  priorSurvived?: number;
  priorResolved?: number;
  priorDenied?: number;
  priorNotEvaluated?: number;
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
  /** judge 输出的逐簇判词；`null` = stdout 不是可读形态（⛔ 与「判过但为空」不同形，硬规则 3b）。 */
  verdicts: JudgeClusterVerdict[] | null;
  /** judge 输出的逐条 prior-finding 判词；`null` = 输出没带这个面（旧裸数组形态 ⇒ 整批未评估）。
   *  ⛔ 不 default 成 []：「没判」与「判过且没有 prior findings」不同形（硬规则 3b）。 */
  priorRulings: JudgePriorRuling[] | null;
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
 *  （.quay/architecture-review-round.jsonl）。四态（硬规则 3b）：
 *    · 任一检测器读不懂/没有候选宇宙 ⇒ `not-evaluated`（记录逐检测器带上 reason）；
 *    · judge 失败/判词为空 ⇒ `failed`；
 *    · **每个**检测器都评估过且候选簇为空 ⇒ `not-triggered`（「干净」的真条件）；
 *    · 有候选簇 ⇒ `judged`。
 *  ⛔ `not-triggered` 不再由「簇为空」单独决定（gap-architecture-review-not-triggered-lacks-per-
 *  detector-state）：真实宿主 ClaudeCodeUI 的 83/83 轮全零曾被读成「干净」，实则三个检测器在那个
 *  根上根本没有候选宇宙。判定现在消费 `trigger.state`，并逐检测器把 evaluated/reason/clusters 写进载体。
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
  const writeRecord = (record: ArchReviewRoundRecord): void => {
    if (recordVerdicts) appendArchReviewRoundSafe(root, record);
  };
  /** 一条检测器**没跑成**的自报态（前序步骤已失败 ⇒ 后续检测器未执行）。⛔ 不省略成员：
   *  省略会让「未评估」与「评估且干净」在 `detectors` 数组上同形。 */
  const detectorNotRun = (id: string, why: string): ArchReviewDetectorState =>
    ({ id, evaluated: false, reason: `not-run: ${why}`, clusters: [] });
  /** 落一条 not-evaluated 载体记录并返回对应的 Fact。检测器解析不出/spawn 失败/输出读不懂时也写
   *  （AC1：not-evaluated 的记录必须带该 detector 的 reason，⛔ 不是无痕返回）。 */
  const notEvaluatedFact = (
    detectors: ArchReviewDetectorState[],
    reason: string,
    value: ArchReviewFactValue | null = null,
  ): Fact<ArchReviewFactValue | null> => {
    writeRecord(buildArchReviewRoundRecord({
      round: readCurrentRound(root),
      judgedAt: new Date().toISOString(),
      state: "not-evaluated",
      triggerReasons: detectors.filter((d) => !d.evaluated).map((d) => `detector-not-evaluated:${d.id}`),
      clusters: [],
      detectors,
      reason,
    }));
    return { name: "architecture-review", value, state: "not-evaluated", reason };
  };

  // 1. P2 身份复制（必需——既产 P2 簇又推导 P1 候选构件）。
  const identityArgv = identityCmd ?? defaultIdentityReplicationArgv(root);
  // ⛔ 解析不到脚本体 ⇒ not-evaluated（硬规则 3b：不得 spawn 一个不存在的路径再把它读成「跑过且无数据」）。
  if (identityArgv === null) {
    const fact = detectorUnresolvedFact("identity-replication-check.ts");
    return notEvaluatedFact([
      detectorNotRun(ARCH_REVIEW_DETECTOR_IDS.identity, "script unresolved"),
      detectorNotRun(ARCH_REVIEW_DETECTOR_IDS.lineage, "identity detector unresolved"),
      detectorNotRun(ARCH_REVIEW_DETECTOR_IDS.deletion, "identity detector unresolved"),
    ], String(fact.reason));
  }
  const identityR = await runAsync(identityArgv, { timeoutMs: ROUTINE_TIMEOUT_MS });
  if (identityR.error) {
    const reason = `identity-replication spawn error: ${identityR.error.message}`;
    return notEvaluatedFact([
      { id: ARCH_REVIEW_DETECTOR_IDS.identity, evaluated: false, reason, clusters: [] },
      detectorNotRun(ARCH_REVIEW_DETECTOR_IDS.lineage, "identity detector failed"),
      detectorNotRun(ARCH_REVIEW_DETECTOR_IDS.deletion, "identity detector failed"),
    ], reason);
  }
  const identity = parseDetectorJson<IdentityReportView>(identityR.stdout ?? "");
  if (identity === null) {
    const reason = `unparseable identity-replication output (exit ${identityR.status}): ${diagnosticExcerpt(identityR.stdout)}`;
    return notEvaluatedFact([
      { id: ARCH_REVIEW_DETECTOR_IDS.identity, evaluated: false, reason, clusters: [] },
      detectorNotRun(ARCH_REVIEW_DETECTOR_IDS.lineage, "identity detector unreadable"),
      detectorNotRun(ARCH_REVIEW_DETECTOR_IDS.deletion, "identity detector unreadable"),
    ], reason);
  }
  const identityEval = detectorEvalFromSurface(identity.rootSurface, ARCH_REVIEW_DETECTOR_IDS.identity);
  const identityState = (): ArchReviewDetectorState =>
    ({ id: ARCH_REVIEW_DETECTOR_IDS.identity, evaluated: identityEval.evaluated, reason: identityEval.reason, clusters: [] });

  // 2. P4 守卫谱系（必需）。
  const lineageArgv = lineageCmd ?? defaultGuardLineageArgv(root);
  if (lineageArgv === null) {
    const fact = detectorUnresolvedFact("guard-lineage-check.ts");
    return notEvaluatedFact([
      identityState(),
      detectorNotRun(ARCH_REVIEW_DETECTOR_IDS.lineage, "script unresolved"),
      detectorNotRun(ARCH_REVIEW_DETECTOR_IDS.deletion, "guard-lineage detector unresolved"),
    ], String(fact.reason));
  }
  const lineageR = await runAsync(lineageArgv, { timeoutMs: ROUTINE_TIMEOUT_MS });
  if (lineageR.error) {
    const reason = `guard-lineage spawn error: ${lineageR.error.message}`;
    return notEvaluatedFact([
      identityState(),
      { id: ARCH_REVIEW_DETECTOR_IDS.lineage, evaluated: false, reason, clusters: [] },
      detectorNotRun(ARCH_REVIEW_DETECTOR_IDS.deletion, "guard-lineage detector failed"),
    ], reason);
  }
  const lineage = parseDetectorJson<LineageReportView>(lineageR.stdout ?? "");
  if (lineage === null) {
    const reason = `unparseable guard-lineage output (exit ${lineageR.status}): ${diagnosticExcerpt(lineageR.stdout)}`;
    return notEvaluatedFact([
      identityState(),
      { id: ARCH_REVIEW_DETECTOR_IDS.lineage, evaluated: false, reason, clusters: [] },
      detectorNotRun(ARCH_REVIEW_DETECTOR_IDS.deletion, "guard-lineage detector unreadable"),
    ], reason);
  }
  const lineageEval = detectorEvalFromSurface(lineage.rootSurface, ARCH_REVIEW_DETECTOR_IDS.lineage);

  // 3. P1 删除闭包（候选构件由 identity 报告推导；无候选 ⇒ 空报告，跳过 spawn）。
  const components = deletionClosureComponents(identity);
  let deletion: DeletionReportView = { components: [], dc: [], counts: { dcTotal: 0, callGraphTotal: 0, ratio: null } };
  if (components.length > 0) {
    const deletionArgv = deletionCmd ?? defaultDeletionClosureArgv(root, components);
    if (deletionArgv === null) {
      const fact = detectorUnresolvedFact("deletion-closure-check.ts");
      return notEvaluatedFact([
        identityState(),
        { id: ARCH_REVIEW_DETECTOR_IDS.lineage, evaluated: lineageEval.evaluated, reason: lineageEval.reason, clusters: [] },
        detectorNotRun(ARCH_REVIEW_DETECTOR_IDS.deletion, "script unresolved"),
      ], String(fact.reason));
    }
    const deletionR = await runAsync(deletionArgv, { timeoutMs: ROUTINE_TIMEOUT_MS });
    if (deletionR.error) {
      const reason = `deletion-closure spawn error: ${deletionR.error.message}`;
      return notEvaluatedFact([
        identityState(),
        { id: ARCH_REVIEW_DETECTOR_IDS.lineage, evaluated: lineageEval.evaluated, reason: lineageEval.reason, clusters: [] },
        { id: ARCH_REVIEW_DETECTOR_IDS.deletion, evaluated: false, reason, clusters: [] },
      ], reason);
    }
    const parsed = parseDetectorJson<DeletionReportView>(deletionR.stdout ?? "");
    if (parsed === null) {
      const reason = `unparseable deletion-closure output (exit ${deletionR.status}): ${diagnosticExcerpt(deletionR.stdout)}`;
      return notEvaluatedFact([
        identityState(),
        { id: ARCH_REVIEW_DETECTOR_IDS.lineage, evaluated: lineageEval.evaluated, reason: lineageEval.reason, clusters: [] },
        { id: ARCH_REVIEW_DETECTOR_IDS.deletion, evaluated: false, reason, clusters: [] },
      ], reason);
    }
    deletion = parsed;
  }

  // 4. 机械聚类 → 逐检测器自报态 → 触发评估。
  //    ⛔ per-detector 簇与合并簇**同源**（clusterByDetector 一次算，flatten 只排序），
  //    否则「某一检测器 clusters 为空」与「它产出的簇被合进来」会各说各话（硬规则 5b）。
  const perDetector = clusterByDetector({ identity, lineage, deletion });
  const clusters = flattenDetectorClusters(perDetector);
  // P1 的候选宇宙由 P2 报告推导 ⇒ 它的 evaluated 是派生的（见 deletionDetectorEvaluation 注释）。
  const deletionEval = deletionDetectorEvaluation({
    components,
    identityEvaluated: identityEval.evaluated,
    deletionSurface: deletion.rootSurface,
  });
  const trigger = computeArchReviewTrigger([
    { id: ARCH_REVIEW_DETECTOR_IDS.identity, ...identityEval, clusters: perDetector.identity },
    { id: ARCH_REVIEW_DETECTOR_IDS.lineage, ...lineageEval, clusters: perDetector.lineage },
    { id: ARCH_REVIEW_DETECTOR_IDS.deletion, ...deletionEval, clusters: perDetector.deletion },
  ]);

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
  if (!trigger.fired) {
    // AC1/AC2：无候选簇时**只有**每个检测器都评估过才允许 not-triggered；否则 not-evaluated，
    // 且 reason 逐检测器点名（硬规则 3b：没有候选宇宙 ≠ 干净）。
    const state = trigger.state === "not-triggered" ? "not-triggered" : "not-evaluated";
    const reason = state === "not-triggered"
      ? "no candidate clusters (every detector evaluated and produced zero suspicious groupings)"
      : `not-evaluated: ${trigger.detectors.filter((d) => !d.evaluated).map((d) => `${d.id}: ${d.reason}`).join("; ")}`;
    writeRecord(buildArchReviewRoundRecord({
      round: readCurrentRound(root),
      judgedAt: new Date().toISOString(),
      state,
      triggerReasons: trigger.reasons,
      clusters: [],
      detectors: trigger.detectors,
      reason,
    }));
    return {
      name: "architecture-review",
      value: base,
      state: state === "not-triggered" ? "verified" : "not-evaluated",
      reason,
    };
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
  //    ⚠️ 读「上一轮」必须在**本轮记录写盘之前**（judge 输入 = 上一轮 judged 记录的逐簇判词）。
  //    读不懂载体 ⇒ `unreadable`（⛔ 不当作「没有上一轮」：那会把「不知道」伪装成「首轮」）。
  const prior = readPriorRoundFindings(root);
  const argv = judgeArgv ?? defaultArchReviewJudgeArgv(clusters, root, prior.findings);
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
    let priorRulings: JudgePriorRuling[] | null = null;
    try {
      const parsed = JSON.parse(stdout.trim());
      // 两种形态都认（向后兼容）：
      //  · 旧形态 = 裸数组（只有逐簇判词 ⇒ priorRulings 保持 null ⇒ 全部 prior findings 未评估）；
      //  · 新形态 = {clusters:[…], priorFindings:[…]}（本任务要求的形态，prompt 里逐字给出）。
      if (Array.isArray(parsed)) {
        verdicts = parsed;
      } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { clusters?: unknown }).clusters)) {
        verdicts = (parsed as { clusters: JudgeClusterVerdict[] }).clusters;
        const pf = (parsed as { priorFindings?: unknown }).priorFindings;
        if (Array.isArray(pf)) priorRulings = pf as JudgePriorRuling[];
      }
    } catch { /* 非 JSON ⇒ verdicts 保持 null（⛔ 不伪装成「判过但为空」） */ }
    // 捕获：只在**没有产出可用判词**的调用上留痕（与 OSD 同形——成功调用的判词已逐簇落在载体上，
    // 再存一份流就是 transcript 而不是诊断）。写失败【报在记录上】，⛔ 不是静默缺失（硬规则 3b：
    // 「无字节可看」与「没有捕获文件」必须不同形）。
    let capture: Record<string, unknown> | null = null;
    const attempt: ArchReviewJudgeAttempt = { r, verdicts, priorRulings, failure, apiErrorEvent, hasResult, stdoutBytes, diagnostic: diagnosticExcerpt(stdout), capture: null };
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
      triggerReasons: trigger.reasons, clusters: [], detectors: trigger.detectors, reason,
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
  // 逐条复核上一轮 findings（gap-arch-review-judge-consumes-prior-round-findings）。三态由
  // mergePriorFindingRulings 兜底：缺判词/词表外/依据非 current-source ⇒ not-evaluated（⛔ 不折叠
  // 成 denied）。聚合态与逐条 ruling **同一载体**（跟 clusters 同一条记录），供下一轮消费。
  const priorRulings = mergePriorFindingRulings(prior.findings, attempt.priorRulings);
  const priorState = priorFindingsCheckState(prior, priorRulings);
  const priorRound: ArchReviewPriorRound = {
    state: prior.state,
    round: prior.round,
    judgedAt: prior.judgedAt,
    findingCount: prior.findings.length,
    ...(prior.reason !== undefined ? { reason: prior.reason } : {}),
  };
  writeRecord(buildArchReviewRoundRecord({
    round, judgedAt, state: "judged", triggerReasons: trigger.reasons, clusters: merged, detectors: trigger.detectors,
    priorRound, priorFindings: priorRulings, priorFindingsState: priorState,
  }));

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
    priorFindingCount: priorRulings.length,
    priorFindingsState: priorState,
    priorSurvived: priorRulings.filter((r) => r.state === "survived").length,
    priorResolved: priorRulings.filter((r) => r.state === "resolved").length,
    priorDenied: priorRulings.filter((r) => r.state === "denied").length,
    priorNotEvaluated: priorRulings.filter((r) => r.state === "not-evaluated").length,
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
  // 上一轮 findings 的逐条复核读数也进 reason（⛔ 只写进载体会让「每轮都在核」在 driver 输出里不可见；
  // not-evaluated 明确成词，不与 denied 同形）。
  const priorSummary = priorRulings.length > 0
    ? `; prior-findings ${priorState}: survived=${value.priorSurvived} resolved=${value.priorResolved} denied=${value.priorDenied} not-evaluated=${value.priorNotEvaluated}`
    : prior.state === "unreadable"
      ? `; prior-findings not-evaluated: ${prior.reason ?? "prior round carrier unreadable"}`
      : `; prior-findings none`;
  return {
    name: "architecture-review",
    value,
    state: "verified",
    reason: `judged ${merged.length} cluster(s): ${summary || "none"}${filing}${unreadable}${priorSummary}`,
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

// ── arch-coverage-report 的 config 入口（`.quay/config.yml` `loop.arch_coverage_report:`）────────
// 同族 declarative 例程（arch_discovery / discovery_method / open_semantic_discovery /
// resource_diagnostic / cross_project_dogfood）的第七条：**段缺席 ⇒ 不装配**（off by default，宿主
// 例程表逐条不变），段存在但 `enabled:false` ⇒ 仍装配、每轮记 `not-evaluated:disabled` 且零写入
// （kill switch 必须可观测），段写坏 ⇒ 仍装配、记 `failed` 且零写入（硬规则 3b：读不懂 ≠ 合格）。
//
// ⛔ 为什么是声明式而不是第五条内建例程：`qualityGateRoutines()` 的「恰好四条」是 AC144 的结构判据
// （B15/B17/架构复核/packaging-hygiene），把一条覆盖面报表塞进去会让那条判据失去意义；同族前六条
// 也都走「config 声明 → 注入 → 例程表追加」这条路，本轨不另造机制。
export interface ArchCoverageConfig {
  enabled: boolean;
  /** `enabled:false` ⇒ null（不参与调度）。 */
  intervalMinutes: number | null;
}

export interface ArchCoverageConfigRead {
  present: boolean;
  config: ArchCoverageConfig | null;
  error: string | null;
}

const cfgCoverageBad = (msg: string) => `loop.arch_coverage_report ${msg}`;

/** 纯解析一个 `loop.arch_coverage_report` 值（同 `parseArchitectureReviewSection` 的形状：
 *  `enabled` 必填布尔；disabled 段立即返回——kill switch 必须在别的键缺席/写坏时也能生效；
 *  enabled 段必须携带合法的 `interval:<N>m` 且不低于下限）。 */
export function parseArchCoverageSection(raw: unknown): { config: ArchCoverageConfig | null; error: string | null } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { config: null, error: cfgCoverageBad(`must be a mapping (got ${Array.isArray(raw) ? "array" : raw === null ? "null" : typeof raw})`) };
  }
  const rec = raw as Record<string, unknown>;
  if (typeof rec.enabled !== "boolean") {
    return { config: null, error: cfgCoverageBad(`needs a boolean 'enabled' (got ${rec.enabled === undefined ? "missing" : JSON.stringify(rec.enabled)})`) };
  }
  if (rec.enabled === false) return { config: { enabled: false, intervalMinutes: null }, error: null };
  if (typeof rec.interval !== "string") {
    return { config: null, error: cfgCoverageBad(`needs an 'interval' string of the form interval:<N>m (got ${rec.interval === undefined ? "missing" : JSON.stringify(rec.interval)})`) };
  }
  let trigger: { kind: string; minutes?: number };
  try {
    trigger = parseTrigger(rec.interval) as { kind: string; minutes?: number };
  } catch (e) {
    return { config: null, error: cfgCoverageBad(`invalid 'interval' — ${(e as Error).message}`) };
  }
  if (trigger.kind !== "interval" || typeof trigger.minutes !== "number") {
    return { config: null, error: cfgCoverageBad(`'interval' must be interval:<N>m (got kind '${trigger.kind}')`) };
  }
  if (trigger.minutes < ARCH_COVERAGE_MIN_INTERVAL_MINUTES) {
    return { config: null, error: cfgCoverageBad(`interval ${trigger.minutes}m is below the ${ARCH_COVERAGE_MIN_INTERVAL_MINUTES}m floor — refused, not silently rounded`) };
  }
  return { config: { enabled: true, intervalMinutes: trigger.minutes }, error: null };
}

/** 读 `.quay/config.yml` `loop.arch_coverage_report:`（同族读法：无 config / 无 `loop:` / 无段
 *  ⇒ `present:false`；YAML 或段写坏 ⇒ `error` 置位，fail-closed）。 */
export function readArchCoverageConfig(workspaceRoot: string): ArchCoverageConfigRead {
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
  const raw = (loop as Record<string, unknown>).arch_coverage_report;
  if (raw === undefined || raw === null) return { present: false, config: null, error: null };
  const { config, error } = parseArchCoverageSection(raw);
  return { present: true, config, error };
}

/** The arch-coverage-round Fact value — the reading the routine contributes to `quality-round.jsonl`.
 *  `reportOnly: true` is a CONSTANT, not a claim to be checked: this routine has no threshold, no
 *  ratchet and no filing path. */
export interface ArchCoverageFactValue {
  mode: "arch-coverage-report-round";
  evaluated: boolean;
  totals: ArchCoverageReport["totals"];
  notEvaluatedLanguages: string[];
  notEvaluatedLanguageCount: number;
  noAnalyzerLanguages: string[];
  noAnalyzerLanguageCount: number;
  uncoveredTsDirs: string[];
  uncoveredTsDirsEvaluated: boolean;
  historyPath: string;
  historyAppended: boolean;
  reportOnly: true;
}

export interface ArchCoverageRoundOptions {
  config?: ArchCoverageConfig | null;
  configPresent?: boolean;
  configError?: string | null;
  /** Test / alternate-carrier seam; default `<root>/.quay/arch-coverage-history.jsonl`. */
  historyPath?: string;
  /** Deterministic `ts` seam for the carrier line. */
  now?: string;
}

/** Run ONE arch-coverage round: produce the report and append one baseline line to the carrier.
 *
 *  ⛔ THE FAILURE VOCABULARY IS DELIBERATELY SPLIT (task AC3 / 硬规则 3b):
 *    • `failed`         — the routine could not do its job: bad config, or the carrier could not be
 *                         written. NOT used because some languages are unevaluated.
 *    • `not-evaluated`  — the report itself could not be trusted (manifest unparseable / no git), or
 *                         the kill switch is engaged. The line is STILL appended (with
 *                         `evaluated:false`) so the carrier records the inability, not silence.
 *    • `verified`       — a report was produced AND persisted. `notEvaluatedLanguageCount` may be > 0;
 *                         that is the report's content ("these languages have no analyzer"), never a
 *                         red. A ratchet over it would be a different task (this one is report-only). */
export function runArchCoverageRound(root: string, opts: ArchCoverageRoundOptions = {}): Fact<ArchCoverageFactValue | null> {
  const name = ARCH_COVERAGE_ROUTINE_NAME;
  if (opts.configError) return { name, value: null, state: "failed", reason: opts.configError };
  if (opts.configPresent === false) {
    return { name, value: null, state: "not-evaluated", reason: "not-evaluated:not-declared — loop.arch_coverage_report is absent (the routine is only assembled when the section is declared)" };
  }
  if (opts.config === null) {
    // present-but-unparsed is unreachable through the reader (it always sets `error`), but a direct
    // caller must still fail closed rather than silently running with invented defaults.
    return { name, value: null, state: "failed", reason: cfgCoverageBad("present but could not be parsed") };
  }
  if (opts.config && !opts.config.enabled) {
    return { name, value: null, state: "not-evaluated", reason: "not-evaluated:disabled — .quay/config.yml loop.arch_coverage_report.enabled=false（kill switch：零报告、零写入）" };
  }

  const resolvedRoot = path.resolve(root);
  const { report } = runCoverageReport({ root: resolvedRoot, now: opts.now });
  const record = buildCoverageHistoryRecord(report, opts.now);
  const appended = appendCoverageHistory(resolvedRoot, report, {
    ...(opts.historyPath ? { historyPath: opts.historyPath } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
  const value: ArchCoverageFactValue = {
    mode: "arch-coverage-report-round",
    evaluated: report.evaluated,
    totals: record.totals,
    notEvaluatedLanguages: record.notEvaluatedLanguages,
    notEvaluatedLanguageCount: record.notEvaluatedLanguageCount,
    noAnalyzerLanguages: record.noAnalyzerLanguages,
    noAnalyzerLanguageCount: record.noAnalyzerLanguageCount,
    uncoveredTsDirs: record.uncoveredTsDirs,
    uncoveredTsDirsEvaluated: record.uncoveredTsDirsEvaluated,
    historyPath: appended.path,
    historyAppended: appended.ok,
    reportOnly: true,
  };
  if (!appended.ok) {
    return { name, value, state: "failed", reason: `history carrier not writable at ${appended.path} — ${appended.error}` };
  }
  if (!report.evaluated) {
    return {
      name,
      value,
      state: "not-evaluated",
      reason: `${report.reason ?? "not-evaluated"}: ${report.error ?? "the report could not be evaluated"}`,
    };
  }
  // ⛔ AC3: a non-zero NOT-EVALUATED language count is NOT a failure. The count is IN the value, so a
  // reader can still see it — it just never becomes the round's verdict.
  return { name, value, state: "verified", reason: null };
}

export interface ArchCoverageRoutineOptions {
  historyPath?: string;
  now?: string;
}

/** Build the RoutineSpec (scheduler / watchdog / halt are the driver's, not re-implemented here). */
export function buildArchCoverageRoutine(
  root: string,
  read: ArchCoverageConfigRead,
  opts: ArchCoverageRoutineOptions = {},
): RoutineSpec {
  const minutes = read.config?.intervalMinutes ?? ARCH_COVERAGE_INTERVAL_MIN_DEFAULT;
  return {
    name: ARCH_COVERAGE_ROUTINE_NAME,
    schedule: { kind: "interval", minutes },
    // Halt is a round-internal gate for GATED ACTIONS (spawn / model calls). This routine is a pure
    // read plus one append — the same class as `judgment-consumer-check`, whose comment records that
    // observation keeps running while halted (gap-drain-on-routine-driver-empties-round-and-respawn-loops).
    run: () => [
      runArchCoverageRound(root, {
        config: read.config,
        configPresent: read.present,
        configError: read.error,
        ...(opts.historyPath ? { historyPath: opts.historyPath } : {}),
        ...(opts.now ? { now: opts.now } : {}),
      }),
    ],
  };
}

/** Production entry: read `.quay/config.yml` and build the routine. NEVER throws (an optional routine
 *  track must not take down the driver's startup).
 *
 *  `routine` is `null` when NO section is declared — an undeclared workspace keeps the EXACT routine
 *  set it had before (AC144's "exactly four" test runs on an empty root and must keep seeing four).
 *  A DECLARED section always yields a routine, even `enabled:false` or malformed, because "not
 *  running" must be observable (硬规则 3/3b). */
export function archCoverageRoutineFromConfig(
  root: string,
  opts: ArchCoverageRoutineOptions = {},
): { routine: RoutineSpec | null; error: string | null; present: boolean; enabled: boolean } {
  const read = readArchCoverageConfig(root);
  return {
    routine: read.present ? buildArchCoverageRoutine(root, read, opts) : null,
    error: read.error,
    present: read.present,
    enabled: read.config?.enabled === true,
  };
}

/** The assembly line, as ONE string — it names what was ACTUALLY carried (interval / kill switch /
 *  fail-closed reason), so "declared but disabled", "malformed" and "running at the default cadence"
 *  never look the same in the driver's startup log (硬规则 3b/9). */
export function formatArchCoverageAssembly(a: {
  present: boolean;
  error: string | null;
  enabled: boolean;
  intervalMinutes: number;
}): string {
  if (a.error !== null) return `arch-coverage-report 例程已装配（${a.error} — 每轮记 failed、零报告零写入；⛔ 不回退到缺省节奏照跑）`;
  if (!a.enabled) return "arch-coverage-report 例程已装配（enabled:false — 每轮记 not-evaluated:disabled，零报告零写入）";
  return `arch-coverage-report 例程已装配（enabled, interval=${a.intervalMinutes}m，report-only：基线 append 到 .quay/arch-coverage-history.jsonl；NOT-EVALUATED 非零是该例程的读数，⛔ 不是 failed）`;
}

// ── arch-cycle-report 的 config 入口（`.quay/config.yml` `loop.arch_cycle_report:`）────────────
// 与 arch_coverage_report 同族的第八条声明式例程，语义逐条对齐（⛔ 不另造机制）：
//   • 段缺席        ⇒ 不装配（off by default，宿主例程表逐条不变——AC144 的「恰好四条」判据仍成立）；
//   • 段 enabled:false ⇒ 仍装配、每轮记 `not-evaluated:disabled` 且**零写入**（kill switch 必须可观测）；
//   • 段写坏        ⇒ 仍装配、记 `failed` 且零写入（硬规则 3b：读不懂 ≠ 合格）。
// 与其他七条的唯一差异是**读什么**：本轨读的是目录级环（archguard-runner 的
// `readDirectoryCycleReading`，即上次 analyze 落盘的 `moduleGraph.cycles`），且是 **report-only**：
// 环非空是该例程的读数内容，⛔ 不是 failed（闸的语义留在 archguard-runner / 未来的结构门里）。
export interface ArchCycleConfig {
  enabled: boolean;
  /** `enabled:false` ⇒ null（不参与调度）。enabled 段缺省为 ARCH_CYCLE_INTERVAL_MIN_DEFAULT。 */
  intervalMinutes: number | null;
}

export interface ArchCycleConfigRead {
  present: boolean;
  config: ArchCycleConfig | null;
  error: string | null;
}

const cfgCycleBad = (msg: string) => `loop.arch_cycle_report ${msg}`;

/** 纯解析一个 `loop.arch_cycle_report` 值。`enabled` 必填布尔；disabled 段立即返回（kill switch 必须
 *  在别的键缺席/写坏时也生效）；enabled 段的 `interval` **可省略**（缺省 360m，见 Plan），但一旦声明
 *  就必须是合法的 `interval:<N>m` 且不低于下限——写坏的 interval ⛔ 不静默回退到缺省。 */
export function parseArchCycleSection(raw: unknown): { config: ArchCycleConfig | null; error: string | null } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { config: null, error: cfgCycleBad(`must be a mapping (got ${Array.isArray(raw) ? "array" : raw === null ? "null" : typeof raw})`) };
  }
  const rec = raw as Record<string, unknown>;
  if (typeof rec.enabled !== "boolean") {
    return { config: null, error: cfgCycleBad(`needs a boolean 'enabled' (got ${rec.enabled === undefined ? "missing" : JSON.stringify(rec.enabled)})`) };
  }
  if (rec.enabled === false) return { config: { enabled: false, intervalMinutes: null }, error: null };
  if (rec.interval === undefined || rec.interval === null) {
    return { config: { enabled: true, intervalMinutes: ARCH_CYCLE_INTERVAL_MIN_DEFAULT }, error: null };
  }
  if (typeof rec.interval !== "string") {
    return { config: null, error: cfgCycleBad(`'interval' must be a string of the form interval:<N>m (got ${JSON.stringify(rec.interval)})`) };
  }
  let trigger: { kind: string; minutes?: number };
  try {
    trigger = parseTrigger(rec.interval) as { kind: string; minutes?: number };
  } catch (e) {
    return { config: null, error: cfgCycleBad(`invalid 'interval' — ${(e as Error).message}`) };
  }
  if (trigger.kind !== "interval" || typeof trigger.minutes !== "number") {
    return { config: null, error: cfgCycleBad(`'interval' must be interval:<N>m (got kind '${trigger.kind}')`) };
  }
  if (trigger.minutes < ARCH_CYCLE_MIN_INTERVAL_MINUTES) {
    return { config: null, error: cfgCycleBad(`interval ${trigger.minutes}m is below the ${ARCH_CYCLE_MIN_INTERVAL_MINUTES}m floor — refused, not silently rounded`) };
  }
  return { config: { enabled: true, intervalMinutes: trigger.minutes }, error: null };
}

/** 读 `.quay/config.yml` `loop.arch_cycle_report:`（同族读法：无 config / 无 `loop:` / 无段 ⇒
 *  `present:false`；YAML 或段写坏 ⇒ `error` 置位，fail-closed）。 */
export function readArchCycleConfig(workspaceRoot: string): ArchCycleConfigRead {
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
  const raw = (loop as Record<string, unknown>).arch_cycle_report;
  if (raw === undefined || raw === null) return { present: false, config: null, error: null };
  const { config, error } = parseArchCycleSection(raw);
  return { present: true, config, error };
}

/** One carrier line: the reading itself (per-scope cycle members) plus its evaluated state.
 *
 *  ⛔ `evaluated:false` lines are APPENDED TOO (with `totalCycleCount: null`): a round that could not
 *  read the module graph must leave a trace, otherwise "never read" and "read clean" look identical
 *  in the history (硬规则 3b — the same reason archguard-runner records its not-evaluated runs). */
export interface ArchCycleHistoryRecord {
  ts: string;
  mode: "arch-cycle-report-round";
  evaluated: boolean;
  reason: string | null;
  /** Record-level completeness (gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts):
   *  `complete` = every scope produced a reading; `partial` = at least one did (and `reason` names the
   *  ones that did not, with their reasons); `none` = nothing could be read (`totalCycleCount` null —
   *  ⛔ never 0). ADDITIVE: `evaluated` keeps its old "a reading exists" meaning, so a partial record
   *  is `evaluated:true` and the distinction is carried by THIS field instead of being collapsed. */
  status: "complete" | "partial" | "none";
  /** Sum over the scopes that produced a reading. null ONLY when `status === "none"`.
   *  (Before this task: null unless EVERY scope was readable — two permanently graph-less provider
   *  packages therefore voided a 4-cycle reading for 25 consecutive rounds.) */
  totalCycleCount: number | null;
  notEvaluatedScopes: string[];
  /** Scope labels whose sources moved AFTER the artifact the reading came from (`behindSources`).
   *  A behind scope still reports its cycle count, but its number is NOT the current tree — this list
   *  is what says so at the record level. */
  behindScopes: string[];
  scopes: Array<{
    scope: string;
    source: string;
    evaluated: boolean;
    reason: string | null;
    cycleCount: number | null;
    cycles: DirectoryCycle[] | null;
    /** `module-graph` (read from the artifact) or `single-directory` (derived from the tracked file
     *  list because no package-level diagram was ever requested); null ⇒ not evaluated. */
    basis: "module-graph" | "single-directory" | null;
    /** When THIS scope's artifact was produced (arch.json `timestamp`, else the manifest scope's
     *  `generatedAt`); null ⇒ no artifact was read for this scope. */
    artifactTimestamp: string | null;
    /** Commits after `artifactTimestamp` touching this scope's source dir; null ⇒ not computable. */
    commitsSinceArtifact: number | null;
    /** `commitsSinceArtifact > 0`; null ⇒ not computable. ⛔ A DIFFERENT question from the record-level
     *  `stale` (artifact age > interval): this one says the artifact no longer covers the sources. */
    behindSources: boolean | null;
  }>;
  /** The OLDEST artifact timestamp behind this line (the routine is only as fresh as its stalest
   *  scope). null ⇒ no artifact timestamp could be read.
   *
   *  WHY THIS FIELD EXISTS (gap-arch-cycle-report-record-artifact-timestamp): the routine reads what
   *  the LAST `analyze` persisted, and `archguard-runner` is on-demand — the query artifacts go days
   *  without being rewritten. Without this field the history line cannot be told apart from a reading
   *  of the CURRENT tree: readers saw the same stale 4-cycle reading for three consecutive days. */
  artifactTimestamp: string | null;
  /** `ts - artifactTimestamp` in ms; null when it cannot be computed (no timestamp, or an
   *  unparseable one) — ⛔ never 0, which would read as "just produced". */
  artifactAgeMs: number | null;
  /** The interval the staleness verdict compares against (`intervalMinutes * 60_000`); the record
   *  carries it so a reader does not have to re-derive the threshold from config history. */
  staleIntervalMs: number;
  /** `artifactAgeMs > staleIntervalMs`. Three-valued: null ⇒ staleness NOT EVALUABLE, ⛔ never
   *  `false` (硬规则 3b — "could not tell" must not share the value of "fresh"). */
  stale: boolean | null;
  /** The SAME-BATCH graph reading (gap-quality-round-facts-surface-top-out-degree-god-functions).
   *  Present on every line — `evaluated:false` lines carry `null` readings, never `{}`/`0`/`[]`. */
  graphSummary: GraphSummaryRecord;
  /** WHAT THIS ROUND DID ABOUT STALE ARTIFACTS. The routine is a reader, but it is the only thing that
   *  ever looks at these artifacts on a schedule — the mechanism that refills them lives here, bounded
   *  PER SCOPE to at most one analyze per scheduling interval (see `refreshBehindScopes` /
   *  `readLastRefreshAtByScope`): every due scope is attempted in the round, and only a scope that was
   *  itself refreshed recently is deferred. Always present, so "no refresh" is a stated decision
   *  (`skipped`) rather than silence. */
  refresh: ArchCycleRefreshRecord;
  reportOnly: true;
}

/** One scope the round re-analyzed, as persisted. */
export interface ArchCycleRefreshedScopeRecord {
  scope: string;
  source: string;
  /** The artifact timestamp that made the scope due (BEFORE the analyze) — so the record says WHAT
   *  was stale, not just that a spawn happened. */
  artifactTimestamp: string | null;
  commitsSinceArtifact: number | null;
  /** `archguard analyze` exit code for THIS scope; a non-zero code is why `ok:false`. */
  exitCode: number;
  ok: boolean;
}

/** A due scope the round did NOT attempt, with the reason (per-scope interval budget / filter). */
export interface ArchCycleDeferredScopeRecord {
  scope: string;
  reason: string;
}

/** The refresh half of a round, as persisted. `attempted:false` + `skipped` is a complete answer:
 *  every no-analyze path names itself (⛔ never an absent field, which would read as "did not think
 *  about it").
 *
 *  ⛔ `refreshedScopes` is a LIST (gap-arch-cycle-refresh-first-stale-wins-starves-later-scopes): the
 *  old singular `refreshedScope` could only say "one scope was refreshed", which — together with the
 *  fixed-order selection — made the starvation of every later scope invisible on the carrier. */
export interface ArchCycleRefreshRecord {
  attempted: boolean;
  /** Every scope re-analyzed this round, stalest first. Empty ⇒ nothing was spawned. */
  refreshedScopes: ArchCycleRefreshedScopeRecord[];
  /** Due scopes deliberately not attempted this round, each NAMED. "Deferred" and "not needed" must
   *  never share a representation (硬规则 3b). */
  deferredScopes: ArchCycleDeferredScopeRecord[];
  skipped: "no-scope-needs-refresh" | "instrument-absent" | "analyze-failed" | "within-interval" | "disabled" | "partial" | null;
  detail: string | null;
  instrument: string | null;
  instrumentSource: "env" | "path" | "plugin" | null;
  /** Every location probed for the CLI (`instrument-absent` must say what was looked for). */
  searched: string[];
  /** 0 when every attempted analyze succeeded; the first non-zero exit otherwise; null when no
   *  analyze ran. Per-scope codes live in `refreshedScopes`. */
  exitCode: number | null;
  at: string;
  /** `true` when the reading in THIS record was taken AFTER the refresh (so a reader knows whether
   *  the numbers below include the re-analysis or precede it). */
  appliedBeforeReading: boolean;
}

/** topByOutDegree + relationCountByType, as persisted (carrier line and quality-round Fact share ONE
 *  shape — a reader must not have to learn two spellings of the same reading). */
export interface GraphSummaryRecord {
  evaluated: boolean;
  reason: string | null;
  scopeKey: string | null;
  scopeLabel: string | null;
  artifactTimestamp: string | null;
  entityCount: number | null;
  relationCount: number | null;
  relationCountByType: Record<string, number> | null;
  entitiesWithOutgoingRelations: number | null;
  topByOutDegreeLimit: number;
  topByOutDegree: TopOutDegreeEntry[] | null;
  topByOutDegreeTruncated: boolean | null;
}

/** The Fact value contributed to `quality-round.jsonl` (same reading as the carrier line). */
export interface ArchCycleFactValue {
  mode: "arch-cycle-report-round";
  evaluated: boolean;
  status: "complete" | "partial" | "none";
  totalCycleCount: number | null;
  notEvaluatedScopes: string[];
  behindScopes: string[];
  scopes: ArchCycleHistoryRecord["scopes"];
  artifactTimestamp: string | null;
  artifactAgeMs: number | null;
  staleIntervalMs: number;
  stale: boolean | null;
  /** Flattened to the TOP LEVEL of the Fact value as well: the ACs (and any reader grepping
   *  `quality-round.jsonl` for the god-function reading) name these two fields directly. They are the
   *  same objects as `graphSummary`'s — one reading, two spellings of the access path, not two reads. */
  topByOutDegree: TopOutDegreeEntry[] | null;
  relationCountByType: Record<string, number> | null;
  graphSummary: GraphSummaryRecord;
  refresh: ArchCycleRefreshRecord;
  workDir: string;
  historyPath: string;
  historyAppended: boolean;
  reportOnly: true;
}

export interface ArchCycleRoundOptions {
  config?: ArchCycleConfig | null;
  configPresent?: boolean;
  configError?: string | null;
  /** Test / alternate-carrier seam; default `<root>/.quay/arch-cycle-history.jsonl`. */
  historyPath?: string;
  /** Work dir holding the LAST analyze's query artifacts; default `<root>/.archguard`. */
  workDir?: string;
  /** Top-N grain for the god-function reading (default TOP_OUT_DEGREE_LIMIT_DEFAULT). A test seam —
   *  ⛔ not a threshold (硬规则 4): it only bounds how many entries the line carries. */
  graphSummaryLimit?: number;
  /** Deterministic `ts` seam for the carrier line. */
  now?: string;
  /** Refresh stale artifacts before reporting (default TRUE — the production path).
   *  `false` is the read-only seam used to observe what the routine would have reported BEFORE a
   *  refresh (AC3) without spending an analyze; it is stated on the record as `skipped:"disabled"`. */
  refresh?: boolean;
}

/** Append one line to the carrier. Returns the fail-closed `{ok, error}` shape (never throws): a write
 *  failure must surface as `failed`, not as a silently verified round. */
export function appendArchCycleHistory(
  root: string,
  record: ArchCycleHistoryRecord,
  opts: { historyPath?: string } = {},
): { path: string; ok: boolean; error: string | null } {
  const file = opts.historyPath ? path.resolve(opts.historyPath) : path.join(path.resolve(root), ARCH_CYCLE_HISTORY_REL);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(record) + "\n");
    return { path: file, ok: true, error: null };
  } catch (e) {
    return { path: file, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Run ONE arch-cycle round: refresh at most one behind scope, read the directory cycles the last
 *  analyze persisted, and append one line.
 *
 *  ⛔ THE FAILURE VOCABULARY IS DELIBERATELY SPLIT (AC2/AC3 / 硬规则 3b):
 *    • `failed`        — the routine could not do its job: bad config, or the carrier could not be
 *                        written. ⛔ NOT used because cycles were found (report-only, AC2).
 *    • `not-evaluated` — the aggregate could not be read AT ALL (`status:"none"` — no analyze product
 *                        / malformed), or the kill switch is engaged. The line is STILL appended
 *                        (evaluated:false) so the carrier records the inability, not silence.
 *    • `verified`      — a reading was produced AND persisted, `complete` OR `partial`. A PARTIAL
 *                        reading (some scopes unreadable) is still a reading — the scopes that WERE
 *                        read keep their numbers, and the Fact's reason names the ones that were not
 *                        (gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts: two
 *                        permanently graph-less provider packages voided everything for 25 rounds).
 *                        `totalCycleCount` may be > 0; that is the reading's CONTENT, never a red. A
 *                        ratchet over it would be a different task (this one is report-only). */
export function runArchCycleRound(root: string, opts: ArchCycleRoundOptions = {}): Fact<ArchCycleFactValue | null> {
  const name = ARCH_CYCLE_ROUTINE_NAME;
  if (opts.configError) return { name, value: null, state: "failed", reason: opts.configError };
  if (opts.configPresent === false) {
    return { name, value: null, state: "not-evaluated", reason: "not-evaluated:not-declared — loop.arch_cycle_report is absent (the routine is only assembled when the section is declared)" };
  }
  if (opts.config === null) {
    return { name, value: null, state: "failed", reason: cfgCycleBad("present but could not be parsed") };
  }
  if (opts.config && !opts.config.enabled) {
    return { name, value: null, state: "not-evaluated", reason: "not-evaluated:disabled — .quay/config.yml loop.arch_cycle_report.enabled=false（kill switch：零报告、零写入）" };
  }

  const resolvedRoot = path.resolve(root);
  const staleIntervalMs = (opts.config?.intervalMinutes ?? ARCH_CYCLE_INTERVAL_DEFAULT_MIN) * 60_000;
  const ts = opts.now ?? new Date().toISOString();
  const nowMs = Number.isFinite(Date.parse(ts)) ? Date.parse(ts) : Date.now();
  const historyPathForRead = opts.historyPath ? path.resolve(opts.historyPath) : path.join(resolvedRoot, ARCH_CYCLE_HISTORY_REL);

  // ── REFRESH (Plan 步骤 1-4) ─────────────────────────────────────────────────────────────────────
  // The routine reads what the LAST analyze persisted, and until
  // gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts NOTHING ever rewrote it. That
  // task added a refresh — but with a GLOBAL "at most one analyze per interval" budget and a
  // fixed-declaration-order selection, which starved every scope after the first: `plugin/scripts` is
  // touched by nearly every merge, so it was stale (and first) at every interval while
  // `quay-native-src` / `experiments-scripts` were never reached (measured 2026-10-22: the
  // experiments-scripts artifact was 18 days older than its newest source commit, ≈112 intervals).
  //
  // ⇒ THE BUDGET IS PER SCOPE (gap-arch-cycle-refresh-first-stale-wins-starves-later-scopes):
  //   • every due scope (`scopeNeedsRefresh`) is refreshed in the round, stalest first
  //     (`selectRefreshTargets`), so a fixed order can never starve the tail again;
  //   • "at most once per interval" is enforced PER SCOPE against the carrier's own recorded
  //     refresh times (`readLastRefreshAtByScope`) — a driver restart between rounds must not turn
  //     the report into a sweep, but one scope's recent refresh must not block the others either;
  //   • a due scope that could NOT be refreshed (analyze failed / instrument absent / deferred) is
  //     DOWNGRADED to `evaluated:false` + `artifact-behind-sources` — ⛔ never left presenting a stale
  //     `cycleCount` as the current tree (硬规则 3b);
  //   • never on the fan-in / per-task hot path — this is the routine's tick only
  //     (`gap-fan-in-remove-archguard-gate`).
  const readingBeforeRefresh: DirectoryCycleReading = readDirectoryCycleReading(resolvedRoot, opts.workDir);
  let reading: DirectoryCycleReading = readingBeforeRefresh;
  let refresh: ArchCycleRefreshRecord;
  /** Due scopes whose cause of non-refresh is known, for the downgrade below. */
  const downgradeCauses = new Map<string, string>();
  if (opts.refresh === false) {
    refresh = {
      attempted: false, refreshedScopes: [], deferredScopes: [], skipped: "disabled",
      detail: "refresh disabled by the caller (read-only round: reports the artifacts as they are)",
      instrument: null, instrumentSource: null, searched: [], exitCode: null, at: ts, appliedBeforeReading: false,
    };
  } else {
    const due = selectRefreshTargets(readingBeforeRefresh);
    const lastByScope = readLastRefreshAtByScope(historyPathForRead);
    const intervalLabel = `${Math.round(staleIntervalMs / 60_000)}m`;
    const pending: string[] = [];
    const deferred: ArchCycleDeferredScopeRecord[] = [];
    for (const scope of due) {
      const lastRefreshAt = lastByScope[scope.scope];
      const lastMs = lastRefreshAt ? Date.parse(lastRefreshAt) : NaN;
      if (Number.isFinite(lastMs) && nowMs - lastMs < staleIntervalMs) {
        deferred.push({
          scope: scope.scope,
          reason: `within-interval: last refresh at ${lastRefreshAt} is within this routine's ${intervalLabel} interval`,
        });
      } else {
        pending.push(scope.scope);
      }
    }
    if (due.length === 0) {
      refresh = {
        attempted: false, refreshedScopes: [], deferredScopes: [], skipped: "no-scope-needs-refresh",
        detail: "no scope's artifact is behind its sources (or its staleness is not computable)",
        instrument: null, instrumentSource: null, searched: [], exitCode: null, at: ts, appliedBeforeReading: false,
      };
    } else if (pending.length === 0) {
      refresh = {
        attempted: false, refreshedScopes: [], deferredScopes: deferred, skipped: "within-interval",
        detail: `every due scope was refreshed within this routine's ${intervalLabel} interval — per-scope budget: ${deferred
          .map((d) => `${d.scope} (${d.reason})`)
          .join(" ; ")}`,
        instrument: null, instrumentSource: null, searched: [], exitCode: null, at: ts, appliedBeforeReading: false,
      };
      // gap-arch-cycle-within-interval-branch-skips-downgrade: EVERY due scope was deferred by the
      // per-scope interval budget, so NONE of them was refreshed ⇒ the reading this record carries is
      // still the stale one. `skipped:"within-interval"` explains why no analyze ran; it does NOT make
      // the stale `cycleCount` current (硬规则 3b). Record the same cause the `pending.length > 0`
      // branch records, so the honesty gate below applies on THIS path too — otherwise a stale scope
      // is presented as `evaluated:true` + `cycleCount:0`, byte-identical to a healthy reading.
      // No re-read/stillDue filter is needed here: nothing ran, so every deferred scope is still due.
      for (const d of deferred) downgradeCauses.set(d.scope, d.reason);
    } else {
      const r: ArchCycleRefreshResult = refreshBehindScopes(resolvedRoot, opts.workDir, readingBeforeRefresh, {
        now: ts,
        scopes: pending,
      });
      refresh = {
        attempted: r.attempted,
        refreshedScopes: r.refreshedScopes,
        deferredScopes: deferred,
        skipped: r.skipped,
        detail: r.detail,
        instrument: r.instrument,
        instrumentSource: r.instrumentSource,
        searched: r.searched,
        exitCode: r.exitCode,
        at: r.at,
        appliedBeforeReading: r.refreshedScopes.some((s) => s.ok),
      };
      if (refresh.appliedBeforeReading) {
        // Re-read AFTER the analyze: the numbers in this record are the post-refresh ones, and the
        // graph summary must come from the same (now refreshed) artifact tree.
        reading = readDirectoryCycleReading(resolvedRoot, opts.workDir);
      }
      // Why each still-due scope was not made current (the downgrade reason). A scope that a successful
      // analyze brought up to date is NOT in `stillDue`, so it keeps its `evaluated:true` reading.
      const exitByScope = new Map(r.refreshedScopes.map((s) => [s.scope, s] as const));
      const deferredByScope = new Map(deferred.map((d) => [d.scope, d.reason] as const));
      const stillDue = new Set(selectRefreshTargets(reading).map((s) => s.scope));
      for (const scope of due) {
        if (!stillDue.has(scope.scope)) continue;
        const attempted = exitByScope.get(scope.scope);
        const cause = deferredByScope.get(scope.scope)
          ?? (r.skipped === "instrument-absent"
            ? `instrument-absent — archguard CLI not found (probed: ${r.searched.join(" ; ")})`
            : attempted === undefined
              ? "not attempted this round"
              : attempted.ok
                ? "analyze exited 0 but the artifact is still behind the sources"
                : `analyze exited ${attempted.exitCode}`);
        downgradeCauses.set(scope.scope, cause);
      }
    }
  }
  // THE HONESTY GATE: a stale scope that could not be refreshed must not be presented as a current
  // reading. Applied AFTER the re-read so it sees the artifact tree this record will actually report.
  if (downgradeCauses.size > 0) {
    reading = downgradeStaleScopes(reading, downgradeCauses);
  }
  // SAME-BATCH graph reading (gap-quality-round-facts-surface-top-out-degree-god-functions): both
  // readings come from the same persisted `.archguard/query` tree, so this adds a file read, not a
  // second analysis (⛔ zero spawn).
  const graph = readGraphSummaryReading(
    resolvedRoot,
    opts.workDir,
    opts.graphSummaryLimit !== undefined ? { limit: opts.graphSummaryLimit } : {},
  );
  const graphSummary: GraphSummaryRecord = {
    evaluated: graph.evaluated,
    reason: graph.reason,
    scopeKey: graph.scopeKey,
    scopeLabel: graph.scopeLabel,
    artifactTimestamp: graph.artifactTimestamp,
    entityCount: graph.entityCount,
    relationCount: graph.relationCount,
    relationCountByType: graph.relationCountByType,
    entitiesWithOutgoingRelations: graph.entitiesWithOutgoingRelations,
    topByOutDegreeLimit: graph.topByOutDegreeLimit,
    topByOutDegree: graph.topByOutDegree,
    topByOutDegreeTruncated: graph.topByOutDegreeTruncated,
  };
  // FRESHNESS OF THE READING (gap-arch-cycle-report-record-artifact-timestamp): the routine does not
  // analyze on demand; it reports what the LAST analyze persisted (the refresh above may have just
  // rewritten part of it). Recording HOW OLD that artifact is makes "reading the current tree"
  // distinguishable from "re-reading a week-old artifact" (the failure that motivated that task: the
  // same 4 cycles reported for 3 days).
  //   • staleIntervalMs is the routine's declared cadence — "older than one interval" is the point at
  //     which a reader can no longer assume the artifact tracks the tree.
  //   • `stale` is THREE-VALUED: null when the age cannot be computed (no artifact timestamp / an
  //     unparseable one). ⛔ Never false there — "could not tell" must not look like "fresh" (3b).
  const artifactMs = reading.artifactTimestamp ? Date.parse(reading.artifactTimestamp) : NaN;
  const artifactAgeMs = Number.isFinite(artifactMs) ? nowMs - artifactMs : null;
  const stale = artifactAgeMs === null ? null : artifactAgeMs > staleIntervalMs;
  const record: ArchCycleHistoryRecord = {
    ts,
    mode: "arch-cycle-report-round",
    evaluated: reading.evaluated,
    status: reading.status,
    reason: reading.reason,
    totalCycleCount: reading.totalCycleCount,
    notEvaluatedScopes: reading.notEvaluatedScopes,
    behindScopes: reading.behindScopes,
    scopes: reading.scopes,
    artifactTimestamp: reading.artifactTimestamp,
    artifactAgeMs,
    staleIntervalMs,
    stale,
    graphSummary,
    refresh,
    reportOnly: true,
  };
  const appended = appendArchCycleHistory(resolvedRoot, record, opts.historyPath ? { historyPath: opts.historyPath } : {});
  const value: ArchCycleFactValue = {
    mode: "arch-cycle-report-round",
    evaluated: record.evaluated,
    status: record.status,
    totalCycleCount: record.totalCycleCount,
    notEvaluatedScopes: record.notEvaluatedScopes,
    behindScopes: record.behindScopes,
    scopes: record.scopes,
    artifactTimestamp: record.artifactTimestamp,
    artifactAgeMs: record.artifactAgeMs,
    staleIntervalMs: record.staleIntervalMs,
    stale: record.stale,
    topByOutDegree: graphSummary.topByOutDegree,
    relationCountByType: graphSummary.relationCountByType,
    graphSummary,
    refresh,
    workDir: reading.workDir,
    historyPath: appended.path,
    historyAppended: appended.ok,
    reportOnly: true,
  };
  if (!appended.ok) {
    return { name, value, state: "failed", reason: `history carrier not writable at ${appended.path} — ${appended.error}` };
  }
  if (!reading.evaluated) {
    return { name, value, state: "not-evaluated", reason: `not-evaluated:module-graph — ${reading.reason ?? "the module graph could not be read"}` };
  }
  // The graph summary is a SECOND reading of the same artifact tree and carries its own three-valued
  // state. A round where the cycles were readable but topByOutDegree/relationCountByType were not is
  // NOT the same thing as a complete report (硬规则 3b) — it is `not-evaluated:graph-summary`, named.
  if (!graphSummary.evaluated) {
    return {
      name,
      value,
      state: "not-evaluated",
      reason: `not-evaluated:graph-summary — ${graphSummary.reason ?? "topByOutDegree/relationCountByType could not be read"}`,
    };
  }
  // ⛔ AC2: a non-zero cycle count is NOT a failure. The cycles (with their members) are IN the value,
  // so a reader can see them — they just never become the round's verdict.
  // A PARTIAL reading is VERIFIED too (that is this task's whole point: two permanently graph-less
  // scopes must not void the other four) — but its reason NAMES what was not read, so "partial" and
  // "complete" never share a line in `quality-round.jsonl` (硬规则 3b).
  if (reading.status === "partial") {
    return { name, value, state: "verified", reason: `partial — ${reading.reason ?? "some scopes were not evaluated"}` };
  }
  return { name, value, state: "verified", reason: null };
}

/** The `refresh.at` of the last carrier line that ACTUALLY RAN an analyze, or null.
 *
 *  ⚠️ ROUND-LEVEL ONLY. The round's budget is PER SCOPE now — `readLastRefreshAtByScope` is the clock
 *  the round consults. This function is kept because it answers a different, still-useful question
 *  ("when did anything last run?"), and because it tolerates the SAME record shapes (new
 *  `refreshedScopes[]` and the legacy singular `refreshedScope`).
 *  The carrier already records every round, so the guard needs no second state file (a second carrier
 *  would be a second truth that can disagree with the history). Rounds that only REPORTED
 *  (`attempted:false` — disabled / no scope behind / instrument absent) do not reset the clock, so the
 *  first eligible round after those still refreshes. */
export function readLastRefreshAt(historyPath: string): string | null {
  const ats = readRefreshTimesByScope(historyPath);
  return ats.roundAt;
}

/** WHEN EACH SCOPE was last re-analyzed, read from the carrier itself.
 *
 *  THE per-scope budget clock (gap-arch-cycle-refresh-first-stale-wins-starves-later-scopes): the old
 *  global `readLastRefreshAt` let ONE scope's refresh block every other scope for a whole interval —
 *  the starvation mechanism, expressed as a clock. Records are walked newest-first and the FIRST hit
 *  for a scope wins; a malformed line is skipped, never erasing the earlier ones.
 *
 *  Both record shapes are honoured: `refresh.refreshedScopes[]` (current) and `refresh.refreshedScope`
 *  (legacy), so a carrier written before this change still suppresses an immediate re-analysis.
 *  Only rounds with `attempted:true` count — `attempted:false` (disabled / no scope behind / instrument
 *  absent) did not run anything and must not reset any clock. */
export function readLastRefreshAtByScope(historyPath: string): Record<string, string> {
  return readRefreshTimesByScope(historyPath).byScope;
}

/** One backward walk of the carrier, shared by both readers (one parse, one legacy-shape tolerance). */
function readRefreshTimesByScope(historyPath: string): { roundAt: string | null; byScope: Record<string, string> } {
  let text: string;
  try {
    text = fs.readFileSync(historyPath, "utf8");
  } catch {
    return { roundAt: null, byScope: {} };
  }
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  let roundAt: string | null = null;
  const byScope: Record<string, string> = {};
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let rec: any;
    try {
      rec = JSON.parse(lines[i]);
    } catch {
      continue; // a malformed line does not erase the earlier ones — keep walking back
    }
    const at = rec?.refresh?.at;
    if (rec?.refresh?.attempted !== true || typeof at !== "string" || at === "") continue;
    if (roundAt === null) roundAt = at;
    const list = Array.isArray(rec.refresh.refreshedScopes) ? rec.refresh.refreshedScopes : [];
    const labels: unknown[] = list.map((s: any) => (s !== null && typeof s === "object" ? s.scope : undefined));
    // Legacy singular shape: the carrier written before this task could only name ONE scope.
    if (typeof rec.refresh.refreshedScope === "string" && rec.refresh.refreshedScope !== "") {
      labels.push(rec.refresh.refreshedScope);
    }
    for (const label of labels) {
      if (typeof label === "string" && label !== "" && byScope[label] === undefined) byScope[label] = at;
    }
  }
  return { roundAt, byScope };
}

export interface ArchCycleRoutineOptions {
  historyPath?: string;
  workDir?: string;
  graphSummaryLimit?: number;
  now?: string;
}

/** Build the RoutineSpec (scheduler / watchdog / halt are the driver's, not re-implemented here). */
export function buildArchCycleRoutine(
  root: string,
  read: ArchCycleConfigRead,
  opts: ArchCycleRoutineOptions = {},
): RoutineSpec {
  const minutes = read.config?.intervalMinutes ?? ARCH_CYCLE_INTERVAL_MIN_DEFAULT;
  return {
    name: ARCH_CYCLE_ROUTINE_NAME,
    schedule: { kind: "interval", minutes },
    // Same class as arch-coverage-report: a pure read plus one append. Observation keeps running while
    // halted (a halt gates SPAWN / model calls, not readings).
    run: () => [
      runArchCycleRound(root, {
        config: read.config,
        configPresent: read.present,
        configError: read.error,
        ...(opts.historyPath ? { historyPath: opts.historyPath } : {}),
        ...(opts.workDir ? { workDir: opts.workDir } : {}),
        ...(opts.graphSummaryLimit !== undefined ? { graphSummaryLimit: opts.graphSummaryLimit } : {}),
        ...(opts.now ? { now: opts.now } : {}),
      }),
    ],
  };
}

/** Production entry: read `.quay/config.yml` and build the routine. NEVER throws.
 *  `routine` is `null` when NO section is declared — an undeclared workspace keeps the EXACT routine
 *  set it had before (AC144's "exactly four"). A DECLARED section always yields a routine, even
 *  `enabled:false` or malformed, because "not running" must be observable (硬规则 3/3b). */
export function archCycleRoutineFromConfig(
  root: string,
  opts: ArchCycleRoutineOptions = {},
): { routine: RoutineSpec | null; error: string | null; present: boolean; enabled: boolean } {
  const read = readArchCycleConfig(root);
  return {
    routine: read.present ? buildArchCycleRoutine(root, read, opts) : null,
    error: read.error,
    present: read.present,
    enabled: read.config?.enabled === true,
  };
}

/** The assembly line, as ONE string — declared-but-disabled / malformed / running never look the same
 *  in the driver's startup log (硬规则 3b/9). */
export function formatArchCycleAssembly(a: {
  present: boolean;
  error: string | null;
  enabled: boolean;
  intervalMinutes: number;
}): string {
  if (a.error !== null) return `arch-cycle-report 例程已装配（${a.error} — 每轮记 failed、零报告零写入；⛔ 不回退到缺省节奏照跑）`;
  if (!a.enabled) return "arch-cycle-report 例程已装配（enabled:false — 每轮记 not-evaluated:disabled，零报告零写入）";
  return `arch-cycle-report 例程已装配（enabled, interval=${a.intervalMinutes}m，report-only：目录级环读数 append 到 .quay/arch-cycle-history.jsonl；每个 stale scope 每个间隔至多一次 archguard analyze，一轮刷新全部到期的 scope（最陈旧优先）；刷新不成的 stale scope 降级为 evaluated:false + artifact-behind-sources；环非零是该例程的读数，⛔ 不是 failed）`;
}

// ── ADR-ENFORCEMENT 轨道（tasks/gap-adr007-half1-selfcheck-probes-archived-and-gate-never-invoked）─
//
// THE DEFECT this routine closes: a `gates.adr` declaration registers an `adr-<id>` gate
// (packages/quay/src/gate/config/loader.ts → makeAdrGate), but such a gate can only be fetched BY
// NAME — `quay gate <task> --gate adr-007` or MCP `gate_run`. The lifecycle verbs run
// acceptance/dark-axis/dod only, and the mechanical fan-in runs neither ⇒ measured 2026-10-22:
// `"gate":"adr-007"` had **0** lines in `.quay/gate-events.jsonl` in the ~94 days since it was
// wired. A declared gate with no standing caller is a declaration, not an enforcement (ADR-004:
// a check with no liveness reading counts as dark).
//
// ⛔ WHAT THIS ROUTINE IS **NOT**:
//   • not a second gate implementation — it calls the ENGINE (`runGate`), so the GateEvent is the
//     engine's (same append path, same verdict mapping), never a hand-written append;
//   • not a ratchet — a failing ADR is the READING of a report-only routine;
//   • not on the fan-in / scoped-gate hot path. It is a routine of THIS (quality) driver, default
//     interval 1440m.
//
// ⛔ DEFAULT-ON, unlike its arch_cycle_report siblings: their section is opt-in because they report
// a quantity; this one exists to make an ALREADY-DECLARED gate produce events. Requiring a second
// declaration would reproduce the very defect (an enforcement nobody switched on). The section
// `loop.adr_enforcement_report:` can only tune the interval or DISABLE it (observably:
// `not-evaluated:disabled`, zero writes).
export const ADR_ENFORCEMENT_ROUTINE_NAME = "adr-enforcement-report";
export const ADR_ENFORCEMENT_INTERVAL_MIN_DEFAULT = 1440;
export const ADR_ENFORCEMENT_MIN_INTERVAL_MINUTES = 60;

export interface AdrEnforcementConfig {
  enabled: boolean;
  intervalMinutes: number | null;
}
export interface AdrEnforcementConfigRead {
  present: boolean;
  config: AdrEnforcementConfig | null;
  error: string | null;
}

function cfgAdrEnforcementBad(msg: string): string {
  return `loop.adr_enforcement_report ${msg}`;
}

/** Parse the optional section. Absent ⇒ the routine runs with its default cadence. Present ⇒ must
 *  carry a boolean `enabled`; `interval` is `interval:<N>m` with a floor (a below-floor value is
 *  REFUSED, never silently rounded — same discipline as the sibling routines). */
export function parseAdrEnforcementSection(raw: unknown): { config: AdrEnforcementConfig | null; error: string | null } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { config: null, error: cfgAdrEnforcementBad(`must be a mapping (got ${Array.isArray(raw) ? "array" : raw === null ? "null" : typeof raw})`) };
  }
  const rec = raw as Record<string, unknown>;
  if (typeof rec.enabled !== "boolean") {
    return { config: null, error: cfgAdrEnforcementBad(`needs a boolean 'enabled' (got ${rec.enabled === undefined ? "missing" : JSON.stringify(rec.enabled)})`) };
  }
  if (rec.enabled === false) return { config: { enabled: false, intervalMinutes: null }, error: null };
  if (rec.interval === undefined || rec.interval === null) {
    return { config: { enabled: true, intervalMinutes: ADR_ENFORCEMENT_INTERVAL_MIN_DEFAULT }, error: null };
  }
  if (typeof rec.interval !== "string") {
    return { config: null, error: cfgAdrEnforcementBad(`'interval' must be a string of the form interval:<N>m (got ${JSON.stringify(rec.interval)})`) };
  }
  let trigger: { kind: string; minutes?: number };
  try {
    trigger = parseTrigger(rec.interval) as { kind: string; minutes?: number };
  } catch (e) {
    return { config: null, error: cfgAdrEnforcementBad(`invalid 'interval' — ${(e as Error).message}`) };
  }
  if (trigger.kind !== "interval" || typeof trigger.minutes !== "number") {
    return { config: null, error: cfgAdrEnforcementBad(`'interval' must be interval:<N>m (got kind '${trigger.kind}')`) };
  }
  if (trigger.minutes < ADR_ENFORCEMENT_MIN_INTERVAL_MINUTES) {
    return { config: null, error: cfgAdrEnforcementBad(`interval ${trigger.minutes}m is below the ${ADR_ENFORCEMENT_MIN_INTERVAL_MINUTES}m floor — refused, not silently rounded`) };
  }
  return { config: { enabled: true, intervalMinutes: trigger.minutes }, error: null };
}

/** Read `.quay/config.yml` `loop.adr_enforcement_report:`. Absent (incl. no config / no `loop:`)
 *  is NOT an error here — unlike the sibling routines it means "default cadence", see the header. */
export function readAdrEnforcementConfig(workspaceRoot: string): AdrEnforcementConfigRead {
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
  const raw = (loop as Record<string, unknown>).adr_enforcement_report;
  if (raw === undefined || raw === null) return { present: false, config: null, error: null };
  const { config, error } = parseAdrEnforcementSection(raw);
  return { present: true, config, error };
}

/** One ADR's gate execution, as it is recorded in the round Fact (the GateEvent itself is the
 *  engine's; this is the reader-facing summary of it). */
export interface AdrEnforcementGateRecord {
  adr: string;
  gate: string;
  ok: boolean;
  verdict: string;
  /** The selfcheck's OWN exit code when the engine's reason carries it (`acceptance failed (exit N)`);
   *  null when the gate did not reach an acceptance command (unknown gate / not accepted / spawn). */
  exitCode: number | null;
  reason: string;
}

export interface AdrEnforcementFactValue {
  mode: "adr-enforcement-report-round";
  declared: string[];
  skipped: Array<{ adr: string; why: string }>;
  gates: AdrEnforcementGateRecord[];
  reportOnly: true;
}

/** The selfcheck's documented three-state contract (its header + ADR-007's enforcement comment):
 *  0 = every fixture PASS · 1 = ≥1 FAIL · 2 = no FAIL but ≥1 NOT-EVALUATED.
 *  ⛔ exit 2 is NOT a red: it says "an axis could not be judged". The engine's binary ok/fail cannot
 *  express that, so the ROUTINE records it — and the GateEvent's reason still carries the NOT-
 *  EVALUATED text through `runAcceptance`'s failure excerpt. */
export const ADR_SELFCHECK_NOT_EVALUATED_EXIT = 2;

/** `acceptance failed (exit N…)` → N. The prefix is produced by the ONE acceptance runner; a gate
 *  that never reached it yields null (⛔ never 0 — "no reading" is not "passed"). */
export function adrEnforcementExitCode(reason: string): number | null {
  const m = /acceptance failed \(exit (\d+)/.exec(String(reason ?? ""));
  return m ? Number(m[1]) : null;
}

export interface AdrEnforcementRoundOptions {
  config?: AdrEnforcementConfig | null;
  configPresent?: boolean;
  configError?: string | null;
  /** Test seam: the engine + stores are injected so the round can be exercised against a temp
   *  workspace without importing packages/quay from the plugin test (production leaves this unset
   *  and the kernel modules are imported dynamically, the same way worker-fan-in.ts does). */
  kernel?: {
    readGatesConfig: (root: string) => { adr: string[] };
    createAdrStore: (dir: string) => { get: (id: string) => { id: string; status?: string; enforcement?: unknown } | null };
    runGate: (args: Record<string, unknown>) => Promise<{ ok: boolean; reason: string; event: { verdict: string } }>;
  };
  logPath?: string;
}

/** Load the kernel modules the round needs. Kept in ONE place so the shipped-bundle aliasing rule
 *  (build-plugin-dist.mjs `coreSrcAliasPlugin` rewrites+inlines these literal specifiers — ⛔ never a
 *  computed/pathToFileURL specifier, see worker-fan-in.ts's note) is applied once. */
async function loadAdrEnforcementKernel(): Promise<NonNullable<AdrEnforcementRoundOptions["kernel"]>> {
  const registry = await import("../../packages/quay/src/gate/registry.ts") as {
    readGatesConfig: (root: string) => { adr: string[] };
  };
  const engine = await import("../../packages/quay/src/gate/engine.ts") as {
    runGate: (args: Record<string, unknown>) => Promise<{ ok: boolean; reason: string; event: { verdict: string } }>;
  };
  const adrStore = await import("../../packages/quay/src/core/adr-store.ts") as {
    createAdrStore: (dir: string) => { get: (id: string) => { id: string; status?: string; enforcement?: unknown } | null };
  };
  return {
    readGatesConfig: registry.readGatesConfig,
    createAdrStore: adrStore.createAdrStore,
    runGate: engine.runGate,
  };
}

/** Run ONE adr-enforcement round: every declared, accepted ADR that carries an `enforcement:`
 *  command is executed through the gate ENGINE once. */
export async function runAdrEnforcementRound(
  root: string,
  opts: AdrEnforcementRoundOptions = {},
): Promise<Fact<AdrEnforcementFactValue | null>> {
  const name = ADR_ENFORCEMENT_ROUTINE_NAME;
  if (opts.configError) return { name, value: null, state: "failed", reason: opts.configError };
  const config = opts.config && opts.config.enabled === false
    ? opts.config
    : opts.config ?? { enabled: true, intervalMinutes: ADR_ENFORCEMENT_INTERVAL_MIN_DEFAULT };
  if (config.enabled === false) {
    return {
      name,
      value: null,
      state: "not-evaluated",
      reason: "not-evaluated:disabled — .quay/config.yml loop.adr_enforcement_report.enabled=false（kill switch：零 gate 调用、零写入）",
    };
  }

  const resolvedRoot = path.resolve(root);
  let kernel: NonNullable<AdrEnforcementRoundOptions["kernel"]>;
  try {
    kernel = opts.kernel ?? await loadAdrEnforcementKernel();
  } catch (e) {
    // A workspace without the kernel layout cannot run the gate engine at all: that is a FAILED
    // routine (it could not do its job), never a silent "nothing to report".
    return { name, value: null, state: "failed", reason: `gate engine could not be loaded — ${(e as Error).message}` };
  }

  const declared = [...new Set((kernel.readGatesConfig(resolvedRoot)?.adr ?? []).map((a) => String(a).trim()).filter(Boolean))];
  const store = kernel.createAdrStore(path.join(resolvedRoot, "adr"));
  const logPath = opts.logPath ?? path.join(resolvedRoot, ".quay", "gate-events.jsonl");
  const skipped: Array<{ adr: string; why: string }> = [];
  const gates: AdrEnforcementGateRecord[] = [];

  for (const adrId of declared) {
    const adr = store.get(adrId);
    if (!adr) {
      skipped.push({ adr: adrId, why: "no such ADR file under adr/" });
      continue;
    }
    if (adr.status !== "accepted") {
      skipped.push({ adr: adrId, why: `status is ${JSON.stringify(adr.status ?? null)} — not accepted` });
      continue;
    }
    if (typeof adr.enforcement !== "string" || adr.enforcement.trim() === "") {
      skipped.push({ adr: adrId, why: "accepted but carries no `enforcement:` command" });
      continue;
    }
    const gateName = adrId.toLowerCase();
    const client = {
      // The adr gate ignores the task (it is a contract check, not a per-task check). The synthetic
      // id keeps the GateEvent attributable to the ROUTINE rather than to a task that was not judged.
      taskGet: async () => ({ id: `adr:${adrId}`, title: adrId, status: "ready", labels: [], parent: null, children: [], body: "" }),
      taskCheck: async () => ({ ok: true, reason: "adr gate does not use taskCheck" }),
    };
    try {
      const r = await kernel.runGate({
        client,
        id: `adr:${adrId}`,
        gate: gateName,
        logPath,
        actor: ADR_ENFORCEMENT_ROUTINE_NAME,
        workspaceRoot: resolvedRoot,
      });
      gates.push({ adr: adrId, gate: gateName, ok: r.ok, verdict: r.event?.verdict ?? (r.ok ? "pass" : "fail"), exitCode: adrEnforcementExitCode(r.reason), reason: r.reason });
    } catch (e) {
      gates.push({ adr: adrId, gate: gateName, ok: false, verdict: "fail", exitCode: null, reason: `gate engine threw — ${(e as Error).message}` });
    }
  }

  const value: AdrEnforcementFactValue = { mode: "adr-enforcement-report-round", declared, skipped, gates, reportOnly: true };
  if (gates.length === 0) {
    return {
      name,
      value,
      state: "not-evaluated",
      reason: `not-evaluated:no-enforcing-adr — ${declared.length} ADR(s) declared in gates.adr, 0 accepted with an enforcement command` +
        (skipped.length > 0 ? ` (${skipped.map((s) => `${s.adr}: ${s.why}`).join("; ")})` : ""),
    };
  }
  const notEvaluated = gates.filter((g) => !g.ok && g.exitCode === ADR_SELFCHECK_NOT_EVALUATED_EXIT);
  if (notEvaluated.length > 0) {
    return {
      name,
      value,
      state: "not-evaluated",
      reason: `not-evaluated:selfcheck-exit-${ADR_SELFCHECK_NOT_EVALUATED_EXIT} — ${notEvaluated.map((g) => `${g.adr} (an axis could not be judged; see the GateEvent's NOT-EVALUATED output)`).join(", ")}`,
    };
  }
  const failed = gates.filter((g) => !g.ok);
  if (failed.length > 0) {
    return { name, value, state: "failed", reason: `enforcement failed — ${failed.map((g) => `${g.adr}: ${g.reason}`).join(" | ")}` };
  }
  return { name, value, state: "verified", reason: null };
}

/** Build the RoutineSpec (scheduler / watchdog / halt are the driver's, not re-implemented here). */
export function buildAdrEnforcementRoutine(
  root: string,
  read: AdrEnforcementConfigRead,
  opts: AdrEnforcementRoundOptions = {},
): RoutineSpec {
  const minutes = read.config?.intervalMinutes ?? ADR_ENFORCEMENT_INTERVAL_MIN_DEFAULT;
  return {
    name: ADR_ENFORCEMENT_ROUTINE_NAME,
    schedule: { kind: "interval", minutes },
    // A pure read + N gate executions that append GateEvents. Observation keeps running while
    // halted (a halt gates SPAWN / model calls, not readings).
    run: async () => [
      await runAdrEnforcementRound(root, {
        config: read.config,
        configPresent: read.present,
        configError: read.error,
        ...(opts.logPath ? { logPath: opts.logPath } : {}),
        ...(opts.kernel ? { kernel: opts.kernel } : {}),
      }),
    ],
  };
}

/** Production entry: read `.quay/config.yml` and build the routine. NEVER throws. Unlike its
 *  siblings this routine is assembled even when the section is ABSENT (default cadence) — see the
 *  header for why "an enforcement nobody switched on" is exactly the defect it closes. */
export function adrEnforcementRoutineFromConfig(
  root: string,
  opts: AdrEnforcementRoundOptions = {},
): { routine: RoutineSpec; error: string | null; present: boolean; enabled: boolean } {
  const read = readAdrEnforcementConfig(root);
  return {
    routine: buildAdrEnforcementRoutine(root, read, opts),
    error: read.error,
    present: read.present,
    enabled: read.config?.enabled !== false,
  };
}

/** The assembly line, as ONE string (硬规则 3b/9: absent / disabled / malformed / running must not
 *  look the same in the startup log). */
export function formatAdrEnforcementAssembly(a: {
  present: boolean;
  error: string | null;
  enabled: boolean;
  intervalMinutes: number;
}): string {
  if (a.error !== null) return `adr-enforcement-report 例程已装配（${a.error} — 每轮记 failed、零 gate 调用）`;
  if (!a.enabled) return "adr-enforcement-report 例程已装配（enabled:false — 每轮记 not-evaluated:disabled，零 gate 调用）";
  const declared = a.present ? "声明的节奏" : "未声明 loop.adr_enforcement_report ⇒ 缺省节奏（default-on：本轨存在的理由就是让已声明的门产生事件）";
  return `adr-enforcement-report 例程已装配（enabled, interval=${a.intervalMinutes}m，${declared}；report-only：每个 accepted + 带 enforcement 的 gates.adr ADR 经门引擎 runGate 跑一次，事件 actor=${ADR_ENFORCEMENT_ROUTINE_NAME}）`;
}

// ── design-evolution-readings 的 config 入口（`loop.design_evolution_readings:`）────────────────
// 与 arch_cycle_report 同族的第九条声明式例程，语义逐条对齐（⛔ 不另造机制）：
//   • 段缺席          ⇒ 不装配（off by default，宿主例程表逐条不变——AC144 的「恰好四条」判据仍成立）；
//   • 段 enabled:false ⇒ 仍装配、每轮记 `not-evaluated:disabled` 且**零写入**（kill switch 必须可观测）；
//   • 段写坏          ⇒ 仍装配、记 `failed` 且零写入（硬规则 3b：读不懂 ≠ 合格）。
// 与其他各条的唯一差异是**读什么**：本轨读两条**元机制**读数（RM1 分解后增量落回中心文件的占比、
// RM2 热点文件并发争用），且是 **report-only**：占比高/争用多是该例程的**内容**，⛔ 不是 failed
// （⛔ 不 ratchet，也⛔ 不设「这是不是搬家」的数值判据——硬规则 4 推论；交给人读那一行
// `maxCentralChangeCommit`）。解析与读数实现都在 design-evolution-readings.ts（直接入口复用同一份）。

/** The Fact value contributed to `quality-round.jsonl` — the SAME record the carrier line holds
 *  (one reading, one shape; a reader must not learn two spellings of the same number). */
export interface DesignEvolutionFactValue {
  mode: typeof DESIGN_EVOLUTION_MODE;
  evaluated: boolean;
  reason: string | null;
  head: string | null;
  rm1: DesignEvolutionReadingsRecord["rm1"];
  rm2: DesignEvolutionReadingsRecord["rm2"];
  carrierRecords: number | null;
  /** ADR-008 phase-declaration staleness (gap-adr008-phase-declaration-staleness-reading) — attached
   *  information, embedded verbatim from the carrier's owner. ⛔ Never folded into the Fact's state. */
  phaseStaleness: DesignEvolutionReadingsRecord["phaseStaleness"];
  /** THIS round's judgment against the previous record (gap-design-evolution-readings-emit-findings).
   *  ⛔ It is NOT the round's state: a `regression` verdict is the reading's CONTENT (report-only
   *  stands), and a `not-evaluated` verdict is carried in the value rather than turning the Fact red —
   *  the Fact's own `not-evaluated` still means 「读数没取到」, which is a different fact. */
  evolution: DesignEvolutionVerdict;
  /** Where findings land (the existing routine-findings carrier) and how many this round appended.
   *  `findingsAppended: 0` with `findingsCount: 0` is 「没有回归」, ⛔ never 「写了但没成」 — the latter
   *  is `findingsOk:false` (硬规则 3). */
  findingsPath: string;
  findingsCount: number;
  findingsAppended: number;
  findingsOk: boolean;
  historyPath: string;
  historyAppended: boolean;
  reportOnly: true;
}

export interface DesignEvolutionRoundOptions {
  /** Parsed section; `null` + `configPresent:true` ⇒ present-but-unparseable (failed). */
  config?: DesignEvolutionSectionConfig | null;
  configPresent?: boolean;
  configError?: string | null;
  /** Test / alternate-carrier seam; default `<root>/.quay/design-evolution-history.jsonl`. */
  historyPath?: string;
  /** Test / alternate-carrier seam for the FINDINGS carrier; default
   *  `<root>/.quay/routine-findings.jsonl` (the existing routine filing track). */
  findingsPath?: string;
  /** Test / alternate-carrier seam for the worker-outcome ledger. */
  carrierPath?: string;
  /** Override `design_evolution_readings.dark_streak_rounds` (the config is the production source). */
  darkStreakRounds?: number;
  /** Pin the window's right end for EVERY subsystem (tests; a one-off historical reading). */
  head?: string;
  topN?: number;
  predicates?: ContentionPredicates;
  /** Deterministic `ts` seam for the carrier line. */
  now?: string;
}

/** Run ONE design-evolution round: take both readings and append one line to the carrier.
 *
 *  ⛔ THE FAILURE VOCABULARY IS THE FAMILY'S (AC1 / 硬规则 3b):
 *    • `failed`        — the routine could not do its job: bad config, or the carrier could not be
 *                        written. ⛔ NOT used because a share is high or a file is contended.
 *    • `not-evaluated` — a reading could not be taken (unresolvable baseline, a declared central path
 *                        absent at one end, a non-positive denominator, a missing worker-outcome
 *                        carrier, a self-check failure), or the kill switch is engaged. The line is
 *                        STILL appended (evaluated:false) so the carrier records the inability.
 *    • `verified`      — a reading was produced AND persisted. Its NUMBERS are content, never reds. */
export function runDesignEvolutionRound(root: string, opts: DesignEvolutionRoundOptions = {}): Fact<DesignEvolutionFactValue | null> {
  const name = DESIGN_EVOLUTION_ROUTINE_NAME;
  if (opts.configError) return { name, value: null, state: "failed", reason: opts.configError };
  if (opts.configPresent === false) {
    return { name, value: null, state: "not-evaluated", reason: "not-evaluated:not-declared — loop.design_evolution_readings is absent (the routine is only assembled when the section is declared)" };
  }
  if (opts.config === null || opts.config === undefined) {
    return { name, value: null, state: "failed", reason: deCfgBad("present but could not be parsed") };
  }
  if (!opts.config.enabled) {
    // AC1: the kill switch is OBSERVABLE and WRITES NOTHING (not a single carrier line, not a Fact
    // with a reading value). `not-evaluated:disabled` is a distinct value, ⛔ not "failed".
    return { name, value: null, state: "not-evaluated", reason: "not-evaluated:disabled — .quay/config.yml loop.design_evolution_readings.enabled=false（kill switch：零读数、零写入）" };
  }

  const resolvedRoot = path.resolve(root);
  // ONE orchestration, shared with the DIRECT entry (`takeEvolutionRound`): read the previous record
  // → take the readings → judge → persist the record (verdict embedded) → append the findings the
  // judgment justifies. ⛔ This file does not re-implement any of it, and ⛔ it never files a task —
  // the finding lands in the EXISTING carrier and `routine-file-gate` / `quay:run-routines` decide.
  const taken = takeEvolutionRound(resolvedRoot, {
    ...(opts.now ? { ts: opts.now } : {}),
    subsystems: opts.config.subsystems,
    topN: opts.topN ?? opts.config.topN,
    darkStreakRounds: opts.darkStreakRounds ?? opts.config.darkStreakRounds,
    ...(opts.head ? { head: opts.head } : {}),
    ...(opts.historyPath ? { historyPath: opts.historyPath } : {}),
    ...(opts.findingsPath ? { findingsPath: opts.findingsPath } : {}),
    ...(opts.carrierPath ? { carrierPath: opts.carrierPath } : {}),
    ...(opts.predicates ? { predicates: opts.predicates } : {}),
  });
  const record = taken.record;
  const value: DesignEvolutionFactValue = {
    mode: record.mode,
    evaluated: record.evaluated,
    reason: record.reason,
    head: record.head,
    rm1: record.rm1,
    rm2: record.rm2,
    carrierRecords: record.carrierRecords,
    phaseStaleness: record.phaseStaleness,
    evolution: taken.verdict,
    findingsPath: taken.findingsCarrier.path,
    findingsCount: taken.findings.length,
    findingsAppended: taken.findingsCarrier.appended,
    findingsOk: taken.findingsCarrier.ok,
    historyPath: taken.history.path,
    historyAppended: taken.history.appended,
    reportOnly: true,
  };
  if (!taken.history.appended) {
    return { name, value, state: "failed", reason: `history carrier not writable at ${taken.history.path} — ${taken.history.error}` };
  }
  // 硬规则 3b: 「读数落了、finding 没落」 must NOT look like 「没有回归」. The round FAILED to do its
  // job even though the reading itself was taken.
  if (!taken.findingsCarrier.ok) {
    return {
      name, value, state: "failed",
      reason: `findings carrier not writable at ${taken.findingsCarrier.path} — ${taken.findingsCarrier.error} (the reading landed; ${taken.findings.length} finding(s) did not)`,
    };
  }
  if (!record.evaluated) {
    return { name, value, state: "not-evaluated", reason: `not-evaluated:readings — ${record.reason ?? "the readings could not be taken"}` };
  }
  // ⛔ A non-zero share, a non-zero contention count, or a `regression` VERDICT is NOT a failure
  // (report-only). The numbers and the verdict are IN the value, so a reader can see them — they
  // just never become the round's verdict.
  return { name, value, state: "verified", reason: null };
}

export interface DesignEvolutionRoutineOptions {
  historyPath?: string;
  /** Alternate findings carrier (tests); default `<root>/.quay/routine-findings.jsonl`. */
  findingsPath?: string;
  carrierPath?: string;
  head?: string;
  topN?: number;
  now?: string;
}

/** Build the RoutineSpec (scheduler / watchdog / halt are the driver's, not re-implemented here). */
export function buildDesignEvolutionRoutine(
  root: string,
  read: DesignEvolutionSectionRead,
  opts: DesignEvolutionRoutineOptions = {},
): RoutineSpec {
  const minutes = read.config?.intervalMinutes ?? DESIGN_EVOLUTION_INTERVAL_MIN_DEFAULT;
  return {
    name: DESIGN_EVOLUTION_ROUTINE_NAME,
    schedule: { kind: "interval", minutes },
    // Same class as arch-coverage-report / arch-cycle-report: pure git + carrier reads plus one
    // append. Observation keeps running while halted (a halt gates SPAWN / model calls, and this
    // routine has neither).
    run: () => [
      runDesignEvolutionRound(root, {
        config: read.config,
        configPresent: read.present,
        configError: read.error,
        ...(opts.historyPath ? { historyPath: opts.historyPath } : {}),
        ...(opts.findingsPath ? { findingsPath: opts.findingsPath } : {}),
        ...(opts.carrierPath ? { carrierPath: opts.carrierPath } : {}),
        ...(opts.head ? { head: opts.head } : {}),
        ...(opts.topN !== undefined ? { topN: opts.topN } : {}),
        ...(opts.now ? { now: opts.now } : {}),
      }),
    ],
  };
}

/** Production entry: read `.quay/config.yml` and build the routine. NEVER throws.
 *  `routine` is `null` when NO section is declared — an undeclared workspace keeps the EXACT routine
 *  set it had before (AC144's "exactly four"). A DECLARED section always yields a routine, even
 *  `enabled:false` or malformed, because "not running" must be observable (硬规则 3/3b). */
export function designEvolutionRoutineFromConfig(
  root: string,
  opts: DesignEvolutionRoutineOptions = {},
): { routine: RoutineSpec | null; error: string | null; present: boolean; enabled: boolean } {
  const read = readDesignEvolutionConfig(root);
  return {
    routine: read.present ? buildDesignEvolutionRoutine(root, read, opts) : null,
    error: read.error,
    present: read.present,
    enabled: read.config?.enabled === true,
  };
}

/** The assembly line, as ONE string — declared-but-disabled / malformed / running never look the
 *  same in the driver's startup log (硬规则 3b/9). */
export function formatDesignEvolutionAssembly(a: {
  present: boolean;
  error: string | null;
  enabled: boolean;
  intervalMinutes: number;
}): string {
  if (a.error !== null) return `design-evolution-readings 例程已装配（${a.error} — 每轮记 failed、零读数零写入；⛔ 不回退到缺省节奏照跑）`;
  if (!a.enabled) return "design-evolution-readings 例程已装配（enabled:false — 每轮记 not-evaluated:disabled，零读数零写入）";
  // 装配行点名`两`个载体：读数去哪、finding 去哪。只写前者会让「这条例程现在会立案」在生产日志里
  // 不可见（硬规则 9：守与不守在记录上必须可分）。
  return `design-evolution-readings 例程已装配（enabled, interval=${a.intervalMinutes}m，report-only 读数：RM1/RM2 append 到 ${DESIGN_EVOLUTION_HISTORY_REL}，本轮判定（stable/regression/no-prior/not-evaluated）随记录落盘；regression 时把 finding append 到 ${EVOLUTION_FINDINGS_REL}，由既有 routine-file-gate 决定是否立案；占比高/争用多是读数，⛔ 不是 failed）`;
}


// ── instrument-decay 的 config 入口（`.quay/config.yml` `loop.instrument_decay:`）──────────────
// 与 arch_cycle_report 同族的第十条声明式例程，语义逐条对齐（⛔ 不另造机制）：
//   • 段缺席          ⇒ 不装配（off by default，宿主例程表逐条不变——AC144 的「恰好四条」判据仍成立）；
//   • 段 enabled:false ⇒ 仍装配、每轮记 `not-evaluated:disabled` 且**零读数零写入**（kill switch 必须可观测）；
//   • 段写坏          ⇒ 仍装配、记 `failed` 且零读数零写入（硬规则 3b：读不懂 ≠ 合格）。
// 与其他各条的唯一差异是**它回答什么**：「我们用来观测系统的仪器本身还在不在读数」——A/B（写手停写）、
// C（载体在写但全是 evaluated:false）、D（已评估但产物早于覆盖源码）、uncovered（没被检查的载体）。
// **report-only**：腐烂是读数内容，⛔ 不 ratchet；但它是 `state: "instrument-dark"`，⛔ 不与 verified 同形。
export interface InstrumentDecayConfig {
  enabled: boolean;
  /** `enabled:false` ⇒ null（不参与调度）。enabled 段缺省为 INSTRUMENT_DECAY_INTERVAL_MIN_DEFAULT。 */
  intervalMinutes: number | null;
}

export interface InstrumentDecayConfigRead {
  present: boolean;
  config: InstrumentDecayConfig | null;
  error: string | null;
}

const cfgInstrumentDecayBad = (msg: string) => `loop.instrument_decay ${msg}`;

/** 纯解析一个 `loop.instrument_decay` 值（与 parseArchCycleSection 逐条同形）。 */
export function parseInstrumentDecaySection(raw: unknown): { config: InstrumentDecayConfig | null; error: string | null } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { config: null, error: cfgInstrumentDecayBad(`must be a mapping (got ${Array.isArray(raw) ? "array" : raw === null ? "null" : typeof raw})`) };
  }
  const rec = raw as Record<string, unknown>;
  if (typeof rec.enabled !== "boolean") {
    return { config: null, error: cfgInstrumentDecayBad(`needs a boolean 'enabled' (got ${rec.enabled === undefined ? "missing" : JSON.stringify(rec.enabled)})`) };
  }
  if (rec.enabled === false) return { config: { enabled: false, intervalMinutes: null }, error: null };
  if (rec.interval === undefined || rec.interval === null) {
    return { config: { enabled: true, intervalMinutes: INSTRUMENT_DECAY_INTERVAL_MIN_DEFAULT }, error: null };
  }
  if (typeof rec.interval !== "string") {
    return { config: null, error: cfgInstrumentDecayBad(`'interval' must be a string of the form interval:<N>m (got ${JSON.stringify(rec.interval)})`) };
  }
  let trigger: { kind: string; minutes?: number };
  try {
    trigger = parseTrigger(rec.interval) as { kind: string; minutes?: number };
  } catch (e) {
    return { config: null, error: cfgInstrumentDecayBad(`invalid 'interval' — ${(e as Error).message}`) };
  }
  if (trigger.kind !== "interval" || typeof trigger.minutes !== "number") {
    return { config: null, error: cfgInstrumentDecayBad(`'interval' must be interval:<N>m (got kind '${trigger.kind}')`) };
  }
  if (trigger.minutes < INSTRUMENT_DECAY_MIN_INTERVAL_MINUTES) {
    return { config: null, error: cfgInstrumentDecayBad(`interval ${trigger.minutes}m is below the ${INSTRUMENT_DECAY_MIN_INTERVAL_MINUTES}m floor — refused, not silently rounded`) };
  }
  return { config: { enabled: true, intervalMinutes: trigger.minutes }, error: null };
}

/** 读 `.quay/config.yml` `loop.instrument_decay:`（同族读法：无 config / 无 `loop:` / 无段 ⇒
 *  `present:false`；YAML 或段写坏 ⇒ `error` 置位，fail-closed）。 */
export function readInstrumentDecayConfig(workspaceRoot: string): InstrumentDecayConfigRead {
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
  const raw = (loop as Record<string, unknown>).instrument_decay;
  if (raw === undefined || raw === null) return { present: false, config: null, error: null };
  const { config, error } = parseInstrumentDecaySection(raw);
  return { present: true, config, error };
}

/** 一个（载体，形态）的立案结局。`already-filed` 的证据来自**上一轮的 Fact**（下面是 readPrior…）——
 *  ⛔ 不另造一份去重账本：Fact 已经是每轮落盘的载体，第二份台账只会与它漂移。 */
export interface InstrumentDecayFiling {
  /** `${file}|${kind}` —— 去重键（Plan：「对每个（载体，形态）」）。 */
  key: string;
  file: string;
  kind: InstrumentDecayFinding["kind"];
  /** 该 pair 下受影响的分组/作用域名（prompt 里逐条列出——立案是 per pair，证据是 per group）。 */
  groups: string[];
  filing: "filed" | "already-filed" | "deferred";
  exitCode: number | null;
  error: string | null;
  /** agent 输出的去噪摘要（报告已有 gap 时 agent 会在这里点名 task id）。 */
  summary: string | null;
}

export interface InstrumentDecayFactValue {
  mode: "instrument-decay-round";
  evaluated: boolean;
  decayedCount: number;
  healthyCount: number;
  uncoveredCount: number;
  uncovered: InstrumentDecayOutcome["uncovered"];
  carriers: Array<{
    file: string;
    evaluated: boolean;
    contentDark: InstrumentDecayOutcome["carriers"][number]["contentDark"];
    staleEvaluated: InstrumentDecayOutcome["carriers"][number]["staleEvaluated"];
    decayed: InstrumentDecayFinding[];
  }>;
  filings: InstrumentDecayFiling[];
  reportOnly: true;
}

/** gap-filing prompt：逐 (载体, 形态) 交给短命 agent，经 quay-file-task 立案（同 packaging 的措辞，
 *  mechanism-based dedup）。 */
export function buildInstrumentDecayGapWorkerPrompt(
  root: string,
  pairs: Array<{ file: string; kind: InstrumentDecayFinding["kind"]; findings: InstrumentDecayFinding[] }>,
): string {
  const lines: string[] = [
    "You are a gap-filing agent in the quay repo. A standing instrument-decay check found carriers whose READINGS are dark — the carriers are still being written, so the older checks (write rate stopped) cannot see them.",
    `Repo root: ${root}.`,
    "The detector is plugin/scripts/instrument-decay-check.ts. Its four shapes:",
    "  • never-wrote / rate-stopped — a writer group stopped writing (the original P5 shapes).",
    "  • content-dark — the carrier keeps writing, but every record it holds is evaluated:false.",
    "  • stale-evaluated — the carrier says evaluated:true, but the artifact it read predates the newest commit touching the source paths it covers.",
    "Findings (one gap task PER (carrier, shape) below):",
  ];
  pairs.forEach((p, i) => {
    lines.push(`  ${i + 1}. carrier=${p.file} shape=${p.kind}`);
    for (const f of p.findings) {
      lines.push(`       - ${f.group}: ${f.kind} (count=${f.count})${f.detail ? ` — ${f.detail}` : ""}`);
    }
  });
  lines.push(
    "The quay-file-task skill performs MECHANISM-BASED dedup. Apply the TWO rules below — an OPEN claim and a DONE claim are NOT the same case — and report every existing task id you matched:",
    "  • OPEN claim (existing task in todo/ready/needs-human) — it claims the same rot ⇒ a real duplicate: do NOT file; report that task id instead.",
    "  • DONE/superseded claim — a done task claiming the same rot is NOT proof the rot is gone (a task can be closed while the carrier still reads dark; done ≠ absent, hard rule 5b). Verify against the CURRENT CARRIER before deciding: re-read the carrier named above (and the writer path) at the current HEAD. STILL dark ⇒ FILE the task and carry the old task id in the body as traceability (`prior-claim: <id>`) — that is not a duplicate. NO LONGER dark ⇒ do NOT file; report 'the old task already fixed it' together with the evidence you checked.",
    "A finding that is rare-BY-DESIGN (a step only reachable on an exceptional path) is still worth a task ONLY if the writer path is gone or the trigger has not occurred in far longer than its own cadence; otherwise report the adjudication instead of filing. Name which of the two you concluded.",
  );
  return lines.join("\n");
}

/** gap-filing agent argv = launchArgv("fix-worker", <prompt>)（测试缝：前缀覆盖时把 prompt 追加）。 */
export function buildInstrumentDecayGapWorkerArgv(
  root: string,
  pairs: Array<{ file: string; kind: InstrumentDecayFinding["kind"]; findings: InstrumentDecayFinding[] }>,
  cmd?: string | null,
): string[] {
  const prompt = buildInstrumentDecayGapWorkerPrompt(root, pairs);
  if (cmd != null) {
    const prefix = splitArgs(cmd);
    if (prefix.length === 0) return launchArgv("fix-worker", prompt, root);
    return [...prefix, prompt];
  }
  return launchArgv("fix-worker", prompt, root);
}

/** 上一轮已立案的 pair 键——从 round 载体（`.quay/quality-round.jsonl`）的尾部读，⛔ 不新造台账。
 *
 *  WHY the tail only: the round log is an append-only heartbeat carrier (63k+ lines in production).
 *  The previous round's Fact is what we need; scanning the whole file every 360m would grow without
 *  bound. 500 lines is far more than one round's worth (a round is ONE line). */
export function readPriorInstrumentDecayFilings(root: string, roundLogPath?: string): Set<string> {
  const file = roundLogPath ?? path.join(root, ROUND_LOG_REL);
  const out = new Set<string>();
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return out;
  }
  const lines = text.split("\n").filter((l) => l.trim() !== "").slice(-500);
  for (let i = lines.length - 1; i >= 0; i--) {
    let rec: any;
    try { rec = JSON.parse(lines[i]); } catch { continue; }
    const facts = Array.isArray(rec?.facts) ? rec.facts : [];
    for (const f of facts) {
      if (!f || f.name !== INSTRUMENT_DECAY_ROUTINE_NAME) continue;
      const filings = Array.isArray(f?.value?.filings) ? f.value.filings : [];
      for (const fl of filings) {
        if (fl && fl.filing === "filed" && typeof fl.key === "string") out.add(fl.key);
      }
    }
  }
  return out;
}

export interface InstrumentDecayRoundOptions {
  config?: InstrumentDecayConfig | null;
  configPresent?: boolean;
  configError?: string | null;
  /** 形状 B 的伴生陈旧间隔（秒）；缺省 DEFAULT_STALE_SECONDS。 */
  staleSeconds?: number;
  /** Test seam: manifest override（⚠️ 生产永不传——描述符的登记表就是 MANIFEST）。 */
  manifest?: InstrumentDecayCarrierSpec[];
  /** Test seam: gap-filing agent 命令前缀。缺省 null ⇒ 生产 launchArgv。 */
  gapWorkerCmd?: string | null;
  gapWorkerTimeoutMs?: number;
  resourceGateArgv?: string[] | null;
  halted?: boolean;
  /** Test seam: 已立案 pair 键（缺省从 round 载体尾部读）。 */
  priorFilings?: Iterable<string>;
  roundLogPath?: string;
  /** 确定性 ts seam（当前只用于 reason 里的时间证据，不写载体）。 */
  now?: string;
}

/** 跑一轮 instrument-decay 读数 + 立案。NEVER throws。
 *
 *  ⛔ 失败词表是这一族的（硬规则 3b）：
 *    • `failed`          — 例程做不成它的事（坏配置）；
 *    • `not-evaluated`   — 没有任何已登记载体可读（verify worktree 无主检出运行时态），或 kill switch；
 *    • `verified`        — 读数取到了且**没有任何腐烂**（uncovered 仍写进 value/reason，⛔ 不吞掉）；
 *    • `instrument-dark` — 读数取到了，结论是「有仪器在腐烂」。⛔ 不与 verified / not-evaluated 同形。 */
export async function runInstrumentDecayRound(
  root: string,
  opts: InstrumentDecayRoundOptions = {},
): Promise<Fact<InstrumentDecayFactValue | null>> {
  const name = INSTRUMENT_DECAY_ROUTINE_NAME;
  if (opts.configError) return { name, value: null, state: "failed", reason: opts.configError };
  if (opts.configPresent === false) {
    return { name, value: null, state: "not-evaluated", reason: "not-evaluated:not-declared — loop.instrument_decay is absent (the routine is only assembled when the section is declared)" };
  }
  if (opts.config === null) {
    return { name, value: null, state: "failed", reason: cfgInstrumentDecayBad("present but could not be parsed") };
  }
  if (opts.config && !opts.config.enabled) {
    return { name, value: null, state: "not-evaluated", reason: "not-evaluated:disabled — .quay/config.yml loop.instrument_decay.enabled=false（kill switch：零读数、零写入）" };
  }

  const resolvedRoot = path.resolve(root);
  const outcome = analyzeInstrumentDecay(resolvedRoot, {
    staleSeconds: opts.staleSeconds ?? INSTRUMENT_DECAY_DEFAULT_STALE_SECONDS,
  }, opts.manifest);

  // 把 findings 归并成 (载体, 形态) 的 pair —— 立案的粒度是 Plan 写明的 pair，证据仍是逐 group。
  const pairMap = new Map<string, { file: string; kind: InstrumentDecayFinding["kind"]; findings: InstrumentDecayFinding[] }>();
  for (const c of outcome.carriers) {
    for (const f of c.decayed) {
      const key = `${c.file}|${f.kind}`;
      const entry = pairMap.get(key) ?? { file: c.file, kind: f.kind, findings: [] };
      entry.findings.push(f);
      pairMap.set(key, entry);
    }
  }
  const pairs = [...pairMap.entries()].map(([key, v]) => ({ key, ...v }));
  const prior = opts.priorFilings !== undefined
    ? new Set(opts.priorFilings)
    : readPriorInstrumentDecayFilings(resolvedRoot, opts.roundLogPath);

  const filings: InstrumentDecayFiling[] = [];
  for (const p of pairs) {
    const groups = p.findings.map((f) => f.group);
    if (prior.has(p.key)) {
      filings.push({ key: p.key, file: p.file, kind: p.kind, groups, filing: "already-filed", exitCode: null, error: null, summary: null });
      continue;
    }
    if (opts.halted === true) {
      filings.push({ key: p.key, file: p.file, kind: p.kind, groups, filing: "deferred", exitCode: null, error: "halted", summary: null });
      continue;
    }
    const gate = resourceGateCheck(resolvedRoot, opts.resourceGateArgv ?? null);
    if (!gate.go) {
      filings.push({ key: p.key, file: p.file, kind: p.kind, groups, filing: "deferred", exitCode: null, error: `resource-gate ${gate.state}`, summary: null });
      continue;
    }
    const argv = buildInstrumentDecayGapWorkerArgv(resolvedRoot, [p], opts.gapWorkerCmd ?? null);
    const g = await runAsync(argv, { timeoutMs: opts.gapWorkerTimeoutMs ?? INSTRUMENT_DECAY_GAP_WORKER_TIMEOUT_MS_DEFAULT, collectStderr: true });
    filings.push({
      key: p.key, file: p.file, kind: p.kind, groups,
      filing: "filed",
      exitCode: g.status,
      error: g.error ? g.error.message : (g.status === 0 ? null : (String(g.stderr ?? "").slice(0, 200) || null)),
      summary: String(g.stdout ?? "").trim().slice(-400) || null,
    });
  }

  const value: InstrumentDecayFactValue = {
    mode: "instrument-decay-round",
    evaluated: outcome.anyEvaluated,
    decayedCount: outcome.decayedCount,
    healthyCount: outcome.healthyCount,
    uncoveredCount: outcome.uncoveredCount,
    uncovered: outcome.uncovered,
    carriers: outcome.carriers.map((c) => ({
      file: c.file,
      evaluated: c.evaluated,
      contentDark: c.contentDark,
      staleEvaluated: c.staleEvaluated,
      decayed: c.decayed,
    })),
    filings,
    reportOnly: true,
  };

  if (!outcome.anyEvaluated) {
    return { name, value, state: "not-evaluated", reason: "not-evaluated:no-carrier — no registered carrier is present under .quay/ (verify worktree has no main-checkout runtime state)" };
  }
  const coverage = value.uncoveredCount > 0
    ? `${value.uncoveredCount} uncovered carrier(s) NOT counted healthy (${value.uncovered.map((u) => u.file).join(", ")})`
    : "no uncovered carriers";
  if (outcome.decayedCount === 0) {
    return { name, value, state: "verified", reason: value.uncoveredCount > 0 ? `no instrument decay; ${coverage}` : null };
  }
  const filed = filings.filter((f) => f.filing === "filed").length;
  const already = filings.filter((f) => f.filing === "already-filed").length;
  const deferred = filings.filter((f) => f.filing === "deferred").length;
  const named = [...pairMap.values()].map((p) => `${p.file}: ${p.kind} (${p.findings.length})`).join("; ");
  return {
    name,
    value,
    state: "instrument-dark",
    reason: `instrument-dark: ${outcome.decayedCount} finding(s) — ${named}; filings: filed=${filed} already-filed=${already} deferred=${deferred}; ${coverage}`,
  };
}

export interface InstrumentDecayRoutineOptions {
  staleSeconds?: number;
  gapWorkerCmd?: string | null;
  gapWorkerTimeoutMs?: number;
  resourceGateArgv?: string[] | null;
  roundLogPath?: string;
}

/** Build the RoutineSpec（scheduler / watchdog / halt 是 driver 的，不在这里重实现）。 */
export function buildInstrumentDecayRoutine(
  root: string,
  read: InstrumentDecayConfigRead,
  opts: InstrumentDecayRoutineOptions = {},
): RoutineSpec {
  const minutes = read.config?.intervalMinutes ?? INSTRUMENT_DECAY_INTERVAL_MIN_DEFAULT;
  return {
    name: INSTRUMENT_DECAY_ROUTINE_NAME,
    schedule: { kind: "interval", minutes },
    // 纯文件 + git 读；halt 只挡 gap-filing spawn（读数照跑——观测不是受闸动作）。
    run: async (ctx) => [
      await runInstrumentDecayRound(root, {
        config: read.config,
        configPresent: read.present,
        configError: read.error,
        ...(opts.staleSeconds !== undefined ? { staleSeconds: opts.staleSeconds } : {}),
        ...(opts.gapWorkerCmd !== undefined ? { gapWorkerCmd: opts.gapWorkerCmd } : {}),
        ...(opts.gapWorkerTimeoutMs !== undefined ? { gapWorkerTimeoutMs: opts.gapWorkerTimeoutMs } : {}),
        ...(opts.resourceGateArgv !== undefined ? { resourceGateArgv: opts.resourceGateArgv } : {}),
        ...(opts.roundLogPath !== undefined ? { roundLogPath: opts.roundLogPath } : {}),
        halted: ctx?.halted === true,
      }),
    ],
  };
}

/** Production entry: read `.quay/config.yml` and build the routine. NEVER throws.
 *  `routine` is `null` when NO section is declared — an undeclared workspace keeps the EXACT routine
 *  set it had before (AC144's "exactly four"). A DECLARED section always yields a routine, even
 *  `enabled:false` or malformed, because "not running" must be observable (硬规则 3/3b). */
export function instrumentDecayRoutineFromConfig(
  root: string,
  opts: InstrumentDecayRoutineOptions = {},
): { routine: RoutineSpec | null; error: string | null; present: boolean; enabled: boolean } {
  const read = readInstrumentDecayConfig(root);
  return {
    routine: read.present ? buildInstrumentDecayRoutine(root, read, opts) : null,
    error: read.error,
    present: read.present,
    enabled: read.config?.enabled === true,
  };
}

/** The assembly line, as ONE string — declared-but-disabled / malformed / running never look the
 *  same in the driver's startup log (硬规则 3b/9). */
export function formatInstrumentDecayAssembly(a: {
  present: boolean;
  error: string | null;
  enabled: boolean;
  intervalMinutes: number;
}): string {
  if (a.error !== null) return `instrument-decay 例程已装配（${a.error} — 每轮记 failed、零读数零写入；⛔ 不回退到缺省节奏照跑）`;
  if (!a.enabled) return "instrument-decay 例程已装配（enabled:false — 每轮记 not-evaluated:disabled，零读数零写入）";
  return `instrument-decay 例程已装配（enabled, interval=${a.intervalMinutes}m，report-only：A/B 写手停写 + C 内容全暗 + D 过期的已评估 + uncovered，读数写成 state=instrument-dark 的 Fact；腐烂是读数内容，⛔ 不是 failed；有新腐烂才 spawn gap-filing，已立案的 (载体,形态) 不重复立案）`;
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
  /** resource-diagnostic 例程：同前五条的注入纪律（main() 从 `.quay/config.yml`
   *  `loop.resource_diagnostic:` 装配后注入，⛔ 本函数不自己读配置）。缺省 null = 未装配（老行为，
   *  内建四条不变）。未声明 ⇒ 例程表不变；声明了但 enabled:false/写坏 ⇒ 仍装配，因为「不跑」必须
   *  可观测（disabled / failed 读数，硬规则 3b）。 */
  resourceDiagnosticRoutine?: RoutineSpec | null;
  /** cross-project-dogfood 例程：同前四条的注入纪律（main() 从 `.quay/config.yml`
   *  `loop.cross_project_dogfood:` 装配后注入，⛔ 本函数不自己读配置）。缺省 null = 未装配（老行为）。
   *  未声明 ⇒ 例程表不变；声明了但 enabled:false/写坏 ⇒ 仍装配，因为「不跑」必须可观测（disabled /
   *  failed 读数，硬规则 3b）。 */
  crossProjectDogfoodRoutine?: RoutineSpec | null;
  /** arch-coverage-report 例程（gap-arch-coverage-report-report-only-not-run-in-production）：同族的
   *  声明式注入纪律（main() 从 `.quay/config.yml` `loop.arch_coverage_report:` 装配后注入）。
   *  缺省 null = 未装配 ⇒ 未声明的工作区例程表逐条不变（AC144 的「恰好四条」判据仍成立）。
   *  **report-only**：它产出一条覆盖面读数 + 一行基线，⛔ 不作为任何闸。 */
  archCoverageRoutine?: RoutineSpec | null;
  /** arch-cycle-report 例程（gap-arch-cycle-report-only-routine）：同族的声明式注入纪律（main() 从
   *  `.quay/config.yml` `loop.arch_cycle_report:` 装配后注入）。缺省 null = 未装配 ⇒ 未声明的
   *  工作区例程表逐条不变（AC144 的「恰好四条」判据仍成立）。
   *  **report-only**：目录级环读数 + 一行历史，环非零 ⛔ 不使轮 failed。 */
  archCycleRoutine?: RoutineSpec | null;
  /** design-evolution-readings 例程（gap-design-evolution-readings-report-only-routine）：同族的声明式
   *  注入纪律（main() 从 `.quay/config.yml` `loop.design_evolution_readings:` 装配后注入）。缺省
   *  null = 未装配 ⇒ 未声明的工作区例程表逐条不变（AC144 的「恰好四条」判据仍成立）。
   *  **report-only**：RM1 占比 + RM2 争用计数 + 一行历史，⛔ 不作为任何闸。 */
  designEvolutionRoutine?: RoutineSpec | null;
  /** adr-enforcement-report 例程（tasks/gap-adr007-half1-selfcheck-probes-archived-and-gate-never-
   *  invoked）：让 `gates.adr` 声明且 accepted 的 ADR 的 `adr-<id>` 门有常设调用者。**与上面各条的
   *  区别**：它 DEFAULT-ON（段缺席也装配，见其节头注释——「没人打开的 enforcement」正是本轨要消灭的
   *  缺陷）；段只能调间隔或关掉（可观测的 not-evaluated:disabled）。**report-only**：失败是该例程的
   *  读数；selfcheck exit 2（NOT-EVALUATED）记 not-evaluated，⛔ 不记 failed。 */
  adrEnforcementRoutine?: RoutineSpec | null;
  /** instrument-decay 例程（gap-instrument-decay-check-unwired-and-blind-to-content-dark）：同族的
   *  声明式注入纪律（main() 从 `.quay/config.yml` `loop.instrument_decay:` 装配后注入）。缺省
   *  null = 未装配 ⇒ 未声明的工作区例程表逐条不变（AC144 的「恰好四条」判据仍成立）。
   *  **report-only**：读数写成 `state: "instrument-dark"` 的 Fact（⛔ 不 ratchet），有新腐烂才 spawn
   *  gap-filing；已立案的 (载体, 形态) 不重复立案。 */
  instrumentDecayRoutine?: RoutineSpec | null;
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
    // 第十类：RESOURCE-DIAGNOSTIC 例程（同一「声明式 + 可观测」族：间隔与开关来自 `.quay/config.yml`
    // `loop.resource_diagnostic:`）。缺席 ⇒ 不加入（老行为）；加入而 section 缺席 ⇒ 记
    // `not-evaluated:disabled` 且零 spawn（kill switch 的可观测面）。**与上面四条的区别是【机械面在
    // 语义面之前】且机械面零模型调用**——只有机械旗标出的**新** anomaly 才走既有的 verifier/refuter
    // 与立案通道（见 resource-anomaly-detector.ts 头部）。
    ...(opts.resourceDiagnosticRoutine ? [opts.resourceDiagnosticRoutine] : []),
    // 第十一类：ARCH-COVERAGE-REPORT 例程（同一「声明式 + 可观测」族：间隔与开关来自
    // `.quay/config.yml` `loop.arch_coverage_report:`）。缺席 ⇒ 不加入（老行为，内建四条不变）；
    // 加入而段缺席/写坏 ⇒ 仍装配并记 not-evaluated:disabled / failed（kill switch 与坏配置的可观测面）。
    // **与上面各条的区别是它回答的问题**：「哪些语言/目录没有任何分析器到达」——一个**覆盖面**读数，
    // report-only，⛔ 不 ratchet（NOT-EVALUATED 非零不是 failed）。
    ...(opts.archCoverageRoutine ? [opts.archCoverageRoutine] : []),
    // 第十二类：ARCH-CYCLE-REPORT 例程（同一「声明式 + 可观测」族：间隔与开关来自
    // `.quay/config.yml` `loop.arch_cycle_report:`）。缺席 ⇒ 不加入（老行为，内建四条不变）；
    // 加入而段缺席/写坏 ⇒ 仍装配并记 not-evaluated:disabled / failed（kill switch 与坏配置的可观测面）。
    // **它回答的问题**：「目录级环现在是多少、成员是谁」——archguard-runner 的闸读数（on-demand）
    // 的**持续消费者**，report-only，⛔ 不 ratchet（环非零不是 failed）。
    ...(opts.archCycleRoutine ? [opts.archCycleRoutine] : []),
    // 第十三类：DESIGN-EVOLUTION-READINGS 例程（同一「声明式 + 可观测」族：间隔与开关来自
    // `.quay/config.yml` `loop.design_evolution_readings:`）。缺席 ⇒ 不加入（老行为，内建四条不变）；
    // 加入而段缺席/写坏 ⇒ 仍装配并记 not-evaluated:disabled / failed（kill switch 与坏配置的可观测面）。
    // **它回答的问题**：「扩展点模板」这个元机制到底改变了新代码的落点没有（RM1 占比）、以及哪些文件
    // 仍在产生并发争用（RM2）——两条读数都来自被测机制之外（git 历史 / worker 结局账本），report-only，
    // ⛔ 不 ratchet（占比高、争用多都不是 failed）。
    ...(opts.designEvolutionRoutine ? [opts.designEvolutionRoutine] : []),
    // 第十四类：ADR-ENFORCEMENT 例程（tasks/gap-adr007-half1-selfcheck-probes-archived-and-gate-never-
    // invoked）。与上面各条的唯一差别是**它 DEFAULT-ON**：缺省不装配正是本轨要修的缺陷（`adr-007`
    // 门声明了 94 天、0 事件）。**它回答的问题**：「已声明并被接受的 ADR，它的 enforcement 命令现在
    // 真的跑得起来吗」——经门引擎 runGate 写 GateEvent（actor=例程名），report-only，⛔ 不 ratchet、
    // ⛔ 不在 fan-in 热路径上。
    ...(opts.adrEnforcementRoutine ? [opts.adrEnforcementRoutine] : []),
    // 第十五类：INSTRUMENT-DECAY 例程（同一「声明式 + 可观测」族：间隔与开关来自 `.quay/config.yml`
    // `loop.instrument_decay:`）。缺席 ⇒ 不加入（老行为，内建四条不变）；加入而段缺席/写坏 ⇒ 仍装配并记
    // not-evaluated:disabled / failed（kill switch 与坏配置的可观测面）。
    // **它回答的问题**：「我们用来观测系统的仪器本身还在读数吗」——A/B 写手停写、C 内容全暗、
    // D 过期的已评估、uncovered 未覆盖。⛔ 不是 fan-in 热路径上的检查。
    ...(opts.instrumentDecayRoutine ? [opts.instrumentDecayRoutine] : []),
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
  /** `false` ⇒ the USD ceiling is declared but NOT enforced (`usd_cap_enabled:false`). Read so this
   *  assembly line cannot call a switched-off ceiling "HARD" — the one thing a startup line must not do. */
  usdCapEnabled: boolean | null;
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
  // ⛔ A ceiling with `usd_cap_enabled:false` is STILL READ AND REPORTED, but it must not be called HARD:
  //   «declared» and «enforced» are different states and this line is where an operator reads which one
  //   is true (硬规则 3b). The count ceiling immediately to the left stays enforced either way.
  const usd = od.maxUsdPer24h === null ? "" : od.usdCapEnabled === false
    ? `, max_usd_per_24h=$${od.maxUsdPer24h} (DECLARED BUT NOT ENFORCED — usd_cap_enabled:false; the realized cost is still read and reported on every Fact, and max_model_calls_per_24h still binds)`
    : `, max_usd_per_24h=$${od.maxUsdPer24h} (HARD: realized gateway cost from the same ledger; an unknown price counts as the per-call ceiling, never 0)`;
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
  /** 停机时给**在飞例程**的协作宽限（ms）。见 `STOP_GRACE_MS_DEFAULT`。测试缝：传 0 复现「例程完全不
   *  响应取消 ⇒ 由调用方放弃」那一支。 */
  stopGraceMs?: number;
  /** 轮内停机探针的轮询周期（ms，缺省 `DISK_STOP_POLL_MS_DEFAULT`）。 */
  stopPollMs?: number;
}

/** 停机时给**在飞例程**的协作宽限（ms）。
 *
 *  WHY 5s，而不是「把 60000ms 调大」（硬规则 4 推论二：⛔ 不靠抬字面量）：
 *  `stopKindViaAnchor` 的 60000ms 是**等待窗口**，不是**停机延迟**。把它调大只是把 `stop-failed`
 *  推迟成一次更长的阻塞，且不封顶（例程看门狗缺省 30min ⇒ 一个不响应取消的例程能把停机拖到 30min）。
 *  真正要的是让循环**真的停下来**：轮边界 + 轮内都查停机（立即），在飞例程收到 `AbortSignal`
 *  （下一个模型调用边界），再加这一条**有界**的兜底宽限 ⇒ 停机延迟有一个**不依赖例程行为**的上界。
 *
 *  取值的依据（不是猜）：协作取消的粒度是**一次模型子进程调用**，而取消到达时那个子进程被
 *  `SIGKILL`（`spawnModelCall` 的 signal 支），收尾是毫秒级；5s 是给「例程还要写一条收尾 Fact /
 *  落一条 carrier 行」留的量级，同时把上界压到 60000ms 窗口的 ~1/10。 */
export const STOP_GRACE_MS_DEFAULT = 5_000;

/** 组装一条 round 记录（heartbeat carrier 的一行）。facts 是轮内跑出的全部例程读数。 */
export function computeRoundRecord(args: {
  round: number;
  runId: string;
  pid: number;
  at: string;
  facts: Fact<unknown>[];
  halted?: boolean;
  /** 本轮因停机请求而**未跑**的 due 例程名（硬规则 3b：被截断的一轮必须与被跑完的一轮不同形）。 */
  skippedRoutines?: readonly string[];
  /** 本轮至少有**一条**例程交出 `not-evaluated: stopped-mid-round`。 */
  stoppedMidRound?: boolean;
}): Record<string, unknown> {
  const { round, runId, pid, at, facts, halted = false, skippedRoutines = [], stoppedMidRound = false } = args;
  return {
    round, run_id: runId, pid, ts: at, halted, facts,
    // ⛔ 两条**只描述「本轮没跑完」**的键：有了它们，「停机打断的一轮」与「正常跑完的一轮」不再同形
    //   （硬规则 3b）。⛔ 不含任何「半轮当成完成」的字段——`facts` 里那条 not-evaluated 才是读数。
    stopped_mid_round: stoppedMidRound,
    skipped_routines: [...skippedRoutines],
  };
}

/** 轮内 / 轮边界的**协作式停机**参数（Plan 步 1-2）。缺省 `undefined` ⇒ 例程侧行为逐字与从前相同。 */
export interface RoutineStopCooperation {
  /** 停机是否已被请求——与常驻 `while` 的条件是**同一个**判据（停机控制器）。 */
  isStopRequested: () => boolean;
  /** 探针轮询周期（ms）。 */
  pollMs: number;
  /** 协作宽限（ms）：发出取消信号之后例程还有多久可以自己收尾。 */
  graceMs: number;
}

/** 停机到达后**放弃等待**那一条 Fact 的读数（`observed:false` 与例程自己交的 `observed:true` 不同形）。 */
function abandonedMidRoundFact(name: string, graceMs: number): Fact<unknown> {
  return {
    name,
    value: { stopped_mid_round: true, observed: false, grace_ms: graceMs },
    state: "not-evaluated",
    reason:
      `${STOPPED_MID_ROUND}: the routine did not observe the stop within ${graceMs}ms — abandoned by the ` +
      `caller-side stop grace. ⛔ This is NOT a completed round: the routine's own Facts are not recorded, ` +
      `and any write it still performs after this point may land on disk.`,
  };
}

/** 放弃等待之后，例程**迟到**收尾时的具名落痕（⛔ 不静默：迟到的 Facts **不**进这一轮，但「它到底有没有
 *  收尾」是运维区分「例程只是慢」与「例程挂了」的唯一读数）。 */
function noteLateSettlement(routineName: string, runP: Promise<Fact<unknown>[]>): void {
  void runP.then(
    () => process.stderr.write(
      `quality-gate-driver: routine '${routineName}' settled AFTER the stop grace had abandoned it — its Facts ` +
      `are NOT part of the stopped round (late settlement is not a late round).\n`,
    ),
    (e: unknown) => process.stderr.write(
      `quality-gate-driver: routine '${routineName}' rejected AFTER the stop grace had abandoned it — ${(e as Error)?.message ?? String(e)}\n`,
    ),
  );
}

/** 单条例程的 caller 侧看门狗：race `r.run(ctx)` 对 `watchdogMs`。例程 wall-clock 超界 ⇒ 返回一条
 *  failed Fact（routine timed out）并继续——⛔ 不 await 已挂的 routine promise。judge spawn 是
 *  runAsync(Infinity)，挂死时该 promise 永不 settle，await 它会让常驻循环同死（心跳冻结）。
 *  Infinity / ≤0 ⇒ 直跑（显式不设限，测试负控制用）；例程自身 throw / reject 自然传播，交外层
 *  try/catch 记「routine threw」（与既有语义一致，⛔ 本函数只处理超时这一态）。
 *
 *  `stop`（gap-quality-restart-waits-out-whole-round-so-osd-in-flight-exceeds-stop-window，Plan 步 2）：
 *  多一条 racer——轮询停机标志，读到停机就 `abort()` 传给例程的 `signal`（把停机**传播成取消**），
 *  然后给例程 `graceMs` 自己收尾。例程在宽限内 settle ⇒ 交出**它自己的** Facts（它知道自己持久化了
 *  什么，调用方不知道）；过时不候 ⇒ 交一条 `observed:false` 的放弃 Fact。⇒ 停机延迟有一个**不依赖
 *  例程行为**的上界 = 一个轮询周期 + 宽限。⛔ `stop` 缺省 undefined ⇒ 与从前逐字相同。
 *
 *  **进程存活不变式（`e18ec4b04` 的回归，勿再破）**：本函数加在事件循环上的**每一条**定时器，
 *  `unref` 与否都要问一句「它凭什么是这个进程活着的理由？」。**看门狗**是——它有界且其产物是一轮的
 *  结论；**停机探针**不是——它无界（见 `armStopPoll`），把它 ref 住就等于对任何「例程永不 settle 且
 *  停机永不到来」的等待说「进程不许退出」。判别性代价：测试体跑完而进程不退 ⇒ `node --test` 挂死该
 *  文件 ⇒ 全量套件静默停摆（硬规则 4b：观测器不得自己成为被测对象仍然活着的证据）。 */
async function runRoutineWithWatchdog(
  r: RoutineSpec,
  ctx: { halted: boolean },
  watchdogMs: number,
  stop?: RoutineStopCooperation,
): Promise<Fact<unknown>[]> {
  const ac = new AbortController();
  const runCtx: RoutineRunContext = stop ? { ...ctx, signal: ac.signal } : ctx;
  const runP = Promise.resolve().then(() => r.run(runCtx));
  if (!Number.isFinite(watchdogMs) || watchdogMs <= 0) {
    // ⛔ 无看门狗那一支仍接停机：看门狗与停机是两条独立的通道（负控制测的是**看门狗缺席**）。
    if (!stop) return await runP;
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopPoll: ReturnType<typeof setTimeout> | null = null;
  let stopGrace: ReturnType<typeof setTimeout> | null = null;
  let stopSettled = false;
  try {
    const racers: Promise<Fact<unknown>[]>[] = [];
    if (Number.isFinite(watchdogMs) && watchdogMs > 0) {
      racers.push(new Promise<Fact<unknown>[]>((resolve) => {
        timer = setTimeout(() => resolve([
          { name: r.name, value: null, state: "failed", reason: `routine timed out after ${watchdogMs}ms (caller-side watchdog)` },
        ]), watchdogMs);
      }));
    }
    if (stop) {
      const coop = stop;
      // ⛔ `resolve` 必须由**本函数这一次调用**捕获（闭包局部），⛔ 不放到模块作用域：两个并发调用会
      //    互相覆盖对方的 resolve（那是把一次判定的结果投递给另一个判定）。
      let resolveStop: ((facts: Fact<unknown>[]) => void) | null = null;
      const settleStop = (facts: Fact<unknown>[]): void => {
        if (stopSettled) return;
        stopSettled = true;
        if (stopPoll) { clearTimeout(stopPoll); stopPoll = null; }
        if (stopGrace) { clearTimeout(stopGrace); stopGrace = null; }
        resolveStop?.(facts);
      };
      /** 重新排定下一次停机探针。
       *
       *  ⛔ `unref()`：这条探针链是**纯观测**，⛔ 不得成为「这个进程为什么还活着」的答案。
       *
       *  WHY（本文件自 `e18ec4b04` 起挂起、4/4 全量套件命中的**根因**）：与看门狗不同，这条链是
       *  **无界**的——例程可能永远不 settle（那正是看门狗存在的理由），而停机若永不到来，`tick`
       *  就永远重排自己。`e18ec4b04` 建了这条链却没 `unref()` ⇒ 该 handle 成了事件循环的**存活
       *  锚点**。判别性后果不在「测试逻辑」而在「进程退出」：`quality-gate-driver-loop-watchdog.test.mjs`
       *  的负控制**故意**让 race 永不 settle（例程永不 settle + 看门狗 Infinity），于是 `finally`
       *  那一组 `clearTimeout` 永远轮不到 ⇒ 四条断言**全部通过**、测试体已经跑完，node 进程却
       *  **永不退出** ⇒ `node --test` 永远不结束这个文件 ⇒ 套件静默挂死（不是断言超时，也不是 CPU
       *  自旋：实测挂起的 `node --test` 子进程 0% CPU）。观测器不得自己成为「被测对象仍然活着」的
       *  证据（硬规则 4b）。
       *
       *  ⛔ 不改成「给探针链加一个上界」（Plan 步 3 禁的是抬高字面量，但更根本的是：**没有正确的
       *  上界**）——例程合法在飞的时间就是看门狗的缺省 30min，而负控制里它是 Infinity；任何比它小的
       *  上界都会把「还在跑」误判成「可以放它走」。要表达「不限制进程存活」的正确方式是**在机制上
       *  不参与进程存活判定**，即 `unref()`，而不是挑一个数字。
       *
       *  ⛔ 生产不变：轮内的存活由**看门狗**（缺省 `ROUTINE_WATCHDOG_MS_DEFAULT` 有限 ⇒ 仍是 ref 态）
       *  持有，轮间由 `stopCtl.sleep` 持有；停机探针只是搭在这二者之上的观测，本来就不是 liveness 的
       *  来源。`stopGrace` 保持 ref 态——它有界且**必须**能 fire（它的产物是那条放弃 Fact）。 */
      const armStopPoll = (): void => {
        stopPoll = setTimeout(tick, Math.max(1, coop.pollMs));
        if (typeof stopPoll.unref === "function") stopPoll.unref();
      };
      const tick = (): void => {
        if (stopSettled) return;
        if (!coop.isStopRequested()) { armStopPoll(); return; }
        ac.abort();
        // 例程若在宽限内自己收尾 ⇒ 交出**它自己的** Facts（应是 not-evaluated: stopped-mid-round）。
        void runP.then((facts) => settleStop(facts), () => { /* reject 由 race 的 runP 支上抛 */ });
        stopGrace = setTimeout(() => {
          settleStop([abandonedMidRoundFact(r.name, coop.graceMs)]);
          noteLateSettlement(r.name, runP);
        }, Math.max(0, coop.graceMs));
      };
      racers.push(new Promise<Fact<unknown>[]>((resolve) => {
        resolveStop = resolve;
        armStopPoll();
      }));
    }
    if (racers.length === 0) return await runP;
    // race 输掉的那一支若 reject 会是 unhandled rejection（Node 默认警告/未来报错）：挂一个 no-op
    // handler 消噪。⛔ 不改语义——`runP` 仍在 race 里，它先 reject 时 race 照旧 reject 给调用方。
    void runP.catch(() => { /* see above */ });
    return await Promise.race([runP, ...racers]);
  } finally {
    if (timer) clearTimeout(timer);
    if (stopPoll) clearTimeout(stopPoll);
    if (stopGrace) clearTimeout(stopGrace);
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
  const stopGraceMs = opts.stopGraceMs ?? STOP_GRACE_MS_DEFAULT;
  const stopPollMs = opts.stopPollMs ?? DISK_STOP_POLL_MS_DEFAULT;
  if (pidFile) {
    try { fs.writeFileSync(pidFile, `${process.pid}\n`, "utf8"); } catch { /* pid-file 只供外部观测，写失败不致命 */ }
  }
  // Layer 0（driver-shared）：停机标志 + 可唤醒 sleep 单一实现（finding `driver-sleep-requeststop-triple`）。
  // ⚠️ `kind` 必须在 `residentLoopStop` **之前**定下来：它同时是进程内登记（`registerKindStop`）与
  // 盘上探针（`kindStopProbe`）的 kind 参数，两处不一致会让两条通道指向不同的循环。
  const kindOfLoop: DriverKind = opts.kind ?? "quality";
  // gap-per-kind-stop-is-in-memory-and-never-crosses-dist-bundles：**跨 bundle** 停机通道。
  // 进程内的 `registerKindStop`/`requestKindStop` 只在「共享同一模块实例」时成立；shipped 产物里
  // anchor 与每个 kind 各是一份 esbuild bundle（各自内联 driver-runtime）⇒ 那条通道恒失效。盘上探针
  // 读 `.quay/anchor-kind-stops.json`（`updateDesired(present=false)` 与期望态同一次调用里写），
  // 与模块布局无关。本函数是 quality / goal / meta **三个 kind 共用**的常驻循环 ⇒ 一次接线覆盖三者。
  const stopProbe = kindStopProbe(root, kindOfLoop);
  const stopCtl = residentLoopStop({
    diskStopProbe: stopProbe.read,
    onNotEvaluated: () => process.stderr.write(`quality-gate-driver: ${stopProbe.note}\n`),
  });
  // AC-255（SPEC §7 阶段 C）：停机登记 —— 进程信号仍停本 kind，同时 anchor 可经 `requestKindStop`
  // 只停【这一个】循环（收敛后多个 kind 同进程，`kill -TERM <pid>` 不再能只停一个）。
  registerKindStop(kindOfLoop, stopCtl.requestStop);

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
    // ── 轮内的协作式停机（gap-quality-restart-waits-out-whole-round-so-osd-in-flight-exceeds-stop-window）──
    // 停机过去**只**在轮边界被看见（本 `while` 的条件）⇒ 一条停机请求要等**整轮**跑完。实测
    // （2026-10-14）：OSD 轮的 wall 6/6 与 22/23 都 > 60s、最长 1172s，而 `stopKindViaAnchor` 只等
    // 60000ms ⇒ 在飞 OSD 轮期间的 `restart --kind quality` **必然** `stop-failed` / `restart-aborted`。
    // 两条同时生效的通道把延迟压到有界：① 例程**之间**查停机（零成本，延迟 ≤ 最长单条例程）；
    // ② 在飞例程收到 `AbortSignal`（Plan 步 2），下一个可中断边界早退并记 `stopped-mid-round`。
    // ⛔ 取消信号**每次例程调用新建**（见 `runRoutineWithWatchdog`）：上一轮的 abort 不该让下一轮的
    //    例程一进来就退出。
    const skipped: string[] = [];
    let stoppedMidRound = false;
    for (const r of routines) {
      const state = { now: Date.now(), lastRun: lastRun[r.name] };
      if (!scheduleIsDue(r.schedule, state)) continue;
      // ① 轮内边界：停机请求到达之后**不再启动**任何 due 例程。⛔ `lastRun` 不为被跳过的例程推进
      //    ——它没跑（硬规则 3b：没跑与跑过不得同形），名字进 `skipped_routines` 落进轮记录。
      if (stopCtl.isStopRequested()) { skipped.push(r.name); continue; }
      lastRun[r.name] = state.now;
      try {
        // caller 侧看门狗（gap-meta-quality-gate-driver）：judge spawn runAsync(Infinity) 挂死时，
        // 看门狗在例程 wall-clock 超界后返回 failed Fact 继续写心跳，⛔ 不 await 已挂的 promise。
        const rf = await runRoutineWithWatchdog(r, { halted }, routineWatchdogMs, {
          isStopRequested: () => stopCtl.isStopRequested(),
          pollMs: stopPollMs,
          graceMs: stopGraceMs,
        });
        // ② 例程自己交出的「半轮被打断」读数（`not-evaluated: stopped-mid-round`）与调用方放弃那一支
        //    共用同一个取词（`STOPPED_MID_ROUND`），轮记录据此把这一轮标成「没跑完」。
        if (rf.some((f) => f.state === "not-evaluated" && typeof f.reason === "string" && f.reason.startsWith(STOPPED_MID_ROUND))) {
          stoppedMidRound = true;
        }
        facts.push(...rf);
      } catch (e) {
        facts.push({ name: r.name, value: null, state: "failed", reason: `routine threw: ${(e as Error).message}` });
      }
    }
    const rec = computeRoundRecord({
      round, runId, pid: process.pid, at: new Date().toISOString(), facts, halted,
      skippedRoutines: skipped, stoppedMidRound,
    });
    try {
      fs.mkdirSync(path.dirname(roundLogFile), { recursive: true });
      fs.appendFileSync(roundLogFile, JSON.stringify(rec) + "\n", "utf8");
    } catch { /* 记录写失败不致命（运行时日志，⛔ 不因日志炸循环） */ }
    if (json) process.stdout.write(`${JSON.stringify({ event: "round", ...rec })}\n`);
    if (once) break;
    if (maxRounds !== null && round >= maxRounds) break;
    // 停机已被看见（轮边界或轮内）⇒ ⛔ 不再睡一个 interval。`stopCtl.sleep` 自己也会被盘上探针唤醒，
    // 但那条路要等到下一个分片（≤ pollMs）；这里是零延迟的那一半。
    if (stopCtl.isStopRequested()) break;
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
  // ⛔ 不在这里拼规格根：probe 规格随插件发布，住在**本 kernel 的 plugin root** 下
  //    （`resolveProbeSpecRoot()`，与 routine-scheduler 的 `${CLAUDE_PLUGIN_ROOT}/probes/…` 同根）。
  //    曾经这里把 `pluginRoot` 硬拼成 `<rootDir>/plugin`（项目根）—— 内核资源锚在项目根上，于是
  //    `quay-init` 之后没有 vendored `plugin/` 的第三方宿主，`loop.routines:` 声明的每一条 `probe:`
  //    在运行期都读不到规格（PROBE-SPEC FAIL-CLOSED）⇒ 整条轨道静默不跑
  //    （gap-probe-routine-resolves-probe-spec-under-project-root-not-plugin-root）。
  const probeSelection = probeRoutinesFromConfig(rootDir, {
    probeTimeoutMs,
    // task store CLI 的**出厂锚点**：`fileRoutineTask` 在无 `packages/quay-native` 的宿主上要靠它
    // 解析到 `<kernelPluginRoot>/vendor/quay-native/dist/quay-native.js`（resolveTaskCliEntry 第二分支）。
    // ⛔ 曾经这里没传 ⇒ 该分支永远走不到 ⇒ 第三方宿主上立案恒失败，而 fact 仍读作 verified
    // （gap-probe-routine-kernel-plugin-root-not-passed-third-party-host-filing-fails）。
    kernelPluginRoot: resolveKernelPluginRoot(),
    ...(probeStateDir ? { stateDir: probeStateDir } : {}),
    ...(probeArgv ? { probeArgv } : {}),
    // 宿主前置同样给**配置声明**的例程：init 脚手架写出的 architecture-analysis（AC2）走的是这条路，
    // 无 archguard 的主机必须同样得到 legible not-evaluated，而不是只保护默认装配那一条。
    instrumentPreflight: archguardInstrumentPreflight(rootDir),
  });
  // 默认装配（gap-architecture-analysis-probe-not-wired-into-driver-routine-or-init）：工作区**没有**
  // 可装配的同名 interval 声明时，把 DEFAULT_PROBE_ROUTINE_DECLS 加进例程表——「声明了但永不 due」
  // 与「没声明」都不该等于「没有 driver 调度它」。
  const defaultProbe = buildDefaultProbeRoutines(rootDir, {
    pluginRoot: probeSelection.pluginRoot,
    kernelPluginRoot: resolveKernelPluginRoot(),
    probeTimeoutMs,
    ...(probeStateDir ? { stateDir: probeStateDir } : {}),
    ...(probeArgv ? { probeArgv } : {}),
  }, new Set(probeSelection.routines.map((r) => r.name)));
  const probeRoutines = [...probeSelection.routines, ...defaultProbe.routines];
  // ⛔ 可见地报告跳过/读不出的例程：一条声明了却不被驱动的 routine，与「没有这条声明」在记录上
  //    本来同形（硬规则 3b/9），故此处把理由打到 stderr（配置坏了 ⇒ driver 照常起，但说出原因）。
  if (probeSelection.error) {
    console.error(`quality-gate-driver: probe 轨道未装配 — ${probeSelection.error}`);
  }
  for (const s of probeSelection.skipped) {
    // 同名默认例程接管时写明——否则「声明的这条没被驱动」会让读者以为整条 capability 没跑。
    const d = defaultProbe.decls.find((x) => x.name === s.name);
    const note = d ? `（默认装配接管：${d.trigger}）` : "";
    console.error(`quality-gate-driver: routine "${s.name}" (${s.trigger}) 未被 probe 轨道驱动 — ${s.reason}${note}`);
  }
  if (probeRoutines.length > 0) {
    const defaultNote = defaultProbe.decls.length > 0 ? `；默认装配: ${defaultProbe.decls.map((d) => `${d.name} (${d.trigger})`).join(", ")}` : "";
    console.error(`quality-gate-driver: probe 轨道已装配 ${probeRoutines.length} 条例程（${probeRoutines.map((r) => r.name).join(", ")}；规格根 ${probeSelection.pluginRoot}${defaultNote}）`);
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

  // resource-diagnostic 轨道：读 `.quay/config.yml` `loop.resource_diagnostic:`（同一注入纪律）。
  // section 缺席/enabled:false ⇒ 例程仍装配（若声明了），每轮只记 `not-evaluated:disabled` 且零 spawn；
  // 配置坏 ⇒ 记 failed 并在此**可见地**报告（硬规则 3b：读不懂 ≠ 合格）。未声明 ⇒ 不装配，例程表与
  // 未接此轨时逐条一致（内建四条不变）。
  const resourceDiagnostic = resourceDiagnosticRoutineFromConfig(rootDir);
  if (resourceDiagnostic.error) {
    console.error(`quality-gate-driver: resource-diagnostic 例程配置无效 — ${resourceDiagnostic.error}`);
  } else if (!resourceDiagnostic.present) {
    console.error("quality-gate-driver: 未声明 loop.resource_diagnostic — resource-diagnostic 例程未装配（off by default，零 spawn；例程表与未接此轨时一致）");
  } else {
    console.error(`quality-gate-driver: resource-diagnostic 例程已装配（${resourceDiagnostic.enabled ? `enabled，interval ${resourceDiagnostic.routine?.schedule?.minutes ?? "?"}m` : "enabled:false — 每轮记 not-evaluated:disabled，零 spawn"}）`);
  }

  // arch-coverage-report 轨道：读 `.quay/config.yml` `loop.arch_coverage_report:`（同族注入纪律）。
  // 未声明 ⇒ 不装配（例程表与未接此轨时逐条一致，AC144 的「恰好四条」不变）；声明了但
  // enabled:false/写坏 ⇒ 仍装配（disabled / failed 必须可观测，硬规则 3b）。**report-only**：
  // 每 due 轮跑一次覆盖面自报并把一行基线 append 到 `.quay/arch-coverage-history.jsonl`。
  const archCoverage = archCoverageRoutineFromConfig(rootDir);
  if (archCoverage.error) {
    console.error(`quality-gate-driver: arch-coverage-report 例程配置无效 — ${archCoverage.error}`);
  } else if (!archCoverage.present) {
    console.error("quality-gate-driver: 未声明 loop.arch_coverage_report — arch-coverage-report 例程未装配（off by default，零报告零写入；例程表与未接此轨时一致）");
  } else {
    console.error(`quality-gate-driver: ${formatArchCoverageAssembly({
      present: archCoverage.present,
      error: archCoverage.error,
      enabled: archCoverage.enabled,
      intervalMinutes:
        (archCoverage.routine?.schedule as { minutes?: number } | undefined)?.minutes ?? ARCH_COVERAGE_INTERVAL_MIN_DEFAULT,
    })}`);
  }

  // arch-cycle-report 轨道：读 `.quay/config.yml` `loop.arch_cycle_report:`（同一注入纪律）。
  // 未声明 ⇒ 不装配（例程表逐条不变，AC144 的「恰好四条」不变）；声明了但 enabled:false/写坏 ⇒
  // 仍装配（disabled / failed 必须可观测，硬规则 3b）。**report-only**：每 due 轮读一次上次 analyze
  // 落盘的目录级环并把一行 append 到 `.quay/arch-cycle-history.jsonl`；环非零 ⛔ 不使轮 failed。
  const archCycle = archCycleRoutineFromConfig(rootDir);
  if (archCycle.error) {
    console.error(`quality-gate-driver: arch-cycle-report 例程配置无效 — ${archCycle.error}`);
  } else if (!archCycle.present) {
    console.error("quality-gate-driver: 未声明 loop.arch_cycle_report — arch-cycle-report 例程未装配（off by default，零读数零写入；例程表与未接此轨时一致）");
  } else {
    console.error(`quality-gate-driver: ${formatArchCycleAssembly({
      present: archCycle.present,
      error: archCycle.error,
      enabled: archCycle.enabled,
      intervalMinutes:
        (archCycle.routine?.schedule as { minutes?: number } | undefined)?.minutes ?? ARCH_CYCLE_INTERVAL_MIN_DEFAULT,
    })}`);
  }

  // design-evolution-readings 轨道：读 `.quay/config.yml` `loop.design_evolution_readings:`（同一注入
  // 纪律）。未声明 ⇒ 不装配（例程表逐条不变，AC144 的「恰好四条」不变）；声明了但 enabled:false/写坏
  // ⇒ 仍装配（disabled / failed 必须可观测，硬规则 3b）。**report-only**：每 due 轮取一次 RM1（分解后
  // 增量落回中心文件的占比）与 RM2（热点文件并发争用），append 一行到
  // `.quay/design-evolution-history.jsonl`；占比高/争用多 ⛔ 不使轮 failed。
  const designEvolution = designEvolutionRoutineFromConfig(rootDir);
  if (designEvolution.error) {
    console.error(`quality-gate-driver: design-evolution-readings 例程配置无效 — ${designEvolution.error}`);
  } else if (!designEvolution.present) {
    console.error("quality-gate-driver: 未声明 loop.design_evolution_readings — design-evolution-readings 例程未装配（off by default，零读数零写入；例程表与未接此轨时一致）");
  } else {
    console.error(`quality-gate-driver: ${formatDesignEvolutionAssembly({
      present: designEvolution.present,
      error: designEvolution.error,
      enabled: designEvolution.enabled,
      intervalMinutes:
        (designEvolution.routine?.schedule as { minutes?: number } | undefined)?.minutes ?? DESIGN_EVOLUTION_INTERVAL_MIN_DEFAULT,
    })}`);
  }

  // adr-enforcement-report 轨道：让 `gates.adr` 声明且 accepted 的 ADR 的 `adr-<id>` 门有常设调用者
  // （tasks/gap-adr007-half1-selfcheck-probes-archived-and-gate-never-invoked）。**DEFAULT-ON**：段缺席
  // 也装配（缺省 1440m）——「已声明的门没人跑」正是本轨要消灭的形态；段只能调间隔或关掉。
  const adrEnforcement = adrEnforcementRoutineFromConfig(rootDir);
  console.error(`quality-gate-driver: ${formatAdrEnforcementAssembly({
    present: adrEnforcement.present,
    error: adrEnforcement.error,
    enabled: adrEnforcement.enabled,
    intervalMinutes:
      (adrEnforcement.routine.schedule as { minutes?: number } | undefined)?.minutes ?? ADR_ENFORCEMENT_INTERVAL_MIN_DEFAULT,
  })}`);

  // instrument-decay 轨道：读 `.quay/config.yml` `loop.instrument_decay:`（同一注入纪律）。
  // 未声明 ⇒ 不装配（例程表逐条不变，AC144 的「恰好四条」不变）；声明了但 enabled:false/写坏 ⇒
  // 仍装配（disabled / failed 必须可观测，硬规则 3b）。**report-only**：每 due 轮跑一次四项读数
  // （A/B 写手停写、C 内容全暗、D 过期的已评估、uncovered），写成 `state: "instrument-dark"` 的
  // Fact；腐烂 ⛔ 不使轮 failed，有新腐烂才 spawn gap-filing。
  const instrumentDecay = instrumentDecayRoutineFromConfig(rootDir);
  if (instrumentDecay.error) {
    console.error(`quality-gate-driver: instrument-decay 例程配置无效 — ${instrumentDecay.error}`);
  } else if (!instrumentDecay.present) {
    console.error("quality-gate-driver: 未声明 loop.instrument_decay — instrument-decay 例程未装配（off by default，零读数零写入；例程表与未接此轨时一致）");
  } else {
    console.error(`quality-gate-driver: ${formatInstrumentDecayAssembly({
      present: instrumentDecay.present,
      error: instrumentDecay.error,
      enabled: instrumentDecay.enabled,
      intervalMinutes:
        (instrumentDecay.routine?.schedule as { minutes?: number } | undefined)?.minutes ?? INSTRUMENT_DECAY_INTERVAL_MIN_DEFAULT,
    })}`);
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
    archReviewGate,
    packagingCheckCmd: packagingCheckCmd ? splitArgs(packagingCheckCmd) : null,
    packagingGapWorkerCmd: packagingGapWorkerCmd ?? null,
    packagingGapWorkerTimeoutMs,
    packagingHygieneIntervalMinutes,
    archGapWorkerCmd: archGapWorkerCmd ?? null,
    archGapWorkerTimeoutMs,
    probeRoutines,
    archDiscoveryRoutine: archDiscovery.routine,
    discoveryMethodRoutine: discoveryMethod.routine,
    openSemanticDiscoveryRoutine: openDiscovery.routine,
    crossProjectDogfoodRoutine: crossProject.routine,
    resourceDiagnosticRoutine: resourceDiagnostic.routine,
    archCoverageRoutine: archCoverage.routine,
    archCycleRoutine: archCycle.routine,
    designEvolutionRoutine: designEvolution.routine,
    adrEnforcementRoutine: adrEnforcement.routine,
    instrumentDecayRoutine: instrumentDecay.routine,
  });

  return runResidentQualityGateLoop({ root: rootDir, intervalMs: interval, once, maxRounds, roundLogFile, runId: resolvedRunId, json, pidFile, routines, routineWatchdogMs, kind: "quality" });
}

// Direct entry guard (gate-script-base convention)：仅当本文件是入口时跑 main()。
if (isDirectEntry(import.meta, undefined, "quality-gate-driver")) {
  main(process.argv).then((code) => { process.exitCode = code; });
}
