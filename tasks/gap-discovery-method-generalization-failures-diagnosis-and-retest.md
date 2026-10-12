---
id: gap-discovery-method-generalization-failures-diagnosis-and-retest
title: "Discovery Method: diagnose the three trustworthy generalization
  failures, fix the failing step generically, retest on a new sealed holdout"
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-discovery-experience-ledger-provenance-and-skip-audit
---
## Proposal
The independent regression (done task `gap-discovery-method-loop-independent-regression`; carrier `.quay/discovery-generalization-verdicts.jsonl`) produced three trustworthy failures and zero correct generalizations:

| verdict | method@version | held-out (pin `f2432d178`) | predicted | expected |
|---|---|---|---|---|
| V1 | `non-substantive-verdict-triage@8` | `HX-needs-human-transition-three-copies` (`worker-driver.ts`, `driver-filters.ts`) | refuted | supported |
| V2 | `composite-subject-verdict-decomposition@1` | `HX-scope-memorymax-literal-vs-host-derived` (`driver-runtime.ts`, `full-suite-runner.ts`) | refuted | supported |
| V4 | `non-substantive-verdict-triage@8` | `HX-neg-cpu-stall-readers-different-source` (negative) | supported | refuted |

Lineage and temporal checks passed on all three, so these are real failures, not leaks. What the record already shows, as HYPOTHESES to test, not conclusions:

- **H-induction:** the induced methods describe the discovery pipeline's OWN bookkeeping (verdict triage, carrier persistence), not architecture. The worker of that task wrote as much: "the round's candidates are methods about the discovery pipeline's own bookkeeping, not about the E-DT-1 architecture cases". A suspected cause is the Experience representation. `ingestNewOutcomes` derives `summary` from the outcome record's own text (e.g. "E-HYPGEN-ACCEPT-1 cluster 5: verifier verdict \"supported\" on subject …"), which carries no domain claim. The claim lives in the linked hypothesis and evidence records, which are not joined.
- **H-applicability:** `validateGeneralization` applied every candidate to every held-out case with no applicability gate. A method that does not apply yields "invariant holds" (refuted), which is scored as a wrong prediction, so "not applicable" and "wrong" share one shape (硬规则 3b).
- **H-verifier:** V3 (`carrier-persistence-check@3`) hit `error_max_turns` at 15 turns. The verifier may also mis-read under its turn budget.
- **H-scoring:** the label semantics (supported = invariant violated) may be inverted for some method shapes.

The old holdout pool is spent:
- 4 of the 6 `E-DT-1` holdouts have now been evaluated against: V1, V2, V4, plus `HX-reflog-empty-action-producer-vs-classifier` in V3.
- `HX-scope-argv-builders-oompolicy-divergence` shares both files with the MemoryMax case.

So the retest needs a NEW sealed holdout.

## Plan
1. **Diagnosis**, read-only, no model calls. For V1/V2/V4, collect the stored candidate record (registry), its seed Experiences (ledger), the verdict record, and any stored verifier reasoning. Report what each step saw. Test each hypothesis with a control that would come out differently if the hypothesis were false (硬规则 4 推论四):
   - H-induction: show the seed Experiences' text has no domain claim, and a joined version (outcome + its hypothesis statement + evidence quotes) does.
   - H-applicability: show the candidate's `applicability.domain_signals` do not match the held-out's components or claim.
   - H-scoring: check the label mapping for each case.

   Record the verdict on each hypothesis (supported / refuted / undetermined).
2. **Generic fixes**, only for the hypotheses diagnosis supports. Never per-case, never relaxing promotion.
   - (a) The Experience representation joins an outcome to its linked hypothesis statement and evidence quotes (by `experiment_ref`/`subject_key`), so induction sees the domain claim. Seed components and case ids stay barred from method text, per the existing anti-leak rules.
   - (b) An applicability gate before `validateGeneralization`: the verifier first answers `applies: yes | no | undetermined` from the method's `applicability` against the held-out files. `no` ⇒ the verdict is `not-applicable`. It counts neither as correct nor as wrong, and does not promote or retire. Learning quality is reported as correct / applicable-evaluated, with the not-applicable count stated.
   - (c) If H-verifier is supported: give the verifier the deterministic evidence pack (definition and import lines) it already has for `verify`, rather than raising the turn cap.
3. **New sealed holdout**, built by an INDEPENDENT labeler (a fresh agent with no access to the discovery carriers or any method record), using the same procedure as `/data/home/yale/work/quay-scratch/dt1/labels-draft.md`:
   - a new pin, chosen BEFORE fixes that landed after `f2432d178`;
   - cases fixed after that pin, verified present at it;
   - every component pair used by any earlier holdout or seed excluded;
   - at least 4 positives and at least 2 negatives where real data allows, reporting the true count if fewer.

   Seal the label file with sha256 under `/data/home/yale/work/quay-scratch/dm-holdout2/` and pre-register it (pin, labels sha, model, budget) BEFORE any reflection or verifier call.
4. **Retest:** one bounded reflection round on the improved representation (report-only, budget stated), then `validateGeneralization` with the applicability gate against the new holdout at its pin, in a stripped tree.
   - Promotion rules are unchanged: correct, lineage-isolated, temporally bound.
   - 0 active is an acceptable outcome.

## Acceptance Criteria
- [ ] Diagnosis, real: for V1, V2 and V4, paste the candidate record, the seed Experiences' summaries, the verdict record, and the control for each hypothesis with its verdict. Name which step(s) failed. No fix may be justified by a hypothesis the diagnosis left `undetermined` or `refuted`.
- [ ] `node --test plugin/test/discovery-reflection.test.mjs plugin/test/discovery-experience-ledger.test.mjs` exits 0, with new cases for each fix actually made:
  - (a) a joined Experience carries the hypothesis statement, and its seed basenames are still barred from method text;
  - (b) `applies:no` ⇒ `not-applicable`, neither correct nor retired;
  - (c) learning quality excludes not-applicable from the denominator and reports its count.
- [ ] Static: no held-out or seed case id or component basename appears in production code. Paste the `grep` over the changed `docs/analysis/discovery-*.mjs` files.
- [ ] New holdout: paste the labeler's case list (ids, files, pin, fix commits, roles), the exclusion check against all earlier holdouts and seeds, and the sealed sha256. The pre-registration file's mtime must be older than the first model call of the retest.
- [ ] Retest, real: paste each candidate × holdout result — applies, predicted, expected, correct, promoted — plus correct / applicable-evaluated, the not-applicable count, and `activeMethods()` after the run. Report honestly if it is 0/N.
- [ ] Cost: model calls; input, output and cache_read tokens; wall ms; the CLI `cost_usd`; and the recomputation at the gateway rates from `GET http://127.0.0.1:26510/model_group/info`.
- [ ] Mutation control: remove the applicability gate and show case (b) goes red. Paste, then revert.

## Definition of Done
- All AC ticked with output pasted.
- All methods remain report-only; nothing is wired into a task, goal or driver.
- `scripts/test.sh --for-task gap-discovery-method-generalization-failures-diagnosis-and-retest` green.

## Touches
- tasks/gap-discovery-method-generalization-failures-diagnosis-and-retest.md
- docs/analysis/discovery-reflection.mjs
- docs/analysis/discovery-experience-ledger.mjs
- plugin/test/discovery-reflection.test.mjs
- plugin/test/discovery-experience-ledger.test.mjs
