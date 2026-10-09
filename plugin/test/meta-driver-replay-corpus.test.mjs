// @test-group engine
// Dataset-integrity tests for plugin/fixtures/meta-driver-replay/ — see its README.md and
// tasks/gap-meta-driver-offline-replay-corpus-goal030-033.md. These tests guard the corpus's
// own structural promises (cutoff/input/reference separation, schema completeness, no
// reference leaking into the default prompt, unique case ids) — they do NOT score any
// candidate's architectural judgment.
//
// Run: scripts/test.sh plugin/test/meta-driver-replay-corpus.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CORPUS_ROOT,
  listCaseIds,
  loadCaseInput,
  loadCaseReference,
  loadCaseOutcome,
  buildDefaultPrompt,
} from "./helpers/meta-driver-replay-harness.mjs";

const INPUT_REQUIRED = ["case_id", "cutoff", "context", "decision_prompt_schema"];
const REFERENCE_REQUIRED = [
  "case_id",
  "selected_concern",
  "selected_slice",
  "why_now",
  "why_not_others",
  "risk",
  "scope_discipline",
  "acceptance_evidence",
  "stop_abandon_condition",
  "leakage_markers",
  "investigation_or_goal_reference",
];
const OUTCOME_REQUIRED = ["case_id", "status"];

test("corpus has exactly the expected 4 cases, unique ids matching directory names", () => {
  const ids = listCaseIds();
  assert.deepEqual(ids, ["GOAL-030", "GOAL-031", "GOAL-032", "GOAL-033"]);
  const seen = new Set();
  for (const id of ids) {
    assert.ok(!seen.has(id), `duplicate case id ${id}`);
    seen.add(id);
    const input = loadCaseInput(id);
    const reference = loadCaseReference(id);
    const outcome = loadCaseOutcome(id);
    assert.equal(input.case_id, id, `input.json case_id must match directory name for ${id}`);
    assert.equal(reference.case_id, id, `reference.json case_id must match directory name for ${id}`);
    assert.equal(outcome.case_id, id, `outcome.json case_id must match directory name for ${id}`);
  }
});

for (const id of ["GOAL-030", "GOAL-031", "GOAL-032", "GOAL-033"]) {
  test(`${id}: input.json has all required schema keys`, () => {
    const input = loadCaseInput(id);
    for (const key of INPUT_REQUIRED) assert.ok(key in input, `input.json missing ${key}`);
    assert.ok(Array.isArray(input.decision_prompt_schema.questions) && input.decision_prompt_schema.questions.length === 8, "must have exactly 8 questions");
    assert.ok(typeof input.decision_prompt_schema.response_schema === "object");
  });

  test(`${id}: reference.json has all required schema keys`, () => {
    const reference = loadCaseReference(id);
    for (const key of REFERENCE_REQUIRED) assert.ok(key in reference, `reference.json missing ${key}`);
    assert.ok(Array.isArray(reference.leakage_markers) && reference.leakage_markers.length > 0, "leakage_markers must be a non-empty array");
    assert.ok(Array.isArray(reference.scope_discipline.non_goals) && reference.scope_discipline.non_goals.length > 0);
    assert.ok(Array.isArray(reference.scope_discipline.stop_signals) && reference.scope_discipline.stop_signals.length > 0);
  });

  test(`${id}: outcome.json has all required schema keys`, () => {
    const outcome = loadCaseOutcome(id);
    for (const key of OUTCOME_REQUIRED) assert.ok(key in outcome, `outcome.json missing ${key}`);
    assert.ok(["landed", "in-progress"].includes(outcome.status), `unexpected status ${outcome.status}`);
  });

  test(`${id}: none of reference.json's leakage_markers appear anywhere in input.json`, () => {
    const reference = loadCaseReference(id);
    const inputRaw = JSON.stringify(loadCaseInput(id));
    for (const marker of reference.leakage_markers) {
      assert.ok(!inputRaw.includes(marker), `leakage marker "${marker}" found in ${id}/input.json — hindsight leak`);
    }
  });

  test(`${id}: cutoff is strictly before the real goal's activatedAt`, () => {
    const input = loadCaseInput(id);
    const goalFiles = fs.readdirSync(path.join(CORPUS_ROOT, "..", "..", "..", "goals")).filter((f) => f.startsWith(id + "-") && f.endsWith(".md"));
    assert.ok(goalFiles.length === 1, `expected exactly one goals/${id}-*.md file, found ${goalFiles.length}`);
    const goalText = fs.readFileSync(path.join(CORPUS_ROOT, "..", "..", "..", "goals", goalFiles[0]), "utf8");
    const m = goalText.match(/^activatedAt:\s*(\S+)/m);
    assert.ok(m, `could not find activatedAt in goals/${goalFiles[0]}`);
    const activatedAt = new Date(m[1]).getTime();
    const cutoff = new Date(input.cutoff).getTime();
    assert.ok(cutoff < activatedAt, `cutoff (${input.cutoff}) must be strictly before activatedAt (${m[1]}) for ${id}`);
  });

  test(`${id}: buildDefaultPrompt works even with reference.json and outcome.json removed (behavioral leakage guard)`, () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-driver-replay-corpus-test-"));
    try {
      const caseTmp = path.join(tmpDir, id);
      fs.mkdirSync(caseTmp);
      fs.copyFileSync(path.join(CORPUS_ROOT, id, "input.json"), path.join(caseTmp, "input.json"));
      // deliberately do NOT copy reference.json or outcome.json
      const promptFromReal = buildDefaultPrompt(id, CORPUS_ROOT);
      const promptFromTmp = buildDefaultPrompt(id, tmpDir);
      assert.equal(promptFromTmp, promptFromReal, "prompt built without reference/outcome present must be identical to the real one");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
}

test("README.md exists and states the first-version/not-a-benchmark caveat", () => {
  const readme = fs.readFileSync(path.join(CORPUS_ROOT, "README.md"), "utf8");
  assert.match(readme, /not a validated statistical benchmark/i);
  assert.match(readme, /not to be over-fit/i);
});
