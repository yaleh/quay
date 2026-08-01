## M212 ABSORB entry

**Milestone id:** M212
**Task:** DIR-119-D4 (insert a literal Reconcile phase as sole composite state writer and fix
Gate-failure task attribution — composite-reconcile.ts; fourth child of DIR-119-D's split)
**Charter:** experiments/quay-perpetual-stream/charters/M212-dir119d4-reconcile-gate-attribution.md
**Value type:** capabilityGrowth
**Deliverable:** yes

## Backlog row

| DIR-119-D4 | Insert a literal Reconcile phase as the ONLY composite success-path state writer (AC/DoD ticks, status:done, dashboard rows, absorb dispositions) between Gate and Land in execute-milestone.js's meta.phases (+ byte-identical plugin mirror), and fix Gate's failure-attribution branch to name the specific failing member task(s) via typed {scope, taskId, gate, ok, detail} Gate records + composite-reconcile.ts's new attributeGateFailures(gates, taskIds) export instead of hardcoding _primaryTaskId: non-selftest --reconcile-json/--attribute-gates-json CLI modes (thin wraps of the already-exported reconcile()/new attributeGateFailures()), a reconcile-apply agent as sole success-path writer, Land prompts' composite success-path write instructions relocated to reconcile-apply (AC#5), RED/GREEN failing-member attribution fixture + control passing case | TBD | - | milestone-candidate, human-steered, surface:method-infra |

<!--
surface:method-infra — this milestone's ## Touches are entirely methodology/workflow
infrastructure: .claude/workflows/execute-milestone.js + plugin/workflows/ mirror,
experiments/quay-perpetual-stream/scripts/composite-reconcile.ts + plugin/scripts/ mirror, their test
files, and docs/plans/M212-dir-119-d4.md. Touches NO packages/quay* product code, so the
product-touching surface labels (cli/web-ui/provider-abi/mcp) do NOT apply.

The adversarial audit disposition + ABSORB-gate-run sections below are completed during the
Audit/Land phases, per inherited-core.md.
-->

## Adversarial audit disposition (M212)

(to be completed at Audit phase)

## ABSORB gate run (M212, post-audit)

(to be completed at Land phase)
