// @test-group engine
// release-master-advance-needs-check.test.mjs — unit + CLI + real-artifact tests for the
// `advance-master.needs ⊇ (every other job)` assertion
// (tasks/gap-first-green-release-and-master-ff, GOAL-020 AC-274; SPEC §6.1 invariant 3).
//
// Coverage map:
//   AC (three-state): PASS(0) / FAIL(1) / NOT-EVALUATED(3) are three DISTINCT exit codes, and each
//     NOT-EVALUATED shape carries its OWN reason slug (workflow-absent / jobs-block-unreadable /
//     target-job-absent) so "could not read" is never conflated with "read it and it was clean"
//     (硬规则 3b). Every one of these is exercised through the REAL CLI, not only the pure function.
//   AC (the invariant bites): a job added to the workflow and NOT added to `needs:` ⇒ FAIL naming it.
//     ⛔ The real-artifact control below is the point: a run against release.yml alone proves only
//     "the shipping file happens to be covered", not "the checker can go red" (硬规则 4).
//   AC (absent `needs:` is a FAIL, not a NOT-EVALUATED): a job with no dependencies moves master on
//     ANY release run, so that readable-but-worst shape must be RED — an implementation that folds it
//     into "nothing to compare" would render a live defect as "couldn't judge".
//   AC (real artifact): the repo's OWN `.github/workflows/release.yml` passes, and a verbatim copy of
//     it with a 7th job appended fails. Both directions on the shipping text.
//   AC (set semantics): the comparison is against the file's own job keys, so adding a job anywhere in
//     `jobs:` (before or after advance-master) is caught; and `needs` naming an unknown job is
//     reported as a count, not mistaken for coverage.
//
// Run:
//   scripts/test.sh plugin/test/release-master-advance-needs-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECK = path.join(REPO_ROOT, "plugin", "scripts", "release-master-advance-needs-check.ts");
const REAL_WF = path.join(REPO_ROOT, ".github", "workflows", "release.yml");
const MUTATION_CASE = path.join(
  REPO_ROOT, "plugin", "scripts", "checker-mutation-cases", "release-master-advance-needs-check.sh",
);

/** Drive the real CLI in a temp root; returns { status, stdout, stderr }. */
function runCli(root) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECK, "--root", root], {
    encoding: "utf8",
  });
}

/** Materialise one workflow text into a fresh temp root and judge it through the CLI. */
function judgeText(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rmanc-"));
  fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".github", "workflows", "release.yml"), text, "utf8");
  const r = runCli(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  return r;
}

const HEADER = `name: Release
on:
  workflow_dispatch:
    inputs:
      tag:
        description: tag
        required: true
        type: string
`;

/** A file whose advance-master covers every other job, with an extra job appearable anywhere. */
function covered(extraJob = "") {
  return `${HEADER}jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - run: echo release
  delivery-manifest-verify:
    needs: [release]
    runs-on: ubuntu-latest
    steps:
      - run: echo manifest
  advance-master:
    needs: [release, delivery-manifest-verify]
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - run: git push origin "\${TAG}:master"
${extraJob}`;
}

// ── the pure predicate ────────────────────────────────────────────────────────────────────────────

test("needsToNames: absent/empty value ⇒ readable ∅ (NOT the unreadable null)", async () => {
  const { needsToNames } = await import("../scripts/release-master-advance-needs-check.ts");
  assert.deepEqual(needsToNames(undefined), []);
  assert.deepEqual(needsToNames(null), []);
  assert.deepEqual(needsToNames(""), []);
  // ⛔ the distinction that matters: a value we cannot read as a job list must be null, not [].
  assert.equal(needsToNames({ job: "release" }), null);
  assert.equal(needsToNames([["nested"]]), null);
  // both scalar forms YAML allows for needs: are readable
  assert.deepEqual(needsToNames("release"), ["release"]);
  assert.deepEqual(needsToNames(["a", "b"]), ["a", "b"]);
});

test("judgeWorkflowText: the covered fixture is a PASS that names the set it examined", async () => {
  const { judgeWorkflowText } = await import("../scripts/release-master-advance-needs-check.ts");
  const o = judgeWorkflowText(covered());
  assert.equal(o.state, "pass");
  assert.deepEqual([...o.jobs].sort(), ["advance-master", "delivery-manifest-verify", "release"]);
  assert.deepEqual([...o.others].sort(), ["delivery-manifest-verify", "release"]);
});

test("judgeWorkflowText: a job NOT in needs is named as missing (the invariant can be false)", async () => {
  const { judgeWorkflowText } = await import("../scripts/release-master-advance-needs-check.ts");
  const o = judgeWorkflowText(covered(`  sea-release:
    runs-on: ubuntu-latest
    steps:
      - run: echo sea
`));
  assert.equal(o.state, "fail");
  assert.deepEqual(o.missing, ["sea-release"]);
});

test("judgeWorkflowText: a job appearing BEFORE advance-master is judged too (set, not prefix scan)", async () => {
  const { judgeWorkflowText } = await import("../scripts/release-master-advance-needs-check.ts");
  const text = `jobs:
  zzz-first-job:
    runs-on: ubuntu-latest
    steps:
      - run: echo z
  release:
    runs-on: ubuntu-latest
    steps:
      - run: echo release
  advance-master:
    needs: [release]
    runs-on: ubuntu-latest
    steps:
      - run: echo push
`;
  const o = judgeWorkflowText(text);
  assert.equal(o.state, "fail");
  assert.deepEqual(o.missing, ["zzz-first-job"]);
});

test("judgeWorkflowText: needs naming an unknown job is COUNTED, not treated as coverage", async () => {
  const { judgeWorkflowText } = await import("../scripts/release-master-advance-needs-check.ts");
  const text = `jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - run: echo release
  advance-master:
    needs: [release, a-job-that-does-not-exist]
    runs-on: ubuntu-latest
    steps:
      - run: echo push
`;
  const o = judgeWorkflowText(text);
  assert.equal(o.state, "pass", "an unknown needs entry cannot advance master on a partial green — GitHub will not run the workflow");
  assert.deepEqual(o.unknownNeeds, ["a-job-that-does-not-exist"]);
});

// ── the CLI's three states, each DISTINGUISHABLE ──────────────────────────────────────────────────

test("CLI: real covered fixture ⇒ exit 0", () => {
  const r = judgeText(covered());
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^PASS:/);
});

test("CLI: a 7th job omitted from needs ⇒ exit 1, distinct from PASS and from NOT-EVALUATED", () => {
  const r = judgeText(covered(`  newly-added-seventh-job:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`));
  assert.equal(r.status, 1, `expected 1, got ${r.status}: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout + r.stderr, /newly-added-seventh-job/);
});

test("CLI: absent needs: ⇒ exit 1 (RED), NOT exit 3 — 'no dependencies' is readable, not unreadable", () => {
  const r = judgeText(`${HEADER}jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - run: echo release
  advance-master:
    runs-on: ubuntu-latest
    steps:
      - run: echo push
`);
  assert.equal(r.status, 1, `expected 1, got ${r.status}: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout + r.stderr, /release/);
});

test("CLI: the three unreadable shapes are each NOT-EVALUATED (3) and each carries its OWN reason", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rmanc-ne-"));
  fs.mkdirSync(path.join(tmp, ".github", "workflows"), { recursive: true });
  const wf = path.join(tmp, ".github", "workflows", "release.yml");

  // (1) workflow absent
  let r = runCli(tmp);
  assert.equal(r.status, 3, `workflow absent ⇒ expected 3, got ${r.status}`);
  assert.match(r.stdout + r.stderr, /\[workflow-absent\]/);

  // (2) no top-level jobs: mapping
  fs.writeFileSync(wf, "name: Release\non: workflow_dispatch\n");
  r = runCli(tmp);
  assert.equal(r.status, 3, `no jobs block ⇒ expected 3, got ${r.status}`);
  assert.match(r.stdout + r.stderr, /\[jobs-block-unreadable\]/);

  // (3) jobs mapping present, advance-master absent
  fs.writeFileSync(wf, "jobs:\n  release:\n    runs-on: ubuntu-latest\n");
  r = runCli(tmp);
  assert.equal(r.status, 3, `no target job ⇒ expected 3, got ${r.status}`);
  assert.match(r.stdout + r.stderr, /\[target-job-absent\]/);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("CLI: a needs: value that is not a job-name list ⇒ exit 3 with its own reason (not a silent ∅)", () => {
  const r = judgeText(`jobs:
  release:
    runs-on: ubuntu-latest
  advance-master:
    needs:
      nested: {a: b}
    runs-on: ubuntu-latest
`);
  assert.equal(r.status, 3, `expected 3, got ${r.status}: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout + r.stderr, /\[target-needs-unreadable\]/);
});

// ── the SHIPPING artifact, both directions (硬规则 4: a real-file PASS alone proves nothing) ──────

test("real artifact: the repo's own release.yml passes and really contains advance-master", () => {
  assert.ok(fs.existsSync(REAL_WF), `expected the shipping workflow at ${REAL_WF}`);
  const real = fs.readFileSync(REAL_WF, "utf8");
  assert.ok(/\n\s*advance-master:/.test(real), "release.yml must carry the advance-master job (SPEC §6.1)");
  assert.equal(real.split("--force").length - 1, 0, "release.yml must contain no force flag at all");
  const r = runCli(REPO_ROOT);
  assert.equal(r.status, 0, `the shipping release.yml must pass: ${r.stdout}${r.stderr}`);
});

test("real artifact CONTROL: a verbatim copy with a 7th job appending ⇒ RED", () => {
  const real = fs.readFileSync(REAL_WF, "utf8");
  const r = judgeText(`${real}\n  a-seventh-job-nobody-added-to-needs:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`);
  assert.equal(r.status, 1, `a 7th job outside needs: must go RED on the real text, got ${r.status}: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout + r.stderr, /a-seventh-job-nobody-added-to-needs/);
});

// ── the mutation case is present (the harness's own coverage contract) ────────────────────────────

test("a mutation case exists for this checker", () => {
  assert.ok(fs.existsSync(MUTATION_CASE), `expected ${MUTATION_CASE}`);
  const sh = fs.readFileSync(MUTATION_CASE, "utf8");
  // The case must drive the REAL checker file — not re-implement the set difference in bash, which
  // would make it a test of the fixture rather than of the shipping predicate.
  assert.match(sh, /^name="release-master-advance-needs-check"$/m, "the case must name the checker it mutates");
  assert.match(sh, /checker="\$\{checker_dir\}\/\$\{name\}\.ts"/, "the case must resolve the checker's own .ts under plugin/scripts");
  assert.match(sh, /--experimental-strip-types "\$checker"/, "the case must invoke the real checker binary");
});
