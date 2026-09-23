// @test-group engine
// CHARACTERIZATION test for the integration→develop batch-merge helper
// (tasks/gap-arch-tsify-integration-batch-merge-sh, SPEC-architecture-consolidation §5 Phase 5.2).
//
// WHY THIS FILE EXISTS (and why it is separate from integration-batch-merge.test.mjs):
//   `plugin/test/integration-batch-merge.test.mjs` pins the FEATURE surface (each gate's semantics,
//   ~30 tests, one behavior each). This file pins the OBSERVABLE BEHAVIOUR CONTRACT of the entry
//   script as a whole — a small, fixed set of INPUT CLASSES (normal batch merge / real conflict /
//   empty batch / missing parameters) reduced to an implementation-independent FINGERPRINT, so the
//   SAME fixture set can be run against the OLD bash implementation and the NEW TS implementation
//   and the two fingerprints compared line by line. That comparison is what makes "等价" checkable
//   instead of asserted.
//
// WHY THE FINGERPRINT IS IMPLEMENTATION-INDEPENDENT:
//   `captureFingerprint(impl, scenario)` takes the implementation path as a PARAMETER
//   (env `IBM_IMPL`, default `plugin/scripts/integration-batch-merge.sh`) and never records the
//   implementation's own path, argv[0], or any host-specific string. Every recorded field is one of
//   {exit status, named stdout/stderr verdict tokens, resulting git state}. So:
//     * run against the OLD bash  → the characterization baseline (SPEC §5 "characterization 先于改写");
//     * run against the thin wrapper → the TS  → a byte-identical fingerprint is the equivalence proof.
//
// FALSIFIABILITY (AC1): the assertions are exact-value, not shape matches. Injecting a single
// behaviour change into the implementation (e.g. flipping a fail-closed exit code) reddens the
// corresponding scenario; reverting it greens the file again. Evidence of both runs is recorded in
// the task body's notes.
//
// TEST ISOLATION: every fixture is a self-contained temp git repo under the OS temp dir; the real
// checkout is never mutated. `// @test-group engine` (methodology-execution surface, matching the
// sibling integration-batch-merge.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

/** The implementation under test. Default: the canonical entry (the `.sh` path is the written-down
 *  interface every caller and doc uses — after the TS rewrite it is a thin wrapper over the `.ts`,
 *  so the DEFAULT run exercises the new implementation). Point it at the old bash to re-take the
 *  characterization baseline. */
const IMPL = process.env.IBM_IMPL
  ? (isAbsolute(process.env.IBM_IMPL) ? process.env.IBM_IMPL : join(repoRoot, process.env.IBM_IMPL))
  : join(repoRoot, "plugin", "scripts", "integration-batch-merge.sh");

/** Run the implementation with the given argv. `.sh` → `bash <path>`; anything else → node's TS
 *  loader. Both forms are the real invocation surfaces, so the fingerprint covers the wrapper/lane
 *  the callers actually use. */
function runImpl(args, opts = {}) {
  const argv = IMPL.endsWith(".sh")
    ? ["bash", [IMPL, ...args]]
    : ["node", ["--no-warnings", "--experimental-strip-types", IMPL, ...args]];
  const res = spawnSync(argv[0], argv[1], { encoding: "utf8", ...opts });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function gitCmd(cwd, ...args) {
  const res = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function makeTmp(prefix) {
  return mkdtempSync(join(tmpdir(), `ibmc-${prefix}-`));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function initGitRepo(dir) {
  gitCmd(dir, "init", "-q");
  gitCmd(dir, "config", "user.name", "ibmc-test");
  gitCmd(dir, "config", "user.email", "ibmc@example.com");
}

function commitAll(dir, message) {
  gitCmd(dir, "add", "-A");
  const res = gitCmd(dir, "commit", "-q", "-m", message);
  assert.equal(res.status, 0, `commit "${message}" failed: ${res.stderr}`);
}

function commitAt(dir, message, epochSec) {
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: new Date(epochSec * 1000).toISOString(),
    GIT_COMMITTER_DATE: new Date(epochSec * 1000).toISOString(),
  };
  gitCmd(dir, "add", "-A");
  const res = spawnSync("git", ["-C", dir, "commit", "-q", "-m", message], { encoding: "utf8", env });
  assert.equal(res.status, 0, `commit "${message}" failed: ${res.stderr}`);
}

/** A fresh MAIN-sourced green + a worktree+green round, i.e. the normal shape in which the
 *  freshness gate and the worktree-green gate PASS and the batch merge may proceed. Scenarios that
 *  are not about those gates must supply this, otherwise a gate block — not the behaviour under
 *  characterization — is what the fingerprint records. */
function writePassingGateState(dir, { verifiedCommit } = {}) {
  const now = Math.floor(Date.now() / 1000);
  mkdirSync(join(dir, ".quay"), { recursive: true });
  const state = {
    state: "green",
    scope: "main",
    runner: "outer",
    startedAt: new Date((now - 120) * 1000).toISOString(),
    finishedAt: now - 30,
    durationMs: 1000,
    laneCount: 8,
  };
  if (verifiedCommit !== undefined) state.verifiedCommit = verifiedCommit;
  writeFileSync(join(dir, ".quay", "full-suite-state.json"), JSON.stringify(state), "utf8");
  appendFileSync(
    join(dir, ".quay", "verification-round.jsonl"),
    JSON.stringify({ round: 1, state: "green", scope: "worktree", startedAt: state.startedAt, tests: 3000 }) + "\n",
    "utf8",
  );
}

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────

/** INPUT CLASS 1 — NORMAL BATCH MERGE (fast-forward): develop is an ancestor of integration, the
 *  gates pass, the ref-level CAS fast-forward advances develop to integration. */
function ffRepo(prefix) {
  const dir = makeTmp(prefix);
  initGitRepo(dir);
  mkdirSync(join(dir, "orchestration"), { recursive: true });
  writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick base\n", "utf8");
  commitAll(dir, "base");
  gitCmd(dir, "branch", "-M", "master");
  gitCmd(dir, "checkout", "-q", "-b", "develop");
  gitCmd(dir, "checkout", "-q", "-b", "integration");
  writeFileSync(join(dir, "int-only.txt"), "int only\n", "utf8");
  commitAt(dir, "integration fan-in", Math.floor(Date.now() / 1000) - 600);
  gitCmd(dir, "checkout", "-q", "develop");
  writePassingGateState(dir);
  return dir;
}

/** INPUT CLASS 2 — REAL CONFLICT: develop and integration both modified a non-shared CODE file
 *  (`code.json` — deliberately not one of the object gate's .ts/.js/.mjs/.sh extensions, so the
 *  object gate passes and the real-merge code-conflict backstop is what blocks). */
function conflictRepo(prefix) {
  const dir = makeTmp(prefix);
  initGitRepo(dir);
  mkdirSync(join(dir, "orchestration"), { recursive: true });
  mkdirSync(join(dir, "tasks"), { recursive: true });
  writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick line 1\n", "utf8");
  writeFileSync(join(dir, "tasks", "one.md"), "task 1\n", "utf8");
  writeFileSync(join(dir, "code.json"), "v1\n", "utf8");
  commitAll(dir, "base");
  gitCmd(dir, "branch", "-M", "master");
  gitCmd(dir, "checkout", "-q", "-b", "develop");
  gitCmd(dir, "checkout", "-q", "-b", "integration");
  gitCmd(dir, "checkout", "-q", "develop");
  writeFileSync(join(dir, "code.json"), "dev v2\n", "utf8");
  writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick dev\n", "utf8");
  commitAll(dir, "develop direct commit");
  gitCmd(dir, "checkout", "-q", "integration");
  writeFileSync(join(dir, "code.json"), "int v2\n", "utf8");
  writeFileSync(join(dir, "tasks", "one.md"), "task int\n", "utf8");
  commitAll(dir, "integration task merge");
  return dir;
}

/** INPUT CLASS 3 — EMPTY BATCH: integration is already an ancestor of develop (nothing pending). */
function absorbedRepo(prefix) {
  const dir = makeTmp(prefix);
  initGitRepo(dir);
  writeFileSync(join(dir, "f.txt"), "base\n", "utf8");
  commitAll(dir, "base");
  gitCmd(dir, "branch", "-M", "master");
  gitCmd(dir, "checkout", "-q", "-b", "develop");
  gitCmd(dir, "checkout", "-q", "-b", "integration");
  writeFileSync(join(dir, "g.txt"), "task work\n", "utf8");
  commitAll(dir, "task work");
  gitCmd(dir, "checkout", "-q", "develop");
  assert.equal(gitCmd(dir, "merge", "-q", "--no-ff", "integration", "-m", "Merge integration").status, 0);
  return dir;
}

/** INPUT CLASS 4 — MISSING PARAMETERS: a repo with no develop/integration branches at all, so the
 *  ref checks (the documented exit-2 "missing ref" surface) are what fire. */
function bareRepo(prefix) {
  const dir = makeTmp(prefix);
  initGitRepo(dir);
  writeFileSync(join(dir, "f.txt"), "base\n", "utf8");
  commitAll(dir, "base");
  return dir;
}

// ── fingerprint ─────────────────────────────────────────────────────────────────────────────────

/** Reduce one run to implementation-independent observables. NO implementation path, no argv[0],
 *  no timing, no temp-directory name — only {exit status, named verdict tokens, resulting git ref
 *  state}, so the same object can be produced by two different implementations and compared. */
function fingerprint({ r, dir, beforeDevelop, integrationTip, extra = {} }) {
  const tok = (s, re) => {
    const m = re.exec(s);
    return m ? m[1] : null;
  };
  return {
    exit: r.status,
    // exit-code CLASS (0 = proceeded, 1 = fail-closed, 2 = usage/ref error) — the AC2 axis.
    stdoutTokens: {
      divergence: /DIVERGENCE/.test(r.stdout),
      veredictOk: /OK — /.test(r.stdout),
      measure: tok(r.stdout, /measure integration_ff_merges=(\d)/),
      unmergedDevelopFiles: tok(r.stdout, /measure unmerged_develop_files=(\d+)/),
      freshnessUnknown: /measure suite_freshness=unknown/.test(r.stdout),
    },
    stderrTokens: {
      notFastForward: /NOT-FAST-FORWARD/.test(r.stderr),
      needsHuman: /needs a human/i.test(r.stderr),
      realMergeFailClosed: /REAL-MERGE FAIL-CLOSED/.test(r.stderr),
      codeConflictListed: /code conflict files:/.test(r.stderr),
      notAGitRepo: /not a git repo/.test(r.stderr),
      missingRef: /ref not found/.test(r.stderr),
      fanInRequiresRunId: /--fan-in requires --run-id/.test(r.stderr),
      usagePrintHeader: /^integration-batch-merge\.sh — /.test(r.stderr),
    },
    gitAfter: {
      developSha: gitCmd(dir, "rev-parse", "develop").stdout.trim(),
      developMoved: gitCmd(dir, "rev-parse", "develop").stdout.trim() !== beforeDevelop,
      integrationAbsorbed:
        integrationTip === null
          ? null
          : gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status === 0,
      integrationTip: integrationTip,
      // No temp worktree may survive the run (the throwaway real-merge worktree).
      tempWorktreeLeak: /integration-batch-merge\./.test(gitCmd(dir, "worktree", "list").stdout),
      gitStatusPorcelain: gitCmd(dir, "status", "--porcelain").stdout,
    },
    ...extra,
  };
}

/** Scenario 1 — normal fast-forward batch merge (gates pass). */
export function captureNormalFf() {
  const dir = ffRepo("norm");
  try {
    const beforeDevelop = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const integrationTip = gitCmd(dir, "rev-parse", "integration").stdout.trim();
    const r = runImpl(["--root", dir]);
    return fingerprint({ r, dir, beforeDevelop, integrationTip });
  } finally { cleanup(dir); }
}

/** Scenario 2 — a REAL code conflict, `--merge` (fail-closed). Gates skipped so THAT gate is not
 *  the blocker: `--skip-freshness-gate --skip-worktree-green-gate` are the script's own explicit
 *  isolation opt-outs (the sibling test file uses the same two flags for the same reason). */
export function captureRealConflict() {
  const dir = conflictRepo("conf");
  try {
    const beforeDevelop = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const integrationTip = gitCmd(dir, "rev-parse", "integration").stdout.trim();
    const r = runImpl(["--root", dir, "--merge", "--skip-freshness-gate", "--skip-worktree-green-gate"]);
    return fingerprint({ r, dir, beforeDevelop, integrationTip });
  } finally { cleanup(dir); }
}

/** Scenario 2b — the same divergence WITHOUT `--merge` (the documented NOT-FAST-FORWARD exit 1). */
export function captureNotFastForwardNoMerge() {
  const dir = conflictRepo("notff");
  try {
    const beforeDevelop = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const integrationTip = gitCmd(dir, "rev-parse", "integration").stdout.trim();
    const r = runImpl(["--root", dir, "--skip-freshness-gate", "--skip-worktree-green-gate"]);
    return fingerprint({ r, dir, beforeDevelop, integrationTip });
  } finally { cleanup(dir); }
}

/** Scenario 3 — empty batch: integration already absorbed (clean no-op, measure 0). */
export function captureEmptyBatch() {
  const dir = absorbedRepo("empty");
  try {
    const beforeDevelop = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const integrationTip = gitCmd(dir, "rev-parse", "integration").stdout.trim();
    const r = runImpl(["--root", dir, "--merge", "--skip-freshness-gate", "--skip-worktree-green-gate"]);
    return fingerprint({ r, dir, beforeDevelop, integrationTip });
  } finally { cleanup(dir); }
}

/** Scenario 4 — MISSING PARAMETERS. Three shapes of "the invocation itself is wrong", each its own
 *  documented exit-2 surface. These are pure argv errors: no fixture state is involved, so the git
 *  fields are `null` and the fingerprint is about the exit code + the named stderr token only. */
export function captureMissingParams() {
  const dir = bareRepo("args");
  try {
    const nullGit = {
      developSha: null, developMoved: null, integrationAbsorbed: null, integrationTip: null,
      tempWorktreeLeak: null, gitStatusPorcelain: null,
    };
    const fp = (r) => ({
      exit: r.status,
      stdoutTokens: {
        divergence: /DIVERGENCE/.test(r.stdout),
        veredictOk: /OK — /.test(r.stdout),
        measure: (/measure integration_ff_merges=(\d)/.exec(r.stdout) ?? [])[1] ?? null,
        unmergedDevelopFiles: (/measure unmerged_develop_files=(\d+)/.exec(r.stdout) ?? [])[1] ?? null,
        freshnessUnknown: /measure suite_freshness=unknown/.test(r.stdout),
      },
      stderrTokens: {
        notFastForward: /NOT-FAST-FORWARD/.test(r.stderr),
        needsHuman: /needs a human/i.test(r.stderr),
        realMergeFailClosed: /REAL-MERGE FAIL-CLOSED/.test(r.stderr),
        codeConflictListed: /code conflict files:/.test(r.stderr),
        notAGitRepo: /not a git repo/.test(r.stderr),
        missingRef: /ref not found/.test(r.stderr),
        fanInRequiresRunId: /--fan-in requires --run-id/.test(r.stderr),
        usagePrintHeader: /^integration-batch-merge\.sh — /.test(r.stderr),
      },
      gitAfter: nullGit,
    });
    return {
      // (a) --fan-in without --run-id ⇒ exit 2 (the runId is REQUIRED by the fan-in mode).
      fanInNoRunId: fp(runImpl(["--fan-in", "gap-does-not-exist", "--root", dir])),
      // (b) an unknown flag ⇒ usage to stderr, exit 2.
      unknownFlag: fp(runImpl(["--root", dir, "--no-such-flag"])),
      // (c) a root that is not a git repo ⇒ exit 2 "not a git repo".
      notAGitRepo: fp(runImpl(["--root", tmpdir()])),
      // (d) a real repo whose develop/integration refs are absent ⇒ exit 2 "ref not found".
      missingRefs: fp(runImpl(["--root", dir, "--skip-freshness-gate", "--skip-worktree-green-gate"])),
    };
  } finally { cleanup(dir); }
}

// ── the characterization assertions ─────────────────────────────────────────────────────────────
//
// The expected objects below are the BASELINE taken from the unmodified bash implementation and are
// not derived from either implementation's source. Every field is an exact value (no shape-only
// matches) so a single injected behaviour change reddens the scenario.

export const EXPECTED = {
  normalFf: {
    exit: 0,
    stdoutTokens: { divergence: false, veredictOk: true, measure: "0", unmergedDevelopFiles: "0", freshnessUnknown: false },
    stderrTokens: {
      notFastForward: false, needsHuman: false, realMergeFailClosed: false, codeConflictListed: false,
      notAGitRepo: false, missingRef: false, fanInRequiresRunId: false, usagePrintHeader: false,
    },
  },
  realConflict: {
    exit: 1,
    stdoutTokens: { divergence: true, veredictOk: false, measure: null, unmergedDevelopFiles: "0", freshnessUnknown: false },
    stderrTokens: {
      notFastForward: false, needsHuman: false, realMergeFailClosed: true, codeConflictListed: true,
      notAGitRepo: false, missingRef: false, fanInRequiresRunId: false, usagePrintHeader: false,
    },
  },
  notFastForwardNoMerge: {
    exit: 1,
    stdoutTokens: { divergence: true, veredictOk: false, measure: null, unmergedDevelopFiles: "0", freshnessUnknown: false },
    stderrTokens: {
      notFastForward: true, needsHuman: true, realMergeFailClosed: false, codeConflictListed: false,
      notAGitRepo: false, missingRef: false, fanInRequiresRunId: false, usagePrintHeader: false,
    },
  },
  emptyBatch: {
    exit: 0,
    stdoutTokens: { divergence: false, veredictOk: true, measure: "0", unmergedDevelopFiles: null, freshnessUnknown: false },
    stderrTokens: {
      notFastForward: false, needsHuman: false, realMergeFailClosed: false, codeConflictListed: false,
      notAGitRepo: false, missingRef: false, fanInRequiresRunId: false, usagePrintHeader: false,
    },
  },
  missingParams: {
    fanInNoRunId: { exit: 2, stderr: { fanInRequiresRunId: true } },
    unknownFlag: { exit: 2, stderr: { usagePrintHeader: true } },
    notAGitRepo: { exit: 2, stderr: { notAGitRepo: true } },
    missingRefs: { exit: 2, stderr: { missingRef: true } },
  },
};

/** Compare only the axes a scenario declares — so this helper serves both the per-scenario tests
 *  and the old-vs-new equivalence driver (`.quay/ac312-equivalence.mjs`) verbatim. */
export function assertMatchesExpected(actual, expected, label) {
  for (const [k, v] of Object.entries(expected)) {
    if (k === "stdoutTokens" || k === "stderrTokens") {
      for (const [tk, tv] of Object.entries(v)) {
        assert.equal(actual[k][tk], tv, `${label}: ${k}.${tk}`);
      }
    } else if (k === "stderr") {
      for (const [tk, tv] of Object.entries(v)) {
        assert.equal(actual.stderrTokens[tk], tv, `${label}: stderrTokens.${tk}`);
      }
    } else {
      assert.equal(actual[k], v, `${label}: ${k}`);
    }
  }
  // Structural invariant: a scenario that recorded git state must have recorded the temp-worktree
  // leak reading (the argv-error scenarios record no git state at all — `gitAfter.tempWorktreeLeak`
  // is null there). Guards against a fingerprint silently losing an axis.
  if (actual.gitAfter && actual.gitAfter.tempWorktreeLeak !== null) {
    assert.equal(typeof actual.gitAfter.tempWorktreeLeak, "boolean", `${label}: fingerprint shape`);
  }
}

test("CHARACTERIZATION (input class 1: normal batch merge / fast-forward) — exit 0, develop advances to integration", () => {
  const fp = captureNormalFf();
  assertMatchesExpected(fp, EXPECTED.normalFf, "normal-ff");
  // The ref outcome: develop fast-forwarded TO integration, integration absorbed.
  assert.equal(fp.gitAfter.integrationAbsorbed, true, "integration must be absorbed by the FF");
  assert.equal(fp.gitAfter.developSha, fp.gitAfter.integrationTip, "develop == integration tip after the FF");
  assert.equal(fp.gitAfter.developMoved, true, "develop must move");
  assert.equal(fp.gitAfter.tempWorktreeLeak, false, "no temp worktree may leak");
});

test("CHARACTERIZATION (input class 2: real conflict / --merge fail-closed) — exit 1, nothing moved", () => {
  const fp = captureRealConflict();
  assertMatchesExpected(fp, EXPECTED.realConflict, "real-conflict");
  assert.equal(fp.gitAfter.developMoved, false, "a fail-closed merge must not move develop");
  assert.equal(fp.gitAfter.integrationAbsorbed, false, "integration must NOT be absorbed");
  assert.equal(fp.gitAfter.tempWorktreeLeak, false, "no temp worktree may leak after fail-closed");
});

test("CHARACTERIZATION (input class 2b: true divergence without --merge) — exit 1, NOT-FAST-FORWARD, nothing moved", () => {
  const fp = captureNotFastForwardNoMerge();
  assertMatchesExpected(fp, EXPECTED.notFastForwardNoMerge, "not-ff-no-merge");
  assert.equal(fp.gitAfter.developMoved, false);
  assert.equal(fp.gitAfter.integrationAbsorbed, false);
});

test("CHARACTERIZATION (input class 3: empty batch / already absorbed) — exit 0 no-op, measure 0, nothing moved", () => {
  const fp = captureEmptyBatch();
  assertMatchesExpected(fp, EXPECTED.emptyBatch, "empty-batch");
  assert.equal(fp.gitAfter.developMoved, false, "an absorbed integration is a no-op");
  assert.equal(fp.gitAfter.integrationAbsorbed, true);
});

test("CHARACTERIZATION (input class 4: missing parameters) — the four documented exit-2 surfaces", () => {
  const got = captureMissingParams();
  assertMatchesExpected(got.fanInNoRunId, EXPECTED.missingParams.fanInNoRunId, "fan-in-no-run-id");
  assertMatchesExpected(got.unknownFlag, EXPECTED.missingParams.unknownFlag, "unknown-flag");
  assertMatchesExpected(got.notAGitRepo, EXPECTED.missingParams.notAGitRepo, "not-a-git-repo");
  assertMatchesExpected(got.missingRefs, EXPECTED.missingParams.missingRefs, "missing-refs");
  // Every one of them is a usage/ref error, never a merge verdict.
  for (const [k, v] of Object.entries(got)) assert.equal(v.exit, 2, `${k} must exit 2`);
});
