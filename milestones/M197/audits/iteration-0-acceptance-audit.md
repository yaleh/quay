# M197 iteration-0 — Adversarial acceptance audit

**Audit session id:** ef014e6f-7f2a-4c7a-a7ce-a2c6f5e5ab78

**Task:** gap-prepare-milestone-cross-generation-no-incremental-reuse
**Milestone:** M197
**Build commit under audit:** 528a26a ("M197 build: prepare-milestone.js
resumeFromAdjudicatedProposal cross-generation resume path")
**Charter:** experiments/quay-perpetual-stream/charters/M197-gap-prepare-milestone-resume.md
**Plan:** docs/plans/M197-gap-prepare-milestone-resume.md
**Fresh context:** yes — this audit had not seen the build before this session.

## Verdict: REFUTED

Five of ten Acceptance Criteria and one Definition-of-Done item are literally unmet: they require
"a real run's journal" / "a real dispatch's journal" / "redispatch prepare-milestone ... using the
new flag" as their own explicit evidentiary bar, and no such artifact exists anywhere under
`milestones/M197/`. Only mocked-agent unit-test evidence (via the pre-existing `loadWorkflow`/
`AsyncFunction` technique in `plugin/test/prepare-milestone-convergence.test.mjs`) was produced.
This is disclosed honestly in the Build's own `iteration-0.md` ("No live-Workflow dispatch was
claimed or attempted"), and the Plan's own Stage 5 explicitly called for exactly this missing
artifact ("Record the journal path in the iteration report as evidence for AC 6/10 and DoD") — a
Plan instruction that was not followed. The underlying code change (the resume-flag skip logic
itself) is well-supported by real command output and appears correct; the gap is specifically in
the "real reproduction" / "real journal" class of evidence the task's own author explicitly
required and separated out from the RED/GREEN fixture requirement (AC 4).

## AC-by-AC (refute-first)

| # | AC (abbrev.) | Verdict | Evidence |
|---|---|---|---|
| 1 | resume-flag callsite, journal shows ZERO ProposalAuthors/Adjudicate dispatches, "verified from a real run's journal, not asserted" | **REFUTED** | Code confirmed present via source read (`git show 528a26a`, `.claude/workflows/prepare-milestone.js` lines ~31-64: `_resumeFromAdjudicatedProposal = $a.resumeFromAdjudicatedProposal === true`, branches to a zero-`agent()`-call path). Only evidence produced is `plugin/test/prepare-milestone-convergence.test.mjs` (26/26 pass, re-run by this audit) — a mocked-`agent()` `AsyncFunction`-driven unit test, NOT a real Workflow-tool dispatch producing a `wf_*/journal.jsonl`-style artifact (the concrete meaning of "journal" elsewhere in this repo — see `milestones/M195/negative-control/post-flip-omitted-receipt-journal.jsonl`, `.claude/workflows/diagnose-verify-failure.js`'s "parse workflow journal"). The AC's own text names "a real run's journal" as the required evidence class; that specific artifact does not exist. |
| 2 | cold dispatch unchanged, "verified by a real journal" | **REFUTED** | Same gap — only the same mocked-agent test file's RED case (also re-run, passing) exists. No real journal. |
| 3 | fullSynthesisCount 0/1 + validateConvergenceCounters fail-closed regardless of path | **CONFIRMED** | `node --test experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs` → 34/34 pass (audit re-ran directly), including "fullSynthesisCount=0 (a resumed dispatch that skipped ProposalAuthors/Adjudicate) is within caps -> ok, same as fullSynthesisCount=1" and "fullSynthesisCount > 1 fails closed regardless of which path (cold or resumed) produced the receipt — resume introduces no new exemption". This AC's own text does not demand "journal" evidence. |
| 4 | RED/GREEN fixture evidence | **CONFIRMED** | `node --test plugin/test/prepare-milestone-convergence.test.mjs` → 26/26 pass (audit re-ran directly), including "M197 RED: cold dispatch (resumeFromAdjudicatedProposal omitted) always re-derives" and "M197 GREEN: resumeFromAdjudicatedProposal:true skips ProposalAuthors/Adjudicate ... fullSynthesisCount=0, Proposal left byte-identical" — for BOTH `.claude/workflows/` and `plugin/workflows/` mirror labels. |
| 5 | OUTER-LOOP.md + quay-task-to-plan skill docs updated | **CONFIRMED** | `grep -n resumeFromAdjudicatedProposal experiments/quay-perpetual-stream/OUTER-LOOP.md` → 2 hits, a "RESUME CONTRACT (M197/gap-prepare-milestone-cross-generation-no-incremental-reuse)" clause under the `prepare(c)` step (read directly, lines 68-83). `.claude/skills/quay-task-to-plan/SKILL.md` and `plugin/skills/quay-task-to-plan/SKILL.md` both carry an identical new bullet under contract 4 — audit diffed both mirrors against each other: no output (byte-identical). |
| 6 | "A real reproduction: redispatch prepare-milestone ... using the new flag ... reaches PlanAuthor/PlanCheck without discarding the fix" | **REFUTED** | NOT performed. `milestones/M197/iterations/iteration-0.md` Stage 5 explicitly substitutes the mocked-agent technique and states: "This Build subagent has no Workflow tool available ... No live-Workflow dispatch was claimed or attempted — recorded honestly per DIR-026." The Plan's own Stage 5 (`docs/plans/M197-gap-prepare-milestone-resume.md` line 94-103) called for "Real dispatch of prepare-milestone.js against a scratch/fixture task ... using the new resume flag" and "Record the journal path in the iteration report" — no journal path appears anywhere in `milestones/M197/`. |
| 7 | "Resume-flag callsite is real, non-selftest (wiring)... confirmed by a real dispatch's journal" | **REFUTED** (half-confirmed) | Source-read half CONFIRMED: audit read the callsite directly — the flag is checked before any `ProposalAuthors`/`Adjudicate` `agent()` call, both mirrors byte-identical. "Real dispatch's journal" half NOT produced — same gap as AC 1/2/6. |
| 8 | OUTER-LOOP caller-contract update real (wiring), verified via grep | **CONFIRMED** | Same grep/read evidence as AC 5 — this bullet's own bar is "verified via grep", which is met. |
| 9 | fullSynthesisCount semantics across resume boundary (wiring), "verified via unit test" | **CONFIRMED** | Same 34/34 run cited for AC 3 — this bullet's own text explicitly downgrades the bar to "unit test" (not journal), and that bar is met. |
| 10 | "Resume path never re-derives (wiring)... verified from a real journal" | **REFUTED** (half-confirmed) | Byte-identical `## Proposal` preservation IS demonstrated by the GREEN mocked test's `extractSection()` before/after comparison (re-run, passing). "Verified from a real journal" is this bullet's own explicit text and was not produced — same gap as AC 1/2/6/7. |

## Additional checks performed (not independently AC-numbered, but load-bearing)

- **Mirror byte-identity:** `diff .claude/workflows/prepare-milestone.js plugin/workflows/prepare-milestone.js` → no output (identical). Same result for the two `quay-task-to-plan/SKILL.md` mirrors.
- **`fullSynthesisCount` is receipt-only, not loop-control:** grep confirms `_fullSynthesisCount` is referenced only in the `_convergence` object, the final `return`, and a log line — never in any branching/loop-continuation logic, so recording `0` cannot silently perturb the ProposalReview delta-round loop's own behavior.
- **`nextAction()` (proposal-convergence.ts) is not called anywhere in `prepare-milestone.js`** (`grep -n "nextAction" .claude/workflows/prepare-milestone.js plugin/workflows/prepare-milestone.js` → no hits). This function's own doc comment calls it "the ONE decision function the bounded loop consults every round," which is not true of the actual production code — the workflow implements its own inline loop instead. This predates M197 (present since M193/DIR-125) and is unrelated to this milestone's own Touches/AC; noted for completeness but NOT charged against M197's verdict.
- **`prepare-milestone-preparation-e2e.test.mjs` + `execute-milestone-preparation-gate.test.mjs`** (cited by the Build's commit message as "cold-path e2e and Prepared-gate enforcement unaffected"): re-ran directly → 16/16 pass, confirms no regression to the pre-existing cold-dispatch e2e path or the M195 Prepared-gate enforcement.
- **Requested-action item 1's "OR detect wiring-coverage-complete" alternative was not implemented** — only the explicit-flag path was built. This is one of two alternatives the task's own `## Requested action` item 1 explicitly offered ("e.g. an optional flag ... OR detect ..."), so building only the flag path is not itself a defect.

## Definition of Done

- **"Landed on master under human-steered discipline"** — the Build commit (`528a26a`) is already on `master`'s own history (this repo runs directly on `master`, DIR-027; no feature branch to merge). However, at audit time no `M197 ABSORB` commit exists and `milestones/M197/absorb-entry.md` did not exist before this audit created it (see below) — the milestone's Absorb/Land steps are still pending. Left **not yet** in the task write-back; this is a normal in-pipeline state, not a defect.
- **"Real journal evidence (not asserted) for both the cold and resumed dispatch paths"** — **REFUTED**, same gap as AC 1/2/6/7/10 above.
- **"DIR-125's own `fullSynthesisCount <= 1`-per-receipt guarantee is confirmed unweakened by a real fixture attempting to abuse the resume path to bypass it"** — **CONFIRMED**: the `proposal-convergence.test.mjs` test explicitly titled "...resume introduces no new exemption" passes (part of the 34/34 run above).

## Mechanical gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh \
    gap-prepare-milestone-cross-generation-no-incremental-reuse \
    experiments/quay-perpetual-stream/charters/M197-gap-prepare-milestone-resume.md \
    milestones/M197/absorb-entry.md
ERROR: absorb-entry-file has no "## Backlog row" section (required to run the impl-row clause
against a synthetic milestone)
EXIT CODE: 2
```

Non-zero exit → **REFUTED by construction** (per audit charge step 3), consistent with the AC-level
finding above. This specific failure (missing `## Backlog row`) is a separate, expected artifact of
`absorb-entry.md` not yet existing as a full document at this pre-Land stage (that section is
normally authored by the Land step's ABSORB-entry template, per the M195/M194/M192 precedent files
this audit inspected) — it does not itself add new information about AC satisfaction beyond what
the AC-by-AC table above already establishes; it is recorded here for completeness and because the
audit protocol treats any non-zero exit as REFUTED regardless of which clause trips first.

## Checklist write-back (DIR-020)

Applied directly to `tasks/gap-prepare-milestone-cross-generation-no-incremental-reuse.md`: AC
3/4/5/8/9 and DoD item 3 ticked `[x]` with evidence citations; AC 1/2/6/7/10, DoD item 1
("not yet"), and DoD item 2 left `[ ]` with an inline `**REFUTED (audit M197):**` / `**Not yet
(audit M197):**` marker and the same evidence citation as this report's table above.
