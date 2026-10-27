// @test-group engine
// Tests for the single semantic-admission contract module (task gap-semantic-admission-contract-module,
// GOAL-911 AC-919). The contract separates stage 1 (mechanical clue states) from stage 2 (semantic
// judge verdicts) and is the ONE place those value lists live.
//
// These tests IMPORT the module and assert on real values — they are not source-text greps. AC-919's
// criterion is a source-text check, so a module that merely mentioned the vocabularies in a comment
// would satisfy it; that is precisely why the behaviour is pinned here instead.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CLUE_STATES, CLUE_STATE, JUDGE_VERDICTS, JUDGE_VERDICT,
  SemanticAdmissionContractError, checkVocabulariesDisjoint, isClueState, isJudgeVerdict,
  clueRecord, judgeRecord,
} from "../../docs/analysis/semantic-admission-contract.mjs";

const sorted = (xs) => [...xs].sort();

test("AC2 — the two vocabularies are frozen, complete, distinct arrays with no shared value", () => {
  // clue layer
  assert.equal(Array.isArray(CLUE_STATES), true, "CLUE_STATES must be an array");
  assert.equal(Object.isFrozen(CLUE_STATES), true, "CLUE_STATES must be frozen");
  assert.deepEqual(sorted(CLUE_STATES), ["candidate", "clear", "not-evaluated"]);
  assert.deepEqual(sorted(Object.values(CLUE_STATE)), sorted(CLUE_STATES), "CLUE_STATE constants must cover the vocabulary");

  // judge layer
  assert.equal(Array.isArray(JUDGE_VERDICTS), true, "JUDGE_VERDICTS must be an array");
  assert.equal(Object.isFrozen(JUDGE_VERDICTS), true, "JUDGE_VERDICTS must be frozen");
  assert.deepEqual(sorted(JUDGE_VERDICTS), ["confirmed", "needs-more-evidence", "refuted"]);
  assert.deepEqual(sorted(Object.values(JUDGE_VERDICT)), sorted(JUDGE_VERDICTS), "JUDGE_VERDICT constants must cover the vocabulary");

  // distinct array objects + empty intersection + no verdict value hides in the clue layer
  assert.notEqual(CLUE_STATES, JUDGE_VERDICTS, "the two vocabularies must be different array objects");
  const shared = CLUE_STATES.filter((v) => JUDGE_VERDICTS.includes(v));
  assert.deepEqual(shared, [], "the vocabularies must not share any value");
  for (const verdict of JUDGE_VERDICTS) {
    assert.equal(CLUE_STATES.includes(verdict), false, `clue layer must not contain verdict ${verdict}`);
    assert.equal(isClueState(verdict), false, `isClueState(${verdict}) must be false`);
    assert.equal(isJudgeVerdict(verdict), true, `isJudgeVerdict(${verdict}) must be true`);
  }
  for (const clue of CLUE_STATES) {
    assert.equal(isJudgeVerdict(clue), false, `isJudgeVerdict(${clue}) must be false`);
    assert.equal(isClueState(clue), true, `isClueState(${clue}) must be true`);
  }
});

test("AC3 arm 1 — the real vocabularies evaluate as disjoint", () => {
  const r = checkVocabulariesDisjoint(CLUE_STATES, JUDGE_VERDICTS);
  assert.equal(r.evaluated, true);
  assert.deepEqual(r.violations, []);
  assert.equal(r.cause, null);
});

test("AC3 arm 2 — a clue vocabulary isomorphic to the judge vocabulary is reported by name", () => {
  const r = checkVocabulariesDisjoint(JUDGE_VERDICTS, JUDGE_VERDICTS);
  assert.equal(r.evaluated, true, "a readable but overlapping pair IS evaluated");
  assert.equal(Array.isArray(r.violations), true);
  assert.ok(r.violations.length > 0, "overlap must produce at least one violation");
  const joined = r.violations.join("\n");
  for (const v of JUDGE_VERDICTS) {
    assert.ok(joined.includes(v), `violations must name ${v}; got: ${joined}`);
  }
  assert.ok(joined.includes("硬规则 3b"), "violation text must cite the isomorphism rule");
});

test("AC3 arm 3 — unreadable input is NOT shaped like a pass", () => {
  // NB: an explicitly passed `undefined` selects the parameter default (the real vocabulary), so the
  // unreadable cases are the ones the default cannot swallow: null and non-array values.
  for (const bad of ["not-an-array", null, 42, {}, [], [], [CLUE_STATES, JUDGE_VERDICTS]]) {
    const r = checkVocabulariesDisjoint(bad, JUDGE_VERDICTS);
    assert.equal(r.evaluated, false, `unreadable clue input (${JSON.stringify(bad)}) must report evaluated:false`);
    assert.equal(typeof r.cause, "string");
    assert.ok(r.cause.trim().length > 0, "unreadable input must carry a non-empty cause");
    assert.deepEqual(r.violations, [], "an unevaluated check must not report violations as if it had checked");
  }
  for (const bad of ["nope", [], [1, 2, 3]]) {
    const r = checkVocabulariesDisjoint(CLUE_STATES, bad);
    assert.equal(r.evaluated, false, `unreadable judge input (${JSON.stringify(bad)}) must report evaluated:false`);
    assert.ok(r.cause.trim().length > 0);
  }
});

test("AC4 — clueRecord rejects a verdict value by name and requires evidence for a candidate", () => {
  // the layer-crossing rejection names the offending value AND the legal clue values
  assert.throws(
    () => clueRecord({ kind: "unencapsulated-state", subject: "pkg/foo.mjs", state: "confirmed" }),
    (err) => {
      assert.equal(err instanceof SemanticAdmissionContractError, true);
      assert.ok(err.message.includes("confirmed"), `message must name confirmed: ${err.message}`);
      for (const legal of CLUE_STATES) assert.ok(err.message.includes(legal), `message must list ${legal}: ${err.message}`);
      return true;
    },
  );

  // a candidate without its mechanical evidence is not a usable clue
  assert.throws(
    () => clueRecord({ kind: "unencapsulated-state", subject: "pkg/foo.mjs", state: "candidate" }),
    (err) => err instanceof SemanticAdmissionContractError && err.message.includes("proxy_reading"),
  );

  // legal records build
  const cand = clueRecord({
    kind: "unencapsulated-state", subject: "pkg/foo.mjs", state: "candidate",
    proxy_reading: "state written in two places", evidence_ref: "src/foo.mjs:12",
  });
  assert.equal(cand.state, "candidate");
  assert.equal(cand.proxy_reading, "state written in two places");
  assert.equal(Object.isFrozen(cand), true);
  const clear = clueRecord({ kind: "unencapsulated-state", subject: "pkg/bar.mjs", state: "clear" });
  assert.equal(clear.state, "clear");
  assert.equal(clear.proxy_reading, null);
  const unread = clueRecord({ kind: "unencapsulated-state", subject: "pkg/baz.mjs", state: "not-evaluated" });
  assert.equal(unread.state, "not-evaluated");
});

test("AC4 — judgeRecord enforces verdict membership and the counterfactual on confirmed", () => {
  // confirmed without a counterfactual is rejected, naming both the verdict and the missing control
  assert.throws(
    () => judgeRecord({ candidate_ref: "c1", verdict: "confirmed", rationale: "two writers" }),
    (err) => {
      assert.equal(err instanceof SemanticAdmissionContractError, true);
      assert.ok(err.message.includes("confirmed"), `message must name confirmed: ${err.message}`);
      assert.ok(err.message.includes("counterfactual"), `message must name counterfactual: ${err.message}`);
      return true;
    },
  );

  // refuted / needs-more-evidence do not require a counterfactual
  const refuted = judgeRecord({ candidate_ref: "c1", verdict: "refuted", rationale: "single writer behind a lock" });
  assert.equal(refuted.verdict, "refuted");
  assert.equal(refuted.counterfactual, null);
  const pending = judgeRecord({ candidate_ref: "c2", verdict: "needs-more-evidence", rationale: "no production reading yet" });
  assert.equal(pending.verdict, "needs-more-evidence");

  // confirmed WITH a counterfactual builds
  const confirmed = judgeRecord({
    candidate_ref: "c1", verdict: "confirmed", rationale: "two writers observed",
    counterfactual: "if the second writer were removed, the two readings would agree",
  });
  assert.equal(confirmed.verdict, "confirmed");
  assert.ok(confirmed.counterfactual.length > 0);

  // a clue value passed as a verdict is rejected by name
  assert.throws(
    () => judgeRecord({ candidate_ref: "c1", verdict: "candidate", rationale: "x" }),
    (err) => {
      assert.equal(err instanceof SemanticAdmissionContractError, true);
      assert.ok(err.message.includes("candidate"), `message must name candidate: ${err.message}`);
      for (const legal of JUDGE_VERDICTS) assert.ok(err.message.includes(legal), `message must list ${legal}: ${err.message}`);
      return true;
    },
  );
});
