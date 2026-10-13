---
id: gap-cross-project-dogfood-quay-self-usage-c1-a7wnts
title: "[cross-project dogfood] When the pool-quality-judge or
  architecture-review LLM judge prints non-JSON stdout, Quay records the whole
  round state="
status: ready
labels:
  - gap
  - cross-project-dogfood
parent: null
children: []
extra: {}
---
## Proposal
Cross-project Quay dogfooding round `cpd-3283888-1791886325773-a7wnts` read the real usage artifacts of source project `quay-self-usage` and formed this hypothesis; an independent verifier and an independent refuter both returned `supported`.

**Claim**: When the pool-quality-judge or architecture-review LLM judge prints non-JSON stdout, Quay records the whole round state=failed with zero verdicts and stores only a fixed reason string, never the raw stdout.

**Quay-side components**: `plugin/scripts/quality-gate-driver.ts`

**Why this is Quay-generic, not host-local**: the claim names Quay's own mechanism, not the source project's product; the source project is only where the failure became visible.

## Evidence
- `plugin/scripts/quality-gate-driver.ts:557` — catch { writeRecord(failedQualityRoundRecord(root, plan.triggers.reasons, "judge output not a JSON array")); return {... state: "failed", reason: "judge output not a JSON array"}; }  (same shape at :840-850 for architecture-review)
- `.quay/quality-round.jsonl:?` — reason: judge output not a JSON array=33 ; state: failed=33 judged=32 — roughly half the rounds produced zero verdicts
- `.quay/quality-round.jsonl:14244` — {"name":"pool-quality-judge","value":null,"state":"not-evaluated","reason":"unparseable --plan output (exit 1)"}

- round: `cpd-3283888-1791886325773-a7wnts` (record `cross-project-dogfood@cpd-3283888-1791886325773-a7wnts::c1`)
- source project: `quay-self-usage`
- verifier verdict: `supported`; refuter verdict: `supported`

## Plan
1. Reproduce the claim from the cited positions above (the artifact that exposed it), then read the named Quay-side surface.
2. Either fix the mechanism, or record why the claim does not hold for Quay's own code — the round's refuter was satisfied, so "it is only that host" needs its own evidence.
3. Correct `## Touches` to the files the fix actually changes before editing them.

## Result
**Claim reproduced on Quay's own tree** (`/data/home/yale/work/quay/.quay/quality-round.jsonl`, read 2026-10-13): 371 rows carry reason exactly `judge output not a JSON array`, every one with `"verdicts":[]` and `"distribution":null` (zero verdicts); 382 rows are `state:"failed"` in total; **0 rows carry any suffix after that fixed reason** — the judge's raw process stdout is nowhere in the carrier (the evidence's original count of 33 has grown to 371). The mechanical sibling is visible the same way: 6 rows `unparseable identity-replication output (exit 1)`, also with no raw output. Sample rounds 1092/1093: `{"round":1092,...,"state":"failed","distribution":null,"shouldRemoveIds":[],"verdicts":[],"reason":"judge output not a JSON array"}`. **The claim holds as stated.**

**Defect fixed** in `plugin/scripts/quality-gate-driver.ts`: every "I cannot read this output" failure path now carries a bounded, single-line rendering of the raw instrument output in its `reason`, via the new `diagnosticExcerpt(raw, max=500)`:
- `pool-quality-judge`: unparseable `--plan` (not-evaluated) and non-JSON judge stdout (failed); the failed record and the returned `Fact.reason` now share one composed reason (previously the fixed string was written twice).
- `architecture-review`: unparseable identity-replication / guard-lineage / deletion-closure reads, non-JSON judge stdout, and "judge produced zero valid cluster verdicts".

`diagnosticExcerpt` collapses all whitespace to one line (a multi-line payload cannot tear the JSONL record apart), marks an empty payload as `(empty output)` (empty is not content), and appends `…(+N chars, truncated)` past the bound (a large payload is not misread as a tiny one). **Three-state vocabulary is unchanged** — `failed` stays `failed`, `not-evaluated` stays `not-evaluated`; only the failure becomes diagnosable. This is the same shape the sibling judge-exit branch already used (it slices `stderr` to 200 chars into `reason`).

**Sibling sweep (hard rule 5b)**: the principle "a read-it-and-failed path must not discard the instrument's raw output" was grepped across the whole carrier; every hit — the B17 `judgment-consumer-check` and `packaging-hygiene` unparseable paths, plus the six sites above — is fixed, not just the two the claim names.

**Out of scope (reported, not fixed)**: the pool judge still maps a *parseable-but-not-an-array* judge stdout (e.g. a JSON object `{"verdicts":[…]}`) through `Array.isArray(parsed) ? parsed : []` ⇒ `verdicts=[]` ⇒ `state:"verified"` with `judged 0 task(s)` and **no record at all**. That is a silent-success hole (the hard-rule-3b "read-it-wrong-looks-fine" shape), not the "non-JSON stdout" defect this claim names; it is left as an observation because moving `verified`→`failed` there is a separate semantic decision.

**Verification**: `plugin/test/quality-gate-driver.test.mjs` gains four tests — `diagnosticExcerpt` unit coverage (single-line / empty / truncation) and, for both the pool-quality-judge and the architecture-review judge, an assertion that a non-JSON stdout's marker string reaches the persisted round record and the returned fact. Negative control: reverting the two judge fix sites turns both judge tests red while the `--plan` sibling test stays green (so the assertions measure the fix, not a constant). `node --experimental-strip-types --test plugin/test/quality-gate-driver.test.mjs` → 36/36 pass.

## Acceptance Criteria
- [x] the Quay-side mechanism named in the claim behaves as the claim says (reproduce it from the cited positions)
- [x] the fix is verified on Quay's own tree, not only on the source project that exposed it

## Definition of Done
- the defect is fixed or shown not to exist, and the round's claim is answered in the task body.

## Touches
- `plugin/scripts/quality-gate-driver.ts`
- `plugin/test/quality-gate-driver.test.mjs`
- `tasks/gap-cross-project-dogfood-quay-self-usage-c1-a7wnts.md`