---
id: gap-discovery-portfolio-append-only-correction-fold
title: "Discovery portfolio: append-only correction records
  (duplicate/refuted/fix_task) folded into value metrics and coverage; apply
  GAIN1 c10/c11/c13"
status: ready
labels:
  - gap
  - discovery-method
parent: null
children: []
extra: {}
---
## Proposal
`.quay/discovery-portfolio.jsonl` has no way to correct a finding after it is ingested. The only post-ingest record kinds are `portfolio_rating` (human-only) and `portfolio_domain`. So when a later check shows a finding was a duplicate or was refuted, or its fix lands, the portfolio still states the original claim. That makes the value metrics wrong in both directions.

Real instance (2026-10-12, capability-gain experiment `gap-discovery-capability-gain-same-budget-open-exploration`, report `docs/analysis/discovery-capability-gain-report.md` §5/§6). All three records were ingested as `outcome:"supported"`, `duplicate_of:null`, `fix_task:null`:
- `GAIN1-CTRL-c10` (`portfolio_finding-18e675aff86564f8`): a real defect. Fixed by `gap-self-report-vocab-audit-check-pattern-tables-diverge`, landed on develop as `74b4341b8`. It is not counted in `net_new_value` because the record has no `fix_task`/`fix_landed_commit`. **Undercount.**
- `GAIN1-LEARN-c11` (`portfolio_finding-b0a19a72818c6dde`): the same finding as c10 over a wider component set (same two components, same two regexes). The operator re-check says duplicate, but the record says `supported` and `duplicate_of:null`. **Overclaim.**
- `GAIN1-LEARN-c13` (`portfolio_finding-21d4e4db293b2027`): its mechanism is refuted by the code (all four components import the single `touches-parser.ts`), and the divergence it lands on is deliberate and pinned by a test. The record says `supported`. **Overclaim.**

Today `valueMetrics` reads `net_new_value.total = 11`, which excludes c10. `zero_or_negative` lists c11 and c13 under `supported_but_not_landed` instead of under duplicates/refuted.

## Plan
1. Add an append-only correction record kind (e.g. `portfolio_correction`) to `docs/analysis/discovery-portfolio.mjs`. It names `finding_id` and a closed set of correctable fields: `outcome` (vocab `OUTCOMES`), `duplicate_of`, `fix_task`. It also carries a required `reason`, required `evidence` refs, and an identified writer (`by` + `actor`, same discipline as `rateFinding`: a process must name itself).
   **Original `portfolio_finding` lines are never rewritten or deleted.**
2. Read-back folds corrections onto their finding in append order and exposes both the effective and the original values (`corrected_from` / the correction ids), so history stays auditable.
3. Validation at write time:
   - `finding_id` must resolve;
   - `duplicate_of` must resolve to an EARLIER, non-duplicate finding (no self-reference, no cycle, no chain onto a duplicate);
   - `fix_task` must exist on the landing branch, and `fix_landed_commit` is DERIVED by the existing `deriveFixLandedCommit`, never supplied by the caller;
   - an unknown field is refused, not ignored.
4. `valueMetrics` and `coverageMap` read the folded (effective) records. A finding that is a duplicate or refuted can never count toward `net_new_value` and never backs a coverage domain.
5. Apply the three real corrections through the new function, not by editing the carrier:
   - c10 → `fix_task: gap-self-report-vocab-audit-check-pattern-tables-diverge`
   - c11 → `duplicate_of: GAIN1-CTRL-c10`
   - c13 → `outcome: refuted`

## Acceptance Criteria
- [ ] `node --test plugin/test/discovery-portfolio.test.mjs` exits 0, covering:
  - (a) a correction setting `duplicate_of` removes the finding from `net_new_value` and lists it under `zero_or_negative.duplicates`;
  - (b) a correction setting `outcome:"refuted"` removes it from `net_new_value` and lists it under `zero_or_negative.refuted`;
  - (c) a correction setting `fix_task` to a task whose landing is derivable adds it to `net_new_value` with a DERIVED `fix_landed_commit`;
  - (d) refusals, each with a distinct reason code: unknown `finding_id`; `duplicate_of` pointing at itself, at a later finding, at a duplicate, or forming a cycle; `fix_task` not on the landing branch; a caller-supplied `fix_landed_commit`; an unknown field; a missing `reason`/`evidence`/writer identity;
  - (e) the carrier's original `portfolio_finding` lines are byte-identical before and after any correction (append-only), and read-back exposes both original and effective values.
- [ ] **Negative control (anti-inflation)**: in a scratch copy, make the fold ignore `duplicate_of`/`refuted` corrections and show (a)/(b) go red; paste the red output; restore.
- [ ] **Real correction, production carrier** (shared checkout `.quay/discovery-portfolio.jsonl`): apply the three corrections in the Proposal through the new function. Paste:
  - the three appended correction lines;
  - `sha256` of the carrier's pre-existing prefix (the first N lines, N = line count before the write), before and after;
  - `valueMetrics` before and after. **Expected (falsifiable): `net_new_value.total` 11 → 12, the +1 being `GAIN1-CTRL-c10` with `fix_landed_commit` resolving to the landing of `74b4341b8`; `GAIN1-LEARN-c11` under `duplicates`; `GAIN1-LEARN-c13` under `refuted`; neither c11 nor c13 in `net_new_value` or `supported_but_not_landed`.** If any reading differs, report the actual numbers and why; do not adjust the expectation to fit.
- [ ] Coverage map before/after on the production carrier: paste both. Neither c11 nor c13 backs any domain, and any grade change is explained by the specific finding that caused it. Zero grade change is an acceptable, reported result.
- [ ] Regression: the existing anti-inflation mutation control (case (g), the `landed(r)` clause) still goes red when mutated. Paste its output.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-discovery-portfolio-append-only-correction-fold` green.
- No `portfolio_finding` line rewritten or deleted; no human rating written (`rateFinding` stays human-only).

## Touches
- tasks/gap-discovery-portfolio-append-only-correction-fold.md
- docs/analysis/discovery-portfolio.mjs
- plugin/test/discovery-portfolio.test.mjs
