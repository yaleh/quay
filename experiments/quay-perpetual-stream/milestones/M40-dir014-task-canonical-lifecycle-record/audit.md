# M40-dir014-task-canonical-lifecycle-record — Adversarial Audit

**Auditor:** independent out-of-band subagent, fresh context, refute-first stance.
**Date:** 2026-07-19.
**Scope:** re-verify all 5 task ACs + the relevant `inherited-core.md` DoD clauses against the
MERGED state (`exp5-outer-driver` HEAD, commit `c90c0cc` merge of iteration-0, plus the
independent-verification-only `28e5c69` iteration-1 report). No prior conversation about this
milestone was read; every finding below is from my own commands, run fresh, against the checked-out
worktree.

## Overall verdict (AC-content level): **NO REFUTATION FOUND, with one genuine CONCERN (fail-open
edge case in the grandfather mechanism) that does not itself refute any of the 5 ACs as literally
worded, but should be fixed before this clause matures.**

All 5 Acceptance Criteria are genuinely met on their own terms: the task's own `## Proposal`/
`## Plan` are real and substantive (not boilerplate), Clause 8 is genuinely wired into both
`it0-dod-check.mjs` and `it0-dod-check.sh` (the latter is a pure delegate, matching the pre-existing
pattern of all 8 other clauses, not a new asymmetry), the 2 new fixtures genuinely isolate the
RED/GREEN distinction to Clause 8 alone, `inherited-core.md` documents the clause correctly and
leaves the two-class diversity policy untouched, and the self-referential ABSORB-gate proof
genuinely reads the real task file and PASSes Clause 8 for the stated reason. ABSORB itself has not
run yet (no `dashboard.md`/`backlog.md` M40 entries, task `status: in-progress`) — expected at this
point, mirroring M38/M39's own audit ordering, not itself a content-level refutation.

The one substantive finding (see CONCERNS) is that the forward-only cutover mechanism, gated on the
task's own `milestone:M<N>` label, **fails open** for any future (post-M40) task that simply omits
the `milestone:M<N>` label — such a task N/A-passes Clause 8 silently forever, indistinguishable
from a legitimate pre-M40 grandfather case, even if its Proposal is `TBD` and its Plan reference is
broken. This is a real gap in the deviation's robustness, not a fabricated nitpick — I demonstrated
it concretely below. It does not refute AC3/AC-item-6c as literally worded (the clause does
HARD-block the 2 stated fixture cases, and the charter's own out-of-scope constraint does require
*some* forward-only mechanism), but the specific mechanism chosen has a hole a differently-designed
mechanism (e.g., iteration-1's genuinely-unconditional-trigger approach, discussed below) would not
have.

---

## AC-by-AC findings (own commands, fresh)

### AC1 / item 6a — proposal embedded
**CONFIRMED, genuinely met.** Read `tasks/exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD.md`'s own
`## Proposal` section directly (lines 17-74). It is real, specific, non-boilerplate content: it
names the exact clause number/placement (Clause 8, "next free slot after Clause 7"), the exact
helper to reuse (`extractSection`), the exact PASS/FAIL rules for both `## Proposal` and `## Plan`
(including the placeholder-detection and `docs/plans/*.md`-resolution logic), the exact 2 fixtures
to add, the exact `inherited-core.md` placement, and a named **rejected alternative** (manufacturing
a `docs/plans/M40-*.md` file purely to exercise the "resolves" branch) with reasoning for rejecting
it. This is specific to this milestone, not generic filler — no other exp5 milestone's Proposal
would read the same. `git diff 8c3c2bf..HEAD --stat -- tasks/` shows **zero** changes to this task
file in the entire milestone (confirmed by my own command below), meaning this Proposal predates the
milestone's own build — it was authored at charter/task-authoring time, then genuinely dogfooded
by Clause 8 rather than written to order.

```
$ git diff 8c3c2bf..HEAD --stat -- tasks/
(no output — zero tasks/ files touched by this milestone)
```

### AC2 / item 6b — plan referenced
**CONFIRMED, genuinely met.** The same task's `## Plan` section (lines 76-82) states:
`N/A — this is a small, single-pass mechanical change (one new DoD clause added to two existing
files, 2 new fixtures added to an existing fixtures directory and existing selfcheck script, one new
documentation subsection appended to an existing doc). It does not warrant a staged
docs/plans/*.md implementation plan...` — this is real reasoning tied to the actual scope of the
change (correctly characterizes it as small/mechanical, which it is: the diff is 812 insertions
across 8 files, mostly in fixtures/reports), not a bare `N/A` with no justification.

### AC3 / item 6c — enforcement is real, not prose
**CONFIRMED, genuinely met**, with the one caveat noted in CONCERNS below.

Read the actual Clause 8 code in both files myself:
- `it0-dod-check.mjs` (lines ~551-649): a full, self-contained block reusing `extractSection()`
  (confirmed by reading the code — no parallel section-extraction logic), implementing exactly the 3
  failure modes the AC specifies (missing/placeholder `## Proposal`; missing `## Plan`; `## Plan`
  referencing a non-resolving `docs/plans/*.md` path), plus the `N/A — <reason>` and resolving-path
  PASS branches.
- `it0-dod-check.sh`: confirmed this is a **pure delegate** for ALL 9 clauses, not just Clause 8 —
  read the full file (29 lines): arg-check, node-availability-check, then a single
  `node "$(dirname "$0")/it0-dod-check.mjs" "$1" "$2" "$3"; exit $?` line. There is no
  clause-specific code in the `.sh` file for Clause 0-7 either. So Clause 8 being absent from the
  `.sh` file's *logic* (only its header comment was updated) is not an asymmetry introduced by this
  milestone — it is consistent with the pre-existing convention for the other 8 clauses. Genuinely
  wired into both, per the "both scripts enforce clause 8 because `.sh` always calls `.mjs`" reading
  (also independently reached by iteration-1's own report, see below).

Independently re-ran the fixture selfcheck myself:
```
$ bash experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh
...
PASS: M40C-fake-canonical-violating — exit 1 (expected 1) [fixtures/dod/task-canonical-record-violating-stub.md]
PASS: M40B-fake-canonical-compliant — exit 0 (expected 0) [fixtures/dod/task-canonical-record-compliant-stub.md]

PASS: all 15 DoD fixtures behaved as asserted.
```
All 15 (13 pre-existing + 2 new) pass, matching the claim exactly.

Read both new fixture files in full and diffed their content (not merely their filenames):
`task-canonical-record-compliant-stub.md` (GREEN) has a real ~530-char `## Proposal` paragraph and a
`## Plan: N/A — <genuine reasoning>`; `task-canonical-record-violating-stub.md` (RED) has
`## Proposal` = bare `TBD` and `## Plan` referencing
`docs/plans/M40C-fake-canonical-violating-does-not-exist.md` (confirmed this path does not exist on
disk). Everything else in both fixtures (charter excerpt, ABSORB-entry excerpt, backlog row,
Acceptance Criteria, Definition of Done boilerplate) is near-identical, differing only in cosmetic
fixture-id naming — the RED/GREEN split is genuinely isolated to the Proposal/Plan content, not some
unrelated difference. Confirmed this directly by running both fixtures individually and diffing
clause-by-clause output myself (own command, not copied from the report):

```
GREEN: clause0..clause7 all PASS, clause8 PASS ("real '## Proposal' (687 chars) and a well-formed
       '## Plan'"), overall EXIT=0
RED:   clause0..clause7 all PASS (IDENTICAL to GREEN), clause8 FAILs TWICE ("'## Proposal' section
       is empty/placeholder-only" AND "'## Plan' references docs/plans/*.md path(s) that do NOT
       resolve on disk: docs/plans/M40C-fake-canonical-violating-does-not-exist.md"), overall EXIT=1
```
Every clause 0-7 disposition is byte-identical between RED and GREEN; only Clause 8 differs, and it
correctly names both violations (the fixture deliberately carries both defects at once, as the
fixture's own header comment states, to prove the failure output names both, not just one) — I
confirmed both violation lines appear, not just one.

**Clause 5 no-self-exemption set:** grepped the `.mjs` file directly —
`"task-canonical-lifecycle-record"` IS present in `MECHANICALLY_UNCONDITIONAL_CLAUSES` (line 323)
and in the `clauseNames` array (line 331), as claimed. I also independently constructed a synthetic
attempted self-exemption ("Task canonical-lifecycle-record gate does not apply to this milestone" in
an "Explicitly OUT of scope" section) and confirmed Clause 5 catches it:
```
FAIL: clause5-no-self-exemption: charter's "Explicitly OUT of scope" section exempts
"task-canonical-lifecycle-record" with NO matching WAIVER line found in ABSORB-entry text —
offending line: "- Task canonical-lifecycle-record gate does not apply to this milestone."
```

### AC4 — `inherited-core.md` documentation
**CONFIRMED, genuinely met.** Read the new subsection directly (diff hunk at line ~930-991 of the
file). It is placed immediately after Clause 0's own documentation block ends (line 927 is the last
line of Clause 0's "Current invocation point" bullet) and immediately before "### Clause 1 — ..."
begins — genuinely "immediately after Clause 0's own documentation," as claimed. It follows the same
four-field template (Trigger condition / What it checks / Pass/fail semantics / Current invocation
point) used by all other clauses, and cross-references "DIR-014 item 6" by name multiple times.

Confirmed the two-class diversity policy is UNCHANGED by diffing directly:
```
$ git diff 8c3c2bf..HEAD -- experiments/quay-perpetual-stream/inherited-core.md | grep "^@@"
@@ -851,7 +851,7 @@ ...
@@ -866,11 +866,14 @@ ...
@@ -927,6 +930,65 @@ ...
```
All 3 diff hunks are confined to lines 851-991 (the "Definition of Done" section and its new Clause
8 subsection). The two-class diversity policy sections live at lines 232 and 378 (grepped
independently) — nowhere near any touched hunk. Zero overlap, zero incidental edits.

### AC5 — self-referential proof
**CONFIRMED, genuinely met.** Independently ran (own fresh absorb-entry file, own terminal session,
not copy-pasted from the report):
```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh \
    exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD \
    experiments/quay-perpetual-stream/charters/M40-dir014-task-canonical-lifecycle-record.md \
    /tmp/m40-audit-absorb-entry.md
...
PASS: clause8-task-canonical-lifecycle-record: task carries a real '## Proposal' (4390 chars) and a
well-formed '## Plan' [tasks/exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD.md]
...
FAIL: clause0-ac-dod-present: checklist-form AC has 5 unchecked item(s) remaining ...
FAIL: clause2-vmeta-lag: NO disposition statement found ...
FAIL: DoD check failed — 2 clause violation(s) found (see above).
EXIT=1
```
Clause 8 specifically PASSes, citing the real 4390-character count (matching iteration-0's own
transcript exactly, an independent confirmation it isn't fabricated), and cites
`[tasks/exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD.md]` as its source — proof it read the real
task file, not a fixture-text fallback (the fallback path only activates when no real
`tasks/<id>.md` file resolves; here it resolved). The overall run FAILs on clause0 (unchecked AC
boxes — expected, since the write-back only happens via this very audit) and clause2 (my own minimal
synthetic absorb-entry text lacked exact V_meta-lag phrasing — an artifact of my own throwaway test
fixture, not of Clause 8 or the milestone's code). Neither of those failures implicates Clause 8;
this matches the charter's own explicit note that other clauses may legitimately be pending at this
stage.

---

## The "forward-only cutover" deviation — scrutiny

**Is the deviation justified by the charter text?** Partially. The charter's task-authored
`## Proposal` (which the charter itself embeds and treats as authoritative "suggested design")
literally describes an unconditional trigger with no cutover language. But the SAME charter's own
"Explicitly OUT of scope" section is unambiguous: "Retroactively backfilling `## Proposal`/`## Plan`
onto the ≤M39 milestones' tasks — DIR-014's own text is explicit this is forward-only, same as
DIR-020's AC/DoD rule." I independently verified (own grep) that 23 of the 24 pre-existing
`exp5-M-*` tasks in `tasks/` have no `## Proposal` section — an unconditional Clause 8 trigger would
literally HARD-block all 23 on their next re-evaluation, directly contradicting the explicit
out-of-scope clause. So *some* forward-only accommodation is genuinely required by the charter text,
and iteration-0's read of this conflict is correct in substance.

**Is the grandfather mechanism itself robust?** No — I found a real edge case. The chosen mechanism
(gate on `milestone:M<N>` label, N/A-pass if `N < 40` OR the label is absent entirely) conflates two
semantically different cases under one N/A disposition: (a) a genuine pre-M40 legacy task (safe to
grandfather), and (b) any future/post-M40 task that simply lacks a `milestone:M<N>` label for any
reason — accidental omission, or a task deliberately authored without one. Case (b) is NOT safe to
grandfather, but the current code cannot distinguish it from case (a).

I constructed this concretely (own synthetic task, not present in the merged diff, cleaned up after
testing):
```
$ cat tasks/FAKE-NO-LABEL-TASK.md
---
id: FAKE-NO-LABEL-TASK
labels: [milestone-candidate]     # NOTE: no milestone:M<N> label at all
---
## Proposal
TBD
## Plan
See docs/plans/does-not-exist.md
---
$ bash .../it0-dod-check.sh FAKE-NO-LABEL-TASK ... 2>&1 | grep clause8
PASS: clause8-task-canonical-lifecycle-record: N/A — no 'milestone:M<N>' label found —
legacy/unlabeled task, predates the DIR-014 item 6 cutover [tasks/FAKE-NO-LABEL-TASK.md]
```
A task with a placeholder `TBD` Proposal and a broken Plan reference — exactly the RED case Clause 8
exists to catch — silently N/A-PASSES if it simply omits the label, with no distinguishing signal
from a legitimate legacy grandfather case. Nothing else in `it0-dod-check.mjs` requires a
`milestone:M<N>` label to be present (grepped independently, no such requirement exists). This is a
genuine fail-open gap for any future milestone whose task-authoring step forgets (or chooses to
omit) the label — not a hypothetical, since label presence today is a convention, not itself
enforced by any clause.

Notably, **iteration-1's independently-produced (not merged) attempt chose a different, more robust
design**: a genuinely unconditional trigger, with a one-time backward-compat fix applied directly to
the 4 pre-existing GREEN *fixtures* (not real tasks) that lacked Proposal/Plan sections, reasoning
that the charter's "no retroactive backfill" language is about real ≤M39 milestone tasks, not
synthetic testing fixtures. That design has no equivalent fail-open hole for real tasks (every real
task is checked unconditionally; only synthetic fixtures needed retrofitting). This is documented in
`report.iteration-1.md` (kept as an independent-verification record, not merged) and is worth
surfacing to a human as an alternative worth adopting in a follow-up fix, since it closes the gap
found above without reintroducing the retroactive-backfill problem on real tasks.

**Grandfather spot-check against a REAL pre-M40 task — independently re-run:**
```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh \
    exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES /tmp/m39-absorb-entry.md /tmp/m39-absorb-entry.md
...
PASS: clause8-task-canonical-lifecycle-record: N/A — milestone:M39 < M40 cutover — legacy task,
predates DIR-014 item 6 (forward-only, no retroactive backfill per this milestone's own charter)
[tasks/exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES.md]
```
This confirms the grandfather disposition for a genuine pre-M40 real task IS genuine and explicitly
stated (not silent) — reads the real task file (visible in the `[...]` source tag), correctly
identifies `milestone:M39 < 40`, and states the reasoning inline. **However**, I could only get this
result after adding a `## Backlog row` section to my throwaway `/tmp/m39-absorb-entry.md` file — the
report's own transcript (`bash scripts/it0-dod-check.sh exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES
/tmp/m39-absorb-entry.md /tmp/m39-absorb-entry.md 2>&1 | grep clause8`) implies a bare placeholder
file suffices, but when I ran that literal command against a bare one-line placeholder file myself,
it errored at exit 2 (`ERROR: absorb-entry-file has no "## Backlog row" section`) before ever
reaching Clause 8's evaluation — a minor transcript-fidelity gap in the report (the report's own
`/tmp/m39-absorb-entry.md` must have already contained a Backlog row from an earlier step in their
session, which their transcript doesn't show). This does not change the substantive finding — the
mechanism genuinely works once a minimally-valid absorb-entry is supplied — but the report's
transcript is not fully reproducible as literally written. Flagged as a CONCERN, not a refutation of
AC3/AC5 (the underlying grandfather behavior is real; only the transcript's completeness is
imperfect).

---

## Scope discipline — independently re-verified

```
$ git diff 8c3c2bf..HEAD --stat -- 'packages/quay*'
(no output)
$ git diff 8c3c2bf..HEAD --stat -- '.claude/skills/quay-task-to-plan/'
(no output)
$ git diff 8c3c2bf..HEAD --stat -- tasks/
(no output)
```
No `packages/quay*` product files touched. `.claude/skills/quay-task-to-plan/` untouched. No task's
`## Proposal`/`## Plan` was retroactively backfilled, including this milestone's own task (it was
already well-formed before this milestone's build, confirmed by the empty `tasks/` diff).

`git diff 8c3c2bf..HEAD --stat` full file list: 2 new fixtures, `inherited-core.md`,
`report.iteration-{0,1}.md`, `dod-fixture-selfcheck.sh`, `it0-dod-check.{mjs,sh}` — exactly the set
the charter's "In scope" section authorizes, no more.

Syntax/regression check independently re-run:
```
$ node --check .../it0-dod-check.mjs && bash -n .../it0-dod-check.sh && bash -n .../dod-fixture-selfcheck.sh
ALL SYNTAX OK
```

---

## DoD clause-by-clause disposition (`inherited-core.md`, this milestone's own charter)

- **Clause 0 (AC/DoD present):** task carries a well-formed checklist-form `## Acceptance Criteria`
  (5 items, currently unchecked pending this audit's write-back) and `## Definition of Done`. Boxes
  ticked by this audit below, with citations. Verified the new Clause 8 addition does not regress
  Clause 0's own semantics — Clause 0's code path is untouched by this milestone's diff (confirmed:
  the `.mjs` diff only ADDS a new block at the end, no edits inside Clause 0's own implementation).
- **Clause 1 (per-milestone acceptance audit, unconditional):** this document IS that audit.
- **Clause 2 (V_meta consolidation-lag):** deferred to the real ABSORB step (not yet run); no new
  confirmed-but-unconsolidated ledger row is created by this milestone's own work per the charter.
- **Clause 3 (line-budget):** charter states this was run pre-dispatch (5 in-scope items,
  small-to-moderate); no evidence of bypass; not independently re-runnable retroactively in the same
  sense.
- **Clause 4 (impl-row):** N/A per charter — this milestone's own output IS the mechanism, not a
  design doc. Confirmed no design-only markers anywhere in the diff.
- **Clause 5 (no-self-exemption):** independently re-verified — no self-exemption language in the
  charter's "Explicitly OUT of scope" section for Clause 8 or any other clause (confirmed by reading
  the section directly); Clause 8 correctly added to `MECHANICALLY_UNCONDITIONAL_CLAUSES` so a
  future undeclared self-exemption attempt would be caught (independently demonstrated above). PASS.
- **Clause 6 (escrow-Δv):** N/A per charter — not design-only. PASS.
- **Clause 7 (test-floor):** N/A per charter — `surface:method-infra`, no `packages/quay*` product
  files touched (independently confirmed above via the scope-discipline diff). PASS.
- **Clause 8 (task canonical-lifecycle-record, this milestone's own new clause):** self-referentially
  PASSES against this milestone's own task, independently re-run and confirmed above. This is the
  clause under audit; see AC3/AC5 findings for full detail.

## Blocking gap: none at the AC-content level

ABSORB has not run for M40 yet (`dashboard.md`/`backlog.md` have no M40 entries, task
`status: in-progress`) — this is EXPECTED at this point in the outer-loop sequence (the adversarial
audit runs before/at ABSORB, mirroring M38/M39's own audit ordering), not itself a content-level
refutation. Unlike M39's audit (which found ABSORB had been skipped entirely after merge), this
audit is being run in the normal pre-ABSORB position, so this is not a comparable gap.

## CONCERNS (non-blocking, worth flagging for a human / follow-up milestone)

1. **Fail-open grandfather gap (see full analysis above).** A future (post-M40) task that omits the
   `milestone:M<N>` label entirely N/A-passes Clause 8 unconditionally, indistinguishable from a
   legitimate pre-M40 legacy task, even with a `TBD` Proposal and a broken Plan reference. Concrete
   repro included above. Suggested fix direction (not prescriptive): either (a) adopt iteration-1's
   genuinely-unconditional-trigger design with a one-time fixture-only backward-compat patch (closes
   the hole entirely for real tasks), or (b) at minimum, distinguish "no label found" from "label
   found, N < 40" in the PASS message with a stronger caveat, and/or add a companion check elsewhere
   that a `milestone:M<N>` label is itself present on any task claiming `milestone-candidate` status
   post-M40 (closing the escape hatch that lets a task dodge the label to dodge the clause).
2. **Report transcript not fully reproducible as literally written.** Iteration-0's "extra
   verification" grandfather spot-check transcript
   (`bash scripts/it0-dod-check.sh exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES /tmp/m39-absorb-entry.md
   /tmp/m39-absorb-entry.md 2>&1 | grep clause8`) implies a bare placeholder file is sufficient, but
   the script actually requires a `## Backlog row` section in that file first (errors at exit 2
   otherwise, before Clause 8 ever runs). The underlying grandfather behavior IS genuine (confirmed
   above once a minimally-valid absorb-entry is supplied) — this is a transcript-completeness gap,
   not a fabricated result, but worth a note for future report-writers to paste the FULL command
   sequence (including any file-content setup) rather than an abbreviated one-liner.
3. **Two independently-diverging deviations exist between iteration-0 (merged) and iteration-1
   (kept as record only)** for the SAME AC — cutover-gated vs. genuinely-unconditional Clause 8
   trigger. This is expected per the charter's independent-verification design, and iteration-1's
   report is explicitly marked as not merged, so this is not itself a defect — flagged only because a
   future reader of iteration-1's report might assume its design is what actually shipped; it is not.

## Task file checklist write-back

All 5 AC checkboxes were independently confirmed via my own commands (not the report's transcripts)
and ticked `- [x]` with a fresh evidence citation appended to
`tasks/exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD.md`. No AC item was found unjustified or ticked
out of charity. The fail-open grandfather gap (CONCERNS #1) is a robustness concern about the
*specific mechanism* chosen for AC3/item-6c's "enforcement is real" requirement, but does not negate
that a real, working, mechanically-enforced HARD-BLOCK exists and correctly fires against both the
2 fixtures and this milestone's own real task — which is what item 6c, as literally worded, requires.
It is recorded here as a CONCERN for follow-up, not as a reason to leave AC3 unchecked.
