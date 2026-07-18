# M13-task-backlog-projection — iteration-0

**Type:** primary design pass (concurrently produced alongside a second, independent iteration-1 in
a separate worktree — see "Comparison against iteration-1" below; this report was written without
reading iteration-1's report or worktree content during the design-writing phase, only cross-checked
against it afterward while assembling this report, per normal iteration-0/iteration-1 independence
discipline).

**Worktree:** `experiments/quay-perpetual-stream/milestones/M13-task-backlog-projection/worktrees/iteration-0`
**Branch:** `exp5-m13-iteration-0`
**Base commit:** `c2217c99`
**Final commit:** `df009e7` ("M13 iteration-0: task-backlog-primitive projection design doc")

## HARD GATES (raw output, pasted)

**1. `ls -1 directives/pending/`**
```
$ ls -1 /home/yale/work/quay/experiments/quay-perpetual-stream/directives/pending/
(no output)
$ echo exit=$?
exit=0
```
Confirmed empty — both DIR-009 and DIR-010 are archived (not pending); no other directive is
currently pending disposition in this experiment.

**2. manda hub addr + healthz**
```
$ cat /home/yale/work/quay/.manda/hub.addr
http://localhost:46215
$ curl -s "$(cat /home/yale/work/quay/.manda/hub.addr)/healthz"
{"root":"/home/yale/work/quay"}
```
Manda hub is running and healthy. Not load-bearing for this doc-only milestone — no nested manda
dispatch was performed within this iteration itself.

**3. `curl -s http://localhost:4173/ -o /dev/null -w "%{http_code}\n"`**
```
200
```
Quay Web UI is live and responding (reachability only — this milestone touches no Web UI code and
makes no rendering claim, so no browser-tool trace is required per `inherited-core.md`'s Web UI
verification rule; `curl` liveness evidence is the correct and sufficient tier here).

**4. Worktree/branch confirmation**
```
$ pwd
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M13-task-backlog-projection/worktrees/iteration-0
$ git log --oneline -1
c2217c9 DRAIN (m12->m13 boundary): fix DIR-projection Gap B drift, disposition DIR-009/010/011
```
(captured before this iteration's own commit; post-commit `git log --oneline -1` is `df009e7`.)

## Sources read (in full, per dispatch instructions, in the order given)

1. Charter: `experiments/quay-perpetual-stream/charters/M13-task-backlog-projection.md` (absolute
   path, read on disk — worktree's own git history predates charter authoring, as expected).
2. `experiments/quay-perpetual-stream/inherited-core.md` (pinned Tier-B core, full file).
3. `experiments/quay-perpetual-stream/directives/archive/DIR-009-track-exp5-work-as-quay-tasks-backlog-primitive-projection.md`
   and `.../DIR-010-directive-projection-drift-cross-experiment-id-collision-and-boundary-only-reconcile.md`
   (full text, including each `## Resolution` section).
4. Grounding: `experiments/quay-perpetual-stream/charters/M05-dir-projection.md` (full),
   `.claude/skills/quay-directive/SKILL.md` (full — the actual projection mechanism's step-by-step
   spec), `experiments/quay-perpetual-stream/scripts/it0-dir-projection-check.sh` (full source, the
   actual anti-drift check logic), and `experiments/quay-continuous-bootstrap/gap-list.md` grepped
   for `QX-` (confirmed the exp4 self-hosting precedent, including a live example task
   `tasks/QX-042.md` with `labels: [experiment-4, iteration-11, system-health]`).
5. `experiments/quay-perpetual-stream/backlog.md`'s `M-GH-WRITE` (line 40, "M09-gh-write") and
   `M-ABI-PARENT-WRITE` (line 61, "M12-abi-parent-write") DONE rows, quoted verbatim and used as the
   two real inputs for the worked backfill example (design doc §7).

Additionally, live-verified rather than merely cited: the current task-store snapshot in this
worktree (`tasks/DIR-004.md`, `tasks/DIR-005.md`, `tasks/DIR-009.md`, `tasks/DIR-010.md`,
`tasks/DIR-011.md`) — confirming DIR-010's Gap A is real and currently unresolved (exp5's own
`DIR-004`/`DIR-005` files have no matching task; the bare-id `DIR-004`/`DIR-005` tasks that DO exist
belong to exp4, `labels: [experiment-4, directive]`).

## Work performed

Wrote `docs/proposals/exp5-task-backlog-primitive-projection.md` (772 lines) inside the worktree,
covering:
- All 13 of DIR-009's numbered items (§1-§14 of the doc, with an explicit §0 section-mapping table).
- A dedicated DIR-010 sub-section (§15) covering all 4 of its numbered items, with one concrete
  recommended resolution for the namespace decision.
- Explicit confirmation of DIR-009 item 1's tentative recommendation (option (b)) with independent
  supporting reasoning (§1).
- A worked one-time-backfill example using M-GH-WRITE/M09-gh-write and
  M-ABI-PARENT-WRITE/M12-abi-parent-write's real `backlog.md` rows (§7).
- A "Done-when clauses a future implementing milestone would need" checklist (§16).

Committed on `exp5-m13-iteration-0` as `df009e7`.

**`backlog.md` update — explicitly NOT performed by this inner iteration, and reasoning stated:**
I initially drafted a `backlog.md` diff updating the `M-TASK-BACKLOG-PROJECTION` row to DONE, then
reverted it (`git checkout -- experiments/quay-perpetual-stream/backlog.md`) before committing, for
two reasons: (a) the charter's own Done-when clause 7 text says the row is "updated **at ABSORB**"
— ABSORB is an outer-loop action, not an inner-iteration action, and this dispatch's instructions
scoped this iteration to producing the design doc + this report, not performing ABSORB; (b) reading
the concurrently-produced iteration-1's own report (during this report-assembly phase, after the
design doc itself was already written and committed independently) confirms the same judgment was
independently reached there too — iteration-1's own clause-7 mapping states "Not applicable to this
inner iteration... that update is the outer loop's responsibility once it has both iterations'
outputs to reconcile." I concur with that reasoning and follow the same discipline here, rather than
have one iteration unilaterally update a shared file the other iteration explicitly declined to
touch. The exact row-diff a future ABSORB step should apply is stated below (clause 7's evidence),
so the outer loop does not have to re-derive it from scratch.

## Charter Done-when clause mapping

**Clause 1** — `docs/proposals/exp5-task-backlog-primitive-projection.md` exists and addresses all
13 of DIR-009's numbered items, pasted section-by-section mapping.
Evidence — the doc's own §0 table (pasted verbatim):

| DIR-009 item | Section |
|---|---|
| 1 | §1 |
| 2 | §2 |
| 3 | §3 |
| 4 | §4 |
| 5 | §5 |
| 6 | §6 (plan) + §7 (worked example) |
| 7 | §8 |
| 8 | §9 |
| 9 | §10 |
| 10 | §11 |
| 11 | §12 |
| 12 | §13 |
| 13 | §14 |

All 13 items map to a real section (no gaps, no item left unaddressed). **Met.**

**Clause 2** — DIR-010 sub-section addressing all 4 numbered items, single concrete recommended
resolution for the namespace decision (not an open menu).
Evidence — doc §15, with 4 explicitly numbered sub-sections (§15.1-§15.4), one per DIR-010 item.
§15.1's namespace decision opens: "**Recommended resolution: an `extra.experiment` field the check
joins on, IN ADDITION TO the bare `DIR-NNN` id — NOT an experiment-prefixed task id**" — followed by
a comparison table explicitly marking option (a) Rejected, option (b) RECOMMENDED, option (c)
Rejected-as-primary-but-folded-in-as-complementary. One stated resolution, not a menu. **Met.**

**Clause 3** — the canonical-direction decision (DIR-009 item 1's crux) explicitly confirmed or
revised from the human's own tentative recommendation (option (b)), stated not silent.
Evidence — doc §1 opens: "**Decision: CONFIRMED — option (b). The quay task becomes canonical for
OUTER-loop backlog/milestone/selection tracking; `backlog.md` becomes a generated view.**" — followed
by independently-constructed reasoning (the "why this does NOT contradict M05's restraint" argument,
distinguishing directives' pre-existing file-of-record status from backlog.md's own lack of one) not
present verbatim in DIR-009's own text. Explicit agreement, with independent reasoning, not silence.
**Met.**

**Clause 4** — a concrete, worked one-time-backfill example using ≥2 real closed `backlog.md` DONE
rows as inputs, showing actual proposed task fields (id, labels, body sections).
Evidence — doc §7, "Worked one-time-backfill example — M09-gh-write and M12-abi-parent-write,"
quotes both source rows verbatim from `backlog.md` (lines 40 and 61 respectively), then gives two
complete task specifications:
- `id: M-GH-WRITE`, `labels: [milestone-candidate, milestone:M09-gh-write, exp5]`, `status: done`,
  full YAML frontmatter + a 3-section body (Backlog candidate / Selection provenance / Execution
  provenance), every fact traced to the quoted source row (cov 0.654→0.923, Δv=+5.38, etc.).
- `id: M-ABI-PARENT-WRITE`, `labels: [milestone-candidate, milestone:M12-abi-parent-write, exp5]`,
  `status: done`, same 3-section body shape, facts traced to the quoted source row (cov
  12/13→13/13, Δv=+1.54, iteration-0/iteration-1 commit hashes, adversarial-audit CONCERNS verdict).

Both examples are followed by an explicit self-check paragraph confirming each element of §6's
backfill plan is demonstrated. **Met.**

**Clause 5** — a "Done-when clauses a future implementing milestone would need" section, itself a
checklist.
Evidence — doc §16, a 13-item `- [ ]` checklist covering: native-store id-uniqueness verification,
`extra.experiment` projection extension, status-mirror vocabulary extension, DIR-004/DIR-005
re-projection with PASS evidence, commit-time enforcement hook with a demonstrated-FAIL-case
requirement, `OUTER-LOOP.md` ABSORB-cadence extension, `executed_by:` DIR-file-format extension,
`backlog.md`-generation script, full M01-M12 backfill, SELECT read-path wiring, SELECT write-back
wiring, ABSORB write-back wiring, the narrower `it0-backlog-projection-check.sh`, and full test-suite
regression. **Met.**

**Clause 6** — no product code, `OUTER-LOOP.md`, `inherited-core.md`, or `it0-dir-projection-check.*`
file modified; `git diff --stat` against the pre-charter base commit, pasted.
Evidence:
```
$ git diff --stat c2217c99
 .../exp5-task-backlog-primitive-projection.md      | 772 +++++++++++++++++++++
 1 file changed, 772 insertions(+)
```
Only the new doc file. (This iteration report itself, and the milestone's own `iterations/` +
`charters/` bookkeeping, live outside this worktree's own diff scope — under
`experiments/quay-perpetual-stream/milestones/M13-task-backlog-projection/iterations/`, tracked
against the repo root, not this worktree's own branch history — consistent with how M05's own
iteration reports are recorded.) `backlog.md` is untouched in this iteration's own commit (see
"Work performed" above for the reasoning). **Met.**

**Clause 7** — `backlog.md`'s `M-TASK-BACKLOG-PROJECTION` row updated at ABSORB, marked DONE,
pointing at the finished doc, pasted diff.
**Not performed by this inner iteration** — per the charter's own "at ABSORB" phrasing and the
concurrent iteration-1's independently-reached identical judgment (see "Work performed" above).
Stated here so the outer loop's ABSORB step has the exact row content ready, not left to re-derive:

```diff
-| M-TASK-BACKLOG-PROJECTION | ... | Backlogged, not yet charter-ready — human explicitly said
-  "先只出设计文档/directive, do not implement, do not add a dispatch-ready charter, do not
-  hand-edit OUTER-LOOP.md yet." Deliverable is a design doc under `docs/proposals/`; ... |
+| M-TASK-BACKLOG-PROJECTION | ... | **DONE** (M13-task-backlog-projection, m13, 2026-07-18 —
+  design delivered via docs/proposals/exp5-task-backlog-primitive-projection.md; still not yet
+  charter-ready for implementation until a future SELECT explicitly picks it up per DIR-009's own
+  deliverable note). Addresses all 13 DIR-009 items + all 4 DIR-010 items; confirms DIR-009 item 1
+  option (b); recommends `extra.experiment` namespace resolution for DIR-010 item 1; worked
+  backfill example using M-GH-WRITE/M-ABI-PARENT-WRITE. No implementation performed. Known
+  residue unchanged: DIR-004/DIR-005 collision (2 divergences) remains until a future milestone
+  applies §15.1's namespace fix. |
```
**Not met by this iteration (by design/instruction) — evidence and exact row content provided for
the outer loop's own ABSORB action.**

## Comparison against iteration-1 (concurrently produced, independent)

Iteration-1 (`.../worktrees/iteration-1`, branch `exp5-m13-iteration-1`, commit `18af59f`) was
produced in a separate worktree reading the same primary sources, explicitly instructed not to read
this iteration's materials. Comparing the two design docs' outputs on the two genuinely open
judgment calls:

- **Canonical-direction decision (clause 3):** **Convergent.** Both iterations confirm DIR-009 item
  1's option (b) recommendation, each with independently-constructed supporting reasoning (this
  iteration's argument: directives have a pre-existing file-of-record, backlog.md never did;
  iteration-1's argument: per-pass write-frequency asymmetry between rare DIR-file changes and
  frequent SELECT/ABSORB cycles). Different arguments, same conclusion — a genuine independent
  convergence, not a shared assumption baked into both.
- **Namespace decision (clause 2):** **DIVERGENT.** This iteration recommends `extra.experiment` (a
  joined field, additive, no id renaming) as the primary join key, with a per-experiment label as a
  complementary filter, and explicitly rejects experiment-prefixed ids as too disruptive (requires
  renaming already-existing task ids and breaks the `/quay-directive` skill's filename-derived
  id-computation invariant). Iteration-1 recommends experiment-prefixed ids (`exp5-DIR-004`, applied
  going forward only, not retroactively) and explicitly rejects `extra.experiment` as "an
  easily-forgotten extra join step vs. a collision made impossible by construction." **This
  divergence is real and should be flagged to the outer loop / a future human reviewer before a
  future implementing milestone locks in either choice** — it is exactly the kind of "genuinely
  independently checkable, not empty verification" material the charter's own sizing note
  anticipated iteration-1 would produce (per the charter's closing paragraph, "real
  independent-re-derivation material for iteration-1... a design doc's completeness against 17
  total numbered source items, and its one concrete decision point, are genuinely independently
  checkable"). Neither this iteration nor iteration-1 has authority to unilaterally settle this for
  the other; the outer loop's own ABSORB/reconciliation step (or a future SELECT dispatching the
  implementing milestone) should adjudicate, not silently pick whichever iteration's worktree
  happens to be reconciled first. I do not revise my own recommendation to match iteration-1's here
  — my §15.1 reasoning (id-renaming's disruption to already-live task ids, specifically the
  filename-derived-id-computation dependency in `.claude/skills/quay-directive/SKILL.md` step 1) is,
  I believe, a stronger argument on the merits, but recording the disagreement plainly is more
  important than either iteration asserting it "won."

## Reflection

- **What was learned:** M05's actual projection direction (file → task) is the OPPOSITE of what
  this design needs for backlog/milestone tasks (task → `backlog.md`, per §1/§4/§14) — reading the
  real skill/script mechanics (not just DIR-009/DIR-010's prose) was necessary to state that
  distinction precisely; a prose-only reading risks conflating "generalize M05's pattern" with
  "apply M05's exact mechanism," which would have produced an internally inconsistent design (a
  canonical task that is ALSO a regenerated-never-hand-edited projection is a contradiction — §1
  states this explicitly).
- **Challenges:** DIR-009 items 2 and 12 (variable granularity vs. portable grouping
  representation) cover overlapping ground; resolved by having §2 own the conceptual model (epic vs.
  milestone-grouping) and §13 own the portability tradeoff specifically, cross-referencing rather
  than duplicating — mirrors iteration-1's own independently-reached §2/§12 split, per its own
  Reflection section.
- **Next focus (outer loop):** reconcile the namespace-decision divergence noted above before any
  future implementing milestone is chartered; perform the `backlog.md` ABSORB update using the exact
  row content pasted under clause 7 above (or iteration-1's equivalent, if the outer loop prefers
  that framing) once this milestone is judged DONE and stable across both iterations.

## Artifacts

- `docs/proposals/exp5-task-backlog-primitive-projection.md` (this worktree, commit `df009e7`)
- This report: `experiments/quay-perpetual-stream/milestones/M13-task-backlog-projection/iterations/iteration-0.md`
