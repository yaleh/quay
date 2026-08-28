// @test-group product
// lifecycle-cli-superseded-retreat.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): C [SUPERSEDED] — `quay retreat <superseded> --reason x`
// → nonzero + `illegal transition: superseded cannot back` (hard terminal, no revival). The test
// body is byte-identical to the original; only its file placement changed so node:test's
// file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeWorkspace, runNative, runQuay, validSections, acDodChecked, STACK_FRAME_PATTERN } from "./lifecycle-helpers.mjs";

test("C [SUPERSEDED]: `quay retreat <superseded> --reason x` → nonzero + `illegal transition: superseded cannot back` (hard terminal, no revival)", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac3-superseded-retreat");
  runNative(["task", "create", "LC-SUP2", "--title", "superseded retreat", "--status", "superseded",
    "--body", validSections + acDodChecked], tasksDir);
  const r = runQuay(["retreat", "LC-SUP2", "--reason", "try to revive"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected nonzero; got ${r.status}, stdout=${r.stdout}`);
  assert.match(r.stderr, /^illegal transition: superseded cannot back\s*$/m, `expected exact clean message line; got stderr=${JSON.stringify(r.stderr)}`);
  assert.ok(!STACK_FRAME_PATTERN.test(r.stderr), `stderr must NOT contain a raw stack trace; got: ${r.stderr}`);
});
