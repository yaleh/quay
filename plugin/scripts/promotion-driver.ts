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
//   驱动  ⛔ 不做任何 commit（标 needs-human 是写 status 到 tasks/<id>.md，同 --apply 晋升的写类，非 commit）
//         ⛔ 不读/不写 .halt（停机态 = 进程信号，单一真相源；AC135 才涉及 outer 退役）
//
// Run:
//   node --experimental-strip-types plugin/scripts/promotion-driver.ts \
//     --root <repo> [--interval <ms>] [--cap <n>] [--once] [--max-rounds <n>]
//     [--max-fix-retries <n>] [--ready-pool-cmd "<argv>"] [--fix-worker-cmd "<argv>"]
//     [--llm-commands <csv>] [--round-log <path>] [--outcome-log <path>] [--run-id <id>] [--pid-file <path>] [--json]
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
import { splitArgs, launchArgv } from "./worker-driver.ts";

/** round 记录的仓库相对路径（gitignored 运行时日志，worker-outcome.jsonl 同族）。 */
export const ROUND_LOG_REL = ".quay/promotion-round.jsonl";

/** outcome 记录的仓库相对路径（gitignored 运行时日志，worker-outcome.jsonl 同族，AC134：判定/晋升/修复
 *  各一条，outer 可消费）。 */
export const OUTCOME_LOG_REL = ".quay/promotion-outcome.jsonl";

/** 轮间隔缺省（毫秒）。AC130 判据不设数值阈值（硬规则 4）——此值只是「机械心跳」的占位节奏，
 *  生产部署时由 outer 的启动命令传 --interval 覆盖；测试传小值。 */
export const INTERVAL_MS_DEFAULT = 30_000;

// 并发 cap 缺省。concurrency-default-fallback：生产调用方从 cap-from-gate.sh 传自适应 --cap；
// 此值只是「未传 --cap」的手动/测试回退。AC48 后 cap 不闸晋升，传 5 避免 cap-3 回退的 floor 假象。
export const CAP_DEFAULT = 5;

/** AC133 失败上限缺省：同一任务连续修 N 次仍不合格 ⇒ 标 needs-human。与 fan-in 侧 attempt>=3 同值
 *  （gap-fan-in-relaunch-retry-cap），非新设数值阈值——仅作「未传 --max-fix-retries」的手动/测试回退。 */
export const MAX_FIX_RETRIES_DEFAULT = 3;

/** ready-pool-check 单轮的 wall-clock 上限（spawnSync timeout，毫秒）。 */
export const ROUND_TIMEOUT_MS = 180_000;

/** fix worker spawn 的 wall-clock 上限（spawnSync timeout，毫秒）——AC142 诊断面：与 ready-pool-check 的
 *  ROUND_TIMEOUT_MS 同值（runPromotionRound 已用该值，⛔ 不为 fix worker 另设阈值——硬规则 4 推论）。 */
export const FIX_WORKER_TIMEOUT_MS = 180_000;

/** 配置声明的 LLM 命令集缺省（AC140-4：判定读集合，⛔ 不靠 `base === "claude"` 字面量）。
 *  形态先落缺省 ["claude"]；后续 AC140-2 把集做成 .quay/config.yml 可配（wrapper 如 claude-fjdac）。 */
export const LLM_COMMAND_SET_DEFAULT: readonly string[] = ["claude"];

// ── 纯函数（可单测） ───────────────────────────────────────────────────────────────────────────────

/** 缺省 ready-pool-check 命令（全池 + --apply 落地晋升）。输出须为 analyzeTasks JSON。 */
export function defaultPromotionCheckArgv(root: string, cap: number): string[] {
  return [
    "node", "--experimental-strip-types",
    path.join(root, "plugin", "scripts", "ready-pool-check.ts"),
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
  applied: Array<{ id: string; ok: boolean; from: string | null; to: string | null; deliveryCritical: boolean }>;
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
  depsReady: boolean;
  retiredMechanism: boolean;
  superseded: boolean;
  compound: boolean;
  prosePrereqGap: string[];
}

/** A24 分类结果。fixable = 可修三类之一且【无】不可修五类 ⇒ 该 spawn fix worker；
 *  missing = 结构化可修缺项标识（prompt 输入）；unfixable = 不可修五类的结构化原因（逐条记、不修）。 */
export interface FixDecision {
  id: string;
  fixable: boolean;
  missing: string[];
  unfixable: string[];
  prompt: string | null;
}

/** A24 可修三类 → 结构化缺项标识；不可修五类 → 结构化原因。⛔ 不重新设计分类——
 *  沿用 orchestrator-tick-core.md:48 的 A24 现行分类（manager-phase-goal ### AC132 指明）。
 *  可修三类：fourArtifacts=false（补 missingArtifacts 缺失段）· selfTouchOk=false（补自身 tasks/<id>.md
 *  进 ## Touches）· touchesResolve=false（Touches 写错 ⇒ 改对）。不可修五类：depsReady=false ·
 *  retiredMechanism · superseded · compound · prosePrereqGap 非空。 */
export function classifyCandidate(c: CandidateChecks): FixDecision {
  const missing: string[] = [];
  if (!c.fourArtifacts) missing.push(`fourArtifacts=false missing=[${(c.missingArtifacts || []).join(",")}]`);
  if (!c.selfTouchOk) missing.push("selfTouchOk=false");
  if (!c.touchesResolve) missing.push("touchesResolve=false");
  const unfixable: string[] = [];
  if (!c.depsReady) unfixable.push("depsReady=false");
  if (c.retiredMechanism) unfixable.push("retiredMechanism=true");
  if (c.superseded) unfixable.push("superseded=true");
  if (c.compound) unfixable.push("compound=true");
  if (c.prosePrereqGap && c.prosePrereqGap.length > 0) unfixable.push(`prosePrereqGap=[${c.prosePrereqGap.join(",")}]`);
  // 只有可修三类、且无任何不可修五类 ⇒ 值得 spawn（否则修了也晋不了，不可修原因才是真阻碍）。
  const fixable = missing.length > 0 && unfixable.length === 0;
  const prompt = fixable ? buildFixWorkerPrompt(c.id, missing) : null;
  return { id: c.id, fixable, missing, unfixable, prompt };
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

/** fix worker argv = `quay-launch.sh fix-worker -p <prompt>`（短命，launcher/model/--bare 由
 *  `_launchSpec.roles["fix-worker"]` 承载——AC140-2 可配，单一构造 launchArgv）。--fix-worker-cmd 覆盖
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
 *  不再零诊断信息——对照 gap-fix-worker-spawn-zero-diagnostic-info 的 10 条 `spawned exit=1` 无 stderr）。 */
export interface FixWorkerSpawnResult {
  exitCode: number | null;
  error: string | null;
  stdout: string | null;
  stderr: string | null;
  timedOut: boolean;
}

/** spawn 一个短命 fix worker（claude -p，或 --fix-worker-cmd 覆盖前缀），同步等待其退出。
 *  捕获 stdout/stderr + timeout（AC142 AC1：对照 runPromotionRound 的 stdio:["ignore","pipe","ignore"]
 *  + ROUND_TIMEOUT_MS）。返回退出码 / spawn 错误 / 捕获面。AC132：spawn 即达成；⛔ 不验证修没修好
 *  （AC133），⛔ 不信 worker 自述。 */
export function spawnFixWorker(argv: string[], root: string, timeoutMs: number = FIX_WORKER_TIMEOUT_MS): FixWorkerSpawnResult {
  if (!Array.isArray(argv) || argv.length === 0) {
    return { exitCode: null, error: "empty fix-worker argv", stdout: null, stderr: null, timedOut: false };
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
          depsReady: !!c.depsReady,
          retiredMechanism: !!c.retiredMechanism,
          superseded: !!c.superseded,
          compound: !!c.compound,
          prosePrereqGap: Array.isArray(c.prosePrereqGap) ? c.prosePrereqGap.map(String) : [],
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
 *  promoted_ids · applied · error · promote_path_llm_invoked · fixes）。action ∈ promote|fix|none|error。
 *  promote_path_llm_invoked 在晋升路径上为 false（机械 ready-pool-check，AC131）；AC132 的 fix worker 是
 *  `claude -p`（argv[0]=claude），其 spawn 在 fixes[].spawned=true 上可见。 */
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
  needsHuman?: string[];
}) {
  const action = opts.error
    ? "error"
    : opts.promotedIds.length > 0
      ? "promote"
      : opts.fixes.some((f) => f.spawned)
        ? "fix"
        : "none";
  return {
    ts: opts.at, round: opts.round, run_id: opts.runId, pid: opts.pid, action,
    pool: opts.pool, should_apply: opts.shouldApply, promoted_ids: opts.promotedIds,
    applied: opts.applied, error: opts.error, promote_path_llm_invoked: opts.promotePathLlmInvoked, fixes: opts.fixes,
    // AC133：重验证结果（null = 本轮无 fix worker 可重验证）与本轮新标 needs-human 的 id 清单。
    reverify: opts.reverify ?? null,
    needs_human: opts.needsHuman ?? [],
  };
}

/** AC132 的 fix pass：对 fixable 决策 spawn 短命 fix worker；对不可修五类逐条记原因不 spawn。
 *  返回每条的 FixOutcome（可修 ⇒ spawned=true + 结构化 missing；不可修 ⇒ spawned=false + unfixable 原因）。 */
export function runFixPass(fixDecisions: FixDecision[], root: string, fixWorkerCmd: string | null): FixOutcome[] {
  return fixDecisions.map((d) => {
    if (!d.fixable) {
      return { id: d.id, spawned: false, missing: d.missing, unfixable: d.unfixable, exitCode: null, stderr: null, timedOut: false };
    }
    const argv = buildFixWorkerArgv(d.id, d.missing, root, fixWorkerCmd);
    const { exitCode, stderr, timedOut } = spawnFixWorker(argv, root);
    return { id: d.id, spawned: true, missing: d.missing, unfixable: [], exitCode, stderr, timedOut };
  });
}

// ── AC133：重闸验证 + 失败上限（fix worker 退出后重跑同一个闸，⛔ 不信 worker 自述） ─────────────

/** AC133 重验证结果。fixedIds = 本轮被 spawn 过 fix worker 的任务 id；重跑闸后按【闸的新判定】归类：
 *  nowEligibleIds = 闸判合格（fix 生效，已由 --apply 落地晋升）；stillIneligibleIds = 闸仍判不合格
 *  （fix 未生效，⛔ 不得晋升）。⛔ 不信 worker 自述「已修好」——worker 的退出码/自述不作为晋升依据。 */
export interface ReverifyOutcome {
  nowEligibleIds: string[];
  stillIneligibleIds: string[];
}

/** 用重验证轮的闸判定给每个被修任务归类。闸判合格（出现在 promotions）⇒ nowEligible；闸判不合格
 *  （出现在 candidates 且 eligible=false）⇒ stillIneligible；两者都不在（任务从 todo 池消失）⇒ 不计数。
 *  纯函数，可单测（AC133 AC1/AC2——AC2 取假：worker 声称修好但实际未改 ⇒ 闸仍判不合格 ⇒ stillIneligible）。 */
export function computeReverifyOutcome(fixedIds: string[], reRound: PromotionRound): ReverifyOutcome {
  const promoted = new Set(reRound.promotedIds);
  const stillBad = new Set(reRound.fixDecisions.map((d) => d.id));
  const nowEligibleIds: string[] = [];
  const stillIneligibleIds: string[] = [];
  for (const id of fixedIds) {
    if (promoted.has(id)) nowEligibleIds.push(id);
    else if (stillBad.has(id)) stillIneligibleIds.push(id);
  }
  return { nowEligibleIds, stillIneligibleIds };
}

/** AC133 失败上限的跨轮状态。counts = 每任务连续修仍不合格的累计次数；needsHuman = 已标 needs-human
 *  （后续轮不再对其 spawn fix worker）。跨轮存活于常驻循环内（⛔ 不落盘——运行时状态，与进程同寿命）。 */
export interface RetryState {
  counts: Map<string, number>;
  needsHuman: Set<string>;
}

/** 推进失败上限：对每个仍不合格的 id 累计连续失败次数，达到 maxRetries 的进入 newlyNeedsHuman
 *  （去重——已标过的不重复返回）。原地更新传入 state，纯逻辑可单测（AC133 AC3）。 */
export function advanceRetryCap(
  state: RetryState,
  stillIneligibleIds: string[],
  maxRetries: number,
): string[] {
  const newly: string[] = [];
  for (const id of stillIneligibleIds) {
    const n = (state.counts.get(id) ?? 0) + 1;
    state.counts.set(id, n);
    if (n >= maxRetries && !state.needsHuman.has(id)) {
      state.needsHuman.add(id);
      newly.push(id);
    }
  }
  return newly;
}

/** AC133 AC3：把连续修满上限仍不合格的任务标 needs-human（status todo → needs-human）+ 追加一条
 *  `## Needs-Human` 审计记录（grep-able 原因，⛔ 静默翻转）。只在 status=todo 时写（并发保护，同
 *  ready-pool-check 的 setTaskStatus）。返回 { id, ok, reason }——ok=false 表示未写（missing/无
 *  frontmatter/非 todo）。 */
export function markNeedsHuman(root: string, id: string, reason: string): { id: string; ok: boolean; reason: string } {
  const file = path.join(root, "tasks", `${id}.md`);
  if (!fs.existsSync(file)) return { id, ok: false, reason: "missing" };
  const raw = fs.readFileSync(file, "utf8");
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(raw);
  if (!m) return { id, ok: false, reason: "no-frontmatter" };
  const [, open, fm, close] = m;
  if (!/^status:\s*todo\s*$/m.test(fm)) return { id, ok: false, reason: "not-todo" };
  const newFm = fm.replace(/^status:\s*todo\s*$/m, "status: needs-human");
  const body = raw.slice(m[0].length);
  const record =
    `\n## Needs-Human\n\n**执行 ${new Date().toISOString()} — promotion-driver AC133：连续修满上限仍不合格**\n\n` +
    `- 阻碍原因：${reason}\n`;
  fs.writeFileSync(file, `${open}${newFm}${close}${body}${record}`);
  return { id, ok: true, reason };
}

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
  result: { ok: boolean; detail: string | null };
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
  needsHuman?: Array<{ id: string }>;
  reverify?: ReverifyOutcome | null;
}): PromotionOutcomeRecord[] {
  const out: PromotionOutcomeRecord[] = [];
  for (const a of opts.applied) {
    out.push({
      task_id: a.id,
      gate: { eligible: true, missing: [] },
      action: "promote",
      result: { ok: a.ok, detail: a.from != null && a.to != null ? `${a.from}->${a.to}` : "promoted" },
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
      result: { ok: true, detail: "retry-cap-exhausted" },
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

/** 解析 --interval。缺省 INTERVAL_MS_DEFAULT；非负有限数才合法。 */
export function parseIntervalMs(raw: string | undefined): { ok: true; value: number } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: INTERVAL_MS_DEFAULT };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: `invalid --interval: ${raw}` };
  return { ok: true, value: n };
}

/** 解析 --cap。缺省 CAP_DEFAULT；正整数才合法。 */
export function resolveCap(raw: string | undefined): { ok: true; value: number } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: CAP_DEFAULT };
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
  /** 配置声明的 LLM 命令集（--llm-commands，缺省 LLM_COMMAND_SET_DEFAULT；AC140-4）。 */
  llmCommands: string[];
  roundLogFile: string;
  outcomeLogFile: string;
  runId: string;
  json: boolean;
  pidFile?: string;
}

/**
 * 常驻循环（AC1）：跑一轮不退出，按 --interval 进入下一轮，直到 SIGINT/SIGTERM 或 --once/--max-rounds。
 *  每轮 = runPromotionRound（调 ready-pool-check --apply 全池判定 + 落地晋升）→ runFixPass（可修三类
 *  spawn fix worker）→ AC133 重闸验证（fix worker 退出后重跑同一个闸，⛔ 不信 worker 自述）→
 *  失败上限（连续修满 N 次仍不合格 ⇒ 标 needs-human 停手）→ computeRoundRecord → appendRoundRecord →
 *  （json 时）stdout 事件行。停机由进程信号驱动（⛔ 不读 .halt，单一真相源）。
 */
export async function runResidentPromotionLoop(opts: ResidentLoopOptions): Promise<number> {
  const { root, intervalMs, cap, once, maxRounds, maxFixRetries, readyPoolArgv, roundLogFile, outcomeLogFile, runId, json, pidFile, fixWorkerCmd, llmCommands } = opts;

  if (pidFile) {
    try { fs.writeFileSync(pidFile, `${process.pid}\n`, "utf8"); } catch { /* pid-file 只供外部观测，写失败不致命 */ }
  }

  let stopRequested = false;
  let wakeResolve: (() => void) | null = null;
  const requestStop = () => { stopRequested = true; if (wakeResolve) { const w = wakeResolve; wakeResolve = null; w(); } };
  process.on("SIGINT", requestStop);
  process.on("SIGTERM", requestStop);

  // 可被信号唤醒的 sleep：SIGINT/SIGTERM 立即 resolve，本轮结束即退出（⛔ 不杀在飞——单轮是同步的，
  // 不存在「在飞轮」）。
  const sleep = (ms: number) => new Promise<void>((resolve) => {
    wakeResolve = resolve;
    setTimeout(() => { if (wakeResolve === resolve) wakeResolve = null; resolve(); }, ms);
  });

  let round = 0;
  const retryState: RetryState = { counts: new Map(), needsHuman: new Set() };
  while (!stopRequested) {
    round += 1;
    const r = runPromotionRound(root, readyPoolArgv, cap, llmCommands);
    // AC133 失败上限：已标 needs-human 的任务不再进 fix pass（停止对它的修复循环——与 markNeedsHuman
    // 的 status 翻转双保险，即使 status 写失败也不会再 spawn）。
    const activeDecisions = r.fixDecisions.filter((d) => !retryState.needsHuman.has(d.id));
    // AC132：不合格者 → 短命 fix worker（可修三类 spawn、不可修五类逐条记原因不修）。spawn 前先跑
    // 分类（classifyCandidate 已做），fixDecisions 里 fixable=true 的才 spawn。
    const fixes = runFixPass(activeDecisions, root, fixWorkerCmd);

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
    for (const id of newlyNeedsHuman) {
      markNeedsHuman(root, id, `连续修满 ${maxFixRetries} 次仍不合格（闸在重验证后仍判不合格）`);
    }

    const promotedIds = [...r.promotedIds, ...rePromotedIds];
    const applied = [...r.applied, ...reApplied];
    const record = computeRoundRecord({
      round, runId, pid: process.pid, at: new Date().toISOString(), ...r,
      promotedIds, applied, fixes, reverify, needsHuman: newlyNeedsHuman,
    });
    try { appendRoundRecord(roundLogFile, record); } catch { /* 记录写失败不致命（运行时日志，⛔ 不因日志炸循环） */ }
    // AC134：判定/晋升/修复/needs-human 各写一条 outcome 记录（.quay/promotion-outcome.jsonl，outer 可消费）。
    // gap-fix-worker-edit-exit-4：把 AC133 重闸结果 reverify 传给 outcome，fix 的 result.ok 以「闸判落地」为准。
    const outcomes = computeOutcomeRecords({
      at: record.ts, applied, fixes,
      needsHuman: newlyNeedsHuman.map((id) => ({ id })),
      reverify,
    });
    for (const o of outcomes) {
      try { appendOutcomeRecord(outcomeLogFile, o); } catch { /* 记录写失败不致命（运行时日志，⛔ 不因日志炸循环） */ }
    }
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
  "promotion-driver — AC130：常驻循环，每轮调 ready-pool-check 取全池判定（--apply 落地合格晋升），",
  "跑完一轮不退出、按 --interval 进入下一轮。SIGINT/SIGTERM 优雅停机。AC132：不合格者 spawn 短命 fix worker。",
  "AC133：fix worker 退出后重跑同一个闸验证（⛔ 不信 worker 自述）+ 连续修满 N 次仍不合格 ⇒ needs-human。",
  "AC134：判定/晋升/修复/needs-human 各写一条 outcome 记录（.quay/promotion-outcome.jsonl）。",
  "  --root <repo> [--interval <ms>] [--cap <n>] [--once] [--max-rounds <n>] [--max-fix-retries <n>]",
  "  [--ready-pool-cmd \"<argv>\"] [--fix-worker-cmd \"<argv>\"] [--llm-commands <csv>] [--round-log <p>] [--outcome-log <p>] [--run-id <id>] [--pid-file <p>] [--json]",
  "  --interval <ms>       轮间隔（缺省 30000；测试缝传小值）",
  "  --cap <n>             传给 ready-pool-check 的并发 cap（缺省 5）",
  "  --once                跑一轮即退出（手动单发 / 测试）",
  "  --max-rounds <n>      跑满 N 轮退出（测试缝，防常驻环无限跑）",
  "  --max-fix-retries <n> AC133 失败上限（缺省 3；连续修满 N 次仍不合格 ⇒ 标 needs-human）",
  "  --ready-pool-cmd <s>  覆盖 ready-pool-check 命令（测试缝）",
  "  --fix-worker-cmd <s>  覆盖 fix worker 命令前缀（测试缝；prompt 仍作末参数追加）",
  "  --llm-commands <csv>  配置声明的 LLM 命令集，逗号分隔（缺省 claude；AC140-4 判定读此集合）",
  "  --round-log <path>    轮记录文件（缺省 <root>/.quay/promotion-round.jsonl）",
  "  --outcome-log <path>  outcome 记录文件（缺省 <root>/.quay/promotion-outcome.jsonl，AC134）",
  "  --pid-file <path>     把驱动自身 pid 写到该文件（外部观测 + kill 抓手）",
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
  let roundLogPath: string | undefined;
  let outcomeLogPath: string | undefined;
  let runId: string | undefined;
  let json = false;
  let pidFile: string | undefined;
  let llmCommandsRaw: string | undefined;

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
    else if (a === "--round-log") roundLogPath = args[++i];
    else if (a === "--outcome-log") outcomeLogPath = args[++i];
    else if (a === "--run-id") runId = args[++i];
    else if (a === "--pid-file") pidFile = args[++i];
    else if (a === "--llm-commands") llmCommandsRaw = args[++i];
    else if (a === "--json") json = true;
    else if (a === "--help" || a === "-h") { console.log(HELP); return 0; }
    else { console.error(`promotion-driver: unknown argument: ${a}`); return 2; }
  }

  const rootDir = root ? path.resolve(root) : path.resolve(process.cwd());

  const interval = parseIntervalMs(intervalRaw);
  if (!interval.ok) { console.error(`promotion-driver: ${interval.error}`); return 2; }
  const capRes = resolveCap(capRaw);
  if (!capRes.ok) { console.error(`promotion-driver: ${capRes.error}`); return 2; }
  if (maxRounds !== null && (!Number.isInteger(maxRounds) || maxRounds < 1)) {
    console.error("promotion-driver: --max-rounds must be a positive integer");
    return 2;
  }
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
    llmCommands,
    roundLogFile,
    outcomeLogFile,
    runId: resolvedRunId,
    json,
    pidFile,
  });
}

// Direct entry guard (gate-script-base convention)：仅当本文件是入口时跑 main()。
if (isDirectEntry(import.meta, undefined, "promotion-driver")) {
  main(process.argv).then((code) => { process.exitCode = code; });
}
