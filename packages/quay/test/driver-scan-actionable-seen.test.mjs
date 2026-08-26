// @test-group product
// driver-scan-actionable-seen.test.mjs — split out of driver.test.mjs
// (gap-suite-split-long-multi-test-files): A1 — scanActionable subtracts the `seen` set. The test
// body is byte-identical to the original; only its file placement changed so node:test's
// file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { scanActionable } from "../src/gate/driver.ts";
import { stubClient } from "./driver-helpers.mjs";

test("A1: scanActionable — subtracts the `seen` set", async () => {
  const client = stubClient([
    { id: "C-1", status: "ready", extra: { acceptance: "true" } },
    { id: "C-2", status: "ready", extra: { acceptance: "true" } },
    { id: "C-3", status: "ready", extra: { acceptance: "true" } },
  ]);
  assert.deepEqual(await scanActionable(client, new Set(["C-2"])), ["C-1", "C-3"]);
  assert.deepEqual(await scanActionable(client, new Set(["C-1", "C-2", "C-3"])), []);
});
