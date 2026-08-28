// @test-group engine
// fan-in-workflow-lock.test.mjs — gap-fan-in-workflow-lock-and-S1 + ADR-034 (gap-adr034-fan-in-lock-
// holder-supervised): the fan-in WORKFLOW lock (a SEPARATE flock from the ms-scale merge lock). ADR-034
// abolished the detached-holder + flag-release protocol — the lock is now held by the driver via
// worker-driver.ts's acquireFanInWorkflowLock (a non-detached direct child that dies with the driver, so
// the lock's release is the single "process exit → kernel closes fd" mechanism, no watchdog / timer /
// third-party flag). This file covers the INVARIANTS that survive the protocol change:
//
//   * AC1 — acquireFanInWorkflowLock holds the lock (a second flock -n fails) → release frees it. The
//     negative control (⛔ still only a ms-scale ff lock ⇒ false) is the flock -n probe itself.
//   * AC1/AC2 — the lock events carry the dispatch runId, and readWorkflowLockHold reads the hold by
//     that runId (⛔ a stale runId reads null).
//   * AC4 (fixed lock order) — scripts/test.sh (fan-in-EXTERNAL suite path) never requests the lock.
//   * AC4 — the workflow lock and the suite lock are DIFFERENT files (two orthogonal locks).
//   * AC2 — S=1 via the .concurrency single source (bash + TS canons agree).
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

import { acquireFanInWorkflowLock, readWorkflowLockHold } from "../scripts/worker-driver.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
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
  gitCmd(dir, "branch", "-M", "develop");
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n", "utf8");
  gitCmd(dir, "add", "-A");
  gitCmd(dir, "commit", "-q", "-m", "base");
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

// ── AC1 (ADR-034): acquire holds the lock; release frees it ───────────────────────────────────────────

test("AC1 — acquireFanInWorkflowLock holds the workflow lock (flock -n fails); release frees it (flock -n succeeds)", async () => {
  const dir = makeTmp("ac1");
  try {
    initRepo(dir);
    const lock = await acquireFanInWorkflowLock({ root: dir, task: "t1", runId: "r1" });
    // ⛔ the whole point: the lock is HELD while the workflow runs, not just during the ff.
    assert.equal(lockIsHeld(dir), true, "after acquire the workflow lock must be HELD (a second flock -n must fail)");
    await lock.release();
    assert.equal(lockIsHeld(dir), false, "after release the workflow lock must be FREE");
  } finally {
    cleanup(dir);
  }
});

// ── AC1/AC2 (gap-fan-in-workflow-lock-stale-runid-detached-holder): lock events carry the dispatch
//    runId, and readWorkflowLockHold reads the hold by the correct runId ───────────────────────────────

test("AC1/AC2 — the lock events carry the dispatch runId, and readWorkflowLockHold reads the hold by that runId (⛔ a stale runId reads null)", async () => {
  const dir = makeTmp("runid");
  try {
    initRepo(dir);
    // NO eventsFile override: the events land at the DEFAULT path (<root>/.quay/fan-in-workflow-lock-
    // events.jsonl), which is exactly the file readWorkflowLockHold reads — the real reader over the real writer.
    const events = path.join(dir, ".quay", "fan-in-workflow-lock-events.jsonl");
    const lock = await acquireFanInWorkflowLock({ root: dir, task: "t1", runId: "r-fresh" });
    await lock.release();

    // AC1: every lock event carries THIS dispatch's runId (⛔ a stale runId ⇒ 会计错).
    const lines = fs.readFileSync(events, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
    assert.equal(lines.length, 2, "exactly acquire + release");
    assert.deepEqual(lines.map((e) => e.runId), ["r-fresh", "r-fresh"], "AC1: every lock event carries the dispatch runId");

    // AC2: readWorkflowLockHold(task, runId) reads the hold by the CORRECT runId (⛔ null ⇒ the
    // mechanical AC1/AC2 判据 is dead).
    const hold = readWorkflowLockHold(dir, "t1", "r-fresh");
    assert.ok(hold.lockAcquireEpoch !== null, "lockAcquireEpoch must be read (not null)");
    assert.ok(hold.lockReleaseEpoch !== null, "lockReleaseEpoch must be read (not null)");
    assert.ok(hold.lockHoldSecs !== null && hold.lockHoldSecs >= 0, "lockHoldSecs must be read (not null, ≥ 0)");
    // The WRONG runId must read null — a stale-runId read is empty, which is the bug's exact symptom.
    const stale = readWorkflowLockHold(dir, "t1", "r-stale");
    assert.equal(stale.lockHoldSecs, null, "a different runId must read null (no cross-runId leak)");
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
    // fan-in-ff-merge.sh (the ms-scale merge lock) uses fan-in-merge.lock; the driver-held workflow lock
    // uses fan-in-workflow.lock; the suite lock uses the S-slot full-suite.lock.* family. They are distinct.
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
