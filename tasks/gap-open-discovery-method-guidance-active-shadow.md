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
- [x] Unit tests exit 0, covering:
  - (a) 0 active ⇒ baseline round runs;
  - (b) an active method ⇒ guided production round, ids recorded;
  - (c) a draft or trial method ⇒ shadow arm only, records `shadow:true`, nothing reaches Portfolio;
  - (d) a retired, quarantined or contaminated method ⇒ never selected, even when it is the only one;
  - (e) guidance text containing a seed component ⇒ excluded with reason;
  - (f) shadow calls reserve against the same 24h ledger;
  - (g) a guided round's outcome is ingested as an Experience naming the method id and version.

  In the task worktree, after `merge develop` (`1fa375315`):
  ```
  $ node --no-warnings --experimental-strip-types --test plugin/test/open-semantic-discovery-routine.test.mjs
  ℹ tests 63
  ℹ pass 63
  ℹ fail 0
  ```
  The cases print their own per-criterion reading:
  ```
      AC (a): mode=baseline evaluated=0 reason="no-method-recorded:the-registry-holds-0-record(s)-so-the-production-arm-runs-baseline"
      AC (b): mode=guided included=["fixture-active@v1"]
      AC (c) [draft]: mode=baseline shadow.ran=true shadow clusters=2 portfolio rows=0
      AC (c) [trial]: mode=baseline shadow.ran=true shadow clusters=2 portfolio rows=0
      AC (d): retired, quarantined-lineage and contaminated methods each excluded as the only record; the round still ran baseline
      AC (e): excluded leaky ⇒ GUIDANCE_TEXT_NAMES_SEED:component:plugin/scripts/secret-fixture.ts
      AC (f): reservations in .quay/open-semantic-discovery-model-budget.jsonl = investigator,shadow-investigator
      AC (g): 2 Experience(s) and 2 Portfolio row(s) name fixture-active@v1
  ```
  What each case actually asserts (not just that it ran):
  - (a) `fact.state === "verified"` and the spawn count > 0 (a baseline round still spawns), `methods.mode === "baseline"`, `included === []`, and the investigator prompt carries NO guidance block. A second case: a registry whose only record is excluded ⇒ `no-eligible-method` baseline.
  - (b) `methods.included === [{method_id:"fixture-active", version:1, status:"active", arm:"production"}]`, the guidance block IS in the production investigator prompt (method label + its own step text) while the engine's frozen instruction is still there, and the cluster record carries `method_guidance.arm === "production"`.
  - (c) for BOTH `draft` and `trial`: production mode stays `baseline` and its prompt has no guidance; the shadow arm runs (its own runs dir, the SAME pin), its records carry `shadow:true` + `record_id` with `#shadow#` + `confirmed:false`; the Portfolio and the Experience ledger are BOTH empty and no record anywhere names a `#shadow#` id.
  - (d) three fixtures, each the ONLY record: `retired` ⇒ `RETIRED`; a `draft` that `supersedes` a QUARANTINEd version ⇒ `QUARANTINED_LINEAGE`; an `active` method whose `generalization_evidence.verdict_ref` is on `discovery-contaminated-verdicts.jsonl` ⇒ `CONTAMINATED_PROMOTION`. Plus a round-level case: the round still RUNS (baseline) and no shadow arm is run.
  - (e) a method whose `operation.steps` name a component of an Experience it does NOT cite is excluded with `GUIDANCE_TEXT_NAMES_SEED:component:plugin/scripts/secret-fixture.ts` — while the clean method beside it is still selected (a per-record judgment, not a kill switch), and the ledger's own deny-list is shown to flag that very text directly.
  - (f) `resumeSteps === ["investigator","shadow-investigator"]` in `.quay/open-semantic-discovery-model-budget.jsonl` (the SAME ledger the round reports), one spawn per reservation, the shadow reservation carries its tools + `--max-turns`, and the shadow call is counted in the round's own `model_calls`.
  - (g) every Experience written by the guided round carries `guided by method fixture-active@v1` in its summary, its `source_ref` is a production record, and the matching Portfolio rows carry `method_ref === "fixture-active@v1"`.

- [x] Negative control: make selection ignore the quarantine list in a scratch copy ⇒ (d) goes red. Paste the output.

  The mutation replaces the lineage walk's answer with a constant (`const q = { quarantined: false, versions: [], reasons: [] };`) in a scratch copy of the module; the fixture is `quarantined-ancestor` v1 (`retirement_reason` starting `QUARANTINE`) with a v2 `draft` that supersedes it.
  ```
      NEGATIVE CONTROL (d): mutant SELECTED quarantined-ancestor@v2 for the shadow arm (claim was «never selected, even as the only record»); the real module excluded it via QUARANTINED_LINEAGE:quarantined-ancestor-carries-a-QUARANTINE-retirement-reason-on-v1
  ```
  The same test first asserts the REAL module's answer on that fixture (`included === []`, excluded with `QUARANTINED_LINEAGE`), so the mutant's `included===[[quarantined-ancestor, shadow]]` is a genuine falsification of the (d) claim, not a different fixture.

- [x] Real registry reading: run selection against the production registry and paste included and excluded ids with reasons. Expected today: 0 active ⇒ baseline; both quarantined methods excluded.

  `selectMethodsForRound("/data/home/yale/work/quay", loadOpenDiscoveryModules("/data/home/yale/work/quay"))` — the production registry has 5 distinct methods, 0 active:
  ```
   ok=true mode=baseline evaluated=5
   baseline_reason: no-active-method:0-of-5-record(s)-is-active(only 1 draft/trial ⇒ shadow arm only),4 excluded-so-the-production-arm-runs-baseline
   registry: {"file":"/data/home/yale/work/quay/.quay/discovery-method-registry.jsonl","malformed_lines":0,"active_ids":[],"active_evaluated":5,"excluded_contaminated":[],"contaminated_verdicts_evaluated":17}
   INCLUDED carrier-persistence-check@v3 [shadow] guidance_chars=1279
   EXCLUDED composite-subject-verdict-decomposition@v2 (retired) ⇒ RETIRED:composite-subject-verdict-decomposition@v2-is-retired-so-it-never-guides-a-round
   EXCLUDED multi-writer-guard-equivalence@v3 (retired) ⇒ QUARANTINED_LINEAGE:multi-writer-guard-equivalence-carries-a-QUARANTINE-retirement-reason-on-v3; RETIRED:multi-writer-guard-equivalence@v3-is-retired-so-it-never-guides-a-round
   EXCLUDED non-substantive-verdict-triage@v9 (retired) ⇒ RETIRED:non-substantive-verdict-triage@v9-is-retired-so-it-never-guides-a-round
   EXCLUDED shared-contract-divergence@v7 (retired) ⇒ QUARANTINED_LINEAGE:shared-contract-divergence-carries-a-QUARANTINE-retirement-reason-on-v7; RETIRED:shared-contract-divergence@v7-is-retired-so-it-never-guides-a-round
  ```
  Matches the expectation: 0 active ⇒ the production arm runs BASELINE, and BOTH quarantined methods (`shared-contract-divergence`, `multi-writer-guard-equivalence`) are excluded with the quarantine named. The one `draft` (`carrier-persistence-check@v3`) is selected for the SHADOW arm only — the Plan's "draft ⇒ shadow only" reading on real data. The suite's version of this reading asserts invariants (only `active` may guide production; every quarantined method's refusal shows it) rather than the literal "0 active", because pinning a live registry would red the suite the day a method is promoted.

- [ ] Production reading: the first resident round after landing — paste its method-selection record. （待外部）

## Definition of Done
- All AC ticked with output pasted (production AC may stay （待外部）).
- `scripts/test.sh --for-task gap-open-discovery-method-guidance-active-shadow` green.

  ```
  $ bash scripts/test.sh --for-task gap-open-discovery-method-guidance-active-shadow --allow-thin
  ℹ tests 102
  ℹ pass 102
  ℹ fail 0
  ```
  (static checks in the same run: all PASS — test-isolation, no-checked-in-tree-writes, suite-slot SSoT, scene/identity literals, concurrency literals.)

## Touches
- tasks/gap-open-discovery-method-guidance-active-shadow.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/test/open-semantic-discovery-routine.test.mjs
- docs/analysis/discovery-method-registry.mjs
- plugin/scripts/quality-gate-driver.ts

### Why `quality-gate-driver.ts` is a Touches addition
A routine MODULE is not in `driver-runtime.watchedSourceFiles` (that list is the driver entry plus the shared kernel files), so a delta confined to `open-semantic-discovery-routine.ts` lands **INERT** in the resident quality driver — the file itself says so, in the comment above `formatOpenSemanticDiscoveryAssembly`. The assembly line is the reload's own evidence, so it now names the method-guidance policy the loaded module carries (`active ⇒ 生产轮 guidance / draft|trial ⇒ shadow 臂 / retired|quarantined|contaminated ⇒ 永不选取 / 无 ⇒ baseline`). Without this touch the mechanism would exist on `develop` while production kept running the old prompt policy — the (d)/(b) behaviour would be unobservable in the round record the （待外部） AC asks for.
