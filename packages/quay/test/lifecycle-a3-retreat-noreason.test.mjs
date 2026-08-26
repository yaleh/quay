// @test-group product
// lifecycle-a3-retreat-noreason.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A3 — runRetreat with a missing/empty reason is a usage
// error — exit 1, no write. The test body is byte-identical to the original; only its file
// placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runRetreat } from "../src/gate/lifecycle.ts";
import { queryGateEvents } from "../src/gate/gate-event-store.ts";
import { stubClient, tmpLog, resetExit } from "./lifecycle-helpers.mjs";

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
