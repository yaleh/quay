# M17-task-to-plan-skill-design — iteration-1

**Milestone:** M17-task-to-plan-skill-design · **Iteration:** 1 (independent re-derivation, run in
parallel with iteration-0; per dispatch instructions this iteration did NOT read iteration-0's
report/materials/worktree at any point) · **Date:** 2026-07-18 · **Branch:**
`exp5-m17-iteration-1` · **Worktree:**
`experiments/quay-perpetual-stream/milestones/M17-task-to-plan-skill-design/worktrees/iteration-1`
· **Final commit:** `d961c91`

## 1. Required reading confirmation

Read in order, before any work: the M17 charter, `inherited-core.md` (in full — 52.5KB), the
current on-disk `docs/proposals/exp5-quay-task-proposal-plan-skill.md` (§1-11, the starting draft),
`DIR-012` (archived), and M14's `exp5-cli-edit-parity.md` (§2, §3, §4, §6) as structural precedent
for the Provider-capability / portable-metadata / non-goals / Done-when sections. M13's
`exp5-task-backlog-primitive-projection.md` was also consulted (§2, §8, §11, §12) for the real
mechanism detail on DIR-009 item 8's provider-tool read-path convention and the label-vs-
parent/children grouping-key decision this design reuses.

**git log check on the starting draft:** `git log --oneline -- docs/proposals/exp5-quay-task-
proposal-plan-skill.md` shows exactly **one** commit, `05a8066` ("docs(proposals): quay-task-native
proposal→plan skill + exp5 milestone-model changes"). §1-11 of the file, as checked out in this
iteration's worktree at commit `05a8066`, is therefore the current, non-stale version of the
starting draft — cited and matured, not re-derived.

**Important divergence-preservation note:** the repo-root working copy of this file (outside any
worktree) was found to be locally modified (`git status --short` showed ` M docs/proposals/
exp5-quay-task-proposal-plan-skill.md`, `git diff --stat` showed +80/-19 lines) at the time this
iteration started work. Per the dispatch instructions ("you must NOT read iteration-0's report,
materials, or any file it may have produced... under .../iterations/ or its worktree"), this
uncommitted repo-root diff was **not read or inspected** beyond confirming its existence and size —
it is presumed to be iteration-0's in-progress edit to the shared tree, and reading it would
contaminate this iteration's independent re-derivation. This iteration's own worktree, checked out
from commit `05a8066` on its own branch `exp5-m17-iteration-1`, was unaffected by that repo-root
dirty state (worktrees have independent working trees) and was used as the sole basis for this
iteration's edits.

## 2. HARD GATES (verbatim output)

**Gate 1 — pending directives:**
```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
(no output — directory is empty)
```
Disposition: N/A — no pending directives exist. This matches the charter's own expectation ("DIR-012
was already drained and archived before this milestone was chartered... Expect this to be empty").
No directive requires an applied/deferred/rejected disposition this iteration.

**Gate 2 — manda hub health:**
```
$ cat .manda/hub.addr && curl -s "$(cat .manda/hub.addr)/healthz"
http://localhost:46215
{"root":"/home/yale/work/quay"}
```

**Gate 3 — G7 reachability:**
```
$ curl -s http://localhost:4173/ -o /dev/null -w "%{http_code}\n"
200
```

**Gate 4 — worktree confirmation:**
```
$ ls -la experiments/quay-perpetual-stream/milestones/M17-task-to-plan-skill-design/worktrees/iteration-1
total 140
drwxrwxr-x 10 yale yale  4096 Jul 18 17:05 .
... (full repo checkout present: .claude, .git, .github, docs, experiments, packages, tasks, etc.)

$ cd .../worktrees/iteration-1 && git status && git log -1 --oneline && git branch --show-current
On branch exp5-m17-iteration-1
nothing to commit, working tree clean
11fd829 SELECT m17 = M-TASK-TO-PLAN-SKILL-DESIGN: dashboard log entry
exp5-m17-iteration-1
```
Worktree confirmed pre-existing on branch `exp5-m17-iteration-1` at base commit `11fd829`. All
edits this iteration were made inside this worktree; final worktree HEAD after this iteration's
commit is `d961c91` (see §3).

## 3. it0 systematic-explore checks

- **(a) Ceiling/floor arithmetic — N/A confirmed.** This milestone is zero-VT by design (discovery +
  governance-integrity value type, Δv̂=0, per the charter's Value hypothesis section). No VT-chart
  claim was introduced anywhere in this iteration's work — the only artifact produced is a design-doc
  edit; no `v-meta-ledger.md` entry, no `dashboard.md` VT-chart row was touched by this iteration
  (confirmed via `git diff --stat`, §5 below, showing only the one design-doc file changed).
- **(b) Gate-hash/transclusion** — the charter cites `GATE-HASH-REF` by reference rather than
  transcribing the HARD GATES block; this iteration report pastes the literal outputs per the
  dispatch prompt's own HARD GATES section (§2 above), which already carries the resolved literal
  gate text/commands, consistent with the "charter thinness ≠ agent prompt thinness" rule.
- **(c) Dogfooding evidence-gate** — every Done-when clause below (§4) is backed by a pasted
  doc-section reference/line-range or verbatim git output, not narrative-only assertion.
- **(d) Domain-misfit audit-channel** — this milestone edits one markdown design doc only, no live
  external system, no product code; consistent with M13/M14/M15's own doc-only precedent (charter
  §4.4d).

## 4. Work performed

Matured `docs/proposals/exp5-quay-task-proposal-plan-skill.md` (worktree path; final version at
commit `d961c91`, worktree branch `exp5-m17-iteration-1`) from its §1-11 DRAFT state to a
dispatch-ready design by appending seven new sections, §12-18, plus an updated status header and a
"Table of contents — M17 addition map":

- **§12 Quay task read/write behavior** (lines 322-425): §12.1 names the exact Provider ABI tools
  (`task_list`/`task_get`/`task_write`/`task_check`, MCP + CLI-equivalent forms, per DIR-009 item
  8's read-path convention); §12.2 specifies the proposal→`body` write-back shape as a new
  `## Proposal (quay-task-to-plan)` markdown section (body-first per DIR-011, `extra{}` optional
  native-only mirror only, with an explicit whole-section-replace regeneration discipline on
  re-grouping); §12.3 specifies milestone→task grouping as the `milestone:M-NN` label (DIR-009 §12's
  primary key, reused not reinvented) with `parent`/`children` (M12's real WRITE capability) reserved
  for the orthogonal epic-decomposition axis only.
- **§13 Proposal step** (lines 426-499): §13.1 specifies N=2-default independent blank-slate-leaning
  subagents + an adjudication step with an explicit 3-way outcome (converge/pick, converge/merge,
  diverge/escalate-to-human-with-structured-comparison — no automatic tie-break invented for genuine
  approach divergence); §13.2 gives the exact pipeline diagram showing the adjudicated output feeds
  INTO `proposal-to-plan`'s existing unchanged architect-review stage (strengthens, does not
  replace), with the complementary-error-class argument for why both are retained.
- **§14 Plan step** (lines 500-560): §14.1 specifies author (single pass) + codebase-grounded
  plan-check (separate subagent) in a round-based revise/re-check loop; §14.2 gives a **precise**
  convergence/stop condition — `Δ_round` = count of material findings, STOP when `Δ_round=0`, cap 3
  rounds, escalate to outer-loop/human if round 3 still has material findings, minimum 1 round always
  runs — presented as an explicit 3-row stop table.
- **§15 TDD ≥80%-per-stage hard gate** (lines 561-619): §15.1 states precisely what it gates
  (per-stage, ≥80% line coverage on changed lines, checked BEFORE the next stage may start) and
  carries forward the code-vs-prose scope caveat from the original draft's §8.4; §15.2 gives the
  single-implementation load-bearing rationale (independence spent upstream+downstream per the
  two-ends-clamp design, §6, leaving the TDD gate as the ONLY mechanical net on the implementation
  pass itself — explicitly ties back to the charter's own DIR-002 "enforcement half never built"
  framing).
- **§16 Provider-agnostic GitHub degradation** (lines 620-663): states explicitly that the skill has
  no provider branch, that only `extra` remains hard-error-rejected on GitHub among the fields this
  skill would plausibly touch (per M14 §2.3's post-M12 correction), quotes the exact hard-error
  message, and notes the body-first design means this floor should be a backstop, not a routinely
  exercised path.
- **§17 Done-when clauses a future implementing milestone would need** (lines 664-734): 15
  checklist-form, pasted-diff/invocation-style clauses (not narrative), matching M13 §15 / M14 §6's
  structural form — covering SKILL.md creation, both-provider round-trip verification, the
  adjudication divergence-path demonstration, the plan-check round log, both branches of the TDD
  gate (positive numeric pass AND negative under-80%-blocks-progression), the GitHub hard-error
  degradation probe, milestone/epic grouping on both providers, one full end-to-end dispatch on the
  bootstrap milestone, and the closing `git diff --stat`/full-test-suite gates M05/M13/M14 all used.
- **§18 Non-goals** (lines 735-775): five explicit, standalone non-goal statements — no Web UI
  process rendering, no `proposal-to-plan` fork/deletion, no GitHub `extra{}` storage, no new
  Provider ABI capability, and (restating the charter's own scope boundary) no `inherited-core.md`/
  `OUTER-LOOP.md` changes and no implementation/dogfooding performed in this milestone.

**File:** `docs/proposals/exp5-quay-task-proposal-plan-skill.md` (775 lines total after this
iteration's edit; was 300 lines before). Path is identical inside the worktree and at the eventual
merge target (`docs/proposals/exp5-quay-task-proposal-plan-skill.md` at repo root).

## 5. Self-assessment against the charter's 10 Binary Done-when clauses

1. **[MET]** Starting draft read in full, git revision cited explicitly: `05a8066` (§1 above, and
   the doc's own new status header names it).
2. **[MET]** Quay task read/write behavior fully specified — doc §12 (pasted section references
   above, §4 of this report).
3. **[MET]** N-independent-proposal + adjudication fully specified, including relation to
   `proposal-to-plan`'s architect-review (strengthens, not replaces) — doc §13.
4. **[MET]** Plan author + grounded-convergent-check fully specified, including a precise
   convergence/stop condition — doc §14, with the explicit `Δ_round` stop table.
5. **[MET]** TDD ≥80%-per-stage hard gate stated precisely with single-implementation rationale —
   doc §15.
6. **[MET]** Provider-agnostic GitHub degradation stated explicitly — doc §16.
7. **[MET]** Dispatch-ready Done-when checklist produced, in M13/M14's checklist form — doc §17 (15
   clauses, all checklist/pasted-evidence-shaped, none narrative-only).
8. **[MET]** Non-goals stated explicitly — doc §18 (5 standalone statements).
9. **[MET]** DIR-012 items 2/3 NOT performed this milestone — confirmed via `git diff --stat
   11fd829..HEAD` inside the worktree (§3(a) above and raw output in §2/§4): only
   `docs/proposals/exp5-quay-task-proposal-plan-skill.md` changed (501 insertions, 3 deletions);
   `inherited-core.md`, `OUTER-LOOP.md`, and no file under `.claude/skills/` were touched.
10. **[NOT YET / expected at ABSORB, not this inner iteration]** `backlog.md` gaining an
    `M-TASK-TO-PLAN-SKILL-DESIGN` row marked DONE is an outer-loop bookkeeping action taken at
    ABSORB time, not a worktree-local inner-iteration edit — this iteration's mandate (per the
    dispatch prompt) was scoped to
    `docs/proposals/exp5-quay-task-proposal-plan-skill.md` + this report only ("Do NOT modify
    anything outside `docs/proposals/exp5-quay-task-proposal-plan-skill.md` and your own iteration
    report"). Flagging this explicitly as the one clause requiring outer-loop action at
    convergence/ABSORB, not an inner-iteration gap.

**Overall: 9/10 clauses met directly by this iteration's work; clause 10 is correctly deferred to
the outer loop's ABSORB step per this iteration's own scope boundary, not an outstanding defect.**

## 6. Convergence check (§3.2's five conditions)

- **Condition 1 (Done-when complete & stable ≥1 iteration):** 9/10 clauses met this iteration;
  clause 10 is an outer-loop action, not an inner-iteration blocker. Per the charter's own framing
  ("expect condition 1... to be the natural terminus since this is a bounded doc-editing task"),
  this looks like the expected terminus — but stability requires confirmation across ≥1 further
  inner iteration (this is iteration-1; whether the outer loop finds this sufficient, or whether
  divergence against the independent iteration-0 requires a reconciliation pass, is an outer-loop
  decision this report does not preempt).
  Conditions 2-5 (ΔV<0.02 stability, ceiling/redesign, budget backstop, external HALT) are not
  independently evaluable from a single iteration's own vantage — left for outer-loop
  reconciliation against iteration-0's independent result, consistent with this milestone's explicit
  two-independent-iteration design (the divergence between iteration-0 and iteration-1 is itself the
  signal this process is designed to produce, per the dispatch instructions).

## 7. Artifacts

- `docs/proposals/exp5-quay-task-proposal-plan-skill.md` — matured design doc (worktree path:
  `experiments/quay-perpetual-stream/milestones/M17-task-to-plan-skill-design/worktrees/iteration-1/
  docs/proposals/exp5-quay-task-proposal-plan-skill.md`; same relative path at repo root once
  merged).
- Branch `exp5-m17-iteration-1`, final commit `d961c91` ("M17 iteration-1: mature quay-task-to-plan
  skill design to dispatch-ready"). **Not merged to master** — left for the outer loop, per dispatch
  instructions.
- This report: `experiments/quay-perpetual-stream/milestones/M17-task-to-plan-skill-design/
  iterations/iteration-1.md` (written to the shared main tree, not the worktree).
