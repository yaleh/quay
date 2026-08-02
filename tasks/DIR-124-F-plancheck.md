---
id: DIR-124-F-plancheck
title: "PlanCheck typed findings: extend output schema with grounded-fact-gap classification"
status: done
labels:
  - directive
  - human-steered
  - milestone-candidate
parent: DIR-124-F
children: []
extra:
  schema: v1
---

**PRIORITY RAISED (2026-08-02, prepare-pipeline reduction — `docs/analysis/prepare-pipeline-reduction-plan.md`):**
Under the reduced pipeline, prepare keeps exactly three mechanical confirmations —
mechanism count, AC executability, Touches completeness. This task underpins one of them,
so its correctness moves from "fixes a false positive" to "core mechanism correctness".
Schedule ahead of the paused prepare-shape tasks.

**type:** execution

## Proposal

Extend PlanCheck's output schema from scalar `{findings: number, findingsDetail: string}` to a typed
array with DIR-125 finding shape + `classification ∈ {grounded-fact-gap, task-specific, other}`.
This is the prerequisite for F-learn's promotion loop — without typed classification, the learning
loop cannot distinguish repo-invariant facts from task-specific Plan defects.

Merged from original DIR-124-F2 (PlanCheck typed findings). 1 mechanism.

### Problem framing

PlanCheck currently returns `{findings: <count>, findingsDetail: <string>}` — a scalar count plus
unstructured prose. There is no typed finding to classify. The recurring fact classes
(cli-paths, coverage-format, touches-matching, provider-defaults, module-signatures,
evidence-surface) are indistinguishable from task-specific defects in the current output. This
blocks the learning loop (F-learn): you cannot promote a `grounded-fact-gap` to the registry if
you cannot mechanically identify which findings ARE grounded-fact-gaps.

**Legacy-scalar tolerance:** existing callers that read `findings` as a number continue to work —
the typed array is additive alongside the scalar field for one release cycle, then the scalar is
removed.

## Acceptance Criteria

- [ ] AC1: PlanCheck output schema extended: `findings` remains a number, ADDITIONALLY `typedFindings: [{id, subsystem, severity, summary, blocking, classification, ...}]` is emitted
- [ ] AC2: `classification` field has valid values: `grounded-fact-gap`, `task-specific`, `other`
- [ ] AC3: A finding about CLI path (`quay.ts` vs `quay.js`) is classified as `grounded-fact-gap`
- [ ] AC4: A finding about task-specific Plan defect (e.g., missing `- Files:` entry) is classified as `task-specific`
- [ ] AC5: Legacy scalar `findings` count preserved — existing callers unbroken
- [ ] AC6: Both prepare-milestone.js mirrors pass typed findings through to the receipt

## Definition of Done

Standard `inherited-core.md` DoD clauses apply.

- [ ] Tests pass: PlanCheck emits typed findings with correct classification for known fact classes
- [ ] Legacy callers (receipt, checkpoint) still read `findings` as number without breakage

## Touches

- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js
- experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts
- plugin/scripts/milestone-preparation-check.ts
