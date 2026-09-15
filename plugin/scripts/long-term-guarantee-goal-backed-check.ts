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
// ⚠️ 写入面的同一条规则（gap-ac190-goal-ac-rule-not-enforced-at-filing, 2026-09-13）：本文件是
// 【事后】报告——它看得见违反，却没有任何权力阻止违反发生。同一条规则在【写入那一刻】的判定原本
// 落在 precommit-guard.ts 的 ③（提交那一刻）；判定函数由本文件导出、单源复用，⛔ 不留第二份实现。
//
// ⛔ 落点第二次修正（gap-ac190-write-face-rule-unreachable-under-no-verify, 2026-09-14）：③ 只在
// git `pre-commit` 钩子上跑，而生产立案路径根本不过钩子（store-commit.ts 明写 `git commit
// --no-verify`，实测 370/400 条 tasks 提交是该形态）⇒ 判定在写者路径上【结构性不可达】。
// 判定的正本因此搬到 `packages/quay/src/goal-ac-write-face.ts`（Core），由 store.ts 的创建路径、
// 本检测器、以及钩子三处共用；本文件只再导出该模块的名字，**脚本入口路径与 AC-190 的读数都不变**
// （照 criterion-failure-attribution-check.ts :42 的先例）。
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

// ── 判定的正本在 Core（packages/quay/src/goal-ac-write-face.ts）——本文件只再导出 ──────────────────
// 三个消费面（store 的创建路径 / 本检测器 / precommit-guard 的 ③）必须是【同一个判定】；单源在
// 记录上必须可分辨（硬规则 1），所以这里给的是 `export … from` 行本身，⛔ 不是第二份字符串比较。
export {
  ACTIVATION_LINE_ISO,
  DELIVERY_CRITICAL_LABEL,
  INJECTED_UNBACKED_ID,
  GOAL_CARRIER_DIR_NAME,
  activationLineMs,
  isDeliveryCritical,
  hasGoalAc,
  filedAfterCutoff,
  evaluateDeliveryCritical,
  judgeStagedDeliveryCritical,
  goalCarrierHasRecords,
  writeFaceRejectionOnCreate,
  type DeliveryCriticalTaskLike,
  type StagedTaskCandidate,
} from "../../packages/quay/src/goal-ac-write-face.ts";

import {
  ACTIVATION_LINE_ISO,
  DELIVERY_CRITICAL_LABEL,
  INJECTED_UNBACKED_ID,
  activationLineMs,
  evaluateDeliveryCritical,
  type DeliveryCriticalTaskLike,
} from "../../packages/quay/src/goal-ac-write-face.ts";

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
