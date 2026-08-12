#!/usr/bin/env node
// stale-ready-audit.ts — 外层每轮读数的「陈旧 ready」探测器（人 2026-08-12 裁定：outer 机制要自我保障待办可派发）。
//
// 背景（2026-08-12 实证）：4 条任务（observer-blind / serve-pid / wallclock-budget / tmp-leak）的工作已 fan-in
// merge（8b38cf6d / e94998ee / d887ab12），但任务库状态仍是 `ready`——slot-refill 据此推荐它们，内层不重派
// （工作已完成），人看到「ready 大量 + 无 subagent」误判派发坏。**根因不是派发机制，是「fan-in 后没翻转状态」**——
// 而这个翻转此前只靠外层手动记忆，无机械检查。
//
// 本脚本把「完成但没翻」变成逐轮可见读数：`ready` 任务若携带非空 `## Evidence` 段 + ≥1 条勾选 AC，
// 高度提示「工作已完成、状态陈旧」——列出供外层翻转（`quay task edit ... --status done` 或 task_write）。
//
// 判据（机械、非猜测）：
//   - 任务 frontmatter `status: ready`；
//   - body 含 `## Evidence` 且其下有非空内容（≥20 字符）；
//   - body 含 ≥1 个 `[x]` 勾选 AC。
// 三条全满足 ⇒ 陈旧 ready 候选。
//
// 用法：node plugin/scripts/stale-ready-audit.ts <repo-root> [--json]
// 退出码：0 = 无陈旧 ready；1 = ≥1 陈旧 ready（升级读数，交由外层翻转）。
// 只读契约（AC4）：只读 tasks/*.md，不写文件、不改状态。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? process.cwd();
const asJson = process.argv.includes("--json");
const tasksDir = join(root, "tasks");

function taskFrontmatter(body: string): Record<string, string> {
  const m = body.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

function hasEvidence(body: string): boolean {
  const m = body.match(/## Evidence\s*\n([\s\S]*?)(?=\n## |$)/);
  if (!m) return false;
  return m[1].trim().length >= 20;
}

const stale: Array<{ id: string; title: string }> = [];
for (const f of readdirSync(tasksDir)) {
  if (!f.endsWith(".md")) continue;
  const body = readFileSync(join(tasksDir, f), "utf8");
  const fm = taskFrontmatter(body);
  if (fm["status"] !== "ready") continue;
  if (!hasEvidence(body)) continue;
  if (!(body.match(/\[x\]/) !== null)) continue;
  stale.push({ id: f.replace(/\.md$/, ""), title: fm["title"] ?? "" });
}

if (asJson) {
  console.log(JSON.stringify({ staleReady: stale, count: stale.length }));
} else {
  if (stale.length) {
    console.log(`STALE-READY ${stale.length}:`);
    for (const s of stale) console.log(`  ${s.id} — ${s.title}`);
  } else {
    console.log("STALE-READY 0 — no ready task carries Evidence+checked-ACs");
  }
}
process.exit(stale.length ? 1 : 0);
