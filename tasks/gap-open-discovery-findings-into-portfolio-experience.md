---
id: gap-open-discovery-findings-into-portfolio-experience
title: "P1: open-discovery confirmed findings → novelty check → Experience +
  Portfolio (production-open), corrections via append-only fold"
status: todo
labels:
  - gap
  - discovery-method
  - open-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-open-semantic-discovery-routine-track
  - gap-discovery-portfolio-append-only-correction-fold
---
## Proposal
**Governing principle — SEMANTIC FIRST, MECHANIZE LATER** (user ruling, 2026-10-12): the first phase builds an end-to-end SEMANTIC loop. The model reads source and context, explores openly, builds and refutes hypotheses, verifies independently, assesses engineering value, and reflects on successes and failures into Discovery Methods / meta-methods that steer the next round.
- Mechanical code is limited to scheduling, state/provenance persistence, dedup *assistance*, safety isolation, budget and tool wrapping. It never replaces a semantic judgment, never gates whether the model may look, and "no mechanical change" never suppresses a semantic round.
- Hard-coded rules, classifiers, fingerprints or pattern tables for *finding* problems are out of scope. Crystallizing a step into code comes later, only for high-repetition, low-ambiguity, stable steps after the loop has shown real findings, reviewable reasoning, method reuse and measured gain — and always keeps a semantic fallback, a baseline comparison and degradation monitoring.
- **Building the automation is not success. A semantic round that ran on real source and produced reviewable reasoning is.**

After `gap-open-semantic-discovery-routine-track` lands, `confirmed` clusters exist only in that routine's carrier. They are not in the Discovery Portfolio (the value metric), not in the Experience ledger (what Discovery Method learns from), and not deduplicated against what is already known.

Without this step, continuous discovery cannot be measured by `valueMetrics`/`coverageMap`, and Discovery Method still learns only from hand-run experiments.

## Plan
1. In the open-discovery routine, add a post-round step that takes each `confirmed` cluster and runs a **novelty check** against existing knowledge:
   - Portfolio findings (same component set or overlapping set with a matching claim, via `findDuplicate`/`sameComponentSet`);
   - `.quay/routine-findings.jsonl`;
   - `.quay/arch-discovery-findings.jsonl` subject keys;
   - task bodies and Touches on develop (a done or open task naming the same components and invariant).
   **The novelty verdict is semantic.** Mechanical lookup only RETRIEVES candidates (same or overlapping components, matching task Touches). One bounded model call then reads the confirmed claim, the retrieved candidates and the relevant source, and decides novel vs duplicate-of-X vs restatement. It reserves budget like any other call.
   - With no mechanical candidate, the claim still gets the semantic check against a broader retrieval (task titles and Portfolio claims). "No mechanical match" never auto-labels a finding novel.
   - Exception, recorded as such: byte-identical component set plus claim from a previous round's own record may be deduped mechanically.
1b. **Failures are learning material too.** Refuted clusters, duplicates and verifier `undetermined` results are ingested as Experiences with their own roles (`confirmed-negative` / `duplicate` / `undetermined`) and the reasoning that decided them. Discovery Method reflection then learns from what did not work as well as from what did.
2. **Novel** ⇒ ingest as an Experience (`ingestExperience`, `reported_by:"system"`, `source_ref` = carrier record id) and as a Portfolio finding (`origin:"autonomous-routine"`, `evidence_level:"production-open"`, `outcome:"supported"`, `fix_task:null`).
   **Duplicate** ⇒ record it in the Portfolio with `duplicate_of` set (or not at all), and never count it as new.
3. Later status changes go only through the append-only correction records from `gap-discovery-portfolio-append-only-correction-fold`: refuted on recheck, duplicate found later, or fix task landed.
4. **No human rating, no Goal, no task creation.** Filing a fix task stays the operator's decision; the routine may list a candidate fix title in its record. The provenance chain carrier record → Experience → Portfolio must be resolvable both ways.

## Acceptance Criteria
- [ ] Unit tests exit 0, covering:
  - (a) a confirmed cluster duplicating an existing Portfolio finding ⇒ not counted in `net_new_value`, `duplicate_of` set;
  - (b) a novel cluster ⇒ Experience plus Portfolio records with `production-open` and a resolvable `origin_ref`;
  - (c) a cluster refuted by the routine's refuter ⇒ never ingested as supported;
  - (d) the same cluster seen in two rounds ⇒ one Portfolio record, not two;
  - (e) no `rateFinding` call, no task or Goal write (static control);
  - (f) a confirmed cluster with NO mechanical candidate still gets a semantic novelty call (a stub records the call) and is not auto-labelled novel;
  - (g) refuted and undetermined clusters are ingested as Experiences with their reasoning, and never as Portfolio `supported`.
- [ ] Negative control: disable the novelty check in a scratch copy ⇒ (a)/(d) go red. Paste the output.
- [ ] Replay on real data: run the ingestion step over the existing production carrier records of `gap-open-semantic-discovery-routine-track` (whatever rounds exist at implementation time) and paste novel / duplicate / refuted counts and records. If the carrier has no confirmed cluster yet, say so and paste the fixture run only.
- [ ] Production reading: the first resident round after landing that has a confirmed cluster — paste the chain (carrier record → Experience → Portfolio) and the `valueMetrics` / `coverageMap` before and after. （待外部）

## Definition of Done
- All AC ticked with output pasted (production AC may stay （待外部）).
- `scripts/test.sh --for-task gap-open-discovery-findings-into-portfolio-experience` green.

## Touches
- tasks/gap-open-discovery-findings-into-portfolio-experience.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/test/open-semantic-discovery-routine.test.mjs
- docs/analysis/discovery-portfolio.mjs
- docs/analysis/discovery-experience-ledger.mjs
- plugin/test/discovery-portfolio.test.mjs
