---
id: gap-discovery-portfolio-value-evidence-ledger
title: "Discovery Portfolio: join each Finding to fix, landing, recurrence,
  human rating and gateway cost; value = landed net-new fixes, not finding
  counts"
status: todo
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
---
## Proposal
The user changed the evaluation target on 2026-10-12. The primary measure of Quay's self-bootstrapping discovery is no longer sealed-holdout hit rate. It is three things:
- **(A)** real net-new engineering value in open domains;
- **(B)** a Capability Coverage Map of the domains the user named;
- **(C)** Capability Gain before vs after learning: new findings, coverage, reliability, efficiency.

Nothing today records value end to end. The evidence store records verdicts; the Experience ledger records outcomes; tasks record fixes. Nothing joins a Finding to its fix, the fix's landing, a later recurrence, a human rating and the cost spent. So "value" can only be counted as Finding or Supported counts, which is easy to inflate.

An operator reconstruction (read-only, no model calls) at `/data/home/yale/work/quay-scratch/portfolio-demo/REPORT.md` (rows in `rows.tsv`) found 13 real items:
- 11 findings with landed fixes, verified via git: 6 of autonomous origin (F01–F03 from the production `semantic-dedup-scan` routine, F04–F06 from blind experiments), plus 5 operator-led, mechanical-instrument or production-reading items;
- 1 user-reported finding with no fix filed (F12, missed by 9 blind runs);
- 1 correct autonomous refutation (N01).

## Plan
1. **New module** `docs/analysis/discovery-portfolio.mjs` with a persistent shared-checkout carrier `.quay/discovery-portfolio.jsonl`. Reuse the carrier persistence (atomic append, dedup, shared-checkout resolution) from `docs/analysis/discovery-method-registry.mjs`/`discovery-experience-ledger.mjs`; do not re-implement it.
2. **One record per Finding:**
   ```
   {
     finding_id,
     origin: "autonomous-routine" | "autonomous-experiment" | "operator" | "user" | "mechanical-instrument",
     origin_ref,              // routine runId / experiment+cluster / session / task
     evidence_level: "teaching" | "transfer" | "independent" | "production-open",
     method_ref | null,
     claim,
     outcome: "supported" | "refuted" | "undetermined",
     fix_task | null,
     fix_landed_commit | null,
     recurred: bool | null,
     human_rating: { value: "high" | "medium" | "low" | "noise", by, ts } | null,
     cost: { model_calls, input_tokens, output_tokens, usd_gateway } | null,
     duplicate_of | null
   }
   ```
3. **Derivations, all from the record itself.** Never asserted by the caller:
   - `fix_landed_commit` is read from git: the last develop commit on `tasks/<fix_task>.md` whose subject marks it done.
   - `recurred` comes from later evidence-store outcomes on the same component set.
   - `cost` is computed from recorded usage × gateway rates (`GET http://127.0.0.1:26510/model_group/info`); missing ⇒ `null`, never 0.
4. **Value metrics, anti-gaming by construction:**
   - `net_new_value` counts records that are `supported` ∧ fix landed ∧ not `duplicate_of` an earlier record or open task ∧ human_rating ≠ `noise`, split by origin.
   - Finding count and supported count are reported only as context, never as the headline.
   - `noise` ratings, refuted claims and duplicates are reported as negative or zero value.
   - `cost_per_valuable_finding` uses gateway cost.
5. **Backfill the 13 real rows** from `rows.tsv` via the module's ingest function. Every row must resolve its origin_ref in a real carrier or task, else it is refused. `human_rating` stays `null`: the worker never invents ratings.
6. Human ratings are written only through `rateFinding({finding_id, value, by})` with `by` naming a human session. A worker call is refused.

## Acceptance Criteria
- [ ] `node --test plugin/test/discovery-portfolio.test.mjs` exits 0:
  - (a) `fix_landed_commit` comes from a fixture git repo, not from caller input;
  - (b) a caller-supplied `fix_landed_commit` that disagrees with git is refused;
  - (c) a duplicate (same component set and claim as an earlier record) gets `duplicate_of` and is excluded from `net_new_value`;
  - (d) `noise` reduces `net_new_value`;
  - (e) missing usage ⇒ `cost:null`, and cost-per-value reports an unmeasured count;
  - (f) a worker `rateFinding` is refused;
  - (g) adding 10 refuted records leaves `net_new_value` unchanged (the anti-inflation control).
- [ ] Real backfill: paste all 13 records, `net_new_value` split by origin (expected 11 with fixes landed; autonomous 6), and the list of rows with `cost:null`. Every origin_ref must resolve.
- [ ] Mutation control: make `net_new_value` count supported findings instead of landed fixes, and show case (g) goes red. Paste, then revert.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-discovery-portfolio-value-evidence-ledger` green.
- Report-only: no task, goal or driver writes.

## Touches
- tasks/gap-discovery-portfolio-value-evidence-ledger.md
- docs/analysis/discovery-portfolio.mjs (new)
- plugin/test/discovery-portfolio.test.mjs (new)
