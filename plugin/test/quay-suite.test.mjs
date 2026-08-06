// @test-group engine
// quay-suite.test.mjs — the ⑤ 套件与门禁 entry point (SPEC-instruments-behind-one-entry.md AC8/AC12;
// gap-ac8-import-over-spawn-ticked-while-its-own-evidence-says-not-in-effect AC1/AC2). PURE-IMPORT.

import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUP, MEMBERS, list, has, run } from "../scripts/quay-suite.ts";
import { scriptsDir, makeFakeExec, assertMembers } from "./quay-entry-test-helpers.mjs";

test("quay-suite: GROUP is quay-suite and the SPEC AC12 member set is registered", () => {
  assert.equal(GROUP, "quay-suite");
  const want = ["fast-mode-telemetry", "full-suite-runner", "suite-state-trigger", "laydown-set-check", "loop-driver-check"];
  assert.ok(assertMembers(MEMBERS, want), `members=${MEMBERS.map((m) => m.name).join(",")}`);
  assert.equal(list().length, 5);
});

test("quay-suite: has() resolves members and rejects unknown names", () => {
  assert.ok(has("fast-mode-telemetry"));
  assert.ok(has("loop-driver-check"));
  assert.equal(has("nope"), false);
});

test("quay-suite: fast-mode-telemetry is a .ts member dispatched under node --experimental-strip-types", () => {
  const record = [];
  const res = run("fast-mode-telemetry", ["--report", "--json"], { scriptDir: scriptsDir(), exec: makeFakeExec(record) });
  assert.equal(res.status, 0);
  assert.equal(record[0].command, process.execPath);
  assert.ok(record[0].argv.some((a) => a.endsWith("fast-mode-telemetry.ts")), JSON.stringify(record[0].argv));
  assert.ok(record[0].argv.includes("--report") && record[0].argv.includes("--json"));
});

test("quay-suite: laydown-set-check is a bash member", () => {
  const record = [];
  const res = run("laydown-set-check", [], { scriptDir: scriptsDir(), exec: makeFakeExec(record) });
  assert.equal(res.status, 0);
  assert.equal(record[0].command, "bash");
  assert.ok(record[0].argv[0].endsWith("laydown-set-check.sh"));
});

test("quay-suite: run() on an unknown member returns status 2", () => {
  const res = run("bogus", [], { scriptDir: scriptsDir(), exec: makeFakeExec([]) });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /no such instrument "bogus"/);
});
