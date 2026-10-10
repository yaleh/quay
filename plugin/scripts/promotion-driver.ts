// plugin/scripts/promotion-driver.ts — AC130 + AC131 + AC132 + AC133 + AC134 (tasks/gap-ac130-promotion-driver-resident-loop,
//   tasks/gap-ac131-promotion-mechanical-no-llm, tasks/gap-ac132-fix-worker-structured-input,
//   tasks/gap-ac133-driver-regate-and-retry-cap, tasks/gap-ac134-promotion-outcome-ledger)
//
// 常驻循环，每轮调 `ready-pool-check` 取【全池】判定（⛔ 非单条 --targeted），跑完一轮不退出、
// 按间隔进入下一轮。停掉驱动 ⇒ 池中新出现的合格任务不再被晋升（AC2 能取假，证明晋升由驱动驱动、
// 非 outer tick）。
//
// WHY THIS EXISTS（manager-phase-goal.md ### AC130，晋升面机械化的第一半）：
//   todo→ready 晋升过去靠 outer 每轮记得调 A22 --apply（角色意志，换会话/换模型即丢失）。本驱动是
//   常驻【机械】进程：每轮无条件调 ready-pool-check --apply 取全池判定 + 落地合格晋升（复用 A22 已在
//   用的心跳路径，零 LLM），跑完一轮不退出、按 --interval 进入下一轮。AC130 只做【常驻全池循环】这一半。
//
// 权责边界（⛔ 只做 AC130 + AC131 + AC132 + AC133 判据，不越界到 AC135–136 —— 那些是独立任务）：
//   驱动  ✅ 每轮调 ready-pool-check --apply（全池判定 + 合格晋升，零 LLM）
//         ✅ 跑完一轮不退出、按 --interval 进入下一轮；SIGINT/SIGTERM 优雅停机
//         ✅ 每轮写一条 round 记录（.quay/promotion-round.jsonl，gitignored，outer 可消费）
//         ✅ AC131：晋升路径纯机械（零 LLM），round 记录带 promote_path_llm_invoked=false（派生自真实 argv，⛔ 不硬编码）
//         ✅ AC132：不合格者 spawn 短命 claude -p fix worker，输入 = 任务 id + 闸的结构化 missing 清单
//            （沿用 A24 可修三类/不可修五类；可修三类 spawn，不可修五类逐条记原因不修）
//         ✅ AC133：fix worker 退出后【重新调同一个闸】验证，以闸的新判定为准（⛔ 不信 worker 自述）；
//            同一任务连续修 N 次仍不合格 ⇒ 标 needs-human 并停止对它的修复循环（失败上限）
//         ✅ AC134：每次判定/晋升/修复各写一条 outcome 记录（.quay/promotion-outcome.jsonl，gitignored，
//            字段 task_id · gate（含 missing）· action（promote/fix/skip/needs-human）· result · ts，outer 可消费）
//         ✅ AC150-1：起 fix worker 前经与 worker-driver 同一 resourceGateCheck 判定（WAIT ⇒ 退避，本轮不 spawn）
//         ✅ AC150-2：运行期 halt = 读 .quay/promotion-control.json（单一真相源）；halted ⇒ 停止晋升与 fix spawn
//   驱动  ⛔ 不做任何 commit（标 needs-human 是写 status 到 tasks/<id>.md，同 --apply 晋升的写类，非 commit）
//         ⛔ 不读/不写 .halt（停机态 = promotion-control.json 单一真相源，与 worker-driver 同族；AC135 才涉及 outer 退役）
//
// Run:
//   node --experimental-strip-types plugin/scripts/promotion-driver.ts \
//     --root <repo> [--interval <ms>] [--cap <n>] [--once] [--max-rounds <n>]
//     [--max-fix-retries <n>] [--ready-pool-cmd "<argv>"] [--fix-worker-cmd "<argv>"]
//     [--llm-commands <csv>] [--round-log <path>] [--outcome-log <path>] [--run-id <id>] [--pid-file <path>] [--liveness-cmd "<argv>"] [--json]
//   --interval <ms>       轮间隔（缺省 30000；测试缝传小值）
//   --cap <n>             传给 ready-pool-check 的并发 cap（缺省 5——AC48 后 cap 不再闸晋升，
//                         但仍参与 floor 报告与 disjointness 排序；传 5 避免 cap-3 回退的 floor 假象）
//   --once                跑一轮即退出（手动单发 / 测试）
//   --max-rounds <n>      跑满 N 轮退出（测试缝，防常驻环无限跑）
//   --max-fix-retries <n> AC133 失败上限：同一任务连续修 N 次仍不合格 ⇒ 标 needs-human（缺省 3——
//                         与 fan-in 侧 attempt>=3 同值，见 gap-fan-in-relaunch-retry-cap）
//   --ready-pool-cmd <s>  覆盖 ready-pool-check 命令（测试缝，同 worker-driver 的缝）。
//                         缺省 = `node …ready-pool-check.ts --root <root> --cap <cap> --apply --json`。
//                         输出须为 analyzeTasks JSON（含 pool / promotions / applied_promotions / candidates）。
//                         解析失败/非零退出 ⇒ fail-closed（本轮记 error，⛔ 不得伪装成「无候选」）。
//   --fix-worker-cmd <s>  覆盖 fix worker 命令【前缀】（测试缝——真实 prompt 仍作为末参数追加，
//                         AC2 取假用捕获脚本读末参数）。缺省 = `claude -p <prompt>`（prompt 由驱动
//                         用任务 id + 结构化 missing 清单拼出，⛔ 非散文指令）。
//   --llm-commands <csv>  配置声明的 LLM 命令集（逗号分隔，缺省 `claude`）——AC140-4 判定读此集合，
//                         ⛔ 不靠 `base === "claude"` 字面量。后续 AC140-2 移到 .quay/config.yml。
//   --round-log <path>    轮记录文件（缺省 <root>/.quay/promotion-round.jsonl）
//   --outcome-log <path>  outcome 记录文件（缺省 <root>/.quay/promotion-outcome.jsonl，AC134）
//   --pid-file <path>     把驱动自身 pid 写到该文件（外部观测 + kill 抓手）
//   --json                每轮向 stdout 打一条 JSON 事件行
// Exit: 0 = 正常（信号停机 / --once / --max-rounds 跑完）；2 = 参数错误。
//
// 复用面（manager-phase-goal ### AC130「可复用面」记，非强制）：splitArgs 复用 worker-driver.ts 的
// 单源实现（⛔ 不复制一份平行版本）；ready-pool-check 的 --apply 心跳路径本身即 A22 已在用的晋升机件。

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";
// AC151：promotion 继承 Layer 0（driver-runtime：profile/liveness）。splitArgs/launchArgv/runLivenessCheck/
// LivenessResult 直接从 Layer 0 import（⛔ 不再经 worker-driver 中转——两 driver 平级继承同一层）。
import { splitArgs, launchArgv, runLivenessCheck, resolveKernelSibling, resolveKernelScriptsDir, registerKindStop, type LivenessResult } from "./driver-runtime.ts";
// AC151：re-export 保持旧 import 面（promotion-driver.test.mjs 等）——两 driver 经同一函数身份
// 证「继承 Layer 0 的 profile/liveness 单一实现」。
export { splitArgs, launchArgv, runLivenessCheck, type LivenessResult } from "./driver-runtime.ts";
// AC150-3：资源门判定 + halt 判定与 worker-driver 共用同一份实现（driver-shared.ts，⛔ 非复制粘贴）。
// AC150-1 资源门（起 fix worker 前经同一 resourceGateCheck 判定）；AC150-2 控制面（运行期 halt =
// 读 .quay/promotion-control.json 单一真相源，⛔ 不再「只能 kill」）。
import { resourceGateCheck, isHalted, PROMOTION_CONTROL_STATE_REL, residentLoopStop } from "./driver-shared.ts";
// AC152：派发前过滤的【可组合谓词列表】单一实现（driver-filters.ts）。promotion 的 fix pass 经
// applyTaskFilters 消费 retryCapNotExhausted / notNeedsHuman（⛔ 不各写一遍 retryState.needsHuman 判定）。
import { applyTaskFilters, makeFilterContext, advanceRetryCap, markNeedsHuman, RETRY_CAP_DEFAULT, syncDevelopToDoc, type RetryState } from "./driver-filters.ts";
// AC155：并发 cap / 轮询间隔的单一真相源（drivers.yml 经 driver-config 加载，⛔ 不各写一份字面量）。
import { defaultDriverConfig, loadDriverConfig, driverCap } from "./driver-config.ts";
// AC153：核心不变式单一实现（「⛔ 不信执行者自述，用独立量复核」）。AC133 重闸验证（computeReverifyOutcome）
// 消费它——worker 的 computeLandingState 与本文件的重闸判定共用同一份三态映射（⛔ 不各写一遍）。
import { verifyIndependently } from "./driver-result.ts";
// AC153：re-export verifyIndependently 值——测试用「同一函数身份」证两 driver 共用单一实现（⛔ 非平行副本）。
export { verifyIndependently } from "./driver-result.ts";

/** round 记录的仓库相对路径（gitignored 运行时日志，worker-outcome.jsonl 同族）。 */
export const ROUND_LOG_REL = ".quay/promotion-round.jsonl";

/** outcome 记录的仓库相对路径（gitignored 运行时日志，worker-outcome.jsonl 同族，AC134：判定/晋升/修复
 *  各一条，outer 可消费）。 */
export const OUTCOME_LOG_REL = ".quay/promotion-outcome.jsonl";

/** 轮间隔缺省（毫秒）。AC130 判据不设数值阈值（硬规则 4）——此值只是「机械心跳」的占位节奏。
 *  AC155：值从 driver-config 的声明式配置（drivers.yml）派生（单一真相源）；生产由 --interval 覆盖，
 *  测试传小值。 */
export const INTERVAL_MS_DEFAULT = defaultDriverConfig().promotion.intervalMs;

// 并发 cap 缺省。AC155：值从 driver-config 的声明式配置（drivers.yml）派生（单一真相源——⛔ 本文件
// 不再有独立的并发字面量）。生产由 --cap 覆盖；AC48 后 cap 不闸晋升，缺省 5 避免 cap-3 回退的 floor 假象。
export const CAP_DEFAULT = defaultDriverConfig().promotion.cap;

/** AC133 失败上限缺省：同一任务连续修 N 次仍不合格 ⇒ 标 needs-human。与 fan-in 侧 attempt>=3 同值
 *  （gap-fan-in-relaunch-retry-cap），非新设数值阈值——仅作「未传 --max-fix-retries」的手动/测试回退。
 *  单一真相源 = driver-filters.ts 的 RETRY_CAP_DEFAULT（worker-driver 同值共享，⛔ 不各写一遍 3）。 */
export const MAX_FIX_RETRIES_DEFAULT = RETRY_CAP_DEFAULT;

/** ready-pool-check 单轮的 wall-clock 上限（spawnSync timeout，毫秒）。 */
export const ROUND_TIMEOUT_MS = 180_000;

/** fix worker spawn 的 wall-clock 上限【缺省】（spawnSync timeout，毫秒）。
 *
 *  ⛔ 已与 `ROUND_TIMEOUT_MS` 解耦（gap-fix-worker-timeout-budget-inherited-from-mechanical-round）。
 *  两者约束的是成本结构不同的对象：`ROUND_TIMEOUT_MS` 约束 `ready-pool-check`——一个零 LLM 的
 *  机械脚本；`FIX_WORKER_TIMEOUT_MS` 约束一次 `claude -p` **agent** 调用。
 *
 *  历史（错，此处原写 = ROUND_TIMEOUT_MS 同值 180_000，理由记作「硬规则 4 推论」）：那条推论要求的是
 *  「**先分解成本**再谈指标」，把它执行成「复用一个为**别的对象**测过的数」正好是它的反面——
 *  ⛔ 不分解就借数，与不分解就设数，是同一种错。实证（`.quay/promotion-round.jsonl`，修复后窗口
 *  2026-09-08T22:51:03Z→2026-09-14T08:03:14Z，32 条带 `durationMs` 的 fix 记录，32/32 argv 带
 *  `BG_WAIT_CEILING` 键 ⇒ 是干净窗口）：干净返回仅 **11**、超时 **21**（全部截断在 ~180.4s）；
 *  干净返回时长 63.7→173.0s **连续铺满并顶住上限**——这是阈值切过连续分布中部的形状，不是双峰。
 *  同族直接量对照：真正的 ready→done worker（同为 claude agent）墙钟中位 **1687s**。
 *
 *  缺省 600_000 是【刻意宽松值，⛔ 不是收敛后的值】：180s 那道截断已把分布右尾切掉，现有中位
 *  149s 是【幸存者的中位】而非真分布的中位 ⇒ 先放宽拿到**未截断**分布，之后才谈收敛（同推论）。
 *  可覆盖（见 `resolveFixWorkerTimeoutMs`）：CLI `--fix-worker-timeout-ms` > env
 *  `QUAY_FIX_WORKER_TIMEOUT_MS` > 本缺省——⛔ 不再「换机器/换模型/换 prompt 规模只能改代码」。 */
export const FIX_WORKER_TIMEOUT_MS = 600_000;

/** 覆盖 fix worker 超时预算的 env 键（缺省之上的声明式覆盖路径：换机器/换模型/换 prompt 规模时
 *  改环境即可，⛔ 不改代码）。 */
export const FIX_WORKER_TIMEOUT_ENV = "QUAY_FIX_WORKER_TIMEOUT_MS";

/** 解析 fix worker 超时预算。优先级：explicit（CLI `--fix-worker-timeout-ms`）> env > 缺省。
 *  返回 source 使「这条读数从哪来」可判（取值面三态：cli / env / default）——⛔ 不把三者折叠成
 *  一个数字后无法区分。
 *  非正整数 / 非有限数 ⇒ `{ok:false}`（fail-closed：读不懂的输入不得静默回退成缺省值，硬规则 3b
 *  ——「没配」与「配错了」动作不同，前者用缺省、后者拒启动）。 */
export function resolveFixWorkerTimeoutMs(
  explicit?: string | number | null,
  env: Record<string, string | undefined> = process.env,
): { ok: true; value: number; source: "cli" | "env" | "default" } | { ok: false; error: string } {
  const parse = (raw: string, label: string): { ok: true; value: number } | { ok: false; error: string } => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, error: `invalid ${label}: ${raw} (expected a positive integer of milliseconds)` };
    return { ok: true, value: n };
  };
  if (explicit !== undefined && explicit !== null && String(explicit).trim() !== "") {
    const p = parse(String(explicit), "--fix-worker-timeout-ms");
    return p.ok ? { ok: true, value: p.value, source: "cli" } : p;
  }
  const rawEnv = env[FIX_WORKER_TIMEOUT_ENV];
  if (rawEnv !== undefined && String(rawEnv).trim() !== "") {
    const p = parse(String(rawEnv), FIX_WORKER_TIMEOUT_ENV);
    return p.ok ? { ok: true, value: p.value, source: "env" } : p;
  }
  return { ok: true, value: FIX_WORKER_TIMEOUT_MS, source: "default" };
}

/** 配置声明的 LLM 命令集缺省（AC140-4：判定读集合，⛔ 不靠 `base === "claude"` 字面量）。
 *  形态先落缺省 ["claude"]；后续 AC140-2 把集做成 .quay/config.yml 可配（wrapper 如 claude-fjdac）。 */
export const LLM_COMMAND_SET_DEFAULT: readonly string[] = ["claude"];

// ── 纯函数（可单测） ───────────────────────────────────────────────────────────────────────────────

/** 缺省 ready-pool-check 命令（全池 + --apply 落地晋升）。输出须为 analyzeTasks JSON。
 *  脚本路径锚在本 kernel 自身安装位置（resolveKernelSibling，⛔ 非 root —— gap-promotion-driver-
 *  ready-pool-check-path-third-party：quay-init 后的第三方项目没有 plugin/scripts/，锚在 root 会
 *  `Cannot find module` exit 1 ⇒ 永不晋升）。与 Layer 0 defaultReadyPoolArgv 同一解析器：原始 .ts
 *  （dev tree，带 --experimental-strip-types）或 bundled dist/ready-pool-check.js（installed，不带
 *  flag）。两者都不在 ⇒ 回退 kernelScriptsDir/ready-pool-check.ts（spawn 时 fail-closed，⛔ 不伪装
 *  成「无候选」）。 */
export function defaultPromotionCheckArgv(root: string, cap: number): string[] {
  const sibling = resolveKernelSibling("ready-pool-check.ts");
  const scriptArgs = sibling
    ? (sibling.stripTypes ? ["--experimental-strip-types", sibling.path] : [sibling.path])
    : ["--experimental-strip-types", path.join(resolveKernelScriptsDir(), "ready-pool-check.ts")];
  return [
    "node", ...scriptArgs,
    "--root", root, "--cap", String(cap), "--apply", "--json",
  ];
}

/** 单轮判定结果。promotedIds = 闸判定「合格应晋」的候选 id；applied = 闸实际落地的晋升（含
 *  deliveryCritical 标签同现判定）。error 非空 ⇒ 本轮读不懂（fail-closed，⛔ 不得伪装成无候选）。
 *  promotePathLlmInvoked = 本轮【晋升路径】是否调用过 LLM（AC131：晋升路径 = 机械 ready-pool-check ⇒ false；
 *  派生自真实 argv，⛔ 不硬编码 false，使「该路径零 LLM」成为可取假的测量——硬规则 4）。
 *  ⛔ 字段名收窄（AC140-4 附带要求）：它只覆盖晋升路径（ready-pool-check 的 argv），AC132 的 fix worker
 *  spawn 不进它（在 fixes[].spawned=true 上可见）——故命名为路径限定，⛔ 不再叫宽泛的 llm_invoked。 */
export interface PromotionRound {
  ok: boolean;
  error: string | null;
  pool: number | null;
  shouldApply: boolean;
  promotedIds: string[];
  applied: Array<{ id: string; ok: boolean; from: string | null; to: string | null; deliveryCritical: boolean; reason: string | null; committed: boolean }>;
  promotePathLlmInvoked: boolean;
  fixDecisions: FixDecision[];
}

/** 判定待 spawn 命令是否 LLM 调用——由【配置声明的 LLM 命令集】判定（AC140-4：⛔ 不靠
 *  `base === "claude"` 字面量）。argv[0] 的 basename 命中集合任一条 ⇒ LLM；缺省集合 ["claude"]
 *  （后续 AC140-2 可配 wrapper，如 claude-fjdac）。AC131：晋升路径 spawn 的是 ready-pool-check
 *  （argv[0]=node）⇒ promotePathLlmInvoked=false；若命令换成集合内的 LLM CLI ⇒ true。派生自真实 argv
 *  （⛔ 不硬编码 false），使「该路径零 LLM」成为可取假的测量（硬规则 4）。 */
export function isLlmInvocation(argv: string[], llmCommandSet: readonly string[] = LLM_COMMAND_SET_DEFAULT): boolean {
  const argv0 = Array.isArray(argv) && argv.length > 0 ? String(argv[0]) : "";
  const base = path.basename(argv0);
  return (llmCommandSet ?? LLM_COMMAND_SET_DEFAULT).includes(base);
}

// ── AC132：fix worker（不合格者 → 短命 fix worker，输入 = 任务 id + 闸的结构化 missing 清单） ───────────

/** 闸 candidate 上用于 A24 分类的结构化判据字段（ready-pool-check 的 candidates[] 条目同构子集）。 */
export interface CandidateChecks {
  id: string;
  fourArtifacts: boolean;
  missingArtifacts: string[];
  selfTouchOk: boolean;
  touchesResolve: boolean;
  touchesNarrow: boolean;
  wideTouches: string[];
  depsReady: boolean;
  retiredMechanism: boolean;
  superseded: boolean;
  compound: boolean;
  prosePrereqGap: string[];
  // EXECUTOR-UNSATISFIABLE AC, UNANNOTATED (gap-promotion-driver-blind-to-unsatisfiable-ac-block): the
  // gate's three-valued reading ({evaluated,status,hits}) of unchecked AC/DoD items whose OWN text
  // declares the executor structurally cannot satisfy them. Carried through so the driver's ledger can
  // NAME the offending item (⛔ the old `detail:"ineligible-not-fixed"` constant named nothing) and so
  // this class — which can NEVER spawn a fix worker — can reach an escalation. Optional: an older gate
  // output (field absent) reads `not-evaluated` (硬规则 6 — 缺值 = 未查), never silently `clean`.
  unsatisfiableUnannotatedAc?: { evaluated: boolean; status: string; hits: string[] };
  // BODY-FRESHNESS (gap-ready-pool-body-still-read-from-stale-main-checkout): `false` ⇒ the gate's
  // body-derived checks above were computed from a read source measurably behind the write face.
  // Optional so an older gate output (field absent) keeps the pre-change behavior (`undefined` is
  // NOT `false` — 缺值 = 未查, 硬规则 6: absent is never read as a positive).
  bodyEvaluated?: boolean;
  bodyFreshness?: string;
}

/** A24 分类结果。fixable = 可修三类之一且【无】不可修五类 ⇒ 该 spawn fix worker；
 *  missing = 结构化可修缺项标识（prompt 输入）；unfixable = 不可修五类的结构化原因（逐条记、不修）。
 *  notEvaluated = 第三态（gap-ready-pool-body-still-read-from-stale-main-checkout）：闸的读源落后于
 *  写面 ⇒ 上面那些 body 维度的判定【未被评估】，⛔ 既不 spawn fix worker 也不计入失败上限——
 *  派 worker 去修一个只存在于陈旧副本里的"缺陷"，正是 2026-09-14 烧满三次重试翻 needs-human 的形状。 */
export interface FixDecision {
  id: string;
  fixable: boolean;
  missing: string[];
  unfixable: string[];
  prompt: string | null;
  notEvaluated?: boolean;
  /** EXECUTOR-UNSATISFIABLE AC tri-state (硬规则 3b/6): `"hit"` blocks AND escalates, `"clean"` is the
   *  qualified reading, `"not-evaluated"` (no AC/DoD section, OR the field absent in an older gate
   *  output) is DISTINCT from both — ⛔ never folded into `"clean"`. */
  unsatisfiableAcStatus: "hit" | "clean" | "not-evaluated";
  /** The offending AC/DoD item texts verbatim (empty unless status === "hit"); names WHICH item blocked. */
  unsatisfiableHits: string[];
}

/** FixDecision 是否属于「结构上不可派」的一类：被判拦截、但没有任何可修项 ⇒ fixable=false 且本类
 *  永不 spawn fix worker。这正是 gap-promotion-driver-blind-to-unsatisfiable-ac-block 的空转面——
 *  旧升级路径（`if (fixedIds.length > 0)` 后的 advanceRetryCap）对它结构上不可达。 */
export function isStructuralBlock(d: Pick<FixDecision, "fixable" | "unsatisfiableAcStatus">): boolean {
  return !d.fixable && d.unsatisfiableAcStatus === "hit";
}

/** A24 可修三类 → 结构化缺项标识；不可修五类 → 结构化原因。⛔ 不重新设计分类——
 *  沿用 orchestrator-tick-core.md:48 的 A24 现行分类（manager-phase-goal ### AC132 指明）。
 *  可修三类：fourArtifacts=false（补 missingArtifacts 缺失段）· selfTouchOk=false（补自身 tasks/<id>.md
 *  进 ## Touches）· touchesResolve=false（Touches 写错 ⇒ 改对）。不可修五类：depsReady=false ·
 *  retiredMechanism · superseded · compound · prosePrereqGap 非空。 */
export function classifyCandidate(c: CandidateChecks): FixDecision {
  // BODY-FRESHNESS THIRD STATE — judged BEFORE the A24 classes, and deliberately not merged into
  // them (硬规则 3b: an "I could not evaluate this" value must not share a shape with a verdict).
  // 2026-09-14 replay: the gate read a body the write face had already replaced, reported
  // `touchesResolve=false`, and the fix worker was dispatched for a defect that did not exist in the
  // current body — it could not fix it (it was not there), timed out, and three rounds of that
  // flipped the task needs-human. The fix worker is the harm, so the consumer must refuse it here.
  if (c.bodyEvaluated === false) {
    return {
      id: c.id,
      fixable: false,
      missing: [],
      notEvaluated: true,
      unfixable: [`bodyNotEvaluated=true freshness=${c.bodyFreshness ?? "unknown"} (闸读源落后写面 ⇒ 该体未被评估,⛔ 不派 fix worker)`],
      // The body was not evaluated ⇒ the AC reading computed on it is unvouched-for too. `not-evaluated`
      // (⛔ NOT `clean`): it shares the third state's shape, never the qualified one (硬规则 3b).
      unsatisfiableAcStatus: "not-evaluated",
      unsatisfiableHits: [],
      prompt: null,
    };
  }
  // EXECUTOR-UNSATISFIABLE AC, UNANNOTATED — computed up front (before the A24 classes) so it is
  // available to both the body-freshness early return above and the reason string below. 硬规则 3b/6:
  // an explicit `evaluated:false` (no AC/DoD section) OR the field absent in an older gate output is
  // `not-evaluated` — a value DISTINCT from `clean` (⛔ never folded into the qualified reading).
  const unsat = c.unsatisfiableUnannotatedAc;
  const unsatisfiableAcStatus: "hit" | "clean" | "not-evaluated" =
    unsat && unsat.evaluated === true
      ? (Array.isArray(unsat.hits) && unsat.hits.length > 0 ? "hit" : "clean")
      : "not-evaluated";
  const unsatisfiableHits = unsatisfiableAcStatus === "hit" ? unsat.hits.map(String) : [];
  const missing: string[] = [];
  if (!c.fourArtifacts) missing.push(`fourArtifacts=false missing=[${(c.missingArtifacts || []).join(",")}]`);
  if (!c.selfTouchOk) missing.push("selfTouchOk=false");
  if (!c.touchesResolve) missing.push("touchesResolve=false");
  if (c.touchesNarrow === false) missing.push(`touchesNarrow=false wideTouches=[${(c.wideTouches || []).join(",")}]`);
  const unfixable: string[] = [];
  if (!c.depsReady) unfixable.push("depsReady=false");
  if (c.retiredMechanism) unfixable.push("retiredMechanism=true");
  if (c.superseded) unfixable.push("superseded=true");
  if (c.compound) unfixable.push("compound=true");
  if (c.prosePrereqGap && c.prosePrereqGap.length > 0) unfixable.push(`prosePrereqGap=[${c.prosePrereqGap.join(",")}]`);
  // EXECUTOR-UNSATISFIABLE AC, UNANNOTATED (gap-promotion-driver-blind-to-unsatisfiable-ac-block): a
  // hit is NON-fixable — the fix is a HUMAN/AUTHORING rewrite (rewrite the AC, or annotate it
  // `（待外部）`), and ⛔ a worker must never self-annotate its own AC. So it lands in `unfixable` (no
  // fix worker) and the reason string NAMES the offending item text verbatim — the same string the
  // skip ledger writes as `result.detail` (⛔ no longer the information-free `ineligible-not-fixed`).
  if (unsatisfiableAcStatus === "hit") {
    unfixable.push(`unsatisfiableUnannotatedAc=[${unsatisfiableHits.join(" | ")}]`);
  }
  // 只有可修三类、且无任何不可修五类 ⇒ 值得 spawn（否则修了也晋不了，不可修原因才是真阻碍）。
  const fixable = missing.length > 0 && unfixable.length === 0;
  const prompt = fixable ? buildFixWorkerPrompt(c.id, missing) : null;
  return { id: c.id, fixable, missing, unfixable, prompt, unsatisfiableAcStatus, unsatisfiableHits };
}

/** Plan 4 (gap-prose-prereq-negation-blind-and-paragraph-scoped)：prosePrereqGap 的【轮级指名读数】。
 *  在此之前，被 prose-prereq 卡住的任务只以 `fixes[].unfixable` 里的 `prosePrereqGap=[…]` 一条
 *  字符串存在——一个要先知道去看、再展开一层才看得到的嵌套字段；与此同时 `quay task check` 报
 *  `ok:true`、池读数正常。实测两个样本正是这样静默卡在 todo（其一还是全套件确定性红的唯一修复）。
 *  本函数把它提升为轮记录的顶层字段，指名【任务 id + 被引用的 id 清单】，一次读
 *  promotion-round.jsonl 即可回答「谁卡在散文前置上、卡在哪些 id 上」。
 *  派生自本轮已有的 `fixes[]`（⛔ 不第二次解析池 JSON——单一来源，无漂移）。 */
export function prosePrereqGapReading(
  fixes: Array<{ id: string; unfixable?: string[] }>,
): Array<{ id: string; refs: string[] }> {
  const out: Array<{ id: string; refs: string[] }> = [];
  for (const f of fixes) {
    const hit = (f.unfixable ?? []).find((u) => typeof u === "string" && u.startsWith("prosePrereqGap=["));
    if (!hit) continue;
    const refs = hit
      .slice("prosePrereqGap=[".length, -1)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    out.push({ id: f.id, refs });
  }
  return out;
}

/** fix worker prompt = 任务 id + 闸的结构化 missing 清单（⛔ 非「你去看看哪儿不对」散文指令）。
 *  AC2 能取假：prompt 必须含结构化的缺项标识（如 `fourArtifacts=false missing=[DoD]`）；
 *  若 prompt 只有任务 id 而无缺项清单 ⇒ 本条为假。 */
export function buildFixWorkerPrompt(id: string, missing: string[]): string {
  const list = missing.map((m) => `  - ${m}`).join("\n");
  return [
    "You are a fix worker in the quay repo. Fix the todo task so it passes the promotion gate (ready-pool-check).",
    `task_id=${id}`,
    "structured_missing:",
    list,
    "Fix ONLY the structured_missing items above; change nothing else.",
  ].join("\n");
}

/** fix worker argv = launchArgv("fix-worker", <prompt>)（短命，launcher/model/--bare 由
 *  `.quay/profiles.yml` 的 profiles/roles 承载——AC140-2 可配，单一构造 launchArgv 经 L2 policy 解析）。--fix-worker-cmd 覆盖
 *  可执行【前缀】时把 prompt 作为末参数追加（测试缝捕获真实 prompt，AC2 取假实测——prompt 是数据、
 *  不是可执行串）。 */
export function buildFixWorkerArgv(id: string, missing: string[], root: string, fixWorkerCmd?: string | null): string[] {
  const prompt = buildFixWorkerPrompt(id, missing);
  if (fixWorkerCmd != null) {
    const prefix = splitArgs(fixWorkerCmd);
    if (prefix.length === 0) return launchArgv("fix-worker", prompt, root);
    return [...prefix, prompt];
  }
  return launchArgv("fix-worker", prompt, root);
}

/** spawn 一个短命 fix worker 的结果（AC142 诊断面：stdout/stderr/timedOut 落进可查载体，spawn 失败
 *  不再零诊断信息——对照 gap-fix-worker-spawn-zero-diagnostic-info 的 10 条 `spawned exit=1` 无 stderr）。
 *  gap-fix-worker-spawn-timeout-persists-post-fix AC4：补 argv + durationMs——失败记录可 grep 到
 *  「命令 + 耗时 + 退出码」三项，诊断不再只能靠人当场复现。 */
export interface FixWorkerSpawnResult {
  exitCode: number | null;
  error: string | null;
  stdout: string | null;
  stderr: string | null;
  timedOut: boolean;
  /** AC4 诊断面：spawn 的完整 argv（命令 + 参数，含 --model / --settings / prompt）。 */
  argv: string[] | null;
  /** AC4 诊断面：spawn 的墙钟耗时（毫秒，Date.now 差值）。spawnSync 超时 ⇒ ≈ timeoutMs。 */
  durationMs: number | null;
}

/** spawn 一个短命 fix worker（claude -p，或 --fix-worker-cmd 覆盖前缀），同步等待其退出。
 *  捕获 stdout/stderr + timeout（AC142 AC1：对照 runPromotionRound 的 stdio:["ignore","pipe","ignore"]
 *  + ROUND_TIMEOUT_MS）。返回退出码 / spawn 错误 / 捕获面。AC132：spawn 即达成；⛔ 不验证修没修好
 *  （AC133），⛔ 不信 worker 自述。 */
export function spawnFixWorker(argv: string[], root: string, timeoutMs: number = FIX_WORKER_TIMEOUT_MS): FixWorkerSpawnResult {
  // 调用方若显式传 timeoutMs（经 resolveFixWorkerTimeoutMs 解析出的预算）⇒ 用它；缺省 ⇒ 常量。
  // ⛔ 本函数的第三参数此前【全仓库无一调用方传值】——那使 FIX_WORKER_TIMEOUT_MS 事实上不可覆盖。
  if (!Array.isArray(argv) || argv.length === 0) {
    return { exitCode: null, error: "empty fix-worker argv", stdout: null, stderr: null, timedOut: false, argv: null, durationMs: null };
  }
  const startMs = Date.now();
  try {
    const r = spawnSync(argv[0], argv.slice(1), {
      cwd: root, encoding: "utf8", timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const durationMs = Date.now() - startMs;
    const stdout = String(r.stdout ?? "").trim() || null;
    const stderr = String(r.stderr ?? "").trim() || null;
    const timedOut = !!(r.error && (r.error as { code?: string }).code === "ETIMEDOUT");
    if (r.error) return { exitCode: null, error: String(r.error.message || r.error), stdout, stderr, timedOut, argv, durationMs };
    return { exitCode: r.status, error: null, stdout, stderr, timedOut, argv, durationMs };
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
    return { exitCode: null, error: msg, stdout: null, stderr: null, timedOut: false, argv, durationMs: Date.now() - startMs };
  }
}

/** 跑一轮：调 ready-pool-check（缺省 --apply 全池），解析 analyzeTasks JSON。解析失败/非零退出 ⇒
 *  fail-closed（ok:false + error），⛔ 不把「读不懂」与「无候选」混为一谈（硬规则 3b）。
 *  llmCommandSet = 配置声明的 LLM 命令集（AC140-4：promote_path_llm_invoked 判定读此集合，⛔ 不靠 claude 字面量）。 */
export function runPromotionRound(root: string, cmd: string[] | null, cap: number, llmCommandSet: readonly string[] = LLM_COMMAND_SET_DEFAULT): PromotionRound {
  const argv = cmd ?? defaultPromotionCheckArgv(root, cap);
  const promotePathLlmInvoked = isLlmInvocation(argv, llmCommandSet);
  let r: ReturnType<typeof spawnSync>;
  try {
    r = spawnSync(argv[0], argv.slice(1), {
      encoding: "utf8", timeout: ROUND_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
    return { ok: false, error: `ready-pool-check spawn failed (${msg})`, pool: null, shouldApply: false, promotedIds: [], applied: [], promotePathLlmInvoked, fixDecisions: [] };
  }
  if (r.error || r.status !== 0) {
    const msg = r.error ? String(r.error.message || r.error) : `ready-pool-check exited ${r.status}`;
    return { ok: false, error: msg, pool: null, shouldApply: false, promotedIds: [], applied: [], promotePathLlmInvoked, fixDecisions: [] };
  }
  try {
    const j = JSON.parse(String(r.stdout ?? "").trim());
    const promotions = Array.isArray(j.promotions) ? j.promotions : [];
    const promotedIds = promotions
      .map((p) => (p && typeof p === "object" && "id" in p ? String(p.id) : String(p)))
      .filter(Boolean);
    const appliedRaw = Array.isArray(j.applied_promotions) ? j.applied_promotions : [];
    const applied = appliedRaw
      .map((a) => ({
        id: a && typeof a === "object" && "id" in a ? String(a.id) : null,
        ok: !!(a && a.ok),
        from: a && typeof a === "object" && "from" in a ? a.from : null,
        to: a && typeof a === "object" && "to" in a ? a.to : null,
        deliveryCritical: !!(a && a.deliveryCritical),
        // MULTI-PATH TOUCHES GUARD (gap-promotion-driver-commit-bypasses-precommit-touches-guard):
        // surface the block reason + commit outcome so a blocked (ok:false) promotion is NOT silent in
        // the round/outcome ledger (the raw ready-pool-check JSON carries them; the driver re-map used
        // to drop both).
        reason: a && typeof a === "object" && "reason" in a && a.reason != null ? String(a.reason) : null,
        committed: !!(a && a.committed),
      }))
      .filter((a) => a.id);
    // AC132：读 candidates[] 里 eligible=false 的条目，按 A24 分类成 fixDecisions（可修三类 spawn /
    // 不可修五类记原因）。eligible=false 才是「判定不合格」——candidates[] 含合格与不合格两类。
    const candidatesRaw = Array.isArray(j.candidates) ? j.candidates : [];
    const fixDecisions = candidatesRaw
      .filter((c) => c && typeof c === "object" && "id" in c && c.eligible === false)
      .map((c) =>
        classifyCandidate({
          id: String(c.id),
          fourArtifacts: !!c.fourArtifacts,
          missingArtifacts: Array.isArray(c.missingArtifacts) ? c.missingArtifacts.map(String) : [],
          selfTouchOk: !!c.selfTouchOk,
          touchesResolve: !!c.touchesResolve,
          touchesNarrow: c.touchesNarrow !== false,
          wideTouches: Array.isArray(c.wideTouches) ? c.wideTouches.map(String) : [],
          depsReady: !!c.depsReady,
          retiredMechanism: !!c.retiredMechanism,
          superseded: !!c.superseded,
          compound: !!c.compound,
          prosePrereqGap: Array.isArray(c.prosePrereqGap) ? c.prosePrereqGap.map(String) : [],
          // EXECUTOR-UNSATISFIABLE AC, UNANNOTATED (gap-promotion-driver-blind-to-unsatisfiable-ac-block):
          // pass the gate's three-valued reading THROUGH to classifyCandidate. A MISSING field (older
          // gate output) ⇒ `undefined` (not-evaluated downstream, 硬规则 6), ⛔ never coerced to a hit
          // or to `clean`. `hits` items are stringified verbatim so the ledger names the offending item.
          unsatisfiableUnannotatedAc:
            c.unsatisfiableUnannotatedAc && typeof c.unsatisfiableUnannotatedAc === "object"
              ? {
                  evaluated: c.unsatisfiableUnannotatedAc.evaluated === true,
                  status: typeof c.unsatisfiableUnannotatedAc.status === "string" ? c.unsatisfiableUnannotatedAc.status : "not-evaluated",
                  hits: Array.isArray(c.unsatisfiableUnannotatedAc.hits) ? c.unsatisfiableUnannotatedAc.hits.map(String) : [],
                }
              : undefined,
          // BODY-FRESHNESS: `undefined` (an older gate output without the field) must NOT read as
          // `false` — 缺值 = 未查 (硬规则 6). Only an explicit `false` marks the third state.
          bodyEvaluated: c.bodyEvaluated === false ? false : true,
          bodyFreshness: typeof c.bodyFreshness === "string" ? c.bodyFreshness : undefined,
        }),
      );
    return {
      ok: true, error: null,
      pool: typeof j.pool === "number" ? j.pool : null,
      shouldApply: !!j.should_apply,
      promotedIds, applied,
      promotePathLlmInvoked,
      fixDecisions,
    };
  } catch {
    return { ok: false, error: "unparseable ready-pool-check output", pool: null, shouldApply: false, promotedIds: [], applied: [], promotePathLlmInvoked, fixDecisions: [] };
  }
}

/** 一条结构化 round 记录（字段：ts · round · run_id · pid · action · pool · should_apply ·
 *  promoted_ids · applied · error · promote_path_llm_invoked · fixes · prose_prereq_gap）。action ∈ promote|fix|none|error。
 *  promote_path_llm_invoked 在晋升路径上为 false（机械 ready-pool-check，AC131）；AC132 的 fix worker 是
 *  `claude -p`（argv[0]=claude），其 spawn 在 fixes[].spawned=true 上可见。
 *  prose_prereq_gap（Plan 4）把散文前置缺边【指名】提升到顶层——见 prosePrereqGapReading。 */
export interface FixOutcome {
  id: string;
  spawned: boolean;
  missing: string[];
  unfixable: string[];
  exitCode: number | null;
  /** AC142 诊断面：fix worker 的 stderr（spawn 失败/认证失败可诊断——⛔ 不再零诊断信息）。 */
  stderr: string | null;
  /** AC142 诊断面：fix worker 是否超时（spawnSync timeout ETIMEDOUT）。 */
  timedOut: boolean;
  /** gap-fix-worker-spawn-timeout-persists-post-fix AC4：spawn 的完整 argv（失败记录可 grep 命令）。 */
  argv: string[] | null;
  /** gap-fix-worker-spawn-timeout-persists-post-fix AC4：spawn 的墙钟耗时（毫秒）。 */
  durationMs: number | null;
  /** BODY-FRESHNESS (gap-ready-pool-body-still-read-from-stale-main-checkout)：本条是【未评估】态——
   *  闸读源落后写面 ⇒ 未派 worker、未计入失败上限、也不得记为「仍不合格」。与 spawned:false 的
   *  其它原因（不可修五类）可区分。 */
  notEvaluated?: boolean;
}

export function computeRoundRecord(opts: {
  round: number;
  runId: string;
  pid: number;
  at: string;
  pool: number | null;
  shouldApply: boolean;
  promotedIds: string[];
  applied: PromotionRound["applied"];
  error: string | null;
  promotePathLlmInvoked: boolean;
  fixes: FixOutcome[];
  reverify?: ReverifyOutcome | null;
  needsHuman?: Array<{ id: string; ok: boolean; committed: boolean; reason: string }>;
  /** AC150-2：本轮是否因控制态 halted 而停（true ⇒ 未跑 ready-pool-check、未 spawn fix worker）。 */
  halted?: boolean;
  /** AC150-1：本轮资源门判定（起 fix worker 前读；WAIT ⇒ 退避、fixes 为空）。 */
  gate?: { go: boolean; reason: string | null } | null;
  liveness?: LivenessResult | null;
  /** gap-fix-worker-timeout-budget-inherited-from-mechanical-round：本轮实际使用的 fix worker 预算
   *  （毫秒）。落进记录使「这批读数是在哪个预算下产生的」可判——⛔ 否则放宽前/后的记录在载体上
   *  不可区分，AC2/AC3 的「只计落地之后的窗口」就退化成靠时间戳猜。null = 未评估。 */
  fixWorkerTimeoutMs?: number | null;
}) {
  const action = opts.error
    ? "error"
    : opts.halted
      ? "halted"
      : opts.promotedIds.length > 0
        ? "promote"
        : opts.fixes.some((f) => f.spawned)
          ? "fix"
          : "none";
  return {
    ts: opts.at, round: opts.round, run_id: opts.runId, pid: opts.pid, action,
    pool: opts.pool, should_apply: opts.shouldApply, promoted_ids: opts.promotedIds,
    applied: opts.applied, error: opts.error, promote_path_llm_invoked: opts.promotePathLlmInvoked, fixes: opts.fixes,
    // Plan 4：prosePrereqGap 的轮级指名读数（顶层；此前只在 fixes[].unfixable 这一嵌套字符串里）。
    prose_prereq_gap: prosePrereqGapReading(opts.fixes),
    // AC133：重验证结果（null = 本轮无 fix worker 可重验证）与本轮新标 needs-human 的 id 清单。
    reverify: opts.reverify ?? null,
    needs_human: (opts.needsHuman ?? []).map((n) => n.id),
    // gap-mark-needs-human-commit-after-write：needs-human 翻转的 committed 落进 round 记录（同
    // applyPromotions 的 committed——翻转写盘即提交，committed=false 表示 repo-less no-op / 提交失败）。
    needs_human_committed: (opts.needsHuman ?? []).map((n) => ({ id: n.id, committed: n.committed })),
    // AC150：halted（控制态停）与 gate（资源门判定）落进 round 记录，outer 可观测。
    halted: opts.halted ?? false,
    gate: opts.gate ?? null,
    liveness: opts.liveness ?? null,
    // 本轮 fix worker 预算（top-level，grep-able）：使放宽前/后的记录在载体上可区分。
    fix_worker_timeout_ms: opts.fixWorkerTimeoutMs ?? null,
  };
}

/** AC132 的 fix pass：对 fixable 决策 spawn 短命 fix worker；对不可修五类逐条记原因不 spawn。
 *  返回每条的 FixOutcome（可修 ⇒ spawned=true + 结构化 missing；不可修 ⇒ spawned=false + unfixable 原因）。
 *  timeoutMs = 本次 spawn 的 wall-clock 上限（由 `resolveFixWorkerTimeoutMs` 解析；缺省 = 常量）——
 *  ⛔ 本参数的存在正是让 FIX_WORKER_TIMEOUT_MS 成为【可覆盖】而非事实常量。 */
export function runFixPass(
  fixDecisions: FixDecision[],
  root: string,
  fixWorkerCmd: string | null,
  timeoutMs: number = FIX_WORKER_TIMEOUT_MS,
): FixOutcome[] {
  return fixDecisions.map((d) => {
    if (!d.fixable) {
      // The third-state marker is written ONLY when it is true, so every pre-existing no-spawn shape
      // (the five unfixable classes) keeps a byte-identical outcome record — a consumer that
      // deep-compares the record is not disturbed by a field it never asked for.
      return { id: d.id, spawned: false, missing: d.missing, unfixable: d.unfixable, exitCode: null, stderr: null, timedOut: false, argv: null, durationMs: null, ...(d.notEvaluated === true ? { notEvaluated: true } : {}) };
    }
    const argv = buildFixWorkerArgv(d.id, d.missing, root, fixWorkerCmd);
    const { exitCode, stderr, timedOut, argv: spawnedArgv, durationMs } = spawnFixWorker(argv, root, timeoutMs);
    return { id: d.id, spawned: true, missing: d.missing, unfixable: [], exitCode, stderr, timedOut, argv: spawnedArgv, durationMs };
  });
}

// ── AC133：重闸验证 + 失败上限（fix worker 退出后重跑同一个闸，⛔ 不信 worker 自述） ─────────────

/** AC133 重验证结果。fixedIds = 本轮被 spawn 过 fix worker 的任务 id；重跑闸后按【闸的新判定】归类：
 *  nowEligibleIds = 闸判合格（fix 生效，已由 --apply 落地晋升）；stillIneligibleIds = 闸仍判不合格
 *  （fix 未生效，⛔ 不得晋升）；notEvaluatedIds = 无法评估——两个来源共用这一桶：重跑闸 spawn
 *  失败/输出不可解析（读不到输入），或重跑闸判该任务 body 未被评估（读源落后写面，
 *  gap-ready-pool-body-still-read-from-stale-main-checkout）⛔ 不是「仍不合格」也不是「消失」——
 *  AC153 与 verified/failed 分离的第三态，且不计入失败上限。
 *  ⛔ 不信 worker 自述「已修好」——worker 的退出码/自述不作为晋升依据。 */
export interface ReverifyOutcome {
  nowEligibleIds: string[];
  stillIneligibleIds: string[];
  notEvaluatedIds: string[];
}

/** 用重验证轮的闸判定给每个被修任务归类，经 AC153 单一不变式 verifyIndependently 表达三态。
 *  读不到输入（reRound.ok=false ⇒ 闸没跑成/输出不可解析）⇒ 全部 notEvaluatedIds（⛔ 既不是
 *  stillIneligible——那会误计入 AC133 失败上限，也不是静默「neither」——那正是 AC153 要消灭的
 *  「读不懂伪装成既非晋也非否」）；ok=true 时闸判合格（在 promotions）⇒ nowEligible、闸判不合格
 *  （eligible=false）⇒ stillIneligible；两者都不在（任务从 todo 池消失）⇒ 三态词表不承载、不计数
 *  （沿用原行为）。
 *  纯函数，可单测（AC133 AC1/AC2——AC2 取假：worker 声称修好但实际未改 ⇒ 闸仍判不合格 ⇒ stillIneligible）。 */
export function computeReverifyOutcome(fixedIds: string[], reRound: PromotionRound): ReverifyOutcome {
  // 读不到输入（重跑闸没跑成）⇒ 全部 not-evaluated，⛔ 不伪造成「仍不合格」或「合格」。
  if (!reRound.ok) {
    return { nowEligibleIds: [], stillIneligibleIds: [], notEvaluatedIds: [...fixedIds] };
  }
  const promoted = new Set(reRound.promotedIds);
  const stillBad = new Set(reRound.fixDecisions.map((d) => d.id));
  // BODY-FRESHNESS (gap-ready-pool-body-still-read-from-stale-main-checkout)：重跑闸判「未评估」
  // （读源落后写面）⇒ 该 id 归 notEvaluatedIds，⛔ 不进 stillIneligibleIds——否则它会被
  // advanceRetryCap 计入失败上限，而这正是要消灭的形状：worker 无缺陷可修 ⇒ 重跑仍不合格 ⇒ 三次
  // 翻 needs-human。与 `!reRound.ok` 的「读不到输入」共用同一个第三态桶（AC153 的单一不变式）。
  const notEvaluated = new Set(reRound.fixDecisions.filter((d) => d.notEvaluated === true).map((d) => d.id));
  const nowEligibleIds: string[] = [];
  const stillIneligibleIds: string[] = [];
  const notEvaluatedIds: string[] = [];
  for (const id of fixedIds) {
    // vanished（task 不再出现在候选池——被别的 actor 晋升/删除）：三态词表不承载，沿用原行为不计数。
    if (!promoted.has(id) && !stillBad.has(id)) continue;
    if (notEvaluated.has(id)) { notEvaluatedIds.push(id); continue; }
    const res = verifyIndependently(
      {
        value: id,
        verifiedBy: "re-run gate (ready-pool-check) judged eligible (in promotions)",
        failedReason: "re-run gate still judged ineligible (eligible=false)",
        notEvaluatedReason: "unreachable (ok=true and id present in candidates)",
      },
      () => (promoted.has(id) ? true : false),
    );
    if (res.state === "verified") nowEligibleIds.push(id);
    else stillIneligibleIds.push(id);
  }
  return { nowEligibleIds, stillIneligibleIds, notEvaluatedIds };
}

// ── STRUCTURAL-BLOCK ESCALATION (gap-promotion-driver-blind-to-unsatisfiable-ac-block) ──────────────
// A candidate whose ONLY blockers are structural (⛔ no fix worker CAN be spawned — e.g. an unchecked
// AC whose own text declares the executor cannot satisfy it) is intercepted every round, yet it never
// reaches the AC133 escalation above: `fixable=false` ⇒ `fixes[].spawned` false ⇒ `fixedIds` empty ⇒
// `if (fixedIds.length > 0)` never fires ⇒ `advanceRetryCap` never runs ⇒ the task spins FOREVER with
// no escalation and (before this change) an information-free `detail:"ineligible-not-fixed"` ledger.
// This consumes the SAME retry budget through the SAME advanceRetryCap (one source of truth for the
// count/flip semantics), fed the STRUCTURAL ids instead of the reverify-still-ineligible ids. It is
// deliberately placed OUTSIDE the `fixedIds.length > 0` guard (AC2 取假: restoring that guard makes it
// unreachable and the same case goes red). ⛔ It does NOT weaken the gate's fail-closed default and
// gives the worker NO self-annotation path — the blocked task is still intercepted; it is only
// ESCALATED (needs-human, a human/authoring decision) rather than silently retried forever.
export function advanceStructuralBlock(
  state: RetryState,
  blocked: Array<{ id: string; reason: string }>,
  maxRetries: number,
): Array<{ id: string; reason: string }> {
  const newly = new Set(advanceRetryCap(state, blocked.map((b) => b.id), maxRetries));
  return blocked.filter((b) => newly.has(b.id));
}

// AC133 失败上限（RetryState / advanceRetryCap / markNeedsHuman）已上收 driver-filters.ts（单一真相源
// —— worker-driver 也从 exited-not-landed 计数派生同一个 retryExhausted 集合，⛔ 不各写一遍计数/翻转）。
// re-export 保持旧 import 面（promotion-driver.test.mjs 等经同一函数身份 import）。
export { advanceRetryCap, markNeedsHuman, RETRY_CAP_DEFAULT } from "./driver-filters.ts";
export type { RetryState } from "./driver-filters.ts";

/** 把一条 round 记录追加写入文件（pure append，⛔ 不截断不覆盖）。 */
export function appendRoundRecord(file: string, record: ReturnType<typeof computeRoundRecord>): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
  return file;
}

// ── AC134：outcome 台账（判定/晋升/修复各一条，outer 可消费） ─────────────────────────────────────

/** 一条 promotion outcome 记录（AC134：字段 task_id · gate 判定结果（含 missing 清单）· action
 *  （promote/fix/skip/needs-human）· result · ts）。promote = 闸判定合格并落地晋升；fix = 判定不合格且
 *  可修三类（spawn 短命 fix worker）；skip = 判定不合格且不可修五类（逐条记原因不修）；
 *  needs-human = AC133 连续修满上限仍不合格（标 needs-human 停手）。 */
export interface PromotionOutcomeRecord {
  task_id: string;
  gate: { eligible: boolean; missing: string[] };
  action: "promote" | "fix" | "skip" | "needs-human";
  // committed 仅 needs-human 记录携带（gap-mark-needs-human-commit-after-write：翻转写盘即提交）。
  result: { ok: boolean; detail: string | null; committed?: boolean };
  ts: string;
}

/** 从一轮结果推导 outcome 记录（纯函数，可单测）。applied ⇒ promote；fixes[].spawned ⇒ fix；
 *  fixes[] 其余（不可修）⇒ skip；needsHuman ⇒ needs-human（AC133 失败上限触发）。⛔ 派生自真实轮
 *  结果，不硬编码、不写 fixture。
 *  gap-fix-worker-edit-exit-4：fix 的 result.ok 不再 = 裸 exitCode===0。`claude -p` 编辑型任务在
 *  【编辑成功后】可能以 exit=4 退出（stdout/stderr 均空、事后非零），此时 result.ok=false 是失真——
 *  真实落地与否由 AC133 重闸验证（reverify.nowEligibleIds）给出（⛔ 不信 worker 自述，也不信它的退出码）。
 *  传 reverify 时以「闸判 nowEligible」为准；不传（旧调用/纯单测）退回 exitCode===0。 */
export function computeOutcomeRecords(opts: {
  at: string;
  applied: PromotionRound["applied"];
  fixes: FixOutcome[];
  needsHuman?: Array<{ id: string; ok: boolean; committed: boolean; reason: string; detail?: string }>;
  reverify?: ReverifyOutcome | null;
}): PromotionOutcomeRecord[] {
  const out: PromotionOutcomeRecord[] = [];
  for (const a of opts.applied) {
    out.push({
      task_id: a.id,
      gate: { eligible: true, missing: [] },
      action: "promote",
      // MULTI-PATH TOUCHES GUARD (gap-promotion-driver-commit-bypasses-precommit-touches-guard): a
      // blocked (ok:false) promotion must NOT record "promoted" — surface the block reason (e.g.
      // touches-multi-path-bullet) so the ledger is truthful, not a silent "promoted" lie.
      result: {
        ok: a.ok,
        detail: !a.ok
          ? (a.reason ?? "promotion-blocked")
          : (a.from != null && a.to != null ? `${a.from}->${a.to}` : "promoted"),
      },
      ts: opts.at,
    });
  }
  for (const f of opts.fixes) {
    if (f.spawned) {
      // AC142 AC1：诊断面落进可查载体（promotion-outcome.jsonl 的 result.detail）——spawn 失败/超时
      // 时把 stderr 截断带上（⛔ 不再 `spawned exit=1` 零诊断）。exit 0 保持原形（无诊断需求）。
      const stderrFrag = f.stderr ? ` stderr=${f.stderr.slice(0, 300)}` : "";
      // gap-fix-worker-edit-exit-4：落地判定以 AC133 重闸为准（若给了 reverify）；exit-4 这类「编辑
      // 成功但事后非零退出」不再把 result.ok 打成 false。
      const landed = opts.reverify ? opts.reverify.nowEligibleIds.includes(f.id) : f.exitCode === 0;
      const detail = f.exitCode === 0
        ? "spawned exit=0"
        : `spawned exit=${f.exitCode}${f.timedOut ? " (timed-out)" : ""}${stderrFrag}${landed ? " (fix landed — reverified eligible)" : ""}`;
      out.push({
        task_id: f.id,
        gate: { eligible: false, missing: f.missing },
        action: "fix",
        result: { ok: landed, detail },
        ts: opts.at,
      });
    } else {
      out.push({
        task_id: f.id,
        gate: { eligible: false, missing: [...f.missing, ...f.unfixable] },
        action: "skip",
        result: { ok: false, detail: f.unfixable.join(";") || "ineligible-not-fixed" },
        ts: opts.at,
      });
    }
  }
  for (const n of opts.needsHuman ?? []) {
    out.push({
      task_id: n.id,
      gate: { eligible: false, missing: [] },
      action: "needs-human",
      // gap-mark-needs-human-commit-after-write: `committed` 落进 result（同 applyPromotions 的
      // committed）——needs-human 翻转写盘即提交，committed=false 表示 repo-less no-op 或提交失败
      // （可观测非静默）；result.ok 改为 markNeedsHuman 的真实 ok（⛔ 不再硬编码 true）。
      // STRUCTURAL-BLOCK (gap-promotion-driver-blind-to-unsatisfiable-ac-block): an explicit `detail`
      // (naming the blocked AC/DoD item) takes precedence, so a needs-human escalated from a class that
      // never spawned a fix worker does NOT misreport `retry-cap-exhausted`. The retry-cap path keeps
      // its historical constant (⛔ unchanged) since it passes no `detail`.
      result: { ok: n.ok, committed: n.committed, detail: n.detail ?? (n.ok ? "retry-cap-exhausted" : (n.reason ?? "mark-needs-human-failed")) },
      ts: opts.at,
    });
  }
  return out;
}

/** 把一条 outcome 记录追加写入文件（pure append，一行一 JSON，⛔ 不截断不覆盖）。 */
export function appendOutcomeRecord(file: string, record: PromotionOutcomeRecord): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
  return file;
}

/** 解析 --interval。缺省 = drivers.yml 的 interval_ms（root 缺省时回退 INTERVAL_MS_DEFAULT 常量）；
 *  非负有限数才合法。 */
export function parseIntervalMs(raw: string | undefined, root?: string): { ok: true; value: number } | { ok: false; error: string } {
  if (raw === undefined) {
    return { ok: true, value: root ? loadDriverConfig(root).promotion.intervalMs : INTERVAL_MS_DEFAULT };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: `invalid --interval: ${raw}` };
  return { ok: true, value: n };
}

/** 解析 --cap。缺省 = drivers.yml 的 cap（单一真相源；root 缺省时回退 CAP_DEFAULT 常量）；正整数才合法。 */
export function resolveCap(raw: string | undefined, root?: string): { ok: true; value: number } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: root ? driverCap(root, "promotion") : CAP_DEFAULT };
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, error: `invalid --cap: ${raw}` };
  return { ok: true, value: n };
}

// ── 常驻循环（AC130 AC1 常驻 + AC2 停机取假） ─────────────────────────────────────────────────────

/** 常驻循环的选项（`main` 装配后传入）。 */
export interface ResidentLoopOptions {
  root: string;
  intervalMs: number;
  cap: number;
  once: boolean;
  maxRounds: number | null;
  maxFixRetries: number;
  readyPoolArgv: string[] | null;
  fixWorkerCmd: string | null;
  /** fix worker spawn 的 wall-clock 上限（毫秒；缺省 = 经 resolveFixWorkerTimeoutMs 解析出的值）。
   *  gap-fix-worker-timeout-budget-inherited-from-mechanical-round：可覆盖（CLI/env），⛔ 不再是常量。 */
  fixWorkerTimeoutMs?: number;
  /** 配置声明的 LLM 命令集（--llm-commands，缺省 LLM_COMMAND_SET_DEFAULT；AC140-4）。 */
  llmCommands: string[];
  roundLogFile: string;
  outcomeLogFile: string;
  runId: string;
  json: boolean;
  pidFile?: string;
  /** AC150-1：覆盖 resource-gate 命令（测试缝；缺省 = 与 worker-driver 同一 resourceGateCheck 缺省）。 */
  resourceGateArgv?: string[] | null;
  /** liveness 检查命令覆盖（测试缝）；null = 用 defaultLivenessCheckArgv(root, "promotion")。 */
  livenessCmd: string[] | null;
}

/**
 * 常驻循环（AC1）：跑一轮不退出，按 --interval 进入下一轮，直到 SIGINT/SIGTERM 或 --once/--max-rounds。
 *  每轮 = runPromotionRound（调 ready-pool-check --apply 全池判定 + 落地晋升）→ runFixPass（可修三类
 *  spawn fix worker）→ AC133 重闸验证（fix worker 退出后重跑同一个闸，⛔ 不信 worker 自述）→
 *  失败上限（连续修满 N 次仍不合格 ⇒ 标 needs-human 停手）→ computeRoundRecord → appendRoundRecord →
 *  （json 时）stdout 事件行。停机由进程信号驱动（⛔ 不读 .halt，单一真相源）。
 */
export async function runResidentPromotionLoop(opts: ResidentLoopOptions): Promise<number> {
  const { root, intervalMs, cap, once, maxRounds, maxFixRetries, readyPoolArgv, roundLogFile, outcomeLogFile, runId, json, pidFile, fixWorkerCmd, llmCommands, resourceGateArgv = null, livenessCmd,
    fixWorkerTimeoutMs = FIX_WORKER_TIMEOUT_MS } = opts;

  if (pidFile) {
    try { fs.writeFileSync(pidFile, `${process.pid}\n`, "utf8"); } catch { /* pid-file 只供外部观测，写失败不致命 */ }
  }

  // Layer 0（driver-shared）：停机标志 + 可唤醒 sleep 单一实现（finding `driver-sleep-requeststop-triple`）。
  // 可被信号唤醒的 sleep：SIGINT/SIGTERM 立即 resolve，本轮结束即退出（⛔ 不杀在飞——单轮是同步的，
  // 不存在「在飞轮」）。
  const stopCtl = residentLoopStop();
  // AC-255（SPEC §7 阶段 C）：停机登记 —— 进程信号仍停本 kind，同时 anchor 可经 `requestKindStop`
  // 只停【这一个】循环（收敛后六个 kind 同进程，`kill -TERM <pid>` 不再能只停一个）。
  registerKindStop("promotion", stopCtl.requestStop);

  let round = 0;
  const retryState: RetryState = { counts: new Map(), needsHuman: new Set() };
  while (!stopCtl.isStopRequested()) {
    round += 1;
    // AC150-2 控制面：起新一轮前读控制态（.quay/promotion-control.json 单一真相源，与 worker-driver
    // 共用同一 isHalted 实现）。halted ⇒ 停止晋升与 fix spawn（记一条 halted round 后退出，⛔ 不再跑
    // ready-pool-check --apply、不再 spawn fix worker）。
    if (isHalted(root, process.env, PROMOTION_CONTROL_STATE_REL)) {
      const haltedRecord = computeRoundRecord({
        round, runId, pid: process.pid, at: new Date().toISOString(),
        pool: null, shouldApply: false, promotedIds: [], applied: [], error: null,
        promotePathLlmInvoked: false, fixes: [], halted: true,
      });
      try { appendRoundRecord(roundLogFile, haltedRecord); } catch { /* 记录写失败不致命（运行时日志） */ }
      if (json) process.stdout.write(`${JSON.stringify({ event: "halted", round })}\n`);
      break;
    }
    // gap-main-manager-doc-doc-only-ff-only-tracking AC4：每轮启动前把主检出（author）快进到
    // develop（机械 ff-only，⛔ 静默 merge-fallback）。主检出落后 develop 时生产跑旧代码（promotion-driver
    // 常驻从主检出工作树加载）——syncDevelopToDoc 是 develop→doc 方向的机械同步单一真相源
    // （driver-filters.ts）：非 ff 报「not-ff」落痕（分叉 guard）、成功亦写 doc-develop-sync-ff-synced
    // 事件（生产载体）。返回值仅供观测（synced/already/not-ff/not-doc/error），不阻断本轮——同步失败
    // ≠ 停摆，分叉消解升级语义兜底归父任务（gap-doc-develop-sync-semantic-conflict-resolution）。
    syncDevelopToDoc(root);
    // liveness 检查（gap-resident-driver-stable-carrier-liveness Finding 的接线）：每轮顺手调一次
    // launch 脚本的 liveness 子命令。supervisor 死后 driver 成孤儿仍在跑 ⇒ 下一轮即检出 supervisor_dead
    // 并让子命令写 DEATH 告警（⛔ 载体停更 ≠ 一切正常）。checked=false（脚本缺失/失败）≠ 健康（硬规则 3b）。
    const liveness = runLivenessCheck(root, "promotion", livenessCmd);
    const r = runPromotionRound(root, readyPoolArgv, cap, llmCommands);
    // AC150-1 资源门：起 fix worker 前经与 worker-driver 同一个 resourceGateCheck 判定（WAIT ⇒ 退避，
    // 本轮不 spawn LLM fix worker）。机械的 ready-pool-check 晋升路径不受资源门约束（零 LLM）。
    const gate = resourceGateCheck(root, resourceGateArgv);
    // AC133 失败上限：已标 needs-human 的任务不再进 fix pass（停止对它的修复循环——与 markNeedsHuman
    // 的 status 翻转双保险，即使 status 写失败也不会再 spawn）。
    // AC152：此过滤消费 driver-filters.ts 的【可组合谓词列表】——promotion 的 fix pass 只取
    // retryCapNotExhausted / notNeedsHuman 两个谓词（⛔ 不各写一遍 retryState.needsHuman 判定）；
    // 其余（deps/touches/in-flight）由 ready-pool-check 的 eligible 已在闸内判定，再滤一遍会丢掉
    // AC134 的 skip 台账（depsReady=false 等 unfixable 原因仍须逐条记 outcome）。
    const activeIds = new Set(applyTaskFilters(
      r.fixDecisions.map((d) => d.id),
      makeFilterContext(root, { inFlight: [], retryExhausted: retryState.needsHuman }),
      ["retryCapNotExhausted", "notNeedsHuman"],
    ));
    const activeDecisions = r.fixDecisions.filter((d) => activeIds.has(d.id));
    // AC132：不合格者 → 短命 fix worker（可修三类 spawn、不可修五类逐条记原因不修）。spawn 前先跑
    // 分类（classifyCandidate 已做），fixDecisions 里 fixable=true 的才 spawn。
    // AC150-1：gate.go=false ⇒ 退避——只退【可修三类的 spawn】（⛔ 不再 spawn LLM fix worker，留待
    // 下轮），不可修五类的 skip 台账零 LLM、不受资源门约束（仍逐条记原因，⛔ 不因 WAIT 丢失可观测性）。
    const fixes = runFixPass(
      gate.go ? activeDecisions : activeDecisions.filter((d) => !d.fixable),
      root,
      fixWorkerCmd,
      fixWorkerTimeoutMs,
    );

    // AC133 AC1：fix worker 退出后【重新调同一个闸】验证，以闸的新判定为准（⛔ 不信 worker 自述）。
    const fixedIds = fixes.filter((f) => f.spawned).map((f) => f.id);
    let reverify: ReverifyOutcome | null = null;
    let rePromotedIds: string[] = [];
    let reApplied: PromotionRound["applied"] = [];
    let newlyNeedsHuman: string[] = [];
    if (fixedIds.length > 0) {
      const re = runPromotionRound(root, readyPoolArgv, cap, llmCommands);
      reverify = computeReverifyOutcome(fixedIds, re);
      // 重验证轮本身也以 --apply 落地晋升（被修好的任务 ⇒ 闸判合格 ⇒ 晋升），并入本轮的晋升面。
      rePromotedIds = re.promotedIds;
      reApplied = re.applied;
      // AC133 AC3：连续修满 N 次仍不合格 ⇒ 标 needs-human（失败上限）。
      newlyNeedsHuman = advanceRetryCap(retryState, reverify.stillIneligibleIds, maxFixRetries);
    }
    // STRUCTURAL-BLOCK ESCALATION (gap-promotion-driver-blind-to-unsatisfiable-ac-block): the class that
    // can never spawn a fix worker (isStructuralBlock) is structurally unreachable from the block above
    // — so escalate it here, OUTSIDE the `fixedIds.length > 0` guard (AC2 取假 restores that guard and
    // the same case goes red). `reason` reuses the SAME string classifyCandidate put in `unfixable` —
    // one source of truth for the name that lands in the skip ledger AND the needs-human record.
    const structuralNeedsHuman = advanceStructuralBlock(
      retryState,
      activeDecisions.filter(isStructuralBlock).map((d) => ({
        id: d.id,
        reason: d.unfixable.find((u) => u.startsWith("unsatisfiableUnannotatedAc=")) ?? `unsatisfiableUnannotatedAc=[${d.unsatisfiableHits.join(" | ")}]`,
      })),
      maxFixRetries,
    );
    // AC133 AC3：连续修满 N 次仍不合格 ⇒ 标 needs-human（失败上限）。markNeedsHuman 写盘即提交
    // （gap-mark-needs-human-commit-after-write），返回 { id, ok, reason, committed }——⛔ 不再丢弃
    // {ok,reason}；committed 落进 round/outcome 记录（同 applyPromotions 的 committed）。
    // STRUCTURAL-BLOCK：reason 点名被拦截的 AC/DoD 项原文（⛔ 不写「修满 N 次」——本类从不 spawn
    // fix worker，那句在此不真），并经 result.detail 落进 outcome 台账（AC2 点名原因）。
    const needsHumanResults = [
      ...newlyNeedsHuman.map((id) =>
        markNeedsHuman(root, id, `连续修满 ${maxFixRetries} 次仍不合格（闸在重验证后仍判不合格）`),
      ),
      ...structuralNeedsHuman.map((b) => {
        const r = markNeedsHuman(root, b.id, `${b.reason}（连续 ${maxFixRetries} 轮被结构上不可派的拦截挡住 ⇒ 作者/人改写；⛔ 不派 fix worker）`);
        return { ...r, detail: r.ok ? r.reason : undefined };
      }),
    ];

    const promotedIds = [...r.promotedIds, ...rePromotedIds];
    const applied = [...r.applied, ...reApplied];
    const record = computeRoundRecord({
      round, runId, pid: process.pid, at: new Date().toISOString(), ...r,
      promotedIds, applied, fixes, reverify, needsHuman: needsHumanResults, gate, liveness,
      fixWorkerTimeoutMs,
    });
    try { appendRoundRecord(roundLogFile, record); } catch { /* 记录写失败不致命（运行时日志，⛔ 不因日志炸循环） */ }
    // AC134：判定/晋升/修复/needs-human 各写一条 outcome 记录（.quay/promotion-outcome.jsonl，outer 可消费）。
    // gap-fix-worker-edit-exit-4：把 AC133 重闸结果 reverify 传给 outcome，fix 的 result.ok 以「闸判落地」为准。
    const outcomes = computeOutcomeRecords({
      at: record.ts, applied, fixes,
      needsHuman: needsHumanResults,
      reverify,
    });
    for (const o of outcomes) {
      try { appendOutcomeRecord(outcomeLogFile, o); } catch { /* 记录写失败不致命（运行时日志，⛔ 不因日志炸循环） */ }
    }
    if (json) process.stdout.write(`${JSON.stringify({ event: "round", ...record })}\n`);
    if (once) break;
    if (maxRounds !== null && round >= maxRounds) break;
    await stopCtl.sleep(intervalMs);
  }

  if (json && stopCtl.isStopRequested()) {
    process.stdout.write(`${JSON.stringify({ event: "stop", reason: "signal", round })}\n`);
  }
  return 0;
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────

const HELP = [
  "promotion-driver — AC130：常驻循环，每轮调 ready-pool-check 取全池判定（--apply 落地合格晋升），",
  "跑完一轮不退出、按 --interval 进入下一轮。SIGINT/SIGTERM 优雅停机。AC132：不合格者 spawn 短命 fix worker。",
  "AC133：fix worker 退出后重跑同一个闸验证（⛔ 不信 worker 自述）+ 连续修满 N 次仍不合格 ⇒ needs-human。",
  "AC134：判定/晋升/修复/needs-human 各写一条 outcome 记录（.quay/promotion-outcome.jsonl）。",
  "  --root <repo> [--interval <ms>] [--cap <n>] [--once] [--max-rounds <n>] [--max-fix-retries <n>]",
  "  [--ready-pool-cmd \"<argv>\"] [--fix-worker-cmd \"<argv>\"] [--fix-worker-timeout-ms <n>] [--llm-commands <csv>] [--round-log <p>] [--outcome-log <p>] [--run-id <id>] [--pid-file <p>] [--liveness-cmd \"<argv>\"] [--json]",
  "  --interval <ms>       轮间隔（缺省 30000；测试缝传小值）",
  "  --cap <n>             传给 ready-pool-check 的并发 cap（缺省 5）",
  "  --once                跑一轮即退出（手动单发 / 测试）",
  "  --max-rounds <n>      跑满 N 轮退出（测试缝，防常驻环无限跑）",
  "  --max-fix-retries <n> AC133 失败上限（缺省 3；连续修满 N 次仍不合格 ⇒ 标 needs-human）",
  "  --ready-pool-cmd <s>  覆盖 ready-pool-check 命令（测试缝）",
  "  --fix-worker-cmd <s>  覆盖 fix worker 命令前缀（测试缝；prompt 仍作末参数追加）",
  "  --fix-worker-timeout-ms <n> fix worker spawn 的 wall-clock 上限（毫秒；缺省 600000，env QUAY_FIX_WORKER_TIMEOUT_MS 次之）",
  "  --resource-gate-cmd <s> 覆盖 resource-gate 命令（测试缝；AC150-1 起 fix worker 前判定，exit 0=GO 非 0=WAIT）",
  "  --llm-commands <csv>  配置声明的 LLM 命令集，逗号分隔（缺省 claude；AC140-4 判定读此集合）",
  "  --round-log <path>    轮记录文件（缺省 <root>/.quay/promotion-round.jsonl）",
  "  --outcome-log <path>  outcome 记录文件（缺省 <root>/.quay/promotion-outcome.jsonl，AC134）",
  "  --pid-file <path>     把驱动自身 pid 写到该文件（外部观测 + kill 抓手）",
  "  --liveness-cmd <s>    覆盖 liveness 检查命令（测试缝；每轮调 supervisor/driver 存活检查）",
  "  --json                每轮向 stdout 打一条 JSON 事件行",
].join("\n");

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  let root: string | undefined;
  let intervalRaw: string | undefined;
  let capRaw: string | undefined;
  let once = false;
  let maxRounds: number | null = null;
  let maxFixRetriesRaw: string | undefined;
  let readyPoolCmd: string | undefined;
  let fixWorkerCmd: string | undefined;
  let fixWorkerTimeoutRaw: string | undefined;
  let resourceGateCmd: string | undefined;
  let roundLogPath: string | undefined;
  let outcomeLogPath: string | undefined;
  let runId: string | undefined;
  let json = false;
  let pidFile: string | undefined;
  let llmCommandsRaw: string | undefined;
  let livenessCmd: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") root = args[++i];
    else if (a === "--interval") intervalRaw = args[++i];
    else if (a === "--cap") capRaw = args[++i];
    else if (a === "--once") once = true;
    else if (a === "--max-rounds") maxRounds = Number(args[++i]);
    else if (a === "--max-fix-retries") maxFixRetriesRaw = args[++i];
    else if (a === "--ready-pool-cmd") readyPoolCmd = args[++i];
    else if (a === "--fix-worker-cmd") fixWorkerCmd = args[++i];
    else if (a === "--fix-worker-timeout-ms") fixWorkerTimeoutRaw = args[++i];
    else if (a === "--resource-gate-cmd") resourceGateCmd = args[++i];
    else if (a === "--round-log") roundLogPath = args[++i];
    else if (a === "--outcome-log") outcomeLogPath = args[++i];
    else if (a === "--run-id") runId = args[++i];
    else if (a === "--pid-file") pidFile = args[++i];
    else if (a === "--llm-commands") llmCommandsRaw = args[++i];
    else if (a === "--liveness-cmd") livenessCmd = args[++i];
    else if (a === "--json") json = true;
    else if (a === "--help" || a === "-h") { console.log(HELP); return 0; }
    else { console.error(`promotion-driver: unknown argument: ${a}`); return 2; }
  }

  const rootDir = root ? path.resolve(root) : path.resolve(process.cwd());

  const interval = parseIntervalMs(intervalRaw, rootDir);
  if (!interval.ok) { console.error(`promotion-driver: ${interval.error}`); return 2; }
  const capRes = resolveCap(capRaw, rootDir);
  if (!capRes.ok) { console.error(`promotion-driver: ${capRes.error}`); return 2; }
  if (maxRounds !== null && (!Number.isInteger(maxRounds) || maxRounds < 1)) {
    console.error("promotion-driver: --max-rounds must be a positive integer");
    return 2;
  }
  // gap-fix-worker-timeout-budget-inherited-from-mechanical-round：fix worker 预算解析（CLI > env > 缺省）。
  // fail-closed：配错的值 ⇒ 拒启动（⛔ 不静默回退成缺省——「没配」与「配错了」动作不同）。
  const fixWorkerTimeout = resolveFixWorkerTimeoutMs(fixWorkerTimeoutRaw);
  if (!fixWorkerTimeout.ok) { console.error(`promotion-driver: ${fixWorkerTimeout.error}`); return 2; }
  const maxFixRetries = maxFixRetriesRaw === undefined
    ? MAX_FIX_RETRIES_DEFAULT
    : Number(maxFixRetriesRaw);
  if (!Number.isInteger(maxFixRetries) || maxFixRetries < 1) {
    console.error("promotion-driver: --max-fix-retries must be a positive integer");
    return 2;
  }

  const roundLogFile = roundLogPath ? path.resolve(roundLogPath) : path.join(rootDir, ROUND_LOG_REL);
  const outcomeLogFile = outcomeLogPath ? path.resolve(outcomeLogPath) : path.join(rootDir, OUTCOME_LOG_REL);
  const resolvedRunId = runId || `pm-${Date.now()}`;
  // AC140-4：配置声明的 LLM 命令集（缺省 ["claude"]；--llm-commands 以逗号分隔注入，测试缝/AC140-2 前置）。
  const llmCommands = llmCommandsRaw === undefined
    ? [...LLM_COMMAND_SET_DEFAULT]
    : llmCommandsRaw.split(",").map((s) => s.trim()).filter(Boolean);

  return runResidentPromotionLoop({
    root: rootDir,
    intervalMs: interval.value,
    cap: capRes.value,
    once,
    maxRounds,
    maxFixRetries,
    readyPoolArgv: readyPoolCmd ? splitArgs(readyPoolCmd) : null,
    fixWorkerCmd: fixWorkerCmd ?? null,
    fixWorkerTimeoutMs: fixWorkerTimeout.value,
    resourceGateArgv: resourceGateCmd ? splitArgs(resourceGateCmd) : null,
    llmCommands,
    roundLogFile,
    outcomeLogFile,
    runId: resolvedRunId,
    json,
    pidFile,
    livenessCmd: livenessCmd ? splitArgs(livenessCmd) : null,
  });
}

// Direct entry guard (gate-script-base convention)：仅当本文件是入口时跑 main()。
if (isDirectEntry(import.meta, undefined, "promotion-driver")) {
  main(process.argv).then((code) => { process.exitCode = code; });
}
