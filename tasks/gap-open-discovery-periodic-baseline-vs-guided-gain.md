---
id: gap-open-discovery-periodic-baseline-vs-guided-gain
title: "P2: periodic same-budget baseline vs guided open-discovery rounds;
  net-new/duplicate/refuted/cost gain incl. negative; never independent
  evidence"
status: ready
labels:
  - gap
  - discovery-method
  - open-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-open-discovery-findings-into-portfolio-experience
  - gap-open-discovery-method-guidance-active-shadow
---
## Proposal
Under SEMANTIC FIRST, MECHANIZE LATER (user ruling 2026-10-12), this paired comparison is the instrument that later decides what may be crystallized into mechanical code. It must also keep running AFTER any crystallization, as the baseline/degradation monitor (semantic arm vs crystallized arm).

Whether method guidance helps must be measured in production rather than asserted, and must not reuse a contaminated holdout as "independent" evidence. The 2026-10-12 capability-gain experiment showed an apparent +1 that did not survive recheck (learned c11 duplicated control c10; c13 was refuted).

## Plan
1. Every M-th eligible round (config `gain_every_rounds`, default 6), when ≥1 eligible method exists, run a **paired** round: baseline arm and guided arm on the SAME pin, inventory, model and budget. Only the investigator prompt differs, and both arms reserve from the same 24h ledger.
2. Pre-register before the first call: the hash of each arm's prompt, the inventory hash and the budget. A pre-registration newer than any call ⇒ the round is refused (reuse `preregRefusal`).
3. Score each arm on four counts:
   - confirmed **net-new** findings (after the novelty check from `gap-open-discovery-findings-into-portfolio-experience`);
   - duplicates;
   - refuted (false positives);
   - gateway USD.
   Gain = guided − baseline, negative values included. Append a gain record per paired round, plus a rolling summary that is never smoothed into a single positive number.
4. Evidence level: these rounds are `production-open` (open exploration, no labels). They are NEVER counted as `independent` generalization evidence for method promotion. Promotion stays governed by the evidence-level rules from `gap-discovery-evidence-level-teaching-vs-independent`.
5. No eligible method ⇒ no paired round, recorded as `not-evaluated:no-eligible-method`, not as zero gain.

## Acceptance Criteria
- [ ] Unit tests exit 0, covering:
  - (a) arms with different budgets ⇒ refused;
  - (b) a pre-registration written after the first call ⇒ refused;
  - (c) negative gain is recorded as negative;
  - (d) duplicates and refuted findings never count as net-new in either arm;
  - (e) a paired-round record cannot be read as `independent` evidence by the promotion path (regression against the evidence-level rules);
  - (f) no eligible method ⇒ `not-evaluated:no-eligible-method`.
- [ ] Negative control: let the promotion path accept `production-open` gain records in a scratch copy ⇒ (e) goes red. Paste the output.
- [ ] Production reading: the first paired round after landing — paste both arms' counts, cost and the gain record; or state that it has not occurred and why (e.g. no eligible method). （待外部）

## Definition of Done
- All AC ticked with output pasted (production AC may stay （待外部）).
- `scripts/test.sh --for-task gap-open-discovery-periodic-baseline-vs-guided-gain` green.

## Touches
- tasks/gap-open-discovery-periodic-baseline-vs-guided-gain.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/test/open-semantic-discovery-routine.test.mjs
- docs/analysis/discovery-reflection.mjs
