---
id: exp5-M-CRYST-D3
title: D3 [subtractive] Rewrite OUTER-LOOP + inherited-core + inner-iteration
  prompts in formalized style; replace deterministic prompt steps with code
  (Axis 2′)
status: ready
labels:
  - milestone-candidate
  - crystallization
  - milestone:first-wave
parent: exp5-M-CRYST
children: []
extra:
  schema: "v1"
---
## Proposal
Rewrite ALL repeatable method text (OUTER-LOOP, inherited-core, inner-iteration prompts) as compact self-verifying specs + reference offload, moving every DETERMINISTIC step into code (Axis 2′) while the JUDGMENT core shrinks to a §9 Spec. This is the biggest molten mass. Multi-increment; each increment is subtractive + behavior-preserving-by-construction (never mix a prose deletion with a semantic change), verified by the existing selfcheck/fixture round-trips WITHOUT un-halting the live loop.

Increment plan (from the D3 scoping pass): (1) DONE — R1–R4: compress OUTER-LOOP's ABSORB/SELECT prose that merely NARRATES already-running code (`quay gate`, `it0-dod-check.mjs`, `it0-impl-row-check.sh`, `it0-ceiling-line-budget-check.sh`, `task-schema-check.sh`) to code-pointers, preserving every uncoded invariant. (2) R5–R7 — NEW single-source check scripts for the still-prose deterministic steps: V_meta-lag arithmetic, explore/exploit cadence, termination thresholds — each shaped as a thin `scripts/*.mjs` module wrappable by a future `quay gate --gate <name>` (M39 registry precedent), NEVER reimplemented. **parent-done-iff-children is deliberately NOT in D3's scope — it is owned by C1** (the dedicated DIR-026 split-or-commit crystallization task; single source, avoid a dual implementation). When D3 compresses OUTER-LOOP's SPLIT-OR-COMMIT prose, it references C1's check, never re-implements it. (3) §9 formalized Spec λ-blocks + `contracts: target:self` on OUTER-LOOP/inherited-core, validated BY QUAY — depends on D1 (document-management capability); until then contracts are documented + script-checked. (4) inherited-core judgment-core compression.

DUAL-SOURCE GUARD (fatal-if-violated): every new check is check-LOGIC-as-a-script (single source); D1 adds an INVOCATION surface that wraps it, never a second implementation.

## Plan
N/A — a multi-increment subtractive refactor executed increment-by-increment (each with its own mechanical acceptance); no single staged docs/plans doc. R5–R8 will each follow the task-schema.mjs single-source + selfcheck-fixture template.

## Acceptance Criteria
- [ ] Increment 1 (R1–R4): OUTER-LOOP gate-narration compressed to code-pointers, net-subtractive, selfchecks + live `quay gate` fixtures still green, compression independently reviewed LOSSLESS (no uncoded invariant lost).
- [ ] Increments R5–R8: each still-prose deterministic step becomes a single-source `scripts/*.mjs` check + selfcheck fixtures; no check logic duplicated between a script and a quay gate.
- [ ] §9 Spec + `contracts:` on OUTER-LOOP/inherited-core validated by quay (D1) — or script-checked with a recorded migration path if D1 not yet landed.
- [ ] Substantial net line reduction across the method docs.
## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [ ] Each increment is behavior-preserving, proven by the selfcheck/fixture round-trips (and, for semantic changes, a golden-milestone replay) — no live-loop regression.
- [ ] A real milestone runs under the rewritten loop with no behavior regression (the terminal proof, after the increments land).
- [ ] Net-subtractive overall; no dual source created (every check is script-single-source, quay-wrappable).

## Progress
- 2026-07-19 — INCREMENT 1 (R1–R4) LANDED: OUTER-LOOP.md 525→445 lines (net −80; 154 del / 74 ins), purely subtractive compression of prose that narrated already-running code. Preceded by an independent plan-check that extracted the MUST-PRESERVE uncoded-invariant list (absorb-file-before-gate ordering/DIR-021, clauses-1/2/6/7-are-token-scans, evidence-pasting, gate-independence/HARD-BLOCK, never-self-tick/DIR-020, single-source AC-DoD, deferral-to-never/DIR-016, fix-the-charter). Verified: selfchecks 12/12 + 17/17 (enforcing code untouched), pointer-integrity (all named scripts resolve), live `quay gate QENG-5-DEMO-PASS`→0 / `-FAIL`→1. Independent adversarial review: LOSSLESS — all 24 invariants survive (several sharper), no factual error/corrupted constant. Bonus: fixed a stale `it0-dod-check.sh` header (Clauses "0-8"→"0-9") — a doc-vs-code drift. NOT un-halted; verified entirely by fixtures/replay-safe checks.
- 2026-07-19 — R5 (Axis-2′) LANDED: extracted the V_meta consolidation-lag ARITHMETIC into a single-source executable check, following the task-schema.mjs template. New: `scripts/vmeta-lag-check.mjs` (pure check fns: parseRows/rowStatus/confirmingMilestone/hasDatedCarryForward/evaluateRow/checkLedger — the ONE definition of `milestones-since-confirmed = milestone_counter − confirming-milestone`, ALARM > K=2 for a `confirmed`-not-`consolidated` row with no DATED carry-forward), thin wrapper `scripts/vmeta-lag-check.sh` (mirrors task-schema-check.sh; shaped so a future `quay gate --gate vmeta-lag` WRAPS it, M39 precedent), `test/vmeta-lag-check.test.mjs` (28 tests, all pass; 100% line / 88.41% branch coverage via `node --test --experimental-test-coverage`), 4 fixtures under `fixtures/vmeta/` + external selfcheck `scripts/vmeta-lag-selfcheck.sh` (over-threshold-no-carryforward→FAIL, consolidated/within-threshold/dated-carry-forward→PASS; RED-confirmed before GREEN). Real-object evidence: check run against the LIVE `v-meta-ledger.md` (`--counter 40`) → PASS (correct: only a `consolidated` + a `proposed` row exist, neither alarms). SUBTRACTIVE compression: OUTER-LOOP.md ABSORB V_meta-lag gate — arithmetic prose replaced by a code-pointer, net −1 line (10 ins / 11 del), PRESERVING every uncoded policy (HARD-BLOCK on `milestone_counter++`, consolidate-or-dated-carry-forward, no-silent-deferral, ledger-row update). it0-dod-check.mjs Clause 2 token-scan left UNCHANGED (complementary, additive-by-omission). Regression: task-schema-selfcheck 12/12, dod-fixture-selfcheck 17/17, vmeta-lag-selfcheck 4/4 all green. D3 stays `ready` (multi-increment; R6/R7 next).