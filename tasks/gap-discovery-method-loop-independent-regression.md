---
id: gap-discovery-method-loop-independent-regression
title: "Discovery Method: independent regression — no-shared-ancestry
  generalization, failing method not promoted, persistence, auto-ingest, real
  cost"
status: todo
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-discovery-experience-auto-ingest-from-evidence-store
---
## Proposal
This is the independent regression run for the Discovery Method loop after the four fix tasks (lineage/temporal, tool-vs-subject, persistence, auto-ingest). It must show, with real data and real cost:
- a cross-case generalization with NO shared ancestry;
- a failing method NOT being promoted;
- production persistence;
- automatic ingestion.

It writes no new engine. Its only tracked deliverable is a report regenerated from the real run.

**Held-out material that shares no ancestry with any seed.** The 6 sealed holdout cases of experiment `E-DT-1`, at `/data/home/yale/work/quay-scratch/dt1/labels-dt1-sealed.json`:
- pin `f2432d17849e7bd375dbfa573ae55ea4efad171d`;
- built by an independent labeler who excluded every seed component pair;
- each positive has a recorded fix commit after the pin.

They are:
- `HX-reflog-empty-action-producer-vs-classifier` (fix `be229861e`)
- `HX-promotion-classify-blind-to-unsatisfiable-ac` (`ccd8cc039`)
- `HX-scope-memorymax-literal-vs-host-derived` (`0834014db`)
- `HX-scope-argv-builders-oompolicy-divergence` (`c5ad1d146`)
- `HX-needs-human-transition-three-copies` (`9b01ac3d2`)
- negative `HX-neg-cpu-stall-readers-different-source`

None of them is in the Experience ledger. They enter only as held-out cases with `evaluation_pin` = the pin and `fix_commit` from the label.

## Plan
1. Ingest automatically from the real evidence store via `ingestNewOutcomes` (persistent carriers).
2. Run ONE bounded `reflect()` round over the resulting Experiences, with a stated budget. The seeds include the fan-in lock, REQUIRED_FIELDS and C5 outcomes; C7 is a negative.
3. Run `validateGeneralization` for every non-retired candidate whose `expected_invariant` is in scope:
   - against at least 2 positive held-out cases and the negative case above;
   - each at its pin, in a stripped tree.
4. Report and persist all verdicts. A candidate is promoted only on a correct verdict that passes the lineage and temporal checks; a wrong one is retired with a reason.
5. Cost: report BOTH the CLI's `cost_usd` and the cost recomputed from recorded token usage × the gateway's configured rates. Query `GET http://127.0.0.1:26510/model_group/info` with the key from `~/.local/etc/fjdac-api-key` (Bearer) for `input_cost_per_token`/`output_cost_per_token`. The CLI figure for these model aliases is a fallback guess (`costBasis` "unknown"), not a charge.
6. Write `docs/analysis/discovery-method-regression-report.md` from the run artifacts.

## Acceptance Criteria
- [ ] Automatic ingestion, real: paste the ingest summary (scanned / ingested / duplicate / watermark) and the persisted path under `/data/home/yale/work/quay/.quay/`.
- [ ] Reflection, real: paste each unit's `decision` and the candidate `method_id`/version/status/`operation.tools`. No tool may be a seed subject file. C7's unit must not yield a standalone method.
- [ ] Independent generalization, real: for at least one candidate, a held-out verdict on an `E-DT-1` holdout case at pin `f2432d178`. Paste the candidate lineage, the held-out id, the evaluated commit, the predicted vs expected verdict, and promoted yes/no. Plus at least one verdict against `HX-neg-cpu-stall-readers-different-source`. If no candidate is in scope for any holdout, say so and report `learning_quality` as not-evaluated. Do not relabel a holdout to fit.
- [ ] Failing method not promoted, real: paste at least one candidate whose held-out verdict was wrong, with the resulting `retired` + reason (or `draft` if not-evaluated), and confirm it is absent from `activeMethods()`.
- [ ] Quarantine holds: `activeMethods()` does not contain `shared-contract-divergence` at any version promoted on the old evidence. Paste it.
- [ ] Cost: paste model calls, tokens (input/output/cache_read), wall ms, the CLI `cost_usd`, and the gateway-rate recomputation with the rates used.
- [ ] `learning_quality` from the valid held-out verdicts only, and `net_new_discovery_value` still `not-yet-measured`.

## Definition of Done
- All AC ticked with output pasted.
- `docs/analysis/discovery-method-regression-report.md` committed.
- `scripts/test.sh --for-task gap-discovery-method-loop-independent-regression` green.

## Touches
- tasks/gap-discovery-method-loop-independent-regression.md
- docs/analysis/discovery-method-regression-report.md (new)
