// @test-group product
// lifecycle-cli-ac1-precond.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): C [AC1] — `quay complete <todo-task>` → exit 1
// precondition-reject, status unchanged, no gate. The test body is byte-identical to the original;
// only its file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";

import { makeWorkspace, runNative, runQuay, validSections, acDodChecked } from "./lifecycle-helpers.mjs";

test("C [AC1]: `quay complete <todo-task>` → exit 1 precondition-reject, status unchanged, no gate", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac1-precond");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "LC-TODO", "--title", "todo task", "--status", "todo",
    "--body", validSections + acDodChecked], tasksDir);
  runQuay(["task", "edit", "LC-TODO", "--acceptance", "true"], workspaceRoot);

  const r = runQuay(["complete", "LC-TODO", "--file", logFile], workspaceRoot);
  assert.equal(r.status, 1, `expected exit 1; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /illegal transition: todo cannot complete \(must be ready\)/);
  const after = JSON.parse(runQuay(["task", "view", "LC-TODO", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "todo", "status unchanged");
  // No gate event was written (precondition ran before any gate).
  assert.ok(!fs.existsSync(logFile), "no gate log written on precondition reject");
});
