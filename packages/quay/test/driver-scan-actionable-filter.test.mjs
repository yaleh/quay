// @test-group product
// driver-scan-actionable-filter.test.mjs — split out of driver.test.mjs
// (gap-suite-split-long-multi-test-files): A1 — scanActionable filters meterless ready tasks and
// sorts by id ascending. The test body is byte-identical to the original; only its file placement
// changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { scanActionable } from "../src/gate/driver.ts";
import { stubClient } from "./driver-helpers.mjs";

test("A1: scanActionable — filters meterless ready tasks, sorts by id ascending", async () => {
  const client = stubClient([
    { id: "C-3", status: "ready", extra: { acceptance: "true" } },
    { id: "C-1", status: "ready", extra: { acceptance: "true" } },
    { id: "C-2", status: "ready", extra: {} }, // meterless -> skipped
    { id: "C-4", status: "todo", extra: { acceptance: "true" } }, // not ready -> skipped
    { id: "C-0", status: "done", extra: { acceptance: "true" } }, // done -> skipped
  ]);
  assert.deepEqual(await scanActionable(client), ["C-1", "C-3"]);
});
