# exp5 task-backlog-primitive projection — design doc (M13-task-backlog-projection)

**Status:** design only — per DIR-009's routing decision ("先只出设计文档/directive"), no
implementation, no `OUTER-LOOP.md` edit, no `inherited-core.md` edit, no
`it0-dir-projection-check.*` change, no task-store schema/CLI change, no backfill actually
performed. This document is the deliverable itself.

**Source directives:** `experiments/quay-perpetual-stream/directives/archive/DIR-009-track-exp5-work-as-quay-tasks-backlog-primitive-projection.md`
and `.../DIR-010-directive-projection-drift-cross-experiment-id-collision-and-boundary-only-reconcile.md`.

**Grounded precedents cited throughout (per charter in-scope item 4 — cross-reference, not
re-derive):**
- **M05-dir-projection / DIR-002** (`experiments/quay-perpetual-stream/charters/M05-dir-projection.md`,
  `.claude/skills/quay-directive/SKILL.md` step 5, `experiments/quay-perpetual-stream/scripts/
  it0-dir-projection-check.{sh,mjs}`) — the file-canonical, generated-projection, anti-drift-check,
  boundary-drain pattern this design generalizes from directives to backlog/milestone tasks. Every
  mechanism proposed below is a direct structural echo of this pattern; none is invented from
  scratch.
- **exp4's `QX-*` labeling practice** (`experiments/quay-continuous-bootstrap/`) — ~55 tasks
  carrying `experiment-4` + `iteration-N` + surface labels (e.g. `QX-067`:
  `experiment-4/iteration-19/packaging`), confirmed live in the current task store (see
  `tasks/QX-042.md` in this worktree: `labels: [experiment-4, iteration-11, system-health]`). This
  is the "self-host the experiment's own dev work as tasks" precedent DIR-009 says exp5 regressed
  from and should restore, generalized.

---

## 0. Section-by-section mapping to DIR-009's 13 numbered items

DIR-009's "Requested action" section names 13 numbered items the design "must cover, at minimum."
Table below maps each to the section that answers it, so omissions are checkable rather than
asserted (charter Done-when clause 1).

| DIR-009 item | Section below |
|---|---|
| 1. Task as backlog primitive + canonical-direction decision (the crux) | §1 |
| 2. Variable granularity + regrouping (epics, milestone merging) | §2 |
| 3. Status/lifecycle mapping | §3 |
| 4. Projection + anti-drift, generalized from M05 | §4 |
| 5. Web UI surfacing = zero new UI code | §5 |
| 6. One-time backfill plan | §6 (plan) + §7 (worked example) |
| 7. Non-goals / guardrails | §8 |
| 8. SELECT reads quay via provider tool (read path) | §9 |
| 9. Selection provenance (write-back on SELECT) | §10 |
| 10. Execution provenance (write-back on ABSORB) incl. DIR sub-tension | §11 |
| 11. Portable metadata vs native-only convenience | §12 |
| 12. Milestone-as-grouping representation, portably | §13 |
| 13. `backlog.md` weakens to a generated view, ordered by value not recency | §14 |

DIR-010's 4 items are covered in §15 (a dedicated sub-section, per DIR-009 item 2 / DIR-010's own
suggested routing). The one-time-backfill worked example (charter in-scope item 5, Done-when
clause 4) is §7. The "Done-when clauses a future implementing milestone would need" checklist
(Done-when clause 5) is §16.

---

## 1. Task as the backlog primitive + the canonical-direction decision (DIR-009 item 1)

**Decision: CONFIRMED — option (b). The quay task becomes canonical for OUTER-loop
backlog/milestone/selection tracking; `backlog.md` becomes a generated view.**

This design confirms DIR-009's own tentative recommendation without revision. The reasoning DIR-009
already gave is sound and does not weaken on closer inspection:

- SELECT must **read** the candidate set via the provider tool (item 8, §9) — a read-only
  projection can still serve this if regeneration happens before every SELECT, but...
- SELECT must **write back** selection decisions including not-selected reasons (item 9, §10), and
- ABSORB must **write** execution provenance (item 10, §11)

...and a "never-hand-edited generated projection" (the pure M05 pattern) is structurally
incompatible with being a *write target* for live, per-pass decisions. M05's projection is
regenerated wholesale from its file source every time the file changes; there is no notion of
"SELECT annotates this specific task with a reason" inside that model without turning the
projection into a hybrid the anti-drift check cannot cleanly verify (is a divergence a bug, or an
expected annotation the regenerator should preserve?).

**Why this does NOT contradict M05's restraint, and is not "the same mistake DIR-002 warned about
happening a second time":** DIR-002's finding (repeated at M05's charter) was that exp4's DIR-006
attempt did a *destructive file→task cutover* for **directives** specifically, skipping the
enabling projection tooling, and that the correct fix was file-canonical + generated projection +
anti-drift enforcement. That lesson is about **directives** — a domain with an existing, prior,
independently-authoritative file format (`DIR-NNN.md` under `directives/{pending,archive,retracted}/`)
that long predates any task-store integration and has its own audit trail (git history of the file
itself). Backlog candidates and milestone tracking have **no equivalent pre-existing file-of-record**
of that kind: `backlog.md` is *itself* just a markdown table a prior milestone (M05, in fact — see
its own charter in-scope item 6, "do NOT build a general-purpose task-projection framework beyond
directives") chose not to project, not a long-lived authoritative document with independent value
the way a directive's Finding/Requested-action/Resolution write-up is. Making the task canonical for
backlog/milestone tracking is not "cutting over" an existing canonical file — there is no existing
canonical file being demoted; `backlog.md` was already downstream prose maintained by hand at every
SELECT/ABSORB, duplicating information the task store can hold natively with better tooling
(labels, status, provenance, filtering, Web UI surfacing) than a hand-maintained markdown table
provides.

**Scope of the reversal — explicitly narrow, matching DIR-009's own framing:**
- Applies to: exp5's own backlog-candidate tracking, milestone-as-grouping tracking, and
  selection/execution provenance (items 1/2/3/9/10 below).
- Does NOT apply to: directive files (`directives/{pending,archive,retracted}/DIR-NNN.md`) — these
  stay file-canonical per M05, unchanged (§11's DIR sub-tension resolves how the two regimes meet at
  the DIR-task join point, without collapsing one into the other).
- Does NOT apply to: any product code, milestone charter, or iteration report — those remain
  markdown files under `experiments/quay-perpetual-stream/{charters,milestones}/`, unaffected. Tasks
  track the backlog-candidate/selection/execution-provenance *layer*, not the full charter/iteration
  content (§11 makes explicit that the task record is "the board-visible summary, not the sole
  copy").

**What "canonical" concretely means going forward, once a future implementing milestone lands
this:** a `label: milestone-candidate` task's `title`/`labels`/`body`/`status`/`extra` fields ARE
the source of truth for that candidate's existence, value-type tags, and provenance. `backlog.md` is
regenerated FROM the task store (§14), the reverse of M05's direction (which regenerates the task
FROM the file). This is a genuinely different mechanism shape from M05's, not a copy of it with the
words swapped — DIR-009 item 1's own text names this explicitly ("this is a deliberate, scoped
reversal of M05's directives-only restraint").

---

## 2. Variable granularity + regrouping (DIR-009 item 2)

**Epics (large task → subtasks).** Use the native store's existing `parent`/`children` fields
unchanged — no new mechanism needed. A backlog candidate large enough to need decomposition is
written as a `label: milestone-candidate` task with `children: [...]` pointing at sub-candidate
tasks; the native provider already derives `role: compound` from non-empty `children` (cited in
DIR-009 item 12). This is a straight reuse of an existing store capability, not new design.

**Small-task→milestone merging (several tasks grouped under one milestone at SELECT).** This is the
genuinely new part. Recommended representation (detailed portability tradeoff in §13): a shared
`milestone:M-NN` label applied to every member task at the moment SELECT picks them. This is
additive (a task keeps its own identity/labels/history) rather than destructive (no task is deleted
or merged into a synthetic parent), which matches the native store's `appendNote` semantics and
avoids inventing a new "member of a group but the group itself isn't a real task" entity.

**Membership frozen for the milestone's duration.** The `milestone:M-NN` label is applied once, at
SELECT (§10), and not modified again until ABSORB adds execution-provenance fields (§11) — mirroring
the existing "charter frozen mid-milestone" invariant already governing charter Tier-A content
(§3.1/§3.4 of the outer protocol). If a mid-milestone scope change is genuinely needed, that is
itself a charter-level event (already governed by the existing size-gauge/re-scope discipline in
`inherited-core.md`'s Milestone size definition section) — this design adds no new re-scope
mechanism, it inherits the existing one.

**How a milestone is represented over its member tasks — decision:** label-based grouping
(`milestone:M-NN`), NOT a parent "milestone" task with members as children. Rationale, stated here
and cross-referenced again in §13 (the portability-specific framing DIR-009 item 12 asks for):
GitHub cannot currently *write* `parent`/`children` (M09's hard-error floor, PR-ABI-001) but CAN
write labels — so a label is the portable primary grouping key across both providers, with
parent/children reserved as an optional native-only enrichment for epics (the DIR-009-item-2 case
above), not the milestone-grouping case.

---

## 3. Status/lifecycle mapping (DIR-009 item 3)

Two distinct status axes exist and must not be conflated — same discipline M05 already applies
between a directive's own task-store `status` and its `Status mirror:` field:

| Axis | Values | Lives on |
|---|---|---|
| **Task's own store status** | `todo` / `in-progress` / `done` (native provider's existing vocabulary — unchanged, no new value needed) | The task's native `status` field |
| **Milestone-grouping lifecycle status** | `candidate` → `selected` → `dispatched` → `done` (ABSORB) → (optionally) `stale`/`deferred` | A body section + `extra` mirror field on the task, analogous to M05's `Status mirror:` line — NOT overloading the task's own store status |

**Mapping table (OUTER lifecycle phase → task-side representation):**

| OUTER phase | Task-side state |
|---|---|
| Backlog / unselected | `label: milestone-candidate`, task status `todo`, no `milestone:M-NN` label yet |
| SELECTED / dispatched | `label: milestone-candidate` retained + `milestone:M-NN` label added, task status → `in-progress`, selection-provenance body section written (§10) |
| DONE (ABSORB) | task status → `done`, execution-provenance body section written (§11) |
| Epic | `role: compound` (derived automatically from non-empty `children`, per §2) — orthogonal to the lifecycle axis, can co-occur with any of the above |
| Deferred / stale (cf. `backlog.md`'s "STALE at mN SELECT" rows) | task status stays `todo`, but a `Lifecycle: stale (as of mN)` body line + `extra.lifecycle` mirror is written — task remains visible/filterable, not deleted |

This is the same "task's own status is a distinct axis from a mirrored lifecycle/provenance field"
pattern M05 already established for directives (`status:` in the DIR file vs. the task's own native
`status` vs. the `Status mirror:` body line) — reused here for a second, structurally similar
distinction (task-store status vs. milestone-lifecycle status) rather than re-derived from scratch.

---

## 4. Projection + anti-drift, generalized from M05 (DIR-009 item 4)

**What is genuinely different from M05 here, restated plainly:** because §1 makes the task
canonical (not the reverse), this is **not** a projection-FROM-file-TO-task the way M05's
directive projection is. There is no separate canonical file for a backlog-candidate/milestone-
grouping task to be projected from — the task itself IS the canonical record. So "projection" in
this domain means something narrower and more limited than in M05's:

1. **`backlog.md` is the ONE generated projection this design adds** (task → markdown view, the
   reverse direction from M05's DIR-file → task direction) — detailed in §14.
2. **There is no anti-drift check of the M05 shape (file vs. task) needed for backlog-candidate/
   milestone tasks**, because there is no second canonical copy to drift against — the task is the
   only copy. `backlog.md` cannot "drift" from the tasks in the sense M05's check catches, because
   `backlog.md` is never hand-edited once this design lands (§14) — it is fully regenerated each
   time, same non-hand-edited discipline M05 already established, just applied to the opposite
   direction of generation.
3. **The anti-drift concern that DOES carry over from M05, unchanged, is the DIR-task join
   (§11's DIR sub-tension and §15's Gap A/B)** — directives remain file-canonical, so the EXISTING
   `it0-dir-projection-check.{sh,mjs}` mechanism (file ↔ task divergence) still applies to DIR tasks
   specifically, and needs exactly the two fixes DIR-010 already identified (namespace, cadence) —
   this design does not touch or replace that check's core logic, it extends its *scope* (namespace
   join key) per §15.
4. **A new, narrower staleness check IS still worth specifying** (for a future implementing
   milestone, not built here): "does `backlog.md` match a fresh regeneration from the current task
   store, byte-for-byte (or field-for-field)?" — this is a much simpler check than M05's (single
   direction, single source of truth, no status-mirror-vocabulary question) and can reuse the exact
   same script skeleton (`it0-dir-projection-check.sh`'s node/JSON-comparison approach) with the
   comparison direction reversed. Named for a future milestone: `it0-backlog-projection-check.sh`.
   Its OUTER-LOOP drain hook is SELECT/ABSORB themselves (§9/§10/§11), not a `/quay-directive`-style
   skill step, since — per DIR-009 item 4's own text — "the milestone analogue lives in SELECT/
   ABSORB, not in a skill, since the OUTER loop — not `/quay-directive` — drives the milestone
   lifecycle."

---

## 5. Web UI surfacing = zero new UI code (DIR-009 item 5)

Confirmed, no new design needed beyond stating the mechanism explicitly (this item is intentionally
the smallest of the 13 — it inherits existing capability wholesale):

- The generic `?label=` filter (QW-005) already works and needs no `serve.js` change.
- `label: milestone-candidate` surfaces the full backlog at `http://localhost:4173/?label=milestone-candidate`.
- `label: directive` (existing, M05) continues to surface directives unchanged.
- `milestone:M-NN` surfaces a specific milestone's member tasks at
  `http://localhost:4173/?label=milestone%3AM-NN` (URL-encoded colon).
- Multi-label AND-join (already shipped, exp4 gap CB-015/QX-032 per `gap-list.md`, confirmed
  present in the MCP schema) lets a future Web UI query combine both, e.g.
  `?label=milestone-candidate&label=milestone%3AM13-task-backlog-projection`, with zero new
  product code.

This item requires no code-level design decision — it is a direct, confirmed reuse of existing
label-filter capability, cited rather than re-derived, per the charter's own instruction that item 5
is "zero new UI code."

---

## 6. One-time backfill — the plan (DIR-009 item 6; worked example in §7)

**Scope:** M01..M12 (and any still-open `backlog.md` candidates as of the future implementing
milestone's own start) need a documented one-time backfill — same category of historical hole as
DIR-001/DIR-002 predating M05's mechanism, per DIR-009's own framing.

**Plan (generalizable procedure, applied concretely to 2 real milestones in §7):**

1. **Source of truth for the backfill pass: `backlog.md`'s existing rows, read-only.** No git
   history rewrite, no attempt to reconstruct what SELECT "would have" written at the time each
   milestone was actually chosen — the backfill captures the CURRENT state of each closed row as it
   stands today, generated in one pass, dated with the backfill's own real date (not
   back-dated to the milestone's original SELECT/ABSORB date).
2. **One task per closed `backlog.md` row**, not one task per milestone-internal iteration/commit —
   this matches DIR-009 item 6's own phrasing ("one `label: milestone-candidate` + `label:
   milestone:M-NN` task per closed backlog.md row").
3. **Two labels per backfilled task, minimum:** `milestone-candidate` (marks it as a backlog-primitive
   task, consistent with every future-forward task created under this design) + `milestone:M-NN`
   (marks which milestone it was grouped into/executed by — for backfilled rows, selection and
   execution happened in the same historical event, so both provenance sections, §10 and §11, are
   populated at once during backfill, dated with the backfill's own date and explicitly marked as
   backfilled, not live-selected).
4. **Task status: `done`** for every backfilled row that is `DONE` in `backlog.md` (all rows through
   M12 are DONE per the charter's own framing) — no `in-progress`/`todo` backfilled rows expected
   in the M01-M12 range.
5. **Body content: derived directly from the `backlog.md` row's existing columns** (title, surface,
   source, e/x, value type(s), the free-text notes column containing the realized outcome) —
   reformatted into the structured body-section shape §12 specifies (portable, body-first), not
   re-researched or re-derived from the underlying milestone/iteration reports. The backfill is a
   format conversion of already-settled information, not a re-audit.
6. **One backfill pass, one commit, explicit provenance note.** Every backfilled task's body carries
   a line stating it was backfilled (e.g. `Backfilled: <date>, from backlog.md row as of commit
   <sha>`) so a future reader can distinguish "created live at SELECT time" from "reconstructed after
   the fact" — this preserves exactly the kind of honesty DIR-001/DIR-002's own un-backfilled
   historical hole lacked (those predate M05's mechanism with no marker at all; this backfill would
   have one).
7. **No git-history rewrite.** The backfill only writes new task-store files (`tasks/M-NN-*.md` or
   similar, per whatever id scheme §15 settles); `backlog.md`'s row content up to the point of
   backfill is preserved as-is in git history — only *future* `backlog.md` content becomes generated
   (§14), the historical rows are not retroactively deleted or altered.

---

## 7. Worked one-time-backfill example — M09-gh-write and M12-abi-parent-write (DIR-009 item 6,
## charter Done-when clause 4)

Real inputs, taken verbatim from `experiments/quay-perpetual-stream/backlog.md`'s current DONE rows
(re-quoted here for traceability):

**Input row 1 — `M-GH-WRITE`** (backlog.md line 40):
> `M-GH-WRITE` | GitHub Provider write-completeness (title/body/labels/parent-children write; fix
> PR-ABI-001's silent-drop-no-error failure mode at minimum, real write support as stretch) |
> Provider-ABI | gap-list PR-ABI-001 (significant) | explore | **DONE** (m9, 2026-07-18, merged to
> master — real title/body/labels write + hard-error floor for parent/children, PR-ABI-001 CLOSED,
> cov 0.654→0.923, realized Δv=+5.38, independently re-verified by iteration-1 including a fresh,
> differently-provisioned Docker audit-channel re-run) | Real, precisely-sized candidate...

**Input row 2 — `M-ABI-PARENT-WRITE`** (backlog.md line 61, "M12-abi-parent-write" milestone):
> `M-ABI-PARENT-WRITE` | GitHub Provider parent/children WRITE — close the last unimplemented write
> field M09-gh-write's own charter explicitly excluded... | Provider-ABI | M09-gh-write's charter
> Done-when item 4 exclusion note... | exploit | capability-growth (primary...) + risk/option
> (secondary...) | **DONE** (m12, 2026-07-18, iteration-0 `f172b29` and iteration-1 `6d76cdf` BOTH
> independently implemented and live-verified full bidirectional reassign-parent semantics against
> real GitHub scratch issues... Provider-ABI cov 12/13(0.9231)→13/13(1.0000), VT chart-1
> 109.11→110.65/120, **realized Δv=+1.54**...) | Sized consistent with M09's own comparable scope...

**Proposed backfilled task 1 — `id: M-GH-WRITE`** (task id = backlog.md's own candidate id, kept
stable — see §15's namespace decision for why the milestone-executed-by tag, not the task id
itself, carries the experiment discriminator):

```yaml
id: M-GH-WRITE
title: "GitHub Provider write-completeness (title/body/labels/parent-children write)"
status: done
labels:
  - milestone-candidate
  - milestone:M09-gh-write
  - exp5
parent: null
children: []
extra:
  surface: Provider-ABI
  source: "gap-list PR-ABI-001 (significant)"
  valueType: capability-growth
  ex: explore
  realizedDeltaV: 5.38
  executedBy: M09-gh-write
  backfilled: true
  backfilledAt: "<future-implementing-milestone-date>"
```
```markdown
## Backlog candidate (backfilled from backlog.md)

**Surface:** Provider-ABI
**Source:** gap-list PR-ABI-001 (significant)
**e/x:** explore
**Value type(s):** capability-growth

GitHub Provider write-completeness (title/body/labels/parent-children write); fix PR-ABI-001's
silent-drop-no-error failure mode at minimum, real write support as stretch.

## Selection provenance
Selected @M09-gh-write (m9, 2026-07-18). No competing not-selected reasons recorded for this
backfilled row — backlog.md's historical prose did not carry a full not-selected ledger for
the m9 SELECT pass; this is a known backfill-completeness limit (see §6 item 5 — backfill
reformats existing settled information, it does not reconstruct missing historical detail).

## Execution provenance
Executed by M09-gh-write (m9, 2026-07-18). Merged to master — real title/body/labels write +
hard-error floor for parent/children shipped. PR-ABI-001 CLOSED. Provider-ABI cov
0.654→0.923. Realized Δv=+5.38. Independently re-verified by iteration-1 including a fresh,
differently-provisioned Docker audit-channel re-run.

Backfilled: <future-implementing-milestone-date>, from backlog.md row as of commit c2217c99.
```

**Proposed backfilled task 2 — `id: M-ABI-PARENT-WRITE`:**

```yaml
id: M-ABI-PARENT-WRITE
title: "GitHub Provider parent/children WRITE (close last unimplemented write field)"
status: done
labels:
  - milestone-candidate
  - milestone:M12-abi-parent-write
  - exp5
parent: null
children: []
extra:
  surface: Provider-ABI
  source: "M09-gh-write charter Done-when item 4 exclusion note"
  valueType: capability-growth+risk/option
  ex: exploit
  realizedDeltaV: 1.54
  executedBy: M12-abi-parent-write
  backfilled: true
  backfilledAt: "<future-implementing-milestone-date>"
```
```markdown
## Backlog candidate (backfilled from backlog.md)

**Surface:** Provider-ABI
**Source:** M09-gh-write's charter Done-when item 4 exclusion note ("parent/children WRITE ...
out of scope this milestone ... worth its own future milestone if selected")
**e/x:** exploit
**Value type(s):** capability-growth (primary) + risk/option (secondary)

GitHub Provider parent/children WRITE — close the last unimplemented write field M09-gh-write's
own charter explicitly excluded (checkbox-in-body cross-issue mutation, since GitHub issues have
no native parent-link field).

## Selection provenance
Selected @M12-abi-parent-write (m12, 2026-07-18). Sourced directly from M09-gh-write's own
Done-when exclusion note — an unusually strong provenance trail for a backfilled row (the
candidate's origin is another milestone's charter text, not a generic backlog scan).

## Execution provenance
Executed by M12-abi-parent-write (m12, 2026-07-18). iteration-0 `f172b29` and iteration-1
`6d76cdf` BOTH independently implemented and live-verified full bidirectional reassign-parent
semantics against real GitHub scratch issues. Provider-ABI cov 12/13(0.9231)→13/13(1.0000), VT
chart-1 109.11→110.65/120, realized Δv=+1.54. First real trigger of the out-of-band
adversarial-audit gate: verdict CONCERNS (non-blocking, both findings fixed at ABSORB).

Backfilled: <future-implementing-milestone-date>, from backlog.md row as of commit c2217c99.
```

**What this worked example demonstrates concretely (self-check against §6's plan):**
- Both tasks carry `milestone-candidate` + `milestone:M-NN` (§6 item 3) — confirmed in each `labels:`
  block above.
- Both are `status: done` (§6 item 4).
- Body content is a direct reformat of the existing backlog.md row columns — no new research; every
  fact in each body traces to the exact quoted input row above (§6 item 5).
- Both carry an explicit `backfilled: true` / `Backfilled: <date>...` marker (§6 item 6).
- Task 1's "Selection provenance" section explicitly flags a real limitation — `backlog.md`'s
  historical prose doesn't carry a not-selected ledger for that specific SELECT pass — rather than
  fabricating one, demonstrating this design does not claim a hallucinated completeness the source
  data doesn't support.

---

## 8. Non-goals / guardrails (DIR-009 item 7)

- **Do not build task-projection for anything beyond exp5's own backlog/milestone work in this
  pass.** This design does not propose projecting, e.g., arbitrary product-code TODOs or unrelated
  repo work into the task store.
- **Do not perturb an in-flight milestone's frozen charter.** The `milestone:M-NN` label freeze
  (§2) and provenance write-back timing (§10/§11) are both scoped to happen only at SELECT/ABSORB
  boundaries, never mid-milestone.
- **Directive files stay canonical (M05), unchanged.** Nothing in this design revises M05's
  directives-only restraint or the existing `it0-dir-projection-check.{sh,mjs}` file→task direction
  for DIR tasks specifically — §11's DIR sub-tension and §15 extend that check's join-key scope,
  they do not replace its canonical-direction logic.
- **This design itself is not implemented by this milestone** (charter in-scope item 3, restated
  here as its own guardrail): no `OUTER-LOOP.md` edit, no `inherited-core.md` edit, no
  `it0-dir-projection-check.*` change, no task-store schema/CLI change, no backfill actually
  performed by M13 itself. §16 states what a future milestone's Done-when clauses would need to
  actually execute this design.

---

## 9. SELECT reads quay via the provider tool — read path (DIR-009 item 8)

**Requirement (verbatim source, DIR-009 item 8):** SELECT must access the candidate set by calling
`task_list` (MCP) or `node packages/quay/bin/quay.js task list --json` (CLI) filtered by
`label: milestone-candidate` — not by eyeballing `backlog.md`.

**Design specifics for a future implementing milestone:**
- Preferred call shape: `task_list({ label: "milestone-candidate", label: "exp5" })` (multi-label
  AND-join, already shipped per exp4's CB-015/QX-032 fix) — or the CLI equivalent `quay.js task list
  --label milestone-candidate --label exp5 --json`. The `exp5` label (or whatever namespace scheme
  §15 settles on) is the experiment discriminator, preventing a future implementing milestone's
  SELECT read from silently returning another experiment's own `milestone-candidate`-labeled tasks
  if this pattern is ever adopted by a sibling experiment.
- This read path REPLACES `backlog.md`-eyeballing as SELECT's mechanism, not supplements it —
  `backlog.md` becomes purely a human-readable projection (§14), SELECT's actual decision input is
  the live `task_list` call.
- This mirrors M05's own equivalent requirement for the OUTER-LOOP inbox-drain step (M05 charter
  in-scope item 4: "update `OUTER-LOOP.md`'s inbox-drain step ... to ALSO run `task_list --label
  directive`") — same shape, applied to a different label/phase.

---

## 10. Selection provenance — write-back on SELECT (DIR-009 item 9)

**Requirement:** every SELECT pass writes back onto the task store, not just into
`backlog.md`/`dashboard.md` prose:
1. The chosen task(s) get the `milestone:M-NN` label (§2's mechanism).
2. **Every candidate considered-but-not-selected this pass gets a brief reason recorded** — a
   dedicated `## Selection provenance` body section (see §7's worked examples for the section shape)
   or an `extra.notSelected` note, e.g. `"not selected @M13: <reason>"`.

**Design specifics:**
- This turns `backlog.md`'s currently-prose-only "STALE at mN SELECT" annotations (cited in DIR-009
  item 9 itself) into first-class, filterable task state — a future implementing milestone should
  make `extra.notSelected` (or equivalent) queryable via `task_list`'s existing filter mechanics
  (label or a dedicated field), not merely present in body text.
- Write timing: at the SAME SELECT event that picks a different candidate — every task in the
  `milestone-candidate` pool considered that pass (not just the losing runner-up) gets touched, so a
  reader can distinguish "never considered this pass" from "considered and passed over, here's why."
- Body-first for portability (§12) — the "not selected" reason lives in a body section primarily,
  with `extra.notSelected` as an optional native-only machine-readable mirror, same pattern as §12
  states generally.

---

## 11. Execution provenance — write-back on ABSORB, incl. the DIR sub-tension (DIR-009 item 10)

**Requirement:** every executed task — including DIR tasks — is tagged with the milestone that
executed it (`milestone:M-NN` label or `extra.executedBy`) and carries a record of the execution
process (pointer/summary via `appendNote` or a body section). The milestone may ALSO keep its own
fuller record under `milestones/M-NN/` (the task record is the board-visible summary, not the sole
copy) — per §7's worked examples, which do exactly this (body sections summarize, the real
iteration reports remain the fuller record).

**The DIR sub-tension — resolution:**

A DIR task is a regenerated, never-hand-edited M05 projection (§1's scope boundary: directive files
stay file-canonical, unchanged by this design). Its milestone tag and execution record therefore
cannot be hand-written onto the task directly — doing so would violate M05's "regenerated, never
hand-edited" invariant for that task, and would silently get overwritten (or produce a spurious
divergence the anti-drift check would then flag) the next time `/quay-directive` step 5c regenerates
the projection.

**Resolution: option (i) — add the fields to the canonical DIR *file*, flow into the task on
regeneration.** Concretely:
- Extend the DIR file format (`experiments/quay-native-bootstrap/directives/README.md`'s `## File
  format`, inherited by every experiment) with an optional `## Resolution` sub-field —
  `executed_by:` (the milestone id that executed/applied the directive, if any) — alongside the
  existing `resolved_by`/`outcome`/`evidence` fields DIR-009/DIR-010's own `## Resolution` sections
  already demonstrate in practice (see this very directive's own archived files, which already
  carry `resolved_by: outer-loop drain (m12->m13 boundary)` informally in prose — this design
  proposes making that a structured, machine-projectable field).
- `.claude/skills/quay-directive/SKILL.md` step 5's projection (already regenerating the task body
  from the file on every status change, per step 5c) is extended to ALSO project `executed_by:` into
  the task's `extra.executedBy` and a body line, using the SAME regeneration call already
  happening — no new regeneration trigger needed, just a wider payload on the existing one.

**Why option (i), not option (ii) (a separate annotation namespace the anti-drift check ignores):**
option (ii) creates exactly the drift risk DIR-010 item 3's own framing warns against — a second,
undocumented place execution provenance could live, invisible to both the DIR file (the actual
source of truth) and the anti-drift check (which would have to be told to ignore it, weakening its
own "any task field not accounted for is a bug" discipline). Option (i) keeps the DIR file as the
single source of truth for DIR-related execution provenance too, consistent with §1's boundary that
directives remain file-canonical — the milestone tag simply becomes one more fact the file records
and the projection mirrors, no different in kind from the existing `status:`/`Status mirror:` pair
M05 already handles.

---

## 12. Portable metadata vs native-only convenience (DIR-009 item 11)

**Constraint (verified, DIR-009 item 11 + M09's PR-ABI-001 fix):** the native store's `extra{}` is
an arbitrary k/v map; GitHub CANNOT write `extra` (GitHub issues have no arbitrary-metadata slot,
and M09's fix makes an `extra` write an explicit hard error, not a silent drop). GitHub CAN write
`title`/`body`/`labels`.

**Rule adopted (matches M05's own existing practice, generalized):** every structured field this
design adds — milestone-lifecycle status (§3), selection provenance (§10), execution provenance
(§11), grouping (§13) — is designed **body-first**: a structured markdown section in the task
`body` is the portable, cross-provider-writable form. `extra{}` is used ONLY as an optional
native-only machine-readable mirror of the same facts, exactly the pattern M05's anti-drift check
already uses (`extra.dirStatus` checked first, falling back to parsing the body's `Status mirror:`
line — see `it0-dir-projection-check.sh`'s own doc comment, quoted in this repo).

**Concrete body-section conventions this design specifies** (for a future implementing milestone to
literally use, not re-derive):
- `## Backlog candidate (backfilled from backlog.md)` or `## Backlog candidate` — surface/source/e-x/
  value-type fields, human-readable prose.
- `## Selection provenance` — freeform prose, one paragraph per SELECT event touching this task.
- `## Execution provenance` — freeform prose, references the executing milestone + iteration
  reports.
- A trailing `Backfilled: <date>, from backlog.md row as of commit <sha>` line where applicable
  (§6/§7).

Every one of these has an `extra.*` mirror ONLY on the native provider (§7's worked examples show
both: `extra.executedBy`/`extra.backfilled`/etc. alongside the equivalent body prose) — the GitHub
provider write path (a future concern, not built by this design) would write the body sections and
`milestone:M-NN`/`milestone-candidate` labels only, silently omitting `extra`, and would remain
fully functional because the body sections carry the same information redundantly. **The Core CLI
edit-surface work needed to actually WRITE these fields (`task edit --body`/`--labels`/`--extra`,
currently status-only per M05's own iteration-0 finding cited in its charter) is out of scope here —
split out to DIR-011 / `M-CLI-EDIT-PARITY`, per DIR-009 item 11's own explicit routing.**

---

## 13. Milestone-as-grouping representation, portably (DIR-009 item 12)

**Decision (restated from §2, with the portability framing DIR-009 item 12 specifically asks for):**
`milestone:M-NN` label is the portable PRIMARY grouping key. Parent/children (native-only
enrichment) is reserved for epics (§2's first case — a single large candidate split into subtasks),
NOT used as the primary milestone-grouping mechanism.

**Portability comparison (the tradeoff DIR-009 item 12 names explicitly):**

| Mechanism | Native provider | GitHub provider | Chosen role here |
|---|---|---|---|
| `parent`/`children` | Full read+write; `role: compound` auto-derived | READ via body task-list checkboxes (`extractChildRefs`) works; WRITE hard-errors (M09) | Native-only enrichment, epics only (§2) |
| `milestone:M-NN` label | Full read+write | Full read+write (labels are a first-class GitHub Issues field) | **Primary grouping key, both providers** |

This table is the concrete "decide with the DIR-011 portability findings in hand" DIR-009 item 12
asks for — decided now, in this design pass, using M09's already-shipped, already-verified
portability findings (real GitHub write path, live-tested) rather than waiting on DIR-011's own
still-backlogged CLI-parity work, since the underlying portability FACT (GitHub can't write
parent/children, can write labels) is already settled independent of whether the CLI edit surface
exists yet to exercise it.

---

## 14. `backlog.md` weakens to a generated view, ordered by value not recency (DIR-009 item 13)

**Confirmed as stated in DIR-009 item 13, no revision:**
- **Recency is free but wrong as primary sort.** `updatedAt` (file-mtime) + `--sort updated` (CLI) +
  `?sort=updated` (Web UI) already exist — a recency-first index needs zero new code, but recency is
  the wrong SELECT-primary ordering (a just-touched low-value task would float to the top; an
  aged-but-urgent one would sink, as DIR-004/Distribution once did per DIR-009's own example).
  Recency remains available as a secondary/alternate sort only.
- **No new `priority` field.** The value-typed ledger fields already carried per-task (§7/§10's
  `Δv̂`, `value-type`, `e/x`, `urgency`, `source`, `surface` — all present in this design's body-
  section conventions, §12) ARE the priority signal. `backlog.md`'s ordering is a value-view
  computed from those fields, expressible as a saved query/URL
  (`?label=milestone-candidate&sort=<value-key>`).
- **The small product piece needed** (a `--sort`/`?sort=` key over a value field, or client-side
  ordering over the JSON) rides with DIR-011's Core-CLI work (§16 lists this explicitly as a future
  Done-when item) — not a new schema field, not built by this design.
- **The irreducible residue is curation** (SELECT's own value-typed-ledger judgment, "Δv̂ is one
  input among several," per `inherited-core.md`'s Ranking discipline section) — already has a home
  via §10's selection provenance (the not-selected reasons ARE the curation record). Nothing is lost
  demoting `backlog.md` to a generated, value-ordered index.
- **Optional `priority:*` label** — this design does NOT recommend adding one. §10's selection
  provenance (a body note, written every SELECT pass for every considered candidate) already
  captures the "escalate past the value sort" case with more context (a stated reason) than a bare
  `priority:*` label would, at no extra schema cost. A future implementing milestone should treat
  this as settled unless live experience with the design shows the provenance note alone is
  insufficient — recorded here as the design's own opinion, not left as an open menu (matching this
  document's overall stance of stating one recommendation, not enumerating options, wherever the
  charter allows a decision to be made now).

**What `backlog.md` becomes, concretely:** a markdown table generated by a script (not built here)
that reads `task_list({label: "milestone-candidate", label: "exp5"})`, sorts by the value-typed
fields in `extra`/body (§12), and renders the same columns the current hand-maintained table has
(id/title/surface/source/e-x/value-type/notes) — with a header comment stating it is
machine-generated and should not be hand-edited, same convention M05 uses nowhere explicitly stated
in this repo yet but implicit in "the projection is regenerated, never hand-edited."

---

## 15. DIR-010 sub-section — the 4 numbered items

DIR-010 found the M05 directive-projection mechanism has two live structural gaps and asked for a
design covering 4 items, folded here per DIR-009 item 2 / DIR-010's own suggested routing ("may be
folded into DIR-009's design doc as a sub-section... if that reads more coherently").

**Live confirmation the gap is real, as of this design pass** (re-checked in this worktree's own
`tasks/` snapshot, not merely cited from DIR-010's prose): `tasks/DIR-004.md` exists but its body is
`## DIR-004 task — superseded by file-based record`, `labels: [experiment-4, directive]` — this is
**exp4's** DIR-004 (Node SEA/Bun packaging), NOT exp5's own DIR-004 (milestone-sizing,
`experiments/quay-perpetual-stream/directives/archive/DIR-004-*.md`). Confirms DIR-010's Gap A
exactly: exp5's real DIR-004/DIR-005 have no projection at all because the ids are already taken.

### 15.1. Item 1 — Experiment namespace decision (the crux, single recommended resolution required)

**Recommended resolution: an `extra.experiment` field the check joins on, IN ADDITION TO the bare
`DIR-NNN` id — NOT an experiment-prefixed task id.**

Reasoning, weighing DIR-010's own three named options:

| Option | Verdict | Why |
|---|---|---|
| (a) Experiment-prefixed task id (`exp5-DIR-004`) | **Rejected** | Requires renaming every existing task id retroactively (all of exp4's `QX-*`/`DIR-*` tasks AND exp5's own `DIR-003..011` tasks already exist under bare ids in the live store, confirmed above) — a disruptive, high-blast-radius migration for a namespace problem that has a much smaller fix available. Also breaks the join-key stability the `/quay-directive` skill's step 1 already relies on (computing next id by scanning `DIR-NNN.md` filenames — those filenames are NOT going to be renamed, so the task id would permanently diverge from the filename-derived id it's supposed to mirror). |
| **(b) `extra.experiment` field the check joins on** | **RECOMMENDED** | Additive, not disruptive — every EXISTING task keeps its current id; only the anti-drift check's join logic changes (join on `(experiment, DIR-NNN)` tuple instead of bare `DIR-NNN`). New DIR-task projections (`.claude/skills/quay-directive/SKILL.md` step 5b, already writing `extra: {dirFile, dirStatus}`) add one more key, `extra.experiment` (derivable from the `dirFile` path's own `experiments/<EXPERIMENT>/` prefix — no new input needed, computed from data already being written). Directly generalizes to DIR-009's own milestone/backlog tasks too (§9's design already assumes an `exp5` discriminator label/field for exactly this reason — this recommendation makes that assumption's mechanism concrete and consistent across both domains). |
| (c) Per-experiment label filter | **Rejected as PRIMARY, but folded in as a complementary filter** | A `experiment-5`/`exp5`-style label (exp4 already uses `experiment-4` per the QX-042 example above) is good for Web UI/CLI FILTERING (narrowing a view to one experiment's tasks) but is weaker as the anti-drift check's JOIN KEY specifically, because a label is a set-membership fact, not a structured field the check can extract with the same reliability as `extra.experiment` (labels can theoretically be duplicated/mistyped/omitted without a schema; a dedicated `extra` field is the same reliability class M05 already trusts for `dirStatus`). Recommendation: keep BOTH — `extra.experiment` as the check's join key (this section's core decision), a per-experiment label (e.g. `exp5`, already informally used per §9/§13) as the human/UI-facing filter convenience. They serve different purposes and are cheap to maintain together (one is derivable from the other at write time). |

**Corollary DIR-010 item 1 itself names, confirmed:** exp5's own milestone/backlog tasks (this
design's §1-§14) face the identical collision risk and need the SAME namespace decision — resolved
here identically: every `milestone-candidate`/`milestone:M-NN` task this design creates also carries
`extra.experiment: "exp5"` and the `exp5` label, using the one mechanism decided in this section for
both domains (DIR tasks and backlog/milestone tasks), not two separate namespace schemes.

### 15.2. Item 2 — Reconcile cadence stronger than boundary-only

**Recommended resolution: strengthen the existing "who regenerates on status change" responsibility
FIRST (make it enforced, not just documented, per DIR-010's own framing), and add a standing check
as the second, complementary layer — not a CI hook as the primary mechanism.**

Concretely, for a future implementing milestone:
1. **Primary fix — enforce the existing step 5c responsibility mechanically.** `.claude/skills/
   quay-directive/SKILL.md` step 5c already documents "whatever iteration performs [a DIR file
   status change] is responsible for also re-invoking this projection step... in the same action."
   DIR-010's Gap B fired specifically because this responsibility was *documented but not enforced*
   — M10-audit-consolidation moved 3 files to `archive/` and changed `status:` without regenerating.
   A future milestone should add a git pre-commit hook (or equivalent CI job, consistent with
   `inherited-core.md`'s own "domain-misfit audit-channel IS a CI job" confirmed pattern, §
   "CONSOLIDATED — φ-confirmed pattern") that runs `it0-dir-projection-check.sh` and BLOCKS a commit
   that changes a DIR file's `status:` line without a corresponding task-projection regeneration in
   the same commit — turning "responsible for" into "cannot commit without."
2. **Secondary/complementary — the OUTER-LOOP drain step already exists at SELECT (M05 in-scope item
   4) — extend its cadence to also fire at every ABSORB, not only SELECT.** This closes DIR-010's own
   named boundary-only gap directly (its item 2 lists this as one candidate: "at every ABSORB").
   ABSORB is the natural moment because it is precisely when a milestone's DIR-related file-status
   changes (deferred→applied, etc.) actually happen.
3. **Do NOT rely on a general standing/scheduled check as the primary mechanism** — this repo has no
   existing cron/scheduled-task infrastructure for this experiment (confirmed: `OUTER-LOOP.md`'s own
   cadence is pass-driven, not wall-clock-driven), so a "standing check" here really means "hooked
   into the actual write paths that can cause drift" (commit-time + ABSORB-time), which items 1-2
   above already specify concretely, rather than a genuinely separate periodic process this
   experiment has no infrastructure to run.

### 15.3. Item 3 — Mirror-status vocabulary fix

**Recommended resolution: extend the documented vocabulary to include `resolved`, reconciled with
`applied` as a synonym pair, rather than restricting files to the narrower documented set.**

Reasoning: `resolved` is already the status DIR-009/DIR-010's own archived files use in practice
(confirmed live: `tasks/DIR-009.md`'s `extra.dirStatus: deferred` reflects `DIR-009`'s actual
`## Resolution` `outcome: deferred` — but separately, this repo's own directive files, per the
`grep` evidence DIR-010 itself cites, use `resolved` as a status word in at least the M10-
consolidation instance). Restricting files to the narrower set (`pending | applied | deferred |
rejected`) would require retroactively rewriting already-resolved directive files' status lines —
higher-blast-radius than extending the vocabulary the mirror mechanism recognizes. Recommended
concrete change (for a future implementing milestone, not made by this design): `.claude/skills/
quay-directive/SKILL.md`'s step 5b documented vocabulary line becomes `pending | applied | deferred |
rejected | resolved` (five values), with an explicit note that `resolved` and `applied` are
DISTINCT, not synonyms needing reconciliation into one — `applied` means "the requested action was
implemented," `resolved` means "the directive's disposition was decided/closed" (which may be
`deferred`, i.e. "resolved: deferred" as DIR-009/DIR-010's own `## Resolution` sections already
phrase it) — so the fix is additive vocabulary extension, not a collapse of two words into one.

### 15.4. Item 4 — Immediate disposition of the (now 2, previously 5) divergences

**Not hand-patched here, per DIR-010's own item 4 instruction** ("to be executed by the next
outer-loop drain or the milestone that adopts this design — not hand-patched ad hoc now").

Current live state, reconfirmed in this design pass (not merely cited from the m12→m13 drain
commit's own claim): `git log` shows commit `c2217c99`'s message states Gap B was fixed at that
drain (5→2 divergences); this design's own live read of `tasks/DIR-004.md`/`tasks/DIR-005.md`
above confirms the remaining 2 divergences are exactly the DIR-004/DIR-005 collision Gap A
predicts. **Once §15.1's namespace decision is adopted by a future implementing milestone**, the
concrete disposition action is: re-project exp5's real `DIR-004`/`DIR-005` files under a
namespaced join (e.g. `extra.experiment: "exp5"` distinguishing them from exp4's existing
`DIR-004`/`DIR-005` tasks at the SAME bare id) — this requires the native provider to support two
tasks at the same bare `DIR-004` string id disambiguated by `extra.experiment`, OR (if the store's
id space is truly flat/unique, which needs live verification by that future milestone, not assumed
here) requires exp5's projections to use a distinguishing id suffix at write time while keeping the
DIR-NNN.md filename unchanged — this residual mechanical question is explicitly left to §16's
future-milestone checklist (item: "verify whether the native task store enforces global id
uniqueness; if so, the namespace decision's join key must live in a field distinguishable at
write-id-choice time, not only at query-join time").

---

## 16. Done-when clauses a future implementing milestone would need (charter Done-when clause 5)

- `[ ]` Verify whether the native task store enforces global id uniqueness (§15.4's open mechanical
  question) — pasted evidence of the actual constraint (schema/code read, not assumption).
- `[ ]` Extend `.claude/skills/quay-directive/SKILL.md` step 5b's projection payload to include
  `extra.experiment` (derived from the `dirFile` path) — pasted before/after diff.
- `[ ]` Extend `.claude/skills/quay-directive/SKILL.md`'s documented status-mirror vocabulary to
  `pending | applied | deferred | rejected | resolved` (§15.3) — pasted diff.
- `[ ]` Re-project exp5's real `DIR-004`/`DIR-005` under the chosen namespace, and regenerate
  `DIR-006`/`DIR-007`/`DIR-008`'s mirrors if any have drifted again since the m12→m13 drain — pasted
  `it0-dir-projection-check.sh` PASS output (0 divergences), not just a claim.
- `[ ]` Add a commit-time enforcement mechanism (pre-commit hook or CI job, §15.2 item 1) that blocks
  a DIR-file status change without a corresponding projection regeneration in the same commit —
  demonstrated catching a deliberately-induced violation (a status-changed-but-not-regenerated
  commit attempt), not just the pass case, mirroring M05's own Done-when clause 3 evidence
  discipline ("demonstrated catching BOTH failure modes").
- `[ ]` Extend `OUTER-LOOP.md`'s existing SELECT-time drain/reconcile step (M05 in-scope item 4) to
  ALSO fire at ABSORB (§15.2 item 2) — pasted before/after diff of the relevant `OUTER-LOOP.md`
  section.
- `[ ]` Add the DIR file format's optional `executed_by:` field (§11) and extend
  `.claude/skills/quay-directive/SKILL.md` step 5 to project it — pasted diff + a real dogfood
  invocation showing a DIR task's `extra.executedBy`/body reflecting a real milestone id.
- `[ ]` Implement the `backlog.md`-generation script (§14) that reads `task_list({label:
  "milestone-candidate", label: "exp5"})` and renders the existing table shape, value-sorted — pasted
  script + a real generated `backlog.md` diff showing it matches the live task store.
- `[ ]` Implement the one-time backfill (§6/§7) for ALL of M01..M12's closed `backlog.md` rows (not
  just the 2 worked-example rows in §7) — pasted task-store diff/listing showing the full set,
  cross-checked against `backlog.md`'s current row count.
- `[ ]` Wire SELECT's read path (§9) to call `task_list`/CLI `task list --json` with the
  `milestone-candidate` + `exp5` label filter as its actual decision input, replacing
  `backlog.md`-eyeballing — pasted evidence of a real SELECT pass using this call.
- `[ ]` Wire SELECT's write-back (§10) so every candidate considered in a pass gets a
  selected/not-selected provenance note — pasted evidence from a real SELECT pass showing both a
  selected task's `milestone:M-NN` label AND at least one not-selected task's provenance note.
- `[ ]` Wire ABSORB's write-back (§11) so an executed task (both a plain backlog task and, separately,
  a DIR task per the resolved sub-tension) gets its execution-provenance body section — pasted
  evidence from a real ABSORB.
- `[ ]` Implement the narrower `it0-backlog-projection-check.sh` staleness check (§4 item 4) —
  pasted PASS/FAIL demonstration for a deliberately-staled `backlog.md`.
- `[ ]` Full existing test suite still passes (no regression) — pasted raw output, same discipline
  M05's own Done-when clause 5 required.

---

## Appendix — non-goals restated for this document itself

This document does not implement any of the above. No product code, `OUTER-LOOP.md`,
`inherited-core.md`, or `it0-dir-projection-check.*` file is modified by producing this document —
confirmed via `git diff --stat` against this milestone's pre-charter base commit in this
milestone's own iteration-0 report.
