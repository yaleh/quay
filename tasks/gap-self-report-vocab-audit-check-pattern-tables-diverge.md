---
id: gap-self-report-vocab-audit-check-pattern-tables-diverge
title: "self-report-vocab audit vs check: same task implemented twice, pattern
  tables + stopped-state fix diverged"
status: ready
labels:
  - gap
  - discovery-finding
parent: null
children: []
extra: {}
---
## Proposal
Two live modules implement the SAME task (`gap-reanchor-must-converge-inner-self-reported-vocabulary`) — the inner self-report batch-vocabulary detector — with diverged behaviour:

- `plugin/scripts/self-report-vocab-audit.ts` — `BATCH_FLAG_PATTERNS` (`batch-of` `/\bBatch\s+of\b/i`, `batch-num` `/\bbatch\s*[-_/]?\s*\d/i`, `按批`), plus the stopped-state exemption (`STOPPED_MARKERS`, commit `e0c2e222c`, task `gap-self-report-vocab-misfires-on-stopped-state`). Wired: `orchestration/orchestrator-loop-tick.md:936`.
- `plugin/scripts/self-report-vocab-check.ts` — `BATCH_SELF_REPORT_PATTERNS` (`batch-of` `/\bBatch\s+of\s+\d+\b/i`, `batch-count`, `batch-id` `/\bbatch[-_ ]?(\d+)(?![-_a-zA-Z])/i`, by-batch), its own state file `.quay/self-report-vocab-state.json`, and ZERO stopped-state handling (`grep -c -i stopped` = 0 vs 30 in the audit module).

Measured divergence (2026-10-12, operator re-check of discovery finding `GAIN1-CTRL-c10`, portfolio `portfolio_finding-18e675aff86564f8`): input `batch4a` → audit flags (`batch-num` true), check does not (`batch-id` false, by its explicit lookahead). `Batch of N` without a digit → audit flags, check does not. A stopped-loop window → audit waives window-full, check has no such arm. The stopped-state fix landed in ONE copy only — the sibling instance was never fixed (hard rule 5b).

Origin: autonomous discovery — capability-gain experiment `gap-discovery-capability-gain-same-budget-open-exploration` (control arm cluster 10, learned arm cluster 11 is the same finding over a wider component set), confirmed by operator reading + a reproduction, not by the model alone.

## Plan
1. Decide the single source: keep ONE pattern table + ONE stopped-state rule + ONE convergence counter; the other module either delegates by import or is retired (if retired, remove its references and tests, and the capability-catalog declaration if any).
2. Reconcile the two pattern sets explicitly: for each divergent input class (`batch4a`-style suffix, `Batch of` without a digit, `batch N/M`), pick the intended verdict and record the choice in a comment that names the input.
3. Keep the wired surface (`orchestrator-loop-tick.md:936`) working with unchanged CLI flags, or update the doc in the same delta.

## Acceptance Criteria
- [ ] After the change there is exactly ONE batch-vocabulary pattern table in `plugin/scripts/` (paste the grep that counts declarations of batch-style regex tables, before and after).
- [ ] A parity test feeds the same inputs (`batch4a`, `batch-2`, `Batch of 3`, `Batch of`, `batch 2/3`, `按批收尾`, `concurrent-batch-scheduler.ts`, a stopped-state window) through every remaining entry point and asserts identical verdicts; paste the test output.
- [ ] Negative control: re-introduce a divergent copy of one pattern in a scratch copy and show the parity test goes red; paste the red output.
- [ ] The stopped-state exemption applies on every remaining entry point (paste the stopped-window verdict).

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-self-report-vocab-audit-check-pattern-tables-diverge` green.

## Touches
- tasks/gap-self-report-vocab-audit-check-pattern-tables-diverge.md
- plugin/scripts/self-report-vocab-audit.ts
- plugin/scripts/self-report-vocab-check.ts
- plugin/test/self-report-vocab-audit.test.mjs
- plugin/test/self-report-vocab-check.test.mjs
- orchestration/orchestrator-loop-tick.md
