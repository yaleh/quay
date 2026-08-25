// @test-group product
// lifecycle-cli-dir102-ac1.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): C [DIR-102 AC1] — `quay retreat <needs-human> --reason
// x` → exit 0, status=todo. The test body is byte-identical to the original; only its file
// placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { makeWorkspace, runNative, runQuay, validSections, acDodChecked } from "./lifecycle-helpers.mjs";

test("C [DIR-102 AC1]: `quay retreat <needs-human> --reason x` → exit 0, status=todo", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("dir102-ac1");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "NH-RET", "--title", "needs-human retreat", "--status", "needs-human",
    "--body", validSections + acDodChecked], tasksDir);

  const r = runQuay(["retreat", "NH-RET", "--reason", "dependency installed", "--file", logFile], workspaceRoot);
  assert.equal(r.status, 0, `expected exit 0; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /RETREAT needs-human → todo/);

  const after = JSON.parse(runQuay(["task", "view", "NH-RET", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "todo", "status must be todo after retreat");

  // AC2: verify GateEvent recorded
  const log = runQuay(["gate-log", "NH-RET", "--gate", "retreat", "--json", "--file", logFile], workspaceRoot);
  assert.equal(log.status, 0);
  const events = JSON.parse(log.stdout);
  assert.ok(events.length >= 1, `expected >=1 retreat event; got ${log.stdout}`);
  assert.equal(events[0].gate, "retreat");
  assert.equal(events[0].verdict, "pass");
  assert.equal(events[0].payload.reason, "dependency installed");
});
