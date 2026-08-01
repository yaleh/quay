## M211 ABSORB entry

**Milestone id:** M211
**Task:** DIR-119-D3 (wire Audit into per-shard, mechanically-enforced read-only dispatch —
composite-audit.ts; third child of DIR-119-D's split)
**Charter:** experiments/quay-perpetual-stream/charters/M211-dir119d3-audit-readonly-shards.md
**Value type:** capabilityGrowth
**Deliverable:** yes

## Backlog row

| DIR-119-D3 | wire execute-milestone.js's composite Audit path to a REAL per-shard read-only dispatcher: non-selftest --snapshot/--guard/--combine-json CLI modes in composite-audit.ts (+ byte-identical plugin mirror) — takeGitSnapshot/diffGitSnapshots/guardShardReadOnly exports plus a --combine-json thin wrap of the real exported combineShardVerdicts; audit-manifest-read -> SERIALIZED audit-shard-<id> agents (each prompt scope-limited to that shard's own taskIds, each taking before/after --snapshot windows around its inspection) -> the workflow's OWN inline before/after git-status snapshot diff hard-fails ANY delta as audit-shard-write-violation:<id> (never the agent self-report, never deepFreeze/structuredClone) -> exactly one audit-combine agent invoking the real combineShardVerdicts via --combine-json; composite write instructions (checklist-tick/absorb-disposition/deviation-log) stripped from the Audit prompt — those mutations move to Reconcile (DIR-119-D4); width-1 single-agent Audit prompt byte-identical (additive branch) | TBD | - | milestone-candidate, human-steered, surface:method-infra |

<!--
surface:method-infra — this milestone's ## Touches are entirely methodology/workflow
infrastructure: .claude/workflows/execute-milestone.js + plugin/workflows/ mirror,
experiments/quay-perpetual-stream/scripts/composite-audit.ts + plugin/scripts/ mirror, their test
files, and docs/plans/M211-dir-119-d3.md. Touches NO packages/quay* product code, so the
product-touching surface labels (cli/web-ui/provider-abi/mcp) do NOT apply.

The adversarial audit disposition + ABSORB-gate-run sections below are completed during the
Audit/Land phases, per inherited-core.md.
-->

## Adversarial audit disposition (M211)

(to be completed at Audit phase)

## ABSORB gate run (M211, post-audit)

(to be completed at Land phase)

adversarial-audit disposition: REFUTED — 4 of 7 ACs confirmed with auditor-generated evidence
(AC1 master wiring grep/import-graph, AC4 RED/GREEN hostile-write catch, AC5 in-process-isolation
negative control, AC6 structural write-instruction absence) and 2 of 4 DoD items confirmed (landed
on master under human-steered discipline; RED/GREEN evidence exists); 3 ACs REFUTED-by-absence
(AC2 journal shard-count equality, AC3 exactly-once combine count, AC7 fresh-audit-no-refutation)
and 2 DoD items REFUTED (real non-fixture composite dispatch; zero-unresolved-findings audit) — each
demands real composite-dispatch journal evidence that does not exist anywhere on disk (auditor grep
of all 228 journal.jsonl: 0 carry a shardResult/bundleVerdict typed return). Root cause is the same
Plan/gate sequencing contradiction the sibling M210/DIR-119-D2 audit named: the checked Plan
sequences Stage 6 (real-dispatch proof + fresh wiring audit) as POST-Land, but the iteration-0
acceptance audit runs BEFORE Land, and it0-dod-check clause 0 HARD-blocks unchecked checklist boxes —
unsatisfiable by construction at iteration-0. Nothing about the implementation is refuted on the
merits; every reachable structural half was reached and verified.

V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated carry-forward
