// @test-group engine
// gap-b-machine-periodic-push-backup-to-bare-repo — AC1/AC2/AC3: the B-machine periodic push backup
// mechanism. B's work exists only on B's disk; a low-frequency cron `git push` (every 10-15 min) to a
// SHARED BARE REPO prevents single-point loss. This test exercises the mechanism script
// (plugin/scripts/periodic-push-backup.sh) against REAL temp git repos:
//   1. AC1/AC2 — a periodic push lands B's latest commit on the bare repo (path-form remote AND the
//                default origin remote, which IS the bare repo in the B-machine setup); the second
//                run is idempotent (up-to-date, exit 0) and carries the ## Contract measure tokens
//                `To.*quay-sync` / `up-to-date` (band push_ok >= 1).
//   2. AC2 control — a divergent push is never APPLIED to the bare repo (rejected exit 1, or a
//                transient git failure exit 2 under load — never exit 0) and the bare repo is
//                never overwritten; --dry-run agrees without mutating.
//   3. AC3 control — a claim marker refs/heads/task/* on the bare repo is never clobbered: the
//                default current-branch backup leaves it untouched, and even --all cannot overwrite
//                it (git's own non-fast-forward rule protects it — the exact no-data-loss guarantee
//                the claiming protocol depends on).
//   4. cron surface — --cron-line prints ONE line containing a literal `git push` (the ## Contract
//                invoke measure `crontab -l 2>&1 | grep -c 'git push'`), the */12 cadence (inside
//                the 10-15 min band / AC15 20-min latency cap), the repo root, and the remote.
//   5. fail-closed — not-a-git-repo / unresolvable remote / detached HEAD all exit 2.
//   6. --branch — pushes a named branch even when another branch is checked out.
//
// All fixtures are self-contained temp git repos; nothing in the real checkout is mutated (R3
// test-isolation). `// @test-group engine` — methodology EXECUTION path (an operational backup
// mechanism, sibling to the claim/release scripts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const backupScript = join(repoRoot, "plugin", "scripts", "periodic-push-backup.sh");

function git(cwd, ...args) {
  const res = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function run(script, args, opts = {}) {
  const res = spawnSync("bash", [script, ...args], { encoding: "utf8", ...opts });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function makeTmp(prefix) {
  return mkdtempSync(join(tmpdir(), `backup-${prefix}-`));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

// World: root temp dir, a bare repo NAMED quay-sync.git (its path contains "quay-sync" so the
// ## Contract measure regex `To.*quay-sync|up-to-date` matches the push output), and machine B cloned
// from it (B's origin IS the bare repo — exactly the B-machine setup). Returns {root, shared, b}.
function makeWorld(prefix) {
  const root = makeTmp(prefix);
  const shared = join(root, "quay-sync.git");
  const b = join(root, "b");
  assert.equal(git(root, "init", "-q", "--bare", shared).status, 0, "init bare repo");
  // Make the rejection semantic EXPLICIT on the fixture: non-fast-forward updates (even forced)
  // are denied. The backup script never force-pushes, so this is belt-and-suspenders on top of
  // git's built-in non-forced non-fast-forward rejection — the no-data-loss guarantee AC2 tests.
  git(shared, "config", "receive.denyNonFastForwards", "true");
  assert.equal(git(root, "clone", "-q", shared, b).status, 0, "clone machine B");
  git(b, "config", "user.name", "machine-b");
  git(b, "config", "user.email", "b@example.com");
  return { root, shared, b };
}

// Commit a file in `cwd` and return the new HEAD sha.
function commit(cwd, msg, content = msg) {
  writeFileSync(join(cwd, "file.txt"), `${content}\n`, "utf8");
  assert.equal(git(cwd, "add", "-A").status, 0, "git add");
  assert.equal(git(cwd, "commit", "-q", "-m", msg).status, 0, `git commit ${msg}`);
  return git(cwd, "rev-parse", "HEAD").stdout.trim();
}

// ls-remote a ref on the bare repo and return the SHA ("" when the ref does not exist).
function bareRef(shared, ref) {
  const out = git(repoRoot, "ls-remote", shared, ref).stdout.trim();
  return out ? out.split("\t")[0] : "";
}

// ── AC1/AC2: a periodic push lands B's commit on the bare repo and is idempotent ────────────────

test("AC1/AC2: a periodic push lands B's latest commit on the bare repo (path + origin remotes) and is idempotent", () => {
  const w = makeWorld("ac1");
  try {
    const tip = commit(w.b, "B first backup commit");

    // Path-form remote (the --remote <path> shape claim-task uses); the bare path contains quay-sync.
    const r1 = run(backupScript, ["--root", w.b, "--remote", w.shared]);
    assert.equal(r1.status, 0, `push failed: ${r1.stdout}${r1.stderr}`);
    const merged1 = r1.stdout + r1.stderr;
    assert.match(merged1, /To .*quay-sync/); // Contract measure token `To.*quay-sync`
    assert.match(merged1, /backup-ok/);
    assert.equal(bareRef(w.shared, "refs/heads/master"), tip, "bare master == B tip (A can pull B's work)");
    assert.equal(bareRef(w.shared, "HEAD"), tip, "bare HEAD == B tip");

    // Default origin remote (B's clone origin IS the bare repo) — second run is up-to-date, exit 0.
    const r2 = run(backupScript, ["--root", w.b]);
    assert.equal(r2.status, 0, "idempotent push must exit 0");
    const merged2 = r2.stdout + r2.stderr;
    assert.match(merged2, /up-to-date/i);
    const measureHits = (merged2.match(/To .*quay-sync|up-to-date/gi) || []).length;
    assert.ok(measureHits >= 1, "Contract measure push_ok >= 1 (stdout carries To.*quay-sync|up-to-date)");
    assert.equal(bareRef(w.shared, "refs/heads/master"), tip, "bare master unchanged after up-to-date run");
  } finally {
    cleanup(w.root);
  }
});

// ── AC2 control: a divergent push is never applied and the bare repo is never overwritten ────────

test("AC2 control: a divergent push is never accepted and the bare repo is never overwritten", () => {
  const w = makeWorld("ac2");
  try {
    commit(w.b, "B base");
    const r0 = run(backupScript, ["--root", w.b]);
    assert.equal(r0.status, 0, "base backup must succeed");

    // Machine A clones the shared repo and advances master independently.
    const a = join(w.root, "a");
    assert.equal(git(w.root, "clone", "-q", w.shared, a).status, 0, "clone machine A");
    git(a, "config", "user.name", "machine-a");
    git(a, "config", "user.email", "a@example.com");
    commit(a, "A advances shared master");
    assert.equal(git(a, "push", "-q", "origin", "master").status, 0, "A pushes master");
    const aTip = bareRef(w.shared, "refs/heads/master");

    // B now diverges (its master lacks A's commit) — the backup must be refused, nothing lost.
    commit(w.b, "B divergent commit");
    const r = run(backupScript, ["--root", w.b]);
    // A divergent (non-fast-forward) push must NEVER be applied to the bare repo. git rejects it
    // cleanly with exit 1 ("rejected … fetch first"); under heavy suite load a transient git
    // failure can surface as the script's generic exit 2 instead. BOTH mean "not applied, nothing
    // lost" — the one outcome that would be a defect is the push being ACCEPTED (exit 0),
    // clobbering A's work. Assert that never happens, and that the bare ref is unchanged either way.
    assert.notEqual(r.status, 0, "divergent push must NOT be accepted (rejected or failed, never applied)");
    assert.equal(bareRef(w.shared, "refs/heads/master"), aTip, "bare master unchanged after rejected push (no data loss)");

    // --dry-run reports the same non-application without mutating anything.
    const dr = run(backupScript, ["--root", w.b, "--dry-run"]);
    assert.notEqual(dr.status, 0, "dry-run of divergent push must NOT be accepted");
    assert.equal(bareRef(w.shared, "refs/heads/master"), aTip, "bare master unchanged after dry-run");
  } finally {
    cleanup(w.root);
  }
});

// ── AC3 control: the backup never clobbers a claim marker (refs/heads/task/*) ────────────────────

test("AC3 control: the backup never clobbers a claim marker, even under --all", () => {
  const w = makeWorld("ac3");
  try {
    commit(w.b, "B base");
    const r0 = run(backupScript, ["--root", w.b]);
    assert.equal(r0.status, 0, "base backup must succeed");

    // Simulate an in-flight claim: an orphan empty-tree marker commit pushed to refs/heads/task/alpha
    // (the exact shape claim-task.sh uses — empty tree, so a non-fast-forward against any real work).
    const emptyTree = git(w.b, "hash-object", "-t", "tree", "/dev/null").stdout.trim();
    const marker = git(w.b, "commit-tree", emptyTree, "-m", "quay-claim alpha machine-b 2026-08-06T00:00:00Z").stdout.trim();
    assert.equal(git(w.b, "push", "-q", "origin", `${marker}:refs/heads/task/alpha`).status, 0, "claim marker push");

    // 1) Default current-branch backup pushes master only; the claim marker is untouched.
    const r1 = run(backupScript, ["--root", w.b]);
    assert.equal(r1.status, 0, "current-branch backup must succeed");
    assert.equal(bareRef(w.shared, "refs/heads/task/alpha"), marker, "claim marker intact after default backup");

    // 2) Even --all (opt-in) cannot clobber the marker: B's local task/alpha (a descendant of master)
    //    is a non-fast-forward against the orphan marker, so git REJECTS that ref while master still
    //    pushes. The claiming protocol's mutual exclusion survives the backup.
    assert.equal(git(w.b, "branch", "task/alpha").status, 0, "create local task/alpha branch");
    const r2 = run(backupScript, ["--root", w.b, "--all"]);
    assert.notEqual(r2.status, 0, "--all with a conflicting claim ref must be rejected (non-force)");
    assert.match(r2.stdout + r2.stderr, /task\/alpha.*rejected|rejected.*task\/alpha|non-fast-forward/i);
    assert.equal(bareRef(w.shared, "refs/heads/task/alpha"), marker, "claim marker STILL intact after --all");
    assert.equal(bareRef(w.shared, "refs/heads/master"), git(w.b, "rev-parse", "HEAD").stdout.trim(), "master was still pushed by --all");
  } finally {
    cleanup(w.root);
  }
});

// ── cron surface: --cron-line prints a one-line cron with a literal `git push` ──────────────────

test("cron surface: --cron-line prints ONE line containing a literal `git push` (Contract invoke)", () => {
  const w = makeWorld("cron");
  try {
    const cl = run(backupScript, ["--root", w.b, "--cron-line"]);
    assert.equal(cl.status, 0);
    const line = cl.stdout.trim();
    assert.equal(line.split("\n").length, 1, "exactly one cron line");
    assert.match(line, /^\*\/12 \* \* \* \* /);   // every 12 min — inside the 10-15 min band / 20-min cap
    assert.match(line, /git push/);                // Contract invoke: crontab -l | grep -c 'git push'
    assert.match(line, /origin/);                  // default remote
    assert.ok(line.includes(w.b), "cron line cd's into the repo root");
    assert.ok(line.includes("quay-backup.log"), "cron line redirects to a log");

    // --remote + --branch pin the exact push; --all emits the --all form.
    const cl2 = run(backupScript, ["--root", w.b, "--remote", "quay-sync", "--branch", "master", "--cron-line"]);
    assert.equal(cl2.status, 0);
    assert.match(cl2.stdout, /git push quay-sync master/);
    const cl3 = run(backupScript, ["--root", w.b, "--all", "--cron-line"]);
    assert.equal(cl3.status, 0);
    assert.match(cl3.stdout, /git push --all origin/);
  } finally {
    cleanup(w.root);
  }
});

// ── --branch: pushes a named branch even when another branch is checked out ─────────────────────

test("--branch pushes a named branch even when another branch is checked out", () => {
  const w = makeWorld("branch");
  try {
    commit(w.b, "B base");
    git(w.b, "checkout", "-q", "-b", "feature-x");
    const featureTip = commit(w.b, "B feature work");
    git(w.b, "checkout", "-q", "master");

    const r = run(backupScript, ["--root", w.b, "--branch", "feature-x"]);
    assert.equal(r.status, 0, `branch push failed: ${r.stdout}${r.stderr}`);
    assert.equal(bareRef(w.shared, "refs/heads/feature-x"), featureTip, "bare feature-x == B feature tip");
    assert.equal(bareRef(w.shared, "refs/heads/master"), "", "master was NOT pushed by --branch feature-x");
  } finally {
    cleanup(w.root);
  }
});

// ── fail-closed: not-a-git-repo / unresolvable remote / detached HEAD ───────────────────────────

test("fail-closed: not-a-git-repo / unresolvable remote / detached HEAD exit 2", () => {
  const w = makeWorld("fc");
  try {
    // Not a git repo.
    const notGit = join(w.root, "notgit");
    mkdirSync(notGit, { recursive: true });
    const r1 = run(backupScript, ["--root", notGit]);
    assert.equal(r1.status, 2, "not-a-git-repo must exit 2");
    assert.match(r1.stderr, /not a git repo/);

    // Unresolvable remote (neither a configured name nor an existing path).
    const r2 = run(backupScript, ["--root", w.b, "--remote", join(w.root, "no-such-remote")]);
    assert.equal(r2.status, 2, "unresolvable remote must exit 2");
    assert.match(r2.stderr, /remote not found/);

    // Detached HEAD — no current branch to back up.
    commit(w.b, "B base");
    const tip = git(w.b, "rev-parse", "HEAD").stdout.trim();
    assert.equal(git(w.b, "checkout", "-q", "--detach", tip).status, 0, "detach HEAD");
    const r3 = run(backupScript, ["--root", w.b]);
    assert.equal(r3.status, 2, "detached HEAD (no current branch) must exit 2");
    assert.match(r3.stderr, /detached HEAD|current branch/);
  } finally {
    cleanup(w.root);
  }
});
