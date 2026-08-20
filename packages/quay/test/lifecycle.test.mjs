// @test-group product
// QENG-3 — complete/adjudicate/promote/retreat lifecycle.
//
// Layered per docs/plans/10-quay-lifecycle.md:
//   Phase A — pure module (lifecycle.js) via direct import + a stub client and a
//             tmp logPath (mirrors gate.test.mjs's Phase A stub-client style).
//             This is where the >=80% coverage lands.
//   Phase C — the real CLI (`node bin/quay.js complete|adjudicate|promote|retreat`)
//             driven against a disposable native-provider workspace whose
//             .quay/config.yml is the provider MAP form WITH mcp_entry (mirrors
//             gap-cli-gate-enforcement.test.mjs's makeWorkspace() exactly — a
//             config missing mcp_entry crashes withProvider).
//
// Run: node --test --experimental-test-coverage packages/quay/test/lifecycle.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import {
  TRANSITIONS,
  legalForward,
  legalBack,
  assertTransition,
  runComplete,
  runCompleteLoop,
  runAdjudicate,
  runPromote,
  runRetreat,
  RETREATED_MARKER_RE,
} from "../src/gate/lifecycle.ts";
import { queryGateEvents } from "../src/gate/gate-event-store.ts";
import { isRetreated } from "../../../plugin/scripts/ready-pool-check.ts";
import { makeTmpDir, makeTmpWorkspace } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quayBin = QUAY_CLI;
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

// ---------------------------------------------------------------------------
// Phase A harness — stub client + tmp logPath (plan §"Unit-test harness")
// ---------------------------------------------------------------------------

function stubClient(task) {
  const state = { ...task };
  return {
    async taskGet() {
      return { ...state };
    },
    // taskCheck: ready => fail (stub), anything else => pass (matches plan's stub).
    async taskCheck() {
      return { ok: state.status === "ready" ? false : true, reason: "stub" };
    },
    async taskWrite({ status, expectedStatus, body }) {
      if (expectedStatus && state.status !== expectedStatus) throw new Error("ConflictError");
      state.status = status;
      // Preserve body writes so tests can assert the marker/uncheck landed on the stored task
      // (existing tests pass no body — a bodyless stub stays bodyless).
      if (body !== undefined) state.body = body;
      return { ...state };
    },
    _state: state,
  };
}

function tmpLog(tag) {
  return path.join(makeTmpDir(`quay-qeng3-${tag}-`), "gate-events.jsonl");
}

// process.exitCode is a shared global; each run* fn sets it. Reset around each
// unit test so an earlier fail-path doesn't leak into a later assertion.
function resetExit() {
  process.exitCode = 0;
}

// ===========================================================================
// Phase A / Stage A1 — transition table + pure helpers
// ===========================================================================

test("A1: TRANSITIONS models todo→ready, ready↔todo/done, done→ready, needs-human→todo retreat, superseded hard-terminal", () => {
  assert.equal(TRANSITIONS.todo.forward, "ready");
  assert.equal(TRANSITIONS.todo.back, null);
  assert.equal(TRANSITIONS.ready.forward, "done");
  assert.equal(TRANSITIONS.ready.back, "todo");
  assert.equal(TRANSITIONS.done.forward, null);
  assert.equal(TRANSITIONS.done.back, "ready");
  assert.equal(TRANSITIONS["needs-human"].forward, null);
  assert.equal(TRANSITIONS["needs-human"].back, "todo");
  // superseded is a hard terminal: no forward, no back (outer ruling 2026-08-12)
  assert.equal(TRANSITIONS.superseded.forward, null);
  assert.equal(TRANSITIONS.superseded.back, null);
});

test("A1: legalForward / legalBack return the edge or null (incl. unknown status)", () => {
  assert.equal(legalForward("todo"), "ready");
  assert.equal(legalForward("done"), null);
  assert.equal(legalBack("ready"), "todo");
  assert.equal(legalBack("todo"), null);
  assert.equal(legalBack("needs-human"), "todo");
  assert.equal(legalForward("superseded"), null, "superseded has no forward edge");
  assert.equal(legalBack("superseded"), null, "superseded has no back edge (hard terminal)");
  assert.equal(legalForward("bogus"), null);
  assert.equal(legalBack("bogus"), null);
});

test("A1: assertTransition throws on every null edge and is silent on legal edges", () => {
  // legal edges: no throw
  assert.doesNotThrow(() => assertTransition("todo", "forward"));
  assert.doesNotThrow(() => assertTransition("ready", "forward"));
  assert.doesNotThrow(() => assertTransition("ready", "back"));
  assert.doesNotThrow(() => assertTransition("done", "back"));
  assert.doesNotThrow(() => assertTransition("needs-human", "back"), "needs-human→todo retreat is legal");
  // null edges: throw with the exact message shape
  assert.throws(() => assertTransition("todo", "back"), /illegal transition: todo cannot back/);
  assert.throws(() => assertTransition("done", "forward"), /illegal transition: done cannot forward/);
  assert.throws(() => assertTransition("needs-human", "forward"), /illegal transition: needs-human cannot forward/);
  assert.throws(() => assertTransition("superseded", "forward"), /illegal transition: superseded cannot forward/);
  assert.throws(() => assertTransition("superseded", "back"), /illegal transition: superseded cannot back/);
});

// ===========================================================================
// Phase A / Stage A2 — runComplete
// ===========================================================================

test("A2: runComplete on a non-ready (todo) task rejects — exit 1, NO gate, NO write", async () => {
  resetExit();
  const logPath = tmpLog("complete-precond");
  const client = stubClient({ id: "T-1", status: "todo", extra: { acceptance: "true" } });
  const r = await runComplete({ client, id: "T-1", logPath });
  assert.equal(r.ok, false);
  assert.match(r.reason, /illegal transition: todo cannot complete \(must be ready\)/);
  assert.equal(process.exitCode, 1);
  assert.equal(client._state.status, "todo", "status must be unchanged");
  assert.equal(queryGateEvents(logPath, { pipeline_id: "T-1" }).length, 0, "no gate event written");
  resetExit();
});

test("A2: runComplete fail-path (acceptance fails) — status stays ready, one acceptance fail event, exit 1", async () => {
  resetExit();
  const logPath = tmpLog("complete-fail");
  const client = stubClient({ id: "T-2", status: "ready", extra: { acceptance: "false" } });
  const r = await runComplete({ client, id: "T-2", logPath });
  assert.equal(r.ok, false);
  assert.equal(process.exitCode, 1);
  assert.equal(client._state.status, "ready", "status unchanged on gate fail");
  const events = queryGateEvents(logPath, { pipeline_id: "T-2" });
  assert.equal(events.length, 1, "exactly one (acceptance) event on fail");
  assert.equal(events[0].gate, "acceptance");
  assert.equal(events[0].verdict, "fail");
  resetExit();
});

test("A2: runComplete pass-path — status=done, exactly two events (acceptance then complete), exit 0", async () => {
  resetExit();
  const logPath = tmpLog("complete-pass");
  const client = stubClient({ id: "T-3", status: "ready", extra: { acceptance: "true" } });
  const r = await runComplete({ client, id: "T-3", logPath });
  assert.equal(r.ok, true);
  assert.equal(process.exitCode, 0);
  assert.equal(client._state.status, "done");
  const events = queryGateEvents(logPath, { pipeline_id: "T-3" });
  assert.deepEqual(events.map((e) => e.gate), ["acceptance", "complete"]);
  assert.equal(events[1].verdict, "pass");
  assert.deepEqual(events[1].payload, { from: "ready", to: "done" });
  resetExit();
});

test("A2: runComplete throws on a missing task", async () => {
  const logPath = tmpLog("complete-missing");
  const client = { taskGet: async () => null };
  await assert.rejects(() => runComplete({ client, id: "MISSING", logPath }), /no such task: MISSING/);
});

// ===========================================================================
// Phase A / Stage A2b — runCompleteLoop (the loop completion path AS the gate
// engine; gap-loop-completion-path-produces-zero-gateevents). A loop task with
// NO acceptance meter records a `complete` pass event (the loop's acceptance is
// the verification-round, passed in via `verifiedBy`); a loop task WITH a meter
// is CLI-consistent and RUNS it (fail → no status change, exactly like runComplete).
// ===========================================================================

test("A2b: runCompleteLoop on a meterless ready task — status done + ONE complete pass event carrying verifiedBy", async () => {
  resetExit();
  const logPath = tmpLog("complete-loop-nometer");
  const client = stubClient({ id: "T-L1", status: "ready", extra: {} });
  const r = await runCompleteLoop({ client, id: "T-L1", logPath, verifiedBy: "verification-round-3 green + AC/DoD checked" });
  assert.equal(r.ok, true);
  assert.equal(process.exitCode, 0);
  assert.equal(client._state.status, "done");
  const events = queryGateEvents(logPath, { pipeline_id: "T-L1" });
  assert.equal(events.length, 1, "meterless loop completion writes exactly one (complete) event — the loop's meter is the verification-round, not extra.acceptance");
  assert.equal(events[0].gate, "complete");
  assert.equal(events[0].verdict, "pass");
  assert.equal(events[0].actor, "quay-loop");
  assert.deepEqual(events[0].payload, { from: "ready", to: "done", verifiedBy: "verification-round-3 green + AC/DoD checked" });
  resetExit();
});

test("A2b: runCompleteLoop on a ready task WITH a passing meter — CLI-consistent acceptance + complete events", async () => {
  resetExit();
  const logPath = tmpLog("complete-loop-passmeter");
  const client = stubClient({ id: "T-L2", status: "ready", extra: { acceptance: "true" } });
  const r = await runCompleteLoop({ client, id: "T-L2", logPath });
  assert.equal(r.ok, true);
  assert.equal(client._state.status, "done");
  const events = queryGateEvents(logPath, { pipeline_id: "T-L2" });
  assert.deepEqual(events.map((e) => e.gate), ["acceptance", "complete"]);
  assert.equal(events[1].verdict, "pass");
  assert.deepEqual(events[1].payload, { from: "ready", to: "done" });
  resetExit();
});

test("A2b: runCompleteLoop on a ready task WITH a FAILING meter — status stays ready, ONE acceptance fail event, exit 1", async () => {
  resetExit();
  const logPath = tmpLog("complete-loop-failmeter");
  const client = stubClient({ id: "T-L3", status: "ready", extra: { acceptance: "false" } });
  const r = await runCompleteLoop({ client, id: "T-L3", logPath });
  assert.equal(r.ok, false);
  assert.equal(process.exitCode, 1);
  assert.equal(client._state.status, "ready", "status unchanged on meter fail — the loop must not bypass a present meter");
  const events = queryGateEvents(logPath, { pipeline_id: "T-L3" });
  assert.equal(events.length, 1);
  assert.equal(events[0].gate, "acceptance");
  assert.equal(events[0].verdict, "fail");
  resetExit();
});

test("A2b: runCompleteLoop on a non-ready (todo) task — exit 1, NO gate, NO write", async () => {
  resetExit();
  const logPath = tmpLog("complete-loop-precond");
  const client = stubClient({ id: "T-L4", status: "todo", extra: {} });
  const r = await runCompleteLoop({ client, id: "T-L4", logPath });
  assert.equal(r.ok, false);
  assert.match(r.reason, /illegal transition: todo cannot complete \(must be ready\)/);
  assert.equal(process.exitCode, 1);
  assert.equal(client._state.status, "todo", "status must be unchanged");
  assert.equal(queryGateEvents(logPath, { pipeline_id: "T-L4" }).length, 0, "no gate event written");
  resetExit();
});

test("A2b: runCompleteLoop throws on a missing task", async () => {
  const logPath = tmpLog("complete-loop-missing");
  const client = { taskGet: async () => null };
  await assert.rejects(() => runCompleteLoop({ client, id: "MISSING", logPath }), /no such task: MISSING/);
});

// ===========================================================================
// Phase A / Stage A3 — runAdjudicate / runPromote / runRetreat
// ===========================================================================

test("A3: runAdjudicate logs an `audit` GateEvent, never writes, exit 0 (fail verdict recorded, not enforced)", async () => {
  resetExit();
  const logPath = tmpLog("adjudicate");
  // ready => stub taskCheck returns ok:false, but adjudicate is record-only.
  const client = stubClient({ id: "T-4", status: "ready", extra: {} });
  const r = await runAdjudicate({ client, id: "T-4", logPath });
  assert.equal(r.ok, false);
  assert.equal(process.exitCode, 0, "adjudicate is exit 0 regardless of verdict");
  assert.equal(client._state.status, "ready", "adjudicate never writes status");
  const events = queryGateEvents(logPath, { pipeline_id: "T-4" });
  assert.equal(events.length, 1);
  assert.equal(events[0].gate, "audit");
  assert.equal(events[0].verdict, "fail");
  assert.equal(events[0].payload.observed_status, "ready");
  assert.equal(events[0].payload.reason, "stub");
  resetExit();
});

test("A3: runAdjudicate pass verdict on a todo task (stub taskCheck ok)", async () => {
  resetExit();
  const logPath = tmpLog("adjudicate-pass");
  const client = stubClient({ id: "T-4b", status: "todo", extra: {} });
  const r = await runAdjudicate({ client, id: "T-4b", logPath });
  assert.equal(r.ok, true);
  assert.equal(queryGateEvents(logPath, { pipeline_id: "T-4b" })[0].verdict, "pass");
  resetExit();
});

test("A3: runAdjudicate throws on a missing task", async () => {
  const client = { taskGet: async () => null };
  await assert.rejects(() => runAdjudicate({ client, id: "MISSING", logPath: tmpLog("adj-missing") }), /no such task/);
});

test("A3: runPromote todo→ready runs the dod gate then writes ready + logs a promote event", async () => {
  resetExit();
  const logPath = tmpLog("promote-todo");
  // todo => stub taskCheck ok:true, so the dod gate passes.
  const client = stubClient({ id: "T-5", status: "todo", extra: {} });
  const r = await runPromote({ client, id: "T-5", logPath });
  assert.equal(r.ok, true);
  assert.equal(r.to, "ready");
  assert.equal(client._state.status, "ready");
  const gates = queryGateEvents(logPath, { pipeline_id: "T-5" }).map((e) => e.gate);
  assert.deepEqual(gates, ["dod", "promote"]);
  resetExit();
});

test("A3: runPromote todo→ready fails when the dod gate fails — exit 1, no write", async () => {
  resetExit();
  const logPath = tmpLog("promote-todo-fail");
  // Custom client: todo, but taskCheck fails.
  const state = { id: "T-5b", status: "todo" };
  const client = {
    taskGet: async () => ({ ...state }),
    taskCheck: async () => ({ ok: false, reason: "0/1 AC checkboxes checked" }),
    taskWrite: async () => {
      throw new Error("should not write");
    },
  };
  const r = await runPromote({ client, id: "T-5b", logPath });
  assert.equal(r.ok, false);
  assert.equal(process.exitCode, 1);
  const events = queryGateEvents(logPath, { pipeline_id: "T-5b" });
  assert.deepEqual(events.map((e) => e.gate), ["dod"]);
  resetExit();
});

test("A3: runPromote ready→done delegates to runComplete (acceptance-guarded path to done)", async () => {
  resetExit();
  const logPath = tmpLog("promote-ready");
  const client = stubClient({ id: "T-6", status: "ready", extra: { acceptance: "true" } });
  const r = await runPromote({ client, id: "T-6", logPath });
  assert.equal(r.ok, true);
  assert.equal(r.to, "done");
  assert.equal(client._state.status, "done");
  const gates = queryGateEvents(logPath, { pipeline_id: "T-6" }).map((e) => e.gate);
  assert.deepEqual(gates, ["acceptance", "complete"]);
  resetExit();
});

test("A3: runPromote on a done task throws illegal transition (done cannot forward)", async () => {
  const logPath = tmpLog("promote-done");
  const client = stubClient({ id: "T-7", status: "done", extra: {} });
  await assert.rejects(() => runPromote({ client, id: "T-7", logPath }), /illegal transition: done cannot forward/);
});

test("A3: runPromote throws on a missing task", async () => {
  const client = { taskGet: async () => null };
  await assert.rejects(() => runPromote({ client, id: "MISSING", logPath: tmpLog("prom-missing") }), /no such task/);
});

test("A3: runRetreat done→ready writes ready + logs a retreat event carrying the reason", async () => {
  resetExit();
  const logPath = tmpLog("retreat-done");
  const client = stubClient({ id: "T-8", status: "done", extra: {} });
  const r = await runRetreat({ client, id: "T-8", reason: "rework needed", logPath });
  assert.equal(r.ok, true);
  assert.equal(r.to, "ready");
  assert.equal(client._state.status, "ready");
  const events = queryGateEvents(logPath, { pipeline_id: "T-8" });
  assert.equal(events.length, 1);
  assert.equal(events[0].gate, "retreat");
  assert.deepEqual(events[0].payload, { from: "done", to: "ready", reason: "rework needed" });
  resetExit();
});

test("A3: runRetreat with a missing/empty reason is a usage error — exit 1, no write", async () => {
  resetExit();
  const logPath = tmpLog("retreat-noreason");
  const client = stubClient({ id: "T-8b", status: "done", extra: {} });
  const r = await runRetreat({ client, id: "T-8b", reason: "   ", logPath });
  assert.equal(r.ok, false);
  assert.equal(process.exitCode, 1);
  assert.equal(client._state.status, "done", "no write without a reason");
  assert.equal(queryGateEvents(logPath, { pipeline_id: "T-8b" }).length, 0);
  resetExit();
});

test("A3: runRetreat on a todo task throws illegal transition (todo cannot back)", async () => {
  const logPath = tmpLog("retreat-todo");
  const client = stubClient({ id: "T-9", status: "todo", extra: {} });
  await assert.rejects(
    () => runRetreat({ client, id: "T-9", reason: "x", logPath }),
    /illegal transition: todo cannot back/
  );
});

test("A3: runRetreat throws on a missing task", async () => {
  const client = { taskGet: async () => null };
  await assert.rejects(
    () => runRetreat({ client, id: "MISSING", reason: "x", logPath: tmpLog("ret-missing") }),
    /no such task/
  );
});

// ===========================================================================
// Phase A / Stage A4 — runRetreat needs-human→todo (AC1-AC5, new transition)
// ===========================================================================

test("A4 [AC1-AC2]: runRetreat needs-human→todo writes todo + logs retreat event carrying the reason", async () => {
  resetExit();
  const logPath = tmpLog("retreat-nh");
  const client = stubClient({ id: "T-NH1", status: "needs-human", extra: {} });
  const r = await runRetreat({ client, id: "T-NH1", reason: "dependency installed; re-evaluate", logPath });
  assert.equal(r.ok, true);
  assert.equal(r.to, "todo");
  assert.equal(client._state.status, "todo");
  const events = queryGateEvents(logPath, { pipeline_id: "T-NH1" });
  assert.equal(events.length, 1);
  assert.equal(events[0].gate, "retreat");
  assert.equal(events[0].verdict, "pass");
  assert.deepEqual(events[0].payload, { from: "needs-human", to: "todo", reason: "dependency installed; re-evaluate" });
  resetExit();
});

test("A4 [AC3]: runRetreat needs-human without reason → exit 1, no write, no event", async () => {
  resetExit();
  const logPath = tmpLog("retreat-nh-noreason");
  const client = stubClient({ id: "T-NH2", status: "needs-human", extra: {} });
  const r = await runRetreat({ client, id: "T-NH2", reason: "", logPath });
  assert.equal(r.ok, false);
  assert.equal(process.exitCode, 1);
  assert.equal(client._state.status, "needs-human", "status unchanged");
  assert.equal(queryGateEvents(logPath, { pipeline_id: "T-NH2" }).length, 0, "no event written");
  resetExit();
});

test("A4 [AC4]: runPromote on a needs-human task → illegal transition (needs-human cannot forward)", async () => {
  const logPath = tmpLog("promote-nh");
  const client = stubClient({ id: "T-NH3", status: "needs-human", extra: {} });
  await assert.rejects(
    () => runPromote({ client, id: "T-NH3", logPath }),
    /illegal transition: needs-human cannot forward/
  );
});

test("A4 [AC5]: runComplete on a needs-human task → precondition reject (must be ready)", async () => {
  resetExit();
  const logPath = tmpLog("complete-nh");
  const client = stubClient({ id: "T-NH4", status: "needs-human", extra: {} });
  const r = await runComplete({ client, id: "T-NH4", logPath });
  assert.equal(r.ok, false);
  assert.match(r.reason, /illegal transition: needs-human cannot complete \(must be ready\)/);
  assert.equal(process.exitCode, 1);
  assert.equal(client._state.status, "needs-human", "status unchanged");
  assert.equal(queryGateEvents(logPath, { pipeline_id: "T-NH4" }).length, 0, "no event written");
  resetExit();
});

test("A4 [AC6]: runRetreat done→ready still works (no regression on existing retreat paths)", async () => {
  resetExit();
  const logPath = tmpLog("retreat-regression-done");
  const client = stubClient({ id: "T-NH5", status: "done", extra: {} });
  const r = await runRetreat({ client, id: "T-NH5", reason: "rework", logPath });
  assert.equal(r.ok, true);
  assert.equal(r.to, "ready");
  assert.equal(client._state.status, "ready");
  const events = queryGateEvents(logPath, { pipeline_id: "T-NH5" });
  assert.equal(events[0].gate, "retreat");
  assert.deepEqual(events[0].payload, { from: "done", to: "ready", reason: "rework" });
  resetExit();
});

test("A4 [AC6]: runRetreat ready→todo still works (no regression on existing retreat paths)", async () => {
  resetExit();
  const logPath = tmpLog("retreat-regression-ready");
  const client = stubClient({ id: "T-NH6", status: "ready", extra: {} });
  const r = await runRetreat({ client, id: "T-NH6", reason: "re-triage", logPath });
  assert.equal(r.ok, true);
  assert.equal(r.to, "todo");
  assert.equal(client._state.status, "todo");
  const events = queryGateEvents(logPath, { pipeline_id: "T-NH6" });
  assert.equal(events[0].gate, "retreat");
  assert.deepEqual(events[0].payload, { from: "ready", to: "todo", reason: "re-triage" });
  resetExit();
});

// ===========================================================================
// RETREATED WRITE SIDE (tasks/gap-wiring-C-retreat-write-side) — every retreat
// writes the `**RETREATED` / 搁置 marker (gap-retreated-state-not-mechanized)
// that the detection side reads (ready-pool-check isRetreated / slot-refill
// step-4 defer "retreated"). Before this wiring the write side was missing:
// 0 task files carried the marker and the detection side never saw a real
// retreat. The writer's output must satisfy RETREATED_MARKER_RE (line-start
// bold, optional blockquote) — the exact anchor the plugin's reader tests.
// ===========================================================================

test("RETREATED-WRITE [AC1]: runRetreat done→ready writes the **RETREATED marker to a string body", async () => {
  resetExit();
  const logPath = tmpLog("retreat-write-marker");
  const body = "## Proposal\nreal proposal text\n## AC\n- [x] done\n## DoD\n- [x] done\n";
  const client = stubClient({ id: "T-RW1", status: "done", extra: {}, body });
  const r = await runRetreat({ client, id: "T-RW1", reason: "load-induced red — wait for fix-scope gate", logPath });
  assert.equal(r.ok, true);
  assert.equal(r.to, "ready");
  assert.equal(client._state.status, "ready");
  assert.ok(RETREATED_MARKER_RE.test(client._state.body), `body must carry the **RETREATED marker; got: ${client._state.body}`);
  assert.match(client._state.body, /^> \*\*RETREATED \/ 搁置（load-induced red — wait for fix-scope gate）\*\*$/m, "marker is the line-start blockquote bold form carrying the reason");
  // The DETECTION side (ready-pool-check isRetreated — the same predicate slot-refill reuses)
  // must read what the write side produced.
  assert.equal(isRetreated({ body: client._state.body }), true, "ready-pool-check isRetreated reads the written marker");
  resetExit();
});

test("RETREATED-WRITE [AC1+AC83]: runRetreat done→ready unchecks AC boxes AND writes the marker (they compose)", async () => {
  resetExit();
  const logPath = tmpLog("retreat-write-ac83");
  const body = "## Proposal\nreal proposal text\n## AC\n- [x] a-c-1\n- [X] a-c-2\n## DoD\n- [x] dod-1\n";
  const client = stubClient({ id: "T-RW2", status: "done", extra: {}, body });
  const r = await runRetreat({ client, id: "T-RW2", reason: "rework", logPath });
  assert.equal(r.ok, true);
  assert.equal(r.to, "ready");
  assert.match(client._state.body, /## AC\n- \[ \] a-c-1\n- \[ \] a-c-2/, "AC boxes unchecked (AC83)");
  assert.ok(RETREATED_MARKER_RE.test(client._state.body), "marker present alongside the uncheck");
  resetExit();
});

test("RETREATED-WRITE: edge-scoped — ready→todo / needs-human→todo write NO marker (no body patch)", async () => {
  resetExit();
  const logPath = tmpLog("retreat-write-edges");
  const body = "## Proposal\nreal proposal text\n";
  const client1 = stubClient({ id: "T-RW3", status: "ready", extra: {}, body });
  const r1 = await runRetreat({ client: client1, id: "T-RW3", reason: "re-triage", logPath });
  assert.equal(r1.to, "todo");
  assert.ok(!RETREATED_MARKER_RE.test(client1._state.body), "ready→todo writes NO marker (not a shelve — rolls back to todo)");

  const client2 = stubClient({ id: "T-RW4", status: "needs-human", extra: {}, body });
  const r2 = await runRetreat({ client: client2, id: "T-RW4", reason: "dependency installed", logPath });
  assert.equal(r2.to, "todo");
  assert.ok(!RETREATED_MARKER_RE.test(client2._state.body), "needs-human→todo writes NO marker");
  resetExit();
});

test("RETREATED-WRITE: idempotent — a done task whose body already carries the marker is not stacked on re-retreat", async () => {
  resetExit();
  const logPath = tmpLog("retreat-write-idem");
  const body = "> **RETREATED / 搁置（first）**\n\n## Proposal\nreal proposal text\n";
  const client = stubClient({ id: "T-RW5", status: "done", extra: {}, body });
  const r = await runRetreat({ client, id: "T-RW5", reason: "second retreat", logPath });
  assert.equal(r.ok, true);
  assert.equal(r.to, "ready");
  const matches = client._state.body.match(/\*\*RETREATED/g) ?? [];
  assert.equal(matches.length, 1, "exactly one marker line — no duplicate");
  resetExit();
});

test("RETREATED-WRITE: fail-open — a task with no body still retreats (status flips, no body write)", async () => {
  resetExit();
  const logPath = tmpLog("retreat-write-nobody");
  const client = stubClient({ id: "T-RW6", status: "done", extra: {} });
  const r = await runRetreat({ client, id: "T-RW6", reason: "no body case", logPath });
  assert.equal(r.ok, true);
  assert.equal(r.to, "ready");
  assert.equal(client._state.status, "ready");
  assert.equal(client._state.body, undefined, "no body field on a bodyless stub task");
  resetExit();
});

test("A5 [AC2]: superseded is a hard terminal — runPromote throws illegal transition, no write", async () => {
  resetExit();
  const logPath = tmpLog("superseded-promote");
  const client = stubClient({ id: "T-SUP1", status: "superseded", extra: {} });
  await assert.rejects(
    () => runPromote({ client, id: "T-SUP1", logPath }),
    /illegal transition: superseded cannot forward/
  );
  assert.equal(client._state.status, "superseded", "status must be unchanged");
  assert.equal(queryGateEvents(logPath, { pipeline_id: "T-SUP1" }).length, 0, "no gate event written");
  resetExit();
});

test("A5 [AC2]: superseded is a hard terminal — runRetreat throws illegal transition, no write", async () => {
  resetExit();
  const logPath = tmpLog("superseded-retreat");
  const client = stubClient({ id: "T-SUP2", status: "superseded", extra: {} });
  await assert.rejects(
    () => runRetreat({ client, id: "T-SUP2", reason: "try to revive", logPath }),
    /illegal transition: superseded cannot back/
  );
  assert.equal(client._state.status, "superseded", "status must be unchanged");
  assert.equal(queryGateEvents(logPath, { pipeline_id: "T-SUP2" }).length, 0, "no gate event written");
  resetExit();
});

test("A5 [AC2]: superseded is a hard terminal — runComplete rejects precondition (must be ready), no gate", async () => {
  resetExit();
  const logPath = tmpLog("superseded-complete");
  const client = stubClient({ id: "T-SUP3", status: "superseded", extra: { acceptance: "true" } });
  const r = await runComplete({ client, id: "T-SUP3", logPath });
  assert.equal(r.ok, false);
  assert.match(r.reason, /illegal transition: superseded cannot complete \(must be ready\)/);
  assert.equal(process.exitCode, 1);
  assert.equal(client._state.status, "superseded", "status must be unchanged");
  assert.equal(queryGateEvents(logPath, { pipeline_id: "T-SUP3" }).length, 0, "no gate event written");
  resetExit();
});

// ===========================================================================
// Phase C — real CLI against a native-provider workspace (AC1-AC3)
// Provider MAP form WITH mcp_entry — mirrors gap-cli-gate-enforcement.test.mjs.
// ===========================================================================

function makeWorkspace(tag) {
  return makeTmpWorkspace(`quay-qeng3-${tag}`, { nativeBin, nativeProviderDir });
}

function runQuay(args, cwd) {
  try {
    const out = execFileSync("node", [quayBin, ...args], { encoding: "utf8", cwd });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

function runNative(args, tasksDir) {
  return execFileSync("node", [nativeBin, ...args], {
    encoding: "utf8",
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
}

const validSections =
  "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
  "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n";
const acDodChecked =
  "## AC\n- [x] a sufficiently long acceptance criterion line for the minimum-content check\n" +
  "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";

// --- AC1: complete fail / pass / precondition-reject ------------------------

test("C [AC1]: `quay complete <ready+failing-meter>` → exit 1, status stays ready", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac1-fail");
  runNative(["task", "create", "LC-FAIL", "--title", "ready+failing", "--status", "ready",
    "--body", validSections + acDodChecked], tasksDir);
  runQuay(["task", "edit", "LC-FAIL", "--acceptance", "false"], workspaceRoot);

  const r = runQuay(["complete", "LC-FAIL"], workspaceRoot);
  assert.equal(r.status, 1, `expected exit 1; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /FAIL/);
  const after = JSON.parse(runQuay(["task", "view", "LC-FAIL", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "ready", "status must be unchanged on fail");
});

test("C [AC1]: `quay complete <ready+passing-meter>` → exit 0, status=done", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac1-pass");
  runNative(["task", "create", "LC-PASS", "--title", "ready+passing", "--status", "ready",
    "--body", validSections + acDodChecked], tasksDir);
  runQuay(["task", "edit", "LC-PASS", "--acceptance", "true"], workspaceRoot);

  const r = runQuay(["complete", "LC-PASS"], workspaceRoot);
  assert.equal(r.status, 0, `expected exit 0; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /PASS — status=done/);
  const after = JSON.parse(runQuay(["task", "view", "LC-PASS", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "done");
});

test("C [AC1]: `quay complete <todo-task>` → exit 1 precondition-reject, status unchanged, no gate", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac1-precond");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "LC-TODO", "--title", "todo task", "--status", "todo",
    "--body", validSections + acDodChecked], tasksDir);
  runQuay(["task", "edit", "LC-TODO", "--acceptance", "true"], workspaceRoot);

  const r = runQuay(["complete", "LC-TODO", "--file", logFile], workspaceRoot);
  assert.equal(r.status, 1, `expected exit 1; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /illegal transition: todo cannot complete \(must be ready\)/);
  const after = JSON.parse(runQuay(["task", "view", "LC-TODO", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "todo", "status unchanged");
  // No gate event was written (precondition ran before any gate).
  assert.ok(!fs.existsSync(logFile), "no gate log written on precondition reject");
});

// --- AC2: adjudicate records an audit GateEvent -----------------------------

test("C [AC2]: `quay adjudicate <id>` → exit 0; `gate-log --gate audit --json` lists the audit event", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac2");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "LC-ADJ", "--title", "adjudicate me", "--status", "ready",
    "--body", validSections + acDodChecked], tasksDir);

  const r = runQuay(["adjudicate", "LC-ADJ", "--file", logFile], workspaceRoot);
  assert.equal(r.status, 0, `expected exit 0; got ${r.status}, stderr=${r.stderr}`);

  const log = runQuay(["gate-log", "LC-ADJ", "--gate", "audit", "--json", "--file", logFile], workspaceRoot);
  assert.equal(log.status, 0);
  const events = JSON.parse(log.stdout);
  assert.ok(events.length >= 1, `expected >=1 audit event; got ${log.stdout}`);
  assert.ok(events.every((e) => e.gate === "audit"));
});

// --- AC3: illegal transitions rejected nonzero + message --------------------
// exp5-M-GATE-CLI-ERROR-UX (AC1): these guarded illegal-transition throws
// previously fell through to the generic top-level catch, which prints
// `err.stack` (a raw Node stack trace, e.g. "at assertTransition (.../lifecycle.js:57:11)").
// Assert BOTH the clean one-line message AND the absence of any stack frame.
const STACK_FRAME_PATTERN = /\bat (Object\.|async |\S+\s\()/;

test("C [AC3]: `quay retreat <todo> --reason x` → nonzero + `illegal transition: todo cannot back`, no stack trace", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac3-retreat");
  runNative(["task", "create", "LC-RT", "--title", "todo retreat", "--status", "todo",
    "--body", validSections + acDodChecked], tasksDir);
  const r = runQuay(["retreat", "LC-RT", "--reason", "x"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected nonzero; got ${r.status}, stdout=${r.stdout}`);
  assert.match(r.stderr, /^illegal transition: todo cannot back\s*$/m, `expected exact clean message line; got stderr=${JSON.stringify(r.stderr)}`);
  assert.ok(!STACK_FRAME_PATTERN.test(r.stderr), `stderr must NOT contain a raw stack trace; got: ${r.stderr}`);
  assert.ok(!r.stderr.includes(".js:"), `stderr must not contain a file:line stack frame; got: ${r.stderr}`);
});

test("C [AC3]: `quay promote <done>` → nonzero + `illegal transition: done cannot forward`, no stack trace", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac3-promote");
  runNative(["task", "create", "LC-PM", "--title", "done promote", "--status", "done",
    "--body", validSections + acDodChecked], tasksDir);
  const r = runQuay(["promote", "LC-PM"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected nonzero; got ${r.status}, stdout=${r.stdout}`);
  assert.match(r.stderr, /^illegal transition: done cannot forward\s*$/m, `expected exact clean message line; got stderr=${JSON.stringify(r.stderr)}`);
  assert.ok(!STACK_FRAME_PATTERN.test(r.stderr), `stderr must NOT contain a raw stack trace; got: ${r.stderr}`);
});

test("C [AC3]: `quay promote <nonexistent-id>` → clean `no such task: ...` message, no stack trace", () => {
  const { workspaceRoot } = makeWorkspace("ac3-promote-missing");
  const r = runQuay(["promote", "NOPE-MISSING"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected nonzero; got ${r.status}, stdout=${r.stdout}`);
  assert.match(r.stderr, /^no such task: NOPE-MISSING\s*$/m, `expected exact clean message line; got stderr=${JSON.stringify(r.stderr)}`);
  assert.ok(!STACK_FRAME_PATTERN.test(r.stderr), `stderr must NOT contain a raw stack trace; got: ${r.stderr}`);
});

test("C [SUPERSEDED]: `quay promote <superseded>` → nonzero + `illegal transition: superseded cannot forward`, no stack trace", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac3-superseded-promote");
  runNative(["task", "create", "LC-SUP", "--title", "superseded promote", "--status", "superseded",
    "--body", validSections + acDodChecked], tasksDir);
  const r = runQuay(["promote", "LC-SUP"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected nonzero; got ${r.status}, stdout=${r.stdout}`);
  assert.match(r.stderr, /^illegal transition: superseded cannot forward\s*$/m, `expected exact clean message line; got stderr=${JSON.stringify(r.stderr)}`);
  assert.ok(!STACK_FRAME_PATTERN.test(r.stderr), `stderr must NOT contain a raw stack trace; got: ${r.stderr}`);
});

test("C [SUPERSEDED]: `quay retreat <superseded> --reason x` → nonzero + `illegal transition: superseded cannot back` (hard terminal, no revival)", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac3-superseded-retreat");
  runNative(["task", "create", "LC-SUP2", "--title", "superseded retreat", "--status", "superseded",
    "--body", validSections + acDodChecked], tasksDir);
  const r = runQuay(["retreat", "LC-SUP2", "--reason", "try to revive"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected nonzero; got ${r.status}, stdout=${r.stdout}`);
  assert.match(r.stderr, /^illegal transition: superseded cannot back\s*$/m, `expected exact clean message line; got stderr=${JSON.stringify(r.stderr)}`);
  assert.ok(!STACK_FRAME_PATTERN.test(r.stderr), `stderr must NOT contain a raw stack trace; got: ${r.stderr}`);
});

test("C [SUPERSEDED]: `quay task edit <id> --status superseded` succeeds (superseded_writable)", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("superseded-writable");
  runNative(["task", "create", "LC-WR", "--title", "writable", "--status", "todo",
    "--body", validSections + acDodChecked], tasksDir);
  const r = runQuay(["task", "edit", "LC-WR", "--status", "superseded"], workspaceRoot);
  assert.equal(r.status, 0, `expected exit 0; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  const after = JSON.parse(runQuay(["task", "view", "LC-WR", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "superseded");
});

// --- exp5-M-GATE-CLI-ARG-ORDER: flag-before-id on the lifecycle verb-less commands ---
test("C [ARG-ORDER]: `quay complete --file <log> <id>` (flag before id) == id-first", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("argorder-complete");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "LC-PASS", "--title", "ready+passing", "--status", "ready",
    "--body", validSections + acDodChecked], tasksDir);
  runQuay(["task", "edit", "LC-PASS", "--acceptance", "true"], workspaceRoot);
  const r = runQuay(["complete", "--file", logFile, "LC-PASS"], workspaceRoot);
  assert.equal(r.status, 0, `flag-first complete should exit 0; got ${r.status}, stderr=${r.stderr}, stdout=${r.stdout}`);
  const after = JSON.parse(runQuay(["task", "view", "LC-PASS", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "done");
});

// --- AC1-AC6: needs-human→todo retreat (DIR-102) ---------------------------

test("C [DIR-102 AC1]: `quay retreat <needs-human> --reason x` → exit 0, status=todo", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("dir102-ac1");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "NH-RET", "--title", "needs-human retreat", "--status", "needs-human",
    "--body", validSections + acDodChecked], tasksDir);

  const r = runQuay(["retreat", "NH-RET", "--reason", "dependency installed", "--file", logFile], workspaceRoot);
  assert.equal(r.status, 0, `expected exit 0; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /RETREAT needs-human → todo/);

  const after = JSON.parse(runQuay(["task", "view", "NH-RET", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "todo", "status must be todo after retreat");

  // AC2: verify GateEvent recorded
  const log = runQuay(["gate-log", "NH-RET", "--gate", "retreat", "--json", "--file", logFile], workspaceRoot);
  assert.equal(log.status, 0);
  const events = JSON.parse(log.stdout);
  assert.ok(events.length >= 1, `expected >=1 retreat event; got ${log.stdout}`);
  assert.equal(events[0].gate, "retreat");
  assert.equal(events[0].verdict, "pass");
  assert.equal(events[0].payload.reason, "dependency installed");
});

test("C [DIR-102 AC3]: `quay retreat <needs-human>` (no --reason) → nonzero, status unchanged", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("dir102-ac3");
  runNative(["task", "create", "NH-NOREASON", "--title", "needs-human no reason", "--status", "needs-human",
    "--body", validSections + acDodChecked], tasksDir);

  const r = runQuay(["retreat", "NH-NOREASON"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected nonzero; got ${r.status}, stdout=${r.stdout}`);

  const after = JSON.parse(runQuay(["task", "view", "NH-NOREASON", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "needs-human", "status unchanged without --reason");
});

test("C [DIR-102 AC4]: `quay promote <needs-human>` → nonzero (promote from needs-human illegal)", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("dir102-ac4");
  runNative(["task", "create", "NH-PROMOTE", "--title", "needs-human promote", "--status", "needs-human",
    "--body", validSections + acDodChecked], tasksDir);

  const r = runQuay(["promote", "NH-PROMOTE"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected nonzero; got ${r.status}, stdout=${r.stdout}`);
  assert.match(r.stderr, /illegal transition: needs-human cannot forward/);
  assert.ok(!STACK_FRAME_PATTERN.test(r.stderr), "no stack trace");

  const after = JSON.parse(runQuay(["task", "view", "NH-PROMOTE", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "needs-human", "status unchanged");
});

test("C [DIR-102 AC5]: `quay complete <needs-human>` → nonzero (complete from needs-human illegal)", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("dir102-ac5");
  runNative(["task", "create", "NH-COMPLETE", "--title", "needs-human complete", "--status", "needs-human",
    "--body", validSections + acDodChecked], tasksDir);

  const r = runQuay(["complete", "NH-COMPLETE"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected nonzero; got ${r.status}, stdout=${r.stdout}`);
  assert.match(r.stdout, /illegal transition: needs-human cannot complete \(must be ready\)/);

  const after = JSON.parse(runQuay(["task", "view", "NH-COMPLETE", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "needs-human", "status unchanged");
});

test("C [DIR-102 AC6]: `quay retreat <done> --reason x` still works (no regression)", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("dir102-ac6");
  runNative(["task", "create", "DONE-RET", "--title", "done retreat regression", "--status", "done",
    "--body", validSections + acDodChecked], tasksDir);

  const r = runQuay(["retreat", "DONE-RET", "--reason", "rework needed"], workspaceRoot);
  assert.equal(r.status, 0, `expected exit 0; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /RETREAT done → ready/);

  const after = JSON.parse(runQuay(["task", "view", "DONE-RET", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "ready", "done→ready still works");
});

// --- RETREATED WRITE SIDE E2E (tasks/gap-wiring-C-retreat-write-side AC2) ---
// Production-carrier end-to-end: a REAL `quay retreat` against a REAL native
// provider writes the `**RETREATED` marker to the REAL task file on disk, and
// the REAL detection side (slot-refill CLI's step-4 defer) reads it back. This
// is not a fixture — it exercises lifecycle.runRetreat, the native store's
// taskWrite, and slot-refill's RETREATED filter against each other.

const SLOT_REFILL_CLI = path.join(__dirname, "..", "..", "..", "plugin", "scripts", "slot-refill.ts");

/** A native-provider workspace whose tasks dir IS `<root>/tasks` — so the same root
 *  can be handed to slot-refill (`--root`) for the detection half of the E2E. */
function makeSlotNativeWorkspace(tag) {
  const root = makeTmpDir(`quay-qeng3-${tag}-`);
  const tasksDir = path.join(root, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
      `    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"`,
      `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"`,
      "",
    ].join("\n")
  );
  return { root, tasksDir };
}

test("C [RETREATED-E2E AC2]: real `quay retreat` writes **RETREATED to the task file AND slot-refill defers the retreated ready task", () => {
  const { root, tasksDir } = makeSlotNativeWorkspace("retreated-e2e");
  // A dispatchable done task (self-touch + (new) touch resolve cleanly) — only the marker the
  // retreat writes may remove it from the dispatch recommendation.
  const dispatchable = validSections + acDodChecked +
    "## Touches\n- code/ret-e2e.ts (new)\n- tasks/E2E-RET.md\n";
  runNative(["task", "create", "E2E-RET", "--title", "e2e retreat", "--status", "done",
    "--body", dispatchable], tasksDir);

  const r = runQuay(["retreat", "E2E-RET", "--reason", "load-induced red — wait for fix-scope gate"], root);
  assert.equal(r.status, 0, `retreat exit 0; stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /RETREAT done → ready/);

  // Write side: the REAL task file on disk carries the marker.
  const fileBody = fs.readFileSync(path.join(tasksDir, "E2E-RET.md"), "utf8");
  assert.match(fileBody, /^\s*>\s*\*\*RETREATED\b/im, `task file must carry the marker; got:\n${fileBody}`);
  const after = JSON.parse(runQuay(["task", "view", "E2E-RET", "--json"], root).stdout);
  assert.equal(after.status, "ready", "done→ready flips status");

  // Detection side: the REAL slot-refill CLI reads the written marker and defers the task
  // (reason "retreated") — the task is NOT recommended for dispatch.
  const slot = JSON.parse(execFileSync(process.execPath, [
    "--no-warnings", "--experimental-strip-types", SLOT_REFILL_CLI, "--root", root, "--cap", "5",
  ], { encoding: "utf8", env: { ...process.env, QUAY_TELEMETRY_SUBAGENTS: "0" } }));
  assert.ok(!(slot.recommended ?? []).includes("E2E-RET"), "retreated task is NOT recommended for dispatch");
  const ret = (slot.deferred ?? []).find((d) => d.id === "E2E-RET");
  assert.ok(ret && /retreated/.test(ret.reason), `E2E-RET deferred as retreated; got deferred=${JSON.stringify(slot.deferred)}`);
});
