// @test-group engine
// heavy-op-token.test.mjs — gap-no-cross-project-heavy-op-token. Pins the cross-project heavy-op
// token (plugin/scripts/heavy-op-token.sh) as a MECHANICAL mechanism, not prose:
//
//   AC1 — --acquire / --release / --status; --status prints holder, held_ms, stale_reclaims
//   AC2 — bidirectional negative control: A holds ⇒ B --acquire fails printing A's identity +
//         held duration; A releases ⇒ B succeeds (both directions, real output)
//   AC3 — stale reclaim needs BOTH mtime timeout AND a dead pid: an OLD-mtime LIVE-pid fixture is
//         NOT reclaimed (protects long-running holders from mtime-only reaping)
//   AC4 — crash recovery: kill -9 the holder ⇒ the other side reclaims after timeout and acquires
//   AC5 — fail-open when the state dir is unwritable (exit 0 + LOUD marker); recovery restores
//         normal mutual exclusion — a scheduling token must not fail-closed (three projects would
//         stop and never self-recover)
//   AC6 — scripts/test.sh acquires on the full-suite default path only; scoped paths (--for-task,
//         explicit files, non-default --group) never touch the token. The full-path REAL run is the
//         coordinator's fan-in suite responsibility (this file must not spawn scripts/test.sh —
//         R3 of the test-isolation contract — so the wiring is pinned STRUCTURALLY here).
//   AC8 — the token is a single file with no repo dependency: copied to an empty dir it still runs
//   AC9 — every test touches only a --root / QUAY_GLOBAL_DIR temp dir, never the real token
//   AC10 — `// @test-group engine` declaration (enforced by test-framework-policy-check too)
//
// Run:
//   scripts/test.sh plugin/test/heavy-op-token.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TOKEN = path.join(REPO_ROOT, "plugin", "scripts", "heavy-op-token.sh");
const TEST_SH = path.join(REPO_ROOT, "scripts", "test.sh");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const makeTmp = (prefix = "heavy-op-token-") => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** Run the REAL token script with a temp --root (never the real default dir). */
function runToken(args, { root, env = {} } = {}) {
  // Every acquire now lands a JSONL record (gap-token-wait-times-...); point --events-file at the
  // temp root so a --root test cycle never writes the real workspace's .quay/heavy-op-token-events.jsonl
  // (same isolation discipline as AC9's "never touch the real default token").
  const fullArgs = root
    ? ["--root", root, "--events-file", path.join(root, "heavy-op-events.jsonl"), ...args]
    : args;
  const res = spawnSync("bash", [TOKEN, ...fullArgs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, all: `${res.stdout}\n${res.stderr}` };
}

/** A pid that is definitely dead (a child that has exited and been reaped). */
function deadPid() {
  const r = spawnSync("true");
  return r.pid;
}

// ── AC1: subcommands + --status fields ────────────────────────────────────────────────────────────────
test("AC1 — --acquire/--release/--status; --status prints holder, held_ms, stale_reclaims", () => {
  const root = makeTmp();
  try {
    let r = runToken(["--status"], { root });
    assert.equal(r.status, 0, `status must exit 0:\n${r.all}`);
    assert.match(r.stdout, /holder=none/);
    assert.match(r.stdout, /held_ms=n\/a/);
    assert.match(r.stdout, /stale_reclaims=0/);

    r = runToken(["--acquire", "quay", "--timeout", "0"], { root });
    assert.equal(r.status, 0, `acquire must exit 0:\n${r.all}`);
    assert.match(r.stdout, /waited_ms=0 holder=quay acquired=yes/);

    r = runToken(["--status"], { root });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /holder=quay/);
    assert.match(r.stdout, /held_ms=\d+/);
    assert.match(r.stdout, /stale_reclaims=0/);

    r = runToken(["--release", "quay"], { root });
    assert.equal(r.status, 0, `release must exit 0:\n${r.all}`);

    r = runToken(["--status"], { root });
    assert.match(r.stdout, /holder=none/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1 — missing project id is a usage error (exit 2)", () => {
  const root = makeTmp();
  try {
    const r = runToken(["--acquire"], { root });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /requires a project id/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC2: bidirectional negative control ───────────────────────────────────────────────────────────────
test("AC2 — A holds ⇒ B fails printing A's identity + held duration; A releases ⇒ B succeeds", () => {
  const root = makeTmp();
  try {
    const a = runToken(["--acquire", "quay", "--timeout", "0"], { root });
    assert.equal(a.status, 0, `A acquire failed:\n${a.all}`);

    const b = runToken(["--acquire", "meta-cc", "--timeout", "0"], { root });
    assert.equal(b.status, 1, `B must FAIL while A holds:\n${b.all}`);
    assert.match(b.stderr, /HELD by quay/, "B's failure must name A's identity (holder=quay)");
    assert.match(b.stderr, /held \d+ms/, "B's failure must print A's held duration");
    // waited_ms is a contract measure — the failing acquire still reports it.
    assert.match(b.all, /waited_ms=0/, "B's acquire must still emit waited_ms");

    const rel = runToken(["--release", "quay"], { root });
    assert.equal(rel.status, 0, `A release failed:\n${rel.all}`);
    assert.match(rel.stdout, /released/);

    const b2 = runToken(["--acquire", "meta-cc", "--timeout", "0"], { root });
    assert.equal(b2.status, 0, `B must succeed after A releases:\n${b2.all}`);
    assert.match(b2.stdout, /acquired=yes/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC3: stale reclaim needs BOTH mtime timeout AND a dead pid ────────────────────────────────────────
test("AC3 — an OLD-mtime LIVE-pid token is NOT reclaimed (mtime alone must never kill a long-running holder)", () => {
  const root = makeTmp();
  try {
    const tokenPath = path.join(root, "heavy-op", "token");
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    // pid = THIS test process (alive); acquired_ms in the past; mtime backdated past the 1s seam.
    fs.writeFileSync(tokenPath, `holder=aliveproj\npid=${process.pid}\nacquired_ms=${Date.now() - 60000}\nhost=test\n`);
    const past = new Date(Date.now() - 10000);
    fs.utimesSync(tokenPath, past, past);

    const r = runToken(["--acquire", "quay", "--timeout", "0"], { root, env: { HEAVY_OP_STALE_TIMEOUT_S: "1" } });
    assert.equal(r.status, 1, `must NOT reclaim a LIVE holder:\n${r.all}`);
    // A live pid takes the "HELD by" branch (the pid-alive half of the reclaim guard) — the token
    // is preserved. The "NOT stale" branch is the dead-pid/fresh-mtime mirror (next test).
    assert.match(r.stderr, /HELD by aliveproj/);
    assert.match(r.stderr, /held \d+ms/);
    assert.ok(fs.existsSync(tokenPath), "a live holder's token must not be removed");

    const s = runToken(["--status"], { root });
    assert.match(s.stdout, /stale_reclaims=0/, "no reclaim happened, so the counter is untouched");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 mirror — a DEAD-pid FRESH-mtime token is also NOT reclaimed (both halves must hold)", () => {
  const root = makeTmp();
  try {
    const tokenPath = path.join(root, "heavy-op", "token");
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, `holder=deadproj\npid=${deadPid()}\nacquired_ms=${Date.now()}\nhost=test\n`);
    // mtime is fresh (just written) — pid is dead, but the timeout half has not elapsed.
    // Robustness: refresh the mtime explicitly right before acquire and give the timeout margin.
    // Under full-suite load the write→acquire gap can exceed the old 1s seam, aging a "fresh"
    // mtime into stale and spuriously reclaiming (flake: ratchet fan-in suite 2026-08-03).
    const now = new Date();
    fs.utimesSync(tokenPath, now, now);

    const r = runToken(["--acquire", "quay", "--timeout", "0"], { root, env: { HEAVY_OP_STALE_TIMEOUT_S: "5" } });
    assert.equal(r.status, 1, `dead pid + fresh mtime must NOT be reclaimed:\n${r.all}`);
    assert.match(r.stderr, /mtime only \d+s old/);
    assert.ok(fs.existsSync(tokenPath));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC4: crash recovery ───────────────────────────────────────────────────────────────────────────────
test("AC4 — kill -9 the holder: the other side reclaims after timeout and acquires (real run)", async () => {
  const root = makeTmp();
  const holderEnv = { ...process.env, QUAY_GLOBAL_DIR: root, HEAVY_OP_STALE_TIMEOUT_S: "1" };
  let holder;
  try {
    // The holder acquires and then exec-sleeps on the SAME pid (exec keeps the recorded pid), so
    // killing the holder really kills the recorded pid — a genuine crash, not a manual rm.
    holder = spawn("bash", ["-c", `"${TOKEN}" --acquire quay --timeout 0 && exec sleep 1000`], { env: holderEnv });
    const tokenPath = path.join(root, "heavy-op", "token");
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(tokenPath) && Date.now() < deadline) await sleep(20);
    assert.ok(fs.existsSync(tokenPath), `the holder must have acquired the token:\n${tokenPath}`);

    holder.kill("SIGKILL");
    await sleep(50);
    // Backdate the mtime so the stale timeout is exceeded immediately (deterministic, no 1s sleep).
    const past = new Date(Date.now() - 10000);
    fs.utimesSync(tokenPath, past, past);

    const b = runToken(["--acquire", "meta-cc", "--timeout", "0"], { root, env: { HEAVY_OP_STALE_TIMEOUT_S: "1" } });
    assert.equal(b.status, 0, `B must reclaim and acquire after the crash:\n${b.all}`);
    assert.match(b.stderr, /RECLAIMED stale token/);
    assert.match(b.stdout, /acquired=yes/);

    const s = runToken(["--status"], { root });
    assert.match(s.stdout, /stale_reclaims=1/, "the reclaim must be observable in stale_reclaims");
    assert.match(s.stdout, /holder=meta-cc/);
  } finally {
    if (holder) holder.kill("SIGKILL");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC5: fail-open when unwritable, loud; recovery restores the mutex ─────────────────────────────────
test("AC5 — unwritable state dir FAILS OPEN (exit 0 + loud marker); recovery restores the mutex", () => {
  const root = makeTmp();
  try {
    // A regular FILE in the way makes `mkdir -p <root>/heavy-op` fail deterministically — this is
    // the "QUAY_GLOBAL_DIR 不可写/不可达" case (works as non-root, unlike a chmod 555).
    const blocker = path.join(root, "blocker");
    fs.writeFileSync(blocker, "i am a file, not a directory");

    const r = runToken(["--acquire", "quay", "--timeout", "0"], { root: blocker });
    assert.equal(r.status, 0, `fail-open must exit 0:\n${r.all}`);
    assert.match(r.all, /HEAVY-OP-TOKEN FAIL-OPEN/, "the fail-open marker must be LOUD and visible");
    assert.match(r.stdout, /acquired=no/);

    // Recovery: a writable root restores normal mutual exclusion.
    const goodRoot = path.join(root, "good");
    const a = runToken(["--acquire", "quay", "--timeout", "0"], { root: goodRoot });
    assert.equal(a.status, 0, `recovery acquire failed:\n${a.all}`);
    const b = runToken(["--acquire", "meta-cc", "--timeout", "0"], { root: goodRoot });
    assert.equal(b.status, 1, `mutex must be back after recovery:\n${b.all}`);
    runToken(["--release", "quay"], { root: goodRoot });
    const b2 = runToken(["--acquire", "meta-cc", "--timeout", "0"], { root: goodRoot });
    assert.equal(b2.status, 0, `B must acquire after recovery + release:\n${b2.all}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC6: test.sh wiring — full-suite default acquires; scoped paths never touch the token ─────────────
test("AC6 — test.sh acquires on the full-suite default path ONLY, before the gate; scoped paths never touch the token", () => {
  const src = fs.readFileSync(TEST_SH, "utf8");
  // Exactly ONE bare `heavy_op_acquire` call, and it sits inside the is_default_set "$groups" guard
  // immediately before resource_gate_check (串联不合并: 先取令牌、再过闸). A scoped path (--for-task,
  // explicit files, non-default --group) never reaches that branch, so it can never acquire.
  const calls = [...src.matchAll(/^\s*heavy_op_acquire\s*$/gm)];
  assert.equal(calls.length, 1, `expected exactly 1 heavy_op_acquire call, got ${calls.length}`);
  assert.match(
    src,
    /if is_default_set "\$groups"; then\s*\n\s*heavy_op_acquire\s*\n\s*resource_gate_check/,
    "acquire must precede the resource gate inside the default-set guard"
  );
  // The acquire + release reference the token script exactly once each, both inside the guard's
  // function — proof that no scoped branch carries a token call.
  // gap-loop-mechanism-lives-outside-the-package-and-cannot-ship: the token moved to
  // plugin/scripts/, so test.sh's wiring references the new canonical path.
  // gap-the-only-token-waiter-refuses-to-wait-at-all: the acquire passes the BOUNDED wait
  // (HEAVY_OP_ACQUIRE_TIMEOUT_S, default 40), NOT --timeout 0 — a zero wait turns a ≤30s grace
  // window into a failed suite run (AC2/AC4).
  assert.ok(src.match(/bash "\$\{repo_root\}\/plugin\/scripts\/heavy-op-token\.sh" --acquire quay --timeout "\$\{HEAVY_OP_ACQUIRE_TIMEOUT_S\}"/), "default path must acquire the token with the bounded wait bound");
  assert.ok(src.match(/HEAVY_OP_ACQUIRE_TIMEOUT_S="\$\{HEAVY_OP_ACQUIRE_TIMEOUT_S:-40\}"/), "the bounded wait default (40s) must be declared + documented");
  assert.ok(src.match(/bash "\$\{repo_root\}\/plugin\/scripts\/heavy-op-token\.sh" --release quay/), "release must be wired (EXIT trap)");
  // Release is armed as an EXIT trap, so a gate WAIT / build failure / static-check failure /
  // node completion ALL release the token — one WAIT must never hold the cross-project mutex.
  assert.match(src, /trap 'if \[\ "\$\{HEAVY_OP_ACQUIRED:-0\}" = "1" \]; then/, "release must be an EXIT trap keyed on HEAVY_OP_ACQUIRED");
  // The token-held branch runs node as a CHILD (variable concurrency flag), not exec — an exec'd
  // node would replace the shell and silently skip the trap.
  assert.match(src, /node --test --test-concurrency="\$cc"/, "token-held branch must run node as a child (variable concurrency flag)");
  assert.match(src, /if \[\ "\$\{HEAVY_OP_ACQUIRED:-0\}" = "1" \]; then/, "child-vs-exec is gated on HEAVY_OP_ACQUIRED");
  // Nested-runner escape hatch mirrors the resource gate (an inner suite must not re-acquire).
  assert.match(src, /QUAY_TEST_SKIP_RESOURCE_GATE=1 — skipping heavy-op token/, "nested runner must skip the token");
});

// ── AC8: single file, no repo dependency ──────────────────────────────────────────────────────────────
test("AC8 — the token is a single file with no repo dependency: copied to an empty dir it still runs", () => {
  const copyDir = makeTmp("heavy-op-standalone-");
  const stateRoot = makeTmp("heavy-op-state-");
  try {
    const copy = path.join(copyDir, "heavy-op-token.sh");
    fs.copyFileSync(TOKEN, copy);

    let r = spawnSync("bash", [copy, "--root", stateRoot, "--acquire", "quay", "--timeout", "0"], { encoding: "utf8", env: { ...process.env } });
    assert.equal(r.status, 0, `standalone acquire failed:\n${r.stdout}\n${r.stderr}`);
    r = spawnSync("bash", [copy, "--root", stateRoot, "--status"], { encoding: "utf8", env: { ...process.env } });
    assert.equal(r.status, 0, `standalone status failed:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /holder=quay/);
    r = spawnSync("bash", [copy, "--root", stateRoot, "--release", "quay"], { encoding: "utf8", env: { ...process.env } });
    assert.equal(r.status, 0, `standalone release failed:\n${r.stdout}\n${r.stderr}`);
  } finally {
    fs.rmSync(copyDir, { recursive: true, force: true });
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

// ── AC9: temp dirs only, never the real token ─────────────────────────────────────────────────────────
test("AC9 — a full --root cycle never touches the real default token (all helpers pass --root)", () => {
  const realToken = path.join(process.env.HOME, ".quay-global", "heavy-op", "token");
  const existedBefore = fs.existsSync(realToken);
  const root = makeTmp();
  try {
    const a = runToken(["--acquire", "quay", "--timeout", "0"], { root });
    assert.equal(a.status, 0);
    runToken(["--release", "quay"], { root });
    // If the real token did not exist before, a --root cycle must not have created it. (If it DID
    // exist, a concurrent suite owns it — we assert only that OUR cycle leaves it as we found it.)
    assert.equal(fs.existsSync(realToken), existedBefore, "the real token must be untouched by a --root test cycle");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── status dead-holder honesty (tasks/gap-token-status-reports-a-dead-holder-as-busy) ─────────────────
// A --status that reports a dead holder as "busy" is a LYING read: it makes a human arbitrator yield
// to work that is not running (the 19-minute dead-holder tick, 2026-08-03). The status read must:
//   * report holder_alive consistent with kill -0 (AC1/AC2/AC3 — the Contract's band);
//   * stay READ-ONLY — never reclaim, so the token is byte+mtime identical after the read (AC4);
//   * say whether the next --acquire would reclaim per acquire's OWN criteria + give next-step
//     text (AC5);
//   * state that polling --status for a free slot is an INVALID strategy — reclaim is PULL-based,
//     only at --acquire — and give the exact command to run (AC7).
// The file stays `// @test-group engine` (AC10 pin + the token mechanism must run in the default
// full-suite gate; a governance retag would self-skip it and unpin the mechanism — see the AC6
// resolution note in the task body). All tests below are node:test (AC6's node:test half).

test("status — a LIVE holder reports holder_alive=yes (consistent with kill -0) and reclaimable_now=no", () => {
  const root = makeTmp();
  try {
    const tokenPath = path.join(root, "heavy-op", "token");
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    // pid = THIS test process (alive): kill -0 must succeed, so holder_alive must say yes.
    fs.writeFileSync(tokenPath, `holder=liveproj\npid=${process.pid}\nacquired_ms=${Date.now() - 60000}\nlease_expires_ms=${Date.now() + 60000}\nhost=test\n`);
    const r = runToken(["--status"], { root });
    assert.equal(r.status, 0, `status must exit 0:\n${r.all}`);
    assert.match(r.stdout, /holder_alive=yes/, `a live pid must report alive:\n${r.all}`);
    assert.match(r.stdout, /reclaimable_now=no/, "a live holder with a valid lease is not reclaimable");
    assert.doesNotMatch(r.all, /PULL-based/, "no dead-holder advisory for a live holder");
    assert.doesNotMatch(r.all, /is DEAD/, "no dead-holder warning for a live holder");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("status — a DEAD holder reports holder_alive=no and reclaimable_now=yes (stale mtime; per acquire criteria)", () => {
  const root = makeTmp();
  try {
    const tokenPath = path.join(root, "heavy-op", "token");
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, `holder=deadproj\npid=${deadPid()}\nacquired_ms=${Date.now() - 60000}\nlease_expires_ms=${Date.now() + 60000}\nhost=test\n`);
    const past = new Date(Date.now() - 10000);
    fs.utimesSync(tokenPath, past, past); // stale mtime (> HEAVY_OP_STALE_TIMEOUT_S=1)

    const r = runToken(["--status"], { root, env: { HEAVY_OP_STALE_TIMEOUT_S: "1" } });
    assert.equal(r.status, 0, `status must exit 0:\n${r.all}`);
    assert.match(r.stdout, /holder_alive=no/, `a dead pid must report not-alive:\n${r.all}`);
    // AC5: the read must say whether the next acquire would reclaim, per acquire's own criteria.
    assert.match(r.stdout, /reclaimable_now=yes/, "dead pid + stale mtime = reclaimable per acquire criteria");
    // AC3/AC5: the advisory names the dead process + says the next acquire reclaims automatically.
    assert.match(r.stderr, /is DEAD/, "the advisory must name the dead holder");
    assert.match(r.stderr, /next --acquire will reclaim automatically/, "the advisory must give the next-step outcome");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("status — a DEAD holder with a FRESH mtime reports reclaimable_now=no (grace window, not yet per acquire criteria)", () => {
  const root = makeTmp();
  try {
    const tokenPath = path.join(root, "heavy-op", "token");
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, `holder=deadproj\npid=${deadPid()}\nacquired_ms=${Date.now()}\nlease_expires_ms=${Date.now() + 60000}\nhost=test\n`);
    const now = new Date();
    fs.utimesSync(tokenPath, now, now); // fresh mtime
    const r = runToken(["--status"], { root, env: { HEAVY_OP_STALE_TIMEOUT_S: "60" } });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /holder_alive=no/);
    assert.match(r.stdout, /reclaimable_now=no/, "dead pid + fresh mtime = NOT reclaimable yet (the AC2 grace window)");
    assert.match(r.stderr, /NOT yet reclaimable/, "the advisory must say how far from reclaimable");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC4 — --status is READ-ONLY: a dead-held token is byte-identical AND mtime-identical after the read (no reclaim side effect)", () => {
  const root = makeTmp();
  try {
    const tokenPath = path.join(root, "heavy-op", "token");
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, `holder=deadproj\npid=${deadPid()}\nacquired_ms=${Date.now() - 60000}\nhost=test\n`);
    const past = new Date(Date.now() - 10000);
    fs.utimesSync(tokenPath, past, past);
    const before = fs.readFileSync(tokenPath, "utf8");
    const mtimeBefore = fs.statSync(tokenPath).mtimeMs;

    const r = runToken(["--status"], { root, env: { HEAVY_OP_STALE_TIMEOUT_S: "1" } });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /holder_alive=no/);
    assert.ok(fs.existsSync(tokenPath), "a read-only --status must never remove the token (a reclaim would be a write side effect)");
    assert.equal(fs.readFileSync(tokenPath, "utf8"), before, "token content must be unchanged");
    assert.equal(fs.statSync(tokenPath).mtimeMs, mtimeBefore, "token mtime must be unchanged");
    assert.match(r.stdout, /holder=deadproj/, "the read must still report the dead holder (never freed by the read)");
    assert.match(r.stdout, /stale_reclaims=0/, "no reclaim may ever be counted by a read-only status");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC7 — polling --status NEVER frees a dead-held slot (PULL-based reclaim); one --acquire reclaims immediately", () => {
  const root = makeTmp();
  try {
    const tokenPath = path.join(root, "heavy-op", "token");
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    const dead = deadPid();
    fs.writeFileSync(tokenPath, `holder=deadproj\npid=${dead}\nacquired_ms=${Date.now() - 60000}\nhost=test\n`);
    const past = new Date(Date.now() - 10000);
    fs.utimesSync(tokenPath, past, past);
    const env = { HEAVY_OP_STALE_TIMEOUT_S: "1" };

    // N consecutive --status polls: the slot is reclaimable_now=yes, yet it stays held by the dead
    // process EVERY time — proof that polling the status for a free slot is an invalid wait strategy
    // (the reclaim is PULL-based, only at --acquire; the 19:47Z incident's second hop).
    for (let i = 0; i < 3; i++) {
      const s = runToken(["--status"], { root, env });
      assert.equal(s.status, 0, `poll ${i} must exit 0:\n${s.all}`);
      assert.match(s.stdout, /holder=deadproj/, `poll ${i}: the dead holder must still be reported (the read never frees it)`);
      assert.match(s.stdout, /holder_alive=no/, `poll ${i}: must keep reporting the holder dead`);
      assert.match(s.stdout, /reclaimable_now=yes/, `poll ${i}: reclaimable per acquire criteria — but the read alone never reclaims`);
      assert.ok(fs.existsSync(tokenPath), `poll ${i}: the token file must survive the read`);
      // AC7 text: the read must say polling is futile and give the acquire command.
      assert.match(s.stderr, /PULL-based/, `poll ${i}: must state reclaim is pull-based`);
      assert.match(s.stderr, /--acquire <project> --timeout <s>/, `poll ${i}: must give the acquire command`);
    }

    // One real --acquire: reclaims and acquires IMMEDIATELY (waited_ms=0) — no polling needed.
    const a = runToken(["--acquire", "quay", "--timeout", "0"], { root, env });
    assert.equal(a.status, 0, `acquire must succeed immediately:\n${a.all}`);
    assert.match(a.stderr, /RECLAIMED stale token/, "the dead holder must be reclaimed AT the acquire");
    assert.match(a.stdout, /waited_ms=0 holder=quay acquired=yes/, "the acquire must not wait (the slot was already reclaimable)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC10: @test-group engine declaration ─────────────────────────────────────────────────────────────
test("AC10 — `// @test-group engine` is declared (enforced by test-framework-policy-check too)", () => {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  assert.match(src, /^\/\/ @test-group engine$/m);
});
