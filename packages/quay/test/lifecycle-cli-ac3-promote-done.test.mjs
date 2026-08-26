// @test-group product
// lifecycle-cli-ac3-promote-done.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): C [AC3] — `quay promote <done>` → nonzero + `illegal
// transition: done cannot forward`, no stack trace. The test body is byte-identical to the
// original; only its file placement changed so node:test's file-level concurrency can parallelize
// it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeWorkspace, runNative, runQuay, validSections, acDodChecked, STACK_FRAME_PATTERN } from "./lifecycle-helpers.mjs";

test("C [AC3]: `quay promote <done>` → nonzero + `illegal transition: done cannot forward`, no stack trace", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac3-promote");
  runNative(["task", "create", "LC-PM", "--title", "done promote", "--status", "done",
    "--body", validSections + acDodChecked], tasksDir);
  const r = runQuay(["promote", "LC-PM"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected nonzero; got ${r.status}, stdout=${r.stdout}`);
  assert.match(r.stderr, /^illegal transition: done cannot forward\s*$/m, `expected exact clean message line; got stderr=${JSON.stringify(r.stderr)}`);
  assert.ok(!STACK_FRAME_PATTERN.test(r.stderr), `stderr must NOT contain a raw stack trace; got: ${r.stderr}`);
});
