// @test-group product
// lifecycle-a4-complete-nh.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A4 [AC5] — runComplete on a needs-human task →
// precondition reject (must be ready). The test body is byte-identical to the original; only its
// file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runComplete } from "../src/gate/lifecycle.ts";
import { queryGateEvents } from "../src/gate/gate-event-store.ts";
import { stubClient, tmpLog, resetExit } from "./lifecycle-helpers.mjs";

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
