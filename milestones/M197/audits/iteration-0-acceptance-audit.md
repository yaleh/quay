# M197 — Adversarial acceptance audit (third independent pass, post-fix)

**Audit session id:** ef014e6f-7f2a-4c7a-a7ce-a2c6f5e5ab78

**Task:** gap-prepare-milestone-cross-generation-no-incremental-reuse
**Milestone:** M197
**Build commit under audit:** 528a26a ("M197 build: prepare-milestone.js
resumeFromAdjudicatedProposal cross-generation resume path")
**Charter:** experiments/quay-perpetual-stream/charters/M197-gap-prepare-milestone-resume.md
**Plan:** docs/plans/M197-gap-prepare-milestone-resume.md
**Fresh context:** yes — this audit pass had not seen the build or any prior audit conversation
before this session turn; every finding below was independently re-derived from raw artifacts on
disk (git history, journal files, direct test/gate re-runs), not taken from the task file's or
`absorb-entry.md`'s own narrative.

## History this pass supersedes (preserved via git, not erased)

The ORIGINAL iteration-0 audit (this same file path, commit `704b247`, recoverable via
`git show 704b247:milestones/M197/audits/iteration-0-acceptance-audit.md`) found **REFUTED**:
5/10 AC + 1 DoD item required "a real run's journal" / "a real dispatch's journal" as their own
explicit evidentiary bar, and the Build subagent had no `Workflow` tool access, so it could only
produce mocked-`agent()` unit-test evidence for the resume mechanism. A coordinator with
`Workflow` access then dispatched a real proof run (`wf_2cc60d00-181`, commit `0abcbf0`) against a
disposable fixture task (`FIXTURE-M197-RESUME-PROOF`, since deleted, never landed) to produce the
missing journal, and a second re-audit pass (recorded directly in `absorb-entry.md`, commit
`bb9458b`) confirmed the fix. This third, independent pass re-verifies BOTH the original build and
the fix from raw sources before concurring — not a rubber stamp of the prior narrative.

## Verdict: NO REFUTATION FOUND

## Per-AC refutation attempts

1. **Resume flag skips ProposalAuthors/Adjudicate (real journal).** Attempted refutation: is
   `wf_2cc60d00-181` a real, on-disk journal, or a narrated claim? Opened
   `/home/yale/.claude/projects/-home-yale-work-quay/ef014e6f-7f2a-4c7a-a7ce-a2c6f5e5ab78/
   subagents/workflows/wf_2cc60d00-181/journal.jsonl` and its parent `workflows/
   wf_2cc60d00-181.json` directly; parsed all `result` objects programmatically (not read the
   summary doc). 6 dispatches, all `findings`/`{ok,proposalHash}`/`resolvedIds`-shaped
   (ProposalReview/revise shapes); **zero** carry an `authorIdx` key (the field
   `prepare-milestone.js`'s `proposal-author-N` schema requires) and zero carry the bare
   adjudicator `{proposalText,ok,sessionId}` shape. **Not refuted** — real artifact, matches claim.
2. **Cold dispatch unchanged.** Opened `wf_9aea9c8c-fc7/journal.jsonl` directly; dispatch #2 and #3
   results carry `authorIdx: 1` and `authorIdx: 2` respectively. **Not refuted.**
3. **`fullSynthesisCount` 0/1 semantics + fail-closed check.** Re-ran
   `node --test experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs` directly:
   34/34 pass, including both cited tests verbatim by name. **Not refuted.**
4. **RED/GREEN fixture.** Re-ran
   `node --test plugin/test/prepare-milestone-convergence.test.mjs` directly: 26/26 pass, including
   "M197 RED: cold dispatch ... always re-derives" and "M197 GREEN:
   resumeFromAdjudicatedProposal:true skips ProposalAuthors/Adjudicate". **Not refuted.**
5. **OUTER-LOOP.md / SKILL.md doc updates.** `grep -n resumeFromAdjudicatedProposal
   experiments/quay-perpetual-stream/OUTER-LOOP.md` → 2 hits, RESUME CONTRACT clause (lines
   69-84) reads as the exact caller-rule text claimed. `diff .claude/skills/quay-task-to-plan/
   SKILL.md plugin/skills/quay-task-to-plan/SKILL.md` → byte-identical, both carry the M197 bullet.
   **Not refuted.**
6. **Resume-flag callsite real (wiring).** Read `.claude/workflows/prepare-milestone.js` lines
   39-62: `const _resumeFromAdjudicatedProposal = $a.resumeFromAdjudicatedProposal === true`, an
   `if (_resumeFromAdjudicatedProposal) { ... skip ProposalAuthors ... skip Adjudicate ... }`
   branch precedes any `agent()` dispatch for those two phases. `diff .claude/workflows/
   prepare-milestone.js plugin/workflows/prepare-milestone.js` → byte-identical. Confirmed live by
   the same `wf_2cc60d00-181` journal in item 1. **Not refuted.**
7. **OUTER-LOOP caller-contract text.** Read `OUTER-LOOP.md` lines 68-84 directly (not grep-only):
   names the `resumeFromRunId`/CLAUDE.md M144 distinction, states the caller rule verbatim.
   **Not refuted.**
8. **`fullSynthesisCount` semantics (unit-test bar, lower than journal bar per its own text).**
   Same 34/34 run as item 3. **Not refuted.**
9. **Resume path never re-derives (byte-identical Proposal into review).** `wf_2cc60d00-181`'s
   round-0 full-review finding `477c5f7e` explicitly quotes the fixture's own stale problem-framing
   text back at it ("the Proposal's problem framing is factually stale: it proposes building the
   resumeFromAdjudicatedProposal resume mechanism 'from a blank slate,' but that exact mechanism
   is already implemented and on master") — this is only possible if the reviewer read the
   PRE-EXISTING (pre-dispatch, unedited-by-this-run) Proposal text, consistent with "no
   `task_write` to `## Proposal` performed" under resume mode. **Not refuted.**
10. **Real-journal proof for the previously-refuted 5 items (this bullet itself).** Same evidence
    as items 1/2 above, cross-checked against `milestones/M197/resume-flag-real-journal-proof.md`'s
    own claims — every specific number/shape claim in that doc (12 journal entries, 6 agent
    dispatches, zero `authorIdx`, `needs-human`/`split-recommended` outcome, subsystem
    "mechanism-claim wiring coverage (DIR-117)" with 3 blocking findings) matches the raw
    `wf_2cc60d00-181.json` result object byte-for-byte. **Not refuted.**

## DoD

- **Landed on master:** correctly **unticked**. `grep '^status:' tasks/
  gap-prepare-milestone-cross-generation-no-incremental-reuse.md` → `status: todo`; no Land/ABSORB
  merge commit exists in `git log` beyond the Build+audit-writeback commits already on `master`
  (this repo runs directly on `master`, so Build commits landing ≠ Land/ABSORB completing). Land
  genuinely has not run yet at audit time.
- **Real journal evidence for both paths:** confirmed, see AC 1/2 above.
- **`fullSynthesisCount<=1` guarantee unweakened, abuse fixture included:** confirmed via the same
  34/34 test run (item 3), including the specific "resume introduces no new exemption" test.

## Mechanical checks run directly by this audit (not narrated)

- `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
  gap-prepare-milestone-cross-generation-no-incremental-reuse experiments/quay-perpetual-stream/
  charters/M197-gap-prepare-milestone-resume.md milestones/M197/absorb-entry.md` → exit 0, 12/12
  clause dispositions confirmed, no undeclared self-exemption. (Contrast: the ORIGINAL audit's own
  run of this same command, above, exited 2 with "no `## Backlog row` section" — that gap has since
  been closed by the Land-precedent Backlog row the second re-audit pass added to `absorb-entry.md`
  in commit `bb9458b`, independently confirmed present by this pass.)
- `bash experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh --counter 193
  experiments/quay-perpetual-stream/v-meta-ledger.md` → exit 0, "PASS: no confirmed-unconsolidated
  row past K without a dated carry-forward" (verbatim; matches the line already recorded in
  `absorb-entry.md`).
- `ls tasks/FIXTURE-M197-RESUME-PROOF.md` → No such file (cleanup confirmed); `git log --all -- ...`
  → no trace (never landed, as claimed).

## Disposition

All 10 AC items and 2 of 3 DoD items independently re-confirmed true against real, re-run artifacts
and command output — not self-report. The one remaining DoD item (Landed on master) is genuinely
not yet satisfied and correctly left unticked; that is a fact about the milestone's lifecycle
stage at audit time, not a defect in the Build. No new deviation-log row is warranted (verdict is
NO REFUTATION FOUND, not CONCERNS/REFUTED).
