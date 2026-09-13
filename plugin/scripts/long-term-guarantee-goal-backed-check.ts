#!/usr/bin/env node
// long-term-guarantee-goal-backed-check.ts — 位置判定：带 delivery-critical 标签的新立案任务必须声明 goal_ac
// (tasks/gap-long-term-guarantee-registry-hand-maintained, goals/AC-190-task-ac.md).
//
// 问题（gap-long-term-guarantee-registry-hand-maintained, 2026-09-09 实测）：旧形态枚举一张手维护的
// 登记表（三项），PASS 3/3 是按构造的绿——同一时刻带 delivery-critical 标签的任务 125 条、
// 其中 120 条无 goal_ac（96%），手写表只覆盖 2.4%。这与 CORE_REFERENCED（手维护两项漏掉 driver-runtime.ts，
// 2026-09-08 已改机械推导）是同一形态、同一周内第二次。
//
// 本检测器把「长期保证的登记」从事后清单改为位置判定（硬规则 2）：枚举 tasks/*.md 里带
// `delivery-critical` 标签的任务（位置 = frontmatter 标签字段，⛔ 不是手维护名单），对【生效线之后
// 新立案】的任务 fail-closed——goal_ac 非空（task→AC 上移 goal 层背书的声明）否则报红。生效线
// （ACTIVATION_LINE_ISO，显式 cutoff）之前的存量任务（125/120）不判红（单独排期），但打印
// grandfathered 条数以透明（硬规则 3：枚举，不布尔）。
//
// 可证伪性（硬规则③b/④）：位置判定读真实生产载体（tasks/*.md 盘上 frontmatter + git first-add 时刻），
// ⛔ 不用 fixture 注入当正判断据——注入缝 --inject-unbacked-fixture 只用于负控制（注入一条「生效线之后、
// 带标签、无 goal_ac」的任务后必须 exit 非零）。tasks 读不到/读不懂 ⇒ NOT-EVALUATED（exit 3），不得与
// 「全部合规」同形（硬规则 3b：读不懂不得与合格同形）。
//
// 执行器：本脚本由 goal-driver 每轮对 AC-190（kind=criterion, goal=GOAL-007, status=active）跑
// gateCriterion 调起（criterion 正文 = goals/AC-190-task-ac.md），无需接入 scripts/test.sh。
//
// Run:
//   node --no-warnings --experimental-strip-types plugin/scripts/long-term-guarantee-goal-backed-check.ts
//   node --no-warnings --experimental-strip-types plugin/scripts/long-term-guarantee-goal-backed-check.ts --inject-unbacked-fixture
//   node --no-warnings --experimental-strip-types plugin/scripts/long-term-guarantee-goal-backed-check.ts --json

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { repoRoot } from "./repo-root.ts";
import { emitPass, emitFail, emitNotEvaluated, isDirectEntry } from "./gate-script-base.ts";
import { parseFrontmatterCompletely, frontmatterLabels, frontmatterGoalAc } from "./task-schema.ts";

// ── 生效线（显式 cutoff） ───────────────────────────────────────────────────────────────────────────
// 只对【生效线之后新立案】的任务 fail-closed。实测（2026-09-09）：带 delivery-critical 标签的任务
// 125 条、其中 120 条无 goal_ac；最新一条 first-add 时刻 2026-09-08T22:30:33Z。生效线取
// 2026-09-09T00:00:00Z ⇒ 存量全部 grandfathered（单独排期，⛔ 不在本任务清）。
export const ACTIVATION_LINE_ISO = "2026-09-09T00:00:00Z";

export const DELIVERY_CRITICAL_LABEL = "delivery-critical";

// 负控制注入的合成条目：一条「生效线之后、带 delivery-critical、无 goal_ac」的任务。
export const INJECTED_UNBACKED_ID = "gap-injected-unbacked-fixture";

/** 生效线时刻（ms epoch）。ISO 不可解析 ⇒ 0（一切任务都算之后 ⇒ fail-closed，宁可红不宁绿）。 */
export function activationLineMs(): number {
  const ms = Date.parse(ACTIVATION_LINE_ISO);
  return Number.isFinite(ms) ? ms : 0;
}

// ── 位置判定（纯函数，可被单测直接 import 不触发主流程） ──────────────────────────────────────────

export interface DeliveryCriticalTaskLike {
  id?: unknown;
  labels?: unknown;
  goal_ac?: unknown;
  /** first-add commit 时刻（ms epoch）；缺值/NaN = git 读不到 ⇒ 按新立案 fail-closed（缺值=未查≠旧）。 */
  filedAtMs?: unknown;
}

/** 带 delivery-critical 标签判定：读 labels 数组（frontmatter 位置），非手维护名单。 */
export function isDeliveryCritical(task: DeliveryCriticalTaskLike): boolean {
  return Array.isArray(task.labels) && task.labels.map(String).includes(DELIVERY_CRITICAL_LABEL);
}

/** goal_ac 非空判定：string 且 trim 后非空。缺值/空串/非 string ⇒ false（fail-closed）。 */
export function hasGoalAc(task: DeliveryCriticalTaskLike): boolean {
  const s = task?.goal_ac;
  return typeof s === "string" && s.trim() !== "";
}

/** 是否「生效线之后新立案」：filedAtMs ≥ cutoffMs。filedAtMs 缺值 ⇒ true（缺值=未查，fail-closed）。 */
export function filedAfterCutoff(task: DeliveryCriticalTaskLike, cutoffMs: number = activationLineMs()): boolean {
  const t = task?.filedAtMs;
  if (typeof t === "number" && Number.isFinite(t)) return t >= cutoffMs;
  return true;
}

/**
 * 枚举每条带 delivery-critical 标签的任务，判定其 goal_ac 是否非空。返回清单 + 总数（枚举，
 * 不布尔——硬规则③）：
 *   violating    — 生效线之后、带标签、goal_ac 空 ⇒ 报红
 *   compliant    — 生效线之后、带标签、goal_ac 非空
 *   grandfathered — 生效线之前、带标签（不分 goal_ac 有无，均不判红）
 *   grandfatheredNoGoalAc / grandfatheredWithGoalAc — 生效线之前的存量再按 goal_ac 有无拆开
 *     （DoD 要记的「存量条数 125/120」= 总数 / 无 goal_ac 那半边，单独排期）。
 */
export function evaluateDeliveryCritical(
  tasks: readonly DeliveryCriticalTaskLike[],
  cutoffMs: number = activationLineMs(),
): {
  violating: string[];
  compliant: string[];
  grandfathered: string[];
  grandfatheredNoGoalAc: string[];
  grandfatheredWithGoalAc: string[];
  total: number;
} {
  const violating: string[] = [];
  const compliant: string[] = [];
  const grandfathered: string[] = [];
  const grandfatheredNoGoalAc: string[] = [];
  const grandfatheredWithGoalAc: string[] = [];
  let total = 0;
  for (const t of tasks) {
    if (!isDeliveryCritical(t)) continue;
    total += 1;
    if (!filedAfterCutoff(t, cutoffMs)) {
      grandfathered.push(String(t.id));
      if (hasGoalAc(t)) grandfatheredWithGoalAc.push(String(t.id));
      else grandfatheredNoGoalAc.push(String(t.id));
    } else if (hasGoalAc(t)) {
      compliant.push(String(t.id));
    } else {
      violating.push(String(t.id));
    }
  }
  return { violating, compliant, grandfathered, grandfatheredNoGoalAc, grandfatheredWithGoalAc, total };
}

// ── 生产载体读取 ─────────────────────────────────────────────────────────────────────────────────────

/** 生效线之后 first-add 的任务 id 集合（一次 `git log --since`，commit 日期早于 cutoff 的提交即被
 *  剪枝 ⇒ 无需全历史 walk）。读不到 ⇒ 空 Set（每个 task 的 filedAtMs 缺值 ⇒ 按新立案 fail-closed）。 */
function postCutoffTaskIds(root: string, ref: string, cutoffIso: string): Set<string> {
  const ids = new Set<string>();
  try {
    // --since 用 commit 日期剪枝：只列 cutoff 之后 ADD 的 tasks/*.md。输出格式：
    // `<ISO>\n\n<file>\n<file>\n…`（每个 commit 一块）。
    const out = execFileSync(
      "git",
      ["-C", root, "log", "--since", cutoffIso, "--diff-filter=A", "--format=%cI", "--name-only", ref],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 },
    );
    for (const raw of out.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      if (/^\d{4}-\d{2}-\d{2}T/.test(line)) continue; // commit-time 行
      if (line.startsWith("tasks/") && line.endsWith(".md")) {
        ids.add(path.basename(line, ".md"));
      }
    }
  } catch {
    /* git 读不到 ⇒ 空 Set（filedAtMs 缺值 ⇒ 按新立案 fail-closed）。 */
  }
  return ids;
}

/** 读取 tasks/*.md 的 frontmatter（labels + goal_ac）+ 是否生效线后 first-add，返回任务列表。
 *  filedAtMs 只保留「前/后」两档（cutoffMs / cutoffMs-1），不做精确 first-add 时间（见 filedAfterCutoff）。 */
function readTasks(root: string, cutoffMs: number): DeliveryCriticalTaskLike[] {
  const tasksDir = path.join(root, "tasks");
  const fileNames = fs.existsSync(tasksDir)
    ? fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"))
    : [];
  const postCutoff = postCutoffTaskIds(root, "HEAD", ACTIVATION_LINE_ISO);
  const out: DeliveryCriticalTaskLike[] = [];
  for (const f of fileNames) {
    const id = f.replace(/\.md$/, "");
    let fm: Record<string, unknown> = {};
    try {
      const raw = fs.readFileSync(path.join(tasksDir, f), "utf8");
      const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      fm = m ? (parseFrontmatterCompletely(m[1]) as Record<string, unknown>) : {};
    } catch {
      /* 单文件读不到 ⇒ 缺值（goal_ac/labels 为空），不进 violating（无 delivery-critical 标签）。 */
    }
    out.push({
      id,
      labels: frontmatterLabels(fm),
      goal_ac: frontmatterGoalAc(fm),
      filedAtMs: postCutoff.has(id) ? cutoffMs : cutoffMs - 1,
    });
  }
  return out;
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

  let root: string;
  try {
    root = repoRoot();
  } catch {
    return emitNotEvaluated("repo root unresolvable — 无法定位 tasks（读不懂，不得与合格同形）", undefined, { json });
  }

  const cutoffMs = activationLineMs();

  let tasks: DeliveryCriticalTaskLike[];
  try {
    tasks = readTasks(root, cutoffMs);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return emitNotEvaluated(`tasks 读不到/读不懂: ${msg}`, undefined, { json });
  }
  // tasks 目录缺失/空 ⇒ 读不到生产载体，不得与「全部合规」同形（硬规则 3b）。
  if (tasks.length === 0) {
    return emitNotEvaluated("tasks 目录缺失或为空 — 无生产载体可读（读不懂，不得与合格同形）", undefined, { json });
  }
  if (inject) {
    // 负控制：注入一条「生效线之后、带 delivery-critical、无 goal_ac」的任务后必须 exit 非零。
    tasks.push({ id: INJECTED_UNBACKED_ID, labels: [DELIVERY_CRITICAL_LABEL], goal_ac: null, filedAtMs: Date.now() });
  }

  const { violating, compliant, grandfathered, grandfatheredNoGoalAc, grandfatheredWithGoalAc, total } = evaluateDeliveryCritical(tasks, cutoffMs);
  if (violating.length > 0) {
    return emitFail(
      `生效线之后新立案的 delivery-critical 任务未声明 goal_ac（fail-closed）: ${violating.join(", ")}`,
      {
        total,
        violating,
        compliant: compliant.length,
        grandfathered: grandfathered.length,
        grandfathered_no_goal_ac: grandfatheredNoGoalAc.length,
        grandfathered_with_goal_ac: grandfatheredWithGoalAc.length,
        cutoff: ACTIVATION_LINE_ISO,
      },
      { json },
    );
  }
  return emitPass(
    `生效线之后的 delivery-critical 任务均声明 goal_ac（${compliant.length} 合规 / ${grandfathered.length} 存量免判，其中 ${grandfatheredNoGoalAc.length} 无 goal_ac 待单独排期）`,
    {
      total,
      violating: [],
      compliant: compliant.length,
      grandfathered: grandfathered.length,
      grandfathered_no_goal_ac: grandfatheredNoGoalAc.length,
      grandfathered_with_goal_ac: grandfatheredWithGoalAc.length,
      cutoff: ACTIVATION_LINE_ISO,
    },
    { json },
  );
}

if (isDirectEntry(import.meta, undefined, "long-term-guarantee-goal-backed-check")) {
  process.exit(main(process.argv));
}
