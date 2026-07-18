# Charter M13-task-backlog-projection — task-backlog-primitive projection design doc (Tier-A)

**Milestone id:** M13-task-backlog-projection · **surface:** method infra (task store, `OUTER-LOOP.md`,
`/quay-directive`) · **type:** explore
**Source:** `backlog.md`'s `M-TASK-BACKLOG-PROJECTION` row, sourced from DIR-009 (task-backlog-primitive
projection) + DIR-010 (directive-projection drift: cross-experiment id collision + boundary-only
reconcile cadence), both drained at the m12→m13 boundary, 2026-07-18. Picked over the four
DIR-001-sourced methodology candidates (M-OUTCOME-EVAL/M-ADVERSARIAL-EVAL/M-COMPETITIVE-BENCH/
M-HUMAN-REVIEW-CADENCE — all still "not yet charter-ready" per `backlog.md`, no scenario list authored)
and over `M-CLI-EDIT-PARITY` (DIR-011 — conceptually depends on this milestone's body-vs-extra
convention landing first) because: (a) it is the freshest, most concretely-specified human input this
stream has received (13 detailed numbered items in DIR-009 alone), (b) DIR-010's Gap A (the DIR-004/
DIR-005 task-id collision) is a live, currently-failing anti-drift check
(`it0-dir-projection-check.sh` reports 2 persistent divergences) whose fix is blocked on exactly the
namespace decision this milestone makes, and (c) explore/exploit cadence is due for an explore pick
(m11 exploit, m12 exploit — two exploits in a row).
**Charter authored:** m12→m13 boundary, 2026-07-18.
**Pinned Tier-B pointer:** `experiments/quay-perpetual-stream/inherited-core.md` @ this repo's current
HEAD at charter-authoring time (re-read only if that file's SHA changes mid-milestone).

## Value hypothesis
- Value type (per `inherited-core.md`'s value-typed SELECT ledger): **discovery** (primary — the design
  doc itself is the deliverable, per the human's explicit routing decision "先只出设计文档/directive")
  + **governance-integrity** (secondary — DIR-010's Gap A/B are exactly the DIR-002-class "enforcement
  half never built" pattern recurring one level up; a considered design closes that pattern properly
  instead of another ad hoc patch).
- Δv̂: **zero direct VT points** — this is explicitly a design-doc-only deliverable (DIR-009's own
  Requested action: "do not implement, do not add a dispatch-ready charter, do not hand-edit
  OUTER-LOOP.md yet"). No chart-0/chart-1 capability closes this milestone. Value is discovery +
  governance-integrity, measured qualitatively at ABSORB (does the design doc answer DIR-009's 13 items
  and DIR-010's 4 items concretely enough to become a dispatch-ready future charter), not by a Δv
  number. This mirrors M-SIZING (m6) and M-VMETA-GATE (m7)'s own zero-VT, governance-integrity-typed
  precedent.
- Metric `Y`: none (no VT chart move). Success is binary: does the design doc exist, is it concrete
  enough to charter later, and does it not silently drop any of DIR-009's 13 / DIR-010's 4 items.

## In-scope work
1. **Write the design doc** at `docs/proposals/exp5-task-backlog-primitive-projection.md`, covering
   DIR-009's 13 numbered items in full (task-as-backlog-primitive + canonical-direction decision;
   variable granularity/regrouping; status/lifecycle mapping; projection + anti-drift generalized from
   M05; Web UI zero-new-code surfacing; one-time backfill plan for M01..M12; non-goals/guardrails;
   SELECT read-path via `task_list`; selection provenance write-back; execution provenance write-back
   incl. the DIR sub-tension; portable metadata vs native-only convenience; milestone-as-grouping
   representation; `backlog.md` weakens to a generated view ordered by value not recency).
2. **Fold in DIR-010 as a sub-section** (its own suggested routing): the experiment-namespace decision
   for cross-experiment task-id disambiguation (item 1 — decide among experiment-prefixed ids,
   `extra.experiment` join field, or a per-experiment label filter), the reconcile-cadence strengthening
   (item 2 — standing check / CI hook / every-ABSORB regeneration responsibility), and the mirror-status
   vocabulary fix (item 3 — extend to include `resolved`, or restrict files to the documented set).
   State a concrete, single recommended resolution for the namespace decision (not just enumerate
   options) — this is the one immediately load-bearing decision, since it is what unblocks DIR-010's
   still-open DIR-004/DIR-005 divergence.
3. **Do NOT implement.** No `OUTER-LOOP.md` edit, no `inherited-core.md` edit, no `it0-dir-projection-
   check.{sh,mjs}` change, no task-store schema/CLI change, no backfill actually performed. The design
   doc may (and should) specify exactly what a future implementing milestone's Done-when clauses would
   look like, as a section within the doc — but this milestone does not execute them.
4. **Cross-reference real precedent, not re-derive from scratch.** Cite `DIR-002`/`M05-dir-projection`
   (the pattern source — file canonical, generated projection, anti-drift check, boundary-only drain
   hook) and exp4's `QX-*` labeling practice (`experiments/quay-continuous-bootstrap/`) as the two
   grounded precedents DIR-009 itself names; do not propose a mechanism that ignores what M05 already
   proved out.
5. **State the one-time backfill plan concretely** (DIR-009 item 6): what M01..M12's own backfill would
   look like (e.g. one `label: milestone-candidate` + `label: milestone:M-NN` task per closed backlog.md
   row, generated in one pass from `backlog.md`'s existing DONE rows) without rewriting git history —
   this is the part most likely to be under-specified if rushed, so it must get its own worked example
   using at least 2 real closed milestones (e.g. M09-gh-write, M12-abi-parent-write) as concrete inputs.

## Binary Done-when (§3.4 — mandatory, freezes this milestone's shape)
1. `[ ]` `docs/proposals/exp5-task-backlog-primitive-projection.md` exists and addresses all 13 of
   DIR-009's numbered items — pasted table-of-contents or section-by-section mapping showing which
   section answers which DIR-009 item number, so omissions are checkable, not asserted.
2. `[ ]` The doc contains a DIR-010 sub-section addressing all 4 of DIR-010's numbered items, with a
   single concrete recommended resolution stated for the experiment-namespace decision (item 1) — not
   left as an open menu of options.
3. `[ ]` The doc's canonical-direction decision (DIR-009 item 1's crux) is explicitly confirmed or
   revised from the human's own tentative recommendation in DIR-009 (option (b), quay task canonical
   for OUTER-loop tracking) — state agreement or a reasoned departure, not silence.
4. `[ ]` The doc includes a concrete, worked one-time-backfill example using at least 2 real closed
   `backlog.md` DONE rows as inputs (item 5 above), showing the actual proposed task fields (id, labels,
   body sections) those 2 rows would produce.
5. `[ ]` The doc includes a "Done-when clauses a future implementing milestone would need" section —
   itself a checklist, not prose — so the design is dispatch-ready when a later SELECT picks it up.
6. `[ ]` No product code, `OUTER-LOOP.md`, `inherited-core.md`, or `it0-dir-projection-check.*` file is
   modified by this milestone — confirm via `git diff --stat` against the pre-charter base commit,
   pasted, showing only the new doc file (plus this milestone's own `iterations/`/`charters/` bookkeeping
   files) touched.
7. `[ ]` `backlog.md`'s `M-TASK-BACKLOG-PROJECTION` row is updated at ABSORB to point at the finished
   doc and marked DONE (design delivered; still not yet charter-ready for implementation until a future
   SELECT explicitly picks it up per DIR-009's own deliverable note) — pasted diff.

Milestone is DONE when all seven are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
per §3.2 conditions 2–5 if they fire first. Sized as a single doc-authoring pass (no code, no live
external-system access) — smaller build cost than a code-touching milestone like M12, but real
independent-re-derivation material for iteration-1 (a design doc's completeness against 17 total
numbered source items, and its one concrete decision point, are genuinely independently checkable —
not empty verification).

## HARD GATES (Tier-A, cited BY REFERENCE — §3.1, DIR-009 defense; M06-sizing by-reference form)

Source: pinned HARD GATES block, `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines
100-131. Cited by hash instead of transcribed (literal text deliberately not duplicated here):

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

Verify: `experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference <this
file>` — PASS = hash still matches pinned source's current block (no drift); FAIL = re-derive
before dispatch.

**Charter thinness ≠ agent prompt thinness.** The dispatched `baime:iteration-executor` prompt
must still contain the LITERAL gate text in full (resolved from `GATE-HASH-REF` by the dispatcher
before constructing the prompt) — never only a hash, or this reintroduces DIR-009 dilution.

## Inner termination — five conditions (verbatim pointer, §3.2)
Applies unmodified: (1) Done-when complete & stable ≥1 iter · (2) ΔV<0.02 both layers K=2
consecutive & no new significant/blocking gap · (3) ceiling→redesign-OR-stop · (4) budget≈10
backstop, past→default HALT · (5) external HALT.

## it0 systematic-explore checks (§4.4 — run and record BEFORE first work)
a. **Ceiling/floor arithmetic** — N/A this milestone (zero VT points by design, stated above); confirm
   at it0 that no VT-chart claim is accidentally introduced by the design doc's own examples.
b. **Gate-hash/transclusion** — verified above via `--by-reference` mode; re-run before dispatch.
c. **Dogfooding evidence-gate** — every Done-when clause requires a pasted diff, section mapping, or
   worked example; no clause may be marked met on narrative alone.
d. **Domain-misfit audit-channel** — this milestone's domain (a design doc, no live external system, no
   product code touched) does not have a directly-applicable CI-job/audit-channel analogue the way
   GitHub-provider-write milestones do (M03/M09/M12's `provider-abi-conformance.test.mjs` reuse). This is
   expected and consistent with M-SIZING/M-VMETA-GATE's own prior doc-only precedent — record this
   explicitly rather than forcing a mismatched audit-channel citation.

## Adversarial-audit gate — NOT expected to trigger (state explicitly at ABSORB)
Per `inherited-core.md`'s Adversarial-audit cadence rule: condition (a) requires a capability-growth-
typed milestone with nonzero realized VT Δv appended at ABSORB — this milestone is typed discovery +
governance-integrity with Δv̂=0 by design (see Value hypothesis above), so condition (a) does not apply.
Condition (b) requires iteration-0 to recommend SKIPPING iteration-1 — this charter does not authorize
that (iteration-1 has real independent-re-derivation material per the sizing note above), so condition
(b) should also not fire absent an iteration-0 self-exemption. If iteration-0's own report nonetheless
recommends skipping iteration-1, the outer loop must NOT accept that at face value (per M-SIZING's own
precedent at m6, where the outer loop overrode an iteration-0 self-exemption and iteration-1 then found
a real defect) — dispatch iteration-1 regardless and record the override explicitly.

## Dispatcher
Run via `baime:iteration-executor`, one inner iteration at a time, non-blocking dispatch
(`run_in_background=true`), reading only this charter (Tier-A) + the pinned Tier-B pointer above +
the literal gate text resolved by the dispatcher. Record each iteration under
`experiments/quay-perpetual-stream/milestones/M13-task-backlog-projection/iterations/`. Worktree:
`experiments/quay-perpetual-stream/milestones/M13-task-backlog-projection/worktrees/iteration-N`, branch
`exp5-m13-iteration-N`.

**No live external-system access required** — unlike M03/M09/M11/M12, this milestone touches no
GitHub API, no live browser tooling; it is a pure documentation-authoring pass reading this repo's own
history (`backlog.md`, `dashboard.md`, `directives/archive/`, `inherited-core.md`, exp4's gap-list.md
for the `QX-*` precedent).
