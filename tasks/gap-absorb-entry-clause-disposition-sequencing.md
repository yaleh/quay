---
id: gap-absorb-entry-clause-disposition-sequencing
title: it0-dod-check.sh clause1/clause2/clause7 fail on every milestone this
  session because disposition text is never appended to the pre-created
  absorb-entry stub before the gate check runs
status: done
labels:
  - gap
  - human-steered
parent: null
children: []
extra:
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    gap-absorb-entry-clause-disposition-sequencing
    experiments/quay-perpetual-stream/charters/M180-gap-absorb-disposition-sequencing.md
    /tmp/m180-absorb-entry.md
---
## Proposal

Make `.claude/workflows/execute-milestone.js`'s Audit and Build phases write the disposition text
`it0-dod-check.sh`'s clause1/clause2/clause7 actually grep for into the ABSORB-entry file, as each
value becomes known, instead of leaving the pre-created stub permanently incomplete. Landed as M180
(commits `c201b4c`/`46e92e4`), independently proven by a genuinely unrelated later milestone (M181)
whose own Audit phase exercised the same append logic on its own absorb-entry file and passed
clause1/clause2/clause7 for real — closing the non-self-referential-proof gap two prior audits left
open.

## Plan

N/A — small, targeted fix to `execute-milestone.js`'s Audit/Build phase prompts; the `## Requested
action` section below is the plan. No separate design doc needed.

## Finding

Across M175/M176/M177/M178 (this session, 2026-07-26), the mechanical gate
(`it0-dod-check.sh <taskId> <charterFile> <absorbEntryFile>`) exited non-zero every single time on
exactly the same 3 clauses — `clause1-adversarial-audit`, `clause2-vmeta-lag`, `clause7-test-floor`
— all reporting "NO disposition statement found in ABSORB-entry text". Prior audits (M175/M176/M177)
characterized this as "the ABSORB-entry stub is a minimal placeholder, same recurring
absorb-entry-template-incompleteness pattern as M138-M173" — true as far as it goes, but never
root-caused *why* it recurs every time despite the orchestrator pre-creating
`/tmp/m<NN>-absorb-entry.md` before every dispatch, per `OUTER-LOOP.md`'s own documented contract
(line 90: "absorb-entry pre-created: /tmp/m<NN>-absorb-entry.md (milestone id, charter path, Δv̂
from step 2)").

M178's internal Audit-phase pass went further and claimed the file "does not exist at all" at
gate-check time — implying a stronger, structural cause (floated by this session's orchestrator as
a `/tmp`-sandbox-isolation hypothesis, by analogy to the DIR-093 fix's documented "workflow agents
don't share a writable /tmp/ with the outer loop" comment in `execute-milestone.js`).

**An independent second audit (fresh-context, this session) directly refuted the stronger claim**
with a decisive test: it re-ran `it0-dod-check.ts` itself against `/tmp/m178-absorb-entry.md` and
got the EXACT SAME clause-by-clause breakdown as M178's own "post-write-back" transcript
(clause0/3/4/5/6/8/10/11/12 PASS, clause1/2/7 FAIL, exit 1) — which is structurally impossible to
produce against a genuinely nonexistent file (the script's own guard at
`it0-dod-check.ts:876-880` fails fast with `ERROR: absorb-entry-file not found`, exit code **2**,
and prints nothing else, when the path truly doesn't resolve). The file was reachable the whole
time; M178's "does not exist at all" phrasing was inaccurate (likely rhetorical shorthand for "no
complete ABSORB record exists" rather than a literal file-existence check).

**Real, confirmed root cause**: clause1 (adversarial-audit disposition)/clause2 (vmeta-lag
disposition)/clause7 (test-floor disposition/WAIVER) grep the absorb-entry file's TEXT for specific
disposition language that only gets written by pipeline stages that run AFTER the point where the
gate check itself fires. Concretely, in `.claude/workflows/execute-milestone.js`:
- The Build phase's pre-flight step sets `extra.acceptance` to the exact
  `it0-dod-check.sh <taskId> <charterFile> <absorbEntryFile>` command (line ~138) — this happens
  before the Audit phase even runs, so at that point in the pipeline no audit verdict, no
  vmeta-lag result, and no test-floor figure could possibly be in the file yet.
- The Audit phase's own mechanical-gate step (line ~186-187) invokes the SAME command mid-Audit,
  in the SAME agent turn that produces the audit verdict — i.e. the verdict is computed in the same
  call that checks whether the verdict is already recorded in the file. Structurally circular: the
  disposition can't be written into the file before the check that requires it to already be there,
  within a single agent turn.
- Nothing in the Verify/Build/Audit/Gate/Land phases ever appends clause1/clause2/clause7 disposition
  lines into `$a.absorbEntryFile` as a side effect of computing them — the vmeta-lag check (Gate
  phase, line ~228) and the audit verdict (Audit phase) both compute real values but only return them
  as structured `agent()` output, never write them into the absorb-entry file text the gate script
  actually greps.

This is a genuine pipeline-sequencing gap, not a filesystem-visibility bug, and not fixable by the
orchestrating session writing a more complete stub upfront (the orchestrator doesn't have the audit
verdict/vmeta-lag result/coverage figure at pre-creation time — those don't exist until later
phases compute them).

## Requested action

1. Amend `.claude/workflows/execute-milestone.js`'s Audit phase (and/or Gate phase) prompts to
   explicitly APPEND disposition lines into `$a.absorbEntryFile` as each relevant value becomes
   known — e.g. immediately after computing the audit verdict, before invoking `it0-dod-check.sh`
   in that same step; immediately after the vmeta-lag check returns its result; immediately after
   any test-coverage figure is computed (or an explicit WAIVER line if the milestone's Touches are
   non-product-code, as most of this session's 4 milestones are).
2. Mirror into `plugin/workflows/execute-milestone.js`.
3. Verify via a real milestone dispatch: `it0-dod-check.sh` should pass clause1/2/7 (or explicitly
   WAIVER them) without any manual orchestrator intervention on the absorb-entry file's content
   after pre-creation.
4. Correct the mischaracterization in `dashboard.md`'s deviation-log rows for M175/M176/M177/M178
   (currently describe this as "absorb-entry-template-incompleteness", which is directionally true
   but doesn't name the actual mechanism) — optional, low priority, informational only.

## Acceptance Criteria
- [x] `execute-milestone.js`'s Audit/Gate phases append real disposition text (not just return
  structured output) for clause1/clause2/clause7 into the absorb-entry file as each value is
  computed — grep confirms the write instruction exists in the prompt text. CONFIRMED by
  fresh-context audit 2026-07-27: `git show c201b4c -- .claude/workflows/execute-milestone.js`
  shows new Audit-phase step 2a (between DoD-satisfaction and the mechanical-gate invocation)
  instructing append of `adversarial-audit disposition: <VERDICT>` (clause1) and
  `V_meta consolidation-lag: <verbatim vmeta-lag-check.sh output>` (clause2) into
  `${$a.absorbEntryFile}`; independently confirmed both phrasings match `it0-dod-check.ts`'s actual
  regexes at lines 236-237/250-251 (read directly, not guessed). Clause7 is instead handled by a
  new Build-phase step 1a (`surface:<label>` tag on the `## Backlog row`) rather than literally in
  Audit/Gate — a phase-placement deviation from this AC's literal wording, but independently
  verified correct against `it0-dod-check.ts` lines 513/527/544 (a recognized non-product
  `surface:` token auto-resolves clause7 N/A-PASS) and disclosed/justified in the M180 charter as
  "the cheapest fix". Ticked because the substance (grep-confirmable write instructions for all 3
  clauses, functionally correct) is present; the phase-location deviation is noted, not blocking.
- [x] A real (non-fixture) milestone dispatch after this fix shows `it0-dod-check.sh` exiting 0 (or
  failing only on genuinely unmet clauses, never on "NO disposition statement found") without any
  manual post-hoc edit to the absorb-entry file. **STILL REFUTED** by SECOND fresh-context audit
  2026-07-27 (post iteration-1 rebuild), with a materially changed picture from the first pass:
  1. `milestones/M180/iterations/iteration-1.md` added a durable regression test
     (`plugin/test/execute-milestone-disposition-conformance.test.mjs`, 16/16 passing, independently
     re-run by this audit) but explicitly declined to touch `/tmp/m180-absorb-entry.md`, disclosing
     honestly that closing AC2 "requires a live orchestrated run... outside this subagent's own tool
     surface" — landed as commit `46e92e4`.
  2. This audit itself IS such a live Audit-phase dispatch (its own charge contains the exact step-2a
     instructions from the landed fix, verbatim). Per that charge, this audit determined its verdict,
     then for-real (not reverted) appended `adversarial-audit disposition: REFUTED` and
     `V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated
     carry-forward` (verbatim `vmeta-lag-check.sh --counter 171` output) to
     `/tmp/m180-absorb-entry.md`, then re-ran the checker: **clause1 and clause2 now PASS live**
     ("disposition statement present"), and clause7 was already PASS via the Build-phase
     `surface:method-infra` tag — the first time in this session's history any of the 3 clauses have
     passed on a real (non-reverted) file. Only `clause0-ac-dod-present` still fails, on this exact
     AC's own unticked checkbox — a 3-clause-failure → 1-clause-failure narrowing, and the 1
     remaining failure is this checkbox's own state, not a mechanism defect.
  3. This audit deliberately declines to tick this box on that evidence alone: the proof is
     self-referential (this milestone's own fix, exercised by this milestone's own audit, on this
     milestone's own file, within the turn that grades it) rather than an independent dispatch on a
     *different* milestone. Ticking it now would let any milestone's Audit phase trivially
     self-certify its own gating AC merely by running its own mandatory step 2a — exactly the kind of
     self-serving loop behavior this repo's methodology (DIR-093 anti-forgery, the "manual
     edit-then-revert" rejection above) exists to prevent. Left `[ ]` pending a non-self-referential
     confirmation: either a future milestone's real Audit-phase dispatch exercising step 2a on its
     *own*, different, absorb-entry file, or explicit human sign-off that self-referential proof is
     acceptable here.
  4. **RESOLVED by THIRD independent audit (fresh-context, 2026-07-27), exactly the non-self-referential
     confirmation item 3 called for**: M181 (`exp5-DEFECT-SELECT-PREFLIGHT-HUMAN-STEERED-LEAK`,
     commits `a8b3c0f`/`e5c19b5`) is a completely unrelated milestone (fixes
     `select-preflight.ts`'s human-steered-label filter — no relation to the absorb-entry
     disposition-append mechanism). Independently confirmed via `git log`: M180's fix commits
     (`c201b4c` 00:29:37, `46e92e4` 00:52:17, `09e5c24` 01:03:36, all 2026-07-27) predate the M181
     charter file's mtime (02:05) and its build commit `a8b3c0f` (02:21:03) — M181 was built and
     audited against a codebase that already contained M180's fix from the start, not a
     hand-patched or resumed run. M181's own Audit phase (`milestones/M181/audits/iteration-0-acceptance-audit.md`,
     section "2a. Disposition append") appended `adversarial-audit disposition: NO REFUTATION FOUND`
     and a verbatim `vmeta-lag-check.sh --counter 171` PASS line to **`/tmp/m181-absorb-entry.md`**
     (M181's own, different absorb-entry file — not M180's), following the exact step-2a append
     instructions independently re-confirmed still present in the live
     `.claude/workflows/execute-milestone.js` (lines ~196-210). Independently re-ran
     `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
     exp5-DEFECT-SELECT-PREFLIGHT-HUMAN-STEERED-LEAK
     experiments/quay-perpetual-stream/charters/M181-select-preflight-human-steered-leak.md
     /tmp/m181-absorb-entry.md` myself: exit 0, `clause1-adversarial-audit` PASS, `clause2-vmeta-lag`
     PASS, `clause7-test-floor` N/A-PASS via the Build-phase `surface:method-infra` tag — all three
     clauses this AC concerns pass for real, on a genuinely different milestone's own file, graded
     by that milestone's own unrelated substance (select-preflight regression tests, 30/30, and a
     live shortlist-exclusion check independently re-run and confirmed by this same audit pass).
     This breaks the self-referential loop the second audit correctly refused to accept: the
     disposition-append mechanism (M180's deliverable) is here exercised as pure infrastructure by
     a milestone that has nothing to do with grading M180 itself. Ticking this box on that evidence.
- [x] Both `.claude/workflows/` and `plugin/workflows/` mirrors stay byte-identical. CONFIRMED:
  `diff .claude/workflows/execute-milestone.js plugin/workflows/execute-milestone.js` (run
  2026-07-27) produces no output.

## Definition of Done
- [x] Landed on `master`, verified via a real dispatch, not asserted. **STILL REFUTED** — landed on
  `master` (commits `c201b4c`, `46e92e4`), and the mechanism is now demonstrably live-verified
  (clause1/clause2/clause7 all PASS this pass, real not reverted — see AC2 above), but the DoD's
  literal "verified" bar isn't cleared because the only pass so far is the self-referential one this
  audit itself just performed. `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
  gap-absorb-entry-clause-disposition-sequencing
  experiments/quay-perpetual-stream/charters/M180-gap-absorb-disposition-sequencing.md
  /tmp/m180-absorb-entry.md` (run 2026-07-27, post-append) now exits 1 on `clause0` ONLY (AC2's own
  unticked box) — clause1/clause2/clause7 all PASS.
  **RESOLVED by fourth, fresh-context audit (2026-07-27)**: the "real dispatch" bar this item
  requires is exactly what AC2's M181 evidence (above) supplies — see that entry for the full
  citation (M181 commits `a8b3c0f`/`e5c19b5`, independently re-run `it0-dod-check.sh` against
  `/tmp/m181-absorb-entry.md`, exit 0, clause1/clause2/clause7 all PASS on a genuinely different,
  unrelated milestone's own file). `clause0` here refers to THIS task's own AC/DoD checkbox state,
  which is now closed by this same edit — not a residual mechanism defect. Ticking this box.
- [x] Since this touches `.claude/workflows/execute-milestone.js` (driver execution-chain script),
  the milestone resolving it must run under human-steered discipline. CONFIRMED: task carries
  `label: human-steered`; `experiments/quay-perpetual-stream/.halt` sentinel exists on disk with
  mtime 2026-07-26 12:42 (before the `c201b4c` commit at 2026-07-27 00:29), and `c201b4c` is a
  single-parent commit made directly on `master` by the human git user (`Yale Huang`), not a
  loop-driven merge — consistent with the DIR-027 "pause via `.halt`" steering-hygiene path.

## Human verification when exp5 marks this task done
1. Does a real, unmodified-by-hand absorb-entry file actually pass clause1/2/7 after this fix?
2. Were both workflow mirrors updated identically?
