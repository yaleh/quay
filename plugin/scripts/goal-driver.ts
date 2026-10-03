// plugin/scripts/goal-driver.ts — G6 (tasks/gap-goal-driver-mechanical-ring): goal 机械环例程型 driver。
// G9 (tasks/gap-goal-driver-gap-semantic-filing-ring): 缺口非空 ⇒ spawn 短命 agent 经 ABI 立案（照
// promotion-driver 的 fix-worker 现成形态），下一轮 readTaskFacts 独立复核（⛔ 不信 agent 自述）。
//
// WHY THIS EXISTS（orchestration/SPEC-goal-mechanism-2026-09-06.md §6 + goals/AC-177-*）：
// `goal-store.ts` 2026-08-09 落地后 28 天零使用，根因是【没有强制消费者】——前五期把 store 做对、
// 迁入真实数据、断掉旧路、封了 ABI，但至今没有一个常驻进程在读它。`goal-store.ts check --staleness`
// 把 GOAL-001/GOAL-002 全部判进 `notEvaluated`（它们的 AC 一条 `evidence.at` 都没有）。本 driver 就是
// 那个消费者：每轮对每个 active GOAL 跑其 AC 的 criterion → verdict → 写 evidence（落 GateEvent），
// I2 推导 flip achieved、I3 判陈旧三态、I4 查分歧，一条 Fact[] 写 `.quay/goal-round.jsonl`。
//
// 职责边界（人 2026-09-06 裁定 3+5 划定 + 人 2026-09-07 DIR-131 边界裁定，⛔ 逐条不得越界）：
//   ✅ 跑 AC criterion、写 evidence（goal-store gate 自带）——观测性、可逆、不改变系统行为。
//   ✅ I2 推导：AC pass 且未 achieved ⇒ 机械 flip AC；GOAL 全部 AC achieved ⇒ 机械 flip GOAL
//      （裁定 5：active→achieved 是 I2 的确定性推导，不算自动晋升）。
//   ✅ I3 判陈旧三态（fresh/stale/notEvaluated）+ I4 查分歧——复用 `goal-store check --staleness`
//      的单一真相源（⛔ 不在本文件重算 I3/I4，避免与 store 漂移）。
//   ✅ 缺口读数 + 缺口非空时经 ABI（quay-file-task）立案——立案是 goal 侧的【最后一个动作】；
//      此后 todo→done 全程（晋升门 / 派发 / worktree / fan-in / 落地）归 promotion-driver /
//      worker-driver 驱动。⛔ goal 侧对 needs-human 只如实报 stalled 并停止空派 gap-filing agent，
//      不去替 task 机制恢复它（落地速率 / ready 池积压 / needs-human 恢复都是 task 机制的指标，
//      不是 goal 机制的缺陷——DIR-131 Finding 里的错误归因反例）。
//   ⛔ draft→active（激活）——只经分诊判 activate + ⑧ 落地（裁定「晋升应当是语义的」；激活判据 =
//      「这条 AC 作为判据是否就绪」而非「有没有任务牵引」——gap-goal-driver-ac-activation-gated-on-
//      traction-not-goal-semantics）。re-anchor / needs-human / hold 只落痕不 flip。
//   ⛔ active→retired（放弃）——人裁定。放弃是判断不是计算，本 driver 只报红不翻状态。
//      分诊不再判「retire」（AC-219：无任务牵引≠死信）——draft AC 无牵引分诊为 activate，⛔ 不翻 retired。
//   ⛔ 不直接改 task 状态（撞 lifecycle/promotion-driver 的 expectedStatus CAS）。
//   ⛔ 不机械写 tasks/*.md（全仓四个 driver 零先例）——缺口立案由 G9 的语义环 spawn 短命 agent
//      经 ABI（quay-file-task）做，driver 自己仍不手写任务文件。
//
// 分层（AC151 两级抽象）：本文件继承 Layer 0 + 1b（例程型，同 outer/quality/meta），⛔ 不继承
// Layer 1a（无候选池 source / 无任务选择 select / 无 verify 复核）——单元是【例程】不是【任务】，
// 产出是【读数】不是【任务终态】。常驻循环复用 quality-gate-driver 的 runResidentQualityGateLoop
// （收 RoutineSpec[]、评估 due、汇 Facts、写轮记录），⛔ 不再抄一份样板。
//
// Run:
//   node --experimental-strip-types plugin/scripts/goal-driver.ts --root <repo> --once [--json]
//   node --experimental-strip-types plugin/scripts/goal-driver.ts --root <repo> [--interval <ms>]  # 常驻
// Exit: 0 = 轮跑完（含 not-evaluated）; 1 = 轮失败（failed fact）; 2 = usage。

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";
// Layer 0（driver-runtime 单一实现）：DRIVER_KINDS（controlFile/carriers 单源）、runAsync（非阻塞
// spawn）、launchArgv（LLM 调用配置单一构造点）、splitArgs（测试缝覆盖命令切分）、Fact / RoutineSpec
// （Layer 1b 例程契约）。
import { DRIVER_KINDS, runAsync, launchArgv, splitArgs, kernelSiblingArgv, kernelConfigPath, resolveQuayCodeRoot, type Fact, type RoutineSpec } from "./driver-runtime.ts";
// The ONE regex-literal escaper (kernel leaf via the plugin shim) — replaces an inline escape body at
// the heading-literal site (finding `escaperegexp-sweep-missed-two`, routine `semantic-dedup-scan`).
import { escapeRegExp } from "./regex-escape.ts";
// Layer 1b 常驻循环（quality-gate-driver 的通用例程型循环 + 统一轮记录信封，同 meta-driver 的接法）。
import { runResidentQualityGateLoop } from "./quality-gate-driver.ts";
// goal 动词的 argv 单一构造点 + 「quay CLI 解析得出吗」的判据（同 meta-driver，⛔ 本文件不另拼路径）。
import { goalStoreArgv, goalCliResolvable } from "./meta-driver.ts";
// AC155：轮询间隔的单一真相源（drivers.yml 经 driver-config 加载，⛔ 不各写一份字面量）。
import { defaultDriverConfig, loadDriverConfig, DRIVERS_CONFIG_REL } from "./driver-config.ts";
// G7（缺口计算）：task→AC 关联字段 goal_ac 的单一读取路径（parseFrontmatterCompletely +
// frontmatterStatus / frontmatterGoalAc 投影，⛔ 不在本文件另写一份 frontmatter 解析）。
import { parseFrontmatterCompletely, frontmatterStatus, frontmatterGoalAc } from "./task-schema.ts";
// AC150 同族（G9 语义环）：资源门 + halt 判定与 worker/promotion 共用同一份实现（driver-shared.ts，
// ⛔ 非复制粘贴）。
import { resourceGateCheck, isHalted } from "./driver-shared.ts";
// AC140-4：llm_invoked 判定读配置声明的 LLM 命令集（单一实现 = promotion-driver 的 isLlmInvocation，
// ⛔ 不在本文件另写一份 base==="claude" 字面量判定）。
import { isLlmInvocation } from "./promotion-driver.ts";
// 每轮缺口立案 spawn 上限的声明式正源（drivers.yml）就地解析用（⛔ 本任务 Touches 不含
// driver-config.ts——见 goalSpawnCap 的注释）。
import { parse as parseYaml } from "yaml";
// AC-216 复验域的单一判据定义（`inAchievedReverifyScope`，Core 侧）。本 driver【必须】用它而不是
// 在本地重推一遍「achieved ∧ long-term ∧ goal 非 active」——存量缺口正是「声明在 Core、只有 I5 接了线，
// 每轮 gate 集合与缺口立案集合各自另算」：重推一份即第二处定义，正是 gap-meta-computegoalgaps 要关的
// 那个口（硬规则 5b）。goal 动词的 argv 构造仍走 meta-driver 的 goalStoreArgv（⛔ 不绕过 store）。
//
// ⚠️ 从 driver-runtime（Layer 0）取这两个核心符号，⛔ 不在此处直接写 Core 源码树的 import 字面量：
// 「Core 的源码树在哪」是布局知识，唯一落点是 Layer 0（driver-runtime 的 Core 导入面）。
import { inAchievedReverifyScope, readsFrozenPopulation, GOAL_ACCEPTANCE_ACTIVE_ENV } from "./driver-runtime.ts";

// ⑨ CI run 载体的**生产调用点**（tasks/gap-develop-ci-first-decisive-green Requested action 2）。
// ⛔ 本 driver 是 AC-265 的评估者，而 AC-265 读的是 `.quay/ci-runs.jsonl` 这个**本地载体**——
// 没有生产者时判据只能报 `carrier-absent`/`collection-stalled`，与「CI 真红」在读法上同形。
// 采集器自己声明了「每轮」的节奏（capability-catalog 的 CADENCE 行），这里就是兑现它的那处调用。
// ⛔ 与 DIR-131 边界无关：读的是**外部 CI 系统**的状态（GitHub Actions），不是本仓 task 的落地率。
import { collectForRound, DEFAULT_COLLECT_THROTTLE_MS, type CiRunsRoundReading } from "./ci-runs-collect.ts";

// ── 常量（由 DRIVER_KINDS registry 派生，⛔ 不另写一份路径字面量）──────────────────────────
const GOAL_SPEC = DRIVER_KINDS.goal;
/** 轮记录载体（.quay/goal-round.jsonl，gitignored 运行时日志——heartbeat，与 round 记录同族）。
 *  carriers[0] 是 basename（registry 约定，carrierStats 读 .quay/<basename>），故此处补 .quay/ 前缀
 *  （同 meta-driver 的 ROUND_CARRIER_REL = .quay/meta-driver-round.jsonl）。 */
export const GOAL_ROUND_REL = path.join(".quay", GOAL_SPEC.carriers[0]);
/** 控制态文件（.quay/goal-control.json，halt 单一真相源，与 promotion/worker-control.json 同族）。 */
export const GOAL_CONTROL_STATE_REL = path.posix.join(".quay", GOAL_SPEC.controlFile);

/** 轮间隔缺省（毫秒）。AC155：值从 drivers.yml 派生（单一真相源）；生产由 --interval 覆盖，测试传小值。 */
export const INTERVAL_MS_DEFAULT = defaultDriverConfig().goal.intervalMs;

/** 机械 spawn（跑一条 criterion / 一次 check）的 wall-clock 上限（毫秒）——全部是快速机械 node 调用。 */
export const CRITERION_TIMEOUT_MS = 120_000;

/** 读【复核执行根新鲜度】的两条本地只读 git 命令的 wall-clock 上界（毫秒）。⛔ 不是性能阈值
 *  （硬规则 4 推论：不设与机器规格相关的字面量）——它只防「git 挂住把整轮拖住」，取值与宿主无关。 */
export const GIT_READ_TIMEOUT_MS = 10_000;

/** gap-filing agent spawn 的 wall-clock 上限【缺省回退值】（毫秒，spawnSync timeout）。正源 = drivers.yml
 *  goal.gap_worker_timeout_ms（goalGapWorkerTimeoutMs 就地读，⛔ 不写死字面量——硬规则 4 推论二）。
 *  值由实测导出（⛔ 硬规则 4 推论：成本结构未知前不设数值阈值；此处结构已知，必须引用测量）：
 *  gap-filing 角色单次墙钟实测 elapsed_s=602.9（本任务 gap-goal-gap-filing-spawn-budget-too-small-
 *  ring-spins-empty 立案时的 900s 对照，exit=0、timedOut=false），故缺省 900_000（900s）> 602.9s，
 *  留 ~1.5x 余量。promotion-driver 的 fix-worker 保持 180s（最近 400 轮 266/266 零超时）——两角色
 *  工作量本就不同（fix-worker 改已定位代码；gap-filing 要读 AC、查重、撰四件套、过 ABI 落盘），
 *  「同值」不再是节省，而是把一个角色钉死在不可能完成的预算上。 */
export const GAP_WORKER_TIMEOUT_MS_DEFAULT = 900_000;

/** 充分性语义判定 spawn 的 wall-clock 上限（毫秒）。单次 LLM 判定（退出条件 vs 在域 AC，提示词已
 *  内嵌全部事实，⛔ 无需工具调用）——成本结构与 promotion 的 fix-worker（180s，最近 400 轮 266/266
 *  零超时）同族，故取 180_000。sufficiencyTimeoutMs 测试缝可覆盖（负控制 b 的「超时」注入小值）。 */
export const SUFFICIENCY_TIMEOUT_MS = 180_000;

/** 配置声明的 LLM 命令集缺省（AC140-4：判定读集合，⛔ 不靠 base==="claude" 字面量）。`claude-fjdac` =
 *  本仓 dev-tree launcher（.quay/profiles.yml 的 worker-default.launcher）——promotion 缺省只落
 *  ["claude"]，本 driver 把 dev-tree launcher 一并列入使 llm_invoked 在生产取真（⛔ 不硬编码
 *  llm_invoked=true，换集仍然能取假）。 */
export const LLM_COMMAND_SET_DEFAULT: readonly string[] = ["claude", "claude-fjdac"];

/** 每轮缺口立案 spawn 上限缺省（G9 语义环；正源 = drivers.yml goal.spawn_cap，⛔ 此处仅作
 *  drivers.yml 缺失/不可读时的保守回退，同 driver-config DEFAULT_DRIVER_CAP 的接法）。
 *  concurrency-default-fallback：drivers.yml 缺失/不可解析时回退到该值（有理由的默认值，非悄悄写死）。 */
export const GOAL_SPAWN_CAP_DEFAULT = 3;

/** 例程的「每轮必跑」触发（goal 机械环是每 tick 必跑；interval minutes=0 ⇒ 恒 due）。真正的节奏由
 *  常驻循环的 --interval / drivers.yml goal.interval_ms 控制。 */
export const EVERY_ROUND = { kind: "interval" as const, minutes: 0 };

/** 每轮缺口立案 spawn 上限（G9 语义环）：explicit（CLI --spawn-cap）优先 → drivers.yml 的
 *  goal.spawn_cap → 保守缺省 GOAL_SPAWN_CAP_DEFAULT。⛔ 不写死字面量（硬规则 4 推论二）。
 *  ⚠️ 就地读 drivers.yml 而非经 driver-config.loadDriverConfig：driver-config 的 DriverKindConfig
 *  尚不知 spawn_cap（会 merge 丢弃），而本任务 Touches 不含 driver-config.ts。后续若把 spawn_cap
 *  上收 driver-config，应删除本函数改走 loadDriverConfig(root).goal.spawnCap。 */
export function goalSpawnCap(root: string, explicit?: number): number {
  if (explicit != null && Number.isInteger(explicit) && explicit >= 0) return explicit;
  try {
    // ⚠️ 路径经 driver-config 的 DRIVERS_CONFIG_REL（单一真相源，与 loadDriverConfig 读同一个文件），
    // ⛔ 不在此处另拼一份 `plugin/scripts/drivers.yml` 字面量：那正是本任务要消灭的第二处布局知识
    // （gap-drivers-resolve-quay-scripts-under-project-root-not-plugin-root AC3）。
    // ⚠️ 基准仍是 **workspace root**（不是 kernel 安装位置）：spawn 上限 / 超时是【被驱动项目】的声明，
    //    与「交付物版本」那条（读 kernel 自身随包出厂的清单文件）不同族；第三方项目未声明 ⇒ 落缺省，
    //    与 driver-config.loadDriverConfig 的语义一致（避免两个 reader 各读一个文件）。
    const text = fs.readFileSync(path.join(root, DRIVERS_CONFIG_REL), "utf8");
    const parsed = parseYaml(text) as { kinds?: { goal?: { spawn_cap?: unknown } } } | null;
    const v = parsed?.kinds?.goal?.spawn_cap;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  } catch {
    /* drivers.yml 缺失/不可解析 ⇒ 回退缺省（同 loadDriverConfig 的 fail-open） */
  }
  return GOAL_SPAWN_CAP_DEFAULT;
}

/** gap-filing agent spawn 的 wall-clock 上限（毫秒）：explicit（测试缝/CLI --gap-worker-timeout-ms）优先
 *  → drivers.yml 的 goal.gap_worker_timeout_ms → 保守缺省 GAP_WORKER_TIMEOUT_MS_DEFAULT。⛔ 不写死
 *  字面量（硬规则 4 推论二）。接法照 goalSpawnCap：就地读 drivers.yml 而非经 driver-config.loadDriverConfig
 *  （DriverKindConfig 尚不知 gap_worker_timeout_ms，会 merge 丢弃）；后续若把该字段上收 driver-config，
 *  应删除本函数改走 loadDriverConfig(root).goal.gapWorkerTimeoutMs。 */
export function goalGapWorkerTimeoutMs(root: string, explicit?: number): number {
  if (explicit != null && Number.isInteger(explicit) && explicit > 0) return explicit;
  try {
    // 同 goalSpawnCap：经 DRIVERS_CONFIG_REL 单一真相源、基准是 workspace root。
    const text = fs.readFileSync(path.join(root, DRIVERS_CONFIG_REL), "utf8");
    const parsed = parseYaml(text) as { kinds?: { goal?: { gap_worker_timeout_ms?: unknown } } } | null;
    const v = parsed?.kinds?.goal?.gap_worker_timeout_ms;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  } catch {
    /* drivers.yml 缺失/不可解析 ⇒ 回退缺省（同 goalSpawnCap 的 fail-open） */
  }
  return GAP_WORKER_TIMEOUT_MS_DEFAULT;
}

/** ⑨ 每轮 CI run 采集的开关。**代码缺省 false、生产真源 drivers.yml 显式 true**（见 GoalRoundOptions
 *  的同名字段注释：这条读数会 spawn gh + 走网络，默认打开会让每个跑 runGoalRound 的测试都打真 API）。
 *  接法照 goalSpawnCap：就地读 drivers.yml（单一真相源 DRIVERS_CONFIG_REL，基准 = workspace root）。 */
export function goalCiRunsCollect(root: string, explicit?: boolean): boolean {
  if (typeof explicit === "boolean") return explicit;
  try {
    const text = fs.readFileSync(path.join(root, DRIVERS_CONFIG_REL), "utf8");
    const parsed = parseYaml(text) as { kinds?: { goal?: { ci_runs_collect?: unknown } } } | null;
    const v = parsed?.kinds?.goal?.ci_runs_collect;
    if (typeof v === "boolean") return v;
  } catch {
    /* drivers.yml 缺失/不可解析 ⇒ 回退缺省（同 goalSpawnCap 的 fail-open） */
  }
  return false;
}

/** ⑨ CI run 采集的节流间隔（毫秒）：explicit（测试缝 / CLI）→ drivers.yml 的
 *  goal.ci_runs_collect_throttle_ms → DEFAULT_COLLECT_THROTTLE_MS（采集器自己的常量，⛔ 不在这里
 *  再写一个字面量）。0 是**合法值**（= 不节流），故 `>= 0` 而不是 `> 0`。 */
export function goalCiRunsThrottleMs(root: string, explicit?: number): number {
  if (explicit != null && Number.isInteger(explicit) && explicit >= 0) return explicit;
  try {
    const text = fs.readFileSync(path.join(root, DRIVERS_CONFIG_REL), "utf8");
    const parsed = parseYaml(text) as { kinds?: { goal?: { ci_runs_collect_throttle_ms?: unknown } } } | null;
    const v = parsed?.kinds?.goal?.ci_runs_collect_throttle_ms;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  } catch {
    /* 同 goalSpawnCap 的 fail-open */
  }
  return DEFAULT_COLLECT_THROTTLE_MS;
}

/** 充分性「持续 insufficient」信号的 stall 窗口（毫秒）。**缺省是一个【函数】，不是一个字面量**：
 *
 *      stallWindowMs = judgeWallclockMs + roundIntervalMs
 *
 *    judgeWallclockMs = 充分性判官自己的墙钟上限（SUFFICIENCY_TIMEOUT_MS；opts.sufficiencyTimeoutMs 可覆盖）
 *    roundIntervalMs  = 本 driver 自己的轮间隔（drivers.yml goal.interval_ms；main() 把【生效值】传进来，
 *                       故 --interval 覆盖也一并跟着走，⛔ 不在此处另读一份造成第二个布局知识）
 *
 *  WHY 恰好这两项（可核的理由，不是一个拍出来的系数）：窗口必须覆盖【一个完整的「判官判定 + driver 再
 *  看一眼」周期】—— 那正是「一个合法的裁决变化会被观察到」所需的最长时间。充分性裁决是**确定性**的：
 *  同一语义输入（sufficiencyCacheKey）恒给同一裁决，只有【输入变了】才会重判；而输入变化只可能来自
 *  （a）人改 GOAL 标题/退出条件/范围节，或（b）在域 AC 集合增删改 —— 两者都不是时钟驱动的。故一个已
 *  超过该周期仍未变的 insufficient，**不再有任何机制会自己去改它**；唯一剩下的改变途径正是本条信号要
 *  请人做的那件事（改退出条件，或改 AC 集合）。⛔ 门槛比这更短会把「判官刚给出结论、driver 还没轮到
 *  下一眼」误报成卡死；更长则白白延后一个人本来该被叫醒的时刻。
 *
 *  ⛔ 上下限都不加字面量：换机器 / 换 interval / 换判官超时，窗口自动跟着走（硬规则 4 推论二）。
 *  可显式覆盖（CLI --sufficiency-stall-window-ms → drivers.yml kinds.goal.sufficiency_stall_window_ms
 *  → 本推导式），⛔ 但缺省路径里没有任何自由常数。
 *  同族先例：AC-214 freshness routine 的触发阈值 `(W_p + I) × R / K` —— 同为「已测量量的函数」，非常量。 */
export function sufficiencyStallWindowMs(
  root: string,
  opts: { explicit?: number; judgeWallclockMs?: number; roundIntervalMs?: number } = {},
): number {
  const { explicit, judgeWallclockMs, roundIntervalMs } = opts;
  if (explicit != null && Number.isInteger(explicit) && explicit >= 0) return explicit;
  try {
    // 同 goalSpawnCap：经 DRIVERS_CONFIG_REL 单一真相源、基准是 workspace root。
    const text = fs.readFileSync(path.join(root, DRIVERS_CONFIG_REL), "utf8");
    const parsed = parseYaml(text) as { kinds?: { goal?: { sufficiency_stall_window_ms?: unknown } } } | null;
    const v = parsed?.kinds?.goal?.sufficiency_stall_window_ms;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  } catch {
    /* drivers.yml 缺失/不可解析 ⇒ 回退【推导缺省】（⛔ 不是回退到另一个字面量） */
  }
  const judge = judgeWallclockMs != null && Number.isFinite(judgeWallclockMs) && judgeWallclockMs > 0
    ? judgeWallclockMs
    : SUFFICIENCY_TIMEOUT_MS;
  let interval = roundIntervalMs;
  if (interval == null || !Number.isFinite(interval) || interval <= 0) {
    try {
      interval = loadDriverConfig(root).goal.intervalMs;
    } catch {
      interval = INTERVAL_MS_DEFAULT;
    }
  }
  return judge + interval;
}

// ── goal-store CLI 客户端（单一 argv 构造点经 meta-driver 的 goalStoreArgv；读/写/check 在本文件，
//    ⛔ 不复写 meta-driver 的 listGoalRecords/gateCriterion——它们把 scriptRoot 与 dataRoot 合二为一，
//    本 driver 要支持【测试缝】把两者分开：scriptRoot 定位 goal-store.ts，dataRoot 定位 goals/）。──

/** 读全部 goal 记录。解析不了 ⇒ 抛（fail-closed：读不到输入不得继续，⛔ 不返回空数组冒充"没有"）。 */
export async function listGoalRecords(scriptRoot: string | null, dataRoot: string): Promise<Array<Record<string, unknown>>> {
  const r = await runAsync(goalStoreArgv(scriptRoot, ["list"], dataRoot), { timeoutMs: CRITERION_TIMEOUT_MS, collectStderr: true });
  if (r.error || r.status !== 0) {
    throw new Error(`goal-store list failed (exit ${r.status}): ${(r.stderr || "").trim().slice(0, 300)}`);
  }
  const parsed = JSON.parse(String(r.stdout ?? "").trim());
  if (!Array.isArray(parsed)) throw new Error("goal-store list did not return an array");
  return parsed as Array<Record<string, unknown>>;
}

/** 跑一条 AC 的 criterion。⚠️ 副作用是设计如此：`goal-store gate` 自己把 GateEvent 追加进
 *  `.quay/gate-events.jsonl`（evidence 是账本派生的，⛔ 不回写进 goals/*.md——
 *  gap-goal-evidence-cache-should-not-enter-git）。这正是「自动档」允许的那类动作
 *  （观测性、可逆、不改变系统行为）。 */
export async function gateCriterion(
  scriptRoot: string | null,
  id: string,
  dataRoot: string,
): Promise<{ verdict: "pass" | "fail" | "not-evaluated"; reason: string }> {
  const r = await runAsync(goalStoreArgv(scriptRoot, ["gate", id], dataRoot), { timeoutMs: CRITERION_TIMEOUT_MS, collectStderr: true });
  if (r.error) return { verdict: "not-evaluated", reason: `gate spawn error: ${r.error.message}` };
  // exit 0 = pass, 1 = fail（含空 criterion 的 fail-closed）, 2 = 用法/记录不存在 ⇒ 无法评估。
  if (r.status === 2) return { verdict: "not-evaluated", reason: `gate usage error: ${(r.stderr || "").trim().slice(0, 200)}` };
  try {
    const out = JSON.parse(String(r.stdout ?? "").trim());
    const v = out.verdict === "pass" ? "pass" : out.verdict === "fail" ? "fail" : "not-evaluated";
    return { verdict: v, reason: String(out.reason ?? "").slice(0, 500) };
  } catch {
    // 读不懂输出 ≠ 合格（硬规则 3b）——给它一个独立取值，不与 pass/fail 共用。
    return { verdict: "not-evaluated", reason: `unparseable gate output (exit ${r.status})` };
  }
}

/** 翻一条记录的状态（AC active→achieved / GOAL active→achieved）。经 `goal-store write`（provider
 *  写路径 + I1′/origin 校验，⛔ 不直改 goals/*.md 文件）。⛔ 不再回传 origin（gap-goal-store-write-
 *  surface-semantics P2：回传快照里的 origin 会在「人改了 origin 而快照是旧的」时静默覆盖新值——
 *  goal-store 的 write 本就是 patch 语义，省略 `--origin` 即保留存储值，竞态随回传一起消失）。
 *
 *  ⚠️ 【无反向翻转】（gap-goal-driver-draft-ac-invisible-yet-blocking AC4）：全仓本函数恰好 2 个
 *  调用点（:268 / :276，本驱动内），都写 `"achieved"`——没有任何路径把 achieved 翻回 active/draft。
 *  一旦翻成 achieved 即【永久锁定】。⇒ 后果：只有「达成后不再回退」的状态才配写成目标判据；
 *  活性/监控类判据（如「某载体末次写入距今 < N 分钟」）会回退，翻 achieved 后该记录将永久声称
 *  一件已不成立的事。立 AC 的人不得把监控项写成 goal 判据（AC-181 即此类，已由立条人自陈）。 */
export async function writeGoalStatus(
  scriptRoot: string | null,
  id: string,
  status: string,
  dataRoot: string,
  opts: { actor?: string; reason?: string; fidelityJudgeArgv?: string } = {},
): Promise<{ ok: boolean; reason: string }> {
  const extra: string[] = [];
  if (opts.actor) extra.push("--actor", opts.actor);
  if (opts.reason) extra.push("--reason", opts.reason);
  // 保真性判定器 argv（JSON 数组）——仅激活路径传；goal-store 把 prompt 作末参数追加。缺省不传 ⇒
  // goal-store 记 `fidelity: {verdict:"not-evaluated", reason:"no judge configured"}`（诚实留痕，
  // fail-open）。⛔ 不入每轮 gate 路径（本函数只被 ⑧ 激活与 I2 达成两处调用，达成不传）。
  if (opts.fidelityJudgeArgv) extra.push("--fidelity-judge-argv", opts.fidelityJudgeArgv);
  const argv = goalStoreArgv(scriptRoot, ["write", id, "--status", status, ...extra], dataRoot);
  const r = await runAsync(argv, { timeoutMs: CRITERION_TIMEOUT_MS, collectStderr: true });
  if (r.error) return { ok: false, reason: `write spawn error: ${r.error.message}` };
  if (r.status !== 0) return { ok: false, reason: `write exit ${r.status}: ${(r.stderr || "").trim().slice(0, 200)}` };
  return { ok: true, reason: "written" };
}

/** 保真性判定器 argv 前缀的 JSON 编码（真 LLM，launchArgv 单一构造点——⛔ 不手拼 `claude -p`）。
 *  goal-store 的 `--fidelity-judge-argv` seam 把 prompt 作末参数追加，故此处取
 *  launchArgv("fix-worker", "", root) 去掉末尾空 prompt 后的 `-p` 前缀。⛔ profiles.yml 缺失/非法 ⇒
 *  launchArgv 抛错（调用方 catch 后不传 seam ⇒ goal-store 记 "no judge configured"，fail-open +
 *  诚实留痕，AC1）。 */
export function fidelityJudgeArgvJson(root: string): string {
  return JSON.stringify(launchArgv("fix-worker", "", root).slice(0, -1));
}

/** 读 I3 三桶 + I4 分歧（复用 goal-store 的单一真相源 checkStaleness，⛔ 不在本文件重算）。
 *  退出码 1 = 存在 divergent（是发现不是错误），打印 JSON 桶到 stdout。读不懂 ⇒ null。
 *  ⛔ PURE-READ——不跑 criterion（跑判据的 I5 在 checkAchievedFailing，独立子命令）。
 *  scopeSize/evaluated 透传 goal-store 的取值（0 active goal ⇒ evaluated:false、scopeSize:0——
 *  空作用域与「查过且全过」按字段区分，⛔ 同形，硬规则 3b）。 */
export async function checkStaleness(
  scriptRoot: string | null,
  dataRoot: string,
): Promise<{ fresh: string[]; stale: string[]; notEvaluated: string[]; divergent: string[]; scopeSize: number; evaluated: boolean } | null> {
  const r = await runAsync(goalStoreArgv(scriptRoot, ["check", "--staleness"], dataRoot), { timeoutMs: CRITERION_TIMEOUT_MS, collectStderr: true });
  if (r.error) return null;
  try {
    const j = JSON.parse(String(r.stdout ?? "").trim());
    const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
    return {
      fresh: arr(j.fresh), stale: arr(j.stale), notEvaluated: arr(j.notEvaluated), divergent: arr(j.divergent),
      scopeSize: typeof j.scopeSize === "number" ? j.scopeSize : -1,
      evaluated: j.evaluated === true,
    };
  } catch {
    return null;
  }
}

/** 读 I5 achieved-but-failing（复用 goal-store 的单一真相源 checkAchievedFailing，⛔ 不在本文件重算）。
 *  退出码 1 = 存在 achieved-but-failing AC 或未评估（是发现不是错误），打印 JSON 到 stdout。
 *  读不懂 ⇒ null。
 *  scopeSize/evaluated 透传 goal-store 的取值（0 作用域 ⇒ evaluated:false、scopeSize:0——
 *  空作用域与「查过且全过」按字段区分，⛔ 同形，硬规则 3b）。 */
export async function checkAchievedFailing(
  scriptRoot: string | null,
  dataRoot: string,
): Promise<{ achievedButFailing: string[]; evaluated: boolean; scopeSize: number; inScope: string[] } | null> {
  const r = await runAsync(goalStoreArgv(scriptRoot, ["check", "--achieved-failing"], dataRoot), { timeoutMs: CRITERION_TIMEOUT_MS, collectStderr: true });
  if (r.error) return null;
  try {
    const j = JSON.parse(String(r.stdout ?? "").trim());
    const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
    return {
      achievedButFailing: arr(j.achievedButFailing),
      evaluated: j.evaluated === true,
      scopeSize: typeof j.scopeSize === "number" ? j.scopeSize : -1,
      inScope: arr(j.inScope),
    };
  } catch {
    return null;
  }
}

// ── 冻结population 的「此刻为假」读数（第三个 population 的输入面）────────────────────────────
//
// 为什么需要这第三个 population（gap-frozen-achieved-ac-no-owner-after-ledger-tail-mutation）：
// `computeGoalGaps` 此前恰好有两个 population —— ① `status: active` 的 AC；② AC-216 复验域
// （achieved ∧ long-term ∧ GOAL 非 active）。一条 `achieved ∧ 已离开复验域` 的 AC 两者都不属，
// **一条缺口读数都不会产生**。而它的台账尾 verdict 却可被**任何一次一次性判据运行**（扫掠 / 探针 /
// 调查）改写成 `fail` —— 这个过程里**没有任何关闭动作发生**，故 goal-closure-freezes-failing-ac-
// outside-reverify-scope 那条关闭闸结构上看不见它（实际日期：四条 GOAL 于 09-06..09-10 关闭，
// 而四条 fail 尾事件是 09-12T01:43:51–01:45:34Z 一次性连写的，晚于关闭闸落地）。
// ⇒ 禁态可以不经过关闭而被造出来，且此后**检测得到（AC-242 每轮红）却无消费者**——没有立案分支。
//
// ⛔ 判据来源：**不在此处重推**「尾事件 + 新鲜度」这套口径 —— 它归 goal-store 的 `check --stale-pass`
// （AC-242 判据的【同一实现】）。本文件只消费它的**退出码三态 + JSON**，⛔ 不重算谓词优先级
// （硬规则 5b：判据在 Core 定义一次，消费方读它，不自算第二份）。

/** 冻结population 的判定三态读数（⛔ 不是布尔——硬规则 3b：「查过且此刻为真」与「查不成」必须不同形）。
 *  三态的权威来源 = `check --stale-pass` 的**退出码**（goal-store 单一实现）：
 *    0 ⇒ `clean`（查过，population 中无此刻为假的）  1 ⇒ `violated`（查过，failing 非空）
 *    3 ⇒ `not-evaluated`（查不成：轮转从未跑过，或有判据自己声明「此地无法评估」）
 *  其余（spawn 错误 / 读不懂 stdout）⇒ 本文件判 `unreadable`（**台账读不到**），同样落 `not-evaluated`
 *  ——⛔ 绝不与 `clean` 同形：那是「零条」冒充「查过且全好」的经典形态。 */
export interface FrozenFailingReading {
  /** 此刻为假的 AC id（**枚举**，硬规则 3——⛔ 不布尔化）。`judgment !== "violated"` 时恒空。 */
  failing: string[];
  /** 三态：查过且无违反 / 查过且有违反 / 查不成。 */
  judgment: "clean" | "violated" | "not-evaluated";
  /** `judgment === "not-evaluated"` 的成因（枚举，⛔ 不布尔）；其余态恒 null。
   *  `unreadable` 与另外两者**不同形**（前者是「台账/命令读不到」，后者是「读到了但读数不可用」）。 */
  cause: "no-rotation" | "criterion-not-evaluated" | "unreadable" | null;
  /** 读数时的 population 规模（语境量；⛔ 不是枚举本身）。读不到 ⇒ -1（⛔ 不与 0 同形）。 */
  frozenScope: number;
}

/** `check --stale-pass` 的 stdout + 退出码 ⇒ `FrozenFailingReading`（**纯函数**：无 spawn / 无 exec /
 *  ⛔ 不跑任何 criterion —— AC-242 判据的成本上界就是「一个台账解析」，本函数与它同量级）。
 *  ⛔ 三态判定**只读退出码**，不在此处重算 goal-store 的优先级（failing 优先于 not-evaluated 那套
 *  规则连同它的 stderr 归因都归 CLI 一处）。 */
export function parseFrozenFailingReading(stdout: unknown, exitStatus: number | null): FrozenFailingReading {
  let j: Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(stdout ?? "").trim());
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    j = parsed as Record<string, unknown>;
  } catch {
    return { failing: [], judgment: "not-evaluated", cause: "unreadable", frozenScope: -1 };
  }
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  const frozenScope = typeof j.frozenScope === "number" ? j.frozenScope : -1;
  if (exitStatus === 1) return { failing: arr(j.failing), judgment: "violated", cause: null, frozenScope };
  if (exitStatus === 0) return { failing: [], judgment: "clean", cause: null, frozenScope };
  if (exitStatus === 3) {
    // 两个成因**可区分**（透传 goal-store 的读数，⛔ 不重算它的优先级）：轮转从未跑过 = 机制不在；
    // 否则是某条判据自己声明「此地无法评估」（例如它的载体在临时 worktree 里不存在）。
    const rot = (j.rotation ?? {}) as Record<string, unknown>;
    const sweptEver = typeof rot.sweptEver === "number" ? rot.sweptEver : -1;
    return {
      failing: [],
      judgment: "not-evaluated",
      cause: sweptEver === 0 ? "no-rotation" : "criterion-not-evaluated",
      frozenScope,
    };
  }
  // 其余退出码（含 spawn 失败传 null）⇒ 台账/命令读不到。
  return { failing: [], judgment: "not-evaluated", cause: "unreadable", frozenScope: -1 };
}

/** 读冻结population 的「此刻为假」读数：跑 `check --stale-pass` 的**纯读**模式（⛔ 不传 `--sweep`
 *  ——那才执行判据；本函数零 criterion 执行，与 AC-242 判据同一条命令、同一成本类）。
 *  一条命令/一个台账解析，独立于每轮的轮转（`sweepFrozenAcs` 是【动作】半边，本函数是【判定】输入面）。 */
export async function readFrozenFailing(scriptRoot: string | null, dataRoot: string): Promise<FrozenFailingReading> {
  const r = await runAsync(goalStoreArgv(scriptRoot, ["check", "--stale-pass"], dataRoot), { timeoutMs: CRITERION_TIMEOUT_MS, collectStderr: true });
  // ⛔ spawn 错误不是「零条」：parseFrozenFailingReading 收 null 退出码 ⇒ 落 unreadable。
  return parseFrozenFailingReading(r.error ? null : r.stdout, r.error ? null : r.status);
}

// ── 立案前【直接量复核】（**两个 population 共用一条执行路径**）───────────────────────────────────
//   ③ 冻结population（gap-frozen-violated-files-on-stale-verdict）——读数是**台账尾**，缺陷是**时差**。
//   ② AC-216 复验域常设判据（gap-standing-violated-false-spawn-no-prefiling-recheck）——读数是本轮
//      I5 跑的，缺陷是**单次读数在宿主不健康时失准**（ENOSPC 实测）。
//   两个 population 互斥（域内 vs 域外，同一处 `inAchievedReverifyScope` 判据的两侧）⇒ 同一轮
//   ⛔ 不会对同一条 AC 跑两遍；而「立案前真跑一次、三态分派」这条修法是**同一条**，故执行与落痕
//   单点实现在 `runPrefilingRecheck`，两个包装只各自回答「谁进复核集」。
//
// ③ 的缺陷（该分支存在的理由）：`frozenReading.failing` 是**台账读数**，而台账尾是一条**轮转
// verdict**，其新鲜度界是 `DEFAULT_STALE_PASS_MAX_AGE_MS = 4h`，轮转周期实测 13–101 min。
// ⇒ 一次修复落地之后，那条 AC 的台账尾最长数小时仍写 `fail`，而 `computeGoalGaps` 的 ③ 分支
// 直接把尾 verdict 当作「此刻为假」立案，且 prompt 逐字告诉下游「the earlier fix did not hold」
// ——把一个**不存在的缺陷**指给 worker（本仓已有一条任务标题逐字写着「⛔ 勿再找不存在的缺陷」）。
//
// 发生率（硬规则 12b：查历史，⛔ 不等下一轮；本文件内可复核的读数，2026-09-15 从
// `.quay/gate-events.jsonl` 全量重算——`actor=goal-sweep ∧ gate=goal` 的 fail→pass 翻转对）：
//   **9 对 / 7 条 AC**（AC-162 / 169 / 172 / 179×3 / 194 / 203 / 228），翻转窗 **13–101 min**。
//   其中已确证产生 gap 立案的 **3 例**：AC-162（09-15T00:2xZ）、AC-194（09-15T03:3xZ）、
//   AC-194（09-15T10:0xZ = 本任务立案那一轮）。
//
// 修法**不是**收紧 `maxAgeMs`：那个值（4h）是按轮转周期刻意放宽的（收紧会让读数随轮转红绿抖动），
// 而缺口是「**读数与立案之间没有直接量**」——台账说的是「最后一次看见它是什么时候」，立案却拿它
// 当「现在」。⇒ 立案前真跑一次那条 criterion（**直接量**），只有复核后**仍非 0** 才产 frozen-violated。
//
// 成本有据：`goal-store.ts` 的设计注释实测 avg **1.31s/criterion**（21 条样本），且只对命中的
// （通常 0–1 条）跑 ⇒ 每轮增量 ≈ 1.3s × |命中集|（两个 population 各算一次，互斥故不叠加同一 AC）。
//
// ⛔ 重入闸：跑判据必须参与 `GOAL_ACCEPTANCE_ACTIVE_ENV` 那道闸（2026-09-07 递归事故 host load
// 41.89，边界逐字写在该闸的注释里）。共用核**照 `checkAchievedFailing` / `sweepFrozen` 的同一形态**：
// 已在跑判据（本进程已有该变量）⇒ **拒绝**，并落一个**独立取值**（`not-evaluated` + cause
// `guard-refused`），⛔ 绝不与「复核通过」同形（硬规则 3b）。置位本身也让 criterion 的子 shell 继承它，
// 从而那条判据若回调任何判据执行器，孙进程会看到该变量并拒绝——闸的作用域因此覆盖这条新路径。

/** 一条 AC 的复核结局（**三态 + 成因**，⛔ 不布尔化——硬规则 3/3b）。
 *  ⚠️ 本类型被**两个 population** 共用（域内常设 ② / 域外冻结 ③）——两者互斥、复核路径同一条，
 *  故只有一个类型（硬规则 8：⛔ 不为「同一件事的第二个调用方」复制一份形状）。 */
export interface PrefilingRecheckEntry {
  ac: string;
  /** `confirmed-failing` = 复核后仍非 0（立案照旧）；`cleared` = 复核后 exit 0（那条「此刻为假」
   *  的读数是**失准的读数**，⛔ 不立案）；`not-evaluated` = 复核跑不成（独立取值，⛔ 与上面两者都不同形）。 */
  outcome: "confirmed-failing" | "cleared" | "not-evaluated";
  /** 成因（枚举）：still-false / now-true / guard-refused / unreadable / checkout-lagging-develop。
   *  `unreadable` 与 `guard-refused` **不同形**——前者是「命令跑不出读数」，后者是「闸主动拒绝跑」。
   *  ⛔ `checkout-lagging-develop` 是**第五个独立取值**（硬规则 3b/8）：复核**跑了且回了 fail**，
   *  但那个 fail 量的是**滞后的执行根**、不是 develop 的实况 ⇒ 既⛔不落 `confirmed-failing`（那是
   *  把一个不存在的缺陷立案），也⛔不落 `cleared`（那会把「不知道 develop 上真不真」说成「为真」）
   *  ——两者都会让「读不懂输入」伪装成一个有结论的读数。 */
  cause: "still-false" | "now-true" | "guard-refused" | "unreadable" | "checkout-lagging-develop";
  /** 判据自己的输出原因（截断），供落痕归因。 */
  reason: string;
  /** 这条判据本次复核的**原始 verdict**（pass / fail / not-evaluated，`gateCriterion` 归一化后的取值）。
   *  与 `outcome` 同源而出处不同：`outcome` 是本驱动的**分派结论**，`verdict` 是判据执行器的**读数**
   *  ——分开落痕，使「复核真跑过且回了 pass」与「复核被分派成 cleared」在没有复算映射时也读得出。 */
  verdict: "pass" | "fail" | "not-evaluated";
  /** 本次 criterion 执行的墙钟毫秒。⛔ `null` = **没跑**（闸拒绝；⛔ 不与 0 同形——0 会被读成
   *  「跑得极快」，硬规则 3b/6）。 */
  durationMs: number | null;
  /** 复核那一刻**根文件系统**的可用字节（`statfs("/")`）。⛔ 不是指标、不设阈值——它只回答
   *  「这次复核跑在什么机器状态下」。判据断言的保证与宿主健康无关，而两者在**失败读数**上同形
   *  （本类型存在的理由：2026-09-16 实测 ENOSPC 时窗内一条常设判据变红，其真值完好）
   *  ⇒ 把环境量与该次读数钉在一起，事后才可分。读不出 ⇒ null（⛔ 不与 0 同形：0 = 盘满）。 */
  hostFreeBytes: number | null;
  /** 复核那一刻的 1 分钟 load average（`os.loadavg()[0]`）。成因同上；非 Linux 宿主该值恒 0
   *  （=「此平台不提供」而非「机器空闲」），故它**只作旁证**，判读以 `hostFreeBytes` 为主。
   *  读不出 ⇒ null。 */
  load1: number | null;
  /** 复核执行根的 `HEAD` sha（见 `RecheckRootFreshness`）。读不出（非 git 根 / 无 git）⇒ null。 */
  headSha: string | null;
  /** 复核执行根落后 `develop` 的提交数。`0` = 齐平；`> 0` = 滞后（**本条判据因此改判**）；
   *  读不出（非 git 根 / 无 `develop` ref）⇒ null ⇒ **行为与改动前一致**（照旧 `still-false`）。
   *  ⛔ 与 `0` 不同形（硬规则 3b/6）。 */
  behindDevelop: number | null;
}

/** 一轮的复核读数（⛔ 恒非 null —— 没跑复核时它是 `ran:false` 的显式读数，不与「复核通过」同形）。 */
export interface PrefilingRecheckReading {
  /** 本轮是否真的进入了复核循环（`guard-refused` / 目标集为空 / 未传 = false）。 */
  ran: boolean;
  /** 复核对象条数（= 立案前那一刻目标集的规模；语境量，⛔ 不是枚举本身）。 */
  attempted: number;
  /** 逐条落痕（枚举，⛔ 不布尔化）。 */
  entries: PrefilingRecheckEntry[];
  /** 闸拒绝：本进程已在跑判据 ⇒ 本轮一条都没复核（⛔ 与「复核了且全过」不同形）。 */
  guardRefused: boolean;
}

/** 宿主健康量（复核读数的**环境**半边）。⛔ 读宿主、不写字面量（硬规则 4 推论二：一个恰好等于
 *  当前机器规格的字面量不是「无限制」，换台机器就变成真限制）。
 *  读不出 ⇒ `null`（⛔ 不与 0 同形——`hostFreeBytes: 0` 是「盘满」，`null` 是「没读到」）。 */
export function readHostHealth(): { hostFreeBytes: number | null; load1: number | null } {
  let hostFreeBytes: number | null = null;
  try {
    const st = fs.statfsSync("/");
    const bytes = Number(st.bavail) * Number(st.bsize);
    if (Number.isFinite(bytes) && bytes >= 0) hostFreeBytes = bytes;
  } catch {
    hostFreeBytes = null;
  }
  let load1: number | null = null;
  try {
    const l = os.loadavg()[0];
    if (typeof l === "number" && Number.isFinite(l)) load1 = l;
  } catch {
    load1 = null;
  }
  return { hostFreeBytes, load1 };
}

/** 复核执行根的**新鲜度读数**（复核读数的**版本**半边；⛔ 旁证量——不设阈值、不参与判据语义、
 *  不改变任何判据的真假，只回答「这次复核跑在哪个根上」）。
 *
 *  为什么必须有（gap-frozen-recheck-lagging-checkout-false-gap-filing，2026-09-18 实测一例）：
 *  复核的执行根 = `<dataRoot>` = **主检出工作树**，而修复落地在 `develop`；主检出要等下一次
 *  ff 同步才拿到它（实测窗口 67 秒，最长可到「落后 develop 数十提交」）。⇒ 当修复任务恰在这段
 *  窗口内翻 done 时，复核量的**不是 develop 上的实况，而是主检出工作树上的实况**，一条**已修复**
 *  的判据被复核成 `confirmed-failing` ⇒ 立案成 `frozen-violated` ⇒ spawn 一个 prompt 逐字断言
 *  「the earlier fix did not hold」的 agent，给下游指一个**不存在的缺陷**。
 *  ⛔ 与 `hostFreeBytes` / `load1` 的分工：那两个描述「跑在什么机器状态下」（宿主），本条描述
 *  「跑在哪个版本的世界里」（输入面）。三者都不改判据真假，都只为事后可归因。 */
export interface RecheckRootFreshness {
  /** 复核执行根的 `HEAD` sha（`git -C <root> rev-parse HEAD`）。读不出 ⇒ null。 */
  headSha: string | null;
  /** 复核执行根**落后** `develop` 的提交数（`git -C <root> rev-list --count HEAD..develop`）。
   *  `0` = 与 develop 齐平（或领先）；`> 0` = 滞后。读不出（非 git 根 / 无 `develop` ref /
   *  git 不可用）⇒ **null**——⛔ 与 `0` **不同形**（硬规则 3b/6）：`0` 是「齐平」，
   *  `null` 是「读不到」。把「读不到」读成「不滞后」会让一条**未知**的读数冒充「已查过且根是新的」。 */
  behindDevelop: number | null;
}

/** 读复核执行根的新鲜度（两条**本地只读** git 命令，⛔ 零 criterion 执行、零写、无副作用）。
 *  ⛔ 读不出 ⇒ 各字段 null（⛔ 不回退到 `0`/空串：那会把「不知道」伪装成「齐平」）。
 *  ⛔ 只在**复核对象非空**时被调用（`runPrefilingRecheck` 内）⇒ 每轮至多两次（两个 population
 *  互斥、各一次），成本 = 两条 git 只读命令。 */
export function readRecheckRootFreshness(root: string): RecheckRootFreshness {
  const git = (args: string[]): string | null => {
    try {
      const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: GIT_READ_TIMEOUT_MS });
      if (r.error || r.status !== 0) return null;
      const out = String(r.stdout ?? "").trim();
      return out === "" ? null : out;
    } catch {
      return null;
    }
  };
  const headSha = git(["rev-parse", "HEAD"]);
  const behindRaw = git(["rev-list", "--count", "HEAD..develop"]);
  const behindNum = behindRaw === null ? null : Number(behindRaw);
  const behindDevelop = behindNum !== null && Number.isInteger(behindNum) && behindNum >= 0 ? behindNum : null;
  return { headSha, behindDevelop };
}

/**
 * 立案前【直接量复核】的**共用核**（单一实现）：对 `targets` 里每条 AC 真跑一次它的 criterion
 * （复用 goal-store 的 `gate` 动词——即 pass 1 每轮对 active AC 用的同一条 acceptance 执行路径，
 * 单一定义、⛔ 不另写一份跑判据的代码）。两个 population 的**选取条件**在各自的包装里
 * （`recheckFrozenFailing` / `recheckStandingFailing`），**执行与落痕在这里**，⛔ 不复制第二份循环。
 *
 * `targets` 为空 ⇒ 不跑任何判据，返回 `ran:false` 的空读数（零成本，且**不与「复核通过」同形**：
 * `ran` 字段把它们分开）。
 *
 * ⛔ 副作用是设计如此（同 `gateCriterion`）：`goal-store gate` 把本次复核的 verdict 追加进
 * `.quay/gate-events.jsonl`（actor=`goal-cli`）——这正是「复核发生过」的**产物**（硬规则 9：
 * 可见性 ≠ 执行；一条没有落痕的复核，读者无法与「没复核」区分）。
 */
async function runPrefilingRecheck(
  scriptRoot: string | null,
  dataRoot: string,
  targets: string[],
): Promise<PrefilingRecheckReading> {
  const empty: PrefilingRecheckReading = { ran: false, attempted: 0, entries: [], guardRefused: false };
  if (targets.length === 0) return empty;
  const host = readHostHealth();
  // 复核执行根的新鲜度（**版本半边**，见 `RecheckRootFreshness`）：本函数跑判据的根就是 `dataRoot`
  // ——生产里即主检出工作树，它可能滞后 `develop`（修复落在 develop 而主检出要等下一次 ff）。
  // ⛔ 只读一次：本函数内所有 entry 描述的是**同一刻、同一个根**。
  const rootFreshness = readRecheckRootFreshness(dataRoot);
  // ⛔ 重入闸（先于任何判据执行）：本进程若已在跑判据，则**不再**跑（同 checkAchievedFailing /
  // sweepFrozen 的拒绝形态）——拒绝是一个**独立结局**，不是「零条违反」。
  if (process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] === "1") {
    return {
      ran: false,
      attempted: targets.length,
      entries: targets.map((ac) => ({
        ac,
        outcome: "not-evaluated",
        cause: "guard-refused",
        reason: "re-entrancy guard held — this process is already running criteria",
        verdict: "not-evaluated",
        // ⛔ 没跑 ⇒ 时长 null（⛔ 不写 0：0 会被读成「跑得极快」）。宿主量照读——它描述的是
        // 「拒绝发生在什么环境下」，仍然有用。根新鲜度同理照读（拒绝发生在哪个版本的世界里）。
        durationMs: null,
        hostFreeBytes: host.hostFreeBytes,
        load1: host.load1,
        headSha: rootFreshness.headSha,
        behindDevelop: rootFreshness.behindDevelop,
      })),
      guardRefused: true,
    };
  }
  const prev = process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
  process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] = "1";
  const entries: PrefilingRecheckEntry[] = [];
  try {
    for (const ac of targets) {
      // 复用 pass 1 的 acceptance 执行路径（`goal-store gate <id>`）：同一条命令、同一个闸、
      // 同一本台账。⛔ 不在此处直接 spawn criterion 文本（那会绕开 store 的 verdict 语义与落账）。
      const t0 = Date.now();
      const { verdict, reason } = await gateCriterion(scriptRoot, ac, dataRoot);
      const entry = {
        ac, verdict, reason, durationMs: Date.now() - t0,
        hostFreeBytes: host.hostFreeBytes, load1: host.load1,
        headSha: rootFreshness.headSha, behindDevelop: rootFreshness.behindDevelop,
      };
      if (verdict === "fail") {
        // ⛔ 三态分派的关键一格（gap-frozen-recheck-lagging-checkout-false-gap-filing）：`fail` 只说
        // 「在这个根上非 0」，而**这个根是不是 develop 的实况**是另一个问题——根滞后 develop 时，
        // 那条 fail 可能正是「修复已在 develop 落地、而本地工作树还没拿到」的产物。⇒ 落**独立取值**
        // `not-evaluated` + `checkout-lagging-develop`，本轮**不立案**，等下一次复核（届时根已同步）。
        // ⛔ 不是「一律放过」：`behindDevelop` 为 `0`（齐平）或 `null`（读不到 ⇒ ⛔ 不得当成滞后，
        // 硬规则 3b/6）时**照旧** `confirmed-failing` ⇒ 立案照旧（正控制见 AC2）。
        // ⛔ 也不收紧任何阈值：判据是**结构性的**（「复核根 ≠ 权威基线」），不是「落后 N 个提交」。
        if (rootFreshness.behindDevelop !== null && rootFreshness.behindDevelop > 0) {
          entries.push({ ...entry, outcome: "not-evaluated", cause: "checkout-lagging-develop" });
        } else {
          entries.push({ ...entry, outcome: "confirmed-failing", cause: "still-false" });
        }
      } else if (verdict === "pass") entries.push({ ...entry, outcome: "cleared", cause: "now-true" });
      else entries.push({ ...entry, outcome: "not-evaluated", cause: "unreadable" });
    }
  } finally {
    if (prev === undefined) delete process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
    else process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] = prev;
  }
  return { ran: true, attempted: targets.length, entries, guardRefused: false };
}

/**
 * ③（冻结population）的立案前复核：对 `reading.failing` 命中的每条 AC 真跑一次 criterion。
 * `reading` 为 null / `judgment !== "violated"` / `failing` 为空 ⇒ `ran:false`（零成本）。
 * 执行与落痕见 `runPrefilingRecheck`（⛔ 本函数只做选取）。
 */
export async function recheckFrozenFailing(
  scriptRoot: string | null,
  dataRoot: string,
  reading: FrozenFailingReading | null,
): Promise<PrefilingRecheckReading> {
  if (reading === null || reading.judgment !== "violated") return { ran: false, attempted: 0, entries: [], guardRefused: false };
  return runPrefilingRecheck(scriptRoot, dataRoot, [...reading.failing]);
}

/**
 * ②（AC-216 复验域内常设判据）的立案前复核（gap-standing-violated-false-spawn-no-prefiling-recheck）：
 * 对 `standings.achievedButFailing` 命中的每条 AC **再**跑一次 criterion。
 *
 * 与 ③ 的差别是**缺陷形态不同、修法同一条**（⛔ 这两个 population 互斥，故同一轮不会重复跑同一条 AC）：
 *   · ③ 的读数是**台账尾**（轮转 verdict，新鲜度界 4h ≫ 轮转周期）⇒ 时差可长达小时级。
 *   · ② 的读数（I5 `check --achieved-failing`）**就是本轮跑的**、没有时差——但它只有**一次**。
 *     一次读数在宿主进入不健康态时会**失准**：2026-09-16 实测 ENOSPC 时窗内 AC-233（判据为真、
 *     复跑 11 次全绿）在那一轮被判 fail ⇒ driver 据此 spawn 一个 prompt 逐字断言「the guarantee it
 *     asserts has regressed」的 agent，给下游指一个**不存在的缺陷**（本 agent 逐条复测才发现前提不成立）。
 *   ⇒ 立案前再跑一次：两次直接量一致才立案；不一致 ⇒ 那次 fail 是读数失准，不立案。
 *     **修法不是**给判据加环境门/重试阈值（那是硬规则 4 推论「成本结构未知前不设阈值」），
 *     也不是动 AC-233 的判据（它断言的保证完好，动它会把尺子从「安装位置可运行」挪走）。
 *     成本有据：只对 `achievedButFailing` 命中的（通常 0–1 条）跑，同 `gateCriterion` 的 1.31s 量级。
 * `standings` 为 null（读不到 I5 读数）/ 命中集为空 ⇒ `ran:false`（零成本；缺口分派已在
 * `computeGoalGaps` 的对应分支落 not-evaluated，⛔ 不在这里重判一次）。
 */
export async function recheckStandingFailing(
  scriptRoot: string | null,
  dataRoot: string,
  standings: { achievedButFailing: string[]; evaluated: boolean } | null,
): Promise<PrefilingRecheckReading> {
  if (standings === null) return { ran: false, attempted: 0, entries: [], guardRefused: false };
  return runPrefilingRecheck(scriptRoot, dataRoot, [...standings.achievedButFailing]);
}

/** AC-242 successor 的【动作】半边（gap-achieved-ac-rot-invisible-when-ledger-tail-is-stale-pass）：
 *  一次【有界轮转】—— 把「冻结population」（achieved ∧ criterion 非空 ∧ ⛔ 不在 `inAchievedReverifyScope`）
 *  里最久未被轮转验证的至多 budget 条判据重跑一遍，每条 verdict 以 `actor=goal-sweep` 落进**同一本台账**。
 *
 *  为什么必须有这个动作：该population 里的一条 AC「在最后一次记录【之后】才失效」时，同时逃出 I5
 *  （域外不跑）与 AC-242（尾事件仍是旧的 pass）—— 2026-09-12 实测 4 条（AC-147/AC-149/AC-172/AC-228）
 *  尾事件全 pass、实跑全 exit≠0，对所有机制不可见。**判定无法凭台账得知判据当前真假——那需要跑**；
 *  ⛔ 而「把全部冻结 AC 每轮无差别重跑」是 AC-216 已裁定的成本边界之外的放宽，故这里只做**有界轮转**。
 *
 *  ⛔ 本函数是【动作】不是【判定】：判定归 AC-242 的判据（`check --stale-pass`，纯读）。本函数只让
 *  冻结的尾事件不再冻结，并**不**翻任何 status（同 I5：⛔ 不反向翻转 achieved→active）。
 *  成本上界（goal-store 侧强制，⛔ 不在此处重算）：≤ budget 条 × 判据超时，且 ≤ wallMs 墙钟
 *  —— 故本驱动的一轮最多被拖 wallMs。
 *  读不懂输出 ⇒ null（⛔ 不与「轮转了且全过」同形，硬规则 3b）。退出码 1（存在当前为假的 AC）是
 *  **正常结局**、不是错误：stdout 照样是合法 JSON，故只有 spawn 错误/解析失败才归 null。 */
export async function sweepFrozenAcs(
  scriptRoot: string | null,
  dataRoot: string,
): Promise<{ eligible: number; ran: Array<{ id: string; verdict: string }>; stoppedBy: string } | null> {
  const r = await runAsync(
    goalStoreArgv(scriptRoot, ["check", "--stale-pass", "--sweep"], dataRoot),
    { timeoutMs: CRITERION_TIMEOUT_MS, collectStderr: true },
  );
  if (r.error) return null;
  try {
    const j = JSON.parse(String(r.stdout ?? "").trim());
    const s = (j && typeof j === "object" ? (j as Record<string, unknown>).sweep : null) as Record<string, unknown> | null;
    if (!s || typeof s !== "object") return null;
    const ranRaw = Array.isArray(s.ran) ? s.ran : [];
    return {
      eligible: typeof s.eligible === "number" ? s.eligible : -1,
      ran: ranRaw.map((x) => {
        const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
        return { id: String(o.id ?? ""), verdict: String(o.verdict ?? "") };
      }),
      stoppedBy: String(s.stoppedBy ?? ""),
    };
  } catch {
    return null;
  }
}

/** 读 tasks/*.md → 每条 { id, status, goalAc }。⛔ 读不到 tasks 目录（不存在 / 读失败）⇒ null，
 * 与「零任务」不同形（硬规则 3b：读不懂输入不得返回空数组冒充「没有任务」）。单文件读失败跳过该条
 *  （best-effort，不冒充「该任务无 goal_ac」，也不让一条坏文件拖垮整个缺口读数）。 */
export async function readTaskFacts(
  dataRoot: string,
): Promise<Array<{ id: string; status: string | null; goalAc: string | null }> | null> {
  const dir = path.join(dataRoot, "tasks");
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return null;
  }
  const out: Array<{ id: string; status: string | null; goalAc: string | null }> = [];
  for (const f of files) {
    const id = f.slice(0, -".md".length);
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(dir, f), "utf8");
    } catch {
      continue;
    }
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) continue;
    const fm = parseFrontmatterCompletely(m[1]);
    out.push({ id, status: frontmatterStatus(fm), goalAc: frontmatterGoalAc(fm) });
  }
  return out;
}

// ── 纯推导（可单测）────────────────────────────────────────────────────────────────────────

/** 一条 GOAL 的【在域】AC 集合（status ∈ {active, achieved, needs-human}）。draft/superseded/retired
 *  不在域。goalAchievedFromRecords 与充分性判定共用此口径（⛔ 口径分叉会重演 draft 三头不占）。 */
export function inScopeAcsOf(records: Array<Record<string, unknown>>, goalId: string): Array<Record<string, unknown>> {
  return records.filter(
    (r) => String(r.id ?? "").startsWith("AC-") &&
      String(r.goal ?? "") === goalId &&
      (r.status === "active" || r.status === "achieved" || r.status === "needs-human"),
  );
}

/** I2（GOAL 层）：一个 GOAL 是否「全部【在域】AC achieved」。零在域 AC ⇒ false。
 *
 *  在域（in-scope）= status ∈ {active, achieved, needs-human}——「已激活待达成」「已达成」「需人裁定」
 *  都算在域。draft（未激活，裁定 3 人/manager 手动激活）/ superseded（已被取代）/ retired（人裁定放弃）
 *  均【不在域】，不参与「目标是否达成」判定。
 *  needs-human 计入在域（人 2026-09-09 裁定 2：needs-human 阻塞 GOAL 达成，gap-goal-needs-human-blocking）：
 *  一条要人裁定的 AC 若不计数，就与 draft 完全同形——既不挡 GOAL 达成、也不计缺口，等于白加一个状态。
 *
 *  ⚠️ 此口径与 computeGoalGaps 对 draft/superseded/retired 一致（都【排除】），修
 *  gap-goal-driver-draft-ac-invisible-yet-blocking 的死角：旧实现 `every(status === "achieved")`
 *  把 draft 计入「是否全部 achieved」⇒ 一条 draft AC 既不被 :267 flip（只翻 active）、又不计缺口
 *  （computeGoalGaps 只数 active）、却仍挡着 GOAL 达成——三头不占。
 *
 *  ⚠️ 与 goal-store.isGoalAchieved 的差异：后者仍是 `every(status === "achieved")`，会把 draft/
 *  superseded/retired 也算成阻塞（store 侧同款死角，另案处理——本任务 Touches 只含 driver 侧）。 */
export function goalAchievedFromRecords(records: Array<Record<string, unknown>>, goalId: string): boolean {
  const inScope = inScopeAcsOf(records, goalId);
  if (inScope.length === 0) return false;
  return inScope.every((r) => r.status === "achieved");
}

/** 充分性三态词表（AC-212 闸 / AC-213 可区分性；⛔ 加态即改 AC-212 判据的 `verdict in (...)` 集合）：
 *  covered = 退出条件被在域 AC 覆盖；insufficient = 结构上可证覆盖不成立；
 *  not-evaluated = 判不出（⛔ 不与 covered 同形，硬规则 3b——语义半不可用时不得放行关闭）。 */
export type SufficiencyVerdict = "covered" | "insufficient" | "not-evaluated";

/** not-evaluated 的成因（AC3 三方向可区分；⛔ 三种成因都仍是 not-evaluated，只是【可区分】——硬规则 3b
 *  与 cause-carrier-must-be-distinguishable：把多个不同成因写成同一取值，会让「机制如实报语义分歧」与
 *  「判定器根本没跑起来」同形）：
 *  samples-disagree   两次取样不一致（一致性守卫正确工作——诚实报判不出，⛔ 不掷硬币），这是好消息；
 *  judge-unavailable  判定器不可用：空命令前缀 / launchArgv 失败（profiles 缺失）/ spawn 失败 / 超时 /
 *                     非零退出（判定器进程本身失败）——环境问题，与判据内容无关；
 *  judge-unparseable  判定器跑通（exit 0）但 stdout 无法解析成明确的 covered/insufficient——读不懂。 */
export type SufficiencyNotEvaluatedCause = "samples-disagree" | "judge-unavailable" | "judge-unparseable";

/** 充分性语义判定的明细：verdict 三态 + not-evaluated 的成因。cause 只在 verdict==="not-evaluated"
 *  时非 null；covered/insufficient 的 cause 恒 null（无成因可言）。 */
export interface SufficiencyVerdictDetail {
  verdict: SufficiencyVerdict;
  cause: SufficiencyNotEvaluatedCause | null;
}

/** I2（GOAL 层）充分性闸：flip 当且仅当「全部【在域】AC achieved」且充分性判定为 `covered`。
 *  insufficient / not-evaluated / null ⇒ 不 flip（GOAL-010 退出条件②：覆盖与否判不出时取
 *  「未评估」而非放行；GOAL-010 风险 2：判不出 ⇒ 不 flip 且报 not-evaluated）。 */
export function goalFlipDecision(
  records: Array<Record<string, unknown>>,
  goalId: string,
  sufficiency: { verdict?: SufficiencyVerdict | null } | null | undefined,
): boolean {
  return goalAchievedFromRecords(records, goalId) && sufficiency?.verdict === "covered";
}

// ── 关闭前置：不许把「已知失败」冻结在复验域之外（gap-goal-closure-freezes-failing-ac-outside-reverify-scope）──
//
// 缺陷（实测 2026-09-08）：`goalFlipDecision` 只读 AC 的【存储 status】与本轮充分性 verdict，**不读判据读数**。
// 于是一条 `status=achieved` 而判据已变红的 AC，只要同 GOAL 其余 AC 全 achieved 且充分性 covered，GOAL 就照样
// 被机械关闭 —— 关闭后 `:1105` 的每轮循环只遍历 activeGoals，该 AC 从此不再被 gate：台账尾事件永久定格为
// `fail`，且没有任何机制会再跑它。实测：round 149（2026-09-08T19:55:07.756Z）中 AC-161 是唯一 fail 项，
// 同一轮 GOAL-003 被 flip achieved。冻结的失败同时让 AC-241（「台账不得留下不可归因的 fail」）结构上永不通过，
// 被误读成「还有真缺陷」——与 AC-216 的成本边界（未声明的 achieved AC 随 GOAL 关闭离开复验域）叠加后无人拥有。
//
// 修法：给机械关闭加一条与 AC-242 判据**同谓词**的前置 —— 该 GOAL 名下不得存在
// `status=achieved ∧ 台账尾事件 verdict=fail ∧ 未声明 long-term: true` 的 AC。
// ⛔ 数据来源是 goal-store 的 `evidence` 投影（`list` 已返回；它就是 `.quay/gate-events.jsonl` 中该 id 的
// 最后一条 gate=goal 事件），**不是本轮 criteria 读数** —— gateCriterion 在判据输出读不懂时返回
// not-evaluated，而台账尾事件仍是旧的 fail，用读数会漏报（硬规则 4c）。
// ⛔ 不得反向翻转 AC 状态（achieved→active；裁定 3：激活归人）。本前置只约束【机械关闭】这一条路径；
// 人工/`goal-cli` 的直接关闭（`goal-store write --status achieved`）不在射程内。
// ⛔ 与 AC-222（「GOAL 必须能自动关闭」，防「永不达成」）的张力靠【逃生口】化解：声明的语义是 AC 自己写出
// `long-term: true` ⇒ 它自认是常设不变式，不该拖住 GOAL 关闭。逃生口在 AC 侧、不在 GOAL 侧，故关闭路径
// 无需豁免名单；负控制须双向证明（可关 vs 被挡）。

/** 一条 AC 的台账尾 verdict（goal-store 的 `evidence` 投影；`null` = 该 AC 在台账中【零事件】——
 *  ⛔ 与「尾事件是 fail」不同形，也⛔不与「台账读不到」同形，后者由 ledgerProbe 单独承载）。
 *  evidence 形如 `{ at, verdict, reading, firstAt }`（`ledgerEvidenceMap` 的单趟投影，末条覆盖前条）。 */
function ledgerTailVerdict(ac: Record<string, unknown>): string | null {
  const ev = ac.evidence;
  if (ev === null || typeof ev !== "object") return null;
  const v = (ev as Record<string, unknown>).verdict;
  return typeof v === "string" ? v : null;
}

/** 关闭阻塞三态词表（⛔ 加态即改 AC-242 之外的判据集合）：
 *  clear             台账可读且该 GOAL 名下没有「achieved ∧ 尾 fail ∧ 未声明 long-term」的 AC ⇒ 放行关闭；
 *  blocked-failing-ac 存在这样的 AC（枚举在 `acs`）⇒ 关闭被拒；
 *  not-evaluated     台账读不到（成因在 `cause`）⇒ 关闭被拒（⛔ 不与 clear 同形，硬规则 3b：
 *                    读不懂输入不得返回与合格同形的值——否则删掉台账就能把任何红 AC 静默冻结）。 */
export type GoalCloseBlockVerdict = "clear" | "blocked-failing-ac" | "not-evaluated";

/** not-evaluated 的成因（⛔ 两种成因仍都是 not-evaluated，只是【可区分】——硬规则 3b /
 *  cause-carrier-must-be-distinguishable）：
 *  ledger-absent     `.quay/gate-events.jsonl` 不存在（从未跑过任何判据，或台账被清掉）；
 *  ledger-unreadable 存在但读不出来（权限 / I/O 错误）——环境问题，与判据内容无关。 */
export type GoalCloseBlockCause = "ledger-absent" | "ledger-unreadable";

export interface GoalCloseBlock {
  verdict: GoalCloseBlockVerdict;
  /** blocked-failing-ac 时非空：被点名的 AC id（排序，⛔ 枚举不布尔——硬规则 3）。 */
  acs: string[];
  /** 只在 verdict==="not-evaluated" 时非 null；clear / blocked-failing-ac 恒 null。 */
  cause: GoalCloseBlockCause | null;
}

/** 台账探针结果（`probeLedger` 的返回类型 = `goalCloseBlockFromRecords` 的第三参）。
 *  ⚠️ 两者共用一个判别联合，⛔ 不给判定函数另开一个 `{ledgerReadable, ledgerCause}` 选项面——
 *  那样探针的 `{readable}` 传进去会静默落进「读不到」分支（`!undefined` 恒真），把每条 clear 判成
 *  not-evaluated。这一形态实测发生过一次：`tsc` 对 `plugin/scripts/**` 结构上不覆盖
 *  （根 tsconfig 的 `include` 只含 `packages/**`），故该错配一路绿到运行时才被测试抓到。 */
export type LedgerProbe = { readable: true } | { readable: false; cause: GoalCloseBlockCause };

/** 探针：`.quay/gate-events.jsonl` 是否可读。⚠️ 这是对【输入通道】的存在性探测，不是对台账内容的二次解析
 *  ——尾 verdict 一律取自 goal-store 的 `evidence` 投影（单一真相源，⛔ 不在本文件重写一份 ledger 解析）。
 *  必要性：`ledgerEvidenceMap` 在台账缺失时返回空 map，于是「台账不在」与「该 AC 零事件」在 records 上同形
 *  ——那正是硬规则 3b 禁止的形态，故在此把它单独取出来。 */
export function probeLedger(root: string): LedgerProbe {
  const p = path.join(root, ".quay", "gate-events.jsonl");
  if (!fs.existsSync(p)) return { readable: false, cause: "ledger-absent" };
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return { readable: true };
  } catch {
    return { readable: false, cause: "ledger-unreadable" };
  }
}

/** 关闭前置判定（纯函数，⛔ 不跑判据、⛔ 不改状态）：该 GOAL 名下是否存在
 *  `status=achieved ∧ 台账尾 verdict=fail ∧ longTerm !== true` 的 AC。
 *
 *  与 AC-242 判据同谓词，但作用域是【这条 GOAL 名下的 AC】而非全库：AC-242 断言的是「全库不许有这种 AC」，
 *  本函数断言的是「不许带着这种 AC 关闭这条 GOAL」。两者互补——AC-242 是事后读数的红，本函数是事前关闭的闸。 */
export function goalCloseBlockFromRecords(
  records: Array<Record<string, unknown>>,
  goalId: string,
  ledger: LedgerProbe,
): GoalCloseBlock {
  if (!ledger.readable) {
    return { verdict: "not-evaluated", acs: [], cause: ledger.cause };
  }
  const acs = records
    .filter((r) =>
      String(r.id ?? "").startsWith("AC-") &&
      String(r.goal ?? "") === goalId &&
      r.status === "achieved" &&
      r.longTerm !== true &&
      ledgerTailVerdict(r) === "fail")
    .map((r) => String(r.id))
    .sort();
  if (acs.length > 0) return { verdict: "blocked-failing-ac", acs, cause: null };
  return { verdict: "clear", acs: [], cause: null };
}

/** 一个被抽出的节：`heading` = 标题行去掉前导 `##`/空白后的**逐字**文本（含标题自带的后缀限定语，
 *  如 `范围（docs/design/… §7 阶段2）`——判官要能看到限定语本身，见 `scopeSections`），
 *  `text` = 标题后至下一 `## ` 标题（或结尾）的节体，已 trim。 */
interface BodySection {
  heading: string;
  text: string;
}

/** 通用『取 body 里标题为 `heading` 的全部节』帮助函数（`退出条件` 与 `范围` 两处共用一份正则逻辑，
 *  ⛔ 不抄第二份——两份漂移是下一个「读不到」缺陷的源头）。
 *
 *  `heading` 逐字匹配（正则元字符转义）。`allowHeadingSuffix` 打开时标题按**前缀**匹配（`## 范围` 命中
 *  `## 范围（…）` / `## 范围与非目标`）——真实 GOAL 的节标题几乎都带后缀（quay-fleet 的
 *  `## 范围（docs/design/quay-fleet-design.md §2/§3.1/§7 阶段2）`、本仓的 `## 范围与非目标`），
 *  逐字正则在这种情况下**结构上读不到这一节**，正是本任务要修的缺陷原样重现（同
 *  `task-status-drift-check.ts` 的 `## Acceptance Criteria (runnable — …)` 那个实例）。
 *  ⛔ 退出条件**不开**该项：`hasExitConditions` 是机械可证层，其语义不得因本次改动而变。
 *
 *  ⛔ 标题后只允许水平空白（或整行剩余文本），不用 `\s*`——`\s` 含 \n，会把「标题后紧跟的空行 + 下一节
 *  标题」吞进标题匹配，导致空节被误判为「有内容」（原 `exitConditionsText` 注释的同一理由）。 */
function extractSections(body: string, heading: string, opts: { allowHeadingSuffix?: boolean } = {}): BodySection[] {
  const esc = escapeRegExp(heading);
  const suffix = opts.allowHeadingSuffix === true ? "[^\\r\\n]*" : "[ \\t]*";
  const re = new RegExp(`##[ \\t]+(${esc}${suffix})\\r?\\n([\\s\\S]*?)(?=\\r?\\n##[ \\t]|$)`, "g");
  const out: BodySection[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out.push({ heading: m[1].trim(), text: m[2].trim() });
    // 空匹配不可能出现（每个匹配至少吃掉标题行 + 换行），但显式防御死循环。
    if (re.lastIndex === m.index) re.lastIndex += 1;
  }
  return out;
}

/** 取 body 的 `## 退出条件` 节文本（标题后至下一 `## ` 标题或结尾；节体 trim）。无该节 / 节体空 ⇒ ""。
 *  ⛔ 逐字标题（`allowHeadingSuffix` 不开）——行为与本次改动前逐字节一致，机械层不受影响。 */
function exitConditionsText(body: string): string {
  const all = extractSections(body, "退出条件");
  return all.length > 0 ? all[0].text : "";
}

/** body 是否含非空的 `## 退出条件` 节（标题存在且节体有非空白内容——「写下了」，⛔ 不是「只有标题」）。 */
function hasExitConditions(body: string): boolean {
  return exitConditionsText(body).length > 0;
}

/** 取 body 里全部 `## 范围…` 节（标题前缀匹配 ⇒ 带后缀的标题也算，见 `extractSections`）。
 *  只收**节体非空**的节（空节不携带任何「该目标有几块」的信息，进 prompt 只会占位）。
 *
 *  WHY（本任务的机制缺口）：`buildSufficiencyPrompt` 原先把 `goal_title` + `## 退出条件` + 在域 AC
 *  三样喂给充分性判官。而本仓/靶子仓的退出条件刻意写成**不写死数字**的结构性自指句式（「本目标名下未被
 *  superseded 的全部 criterion 状态为 achieved」）——它对任意数量的在域 AC 都同样成立，本身**不携带**
 *  「这个目标应该有几块」的信息。那个信息实际写在 `## 范围` 节，而判官看不到这一节 ⇒ 判官能否识别
 *  「当前只有 1 条 AC，还不够」完全依赖**标题是否恰好写得够详细**，没有任何结构性保障。 */
function scopeSections(body: string): BodySection[] {
  return extractSections(body, "范围", { allowHeadingSuffix: true }).filter((s) => s.text.length > 0);
}

/** 一条 GOAL 的充分性判定（机械可证部分）：读 body 的 `## 退出条件` vs 在域 AC 集合。
 *  insufficient  结构上可证覆盖不成立：GOAL body 无【非空】`## 退出条件` 文本（退出条件从未写下，
 *                覆盖无从谈起——GOAL-005/007/008 空 body 形态），或零在域 AC（空集合无法覆盖）。
 *  not-evaluated body 有退出条件、有在域 AC，但「这组 AC 是否覆盖退出条件」是语义判定，需 LLM
 *                （GOAL-010 风险 2 与 AC-213 的提示词/成本上限），本函数不机械产 covered——
 *                硬性判 covered 会重演「纯语法合取即关闭」的缺陷（AC-212 的 origin）。 */
export function goalSufficiencyVerdict(
  goal: Record<string, unknown>,
  inScopeAcs: Array<Record<string, unknown>>,
): SufficiencyVerdict {
  if (!hasExitConditions(String(goal.body ?? ""))) return "insufficient";
  if (inScopeAcs.length === 0) return "insufficient";
  return "not-evaluated";
}

// ── 充分性语义判定（AC-222 语义半：让充分性闸能产 covered，⛔ 硬约束不可用/超时/读不懂 ⇒ not-evaluated）──

/** 语义判定 stdout → 三态词表（AC-222 负控制 b 的 fail-closed 核心）：
 *  只有【明确、可解析】的 `covered` 才返回 covered；`insufficient` 同理；其余一切（非零退出、空输出、
 *  读不懂、超时、JSON 解析失败）⇒ not-evaluated。⛔ 绝不把「读不懂」回落成 covered——「无条件
 *  return covered」的放水实现会原样重演 AC-212 记录过的三次假 achieved。 */
export function parseSemanticSufficiencyVerdict(stdout: string | null, exitCode: number | null): SufficiencyVerdict {
  if (exitCode !== 0) return "not-evaluated";
  const text = (stdout ?? "").trim();
  // 纯 token（测试缝 / 极简输出）也认。
  if (text === "covered" || text === "insufficient") return text;
  // JSON 形态：{"verdict":"covered"} / {"verdict":"insufficient"}（claude -p 可能带解释性前文，
  // 从末行向上找第一个可解析的 JSON 对象）。⛔ 找不到 ⇒ not-evaluated，绝不默认 covered。
  const candidates = [text, ...text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).reverse()];
  for (const cand of candidates) {
    try {
      const obj = JSON.parse(cand);
      if (obj && typeof obj === "object" && (obj.verdict === "covered" || obj.verdict === "insufficient")) {
        return obj.verdict as SufficiencyVerdict;
      }
    } catch {
      /* 非 JSON 行，继续向上找 */
    }
  }
  return "not-evaluated";
}

/** 充分性语义判定的 prompt：把 GOAL 的退出条件文本 + `## 范围` 节 + 在域 AC 集合（id/title/expect）
 *  结构化给 LLM，要求只输出一行 JSON。⛔ 非散文指令——结构化事实 + 输出契约
 *  （解析靠 parseSemanticSufficiencyVerdict）。
 *
 *  ⛔ 范围节**单独成节**、不与退出条件文本合并：判官必须能分辨「哪段是手段（退出条件）、哪段是目的
 *  分解（范围）」（Plan 第 1 条的可追溯性）。且 `hasExitConditions`/`goalSufficiencyVerdict` 的机械层
 *  ⛔ 不因范围节非空而改变行为——本函数只扩展**语义判官的输入**。
 *
 *  范围节**缺失**时的取值是显式选择（Plan 第 2 条要求明确选一个）：**不改判结构，但在 prompt 里把
 *  「没写」这件事说出来**。理由：① 不 fail-closed 成 insufficient——那等于给「必须写 `## 范围`」加了
 *  一条硬性前置，历史 GOAL（GOAL-001 等可能没写这节）会被结构性判死（DoD 明确排除该范围）；
 *  ② 也不静默当成「没有范围限制」——那正是本任务要修的形态（缺席与「已声明无限制」同形，硬规则 3b）。
 *  说出缺席是零代价的：判定权仍在判官手里，但「AC 集是否完整」不再有一个看不见的默认答案。 */
export function buildSufficiencyPrompt(
  goal: Record<string, unknown>,
  inScopeAcs: Array<Record<string, unknown>>,
  root: string,
): string {
  const gid = String(goal.id ?? "");
  const title = String(goal.title ?? "");
  const body = String(goal.body ?? "");
  const exitText = exitConditionsText(body);
  const scope = scopeSections(body);
  const scopeLines = scope.length === 0
    ? [
        "## 范围 (scope):",
        "(NOT WRITTEN DOWN in the goal body. The title and the exit conditions above are therefore your ONLY",
        "basis for judging completeness. Do NOT read the absence of a scope section as evidence that the AC set",
        "is complete; if the title and exit conditions do not themselves enumerate the work, answer insufficient.)",
      ]
    : [
        "## 范围 (scope, verbatim headings and bodies from the goal body):",
        ...scope.map((s) => `### ${s.heading}\n${s.text}`),
      ];
  const acLines = inScopeAcs.length === 0
    ? "(none)"
    : inScopeAcs.map((ac) => `- ${String(ac.id ?? "")}: ${String(ac.title ?? "")} | expect=${String(ac.expect ?? "")}`).join("\n");
  return [
    "You are a sufficiency judge in the quay repo. Decide whether the goal's in-scope AC set fully covers its exit conditions.",
    "The exit conditions often do not enumerate how many pieces of work the goal contains (they are written as a",
    "structural self-reference valid for ANY number of ACs). The scope section, when present, is where that",
    "decomposition is actually written down — judge the AC set against it, not against the exit conditions alone.",
    `Repo root: ${root}.`,
    `goal_id=${gid} goal_title=${title}`,
    "## 退出条件 (exit conditions):",
    exitText,
    ...scopeLines,
    "## In-scope ACs:",
    acLines,
    'Reply with EXACTLY one line of JSON and nothing else: {"verdict":"covered"} if every exit condition is covered by the AC set, otherwise {"verdict":"insufficient"}.',
  ].join("\n");
}

/** 充分性判定的输入哈希（确定性缓存 key）：goal.id ‖ **goal.title** ‖ 退出条件文本 ‖ `## 范围` 节文本
 *  ‖ 在域 AC 的 (id,title,expect) 有序列表——即 buildSufficiencyPrompt 的全部【语义】输入（⛔ root 与
 *  固定指令文本是常量，不入 key；换机器/换指令文本会按各自常量独立判，不影响「语义输入是否变化」）。
 *  任一在域 AC 的 expect / goal 标题 / 退出条件 / **范围节** / AC 集合（增删序）变化 ⇒ 哈希变 ⇒ 自动
 *  重判（AC3 的「输入变化必重判」）。
 *
 *  ⛔ 范围节必须进 key（与「AC 集合变化触发重判」同一条纪律）：范围节是判官的输入之一，若它改了而 key
 *  不变，缓存会把**旧范围下的裁决**原样回给新范围——判据空转，且与「判过了」同形（硬规则 3b）。
 *  含标题逐字（`范围（…）` vs `范围与非目标` 是两个不同的节）。
 *
 *  ⛔ title 也进 key：它与范围节同理（都是 prompt 的语义输入），原先漏掉。而本任务的实测证据恰好指出
 *  判官此刻**唯一**的结构性依赖就是标题——标题改了而 key 不变，等于把「标题写得不够详细」时得到的
 *  insufficient 原样回给一个标题已改详细的目标，与「领域知识最新」同形。本条与本任务同源、同一函数、
 *  同一条纪律，故一并修（⛔ 只修被报出来的那一个，是硬规则 5b 记过的形态）。 */
export function sufficiencyCacheKey(
  goal: Record<string, unknown>,
  inScopeAcs: Array<Record<string, unknown>>,
): string {
  const canonical = JSON.stringify({
    goal: String(goal.id ?? ""),
    title: String(goal.title ?? ""),
    exit: exitConditionsText(String(goal.body ?? "")),
    scope: scopeSections(String(goal.body ?? "")).map((s) => [s.heading, s.text]),
    acs: inScopeAcs.map((ac) => [String(ac.id ?? ""), String(ac.title ?? ""), String(ac.expect ?? "")]),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** 充分性裁决的确定性缓存（模块级）：key = sufficiencyCacheKey，value = 已【确定】的裁决 + 写入时刻。
 *  ⛔ not-evaluated 永不入缓存——缓存只对【已确定】的输入生效（硬规则 3b：缓存不得把「判不出」变成
 *  「合格」）。模块级 ⇒ 常驻 driver 同一进程内跨轮持久（每轮 runGoalRound → semanticSufficiencyVerdict
 *  命中同一份 Map）。
 *
 *  跨重启持久（gap-sufficiency-cache-in-memory-only…）：内存 Map 之外另落盘到 .quay/ 下的载体
 *  （sufficiencyCacheDir 指定目录；生产 runGoalRound 传 path.join(root, ".quay")）。进程启动时按该目录
 *  加载，命中即用——同一输入跨 goal-driver 重启仍给同一裁决（⛔ 仍只缓存 2 次一致才 commit 的确定裁决，
 *  不是把一次抽签 latch 成永久答案）。 */
interface SufficiencyCacheEntry {
  verdict: SufficiencyVerdict; // 只存 covered / insufficient（⛔ not-evaluated 永不入缓存）
  ts: string;                  // 该裁决 commit 入缓存的写入时刻（ISO）
}

const sufficiencyCache = new Map<string, SufficiencyCacheEntry>();

/** 缓存载体 basename（.quay/ 下，同 goal-round.jsonl 族——runtime 载体，gitignored/不 commit）。 */
const SUFFICIENCY_CACHE_BASENAME = "goal-sufficiency-cache.json";

/** 已加载缓存的目录（load 后）。null = 未加载（仅内存态，未指定落盘目录）。进程重启后回 null，
 *  首次判定按传入目录重新加载（跨重启存活的那一半）。 */
let sufficiencyCacheDir: string | null = null;

/** 按目录加载落盘缓存（幂等：同目录只加载一次）。⛔ 读不到/读不懂 ⇒ 空缓存开始（fail-closed：
 *  「读不懂」不得冒充「命中」——重新判，硬规则 3b）。只认已确定裁决（covered/insufficient）的条目，
 *  not-evaluated 条目即使出现也被丢弃（防御性：写侧本就不落 not-evaluated）。 */
function ensureSufficiencyCacheLoaded(dir: string): void {
  if (sufficiencyCacheDir === dir) return;
  sufficiencyCache.clear();
  sufficiencyCacheDir = dir;
  // 载体读写复用业务目标层的通用实现（readCacheMap/writeCacheMap，定义在下方业务目标层一节；
  // 函数声明提升 ⇒ 此处调用合法）。⛔ 不为第二层抄一份同形代码——两份解析器漂移是下一个假命中源。
  const loaded = readCacheMap<SufficiencyCacheEntry>(dir, SUFFICIENCY_CACHE_BASENAME, (v) => {
    const verdict = v.verdict;
    if (verdict !== "covered" && verdict !== "insufficient") return null;
    return { verdict, ts: typeof v.ts === "string" ? v.ts : "" };
  });
  for (const [k, v] of loaded) sufficiencyCache.set(k, v);
}

/** 落盘缓存（整份覆盖写；写失败 ⇒ 内存缓存仍在，跨重启退化到重新判——观测性退化，⛔ 非正确性破坏）。 */
function persistSufficiencyCache(dir: string): void {
  writeCacheMap(dir, SUFFICIENCY_CACHE_BASENAME, sufficiencyCache);
}

/** 清空充分性裁决缓存（测试缝：不同 test 隔离状态；⛔ 生产不调）。同时解绑落盘目录，使下一次按传入
 *  目录重新加载（测试缝模拟「进程重启」：内存 Map 清空 + 从盘上重新 load，跨重启存活那条路径可被
 *  直接测到，无需真的起两个进程）。 */
export function resetSufficiencyCacheForTest(): void {
  sufficiencyCache.clear();
  sufficiencyCacheDir = null;
}

/** 充分性裁决缓存的只读快照（测试断言「入缓存 / 不入缓存」用；⛔ 生产不调）。 */
export function sufficiencyCacheSnapshot(): ReadonlyMap<string, SufficiencyCacheEntry> {
  return sufficiencyCache;
}

/** 单次充分性语义采样（一次 LLM spawn）。⛔ 不可用 / 超时 / 读不懂 ⇒ not-evaluated，绝不回落 covered
 *  （parseSemanticSufficiencyVerdict 的 fail-closed）。从 semanticSufficiencyVerdict 抽出，供「2 次一致
 *  才入缓存」的一致性守卫对同一输入做两次独立采样。
 *
 *  AC3 成因（cause）：把 not-evaluated 拆成可区分的三种成因，⛔ 三者仍是 not-evaluated（不新增「合格」态）：
 *  judge-unavailable（空命令 / launchArgv 失败 / spawn 失败 / 超时 / 非零退出）与 judge-unparseable
 *  （exit 0 但输出不可解析）在此处按「判定器跑没跑通」区分，samples-disagree 由上层 2 次取样不一致产出。 */
async function sampleSemanticSufficiency(
  goal: Record<string, unknown>,
  inScopeAcs: Array<Record<string, unknown>>,
  root: string,
  opts: { sufficiencyCmd?: string[] | null; sufficiencyTimeoutMs?: number },
): Promise<{ verdict: SufficiencyVerdict; cause: SufficiencyNotEvaluatedCause | null }> {
  const prompt = buildSufficiencyPrompt(goal, inScopeAcs, root);
  let argv: string[];
  try {
    if (opts.sufficiencyCmd != null) {
      if (opts.sufficiencyCmd.length === 0) return { verdict: "not-evaluated", cause: "judge-unavailable" };
      argv = [...opts.sufficiencyCmd, prompt];
    } else {
      argv = launchArgv("fix-worker", prompt, root);
    }
  } catch {
    // launchArgv 抛错（profiles.yml 缺失/非法）⇒ 判不出，⛔ 不回落 covered。
    return { verdict: "not-evaluated", cause: "judge-unavailable" };
  }
  const r = await runAsync(argv, { timeoutMs: opts.sufficiencyTimeoutMs ?? SUFFICIENCY_TIMEOUT_MS });
  if (r.error) return { verdict: "not-evaluated", cause: "judge-unavailable" };
  // 非零退出 = 判定器进程本身失败（未跑通）⇒ 不可用，⛔ 不是「输出不可解析」。
  if (r.status !== 0) return { verdict: "not-evaluated", cause: "judge-unavailable" };
  const parsed = parseSemanticSufficiencyVerdict(r.stdout, r.status);
  if (parsed === "not-evaluated") return { verdict: "not-evaluated", cause: "judge-unparseable" };
  return { verdict: parsed, cause: null };
}

/** semanticSufficiencyVerdict / Detail 的选项。 */
export interface SufficiencyVerdictOpts {
  sufficiencyCmd?: string[] | null;
  sufficiencyTimeoutMs?: number;
  /** 缓存落盘目录（.quay 类）。null/undefined ⇒ 只内存缓存（⛔ 不落盘——单测直接调本函数默认此态，
   *  不污染 repo .quay/）。生产 runGoalRound 传 path.join(root, ".quay") ⇒ 跨重启存活（AC2）。 */
  sufficiencyCacheDir?: string | null;
}

/** 充分性语义判定（AC-222 语义半 + 确定性缓存 + 成因拆分）：机械可证部分判不出（有退出条件 + 有在域
 *  AC）时，判「这组 AC 是否覆盖退出条件」⇒ covered / insufficient。⛔ 硬约束：LLM 不可用 / 超时 /
 *  读不懂 ⇒ not-evaluated，绝不允许回落成 covered（parseSemanticSufficiencyVerdict 的 fail-closed）。
 *
 *  确定性（跨轮/跨重启）：同一输入（sufficiencyCacheKey 相同）给同一裁决——
 *  ① 命中缓存 ⇒ 直接返回缓存值（⛔ 不重问 LLM）；sufficiencyCacheDir 指定时缓存落盘，进程重启后
 *     按同目录重新加载 ⇒ 跨重启仍命中（AC2）；
 *  ② 缓存未命中 ⇒ 首次判定做 2 次独立采样，2 次一致才入缓存并返回（防把一次抽签 latch 成永久答案）；
 *     2 次不一致 ⇒ 记 not-evaluated（cause=samples-disagree）、不入缓存，下一轮再试（⛔ 不取多数票）；
 *  ③ 缓存未命中 ∧ 采样判不出 ⇒ not-evaluated（cause=judge-unavailable / judge-unparseable），⛔ 不把
 *     「判不出」变「合格」，也不沿用别的输入的缓存值——缓存 key 按输入隔离。
 *  返回 SufficiencyVerdictDetail：verdict 三态 + not-evaluated 的成因（cause 只在 not-evaluated 时非 null，
 *  ⛔ 成因不改变判定语义——三种成因都仍是 not-evaluated，goalFlipDecision 只看 verdict）。
 *  sufficiencyCmd = 测试缝（同 readyPoolCmd 的数组形态：覆盖命令前缀，prompt 作末参数追加）；
 *  缺省 = launchArgv("fix-worker") 真 LLM。 */
export async function semanticSufficiencyVerdictDetail(
  goal: Record<string, unknown>,
  inScopeAcs: Array<Record<string, unknown>>,
  root: string,
  opts: SufficiencyVerdictOpts = {},
): Promise<SufficiencyVerdictDetail> {
  const key = sufficiencyCacheKey(goal, inScopeAcs);
  if (opts.sufficiencyCacheDir) ensureSufficiencyCacheLoaded(opts.sufficiencyCacheDir);
  const cached = sufficiencyCache.get(key);
  if (cached !== undefined) return { verdict: cached.verdict, cause: null };

  // 缓存未命中 ⇒ 首次判定：2 次独立采样，2 次一致才入缓存。
  const s1 = await sampleSemanticSufficiency(goal, inScopeAcs, root, opts);
  if (s1.verdict === "not-evaluated") return { verdict: "not-evaluated", cause: s1.cause };
  const s2 = await sampleSemanticSufficiency(goal, inScopeAcs, root, opts);
  if (s2.verdict === "not-evaluated") return { verdict: "not-evaluated", cause: s2.cause };
  if (s1.verdict === s2.verdict) {
    const entry: SufficiencyCacheEntry = { verdict: s1.verdict, ts: new Date().toISOString() };
    sufficiencyCache.set(key, entry);
    if (opts.sufficiencyCacheDir) persistSufficiencyCache(opts.sufficiencyCacheDir);
    return { verdict: s1.verdict, cause: null };
  }
  // 2 次不一致 ⇒ 判不出、不入缓存，下一轮再试（⛔ 不取多数票）。
  return { verdict: "not-evaluated", cause: "samples-disagree" };
}

/** 充分性语义判定的【仅裁决】视图（向后兼容既有调用/单测——只返回 SufficiencyVerdict，成因丢弃）。
 *  需要成因的路径（runGoalRound 写轮记录）用 semanticSufficiencyVerdictDetail。 */
export async function semanticSufficiencyVerdict(
  goal: Record<string, unknown>,
  inScopeAcs: Array<Record<string, unknown>>,
  root: string,
  opts: SufficiencyVerdictOpts = {},
): Promise<SufficiencyVerdict> {
  return (await semanticSufficiencyVerdictDetail(goal, inScopeAcs, root, opts)).verdict;
}

// ── 业务目标层（第二层提问：退出条件 ⊨ 业务目标）────────────────────────────────────────────
//
// 缺陷（2026-09-12 实测，本任务立案依据）：上一节判的是 **`AC ⊇ 退出条件`**——GOAL-016 判 `covered`
// 是对的（四条 AC 逐条覆盖了正文写下的退出条件）。但同日人工审计给出**相反结论**：该 AC 集对其
// **业务目标**（quay 能否自主、可重复地驱动第三方项目开发）不充分——样本量 = 1、从未验证失败拦截、
// 没有任何 AC 约束人介入次数。⇒ ⛔ 不是判错，是**没有任何机制在问上一层**。
//
// 本节的第二层只回答一个问题：**「退出条件本身 ⊨ 业务目标吗」**——注意这不是语义换皮：退出条件是
// **手段**（「四条 AC 全绿」），业务目标是**目的**（「这个能力真的成立吗」）。GOAL-016 的实例里，
// 四条 AC 全绿**完全成立**而目的**不成立**——两层必须能给出**相反**的结论，故⛔ **绝不合并成一个判决**。
//
// 症状二（同一任务）：第一层只吐 `covered`/`insufficient` 一个词，而**语义判断天然产出「能解释的
// 说法」**（硬规则推论四：能解释 ≠ 被检验）⇒ 判决不可机械复核。⇒ 本层对 `unsubstantiated` 强制要求
// 一条**指认**——「本 GOAL 已达成 AC 的**全部**证据记录，其 `<field>` 均为 `<value>`」——并**在产出侧
// 机械复核**它（字段白名单 / 每条记录该字段非空 / 全部取同一值 / 值逐字相符）。指认缺失或不成立
// ⇒ `not-evaluated`（cause=assertion-missing / assertion-unverifiable），⛔ 绝不默认 `covered`。
//
// ⛔ 输入里必须有**证据来源**（已达成 AC 的载体记录，`host`/`project_root`/`task_id`）：没有它，
// 判定器**结构上看不见**「证据同质」——而这正是 GOAL-016 的例子被漏掉的那个维度（AC-234 的判据
// 之所以后来被发现「绿不覆盖真实形态」，靠的就是「语义提出可疑处 → 机械验证模式匹配」；
// 若当初的判决带这种指认，它本可以早被发现）。

/** 业务目标层三态词表。⛔ 与 SufficiencyVerdict **取值不同形**：两层命题不同，共用词表会让两层判决
 *  在轮记录里同形（硬规则 3b 同族：可区分的东西不得写成同一取值）。 */
export type ObjectiveVerdict = "substantiated" | "unsubstantiated" | "not-evaluated";

/** 业务目标层的 not-evaluated 成因（⛔ 六种成因都仍是 not-evaluated，只是【可区分】）：
 *  no-evidence-records    该 GOAL 名下已达成 AC 的载体记录 = 0 ⇒ 结构上看不见业务目标层，判决无从谈起；
 *  judge-unavailable      判定器不可用（空命令 / launchArgv 失败 / spawn 失败 / 超时 / 非零退出）；
 *  judge-unparseable      判定器跑通（exit 0）但输出不可解析成明确 substantiated/unsubstantiated；
 *  samples-disagree       两次取样不一致（一致性守卫正确工作）；
 *  assertion-missing      判 `unsubstantiated` 却**没给指认** ⇒ 硬规则 3b：不可复核的判决不得冒充结论；
 *  assertion-unverifiable 给了指认，但**机械复核不成立**（字段不在白名单 / 某条记录该字段为空 /
 *                         取值不唯一 / 与所指认的值逐字不符）。 */
export type ObjectiveNotEvaluatedCause =
  | "no-evidence-records"
  | "judge-unavailable"
  | "judge-unparseable"
  | "samples-disagree"
  | "assertion-missing"
  | "assertion-unverifiable";

/** 指认可指认的字段白名单（**封闭集**）：只认载体记录上这三个可机械比对的标量字段。⛔ 不接受自由
 *  文本字段名——一个指认若不能落到封闭字段集上，「一条命令复核」就无从谈起（可复核性正是本层的产物）。 */
export const OBJECTIVE_ASSERTION_FIELDS = ["project_root", "host", "task_id"] as const;
export type ObjectiveAssertionField = (typeof OBJECTIVE_ASSERTION_FIELDS)[number];

/** 一条**可机械复核**的指认：断言「本 GOAL 已达成 AC 的**全部**证据记录，其 `<field>` 均为 `<value>`」。
 *  `matched`/`total` 由产出侧机械算出（⛔ 判定器不提供，故不可被编造）；`command` 是复核它的**一条命令**。 */
export interface ObjectiveAssertion {
  kind: "single-value-field";
  field: ObjectiveAssertionField;
  value: string;
  /** 被考察的 AC id（载体里 `ac` 字段的原始形态，如 `GOAL-016-AC-247`），已排序。 */
  acs: string[];
  /** 指认的证据来源（**repo-root-relative** 路径，如 `.quay/productization-verification.jsonl`），
   *  已排序——⛔ 不是 basename：`command` 要在仓库根直接跑，故必须带 `.quay/` 前缀。 */
  carriers: string[];
  matched: number;
  total: number;
  /** 复核此指认的一条 shell 命令（在仓库根执行；打印 `matched=<n> total=<n>`，全中则 exit 0）。 */
  command: string;
}

/** 一条证据记录（载体 jsonl 行）的规范化视图。缺字段 → 空串（⛔ 与「该字段为 null」不同形，
 *  空串在复核里必然不匹配任何非空 value ⇒ fail-closed）。 */
export interface ObjectiveEvidenceRecord {
  ac: string;
  host: string;
  project_root: string;
  task_id: string;
  carrier: string;
  line: number;
}

/** 证据概况（**机械可算**，进 prompt 也进轮记录）：判定器与审计者都靠它看「证据是否同质」。 */
export interface ObjectiveEvidenceProfile {
  records: number;
  acs: string[];
  distinctProjectRoots: string[];
  distinctHosts: string[];
  distinctTasks: string[];
}

/** 业务目标层判决明细。`assertion` 只在 `unsubstantiated` 时非 null（substantiated 无需指认；
 *  not-evaluated 的指认不成立故不携带——⛔ 带一条未复核通过的指认会让它与「复核通过」同形）。 */
export interface ObjectiveVerdictDetail {
  verdict: ObjectiveVerdict;
  cause: ObjectiveNotEvaluatedCause | null;
  assertion: ObjectiveAssertion | null;
  /** 判定器实际看到的证据概况；零记录时仍非 null（records=0）——「查过且零条」与「没查」不同形。 */
  profile: ObjectiveEvidenceProfile;
}

/** 证据载体所在目录（相对仓库根）。 */
export const OBJECTIVE_EVIDENCE_DIR_REL = ".quay";

/** 证据载体缺省清单（`OBJECTIVE_EVIDENCE_DIR_REL` 下的 basename）。⛔ **有界**：⛔ 不扫 `.quay/*.jsonl`
 *  （该目录下有 18MB 的 gate-events 与 57MB 的 meta-driver-round，逐轮全扫会把 driver 拖死）。 */
export const OBJECTIVE_EVIDENCE_CARRIERS: readonly string[] = ["productization-verification.jsonl"];

/** AC id 归一：剥掉 `GOAL-NNN-` 前缀，使 `GOAL-016-AC-247` 与 `AC-247` 同形可比
 *  （载体记的是前者，`goals/` 里的 id 是后者——两处形态不同是本仓的既成事实）。 */
function normalizeAcId(id: string): string {
  return id.replace(/^GOAL-\d+-/, "");
}

/** 收集本 GOAL 已达成 AC 的证据记录（⛔ 只读、⛔ 不 spawn、⛔ 不改任何状态）。读不到载体/读不懂某行
 *  ⇒ 跳过该行（fail-soft：**读不到**与**读到零条**在本层的处置相同——都是 `no-evidence-records`，
 *  因为业务目标层需要的「证据」在两种情形下同样不可见；这与硬规则 3b 不冲突：本层不产出「合格」态）。 */
export function collectObjectiveEvidence(
  root: string,
  acIds: string[],
  carriers: readonly string[] = OBJECTIVE_EVIDENCE_CARRIERS,
  carrierDirRel: string = OBJECTIVE_EVIDENCE_DIR_REL,
): ObjectiveEvidenceRecord[] {
  const want = new Set(acIds.map(normalizeAcId));
  const out: ObjectiveEvidenceRecord[] = [];
  for (const name of carriers) {
    // 记录的 carrier 是 **repo-root-relative** 路径（`root` 之下的载体目录 + basename）——`command`
    // 要在仓库根直接跑，⛔ 不是裸 basename（实测：裸 basename 在仓库根必然 FileNotFoundError）。
    const rel = path.posix.join(carrierDirRel, name);
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(root, carrierDirRel, name), "utf8");
    } catch {
      continue; // 载体缺失 ⇒ 本载体零记录（其余载体照读）
    }
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === "") continue;
      let r: Record<string, unknown>;
      try {
        r = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (r === null || typeof r !== "object") continue;
      const ac = String(r.ac ?? "");
      if (!want.has(normalizeAcId(ac))) continue;
      out.push({
        ac,
        host: String(r.host ?? ""),
        project_root: String(r.project_root ?? ""),
        task_id: String(r.task_id ?? ""),
        carrier: rel,
        line: i + 1,
      });
    }
  }
  return out;
}

/** 证据概况（纯函数）。distinct* 均排序、去重，⛔ 不含空串（空值不是「一个取值」，它是「该字段没写」；
 *  混进来会让「唯一取值」的判读被一条无值记录污染）。 */
export function objectiveEvidenceProfile(evidence: ObjectiveEvidenceRecord[]): ObjectiveEvidenceProfile {
  const uniq = (xs: string[]): string[] => [...new Set(xs.filter((s) => s !== ""))].sort();
  return {
    records: evidence.length,
    acs: uniq(evidence.map((e) => e.ac)),
    distinctProjectRoots: uniq(evidence.map((e) => e.project_root)),
    distinctHosts: uniq(evidence.map((e) => e.host)),
    distinctTasks: uniq(evidence.map((e) => e.task_id)),
  };
}

/** 机械复核一条指认（纯函数，⛔ 不写盘、⛔ 不 spawn）：字段在白名单内，且**每一条**被考察记录该字段
 *  非空、逐字等于所指认的值。返回 matched/total——`ok` 当且仅当 `total>0 ∧ matched===total`
 *  （零记录不算通过：空集上的全称命题恒真，那是硬规则 4 的「结构上不可能取假的量」）。 */
export function verifyObjectiveAssertion(
  field: string,
  value: string,
  evidence: ObjectiveEvidenceRecord[],
): { ok: boolean; matched: number; total: number; reason: string } {
  const total = evidence.length;
  if (!(OBJECTIVE_ASSERTION_FIELDS as readonly string[]).includes(field)) {
    return { ok: false, matched: 0, total, reason: `field-not-in-vocabulary:${field}` };
  }
  if (value === "") return { ok: false, matched: 0, total, reason: "empty-value" };
  const f = field as ObjectiveAssertionField;
  const matched = evidence.filter((e) => e[f] === value).length;
  if (total === 0) return { ok: false, matched, total, reason: "no-evidence-records" };
  if (matched !== total) return { ok: false, matched, total, reason: `partial-match:${matched}/${total}` };
  return { ok: true, matched, total, reason: "all-records-match" };
}

/** shell 单引号转义（`'` ⇒ `'\''`）。 */
function shSingleQuote(s: string): string {
  return `'${s.split("'").join(`'\\''`)}'`;
}

/** 指认的一条复核命令（纯字符串构造）：在仓库根执行，读**同一批载体**里**同一批 AC** 的记录，
 *  打印 `matched=<n> total=<n>`，全中 exit 0、否则 exit 1。⛔ 这份命令与 `verifyObjectiveAssertion`
 *  是同一个谓词的两种执行体（一个跑在 driver 进程内、一个可被人/别的会话独立复跑）——
 *  「判决不可复核」这个症状的**产物**就是它。 */
export function objectiveAssertionCommand(
  acs: string[],
  field: string,
  value: string,
  carriers: readonly string[] = OBJECTIVE_EVIDENCE_CARRIERS,
): string {
  const acsJson = JSON.stringify([...new Set(acs.map(normalizeAcId))].sort());
  const carriersJson = JSON.stringify([...carriers].sort());
  const py =
    `import json,re;` +
    `acs=set(${acsJson});carriers=${carriersJson};` +
    `norm=lambda s: re.sub(r'^GOAL-\\d+-','',s);` +
    `rs=[json.loads(l) for c in carriers for l in open(c) if l.strip()];` +
    `rs=[r for r in rs if norm(str(r.get("ac") or "")) in acs];` +
    `m=[r for r in rs if str(r.get(${JSON.stringify(field)}) or "")==${JSON.stringify(value)}];` +
    `print("matched=%d total=%d" % (len(m),len(rs)));` +
    `raise SystemExit(0 if len(rs)>0 and len(m)==len(rs) else 1)`;
  return `python3 -c ${shSingleQuote(py)}`;
}

/** 业务目标的正文文本：body 的 `## 业务目标` 节；无该节 ⇒ ""（⛔ 不拿整篇 body 顶替——那是把「没写明」
 *  伪装成「写明了」，硬规则 6）。无该节时 prompt 明确告知判定器「未显式写下，从标题与退出条件推断」，
 *  使「目标未写明」本身成为一个可被判定器看见的事实，而不是一段空白。 */
function businessObjectiveText(body: string): string {
  const m = body.match(/##[ \t]+业务目标[ \t]*\r?\n([\s\S]*?)(?=\r?\n##[ \t]|$)/);
  return m !== null ? m[1].trim() : "";
}

/** 业务目标层的 prompt：把**两层命题分别**摆明（第一层：AC 覆盖退出条件；第二层：退出条件在**实际
 *  取得的证据**下是否 ⊨ 业务目标），并把证据概况与逐条证据**结构化**喂进去（⛔ 散文指令）。
 *  输出契约（解析靠 parseObjectiveJudge）：只输出一行 JSON；判 unsubstantiated **必须**带
 *  `field`/`value` 指认（值取自下面 `distinct_*` 列表——⛔ 不是让判定器去编一个值）。 */
export function buildObjectivePrompt(
  goal: Record<string, unknown>,
  inScopeAcs: Array<Record<string, unknown>>,
  evidence: ObjectiveEvidenceRecord[],
  root: string,
): string {
  const gid = String(goal.id ?? "");
  const title = String(goal.title ?? "");
  const body = String(goal.body ?? "");
  const objective = businessObjectiveText(body);
  const exitText = exitConditionsText(body);
  const profile = objectiveEvidenceProfile(evidence);
  const acLines = inScopeAcs.length === 0
    ? "(none)"
    : inScopeAcs
        .map((ac) => `- ${String(ac.id ?? "")}: ${String(ac.title ?? "")} | expect=${String(ac.expect ?? "")}`)
        .join("\n");
  const evLines = evidence.length === 0
    ? "(none)"
    : evidence
        .map((e) => `- ${e.ac} host=${e.host} project_root=${e.project_root} task_id=${e.task_id}`)
        .join("\n");
  return [
    "You are a goal-objective judge in the quay repo. A separate judge already answers a DIFFERENT question:",
    "  (layer 1) does the in-scope AC set cover the goal's exit conditions?  <-- NOT your question.",
    "Your question is (layer 2): do the exit conditions themselves substantiate the goal's BUSINESS OBJECTIVE —",
    "the real-world outcome the goal exists to bring about? Exit conditions are a MEANS; the objective is the END.",
    "A goal whose exit conditions are fully met can still fail to substantiate its objective (e.g. the evidence",
    "shows a single instance where the objective claims a capability; or a failure path the objective depends on",
    "was never exercised). Judge ONLY this layer; the two layers may and should disagree.",
    `Repo root: ${root}.`,
    `goal_id=${gid}`,
    `goal_title=${title}`,
    "## 业务目标 (business objective, verbatim from the goal body):",
    objective === "" ? "(NOT WRITTEN DOWN in the goal body — infer it from the title and exit conditions below, and treat the absence itself as a weakness of substantiation.)" : objective,
    "## 退出条件 (exit conditions):",
    exitText,
    "## In-scope ACs:",
    acLines,
    "## Evidence actually collected for the achieved ACs (normalized carrier records):",
    evLines,
    "## Evidence profile (mechanically computed):",
    `records=${profile.records} distinct_project_roots=${JSON.stringify(profile.distinctProjectRoots)} ` +
      `distinct_hosts=${JSON.stringify(profile.distinctHosts)} distinct_tasks=${JSON.stringify(profile.distinctTasks)}`,
    "## Output contract (EXACTLY one line of JSON, nothing else):",
    '{"verdict":"substantiated"} — the exit conditions, on this evidence, establish the business objective.',
    '{"verdict":"unsubstantiated","field":"<f>","value":"<v>"} — they do not, AND you can point at a',
    `mechanically checkable reason: every evidence record above has field <f> equal to <v>. <f> must be one of ${JSON.stringify([...OBJECTIVE_ASSERTION_FIELDS])}; <v> must be copied VERBATIM from the distinct values listed above (a value you invent will fail mechanical re-verification and your verdict will be discarded).`,
    "If you cannot express such a checkable reason, still answer unsubstantiated WITHOUT the field/value keys —",
    "the result will be recorded as not-evaluated rather than as a substantiated/unsupported claim.",
  ].join("\n");
}

/** 判定器的解析结果：verdict + （仅 unsubstantiated 时可能有的）指认字段/值。⛔ 判定器**不提供**
 *  matched/total——那两个数由产出侧机械算出，故判定器编不出来。 */
export interface ObjectiveJudgeParse {
  verdict: ObjectiveVerdict;
  field: string | null;
  value: string | null;
}

/** 业务目标层 stdout → 三态词表（fail-closed 核心，同 parseSemanticSufficiencyVerdict 的手法）：
 *  只有【明确、可解析】的 `substantiated`/`unsubstantiated` 才返回；其余一切（非零退出、空输出、
 *  读不懂、JSON 解析失败）⇒ not-evaluated。⛔ 绝不把「读不懂」回落成 substantiated。 */
export function parseObjectiveJudge(stdout: string | null, exitCode: number | null): ObjectiveJudgeParse {
  if (exitCode !== 0) return { verdict: "not-evaluated", field: null, value: null };
  const text = (stdout ?? "").trim();
  if (text === "substantiated" || text === "unsubstantiated") {
    return { verdict: text, field: null, value: null };
  }
  const candidates = [text, ...text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).reverse()];
  for (const cand of candidates) {
    try {
      const obj = JSON.parse(cand) as Record<string, unknown> | null;
      if (obj === null || typeof obj !== "object") continue;
      if (obj.verdict !== "substantiated" && obj.verdict !== "unsubstantiated") continue;
      const field = typeof obj.field === "string" ? obj.field : null;
      const value = typeof obj.value === "string" ? obj.value : null;
      return { verdict: obj.verdict as ObjectiveVerdict, field, value };
    } catch {
      /* 非 JSON 行，继续向上找 */
    }
  }
  return { verdict: "not-evaluated", field: null, value: null };
}

/** 业务目标层的输入哈希（确定性缓存 key）：goal.id ‖ 退出条件 ‖ 在域 AC ‖ **证据概况 + 每条证据记录的
 *  规范键**。⛔ 证据进 key 是本层的要害（AC4）：载体记录一变（多一条来自新 project_root 的记录、
 *  或某条记录的 host 变了），key 必变 ⇒ 自动重判，⛔ 不会拿旧证据下的裁决继续用。 */
export function objectiveCacheKey(
  goal: Record<string, unknown>,
  inScopeAcs: Array<Record<string, unknown>>,
  evidence: ObjectiveEvidenceRecord[],
): string {
  const canonical = JSON.stringify({
    goal: String(goal.id ?? ""),
    exit: exitConditionsText(String(goal.body ?? "")),
    objective: businessObjectiveText(String(goal.body ?? "")),
    acs: inScopeAcs.map((ac) => [String(ac.id ?? ""), String(ac.title ?? ""), String(ac.expect ?? "")]),
    evidence: evidence.map((e) => [e.carrier, e.line, e.ac, e.host, e.project_root, e.task_id]),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** 业务目标层裁决的缓存条目。⛔ 与第一层一样只存**确定**裁决（substantiated / unsubstantiated），
 *  not-evaluated 永不入缓存（硬规则 3b：缓存不得把「判不出」变成「合格」）。指认随裁决一并入缓存
 *  ——它是裁决的一部分（「判决 + 指认」才是本层的输出形态），丢了指认会让缓存命中退化成「无指认的
 *  unsubstantiated」，那正是本层禁止的形态。 */
interface ObjectiveCacheEntry {
  verdict: ObjectiveVerdict;
  assertion: ObjectiveAssertion | null;
  ts: string;
}

const objectiveCache = new Map<string, ObjectiveCacheEntry>();
const OBJECTIVE_CACHE_BASENAME = "goal-objective-cache.json";
let objectiveCacheDir: string | null = null;

/** 缓存载体的通用读（JSON：`{version, entries:{k:{...}}}`）。`keep` 把一条原始条目映射成内部形态；
 *  返回 null ⇒ 丢弃该条（⛔ 读不懂的单条不得冒充命中）。整份读不到/解析失败 ⇒ 空 Map（fail-closed）。 */
function readCacheMap<T>(dir: string, basename: string, keep: (v: Record<string, unknown>) => T | null): Map<string, T> {
  const out = new Map<string, T>();
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(dir, basename), "utf8");
  } catch {
    return out;
  }
  try {
    const parsed = JSON.parse(raw) as { entries?: unknown } | null;
    const entries = parsed && typeof parsed === "object" ? parsed.entries : null;
    if (entries && typeof entries === "object") {
      for (const [k, v] of Object.entries(entries as Record<string, unknown>)) {
        if (v && typeof v === "object") {
          const kept = keep(v as Record<string, unknown>);
          if (kept !== null) out.set(k, kept);
        }
      }
    }
  } catch {
    /* 读不懂 ⇒ 空缓存开始（重新判，⛔ 不冒充命中） */
  }
  return out;
}

/** 缓存载体的通用写（整份覆盖；写失败 ⇒ 静默退化到进程内持久，观测性退化而非正确性破坏）。 */
function writeCacheMap<T>(dir: string, basename: string, entries: Map<string, T>): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const obj: Record<string, T> = {};
    for (const [k, v] of entries) obj[k] = v;
    fs.writeFileSync(path.join(dir, basename), JSON.stringify({ version: 1, entries: obj }, null, 2) + "\n");
  } catch {
    /* 写失败 ⇒ 不抛 */
  }
}

function ensureObjectiveCacheLoaded(dir: string): void {
  if (objectiveCacheDir === dir) return;
  objectiveCache.clear();
  objectiveCacheDir = dir;
  const loaded = readCacheMap<ObjectiveCacheEntry>(dir, OBJECTIVE_CACHE_BASENAME, (v) => {
    const verdict = v.verdict;
    if (verdict !== "substantiated" && verdict !== "unsubstantiated") return null;
    const a = v.assertion;
    const assertion =
      a && typeof a === "object" && typeof (a as ObjectiveAssertion).field === "string" &&
      typeof (a as ObjectiveAssertion).value === "string"
        ? (a as ObjectiveAssertion)
        : null;
    return { verdict, assertion, ts: typeof v.ts === "string" ? v.ts : "" };
  });
  for (const [k, v] of loaded) objectiveCache.set(k, v);
}

/** 清空业务目标层缓存（测试缝：模拟进程重启 / 隔离不同 test 的状态；⛔ 生产不调）。 */
export function resetObjectiveCacheForTest(): void {
  objectiveCache.clear();
  objectiveCacheDir = null;
}

/** 业务目标层缓存的只读快照（测试断言「入缓存 / 不入缓存」用；⛔ 生产不调）。 */
export function objectiveCacheSnapshot(): ReadonlyMap<string, ObjectiveCacheEntry> {
  return objectiveCache;
}

/** 业务目标层的选项。 */
export interface ObjectiveVerdictOpts {
  /** 覆盖判定器命令前缀（测试缝；prompt 作末参数追加）。null/undefined ⇒ launchArgv("fix-worker") 真 LLM；
   *  空数组 ⇒ not-evaluated（不可用）。 */
  objectiveCmd?: string[] | null;
  /** 覆盖 spawn 超时（缺省 = SUFFICIENCY_TIMEOUT_MS）。 */
  objectiveTimeoutMs?: number;
  /** 缓存落盘目录（.quay 类）；null/undefined ⇒ 只内存缓存（测试默认，不污染 repo .quay/）。 */
  objectiveCacheDir?: string | null;
  /** 证据载体清单覆盖（缺省 OBJECTIVE_EVIDENCE_CARRIERS）。 */
  evidenceCarriers?: readonly string[];
}

/** 单次业务目标层采样（一次 LLM spawn）。⛔ 不可用 / 超时 / 读不懂 ⇒ not-evaluated，绝不回落
 *  substantiated（parseObjectiveJudge 的 fail-closed）。同 sampleSemanticSufficiency 的形状。 */
async function sampleObjectiveJudge(
  goal: Record<string, unknown>,
  inScopeAcs: Array<Record<string, unknown>>,
  evidence: ObjectiveEvidenceRecord[],
  root: string,
  opts: ObjectiveVerdictOpts,
): Promise<{ parsed: ObjectiveJudgeParse; cause: ObjectiveNotEvaluatedCause | null }> {
  const prompt = buildObjectivePrompt(goal, inScopeAcs, evidence, root);
  let argv: string[];
  try {
    if (opts.objectiveCmd != null) {
      if (opts.objectiveCmd.length === 0) {
        return { parsed: { verdict: "not-evaluated", field: null, value: null }, cause: "judge-unavailable" };
      }
      argv = [...opts.objectiveCmd, prompt];
    } else {
      argv = launchArgv("fix-worker", prompt, root);
    }
  } catch {
    return { parsed: { verdict: "not-evaluated", field: null, value: null }, cause: "judge-unavailable" };
  }
  const r = await runAsync(argv, { timeoutMs: opts.objectiveTimeoutMs ?? SUFFICIENCY_TIMEOUT_MS });
  if (r.error) return { parsed: { verdict: "not-evaluated", field: null, value: null }, cause: "judge-unavailable" };
  if (r.status !== 0) return { parsed: { verdict: "not-evaluated", field: null, value: null }, cause: "judge-unavailable" };
  const parsed = parseObjectiveJudge(r.stdout, r.status);
  if (parsed.verdict === "not-evaluated") {
    return { parsed, cause: "judge-unparseable" };
  }
  return { parsed, cause: null };
}

/** 把一次判定器的输出落成**可复核的**判决（纯函数，⛔ 不 spawn、⛔ 不写盘）——本层「输出不可复核」
 *  这个症状的修法落点，四条分支**互不同形**：
 *    substantiated                ⇒ 接受（无需指认：拿不出指认的是「不充分」这一侧）。
 *    unsubstantiated + 指认       ⇒ **机械复核**；复核过 ⇒ 接受并带上 matched/total/command；
 *                                    复核不过 ⇒ not-evaluated(cause=assertion-unverifiable)。
 *    unsubstantiated 无指认       ⇒ not-evaluated(cause=assertion-missing)（AC3 负控制：⛔ 不默认 covered）。
 *    not-evaluated                ⇒ 原样透传（cause 由调用侧给）。 */
export function adjudicateObjectiveJudgment(
  parsed: ObjectiveJudgeParse,
  evidence: ObjectiveEvidenceRecord[],
): ObjectiveVerdictDetail {
  const profile = objectiveEvidenceProfile(evidence);
  if (parsed.verdict === "not-evaluated") {
    return { verdict: "not-evaluated", cause: "judge-unparseable", assertion: null, profile };
  }
  if (parsed.verdict === "substantiated") {
    return { verdict: "substantiated", cause: null, assertion: null, profile };
  }
  // unsubstantiated：指认缺失 ⇒ 不可复核的判决不得冒充结论。
  if (parsed.field === null || parsed.value === null) {
    return { verdict: "not-evaluated", cause: "assertion-missing", assertion: null, profile };
  }
  const check = verifyObjectiveAssertion(parsed.field, parsed.value, evidence);
  if (!check.ok) {
    return { verdict: "not-evaluated", cause: "assertion-unverifiable", assertion: null, profile };
  }
  const acs = [...new Set(evidence.map((e) => e.ac))].sort();
  const carriers = [...new Set(evidence.map((e) => e.carrier))].sort();
  return {
    verdict: "unsubstantiated",
    cause: null,
    assertion: {
      kind: "single-value-field",
      field: parsed.field as ObjectiveAssertionField,
      value: parsed.value,
      acs,
      carriers,
      matched: check.matched,
      total: check.total,
      command: objectiveAssertionCommand(acs, parsed.field, parsed.value, carriers),
    },
    profile,
  };
}

/** 业务目标层判定（第二层提问 + 指认 + 机械复核 + 确定性缓存 + 成因拆分）。
 *
 *  输入：goal（标题/正文）、在域 AC、**证据记录**（已达成 AC 的载体记录，⛔ 缺了它判定器结构上看不见
 *  「证据同质」）、以及 .quay 目录与 root。
 *
 *  确定性（同第一层的三条纪律）：
 *  ① 命中缓存 ⇒ 直接返回（判决 + 指认一并返回，⛔ 不重问 LLM）；objectiveCacheDir 指定时落盘跨重启；
 *  ② 未命中 ⇒ 2 次独立采样，2 次一致才入缓存；不一致 ⇒ not-evaluated(cause=samples-disagree)、
 *     不入缓存、下轮再试（⛔ 不取多数票）；
 *  ③ 零证据记录 ⇒ not-evaluated(cause=no-evidence-records)，⛔ 不问 LLM 也不入缓存（无可判之据）。
 */
export async function objectiveSufficiencyVerdictDetail(
  goal: Record<string, unknown>,
  inScopeAcs: Array<Record<string, unknown>>,
  evidence: ObjectiveEvidenceRecord[],
  root: string,
  opts: ObjectiveVerdictOpts = {},
): Promise<ObjectiveVerdictDetail> {
  const key = objectiveCacheKey(goal, inScopeAcs, evidence);
  if (opts.objectiveCacheDir) ensureObjectiveCacheLoaded(opts.objectiveCacheDir);
  const cached = objectiveCache.get(key);
  if (cached !== undefined) {
    return { verdict: cached.verdict, cause: null, assertion: cached.assertion, profile: objectiveEvidenceProfile(evidence) };
  }
  if (evidence.length === 0) {
    return { verdict: "not-evaluated", cause: "no-evidence-records", assertion: null, profile: objectiveEvidenceProfile(evidence) };
  }
  const s1 = await sampleObjectiveJudge(goal, inScopeAcs, evidence, root, opts);
  if (s1.cause !== null) {
    return { verdict: "not-evaluated", cause: s1.cause, assertion: null, profile: objectiveEvidenceProfile(evidence) };
  }
  const s2 = await sampleObjectiveJudge(goal, inScopeAcs, evidence, root, opts);
  if (s2.cause !== null) {
    return { verdict: "not-evaluated", cause: s2.cause, assertion: null, profile: objectiveEvidenceProfile(evidence) };
  }
  const sameJudgment =
    s1.parsed.verdict === s2.parsed.verdict && s1.parsed.field === s2.parsed.field && s1.parsed.value === s2.parsed.value;
  if (!sameJudgment) {
    return { verdict: "not-evaluated", cause: "samples-disagree", assertion: null, profile: objectiveEvidenceProfile(evidence) };
  }
  const detail = adjudicateObjectiveJudgment(s1.parsed, evidence);
  if (detail.verdict === "not-evaluated") return detail; // 指认缺失/不成立 ⇒ 不入缓存（下轮再判）
  objectiveCache.set(key, { verdict: detail.verdict, assertion: detail.assertion, ts: new Date().toISOString() });
  if (opts.objectiveCacheDir) writeCacheMap(opts.objectiveCacheDir, OBJECTIVE_CACHE_BASENAME, objectiveCache);
  return detail;
}

/** 业务目标层的【仅裁决】视图（需要指认/成因/概况的路径用 objectiveSufficiencyVerdictDetail）。 */
export async function objectiveSufficiencyVerdict(
  goal: Record<string, unknown>,
  inScopeAcs: Array<Record<string, unknown>>,
  evidence: ObjectiveEvidenceRecord[],
  root: string,
  opts: ObjectiveVerdictOpts = {},
): Promise<ObjectiveVerdict> {
  return (await objectiveSufficiencyVerdictDetail(goal, inScopeAcs, evidence, root, opts)).verdict;
}

// ── 缺口态族（G7 + G9 stalled + done-unresolved 三分，硬规则 3b：读不懂输入不得返回与「合格」同形——
//    「缺口」/「无牵引」/「未评估」分离；硬规则 3：枚举不布尔——每一种成因一个不同形的取值）──

/** 单条 AC 的缺口态（十态并存，not-evaluated 保留——读不到 tasks 输入与「缺口/无牵引」不同形，硬规则 3b）：
 *  in-progress       有任务推进（todo/ready/needs-human 有牵引）
 *  gap               真缺口：零关联任务（无任何 goal_ac==ac 的任务）⇒ 该 spawn 立案
 *  workable          **有关联任务、但全部为非牵引态**（done/superseded 等）而 AC 判据仍未达成，**且判据的
 *                    真值是一个仓库内的工作产物**（代码/文件/测试——`classifyCriterionKind` 判它**不**读
 *                    生产载体）⇒ 还有一个 worker 能改变它 ⇒ 该 spawn 立案。补上 standing-violated /
 *                    frozen-violated 已有的那道守卫的另一半：曾经 done 的关联任务**不覆盖回归**（那正是
 *                    「回归后再无人立案」的成因），只有 todo/ready/needs-human 才算有人接手
 *                    （gap-done-unresolved-conflates-workable-with-world-gated）。⛔ 与 `gap` 不同形：
 *                    这边有关联任务（taskCount ≥ 1），那边零关联（taskCount 0）。
 *  world-gated       **有关联任务、但全部为非牵引态**而判据仍未达成，**且判据读生产载体**
 *                    （`.quay/<file>`——由生产写入、不在仓库工作产物内，见 `readsProductionCarrier`）：
 *                    它的真值是**立案之后的未来生产事件**（CI 跑了一次、切了一个 release tag），
 *                    **没有任何 worker 能产出它** ⇒ ⛔ 不 spawn worker（派了也产不出该事件，是浪费名额），
 *                    改由「每轮 gate 复读 + 轮记录留痕的路由」接住（见 `worldGatedRoutes`）。
 *                    ⛔ 与 `workable` **不同形**：把两者压成一态（旧的 `done-unresolved`）会让 world-gated
 *                    落成终点黑洞——任务做完了、判据仍红、机制按设计不立案 ⇒ 永久静默、无人立案
 *                    （硬规则 3b：一个判定的输出词表里没有「谁去复读生产事件」这一态，就无法区分
 *                    「工作没做够」与「等世界变化」）。
 *  unclassified      **判别器读不到 / 解析不出判据载体**（criterion 缺失或为空 ⇒ 无法机械判定它读不读生产
 *                    载体）⇒ 独立取值。⛔ 既不与 `workable` 也不与 `world-gated` 同形，且**不消耗 spawn
 *                    名额**（硬规则 3b：读不懂不得冒充任一实质态；也⛔ 不得静默——静默会与「无工作可立」
 *                    同形）。
 *  stalled           有任务但都无法自行前进（G9 结构判据）
 *  not-evaluated     读不到 tasks 输入（taskFacts==null），或 **AC-216 复验域**读不到 I5 读数（standings==null）
 *  standing-ok       **AC-216 复验域**专有：常设不变式（achieved ∧ long-term ∧ GOAL 非 active）此刻
 *                    **成立**（I5 没把它列进 achievedButFailing）⇒ 无工作可立，⛔ 不 spawn
 *  standing-violated **AC-216 复验域**专有：常设不变式**此刻违反**（I5 列出了它）且**没有任何在飞任务**在
 *                    处理它 ⇒ 该 spawn 立案。⛔ 与 `workable` 不同形：曾经 done 的关联任务**不覆盖回归**
 *                    （那正是「回归后再无人立案」的成因），只有 todo/ready/needs-human 才算有人接手
 *                    （gap-meta-computegoalgaps；硬规则 3 同族——同一容器两类 population，
 *                    用只覆盖一类的工具判空会把「无人处理」读成「已解决」）。
 *  frozen-violated   **冻结population 专有**：AC 已 `achieved`、**已经离开复验域**（GOAL 非 active 且未声明
 *                    `long-term`），而台账尾读数说它**此刻为假**，且**没有任何在飞任务**在处理它 ⇒ 该 spawn
 *                    立案。⛔ 与 standing-violated 是**两个** population（域内/域外），故取值必须不同形——
 *                    合并会把「离开域后就没人管」这条正好要修的形态重新藏起来（硬规则 3b）。
 *                    ⛔ 与 `workable` 不同形：曾经 done 的关联任务**不覆盖**「此刻仍为假」，
 *                    只有 todo/ready/needs-human 才算有人接手。
 *  derived-routed    **AC-216 复验域内【真值派生自 ③ 主体population】的判据专有**（本任务缺陷①）：该常设
 *                    判据此刻**违反**，但它的 criterion 读的就是 ③ 的输入面（`check --stale-pass`，
 *                    见 `readsFrozenPopulation`）⇒ 它的真值 =「冻结population 中存在此刻为假的 AC」
 *                    这一命题，而 **③ 才是那个命题的唯一判据、且已在本轮为那条为假的 AC 产出路由**
 *                    （`frozen-violated` / in-progress / stalled）。⇒ ② **不得**再为它独立立案。
 *                    ⛔ 不是 standing-ok：它**此刻确实为假**（说它成立即硬规则 3b 的假绿）。
 *                    ⛔ 不是 not-evaluated：读数在、违反也在，只是成因已由另一个判官接管。
 *                    ⇒ 独立取值。判据 AC-242 本身**不动**（它保持诚实：有此刻为假的冻结 AC 就红）；
 *                    本态只回答「这条红该由谁来消」——归 ③ 的主体 AC，不归这条元判据
 *                    （为它立案会造出 DoD 结构上只能由**别的 AC 的 owner** 关闭的任务，每轮一条）。
 *                    ⚠️ 退路（⛔ 闸不恒开）：若 ③ 本轮读不到 / 未评估 / 并未判 violated，则派生条件
 *                    不成立 ⇒ 回落 `standing-violated` 照旧立案（成因不明时仍要有人看）。
 */
export type GapState = "in-progress" | "gap" | "workable" | "world-gated" | "unclassified" | "stalled" | "not-evaluated" | "standing-ok" | "standing-violated" | "frozen-violated" | "derived-routed";

/** 生产载体（production carrier）路径的机械判别——**判据文本里出现的一个 `.quay/<file>` 路径 token**。
 *
 *  为什么需要它（gap-done-unresolved-conflates-workable-with-world-gated）：一条 active AC 的缺口，
 *  当关联任务全部非牵引（done/superseded）而判据仍未达成时，**成因有两种、处置相反**：
 *    · 判据的真值是一个**仓库内的工作产物**（代码/文件/测试）⇒ 还有 worker 能改变它 ⇒ 该立案（workable）；
 *    · 判据读的是 `.quay/<file>` 这类**由生产写入、不在仓库工作产物内**的载体（ci-runs.jsonl /
 *      release-branch-finish.jsonl …）⇒ 它的真值是**立案之后的未来生产事件**，没有任何 worker
 *      能产出它 ⇒ ⛔ 不 spawn，改由复读路由接住（world-gated）。
 *  两者此前被压成同一个 `done-unresolved` ⇒ 后者是终点黑洞（永久静默、无人立案）。
 *
 *  判定**按位置**（硬规则 2）：输入不是散文，是**可执行的判据文本**本身——`.quay/…` 作为路径
 *  token 出现在判据里就是「这条判据会去读那个载体」，不是「某处提到过」。与 goal-store 的
 *  `readsFrozenPopulation` 同一手法（criterion 文本切词后判 token），⛔ 不重推一套与判据无关的启发式。
 *  `.quay` 必须**成词**出现（前/后一字符都不是 `[\w.-]`）⇒ `my.quay/x`、`.quayx` 这类子串不算。
 *  ⚠️ **目录本身也算**（`(?:\/[\w.*-]+)?` 可省）：生产判据常写成「`.quay` 目录 + 其下的 glob」，
 *  例如 `d = "$T/.quay"` 再对 `d` 做通配匹配（本仓实测 AC-318）——只认 `.quay/<file>` 会漏掉这一
 *  形态，把它误判成 workable 而每轮派一个产不出该事件的 worker。
 *
 *  ⛔ 误判的代价是**有界的**且方向单一：把一条工作产物型判据误判成 world-gated ⇒ 它**不 spawn**
 *  （少派一个 worker，但那条 AC 仍在每轮 gate 集合里被判据复读，且路由留痕可见）；把 world-gated
 *  误判成 workable ⇒ 多派一个 worker（浪费名额，但不会造成永久静默）。两个方向都比「永久静默」轻。 */
export const PRODUCTION_CARRIER_TOKEN_RE = /(?:^|[^\w.-])(\.quay(?:\/[\w.*-]+)?)(?![\w.-])/g;

/** 判据文本里读到的生产载体路径（去重、保序）。⛔ 非判据（缺字段/非字符串）⇒ 空数组。 */
export function productionCarriersOf(criterion: unknown): string[] {
  const s = typeof criterion === "string" ? criterion : "";
  const out: string[] = [];
  for (const m of s.matchAll(PRODUCTION_CARRIER_TOKEN_RE)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** 这条判据是否读生产载体（`productionCarriersOf` 非空）。 */
export function readsProductionCarrier(criterion: unknown): boolean {
  return productionCarriersOf(criterion).length > 0;
}

/** 判据载体的三分类——**与 `GapState` 的三个取值逐字同名**（单一真相源，⛔ 不另立一套词表）。
 *  · world-gated  判据读 `.quay/<file>` 生产载体 ⇒ 真值是未来生产事件（⛔ 无 worker 能产出）。
 *  · workable     判据只读仓库内工作产物 ⇒ 还有 worker 能改变它。
 *  · unclassified **读不到 / 解析不出判据载体**（criterion 缺失或空）⇒ 独立取值（硬规则 3b：
 *                 读不懂不得冒充任一实质态）。 */
export const CRITERION_KINDS = ["world-gated", "workable", "unclassified"] as const;
export type CriterionKind = (typeof CRITERION_KINDS)[number];

/** 一条 AC 的判据属哪一类载体（见 `CRITERION_KINDS`）。空/非字符串 criterion ⇒ `unclassified`。 */
export function classifyCriterionKind(criterion: unknown): CriterionKind {
  const s = typeof criterion === "string" ? criterion.trim() : "";
  if (s === "") return "unclassified";
  return readsProductionCarrier(s) ? "world-gated" : "workable";
}

/** 一条 AC 的缺口读数。taskCount 只在 not-evaluated 时为 null（⛔ 与 0 不同形）。 */
export interface GoalGap {
  goal: string;
  ac: string;
  state: GapState;
  taskCount: number | null;
}

/** ready-pool-check 派生出的「任务能否自行前进」判定（G9 stalled 第四态的结构量，⛔ 不用计时器）。
 *  eligibleTodoIds = todo 任务里 ready-pool-check 判合格（candidates[].eligible===true，可被 promotion
 *  晋升）的集合；excludedReadyIds = ready 任务里被 ready-pool-check 排进 excluded（不可派发）的集合。 */
export interface ReadyPoolJudgment {
  eligibleTodoIds: Set<string>;
  excludedReadyIds: Set<string>;
}

/** 一条关联任务是否「无法自行前进」（G9 stalled 的结构判据）：
 *  todo ⇒ 不在 eligibleTodoIds（晋升门判不合格 / 不在候选，含 fixture/parked）；ready ⇒ 在
 *  excludedReadyIds（被 pool 排除）；needs-human ⇒ 已离开 todo/ready、需人处理（有处理者但
 *  不能自行前进，⛔ 与 judgment 无关）。其余状态（done/superseded）本就不在「推进中」集合
 *  （computeGoalGaps 只数 todo/ready/needs-human）。 */
export function isTaskStuck(task: { id: string; status: string | null }, judgment: ReadyPoolJudgment): boolean {
  if (task.status === "needs-human") return true;
  if (task.status === "todo") return !judgment.eligibleTodoIds.has(task.id);
  if (task.status === "ready") return judgment.excludedReadyIds.has(task.id);
  return false;
}

/** 「牵引」状态集合的单一真相源：一条关联任务处于「推进中」的状态（todo/ready/needs-human）。
 *  done/superseded 等其余状态不是牵引（工作已做过/已放弃）——computeGoalGaps 与 triageDraftAc 都调它
 *  （⛔ 两处各写一份字面量即漂移，硬规则 5b——gap-goal-gap-done-task-not-traction-respawns-every-round AC3）。 */
export function isTractionStatus(status: string | null | undefined): boolean {
  return status === "todo" || status === "ready" || status === "needs-human";
}

/** 本轮 active GOAL 的 id 集合（⛔ 只从 records 投影，不另读一份 GOAL 列表）。 */
export function activeGoalIdsOf(records: Array<Record<string, unknown>>): Set<string> {
  return new Set(
    records
      .filter((r) => String(r.id ?? "").startsWith("GOAL-") && String(r.status ?? "") === "active")
      .map((r) => String(r.id ?? "")),
  );
}

/** AC-216 复验域成员（本次轮读数里的全部）——**每轮 gate 集合与缺口立案集合的唯一枚举点**：
 *  achieved ∧ 声明在 Core 的 `inAchievedReverifyScope` 域内 ∧ GOAL 非 active ∧ criterion 非空。
 *  ⛔ 只做「从 records 枚举成员」这一步，判据本身在 Core（重推一份口径即第二处定义，硬规则 5b）；
 *  ⛔ criterion 为空的不算（与 I5 一致：空 criterion 是 no-criterion 另一种，不是「一条会开始失败的判据」）；
 *  ⛔ 其 GOAL 仍 active 的不在此列（那部分已由 pass 1 原有的 active GOAL 循环 gate，⛔ 不重复跑两遍）。 */
export function standingReverifyAcs(
  records: Array<Record<string, unknown>>,
  activeGoalIds: ReadonlySet<string>,
): Array<Record<string, unknown>> {
  return records.filter((r) => {
    if (!String(r.id ?? "").startsWith("AC-")) return false;
    if (String(r.status ?? "") !== "achieved") return false;
    if (!inAchievedReverifyScope(r, activeGoalIds)) return false;
    if (activeGoalIds.has(String(r.goal ?? ""))) return false;
    return String(r.criterion ?? "").trim() !== "";
  });
}

/** 缺口计算（G7 机械量，SPEC §6.2 ⑤）：对每条【未达成（status=active）AC】与每条【AC-216 复验域内
 *  的 achieved AC】出恰好一条读数。两类 population 的问句不同（硬规则 5 同族：同一个容器里装两类
 *  population 时，只用覆盖一类的工具判空会把非空读成空）：
 *
 *  ① active AC —— 问「有没有牵引」。七态：gap（零关联任务——真缺口 ⇒ 立案）/ **有关联任务但全部非牵引
 *  （done/superseded 等）、判据仍未达成——按判据载体再三分（`classifyCriterionKind`，硬规则 3b 三个取值
 *  互不同形，gap-done-unresolved-conflates-workable-with-world-gated）**：workable（判据只读仓库内工作
 *  产物 ⇒ 还有 worker 能改变它 ⇒ 立案）/ world-gated（判据读 `.quay/<file>` 生产载体 ⇒ 真值是立案之后
 *  的未来生产事件、无 worker 能产出 ⇒ ⛔ 不 spawn，走复读路由）/ unclassified（读不到/解析不出判据 ⇒
 *  独立取值、⛔ 不消耗名额）；另加 stalled（有牵引任务但全都无法自行前进——G9，judgment 提供结构量；
 *  ⚠️ needs-human 亦属 stalled：已离开 todo/ready、需人处理，有处理者但不能自行前进，且与 judgment 无关）
 *  / in-progress（有牵引且可前进）/ not-evaluated（taskFacts == null）。
 *  judgment===null（读不到 ready-pool-check）⇒ 不判 stalled（⛔ 不把「读不懂」伪装成「卡住」，
 *  也不伪装成「推进中」——stalled 只是对 in-progress 的细化，读不懂时回到 in-progress），
 *  ⛔ 例外：关联集合全为 needs-human 时无论 judgment 有无都判 stalled（needs-human 不需要
 *  ready-pool 结构量即可判定「不能自行前进」）。
 *  ⛔ 本仓任务无独立 in-flight 态——派发中的任务 status 仍为 todo/ready，故「牵引」集合 =
 *  {todo, ready, needs-human}（单一真相源 = isTractionStatus）。done/superseded 等非牵引态
 *  不再与「零关联任务」同判 gap（gap-goal-gap-done-task-not-traction-respawns-every-round）；
 *  draft/superseded/retired 的 AC 不是缺口对象（未激活 / 已放弃）。
 *  ⚠️ workable / world-gated / unclassified 三态**共用同一前置**（有关联任务、全非牵引、判据未达成），
 *  分歧点**只在判据载体**（`classifyCriterionKind`）——⛔ 不是三条独立的启发式。
 *  ⚠️ 上述「判据载体三分」在**先读本轮判据读数**之后才轮得到（`verdicts` 入参）：
 *  一条判据可以在正文里【没有任何 `.quay/` token】的情况下**自陈无法评估**（criterion exit 3 ⇒
 *  `gateCriterion` 判 `not-evaluated`），此时按文本把它当 `workable` 立出的 worker 无论产出什么都改不了
 *  它的真值（真值等的是世界/人的动作）⇒ 每轮空转一个名额。三个取值互不同形（硬规则 3b）：
 *    · `verdicts.get(ac) === "not-evaluated"` ⇒ `state: "not-evaluated"`、`taskCount: null`
 *      （⛔ 不与 `workable` 同形；`isFilingGapState` 为 false ⇒ 不 spawn）。
 *    · `"fail"` / 读不到（`nil`/map 无此项）⇒ **回落今日行为**（按判据载体分类）——⛔ 缺值 ≠ 为假
 *      （硬规则 6），不得静默变成「查不成 ⇒ 不立案」。
 *    · `"pass"` 到不了这里：pass 1 已把 `verdict==="pass" && status==="active"` 的 AC 机械翻 achieved
 *      （下面的 `status !== "active"` 已跳过它）。
 *  `verdicts === null`（缺省；既有调用方/单测不传）⇒ 逐字节保持今日行为。
 *  （gap-goal-active-ac-gap-classification-ignores-round-verdict）
 *
 *  ② AC-216 复验域（achieved ∧ long-term ∧ GOAL 非 active，`standingReverifyAcs`）—— 问「此刻成立吗」
 *  （`standings` = I5 `check --achieved-failing` 的读数，goal-store 单一实现）。三态：standing-ok
 *  （域内且此刻成立 ⇒ 无工作可立）/ standing-violated（域内且此刻违反 且【没有在飞任务】⇒ 该 spawn
 *  立案；⛔ done 的关联任务不压下——它不覆盖回归）/ not-evaluated（读不到 taskFacts 或读不到 I5 读数）。
 *  ⚠️ 第四态 `derived-routed`：违反的是**真值派生自 ③ 主体population** 的判据（criterion 读 ③ 的输入面
 *  `check --stale-pass`）且 ③ 本轮已判 `violated` ⇒ ② 让位，不独立立案（见 GapState 的该条注释与
 *  `readsFrozenPopulation`）。
 *  ⚠️ 第五态 `not-evaluated` 的第二个来源：I5 判违反、而**立案前复核**（`recheckStandingFailing`，
 *  `standingRecheck` 入参）跑不成 ⇒ 独立取值 not-evaluated（⛔ 既不与 standing-ok 也不与
 *  standing-violated 同形）；复核 `cleared` ⇒ 不产生读数（那次 fail 是读数失准，⛔ 不立案）。
 *  违反但已有在飞任务 ⇒ 复用 ① 的 in-progress / stalled。⛔ 此前这个域只被 I5 跑、不进本读数：
 *  achievedButFailing 只落轮读数与一行日志，「违规」既无写入者也无执行者
 *  （gap-meta-computegoalgaps）。
 *
 *  ③ **冻结population**（achieved ∧ criterion 非空 ∧ ⛔ 不在 `inAchievedReverifyScope`）—— 问
 *  「此刻为假吗」（`frozen` = `check --stale-pass` 的读数，goal-store 单一实现、纯读、零 criterion
 *  执行）。也就是「已离开复验域、却仍被记录为假」这一禁态。⛔ 它在 ①/② 里**都没有分支**：不 active
 *  故不进 ①、不在域内故不进 ② ⇒ 此前一条读数都不产生，检测得到（AC-242 每轮红）却**没有消费者**。
 *  四态：frozen-violated（此刻为假 且【没有在飞任务】⇒ 该 spawn 立案；⛔ done/superseded 的关联任务
 *  **不**压下——它不覆盖「此刻仍为假」）/ 违反但已有在飞任务 ⇒ 复用 ① 的 in-progress / stalled /
 *  not-evaluated（读不到读数 ⇒ 逐条 not-evaluated，⛔ 绝不与「查过且零违反」同形，硬规则 3b）/
 *  其余（查过且此刻为真）⇒ **不产生读数**（population 78 条，无事可立；⛔ 但「查不成」必须产生，
 *  否则读不到被静默读成「全好」）。
 *  ⛔ 成本上界与 AC-242 判据同量级（纯读台账 + frontmatter，零 criterion 执行）——⛔ 不是把 78 条
 *  域外 AC 无差别纳入每轮复跑（那是 AC-216 已裁定的成本边界之外的放宽；重跑归**有界轮转**
 *  `sweepFrozenAcs`，它每轮至多 budget 条）。 */
export function computeGoalGaps(
  records: Array<Record<string, unknown>>,
  taskFacts: Array<{ id: string; status: string | null; goalAc: string | null }> | null,
  judgment: ReadyPoolJudgment | null = null,
  standings: { achievedButFailing: string[]; evaluated: boolean } | null = null,
  frozen: FrozenFailingReading | null = null,
  frozenRecheck: PrefilingRecheckReading | null = null,
  standingRecheck: PrefilingRecheckReading | null = null,
  verdicts: Map<string, "pass" | "fail" | "not-evaluated"> | null = null,
): Array<GoalGap> {
  const activeGoalIds = activeGoalIdsOf(records);
  // 三类 population 落在同一个 gaps 读数里（⚠️ 但判据不同——见上）：
  //   ① active AC：牵引四态（G7/G9）。
  //   ② AC-216 复验域的常设不变式：按 I5 复验读数判「此刻成立 / 此刻违反 / 读不到」。
  //   ③ 冻结population：按 `check --stale-pass` 的读数判「此刻为假 / 查不成」。
  // 集合取自 standingReverifyAcs / frozenAchievedAcs（与每轮 gate 集合、轮转集合同一处判据
  // `inAchievedReverifyScope`，⛔ 不各自重推一遍口径——硬规则 5b）。
  const standingIds = new Set(standingReverifyAcs(records, activeGoalIds).map((r) => String(r.id ?? "")));
  const standingFailing = standings === null ? null : new Set(standings.achievedButFailing);
  // ③ 的成员 = 域外（未声明 long-term 且 GOAL 非 active）∧ achieved ∧ criterion 非空。与 goal-store 的
  // `frozenAchievedAcs()` **同谓词**（同一处 `inAchievedReverifyScope` + 同一条 criterion 非空规则）。
  const frozenIds = new Set(
    records
      .filter(
        (r) =>
          String(r.id ?? "").startsWith("AC-") &&
          String(r.status ?? "") === "achieved" &&
          !inAchievedReverifyScope(r, activeGoalIds) &&
          String(r.criterion ?? "").trim() !== "",
      )
      .map((r) => String(r.id ?? "")),
  );
  const frozenReading = frozen;
  const out: Array<GoalGap> = [];
  for (const r of records) {
    const id = String(r.id ?? "");
    if (!id.startsWith("AC-")) continue;
    const goal = String(r.goal ?? "");
    // ③ 冻结population：问句是「此刻为假吗」，⛔ 不是「有没有任务」。先于 ① 判定（③ 的成员在 ① 里
    // 本就被 `status !== "active"` 排除，顺序不影响结果；放在前面只为让「谁在管这条 AC」一目了然）。
    if (frozenIds.has(id)) {
      if (frozenReading === null || frozenReading.judgment === "not-evaluated") {
        // 读不到（本文件未传读数 / spawn 失败 / 台账读不到 / 轮转从未跑过 / 判据声明无法评估）⇒
        // 独立取值 not-evaluated（taskCount null）。⛔ 绝不与「查过且零违反」同形（硬规则 3b）。
        out.push({ goal, ac: id, state: "not-evaluated", taskCount: null });
        continue;
      }
      if (frozenReading.judgment === "clean") continue; // 查过且此刻为真 ⇒ 无工作可立（⛔ 不产生读数）
      if (!frozenReading.failing.includes(id)) continue; // 查过且有违反，但不是这一条
      // ── 立案前【直接量复核】（gap-frozen-violated-files-on-stale-verdict）────────────────────
      // 台账尾的 `fail` 是一条**轮转 verdict**，新鲜度界 4h ≫ 轮转周期 13–101 min ⇒ 修复落地后
      // 尾读数最长数小时仍写 `fail`。立案**不得**拿它当「现在」（那是硬规则 4b 的形态：代理量被当
      // 直接量）。复核结局按三态分派，⛔ 三态互不同形：
      //   · `cleared`（复核后 exit 0）⇒ 台账尾是**陈旧读数** ⇒ ⛔ 不立案（也不产生读数——此刻无工作可立）。
      //   · `not-evaluated`（复核跑不成：闸拒绝 / 命令读不出）⇒ **独立取值** `not-evaluated`
      //     （taskCount null）。⛔ 既不与「复核通过」也不与「复核后仍为假」同形（硬规则 3b）。
      //   · **第三个成因 `checkout-lagging-develop`（gap-frozen-recheck-lagging-checkout-false-
      //     gap-filing）在前一条之外**：那条 fail 量的是**滞后的执行根**、不是 develop 的实况 ⇒
      //     本读数对它**不产出任何条**（`continue`）——即「本轮无工作可立」，与 `cleared` 在
      //     本函数里的落点相同。⛔ 这不是「与 cleared 同形」：区分它们的载体是 `frozenRecheck.entries`
      //     （那边两条的 `outcome`+`cause` 逐条不同：`cleared`/`now-true` vs
      //     `not-evaluated`/`checkout-lagging-develop`）——本函数的落点只回答「这一轮要不要有人做」，
      //     而**这两条都不需要有人做**（一条是「此刻为真」，一条是「此刻不知道，等下一次复核」）。
      //   · `confirmed-failing`（复核后仍非 0）⇒ 立案照旧。
      //   · 未传复核读数（`null`，既有调用方/单测的缺省）⇒ 照旧立案（fail-visible：漏传不得静默
      //     变成「复核通过」）。
      const rc = frozenRecheck === null ? null : frozenRecheck.entries.find((e) => e.ac === id) ?? null;
      if (rc !== null && rc.outcome === "cleared") continue;
      // 复核根滞后 develop ⇒ 本读数**不产出任何条**（AC1：「该轮 computeGoalGaps 不产出该 AC 的
      // frozen-violated（`gaps` 无该条、`gap_spawns` 为空）」）：那条 fail 量的是滞后的根、不是
      // develop 的实况 ⇒ 本轮**无可立**（等下一次复核，届时主检出已同步）。
      // ⛔ 与上面 `unreadable`/`guard-refused` 的 not-evaluated **不同形是刻意的**：那两条的意思是
      // 「这一轮没查成 ⇒ 该有人看一眼」，而本条的意思是「这一轮问错了根 ⇒ 下一轮再问」——把后者也
      // 落成 not-evaluated 会在主检出落后 develop 的整段窗口里每轮产出一条恒清不掉的读数。
      // ⛔ 「查过且合格」与「根滞后没查成」仍**可区分**——载体是 `frozenRecheck.entries`（AC5）。
      if (rc !== null && rc.outcome === "not-evaluated" && rc.cause === "checkout-lagging-develop") continue;
      if (rc !== null && rc.outcome === "not-evaluated") {
        out.push({ goal, ac: id, state: "not-evaluated", taskCount: null });
        continue;
      }
      // 此刻为假 ⇒ 要有人做。只有「在飞任务」压下立案（同 ②：done/superseded ⛔ 不压下）。
      const inFlight = taskFacts === null ? null : taskFacts.filter((t) => t.goalAc === id && isTractionStatus(t.status));
      if (inFlight === null) {
        out.push({ goal, ac: id, state: "not-evaluated", taskCount: null });
      } else if (inFlight.length === 0) {
        out.push({ goal, ac: id, state: "frozen-violated", taskCount: 0 });
      } else if (inFlight.every((t) => t.status === "needs-human")) {
        out.push({ goal, ac: id, state: "stalled", taskCount: inFlight.length });
      } else if (judgment !== null && inFlight.every((t) => isTaskStuck(t, judgment))) {
        out.push({ goal, ac: id, state: "stalled", taskCount: inFlight.length });
      } else {
        out.push({ goal, ac: id, state: "in-progress", taskCount: inFlight.length });
      }
      continue;
    }
    const isStanding = standingIds.has(id);
    if (isStanding) {
      // 常设不变式：问句是「此刻成立吗」，⛔ 不是「有没有任务」。读不到（无 tasks 输入 / I5 未评估）
      // 给独立取值 not-evaluated——⛔ 绝不与 standing-ok 同形（硬规则 3b）。
      if (taskFacts === null || standingFailing === null) {
        out.push({ goal, ac: id, state: "not-evaluated", taskCount: null });
        continue;
      }
      if (!standingFailing.has(id)) {
        out.push({ goal, ac: id, state: "standing-ok", taskCount: 0 });
        continue;
      }
      // ── 立案前【直接量复核】（gap-standing-violated-false-spawn-no-prefiling-recheck）────────────
      // `standingFailing` 是 I5 本轮的读数、**没有时差**（这点与 ③ 相反），但它只有**一次**：宿主进入
      // 不健康态（2026-09-16 实测 ENOSPC）时那一次为真值为真的常设判据给出 fail，据此 spawn 一个
      // prompt 逐字断言「保证已回归」的 agent ⇒ 给下游指一个**不存在的缺陷**（那轮之后逐条复测，判据
      // 11 次全绿）。⇒ 立案前**再跑一次**：两次直接量一致才立案。三态分派，⛔ 三态互不同形（硬规则 3b）：
      //   · `cleared`（复核后 exit 0）⇒ 那次 fail 是**读数失准** ⇒ ⛔ 不立案，也不产生读数
      //     （此刻确无工作可立——与 standing-ok 同形的静默是正确的，因为真值为真）。
      //   · `not-evaluated`（复核跑不成：闸拒绝 / 命令读不出 / **复核根滞后 develop**）⇒ **独立取值**
      //     `not-evaluated`（taskCount null）。⛔ 既不与「复核通过」（无读数）也不与「复核后仍为假」
      //     （standing-violated）同形。第三个成因是 gap-frozen-recheck-lagging-checkout-false-gap-filing
      //     加的（共用核 ⇒ 共用三态）；⚠️ 本分支**必须**落 not-evaluated 而**不能**静默——这里静默会
      //     直接掉到下面的 standing-violated ⇒ **照旧立案**，正是该任务要挡住的那个动作（③ 分支的落点
      //     与这里不同，理由写在 ③ 的对应注释里：那里的静默落点 = 「本轮无工作可立」）。
      //   · `confirmed-failing`（复核后仍非 0）⇒ 立案照旧。
      //   · 未传复核读数（`null`，既有调用方/单测的缺省）⇒ 照旧立案（fail-visible：漏传不得静默
      //     变成「复核通过」）。
      // ⛔ 位置：在**派生判据**之前——若复核已说明此刻为真，则「这条红该由谁消」的问句不成立。
      const src = standingRecheck === null ? null : standingRecheck.entries.find((e) => e.ac === id) ?? null;
      if (src !== null && src.outcome === "cleared") continue;
      if (src !== null && src.outcome === "not-evaluated") {
        out.push({ goal, ac: id, state: "not-evaluated", taskCount: null });
        continue;
      }
      // 派生判据（本任务缺陷①）：这条常设判据读的就是 ③ 的输入面 ⇒ 它的真值是「冻结population 中
      // 存在此刻为假的 AC」这一命题的派生量，而那个命题的**唯一判据与执行者都是 ③**。③ 已在本轮为
      // 那条为假的 AC 产出了路由（frozen-violated / in-progress / stalled，见上面的 ③ 分支）⇒ ②
      // **不再**为这条元判据独立立案：为它立案会造出 DoD 结构上只能由【别的 AC 的 owner】关闭的任务
      // （AC-242 的复绿条件不在它自己的域内），每轮一条、永远关不掉。
      // ⛔ 复用 ③ 已算出的态（⛔ 不在此处新写一份「有没有主」的判定——那是硬规则 5b）：本分支只读
      // `frozenReading.judgment`，即 ③ 的读数本身。
      // ⛔ 闸不恒开：③ 读不到 / 未评估 / 并未判 violated ⇒ 派生条件不成立 ⇒ 回落 standing-violated
      // 照旧立案（成因不明时仍要有人看，硬规则 6：缺值 = 未查 ≠ 为假）。
      // 返回 `taskCount: null`：本态回答的不是「有几条任务是它的」（⛔ 与 0 不同形）。
      if (readsFrozenPopulation(String(r.criterion ?? "")) && frozenReading !== null && frozenReading.judgment === "violated") {
        out.push({ goal, ac: id, state: "derived-routed", taskCount: null });
        continue;
      }
      // 此刻违反 ⇒ 要有人做。**只有「在飞任务」才压下新一轮立案**：done/superseded 的关联任务
      // ⛔ 不压下（它不覆盖回归——那正是「回归后再无人立案」的成因，与 ① 的 `workable` 同一条守卫）。
      // 有一条在飞任务被立案后即由下面的牵引态接手，故不会每轮重复 spawn。
      const inFlight = taskFacts.filter((t) => t.goalAc === id && isTractionStatus(t.status));
      if (inFlight.length === 0) {
        out.push({ goal, ac: id, state: "standing-violated", taskCount: 0 });
      } else if (inFlight.every((t) => t.status === "needs-human")) {
        out.push({ goal, ac: id, state: "stalled", taskCount: inFlight.length });
      } else if (judgment !== null && inFlight.every((t) => isTaskStuck(t, judgment))) {
        out.push({ goal, ac: id, state: "stalled", taskCount: inFlight.length });
      } else {
        out.push({ goal, ac: id, state: "in-progress", taskCount: inFlight.length });
      }
      continue;
    }
    if (String(r.status ?? "") !== "active") continue;
    if (taskFacts === null) {
      out.push({ goal, ac: id, state: "not-evaluated", taskCount: null });
      continue;
    }
    // 关联任务 = 所有 goal_ac==id 的任务（任意状态）；牵引 = 其中的 todo/ready/needs-human。
    const allAssociated = taskFacts.filter((t) => t.goalAc === id);
    const traction = allAssociated.filter((t) => isTractionStatus(t.status));
    const count = traction.length;
    let state: GapState;
    // ⛔ `number | null`：not-evaluated 时 taskCount 是 null（⛔ 与 0 不同形，硬规则 3b）——「有几条任务
    // 是它的」这个问句在「没查成」时没有答案。
    let taskCount: number | null;
    if (allAssociated.length === 0) {
      state = "gap";                  // 真缺口：零关联任务 ⇒ 该 spawn 立案
      taskCount = 0;
    } else if (count === 0) {
      // 有关联任务但全部非牵引（done/superseded）而判据仍未达成 ⇒ 按**判据载体**机械三分
      // （gap-done-unresolved-conflates-workable-with-world-gated；此前压成一个 done-unresolved，
      // 使生产事件型落成终点黑洞：任务做完了、判据仍红、机制按设计不立案 ⇒ 永久静默）：
      //   workable     —— 判据只读仓库内工作产物 ⇒ 还有 worker 能改变它 ⇒ 立案（isFilingGapState）。
      //   world-gated  —— 判据读 `.quay/<file>` 生产载体 ⇒ 真值是立案之后的未来生产事件、
      //                   ⛔ 无 worker 能产出 ⇒ 不消耗名额，走 `worldGatedRoutes` 的复读路由并留痕。
      //   unclassified —— 读不到/解析不出判据（criterion 缺失或空）⇒ 独立取值（硬规则 3b），⛔ 不 spawn。
      // ⛔ 三态共用同一前置、只分歧在载体 ⇒ 不是三条独立启发式（单一真相源 = classifyCriterionKind）。
      // ⚠️ 先读**本轮判据读数**（`verdicts`，pass 1 的 criteria[] 投影）：判据可以自陈无法评估（exit 3）
      // 而正文里没有任何 `.quay/` token ⇒ 文本分类会误判成 workable（每轮空转一个 worker，而它的真值
      // 等的是世界/人的动作）。⇒ `not-evaluated` 独占一态（taskCount null，⛔ 不与 workable 同形，
      // 硬规则 3b），`fail`/读不到回落下面的文本分类（⛔ 缺值 ≠ 为假，硬规则 6）。
      // （gap-goal-active-ac-gap-classification-ignores-round-verdict）
      const roundVerdict = verdicts === null ? null : verdicts.get(id) ?? null;
      if (roundVerdict === "not-evaluated") {
        state = "not-evaluated";
        taskCount = null;
      } else {
        state = classifyCriterionKind(r.criterion);
        taskCount = allAssociated.length; // 枚举关联数（⛔ 非布尔化，硬规则 3）
      }
    } else if (traction.every((t) => t.status === "needs-human")) {
      state = "stalled";
      taskCount = count;
    } else if (judgment !== null && traction.every((t) => isTaskStuck(t, judgment))) {
      state = "stalled";
      taskCount = count;
    } else {
      state = "in-progress";
      taskCount = count;
    }
    out.push({ goal, ac: id, state, taskCount });
  }
  return out;
}

/** 从 records 取一条记录（GOAL/AC）的 title（读不到 ⇒ ""）。 */
function recordTitleOf(records: Array<Record<string, unknown>>, id: string): string {
  const r = records.find((x) => String(x.id ?? "") === id);
  return r ? String(r.title ?? "") : "";
}

/** 从 records 取一条 AC 的 expect（读不到 ⇒ ""）。 */
function acExpectOf(records: Array<Record<string, unknown>>, id: string): string {
  const r = records.find((x) => String(x.id ?? "") === id);
  return r ? String(r.expect ?? "") : "";
}

/** 读 ready-pool-check 的判定面（G9 stalled 第四态的结构量来源）。缺省命令 = 全池 --json；
 *  readyPoolCmd = 测试缝。读不懂/非零退出 ⇒ null（⛔ 与「零 stuck」不同形——judgment=null 时
 *  computeGoalGaps 不判 stalled，回到 in-progress）。 */
export async function readReadyPoolJudgment(root: string, readyPoolCmd: string[] | null = null): Promise<ReadyPoolJudgment | null> {
  const argv = readyPoolCmd ?? kernelSiblingArgv("ready-pool-check.ts", ["--root", root, "--json"]);
  // 机件解析不出 ⇒ null（⛔ 与「零 stuck」不同形——判据面缺失必须可区分；硬规则 3b）。
  if (argv === null) return null;
  const r = await runAsync(argv, { timeoutMs: CRITERION_TIMEOUT_MS });
  if (r.error || r.status !== 0) return null;
  let j: unknown;
  try {
    j = JSON.parse(String(r.stdout ?? "").trim());
  } catch {
    return null;
  }
  if (!j || typeof j !== "object") return null;
  const obj = j as Record<string, unknown>;
  const eligibleTodoIds = new Set<string>();
  for (const c of Array.isArray(obj.candidates) ? obj.candidates : []) {
    if (c && typeof c === "object") {
      const cc = c as Record<string, unknown>;
      if (typeof cc.id === "string" && cc.eligible === true) eligibleTodoIds.add(cc.id);
    }
  }
  const excludedReadyIds = new Set<string>();
  for (const e of Array.isArray(obj.excluded) ? obj.excluded : []) {
    if (e && typeof e === "object" && typeof (e as Record<string, unknown>).id === "string") {
      excludedReadyIds.add(String((e as Record<string, unknown>).id));
    }
  }
  return { eligibleTodoIds, excludedReadyIds };
}

// ── draft AC 分诊（GOAL-010 范围② / AC-210；AC-219 修正 retire 默认分支）───────────────
// 对象集 = active GOAL 名下 status=draft 的 AC（扩 G9 的 active-only 对象集，⛔ 不影响
// computeGoalGaps 只数 active 的口径）。对每条 draft AC 出四态判决之一：
//   activate / re-anchor / needs-human / hold
// 激活判据 =「这条 AC 作为判据是否就绪」（goal 锚合法 + criterion 非空 + 无 posture），⛔ 不是
// 「有没有任务牵引」——牵引是下游调度事实，由 computeGoalGaps 四态读，不决定是否纳入判定
// （gap-goal-driver-ac-activation-gated-on-traction-not-goal-semantics）。activate 判决被 ⑧
// 消费（writeGoalStatus 翻 active）；re-anchor / needs-human / hold 仍只落痕不 flip。
// 「无任务牵引」≠「死信」——刚提案的 draft AC 天然无牵引，分诊为 activate 而非 retire→needs-human
// （AC-219，gap-meta-goal-triage-fresh-draft-not-retire）。
//
// 判决函数是纯函数（record + goal posture ⇒ decision；taskFacts 参数不再参与判决），
// ⛔ 不读进程存活/时钟——使四态可单测（goal-triage.test.mjs），并使 AC-215（posture 挡 activate）可落地。

/** 四态判决词表（AC-210 判据读它；retire 已按 AC-219 移除——「无任务牵引」≠「死信」，放弃归人）。
 *  ⛔ 加态即改判据与 AC-215 的「其余三态」口径。 */
export const TRIAGE_DECISIONS = ["activate", "re-anchor", "needs-human", "hold"] as const;
export type TriageDecision = (typeof TRIAGE_DECISIONS)[number];

/** 一条 draft AC 的分诊落痕：ac 唯一、decision ∈ 四态、reason 非空（逐条落痕，硬规则 3 枚举不布尔）。 */
export interface TriageEntry {
  ac: string;
  decision: TriageDecision;
  reason: string;
}

/** 对一条 draft AC 出四态判决之一。纯函数、确定性、⛔ 不读进程存活/时钟。
 *
 * 输入：
 *  - record     该 draft AC 的 goal-store 视图模型（id / goal / criterion / expect / …）
 *  - goalPosture 所属 GOAL 的 posture（AC-215 的读取端，本任务只收不读——production 侧由 AC-215
 *               从 goal 记录读出后传入；非空即视为「declared hold」，具体词表由 AC-215 定）
 *  - taskFacts  readTaskFacts 的读数（可能 null = 读不到 tasks）。⛔ 不再参与判决——激活判据是
 *               「这条 AC 作为判据是否就绪」，不是「有没有任务牵引」（牵引由 computeGoalGaps 四态
 *               读，不决定是否纳入判定——gap-goal-driver-ac-activation-gated-on-traction-not-
 *               goal-semantics）。
 *
 * 判决顺序（每条各判一个可区分的前置，⛔ 顺序即语义）：
 *  1. re-anchor   goal 锚缺失/非法（非 GOAL-NNN）⇒ 需重指向一条 GOAL-NNN
 *  2. needs-human criterion 缺失/空 ⇒ 无法评估，需人补判据或确认退役
 *  3. hold        goal 声明 posture ⇒ 按住不激活（尊重人「先测量后承诺」的姿态，AC-215）
 *  4. activate    其余（结构完备 = goal 锚合法 + criterion 非空 + 无 posture）⇒ 建议激活进入
 *                 判定。「无任务牵引」≠「死信」也≠「不激活」——刚提案的 draft AC 天然无牵引，
 *                 激活后 computeGoalGaps 会看见它并立案（⛔ 不判退役，AC-219）
 */
export function triageDraftAc(
  record: Record<string, unknown>,
  goalPosture: string | null | undefined,
  taskFacts: Array<{ id: string; status: string | null; goalAc: string | null }> | null,
): TriageEntry {
  const ac = String(record.id ?? "");
  const goalRef = String(record.goal ?? "").trim();
  const criterion = String(record.criterion ?? "").trim();
  const posture = typeof goalPosture === "string" ? goalPosture.trim() : "";

  if (goalRef === "" || !/^GOAL-\d{3,}$/.test(goalRef)) {
    return { ac, decision: "re-anchor", reason: `goal 锚缺失/非法（"${goalRef}"）——需重指向一条 GOAL-NNN` };
  }
  if (criterion === "") {
    return { ac, decision: "needs-human", reason: "无 criterion——无法评估，需人补判据或确认退役" };
  }
  if (posture !== "") {
    return { ac, decision: "hold", reason: `goal 声明 posture "${posture}"——按住不激活（尊重人姿态）` };
  }
  return { ac, decision: "activate", reason: "结构完备（goal 锚合法 + criterion 非空 + 无 posture）——这条 AC 作为判据已就绪，建议激活进入判定（牵引由 computeGoalGaps 读，不决定是否纳入判定）" };
}

// ── G9 缺口语义环（spawn 短命 agent 经 ABI 立案，照 promotion-driver 的 fix-worker 现成形态）──────

/** gap-filing agent 的 prompt：一条 gap AC 的结构化信息（goal/ac/title/expect），⛔ 非散文指令。
 *  agent 立案必须经 quay-file-task（其【按机制去重】步骤防重复立案）；文件须带顶层 goal_ac 供下一轮
 *  readTaskFacts 独立复核（⛔ 不信 agent 自述）。
 *
 *  去重规则**按成因分叉**（`gap.state`）：`gap` 是「从未有人处理」（任何状态的既有认领都算重复）；
 *  `workable` / `standing-violated` / `frozen-violated` 是「判据此刻为假而既有认领已 done」
 *  （done 的既有认领恰恰是**回归 / 修得不彻底**的证据，⛔ 不是重复——按 `gap` 的口径去重会让 agent
 *  每轮都拒绝立案，该缺口就永远没有执行者）。
 *  ⛔ 只对**可立案态**（`isFilingGapState`）有意义：`world-gated`（无 worker 能产出该生产事件）与
 *  `unclassified`（判据读不到）**不该**走到这里（`runGapSpawnPass` 的选取面已排除它们）。 */
export function buildGapWorkerPrompt(gap: GoalGap, goalTitle: string, acTitle: string, acExpect: string, root: string): string {
  const standing = gap.state === "standing-violated";
  const frozen = gap.state === "frozen-violated";
  const workable = gap.state === "workable";
  const regressed = standing || frozen || workable;
  return [
    frozen
      // ⛔ 口径必须是**可核的**：这里曾逐字写「No other mechanism re-runs it, so without a task it
      // stays false forever」——自 AC-242 successor 引入**有界轮转**（每轮抽 subset 重跑、并按年龄排序）
      // 后这句是**假的**，且与 `checkStalePass` 自己的设计注释（「the tail stops being frozen and starts
      // meaning 'the last time we actually looked'」）互相矛盾。⇒ 改为陈述**本轮真的做了什么**：
      // 立案前对这条 AC 跑过一次 criterion（直接量），所以「此刻为假」是**量出来的**，不是台账尾的
      // 陈旧读数（gap-frozen-violated-files-on-stale-verdict）。
      ? "You are a gap-filing agent in the quay repo. An achieved goal criterion (AC) that has LEFT the reverify scope — its GOAL is no longer active and it is NOT declared `long-term: true` — is recorded as CURRENTLY FALSE in the gate ledger. This round RE-RAN its criterion directly before filing (the filing is a direct measurement, not a stale ledger tail), so the criterion is false as of now."
      // ⛔ 常设口径同样必须陈述**本轮真的做了什么**（同 frozen 半边，gap-standing-violated-false-
      // spawn-no-prefiling-recheck）：I5 的那次读数是本轮的、没有时差，但它只有**一次** —— 所以
      // 「此刻为假」是**立案前重跑一次后仍然为假**（两次直接量一致），不是一个孤立的单次读数。
      // 这句不是修辞：它把「一次环境类失准」与「真的回归」在下游 agent 眼里区分开（本任务立案的
      // 正是前者被当成后者）。
      : standing
        ? "You are a gap-filing agent in the quay repo. A STANDING goal criterion (AC) — declared `long-term: true`, already achieved — now FAILS again: the guarantee it asserts has regressed. This round RE-RAN the criterion before filing and it failed a SECOND time, so the regression is confirmed by two independent measurements, not by a single reading."
        : workable
          // ⛔ 与 `gap` 的口径必须分开：`workable` 的关联任务**存在但全已 done/superseded**——工作做过了、
          // 判据仍未达成（做的不够 / 复验没过）。按 `gap`「从未有人处理」的去重口径立案会被 agent 每轮
          // 拒绝（既有认领已存在），缺口就永远没有执行者。
          ? "You are a gap-filing agent in the quay repo. A goal criterion (AC) is still FALSE while every task that claimed it is already done/superseded — the earlier work did NOT hold. Its truth is a repo working product (code / file / test), so a new task CAN still change it. No todo/ready/needs-human task advances it right now."
          : "You are a gap-filing agent in the quay repo. A goal criterion (AC) has a structural gap: no todo/ready/needs-human task advances it.",
    `Repo root: ${root}.`,
    `goal_id=${gap.goal} goal_title=${goalTitle}`,
    `ac_id=${gap.ac} ac_title=${acTitle}`,
    `ac_expect=${acExpect}`,
    "Read the AC record (goal_get MCP) to understand the work it demands, then file ONE child task that closes this gap via the `quay-file-task` skill (Skill tool).",
    ...(regressed
      ? [
          "The quay-file-task skill performs MECHANISM-BASED dedup: if a task claiming this AC via a top-level `goal_ac:` field is still IN FLIGHT (todo/ready/needs-human), do NOT file a duplicate — report the existing task id instead.",
          "⚠️ A `done`/`superseded` task claiming this AC is NOT a duplicate here — it is evidence the earlier fix did not hold. The criterion must be TRUE NOW, so file a NEW task that makes it true again (and say in the task body why the earlier fix did not hold).",
          // frozen-violated 的三条终态（DoD）：⛔ 声明 long-term 是【搬进复验域】而不是消解——它让
          // 「无主红」变成「每轮被重跑的红」，只在「这条保证今天仍必须为真」时才成立。
          ...(frozen
            ? [
                "Legal terminal states for this AC (the driver re-files you every round until one holds): (a) make the criterion TRUE again, so the ledger tail flips to pass; (b) `superseded` the AC record with a WRITTEN reason that the guarantee it asserted is no longer the repo's intent; (c) declare `long-term: true` ONLY IF the guarantee must stay in re-verification — that moves it into the AC-216 reverify scope (re-run every round), it does NOT resolve it.",
              ]
            : []),
        ]
      : [
          "The quay-file-task skill performs MECHANISM-BASED dedup: if a task already claims this AC via a top-level `goal_ac:` field (ANY status, including needs-human), do NOT file a duplicate — report the existing task id instead.",
        ]),
    `The filed task MUST carry top-level frontmatter \`goal_ac: ${gap.ac}\` so the driver's next round can independently verify it (readTaskFacts counts goal_ac).`,
  ].join("\n");
}

/** gap-filing agent argv = launchArgv("fix-worker", <prompt>)（短命，launcher/model/--bare 由
 *  .quay/profiles.yml 的 profiles/roles 承载——AC140 单一构造点；⛔ 本任务 Touches 不含 profiles.yml，
 *  故复用既有 fix-worker role 的 profile，语义由 prompt 承载）。gapWorkerCmd 覆盖【前缀】时把
 *  prompt 作为末参数追加（测试缝捕获真实 prompt，同 promotion 的 --fix-worker-cmd）。 */
export function buildGapWorkerArgv(gap: GoalGap, goalTitle: string, acTitle: string, acExpect: string, root: string, gapWorkerCmd?: string | null): string[] {
  const prompt = buildGapWorkerPrompt(gap, goalTitle, acTitle, acExpect, root);
  if (gapWorkerCmd != null) {
    const prefix = splitArgs(gapWorkerCmd);
    if (prefix.length === 0) return launchArgv("fix-worker", prompt, root);
    return [...prefix, prompt];
  }
  return launchArgv("fix-worker", prompt, root);
}

/** 充分性卡死信号的 agent prompt（AC1）。⛔ 与 buildGapWorkerPrompt 是**两个命题**，故两份 prompt
 *  ⛔ 不合并：G9 问的是「某条 AC 没人推进」（判定对象上的缺口），本条问的是「这组 AC 的**定义**没有
 *  覆盖 GOAL 的退出条件」（判定输入上的缺口）。合并会把「AC 全绿而目标不成立」这条形态重新藏回
 *  「有缺口」里——而那正是本任务立案的那两个实例的共同形态。
 *
 *  ⛔ 边界（同 G9 环 + DIR-131）：只**提议**、只**立案**，⛔ 不写 goal-store、⛔ 不翻任何状态。
 *  proposer 是语义 agent（不是 driver 自己），因为「该补哪条 AC / 退出条件是否写过头」是内容判断，
 *  不是计算——driver 只负责把「判官已经说了不够」这件事变成有人看得见的立案。 */
export function buildSufficiencyFollowupPrompt(
  goal: Record<string, unknown>,
  inScopeAcs: Array<Record<string, unknown>>,
  root: string,
  elapsedMs: number,
): string {
  const gid = String(goal.id ?? "");
  const title = String(goal.title ?? "").replace(/\s+/g, " ").trim();
  const exit = exitConditionsText(String(goal.body ?? "")).trim();
  const acs = inScopeAcs.map(
    (ac) => `  - ${String(ac.id ?? "")}: ${String(ac.title ?? "").replace(/\s+/g, " ").trim()}\n    expect: ${String(ac.expect ?? "").replace(/\s+/g, " ").trim()}`,
  );
  return [
    "You are a goal-sufficiency follow-up agent in the quay repo. A goal's sufficiency judge has rendered a DETERMINATE verdict of `insufficient` for this goal, and that verdict has stayed unchanged well past one full judge+look cycle. The verdict means: the goal's in-scope AC set does NOT cover the goal's exit conditions.",
    "⛔ No other mechanism consumes this verdict. It has been repeating in the round log every round with nobody acting on it, so the goal will stay stuck at `active` forever unless someone changes either the AC set or the exit-conditions text. That is the job your task creates.",
    `Repo root: ${root}.`,
    `goal_id=${gid}`,
    `goal_title=${title}`,
    `elapsed_since_first_observed_ms=${elapsedMs}`,
    "## The goal's exit conditions (verbatim)",
    exit === ""
      ? "(NONE — the goal body carries no non-empty `## 退出条件` section. That absence is ITSELF why the mechanical layer judged `insufficient`, without ever consulting the semantic judge.)"
      : exit,
    "## The in-scope AC set that was judged insufficient",
    acs.length === 0
      ? "  (EMPTY — this goal has zero in-scope ACs. That emptiness is ITSELF why the mechanical layer judged `insufficient`.)"
      : acs.join("\n"),
    "## Your job",
    "Read the goal record (`goal_get` MCP) and whatever repo sources you need. Then PROPOSE — you do NOT apply — exactly one of:",
    "  (a) a candidate NEW AC, with a runnable criterion, that closes a gap between the exit conditions and the current AC set; or",
    "  (b) a REVISION of the exit-conditions / scope text, if the exit conditions as written demand more than this goal should.",
    "In the task body: quote VERBATIM the exit condition (or the part of the goal title) that is currently uncovered, say why the existing AC set does not cover it, and say why your proposal does. A proposal that does not name the uncovered part is not reviewable and will be rejected.",
    "⛔ Do NOT write the goal store. ⛔ Do NOT mark any GOAL or AC achieved / active / draft / retired. ⛔ Do NOT edit `goals/*.md`. Your product is a TASK, not a state change — a human decides the AC set.",
    "File ONE task via the `quay-file-task` skill (Skill tool). ⛔ Not more than one. If an in-flight task already proposes an AC / exit-condition change for this goal, do NOT file a duplicate — report that task's id instead.",
    "Then move it to `status: needs-human` (task_write MCP) so a human reviews the proposal before it is dispatched as work.",
  ].join("\n");
}

/** 信号 agent argv = launchArgv("fix-worker", <prompt>)（短命；launcher/model/--bare 由 .quay/profiles.yml
 *  的 profiles/roles 承载——AC140 单一构造点）。⛔ 复用既有 fix-worker role 的 profile（语义由 prompt
 *  承载），与 G9 缺口环同一个角色——两者都是「读→建议→立案」的一次性语义 agent。followupCmd 覆盖
 *  【前缀】时把 prompt 作为末参数追加（测试缝捕获真实 prompt，同 --gap-worker-cmd）。 */
export function buildSufficiencyFollowupArgv(
  goal: Record<string, unknown>,
  inScopeAcs: Array<Record<string, unknown>>,
  root: string,
  elapsedMs: number,
  followupCmd?: string | null,
): string[] {
  const prompt = buildSufficiencyFollowupPrompt(goal, inScopeAcs, root, elapsedMs);
  if (followupCmd != null) {
    const prefix = splitArgs(followupCmd);
    if (prefix.length === 0) return launchArgv("fix-worker", prompt, root);
    return [...prefix, prompt];
  }
  return launchArgv("fix-worker", prompt, root);
}

/** spawn 一个短命 gap-filing agent 的结果（诊断面：stdout/stderr/timedOut 落进可查载体，spawn 失败
 *  不再零诊断信息——同 promotion-driver 的 FixWorkerSpawnResult）。 */
export interface GapWorkerSpawnResult {
  exitCode: number | null;
  error: string | null;
  stdout: string | null;
  stderr: string | null;
  timedOut: boolean;
}

/** spawn 一个短命 gap-filing agent（claude -p，或 gapWorkerCmd 覆盖前缀），同步等待其退出。
 *  捕获 stdout/stderr + timeout（照 promotion-driver 的 spawnFixWorker）。spawn 即达成；⛔ 不验证
 *  立没立案（下一轮 readTaskFacts 独立复核），⛔ 不信 agent 自述。 */
export function spawnGapWorker(argv: string[], root: string, timeoutMs: number = GAP_WORKER_TIMEOUT_MS_DEFAULT): GapWorkerSpawnResult {
  if (!Array.isArray(argv) || argv.length === 0) {
    return { exitCode: null, error: "empty gap-worker argv", stdout: null, stderr: null, timedOut: false };
  }
  try {
    const r = spawnSync(argv[0], argv.slice(1), {
      cwd: root, encoding: "utf8", timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = String(r.stdout ?? "").trim() || null;
    const stderr = String(r.stderr ?? "").trim() || null;
    const timedOut = !!(r.error && (r.error as { code?: string }).code === "ETIMEDOUT");
    if (r.error) return { exitCode: null, error: String(r.error.message || r.error), stdout, stderr, timedOut };
    return { exitCode: r.status, error: null, stdout, stderr, timedOut };
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
    return { exitCode: null, error: msg, stdout: null, stderr: null, timedOut: false };
  }
}

/** gap-filing agent stdout 的落盘【尾部】上限（字符）。超时诊断要的是「进行到哪一步」——尾部是
 *  最后打印的内容，最有信息量（读 AC → 查重 → 撰件 → 落盘，卡在哪一步看最后一行）。4000 字符足以
 *  覆盖一步的关键输出，再长无增量诊断价值，且轮记录是 gitignored 运行时日志、无需完整回放。
 *  此上限是诊断面封顶，非预算/阈值——它不决定行为，只决定落盘体积（硬规则 4 推论二针对后者）。 */
export const GAP_STDOUT_TAIL_CHARS = 4000;

/** 截断 stdout 到【尾部】GAP_STDOUT_TAIL_CHARS 字符（超时/长输出诊断用；空 ⇒ null）。被截断时加
 *  「…[truncated N chars]…」标记，使「有输出但被截」与「零输出」不同形（硬规则 3b）。 */
export function truncateStdoutTail(stdout: string | null): string | null {
  if (stdout == null || stdout === "") return null;
  if (stdout.length <= GAP_STDOUT_TAIL_CHARS) return stdout;
  return `…[truncated ${stdout.length - GAP_STDOUT_TAIL_CHARS} chars]…\n${stdout.slice(-GAP_STDOUT_TAIL_CHARS)}`;
}

/** 一条 gap spawn 的逐条诊断（ac · goal · exitCode · stdout · stderr · timedOut）。stdout 保留尾部
 *  （超时/长输出时截断）——一个超时的 spawn 至少看得出它进行到哪一步（卡在启动/查重/还是差最后落盘），
 *  ⛔ 不再是零诊断信息。 */
export interface GapSpawnOutcome {
  ac: string;
  goal: string;
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  timedOut: boolean;
}

/** G9 缺口语义环的 spawn pass 结果。 */
export interface GapSpawnPassResult {
  spawned: number;
  llmInvoked: boolean;
  outcomes: GapSpawnOutcome[];
}

/** spawn 选取面：哪些缺口态该立案（**单一真相源**——`runGapSpawnPass` 与判据都读它，⛔ 不各写一份谓词）。
 *  四态该立案，且成因不同：`gap`（active AC 零关联任务）+ `workable`（active AC 有关联任务但全非牵引、
 *  判据只读**仓库内工作产物** ⇒ 还有 worker 能改变它）+ `standing-violated`（AC-216 复验域内常设不变式
 *  此刻违反且无在飞任务）+ `frozen-violated`（**冻结population**：已离开复验域、台账尾读数说此刻为假、
 *  且无在飞任务——⛔ 与 standing-violated 是两个 population（域外/域内），合并即把「离开域后没人管」
 *  这条正好要修的形态重新藏起来）。其余态⛔ 不消耗 spawn 名额：stalled/in-progress 已有人在处理，
 *  `world-gated`（判据读生产载体 ⇒ 真值是未来生产事件、⛔ 无 worker 能产出它——见 `worldGatedRoutes` 的
 *  复读路由）、`unclassified` 是**读不到判据载体**（硬规则 3b），standing-ok 无工作要立，
 *  not-evaluated 是读不到 tasks/I5 而不是缺口，`derived-routed` 的红归 ③ 的主体 AC、⛔ 不归这条元判据
 *  （为它立案会每轮造一条关不掉的任务——它的复绿条件在别的 AC 的域内，见 GapState 的该条注释）。 */
export function isFilingGapState(state: GapState): boolean {
  return state === "gap" || state === "workable" || state === "standing-violated" || state === "frozen-violated";
}

/** `goal-gaps` fact 的名字——与 goal-ring / goal-sufficiency / goal-objective / goal-target-health 并列
 *  落进同一份轮记录（`.quay/goal-round.jsonl`）。 */
export const GOAL_GAPS_FACT_NAME = "goal-gaps";

/** 视图滤掉的「安静态」——**单一真相源**（⛔ 不在消费方各写一份谓词）。
 *  `in-progress`（已有人在推进）与 `standing-ok`（常设判据此刻成立）都是「本轮没有信号要给谁看」。
 *  **其余各态每一个都是一条要被看见的读数**，尤其 `world-gated`：它有 done/superseded 任务认领、判据
 *  依然为假、**且没有任何 worker 能改变它**（真值是未来生产事件）——`isFilingGapState` 有意把它排除在
 *  spawn 之外（见其注释，那是防浪费的设计、不是缺陷）：driver 每轮都算出了这个事实，此前却与 workable
 *  压成同一个 `done-unresolved`、只活在当轮进程内存里，人要看得自己写外部脚本把同一套推导重做一遍。
 *  ⛔ `world-gated` / `unclassified` / `workable` 都是非安静态（各自要被看见）。 */
export const GAP_VIEW_QUIET_STATES: readonly GapState[] = ["in-progress", "standing-ok"];

/** `world-gated` 缺口的**路由去向**——「谁会在世界变化后复读它」。这是一句**可核的**陈述，不是修辞：
 *  一条 world-gated 的 AC 仍是 active GOAL 的判据 ⇒ 它**仍在每轮 gate 集合（pass 1 的 `criteria`）里**，
 *  每轮都会被重新执行一次；世界一变（CI 跑完 / release tag 切出），下一轮读数自然转绿。
 *  ⛔ 本路由**不 spawn worker**（无 worker 能产出该生产事件——派了是浪费名额）。
 *  ⛔ 它不是「无事可做」：路由本身是本 fact 里一条**留痕**（`value.routed`），使人/常设例程能看见
 *  「这条 AC 等的是世界、不是工人」。 */
export const WORLD_GATED_ROUTE = "round-gate-reread";

/** 本轮 world-gated 缺口的**路由留痕**：逐条带出 `{goal, ac, carriers, route}`（硬规则 3 枚举不布尔）。
 *  `carriers` = 该 AC 判据文本里读到的生产载体路径（`productionCarriersOf`，去重保序）——人据此知道
 *  它在等哪个生产事件。⛔ 纯派生读数，不进任何 spawn/flip 判定。 */
export function worldGatedRoutes(
  gaps: Array<GoalGap>,
  records: Array<Record<string, unknown>>,
): Array<{ goal: string; ac: string; carriers: string[]; route: string }> {
  return gaps
    .filter((g) => g.state === "world-gated")
    .map((g) => ({
      goal: g.goal,
      ac: g.ac,
      carriers: productionCarriersOf(records.find((r) => String(r.id ?? "") === g.ac)?.criterion),
      route: WORLD_GATED_ROUTE,
    }));
}

/** 本轮缺口读数的**视图**：只保留非安静态，逐条带出 `{goal, ac, state, taskCount}`。
 *  ⛔ 这是一条**派生视图**，不是第二处计算：输入就是 `computeGoalGaps` 的同一个返回数组
 *  （`goal-ring` fact 的 `value.gaps` 仍写全量，meta-driver 等既有消费者不受影响），本函数只做
 *  过滤 + 投影 ⇒ 两者同一轮同一份来源，不可能互相漂移（硬规则 5b：⛔ 不各自重推一遍口径）。
 *  ⛔ `taskCount` 原样带出（`not-evaluated` 时是 `null`，⛔ 不与 `0` 同形，硬规则 3）。 */
export function gapViewEntries(
  gaps: Array<GoalGap>,
): Array<{ goal: string; ac: string; state: GapState; taskCount: number | null }> {
  return gaps
    .filter((g) => !GAP_VIEW_QUIET_STATES.includes(g.state))
    .map((g) => ({ goal: g.goal, ac: g.ac, state: g.state, taskCount: g.taskCount }));
}

/** 组装 `goal-gaps` fact。⛔ 两个半边必须**可分**（硬规则 3b）：
 *  · 算出过（`evaluated: true`）⇒ `value.gaps` = 非安静态视图；**空数组 = 查过且本轮零条**，是测量。
 *  · 没算成（`evaluated: false`，成因在 `cause`）⇒ `value.gaps` 恒为 `[]`，由这两个字段把它与
 *    「查过且零条」分开——⛔ 绝不让「读不到缺口」长得像「没有缺口」。
 *  ⛔ 本 fact **不参与任何判定**：它由 `gaps` 单向派生，spawn 决策读的仍是原数组
 *  （`runGapSpawnPass(gaps, …)`）——新增本 fact 前后 spawn 结果逐字节相同（单测的负控制钉的就是这条）。
 *
 *  `records`（可选）= 判据文本的来源，用于给 `world-gated` 缺口算出 `value.routed`（路由留痕，见
 *  `worldGatedRoutes`）。⛔ 不传 ⇒ `value.routed: null`（「没算」与「算过且零条」不同形，硬规则 3b），
 *  **绝不**落成 `[]`（那会与「查过且无 world-gated」同形）。 */
export function gapViewFact(
  gaps: Array<GoalGap> | null,
  cause: string | null = null,
  records: Array<Record<string, unknown>> | null = null,
): Fact<Record<string, unknown>> {
  if (gaps === null) {
    return {
      name: GOAL_GAPS_FACT_NAME,
      value: { gaps: [], routed: null, evaluated: false, cause: cause ?? "gaps-not-computed" },
      state: "not-evaluated",
      reason: `未评估（cause=${cause ?? "gaps-not-computed"}）——⛔ 不是「零缺口」`,
    };
  }
  const entries = gapViewEntries(gaps);
  // world-gated 的路由留痕：不传 records ⇒ null（没算），传了 ⇒ 逐条 `{goal, ac, carriers, route}`。
  const routed = records === null ? null : worldGatedRoutes(gaps, records);
  // 逐态计数（按态名排序 ⇒ 同一份输入恒得同一串，便于人读与 diff）。
  const counts = new Map<GapState, number>();
  for (const e of entries) counts.set(e.state, (counts.get(e.state) ?? 0) + 1);
  const summary = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([s, n]) => `${s}=${n}`)
    .join(" ");
  return {
    name: GOAL_GAPS_FACT_NAME,
    value: { gaps: entries, routed, evaluated: true, cause: null },
    state: "verified",
    // 分母（本轮 computeGoalGaps 的总条数）一并带出，使「视图滤掉了多少」当场可核。
    // world-gated 的路由条数一并带出 ⇒ 「等世界的那几条有没有被接住」当场可核（⛔ 不是只落在 value 里）。
    reason:
      `非安静态 ${entries.length}/${gaps.length} 条${summary ? `：${summary}` : ""}` +
      (routed !== null && routed.length > 0 ? `；world-gated 路由 ${routed.length} 条（${WORLD_GATED_ROUTE}，⛔ 不 spawn）` : ""),
  };
}

/** G9 缺口语义环的 spawn pass：可立案缺口（isFilingGapState）非空 ⇒ 过 halt + 资源门 + 每轮上限，
 *  逐条 spawn 短命 agent（一条 gap AC 一个 agent，经 quay-file-task 立案）。返回 spawned（实际 spawn 数）
 *  与 llmInvoked（派生自真实 argv，⛔ 不硬编码）。⛔ 不验证立没立案（下一轮 readTaskFacts 独立复核）。 */
export function runGapSpawnPass(
  gaps: Array<GoalGap>,
  records: Array<Record<string, unknown>>,
  root: string,
  opts: {
    gapWorkerCmd?: string | null;
    gapWorkerTimeoutMs?: number;
    llmCommands?: readonly string[];
    spawnCap?: number;
    resourceGateArgv?: string[] | null;
    halted?: boolean;
  } = {},
): GapSpawnPassResult {
  const outcomes: GapSpawnOutcome[] = [];
  const gapAcs = gaps.filter((g) => isFilingGapState(g.state));
  if (gapAcs.length === 0 || opts.halted) return { spawned: 0, llmInvoked: false, outcomes };
  // 资源门（AC150-1 同族）：spawn LLM gap-filing agent 前判定，WAIT ⇒ 退避本轮（⛔ 机械 criterion/
  // 缺口读数不受约束，零 LLM）。
  const gate = resourceGateCheck(root, opts.resourceGateArgv ?? null);
  if (!gate.go) return { spawned: 0, llmInvoked: false, outcomes };
  // 每轮上限读配置（goalSpawnCap：CLI --spawn-cap → drivers.yml goal.spawn_cap → 缺省），⛔ 不写死。
  const cap = goalSpawnCap(root, opts.spawnCap);
  // 每 spawn 超时读配置（goalGapWorkerTimeoutMs：显式 → drivers.yml goal.gap_worker_timeout_ms → 缺省）。
  const timeoutMs = goalGapWorkerTimeoutMs(root, opts.gapWorkerTimeoutMs);
  const targets = gapAcs.slice(0, cap);
  let llmInvoked = false;
  for (let i = 0; i < targets.length; i++) {
    const g = targets[i];
    const argv = buildGapWorkerArgv(
      g,
      recordTitleOf(records, g.goal),
      recordTitleOf(records, g.ac),
      acExpectOf(records, g.ac),
      root,
      opts.gapWorkerCmd,
    );
    // llm_invoked 派生自真实 argv（⛔ 不硬编码 true）；全部 targets 用同一命令前缀 ⇒ 取首条即可。
    if (i === 0) llmInvoked = isLlmInvocation(argv, opts.llmCommands ?? LLM_COMMAND_SET_DEFAULT);
    const r = spawnGapWorker(argv, root, timeoutMs);
    outcomes.push({
      ac: g.ac, goal: g.goal, exitCode: r.exitCode,
      stdout: truncateStdoutTail(r.stdout), stderr: r.stderr, timedOut: r.timedOut,
    });
  }
  return { spawned: outcomes.length, llmInvoked, outcomes };
}

// ── 充分性卡死信号（AC1~AC3 / gap-goal-sufficiency-insufficient-has-no-followup-signal）────────
//
// 缺口（2026-09-15，两个真实工作区各独立确认一次，⛔ 不是假说）：确定裁决 `insufficient` 写进
// `.quay/goal-sufficiency-cache.json` 之后**没有任何下游消费者**——它只在每一轮
// `.quay/goal-round.jsonl` 里原样重复，不升级成 finding/立案、不提醒、不上面板。两个实例：
//   ① 本仓 GOAL-018：body 缺 `## 退出条件` ⇒ 机械层直接判 insufficient（从未调语义判官）⇒ GOAL 静默卡死；
//   ② quay-fleet GOAL-005：在域 AC 全部真实 achieved，而语义判官对这组 AC 的裁决是 `insufficient`
//      （`.quay/goal-sufficiency-cache.json` 里是一条**已确定**的缓存记录，约 35 轮原样重复）
//      ⇒ GOAL 永久卡在 active，无人知道要去改 AC 集合或退出条件。
//
// 本节补的就是那条：把「持续 insufficient」变成**一条人可见的立案**——过 halt + 资源门 + 每轮上限后
// spawn 一个短命语义 agent，读 GOAL 的退出条件/范围/在域 AC 集合，**提议**（⛔ 不直接写）一条候选新 AC
// 或退出条件修订说明，经 `quay-file-task` 立案供人审核。⛔ 不写 goal-store；⛔ 不翻任何 GOAL/AC 状态。
//
// ⛔ 与 G9 缺口立案环是**两条并行的 spawn pass，⛔ 不合并**：G9 的输入是「AC 零任务牵引 / 常设不变式被
// 违反 / 冻结population 此刻为假」——都是**判定对象**上的缺口；本条的输入是「判据集合对目标是否充分
// 这件事上，判官已经给出否定结论而没人处理」——是**判定输入**上的缺口。合并会把「AC 全绿而目标不
// 成立」这条形态重新藏回「有缺口」里。

/** 持续 insufficient 信号的台账条目。台账 map 的键 = GOAL id；一条 entry 只记【当前】那个裁决实例
 *  （`key` = sufficiencyCacheKey）。裁决一变化 ⇒ 新实例覆盖旧实例 ⇒ 计时自动重新开始（AC2）。
 *  ⛔ 每个 (GOAL, 裁决实例) 最多 file 一次——「不是每轮都触发」由 filedAt 保证，不由阈值保证。 */
export interface SufficiencyStallEntry {
  /** 该 insufficient 裁决实例的身份 = sufficiencyCacheKey（语义输入哈希）。 */
  key: string;
  /** 该实例【首次被观察到】的时刻（ISO）。 */
  since: string;
  /** 已为该实例 file 过信号的时刻（ISO）；null = 尚未 file。 */
  filedAt: string | null;
}

/** 台账载体 basename（.quay/ 下，同 goal-sufficiency-cache.json / goal-round.jsonl 族——gitignored
 *  运行时载体，⛔ 不 commit）。 */
const SUFFICIENCY_STALL_BASENAME = "goal-sufficiency-followup.json";

/** 一条裁决实例的 stall 判定（**纯函数**：state 与时钟都从入参来 ⇒ 可被直接单测，无需起 driver）。
 *  四态互不同形（硬规则 3b）——⛔ 不折叠成一个布尔：
 *    not-insufficient  当前裁决不是 insufficient（covered / not-evaluated）⇒ 条目删除、不计时（AC3）；
 *    wait              是 insufficient，但本实例计时未到阈值 ⇒ 本轮不 file；
 *    file              是 insufficient 且计时已到阈值且尚未 file ⇒ 本轮 file（AC1/AC2）；
 *    already-filed     本实例已经 file 过 ⇒ ⛔ 不再 file（AC2：不是每轮都触发）。
 *  `next` = 更新后该 GOAL 应持有的台账条目；null ⇒ **删除**（⛔ 不保留陈旧实例——留着会让裁决变化后
 *  的计时不重置，正是 AC2 禁止的形态）。`elapsedMs` = 本实例已计时时长；not-insufficient 时 null
 *  （⛔ 「不计时」与「计时 0 秒」不得同形）。 */
export function sufficiencyStallReading(
  verdict: SufficiencyVerdict,
  currentKey: string,
  prior: SufficiencyStallEntry | null,
  nowMs: number,
  windowMs: number,
): { decision: "not-insufficient" | "wait" | "file" | "already-filed"; next: SufficiencyStallEntry | null; elapsedMs: number | null } {
  if (verdict !== "insufficient") return { decision: "not-insufficient", next: null, elapsedMs: null };
  const nowIso = new Date(nowMs).toISOString();
  const sameInstance = prior !== null && prior.key === currentKey;
  // ⛔ prior.since 读不懂 ⇒ 从此刻**重新计时**（方向 = 「再等一个窗口」）：硬规则 3b —— 「读不懂」
  // 不得冒充「已经等够了」而立即 file，也不得冒充「没到阈值」而永久静默。
  const parsedSince = sameInstance ? Date.parse(prior.since) : NaN;
  const sinceValid = Number.isFinite(parsedSince);
  const entry: SufficiencyStallEntry = {
    key: currentKey,
    since: sinceValid ? prior.since : nowIso,
    filedAt: sameInstance ? prior.filedAt : null,
  };
  const elapsedMs = nowMs - (sinceValid ? parsedSince : nowMs);
  if (entry.filedAt !== null) return { decision: "already-filed", next: entry, elapsedMs };
  if (elapsedMs >= windowMs) return { decision: "file", next: entry, elapsedMs };
  return { decision: "wait", next: entry, elapsedMs };
}

/** 一条 stall 信号的逐条诊断（同 GapSpawnOutcome 的形态：⛔ 零诊断信息的 spawn 不可接受——
 *  一个没跑起来的信号 agent 必须留下「卡在哪一步」，否则它自己就是下一个静默缺口）。 */
export interface SufficiencyStallOutcome {
  goal: string;
  key: string;
  exitCode: number | null;
  error: string | null;
  stdout: string | null;
  stderr: string | null;
  timedOut: boolean;
}

/** 充分性卡死信号的 pass 读数。⛔ 五个计数互不同形（硬规则 3b）：本 pass **每轮都跑**，故
 *  「本轮零条 insufficient」是一个**测量**（不是一个缺席）；「被 halt/资源门/上限挡住」也单独计数，
 *  ⛔ 不得与「还没到阈值」折叠成同一个 0。 */
export interface SufficiencyStallPassResult {
  /** 本轮裁决为 insufficient 的 active GOAL 数。 */
  insufficient: number;
  /** 本轮仍在计时、未到阈值的实例数。 */
  waiting: number;
  /** 本轮已 file 过、不再重复 file 的实例数。 */
  alreadyFiled: number;
  /** 本轮实际 file 出的信号数（= spawn 且 agent 真的跑起来了的条数）。 */
  filed: number;
  /** 本轮到达阈值但被 halt / 资源门 / 每轮上限挡下的条数（⛔ 与 waiting 不同形）。 */
  deferred: number;
  /** 本轮 spawn 是否调用了 LLM（派生自真实 argv，⛔ 不硬编码）。 */
  llmInvoked: boolean;
  /** 逐条 spawn 诊断。 */
  outcomes: SufficiencyStallOutcome[];
}

/** 充分性卡死信号的 pass：对每条【本轮裁决为 insufficient】的 active GOAL 过一遍台账——
 *  首次观察 ⇒ 开始计时；计时 ≥ 阈值且未 file 过 ⇒ spawn 一个短命语义 agent 去**提议**一条候选
 *  新 AC / 退出条件修订并立案（⛔ 不写 goal-store）。⛔ 每个裁决实例最多 file 一次。
 *
 *  ⛔ 计时与 spawn 分开：halt / 资源门 / 每轮上限只挡 **spawn**，⛔ 不挡**计时**（读数零 LLM，
 *  不受资源约束——同 G9 环「机械 criterion/缺口读数不受 halt 约束」的口径）。被挡下的条数记进
 *  `deferred`，下一轮仍在阈值内即重试。 */
export function runSufficiencyFollowupPass(
  readings: Array<{ goal: string; verdict: SufficiencyVerdict; key: string }>,
  records: Array<Record<string, unknown>>,
  root: string,
  opts: {
    /** 覆盖信号 agent 命令前缀（测试缝；prompt 仍作末参数追加）。 */
    followupCmd?: string | null;
    /** 覆盖信号 agent spawn 超时（缺省 = 同 gap-filing 的 drivers.yml 字段）。 */
    followupTimeoutMs?: number;
    llmCommands?: readonly string[];
    spawnCap?: number;
    resourceGateArgv?: string[] | null;
    halted?: boolean;
    /** 覆盖 stall 窗口（缺省 = sufficiencyStallWindowMs 的推导式）。 */
    stallWindowMs?: number;
    /** 推导缺省窗口用的两项（main() 传生效值；⛔ 不传则各自回落）。 */
    roundIntervalMs?: number;
    judgeWallclockMs?: number;
    /** 测试缝：注入「现在」（缺省 Date.now()）。 */
    nowMs?: number;
  } = {},
): SufficiencyStallPassResult {
  const nowMs = opts.nowMs ?? Date.now();
  const dir = path.join(root, ".quay");
  const windowMs = opts.stallWindowMs ?? sufficiencyStallWindowMs(root, {
    roundIntervalMs: opts.roundIntervalMs,
    judgeWallclockMs: opts.judgeWallclockMs,
  });
  // 台账载体的读写复用通用实现（readCacheMap/writeCacheMap）——⛔ 不为这条抄一份同形代码
  // （两份解析器漂移是下一个假命中源，同 sufficiency cache 的接法）。
  const ledger = readCacheMap<SufficiencyStallEntry>(dir, SUFFICIENCY_STALL_BASENAME, (v) => {
    if (typeof v.key !== "string" || typeof v.since !== "string") return null;
    return { key: v.key, since: v.since, filedAt: typeof v.filedAt === "string" ? v.filedAt : null };
  });
  const toFile: Array<{ goal: string; key: string }> = [];
  let insufficient = 0;
  let waiting = 0;
  let alreadyFiled = 0;
  for (const r of readings) {
    const d = sufficiencyStallReading(r.verdict, r.key, ledger.get(r.goal) ?? null, nowMs, windowMs);
    if (d.next === null) ledger.delete(r.goal);
    else ledger.set(r.goal, d.next);
    if (r.verdict !== "insufficient") continue;
    insufficient++;
    if (d.decision === "wait") waiting++;
    else if (d.decision === "already-filed") alreadyFiled++;
    else if (d.decision === "file") toFile.push({ goal: r.goal, key: r.key });
  }
  // 台账**先**落盘（记下「何时开始计时」）：spawn 失败不丢计时起点——下一轮仍在阈值内即可重试。
  writeCacheMap(dir, SUFFICIENCY_STALL_BASENAME, ledger);

  const outcomes: SufficiencyStallOutcome[] = [];
  let llmInvoked = false;
  let deferred = 0;
  let spawnable = toFile;
  if (spawnable.length > 0) {
    // halt / 资源门 / 每轮上限与 G9 缺口环【同一份实现】（driver-shared / goalSpawnCap 的单一真相源，
    // ⛔ 不各写一份谓词）。三者的语义都是「本轮不 spawn」，但都记进 deferred（⛔ 不静默丢弃）。
    if (opts.halted) {
      deferred = spawnable.length;
      spawnable = [];
    } else {
      const gate = resourceGateCheck(root, opts.resourceGateArgv ?? null);
      if (!gate.go) {
        deferred = spawnable.length;
        spawnable = [];
      } else {
        const cap = goalSpawnCap(root, opts.spawnCap);
        if (spawnable.length > cap) {
          deferred = spawnable.length - cap;
          spawnable = spawnable.slice(0, cap);
        }
      }
    }
  }
  // 每 spawn 超时：与 gap-filing agent 同源（同为 fix-worker 角色、同为一次性语义 agent），
  // ⛔ 不另立一个字面量；测试缝可覆盖。
  const timeoutMs = goalGapWorkerTimeoutMs(root, opts.followupTimeoutMs);
  for (let i = 0; i < spawnable.length; i++) {
    const t = spawnable[i];
    const goal = records.find((r) => String(r.id ?? "") === t.goal) ?? {};
    const inScope = inScopeAcsOf(records, t.goal);
    const entry = ledger.get(t.goal);
    const elapsedMs = entry ? Math.max(0, nowMs - Date.parse(entry.since)) : 0;
    let argv: string[];
    try {
      argv = buildSufficiencyFollowupArgv(goal, inScope, root, Number.isFinite(elapsedMs) ? elapsedMs : 0, opts.followupCmd);
    } catch (e) {
      // launchArgv 抛错（profiles.yml 缺失/非法）⇒ 记诊断，⛔ 不静默：这条 spawn 没发生。
      outcomes.push({
        goal: t.goal, key: t.key, exitCode: null,
        error: `launchArgv failed: ${e && typeof e === "object" && "message" in e ? String((e as Error).message) : String(e)}`,
        stdout: null, stderr: null, timedOut: false,
      });
      continue;
    }
    // llm_invoked 派生自真实 argv（⛔ 不硬编码 true）；全部 targets 用同一命令前缀 ⇒ 取首条即可。
    if (i === 0) llmInvoked = isLlmInvocation(argv, opts.llmCommands ?? LLM_COMMAND_SET_DEFAULT);
    const r = spawnGapWorker(argv, root, timeoutMs);
    outcomes.push({ goal: t.goal, key: t.key, exitCode: r.exitCode, error: r.error, stdout: r.stdout, stderr: r.stderr, timedOut: r.timedOut });
    // ⛔ 只在【agent 真的跑起来了（exit 0 且无 spawn error）】时记 filedAt：spawn 失败 / 超时 / 非零退出
    // = 没有任何 agent 做过任何事 ⇒ **不消耗**该实例的唯一一次机会，下一轮仍在阈值内即重试。
    // ⛔ 不解析 agent 自述判「立没立案」（同 G9：⛔ 不信自述）——本 pass 的产物是「信号被发出」这件事，
    // 信号到没到由 agent 自己的 ABI 写路径保证。
    if (r.exitCode === 0 && r.error === null && entry) entry.filedAt = new Date(nowMs).toISOString();
  }
  if (outcomes.length > 0) writeCacheMap(dir, SUFFICIENCY_STALL_BASENAME, ledger);
  return {
    insufficient,
    waiting,
    alreadyFiled,
    filed: outcomes.filter((o) => o.exitCode === 0 && o.error === null).length,
    deferred,
    llmInvoked,
    outcomes,
  };
}

// ── 一轮（机械环）─────────────────────────────────────────────────────────────────────────

/** 一轮的读数。 */
export interface GoalRoundReadings {
  goalCount: number;
  criterionCount: number;
  criteria: Array<{ id: string; goal: string; status: string; verdict: "pass" | "fail" | "not-evaluated"; reason: string }>;
  /** 本轮 driver 做的全部状态翻写：I2 达成翻转（to=achieved）+ ⑧ 分诊 activate 执行（to=active）。
   *  ⛔ 分诊不翻其余三态（re-anchor / needs-human / hold 只落痕，AC-219）。 */
  flips: Array<{ id: string; to: string; ok: boolean; reason: string }>;
  /** 关闭前置读数（gap-goal-closure-freezes-failing-ac-outside-reverify-scope）：每条 active GOAL 一条
   *  `{goal, verdict, acs, cause}`。verdict ∈ 三态 clear / blocked-failing-ac / not-evaluated（⛔ 三态
   *  互不同形：blocked 带被点名 AC 清单、not-evaluated 带台账成因、clear 两者皆空）。空数组 = 本轮无
   *  active GOAL——「查过且零条」与「未跑该判定」按字段存在性区分（硬规则 3b）。 */
  closeBlocks: Array<{ goal: string; verdict: GoalCloseBlockVerdict; acs: string[]; cause: GoalCloseBlockCause | null }>;
  /** I3 三桶 + I4 分歧；null = check --staleness 读不到（⛔ 与「零 stale」不同形，硬规则 3b）。
   *  scopeSize = 枚举出的 active goal 数（作用域规模）；evaluated = scopeSize > 0。0 active goal ⇒
   *  evaluated:false、scopeSize:0——空作用域与「查过且全过」按字段区分（⛔ 同形，硬规则 3b）。 */
  staleness: { fresh: string[]; stale: string[]; notEvaluated: string[]; divergent: string[]; scopeSize: number; evaluated: boolean } | null;
  /** I5 achieved-but-failing；null = check --achieved-failing 读不到（⛔ 与「零」不同形，硬规则 3b）。
   *  scopeSize = 枚举出的作用域规模（active goal 下 achieved AC 或 long-term achieved AC，criterion 非空）；
   *  inScope = 该作用域 AC id 枚举（AC-216：含其 GOAL 已 achieved 的 long-term AC）。evaluated =
   *  scopeSize > 0。空作用域与「查过且全过」按字段区分（⛔ 同形，硬规则 3b）。 */
  achievedFailing: { achievedButFailing: string[]; evaluated: boolean; scopeSize: number; inScope: string[] } | null;
  /** 冻结population（achieved ∧ 已离开复验域 ∧ criterion 非空）的「此刻为假」读数（③ 的输入面）。
   *  judgment 三态，⛔ 不是布尔（硬规则 3b）：clean（查过且无此刻为假的）/ violated（查过且有，枚举
   *  在 failing 里）/ not-evaluated（查不成，成因在 cause）。⛔ 恒非 null —— 「没跑这条读数」不得与
   *  「查过且全好」同形：读不到时它自己落 not-evaluated。 */
  frozenFailing: FrozenFailingReading;
  /** ③b 立案前【直接量复核】的读数（gap-frozen-violated-files-on-stale-verdict）——对
   *  `frozenFailing.failing` 命中的每条 AC 真跑一次 criterion 的逐条三态落痕。⛔ 恒非 null
   *  （没跑时它是 `ran:false` 的显式读数，⛔ 不与「复核了且全过」同形，硬规则 3b）。 */
  frozenRecheck: PrefilingRecheckReading;
  /** ②b 立案前【直接量复核】的读数（gap-standing-violated-false-spawn-no-prefiling-recheck）——对
   *  `achievedFailing.achievedButFailing` 命中的每条**常设域内** AC 再跑一次 criterion 的逐条三态
   *  落痕，含 `{ac, outcome, cause, verdict, durationMs, hostFreeBytes, load1}`：前四项回答
   *  「复核的结论」，后三项回答「复核跑在什么环境下」——**环境类误读与真回归正是靠后者事后可分**
   *  （2026-09-16 ENOSPC 那次要区分二者只能跨进程取证）。⛔ 恒非 null（同 `frozenRecheck`）。
   *  ⛔ 与 `frozenRecheck` 是**两个互斥 population** 的两条读数（域内 / 域外），⛔ 不合并。 */
  standingRecheck: PrefilingRecheckReading;
  /** ⑤ 缺口读数（G7 + G9 stalled）：每条 active AC 的四态；taskFacts==null ⇒ 逐条 not-evaluated。 */
  gaps: Array<GoalGap>;
  /** ⑥ G9 语义环：本轮实际 spawn 的 gap-filing agent 数（过 halt/资源门/上限后；0 = 未 spawn）。 */
  spawned: number;
  /** ⑥ G9 语义环：本轮 spawn 是否调用了 LLM（派生自真实 argv，⛔ 不硬编码）。 */
  llm_invoked: boolean;
  /** ⑥ G9 语义环：逐条 spawn 诊断（ac · goal · exitCode · stderr · timedOut，⛔ 零诊断信息）。 */
  gap_spawns: Array<GapSpawnOutcome>;
  /** ⑦ draft AC 分诊（GOAL-010 范围② / AC-210）：active GOAL 名下每条 draft AC 恰好一条
   *  {ac, decision, reason}（decision ∈ 四态；ac 唯一）。无 draft AC ⇒ 空数组——字段仍在，
   *  「查过且零条」与「未跑分诊」按字段存在性区分（硬规则 3b）。 */
  triage: Array<TriageEntry>;
  /** ⑩ 不可达的 draft：draft GOAL 及其名下 draft AC。⛔ 本字段存在的理由：`goalCount` 只数 active
   *  goal，`triage` 只收 active GOAL 名下的 draft AC——于是一个 draft GOAL 连同它吞掉的 N 条 AC
   *  **在任何既有 field 里都不存在**（「被静默吞掉」与「不存在」同形，硬规则 3b）。 */
  unreachableDrafts: UnreachableDraftsReading;
  /** ⑥b 充分性卡死信号（AC1~AC3）：本轮 insufficient 实例数 / 计时中 / 已 file 过 / 新 file 数 /
   *  被 halt·资源门·上限挡下数 / 逐条 spawn 诊断。⛔ 每轮都产出（`insufficient: 0` 是一个**测量**，
   *  不是「没跑这条」——本 pass 无条件执行，硬规则 3b）。 */
  sufficiency_stall: SufficiencyStallPassResult;
  /** ⑨ CI run 载体采集（tasks/gap-develop-ci-first-decisive-green）：本轮是否真采集了、以及
   *  **可区分**的成因（status ∈ ok / throttled / gh-unavailable / error / disabled）。
   *  ⛔ 恒非 null：没跑这条读数时它是显式的 `disabled`，⛔ 不与「采集了零条」同形（硬规则 3b）。
   *  它是 AC-265 判据**本地载体**的活性证明，也是该判据「采集停了」与「CI 真红」的分界。 */
  ciRuns: CiRunsRoundReading;
}

/** ⑩ 不可达的 draft：draft GOAL 及其名下的 draft AC（gap-goal-driver-draft-ac-invisible-yet-blocking
 *  的读数半边）。
 *
 *  分诊（⑦）的对象集是【active GOAL 名下】的 draft AC，且 ⑧ 只消费 `activate` 一态；
 *  **没有任何路径激活一个 draft GOAL 本身**。⇒ draft GOAL 的子 AC 落在分诊集合之外：它们不进
 *  `gaps`（`computeGoalGaps` 只数 active AC）、不进 `triage`（父 GOAL 非 active）、也不进
 *  `closeBlocks`（关闭判定只见 active GOAL）。⇒ `spawned: 0` 与「真的全达成」同形，
 *  而实际可能是「若干条判据被一个 draft GOAL 静默吞着」。
 *  ⛔ 纯读数：不改任何 spawn / flip / 分诊判定；只为让该形态在轮记录里可读。 */
export interface UnreachableDraftsReading {
  /** draft GOAL 的 id（kind=goal ∧ status=draft）。 */
  goals: string[];
  /** 父 GOAL ∈ `goals` 的 draft AC 的 id（kind=criterion ∧ status=draft ∧ goal 指向 draft GOAL）。 */
  acs: string[];
  /** 恒 true —— 本字段只在 records 读取成功后构造。⛔ `{goals:[],acs:[]}` 是「查过且无不可达
   *  draft」，与「records 读不到」不同形：后者整轮走 list-failed 分支，`value` 根本不构造、
   *  本字段不出现（硬规则 3b）。 */
  evaluated: boolean;
}

export interface GoalRoundOptions {
  /** quay CLI 的代码根（缺省 = `resolveQuayCodeRoot()`——从【本 kernel 自身安装位置】反推，⛔ 不是
   *  dataRoot/workspaceRoot：第三方项目 root 下没有 quay 自己的代码树，按 root 拼会得到
   *  `Cannot find module '<project>/…goal-store.ts'`）。它现在的唯一用途是定位
   *  **quay CLI 入口**（`goalStoreArgv` → `resolveCliInvocation`），因为 goal 读写已改经
   *  `quay goal …` 动词（gap-ac262-…）。测试缝可显式传，使 goals/ 与代码根分离；传一个不存在
   *  的根 ⇒ 解析不出 ⇒ 逐条读数落 not-evaluated/unreadable（负控制钉的就是这条契约）。
   *  缺省解析不出（`resolveQuayCodeRoot()` 返回 null）⇒ 回退到本 kernel 自己 plugin root 下的
   *  vendored bundle（出厂布局）。 */
  scriptRoot?: string;
  /** 覆盖 resource-gate 命令（测试缝；缺省 = 与 worker/promotion 同一 resourceGateCheck 缺省）。 */
  resourceGateArgv?: string[] | null;
  /** 覆盖 gap-filing agent 命令【前缀】（测试缝；prompt 仍作末参数追加，同 promotion --fix-worker-cmd）。 */
  gapWorkerCmd?: string | null;
  /** 覆盖 ready-pool-check 命令（测试缝；stalled 第四态的结构量来源）。 */
  readyPoolCmd?: string[] | null;
  /** 配置声明的 LLM 命令集（缺省 LLM_COMMAND_SET_DEFAULT；AC140-4 判定读此集合）。 */
  llmCommands?: readonly string[];
  /** 覆盖每轮 spawn 上限（缺省 = drivers.yml goal.spawn_cap；CLI --spawn-cap）。 */
  spawnCap?: number;
  /** 覆盖 gap-filing agent spawn 超时（缺省 = drivers.yml goal.gap_worker_timeout_ms；CLI --gap-worker-timeout-ms）。 */
  gapWorkerTimeoutMs?: number;
  /** 覆盖充分性语义判定命令前缀（测试缝；prompt 仍作末参数追加，同 readyPoolCmd 的数组形态）。
   *  null/undefined ⇒ launchArgv("fix-worker") 真 LLM；空数组 ⇒ not-evaluated（不可用）。 */
  sufficiencyCmd?: string[] | null;
  /** 覆盖充分性语义判定 spawn 超时（缺省 = SUFFICIENCY_TIMEOUT_MS；负控制 b 的「超时」注入小值）。
   *  ⚠️ 它同时是 ⑥b stall 窗口推导式的一项（judgeWallclockMs）——换它就是换判官墙钟，窗口跟着走。 */
  sufficiencyTimeoutMs?: number;
  /** ⑥b 覆盖充分性卡死信号的 stall 窗口（毫秒）（测试缝 / CLI --sufficiency-stall-window-ms；缺省 =
   *  sufficiencyStallWindowMs 的【推导式】，⛔ 不是一个字面量）。 */
  sufficiencyStallWindowMs?: number;
  /** ⑥b 覆盖信号 agent 命令前缀（测试缝；prompt 仍作末参数追加）。null/undefined ⇒ launchArgv("fix-worker")。 */
  sufficiencyFollowupCmd?: string | null;
  /** ⑥b 覆盖信号 agent spawn 超时（缺省 = 同 gap-filing 的 drivers.yml goal.gap_worker_timeout_ms）。 */
  sufficiencyFollowupTimeoutMs?: number;
  /** 本轮生效的轮间隔（毫秒）。⛔ 只用于 ⑥b stall 窗口的**推导式**（`judgeWallclockMs + roundIntervalMs`）：
   *  main() 把生效值传进来 ⇒ `--interval` 覆盖也一并跟着走；不传则回落 loadDriverConfig(root).goal.intervalMs。 */
  roundIntervalMs?: number;
  /** 被驱动系统（目标项目）所在主机；缺省读 drivers.yml `kinds.goal.target_host`（空 = 目标在本机）。 */
  targetHost?: string | null;
  /** 被驱动系统（目标项目）根路径；缺省读 drivers.yml `kinds.goal.target_root`。 */
  targetRoot?: string | null;
  /** 业务目标层判定命令前缀（测试缝；prompt 仍作末参数追加）。null/undefined ⇒ launchArgv("fix-worker")
   *  真 LLM；空数组 ⇒ not-evaluated（不可用）。 */
  objectiveCmd?: string[] | null;
  /** 覆盖业务目标层 spawn 超时（缺省 = SUFFICIENCY_TIMEOUT_MS）。 */
  objectiveTimeoutMs?: number;
  /** 业务目标层证据载体清单覆盖（缺省 OBJECTIVE_EVIDENCE_CARRIERS）。 */
  objectiveEvidenceCarriers?: readonly string[];
  /** 健康度探针的 argv **前缀**覆盖（测试缝；后接 `<root> <carrier...>`）。⛔ 换的是**传输层**，
   *  ⛔ 不是答案——读数仍由探针脚本从真实文件系统 / 进程表读出（硬规则 4 推论三）。 */
  healthProbePrefix?: string[] | null;
  /** `fan-in-failing` 信号的 fan-in 窗口（秒）；缺省 HEALTH_WINDOW_SEC_DEFAULT（由任务实测的
   *  2 小时窗口导出）。⛔ 读的是**目标项目自己的** fan-in-step-trace.jsonl（人 2026-09-12 DIR-131
   *  补充裁定：外部被驱动系统读数 ≠ 本仓落地率读数）。 */
  healthWindowSec?: number;
  /** ⑨ 每轮 CI run 载体采集的开关。缺省读 drivers.yml `kinds.goal.ci_runs_collect`（代码缺省 **false**）。
   *  ⛔ 代码缺省 false 而**生产真源 drivers.yml 里显式 true**：这条读数会 spawn gh + 走网络，
   *  测试里默认打开会让每个跑 runGoalRound 的用例都打真 API（慢且依赖网络）——「生产开、测试不意外开」
   *  由「配置真源显式置位」表达，⛔ 不是把默认写成 true 再让测试各自关它。 */
  ciRunsCollect?: boolean;
  /** ⑨ 覆盖采集节流间隔（毫秒）；缺省 drivers.yml `kinds.goal.ci_runs_collect_throttle_ms`
   *  → DEFAULT_COLLECT_THROTTLE_MS。0 ⇒ 每轮都采。 */
  ciRunsThrottleMs?: number;
  /** ⑨ 采集函数注入（测试缝）。缺省 = ci-runs-collect 的 collectForRound（真跑 gh）。 */
  ciRunsCollectFn?: (root: string, opts: { throttleMs?: number }) => CiRunsRoundReading;
}

export interface GoalRoundResult {
  fact: Fact<Record<string, unknown>>;
  /** 每条 active GOAL 的充分性判定（独立 Fact，name="goal-sufficiency"，value.sufficiency={goal, verdict}
   *  ＋ not-evaluated 时另有 cause ∈ 三成因 samples-disagree/judge-unavailable/judge-unparseable；
   *  verdict ∈ 三态 covered/insufficient/not-evaluated）。AC-212 判据 grep 的正是 facts[].value.sufficiency。
   *  零 active GOAL ⇒ 空数组——字段仍在，「查过且零条」与「未跑判定」按字段存在性区分（硬规则 3b）。 */
  sufficiencyFacts: Array<Fact<Record<string, unknown>>>;
  /** 每条 active GOAL 的**业务目标层**判定（独立 Fact，name="goal-objective"，value.objective=
   *  {goal, verdict, cause?, assertion?, profile}；verdict ∈ substantiated/unsubstantiated/not-evaluated）。
   *  ⛔ 与 sufficiencyFacts 是**两条并列的 fact、两个不同的命题**——合并会让「退出条件 ⊆ AC」的绿
   *  遮住「退出条件 ⊭ 业务目标」的红（本任务立案的正是这个形态）。 */
  objectiveFacts: Array<Fact<Record<string, unknown>>>;
  /** 本轮缺口读数的**可见性 fact**（name="goal-gaps"，恰好 0 或 1 条），`value.gaps` = 非安静态
   *  （⛔ 不是 `in-progress`/`standing-ok`）的 `{goal, ac, state, taskCount}` 视图。⛔ 纯观测性新增：
   *  它由 `gaps` 单向派生，⛔ 不进 `runGapSpawnPass`、⛔ 不进 `goalFlipDecision` ⇒ 不改变任何判定。
   *  零条时**不是空数组**——`value.evaluated:false` + `cause` 与「查过且零条」分开（硬规则 3b）。
   *  （gap-goal-driver-computed-gaps-never-surfaced-as-a-round-fact） */
  gapFacts: Array<Fact<Record<string, unknown>>>;
}

/** 跑一轮 goal 机械环：枚举 active GOAL → 逐 AC 跑 criterion → 写 GateEvent（gate 自带；evidence
 *  是账本派生的，不回写文件）→ I2 flip → I3/I4（check --staleness）。返回一条 Fact（明细全在
 *  fact.value 里，统一信封 = computeRoundRecord）。 */
export async function runGoalRound(root: string, opts: GoalRoundOptions = {}): Promise<GoalRoundResult> {
  // scriptRoot = quay 自身代码所在地（经 kernel 安装位置反推），⛔ 不是 root（workspaceRoot）——
  // 两者在开发检出里恰好重合，在第三方项目里分离：按 root 拼会去 <project>/packages/quay/src/
  // 找 goal-store.ts 并报 `Cannot find module`（2026-09-13 /home/yale/work/quay-fleet 实测，
  // 四个 driver 进程 alive=1、载体在写，而 goal-ring state=failed）。
  const scriptRoot = opts.scriptRoot ?? resolveQuayCodeRoot();
  const dataRoot = root;

  if (!goalCliResolvable(scriptRoot)) {
    // fail-closed 且**可诊断**：报「quay CLI 解析不出」而不是让下游 spawn 一个不存在的路径
    // （后者会把「配置/安装布局不对」伪装成 `Cannot find module` 这种像代码缺陷的读数）。
    // ⚠️ gap-ac262-…：判据换了——不再是「有没有 packages/quay/src 源码树」（出厂布局结构上没有），
    //    而是「quay CLI 入口解析得出吗」（源检出 = bin/quay.ts；出厂 = <pluginRoot>/vendor/quay/dist/quay.js）。
    return {
      fact: {
        name: "goal-ring",
        value: { phase: "list" },
        state: "failed",
        reason: "quay CLI unresolvable (neither <codeRoot>/packages/quay/bin/quay.ts nor <pluginRoot>/vendor/quay/dist/quay.js)",
      },
      sufficiencyFacts: [],
      objectiveFacts: [],
      // ⛔ gaps 从未算出 ⇒ 独立取值（evaluated:false + cause），绝不落成「零缺口」（硬规则 3b）。
      gapFacts: [gapViewFact(null, "quay-cli-unresolvable")],
    };
  }

  let records: Array<Record<string, unknown>>;
  try {
    records = await listGoalRecords(scriptRoot, dataRoot);
  } catch (e) {
    return {
      fact: { name: "goal-ring", value: { phase: "list" }, state: "failed", reason: `list failed: ${(e as Error).message}` },
      sufficiencyFacts: [],
      objectiveFacts: [],
      gapFacts: [gapViewFact(null, "goal-list-unreadable")],
    };
  }

  const isGoal = (r: Record<string, unknown>): boolean => String(r.id ?? "").startsWith("GOAL-");
  const isAc = (r: Record<string, unknown>): boolean => String(r.id ?? "").startsWith("AC-");
  const activeGoals = records.filter((r) => isGoal(r) && r.status === "active");
  // ⑩ 不可达的 draft（纯读数）：draft GOAL 名下的 draft AC。分诊对象集是「active GOAL 名下的 draft
  // AC」，故这些 AC 既不被分诊、也不被 computeGoalGaps 计数 ⇒ 不出现在任何既有 field 里。
  const draftGoalIds = records.filter((r) => isGoal(r) && r.status === "draft").map((r) => String(r.id));
  const draftGoalIdSet = new Set(draftGoalIds);
  const unreachableDrafts: UnreachableDraftsReading = {
    goals: draftGoalIds,
    acs: records
      .filter((r) => isAc(r) && r.status === "draft" && draftGoalIdSet.has(String(r.goal ?? "")))
      .map((r) => String(r.id)),
    evaluated: true,
  };
  const activeGoalIds = activeGoalIdsOf(records);
  const criteria: GoalRoundReadings["criteria"] = [];
  const flips: GoalRoundReadings["flips"] = [];
  const closeBlocks: GoalRoundReadings["closeBlocks"] = [];
  const sufficiencyFacts: Array<Fact<Record<string, unknown>>> = [];
  const objectiveFacts: Array<Fact<Record<string, unknown>>> = [];
  // ⑥b 充分性卡死信号的输入面：pass 1 逐 GOAL 收集（裁决 + 裁决实例身份），pass 1 全部跑完才过
  // stall 台账（⛔ 不在 pass 1 里 spawn——那时的读数还不是完整的「本轮裁决集」）。
  const stallReadings: Array<{ goal: string; verdict: SufficiencyVerdict; key: string }> = [];
  // 关闭判定【延后到本轮全部 gate 落账之后】（pass 2，见下）。原因（硬规则 4c：判据点名的量必须穿过所有
  // 中间层还取得到）：`records` 是【轮开始时】读的快照，其 `evidence`（台账尾）比本轮晚一拍 —— 一条
  // 「上一轮 pass、本轮转红」的 achieved AC，若拿轮初快照判，尾 verdict 仍是 pass ⇒ 漏报并放行关闭，
  // 正是本任务要堵的缺陷形态。台账可读性探针同理放在 pass 2：本轮第一次 gate 之前台账可能尚不存在，
  // 那时探针会报 ledger-absent 而把一条本该 clear 的 GOAL 记成 not-evaluated（探针测的是「此刻读不读得到」，
  // 不是「历史上有没有过」）。
  const pendingCloses: Array<{ goal: Record<string, unknown>; gid: string; sufficiency: SufficiencyVerdict }> = [];

  // pass 1 — 对每个 active GOAL：① 跑其每条 AC 的 criterion；② I2 推导（AC pass→achieved，全达成→GOAL achieved）。
  for (const goal of activeGoals) {
    const gid = String(goal.id);
    const acs = records.filter((r) => isAc(r) && String(r.goal ?? "") === gid);
    for (const ac of acs) {
      const id = String(ac.id);
      const { verdict, reason } = await gateCriterion(scriptRoot, id, dataRoot);
      criteria.push({ id, goal: gid, status: String(ac.status ?? ""), verdict, reason });
      // I2（AC 层）：判据 pass 且 AC 为 active ⇒ 机械 flip active→achieved（裁定 5 的确定性推导，不算自动晋升）。
      // ⛔ 裁定 3：draft→active（激活）是人/manager 手动——本驱动不得把 draft（或 superseded/retired）AC 翻成 achieved。
      if (verdict === "pass" && ac.status === "active") {
        const w = await writeGoalStatus(scriptRoot, id, "achieved", dataRoot, { actor: "goal-driver", reason: "I2: criterion pass" });
        flips.push({ id, to: "achieved", ok: w.ok, reason: w.reason });
        if (w.ok) ac.status = "achieved";
      }
      // achieved-but-failing（status=achieved 而 criterion 现 fail）由 goal-store
      // `check --achieved-failing` 的 achievedButFailing 桶报出（见下方 ③④ achievedFailing 读数，
      // 随本轮 Fact 落地），本驱动不翻回——⛔ 反向翻转（achieved→active）会与裁定 3（激活归人）
      // 打架，且判据可能只是暂时红。
    }
    // 充分性闸（AC-212）：对每条 active GOAL 出三态充分性判定并落轮记录（⛔ 判不出也写 not-evaluated，
    // 不静默丢弃——否则 AC-212 判据 part 1 结构上永远无法满足）。读 body 的 `## 退出条件` vs 在域 AC 集合，
    // 机械可证的部分判 insufficient（无退出条件 / 零在域 AC），覆盖与否的语义判定归 AC-213 的 LLM。
    const inScope = inScopeAcsOf(records, gid);
    // 充分性闸（AC-212 机械 + AC-222 语义）：先机械可证部分（无退出条件 / 零在域 AC ⇒ insufficient），
    // 有退出条件 + 有在域 AC ⇒ 语义判定（LLM 判 covered/insufficient；不可用/超时/读不懂 ⇒ not-evaluated，
    // ⛔ 绝不回落 covered——semanticSufficiencyVerdict 的 fail-closed）。
    // 缓存落盘目录 = path.join(root, ".quay")（生产 root = 仓库根 ⇒ 跨重启存活；测试 root = 临时目录 ⇒
    // 落临时目录、随 mkdtemp 清理，不污染 repo）。
    const mechanical = goalSufficiencyVerdict(goal, inScope);
    let sufficiency: SufficiencyVerdict;
    let sufficiencyCause: SufficiencyNotEvaluatedCause | null = null;
    if (mechanical === "not-evaluated") {
      const detail = await semanticSufficiencyVerdictDetail(goal, inScope, root, {
        sufficiencyCmd: opts.sufficiencyCmd,
        sufficiencyTimeoutMs: opts.sufficiencyTimeoutMs,
        sufficiencyCacheDir: path.join(root, ".quay"),
      });
      sufficiency = detail.verdict;
      sufficiencyCause = detail.cause;
    } else {
      sufficiency = mechanical;
    }
    sufficiencyFacts.push({
      name: "goal-sufficiency",
      value: {
        sufficiency: {
          goal: gid,
          verdict: sufficiency,
          ...(sufficiencyCause !== null ? { cause: sufficiencyCause } : {}),
        },
      },
      state: "verified",
      reason: `sufficiency=${sufficiency}${sufficiencyCause !== null ? `（cause=${sufficiencyCause}）` : ""}（在域 AC ${inScope.length} 条）`,
    });

    // 业务目标层（第二层提问，独立 fact，⛔ 不改上面第一层的任何取值/结论）：拿该 GOAL **已达成 AC** 的
    // 载体记录当证据，问「退出条件本身 ⊨ 业务目标吗」。⛔ 证据从盘上读（collectObjectiveEvidence），
    // 不采信任何自述；载体缺失/零记录 ⇒ not-evaluated(cause=no-evidence-records)，⛔ 不默认 substantiated。
    // ⛔ 本层**不参与 goalFlipDecision**——它是一条并列读数（第一层的闸门语义原样保留：DoD 要求
    // 「加了新提问层不得让原判定退化」，把第二层接进 flip 条件会改变既有闸门语义）。
    const achievedIds = inScope.filter((ac) => ac.status === "achieved").map((ac) => String(ac.id ?? ""));
    const evidence = collectObjectiveEvidence(
      root,
      achievedIds,
      opts.objectiveEvidenceCarriers ?? OBJECTIVE_EVIDENCE_CARRIERS,
    );
    const objective = await objectiveSufficiencyVerdictDetail(goal, inScope, evidence, root, {
      objectiveCmd: opts.objectiveCmd,
      objectiveTimeoutMs: opts.objectiveTimeoutMs,
      objectiveCacheDir: path.join(root, ".quay"),
      evidenceCarriers: opts.objectiveEvidenceCarriers,
    });
    objectiveFacts.push({
      name: "goal-objective",
      value: {
        objective: {
          goal: gid,
          verdict: objective.verdict,
          ...(objective.cause !== null ? { cause: objective.cause } : {}),
          ...(objective.assertion !== null ? { assertion: objective.assertion } : {}),
          profile: objective.profile,
        },
      },
      state: "verified",
      reason:
        `objective=${objective.verdict}${objective.cause !== null ? `（cause=${objective.cause}）` : ""}` +
        `（已达成 AC ${achievedIds.length} 条 / 证据记录 ${objective.profile.records} 条` +
        ` / distinct project_root ${objective.profile.distinctProjectRoots.length}）` +
        (objective.assertion !== null ? ` 指认：全部证据记录 ${objective.assertion.field}=${objective.assertion.value}` : ""),
    });

    // ⑥b 的输入面：本 GOAL 本轮的充分性裁决 + 其**裁决实例身份**（sufficiencyCacheKey = 判官的全部语义
    // 输入哈希）。⛔ 机械路径（无退出条件 / 零在域 AC）也要收——那正是本任务实例①（GOAL-018 body 缺
    // `## 退出条件`）的形态：机械层直接判 insufficient、从未调语义判官，而它同样会永久卡死。
    // 用 key 而非 goal id 当实例身份：判官重判出新结果（输入变了）⇒ key 变 ⇒ 台账换实例 ⇒ 计时重开（AC2）。
    stallReadings.push({ goal: gid, verdict: sufficiency, key: sufficiencyCacheKey(goal, inScope) });

    // 关闭判定不在本 pass 做——见上方 pendingCloses 与下方 pass 2（本轮全部 gate 落账后才刷台账尾）。
    pendingCloses.push({ goal, gid, sufficiency });
  }

  // pass 1b — AC-216 复验域：把【声明在 Core、此前只有 I5 在跑】的常设不变式接进**每轮 gate 集合**。
  // 不接的后果（本任务立案读数，可复现）：AC-161 的 GOAL-003 早年翻 achieved 后它再没被 gate 过，台账
  // 尾事件永久定格为旧 runner 写的裸 fail（无成因）⇒ AC-241（「任何 goal-gate fail 的 reason 不得是空因
  // 模板」）结构上永不通过——即 AC-242 自己标题预言的「被误读成还有真缺陷」的同一形态，只是逃逸口在
  // long-term 上。域内 AC 逐轮重跑 ⇒ 尾事件随本轮 verdict 刷新、reason 携带判据自己写出的成因。
  // ⛔ 不翻任何状态：域内 AC 已是 achieved，I2 的 active→achieved 分支对它不适用（保持既有裁定
  // 「⛔ 不反向翻转 achieved→active，激活归人」——见 gap-goal-achieved-but-failing-no-handler）。
  // 集合与 computeGoalGaps 取自同一处枚举（standingReverifyAcs），⛔ 不各自重推一遍口径（硬规则 5b）。
  for (const ac of standingReverifyAcs(records, activeGoalIds)) {
    const id = String(ac.id);
    const { verdict, reason } = await gateCriterion(scriptRoot, id, dataRoot);
    criteria.push({ id, goal: String(ac.goal ?? ""), status: String(ac.status ?? ""), verdict, reason });
  }

  // pass 1c — AC-242 successor 的【动作】：对**冻结population**（achieved ∧ criterion 非空 ∧
  // ⛔ 不在复验域：GOAL 非 active 且未声明 long-term）做一次**有界轮转**重跑。pass 1b 只覆盖
  // 「域内」的常设不变式；域外那批此前**没有任何机制重跑**，其台账尾事件永久定格 ⇒ 一条在最后一次
  // 记录之后才失效的 AC 对所有机制不可见（2026-09-12 实测 4 条）。
  // ⛔ 放在 pass 2 的「刷新台账尾」**之前**：本轮轮转写下的 verdict 必须进入 pass 2 判关闭时读到的
  // 尾事件，否则一条**此刻为假**的 AC 会被用来放行关闭（正是 gap-goal-closure-freezes-failing-ac-
  // outside-reverify-scope 的形态，只是逃逸口从 long-term 换到冻结域）。
  // ⛔ 判定不在这里：本函数只落账。判定归 AC-242 的判据（`check --stale-pass`，纯读）。
  // ⛔ 轮转结果**不**推进 `criteria` 读数：`criteria` 的构造是「各 ACTIVE GOAL 名下全部 AC」
  // （读它的判据按这个口径断言），塞入 goal="" 的冻结 AC 会污染那个口径。轮转的**产物是台账**
  // ——判定与消费都从台账读，本轮的日志行只是可观测性。
  const frozenSweep = await sweepFrozenAcs(scriptRoot, dataRoot);

  // pass 2 — 刷新台账尾 verdict，再逐条判关闭。
  //
  // ⚠️ 刷新的是【尾 verdict】而非整份 records：status 的权威快照就是本轮这条（I2 已就地改过 `records`
  // 里的 `ac.status`，且每次翻写都已落盘），重读整份再替换会让「本轮刚翻 achieved 的 AC 是否计入 GOAL
  // 达成」这一语义在被测代码外悄悄变化。只把 `evidence` 换成 gate 落账后的读数，其余一切保持原样。
  // `goal-store list` 是唯一真相源（`evidence` 由它从 `.quay/gate-events.jsonl` 派生，⛔ 本文件不重写
  // 一份 ledger 解析）。重读失败 ⇒ 台账降级为「读不到」（fail-closed：宁可不关，也不拿不知新旧的读数放行）。
  // 探针（每轮一次，⛔ 不逐 GOAL 重探）只把「台账读不到」与「该 AC 零事件」拆开——后者在 records 上
  // 同形（都是 evidence===null），是硬规则 3b 禁止的形态。
  let ledger = probeLedger(dataRoot);
  if (ledger.readable) {
    try {
      const fresh = await listGoalRecords(scriptRoot, dataRoot);
      const evidenceById = new Map(fresh.map((r) => [String(r.id ?? ""), r.evidence]));
      for (const r of records) {
        const id = String(r.id ?? "");
        if (evidenceById.has(id)) r.evidence = evidenceById.get(id);
      }
    } catch {
      ledger = { readable: false, cause: "ledger-unreadable" };
    }
  }

  for (const { goal, gid, sufficiency } of pendingCloses) {
    // I2（GOAL 层）：充分性闸——全部在域 AC achieved 且充分性 covered ⇒ 机械 flip GOAL（裁定 5）。
    // insufficient / not-evaluated ⇒ 不 flip（GOAL-010 退出条件②：判不出取「未评估」而非放行）。
    // ⛔ 追加前置（gap-goal-closure-freezes-failing-ac-outside-reverify-scope）：上述两项都满足也**不得**
    // 在该 GOAL 名下有「achieved ∧ 台账尾 fail ∧ 未声明 long-term」的 AC 时关闭——否则该 AC 随 GOAL 离开
    // 每轮 gate 循环，其失败被永久冻结在复验域之外，且 AC-241 结构上永不通过。
    const closeBlock = goalCloseBlockFromRecords(records, gid, ledger);
    closeBlocks.push({ goal: gid, verdict: closeBlock.verdict, acs: closeBlock.acs, cause: closeBlock.cause });
    if (goal.status === "active" && goalFlipDecision(records, gid, { verdict: sufficiency })) {
      if (closeBlock.verdict !== "clear") {
        // 关闭【被拒】——落痕用独立成因取值（⛔ 不与 insufficient / not-evaluated-充分性 同形）：
        // blocked-failing-ac 带被点名的 AC 清单；not-evaluated 带台账成因。`ok:false` 是消费方的判据
        // （既有消费者只读 `ok`/`to`，一条 ok:false 的 to=achieved 不会被误读成「关了」）。
        flips.push({
          id: gid,
          to: "achieved",
          ok: false,
          reason: closeBlock.verdict === "blocked-failing-ac"
            ? `blocked-failing-ac: ${closeBlock.acs.join(", ")}`
            : `not-evaluated: close-block ${closeBlock.cause}`,
        });
      } else {
        const w = await writeGoalStatus(scriptRoot, gid, "achieved", dataRoot, { actor: "goal-driver", reason: "I2: all ACs achieved + sufficiency covered" });
        flips.push({ id: gid, to: "achieved", ok: w.ok, reason: w.reason });
        if (w.ok) goal.status = "achieved";
      }
    }
  }

  // ③ I3 判陈旧 + ④ I4 查分歧：复用 goal-store 的单一真相源（读的是 gate 写回后的最新 evidence）。
  const staleness = await checkStaleness(scriptRoot, dataRoot);
  // I5 查 achieved-but-failing：复用 goal-store 的单一真相源（独立子命令，跑判据）。
  const achievedFailing = await checkAchievedFailing(scriptRoot, dataRoot);

  // ②b 立案前【直接量复核】（gap-standing-violated-false-spawn-no-prefiling-recheck）：上一行那次读数
  // 是**本轮跑的**、没有时差，但它只有**一次**——宿主进入不健康态时（2026-09-16 实测 ENOSPC）它为
  // 真值为真的常设判据给出 fail，据此 spawn 一个 prompt 逐字断言「保证已回归」的 agent 就是给下游
  // 指一个不存在的缺陷。⇒ 对 `achievedButFailing` 命中的每条**再跑一次** criterion（第二次直接量，
  // 复用同一 `runPrefilingRecheck` / 同一道重入闸），只有复核后**仍非 0** 才产 standing-violated。
  // 产物落两处：`.quay/gate-events.jsonl`（actor=goal-cli 的这次复核）+ 本轮 fact 的 `standingRecheck`
  // （逐条三态 + `durationMs` + 复核那一刻的宿主健康量 ⇒ 环境类误读与真回归事后可分）。
  // ⛔ 成本：只对命中的（通常 0–1 条）跑，实测 avg 1.31s/criterion。⛔ 与 ③b 不重叠：两个 population
  // 互斥（域内 vs 域外），同一轮不会对同一条 AC 跑两遍。
  const standingRecheck = await recheckStandingFailing(scriptRoot, dataRoot, achievedFailing);

  // ③ 冻结population 的「此刻为假」读数（**纯读**：`check --stale-pass` 不传 `--sweep` ⇒ 零 criterion
  // 执行，与 AC-242 判据同一条命令、同一成本类）。⛔ 它【不是】`sweepFrozenAcs` 的结果——那个是【动作】
  // 半边（重跑并落账），这个是【判定】输入面。两者分开：动作失败仍要能读到判定，反之亦然。
  const frozenFailing = await readFrozenFailing(scriptRoot, dataRoot);

  // ③b 立案前【直接量复核】（gap-frozen-violated-files-on-stale-verdict）：上一行读出的是**台账**
  // 读数（轮转 verdict，新鲜度界 4h ≫ 轮转周期）——⛔ 不是「此刻」。对 `failing` 命中的每条 AC 真跑
  // 一次它的 criterion（复用 pass 1 的 `gateCriterion`，同一道重入闸），只有复核后仍非 0 才保留在
  // 「此刻为假」里。产物落两处：`.quay/gate-events.jsonl`（actor=goal-cli 的这次复核）+ 本轮 fact
  // 的 `frozenRecheck`（逐条三态落痕）。
  // ⛔ 成本：只对 `failing` 命中的跑（通常 0–1 条），实测 avg 1.31s/criterion。
  const frozenRecheck = await recheckFrozenFailing(scriptRoot, dataRoot, frozenFailing);

  // ⑤ 算缺口（G7 + G9 stalled + AC-216 复验域 + 冻结population）：读 tasks/*.md 的 goal_ac → 对每条
  // active AC 给四态，对每条 AC-216 复验域 AC 给「此刻成立 / 违反 / 读不到」，对每条冻结population 的
  // AC 给「此刻为假 / 查不成 / 无读数（此刻为真）」。taskFacts==null ⇒ 逐条 not-evaluated。
  // stalled 的结构量来自 ready-pool-check（只在存在 goal_ac 关联任务时才跑，避免每轮无谓地起一次昂贵的
  // 全池判定）。`achievedFailing`（③④ 刚读的 I5 读数）直接传进去——复验域的态由它判，⛔ 不重跑一遍判据。
  const taskFacts = await readTaskFacts(dataRoot);
  const hasGoalAcTasks = taskFacts !== null && taskFacts.some((t) => t.goalAc !== null);
  const judgment = hasGoalAcTasks ? await readReadyPoolJudgment(root, opts.readyPoolCmd) : null;
  // ① 缺口分类读取**本轮判据读数**（gap-goal-active-ac-gap-classification-ignores-round-verdict）：pass 1
  // 刚跑出的 `criteria`（AC id → 本轮 verdict）投影成 map 传入 ⇒ 一条【自陈无法评估】的判据（exit 3）
  // 不再按文本误判成 `workable` 每轮空转 spawn（见 computeGoalGaps 的 `count === 0` 分支）。
  // ⛔ 单向输入：只读 pass 1 已算出的读数，⛔ 不重跑任何判据、⛔ 不改 spawn/flip 判定面。
  const verdictByAc = new Map<string, "pass" | "fail" | "not-evaluated">(criteria.map((c) => [c.id, c.verdict]));
  const gaps = computeGoalGaps(records, taskFacts, judgment, achievedFailing, frozenFailing, frozenRecheck, standingRecheck, verdictByAc);

  // ⑦ draft AC 分诊（GOAL-010 范围② / AC-210）：对 active GOAL 名下每条 draft AC 出四态判决并逐条
  // 落痕。分诊循环只【产出判决】，⛔ 不 flip 任何 AC status——判决的消费在 ⑧（仅 activate 一态被
  // 执行；re-anchor / needs-human / hold 仍只落痕不 flip；放弃 retired 归人，且分诊不再判 retire，
  // AC-219）。taskFacts 已在 ⑤读出，直接传入（⛔ 不再读一次）。goal posture 由 goal 记录
  // 读出后传入（AC-215：`measure-only` 名下 draft AC 不得判 activate——判决函数已按 posture 入参预留
  // seam）。对象集 = 轮开始时 active 的 GOAL 名下的 draft AC。
  const triage: TriageEntry[] = [];
  for (const goal of activeGoals) {
    const gid = String(goal.id);
    const posture = typeof goal.posture === "string" ? goal.posture : null;
    for (const r of records) {
      if (!isAc(r) || r.status !== "draft" || String(r.goal ?? "") !== gid) continue;
      triage.push(triageDraftAc(r, posture, taskFacts));
    }
  }

  // ⑧ 执行 activate 判决（GOAL-010 退出条件① / AC-223）：分诊只做了「产出判决」那一半，消费
  // 从未接线——此处补上消费。⛔ 只消费 `activate` 一态：对每条 decision==="activate" 的 triage
  // 条目调 writeGoalStatus 把 draft AC 机械翻 active。激活走 goal-store write，会被 P6
  // not-evaluated 前置闸与 cap 闸挡住（AC-223 origin 风险 C 的守护，driver 无需复制该判断）。
  // ⛔ 不写 retired（裁定 1，AC-211 单测守着）；re-anchor / needs-human / hold 仍不 flip。
  //
  // gap-fidelity-judge-unwired-in-production-and-verdict-stubbed-in-tests — 激活接线真保真性判定器：
  // 激活路径经 `--fidelity-judge-argv` 把 launchArgv("fix-worker") 的真 LLM argv 前缀传给 goal-store，
  // 由 goal-store 跑判定并拒 vacuous/not-evaluated（P6b）。profiles.yml 缺失 ⇒ 不传 ⇒ goal-store
  // 诚实记 "no judge configured"（fail-open + 留痕）。⛔ 不在每轮 gate 路径（gateCriterion 不碰它）。
  for (const t of triage) {
    if (t.decision !== "activate") continue;
    let fidelityJudgeArgv: string | undefined;
    try {
      fidelityJudgeArgv = fidelityJudgeArgvJson(root);
    } catch {
      fidelityJudgeArgv = undefined; // profiles.yml 缺失/非法 ⇒ 不传 seam，goal-store 记 "no judge configured"
    }
    const w = await writeGoalStatus(scriptRoot, t.ac, "active", dataRoot, {
      actor: "goal-driver", reason: "triage: activate", fidelityJudgeArgv,
    });
    flips.push({ id: t.ac, to: "active", ok: w.ok, reason: w.reason });
  }

  // ⑥ G9 缺口语义环：缺口（state==="gap"）非空 ⇒ 过 halt + 资源门 + 每轮上限，spawn 短命 agent 经 ABI
  // 立案。halt 与资源门在 spawn pass 内读（单一真相源 = isHalted / resourceGateCheck，与 worker/promotion
  // 同一实现）——机械 criterion/缺口读数不受 halt 约束（观测性，零 LLM），只有 spawn 被 halt 挡住。
  const halted = isHalted(root, process.env, GOAL_CONTROL_STATE_REL);
  const spawnPass = runGapSpawnPass(gaps, records, root, {
    gapWorkerCmd: opts.gapWorkerCmd,
    gapWorkerTimeoutMs: opts.gapWorkerTimeoutMs,
    llmCommands: opts.llmCommands,
    spawnCap: opts.spawnCap,
    resourceGateArgv: opts.resourceGateArgv,
    halted,
  });

  // ⑥b 充分性卡死信号（AC1~AC3）：pass 1 收集的裁决集非空（或本轮为空——一样要过台账，把上一轮留下的
  // 条目按「当前裁决不是 insufficient」删掉，⛔ 不保留陈旧实例）⇒ 过 stall 台账；到达阈值且未 file 过的
  // 实例 spawn 一个短命语义 agent 提议新 AC / 退出条件修订并立案（⛔ 不写 goal-store）。
  // halt / 资源门 / 每轮上限与 ⑥ 同一份实现（pass 内读），⛔ 不在这里重推一遍。
  const stallPass = runSufficiencyFollowupPass(stallReadings, records, root, {
    followupCmd: opts.sufficiencyFollowupCmd,
    followupTimeoutMs: opts.sufficiencyFollowupTimeoutMs,
    llmCommands: opts.llmCommands,
    spawnCap: opts.spawnCap,
    resourceGateArgv: opts.resourceGateArgv,
    halted,
    stallWindowMs: opts.sufficiencyStallWindowMs,
    roundIntervalMs: opts.roundIntervalMs,
    judgeWallclockMs: opts.sufficiencyTimeoutMs,
  });

  // ⑨ CI run 载体采集（生产调用点）。⛔ 与上面各 pass 的关键差别：它**只写载体、不判定**
  // （判据是 AC-265，由 ① 的 gateCriterion 独立跑）——所以它不需要过 halt / 资源门，也不参与
  // 「本轮能不能翻状态」。⛔ 但它必须**每轮**留下一条读数：停采与「CI 真红」在载体上同形，
  // 而这条读数就是分界（硬规则 3b）。
  const ciRunsEnabled = goalCiRunsCollect(root, opts.ciRunsCollect);
  let ciRuns: CiRunsRoundReading;
  if (!ciRunsEnabled) {
    ciRuns = {
      status: "disabled",
      ran: false,
      reason: "drivers.yml kinds.goal.ci_runs_collect 未置位（或缺省 false）—— 本机不采集 CI 载体",
      carrier: path.join(root, ".quay", "ci-runs.jsonl"),
      appended: 0,
      skipped: 0,
      attributed: 0,
      enriched: 0,
      logsFetched: 0,
      testFilesDerived: 0,
      warnings: [],
    };
  } else {
    const throttleMs = goalCiRunsThrottleMs(root, opts.ciRunsThrottleMs);
    const fn = opts.ciRunsCollectFn ?? ((r: string, o: { throttleMs?: number }) => collectForRound(r, o));
    try {
      ciRuns = fn(root, { throttleMs });
    } catch (e) {
      // ⛔ 采集坏掉不得把整轮判失败（它是旁路读数）：折算成一条可区分的 error 读数。
      ciRuns = {
        status: "error",
        ran: false,
        reason: `采集抛错: ${e instanceof Error ? e.message : String(e)}`,
        carrier: path.join(root, ".quay", "ci-runs.jsonl"),
        appended: 0,
        skipped: 0,
        attributed: 0,
        enriched: 0,
        logsFetched: 0,
        testFilesDerived: 0,
        warnings: [],
      };
    }
  }

  const value: GoalRoundReadings = {
    goalCount: activeGoals.length,
    criterionCount: criteria.length,
    criteria,
    flips,
    closeBlocks,
    staleness,
    achievedFailing,
    frozenFailing,
    frozenRecheck,
    standingRecheck,
    gaps,
    triage,
    unreachableDrafts,
    spawned: spawnPass.spawned,
    llm_invoked: spawnPass.llmInvoked,
    gap_spawns: spawnPass.outcomes,
    sufficiency_stall: stallPass,
    ciRuns,
  };
  // ⑥c 缺口可见性 fact（gap-goal-driver-computed-gaps-never-surfaced-as-a-round-fact）：`gaps` 在 ⑤ 算出后
  // 此前只喂 `runGapSpawnPass`，本 fact 把它（非安静态子集）落进轮记录 ⇒ 「哪条 AC 卡在 workable /
  // world-gated 没人管」当场可查；`value.routed` 另行带出 world-gated 的**复读路由留痕**（值在等哪个
  // 生产载体、去向是 round-gate-reread——本任务 AC 之一）。⛔ 单向派生、⛔ 不改任何 spawn/flip 判定
  // （spawn 读的仍是原 gaps）。
  const gapFacts = [gapViewFact(gaps, null, records)];
  if (staleness === null) {
    return {
      fact: {
        name: "goal-ring",
        value,
        state: "not-evaluated",
        reason: `${criteria.length} criteria gated, ${flips.length} flip(s); staleness check unreadable`,
      },
      sufficiencyFacts,
      objectiveFacts,
      // ⚠️ 本路径上 gaps **已算出**（staleness 读不到不影响 ⑤）⇒ 照常落痕（⛔ 不因旁路读数坏掉而丢弃它）。
      gapFacts,
    };
  }
  return {
    fact: {
      name: "goal-ring",
      value,
      state: "verified",
      reason:
        `${criteria.length} criteria gated, ${flips.length} flip(s): ` +
        `fresh=${staleness.fresh.length} stale=${staleness.stale.length} notEvaluated=${staleness.notEvaluated.length} divergent=${staleness.divergent.length} ` +
        `achievedButFailing=${achievedFailing ? achievedFailing.achievedButFailing.length : "?"} ` +
        `closeBlocked=${closeBlocks.filter((b) => b.verdict === "blocked-failing-ac").length} ` +
        `closeNotEvaluated=${closeBlocks.filter((b) => b.verdict === "not-evaluated").length} ` +
        // 冻结域轮转（pass 1c）：`-` = 读不到；`0/0` = 本轮无合格对象（未到 minAge，正常）。
        `frozenSweep=${frozenSweep === null ? "-" : `${frozenSweep.ran.length}/${frozenSweep.eligible}`} ` +
        // ⑨ CI run 采集：`ok(a+b+c)` = 追加 a / 补全 b / 归因 c；其余态逐字带出 status（⛔ 不折成一个布尔）。
        `ciRuns=${ciRuns.status}` +
        (ciRuns.status === "ok"
          ? `(appended=${ciRuns.appended},enriched=${ciRuns.enriched},attributed=${ciRuns.attributed},logs=${ciRuns.logsFetched})`
          : `(${ciRuns.reason})`),
    },
    sufficiencyFacts,
    objectiveFacts,
    gapFacts,
  };
}

// ── 被驱动系统的外部视角（gap-goal-driver-blind-to-driven-system-health）──────────────────────
//
// 症状（2026-09-12 实测）：本 driver 连续跑 6 天 / 5308 轮，每轮只产出两条 fact
// （goal-ring + goal-sufficiency）——**全部是内省读数**。它驱动的那个系统（目标项目）在同一时段
// 两小时内 fan-in 失败 9 次（ff 5 / scoped-gate 3 / merge-develop 1），其中一轮 277 秒全量 suite
// 全绿、唯独最后一步 ff 因主检出工作树不干净失败 ⇒ 任务判 exited-not-landed、suite 白烧，
// 而本 driver **对此全程无感**，直到人来问。
//
// ⛔ 这不是「goal-driver 坏了」：它的职责是「评判据 + 判充分性」，它做到了且很勤。缺的是**外部视角**
// ——「我驱动的那个系统还好吗」。本节补的就是那条：一组针对**目标项目**的直接量读数，作为一条
// **并列的 fact**（name="goal-target-health"）落进同一份轮记录。
//
// ⛔ **职责边界（人 2026-09-07 DIR-131，2026-09-12 补充裁定见下）**：goal 侧**不得以本仓自身的
// task 落地类载体为输入**——「创建 task 之后到落地的全过程」归 promotion/worker 机制。受禁载体的
// **清单与判据只有一个正本**：`plugin/scripts/goal-driver-task-boundary-check.ts` 的 Detector 3
// （⛔ 不在本注释里复制一份——复制出来的清单就是下一个漂移源）。
//
// **2026-09-12 补充裁定（DIR-131 AC6 口径澄清，三选一之①）**：「读外部被驱动系统」与「读本仓自身
// 落地率」是两件事，前者不构成 DIR-131 的反例形态——它不驱动/佐证本仓任何 task 的判定（AC2），
// 只是把**目标项目自己的** fan-in 失败分布如实报出来。Detector 3 据此新增一个**结构性**豁免：
// 仅当 fan-in/落地率类 token 同时满足①落在 `DIR-131-TARGET-PROBE-BEGIN`/`-END` 精确配对的标记
// 之间、②落在字符串/模板字面量内部（`str[i]===1`，即"载荷即数据"而非本文件自身执行代码）时豁免；
// 标记不配对 ⇒ 不豁免任何位置（fail-closed）。本文件下方 `HEALTH_PROBE_SCRIPT` 的探针载荷——一段
// 经 stdin 送到**目标机**用 `node -` 执行、只认 `process.argv[2]`（目标根）为输入的自足脚本字符串
// ——就落在该标记范围内：它读的是 `<目标根>/.quay/fan-in-step-trace.jsonl`，⛔ 不是本仓的同名文件。
// 未落在标记内的 fan-in/落地率引用（如本仓自身逻辑里直接拼 `.quay/fan-in-step-trace.jsonl` 这类
// 裸字面量）仍然 RED——那才是 DIR-131 原裁定要挡的形态，本次澄清没有放宽它。
//
// 四条设计约束（各自对应一条 AC）：
//   ① 能取假（AC1）：三条 categorical、无阈值的信号 —— `not-driving`（目标项目零个 driver 进程）、
//      `plugin-version-mismatch`（配置形状落后于交付物，均非落地指标）、以及 `fan-in-failing`
//      （**目标项目自己的** fan-in 窗口内有 `ok:false` 步骤——读的是外部系统，不是本仓）。各态均有
//      真实读数对照。
//   ② 不阻塞（AC2）：本读数**不参与任何判定** —— `goalFlipDecision` 的输入里没有它。本函数在
//      `runGoalRound` **之外**被调用（⛔ 不改 `runGoalRound`、⛔ 不改 `goalFlipDecision` 的签名与语义），
//      且 fact.state 只取 verified / not-evaluated（⛔ 不取 failed ⇒ 不会把本轮标成失败）。
//   ③ 未评估可区分（AC3）：目标项目不可达 / 关键载体缺失 / 探针输出读不懂 ⇒ `verdict="not-evaluated"`
//      ∧ `signals === null`（⛔ 不是 []）∧ `cause` 取枚举值（⛔ 不与 healthy 同形，硬规则 3b）。
//   ④ 边界机械化（DIR-131）：读的始终是目标项目自己的载体，⛔ 从不读本仓 `.quay/fan-in-step-trace.jsonl`
//      ——`goal-driver-task-boundary-check.ts` 的双向负控制核对这一点（标记内豁免 / 标记外仍红）。
//
// 直接量 vs 代理量（硬规则 4b）：`driverProcesses.count` 与 `roundRecords.newestAgeSec` 都是**读数**，
// ⛔ **不进 verdict** —— 进程存在 ≠ 在干活（4b 实证：pane 一直在而 tick 停 21 分钟），而把「round 记录
// 多久没更新」判成红需要一个活性阈值，其成本结构未测（硬规则 4 推论：成本结构未知前不设数值阈值）。
// ⇒ 活性单独成 categorical 字段 `liveness`（driving / idle / unknown），与 verdict 并列，
// ⛔ 不把两件事压进同一个词（那样必然丢掉一个）。
//
// 传输：探针脚本经 **stdin** 送达目标机的 node（`node - <root> <carrier...>`），本地与远端同一份载荷。
// ⛔ 这是刻意的：目标项目安装的 quay 版本可能**落后于**本仓（正是本 fact 要报的 AC4 缺陷之一），
// 故探针**绝不能**依赖目标机上存在任何本项目文件——它必须自足（只用 node 内置 fs/path/child_process）。
//
// ⛔ 本节（BEGIN/END 之间）整体豁免 goal-driver-task-boundary-check.ts Detector 3 的 fan-in/落地率
// token 扫描：这里的每一处 fan-in 引用（探针载荷、carrier 名单、not-evaluated 成因、signals 词表、
// 人读摘要）都描述**目标项目自己的** fan-in-step-trace.jsonl（探针只读 `<目标根>/.quay/…`，
// `root = process.argv[2]`——⛔ 从不是本仓 process.cwd() 下的同名文件），不构成 DIR-131 禁止的
// 「以本仓落地率为输入」。豁免要求 BEGIN/END 是【各自独占一行】的精确配对标记且**恰好一对**——
// 标记数目不对/顺序颠倒 ⇒ 不豁免任何位置（fail-closed，见该检查器 `exemptSpans` 的实现与其双向
// 负控制）。

/** 本 fact 的名字（与 goal-ring / goal-sufficiency 并列落进同一份轮记录）。 */
// DIR-131-TARGET-PROBE-BEGIN
export const TARGET_HEALTH_FACT_NAME = "goal-target-health";

/** 探针 spawn 的 wall-clock 上限（毫秒）。结构：ssh ConnectTimeout(8s) + 目标机本地读几个小文件 +
 *  一次 `ps`（自带 10s 上限）⇒ 20s 为最坏路径留 2x 余量。⛔ 必须有界：探针挂死会让整条例程撞
 *  caller 侧看门狗（30min）而被整轮丢弃——那才是真正的阻塞（AC2 的反面）。 */
export const HEALTH_PROBE_TIMEOUT_MS = 20_000;

/** ssh 传输的连接超时（秒）。⛔ 禁用 `BatchMode=yes` 之外的交互：目标机不可达时必须快速失败成
 *  not-evaluated，而不是挂在那里等人输密码。 */
export const HEALTH_SSH_CONNECT_TIMEOUT_SEC = 8;

/** verdict 相关的**关键载体**（缺失 ⇒ not-evaluated，⛔ 不与「零信号」同形，硬规则 3b）：
 *  `verification-round.jsonl` = 被驱动系统**跑过一轮复验**的最小痕迹。从未跑过复验的系统不能被判成
 *  「健康」——它是「这个项目真的在被驱动过」的**结构性**痕迹，不是落地率/积压/恢复类指标。
 *  `fan-in-step-trace.jsonl` = `fan-in-failing` 信号的**唯一**来源（**目标项目自己的**那一份，⛔ 不是
 *  本仓同名文件——见头注 2026-09-12 补充裁定）；缺了它「窗口内零失败」不可知，⛔ 不能与「零失败」同形。 */
export const HEALTH_REQUIRED_CARRIERS: readonly string[] = ["verification-round.jsonl", "fan-in-step-trace.jsonl"];

/** 仅作**存在性读数**的载体（⛔ 不进 verdict）：缺了只记 `present:false`，不影响判定。 */
export const HEALTH_OBSERVED_CARRIERS: readonly string[] = [
  "worker-outcome.jsonl",
  "promotion-outcome.jsonl",
  "gate-events.jsonl",
];

/** `fan-in-failing` 信号窗口缺省（秒）：**由实测导出，⛔ 非拍脑袋**——任务立案读数即「两小时内
 *  fan-in 失败 9 次」（本 driver 6 天 5308 轮一无所知的那个窗口）。改窗口 = 改作用域，不是改阈值。 */
export const HEALTH_WINDOW_SEC_DEFAULT = 7200;

/** 探针读**目标项目自己的** `fan-in-step-trace.jsonl` 时只取**尾部窗口**的字节上限（1 MiB）。
 *  ⛔ 是全量的有界近似：超限时截断并置 `traceTruncated:true`（读数自曝其截断，⛔ 不静默），
 *  且丢掉被截断的首行。 */
export const HEALTH_MAX_TRACE_BYTES = 1 << 20;

/** 探针载荷（JS 源文，经 stdin 送 `node -`）。⛔ 只用 node 内置模块、⛔ 不 require 任何项目文件
 *  ——目标机的 quay 安装版本可能落后（这正是 AC4 要报的缺陷），依赖它就会「读不懂输入 ⇒ 返回
 *  与合格同形的值」（硬规则 3b）。输出**单行 JSON**；⛔ 探针自身对「根不存在」也 exit 0（那是一个
 *  读数，不是传输失败）——传输失败由 call 侧的 exit code 承载，两者必须可分。
 *  ⛔ 以下字符串字面量是发往**目标机**执行的载荷——它读的是 `<目标根>/.quay/…`
 *  （`root = process.argv[2]`），⛔ 不是本文件所在进程对本仓 `.quay/` 的读取（本节头注的豁免范围
 *  覆盖本段）。 */
export const HEALTH_PROBE_SCRIPT = `
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const root = process.argv[2] || '';
const carrierNames = process.argv.slice(3);
const nowMs = Date.now();
const out = {
  probeVersion: 1, root: root, rootPresent: false, nowMs: nowMs,
  roundRecords: [], driverProcesses: null,
  initStatePresent: false, initStatePluginVersion: null,
  initStateLaidAt: null, initStateAgeSec: null,
  carriers: {}, fanInSteps: null, traceTruncated: false, fanInParseErrors: 0,
};
const q = path.join(root, '.quay');
try { out.rootPresent = fs.statSync(root).isDirectory(); } catch (e) { out.rootPresent = false; }
for (const name of carrierNames) {
  try { out.carriers[name] = fs.existsSync(path.join(q, name)); } catch (e) { out.carriers[name] = null; }
}
if (out.rootPresent) {
  try {
    for (const f of fs.readdirSync(q)) {
      if (!/-round\\.jsonl$/.test(f)) continue; // ⛔ 含 verification-round.jsonl —— 故读数里点名最新文件名（见 roundRecords）
      try {
        const st = fs.statSync(path.join(q, f));
        out.roundRecords.push({ rel: '.quay/' + f, mtimeMs: st.mtimeMs, bytes: st.size });
      } catch (e) {}
    }
  } catch (e) {}
  out.roundRecords.sort(function (a, b) { return b.mtimeMs - a.mtimeMs; });
  try {
    const raw = fs.readFileSync(path.join(q, 'quay-init-state.json'), 'utf8'); // 读配置形状版本 + 它的龄（陈旧度）
    const st = JSON.parse(raw);
    out.initStatePresent = true;
    if (st && typeof st.pluginVersion === 'string') out.initStatePluginVersion = st.pluginVersion;
    if (st && typeof st.laidAt === 'number' && Number.isFinite(st.laidAt)) {
      out.initStateLaidAt = st.laidAt;
      out.initStateAgeSec = Math.max(0, Math.round(nowMs / 1000 - st.laidAt));
    }
  } catch (e) {
    try { out.initStatePresent = fs.existsSync(path.join(q, 'quay-init-state.json')); } catch (e2) {}
  }
  const tracePath = path.join(q, 'fan-in-step-trace.jsonl'); // 目标项目自己的载体，⛔ 不是本仓同名文件
  try {
    const st = fs.statSync(tracePath);
    let text;
    if (st.size > ${HEALTH_MAX_TRACE_BYTES}) {
      const fd = fs.openSync(tracePath, 'r');
      const buf = Buffer.alloc(${HEALTH_MAX_TRACE_BYTES});
      fs.readSync(fd, buf, 0, ${HEALTH_MAX_TRACE_BYTES}, st.size - ${HEALTH_MAX_TRACE_BYTES});
      fs.closeSync(fd);
      text = buf.toString('utf8');
      out.traceTruncated = true;
      const nl = text.indexOf('\\n');
      if (nl >= 0) text = text.slice(nl + 1);
    } else {
      text = fs.readFileSync(tracePath, 'utf8');
    }
    const rows = [];
    for (const line of text.split('\\n')) {
      if (!line.trim()) continue;
      let r;
      try { r = JSON.parse(line); } catch (e) { out.fanInParseErrors += 1; continue; } // ⛔ 静默丢弃 = 把「读不懂」伪装成「零失败」
      if (!r || r.event !== 'step-end') continue;
      rows.push({
        step: typeof r.step === 'string' ? r.step : null,
        task: typeof r.task === 'string' ? r.task : null,
        epoch: typeof r.epoch === 'number' ? r.epoch : null,
        ok: typeof r.ok === 'boolean' ? r.ok : null,
      });
    }
    out.fanInSteps = rows;
  } catch (e) { out.fanInSteps = null; }
  try {
    const ps = execSync('ps -eo pid=,args=', { encoding: 'utf8', maxBuffer: 16777216, timeout: 10000 });
    const hit = [];
    for (const line of ps.split('\\n')) {
      if (line.indexOf('--root ' + root) < 0) continue;
      if (!/(?:^|[\\s\\/])(?:promotion|worker|goal|meta|quality|outer)-driver\\.(?:js|ts)|(?:^|[\\s\\/])driver-runtime\\.(?:js|ts)/.test(line)) continue;
      hit.push(line.trim().slice(0, 200));
    }
    out.driverProcesses = { count: hit.length, samples: hit.slice(0, 3) };
  } catch (e) { out.driverProcesses = null; }
}
process.stdout.write(JSON.stringify(out) + '\\n');
`;

/** 健康度三态词表（⛔ 加态即改判据集合，同 GoalCloseBlockVerdict 的接法）：
 *  healthy        探针可达 ∧ 关键载体齐全 ∧ 窗口内零失败；
 *  unhealthy      探针可达 ∧ 关键载体齐全 ∧ 窗口内 ≥1 个 `ok:false` 步骤（成因在 failedByStep）；
 *  not-evaluated  探针跑不成 / 目标根不存在 / 关键载体缺失 / 输出读不懂（成因在 cause，⛔ 不返回 0）。 */
export type TargetHealthVerdict = "healthy" | "unhealthy" | "not-evaluated";

/** not-evaluated 的成因（⛔ 枚举而非自由文本；detail 另置 causeDetail）：
 *  no-target-configured  未声明目标项目（drivers.yml 无 target_root 且无 CLI 覆盖）⇒ 本读数无从谈起；
 *  probe-failed          探针命令非零退出 / spawn 失败（含 ssh 连不上、目标机无 node）——环境问题；
 *  probe-unparseable     探针 exit 0 但 stdout 不是本探针的 JSON 形态（版本漂移 / 被别的东西顶替）；
 *  target-root-absent    探针跑通但目标根在目标机上不存在（路径错 / 项目被删）；
 *  carrier-missing       关键载体缺失（枚举在 causeDetail）——「没跑过」不得与「零信号」同形；
 *  process-list-unreadable 进程表读不到（`ps` 不可用 / 被沙箱挡）⇒ 「有没有 driver 在跑」不可知
 *                        ——⛔ 不可知不得回落成「在跑」（硬规则 3b：读不懂不得与合格同形）；
 *  init-state-missing    目标项目没有 `.quay/quay-init-state.json`（未 quay-init / 被删）⇒ 配置形状
 *                        版本与本 fact 的陈旧度都无从谈起 ⇒ 不能判「形状不落后」；
 *  trace-unreadable      **目标项目自己的** `fan-in-step-trace.jsonl` 在、但读不出来（权限 / I/O /
 *                        它其实是个目录）——⛔ 与「零失败」不同形；
 *  trace-unparseable     该载体读出来了、但其中有**读不懂的行**（JSON 坏 / 缺 epoch / ok 非布尔）
 *                        ——⛔ 静默丢弃坏行会让「读不懂」伪装成「零失败」（硬规则 3b）;
 *  trace-truncated       尾部窗口被 1 MiB 上限截断且窗口起点未被覆盖 ⇒ 「零失败」是**下界**不是事实
 *                        （截断时**有**失败仍报 unhealthy —— 那一半是可取假的真结论）。 */
export type TargetHealthCause =
  | "no-target-configured"
  | "probe-failed"
  | "probe-unparseable"
  | "target-root-absent"
  | "carrier-missing"
  | "process-list-unreadable"
  | "init-state-missing"
  | "trace-unreadable"
  | "trace-unparseable"
  | "trace-truncated";

/** 目标项目绑定（drivers.yml `kinds.goal.target_host` / `target_root`，CLI 可覆盖）。
 *  `host === null` ⇒ 目标根在**本机**（直接本地读）；`root === null` ⇒ 未声明目标（读数 not-evaluated）。 */
export interface TargetBinding {
  host: string | null;
  root: string | null;
}

/** 探针输出（目标机侧读出的**原始**读数；字段名即探针脚本的键，⛔ 不在这里重命名）。 */
export interface TargetProbeReading {
  probeVersion: number;
  root: string;
  rootPresent: boolean;
  nowMs: number;
  roundRecords: Array<{ rel: string; mtimeMs: number; bytes: number }>;
  driverProcesses: { count: number; samples: string[] } | null;
  initStatePresent: boolean;
  initStatePluginVersion: string | null;
  /** quay-init-state.json 的 `laidAt`（epoch 秒）与其龄（秒）——版本读数**必须带陈旧度**：
   *  不带龄的版本读数分不清「刚装的新形状」与「装了一个月没更新」（同盘上任何快照读数的纪律）。 */
  initStateLaidAt: number | null;
  initStateAgeSec: number | null;
  carriers: Record<string, boolean | null>;
  /** 窗口内 fan-in 步骤（源：**目标项目自己的** `fan-in-step-trace.jsonl`，只算 `step-end` 行）。
   *  ⛔ 探针读不到该载体 ⇒ null（不是 []，硬规则 3b）。 */
  fanInSteps: Array<{ step: string | null; task: string | null; epoch: number | null; ok: boolean | null }> | null;
  /** 尾部窗口是否被 `HEALTH_MAX_TRACE_BYTES` 截断。 */
  traceTruncated: boolean;
  /** 尾部窗口里 JSON 坏掉的行数（⛔ 探针自己计数，不静默丢弃——硬规则 3b）。 */
  fanInParseErrors: number;
}

/** `goal-target-health` 的 fact.value（全部是直接量；每个字段的来源见各字段注释）。
 *  ⛔ 三态：`verdict` 独立取值，且 not-evaluated 时 `signals === null`（⛔ 不是 []）——两者都不可省。 */
export interface TargetHealthReading {
  target: { host: string | null; root: string | null };
  verdict: TargetHealthVerdict;
  /** verdict==="not-evaluated" 时非 null（枚举）；healthy/unhealthy 恒 null（无成因可言）。 */
  cause: TargetHealthCause | null;
  causeDetail: string[];
  /** 活性读数（categorical，⛔ 不进 verdict，见本节头注）：从 `ps` 里数「cmdline 含 `--root <目标根>`
   *  且匹配 `<kind>-driver.js|ts` / `driver-runtime.js|ts`」的进程。`unknown` = ps 读不到
   *  （⛔ 与「零个进程」不同形）。 */
  liveness: { state: "driving" | "idle" | "unknown"; count: number | null; samples: string[] };
  /** 目标项目的 round 类心跳载体（`<目标根>/.quay/*-round.jsonl`，含 `verification-round.jsonl`）：
   *  条数 + 最新一条的**文件名与龄**（秒）。⛔ 点名文件是必要的——只报「最新龄」会把「driver 在跳」
   *  与「只有复验轮在写」读成同一个数（硬规则 4b：别用代理量代替直接量）。
   *  ⛔ 纯读数（不进 verdict）：龄的阈值成本结构未测（硬规则 4 推论）。 */
  roundRecords: { count: number; newestRel: string | null; newestAgeSec: number | null } | null;
  /** verdict 的**可取假信号**清单（枚举，⛔ 不是布尔）。每条都是 categorical、不依赖任何阈值：
   *  - `not-driving`          目标项目**零个** driver 进程（进程表可读 ⇒ 这个 0 是真读数；
   *                           「进程停了」与「在跑但慢」是两件事，本条只报前者）。
   *  - `plugin-version-mismatch` 目标配置形状版本 ≠ 交付物版本（AC4 的机械可检读数）。
   *  - `fan-in-failing`       窗口内**目标项目自己的** fan-in 步骤有 `ok:false`（`fanIn.failed>0`；
   *                           读的是 `<目标根>/.quay/fan-in-step-trace.jsonl`，⛔ 不是本仓同名文件）。
   *  ⛔ 陈旧度（round 记录龄 / 安装龄）**不进 signals** —— 判它「太老」需要一个活性阈值，其成本结构
   *  未测（硬规则 4 推论：成本结构未知前不设数值阈值）。它们是读数，不是判据。
   *  ⛔ 本清单**不含任何本仓自身**的 task 落地指标——人 2026-09-07 DIR-131 裁定禁的是「goal 侧以
   *  **本仓**落地率为输入」；`fan-in-failing` 读的是**目标项目自己**的载体、不驱动/佐证本仓任何
   *  task 判定（AC2），2026-09-12 补充裁定把两者在 `goal-driver-task-boundary-check.ts` Detector 3
   *  里分开豁免（见本节头注 `DIR-131-TARGET-PROBE-BEGIN`）。 */
  signals: string[];
  /** 逐条 verdict 输入当时的**可读性**快照（三条 verdict 输入：进程表、配置形状、fan-in 载体）。
   *  ⛔ not-evaluated 时恒 null（与 `signals` 同步）。它与 `cause` 冗余但**独立可得**：消费方拿到的是
   *  一条 fact 的**自描述**——「这个 healthy 是在三条输入都读到的情况下给的」不必反查 cause 枚举就能确认。 */
  signalScope: { livenessReadable: boolean; initStateReadable: boolean; fanInReadable: boolean } | null;
  /** 窗口内 fan-in 步骤成败（源：**目标项目自己的** `<目标根>/.quay/fan-in-step-trace.jsonl`，只算
   *  `step-end` 行——⛔ 不是本仓的同名文件）。⛔ not-evaluated 时恒 null（不与 `failed:0` 同形）。 */
  fanIn: {
    windowSec: number;
    steps: number;
    ok: number;
    failed: number;
    failedByStep: Record<string, number>;
    failedTasks: string[];
    /** 窗口外 / 字段残缺（无 epoch / 非布尔 ok）而被跳过的行数——⛔ 静默丢弃不可取。 */
    skipped: number;
    truncated: boolean;
    /** 窗口起点是否确被读到（`truncated:false` 恒 true）。false ⇒ `failed` 只是**下界**，此时
     *  `failed:0` 不足以判 healthy（⛔ 与「查过且零失败」同形，硬规则 3b）。 */
    windowFullyCovered: boolean;
  } | null;
  /** AC4：目标项目配置形状版本（quay-init 写进 `.quay/quay-init-state.json` 的 pluginVersion）与
   *  **交付物** plugin 版本（本仓 `plugin/.claude-plugin/plugin.json`，即 quay-init 写入该字段的同源）
   *  并排出现；`equal === false` 即「目标项目装的 quay 已落后于当前交付物」的机械可检读数。
   *  `targetAgeSec` = 该配置形状的龄（陈旧度）——版本不等时它区分「一分钟前刚补跑过」与「一个月没更新」。
   *  ⛔ 任一侧读不到 ⇒ `equal:null`（⛔ 不与 true 同形，硬规则 3b）。 */
  pluginVersion: {
    target: string | null;
    delivered: string | null;
    equal: boolean | null;
    initStatePresent: boolean | null;
    targetAgeSec: number | null;
  };
  /** 逐条关键载体的存在性（required=true 的那几条缺失 ⇒ verdict not-evaluated）。⛔ null = 未探测。 */
  carriers: Array<{ rel: string; present: boolean | null; required: boolean }> | null;
}

/** 读 drivers.yml 的 `kinds.goal.target_host` / `target_root`（就地解析，接法同 goalSpawnCap；
 *  本任务 Touches 不含 driver-config.ts）。缺省/空串 ⇒ null（= 未声明目标 / 目标在本机）。 */
export function declaredTargetBinding(root: string): TargetBinding {
  try {
    // ⚠️ 基准是 **workspace root**（经 DRIVERS_CONFIG_REL 单一真相源）：被驱动系统的绑定是【该项目】
    // 的声明，⛔ 不是 kernel 出厂配置——若锚到 kernel，每个第三方项目都会拿 quay 自己的
    // target_host（如 ad-arm1）去 ssh，即「测试缝/第三方静默打到另一个生产目标上」（下方 resolveTargetBinding
    // 的整体性覆盖注释讲的正是这个形态）。第三方项目未声明 ⇒ {null,null} = 未声明目标（诚实读数）。
    const text = fs.readFileSync(path.join(root, DRIVERS_CONFIG_REL), "utf8");
    const parsed = parseYaml(text) as { kinds?: { goal?: { target_host?: unknown; target_root?: unknown } } } | null;
    const g = parsed?.kinds?.goal;
    const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
    return { host: str(g?.target_host), root: str(g?.target_root) };
  } catch {
    return { host: null, root: null };
  }
}

/** 目标项目绑定的单一解析点：显式（CLI/测试缝）优先 → drivers.yml → 未声明。
 *
 *  ⛔ **覆盖是整体性的，不与 drivers.yml 逐键混搭**：只要显式给了 `host` 或 `root` 之一，整个绑定就
 *  取自显式值（未给的那一半 = null）。理由是安全性而非省事——逐键混搭会让「只指定 root 到本机夹具」
 *  变成「拿 drivers.yml 里的 host 去 ssh 生产机」，即**测试缝会静默打到生产目标上**（实测：本轮
 *  AC1/AC3/AC4 三个用例首跑就撞上这个形态，全部 ssh 到了真机）。要「原 host + 新 root」就两个都显式给。 */
export function resolveTargetBinding(
  root: string,
  override: { host?: string | null; root?: string | null } = {},
): TargetBinding {
  const explicitHost = override.host ?? null;
  const explicitRoot = override.root ?? null;
  if (override.host !== undefined || override.root !== undefined) {
    const norm = (v: string | null): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
    return { host: norm(explicitHost), root: norm(explicitRoot) };
  }
  return declaredTargetBinding(root);
}

/** shell 单引号转义（远端 `node - '<root>'` 经 ssh 拼成一条命令串，路径含空格/元字符时必须安全）。 */
export function shellQuoteArg(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** 探针 argv 的单一构造点。返回**完整 argv**（调用方 spawnSync 的第一个元素 = 程序，其余为参数）：
 *  本地 = `[process.execPath, "-", <root>, ...carriers]`（载荷走 stdin）；
 *  远端 = `[ssh, -o BatchMode=yes, -o ConnectTimeout=<n>, <host>, "node - '<root>' <carrier>..."]`
 *         （ssh 把余下实参拼成一条**远端命令串**，故 root 需转义）；
 *  缝  = `<prefix...> <root> <carrier...>`（测试缝换的是**传输层**，⛔ 不是答案：读数仍由探针脚本
 *        从真实文件系统/进程表读出）。
 *  `binding.root === null` ⇒ null（未声明目标，调用方据此出 not-evaluated，⛔ 不起任何进程）。 */
export function buildHealthProbeArgv(
  binding: TargetBinding,
  opts: { probePrefix?: string[] | null } = {},
): string[] | null {
  if (binding.root === null) return null;
  const carriers = [...HEALTH_REQUIRED_CARRIERS, ...HEALTH_OBSERVED_CARRIERS];
  if (opts.probePrefix && opts.probePrefix.length > 0) return [...opts.probePrefix, binding.root, ...carriers];
  if (binding.host) {
    const remoteCmd = ["node", "-", shellQuoteArg(binding.root), ...carriers].join(" ");
    return [
      "ssh", "-o", "BatchMode=yes", "-o", `ConnectTimeout=${HEALTH_SSH_CONNECT_TIMEOUT_SEC}`,
      binding.host, remoteCmd,
    ];
  }
  return [process.execPath, "-", binding.root, ...carriers];
}

/** 交付物 plugin 版本：本仓 `plugin/.claude-plugin/plugin.json` 的 `version` —— 与 quay-init 写入目标项目
 *  `.quay/quay-init-state.json` 的 `pluginVersion` **同源**（quay-init.sh:238 从同一路径读）；目标侧另带陈旧度
 *  （TargetProbeReading.initStateAgeSec）。任一侧读不到 ⇒ null（⛔ 不与相等同形）。 */
export function readDeliveredPluginVersion(root: string): string | null {
  try {
    // 交付物版本 = 【本 kernel 所在 plugin】的 version（⛔ 非 <root>/plugin/…：第三方项目 root 下没有
    // plugin/，按 root 读恒 null ⇒ 该读数在第三方恒 not-evaluated = 空转）。`root` 保留为 API 兼容。
    const raw = fs.readFileSync(kernelConfigPath(path.join(".claude-plugin", "plugin.json")), "utf8");
    const j = JSON.parse(raw) as { version?: unknown };
    return typeof j?.version === "string" ? j.version : null;
  } catch {
    return null;
  }
}

/** 探针 stdout 的一行 JSON → 读数（严格校验形态；⛔ 形态不对 ⇒ null ⇒ 调用方记 probe-unparseable，
 *  绝不把半个对象当读数用——那正是硬规则 3b 的形态）。取**最后一条非空行**（探针只打一行，容错）。 */
export function parseHealthProbe(stdout: string): TargetProbeReading | null {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  let o: unknown;
  try {
    o = JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
  if (o === null || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  if (typeof r.root !== "string" || typeof r.rootPresent !== "boolean") return null;
  if (typeof r.nowMs !== "number" || !Number.isFinite(r.nowMs)) return null;
  if (!Array.isArray(r.roundRecords)) return null;
  if (r.carriers === null || typeof r.carriers !== "object") return null;
  if (r.fanInSteps !== null && !Array.isArray(r.fanInSteps)) return null;
  return {
    probeVersion: typeof r.probeVersion === "number" ? r.probeVersion : 0,
    root: r.root,
    rootPresent: r.rootPresent,
    nowMs: r.nowMs,
    roundRecords: (r.roundRecords as TargetProbeReading["roundRecords"]).filter(
      (e) => e && typeof e.rel === "string" && typeof e.mtimeMs === "number",
    ),
    driverProcesses: (() => {
      const dp = r.driverProcesses as { count?: unknown; samples?: unknown } | null;
      if (!dp || typeof dp !== "object" || typeof dp.count !== "number") return null;
      return { count: dp.count, samples: Array.isArray(dp.samples) ? (dp.samples as string[]) : [] };
    })(),
    initStatePresent: r.initStatePresent === true,
    initStatePluginVersion: typeof r.initStatePluginVersion === "string" ? r.initStatePluginVersion : null,
    initStateLaidAt: typeof r.initStateLaidAt === "number" && Number.isFinite(r.initStateLaidAt) ? r.initStateLaidAt : null,
    initStateAgeSec: typeof r.initStateAgeSec === "number" && Number.isFinite(r.initStateAgeSec) ? r.initStateAgeSec : null,
    carriers: r.carriers as Record<string, boolean | null>,
    fanInSteps: r.fanInSteps === null ? null : (r.fanInSteps as TargetProbeReading["fanInSteps"]),
    traceTruncated: r.traceTruncated === true,
    fanInParseErrors: typeof r.fanInParseErrors === "number" && Number.isFinite(r.fanInParseErrors) ? r.fanInParseErrors : 0,
  };
}

/** 纯函数：探针读数 → verdict/字段（⛔ 不 spawn、⛔ 不读盘 ⇒ 可被单测穷举各态）。 */
export function deriveTargetHealth(
  binding: TargetBinding,
  probe: { ok: true; reading: TargetProbeReading } | { ok: false; cause: TargetHealthCause; detail: string[] },
  opts: {
    /** 交付物 plugin 版本（由调用方从**本仓**读出——探针在目标机上，读不到它）。 */
    deliveredPluginVersion: string | null;
    /** `fan-in-failing` 窗口（秒）；缺省 HEALTH_WINDOW_SEC_DEFAULT。 */
    windowSec: number;
  },
): TargetHealthReading {
  const target = { host: binding.host, root: binding.root };
  const required = [...HEALTH_REQUIRED_CARRIERS];
  const observed = [...HEALTH_OBSERVED_CARRIERS];
  const base = {
    target,
    liveness: { state: "unknown" as const, count: null as number | null, samples: [] as string[] },
    roundRecords: null,
    signals: null,
    signalScope: null,
    fanIn: null,
    pluginVersion: {
      target: null, delivered: opts.deliveredPluginVersion, equal: null as boolean | null,
      initStatePresent: null as boolean | null, targetAgeSec: null as number | null,
    },
    carriers: null,
  };
  if (!probe.ok) {
    return { ...base, verdict: "not-evaluated", cause: probe.cause, causeDetail: probe.detail };
  }
  const r = probe.reading;
  const carriers = [...required.map((rel) => ({ rel, present: r.carriers[rel] ?? null, required: true })),
    ...observed.map((rel) => ({ rel, present: r.carriers[rel] ?? null, required: false }))];
  const pluginVersion = {
    target: r.initStatePluginVersion,
    delivered: opts.deliveredPluginVersion,
    equal: r.initStatePluginVersion !== null && opts.deliveredPluginVersion !== null
      ? r.initStatePluginVersion === opts.deliveredPluginVersion
      : null,
    initStatePresent: r.initStatePresent,
    targetAgeSec: r.initStateAgeSec,
  };
  const liveness = r.driverProcesses === null
    ? { state: "unknown" as const, count: null, samples: [] as string[] }
    : { state: r.driverProcesses.count > 0 ? ("driving" as const) : ("idle" as const), count: r.driverProcesses.count, samples: r.driverProcesses.samples };
  const roundRecords = {
    count: r.roundRecords.length,
    newestRel: r.roundRecords.length > 0 ? r.roundRecords[0].rel : null,
    newestAgeSec: r.roundRecords.length > 0 ? Math.max(0, Math.round((r.nowMs - r.roundRecords[0].mtimeMs) / 1000)) : null,
  };
  // 未评估的成因按「越根本越先」排序（根不在 → 关键载体缺 → 进程表读不到 → 配置形状读不到 →
  // fan-in 载体读不懂）；⛔ 全部是 not-evaluated，只是彼此可区分（硬规则 3b / cause-carrier）。
  const missing = carriers.filter((c) => c.required && c.present !== true).map((c) => c.rel);
  if (!r.rootPresent) {
    // 根不在 ⇒ 读数按「零条 / unknown / 全 false」如实给出（⛔ 不回落到 base 的空壳：那会让「根不在」
    // 与「探针没跑成」在字段上同形，而两者是可区分的）——判定仍是 not-evaluated。
    return { verdict: "not-evaluated", cause: "target-root-absent", causeDetail: [r.root], target, liveness, roundRecords, signals: null, signalScope: null, fanIn: null, pluginVersion, carriers };
  }
  if (missing.length > 0) {
    return { ...base, verdict: "not-evaluated", cause: "carrier-missing", causeDetail: missing, pluginVersion, liveness, roundRecords, carriers };
  }
  // 逐条 verdict 输入都先问「读得到吗」——⛔ 任何一条读不到都不得回落成「零信号 ⇒ healthy」（硬规则 3b）。
  if (r.driverProcesses === null) {
    return { ...base, verdict: "not-evaluated", cause: "process-list-unreadable", causeDetail: ["ps -eo pid=,args="], pluginVersion, liveness, roundRecords, carriers };
  }
  if (!r.initStatePresent || r.initStatePluginVersion === null) {
    return { ...base, verdict: "not-evaluated", cause: "init-state-missing", causeDetail: [".quay/quay-init-state.json"], pluginVersion, liveness, roundRecords, carriers };
  }
  // 「载体在」不等于「读得出来 / 读得懂」——⛔ 下面两条各自把一种「读不懂」挡在 healthy 之外（硬规则 3b）：
  // 否则一个坏文件（权限、它其实是个目录、JSON 坏、字段缺）会**恰好**给出 `failed:0`，与「零失败」同形。
  if (r.fanInSteps === null) {
    return { ...base, verdict: "not-evaluated", cause: "trace-unreadable", causeDetail: ["fan-in-step-trace.jsonl"], pluginVersion, liveness, roundRecords, carriers };
  }
  if (r.fanInParseErrors > 0) {
    return { ...base, verdict: "not-evaluated", cause: "trace-unparseable", causeDetail: [`json-parse-errors=${r.fanInParseErrors}`], pluginVersion, liveness, roundRecords, carriers };
  }
  const cutoffSec = Math.floor(r.nowMs / 1000) - opts.windowSec;
  const failedByStep: Record<string, number> = {};
  const failedTasks = new Set<string>();
  let steps = 0;
  let ok = 0;
  let failed = 0;
  let skipped = 0;
  let minEpoch: number | null = null; // 尾部窗口里最早的一行（判「窗口是否被截断截掉了起点」）
  for (const s of r.fanInSteps) {
    if (s.epoch === null) { skipped += 1; continue; } // 无位置 = 无法归窗 ⇒ 它可能藏着一个窗口内的失败
    if (minEpoch === null || s.epoch < minEpoch) minEpoch = s.epoch;
    if (s.epoch < cutoffSec) continue;
    if (s.ok === null) { skipped += 1; continue; } // 窗口内但 ok 读不懂 ⇒ 它是失败还是成功不可知
    steps += 1;
    if (s.ok) { ok += 1; continue; }
    failed += 1;
    const step = s.step ?? "(unknown)";
    failedByStep[step] = (failedByStep[step] ?? 0) + 1;
    if (s.task !== null) failedTasks.add(s.task);
  }
  if (skipped > 0) {
    return { ...base, verdict: "not-evaluated", cause: "trace-unparseable", causeDetail: [`unreadable-rows=${skipped}`], pluginVersion, liveness, roundRecords, carriers };
  }
  // 截断（>1 MiB 只读尾部）时，窗口起点可能根本没被读到 ⇒ 「零失败」只是**下界**（⛔ 不能当 facts 报）。
  // 另一半是取得假的：截断里**有**失败仍然报 unhealthy —— 找到一个失败就是找到了。
  const windowFullyCovered = !r.traceTruncated || (minEpoch !== null && minEpoch <= cutoffSec);
  const fanIn = {
    windowSec: opts.windowSec, steps, ok, failed,
    failedByStep, failedTasks: [...failedTasks].sort(),
    skipped, truncated: r.traceTruncated, windowFullyCovered,
  };
  if (failed === 0 && !windowFullyCovered) {
    return { ...base, verdict: "not-evaluated", cause: "trace-truncated", causeDetail: [`window ${opts.windowSec}s not fully covered (cap ${HEALTH_MAX_TRACE_BYTES} B)`], pluginVersion, liveness, roundRecords, carriers, fanIn };
  }
  // 三条 categorical、可取假的信号（⛔ 无阈值；`fan-in-failing` 读的是目标项目自己的载体，非本仓落地率）。
  const signals: string[] = [];
  if (r.driverProcesses.count === 0) signals.push("not-driving");
  if (pluginVersion.equal === false) signals.push("plugin-version-mismatch");
  if (failed > 0) signals.push("fan-in-failing");
  return {
    target, verdict: signals.length > 0 ? "unhealthy" : "healthy", cause: null, causeDetail: [],
    liveness, roundRecords, signals, signalScope: { livenessReadable: true, initStateReadable: true, fanInReadable: true },
    fanIn, pluginVersion, carriers,
  };
}

/** 一条 `goal-target-health` fact 的人读摘要（⛔ 只描述读数，不作判定 —— 判定在 verdict 字段里）。 */
function targetHealthReason(v: TargetHealthReading): string {
  const where = `${v.target.host ? v.target.host + ":" : ""}${v.target.root ?? "(未声明目标)"}`;
  if (v.verdict === "not-evaluated") {
    return `${where}: not-evaluated (cause=${v.cause}${v.causeDetail.length > 0 ? `: ${v.causeDetail.join(", ")}` : ""})`;
  }
  const ver = v.pluginVersion;
  const ageNote = ver.targetAgeSec === null ? "" : `(陈旧度 ${ver.targetAgeSec}s)`;
  const versionNote = ver.equal === false
    ? ` pluginVersion MISMATCH ${ver.target}≠${ver.delivered}${ageNote}`
    : ver.equal === true
      ? ` pluginVersion ok${ageNote}`
      : ` pluginVersion 读不到${ver.initStatePresent === false ? "（目标无 quay-init-state）" : ""}`;
  const f = v.fanIn;
  const fanInNote = f === null ? "" : `, fan-in ${f.failed > 0
    ? `${f.failed} failed / ${f.steps} steps [${Object.entries(f.failedByStep).map(([k, n]) => `${k}×${n}`).join(" ")}]`
    : `0 failed / ${f.steps} steps${f.windowFullyCovered ? "" : "(下界：窗口未全覆盖)"}`} (window ${f.windowSec}s)`;
  return `${where}: ${v.verdict}${v.signals && v.signals.length > 0 ? ` [${v.signals.join(" ")}]` : ""} — ` +
    `liveness=${v.liveness.state}${v.liveness.count !== null ? `(${v.liveness.count})` : ""}, ` +
    `roundRecords=${v.roundRecords?.count ?? "?"}${v.roundRecords?.newestAgeSec != null ? `(newest ${v.roundRecords.newestRel} ${v.roundRecords.newestAgeSec}s)` : ""}` +
    versionNote + fanInNote;
}

/** 探被驱动系统的健康度（AC1/AC3/AC4 的读数载体）。⚠️ 同步 spawnSync（有界 20s）——它在 goal 例程
 *  的同一回合里跑，必须短且必定返回；⛔ 任何失败路径都返回一条 fact（⛔ 不抛、⛔ 不阻塞本轮）。 */
export function targetHealthFact(root: string, opts: GoalRoundOptions = {}): Fact<Record<string, unknown>> {
  const binding = resolveTargetBinding(root, { host: opts.targetHost, root: opts.targetRoot });
  const delivered = readDeliveredPluginVersion(root);
  const windowSec = (() => {
    const w = opts.healthWindowSec;
    return typeof w === "number" && Number.isFinite(w) && w > 0 ? Math.floor(w) : HEALTH_WINDOW_SEC_DEFAULT;
  })();
  const deriveOpts = { deliveredPluginVersion: delivered, windowSec };
  const notEvaluated = (cause: TargetHealthCause, detail: string[]): Fact<Record<string, unknown>> => {
    const value = deriveTargetHealth(binding, { ok: false, cause, detail }, deriveOpts);
    return { name: TARGET_HEALTH_FACT_NAME, value: value as unknown as Record<string, unknown>, state: "not-evaluated", reason: targetHealthReason(value) };
  };
  if (binding.root === null) return notEvaluated("no-target-configured", []);
  const argv = buildHealthProbeArgv(binding, { probePrefix: opts.healthProbePrefix });
  if (argv === null) return notEvaluated("no-target-configured", []);
  let res: ReturnType<typeof spawnSync>;
  try {
    res = spawnSync(argv[0], argv.slice(1), {
      input: HEALTH_PROBE_SCRIPT,
      encoding: "utf8",
      timeout: HEALTH_PROBE_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    return notEvaluated("probe-failed", [`spawn threw: ${(e as Error).message}`]);
  }
  if (res.error || res.status !== 0) {
    const detail = [
      `exit=${res.status === null ? "null" : res.status}`,
      ...(res.error ? [`error=${res.error.message}`] : []),
      ...(res.stderr ? [`stderr=${String(res.stderr).trim().split("\n").slice(-2).join(" | ").slice(0, 300)}`] : []),
    ];
    return notEvaluated("probe-failed", detail);
  }
  const reading = parseHealthProbe(String(res.stdout ?? ""));
  if (reading === null) {
    return notEvaluated("probe-unparseable", [`stdout head: ${String(res.stdout ?? "").slice(0, 200)}`]);
  }
  const value = deriveTargetHealth(binding, { ok: true, reading }, deriveOpts);
  return {
    name: TARGET_HEALTH_FACT_NAME,
    value: value as unknown as Record<string, unknown>,
    // ⛔ unhealthy 也是 **verified**（读数取到了，值说它不健康）；只有「没取到」才是 not-evaluated。
    // ⛔ 绝不取 failed —— 那会把本 driver 自己的轮标成失败（AC2 的反面）。
    state: value.verdict === "not-evaluated" ? "not-evaluated" : "verified",
    reason: targetHealthReason(value),
  };
}

// ── 常驻形态（例程，复用通用例程型循环）────────────────────────────────────────────────────

/** 本 driver 的例程集：**只此一条**（goal 机械环 + G9 语义环 + 一条被驱动系统健康度读数）。复用
 *  quality-gate-driver 的通用例程型常驻循环（收 RoutineSpec[]、评估 due、汇 Facts、写轮记录），
 *  ⛔ 不抄一份样板。
 *
 *  ⚠️ `targetHealthFact` 在 `runGoalRound` **之外**调用（AC2 的结构保证）：goal 达成判定看不到它，
 *  ⛔ 不构成任何前置。它只**追加一条并列的 fact**（gap-goal-driver-blind-to-driven-system-health）。 */
export function goalDriverRoutines(root: string, opts: GoalRoundOptions = {}): RoutineSpec[] {
  return [{
    name: "goal-ring",
    schedule: EVERY_ROUND,
    run: async () => {
      const { fact, sufficiencyFacts, objectiveFacts, gapFacts } = await runGoalRound(root, opts);
      return [fact, ...sufficiencyFacts, ...objectiveFacts, ...gapFacts, targetHealthFact(root, opts)];
    },
  }];
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────

const HELP = [
  "goal-driver.ts — G6 goal 机械环例程型 driver + G9 缺口语义环（跑 criterion→写 GateEvent→I2 flip→I3/I4 报出→缺口 spawn agent）",
  "",
  "Usage: node --experimental-strip-types plugin/scripts/goal-driver.ts [options]",
  "  --root <dir>           仓库根（缺省 cwd；goals/ 与 .quay/ 都在其下）",
  "  --script-root <dir>    goal-store.ts 所在的 quay 代码根（缺省 = 从本 kernel 安装位置反推；测试缝/负控制把 goals/ 与脚本根分离）",
  "  --interval <ms>        循环滴答间隔（缺省 " + INTERVAL_MS_DEFAULT + "，来自 drivers.yml goal.interval_ms）",
  "  --once                 跑一轮即退出（手动单发 / 测试）",
  "  --max-rounds <n>       跑满 N 轮退出（测试缝）",
  "  --round-log <path>     轮记录文件（缺省 <root>/.quay/goal-round.jsonl）",
  "  --run-id <id>          轮记录里的 run_id",
  "  --pid-file <path>      把驱动自身 pid 写到该文件（外部观测 + kill 抓手）",
  "  --gap-worker-cmd <s>   覆盖 gap-filing agent 命令前缀（测试缝；prompt 仍作末参数追加）",
  "  --resource-gate-cmd <s> 覆盖 resource-gate 命令（测试缝；spawn 前判定，exit 0=GO）",
  "  --ready-pool-cmd <s>   覆盖 ready-pool-check 命令（测试缝；stalled 第四态的结构量来源）",
  "  --llm-commands <csv>   配置声明的 LLM 命令集，逗号分隔（缺省 claude,claude-fjdac）",
  "  --spawn-cap <n>        覆盖每轮缺口立案 spawn 上限（缺省 drivers.yml goal.spawn_cap）",
  "  --gap-worker-timeout-ms <ms> 覆盖 gap-filing agent spawn 超时（缺省 drivers.yml goal.gap_worker_timeout_ms）",
  "  --sufficiency-stall-window-ms <ms> 覆盖充分性卡死信号的 stall 窗口（缺省 = 推导式 judgeWallclockMs + roundIntervalMs，",
  "                         即 drivers.yml 不写值就是推导值；显式值可用 drivers.yml kinds.goal.sufficiency_stall_window_ms）",
  "  --sufficiency-followup-cmd <s> 覆盖信号 agent 命令前缀（测试缝；prompt 仍作末参数追加）",
  "  --sufficiency-followup-timeout-ms <ms> 覆盖信号 agent spawn 超时（缺省同 gap-filing 的 drivers.yml 字段）",
  "  --target-host <h>       覆盖被驱动系统所在主机（缺省 drivers.yml goal.target_host；空 = 目标在本机）",
  "  --target-root <dir>     覆盖被驱动系统根路径（缺省 drivers.yml goal.target_root；未声明 ⇒ 该读数 not-evaluated）",
  "  --health-window-sec <n> 被驱动系统健康度的 fan-in 窗口（秒，缺省 " + HEALTH_WINDOW_SEC_DEFAULT + "）",
  "  --json                 每轮向 stdout 打一条 JSON 事件行",
  "",
  "Exit: 0 = 轮跑完（含 not-evaluated）; 1 = 轮失败; 2 = usage",
].join("\n");

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
  let gapWorkerCmd: string | undefined;
  let resourceGateCmd: string | undefined;
  let readyPoolCmd: string | undefined;
  let llmCommandsRaw: string | undefined;
  let spawnCapRaw: string | undefined;
  let gapWorkerTimeoutMsRaw: string | undefined;
  let scriptRootRaw: string | undefined;
  let targetHostRaw: string | undefined;
  let targetRootRaw: string | undefined;
  let healthWindowSecRaw: string | undefined;
  let sufficiencyStallWindowMsRaw: string | undefined;
  let sufficiencyFollowupCmd: string | undefined;
  let sufficiencyFollowupTimeoutMsRaw: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") root = args[++i];
    else if (a === "--script-root") scriptRootRaw = args[++i];
    else if (a === "--interval") intervalRaw = args[++i];
    else if (a === "--once") once = true;
    else if (a === "--max-rounds") maxRounds = Number(args[++i]);
    else if (a === "--round-log") roundLogPath = args[++i];
    else if (a === "--run-id") runId = args[++i];
    else if (a === "--pid-file") pidFile = args[++i];
    else if (a === "--gap-worker-cmd") gapWorkerCmd = args[++i];
    else if (a === "--resource-gate-cmd") resourceGateCmd = args[++i];
    else if (a === "--ready-pool-cmd") readyPoolCmd = args[++i];
    else if (a === "--llm-commands") llmCommandsRaw = args[++i];
    else if (a === "--spawn-cap") spawnCapRaw = args[++i];
    else if (a === "--gap-worker-timeout-ms") gapWorkerTimeoutMsRaw = args[++i];
    else if (a === "--target-host") targetHostRaw = args[++i];
    else if (a === "--target-root") targetRootRaw = args[++i];
    else if (a === "--health-window-sec") healthWindowSecRaw = args[++i];
    else if (a === "--sufficiency-stall-window-ms") sufficiencyStallWindowMsRaw = args[++i];
    else if (a === "--sufficiency-followup-cmd") sufficiencyFollowupCmd = args[++i];
    else if (a === "--sufficiency-followup-timeout-ms") sufficiencyFollowupTimeoutMsRaw = args[++i];
    else if (a === "--json") json = true;
    else if (a === "--help" || a === "-h") { process.stdout.write(HELP + "\n"); return 0; }
    else { process.stderr.write(`goal-driver: unknown argument: ${a}\n${HELP}\n`); return 2; }
  }

  const rootDir = root ? path.resolve(root) : path.resolve(process.cwd());
  const intervalMs = intervalRaw !== undefined && /^\d+$/.test(intervalRaw)
    ? Number(intervalRaw)
    : loadDriverConfig(rootDir).goal.intervalMs;
  if (maxRounds !== null && (!Number.isInteger(maxRounds) || maxRounds < 1)) {
    process.stderr.write("goal-driver: --max-rounds must be a positive integer\n");
    return 2;
  }

  const roundLogFile = roundLogPath ? path.resolve(roundLogPath) : path.join(rootDir, GOAL_ROUND_REL);
  const resolvedRunId = runId ?? `goal-${Date.now()}`;
  // G9：每轮 spawn 上限（--spawn-cap 覆盖；缺省 = goalSpawnCap 读 drivers.yml）。非负整数才合法。
  const spawnCap = spawnCapRaw === undefined
    ? undefined
    : (() => {
        const n = Number(spawnCapRaw);
        if (!Number.isInteger(n) || n < 0) return null;
        return n;
      })();
  if (spawnCapRaw !== undefined && spawnCap === null) {
    process.stderr.write("goal-driver: --spawn-cap must be a non-negative integer\n");
    return 2;
  }
  // G9：每 spawn 超时（--gap-worker-timeout-ms 覆盖；缺省 = goalGapWorkerTimeoutMs 读 drivers.yml）。正整数才合法。
  const gapWorkerTimeoutMs = gapWorkerTimeoutMsRaw === undefined
    ? undefined
    : (() => {
        const n = Number(gapWorkerTimeoutMsRaw);
        if (!Number.isInteger(n) || n <= 0) return null;
        return n;
      })();
  if (gapWorkerTimeoutMsRaw !== undefined && gapWorkerTimeoutMs === null) {
    process.stderr.write("goal-driver: --gap-worker-timeout-ms must be a positive integer\n");
    return 2;
  }
  // ⑥b：stall 窗口（--sufficiency-stall-window-ms 覆盖；缺省 = 推导式）。非负整数才合法——0 合法
  // （「观察到的当轮就 file」，测试缝/紧急放行用），负值非法（负窗口在任何时钟下都无意义）。
  const sufficiencyStallWindowMs = sufficiencyStallWindowMsRaw === undefined
    ? undefined
    : (() => {
        const n = Number(sufficiencyStallWindowMsRaw);
        if (!Number.isInteger(n) || n < 0) return null;
        return n;
      })();
  if (sufficiencyStallWindowMsRaw !== undefined && sufficiencyStallWindowMs === null) {
    process.stderr.write("goal-driver: --sufficiency-stall-window-ms must be a non-negative integer\n");
    return 2;
  }
  // ⑥b：信号 agent 超时（--sufficiency-followup-timeout-ms 覆盖；缺省 = goalGapWorkerTimeoutMs 读
  // drivers.yml 的 gap_worker_timeout_ms——两者同为 fix-worker 角色的一次性语义 agent，⛔ 不另立字面量）。
  const sufficiencyFollowupTimeoutMs = sufficiencyFollowupTimeoutMsRaw === undefined
    ? undefined
    : (() => {
        const n = Number(sufficiencyFollowupTimeoutMsRaw);
        if (!Number.isInteger(n) || n <= 0) return null;
        return n;
      })();
  if (sufficiencyFollowupTimeoutMsRaw !== undefined && sufficiencyFollowupTimeoutMs === null) {
    process.stderr.write("goal-driver: --sufficiency-followup-timeout-ms must be a positive integer\n");
    return 2;
  }
  // AC140-4：配置声明的 LLM 命令集（缺省 LLM_COMMAND_SET_DEFAULT；--llm-commands 逗号分隔注入）。
  const llmCommands = llmCommandsRaw === undefined
    ? [...LLM_COMMAND_SET_DEFAULT]
    : llmCommandsRaw.split(",").map((s) => s.trim()).filter(Boolean);

  const roundOpts: GoalRoundOptions = {
    scriptRoot: scriptRootRaw ? path.resolve(scriptRootRaw) : undefined,
    gapWorkerCmd: gapWorkerCmd ?? null,
    resourceGateArgv: resourceGateCmd ? splitArgs(resourceGateCmd) : null,
    readyPoolCmd: readyPoolCmd ? splitArgs(readyPoolCmd) : null,
    llmCommands,
    spawnCap: spawnCap ?? undefined,
    gapWorkerTimeoutMs: gapWorkerTimeoutMs ?? undefined,
    // 显式传 null 表示「本次运行不读 drivers.yml 的绑定」（--target-host '' 的用法），undefined 才回落。
    targetHost: targetHostRaw,
    targetRoot: targetRootRaw,
    healthWindowSec: healthWindowSecRaw !== undefined ? Number(healthWindowSecRaw) : undefined,
    sufficiencyStallWindowMs: sufficiencyStallWindowMs ?? undefined,
    sufficiencyFollowupCmd: sufficiencyFollowupCmd ?? null,
    sufficiencyFollowupTimeoutMs: sufficiencyFollowupTimeoutMs ?? undefined,
    // ⑥b stall 窗口推导式的第二项：把【生效的】轮间隔传进去（--interval 覆盖也一并跟着走）。
    roundIntervalMs: intervalMs,
  };

  // 常驻（例程型）：复用通用例程型循环，⛔ 不另写一份。缺省 = 常驻（once=false）；--once 跑一轮即退。
  return await runResidentQualityGateLoop({
    root: rootDir,
    intervalMs,
    once,
    maxRounds,
    roundLogFile,
    runId: resolvedRunId,
    json,
    pidFile,
    kind: "goal",
    controlStateRel: GOAL_CONTROL_STATE_REL,
    routines: goalDriverRoutines(rootDir, roundOpts),
  });
}

// ⛔ argv1 必须留 undefined（让它读 process.argv[1]）：传本模块自身路径会使 basename 恒等于
// expectedBase ⇒ 恒为真 ⇒ 被 import 时就跑一整轮。
if (isDirectEntry(import.meta, undefined, "goal-driver")) {
  main(process.argv).then((c) => { process.exitCode = c; });
}
// DIR-131-TARGET-PROBE-END
