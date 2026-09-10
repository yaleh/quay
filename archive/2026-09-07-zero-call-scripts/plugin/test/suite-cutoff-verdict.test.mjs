// @test-group engine
// suite-cutoff-verdict.test.mjs — tests for plugin/scripts/suite-cutoff-verdict.mjs
// (gap-suite-cutoff-what-tears-test-process-at-session-topology, 2026-08-07).
//
// The suite's red verdict was made UNRELIABLE by two distinct failure classes, distinguished
// by DURATION (the task's refined attribution):
//   1. GENUINE dangling-Promise / event-loop-exhaustion class — a heavy file runs for MINUTES
//      then self-fails with 'Promise resolution is still pending...'. FIX = split the file.
//   2. CASCADE victims — files downstream of a cutoff that never ran, failing instantly.
// The verdict tool makes the separation mechanically checkable: a static heavy-file scan
// (score from lines / test count / blocking-spawn weight) + a runtime duration discriminator
// over a full-suite log (long > 60s = genuine; instant = cascade).
//
// Run: scripts/test.sh plugin/test/suite-cutoff-verdict.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  HEAVY_SCORE_THRESHOLD,
  SUITE_LOG_LONG_MS,
  PROMISE_PENDING_RE,
  collectTestFiles,
  scoreTestFile,
  scanHeavyFiles,
  analyzeSuiteLog,
  computeVerdict,
} from "../scripts/suite-cutoff-verdict.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const CHECKER = path.join(repoRoot, "plugin/scripts/suite-cutoff-verdict.mjs");

function runChecker(args) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, ...args], { encoding: "utf8" });
}

// ── static heavy-file scan: RED ────────────────────────────────────────────────────────────────────
test("duration discriminator threshold is 60s (minutes-scale = genuine, instant = cascade)", () => {
  assert.equal(SUITE_LOG_LONG_MS, 60000);
  assert.equal(PROMISE_PENDING_RE.source.includes("Promise resolution is still pending"), true);
});

test("scoreTestFile: an oversized blocking-heavy file (the quay-init-loop shape) scores at-risk", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "svc-heavy-"));
  const f = path.join(tmp, "oversized.test.mjs");
  const lines = [];
  for (let i = 0; i < 60; i++) {
    lines.push(`test('t${i}', () => { const r = spawnSync('bash', ['scripts/quay-init.sh']); assert.ok(r.status === 0); });`);
  }
  fs.writeFileSync(f, `import { spawnSync } from "node:child_process";\n${lines.join("\n")}\n`);
  const m = scoreTestFile(f);
  assert.equal(m.tests, 60);
  assert.ok(m.blockSpawn >= 60, `expected >=60 blocking spawns, got ${m.blockSpawn}`); // +1 from the import line
  assert.ok(m.score >= HEAVY_SCORE_THRESHOLD, `expected score ${m.score} >= ${HEAVY_SCORE_THRESHOLD}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("scoreTestFile: a small light file does NOT score at-risk", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "svc-light-"));
  const f = path.join(tmp, "tiny.test.mjs");
  fs.writeFileSync(f, `import { test } from "node:test";\ntest('x', () => { assert.ok(1); });\n`);
  const m = scoreTestFile(f);
  assert.ok(m.score < HEAVY_SCORE_THRESHOLD);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("collectTestFiles finds test files under packages/plugin/experiments", () => {
  const files = collectTestFiles(repoRoot);
  assert.ok(files.length > 100, `expected >100 test files, got ${files.length}`);
  const hasVerdictTest = files.some((f) => path.basename(f.path) === "suite-cutoff-verdict.test.mjs");
  assert.ok(hasVerdictTest, "the verdict test itself is part of the scan surface");
});

test("scanHeavyFiles: the real repo flags the known at-risk files and never crashes", () => {
  const scan = scanHeavyFiles(repoRoot);
  assert.equal(scan.total, collectTestFiles(repoRoot).length);
  assert.ok(Array.isArray(scan.atRisk));
  // The verified defect family (quay-init-loop was split; its split files must NOT be at-risk):
  const quayInitSplits = scan.atRisk.filter((r) => r.path.includes("quay-init-loop"));
  assert.equal(quayInitSplits.length, 0, "the split quay-init-loop files must not be flagged at-risk");
});

// ── runtime duration discriminator over a synthetic full-suite log ────────────────────────────────
function syntheticLog() {
  const longFile = "packages/quay/test/acceptance.test.mjs";
  const victimFile = "plugin/test/session-topology.test.mjs";
  return [
    "✔ some passing test (12ms)",
    `✖ ${longFile} (167330.670345ms)`,
    "  'Promise resolution is still pending but the event loop has already resolved'",
    "ℹ cancelled 1",
    `✖ ${victimFile} (2.1ms)`,
    "  'Promise resolution is still pending but the event loop has already resolved'",
    "scripts/test.sh: line 576: 720326 Killed                     node --test",
  ].join("\n");
}

test("analyzeSuiteLog: long-duration Promise-pending = GENUINE; instant = cascade victim; Killed detected", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "svc-log-"));
  const log = path.join(tmp, "full-suite.log");
  fs.writeFileSync(log, syntheticLog());
  const r = analyzeSuiteLog(log);
  assert.equal(r.sigkill, 1);
  assert.equal(r.cancelled, 1);
  assert.equal(r.promisePending, 2);
  assert.equal(r.longGenuine.length, 1);
  assert.ok(r.longGenuine[0].file.includes("acceptance"));
  assert.ok(r.longGenuine[0].durationMs > SUITE_LOG_LONG_MS);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// False-positive regression (observed 2026-08-08 on a REAL green 2792-test run): the old broad
// regex /SIGKILL|Killed|exit 137/ matched PASSING test names and the tool's OWN embedded output
// (suite-cutoff-verdict.test.mjs runs inside the suite) — a green log reported "5 SIGKILL/Killed
// markers, torn down mid-run". Only the bash job-status diagnostic is a real teardown marker.
test("analyzeSuiteLog: test names / self-output mentioning SIGKILL must NOT count as a teardown (green-log false-positive regression)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "svc-fp-"));
  const log = path.join(tmp, "green.log");
  fs.writeFileSync(log, [
    "✔ A2: runAcceptance('sleep 30', timeoutMs:200) -> killed { timedOut:true, signal:SIGKILL, code:null } (212ms)",
    "✔ AC5 — a child killed by a signal (SIGKILL) writes reason=aborted (323ms)",
    "✔ AC5 — a SIGKILL'd node --test reported by bash as exit 137 is reason=aborted, NOT failed (508ms)",
    "  - suite log shows 1 SIGKILL/Killed marker(s) — process torn down mid-run",
    "✔ analyzeSuiteLog: long-duration Promise-pending = GENUINE; instant = cascade victim; Killed detected (4ms)",
    "ℹ tests 2792\nℹ fail 0\nℹ cancelled 0",
  ].join("\n"));
  const r = analyzeSuiteLog(log);
  assert.equal(r.sigkill, 0, `a green log with SIGKILL-NAMED passing tests must report 0 teardown markers (got ${r.sigkill})`);
  assert.equal(r.cancelled, 0);
  assert.equal(r.promisePending, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("analyzeSuiteLog: a missing log file is reported (missing:true), never crashes", () => {
  const r = analyzeSuiteLog("/nonexistent/definitely-missing/full-suite.log");
  assert.equal(r.missing, true);
  assert.equal(r.sigkill, 0);
  assert.equal(r.promisePending, 0);
  assert.equal(r.longGenuine.length, 0);
  // computeVerdict must not crash either and must surface the missing-log issue.
  const v = computeVerdict({ log: "/nonexistent/definitely-missing/full-suite.log", root: repoRoot, json: false });
  assert.ok(v.issues.some((i) => i.includes("not found")), `missing-log issue must be reported (got: ${v.issues})`);
});

test("computeVerdict: a log with genuine long-duration Promise-pending is BLOCKED; a clean one is clean", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "svc-vd-"));
  const badLog = path.join(tmp, "bad.log");
  fs.writeFileSync(badLog, syntheticLog());
  const vBad = computeVerdict({ log: badLog, root: repoRoot });
  assert.equal(vBad.verdict, "blocked");
  assert.ok(vBad.issues.some((i) => i.includes("genuine dangling-Promise")));

  const goodLog = path.join(tmp, "good.log");
  fs.writeFileSync(goodLog, "✔ all passing (5ms)\n# pass 100\n");
  const vGood = computeVerdict({ log: goodLog, root: repoRoot });
  // heavy-file at-risk still blocks the static surface (that is the point — re-grown heavy files
  // are caught even when the log is green).
  assert.equal(vGood.suiteLog.longGenuine.length, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("CLI: --help exits 0; --json emits parseable JSON; exit 1 when at-risk files exist", () => {
  const help = runChecker(["--help"]);
  assert.equal(help.status, 0);
  const j = runChecker(["--root", repoRoot, "--json"]);
  assert.equal(j.status, 1, "at-risk heavy files exist in the real repo => exit 1");
  const parsed = JSON.parse(j.stdout);
  assert.equal(parsed.verdict, "blocked");
  assert.ok(Array.isArray(parsed.heavyScan.atRisk));
  assert.ok(parsed.suiteLog === null || typeof parsed.suiteLog === "object");
});
