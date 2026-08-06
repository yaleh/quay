// @test-group engine
// test-framework-policy-check.test.mjs — gap-no-test-framework-policy-for-new-tests: RED/GREEN
// tests for the node:test policy + shrink-only exemption ratchet (test-framework-policy-check.ts).
// Covers AC1–AC8:
//   - C1  (AC3): every glob file must import node:test OR be on the exemption list.
//   - C2a (AC4): a file ADDED to the exemption list fails (the ratchet — the list only shrinks).
//   - C2b/c/d  : stale list entries (file gone / converted / outside the glob) fail.
//   - C3  (AC5): a NEW file (not in the list, not in the committed tree) must declare @test-group;
//                existing files default to engine.
//   - CLI-level AC4 rehearsal in a scratch fixture: add a file to the list → check FAILS →
//     remove → PASSES (the DoD's real rehearsal, kept as a durable automated test).
//
// Run:
//   scripts/test.sh plugin/test/test-framework-policy-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  runPolicyChecks,
  canonicalTestFiles,
  parseExemptionList,
  parseBaselineCount,
  hasNodeTestImport,
  groupDeclRE,
  DATA_FILE_REL,
} from "../scripts/test-framework-policy-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECK_TS = path.join(REPO_ROOT, "plugin", "scripts", "test-framework-policy-check.ts");

const nodeTestSource = '// @test-group engine\nimport { test } from "node:test";\ntest("x", () => {});\n';
const legacySource = '// @test-group product\nfunction makeAssert() {}\nmakeAssert();\n';
const legacyConverted = '// @test-group product\nimport { test } from "node:test";\n';
const newNoGroup = '// plain\nimport { test } from "node:test";\n';
const newBadGroup = '// @test-group nope\nimport { test } from "node:test";\n';

const FILES = [
  { rel: "packages/quay/test/modern.test.mjs", source: nodeTestSource },
  { rel: "packages/quay/test/legacy-handrolled.test.mjs", source: legacySource },
];
const EXEMPTION = ["packages/quay/test/legacy-handrolled.test.mjs"];
const BASELINE_EXEMPTION = ["packages/quay/test/legacy-handrolled.test.mjs"];
const BASELINE_FILES = new Set(["packages/quay/test/modern.test.mjs", "packages/quay/test/legacy-handrolled.test.mjs"]);

function runPolicy(files, exemptionList, baselineExemption, baselineFiles, fileExists = () => true, baselineCount = null, baselineCountHead = null) {
  return runPolicyChecks({
    files,
    exemptionList,
    baselineExemptionList: baselineExemption,
    baselineTestFiles: baselineFiles,
    baselineCount,
    baselineCountHead,
    fileExists,
  });
}

// ── C1 / AC3: every glob file must import node:test OR be on the exemption list ────────────────────
test("C1/AC3: a hand-rolled file not on the exemption list fails (the 35th file)", () => {
  const files = [...FILES, { rel: "packages/quay/test/other-handrolled.test.mjs", source: legacySource }];
  const failures = runPolicy(files, EXEMPTION, BASELINE_EXEMPTION, BASELINE_FILES);
  assert.ok(failures.some((f) => f.includes("other-handrolled") && f.includes("AC3")), JSON.stringify(failures));
});

test("C1/AC3: a node:test file and a listed legacy file both pass", () => {
  const failures = runPolicy(FILES, EXEMPTION, BASELINE_EXEMPTION, BASELINE_FILES);
  assert.deepEqual(failures, []);
});

// ── C2a / AC4: the exemption list can only get SHORTER ─────────────────────────────────────────────
test("C2a/AC4: a file ADDED to the exemption list fails the ratchet", () => {
  const files = [...FILES, { rel: "packages/quay/test/other-handrolled.test.mjs", source: legacySource }];
  const grown = [...EXEMPTION, "packages/quay/test/other-handrolled.test.mjs"];
  const failures = runPolicy(files, grown, BASELINE_EXEMPTION, BASELINE_FILES);
  assert.ok(failures.some((f) => f.includes("ADDED to the exemption list")), JSON.stringify(failures));
  // Once listed, the file is exempt from C1 — only the ratchet fires.
  assert.ok(!failures.some((f) => f.includes("other-handrolled") && f.includes("AC3")), JSON.stringify(failures));
});

test("C2c/AC4: a listed file that now imports node:test must be removed from the list", () => {
  const files = FILES.map((f) =>
    f.rel === "packages/quay/test/legacy-handrolled.test.mjs" ? { ...f, source: legacyConverted } : f
  );
  const failures = runPolicy(files, EXEMPTION, BASELINE_EXEMPTION, BASELINE_FILES);
  assert.ok(failures.some((f) => f.includes("now imports node:test")), JSON.stringify(failures));
});

test("C2b/AC4: a listed entry whose file no longer exists must be removed", () => {
  const failures = runPolicy(
    FILES,
    EXEMPTION,
    BASELINE_EXEMPTION,
    BASELINE_FILES,
    (rel) => rel !== "packages/quay/test/legacy-handrolled.test.mjs"
  );
  assert.ok(failures.some((f) => f.includes("no longer exists")), JSON.stringify(failures));
});

test("C2d/AC4: a listed entry outside the canonical glob must be removed", () => {
  const failures = runPolicy(FILES, [...EXEMPTION, "plugin/scripts/not-a-test.mjs"], [...BASELINE_EXEMPTION, "plugin/scripts/not-a-test.mjs"], BASELINE_FILES);
  assert.ok(failures.some((f) => f.includes("OUTSIDE the canonical test glob")), JSON.stringify(failures));
});

// ── C3 / AC5: NEW files must declare a valid @test-group; existing files default to engine ─────────
test("C3/AC5: a new file without @test-group fails", () => {
  const files = [...FILES, { rel: "packages/quay/test/brand-new.test.mjs", source: newNoGroup }];
  const failures = runPolicy(files, EXEMPTION, BASELINE_EXEMPTION, BASELINE_FILES);
  assert.ok(failures.some((f) => f.includes("brand-new") && f.includes("AC5")), JSON.stringify(failures));
});

test("C3/AC5: a new file with an invalid @test-group fails", () => {
  const files = [...FILES, { rel: "packages/quay/test/brand-new-bad.test.mjs", source: newBadGroup }];
  const failures = runPolicy(files, EXEMPTION, BASELINE_EXEMPTION, BASELINE_FILES);
  assert.ok(failures.some((f) => f.includes("brand-new-bad") && f.includes("AC5")), JSON.stringify(failures));
});

test("C3/AC5: a new file with a valid @test-group passes", () => {
  const files = [...FILES, { rel: "packages/quay/test/brand-new-ok.test.mjs", source: nodeTestSource }];
  const failures = runPolicy(files, EXEMPTION, BASELINE_EXEMPTION, BASELINE_FILES);
  assert.deepEqual(failures, []);
});

test("C3/AC5: an existing (baseline) file without @test-group defaults to engine and passes", () => {
  // `modern.test.mjs` is in BASELINE_FILES but here has NO declaration — existing, so it passes.
  const files = FILES.map((f) => (f.rel === "packages/quay/test/modern.test.mjs" ? { ...f, source: 'import { test } from "node:test";\n' } : f));
  const failures = runPolicy(files, EXEMPTION, BASELINE_EXEMPTION, BASELINE_FILES);
  assert.deepEqual(failures, []);
});

// ── REFUTE round-1 regression: a comment/string mentioning node:test must NOT satisfy AC3 ───────────
test("REFUTE: a comment mentioning a node:test import does NOT make a file compliant", () => {
  const commentSneak = '// @test-group engine\n// TODO: migrate this to import { test } from "node:test"\nfunction makeAssert(){}\nmakeAssert();\n';
  assert.equal(hasNodeTestImport(commentSneak), false, "a comment must not count as an import");
  const files = [...FILES, { rel: "packages/quay/test/sneak.test.mjs", source: commentSneak }];
  const failures = runPolicy(files, EXEMPTION, BASELINE_EXEMPTION, BASELINE_FILES);
  assert.ok(failures.some((f) => f.includes("sneak") && f.includes("AC3")), JSON.stringify(failures));
});

test("REFUTE: a comment mentioning node:test on a LISTED legacy file does NOT fire the converted check", () => {
  const commentSneak = '// TODO: migrate this to import { test } from "node:test"\nfunction makeAssert(){}\nmakeAssert();\n';
  const files = FILES.map((f) =>
    f.rel === "packages/quay/test/legacy-handrolled.test.mjs" ? { ...f, source: commentSneak } : f
  );
  const failures = runPolicy(files, EXEMPTION, BASELINE_EXEMPTION, BASELINE_FILES);
  assert.ok(!failures.some((f) => f.includes("now imports node:test")), JSON.stringify(failures));
});

test("REFUTE: a require('node:test') inside a string literal is NOT an import", () => {
  const stringSneak = '// @test-group engine\nconst s = "require(\\\"node:test\\\")";\nfunction makeAssert(){}\nmakeAssert();\n';
  assert.equal(hasNodeTestImport(stringSneak), false);
});

// ── REFUTE round-1 regression: the commit-surviving count-ceiling ratchet ──────────────────────────
test("REFUTE: a list over the ratchet ceiling fails even at a clean commit (git subset is blind)", () => {
  const files = [...FILES, { rel: "packages/quay/test/other-handrolled.test.mjs", source: legacySource }];
  const grown = [...EXEMPTION, "packages/quay/test/other-handrolled.test.mjs"];
  // baseline == current (HEAD already moved past the addition): only the ceiling can catch it.
  const failures = runPolicy(files, grown, grown, new Set(files.map((f) => f.rel)), () => true, 1);
  assert.ok(failures.some((f) => f.includes("over the ratchet ceiling")), JSON.stringify(failures));
});

test("REFUTE: a list at or below the ratchet ceiling passes", () => {
  const files = [...FILES, { rel: "packages/quay/test/other-handrolled.test.mjs", source: legacySource }];
  const grown = [...EXEMPTION, "packages/quay/test/other-handrolled.test.mjs"];
  const failures = runPolicy(files, grown, grown, new Set(files.map((f) => f.rel)), () => true, 2);
  assert.deepEqual(failures, []);
});

test("REFUTE: the data file header carries a parseable, positive baseline-count ceiling (shrink-only — never a hardcoded absolute)", () => {
  const dataAbs = path.join(REPO_ROOT, DATA_FILE_REL);
  const baselineCount = parseBaselineCount(fs.readFileSync(dataAbs, "utf8"));
  // The ceiling is a RUNTIME-computed shrink-only ratchet control surface, not a fixed constant:
  // it can only get LOWER as legacy files convert. A hardcoded `=== 34` would go red on any
  // legitimate shrink — exactly the global-count-snapshot fragility this task removes.
  assert.ok(baselineCount !== null && baselineCount > 0, "data file must carry a parseable, positive '# baseline-count' token");
});

// ── REFUTE round-2 regressions: regex literals, method-call imports, shrink-only ceiling ───────────
test("REFUTE R2: a regex literal spelling the import is NOT an import", () => {
  const regexSneak = '// @test-group engine\nconst re = /import { test } from "node:test"/;\nfunction makeAssert(){}\nmakeAssert();\n';
  assert.equal(hasNodeTestImport(regexSneak), false, "a regex literal must not count as an import");
  const files = [...FILES, { rel: "packages/quay/test/regex-sneak.test.mjs", source: regexSneak }];
  const failures = runPolicy(files, EXEMPTION, BASELINE_EXEMPTION, BASELINE_FILES);
  assert.ok(failures.some((f) => f.includes("regex-sneak") && f.includes("AC3")), JSON.stringify(failures));
});

test("REFUTE R2: a method-call import(...) is not a dynamic import; the real import still counts", () => {
  const methodCall = '// @test-group engine\nloader.import("node:test");\nimport { test } from "node:test";\n';
  assert.equal(hasNodeTestImport(methodCall), true, "the real import must still be detected");
  const methodOnly = '// @test-group engine\nloader.import("node:test");\nfunction makeAssert(){}\nmakeAssert();\n';
  assert.equal(hasNodeTestImport(methodOnly), false, "loader.import(...) alone must not count");
  const files = [...FILES, { rel: "packages/quay/test/method-only.test.mjs", source: methodOnly }];
  const failures = runPolicy(files, EXEMPTION, BASELINE_EXEMPTION, BASELINE_FILES);
  assert.ok(failures.some((f) => f.includes("method-only") && f.includes("AC3")), JSON.stringify(failures));
});

test("REFUTE R2: division (a / b, x++ / 2) must not be misread as a regex that hides a real import", () => {
  const divThenImport = 'const x = 5;\nlet a = 10;\nconst r = a / 2; // division\nx++ / 2;\nimport { test } from "node:test";\ntest("x", () => {});\n';
  assert.equal(hasNodeTestImport(divThenImport), true, "the import after divisions must still be detected");
});

test("REFUTE R2: raising the ratchet ceiling in the working tree fails (shrink-only ceiling)", () => {
  const files = [...FILES, { rel: "packages/quay/test/other-handrolled.test.mjs", source: legacySource }];
  const grown = [...EXEMPTION, "packages/quay/test/other-handrolled.test.mjs"];
  // ceiling raised 1 → 2 in the working tree; the git strict-subset is blind (baseline == current).
  const failures = runPolicy(files, grown, grown, new Set(files.map((f) => f.rel)), () => true, 2, 1);
  assert.ok(failures.some((f) => f.includes("ceiling was RAISED")), JSON.stringify(failures));
});

// ── Real repo invariant: the current tree is green and the list obeys the shrink-only ratchet ───────
test("real repo: every glob file imports node:test or is on the exemption list; the list is at or below the baseline-count ratchet", () => {
  const files = canonicalTestFiles(REPO_ROOT);
  const dataAbs = path.join(REPO_ROOT, DATA_FILE_REL);
  const list = parseExemptionList(fs.readFileSync(dataAbs, "utf8"));
  const baselineCount = parseBaselineCount(fs.readFileSync(dataAbs, "utf8"));

  // The list is a shrink-only ratchet (AC4): it can never EXCEED the `# baseline-count` ceiling
  // parsed from the data file header — the checker's own C0a invariant, COMPUTED AT RUNTIME. A
  // hardcoded `=== 34` would go red the moment a legacy file converts (the list legitimately
  // shrinks) — the global-count-snapshot fragility class this task removes (B3-2 family).
  assert.ok(baselineCount !== null, "data file must carry '# baseline-count'");
  assert.ok(list.length <= baselineCount,
    `exemption list (${list.length}) must not exceed the baseline-count ratchet (${baselineCount})`);
  // Every glob file either imports node:test or is in the list.
  for (const rel of files) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
    assert.ok(
      hasNodeTestImport(src) || list.includes(rel),
      `${rel} is neither node:test nor on the exemption list`
    );
  }
  // Every list entry is a real, currently-existing glob file.
  for (const rel of list) {
    assert.ok(files.includes(rel), `exemption entry ${rel} is not a current glob file`);
  }
});

test("real repo: the policy check passes end-to-end against the current tree", () => {
  const res = spawnSync(
    "node",
    ["--experimental-strip-types", CHECK_TS, REPO_ROOT],
    { encoding: "utf8", timeout: 30_000 }
  );
  assert.equal(res.status, 0, `check failed against real repo:\n${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /PASS/);
});

// ── CLI-level AC4 rehearsal (the DoD's real rehearsal, kept durable): add → FAIL → remove → PASS ──
test("CLI AC4 rehearsal: adding a file to the exemption list fails; removing restores green", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fw-policy-rehearsal-"));
  try {
    // A minimal canonical root: scripts/test.sh with a real `glob=(...)` line, one package's test
    // dir with a modern file + a legacy file + a would-be-exempted hand-rolled file.
    fs.mkdirSync(path.join(scratch, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(scratch, "scripts", "test.sh"),
      'glob=(packages/*/test/*.test.mjs)\nexec node --test "${files[@]}"\n'
    );
    const testDir = path.join(scratch, "packages", "quay", "test");
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, "modern.test.mjs"), nodeTestSource);
    fs.writeFileSync(path.join(testDir, "legacy.test.mjs"), legacySource);
    fs.writeFileSync(path.join(testDir, "zz-new.test.mjs"), legacySource);

    const dataFile = path.join(scratch, "plugin", "test-framework-policy-exemptions.txt");
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, "packages/quay/test/legacy.test.mjs\n");

    // Baseline (committed form): the same 1-entry list; baseline file set = the two pre-existing
    // files (zz-new is NOT there, so it is genuinely "new").
    const baselineFile = path.join(scratch, "baseline-exemptions.txt");
    fs.writeFileSync(baselineFile, "packages/quay/test/legacy.test.mjs\n");
    const baselineFiles = path.join(scratch, "baseline-files.txt");
    fs.writeFileSync(baselineFiles, "packages/quay/test/modern.test.mjs\npackages/quay/test/legacy.test.mjs\n");

    function runCheck() {
      return spawnSync(
        "node",
        [
          "--experimental-strip-types",
          CHECK_TS,
          scratch,
          "--data-file", dataFile,
          "--baseline-file", baselineFile,
          "--baseline-files", baselineFiles,
        ],
        { encoding: "utf8", timeout: 30_000 }
      );
    }

    // GREEN: the hand-rolled zz-new.test.mjs is NOT in the list → AC3 fires (the 35th file).
    let res = runCheck();
    assert.equal(res.status, 1, `expected AC3 failure before listing zz-new:\n${res.stdout}`);
    assert.match(res.stdout, /AC3: packages\/quay\/test\/zz-new\.test\.mjs/);

    // The would-be escape: add zz-new to the exemption list. Now the ratchet (AC4) must fire —
    // the file was ADDED to the list, which only ever shrinks.
    fs.writeFileSync(dataFile, "packages/quay/test/legacy.test.mjs\npackages/quay/test/zz-new.test.mjs\n");
    res = runCheck();
    assert.equal(res.status, 1, `expected AC4 ratchet failure after listing zz-new:\n${res.stdout}`);
    assert.match(res.stdout, /ADDED to the exemption list/);
    assert.doesNotMatch(res.stdout, /AC3: packages\/quay\/test\/zz-new/); // listed → exempt from AC3

    // Remove the addition (and the temp file) → green again.
    fs.writeFileSync(dataFile, "packages/quay/test/legacy.test.mjs\n");
    fs.rmSync(path.join(testDir, "zz-new.test.mjs"));
    res = runCheck();
    assert.equal(res.status, 0, `expected PASS after removing zz-new:\n${res.stdout}`);
    assert.match(res.stdout, /PASS/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// ── REFUTE round-1 regression: a broken git baseline FAILS CLOSED (no silent degrade) ──────────────
test("REFUTE: without a git baseline and without overrides the check fails closed (exit 2)", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fw-policy-nogit-"));
  try {
    fs.mkdirSync(path.join(scratch, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(scratch, "scripts", "test.sh"), 'glob=(packages/*/test/*.test.mjs)\n');
    fs.mkdirSync(path.join(scratch, "packages", "quay", "test"), { recursive: true });
    fs.writeFileSync(path.join(scratch, "packages", "quay", "test", "modern.test.mjs"), nodeTestSource);
    fs.mkdirSync(path.join(scratch, "plugin"), { recursive: true });
    fs.writeFileSync(path.join(scratch, "plugin", "test-framework-policy-exemptions.txt"), "# baseline-count: 1\npackages/quay/test/modern.test.mjs\n");
    const res = spawnSync("node", ["--experimental-strip-types", CHECK_TS, scratch], { encoding: "utf8", timeout: 30_000 });
    assert.equal(res.status, 2, `expected exit 2 (fail closed) without git:\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stderr, /git baseline/i);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// ── REFUTE round-1 regression: the count-ceiling ratchet is commit-surviving ───────────────────────
test("REFUTE: committing a hand-rolled test + its exemption in one commit is caught by the ceiling", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fw-policy-git-"));
  try {
    const run = (args) => spawnSync("git", ["-C", scratch, ...args], { encoding: "utf8", timeout: 30_000 });
    run(["init", "-q"]);
    run(["config", "user.email", "test@example.com"]);
    run(["config", "user.name", "Test"]);
    run(["config", "commit.gpgsign", "false"]);

    fs.mkdirSync(path.join(scratch, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(scratch, "scripts", "test.sh"), 'glob=(packages/*/test/*.test.mjs)\nexec node --test "${files[@]}"\n');
    const testDir = path.join(scratch, "packages", "quay", "test");
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, "modern.test.mjs"), nodeTestSource);
    fs.mkdirSync(path.join(scratch, "plugin"), { recursive: true });
    fs.writeFileSync(path.join(scratch, "plugin", "test-framework-policy-exemptions.txt"), "# baseline-count: 1\npackages/quay/test/modern.test.mjs\n");
    run(["add", "-A"]);
    run(["commit", "-q", "-m", "baseline"]);

    // SMUGGLE in one commit: a hand-rolled test AND its exemption line (ceiling stays 1).
    fs.writeFileSync(path.join(testDir, "smuggled.test.mjs"), legacySource);
    fs.writeFileSync(
      path.join(scratch, "plugin", "test-framework-policy-exemptions.txt"),
      "# baseline-count: 1\npackages/quay/test/modern.test.mjs\npackages/quay/test/smuggled.test.mjs\n"
    );
    run(["add", "-A"]);
    run(["commit", "-q", "-m", "smuggle a hand-rolled test + exemption"]);

    // At this clean commit, working tree == HEAD, so the git strict-subset is blind — the
    // count ceiling (2 > 1) is the backstop and MUST fire.
    const res = spawnSync("node", ["--experimental-strip-types", CHECK_TS, scratch], { encoding: "utf8", timeout: 30_000 });
    assert.equal(res.status, 1, `expected ceiling FAIL at the smuggling commit:\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /over the ratchet ceiling/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
