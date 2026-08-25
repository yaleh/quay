// @test-group product
// ts-typecheck-gate-pass.test.mjs — split out of ts-typecheck-gate.test.mjs
// (gap-suite-split-long-multi-test-files): M63 A2 — the ts-typecheck gate PASSes for real against
// THIS repo's own root tsconfig.json (real `npx tsc --noEmit`, real process I/O). The test body is
// byte-identical to the original; only its file placement changed so node:test's file-level
// concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { gate } from "./ts-typecheck-gate-helpers.mjs";

test("M63 A2: ts-typecheck gate PASSes for real against THIS repo's own root tsconfig.json (real `npx tsc --noEmit`, real process I/O)", async () => {
  const r = await gate("ts-typecheck")({ id: "T", extra: {} });
  assert.equal(r.ok, true, `expected pass (tsc --noEmit green); got reason=${r.reason}`);
}, { timeout: 120000 });
