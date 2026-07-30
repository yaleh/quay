// Unit + CLI tests for prepare-admission-check.ts — M200/DIR-126-A single-flight admission +
// M201/DIR-126-B deterministic mechanical Preflight for prepare-milestone.js. RED/GREEN coverage
// per the checked Plan (docs/plans/M200-dir-126-a.md, docs/plans/M201-dir-126-b.md):
// Stage 1 (5 scenarios: acquire/steal-rejection, stale reclaim, crash recovery, renew, staleness
// constant), Stage 2 (CLI --acquire/--force-release/--release/--renew), Stage 8 (module-level
// single-flight race simulation, renewal-vs-stall distinction, Admission-phase-error CLI shape),
// M201 Stages 1/3/6 (five preflight detectors RED/GREEN/ambiguous, runPreflightChecks content/plan
// modes, --preflight/--preflight-plan CLI, calibration).
import { test, describe } from "node:test";
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
  PREFLIGHT_POLICY_VERSION,
  PREFLIGHT_CALIBRATED,
  preflightMergedMarkdownClaims,
  preflightStaleAcRefs,
  preflightTouchesMismatch,
  preflightMissingPrecedent,
  preflightInvalidPlanCommand,
  runPreflightChecks,
} from "../scripts/prepare-admission-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, "..", "scripts", "prepare-admission-check.ts");
// Repo-root discovery by walking up to the nearest '.git' ancestor — NOT a fixed '../../..'
// literal. This file is byte-identical-mirrored to plugin/test/ (2 levels below repo root)
// while its canonical home is 3 levels below repo root (experiments/quay-perpetual-stream/test/)
// — a depth-specific literal would resolve to the WRONG directory in one of the two locations
// (confirmed real: a fixed 3-up literal silently walked OUTSIDE the repo entirely when this file
// ran from the plugin/test/ mirror under scripts/test.sh, turning every workspace:REPO_ROOT
// detector test non-deterministic/wrong rather than a clean failure).
function _findRepoRoot(startDir) {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`prepare-admission-check.test.mjs: no '.git' ancestor found starting from ${startDir}`);
    dir = parent;
  }
}
const REPO_ROOT = _findRepoRoot(__dirname);
const FIXTURES = path.join(__dirname, "fixtures", "preflight");

function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "prepare-admission-"));
}

function readFixture(...segments) {
  return fs.readFileSync(path.join(FIXTURES, ...segments), "utf8");
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// M201/DIR-126-B Preflight — five detectors, runPreflightChecks, CLI --preflight/--preflight-plan.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test("PREFLIGHT_POLICY_VERSION is a stable, exported literal — every finding carries it", () => {
  assert.equal(typeof PREFLIGHT_POLICY_VERSION, "string");
  assert.ok(PREFLIGHT_POLICY_VERSION.length > 0);
});

// ── Three independent adversarial audit rounds (M201/DIR-126-B, 2026-07-29) each found a NEW real
// false-positive class specifically in preflight-stale-ac-refs/preflight-missing-precedent against
// this repo's real, organically-varied task corpus — regex-exact-resolution matching cannot be made
// false-positive-free by iterating individual shapes. Per this task's own "Repair/calibrate before
// fail-closed activation" AC and PREFLIGHT_CALIBRATED's own stated purpose, these two stay
// non-blocking/logged-only until genuinely proven safe; the other three held up across all three
// rounds with zero real false positives and stay calibrated. ──
test("PREFLIGHT_CALIBRATED names exactly the five detector codes; three are calibrated true, two (stale-ac-refs/missing-precedent) are false pending real-content proof", () => {
  assert.deepEqual(Object.keys(PREFLIGHT_CALIBRATED).sort(), [
    "preflight-invalid-plan-command",
    "preflight-merged-markdown-claims",
    "preflight-missing-precedent",
    "preflight-stale-ac-refs",
    "preflight-touches-mismatch",
  ]);
  assert.equal(PREFLIGHT_CALIBRATED["preflight-merged-markdown-claims"], true);
  assert.equal(PREFLIGHT_CALIBRATED["preflight-touches-mismatch"], true);
  assert.equal(PREFLIGHT_CALIBRATED["preflight-invalid-plan-command"], true);
  assert.equal(PREFLIGHT_CALIBRATED["preflight-stale-ac-refs"], false);
  assert.equal(PREFLIGHT_CALIBRATED["preflight-missing-precedent"], false);
});

test("a real, currently-open task's placeholder-shaped filename (`iteration-N.md`) no longer hard-blocks at the runPreflightChecks/CLI layer now that preflight-stale-ac-refs is non-blocking, but the finding still surfaces (never silently dropped)", () => {
  // The raw detector function is calibration-unaware by design (calibration is applied once, at
  // runPreflightChecks's record() wrapper — the single point every CLI/production callsite goes
  // through) — so it correctly still reports blocking:true/unresolved on its own.
  const taskBody = [
    "## Acceptance Criteria",
    "",
    "- [ ] the Build phase's own `iteration-N.md` is filed at the correct path.",
    "",
  ].join("\n");
  const rawVerdict = preflightStaleAcRefs({ taskBody, workspace: REPO_ROOT });
  assert.ok(rawVerdict, "the raw detector still finds it");
  assert.equal(rawVerdict.blocking, true);

  const result = runPreflightChecks({ mode: "content", taskBody, charterBody: "", planBody: "", workspace: REPO_ROOT });
  assert.equal(result.ok, true, "non-blocking at the real production entry point");
  const finding = result.findings.find((f) => f.code === "preflight-stale-ac-refs");
  assert.ok(finding, "the finding still surfaces, never silently dropped");
  assert.equal(finding.blocking, false);
  assert.equal(finding.calibrated, false);
});

describe("preflightMergedMarkdownClaims", () => {
  test("RED/known-bad: a dense, un-blank-lined claim crams >=4 identifiers onto one mid-line-bulleted block -> blocking", () => {
    const taskBody = readFixture("merged-markdown-claims", "bad.md");
    const verdict = preflightMergedMarkdownClaims({ taskBody });
    assert.ok(verdict, "expected a finding");
    assert.equal(verdict.code, "preflight-merged-markdown-claims");
    assert.equal(verdict.blocking, true);
    assert.equal(verdict.policyVersion, PREFLIGHT_POLICY_VERSION);
  });

  test("known-good: properly separated one-claim-per-bullet fixture returns zero findings", () => {
    const taskBody = readFixture("merged-markdown-claims", "good.md");
    assert.equal(preflightMergedMarkdownClaims({ taskBody }), null);
  });

  test("ambiguous-valid: a mid-line dash with only 2 identifiers is NOT confidently merged -> non-blocking, reviewer-required", () => {
    const taskBody = readFixture("merged-markdown-claims", "ambiguous.md");
    const verdict = preflightMergedMarkdownClaims({ taskBody });
    assert.ok(verdict, "expected a finding");
    assert.equal(verdict.code, "preflight-ambiguous-merged-markdown-claims");
    assert.equal(verdict.blocking, false);
    assert.equal(verdict.disposition, "reviewer-required");
  });
});

describe("preflightStaleAcRefs", () => {
  test("RED/known-bad: AC cites a commit hash that does not resolve in a real git workspace -> blocking", () => {
    const taskBody = readFixture("stale-ac-refs", "bad.md");
    const verdict = preflightStaleAcRefs({ taskBody, workspace: REPO_ROOT });
    assert.ok(verdict, "expected a finding");
    assert.equal(verdict.code, "preflight-stale-ac-refs");
    assert.equal(verdict.blocking, true);
  });

  test("known-good: AC cites a real, resolvable commit -> zero findings", () => {
    const taskBody = readFixture("stale-ac-refs", "good.md");
    assert.equal(preflightStaleAcRefs({ taskBody, workspace: REPO_ROOT }), null);
  });

  test("ambiguous-valid: a commit-hash-shaped AC citation against a NON-git workspace cannot be mechanically verified -> reviewer-required, never a false pass/fail", () => {
    const taskBody = readFixture("stale-ac-refs", "ambiguous.md");
    const nonGitWorkspace = makeWorkspace();
    const verdict = preflightStaleAcRefs({ taskBody, workspace: nonGitWorkspace });
    assert.ok(verdict, "expected a finding");
    assert.equal(verdict.code, "preflight-ambiguous-stale-ac-refs");
    assert.equal(verdict.blocking, false);
    assert.equal(verdict.disposition, "reviewer-required");
  });

  // ── M201/iteration-0 adversarial audit REFUTED finding: dogfooding this exact CLI against
  // DIR-126-B's/DIR-126-A's own real, valid task files rejected BOTH — a bare filename reference
  // (this repo's dominant authoring convention, no directory component) is not at the repo root, so
  // the pre-fix literal-join check false-positived on essentially every ordinarily-written task. ──
  test("known-good (real defect regression): a bare filename that exists elsewhere in the repo tree (not at the literal joined path) is NOT stale", () => {
    const taskBody = [
      "## Acceptance Criteria",
      "",
      "- [ ] Real production wiring confirmed: `prepare-admission-check.ts` implements the detector.",
      "",
    ].join("\n");
    assert.equal(preflightStaleAcRefs({ taskBody, workspace: REPO_ROOT }), null);
  });

  // ── Independent-audit round 2 finding (2026-07-29): the basename fallback above was ORIGINALLY
  // unconditional, silently accepting a directory-QUALIFIED but entirely fabricated path whenever
  // some unrelated file happened to share its basename ("package.json" is real everywhere) — a
  // silent false pass. Fixed by restricting the fallback to BARE tokens only. ──
  test("known-good (real defect regression): a directory-qualified but fabricated path is STILL stale, even when its basename matches a real file elsewhere", () => {
    const taskBody = [
      "## Acceptance Criteria",
      "",
      "- [ ] See `packages/nonexistent-fabricated-package/package.json` for the real shape.",
      "",
    ].join("\n");
    const verdict = preflightStaleAcRefs({ taskBody, workspace: REPO_ROOT });
    assert.ok(verdict, "a fabricated directory-qualified path must still be flagged");
    assert.equal(verdict.blocking, true);
    assert.match(verdict.evidence, /nonexistent-fabricated-package/);
  });

  // ── Independent-audit round 2 finding: a file this task's own '## Touches' declares as in-scope
  // (commonly annotated "(new)" in this repo's authoring convention) is future work the task itself
  // brings into existence, not a claimed pre-existing precedent — never stale. ──
  test("known-good (real defect regression): a file the task's own Touches declares in-scope (with a trailing '(new)' annotation) is NOT stale", () => {
    const taskBody = [
      "## Touches",
      "",
      "- `packages/quay/src/config-validate.ts (new)`",
      "",
      "## Acceptance Criteria",
      "",
      "- [ ] Validation logic lives in `packages/quay/src/config-validate.ts`.",
      "",
    ].join("\n");
    assert.equal(preflightStaleAcRefs({ taskBody, workspace: REPO_ROOT }), null);
  });

  // ── Independent-audit round 2 finding: '.quay/' is this repo's own established per-workspace
  // RUNTIME state prefix (CLAUDE.md documents '.quay/config.yml' as per-workspace, never
  // repo-tracked) — a '.quay/'-prefixed token in prose illustrates a runtime location, never a
  // claimed repo-tracked precedent. ──
  test("known-good (real defect regression): a '.quay/'-prefixed illustrative runtime path is NOT stale", () => {
    const taskBody = [
      "## Acceptance Criteria",
      "",
      "- [ ] The gate config lives at `.quay/gates.yml` for this workspace.",
      "",
    ].join("\n");
    assert.equal(preflightStaleAcRefs({ taskBody, workspace: REPO_ROOT }), null);
  });
});

describe("preflightMissingPrecedent", () => {
  test("RED/known-bad: Finding cites a nonexistent commit AND a nonexistent file path -> blocking", () => {
    const taskBody = readFixture("missing-precedent", "bad.md");
    const verdict = preflightMissingPrecedent({ taskBody, workspace: REPO_ROOT });
    assert.ok(verdict, "expected a finding");
    assert.equal(verdict.code, "preflight-missing-precedent");
    assert.equal(verdict.blocking, true);
    assert.match(verdict.message, /deadbeef1/);
    assert.match(verdict.message, /does\/not\/exist\.ts/);
  });

  test("known-good: Finding cites a real commit and a real file path -> zero findings", () => {
    const taskBody = readFixture("missing-precedent", "good.md");
    assert.equal(preflightMissingPrecedent({ taskBody, workspace: REPO_ROOT }), null);
  });

  test("ambiguous-valid: commit-hash-shaped citation against a NON-git workspace -> reviewer-required", () => {
    const taskBody = readFixture("missing-precedent", "ambiguous.md");
    const nonGitWorkspace = makeWorkspace();
    const verdict = preflightMissingPrecedent({ taskBody, workspace: nonGitWorkspace });
    assert.ok(verdict, "expected a finding");
    assert.equal(verdict.code, "preflight-ambiguous-missing-precedent");
    assert.equal(verdict.blocking, false);
    assert.equal(verdict.disposition, "reviewer-required");
  });

  // ── Same real-defect regression as preflightStaleAcRefs above — the two detectors share
  // _scanStaleReferences(), so both needed the fix and both need the regression test. ──
  test("known-good (real defect regression): a bare filename that exists elsewhere in the repo tree is NOT a missing precedent", () => {
    const taskBody = [
      "## Finding",
      "",
      "`wiring-coverage-check.ts` already exports the reused splitting helpers.",
      "",
    ].join("\n");
    assert.equal(preflightMissingPrecedent({ taskBody, workspace: REPO_ROOT }), null);
  });

  test("preflight-missing-precedent and preflight-stale-ac-refs share the SAME resolution primitive on different sections (no second implementation)", () => {
    const src = fs.readFileSync(CLI, "utf8");
    // Both detector functions call the shared _scanStaleReferences() helper — a real, grep-checkable
    // reuse, not merely descriptive prose.
    const staleRefsBody = src.slice(src.indexOf("export function preflightStaleAcRefs"), src.indexOf("export function preflightMissingPrecedent"));
    const missingPrecedentBody = src.slice(src.indexOf("export function preflightMissingPrecedent"), src.indexOf("// ── preflight-touches-mismatch"));
    assert.match(staleRefsBody, /_scanStaleReferences\(/);
    assert.match(missingPrecedentBody, /_scanStaleReferences\(/);
  });
});

describe("preflightTouchesMismatch — WIRING-CLAIM 6: one implementation, two call sites (charter, plan-files)", () => {
  const taskBody = readFixture("touches-mismatch", "task.md");

  test("RED/known-bad ('charter' call site): charter declares its OWN distinct Touches list -> blocking", () => {
    const charterBody = readFixture("touches-mismatch", "charter-bad.md");
    const verdict = preflightTouchesMismatch({ taskBody, secondaryBody: charterBody, secondaryLabel: "charter" });
    assert.ok(verdict, "expected a finding");
    assert.equal(verdict.code, "preflight-touches-mismatch");
    assert.equal(verdict.blocking, true);
  });

  test("known-good ('charter' call site): a delegating charter ('own Touches list — not duplicated here') is never a mismatch", () => {
    const charterBody = readFixture("touches-mismatch", "charter-good.md");
    assert.equal(preflightTouchesMismatch({ taskBody, secondaryBody: charterBody, secondaryLabel: "charter" }), null);
  });

  test("RED/known-bad ('plan-files' call site): a checked Plan's aggregate '- Files:' reference a real path outside the task's '## Touches' -> blocking", () => {
    const planBody = readFixture("touches-mismatch", "plan-bad.md");
    const verdict = preflightTouchesMismatch({ taskBody, secondaryBody: planBody, secondaryLabel: "plan-files" });
    assert.ok(verdict, "expected a finding");
    assert.equal(verdict.code, "preflight-touches-mismatch");
    assert.equal(verdict.blocking, true);
  });

  test("known-good ('plan-files' call site): Plan Files fully covered by the task's own Touches globs -> zero findings", () => {
    const planBody = readFixture("touches-mismatch", "plan-good.md");
    assert.equal(preflightTouchesMismatch({ taskBody, secondaryBody: planBody, secondaryLabel: "plan-files" }), null);
  });

  test("known-good ('plan-files', annotation-robustness, gap-preflight-touches-mismatch-plan-files-annotation): a comma-containing annotation on an all-declared '- Files:' line is stripped, not shredded into bogus tokens -> zero findings", () => {
    // Both paths ARE in the task's ## Touches; the PlanAuthor appended "(both run, neither
    // modified)" — a comma-containing annotation. Before the paren-aware split, `.split(",")`
    // shredded it into bogus tokens ("(both run", "neither modified)") that never matched.
    const planBody = [
      "# Fixture Plan — comma-containing annotation on declared paths",
      "",
      "### Stage 1: annotated all-declared files",
      "- AC: 1",
      "- Files: packages/quay/src/foo.ts, packages/quay/test/foo.test.mjs (both run, neither modified)",
      "- Command: `true`",
      "",
    ].join("\n");
    assert.equal(preflightTouchesMismatch({ taskBody, secondaryBody: planBody, secondaryLabel: "plan-files" }), null);
  });

  test("RED ('plan-files', annotation-robustness is NOT over-permissive): a trailing annotation on an UNDECLARED path is stripped but the path still correctly flags a mismatch", () => {
    // packages/quay-native/src/other.ts is NOT in the task's ## Touches; the "(all read-only)"
    // annotation is stripped, but the bare path still fails to match -> still a blocking mismatch.
    const planBody = [
      "# Fixture Plan — trailing annotation on an undeclared path",
      "",
      "### Stage 1: annotated undeclared file",
      "- AC: 1",
      "- Files: packages/quay-native/src/other.ts (all read-only)",
      "- Command: `true`",
      "",
    ].join("\n");
    const verdict = preflightTouchesMismatch({ taskBody, secondaryBody: planBody, secondaryLabel: "plan-files" });
    assert.ok(verdict, "expected a finding");
    assert.equal(verdict.code, "preflight-touches-mismatch");
    assert.equal(verdict.blocking, true);
  });

  test("ambiguous-valid ('plan-files' call site): a Plan referencing ONLY a test/fixtures/ path (the documented touch-set-expansion case) -> reviewer-required, not blocking", () => {
    const planBody = readFixture("touches-mismatch", "plan-ambiguous.md");
    const verdict = preflightTouchesMismatch({ taskBody, secondaryBody: planBody, secondaryLabel: "plan-files" });
    assert.ok(verdict, "expected a finding");
    assert.equal(verdict.code, "preflight-ambiguous-touches-mismatch");
    assert.equal(verdict.blocking, false);
    assert.equal(verdict.disposition, "reviewer-required");
  });

  test("fail-closed: a task with an ill-formed '## Touches' section is itself a blocking finding (well-formedness precondition)", () => {
    const illFormedTask = "**type:** execution\n\n## Touches\n\n(prose, not a glob bullet list)\n";
    const verdict = preflightTouchesMismatch({ taskBody: illFormedTask, secondaryBody: readFixture("touches-mismatch", "charter-good.md"), secondaryLabel: "charter" });
    assert.ok(verdict);
    assert.equal(verdict.blocking, true);
  });

  test("preflightTouchesMismatch imports checkTouches() from task-schema.ts as its well-formedness precondition (grep-checkable reuse)", () => {
    const src = fs.readFileSync(CLI, "utf8");
    assert.match(src, /import\s*\{[^}]*checkTouches[^}]*\}\s*from\s*"\.\/task-schema\.ts"/);
    assert.match(src, /checkTouches\(\{\s*body:\s*taskBody\s*\}/);
  });
});

describe("preflightInvalidPlanCommand", () => {
  test("RED/known-bad: a Stage with no '- Command:'/'- Check:' entry -> blocking (reuses milestone-preparation-check.ts's validatePlanStructure)", () => {
    const planBody = readFixture("invalid-plan-command", "bad.md");
    const verdict = preflightInvalidPlanCommand({ planBody, acCount: 1 });
    assert.ok(verdict, "expected a finding");
    assert.equal(verdict.code, "preflight-invalid-plan-command");
    assert.equal(verdict.blocking, true);
  });

  test("known-good: a structurally-valid Stage with a real runnable Command -> zero findings", () => {
    const planBody = readFixture("invalid-plan-command", "good.md");
    assert.equal(preflightInvalidPlanCommand({ planBody, acCount: 1 }), null);
  });

  test("ambiguous-valid: structurally valid but the Command reads as prose, not a recognizable interpreter -> reviewer-required", () => {
    const planBody = readFixture("invalid-plan-command", "ambiguous.md");
    const verdict = preflightInvalidPlanCommand({ planBody, acCount: 1 });
    assert.ok(verdict, "expected a finding");
    assert.equal(verdict.code, "preflight-ambiguous-invalid-plan-command");
    assert.equal(verdict.blocking, false);
    assert.equal(verdict.disposition, "reviewer-required");
  });

  test("preflightInvalidPlanCommand reuses milestone-preparation-check.ts's parsePlanStages/validatePlanStructure verbatim (WIRING-CLAIM 7, grep-checkable)", () => {
    const src = fs.readFileSync(CLI, "utf8");
    assert.match(src, /import\s*\{[^}]*parsePlanStages[^}]*validatePlanStructure[^}]*\}\s*from\s*"\.\/milestone-preparation-check\.ts"/);
  });
});

describe("runPreflightChecks — content/plan mode dispatch", () => {
  test("mode:'content' returns ok:true, empty findings for a clean task+charter pair (all four content detectors pass simultaneously)", () => {
    const taskBody = readFixture("clean-content-pair", "task.md");
    const result = runPreflightChecks({ mode: "content", taskBody, charterBody: readFixture("clean-content-pair", "charter.md"), workspace: REPO_ROOT });
    assert.equal(result.ok, true);
    assert.equal(result.policyVersion, PREFLIGHT_POLICY_VERSION);
    assert.deepEqual(result.findings, []);
  });

  test("mode:'content' returns ok:false with a blocking finding when the merged-markdown-claims detector fires", () => {
    const taskBody = readFixture("merged-markdown-claims", "bad.md");
    const result = runPreflightChecks({ mode: "content", taskBody, charterBody: "", workspace: REPO_ROOT });
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((f) => f.code === "preflight-merged-markdown-claims" && f.blocking === true));
  });

  test("mode:'plan' returns ok:false when the Plan-shape detector fires", () => {
    const taskBody = readFixture("touches-mismatch", "task.md");
    const planBody = readFixture("invalid-plan-command", "bad.md");
    const result = runPreflightChecks({ mode: "plan", taskBody, planBody, workspace: REPO_ROOT });
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((f) => f.code === "preflight-invalid-plan-command" && f.blocking === true));
  });

  test("an unknown mode throws rather than silently returning a false pass", () => {
    assert.throws(() => runPreflightChecks({ mode: "bogus", taskBody: "x" }));
  });

  test("calibration: an uncalibrated detector's blocking verdict is downgraded to non-blocking/logged, never silently dropped", () => {
    const taskBody = readFixture("merged-markdown-claims", "bad.md");
    const savedCalibration = PREFLIGHT_CALIBRATED["preflight-merged-markdown-claims"];
    PREFLIGHT_CALIBRATED["preflight-merged-markdown-claims"] = false;
    try {
      const result = runPreflightChecks({ mode: "content", taskBody, charterBody: "", workspace: REPO_ROOT });
      const finding = result.findings.find((f) => f.code === "preflight-merged-markdown-claims");
      assert.ok(finding, "the finding must still be reported, only downgraded");
      assert.equal(finding.blocking, false);
      assert.equal(result.ok, true, "an uncalibrated detector never blocks production");
    } finally {
      PREFLIGHT_CALIBRATED["preflight-merged-markdown-claims"] = savedCalibration;
    }
  });
});

describe("CLI --preflight / --preflight-plan", () => {
  function writeTask(workspace, taskId, body) {
    fs.mkdirSync(path.join(workspace, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "tasks", `${taskId}.md`), body);
  }

  test("CLI --preflight on a clean task exits 0 with {ok:true}", () => {
    const workspace = makeWorkspace();
    writeTask(workspace, "T-PF-GOOD", readFixture("merged-markdown-claims", "good.md"));
    const res = runCli(["--preflight", "--taskId", "T-PF-GOOD", "--workspace", workspace]);
    assert.equal(res.status, 0);
    assert.equal(res.json.ok, true);
  });

  test("CLI --preflight on a known-bad task exits non-zero with {ok:false, findings:[...blocking...]}", () => {
    const workspace = makeWorkspace();
    writeTask(workspace, "T-PF-BAD", readFixture("merged-markdown-claims", "bad.md"));
    const res = runCli(["--preflight", "--taskId", "T-PF-BAD", "--workspace", workspace]);
    assert.equal(res.status, 1);
    assert.equal(res.json.ok, false);
    assert.ok(res.json.findings.some((f) => f.blocking === true));
  });

  test("CLI --preflight with a --charterFile reads real charter content into the 'charter' touches-mismatch leg", () => {
    const workspace = makeWorkspace();
    writeTask(workspace, "T-PF-CHARTER", readFixture("touches-mismatch", "task.md"));
    const charterPath = path.join(workspace, "charter.md");
    fs.writeFileSync(charterPath, readFixture("touches-mismatch", "charter-bad.md"));
    const res = runCli(["--preflight", "--taskId", "T-PF-CHARTER", "--workspace", workspace, "--charterFile", charterPath]);
    assert.equal(res.status, 1);
    assert.ok(res.json.findings.some((f) => f.code === "preflight-touches-mismatch" && f.blocking === true));
  });

  test("CLI --preflight-plan reads --planFile content into 'plan' mode", () => {
    const workspace = makeWorkspace();
    writeTask(workspace, "T-PF-PLAN", readFixture("touches-mismatch", "task.md"));
    const planPath = path.join(workspace, "plan.md");
    fs.writeFileSync(planPath, readFixture("invalid-plan-command", "bad.md"));
    const res = runCli(["--preflight-plan", "--taskId", "T-PF-PLAN", "--workspace", workspace, "--planFile", planPath]);
    assert.equal(res.status, 1);
    assert.ok(res.json.findings.some((f) => f.code === "preflight-invalid-plan-command" && f.blocking === true));
  });

  test("CLI --preflight fail-closed: a missing task file produces a distinguishable preflight-check-failed error, never a false ok:true", () => {
    const workspace = makeWorkspace();
    const res = runCli(["--preflight", "--taskId", "T-NO-SUCH-TASK", "--workspace", workspace]);
    assert.notEqual(res.status, 0);
    assert.ok(res.json);
    assert.equal(res.json.code, "preflight-check-failed");
    assert.notEqual(res.json.ok, true);
  });

  test("CLI --preflight-plan fail-closed: a missing/absent --planFile produces preflight-check-failed, never a false pass", () => {
    const workspace = makeWorkspace();
    writeTask(workspace, "T-PF-NOPLAN", readFixture("touches-mismatch", "task.md"));
    const res = runCli(["--preflight-plan", "--taskId", "T-PF-NOPLAN", "--workspace", workspace, "--planFile", path.join(workspace, "does-not-exist.md")]);
    assert.notEqual(res.status, 0);
    assert.ok(res.json);
    assert.equal(res.json.code, "preflight-check-failed");
  });
});

// ── Real production wiring: --preflight/--preflight-plan use the SAME parseArgs/spec.flags
// machinery --acquire/--renew/--release already use — WIRING-CLAIM 9. ──────────────────────────────
test("WIRING-CLAIM 9: --preflight/--preflight-plan/planFile/charterFile are added to the SAME spec.flags object parseArgs already consumes for acquire/renew/release", () => {
  const src = fs.readFileSync(CLI, "utf8");
  const mainBody = src.slice(src.indexOf("async function main"));
  assert.match(mainBody, /preflight:\s*\{\s*type:\s*"boolean"\s*\}/);
  assert.match(mainBody, /"preflight-plan":\s*\{\s*type:\s*"boolean"\s*\}/);
  assert.match(mainBody, /planFile:\s*\{\s*type:\s*"string"\s*\}/);
  assert.match(mainBody, /charterFile:\s*\{\s*type:\s*"string"\s*\}/);
  // Exactly ONE parseArgs(argv, spec) call in this file — the preflight flags share it, not a
  // second parser.
  const parseArgsCalls = [...src.matchAll(/parseArgs\(/g)];
  assert.equal(parseArgsCalls.length, 1, "expected exactly one parseArgs() call site in the whole module");
});
