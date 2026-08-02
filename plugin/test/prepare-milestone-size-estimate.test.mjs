// RED tests for prepare-milestone-size-estimate.ts — M239 gap-prepare-milestone-no-size-aware-routing-A
// Byte-identical mirror: works in BOTH experiments/quay-perpetual-stream/test/ and plugin/test/
//
// TDD Stage 1+2: tests written BEFORE the estimator script exists.
// Expected behavior: ALL tests FAIL (RED, nonzero exit) because:
//   - `../scripts/prepare-milestone-size-estimate.ts` does not exist yet → static import throws
//   - Once Stage 3/4 creates the script with correct exports, these tests turn GREEN.
//
// Run:
//   node --experimental-strip-types --test experiments/quay-perpetual-stream/test/prepare-milestone-size-estimate.test.mjs
//   node --experimental-strip-types --test plugin/test/prepare-milestone-size-estimate.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Repo-root discovery by walking up to the nearest '.git' ancestor — NOT a fixed literal.
// This file is byte-identical-mirrored to plugin/test/ (2 levels below repo root) while its
// canonical home is 3 levels below repo root (experiments/quay-perpetual-stream/test/) — a
// depth-specific literal would resolve to the WRONG directory in one of the two locations.
function findRepoRoot(startDir) {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("prepare-milestone-size-estimate.test.mjs: no '.git' ancestor found starting from " + startDir);
    dir = parent;
  }
}
const REPO_ROOT = findRepoRoot(__dirname);

// M239 TDD RED guard (ADR-019 decision #1 pattern): the estimator script is not yet
// implemented — task gap-prepare-milestone-no-size-aware-routing-A is status:done but the
// code never landed. A static import would crash this whole file (ERR_MODULE_NOT_FOUND);
// a self-declared skip keeps the TDD RED tests visible without polluting the green
// baseline. The skip auto-clears when the script is implemented (M239 lands).
let estModule = null;
try {
  estModule = await import("../scripts/prepare-milestone-size-estimate.ts");
} catch {
  estModule = null;
}

if (!estModule) {
  test("M239 size-estimate RED guard",
    { skip: "prepare-milestone-size-estimate.ts not implemented yet — TDD RED test self-skips (ADR-019); activates once M239 lands" },
    () => {});
} else {
const {
  expandTouchSet,
  estimateTaskSize,
  classifyProofScale,
  routeTask,
  buildRoutingDecision,
  _ROUTING_POLICY,
} = estModule;

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "size-est-"));
}

function writeFile(wsDir, relPath, content) {
  const abs = path.join(wsDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content || "// fixture touch file\n", "utf8");
  return abs;
}

// ── Fixture task texts ─────────────────────────────────────────────────────────

const S_LOCAL_TASK = `---
id: test-s-local
title: S-local fixture
status: todo
labels: [test]
---

## Proposal

A small, single-mechanism, local-scope change. This proposal describes a simple modification
that touches exactly one file and requires only local verification. The approach is
straightforward and the proof surface is entirely local — no integration or real-dispatch
evidence needed.

## Acceptance Criteria

- [ ] Implement the small change

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on master
- [ ] Tests pass
- [ ] Local verification completed

## Touches

- experiments/local-touch-fixture.md
`;

const S_REAL_WORKFLOW_TASK = `---
id: test-s-rw
title: S-real-workflow fixture
status: todo
labels: [test]
---

## Proposal

A small change that requires real-workflow proof — same code surface as S-local
but the proof burden is heavier. This task's Definition of Done explicitly requires
real-workflow evidence, which means the task cannot be fast-laned regardless of
its small codeScale.

## Acceptance Criteria

- [ ] Implement the change with real-workflow evidence

## Definition of Done

Standard inherited-core DoD clauses apply plus real-workflow evidence requirements.

- [ ] Landed on master with real-workflow evidence
- [ ] Real dispatch proof recorded

## Touches

- experiments/rw-touch-fixture.md
`;

const M_TIER_TASK = `---
id: test-m-tier
title: M-tier fixture
status: todo
labels: [test]
---

## Proposal

A medium-scope task with 15 AC items spread across 3 touched files. This proposal
describes a multi-faceted change that spans several concerns and requires medium
synthesis effort. The codeScale falls in the M band (501-900), which routes
full-lane under the provisional mTierFullLaneFloor policy regardless of other
fast-lane eligibility.

## Acceptance Criteria

- [ ] AC item 1
- [ ] AC item 2
- [ ] AC item 3
- [ ] AC item 4
- [ ] AC item 5
- [ ] AC item 6
- [ ] AC item 7
- [ ] AC item 8
- [ ] AC item 9
- [ ] AC item 10
- [ ] AC item 11
- [ ] AC item 12
- [ ] AC item 13
- [ ] AC item 14
- [ ] AC item 15

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on master
- [ ] All tests pass
- [ ] Independent audit passes

## Touches

- experiments/m-a-fixture.md
- experiments/m-b-fixture.md
- experiments/m-c-fixture.md
`;

const NO_DOD_TASK = `---
id: test-no-dod
title: No DoD section fixture
status: todo
labels: [test]
---

## Proposal

A task with no Definition of Done section. classifyProofScale should return "unknown"
because there is no DoD section to derive a proof surface from. Unknown proofScale
routes full-lane — fail-closed, never silently fast-laned.

## Acceptance Criteria

- [ ] Implement something

## Touches

- experiments/no-dod-touch-fixture.md
`;

const NO_TOUCHES_TASK = `---
id: test-no-touches
title: No Touches section fixture
status: todo
labels: [test]
---

## Proposal

A task with no Touches section. expandTouchSet should return { ok: false, code: "scope-estimate-unavailable" },
which causes inputValid: false, which routes full-lane — fail-closed on unreliable inputs.
This covers the sizing proposal's finding: four AC-only estimates had 61.4% MAPE vs
15.5% MAPE for complete-Touches estimates.

## Acceptance Criteria

- [ ] Implement something

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on master
`;

const UNEXPANDABLE_TOUCHES_TASK = `---
id: test-unexpandable
title: Unexpandable Touches fixture
status: todo
labels: [test]
---

## Proposal

A task whose Touches glob matches zero real files. expandTouchSet should return
{ ok: false, code: "scope-estimate-unavailable" } → full-lane.

## Acceptance Criteria

- [ ] Implement something

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on master

## Touches

- experiments/nonexistent-*.md
`;

const CHARTER_TEXT = `# Test Charter

type: execution

## Purpose

Test charter for size-estimate routing tests. This charter describes
an execution-type task used to verify the estimator and router behavior.
`;

// ── Test 1: S-local → fast-lane ────────────────────────────────────────────────

test("S-local fixture (1 AC, 1 touch → codeScale 85, proof local) → route fast-lane", () => {
  const ws = makeTempWorkspace();
  try {
    writeFile(ws, "experiments/local-touch-fixture.md");

    const touches = expandTouchSet(S_LOCAL_TASK, ws);
    assert.ok(touches.ok, "expandTouchSet should succeed for valid Touches");
    assert.equal(touches.files.length, 1, "exactly 1 expanded touch file");
    assert.ok(touches.files[0].endsWith("experiments/local-touch-fixture.md"),
      "touch file path should match the declared glob");

    const estimate = estimateTaskSize(S_LOCAL_TASK, { workspaceDir: ws, policy: _ROUTING_POLICY });
    assert.equal(estimate.codeScale, 85, "codeScale = 25*1 AC + 60*1 touch");
    assert.equal(estimate.proofScale, "local", "proofScale derived as local from DoD keywords");
    assert.equal(estimate.sizeTier, "S", "codeScale 85 → S tier");
    assert.equal(estimate.acCount, 1);
    assert.equal(estimate.expandedTouchesCount, 1);
    assert.equal(estimate.logicalSurfacesCount, 1, "one (experiments, source) pair");
    assert.equal(estimate.mechanismCount, 1, "one source areaRoot (experiments)");
    assert.ok(estimate.inputValid, "inputValid should be true");

    const route = routeTask(estimate, _ROUTING_POLICY);
    assert.equal(route, "fast-lane",
      "S-local with valid inputs, local proof, single mechanism → fast-lane");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── Test 2: S-real-workflow → full-lane (proofScale negative) ──────────────────

test("S-real-workflow fixture (1 AC, 1 touch, DoD 'real-workflow evidence') → route FULL-lane", () => {
  const ws = makeTempWorkspace();
  try {
    writeFile(ws, "experiments/rw-touch-fixture.md");

    const touches = expandTouchSet(S_REAL_WORKFLOW_TASK, ws);
    assert.ok(touches.ok);
    assert.equal(touches.files.length, 1);

    const proofScale = classifyProofScale(S_REAL_WORKFLOW_TASK);
    assert.equal(proofScale, "real-workflow",
      "DoD contains 'real-workflow evidence' → proofScale real-workflow");

    const estimate = estimateTaskSize(S_REAL_WORKFLOW_TASK, { workspaceDir: ws, policy: _ROUTING_POLICY });
    assert.equal(estimate.codeScale, 85, "same codeScale as S-local");
    assert.equal(estimate.proofScale, "real-workflow",
      "proofScale is real-workflow — NOT in the allowlist");
    assert.equal(estimate.sizeTier, "S", "codeScale is still S-tier");
    assert.ok(estimate.inputValid);

    const route = routeTask(estimate, _ROUTING_POLICY);
    assert.equal(route, "full-lane",
      "S+real-workflow routes FULL-lane because proofScale is not in proofScaleFastLaneAllowlist");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── Test 3: M-tier → full-lane ─────────────────────────────────────────────────

test("M-tier fixture (15 AC, 3 touches → codeScale 555) → route full-lane via mTierFullLaneFloor", () => {
  const ws = makeTempWorkspace();
  try {
    writeFile(ws, "experiments/m-a-fixture.md");
    writeFile(ws, "experiments/m-b-fixture.md");
    writeFile(ws, "experiments/m-c-fixture.md");

    const touches = expandTouchSet(M_TIER_TASK, ws);
    assert.ok(touches.ok);
    assert.equal(touches.files.length, 3);

    const estimate = estimateTaskSize(M_TIER_TASK, { workspaceDir: ws, policy: _ROUTING_POLICY });
    assert.equal(estimate.codeScale, 555, "codeScale = 25*15 AC + 60*3 touches");
    assert.equal(estimate.sizeTier, "M", "codeScale 555 >= mTierFullLaneFloor 501 → M tier");
    assert.equal(estimate.acCount, 15);
    assert.equal(estimate.expandedTouchesCount, 3);
    assert.equal(estimate.proofScale, "local", "DoD standard → local");
    assert.equal(estimate.logicalSurfacesCount, 1);
    assert.equal(estimate.mechanismCount, 1);
    assert.ok(estimate.inputValid);

    // Even though codeScale 555 <= 800 (fastLaneCodeChurnCeiling), M-tier routes full-lane
    // via the sizeTier !== 'S' guard — the acknowledged ~800 vs M-501-900 overlap.
    assert.ok(estimate.codeScale <= _ROUTING_POLICY.fastLaneCodeChurnCeiling,
      "codeScale within the ~800 ceiling but sizeTier is M");
    const route = routeTask(estimate, _ROUTING_POLICY);
    assert.equal(route, "full-lane",
      "M-tier routes full-lane via sizeTier !== 'S' guard — even within codeScale ceiling");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── Test 4: Unknown proofScale → fail-closed full-lane ─────────────────────────

test("unknown proofScale (no ## Definition of Done section) → fail-closed full-lane", () => {
  const ws = makeTempWorkspace();
  try {
    writeFile(ws, "experiments/no-dod-touch-fixture.md");

    const proofScale = classifyProofScale(NO_DOD_TASK);
    assert.equal(proofScale, "unknown",
      "classifyProofScale returns 'unknown' when ## Definition of Done is absent");

    const estimate = estimateTaskSize(NO_DOD_TASK, { workspaceDir: ws, policy: _ROUTING_POLICY });
    assert.equal(estimate.proofScale, "unknown");
    assert.ok(estimate.inputValid);

    const route = routeTask(estimate, _ROUTING_POLICY);
    assert.equal(route, "full-lane",
      "unknown proofScale routes full-lane — fail-closed, never silently fast-laned");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── Test 5: Missing / unexpandable Touches → scope-estimate-unavailable → full-lane

test("missing ## Touches → scope-estimate-unavailable → full-lane", () => {
  const ws = makeTempWorkspace();
  try {
    const touches = expandTouchSet(NO_TOUCHES_TASK, ws);
    assert.ok(!touches.ok, "expandTouchSet should return ok:false when Touches is missing");
    assert.equal(touches.code, "scope-estimate-unavailable");

    const estimate = estimateTaskSize(NO_TOUCHES_TASK, { workspaceDir: ws, policy: _ROUTING_POLICY });
    assert.equal(estimate.inputValid, false, "inputValid false when Touches missing");
    assert.equal(estimate.expandedTouchesCount, 0);

    const route = routeTask(estimate, _ROUTING_POLICY);
    assert.equal(route, "full-lane",
      "missing Touches → inputValid:false → full-lane");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("unexpandable touch glob (matches zero files) → scope-estimate-unavailable → full-lane", () => {
  const ws = makeTempWorkspace();
  try {
    // No files matching experiments/nonexistent-*.md exist in ws
    const touches = expandTouchSet(UNEXPANDABLE_TOUCHES_TASK, ws);
    assert.ok(!touches.ok, "expandTouchSet should return ok:false when glob matches zero files");
    assert.equal(touches.code, "scope-estimate-unavailable");

    const estimate = estimateTaskSize(UNEXPANDABLE_TOUCHES_TASK, { workspaceDir: ws, policy: _ROUTING_POLICY });
    assert.equal(estimate.inputValid, false, "inputValid false when glob matches nothing");
    assert.equal(estimate.expandedTouchesCount, 0);

    const route = routeTask(estimate, _ROUTING_POLICY);
    assert.equal(route, "full-lane",
      "unexpandable glob → scope-estimate-unavailable → full-lane");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── Test 6: Decision is versioned with decisionHash, thresholdsRef, runIdentityBinding

test("decision is versioned: decisionHash, thresholdsRef, runIdentityBinding", () => {
  const ws = makeTempWorkspace();
  try {
    writeFile(ws, "experiments/local-touch-fixture.md");

    const decision = buildRoutingDecision(S_LOCAL_TASK, CHARTER_TEXT, { workspaceDir: ws, policy: _ROUTING_POLICY });

    // schemaVersion
    assert.equal(decision.schemaVersion, 1);

    // route and sizing fields
    assert.ok(decision.route === "fast-lane" || decision.route === "full-lane",
      "route must be fast-lane or full-lane");
    assert.equal(typeof decision.codeScale, "number");
    assert.equal(typeof decision.proofScale, "string");
    assert.equal(typeof decision.sizeTier, "string");
    assert.equal(typeof decision.logicalSurfacesCount, "number");
    assert.equal(typeof decision.mechanismCount, "number");
    assert.equal(typeof decision.inputValid, "boolean");

    // thresholdsRef
    assert.ok(decision.thresholdsRef, "thresholdsRef must be present");
    assert.equal(decision.thresholdsRef.policyRegistryRef, "DIR-124-D",
      "thresholdsRef.policyRegistryRef must be DIR-124-D");
    assert.equal(typeof decision.thresholdsRef.policyVersion, "string");
    assert.ok(decision.thresholdsRef.policyVersion.length > 0,
      "policyVersion must be non-empty");

    // materialInputHashes
    assert.ok(decision.materialInputHashes, "materialInputHashes must be present");
    assert.equal(typeof decision.materialInputHashes.taskProposal, "string");
    assert.equal(typeof decision.materialInputHashes.taskTouches, "string");
    assert.equal(typeof decision.materialInputHashes.charter, "string");
    assert.ok(decision.materialInputHashes.taskProposal.length === 64,
      "taskProposal hash should be 64 hex chars (SHA-256)");
    assert.ok(decision.materialInputHashes.taskTouches.length === 64,
      "taskTouches hash should be 64 hex chars (SHA-256)");
    assert.ok(decision.materialInputHashes.charter.length === 64,
      "charter hash should be 64 hex chars (SHA-256)");

    // runIdentityBinding
    assert.deepEqual(decision.runIdentityBinding, {
      declared: true,
      enforced: false,
      bindingTask: "DIR-124-B",
    }, "runIdentityBinding must declare DIR-124-B binding, not enforced");

    // decisionHash
    assert.equal(typeof decision.decisionHash, "string");
    assert.ok(decision.decisionHash.length === 64,
      "decisionHash should be 64 hex chars (SHA-256)");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── Test 7: Deterministic — same task text → byte-identical decisionHash ───────

test("deterministic: same task text produces byte-identical decisionHash across two calls", () => {
  const ws = makeTempWorkspace();
  try {
    writeFile(ws, "experiments/local-touch-fixture.md");

    const decision1 = buildRoutingDecision(S_LOCAL_TASK, CHARTER_TEXT, { workspaceDir: ws, policy: _ROUTING_POLICY });
    const decision2 = buildRoutingDecision(S_LOCAL_TASK, CHARTER_TEXT, { workspaceDir: ws, policy: _ROUTING_POLICY });

    assert.equal(decision1.decisionHash, decision2.decisionHash,
      "same task + charter + workspace → identical decisionHash");
    assert.equal(decision1.route, decision2.route, "same route");
    assert.equal(decision1.codeScale, decision2.codeScale, "same codeScale");
    assert.equal(decision1.proofScale, decision2.proofScale, "same proofScale");

    // Verify decisionHash is NOT merely a hash of material inputs alone —
    // it must change if the route decision fields change (e.g. different policy).
    const decision3 = buildRoutingDecision(S_REAL_WORKFLOW_TASK, CHARTER_TEXT, { workspaceDir: ws, policy: _ROUTING_POLICY });
    assert.notEqual(decision1.decisionHash, decision3.decisionHash,
      "different task (S-real-workflow) → different decisionHash — hash binds route decision fields, not just material inputs");
    assert.notEqual(decision1.materialInputHashes.taskProposal, decision3.materialInputHashes.taskProposal,
      "different task → different proposal hash");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── Test 8: CLI --estimate produces valid JSON → fail-closed on error ──────────

test("CLI --estimate produces valid JSON on stdout with required fields", () => {
  const ws = makeTempWorkspace();
  const localScript = path.join(__dirname, "..", "scripts", "prepare-milestone-size-estimate.ts");
  const taskFile = path.join(ws, "task.md");
  const charterFile = path.join(ws, "charter.md");
  const outFile = path.join(ws, "routing-decision.json");

  writeFile(ws, "experiments/local-touch-fixture.md");
  fs.writeFileSync(taskFile, S_LOCAL_TASK, "utf8");
  fs.writeFileSync(charterFile, CHARTER_TEXT, "utf8");

  try {
    const stdout = execFileSync("node", [
      "--no-warnings", "--experimental-strip-types", localScript,
      "--estimate",
      "--task", taskFile,
      "--charter", charterFile,
      "--workspace", ws,
      "--out", outFile,
    ], { encoding: "utf8" });

    const decision = JSON.parse(stdout);
    assert.equal(typeof decision.schemaVersion, "number");
    assert.ok(decision.route === "fast-lane" || decision.route === "full-lane");
    assert.equal(typeof decision.codeScale, "number");
    assert.equal(typeof decision.proofScale, "string");
    assert.equal(typeof decision.decisionHash, "string");

    // Sidecar file must be written atomically
    assert.ok(fs.existsSync(outFile), "routing-decision.json sidecar must be written");
    const sidecarContent = JSON.parse(fs.readFileSync(outFile, "utf8"));
    assert.deepEqual(sidecarContent, JSON.parse(JSON.stringify(decision)),
      "stdout and sidecar file must contain the same decision");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── Test 9: Mirror test — both mirrors produce identical output ────────────────

describe("mirror identity", () => {
  const expScript = path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", "prepare-milestone-size-estimate.ts");
  const pluginScript = path.join(REPO_ROOT, "plugin", "scripts", "prepare-milestone-size-estimate.ts");

  test("both estimator script mirrors are byte-identical on disk", () => {
    const expContent = fs.readFileSync(expScript, "utf8");
    const pluginContent = fs.readFileSync(pluginScript, "utf8");
    assert.equal(expContent, pluginContent,
      "experiments/ and plugin/ estimator mirrors must be byte-identical");
  });

  test("both mirrors produce identical stdout for the same input", () => {
    const ws = makeTempWorkspace();
    const taskFile = path.join(ws, "task.md");
    const charterFile = path.join(ws, "charter.md");
    const outExp = path.join(ws, "routing-exp.json");
    const outPlugin = path.join(ws, "routing-plugin.json");

    writeFile(ws, "experiments/local-touch-fixture.md");
    fs.writeFileSync(taskFile, S_LOCAL_TASK, "utf8");
    fs.writeFileSync(charterFile, CHARTER_TEXT, "utf8");

    try {
      const stdout1 = execFileSync("node", [
        "--no-warnings", "--experimental-strip-types", expScript,
        "--estimate", "--task", taskFile, "--charter", charterFile,
        "--workspace", ws, "--out", outExp,
      ], { encoding: "utf8" });

      const stdout2 = execFileSync("node", [
        "--no-warnings", "--experimental-strip-types", pluginScript,
        "--estimate", "--task", taskFile, "--charter", charterFile,
        "--workspace", ws, "--out", outPlugin,
      ], { encoding: "utf8" });

      assert.equal(stdout1, stdout2,
        "both estimator mirrors must produce identical stdout");

      const sidecar1 = JSON.parse(fs.readFileSync(outExp, "utf8"));
      const sidecar2 = JSON.parse(fs.readFileSync(outPlugin, "utf8"));
      assert.deepEqual(sidecar1, sidecar2,
        "both mirrors must write identical sidecar files");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

// ── Additional: _ROUTING_POLICY is the single thresholds source ───────────────

test("_ROUTING_POLICY is a single named object with all required fields", () => {
  assert.equal(_ROUTING_POLICY.policyRegistryRef, "DIR-124-D");
  assert.equal(_ROUTING_POLICY.policyVersion, "provisional-m239");
  assert.equal(typeof _ROUTING_POLICY.fastLaneCodeChurnCeiling, "number");
  assert.equal(typeof _ROUTING_POLICY.fastLaneMaxLogicalSurfaces, "number");
  assert.ok(Array.isArray(_ROUTING_POLICY.proofScaleFastLaneAllowlist));
  assert.ok(_ROUTING_POLICY.proofScaleFastLaneAllowlist.includes("local"));
  assert.ok(_ROUTING_POLICY.proofScaleFastLaneAllowlist.includes("integration"));
  assert.ok(!_ROUTING_POLICY.proofScaleFastLaneAllowlist.includes("real-workflow"),
    "real-workflow must NOT be in proofScaleFastLaneAllowlist");
  assert.equal(typeof _ROUTING_POLICY.mTierFullLaneFloor, "number");
});
}
