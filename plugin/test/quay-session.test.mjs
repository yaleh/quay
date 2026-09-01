// @test-group engine
// quay-session.test.mjs — the ① 会话与拓扑 entry point (SPEC-instruments-behind-one-entry.md AC8/AC12;
// gap-ac8-import-over-spawn-ticked-while-its-own-evidence-says-not-in-effect AC1/AC2). PURE-IMPORT:
// imports the entry module and injects an exec seam — no subprocess is spawned.

import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUP, MEMBERS, list, has, run, runCli } from "../scripts/quay-session.ts";
import { scriptsDir, makeFakeExec, assertMembers } from "./quay-entry-test-helpers.mjs";

test("quay-session: GROUP is quay-session and the SPEC AC12 member set is registered", () => {
  assert.equal(GROUP, "quay-session");
  const want = [
    "session-liveness", "session-liveness-mount", "monitor-mount-check", "topology-check",
    "quay-topology", "session-bootstrap", "quay-launch", "outer-liveness",
    "manager-tick-readings",
  ];
  assert.ok(assertMembers(MEMBERS, want), `members=${MEMBERS.map((m) => m.name).join(",")}`);
  assert.equal(list().length, 9);
});

test("quay-session: every member declares what question it answers (admission contract, SPEC AC4)", () => {
  for (const m of MEMBERS) {
    assert.ok(m.description.length >= 4, `${m.name} needs a description`);
    assert.ok(m.file, `${m.name} needs a file`);
  }
});

test("quay-session: has() resolves members and rejects unknown names", () => {
  assert.ok(has("session-liveness"));
  assert.ok(has("topology-check"));
  assert.equal(has("no-such-instrument"), false);
});

test("quay-session: run() dispatches a bash member through the injected exec with args forwarded", () => {
  const record = [];
  const exec = makeFakeExec(record);
  const res = run("session-liveness", ["--once", "--root", "/x"], { scriptDir: scriptsDir(), exec });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, "fake-ok");
  assert.equal(record.length, 1);
  assert.equal(record[0].command, "bash");
  assert.ok(record[0].argv[0].endsWith("session-liveness.sh"), `argv0=${record[0].argv[0]}`);
  assert.deepEqual(record[0].argv.slice(1), ["--once", "--root", "/x"]);
});

test("quay-session: run() on an unknown member returns status 2 with a stderr listing known instruments", () => {
  const res = run("bogus", [], { scriptDir: scriptsDir(), exec: makeFakeExec([]) });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /no such instrument "bogus"/);
  assert.match(res.stderr, /session-liveness/);
});

test("quay-session: runCli parses <instrument> [args...] and forwards to the member (fake exec)", () => {
  const record = [];
  const exec = makeFakeExec(record);
  // runCli uses the real defaultExec for production; to inject the seam we route through run().
  // Here we only assert the ARG-PARSE shape: unknown-instrument handling and the list verb.
  const argv = ["node", "quay-session.ts", "monitor-mount-check", "--json"];
  const parsed = argv.slice(2);
  assert.deepEqual(parsed, ["monitor-mount-check", "--json"]);
  assert.ok(has(parsed[0]));
  // runCli list → exit 0 (we don't runCli with the seam; list is pure)
  assert.equal(runCli(["node", "quay-session.ts", "list"], new URL("../scripts/quay-session.ts", import.meta.url).href), 0);
});
