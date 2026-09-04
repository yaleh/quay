// @test-group engine
// supervisor-observe.test.mjs — tests for plugin/scripts/supervisor-observe.sh
// (tasks/gap-cross-machine-readonly-observation-orchestration-not-a-tool).
//
// observe(target) -> {git_state, suite_state, session_state, process_state}, READ-ONLY,
// ssh-transport-agnostic (same shape local vs remote, --host decides the wrapper). This is the
// READ-side counterpart to supervisor-deliver.sh. Each of tonight's four error classes has a
// negative control here:
//   1. fetch-before-compare  — AC2 load-bearing control: origin advanced behind local's back, NO
//                              manual fetch, observe() must report the REFRESHED behind (never the
//                              stale 0). The before-would-be-wrong value is reproduced and shown.
//   2. HEAD-vs-branch        — observe --branch <name> compares <name> vs <name>'s OWN upstream,
//                              never HEAD-as-something-else.
//   3. monitor-cache-stale   — session_state reads tmux LIVE (a created session appears on the
//                              next call; a killed one disappears) and reads no cache/state file.
//   4. process-comm-field-match — comm exact match (reads /proc/<pid>/comm, the kernel-truncated
//                              value), argv[0]-basename match, observer self-tree excluded, and a
//                              path substring is NOT a match (the `pgrep -af` too-broad failure).
// Plus AC1 shape consistency local vs remote-over-ssh (in-file skip: ssh localhost must work).
//
// Run:
//   scripts/test.sh plugin/test/supervisor-observe.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

// STAGE 1 (gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe): this test used
// TMUX_TMPDIR alone — under an inherited $TMUX that resolves to the DEFAULT server (the crash
// path). The tmux-session library makes BOTH conditions structural: explicit `-S <materialized
// socket>` + $TMUX stripped.
import { tmux as isolatedTmux } from "../scripts/tmux-session.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "supervisor-observe.sh");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runObserve(args, extraEnv = {}) {
  const res = spawnSync("bash", [SCRIPT, "observe", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    timeout: 60000,
  });
  assert.equal(res.status, 0, `observe failed (${res.status}): ${res.stderr}`);
  let data;
  try {
    data = JSON.parse(res.stdout);
  } catch (e) {
    assert.fail(`observe stdout not JSON: ${res.stdout}\nstderr: ${res.stderr}`);
  }
  return data;
}

function runObserveJson(root, extra = {}) {
  return runObserve(["--host", "local", "--root", root, "--json"], extra);
}

// ── hermetic git repo helpers ───────────────────────────────────────────────────────────────────────
function git(args, opts = {}) {
  const res = spawnSync("git", args, { encoding: "utf8", ...opts });
  assert.equal(res.status, 0, `git ${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout.trim();
}

function gitC(repo, ...args) {
  return git(["-C", repo, ...args]);
}

function makeGitRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "obs-git-"));
  const remote = path.join(tmp, "remote.git");
  const repo = path.join(tmp, "repo");
  git(["init", "-q", "--bare", remote]);
  git(["init", "-q", "-b", "develop", repo]);
  gitC(repo, "config", "user.email", "t@t");
  gitC(repo, "config", "user.name", "t");
  fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
  gitC(repo, "add", "-A");
  gitC(repo, "commit", "-qm", "c1");
  gitC(repo, "remote", "add", "origin", remote);
  gitC(repo, "push", "-q", "-u", "origin", "develop");
  return { tmp, remote, repo };
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
}

function killProc(pid) {
  try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
}

// ── AC1: the four-field shape ───────────────────────────────────────────────────────────────────────

test("AC1 — observe --host local --json emits exactly the four field objects {git_state, suite_state, session_state, process_state} plus host/observedAt", () => {
  const w = makeGitRepo();
  try {
    const data = runObserveJson(w.repo);
    const keys = Object.keys(data);
    assert.ok(keys.includes("git_state"), `git_state missing: ${keys}`);
    assert.ok(keys.includes("suite_state"), `suite_state missing`);
    assert.ok(keys.includes("session_state"), `session_state missing`);
    assert.ok(keys.includes("process_state"), `process_state missing`);
    assert.ok("host" in data && "observedAt" in data);
    // each field is an object (or the documented field type)
    assert.equal(typeof data.git_state, "object");
    assert.equal(typeof data.suite_state, "object");
    assert.equal(typeof data.session_state, "object");
    assert.ok(Array.isArray(data.process_state), "process_state must be an array of processes");
  } finally { cleanup(w.tmp); }
});

// ── AC2 / AC3a (LOAD-BEARING): fetch-before-compare ─────────────────────────────────────────────────
// Reproduce tonight's real stale-ref scenario: origin advances behind the target's back. A read that
// does NOT fetch first reports the STALE remote-tracking ref (behind=0); observe() must fetch first
// and report the REFRESHED value. If it reports stale, the task is invalid.

test("AC2 — stale remote-tracking ref: observe() reports the REFRESHED behind without a manual fetch (the tonight bug would report 0)", () => {
  const w = makeGitRepo();
  try {
    // local commits c2 (ahead of origin at c1)
    fs.appendFileSync(path.join(w.repo, "a.txt"), "b\n");
    gitC(w.repo, "commit", "-qam", "c2");
    // origin advances to c3 behind local's back (from a worker clone)
    const worker = path.join(w.tmp, "worker");
    git(["clone", "-q", "-b", "develop", w.remote, worker]);
    fs.appendFileSync(path.join(worker, "a.txt"), "c\n");
    gitC(worker, "config", "user.email", "t@t");
    gitC(worker, "config", "user.name", "t");
    gitC(worker, "commit", "-qam", "c3");
    gitC(worker, "push", "-q", "origin", "develop");

    // BEFORE (the tonight bug): the stale remote-tracking ref, no fetch.
    const staleBefore = gitC(w.repo, "rev-list", "--left-right", "--count", "HEAD...origin/develop");
    const [staleAhead, staleBehind] = staleBefore.split(/\s+/).map(Number);
    assert.equal(staleBehind, 0, "precondition: the stale read reports behind=0 (the bug we must fix)");

    // observe() WITHOUT a manual fetch — it must fetch internally and report the refreshed value.
    const data = runObserveJson(w.repo);
    assert.equal(data.git_state.ok, true);
    assert.equal(data.git_state.behind, 1, `observe must report refreshed behind=1, not stale ${staleBehind}`);
    assert.equal(data.git_state.ahead, 1, "local c2 is still ahead of the refreshed origin/develop");

    // Ground truth: manual fetch then count (the Contract's fetch_before_compare reference).
    gitC(w.repo, "fetch", "-q", "origin");
    const truth = gitC(w.repo, "rev-list", "--left-right", "--count", "HEAD...origin/develop");
    const [truthAhead, truthBehind] = truth.split(/\s+/).map(Number);
    assert.equal(data.git_state.behind, truthBehind, "observe behind must equal the manual-fetch ground truth");
    assert.equal(data.git_state.ahead, truthAhead);
  } finally { cleanup(w.tmp); }
});

test("AC3a — fetch-before-compare also holds when local is BEHIND-only (origin ahead, local untouched)", () => {
  const w = makeGitRepo();
  try {
    // origin advances to c2/c3; local stays at c1
    const worker = path.join(w.tmp, "worker");
    git(["clone", "-q", "-b", "develop", w.remote, worker]);
    gitC(worker, "config", "user.email", "t@t");
    gitC(worker, "config", "user.name", "t");
    fs.appendFileSync(path.join(worker, "a.txt"), "b\n");
    gitC(worker, "commit", "-qam", "c2");
    fs.appendFileSync(path.join(worker, "a.txt"), "c\n");
    gitC(worker, "commit", "-qam", "c3");
    gitC(worker, "push", "-q", "origin", "develop");

    const data = runObserveJson(w.repo);
    assert.equal(data.git_state.behind, 2, "both c2 and c3 are behind local's stale view");
    assert.equal(data.git_state.ahead, 0);
  } finally { cleanup(w.tmp); }
});

// ── AC3b: HEAD-vs-branch ─────────────────────────────────────────────────────────────────────────────
// Tonight's error: `git rev-list --count origin/master...master` compared HEAD (master) with develop.
// observe() always NAMES the branch it compares and compares <branch> vs <branch>'s own upstream —
// never HEAD-as-one-branch against another branch.

test("AC3b — observe --branch develop compares develop vs origin/develop even while HEAD is master", () => {
  const w = makeGitRepo();
  try {
    // master branch created and checked out; develop stays at c1
    gitC(w.repo, "checkout", "-q", "-b", "master");
    fs.appendFileSync(path.join(w.repo, "a.txt"), "m\n");
    gitC(w.repo, "commit", "-qam", "master-only");
    gitC(w.repo, "push", "-q", "-u", "origin", "master");
    // develop advances locally (ahead 1) via a worktree-free branch move
    gitC(w.repo, "checkout", "-q", "develop");
    fs.appendFileSync(path.join(w.repo, "a.txt"), "d\n");
    gitC(w.repo, "commit", "-qam", "develop-c2");

    // Move HEAD back to master, then observe --branch develop.
    gitC(w.repo, "checkout", "-q", "master");
    const data = runObserve(["--host", "local", "--root", w.repo, "--branch", "develop", "--json"]);
    const g = data.git_state;
    assert.equal(g.branch, "develop", "observe must name the inspected branch");
    assert.equal(g.upstream, "origin/develop", "upstream must be develop's own");
    assert.match(g.comparedRef, /origin\/develop/, `comparedRef must be origin/develop, got ${g.comparedRef}`);
    assert.equal(g.ahead, 1, "develop's own ahead (local c2 vs origin c1)");
    assert.equal(g.behind, 0);

    // Default (no --branch) inspects the CURRENT branch (master), not develop.
    const d2 = runObserveJson(w.repo);
    assert.equal(d2.git_state.branch, "master", "default must inspect the checked-out branch");
  } finally { cleanup(w.tmp); }
});

// ── AC3c: monitor-cache-stale ────────────────────────────────────────────────────────────────────────
// Tonight's error: a 5-minute-poll Monitor reported a stale tmux topology. observe() is a
// point-in-time probe: session_state ALWAYS reads tmux LIVE at call time and never consults a cache.

test("AC3c — session_state reads tmux LIVE (a created session appears on the next call; a killed one disappears) and the script reads no cache/state file", async () => {
  const tmuxTmp = fs.mkdtempSync(path.join(os.tmpdir(), "obs-tmux-"));
  // The socket tmux materializes for TMUX_TMPDIR=<tmuxTmp> when $TMUX is stripped.
  const sockPath = path.join(tmuxTmp, `tmux-${process.getuid()}`, "default");
  fs.mkdirSync(path.dirname(sockPath), { recursive: true, mode: 0o700 });
  // $TMUX must be STRIPPED (TMUX_TMPDIR alone does not isolate a process that inherited $TMUX —
  // the 2026-08-06 fifth-wipe crash path).
  const sockEnv = { TMUX_TMPDIR: tmuxTmp, TMUX: undefined };
  const w = makeGitRepo();
  try {
    // a fresh, hermetic session on an isolated socket — never touches the driver's tmux
    const sess = "obs-hermetic-sess";
    // explicit -S to the materialized private socket (the observe script's bare `tmux` under
    // sockEnv resolves to the SAME socket).
    const spawnTmux = (cmd) => isolatedTmux(cmd, { socket: sockPath, env: sockEnv });

    const before = runObserveJson(w.repo, sockEnv);
    const beforeNames = before.session_state.sessions.map((s) => s.name);
    assert.ok(!beforeNames.includes(sess), "precondition: hermetic session absent before creation");

    const created = spawnTmux(["new-session", "-d", "-s", sess]);
    assert.equal(created.status, 0, `tmux new-session failed: ${created.stderr}`);
    try {
      // Live read: the just-created session MUST appear immediately (no 5-minute poll, no cache).
      const during = runObserveJson(w.repo, sockEnv);
      const duringNames = during.session_state.sessions.map((s) => s.name);
      assert.ok(duringNames.includes(sess), `created session must appear immediately: ${duringNames}`);
    } finally {
      spawnTmux(["kill-session", "-t", sess]);
    }
    // Live read: the killed session MUST disappear immediately.
    const after = runObserveJson(w.repo, sockEnv);
    const afterNames = after.session_state.sessions.map((s) => s.name);
    assert.ok(!afterNames.includes(sess), `killed session must disappear immediately: ${afterNames}`);

    // The script must not consult any cache/state file — it reads tmux at call time only.
    const src = fs.readFileSync(SCRIPT, "utf8");
    assert.ok(!src.includes("OBSERVE_CACHE") && !src.includes("suite-state-last.json"),
      "observe() must read no cached/state file (monitor-cache-stale error class)");
    assert.match(src, /tmux list-sessions/, "session_state must be a live tmux list-sessions read");
  } finally {
    cleanup(tmuxTmp);
    cleanup(w.tmp);
  }
});

// ── AC3d: process-comm-field-match ───────────────────────────────────────────────────────────────────
// Tonight's errors: pgrep -c substring SELF-match, pgrep -x MISSED match, awk $2=="tmux" wrong field
// (comm truncation). observe() reads /proc/<pid>/comm (kernel-exact) + /proc/<pid>/cmdline, matches
// comm==pattern OR basename(argv[0])==pattern, excludes its own tree, and does NOT match a mere path
// substring.

test("AC3d — process_state: comm exact match + argv[0]-basename match, and a PATH substring is NOT a match", async () => {
  const w = makeGitRepo();
  const probe = path.join(w.tmp, "claude-observe-probe-helper.sh");
  fs.writeFileSync(probe, "#!/usr/bin/env bash\nsleep 30\n", "utf8");
  const child = spawn("bash", [probe], { stdio: "ignore" });
  let sleepPid = null;
  try {
    // wrapper bash (argv0=bash, comm=bash) whose cmdline CONTAINS the pattern in its path must NOT match
    let data = runObserve(["--host", "local", "--root", w.repo, "--comm", "claude-observe-probe", "--json"]);
    let procs = data.process_state;
    let wrapper = procs.filter((p) => p.cmdline.includes("claude-observe-probe-helper.sh"));
    assert.equal(wrapper.length, 0,
      `a path substring must NOT match (pgrep -af too-broad failure): ${JSON.stringify(wrapper)}`);

    // a process whose argv[0] basename == pattern MUST match (exec -a claude-observe-probe sleep 30)
    const spawned = spawn("bash", ["-c", "exec -a claude-observe-probe sleep 30"], { stdio: "ignore" });
    try {
      for (let i = 0; i < 100 && !fs.existsSync(`/proc/${spawned.pid}`); i++) await sleep(20);
      data = runObserve(["--host", "local", "--root", w.repo, "--comm", "claude-observe-probe", "--json"]);
      procs = data.process_state;
      assert.ok(procs.some((p) => p.pid === spawned.pid),
        `the argv[0]-basename process (${spawned.pid}) must be found`);
      const found = procs.find((p) => p.pid === spawned.pid);
      assert.equal(found.comm, "sleep", "comm is the kernel-truncated executable name");
      assert.match(found.cmdline, /^claude-observe-probe/, "argv[0] is the exec -a name");
    } finally { killProc(spawned.pid); }

    // a process whose comm == pattern (real executable renamed to a >15-char name: kernel truncates)
    const longSleep = path.join(w.tmp, "claude-observe-probe-xxxxxxxxxxx"); // 28 chars -> comm truncated to 15
    fs.copyFileSync("/bin/sleep", longSleep);
    fs.chmodSync(longSleep, 0o755);
    const longChild = spawn(longSleep, ["30"], { stdio: "ignore" });
    try {
      const comm15 = fs.readFileSync(`/proc/${longChild.pid}/comm`, "utf8").trim();
      assert.equal(comm15.length, 15, "kernel comm must be 15 chars (truncated)");
      data = runObserve(["--host", "local", "--root", w.repo, "--comm", comm15, "--json"]);
      procs = data.process_state;
      const hit = procs.find((p) => p.pid === longChild.pid);
      assert.ok(hit, `the comm==pattern process (${longChild.pid}, comm=${comm15}) must be found`);
      assert.equal(hit.comm, comm15, "reported comm must be the exact kernel-truncated value (awk $2 wrong-field failure)");
    } finally { killProc(longChild.pid); }
  } finally {
    killProc(child.pid);
    cleanup(w.tmp);
  }
});

test("AC3d — process_state self-match negative control: the observer's own tree is excluded even when the pattern matches its own comm (--comm bash)", () => {
  const w = makeGitRepo();
  try {
    const data = runObserve(["--host", "local", "--root", w.repo, "--comm", "bash", "--json"]);
    const procs = data.process_state;
    // Self-match is scoped to THIS observer's own process (identified by its unique --root).
    // Concurrent suites from OTHER tasks legitimately run their own supervisor-observe.sh with a
    // DIFFERENT --root and match --comm bash — those are real observation results, not a self-match.
    // A bare `cmdline.includes("supervisor-observe.sh")` conflates a concurrent observer (e.g. the
    // gap-suite-serial-lowconc-... suite's observe --root /tmp/obs-git-<other>/repo) with the
    // observer's own tree, breaking this negative control under full-suite concurrency.
    const observer = procs.filter((p) => p.cmdline.includes("supervisor-observe.sh") && p.cmdline.includes(w.repo));
    assert.equal(observer.length, 0,
      `the observer's own process must be excluded (pgrep -c self-match): ${JSON.stringify(observer)}`);
    const pythons = procs.filter((p) => p.comm === "python3");
    assert.equal(pythons.length, 0, "the observer's own python3 subprocess must be excluded");
  } finally { cleanup(w.tmp); }
});

// ── AC1 (Contract measure observe_call_shape_consistent): local vs remote-over-ssh same shape ────────
// In-file skip (ADR-019): the remote demonstration needs ssh to localhost; skipped otherwise.

const sshToLocalhost = (() => {
  try {
    const r = spawnSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "localhost", "true"], { timeout: 15000 });
    return r.status === 0;
  } catch { return false; }
})();

test(
  "AC1 (Contract measure) — observe --host local and --host <remote> emit the SAME top-level field set",
  { skip: !sshToLocalhost && "ssh localhost unavailable — remote shape check skipped (AC1 local shape still asserted above)" },
  () => {
    const w = makeGitRepo();
    try {
      const local = runObserve(["--host", "local", "--root", w.repo, "--json"]);
      const remote = runObserve(["--host", "localhost", "--root", w.repo, "--json"]);
      const lk = Object.keys(local).sort();
      const rk = Object.keys(remote).sort();
      assert.deepEqual(rk, lk, "remote field set must equal local field set (observe_call_shape_consistent)");
      assert.equal(remote.git_state.behind, local.git_state.behind);
      assert.equal(typeof remote.process_state.length, "number");
    } finally { cleanup(w.tmp); }
  },
);

// ── read-only contract (observe() must not touch the working tree) ──────────────────────────────────

test("read-only — observe() leaves the working tree untouched (git status unchanged) and only refreshes remote-tracking refs", () => {
  const w = makeGitRepo();
  try {
    fs.appendFileSync(path.join(w.repo, "a.txt"), "b\n");
    gitC(w.repo, "commit", "-qam", "c2");
    const before = gitC(w.repo, "status", "--short");
    const data = runObserveJson(w.repo);
    const after = gitC(w.repo, "status", "--short");
    assert.equal(after, before, "observe() must not modify the working tree / index");
    // it DID fetch (behind correct after origin advanced) — the refresh is the only write
    const worker = path.join(w.tmp, "worker");
    git(["clone", "-q", "-b", "develop", w.remote, worker]);
    gitC(worker, "config", "user.email", "t@t");
    gitC(worker, "config", "user.name", "t");
    fs.appendFileSync(path.join(worker, "a.txt"), "c\n");
    gitC(worker, "commit", "-qam", "c3");
    gitC(worker, "push", "-q", "origin", "develop");
    const d2 = runObserveJson(w.repo);
    assert.equal(d2.git_state.behind, 1, "observe() refreshed the remote-tracking ref via fetch");
    const after2 = gitC(w.repo, "status", "--short");
    assert.equal(after2, before, "the fetch refresh must not dirty the working tree");
    // no new local branch/commit from the observation
    const branches = gitC(w.repo, "branch", "--list");
    assert.ok(!branches.includes("supervisor-observe"), "observe() must not create branches");
  } finally { cleanup(w.tmp); }
});
