// plugin/scripts/goal-driver.ts — G6 (tasks/gap-goal-driver-mechanical-ring): goal 机械环例程型 driver。
//
// WHY THIS EXISTS（orchestration/SPEC-goal-mechanism-2026-09-06.md §6 + goals/AC-177-*）：
// `goal-store.ts` 2026-08-09 落地后 28 天零使用，根因是【没有强制消费者】——前五期把 store 做对、
// 迁入真实数据、断掉旧路、封了 ABI，但至今没有一个常驻进程在读它。`goal-store.ts check --staleness`
// 把 GOAL-001/GOAL-002 全部判进 `notEvaluated`（它们的 AC 一条 `evidence.at` 都没有）。本 driver 就是
// 那个消费者：每轮对每个 active GOAL 跑其 AC 的 criterion → verdict → 写 evidence（落 GateEvent），
// I2 推导 flip achieved、I3 判陈旧三态、I4 查分歧，一条 Fact[] 写 `.quay/goal-round.jsonl`。
//
// 职责边界（人 2026-09-06 裁定 3+5 划定，⛔ 逐条不得越界）：
//   ✅ 跑 AC criterion、写 evidence（goal-store gate 自带）——观测性、可逆、不改变系统行为。
//   ✅ I2 推导：AC pass 且未 achieved ⇒ 机械 flip AC；GOAL 全部 AC achieved ⇒ 机械 flip GOAL
//      （裁定 5：active→achieved 是 I2 的确定性推导，不算自动晋升）。
//   ✅ I3 判陈旧三态（fresh/stale/notEvaluated）+ I4 查分歧——复用 `goal-store check --staleness`
//      的单一真相源（⛔ 不在本文件重算 I3/I4，避免与 store 漂移）。
//   ⛔ draft→active（激活）——人/manager 手动（裁定 3「暂不做自动晋升」），本 driver 不碰。
//   ⛔ active→retired（放弃）——人裁定。放弃是判断不是计算，本 driver 只报红不翻状态。
//   ⛔ 不直接改 task 状态（撞 lifecycle/promotion-driver 的 expectedStatus CAS）。
//   ⛔ 不机械写 tasks/*.md（全仓四个 driver 零先例；缺口立案属 G7 的语义环，本期不做）。
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
import { isDirectEntry } from "./gate-script-base.ts";
// Layer 0（driver-runtime 单一实现）：DRIVER_KINDS（controlFile/carriers 单源）、runAsync（非阻塞
// spawn）、Fact / RoutineSpec（Layer 1b 例程契约）。
import { DRIVER_KINDS, runAsync, type Fact, type RoutineSpec } from "./driver-runtime.ts";
// Layer 1b 常驻循环（quality-gate-driver 的通用例程型循环 + 统一轮记录信封，同 meta-driver 的接法）。
import { runResidentQualityGateLoop } from "./quality-gate-driver.ts";
// goal-store CLI 的 argv 单一构造点（所有 goal 读写都经这里，⛔ 不在别处拼路径——同 meta-driver）。
import { goalStoreArgv } from "./meta-driver.ts";
// AC155：轮询间隔的单一真相源（drivers.yml 经 driver-config 加载，⛔ 不各写一份字面量）。
import { defaultDriverConfig, loadDriverConfig } from "./driver-config.ts";

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

/** 例程的「每轮必跑」触发（goal 机械环是每 tick 必跑；interval minutes=0 ⇒ 恒 due）。真正的节奏由
 *  常驻循环的 --interval / drivers.yml goal.interval_ms 控制。 */
export const EVERY_ROUND = { kind: "interval" as const, minutes: 0 };

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

/** 跑一条 AC 的 criterion。⚠️ 副作用是设计如此：`goal-store gate` 自己写 GateEvent + evidence 回写，
 *  这正是「自动档」允许的那类动作（观测性、可逆、不改变系统行为）。 */
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
 *  写路径 + I1′/origin 校验，⛔ 不直改 goals/*.md 文件）。origin 必须回传（goal-store CLI 要求）。 */
export async function writeGoalStatus(
  scriptRoot: string,
  id: string,
  status: string,
  origin: string,
  dataRoot: string,
): Promise<{ ok: boolean; reason: string }> {
  const argv = goalStoreArgv(scriptRoot, ["write", id, "--status", status, "--origin", origin], dataRoot);
  const r = await runAsync(argv, { timeoutMs: CRITERION_TIMEOUT_MS, collectStderr: true });
  if (r.error) return { ok: false, reason: `write spawn error: ${r.error.message}` };
  if (r.status !== 0) return { ok: false, reason: `write exit ${r.status}: ${(r.stderr || "").trim().slice(0, 200)}` };
  return { ok: true, reason: "written" };
}

/** 读 I3 三桶 + I4 分歧（复用 goal-store 的单一真相源 checkStaleness，⛔ 不在本文件重算）。
 *  退出码 1 = 存在 divergent（是发现不是错误），两者都打印 JSON 桶到 stdout。读不懂 ⇒ null。 */
export async function checkStaleness(
  scriptRoot: string,
  dataRoot: string,
): Promise<{ fresh: string[]; stale: string[]; notEvaluated: string[]; divergent: string[] } | null> {
  const r = await runAsync(goalStoreArgv(scriptRoot, ["check", "--staleness"], dataRoot), { timeoutMs: CRITERION_TIMEOUT_MS, collectStderr: true });
  if (r.error) return null;
  try {
    const j = JSON.parse(String(r.stdout ?? "").trim());
    const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
    return { fresh: arr(j.fresh), stale: arr(j.stale), notEvaluated: arr(j.notEvaluated), divergent: arr(j.divergent) };
  } catch {
    return null;
  }
}

// ── 纯推导（可单测）────────────────────────────────────────────────────────────────────────

/** I2（GOAL 层）：一个 GOAL 是否「全部 AC achieved」。零 AC ⇒ false（与 goal-store.isGoalAchieved 同源，
 *  ⛔ 不再实现一份——此处只对【本轮已按 flip 更新过 status 的本地记录】做同一判定）。 */
export function goalAchievedFromRecords(records: Array<Record<string, unknown>>, goalId: string): boolean {
  const acs = records.filter((r) => String(r.id ?? "").startsWith("AC-") && String(r.goal ?? "") === goalId);
  if (acs.length === 0) return false;
  return acs.every((r) => r.status === "achieved");
}

// ── 一轮（机械环）─────────────────────────────────────────────────────────────────────────

/** 一轮的读数。 */
export interface GoalRoundReadings {
  goalCount: number;
  criterionCount: number;
  criteria: Array<{ id: string; goal: string; status: string; verdict: "pass" | "fail" | "not-evaluated"; reason: string }>;
  flips: Array<{ id: string; to: string; ok: boolean; reason: string }>;
  /** I3 三桶 + I4 分歧；null = check --staleness 读不到（⛔ 与「零 stale」不同形，硬规则 3b）。 */
  staleness: { fresh: string[]; stale: string[]; notEvaluated: string[]; divergent: string[] } | null;
}

export interface GoalRoundOptions {
  /** goal-store.ts 脚本根（缺省 = dataRoot；测试缝传 repo 根，使 goals/ 与脚本根分离）。 */
  scriptRoot?: string;
}

export interface GoalRoundResult {
  fact: Fact<Record<string, unknown>>;
}

/** 跑一轮 goal 机械环：枚举 active GOAL → 逐 AC 跑 criterion → 写 evidence（gate 自带）→ I2 flip →
 *  I3/I4（check --staleness）。返回一条 Fact（明细全在 fact.value 里，统一信封 = computeRoundRecord）。 */
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
      // I2（AC 层）：判据 pass 且未 achieved ⇒ 机械 flip（裁定 5 的确定性推导，不算自动晋升）。
      if (verdict === "pass" && ac.status !== "achieved") {
        const w = await writeGoalStatus(scriptRoot, id, "achieved", String(ac.origin ?? ""), dataRoot);
        flips.push({ id, to: "achieved", ok: w.ok, reason: w.reason });
        if (w.ok) ac.status = "achieved";
      }
      // achieved-but-failing 的分歧由 I4（check --staleness divergent）+ meta-driver 报出，本驱动不翻回。
    }
    // I2（GOAL 层）：全部 AC achieved 且 ≥1 条 ⇒ 机械 flip GOAL（裁定 5）。
    if (goal.status === "active" && goalAchievedFromRecords(records, gid)) {
      const w = await writeGoalStatus(scriptRoot, gid, "achieved", String(goal.origin ?? ""), dataRoot);
      flips.push({ id: gid, to: "achieved", ok: w.ok, reason: w.reason });
      if (w.ok) goal.status = "achieved";
    }
  }

  // ③ I3 判陈旧 + ④ I4 查分歧：复用 goal-store 的单一真相源（读的是 gate 写回后的最新 evidence）。
  const staleness = await checkStaleness(scriptRoot, dataRoot);

  const value: GoalRoundReadings = {
    goalCount: activeGoals.length,
    criterionCount: criteria.length,
    criteria,
    flips,
    staleness,
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
        `fresh=${staleness.fresh.length} stale=${staleness.stale.length} notEvaluated=${staleness.notEvaluated.length} divergent=${staleness.divergent.length}`,
    },
  };
}

// ── 常驻形态（例程，复用通用例程型循环）────────────────────────────────────────────────────

/** 本 driver 的例程集：**只此一条**（goal 机械环）。复用 quality-gate-driver 的通用例程型常驻循环
 *  （收 RoutineSpec[]、评估 due、汇 Facts、写轮记录），⛔ 不抄一份样板。 */
export function goalDriverRoutines(root: string, opts: { scriptRoot?: string } = {}): RoutineSpec[] {
  return [{
    name: "goal-ring",
    schedule: EVERY_ROUND,
    run: async () => {
      const { fact } = await runGoalRound(root, { scriptRoot: opts.scriptRoot });
      return [fact];
    },
  }];
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────

const HELP = [
  "goal-driver.ts — G6 goal 机械环例程型 driver（跑 criterion→写 evidence→I2 flip→I3/I4 报出）",
  "",
  "Usage: node --experimental-strip-types plugin/scripts/goal-driver.ts [options]",
  "  --root <dir>        仓库根（缺省 cwd；goals/ 与 .quay/ 都在其下）",
  "  --interval <ms>     循环滴答间隔（缺省 " + INTERVAL_MS_DEFAULT + "，来自 drivers.yml goal.interval_ms）",
  "  --once              跑一轮即退出（手动单发 / 测试）",
  "  --max-rounds <n>    跑满 N 轮退出（测试缝）",
  "  --round-log <path>  轮记录文件（缺省 <root>/.quay/goal-round.jsonl）",
  "  --run-id <id>       轮记录里的 run_id",
  "  --pid-file <path>   把驱动自身 pid 写到该文件（外部观测 + kill 抓手）",
  "  --json              每轮向 stdout 打一条 JSON 事件行",
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
    routines: goalDriverRoutines(rootDir),
  });
}

// ⛔ argv1 必须留 undefined（让它读 process.argv[1]）：传本模块自身路径会使 basename 恒等于
// expectedBase ⇒ 恒为真 ⇒ 被 import 时就跑一整轮。
if (isDirectEntry(import.meta, undefined, "goal-driver")) {
  main(process.argv).then((c) => { process.exitCode = c; });
}
