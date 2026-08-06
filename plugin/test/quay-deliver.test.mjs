// @test-group engine
// quay-deliver.test.mjs — the ② 送达与抢占 entry point (SPEC-instruments-behind-one-entry.md AC8/AC12;
// gap-ac8-import-over-spawn-ticked-while-its-own-evidence-says-not-in-effect AC1/AC2). PURE-IMPORT.

import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUP, MEMBERS, list, has, run } from "../scripts/quay-deliver.ts";
import { scriptsDir, makeFakeExec, assertMembers } from "./quay-entry-test-helpers.mjs";

test("quay-deliver: GROUP is quay-deliver and the SPEC AC12 member set is registered", () => {
  assert.equal(GROUP, "quay-deliver");
  const want = [
    "send-keys-reliable", "supervisor-preempt", "supervisor-bus-identity",
    "supervisor-deliver", "inner-blocked-signal", "inner-forensics",
  ];
  assert.ok(assertMembers(MEMBERS, want), `members=${MEMBERS.map((m) => m.name).join(",")}`);
  assert.equal(list().length, 6);
});

test("quay-deliver: has() resolves members and rejects unknown names", () => {
  assert.ok(has("inner-blocked-signal"));
  assert.ok(has("send-keys-reliable"));
  assert.equal(has("nope"), false);
});

test("quay-deliver: run() dispatches a .ts member under node --experimental-strip-types", () => {
  const record = [];
  const exec = makeFakeExec(record);
  const res = run("inner-blocked-signal", ["--detect-stop", "--pane", "/tmp/p"], { scriptDir: scriptsDir(), exec });
  assert.equal(res.status, 0);
  assert.equal(record[0].command, process.execPath);
  assert.ok(record[0].argv.some((a) => a.endsWith("inner-blocked-signal.ts")), JSON.stringify(record[0].argv));
  assert.ok(record[0].argv.includes("--experimental-strip-types"));
  assert.ok(record[0].argv.includes("--detect-stop"));
});

test("quay-deliver: run() dispatches a .mjs member under node", () => {
  const record = [];
  const res = run("inner-forensics", [], { scriptDir: scriptsDir(), exec: makeFakeExec(record) });
  assert.equal(record[0].command, process.execPath);
  assert.ok(record[0].argv.some((a) => a.endsWith("inner-forensics.mjs")), JSON.stringify(record[0].argv));
});

test("quay-deliver: run() on an unknown member returns status 2", () => {
  const res = run("bogus", [], { scriptDir: scriptsDir(), exec: makeFakeExec([]) });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /no such instrument "bogus"/);
});
