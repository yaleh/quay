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
//   ⛔ draft→active（激活）——人/manager 手动（裁定 3「暂不做自动晋升」），本 driver 不碰。
//   ⛔ active→retired（放弃）——人裁定。放弃是判断不是计算，本 driver 只报红不翻状态。
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
  opts: { actor?: string; reason?: string } = {},
): Promise<{ ok: boolean; reason: string }> {
  const extra: string[] = [];
  if (opts.actor) extra.push("--actor", opts.actor);
  if (opts.reason) extra.push("--reason", opts.reason);
  const argv = goalStoreArgv(scriptRoot, ["write", id, "--status", status, ...extra], dataRoot);
  const r = await runAsync(argv, { timeoutMs: CRITERION_TIMEOUT_MS, collectStderr: true });
  if (r.error) return { ok: false, reason: `write spawn error: ${r.error.message}` };
  if (r.status !== 0) return { ok: false, reason: `write exit ${r.status}: ${(r.stderr || "").trim().slice(0, 200)}` };
  return { ok: true, reason: "written" };
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
): Promise<{ achievedButFailing: string[]; evaluated: boolean; scopeSize: number } | null> {
  const r = await runAsync(goalStoreArgv(scriptRoot, ["check", "--achieved-failing"], dataRoot), { timeoutMs: CRITERION_TIMEOUT_MS, collectStderr: true });
  if (r.error) return null;
  try {
    const j = JSON.parse(String(r.stdout ?? "").trim());
    const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
    return {
      achievedButFailing: arr(j.achievedButFailing),
      evaluated: j.evaluated === true,
      scopeSize: typeof j.scopeSize === "number" ? j.scopeSize : -1,
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
  const acs = records.filter((r) => String(r.id ?? "").startsWith("AC-") && String(r.goal ?? "") === goalId);
  const inScope = acs.filter((r) => r.status === "active" || r.status === "achieved" || r.status === "needs-human");
  if (inScope.length === 0) return false;
  return inScope.every((r) => r.status === "achieved");
}

// ── 缺口四态（G7 + G9 stalled，硬规则 3b：读不懂输入不得返回与「合格」同形——「缺口」与「未评估」分离）──

/** 单条 AC 的缺口态：in-progress（有任务推进）/ gap（缺口）/ stalled（有任务但都无法自行前进）/
 *  not-evaluated（读不到 tasks 输入）。四态并存，not-evaluated 保留（硬规则 3b）。 */
export type GapState = "in-progress" | "gap" | "stalled" | "not-evaluated";

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

/** 缺口计算（G7 机械量，SPEC §6.2 ⑤）：对每条未达成（status=active）AC，
 *  count(task where goal_ac == AC and status ∈ {todo,ready,needs-human}) == 0 ⇒ 缺口。
 *  四态：gap（计数 == 0）/ stalled（计数 > 0 但关联任务全都无法自行前进——G9，judgment 提供结构量；
 *  ⚠️ needs-human 亦属 stalled：已离开 todo/ready、需人处理，有处理者但不能自行前进，且与
 *  judgment 无关）/ in-progress（计数 > 0）/ not-evaluated（taskFacts == null）。
 *  judgment===null（读不到 ready-pool-check）⇒ 不判 stalled（⛔ 不把「读不懂」伪装成「卡住」，
 *  也不伪装成「推进中」——stalled 只是对 in-progress 的细化，读不懂时回到 in-progress），
 *  ⛔ 例外：关联集合全为 needs-human 时无论 judgment 有无都判 stalled（needs-human 不需要
 *  ready-pool 结构量即可判定「不能自行前进」）。
 *  ⛔ 本仓任务无独立 in-flight 态——派发中的任务 status 仍为 todo/ready，故「推进中」集合 =
 *  {todo, ready, needs-human}。done/superseded 不计入（真的没有在做的任务 ⇒ gap 正确）；
 *  draft/superseded/retired/achieved 的 AC 均不是缺口对象（未激活 / 已关闭 / 已达成）。 */
export function computeGoalGaps(
  records: Array<Record<string, unknown>>,
  taskFacts: Array<{ id: string; status: string | null; goalAc: string | null }> | null,
  judgment: ReadyPoolJudgment | null = null,
): Array<GoalGap> {
  const out: Array<GoalGap> = [];
  for (const r of records) {
    const id = String(r.id ?? "");
    if (!id.startsWith("AC-")) continue;
    if (String(r.status ?? "") !== "active") continue;
    const goal = String(r.goal ?? "");
    if (taskFacts === null) {
      out.push({ goal, ac: id, state: "not-evaluated", taskCount: null });
      continue;
    }
    const associated = taskFacts.filter(
      (t) => t.goalAc === id && (t.status === "todo" || t.status === "ready" || t.status === "needs-human"),
    );
    const count = associated.length;
    const state: GapState = count === 0
      ? "gap"
      : (associated.every((t) => t.status === "needs-human")
          ? "stalled"
          : (judgment !== null && associated.every((t) => isTaskStuck(t, judgment)) ? "stalled" : "in-progress"));
    out.push({ goal, ac: id, state, taskCount: count });
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
    path.join(root, "plugin", "scripts", "ready-pool-check.ts"),
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

// ── G9 缺口语义环（spawn 短命 agent 经 ABI 立案，照 promotion-driver 的 fix-worker 现成形态）──────

/** gap-filing agent 的 prompt：一条 gap AC 的结构化信息（goal/ac/title/expect），⛔ 非散文指令。
 *  agent 立案必须经 quay-file-task（其【按机制去重】步骤防重复立案）；文件须带顶层 goal_ac 供下一轮
 *  readTaskFacts 独立复核（⛔ 不信 agent 自述）。 */
export function buildGapWorkerPrompt(gap: GoalGap, goalTitle: string, acTitle: string, acExpect: string, root: string): string {
  return [
    "You are a gap-filing agent in the quay repo. A goal criterion (AC) has a structural gap: no todo/ready/needs-human task advances it.",
    `Repo root: ${root}.`,
    `goal_id=${gap.goal} goal_title=${goalTitle}`,
    `ac_id=${gap.ac} ac_title=${acTitle}`,
    `ac_expect=${acExpect}`,
    "Read the AC record (goal_get MCP) to understand the work it demands, then file ONE child task that closes this gap via the `quay-file-task` skill (Skill tool).",
    "The quay-file-task skill performs MECHANISM-BASED dedup: if a task already claims this AC via a top-level `goal_ac:` field (ANY status, including needs-human), do NOT file a duplicate — report the existing task id instead.",
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

/** G9 缺口语义环的 spawn pass：缺口（state==="gap"）非空 ⇒ 过 halt + 资源门 + 每轮上限，逐条 spawn
 *  短命 agent（一条 gap AC 一个 agent，经 quay-file-task 立案）。返回 spawned（实际 spawn 数）与
 *  llmInvoked（派生自真实 argv，⛔ 不硬编码）。⛔ 不验证立没立案（下一轮 readTaskFacts 独立复核）。 */
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
  const gapAcs = gaps.filter((g) => g.state === "gap");
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
  flips: Array<{ id: string; to: string; ok: boolean; reason: string }>;
  /** I3 三桶 + I4 分歧；null = check --staleness 读不到（⛔ 与「零 stale」不同形，硬规则 3b）。
   *  scopeSize = 枚举出的 active goal 数（作用域规模）；evaluated = scopeSize > 0。0 active goal ⇒
   *  evaluated:false、scopeSize:0——空作用域与「查过且全过」按字段区分（⛔ 同形，硬规则 3b）。 */
  staleness: { fresh: string[]; stale: string[]; notEvaluated: string[]; divergent: string[]; scopeSize: number; evaluated: boolean } | null;
  /** I5 achieved-but-failing；null = check --achieved-failing 读不到（⛔ 与「零」不同形，硬规则 3b）。
   *  scopeSize = 枚举出的作用域规模（active goal 下 achieved AC 且 criterion 非空）；evaluated =
   *  scopeSize > 0。空作用域与「查过且全过」按字段区分（⛔ 同形，硬规则 3b）。 */
  achievedFailing: { achievedButFailing: string[]; evaluated: boolean; scopeSize: number } | null;
  /** ⑤ 缺口读数（G7 + G9 stalled）：每条 active AC 的四态；taskFacts==null ⇒ 逐条 not-evaluated。 */
  gaps: Array<GoalGap>;
  /** ⑥ G9 语义环：本轮实际 spawn 的 gap-filing agent 数（过 halt/资源门/上限后；0 = 未 spawn）。 */
  spawned: number;
  /** ⑥ G9 语义环：本轮 spawn 是否调用了 LLM（派生自真实 argv，⛔ 不硬编码）。 */
  llm_invoked: boolean;
  /** ⑥ G9 语义环：逐条 spawn 诊断（ac · goal · exitCode · stderr · timedOut，⛔ 零诊断信息）。 */
  gap_spawns: Array<GapSpawnOutcome>;
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
}

export interface GoalRoundResult {
  fact: Fact<Record<string, unknown>>;
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
    return { fact: { name: "goal-ring", value: { phase: "list" }, state: "failed", reason: `list failed: ${(e as Error).message}` } };
  }

  const isGoal = (r: Record<string, unknown>): boolean => String(r.id ?? "").startsWith("GOAL-");
  const isAc = (r: Record<string, unknown>): boolean => String(r.id ?? "").startsWith("AC-");
  const activeGoals = records.filter((r) => isGoal(r) && r.status === "active");
  const criteria: GoalRoundReadings["criteria"] = [];
  const flips: GoalRoundReadings["flips"] = [];

  // 对每个 active GOAL：① 跑其每条 AC 的 criterion；② I2 推导（AC pass→achieved，全达成→GOAL achieved）。
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
    // I2（GOAL 层）：全部 AC achieved 且 ≥1 条 ⇒ 机械 flip GOAL（裁定 5）。
    if (goal.status === "active" && goalAchievedFromRecords(records, gid)) {
      const w = await writeGoalStatus(scriptRoot, gid, "achieved", dataRoot, { actor: "goal-driver", reason: "I2: all ACs achieved" });
      flips.push({ id: gid, to: "achieved", ok: w.ok, reason: w.reason });
      if (w.ok) goal.status = "achieved";
    }
  }

  // ③ I3 判陈旧 + ④ I4 查分歧：复用 goal-store 的单一真相源（读的是 gate 写回后的最新 evidence）。
  const staleness = await checkStaleness(scriptRoot, dataRoot);
  // I5 查 achieved-but-failing：复用 goal-store 的单一真相源（独立子命令，跑判据）。
  const achievedFailing = await checkAchievedFailing(scriptRoot, dataRoot);

  // ⑤ 算缺口（G7 + G9 stalled）：读 tasks/*.md 的 goal_ac → 对每条 active AC 给四态。taskFacts==null ⇒
  // 逐条 not-evaluated。stalled 的结构量来自 ready-pool-check（只在存在 goal_ac 关联任务时才跑，避免
  // 每轮无谓地起一次昂贵的全池判定）。
  const taskFacts = await readTaskFacts(dataRoot);
  const hasGoalAcTasks = taskFacts !== null && taskFacts.some((t) => t.goalAc !== null);
  const judgment = hasGoalAcTasks ? await readReadyPoolJudgment(root, opts.readyPoolCmd) : null;
  const gaps = computeGoalGaps(records, taskFacts, judgment);

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
    staleness,
    achievedFailing,
    gaps,
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
        `achievedButFailing=${achievedFailing ? achievedFailing.achievedButFailing.length : "?"}`,
    },
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
      const { fact } = await runGoalRound(root, opts);
      return [fact];
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
