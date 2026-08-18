// retired-clause-check.ts — AC58 退役即迁出 checker (gap-ac58-retired-clauses-delete-and-archive).
//
// Criterion (phase-goal verbatim, AC58):
//   判据1 (position): 三层执行核 + CLAUDE.md + 两份 loop 文档里，标注为退役/前提已死的条款正文 = 0 条
//                     （只允许留一行指针指向 archive）。
//   判据2 (硬规则⑤ 强制): 每次迁出必须产出【落点映射】——被删内容的每一个独有词条 → archive 中的位置；
//                     验的是「全部有家」不是「抽查几个有家」。
//   判据3 (能取假; 负控制由落地方产出): 一条「删了但没进 archive」的样本 ⇒ 检查必须红。
//
// Mechanism:
//   The registry below IS the 落点映射: every migrated entry { id, source, markers } records the
//   unique marker phrases (独有词条) of a retired clause/annotation that AC58 moved OUT of a
//   high-frequency file INTO orchestration/archive/AC58-retired-clauses.md#<id>.
//   CHECK-A (判据1/3): for each entry, every marker must be ABSENT from its source file
//     (the retired body was deleted — only a pointer may remain).
//   CHECK-B (判据2): for each entry, every marker must be PRESENT in the archive
//     (the retired body has a home — "全部有家").
//   A marker present in source BUT absent from archive = a "deleted-but-not-archived" sample ⇒ RED
//   (exit 1). A marker absent from source AND present in archive = migrated ⇒ GREEN.
//   Whitespace + backticks are normalized (collapsed / stripped) so multi-line source bodies and
//   fenced archive bodies match.
//
// Run:
//   node --no-warnings --experimental-strip-types plugin/scripts/retired-clause-check.ts --root <repo>
//   scripts/test.sh --for-task gap-ac58-retired-clauses-delete-and-archive  (via run_static_checks)

import fs from "node:fs";
import path from "node:path";

const ARCHIVE_REL = "orchestration/archive/AC58-retired-clauses.md";

interface Entry {
  id: string;
  source: string; // repo-root-relative file the retired body was removed FROM
  markers: string[]; // unique tokens (独有词条) of the retired body — must be gone from source, present in archive
}

// ── 落点映射 registry (each entry = one migrated retired clause/annotation; the id is the archive anchor) ──
export const REGISTRY: Entry[] = [
  // outer tick-core
  { id: "R01", source: "orchestration/orchestrator-tick-core.md", markers: [
      "批量合【RETIRED — AC48 2026-08-13",
      "integration 删除后该命令无目标",
    ] },
  // orchestrator-loop-tick
  { id: "R02", source: "plugin/loop/orchestrator-loop-tick.md", markers: [
      "inner-state.sh 已退役——它不观测会话",
      "它的招牌信号 .quay/inner-blocked.json",
    ] },
  { id: "R03", source: "plugin/loop/orchestrator-loop-tick.md", markers: [
      "AC12 已随 inner-state.sh 退役而收口",
    ] },
  { id: "R04", source: "plugin/loop/orchestrator-loop-tick.md", markers: [
      "AC48 2026-08-13 退役 integration",
      "AC50 已切，AC48 确认 integration 退役",
    ] },
  // fast-mode-loop-tick (inner loop)
  { id: "R05", source: "plugin/loop/fast-mode-loop-tick.md", markers: [
      ".claude/loop.md 已删除——exp5 退役",
    ] },
  { id: "R06", source: "plugin/loop/fast-mode-loop-tick.md", markers: [
      "heavy-op-token.sh 已随 2026-08-06 人裁定整体退休",
      "约束退役，此放宽实验前提不再存在",
    ] },
  { id: "R07", source: "plugin/loop/fast-mode-loop-tick.md", markers: [
      "旧的 inner-state.sh，现已退役",
    ] },
  { id: "R08", source: "plugin/loop/fast-mode-loop-tick.md", markers: [
      "旧 inner-state.sh 的「在做什么」事件集随其退役而撤下",
    ] },
  { id: "R09", source: "plugin/loop/fast-mode-loop-tick.md", markers: [
      "exp5 已退役（.claude/loop.md 已删除）",
      ".halt 从「暂停 exp5 循环」改为",
    ] },
  { id: "R10", source: "plugin/loop/fast-mode-loop-tick.md", markers: [
      "旧「声明依赖 / touches 相交 → integration」的 fork 判据",
    ] },
  { id: "R11", source: "plugin/loop/fast-mode-loop-tick.md", markers: [
      "观测只有一个工具；inner-state.sh 已退役",
    ] },
  { id: "R12", source: "plugin/loop/fast-mode-loop-tick.md", markers: [
      "旧「touches 与 $MERGE_TARGET 上未验证任务相交 ⇒ $MERGE_TARGET」的 fork 判据与 --force-integration 一并退役",
    ] },
  { id: "R13", source: "plugin/loop/fast-mode-loop-tick.md", markers: [
      "旧的 --force-integration（统一 integration HEAD，gap-task-file-develop-integration-drift-fan-in-conflicts AC2）",
    ] },
  { id: "R14", source: "plugin/loop/fast-mode-loop-tick.md", markers: [
      "旧 --force-integration 统一 integration 已退役",
    ] },
  { id: "R15", source: "plugin/loop/fast-mode-loop-tick.md", markers: [
      "旧「fork 源统一 = integration」（--force-integration）已退役",
    ] },
  { id: "R16", source: "plugin/loop/fast-mode-loop-tick.md", markers: [
      "旧的 inner-state.sh 曾用 inotifywait 监视它，现随 inner-state.sh 一起退役",
    ] },
  { id: "R24", source: "plugin/loop/fast-mode-loop-tick.md", markers: [
      "旧的「单飞挂载 + 共享事件」设计及 heavy-op-token.sh 已随人裁定整体退休",
    ] },
  // CLAUDE.md
  { id: "R17", source: "CLAUDE.md", markers: [
      "该判据已被 AC30(a) 明确退休",
      "n=3 placeholder，已 RETIRED",
    ] },
  { id: "R18", source: "CLAUDE.md", markers: [
      "RETIRED (ADR-022, 2026-08-03): the classic milestone loop",
    ] },
  { id: "R19", source: "CLAUDE.md", markers: [
      "The loop ran directly on `master`",
      "Status (RETIRED under ADR-022)",
    ] },
  { id: "R20", source: "CLAUDE.md", markers: [
      "prepare-milestone.js` also supported the SAME opt-in",
      "RETIRED under ADR-022",
    ] },
  // integration files (AC48 retirement annotations)
  { id: "R21", source: "plugin/scripts/integration-branch-model.ts", markers: [
      "RETIRED (AC48 判据2, 2026-08-13 — tasks/gap-ac48-code-retirement-pool-filter-and-scripts",
      "the two-line integration-branch model is retired",
    ] },
  { id: "R22", source: "plugin/scripts/integration-batch-merge.sh", markers: [
      "every task now forks from develop and the verification-round merges directly to develop",
      "the two-line integration-branch model is retired — the branch was deleted and config",
    ] },
  { id: "R23", source: "orchestration/SPEC-branching-model-integration-branch-2026-08-05.md", markers: [
      "🚫 退役（2026-08-13，AC48 判据2）**：integration 分支已退役——per-task 验证模型",
      "退役证据：develop..integration = 0",
    ] },
  // inner fast-mode-tick-core (AC61 B-1/B-2, gap-ac61-staleness-list-item-disposition)
  { id: "R25", source: "orchestration/fast-mode-tick-core.md", markers: [
      "integration-branch-model.ts --overlaps-unverified",
      "空串使该判定恒假、机制半死",
    ] },
  { id: "R26", source: "orchestration/fast-mode-tick-core.md", markers: [
      "只用 `integration-batch-merge.sh --reconcile`",
    ] },
  // precommit-guard ② (AC64, gap-ac64-precommit-guard-clause2-retire)
  { id: "R27", source: "plugin/scripts/precommit-guard.ts", markers: [
      "约定无产物（C17）——round 60 约定后 26s 即破",
      "参与方不完整且名单无人维护",
      "③结构上不可能靠小心解决",
    ] },
  // inner-wakeup-heartbeat-check agentLimit 判据 (AC77 判据2, gap-ac77-spawn-limit-detect-harness-error-only)
  { id: "R29", source: "plugin/scripts/inner-wakeup-heartbeat-check.ts", markers: [
      "typeof heartbeat?.agentDispatches === \"number\"",
      "heartbeat.agentDispatches >= heartbeat.agentLimit",
    ] },
  // inner 核 A6 步骤清单 (AC78 判据1, gap-ac78-fan-in-workflow-a6-check — fan-in 四步正身迁入
  // .claude/workflows/fan-in-execute.js, A6 只留检查; 落点映射见 archive ## R30)
  { id: "R30", source: "plugin/loop/fast-mode-tick-core.md", markers: [
      "持锁段(仍在 subagent 自回合内)",
      "flip 要动的记录也用 git 跟踪",
      // suite-slot-ssot-exception: R30 的历史退役 marker — 引用旧 suite 锁命名 (full-suite.lock.0/.1)
      // 作退役文本匹配, 非槽路径生成/读取 (不消费套件槽; gap-suite-concurrency-ff-gate-and-slot-ssot I2)
      "锁与 suite 锁(full-suite.lock.0/.1)覆盖范围不交叉",
      "runId 桥(inner 2026-08-14 判断,已核)",
    ] },
  // 自计数载体 inner-agent-budget.json 整体退休 (2026-08-10 人裁定 A16「彻底取消所有 subagent 计数机制」,
  // 删脚本/测试已落地; 源任务引用见 archive ## R31)
  { id: "R31", source: "plugin/loop/fast-mode-loop-tick.md", markers: [
      "inner-agent-budget.json 已随 2026-08-10 人裁定 A16 退休",
    ] },
  // outer B3 全量 suite 后台起跑退役 (AC84 2026-08-15 人裁定 outer 不跑 suite;
  // 正文迁出见 archive ## R32; 标题保留在指针行,故 markers 用正文独有词)
  { id: "R32", source: "orchestration/orchestrator-tick-core.md", markers: [
      "event_not_tick 恒 1",
      "suite-state-trigger.ts 的 Monitor 已把同一条件事件化",
      "gap-b3-tick-coupled-misses-between-tick-merges,2026-08-11",
    ] },
  // outer 红窗分诊外层独占退役 (AC84 2026-08-15,输入随 B3 退役;
  // 正文迁出见 archive ## R33; 标题保留在指针行,故 markers 用正文独有词)
  { id: "R33", source: "orchestration/orchestrator-tick-core.md", markers: [
      "bisect 定位肇事 merge",
      "绝不 blind `--ours/--theirs`",
    ] },
  // outer B5 轮次记录退役 (AC84 2026-08-15,outer 不跑 suite ⇒ closed 恒空;
  // 正文迁出见 archive ## R34; 指针行保留标题,markers 用正文独有词)
  { id: "R34", source: "orchestration/orchestrator-tick-core.md", markers: [
      "载体由两个 writer 写，B5 只是其一",
      "appendVerificationRound（:2502/:3544",
    ] },
];

// ── normalization: strip backticks + line-comment prefixes (# / //), collapse whitespace ──
// Comment-prefix stripping lets fenced .sh/.ts archive bodies (whose lines are "# ..."/"// ...")
// match markers across line boundaries.
export function norm(s: string): string {
  return s
    .replace(/`/g, "")
    .replace(/(^|\n)\s*#\s+/g, " ")
    .replace(/(^|\n)\s*\/\/\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readFile(root: string, rel: string): string {
  const p = path.join(root, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

export function hasMarker(content: string, marker: string): boolean {
  return norm(content).includes(norm(marker));
}

export function runCheck(root: string): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const archive = readFile(root, ARCHIVE_REL);

  for (const entry of REGISTRY) {
    const src = readFile(root, entry.source);
    for (const m of entry.markers) {
      const inSource = hasMarker(src, m);
      const inArchive = hasMarker(archive, m);
      if (inSource && !inArchive) {
        // The exact "deleted-but-not-archived" sample (判据3): body still in the high-frequency
        // file but has NO home in the archive.
        issues.push(`[${entry.id}] DELETED-BUT-NOT-ARCHIVED: marker "${m}" is present in ${entry.source} but ABSENT from ${ARCHIVE_REL} (#${entry.id})`);
      } else if (inSource && inArchive) {
        issues.push(`[${entry.id}] STILL-IN-SOURCE: marker "${m}" is still present in ${entry.source} (body not fully removed; only a pointer should remain)`);
      } else if (!inSource && !inArchive) {
        issues.push(`[${entry.id}] NOT-ARCHIVED: marker "${m}" is ABSENT from both ${entry.source} and ${ARCHIVE_REL} — the retired body has NO home (硬规则⑤)`);
      }
      // else: inArchive && !inSource = correctly migrated (GREEN)
    }
  }

  // The registry is the contract: every id must have a section anchor in the archive.
  for (const entry of REGISTRY) {
    if (!hasMarker(archive, `## ${entry.id}`)) {
      issues.push(`[${entry.id}] ARCHIVE-ANCHOR-MISSING: archive has no "## ${entry.id}" section`);
    }
  }

  return { ok: issues.length === 0, issues };
}

function main() {
  const args = process.argv.slice(2);
  let root = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root" && args[i + 1]) root = args[i + 1];
  }
  const { ok, issues } = runCheck(root);
  if (ok) {
    console.log(`retired-clause-check: OK — ${REGISTRY.length} entries migrated (${REGISTRY.reduce((n, e) => n + e.markers.length, 0)} unique tokens: all gone from source, all present in archive)`);
    process.exit(0);
  }
  console.error(`retired-clause-check: RED (${issues.length} issue(s))`);
  for (const i of issues) console.error(`  - ${i}`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
