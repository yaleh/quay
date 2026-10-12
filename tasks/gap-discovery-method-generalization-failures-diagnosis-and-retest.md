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

## Diagnosis

Read-only, **zero model calls**. Artifacts: `/data/home/yale/work/quay-scratch/dm-retest2/diagnosis.mjs` → `ev/diagnosis.json`, `ev/diagnosis.txt`. Pin `f2432d178`.

**Which step(s) failed.** Three of the four steps the failing run exercised are named below as the ones that failed; the fourth is named as the one that did **not**. No fix in this task is justified by a hypothesis the diagnosis left `undetermined` or `refuted`.

| hypothesis | step it names | verdict |
|---|---|---|
| H-induction | the **Experience representation** fed to reflection | **SUPPORTED** |
| H-applicability | **`validateGeneralization`'s missing gate** | **SUPPORTED** |
| H-verifier | the **verifier's turn budget** (resource-bound half only) | **SUPPORTED** |
| H-scoring | the **label semantics** | **REFUTED** — no fix |

### V1 — `non-substantive-verdict-triage@9` × `HX-needs-human-transition-three-copies`

Verdict record (`.quay/discovery-generalization-verdicts.jsonl`):

```json
{"method_id":"non-substantive-verdict-triage","version":9,"held_out_case_id":"HX-needs-human-transition-three-copies",
 "called":true,"outcome":"evaluated","refusal_code":null,"predicted_verdict":"refuted","expected_verdicts":["supported"],
 "correct":false,"lineage_ok":true,"temporal_ok":true,"evaluation_pin":"f2432d17849e7bd375dbfa573ae55ea4efad171d",
 "promoted":false,"retirement_reason":"failed-generalization-on-HX-needs-human-transition-three-copies: predicted-refuted-but-role-found-and-fixed-requires-supported",
 "not_evaluated_reason":null}
```

**Stored verifier reasoning: none.** The verdict carrier's own field list has no `reasoning` key (`kind, id, ts, method_id, version, held_out_case_id, called, outcome, refusal_code, predicted_verdict, expected_verdicts, correct, lineage_ok, temporal_ok, evaluation_pin, evaluated_commit, promoted, retirement_reason, not_evaluated_reason`), and the regression run's own output keeps only `subtype`/`num_turns`/`usage`. ⇒ "the verifier *mis-read* the code" is **untestable from the record**; only "the reading failed on a resource bound" is (see H-verifier).

Candidate record (registry `method-a073630f32ddbd58`), abbreviated to the fields the diagnosis reads:

```json
{"method_id":"non-substantive-verdict-triage","version":9,"status":"retired",
 "provenance_evidence":["experience-7f65eb76070d8765"],
 "applicability":{"domain_signals":["A discovery/verification record whose verdict is an affirmative token over a declared subject (a named set of modules) while its evidence field holds an opaque, unresolvable reference (an outcome/cluster id) and no reason field carries a statement about that subject; the record's own disposition is still unresolved."],
   "preconditions":["Does not apply where the record store structurally cannot resolve evidence pointers …"]},
 "operation":{"steps":["Read the record as a triple — verdict token, reason/termination field, evidence pointer — then resolve the evidence pointer to concrete content …"]},
 "expected_invariant":"Any verdict admissible as evidence about a subject must have at least one evidence record that resolves to content mentioning that subject; …"}
```

Seed Experience `experience-7f65eb76070d8765` (`source_ref` `outcome-a7c84fa7c2bc1cb4`, role `found-unresolved`, 6 components), **as shipped**:

```
E-DT-1-Hp cluster 8: verifier verdict "supported" on subject hypgen:ownership|plugin/scripts/full-suite-runner.ts,plugin/scripts/mirror-full-suite-state.ts,plugin/scripts/red-window-triage.ts,plugin/scripts/runner-state-write.ts,plugin/scripts/slot-refill.ts,plugin/scripts/suite-state-trigger.ts
```

The **linked claim record** the same `subject_key` carries (`counterexample-765edaa7de22bc74`):

```
The counterexample is partly real: shouldSkipMirrorWrite (mirror-full-suite-state.ts:147-150) makes the fan-in mirror an explicit read-and-skip whenever the on-disk state is non-terminal (finishedAt == null = running / early-red), so while the runner's round is in flight the mirror is a no-op and the runner's guarded terminal write stays authoritative. But the two guards are NOT the same predicate
```

Held-out claim (the labeler's own words): *"The pairing 'latch retryState.needsHuman + commit needs-human to disk' is done in three separate places … The copies diverged … The fix unified all three through driver-filters.ts applyNeedsHumanTransition."*

### V2 — `composite-subject-verdict-decomposition@2` × `HX-scope-memorymax-literal-vs-host-derived`

Verdict: predicted `refuted`, expected `supported`, `correct:false`, `lineage_ok:true`, `temporal_ok:true`, retired with `failed-generalization-on-HX-scope-memorymax-literal-vs-host-derived: predicted-refuted-but-role-found-and-fixed-requires-supported`. Seed `experience-3af7e6e006435de2` (`outcome-a479b76da38cd895`, `found-unresolved`, 4 components); **shipped summary**:

```
E-HYPGEN-1 cluster 7: verifier verdict "supported" on subject hypgen:invariant|plugin/scripts/full-suite-runner-types.ts,plugin/scripts/full-suite-runner.ts,plugin/scripts/mirror-full-suite-state.ts,plugin/scripts/suite-state-trigger.ts
```

**Linked claim records** under that `subject_key`: `hypothesis-3b939aa26ed9f20b` (*"The SuiteState union and the .quay/full-suite-state.json carrier are declared/written/parsed by multiple components with independently stated value unions …"*) and `counterexample-3b994434bf0cabbd` (*"full-suite-runner-types.ts:17-19 explicitly documents that suite-state-trigger.ts keeps its OWN SuiteState/SuiteStateValue/SuiteStateReason as a deliberately separate family ('Never merge the two') …"*).

### V4 — `non-substantive-verdict-triage@9` × `HX-neg-cpu-stall-readers-different-source`

Verdict: predicted `supported`, expected `refuted`, `correct:false`, `temporal_ok:null` (a negative case binds no `fix_commit`, so the temporal gate was never reached — its own value, not `false`). Same seed Experience as V1.

### Control for each hypothesis

**H-induction — control: the same overlap predicate applied to (C1) the joined representation and (C2) the induced method's own text.** If the shipped text already carried the claim, C1 would equal C0; if the method had been induced *from* the claim, C2 would be high. Reading (content tokens, with the subject's own file tokens subtracted — positional, derived from the same `subject_key`):

```
join coverage: 20/121 outcomes have a linked HYPOTHESIS (16.5%); 61/121 have a hypothesis OR a counterexample (50.4%)
V1  C0 claim→SHIPPED summary = 0.000 | C1 claim→JOINED = 1.000 | C2 claim→candidate METHOD text = 0.034 | C3 positive control (claim vs itself) = 1.000
V2  C0 = 0.000 | C1 = 1.000 | C2 = 0.111 | C3 = 1.000
V4  C0 = 0.000 | C1 = 1.000 | C2 = 0.034 | C3 = 1.000
```

C3 = 1.000 on every row is the non-zero control: the predicate *can* return 1.0, so the three zeros are real zeros. **Verdict: SUPPORTED.**

**H-applicability — control: the same predicate against the candidate's own seed.** The required record fields are read **by position** off each candidate's own `domain_signals` (a verdict token, an aggregate subject key, an evidence pointer):

```
V1: fields = ["verdict","subject_key","evidence_pointer"]   held-out satisfies 0/3   the candidate's OWN seed satisfies 2/3
V2: fields = ["verdict","subject_key"]                      held-out satisfies 0/2   the candidate's OWN seed satisfies 2/2
V4: fields = ["verdict","subject_key","evidence_pointer"]   held-out satisfies 0/3   the candidate's OWN seed satisfies 2/3
```

The seed fires, so the predicate is not constant-false. **And the obvious alternative predicate is explicitly NOT the discriminator**: V2's seed set *does* share `full-suite-runner.ts` with its held-out (`shared components seed∩held-out = ["plugin/scripts/full-suite-runner.ts"]`) — which is exactly why a component-overlap test cannot replace an applicability gate, and why the gate is asked as a question rather than computed from the file lists. **Verdict: SUPPORTED.**

**H-verifier — reading: the regression run's own per-call output (`dm-regression/ev/stage3.json`).**

```
non-substantive-verdict-triage@8 × HX-needs-human-transition-three-copies        : subtype=success         num_turns=9  (cap 14)
composite-subject-verdict-decomposition@1 × HX-scope-memorymax-…                : subtype=success         num_turns=20 (cap 14)
carrier-persistence-check@3 × HX-reflog-empty-action-producer-vs-classifier     : subtype=error_max_turns num_turns=15 (cap 14)  → outcome=not-evaluated
non-substantive-verdict-triage@8 × HX-neg-cpu-stall-readers-different-source    : subtype=success         num_turns=15 (cap 14)
```

One call terminated **on the turn budget**, and another consumed 20 turns against a cap of 14. **Verdict: SUPPORTED — for the failed-READING half only.** The mis-read half is left `undetermined` (no stored reasoning), and no fix rests on it.

**H-scoring — control: the labels' own citations, read at the pin.** The prediction table *alone* cannot separate the two hypotheses: the observed predictions are uniformly opposite to the expected, so a global inversion would make **all three** pairings correct. The separation comes from the CODE —

```
CODE AT PIN — HX-needs-human-transition-three-copies (7/7 citations resolve verbatim at f2432d178)
  MATCH plugin/scripts/worker-driver.ts:5035  "            retryState.needsHuman.add(r.taskId);"
  MATCH plugin/scripts/worker-driver.ts:5097  "      retryState.needsHuman.add(r.taskId);"
  MATCH plugin/scripts/worker-driver.ts:5104  "      markNeedsHuman("
  MATCH plugin/scripts/driver-filters.ts:250  "      state.needsHuman.add(id);"
  MATCH plugin/scripts/driver-filters.ts:872  export type NeedsHumanKind = "retry-cap" | "stop-terminal" | "other";
  MATCH plugin/scripts/driver-filters.ts:899  export function markNeedsHuman(root: string, id: string, reason: string, kind: NeedsHumanKind = "retry-cap"): …
CODE AT PIN — HX-neg-cpu-stall-readers-different-source (3/3 resolve)
  MATCH plugin/scripts/suite-load-sampler.ts:60  " * A third same-named reader (cap-from-gate.ts `readCpuStallFromGate`) is deliberately NOT unified: it"
CODE AT PIN — HX-scope-memorymax-literal-vs-host-derived (3/3 resolve)
  MATCH plugin/scripts/driver-runtime.ts:1427  "// ⛔ 为什么 MemoryMax 必须**宿主推导**而不是写死一个 `16G` 类字面量（CLAUDE.md 硬规则 4 推论二）："
  MATCH plugin/scripts/full-suite-runner.ts:994  '  memoryMax: "16G",'
```

All 13 citations resolve at the pin, so each expected verdict is true there independently of the mapping. The mapping is therefore not inverted and the verifier's answers are simply wrong — a *method* failure, not a *label* failure. **Verdict: REFUTED; no fix.**

## Acceptance Criteria
- [x] Diagnosis, real: for V1, V2 and V4, paste the candidate record, the seed Experiences' summaries, the verdict record, and the control for each hypothesis with its verdict. Name which step(s) failed. No fix may be justified by a hypothesis the diagnosis left `undetermined` or `refuted`.
- [x] `node --test plugin/test/discovery-reflection.test.mjs plugin/test/discovery-experience-ledger.test.mjs` exits 0, with new cases for each fix actually made:
  - (a) a joined Experience carries the hypothesis statement, and its seed basenames are still barred from method text;
  - (b) `applies:no` ⇒ `not-applicable`, neither correct nor retired;
  - (c) learning quality excludes not-applicable from the denominator and reports its count.
- [x] Static: no held-out or seed case id or component basename appears in production code. Paste the `grep` over the changed `docs/analysis/discovery-*.mjs` files.
- [x] New holdout: paste the labeler's case list (ids, files, pin, fix commits, roles), the exclusion check against all earlier holdouts and seeds, and the sealed sha256. The pre-registration file's mtime must be older than the first model call of the retest.
- [x] Retest, real: paste each candidate × holdout result — applies, predicted, expected, correct, promoted — plus correct / applicable-evaluated, the not-applicable count, and `activeMethods()` after the run. Report honestly if it is 0/N.
- [x] Cost: model calls; input, output and cache_read tokens; wall ms; the CLI `cost_usd`; and the recomputation at the gateway rates from `GET http://127.0.0.1:26510/model_group/info`.
- [x] Mutation control: remove the applicability gate and show case (b) goes red. Paste, then revert.

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

## Evidence

**Artifacts** (all under `/data/home/yale/work/quay-scratch/`): `dm-retest2/{diagnosis.mjs,stage1-join.mjs,stage2-reflect.mjs,stage3-generalize.mjs,stage4-cost.mjs,ac3-static-grep.mjs,ac7-mutation-control.mjs,verify-holdout2.mjs,seal-holdout2.mjs,report.mjs}` → `dm-retest2/ev/*.{json,txt,log}`; the full AC-by-AC dump is `dm-retest2/EVIDENCE.md` (`report.mjs`), caveats in `dm-retest2/CAVEATS.md`. The holdout lives in `dm-holdout2/`.

### AC1 — diagnosis

See the **Diagnosis** section above: for V1, V2 and V4 it pastes the candidate record, the seed Experiences' shipped summaries, the linked claim records, the verdict record, and for each hypothesis the control with its verdict. Three hypotheses SUPPORTED, one REFUTED. Verifier reasoning: **not stored anywhere** (the carrier has no `reasoning` field), which is why H-verifier is supported only for its failed-READING half.

### AC2 — `node --test plugin/test/discovery-reflection.test.mjs plugin/test/discovery-experience-ledger.test.mjs`

```
ℹ tests 86
ℹ suites 0
ℹ pass 86
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1530.448612
EXIT=0
```

New cases, one group per fix actually made: `JOIN(a)`–`JOIN(d)` (the joined Experience carries the hypothesis statement; the join is THREE-VALUED; coverage is reported; the join keys on `subject_key` exactly) and `FIX(a)`/`FIX(b)`/`FIX(c)`/`FIX(c-evidence-pack)` (the prompt carries `domain_claim`; *the joined claim does not unbar the seed's files — the strip still runs*; `applies:"no"` ⇒ `not-applicable`, neither correct nor retired, with the `applies:"yes"` and missing-`applies` controls; learning quality excludes not-applicable and reports its count; the evidence pack reaches the verifier prompt and `null` is its own value). No fix was justified by a refuted hypothesis, so no case exists for one.

### AC3 — static: no held-out or seed case id / component basename in the changed production files

```
changed files: docs/analysis/discovery-reflection.mjs, docs/analysis/discovery-experience-ledger.mjs
derived token set: 20 holdout case ids + 23 seed component basenames (derived, not hand-written)

readings:
  full token set hits                     : 6
  in-scope plugin/scripts component hits  : 2   (both PRE-EXISTING on develop: discovery-experience-ledger.mjs:158,161 per-task-suite-record.ts)
  holdout case id hits                    : 0
  hits INTRODUCED by this change          : 0
  neighbour-module hits (imports + header): 4   (a module naming the file it imports is not "being told the answer")

non-zero control on the SAME predicate, against the carrier the tokens were derived FROM:
  cap-counts-subagents-check.ts, cap-from-gate.ts, concurrent-batch-scheduler.ts, discovery-experience-ledger.mjs, discovery-method-registry.mjs, full-suite-runner-types.ts
```

The grep, as run:

```
grep -n -F -e <20 derived holdout ids> -e <23 derived seed basenames> docs/analysis/discovery-reflection.mjs   -> 4 hit(s), all neighbour-module names
grep -n -F -e <20 derived holdout ids> -e <23 derived seed basenames> docs/analysis/discovery-experience-ledger.mjs -> 2 hit(s), both pre-existing
```

### AC4 — the new sealed holdout

Pin **`3737372660f2e2e0f982e0cdc0013ee1fce45866`** (`3737372`, 2026-10-11T19:39:46+08:00) — a real develop commit, chosen before the fixes it holds out; every case's fix descends from it and every citation resolves at it. Built by an independent labeler (a fresh agent given only the procedure, the exclusion file, and the pin; the brief forbids it the discovery carriers and every method record).

The labeler's case list (id, role, files, fix commit, verified citations):

| id | role | files | fix | cites |
|---|---|---|---|---|
| `HX2-fan-in-lock-hold-key` | holdout-H | fan-in-ff-protocol-check.ts, fan-in-queueing-model.ts | 4619e71ee051c819f3181963d1999ed850152713 | 7 |
| `HX2-per-task-suite-record-required-fields` | holdout-F | per-task-suite-record.ts, per-task-suite-record-check.ts | adf2a7b65711096302c4d2629f54ce1f164300d3 | 4 |
| `HX2-doc-check-cache-vs-scoped-gate-cache` | holdout-F | doc-check-cache.ts, worker-fan-in.ts | b6364e7755316ad71db40520cf91dc6cdec88f71 | 8 |
| `HX2-isDirectInvocation-pair` | holdout-F | config-wiring-check.ts, drivable-workspace-check.ts | 2694958ecc0f9dbd19d19902b4363e3ed3b342e1 | 4 |
| `HX2-splitArgs-isNonNegInt-trio` | holdout-F | driver-runtime.ts, quality-gate-driver.ts, suite-driver.ts | c65d439b336ceb38d7919af0ef600fb9f8447c7b | 9 |
| `HX2-ac69-exit3-nonfatal` | holdout-H | ac69-slot-queue-gap-check.ts, runner-static-gate.ts | 69e720d4634b61b322ac04d259a8216215ee5444 | 8 |
| `HX2-NEG-runner-concurrency-twin` | holdout-negative | runner-concurrency.ts, full-suite-runner.ts | (none — negative) | 9 |
| `HX2-NEG-shell-walk-skipset` | holdout-negative | fs-walk.ts, adr016-screen-use-check.ts, dead-code-after-return-check.ts | (none — negative) | 17 |
| `HX2-NEG-meta-driver-quality-gate` | holdout-negative | meta-driver.ts, routine-file-gate.ts | (none — negative) | 9 |

**Exclusion check.** `dm-holdout2/excluded-component-pairs.json` derives the forbidden set from (1) all 11 dt1 labelled cases and (2) the registry's seed provenance closure: 101 component pairs over 44 components. Every unordered pair of every case's components was tested against it — **0 hits**. The labeler's own report (pin, counts, exclusion check) and its auditable dropped-candidates table for all 20 tasks examined are in `dm-holdout2/labels-draft2.md`; the counts were **6 positives / 3 negatives** against a 4 / 2 target.

Independently re-verified by the caller (`verify-holdout2.mjs`, no model calls):

```
pin is a real commit and on develop     : true / true
cases                                   : 9  (positives 6 >= 4, negatives 3 >= 2)
citations resolving verbatim at the pin : 75/75
excluded component pairs checked        : 13, hits 0
every fix descends from the pin         : true
every fix touches a named component     : true
all checks pass                         : true
```

Sealed: `dm-holdout2/labels-dt2-sealed.json` (mode 400), sha256 **`2e041979117b71d00b637cea8d074358e901e50435ee0dc131e1724c39d0959d`**. Pre-registered: `dm-holdout2/prereg.json`.

**mtime ordering:** prereg mtime `2026-10-12T11:53:56.538Z` < reflection's first model call `2026-10-12T11:54:00.023Z` and < the verifier's first call `2026-10-12T11:56:32.500Z` ⇒ the pre-registration predates BOTH. PASS.

### AC5 — the retest

One bounded reflection round over the improved representation — the two seed Experiences that produced V1/V2/V4, re-derived through the join (budget `{maxPerRun:8, maxModelCalls:8}`, actual 2 calls, 42035 ms). **Both decisions changed character**: the seed that produced the bookkeeping method `non-substantive-verdict-triage@8` now yields `new multi-writer-guard-equivalence`, and the seed that produced `composite-subject-verdict-decomposition@1` now yields `extends shared-contract-divergence`.

```
selection: units_in_joined_ledger=2 selected=2 skipped_prior=0 skipped_cap=0
decisions: extends -> shared-contract-divergence (case_ids ["EXP-a479b76da38cd895"])  |  new -> multi-writer-guard-equivalence (case_ids ["EXP-a7c84fa7c2bc1cb4"])
join coverage over the whole store (stage 1): linked=61 no_linked_claim_record=55 total=116 (52.6%)
```

Candidate × holdout — every pairing:

| candidate | held-out | label role | outcome | applies | predicted | expected | correct | promoted |
|---|---|---|---|---|---|---|---|---|
| shared-contract-divergence@3 | HX2-fan-in-lock-hold-key | holdout-H | not-applicable | no | – | ["supported"] | – | false |
| shared-contract-divergence@3 | HX2-per-task-suite-record-required-fields | holdout-F | not-applicable | no | – | ["supported"] | – | false |
| shared-contract-divergence@3 | HX2-doc-check-cache-vs-scoped-gate-cache | holdout-F | not-applicable | no | – | ["supported"] | – | false |
| shared-contract-divergence@3 | HX2-isDirectInvocation-pair | holdout-F | not-applicable | no | – | ["supported"] | – | false |
| shared-contract-divergence@3 | HX2-splitArgs-isNonNegInt-trio | holdout-F | not-applicable | no | – | ["supported"] | – | false |
| shared-contract-divergence@3 | HX2-ac69-exit3-nonfatal | holdout-H | evaluated | yes | supported | ["supported"] | **true** | **true** |
| shared-contract-divergence@4 | HX2-NEG-runner-concurrency-twin | holdout-negative | evaluated | yes | refuted | ["refuted"] | **true** | **true** |
| shared-contract-divergence@5 | HX2-NEG-shell-walk-skipset | holdout-negative | evaluated | yes | refuted | ["refuted"] | **true** | **true** |
| shared-contract-divergence@6 | HX2-NEG-meta-driver-quality-gate | holdout-negative | not-evaluated | undetermined | – | ["refuted"] | – | false |
| multi-writer-guard-equivalence@1 | HX2-fan-in-lock-hold-key | holdout-H | not-applicable | no | – | ["supported"] | – | false |
| multi-writer-guard-equivalence@1 | HX2-per-task-suite-record-required-fields | holdout-F | not-applicable | no | – | ["supported"] | – | false |
| multi-writer-guard-equivalence@1 | HX2-doc-check-cache-vs-scoped-gate-cache | holdout-F | evaluated | yes | supported | ["supported"] | **true** | **true** |
| multi-writer-guard-equivalence@2 | HX2-isDirectInvocation-pair | holdout-F | not-applicable | no | – | ["supported"] | – | false |
| multi-writer-guard-equivalence@2 | HX2-splitArgs-isNonNegInt-trio | holdout-F | not-applicable | no | – | ["supported"] | – | false |
| multi-writer-guard-equivalence@2 | HX2-ac69-exit3-nonfatal | holdout-H | not-applicable | no | – | ["supported"] | – | false |
| multi-writer-guard-equivalence@2 | HX2-NEG-runner-concurrency-twin | holdout-negative | not-applicable | no | – | ["refuted"] | – | false |
| multi-writer-guard-equivalence@2 | HX2-NEG-shell-walk-skipset | holdout-negative | not-applicable | no | – | ["refuted"] | – | false |
| multi-writer-guard-equivalence@2 | HX2-NEG-meta-driver-quality-gate | holdout-negative | not-applicable | no | – | ["refuted"] | – | false |

`applies_reason` for every row, and the full verdict objects (lineage/temporal gates, evaluated commit, evidence-pack size, per-call tokens), are in `ev/stage3.json`. The gate's most load-bearing diversion reads: *"The method keys on two-or-more INDEPENDENT, DIVERGING declaration sites of one semantic contract … the only co-declarations that DO exist inside the target are identical copies, not divergences … A duplicated-but-identical contract is precisely the case where there is no set-difference to classify"*.

**learning quality** (correct / applicable-evaluated, with the not-applicable count):

```json
{"value": 1, "correct": 4, "evaluated": 4, "denominator": 4, "not_evaluated": 1, "not_applicable": 13, "total": 18}
```

**`activeMethods()` after the run**:

```json
["multi-writer-guard-equivalence@2", "shared-contract-divergence@6"]
```

registry before → after:

```
before: ["carrier-persistence-check@1:draft","Shared-contract-divergence@1:draft", …, "non-substantive-verdict-triage@9:retired", "composite-subject-verdict-decomposition@2:retired"]
after : ["carrier-persistence-check@3:draft","composite-subject-verdict-decomposition@2:retired","multi-writer-guard-equivalence@2:active","non-substantive-verdict-triage@9:retired","shared-contract-divergence@6:active"]
```

Honest report: it is **4 of 4** among the applicable-evaluated pairings (not 0/N), with 13 of 18 diverted by the gate and 1 left `not-evaluated` — and that last one **failed on the very resource bound fix (c) targets** (`error_max_turns`, 15 turns at the unchanged cap of 14, with a 1-line evidence pack). See caveat 3.

### AC6 — cost

```json
{"model_calls": 20,
 "stages": {"stage1_read_only_model_calls": 0, "stage2_reflect_model_calls": 2, "stage3_verify_model_calls": 18},
 "tokens": {"input": 930892, "output": 259216, "cache_read": 6252800, "cache_creation": 0},
 "wall_ms": {"reflect": 42035, "verify_sum": 1608246},
 "cli_cost_usd": 14.26126,
 "gateway": {"url": "http://127.0.0.1:26510/model_group/info", "model_group": "v4.1flash-anthropic",
   "rate": {"input_cost_per_token": 3e-7, "output_cost_per_token": 1.2e-6, "cache_read_input_token_cost": null, "cache_creation_input_token_cost": null}},
 "recomputed_cost_usd": 0.590327,
 "recomputed_breakdown": {"input": 0.2792676, "output": 0.3110592, "cache_read": null, "cache_creation": null},
 "delta_usd": 13.670933}
```

The CLI's `cost_usd` is the launcher's own record; the recomputation uses the gateway's published per-token rates on the **same** usage counters. The gateway publishes **no** cache-token rate, so the recomputation covers input+output only — and the decisive control shows the delta is not a cache artifact: on a call with zero cache traffic (`multi-writer-guard-equivalence`, reflect, 6523 in / 2558 out) the CLI charged `$0.096565` against a gateway-rate `$0.005026`, a **19.2×** ratio. The two surfaces are different rate cards; both numbers are reported and neither is smoothed away.

### AC7 — mutation control

```
mutation: if (applies === "no") {   ->   if (false) {   // ⛔ MUTATION: the applicability gate has been removed
effect  : the divert branch is unreachable, so a method that does NOT cover the case is graded anyway (the pre-fix behaviour)
test    : node --test --test-name-pattern 'FIX\(b\)' plugin/test/discovery-reflection.test.mjs

before mutation: GREEN
after  mutation: RED
reverted byte-identical: true
git diff after revert : (clean)
control_passes: true
```

The red, verbatim:

```
✖ FIX(b): `applies:"no"` ⇒ `not-applicable` — neither correct, nor promoted, nor retired
  AssertionError [ERR_ASSERTION]:
    actual: 'evaluated'
    expected: 'not-applicable'
    operator: 'strictEqual'
✖ FIX(b): a `not-applicable` verdict is RECORDED (the diversion is countable) and cannot license a promotion
  AssertionError [ERR_ASSERTION]: the diversion is recorded, so a third party can recount it
    actual: undefined
    expected: true
```

## Caveats, honest limits, and observations

**1. The labeler flagged one positive as possibly contaminated; the sealed set was NOT edited.** `HX2-per-task-suite-record-required-fields` — the task's own `## Proposal` states it was found by the pre-registered blind A/B run `E-HYPGEN-AB-1` (arm B, verifier cluster c8), i.e. by the same experiment family the method under retest descends from. It passes the brief's mechanical criterion, but the flag is real. ⛔ The sealed file was left untouched — editing a sealed holdout after seeing results is what pre-registration exists to prevent. **In this run it changed nothing**: `shared-contract-divergence@3` answered `applies:no` on it, so it was never graded.

**2. The exclusion rule implemented is the one the Plan states — and it is NOT dt1's whole rule.** `excluded-component-pairs.json` derives dt1's 11 labelled cases ∪ the registry's seed provenance closure (101 pairs / 44 components). dt1 ALSO dropped whole task PREFIXES (`gap-hypgen-*`, `gap-routine-semantic-dedup-scan-*`, …) for a different experiment's reasons; that rule is not inherited. The difference is visible in `HX2-NEG-shell-walk-skipset`, whose components sat inside one of those prefixes but are in neither the holdout nor the seed component sets.

**3. Fix (c) is a partial mitigation, not a fix — and this run shows it.** `shared-contract-divergence@6 × HX2-NEG-meta-driver-quality-gate` terminated on the turn budget (`error_max_turns`, 15 turns at the SAME cap of 14 the failing run used) with a **1-line** evidence pack. The pack removes budget pressure only where the cited symbols and imports actually resolve.

**4. The CLI's `cost_usd` and the gateway's published rates are different rate cards** (see AC6's zero-cache control: 19.2×). The delta is not a cache-token artifact and dividing it by `cache_read` would be a false attribution.

**5. Observation, NOT a fix (硬规则 12 — no new precondition without a measured rate).** `checkLineageIsolation` resolves a candidate's provenance to a seed Experience by EXPERIENCE id only. `shared-contract-divergence@1`'s `provenance_evidence` names a RAW OUTCOME id (`outcome-bb12a6858838e74b`), which resolves to no seed, so that lineage's shared-component arm had nothing to compare against. Every pairing in this run returned `lineage_ok=true`; whether that is correct for the one holdout case that shares components with that outcome is **not established here**. Counted, not acted on: the diagnosis did not test a hypothesis about it, and no fix may be justified by an untested hypothesis.
