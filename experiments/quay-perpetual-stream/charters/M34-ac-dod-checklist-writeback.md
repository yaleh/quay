# Charter M34-ac-dod-checklist-writeback — AC/DoD as GFM checklists, ticked ONLY by the
# per-milestone acceptance-audit write-back (DIR-020)

**Milestone id:** M34-ac-dod-checklist-writeback · **surface:** method-infra (`inherited-core.md`,
`scripts/it0-dod-check.mjs`, `OUTER-LOOP.md`) · **type:** explore, governance-integrity
**Source:** `tasks/exp5-M-AC-DOD-CHECKLIST-AUDIT-WRITEBACK.md` (SELECTed m34) —
`directives/pending/DIR-020-ac-dod-markdown-checklist-updated-by-audit-subagents.md`, authored by the
human directly in this live conversation. DIR-020's Finding: AC/DoD are prose lists today (no
per-item state visible in the task), and the acceptance audit's per-criterion verdict is recorded
only in the audit report/ABSORB log, never written back into the task itself.
**Charter authored:** m33→m34 boundary, 2026-07-19. Base commit: `exp5-outer-driver` HEAD `5da5c8a`
(post-m33-publish-and-sync, confirmed via `git rev-parse exp5-outer-driver`).

## Acceptance Criteria / Definition of Done
Authored into the task, not duplicated here — see
`tasks/exp5-M-AC-DOD-CHECKLIST-AUDIT-WRITEBACK.md`'s `## Acceptance Criteria` (5 checklist items —
itself authored in the NEW checklist form as the first live dogfood) and `## Definition of Done`
sections.

## Value hypothesis
- Value type(s): **governance-integrity (primary)** — per-criterion AC/DoD satisfaction becomes
  visible and write-tracked in the canonical task, not only in audit-report prose.
  **method-infra (secondary)**. No exploration/design-decision component of real weight — DIR-020's
  own "Requested action" section is prescriptive and detailed; this charter's job is faithful
  implementation, not open design.
- **Δv̂:** ≈0 (methodology refinement, no VT chart cell — mirrors M25/M30/M31/M32's own no-VT-cell
  precedent for this DoD-program lineage). Not escrowed (ships real code/doc changes directly, not
  design-only).
- Metric `Y`: the task's 5 Acceptance Criteria, verbatim (see task file) — Clause 0 text + mechanical
  check updated for checklist shape, `OUTER-LOOP.md` steps 1/6 updated, a live write-back
  demonstration, and a new HARD-block fixture for an unchecked-box-at-ABSORB case.

## Current-state notes (re-verified directly against source at charter-authoring time)
- `inherited-core.md` lines 877-904: the "AC/DoD live in the TASK" rule and Clause 0's four-field
  definition. Clause 0's "What it checks" (line 893-899) currently says AC needs "a bullet/numbered
  line with real content" — no checklist-specific language yet.
- `scripts/it0-dod-check.mjs` lines 132-170 (Clause 0 block): the `acClauses` filter regex
  (`/^\s*([-*]|\d+[.)])\s+\S/`, line 152) ALREADY structurally matches GFM checklist lines
  (`- [ ] text` — the `[-*]` alternative matches the leading `-`, then `\s+\S` is satisfied by
  ` [`) — so checklist-shaped AC does not currently FAIL clause 0's presence/shape check. **The real,
  missing mechanism is item 4 of DIR-020's requested action: nothing today distinguishes a checked
  `- [x]` from an unchecked `- [ ]` box, and nothing HARD-blocks on a box still unchecked at ABSORB.**
  This is new logic, not a shape-regex tweak — do not under-scope it as "just update the regex."
- `OUTER-LOOP.md` step 1 (SELECT, AC/DoD authoring sub-step — search for "AC/DoD" near step 1's text)
  and step 6 (ABSORB, "Per-milestone acceptance audit" sub-step, see `inherited-core.md` Clause 1
  lines 906-926 for the audit's current charge) are the two narrative spots needing the
  authored-unchecked / audit-ticks-boxes text, per DIR-020 items 2-3.
- `scripts/dod-fixture-selfcheck.sh` + `fixtures/dod/*.md`: 11 fixtures currently, all passing. A new
  fixture pinning "unchecked box at ABSORB HARD-blocks" is required (DIR-020's own "Human
  verification" item 3).

## In scope
1. Update `inherited-core.md`'s Clause 0 text (and the "AC/DoD live in the TASK" rule) to require
   checklist-form AC/DoD going forward, and to document the new unchecked-box-blocks semantics.
2. Extend `scripts/it0-dod-check.mjs` (Clause 0's block, or a clearly-named sub-check within it — the
   implementer's choice, but must be clearly attributable to Clause 0 in output/logging) to: (a)
   continue accepting prose-form AC/DoD unchanged (backward-compat, no retroactive rewrite of e.g.
   M32's task); (b) for checklist-form AC, detect any remaining `- [ ]` (unchecked) item and FAIL
   with a message naming the specific unchecked item(s), mirroring an unmet-criterion HARD-block.
3. Update `OUTER-LOOP.md` step 1's text: AC/DoD authored as UNCHECKED (`- [ ]`) checklists at SELECT.
4. Update `OUTER-LOOP.md` step 6 / `inherited-core.md` Clause 1's text: the acceptance-audit subagent,
   as it confirms each item, ticks `- [x]` via a `task_write`-equivalent update to the task file — the
   audit is the ONLY writer that ticks boxes, never at authoring time.
5. Add ≥1 new fixture under `fixtures/dod/` pinning the unchecked-box-HARD-blocks case, wired into
   `dod-fixture-selfcheck.sh`; full fixture suite must still exit 0.
6. **This milestone's OWN acceptance audit must live-demonstrate the write-back**: after the code
   change lands, the dispatched iteration (or, if the mechanism isn't wired into a live audit call
   within this milestone's own scope, a scripted/manual simulation using the new mechanical check
   directly against this milestone's own task file) must show at least one AC box flip from `- [ ]`
   to `- [x]` as a demonstrable artifact — this satisfies DIR-020's own "Human verification" item 2.
   Record exactly how this was demonstrated in the report (do not just assert it happened).

## Explicitly OUT of scope
- Retroactive rewrite of any pre-existing prose-form task (e.g. `tasks/exp5-M-DOD-ESCROW-TESTFLOOR.md`)
  into checklist form — DIR-020 explicitly says this is not required, "migrated opportunistically."
- Any change to Clauses 1-7's own trigger conditions or pass/fail semantics beyond the Clause-0/
  Clause-1-text updates named above — this milestone changes the REPRESENTATION of AC satisfaction,
  not the underlying gate semantics (DIR-020's own framing, item 4).
- V_meta consolidation-lag gate: N/A — `v-meta-ledger.md`'s one row is already `consolidated` (m7), no
  `confirmed`-and-unresolved rows exist (re-confirm at ABSORB, not assumed here).
- Design-only-milestone impl-row/escrow-Δv gates: N/A — ships real code/doc changes directly.
- Test-floor gate (Clause 7): N/A — `surface:method-infra` is exclusively non-product-touching (no
  `packages/quay` files touched by this milestone's scope; re-confirm via `git diff --stat` at ABSORB).

## Done-when (binary clauses)
Mirrors the task's 5 Acceptance Criteria exactly (see
`tasks/exp5-M-AC-DOD-CHECKLIST-AUDIT-WRITEBACK.md`) plus the standard cross-cutting hygiene clause:
1. `inherited-core.md` Clause 0 + the "AC/DoD live in the TASK" rule updated for checklist form.
2. `it0-dod-check.mjs` Clause 0 accepts checklist form AND HARD-blocks on any unchecked box, while
   remaining backward-compatible with prose-form tasks.
3. `OUTER-LOOP.md` step 1 text: AC/DoD authored unchecked at SELECT.
4. `OUTER-LOOP.md` step 6 / Clause 1 text: audit ticks boxes as it confirms items, sole writer.
5. New fixture(s) pin the unchecked-box-blocks case; full `dod-fixture-selfcheck.sh` suite exits 0.
6. `git diff --stat` confirms no `packages/quay` product files touched (method-infra only); no
   unrelated files touched.

## HARD GATES (by-reference — see `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines
100-131 for the full literal text; both dispatched iteration prompts must include it verbatim):
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)
gate-hash-by-reference mode: `it0-gate-hash-check.sh --by-reference` against this charter file, run
immediately before dispatch and re-confirmed unchanged (same discipline as M25-M33). The manda
healthz gate and port-4173 reachability gate are N/A this milestone (no Web UI surface touched) —
state N/A explicitly in each iteration's report, do not silently omit.

## it0 checks (run at charter-authoring time, before dispatch)
- `it0-ceiling-line-budget-check.sh` against this charter: 6 in-scope items — under the
  small-milestone threshold (8). PASS expected, re-confirm before dispatch.
- `it0-impl-row-check.sh exp5-M-AC-DOD-CHECKLIST-AUDIT-WRITEBACK backlog.md`: not design-only, gate
  does not apply — PASS expected (re-run after `backlog.md` regen picks up this task's new row).

## Per-milestone acceptance audit (UNCONDITIONAL, `inherited-core.md` Clause 1)
Runs regardless of VT cadence. Dispatch a fresh-context, out-of-band adversarial-audit subagent at
ABSORB, refute-first stance against this task's 5 AC clauses + DoD. Given this milestone directly
extends Clause 0/Clause 1's own mechanics, the audit must independently re-run
`dod-fixture-selfcheck.sh` against the merged state (not trust the implementation's self-report,
mirroring the discipline DIR-019/M32 established for self-referential DoD work) and independently
verify the "unchecked box HARD-blocks" fixture actually fails pre-fix-equivalent input and passes
compliant input. This is itself a self-referential milestone (it changes the very audit mechanism
that verifies it) — the audit must explicitly reason about whether that self-reference creates any
circularity risk, and state why the fresh-context/out-of-band/refute-first design already neutralizes
it (mirrors the discipline M25's own first self-check established).

## Note for ABSORB
1. Confirm the checklist-shape Clause 0 change is backward-compatible (M32's prose-form task still
   passes clause 0 unmodified) — cite the actual re-run, not an assertion.
2. Confirm the unchecked-box-blocks mechanism was demonstrated live against a real or synthetic case
   (per DIR-020's own "Human verification" items 2-3), not merely documented.
3. State whether `exp5-M-NATIVE-RELATION-SYNC` or a DIR-017-Step-3-sourced candidate (leakage metrics
   onto `dashboard.md`) should be the m35 SELECT pick — do not silently assume (checkpoint cp-31... no,
   next checkpoint is due at milestone_counter=35, i.e. AT this very ABSORB — do not miss it).
4. **Checkpoint cadence note:** `milestone_counter` will become 34 at THIS milestone's ABSORB
   (m33 already set it to 33) — the next checkpoint is due at `milestone_counter=35`, i.e. at the
   FOLLOWING milestone's ABSORB (m35), not this one. Do not miscount — re-verify the exact counter
   value against `dashboard.md`'s own last-recorded value before deciding whether a checkpoint is due.

## Dispatcher notes
Dispatch two independent `baime:iteration-executor` agents off this charter's base commit, same
worktree/branch-per-iteration pattern as M25-M33 (`experiments/quay-perpetual-stream/milestones/
M34-ac-dod-checklist-writeback/worktrees/iteration-{0,1}`, branches
`exp5-m34-iteration-{0,1}`). Iteration-1 must NOT read iteration-0's materials (independent-
verification discipline). This milestone is prose/mechanism-only (no live browser needed, no manda
dispatcher needed) — the HARD GATES' Web-UI-specific sub-gates are N/A, state so explicitly rather
than silently skipping. Both iterations must re-read `it0-dod-check.mjs`'s actual current Clause 0
code directly (not assume from this charter's summary) before modifying it, and must run
`dod-fixture-selfcheck.sh` themselves before reporting completion.
