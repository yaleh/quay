// @test-group engine
// test-isolation-check.test.mjs — gap-test-isolation-contract-is-unwritten: RED/GREEN tests for
// the test-isolation contract scan + shrink-only violation ratchet (test-isolation-check.ts).
// Covers AC1–AC8:
//   - R1 (AC2): a fixed __dirname/.tmp-* write path reports; a mkdtemp/os.tmpdir path does not.
//   - R2 (AC2): invoking sync-vendor.sh without --check, or a direct write to a shared
//               packages/<pkg>/dist/ or plugin/vendor/ path, reports; a temp build does not.
//   - R3 (AC2): a spawn/exec of scripts/test.sh reports (literal AND variable forms); a comment
//               or an unrelated spawn does not.
//   - R4 (AC2): process.exit(1) reports only in a hand-rolled (non-node:test) file; comments,
//               strings, and process.exitCode never report.
//   - R6 (AC2/AC6): mkdtemp with no cleanup construct anywhere reports; rm/after/finally cleanup
//               does not; /tmp/claude-* and /tmp/quay-wt-* prefixes are NEVER matched (AC6).
//   - AC3/AC4 rehearsal (CLI): the real-repo run reports the three known instances (M136's
//               plugin-packaging, AC11's select-tests-for-touches; relation-sync is fixed and
//               must NOT report) and the 7 remaining process.exit(1) harnesses.
//   - AC5 ratchet (CLI rehearsal): adding a new violation file → check FAILS; fixing it → PASSES.
//   - AC7: a deliberately-constructed violating test file is reported by the CLI.
//
// Run:
//   scripts/test.sh plugin/test/test-isolation-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  detectFixedPathWrites,
  detectSharedBuildArtifactWrites,
  detectSpawnsTestSh,
  detectProcessExit1,
  detectMkdtempNoCleanup,
  runIsolationChecks,
} from "../scripts/test-isolation-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECK_TS = path.join(REPO_ROOT, "plugin", "scripts", "test-isolation-check.ts");

// ── R1 / AC2: fixed __dirname/.tmp-* write paths ────────────────────────────────────────────────────
test("R1/AC2: a fixed __dirname/.tmp-* path reports; mkdtemp/os.tmpdir paths do not", () => {
  assert.ok(
    detectFixedPathWrites('const tasksDir = path.join(__dirname, ".tmp-lock-test");\n', "x.test.mjs")
      .some((v) => v.rule === "fixed-path-write")
  );
  // the mkdtemp PREFIX form (relation-sync's fix / loadbearing) is per-run-unique → safe
  assert.equal(
    detectFixedPathWrites('const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rel-sync-"));\n', "x.test.mjs").length,
    0
  );
  assert.equal(
    detectFixedPathWrites('const dir = fs.mkdtempSync(path.join(__dirname, "..", "fixtures", ".tmp-tree-"));\n', "x.test.mjs").length,
    0
  );
  // a comment mentioning the pattern is not a violation (code-position matching, AC2)
  assert.equal(
    detectFixedPathWrites('// path.join(__dirname, ".tmp-comment-only")\nconst x = 1;\n', "x.test.mjs").length,
    0
  );
});

// ── R2 / AC2: shared build artifacts ────────────────────────────────────────────────────────────────
test("R2/AC2: sync-vendor.sh sync-mode and direct shared-dist writes report; temp builds do not", () => {
  // plugin-packaging.test.mjs:657 — the M136 instance (sync-vendor.sh WITHOUT --check rewrites the
  // shared plugin/vendor/ mirror).
  assert.ok(
    detectSharedBuildArtifactWrites(
      'execFileSync("bash", [path.join(pluginDir, "scripts", "sync-vendor.sh")], { cwd: repoRoot });\n',
      "x.test.mjs"
    ).some((v) => v.rule === "shared-build-artifact-write")
  );
  // sync-vendor.sh --check is read-only → safe
  assert.equal(
    detectSharedBuildArtifactWrites('execFileSync("bash", [syncScript, "--check"], { cwd: repoRoot });\n', "x.test.mjs").length,
    0
  );
  // writing dist under a temp root (the SAFE pattern — build-dist.test.mjs M136 round-3) → safe
  assert.equal(
    detectSharedBuildArtifactWrites('fs.writeFileSync(path.join(root, "dist", "quay.js"), "x"); // root is a mkdtemp\n', "x.test.mjs").length,
    0
  );
  // a direct write to a literal shared packages/<pkg>/dist/ path → reports
  assert.ok(
    detectSharedBuildArtifactWrites('fs.writeFileSync("packages/quay/dist/quay.js", "x");\n', "x.test.mjs")
      .some((v) => v.rule === "shared-build-artifact-write")
  );
  // plugin/vendor literal → reports
  assert.ok(
    detectSharedBuildArtifactWrites('fs.writeFileSync("plugin/vendor/quay/package.json", "{}");\n', "x.test.mjs")
      .some((v) => v.rule === "shared-build-artifact-write")
  );
});

// ── R3 / AC2: spawning scripts/test.sh ──────────────────────────────────────────────────────────────
test("R3/AC2: a spawn/exec of scripts/test.sh reports (literal AND variable forms); others do not", () => {
  // test-coverage-check.test.mjs:115 — the literal form
  assert.ok(
    detectSpawnsTestSh('const r = spawnSync("bash", ["scripts/test.sh", "--list-files"], { encoding: "utf8" });\n', "x.test.mjs")
      .some((v) => v.rule === "spawns-test-sh")
  );
  // select-tests-for-touches.test.mjs:83 — the variable form (AC11 instance)
  assert.ok(
    detectSpawnsTestSh('const TEST_SH = path.join(REPO_ROOT, "scripts", "test.sh");\nspawnSync("bash", [TEST_SH, "--for-task", "x"]);\n', "x.test.mjs")
      .some((v) => v.rule === "spawns-test-sh")
  );
  // an unrelated spawn → safe
  assert.equal(
    detectSpawnsTestSh('spawnSync("bash", ["plugin/scripts/other.sh"], {});\n', "x.test.mjs").length,
    0
  );
  // a comment mentioning the spawn → not a violation (code-position matching, AC2)
  assert.equal(
    detectSpawnsTestSh('// spawnSync("bash", ["scripts/test.sh"])\nconst x = 1;\n', "x.test.mjs").length,
    0
  );
});

// ── R4 / AC2: process.exit(1) only in hand-rolled files ─────────────────────────────────────────────
test("R4/AC2: process.exit(1) reports in a hand-rolled file; never in comments/strings/exitCode/node:test", () => {
  assert.ok(
    detectProcessExit1('// @test-group product\nfunction fail() { process.exit(1); }\n', "x.test.mjs")
      .some((v) => v.rule === "process-exit-1")
  );
  // node:test files are out of rule scope (create-mcp.test.mjs writes it INSIDE a template literal)
  assert.equal(
    detectProcessExit1('// @test-group engine\nimport { test } from "node:test";\nprocess.exit(1);\n', "x.test.mjs").length,
    0
  );
  assert.equal(detectProcessExit1('// @test-group product\nprocess.exitCode = 1;\n', "x.test.mjs").length, 0);
  assert.equal(detectProcessExit1('// @test-group product\n// uses process.exit(1)\nconst x = 1;\n', "x.test.mjs").length, 0);
  assert.equal(detectProcessExit1('// @test-group product\nconst s = "process.exit(1)";\n', "x.test.mjs").length, 0);
});

// ── R6 / AC2 / AC6: mkdtemp without cleanup ────────────────────────────────────────────────────────
test("R6/AC2: mkdtemp with no cleanup reports; rm/after/finally cleanup does not", () => {
  // a bare mkdtemp with no cleanup construct anywhere → reports (the leak shape of adr-store/
  // document-store before the gap-tests-never-clean-up-their-tmpdirs fix)
  assert.ok(
    detectMkdtempNoCleanup('// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-"));\n', "x.test.mjs")
      .some((v) => v.rule === "mkdtemp-no-cleanup")
  );
  // no mkdtemp → never reports
  assert.equal(detectMkdtempNoCleanup('// @test-group product\nconst x = 1;\n', "x.test.mjs").length, 0);
  // t.after cleanup → GREEN
  assert.equal(
    detectMkdtempNoCleanup('// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-"));\nt.after(() => fs.rmSync(dir, { recursive: true, force: true }));\n', "x.test.mjs").length,
    0
  );
  // rmSync cleanup → GREEN
  assert.equal(
    detectMkdtempNoCleanup('// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-"));\nfs.rmSync(dir, { recursive: true, force: true });\n', "x.test.mjs").length,
    0
  );
  // try/finally → GREEN
  assert.equal(
    detectMkdtempNoCleanup('// @test-group product\ntry { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-")); } finally {}\n', "x.test.mjs").length,
    0
  );
  // a comment merely mentioning mkdtemp is not a violation (code-position matching)
  assert.equal(
    detectMkdtempNoCleanup('// @test-group product\n// fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-")) mention\nconst x = 1;\n', "x.test.mjs").length,
    0
  );
});

// ── AC6 / AC4: /tmp/claude-* and /tmp/quay-wt-* are NEVER matched; negative control ─────────────────
test("AC6: claude-* and quay-wt-* mkdtemp prefixes never report; a normal fixture prefix still does (AC4 negative control, both directions)", () => {
  // session data / in-use worktree prefixes are exempt (AC6)
  assert.equal(
    detectMkdtempNoCleanup('// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-abc123"));\n', "x.test.mjs").length,
    0,
    "claude-* prefix must be excluded"
  );
  assert.equal(
    detectMkdtempNoCleanup('// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-wt-some-task"));\n', "x.test.mjs").length,
    0,
    "quay-wt-* prefix must be excluded"
  );
  // AC4 NEGATIVE direction: a NORMAL fixture prefix (the leak shape) reports
  assert.ok(
    detectMkdtempNoCleanup('// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-leak-"));\n', "x.test.mjs")
      .some((v) => v.rule === "mkdtemp-no-cleanup"),
    "fixture prefix with no cleanup must report (AC4 negative)"
  );
  // AC4 RESTORE direction: adding the cleanup makes it stop reporting (back to 0)
  assert.equal(
    detectMkdtempNoCleanup('// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-leak-"));\nt.after(() => fs.rmSync(dir, { recursive: true, force: true }));\n', "x.test.mjs").length,
    0,
    "restoring cleanup must return to 0 (AC4 restore)"
  );
  // a file mixing a claude-* prefix with a normal leak prefix is NOT fully exempt — the leak reports
  assert.ok(
    detectMkdtempNoCleanup('// @test-group product\nconst s = fs.mkdtempSync(path.join(os.tmpdir(), "claude-session"));\nconst l = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-leak-"));\n', "x.test.mjs")
      .some((v) => v.rule === "mkdtemp-no-cleanup"),
    "a non-exempt prefix alongside claude-* still reports (AC6 is prefix-scoped)"
  );
});

// ── the ratchet (runIsolationChecks, AC5) ───────────────────────────────────────────────────────────
test("AC5 ratchet: current==data file passes; new/grown/stale/malformed entries fail", () => {
  const entries = ["a.test.mjs:fixed-path-write", "b.test.mjs:process-exit-1"];
  const baseline = ["a.test.mjs:fixed-path-write", "b.test.mjs:process-exit-1"];
  const base = { current: entries, dataEntries: entries, baselineEntries: baseline, baselineCount: 2, baselineCountHead: 2, fileExists: () => true };

  assert.deepEqual(runIsolationChecks({ ...base }), []);

  // C1: a current violation with no data-file entry → new violation, FAIL
  let failures = runIsolationChecks({ ...base, current: [...entries, "c.test.mjs:spawns-test-sh"] });
  assert.ok(failures.some((f) => f.includes("c.test.mjs:spawns-test-sh") && f.includes("no entry")), JSON.stringify(failures));

  // C2a: an entry ADDED vs the committed baseline → FAIL
  failures = runIsolationChecks({ ...base, current: [...entries, "c.test.mjs:spawns-test-sh"], dataEntries: [...entries, "c.test.mjs:spawns-test-sh"] });
  assert.ok(failures.some((f) => f.includes("c.test.mjs:spawns-test-sh") && f.includes("ADDED")), JSON.stringify(failures));

  // C2c: a STALE entry (violation fixed, entry kept) → FAIL (the list only shrinks)
  failures = runIsolationChecks({ ...base, current: entries.slice(0, 1) });
  assert.ok(failures.some((f) => f.includes("STALE")), JSON.stringify(failures));

  // C0a: over the ceiling at a clean commit (git blind) → FAIL
  failures = runIsolationChecks({ ...base, current: [...entries, "c.test.mjs:spawns-test-sh"], dataEntries: [...entries, "c.test.mjs:spawns-test-sh"], baselineEntries: [...entries, "c.test.mjs:spawns-test-sh"], baselineCount: 2 });
  assert.ok(failures.some((f) => f.includes("over the ratchet ceiling")), JSON.stringify(failures));

  // C0b: raising the ceiling in the working tree → FAIL
  failures = runIsolationChecks({ ...base, current: [...entries, "c.test.mjs:spawns-test-sh"], dataEntries: [...entries, "c.test.mjs:spawns-test-sh"], baselineEntries: [...entries, "c.test.mjs:spawns-test-sh"], baselineCount: 3, baselineCountHead: 2 });
  assert.ok(failures.some((f) => f.includes("ceiling was RAISED")), JSON.stringify(failures));

  // C2d: a malformed entry → FAIL
  failures = runIsolationChecks({ current: [], dataEntries: ["not-a-valid-entry"], baselineEntries: [], baselineCount: null, baselineCountHead: null, fileExists: () => true });
  assert.ok(failures.some((f) => f.includes("malformed")), JSON.stringify(failures));
});

// ── AC3/AC4 real-repo rehearsal: the known instances appear, relation-sync is quiet ─────────────────
test("AC3/AC4 rehearsal: real repo reports the three known instances + the 7 remaining process.exit(1)s", () => {
  const res = spawnSync("node", ["--experimental-strip-types", CHECK_TS, "--list"], { encoding: "utf8", timeout: 60_000 });
  assert.equal(res.status, 0, res.stderr);
  const lines = res.stdout.trim().split("\n").filter(Boolean);
  const byRule = (rule) => lines.filter((l) => l.endsWith(`:${rule}`));

  // AC3: M136-related (plugin-packaging, shared build artifact) must appear
  assert.ok(lines.includes("plugin/test/plugin-packaging.test.mjs:shared-build-artifact-write"), `missing M136 instance:\n${res.stdout}`);
  // AC3: AC11-related (select-tests-for-touches, spawns the runner) must appear
  assert.ok(lines.includes("plugin/test/select-tests-for-touches.test.mjs:spawns-test-sh"), `missing AC11 instance:\n${res.stdout}`);
  // AC3: relation-sync was FIXED — it must NOT appear under any rule
  assert.ok(!lines.some((l) => l.startsWith("packages/quay-native/test/relation-sync.test.mjs")), `relation-sync must not report:\n${res.stdout}`);
  // AC4: the 7 remaining known process.exit(1) harnesses (AC7 list, minus the fixed relation-sync)
  for (const f of [
    "packages/quay-native/test/adversarial-eval.test.mjs",
    "packages/quay-native/test/cas-write.test.mjs",
    "packages/quay-native/test/create-validation.test.mjs",
    "packages/quay-native/test/edit-validation.test.mjs",
    "packages/quay-native/test/lock.test.mjs",
    "packages/quay-native/test/yaml-frontmatter-colon.test.mjs",
    "packages/quay/test/gap002-create-ergonomics.iteration-0.test.mjs",
  ]) {
    assert.ok(lines.includes(`${f}:process-exit-1`), `missing AC4 process.exit(1) file ${f}:\n${res.stdout}`);
  }
  assert.equal(byRule("process-exit-1").length, 7, `expected exactly 7 process-exit-1 entries:\n${res.stdout}`);
});

// ── AC7: a deliberately-constructed violating test file is reported by the CLI ──────────────────────
test("AC7: a manually constructed violating test file is reported by the CLI (not just on the live repo)", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "test-isolation-ac7-"));
  try {
    // A minimal canonical root whose glob picks up ONE deliberately-broken test file.
    fs.mkdirSync(path.join(scratch, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(scratch, "scripts", "test.sh"), 'glob=(packages/*/test/*.test.mjs)\n');
    const testDir = path.join(scratch, "packages", "quay", "test");
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(
      path.join(testDir, "deliberately-violating.test.mjs"),
      '// @test-group product\nconst tasksDir = path.join(__dirname, ".tmp-constructed-bad");\nfunction fail() { process.exit(1); }\n'
    );
    const dataFile = path.join(scratch, "plugin", "test-isolation-violations.txt");
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, "# baseline-count: 2\npackages/quay/test/deliberately-violating.test.mjs:fixed-path-write\npackages/quay/test/deliberately-violating.test.mjs:process-exit-1\n");
    const baselineFile = path.join(scratch, "baseline-violations.txt");
    fs.writeFileSync(baselineFile, "# baseline-count: 2\npackages/quay/test/deliberately-violating.test.mjs:fixed-path-write\npackages/quay/test/deliberately-violating.test.mjs:process-exit-1\n");

    // Both rules fire on the constructed file and the check passes because they are baselined.
    let res = spawnSync("node", ["--experimental-strip-types", CHECK_TS, scratch, "--data-file", dataFile, "--baseline-file", baselineFile], { encoding: "utf8", timeout: 30_000 });
    assert.equal(res.status, 0, `expected PASS (baselined) on the constructed file:\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /deliberately-violating\.test\.mjs:fixed-path-write/);
    assert.match(res.stdout, /deliberately-violating\.test\.mjs:process-exit-1/);

    // Now demonstrate the RATCHET (AC5) on the constructed file: a NEW violation (a spawn) with no
    // data-file entry fails.
    fs.writeFileSync(
      path.join(testDir, "deliberately-violating.test.mjs"),
      '// @test-group product\nimport { spawnSync } from "node:child_process";\nspawnSync("bash", ["scripts/test.sh", "--for-task", "x"]);\n'
    );
    res = spawnSync("node", ["--experimental-strip-types", CHECK_TS, scratch, "--data-file", dataFile, "--baseline-file", baselineFile], { encoding: "utf8", timeout: 30_000 });
    assert.equal(res.status, 1, `expected FAIL (new spawns-test-sh violation):\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /spawns-test-sh.*no entry|no entry.*spawns-test-sh/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// ── CLI rehearsal against the REAL repo: the wired check exits 0 (all 23 baselined) ─────────────────
test("CLI rehearsal: the real repo's check passes (all violations baselined, no drift)", () => {
  const res = spawnSync("node", ["--experimental-strip-types", CHECK_TS, REPO_ROOT], { encoding: "utf8", timeout: 60_000 });
  assert.equal(res.status, 0, `expected PASS against the real repo:\n${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /PASS: all \d+ violation\(s\) are baselined/);
});
