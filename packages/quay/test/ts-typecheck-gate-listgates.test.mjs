// @test-group product
// ts-typecheck-gate-listgates.test.mjs — split out of ts-typecheck-gate.test.mjs
// (gap-suite-split-long-multi-test-files): M63 A1 — listGates() includes the ts-typecheck testPass
// gate registered in this repo's own gates wiring. The test body is byte-identical to the original;
// only its file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { listGates, REPO_ROOT } from "./ts-typecheck-gate-helpers.mjs";

test("M63 A1: listGates() includes 'ts-typecheck'", () => {
  assert.ok(listGates(REPO_ROOT).includes("ts-typecheck"));
});
