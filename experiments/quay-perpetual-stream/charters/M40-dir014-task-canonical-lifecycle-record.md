# Charter M40-dir014-task-canonical-lifecycle-record — DIR-014 phase 1:
# task carries `## Proposal` (embedded) + `## Plan` (referenced), new DoD sibling clause enforces it

**Milestone id:** M40-dir014-task-canonical-lifecycle-record · **surface:** method-infra (edits
`inherited-core.md`, `it0-dod-check.{sh,mjs}`, `fixtures/dod/*`, this milestone's own task — no
`packages/quay*` product files) · **type:** governance-integrity, capability-growth
**Source:** `DIR-014` (`experiments/quay-perpetual-stream/directives/pending/DIR-014-build-and-wire-the-proposal-to-plan-process-not-just-design-and-a-bypassable-gate.md`,
`tasks/DIR-014.md`) — reverted to `pending` 2026-07-19 (commit `3aa40bd`) after a human directive
audit found items 2/3 still unbuilt, then scope-expanded the same day (commit `5c7ac2f`) with a new
item 6: make the quay task the single canonical lifecycle record (proposal embedded, plan referenced).
**Charter authored:** m39→m40 boundary, 2026-07-19. Base commit: `exp5-outer-driver` HEAD `2e2da78`
(post-M39-ABSORB-publish-sync).

## SELECT reasoning
`directives/pending/` holds `DIR-014` (freshly reverted + scope-expanded by the human, same day),
`DIR-021` (delivered, stays pending per its own escrow discipline), `DIR-022` (phase 1 delivered,
4 gates remain), `DIR-023`, `DIR-024` (Layers 3-4, depend on DIR-022 finishing). `backlog.md` also
retains 6 open M37-produced candidates.

**Chosen: DIR-014, scoped to phase 1 (item 6 only — task = canonical lifecycle record).**
Reasoning, explicit not defaulted:
1. Per the standing DIR-over-backlog precedent, a pending directive outranks backlog candidates.
   Between DIR-014 and DIR-022 phase 2: DIR-014 is the FRESHER human directive (reverted +
   expanded same day, 2026-07-19, vs. DIR-022 which has sat pending since M37) and is explicitly
   named by the human's own note as "the single most important unclosed methodology-infrastructure
   gap in exp5's directive set as of 2026-07-19" — a stronger priority signal than DIR-022's own
   routine phase-2 continuation, which is not time-sensitive (its 4 remaining gates are unaffected
   by waiting one more milestone).
2. DIR-014's full scope (items 2/3/5/6 — DISPATCH wiring, policy de-optionalization, dogfood
   customers, AND the new task-canonical-record requirement) is too large for one milestone: its own
   Definition of Done requires ALL of (a) proposal+plan on a real task, (b) new DoD-clause
   enforcement with fixtures, (c) DISPATCH wiring, (d) an actual dogfooded pipeline run — items (c)
   and (d) presuppose a REAL development-class milestone big enough to need the full N-independent-
   proposal pipeline, which is a substantially larger and more judgment-risk-laden undertaking than
   the mechanical item-6 lifecycle-record change. Phasing mirrors the now-twice-established
   DIR-017/DIR-022 precedent (large multi-item directives with an explicit "artifacts
   necessary-not-sufficient" DoD tolerate phased/partial delivery).
3. **Phase 1 = item 6 only** (task carries `## Proposal` embedded + `## Plan` referenced,
   mechanically enforced by a new DoD sibling clause to Clause 0): this is the self-contained,
   scriptable, testable-in-isolation half of DIR-014 — it does NOT require first building/wiring the
   `quay-task-to-plan` skill's DISPATCH invocation (items 2/3), and can be dogfooded on ITSELF (this
   milestone is method-infra/design-class, so per item 6a's own text it embeds its own
   single-chosen-approach `## Proposal`, not an N-independent-proposal-pipeline one — the
   dev-class-only pipeline wiring is explicitly items 2/3, deferred).
4. Items 2 (DISPATCH wiring), 3 (de-optionalize for dev class), and 5 (first customers) are
   deferred to a later DIR-014 phase — they depend on item 6's enforcement mechanism existing first
   (a milestone can't be dogfooded "through the wired pipeline" before the task-record shape it
   writes into exists), and are individually large enough to warrant their own milestone(s).

## Acceptance Criteria
- [ ] **item 6a (proposal embedded):** this milestone's own task
  (`exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD`) carries a non-empty `## Proposal` body section
  with real approach text (this milestone's own single chosen approach — design-class, not an
  N-independent-proposal pipeline output, per item 6a's own text), not a placeholder.
- [ ] **item 6b (plan referenced):** the same task carries a `## Plan` section that either
  references an existing `docs/plans/*.md` path (file resolves) or states `N/A — <reason>`
  explicitly for a no-implementation/small-mechanical-change milestone (this milestone is
  small-mechanical — DoD-clause + fixture additions, no phased implementation plan needed — state
  `N/A` with that reasoning, do not omit the section).
- [ ] **item 6c (enforcement is real, not prose):** a new DoD sibling clause (to Clause 0) is added
  to `it0-dod-check.{sh,mjs}` that HARD-BLOCKS when a task's `## Proposal` is missing/placeholder,
  OR its `## Plan` section is missing, OR its `## Plan` references a `docs/plans/*.md` path that does
  not resolve. A new RED/GREEN fixture pair is added under `fixtures/dod/` and wired into
  `dod-fixture-selfcheck.sh`; the fixture suite stays green (all fixtures behave as asserted,
  including the 2 new ones).
- [ ] `inherited-core.md` gains a new subsection documenting this clause (mirroring Clause 0's own
  documentation shape) and cross-references `DIR-014` item 6, without touching the two-class
  diversity policy's discretionary language for the development class (items 2/3 — explicitly out
  of scope for this phase, see below).
- [ ] This milestone's own ABSORB is gated by the new clause (self-referential proof, mirroring
  M38's own self-referential DoD-gate pattern): `quay gate exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD`
  (or `it0-dod-check.sh` if the new clause is not yet engine-wired — state which) genuinely evaluates
  the new clause against this milestone's own task and PASSes only because the task's own
  `## Proposal`/`## Plan` sections are present and well-formed.

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present
[checklist-aware; **this milestone ALSO adds a new sibling check**, so verify the new check doesn't
regress the existing Clause 0 semantics], 1 per-milestone acceptance audit [unconditional], 2 V_meta
consolidation-lag, 3 line-budget, 4 impl-row — N/A [this milestone's own output IS the mechanism, not
a design doc], 5 no-self-exemption, 6 escrow-Δv — N/A [not design-only in the DIR-016 sense; ships
real, tested script/doc changes], 7 test-floor — N/A [`surface:method-infra`, no `packages/quay*`
product files touched; the new fixture pair is itself the test evidence for the new DoD-check logic,
covered by `dod-fixture-selfcheck.sh`, not the `node --test` coverage floor]). No task-specific
exemption from any clause.

## Value hypothesis
- Value type(s): **governance-integrity** (primary — closes DIR-009's "task = canonical record"
  decision's remaining AC/DoD-only gap) + **capability-growth** (secondary — a genuinely new,
  reusable, mechanically-enforced task shape).
- **Δv̂:** small-to-moderate, no VT chart cell expected (mirrors the DoD-program lineage's own
  no-VT-cell precedent — M25/M32/M36/M38/M39), re-confirm at ABSORB rather than assume.
- Metric `Y`: the task's 5 Acceptance Criteria, verbatim (see task file).

## Current-state notes (re-verified directly against source at charter-authoring time)
- `tasks/DIR-014.md` and `directives/pending/DIR-014-*.md` are the full source; item 6's runnable
  ACs (6a/6b/6c) and DoD are already fully specified there — this charter's ACs mirror them exactly,
  scoped to phase 1 (items 2/3/5 explicitly deferred).
- `0 of 24 exp5-M-*` tasks currently carry a `## Proposal` section or plan reference (per DIR-014's
  own 2026-07-19 verification) — QN/QC/QENG tasks (a different, non-exp5-milestone task family) DO
  already use a `## Proposal` body section; item 6a explicitly says "reuse that shape."
- `it0-dod-check.mjs`'s Clause 0 implementation (read at charter time) already parses the task's
  frontmatter/body for `## Acceptance Criteria` / `## Definition of Done` sections via regex-based
  section extraction — the new clause should reuse the same `extractSection`-style helper, not a
  parallel implementation.
- `fixtures/dod/` and `dod-fixture-selfcheck.sh` already exist with a RED/GREEN pattern per existing
  clause — reuse that pattern for the 2 new fixtures.

## In scope
1. Write this milestone's own task with a real `## Proposal` (single chosen approach) and `## Plan`
   (`N/A — <reason>`, small mechanical change) — the dogfood proof for the design-class case.
2. Add the new DoD sibling clause to `it0-dod-check.{sh,mjs}` (both the shell wrapper and the mjs
   implementation, mirroring how Clause 0 exists in both), enforcing item 6a/6b's presence/resolution
   rules.
3. Add 2 new fixtures (RED: missing/placeholder proposal or broken plan reference; GREEN: compliant)
   under `fixtures/dod/`, wired into `dod-fixture-selfcheck.sh`.
4. Document the new clause in `inherited-core.md` (new subsection, cross-referencing DIR-014 item 6).
5. Re-run this milestone's own ABSORB DoD check with the new clause active, against its own task,
   demonstrating the self-referential PASS.

## Explicitly OUT of scope
- Items 2 (DISPATCH wiring to invoke `quay-task-to-plan` for dev-class milestones), 3
  (de-optionalizing the two-class diversity policy), and 5 (first dogfood customers routed through
  the wired pipeline) — deferred to a later DIR-014 phase. DIR-014 itself stays `pending` after this
  milestone (its own DoD requires ALL of (a)-(d), and (c)/(d) are untouched by this phase).
- Retroactively backfilling `## Proposal`/`## Plan` onto the ≤M39 milestones' tasks — DIR-014's own
  text is explicit this is forward-only, same as DIR-020's AC/DoD rule.
- Building or modifying `.claude/skills/quay-task-to-plan/` itself (already built, M20/M22) — this
  phase only adds the task-record SHAPE + its enforcement, not the pipeline invocation.
- Changing the methodology/design class's whole-milestone re-derivation pattern (unaffected).

## Done-when (binary clauses)
Mirrors the task's 5 Acceptance Criteria exactly (task file to be authored as
`tasks/exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD.md`) plus:
1. This milestone's own task carries a real `## Proposal` + a `## Plan` (N/A with reasoning).
2. New DoD sibling clause exists in both `it0-dod-check.sh` and `it0-dod-check.mjs`.
3. 2 new fixtures committed, `dod-fixture-selfcheck.sh` stays green.
4. `inherited-core.md` documents the new clause.
5. This milestone's own ABSORB DoD check genuinely evaluates and PASSes the new clause against its
   own task (self-referential proof).

## HARD GATES (by-reference — see `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines
100-131 for the full literal text; both dispatched iteration prompts must include it verbatim):
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)
gate-hash-by-reference mode: `it0-gate-hash-check.sh --by-reference` against this charter file, run
immediately before dispatch and re-confirmed unchanged. The manda healthz gate and port-4173
reachability gate are N/A this milestone (no Web UI surface touched) — state N/A explicitly in each
iteration's report, do not silently omit.

## it0 checks (run at charter-authoring time, before dispatch)
- `it0-ceiling-line-budget-check.sh` against this charter: 5 in-scope items — small-to-moderate; run
  before dispatch.
- `it0-impl-row-check.sh`: N/A — this milestone's own output is the real-landing proof itself, not a
  design doc awaiting a future `-IMPL`.

## Per-milestone acceptance audit (UNCONDITIONAL, `inherited-core.md` Clause 1)
Dispatch a fresh-context, out-of-band adversarial-audit subagent at ABSORB, refute-first stance
against this task's 5 AC clauses + DoD, mirroring M38/M39's own audit discipline. The audit should
specifically probe: (a) is the new clause genuinely wired into BOTH `it0-dod-check.sh` and
`it0-dod-check.mjs` (not just one), (b) do the 2 new fixtures actually exercise the RED/GREEN
distinction (re-run `dod-fixture-selfcheck.sh` independently), (c) does this milestone's own task
genuinely carry a real `## Proposal` (not boilerplate) and a well-formed `## Plan` N/A statement,
(d) does the self-referential ABSORB-gate proof actually invoke the new clause (not silently skip
it because e.g. the task predates the clause's own file-format assumptions). Per DIR-020/M34's
standing write-back mechanism, the audit ticks `- [x]` on each AC/DoD checklist item it confirms,
with an inline evidence citation per item.

## Note for ABSORB
1. Confirm DIR-014 itself stays `pending` after this ABSORB (phase 1 only, items 2/3/5 remain) — do
   not mark DIR-014 done or archived.
2. Remember the Clause 2 exact-phrase requirement: dashboard text must contain the literal substring
   "V_meta consolidation-lag" (or "V_meta consolidation lag").
3. Remember the `it0-dod-check.sh` invocation convention: task id (not milestone id) as the first
   argument.
4. Per M38/M39's own precedent, this milestone's ABSORB should invoke `quay gate
   exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD` as its own DoD meta-enforcer check.
5. **Checkpoint cadence: DUE at this ABSORB.** `milestone_counter` becomes **40** at this ABSORB
   (m39 set it to 39) — last checkpoint written was cp-35 at m35; per the every-5-milestone cadence,
   THIS milestone's ABSORB MUST write `checkpoints/cp-40.md` (non-blocking, per the standing rule —
   does not gate `milestone_counter++`, but must not be silently skipped).

## Dispatcher notes
Dispatch two independent `baime:iteration-executor` agents off this charter's base commit
(`experiments/quay-perpetual-stream/milestones/M40-dir014-task-canonical-lifecycle-record/worktrees/iteration-{0,1}`,
branches `exp5-m40-iteration-{0,1}`). Iteration-1 must NOT read iteration-0's materials
(independent-verification discipline). Both iterations should independently attempt AC items 1-5
end-to-end (write this milestone's own task with real `## Proposal`/`## Plan` sections, implement and
test the new DoD clause in both script variants, add and wire the fixtures, document in
`inherited-core.md`, and demonstrate the self-referential ABSORB-gate PASS) — a report that only
designs the clause without running the fixture suite and observing real PASS/FAIL has not met the AC.
