// @test-group product
// lifecycle-cli-retreated-e2e.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): C [RETREATED-E2E AC2] — real `quay retreat` writes
// **RETREATED to the task file AND slot-refill defers the retreated ready task. The test body is
// byte-identical to the original; only its file placement changed so node:test's file-level
// concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

import {
  makeSlotNativeWorkspace, runNative, runQuay, validSections, acDodChecked, SLOT_REFILL_CLI,
} from "./lifecycle-helpers.mjs";

test("C [RETREATED-E2E AC2]: real `quay retreat` writes **RETREATED to the task file AND slot-refill defers the retreated ready task", () => {
  const { root, tasksDir } = makeSlotNativeWorkspace("retreated-e2e");
  // A dispatchable done task (self-touch + (new) touch resolve cleanly) — only the marker the
  // retreat writes may remove it from the dispatch recommendation.
  const dispatchable = validSections + acDodChecked +
    "## Touches\n- code/ret-e2e.ts (new)\n- tasks/E2E-RET.md\n";
  runNative(["task", "create", "E2E-RET", "--title", "e2e retreat", "--status", "done",
    "--body", dispatchable], tasksDir);

  const r = runQuay(["retreat", "E2E-RET", "--reason", "load-induced red — wait for fix-scope gate"], root);
  assert.equal(r.status, 0, `retreat exit 0; stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /RETREAT done → ready/);

  // Write side: the REAL task file on disk carries the marker.
  const fileBody = fs.readFileSync(path.join(tasksDir, "E2E-RET.md"), "utf8");
  assert.match(fileBody, /^\s*>\s*\*\*RETREATED\b/im, `task file must carry the marker; got:\n${fileBody}`);
  const after = JSON.parse(runQuay(["task", "view", "E2E-RET", "--json"], root).stdout);
  assert.equal(after.status, "ready", "done→ready flips status");

  // Detection side: the REAL slot-refill CLI reads the written marker and defers the task
  // (reason "retreated") — the task is NOT recommended for dispatch.
  const slot = JSON.parse(execFileSync(process.execPath, [
    "--no-warnings", "--experimental-strip-types", SLOT_REFILL_CLI, "--root", root, "--cap", "5",
  ], { encoding: "utf8", env: { ...process.env, QUAY_TELEMETRY_SUBAGENTS: "0" } }));
  assert.ok(!(slot.recommended ?? []).includes("E2E-RET"), "retreated task is NOT recommended for dispatch");
  const ret = (slot.deferred ?? []).find((d) => d.id === "E2E-RET");
  assert.ok(ret && /retreated/.test(ret.reason), `E2E-RET deferred as retreated; got deferred=${JSON.stringify(slot.deferred)}`);
});
