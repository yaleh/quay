---
id: gap-cross-project-dogfood-claudecodeui-c1-ccx5t6
title: "[cross-project dogfood] Fan-in retry records capture only the first line
  of git's combined push output, so an ordinary non-fast-forward is…"
status: todo
labels:
  - gap
  - cross-project-dogfood
parent: null
children: []
extra: {}
---
## Proposal
Cross-project Quay dogfooding round `cpd-3268698-1792199271253-ccx5t6` read the real usage artifacts of source project `claudecodeui` and formed this hypothesis; an independent verifier and an independent refuter both returned `supported`.

**Claim**: Fan-in retry records capture only the first line of git's combined push output, so an ordinary non-fast-forward is logged as error "To ." and the rejection reason is never recorded.

**Quay-side components**: `packages/quay/src/fan-in/ff-merge.ts`

**Why this is Quay-generic, not host-local**: the claim names Quay's own mechanism, not the source project's product; the source project is only where the failure became visible.

## Evidence
- `.quay/fan-in-retries.jsonl:1` — {"taskId":"gap-quay-tests-page-perfile-wrapper",...,"error":"To .","attemptKey":"mfi-..."} — same bare "To ." on lines 2,3,5,6,7,8 (7 of 8 records)
- `packages/quay/src/fan-in/ff-merge.ts:944` — mergeErr = (m.stdout + m.stderr).trim().split("\n")[0] ?? "";  // push-mode ffCmd at :939 = git push . <src>:refs/heads/<target>, whose first stderr line is 'To .'

- round: `cpd-3268698-1792199271253-ccx5t6` (record `cross-project-dogfood@cpd-3268698-1792199271253-ccx5t6::c1`)
- source project: `claudecodeui`
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
- `packages/quay/src/fan-in/ff-merge.ts`
- `tasks/gap-cross-project-dogfood-claudecodeui-c1-ccx5t6.md`
