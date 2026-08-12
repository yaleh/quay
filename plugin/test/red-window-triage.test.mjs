// @test-group engine
// red-window-triage.test.mjs — gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage
// AC3/AC4/AC6: the mechanical red-window triage (partition + isolate-rerun auto-trigger + verdict).
//
// Before this module, red-window triage was doc-only prose ("if the fail lands in the family, rerun
// the family in isolation before concluding") — a human/agent had to REMEMBER to do it, and a
// non-family failure (test-file-snapshot baseline REMOVED vs runner-grouping AC7 zz- fixture) could
// be swept into the environmental bucket. Coverage:
//   - partitionFailures: in-family (machine-readable manifest) vs not-in-family — never conflated.
//   - buildIsolateRerunCommand: EXACT isolated-rerun command for in-family failures (only the
//     family files, low load).
//   - applyTriage: writes in_family/kind + isolate_rerun onto the state's failures (traceable).
//   - recordVerdict: green (environmental + kind) vs red (not environmental).
//   - unverifiedFamilyFailures: the band — an in-family failure without isolate_rerun is red.
//   - CLI --partition / --record-verdict / --band.
//
// Run:
//   scripts/test.sh plugin/test/red-window-triage.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { scanFamily } from "../scripts/known-load-sensitive.ts";
import {
  partitionFailure,
  partitionFailures,
  buildIsolateRerunCommand,
  applyTriage,
  recordVerdict,
  unverifiedFamilyFailures,
} from "../scripts/red-window-triage.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const TS = path.join(REPO_ROOT, "plugin", "scripts", "red-window-triage.ts");

function runCli(args, stateFile, root = REPO_ROOT) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", TS, "--root", root, "--state", stateFile, ...args], {
    encoding: "utf8",
  });
}

function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function readState(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// ── partition (AC3/AC4) ─────────────────────────────────────────────────────────────────────────────
test("AC3 — partitionFailure marks an in-family file with in_family + kind, and only the right kind", () => {
  const family = scanFamily(REPO_ROOT);
  const wall = partitionFailure({ line: "not ok 1 - x", file: "plugin/test/session-liveness-events.test.mjs" }, family);
  assert.equal(wall.in_family, true);
  assert.equal(wall.kind, "wall-clock");

  const nested = partitionFailure({ line: "not ok 1 - x", file: "plugin/test/runner-grouping-list-groups.test.mjs" }, family);
  assert.equal(nested.in_family, true);
  assert.equal(nested.kind, "nested-spawn");

  // The two root causes get DIFFERENT kinds — 判读不得混用 (AC2).
  assert.notEqual(wall.kind, nested.kind);
});

test("AC4 — a not-in-family failure stays not-in-family and never auto-isolates", () => {
  const family = scanFamily(REPO_ROOT);
  const nonFamily = partitionFailure({ line: "not ok 1 - x", file: "plugin/test/full-suite-runner.test.mjs" }, family);
  assert.equal(nonFamily.in_family, false);
  assert.equal(nonFamily.kind, undefined);

  // A failure with no file context is conservatively not-in-family (never auto-isolated).
  const noFile = partitionFailure({ line: "not ok 1 - x" }, family);
  assert.equal(noFile.in_family, false);
});

test("AC4 negative control — a real non-family cross-file race (test-file-snapshot shape) is not auto-isolated", () => {
  const family = scanFamily(REPO_ROOT);
  const { inFamily, notInFamily } = partitionFailures(
    [
      { line: "not ok 1 - x", file: "plugin/test/runner-grouping-list-groups.test.mjs" },
      { line: "not ok 1 - baseline test file(s) REMOVED", file: "plugin/test/test-file-snapshot.test.mjs" },
    ],
    family,
  );
  assert.deepEqual(inFamily, ["plugin/test/runner-grouping-list-groups.test.mjs"]);
  assert.ok(notInFamily.some((f) => f.includes("test-file-snapshot")), "the cross-file race is not-in-family");
});

// ── isolate-rerun command (AC3) ─────────────────────────────────────────────────────────────────────
test("AC3 — buildIsolateRerunCommand emits an exact low-load command for the in-family files only", () => {
  const cmd = buildIsolateRerunCommand(["plugin/test/session-liveness-events.test.mjs"], REPO_ROOT);
  assert.ok(cmd.startsWith("bash scripts/test.sh "), cmd);
  assert.ok(cmd.includes("session-liveness-events.test.mjs"), cmd);
  assert.ok(!cmd.includes("--test-concurrency"), "low load — no concurrency splice");
});

test("AC3 — applyTriage writes in_family + kind + isolate_rerun onto the state's failures", () => {
  const family = scanFamily(REPO_ROOT);
  const state = {
    state: "red",
    reason: "failed",
    failures: [
      { line: "not ok 1 - x", file: "plugin/test/cold-start-skill.test.mjs" },
      { line: "not ok 1 - y", file: "plugin/test/full-suite-runner.test.mjs" },
    ],
  };
  const { state: out, inFamily, notInFamily, command } = applyTriage(state, family, REPO_ROOT);
  assert.deepEqual(inFamily, ["plugin/test/cold-start-skill.test.mjs"]);
  assert.equal(notInFamily.length, 1);
  assert.equal(out.failures[0].in_family, true);
  assert.equal(out.failures[0].kind, "wall-clock");
  assert.ok(out.failures[0].isolate_rerun.startsWith("bash scripts/test.sh "), "in-family failure gets an isolate-rerun command");
  assert.ok(command, "applyTriage returns the command");
  // Not-in-family failure gets NO isolate_rerun.
  assert.equal(out.failures[1].in_family, false);
  assert.equal(out.failures[1].isolate_rerun, undefined);
});

// ── verdict / band (AC3/AC6) ────────────────────────────────────────────────────────────────────────
test("AC3 — recordVerdict writes green (environmental) or red (not environmental) back with kind", () => {
  const family = scanFamily(REPO_ROOT);
  const state = {
    state: "red",
    reason: "failed",
    failures: [{ line: "not ok 1 - x", file: "plugin/test/session-liveness-signals-kinds.test.mjs", in_family: true, kind: "wall-clock", isolate_rerun: "bash scripts/test.sh ..." }],
  };
  const { state: triaged } = applyTriage(state, family, REPO_ROOT);
  const green = recordVerdict(triaged.failures, 0, "green");
  assert.equal(green[0].isolate_rerun_result, "green");
  const red = recordVerdict(triaged.failures, 0, "red");
  assert.equal(red[0].isolate_rerun_result, "red");
  assert.equal(recordVerdict(triaged.failures, 99, "green"), null, "out-of-range index → null");
});

test("AC6 — unverifiedFamilyFailures counts in-family failures WITHOUT an isolate_rerun (the band)", () => {
  const family = scanFamily(REPO_ROOT);
  const state = {
    state: "red",
    reason: "failed",
    failures: [
      { line: "not ok 1 - x", file: "plugin/test/cold-start-skill.test.mjs", in_family: true, kind: "wall-clock" },
      { line: "not ok 1 - y", file: "plugin/test/full-suite-runner.test.mjs", in_family: false },
    ],
  };
  const unverified = unverifiedFamilyFailures(state.failures);
  assert.equal(unverified.length, 1, "the in-family failure WITHOUT isolate_rerun is unverified");
  assert.equal(unverified[0].file, "plugin/test/cold-start-skill.test.mjs");

  const { state: triaged } = applyTriage(state, family, REPO_ROOT);
  assert.equal(unverifiedFamilyFailures(triaged.failures).length, 0, "after triage every in-family failure carries isolate_rerun");
});

// ── CLI (hermetic state file) ───────────────────────────────────────────────────────────────────────
// R6 (test-isolation-check) carrier-array cleanup: every mkdtemp dir is pushed here and swept in
// after() — the document-store `_createdDirs` + after-loop shape the R6 detector accepts.
const _createdDirs = [];
function tmpState(state) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rwt-state-"));
  _createdDirs.push(dir);
  const file = path.join(dir, "full-suite-state.json");
  writeState(file, state);
  return file;
}
after(() => {
  for (const dir of _createdDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test("Contract --partition — partitions a red state and writes in_family/kind/isolate_rerun back", () => {
  const file = tmpState({
    state: "red",
    reason: "failed",
    failures: [
      { line: "not ok 1 - x", file: "plugin/test/runner-grouping-list-groups.test.mjs" },
      { line: "not ok 1 - y", file: "plugin/test/full-suite-runner.test.mjs" },
    ],
  });
  const r = runCli(["--partition"], file);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes("in-family (1)"), r.stdout);
  assert.ok(r.stdout.includes("not-in-family (1)"), r.stdout);
  assert.ok(r.stdout.includes("isolate-rerun command"), r.stdout);
  const state = readState(file);
  assert.equal(state.failures[0].in_family, true);
  assert.equal(state.failures[0].kind, "nested-spawn");
  assert.ok(state.failures[0].isolate_rerun.startsWith("bash scripts/test.sh "));
  assert.equal(state.failures[1].in_family, false);
  assert.equal(state.failures[1].isolate_rerun, undefined);
});

test("Contract --band — passes when every in-family failure carries isolate_rerun; fails on an unverified one", () => {
  const okFile = tmpState({
    state: "red",
    reason: "failed",
    failures: [
      { line: "not ok 1 - x", file: "plugin/test/cold-start-skill.test.mjs", in_family: true, kind: "wall-clock", isolate_rerun: "bash scripts/test.sh ..." },
    ],
  });
  const ok = runCli(["--band"], okFile);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.ok(ok.stdout.includes("family_failures_unverified=0"), ok.stdout);

  // Negative control (Contract control): a family failure WITHOUT isolate_rerun flips the band red.
  const badFile = tmpState({
    state: "red",
    reason: "failed",
    failures: [
      { line: "not ok 1 - x", file: "plugin/test/cold-start-skill.test.mjs", in_family: true, kind: "wall-clock" },
    ],
  });
  const bad = runCli(["--band"], badFile);
  assert.equal(bad.status, 1, "a family failure without isolate_rerun must make the band red");
  assert.ok(bad.stderr.includes("must be 0"), bad.stderr);
});

test("Contract --record-verdict — writes the isolate-rerun verdict back and --band passes after green", () => {
  const file = tmpState({
    state: "red",
    reason: "failed",
    failures: [
      { line: "not ok 1 - x", file: "plugin/test/session-liveness-events.test.mjs" },
    ],
  });
  // partition first (auto-issue isolate_rerun for the in-family failure)
  const p = runCli(["--partition"], file);
  assert.equal(p.status, 0, p.stdout + p.stderr);
  // record verdict green (isolate rerun passed ⇒ environmental)
  const v = runCli(["--record-verdict", "0", "green"], file);
  assert.equal(v.status, 0, v.stdout + v.stderr);
  assert.ok(v.stdout.includes("isolate_rerun_result=green"), v.stdout);
  assert.ok(v.stdout.includes("kind=wall-clock"), v.stdout);
  const state = readState(file);
  assert.equal(state.failures[0].isolate_rerun_result, "green");
  // band passes after the verdict
  const b = runCli(["--band"], file);
  assert.equal(b.status, 0, b.stdout + b.stderr);
});
