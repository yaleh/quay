// @test-group engine
// mirror-full-suite-state.test.mjs — gap-full-suite-state-stale-no-writer AC1/AC3: the fan-in
// detached-suite path (setsid bash scripts/test.sh) never goes through full-suite-runner.ts (the
// ONLY full-suite-state.json writer) ⇒ the state file went stale. This file pins the NEW thin writer
// (plugin/scripts/mirror-full-suite-state.ts) that mirror-writes the terminal GREEN state reflecting
// a fan-in's real suite round to <shared-checkout>/.quay/full-suite-state.json.
//
//   writer      — buildMirrorState emits a full-suite-runner SuiteState-compatible state (state/runner/
//                 startedAt/finishedAt(epoch)/durationMs/laneCount/scope/commit); writeMirrorState
//                 OVERWRITES the single-state file (never appends).
//   fail-closed — a missing/invalid required field returns {error} and the caller writes NOTHING
//                 (硬规则 3b); a red state without a reason is refused.
//   finishedAt  — explicit ISO/epoch, or derived (startedAt + durationMs) when absent; always EPOCH
//                 SECONDS (the full-suite-runner convention the freshness gate parses).
//
// ⛔ MODULE-ONLY since gap-mirror-full-suite-state-retire-dead-cli-face (2026-09-18): the file's CLI
// entry was retired (its only caller was the deleted fan-in step 4.5). Every case below calls the
// module IN-PROCESS — no case launches the file as a subprocess, because there is no CLI to launch.
//
// Run:
//   scripts/test.sh plugin/test/mirror-full-suite-state.test.mjs
//   node --test plugin/test/mirror-full-suite-state.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildMirrorState, writeMirrorState, shouldSkipMirrorWrite, readCurrentState } from "../scripts/mirror-full-suite-state.ts";

const _tmpDirs = [];
function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const d of _tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  }
});

const BASE = {
  state: "green",
  startedAt: "2026-08-18T04:30:00.000Z",
  finishedAt: "2026-08-18T04:45:36.519Z",
  durationMs: "936519",
  laneCount: "8",
  load: "8.03",
  commit: "426b21ceaabbe7502334d92d79ce4a4a8d935fe9",
};

test("AC1/AC3 — buildMirrorState emits a full-suite-runner-compatible terminal state (green, epoch finishedAt)", () => {
  const { state, error } = buildMirrorState(BASE);
  assert.equal(error, undefined, `build must succeed: ${error}`);
  assert.equal(state.state, "green");
  assert.equal(state.runner, "inner", "the fan-in suite is an inner-layer run (default)");
  assert.equal(state.scope, "worktree", "the fan-in suite ran against the worktree HEAD");
  assert.equal(state.startedAt, "2026-08-18T04:30:00.000Z");
  assert.equal(state.finishedAt, Math.floor(Date.parse("2026-08-18T04:45:36.519Z") / 1000), "finishedAt is EPOCH SECONDS");
  assert.equal(state.durationMs, 936519);
  assert.equal(state.laneCount, 8);
  assert.equal(state.load, 8.03);
  assert.equal(state.commit, BASE.commit);
});

test("AC1 — finishedAt is derived (startedAt + durationMs) when --finished-at is absent, still epoch seconds", () => {
  const { state, error } = buildMirrorState({ ...BASE, finishedAt: undefined });
  assert.equal(error, undefined, `build must succeed: ${error}`);
  assert.equal(
    state.finishedAt,
    Math.floor((Date.parse("2026-08-18T04:30:00.000Z") + 936519) / 1000),
    "derived finishedAt = startedAt + durationMs, in epoch seconds",
  );
});

test("AC1 — optional taskId/runId carry traceability; omitted fields are absent (never fabricated)", () => {
  const { state } = buildMirrorState({ ...BASE, taskId: "gap-test-mirror", runId: "fm-mirror-1" });
  assert.equal(state.taskId, "gap-test-mirror");
  assert.equal(state.runId, "fm-mirror-1");
  const bare = buildMirrorState({ ...BASE, taskId: undefined, runId: undefined }).state;
  assert.equal(bare.taskId, undefined, "absent taskId stays absent");
  assert.equal(bare.runId, undefined, "absent runId stays absent");
  assert.equal(bare.reason, undefined, "a green state has no reason");
});

test("fail-closed — a missing/invalid required field returns {error} and writes NOTHING (硬规则 3b)", () => {
  assert.match(buildMirrorState({ ...BASE, state: "yellow" }).error ?? "", /state/);
  assert.match(buildMirrorState({ ...BASE, startedAt: "not-a-time" }).error ?? "", /started-at/);
  assert.match(buildMirrorState({ ...BASE, durationMs: "-1" }).error ?? "", /duration-ms/);
  assert.match(buildMirrorState({ ...BASE, laneCount: "abc" }).error ?? "", /lane-count/);
  assert.match(buildMirrorState({ ...BASE, commit: "short" }).error ?? "", /commit/);
  assert.match(buildMirrorState({ ...BASE, load: "-1" }).error ?? "", /load/);
  // a red state must carry a reason — refuse a reason-less red (the mirror is not called red today,
  // but the guard keeps a future red mirror from writing an unattributed red).
  assert.match(buildMirrorState({ ...BASE, state: "red", reason: "" }).error ?? "", /reason/);
  const redOk = buildMirrorState({ ...BASE, state: "red", reason: "failed" });
  assert.equal(redOk.error, undefined, "a red with a reason builds");
  assert.equal(redOk.state.state, "red");
  assert.equal(redOk.state.reason, "failed");
});

test("AC1 — writeMirrorState OVERWRITES the single-state file (never appends)", () => {
  const dir = tmpDir("mirror-state-");
  const file = path.join(dir, ".quay", "full-suite-state.json");
  writeMirrorState(file, { state: "green", startedAt: "a", finishedAt: 1, durationMs: 1, laneCount: 1, commit: BASE.commit });
  writeMirrorState(file, { state: "green", startedAt: "b", finishedAt: 2, durationMs: 2, laneCount: 2, commit: BASE.commit });
  // A single-state file parses as ONE JSON object — an APPEND would concatenate two objects and
  // JSON.parse would throw. Parsing cleanly AND yielding the second write's value proves overwrite.
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(parsed.startedAt, "b", "the second write replaced the first (overwrite, not append)");
  assert.equal(parsed.finishedAt, 2);
});

test("AC1 — shouldSkipMirrorWrite: an in-flight round (finishedAt null) SKIPS; a terminal/absent state WRITES (never clobber the runner's generation)", () => {
  assert.equal(shouldSkipMirrorWrite(null), false, "absent state ⇒ write");
  assert.equal(shouldSkipMirrorWrite({ state: "running", finishedAt: null }), true, "running (finishedAt null) ⇒ skip");
  assert.equal(shouldSkipMirrorWrite({ state: "red", finishedAt: null, pid: 123 }), true, "early-red (finishedAt null, runner still collecting) ⇒ skip");
  assert.equal(shouldSkipMirrorWrite({ state: "green", finishedAt: 1789000000 }), false, "terminal green ⇒ write");
  assert.equal(shouldSkipMirrorWrite({ state: "red", finishedAt: 1789000000 }), false, "terminal red ⇒ write (a newer fan-in green legitimately overwrites a COMPLETED red)");
});

test("AC1 — a running on-disk state makes the mirror SKIP (in-process: disk → readCurrentState → shouldSkipMirrorWrite)", () => {
  const dir = tmpDir("mirror-skip-");
  const file = path.join(dir, "full-suite-state.json");
  fs.writeFileSync(file, JSON.stringify({ state: "running", finishedAt: null, runId: "outer-gen", pid: 1 }) + "\n", "utf8");
  // The skip decision on a REAL on-disk state (not a hand-built literal): the caller's sequence is
  // readCurrentState(file) → shouldSkipMirrorWrite(current) ⇒ no write. The round-trip through the
  // disk is the part the literal-object case above cannot cover (an unparseable/garbled state must
  // also read as "safe to overwrite", and a running one must not).
  const onDisk = readCurrentState(file);
  assert.equal(onDisk.state, "running", "readCurrentState parses the on-disk state");
  assert.equal(shouldSkipMirrorWrite(onDisk), true, "a non-terminal on-disk state ⇒ the mirror must SKIP (no clobber)");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).state, "running", "the in-flight running state is NOT overwritten");
});
