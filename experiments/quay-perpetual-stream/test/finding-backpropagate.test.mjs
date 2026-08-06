// @test-group engine
// finding-backpropagate.test.mjs — RED/GREEN fixture tests for finding-backpropagate.ts
// (the Prepare/Execute feedback back-propagation mechanism,
// gap-audit-findings-not-backpropagated-to-earlier-detectors).
//
// Byte-identical mirror: plugin/test/finding-backpropagate.test.mjs
//
// The AC2 "one real finding" proof uses the REAL, independently-confirmed M208 finding
// (milestones/M208/proposal-ledger.json entry 55016c0b, rootCauseKey ac7-checklist-missing) —
// not a manufactured success case. Its complete inputs (the task file with the "### AC coverage
// mapping" section and the "## Acceptance Criteria" checklist) exist at PlanCheck.
//
// Path-resolution pin (matching stage-receipt.test.mjs): every direct-module import and CLI
// subprocess dispatch resolves EXCLUSIVELY against the experiments canonical path
// (experiments/quay-perpetual-stream/scripts/...) — plugin/scripts/finding-backpropagate.ts is
// only ever compared byte-for-byte, never imported.
//
// Run:
//   scripts/test.sh plugin/test/finding-backpropagate.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function _findRepoRoot(startDir) {
  // Prefer the workspace marker (.quay/config.yml); fall back to the git root so a worktree whose
  // gitignored .quay/config.yml was not provisioned still resolves correctly.
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find repo root: no .quay/config.yml or .git found upward from " + startDir);
}
const REPO_ROOT = _findRepoRoot(__dirname);
const SCRIPTS = path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts");
const PLUGIN_SCRIPTS = path.join(REPO_ROOT, "plugin", "scripts");
const TMP = os.tmpdir();

const BACKPROP_TS = path.join(SCRIPTS, "finding-backpropagate.ts");
const PLUGIN_BACKPROP_TS = path.join(PLUGIN_SCRIPTS, "finding-backpropagate.ts");
const POLICY_TS = path.join(SCRIPTS, "execution-policy.ts");
const PLUGIN_POLICY_TS = path.join(PLUGIN_SCRIPTS, "execution-policy.ts");
const REAL_LEDGER = path.join(REPO_ROOT, "milestones", "M208", "proposal-ledger.json");
const REAL_TASK = path.join(REPO_ROOT, "tasks", "gap-build-phase-null-result-not-gated.md");

// ── Corpus fixtures for the ac7-checklist-missing class (the REAL M208 finding class) ──────────────

const RED_FIXTURE = [
  "### AC coverage mapping (DIR-117 mechanism-claim wiring)",
  "- **AC1 (positive gate in both mirrors):** CLAIM: the gate exists.",
  "- **AC7 (diff-minimality: fix introduces zero new agent() dispatches, zero new phases):**",
  "  CLAIM: verified by AC7.",
  "## Acceptance Criteria",
  "- [x] AC1 gate exists.",
  "- [x] AC2 grep-confirmable.",
  "- [x] AC3 regression test.",
  "- [x] AC4 separate fixtures.",
  "- [x] AC5 static call-path.",
  "- [x] AC6 existing tests pass.",
].join("\n");

const GREEN_FIXTURE = [
  "### AC coverage mapping (DIR-117 mechanism-claim wiring)",
  "- **AC1:** CLAIM: x.",
  "- **AC2:** CLAIM: y.",
  "## Acceptance Criteria",
  "- [x] one",
  "- [x] two",
].join("\n");

const AMBIGUOUS_VALID_FIXTURE = [
  "## Acceptance Criteria",
  "- [x] one",
  "- [x] two",
].join("\n");

const PLANCHECK_STAGE_FACTS = {
  PlanCheck: ["tasks/gap-build-phase-null-result-not-gated.md"],
  Verify: ["tasks/gap-build-phase-null-result-not-gated.md"],
  Build: ["tasks/gap-build-phase-null-result-not-gated.md"],
};

// ── Real M208 finding (from the canonical checked-in ledger) ───────────────────────────────────────

function realM208Finding() {
  const ledger = JSON.parse(fs.readFileSync(REAL_LEDGER, "utf8"));
  const entry = ledger.find((e) => e.id === "55016c0b");
  assert.ok(entry, "M208 proposal-ledger.json must contain finding 55016c0b (ac7-checklist-missing)");
  return entry;
}

function stageReceipt() {
  return import(pathToFile(BACKPROP_TS.replace("finding-backpropagate.ts", "stage-receipt.ts")));
}

function pathToFile(p) {
  return new URL(`file://${p}`).href;
}

// ── CLI subprocess helper ───────────────────────────────────────────────────────────────────────────

function runScript(scriptPath, args, opts = {}) {
  const { cwd = REPO_ROOT } = opts;
  try {
    const stdout = execFileSync("node", ["--no-warnings", "--experimental-strip-types", scriptPath, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 60_000,
    });
    return { stdout, exitCode: 0 };
  } catch (e) {
    return { stdout: e.stdout ? String(e.stdout) : "", exitCode: e.status ?? 1 };
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────────────────────────────

test("mirror parity: finding-backpropagate.ts + execution-policy.ts byte-identical across experiments/plugin", () => {
  assert.equal(fs.readFileSync(BACKPROP_TS, "utf8"), fs.readFileSync(PLUGIN_BACKPROP_TS, "utf8"), "finding-backpropagate.ts mirrors must be byte-identical");
  assert.equal(fs.readFileSync(POLICY_TS, "utf8"), fs.readFileSync(PLUGIN_POLICY_TS, "utf8"), "execution-policy.ts mirrors must be byte-identical");
});

test("AC2: the REAL M208 finding migrates via the canonical ledger adapter and classifies eligible for PlanCheck", async () => {
  const sr = await stageReceipt();
  const mod = await import(pathToFile(BACKPROP_TS));
  const entry = realM208Finding();

  const mig = sr.migratePrepareLedger(entry, { sourceRecordId: "M208:55016c0b", sourceHashes: { ledger: "fixture" } });
  assert.equal(mig.ok, true, JSON.stringify(mig));
  const finding = mig.finding;
  assert.equal(finding.findingId, "55016c0b");
  assert.equal(finding.recurrenceKey, "ac7-checklist-missing", "rootCauseKey -> stable recurrence identity");

  // complete-input proof: bind the real task file hash (the input existed at PlanCheck).
  finding.materialInputHashes = { "tasks/gap-build-phase-null-result-not-gated.md": sr.sha256OfString(fs.readFileSync(REAL_TASK, "utf8")) };

  const cls = mod.classifyFinding(finding, PLANCHECK_STAGE_FACTS, { targetStage: "PlanCheck" });
  assert.equal(cls.promotionAllowed, true, JSON.stringify(cls.rejectionReasons));
  assert.equal(cls.earliestDetectableStage, "PlanCheck");
  assert.equal(cls.generalization, "profile", "everBlocking + major severity => recurrence/generalizable");
  assert.equal(cls.detectorCandidate.rule, "detectAcCoverageCitations");
  assert.equal(cls.detectorCandidate.recurrenceKey, "ac7-checklist-missing");
});

test("AC1: runtime-only finding (M192 Build-null class) is REJECTED for promotion to PlanCheck and stays Audit/Wiring-Audit scoped", async () => {
  const mod = await import(pathToFile(BACKPROP_TS));
  const runtimeOnly = {
    schemaVersion: "1",
    findingId: "m192-build-null",
    recurrenceKey: "build-null-result-accepted-as-success",
    observerStage: "Audit",
    subsystem: "Execute feedback-integrity",
    claimRef: "M192",
    severity: "blocker",
    blocking: true,
    everBlocking: true,
    evidence: [],
    materialInputHashes: { buildRuntimeResult: "null" },
    firstSeenGeneration: 0,
    lastSeenGeneration: 0,
    disposition: "backlog",
    resolution: null,
    generalization: "task-specific",
  };
  const facts = {
    PlanCheck: ["tasks/M192.md"],
    Build: ["tasks/M192.md", "buildRuntimeResult"],
    Audit: ["tasks/M192.md", "buildRuntimeResult", "candidateCommit"],
  };
  const cls = mod.classifyFinding(runtimeOnly, facts, { targetStage: "PlanCheck" });
  assert.equal(cls.promotionAllowed, false);
  assert.ok(cls.rejectionReasons.some((r) => r.includes("required evidence does not exist at proposed earlier stage PlanCheck")), JSON.stringify(cls.rejectionReasons));
  assert.equal(cls.earliestDetectableStage, "Build", "the runtime fact first exists at Build, so it cannot be promoted before Build");
  assert.equal(cls.detectorCandidate, null);
});

test("AC2: a finding with NO material input hashes (incomplete-input proof) is never promoted", async () => {
  const mod = await import(pathToFile(BACKPROP_TS));
  const empty = {
    schemaVersion: "1",
    findingId: "no-inputs",
    recurrenceKey: "ac7-checklist-missing",
    observerStage: "Audit",
    subsystem: "x",
    claimRef: "x",
    severity: "major",
    blocking: false,
    everBlocking: true,
    evidence: [],
    materialInputHashes: {},
    firstSeenGeneration: 0,
    lastSeenGeneration: 1,
    disposition: "backlog",
    resolution: null,
    generalization: "task-specific",
  };
  const cls = mod.classifyFinding(empty, PLANCHECK_STAGE_FACTS, { targetStage: "PlanCheck" });
  assert.equal(cls.promotionAllowed, false);
  assert.ok(cls.rejectionReasons.some((r) => r.includes("incomplete-input proof")), JSON.stringify(cls.rejectionReasons));
  assert.equal(cls.detectorCandidate, null);
});

test("AC1: a runtime-only finding whose facts exist at NO declared stage remains observer/Audit scoped", async () => {
  const mod = await import(pathToFile(BACKPROP_TS));
  const ghost = {
    schemaVersion: "1",
    findingId: "ghost-runtime",
    recurrenceKey: "runtime-trace-only",
    observerStage: "WiringAudit",
    subsystem: "x",
    claimRef: "x",
    severity: "major",
    blocking: false,
    everBlocking: false,
    evidence: [],
    materialInputHashes: { liveRuntimeTrace: "t" },
    firstSeenGeneration: 0,
    lastSeenGeneration: 0,
    disposition: "backlog",
    resolution: null,
    generalization: "task-specific",
  };
  const cls = mod.classifyFinding(ghost, { PlanCheck: ["task.md"] }, { targetStage: "PlanCheck" });
  assert.equal(cls.promotionAllowed, false);
  assert.equal(cls.earliestDetectableStage, null);
  assert.ok(cls.rejectionReasons.some((r) => r.includes("runtime-only")), JSON.stringify(cls.rejectionReasons));
});

test("AC2: RED/GREEN/ambiguous calibration passes with redHitRate=1 and falsePositiveRate=0", async () => {
  const mod = await import(pathToFile(BACKPROP_TS));
  const det = { detectorId: "det-ac-coverage-citations", recurrenceKey: "ac7-checklist-missing", rule: "detectAcCoverageCitations", stage: "PlanCheck" };
  const cal = mod.proveDetector(det, { red: [RED_FIXTURE], green: [GREEN_FIXTURE, fs.readFileSync(REAL_TASK, "utf8")], ambiguous: [AMBIGUOUS_VALID_FIXTURE] });
  assert.equal(cal.ok, true, JSON.stringify(cal));
  assert.equal(cal.redHitRate, 1);
  assert.equal(cal.falsePositiveRate, 0);
  assert.equal(cal.ambiguousValidRate, 1);
  // the real current task file (class resolved) must be GREEN
  assert.equal(cal.green[1].flagged, false);
});

test("AC3: the originating observer cannot activate its own candidate; a policy-owner can", async () => {
  const bp = await import(pathToFile(BACKPROP_TS));
  const ep = await import(pathToFile(POLICY_TS));
  const finding = {
    schemaVersion: "1",
    findingId: "55016c0b",
    recurrenceKey: "ac7-checklist-missing",
    observerStage: "Audit",
    subsystem: "x",
    claimRef: "x",
    severity: "major",
    blocking: false,
    everBlocking: true,
    evidence: [],
    materialInputHashes: { task: "h" },
    firstSeenGeneration: 0,
    lastSeenGeneration: 1,
    disposition: "backlog",
    resolution: null,
    generalization: "task-specific",
  };
  const det = { detectorId: "det-ac-coverage-citations", recurrenceKey: "ac7-checklist-missing", rule: "detectAcCoverageCitations", stage: "PlanCheck" };
  const cal = bp.proveDetector(det, { red: [RED_FIXTURE], green: [GREEN_FIXTURE], ambiguous: [AMBIGUOUS_VALID_FIXTURE] });
  const policy = ep.createPolicy({ dev: { gates: ["dod"] } });

  const selfAttempt = bp.backpropagate(policy, finding, det, cal, { authorizer: { role: "Audit", id: "audit-1" }, receipts: [] });
  assert.equal(selfAttempt.ok, false);
  assert.ok(selfAttempt.reason.includes("authorizer-role-not-authorized"), selfAttempt.reason);

  // the direct execution-policy module covers the same-actor guard (authorizer role == observer
  // stage) — here, the legitimate case: a distinct policy-owner CAN activate despite the finding's
  // observer being Audit.
  const distinctOwner = bp.backpropagate(policy, finding, det, cal, { authorizer: { role: "policy-owner", id: "policy-1" }, receipts: [] });
  assert.equal(distinctOwner.ok, true, "a distinct policy-owner (not the observing Audit) may activate");

  const authorized = bp.backpropagate(policy, finding, det, cal, { authorizer: { role: "policy-owner", id: "policy-1" }, receipts: [] });
  assert.equal(authorized.ok, true, authorized.reason);
});

test("AC4: policy activation changes the policy hash and invalidates exactly the affected cached receipts", async () => {
  const bp = await import(pathToFile(BACKPROP_TS));
  const ep = await import(pathToFile(POLICY_TS));
  const finding = {
    schemaVersion: "1",
    findingId: "55016c0b",
    recurrenceKey: "ac7-checklist-missing",
    observerStage: "ProposalReview",
    subsystem: "x",
    claimRef: "x",
    severity: "major",
    blocking: false,
    everBlocking: true,
    evidence: [],
    materialInputHashes: { task: "h" },
    firstSeenGeneration: 0,
    lastSeenGeneration: 1,
    disposition: "backlog",
    resolution: null,
    generalization: "task-specific",
  };
  const det = { detectorId: "det-ac-coverage-citations", recurrenceKey: "ac7-checklist-missing", rule: "detectAcCoverageCitations", stage: "PlanCheck" };
  const cal = bp.proveDetector(det, { red: [RED_FIXTURE], green: [GREEN_FIXTURE], ambiguous: [AMBIGUOUS_VALID_FIXTURE] });
  const policy = ep.createPolicy({ dev: { gates: ["dod"] } });

  const receipts = [
    { receiptId: "r-affect", policyHash: policy.policyHash, recurrenceKey: "ac7-checklist-missing" },
    { receiptId: "r-other-class", policyHash: policy.policyHash, recurrenceKey: "build-null-result-accepted-as-success" },
    { receiptId: "r-different-hash", policyHash: "deadbeef".repeat(8), recurrenceKey: "ac7-checklist-missing" },
  ];
  const res = bp.backpropagate(policy, finding, det, cal, { authorizer: { role: "policy-owner", id: "p1" }, receipts });
  assert.equal(res.ok, true, res.reason);
  assert.notEqual(res.activation.policyBefore, res.activation.policyAfter, "policy hash must change on activation");
  assert.deepEqual(res.invalidation.invalidated, ["r-affect"]);
  assert.deepEqual(res.invalidation.unaffected.sort(), ["r-different-hash", "r-other-class"]);
});

test("AC6: back-propagation is read-only on task/audit state — the later Acceptance/Wiring Audit stays enabled", async () => {
  const bp = await import(pathToFile(BACKPROP_TS));
  const ep = await import(pathToFile(POLICY_TS));
  const finding = {
    schemaVersion: "1",
    findingId: "55016c0b",
    recurrenceKey: "ac7-checklist-missing",
    observerStage: "ProposalReview",
    subsystem: "x",
    claimRef: "x",
    severity: "major",
    blocking: false,
    everBlocking: true,
    evidence: [],
    materialInputHashes: { task: "h" },
    firstSeenGeneration: 0,
    lastSeenGeneration: 1,
    disposition: "backlog",
    resolution: null,
    generalization: "task-specific",
  };
  const det = { detectorId: "det-ac-coverage-citations", recurrenceKey: "ac7-checklist-missing", rule: "detectAcCoverageCitations", stage: "PlanCheck" };
  const cal = bp.proveDetector(det, { red: [RED_FIXTURE], green: [GREEN_FIXTURE], ambiguous: [AMBIGUOUS_VALID_FIXTURE] });
  const policy = ep.createPolicy();
  const res = bp.backpropagate(policy, finding, det, cal, { authorizer: { role: "policy-owner", id: "p1" }, receipts: [] });
  assert.equal(res.ok, true, res.reason);
  // The back-propagation result contains ONLY the policy + invalidation — no task status, no audit
  // verdict, no checkbox writes. The independent review path is untouched (no state returned to mutate).
  assert.deepEqual(Object.keys(res.activation).sort(), ["detectorId", "ok", "policyAfter", "policyBefore", "reason", "stage"]);
  assert.equal("status" in res, false);
  assert.equal("verdict" in res, false);
});

test("AC7: metrics are reproducible from canonical receipts + DIR-126-D/E telemetry; missing cost inputs are explicit unknowns", async () => {
  const mod = await import(pathToFile(BACKPROP_TS));
  const policy = { policyHash: "abc", activatedDetectors: [{ recurrenceKey: "ac7-checklist-missing" }] };
  const report = mod.reportBackpropagationMetrics({
    findings: [
      { findingId: "55016c0b", recurrenceKey: "ac7-checklist-missing", generalization: "profile", firstSeenGeneration: 0, lastSeenGeneration: 1, observerStage: "ProposalReview" },
      { findingId: "x2", recurrenceKey: "build-null-result-accepted-as-success", generalization: "task-specific", firstSeenGeneration: 0, lastSeenGeneration: 0, observerStage: "Audit" },
    ],
    policy,
    telemetryFiles: [],
  });
  assert.equal(report.schemaVersion, "1");
  assert.equal(report.totalFindings, 2);
  assert.equal(report.generalizableFindings, 1);
  assert.equal(report.promotedFindings, 1);
  assert.equal(report.backPropagationRate, 1);
  assert.equal(report.recurringFindings, 1);
  // missing cost inputs reported as EXPLICIT unknowns, never fabricated
  assert.equal(report.recurrenceWasteAgentMinutes.unknown, true);
  assert.equal(report.recurrenceWasteAgentMinutes.value, null);
  assert.equal(report.tokenDelta.unknown, true);
  assert.ok(report.unknownFields.length >= 2);
});

test("AC8: a false-positive/reopened-finding control disables the candidate safely and records policy+receipt consequences", async () => {
  const bp = await import(pathToFile(BACKPROP_TS));
  const ep = await import(pathToFile(POLICY_TS));
  const finding = {
    schemaVersion: "1",
    findingId: "55016c0b",
    recurrenceKey: "ac7-checklist-missing",
    observerStage: "ProposalReview",
    subsystem: "x",
    claimRef: "x",
    severity: "major",
    blocking: false,
    everBlocking: true,
    evidence: [],
    materialInputHashes: { task: "h" },
    firstSeenGeneration: 0,
    lastSeenGeneration: 1,
    disposition: "backlog",
    resolution: null,
    generalization: "task-specific",
  };
  const det = { detectorId: "det-ac-coverage-citations", recurrenceKey: "ac7-checklist-missing", rule: "detectAcCoverageCitations", stage: "PlanCheck" };
  const cal = bp.proveDetector(det, { red: [RED_FIXTURE], green: [GREEN_FIXTURE], ambiguous: [AMBIGUOUS_VALID_FIXTURE] });
  const policy = ep.createPolicy();
  const act = ep.authorizeActivation(policy, {
    detector: { detectorId: det.detectorId, recurrenceKey: det.recurrenceKey, rule: det.rule, stage: det.stage },
    authorizer: { role: "policy-owner", id: "p1" },
    proposingObserverStage: finding.observerStage,
    calibrationOk: cal.ok,
    calibrationRef: { red: 1, green: 2, ambiguous: 1, redHitRate: 1, falsePositiveRate: 0 },
  });
  assert.equal(act.ok, true, act.reason);
  const activePolicy = {
    ...policy,
    policyHash: act.policyAfter,
    activatedDetectors: act.activated ? [act.activated] : [],
  };

  const ctl = bp.controlFalsePositive(activePolicy, det, {
    reason: "false positive on M213 green corpus",
    actor: "policy-owner",
    receipts: [{ receiptId: "r-fp", policyHash: activePolicy.policyHash, recurrenceKey: det.recurrenceKey }],
  });
  assert.equal(ctl.ok, true, ctl.reason);
  assert.equal(ctl.revocation.ok, true);
  assert.notEqual(ctl.revocation.policyBefore, ctl.revocation.policyAfter, "revocation changes the policy hash");
  assert.deepEqual(ctl.invalidation.invalidated, ["r-fp"]);

  // revoking an inactive detector fails closed
  const bad = bp.controlFalsePositive(activePolicy, { ...det, detectorId: "not-active" }, {
    reason: "fp",
    actor: "policy-owner",
    receipts: [],
  });
  assert.equal(bad.ok, false);
});

test("CLI: --selftest exits 0; --detect-ac-citations on the fixed real task exits 0", async () => {
  const st = runScript(BACKPROP_TS, ["--selftest"]);
  assert.equal(st.exitCode, 0, st.stdout.slice(-500));
  const det = runScript(BACKPROP_TS, ["--detect-ac-citations", REAL_TASK]);
  assert.equal(det.exitCode, 0, det.stdout);
  assert.ok(det.stdout.includes('"ok":true'), det.stdout);
});
