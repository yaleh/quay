---
id: gap-discovery-method-reflection-unified-trigger-and-candidate-generation
title: "Discovery Method: unified reflection trigger + candidate generation,
  verified end-to-end on real self-discovered cases (Phase 2)"
status: todo
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-discovery-teaching-case-ledger-feedback-ingestion
---
## Proposal
Phase 2 of the self-bootstrapping Discovery Method loop, and the first one that actually learns. It consumes the Experience ledger (previous task, both `reported_by:"user"` and `reported_by:"system"` entries, with NO special-casing by source) and produces `DiscoveryMethod` candidates in the Phase-0 registry.

**Explicitly what this is not**: not a new scheduler (it is a bounded pure function + a thin CLI entry, called manually or by a test in this task; wiring it into the existing routine track for continuous shadow execution is a follow-on task, after this one's output shape is proven real — the same sequencing already used for `arch-discovery-routine.ts`, which only existed after its two instruments landed and were hand-verified). Not a Meta-Meta Driver — `meta-driver.ts` is untouched by this task; it only ever consumes DiscoveryMethod evidence later, as a `driveItems` source, which is also a follow-on task.

**The one hard requirement that makes this different from everything built in this experiment line so far**: the reflection step must not be told, and must not be hand-coded to look for, any specific symbol, file pair, or invariant class from the seed material. Four real, already-landed self-discoveries are the ONLY seed input for this task's end-to-end verification, three positive and one negative:
- fan-in lock-hold pairing (`E-DT-1-Hp cluster 11`, fixed) — positive
- per-task-suite-record `REQUIRED_FIELDS` (`E-HYPGEN-AB-1-B cluster 8`, fixed) — positive
- C5 checker exit-code split (`E-HYPGEN-ACCEPT-1 cluster 5`, fixed) — positive
- C7 Touches-parser shared-reader (`E-HYPGEN-ACCEPT-1 cluster 7`, refuted) — negative; a correct reflection pipeline must NOT promote a method from this one, or must record it strictly as a counterexample/falsification source for some OTHER candidate's falsification field, never as its own standalone "divergence" method.

A static control enforces the "no hand-coded symbol rule": the production code of this task's reflection module must contain zero literal occurrences of `probe-routine`, `meta-driver`, `checker-io`, `fan-in-ff-protocol-check`, `fan-in-queueing-model`, `per-task-suite-record`, `touches-parser`, outside of test fixtures. A reflection pipeline that only works because it was quietly told where to look is not a method — it is this task's own authors re-doing what the original discovery already did.

## Plan
1. New module `docs/analysis/discovery-reflection.mjs`.
2. `selectExperiencesForReflection(ledger, registry, { maxPerRun, dedupWindow })` — PURE. Groups ledger entries by `subject_key`-style signature (reuse `subjectKey` from the evidence store, do not re-derive it); drops entries whose signature was already reflected-on in a PRIOR reflection-attempt record (dedup, never re-spends a model call on the same signature); caps the batch at `maxPerRun`; returns the selected batch PLUS the skipped-as-duplicate count (reported, not silent).
3. `reflect({ experiences, registry, model, budget })` — the one model-calling step. Input to the model is: the experience's `summary`, `components`, `role`, and the FULL current method registry (so the model can decide extend/compose/replace vs new — it must actually read the registry, not propose blind). The input NEVER includes which file pair the user or a prior round already named as "the answer" for a DIFFERENT experience in the same batch — each experience's own `components`/`summary` is fair game (that's the finding itself), but cross-experience leakage (e.g. the model being shown "this looks like case X, go find something like it") is what the no-hand-coding rule above forecloses at the CODE level; this point forecloses it at the PROMPT level.
   Output per experience (or per dedup-merged group): `{decision: "new" | "extends" | "composes" | "no-method", method_ref: string|null, candidate: DiscoveryMethod|null, why_proposed, evidence_pattern, transferable_operation, applicability_boundary, counterexample}`. A `candidate` always has `status:"draft"` — this function never writes `status:"active"`.
   Reuses the ALREADY-FIXED model-identity/cost machinery from `docs/analysis/arch-hypothesis-generation.mjs` (`modelCallFields`, stream-json parsing) by import — does not re-implement model/cost recording from scratch (hard rule 5b: the same defect class — a client guessing its own cost — was already fixed once this session; a second hand-rolled copy here would reintroduce it).
4. `validateGeneralization({ candidate, heldOutCase })` — the cross-case test. `heldOutCase` is an Experience NOT in the batch that produced `candidate`. Runs the candidate's `operation.steps` (as a bounded verifier call, same `--tools Read,Grep` / turn-budget discipline as the existing verifier) against the held-out case's `components`, and reports whether the candidate's `expected_invariant` correctly predicts that case's known `role`. A candidate promotes `status:"draft"→"active"` ONLY if this returns a correct prediction; failing it is recorded (`status` stays `draft`, or moves to `retired` with `retirement_reason` if it fails outright) — never silently dropped.
5. Budget/kill-switch, enforced IN THIS MODULE (not deferred to the later routine-wiring task): `maxPerRun`, `maxModelCalls`, `maxWallMs`, and an `enabled` flag that, when false, makes every exported entry point return `{ok:false, reason:"disabled"}` with zero model calls — same contract shape as `arch-discovery-routine.ts`'s config gate, reused by convention, not by import (this module has no driver dependency).
6. Metrics this task must RECORD (not fully resolve — some require Phase 4's continuous run data, not yet available):
   - `learning_quality`: of the candidates that reached a `validateGeneralization` call in this task's own verification run, the fraction correctly predicting the held-out case's role. Recorded as a real number from the real run below — not asserted.
   - `net_new_discovery_value`: defined now, explicitly left unmeasured — record it as `not-yet-measured` (never `0`, which would look like "measured and found nothing," violating 硬规则 3b). It requires an ACTIVE method finding something in production outside its own seed provenance, which only exists after a follow-on routine-wiring task runs.
   - `reflection_cost`: total model calls actually made, tokens, wall time for this task's real verification run below.

## Acceptance Criteria
- [ ] `node --test plugin/test/discovery-reflection.test.mjs` exits 0 (stub model for unit tests), covering:
  - (a) `selectExperiencesForReflection` dedups two experiences with the same `subjectKey` signature into one reflection unit, and reports the dedup count;
  - (b) `enabled:false` makes `reflect` return `{ok:false,reason:"disabled"}` with zero model calls;
  - (c) exceeding `maxModelCalls` mid-batch stops further calls and reports how many were skipped, rather than silently truncating the batch with no trace;
  - (d) `validateGeneralization` on a fixture where the candidate's prediction is wrong leaves `status` at `draft` or moves it to `retired` with a non-null `retirement_reason` — never silently promotes;
  - (e) a candidate whose `decision` is `"extends"` must name an existing `method_ref` that resolves in the registry fixture, or the record is refused.
- [ ] **Static control (no-hand-coding rule)**: `grep -n -E 'probe-routine|meta-driver|checker-io|fan-in-ff-protocol-check|fan-in-queueing-model|per-task-suite-record|touches-parser' docs/analysis/discovery-reflection.mjs` outside any string literal clearly marked as test-fixture-only returns zero matches in the PRODUCTION logic. Paste the grep output. If any match exists, name exactly why it is fixture-only and point at the test file, or fix the code.
- [ ] **Real end-to-end verification** (the centerpiece of this task): using the real Experience ledger from the dependency task (6 entries, including the 4 named in this Proposal), run ONE bounded `reflect()` pass with the live registry, `enabled:true`, a real budget (state the numbers used). Paste:
  - which experiences were batched together vs kept separate, and why (by signature, not by hand);
  - the full `decision`/`candidate` output for each of the 4 named cases;
  - confirmation that C7 did NOT produce a promoted/active method — either `decision:"no-method"`, or it appears only inside another candidate's `counterexample` field;
  - the realized `reflection_cost` (model calls, tokens, wall ms, cost via the reused `modelCallFields` machinery — not a guessed number).
- [ ] **Cross-case generalization test**, real: pick ONE candidate produced above whose seed was NOT C7, hold out a DIFFERENT real Experience not used to produce it (any of the other 3), and run `validateGeneralization` against it for real. Paste the verdict and whether the candidate promoted to `active`. If no candidate is eligible for a held-out test (e.g., all 3 positive seeds were merged into one candidate with no case left to hold out), say so explicitly and report `learning_quality` as `not-evaluated` with the reason — do not fabricate a held-out case.
- [ ] Negative control: feed `reflect()` a FABRICATED Experience whose `components` name two files with no real relationship (e.g. two files picked at random from `plugin/scripts/`) and confirm the output is `decision:"no-method"` or a candidate that fails `validateGeneralization` — a reflection pipeline that proposes a method for anything it's shown is not falsifiable. Paste the output.

## Definition of Done
- All AC ticked with real output pasted; `learning_quality` and `reflection_cost` are real numbers from the real run, `net_new_discovery_value` is explicitly `not-yet-measured`.
- `scripts/test.sh --for-task gap-discovery-method-reflection-unified-trigger-and-candidate-generation` green.
- No routine wiring, no meta-driver changes, no driver kind — confirmed by the Touches list being exhaustive.
- This task's own completion is NOT claimed as "the method learned something real" — that claim requires the follow-on routine-wiring task to run in production and for `net_new_discovery_value` to become a real, non-zero-by-silence number.

## Touches
- tasks/gap-discovery-method-reflection-unified-trigger-and-candidate-generation.md
- docs/analysis/discovery-reflection.mjs (new)
- plugin/test/discovery-reflection.test.mjs (new)
