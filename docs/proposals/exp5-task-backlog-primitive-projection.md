# exp5 task-backlog-primitive projection — design doc

**Status:** design only (no implementation). Produced by M13-task-backlog-projection iteration-1,
per the human's own routing decision quoted in DIR-009 ("先只出设计文档/directive — do not
implement, do not add a dispatch-ready charter, do not hand-edit `OUTER-LOOP.md` yet").

**Sources:** DIR-009 (`experiments/quay-perpetual-stream/directives/archive/DIR-009-*.md`) and
DIR-010 (`experiments/quay-perpetual-stream/directives/archive/DIR-010-*.md`), both drained at the
m12→m13 boundary into `backlog.md`'s `M-TASK-BACKLOG-PROJECTION` row. Grounded in two real
precedents this doc generalizes rather than re-derives: DIR-002/M05-dir-projection (file-canonical
projection + anti-drift check + boundary-only reconcile hook) and exp4's `QX-*` self-hosting
practice (`experiments/quay-continuous-bootstrap/`).

## Table of contents / DIR-009 item map

| Doc section | DIR-009 item(s) answered |
|---|---|
| §1 Canonical-direction decision | 1 |
| §2 Variable granularity + regrouping | 2 |
| §3 Status/lifecycle mapping | 3 |
| §4 Projection + anti-drift, generalized from M05 | 4 |
| §5 Web UI surfacing | 5 |
| §6 One-time backfill plan (+ worked example) | 6 |
| §7 Non-goals / guardrails | 7 |
| §8 SELECT read path | 8 |
| §9 Selection provenance (write-back on SELECT) | 9 |
| §10 Execution provenance (write-back on ABSORB), incl. DIR sub-tension | 10 |
| §11 Portable metadata vs native-only convenience | 11 |
| §12 Milestone-as-grouping representation | 12 |
| §13 `backlog.md` weakens to a generated, value-ordered view | 13 |
| §14 DIR-010 sub-section | DIR-010 items 1-4 |
| §15 Done-when clauses for a future implementing milestone | (Binary Done-when clause 5) |

Every DIR-009 numbered item (1-13) and every DIR-010 numbered item (1-4) has exactly one home
section below; none are answered only implicitly.

---

## §1. Task as the backlog primitive — canonical-direction decision (DIR-009 item 1)

**Recommendation: confirm DIR-009's own tentative option (b) — the quay task becomes canonical
for exp5's OUTER-loop backlog/milestone/selection tracking; `backlog.md` becomes a generated
view.** This is an independent re-confirmation, not a rubber-stamp — the reasoning:

Option (a) (files stay canonical, tasks are a pure read-only projection, mirroring M05 exactly)
fails on its own terms the moment items 9 and 10 are taken seriously. Selection provenance (§9)
and execution provenance (§10) are *per-pass, incremental, many-small-writes* data — a
not-selected reason recorded at every SELECT pass, an execution note appended at every ABSORB.
M05's directive projection works as a pure read-only mirror precisely because a DIR file changes
rarely (created once, resolved once) and the mirror only needs to track two fields
(id, status). Backlog/milestone tracking changes on every outer-loop cycle. Forcing that
per-pass state through "edit the markdown file, then regenerate the task" doubles every write and
reintroduces exactly the dual-representation-with-manual-sync failure DIR-002's post-mortem
diagnosed in exp4's DIR-006 (mechanism half-built, so the two copies drift). A pure projection
model is safe when the source changes are rare and manually curated; it is the wrong shape when
the source changes are frequent and machine-appended.

Option (b) also has a load-bearing practical advantage the DIR-009 text underweights: `task_list`
already gives SELECT free filtering/sorting/labeling infrastructure (§8) that `backlog.md`-as-
canonical would have to reinvent as bespoke markdown parsing. Making the task canonical means
SELECT/ABSORB write through the same interface they already read through — one code path, not two.

**Scope of the reversal is deliberately narrow**, matching DIR-009's own framing: this decision
applies **only** to exp5's own backlog-candidate / milestone-grouping / selection-provenance /
execution-provenance tasks (the ones this design doc creates). It does **not** extend to directive
files, which stay canonical exactly as M05 established (see §14 item for how the two mechanisms
now coexist without conflict: DIRs are file-canonical/task-projected, backlog items are
task-canonical/`backlog.md`-projected — different primitives, different directions, both
documented so nobody has to guess).

**Consequence accepted:** `backlog.md` and `dashboard.md` stop being the place a human or agent
edits by hand for backlog/milestone tracking once a future implementing milestone lands this
design. They become generated views (§13), same relationship DIR-file projections have to their
task mirrors today, just inverted in which side is generated.

---

## §2. Variable granularity + regrouping (DIR-009 item 2)

Model:
- **Backlog-candidate task**: `label: milestone-candidate`, created at any time a candidate is
  identified (from a directive drain, a gap-list finding, or direct human input) — independent of
  when or whether it is ever selected. This is the base primitive; it exists *before* any
  milestone selection, per DIR-009's own correction ("tasks are backlog primitives that predate
  and regroup into milestones... NOT milestone→task 1:1").
- **Epic**: a `milestone-candidate` task large enough to warrant decomposition gets child tasks via
  the native store's existing `parent/children` field (already supported, no schema change). The
  parent's own `role: compound` is derived automatically from having non-empty children (existing
  native-provider behavior, confirmed in M09-gh-write's design note on parent/children semantics).
  No new field needed for "this candidate is actually an epic" — it is structurally implied by
  having children.
- **Milestone-as-grouping**: when SELECT picks one-or-more candidate tasks (whether an epic's
  children, several small unrelated candidates, or a single candidate) to become milestone
  `M-NN`, the grouping is recorded via a shared `milestone:M-NN` label applied to every member task
  at SELECT time (see §12 for why label, not parent/children, is the *primary* portable grouping
  key — parent/children is reserved for the epic-decomposition relationship, which is a different
  axis than milestone membership and can co-exist with it on the same task).
- **Freeze invariant**: membership in `milestone:M-NN` is assigned once at SELECT and is frozen for
  the milestone's duration — consistent with the existing charter-freeze-mid-milestone rule
  (`OUTER-LOOP.md` step 2/observed elsewhere in this experiment). A future implementing milestone's
  Done-when should include a check that no task gains or loses a `milestone:M-NN` label after that
  milestone's charter is authored, short of an explicit charter amendment.

---

## §3. Status/lifecycle mapping (DIR-009 item 3)

Two independent status axes, deliberately kept separate (mirrors the M05 precedent of keeping a
task's own status distinct from the directive's mirrored `status:`):

**Task's own store status** (native provider's existing `status` field, unchanged vocabulary):
- `todo` — candidate exists, not yet selected. This is the "backlog, unselected" state.
- `in-progress` — task is a member of a currently-dispatched milestone (`milestone:M-NN` label
  present, milestone not yet ABSORBed).
- `done` — task's milestone has ABSORBed and the task's own scope was completed as part of it.
- `needs-human` — reserved for the existing native-provider semantics (unblocks via human action);
  usable if a candidate needs a decision before it can even be considered at SELECT.
- (epic parents use whatever status best reflects aggregate child state; this doc does not
  introduce new automatic parent-status derivation — out of scope, a CLI/store enhancement if ever
  wanted, not a backlog-projection concern.)

**Milestone-grouping status** (a *separate*, derived concept — NOT stored redundantly on each
member task beyond the `milestone:M-NN` label itself): the grouping's status is the *milestone's*
own status as already tracked in `backlog.md`/`dashboard.md` today (SELECTED → dispatched →
DONE/STALE/ABANDONED). A future implementing milestone should NOT invent a second `extra.
milestoneStatus` field to duplicate this — the milestone's own status is derivable by taking the
`MAX` lifecycle state over its member tasks' own `status` field, or, more robustly, sourced
directly from the (regenerated) `backlog.md` view itself (§13), which already computes it. Two
copies of the same derived fact is exactly the drift DIR-002 warns about; derive, do not
duplicate.

**Deferred/stale states**: `backlog.md` today marks candidates "STALE at mN SELECT" in prose. Once
this design lands, that becomes item 9's not-selected reason (§9) recorded on the task itself —
STALE is not a new task-store status value, it is a `label:stale` tag (optional, filterable) plus
the provenance note explaining why. Using a label rather than overloading `status` keeps the
status vocabulary small and keeps "why passed-over" as freeform provenance, not a fixed enum that
will inevitably need a new value the mechanism doesn't recognize (exactly DIR-010 item 3's
`resolved`-not-in-vocabulary lesson, applied preemptively here).

---

## §4. Projection + anti-drift, generalized from M05 (DIR-009 item 4)

Because §1 makes the task canonical (not file-canonical), the projection direction here is the
**mirror image** of M05's DIR mechanism, not a literal reuse of the same script:

- **M05 (DIR files)**: file canonical → task is the regenerated projection → anti-drift check
  compares file `status:` vs. task's status-mirror field → regenerated at DIR-file status change
  (skill step 5c).
- **This design (backlog/milestone tasks)**: task canonical → `backlog.md`/`dashboard.md` are the
  regenerated projection (§13) → anti-drift check compares task fields (`milestone:M-NN` label,
  `status`, `extra.notSelected`/body provenance) vs. `backlog.md`'s row content for the same
  candidate → regenerated whenever `backlog.md` is rebuilt (every SELECT/ABSORB, since those are
  exactly the points the task fields change).

A future implementing milestone's anti-drift check (call it
`it0-backlog-projection-check.{sh,mjs}`, sibling-named to `it0-dir-projection-check.{sh,mjs}`,
same node-based JSON-diff approach, no jq dependency) should fail on:
(a) **STALE-VIEW** — `backlog.md` contains a row/id with no corresponding `milestone-candidate`
    task (the inverse of M05's "task with no file"), and
(b) **GROUPING-DISAGREEMENT** — `backlog.md`'s recorded milestone/status for a task disagrees with
    the task's own `milestone:M-NN` label / `status` field.

Because `backlog.md` is now *generated* (§13), (a) should be structurally near-impossible once the
regeneration step itself is correct (the view is built by querying tasks, so it cannot contain a
row the query didn't return) — the check's real value is catching a **stale, un-regenerated**
`backlog.md` file after a task-field change (the DIR-010 Gap-B failure mode: mechanism correct,
regeneration step skipped). It should therefore diff the last-regenerated `backlog.md`'s content
hash/timestamp against the current task-store state and flag "regeneration needed" rather than
trying to hand-parse markdown prose for equality.

**OUTER-LOOP drain hook**: unlike M05 (where the trigger lives inside the `/quay-directive`
skill's own step 5c, since a *skill* drives DIR authoring), the trigger for backlog/milestone
regeneration lives in `OUTER-LOOP.md` itself, at the same two points task fields change: SELECT
(step 1, writes `milestone:M-NN` + not-selected provenance, §9) and ABSORB (step 6, writes
execution provenance, §10). Both steps should end with "regenerate `backlog.md`/`dashboard.md`
from the task store, then run the anti-drift check" as an explicit sub-step, exactly mirroring how
M05's skill step 5c pairs a DIR-file status change with immediate task regeneration. This closes
DIR-010's Gap-B lesson (boundary-only reconcile lets drift sit uncaught) *by construction*, since
the regeneration is glued to the same action that changes the source of truth, not deferred to a
separate later pass — see also §14 item 2, which generalizes this further (every-ABSORB, not
boundary-only, as the minimum cadence for both mechanisms).

---

## §5. Web UI surfacing = zero new UI code (DIR-009 item 5)

No change needed to `serve.js`. `?label=milestone-candidate` and `?label=milestone%3AM-13` (URL-
encoded `milestone:M-13`) work today via the existing generic `?label=` filter (QW-005), exactly as
`?label=directive` already surfaces DIR projections. Confirmed by inspecting the same filter
mechanism DIR-002/M05 relied on — no new query param, no new template, no new route. The only
"surfacing" work a future implementing milestone does is *writing* the labels (§2, §9, §10); the
UI already knows how to show anything with a label.

---

## §6. One-time backfill plan (DIR-009 item 6)

**Plan**: one non-destructive, additive pass that reads `backlog.md`'s existing DONE (and, ideally,
STALE) rows and, for each, `task_write`s exactly one new `milestone-candidate`-labeled task carrying
`milestone:M-NN` and a backfill-provenance marker — **without deleting or rewriting any git
history**, and without touching `backlog.md` itself in this pass (that only happens once a future
implementing milestone actually lands the "backlog.md becomes generated" cutover, §13). The backfill
is a forward-only data migration: it adds tasks describing history, it does not alter or replay
history.

Fields per backfilled task:
- `id`: a fresh, next-available id in whatever namespace scheme §14 item 1 settles on for this
  experiment (e.g. `exp5-M09` if the experiment-prefixed scheme is chosen — see §14 for the actual
  recommendation).
- `labels`: `milestone-candidate`, `milestone:M-NN`, `backfill` (so backfilled tasks are
  distinguishable from ones that go through the real SELECT flow from this point forward — an
  important provenance distinction, since a backfilled task's "selection provenance" is
  retroactive/synthetic, not a real live SELECT decision).
- `status`: `done` (all backfill targets are DONE rows by construction of this plan — STALE rows,
  if backfilled in a later pass, would get `status: todo` + a `label:stale`).
- `body`: a structured section per §11's body-first-portability convention (see worked example
  immediately below for exact shape).

This does not need per-milestone human judgment calls beyond what `backlog.md`'s own DONE row
already recorded — the backfill is a mechanical extraction, one row in → one task out, matching
DIR-009 item 6's framing ("same category as the DIR-001/DIR-002 historical hole").

### Worked example: M09-gh-write and M12-abi-parent-write

Source rows (verbatim, `experiments/quay-perpetual-stream/backlog.md` lines 40 and 61):

> **M-GH-WRITE** (backlog.md id) — "GitHub Provider write-completeness (title/body/labels/parent-
> children write; fix PR-ABI-001's silent-drop-no-error failure mode at minimum, real write support
> as stretch)" · surface: Provider-ABI · source: gap-list PR-ABI-001 (significant) · e/x: explore ·
> **DONE** (m9, 2026-07-18, merged to master — real title/body/labels write + hard-error floor for
> parent/children, PR-ABI-001 CLOSED, cov 0.654→0.923, realized Δv=+5.38, independently re-verified
> by iteration-1 including a fresh, differently-provisioned Docker audit-channel re-run).

> **M-ABI-PARENT-WRITE** (backlog.md id) — "GitHub Provider parent/children WRITE — close the last
> unimplemented write field M09-gh-write's own charter explicitly excluded" · surface: Provider-ABI
> · source: M09-gh-write's charter Done-when item 4 exclusion note · e/x: exploit · **DONE** (m12,
> 2026-07-18, iteration-0 `f172b29` and iteration-1 `6d76cdf` BOTH independently implemented and
> live-verified full bidirectional reassign-parent semantics against real GitHub scratch issues...
> Provider-ABI cov 12/13(0.9231)→13/13(1.0000), VT chart-1 109.11→110.65/120, realized Δv=+1.54).

Proposed backfilled tasks (exact fields):

**Task 1 — M09-gh-write**
```
id: exp5-M09              (namespace scheme per §14 item 1; see that section for
                            the non-prefixed alternative if a different scheme is chosen)
title: GitHub Provider write-completeness (title/body/labels/parent-children write)
labels: [milestone-candidate, milestone:M09-gh-write, backfill, surface:provider-abi]
status: done

body:
## Backfill provenance
Backfilled milestone record — one-time migration pass, M13-task-backlog-projection design
(DIR-009 item 6). Source: backlog.md row "M-GH-WRITE" (backlog.md's own internal id, distinct
from this task's exp5-M09 id — no history rewrite performed).

## Source
gap-list PR-ABI-001 (significant)

## Value type / cadence
explore

## Outcome (verbatim from backlog.md DONE column, m9 2026-07-18)
Real title/body/labels write + hard-error floor for parent/children shipped and merged to
master. PR-ABI-001 CLOSED. Provider-ABI coverage 0.654 -> 0.923. Realized Δv = +5.38.
Independently re-verified by iteration-1 including a fresh, differently-provisioned Docker
audit-channel re-run.

## Status mirror
done (backfilled from backlog.md DONE row, m9 boundary)
```

**Task 2 — M12-abi-parent-write**
```
id: exp5-M12
title: GitHub Provider parent/children WRITE
labels: [milestone-candidate, milestone:M12-abi-parent-write, backfill, surface:provider-abi]
status: done

body:
## Backfill provenance
Backfilled milestone record — one-time migration pass, M13-task-backlog-projection design
(DIR-009 item 6). Source: backlog.md row "M-ABI-PARENT-WRITE".

## Source
M09-gh-write's charter Done-when item 4 exclusion note ("parent/children WRITE ... out of scope
this milestone ... worth its own future milestone if selected")

## Value type / cadence
exploit

## Outcome (verbatim from backlog.md DONE column, m12 2026-07-18)
iteration-0 (f172b29) and iteration-1 (6d76cdf) both independently implemented and live-verified
full bidirectional reassign-parent semantics against real GitHub scratch issues; full scope
shipped (charter's narrower add/remove-only fallback not needed). Merged to master (a1f581a +
47898fe), iteration-1's implementation kept as canonical on merge conflict. Provider-ABI coverage
12/13 (0.9231) -> 13/13 (1.0000). VT chart-1 109.11 -> 110.65/120. Realized Δv = +1.54. First
real trigger of the out-of-band adversarial-audit gate: verdict CONCERNS (non-blocking).

## Status mirror
done (backfilled from backlog.md DONE row, m12 boundary)
```

These two tasks demonstrate the general pattern: one task per closed `backlog.md` row, `label:
milestone-candidate` + `label: milestone:M-NN` + `label: backfill`, `status: done`, and a body with
provenance/source/value-type/outcome sections lifted directly from the existing DONE-column prose
(no re-judgment, no re-scoring — a faithful mechanical transcription). A future implementing
milestone would run this same transcription for all of M01 through M12's DONE rows (and any
still-open/STALE candidates) in one pass.

---

## §7. Non-goals / guardrails (DIR-009 item 7)

- Do **not** build task-projection for anything beyond exp5's own backlog/milestone work in this
  pass — no attempt to generalize to other experiments' backlogs in the same change (DIR-010's
  namespace decision, §14, is what makes that safe to do *later*, not a reason to do it now).
- Do **not** perturb an in-flight milestone's frozen charter. The `milestone:M-NN` freeze invariant
  (§2) exists precisely so a future implementing milestone's regeneration logic never mutates a
  currently-dispatched milestone's membership mid-flight.
- Directive files **stay canonical** (M05); this design's canonical-direction reversal (§1) is
  scoped to backlog/milestone tasks only, never to DIR files. The two mechanisms are documented as
  deliberately asymmetric, not accidentally inconsistent.
- This milestone (M13) itself performs **no implementation** — no `OUTER-LOOP.md` edit, no
  `inherited-core.md` edit, no `it0-dir-projection-check.*` change, no task-store schema/CLI
  change, no backfill actually executed. This doc specifies; a future SELECT dispatches.

---

## §8. SELECT reads quay via the provider tool — read path (DIR-009 item 8)

A future implementing milestone's `OUTER-LOOP.md` SELECT step (cycle step 1) must obtain the
candidate set by calling `task_list` (MCP tool `mcp__quay__task_list`, e.g. `label:
milestone-candidate`) or the CLI equivalent (`node packages/quay/bin/quay.js task list --label
milestone-candidate --json`) — never by reading `backlog.md` prose directly as the source of
candidates. This is the dogfooding requirement DIR-009 item 8 states explicitly and is what makes
§1's canonical-direction decision actually load-bearing rather than aspirational: if SELECT kept
reading `backlog.md`, the task store would be canonical in name only. `backlog.md` remains useful
as the generated human-readable *view* (§13) SELECT may consult for a quick overview, but the
authoritative query for "what are the candidates" must be the task-store read path.

---

## §9. Selection provenance — write-back on SELECT (DIR-009 item 9)

At every SELECT pass, a future implementing milestone's `OUTER-LOOP.md` step 1 must:
1. Apply `milestone:M-NN` (+ transition `status: todo → in-progress`) to the chosen candidate
   task(s).
2. For **every other** candidate task considered in that pass but not chosen, append a
   not-selected note. Per §11's body-first-portability rule, the primary record is a body line —
   `Not selected @M-NN: <reason>` — with an optional `extra.notSelected` native-only mirror for
   machine queries (same dual-representation pattern M05 uses for `Status mirror:` /
   `extra.dirStatus`).
3. This converts today's `backlog.md`-only "STALE at mN SELECT" prose into a filterable,
   board-visible, per-candidate fact — queryable via `task_list` body-search or (on native only)
   `extra.notSelected` — without requiring a new status enum value (§3's STALE-as-label choice
   keeps this additive).

---

## §10. Execution provenance — write-back on ABSORB, incl. DIRs (DIR-009 item 10)

At every ABSORB, every task that was actually executed as part of milestone `M-NN` (including DIR
tasks, per DIR-009's explicit inclusion) gets:
- `milestone:M-NN` label confirmed/kept (already applied at SELECT, §9 — ABSORB does not
  re-decide membership, only records completion).
- An appended execution-provenance body section — a pointer to (or short summary of) the iteration
  work, e.g. `## Execution record\nExecuted by M-NN, iterations 0-1. See
  experiments/quay-perpetual-stream/milestones/M-NN/iterations/. Outcome: <one-line summary>.` —
  using the store's existing `appendNote` mechanism so the full milestone record under
  `milestones/M-NN/` remains the fuller, authoritative artifact and the task carries only the
  board-visible summary (per DIR-009 item 10's own framing — the task is not required to be the
  sole copy).
- `status: in-progress → done`.

### DIR sub-tension (must be resolved; interacts with DIR-010)

**Resolution chosen: option (ii) — a separate annotation namespace the anti-drift check explicitly
ignores**, not option (i) (adding an `executed_by:`/Resolution field to the canonical DIR file and
regenerating).

Reasoning: DIR files are file-canonical and their *only* generated field on the task side today is
the status mirror (§4's M05 mechanism). Folding milestone-execution provenance into the DIR file
itself (option i) would mean the DIR file's own frontmatter now needs to track *which milestone
executed it*, a fact that belongs to the milestone's lifecycle, not the directive's — DIR-009's own
finding/resolution sections already record this informally in prose (e.g. DIR-009's own
"Resolution" section says "disposed as backlog.md candidate `M-TASK-BACKLOG-PROJECTION`..."). Adding
a second structured field to every DIR file for the same fact duplicates that prose and creates a
new thing for the M05 regeneration step to keep in sync — additional drift surface, which is
exactly what DIR-010 Gap A/B are catalogs of.

Instead: the DIR task's `milestone:M-NN` execution-provenance label/note is applied **directly to
the task** by the executing milestone's ABSORB step, exactly like any other executed task (§10's
general mechanism) — but the M05 anti-drift check (`it0-dir-projection-check.mjs`) is explicitly
updated (as part of, not before, a future implementing milestone) to **ignore** the `milestone:M-NN`
label and any `## Execution record` body section when computing file/task divergence — it continues
to check *only* the `Status mirror:`/`extra.dirStatus` field it already checks today. This keeps the
check's existing, working, narrow contract intact (id + status agreement) while allowing the task to
carry additional, orthogonal metadata the check simply does not look at. No change to what "the DIR
projection is regenerated, never hand-edited" means — the execution-provenance label is layered on
top by a *different* actor (the executing milestone's ABSORB step) at a *different* time, in a field
the DIR-projection regeneration step does not own and therefore cannot conflict with when it
re-runs.

---

## §11. Portable metadata vs native-only convenience (DIR-009 item 11)

Confirmed constraint (per DIR-009 item 11 and M09-gh-write's PR-ABI-001 fix): the native provider's
`extra{}` is an arbitrary k/v map; GitHub cannot write `extra` at all (hard error since M09, not a
silent drop) but can write `title`/`body`/`labels`. Every field this design introduces —
`milestone:M-NN` (label, portable), not-selected reason (§9, body-first), execution-provenance
record (§10, body-first via `appendNote`), backfill provenance (§6, body-first) — is designed
**body-first**: the authoritative, portable copy lives in a structured markdown section of the task
body, writable on both providers. `extra{}` is used only as an *optional* native-only convenience
mirror for machine-readable queries (e.g. `extra.notSelected`, `extra.milestoneId`) — never as the
sole copy of anything this design needs to survive a provider switch. This is the same pattern
M05's own `Status mirror:` body line / `extra.dirStatus` pairing already established; this design
does not invent a new pattern, it reapplies the proven one. The Core CLI edit-surface work actually
needed to *write* these body sections and labels through the CLI (not just MCP `task_write`) is
correctly split out to DIR-011/`M-CLI-EDIT-PARITY` per DIR-009 item 11's own note — this doc does
not re-scope that work in.

---

## §12. Milestone-as-grouping representation, portably (DIR-009 item 12)

**Primary grouping key: `milestone:M-NN` label.** Writable on both providers (native and GitHub both
support label write; GitHub cannot currently write `parent/children`, per M09's hard-error floor).
This is why §2 chose label over parent/children as the primary mechanism for milestone membership,
reserving parent/children for the *epic-decomposition* relationship (a large candidate split into
subtasks) — a different axis that happens to also be graph-shaped, but is native-provider-only
until DIR-011's portability work lands GitHub-side parent/children write, if ever. A task can
simultaneously be a child of an epic parent (native-only enrichment) and carry a `milestone:M-NN`
label (portable) — the two are orthogonal and both may be present.

This decision explicitly depends on and reuses DIR-011's finding rather than re-deriving it: GitHub
issues have no native parent-link field and M09 hard-errors on `parent`/`children` writes, so any
design requiring portable milestone-grouping cannot rely on parent/children as the *primary* key —
only as an enrichment where available.

---

## §13. `backlog.md` weakens to a generated view — ordered by value, not recency (DIR-009 item 13)

Once §1 (canonical direction), §2 (grouping), §3 (status), and §9 (selection provenance) land,
`backlog.md` holds nothing canonical. It becomes a regenerated projection (companion to
`dashboard.md`) over `label: milestone-candidate` tasks, with two explicit ordering decisions:

- **Recency is available for free but is never the primary SELECT-facing order.** The native
  store's `updatedAt` (file-mtime), `--sort updated` CLI flag, and `?sort=updated` Web UI param
  already exist — zero new code needed to expose a recency view. But per DIR-009 item 13's own
  reasoning, recency actively misorders SELECT candidates (a just-touched low-value item floats up;
  an aged-but-urgent one, like DIR-004/Distribution once was, sinks) — so recency is at most a
  secondary/alternate sort (e.g. a `?sort=updated` link on the generated view), never primary.
- **No new `priority` field.** The value-typed ledger fields (Δv̂, value-type, e/x, urgency, source,
  surface) that items 3/9 already put on the task body/labels ARE the priority signal. The
  generated `backlog.md` view's default ordering is a value-view computed from those fields — in
  practice expressible as a saved query/URL (`?label=milestone-candidate&sort=<value-key>`) once
  DIR-011's Core-CLI work adds a `--sort`/`?sort=` key for a value field (or the regeneration
  script itself does client-side sorting over the JSON — a small script-side concern, not a new
  schema field).
- **The irreducible residue is curation (§9's provenance), not a sortable number** — SELECT
  explicitly is not pure-Δv̂ ranking per `inherited-core.md`'s value-typed ledger (≥1 explore per 5,
  governance/risk types may outrank higher-VT items). That human-judgment override already has a
  home: it is exactly §9's not-selected-reason provenance, written onto the tasks. Nothing is lost
  moving `backlog.md` from canonical prose to a generated, value-ordered index with an optional
  recency alternate view.
- **Optional escalation handle**: a portable `priority:*` label (e.g. `priority:urgent`), distinct
  from the derived value order, MAY be added if the "override past the computed order" case proves
  common enough in practice to need a first-class filterable tag rather than relying on §9's
  provenance note alone. This doc does not mandate it — flagged as an open call for the future
  implementing milestone to decide once real usage data exists, per DIR-009 item 13's own
  "decide whether that is worth the extra axis" framing.

---

## §14. DIR-010 sub-section — directive-projection drift

DIR-010 identified two structural gaps in the M05 mechanism (namespace collision, boundary-only
reconcile) plus a vocabulary gap and residue disposition. Addressed here per DIR-010's own suggested
routing (folded into this design doc rather than a separate deliverable), because it is the same
projection mechanism and — per this design's §4 — needs to be extended to backlog/milestone tasks
too, so the namespace decision below covers both.

### Item 1 — Experiment namespace for projections: **concrete recommendation**

**Recommended resolution: experiment-prefixed task ids for all newly-created projected/backfilled
tasks going forward** — e.g. `exp5-DIR-004`, `exp5-M09` (as used in §6's worked example) — **not**
an `extra.experiment` join field and **not** a label-only filter.

Reasoning, weighing the three options DIR-010 itself named:
- **`extra.experiment` join field** fails immediately on the same provider-portability constraint
  §11 already established: GitHub cannot write `extra` at all (hard error since M09). A join key
  that depends on a field one of two providers cannot carry is not a durable disambiguator across
  the portability boundary this whole design is built around.
- **Per-experiment label filter** (e.g. `label: experiment-5`) is portable (labels write on both
  providers) but does not solve the actual bug DIR-010 found: the *id itself* is the collision
  point (`it0-dir-projection-check.mjs` joins file↔task by bare `DIR-NNN`, and a flat id space lets
  exp4's `DIR-004` and exp5's `DIR-004` occupy the same slot before any label is even consulted). A
  label-based disambiguator would require the check to *always* additionally filter by label before
  joining on id — an extra mandatory step that is easy to accidentally skip (as the original
  `it0-dir-projection-check.mjs` bug already demonstrated by joining on bare id with no
  discriminator at all). Prefixing the id removes the possibility of the collision entirely, rather
  than requiring every future consumer to remember an extra filter step.
- **Experiment-prefixed id** is portable (an id is just a string on both providers), collision-proof
  by construction (no two experiments can produce the same prefixed id even if they both run
  DIR-numbering from 1), and requires no change to the join logic beyond using the already-prefixed
  id as the key — simpler than adding a second join dimension.

**Scope of this recommendation**: applies to newly-created/regenerated projections going forward
(new DIR projections from this point on, and any backfilled/newly-created backlog-candidate tasks,
§6). It does **not** retroactively rename exp4's existing un-prefixed `QX-*`/`DIR-*` tasks — that
would be a disruptive, out-of-scope rewrite of an established, working (if unprefixed) practice on a
different experiment's data. The corollary DIR-010 item 1 itself names — "exp5's milestone/backlog
tasks will face the same collision risk" — is exactly why §6's worked example already uses
`exp5-M09`/`exp5-M12` rather than bare `M09`/`M12`, applying this recommendation consistently across
both the DIR-projection and backlog-projection halves of this design.

### Item 2 — Reconcile cadence stronger than boundary-only: recommendation

**Every-ABSORB regeneration, paired with the action that changes status — not a separate standing
check or CI hook as the primary mechanism.** DIR-010 named three candidates (standing check,
pre-commit/CI hook, every-ABSORB-paired-with-the-status-change). This design recommends the third as
primary, for the same reason §4 already argues: gluing regeneration to the exact action that changes
the canonical source (a DIR file's status edit, or a task's `milestone:N-NN`/status write) is what
makes "forgot to regenerate" structurally hard rather than merely documented-as-a-responsibility (the
M05 skill's step 5c already does this for DIR files; M10-audit-consolidation's Gap-B drift happened
specifically because a *different* actor, the audit-consolidation milestone, changed DIR file status
without going through the skill's step 5c path). A standing check (run at the top of every
`OUTER-LOOP.md` cycle, not just SELECT) is still recommended as a **backstop**, not a replacement —
it catches the case where a future actor bypasses the paired-regeneration step the same way M10 did,
exactly the failure mode DIR-010 documented. A CI/pre-commit hook is not recommended as primary,
since these milestones do not have a CI pipeline gating this repo's own markdown/task writes in the
same way product code does; it is a plausible future hardening, not required by this design.

### Item 3 — Mirror-status vocabulary: recommendation

**Extend the documented vocabulary to include `resolved`, treated as a synonym/alias of `applied`**
(the two are semantically the same terminal state — a directive whose requested action has been
carried out — and the skill's own resolution sections already use both words interchangeably in
practice, e.g. DIR-002's own resolution says "status: applied" while other archived directives in
this experiment use `resolved`). Restricting file statuses to a fixed set instead (the alternative
DIR-010 item 3 offered) would require rewriting already-archived directive files' historical
`status:` values to match, which is an unnecessary, disruptive rewrite of settled history for a
purely-cosmetic vocabulary mismatch. Extending the recognized vocabulary is the lower-disruption fix
and is consistent with how `status/lifecycle mapping` (§3 of this doc) already treats vocabulary
extension as preferable to forcing history into a narrower enum after the fact.

### Item 4 — Immediate disposition of the 5 (now 2) current divergences

Per DIR-010's own resolution note (Gap B already fixed at the m12→m13 drain — DIR-006/007/008 now
mirror `resolved` correctly, divergences down from 5 to 2), the 2 remaining divergences
(`DIR-004`/`DIR-005`, no status-mirror field) are exp5's own real DIR-004 (milestone-sizing) and
DIR-005 (v-meta consolidation-lag gate) files, whose ids collide with exp4's pre-existing
`DIR-004`/`DIR-005` tasks. **This design's item-1 resolution (experiment-prefixed ids) is exactly
what unblocks fixing this**: a future implementing milestone re-projects exp5's DIR-004/DIR-005
under the new `exp5-DIR-004`/`exp5-DIR-005` ids (a fresh `task_write`, since the old un-prefixed ids
are permanently occupied by exp4's tasks and are not reclaimable without deleting exp4 data, which
is out of scope). This is **not** performed by this milestone (M13, doc-only) — it is left, exactly
as DIR-010 item 4 itself specifies, for "the next outer-loop drain or the milestone that adopts this
design," to avoid ad hoc hand-patching ahead of the design being adopted. Until then the check
correctly continues to report these 2 divergences — documented, not silently carried forward
(consistent with `backlog.md`'s own `M-TASK-BACKLOG-PROJECTION` row, which already states this
explicitly).

---

## §15. Done-when clauses a future implementing milestone would need

- [ ] `it0-dir-projection-check.mjs` updated to join file↔task using the experiment-prefixed id
      scheme (§14 item 1) — re-run against exp5's real DIR-004/DIR-005 and confirm 0 divergences
      (down from the 2 documented here), pasted PASS output.
- [ ] `it0-dir-projection-check.mjs` extended to ignore `milestone:M-NN` labels and `## Execution
      record` body sections when computing DIR file/task divergence (§10's DIR sub-tension
      resolution) — demonstrated via a DIR task carrying both fields still PASSing the check.
- [ ] Mirror-status vocabulary extended to accept `resolved` as a synonym of `applied` (§14 item 3)
      — a DIR file with `status: resolved` produces a PASS, not a false divergence, pasted evidence.
- [ ] A `milestone-candidate`-labeled task is created for every open `backlog.md` candidate row not
      yet backed by a task (forward-looking creation, distinct from the historical backfill below).
- [ ] The one-time backfill (§6) executed for all of M01 through M12's DONE (and STALE, if any)
      `backlog.md` rows — one task per row, fields matching the §6 worked-example shape — pasted
      `task_list --label backfill` output showing the full set.
- [ ] `OUTER-LOOP.md` SELECT step (cycle step 1) updated to read candidates via `task_list`
      (§8) instead of `backlog.md` prose — pasted transcript of a live SELECT pass using the new
      read path.
- [ ] `OUTER-LOOP.md` SELECT step writes `milestone:M-NN` onto chosen task(s) and a not-selected
      body/`extra` note onto every other candidate considered that pass (§9) — pasted `task_get`
      evidence for both a selected and a not-selected task from the same real pass.
- [ ] `OUTER-LOOP.md` ABSORB step appends an execution-provenance body section + `status: done` to
      every task executed by the milestone, including any DIR tasks in scope that pass (§10) —
      pasted `task_get` evidence.
- [ ] A regeneration script produces `backlog.md`/`dashboard.md` as a generated view from the task
      store, value-ordered by default with a recency alternate (§13) — pasted before/after diff of
      a regenerated `backlog.md` matching live task-store state.
- [ ] A backlog-projection anti-drift check (§4, `it0-backlog-projection-check.{sh,mjs}` or folded
      into the DIR one) exists and demonstrates both STALE-VIEW and GROUPING-DISAGREEMENT failure
      modes with real PASS/FAIL output, mirroring M05's own three-mode demonstration precedent.
- [ ] Web UI `?label=milestone-candidate` and `?label=milestone%3AM-NN` verified live (screenshot or
      `curl` transcript) surfacing backfilled/newly-created tasks with zero `serve.js` changes (§5).
- [ ] Full existing test suite still passes post-change (pasted raw output) — same closing gate M05's
      own Done-when clause 4 used.
- [ ] `git diff --stat` against the pre-charter base commit shows only the expected files touched
      (script(s), `OUTER-LOOP.md`, `backlog.md`/`dashboard.md` regeneration, no unrelated product
      code) — same evidence-gate discipline this doc's own §Binary-Done-when-confirmation section
      demonstrates below.
