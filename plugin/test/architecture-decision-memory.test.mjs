// @test-group engine
// Tests for the architecture DECISION MEMORY (task gap-architecture-evidence-store-and-decision-memory).
// The memory's whole job is "this exact item was already judged — do not judge it again", so the tests are
// about the two things that can go wrong: matching by a word instead of by a location (false hit), and
// collapsing "nothing matched" into "I could not read the input" (硬规则 2 / 3b).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SEED_DECISIONS, DECISION_STATUS, isKnownExemption, matchingEntries, candidateFiles,
  candidateFromProposal, normalizeDecisionPath, extractPathTokens,
} from "../../docs/analysis/architecture-decision-memory.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

// ── 1. the seed corpus ────────────────────────────────────────────────────────────────────────
test("seed: every entry is source-cited, typed, and names existing workspace paths", () => {
  assert.ok(SEED_DECISIONS.length >= 2, "at least the github-client exemption and the GOAL-036 defect");
  const types = new Set(SEED_DECISIONS.map((e) => e.type));
  assert.deepEqual([...types].sort(), ["exempted", "known-not-yet-filed"], "both hit semantics are represented");
  for (const e of SEED_DECISIONS) {
    assert.match(e.id, /^dm-\d{3}-/, e.id);
    assert.ok(["exempted", "known-not-yet-filed"].includes(e.type), e.id);
    assert.ok(e.reason.length > 40, `${e.id}: a memory with no quotable reason is an opinion`);
    assert.match(e.source, /(tasks|goals)\//, `${e.id}: every entry cites its source task/goal`);
    assert.ok(e.files.length >= 1 && e.files.every((f) => f === normalizeDecisionPath(f)), `${e.id}: registered file paths are normalized`);
    for (const f of e.files) assert.ok(fs.existsSync(path.join(REPO, f)), `${e.id}: registered path ${f} must exist in this workspace`);
  }
});

// ── 2. the real historical misjudgment (AC2's subject) ────────────────────────────────────────
test("hit: the exempted github-client.ts status-literal proposal is recognised as exempted", () => {
  // This is the exact input the live shadow loop re-proposed (docs/analysis/ownership-active-replay.md §3).
  const candidate = {
    concern_kind: "canonicalization",
    concern: "The task-status vocabulary has an un-owned second copy: `packages/quay-github/src/github-client.ts` compares/assigns statuses with bare literals while `packages/quay/src/abi.ts` is the declared single owner.",
    scope: { in_scope: ["packages/quay-github/src/github-client.ts (the ~13 literal compare/assign sites and the existing import at line 6)"], non_goals: [] },
    candidate_interventions: [{ title: "Converge the ABI-status literals in github-client.ts onto `TASK_STATUS.*`", rationale: "caller-side convergence" }],
  };
  const r = isKnownExemption(candidate);
  assert.equal(r.status, "exempted");
  assert.equal(r.matched_entry.id, "dm-001-github-client-status-literals");
  assert.deepEqual(r.matched_files, ["packages/quay-github/src/github-client.ts"]);
  assert.equal(r.unreadable_input, false);
});

test("hit: the GOAL-036 flipGoal statusLog defect is `known-not-yet-filed`, NOT `exempted`", () => {
  const r = isKnownExemption({ concern_kind: "other-boundary", concern: "goal-store.ts flipGoal never appends statusLog on the disposeOld->achieved path", scope: { in_scope: ["packages/quay/src/goal-store.ts"] } });
  assert.equal(r.status, "known-not-yet-filed", "a recorded-but-unfiled defect must NOT read like a decided exemption");
  assert.equal(r.matched_entry.id, "dm-002-flipgoal-disposeold-statuslog");
});

test("dominance: when a location is both exempted and defect-flagged, `exempted` wins", () => {
  const r = isKnownExemption({ concern_kind: "other-boundary", files: ["packages/quay/src/goal-store.ts"] }, [
    { id: "a", type: "known-not-yet-filed", concern_kinds: ["other-boundary"], files: ["packages/quay/src/goal-store.ts"], reason: "x".repeat(50), source: "tasks/x.md" },
    { id: "b", type: "exempted", concern_kinds: ["other-boundary"], files: ["packages/quay/src/goal-store.ts"], reason: "y".repeat(50), source: "goals/y.md" },
  ]);
  assert.equal(r.status, "exempted");
  assert.equal(r.candidates_considered, 2, "both hits are counted, not hidden by the sort");
});

test("dominance direction is real (not vacuous): with only the defect entry present the status is the weaker one", () => {
  const r = isKnownExemption({ concern_kind: "other-boundary", files: ["packages/quay/src/goal-store.ts"] }, [
    { id: "a", type: "known-not-yet-filed", concern_kinds: ["other-boundary"], files: ["packages/quay/src/goal-store.ts"], reason: "x".repeat(50), source: "tasks/x.md" },
  ]);
  assert.equal(r.status, "known-not-yet-filed");
});

// ── 3. negative controls — matching is by LOCATION, never by keyword (硬规则 2) ───────────────
test("no-hit: prose that merely TALKS about the exempted item matches nothing", () => {
  const proseOnly = {
    concern_kind: "canonicalization",
    concern: "The github-client status literals are scattered and there is an un-owned second copy of the task-status vocabulary in the provider package.",
    scope: { in_scope: ["the provider package's status comparisons"], non_goals: [] },
    candidate_interventions: [{ title: "Converge the ABI status literals onto the single owner", rationale: "canonicalization" }],
  };
  assert.deepEqual(candidateFiles(proseOnly), [], "no complete repo path token ⇒ no location");
  assert.equal(isKnownExemption(proseOnly).status, "not-known");
});

test("no-hit: the right file with the WRONG concern_kind is not a hit", () => {
  const r = isKnownExemption({ concern_kind: "package-cycle", files: ["packages/quay-github/src/github-client.ts"] });
  assert.equal(r.status, "not-known", "the exemption is about canonicalization, not about cycles");
});

test("no-hit: an unrelated file that happens to be mentioned is not a hit", () => {
  const r = isKnownExemption({ concern_kind: "canonicalization", files: ["packages/quay/src/serve.ts"] });
  assert.equal(r.status, "not-known");
});

test("an ENUM, not a boolean: `not-known` and `unreadable input` are distinguishable states", () => {
  for (const bad of [null, [], "a string", 42]) {
    const r = isKnownExemption(bad);
    assert.equal(r.status, "not-known");
    assert.equal(r.unreadable_input, true, "a shape the matcher cannot read must not be shaped like 'nothing matched'");
  }
  assert.equal(isKnownExemption({ concern_kind: "canonicalization", files: ["packages/quay/src/serve.ts"] }).unreadable_input, false);
  assert.deepEqual([...DECISION_STATUS], ["exempted", "known-not-yet-filed", "not-known"]);
});

// ── 4. extraction helpers ─────────────────────────────────────────────────────────────────────
test("extractPathTokens takes complete repo paths only, and candidateFiles unions the structural fields", () => {
  assert.deepEqual(extractPathTokens("see packages/a/b.ts and docs/c/d.md"), ["packages/a/b.ts", "docs/c/d.md"]);
  assert.deepEqual(extractPathTokens("just the words a/b and status literals"), [], "no directory root + extension ⇒ not a location");
  const files = candidateFiles({ files: ["packages/x/y.ts"], scope: { in_scope: ["packages/z/w.ts (the site)"] }, slice: { moves: [{ file: "packages/q/r.ts" }] } });
  assert.deepEqual(files, ["packages/q/r.ts", "packages/x/y.ts", "packages/z/w.ts"]);
});

test("candidateFromProposal keeps the structural fields and nothing else", () => {
  const c = candidateFromProposal({ concern_kind: "canonicalization", concern: "x", declared_measurement: "y", scope: { in_scope: ["packages/a/b.ts"] }, candidate_interventions: [{ title: "t" }], slice: null, confidence: { level: "high" } });
  assert.deepEqual(Object.keys(c).sort(), ["candidate_interventions", "concern", "concern_kind", "declared_measurement", "scope", "slice"]);
  assert.deepEqual(matchingEntries(c).map((e) => e.id), []);
});

test("normalizeDecisionPath rejects anything that is not a path", () => {
  assert.equal(normalizeDecisionPath("packages/a/b.ts"), "packages/a/b.ts");
  assert.equal(normalizeDecisionPath("./packages/a/b.ts"), "packages/a/b.ts");
  assert.equal(normalizeDecisionPath("a b c"), null, "whitespace ⇒ not a path");
  assert.equal(normalizeDecisionPath(null), null);
});
