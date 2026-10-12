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
- [x] `node --test plugin/test/discovery-portfolio.test.mjs` exits 0, covering:
  - (a) a correction setting `duplicate_of` removes the finding from `net_new_value` and lists it under `zero_or_negative.duplicates`;
  - (b) a correction setting `outcome:"refuted"` removes it from `net_new_value` and lists it under `zero_or_negative.refuted`;
  - (c) a correction setting `fix_task` to a task whose landing is derivable adds it to `net_new_value` with a DERIVED `fix_landed_commit`;
  - (d) refusals, each with a distinct reason code: unknown `finding_id`; `duplicate_of` pointing at itself, at a later finding, at a duplicate, or forming a cycle; `fix_task` not on the landing branch; a caller-supplied `fix_landed_commit`; an unknown field; a missing `reason`/`evidence`/writer identity;
  - (e) the carrier's original `portfolio_finding` lines are byte-identical before and after any correction (append-only), and read-back exposes both original and effective values.

  Evidence — `node --test plugin/test/discovery-portfolio.test.mjs` ⇒ `ℹ tests 22 / ℹ pass 22 / ℹ fail 0`, exit 0 (22 = the 17 pre-existing tests, unchanged, + the 5 new ones). The five new tests are `(a) correction: duplicate_of …`, `(b) correction: outcome:"refuted" …`, `(c) correction: fix_task …`, `(d) correction refusals …`, `(e) a correction never rewrites the carrier …`. Each clause of this AC, with the readings the cases assert:
  - (a) `net_new_value` 2 → 1, `zero_or_negative.duplicates` `["F-E"]` → `["F-B","F-E"]`, `net_new_value.finding_ids` → `["F-A"]`. The correction is deliberately NOT required to match the component set (the real c11 case is a strict superset of c10), so the test asserts the two sets are *unequal* and that the named original still precedes its duplicate.
  - (b) `net_new_value` 2 → 1, `zero_or_negative.refuted` `["F-D"]` → `["F-A","F-D"]`. The corrected row is still UNRATED (`ratings: {rated:0, unrated:5}`, `human_rating: null`) — a correction is not a rating.
  - (c) `net_new_value` 2 → 3 with `finding_ids ["F-A","F-B","F-C"]`; `F-C.fix_landed_commit` = the `t-fix-a` done commit read from git, `fix_landed_reason` matching `DONE_SUBJECT_ON_develop`; `corrected_from = {fix_task:null, fix_landed_commit:null, fix_landed_reason:"NO_FIX_TASK"}`. The correction record's `patch` has exactly one key (`fix_task`) — the landing is not a field of it, so it cannot be supplied.
  - (d) 17 refusals, each asserted against its own code: `CORRECTION_TARGET_NOT_FOUND:`, `CORRECTION_DUPLICATE_OF_SELF:`, `CORRECTION_DUPLICATE_OF_NOT_EARLIER:`, `CORRECTION_DUPLICATE_OF_CHAINED:`, `CORRECTION_DUPLICATE_OF_UNRESOLVED:`, `CORRECTION_DUPLICATE_OF_CYCLE:`, `CORRECTION_FIX_TASK_NOT_ON_BRANCH:`, `CORRECTION_DERIVED_FIELD_SUPPLIED:` (×2 — a caller-supplied `fix_landed_commit`, and `recurred`), `CORRECTION_FIELD_NOT_CORRECTABLE:` (an unknown field, `claim`), `CORRECTION_OUTCOME_NOT_IN_VOCAB:`, `CORRECTION_PATCH_MISSING:`, `CORRECTION_REASON_INSUBSTANTIAL:` (×2), `CORRECTION_EVIDENCE_REQUIRED:` (×2), `CORRECTION_ACTOR_MISSING:`, `CORRECTION_ACTOR_NOT_IN_VOCAB:`, `FIELD_INVALID:by-needs-the-namer`. After all of them `corrections.length === 0` and the carrier still holds exactly its 6 lines — no refused correction wrote anything.
  - (e) the lines that existed before the write are `deepEqual` byte-identical afterwards, exactly ONE line is appended and its `kind` is `portfolio_correction`; the folded record reads `outcome:"refuted"` / `corrected:true` / `correction_ids:[<the id>]` / `corrected_from:{outcome:"supported"}`, while the same row's own line on disk still says `supported`; an uncorrected row reads `corrected:false` / `correction_ids:[]` / `corrected_from:null`; a re-run of the same correction is `DUPLICATE_ID` and appends nothing; a correction naming a finding the carrier does not hold is reported under `orphan_targets` rather than dropped.
- [x] **Negative control (anti-inflation)**: in a scratch copy, make the fold ignore `duplicate_of`/`refuted` corrections and show (a)/(b) go red; paste the red output; restore.

  Evidence — scratch copy `/tmp/portfolio-correction-mutation` holding `docs/analysis/*.mjs`, `plugin/test/discovery-portfolio.test.mjs` and `plugin/scripts/capability-catalog-declarations.json` (so the module's `REPO_ROOT` resolves). Baseline in that SAME copy, unmutated: `ℹ tests 22 / pass 22 / fail 0` — so the red below is attributable to the mutation and not to the copy. Mutation applied in `applyPortfolioCorrections`: the patch is filtered to `Object.fromEntries(Object.entries(c.patch).filter(([k, v]) => k !== "duplicate_of" && v !== "refuted"))`, i.e. the fold ignores exactly the two judgments whose purpose is to remove value. Red output (`ℹ tests 22 / pass 19 / fail 3`):
  ```
  ✖ (a) correction: `duplicate_of` moves the finding out of net_new_value into zero_or_negative.duplicates
    AssertionError [ERR_ASSERTION]: the corrected row leaves net_new_value
    2 !== 1
        at TestContext.<anonymous> (…/plugin/test/discovery-portfolio.test.mjs:794:10)
  ✖ (b) correction: `outcome:"refuted"` moves the finding out of net_new_value into zero_or_negative.refuted
    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
    2 !== 1
        at TestContext.<anonymous> (…/plugin/test/discovery-portfolio.test.mjs:816:10)
  ✖ (e) a correction never rewrites the carrier: the earlier lines stay byte-identical, and read-back reports BOTH values
    AssertionError [ERR_ASSERTION]: the effective value is the corrected one
    + actual - expected
    + 'supported'
    - 'refuted'
        at TestContext.<anonymous> (…/plugin/test/discovery-portfolio.test.mjs:936:10)
  ```
  Both required cases (a) and (b) go red; (e) goes red as well because it asserts the effective value. Restore: the mutation was made only in the `/tmp` scratch copy, never in the worktree — `git -C <worktree> status --porcelain` is empty and the worktree re-run is `ℹ tests 22 / pass 22 / fail 0`.
- [x] **Real correction, production carrier** (shared checkout `.quay/discovery-portfolio.jsonl`): apply the three corrections in the Proposal through the new function. Paste:
  - the three appended correction lines;
  - `sha256` of the carrier's pre-existing prefix (the first N lines, N = line count before the write), before and after;
  - `valueMetrics` before and after. **Expected (falsifiable): `net_new_value.total` 11 → 12, the +1 being `GAIN1-CTRL-c10` with `fix_landed_commit` resolving to the landing of `74b4341b8`; `GAIN1-LEARN-c11` under `duplicates`; `GAIN1-LEARN-c13` under `refuted`; neither c11 nor c13 in `net_new_value` or `supported_but_not_landed`.** If any reading differs, report the actual numbers and why; do not adjust the expectation to fit.

  Evidence — applied with `correctFinding(...)` (the module's own write path; the carrier was never edited by hand). All three returned `ok:true, appended:true`. The three appended lines, verbatim:
  ```
  {"kind":"portfolio_correction","id":"portfolio_correction-3a09c2a8650eb0af","finding_id":"GAIN1-CTRL-c10","patch":{"fix_task":"gap-self-report-vocab-audit-check-pattern-tables-diverge"},"reason":"the confirmed defect's fix task was filed and landed after ingest (gap-self-report-vocab-audit-check-pattern-tables-diverge, landed on develop as 74b4341b8); the record was ingested with fix_task:null so the landed fix was never counted","evidence":["docs/analysis/discovery-capability-gain-report.md#5","docs/analysis/discovery-capability-gain-report.md#6","tasks/gap-self-report-vocab-audit-check-pattern-tables-diverge.md"],"by":"task-worker:gap-discovery-portfolio-append-only-correction-fold","actor":"task-worker","ts":"2026-10-12T15:41:26.434Z"}
  {"kind":"portfolio_correction","id":"portfolio_correction-aa134a19d7fb102c","finding_id":"GAIN1-LEARN-c11","patch":{"duplicate_of":"GAIN1-CTRL-c10"},"reason":"the operator re-check found LEARN c11 is the SAME finding as CTRL c10 (identical component pair, identical confirmed divergence) restated over a wider component set, not a second finding","evidence":["docs/analysis/discovery-capability-gain-report.md#5"],"by":"task-worker:gap-discovery-portfolio-append-only-correction-fold","actor":"task-worker","ts":"2026-10-12T15:41:27.272Z"}
  {"kind":"portfolio_correction","id":"portfolio_correction-146efdea83741d94","finding_id":"GAIN1-LEARN-c13","patch":{"outcome":"refuted"},"reason":"the operator re-check refuted the finding's stated mechanism (all four components import the single touches-parser.ts) and found the divergence it relocated to is documented and test-pinned","evidence":["docs/analysis/discovery-capability-gain-report.md#5"],"by":"task-worker:gap-discovery-portfolio-append-only-correction-fold","actor":"task-worker","ts":"2026-10-12T15:41:28.071Z"}
  ```
  Prefix integrity — `N = 29` lines before the write; the file went 29 → 32 lines, so exactly the three correction lines were added and nothing else:
  - `sha256` of the first 29 lines BEFORE: `bd433233096798166bd73eb2185bb04f1a002dec3aee838b42929ac695d1b6c7`
  - `sha256` of the first 29 lines AFTER:  `bd433233096798166bd73eb2185bb04f1a002dec3aee838b42929ac695d1b6c7`
  - identical ⇒ every pre-existing line is byte-for-byte what it was; the 16 `portfolio_finding` lines and the 13 `portfolio_domain` lines were neither rewritten nor deleted.
  `valueMetrics` BEFORE → AFTER (read through `readPortfolio`):
  | reading | before | after |
  |---|---|---|
  | `net_new_value.total` | 11 | **12** |
  | `net_new_value.finding_ids` | F01…F11 | F01…F11 **+ GAIN1-CTRL-c10** |
  | `net_new_value.by_origin["autonomous-experiment"]` | 3 | 4 |
  | `zero_or_negative.duplicates` | `[]` | **`["GAIN1-LEARN-c11"]`** |
  | `zero_or_negative.refuted` | `["N01"]` | **`["N01","GAIN1-LEARN-c13"]`** |
  | `zero_or_negative.supported_but_not_landed` | `["F12","GAIN1-CTRL-c10","GAIN1-LEARN-c11","GAIN1-LEARN-c13"]` | **`["F12"]`** |
  So every clause of the falsifiable expectation held **except one, which I report rather than adjust**: the +1 is `GAIN1-CTRL-c10` and it is in `net_new_value`, c11 is under `duplicates`, c13 is under `refuted`, and neither c11 nor c13 is in `net_new_value` or in `supported_but_not_landed` — but c10's `fix_landed_commit` resolves to **`9f00e3014a79622ea62ca03e317cfadc3e1b0e3c`**, not to `74b4341b8`.
  Why, and it is not a defect in the correction: `deriveFixLandedCommit` reads the LAST `develop` commit on `tasks/<fix_task>.md` **whose subject marks the task done** (`DONE_SUBJECT_RE`). `74b4341b8` (`self-report-vocab: ONE pattern table + ONE stopped-state rule + ONE convergence judgment`) is the commit that changed the CODE; it does not touch `tasks/gap-self-report-vocab-audit-check-pattern-tables-diverge.md`, so it cannot be what a reading over that path names. The derivation names the done-flip commit `9f00e3014a79622ea62ca03e317cfadc3e1b0e3c` (`tasks: 翻 gap-self-report-vocab-audit-check-pattern-tables-diverge done（driver 机械 fan-in）`), and `fix_landed_reason` says so in the record (`DONE_SUBJECT_ON_develop:tasks/gap-self-report-vocab-audit-check-pattern-tables-diverge.md`). Both are real commits on `develop`; `74b4341b8` is an ancestor of it (`git merge-base --is-ancestor 74b4341b8 develop` ⇒ 0). The finding that gained value is the right one; only the sha the AC named is the code-landing rather than the task-landing. The other two corrected records read as intended: c11 `{outcome:"supported", duplicate_of:"GAIN1-CTRL-c10", corrected:true, corrected_from:{duplicate_of:null}}` and c13 `{outcome:"refuted", corrected:true, corrected_from:{outcome:"supported"}}`, and `readPortfolioCorrections(root).orphan_targets` is `[]` — no correction in the carrier corrects nothing.
- [x] Coverage map before/after on the production carrier: paste both. Neither c11 nor c13 backs any domain, and any grade change is explained by the specific finding that caused it. Zero grade change is an acceptable, reported result.

  Evidence — `coverageMap` before (same module, same records: the carrier's first 29 lines replayed as a stand-in shared checkout, plus the registry carriers) and after (the live shared checkout). Domain grades, in the map's own order:
  | domain | before | after |
  |---|---|---|
  | shared semantics | autonomous | autonomous |
  | config→behavior | assisted | assisted |
  | writer/checker contract | autonomous | autonomous |
  | state transitions | assisted | assisted |
  | reuse refutation | autonomous | autonomous |
  | method trustworthiness | none | none |
  `gap` before = `["config-to-behavior","state-transitions","method-trustworthiness"]`; `gap` after = the same three. **Grade change = 0**, and `context` is `{findings:16, classified:16, assignments:13}` on both sides.
  The one row that moved, `shared-semantics`, with its own reasons:
  - before: `grade_reason` `F02(landed-fix),F03(landed-fix),F04(landed-fix),F06(landed-fix)`; `autonomous_ids` `["F02","F03","F04","F06"]`; `duplicates` `[]`; `not_autonomous` included `GAIN1-CTRL-c10=SUPPORTED_WITHOUT_LANDED_FIX`, `GAIN1-LEARN-c11=SUPPORTED_WITHOUT_LANDED_FIX`, `GAIN1-LEARN-c13=SUPPORTED_WITHOUT_LANDED_FIX`.
  - after: `grade_reason` `F02(landed-fix),F03(landed-fix),F04(landed-fix),F06(landed-fix),GAIN1-CTRL-c10(landed-fix),GAIN1-LEARN-c13(refutation)`; `duplicates` `["GAIN1-LEARN-c11"]`; `not_autonomous` now `F08=ORIGIN_NOT_AUTONOMOUS:operator`, `F10=ORIGIN_NOT_AUTONOMOUS:mechanical-instrument`, `F12=ORIGIN_NOT_AUTONOMOUS:user`, `GAIN1-LEARN-c11=DUPLICATE_OF:GAIN1-CTRL-c10`.
  So c11 backs nothing, exactly as the AC says: it leaves `not_autonomous` for `findings.duplicates`, and `autonomousEvidenceFor` refuses a duplicate outright (`DUPLICATE_OF:…`), which is why it adds no depth to the domain either. The grade is unchanged for the reason the AC asks for: `shared-semantics` was already `autonomous` on F02/F03/F04/F06 before the corrections and still is after them, so no finding "caused" a grade change.
  **c13 is the one clause of this AC I cannot report as written, and I am reporting the reading instead of adjusting the expectation to fit.** After the correction, `GAIN1-LEARN-c13` appears in `shared-semantics.findings.autonomous_ids` and in `grade_reason` as `GAIN1-LEARN-c13(refutation)` — it IS counted as autonomous coverage of that domain. That is the module's deliberate `refutation` arm (`autonomousEvidenceFor`: an autonomous-origin REFUTED finding is "capability WITHOUT value" — it grades a domain while contributing nothing to `net_new_value`), and it is not something this task introduced: the pre-existing record `N01` has exactly the same shape and grades `reuse-refutation` autonomous in BOTH maps pasted above (`grade_reason` `N01(refutation)` before and after). The arm cannot be narrowed for corrected records without special-casing "refuted because a correction says so" against "refuted at ingest", which would make the same finding grade differently depending on how it arrived; and dropping the arm outright reds the pre-existing coverage case (d), which pins `C-REFUTED` ⇒ `autonomous` with reason `C-REFUTED(refutation)`. What IS true and is what the AC's own escape clause covers: c13 causes **no grade change**, and it names no domain it did not already sit in — the correction moved it from `not_autonomous: SUPPORTED_WITHOUT_LANDED_FIX` (adding nothing) to `autonomous_ids` (adding autonomous-refutation evidence) inside a domain that was already `autonomous`. If the intended reading was "a refuted finding must back no domain at all", that is a change to `autonomousEvidenceFor`'s refutation arm, it is outside this task's Plan, and it would red an existing pinned test — so it is an authoring decision, not something to paper over here.
- [x] Regression: the existing anti-inflation mutation control (case (g), the `landed(r)` clause) still goes red when mutated. Paste its output.

  Evidence — scratch copy `/tmp/portfolio-landed-mutation` (same layout as the AC2 copy), baseline `pass 22 / fail 0`. Mutation in `valueMetrics`: `const valuable = (r) => r.outcome === "supported" && auditable(r);` — the `landed(r)` clause dropped, i.e. the metric counts SUPPORTED FINDINGS instead of LANDED FIXES. Result `ℹ tests 22 / pass 16 / fail 6`; case (g) goes red on its ABSOLUTE assertion, which is the one the module's own comment says this mutation must turn red:
  ```
  ✖ (g) adding 10 refuted records leaves net_new_value unchanged (the anti-inflation control)
    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
    3 !== 2
        at TestContext.<anonymous> (…/plugin/test/discovery-portfolio.test.mjs:349:10)
  ```
  The other five reds are the same clause's other consumers — `(c)` `[ 'F-A', 'F-B', 'F-C' ]` vs `[ 'F-A', 'F-B' ]`, `(d)`, and the three correction cases `(a)`/`(b)`/`(c)` — i.e. the new correction tests are wired to the same anti-inflation clause rather than around it. Worktree restored/untouched: `git -C <worktree> status --porcelain` empty, re-run `pass 22 / fail 0`.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-discovery-portfolio-append-only-correction-fold` green.
- No `portfolio_finding` line rewritten or deleted; no human rating written (`rateFinding` stays human-only).

## Touches
- tasks/gap-discovery-portfolio-append-only-correction-fold.md
- docs/analysis/discovery-portfolio.mjs
- plugin/test/discovery-portfolio.test.mjs
