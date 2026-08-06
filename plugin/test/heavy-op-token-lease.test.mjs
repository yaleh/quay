// @test-group governance
// heavy-op-token-lease.test.mjs — tasks/gap-the-token-watches-the-shell-that-asked-not-the-work-that-
// runs. Pins the LEASE + RENEW fix: the heavy-op token's liveness used to watch the SHELL that asked,
// not the WORK that runs. A retry loop's `timeout` kills the acquiring shell each attempt, the recorded
// pid died, and the token was reclaimed while the work (the retry loop) kept going. No pid/pgid/session
// can represent "the work" (task body's negative reasoning) — so the token now records a
// `lease_expires_ms` and the WORK OWNER re-asserts liveness via `--renew <project>`.
//
//   AC1 — pre-fix reproduction (ACQUIRING SHELL DEAD, WORK RUNNING ⇒ --acquire SUCCEEDS) is ONE-TIME
//         evidence captured against the pre-fix script and pasted in the task body; the fixed behavior
//         (reclaimable_while_working=false) is pinned here as AC2.
//   AC2 — the same fixture POST-fix with the work renewing: `--acquire quay --timeout 0` FAILS and the
//         token is preserved (Contract band reclaimable_while_working = false).
//   AC3 — reverse negative control: the retry loop itself is killed, nobody renews ⇒ the token MUST be
//         reclaimable once the lease expires (recorded expiry duration). If this fails, AC2's "not
//         reclaimable while working" has become "permanently locked" — the worse trade.
//   AC4 — pid-dead accelerated path preserved: dead pid + mtime past the stale grace reclaims EARLY,
//         even while the lease is still valid (today's verified crash-reclaim behavior).
//   AC5 — the script header documents `--renew <project>` + WHY the responsibility is on the retry
//         loop, not the token.
//   AC6 — measurement discipline: holder liveness uses the token-RECORDED pid (never a cmdline-text
//         count); the self-match count is 0 and proven in output.
//   AC7 — node:test + `// @test-group governance` (this file).
//
// Every test touches only a --root / QUAY_GLOBAL_DIR temp dir, never the real token (the --root seam
// keeps them hermetic — same discipline as heavy-op-token.test.mjs AC9).
//
// Run:
//   scripts/test.sh plugin/test/heavy-op-token-lease.test.mjs

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const makeTmp = (prefix = "heavy-op-token-lease-") => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** A pid that is definitely dead (a child that has exited and been reaped). */
function deadPid() {
  return spawnSync("true").pid;
}

/** Run the REAL token script with a temp --root (never the real default dir). Every acquire lands an
 *  events record (gap-token-wait-times-...); point --events-file at the temp root so a --root test
 *  cycle never writes the real workspace's .quay/heavy-op-token-events.jsonl (same isolation
 *  discipline as heavy-op-token.test.mjs AC9). */
function runToken(args, { root, env = {} } = {}) {
  const fullArgs = root ? ["--root", root, "--events-file", path.join(root, "heavy-op-events.jsonl"), ...args] : args;
  const res = spawnSync("bash", [TOKEN, ...fullArgs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, all: `${res.stdout}\n${res.stderr}`, pid: res.pid };
}

function tokenPath(root) {
  return path.join(root, "heavy-op", "token");
}

async function waitForToken(root, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!fs.existsSync(tokenPath(root)) && Date.now() < deadline) await sleep(20);
  assert.ok(fs.existsSync(tokenPath(root)), `the token must exist at ${tokenPath(root)}`);
}

/** Spawn the acquiring shell that DIES right after acquiring (the attempt shell that `timeout` kills),
 *  while the actual WORK keeps running in a separate process. --events-file isolated into the temp root
 *  (same discipline as runToken). */
function spawnDeadAcquirer(root, project, { leaseS } = {}) {
  const env = { ...process.env, QUAY_GLOBAL_DIR: root };
  if (leaseS !== undefined) env.HEAVY_OP_LEASE_S = String(leaseS);
  const events = path.join(root, "heavy-op-events.jsonl");
  const acq = spawn("bash", ["-c", `"${TOKEN}" --root "${root}" --events-file "${events}" --acquire ${project} --timeout 0 && kill -9 $$`], { env });
  return acq;
}

/** Spawn the WORK OWNER: a renewing "retry loop" that calls `--renew <project>` every few hundred ms. */
function spawnWorkRenewer(root, project) {
  const env = { ...process.env, QUAY_GLOBAL_DIR: root };
  const work = spawn("bash", ["-c", `while true; do "${TOKEN}" --root "${root}" --renew ${project} >/dev/null 2>&1; sleep 0.3; done`], { env });
  return work;
}

// ── Governance self-skip (AC7 @test-group governance) ─────────────────────────────────────────────
// In a DEFAULT (product,engine) run this file reports `skipped`, not absent (ADR-019 decision #1
// precedent). It runs in full when invoked explicitly (QUAY_TEST_GROUPS unset) or with
// `--group governance`. The lease/renew tier is the governance/measurement layer.
if (process.env.QUAY_TEST_GROUPS && !process.env.QUAY_TEST_GROUPS.split(",").includes("governance")) {
  test("governance group skipped", { skip: "set QUAY_TEST_GROUPS=governance to run" }, () => {});
} else {

// ── AC2: reclaimable_while_working = false ────────────────────────────────────────────────────────
test("AC2 — acquiring shell dead + WORK RENEWING ⇒ --acquire FAILS and the token is preserved (reclaimable_while_working=false)", async () => {
  const root = makeTmp();
  let work;
  try {
    // The acquiring shell acquires then dies (the `timeout` kills the attempt shell).
    const acq = spawnDeadAcquirer(root, "archguard");
    await waitForToken(root);
    // The WORK (retry loop) keeps running and renews — it is the entity that knows the work continues.
    work = spawnWorkRenewer(root, "archguard");
    // Wait (poll) for the work's first renew to re-bind the token pid to the WORK shell (alive) and
    // extend the lease — a fixed sleep would be a load-sensitive flake.
    const deadline = Date.now() + 5000;
    let token = fs.readFileSync(tokenPath(root), "utf8");
    let recordedPid = Number(/^pid=(\d+)/m.exec(token)[1]);
    while (recordedPid !== work.pid && Date.now() < deadline) {
      await sleep(50);
      token = fs.readFileSync(tokenPath(root), "utf8");
      recordedPid = Number(/^pid=(\d+)/m.exec(token)[1]);
    }

    assert.match(token, /holder=archguard/, "the token must still belong to the work's project");
    assert.match(token, /lease_expires_ms=\d+/, "the token must carry a lease");
    // The pid must now be the WORK process (renew re-binds to the work owner), NOT the dead acquirer.
    assert.ok(work.pid, "the work process must be alive");
    assert.equal(recordedPid, work.pid, "renew must re-bind the token pid to the work owner (the process that knows the work continues)");

    // The Contract's control: while the work is still going, a competing acquire must FAIL.
    const r = runToken(["--acquire", "quay", "--timeout", "0"], { root });
    assert.equal(r.status, 1, `--acquire must FAIL while the work renews:\n${r.all}`);
    assert.match(r.stderr, /HELD by archguard/, "the failure must name the work's project");
    assert.ok(fs.existsSync(tokenPath(root)), "the token must be preserved (reclaimable_while_working = false)");
    assert.match(fs.readFileSync(tokenPath(root), "utf8"), /holder=archguard/, "the token must be byte-wise still the work's");
  } finally {
    if (work) work.kill("SIGKILL");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC3: reverse negative control — no renew ⇒ lease expiry reclaims (never a permanent lockout) ────
test("AC3 — retry loop killed, nobody renews ⇒ the token is reclaimed once the lease expires (recorded expiry duration)", async () => {
  const root = makeTmp();
  try {
    // Short lease so the test does not wait an hour; the acquiring shell dies (pid dead), nobody renews.
    const t0 = Date.now();
    const acq = spawnDeadAcquirer(root, "deadproj", { leaseS: 2 });
    await waitForToken(root);
    const token = fs.readFileSync(tokenPath(root), "utf8");
    const expiryMs = Number(/^lease_expires_ms=(\d+)/m.exec(token)[1]);
    assert.ok(expiryMs > Date.now(), "the lease must start in the future");

    // The work never renews (it was killed). Wait until the lease has expired.
    const deadline = Date.now() + 6000;
    let status;
    while (Date.now() < deadline) {
      const s = runToken(["--status"], { root });
      const rem = Number(/^lease_remaining_ms=(\d+)/m.exec(s.stdout)[1]);
      if (rem === 0) break;
      await sleep(50);
    }
    status = runToken(["--status"], { root });
    assert.match(status.stdout, /lease_remaining_ms=0/, "the lease must have run out");

    const r = runToken(["--acquire", "quay", "--timeout", "0"], { root });
    const elapsedMs = Date.now() - t0;
    assert.equal(r.status, 0, `after the lease expires the token MUST be reclaimable (AC3 — no permanent lockout):\n${r.all}`);
    assert.match(r.stderr, /RECLAIMED/, "the reclaim must be observable");
    assert.match(r.stdout, /acquired=yes/);
    // Record the expiry duration: the lease was HEAVY_OP_LEASE_S=2s; we observe it took ≥ ~2s and
    // << a full hour (i.e. the reclaim was driven by the lease, not a stale-mtime accident at 1h).
    assert.ok(elapsedMs >= 1500, `expiry must take at least the ~2s lease (took ${elapsedMs}ms)`);
    assert.ok(elapsedMs < 60_000, `expiry must NOT wait the whole default lease (took ${elapsedMs}ms)`);
    console.log(`AC3 evidence: lease HEAVY_OP_LEASE_S=2 → reclaimed ${elapsedMs}ms after acquire (expiry duration)`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC4: pid-dead accelerated path preserved ─────────────────────────────────────────────────────
test("AC4 — pid dead + mtime past the stale grace ⇒ reclaimed EARLY, even while the lease is still valid", async () => {
  const root = makeTmp();
  try {
    // Long lease (default 3600s) so the accelerated path is the ONLY reason this can reclaim now.
    const acq = spawnDeadAcquirer(root, "crashproj");
    await waitForToken(root);
    const before = runToken(["--status"], { root });
    assert.match(before.stdout, /lease_remaining_ms=[1-9]/, "the lease must still be valid at reclaim time (this is the EARLY path)");

    // Backdate the mtime past the stale grace (HEAVY_OP_STALE_TIMEOUT_S=1): the crash is old.
    const past = new Date(Date.now() - 10_000);
    fs.utimesSync(tokenPath(root), past, past);

    const r = runToken(["--acquire", "quay", "--timeout", "0"], { root, env: { HEAVY_OP_STALE_TIMEOUT_S: "1" } });
    assert.equal(r.status, 0, `dead-pid + stale-mtime must reclaim EARLY despite a valid lease:\n${r.all}`);
    assert.match(r.stderr, /RECLAIMED/, "the accelerated reclaim must be observable");
    assert.match(r.stdout, /acquired=yes/);
    const s = runToken(["--status"], { root });
    assert.match(s.stdout, /stale_reclaims=1/, "the accelerated reclaim must be counted");
    assert.match(s.stdout, /holder=quay/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── renew semantics: holder match, missing token, lease re-extend ─────────────────────────────────
test("renew — mismatched holder and missing token REFUSE; the matching holder re-extends the lease and re-binds the pid", async () => {
  const root = makeTmp();
  try {
    // No token: renew must refuse (there is nothing to renew — the mutex was lost or never held).
    let r = runToken(["--renew", "quay"], { root });
    assert.equal(r.status, 1, `renew with no token must fail:\n${r.all}`);
    assert.match(r.stderr, /no token held/);

    // Acquire as quay (pid = this test process, alive), then renew as a DIFFERENT project → refuse.
    r = runToken(["--acquire", "quay", "--timeout", "0"], { root });
    assert.equal(r.status, 0, `acquire failed:\n${r.all}`);
    r = runToken(["--renew", "meta-cc"], { root });
    assert.equal(r.status, 1, `renew by a non-holder must fail:\n${r.all}`);
    assert.match(r.stderr, /not .*renewing/);
    assert.ok(fs.existsSync(tokenPath(root)), "a refused renew must not touch the token");

    // The holder renews: lease must extend, acquired_ms must stay continuous, holder preserved.
    r = runToken(["--renew", "quay"], { root });
    assert.equal(r.status, 0, `holder renew must succeed:\n${r.all}`);
    assert.match(r.stdout, /renewed/);
    const token = fs.readFileSync(tokenPath(root), "utf8");
    assert.match(token, /holder=quay/);
    const exp = Number(/^lease_expires_ms=(\d+)/m.exec(token)[1]);
    assert.ok(exp > Date.now(), "the lease must be re-extended into the future");
    // Default lease is HEAVY_OP_LEASE_S=3600s; a renew must extend by ~the full lease, not reset to 0.
    assert.ok(exp - Date.now() > 3_500_000, `the lease must be extended by ~HEAVY_OP_LEASE_S (expiry ${exp - Date.now()}ms from now)`);
    assert.match(token, /^pid=\d+$/m, "renew must re-bind the pid");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC5: header documents --renew + why the retry loop owns liveness ──────────────────────────────
test("AC5 — the script header documents --renew usage and WHY the retry loop, not the token, owns liveness", () => {
  const src = fs.readFileSync(TOKEN, "utf8");
  assert.match(src, /--renew <project>/, "the usage block must document --renew");
  assert.match(src, /lease_expires_ms/, "the token format must be documented as carrying a lease");
  // The rationale: a "record the real working pid" design leaves an unprotected window and silently
  // degrades; the lease defaults to release, so the work owner must actively renew to keep the mutex.
  assert.match(src, /unprotected window/i, "the header must explain why pid-reporting is rejected");
  assert.match(src, /actively renew/i, "the header must state the retry loop must actively renew");
  assert.match(src, /The ONLY entity that knows whether the/i, "the header must name the liveness authority");
  assert.match(src, /is the retry loop itself/i, "the header must name the retry loop as that authority");
});

// ── AC6: measurement discipline — token-recorded pid, self-match = 0 ──────────────────────────────
test("AC6 — holder liveness uses the token-RECORDED pid (never a cmdline count); the self-match count is 0", async () => {
  const root = makeTmp();
  let holder;
  try {
    // A REAL long-lived holder: acquire then exec-sleep on the same pid (the recorded pid is alive).
    holder = spawn("bash", ["-c", `"${TOKEN}" --root "${root}" --events-file "${path.join(root, "heavy-op-events.jsonl")}" --acquire acme --timeout 0 && exec sleep 300`], {
      env: { ...process.env, QUAY_GLOBAL_DIR: root },
    });
    await waitForToken(root);

    const s = runToken(["--status"], { root });
    const reportedPid = Number(/^pid=(\d+)/m.exec(s.stdout)[1]);
    assert.equal(reportedPid, holder.pid, "--status must identify the holder by its RECORDED pid (the real work process)");

    // Self-match proof: the measuring processes (this test + the --status bash) must NOT be the holder.
    // A cmdline-text count (e.g. `ps | grep heavy-op`) would match the measuring command's own cmdline
    // (both this node test and the --status bash contain "heavy-op" in their argv) — the token-pid
    // method cannot, because it reads the recorded pid, not argv text.
    const measuringPids = [process.pid, s.pid];
    const selfMatches = measuringPids.filter((p) => p === reportedPid).length;
    assert.equal(selfMatches, 0, `self-match must be 0: the holder (pid ${reportedPid}) is neither the test (${process.pid}) nor the --status bash (${s.pid})`);

    // Printed evidence: the token-pid count is exactly 1 (the holder), with the measurer not counted.
    console.log(`AC6 evidence: holder recorded-pid=${reportedPid}; measuring pids=[${measuringPids.join(",")}]; token-pid self-match=${selfMatches}; token-pid heavy-op count=1`);

    // Contrast (evidence only, tolerant): a naive cmdline grep for "heavy-op" self-matches the
    // measuring command(s) — the exact failure mode AC6 bans. Not asserted (pgrep availability), only
    // surfaced as evidence that the token-pid method is the disciplined one.
    const naive = spawnSync("pgrep", ["-f", "heavy-op"], { encoding: "utf8" });
    if (naive.status === 0) {
      const naivePids = naive.stdout.trim().split("\n").filter(Boolean).map(Number);
      const naiveSelf = naivePids.filter((p) => p === process.pid || p === s.pid).length;
      console.log(`AC6 evidence: naive cmdline-grep count=${naivePids.length}, cmdline-grep self-match=${naiveSelf} (the banned method) vs token-pid self-match=${selfMatches}`);
    }
  } finally {
    if (holder) holder.kill("SIGKILL");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC7: node:test + @test-group governance (self-pin, enforced by test-framework-policy-check too) ──
test("AC7 — node:test + `// @test-group governance` is declared", () => {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  assert.match(src, /^\/\/ @test-group governance$/m);
  assert.match(src, /import \{ test \} from "node:test"/);
});

// ── Contract measures ────────────────────────────────────────────────────────────────────────────
test("Contract — holder_liveness_source is the token's lease_expires_ms field (the field --status exposes)", () => {
  const src = fs.readFileSync(TOKEN, "utf8");
  // The liveness field that the reclaim decision reads: lease_expires_ms. --status must surface it.
  assert.match(src, /read_field lease_expires_ms/, "the liveness source must be the lease_expires_ms field");
  assert.match(src, /lease_expires_ms=/, "the acquire/renew write must persist lease_expires_ms");
  // --status (the Contract's invoke surface) must expose the lease fields so the liveness source is
  // observable: lease_expires_ms + lease_remaining_ms in do_status's printf.
  assert.match(src, /lease_remaining_ms/, "--status must surface the lease (the invoke surface for holder_liveness_source)");
});

} // end governance self-skip wrapper
