// workflow-replay.test.mjs — A2 golden replay test harness (DIR-124-A2)
// Covers all 10 fixtures + 2 GREEN negative controls.
// Picked up by scripts/test.sh default glob (plugin/test/*.test.mjs).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "workflow-replay");

// INVARIANT (gap-fixture-dir-write-races-whole-tree-copy):
//   测试不得在已签入路径下创建或删除条目；一切临时产物落在进程私有临时目录。
//   A test must not create or delete entries under a checked-in path; every temporary artifact
//   belongs in a process-private temp dir (os.tmpdir()/mkdtempSync).
// WHY: FIXTURES_DIR is a checked-in tree that OTHER processes read — test/cold-start-oneliner-e2e.sh
//   does `cp -r "$PLUGIN_SRC" "$QUAY_DEV/plugin"`, and a copier that has already readdir'd this
//   directory will fail `stat` on an entry this test just removed (`cp: cannot stat …/_tmp-bad-schema`).
//   The failure lands on the COPIER, not on the writer, so it is attributed to the wrong task.
//   Measured pre-fix: 2/400 concurrent-arm failures vs 0/25 solo-arm (the concurrency is the
//   independent variable, not noise). The guard `plugin/scripts/checked-in-write-check.ts` is the
//   standing judge for this invariant; it reports these three dirs when they live here.
/** A case dir for the schema-validation cases, in a private temp dir — never under FIXTURES_DIR. */
function mkScratchCase(tag, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `workflow-replay-${tag}-`));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

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
    assert.deepEqual(seq, ["Verify","Prepared","Build","Audit","Gate","Land"]);
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

describe("baseline invariance (AC3)", () => {
  it("state vector matches meta.baseline across all 5 dimensions", () => {
    const r = runWorkflowReplay(fp("legacy-singleton-success"));
    const manifest = JSON.parse(fs.readFileSync(path.join(fp("legacy-singleton-success"), "expectations.json"), "utf8"));
    const baseline = manifest.meta.baseline;
    assert.deepEqual(r.stateVector.phaseSequence, baseline.phaseSequence, "phaseSequence");
    assert.deepEqual(r.stateVector.agentCounts, baseline.agentCounts, "agentCounts");
    assert.deepEqual(r.stateVector.outcome, baseline.outcome, "outcome");
    assert.deepEqual(r.stateVector.sharedStateMutations, baseline.sharedStateMutations, "sharedStateMutations");
    assert.deepEqual(r.stateVector.schedulingDecisions, baseline.schedulingDecisions, "schedulingDecisions");
  });
});

// A minimal A1a-v1-schema-conformant StageEvent, so the schema-validation tests exercise the
// exact failure path they name (bad version / missing field / bad classification) instead of
// being rejected for the unrelated drift (lowercase stage, missing recordedAtMs/endedAtMs).
function minimalValidEvent(overrides = {}) {
  return JSON.stringify(Object.assign({
    schemaVersion: "1", runId: "x", candidateId: "x", taskId: "x", stage: "Verify",
    attempt: 1, timing: { queuedAtMs: 1, startedAtMs: 1, endedAtMs: null },
    agentLabel: "workflow-runner", commandIdentity: null, executionCwd: "/tmp",
    worktreePath: null, baseCommit: null, candidateCommit: null, outcome: null,
    waitReason: null, resourceClaim: null, observedWrites: [], isolationMode: null,
    dispatchMode: null, recordedAtMs: 1,
  }, overrides));
}

describe("schema validation", () => {
  it("bad schema version is rejected", () => {
    const tmp = mkScratchCase("bad-schema", {
      "events.jsonl": minimalValidEvent({ schemaVersion: "99" }) + "\n",
      "expectations.json": '{"assertions":[]}',
    });
    try {
      const r = runWorkflowReplay(tmp);
      assert.ok(!r.ok || r.errors.length > 0, `bad schema rejected, got ${r.verdict}`);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  it("missing required field is rejected", () => {
    const e = JSON.parse(minimalValidEvent());
    delete e.recordedAtMs; // the A1a v1 mandatory field this corpus restore is about
    const tmp = mkScratchCase("missing-field", {
      "events.jsonl": JSON.stringify(e) + "\n",
      "expectations.json": '{"assertions":[]}',
    });
    try {
      const r = runWorkflowReplay(tmp);
      assert.ok(!r.ok || r.errors.length > 0, `missing fields rejected, got ${r.verdict}`);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  it("unknown classification label is rejected", () => {
    const tmp = mkScratchCase("bad-class", {
      "events.jsonl": minimalValidEvent() + "\n",
      "expectations.json": JSON.stringify({assertions:[{id:"a1",description:"t",classification:"invalid-label",internalCategory:"normative",check:{predicate:"hasStage",args:{stage:"Verify"}},expected:true}]}),
    });
    try {
      const r = runWorkflowReplay(tmp);
      assert.equal(r.verdict, "expectations-invalid", `bad classification rejected, got ${r.verdict}`);
      assert.ok(!r.ok, "bad classification -> !ok");
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
});
