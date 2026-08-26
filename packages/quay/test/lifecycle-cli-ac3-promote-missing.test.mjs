// @test-group product
// lifecycle-cli-ac3-promote-missing.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): C [AC3] — `quay promote <nonexistent-id>` → clean `no
// such task: ...` message, no stack trace. The test body is byte-identical to the original; only
// its file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeWorkspace, runQuay, STACK_FRAME_PATTERN } from "./lifecycle-helpers.mjs";

test("C [AC3]: `quay promote <nonexistent-id>` → clean `no such task: ...` message, no stack trace", () => {
  const { workspaceRoot } = makeWorkspace("ac3-promote-missing");
  const r = runQuay(["promote", "NOPE-MISSING"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected nonzero; got ${r.status}, stdout=${r.stdout}`);
  assert.match(r.stderr, /^no such task: NOPE-MISSING\s*$/m, `expected exact clean message line; got stderr=${JSON.stringify(r.stderr)}`);
  assert.ok(!STACK_FRAME_PATTERN.test(r.stderr), `stderr must NOT contain a raw stack trace; got: ${r.stderr}`);
});
