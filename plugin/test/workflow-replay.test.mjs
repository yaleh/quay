// workflow-replay.test.mjs — golden replay corpus tests (DIR-124-A2)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "workflow-replay");
const SCRIPTS_DIR = path.join(__dirname, "..", "scripts");

// Lazy-load: import runner on first use
let _runner = null;
let _runnerAll = null;

function loadRunner() {
  if (_runner) return { runWorkflowReplay: _runner, runAllWorkflowReplays: _runnerAll };
  throw new Error("runner not loaded yet — call initRunner() at test start");
}

async function initRunner() {
  const mod = await import(path.join(SCRIPTS_DIR, "workflow-replay.ts"));
  _runner = mod.runWorkflowReplay;
  _runnerAll = mod.runAllWorkflowReplays;
  return { runWorkflowReplay: _runner, runAllWorkflowReplays: _runnerAll };
}

const MAIN_CASES = [
  "legacy-singleton-success", "composite-success", "cache-resume",
  "verify-failure", "prepared-failure", "audit-refuted",
  "gate-failure", "concurrent-partial-survivor",
];
const DEFECT_CASES = ["m192-null-build", "m195-stale-prepared"];

describe("workflow-replay runner", () => {
  it("init", async () => { await initRunner(); });

  describe("AC1: all 8 named cases", () => {
    for (const c of MAIN_CASES) {
      it(`${c} replays with all normative assertions passing`, () => {
        const { runWorkflowReplay } = loadRunner();
        const fp = path.join(FIXTURES_DIR, c);
        if (!fs.existsSync(fp)) { assert.fail(`fixture dir not found: ${c}`); return; }
        const result = runWorkflowReplay(fp);
        assert.notEqual(result.verdict, "load-failed", `load-failed: ${result.errors.join("; ")}`);
        assert.notEqual(result.verdict, "expectations-invalid", `exp-invalid: ${result.errors.join("; ")}`);
        const nf = result.assertionResults.filter(r => r.classification === "normative" && !r.passed);
        if (nf.length > 0) assert.fail(`normative fails: ${nf.map(r=>r.assertionId).join(",")}`);
        assert.ok(result.ok || result.verdict === "all-pass" || result.verdict === "compatibility-warning" || result.verdict.startsWith("defect-resolved"), `bad verdict: ${result.verdict}`);
      });
    }
    it("--all covers 8 main cases", () => {
      const { runAllWorkflowReplays } = loadRunner();
      const results = runAllWorkflowReplays(FIXTURES_DIR);
      const mainResults = results.filter(r => MAIN_CASES.includes(r.caseName));
      assert.equal(mainResults.length, 8);
    });
  });

  describe("AC2: known-defect fixtures", () => {
    for (const c of DEFECT_CASES) {
      it(`${c} replays with defects reproduced`, () => {
        const { runWorkflowReplay } = loadRunner();
        const result = runWorkflowReplay(path.join(FIXTURES_DIR, c));
        assert.notEqual(result.verdict, "load-failed");
        assert.notEqual(result.verdict, "expectations-invalid");
        const fails = result.assertionResults.filter(r => !r.passed);
        assert.equal(fails.length, 0, `defect reproductions failed: ${fails.map(r=>r.assertionId).join(",")}`);
      });
    }
  });

  describe("AC3: baseline invariance", () => {
    it("legacy-singleton-success baseline matches observed state vector (5 dimensions)", () => {
      const { runWorkflowReplay } = loadRunner();
      const fp = path.join(FIXTURES_DIR, "legacy-singleton-success");
      const result = runWorkflowReplay(fp);
      assert.ok(result.stateVector, "no state vector");
      const exp = JSON.parse(fs.readFileSync(path.join(fp, "expectations.json"), "utf8"));
      const b = exp.meta?.baseline;
      assert.ok(b, "no baseline");
      const sv = result.stateVector;
      assert.deepEqual(sv.phaseSequence, b.phaseSequence, "phaseSequence");
      assert.deepEqual(sv.agentCounts, b.agentCounts, "agentCounts");
      assert.deepEqual(sv.outcome, b.outcome, "outcome");
      assert.deepEqual(sv.sharedStateMutations, b.sharedStateMutations, "sharedStateMutations");
      assert.deepEqual(sv.schedulingDecisions, b.schedulingDecisions, "schedulingDecisions");
    });
  });

  describe("AC4: RED/GREEN negative controls", () => {
    it("RED: legacy-singleton-success-tampered has normative failures", () => {
      const { runWorkflowReplay } = loadRunner();
      const result = runWorkflowReplay(path.join(FIXTURES_DIR, "legacy-singleton-success-tampered"));
      const nf = result.assertionResults.filter(r => r.classification === "normative" && !r.passed);
      assert.ok(nf.length > 0, `expected normative failures, got ${result.verdict}`);
    });
    it("GREEN: m192-defect-as-normative rejected by validator", () => {
      const { runWorkflowReplay } = loadRunner();
      const result = runWorkflowReplay(path.join(FIXTURES_DIR, "m192-defect-as-normative"));
      assert.equal(result.verdict, "expectations-invalid", `expected expectations-invalid, got ${result.verdict}: ${result.errors.join("; ")}`);
    });
  });

  describe("AC5: finer taxonomy", () => {
    it("M192 known-defect assertions have valid internalCategory and mappingNote", () => {
      const exp = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "m192-null-build", "expectations.json"), "utf8"));
      for (const a of exp.assertions) {
        if (a.classification === "known-defect") {
          assert.ok(["observed-but-undesired","explicitly-open-defect","compatibility-only"].includes(a.internalCategory), `${a.id}: bad internalCategory`);
          assert.ok(a.mappingNote, `${a.id}: missing mappingNote`);
        }
      }
    });
    it("M195 known-defect assertions have compatibility-only internalCategory", () => {
      const exp = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "m195-stale-prepared", "expectations.json"), "utf8"));
      for (const a of exp.assertions) {
        assert.equal(a.classification, "known-defect");
        assert.equal(a.internalCategory, "compatibility-only", `${a.id}: expected compatibility-only`);
        assert.ok(a.mappingNote, `${a.id}: missing mappingNote`);
      }
    });
  });

  describe("AC6: schema validation", () => {
    it("malformed events.jsonl rejects at load time", () => {
      const { runWorkflowReplay } = loadRunner();
      const tmpDir = path.join(FIXTURES_DIR, "..", ".tmp-malformed-test");
      fs.mkdirSync(tmpDir, {recursive: true});
      fs.writeFileSync(path.join(tmpDir, "events.jsonl"), '{"schemaVersion":"2"}\n');
      fs.writeFileSync(path.join(tmpDir, "expectations.json"), '{"assertions":[]}');
      const result = runWorkflowReplay(tmpDir);
      assert.equal(result.verdict, "load-failed");
      fs.rmSync(tmpDir, {recursive: true, force: true});
    });
    it("wrong schemaVersion is rejected", () => {
      const { runWorkflowReplay } = loadRunner();
      const tmpDir = path.join(FIXTURES_DIR, "..", ".tmp-sv-test");
      fs.mkdirSync(tmpDir, {recursive: true});
      fs.writeFileSync(path.join(tmpDir, "events.jsonl"), '{"schemaVersion":"2","runId":"x","candidateId":"x","taskId":"x","stage":"verify","attempt":1,"timing":{"queuedAtMs":1,"startedAtMs":1}}\n');
      fs.writeFileSync(path.join(tmpDir, "expectations.json"), '{"assertions":[]}');
      const result = runWorkflowReplay(tmpDir);
      assert.equal(result.verdict, "load-failed");
      fs.rmSync(tmpDir, {recursive: true, force: true});
    });
  });

  describe("AC7: pure-function determinism", () => {
    it("runWorkflowReplay is deterministic (two calls return same results)", () => {
      const { runWorkflowReplay } = loadRunner();
      const fp = path.join(FIXTURES_DIR, "legacy-singleton-success");
      const r1 = runWorkflowReplay(fp);
      const r2 = runWorkflowReplay(fp);
      assert.equal(r1.verdict, r2.verdict);
      assert.equal(r1.assertionResults.length, r2.assertionResults.length);
      for (let i = 0; i < r1.assertionResults.length; i++) {
        assert.equal(r1.assertionResults[i].passed, r2.assertionResults[i].passed);
      }
    });
    it("runner contains no agent(), execFile, writeFileSync, or appendFileSync calls", () => {
      const src = fs.readFileSync(path.join(SCRIPTS_DIR, "workflow-replay.ts"), "utf8");
      assert.ok(!src.includes("agent("), "agent() found");
      assert.ok(!src.includes("execFile"), "execFile found");
      assert.ok(!src.includes("writeFileSync"), "writeFileSync found");
      assert.ok(!src.includes("appendFileSync"), "appendFileSync found");
    });
  });

  describe("AC8: mirror byte-identity", () => {
    it("plugin/scripts/workflow-event-schema.mjs matches experiments/ copy", () => {
      const a = fs.readFileSync(path.join(SCRIPTS_DIR, "workflow-event-schema.mjs"));
      const b = fs.readFileSync(path.join(__dirname, "..", "..", "plugin", "scripts", "workflow-event-schema.mjs"));
      assert.ok(a.equals(b), "workflow-event-schema.mjs differs between mirrors");
    });
    it("plugin/scripts/workflow-replay.ts matches experiments/ copy", () => {
      const a = fs.readFileSync(path.join(SCRIPTS_DIR, "workflow-replay.ts"));
      const b = fs.readFileSync(path.join(__dirname, "..", "..", "plugin", "scripts", "workflow-replay.ts"));
      assert.ok(a.equals(b), "workflow-replay.ts differs between mirrors");
    });
    it("plugin/fixtures/workflow-replay/ matches experiments/ copy (12 dirs)", () => {
      const ef = path.join(FIXTURES_DIR);
      const pf = path.join(__dirname, "..", "..", "plugin", "fixtures", "workflow-replay");
      const eDirs = fs.readdirSync(ef, {withFileTypes: true}).filter(e => e.isDirectory());
      const pDirs = fs.readdirSync(pf, {withFileTypes: true}).filter(e => e.isDirectory());
      assert.equal(eDirs.length, pDirs.length, `dir count: experiments ${eDirs.length} vs plugin ${pDirs.length}`);
      for (const d of eDirs) {
        const events1 = fs.readFileSync(path.join(ef, d.name, "events.jsonl"));
        const events2 = fs.readFileSync(path.join(pf, d.name, "events.jsonl"));
        assert.ok(events1.equals(events2), `events.jsonl differs in ${d.name}`);
        const exp1 = fs.readFileSync(path.join(ef, d.name, "expectations.json"));
        const exp2 = fs.readFileSync(path.join(pf, d.name, "expectations.json"));
        assert.ok(exp1.equals(exp2), `expectations.json differs in ${d.name}`);
      }
    });
  });

  describe("AC10: M192 code verification", () => {
    it("M192 fixture encodes null Build passthrough behavior", () => {
      const exp = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "m192-null-build", "expectations.json"), "utf8"));
      const defects = exp.assertions.filter(a => a.classification === "known-defect");
      assert.ok(defects.length >= 4, `expected >=4, got ${defects.length}`);
    });
  });

  describe("AC11: M195 code verification", () => {
    it("M195 fixture encodes Verify-before-Prepared ordering", () => {
      const exp = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "m195-stale-prepared", "expectations.json"), "utf8"));
      const compatDefects = exp.assertions.filter(a => a.classification === "known-defect" && a.internalCategory === "compatibility-only");
      assert.ok(compatDefects.length >= 4);
    });
  });

  describe("AC12: cache-resume verification", () => {
    it("cache-resume fixture has cache-hit waitReason on verify event", () => {
      const events = fs.readFileSync(path.join(FIXTURES_DIR, "cache-resume", "events.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l));
      const cacheEvent = events.find(e => e.waitReason === "cache-hit");
      assert.ok(cacheEvent, "no cache-hit event");
      assert.equal(cacheEvent.stage, "verify");
    });
  });
});
