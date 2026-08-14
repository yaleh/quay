// @test-group serial
// fan-in-workflow-check.test.mjs — AC78 判据2 (a)(b)(c) checker tests,
// plugin/scripts/fan-in-workflow-check.ts. The negative-control fixtures prove the checker can go RED
// on the three AC78 defects (判据能取假) plus NOT-EVALUATED (never conflated with green, 硬规则 3b).
//
//   RED   checkWorkflowCoverage — a fan-in'd task with NO Workflow call (差集非空 ⇒ 红)
//   RED   checkAgentIds — agentId resolving to a TOP-LEVEL session id (AC72 902b4528 / AC73
//         bc1a438b — real samples, top-level <project>/<id>.jsonl exists)
//   RED   checkAgentIds — agentId missing (fan-in-ff-merge.sh called WITHOUT --agent-id = main-thread)
//   RED   checkAgentIds — agentId unresolvable (neither top-level nor subagents file)
//   GREEN checkAgentIds — agentId resolving to a subagents/agent-<id>.jsonl
//         (AC67 aab2d14d10a762ff4 / AC66 ab65b5829c1a78501 — real samples)
//   GREEN checkWorkflowCoverage — every fan-in'd task has a Workflow call
//   NOT-EVALUATED — no fan-in after the time boundary (the ⚠️ 时间边界 guard: pre-workflow fan-in
//         must NOT be swept into the difference)
//   PURE  fanInTasksSince — pre-boundary acquire events are excluded
//   PURE  extractWorkflowCalls / workflowTaskIds — a real Workflow tool_use block with
//         scriptPath .../fan-in-execute.js + args JSON { task } is parsed to its task id
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
  landingTaskIds,
  landingExemption,
  isLandingTouch,
  LANDING_TASK_ID,
  classifyAgentId,
  checkAgentIds,
  topLevelSessionStems,
  subagentStems,
  scanWorkflowTaskIds,
  resolveBoundaryEpoch,
  projectSlug,
  defaultProjectDir,
  WORKFLOW_BASENAME,
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

// ── PURE 判据2(a): checkWorkflowCoverage ────────────────────────────────────────────────────────────

test("PURE checkWorkflowCoverage — a fan-in'd task WITHOUT a Workflow call ⇒ RED (差集非空)", (t) => {
  const v = checkWorkflowCoverage(["gap-ac72-cert-mechanism-retire"], []);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.deepEqual(v.missing, ["gap-ac72-cert-mechanism-retire"]);
});

test("PURE checkWorkflowCoverage — every fan-in'd task has a Workflow call ⇒ GREEN", (t) => {
  const v = checkWorkflowCoverage(["gap-ac67-fan-in-executor-to-task-subagent"], ["gap-ac67-fan-in-executor-to-task-subagent"]);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
  assert.deepEqual(v.missing, []);
});

test("PURE checkWorkflowCoverage — no fan-in after boundary ⇒ NOT-EVALUATED (never conflated with green)", (t) => {
  const v = checkWorkflowCoverage([], ["gap-ac67-fan-in-executor-to-task-subagent"]);
  assert.equal(v.evaluated, false);
  assert.equal(v.ok, true);
});

test("PURE checkWorkflowCoverage — the LANDING task (exempt) is not in the difference (AC67 不判自身), its id is reported separately", (t) => {
  // The landing task fan-in'd WITHOUT a Workflow call (it could not dispatch the workflow during
  // its own landing). Exempting it must NOT redden (a); it is reported as landingExempt.
  const v = checkWorkflowCoverage(["gap-ac78-fan-in-workflow-a6-check"], [], ["gap-ac78-fan-in-workflow-a6-check"]);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
  assert.deepEqual(v.missing, []);
  assert.deepEqual(v.landingExempt, ["gap-ac78-fan-in-workflow-a6-check"]);
});

test("PURE landingTaskIds — a task whose Touches carry fan-in-execute.js is detected as the landing task", (t) => {
  const entries = [
    { id: "gap-ac78-fan-in-workflow-a6-check", touches: [".claude/workflows/fan-in-execute.js", "plugin/loop/fast-mode-tick-core.md"] },
    { id: "gap-other", touches: ["plugin/scripts/fan-in-ff-merge.sh"] },
  ];
  assert.deepEqual(landingTaskIds(entries), ["gap-ac78-fan-in-workflow-a6-check"]);
});

test("PURE landingTaskIds — the plugin/workflows mirror also counts as landing the workflow", (t) => {
  const entries = [
    { id: "gap-ac78-fan-in-workflow-a6-check", touches: ["plugin/workflows/fan-in-execute.js"] },
  ];
  assert.deepEqual(landingTaskIds(entries), ["gap-ac78-fan-in-workflow-a6-check"]);
});

test("PURE landingTaskIds GUARD (negative control) — a Touches-match with NON-landing id is NOT exempted (stays in the difference)", (t) => {
  // The exemption is the BOUNDED landing constant, NOT a scan of current Touches. A future task
  // that touches fan-in-execute.js CAN and SHOULD dispatch the workflow in its own fan-in — the
  // "workflow didn't exist yet" reason holds only for the landing event itself. So a Touches-match
  // with id != LANDING_TASK_ID must stay in 判据2(a)'s difference.
  const entries = [{ id: "gap-future-task", touches: [".claude/workflows/fan-in-execute.js"] }];
  // The exempt set is the constant, not the Touches-matching id:
  assert.deepEqual(landingTaskIds(entries), [LANDING_TASK_ID]);
  assert.notEqual(LANDING_TASK_ID, "gap-future-task");
  // isLandingTouch still classifies the path as the landing path (the guard is about the ID, not
  // the path):
  assert.equal(isLandingTouch(".claude/workflows/fan-in-execute.js"), true);
  // Feeding the guarded exempt set into 判据2(a): the non-landing Touches-match is NOT exempted —
  // it is in `missing` (the difference) and absent from `landingExempt`.
  const v = checkWorkflowCoverage(["gap-future-task"], [], landingTaskIds(entries));
  assert.equal(v.ok, false);                             // RED — not exempted
  assert.equal(v.evaluated, true);
  assert.deepEqual(v.missing, ["gap-future-task"]);      // stays in the (a) difference
  assert.deepEqual(v.landingExempt, []);                 // NOT reported as exempt
});

test("PURE landingExemption — reports the current Touches-match set for observability WITHOUT widening the exemption", (t) => {
  const entries = [
    { id: LANDING_TASK_ID, touches: [".claude/workflows/fan-in-execute.js"] },
    { id: "gap-future-task", touches: [".claude/workflows/fan-in-execute.js"] },
  ];
  const { exempt, touchesMatch } = landingExemption(entries);
  // exempt is the bounded constant — the future task is NOT added even though its Touches match:
  assert.deepEqual(exempt, [LANDING_TASK_ID]);
  // touchesMatch carries BOTH ids for observability (so a run can warn about the rogue match):
  assert.deepEqual(touchesMatch, ["gap-ac78-fan-in-workflow-a6-check", "gap-future-task"]);
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

// ── CLI integration (hermetic fixture; NOT-EVALUATED when the workflow has not landed) ───────────────

test("CLI — NOT-EVALUATED when the workflow has not landed (no boundary resolves, no lock events after)", (t) => {
  const dir = makeProjectDir();
  t.after(() => cleanup(dir));
  const lockFile = path.join(dir, "lock.jsonl");
  fs.writeFileSync(lockFile, JSON.stringify({ event: "acquire", taskId: "gap-old", epoch: 1, agentId: "x" }) + "\n");
  const res = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", REPO_ROOT, "--lock-events", lockFile, "--project-dir", dir, "--workflow-landed-ts", "2099-01-01T00:00:00Z", "--json"], { encoding: "utf8" });
  assert.equal(res.status, 0);
  const out = JSON.parse(res.stdout);
  assert.equal(out.evaluated, false);
  assert.equal(out.ok, true);
  assert.match(out.reason, /NOT-EVALUATED/);
});

test("CLI — RED when a fan-in after the boundary has no Workflow call and a top-level agentId (AC72 replay)", (t) => {
  const dir = makeProjectDir();
  t.after(() => cleanup(dir));
  const lockFile = path.join(dir, "lock.jsonl");
  const ev = { event: "acquire", taskId: "gap-ac72-cert-mechanism-retire", epoch: 2000000000, agentId: "902b4528-bc95-4ec6-9e10-5c2a0c47c4bb" };
  fs.writeFileSync(lockFile, JSON.stringify(ev) + "\n");
  const res = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", REPO_ROOT, "--lock-events", lockFile, "--project-dir", dir, "--workflow-landed-ts", "2026-08-14T00:00:00Z", "--json"], { encoding: "utf8" });
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
  const dir = makeProjectDir();
  t.after(() => cleanup(dir));
  const lockFile = path.join(dir, "lock.jsonl");
  const ev = { event: "acquire", taskId: "gap-ac67-fan-in-executor-to-task-subagent", epoch: 2000000000, agentId: "aab2d14d10a762ff4" };
  fs.writeFileSync(lockFile, JSON.stringify(ev) + "\n");
  const wfFile = path.join(dir, "65dc5943-107a-4ef5-94d2-4ba5d0d3816c.jsonl");
  fs.writeFileSync(wfFile, JSON.stringify({ message: { content: [{ type: "tool_use", name: "Workflow", input: { scriptPath: "/q/.claude/workflows/fan-in-execute.js", args: '{"task":"gap-ac67-fan-in-executor-to-task-subagent"}' } }] } }) + "\n");
  const res = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", REPO_ROOT, "--lock-events", lockFile, "--project-dir", dir, "--workflow-landed-ts", "2026-08-14T00:00:00Z", "--json"], { encoding: "utf8" });
  assert.equal(res.status, 0);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.evaluated, true);
});
