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
  readAntiDriftExempt,
  partitionExempt,
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
  // ⛔ Written into a TEMP dir, NOT into the checked-in `fixtures/antidrift/`: the manifest here is
  // DISPOSABLE INPUT, not a checked-in fixture, and writing it into the repo tree is a real violation
  // of `checked-in-write-check` (it flagged this test the moment this file entered a task delta — the
  // scoped tier is `--changed`-scoped, so an untouched-but-real defect stays invisible until the file
  // is touched). Same assertion, no write into the checked-in tree.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "antidrift-malformed-"));
  const bad = path.join(scratch, "malformed.json");
  try {
    fs.writeFileSync(bad, JSON.stringify([{ id: "A", touches: ["x/a.js"] }]));
    assert.equal(await main(["node", "s", bad]), 1);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
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

// ── anti_drift.exempt: project-configurable exemption globs ──────────────────────────────────────
// gap-anti-drift-touches-project-configurable-exempt-globs. A target project (cloudcli, 2026-09-20)
// was deadlocked: a backend task NECESSARILY drags in a barrel (`server/modules/providers/index.ts`)
// because implementing it means adding an export, and `## Touches` is required to stay minimal — so
// the per-file out-of-declared judgment bit a CORRECT implementation. The fix is a flat, project-owned
// waiver list in the WORKSPACE-ROOT `.quay/config.yml`:
//
//   anti_drift:
//     exempt:
//       - glob: "server/modules/*/index.ts"
//         reason: "barrel re-export"
//
// The four properties these tests pin (see the module header for the full statement):
//   ① one flat glob list, exempt globs NOT screened for overbroadness (the project decides);
//   ② the output ENUMERATES the waiver (`exempted: <file> <- <glob>` + a count);
//   ③ a malformed list is a DISTINCT fail-closed verdict, never a pass and never `out-of-declared`;
//   ④ the read source is the WORKSPACE ROOT config, NEVER the worktree copy.
// Plus: an all-exempt diff is judged exactly like an empty diff, and an absent config is byte-for-byte
// the pre-change behavior.
//
// FALSIFIABILITY (the pair is what pins the implementation — neither half is evidence alone):
//   · drop the waiver arm (`exempt` never applied) ⇒ the positive test goes red (exit 1).
//   · make the waiver arm a blanket pass ⇒ the negative-control test goes red.

const EXEMPT_YAML = 'anti_drift:\n  exempt:\n    - glob: "server/modules/*/index.ts"\n      reason: "barrel re-export"\n';
const EXEMPT_BARREL = "server/modules/providers/index.ts";
const EXEMPT_TASK_BODY = "## Touches\n\n- src/feature.txt\n- tasks/T-1.md\n";

/** Run main() while capturing its stdout, so a test can assert on the TEXT (not just the exit code)
 *  — the enumeration requirement ② is a text property. Same write-patch the BASELINE tests use. */
async function adRunCapture(argv) {
  const chunks = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (c) => { chunks.push(String(c)); return true; };
  let code;
  try {
    code = await main(argv);
  } finally {
    process.stdout.write = write;
  }
  return { code, out: chunks.join("") };
}
const adDriverArgv = (worktree) => ["node", "s", "--task", "T-1", "--worktree", worktree, "--merge-target", "develop"];

/** Write `<dir>/.quay/config.yml`; `null` means "no config file at all". */
function adWriteConfig(dir, configYml) {
  if (configYml === null) return;
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".quay", "config.yml"), configYml);
}

/** Shape: the task's diff is {declared feature, declared task file, UNDECLARED barrel}. The barrel
 *  matches the documented exempt glob, so it is the fixture's whole point. */
function barrelRepo(configYml) {
  const dir = adRepo();
  adGit(dir, ["branch", "-M", "master"]);
  for (const d of ["src", "tasks", "server/modules/providers"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "base.txt"), "base\n");
  adWriteConfig(dir, configYml);
  adCommit(dir, "base");
  adGit(dir, ["checkout", "-q", "-b", "develop"]);
  adGit(dir, ["checkout", "-q", "-b", "task/T-1"]);
  fs.writeFileSync(path.join(dir, "src", "feature.txt"), "feature\n");
  fs.writeFileSync(path.join(dir, EXEMPT_BARREL), "export * from './a.ts';\n");
  fs.writeFileSync(path.join(dir, "tasks", "T-1.md"), EXEMPT_TASK_BODY);
  adCommit(dir, "implement feature (necessarily drags in the barrel)");
  adGit(dir, ["merge", "--no-edit", "develop"]);
  return dir;
}

/** Shape: the task's ENTIRE diff is the exempt barrel — removing the waived files leaves nothing. */
function exemptOnlyRepo(configYml) {
  const dir = adRepo();
  adGit(dir, ["branch", "-M", "master"]);
  for (const d of ["src", "tasks"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "base.txt"), "base\n");
  fs.writeFileSync(path.join(dir, "tasks", "T-1.md"), EXEMPT_TASK_BODY); // on `master` ⇒ not in the task diff
  adWriteConfig(dir, configYml);
  adCommit(dir, "base");
  adGit(dir, ["checkout", "-q", "-b", "develop"]);
  adGit(dir, ["checkout", "-q", "-b", "task/T-1"]);
  fs.mkdirSync(path.join(dir, "server", "modules", "providers"), { recursive: true });
  fs.writeFileSync(path.join(dir, EXEMPT_BARREL), "export * from './a.ts';\n");
  adCommit(dir, "the barrel and nothing else");
  adGit(dir, ["merge", "--no-edit", "develop"]);
  return dir;
}

/** Shape: the task branch has NO commit at all — the reference "empty diff" case. */
function emptyDiffRepo(configYml) {
  const dir = adRepo();
  adGit(dir, ["branch", "-M", "master"]);
  for (const d of ["src", "tasks"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "base.txt"), "base\n");
  fs.writeFileSync(path.join(dir, "tasks", "T-1.md"), EXEMPT_TASK_BODY);
  adWriteConfig(dir, configYml);
  adCommit(dir, "base");
  adGit(dir, ["checkout", "-q", "-b", "develop"]);
  adGit(dir, ["checkout", "-q", "-b", "task/T-1"]);
  adGit(dir, ["merge", "--no-edit", "develop"]);
  return dir;
}

test("anti_drift.exempt: an undeclared barrel covered by the workspace-root waiver ⇒ exit 0, ENUMERATED", async () => {
  const dir = barrelRepo(EXEMPT_YAML);
  try {
    const { code, out } = await adRunCapture(adDriverArgv(dir));
    assert.equal(code, 0, `the waiver must clear the barrel; got exit ${code}:\n${out}`);
    assert.match(out, /ANTI-DRIFT OK: task T-1/);
    assert.match(out, /exempted \(1\)/, "the exempted COUNT must be reported (硬规则 3)");
    assert.match(
      out,
      /exempted: server\/modules\/providers\/index\.ts <- server\/modules\/\*\/index\.ts/,
      "the waived FILE and the GLOB it matched must both be enumerated",
    );
    assert.doesNotMatch(out, /out-of-declared/, "the waived file must not also be reported as a violation");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("anti_drift.exempt negative-control: the SAME diff with NO config is still out-of-declared", async () => {
  const dir = barrelRepo(null);
  try {
    const { code, out } = await adRunCapture(adDriverArgv(dir));
    assert.notEqual(code, 0, "the guardrail must still bite when no waiver exists");
    assert.match(out, /ANTI-DRIFT HARD FAIL/);
    assert.match(out, /out-of-declared: task wrote server\/modules\/providers\/index\.ts/);
    assert.doesNotMatch(out, /exempted/, "nothing was waived, so nothing may be reported as waived");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("anti_drift.exempt worktree-copy-ignored: a waiver in the WORKTREE copy does not open one", async () => {
  // Constraint ④. `tasks/T-1.md` is on the base commit (so the task file exists in the worktree);
  // the worktree branch adds the barrel and then writes a waiver into ITS OWN `.quay/config.yml`
  // (uncommitted). The read source is the MAIN checkout, which has no config at all.
  const dir = adRepo();
  const wtParent = fs.mkdtempSync(path.join(os.tmpdir(), "antidrift-wtcopy-"));
  const wt = path.join(wtParent, "wt");
  try {
    adGit(dir, ["branch", "-M", "master"]);
    for (const d of ["src", "tasks"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "base.txt"), "base\n");
    fs.writeFileSync(path.join(dir, "tasks", "T-1.md"), EXEMPT_TASK_BODY);
    adCommit(dir, "base");
    adGit(dir, ["checkout", "-q", "-b", "develop"]);

    adGit(dir, ["worktree", "add", "-q", "-b", "task/T-1", wt, "master"]);
    fs.mkdirSync(path.join(wt, "server", "modules", "providers"), { recursive: true });
    fs.writeFileSync(path.join(wt, EXEMPT_BARREL), "export * from './a.ts';\n");
    adCommit(wt, "implement barrel");
    adWriteConfig(wt, EXEMPT_YAML); // the worktree copy — deliberately NOT committed
    adGit(wt, ["merge", "--no-edit", "develop"]);

    // premise: the worktree copy really does declare the waiver (otherwise this test proves nothing)
    assert.equal(readAntiDriftExempt(wt).status, "ok", "premise: the worktree copy carries a valid waiver");

    const { code, out } = await adRunCapture(adDriverArgv(wt));
    assert.notEqual(code, 0, "a self-granted worktree waiver must not clear the barrel");
    assert.match(out, /out-of-declared: task wrote server\/modules\/providers\/index\.ts/);
    assert.doesNotMatch(out, /exempted/, "the worktree copy's waiver must not be honored");
  } finally {
    try { adGit(dir, ["worktree", "remove", "--force", wt]); } catch { /* best effort */ }
    fs.rmSync(wtParent, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const [label, yml] of [
  ["a missing reason", 'anti_drift:\n  exempt:\n    - glob: "server/modules/*/index.ts"\n'],
  ["a blank reason", 'anti_drift:\n  exempt:\n    - glob: "server/modules/*/index.ts"\n      reason: "   "\n'],
  ["a non-list exempt", 'anti_drift:\n  exempt: "server/modules/*/index.ts"\n'],
]) {
  test(`anti_drift.exempt malformed: ${label} ⇒ fail-closed, and NOT the out-of-declared shape`, async () => {
    const dir = barrelRepo(yml);
    try {
      const { code, out } = await adRunCapture(adDriverArgv(dir));
      assert.notEqual(code, 0, "a malformed waiver list must never pass (硬规则 3b)");
      assert.match(out, /malformed anti_drift/, "the verdict must name the malformed key");
      assert.doesNotMatch(out, /out-of-declared/, "a broken waiver list is a DIFFERENT cause from a stray write");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("anti_drift.exempt absent-config: no config behaves byte-for-byte as before", async () => {
  const none = barrelRepo(null);            // no .quay/ at all
  const emptyFile = barrelRepo("");         // an empty config file
  const noKey = barrelRepo("loop: {}\n");   // a config with no anti_drift key
  try {
    const a = await adRunCapture(adDriverArgv(none));
    const b = await adRunCapture(adDriverArgv(emptyFile));
    const c = await adRunCapture(adDriverArgv(noKey));
    assert.equal(a.code, 1, "with no waiver the barrel is a genuine out-of-declared write");
    assert.equal(b.code, a.code);
    assert.equal(c.code, a.code);
    assert.equal(b.out, a.out, "an empty config file must be byte-identical to no config file");
    assert.equal(c.out, a.out, "a config without an anti_drift key must be byte-identical to no config");
    // The pre-change wording, pinned verbatim — "absent is not an error" must mean NO format change.
    assert.equal(
      a.out,
      "ANTI-DRIFT HARD FAIL: task T-1 — 1 violation(s)\n" +
        "  out-of-declared: task wrote server/modules/providers/index.ts (matches no declared Touches glob)\n",
    );
  } finally {
    for (const d of [none, emptyFile, noKey]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test("anti_drift.exempt exempt-only-equals-empty: an all-exempt diff judges exactly like an empty diff", async () => {
  // Proposal point 5: waived files do not count as "having done something". Removing the waived files
  // must leave the SAME verdict as a diff that was empty to begin with — the `--allow-empty`
  // NON-WAIVABLE semantics are untouched (a zero-file build is still a legal, clean single build).
  const exemptOnly = exemptOnlyRepo(EXEMPT_YAML);
  const emptyDiff = emptyDiffRepo(null);
  try {
    const a = await adRunCapture(adDriverArgv(exemptOnly));
    const b = await adRunCapture(adDriverArgv(emptyDiff));
    assert.equal(a.code, b.code, "the two exit codes must match, side by side");
    assert.equal(a.code, 0);
    const verdictLine = (s) => s.split("\n")[0];
    assert.equal(verdictLine(a.out), verdictLine(b.out), "the verdict wording must be identical");
    assert.equal(
      verdictLine(b.out),
      "ANTI-DRIFT OK: task T-1 — 0 actual file(s), all within declared Touches (2 glob(s))",
      "the reference empty-diff verdict line",
    );
    assert.match(a.out, /exempted \(1\)/, "the waiver is EXTRA information appended to the same verdict");
    assert.doesNotMatch(b.out, /exempted/, "an empty diff waives nothing");
  } finally {
    fs.rmSync(exemptOnly, { recursive: true, force: true });
    fs.rmSync(emptyDiff, { recursive: true, force: true });
  }
});

test("readAntiDriftExempt: an overbroad-looking exempt glob is ACCEPTED (the project's call)", () => {
  // Constraint ①: exempt globs are deliberately NOT screened by isOverbroadDeclaration. `**/index.ts`
  // would be rejected as a Touches declaration; as a WAIVER it is the project choosing how wide to
  // cast its own exception net, which is explicitly its business.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "antidrift-cfg-"));
  try {
    fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".quay", "config.yml"), 'anti_drift:\n  exempt:\n    - glob: "**/index.ts"\n      reason: "any barrel"\n');
    const r = readAntiDriftExempt(dir);
    assert.equal(r.status, "ok");
    assert.deepEqual(r.entries, [{ glob: "**/index.ts", reason: "any barrel" }]);
    assert.deepEqual(partitionExempt(["a/b/index.ts", "a/c.ts"], r.entries), {
      judged: ["a/c.ts"],
      exempted: [{ file: "a/b/index.ts", glob: "**/index.ts" }],
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
