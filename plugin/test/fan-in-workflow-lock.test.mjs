// @test-group engine
// fan-in-workflow-lock.test.mjs — gap-fan-in-workflow-lock-and-S1: the fan-in WORKFLOW lock (a SEPARATE
// flock from the ms-scale merge lock) held by a detached holder for the ENTIRE fan-in workflow
// (merge develop → full suite → ff), so develop does not advance during a locked task's fan-in
// (ff-race structurally impossible — SPEC-fan-in-workflow-lock-and-S1-2026-08-26).
//
//   * AC1 — acquire → lock HELD (a second flock -n fails) → release → lock FREE. The negative control
//     (⛔ still only a ms-scale ff lock ⇒ false) is the flock -n probe itself: the lock must be held
//     while the workflow runs, not just for the ff's millisecond.
//   * AC1 idempotency — a re-acquire for the SAME task does not spawn a second holder (the pidfile
//     stays the same), so a killed-then-re-run acquire step (Bash 600s) cannot double-hold.
//   * AC5 — holder CRASH ⇒ the suite-lock hold watchdog releases the lock (re-acquire then succeeds).
//   * AC4 (fixed lock order) — scripts/test.sh (the fan-in-EXTERNAL suite path) has NO reference to the
//     fan-in workflow lock ⇒ the suite lock never requests the fan-in lock ⇒ reverse order impossible.
//
// Run:
//   scripts/test.sh plugin/test/fan-in-workflow-lock.test.mjs
//   node --test plugin/test/fan-in-workflow-lock.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MERGE_SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "fan-in-ff-merge.sh");
const TEST_SH = path.join(REPO_ROOT, "scripts", "test.sh");
const SUITE_SLOT_LIB = path.join(REPO_ROOT, "plugin", "scripts", "suite-slot-lib.sh");

function gitCmd(cwd, ...args) {
  return spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function makeTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `faninwfl-${prefix ?? ""}-`));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function initRepo(dir) {
  gitCmd(dir, "init", "-q");
  gitCmd(dir, "config", "user.name", "faninwfl-test");
  gitCmd(dir, "config", "user.email", "fwfl@example.com");
  gitCmd(dir, "branch", "-M", "master");
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n", "utf8");
  gitCmd(dir, "add", "-A");
  gitCmd(dir, "commit", "-q", "-m", "base");
}

function runMerge(args, opts = {}) {
  return spawnSync("bash", [MERGE_SCRIPT, ...args], { encoding: "utf8", ...opts });
}

/** The workflow lock file for a repo (git-common-dir → `<dir>/.git/fan-in-workflow.lock`). */
function lockFile(dir) {
  return path.join(dir, ".git", "fan-in-workflow.lock");
}

/** A non-blocking flock probe on the workflow lock: true = the lock is HELD by another process,
 *  false = free. The probe opens its OWN fd, so it is independent of the holder's fd. */
function lockIsHeld(dir) {
  const r = spawnSync("bash", ["-c", `exec 9>"${lockFile(dir)}"; flock -n 9`], { encoding: "utf8" });
  return r.status !== 0;
}

// ── AC1: acquire holds the lock; release frees it ─────────────────────────────────────────────────────

test("AC1 — acquire holds the workflow lock (flock -n fails); release frees it (flock -n succeeds)", () => {
  const dir = makeTmp("ac1");
  try {
    initRepo(dir);
    const acquire = runMerge(["--task", "t1", "--root", dir, "--run-id", "r1", "--acquire-workflow-lock"]);
    assert.equal(acquire.status, 0, `acquire must succeed: ${acquire.stdout}${acquire.stderr}`);
    // ⛔ the whole point: the lock is HELD while the workflow runs, not just during the ff.
    assert.equal(lockIsHeld(dir), true, "after acquire the workflow lock must be HELD (a second flock -n must fail)");
    const release = runMerge(["--task", "t1", "--root", dir, "--release-workflow-lock"]);
    assert.equal(release.status, 0, `release must succeed: ${release.stdout}${release.stderr}`);
    assert.equal(lockIsHeld(dir), false, "after release the workflow lock must be FREE");
  } finally {
    cleanup(dir);
  }
});

test("AC1 idempotency — a re-acquire for the SAME task keeps the SAME holder (no second spawn)", () => {
  const dir = makeTmp("ac1idem");
  try {
    initRepo(dir);
    const a1 = runMerge(["--task", "t1", "--root", dir, "--run-id", "r1", "--acquire-workflow-lock"]);
    assert.equal(a1.status, 0);
    const pid1 = fs.readFileSync(path.join(os.tmpdir(), "fan-in-workflow-lock-t1.pid"), "utf8").trim();
    const a2 = runMerge(["--task", "t1", "--root", dir, "--run-id", "r1", "--acquire-workflow-lock"]);
    assert.equal(a2.status, 0, `idempotent re-acquire must succeed: ${a2.stdout}${a2.stderr}`);
    const pid2 = fs.readFileSync(path.join(os.tmpdir(), "fan-in-workflow-lock-t1.pid"), "utf8").trim();
    assert.equal(pid2, pid1, "re-acquire must reuse the SAME holder (no second spawn)");
    runMerge(["--task", "t1", "--root", dir, "--release-workflow-lock"]);
  } finally {
    cleanup(dir);
  }
});

// ── AC5: holder crash ⇒ the suite-lock hold watchdog releases the lock ───────────────────────────────

test("AC5 — holder crash ⇒ the watchdog releases the lock (a later acquire succeeds)", () => {
  const dir = makeTmp("ac5");
  try {
    initRepo(dir);
    const acquire = runMerge(["--task", "t1", "--root", dir, "--run-id", "r1", "--acquire-workflow-lock"]);
    assert.equal(acquire.status, 0);
    const holder = fs.readFileSync(path.join(os.tmpdir(), "fan-in-workflow-lock-t1.pid"), "utf8").trim();
    assert.ok(holder, "holder pidfile must be written");
    assert.equal(lockIsHeld(dir), true, "lock held before the crash");
    // Crash the holder (SIGKILL — no chance to clean up). flock auto-releases the holder's OWN fd, but
    // the watchdog (a child inheriting the same open-file-description) would otherwise keep it held ⇒
    // the watchdog must release it on the next poll.
    process.kill(Number(holder), "SIGKILL");
    // The watchdog polls each 1s; give it a couple of polls to detect the dead holder + release.
    let free = false;
    for (let i = 0; i < 30; i++) {
      spawnSync("sleep", ["0.1"], { encoding: "utf8" });
      if (!lockIsHeld(dir)) { free = true; break; }
    }
    assert.equal(free, true, "after the holder crashes the watchdog must release the lock (≤ ~3s)");
    // A fresh acquire must now succeed (the lock was genuinely released, not just probe-visible).
    const re = runMerge(["--task", "t2", "--root", dir, "--run-id", "r2", "--acquire-workflow-lock"]);
    assert.equal(re.status, 0, `post-crash acquire must succeed: ${re.stdout}${re.stderr}`);
    runMerge(["--task", "t2", "--root", dir, "--release-workflow-lock"]);
  } finally {
    cleanup(dir);
  }
});

// ── AC4: fixed lock order — the fan-in-EXTERNAL suite path never requests the fan-in lock ────────────

test("AC4 — scripts/test.sh (the suite lock path) has NO reference to the fan-in workflow lock", () => {
  const src = fs.readFileSync(TEST_SH, "utf8");
  assert.ok(!/fan-in-workflow\.lock/.test(src), "scripts/test.sh must never reference fan-in-workflow.lock (fan-in 外 suite 不请求 fan-in 锁 ⇒ 反向获取顺序结构上不可能)");
});

test("AC4 — the workflow lock and the suite lock are DIFFERENT files (two orthogonal locks)", () => {
  const dir = makeTmp("ac4files");
  try {
    initRepo(dir);
    // fan-in-ff-merge.sh resolves the workflow lock file from git-common-dir; the suite lock uses the
    // S-slot full-suite.lock.* family. They must be distinct files (SPEC §2.1 两把正交锁).
    assert.notEqual(path.basename(lockFile(dir)), "full-suite.lock.0", "workflow lock ≠ a suite slot");
  } finally {
    cleanup(dir);
  }
});

// ── AC2: S=1 via the .concurrency single source (bash + TS canons agree) ────────────────────────────

test("AC2 — S=1 via the .concurrency file is read identically by the bash and TS canons (single source)", () => {
  const pinTmp = fs.mkdtempSync(path.join(os.tmpdir(), "faninwfl-s1-"));
  const pinBase = path.join(pinTmp, "full-suite.lock");
  try {
    fs.writeFileSync(`${pinBase}.concurrency`, "1", "utf8");
    const bash = spawnSync("bash", ["-c", `. "${SUITE_SLOT_LIB}"; suite_slot_count "${pinBase}"`], { encoding: "utf8" });
    assert.equal(bash.status, 0, `bash slot count failed: ${bash.stderr}`);
    assert.equal(bash.stdout.trim(), "1", "bash canonical must read S=1 from the .concurrency file");
    // The TS canonical reads the SAME file (suiteLockSlotCount with an explicit base).
    const ts = spawnSync("node", ["--no-warnings", "--experimental-strip-types", "--input-type=module", "-e",
      `import { suiteLockSlotCount } from "${path.join(REPO_ROOT, "plugin", "scripts", "suite-lock-slots.ts")}"; console.log(suiteLockSlotCount(${JSON.stringify(pinBase)}));`], { encoding: "utf8" });
    assert.equal(ts.status, 0, `TS slot count failed: ${ts.stderr}`);
    assert.equal(ts.stdout.trim(), "1", "TS canonical must read S=1 from the .concurrency file");
  } finally {
    fs.rmSync(pinTmp, { recursive: true, force: true });
  }
});
