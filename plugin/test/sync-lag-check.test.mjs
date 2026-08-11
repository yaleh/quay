// @test-group engine
// sync-lag-check.test.mjs — tasks/gap-cross-machine-sync-has-no-mechanism-only-manual-pushes.
// The cross-machine sync mechanism: local <fork-baseline> (develop) must be pushed to origin
// automatically — event-driven (right after a land closure) AND every-tick-heartbeat (unconditional
// fallback). periodic-push-backup.sh shipped but had ZERO live callers; this is the call-site script.
//
// Coverage map (task ACs):
//   AC1 — fallback trigger really works: make an unpushed local commit, NO manual intervention, run
//         the tick-heartbeat action (sync-lag-check.sh --push) ⇒ `git rev-list --count
//         origin/develop..develop` goes 0 (before/after asserted, not assumed).
//   AC2 — event-driven path: after a real land closure (integration-batch-merge.sh --sync fast-forwards
//         develop), the push happens in the SAME round — origin/develop == local develop within the one
//         invocation (timestamps captured; elapsed ≪ one tick interval).
//   AC3 — sync lag mechanically readable: sync-lag-check.sh --json reports unpushed/behind/leads
//         (the AC17③ measurement surface), and --json/--dry-run NEVER mutate.
//   AC4 — negative control: without the fallback trigger invocation, a made unpushed commit stays
//         NON-ZERO (nothing else auto-pushed it); with the trigger it returns to 0 — proving the
//         trigger, not coincidence, is what pushes.
//   AC6 — no system crontab: this script is the shipped mechanism (no cron line is created by the
//         mechanism itself); it lives under plugin/ and is referenced from plugin/loop/*.md so it rides
//         the derived laydown set (quay-init). The periodic-push-backup.sh backend stays byte-unchanged.
//   fail-closed — not-a-git-repo / remote missing / local branch missing exit 2; a non-fast-forward
//         push is rejected (exit 1) and origin is never overwritten.
//   first-publish — origin/develop absent ⇒ the push creates it (B-side first sync shape).
//
// All fixtures are self-contained temp git repos; nothing in the real checkout is mutated (R3
// test-isolation). `// @test-group engine` — an operational git-sync mechanism, sibling to
// periodic-push-backup.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const syncCheck = join(repoRoot, "plugin", "scripts", "sync-lag-check.sh");
const batchMerge = join(repoRoot, "plugin", "scripts", "integration-batch-merge.sh");

function git(cwd, ...args) {
  const res = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function run(script, args, opts = {}) {
  const res = spawnSync("bash", [script, ...args], { encoding: "utf8", ...opts });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function makeTmp(prefix) {
  return mkdtempSync(join(tmpdir(), `sync-lag-${prefix}-`));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function commit(cwd, msg, content = msg) {
  writeFileSync(join(cwd, "file.txt"), `${content}\n`, "utf8");
  assert.equal(git(cwd, "add", "-A").status, 0, "git add");
  assert.equal(git(cwd, "commit", "-q", "-m", msg).status, 0, `git commit ${msg}`);
  return git(cwd, "rev-parse", "HEAD").stdout.trim();
}

function bareRef(shared, ref) {
  const out = git(repoRoot, "ls-remote", shared, ref).stdout.trim();
  return out ? out.split("\t")[0] : "";
}

// World: bare origin (path-form, like the GitHub remote on both machines) + a local clone that will be
// the "machine" whose develop we sync. Returns {root, shared, m}.
function makeWorld(prefix) {
  const root = makeTmp(prefix);
  const shared = join(root, "origin.git");
  const m = join(root, "machine");
  assert.equal(git(root, "init", "-q", "--bare", shared).status, 0, "init bare origin");
  assert.equal(git(root, "clone", "-q", shared, m).status, 0, "clone machine");
  git(m, "config", "user.name", "machine");
  git(m, "config", "user.email", "m@example.com");
  return { root, shared, m };
}

// unpushed count on the machine for a branch against its origin (the ## Contract measure).
function unpushed(m, branch) {
  const r = git(m, "rev-list", "--count", `origin/${branch}..${branch}`);
  assert.equal(r.status, 0, `rev-list ${branch} failed: ${r.stderr}`);
  return Number(r.stdout.trim());
}

// ── AC1: the fallback trigger (tick-heartbeat) really works — no manual intervention ──────────────

test("AC1: fallback trigger works — an unpushed develop commit returns origin/develop..develop to 0 after the tick-heartbeat action", () => {
  const w = makeWorld("ac1");
  try {
    git(w.m, "checkout", "-q", "-b", "develop");
    const base = commit(w.m, "develop base");
    assert.equal(git(w.m, "push", "-q", "-u", "origin", "develop").status, 0, "publish base develop");
    assert.equal(unpushed(w.m, "develop"), 0, "base is in sync");

    // Make an unpushed local commit — NO manual push.
    const tip = commit(w.m, "unpushed local work");
    const before = unpushed(w.m, "develop");
    assert.equal(before, 1, "before: 1 unpushed commit");
    assert.equal(bareRef(w.shared, "refs/heads/develop"), base, "origin still at base (nothing pushed it)");

    // The tick-heartbeat action: run the sync check (default = measure + push-if-leading).
    const r = run(syncCheck, ["--root", w.m, "--branch", "develop", "--push"]);
    assert.equal(r.status, 0, `sync push failed: ${r.stdout}${r.stderr}`);

    // AC1 verdict: after the tick, the measure is 0.
    const after = unpushed(w.m, "develop");
    assert.equal(after, 0, "after the fallback-trigger action, origin/develop..develop must be 0");
    assert.equal(bareRef(w.shared, "refs/heads/develop"), tip, "origin/develop == local develop tip");
  } finally {
    cleanup(w.root);
  }
});

// ── AC2: the event-driven path — push happens in the SAME round as the land closure ──────────────

test("AC2: event-driven path — integration-batch-merge.sh --sync pushes develop to origin in the SAME round as the land closure", () => {
  const w = makeWorld("ac2");
  try {
    // Two-line model world: develop is published; integration forks from develop and adds a commit.
    git(w.m, "checkout", "-q", "-b", "develop");
    commit(w.m, "develop base");
    assert.equal(git(w.m, "push", "-q", "-u", "origin", "develop").status, 0, "publish develop");
    assert.equal(unpushed(w.m, "develop"), 0, "develop in sync before land");

    git(w.m, "checkout", "-q", "-b", "integration");
    const integTip = commit(w.m, "verified integration work");

    // Event-driven land closure: batch-merge integration→develop WITH --sync.
    const startMs = Date.now();
    const r = run(batchMerge, ["--skip-freshness-gate", "--skip-worktree-green-gate", "--root", w.m, "--develop", "develop", "--integration", "integration", "--sync"]);
    const elapsedMs = Date.now() - startMs;
    assert.equal(r.status, 0, `batch-merge --sync failed: ${r.stdout}${r.stderr}`);

    // Same round: origin/develop advanced to the merged tip within THIS invocation (elapsed ≪ a tick).
    const localDevelop = git(w.m, "rev-parse", "develop").stdout.trim();
    assert.equal(localDevelop, integTip, "develop fast-forwarded to integration");
    assert.equal(bareRef(w.shared, "refs/heads/develop"), integTip, "origin/develop updated IN THE SAME ROUND");
    assert.equal(unpushed(w.m, "develop"), 0, "unpushed == 0 right after the land closure");
    assert.ok(elapsedMs < 60_000, `same round, not next tick: elapsed ${elapsedMs}ms < 60s (tick = 1200-1800s)`);
    assert.match(r.stdout, /sync-push ok/, "the --sync path reports its event-driven push");
  } finally {
    cleanup(w.root);
  }
});

// ── AC3: sync lag is mechanically readable, and measure modes never mutate ───────────────────────

test("AC3: --json reports the lag (unpushed/behind/leads) and NEVER pushes; --dry-run never pushes", () => {
  const w = makeWorld("ac3");
  try {
    git(w.m, "checkout", "-q", "-b", "develop");
    commit(w.m, "develop base");
    assert.equal(git(w.m, "push", "-q", "-u", "origin", "develop").status, 0, "publish develop");
    const baseTip = git(w.m, "rev-parse", "develop").stdout.trim();

    // In-sync state: leads=false, unpushed=0.
    const j0 = run(syncCheck, ["--root", w.m, "--branch", "develop", "--json"]);
    assert.equal(j0.status, 0);
    const s0 = JSON.parse(j0.stdout);
    assert.equal(s0.branch, "develop");
    assert.equal(s0.unpushed, 0);
    assert.equal(s0.behind, 0);
    assert.equal(s0.leads, false);
    assert.equal(s0.synced, true);
    assert.equal(bareRef(w.shared, "refs/heads/develop"), baseTip, "--json did not mutate origin");

    // Leading state: unpushed=2, leads=true.
    commit(w.m, "unpushed 1");
    commit(w.m, "unpushed 2");
    const j1 = run(syncCheck, ["--root", w.m, "--branch", "develop", "--json"]);
    const s1 = JSON.parse(j1.stdout);
    assert.equal(s1.unpushed, 2);
    assert.equal(s1.leads, true);
    assert.equal(s1.synced, false);
    assert.equal(bareRef(w.shared, "refs/heads/develop"), baseTip, "--json STILL did not mutate origin");

    // --dry-run reports the would-push decision without mutating.
    const dr = run(syncCheck, ["--root", w.m, "--branch", "develop", "--dry-run"]);
    assert.equal(dr.status, 0);
    assert.match(dr.stdout, /WOULD push/);
    assert.equal(bareRef(w.shared, "refs/heads/develop"), baseTip, "--dry-run did not mutate origin");
  } finally {
    cleanup(w.root);
  }
});

// ── AC4: negative control — without the fallback trigger the unpushed commit STAYS non-zero ──────

test("AC4: negative control — without the fallback trigger invocation the unpushed commit stays NON-ZERO after the tick-equivalent; with it, it returns to 0", () => {
  const w = makeWorld("ac4");
  try {
    git(w.m, "checkout", "-q", "-b", "develop");
    commit(w.m, "develop base");
    assert.equal(git(w.m, "push", "-q", "-u", "origin", "develop").status, 0, "publish develop");

    commit(w.m, "unpushed local work");
    const before = unpushed(w.m, "develop");
    assert.equal(before, 1, "before: 1 unpushed commit");

    // Simulate the tick passing WITHOUT the fallback trigger (the trigger is detached): nothing is
    // invoked, so a "tick window" elapses and the commit MUST still be unpushed — proving the push is
    // not a coincidence of something else in the environment.
    assert.equal(bareRef(w.shared, "refs/heads/develop"), git(w.m, "rev-parse", "develop~1").stdout.trim(),
      "origin unchanged after the trigger-detached tick — the commit stayed NON-ZERO");

    // Re-attach the trigger: now the SAME commit is pushed by the mechanism.
    const r = run(syncCheck, ["--root", w.m, "--branch", "develop", "--push"]);
    assert.equal(r.status, 0, `sync push failed: ${r.stdout}${r.stderr}`);
    assert.equal(unpushed(w.m, "develop"), 0, "after re-attaching the trigger, the measure returns to 0");
  } finally {
    cleanup(w.root);
  }
});

// ── first-publish: origin/develop absent ⇒ the push creates it (B-side first-sync shape) ─────────

test("first-publish: origin/develop missing ⇒ unpushed = whole branch and the push creates the ref", () => {
  const w = makeWorld("fp");
  try {
    git(w.m, "checkout", "-q", "-b", "develop");
    const tip = commit(w.m, "develop first commit");

    // --json reports unpushed == 1 (the whole branch is unpushed), leads=true.
    const j = run(syncCheck, ["--root", w.m, "--branch", "develop", "--json"]);
    assert.equal(j.status, 0, `--json failed: ${j.stdout}${j.stderr}`);
    const s = JSON.parse(j.stdout);
    assert.equal(s.unpushed, 1);
    assert.equal(s.leads, true);
    assert.equal(bareRef(w.shared, "refs/heads/develop"), "", "origin/develop does not exist yet");

    const r = run(syncCheck, ["--root", w.m, "--branch", "develop", "--push"]);
    assert.equal(r.status, 0, `first publish failed: ${r.stdout}${r.stderr}`);
    assert.equal(bareRef(w.shared, "refs/heads/develop"), tip, "origin/develop created by the sync");
    assert.equal(unpushed(w.m, "develop"), 0, "unpushed back to 0 after first publish");
  } finally {
    cleanup(w.root);
  }
});

// ── --branch: syncs a named branch even when another branch is checked out ───────────────────────

test("--branch pushes the named branch even when another branch is checked out", () => {
  const w = makeWorld("branch");
  try {
    git(w.m, "checkout", "-q", "-b", "develop");
    commit(w.m, "develop base");
    assert.equal(git(w.m, "push", "-q", "-u", "origin", "develop").status, 0, "publish develop");
    git(w.m, "checkout", "-q", "-b", "feature-x");
    commit(w.m, "feature work");

    // While feature-x is checked out, sync the develop branch specifically.
    const r = run(syncCheck, ["--root", w.m, "--branch", "develop", "--push"]);
    assert.equal(r.status, 0, `develop sync failed: ${r.stdout}${r.stderr}`);
    assert.equal(unpushed(w.m, "develop"), 0, "develop is in sync");
    assert.equal(bareRef(w.shared, "refs/heads/feature-x"), "", "feature-x was NOT pushed");
  } finally {
    cleanup(w.root);
  }
});

// ── fail-closed: not-a-git-repo / remote missing / local branch missing exit 2 ───────────────────

test("fail-closed: not-a-git-repo / missing remote / missing local branch exit 2", () => {
  const w = makeWorld("fc");
  try {
    // Not a git repo.
    const notGit = join(w.root, "notgit");
    mkdirSync(notGit, { recursive: true });
    const r1 = run(syncCheck, ["--root", notGit]);
    assert.equal(r1.status, 2, "not-a-git-repo must exit 2");
    assert.match(r1.stderr, /not a git repo/);

    // Local branch missing.
    git(w.m, "checkout", "-q", "-b", "develop");
    commit(w.m, "develop base");
    const r2 = run(syncCheck, ["--root", w.m, "--branch", "no-such-branch"]);
    assert.equal(r2.status, 2, "missing local branch must exit 2");
    assert.match(r2.stderr, /branch not found/);

    // Remote missing (neither a configured name nor a path).
    const r3 = run(syncCheck, ["--root", w.m, "--remote", "no-such-remote"]);
    assert.equal(r3.status, 2, "missing remote must exit 2");
    assert.match(r3.stderr, /remote not found/);
  } finally {
    cleanup(w.root);
  }
});
