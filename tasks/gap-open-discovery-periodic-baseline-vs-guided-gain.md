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
- [x] Unit tests exit 0, covering:
  - (a) arms with different budgets ⇒ refused;
  - (b) a pre-registration written after the first call ⇒ refused;
  - (c) negative gain is recorded as negative;
  - (d) duplicates and refuted findings never count as net-new in either arm;
  - (e) a paired-round record cannot be read as `independent` evidence by the promotion path (regression against the evidence-level rules);
  - (f) no eligible method ⇒ `not-evaluated:no-eligible-method`.

  **Output** — `bash scripts/test.sh --for-task gap-open-discovery-periodic-baseline-vs-guided-gain --allow-thin` ⇒ exit 0, `tests 122 / pass 122 / fail 0`; 72 of them in `plugin/test/open-semantic-discovery-routine.test.mjs` (the 9 new cases are the ones printing the lines below), and `plugin/test/discovery-reflection.test.mjs` (50) + `discovery-method-registry` / `discovery-method-routine` / `discovery-experience-ledger` / `discovery-portfolio` (170) also green.

  ```
  ✔ AC (gain-config) — `gain_every_rounds` is OPTIONAL (absent ⇒ the stated default), and an integer >= 1 when declared
      AC (gain-config): absent ⇒ 6; declared 3 ⇒ 3; 0 ⇒ loop.open_semantic_discovery 'gain_every_rounds' must be an integer >= 1 (got 0)
  ✔ AC (a) — arms with DIFFERENT budgets are refused, naming every field that differs
      AC (a): ["PAIRED_ARM_BUDGETS_DIFFER:max_clusters_verified:3!=4"]
  ✔ AC (b) — a pre-registration written AFTER the first call is refused; older-than ⇒ clean
      AC (b): late-reprereg ⇒ ["PREREG_NOT_OLDER_THAN_RUNS"]; no-call-time ⇒ PAIRED_PREREG_UNVERIFIABLE
  ✔ AC (c) — a NEGATIVE gain is recorded as negative (for the round's metrics AND its USD)
      AC (c): gain={"net_new":-2,"duplicates":2,"refuted":1,"undetermined":0,"usd":0.5,"model_calls":3}; rollup.series.net_new=[-2,3] totals={"net_new":1,"duplicates":2,"refuted":1,"usd":0.5}
  ✔ AC (d) — duplicates and refuted findings never count as net-new, in EITHER arm
      AC (d): per-arm net-new=1 from 7 clusters (1 novel, 1 duplicate, 3 refuted, 1 undetermined, 1 unjudged)
  ✔ AC (e) — a paired-round record is NOT independent evidence: the promotion path caps it at trial
      AC (e): production-open ⇒ promoted_to=trial (candidate_after.status=trial); independent ⇒ active
  ✔ AC (f) — no eligible method ⇒ `not-evaluated:no-eligible-method`, NEVER a zero gain
      AC (f): round.paired={"due":false,"ordinal":1,"not_evaluated":"not-evaluated:no-eligible-method"} gain_records=0
  ✔ WIRING — a due paired round runs BOTH arms on one pin and files only the guided one
      wiring: PAIRED round 1: baseline 2 net-new / 0 duplicate / 0 refuted / $0.00018; guided 1 / 0 / 0 / $0.0001; gain {"net_new":-1,"duplicates":0,"refuted":0,"undetermined":0,"usd":-0.00008,"model_calls":-4}
  ```

  Per-item readings:
  - **(a)** `pairedBudgetRefusal` refuses any two arms whose envelopes differ, naming every differing field. The round reads the envelope from ONE config (`pairedArmBudget`) for both arms and compares before either runs, so a future path that gave one arm more turns is refused rather than recorded as a comparison it never was.
  - **(b)** `pairedPreregRefusal` REUSES the engine's own `preregRefusal` (`arch-hypothesis-generation.mjs`) — the mtime rule and the hash vocabulary are declared once. A pre-registration newer than **or equal to** the first call is `PREREG_NOT_OLDER_THAN_RUNS`; a prompt hash that does not match is `PREREG_HASH_MISMATCH:<arm>-prompt`; and with no call time supplied it is `PAIRED_PREREG_UNVERIFIABLE` (硬规则 3b: nothing to be older than ⇒ its own refusal, never a pass). The WIRING case additionally asserts the ordering against the reservation ledger: the prereg file's mtime is strictly older than the first `reserve` line.
  - **(c)** `gainOf` subtracts without clamping: a `−2` is stored as `−2`, and the USD delta is signed the same way. `gainRollup` keeps every round's own value in `series` (`[-2, 3]`), sums only in `totals`, and counts negative rounds separately — there is no blended score anywhere.
  - **(d)** `pairedArmCounts` counts net-new ONLY where `confirmed === true` AND the novelty disposition is `novel`. A REFUTED cluster is excluded first (by the verifier's or the refuter's own verdict), whatever the `confirmed` flag beside it says — the case shows a 7-cluster arm with 1 novel / 1 duplicate / 3 refuted / 1 undetermined / 1 unjudged yielding exactly 1 net-new, and both arms are scored by the same function. A cluster recorded as BOTH confirmed and refuted still counts 0 net-new.
  - **(e)** The promotion path's level cap is now the NAMED `promotionStatusForLevel` in `docs/analysis/discovery-reflection.mjs`, and the case runs the REAL `validateGeneralization` with `evidenceLevel:"production-open"`: a CORRECT prediction promotes the candidate only to the report-only `trial`, never `active`.
  - **(f)** `pairedRoundDecision` returns `not-evaluated:no-eligible-method` (its own token) when no eligible method exists, and the round records it on `round.paired.not_evaluated` while writing NO gain record — "we could not measure" is never a 0.

- [x] Negative control: let the promotion path accept `production-open` gain records in a scratch copy ⇒ (e) goes red. Paste the output.

  **Output** — a SCRATCH copy of `discovery-reflection.mjs` with ONLY the level cap replaced by `return "active";` (its siblings symlinked, nothing else changed):
  ```
  ✔ NEGATIVE CONTROL (e) — let the promotion path accept `production-open` in a scratch copy ⇒ (e) goes RED
      NEGATIVE CONTROL (e): mutant promoted a production-open verdict to status=active (claim was «never active»)
  ```
  i.e. `mutant.promotionStatusForLevel("production-open") === "active"` and, end-to-end, `mutant.validateGeneralization({…, evidenceLevel:"production-open"})` returns `candidate_after.status === "active"` — so the (e) assertion (`promoted_to === "trial"`) is FALSIFIED. The control is live.

- [ ] Production reading: the first paired round after landing — paste both arms' counts, cost and the gain record; or state that it has not occurred and why (e.g. no eligible method). （待外部）

  **Reading taken at landing (2026-10-13), against the PRODUCTION carrier and the PRODUCTION registry** — no paired round has occurred yet, and the run-time state says why:
  ```
  {
   "carrier": "/data/home/yale/work/quay/.quay/open-semantic-discovery-findings.jsonl",
   "carrier_records": 2,
   "scan_rounds": 2,
   "resident_scan_rounds": 2,
   "eligible_rounds": 0,
   "registry_active_methods": 0,
   "decision": { "due": false, "ordinal": 1, "reason": "not-evaluated:no-eligible-method" },
   "gain_records_on_carrier": 0
  }
  ```
  The routine HAS run in production (2 resident scan-rounds), but `activeMethods()` returns **0 active** methods (the registry holds 1 `draft`, 3 `retired`), so there is no eligible method to pair and the instrument reports `not-evaluated:no-eligible-method` rather than a gain. `gain_records_on_carrier: 0` is that state, not a zero measurement. The first paired round therefore awaits a method promotion; the counts/cost/gain paste follows it. Left （待外部） per the DoD.

## Definition of Done
- All AC ticked with output pasted (production AC may stay （待外部）).
- `scripts/test.sh --for-task gap-open-discovery-periodic-baseline-vs-guided-gain` green.

## Touches
- tasks/gap-open-discovery-periodic-baseline-vs-guided-gain.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/test/open-semantic-discovery-routine.test.mjs
- docs/analysis/discovery-reflection.mjs

## Implementation notes
- **New instrument** (all pure, all exported, in `plugin/scripts/open-semantic-discovery-routine.ts`): `pairedRoundDecision`, `pairedArmBudget` / `pairedBudgetRefusal`, `pairedArmCounts` / `armNoveltyRows` / `callsOfArm`, `gainOf`, `pairedPreregKeys` / `pairedPreregRefusal`, `buildGainRecord`, `gainRollup`, `eligibleRoundsOf`, `openBaselineDiscoveryRecordId`, plus the `gain_every_rounds` config key (OPTIONAL — absent ⇒ `DEFAULT_GAIN_EVERY_ROUNDS = 6`; `0` is refused so "switched off" cannot look like "never declared").
- **One pipeline, two arms**: the round's investigation→verify→refute→value→novelty body is now ONE closure parameterised by the arm and run twice. The unguided arm stamps its own reservation step kinds (`baseline-*`) so the ledger says which arm spent a call, and mints its ids under a `#baseline#` segment so a measurement record can never be resolved as a production one.
- **The instrument measures, it does not file**: the baseline arm's clusters ride the carrier (readable, and excluded from the mechanical-repeat set) but reach NEITHER the Experience ledger NOR the Portfolio — which is also what keeps the two arms' novelty checks comparable, since both read the PRE-round Portfolio.
- **Evidence level is on the bytes**: the gain record carries `evidence_level: "production-open"`, `counts_as_independent_evidence: false` and `promotion.licenses: "nothing"`, so a reader does not have to re-derive the rule from the level.
- **One ordering note**: "older than every call" is judged in whole milliseconds off the file's mtime, so the round yields the clock once (`PREREG_SETTLE_MS = 25`) between writing the declaration and the first call. A same-millisecond write+call is unprovable and would have been a FALSE refusal; the settle can only make the declaration older, never younger, so it cannot manufacture a false pass.
- **`docs/analysis/discovery-reflection.mjs`**: the level cap was extracted from an inline ternary into the named, exported `promotionStatusForLevel(level)` + `PROMOTION_REPORT_ONLY_STATUS`, used by `runGeneralization` — so (e) is checkable against the real decision instead of a re-implementation that would agree with itself.
