---
id: gap-planauthor-shape-rules-not-injected
title: "Mechanical plan-shape rules run AFTER PlanAuthor — 46 PreflightPlan
  rejections discard already-authored plans"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---

**type:** execution

## Proposal

`PreflightPlan` is a purely mechanical plan-shape check (`parsePlanStages` /
`validatePlanStructure` — no LLM). It runs AFTER `PlanAuthor` has written the full plan.

**Evidence (232 dispatches):**

| Terminal phase | Count |
|---|---|
| ProposalReview | 100 |
| **PreflightPlan** | **46** |
| PlanCheck | 45 |
| Admission | 22 |
| Receipt | 16 |
| **PreflightContent** | **3** |

PlanAuthor ran 98 times for 10.6 hours. 46 of those runs were then rejected by a mechanical check
that could have been satisfied up front. The contrast with `PreflightContent` — the same class of
mechanism, but placed BEFORE the content agents — is 46 vs 3 terminals: a 15× difference driven
purely by ordering.

## Chosen mechanism

**Corrected after reading the real code (2026-08-02).** The PlanAuthor prompt ALREADY injects the
stage FORMAT (`### Stage <N>` / `- AC:` / `- Files:` / `- Command:`, lines 1482-1489). The format
is not the gap. `PreflightPlan` runs exactly two detectors, and neither checks format alone:

| Detector | What it rejects | Injected today? |
|---|---|---|
| `preflightTouchesMismatch({secondaryLabel: "plan-files"})` | A `- Files:` entry naming a path the task's `## Touches` does not declare | ❌ NO |
| `preflightInvalidPlanCommand` | `validatePlanStructure` failure (format/AC coverage) — injected ✅ — **plus** any stage whose `- Command:` does not match `/^(?:node\|npm\|npx\|bash\|sh\|git\|scripts\/\|`)/i` | ❌ the runnable-command rule is NOT injected |

So the real gap is two *constraints*, not the format:

1. **Files ⊆ Touches.** The prompt says "name real files" — it never says every `- Files:` path
   must ALREADY appear in the task's `## Touches`. An author naming a genuinely-touched file that
   the task body omitted produces a mechanically-correct plan that preflight rejects.
2. **Command must be runnable.** The prompt says "the RED/implementation/GREEN mechanical check to
   run, e.g. a test/build command" — prose like `Verify the output matches` or `Run the test suite`
   satisfies that description and fails the regex.

Add a module-level `_planShapeContract` constant stating both constraints (including the literal
allowed command prefixes), interpolated into the PlanAuthor prompt alongside the existing format
block.

**Anti-drift:** a test asserts the contract text carries the same command prefixes that
`_RUNNABLE_COMMAND_RE` accepts, by running each prefix through the real exported regex — a
behavioral link to the single source, not a string-match on prose.

This is the narrow, immediate form of what [[DIR-124-F-core]]'s GroundTruthRegistry generalizes.
It does not block on that task and does not duplicate it: F-core owns *repo facts* (CLI paths,
output formats); this owns the *plan grammar constraints*.

## Acceptance Criteria

- [ ] AC1: `_planShapeContract` module-level constant exists in both `prepare-milestone.js` mirrors
- [ ] AC2: The constant is interpolated into the PlanAuthor prompt
- [ ] AC3: The contract states the Files-must-already-be-in-Touches constraint
- [ ] AC4: The contract states the runnable-Command constraint and lists the accepted prefixes
- [ ] AC5: A test asserts every prefix named in the contract is accepted by the real
      `_RUNNABLE_COMMAND_RE` (behavioral anti-drift link, not a prose match)
- [ ] AC6: A test asserts a prose-style command the contract warns against is REJECTED by the regex
- [ ] AC7: Both workflow mirrors byte-identical

## Definition of Done

- [ ] `_planShapeContract` implemented and wired into the PlanAuthor prompt, both mirrors
- [ ] Anti-drift test passes
- [ ] `scripts/test.sh` green

## Touches

- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js
- experiments/quay-perpetual-stream/test/prepare-milestone-plan-shape-contract.test.mjs
