// @test-group governance
// heavy-op-token-wait.test.mjs — tasks/gap-the-only-token-waiter-refuses-to-wait-at-all. Pins the
// BOUNDED-WAIT fix for the one real heavy-op token waiter. The defect (rewritten + corrected in the
// task body): scripts/test.sh acquired with `--timeout 0` (ZERO wait), so a ≤30s transient grace
// window — a crashed holder's token aged less than HEAVY_OP_STALE_TIMEOUT_S, therefore not yet
// reclaimable — became a FAILED full-suite run, and the reader was misled into investigating
// cross-project contention instead of waiting 30 seconds. The fix is NOT token fairness redesign
// (the manager's two real measurements overturned that: mtime 292s reclaims instantly; only 2 of 12
// attempts died on the token) — it is giving the one real waiter a BOUNDED wait.
//
//   AC1 — retry semantics first: `--acquire --timeout N` must LOOP (re-check reclaim each second),
//         not decide once — otherwise changing test.sh's bound is "exists but does not take effect".
//   AC2 — positive: dead-pid holder + fresh-ish mtime ⇒ acquire WAITS, reclaims once stale, and the
//         suite proceeds with waited_ms > 0.
//   AC3 — negative control (MUST pass before AC2 counts): a LIVE long-running holder ⇒ the bounded
//         timeout still FAILS and the token is NEVER reclaimed/stolen — "refusing to wait" must not
//         become "stealing someone's running heavy op".
//   AC4 — upper bound: the wait bound is documented in scripts/test.sh's header with a justification
//         for why it is LESS than a real heavy op's duration (never serializes).
//   AC5 — failure message: when the holder is DEAD, the message must say holder dead + how long
//         waited + how far from reclaimable — not a generic "held by another project".
//   AC6 — node:test + `// @test-group governance` (this file).
//
// Every test touches only a --root / QUAY_GLOBAL_DIR temp dir, never the real token (the --root
// seam keeps them hermetic — same discipline as heavy-op-token.test.mjs AC9).
//
// Run:
//   scripts/test.sh plugin/test/heavy-op-token-wait.test.mjs

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
const makeTmp = (prefix = "heavy-op-token-wait-") => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** A pid that is definitely dead (a child that has exited and been reaped). */
function deadPid() {
  return spawnSync("true").pid;
}

/** Run the REAL token script with a temp --root (never the real default dir). */
function runToken(args, { root, env = {} } = {}) {
  const fullArgs = root ? ["--root", root, ...args] : args;
  const res = spawnSync("bash", [TOKEN, ...fullArgs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, all: `${res.stdout}\n${res.stderr}` };
}

/** Write a token file with the given holder/pid and a FRESH mtime (refresh it explicitly). */
function writeToken(root, { holder, pid, mtimeMs = Date.now() }) {
  const tokenPath = path.join(root, "heavy-op", "token");
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(tokenPath, `holder=${holder}\npid=${pid}\nacquired_ms=${mtimeMs}\nhost=test\n`);
  const when = new Date(mtimeMs);
  fs.utimesSync(tokenPath, when, when); // robustness: under load the write→acquire gap can age a "fresh" mtime
  return tokenPath;
}

/** Spawn a REAL holder: acquires the token, then exec-sleeps on the SAME pid (killable). */
function spawnHolder(root, { stale = "1", project = "quay" } = {}) {
  const env = { ...process.env, QUAY_GLOBAL_DIR: root, HEAVY_OP_STALE_TIMEOUT_S: stale };
  return spawn("bash", ["-c", `"${TOKEN}" --acquire ${project} --timeout 0 && exec sleep 1000`], { env });
}

// ── Governance self-skip (AC6 @test-group governance) ─────────────────────────────────────────────
// In a DEFAULT (product,engine) run this file reports `skipped`, not absent (ADR-019 decision #1
// precedent). It runs in full when invoked explicitly (QUAY_TEST_GROUPS unset) or with
// `--group governance`.
if (process.env.QUAY_TEST_GROUPS && !process.env.QUAY_TEST_GROUPS.split(",").includes("governance")) {
  test("governance group skipped", { skip: "set QUAY_TEST_GROUPS=governance to run" }, () => {});
} else {

// ── AC1: retry semantics — --timeout N LOOPS, it does not decide once ───────────────────────────────
test("AC1 — --acquire --timeout N retries within the window: a live holder is polled, not decided once", async () => {
  const root = makeTmp();
  let holder;
  try {
    holder = spawnHolder(root);
    const tokenPath = path.join(root, "heavy-op", "token");
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(tokenPath) && Date.now() < deadline) await sleep(20);
    assert.ok(fs.existsSync(tokenPath), "the holder must have acquired the token");

    const r = runToken(["--acquire", "meta-cc", "--timeout", "2"], { root });
    // Bounded poll: waited the FULL window, re-checking each second.
    assert.equal(r.status, 1, `must fail while the live holder holds:\n${r.all}`);
    assert.match(r.stdout, /waited_ms=2000 acquired=no/, "the poll must last the full window");
    // The per-second "still waiting" lines prove it LOOPED rather than deciding once.
    assert.match(r.stderr, /token held — waited 1s/, "iteration 1 must re-check");
    assert.match(r.stderr, /token held — waited 2s/, "iteration 2 must re-check");
    assert.ok(fs.existsSync(tokenPath), "a live holder's token must never be removed");
    assert.match(r.stderr, /ALIVE/, "the final reason must name the holder as alive");
  } finally {
    if (holder) holder.kill("SIGKILL");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC2: positive — dead pid + fresh-ish mtime ⇒ wait, reclaim once stale, acquire ────────────────────
test("AC2 — a DEAD-pid holder with a fresh mtime is waited on, reclaimed once stale, and acquired (waited_ms > 0)", async () => {
  const root = makeTmp();
  try {
    const tokenPath = writeToken(root, { holder: "deadproj", pid: deadPid() });
    // STALE_TIMEOUT_S=2: the token is NOT yet reclaimable at acquire time (fresh mtime), so the
    // bounded wait must survive ≥2 poll iterations before the dead holder becomes reclaimable.
    const r = runToken(["--acquire", "meta-cc", "--timeout", "5"], { root, env: { HEAVY_OP_STALE_TIMEOUT_S: "2" } });
    assert.equal(r.status, 0, `the dead holder must be reclaimed and acquired after waiting:\n${r.all}`);
    assert.match(r.stderr, /RECLAIMED stale token/, "the dead holder must be reclaimed (not waited out)");
    assert.match(r.stdout, /waited_ms=[1-9]\d* holder=\S+ acquired=yes/, "waited_ms must be > 0 and the acquire must succeed");
    assert.ok(fs.existsSync(tokenPath), "a fresh token must now exist for the new holder");
    assert.match(fs.readFileSync(tokenPath, "utf8"), /holder=meta-cc/, "the token must now belong to the waiter");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC3: negative control — a LIVE long-running holder is never stolen ───────────────────────────────
test("AC3 — a LIVE long-running holder is never reclaimed: the bounded timeout still fails, the token survives", async () => {
  const root = makeTmp();
  let holder;
  try {
    holder = spawnHolder(root);
    const tokenPath = path.join(root, "heavy-op", "token");
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(tokenPath) && Date.now() < deadline) await sleep(20);
    assert.ok(fs.existsSync(tokenPath), "the holder must have acquired the token");
    const before = fs.readFileSync(tokenPath, "utf8");

    const r = runToken(["--acquire", "meta-cc", "--timeout", "2"], { root });
    assert.equal(r.status, 1, `a live holder must still fail the acquire:\n${r.all}`);
    assert.match(r.stdout, /waited_ms=2000 acquired=no/, "the bounded wait must expire");
    assert.ok(fs.existsSync(tokenPath), "the live holder's token must survive the bounded wait");
    assert.equal(fs.readFileSync(tokenPath, "utf8"), before, "the token must be byte-identical (never reclaimed/stolen)");
    const s = runToken(["--status"], { root });
    assert.match(s.stdout, /stale_reclaims=0/, "no reclaim may ever be counted against a live holder");
  } finally {
    if (holder) holder.kill("SIGKILL");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC5: failure message — dead holder names dead + waited + distance to reclaimable ──────────────────
test("AC5 — a dead-holder failure says the holder is DEAD + how far from reclaimable + how long waited (not a generic 'held by another project')", () => {
  const root = makeTmp();
  try {
    // Large STALE_TIMEOUT_S so the dead holder is never reclaimable within the short wait — we are
    // pinning the MESSAGE, not the reclaim.
    writeToken(root, { holder: "deadproj", pid: deadPid() });
    const r = runToken(["--acquire", "meta-cc", "--timeout", "1"], { root, env: { HEAVY_OP_STALE_TIMEOUT_S: "60" } });
    assert.equal(r.status, 1, `a dead-not-yet-stale holder must fail the acquire:\n${r.all}`);
    assert.match(r.stderr, /DEAD/, "the message must say the holder is dead");
    assert.match(r.stderr, /reclaimable in \d+s/, "the message must say how far from reclaimable");
    assert.match(r.stdout, /waited_ms=1000 acquired=no/, "the message must carry how long was waited");
    assert.doesNotMatch(r.stderr, /HELD by another project/, "the message must not mislead into cross-project contention");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC4: upper bound documented in test.sh's header, with a serialization justification ──────────────
test("AC4 — the wait upper bound is declared + justified in scripts/test.sh (bounded, less than a real heavy op)", () => {
  const src = fs.readFileSync(TEST_SH, "utf8");
  assert.match(src, /HEAVY_OP_ACQUIRE_TIMEOUT_S="\$\{HEAVY_OP_ACQUIRE_TIMEOUT_S:-40\}"/, "the default bound must be 40s");
  // The justification must tie the bound to a real heavy op's duration (else it can serialize).
  assert.match(src, /serialize two heavy ops back-to-back/i, "the header must state why the bound cannot serialize");
  assert.match(src, /below one real heavy op/, "the header must compare the bound to a real heavy op");
});

// ── AC6: node:test + @test-group governance (self-pin, enforced by test-framework-policy-check too) ──
test("AC6 — node:test + `// @test-group governance` is declared", () => {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  assert.match(src, /^\/\/ @test-group governance$/m);
  assert.match(src, /import \{ test \} from "node:test"/);
});

} // end governance self-skip wrapper
