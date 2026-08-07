// @test-group engine
// quay-dispatch.test.mjs — the ③ 派发与并发 entry point (SPEC-instruments-behind-one-entry.md AC8/AC12;
// gap-ac8-import-over-spawn-ticked-while-its-own-evidence-says-not-in-effect AC1/AC2). PURE-IMPORT.

import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUP, MEMBERS, list, has, run } from "../scripts/quay-dispatch.ts";
import { scriptsDir, makeFakeExec, assertMembers } from "./quay-entry-test-helpers.mjs";

test("quay-dispatch: GROUP is quay-dispatch and the SPEC AC12 member set is registered", () => {
  assert.equal(GROUP, "quay-dispatch");
  const want = [
    "cap-from-gate", "slot-refill", "ready-pool-check", "concurrent-batch-scheduler",
    "touches-orthogonality-check", "resource-gate",
  ];
  assert.ok(assertMembers(MEMBERS, want), `members=${MEMBERS.map((m) => m.name).join(",")}`);
  assert.equal(list().length, 6);
});

test("quay-dispatch: has() resolves members and rejects unknown names", () => {
  assert.ok(has("cap-from-gate"));
  assert.ok(has("resource-gate"));
  assert.equal(has("nope"), false);
});

test("quay-dispatch: cap-from-gate routes to the .ts module (the thin .sh wrapper's definition)", () => {
  const record = [];
  const res = run("cap-from-gate", ["--root", "/r", "--samples", "2"], { scriptDir: scriptsDir(), exec: makeFakeExec(record) });
  assert.equal(res.status, 0);
  assert.equal(record[0].command, process.execPath);
  assert.ok(record[0].argv.some((a) => a.endsWith("cap-from-gate.ts")), JSON.stringify(record[0].argv));
  assert.ok(record[0].argv.includes("--root") && record[0].argv.includes("/r"));
  assert.ok(record[0].argv.includes("--samples") && record[0].argv.includes("2"));
});

test("quay-dispatch: resource-gate is a real bash member (spawned as bash)", () => {
  const record = [];
  const res = run("resource-gate", ["--for", "full-suite"], { scriptDir: scriptsDir(), exec: makeFakeExec(record) });
  assert.equal(res.status, 0);
  assert.equal(record[0].command, "bash");
  assert.ok(record[0].argv[0].endsWith("resource-gate.sh"));
  assert.deepEqual(record[0].argv.slice(1), ["--for", "full-suite"]);
});

test("quay-dispatch: run() on an unknown member returns status 2", () => {
  const res = run("bogus", [], { scriptDir: scriptsDir(), exec: makeFakeExec([]) });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /no such instrument "bogus"/);
});
