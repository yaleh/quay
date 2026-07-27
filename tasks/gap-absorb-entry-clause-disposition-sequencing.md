---
id: gap-absorb-entry-clause-disposition-sequencing
title: it0-dod-check.sh clause1/clause2/clause7 fail on every milestone this
  session because disposition text is never appended to the pre-created
  absorb-entry stub before the gate check runs
status: todo
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
- [ ] `execute-milestone.js`'s Audit/Gate phases append real disposition text (not just return
  structured output) for clause1/clause2/clause7 into the absorb-entry file as each value is
  computed — grep confirms the write instruction exists in the prompt text.
- [ ] A real (non-fixture) milestone dispatch after this fix shows `it0-dod-check.sh` exiting 0 (or
  failing only on genuinely unmet clauses, never on "NO disposition statement found") without any
  manual post-hoc edit to the absorb-entry file.
- [ ] Both `.claude/workflows/` and `plugin/workflows/` mirrors stay byte-identical.

## Definition of Done
- [ ] Landed on `master`, verified via a real dispatch, not asserted.
- [ ] Since this touches `.claude/workflows/execute-milestone.js` (driver execution-chain script),
  the milestone resolving it must run under human-steered discipline.

## Human verification when exp5 marks this task done
1. Does a real, unmodified-by-hand absorb-entry file actually pass clause1/2/7 after this fix?
2. Were both workflow mirrors updated identically?
