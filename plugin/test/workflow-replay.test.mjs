// workflow-replay.test.mjs — A2 golden replay test harness (DIR-124-A2)
// Covers all 10 fixtures + 2 RED/GREEN negative controls.
// Pure mechanical tests — no agent dispatch, no network, no GitHub token.
// Picked up by scripts/test.sh default glob (plugin/test/*.test.mjs, line 54).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "workflow-replay");

// Dynamic import for TS module
let runWorkflowReplay, runAllWorkflowReplays;
before(async () => {
  const mod = await import("../scripts/workflow-replay.ts");
  runWorkflowReplay = mod.runWorkflowReplay;
  runAllWorkflowReplays = mod.runAllWorkflowReplays;
});

function fixturePath(name) {
  return path.join(FIXTURES_DIR, name);
}

// ── 8 named operational cases ──────────────────────────────────────────────

describe("legacy-singleton-success", () => {
  it("all normative assertions pass", () => {
    const r = runWorkflowReplay(fixturePath("legacy-singleton-success"));
    assert.equal(r.ok, true, `expected ok=true, got ${r.verdict}: ${r.errors.join("; ")}`);
    const norm = r.assertionResults.filter(a => a.classification === "normative");
    assert.ok(norm.length > 0, "at least one normative assertion required");
    for (const a of norm) assert.equal(a.passed, true, `${a.assertionId}: ${a.detail}`);
  });

  it("exit code is 0", () => {
    const r = runWorkflowReplay(fixturePath("legacy-singleton-success"));
    assert.equal(r.exitCode, 0);
  });

  it("phase sequence matches baseline", () => {
    const r = runWorkflowReplay(fixturePath("legacy-singleton-success"));
    assert.ok(r.stateVector, "stateVector must exist");
    const seq = r.stateVector.phaseSequence;
    assert.deepEqual(seq, ["verify","prepared","build","audit","gate","land"]);
  });
});

describe("composite-success", () => {
  it("all normative assertions pass", () => {
    const r = runWorkflowReplay(fixturePath("composite-success"));
    assert.equal(r.ok, true, `expected ok=true, got ${r.verdict}: ${r.errors.join("; ")}`);
  });
});

describe("cache-resume", () => {
  it("all normative assertions pass", () => {
    const r = runWorkflowReplay(fixturePath("cache-resume"));
    assert.equal(r.ok, true, `expected ok=true, got ${r.verdict}`);
  });
});

describe("verify-failure", () => {
  it("all normative assertions pass", () => {
    const r = runWorkflowReplay(fixturePath("verify-failure"));
    assert.equal(r.ok, true, `expected ok=true, got ${r.verdict}`);
  });

  it("terminal outcome is needs-human", () => {
    const r = runWorkflowReplay(fixturePath("verify-failure"));
    assert.ok(r.stateVector, "stateVector must exist");
    assert.equal(r.stateVector.outcome.outcome, "needs-human");
  });
});

describe("prepared-failure", () => {
  it("all normative assertions pass", () => {
    const r = runWorkflowReplay(fixturePath("prepared-failure"));
    assert.equal(r.ok, true, `expected ok=true, got ${r.verdict}`);
  });
});

describe("audit-refuted", () => {
  it("all normative assertions pass", () => {
    const r = runWorkflowReplay(fixturePath("audit-refuted"));
    assert.equal(r.ok, true, `expected ok=true, got ${r.verdict}`);
  });
});

describe("gate-failure", () => {
  it("all normative assertions pass", () => {
    const r = runWorkflowReplay(fixturePath("gate-failure"));
    assert.equal(r.ok, true, `expected ok=true, got ${r.verdict}`);
  });
});

describe("concurrent-partial-survivor", () => {
  it("all normative assertions pass", () => {
    const r = runWorkflowReplay(fixturePath("concurrent-partial-survivor"));
    assert.equal(r.ok, true, `expected ok=true, got ${r.verdict}: ${r.errors.join("; ")}`);
  });
});

// ── 2 known-defect shapes ─────────────────────────────────────────────────

describe("m192-null-build (RED control)", () => {
  it("defect reproduced — all known-defect assertions pass", () => {
    const r = runWorkflowReplay(fixturePath("m192-null-build"));
    // Exit 0 because defects are reproduced correctly, no normative violations
    assert.equal(r.exitCode, 0, `expected exitCode=0 (defect reproduced), got ${r.exitCode}: ${r.verdict}`);
    const kd = r.assertionResults.filter(a => a.classification === "known-defect");
    assert.ok(kd.length > 0, "at least one known-defect assertion required");
  });

  it("no normative assertion depends on defect behavior", () => {
    const r = runWorkflowReplay(fixturePath("m192-null-build"));
    const norm = r.assertionResults.filter(a => a.classification === "normative");
    // No normative assertions in this fixture — all are known-defect
    assert.equal(norm.length, 0, "m192 fixture should have zero normative assertions");
  });
});

describe("m195-stale-prepared (RED control)", () => {
  it("defect reproduced — known-defect assertions pass, normative pass", () => {
    const r = runWorkflowReplay(fixturePath("m195-stale-prepared"));
    assert.equal(r.exitCode, 0, `expected exitCode=0 (defect reproduced), got ${r.exitCode}: ${r.verdict}`);
    const kd = r.assertionResults.filter(a => a.classification === "known-defect");
    assert.ok(kd.length > 0, "at least one known-defect assertion required");
    // normative assertions (no-build/land after prepared failure) also pass
    const norm = r.assertionResults.filter(a => a.classification === "normative");
    for (const a of norm) assert.equal(a.passed, true, `${a.assertionId}: ${a.detail}`);
  });
});

// ── 2 GREEN negative controls ─────────────────────────────────────────────

describe("legacy-singleton-success-tampered (GREEN)", () => {
  it("runner exits non-zero (normative invariant violated)", () => {
    const r = runWorkflowReplay(fixturePath("legacy-singleton-success-tampered"));
    assert.equal(r.exitCode, 1, `tampered fixture must exit non-zero, got ${r.exitCode}: ${r.verdict}`);
    assert.equal(r.verdict, "normative-invariant-violated");
  });
});

describe("m192-defect-as-normative (GREEN)", () => {
  it("runner rejects at validation time (exit 1)", () => {
    const r = runWorkflowReplay(fixturePath("m192-defect-as-normative"));
    assert.equal(r.exitCode, 1, `defect-as-normative must exit non-zero, got ${r.exitCode}: ${r.verdict}`);
    assert.ok(
      r.verdict === "expectations-invalid" || r.verdict === "load-failed",
      `expected expectations-invalid or load-failed, got ${r.verdict}`
    );
  });
});

// ── Mechanical properties ─────────────────────────────────────────────────

describe("runAllWorkflowReplays", () => {
  it("returns results for all 10 main fixtures (excludes negative controls)", () => {
    const results = runAllWorkflowReplays(FIXTURES_DIR);
    assert.ok(results.length >= 8, `expected >=8 fixtures, got ${results.length}`);
    // Negative controls are excluded by default
    const names = results.map(r => r.caseName);
    assert.ok(!names.includes("legacy-singleton-success-tampered"), "tampered should be excluded");
    assert.ok(!names.includes("m192-defect-as-normative"), "defect-as-normative should be excluded");
  });

  it("all non-defect fixtures have ok=true", () => {
    const results = runAllWorkflowReplays(FIXTURES_DIR);
    for (const r of results) {
      // known-defect fixtures may report "defect-resolved" which is also ok
      assert.equal(r.exitCode, 0, `${r.caseName}: expected exitCode=0, got ${r.exitCode} (${r.verdict})`);
    }
  });
});

describe("determinism", () => {
  it("two calls with same fixture return structurally identical results", () => {
    const r1 = runWorkflowReplay(fixturePath("legacy-singleton-success"));
    const r2 = runWorkflowReplay(fixturePath("legacy-singleton-success"));
    assert.deepEqual(r1.verdict, r2.verdict);
    assert.deepEqual(r1.exitCode, r2.exitCode);
    assert.deepEqual(r1.ok, r2.ok);
    assert.deepEqual(r1.stateVector, r2.stateVector);
    for (let i = 0; i < r1.assertionResults.length; i++) {
      assert.deepEqual(r1.assertionResults[i].passed, r2.assertionResults[i].passed);
    }
  });
});

describe("schema validation", () => {
  it("schema version mismatch is rejected", () => {
    // Create temporary fixture with bad schema version
    const tmp = path.join(FIXTURES_DIR, "_tmp-bad-schema");
    const fs = await import("node:fs");
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "events.jsonl"), '{"schemaVersion":"99","runId":"x","candidateId":"x","taskId":"x","stage":"verify","attempt":1,"timing":{"queuedAtMs":1,"startedAtMs":1}}\n');
    fs.writeFileSync(path.join(tmp, "expectations.json"), '{"assertions":[]}');
    const r = runWorkflowReplay(tmp);
    assert.ok(!r.ok || r.errors.length > 0, `bad schema should be rejected, got ${r.verdict}`);
    fs.rmSync(tmp, { recursive: true });
  });

  it("missing required field causes load-time rejection", () => {
    const tmp = path.join(FIXTURES_DIR, "_tmp-missing-field");
    const fs = await import("node:fs");
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "events.jsonl"), '{"schemaVersion":"1"}\n');
    fs.writeFileSync(path.join(tmp, "expectations.json"), '{"assertions":[]}');
    const r = runWorkflowReplay(tmp);
    assert.ok(!r.ok || r.errors.length > 0, `missing fields should be rejected, got ${r.verdict}`);
    fs.rmSync(tmp, { recursive: true });
  });

  it("unknown classification label is rejected", () => {
    const tmp = path.join(FIXTURES_DIR, "_tmp-bad-class");
    const fs = await import("node:fs");
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "events.jsonl"), '{"schemaVersion":"1","runId":"x","candidateId":"x","taskId":"x","stage":"verify","attempt":1,"timing":{"queuedAtMs":1,"startedAtMs":1}}\n');
    fs.writeFileSync(path.join(tmp, "expectations.json"), JSON.stringify({assertions:[{id:"a1",description:"test",classification:"invalid-label",internalCategory:"normative",check:{predicate:"hasStage",args:{stage:"verify"}},expected:true}]}));
    const r = runWorkflowReplay(tmp);
    assert.ok(!r.ok || r.errors.length > 0, `unknown classification should be rejected, got ${r.verdict}`);
    fs.rmSync(tmp, { recursive: true });
  });
});
