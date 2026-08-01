---
id: DIR-124-F3b
title: "Preflight-touches-mismatch RED/GREEN fixture legs (prepare-admission-check tests)"
status: todo
labels:
  - directive
  - milestone-candidate
parent: DIR-124-F3
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

Split from DIR-124-F3 (M259, ProposalReview disposition `split-recommended` /
`split-multi-mechanism`) — the **RED/GREEN fixture legs** for the `preflight-touches-mismatch` gate.
The gate already exists in `prepare-admission-check.ts` (the `_stripWrappingBacktick` / Touches
coverage check); what is missing is a fixed fixture pair proving both directions: an undeclared
Plan `- Files:` line is a violation, and a declared Touches entry passes. This child owns those
fixture legs in `prepare-admission-check.test.mjs` (both mirrors).

### Chosen mechanism

**ONE mechanism — the `preflight-touches-mismatch` fixture-leg family for the shared gate.** All
three legs below are call-site variants of ONE atomic behavior contract. Each leg pins the single
`preflightTouchesMismatch` detector (one implementation in `prepare-admission-check.ts`): an
undeclared Plan `- Files:` line is a violation (fail-closed), a declared Touches entry passes. The
legs share ONE detector, ONE test file family (`prepare-admission-check.test.mjs` +
`test/fixtures/preflight/` in both mirrors), and NO strict subset ships independently with a complete
safety contract and independent user value.

1. **F3b-SAMEFILE-FIXTURES — the fixture pair itself** — the fixed RED/GREEN fixture set under
   `test/fixtures/preflight/touches-mismatch/` (a `task.md` whose Plan `- Files:` line names a file
   NOT declared in `## Touches`, e.g. `task-schema.ts` under a `*ground-truth*`-only Touches, and its
   declared-Touches GREEN complement) asserts the gate reports `preflight-touches-mismatch`
   (violation, fail-closed) / passes.
2. **F3b-DOUBLESTAR-LEG — the declared-glob coverage leg** — a `prepare-admission-check.test.mjs`
   case exercising the `_stripWrappingBacktick` / `@@DOUBLESTAR@@ → .*` glob-normalization path so a
   declared `## Touches` glob still matches a `- Files:` line naming `task-schema.ts`; asserts GREEN
   (and its RED complement when the entry is undeclared).
3. **F3b-CLI-SAMEFILE-LEG — the CLI end-to-end leg** — a `prepare-admission-check` CLI
   (`runPreflightChecks`) invocation over the same fixture files proves the gate's fail-closed
   behavior surfaces as a test failure, never a review comment.
4. **No gate-logic change** — `prepare-admission-check.ts` itself is NOT modified by this child
   (the gate's behavior already exists; this child pins it as fixed RED/GREEN tests). The
   experiments/ and plugin/ test files stay byte-identical.

**These legs are NOT independently shippable** — they exercise one detector
(`preflightTouchesMismatch`) in one test file family (`prepare-admission-check.test.mjs` +
`test/fixtures/preflight/`); splitting them would fragment a single atomic test contract with no
independent user value.

**WIRING-CLAIM (F3b-PREFLIGHT-FIXTURES):** `prepare-admission-check.test.mjs` (both mirrors)
carries a fixed RED/GREEN fixture pair for `preflight-touches-mismatch` — undeclared `- Files:` line
is a violation, declared entry passes — so the gate's fail-closed behavior is a test failure, never
a review comment. → AC1: fixture legs RED/GREEN in both mirrors.

## Acceptance Criteria

- [ ] `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs` and the
  `plugin/test/` mirror carry the `preflight-touches-mismatch` RED/GREEN fixture legs.
- [ ] RED leg: an undeclared Plan `- Files:` line is reported as a `preflight-touches-mismatch`
  violation (fail-closed).
- [ ] GREEN leg: a declared Touches entry for the same file passes.
- [ ] `prepare-admission-check.ts` (both mirrors) is unchanged by this child; both test files are
  byte-identical (`diff` exit 0).
- [ ] Tests GREEN per `scripts/test.sh`.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] One real prepare-milestone preflight run exercises the fixture legs (real dispatch evidence).
- [ ] A fresh independent audit finds no refutation.

## Touches

- `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs`
- `plugin/test/prepare-admission-check.test.mjs`
- `docs/plans/M268-dir-124-f3b.md`
- `milestones/M268/preparation.json`
- `milestones/M268/proposal-ledger.json`
- `milestones/M268/stage-journal.jsonl`
- `milestones/M268/receipts/*.json`
- `tasks/DIR-124-F3b.md`
- `.quay/config.yml`
- `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` (read-only — `--check` verification input, not modified)
- `plugin/scripts/milestone-preparation-check.ts` (read-only — mirror)
