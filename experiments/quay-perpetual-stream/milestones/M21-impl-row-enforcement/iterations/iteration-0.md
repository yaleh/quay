# M21-impl-row-enforcement — iteration-0

**Worktree:** `milestones/M21-impl-row-enforcement/worktrees/iteration-0`, branch `exp5-m21-iteration-0`,
off pre-charter base `e4626ac`.

## HARD GATES evidence

```
$ git rev-parse --show-toplevel
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M21-impl-row-enforcement/worktrees/iteration-0
$ git branch --show-current
exp5-m21-iteration-0
```

`git diff --stat e4626ac` (final, at end of iteration — see full transcript at the bottom of this
report too):

```
 experiments/quay-perpetual-stream/OUTER-LOOP.md    | 19 ++++++
 experiments/quay-perpetual-stream/backlog.md       |  3 +-
 .../DIR-016-absorb-must-materialize-an-impl-candidate-row-for-every-design-only-milestone.md | 39 ++++++++++--
 .../DIR-015-materialize-the-m-task-backlog-projection-implementation-as-a-selectable-candidate.md | 10 +++
 experiments/quay-perpetual-stream/inherited-core.md | 48 ++++++++++++++
 .../scripts/it0-impl-row-check.sh | 74 ++++++++++++++++++++++
 6 files changed, 187 insertions(+), 6 deletions(-)
```

(plus this iteration report / dashboard bookkeeping itself, permitted under Done-when clause 8's
carve-out — the milestone's own `milestones/M21-impl-row-enforcement/` tree.)

## it0 systematic-explore checks (pre-dispatch, re-confirmed here)

```
$ ./experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference experiments/quay-perpetual-stream/charters/M21-impl-row-enforcement.md
PASS: experiments/quay-perpetual-stream/charters/M21-impl-row-enforcement.md GATE-HASH-REF (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93) matches current pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) sha256.
exit: 0

$ ./experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh experiments/quay-perpetual-stream/charters/M21-impl-row-enforcement.md
PASS: experiments/quay-perpetual-stream/charters/M21-impl-row-enforcement.md — scope within the small-milestone norm (no declared line budget > 2000, in-scope item count at or under threshold 8). No phase/stage plan required.
exit: 0
```

Both gates open dispatch cleanly; DIR-015/DIR-016 confirmed OPEN/pending directly (both files
existed under `directives/pending/` with `status: pending` before this iteration touched them).

---

## Done-when clause 1 — `OUTER-LOOP.md` step 6 HARD BLOCK clause

Added text (inserted into step 6/ABSORB, directly before the existing Adversarial-audit gate, same
placement register as the V_meta-lag gate that follows it):

```
   - **Impl-row gate (DIR-016 / M21-impl-row-enforcement, HARD BLOCK on step 7's
     `milestone_counter++`):** before this milestone may be marked DONE / `milestone_counter`
     incremented in step 7 below, determine whether this milestone is **design-only** — its own
     `backlog.md` row states "design delivered" / "design-doc only", OR its deliverable includes a
     "Done-when clauses a future implementing milestone would need" section (or equivalent). If it
     IS design-only, this ABSORB **MUST** create a corresponding **selectable, non-DONE
     `<M-NAME>-IMPL` candidate row** in `backlog.md`, sourced to the design doc's own "Done-when
     clauses a future implementing milestone would need" checklist (or the nearest equivalent
     section), before `milestone_counter++` in step 7 may execute. Leaving the implementation
     follow-up as prose only (a "still requires a future SELECT" sentence with no row) does **NOT**
     satisfy this gate — it is the exact drop-through DIR-016 was filed to close. Run
     `scripts/it0-impl-row-check.sh <milestone-id> backlog.md` to verify mechanically rather than
     eyeballing the row; a non-zero exit means the row is missing or malformed and step 7 MUST NOT
     proceed until it is created and the check re-run clean. This is the same HARD BLOCK
     shape/placement as the V_meta consolidation-lag gate and the adversarial-audit gate below —
     unambiguously blocking, not advisory. If this milestone is NOT design-only (it shipped
     product/method-infra code, or is itself an `-IMPL` implementation of a prior design), this gate
     is a documented no-op: state plainly in the ABSORB log entry that the milestone is not
     design-only and why, rather than silently omitting the check.
```

This matches the same imperative/blocking register as the neighboring gates ("MUST", "HARD BLOCK",
"MUST NOT proceed") and is placed inside step 6 (ABSORB), blocking step 7's `milestone_counter++`
exactly like the V_meta consolidation-lag gate. **SATISFIED.**

## Done-when clause 2 — `inherited-core.md` reusable rule statement

Added a new top-level section "Design-only milestone → mandatory `-IMPL` row rule
(M21-impl-row-enforcement, DIR-016)" at the end of `inherited-core.md`, containing: the problem
statement (condensed from DIR-016's finding), a 5-point operational rule (definition of
design-only, the mandatory action, the HARD BLOCK framing, the mechanical-check requirement, and
the retroactive-scope note), and a source citation to DIR-016/`directives/archive/DIR-016-*.md`.
Full text:

```
## Design-only milestone → mandatory `-IMPL` row rule (M21-impl-row-enforcement, DIR-016)

**The problem this rule closes (DIR-016's finding, condensed):** a design-only milestone completes,
marks itself DONE, and defers its implementation to "a future SELECT" in prose — but SELECT
(`OUTER-LOOP.md` step 1) only considers non-DONE `backlog.md` candidate rows, so a deferral with no
row is a deferral to never. Evidence: `M-CLI-EDIT-PARITY` (design, DONE m14) correctly got an
`-IMPL` row (SELECTed and completed at m16); `M-TASK-BACKLOG-PROJECTION` (design, DONE m13) did
NOT (DIR-015); `M-TASK-TO-PLAN-SKILL-DESIGN` (design, DONE m17) did NOT (its follow-up sat unqueued
until DIR-014 was hand-filed). Whether a design milestone's implementation ever becomes reachable
depended entirely on the ABSORB agent *remembering* to hand-author an `-IMPL` row — an unenforced
convention that silently failed 2 of 3 times.

**The rule, stated operationally (reusable across milestones, mirrored in `OUTER-LOOP.md` step 6's
Impl-row gate):**

1. **Definition — "design-only milestone."** [...(a)/(b) definition, verbatim in the file...]
2. **The mandatory action.** [...]
3. **HARD BLOCK, not advisory.** [...]
4. **Mechanical check, not eyeballing.** [...]
5. **Retroactive scope.** [...]

Source: DIR-016 [...], resolved by M21-impl-row-enforcement. See `directives/archive/DIR-016-*.md`'s
`## Resolution` section for the full evidence trail.
```

(Full unabridged text is in the committed `inherited-core.md` file itself — reproduced here
condensed for report length; see `git diff e4626ac -- experiments/quay-perpetual-stream/inherited-core.md`
for the exact committed text.) **SATISFIED.**

## Done-when clause 3 — `scripts/it0-impl-row-check.sh` PASS/FAIL fixtures

Script created at `experiments/quay-perpetual-stream/scripts/it0-impl-row-check.sh`, executable,
0/1/2 exit-code convention (0=pass/no-op, 1=flag/fail, 2=usage error), mirroring
`it0-gate-hash-check.sh`/`it0-ceiling-line-budget-check.sh`'s header-comment + argument-parsing
style.

**Synthetic fixtures (constructed under `/tmp/it0-impl-row-fixtures/`, real command output):**

```
=== PASS fixture (design-only WITH -IMPL row) ===
$ ./scripts/it0-impl-row-check.sh M-FOO-DESIGN /tmp/it0-impl-row-fixtures/fixture-pass-with-impl.md
PASS: 'M-FOO-DESIGN' row in /tmp/it0-impl-row-fixtures/fixture-pass-with-impl.md is design-only, AND its 'M-FOO-DESIGN-IMPL' row exists — Impl-row gate satisfied.
exit: 0

=== FAIL fixture (design-only WITHOUT -IMPL row) ===
$ ./scripts/it0-impl-row-check.sh M-BAR-DESIGN /tmp/it0-impl-row-fixtures/fixture-fail-no-impl.md
FAIL/FLAG: 'M-BAR-DESIGN' row in /tmp/it0-impl-row-fixtures/fixture-fail-no-impl.md is design-only, but NO 'M-BAR-DESIGN-IMPL' row was found. Per the Impl-row gate (OUTER-LOOP.md step 6 / inherited-core.md's 'Design-only milestone -> mandatory -IMPL row rule', DIR-016), this milestone's ABSORB MUST create a selectable non-DONE 'M-BAR-DESIGN-IMPL' backlog row before milestone_counter++ (step 7) may execute.
exit: 1

=== PASS fixture (not design-only, no-op) ===
$ ./scripts/it0-impl-row-check.sh M-BAZ-IMPL /tmp/it0-impl-row-fixtures/fixture-pass-not-design.md
PASS: 'M-BAZ-IMPL' row in /tmp/it0-impl-row-fixtures/fixture-pass-not-design.md is not design-only (no 'design delivered'/'design(-)doc only' marker found in its notes) — Impl-row gate is a no-op for this milestone.
exit: 0

=== usage error (missing row) ===
$ ./scripts/it0-impl-row-check.sh M-NOPE /tmp/it0-impl-row-fixtures/fixture-pass-not-design.md
ERROR: no backlog row found for id 'M-NOPE' in /tmp/it0-impl-row-fixtures/fixture-pass-not-design.md (expected a line matching '| M-NOPE | ...')
exit: 2

=== usage error (bad args) ===
$ ./scripts/it0-impl-row-check.sh
Usage: ./scripts/it0-impl-row-check.sh <milestone-backlog-id> [backlog-file]
exit: 2
```

At least one PASS and one FAIL fixture demonstrated with real, pasted (not described) output.
**SATISFIED.**

## Done-when clause 4 — `M-TASK-BACKLOG-PROJECTION-IMPL` backlog row

New row added to `backlog.md`'s "DIR-005-sourced candidate" table, immediately after
`M-IMPL-ROW-ENFORCEMENT`'s own row (this milestone marking itself DONE as part of the same edit),
non-DONE (`pending (created m21 by M21-impl-row-enforcement's retroactive sweep; not yet
SELECTed)`), sourced to `DIR-015 + docs/proposals/exp5-task-backlog-primitive-projection.md §15`.
Row also carries the DIR-016 item 4 visibility-dependency note (see Done-when clause 8 note below)
and states explicitly that it satisfies DIR-015 item 1 as a byproduct while leaving DIR-015 item 2
(the actual implementation) as its own future SELECT work. **SATISFIED.**

Re-run of the new check script confirms the row closes the gap the script itself detects:

```
=== M-TASK-BACKLOG-PROJECTION (real, pre-sweep) ===
$ ./scripts/it0-impl-row-check.sh M-TASK-BACKLOG-PROJECTION backlog.md
FAIL/FLAG: 'M-TASK-BACKLOG-PROJECTION' row in backlog.md is design-only, but NO 'M-TASK-BACKLOG-PROJECTION-IMPL' row was found. [...]
exit: 1

=== M-TASK-BACKLOG-PROJECTION (real, post-sweep, after this iteration's edit) ===
$ ./scripts/it0-impl-row-check.sh M-TASK-BACKLOG-PROJECTION backlog.md
PASS: 'M-TASK-BACKLOG-PROJECTION' row in backlog.md is design-only, AND its 'M-TASK-BACKLOG-PROJECTION-IMPL' row exists — Impl-row gate satisfied.
exit: 0
```

## Done-when clause 5 — task-to-plan sweep disposition (recorded explicitly)

Ran the new script against every candidate task-to-plan row in the real `backlog.md`:

```
=== M-CLI-EDIT-PARITY (real, control case, already has -IMPL — confirms script doesn't
     false-positive on an already-resolved design-only row) ===
$ ./scripts/it0-impl-row-check.sh M-CLI-EDIT-PARITY backlog.md
PASS: 'M-CLI-EDIT-PARITY' row in backlog.md is design-only, AND its 'M-CLI-EDIT-PARITY-IMPL' row exists — Impl-row gate satisfied.
exit: 0

=== M-TASK-TO-PLAN-SKILL-DESIGN (m17 design row) ===
$ ./scripts/it0-impl-row-check.sh M-TASK-TO-PLAN-SKILL-DESIGN backlog.md
PASS: 'M-TASK-TO-PLAN-SKILL-DESIGN' row in backlog.md is not design-only (no 'design delivered'/'design(-)doc only' marker found in its notes) — Impl-row gate is a no-op for this milestone.
exit: 0

=== M-TASK-TO-PLAN-SKILL-PROPOSAL-STEP (m20 follow-up row) ===
$ ./scripts/it0-impl-row-check.sh M-TASK-TO-PLAN-SKILL-PROPOSAL-STEP backlog.md
PASS: 'M-TASK-TO-PLAN-SKILL-PROPOSAL-STEP' row in backlog.md is not design-only (no 'design delivered'/'design(-)doc only' marker found in its notes) — Impl-row gate is a no-op for this milestone.
exit: 0
```

**The script's own verdict on `M-TASK-TO-PLAN-SKILL-DESIGN` is PASS/no-op** — its `backlog.md`
notes text (`**DONE (m17, 2026-07-18).** Both iterations independently matured...`) does not carry
the "design delivered"/"design-doc only" phrase the script's detector keys on (that phrase is
specific wording used by the m13/m14 design rows, not a universal convention). Taken at face value
this would mean the script does not flag it as needing an `-IMPL` row.

However, a closer read shows M17's own deliverable DOES meet the charter's alternate,
broader definition of design-only (clause (b): "its deliverable includes a 'Done-when clauses a
future implementing milestone would need' section") — `docs/proposals/exp5-quay-task-proposal-plan-skill.md`
has exactly such a section at `## 17. Dispatch-ready Done-when clauses a future implementing
milestone would need`. So the phrase-matching script under-flags this specific historical case (a
real, documented limitation of the mechanical detector — recorded here rather than silently
patched around, since patching the detector to also key on "§N Done-when clauses a future
implementing milestone" section headings would require parsing the *design doc*, not just the
backlog row text, which is out of this milestone's small-milestone scope; a future refinement of
`it0-impl-row-check.sh` could add that as a second detection heuristic).

**Disposition reached by inspecting the actual tracking state (not the script alone), per the
charter's "let the verdict decide, don't guess" instruction combined with human judgment on the
detector's known limitation:** M17's implementation follow-up is **judged NOT-APPLICABLE for a new
`M-TASK-TO-PLAN-SKILL-IMPL-PHASE7` row**, because it is already concretely and adequately tracked
by two existing mechanisms:

1. **`M-TASK-TO-PLAN-SKILL-PROPOSAL-STEP`** (m20, DONE) — explicitly built Phase 6 of
   `docs/plans/3-7-quay-task-to-plan-skill.md` and its own row text states verbatim: "**Phase 7
   (plan step, plan step, grounded convergent check, TDD ≥80% hard gate, `OUTER-LOOP.md` DISPATCH
   wiring, de-optionalizing the two-class diversity policy) remains explicitly open future work**
   — not built, not wired, per charter's explicit scope-down from DIR-014's full ask."
2. **DIR-014** (`directives/pending/DIR-014-*.md`, still `status: pending`, NOT archived) — its
   Requested-action items 2-4 ("Wire DISPATCH to invoke it", "De-optionalize for the development
   class", "Dogfood + record") are exactly M17's implementation follow-up (the Phase-7-class work),
   already filed as a real, selectable, non-DONE directive.

Since DIR-014 is itself a live, pending, human-filed directive that will be drained into a
`backlog.md` candidate row at a future SELECT boundary (per `OUTER-LOOP.md` step 0's DRAIN step —
the same mechanism every other directive in this experiment uses to become selectable), creating a
SECOND, redundant `M-TASK-TO-PLAN-SKILL-IMPL-PHASE7` backlog row now would duplicate tracking
rather than close a gap: DIR-014 already IS the selectable candidate for this follow-up, once
drained. **No new row created for this case.** **SATISFIED** (disposition recorded explicitly with
the script's own verdict pasted as evidence, not silently skipped).

## Done-when clause 6 — `git diff --stat` scope confirmation

```
$ git diff --stat e4626ac -- experiments/quay-perpetual-stream
 experiments/quay-perpetual-stream/OUTER-LOOP.md    | 19 ++++++
 experiments/quay-perpetual-stream/backlog.md       |  3 +-
 .../DIR-016-absorb-must-materialize-an-impl-candidate-row-for-every-design-only-milestone.md | 39 ++++++++++--
 .../DIR-015-materialize-the-m-task-backlog-projection-implementation-as-a-selectable-candidate.md | 10 +++
 experiments/quay-perpetual-stream/inherited-core.md | 48 ++++++++++++++
 .../scripts/it0-impl-row-check.sh | 74 ++++++++++++++++++++++
 6 files changed, 187 insertions(+), 6 deletions(-)
```

Scope confirmed limited to: `OUTER-LOOP.md`, `inherited-core.md`, the new script, `backlog.md`, and
the two touched directive files (DIR-016 move+resolution, DIR-015 status note) — all within this
milestone's own bookkeeping scope. This milestone's own iteration report (this file, under
`milestones/M21-impl-row-enforcement/iterations/`) is the only other addition, permitted under
clause 8's carve-out. No unrelated files touched. **SATISFIED.**

## Done-when clause 7 — test suite / N/A statement

No test harness in this repo covers `experiments/quay-perpetual-stream/scripts/*.sh` — confirmed by
searching for `.test.` files under any `scripts` path and grepping for `it0-` references inside any
test file; none found. This mirrors every prior `it0-*.sh` script's own verification precedent
(M02-gates, M18-milestone-model-ceiling-and-diversity-policy): direct fixture runs (Done-when clause
3 above) are the accepted evidence, not a package-level test-suite run. **N/A, direct fixture runs
are the evidence, per established precedent.** **SATISFIED.**

## Done-when clause 8 — bookkeeping carve-out

This iteration report + the milestone's own `milestones/M21-impl-row-enforcement/` tree are the only
bookkeeping additions beyond the four in-scope files (+the two directive files), consistent with
every prior milestone's convention. **SATISFIED.**

---

## Sweep summary table (DIR-016 item 3 / this milestone's Done-when clause 5)

| Milestone (design-only) | `-IMPL`-style follow-up disposition | Evidence |
|---|---|---|
| M-CLI-EDIT-PARITY (m14) | Row already exists (`M-CLI-EDIT-PARITY-IMPL`, DONE m16) — no action needed, confirmed via script PASS. | script PASS above |
| M-TASK-BACKLOG-PROJECTION (m13) | Row created THIS milestone (`M-TASK-BACKLOG-PROJECTION-IMPL`, non-DONE) — satisfies DIR-015 item 1. | `backlog.md` new row; script FAIL→PASS transition above |
| M-TASK-TO-PLAN-SKILL-DESIGN (m17) | Judged NOT-APPLICABLE for a new row — already tracked by `M-TASK-TO-PLAN-SKILL-PROPOSAL-STEP` (m20, Phase 6 DONE, Phase 7 explicitly deferred in its own row text) + DIR-014 (pending, items 2-4 = Phase 7). Script's own phrase-based detector returns PASS/no-op on this row (a recorded limitation — the row lacks the "design delivered" phrase even though the design doc has a real §17 Done-when-for-future-implementer section). | script PASS (recorded limitation, disposition reasoned manually per above) |

## Directive disposition

- **DIR-016: archived.** Moved `directives/pending/DIR-016-*.md` → `directives/archive/DIR-016-*.md`,
  `status: pending` → `status: applied`, `## Resolution` filled in with resolved_by/outcome/evidence
  for all 4 requested-action items, mirroring the DIR-013 precedent (M19).
- **DIR-015: stays pending, NOT archived.** A `## Resolution`-adjacent "Status note" appended stating
  item 1 (row creation) is now satisfied by this milestone's sweep, item 2 (actual implementation)
  remains fully open as the new row's own future SELECT work — per charter instruction, this DIR is
  explicitly NOT archived, only its item 1 is addressed.

## Reflection

- The mechanical check's phrase-based design-only detector is deliberately simple (keys on backlog
  notes text, not design-doc structure) to stay inside the small-milestone norm — this iteration
  surfaced a real, honestly-recorded limitation (M17's case) rather than silently expanding the
  script's scope to parse design docs, which would have been its own separate, larger piece of work.
  A future refinement is named but not built here.
- The two HARD BLOCK gates (Impl-row gate, V_meta consolidation-lag gate) are now textually adjacent
  in `OUTER-LOOP.md` step 6, in the same imperative register, making the ABSORB step's blocking
  structure easier for a future reader to scan as a set rather than a scattered set of prose asides.
- **Realized Δv = 0**, by design (method infra, mirrors M13/M14/M16/M17/M18/M19/M20's zero-VT
  precedent, per charter). Adversarial-audit gate: neither cadence-rule condition fires (this
  milestone's SELECT-time value-typed ledger entry is governance-integrity + risk/option, not
  capability-growth; no iteration-0 self-exemption from iteration-1 was recommended) — documented
  no-op per `OUTER-LOOP.md`'s own instruction for the default case.
