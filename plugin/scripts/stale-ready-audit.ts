#!/usr/bin/env node
// stale-ready-audit.ts — 外层每轮读数的「陈旧 ready / 绕过 complete」探测器（人 2026-08-12 裁定：outer 机制要自我保障待办可派发）。
//
// 背景（2026-08-12 实证）：4 条任务（observer-blind / serve-pid / wallclock-budget / tmp-leak）的工作已 fan-in
// merge（8b38cf6d / e94998ee / d887ab12），但任务库状态仍是 `ready`——slot-refill 据此推荐它们，内层不重派
// （工作已完成），人看到「ready 大量 + 无 subagent」误判派发坏。**根因不是派发机制，是「fan-in 后没翻转状态」**——
// 而这个翻转此前只靠外层手动记忆，无机械检查。同日第二缺陷：今天的任务完成绕过了
// plugin/scripts/loop-complete-task.ts（QENG 门路径），直接改 status → `.quay/gate-events.jsonl` 数小时无
// complete-pass GateEvent。
//
// 双判据（机械、非猜测）：
//   (a) forgot-flip / staleReady —— `status: ready` + 非空 `## Evidence`（≥20 字符，含 `## Evidence（…）` 形）
//       + ≥1 条勾选 AC ⇒ 「工作已完成、状态陈旧」——列出供外层翻转。
//   (b) bypass-complete / bypassComplete —— `status: done` 且文件 mtime ≤ 6h（新近被翻 done）但
//       `.quay/gate-events.jsonl` 无该 task 的 `gate:"complete"` + `verdict:"pass"` 记录 ⇒ 「done 没走
//       QENG 门路径」——记录在案的完成才配 done（完成必须经 loop-complete-task.ts）。
//
// 用法：node plugin/scripts/stale-ready-audit.ts <repo-root> [--json] [--done-within-hours <N>]
// 退出码：0 = 两类皆无；1 = ≥1 陈旧 ready 或 ≥1 bypass-complete 候选。
// 只读契约（AC4）：只读 tasks/*.md + .quay/gate-events.jsonl，不写文件、不改状态。
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TASK_STATUS } from "./task-status.ts";

const root = process.argv[2] ?? process.cwd();
const asJson = process.argv.includes("--json");
const tasksDir = join(root, "tasks");

let doneWithinHours = 6;
for (let i = 0; i < process.argv.length - 1; i++) {
  if (process.argv[i] === "--done-within-hours") {
    const n = Number(process.argv[i + 1]);
    if (Number.isFinite(n) && n > 0) doneWithinHours = n;
  }
}

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

/** The `## Evidence` section body (≥20 non-empty chars), accepting the parenthetical heading form
 *  `## Evidence（2026-08-12 …）` that 110+ real tasks use (the pre-fix `/^## Evidence\s*\n/` anchor
 *  missed every one of those — a real evidence-carrying task silently fell out of the stale-ready
 *  detector). Returns the trimmed section, or "" when absent/short. */
function evidenceSection(body: string): string {
  const m = body.match(/^## Evidence(?:（[^）]*）)?\s*\n([\s\S]*?)(?=\n## |$)/m);
  if (!m) return "";
  return m[1].trim();
}

/** The task's `[x]`-checked AC boxes. Accepts the `## AC` / `## AC（draft）` / `## AC (draft)` /
 *  `## Acceptance Criteria` heading forms — the shape-aware family the author→ready gate recognizes
 *  (a draft-heading AC with a checked box is still a checked AC). Line-scan based (a lookahead `$`
 *  anchor would stop at ANY line end and truncate the section to just the heading). */
function checkedAcCount(body: string): number {
  let inAc = false;
  let count = 0;
  for (const line of body.split("\n")) {
    if (/^##\s/.test(line)) {
      inAc = /^##\s+(?:AC(?:（[^）]*）| \([^)]*\))?|Acceptance Criteria)\s*$/.test(line);
      continue;
    }
    if (inAc && /^\s*-\s+\[[xX]\]/.test(line)) count++;
  }
  return count;
}

const staleReady: Array<{ id: string; title: string }> = [];
const bypassComplete: Array<{ id: string; title: string; doneAt: string }> = [];

// (a) forgot-flip: ready + Evidence + ≥1 checked AC.
for (const f of readdirSync(tasksDir)) {
  if (!f.endsWith(".md")) continue;
  const file = join(tasksDir, f);
  const body = readFileSync(file, "utf8");
  const fm = taskFrontmatter(body);
  if (fm["status"] !== TASK_STATUS.READY) continue;
  if (evidenceSection(body).length < 20) continue;
  if (checkedAcCount(body) < 1) continue;
  staleReady.push({ id: f.replace(/\.md$/, ""), title: fm["title"] ?? "" });
}

// (b) bypass-complete: recently-done task WITHOUT a complete-pass GateEvent in .quay/gate-events.jsonl.
// gap-mechanical-fan-in-writes-no-complete-gateevent AC5（仪器三态）：读不到 gate-events.jsonl 时必须
// 报 NOT-EVALUATED 且可区分（硬规则 3b），⛔ 不得与「查过且 0 条」同形——否则文件缺失被读成
// 「全干净」（一个结构上不可能报红的检查）。gateLogReadable 区分「查过」与「读不到」。
const gateLogPath = join(root, ".quay", "gate-events.jsonl");
let gateLogReadable = true;
let gateEvents: Array<{ gate?: string; verdict?: string; pipeline_id?: string }> = [];
if (existsSync(gateLogPath)) {
  try {
    gateEvents = readFileSync(gateLogPath, "utf8").split("\n").filter((l) => l.trim()).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    gateLogReadable = false;
  }
} else {
  gateLogReadable = false;
}
const completeByPipeline = new Set<string>();
for (const e of gateEvents) {
  if (e && e.gate === "complete" && e.verdict === "pass" && typeof e.pipeline_id === "string") {
    completeByPipeline.add(e.pipeline_id);
  }
}
const withinMs = doneWithinHours * 3600 * 1000;
const now = Date.now();
for (const f of readdirSync(tasksDir)) {
  if (!f.endsWith(".md")) continue;
  const file = join(tasksDir, f);
  const body = readFileSync(file, "utf8");
  const fm = taskFrontmatter(body);
  if (fm["status"] !== TASK_STATUS.DONE) continue;
  const mtimeMs = statSync(file).mtimeMs;
  if (now - mtimeMs > withinMs) continue; // not recently done — the flip predates the audit window
  if (!gateLogReadable) continue; // NOT-EVALUATED: 读不到 gate log ⇒ 无法判「绕过」，不产出 bypass 候选
  if (completeByPipeline.has(f.replace(/\.md$/, ""))) continue; // went through the QENG gate path
  bypassComplete.push({
    id: f.replace(/\.md$/, ""),
    title: fm["title"] ?? "",
    doneAt: new Date(mtimeMs).toISOString(),
  });
}

const total = staleReady.length + bypassComplete.length;
if (asJson) {
  console.log(JSON.stringify({ staleReady, bypassComplete, count: total, gateLogReadable }));
} else {
  if (staleReady.length) {
    console.log(`STALE-READY ${staleReady.length}:`);
    for (const s of staleReady) console.log(`  ${s.id} — ${s.title}`);
  } else {
    console.log("STALE-READY 0 — no ready task carries Evidence+checked-ACs");
  }
  if (bypassComplete.length) {
    console.log(`BYPASS-COMPLETE ${bypassComplete.length}: done ≤${doneWithinHours}h with NO complete-pass GateEvent (completion bypassed the QENG gate path):`);
    for (const s of bypassComplete) console.log(`  ${s.id} — ${s.title} (done ${s.doneAt})`);
  } else if (!gateLogReadable) {
    console.log(`BYPASS-COMPLETE NOT-EVALUATED — .quay/gate-events.jsonl 读不到（缺失/不可读），bypassComplete 判据未评估（⛔ 非「0 条」）`);
  } else {
    console.log(`BYPASS-COMPLETE 0 — every done task ≤${doneWithinHours}h has a complete-pass GateEvent`);
  }
}
process.exit(total ? 1 : 0);
