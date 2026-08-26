// @test-group product
// lifecycle-a5-superseded-promote.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A5 [AC2] — superseded is a hard terminal — runPromote
// throws illegal transition, no write. The test body is byte-identical to the original; only its
// file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runPromote } from "../src/gate/lifecycle.ts";
import { queryGateEvents } from "../src/gate/gate-event-store.ts";
import { stubClient, tmpLog, resetExit } from "./lifecycle-helpers.mjs";

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
