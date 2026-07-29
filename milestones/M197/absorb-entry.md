## M197 ABSORB entry

**Milestone id:** M197
**Task:** gap-prepare-milestone-cross-generation-no-incremental-reuse
**Charter:** experiments/quay-perpetual-stream/charters/M197-gap-prepare-milestone-resume.md
**Value type:** capabilityGrowth
**Deliverable:** yes

## Backlog row

| gap-prepare-milestone-cross-generation-no-incremental-reuse | prepare-milestone.js gains a resumeFromAdjudicatedProposal input so a redispatch after a prior generation's needs-human/crash skips ProposalAuthors/Adjudicate and enters directly at ProposalReview using the already-adjudicated (possibly manually-repaired) Proposal, instead of always re-deriving from scratch | TBD | - | gap, human-steered, surface:method-infra |

<!--
surface:method-infra — this milestone's ## Touches are entirely methodology/workflow
infrastructure (.claude/workflows/prepare-milestone.js + plugin mirror, experiments/.../scripts/
proposal-convergence.ts + plugin mirror, experiments/.../scripts/milestone-preparation-check.ts +
plugin mirror, the associated test files, OUTER-LOOP.md, quay-task-to-plan/SKILL.md mirrors,
milestones/M197/**). It touches NO packages/quay* product code, so the product-touching surface
labels (cli/web-ui/provider-abi/mcp) do NOT apply — method-infra is the accurate label.
-->

## Adversarial audit disposition (M197)

**Iteration 0 (Build):** adversarial-audit disposition: REFUTED. 5 of 10 Acceptance Criteria
(the ones requiring "a real run's journal" / "a real dispatch's journal" as their evidentiary
bar) and 1 Definition-of-Done item could not be satisfied by the Build subagent, which has no
`Workflow` tool access and could only produce mocked-agent unit-test evidence (both convergence
test suites, 60/60 combined) for the resume mechanism — honestly disclosed by the Build itself
(`milestones/M197/iterations/iteration-0.md`: "No live-Workflow dispatch was claimed or
attempted"). The other 5 AC + 2 DoD items were independently confirmed true against real,
re-run command output (byte-identical mirrors, `fullSynthesisCount` 0/1 semantics with no new
exemption, `OUTER-LOOP.md` caller contract, skill docs, no regression in pre-existing
e2e/gate tests). Full detail: `milestones/M197/audits/iteration-0-acceptance-audit.md`.

**Post-audit real-journal fix + re-audit:** the outer coordinator (who holds `Workflow` tool
access the Build subagent lacked) dispatched a real `Workflow({scriptPath: '.claude/workflows/
prepare-milestone.js'})` run (`wf_2cc60d00-181`) with `resumeFromAdjudicatedProposal: true`
against a disposable scratch copy of this task (`FIXTURE-M197-RESUME-PROOF`, deleted after use,
never landed) to produce the missing real journal. A second, independent fresh-context audit
re-derived every claim directly from the raw journal file and source code (not trusting the
coordinator's own narrative) and found: **the real-journal evidence is genuine and materially
closes the gap** — the journal's 6 agent dispatches are exclusively `ProposalReview`/revise-shaped
(zero `authorIdx`-shaped `ProposalAuthors` results, zero bare-adjudicator-shaped results),
independently classified against the real schemas in `prepare-milestone.js`; the cold-path
contrast (`wf_9aea9c8c-fc7`, no resume flag) independently confirmed to show real `authorIdx: 1`
and `authorIdx: 2` entries, the unchanged N=2 path; both workflow/skill mirrors confirmed
byte-identical; the fixture task confirmed deleted, no residue. One cosmetic overclaim found and
corrected (task text said "3 delta rounds", raw journal shows 2 — the split checkpoint fired
before a 3rd round's agent was dispatched). Full re-audit detail: this ABSORB entry's own commit
history (`0abcbf0` real-journal fix, subsequent round-count correction) plus
`milestones/M197/resume-flag-real-journal-proof.md`.

**Net disposition: the 5 previously-REFUTED AC items + 1 DoD item are now CONFIRMED** by
independently-reproducible real journal evidence, not self-certified narrative. All 10 AC items
and 2 of 3 DoD items are ticked; the 3rd DoD item ("Landed on master under human-steered
discipline") remains correctly unticked until this Land completes.

V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated carry-forward

## Second independent re-audit (fresh-context, 2026-07-29, session ef014e6f-7f2a-4c7a-a7ce-a2c6f5e5ab78)

Performed a THIRD independent pass (fresh context, no prior chat history), refusing to trust either
the Build's self-report or the prior two audit rounds' own narrative. Re-derived every claim
directly from raw artifacts: opened both `wf_2cc60d00-181` and `wf_9aea9c8c-fc7`'s real
`journal.jsonl` files and their top-level `wf_2cc60d00-181.json` result record on disk and parsed
result-object keys programmatically (not read the summary doc) — confirmed 6/6 dispatches in the
resumed run carry zero `authorIdx` fields and are exclusively `findings`/`ok+proposalHash`/
`resolvedIds`-shaped (ProposalReview/revise shapes), confirmed the cold-path run's dispatches 2-3
carry real `authorIdx: 1`/`authorIdx: 2`; confirmed the run's actual terminal outcome
(`needs-human`/`split-recommended`, `mechanism-claim wiring coverage (DIR-117)` subsystem, 3
blocking findings) directly from the stored result object; confirmed `FIXTURE-M197-RESUME-PROOF`
task file is deleted with no git history trace; re-ran both convergence test files directly
(34/34 and 26/26, both green, matching); re-ran the mechanical `it0-dod-check.sh` (exit 0, 12/12
disposition clauses) and `vmeta-lag-check.sh --counter 193` (exit 0, output byte-matches the line
already on file); diffed `.claude/workflows/prepare-milestone.js` vs its `plugin/` mirror
(byte-identical) and both `quay-task-to-plan/SKILL.md` mirrors (byte-identical); grepped
`OUTER-LOOP.md` for the RESUME CONTRACT clause (present, lines 69-84). No refutation found on any
AC or DoD item. DoD item 1 (Landed on master) correctly remains unticked — task `status:` field is
still `todo`, no Land/ABSORB-merge commit exists yet in `git log`.

adversarial-audit disposition: NO REFUTATION FOUND

V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated carry-forward
