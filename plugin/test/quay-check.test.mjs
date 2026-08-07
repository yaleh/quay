// @test-group engine
// quay-check.test.mjs — the ⑥ 任务与文档校验 entry point (SPEC-instruments-behind-one-entry.md AC8/AC12;
// gap-ac8-import-over-spawn-ticked-while-its-own-evidence-says-not-in-effect AC1/AC2). PURE-IMPORT.
// read-probe-spec is a LIBRARY (readProbeSpec, no CLI): it is re-exported by quay-check for in-process
// import, NOT a spawnable member — this test pins that contract.

import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUP, MEMBERS, list, has, run, readProbeSpec } from "../scripts/quay-check.ts";
import { scriptsDir, makeFakeExec, assertMembers } from "./quay-entry-test-helpers.mjs";

test("quay-check: GROUP is quay-check and the SPEC AC12 member set is registered (read-probe-spec is a library, not a member)", () => {
  assert.equal(GROUP, "quay-check");
  const want = [
    "task-contract-check", "task-schema-check", "task-status-drift-check",
    "self-report-vocab-check", "self-report-vocab-audit", "strategic-doc-staleness-check",
  ];
  assert.ok(assertMembers(MEMBERS, want), `members=${MEMBERS.map((m) => m.name).join(",")}`);
  assert.equal(list().length, 6);
  // read-probe-spec is intentionally NOT a spawnable member (library-only) — but it IS importable.
  assert.equal(has("read-probe-spec"), false);
  assert.equal(typeof readProbeSpec, "function");
});

test("quay-check: has() resolves members and rejects unknown names", () => {
  assert.ok(has("task-contract-check"));
  assert.ok(has("task-schema-check"));
  assert.equal(has("nope"), false);
});

test("quay-check: task-contract-check is a .ts member dispatched under node", () => {
  const record = [];
  const res = run("task-contract-check", [], { scriptDir: scriptsDir(), exec: makeFakeExec(record) });
  assert.equal(res.status, 0);
  assert.equal(record[0].command, process.execPath);
  assert.ok(record[0].argv.some((a) => a.endsWith("task-contract-check.ts")), JSON.stringify(record[0].argv));
});

test("quay-check: run() on an unknown member returns status 2", () => {
  const res = run("bogus", [], { scriptDir: scriptsDir(), exec: makeFakeExec([]) });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /no such instrument "bogus"/);
});
