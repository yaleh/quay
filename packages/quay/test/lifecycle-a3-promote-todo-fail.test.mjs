// @test-group product
// lifecycle-a3-promote-todo-fail.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A3 — runPromote todo→ready fails when the dod gate
// fails — exit 1, no write. The test body is byte-identical to the original; only its file
// placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runPromote } from "../src/gate/lifecycle.ts";
import { queryGateEvents } from "../src/gate/gate-event-store.ts";
import { tmpLog, resetExit } from "./lifecycle-helpers.mjs";

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
