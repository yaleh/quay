// @test-group product
// driver-scan-actionable-empty.test.mjs — split out of driver.test.mjs
// (gap-suite-split-long-multi-test-files): A1 — scanActionable on an empty (or only-meterless)
// board returns []. The test body is byte-identical to the original; only its file placement
// changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { scanActionable } from "../src/gate/driver.ts";
import { stubClient } from "./driver-helpers.mjs";

test("A1: scanActionable — empty board (or only-meterless) returns []", async () => {
  assert.deepEqual(await scanActionable(stubClient([])), []);
  assert.deepEqual(
    await scanActionable(stubClient([{ id: "C-1", status: "ready", extra: {} }])),
    []
  );
});
