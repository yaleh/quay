// @test-group engine
//
// Tests for the ownership shadow proposer (docs/analysis/ownership-shadow-proposer.mjs) and its
// offline replay runner (docs/analysis/ownership-shadow-replay.mjs) —
// tasks/gap-ownership-shadow-proposer-contract-and-replay.md.
//
// These pin the CONTRACT, not a candidate's architectural judgment:
//   • AC2 — the sandbox guarantee is STRUCTURAL: the proposer's import graph reaches nothing but
//     `node:` builtins, and its source names none of the work-item/goal write surfaces.
//   • AC3 — the deterministic gate REJECTS four distinct bad envelopes with four DISTINGUISHABLE
//     causes (⛔ not one same-shaped refusal), plus the "could not evaluate" state is its own code.
//   • AC4 — the gate ACCEPTS a well-formed envelope (⛔ a gate that always refuses would fake a
//     green board).
//   • AC1/AC5 — the replay CLI runs end-to-end over the real corpus and writes a results file whose
//     every case carries the full `scoreResponse` dimension set.
// All temp artifacts go to os.tmpdir() — never inside the repo tree (the checked-in-write judge
// reads the whole file, so an in-tree probe would red the scoped gate for any later editor of this
// file).
//
// Run: scripts/test.sh plugin/test/ownership-shadow-proposer.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  PROPOSER_ID,
  GATE_CODES,
  OWNERSHIP_CONCERN_CLASSES,
  deterministicGate,
  propose,
  appendSandboxRecord,
} from "../../docs/analysis/ownership-shadow-proposer.mjs";
import { evidenceFromInput, runReplay, REPO_ROOT } from "../../docs/analysis/ownership-shadow-replay.mjs";
import { listCaseIds, loadCaseInput, loadCaseReference } from "./helpers/meta-driver-replay-harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROPOSER_SRC = path.join(HERE, "..", "..", "docs", "analysis", "ownership-shadow-proposer.mjs");
const REPLAY_SRC = path.join(HERE, "..", "..", "docs", "analysis", "ownership-shadow-replay.mjs");

const FORBIDDEN_REFERENCES = /\b(fileProposals|driveItems|fileDecisions|task_write|taskWrite|goal_write|goalWrite)\b/;

/** The full dimension key set `scoreResponse` emits (the criteria AC5 names, plus the rest of the
 *  emitted object). Pinned as a literal so a metric silently dropping out is a red, not a pass. */
const SCORE_DIMENSIONS = [
  "case_id",
  "concern_recall",
  "concern_precision",
  "chosen_slice_agreement",
  "chosen_slice_overlap_score",
  "investigation_vs_goal_agreement",
  "scope_expansion_violation",
  "expected_delta_quality",
  "falsifiability_negative_control_presence",
  "decomposition_quality",
  "slice_semantic_coherence",
  "granularity",
  "harnessability",
  "harnessability_components",
  "primitive_reuse",
  "decomposition_breadth",
  "coordination_cost_reasoning_given",
  "unnecessary_decomposition_flag",
  "hindsight_leakage_guard",
  "abstention_uncertainty_reasonableness",
  "note",
];

function fixtureEvidence() {
  return {
    case_id: "FIXTURE",
    cutoff: "2026-01-01T00:00:00.000Z",
    readings: {
      "archguard.duplicate": {
        kind: "archguard",
        tool_call: "detect_duplicates",
        value: "one duplicate group: a.ts::f and b.ts::g",
        note: "structural similarity only; equivalence not yet determined",
      },
      "corpus.context": { kind: "context", value: "fixture context" },
    },
    pointers: ["a.ts — the flagged parser"],
    repo_state_summary: "fixture repo state",
    investigation_note: "structural similarity only; equivalence not yet determined",
  };
}

function validEnvelope() {
  return propose(fixtureEvidence());
}

function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ownership-shadow-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("AC2 — the sandbox guarantee is structural: the proposer imports only node: builtins", () => {
  const src = fs.readFileSync(PROPOSER_SRC, "utf8");
  const specifiers = [...src.matchAll(/^\s*import[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
  // non-vacuousness anchor: the scan must actually SEE the module's imports.
  assert.ok(specifiers.length >= 2, `expected to extract >=2 import specifiers, got ${JSON.stringify(specifiers)}`);
  const nonBuiltin = specifiers.filter((s) => !s.startsWith("node:"));
  assert.deepEqual(nonBuiltin, [], `proposer must reach nothing but node: builtins, found: ${JSON.stringify(nonBuiltin)}`);
});

test("AC2 — the proposer source names no work-item/goal write surface, and its only write is the sandbox carrier", () => {
  const src = fs.readFileSync(PROPOSER_SRC, "utf8");
  assert.doesNotMatch(src, FORBIDDEN_REFERENCES, "proposer source must not reference the work-item/goal write surfaces");
  // non-vacuousness anchor: the POSITIVE write target must be present (otherwise the negative above
  // could pass on an empty/renamed file).
  assert.match(src, /ownership-shadow-proposals\.jsonl/, "the sandbox carrier basename must be present");
  assert.match(src, /appendFileSync/, "the sole write call must be present");
});

test("AC3 — four bad envelopes are rejected with four DISTINGUISHABLE causes (硬规则 3b)", () => {
  const base = validEnvelope();
  const knownEvidenceRefs = Object.keys(fixtureEvidence().readings);

  const missingField = structuredClone(base);
  delete missingField.confidence;

  const badRef = structuredClone(base);
  badRef.evidence_refs = ["archguard.this_reading_does_not_exist"];

  const outOfBounds = structuredClone(base);
  outOfBounds.concern = { class: "product-planning", statement: "prioritize the next quarter's feature roadmap for end users" };

  const forbidden = structuredClone(base);
  forbidden.recommended_next_action = "create-task";

  const verdicts = [missingField, badRef, outOfBounds, forbidden].map((e) => deterministicGate(e, { knownEvidenceRefs }));
  const codes = verdicts.map((v) => v.code);

  assert.deepEqual(codes, [
    GATE_CODES.SCHEMA_INCOMPLETE,
    GATE_CODES.EVIDENCE_REF_UNRESOLVABLE,
    GATE_CODES.SCOPE_OUT_OF_BOUNDS,
    GATE_CODES.FORBIDDEN_ACTION,
  ]);
  for (const v of verdicts) {
    assert.equal(v.accepted, false);
    assert.ok(v.reason && v.reason.length > 10, `each refusal needs a real reason, got: ${JSON.stringify(v)}`);
  }
  // The four reasons must not be the same string (a shared reason would make them same-shaped).
  assert.equal(new Set(verdicts.map((v) => v.reason)).size, 4, "the four refusal reasons must be distinguishable");
});

test("AC4 — a well-formed envelope is ACCEPTED (the gate is not a constant refuser)", () => {
  const env = validEnvelope();
  const v = deterministicGate(env, { knownEvidenceRefs: Object.keys(fixtureEvidence().readings) });
  assert.deepEqual({ accepted: v.accepted, code: v.code }, { accepted: true, code: GATE_CODES.ACCEPT });
  assert.ok(v.concern_key.startsWith("ownership:"), `concern key must be class-qualified, got ${v.concern_key}`);
});

test("gate: an un-suppliable evidence universe is NOT-EVALUATED, never a silent accept (硬规则 3b)", () => {
  const v = deterministicGate(validEnvelope(), {});
  assert.equal(v.accepted, false);
  assert.equal(v.code, GATE_CODES.NOT_EVALUATED);
});

test("gate: dedup, intervention cap, and enum-violation arms each get their own code", () => {
  const env = validEnvelope();
  const known = Object.keys(fixtureEvidence().readings);
  const first = deterministicGate(env, { knownEvidenceRefs: known });
  const dup = deterministicGate(structuredClone(env), { knownEvidenceRefs: known, seenConcernKeys: [first.concern_key] });
  assert.equal(dup.code, GATE_CODES.DUPLICATE_CONCERN);

  const many = structuredClone(env);
  many.candidate_interventions = [0, 1, 2, 3].map(() => structuredClone(env.candidate_interventions[0]));
  assert.equal(deterministicGate(many, { knownEvidenceRefs: known }).code, GATE_CODES.TOO_MANY_INTERVENTIONS);
});

test("proposer determinism verifies concern class against the ownership domain", () => {
  for (const id of listCaseIds()) {
    const env = propose(evidenceFromInput(loadCaseInput(id)));
    assert.ok(OWNERSHIP_CONCERN_CLASSES.includes(env.concern.class), `${id}: class ${env.concern.class} must be in-domain`);
    assert.equal(env.proposer_id, PROPOSER_ID);
    assert.ok(env.candidate_interventions.length >= 1 && env.candidate_interventions.length <= 3);
  }
});

test("NEGATIVE CONTROL — no case's derived envelope leaks any hindsight marker from its reference", () => {
  // A real anti-overfit control: the stub may only see input.json, so its output must never contain
  // a string the corpus declares hindsight-only. If a future change made the proposer read
  // reference.json, this is the test that goes red.
  for (const id of listCaseIds()) {
    const evidence = evidenceFromInput(loadCaseInput(id));
    const blob = JSON.stringify(propose(evidence));
    for (const marker of loadCaseReference(id).leakage_markers || []) {
      assert.ok(!blob.includes(marker), `${id}: envelope leaked hindsight marker ${JSON.stringify(marker)}`);
    }
  }
});

test("runReplay is deterministic over the real corpus (same input ⇒ same results object)", () => {
  const a = runReplay({ onAccepted: null });
  const b = runReplay({ onAccepted: null });
  assert.deepEqual(a, b);
  assert.equal(Object.keys(a.cases).length, 4);
});

test("AC1/AC5 — the replay CLI runs end-to-end over the real corpus and writes full-dimension results", () => {
  withTmp((tmp) => {
    const out = path.join(tmp, "results.json");
    const r = spawnSync(process.execPath, [REPLAY_SRC, "--out", out, "--root", tmp], { encoding: "utf8", cwd: tmp });
    assert.equal(r.status, 0, `replay CLI must exit 0:\nstdout=${r.stdout}\nstderr=${r.stderr}`);

    const results = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.equal(Object.keys(results.cases).length, 4, "AC1: exactly 4 cases in the results");

    for (const id of listCaseIds()) {
      const c = results.cases[id];
      assert.ok(c, `AC1: results must carry case ${id}`);
      assert.equal(c.gate.accepted, true, `${id} must pass the gate on the real corpus`);
      for (const key of SCORE_DIMENSIONS) {
        assert.ok(key in c, `AC5: case ${id} is missing dimension key "${key}"`);
      }
    }

    // The sandbox carrier is the proposer's ONLY output surface, and it landed OUTSIDE the repo
    // tree (the --root we passed), one JSONL record per accepted case.
    const carrier = path.join(tmp, ".quay", "ownership-shadow-proposals.jsonl");
    const lines = fs.readFileSync(carrier, "utf8").trim().split("\n");
    assert.equal(lines.length, 4, "one sandbox record per accepted case");
    for (const line of lines) {
      const rec = JSON.parse(line);
      assert.equal(rec.proposer_id, PROPOSER_ID);
      assert.ok(rec.concern && typeof rec.concern.class === "string");
    }
  });
});

test("appendSandboxRecord writes only under <root>/.quay and appends", () => {
  withTmp((tmp) => {
    const f1 = appendSandboxRecord(tmp, { proposer_id: PROPOSER_ID, n: 1 });
    appendSandboxRecord(tmp, { proposer_id: PROPOSER_ID, n: 2 });
    assert.equal(f1, path.join(tmp, ".quay", "ownership-shadow-proposals.jsonl"));
    const lines = fs.readFileSync(f1, "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
  });
});

test("evidenceFromInput derives readings from input.json alone (no reference access)", async () => {
  const mod = await import(pathToFileURL(REPLAY_SRC).href);
  assert.equal(typeof mod.evidenceFromInput, "function");
  const e = mod.evidenceFromInput(loadCaseInput("GOAL-031"));
  assert.ok(e.readings["archguard.dispersion"], "GOAL-031's dispersion reading must be extracted");
  assert.equal(e.case_id, "GOAL-031");
  // REPO_ROOT is module-derived (never cwd-derived) so the runner works from any directory.
  assert.ok(fs.existsSync(path.join(REPO_ROOT, "plugin", "fixtures", "meta-driver-replay", "GOAL-031", "input.json")));
});
