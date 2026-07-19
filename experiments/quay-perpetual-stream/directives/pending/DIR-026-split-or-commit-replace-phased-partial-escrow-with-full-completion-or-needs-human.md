# DIR-026

- status: pending
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-19
- title: Replace the "artifacts necessary-not-sufficient TOLERATES phased/partial delivery" escrow model with SPLIT-OR-COMMIT — at planning, any task that cannot be FULLY completed this milestone MUST be split (parent/children) into completable sub-tasks and one selected; once a milestone starts it MUST fully complete its selected task or be marked `needs-human`; and `needs-human` is legitimate ONLY for factors OUTSIDE project control (external service/resource), NEVER for in-project difficulty (architecture mismatch, algorithm complexity, change volume), which MUST be resolutely completed

## Finding

The phrase "artifacts necessary-not-sufficient" carries TWO different readings
in exp5's substrate, and one of them is the root enabler of the "never gets
implemented" disease this stream keeps fighting:

- **Reading A — anti-fakery (KEEP).** "A file created / a green fixture is
  necessary but NOT sufficient — done means a REAL object actually operated
  through the mechanism, not an artifact." This is the correct
  designed-not-wired guard (DIR-021/022/025's DoD). It must survive.
- **Reading B — phased/partial tolerance (DELETE).** The same phrase is read as
  "the DoD tolerates phased/partial delivery, so a milestone may do a fraction
  and leave the parent `pending`." This is the deferral loophole.
  `M40-dir014-task-canonical-lifecycle-record.md` line 37 states it verbatim:
  "does the '...necessary-not-sufficient' DoD tolerate phased/partial delivery
  — YES." M40 then did only DIR-014 item 6 and left items 2/3/5 as prose
  "deferred to a later phase" — with NO board rows, i.e. DIR-016's own
  "deferred + no row = deferred to never." Across M17/M18/M20/M22/M40 the CORE
  of DIR-012/DIR-014 (item 2 — wire the proposal→plan pipeline into DISPATCH)
  was deferred FIVE times while each milestone did an easier adjacent slice.

Root cause: "tolerate phased/partial delivery" gives the loop a standing licence
to keep a parent directive perpetually `pending` by doing slices, so the hardest
core item is deferrable forever. The fix is not more enforcement clauses on top
of the phased model — it is to remove the phased-partial middle state entirely.

The primitives to replace it already exist (no new engine needed):
- **Split:** `quay task edit --parent/--children` (M12-abi-parent-write) —
  a task can be split into completable children on the board.
- **Failure terminal state:** the lifecycle `status` model already has
  `needs-human` (QENG-3 / `packages/quay/src/gate/lifecycle.js`:
  `"needs-human": { forward: null, back: null }` — a terminal state with no
  automated edge). Reuse it as the explicit "marked failed" state.
- **Unit-size bound:** the ≤~2000-line milestone ceiling (M18) already bounds a
  unit; split until each unit fits AND is fully completable.
- **Precedent:** DIR-016 already forces a design-only milestone to materialize a
  board `-IMPL` row instead of prose-deferring its implementation. This DIR
  generalizes DIR-016 to ALL partial completion: the remainder becomes explicit
  board children, never prose.

## Requested action

Adopt **SPLIT-OR-COMMIT** as the stream's completion discipline, replacing the
phased/partial escrow. Concretely:

1. **Delete Reading B; preserve Reading A as a standalone line.** In every place
   the "tolerate phased/partial delivery" reading appears or is derivable
   (audited set as of 2026-07-19: `M40`/`M41` charters, `DIR-014`/`DIR-022`/
   `DIR-025` DoD sections, `.claude/skills/quay-directive/SKILL.md`'s DoD
   instruction, and any `OUTER-LOOP.md`/`inherited-core.md` DoD prose), remove
   the phased/partial-tolerance wording. In its place keep ONE explicit
   anti-fakery sentence (Reading A), e.g.: *"Done = the real object actually
   operated through the mechanism (not a file created or a fixture passed).
   A milestone is either fully done or `needs-human`; there is no partial/pending
   completion state."* The real-landing guarantee stays; the "you may do a slice
   and stay pending" reading goes.

2. **SELECT / planning (OUTER-LOOP.md step 1) — mandatory split rule.** If, at
   charter time, a candidate task cannot be FULLY completed within this one
   milestone, the loop MUST split it via `task edit --children` into sub-tasks
   each of which IS fully completable within a milestone (recursively, until each
   child fits the ceiling AND is completable), and SELECT one child. Selecting a
   task with the intent to complete only part of it is prohibited — split first,
   then select a whole child. The remainder is now explicit board rows (children),
   never a prose "later phase."

3. **ABSORB / execution (OUTER-LOOP.md step 6) — all-or-`needs-human` rule.**
   Once a milestone has started, at ABSORB it is in exactly one of two terminal
   outcomes: (i) its selected task's AC + DoD are ALL satisfied → `done`; or
   (ii) it is set to `needs-human` (the existing terminal lifecycle state) with a
   recorded reason. There is NO "partial delivery / stays pending" outcome.
   Delete that path from step 6.

4. **`needs-human` legitimacy constraint (CRITICAL — closes the new loophole).**
   `needs-human` is legitimate ONLY when completion is blocked by a factor
   OUTSIDE project control — an external service being down, a missing external
   resource / credential / dataset, an upstream dependency not yet released, or
   equivalent. **In-project factors are NOT valid reasons and MUST be resolutely
   completed:** a mismatched/ inconvenient architecture, an overly complex
   algorithm, a large change volume, refactoring scope, or "this is hard" do NOT
   justify `needs-human` — they justify SPLITTING smaller (item 2) and then
   completing. A milestone marking `needs-human` MUST name the specific external
   blocker; a `needs-human` whose stated reason is an in-project factor is itself
   a DoD violation and must be sent back to complete (or split-and-complete).

5. **Mechanical enforcement (extend the DoD meta-enforcer).** Add a DoD clause
   (next free clause number in `inherited-core.md` + `scripts/it0-dod-check.mjs`)
   that HARD-blocks any ABSORB outcome other than {all-AC/DoD-green `done`} or
   {`needs-human` with a named external blocker}. Pin it with fixtures under
   `fixtures/dod/`: (a) a stub that ABSORBs "partial" (some AC unchecked, not
   `needs-human`) → FAIL; (b) a fully-green stub → PASS; (c) a `needs-human` stub
   whose reason is an in-project factor (e.g. "architecture mismatch") → FAIL;
   (d) a `needs-human` stub naming an external blocker → PASS. Wire into
   `scripts/dod-fixture-selfcheck.sh` (suite stays green). Also: a parent task is
   `done` iff ALL its children are `done` (mechanical, over the parent/children
   the split rule creates).

6. **Re-express DIR-014 under this model (worked example + immediate application).**
   Split the still-open `DIR-014` into explicit board child tasks — at minimum
   `DIR-014-item2` (wire DISPATCH to invoke `quay-task-to-plan`), `DIR-014-item3`
   (de-optionalize the two-class diversity policy for the development class), and
   `DIR-014-item4` (dogfood: a real development milestone actually runs through
   the wired pipeline) — via `task edit --children`, each with its own runnable
   AC/DoD, so DIR-014's remaining work is board-visible and each child is
   complete-or-`needs-human`, not a prose "later phase." DIR-014 becomes `done`
   only when all its children are `done`.

## Acceptance Criteria (runnable)

- [ ] Reading B is gone: `grep -rniE "tolerate.*(phased|partial)|phased/partial delivery"
  experiments/quay-perpetual-stream/ .claude/skills/quay-directive/` returns NO
  matches outside `milestones/*/worktrees/` history and this DIR's own file.
- [ ] Reading A survives as an explicit line: `grep -rqiE "real object.*(operated|through the mechanism)|not a file created|fixture passed" experiments/quay-perpetual-stream/inherited-core.md` exits 0.
- [ ] SELECT split rule present: `grep -qiE "split.*children|task edit --children" experiments/quay-perpetual-stream/OUTER-LOOP.md` exits 0 within step 1's text.
- [ ] ABSORB all-or-needs-human rule present: `grep -qiE "needs-human|no partial|fully done or" experiments/quay-perpetual-stream/OUTER-LOOP.md` exits 0 within step 6's text.
- [ ] `needs-human` external-only constraint present: `grep -qiE "outside project control|external (service|resource|blocker)" experiments/quay-perpetual-stream/inherited-core.md` exits 0, AND it states in-project factors (architecture/algorithm/change-volume) are NOT valid reasons.
- [ ] New DoD clause + fixtures land: `bash experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh` exits 0 with the four new stubs (partial→FAIL, full→PASS, internal-reason needs-human→FAIL, external-reason needs-human→PASS) asserted.
- [ ] DIR-014 is split on the board: `node packages/quay/bin/quay.js task get DIR-014 --json` (or the native CLI) shows non-empty `children`, and those child tasks exist with their own AC/DoD.

## Definition of Done — REAL LANDING is the bar (Reading A preserved), phased-partial DELETED

Reading A is explicitly preserved: this DIR is **NOT done** merely because the
docs were edited, the clause was written, or the fixtures pass — a file created
or a fixture passing is necessary but NOT sufficient; done means the discipline
**actually operated on a REAL milestone**. It is done **ONLY** when, on a REAL
milestone under the new rule, ALL of:
(a) a real over-scoped candidate was actually SPLIT into completable board
    children at SELECT (children exist on the board — not a prose "later phase"); AND
(b) a real milestone reached exactly one terminal outcome — `done` with every
    AC/DoD satisfied, OR `needs-human` naming a genuine EXTERNAL blocker — with
    NO partial/pending outcome available; AND
(c) the mechanical clause actually HARD-blocked a synthetic partial ABSORB and a
    synthetic internal-reason `needs-human` (fixtures c/a fail), proving the
    enforcement is real, not prose; AND
(d) `DIR-014` itself has been split into board children per item 6.
There is, from this DIR forward, **no "did a slice, parent stays pending"
state**: in-project difficulty is met by splitting smaller and completing, never
by deferral or by an internal-reason `needs-human`. Escrow discipline: until
(a)–(d) hold on a real milestone, this DIR stays `pending`.

## Human verification when exp5 marks this DIR done

1. `grep` confirms the "tolerate phased/partial delivery" wording is gone, and
   the standalone "done = real object operated (not a file/fixture)" line remains.
2. Pick the milestone that ran under the new rule: it is either fully `done` (all
   AC/DoD green) or `needs-human`. If `needs-human`, its recorded reason MUST name
   an EXTERNAL, out-of-project blocker — if the reason is an in-project factor
   (architecture, algorithm complexity, change volume, "too hard"), it is a
   VIOLATION; send it back to split-and-complete.
3. Confirm a real over-scoped candidate was SPLIT into board children at SELECT,
   not prose-deferred; and that `DIR-014` now has board children (item 2/3/4).
4. Confirm the mechanical clause really blocks: the partial stub and the
   internal-reason `needs-human` stub FAIL `it0-dod-check`; the full-done and
   external-reason stubs PASS.
5. If any milestone still ABSORBed a partial as "progress" with the parent left
   pending, or used `needs-human` for an in-project reason, it is NOT landed —
   send back.

## Resolution
<!-- added when moved to archive/, or updated in place if deferred:
- resolved_by: iteration-N / milestone M-NN
- outcome: applied | deferred | rejected
- evidence: pointer to the design doc / iteration report section / commit -->
