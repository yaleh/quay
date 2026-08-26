// @test-group product
// lifecycle-a5-superseded-complete.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A5 [AC2] — superseded is a hard terminal — runComplete
// rejects precondition (must be ready), no gate. The test body is byte-identical to the original;
// only its file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runComplete } from "../src/gate/lifecycle.ts";
import { queryGateEvents } from "../src/gate/gate-event-store.ts";
import { stubClient, tmpLog, resetExit } from "./lifecycle-helpers.mjs";

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
