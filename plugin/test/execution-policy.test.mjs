// @test-group engine
// execution-policy.test.mjs — RED/GREEN fixture tests for execution-policy.ts (the versioned
// execution-policy substrate consumed by finding back-propagation,
// gap-audit-findings-not-backpropagated-to-earlier-detectors).
//
// Byte-identical mirror: plugin/test/execution-policy.test.mjs
//
// Path-resolution pin (matching stage-receipt.test.mjs): every direct-module import resolves
// EXCLUSIVELY against the experiments canonical path; plugin/scripts/execution-policy.ts is only
// ever compared byte-for-byte, never imported.
//
// Run:
//   scripts/test.sh plugin/test/execution-policy.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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

const POLICY_TS = path.join(SCRIPTS, "execution-policy.ts");
const PLUGIN_POLICY_TS = path.join(PLUGIN_SCRIPTS, "execution-policy.ts");

function pathToFile(p) {
  return new URL(`file://${p}`).href;
}

function runScript(args) {
  try {
    const stdout = execFileSync("node", ["--no-warnings", "--experimental-strip-types", POLICY_TS, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 60_000,
    });
    return { stdout, exitCode: 0 };
  } catch (e) {
    return { stdout: e.stdout ? String(e.stdout) : "", exitCode: e.status ?? 1 };
  }
}

const REQ = {
  detector: { detectorId: "det-ac-coverage-citations", recurrenceKey: "ac7-checklist-missing", rule: "detectAcCoverageCitations", stage: "PlanCheck" },
  authorizer: { role: "policy-owner", id: "p1" },
  proposingObserverStage: "Audit",
  calibrationOk: true,
  calibrationRef: { red: 1, green: 2, ambiguous: 1, redHitRate: 1, falsePositiveRate: 0 },
};

test("mirror parity: execution-policy.ts byte-identical across experiments/plugin", () => {
  assert.equal(fs.readFileSync(POLICY_TS, "utf8"), fs.readFileSync(PLUGIN_POLICY_TS, "utf8"));
});

test("versioned policy: createPolicy sets a deterministic sha256 policyHash; identical profiles hash identically", async () => {
  const mod = await import(pathToFile(POLICY_TS));
  assert.equal(mod.POLICY_SCHEMA_VERSION, "1");
  const p1 = mod.createPolicy({ dev: { gates: ["dod"] } });
  assert.equal(typeof p1.policyHash, "string");
  assert.equal(p1.policyHash.length, 64);
  const p2 = mod.createPolicy({ dev: { gates: ["dod"] } });
  assert.equal(p2.policyHash, p1.policyHash, "deterministic hash for identical content");
  const p3 = mod.createPolicy({ dev: { gates: ["dod", "acceptance"] } });
  assert.notEqual(p3.policyHash, p1.policyHash, "a profile change changes the hash");
});

test("AC3: authorizeActivation refuses non-authorized roles, same-actor, and unproven detectors; only a distinct policy-owner activates", async () => {
  const mod = await import(pathToFile(POLICY_TS));
  const policy = mod.createPolicy();

  // auditor (the proposing observer) cannot self-activate
  const r1 = mod.authorizeActivation(policy, { ...REQ, authorizer: { role: "Audit", id: "a1" } });
  assert.equal(r1.ok, false);
  assert.ok(r1.reason.includes("authorizer-role-not-authorized"), r1.reason);

  // same-actor: authorizer role equals the proposing observer stage
  const r2 = mod.authorizeActivation(policy, { ...REQ, authorizer: { role: "policy-owner", id: "audit-session" }, proposingObserverStage: "policy-owner" });
  assert.equal(r2.ok, false);
  assert.ok(r2.reason.includes("same-actor-self-authorization"), r2.reason);

  // unproven detector (calibrationOk false) refused
  const r3 = mod.authorizeActivation(policy, { ...REQ, calibrationOk: false });
  assert.equal(r3.ok, false);
  assert.ok(r3.reason.includes("detector-not-calibrated"), r3.reason);

  // a distinct policy-owner CAN activate
  const r4 = mod.authorizeActivation(policy, REQ);
  assert.equal(r4.ok, true, r4.reason);
  assert.equal(r4.activated.detectorId, REQ.detector.detectorId);
  assert.equal(r4.activated.authorizedBy, "policy-owner");
  assert.notEqual(r4.policyBefore, r4.policyAfter);
});

test("AC4: invalidateReceiptsForPolicyChange invalidates exactly the affected subset", async () => {
  const mod = await import(pathToFile(POLICY_TS));
  const oldHash = "a".repeat(64);
  const newHash = "b".repeat(64);
  const bindings = [
    { receiptId: "affect", policyHash: oldHash, recurrenceKey: "ac7-checklist-missing" },
    { receiptId: "other-class", policyHash: oldHash, recurrenceKey: "build-null-result-accepted-as-success" },
    { receiptId: "new-hash", policyHash: newHash, recurrenceKey: "ac7-checklist-missing" },
  ];
  const inv = mod.invalidateReceiptsForPolicyChange(oldHash, newHash, { recurrenceKey: "ac7-checklist-missing" }, bindings);
  assert.deepEqual(inv.invalidated, ["affect"]);
  assert.deepEqual(inv.unaffected.sort(), ["new-hash", "other-class"]);
});

test("AC8: revokeActivation requires a reason, refuses inactive detectors, and changes the policy hash", async () => {
  const mod = await import(pathToFile(POLICY_TS));
  const policy = mod.createPolicy();
  const act = mod.authorizeActivation(policy, REQ);
  assert.equal(act.ok, true, act.reason);
  const activePolicy = { ...policy, policyHash: act.policyAfter, activatedDetectors: act.activated ? [act.activated] : [] };

  const rev = mod.revokeActivation(activePolicy, REQ.detector.detectorId, { reason: "false positive on M213", actor: "policy-owner" });
  assert.equal(rev.ok, true, rev.reason);
  assert.equal(rev.revoked.detectorId, REQ.detector.detectorId);
  assert.ok(rev.revoked.revoked.reason.includes("false positive"));
  assert.notEqual(rev.policyBefore, rev.policyAfter);

  const noReason = mod.revokeActivation(activePolicy, REQ.detector.detectorId, { reason: "", actor: "p" });
  assert.equal(noReason.ok, false);

  const inactive = mod.revokeActivation(activePolicy, "not-active", { reason: "fp", actor: "p" });
  assert.equal(inactive.ok, false);
  assert.ok(inactive.reason.includes("detector-not-active"));
});

test("CLI: --selftest exits 0; --create emits a policy with a hash; --compute-hash is deterministic", async () => {
  const st = runScript(["--selftest"]);
  assert.equal(st.exitCode, 0, st.stdout.slice(-300));
  const created = runScript(["--create", "{\"dev\":{\"gates\":[\"dod\"]}}"]);
  assert.equal(created.exitCode, 0);
  const parsed = JSON.parse(created.stdout);
  assert.equal(parsed.policyHash.length, 64);
  const h = runScript(["--compute-hash", created.stdout]);
  assert.equal(h.exitCode, 0);
  assert.equal(JSON.parse(h.stdout).policyHash, parsed.policyHash);
});
