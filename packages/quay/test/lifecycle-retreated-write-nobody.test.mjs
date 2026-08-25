// @test-group product
// lifecycle-retreated-write-nobody.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): RETREATED-WRITE fail-open — a task with no body still
// retreats (status flips, no body write). The test body is byte-identical to the original; only
// its file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runRetreat } from "../src/gate/lifecycle.ts";
import { stubClient, tmpLog, resetExit } from "./lifecycle-helpers.mjs";

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
