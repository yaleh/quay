// @test-group product
// lifecycle-cli-ac3-retreat-todo.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): C [AC3] — `quay retreat <todo> --reason x` → nonzero +
// `illegal transition: todo cannot back`, no stack trace. The test body is byte-identical to the
// original; only its file placement changed so node:test's file-level concurrency can parallelize
// it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeWorkspace, runNative, runQuay, validSections, acDodChecked, STACK_FRAME_PATTERN } from "./lifecycle-helpers.mjs";

test("C [AC3]: `quay retreat <todo> --reason x` → nonzero + `illegal transition: todo cannot back`, no stack trace", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac3-retreat");
  runNative(["task", "create", "LC-RT", "--title", "todo retreat", "--status", "todo",
    "--body", validSections + acDodChecked], tasksDir);
  const r = runQuay(["retreat", "LC-RT", "--reason", "x"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected nonzero; got ${r.status}, stdout=${r.stdout}`);
  assert.match(r.stderr, /^illegal transition: todo cannot back\s*$/m, `expected exact clean message line; got stderr=${JSON.stringify(r.stderr)}`);
  assert.ok(!STACK_FRAME_PATTERN.test(r.stderr), `stderr must NOT contain a raw stack trace; got: ${r.stderr}`);
  assert.ok(!r.stderr.includes(".js:"), `stderr must not contain a file:line stack frame; got: ${r.stderr}`);
});
