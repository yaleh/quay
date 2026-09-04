// @test-group engine
// gap-two-machine-collaboration-git-branch-claiming — AC1/AC2/AC4: the two-machine git-branch
// claiming protocol. Two machines (A and B) execute tasks against a SHARED BARE REPO; the claim
// marker is an empty `task/<id>` branch pushed to the shared repo, and the branch's existence IS the
// distributed mutual exclusion (git is the only truly cross-host state store — telemetry inProgress
// files and worktree dirs are local).
//
// These tests build REAL temp git repos (a shared bare repo + two clones playing machines A and B)
// to exercise the actual push/delete race:
//   1. AC1 — pushing the empty task/<id> branch claims the task; a branch that already exists is
//            already-claimed; release (delete) makes it claimable again.
//   2. AC2 — claim-time checkTouchesPair: a candidate whose ## Touches overlap an in-flight peer is
//            REFUSED (--check-touches), a disjoint one succeeds.
//   3. AC4 — two machines claim DISJOINT tasks → both succeed; the SAME task claimed by both → only
//            the first wins (negative control).
//   4. stale-claim recovery — --reclaim refuses a FRESH claim and takes over a STALE one (guarded
//      by --force-with-lease CAS).
//
// All fixtures are self-contained temp git repos; nothing in the real checkout is mutated (R3
// test-isolation). `// @test-group engine` — methodology EXECUTION path (the claim is a dispatch
// mechanism, not product code).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const claimTask = join(repoRoot, "plugin", "scripts", "claim-task.sh");
const releaseTask = join(repoRoot, "plugin", "scripts", "release-task.sh");

function git(cwd, ...args) {
  const res = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function run(script, args, opts = {}) {
  const res = spawnSync("bash", [script, ...args], { encoding: "utf8", ...opts });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function makeTmp(prefix) {
  return mkdtempSync(join(tmpdir(), `claim-task-${prefix}-`));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

// Write a `tasks/<id>.md` with a `## Touches` section (the minimal body claim-task reads).
function writeTask(dir, id, touchesLines) {
  mkdirSync(join(dir, "tasks"), { recursive: true });
  const body = `---\nid: ${id}\nstatus: ready\n---\n\n## Touches\n\n${touchesLines.map((t) => `- ${t}`).join("\n")}\n`;
  writeFileSync(join(dir, "tasks", `${id}.md`), body, "utf8");
}

// Build a world: shared bare repo + machine A (clone). Seed A's task board, push to the shared repo,
// then clone machine B (which therefore already has the seeded task files). Returns {root, shared, a, b}.
function makeWorld(prefix) {
  const root = makeTmp(prefix);
  const shared = join(root, "shared.git");
  const a = join(root, "a");
  assert.equal(git(root, "init", "-q", "--bare", shared).status, 0);
  assert.equal(git(root, "clone", "-q", shared, a).status, 0);
  for (const m of [a]) {
    git(m, "config", "user.name", "machine-a");
    git(m, "config", "user.email", "a@example.com");
  }
  return { root, shared, a, b: null };
}

function seedAndCloneB(w, tasks) {
  for (const [id, touches] of Object.entries(tasks)) writeTask(w.a, id, touches);
  assert.equal(git(w.a, "add", "-A").status, 0);
  assert.equal(git(w.a, "commit", "-q", "-m", "seed tasks").status, 0, "seed commit must succeed");
  assert.equal(git(w.a, "push", "-q", "origin", "HEAD:master").status, 0, "seed push must succeed");
  w.b = join(w.root, "b");
  assert.equal(git(w.root, "clone", "-q", w.shared, w.b).status, 0);
  git(w.b, "config", "user.name", "machine-b");
  git(w.b, "config", "user.email", "b@example.com");
}

// ── AC1: claim / already-claimed / release ──────────────────────────────────────────────────────────

test("AC1: pushing the empty task/<id> branch claims the task; an existing branch is already-claimed; release frees it", () => {
  const w = makeWorld("ac1");
  try {
    seedAndCloneB(w, { alpha: ["plugin/scripts/claim-task.ts"] });

    // A claims alpha — the empty marker branch appears on the shared repo.
    const c1 = run(claimTask, ["alpha", "--root", w.a, "--remote", w.shared]);
    assert.equal(c1.status, 0, `claim failed: ${c1.stdout}${c1.stderr}`);
    assert.match(c1.stdout, /claimed/);
    assert.match(git(w.a, "ls-remote", "--heads", w.shared, "refs/heads/task/alpha").stdout, /refs\/heads\/task\/alpha/);

    // The same task claimed from B → already-claimed (the marker exists cross-host).
    const c2 = run(claimTask, ["alpha", "--root", w.b, "--remote", w.shared]);
    assert.notEqual(c2.status, 0, "a second claim of the same task must fail");
    assert.match(c2.stdout, /already-claimed/);

    // A release deletes the marker; the task becomes claimable again.
    const r = run(releaseTask, ["alpha", "--root", w.a, "--remote", w.shared]);
    assert.equal(r.status, 0, `release failed: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /released/);
    assert.equal(git(w.a, "ls-remote", "--heads", w.shared, "refs/heads/task/alpha").stdout.trim(), "");

    // Re-claim after release succeeds (round-trip complete).
    const c3 = run(claimTask, ["alpha", "--root", w.b, "--remote", w.shared]);
    assert.equal(c3.status, 0, `re-claim failed: ${c3.stdout}${c3.stderr}`);
    assert.match(c3.stdout, /claimed/);
  } finally {
    cleanup(w.root);
  }
});

// ── AC2: claim-time checkTouchesPair ────────────────────────────────────────────────────────────────

test("AC2: --check-touches refuses a candidate whose ## Touches overlap an in-flight peer; disjoint passes", () => {
  const w = makeWorld("ac2");
  try {
    seedAndCloneB(w, {
      alpha: ["plugin/scripts/claim-task.ts"],
      beta_overlap: ["plugin/scripts/claim-task.ts"],
      gamma_disjoint: ["plugin/test/claim-task.test.mjs"],
    });

    // A claims alpha.
    assert.equal(run(claimTask, ["alpha", "--root", w.a, "--remote", w.shared]).status, 0);

    // B tries beta_overlap (declares the SAME file) with --check-touches → refused, names the overlap.
    const c = run(claimTask, ["beta_overlap", "--root", w.b, "--remote", w.shared, "--check-touches"]);
    assert.notEqual(c.status, 0, "an overlapping claim must be refused");
    assert.match(c.stdout, /touches-overlap/);
    assert.match(c.stdout, /in-flight task alpha/);

    // B claims gamma_disjoint (disjoint from alpha) → succeeds.
    const c2 = run(claimTask, ["gamma_disjoint", "--root", w.b, "--remote", w.shared, "--check-touches"]);
    assert.equal(c2.status, 0, `disjoint claim failed: ${c2.stdout}${c2.stderr}`);
    assert.match(c2.stdout, /claimed/);
  } finally {
    cleanup(w.root);
  }
});

test("AC2: the pure decision module — already-claimed when the candidate id is in-flight", () => {
  const w = makeWorld("ac2pure");
  try {
    seedAndCloneB(w, {
      alpha: ["plugin/scripts/claim-task.ts"],
      beta: ["plugin/test/claim-task.test.mjs"],
    });
    // Run the pure CLI directly (no git side effects): beta is NOT in-flight and disjoint → claimable.
    const runNode = (args) => {
      const res = spawnSync("node", ["--experimental-strip-types", ...args], { encoding: "utf8" });
      return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
    };
    const r = runNode([
      join(repoRoot, "plugin", "scripts", "claim-task.ts"),
      "--task", join(w.a, "tasks", "beta.md"),
      "--root", w.a,
      "--in-flight", "alpha",
    ]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^claimable/);

    // beta IS in-flight → already-claimed (not touches-overlap — the id check runs first).
    const r2 = runNode([
      join(repoRoot, "plugin", "scripts", "claim-task.ts"),
      "--task", join(w.a, "tasks", "beta.md"),
      "--root", w.a,
      "--in-flight", "alpha,beta",
    ]);
    assert.notEqual(r2.status, 0);
    assert.match(r2.stdout, /^already-claimed/);
  } finally {
    cleanup(w.root);
  }
});

// ── AC4: two machines, disjoint claims both succeed; same task → second fails ───────────────────────

test("AC4: two machines claim DISJOINT tasks — both succeed; the SAME task from both — only the first wins", () => {
  const w = makeWorld("ac4");
  try {
    seedAndCloneB(w, {
      task_a: ["plugin/scripts/claim-task.ts"],
      task_b: ["plugin/test/claim-task.test.mjs"],
    });

    // A claims task_a and B claims task_b (disjoint) — both succeed simultaneously.
    const aClaim = run(claimTask, ["task_a", "--root", w.a, "--remote", w.shared, "--check-touches"]);
    const bClaim = run(claimTask, ["task_b", "--root", w.b, "--remote", w.shared, "--check-touches"]);
    assert.equal(aClaim.status, 0, `A claim failed: ${aClaim.stdout}${aClaim.stderr}`);
    assert.equal(bClaim.status, 0, `B claim failed: ${bClaim.stdout}${bClaim.stderr}`);
    assert.match(git(w.a, "ls-remote", "--heads", w.shared, "refs/heads/task/task_a").stdout, /refs\/heads\/task\/task_a/);
    assert.match(git(w.a, "ls-remote", "--heads", w.shared, "refs/heads/task/task_b").stdout, /refs\/heads\/task\/task_b/);

    // The SAME task from B → only the first wins (negative control — no double-claim).
    const race = run(claimTask, ["task_a", "--root", w.b, "--remote", w.shared, "--check-touches"]);
    assert.notEqual(race.status, 0, "the second machine claiming the SAME task must fail");
    assert.match(race.stdout, /already-claimed/);
  } finally {
    cleanup(w.root);
  }
});

// ── stale-claim recovery (adversarial-review requirement) ───────────────────────────────────────────

test("stale-claim recovery: --reclaim refuses a FRESH claim and takes over a STALE one (CAS-guarded)", () => {
  const w = makeWorld("stale");
  try {
    seedAndCloneB(w, { alpha: ["plugin/scripts/claim-task.ts"] });

    // A claims alpha (fresh — author date = now).
    assert.equal(run(claimTask, ["alpha", "--root", w.a, "--remote", w.shared]).status, 0);

    // B tries to reclaim the FRESH claim → refused (the other machine is live).
    const r1 = run(claimTask, ["--reclaim", "alpha", "--root", w.b, "--remote", w.shared, "--stale-after", "6"]);
    assert.notEqual(r1.status, 0, "reclaiming a fresh claim must be refused");
    assert.match(r1.stdout, /reclaim-refused/);
    assert.match(r1.stdout, /not stale/);

    // Release, then B re-claims with a BACKDATED marker commit (author date 2026-01-01) — simulating a
    // claim left behind by a machine that died long ago.
    assert.equal(run(releaseTask, ["alpha", "--root", w.a, "--remote", w.shared]).status, 0);
    const envPast = {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
    };
    const staleClaim = run(claimTask, ["alpha", "--root", w.b, "--remote", w.shared], { env: envPast });
    assert.equal(staleClaim.status, 0, `stale claim failed: ${staleClaim.stdout}${staleClaim.stderr}`);

    // Now A reclaims with --stale-after 6 → the claim is months old → allowed.
    const r2 = run(claimTask, ["--reclaim", "alpha", "--root", w.a, "--remote", w.shared, "--stale-after", "6"]);
    assert.equal(r2.status, 0, `stale reclaim failed: ${r2.stdout}${r2.stderr}`);
    assert.match(r2.stdout, /reclaimed/);

    // The marker is now A's (fresh timestamp), so a second reclaim of it is refused again.
    const r3 = run(claimTask, ["--reclaim", "alpha", "--root", w.b, "--remote", w.shared, "--stale-after", "6"]);
    assert.notEqual(r3.status, 0);
    assert.match(r3.stdout, /reclaim-refused/);

    // --status reports the current claim.
    const st = run(claimTask, ["--status", "alpha", "--root", w.a, "--remote", w.shared]);
    assert.equal(st.status, 0, st.stdout + st.stderr);
    assert.match(st.stdout, /claimed: task\/alpha/);
  } finally {
    cleanup(w.root);
  }
});

test("release of an already-released claim is a no-op (idempotent release)", () => {
  const w = makeWorld("rel-idem");
  try {
    seedAndCloneB(w, { alpha: ["plugin/scripts/claim-task.ts"] });
    const r = run(releaseTask, ["alpha", "--root", w.a, "--remote", w.shared]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /not claimed|nothing to release/);
  } finally {
    cleanup(w.root);
  }
});

test("claim without a claim remote FAILS CLOSED (single-machine workspaces must not silently claim)", () => {
  const w = makeWorld("noremote");
  try {
    seedAndCloneB(w, { alpha: ["plugin/scripts/claim-task.ts"] });
    const envNoRemote = { ...process.env, QUAY_CLAIM_REMOTE: "" };
    const r = run(claimTask, ["alpha", "--root", w.a], { env: envNoRemote });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no claim remote/);
  } finally {
    cleanup(w.root);
  }
});

test("adversarial: task/<id> and task/<id-prefix> are DISTINCT claims (exact ref match, not substring)", () => {
  const w = makeWorld("prefix");
  try {
    seedAndCloneB(w, {
      alpha: ["plugin/scripts/claim-task.ts"],
      "alpha-beta": ["plugin/test/claim-task.test.mjs"],
    });

    // A claims alpha. B claims alpha-beta (a DIFFERENT task whose id has alpha as a prefix) — must
    // NOT be blocked by alpha's existence (a substring grep would false-positive here).
    assert.equal(run(claimTask, ["alpha", "--root", w.a, "--remote", w.shared]).status, 0);
    const bClaim = run(claimTask, ["alpha-beta", "--root", w.b, "--remote", w.shared, "--check-touches"]);
    assert.equal(bClaim.status, 0, `prefix-distinct claim must succeed: ${bClaim.stdout}${bClaim.stderr}`);
    assert.match(bClaim.stdout, /claimed/);

    // Both markers exist as distinct refs.
    const ls = git(w.a, "ls-remote", "--heads", w.shared, "refs/heads/task/alpha*");
    assert.match(ls.stdout, /refs\/heads\/task\/alpha$/m);
    assert.match(ls.stdout, /refs\/heads\/task\/alpha-beta$/m);
  } finally {
    cleanup(w.root);
  }
});

test("adversarial: an UNREACHABLE shared remote FAILS CLOSED (exit 2), never a silent 'not claimed'", () => {
  const w = makeWorld("unreachable");
  try {
    seedAndCloneB(w, { alpha: ["plugin/scripts/claim-task.ts"] });
    const missing = join(w.root, "does-not-exist.git");
    const c = run(claimTask, ["alpha", "--root", w.a, "--remote", missing]);
    assert.notEqual(c.status, 0);
    assert.equal(c.status, 2, "unreachable remote must exit 2");
    assert.match(c.stderr, /unreachable/);

    const r = run(releaseTask, ["alpha", "--root", w.a, "--remote", missing]);
    assert.equal(r.status, 2, "release on unreachable remote must exit 2");
    assert.match(r.stderr, /unreachable/);
  } finally {
    cleanup(w.root);
  }
});

// ── --sync: the DOWNSYNC half of the bidirectional merge (gap-two-peer-quay-developers-…) ─────────
// Before claiming, --sync pulls the fork-baseline (develop) from the claim remote into the LOCAL
// develop — "develop on latest" (the human frame 2026-08-06: both machines continuously apply latest
// and develop on latest, symmetric). The claim itself is unchanged; the downsync is a pre-step that
// fast-forwards local develop when strictly behind and FAILS CLOSED on a true divergence.

test("--sync: before claiming, the machine's local develop is fast-forwarded to origin/develop (develop on latest)", () => {
  const w = makeWorld("sync");
  try {
    // A publishes develop to the shared repo (the claim remote, as a configured `origin`).
    git(w.a, "checkout", "-q", "-b", "develop");
    writeFileSync(join(w.a, "base.txt"), "base\n", "utf8");
    assert.equal(git(w.a, "add", "-A").status, 0);
    assert.equal(git(w.a, "commit", "-q", "-m", "develop base").status, 0, "develop base commit");
    assert.equal(git(w.a, "push", "-q", "-u", "origin", "develop").status, 0, "publish develop to origin");
    const baseTip = git(w.a, "rev-parse", "develop").stdout.trim();

    // A peer (another clone) advances origin/develop.
    const peer = join(w.root, "peer");
    assert.equal(git(w.root, "clone", "-q", w.shared, peer).status, 0, "clone peer");
    git(peer, "config", "user.name", "peer");
    git(peer, "config", "user.email", "peer@example.com");
    git(peer, "checkout", "-q", "-b", "develop", "origin/develop");
    writeFileSync(join(peer, "peer.txt"), "peer work\n", "utf8");
    assert.equal(git(peer, "add", "-A").status, 0);
    assert.equal(git(peer, "commit", "-q", "-m", "peer develop work").status, 0, "peer develop commit");
    assert.equal(git(peer, "push", "-q", "origin", "develop").status, 0, "peer pushes develop");
    const peerTip = git(peer, "rev-parse", "develop").stdout.trim();

    // A claims a task WITH --sync: local develop (stale, at base) is fast-forwarded to origin/develop
    // (peerTip) BEFORE the claim. The claim remote is the configured `origin` (the shared repo).
    writeTask(w.a, "sync_task", ["plugin/scripts/claim-task.ts"]);
    const c = run(claimTask, ["sync_task", "--root", w.a, "--remote", "origin", "--sync"]);
    assert.equal(c.status, 0, `--sync claim failed: ${c.stdout}${c.stderr}`);
    assert.match(c.stdout, /fast-forwarded local develop by 1 commit/, "--sync ran the downsync first");
    assert.match(c.stdout, /claimed: task\/sync_task/, "the claim proceeded after the downsync");
    assert.equal(git(w.a, "rev-parse", "develop").stdout.trim(), peerTip, "local develop now at the peer's latest (develop on latest)");
    assert.notEqual(baseTip, peerTip, "the machine actually moved onto the peer's latest");
  } finally {
    cleanup(w.root);
  }
});

test("--sync negative control: a TRUE divergence FAILS CLOSED — the claim is refused, nothing moved", () => {
  const w = makeWorld("syncdiv");
  try {
    git(w.a, "checkout", "-q", "-b", "develop");
    writeFileSync(join(w.a, "base.txt"), "base\n", "utf8");
    assert.equal(git(w.a, "add", "-A").status, 0);
    assert.equal(git(w.a, "commit", "-q", "-m", "develop base").status, 0);
    assert.equal(git(w.a, "push", "-q", "-u", "origin", "develop").status, 0, "publish develop to origin");

    // Peer advances origin/develop.
    const peer = join(w.root, "peer");
    assert.equal(git(w.root, "clone", "-q", w.shared, peer).status, 0, "clone peer");
    git(peer, "config", "user.name", "peer");
    git(peer, "config", "user.email", "peer@example.com");
    git(peer, "checkout", "-q", "-b", "develop", "origin/develop");
    writeFileSync(join(peer, "peer.txt"), "peer work\n", "utf8");
    assert.equal(git(peer, "add", "-A").status, 0);
    assert.equal(git(peer, "commit", "-q", "-m", "peer develop work").status, 0);
    assert.equal(git(peer, "push", "-q", "origin", "develop").status, 0, "peer pushes develop");

    // A makes a LOCAL develop commit it has NOT pushed — now both sides diverged.
    git(w.a, "checkout", "-q", "develop");
    writeFileSync(join(w.a, "local.txt"), "local work\n", "utf8");
    assert.equal(git(w.a, "add", "-A").status, 0);
    assert.equal(git(w.a, "commit", "-q", "-m", "machine local develop work").status, 0);
    const localTip = git(w.a, "rev-parse", "develop").stdout.trim();

    // Claim with --sync on a true divergence → REFUSED (exit 1), nothing claimed, nothing moved.
    writeTask(w.a, "sync_div_task", ["plugin/scripts/claim-task.ts"]);
    const c = run(claimTask, ["sync_div_task", "--root", w.a, "--remote", "origin", "--sync"]);
    assert.notEqual(c.status, 0, "a divergent --sync claim must fail closed");
    assert.equal(c.status, 1, "divergence exit must be 1");
    assert.match(`${c.stdout}${c.stderr}`, /DIVERGENCE|diverged|downsync FAILED/);
    assert.equal(git(w.a, "rev-parse", "develop").stdout.trim(), localTip, "local develop NOT moved (no blind merge)");
    assert.equal(git(w.a, "ls-remote", "--heads", "origin", "refs/heads/task/sync_div_task").stdout.trim(), "", "the task was NOT claimed");
  } finally {
    cleanup(w.root);
  }
});
