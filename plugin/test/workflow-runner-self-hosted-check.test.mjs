// @test-group engine
// workflow-runner-self-hosted-check.test.mjs — tasks/gap-metered-hosted-runner-jobs-to-self-hosted
// (goal AC-319, plugin/scripts/workflow-runner-self-hosted-check.ts).
//
// Coverage map (task ACs):
//   AC4 (the centerpiece) — the checker and the goal-layer criterion `goals/AC-319-*.md` are TWO
//        INDEPENDENT implementations of ONE predicate (the goal layer deliberately does not import
//        repo code), so they can drift. This file runs BOTH over the SAME fixture set and asserts
//        the three-valued conclusion is identical for every one of them (硬规则 5b: fixing one
//        instance is not fixing the class). The criterion is read OUT OF THE GOAL STORE, never
//        pasted into this file — a pasted copy would drift from the thing it copies.
//   AC2 — the CLI's three arms are real: an all-self-hosted tree ⇒ exit 0; a tree with one job back
//        on a metered runner ⇒ exit 1 AND the output NAMES that job (without naming the healthy
//        ones); no .github/workflows/ at all ⇒ exit 3 NOT-EVALUATED (an empty population is not a
//        pass — 硬规则 3b).
//   AC1/AC2 — the current tree's own reading: every job of every .github/workflows/*.yml in THIS
//        repo carries `self-hosted` (the invariant the static gate enforces every round).
//   The predicate's own arms are unit-tested by position on the pure exports (`judgeJob` /
//   `runnerLabels`), including the two shapes that are NOT self-hosted even though they name a
//   runner: an expression `runs-on` (decided at run time) and a missing `runs-on` (a reusable
//   workflow call, decided in another file).
//
// Every fixture is a temp root under os.tmpdir(); the production checkout is never written to.
//
// Run:
//   scripts/test.sh plugin/test/workflow-runner-self-hosted-check.test.mjs
//   node --test plugin/test/workflow-runner-self-hosted-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createGoalStore } from "../../packages/quay/src/goal-store.ts";
import { runAcceptance } from "../../packages/quay/src/gate/acceptance-runner.ts";
import {
  judgeJob,
  runnerLabels,
  judgeWorkflowRoot,
  readWorkflowFiles,
  loadYamlParser,
} from "../scripts/workflow-runner-self-hosted-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHECKER = path.join(__dirname, "..", "scripts", "workflow-runner-self-hosted-check.ts");
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const AC319 = "AC-319";
const WF_DIR = ".github/workflows";

/** One scratch root for the whole file, removed in after() (never a fixed in-tree .tmp-* path). */
const SCRATCH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "wf-runner-selfhosted-"));
after(() => {
  fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true });
});

/** The criterion EXACTLY AS THE STORE HOLDS IT — never a copy pasted into this file. */
function storedCriterion(id) {
  const store = createGoalStore(path.join(REPO_ROOT, "goals"));
  const rec = store.get(id);
  assert.ok(rec, `${id} not found in the goal store — the record was renamed or removed`);
  const criterion = rec.criterion;
  assert.equal(typeof criterion, "string", `${id}.criterion is not a string (got ${typeof criterion})`);
  assert.notEqual(criterion.trim(), "", `${id}.criterion is empty — nothing to run`);
  return criterion;
}

/** Build a fixture root. `files` maps a name under .github/workflows/ to its body; `null` means
 *  "create no .github directory at all". Returns the fixture root path. */
function buildFixture(name, files) {
  const root = path.join(SCRATCH_ROOT, name);
  fs.mkdirSync(root, { recursive: true });
  if (files === null) return root;
  const dir = path.join(root, WF_DIR);
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), body);
  return root;
}

/** Run the CHECKER as its real CLI entry point (argv + emit + exit code), rooted at `root`. */
function checkerExit(root) {
  const r = spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", root],
    { encoding: "utf8" },
  );
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Run the GOAL-LAYER criterion the way the gate does — `sh -c <criterion>` with cwd = `root`. */
function criterionExit(criterion, root) {
  const r = runAcceptance({ command: criterion, cwd: root, timeoutMs: 60000 });
  assert.equal(r.timedOut, false, `the criterion timed out in ${root}: ${r.reason}`);
  return r.code;
}

/** exit code → the three-valued token. Anything outside the sanctioned vocabulary is a defect in
 *  the fixture's own harness, not a verdict, so it is surfaced rather than folded into a bucket. */
function token(code) {
  if (code === 0) return "pass";
  if (code === 1) return "fail";
  if (code === 3) return "not-evaluated";
  assert.fail(`exit code ${code} is outside the three-valued vocabulary {0,1,3}`);
}

const SELF_HOSTED_JOB = (name) => `  ${name}:\n    runs-on: [self-hosted, tokyo-alpha]\n    steps:\n      - run: echo ok\n`;

/** The fixture set both implementations are driven over. Each entry: a name, the files, and the
 *  conclusion BOTH must reach (kept explicit so a fixture that silently stops discriminating —
 *  both sides agreeing on the WRONG value — is visible in the diff, not just "they matched"). */
const FIXTURES = [
  {
    name: "all-self-hosted",
    files: { "ci.yml": `name: ci\non: [push]\njobs:\n${SELF_HOSTED_JOB("test")}` },
    expect: "pass",
  },
  {
    name: "one-metered-job",
    files: {
      "ci.yml": `name: ci\non: [push]\njobs:\n${SELF_HOSTED_JOB("test")}  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`,
    },
    expect: "fail",
  },
  {
    name: "mapping-runs-on-with-labels",
    files: { "ci.yml": `name: ci\non: [push]\njobs:\n  test:\n    runs-on:\n      labels: [self-hosted, tokyo-alpha]\n    steps:\n      - run: echo ok\n` },
    expect: "pass",
  },
  {
    name: "expression-runs-on",
    files: { "ci.yml": `name: ci\non: [push]\njobs:\n  test:\n    runs-on: \${{ vars.RUNNER }}\n    steps:\n      - run: echo ok\n` },
    expect: "fail",
  },
  {
    name: "reusable-call-no-runs-on",
    files: { "ci.yml": `name: ci\non: [push]\njobs:\n  call:\n    uses: org/repo/.github/workflows/x.yml@v1\n` },
    expect: "fail",
  },
  {
    name: "yaml-extension-is-in-the-population",
    files: { "ci.yaml": `name: ci\non: [push]\njobs:\n${SELF_HOSTED_JOB("test")}` },
    expect: "pass",
  },
  {
    name: "one-of-two-files-is-metered",
    files: {
      "ci.yml": `name: ci\non: [push]\njobs:\n${SELF_HOSTED_JOB("test")}`,
      "release.yml": `name: release\non: [workflow_dispatch]\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n`,
    },
    expect: "fail",
  },
  { name: "no-workflows-dir", files: null, expect: "not-evaluated" },
  { name: "workflow-without-jobs", files: { "ci.yml": `name: ci\non: [push]\n` }, expect: "not-evaluated" },
  { name: "workflow-with-empty-jobs", files: { "ci.yml": `name: ci\non: [push]\njobs: {}\n` }, expect: "not-evaluated" },
  { name: "empty-file", files: { "ci.yml": "" }, expect: "not-evaluated" },
  {
    name: "unparseable-yaml",
    files: { "ci.yml": `name: ci\non: [push]\njobs:\n  test:\n   runs-on: [self-hosted\n` },
    expect: "not-evaluated",
  },
];

// ── AC4: the two implementations must not drift ────────────────────────────────────────────────────
test("AC4 — checker and the stored AC-319 criterion reach an identical three-valued conclusion on every fixture", () => {
  const criterion = storedCriterion(AC319);
  const rows = [];
  for (const fx of FIXTURES) {
    const root = buildFixture(fx.name, fx.files);
    const checkerToken = token(checkerExit(root).code);
    const criterionToken = token(criterionExit(criterion, root));
    rows.push(`${fx.name}: checker=${checkerToken} criterion=${criterionToken}`);
    assert.equal(
      checkerToken,
      criterionToken,
      `the two implementations of one predicate DISAGREE on fixture '${fx.name}' — ` +
        `checker=${checkerToken}, criterion=${criterionToken}. They are held together by this test ` +
        `(hard rule 5b): change both in the same commit. ${rows.join(" | ")}`,
    );
    // …and the agreed value must be the one the fixture was built to produce — two implementations
    // agreeing on the WRONG value is the failure mode a bare equality assert cannot see (硬规则 4).
    assert.equal(
      checkerToken,
      fx.expect,
      `both implementations agreed on '${checkerToken}' for fixture '${fx.name}', but the fixture ` +
        `was built to discriminate '${fx.expect}' — the fixture stopped discriminating`,
    );
  }
  assert.equal(rows.length, FIXTURES.length);
});

test("AC4 — the criterion is read from the goal store, and it is the python+pyyaml implementation (not a copy of the checker)", () => {
  const criterion = storedCriterion(AC319);
  // By POSITION, not by keyword (硬规则 2): the criterion must actually be a python program that
  // imports yaml — a criterion that had been rewritten as a call into this repo would make the
  // equivalence test above a tautology (one implementation compared with itself).
  assert.match(criterion, /^\s*python3\s+-/, "the criterion no longer starts a python3 program");
  assert.match(criterion, /\bimport yaml\b/, "the criterion no longer imports yaml");
  assert.doesNotMatch(
    criterion,
    /workflow-runner-self-hosted-check/,
    "the criterion now points at the repo's own checker — the two-implementation control is gone",
  );
});

// ── AC2: the CLI's three arms, by exit code AND by what the output names ───────────────────────────
test("AC2 — an all-self-hosted tree exits 0; a metered job exits 1 and the output names it", () => {
  const good = buildFixture("cli-good", { "ci.yml": `name: ci\non: [push]\njobs:\n${SELF_HOSTED_JOB("test")}` });
  const okRun = checkerExit(good);
  assert.equal(okRun.code, 0, `expected exit 0 on an all-self-hosted tree, got ${okRun.code}: ${okRun.out}`);

  const bad = buildFixture("cli-bad", {
    "ci.yml": `name: ci\non: [push]\njobs:\n${SELF_HOSTED_JOB("test")}  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`,
  });
  const badRun = checkerExit(bad);
  assert.equal(badRun.code, 1, `expected exit 1 with a metered job, got ${badRun.code}: ${badRun.out}`);
  assert.match(badRun.out, /ci\.yml:lint/, "the red did not NAME the offending job — it cannot be acted on");
  assert.doesNotMatch(
    badRun.out,
    /ci\.yml:test/,
    "the red also named the self-hosted job 'ci.yml:test' — a red that names everything is noise",
  );
});

test("AC2 — no .github/workflows/ exits 3 NOT-EVALUATED, never 0 (an empty population is not a pass)", () => {
  const root = buildFixture("cli-empty", null);
  const r = checkerExit(root);
  assert.equal(r.code, 3, `expected exit 3 with no workflow files, got ${r.code}: ${r.out}`);
  assert.match(r.out, /CAUSE=no-workflow-files/, "the NOT-EVALUATED arm must say WHY it could not look");
});

// ── the current tree's own reading (the invariant the static gate enforces every round) ───────────
test("the repository's own workflows: every job is self-hosted (AC1/AC2 — the live reading)", async () => {
  const parseYaml = await loadYamlParser();
  assert.ok(parseYaml, "the 'yaml' package is not importable — the reading below would be NOT-EVALUATED");
  const files = readWorkflowFiles(REPO_ROOT);
  assert.ok(files.length > 0, `no workflow files found under ${REPO_ROOT}/${WF_DIR}`);
  const j = judgeWorkflowRoot(REPO_ROOT, parseYaml);
  assert.equal(
    j.status,
    "pass",
    `this repo has jobs that are not statically self-hosted: ` +
      j.bad.map((b) => `${b.where} [${b.reason}]`).join("; "),
  );
  assert.ok(j.ok.length > 0, "the reading returned no jobs at all — a vacuous pass");
});

// ── the predicate's own arms, by position, on the pure exports ────────────────────────────────────
test("runnerLabels — the criterion's own three-arm normalization (string / labels mapping / list)", () => {
  assert.deepEqual(runnerLabels("ubuntu-latest"), ["ubuntu-latest"]);
  assert.deepEqual(runnerLabels(["self-hosted", "tokyo-alpha"]), ["self-hosted", "tokyo-alpha"]);
  assert.deepEqual(runnerLabels({ labels: ["self-hosted"] }), ["self-hosted"]);
  // A mapping with no `labels` key normalizes to the stringified undefined — NOT self-hosted.
  assert.deepEqual(runnerLabels({}), ["undefined"]);
  assert.deepEqual(runnerLabels(true), ["true"]);
});

test("judgeJob — only a label list CONTAINING self-hosted passes; expressions and missing runs-on do not", () => {
  assert.equal(judgeJob("w:j", { "runs-on": "ubuntu-latest" }).ok, false);
  assert.equal(judgeJob("w:j", { "runs-on": ["ubuntu-latest"] }).ok, false);
  assert.equal(judgeJob("w:j", { "runs-on": ["self-hosted", "tokyo-alpha"] }).ok, true);
  assert.equal(judgeJob("w:j", { "runs-on": { labels: ["self-hosted"] } }).ok, true);
  // An expression is not STATICALLY self-hosted even when the expression plainly yields one.
  assert.equal(judgeJob("w:j", { "runs-on": "${{ 'self-hosted' }}" }).ok, false);
  // A reusable-workflow call's runner is decided in ANOTHER file.
  assert.equal(judgeJob("w:j", { uses: "org/repo/.github/workflows/x.yml@v1" }).ok, false);
  // A malformed job (a bare scalar) carries no runs-on.
  assert.equal(judgeJob("w:j", "self-hosted").ok, false);
  // A near-miss label must not match — the judgment is on the LABEL, not a substring of the value.
  assert.equal(judgeJob("w:j", { "runs-on": "not-self-hosted-really" }).ok, false);
});
