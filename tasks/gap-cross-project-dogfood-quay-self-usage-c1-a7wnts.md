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

## Acceptance Criteria
- [ ] the Quay-side mechanism named in the claim behaves as the claim says (reproduce it from the cited positions)
- [ ] the fix is verified on Quay's own tree, not only on the source project that exposed it

## Definition of Done
- the defect is fixed or shown not to exist, and the round's claim is answered in the task body.

## Touches
- `plugin/scripts/quality-gate-driver.ts`
- `tasks/gap-cross-project-dogfood-quay-self-usage-c1-a7wnts.md`
