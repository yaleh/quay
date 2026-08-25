// @test-group product
// lifecycle-a2-complete-precond.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A2 — runComplete on a non-ready (todo) task rejects —
// exit 1, NO gate, NO write. The test body is byte-identical to the original; only its file
// placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runComplete } from "../src/gate/lifecycle.ts";
import { queryGateEvents } from "../src/gate/gate-event-store.ts";
import { stubClient, tmpLog, resetExit } from "./lifecycle-helpers.mjs";

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
