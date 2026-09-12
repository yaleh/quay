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
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";
// Layer 0（driver-runtime 单一实现）：DRIVER_KINDS（controlFile/carriers 单源）、runAsync（非阻塞
// spawn）、launchArgv（LLM 调用配置单一构造点）、splitArgs（测试缝覆盖命令切分）、Fact / RoutineSpec
// （Layer 1b 例程契约）。
import { DRIVER_KINDS, runAsync, launchArgv, splitArgs, type Fact, type RoutineSpec } from "./driver-runtime.ts";
// Layer 1b 常驻循环（quality-gate-driver 的通用例程型循环 + 统一轮记录信封，同 meta-driver 的接法）。
import { runResidentQualityGateLoop } from "./quality-gate-driver.ts";
// goal-store CLI 的 argv 单一构造点（所有 goal 读写都经这里，⛔ 不在别处拼路径——同 meta-driver）。
import { goalStoreArgv } from "./meta-driver.ts";
// AC155：轮询间隔的单一真相源（drivers.yml 经 driver-config 加载，⛔ 不各写一份字面量）。
import { defaultDriverConfig, loadDriverConfig } from "./driver-config.ts";
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
// 那个口（硬规则 5b）。goal-store.ts 的 argv 构造仍走 meta-driver 的 goalStoreArgv（⛔ 不绕过 store）。
import { inAchievedReverifyScope } from "../../packages/quay/src/goal-store.ts";

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
    const text = fs.readFileSync(path.join(root, "plugin", "scripts", "drivers.yml"), "utf8");
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
    const text = fs.readFileSync(path.join(root, "plugin", "scripts", "drivers.yml"), "utf8");
    const parsed = parseYaml(text) as { kinds?: { goal?: { gap_worker_timeout_ms?: unknown } } } | null;
    const v = parsed?.kinds?.goal?.gap_worker_timeout_ms;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  } catch {
    /* drivers.yml 缺失/不可解析 ⇒ 回退缺省（同 goalSpawnCap 的 fail-open） */
  }
  return GAP_WORKER_TIMEOUT_MS_DEFAULT;
}

// ── goal-store CLI 客户端（单一 argv 构造点经 meta-driver 的 goalStoreArgv；读/写/check 在本文件，
//    ⛔ 不复写 meta-driver 的 listGoalRecords/gateCriterion——它们把 scriptRoot 与 dataRoot 合二为一，
//    本 driver 要支持【测试缝】把两者分开：scriptRoot 定位 goal-store.ts，dataRoot 定位 goals/）。──

/** 读全部 goal 记录。解析不了 ⇒ 抛（fail-closed：读不到输入不得继续，⛔ 不返回空数组冒充"没有"）。 */
export async function listGoalRecords(scriptRoot: string, dataRoot: string): Promise<Array<Record<string, unknown>>> {
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
  scriptRoot: string,
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
  scriptRoot: string,
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
  scriptRoot: string,
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
  scriptRoot: string,
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
  scriptRoot: string,
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

/** 取 body 的 `## 退出条件` 节文本（标题后至下一 `## ` 标题或结尾；节体 trim）。无该节 / 节体空 ⇒ ""。
 *  ⛔ 标题后只允许水平空白 [ \t]*，不用 \s*——\s 含 \n，会把「标题后紧跟的空行 + 下一节标题」吞进
 *  标题匹配，导致空节被误判为「有内容」。 */
function exitConditionsText(body: string): string {
  const m = body.match(/##[ \t]+退出条件[ \t]*\r?\n([\s\S]*?)(?=\r?\n##[ \t]|$)/);
  return m !== null ? m[1].trim() : "";
}

/** body 是否含非空的 `## 退出条件` 节（标题存在且节体有非空白内容——「写下了」，⛔ 不是「只有标题」）。 */
function hasExitConditions(body: string): boolean {
  return exitConditionsText(body).length > 0;
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

/** 充分性语义判定的 prompt：把 GOAL 的退出条件文本 + 在域 AC 集合（id/title/expect）结构化给 LLM，
 *  要求只输出一行 JSON。⛔ 非散文指令——结构化事实 + 输出契约（解析靠 parseSemanticSufficiencyVerdict）。 */
export function buildSufficiencyPrompt(
  goal: Record<string, unknown>,
  inScopeAcs: Array<Record<string, unknown>>,
  root: string,
): string {
  const gid = String(goal.id ?? "");
  const title = String(goal.title ?? "");
  const exitText = exitConditionsText(String(goal.body ?? ""));
  const acLines = inScopeAcs.length === 0
    ? "(none)"
    : inScopeAcs.map((ac) => `- ${String(ac.id ?? "")}: ${String(ac.title ?? "")} | expect=${String(ac.expect ?? "")}`).join("\n");
  return [
    "You are a sufficiency judge in the quay repo. Decide whether the goal's in-scope AC set fully covers its exit conditions.",
    `Repo root: ${root}.`,
    `goal_id=${gid} goal_title=${title}`,
    "## 退出条件 (exit conditions):",
    exitText,
    "## In-scope ACs:",
    acLines,
    'Reply with EXACTLY one line of JSON and nothing else: {"verdict":"covered"} if every exit condition is covered by the AC set, otherwise {"verdict":"insufficient"}.',
  ].join("\n");
}

/** 充分性判定的输入哈希（确定性缓存 key）：goal.id ‖ 退出条件文本 ‖ 在域 AC 的 (id,title,expect)
 *  有序列表——即 buildSufficiencyPrompt 的全部【语义】输入（⛔ root 与固定指令文本是常量，不入 key；
 *  换机器/换指令文本会按各自常量独立判，不影响「语义输入是否变化」）。任一在域 AC 的 expect / goal
 *  退出条件 / AC 集合（增删序）变化 ⇒ 哈希变 ⇒ 自动重判（AC3 的「输入变化必重判」）。 */
export function sufficiencyCacheKey(
  goal: Record<string, unknown>,
  inScopeAcs: Array<Record<string, unknown>>,
): string {
  const canonical = JSON.stringify({
    goal: String(goal.id ?? ""),
    exit: exitConditionsText(String(goal.body ?? "")),
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
  try {
    const raw = fs.readFileSync(path.join(dir, SUFFICIENCY_CACHE_BASENAME), "utf8");
    const parsed = JSON.parse(raw) as { entries?: unknown } | null;
    const entries = parsed && typeof parsed === "object" ? parsed.entries : null;
    if (entries && typeof entries === "object") {
      for (const [k, v] of Object.entries(entries as Record<string, unknown>)) {
        if (v && typeof v === "object") {
          const verdict = (v as { verdict?: unknown }).verdict;
          const ts = (v as { ts?: unknown }).ts;
          if (verdict === "covered" || verdict === "insufficient") {
            sufficiencyCache.set(k, { verdict, ts: typeof ts === "string" ? ts : "" });
          }
        }
      }
    }
  } catch {
    /* 无缓存文件 / 读不懂 ⇒ 空缓存开始（重新判，⛔ 不冒充命中） */
  }
}

/** 落盘缓存（整份覆盖写；写失败 ⇒ 内存缓存仍在，跨重启退化到重新判——观测性退化，⛔ 非正确性破坏）。 */
function persistSufficiencyCache(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const entries: Record<string, SufficiencyCacheEntry> = {};
    for (const [k, v] of sufficiencyCache) entries[k] = v;
    fs.writeFileSync(path.join(dir, SUFFICIENCY_CACHE_BASENAME), JSON.stringify({ version: 1, entries }, null, 2) + "\n");
  } catch {
    /* 写失败 ⇒ 不抛（本轮裁决不受影响；跨重启存活退化为进程内持久） */
  }
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

// ── 缺口五态（G7 + G9 stalled + done-unresolved，硬规则 3b：读不懂输入不得返回与「合格」同形——
//    「缺口」/「无牵引」/「未评估」分离；硬规则 3：枚举不布尔——「零关联」与「全 done」两种成因不同处置）──

/** 单条 AC 的缺口态（七态并存，not-evaluated 保留——读不到 tasks 输入与「缺口/无牵引」不同形，硬规则 3b）：
 *  in-progress       有任务推进（todo/ready/needs-human 有牵引）
 *  gap               真缺口：零关联任务（无任何 goal_ac==ac 的任务）⇒ 该 spawn 立案
 *  done-unresolved   有关联任务、但全部为非牵引态（done/superseded 等）而 AC 判据仍未达成——工作已做过，
 *                    缺的是复验或工作量不足，⛔ 不该再每轮 spawn 同一条任务（gap-goal-gap-done-task-not-
 *                    traction-respawns-every-round；与 gap「零关联」不同形，硬规则 3）
 *  stalled           有任务但都无法自行前进（G9 结构判据）
 *  not-evaluated     读不到 tasks 输入（taskFacts==null），或 **AC-216 复验域**读不到 I5 读数（standings==null）
 *  standing-ok       **AC-216 复验域**专有：常设不变式（achieved ∧ long-term ∧ GOAL 非 active）此刻
 *                    **成立**（I5 没把它列进 achievedButFailing）⇒ 无工作可立，⛔ 不 spawn
 *  standing-violated **AC-216 复验域**专有：常设不变式**此刻违反**（I5 列出了它）且**没有任何在飞任务**在
 *                    处理它 ⇒ 该 spawn 立案。⛔ 与 done-unresolved 不同形：曾经 done 的关联任务**不覆盖回归**
 *                    （那正是「回归后再无人立案」的成因），只有 todo/ready/needs-human 才算有人接手
 *                    （gap-meta-computegoalgaps；硬规则 3 同族——同一容器两类 population，
 *                    用只覆盖一类的工具判空会把「无人处理」读成「已解决」）。
 */
export type GapState = "in-progress" | "gap" | "done-unresolved" | "stalled" | "not-evaluated" | "standing-ok" | "standing-violated";

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
 *  ① active AC —— 问「有没有牵引」。五态：gap（零关联任务——真缺口）/ done-unresolved（有关联任务但
 *  全部非牵引——done/superseded 等，工作已做过、⛔ 不再 spawn 立案）/ stalled（有牵引任务但全都无法
 *  自行前进——G9，judgment 提供结构量；⚠️ needs-human 亦属 stalled：已离开 todo/ready、需人处理，有
 *  处理者但不能自行前进，且与 judgment 无关）/ in-progress（有牵引且可前进）/ not-evaluated
 *  （taskFacts == null）。
 *  judgment===null（读不到 ready-pool-check）⇒ 不判 stalled（⛔ 不把「读不懂」伪装成「卡住」，
 *  也不伪装成「推进中」——stalled 只是对 in-progress 的细化，读不懂时回到 in-progress），
 *  ⛔ 例外：关联集合全为 needs-human 时无论 judgment 有无都判 stalled（needs-human 不需要
 *  ready-pool 结构量即可判定「不能自行前进」）。
 *  ⛔ 本仓任务无独立 in-flight 态——派发中的任务 status 仍为 todo/ready，故「牵引」集合 =
 *  {todo, ready, needs-human}（单一真相源 = isTractionStatus）。done/superseded 等非牵引态
 *  不再与「零关联任务」同判 gap（gap-goal-gap-done-task-not-traction-respawns-every-round）；
 *  draft/superseded/retired 的 AC 不是缺口对象（未激活 / 已放弃）。
 *
 *  ② AC-216 复验域（achieved ∧ long-term ∧ GOAL 非 active，`standingReverifyAcs`）—— 问「此刻成立吗」
 *  （`standings` = I5 `check --achieved-failing` 的读数，goal-store 单一实现）。三态：standing-ok
 *  （域内且此刻成立 ⇒ 无工作可立）/ standing-violated（域内且此刻违反 且【没有在飞任务】⇒ 该 spawn
 *  立案；⛔ done 的关联任务不压下——它不覆盖回归）/ not-evaluated（读不到 taskFacts 或读不到 I5 读数）。
 *  违反但已有在飞任务 ⇒ 复用 ① 的 in-progress / stalled。⛔ 此前这个域只被 I5 跑、不进本读数：
 *  achievedButFailing 只落轮读数与一行日志，「违规」既无写入者也无执行者
 *  （gap-meta-computegoalgaps）。 */
export function computeGoalGaps(
  records: Array<Record<string, unknown>>,
  taskFacts: Array<{ id: string; status: string | null; goalAc: string | null }> | null,
  judgment: ReadyPoolJudgment | null = null,
  standings: { achievedButFailing: string[]; evaluated: boolean } | null = null,
): Array<GoalGap> {
  const activeGoalIds = activeGoalIdsOf(records);
  // 两类 population 落在同一个 gaps 读数里（⚠️ 但判据不同——见上）：
  //   ① active AC：牵引四态（G7/G9）。
  //   ② AC-216 复验域的常设不变式：按 I5 复验读数判「此刻成立 / 此刻违反 / 读不到」。
  // 集合取自 standingReverifyAcs（与每轮 gate 集合同一处枚举，⛔ 不各自重推一遍）。
  const standingIds = new Set(standingReverifyAcs(records, activeGoalIds).map((r) => String(r.id ?? "")));
  const standingFailing = standings === null ? null : new Set(standings.achievedButFailing);
  const out: Array<GoalGap> = [];
  for (const r of records) {
    const id = String(r.id ?? "");
    if (!id.startsWith("AC-")) continue;
    const goal = String(r.goal ?? "");
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
      // 此刻违反 ⇒ 要有人做。**只有「在飞任务」才压下新一轮立案**：done/superseded 的关联任务
      // ⛔ 不压下（它不覆盖回归——那正是「回归后再无人立案」的成因，⛔ 不与 ① 的 done-unresolved
      // 同判）。有一条在飞任务被立案后即由下面的牵引态接手，故不会每轮重复 spawn。
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
    let taskCount: number;
    if (allAssociated.length === 0) {
      state = "gap";                  // 真缺口：零关联任务 ⇒ 该 spawn 立案
      taskCount = 0;
    } else if (count === 0) {
      state = "done-unresolved";      // 有关联任务但全部非牵引（done/superseded）——工作已做过，⛔ 不再 spawn
      taskCount = allAssociated.length; // 枚举关联数（⛔ 非布尔化，硬规则 3）
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
  const argv = readyPoolCmd ?? [
    "node", "--experimental-strip-types",
    path.join(root, "plugin", "scripts", "ready-pool-check.ts"),  // kernel-sibling-dev-tree-only: dev-tree-only — repo-local plugin/scripts use, not third-party sibling resolution.
    "--root", root, "--json",
  ];
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
 *  `standing-violated` 是「常设不变式回归」（done 的既有认领恰恰是**回归的证据**，⛔ 不是重复——
 *  按 `gap` 的口径去重会让 agent 每轮都拒绝立案，该缺口就永远没有执行者）。 */
export function buildGapWorkerPrompt(gap: GoalGap, goalTitle: string, acTitle: string, acExpect: string, root: string): string {
  const standing = gap.state === "standing-violated";
  return [
    standing
      ? "You are a gap-filing agent in the quay repo. A STANDING goal criterion (AC) — declared `long-term: true`, already achieved — now FAILS again: the guarantee it asserts has regressed."
      : "You are a gap-filing agent in the quay repo. A goal criterion (AC) has a structural gap: no todo/ready/needs-human task advances it.",
    `Repo root: ${root}.`,
    `goal_id=${gap.goal} goal_title=${goalTitle}`,
    `ac_id=${gap.ac} ac_title=${acTitle}`,
    `ac_expect=${acExpect}`,
    "Read the AC record (goal_get MCP) to understand the work it demands, then file ONE child task that closes this gap via the `quay-file-task` skill (Skill tool).",
    ...(standing
      ? [
          "The quay-file-task skill performs MECHANISM-BASED dedup: if a task claiming this AC via a top-level `goal_ac:` field is still IN FLIGHT (todo/ready/needs-human), do NOT file a duplicate — report the existing task id instead.",
          "⚠️ A `done`/`superseded` task claiming this AC is NOT a duplicate here — it is evidence the earlier fix did not hold. The standing invariant must hold NOW, so file a NEW task that re-establishes it (and say in the task body why the earlier fix regressed).",
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
 *  两态该立案，且成因不同：`gap`（active AC 零关联任务）+ `standing-violated`（AC-216 复验域内常设不变式
 *  此刻违反且无在飞任务）。其余态⛔ 不消耗 spawn 名额：stalled/in-progress 已有人在处理，
 *  done-unresolved/standing-ok 无工作要立，not-evaluated 是读不到而不是缺口（硬规则 3b）。 */
export function isFilingGapState(state: GapState): boolean {
  return state === "gap" || state === "standing-violated";
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
}

export interface GoalRoundOptions {
  /** goal-store.ts 脚本根（缺省 = dataRoot；测试缝传 repo 根，使 goals/ 与脚本根分离）。 */
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
  /** 覆盖充分性语义判定 spawn 超时（缺省 = SUFFICIENCY_TIMEOUT_MS；负控制 b 的「超时」注入小值）。 */
  sufficiencyTimeoutMs?: number;
}

export interface GoalRoundResult {
  fact: Fact<Record<string, unknown>>;
  /** 每条 active GOAL 的充分性判定（独立 Fact，name="goal-sufficiency"，value.sufficiency={goal, verdict}
   *  ＋ not-evaluated 时另有 cause ∈ 三成因 samples-disagree/judge-unavailable/judge-unparseable；
   *  verdict ∈ 三态 covered/insufficient/not-evaluated）。AC-212 判据 grep 的正是 facts[].value.sufficiency。
   *  零 active GOAL ⇒ 空数组——字段仍在，「查过且零条」与「未跑判定」按字段存在性区分（硬规则 3b）。 */
  sufficiencyFacts: Array<Fact<Record<string, unknown>>>;
}

/** 跑一轮 goal 机械环：枚举 active GOAL → 逐 AC 跑 criterion → 写 GateEvent（gate 自带；evidence
 *  是账本派生的，不回写文件）→ I2 flip → I3/I4（check --staleness）。返回一条 Fact（明细全在
 *  fact.value 里，统一信封 = computeRoundRecord）。 */
export async function runGoalRound(root: string, opts: GoalRoundOptions = {}): Promise<GoalRoundResult> {
  const scriptRoot = opts.scriptRoot ?? root;
  const dataRoot = root;

  let records: Array<Record<string, unknown>>;
  try {
    records = await listGoalRecords(scriptRoot, dataRoot);
  } catch (e) {
    return {
      fact: { name: "goal-ring", value: { phase: "list" }, state: "failed", reason: `list failed: ${(e as Error).message}` },
      sufficiencyFacts: [],
    };
  }

  const isGoal = (r: Record<string, unknown>): boolean => String(r.id ?? "").startsWith("GOAL-");
  const isAc = (r: Record<string, unknown>): boolean => String(r.id ?? "").startsWith("AC-");
  const activeGoals = records.filter((r) => isGoal(r) && r.status === "active");
  const activeGoalIds = activeGoalIdsOf(records);
  const criteria: GoalRoundReadings["criteria"] = [];
  const flips: GoalRoundReadings["flips"] = [];
  const closeBlocks: GoalRoundReadings["closeBlocks"] = [];
  const sufficiencyFacts: Array<Fact<Record<string, unknown>>> = [];
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

  // ⑤ 算缺口（G7 + G9 stalled + AC-216 复验域）：读 tasks/*.md 的 goal_ac → 对每条 active AC 给四态，
  // 对每条 AC-216 复验域 AC 给「此刻成立 / 违反 / 读不到」。taskFacts==null ⇒ 逐条 not-evaluated。
  // stalled 的结构量来自 ready-pool-check（只在存在 goal_ac 关联任务时才跑，避免每轮无谓地起一次昂贵的
  // 全池判定）。`achievedFailing`（③④ 刚读的 I5 读数）直接传进去——复验域的态由它判，⛔ 不重跑一遍判据。
  const taskFacts = await readTaskFacts(dataRoot);
  const hasGoalAcTasks = taskFacts !== null && taskFacts.some((t) => t.goalAc !== null);
  const judgment = hasGoalAcTasks ? await readReadyPoolJudgment(root, opts.readyPoolCmd) : null;
  const gaps = computeGoalGaps(records, taskFacts, judgment, achievedFailing);

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

  const value: GoalRoundReadings = {
    goalCount: activeGoals.length,
    criterionCount: criteria.length,
    criteria,
    flips,
    closeBlocks,
    staleness,
    achievedFailing,
    gaps,
    triage,
    spawned: spawnPass.spawned,
    llm_invoked: spawnPass.llmInvoked,
    gap_spawns: spawnPass.outcomes,
  };
  if (staleness === null) {
    return {
      fact: {
        name: "goal-ring",
        value,
        state: "not-evaluated",
        reason: `${criteria.length} criteria gated, ${flips.length} flip(s); staleness check unreadable`,
      },
      sufficiencyFacts,
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
        `frozenSweep=${frozenSweep === null ? "-" : `${frozenSweep.ran.length}/${frozenSweep.eligible}`}`,
    },
    sufficiencyFacts,
  };
}

// ── 常驻形态（例程，复用通用例程型循环）────────────────────────────────────────────────────

/** 本 driver 的例程集：**只此一条**（goal 机械环 + G9 语义环）。复用 quality-gate-driver 的通用例程型
 *  常驻循环（收 RoutineSpec[]、评估 due、汇 Facts、写轮记录），⛔ 不抄一份样板。 */
export function goalDriverRoutines(root: string, opts: GoalRoundOptions = {}): RoutineSpec[] {
  return [{
    name: "goal-ring",
    schedule: EVERY_ROUND,
    run: async () => {
      const { fact, sufficiencyFacts } = await runGoalRound(root, opts);
      return [fact, ...sufficiencyFacts];
    },
  }];
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────

const HELP = [
  "goal-driver.ts — G6 goal 机械环例程型 driver + G9 缺口语义环（跑 criterion→写 GateEvent→I2 flip→I3/I4 报出→缺口 spawn agent）",
  "",
  "Usage: node --experimental-strip-types plugin/scripts/goal-driver.ts [options]",
  "  --root <dir>           仓库根（缺省 cwd；goals/ 与 .quay/ 都在其下）",
  "  --script-root <dir>    goal-store.ts 脚本根（缺省 = root；测试缝/负控制把 goals/ 与脚本根分离）",
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
    controlStateRel: GOAL_CONTROL_STATE_REL,
    routines: goalDriverRoutines(rootDir, roundOpts),
  });
}

// ⛔ argv1 必须留 undefined（让它读 process.argv[1]）：传本模块自身路径会使 basename 恒等于
// expectedBase ⇒ 恒为真 ⇒ 被 import 时就跑一整轮。
if (isDirectEntry(import.meta, undefined, "goal-driver")) {
  main(process.argv).then((c) => { process.exitCode = c; });
}
