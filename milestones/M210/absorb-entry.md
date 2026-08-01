## M210 ABSORB entry

**Milestone id:** M210
**Task:** DIR-119-D2 (wire Build into a real phase-DAG dispatcher — composite-build.ts; second
child of DIR-119-D's split)
**Charter:** experiments/quay-perpetual-stream/charters/M210-dir119d2-build-phase-dag.md
**Value type:** capabilityGrowth
**Deliverable:** yes

## Backlog row

| DIR-119-D2 | Wire execute-milestone.js's composite Build path to a REAL per-phase DAG dispatcher: non-selftest --plan-json/--map-evidence-json CLI wraps in composite-build.ts (+ byte-identical plugin mirror) as pure wraps of the exported planPhaseExecution/mapEvidenceToTasks; build-plan -> per-batch SERIAL parallel() of one labeled build-phase-<id> agent per phase (each prompt scoped to its own task IDs/requires/invariant/Touches) -> build-integrate as the SOLE candidate-generation commit creator; dispatch predicate fires IFF _isComposite && _taskIds.length > 1; width-1 single-agent Build prompt byte-identical (additive branch) | TBD | - | milestone-candidate, human-steered, surface:method-infra |

<!--
surface:method-infra — this milestone's ## Touches are entirely methodology/workflow
infrastructure: .claude/workflows/execute-milestone.js + plugin/workflows/ mirror,
experiments/quay-perpetual-stream/scripts/composite-build.ts + plugin/scripts/ mirror, their test
files, and docs/plans/M210-dir-119-d2.md. Touches NO packages/quay* product code, so the
product-touching surface labels (cli/web-ui/provider-abi/mcp) do NOT apply.

The ABSORB-gate-run section below is completed during the Land phase, per inherited-core.md.
-->

## Adversarial audit disposition (M210)

**adversarial-audit disposition: REFUTED**

**V_meta consolidation-lag:** PASS: no confirmed-unconsolidated row past K without a dated carry-forward

**Audit session:** fce11849-b5c4-4ce4-afe5-7b960ca2ad0c

**Audit artifact:** milestones/M210/audits/iteration-0-acceptance-audit.md

**Findings (summary — full evidence in the audit artifact):**
- 4 of 10 AC items CONFIRMED by auditor-generated evidence: AC1 (production wiring — literal
  --plan-json/--map-evidence-json callsites at L257/L331 in both byte-identical mirrors, import
  graph flipped from zero to 2 production importers, non-selftest argv branches, dispatcher
  reachable under the `_isComposite && _taskIds.length > 1` predicate, 14/14 CLI-wrap identity
  tests), AC6 (literal plan command grep), AC7 (cap-bounds-concurrency-never-ownership unit test,
  auditor-run 14/14 both mirrors), AC9 (auditor-run prompt-region byte-identity vs dispatch base
  094adabe both mirrors + 40/40 golden-replay tests).
- 6 of 10 AC items REFUTED as unconfirmable at iteration-0: AC2/AC3/AC4/AC5/AC8 each demand, in
  their own text, evidence off a REAL composite dispatch's workflow RESULT record
  (`workflows/wf_*.json`'s `workflowProgress[]`) and/or raw `agent-*.jsonl` records and/or a
  candidate-generation commit in `git log`. Auditor search of ALL wf_*.json under
  ~/.claude/projects/-home-yale-work-quay/*/workflows/ found ZERO workflowProgress entries labeled
  build-phase-*/build-plan/build-integrate (all "build-phase-" grep hits are embedded source text
  from this very commit); the quay project has no subagents/agent-*.jsonl records at all; no
  candidate-generation commit exists. AC10 ("a fresh independent wiring audit … finds no
  refutation") is REFUTED because THIS audit is that fresh audit and it DID find refutations
  (the five absent evidence surfaces above).
- DoD: 2 of 4 CONFIRMED (landed on master at efb8ec6f under human-steered discipline; legacy
  width-1 golden replay unregressed). 2 REFUTED: "a real, non-fixture composite Build dispatch
  exercises the full new per-phase wiring end to end with journal evidence" (no such dispatch
  exists) and "fresh independent wiring audit finds zero unresolved findings" (this audit has
  unresolved findings).
- Root cause (machine-caught this pass; deviation row written to dashboard.md): the checked Plan
  (docs/plans/M210-dir-119-d2.md Stage 6) sequences the real-dispatch evidence + fresh wiring
  audit as POST-Land, but (a) the task's ACs are DIR-020 checklist-form, (b) it0-dod-check clause
  0 HARD-blocks any unchecked checklist box at gate time, and (c) the lifecycle runs the
  iteration-0 acceptance audit BEFORE Land — so the milestone is unsatisfiable BY CONSTRUCTION at
  iteration-0 (a real nested composite dispatch from within Build is also barred by guardrail G6,
  single-driver serialization on the shared working tree). The structural/wiring halves of all
  six items are real and verified; nothing about the implementation was found false.
- Minor structural observation (not independently gate-able without the missing real records):
  the build-phase prompt header interpolates the milestone's FULL member-task list before the
  "Task IDs (yours ALONE)" scope block — context, not an edit-scope leak, but adjudication
  requires the absent raw agent records.

## ABSORB gate run (M210, post-audit)

(to be completed at Land phase)
