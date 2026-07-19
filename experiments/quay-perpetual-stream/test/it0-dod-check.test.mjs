// Unit tests for it0-dod-check.mjs — the DoD meta-enforcer (Clauses 0-9), charters
// M25-dod-meta-enforcer / M32-dod-escrow-testfloor / M40-dir014-task-canonical-lifecycle-record /
// DIR-026. These import the EXPORTED pure `runDodCheck({ milestoneId, charterFile, charterFileText,
// absorbFileText })` and exercise each clause with IN-MEMORY charter/absorb strings modelled on the
// shapes under fixtures/dod/*.md. Written per ADR-001 / DIR-019 discipline: the fix for any failing
// case belongs in the MODULE, never in the test's synthetic inputs.
//
// The primary behavior lock remains scripts/dod-fixture-selfcheck.sh (17 real fixtures, CLI-level,
// exit-code asserted). These unit tests add per-clause white-box coverage of runDodCheck.
//
// Run:
//   node --test experiments/quay-perpetual-stream/test/it0-dod-check.test.mjs
//   node --test --experimental-test-coverage experiments/quay-perpetual-stream/test/it0-dod-check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { runDodCheck } from "../scripts/it0-dod-check.mjs";

// ── Reusable in-memory fixture builders (mirror fixtures/dod/*.md section shapes) ────────────────
// A COMBINED fixture is a single text with `## Charter excerpt` / `## ABSORB-entry excerpt` /
// `## Backlog row` / `## Acceptance Criteria` / `## Definition of Done` sections — the same file is
// passed as BOTH charterFileText and absorbFileText (the fixture shape). Each clause reads only its
// own section (extractSection isolation), exactly as the CLI does.

const CLEAN_CHARTER_EXCERPT = `## Charter excerpt

**Milestone id:** MID

### Deliverable
Ships a small operational change (not design-only). No self-exemption language for any DoD clause.

### Explicitly OUT of scope
- Ordinary scope note that names/exempts no DoD clause (should NOT trigger clause 5).
`;

// ABSORB excerpt with explicit dispositions for clauses 1/2 and no self-exemption.
const CLEAN_ABSORB_EXCERPT = `## ABSORB-entry excerpt

ABSORB log entry (synthetic):
- Adversarial-audit gate: documented no-op — neither condition applied; stated explicitly.
- V_meta consolidation-lag gate: clear — no rows past the K=2 threshold.
- Line-budget gate: PASS — small scope.
- Impl-row gate: N/A — not design-only, ships operational work.
No self-exemption language for any DoD clause appears, so no WAIVER line is required.
`;

// A non-design-only backlog row with a product-neutral surface so clauses 4/6/7 N/A-pass.
const NEUTRAL_BACKLOG_ROW = `## Backlog row

| MID | Fake milestone — ships operational work, not design-only | DONE | explore | milestone-candidate, surface:method-infra |
`;

const GOOD_AC = `## Acceptance Criteria

- The operational script exits 0 on compliant input and 1 on violating input.
- A unit test covers both the pass and fail paths.
- \`--help\` documents the new flag.
`;

const GOOD_DOD = `## Definition of Done

References the standard DoD (the five clauses in inherited-core.md — adversarial-audit, V_meta-lag,
line-budget, impl-row, no-self-exemption) plus this task's own extra:
- Standard DoD clauses 1-5 all satisfied.
`;

// Assemble a combined fixture text from parts. `milestoneId` is substituted for the literal token
// "MID" everywhere so the backlog-row id / label-derived clauses line up.
function buildFixture({
  milestoneId = "M-FAKE",
  charter = CLEAN_CHARTER_EXCERPT,
  absorb = CLEAN_ABSORB_EXCERPT,
  backlog = NEUTRAL_BACKLOG_ROW,
  ac = GOOD_AC,
  dod = GOOD_DOD,
} = {}) {
  const text = [charter, absorb, backlog, ac, dod].join("\n") + "\n";
  return text.replaceAll("MID", milestoneId);
}

// Run runDodCheck on a combined fixture (same text for charter + absorb, the fixture convention).
// charterFile is a real on-disk path so clause-3's line-budget shell-out has something to read; we
// use this test file itself (a small file that comfortably passes the line-budget check).
import { fileURLToPath } from "node:url";
const THIS_FILE = fileURLToPath(import.meta.url);

function run(opts) {
  const milestoneId = opts.milestoneId || "M-FAKE";
  const text = buildFixture(opts);
  return runDodCheck({
    milestoneId,
    charterFile: THIS_FILE,
    charterFileText: text,
    absorbFileText: text,
  });
}

const hasFail = (r, needle) => r.failures.some((f) => f.includes(needle));
const hasPass = (r, needle) => r.passes.some((p) => p.includes(needle));

// ── Baseline: a clean milestone produces NO failures ─────────────────────────────────────────────
test("clean milestone: no failures, clauses 0/1/2/5 pass", () => {
  const r = run({ milestoneId: "M-FAKE-CLEAN" });
  assert.equal(r.failures.length, 0, `unexpected failures: ${JSON.stringify(r.failures)}`);
  assert.ok(hasPass(r, "clause0-ac-dod-present"));
  assert.ok(hasPass(r, "clause1-adversarial-audit"));
  assert.ok(hasPass(r, "clause2-vmeta-lag"));
  assert.ok(hasPass(r, "clause5-no-self-exemption"));
});

// ── Clause 0: AC/DoD presence + shape ────────────────────────────────────────────────────────────
test("clause0: missing '## Acceptance Criteria' → failure", () => {
  const r = run({ milestoneId: "M-FAKE-NOAC", ac: "" });
  assert.ok(hasFail(r, "no '## Acceptance Criteria' section"), JSON.stringify(r.failures));
});

test("clause0: AC section with only a placeholder bullet → failure (no concrete clause)", () => {
  const ac = `## Acceptance Criteria\n\n- TBD\n`;
  const r = run({ milestoneId: "M-FAKE-PLACEHOLDER", ac });
  assert.ok(hasFail(r, "no concrete checkable clause"), JSON.stringify(r.failures));
});

test("clause0: missing '## Definition of Done' → failure", () => {
  const r = run({ milestoneId: "M-FAKE-NODOD", dod: "" });
  assert.ok(hasFail(r, "no '## Definition of Done' section"), JSON.stringify(r.failures));
});

test("clause0: DoD that does not reference the standard → failure", () => {
  const dod = `## Definition of Done\n\n- Some unrelated done note with no reference to the shared checks.\n`;
  const r = run({ milestoneId: "M-FAKE-BADDOD", dod });
  assert.ok(hasFail(r, "does not reference the standard DoD"), JSON.stringify(r.failures));
});

test("clause0: checklist-form AC with an unchecked box HARD-blocks (no needs-human)", () => {
  const ac = `## Acceptance Criteria\n\n- [x] first criterion is done and verified\n- [ ] second criterion still not done\n`;
  const r = run({ milestoneId: "M-FAKE-UNCHECKED", ac });
  assert.ok(hasFail(r, "unchecked item(s) remaining"), JSON.stringify(r.failures));
});

test("clause0: checklist-form AC all-checked → pass (checklist-form shape note)", () => {
  const ac = `## Acceptance Criteria\n\n- [x] first criterion is done and verified\n- [x] second criterion is done and verified\n`;
  const r = run({ milestoneId: "M-FAKE-ALLCHECKED", ac });
  assert.ok(hasPass(r, "checklist-form"), JSON.stringify(r.passes));
  assert.ok(!hasFail(r, "clause0"));
});

// ── Clause 1: adversarial-audit disposition ──────────────────────────────────────────────────────
test("clause1: absorb text with no adversarial-audit disposition → failure", () => {
  const absorb = `## ABSORB-entry excerpt\n\n- V_meta consolidation-lag gate: clear — no rows past the K=2 threshold.\n`;
  const r = run({ milestoneId: "M-FAKE-NOAUDIT", absorb });
  assert.ok(hasFail(r, "clause1-adversarial-audit"), JSON.stringify(r.failures));
});

test("clause1: a stated verdict (NO REFUTATION FOUND) → pass (verdict)", () => {
  const absorb = `## ABSORB-entry excerpt\n\n- Adversarial-audit gate: NO REFUTATION FOUND on the acceptance claims.\n- V_meta consolidation-lag gate: clear — no rows past the K=2 threshold.\n`;
  const r = run({ milestoneId: "M-FAKE-VERDICT", absorb });
  assert.ok(hasPass(r, "(verdict)"), JSON.stringify(r.passes));
});

// ── Clause 2: V_meta consolidation-lag disposition ───────────────────────────────────────────────
test("clause2: absorb text with no V_meta-lag disposition → failure", () => {
  const absorb = `## ABSORB-entry excerpt\n\n- Adversarial-audit gate: documented no-op — neither condition applied.\n`;
  const r = run({ milestoneId: "M-FAKE-NOLAG", absorb });
  assert.ok(hasFail(r, "clause2-vmeta-lag"), JSON.stringify(r.failures));
});

// ── Clause 5: no undeclared self-exemption ───────────────────────────────────────────────────────
test("clause5: charter exempts line-budget with NO matching WAIVER line → failure", () => {
  const charter = `## Charter excerpt

**Milestone id:** MID

### Explicitly OUT of scope
- The line-budget gate does not apply to this milestone.
`;
  const r = run({ milestoneId: "M-FAKE-EXEMPT", charter });
  assert.ok(hasFail(r, "clause5-no-self-exemption"), JSON.stringify(r.failures));
  assert.ok(hasFail(r, "line-budget"), JSON.stringify(r.failures));
});

test("clause5: same exemption WITH a matching WAIVER line in absorb → no clause5 failure", () => {
  const charter = `## Charter excerpt

**Milestone id:** MID

### Explicitly OUT of scope
- The line-budget gate does not apply to this milestone.
`;
  const absorb = CLEAN_ABSORB_EXCERPT + `\nWAIVER: MID | line-budget | intentionally waived for this fixture.\n`;
  const r = run({ milestoneId: "M-FAKE-WAIVED", charter, absorb });
  assert.ok(!hasFail(r, "clause5-no-self-exemption"), JSON.stringify(r.failures));
});

// ── Clause 6: escrow-Δv (design-only trigger) ────────────────────────────────────────────────────
const DESIGN_ONLY_BACKLOG = `## Backlog row

| MID | Fake design-only milestone — design delivered (doc only) | DONE | explore | milestone-candidate, surface:docs |
`;

test("clause6: non-design-only milestone → N/A pass", () => {
  const r = run({ milestoneId: "M-FAKE-NOTDESIGN" });
  assert.ok(hasPass(r, "clause6-escrow-delta-v: N/A"), JSON.stringify(r.passes));
});

test("clause6: design-only milestone claiming nonzero Δv with NO escrow language → failure", () => {
  const absorb = `## ABSORB-entry excerpt

- Adversarial-audit gate: documented no-op — neither condition applied.
- V_meta consolidation-lag gate: clear — no rows past the K=2 threshold.
- This milestone appended a VT-curve delta-v = 5 as a final measured value.
`;
  const r = run({ milestoneId: "M-FAKE-ESCROWBAD", absorb, backlog: DESIGN_ONLY_BACKLOG });
  assert.ok(hasFail(r, "clause6-escrow-delta-v"), JSON.stringify(r.failures));
});

test("clause6: design-only milestone with escrowed Δv claim → pass", () => {
  const absorb = `## ABSORB-entry excerpt

- Adversarial-audit gate: documented no-op — neither condition applied.
- V_meta consolidation-lag gate: clear — no rows past the K=2 threshold.
- This milestone records a provisional VT-curve delta-v = 5, escrowed pending the -IMPL row shipping.
`;
  const r = run({ milestoneId: "M-FAKE-ESCROWOK", absorb, backlog: DESIGN_ONLY_BACKLOG });
  assert.ok(hasPass(r, "clause6-escrow-delta-v: PASS"), JSON.stringify(r.passes));
});

test("clause6: design-only milestone claiming Δv̂ 0 (no claim) → documented no-op pass", () => {
  const absorb = `## ABSORB-entry excerpt

- Adversarial-audit gate: documented no-op — neither condition applied.
- V_meta consolidation-lag gate: clear — no rows past the K=2 threshold.
- Δv̂: 0, no VT chart cell for this milestone.
`;
  const r = run({ milestoneId: "M-FAKE-NODELTA", absorb, backlog: DESIGN_ONLY_BACKLOG });
  assert.ok(hasPass(r, "clause6-escrow-delta-v: PASS"), JSON.stringify(r.passes));
});

// ── Clause 7: product-work test-floor ────────────────────────────────────────────────────────────
const PRODUCT_BACKLOG = `## Backlog row

| MID | Fake product-touching milestone | DONE | explore | milestone-candidate, surface:cli |
`;

test("clause7: non-product surface (method-infra) → N/A pass", () => {
  const r = run({ milestoneId: "M-FAKE-NONPROD" });
  assert.ok(hasPass(r, "clause7-test-floor: N/A"), JSON.stringify(r.passes));
});

test("clause7: product surface with NO coverage disposition or waiver → failure (fail-closed)", () => {
  const r = run({ milestoneId: "M-FAKE-PRODNOCOV", backlog: PRODUCT_BACKLOG });
  assert.ok(hasFail(r, "clause7-test-floor"), JSON.stringify(r.failures));
});

test("clause7: product surface WITH a ≥80% coverage disposition → pass", () => {
  const absorb = CLEAN_ABSORB_EXCERPT + `\nThe shipped CLI code carries test coverage of 87% on its new lines.\n`;
  const r = run({ milestoneId: "M-FAKE-PRODCOV", absorb, backlog: PRODUCT_BACKLOG });
  assert.ok(hasPass(r, "clause7-test-floor: PASS"), JSON.stringify(r.passes));
});

test("clause7: coverage claim negated in same sentence → still failure (negation-poison)", () => {
  const absorb = CLEAN_ABSORB_EXCERPT + `\nNo 80% test coverage floor was met; coverage remains well below the bar.\n`;
  const r = run({ milestoneId: "M-FAKE-PRODNEG", absorb, backlog: PRODUCT_BACKLOG });
  assert.ok(hasFail(r, "clause7-test-floor"), JSON.stringify(r.failures));
});

// ── Clause 8: task canonical-lifecycle-record (forward-only, milestone:M>=40 cutover) ─────────────
// The clause reads the task text (no real tasks/<id>.md file exists for these synthetic ids, so it
// falls back to the charter/fixture text). We embed a `milestone:M4x` label to make it fire, plus
// `## Proposal` / `## Plan` sections.
test("clause8: milestone below cutover (no milestone label) → N/A grandfathered pass", () => {
  const r = run({ milestoneId: "M-FAKE-LEGACY" });
  assert.ok(hasPass(r, "clause8-task-canonical-lifecycle-record: N/A"), JSON.stringify(r.passes));
});

test("clause8: milestone >=40 missing '## Proposal' → failure", () => {
  const charter = CLEAN_CHARTER_EXCERPT + `\nlabel: milestone:M41-fake\n`;
  const r = run({ milestoneId: "M-FAKE-NOPROP", charter });
  assert.ok(hasFail(r, "clause8-task-canonical-lifecycle-record"), JSON.stringify(r.failures));
  assert.ok(hasFail(r, "no '## Proposal' section"), JSON.stringify(r.failures));
});

test("clause8: milestone >=40 with real Proposal + N/A Plan → pass", () => {
  const charter = CLEAN_CHARTER_EXCERPT + `\nlabel: milestone:M41-fake\n`;
  const extra = `## Proposal

This milestone introduces a concrete, well-described approach with more than forty characters of
genuine explanatory content describing what is built and why.

## Plan

N/A — this is a small single-increment change; no separate docs/plans record is warranted.
`;
  // Append Proposal/Plan after the DoD; extractSection reads by heading regardless of order.
  const r = run({ milestoneId: "M-FAKE-PROPOK", charter, dod: GOOD_DOD + "\n" + extra });
  assert.ok(hasPass(r, "clause8-task-canonical-lifecycle-record"), JSON.stringify(r.passes));
  assert.ok(!hasFail(r, "clause8"));
});

test("clause8: milestone >=40 Plan references a non-resolving docs/plans path → failure", () => {
  const charter = CLEAN_CHARTER_EXCERPT + `\nlabel: milestone:M41-fake\n`;
  const extra = `## Proposal

This milestone introduces a concrete, well-described approach with more than forty characters of
genuine explanatory content describing what is built and why.

## Plan

See docs/plans/this-plan-does-not-exist-on-disk-xyz.md for the phased plan.
`;
  const r = run({ milestoneId: "M-FAKE-BADPLAN", charter, dod: GOOD_DOD + "\n" + extra });
  assert.ok(hasFail(r, "do NOT resolve on disk"), JSON.stringify(r.failures));
});

// ── Clause 9: SPLIT-OR-COMMIT / needs-human ──────────────────────────────────────────────────────
test("clause9: no needs-human declared → N/A nop", () => {
  const r = run({ milestoneId: "M-FAKE-NONH" });
  assert.ok(r.nops.some((n) => n.includes("clause9-split-or-commit")), JSON.stringify(r.nops));
});

test("clause9: needs-human with a genuine EXTERNAL blocker → pass", () => {
  // needs-human declared → clause 0's unchecked-box block is waived; use an unchecked AC to model a
  // legitimately-incomplete blocked milestone (mirrors the real needs-human fixtures).
  const ac = `## Acceptance Criteria\n\n- [ ] blocked criterion could not complete\n`;
  const absorb = CLEAN_ABSORB_EXCERPT + `\nOUTCOME: needs-human — blocked by an upstream third-party API that is currently unavailable.\n`;
  const r = run({ milestoneId: "M-FAKE-NHEXT", absorb, ac });
  assert.ok(hasPass(r, "clause9-split-or-commit"), JSON.stringify(r.passes));
});

test("clause9: needs-human with an IN-PROJECT reason → failure", () => {
  const ac = `## Acceptance Criteria\n\n- [ ] blocked criterion could not complete\n`;
  const absorb = CLEAN_ABSORB_EXCERPT + `\nOUTCOME: needs-human — the refactor was too complex and the architecture mismatch was hard.\n`;
  const r = run({ milestoneId: "M-FAKE-NHINT", absorb, ac });
  assert.ok(hasFail(r, "clause9-split-or-commit"), JSON.stringify(r.failures));
  assert.ok(hasFail(r, "IN-PROJECT factor"), JSON.stringify(r.failures));
});

test("clause9: needs-human with a bare/empty reason → failure", () => {
  // The empty-reason branch is only reachable when the OUTCOME line is the ABSOLUTE last non-blank
  // content across absorb+charter — the enforcer's needs-human regex tail `\\s*(.*)` crosses newlines,
  // so any following non-blank line (even the charter's `**Milestone id:**`) would be captured as the
  // reason. So this case calls runDodCheck directly with charter/absorb text that terminates at the
  // OUTCOME line, isolating the bare-reason guard honestly rather than through the combined-fixture
  // builder (which always has trailing sections). Other clauses fail here too; we assert only clause 9.
  const absorb = `## ABSORB-entry excerpt\n\n- Adversarial-audit gate: documented no-op — neither condition applied.\n- V_meta consolidation-lag gate: clear — no rows past the K=2 threshold.\n\n## Backlog row\n\n| M-FAKE-NHBARE | row | needs-human | explore | surface:method-infra |\nOUTCOME: needs-human —`;
  const r = runDodCheck({
    milestoneId: "M-FAKE-NHBARE",
    charterFile: THIS_FILE,
    charterFileText: absorb,
    absorbFileText: absorb,
  });
  assert.ok(hasFail(r, "no specific external blocker named"), JSON.stringify(r.failures));
});

test("clause9: needs-human with an unrecognized (neither in- nor out-of-project) reason → failure", () => {
  const ac = `## Acceptance Criteria\n\n- [ ] blocked criterion could not complete\n`;
  const absorb = CLEAN_ABSORB_EXCERPT + `\nOUTCOME: needs-human — waiting on a decision about the color of the widget.\n`;
  const r = run({ milestoneId: "M-FAKE-NHUNK", absorb, ac });
  assert.ok(hasFail(r, "does not name a recognizable OUTSIDE-project blocker"), JSON.stringify(r.failures));
});
