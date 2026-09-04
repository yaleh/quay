// @test-group product
// lifecycle-a4-retreat-nh-noreason.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A4 [AC3] — runRetreat needs-human without reason → exit
// 1, no write, no event. The test body is byte-identical to the original; only its file placement
// changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runRetreat } from "../src/gate/lifecycle.ts";
import { queryGateEvents } from "../src/gate/gate-event-store.ts";
import { stubClient, tmpLog, resetExit } from "./lifecycle-helpers.mjs";

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
