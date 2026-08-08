// @test-group governance
// gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point — AC2/AC3/AC7: the
// two-line branch model. AC2's fork-baseline determination (independent → develop, declared
// dependency → integration) and AC3's integration→develop batch-merge (always a fast-forward) are
// the two mechanisms that structurally eliminate the red-window stop-dispatch (the reason master
// HAD to stop dispatching was that it bore BOTH the fork-baseline and the merge-point roles on one
// ref; splitting them removes the collision — SPEC §1).
//
// AC6 (gap-two-layer-loop-tick-docs-hardcode-master-not-wired-to-existing-branch-model): the CLI's
// fork-baseline stdout is REF-AWARE — the decision label is mapped onto the configured --develop/
// --integration refs, so a single-line downstream passing `--develop master --integration master`
// gets `master` (never the literal "develop"), keeping the shared tick doc's configurable fork
// baseline safe for projects that only have master. Tests at the end of this file cover that.
//
// These tests build REAL temp git repos to exercise the actual merge path:
//   1. integration→develop fast-forward — the outer verification-round batch merge; develop must
//      move to integration's tip with NO conflict (integration is always a descendant of develop).
//   2. negative control — a TRUE divergence (develop has commits integration lacks) must FAIL
//      closed (exit 1, nothing moved, needs-human), never a blind --ours/--theirs overwrite.
//   3. task→integration touch-declaration conflict exposure — a task whose `## Touches` overlaps an
//      unverified task on integration MUST fork from integration (AC2's mechanical rule), so the
//      collision is surfaced at merge time as a real conflict, not silently hidden.
//
// All fixtures are self-contained temp git repos; nothing in the real checkout is mutated
// (R3 test-isolation). `// @test-group governance` — methodology-execution surface, not product.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const batchMerge = join(repoRoot, "plugin", "scripts", "integration-batch-merge.sh");
const forkBaselineCli = join(repoRoot, "plugin", "scripts", "fork-baseline.ts");

function gitCmd(cwd, ...args) {
  const res = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function run(args, opts = {}) {
  const res = spawnSync("bash", args, { encoding: "utf8", ...opts });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function runNode(args, opts = {}) {
  const res = spawnSync("node", ["--experimental-strip-types", ...args], { encoding: "utf8", ...opts });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function makeTmp(prefix) {
  return mkdtempSync(join(tmpdir(), `branch-model-${prefix}-`));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function initGitRepo(dir, user = "branch-model-test", email = "bm@example.com") {
  gitCmd(dir, "init", "-q");
  gitCmd(dir, "config", "user.name", user);
  gitCmd(dir, "config", "user.email", email);
}

function commitAll(dir, message) {
  gitCmd(dir, "add", "-A");
  const res = gitCmd(dir, "commit", "-q", "-m", message);
  assert.equal(res.status, 0, `commit "${message}" failed: ${res.stderr}`);
}

// Write a `tasks/<id>.md` with a `## Touches` section (the minimal body fork-baseline reads).
function writeTask(dir, id, touchesLines) {
  mkdirSync(join(dir, "tasks"), { recursive: true });
  const body = `---\nid: ${id}\n---\n\n## Touches\n\n${touchesLines.map((t) => `- ${t}`).join("\n")}\n`;
  writeFileSync(join(dir, "tasks", `${id}.md`), body, "utf8");
}

// ── AC3: integration→develop batch-merge (the fast-forward path) ────────────────────────────────────

test("AC3: batch-merge fast-forwards develop to integration when integration is a descendant (integration→develop)", () => {
  const dir = makeTmp("ff");
  try {
    initGitRepo(dir);
    writeFileSync(join(dir, "base.txt"), "base\n", "utf8");
    commitAll(dir, "base");
    gitCmd(dir, "branch", "-M", "master");
    gitCmd(dir, "checkout", "-q", "-b", "develop");
    gitCmd(dir, "checkout", "-q", "-b", "integration");

    // One task merges into integration (the pending-verification merge point), develop untouched.
    gitCmd(dir, "checkout", "-q", "-b", "task/alpha");
    writeFileSync(join(dir, "alpha.txt"), "alpha\n", "utf8");
    commitAll(dir, "alpha work");
    gitCmd(dir, "checkout", "-q", "integration");
    assert.equal(gitCmd(dir, "merge", "--no-ff", "-q", "task/alpha", "-m", "Merge branch 'task/alpha'").status, 0);

    // Pre-state: integration is a descendant of develop (ff possible); measure is NOT yet 0.
    assert.equal(gitCmd(dir, "merge-base", "--is-ancestor", "develop", "integration").status, 0);
    assert.notEqual(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);

    const before = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const r = run([batchMerge, "--skip-freshness-gate", "--root", dir]);
    assert.equal(r.status, 0, `batch-merge failed: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /measure integration_ff_merges=0/);
    assert.match(r.stdout, /fast-forwarded to integration/);

    // develop now == integration tip; measure is 0; the task branch is fully absorbed.
    const after = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const integ = gitCmd(dir, "rev-parse", "integration").stdout.trim();
    assert.notEqual(after, before, "develop must move forward");
    assert.equal(after, integ, "develop must land exactly on integration's tip");
    assert.equal(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
    // invoke surface: develop..integration is now EMPTY (nothing pending).
    assert.equal(gitCmd(dir, "log", "--oneline", "develop..integration").stdout.trim(), "");
  } finally {
    cleanup(dir);
  }
});

test("AC3 negative control: a TRUE divergence (develop has commits integration lacks) FAILS closed, nothing moved", () => {
  const dir = makeTmp("diverged");
  try {
    initGitRepo(dir);
    writeFileSync(join(dir, "base.txt"), "base\n", "utf8");
    commitAll(dir, "base");
    gitCmd(dir, "branch", "-M", "master");
    gitCmd(dir, "checkout", "-q", "-b", "develop");
    gitCmd(dir, "checkout", "-q", "-b", "integration");

    // A task merges into integration.
    gitCmd(dir, "checkout", "-q", "-b", "task/alpha");
    writeFileSync(join(dir, "alpha.txt"), "alpha\n", "utf8");
    commitAll(dir, "alpha work");
    gitCmd(dir, "checkout", "-q", "integration");
    gitCmd(dir, "merge", "--no-ff", "-q", "task/alpha", "-m", "Merge branch 'task/alpha'");

    // Develop gets its own commit (TRUE divergence — violates the invariant that integration is
    // always a descendant of develop). This should never happen under the model, but the helper
    // must fail closed instead of silently overwriting develop's new commit.
    gitCmd(dir, "checkout", "-q", "develop");
    writeFileSync(join(dir, "dev-only.txt"), "dev-only\n", "utf8");
    commitAll(dir, "develop-only work");

    const before = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const r = run([batchMerge, "--skip-freshness-gate", "--root", dir]);
    assert.notEqual(r.status, 0, "a true divergence must fail closed");
    assert.match(r.stderr, /NOT-FAST-FORWARD/);
    assert.match(r.stderr, /needs a human|Needs a human/i);
    // Nothing moved.
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), before, "develop must be untouched on divergence");
    // No blind --ours/--theirs: integration's commits are NOT forced into develop.
    assert.notEqual(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
  } finally {
    cleanup(dir);
  }
});

test("AC3 --dry-run reports ff-ability and the pending surface WITHOUT moving any ref", () => {
  const dir = makeTmp("dryrun");
  try {
    initGitRepo(dir);
    writeFileSync(join(dir, "base.txt"), "base\n", "utf8");
    commitAll(dir, "base");
    gitCmd(dir, "branch", "-M", "master");
    gitCmd(dir, "checkout", "-q", "-b", "develop");
    gitCmd(dir, "checkout", "-q", "-b", "integration");
    gitCmd(dir, "checkout", "-q", "-b", "task/alpha");
    writeFileSync(join(dir, "alpha.txt"), "alpha\n", "utf8");
    commitAll(dir, "alpha work");
    gitCmd(dir, "checkout", "-q", "integration");
    gitCmd(dir, "merge", "--no-ff", "-q", "task/alpha", "-m", "Merge branch 'task/alpha'");

    const beforeDev = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const r = run([batchMerge, "--skip-freshness-gate", "--root", dir, "--dry-run"]);
    assert.equal(r.status, 0, `dry-run should succeed: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /FF-OK/);
    assert.match(r.stdout, /measure integration_ff_merges=1/, "dry-run BEFORE the merge reports measure=1 (not yet absorbed)");
    assert.match(r.stdout, /pending on integration:/);
    assert.match(r.stdout, /Merge branch 'task\/alpha'/);
    // Nothing moved.
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), beforeDev);
  } finally {
    cleanup(dir);
  }
});

// ── AC2: fork-baseline determination (independent → develop / dependency → integration) ─────────────

test("AC2: a task whose touches overlap an unverified task on integration forks from INTEGRATION", () => {
  const dir = makeTmp("overlap");
  try {
    initGitRepo(dir);
    // The unverified task on integration touches plugin/test/branch-model.test.mjs.
    writeTask(dir, "unverified-one", ["plugin/test/branch-model.test.mjs"]);
    // The candidate touches the SAME file → declared dependency → integration.
    writeTask(dir, "candidate-overlap", ["plugin/test/branch-model.test.mjs"]);

    const r = runNode([forkBaselineCli, "--root", dir, "--task", join(dir, "tasks", "candidate-overlap.md"), "--unverified", "unverified-one"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "integration", `overlapping candidate must fork from integration: ${r.stdout}`);
    assert.match(r.stderr, /overlap/);
    assert.match(r.stderr, /unverified-on-integration count = 1/);
  } finally {
    cleanup(dir);
  }
});

test("AC2: a task whose touches are disjoint from every unverified task forks from DEVELOP", () => {
  const dir = makeTmp("disjoint");
  try {
    initGitRepo(dir);
    writeTask(dir, "unverified-one", ["packages/quay/src/serve.ts"]);
    writeTask(dir, "candidate-disjoint", ["plugin/scripts/fork-baseline.ts"]);

    const r = runNode([forkBaselineCli, "--root", dir, "--task", join(dir, "tasks", "candidate-disjoint.md"), "--unverified", "unverified-one"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "develop", `disjoint candidate must fork from develop: ${r.stdout}`);
    assert.match(r.stderr, /disjoint/);
  } finally {
    cleanup(dir);
  }
});

test("AC2: git-derived unverified set — a task/<id> merged into integration (not develop) is detected via develop..integration", () => {
  const dir = makeTmp("gitderive");
  try {
    initGitRepo(dir);
    gitCmd(dir, "branch", "-M", "master");
    writeFileSync(join(dir, "base.txt"), "base\n", "utf8");
    commitAll(dir, "base");
    gitCmd(dir, "checkout", "-q", "-b", "develop");
    gitCmd(dir, "checkout", "-q", "-b", "integration");

    // A task that IS the unverified predecessor: touches the same test file.
    writeTask(dir, "unverified-one", ["plugin/test/branch-model.test.mjs"]);
    commitAll(dir, "add unverified task body");
    gitCmd(dir, "checkout", "-q", "-b", "task/unverified-one");
    writeFileSync(join(dir, "unverified.txt"), "unverified work\n", "utf8");
    commitAll(dir, "unverified work");
    gitCmd(dir, "checkout", "-q", "integration");
    gitCmd(dir, "merge", "--no-ff", "-q", "task/unverified-one", "-m", "Merge branch 'task/unverified-one'");

    // develop untouched → develop..integration contains only the unverified task's merge.
    const pending = gitCmd(dir, "log", "--format=%s", "develop..integration").stdout.trim();
    assert.match(pending, /Merge branch 'task\/unverified-one'/);

    // Candidate touches the same file → git-derived unverified set ⇒ integration.
    writeTask(dir, "candidate-overlap", ["plugin/test/branch-model.test.mjs"]);
    commitAll(dir, "add candidate body");
    const r = runNode([forkBaselineCli, "--root", dir, "--task", join(dir, "tasks", "candidate-overlap.md")]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "integration", `git-derived overlap must fork from integration: ${r.stdout}`);
    assert.match(r.stderr, /unverified-on-integration count = 1/);
  } finally {
    cleanup(dir);
  }
});

test("AC2: a candidate with NO ## Touches cannot be proven independent → conservative integration", () => {
  const dir = makeTmp("notouches");
  try {
    initGitRepo(dir);
    writeTask(dir, "unverified-one", ["plugin/test/branch-model.test.mjs"]);
    const body = "---\nid: no-touches\n---\n\nNo touches section.\n";
    writeFileSync(join(dir, "tasks", "no-touches.md"), body, "utf8");

    const r = runNode([forkBaselineCli, "--root", dir, "--task", join(dir, "tasks", "no-touches.md"), "--unverified", "unverified-one"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "integration", "no-touches candidate cannot be proven independent");
  } finally {
    cleanup(dir);
  }
});

// ── AC6 (gap-two-layer-loop-tick-docs-hardcode-master-not-wired-to-existing-branch-model): the CLI's
// fork-baseline output must be REF-AWARE. The decision LABEL is "develop"/"integration", but the stdout
// maps onto the CONFIGURED ref names — a single-line downstream that passes `--develop master
// --integration master` (no branch-model config, the shared tick doc's default) must get `master`, never
// the literal "develop". This keeps the configurable fork-baseline safe for projects that only have master.

test("AC6: single-line downstream (--develop master --integration master) gets MASTER, not develop", () => {
  const dir = makeTmp("singleline");
  try {
    initGitRepo(dir);
    writeTask(dir, "candidate", ["plugin/scripts/fork-baseline.ts"]);

    const r = runNode([forkBaselineCli, "--root", dir, "--task", join(dir, "tasks", "candidate.md"), "--develop", "master", "--integration", "master"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "master", `default single-line fork baseline must be master, got: ${r.stdout}`);
  } finally {
    cleanup(dir);
  }
});

test("AC6: default refs (no --develop/--integration) still return the two-line literals (back-compat)", () => {
  const dir = makeTmp("defaults");
  try {
    initGitRepo(dir);
    writeTask(dir, "candidate", ["plugin/scripts/fork-baseline.ts"]);

    const r = runNode([forkBaselineCli, "--root", dir, "--task", join(dir, "tasks", "candidate.md")]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "develop", "default two-line fork baseline must stay develop");
  } finally {
    cleanup(dir);
  }
});
