#!/usr/bin/env node
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
// Exit codes: 0 = PASS or NOT-EVALUATED (read `evaluated`), 1 = RED (a fan-in without a Workflow
//             call, or a lock event whose agentId is not a real subagent), 2 = usage/environment.
//
// Run:
//   node --experimental-strip-types fan-in-workflow-check.ts
//       [--root <dir>] [--lock-events <file>] [--workflow-landed-ts <ISO>] [--workflow-landed-ref <ref>]
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
 * `name === "Workflow"` and whose `input.scriptPath` basename === WORKFLOW_BASENAME, then parses the
 * `input.args` JSON string and reads its `task` field. Returns the parsed call objects.
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
      const argsJson = typeof block.input?.args === "string" ? block.input.args : null;
      let taskId: string | undefined;
      if (argsJson) {
        try {
          const parsed = JSON.parse(argsJson);
          taskId = typeof parsed?.task === "string" ? parsed.task : undefined;
        } catch { /* unparseable args — keep taskId undefined */ }
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
 * @returns { ok, evaluated, missing, preBoundaryDispatch, unresolvableDispatch }
 */
export function checkWorkflowCoverage(
  fanInTasks: string[],
  tasksWithWorkflowCalls: string[],
  dispatchEpochs: Map<string, number | null>,
  boundaryEpoch: number
): CoverageResult {
  const tasks = (fanInTasks ?? []).filter(Boolean);
  if (tasks.length === 0) {
    return { ok: true, evaluated: false, reason: "no-fan-in-after-boundary (NOT-EVALUATED)", missing: [], preBoundaryDispatch: [], unresolvableDispatch: [] };
  }
  const withCalls = new Set((tasksWithWorkflowCalls ?? []).filter(Boolean));
  const preBoundaryDispatch: string[] = [];
  const unresolvableDispatch: string[] = [];
  const missing: string[] = [];
  for (const t of tasks) {
    if (withCalls.has(t)) continue;
    const de = dispatchEpochs ? dispatchEpochs.get(t) : undefined;
    if (de != null && de < boundaryEpoch) {
      // Dispatched before the workflow existed — could not have dispatched it; not in the difference.
      preBoundaryDispatch.push(t);
    } else {
      if (de == null) unresolvableDispatch.push(t);
      missing.push(t);
    }
  }
  if (missing.length > 0) {
    return { ok: false, evaluated: true, reason: "fan-in-without-workflow-call", missing, preBoundaryDispatch, unresolvableDispatch };
  }
  return { ok: true, evaluated: true, reason: "all-fan-in-have-workflow-call", missing: [], preBoundaryDispatch, unresolvableDispatch };
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
 */
export function checkAgentIds(
  events: LockEvent[],
  topLevelStems: string[],
  subagentStems: string[]
): { ok: boolean; evaluated: boolean; violations: { taskId?: string; agentId?: string | null; kind: string }[] } {
  if (events.length === 0) {
    return { ok: true, evaluated: false, reason: "no-events-after-boundary (NOT-EVALUATED)", violations: [] };
  }
  const violations: { taskId?: string; agentId?: string | null; kind: string }[] = [];
  for (const r of events) {
    const kind = classifyAgentId(r.agentId, topLevelStems, subagentStems);
    if (kind !== "subagent") {
      violations.push({ taskId: r.taskId, agentId: r.agentId, kind });
    }
  }
  if (violations.length > 0) {
    return { ok: false, evaluated: true, reason: "lock-event-agent-id-not-subagent", violations };
  }
  return { ok: true, evaluated: true, reason: "lock-event-agent-id-is-subagent", violations: [] };
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
 *  (and `<projectDir>/subagents/` if present). Recursive one level of session dirs. */
export function subagentStems(projectDir: string): string[] {
  if (!fs.existsSync(projectDir)) return [];
  const stems: string[] = [];
  const dirs = [path.join(projectDir, "subagents")];
  for (const entry of fs.readdirSync(projectDir, { withFileTypes: true })) {
    if (entry.isDirectory()) dirs.push(path.join(projectDir, entry.name, "subagents"));
  }
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith("agent-") || !name.endsWith(".jsonl")) continue;
      stems.push(name.slice("agent-".length, -".jsonl".length));
    }
  }
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
    const iso = execFileSync("git", ["-C", root, "log", "-1", "--format=%cI", ref, "--", file], {
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

Usage:
  node --experimental-strip-types fan-in-workflow-check.ts
      [--root <dir>] [--lock-events <file>]
      [--workflow-landed-ts <ISO>] [--workflow-landed-ref <ref>]
      [--project-dir <dir>] [--session-root <dir>]
      [--tasks-with-workflow-calls <csv>]
      [--workflow-events-dir <dir>] [--dispatch-record <file>]
      [--json] [--help]

  --root <dir>              repo root (default: cwd). Derives the default project dir slug.
  --lock-events <file>      判据2b: fan-in-ff-merge.sh lock-event log
                            (default <root>/.quay/fan-in-merge-lock-events.jsonl).
  --workflow-landed-ts <ISO> the boundary as an explicit ISO timestamp (epoch seconds >= this count).
  --workflow-landed-ref <ref> git ref to resolve the boundary from (default HEAD). The boundary is the
                            commit time of the commit that added .claude/workflows/fan-in-execute.js.
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
  --json                    machine-readable output { ok, evaluated, reason, checks }.
  --help                    this help.

Exit codes:
  0  PASS or NOT-EVALUATED (read \`evaluated\` — false = could not judge, never conflated with green)
  1  RED — a fan-in task after the boundary without a Workflow call, or a lock event whose agentId
     is not a real subagent id (top-level session / missing / unresolvable)
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

    // ── 判据2(a) — Workflow call coverage ──────────────────────────────────────────────────────
    const tasksWithWorkflow = explicitTasks.length > 0
      ? explicitTasks
      : scanWorkflowTaskIds(sessionRoot, boundaryEpoch);
    const dispatchRecords = parseDispatchRecords(fs.existsSync(dispatchRecordFile) ? fs.readFileSync(dispatchRecordFile, "utf8") : "");
    const dispatchEpochs = resolveDispatchEpochs(taskIds, events, wfEventsDir, dispatchRecords);
    const vA = checkWorkflowCoverage(taskIds, tasksWithWorkflow, dispatchEpochs, boundaryEpoch);
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
      dispatchAnchor: { boundaryEpoch, dir: wfEventsDir, fallback: dispatchRecordFile, perTask: [...dispatchEpochs.entries()].map(([taskId, epoch]) => ({ taskId, dispatchEpoch: epoch })) },
    });

    // ── 判据2(c) — agentId is a real subagent ──────────────────────────────────────────────────
    const topLevel = topLevelSessionStems(projectDir);
    const subAgents = subagentStems(projectDir);
    const vC = checkAgentIds(events, topLevel, subAgents);
    if (vC.evaluated) {
      anyEvaluated = true;
      if (!vC.ok) anyRed = true;
    }
    checks.push({
      check: "c-agent-id-real-subagent",
      ...vC,
      source: `${projectDir} (topLevel=${topLevel.length}, subagents=${subAgents.length})`,
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
      if (c.unresolvableDispatch?.length) console.log(`    unresolvable dispatch (in difference, fail-closed): ${c.unresolvableDispatch.join(", ")}`);
      if (c.violations?.length) for (const v of c.violations) console.log(`    ${v.taskId ?? "?"}: agentId ${v.agentId ?? "<null>"} → ${v.kind}`);
    }
  }
  return ok ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "fan-in-workflow-check")) {
  const code = main(process.argv);
  process.exitCode = code;
}
