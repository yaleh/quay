// @test-group governance
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
//   AC10 — `// @test-group governance` declaration (enforced by test-framework-policy-check too)
//
//   gap-the-token-watches-the-shell-that-asked-not-the-work-that-runs (lease) adds:
//   L-AC1 — pre-fix reproduction: a token whose recorded pid is dead + mtime stale is reclaimed
//           (the "acquiring shell killed but work still running" fixture) — see the task body for
//           the real pre-fix run; here we pin the POST-fix behavior for each branch.
//   L-AC2 — killed acquiring shell + RENEW ongoing ⇒ --acquire FAILS, token preserved (renew from a
//           DIFFERENT shell refreshes pid to the live loop shell + lease + mtime).
//   L-AC3 — negative control: retry loop killed (dead pid), no renewal ⇒ after lease expiry the
//           token IS reclaimable (no permanent lockout); --renew by a NON-holder fails.
//   L-AC4 — pid-death accelerated path preserved: dead pid + stale mtime + ACTIVE lease ⇒ still
//           reclaimed early (crash recovery, not after the full lease).
//   L-AC5 — a pre-lease token (no lease_expires_ms field) still behaves like today: dead pid +
//           stale mtime ⇒ reclaimed; dead pid + fresh mtime ⇒ HELD.
//   L-AC6 — the lease is written on acquire and refreshed by renew (lease_expires_ms advances);
//           --status exposes lease_remaining_s; holder-liveness source is the lease_expires_ms field.
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
  // Every acquire lands a JSONL record (gap-the-token-measures-the-wait-and-throws-it-away); the
  // default events file is $QUAY_GLOBAL_DIR/heavy-op/events.jsonl — --root redirects it into the test
  // root, and --events-file is still passed as belt-and-suspenders so a --root test cycle never
  // touches the real default events file (same isolation discipline as AC9's "never touch the real
  // default token").
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
  // gap-the-token-watches-the-shell-that-asked-not-the-work-that-runs: the acquire ALSO passes an
  // explicit --lease (HEAVY_OP_LEASE_S, default 3600) — test.sh is a SINGLE-SHOT holder (its own
  // shell runs the suite, so pid IS the work and an alive pid protects the token), and the caller-
  // responsibility contract is: a holder that neither renews nor declares a lease >= its hold time
  // can be reclaimed at lease expiry.
  assert.ok(src.match(/bash "\$\{repo_root\}\/plugin\/scripts\/heavy-op-token\.sh" --acquire quay --timeout "\$\{HEAVY_OP_ACQUIRE_TIMEOUT_S\}" --lease "\$\{HEAVY_OP_LEASE_S\}"/), "default path must acquire the token with the bounded wait bound + an explicit single-shot lease");
  assert.ok(src.match(/HEAVY_OP_ACQUIRE_TIMEOUT_S="\$\{HEAVY_OP_ACQUIRE_TIMEOUT_S:-40\}"/), "the bounded wait default (40s) must be declared + documented");
  assert.ok(src.match(/HEAVY_OP_LEASE_S="\$\{HEAVY_OP_LEASE_S:-3600\}"/), "the single-shot holder lease default (3600s) must be declared + documented");
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

// ── AC10: @test-group governance declaration ─────────────────────────────────────────────────────────
test("AC10 — `// @test-group governance` is declared (enforced by test-framework-policy-check too)", () => {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  assert.match(src, /^\/\/ @test-group governance$/m);
});

// ── gap-the-token-watches-the-shell-that-asked-not-the-work-that-runs: LEASE ─────────────────────────
// The token's liveness used to be "is the pid that ACQUIRED it alive" — which a retry loop breaks:
// each `timeout 590 …` attempt kills its own acquiring shell, so the recorded pid dies while the
// work continues in a NEW shell, and another project could reclaim the token mid-work. The fix makes
// the liveness signal the LEASE (`lease_expires_ms`), refreshed ONLY by `--renew <project>` — the one
// entity that KNOWS the work is still going: the retry loop. pid-death is kept as an ACCELERATED
// release (crash recovery), never the deciding signal. See the task body's negative reasoning:
// pid/pgid/session were all DISPROVEN as "the work".
//
// L-AC1 (pre-fix reproduction is in the task body): a DEAD-pid STALE-mtime token is reclaimed even
// with an ACTIVE lease — this is the accelerated release, and it is also exactly what the OLD code
// did (the bug: it reclaimed the SAME fixture with no lease concept at all).

test("L-AC1 — a dead-pid stale-mtime token is reclaimed (accelerated release; the pre-fix fixture)", () => {
  const root = makeTmp();
  try {
    const tokenPath = path.join(root, "heavy-op", "token");
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    const leaseFuture = Date.now() + 600000; // lease ACTIVE for 10 more minutes
    fs.writeFileSync(tokenPath, `holder=archguard\npid=${deadPid()}\nacquired_ms=${Date.now() - 120000}\nlease_expires_ms=${leaseFuture}\nhost=test\n`);
    const past = new Date(Date.now() - 120000);
    fs.utimesSync(tokenPath, past, past);

    const r = runToken(["--acquire", "quay", "--timeout", "0"], { root });
    assert.equal(r.status, 0, `dead pid + stale mtime + active lease must be reclaimed via the accelerated path:\n${r.all}`);
    assert.match(r.stderr, /accelerated release/);
    assert.match(r.stdout, /acquired=yes/);
    const s = runToken(["--status"], { root });
    assert.match(s.stdout, /stale_reclaims=1/, "the accelerated reclaim must be counted");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// L-AC2 — the fixture from the task: the ACQUIRING shell is killed, but the retry loop is still
// running and RENEWS. The renew comes from a DIFFERENT shell (a new attempt), so it re-records pid
// to the live loop shell + refreshes lease + mtime. quay --acquire must FAIL and the token must be
// preserved — the whole point of the fix.
test("L-AC2 — killed acquiring shell + renewal ongoing ⇒ --acquire FAILS, token preserved (retry loop keeps the token)", async () => {
  const root = makeTmp();
  const tokenPath = path.join(root, "heavy-op", "token");
  let holder;
  try {
    // The acquiring shell (the attempt) acquires as archguard, then gets killed — the recorded pid
    // dies. The retry loop (a DIFFERENT process, still alive) then renews.
    holder = spawn("bash", ["-c", `"${TOKEN}" --root "${root}" --acquire archguard --timeout 0 --lease 5 && sleep 1000`]);
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(tokenPath) && Date.now() < deadline) await sleep(20);
    assert.ok(fs.existsSync(tokenPath), "the acquiring shell must hold the token before it is killed");

    holder.kill("SIGKILL");
    await sleep(80);
    assert.ok(fs.existsSync(tokenPath), "killing the acquiring shell must NOT delete the token (that is the bug)");

    // The retry loop renews from THIS test process (a different, alive shell).
    const renew = runToken(["--renew", "archguard"], { root });
    assert.equal(renew.status, 0, `renew must succeed from the loop shell:\n${renew.all}`);
    const recPid = fs.readFileSync(tokenPath, "utf8").split("\n").find((l) => l.startsWith("pid=")).split("=")[1];
    assert.equal(recPid, String(process.pid), "renew must re-record pid to the RENEWING (live loop) shell, not the dead acquiring shell");

    const r = runToken(["--acquire", "quay", "--timeout", "0"], { root });
    assert.equal(r.status, 1, `quay must FAIL to acquire while archguard's retry loop is renewing:\n${r.all}`);
    assert.match(r.stderr, /HELD by archguard/, "the holder must still be archguard");
    assert.ok(fs.existsSync(tokenPath), "the token must be preserved byte-for-byte through the failed acquire");
    assert.match(fs.readFileSync(tokenPath, "utf8"), /^holder=archguard$/m, "holder must be untouched");
  } finally {
    if (holder) holder.kill("SIGKILL");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// L-AC3 — negative control (no permanent lockout): the retry loop is killed (its recorded pid is
// dead) and NOBODY renews ⇒ once the lease expires the token MUST be reclaimable. Without this, the
// fix would trade "wrongly released" for "permanently locked" — a worse deal (task AC3).
test("L-AC3 — negative control: retry loop dead + no renewal ⇒ lease expiry reclaims (no permanent lockout)", async () => {
  const root = makeTmp();
  const tokenPath = path.join(root, "heavy-op", "token");
  try {
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    // Simulate a token as a retry loop left it right before dying: recorded pid DEAD (loop killed),
    // lease about to expire in ~1.5s. acquired_ms in the past.
    const now = Date.now();
    const dead = deadPid();
    fs.writeFileSync(tokenPath, `holder=archguard\npid=${dead}\nacquired_ms=${now - 60000}\nlease_expires_ms=${now + 1500}\nhost=test\n`);

    // Just before expiry: --acquire must FAIL (lease still active, mtime fresh → no accelerated path).
    const before = runToken(["--acquire", "quay", "--timeout", "0"], { root });
    assert.equal(before.status, 1, `before lease expiry the token must still be held:\n${before.all}`);
    assert.match(before.stderr, /lease ACTIVE/);

    // Renew by a NON-holder must fail (archguard's work cannot be renewed by quay).
    const wrong = runToken(["--renew", "quay"], { root });
    assert.equal(wrong.status, 1, `a non-holder must not be able to renew:\n${wrong.all}`);
    assert.match(wrong.stderr, /held by archguard, not quay/);

    // Wait out the lease.
    const t0 = Date.now();
    await sleep(2000);
    const expiryMs = Date.now() - t0;

    // After expiry: --acquire MUST reclaim. Record the expiry duration (task AC3 "记录到期耗时").
    const after = runToken(["--acquire", "quay", "--timeout", "0"], { root });
    assert.equal(after.status, 0, `after lease expiry the token MUST be reclaimable (waited ${expiryMs}ms):\n${after.all}`);
    assert.match(after.stderr, /EXPIRED lease/);
    assert.match(after.stdout, /acquired=yes/);
    console.log(`L-AC3 expiry-reclaim evidence: lease was ${now + 1500 - Date.now()}ms-in-the-future at setup; reclaimed after expiry (elapsed ${expiryMs}ms)`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// L-AC4 — the pid-death ACCELERATED path is preserved: dead pid + stale mtime ⇒ reclaimed EARLY,
// even though the lease is still active. This is crash recovery (kill -9 the holder → the other side
// reclaims in ~STALE_TIMEOUT_S, not after the full lease).
test("L-AC4 — dead pid + stale mtime + ACTIVE lease ⇒ still reclaimed early (accelerated crash recovery)", () => {
  const root = makeTmp();
  try {
    const tokenPath = path.join(root, "heavy-op", "token");
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    const leaseFuture = Date.now() + 600000; // lease NOT expired — the accelerated path must win anyway
    fs.writeFileSync(tokenPath, `holder=archguard\npid=${deadPid()}\nacquired_ms=${Date.now() - 120000}\nlease_expires_ms=${leaseFuture}\nhost=test\n`);
    const past = new Date(Date.now() - 120000);
    fs.utimesSync(tokenPath, past, past);

    const r = runToken(["--acquire", "quay", "--timeout", "0"], { root });
    assert.equal(r.status, 0, `dead pid + stale mtime must be reclaimed BEFORE lease expiry:\n${r.all}`);
    assert.match(r.stderr, /accelerated release/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// L-AC5 — backward compat: a token written by the PRE-lease script (no lease_expires_ms field) must
// behave exactly like today: dead pid + stale mtime ⇒ reclaimed; dead pid + fresh mtime ⇒ HELD.
test("L-AC5 — a pre-lease token (no lease_expires_ms) still behaves like today (dead+stale reclaims; dead+fresh held)", () => {
  const root = makeTmp();
  try {
    const tokenPath = path.join(root, "heavy-op", "token");
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    // Dead pid + stale mtime, NO lease field → accelerated reclaim (same as pre-lease).
    fs.writeFileSync(tokenPath, `holder=archguard\npid=${deadPid()}\nacquired_ms=${Date.now() - 120000}\nhost=test\n`);
    const past = new Date(Date.now() - 120000);
    fs.utimesSync(tokenPath, past, past);
    let r = runToken(["--acquire", "quay", "--timeout", "0"], { root });
    assert.equal(r.status, 0, `pre-lease dead+stale token must be reclaimed:\n${r.all}`);

    // Dead pid + FRESH mtime, NO lease field → HELD (the mtime guard protects a freshly-crashed holder).
    fs.writeFileSync(tokenPath, `holder=archguard\npid=${deadPid()}\nacquired_ms=${Date.now()}\nhost=test\n`);
    const now = new Date();
    fs.utimesSync(tokenPath, now, now);
    r = runToken(["--acquire", "quay", "--timeout", "0"], { root, env: { HEAVY_OP_STALE_TIMEOUT_S: "5" } });
    assert.equal(r.status, 1, `pre-lease dead+fresh token must be HELD:\n${r.all}`);
    assert.match(r.stderr, /mtime only \d+s old/);
    assert.ok(fs.existsSync(tokenPath), "the pre-lease held token must be preserved");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// L-AC6 — the lease field is the holder-liveness SOURCE (contract measure holder_liveness_source):
// --acquire writes lease_expires_ms; --renew ADVANCES it (now + LEASE_S each call); --status exposes
// lease_remaining_s so a reader can SEE the liveness source without guessing processes.
test("L-AC6 — lease written on acquire, advanced by renew, exposed by --status (lease is the liveness source)", () => {
  const root = makeTmp();
  try {
    const a = runToken(["--acquire", "quay", "--timeout", "0", "--lease", "300"], { root });
    assert.equal(a.status, 0, `acquire failed:\n${a.all}`);
    const tokenText = fs.readFileSync(path.join(root, "heavy-op", "token"), "utf8");
    assert.match(tokenText, /^lease_expires_ms=\d+$/m, "acquire must write lease_expires_ms");
    const exp1 = Number(tokenText.match(/^lease_expires_ms=(\d+)$/m)[1]);
    assert.ok(exp1 > Date.now(), "the initial lease must be in the future");

    const s = runToken(["--status"], { root });
    assert.equal(s.status, 0);
    assert.match(s.stdout, /lease_expires_ms=\d+/);
    const rem = Number(s.stdout.match(/lease_remaining_s=(\d+)/)[1]);
    assert.ok(rem > 250 && rem <= 300, `lease_remaining_s must reflect the 300s lease (got ${rem})`);

    // Renew advances the expiry by LEASE_S (a fresh 300s from now, strictly > the previous expiry).
    const renew = runToken(["--renew", "quay"], { root });
    assert.equal(renew.status, 0, `renew failed:\n${renew.all}`);
    const exp2 = Number(fs.readFileSync(path.join(root, "heavy-op", "token"), "utf8").match(/^lease_expires_ms=(\d+)$/m)[1]);
    assert.ok(exp2 > exp1, `renew must advance lease_expires_ms (${exp1} -> ${exp2})`);

    // The events landing (sibling task) is untouched by the lease: a renew must NOT land a new event
    // record, and the acquire DID land one (runToken redirects events to $root/heavy-op-events.jsonl).
    const ev = path.join(root, "heavy-op-events.jsonl");
    if (fs.existsSync(ev)) {
      const records = fs.readFileSync(ev, "utf8").trim().split("\n").filter(Boolean);
      assert.equal(records.length, 1, "only the acquire (not the renew) may land an ACQUIRED event");
    }
    runToken(["--release", "quay"], { root });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// L-AC7 — the caller change is ONE LINE: the retry loop calls `--renew <project>` between attempts.
// The script header documents the integration point and WHY the responsibility is on the loop (it is
// the only entity that knows the work continues) — AC5 of the task. Pinned structurally here.
test("L-AC7 — the script header documents --renew + why the retry loop owns liveness (AC5)", () => {
  const src = fs.readFileSync(TOKEN, "utf8");
  assert.match(src, /--renew <project>/, "the usage line must document --renew");
  assert.match(src, /renew <project>/i);
  assert.match(src, /lease_expires_ms/, "the lease field must be documented");
  assert.match(src, /retry loop/, "the header must name the retry loop as the renewing entity");
  assert.match(src, /gap-the-token-watches-the-shell-that-asked-not-the-work-that-runs/, "the header must cite the task id");
  // AC6 of the task: "how many heavy ops are running" must NOT be judged by cmdline-text counting.
  // The script itself must not count cmdlines; the token's OWN recorded pid/lease is the source.
  assert.doesNotMatch(src, /pgrep -f|ps -ef.*grep|ps aux.*grep/, "no cmdline-text process matching in the token script");
});
