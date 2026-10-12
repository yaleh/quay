---
id: gap-open-discovery-method-guidance-active-shadow
title: "P1: registry methods as optional guidance for open discovery — active
  guides, draft/trial shadow-only, quarantined/retired never, baseline when
  none"
status: ready
labels:
  - gap
  - discovery-method
  - open-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-open-semantic-discovery-routine-track
---
## Proposal
**Governing principle — SEMANTIC FIRST, MECHANIZE LATER** (user ruling, 2026-10-12): the first phase builds an end-to-end SEMANTIC loop. The model reads source and context, explores openly, builds and refutes hypotheses, verifies independently, assesses engineering value, and reflects on successes and failures into Discovery Methods / meta-methods that steer the next round.
- Mechanical code is limited to scheduling, state/provenance persistence, dedup *assistance*, safety isolation, budget and tool wrapping. It never replaces a semantic judgment, never gates whether the model may look, and "no mechanical change" never suppresses a semantic round.
- Hard-coded rules, classifiers, fingerprints or pattern tables for *finding* problems are out of scope. Crystallizing a step into code comes later, only for high-repetition, low-ambiguity, stable steps after the loop has shown real findings, reviewable reasoning, method reuse and measured gain — and always keeps a semantic fallback, a baseline comparison and degradation monitoring.
- **Building the automation is not success. A semantic round that ran on real source and produced reviewable reasoning is.**

Discovery Method methods (`.quay/discovery-method-registry.jsonl`) are never used to look at code. Once `gap-open-semantic-discovery-routine-track` exists, a method can serve as optional guidance for the next exploration round. This must not:
- let a contaminated or quarantined method back in (`shared-contract-divergence` and `multi-writer-guard-equivalence` are retired + quarantined);
- let an unvalidated draft steer production;
- stop exploration when no method is active. Today there are 0 active and 0 trial methods.

## Plan
1. Method selection per round, using `activeMethods` + `methodTrust` + `discovery-contaminated-verdicts.jsonl`:
   - `active` ⇒ may guide the production round, with its text appended to the investigator prompt;
   - `draft`/`trial` ⇒ only in an isolated **shadow** arm. The shadow arm has its own reservations under the same ledger, its own carrier records marked `shadow:true`, and never feeds Portfolio as production findings.
   - `retired`, quarantined lineage, or contaminated verdict ⇒ never selected.
   - No eligible method ⇒ the round runs **baseline** (unguided) exploration. "No method" never means "no round".
2. Each round's record lists the method ids included, the ids excluded and why, and whether it ran baseline or guided.
2b. **Closing the loop.** A method that guided a round gets an Experience recording the outcome (net-new / duplicate / refuted / nothing found), so Discovery Method reflection can evolve or retire it from production evidence. A method is guidance text for the model, never compiled into a rule.
3. The guidance text passes the `experienceDenyList` scan: no seed component or case id. A method whose text fails the scan is excluded and recorded with a reason.

## Acceptance Criteria
- [ ] Unit tests exit 0, covering:
  - (a) 0 active ⇒ baseline round runs;
  - (b) an active method ⇒ guided production round, ids recorded;
  - (c) a draft or trial method ⇒ shadow arm only, records `shadow:true`, nothing reaches Portfolio;
  - (d) a retired, quarantined or contaminated method ⇒ never selected, even when it is the only one;
  - (e) guidance text containing a seed component ⇒ excluded with reason;
  - (f) shadow calls reserve against the same 24h ledger;
  - (g) a guided round's outcome is ingested as an Experience naming the method id and version.
- [ ] Negative control: make selection ignore the quarantine list in a scratch copy ⇒ (d) goes red. Paste the output.
- [ ] Real registry reading: run selection against the production registry and paste included and excluded ids with reasons. Expected today: 0 active ⇒ baseline; both quarantined methods excluded.
- [ ] Production reading: the first resident round after landing — paste its method-selection record. （待外部）

## Definition of Done
- All AC ticked with output pasted (production AC may stay （待外部）).
- `scripts/test.sh --for-task gap-open-discovery-method-guidance-active-shadow` green.

## Touches
- tasks/gap-open-discovery-method-guidance-active-shadow.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/test/open-semantic-discovery-routine.test.mjs
- docs/analysis/discovery-method-registry.mjs
