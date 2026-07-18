# M21-impl-row-enforcement — iteration-1

**Worktree:** `experiments/quay-perpetual-stream/milestones/M21-impl-row-enforcement/worktrees/iteration-1`
**Branch:** `exp5-m21-iteration-1`, base commit `e4626ac`, final commit `12ae612`.
**Isolation:** independent re-derivation. Did NOT read iteration-0's worktree, branch, or report at
any point in this run — derived directly from the charter, DIR-015, DIR-016, `OUTER-LOOP.md`, and
`inherited-core.md`'s current text.

## HARD GATES (paste literal output)

```
$ git rev-parse --show-toplevel
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M21-impl-row-enforcement/worktrees/iteration-1

$ git branch --show-current
exp5-m21-iteration-1
```

```
$ git diff --stat e4626ac
 experiments/quay-perpetual-stream/OUTER-LOOP.md    | 20 ++++-
 experiments/quay-perpetual-stream/backlog.md       |  2 +
 ...andidate-row-for-every-design-only-milestone.md | 41 ++++++++--
 ...ion-implementation-as-a-selectable-candidate.md |  9 +++
 .../quay-perpetual-stream/inherited-core.md        | 32 ++++++++
 .../scripts/it0-impl-row-check.sh                  | 94 ++++++++++++++++++++++
 6 files changed, 192 insertions(+), 6 deletions(-)
```

Scope: `OUTER-LOOP.md`, `backlog.md`, the new script, `inherited-core.md`, DIR-016 (renamed
pending→archive + Resolution filled), DIR-015 (partial-progress note added, stays pending). No
unrelated file touched.

## Design decisions (independent judgment, stated up front)

1. **Design-only definition.** I defined "design-only" for the gate/rule/script as: the milestone's
   own `backlog.md` row text contains "design delivered" OR a "design-doc only"/"design only"
   variant, OR the row text names the "Done-when clauses a future implementing milestone would need"
   follow-up-checklist convention. This directly mirrors the three concrete examples DIR-016 cites
   (`M-CLI-EDIT-PARITY`, `M-TASK-BACKLOG-PROJECTION`, `M-TASK-TO-PLAN-SKILL-DESIGN`) and is
   mechanically greppable, avoiding a vaguer "touched no product code" heuristic that would require
   parsing `git diff` history per milestone.
2. **`-IMPL` row satisfaction is existence-based, not status-based.** My first script draft treated
   an `-IMPL` row that itself later became `**DONE` as a FAIL (mis-reading "selectable, non-DONE" as
   a property the row must hold forever). Running it against the real `M-CLI-EDIT-PARITY-IMPL` row —
   which exists, was correctly SELECTed and closed at m16, and is exactly the mechanism working as
   intended — produced a false FAIL. I caught this via self-testing (see "Problem caught during
   self-testing" below) and fixed the script/rule text to require only that a row was MATERIALIZED at
   ABSORB time (so SELECT could reach it); a row's subsequent lifecycle after that is out of the
   gate's scope.
3. **`M-TASK-TO-PLAN-SKILL-IMPL-PHASE7` row creation.** The script's own naming-convention verdict on
   `M-TASK-TO-PLAN-SKILL-DESIGN` is FAIL (no `M-TASK-TO-PLAN-SKILL-DESIGN-IMPL` row exists). Rather
   than blindly creating a row under that exact id, I first checked substantively whether
   `M-TASK-TO-PLAN-SKILL-PROPOSAL-STEP` (a differently-named row, DONE m20) already covers the design
   doc's full follow-up scope. It does not — that row's own text explicitly scopes to Phase 6 only
   and defers Phase 7 (plan step, TDD gate, DISPATCH wiring, diversity-policy de-optionalization).
   Phase 7 is the subject of DIR-014, which is `pending` (not archived) but had no dedicated
   selectable backlog row of its own — DIR-014's ask sat as directive-file prose only, exactly the
   "deferral to never" pattern DIR-016 targets. Both the script's naming-convention verdict AND the
   substantive gap review agree a row was missing, so I created
   `M-TASK-TO-PLAN-SKILL-IMPL-PHASE7`, sourced to DIR-014 + the Phase-6/Phase-7 split already
   documented in `M-TASK-TO-PLAN-SKILL-PROPOSAL-STEP`'s own row text.

## Problem caught during self-testing

Initial script version flagged `M-CLI-EDIT-PARITY` (a milestone whose `-IMPL` row was correctly
created AND already closed) as a FAIL, because it interpreted "selectable, non-DONE" as requiring
the `-IMPL` row to currently be non-DONE, not merely to have existed as selectable at some point.
This would have made the check permanently FAIL on every successfully-completed `-IMPL` row forever
— a self-defeating design (the more successful the mechanism, the more false positives it would
generate). Fixed by re-scoping the check to "does a `<MILESTONE-ID>-IMPL` row exist at all" — the
row's own later lifecycle (SELECTed, DONE, etc.) is a separate concern the gate does not police.
Re-ran against `M-CLI-EDIT-PARITY` post-fix: PASS (see Done-when 3 evidence below).

## Done-when clauses (charter, 8 total) — evidence

### 1. `OUTER-LOOP.md` step 6 HARD BLOCK clause, same register as V_meta-lag/adversarial-audit gates

Added text (verbatim, inserted between the V_meta consolidation-lag gate and step 7):

```
   - **Design-only-milestone impl-row gate (DIR-016 / M21-impl-row-enforcement, HARD BLOCK on step
     7's `milestone_counter++`):** a milestone is **design-only** for this gate's purposes if EITHER
     its own `backlog.md` row text states "design delivered"/"design-doc only" (or equivalent), OR
     its deliverable includes a "Done-when clauses a future implementing milestone would need"
     section (or equivalently-named dispatch-ready follow-up checklist). If THIS milestone is
     design-only, its ABSORB **MUST** create a selectable, non-DONE `<M-NAME>-IMPL` candidate row in
     `backlog.md` — sourced to the design doc's own "Done-when clauses a future implementing
     milestone would need" checklist — **before** step 7's `milestone_counter++` may execute. Run
     `scripts/it0-impl-row-check.sh <milestone-id> backlog.md` as the mechanical check; a non-zero
     exit means the row is missing (or the milestone is design-only with no row yet) and
     `milestone_counter++` **MUST NOT** run until the row exists and the script re-run PASSes. This
     is the SAME HARD BLOCK shape and placement as the V_meta consolidation-lag gate immediately
     above and the adversarial-audit gate above that — deferring a design-only milestone's
     implementation as prose only, with no selectable row, is NOT a valid resolution of this gate,
     because SELECT (step 1) only considers non-DONE rows and a deferral with no row is a deferral
     to never (DIR-016's finding). Record the check's PASS/FAIL output directly in this ABSORB's log
     entry, mirroring the V_meta gate's row-update discipline.
```

Step 7's own line was also updated to require BOTH gates clear:

```
7. **UPDATE DASHBOARD** — VT, slope (marginal Δv), ρ, charter-thickness, discovery-latency,
   calibration-error, `V_meta consolidation lag` (re-derive milestones-since-confirmed for every
   ledger row per `v-meta-ledger.md`), milestone_counter++ (only after BOTH the V_meta gate AND the
   design-only-milestone impl-row gate above clear).
```

**MET.** Placement (between V_meta gate and step 7), imperative register ("MUST", "MUST NOT", "HARD
BLOCK"), and blocking target (`milestone_counter++`) all match the two existing gates.

### 2. `inherited-core.md` reusable rule statement

Added section `## Design-only-milestone impl-row rule (M21-impl-row-enforcement, DIR-016)` (full
text, paste):

```
## Design-only-milestone impl-row rule (M21-impl-row-enforcement, DIR-016)

**Statement (reusable rule, mechanized gate lives in `OUTER-LOOP.md` step 6/ABSORB, HARD BLOCK on
step 7's `milestone_counter++`):** a milestone is **design-only** when EITHER its own `backlog.md`
row text states "design delivered"/"design-doc only" (or an equivalent explicit design-only marker),
OR its deliverable includes a "Done-when clauses a future implementing milestone would need" section
(or an equivalently-named dispatch-ready follow-up checklist). Every design-only milestone's ABSORB
**MUST** create a selectable, non-DONE `<M-NAME>-IMPL` candidate row in `backlog.md` — sourced to
the design doc's own follow-up checklist — **before** `milestone_counter++` may execute in step 7.
Leaving the implementation follow-up as prose only (no row) is **NOT** a valid resolution: SELECT
(`OUTER-LOOP.md` step 1) only ever considers non-DONE `backlog.md` rows, so a design-only milestone
that completes without materializing its own `-IMPL` row has deferred its implementation to a
candidate list SELECT structurally cannot reach — a deferral to never, not a deferral to later.

**Why a HARD BLOCK, same shape as the V_meta consolidation-lag gate and the adversarial-audit gate:**
un-enforced convention already failed twice out of three recent design milestones before this rule
existed (DIR-016's finding): `M-CLI-EDIT-PARITY` (m14) correctly produced `M-CLI-EDIT-PARITY-IMPL`
(SELECTed and closed at m16), but `M-TASK-BACKLOG-PROJECTION` (m13) and `M-TASK-TO-PLAN-SKILL-DESIGN`
(m17) did not — the mechanism only works when it cannot be silently skipped. This mirrors DIR-002's
general finding ("enforcement half never built") applied one level up, to the loop's own
design→implementation hand-off.

**Mechanical check:** `scripts/it0-impl-row-check.sh <milestone-id> [backlog-file]` — exit 0 = PASS
(milestone is not design-only, OR is design-only and its `-IMPL` row already exists and is
non-DONE); exit 1 = FAIL/FLAG (milestone is design-only and no corresponding `-IMPL` row is found in
the backlog file); exit 2 = usage/file-not-found error. Same 0/1/2 convention as
`it0-gate-hash-check.sh` and `it0-ceiling-line-budget-check.sh`.

**Scope note:** this rule requires only that the row EXISTS and is selectable — it does not require
the implementation itself to be built at the same ABSORB (that remains a future SELECT's own
milestone, per the existing design→implementation two-step this rule is defending, not collapsing).
```

**MET.**

### 3. `scripts/it0-impl-row-check.sh` — executable, 0/1/2 convention, PASS + FAIL fixtures pasted

```
$ ls -l experiments/quay-perpetual-stream/scripts/it0-impl-row-check.sh
-rwxr-xr-x 1 ... it0-impl-row-check.sh
```

PASS fixture (real backlog.md, current state):

```
$ ./scripts/it0-impl-row-check.sh M-CLI-EDIT-PARITY backlog.md; echo "exit=$?"
PASS: M-CLI-EDIT-PARITY is design-only (row text contains 'design delivered'), and a 'M-CLI-EDIT-PARITY-IMPL' row already exists in backlog.md (row's own current status is out of this check's scope — see script header note).
exit=0
```

FAIL fixture (backlog.md as it stood BEFORE this milestone's sweep, reconstructed via
`git show e4626ac:...backlog.md`):

```
$ git show e4626ac:experiments/quay-perpetual-stream/backlog.md > /tmp/backlog-pre-sweep.md
$ ./scripts/it0-impl-row-check.sh M-TASK-BACKLOG-PROJECTION /tmp/backlog-pre-sweep.md; echo "exit=$?"
FAIL: M-TASK-BACKLOG-PROJECTION is design-only (row text contains 'design delivered'), but no 'M-TASK-BACKLOG-PROJECTION-IMPL' row was found in /tmp/backlog-pre-sweep.md. Per the design-only-milestone impl-row rule (DIR-016 / M21-impl-row-enforcement), ABSORB must create this selectable non-DONE row before milestone_counter++ may execute.
exit=1
```

Usage-error fixture (exit 2):

```
$ ./scripts/it0-impl-row-check.sh M-DOES-NOT-EXIST backlog.md; echo "exit=$?"
ERROR: no backlog row found for milestone id 'M-DOES-NOT-EXIST' in backlog.md
exit=2
```

Same FAIL fixture re-run against the CURRENT (post-sweep) `backlog.md`, now PASSing (demonstrating
the gate actually closes when the row is created):

```
$ ./scripts/it0-impl-row-check.sh M-TASK-BACKLOG-PROJECTION backlog.md; echo "exit=$?"
PASS: M-TASK-BACKLOG-PROJECTION is design-only (row text contains 'design delivered'), and a 'M-TASK-BACKLOG-PROJECTION-IMPL' row already exists in backlog.md (row's own current status is out of this check's scope — see script header note).
exit=0
```

**MET** — real PASS, FAIL, and usage-error runs, all pasted (not described), plus a before/after PASS
transition demonstrating the gate's actual enforcement effect.

### 4. `backlog.md` new `M-TASK-BACKLOG-PROJECTION-IMPL` row, sourced to DIR-015 + design doc §15

Row added (full text in `backlog.md`); sources column reads: `DIR-015 item 1 (satisfied by this
row) + DIR-015 item 2 (this row's own future SELECT work) + the m13 design doc
docs/proposals/exp5-task-backlog-primitive-projection.md §15`. Description column enumerates every
§15 checklist item (id-scheme update, ignore-list extension, `resolved` vocabulary, forward-looking
task creation, M01-M12 backfill, SELECT/`task_list` read wiring, ABSORB provenance-append wiring,
regeneration script, anti-drift check, Web UI verification, full test suite, scoped `git diff
--stat`). Status column: `pending (created m21, M-IMPL-ROW-ENFORCEMENT retroactive sweep,
scripts/it0-impl-row-check.sh M-TASK-BACKLOG-PROJECTION backlog.md verdict: FAIL/absent before this
row's creation — see M21 iteration-1 report)`.

**MET.**

### 5. Task-to-plan follow-up sweep disposition — explicitly recorded, not silently skipped

Ran the script against the naming-convention id for the m17 design milestone:

```
$ ./scripts/it0-impl-row-check.sh M-TASK-TO-PLAN-SKILL-DESIGN /tmp/backlog-pre-sweep.md; echo "exit=$?"
FAIL: M-TASK-TO-PLAN-SKILL-DESIGN is design-only (row text names the 'Done-when clauses a future implementing milestone' follow-up checklist convention), but no 'M-TASK-TO-PLAN-SKILL-DESIGN-IMPL' row was found in /tmp/backlog-pre-sweep.md. Per the design-only-milestone impl-row rule (DIR-016 / M21-impl-row-enforcement), ABSORB must create this selectable non-DONE row before milestone_counter++ may execute.
exit=1
```

**Verdict: FAIL under the exact naming convention** (`M-TASK-TO-PLAN-SKILL-DESIGN-IMPL` does not
exist and was never going to be checked as satisfied by a differently-named row — the script does
exact-id matching by design, matching the rule's own `<M-NAME>-IMPL` naming convention).

**Substantive review (not just the script's literal id match) confirms this FAIL is a real gap, not
a false positive from the naming mismatch:** `M-TASK-TO-PLAN-SKILL-PROPOSAL-STEP` (DONE m20) is the
only existing follow-up row, and its own row text explicitly scopes to "Phase 6 of
`docs/plans/3-7-quay-task-to-plan-skill.md`" and states "Phase 7 (plan step, TDD gate, DISPATCH
wiring) explicitly deferred" and "**Phase 7 ... remains explicitly open future work** — not built,
not wired." DIR-014 (the standing ask covering exactly this Phase 7 scope) is still `status: pending`
— not archived, not resolved — and had no dedicated selectable `backlog.md` row of its own; its
"requested action" sat as directive-file prose only. This is precisely DIR-016's "deferral to never"
pattern: SELECT only reads `backlog.md` rows, not `directives/pending/*.md` prose.

**Disposition: row CREATED** — `M-TASK-TO-PLAN-SKILL-IMPL-PHASE7`, sourced to `DIR-014 (still
pending) items 1-3, following on M-TASK-TO-PLAN-SKILL-PROPOSAL-STEP's (m20) Phase-6-only
scope-down`. Not judged not-applicable, because both the script's own verdict AND the substantive
row-text/DIR-status review independently agree the gap is real.

**MET** — the disposition (row created, not "judged not-applicable") is recorded explicitly with the
script's own verdict pasted as the evidence basis, per the charter's instruction to let the verdict
decide rather than guess.

### 6. `git diff --stat` scope confirmation

```
$ git diff --stat e4626ac
 experiments/quay-perpetual-stream/OUTER-LOOP.md    | 20 ++++-
 experiments/quay-perpetual-stream/backlog.md       |  2 +
 ...andidate-row-for-every-design-only-milestone.md | 41 ++++++++--
 ...ion-implementation-as-a-selectable-candidate.md |  9 +++
 .../quay-perpetual-stream/inherited-core.md        | 32 ++++++++
 .../scripts/it0-impl-row-check.sh                  | 94 ++++++++++++++++++++++
 6 files changed, 192 insertions(+), 6 deletions(-)
```

Files: `OUTER-LOOP.md`, `backlog.md`, the new script, `inherited-core.md`, DIR-016 (renamed
pending→archive, Resolution filled), DIR-015 (partial-progress note, status unchanged/still
pending). No product code, no unrelated docs. This iteration report itself lives outside the git
diff scope check (it is written to `milestones/M21-impl-row-enforcement/iterations/` at the outer
repo path, not inside this worktree's tracked diff against `e4626ac`, matching how prior milestones'
own iteration reports are authored/merged at the outer level) — consistent with Done-when clause 8's
"own charter/iteration-report/backlog/dashboard bookkeeping" carve-out.

**MET.**

### 7. Existing test-suite coverage of `scripts/` — N/A, stated explicitly with reason

```
$ cat package.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('scripts'))"
None
```

No `package.json` test script exists at the repo root, and no test harness (Jest/Mocha/shell-test
runner) covers `experiments/quay-perpetual-stream/scripts/*.sh` anywhere in this repo — confirmed by
the absence of any `*.test.*` file under that directory and the same absence the prior `it0-*.sh`
scripts (`it0-gate-hash-check.sh`, `it0-ceiling-line-budget-check.sh`) were verified without. Per
that established precedent, direct fixture runs (Done-when clause 3's PASS/FAIL/usage-error
transcripts above) are the accepted evidence in lieu of a test-harness run.

**MET (N/A, reason stated, mirrors prior precedent).**

### 8. This milestone's own bookkeeping additions permitted under clause 6's carve-out

This iteration report and this milestone's own charter dispatch bookkeeping are the only
"bookkeeping" additions from this iteration; no `dashboard.md` edits were made from inside this
worktree (dashboard updates are the outer-loop's own ABSORB-time responsibility across both inner
iterations' merged result, not each inner iteration's individual scope — consistent with how
`git diff --stat` above shows no `dashboard.md` change from this branch).

**MET.**

## DIR-016 archival

`directives/pending/DIR-016-*.md` moved to `directives/archive/DIR-016-*.md` (`git mv`, preserving
history), `status: pending` → `status: applied`, and a full `## Resolution` section added
(resolved_by/outcome/evidence, mirroring the DIR-013 precedent at M19). See the archived file for
the complete evidence list (mirrors the Done-when write-up above, item-by-item against DIR-016's own
4 requested-action items).

## DIR-015 — NOT archived, item 1 noted satisfied

DIR-015 stays `status: pending`. A "Partial-progress note" was appended stating item 1 (create the
selectable row) is now satisfied by this milestone's new `M-TASK-BACKLOG-PROJECTION-IMPL` row, and
item 2 (charter + dispatch the actual implementation) remains open as that row's own future SELECT
work — per the charter's explicit instruction not to archive DIR-015 and not to implement
`M-TASK-BACKLOG-PROJECTION`'s design itself.

## Non-goals honored

- Did not implement `M-TASK-BACKLOG-PROJECTION`'s design (DIR-015 item 2) — only created its
  selectable row.
- Did not build DIR-014's Phase 7 content itself (plan step, TDD gate, DISPATCH wiring,
  diversity-policy de-optionalization) — only created the selectable row that lets a future SELECT
  reach it.
- Did not re-open or re-score any already-DONE milestone's realized Δv.
- Did not attempt any task-projection/Web-UI-visibility work for DIR-016 item 4 — recorded as a
  dependency note in the new `M-TASK-BACKLOG-PROJECTION-IMPL` row's own text only.

## Reflection

The self-testing catch (item 2 in "Design decisions") is the most load-bearing finding of this
iteration: an initial literal reading of "selectable, non-DONE" would have made the gate flag its own
success cases as failures forever, which — if merged as written — would have produced a permanently
un-clearable false-positive gate the very first time it worked as intended (`M-CLI-EDIT-PARITY-IMPL`
going DONE at m16). Running the script against real backlog data immediately surfaced this before it
reached the shared branch. The task-to-plan disposition (item 3) required looking past the exact
`<M-NAME>-IMPL` naming convention to confirm the substantive gap was real rather than a script
artifact — both the mechanical check and independent review agreed, which is the intended discipline
("let the verdict decide, don't guess" plus don't blindly trust a script that hasn't been
cross-checked against the underlying facts it's modeling).
