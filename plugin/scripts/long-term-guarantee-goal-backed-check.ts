#!/usr/bin/env node
// long-term-guarantee-goal-backed-check.ts — 反例检测器：声称长期保证却只有 task AC 背书 ⇒ 报红
// (tasks/gap-ac190-long-term-guarantee-goal-backed-check, goals/AC-190-task-ac.md,
//  goals/GOAL-007-done-fixture.md 三例原文).
//
// 问题（GOAL-007 origin 层级不对称段，逐字）：task 层判据是一次性的——extra.acceptance 只在
// fan-in 当轮跑一次、此后不再重跑；goal 层每轮（约 42s）对每条 active AC 跑 gateCriterion。
// 人已裁定方向【丁：不修，上移 goal 层】。但丁 若只有 AC-188 的一次性迁移（三例）与 AC-189 的
// 散文纪律，第四条、第五条长期保证仍会默认停在 task 层而没有任何红——AC-190 origin 点名这是
// 「丁 的真正难点」：「没有它，丁 与『什么都不做』在记录上同形」（硬规则⑨：守与不守在记录上
// 无法区分 ⇒ 造产物）。
//
// 本检测器把「声称长期保证却只有 task AC 背书」变成可机械提问的量：枚举【已登记的长期保证】
// （REGISTERED_GUARANTEES，登记形态 = 来源 task id；正本 = GOAL-007 三例），逐条核其在 goal 层
// 有无 criterion AC 背书。存在未背书条目 ⇒ 枚举打印其 id 并 exit 1；全部背书 ⇒ exit 0。
//
// 背书判定（与 AC-188 判据同一读法）：goal-store list 里存在 kind=criterion、status ∈
// {active, achieved}、criterion 非空（≥ MIN_CRITERION_CHARS 字符——空 criterion 是 fail-closed
// 的空壳，写了等于没上移）、origin 点名来源 task id 的记录。status ∈ {active, achieved} = I2 的
// 在域集（draft/superseded/retired 不在域）。
//
// 可证伪性（硬规则③b/④）：背书记录读真实生产载体（goal-store list 真实输出），⛔ 不用 fixture
// 注入当正判断据——注入缝 --inject-unbacked-fixture 只用于负控制（注入一条「只有 task AC 背书的
// 长期保证」后必须 exit 非零）。goal-store list 读不到/读不懂 ⇒ NOT-EVALUATED（exit 3），不得与
// 「全部背书」同形（硬规则 3b：读不懂不得与合格同形）。
//
// 执行器：本脚本由 goal-driver 每轮对 AC-190（kind=criterion, goal=GOAL-007, status=active）跑
// gateCriterion 调起（criterion 正文 = goals/AC-190-task-ac.md），无需接入 scripts/test.sh。
//
// Run:
//   node --no-warnings --experimental-strip-types plugin/scripts/long-term-guarantee-goal-backed-check.ts
//   node --no-warnings --experimental-strip-types plugin/scripts/long-term-guarantee-goal-backed-check.ts --inject-unbacked-fixture
//   node --no-warnings --experimental-strip-types plugin/scripts/long-term-guarantee-goal-backed-check.ts --json

import path from "node:path";
import { execFileSync } from "node:child_process";
import { repoRoot } from "./repo-root.ts";
import { emitPass, emitFail, emitNotEvaluated, isDirectEntry } from "./gate-script-base.ts";

// ── 已登记的长期保证（登记形态 = 来源 task id；正本 = GOAL-007 三例） ─────────────────────────────
// 一条「长期保证」= 一个 task 的 AC 里蕴含的、需长期维持的保证（task 层判据只在 fan-in 当轮跑一次，
// 此后不重跑）。把它登记进下表 = 声明「这条保证必须由 goal 层 AC 长期承载」；检测器在它被 goal AC
// 背书之前报红。新增长期保证 ⇒ 先把来源 task id 加进下表，并立对应 goal AC（否则检测器立即红——
// 这正是它存在的意义：第四条、第五条长期保证不再默认停在 task 层而无红）。
const REGISTERED_GUARANTEES: readonly string[] = [
  // ① ff 重试计数 per-cycle 不累计（载体 .quay/fan-in-retries.jsonl；runId 由 fm-* per-dispatch
  //    变 wk-prod-* per-driver-process 后，同一 runId 跨任务累计不得突破每周期预算）
  "gap-fan-in-ff-retry-counter-scope",
  // ② 不存在 cwd 指向已删 worktree 的孤儿 suite 进程（载体：进程 cwd × git worktree list）
  "gap-suite-load-sampler-orphan-process",
  // ③ 无绕过 fan-in 闸直落 develop 的提交（载体：git log develop 直接提交检测）
  "gap-direct-to-develop-bypasses-fan-in-gates",
];

// criterion 非空判定的下限（与 AC-188 判据同一读法 `>= 20`）：空/过短 criterion 是 fail-closed 空壳。
const MIN_CRITERION_CHARS = 20;

// 负控制注入的合成条目：一个结构上不可能被任何 goal AC 的 origin 点名的 id。
export const INJECTED_UNBACKED_ID = "gap-injected-unbacked-fixture";

// ── 背书判定（纯函数，可被单测直接 import 不触发主流程） ──────────────────────────────────────────

export interface GoalRecordLike {
  id?: unknown;
  kind?: unknown;
  status?: unknown;
  criterion?: unknown;
  origin?: unknown;
}

/** 一条 goal-store 记录是否构成「背书」：kind=criterion + status∈{active,achieved} +
 *  criterion 非空 ≥ MIN_CRITERION_CHARS + origin 非空。 */
export function isBackingRecord(rec: GoalRecordLike, minCriterionChars: number = MIN_CRITERION_CHARS): boolean {
  if (String(rec.kind) !== "criterion") return false;
  if (!["active", "achieved"].includes(String(rec.status))) return false;
  if (String(rec.criterion ?? "").trim().length < minCriterionChars) return false;
  if (!String(rec.origin ?? "").trim()) return false;
  return true;
}

/** 枚举每条长期保证，判定其是否被 goal 层 criterion AC 的 origin 点名。返回 { backed, unbacked }
 *  两份清单（枚举，不布尔——硬规则③）。 */
export function evaluate(
  records: readonly GoalRecordLike[],
  guarantees: readonly string[],
): { backed: string[]; unbacked: string[] } {
  const backedSet = new Set<string>();
  for (const rec of records) {
    if (!isBackingRecord(rec)) continue;
    const origin = String(rec.origin ?? "");
    for (const g of guarantees) {
      if (origin.includes(g)) backedSet.add(g);
    }
  }
  const backed = guarantees.filter((g) => backedSet.has(g));
  const unbacked = guarantees.filter((g) => !backedSet.has(g));
  return { backed, unbacked };
}

function listGoalStore(root: string): GoalRecordLike[] {
  const out = execFileSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types",
      path.join(root, "packages", "quay", "src", "goal-store.ts"),
      "list", "--root", root],
    { maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
  );
  return JSON.parse(out);
}

function main(argv: string[]): number {
  const raw = argv.slice(2);
  if (raw.includes("--help") || raw.includes("-h")) {
    process.stdout.write(
      "usage: long-term-guarantee-goal-backed-check.ts [--inject-unbacked-fixture] [--json]\n",
    );
    return 0;
  }
  const json = raw.includes("--json");
  const inject = raw.includes("--inject-unbacked-fixture");

  const guarantees: string[] = [...REGISTERED_GUARANTEES];
  if (inject) guarantees.push(INJECTED_UNBACKED_ID);

  let root: string;
  try {
    root = repoRoot();
  } catch {
    return emitNotEvaluated("repo root unresolvable — 无法定位 goal-store（读不懂，不得与合格同形）", undefined, { json });
  }

  let records: GoalRecordLike[];
  try {
    records = listGoalStore(root);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return emitNotEvaluated(`goal-store list 读不到/读不懂: ${msg}`, undefined, { json });
  }

  const { backed, unbacked } = evaluate(records, guarantees);
  if (unbacked.length > 0) {
    return emitFail(
      `长期保证未背书（只有 task AC、无 goal 层 criterion AC）: ${unbacked.join(", ")}`,
      { total: guarantees.length, backed: backed.length, unbacked },
      { json },
    );
  }
  return emitPass(
    `全部长期保证均有 goal 层 criterion AC 背书 (${backed.length}/${guarantees.length})`,
    { total: guarantees.length, backed: backed.length, unbacked: [] },
    { json },
  );
}

if (isDirectEntry(import.meta)) {
  process.exit(main(process.argv));
}
