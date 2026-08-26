// @test-group product
// driver-cli-ac3-poc.test.mjs — split out of driver.test.mjs
// (gap-suite-split-long-multi-test-files): C [AC3 POC] — `quay run --once` reproduces an exp5
// ABSORB transition (ready+meter → done) on a self-contained fixture. The test body is
// byte-identical to the original; only its file placement changed so node:test's file-level
// concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { queryGateEvents } from "../src/gate/gate-event-store.ts";
import { makeWorkspace, seedReadyTask, runQuay } from "./driver-helpers.mjs";

test("C [AC3 POC]: `quay run --once` reproduces an exp5 ABSORB transition (ready+meter → done) on a self-contained fixture", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac3-poc");
  seedReadyTask("POC-1", tasksDir, workspaceRoot, "true");

  // Pre-state: ready.
  const before = JSON.parse(runQuay(["task", "view", "POC-1", "--json"], workspaceRoot).stdout);
  assert.equal(before.status, "ready");

  const r = runQuay(["run", "--once"], workspaceRoot);
  assert.equal(r.status, 0, `POC run must exit 0; got ${r.status}, stderr=${r.stderr}`);
  assert.match(r.stdout, /POC-1: PASS — done/);

  // Post-state: done — the same board transition an exp5 ABSORB step makes.
  const after = JSON.parse(runQuay(["task", "view", "POC-1", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "done", "taskGet(POC-1).status === 'done'");

  // A `complete` pass GateEvent was recorded (default log path in .quay/).
  const logFile = path.join(workspaceRoot, ".quay", "gate-events.jsonl");
  const events = queryGateEvents(logFile, { pipeline_id: "POC-1" });
  const complete = events.find((e) => e.gate === "complete");
  assert.ok(complete, `expected a 'complete' GateEvent; got ${JSON.stringify(events.map((e) => e.gate))}`);
  assert.equal(complete.verdict, "pass");
  assert.deepEqual(complete.payload, { from: "ready", to: "done" });
});
