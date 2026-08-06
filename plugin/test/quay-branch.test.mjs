// @test-group engine
// quay-branch.test.mjs — the ④ 分支与认领 entry point (SPEC-instruments-behind-one-entry.md AC8/AC12;
// gap-ac8-import-over-spawn-ticked-while-its-own-evidence-says-not-in-effect AC1/AC2). PURE-IMPORT.

import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUP, MEMBERS, list, has, run } from "../scripts/quay-branch.ts";
import { scriptsDir, makeFakeExec, assertMembers } from "./quay-entry-test-helpers.mjs";

test("quay-branch: GROUP is quay-branch and the SPEC AC12 member set is registered", () => {
  assert.equal(GROUP, "quay-branch");
  const want = [
    "claim-task", "release-task", "fork-baseline", "integration-branch-model",
    "integration-batch-merge", "sync-lag-check",
  ];
  assert.ok(assertMembers(MEMBERS, want), `members=${MEMBERS.map((m) => m.name).join(",")}`);
  assert.equal(list().length, 6);
});

test("quay-branch: has() resolves members and rejects unknown names", () => {
  assert.ok(has("claim-task"));
  assert.ok(has("fork-baseline"));
  assert.equal(has("nope"), false);
});

test("quay-branch: claim-task routes the CLAIM form (<task-id> + --remote) to the .sh primitive", () => {
  const record = [];
  const res = run("claim-task", ["QX-001", "--remote", "origin", "--dry-run"], { scriptDir: scriptsDir(), exec: makeFakeExec(record) });
  assert.equal(res.status, 0);
  assert.equal(record[0].command, "bash");
  assert.ok(record[0].argv[0].endsWith("claim-task.sh"), JSON.stringify(record[0].argv));
  assert.deepEqual(record[0].argv.slice(1), ["QX-001", "--remote", "origin", "--dry-run"]);
});

test("quay-branch: claim-task routes the TOUCH-CHECK form (--task/--in-flight) to the .ts checker", () => {
  const record = [];
  const res = run("claim-task", ["--task", "/repo/tasks/x.md", "--root", "/repo", "--in-flight", "QX-002"], { scriptDir: scriptsDir(), exec: makeFakeExec(record) });
  assert.equal(res.status, 0);
  assert.equal(record[0].command, process.execPath);
  assert.ok(record[0].argv.some((a) => a.endsWith("claim-task.ts")), JSON.stringify(record[0].argv));
  assert.ok(record[0].argv.includes("--task"));
});

test("quay-branch: run() on an unknown member returns status 2", () => {
  const res = run("bogus", [], { scriptDir: scriptsDir(), exec: makeFakeExec([]) });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /no such instrument "bogus"/);
});
