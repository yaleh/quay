// @test-group product
// lifecycle-cli-ac2-adjudicate.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): C [AC2] — `quay adjudicate <id>` → exit 0; `gate-log
// --gate audit --json` lists the audit event. The test body is byte-identical to the original; only
// its file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { makeWorkspace, runNative, runQuay, validSections, acDodChecked } from "./lifecycle-helpers.mjs";

test("C [AC2]: `quay adjudicate <id>` → exit 0; `gate-log --gate audit --json` lists the audit event", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac2");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "LC-ADJ", "--title", "adjudicate me", "--status", "ready",
    "--body", validSections + acDodChecked], tasksDir);

  const r = runQuay(["adjudicate", "LC-ADJ", "--file", logFile], workspaceRoot);
  assert.equal(r.status, 0, `expected exit 0; got ${r.status}, stderr=${r.stderr}`);

  const log = runQuay(["gate-log", "LC-ADJ", "--gate", "audit", "--json", "--file", logFile], workspaceRoot);
  assert.equal(log.status, 0);
  const events = JSON.parse(log.stdout);
  assert.ok(events.length >= 1, `expected >=1 audit event; got ${log.stdout}`);
  assert.ok(events.every((e) => e.gate === "audit"));
});
