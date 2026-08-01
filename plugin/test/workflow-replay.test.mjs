// workflow-replay.test.mjs — A2 golden replay test harness (DIR-124-A2)
// Covers all 10 fixtures + 2 GREEN negative controls.
// Picked up by scripts/test.sh default glob (plugin/test/*.test.mjs).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "workflow-replay");

let runWorkflowReplay, runAllWorkflowReplays;

before(async () => {
  const mod = await import("../scripts/workflow-replay.ts");
  runWorkflowReplay = mod.runWorkflowReplay;
  runAllWorkflowReplays = mod.runAllWorkflowReplays;
});

function fp(name) { return path.join(FIXTURES_DIR, name); }

describe("legacy-singleton-success", () => {
  it("all normative assertions pass", () => {
    const r = runWorkflowReplay(fp("legacy-singleton-success"));
    assert.equal(r.ok, true, `expected ok=true, got ${r.verdict}: ${r.errors.join("; ")}`);
  });
  it("exit code is 0", () => {
    const r = runWorkflowReplay(fp("legacy-singleton-success"));
    assert.equal(r.exitCode, 0);
  });
  it("phase sequence matches baseline", () => {
    const r = runWorkflowReplay(fp("legacy-singleton-success"));
    const seq = r.stateVector.phaseSequence;
    assert.deepEqual(seq, ["verify","prepared","build","audit","gate","land"]);
  });
});

describe("composite-success", () => {
  it("all normative assertions pass", () => {
    const r = runWorkflowReplay(fp("composite-success"));
    assert.equal(r.ok, true, `${r.verdict}: ${r.errors.join("; ")}`);
  });
});

describe("cache-resume", () => {
  it("all normative assertions pass", () => {
    const r = runWorkflowReplay(fp("cache-resume"));
    assert.equal(r.ok, true, r.verdict);
  });
});

describe("verify-failure", () => {
  it("all normative assertions pass", () => {
    const r = runWorkflowReplay(fp("verify-failure"));
    assert.equal(r.ok, true, r.verdict);
  });
  it("terminal outcome is needs-human", () => {
    const r = runWorkflowReplay(fp("verify-failure"));
    assert.equal(r.stateVector.outcome.outcome, "needs-human");
  });
});

describe("prepared-failure", () => {
  it("all normative assertions pass", () => {
    const r = runWorkflowReplay(fp("prepared-failure"));
    assert.equal(r.ok, true, r.verdict);
  });
});

describe("audit-refuted", () => {
  it("all normative assertions pass", () => {
    const r = runWorkflowReplay(fp("audit-refuted"));
    assert.equal(r.ok, true, r.verdict);
  });
});

describe("gate-failure", () => {
  it("all normative assertions pass", () => {
    const r = runWorkflowReplay(fp("gate-failure"));
    assert.equal(r.ok, true, r.verdict);
  });
});

describe("concurrent-partial-survivor", () => {
  it("all normative assertions pass", () => {
    const r = runWorkflowReplay(fp("concurrent-partial-survivor"));
    assert.equal(r.ok, true, `${r.verdict}: ${r.errors.join("; ")}`);
  });
});

// RED controls
describe("m192-null-build (RED)", () => {
  it("defect reproduced — exit 0", () => {
    const r = runWorkflowReplay(fp("m192-null-build"));
    assert.equal(r.exitCode, 0, `defect reproduced exit 0, got ${r.exitCode}: ${r.verdict}`);
  });
});

describe("m195-stale-prepared (RED)", () => {
  it("defect reproduced — exit 0 with normative assertions passing", () => {
    const r = runWorkflowReplay(fp("m195-stale-prepared"));
    assert.equal(r.exitCode, 0, `defect reproduced exit 0, got ${r.exitCode}: ${r.verdict}`);
    const norm = r.assertionResults.filter(a => a.classification === "normative");
    for (const a of norm) assert.equal(a.passed, true, a.assertionId);
  });
});

// GREEN negative controls
describe("legacy-singleton-success-tampered (GREEN)", () => {
  it("normative invariant violated — exit 1", () => {
    const r = runWorkflowReplay(fp("legacy-singleton-success-tampered"));
    assert.equal(r.exitCode, 1);
    assert.equal(r.verdict, "normative-invariant-violated");
  });
});

describe("m192-defect-as-normative (GREEN)", () => {
  it("validation rejection — exit 1", () => {
    const r = runWorkflowReplay(fp("m192-defect-as-normative"));
    assert.equal(r.exitCode, 1);
    assert.ok(
      r.verdict === "expectations-invalid" || r.verdict === "load-failed",
      `expected expectations-invalid, got ${r.verdict}`
    );
  });
});

// Mechanical properties
describe("runAllWorkflowReplays", () => {
  it("returns >=8 fixtures excluding negative controls", () => {
    const results = runAllWorkflowReplays(FIXTURES_DIR);
    assert.ok(results.length >= 8, `expected >=8, got ${results.length}`);
    const names = results.map(r => r.caseName);
    assert.ok(!names.includes("legacy-singleton-success-tampered"));
    assert.ok(!names.includes("m192-defect-as-normative"));
  });
});

describe("determinism", () => {
  it("two calls return identical results", () => {
    const r1 = runWorkflowReplay(fp("legacy-singleton-success"));
    const r2 = runWorkflowReplay(fp("legacy-singleton-success"));
    assert.deepEqual(r1.verdict, r2.verdict);
    assert.deepEqual(r1.exitCode, r2.exitCode);
    for (let i = 0; i < r1.assertionResults.length; i++) {
      assert.deepEqual(r1.assertionResults[i].passed, r2.assertionResults[i].passed);
    }
  });
});

describe("schema validation", () => {
  it("bad schema version is rejected", () => {
    const tmp = path.join(FIXTURES_DIR, "_tmp-bad-schema");
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "events.jsonl"), '{"schemaVersion":"99","runId":"x","candidateId":"x","taskId":"x","stage":"verify","attempt":1,"timing":{"queuedAtMs":1,"startedAtMs":1}}\n');
    fs.writeFileSync(path.join(tmp, "expectations.json"), '{"assertions":[]}');
    const r = runWorkflowReplay(tmp);
    assert.ok(!r.ok || r.errors.length > 0, `bad schema rejected, got ${r.verdict}`);
    fs.rmSync(tmp, { recursive: true });
  });

  it("missing required field is rejected", () => {
    const tmp = path.join(FIXTURES_DIR, "_tmp-missing-field");
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "events.jsonl"), '{"schemaVersion":"1"}\n');
    fs.writeFileSync(path.join(tmp, "expectations.json"), '{"assertions":[]}');
    const r = runWorkflowReplay(tmp);
    assert.ok(!r.ok || r.errors.length > 0, `missing fields rejected, got ${r.verdict}`);
    fs.rmSync(tmp, { recursive: true });
  });

  it("unknown classification label is rejected", () => {
    const tmp = path.join(FIXTURES_DIR, "_tmp-bad-class");
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "events.jsonl"), '{"schemaVersion":"1","runId":"x","candidateId":"x","taskId":"x","stage":"verify","attempt":1,"timing":{"queuedAtMs":1,"startedAtMs":1}}\n');
    fs.writeFileSync(path.join(tmp, "expectations.json"), JSON.stringify({assertions:[{id:"a1",description:"t",classification:"invalid-label",internalCategory:"normative",check:{predicate:"hasStage",args:{stage:"verify"}},expected:true}]}));
    const r = runWorkflowReplay(tmp);
    assert.ok(!r.ok || r.errors.length > 0, `bad classification rejected, got ${r.verdict}`);
    fs.rmSync(tmp, { recursive: true });
  });
});
