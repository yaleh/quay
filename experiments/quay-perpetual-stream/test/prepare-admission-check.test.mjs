// Unit + CLI tests for prepare-admission-check.ts — M200/DIR-126-A single-flight admission for
// prepare-milestone.js. RED/GREEN coverage per the checked Plan (docs/plans/M200-dir-126-a.md):
// Stage 1 (5 scenarios: acquire/steal-rejection, stale reclaim, crash recovery, renew, staleness
// constant), Stage 2 (CLI --acquire/--force-release/--release/--renew), Stage 8 (module-level
// single-flight race simulation, renewal-vs-stall distinction, Admission-phase-error CLI shape).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  acquireLease,
  renewLease,
  releaseLease,
  checkStaleOwner,
  DEFAULT_STALENESS_MS,
  _internal,
} from "../scripts/prepare-admission-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, "..", "scripts", "prepare-admission-check.ts");

function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "prepare-admission-"));
}

function runCli(args, env = {}) {
  try {
    const stdout = execFileSync("node", ["--experimental-strip-types", CLI, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return { status: 0, stdout, json: JSON.parse(stdout) };
  } catch (e) {
    const stdout = e.stdout ? e.stdout.toString() : "";
    let json = null;
    try { json = JSON.parse(stdout); } catch { /* non-JSON stderr-only failure */ }
    return { status: typeof e.status === "number" ? e.status : 1, stdout, json };
  }
}

// ── Stage 1: core module ────────────────────────────────────────────────────────────────────────

test("DEFAULT_STALENESS_MS exports exactly the derived 300m/360m constants", () => {
  assert.deepEqual(DEFAULT_STALENESS_MS, { ordinary: 300 * 60 * 1000, highRisk: 360 * 60 * 1000 });
});

test("acquireLease: an active (non-expired) lease cannot be stolen by a second acquireLease call", () => {
  const workspace = makeWorkspace();
  const now = 1_000_000;
  const first = acquireLease({ workspace, taskId: "T-1", now, ownerExecutionId: "session-a" });
  assert.equal(first.outcome, "acquired");

  const second = acquireLease({ workspace, taskId: "T-1", now: now + 1000, ownerExecutionId: "session-b" });
  assert.equal(second.outcome, "prepare-already-running");
  assert.equal(second.owner.ownerExecutionId, "session-a");

  // Lease file on disk still records the ORIGINAL owner — never silently overwritten.
  const onDisk = _internal._readLease(workspace, "T-1");
  assert.equal(onDisk.ownerExecutionId, "session-a");
});

test("checkStaleOwner: a lease found with now > leaseUntil is reclaimed deterministically, recoveredFrom verbatim, fencingToken +1", () => {
  const workspace = makeWorkspace();
  const acquiredAt = 1_000_000;
  const first = acquireLease({ workspace, taskId: "T-2", now: acquiredAt, ownerExecutionId: "session-a" });
  assert.equal(first.lease.fencingToken, 0);

  const pastLeaseUntil = first.lease.leaseUntil + 1;
  const second = acquireLease({ workspace, taskId: "T-2", now: pastLeaseUntil, ownerExecutionId: "session-b" });
  assert.equal(second.outcome, "acquired");
  assert.equal(second.reclaimed, true);
  assert.equal(second.lease.fencingToken, 1);
  assert.deepEqual(second.lease.recoveredFrom, first.lease);
  assert.equal(second.lease.ownerExecutionId, "session-b");

  // The superseded lease's audit trail is real, on disk, releaseMethod-tagged.
  const auditRaw = fs.readFileSync(_internal.auditPath(workspace, "T-2"), "utf8").trim().split("\n");
  const auditRecord = JSON.parse(auditRaw[auditRaw.length - 1]);
  assert.equal(auditRecord.releaseMethod, "stale-reclaim");
  assert.deepEqual(auditRecord.lease, first.lease);
});

test("crash fixture: lease acquired, --release never called, clock advanced past leaseUntil — recovers via the SAME stale-reclaim path, no permanent lockout", () => {
  const workspace = makeWorkspace();
  const acquired = acquireLease({ workspace, taskId: "T-3", now: 1_000_000, ownerExecutionId: "crashed-session" });
  assert.equal(acquired.outcome, "acquired");
  // Simulate a crash: no releaseLease call at all.
  const pastLeaseUntil = acquired.lease.leaseUntil + 60_000;
  const recovered = acquireLease({ workspace, taskId: "T-3", now: pastLeaseUntil, ownerExecutionId: "new-session" });
  assert.equal(recovered.outcome, "acquired");
  assert.equal(recovered.reclaimed, true);
  assert.equal(recovered.lease.ownerExecutionId, "new-session");
  assert.equal(recovered.lease.recoveredFrom.ownerExecutionId, "crashed-session");
});

test("renewLease: extends leaseUntil from a fresh now, preserving ownerExecutionId/fencingToken/attempt", () => {
  const workspace = makeWorkspace();
  const acquired = acquireLease({ workspace, taskId: "T-4", now: 1_000_000, ownerExecutionId: "session-a" });
  const renewed = renewLease({ workspace, taskId: "T-4", stage: "PlanAuthor", now: 1_000_000 + 60_000 });
  assert.equal(renewed.ok, true);
  assert.equal(renewed.lease.ownerExecutionId, acquired.lease.ownerExecutionId);
  assert.equal(renewed.lease.fencingToken, acquired.lease.fencingToken);
  assert.equal(renewed.lease.attempt, acquired.lease.attempt);
  assert.equal(renewed.lease.stage, "PlanAuthor");
  assert.equal(renewed.lease.leaseUntil, 1_000_000 + 60_000 + DEFAULT_STALENESS_MS.ordinary);
  assert.ok(renewed.lease.leaseUntil > acquired.lease.leaseUntil);
});

test("renewLease: highRisk lease renews against the highRisk (360m) window, not the ordinary window", () => {
  const workspace = makeWorkspace();
  acquireLease({ workspace, taskId: "T-4b", highRisk: true, now: 1_000_000, ownerExecutionId: "session-a" });
  const renewed = renewLease({ workspace, taskId: "T-4b", stage: "PlanCheck", now: 2_000_000 });
  assert.equal(renewed.lease.leaseUntil, 2_000_000 + DEFAULT_STALENESS_MS.highRisk);
});

test("acquireLease: fail-closed when ownerExecutionId is missing — throws a distinct missing-session-id error, never a placeholder", () => {
  const workspace = makeWorkspace();
  assert.throws(
    () => acquireLease({ workspace, taskId: "T-5", now: 1_000_000, ownerExecutionId: undefined }),
    (err) => err.code === "missing-session-id"
  );
});

test("a different taskId remains independently acquirable while another key's lease is held", () => {
  const workspace = makeWorkspace();
  acquireLease({ workspace, taskId: "T-6a", now: 1_000_000, ownerExecutionId: "session-a" });
  const other = acquireLease({ workspace, taskId: "T-6b", now: 1_000_000, ownerExecutionId: "session-b" });
  assert.equal(other.outcome, "acquired");
});

test("prepare-admission-check.ts contains the cited primitives verbatim (grounding evidence)", () => {
  const src = fs.readFileSync(CLI, "utf8");
  for (const needle of ["wx", "EEXIST", "CLAUDE_CODE_SESSION_ID", "key: leaseKey", "recoveredFrom", "fencingToken"]) {
    assert.ok(src.includes(needle), `expected source to include ${JSON.stringify(needle)}`);
  }
});

// ── Stage 2: CLI wrapper ────────────────────────────────────────────────────────────────────────

test("CLI --acquire on a free key writes a lease file and exits 0 with JSON {outcome:'acquired',...}", () => {
  const workspace = makeWorkspace();
  const res = runCli(["--acquire", "--taskId", "T-CLI-1", "--workspace", workspace], { CLAUDE_CODE_SESSION_ID: "cli-session-1" });
  assert.equal(res.status, 0);
  assert.equal(res.json.outcome, "acquired");
  assert.ok(fs.existsSync(_internal.leasePath(workspace, "T-CLI-1")));
});

test("CLI --acquire on a held, non-expired key exits non-zero with JSON {outcome:'prepare-already-running', owner:{...}}", () => {
  const workspace = makeWorkspace();
  runCli(["--acquire", "--taskId", "T-CLI-2", "--workspace", workspace], { CLAUDE_CODE_SESSION_ID: "cli-session-first" });
  const second = runCli(["--acquire", "--taskId", "T-CLI-2", "--workspace", workspace], { CLAUDE_CODE_SESSION_ID: "cli-session-second" });
  assert.equal(second.status, 1);
  assert.equal(second.json.outcome, "prepare-already-running");
  assert.equal(second.json.owner.ownerExecutionId, "cli-session-first");
});

test("CLI --acquire without CLAUDE_CODE_SESSION_ID set fails closed (missing-session-id), never silently succeeds", () => {
  const workspace = makeWorkspace();
  const env = { ...process.env, workspace };
  delete env.CLAUDE_CODE_SESSION_ID;
  const res = runCli(["--acquire", "--taskId", "T-CLI-2b", "--workspace", workspace], { CLAUDE_CODE_SESSION_ID: "" });
  assert.notEqual(res.status, 0);
});

test("CLI --release genuinely removes the lease file, freeing the key", () => {
  const workspace = makeWorkspace();
  runCli(["--acquire", "--taskId", "T-CLI-3", "--workspace", workspace], { CLAUDE_CODE_SESSION_ID: "s1" });
  const rel = runCli(["--release", "--taskId", "T-CLI-3", "--workspace", workspace]);
  assert.equal(rel.status, 0);
  assert.equal(fs.existsSync(_internal.leasePath(workspace, "T-CLI-3")), false);
  const reacquire = runCli(["--acquire", "--taskId", "T-CLI-3", "--workspace", workspace], { CLAUDE_CODE_SESSION_ID: "s2" });
  assert.equal(reacquire.status, 0);
});

test("CLI --renew extends a real acquired lease's leaseUntil", () => {
  const workspace = makeWorkspace();
  const acquired = runCli(["--acquire", "--taskId", "T-CLI-4", "--workspace", workspace], { CLAUDE_CODE_SESSION_ID: "s1" });
  const renewed = runCli(["--renew", "--taskId", "T-CLI-4", "--workspace", workspace, "--stage", "PlanCheck"]);
  assert.equal(renewed.status, 0);
  assert.equal(renewed.json.ok, true);
  assert.ok(renewed.json.lease.leaseUntil >= acquired.json.lease.leaseUntil);
  assert.equal(renewed.json.lease.stage, "PlanCheck");
});

test("CLI --force-release <reason> against a still-active lease exits 0, genuinely removes it, and records a distinguishable force-release audit entry", () => {
  const workspace = makeWorkspace();
  runCli(["--acquire", "--taskId", "T-CLI-5", "--workspace", workspace], { CLAUDE_CODE_SESSION_ID: "stuck-session" });
  const res = runCli(["--force-release", "operator override: stuck lease, need it back now", "--taskId", "T-CLI-5", "--workspace", workspace]);
  assert.equal(res.status, 0);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.releaseMethod, "force-release");
  assert.equal(fs.existsSync(_internal.leasePath(workspace, "T-CLI-5")), false);

  const auditLines = fs.readFileSync(_internal.auditPath(workspace, "T-CLI-5"), "utf8").trim().split("\n");
  const last = JSON.parse(auditLines[auditLines.length - 1]);
  assert.equal(last.releaseMethod, "force-release");
  assert.equal(last.reason, "operator override: stuck lease, need it back now");

  // Distinguishable from an ordinary stale-reclaim record (Stage 1 test above already confirms
  // that shape carries releaseMethod:'stale-reclaim' instead).
  assert.notEqual(last.releaseMethod, "stale-reclaim");

  // Immediately re-acquirable — a real, non-silent unlock.
  const reacquired = runCli(["--acquire", "--taskId", "T-CLI-5", "--workspace", workspace], { CLAUDE_CODE_SESSION_ID: "fresh-session" });
  assert.equal(reacquired.status, 0);
});

// ── Stage 8: module-level single-flight simulation, stall-vs-crash distinction, admission-error shape ──

test("single-flight simulation: two acquireLease calls back-to-back for the SAME key — the second synchronously returns prepare-already-running before any further work", () => {
  const workspace = makeWorkspace();
  const now = 5_000_000;
  const winner = acquireLease({ workspace, taskId: "T-RACE", now, ownerExecutionId: "racer-a" });
  const loser = acquireLease({ workspace, taskId: "T-RACE", now, ownerExecutionId: "racer-b" });
  assert.equal(winner.outcome, "acquired");
  assert.equal(loser.outcome, "prepare-already-running");
  // Dispatch-count-ordering proxy at module granularity: exactly one lease file, owned by the winner.
  const onDisk = _internal._readLease(workspace, "T-RACE");
  assert.equal(onDisk.ownerExecutionId, "racer-a");
});

test("a genuinely-stalled generation (no renewLease call for one whole simulated phase) is reclaimed by a second dispatch the same way a crashed one is", () => {
  const workspace = makeWorkspace();
  const acquired = acquireLease({ workspace, taskId: "T-STALL", now: 0, ownerExecutionId: "stalled-session" });
  // Simulate one whole "phase" elapsing with NO renewLease call — advance the fake clock past
  // leaseUntil without ever calling renewLease (the stalled-but-not-crashed distinction: the
  // process could still be alive, but it never renewed).
  const stallNow = acquired.lease.leaseUntil + 1;
  const reclaimed = acquireLease({ workspace, taskId: "T-STALL", now: stallNow, ownerExecutionId: "rescuer-session" });
  assert.equal(reclaimed.outcome, "acquired");
  assert.equal(reclaimed.reclaimed, true);
  assert.equal(reclaimed.lease.ownerExecutionId, "rescuer-session");
});

test("a legitimately renewed generation survives renewal across a boundary that would otherwise have gone stale", () => {
  const workspace = makeWorkspace();
  const acquired = acquireLease({ workspace, taskId: "T-RENEW-SURVIVE", now: 0, ownerExecutionId: "long-running-session" });
  const almostStale = acquired.lease.leaseUntil - 1000;
  const renewed = renewLease({ workspace, taskId: "T-RENEW-SURVIVE", stage: "PlanCheck-round-3", now: almostStale });
  assert.equal(renewed.ok, true);
  // Past the ORIGINAL leaseUntil, a second acquirer must still be rejected — renewal genuinely
  // extended the window, not merely logged.
  const stillBlocked = acquireLease({ workspace, taskId: "T-RENEW-SURVIVE", now: acquired.lease.leaseUntil + 500, ownerExecutionId: "impatient-session" });
  assert.equal(stillBlocked.outcome, "prepare-already-running");
});

test("Admission-phase-error CLI shape: a deliberately malformed invocation exits non-zero with a shape distinguishable from prepare-already-running", () => {
  const workspace = makeWorkspace();
  // Malformed: --acquire with no --taskId at all.
  const res = runCli(["--acquire", "--workspace", workspace], { CLAUDE_CODE_SESSION_ID: "s1" });
  assert.notEqual(res.status, 0);
  // Whatever shape is printed (may be plain stderr usage text, not JSON), it must NOT claim
  // outcome:'acquired' and must NOT claim outcome:'prepare-already-running' — those are the two
  // legitimate lease-contention verdicts; anything else is a distinct admission-check-failed-class
  // error the workflow's Stage 5 fail-closed branch must treat differently.
  if (res.json) {
    assert.notEqual(res.json.outcome, "acquired");
    assert.notEqual(res.json.outcome, "prepare-already-running");
  }
});

test("Admission-phase-error CLI shape: an unset CLAUDE_CODE_SESSION_ID during --acquire is a distinct error code, not lease contention", () => {
  const workspace = makeWorkspace();
  const res = runCli(["--acquire", "--taskId", "T-ERR", "--workspace", workspace], { CLAUDE_CODE_SESSION_ID: "" });
  assert.notEqual(res.status, 0);
  assert.ok(res.json);
  assert.equal(res.json.code, "missing-session-id");
  assert.notEqual(res.json.outcome, "prepare-already-running");
});
