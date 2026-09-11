// @test-group engine
// Unit tests for anti-drift-touches-check.mjs — the NON-WAIVABLE after-the-fact HARD guardrail
// (DIR-044 increment 4; charter Step 5). After a concurrent batch RAN, each build's ACTUAL touched
// files (from `git diff --numstat`) are checked against what it DECLARED: a build that wrote OUTSIDE
// its declared `touches`, or two builds that ACTUALLY overlapped (a mis-declared batch), is a HARD
// FAIL — the guardrail that keeps concurrency from silently corrupting shared state. RED-first
// (ADR-001 / DIR-019): the guardrail MUST bite a mis-declared fixture.
// Run: node --test experiments/quay-perpetual-stream/test/anti-drift-touches-check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fileWithinDeclared,
  normalizePath,
  checkAntiDrift,
  main,
} from "../scripts/anti-drift-touches-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "..", "fixtures", "antidrift");
const fx = (f) => path.join(FIX, f);

// ── fileWithinDeclared ───────────────────────────────────────────────────────────────────────────
test("fileWithinDeclared: a file matching a declared glob is within", () => {
  assert.equal(fileWithinDeclared("pkg/a/x.js", ["pkg/a/**"]), true);
  assert.equal(fileWithinDeclared("pkg/b/x.js", ["pkg/a/**"]), false);
  assert.equal(fileWithinDeclared("pkg/a/x.js", []), false); // nothing declared → nothing is within
});

// ── checkAntiDrift ───────────────────────────────────────────────────────────────────────────────
const clean = [
  { id: "A", declaredGlobs: ["pkg/a/**"], actualFiles: ["pkg/a/x.js", "pkg/a/y.js"] },
  { id: "B", declaredGlobs: ["pkg/b/**"], actualFiles: ["pkg/b/z.js"] },
];

test("checkAntiDrift: a clean batch (actual ⊆ declared, no cross-overlap) → ok", () => {
  const r = checkAntiDrift(clean);
  assert.equal(r.ok, true);
  assert.deepEqual(r.violations, []);
});

test("checkAntiDrift: a build that ACTUALLY overlapped another (mis-declared) → HARD FAIL", () => {
  const misdeclared = [
    { id: "A", declaredGlobs: ["pkg/a/**", "shared/s.js"], actualFiles: ["pkg/a/x.js", "shared/s.js"] },
    { id: "B", declaredGlobs: ["pkg/b/**", "shared/s.js"], actualFiles: ["pkg/b/z.js", "shared/s.js"] },
  ];
  const r = checkAntiDrift(misdeclared);
  assert.equal(r.ok, false);
  const overlap = r.violations.find((v) => v.type === "cross-build-overlap");
  assert.ok(overlap, "expected a cross-build-overlap violation");
  assert.equal(overlap.file, "shared/s.js");
});

test("checkAntiDrift: a build that WROTE OUTSIDE its declared touches → HARD FAIL", () => {
  const strayWrite = [
    { id: "A", declaredGlobs: ["pkg/a/**"], actualFiles: ["pkg/a/x.js", "pkg/OTHER/stray.js"] },
    { id: "B", declaredGlobs: ["pkg/b/**"], actualFiles: ["pkg/b/z.js"] },
  ];
  const r = checkAntiDrift(strayWrite);
  assert.equal(r.ok, false);
  const stray = r.violations.find((v) => v.type === "out-of-declared");
  assert.ok(stray, "expected an out-of-declared violation");
  assert.equal(stray.file, "pkg/OTHER/stray.js");
  assert.equal(stray.build, "A");
});

test("checkAntiDrift: a build with NO declared touches but real writes → all writes are violations", () => {
  const r = checkAntiDrift([{ id: "A", declaredGlobs: [], actualFiles: ["pkg/a/x.js"] }]);
  assert.equal(r.ok, false);
  assert.equal(r.violations[0].type, "out-of-declared");
});

test("checkAntiDrift: a build that touched nothing → ok (a no-op build is not drift)", () => {
  const r = checkAntiDrift([{ id: "A", declaredGlobs: ["pkg/a/**"], actualFiles: [] }]);
  assert.equal(r.ok, true);
});

test("checkAntiDrift: three builds, one pair overlaps → the specific pair is reported", () => {
  const r = checkAntiDrift([
    { id: "A", declaredGlobs: ["a/**"], actualFiles: ["a/x.js"] },
    { id: "B", declaredGlobs: ["b/**", "a/x.js"], actualFiles: ["b/y.js", "a/x.js"] }, // overlaps A
    { id: "C", declaredGlobs: ["c/**"], actualFiles: ["c/z.js"] },
  ]);
  assert.equal(r.ok, false);
  const ov = r.violations.find((v) => v.type === "cross-build-overlap");
  assert.deepEqual([ov.a, ov.b].sort(), ["A", "B"]);
});

// ── hardening from the increment-4 adversarial audit (H3 overbroad, H1 normalization) ─────────────
test("checkAntiDrift: an OVERBROAD declaration (packages/**) is rejected — closes audit H3", () => {
  // Without this, `packages/**` would absorb a stray write and the out-of-declared arm is toothless.
  const r = checkAntiDrift([
    { id: "A", declaredGlobs: ["packages/**"], actualFiles: ["packages/quay/x.js", "packages/UNRELATED/stray.js"] },
    { id: "B", declaredGlobs: ["experiments/**/z.js"], actualFiles: ["experiments/a/z.js"] },
  ]);
  assert.equal(r.ok, false);
  const ob = r.violations.find((v) => v.type === "overbroad-declaration");
  assert.ok(ob, "expected an overbroad-declaration violation");
  assert.equal(ob.build, "A");
  assert.equal(ob.glob, "packages/**");
});

test("checkAntiDrift: cross-build overlap survives path-shape differences (./ prefix) — closes audit H1", () => {
  const r = checkAntiDrift([
    { id: "A", declaredGlobs: ["shared/s.js"], actualFiles: ["./shared/s.js"] },
    { id: "B", declaredGlobs: ["shared/s.js"], actualFiles: ["shared/s.js"] },
  ]);
  assert.equal(r.ok, false);
  const ov = r.violations.find((v) => v.type === "cross-build-overlap");
  assert.ok(ov, "the ./-prefixed path must still be seen as the same file");
  assert.equal(ov.file, "shared/s.js");
});

test("normalizePath: strips leading ./, trailing /, collapses //, resolves ./.. segments", () => {
  assert.equal(normalizePath("./a/b.js"), "a/b.js");
  assert.equal(normalizePath("a//b.js"), "a/b.js");
  assert.equal(normalizePath("a/b/"), "a/b");
  assert.equal(normalizePath("a/./b.js"), "a/b.js");       // dot segment (audit H1 class)
  assert.equal(normalizePath("a/../a/b.js"), "a/b.js");    // parent segment
  assert.equal(normalizePath(".//a/b.js"), "a/b.js");      // the .// normalization bug
  assert.equal(normalizePath("a\\b.js"), "a/b.js");        // backslashes
});

test("checkAntiDrift: dot-segment path variants of the same file still collide (audit H1 dot-class)", () => {
  const r = checkAntiDrift([
    { id: "A", declaredGlobs: ["a/**"], actualFiles: ["a/./b.js"] },
    { id: "B", declaredGlobs: ["a/**"], actualFiles: ["a/b.js"] },
  ]);
  // NB: a/** is overbroad? no — "a" is 1 concrete segment before ** → overbroad. Use deeper decls:
  const r2 = checkAntiDrift([
    { id: "A", declaredGlobs: ["a/sub/**"], actualFiles: ["a/sub/../sub/b.js"] },
    { id: "B", declaredGlobs: ["a/sub/**"], actualFiles: ["a/sub/b.js"] },
  ]);
  assert.equal(r2.ok, false);
  assert.ok(r2.violations.find((v) => v.type === "cross-build-overlap" && v.file === "a/sub/b.js"));
});

test("checkAntiDrift: the audit's overbroad evasions (packages/**/*, **/*.js) are now HARD FAIL", () => {
  for (const g of ["packages/**/*", "**/*.js", "packages/*/**"]) {
    const r = checkAntiDrift([{ id: "A", declaredGlobs: [g], actualFiles: ["packages/UNRELATED/stray.js"] }]);
    assert.equal(r.ok, false, `expected ${g} to be rejected as overbroad`);
    assert.ok(r.violations.find((v) => v.type === "overbroad-declaration"), `no overbroad violation for ${g}`);
  }
});

// ── main() over JSON manifests (green + the two RED guardrail-bites cases) ────────────────────────
test("main: GREEN manifest (clean batch) → exit 0", async () => {
  assert.equal(await main(["node", "s", fx("green.json")]), 0);
});

test("main: RED manifest (cross-build overlap) → exit 1 (guardrail bites)", async () => {
  assert.equal(await main(["node", "s", fx("red-overlap.json")]), 1);
});

test("main: RED manifest (wrote outside declared) → exit 1 (guardrail bites)", async () => {
  assert.equal(await main(["node", "s", fx("red-stray.json")]), 1);
});

test("main: RED manifest (overbroad declaration) → exit 1 (guardrail bites — audit H3)", async () => {
  assert.equal(await main(["node", "s", fx("red-overbroad.json")]), 1);
});

test("main: missing manifest → exit 2", async () => {
  assert.equal(await main(["node", "s", fx("nope.json")]), 2);
});

test("checkAntiDrift: malformed manifest (wrong field names) FAILS CLOSED — DIR-049 wiring audit", () => {
  // a wrong-field-name manifest must NOT silently pass a NON-WAIVABLE guardrail
  assert.throws(() => checkAntiDrift([{ id: "A", touches: ["x/a.js"] }]), /declaredGlobs|fail-closed/i);
  assert.throws(() => checkAntiDrift([{ id: "A", declaredGlobs: ["x/**"], writtenFiles: ["x/a.js"] }]), /actualFiles|fail-closed/i);
  assert.throws(() => checkAntiDrift([{ declaredGlobs: [], actualFiles: [] }]), /string id/i);
});

test("main: malformed manifest → exit 1 (HARD FAIL, not OK)", async () => {
  const bad = fx("malformed.json");
  fs.writeFileSync(bad, JSON.stringify([{ id: "A", touches: ["x/a.js"] }]));
  assert.equal(await main(["node", "s", bad]), 1);
  fs.rmSync(bad, { force: true });
});

test("main: no manifest arg → exit 2", async () => {
  assert.equal(await main(["node", "s"]), 2);
});

// ── EMPTY-SET fail-closed (gap-checks-that-verify-an-empty-set-must-fail-closed) ────────────────
test("checkAntiDrift: EMPTY builds manifest FAILS CLOSED — 0 builds is 'never looked'", () => {
  // A manifest of zero builds must NOT pass a NON-WAIVABLE guardrail: "ANTI-DRIFT OK: 0 builds" is
  // indistinguishable from "the check never ran" (serial-fanin-absorb already throws on empty builds).
  assert.throws(() => checkAntiDrift([]), /empty builds manifest/i);
  // Explicit --allow-empty escape hatch (default deny).
  const waived = checkAntiDrift([], { allowEmpty: true });
  assert.equal(waived.ok, true);
  assert.equal(waived.violations.length, 0);
});

test("main: EMPTY manifest → exit 1 (HARD FAIL, not OK); --allow-empty → exit 0", async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "antidrift-empty-"));
  const empty = path.join(scratch, "empty-manifest.json");
  fs.writeFileSync(empty, JSON.stringify([]));
  try {
    assert.equal(await main(["node", "s", empty]), 1, "empty manifest must fail-closed");
    assert.equal(await main(["node", "s", empty, "--allow-empty"]), 0, "--allow-empty waives the empty-set guard");
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// ── BASELINE-MISMATCH: a foreign landing baseline is a DISTINCT cause ───────────────────────────
// gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing. Measured 2026-09-11: a
// project whose `develop` was an ancient fork of `main` made a CORRECTLY-implemented task report
// "ANTI-DRIFT HARD FAIL: 1566 violation(s)" — the diff against a foreign baseline is the mainline's
// divergence, not the task's work, so no `## Touches` can satisfy it and the old text blamed the
// task. The cause is now a distinct verdict with a distinct exit code.
//
// FALSIFIABILITY: drop the `baseline.state === "divergent"` branch from runTaskDriver and the first
// two tests below fail (exit becomes 1 with a violation count).

function adGit(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}
function adCommit(cwd, msg) {
  adGit(cwd, ["add", "-A"]);
  adGit(cwd, ["commit", "-q", "-m", msg]);
}
function adRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "antidrift-baseline-"));
  adGit(dir, ["init", "-q", "-b", "main"]);
  adGit(dir, ["config", "user.name", "ad-test"]);
  adGit(dir, ["config", "user.email", "ad@example.com"]);
  return dir;
}
/** Shape ②: mainline `main`; `develop` forked 30 commits back and never merged forward. */
function foreignDevelopRepo() {
  const dir = adRepo();
  for (let i = 1; i <= 40; i++) {
    fs.writeFileSync(path.join(dir, `m${i}.txt`), `${i}\n`);
    adCommit(dir, `mainline commit ${i}`);
  }
  adGit(dir, ["checkout", "-q", "-b", "develop", "main~30"]);
  fs.writeFileSync(path.join(dir, "legacy.txt"), "ancient\n");
  adCommit(dir, "ancient develop work");
  adGit(dir, ["checkout", "-q", "-b", "task/T-1", "main"]);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "feature.txt"), "feature\n");
  fs.writeFileSync(path.join(dir, "tasks", "T-1.md"), "## Touches\n\n- src/feature.txt\n- tasks/T-1.md\n");
  adCommit(dir, "implement feature");
  // the fan-in's step 1: merge the landing baseline into the task worktree
  try { adGit(dir, ["merge", "--no-edit", "develop"]); } catch { /* conflict: still a valid fixture */ }
  return dir;
}
/** Shape ①: `develop` continues the default branch — the shipped behavior must be unchanged. */
function quayShapedRepo() {
  const dir = adRepo();
  adGit(dir, ["branch", "-M", "master"]);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "base.txt"), "base\n");
  adCommit(dir, "base");
  adGit(dir, ["checkout", "-q", "-b", "develop"]);
  adGit(dir, ["checkout", "-q", "-b", "task/T-1"]);
  fs.writeFileSync(path.join(dir, "src", "feature.txt"), "feature\n");
  fs.writeFileSync(path.join(dir, "tasks", "T-1.md"), "## Touches\n\n- src/feature.txt\n- tasks/T-1.md\n");
  adCommit(dir, "implement feature");
  adGit(dir, ["merge", "--no-edit", "develop"]);
  return dir;
}

test("BASELINE-MISMATCH: a foreign `develop` is reported as a baseline defect, not a violation count", async () => {
  const dir = foreignDevelopRepo();
  try {
    // premise: the diff quay would compute really is the mainline's divergence, not the task's work
    const againstMain = adGit(dir, ["diff", "--name-only", "main...HEAD"]).split("\n").filter(Boolean).length;
    const againstDevelop = adGit(dir, ["diff", "--name-only", "develop...HEAD"]).split("\n").filter(Boolean).length;
    assert.ok(againstDevelop > againstMain + 20, `premise: develop diff (${againstDevelop}) dwarfs the task's own work (${againstMain})`);
    assert.equal(await main(["node", "s", "--task", "T-1", "--worktree", dir, "--merge-target", "develop"]), 3, "distinct exit code for a distinct cause");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("BASELINE-MISMATCH: the message names the baseline and the remedy, and does NOT blame the task", async () => {
  const dir = foreignDevelopRepo();
  const chunks = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (c) => { chunks.push(String(c)); return true; };
  let code;
  try {
    code = await main(["node", "s", "--task", "T-1", "--worktree", dir, "--merge-target", "develop"]);
  } finally {
    process.stdout.write = write;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const out = chunks.join("");
  assert.equal(code, 3);
  assert.match(out, /BASELINE-MISMATCH/);
  assert.match(out, /not a continuation of the project's default branch 'main'/);
  assert.match(out, /adopt-branch-model/, "the remedy must be actionable");
  assert.doesNotMatch(out, /violation/, "the misleading violation count must be GONE, not appended to");
});

test("shape ①: a `develop` that continues the default branch judges normally (behavior unchanged)", async () => {
  const dir = quayShapedRepo();
  try {
    assert.equal(await main(["node", "s", "--task", "T-1", "--worktree", dir, "--merge-target", "develop"]), 0, "a clean task on a healthy baseline still passes");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("shape ① control: the SAME repo with an out-of-declared write still HARD FAILS (exit 1)", async () => {
  const dir = quayShapedRepo();
  try {
    fs.writeFileSync(path.join(dir, "stray.txt"), "stray\n");
    adCommit(dir, "undeclared write");
    assert.equal(await main(["node", "s", "--task", "T-1", "--worktree", dir, "--merge-target", "develop"]), 1, "the guardrail must still bite — the baseline check must not mask real drift");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unresolvable default branch ⇒ NO verdict (unreadable is not divergent)", async () => {
  // Hard rule 3b: "could not tell" must not be reported as "bad". A repo with no conventional
  // default branch and a worktree-style HEAD proceeds to the NORMAL judgment.
  const dir = adRepo();
  try {
    adGit(dir, ["branch", "-M", "trunk"]);
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "feature.txt"), "feature\n");
    fs.writeFileSync(path.join(dir, "tasks", "T-1.md"), "## Touches\n\n- src/feature.txt\n- tasks/T-1.md\n");
    adCommit(dir, "base");
    adGit(dir, ["checkout", "-q", "-b", "develop"]);
    assert.equal(await main(["node", "s", "--task", "T-1", "--worktree", dir, "--merge-target", "develop"]), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
