// @test-group product
// ts-typecheck-gate-cli-list.test.mjs — split out of ts-typecheck-gate.test.mjs
// (gap-suite-split-long-multi-test-files): M63 C1 — `quay gate --list` includes 'ts-typecheck'.
// The test body is byte-identical to the original; only its file placement changed so node:test's
// file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runQuay, REPO_ROOT } from "./ts-typecheck-gate-helpers.mjs";

test("M63 C1: `quay gate --list` includes 'ts-typecheck'", () => {
  const r = runQuay(["gate", "--list"], REPO_ROOT);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.split("\n").includes("ts-typecheck"), `got: ${r.stdout}`);
});
