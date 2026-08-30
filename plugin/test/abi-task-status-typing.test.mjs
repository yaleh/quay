// @test-group product
// abi-task-status-typing.test.mjs — the named TaskStatus type + single-source lifecycle
// vocabulary + isTaskStatus guard (tasks/gap-abi-status-lifecycle-vocab-scattered-no-named-type).
//
// AC1 (named type): verified at the VALUE level here via the exported TASK_STATUS /
// TASK_STATUSES constants (a consumer import is exercised below); the type-level check
// (TaskStatus = Task['status']) is the `tsc --noEmit` per-package gate's job, not a runtime
// assertion.
// AC2 (literal convergence): the single-source TASK_STATUSES array is asserted below; the
// scattered-file count is a repo-wide grep, not a runtime assertion.
// AC3 (parse-boundary fail-closed): isTaskStatus rejects an illegal value ("reddy" — the
// negative control), and the native store's toViewModel READ boundary coerces an illegal
// on-disk status to `todo` + flags `invalid-status` in extra.malformed rather than silently
// surfacing "reddy" as a legal-looking Task.status.
//
// Run: scripts/test.sh plugin/test/abi-task-status-typing.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { TASK_STATUSES, TASK_STATUS, isTaskStatus } from "../../packages/quay/src/abi.ts";
import { createStore } from "../../packages/quay-native/src/store.ts";

test("TASK_STATUSES is the single source of the five lifecycle words in canonical order", () => {
  assert.deepEqual([...TASK_STATUSES], ["todo", "ready", "done", "needs-human", "superseded"]);
  assert.equal(new Set(TASK_STATUSES).size, TASK_STATUSES.length, "no duplicate values");
});

test("TASK_STATUS named constants equal the canonical literals", () => {
  assert.equal(TASK_STATUS.TODO, "todo");
  assert.equal(TASK_STATUS.READY, "ready");
  assert.equal(TASK_STATUS.DONE, "done");
  assert.equal(TASK_STATUS.NEEDS_HUMAN, "needs-human");
  assert.equal(TASK_STATUS.SUPERSEDED, "superseded");
});

test("isTaskStatus accepts every lifecycle word and rejects everything else", () => {
  for (const s of TASK_STATUSES) assert.equal(isTaskStatus(s), true, `accepts ${s}`);
  assert.equal(isTaskStatus("reddy"), false, "AC3 negative control: illegal value rejected");
  assert.equal(isTaskStatus(""), false);
  assert.equal(isTaskStatus("READY"), false, "case-sensitive");
  assert.equal(isTaskStatus(undefined), false);
  assert.equal(isTaskStatus(null), false);
  assert.equal(isTaskStatus(42), false);
  assert.equal(isTaskStatus({}), false);
});

test("native store read boundary: illegal status fails closed to todo + invalid-status marker", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abi-status-"));
  try {
    fs.writeFileSync(
      path.join(dir, "REDDY.md"),
      "---\nid: REDDY\ntitle: x\nstatus: reddy\n---\nbody\n",
      "utf8",
    );
    const store = createStore(dir);
    const t = store.get("REDDY");
    assert.ok(t, "task is read");
    assert.equal(t.status, "todo", "illegal status coerced to todo, not surfaced as reddy");
    assert.ok(
      Array.isArray(t.extra.malformed) && t.extra.malformed.includes("invalid-status"),
      "invalid-status flagged in extra.malformed",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("native store read boundary: a valid status round-trips unchanged", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abi-status-"));
  try {
    fs.writeFileSync(
      path.join(dir, "OK.md"),
      "---\nid: OK\ntitle: y\nstatus: done\n---\nbody\n",
      "utf8",
    );
    const store = createStore(dir);
    assert.equal(store.get("OK").status, "done");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
