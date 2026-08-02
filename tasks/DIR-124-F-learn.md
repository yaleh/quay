---
id: DIR-124-F-learn
title: "Learning loop: promote grounded-fact-gap PlanCheck findings into the GroundTruthRegistry"
status: todo
labels:
  - directive
  - human-steered
  - milestone-candidate
parent: DIR-124-F
children: []
extra:
  schema: v1
---

**type:** execution

## Proposal

Close the loop: when PlanCheck returns a `grounded-fact-gap` finding (per F-plancheck's typed
classification), mechanically promote it into the GroundTruthRegistry (F-core) with a version bump.
The promotion is mechanically validated (category whitelist, duplicate exact-match, non-blocking on
failure). An already-registered fact that appears as a PlanCheck finding is an injection defect
(registry fact not reaching PlanAuthor prompt), not a new discovery.

Depends on DIR-124-F-core (registry CLI) and DIR-124-F-plancheck (typed findings). 1 mechanism.

### Validation rules

1. **Category whitelist:** fact must belong to one of the 8 canonical categories — reject unknown
2. **Duplicate exact-match:** same fact text already in registry → reject (injection defect, not new discovery)
3. **Non-blocking:** promotion failure does not block the milestone — the finding is still reported, just not auto-promoted

## Acceptance Criteria

- [ ] AC1: `--promote` accepts a `grounded-fact-gap` finding JSON and appends it to the registry
- [ ] AC2: Promotion increments `version` and recomputes `contentHash`
- [ ] AC3: Duplicate exact-match fact text is rejected (not appended)
- [ ] AC4: Unknown category is rejected
- [ ] AC5: Promotion failure is non-blocking — PlanCheck still reports the finding, milestone proceeds
- [ ] AC6: Already-registered fact → `injection-defect` (registry fact exists but PlanAuthor didn't use it)

## Definition of Done

Standard `inherited-core.md` DoD clauses apply.

- [ ] Tests pass: promote → validate round-trip succeeds, duplicate rejection, unknown-category rejection
- [ ] PlanCheck integration: `grounded-fact-gap` findings trigger `--promote` if mechanically valid
- [ ] Independent wiring audit confirms promotion path is fire-and-forget (non-blocking)

## Touches

- experiments/quay-perpetual-stream/scripts/ground-truth-registry.ts
- plugin/scripts/ground-truth-registry.ts
- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js
