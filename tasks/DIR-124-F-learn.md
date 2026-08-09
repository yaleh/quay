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

**PAUSED (2026-08-02, prepare-pipeline reduction — `docs/analysis/prepare-pipeline-reduction-plan.md`):**
`blocked-by: prepare-pipeline-reduction`. This task's premise assumes the CURRENT prepare
pipeline shape (ProposalReview + 3-round PlanCheck). That shape is being reduced to three
mechanical confirmations (mechanism count, AC executability, Touches completeness), which
changes this task's value. NOT cancelled — re-evaluate after stage B–D of the reduction plan
lands and real dispatch data is available. Do not schedule until then.

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

## Contract

measure   promote_wired = `grep -c 'grounded-fact-gap' plugin/scripts/ground-truth-registry.ts` 输出的计数（--promote 接受该 finding 类的接线点）
band      promote_wired = ≥ 1（--promote 接受 grounded-fact-gap finding JSON）
invariant duplicate_rejected = 1（重复 exact-match fact 被拒绝，不入库）
invariant category_whitelist = 1（未知 category 被拒绝）
invoke    `node --experimental-strip-types plugin/scripts/ground-truth-registry.ts --promote`
control   重复 exact-match 与未知 category 均非零退出；非阻断路径在 PlanCheck 集成中可证
resume    --promote 校验 + PlanCheck 集成分步提交

## Touches

- experiments/quay-perpetual-stream/scripts/ground-truth-registry.ts
- plugin/scripts/ground-truth-registry.ts
- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js

## Dispatch review

reviewer: none
at: 2026-08-09
changed: 无（本任务补 ## Contract 六键晋级 Contract，非新派发，无 review 记录）
