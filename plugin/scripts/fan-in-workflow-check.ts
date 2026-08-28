#!/usr/bin/env node
// ⛔ RETIRED（A6「检查 fan-in 是否走 workflow」）— SPEC-worker-driven-inner-2026-08-16 §5 阶段 2
//   （gap-ac116-spec-phase2-concurrency-stash）：新驱动 worker-driver.ts 直接以 scriptPath 调
//   fan-in-execute workflow（defaultWorkerArgv）⇒ 结构上不需要事后检查「有没有走」。保留面（不退役）：
//   过渡期旧循环仍用本检查做 A6 判据2 (a)(b)(c)。⛔ 新驱动路径不消费本检查。
// fan-in-workflow-check.ts — AC78 判据2 (a)(b)(c): fan-in 是否真的走了 fan-in-execute workflow.
// (tasks/gap-ac78-fan-in-workflow-a6-check, SPEC-fan-in-ff-merge-lock-2026-08-14)
//
// AC78 moves the fan-in steps INTO a workflow script (.claude/workflows/fan-in-execute.js); A6 stops
// being a step checklist and becomes a CHECK that the workflow was executed. This checker makes the
// A6 check mechanical (能取假, 三层缺一不可):
//
//   (a) every fan-in after the workflow landed has a corresponding Workflow CALL record
//       读法: the Claude Code session transcripts — third-party readable, not a self-written log.
//       The checker scans session jsonl files (mtime >= landed boundary) for tool_use blocks whose
//       name === "Workflow" and whose input.scriptPath basename === "fan-in-execute.js", and extracts
//       the task id from the args JSON. (The spec's 读法 names meta-cc query_session_content role=tool
//       tool_name=Workflow; this is the same transcript, read directly.)
//   (b) every fan-in after the workflow landed left >= 1 lock event (with agentId) in
//       .quay/fan-in-merge-lock-events.jsonl — the fan-in set IS derived from these events, so (b) is
//       the source of "which tasks were fan-in'd".
//   (c) the lock event's agentId is a REAL subagent identifier, NOT a top-level session id:
//       top-level <project>/<id>.jsonl exists ⇒ RED (the old main-thread-executor form);
//       subagents/agent-<id>.jsonl exists ⇒ GREEN.
//       现成真样本 (D2 不构造): AC72 agentId=902b4528-bc95-… (top-level jsonl exists) ⇒ RED;
//       AC73 agentId=bc1a438b-66f2-… (top-level jsonl exists) ⇒ RED;
//       AC67 agentId=aab2d14d10a762ff4 (subagents/agent-aab2d14d10a762ff4.jsonl exists) ⇒ GREEN.
//   (d) escalation traceability (SPEC §7 anti-livelock, gap-ff-livelock-trigger-no-action): a task
//       whose ff escalated (attempt >= 3 — fan-in-ff-merge.sh exit 3) is a fan-in attempt that did
//       NOT land. It must STILL have gone through the fan-in-execute workflow — every escalated task
//       must have a Workflow(fan-in-execute) call (.quay/fan-in-ff-escalations.jsonl, --escalations).
//
// ⚠️ 时间边界 (manager 2026-08-14 过计实证: 13−1=12 vs 真值 6): only count fan-in AFTER the workflow
// landed — otherwise pre-workflow fan-in is swept into the difference and the check reddens daily.
// The boundary = the commit timestamp of the commit that added .claude/workflows/fan-in-execute.js
// (resolved from git; overridable via --workflow-landed-ts).
//
// ⚠️ 差集豁免 — 落地锚点 = 派发时间 < 边界 (outer 2026-08-14 裁定, authoritative):
// 「该任务能不能派发 workflow」由【派发时间】决定, 不是 ff 时间. 一个在 workflow 落地【之前】派发的任务,
// 无论它的 ff 何时落地, 都不可能在派发时调用还不存在的 workflow ⇒ 它不进判据2(a) 差集.
// 这一条规则同时吸收:
//   AC78 (派发 08:58 < 边界 09:20:07) — 落地豁免 (被吸收)
//   AC76 (派发 08:56:51 < 边界)      — 边界前派发豁免 (被吸收)
// 有界: 边界前的历史任务集是【固定】的, 不随新任务增长 (彻底解决「可变 Touches 扫描」担忧 —
// 无 Touches 扫描, 无硬编码单任务). 读法: 每任务 A16 --task-start epoch
// ( `.workflow-events/<runId>.jsonl` 的 start 事件 recordedAtMs / timing.startedAtMs ),
// 回退 orchestration/dispatch-record.jsonl (taskId → ts). 均第三方可读, 非自述量.
//
// 差集非空 ⇒ RED + 列差集任务名. 无 fan-in 在边界后 ⇒ NOT-EVALUATED (evaluated=false, 硬规则 3b:
// 无法评估 ≠ 合格). 派发时间【不可解析】且无 Workflow 调用 ⇒ RED (fail-closed: 无法证明边界前派发,
// 不能豁免).
//
// ⚠️ 强制基线 (outer 2026-08-14 裁定, enforcement-baseline — adoption→enforcement, 与
// fan-in-ff-protocol-check 同族): 在 workflow 落地【之后】、强制基线【之前】派发且无 Workflow 调用的
// fan-in ⇒ knownPreBaselineDebt — 真实违规, 记录为【已知基线前债务】(非豁免, 非重跑, 不阻塞). 基线 = 本
// 修复落地的 commit (ENFORCEMENT_BASELINE_EPOCH); 在基线【之后】派发且无 Workflow 调用 ⇒ RED (负控制).
// 已知基线前债务 (本基线存在的原因): gap-idle-watch-intent-anchor-restore — 派发 09:39:21Z, fan-in
// 09:53:41Z, 均早于基线 ⇒ knownPreBaselineDebt. 与 差集豁免(派发<边界) 正交 — 债务带 = [边界, 基线).
//
// ⚠️ 豁免表 (inner 2026-08-15 裁定, outer approved — classification, NOT retrospective dispatch):
// ruled-historical-gap 豁免表 (RULED_HISTORICAL_GAPS) 承载已定案的历史直投缺口 (gap-ac81-inner-verify-
// wiring: 从未立案, 真实双亲 merge 8e833277 走 fan-in-ff-merge.sh 非 workflow, manager-phase-goal.md
// :226/:681 已记已知例外). 入表任务从差集移出, 报为 ruledHistoricalGaps (可见+可审计, 非静默掩盖 —
// 同 bypass-check design-internal 排除集先例); 非入表新直投仍红 (能取假, 豁免表有界不随新任务增长).
//
// Exit codes: 0 = PASS or NOT-EVALUATED (read `evaluated`), 1 = RED (a fan-in dispatched at/after the
//             enforcement baseline without a Workflow call, or a lock event whose agentId is not a
//             real subagent), 2 = usage/environment.
//
// Run:
//   node --experimental-strip-types fan-in-workflow-check.ts
//       [--root <dir>] [--lock-events <file>] [--workflow-landed-ts <ISO>] [--workflow-landed-ref <ref>]
//       [--enforcement-baseline-ts <ISO>]
//       [--project-dir <dir>] [--session-root <dir>] [--tasks-with-workflow-calls <csv>]
//       [--workflow-events-dir <dir>] [--dispatch-record <file>]
//       [--json] [--help]

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";

// ── Constants ─────────────────────────────────────────────────────────────────────────────────────────

/** The workflow basename that must carry every fan-in (判据2a). The A6 line says fan-in MUST go
 *  through this workflow via scriptPath. */
export const WORKFLOW_BASENAME = "fan-in-execute.js";

/**
 * The enforcement-baseline epoch (seconds): enforcement of "every fan-in dispatch MUST mandate the
 * fan-in-execute workflow" begins AT this epoch. A fan-in task dispatched at/after the workflow
 * landed (dispatchEpoch >= boundaryEpoch) but BEFORE this baseline, with no Workflow call, is
 * recorded as `knownPreBaselineDebt` — a REAL violation accepted as pre-baseline debt (outer ruling
 * 2026-08-14: NOT exempt — exempting would be the AC66-rejected bypass; NOT re-run — a fake
 * Workflow call would be fabrication. Adoption→enforcement, the fan-in-ff-protocol-check
 * precedent). A fan-in task whose dispatch is at/after this baseline and that lacks a Workflow call
 * is RED (enforcement — 负控制).
 *
 * Natural anchor: the commit where this fix lands (the checker gains the baseline feature) —
 * dispatch-template-mandates-workflow enforcement begins there. Set to the fix commit's timestamp
 * (1786701510 = 2026-08-14T09:58:30Z), so the commit that adds the baseline IS the baseline.
 * Overridable via --enforcement-baseline-ts for tests/hermetic CLI.
 *
 * Documented pre-baseline debt (the case this baseline exists for):
 *   gap-idle-watch-intent-anchor-restore — dispatch 2026-08-14T09:39:21Z (1786700361), fan-in
 *   2026-08-14T09:53:41Z (1786701221) — BOTH BEFORE this baseline ⇒ knownPreBaselineDebt.
 */
export const ENFORCEMENT_BASELINE_EPOCH = 1786701510;

/**
 * ⚠️ Ruled-historical-gap exemption table (inner 2026-08-15 ruling, outer approved; tasks/
 * gap-fan-in-workflow-ruled-historical-gap-exempt). A checked-in, auditable list of historical
 * fan-in direct-landings that were ALREADY RULED as known exceptions — NOT a retrospective dispatch,
 * NOT a silent skip. Re-dispatching a fake Workflow call would retroactively alter the record to look
 * compliant (masking, the AC66-rejected bypass); carrying the ruled case HERE makes the exemption
 * VISIBLE + auditable (same design as the bypass-check's design-internal exclusion set): every entry
 * carries its task id + the ruling evidence, and the checker REPORTS the exempted set in its output.
 *
 * Keyed by TASK ID — the same key the 判据2(a) difference uses (the fan-in lock-event taskId). A task
 * in this table is removed from the difference and reported as `ruledHistoricalGaps` (distinct from
 * missing/unresolvableDispatch — never conflated with "all-fan-in-have-workflow-call"). BOUNDED: it
 * only covers the RULED cases already listed here; any NEW direct-landing NOT in this table stays in
 * the difference and goes RED (能取假 — the exemption cannot be extended silently).
 *
 * ⚠️ 判据2(c) 复用 (tasks/gap-fan-in-ff-executor-check-ruled-historical-99f845d9): 同一张表也喂给
 * `checkAgentIds`（c 项 agent-id 判定）——一个 ruled 直投（未走 workflow）往往同时未传 --agent-id
 * （主线程调用形态），故 a 项（未走 workflow）与 c 项（agent-id 非 subagent）命中同一张表、同一 taskId。
 * c 项命中的记录分类为 ruledHistorical（reason `lock-event-agent-id-ruled-historical`），非
 * `lock-event-agent-id-not-subagent`（violation）——输出可区分。豁免表有界，未入表任务仍红。
 */
export const RULED_HISTORICAL_GAPS: { taskId: string; reason: string }[] = [
  {
    taskId: "gap-ac81-inner-verify-wiring",
    reason:
      "post-boundary historical direct-landing — never 立案 (no tasks/ file); lock event " +
      "2026-08-14T22:04:00Z (post-boundary, boundary=09:20:07Z) runId fm-gap-ac81-inner-verify-wiring-doc " +
      "(acquire+release same second); real two-parent merge 8e833277 (develop→task/gap-ac81-inner-verify-wiring, " +
      "changed orchestrator-tick-core.md 7 lines); meta-cc: ZERO Workflow(fan-in-execute) calls ⇒ went through " +
      "fan-in-ff-merge.sh, NOT the workflow. Ruling evidence: manager-phase-goal.md:226 (「未定案，留 outer/inner」) + " +
      ":681 (「AC81 doc-only 落地走的是 fan-in-ff-merge.sh 而非本 workflow」). Ruling = classification, NOT " +
      "retrospective dispatch (tasks/gap-fan-in-workflow-ruled-historical-gap-exempt).",
  },
  {
    taskId: "gap-direct-to-develop-ruled-historical-99f845d9",
    reason:
      "manager 授权的应急 fan-in——outer 主会话为解红#4 直接走 fan-in-ff-merge.sh 落地本任务" +
      "（未走 fan-in-execute workflow + 未传 --agent-id），非常规主线程绕过 subagent；" +
      "该形态本轮后不应再发生（正确路径是让 worker-driver 正常派发 subagent fan-in）。" +
      "manager 2026-08-23 裁定 ruled one-off（同 99f845d9 类，先例 direct-to-develop-bypass-check.ts 的" +
      " RULED_HISTORICAL_COMMITS）。",
  },
  {
    taskId: "gap-suite-force-color-ansi-test-sh-normalize",
    reason:
      "manager 2026-08-28 手动验证 fan-in（机械 fan-in 首绿前的连续验证轮：HOLDS_SLOT 注入 / suite 日志 " +
      "tee / runId 日志路径 / ENOENT 行为等修复）——直接调 runMechanicalFanIn 走 fan-in-ff-merge.sh 未传 " +
      "--agent-id，锁事件 agentId=null（16 条：8 acquire/release 对，02:20-04:35Z）。该形态是机械 fan-in " +
      "落地前的 manager 验证，非常规 subagent fan-in；随 worker-driver 正常派发（机械 fan-in）落地后不再发生。 " +
      "manager 2026-08-28 裁定 ruled one-off（同 99f845d9 类，先例 direct-to-develop-bypass-check.ts 的" +
      " RULED_HISTORICAL_COMMITS）。",
  },
];

// ── Mechanical fan-in recognition (gap-fan-in-workflow-check-stale-mechanical-blind-spot) ─────────
// The driver-run mechanical fan-in is the production path since the workflow was retired (the worker
// NEVER calls fan-in-execute). Its lock events carry driver runId prefixes and legitimately have
// agentId=null (driver-run, not a subagent). The workflow-era contract ("every fan-in has a Workflow
// call + a real subagent agent-id") must recognize these as COVERED — else EVERY mechanical fan-in
// reds the NEXT task's scoped-gate (cascade: stale-runid landed via driver ⇒ watchdog's scoped-gate
// reds on stale-runid's agentId=null events). Adding a RULED entry per task would be whack-a-mole.
export function isMechanicalRunId(runId: string | null | undefined): boolean {
  if (!runId) return false;
  return (
    runId.startsWith("wk-prod-") || // driver resident
    runId.startsWith("driver-verify-") || // driver one-shot (--task)
    runId.startsWith("manager-manual-") // manager manual verification fan-in
  );
}

// ── Pure: parse lock events ──────────────────────────────────────────────────────────────────────────

export interface LockEvent {
  event: string;
  ts?: string;
  epoch?: number;
  taskId?: string;
  pid?: number;
  runId?: string | null;
  agentId?: string | null;
}

/** Parse the .quay/fan-in-merge-lock-events.jsonl text into records. Unparseable lines are skipped
 *  (the file is append-only; a torn tail line is not a violation). Returns [] for empty input. */
export function parseLockEvents(text: string): LockEvent[] {
  const out: LockEvent[] = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line);
      if (d && typeof d === "object") out.push(d as LockEvent);
    } catch {
      /* torn/partial line — skip */
    }
  }
  return out;
}

/** The fan-in set after a time boundary: unique taskIds that have an `acquire` event with
 *  epoch >= boundaryEpoch. 判据2b's source — "which tasks were fan-in'd". */
export function fanInTasksSince(records: LockEvent[], boundaryEpoch: number): { taskIds: string[]; events: LockEvent[] } {
  const seen = new Set<string>();
  const events: LockEvent[] = [];
  for (const r of records) {
    if (r.event !== "acquire") continue;
    const e = r.epoch;
    if (e == null || typeof e !== "number" || e < boundaryEpoch) continue;
    events.push(r);
    if (r.taskId) seen.add(r.taskId);
  }
  return { taskIds: [...seen].sort(), events };
}

// ── Pure: dispatch-time resolution (A16 --task-start epoch / dispatch-record) ─────────────────────────

/** The A16 telemetry dir: `<root>/.workflow-events` (gitignored; appended by fast-mode-telemetry). */
export function workflowEventsDir(root: string): string {
  return path.join(root, ".workflow-events");
}

/**
 * A16 `--task-start` dispatch epoch (seconds) from `.workflow-events/<runId>.jsonl`, or null.
 * The start event carries the dispatch instant in `recordedAtMs` (== `timing.startedAtMs`); the runId
 * is used verbatim as the filename. Third-party readable — the file is written by fast-mode-telemetry
 * at dispatch time, not by the task under judgment.
 */
export function readStartEpoch(wfDir: string, runId: string | null | undefined): number | null {
  if (!runId) return null;
  const file = path.join(wfDir, runId + ".jsonl");
  if (!fs.existsSync(file)) return null;
  try {
    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let d: any;
      try { d = JSON.parse(line); } catch { continue; }
      if (d?.eventKind !== "start") continue;
      const ms = typeof d.recordedAtMs === "number" ? d.recordedAtMs
        : (typeof d.timing?.startedAtMs === "number" ? d.timing.startedAtMs : null);
      if (ms == null || !Number.isFinite(ms)) continue;
      return Math.floor(ms / 1000);
    }
  } catch {
    /* unreadable — null */
  }
  return null;
}

/** One `orchestration/dispatch-record.jsonl` line (A16 dispatch-record; schema { ts, taskId, ... }). */
export interface DispatchRecord {
  ts?: string;
  taskId?: string;
}

/** Parse the dispatch-record jsonl text into records. Unparseable lines are skipped. */
export function parseDispatchRecords(text: string): DispatchRecord[] {
  const out: DispatchRecord[] = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line);
      if (d && typeof d === "object") out.push(d as DispatchRecord);
    } catch { /* skip */ }
  }
  return out;
}

/** Dispatch epoch (seconds) for a taskId from the dispatch-record, or null. */
export function dispatchRecordEpoch(records: DispatchRecord[], taskId: string): number | null {
  for (const r of records) {
    if (r.taskId !== taskId || !r.ts) continue;
    const ms = Date.parse(r.ts);
    if (Number.isFinite(ms)) return Math.floor(ms / 1000);
  }
  return null;
}

/**
 * Resolve the dispatch epoch (seconds) for every task in the fan-in set. Precedence per task:
 *   1. `.workflow-events/<runId>.jsonl` start event (runId taken from the task's lock events);
 *   2. `orchestration/dispatch-record.jsonl` (taskId → ts).
 * Unresolvable tasks get null — they stay in the 判据2(a) difference (fail-closed).
 */
export function resolveDispatchEpochs(
  fanInTasks: string[],
  events: LockEvent[],
  wfDir: string,
  dispatchRecords: DispatchRecord[]
): Map<string, number | null> {
  const runIdByTask = new Map<string, string>();
  for (const r of events) {
    if (!r.taskId) continue;
    if (r.runId && !runIdByTask.has(r.taskId)) runIdByTask.set(r.taskId, r.runId);
  }
  const out = new Map<string, number | null>();
  for (const t of fanInTasks) {
    if (!t) continue;
    const runId = runIdByTask.get(t);
    let epoch = readStartEpoch(wfDir, runId);
    if (epoch == null) {
      epoch = dispatchRecordEpoch(dispatchRecords, t);
    }
    out.set(t, epoch);
  }
  return out;
}

// ── Pure: 判据2(a) — Workflow call coverage ─────────────────────────────────────────────────────────

/**
 * Extract Workflow tool_use calls from one session jsonl text. Looks for blocks whose
 * `name === "Workflow"` and whose `input.scriptPath` basename === WORKFLOW_BASENAME, then reads its
 * `task` field. `input.args` may be a JSON string (older transcripts) OR an already-parsed object
 * (real top-level session transcripts — verified 2026-08-14: the Workflow tool_use in
 * bc1a438b-…jsonl carries args as an object); both shapes are honored. Returns the parsed calls.
 */
export interface WorkflowCall {
  scriptPath: string;
  argsJson?: string;
  taskId?: string;
}

export function extractWorkflowCalls(jsonlText: string): WorkflowCall[] {
  const calls: WorkflowCall[] = [];
  for (const line of String(jsonlText ?? "").split("\n")) {
    if (!line.trim() || !line.includes('"Workflow"')) continue;
    let d: any;
    try { d = JSON.parse(line); } catch { continue; }
    const content = d?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      if (block.type !== "tool_use" || block.name !== "Workflow") continue;
      const scriptPath = String(block.input?.scriptPath ?? "");
      if (path.basename(scriptPath) !== WORKFLOW_BASENAME) continue;
      const rawArgs = block.input?.args;
      const argsJson = typeof rawArgs === "string" ? rawArgs : null;
      let taskId: string | undefined;
      if (typeof rawArgs === "string") {
        try {
          const parsed = JSON.parse(rawArgs);
          taskId = typeof parsed?.task === "string" ? parsed.task : undefined;
        } catch { /* unparseable args — keep taskId undefined */ }
      } else if (rawArgs && typeof rawArgs === "object") {
        // Real transcript shape (2026-08-14): args is already an object, not a JSON string.
        taskId = typeof rawArgs.task === "string" ? rawArgs.task : undefined;
      }
      calls.push({ scriptPath, argsJson: argsJson ?? undefined, taskId });
    }
  }
  return calls;
}

/**
 * The set of task ids that have a Workflow(fan-in-execute) call. 判据2(a) — the "went through the
 * workflow" evidence. A call whose args carry no task id contributes nothing (cannot attribute).
 */
export function workflowTaskIds(calls: WorkflowCall[]): string[] {
  return [...new Set(calls.map((c) => c.taskId).filter((t): t is string => typeof t === "string" && t.length > 0))].sort();
}

export interface CoverageResult {
  ok: boolean;
  evaluated: boolean;
  missing: string[];
  preBoundaryDispatch: string[];
  unresolvableDispatch: string[];
  /** Fan-in'd tasks with NO Workflow call whose dispatch is before the enforcement baseline —
   *  real violations accepted as recorded pre-baseline debt (non-blocking). */
  knownPreBaselineDebt: string[];
  /** Ruled historical gaps (classification, NOT retrospective dispatch) — fan-in'd tasks present in
   *  the RULED_HISTORICAL_GAPS exemption table. REMOVED from the difference and reported here (with
   *  their ruling evidence) so the exemption is visible + auditable, never silent. */
  ruledHistoricalGaps: { taskId: string; reason: string }[];
}

/**
 * 判据2(a): 差集 = fan-in'd tasks WITHOUT a Workflow call, once the pre-boundary-dispatch set is
 * removed. 差集非空 ⇒ RED.
 *
 * ⚠️ 落地豁免 (outer 2026-08-14 裁定, authoritative): 「该任务能不能派发 workflow」由【派发时间】决定,
 * 不是 ff 时间. A task whose DISPATCH time < boundaryEpoch could not have dispatched the workflow
 * (it did not exist yet) regardless of when its ff landed ⇒ it is NOT in the (a) difference, reported
 * separately as `preBoundaryDispatch`. This ONE rule subsumes BOTH the AC78 landing exemption and the
 * AC76 pre-boundary dispatch exemption; it is BOUNDED (the pre-boundary historical set is fixed) and
 * needs no Touches scan and no hardcoded task id. A task whose dispatch epoch is unresolvable and
 * that has no Workflow call stays in the difference (fail-closed — cannot prove pre-boundary). Its
 * agentId is STILL checked by 判据2(c).
 *
 * ⚠️ 强制基线 (outer 2026-08-14 裁定, enforcement-baseline — adoption→enforcement 前例): the baseline is
 * the epoch where dispatch-template-mandates-workflow ENFORCEMENT begins. A task dispatched after the
 * workflow existed (>= boundaryEpoch) but BEFORE the baseline, with no Workflow call, is a REAL
 * violation accepted as `knownPreBaselineDebt` (recorded, non-blocking — NOT exempt, NOT re-run). A
 * task dispatched AT/after the baseline with no Workflow call is the 负控制 ⇒ RED. The baseline is
 * orthogonal to the pre-boundary dispatch exemption: the debt band is (boundaryEpoch, baselineEpoch),
 * the exemption band is (< boundaryEpoch). `enforcementBaselineEpoch` defaults to `boundaryEpoch`
 * (empty debt band — pure pre-baseline behavior) so callers that do not pass it are unchanged.
 *
 * ⚠️ 豁免表 (inner 2026-08-15 裁定, outer approved; tasks/gap-fan-in-workflow-ruled-historical-gap-exempt):
 * `ruledHistoricalGaps` is a checked-in, auditable exemption table (RULED_HISTORICAL_GAPS) carrying
 * historical direct-landings that were ALREADY RULED as known exceptions. A task in the table is
 * REMOVED from the difference BEFORE the dispatch-time logic and reported as `ruledHistoricalGaps`
 * (with its ruling reason) — distinct from missing/unresolvableDispatch, so the exemption is visible
 * + auditable, never silent masking. The table is keyed by task id and BOUNDED: any task NOT in it
 * still follows the dispatch-time logic below (post-baseline direct-landing ⇒ RED, 能取假).
 * @returns { ok, evaluated, missing, preBoundaryDispatch, unresolvableDispatch, knownPreBaselineDebt, ruledHistoricalGaps }
 */
export function checkWorkflowCoverage(
  fanInTasks: string[],
  tasksWithWorkflowCalls: string[],
  dispatchEpochs: Map<string, number | null>,
  boundaryEpoch: number,
  enforcementBaselineEpoch: number = boundaryEpoch,
  ruledHistoricalGaps: { taskId: string; reason: string }[] = [],
  mechanicalTaskIds: Set<string> = new Set()
): CoverageResult {
  const tasks = (fanInTasks ?? []).filter(Boolean);
  if (tasks.length === 0) {
    return { ok: true, evaluated: false, reason: "no-fan-in-after-boundary (NOT-EVALUATED)", missing: [], preBoundaryDispatch: [], unresolvableDispatch: [], knownPreBaselineDebt: [], ruledHistoricalGaps: [] };
  }
  const withCalls = new Set((tasksWithWorkflowCalls ?? []).filter(Boolean));
  const exemptByTask = new Map((ruledHistoricalGaps ?? []).map((g) => [g.taskId, g.reason]));
  const preBoundaryDispatch: string[] = [];
  const unresolvableDispatch: string[] = [];
  const knownPreBaselineDebt: string[] = [];
  const ruledHistoricalGapsHit: { taskId: string; reason: string }[] = [];
  const missing: string[] = [];
  for (const t of tasks) {
    if (withCalls.has(t)) continue;
    // Mechanical fan-in (driver-run) — a legitimate dispatch since the workflow was retired; the
    // driver takes over for lock/merge/typecheck/scoped/suite/ff. No Workflow call required.
    if (mechanicalTaskIds.has(t)) continue;
    const exemptReason = exemptByTask.get(t);
    if (exemptReason != null) {
      // Ruled historical gap — already adjudicated as a known exception (manager-phase-goal.md etc.);
      // classification, NOT retrospective dispatch. Removed from the difference, reported auditable.
      ruledHistoricalGapsHit.push({ taskId: t, reason: exemptReason });
      continue;
    }
    const de = dispatchEpochs ? dispatchEpochs.get(t) : undefined;
    if (de != null && de < boundaryEpoch) {
      // Dispatched before the workflow existed — could not have dispatched it; not in the difference.
      preBoundaryDispatch.push(t);
    } else if (de != null && de < enforcementBaselineEpoch) {
      // Dispatched after the workflow existed but BEFORE enforcement began (the dispatch template did
      // not yet mandate the workflow) — a real violation accepted as recorded pre-baseline debt.
      knownPreBaselineDebt.push(t);
    } else {
      if (de == null) unresolvableDispatch.push(t);
      missing.push(t);
    }
  }
  if (missing.length > 0) {
    return { ok: false, evaluated: true, reason: "fan-in-without-workflow-call", missing, preBoundaryDispatch, unresolvableDispatch, knownPreBaselineDebt, ruledHistoricalGaps: ruledHistoricalGapsHit };
  }
  if (ruledHistoricalGapsHit.length > 0 && knownPreBaselineDebt.length === 0) {
    return { ok: true, evaluated: true, reason: "fan-in-without-workflow-call-but-ruled-historical-gap-exempt", missing: [], preBoundaryDispatch, unresolvableDispatch, knownPreBaselineDebt, ruledHistoricalGaps: ruledHistoricalGapsHit };
  }
  if (knownPreBaselineDebt.length > 0) {
    return { ok: true, evaluated: true, reason: "fan-in-workflow-call-ok-with-known-pre-baseline-debt", missing: [], preBoundaryDispatch, unresolvableDispatch, knownPreBaselineDebt, ruledHistoricalGaps: ruledHistoricalGapsHit };
  }
  return { ok: true, evaluated: true, reason: "all-fan-in-have-workflow-call", missing: [], preBoundaryDispatch, unresolvableDispatch, knownPreBaselineDebt, ruledHistoricalGaps: ruledHistoricalGapsHit };
}

// ── Pure: 判据2(c) — agentId is a real subagent ─────────────────────────────────────────────────────

/**
 * Classify ONE agentId against the two file sets:
 *   topLevelStems  — top-level session id stems (uuid without .jsonl) under the project dir
 *   subagentStems  — subagent id stems (uuid without the `agent-` prefix / .jsonl)
 * Prefix matching on both: AC67 recorded the full subagent id aab2d14d10a762ff4, the task body's
 * shorthand aab2d14d must also resolve. Top-level wins (a session id is the main-thread form even if
 * a subagent id shares a prefix — a real subagent uuid never collides with a session uuid's prefix).
 * @returns 'subagent' | 'top-level-session' | 'unresolvable' | 'missing'
 */
export function classifyAgentId(
  agentId: string | null | undefined,
  topLevelStems: string[],
  subagentStems: string[]
): "subagent" | "top-level-session" | "unresolvable" | "missing" {
  if (agentId == null || String(agentId).trim() === "") return "missing";
  const id = String(agentId).trim();
  if (topLevelStems.some((s) => s.startsWith(id))) return "top-level-session";
  if (subagentStems.some((s) => s.startsWith(id))) return "subagent";
  return "unresolvable";
}

/**
 * 判据2(c): judge every lock event after the boundary — its agentId must be a real subagent id.
 * RED on 'missing' (ff called without --agent-id = main-thread form), 'top-level-session'
 * (the old AC72/AC73 defect), or 'unresolvable' (not any real identifier).
 * ⚠️ Ruled-historical 豁免：taskId 命中 `ruledHistoricalTasks`（同 RULED_HISTORICAL_GAPS 表，manager
 * 裁定的应急主线程 fan-in one-off）⇒ 该记录分类为 ruledHistorical（reason `lock-event-agent-id-
 * ruled-historical`），非 violation——两类在输出里可区分；豁免表有界，未入表任务仍红（能取假）。
 */
export function checkAgentIds(
  events: LockEvent[],
  topLevelStems: string[],
  subagentStems: string[],
  ruledHistoricalTasks: { taskId: string; reason: string }[] = [],
  mechanicalRunIds: Set<string> = new Set()
): {
  ok: boolean;
  evaluated: boolean;
  violations: { taskId?: string; agentId?: string | null; kind: string }[];
  ruledHistorical: { taskId: string; reason: string }[];
} {
  if (events.length === 0) {
    return { ok: true, evaluated: false, reason: "no-events-after-boundary (NOT-EVALUATED)", violations: [], ruledHistorical: [] };
  }
  const ruledByTask = new Map((ruledHistoricalTasks ?? []).map((g) => [g.taskId, g.reason]));
  const violations: { taskId?: string; agentId?: string | null; kind: string }[] = [];
  const ruledHistorical: { taskId: string; reason: string }[] = [];
  for (const r of events) {
    // Mechanical fan-in (driver-run) — agentId=null is EXPECTED (the driver, not a subagent, holds
    // the lock during the mechanical fan-in). Not a violation.
    if (r.runId && mechanicalRunIds.has(r.runId)) continue;
    const kind = classifyAgentId(r.agentId, topLevelStems, subagentStems);
    if (kind !== "subagent") {
      const ruledReason = r.taskId != null ? ruledByTask.get(r.taskId) : undefined;
      if (ruledReason != null) {
        ruledHistorical.push({ taskId: r.taskId!, reason: ruledReason });
      } else {
        violations.push({ taskId: r.taskId, agentId: r.agentId, kind });
      }
    }
  }
  if (violations.length > 0) {
    return { ok: false, evaluated: true, reason: "lock-event-agent-id-not-subagent", violations, ruledHistorical };
  }
  if (ruledHistorical.length > 0) {
    return { ok: true, evaluated: true, reason: "lock-event-agent-id-ruled-historical", violations: [], ruledHistorical };
  }
  return { ok: true, evaluated: true, reason: "lock-event-agent-id-is-subagent", violations: [], ruledHistorical: [] };
}

// ── Pure: d — escalation traceability (gap-ff-livelock-trigger-no-action) ───────────────────────────

/** One `.quay/fan-in-ff-escalations.jsonl` line — the anti-livelock escalation record written by
 *  fan-in-ff-merge.sh when a task's ff fails attempt >= 3 (SPEC §7). The escalation carries exit
 *  code 3 (distinct from the plain retry exit 1) and stops automatic retry. */
export interface Escalation {
  event?: string;
  taskId?: string;
  attempt?: number;
  developHead?: string;
  ts?: string;
  epoch?: number;
  runId?: string | null;
  agentId?: string | null;
  mergeTarget?: string;
  action?: string;
}

/** Parse the .quay/fan-in-ff-escalations.jsonl text into records. Unparseable lines are skipped (the
 *  file is append-only; a torn tail line is not a violation). Returns [] for empty input. */
export function parseEscalations(text: string): Escalation[] {
  const out: Escalation[] = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line);
      if (d && typeof d === "object") out.push(d as Escalation);
    } catch {
      /* torn/partial line — skip */
    }
  }
  return out;
}

/** The unique task ids that carry an escalation record (the anti-livelock-triggered fan-ins). */
export function escalatedTaskIds(escalations: Escalation[]): string[] {
  // The escalation file also carries `ff-escalation-resolved` records (written by fan-in-ff-merge.sh
  // on ff success — the escalation-resolution signal, kept after the quiet-window request was
  // retired by gap-quiet-window-holder-scope-wider-than-consumer). Filter to `ff-escalation` only —
  // a resolution is the FULFILLMENT of a request, not a NEW escalation, and must not pollute
  // 判据2(d) traceability (a landed task is not an "escalated fan-in").
  return [...new Set((escalations ?? [])
    .filter((e) => e.event === "ff-escalation")
    .map((e) => e.taskId)
    .filter((t): t is string => typeof t === "string" && t.length > 0))].sort();
}

export interface EscalationTraceabilityResult {
  ok: boolean;
  evaluated: boolean;
  escalatedTasks: string[];
  escalatedWithoutWorkflow: string[];
}

/**
 * 判据2 traceability for the anti-livelock escalation path: an escalated fan-in is a fan-in attempt
 * that did NOT land — it must STILL have gone through the fan-in-execute workflow. RED when any
 * escalated task lacks a Workflow(fan-in-execute) call (a direct main-session escalation would be the
 * AC72/AC73 main-thread-executor defect). NOT-EVALUATED when no escalations exist (nothing to judge).
 */
export function checkEscalationTraceability(
  escalatedTasks: string[],
  tasksWithWorkflowCalls: string[]
): EscalationTraceabilityResult {
  const tasks = (escalatedTasks ?? []).filter(Boolean);
  if (tasks.length === 0) {
    return { ok: true, evaluated: false, reason: "no-escalations (NOT-EVALUATED)", escalatedTasks: [], escalatedWithoutWorkflow: [] };
  }
  const withCalls = new Set((tasksWithWorkflowCalls ?? []).filter(Boolean));
  const escalatedWithoutWorkflow = tasks.filter((t) => !withCalls.has(t));
  if (escalatedWithoutWorkflow.length > 0) {
    return { ok: false, evaluated: true, reason: "escalated-fan-in-without-workflow-call", escalatedTasks: tasks, escalatedWithoutWorkflow };
  }
  return { ok: true, evaluated: true, reason: "all-escalated-fan-ins-have-workflow-call", escalatedTasks: tasks, escalatedWithoutWorkflow: [] };
}

// ── fs / resolution helpers ──────────────────────────────────────────────────────────────────────────

/** The Claude project dir slug for a repo root: the path with every `/` replaced by `-`.
 *  /home/yale/work/quay → -home-yale-work-quay (the leading / becomes the leading -). */
export function projectSlug(root: string): string {
  return path.resolve(root).split(path.sep).join("-");
}

export function defaultProjectDir(root: string): string {
  return path.join(os.homedir(), ".claude", "projects", projectSlug(root));
}

/** Top-level session id stems: every entry in the project dir whose name (without .jsonl) looks like
 *  a session uuid — file `<uuid>.jsonl` OR directory `<uuid>/`. */
export function topLevelSessionStems(projectDir: string): string[] {
  if (!fs.existsSync(projectDir)) return [];
  const stems: string[] = [];
  for (const entry of fs.readdirSync(projectDir, { withFileTypes: true })) {
    const name = entry.name;
    const stem = name.endsWith(".jsonl") ? name.slice(0, -".jsonl".length) : name;
    if (/^[0-9a-f-]+$/i.test(stem)) stems.push(stem);
  }
  return stems;
}

/** Subagent id stems: every `agent-<uuid>.jsonl` under any `<projectDir>/<session>/subagents/`
 *  (and `<projectDir>/subagents/` if present), scanned RECURSIVELY. The recursion is required
 *  because workflow-run subagents land under `subagents/workflows/<run>/agent-*.jsonl` — the old
 *  one-level-of-session-dirs scan stopped at `<session>/subagents/` and misclassified those ids as
 *  unresolvable (outer 2026-08-14: DIR-128's agentId a8ebef25b5253b8cf lives under
 *  `<session>/subagents/workflows/wf_…/` and was RED until this fix). */
export function subagentStems(projectDir: string): string[] {
  if (!fs.existsSync(projectDir)) return [];
  const stems: string[] = [];
  const roots = [path.join(projectDir, "subagents")];
  for (const entry of fs.readdirSync(projectDir, { withFileTypes: true })) {
    if (entry.isDirectory()) roots.push(path.join(projectDir, entry.name, "subagents"));
  }
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!entry.name.startsWith("agent-") || !entry.name.endsWith(".jsonl")) continue;
      stems.push(entry.name.slice("agent-".length, -".jsonl".length));
    }
  };
  for (const root of roots) walk(root);
  return stems;
}

/**
 * Scan a session root for Workflow(fan-in-execute) calls made at/after boundaryEpoch. Walks for
 * *.jsonl with mtime >= boundaryEpoch (the Workflow call for a fan-in task is written at fan-in time,
 * which is after the workflow landed). Returns the task ids.
 */
export function scanWorkflowTaskIds(sessionRoot: string, boundaryEpoch: number): string[] {
  if (!fs.existsSync(sessionRoot)) return [];
  const taskIds = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".jsonl")) continue;
      let st: fs.Stats;
      try { st = fs.statSync(full); } catch { continue; }
      if (st.mtimeMs < boundaryEpoch * 1000) continue;
      try {
        const text = fs.readFileSync(full, "utf8");
        for (const t of workflowTaskIds(extractWorkflowCalls(text))) taskIds.add(t);
      } catch { /* unreadable file — skip */ }
    }
  };
  walk(sessionRoot);
  return [...taskIds].sort();
}

// ── git boundary resolution ──────────────────────────────────────────────────────────────────────────

/** Resolve the workflow-landed boundary epoch. Precedence: --workflow-landed-ts (explicit) →
 *  git commit time of the commit that added the workflow file (via --workflow-landed-ref) → null
 *  (NOT-EVALUATED: the workflow has not landed, so nothing after it can be attributed). */
export function resolveBoundaryEpoch(root: string, landedTs?: string, landedRef?: string): number | null {
  if (landedTs) {
    const ms = Date.parse(landedTs);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }
  const ref = landedRef ?? "HEAD";
  const file = ".claude/workflows/" + WORKFLOW_BASENAME;
  try {
    const iso = execFileSync("git", ["-C", root, "log", "--diff-filter=A", "-1", "--format=%cI", ref, "--", file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!iso) return null;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  } catch {
    return null;
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────

function getArgValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

const usage = `fan-in-workflow-check.ts — AC78 判据2 (a)(b)(c): fan-in 是否真的走了 fan-in-execute workflow
  (a) Workflow 调用记录 ∩ (b) lock-events 带 agentId ∩ (c) agentId 是真实 subagent 标识;
  三处带时间边界（只统计该 workflow 落地后 fan-in）; 差集非空 ⇒ 红 + 列差集任务名.
  差集豁免 = 派发时间 < 边界 (outer 2026-08-14 裁定): 一个在 workflow 落地【之前】派发的任务不可能
  调用不存在的 workflow, 不进判据2(a) 差集 (AC78 落地豁免 与 AC76 边界前派发豁免 同一规则吸收).
  强制基线 (outer 2026-08-14 裁定, adoption→enforcement): 派发时间在 [边界, 基线) 的无 Workflow 调用
  fan-in ⇒ knownPreBaselineDebt (记录, 不阻塞); 派发时间 >= 基线 的无 Workflow 调用 ⇒ 红 (负控制).
  豁免表 (inner 2026-08-15 裁定, classification): RULED_HISTORICAL_GAPS 承载已定案历史直投缺口
  (gap-ac81-inner-verify-wiring 等) — 入表 ⇒ 移出差集报 ruledHistoricalGaps (可见+可审计, 非静默掩盖);
  非入表新直投仍红 (能取假, 豁免表有界).

Usage:
  node --experimental-strip-types fan-in-workflow-check.ts
      [--root <dir>] [--lock-events <file>]
      [--workflow-landed-ts <ISO>] [--workflow-landed-ref <ref>]
      [--enforcement-baseline-ts <ISO>]
      [--project-dir <dir>] [--session-root <dir>]
      [--tasks-with-workflow-calls <csv>]
      [--workflow-events-dir <dir>] [--dispatch-record <file>]
      [--escalations <file>]
      [--json] [--help]

  --root <dir>              repo root (default: cwd). Derives the default project dir slug.
  --lock-events <file>      判据2b: fan-in-ff-merge.sh lock-event log
                            (default <root>/.quay/fan-in-merge-lock-events.jsonl).
  --workflow-landed-ts <ISO> the boundary as an explicit ISO timestamp (epoch seconds >= this count).
  --workflow-landed-ref <ref> git ref to resolve the boundary from (default HEAD). The boundary is the
                            commit time of the commit that added .claude/workflows/fan-in-execute.js.
  --enforcement-baseline-ts <ISO>  the enforcement-baseline epoch (default ENFORCEMENT_BASELINE_EPOCH —
                            the commit where the baseline feature landed). A fan-in dispatched before
                            it with no Workflow call is knownPreBaselineDebt (non-blocking); at/after
                            it ⇒ RED. Override for tests/hermetic CLI.
  --project-dir <dir>       判据2c: the Claude project dir whose top-level/subagents files hold the
                            session ids (default ~/.claude/projects/<slug-of-root>).
  --session-root <dir>      判据2a scan root: session jsonl files to scan for Workflow calls
                            (default: --project-dir).
  --tasks-with-workflow-calls <csv>  explicit (a) input — task ids that have a Workflow call record.
                            When given, the session scan is skipped (test surface / meta-cc read).
  --workflow-events-dir <dir>  A16 telemetry dir for the dispatch-time anchor
                            (default <root>/.workflow-events). Per task, the start event's
                            recordedAtMs / timing.startedAtMs of <runId>.jsonl gives the DISPATCH epoch.
  --dispatch-record <file>  dispatch-record fallback for the dispatch-time anchor
                            (default <root>/orchestration/dispatch-record.jsonl). taskId → ts.
  --escalations <file>      d: the anti-livelock escalation log (SPEC §7, gap-ff-livelock-trigger-
                            no-action) — fan-in-ff-merge.sh appends here when a task's ff fails
                            attempt >= 3 (default <root>/.quay/fan-in-ff-escalations.jsonl). Every
                            escalated task must ALSO have a Workflow(fan-in-execute) call (判据2
                            traceability: an escalation is a fan-in attempt that did not land).
  --json                    machine-readable output { ok, evaluated, reason, checks }.
  --help                    this help.

Exit codes:
  0  PASS or NOT-EVALUATED (read \`evaluated\` — false = could not judge, never conflated with green);
     knownPreBaselineDebt is reported as a separate non-blocking field — the checker is OK.
  1  RED — a fan-in task dispatched at/after the enforcement baseline without a Workflow call, a
     lock event whose agentId is not a real subagent id (top-level session / missing / unresolvable),
     or an escalated fan-in (SPEC §7 anti-livelock) without a Workflow call
  2  usage / environment error`;

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const root = path.resolve(getArgValue(args, "--root") ?? process.cwd());
  const lockEventsFile = getArgValue(args, "--lock-events") ?? path.join(root, ".quay", "fan-in-merge-lock-events.jsonl");
  const landedTs = getArgValue(args, "--workflow-landed-ts");
  const landedRef = getArgValue(args, "--workflow-landed-ref");
  const projectDir = getArgValue(args, "--project-dir") ?? defaultProjectDir(root);
  const sessionRoot = getArgValue(args, "--session-root") ?? projectDir;
  const explicitTasks = (getArgValue(args, "--tasks-with-workflow-calls") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const wfEventsDir = getArgValue(args, "--workflow-events-dir") ?? workflowEventsDir(root);
  const dispatchRecordFile = getArgValue(args, "--dispatch-record") ?? path.join(root, "orchestration", "dispatch-record.jsonl");
  const escalationFile = getArgValue(args, "--escalations") ?? path.join(root, ".quay", "fan-in-ff-escalations.jsonl");
  const rawBaselineTs = getArgValue(args, "--enforcement-baseline-ts");
  let enforcementBaselineEpoch = ENFORCEMENT_BASELINE_EPOCH;
  if (rawBaselineTs != null) {
    const ms = Date.parse(rawBaselineTs);
    if (!Number.isFinite(ms)) {
      process.stderr.write(`fan-in-workflow-check: --enforcement-baseline-ts must be an ISO timestamp (got '${rawBaselineTs}')\n`);
      return 2;
    }
    enforcementBaselineEpoch = Math.floor(ms / 1000);
  }
  const asJson = args.includes("--json");

  const boundaryEpoch = resolveBoundaryEpoch(root, landedTs, landedRef);
  const checks: any[] = [];
  let anyEvaluated = false;
  let anyRed = false;

  if (boundaryEpoch == null) {
    // The workflow has not landed (no commit adds it, no explicit ts): nothing can be attributed
    // after it. NOT-EVALUATED, never green (硬规则 3b).
    checks.push({ check: "boundary", ok: true, evaluated: false, reason: "no-workflow-landed-boundary (NOT-EVALUATED)", source: `${WORKFLOW_BASENAME}@${landedRef ?? "HEAD"}` });
  } else {
    checks.push({ check: "boundary", ok: true, evaluated: true, reason: `workflow-landed-epoch=${boundaryEpoch}`, source: landedTs ? `--workflow-landed-ts ${landedTs}` : `git log ${landedRef ?? "HEAD"} -- ${WORKFLOW_BASENAME}` });

    const records = parseLockEvents(fs.existsSync(lockEventsFile) ? fs.readFileSync(lockEventsFile, "utf8") : "");
    const { taskIds, events } = fanInTasksSince(records, boundaryEpoch);

    // Per-task EARLIEST fan-in acquire epoch (>= boundary by construction) — the moment each task's
    // fan-in operation began. Reported with knownPreBaselineDebt so the debt is fully documented.
    const fanInEpochs = new Map<string, number>();
    for (const r of events) {
      if (!r.taskId || typeof r.epoch !== "number") continue;
      const cur = fanInEpochs.get(r.taskId);
      if (cur == null || r.epoch < cur) fanInEpochs.set(r.taskId, r.epoch);
    }

    // ── 判据2(a) — Workflow call coverage ──────────────────────────────────────────────────────
    const tasksWithWorkflow = explicitTasks.length > 0
      ? explicitTasks
      : scanWorkflowTaskIds(sessionRoot, boundaryEpoch);
    const dispatchRecords = parseDispatchRecords(fs.existsSync(dispatchRecordFile) ? fs.readFileSync(dispatchRecordFile, "utf8") : "");
    const dispatchEpochs = resolveDispatchEpochs(taskIds, events, wfEventsDir, dispatchRecords);
    const mechanicalTaskIds = new Set(
      events.filter((r) => isMechanicalRunId(r.runId) && r.taskId).map((r) => r.taskId!),
    );
    const vA = checkWorkflowCoverage(taskIds, tasksWithWorkflow, dispatchEpochs, boundaryEpoch, enforcementBaselineEpoch, RULED_HISTORICAL_GAPS, mechanicalTaskIds);
    if (vA.evaluated) {
      anyEvaluated = true;
      if (!vA.ok) anyRed = true;
    }
    checks.push({
      check: "a-workflow-call-coverage",
      ...vA,
      source: explicitTasks.length > 0 ? `--tasks-with-workflow-calls (${explicitTasks.length})` : `scan ${sessionRoot} >= epoch ${boundaryEpoch}`,
      fanInTasks: taskIds,
      tasksWithWorkflowCalls: tasksWithWorkflow,
      enforcementBaseline: { epoch: enforcementBaselineEpoch, ts: new Date(enforcementBaselineEpoch * 1000).toISOString(), source: rawBaselineTs ? `--enforcement-baseline-ts ${rawBaselineTs}` : "ENFORCEMENT_BASELINE_EPOCH constant" },
      fanInEpochs: [...fanInEpochs.entries()].map(([taskId, epoch]) => ({ taskId, fanInEpoch: epoch })),
      dispatchAnchor: { boundaryEpoch, dir: wfEventsDir, fallback: dispatchRecordFile, perTask: [...dispatchEpochs.entries()].map(([taskId, epoch]) => ({ taskId, dispatchEpoch: epoch })) },
    });

    // ── 判据2(c) — agentId is a real subagent ──────────────────────────────────────────────────
    const topLevel = topLevelSessionStems(projectDir);
    const subAgents = subagentStems(projectDir);
    const mechanicalRunIds = new Set(events.filter((r) => isMechanicalRunId(r.runId)).map((r) => r.runId!));
    const vC = checkAgentIds(events, topLevel, subAgents, RULED_HISTORICAL_GAPS, mechanicalRunIds);
    if (vC.evaluated) {
      anyEvaluated = true;
      if (!vC.ok) anyRed = true;
    }
    checks.push({
      check: "c-agent-id-real-subagent",
      ...vC,
      source: `${projectDir} (topLevel=${topLevel.length}, subagents=${subAgents.length})`,
    });

    // ── d — escalation traceability (SPEC §7 anti-livelock, gap-ff-livelock-trigger-no-action) ──
    // An escalated fan-in (a task whose ff failed attempt >= 3 and triggered the anti-livelock
    // action) is a fan-in attempt that did NOT land. It must STILL satisfy 判据2 traceability — the
    // escalation came from the fan-in-execute workflow. Every escalated task must have a
    // Workflow(fan-in-execute) call; an escalation without one is the AC72/AC73 main-thread-executor
    // defect on the escalation path.
    const escalations = parseEscalations(fs.existsSync(escalationFile) ? fs.readFileSync(escalationFile, "utf8") : "");
    const escalated = escalatedTaskIds(escalations);
    const vD = checkEscalationTraceability(escalated, tasksWithWorkflow);
    if (vD.evaluated) {
      anyEvaluated = true;
      if (!vD.ok) anyRed = true;
    }
    checks.push({
      check: "d-escalation-traceability",
      ...vD,
      source: `${escalationFile} (escalations=${escalations.length})`,
    });
  }

  const ok = !anyRed;
  const out = {
    ok,
    evaluated: anyEvaluated,
    reason: ok ? (anyEvaluated ? "fan-in-workflow-check-pass" : "nothing-to-judge (NOT-EVALUATED)") : "fan-in-without-workflow-or-bad-agent-id",
    checks,
  };

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`fan-in-workflow-check: ${ok ? "OK" : "FAIL"} — ${out.reason}`);
    for (const c of out.checks) {
      console.log(`  [${c.check}] ${c.ok ? "ok" : "RED"}${c.evaluated ? "" : " (NOT-EVALUATED)"} — ${c.reason}`);
      if (c.missing?.length) console.log(`    missing (fan-in without Workflow call): ${c.missing.join(", ")}`);
      if (c.preBoundaryDispatch?.length) console.log(`    pre-boundary-dispatch exempt (dispatched before workflow landed): ${c.preBoundaryDispatch.join(", ")}`);
      if (c.knownPreBaselineDebt?.length) console.log(`    known pre-baseline debt (dispatch before enforcement baseline, recorded non-blocking): ${c.knownPreBaselineDebt.join(", ")}`);
      if (c.unresolvableDispatch?.length) console.log(`    unresolvable dispatch (in difference, fail-closed): ${c.unresolvableDispatch.join(", ")}`);
      if (c.ruledHistoricalGaps?.length) for (const g of c.ruledHistoricalGaps) console.log(`    ruled-historical-gap exempt (classification, visible+auditable): ${g.taskId} — ${g.reason}`);
      if (c.ruledHistorical?.length) for (const g of c.ruledHistorical) console.log(`    ruled-historical exempt (agent-id, classification, visible+auditable): ${g.taskId} — ${g.reason}`);
      if (c.violations?.length) for (const v of c.violations) console.log(`    ${v.taskId ?? "?"}: agentId ${v.agentId ?? "<null>"} → ${v.kind}`);
    }
  }
  return ok ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "fan-in-workflow-check")) {
  const code = main(process.argv);
  process.exitCode = code;
}
