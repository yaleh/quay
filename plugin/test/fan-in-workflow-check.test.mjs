// @test-group serial
// fan-in-workflow-check.test.mjs — AC78 判据2 (a)(b)(c) checker tests,
// plugin/scripts/fan-in-workflow-check.ts. The negative-control fixtures prove the checker can go RED
// on the three AC78 defects (判据能取假) plus NOT-EVALUATED (never conflated with green, 硬规则 3b).
//
//   RED   checkWorkflowCoverage — a fan-in'd task with NO Workflow call AND dispatch >= boundary
//         (差集非空 ⇒ 红; the AC76/AC78 inverse — dispatch-time anchoring negative control)
//   RED   checkWorkflowCoverage — a fan-in'd task with NO Workflow call AND UNRESOLVABLE dispatch
//         (fail-closed — cannot prove pre-boundary ⇒ stays in the difference)
//   RED   checkAgentIds — agentId resolving to a TOP-LEVEL session id (AC72 902b4528 / AC73
//         bc1a438b — real samples, top-level <project>/<id>.jsonl exists)
//   RED   checkAgentIds — agentId missing (fan-in-ff-merge.sh called WITHOUT --agent-id = main-thread)
//   RED   checkAgentIds — agentId unresolvable (neither top-level nor subagents file)
//   GREEN checkAgentIds — agentId resolving to a subagents/agent-<id>.jsonl
//         (AC67 aab2d14d10a762ff4 / AC66 ab65b5829c1a78501 — real samples)
//   GREEN checkWorkflowCoverage — every fan-in'd task has a Workflow call
//   GREEN checkWorkflowCoverage — a fan-in'd task DISPATCHED before the boundary is exempt
//         (dispatch-time anchoring: it could not have dispatched the not-yet-existing workflow) —
//         AC78 (dispatch 1786697920 < boundary 1786699207) and AC76 (dispatch 1786697811) BOTH exempt
//   NOT-EVALUATED — no fan-in after the time boundary (the ⚠️ 时间边界 guard: pre-workflow fan-in
//         must NOT be swept into the difference)
//   DEBT  checkWorkflowCoverage — a fan-in dispatched AFTER the workflow boundary but BEFORE the
//         enforcement baseline with no Workflow call ⇒ knownPreBaselineDebt, ok:true (non-blocking —
//         the gap-idle-watch-intent-anchor-restore shape, outer 2026-08-14 ruling)
//   RED   checkWorkflowCoverage — 负控制: a fan-in DISPATCHED AFTER the enforcement baseline with no
//         Workflow call ⇒ RED (post-baseline violation — enforcement, the adoption→enforcement
//         precedent's negative control)
//   PURE  fanInTasksSince — pre-boundary acquire events are excluded
//   PURE  extractWorkflowCalls / workflowTaskIds — a real Workflow tool_use block with
//         scriptPath .../fan-in-execute.js + args JSON { task } is parsed to its task id
//   PURE  readStartEpoch — A16 start event's recordedAtMs / timing.startedAtMs → dispatch epoch
//   PURE  dispatchRecordEpoch — dispatch-record taskId → ts → epoch
//
// Run:
//   scripts/test.sh plugin/test/fan-in-workflow-check.test.mjs
//   node --test plugin/test/fan-in-workflow-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  parseLockEvents,
  fanInTasksSince,
  extractWorkflowCalls,
  workflowTaskIds,
  checkWorkflowCoverage,
  readStartEpoch,
  parseDispatchRecords,
  dispatchRecordEpoch,
  resolveDispatchEpochs,
  workflowEventsDir,
  classifyAgentId,
  checkAgentIds,
  topLevelSessionStems,
  subagentStems,
  scanWorkflowTaskIds,
  resolveBoundaryEpoch,
  projectSlug,
  defaultProjectDir,
  WORKFLOW_BASENAME,
  ENFORCEMENT_BASELINE_EPOCH,
  parseEscalations,
  escalatedTaskIds,
  checkEscalationTraceability,
} from "../scripts/fan-in-workflow-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "fan-in-workflow-check.ts");

// ── REAL samples (D2 不构造 — captured verbatim from .quay/fan-in-merge-lock-events.jsonl) ──────────
// AC72: agentId is the OUTER main session id (top-level jsonl exists) ⇒ RED
const REAL_AC72_LOCK = { event: "acquire", ts: "2026-08-14T08:25:25Z", epoch: 1786695925, taskId: "gap-ac72-cert-mechanism-retire", pid: 585488, runId: "fm-gap-ac72-cert-mechanism-retire-1786694869696-bzehm1", agentId: "902b4528-bc95-4ec6-9e10-5c2a0c47c4bb" };
// AC73: agentId is the INNER main session id (top-level jsonl exists) ⇒ RED
const REAL_AC73_LOCK = { event: "acquire", ts: "2026-08-14T08:35:38Z", epoch: 1786696538, taskId: "gap-ac73-catalog-rhythm-consumer-check", pid: 646214, runId: "fm-gap-ac73-catalog-rhythm-consumer-check-1786694870124-a09vl0", agentId: "bc1a438b-66f2-4760-8964-91c641166602" };
// AC67: agentId is a REAL subagent (subagents/agent-aab2d14d10a762ff4.jsonl exists) ⇒ GREEN
const REAL_AC67_LOCK = { event: "acquire", ts: "2026-08-14T07:05:40Z", epoch: 1786691140, taskId: "gap-ac67-fan-in-executor-to-task-subagent", pid: 1935235, runId: "fm-gap-ac67-fan-in-executor-to-task-subagent-1786689502118-aab2d14d", agentId: "aab2d14d10a762ff4" };
// AC66: agentId is a REAL subagent (subagents/agent-ab65b5829c1a78501.jsonl exists) ⇒ GREEN
const REAL_AC66_LOCK = { event: "acquire", ts: "2026-08-14T08:53:23Z", epoch: 1786697603, taskId: "gap-ac66-ac-driven-behavior-change-verifiable", pid: 683637, runId: "fm-gap-ac66-ac-driven-behavior-change-verifiable-1786696622424-p8cy2c", agentId: "ab65b5829c1a78501" };
// AC78: the LANDING task — dispatched 08:58 (< boundary 09:20:07) but its ff ran 09:21+ (after).
const REAL_AC78_LOCK = { event: "acquire", ts: "2026-08-14T09:21:21Z", epoch: 1786699281, taskId: "gap-ac78-fan-in-workflow-a6-check", pid: 745532, runId: "fm-gap-ac78-fan-in-workflow-a6-check-1786697920972-3tzt6u", agentId: "ac8d58dd024069d19" };
// AC76: dispatched 08:56:51 (< boundary) but its ff ran 09:35+ (after).
const REAL_AC76_LOCK = { event: "acquire", ts: "2026-08-14T09:35:39Z", epoch: 1786700139, taskId: "gap-ac76-cap-counts-subagents-not-worktrees", pid: 811030, runId: "fm-gap-ac76-cap-counts-subagents-not-worktrees-1786697811832-lonpsr", agentId: "af2f6a3ad3f7073f8" };

// Real A16 --task-start dispatch epochs (from .workflow-events/<runId>.jsonl start events,
// recordedAtMs) and the real boundary (commit d4d225cd added fan-in-execute.js at 09:20:07Z):
const AC78_DISPATCH_EPOCH = 1786697920;   // 2026-08-14T08:58:40Z
const AC76_DISPATCH_EPOCH = 1786697811;   // 2026-08-14T08:56:51Z
const BOUNDARY_EPOCH = 1786699207;        // 2026-08-14T09:20:07Z

// The real project-dir stems these agentIds must resolve against (captured from
// ~/.claude/projects/-home-yale-work-quay on 2026-08-14).
const REAL_TOP_LEVEL_STEMS = [
  "902b4528-bc95-4ec6-9e10-5c2a0c47c4bb",
  "bc1a438b-66f2-4760-8964-91c641166602",
  "65dc5943-107a-4ef5-94d2-4ba5d0d3816c",
];
const REAL_SUBAGENT_STEMS = [
  "aab2d14d10a762ff4",
  "ab65b5829c1a78501",
  // DIR-128 (outer 2026-08-14): a REAL workflow-run subagent — its jsonl lives under
  // <session>/subagents/workflows/wf_7f3eee37-06a/agent-a8ebef25b5253b8cf.jsonl, NOT directly in
  // subagents/. The old non-recursive subagentStems() misclassified it as unresolvable ⇒ false RED.
  "a8ebef25b5253b8cf",
];

// ── PURE parseLockEvents ────────────────────────────────────────────────────────────────────────────

test("PURE parseLockEvents — parses acquire/release lines; skips torn tail", (t) => {
  const text = [
    JSON.stringify(REAL_AC72_LOCK),
    JSON.stringify({ event: "release", ...REAL_AC72_LOCK }),
    '{ "event": "acquire", "taskId": "gap-x", "epoch": ',
  ].join("\n");
  const records = parseLockEvents(text);
  assert.equal(records.length, 2);
  assert.equal(records[0].taskId, "gap-ac72-cert-mechanism-retire");
});

test("PURE parseLockEvents — empty input ⇒ []", (t) => {
  assert.deepEqual(parseLockEvents(""), []);
  assert.deepEqual(parseLockEvents(null), []);
});

// ── PURE fanInTasksSince (⚠️ 时间边界 — the manager over-count 13−1=12 vs 真值 6 lesson) ─────────────

test("PURE fanInTasksSince — pre-boundary acquire events are EXCLUDED (time boundary)", (t) => {
  const records = [
    { event: "acquire", taskId: "gap-pre-boundary", epoch: 1000 },
    { event: "acquire", taskId: "gap-post-boundary", epoch: 5000 },
    { event: "release", taskId: "gap-post-boundary", epoch: 5001 },
    { event: "acquire", taskId: "gap-post-boundary", epoch: 6000 }, // second attempt
  ];
  const { taskIds, events } = fanInTasksSince(records, 4000);
  assert.deepEqual(taskIds, ["gap-post-boundary"]);
  assert.equal(events.length, 2); // both acquire events after the boundary
});

test("PURE fanInTasksSince — no acquire after boundary ⇒ empty (NOT-EVALUATED input)", (t) => {
  const { taskIds } = fanInTasksSince([{ event: "acquire", taskId: "gap-old", epoch: 100 }], 500);
  assert.deepEqual(taskIds, []);
});

// ── PURE dispatch-time anchoring (A16 --task-start epoch / dispatch-record) ──────────────────────────

test("PURE readStartEpoch — A16 start event's recordedAtMs is the dispatch epoch", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-wf-dispatch-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const runId = "fm-gap-ac78-fan-in-workflow-a6-check-1786697920972-3tzt6u";
  fs.writeFileSync(path.join(dir, runId + ".jsonl"), JSON.stringify({
    eventKind: "start",
    taskId: "gap-ac78-fan-in-workflow-a6-check",
    recordedAtMs: 1786697920982,
    timing: { startedAtMs: 1786697920982 },
    commandIdentity: "fast-mode-telemetry:task-start",
  }) + "\n");
  assert.equal(readStartEpoch(dir, runId), AC78_DISPATCH_EPOCH);
});

test("PURE readStartEpoch — timing.startedAtMs fallback; missing file / null runId ⇒ null", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-wf-dispatch-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const runId = "fm-gap-ac76-cap-counts-subagents-not-worktrees-1786697811832-lonpsr";
  fs.writeFileSync(path.join(dir, runId + ".jsonl"), JSON.stringify({
    eventKind: "start",
    recordedAtMs: null,
    timing: { startedAtMs: 1786697811839 },
  }) + "\n");
  assert.equal(readStartEpoch(dir, runId), AC76_DISPATCH_EPOCH);
  assert.equal(readStartEpoch(dir, "does-not-exist"), null);
  assert.equal(readStartEpoch(dir, null), null);
  assert.equal(readStartEpoch(dir, undefined), null);
});

test("PURE dispatchRecordEpoch — dispatch-record taskId → ts → epoch", (t) => {
  const records = parseDispatchRecords(JSON.stringify({ ts: "2026-08-14T08:58:40.752Z", taskId: "gap-ac78-fan-in-workflow-a6-check", reason: "x" }) + "\n" + JSON.stringify({ ts: "2026-08-14T08:56:51.612Z", taskId: "gap-ac76-cap-counts-subagents-not-worktrees" }) + "\n");
  assert.equal(parseDispatchRecords("").length, 0);
  assert.equal(parseDispatchRecords("{ bad").length, 0);
  assert.equal(dispatchRecordEpoch(records, "gap-ac78-fan-in-workflow-a6-check"), AC78_DISPATCH_EPOCH);
  assert.equal(dispatchRecordEpoch(records, "gap-ac76-cap-counts-subagents-not-worktrees"), AC76_DISPATCH_EPOCH);
  assert.equal(dispatchRecordEpoch(records, "gap-unknown"), null);
});

test("PURE resolveDispatchEpochs — workflow-events start wins; dispatch-record is the fallback", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-wf-dispatch-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ac78Run = "fm-gap-ac78-fan-in-workflow-a6-check-1786697920972-3tzt6u";
  fs.writeFileSync(path.join(dir, ac78Run + ".jsonl"), JSON.stringify({ eventKind: "start", recordedAtMs: 1786697920982 }) + "\n");
  const events = [REAL_AC78_LOCK, REAL_AC76_LOCK, REAL_AC72_LOCK];
  const records = parseDispatchRecords(JSON.stringify({ ts: "2026-08-14T08:56:51.612Z", taskId: "gap-ac76-cap-counts-subagents-not-worktrees" }) + "\n");
  // AC78 resolves from workflow-events (runId); AC76 from dispatch-record (no wf-events file);
  // AC72 resolves from nothing ⇒ null (fail-closed).
  const map = resolveDispatchEpochs(["gap-ac78-fan-in-workflow-a6-check", "gap-ac76-cap-counts-subagents-not-worktrees", "gap-ac72-cert-mechanism-retire"], events, dir, records);
  assert.equal(map.get("gap-ac78-fan-in-workflow-a6-check"), AC78_DISPATCH_EPOCH);
  assert.equal(map.get("gap-ac76-cap-counts-subagents-not-worktrees"), AC76_DISPATCH_EPOCH);
  assert.equal(map.get("gap-ac72-cert-mechanism-retire"), null);
});

test("PURE workflowEventsDir — <root>/.workflow-events", (t) => {
  assert.equal(workflowEventsDir("/home/yale/work/quay"), "/home/yale/work/quay/.workflow-events");
});

// ── PURE extractWorkflowCalls / workflowTaskIds ──────────────────────────────────────────────────────

test("PURE extractWorkflowCalls — parses a real Workflow(fan-in-execute) tool_use block to its task id", (t) => {
  const line = JSON.stringify({
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_01test",
          name: "Workflow",
          input: {
            scriptPath: "/home/yale/work/quay/.claude/workflows/fan-in-execute.js",
            args: '{"task":"gap-ac78-fan-in-workflow-a6-check","worktree":"/wt","root":"/root","runId":"fm-1","mergeTarget":"develop"}',
          },
        },
      ],
    },
  });
  const calls = extractWorkflowCalls(line);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].taskId, "gap-ac78-fan-in-workflow-a6-check");
  assert.deepEqual(workflowTaskIds(calls), ["gap-ac78-fan-in-workflow-a6-check"]);
});

test("PURE extractWorkflowCalls — real transcript shape: input.args is an OBJECT, not a JSON string (2026-08-14 bc1a438b)", (t) => {
  // The Workflow tool_use in the real top-level session transcript serializes args as an object.
  // Before the object-form handling, the call's taskId was lost ⇒ the fan-in task was falsely RED.
  const line = JSON.stringify({
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "call_00_ET_pToCUb6DNqtyaYvQrE642009",
          name: "Workflow",
          input: {
            scriptPath: "/home/yale/work/quay/.claude/workflows/fan-in-execute.js",
            args: {
              task: "gap-touches-one-entry-one-path",
              worktree: "/home/yale/work/quay-worktrees/gap-touches-one-entry-one-path",
              root: "/home/yale/work/quay",
              runId: "fm-gap-touches-one-entry-one-path-1786703029102-zih4yp",
              mergeTarget: "develop",
            },
          },
        },
      ],
    },
  });
  const calls = extractWorkflowCalls(line);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].taskId, "gap-touches-one-entry-one-path");
  assert.deepEqual(workflowTaskIds(calls), ["gap-touches-one-entry-one-path"]);
});

test("PURE extractWorkflowCalls — ignores other workflows (manager-tick-core) and non-Workflow blocks", (t) => {
  const lines = [
    JSON.stringify({ message: { content: [{ type: "tool_use", name: "Workflow", input: { scriptPath: "/quay/.claude/workflows/manager-tick-core.js", args: "{}" } }] } }),
    JSON.stringify({ message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] } }),
    JSON.stringify({ message: { content: [{ type: "text", text: "hello" }] } }),
  ].join("\n");
  const calls = extractWorkflowCalls(lines);
  assert.equal(calls.length, 0);
});

test("PURE extractWorkflowCalls — a Workflow block whose args carry no task id contributes nothing", (t) => {
  const line = JSON.stringify({ message: { content: [{ type: "tool_use", name: "Workflow", input: { scriptPath: "/q/.claude/workflows/fan-in-execute.js", args: "{\"runId\":\"x\"}" } }] } });
  const calls = extractWorkflowCalls(line);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].taskId, undefined);
  assert.deepEqual(workflowTaskIds(calls), []);
});

// ── PURE 判据2(a): checkWorkflowCoverage (dispatch-time anchoring) ──────────────────────────────────

test("PURE checkWorkflowCoverage — a fan-in'd task with NO Workflow call AND dispatch >= boundary ⇒ RED (差集非空)", (t) => {
  // AC76/AC78 inverse: dispatched at/after the workflow landed and did NOT call it ⇒ RED.
  const v = checkWorkflowCoverage(
    ["gap-ac72-cert-mechanism-retire"],
    [],
    new Map([["gap-ac72-cert-mechanism-retire", BOUNDARY_EPOCH + 100]]),
    BOUNDARY_EPOCH
  );
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.deepEqual(v.missing, ["gap-ac72-cert-mechanism-retire"]);
  assert.deepEqual(v.preBoundaryDispatch, []);
});

test("PURE checkWorkflowCoverage — a fan-in'd task with NO Workflow call AND UNRESOLVABLE dispatch ⇒ RED (fail-closed)", (t) => {
  // Cannot prove pre-boundary dispatch ⇒ stays in the difference (cannot be exempted).
  const v = checkWorkflowCoverage(["gap-unresolvable"], [], new Map(), BOUNDARY_EPOCH);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.deepEqual(v.missing, ["gap-unresolvable"]);
  assert.deepEqual(v.unresolvableDispatch, ["gap-unresolvable"]);
});

test("PURE checkWorkflowCoverage — every fan-in'd task has a Workflow call ⇒ GREEN", (t) => {
  const v = checkWorkflowCoverage(
    ["gap-ac67-fan-in-executor-to-task-subagent"],
    ["gap-ac67-fan-in-executor-to-task-subagent"],
    new Map([["gap-ac67-fan-in-executor-to-task-subagent", BOUNDARY_EPOCH + 500]]),
    BOUNDARY_EPOCH
  );
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
  assert.deepEqual(v.missing, []);
  assert.deepEqual(v.preBoundaryDispatch, []);
});

test("PURE checkWorkflowCoverage — no fan-in after boundary ⇒ NOT-EVALUATED (never conflated with green)", (t) => {
  const v = checkWorkflowCoverage([], ["gap-ac67-fan-in-executor-to-task-subagent"], new Map(), BOUNDARY_EPOCH);
  assert.equal(v.evaluated, false);
  assert.equal(v.ok, true);
});

test("PURE checkWorkflowCoverage — AC78 dispatch < boundary is exempt (landing subsumed by dispatch time)", (t) => {
  // The LANDING task fan-in'd WITHOUT a Workflow call. It was DISPATCHED at 08:58 (< boundary
  // 09:20:07) — the workflow did not exist at dispatch time, so it could not have dispatched it.
  // Dispatch-time anchoring exempts it (AC67「不判自身」shape, generalized to "couldn't have
  // dispatched the workflow"). Reported separately as preBoundaryDispatch.
  const v = checkWorkflowCoverage(
    ["gap-ac78-fan-in-workflow-a6-check"],
    [],
    new Map([["gap-ac78-fan-in-workflow-a6-check", AC78_DISPATCH_EPOCH]]),
    BOUNDARY_EPOCH
  );
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
  assert.deepEqual(v.missing, []);
  assert.deepEqual(v.preBoundaryDispatch, ["gap-ac78-fan-in-workflow-a6-check"]);
});

test("PURE checkWorkflowCoverage — AC76 dispatch < boundary is exempt (pre-boundary dispatch, same rule)", (t) => {
  // AC76 was dispatched 08:56:51 (< boundary) but its ff ran 09:35+. Same dispatch-time rule as
  // AC78 — ONE rule absorbs both. Not a hardcoded task id; any future pre-boundary dispatch is
  // exempt, and the pre-boundary historical set is FIXED (does not grow with new tasks).
  const v = checkWorkflowCoverage(
    ["gap-ac76-cap-counts-subagents-not-worktrees"],
    [],
    new Map([["gap-ac76-cap-counts-subagents-not-worktrees", AC76_DISPATCH_EPOCH]]),
    BOUNDARY_EPOCH
  );
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
  assert.deepEqual(v.missing, []);
  assert.deepEqual(v.preBoundaryDispatch, ["gap-ac76-cap-counts-subagents-not-worktrees"]);
});

test("PURE checkWorkflowCoverage — AC76 + AC78 BOTH exempt by dispatch time in one fan-in set (GREEN)", (t) => {
  const v = checkWorkflowCoverage(
    ["gap-ac76-cap-counts-subagents-not-worktrees", "gap-ac78-fan-in-workflow-a6-check"],
    [],
    new Map([
      ["gap-ac76-cap-counts-subagents-not-worktrees", AC76_DISPATCH_EPOCH],
      ["gap-ac78-fan-in-workflow-a6-check", AC78_DISPATCH_EPOCH],
    ]),
    BOUNDARY_EPOCH
  );
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
  assert.deepEqual(v.missing, []);
  assert.deepEqual(v.preBoundaryDispatch, ["gap-ac76-cap-counts-subagents-not-worktrees", "gap-ac78-fan-in-workflow-a6-check"]);
});

test("PURE checkWorkflowCoverage — a dispatch >= boundary with no Workflow call sits NEXT TO an exempt task and still REDs", (t) => {
  // The exemption is per-task (dispatch time), not a global "pre-boundary tasks are green" — a
  // post-boundary dispatch in the same fan-in set must still be caught.
  const v = checkWorkflowCoverage(
    ["gap-ac78-fan-in-workflow-a6-check", "gap-post-boundary"],
    [],
    new Map([
      ["gap-ac78-fan-in-workflow-a6-check", AC78_DISPATCH_EPOCH],
      ["gap-post-boundary", BOUNDARY_EPOCH + 100],
    ]),
    BOUNDARY_EPOCH
  );
  assert.equal(v.ok, false);
  assert.deepEqual(v.missing, ["gap-post-boundary"]);
  assert.deepEqual(v.preBoundaryDispatch, ["gap-ac78-fan-in-workflow-a6-check"]);
});

// ── PURE enforcement baseline (outer 2026-08-14 — adoption→enforcement, knownPreBaselineDebt) ────────
// idle-watch: dispatch 1786700361 (09:39:21Z) AFTER the workflow boundary (1786699207) but BEFORE the
// enforcement baseline; no Workflow call ⇒ knownPreBaselineDebt (non-blocking). Post-baseline dispatch
// + no Workflow call ⇒ RED (负控制).

test("PURE checkWorkflowCoverage — idle-watch replay: dispatch after boundary but BEFORE enforcement baseline, no Workflow call ⇒ knownPreBaselineDebt, ok:true", (t) => {
  // The exact case the baseline exists for: gap-idle-watch-intent-anchor-restore was dispatched at
  // 09:39:21Z (after the workflow landed 09:20:07Z) but its dispatch brief was pre-workflow-form.
  // The enforcement baseline (1786701510 = this fix's commit) is AFTER its dispatch ⇒ recorded as
  // known pre-baseline debt, NOT red (ruling: not exempt, not re-run — debt that doesn't block).
  const v = checkWorkflowCoverage(
    ["gap-idle-watch-intent-anchor-restore"],
    [],
    new Map([["gap-idle-watch-intent-anchor-restore", 1786700361]]),
    BOUNDARY_EPOCH,
    ENFORCEMENT_BASELINE_EPOCH
  );
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
  assert.deepEqual(v.missing, []);
  assert.deepEqual(v.knownPreBaselineDebt, ["gap-idle-watch-intent-anchor-restore"]);
});

test("PURE checkWorkflowCoverage — 负控制: a fan-in dispatched AFTER the enforcement baseline with no Workflow call ⇒ RED (post-baseline violation)", (t) => {
  // Enforcement begins at the baseline. A dispatch AT/after the baseline that fails to call the
  // workflow is a fresh violation — it MUST go red (the checker 能取假, adoption→enforcement).
  const v = checkWorkflowCoverage(
    ["gap-post-baseline"],
    [],
    new Map([["gap-post-baseline", ENFORCEMENT_BASELINE_EPOCH + 100]]),
    BOUNDARY_EPOCH,
    ENFORCEMENT_BASELINE_EPOCH
  );
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.deepEqual(v.missing, ["gap-post-baseline"]);
  assert.deepEqual(v.knownPreBaselineDebt, []);
  assert.deepEqual(v.preBoundaryDispatch, []);
});

test("PURE checkWorkflowCoverage — debt and post-baseline violation coexist: debt is recorded non-blocking, the violation still REDs", (t) => {
  // The debt band is per-task; a post-baseline dispatch in the same fan-in set must still be caught.
  const v = checkWorkflowCoverage(
    ["gap-idle-watch-intent-anchor-restore", "gap-post-baseline"],
    [],
    new Map([
      ["gap-idle-watch-intent-anchor-restore", 1786700361],
      ["gap-post-baseline", ENFORCEMENT_BASELINE_EPOCH + 100],
    ]),
    BOUNDARY_EPOCH,
    ENFORCEMENT_BASELINE_EPOCH
  );
  assert.equal(v.ok, false);
  assert.deepEqual(v.missing, ["gap-post-baseline"]);
  assert.deepEqual(v.knownPreBaselineDebt, ["gap-idle-watch-intent-anchor-restore"]);
});

test("PURE checkWorkflowCoverage — a task dispatched before the baseline WITH a Workflow call is not debt (has call)", (t) => {
  const v = checkWorkflowCoverage(
    ["gap-idle-watch-intent-anchor-restore"],
    ["gap-idle-watch-intent-anchor-restore"],
    new Map([["gap-idle-watch-intent-anchor-restore", 1786700361]]),
    BOUNDARY_EPOCH,
    ENFORCEMENT_BASELINE_EPOCH
  );
  assert.equal(v.ok, true);
  assert.deepEqual(v.missing, []);
  assert.deepEqual(v.knownPreBaselineDebt, []);
});

test("PURE checkWorkflowCoverage — default baseline == boundary ⇒ empty debt band (pure pre-baseline behavior)", (t) => {
  // Callers that do NOT pass the baseline (the pre-baseline call shape) keep the old semantics:
  // dispatch >= boundary with no Workflow call is RED (no debt band).
  const v = checkWorkflowCoverage(
    ["gap-post-boundary"],
    [],
    new Map([["gap-post-boundary", BOUNDARY_EPOCH + 100]]),
    BOUNDARY_EPOCH
  );
  assert.equal(v.ok, false);
  assert.deepEqual(v.missing, ["gap-post-boundary"]);
  assert.deepEqual(v.knownPreBaselineDebt, []);
});

// ── PURE 判据2(c): classifyAgentId ──────────────────────────────────────────────────────────────────

test("PURE classifyAgentId — AC72/AC73 (top-level session ids) ⇒ top-level-session (RED)", (t) => {
  assert.equal(classifyAgentId(REAL_AC72_LOCK.agentId, REAL_TOP_LEVEL_STEMS, REAL_SUBAGENT_STEMS), "top-level-session");
  assert.equal(classifyAgentId(REAL_AC73_LOCK.agentId, REAL_TOP_LEVEL_STEMS, REAL_SUBAGENT_STEMS), "top-level-session");
});

test("PURE classifyAgentId — AC67/AC66 (real subagents) ⇒ subagent (GREEN)", (t) => {
  assert.equal(classifyAgentId(REAL_AC67_LOCK.agentId, REAL_TOP_LEVEL_STEMS, REAL_SUBAGENT_STEMS), "subagent");
  assert.equal(classifyAgentId(REAL_AC66_LOCK.agentId, REAL_TOP_LEVEL_STEMS, REAL_SUBAGENT_STEMS), "subagent");
});

test("PURE classifyAgentId — the task-body shorthand prefix also resolves (aab2d14d matches agent-aab2d14d10a762ff4.jsonl)", (t) => {
  assert.equal(classifyAgentId("aab2d14d", REAL_TOP_LEVEL_STEMS, REAL_SUBAGENT_STEMS), "subagent");
  assert.equal(classifyAgentId("902b4528", REAL_TOP_LEVEL_STEMS, REAL_SUBAGENT_STEMS), "top-level-session");
});

test("PURE classifyAgentId — missing and unresolvable are distinct RED kinds", (t) => {
  assert.equal(classifyAgentId(null, REAL_TOP_LEVEL_STEMS, REAL_SUBAGENT_STEMS), "missing");
  assert.equal(classifyAgentId("", REAL_TOP_LEVEL_STEMS, REAL_SUBAGENT_STEMS), "missing");
  assert.equal(classifyAgentId("not-a-real-id", REAL_TOP_LEVEL_STEMS, REAL_SUBAGENT_STEMS), "unresolvable");
});

test("PURE checkAgentIds — AC72/AC73 real lock events ⇒ RED (top-level-session)", (t) => {
  const v = checkAgentIds([REAL_AC72_LOCK, REAL_AC73_LOCK], REAL_TOP_LEVEL_STEMS, REAL_SUBAGENT_STEMS);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.equal(v.violations.length, 2);
  assert.ok(v.violations.every((x) => x.kind === "top-level-session"));
});

test("PURE checkAgentIds — AC67/AC66 real lock events ⇒ GREEN (real subagents)", (t) => {
  const v = checkAgentIds([REAL_AC67_LOCK, REAL_AC66_LOCK], REAL_TOP_LEVEL_STEMS, REAL_SUBAGENT_STEMS);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
  assert.deepEqual(v.violations, []);
});

test("PURE checkAgentIds — no events ⇒ NOT-EVALUATED", (t) => {
  const v = checkAgentIds([], REAL_TOP_LEVEL_STEMS, REAL_SUBAGENT_STEMS);
  assert.equal(v.evaluated, false);
});

// ── PURE d: escalation traceability (gap-ff-livelock-trigger-no-action, SPEC §7 anti-livelock) ─────

test("PURE parseEscalations — parses ff-escalation records; skips torn tail; empty ⇒ []", (t) => {
  const text = [
    JSON.stringify({ event: "ff-escalation", taskId: "gap-ac63-judgment2-no-carrier", attempt: 3, developHead: "04659638f3a7e7cc6cc932dca846a87967db13da", action: "request-quiet-window-and-stop-retry", quietWindow: { requested: true } }),
    JSON.stringify({ event: "ff-escalation", taskId: "gap-ac80-prompt-canonical-and-invariant-checker", attempt: 3 }),
    '{ "event": "ff-escalation", "taskId": "gap-x", "attempt": ',
  ].join("\n");
  const es = parseEscalations(text);
  assert.equal(es.length, 2);
  assert.equal(es[0].taskId, "gap-ac63-judgment2-no-carrier");
  assert.equal(es[0].quietWindow.requested, true);
  assert.deepEqual(parseEscalations(""), []);
  assert.deepEqual(parseEscalations(null), []);
});

test("PURE escalatedTaskIds — unique sorted task ids from escalation records", (t) => {
  const es = parseEscalations([
    JSON.stringify({ event: "ff-escalation", taskId: "gap-b", attempt: 3 }),
    JSON.stringify({ event: "ff-escalation", taskId: "gap-a", attempt: 4 }),
    JSON.stringify({ event: "ff-escalation", taskId: "gap-b", attempt: 5 }),
    JSON.stringify({ event: "ff-escalation" }), // no taskId ⇒ contributes nothing
  ].join("\n"));
  assert.deepEqual(escalatedTaskIds(es), ["gap-a", "gap-b"]);
  assert.deepEqual(escalatedTaskIds([]), []);
});

test("PURE checkEscalationTraceability — every escalated task has a Workflow call ⇒ GREEN", (t) => {
  const v = checkEscalationTraceability(
    ["gap-ac63-judgment2-no-carrier"],
    ["gap-ac63-judgment2-no-carrier"]
  );
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
  assert.deepEqual(v.escalatedWithoutWorkflow, []);
});

test("PURE checkEscalationTraceability — an escalated task with NO Workflow call ⇒ RED (判据2 traceability for the escalation path)", (t) => {
  // The anti-livelock escalation is a fan-in attempt that did NOT land — it must still have gone
  // through the fan-in-execute workflow. A direct (non-workflow) escalation is the AC72/AC73
  // main-thread-executor defect on the escalation path.
  const v = checkEscalationTraceability(
    ["gap-ac63-judgment2-no-carrier"],
    [] // no Workflow(fan-in-execute) call for the escalated task
  );
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.deepEqual(v.escalatedWithoutWorkflow, ["gap-ac63-judgment2-no-carrier"]);
});

test("PURE checkEscalationTraceability — no escalations ⇒ NOT-EVALUATED (never conflated with green)", (t) => {
  const v = checkEscalationTraceability([], ["gap-ac63-judgment2-no-carrier"]);
  assert.equal(v.evaluated, false);
  assert.equal(v.ok, true);
});

test("PURE checkEscalationTraceability — a task WITH a Workflow call but NO escalation is not debt (escalation set is the input)", (t) => {
  const v = checkEscalationTraceability([], ["gap-any"]);
  assert.equal(v.evaluated, false, "no escalation input ⇒ NOT-EVALUATED regardless of workflow calls");
});

// ── projectSlug / defaultProjectDir ─────────────────────────────────────────────────────────────────

test("PURE projectSlug — /home/yale/work/quay → -home-yale-work-quay (the real Claude slug)", (t) => {
  assert.equal(projectSlug("/home/yale/work/quay"), "-home-yale-work-quay");
  const pd = defaultProjectDir("/home/yale/work/quay");
  assert.ok(pd.endsWith(path.join(".claude", "projects", "-home-yale-work-quay")));
});

// ── fs: topLevelSessionStems / subagentStems over a fixture tree ────────────────────────────────────

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function makeProjectDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-wf-check-"));
  // top-level session files + one session dir with subagents
  fs.writeFileSync(path.join(dir, "902b4528-bc95-4ec6-9e10-5c2a0c47c4bb.jsonl"), "{}");
  fs.writeFileSync(path.join(dir, "bc1a438b-66f2-4760-8964-91c641166602.jsonl"), "{}");
  const sess = path.join(dir, "bc1a438b-66f2-4760-8964-91c641166602", "subagents");
  fs.mkdirSync(sess, { recursive: true });
  fs.writeFileSync(path.join(sess, "agent-aab2d14d10a762ff4.jsonl"), "{}");
  fs.writeFileSync(path.join(sess, "agent-ab65b5829c1a78501.jsonl"), "{}");
  // workflow-run subagents land in subagents/workflows/<run>/ (DIR-128 a8ebef25 regression)
  const wfRun = path.join(sess, "workflows", "wf_7f3eee37-06a");
  fs.mkdirSync(wfRun, { recursive: true });
  fs.writeFileSync(path.join(wfRun, "agent-a8ebef25b5253b8cf.jsonl"), "{}");
  return dir;
}

test("fs topLevelSessionStems + subagentStems — resolves the fixture tree", (t) => {
  const dir = makeProjectDir();
  t.after(() => cleanup(dir));
  const top = topLevelSessionStems(dir);
  const subs = subagentStems(dir);
  assert.ok(top.includes("902b4528-bc95-4ec6-9e10-5c2a0c47c4bb"));
  assert.ok(top.includes("bc1a438b-66f2-4760-8964-91c641166602"));
  assert.ok(subs.includes("aab2d14d10a762ff4"));
  assert.ok(subs.includes("ab65b5829c1a78501"));
});

test("fs subagentStems — recurses into subagents/workflows/<run>/ (DIR-128 a8ebef25 regression: workflow-run subagent resolves, not unresolvable)", (t) => {
  const dir = makeProjectDir();
  t.after(() => cleanup(dir));
  const subs = subagentStems(dir);
  // the workflow-run subagent file agent-a8ebef25b5253b8cf.jsonl lives at
  // <session>/subagents/workflows/wf_7f3eee37-06a/ — one level BELOW the old scan depth
  assert.ok(subs.includes("a8ebef25b5253b8cf"), "workflow-run agent stem must be found recursively");
  // and the full classifyAgentId path resolves it to 'subagent' (GREEN) against the fixture stems
  assert.equal(
    classifyAgentId("a8ebef25b5253b8cf", topLevelSessionStems(dir), subs),
    "subagent",
    "workflow-run agentId must classify as subagent, not unresolvable"
  );
});

test("fs scanWorkflowTaskIds — finds a Workflow(fan-in-execute) call in a session file at/after the boundary", (t) => {
  const dir = makeProjectDir();
  t.after(() => cleanup(dir));
  const wfLine = JSON.stringify({
    message: { content: [{ type: "tool_use", name: "Workflow", input: { scriptPath: "/q/.claude/workflows/fan-in-execute.js", args: '{"task":"gap-ac78-fan-in-workflow-a6-check"}' } }] },
  });
  fs.writeFileSync(path.join(dir, "902b4528-bc95-4ec6-9e10-5c2a0c47c4bb.jsonl"), wfLine);
  const now = Math.floor(Date.now() / 1000);
  const ids = scanWorkflowTaskIds(dir, now - 3600); // boundary an hour ago ⇒ the fresh file counts
  assert.ok(ids.includes("gap-ac78-fan-in-workflow-a6-check"));
  // a boundary AFTER the file's mtime excludes it (the time-boundary guard on the scan)
  const later = now + 3600;
  assert.deepEqual(scanWorkflowTaskIds(dir, later), []);
});

test("fs scanWorkflowTaskIds — ignores OTHER workflows (manager-tick-core) even if they carry a task-ish arg", (t) => {
  const dir = makeProjectDir();
  t.after(() => cleanup(dir));
  const wfLine = JSON.stringify({
    message: { content: [{ type: "tool_use", name: "Workflow", input: { scriptPath: "/q/.claude/workflows/manager-tick-core.js", args: '{"task":"gap-ac78-fan-in-workflow-a6-check"}' } }] },
  });
  fs.writeFileSync(path.join(dir, "65dc5943-107a-4ef5-94d2-4ba5d0d3816c.jsonl"), wfLine);
  assert.deepEqual(scanWorkflowTaskIds(dir, Math.floor(Date.now() / 1000) - 3600), []);
});

// ── resolveBoundaryEpoch ────────────────────────────────────────────────────────────────────────────

test("resolveBoundaryEpoch — explicit ISO ts is honored", (t) => {
  const epoch = resolveBoundaryEpoch(REPO_ROOT, "2026-08-14T00:00:00Z");
  assert.equal(epoch, Math.floor(Date.parse("2026-08-14T00:00:00Z") / 1000));
});

test("resolveBoundaryEpoch — git path anchors on the ADDITION commit, not the latest edit (diff-filter=A)", (t) => {
  // Regression (outer 2026-08-14): `git log -1` returned the LATEST commit touching
  // .claude/workflows/fan-in-execute.js (5e54bb37 @ 10:48:53Z = 1786704533), so the boundary
  // shifted forward whenever the file was edited, pushing touches-one-entry (ff 10:47:47)
  // out of scope ⇒ NOT-EVALUATED. --diff-filter=A pins the boundary to the commit that ADDED
  // the file (d4d225cd @ 09:20:07Z = 1786699207), stable across later edits.
  const epoch = resolveBoundaryEpoch(REPO_ROOT); // no landedTs, default ref HEAD
  assert.equal(epoch, BOUNDARY_EPOCH); // 1786699207 = d4d225cd @ 09:20:07Z (the addition)
  assert.notEqual(epoch, 1786704533); // 5e54bb37 @ 10:48:53Z (a LATER edit, old buggy boundary)
});

// ── CLI integration (hermetic fixture) ───────────────────────────────────────────────────────────────

/** A hermetic root: project-dir + workflow-events-dir + dispatch-record live in a tmp dir, so the
 *  CLI never touches the real ~/.claude/projects or repo .workflow-events. */
function makeFixture() {
  const dir = makeProjectDir();
  const wfEvents = path.join(dir, ".workflow-events");
  fs.mkdirSync(wfEvents, { recursive: true });
  const dispatchRecord = path.join(dir, "dispatch-record.jsonl");
  return { dir, wfEvents, dispatchRecord };
}

test("CLI — NOT-EVALUATED when the workflow has not landed (no boundary resolves, no lock events after)", (t) => {
  const fx = makeFixture();
  t.after(() => cleanup(fx.dir));
  const lockFile = path.join(fx.dir, "lock.jsonl");
  fs.writeFileSync(lockFile, JSON.stringify({ event: "acquire", taskId: "gap-old", epoch: 1, agentId: "x" }) + "\n");
  const res = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", REPO_ROOT, "--lock-events", lockFile, "--project-dir", fx.dir, "--workflow-events-dir", fx.wfEvents, "--dispatch-record", fx.dispatchRecord, "--workflow-landed-ts", "2099-01-01T00:00:00Z", "--json"], { encoding: "utf8" });
  assert.equal(res.status, 0);
  const out = JSON.parse(res.stdout);
  assert.equal(out.evaluated, false);
  assert.equal(out.ok, true);
  assert.match(out.reason, /NOT-EVALUATED/);
});

test("CLI — RED when a fan-in after the boundary has no Workflow call and a top-level agentId (AC72 replay)", (t) => {
  const fx = makeFixture();
  t.after(() => cleanup(fx.dir));
  const lockFile = path.join(fx.dir, "lock.jsonl");
  const ev = { event: "acquire", taskId: "gap-ac72-cert-mechanism-retire", epoch: 2000000000, agentId: "902b4528-bc95-4ec6-9e10-5c2a0c47c4bb" };
  fs.writeFileSync(lockFile, JSON.stringify(ev) + "\n");
  const res = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", REPO_ROOT, "--lock-events", lockFile, "--project-dir", fx.dir, "--workflow-events-dir", fx.wfEvents, "--dispatch-record", fx.dispatchRecord, "--workflow-landed-ts", "2026-08-14T00:00:00Z", "--json"], { encoding: "utf8" });
  assert.equal(res.status, 1);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, false);
  const a = out.checks.find((c) => c.check === "a-workflow-call-coverage");
  assert.ok(a.ok === false);
  assert.deepEqual(a.missing, ["gap-ac72-cert-mechanism-retire"]);
  const c = out.checks.find((x) => x.check === "c-agent-id-real-subagent");
  assert.ok(c.ok === false);
});

test("CLI — GREEN when the fan-in has a Workflow call AND a real subagent agentId (AC67 replay)", (t) => {
  const fx = makeFixture();
  t.after(() => cleanup(fx.dir));
  const lockFile = path.join(fx.dir, "lock.jsonl");
  const ev = { event: "acquire", taskId: "gap-ac67-fan-in-executor-to-task-subagent", epoch: 2000000000, agentId: "aab2d14d10a762ff4" };
  fs.writeFileSync(lockFile, JSON.stringify(ev) + "\n");
  const wfFile = path.join(fx.dir, "65dc5943-107a-4ef5-94d2-4ba5d0d3816c.jsonl");
  fs.writeFileSync(wfFile, JSON.stringify({ message: { content: [{ type: "tool_use", name: "Workflow", input: { scriptPath: "/q/.claude/workflows/fan-in-execute.js", args: '{"task":"gap-ac67-fan-in-executor-to-task-subagent"}' } }] } }) + "\n");
  const res = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", REPO_ROOT, "--lock-events", lockFile, "--project-dir", fx.dir, "--workflow-events-dir", fx.wfEvents, "--dispatch-record", fx.dispatchRecord, "--workflow-landed-ts", "2026-08-14T00:00:00Z", "--json"], { encoding: "utf8" });
  assert.equal(res.status, 0);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.evaluated, true);
});

test("CLI — GREEN when fan-in tasks were dispatched before the boundary (AC76 + AC78 replay, dispatch-time anchoring)", (t) => {
  const fx = makeFixture();
  t.after(() => cleanup(fx.dir));
  const lockFile = path.join(fx.dir, "lock.jsonl");
  fs.writeFileSync(lockFile, JSON.stringify(REAL_AC78_LOCK) + "\n" + JSON.stringify(REAL_AC76_LOCK) + "\n");
  // A16 --task-start files: the DISPATCH instant (both < boundary 1786699207), the ff runs were after.
  fs.writeFileSync(path.join(fx.wfEvents, REAL_AC78_LOCK.runId + ".jsonl"), JSON.stringify({ eventKind: "start", recordedAtMs: 1786697920982, timing: { startedAtMs: 1786697920982 } }) + "\n");
  fs.writeFileSync(path.join(fx.wfEvents, REAL_AC76_LOCK.runId + ".jsonl"), JSON.stringify({ eventKind: "start", recordedAtMs: 1786697811839, timing: { startedAtMs: 1786697811839 } }) + "\n");
  // Real subagent files so 判据2(c) is green too (the test targets (a) dispatch anchoring).
  fs.mkdirSync(path.join(fx.dir, "subagents"), { recursive: true });
  fs.writeFileSync(path.join(fx.dir, "subagents", "agent-" + REAL_AC78_LOCK.agentId + ".jsonl"), "{}");
  fs.writeFileSync(path.join(fx.dir, "subagents", "agent-" + REAL_AC76_LOCK.agentId + ".jsonl"), "{}");
  const res = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", REPO_ROOT, "--lock-events", lockFile, "--project-dir", fx.dir, "--workflow-events-dir", fx.wfEvents, "--dispatch-record", fx.dispatchRecord, "--workflow-landed-ts", "2026-08-14T09:20:07Z", "--json"], { encoding: "utf8" });
  assert.equal(res.status, 0);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.evaluated, true);
  const a = out.checks.find((c) => c.check === "a-workflow-call-coverage");
  assert.equal(a.ok, true);
  assert.deepEqual(a.preBoundaryDispatch, ["gap-ac76-cap-counts-subagents-not-worktrees", "gap-ac78-fan-in-workflow-a6-check"]);
  assert.deepEqual(a.missing, []);
});

test("CLI — RED when a fan-in task was dispatched AFTER the boundary with no Workflow call (negative control)", (t) => {
  const fx = makeFixture();
  t.after(() => cleanup(fx.dir));
  const lockFile = path.join(fx.dir, "lock.jsonl");
  const ev = { event: "acquire", taskId: "gap-post-boundary", epoch: 2000000000, runId: "fm-gap-post-boundary-2000000000-r1", agentId: "aab2d14d10a762ff4" };
  fs.writeFileSync(lockFile, JSON.stringify(ev) + "\n");
  // Dispatch AFTER the boundary (workflow exists ⇒ it COULD have dispatched it) — no Workflow call.
  fs.writeFileSync(path.join(fx.wfEvents, "fm-gap-post-boundary-2000000000-r1.jsonl"), JSON.stringify({ eventKind: "start", recordedAtMs: 1999999999000 }) + "\n");
  const res = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", REPO_ROOT, "--lock-events", lockFile, "--project-dir", fx.dir, "--workflow-events-dir", fx.wfEvents, "--dispatch-record", fx.dispatchRecord, "--workflow-landed-ts", "2026-08-14T09:20:07Z", "--json"], { encoding: "utf8" });
  assert.equal(res.status, 1);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, false);
  const a = out.checks.find((c) => c.check === "a-workflow-call-coverage");
  assert.equal(a.ok, false);
  assert.deepEqual(a.missing, ["gap-post-boundary"]);
  assert.deepEqual(a.preBoundaryDispatch, []);
});

test("CLI — idle-watch replay: dispatch before the enforcement baseline with no Workflow call ⇒ exit 0, knownPreBaselineDebt recorded", (t) => {
  const fx = makeFixture();
  t.after(() => cleanup(fx.dir));
  const lockFile = path.join(fx.dir, "lock.jsonl");
  // The real idle-watch fan-in: acquire 2026-08-14T09:53:41Z (epoch 1786701221), runId carries the
  // dispatch instant. agentId a03a00dc0b3e4768c → we create its subagent file so 判据2(c) is green
  // (this test targets (a) debt classification).
  const ev = { event: "acquire", taskId: "gap-idle-watch-intent-anchor-restore", epoch: 1786701221, runId: "fm-gap-idle-watch-intent-anchor-restore-1786700361087-baco2m", agentId: "a03a00dc0b3e4768c" };
  fs.writeFileSync(lockFile, JSON.stringify(ev) + "\n");
  // Dispatch 2026-08-14T09:39:21Z (epoch 1786700361) — AFTER the workflow landed (09:20:07Z) but
  // BEFORE the enforcement baseline (--enforcement-baseline-ts 09:55:00Z) ⇒ known pre-baseline debt.
  fs.writeFileSync(path.join(fx.wfEvents, ev.runId + ".jsonl"), JSON.stringify({ eventKind: "start", recordedAtMs: 1786700361087, timing: { startedAtMs: 1786700361087 } }) + "\n");
  fs.mkdirSync(path.join(fx.dir, "subagents"), { recursive: true });
  fs.writeFileSync(path.join(fx.dir, "subagents", "agent-" + ev.agentId + ".jsonl"), "{}");
  const res = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", REPO_ROOT, "--lock-events", lockFile, "--project-dir", fx.dir, "--workflow-events-dir", fx.wfEvents, "--dispatch-record", fx.dispatchRecord, "--workflow-landed-ts", "2026-08-14T09:20:07Z", "--enforcement-baseline-ts", "2026-08-14T09:55:00Z", "--json"], { encoding: "utf8" });
  assert.equal(res.status, 0);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.evaluated, true);
  const a = out.checks.find((c) => c.check === "a-workflow-call-coverage");
  assert.equal(a.ok, true);
  assert.deepEqual(a.knownPreBaselineDebt, ["gap-idle-watch-intent-anchor-restore"]);
  assert.deepEqual(a.missing, []);
});

test("CLI — 负控制: a fan-in dispatched AFTER the enforcement baseline with no Workflow call ⇒ exit 1 (RED)", (t) => {
  const fx = makeFixture();
  t.after(() => cleanup(fx.dir));
  const lockFile = path.join(fx.dir, "lock.jsonl");
  const ev = { event: "acquire", taskId: "gap-post-baseline", epoch: 2000000000, runId: "fm-gap-post-baseline-2000000000-r1", agentId: "aab2d14d10a762ff4" };
  fs.writeFileSync(lockFile, JSON.stringify(ev) + "\n");
  // Dispatch AFTER the enforcement baseline (09:55:00Z) — enforcement is live, the workflow EXISTS,
  // it could have been dispatched ⇒ no Workflow call is a fresh violation (RED), NOT debt.
  fs.writeFileSync(path.join(fx.wfEvents, ev.runId + ".jsonl"), JSON.stringify({ eventKind: "start", recordedAtMs: 2000000000000 }) + "\n");
  const res = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", REPO_ROOT, "--lock-events", lockFile, "--project-dir", fx.dir, "--workflow-events-dir", fx.wfEvents, "--dispatch-record", fx.dispatchRecord, "--workflow-landed-ts", "2026-08-14T09:20:07Z", "--enforcement-baseline-ts", "2026-08-14T09:55:00Z", "--json"], { encoding: "utf8" });
  assert.equal(res.status, 1);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, false);
  const a = out.checks.find((c) => c.check === "a-workflow-call-coverage");
  assert.equal(a.ok, false);
  assert.deepEqual(a.missing, ["gap-post-baseline"]);
  assert.deepEqual(a.knownPreBaselineDebt, []);
  assert.deepEqual(a.preBoundaryDispatch, []);
});

// ── CLI d: escalation traceability (SPEC §7 anti-livelock, gap-ff-livelock-trigger-no-action) ───────

test("CLI — escalation traceability: an escalated task WITH a Workflow call ⇒ exit 0 (GREEN)", (t) => {
  const fx = makeFixture();
  t.after(() => cleanup(fx.dir));
  const lockFile = path.join(fx.dir, "lock.jsonl");
  const ev = { event: "acquire", taskId: "gap-ac63-judgment2-no-carrier", epoch: 2000000000, agentId: "aab2d14d10a762ff4" };
  fs.writeFileSync(lockFile, JSON.stringify(ev) + "\n");
  // The escalated task went through the fan-in-execute workflow (判据2 traceability).
  const wfFile = path.join(fx.dir, "65dc5943-107a-4ef5-94d2-4ba5d0d3816c.jsonl");
  fs.writeFileSync(wfFile, JSON.stringify({ message: { content: [{ type: "tool_use", name: "Workflow", input: { scriptPath: "/q/.claude/workflows/fan-in-execute.js", args: '{"task":"gap-ac63-judgment2-no-carrier"}' } }] } }) + "\n");
  // The escalation record (as written by fan-in-ff-merge.sh on attempt >= 3).
  const escFile = path.join(fx.dir, "escalations.jsonl");
  fs.writeFileSync(escFile, JSON.stringify({ event: "ff-escalation", taskId: "gap-ac63-judgment2-no-carrier", attempt: 3, action: "request-quiet-window-and-stop-retry", quietWindow: { requested: true } }) + "\n");
  // real subagent file so 判据2(c) is green too.
  fs.mkdirSync(path.join(fx.dir, "subagents"), { recursive: true });
  fs.writeFileSync(path.join(fx.dir, "subagents", "agent-aab2d14d10a762ff4.jsonl"), "{}");
  const res = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", REPO_ROOT, "--lock-events", lockFile, "--project-dir", fx.dir, "--workflow-events-dir", fx.wfEvents, "--dispatch-record", fx.dispatchRecord, "--escalations", escFile, "--workflow-landed-ts", "2026-08-14T09:20:07Z", "--json"], { encoding: "utf8" });
  assert.equal(res.status, 0);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.evaluated, true);
  const d = out.checks.find((c) => c.check === "d-escalation-traceability");
  assert.equal(d.ok, true);
  assert.equal(d.evaluated, true);
  assert.deepEqual(d.escalatedWithoutWorkflow, []);
});

test("CLI — escalation traceability: an escalated task with NO Workflow call ⇒ exit 1 (RED)", (t) => {
  const fx = makeFixture();
  t.after(() => cleanup(fx.dir));
  const lockFile = path.join(fx.dir, "lock.jsonl");
  const ev = { event: "acquire", taskId: "gap-ac63-judgment2-no-carrier", epoch: 2000000000, agentId: "aab2d14d10a762ff4" };
  fs.writeFileSync(lockFile, JSON.stringify(ev) + "\n");
  // The escalation record exists, but there is NO Workflow(fan-in-execute) call — the escalation
  // path did NOT go through the workflow (a main-session-direct escalation would be the AC72/AC73
  // defect). 判据2 traceability for the escalation path ⇒ RED.
  const escFile = path.join(fx.dir, "escalations.jsonl");
  fs.writeFileSync(escFile, JSON.stringify({ event: "ff-escalation", taskId: "gap-ac63-judgment2-no-carrier", attempt: 3, action: "request-quiet-window-and-stop-retry" }) + "\n");
  fs.mkdirSync(path.join(fx.dir, "subagents"), { recursive: true });
  fs.writeFileSync(path.join(fx.dir, "subagents", "agent-aab2d14d10a762ff4.jsonl"), "{}");
  const res = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", REPO_ROOT, "--lock-events", lockFile, "--project-dir", fx.dir, "--workflow-events-dir", fx.wfEvents, "--dispatch-record", fx.dispatchRecord, "--escalations", escFile, "--workflow-landed-ts", "2026-08-14T09:20:07Z", "--json"], { encoding: "utf8" });
  assert.equal(res.status, 1);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, false);
  const d = out.checks.find((c) => c.check === "d-escalation-traceability");
  assert.equal(d.ok, false);
  assert.deepEqual(d.escalatedWithoutWorkflow, ["gap-ac63-judgment2-no-carrier"]);
});

test("CLI — no escalation records ⇒ the escalation check is NOT-EVALUATED, not green (硬规则 3b)", (t) => {
  const fx = makeFixture();
  t.after(() => cleanup(fx.dir));
  const lockFile = path.join(fx.dir, "lock.jsonl");
  const ev = { event: "acquire", taskId: "gap-ac67-fan-in-executor-to-task-subagent", epoch: 2000000000, agentId: "aab2d14d10a762ff4" };
  fs.writeFileSync(lockFile, JSON.stringify(ev) + "\n");
  const wfFile = path.join(fx.dir, "65dc5943-107a-4ef5-94d2-4ba5d0d3816c.jsonl");
  fs.writeFileSync(wfFile, JSON.stringify({ message: { content: [{ type: "tool_use", name: "Workflow", input: { scriptPath: "/q/.claude/workflows/fan-in-execute.js", args: '{"task":"gap-ac67-fan-in-executor-to-task-subagent"}' } }] } }) + "\n");
  fs.mkdirSync(path.join(fx.dir, "subagents"), { recursive: true });
  fs.writeFileSync(path.join(fx.dir, "subagents", "agent-aab2d14d10a762ff4.jsonl"), "{}");
  const escFile = path.join(fx.dir, "escalations.jsonl"); // does not exist / empty
  const res = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", REPO_ROOT, "--lock-events", lockFile, "--project-dir", fx.dir, "--workflow-events-dir", fx.wfEvents, "--dispatch-record", fx.dispatchRecord, "--escalations", escFile, "--workflow-landed-ts", "2026-08-14T09:20:07Z", "--json"], { encoding: "utf8" });
  assert.equal(res.status, 0);
  const out = JSON.parse(res.stdout);
  const d = out.checks.find((c) => c.check === "d-escalation-traceability");
  assert.equal(d.ok, true);
  assert.equal(d.evaluated, false, "no escalation records ⇒ NOT-EVALUATED, never conflated with green");
  assert.match(d.reason, /NOT-EVALUATED/);
});
