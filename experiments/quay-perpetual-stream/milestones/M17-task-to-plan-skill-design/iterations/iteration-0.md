# Iteration 0 — M17-task-to-plan-skill-design

**Milestone:** M17-task-to-plan-skill-design (inner iteration-0)
**Branch:** `exp5-m17-iteration-0` · **Worktree:**
`experiments/quay-perpetual-stream/milestones/M17-task-to-plan-skill-design/worktrees/iteration-0`
**Date:** 2026-07-18
**Type:** design-doc-only (explore), Δv̂ = 0 by design

## §1. Required reading (confirmed, in order)

1. `experiments/quay-perpetual-stream/charters/M17-task-to-plan-skill-design.md` — read in full.
2. `experiments/quay-perpetual-stream/inherited-core.md` — read in full (all consolidated Tier-B
   sections: value-typed SELECT ledger, portable-metadata convention, human-review cadence,
   adversarial-audit cadence, DIR-009 provider-tool convention, DIR-011 body-first write-back rule).
3. `docs/proposals/exp5-quay-task-proposal-plan-skill.md` — the starting design draft. **Git revision
   read: `05a80668fd4297e9e513ddb414cdc165d1990b4c`** (`05a8066`, the sole commit touching this file
   at charter-authoring time, confirmed via `git log --oneline -- docs/proposals/exp5-quay-task-
   proposal-plan-skill.md`). This is the ONLY commit in this file's history — no further revision
   existed between charter authoring and this iteration's start. Note: the shared repo root's working
   tree had an unrelated uncommitted dirty edit to this same path at the time I started (pre-existing,
   not created by me) — irrelevant to this iteration, since my milestone worktree is a separate git
   worktree checked out cleanly at `05a8066`/HEAD, confirmed identical via `md5sum` before editing.
4. `experiments/quay-perpetual-stream/directives/archive/DIR-012-quay-task-native-proposal-plan-
   skill-and-milestone-model-for-development-work.md` — read in full (Finding, Requested-action items
   1-3, Resolution).
5. Structural precedent: `docs/proposals/exp5-cli-edit-parity.md` §6 (M14's own Done-when checklist
   section) and `docs/proposals/exp5-task-backlog-primitive-projection.md` §15 (M13's equivalent) —
   both skimmed for the concrete checkbox/pasted-diff form.

## §2. HARD GATES (verbatim output)

### Gate 1 — pending directives disposition

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
```
Output: **empty** (no files listed, `ls` produced no output). This matches the charter's explicit
expectation: "Expect this to be empty — DIR-012 was already drained and archived before this
milestone was chartered." **Disposition: N/A — zero pending directives to disposition this iteration.**
Confirmed explicitly, per the gate's own instruction to state this explicitly when empty.

### Gate 2 — manda hub health

```
$ cat .manda/hub.addr && curl -s "$(cat .manda/hub.addr)/healthz"
```
Output:
```
http://localhost:46215
{"root":"/home/yale/work/quay"}
```

### Gate 3 — Web UI reachability (G7)

```
$ curl -s http://localhost:4173/ -o /dev/null -w "%{http_code}\n"
```
Output:
```
200
```

### Gate 4 — worktree confirmation

Worktree was pre-created per the dispatch instructions. Confirmed via:
```
$ ls experiments/quay-perpetual-stream/milestones/M17-task-to-plan-skill-design/worktrees/iteration-0
CHANGELOG.md
LICENSE
README.md
docs
experiments
package-lock.json
package.json
packages
tasks

$ cd experiments/quay-perpetual-stream/milestones/M17-task-to-plan-skill-design/worktrees/iteration-0 \
  && git status && git log -1
On branch exp5-m17-iteration-0
nothing to commit, working tree clean
commit 11fd8295d475f946fc4c59b3eb117b6df702329a
Author: Yale Huang <calvino.huang@gmail.com>
Date:   Sat Jul 18 17:05:43 2026 +0000

    SELECT m17 = M-TASK-TO-PLAN-SKILL-DESIGN: dashboard log entry

    Documents the DIR-012 drain disposition and M17 charter rationale.
    Gate-hash --by-reference: PASS.
```
(This is not the literal "HEAD is now at &lt;hash&gt;" `git worktree add` line, since the worktree was
pre-created for me per the dispatch instructions — I did not run `git worktree add` myself. Confirmed
existence + clean state + correct branch instead, per the dispatch note's explicit instruction: "Just
confirm it exists and cd into it — do not recreate it.")

All subsequent edits this iteration were made exclusively inside this worktree path, never at the
shared repo root — verified below (§4).

## §3. it0 systematic-explore checks

- **(a) Ceiling/floor arithmetic — N/A, confirmed no VT-chart claim introduced.** This milestone is
  zero-VT by charter design (method infra, mirrors M13/M14's own zero-Δv̂ precedent). No VT chart
  number, cov formula, or Δv arithmetic appears anywhere in this iteration's work or in the design doc
  edits — confirmed by re-reading my own diff (§4 below): every addition is design-doc prose/checklist
  content, zero numeric VT claims.
- **(b) Gate-hash/transclusion** — the charter cites `GATE-HASH-REF` by reference rather than
  transcribing the HARD GATES block; the dispatch prompt given to me already resolved the literal gate
  text in full (pasted in the task instructions), consistent with the charter's own
  "charter thinness ≠ agent prompt thinness" requirement. No re-verification script was run this
  iteration since the dispatch prompt itself already carried the resolved literal text, not a bare
  hash — matches the requirement as stated.
- **(c) Dogfooding evidence-gate** — every Done-when clause self-assessment below (§6) cites the
  specific pasted doc section/line range in the design doc, not narrative alone.
- **(d) Domain-misfit audit-channel** — this milestone edits one markdown design doc only, no live
  external system, no product code — consistent with M-SIZING/M-VMETA-GATE/M13/M14/M15's own
  doc/method-infra-only precedent (per the charter's own explicit statement).

## §4. What changed

Single file edited, inside the worktree only:
`docs/proposals/exp5-quay-task-proposal-plan-skill.md`

```
$ git diff --stat 11fd829..HEAD
 .../exp5-quay-task-proposal-plan-skill.md          | 531 ++++++++++++++++++++-
 1 file changed, 519 insertions(+), 12 deletions(-)
```

Confirmed this is the ONLY file touched (no `inherited-core.md`, no `OUTER-LOOP.md`, no
`.claude/skills/` files) — see §6 Done-when clause 9 below for the full disposition.

Committed as `bb3fe77` on branch `exp5-m17-iteration-0` (left unmerged to master, per instructions).

**Summary of the edit:** updated the doc's status header to mark it MATURED (not DRAFT), and added a
new "Part II" (§§12-19) after the original §§1-10 (kept unmodified as rationale/evidence base),
covering:

- **§12** — Quay task read/write behavior: Provider ABI tools used (`task_list`/`task_get`/
  `task_write`/`task_check`, MCP + CLI equivalents), the `## Proposal` body write-back shape
  (mirrors M05's `## Status mirror` idempotent-section-replace convention), and milestone→task
  grouping (primary key = `milestone:<id>` label per M13's own §2/§12 precedent; `parent`/`children`
  reserved for epic-decomposition, real and bidirectional on both providers as of M12-abi-parent-write).
- **§13** — N-independent-proposal (N=2 default) + adjudication: blank-slate-leaning dispatch, no
  inter-agent communication, explicit relationship diagram showing it sits UPSTREAM of
  `proposal-to-plan`'s existing architect-review, which runs unchanged afterward.
- **§14** — Plan author + grounded convergent-check: precise stop condition (`F_i=0` for one round,
  OR round-cap 3), explicitly NOT importing BAIME's literal K=2/ε=0.02 numbers, with the reasoning for
  why not stated.
- **§15** — TDD ≥80%-per-stage hard gate: what it gates (stage-scoped coverage, not repo-aggregate),
  the code-vs-prose `[code]`/`[prose]` classifier, and the single-implementation load-bearing
  rationale (it is the ONLY correctness net over the actual code, since independence is spent
  upstream/downstream, not on the implementation itself).
- **§16** — Provider-agnostic GitHub degradation: explicit per-write-path table (body/labels/
  parent-children fully portable post-M12; only the optional `extra.proposalStatus` mirror ever
  declines, and only by not being attempted, never by attempt-then-catch).
- **§17** — Dispatch-ready Done-when checklist (13 checkbox items), matching M13 §15 / M14 §6's
  pasted-diff/invocation form.
- **§18** — Non-goals restated precisely (no Web UI stage rendering, no `proposal-to-plan` fork/
  deletion, no GitHub `extra{}` storage).
- **§19** — Status/next-step, superseding original §11, explicitly stating DIR-012 items 2/3 remain
  out of scope this milestone.

## §5. Convergence assessment

Per the charter's §3.2 inner-termination conditions and the milestone's own sizing note ("Sized
comparably to M13/M14... real independent-re-derivation material for iteration-1"): condition 1
(Done-when complete & stable ≥1 iteration) is the expected natural terminus. All 10 Done-when clauses
are assessed met below (§6), on the FIRST iteration. Per the charter's sizing note and
`inherited-core.md`'s verify-iteration size gauge, iteration-1 (a future dispatch, not run here) should
independently re-derive/re-verify these claims from a fresh worktree — genuine material exists to
re-check: whether the proposal/plan step specs are internally consistent, whether the Done-when
checklist is genuinely dispatch-ready (not vague), and whether the DIR-012 items-2/3 scope boundary
was actually respected (§6 clause 9's `git diff --stat` claim is independently re-verifiable).

This report does NOT declare the milestone DONE — that requires stability confirmed across iteration-1
per §3.2 condition 1's "stable ≥1 iteration" wording. This is iteration-0's own self-assessment only.

## §6. Self-assessment against the charter's 10 Binary Done-when clauses

1. **`[x]` Starting draft read in full, git revision cited, not re-derived from scratch.**
   Confirmed: git revision `05a8066` cited explicitly in §1 above and in the design doc's own status
   header ("Sections 1-11 are the original DRAFT... git revision `05a8066`"). Sections 1-10 were kept
   completely unmodified (only the status header changed); the new §§12-19 explicitly build on and
   cite specific claims from §§1-10 throughout (e.g. §12.3 cites §2/§12 of the sibling M13 doc; §13.2
   diagrams the relationship to §2's `proposal-to-plan` evidence; §14.2 explicitly declines to import
   BAIME's literal numbers with reasoning, rather than silently re-deriving from zero).

2. **`[x]` Quay task read/write behavior fully specified — pasted doc section.**
   `docs/proposals/exp5-quay-task-proposal-plan-skill.md` §12 (lines ~291-393 in the matured doc):
   §12.1 names the exact Provider ABI tools (`mcp__quay__task_list`/`task_get`/`task_write`/
   `task_check` + CLI equivalents); §12.2 gives the precise `## Proposal` body write-back shape (a
   fenced markdown template) per DIR-011's portable-metadata rule, plus the idempotent-section-replace
   regeneration discipline; §12.3 specifies milestone→task grouping via the `milestone:<id>` label as
   primary key and M12's real `parent`/`children` WRITE for epic-decomposition, plus the plan record's
   own file-path placement (explicitly NOT a child-task tree).

3. **`[x]` N-independent-proposal + adjudication step fully specified, including relationship to
   `proposal-to-plan`'s architect-review — pasted doc section.**
   §13 (lines ~395-466): §13.1 gives the concrete mechanism (N=2 default, blank-slate dispatch,
   3-outcome adjudication, single write-back point to avoid races); §13.2 is the explicit
   strengthens-not-replaces disambiguation required by charter item 3, including a pipeline diagram
   showing `proposal-to-plan`'s architect-review step reused unchanged downstream of adjudication, and
   a "concrete non-overlap check" paragraph distinguishing the two questions each step answers.

4. **`[x]` Plan author + grounded-convergent-check step fully specified, including convergence/stop
   condition — pasted doc section.**
   §14 (lines ~468-540): §14.1 gives the mechanism (single plan author, grounded checker subagent,
   revision loop) and names precisely what the checker checks (§14.1.2's 5-item list, all traceable to
   §2's evidence of what `proposal-to-plan` review actually caught). §14.2 states the stop condition
   precisely: `F_i=0` for one round, OR round-cap 3, with explicit reasoning for why BAIME's literal
   K=2/ε=0.02 numbers are NOT imported (a discrete small-N loop, not a continuous trending score) —
   this directly satisfies the charter's "state the convergence/stop condition precisely" requirement,
   not just a citation to "reuse BAIME's pattern."

5. **`[x]` TDD ≥80%-per-stage hard gate stated precisely, with single-implementation rationale —
   pasted doc section.**
   §15 (lines ~542-610): §15.1 states precisely what it gates (stage-scoped, not repo-aggregate,
   coverage; hard block not advisory) and how it's verified (pasted raw tool output required, e.g.
   `c8`/`nyc`). §15.2 carries forward the code-vs-prose classifier from the original draft's §8.4,
   made mandatory and explicit at plan-author time. §15.3 gives the single-implementation rationale
   specifically requested by the charter: because independence is spent at both ends (§6's clamp) and
   NOT on the implementation itself, the TDD gate is the ONLY mechanism catching a
   correctly-approached/planned-but-incorrectly-coded stage.

6. **`[x]` Provider-agnostic GitHub degradation stated explicitly — pasted doc section.**
   §16 (lines ~612-650): an explicit per-write-path table — `## Proposal` body (fully supported, no
   degradation), `milestone:<id>` label (fully supported), `parent`/`children` (fully supported
   post-M12), and the one path that still hits the hard-error floor (`extra{}`, and only the optional
   non-load-bearing mirror, never attempted on GitHub rather than attempt-then-catch).

7. **`[x]` Dispatch-ready "Done-when clauses a future implementing milestone would need" checklist
   produced, matching M13/M14's own concrete form — pasted in full.**
   §17 (lines ~652-725): 13 `- [ ]` checkbox items, each specifying exact pasted-evidence requirements
   (dispatch traces, before/after `task_get` output, conformance-probe output, negative-case
   demonstrations) — same concrete/checklist form as `exp5-cli-edit-parity.md` §6 and
   `exp5-task-backlog-primitive-projection.md` §15, confirmed by direct structural comparison during
   drafting (both cited by name in §17's own lead sentence).

8. **`[x]` Non-goals stated explicitly — pasted doc section.**
   §18 (lines ~727-750): three explicit non-goals (no Web UI stage-level process rendering, no
   `proposal-to-plan` fork/deletion, no GitHub `extra{}` storage), each restated precisely with a
   cross-reference to where the behavior is operationally specified elsewhere in the doc (§3, §13.2,
   §16 respectively).

9. **`[x]` Confirm DIR-012 items 2 and 3 were NOT performed — `git diff --stat` shows only the design
   doc changed.**
   ```
   $ git diff --stat 11fd829..HEAD
    .../exp5-quay-task-proposal-plan-skill.md          | 531 ++++++++++++++++++++-
    1 file changed, 519 insertions(+), 12 deletions(-)
   ```
   Only `docs/proposals/exp5-quay-task-proposal-plan-skill.md` changed — no `inherited-core.md`, no
   `OUTER-LOOP.md`, no files under `.claude/skills/`. §19 of the matured doc also states this
   explicitly in prose, cross-referencing the charter's own scope boundary. Note: this iteration
   produced no separate charter/iteration/backlog/dashboard bookkeeping commit inside the worktree
   beyond this report (the report itself is written to the shared tree per the dispatch instructions,
   not the worktree) — the worktree's own single commit (`bb3fe77`) is exactly the design-doc edit.

10. **`[ ]` `backlog.md` gains an `M-TASK-TO-PLAN-SKILL-DESIGN` row, marked DONE at ABSORB.**
    **NOT done this iteration** — `backlog.md` is shared-tree outer-loop bookkeeping, updated at
    ABSORB by the outer loop, not by an inner iteration's own worktree commit. This is explicitly the
    outer loop's responsibility per the charter's Dispatcher section and `OUTER-LOOP.md`'s own ABSORB
    step, not an inner-iteration Done-when item this iteration can complete from inside the milestone
    worktree. Flagging this as the one clause NOT self-completable at iteration-0 — the outer loop
    must action it at ABSORB before the milestone can be marked fully DONE across all 10 clauses.

**Net: 9 of 10 clauses met this iteration; clause 10 is explicitly an outer-loop ABSORB-time action,
correctly deferred rather than incorrectly attempted from inside an inner-milestone worktree.**

## §7. Reflection

- **What was learned:** the original draft (§§1-10) already contained most of the substantive
  reasoning DIR-012 asked to be "fully specified" — the maturation work was less about inventing new
  content and more about (a) making implicit decisions explicit and precise (the convergence stop
  condition was a citation to "BAIME's pattern" in the draft; §14.2 had to actually state numbers and
  justify why BAIME's literal numbers don't transfer), (b) adding the operational specificity a future
  IMPLEMENTING milestone needs (exact tool names, exact body-section shapes, exact provider-write
  tables) rather than the exploratory/evidentiary prose appropriate to a first-pass design draft, and
  (c) producing the dispatch-ready checklist form (§17) the charter explicitly names as its own
  deliverable, distinct from the design content itself.
- **Challenges:** the root repo's working tree had an unrelated dirty uncommitted edit to this same
  file path at iteration start (pre-existing, not investigated further since out of scope for this
  milestone and not present in my worktree) — required an explicit md5sum cross-check to confirm my
  worktree's file matched the correct `05a8066` HEAD revision rather than that dirty draft, before
  editing. Worth flagging to the outer loop as a possible merge-conflict risk at ABSORB, though not
  this milestone's concern to resolve.
- **Next focus (if iteration-1 dispatched):** independently re-derive/re-verify this iteration's claims
  from a fresh worktree per the milestone's own sizing expectation — in particular, spot-check whether
  §14's precise stop condition and §17's checklist items are genuinely dispatch-ready (could a future
  implementing-milestone author start work directly from §17 without needing to re-derive anything not
  already stated) rather than merely internally consistent.

## §8. Convergence status

- Thresholds: N/A (Δv̂=0 by design; no VT-chart claim introduced, confirmed §3a).
- Stability: not yet assessable — this is iteration-0 only; §3.2 condition 1 requires stability
  confirmed ACROSS iteration-1, not established by a single pass.
- Objectives: 9/10 Done-when clauses self-assessed met (clause 10 correctly deferred to outer-loop
  ABSORB, see §6).
- **Recommendation:** dispatch iteration-1 as an independent re-verification pass per the charter's own
  sizing note, rather than declaring convergence on iteration-0 alone — consistent with
  `inherited-core.md`'s verify-iteration size gauge and the adversarial-audit cadence rule's condition
  (b) precedent (M06-sizing's own self-exemption attempt was overridden and iteration-1 caught a real
  defect anyway). This iteration does NOT recommend skipping iteration-1.

## §9. Artifacts

- `docs/proposals/exp5-quay-task-proposal-plan-skill.md` (matured, inside worktree, committed `bb3fe77`
  on branch `exp5-m17-iteration-0`) — the milestone's primary deliverable.
- This report: `experiments/quay-perpetual-stream/milestones/M17-task-to-plan-skill-design/iterations/iteration-0.md`
  (written to the shared main tree, per dispatch instructions).

**Branch left unmerged** (`exp5-m17-iteration-0`, commit `bb3fe77`) — for the outer loop to merge, per
instructions.
