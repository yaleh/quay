// @test-group product
// driver-run-loop-cap.test.mjs — split out of driver.test.mjs
// (gap-suite-split-long-multi-test-files): A3 — runLoop cap: maxIterations bounds a spin,
// stopped=cap. The test body is byte-identical to the original; only its file placement changed
// so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runLoop } from "../src/gate/driver.ts";
import { tmpLog, tmpWorkspace, resetExit } from "./driver-helpers.mjs";

test("A3: runLoop cap — maxIterations bounds a spin, stopped=cap", async () => {
  resetExit();
  const logPath = tmpLog("loop-cap");
  const { workspaceRoot } = tmpWorkspace("loop-cap");
  // A client whose taskList ALWAYS returns a fresh actionable task (ignores
  // `seen` by never draining) forces the cap path deterministically.
  let n = 0;
  const client = {
    async taskList() {
      return { tasks: [{ id: `SPIN-${n++}`, status: "ready", extra: { acceptance: "true" } }], malformed: [] };
    },
    async taskGet(id) { return { id, status: "ready", extra: { acceptance: "true" } }; },
    async taskCheck() { return { ok: true, reason: "ok" }; },
    async taskWrite({ id, status }) { return { id, status }; },
  };
  const r = await runLoop({ client, cfg: { workspaceRoot }, logPath, maxIterations: 1 });
  assert.equal(r.stopped, "cap");
  assert.equal(r.iterations, 1);
  resetExit();
});
