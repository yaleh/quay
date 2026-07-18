# DIR-009

- status: deferred
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-18
- title: Track exp5's own non-directive work in quay's task board — as backlog-primitive tasks that predate and regroup into milestones (generalize M05's file-canonical projection beyond directives), so the OUTER stream is self-hosted and visible in the Web UI

## Finding

The `quay serve` Web UI (port 4173) renders only what the native provider's
`./tasks/` store contains. As of this conversation that store holds, for
Experiment 5, **only** the directive projections `DIR-003..DIR-008` (created
by M05-dir-projection's `/quay-directive` skill step). **Every other unit of
exp5's own work is invisible in quay**: the 11 milestones (M01..M11), their
iterations, and every `backlog.md` candidate exist purely as markdown under
`experiments/quay-perpetual-stream/{charters,milestones,backlog.md,dashboard.md}`
and were never written to the task store.

This is not an oversight — M05-dir-projection's charter (in-scope item 6)
explicitly scoped it out: "Do NOT build a general-purpose task-projection
framework beyond directives — scope is directives only." So the invisibility
of non-DIR work is exactly the half M05 deliberately deferred; it will NOT
self-resolve as milestones advance. (By contrast, the "DIR-009+ not yet
visible" case IS self-healing: the moment a new DIR is authored, the skill
projects it. And DIR-001/DIR-002 are a separate, non-self-healing historical
hole — they predate the M05 mechanism and were never backfilled.)

Two grounded precedents bound the design space:
- **M05 directive projection** — file canonical, task is a regenerated
  (never hand-edited) `label: directive` projection, an anti-drift check
  (`scripts/it0-dir-projection-check.{sh,mjs}`) fails on divergence, and the
  OUTER-LOOP drain step reconciles both channels. This is the reusable
  machinery to generalize.
- **exp4 practice** — exp4 DID self-host its dev work: ~55 `QX-*` tasks
  carrying `experiment-4` + `iteration-N` + surface labels (e.g. `QX-067`:
  `experiment-4/iteration-19/packaging`). exp5 dropped this practice. So
  "self-hosting the experiment's work as tasks" is not novel here — it is a
  regression from exp4 that M05 partially (directives-only) restored.

**Granularity correction (human, this conversation) — the projection
direction is NOT milestone→task 1:1.** Tasks are *backlog primitives that
are created long before a milestone is selected*, and their granularity is
inherently uneven: a large task becomes an **epic** that is split into
subtasks; several small tasks are **merged into one milestone at SELECT
time**. So the task↔milestone relationship is a many-to-many *regrouping*
decided at SELECT — a milestone is best modeled as a grouping/label applied
over one-or-more pre-existing tasks (and epics decompose via
`parent/children`, which the native store already supports), not as a 1:1
mirror of a milestone. This matches the existing `backlog.md` shape
(candidates exist ahead of selection; some big, some small).

## Requested action

Produce a **design document only** at this stage (per the human's routing
decision: "先只出设计文档/directive" — do not implement, do not add a
dispatch-ready charter, do not hand-edit `OUTER-LOOP.md` yet). The design
should be detailed enough to later become a backlog candidate that the OUTER
loop SELECTs → charters → dispatches through its own machinery (dogfooding-
consistent; a hand-hacked implementation would bypass the experiment's own
governance and would itself be an un-dogfooded "dogfooding" change).

The design must cover, at minimum:

1. **Task as the backlog primitive — and the canonical-direction decision
   (the crux).** exp5 backlog candidates become `label: milestone-candidate`
   (or similar) quay tasks *when created*, ahead of selection — not derived
   from milestones after the fact. The single-source-of-truth question must be
   answered explicitly (the M05 lesson: ambiguity here is the whole bug). Two
   options: (a) `backlog.md` stays canonical, tasks are a read-only projection
   (pure M05 pattern), or (b) the quay task becomes canonical and `backlog.md`
   becomes a generated view (or is retired).
   **Recommended resolution (this conversation): option (b) for OUTER-loop
   backlog/milestone/selection tracking.** The requirements added below —
   SELECT *reads* the task list via CLI/MCP (item 8), SELECT *writes back*
   selection decisions incl. not-selected reasons (item 9), ABSORB *writes*
   execution provenance (item 10) — all require the task to be a written,
   first-class working surface, which is incompatible with "never-hand-edited
   projection." So for exp5's own OUTER-loop tracking the task is canonical.
   **This is a deliberate, scoped reversal of M05's directives-only restraint**
   — and it does NOT extend to DIRs: directive files stay canonical per M05
   (see item 10's DIR sub-tension). Confirm this direction before a milestone
   implements it; DIR-009 records it as the recommended design, not a
   fait accompli.

2. **Variable granularity + regrouping.** Model epics (a big task split into
   subtasks via `parent/children`) and small-task→milestone merging (several
   tasks grouped under one milestone at SELECT). Define how a milestone is
   represented over its member tasks — a shared `milestone:M-NN` label, a
   parent "milestone" task with the members as children, or an `extra` field
   — and how membership is assigned at SELECT and frozen for the milestone's
   duration (invariant: charter frozen mid-milestone).

3. **Status/lifecycle mapping.** Map task status across the OUTER lifecycle:
   backlog/unselected → SELECTED/dispatched → DONE (ABSORB), plus epic and
   deferred/stale states (cf. backlog rows marked STALE). Distinguish a
   task's own store status from any milestone-grouping status, the way M05
   distinguishes task status from the directive's mirrored `status:`.

4. **Projection + anti-drift, generalized from M05.** A regenerated (never
   hand-edited) projection body; a sibling anti-drift check (generalize
   `it0-dir-projection-check`) that fails on task↔canonical divergence; and
   the OUTER-LOOP drain/reconcile hook (the milestone analogue lives in
   SELECT/ABSORB, not in a skill, since the OUTER loop — not `/quay-directive`
   — drives the milestone lifecycle).

5. **Web UI surfacing = zero new UI code.** The generic `?label=` filter
   already works (QW-005), so a `label: milestone-candidate` / `milestone:M-NN`
   scheme surfaces exp5 work in the running Web UI with no serve.js change,
   exactly as directives did.

6. **One-time backfill plan.** M01..M11 (and any still-open backlog
   candidates) need a documented one-time backfill, same category as the
   DIR-001/DIR-002 historical hole — specify how, without rewriting history
   the OUTER loop will re-derive.

7. **Non-goals / guardrails.** Do not build task-projection for anything
   beyond exp5's own backlog/milestone work in this pass; do not perturb an
   in-flight milestone's frozen charter; directive files stay canonical (M05).

8. **SELECT reads quay via the provider tool (read path).** The OUTER loop's
   SELECT step (cycle step 1) must access the candidate set by calling the
   quay task list through the provider's own tool — `task_list` (MCP) or
   `node packages/quay/bin/quay.js task list --json` (CLI) — not by eyeballing
   `backlog.md`. This is what makes quay the actual working substrate, and it
   dogfoods the read surface each pass. (Requirement: human, this conversation.)

9. **Selection provenance (write-back on SELECT).** Each SELECT records its
   decision onto the tasks themselves: the chosen task(s) get the milestone
   tag (item 10); **every candidate that was considered-but-not-selected this
   pass gets a brief reason recorded** (e.g. an `extra.notSelected` note or a
   body line: "not selected @M-NN: <reason>") so the task board shows why the
   loop passed on it, not just what it picked. This turns the currently-only-
   in-`backlog.md`-prose "STALE at mN SELECT" annotations into first-class,
   filterable task state. (Requirement: human, this conversation.)

10. **Execution provenance (write-back on ABSORB) — incl. DIRs.** Every
    executed task, **including DIR tasks**, is tagged with the milestone that
    actually executed it (e.g. `milestone:M-NN` label or `extra.executedBy`),
    and carries a record of the execution process (a pointer to, or summary
    of, the iteration work — `appendNote`/body section is the natural
    mechanism; the native store already has `appendNote`). Given the
    granularity mismatch (item 2), it is fine for the milestone to ALSO keep
    its own fuller record under `milestones/M-NN/` — the task record is the
    board-visible summary, not the sole copy.
    **DIR sub-tension (must be resolved, interacts with DIR-010):** a DIR task
    is a regenerated, never-hand-edited M05 projection. Its milestone tag and
    execution record therefore cannot be hand-written onto the task — they
    must either (i) be added to the canonical DIR *file* (e.g. an
    `executed_by:`/Resolution field) and flow into the task on regeneration,
    or (ii) live in a separate annotation namespace the anti-drift check
    explicitly ignores. Pick one; do not let it reintroduce the DIR-010
    "change the file, forget to regenerate" drift.

11. **Portable metadata vs native-only convenience (verified this
    conversation).** The rich attributes items 2/3/9/10 add have a hard
    provider-portability constraint: the native store's `extra{}` is an
    arbitrary k/v map, but the GitHub provider CANNOT write `extra` (GitHub
    issues have no arbitrary-metadata slot; M09's PR-ABI-001 fix makes an
    `extra` write an explicit hard error, not a silent drop). GitHub CAN write
    `title/body/labels` (M09). **Therefore portable structured metadata must
    live in a structured markdown section of the task BODY (writable on both
    providers), with `extra{}` used only as an optional native-only machine-
    readable mirror** — exactly the pattern M05's anti-drift check already
    uses (`extra.dirStatus` OR the `Status mirror:` body line). Design the
    milestone/selection/execution fields body-first for portability. The Core
    CLI edit-surface work needed to write these is split out to DIR-011.

12. **Milestone-as-grouping representation, portably.** For item 2's grouping,
    prefer a scheme that works on both providers: a parent "milestone" task
    with member tasks as `children` is natively supported (native derives
    `role: compound` from non-empty children; GitHub represents children via
    body task-list checkboxes, `extractChildRefs`) — but note GitHub cannot
    currently *write* `parent/children` (M09 hard-errors on them), so a
    `milestone:M-NN` label (writable on both) may be the more portable primary
    grouping key, with parent/children as a native-only enrichment. Decide
    with the DIR-011 portability findings in hand.

13. **`backlog.md` weakens to a generated view — but ordered by VALUE, not
    recency (decided this conversation).** Once items 1/2/3/9 land, `backlog.md`
    holds nothing canonical and becomes a pure projection over the
    `label: milestone-candidate` tasks. Two schema facts shape how:
    - **Recency already exists for free** (`updatedAt` file-mtime + `--sort
      updated` CLI + `?sort=updated` Web UI) — a "recency-first index" needs
      zero new code. But recency is the WRONG primary ordering for SELECT: a
      just-touched low-value task would float to the top and an aged-but-URGENT
      one (as DIR-004/Distribution once was) would sink. So recency is at most
      a secondary/alternate sort, never the SELECT-primary surface.
    - **Priority does NOT exist as a task field** (sort keys today are only
      id/status/updated/insertion-order). Do NOT invent a separate `priority`
      axis: the value-typed ledger fields items 3/9 already move onto the task
      (`Δv̂`, `value-type`, `e/x`, `urgency`, `source`, `surface`) ARE the
      priority signal. `backlog.md`'s ordering is a value-view computed from
      those fields — expressible as a saved query / URL
      (`?label=milestone-candidate&sort=<value-key>`). The small product piece
      needed to sort the store by a value field (a new `--sort`/`?sort=` key,
      or client-side ordering over the JSON) rides with DIR-011's Core-CLI
      work; it is not a new schema field.
    - **The irreducible residue is curation, not a sortable number.** SELECT is
      explicitly not pure-Δv̂ ranking (the value-typed ledger: "Δv̂ is one input
      among several"; governance/risk types may outrank higher-VT items; ≥1
      explore per 5). That human-judgment override is exactly item 9's
      selection provenance (the rationale written back onto tasks, incl.
      not-selected reasons) — so `backlog.md`'s last genuinely-canonical
      content already has a home on the tasks, and nothing is lost when it is
      demoted to a generated, value-ordered index (recency available as an
      alternate view).
    Optionally retain a lightweight, portable human-override handle — a
    `priority:*` label (writable on both providers) — for the explicit
    "escalate past the value sort" case, distinct from the derived value order;
    decide whether that is worth the extra axis or whether item 9's provenance
    note suffices.

Deliverable: a design doc (e.g. under `docs/proposals/` or
`experiments/quay-perpetual-stream/`) capturing the above, cross-referencing
DIR-002/M05 as the pattern source and exp4's `QX-*` labeling as the prior
practice. It is then eligible to be drained into `backlog.md` as a real
milestone candidate at a future OUTER boundary.

## Resolution
- resolved_by: outer-loop drain (m12->m13 boundary), 2026-07-18
- outcome: deferred
- evidence: disposed as backlog.md candidate `M-TASK-BACKLOG-PROJECTION` (design-doc-only deliverable, per the human's own routing decision quoted in this file's Requested action). Not yet charter-ready; no OUTER-LOOP.md or implementation changes made. See `backlog.md`'s "DIR-009/DIR-010/DIR-011-sourced candidates" section for the full disposition record, including the still-open DIR-004/DIR-005 task-id-collision residue this directive's design must resolve before it can be fixed.
