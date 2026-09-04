---
id: gap-prepare-milestone-no-size-aware-routing-C
title: "Fast-lane calibration + rollout: shadow-mode sampling and auto-enable gate"
status: done
labels:
  - gap
  - defect
  - milestone-candidate
  - human-steered
extra:
  schema: v1
  superseded: true
  superseded_at: 2026-08-12
---

**PAUSED (2026-08-02, prepare-pipeline reduction — `docs/analysis/prepare-pipeline-reduction-plan.md`):**
`blocked-by: prepare-pipeline-reduction`. This task's premise assumes the CURRENT prepare
pipeline shape (ProposalReview + 3-round PlanCheck). That shape is being reduced to three
mechanical confirmations (mechanism count, AC executability, Touches completeness), which
changes this task's value. NOT cancelled — re-evaluate after stage B–D of the reduction plan
lands and real dispatch data is available. Do not schedule until then.

**type:** execution

## Proposal

Calibrate the fast-lane routing (gap-size-A) before auto-enabling it. Run in **shadow
mode** first: estimate + route + record predicted-vs-actual, WITHOUT changing the prepare
path. Collect real sample data, then enable fast-lane behind an explicit flag, then make it
automatic after calibration.

Third child of the gap-size split. Depends on gap-size-A (routing) and gap-size-B
(manifest).

## Plan

N/A — resolved via a human-steered milestone. The resolving milestone authors a checked
`docs/plans/*.md` plan (DIR-117-B prepared-gate artifact) before implementation.

## Finding

The split-review found the Proposal's shadow sample count (8) deviates from the cited
sizing proposal's ≥10 shadow-only before auto-enable. The calibration threshold must be
reconciled and made deterministic.

## Requested action

1. Shadow mode: `estimateTaskSize` + route + record predicted-vs-actual code churn, WITHOUT
   changing the workflow path.
2. Enable fast-lane routing behind an explicit policy flag after ≥10 real shadow tasks.
3. After calibration (≥10 shadow + ≥2 enabled), make the route automatic and remove the
   flag.
4. Wire the fast-lane independent reviewer's findings into the DIR-125 finding ledger
   (proposal-ledger.json / preparation receipt) so a fast-lane task's "independently
   audited" claim has a durable finding artifact.
5. RED/GREEN: shadow mode records without routing; the flag gates fast-lane on/off; the
   calibration count is enforced (auto-enable only after ≥10 shadow).

## Acceptance Criteria

- [ ] Shadow mode estimates + records predicted-vs-actual without changing the prepare path
  (a real task runs shadow and its actual churn is compared).
- [ ] Fast-lane is flag-gated; auto-enable fires only after ≥10 real shadow tasks + ≥2
  enabled (the reconciled calibration count, not the pre-split 8).
- [ ] A fast-lane task's independent-reviewer findings are recorded in the finding
  ledger/receipt (durable audit artifact).
- [ ] The flag removal is gated on calibration (real evidence, not manual override).
- [ ] Tests: `prepare-milestone-size-calibration.test.mjs` RED/GREEN.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] A real shadow task's predicted-vs-actual churn is recorded; the auto-enable gate is
  demonstrated with real counts.
- [ ] A fresh independent audit finds no refutation.

## Human verification

1. Was fast-lane auto-enabled only after the calibration count (≥10 shadow) was met?

## Touches

- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/scripts/*size-estimat*`
- `plugin/scripts/*size-estimat*`
- `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts`
- `experiments/quay-perpetual-stream/test/*size-calibration*.test.mjs`
- `plugin/test/*size-calibration*.test.mjs`

## Superseded (2026-08-12)

引用 ADR-022 已物理删除的机制（prepare-milestone.js 双镜像）：fast-lane 校准 / shadow-mode 采样 / auto-enable 闸均设计在经典 prepare-milestone pipeline 上，fast mode 无对应物。前提不存在，作废保留历史——不重开。
