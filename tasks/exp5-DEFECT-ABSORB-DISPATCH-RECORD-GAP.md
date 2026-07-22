---
id: exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP
title: "defect: ABSORB entries missing --dispatch-record arg for clause12-audit-independence (recurring 4x in M82)"
status: done
labels:
  - milestone-candidate
  - defect
  - milestone:M-90
extra:
  schema: "v1"
  acceptance: "bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP experiments/quay-perpetual-stream/charters/M90-absorb-dispatch-record-gap.md /tmp/m90-absorb-entry.md"
---
## Proposal

clause12-audit-independence (`it0-dod-check.mjs`) requires that the acceptance audit be proved
to have been produced by an independent subagent via a dispatch-record file. The ABSORB step
repeatedly fails this gate because the ABSORB-entry template / `OUTER-LOOP.md` step 6 instructions
do not include a reminder or sample invocation for `--dispatch-record`. The error recurred 4 times
across M82 iterations before being resolved manually each time.

**Evidence:** `analyze_errors` output, session `a653b2e9-8c25-4560-8c85-bd3e757e56f3`, 2026-07-21,
M82 ABSORB turns — error signature `279fc7dc16414651`, count 4:
```
FAIL: clause12-audit-independence: FAIL — audit artifact's session id ("m82-iter0-p3b1-quay-core-utils-ts-2026-07-21")
is distinct from the orchestrator's own id, but NO dispatch-record was supplied to corroborate it
(set --dispatch-record <file> or pass dispatchRecordIds) — fail-closed per DIR-034
```

**Root cause:** `OUTER-LOOP.md` step 6's ABSORB narrative does not mention the `--dispatch-record`
argument for `it0-dod-check.sh`. The gate is correct (fail-closed per DIR-034), but the ABSORB
template is incomplete — it teaches the pattern of running `it0-dod-check.sh` but omits the
dispatch-record co-requirement.

## Plan

N/A — defect fix is a targeted edit to `OUTER-LOOP.md` step 6 ABSORB instructions to add the
`--dispatch-record` argument example alongside the existing `it0-dod-check.sh` invocation sample.

## Acceptance Criteria

- [x] `OUTER-LOOP.md` step 6 ABSORB section includes explicit operational guidance for creating the dispatch-record file and a concrete sample `## Audit-independence check` section with `Dispatch record: /tmp/m<NN>-dispatch-record.txt` (AC wording corrected from SELECT — original said "in the `it0-dod-check.sh` invocation" but `it0-dod-check.sh` does not accept `--dispatch-record` as a CLI flag; the path goes in the ABSORB entry section, parsed by Clause 12 internally — audit CONCERNS recorded in `milestones/M90/audits/iteration-0-acceptance-audit.md`)
- [x] A test ABSORB-entry produced following the updated template passes `clause12-audit-independence` on first attempt (no re-try needed)
- [x] The existing `it0-dod-check.mjs` clause 12 logic is unchanged (template fix only, not gate logic)

## Definition of Done

References the standard inherited-core DoD clauses.

- [x] `OUTER-LOOP.md` updated with dispatch-record operator procedure and sample `## Audit-independence check` block
- [ ] At least one real ABSORB entry (next milestone's ABSORB) passes clause12 on first attempt without manual intervention (deferred — verifiable at M91 ABSORB)
- [x] Adversarial audit disposition recorded (CONCERNS: AC 1 wording error at SELECT; all product claims NO REFUTATION FOUND)

## Execution record

**Milestone:** M90  
**Iteration:** iteration-0  
**Realized Δv:** 0 (governance-integrity / instrument-correction — no VT chart cell)  
**Merge SHA:** 5068913  
**Outcome:** done — OUTER-LOOP.md step 6 updated with explicit 5-step dispatch-record operator procedure and concrete `## Audit-independence check` sample block; clause 12 synthetic test PASSes on first attempt; gate script unchanged; audit CONCERNS (AC wording error, implementation correct).

## Not selected (M89)

Not selected M89 — ranked below exp5-DEFECT-YAML-FRONTMATTER-COLON-CRASH this pass. YAML crash is production-safety (blocks task board at loop start); dispatch-record gap is a process fix (already manually worked-around in M88 ABSORB). YAML crash selected first.

