---
id: exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD
title: "DIR-014 phase 1 (item 6): quay task is the canonical lifecycle record —
  `## Proposal` embedded, `## Plan` referenced-or-N/A, both mechanically
  enforced by a new DoD sibling clause to Clause 0"
status: done
labels:
  - milestone-candidate
  - surface:method-infra
  - milestone:M40-dir014-task-canonical-lifecycle-record
extra:
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD
    experiments/quay-perpetual-stream/charters/M40-dir014-task-canonical-lifecycle-record.md
    /tmp/m40-absorb-entry.md
---
## Proposal

DIR-014 was reverted to `pending` 2026-07-19 after a directive audit found its items 2/3
(DISPATCH wiring into `quay-task-to-plan`, de-optionalizing the two-class diversity policy for
dev-class milestones) still unbuilt despite the skill itself existing since M20/M22. The same day
the human scope-expanded DIR-014 with a new item 6: make the quay task the single canonical
lifecycle record for a piece of work, rather than a design doc + a separately-tracked, easily
bypassed plan. Concretely: the task's own `## Proposal` section should carry the chosen approach
inline (embedded, not a pointer to a doc that can drift out of sync with the task), while the
task's `## Plan` section should either reference a real `docs/plans/*.md` path (for genuinely
large/staged implementation work) or explicitly say `N/A — <reason>` for small mechanical changes
— never silently absent.

Today, 0 of the 24 `exp5-M-*` milestone tasks in this repo carry a `## Proposal` section at all;
the shape exists only in the QN/QC/QENG task families (see `QN-054.md` for the pattern this task
reuses). Nothing currently stops a milestone from landing with no proposal and no plan reference —
the gap DIR-014 item 6 targets is exactly this: DoD text alone ("should have a proposal") is prose,
not a gate that blocks `milestone_counter++`.

This milestone's single chosen approach (this IS a design-class/method-infra milestone, so per
item 6a's own text a single embedded proposal is correct — not an N-independent-proposal pipeline,
which is items 2/3's dev-class-only concern, explicitly deferred):

1. Add a new DoD sibling clause (call it Clause 8, next free slot after Clause 7) to BOTH
   `it0-dod-check.sh` (shell wrapper) and `it0-dod-check.mjs` (implementation), reusing the
   existing `extractSection`-style regex helper Clause 0 already uses to pull named `##` sections
   out of a task body. The clause reads the TARGET task's body (the task named by the script's
   first positional arg — this file itself, when self-referentially invoked), and:
   - FAILs if `## Proposal` is absent, or present but empty/placeholder (e.g. only whitespace or a
     single boilerplate line like "TBD").
   - FAILs if `## Plan` is absent entirely.
   - PASSes if `## Plan`'s body starts with `N/A` (case-insensitive) followed by a `—`/`-`/`:` and
     at least a few words of reasoning.
   - PASSes if `## Plan`'s body contains a `docs/plans/*.md`-shaped path AND that path resolves
     (file exists on disk relative to repo root).
   - FAILs if `## Plan` references a `docs/plans/*.md` path that does NOT resolve.
2. Add exactly 2 new fixtures under `fixtures/dod/` (mirroring the existing RED/GREEN naming
   convention for other clauses): one RED (missing/placeholder `## Proposal`, or a `## Plan`
   referencing a non-existent `docs/plans/*.md` path) and one GREEN (well-formed `## Proposal` +
   `## Plan: N/A — <reason>`). Wire both into `dod-fixture-selfcheck.sh` so the fixture suite
   exercises the new clause on every run, not just this milestone's.
3. Document the new clause in `inherited-core.md`, in a new subsection immediately following
   Clause 0's own documentation, cross-referencing `DIR-014` item 6 by name. Do not touch the
   two-class diversity policy's discretionary dev-class language — that remains items 2/3's scope.
4. This task itself is the dogfood proof: it carries this very `## Proposal` section (this text)
   and a `## Plan` section (below) stating `N/A` with reasoning, since this is a small mechanical
   change (one new DoD clause + 2 fixtures + one doc subsection), not a staged implementation
   requiring a `docs/plans/*.md` file.
5. At ABSORB, invoke the new clause against this task's own body (self-referentially, mirroring
   M38's own self-referential DoD-gate proof) and confirm PASS — proving the clause is live, not
   merely written.

Rejected alternative: writing a separate `docs/plans/M40-*.md` file and referencing it from
`## Plan`, purely to exercise the "resolves" branch of the new clause's logic. Rejected because it
would be a plan document manufactured only to satisfy a test, not because the work genuinely needs
staged planning — the `N/A` branch exists precisely for cases like this one, and the fixture pair
(item 2 above) is what exercises the "resolves"/"does not resolve" branches in isolation, not this
task's own real-world use of the clause.

## Plan

N/A — this is a small, single-pass mechanical change (one new DoD clause added to two existing
files, 2 new fixtures added to an existing fixtures directory and existing selfcheck script, one
new documentation subsection appended to an existing doc). It does not warrant a staged
`docs/plans/*.md` implementation plan; the `## Proposal` section above fully specifies the
approach, and the Acceptance Criteria below fully specify what "done" looks like.

## Acceptance Criteria
- [x] **item 6a (proposal embedded):** this task's own `## Proposal` section (above) is non-empty,
  real approach text, not a placeholder. (Confirmed by adversarial audit, 2026-07-19: read the
  `## Proposal` section directly — 4390 chars, names the exact clause number/placement, the exact
  helper reused, the exact PASS/FAIL rules, and a named rejected alternative with reasoning; `git
  diff 8c3c2bf..HEAD --stat -- tasks/` shows zero changes to this task file, confirming the Proposal
  predates this milestone's own build and was genuinely dogfooded, not written to order. See
  `experiments/quay-perpetual-stream/milestones/M40-dir014-task-canonical-lifecycle-record/audit.md`
  AC1.)
- [x] **item 6b (plan referenced):** this task's own `## Plan` section (above) states `N/A` with
  explicit reasoning (small mechanical change, no staged implementation). (Confirmed by adversarial
  audit, 2026-07-19: read the `## Plan` section directly — states `N/A — <reason>` with reasoning
  tied to the actual scope of the change, correctly characterizing it as small/mechanical, matching
  the real diff shape (812 insertions across 8 files, mostly fixtures/reports). See audit.md AC2.)
- [x] **item 6c (enforcement is real, not prose):** a new DoD sibling clause exists in BOTH
  `it0-dod-check.sh` and `it0-dod-check.mjs`, HARD-BLOCKING when a task's `## Proposal` is
  missing/placeholder, or `## Plan` is missing, or `## Plan` references a `docs/plans/*.md` path
  that does not resolve. 2 new RED/GREEN fixtures exist under `fixtures/dod/`, wired into
  `dod-fixture-selfcheck.sh`, and the full fixture suite (old + new) is green. (Confirmed by
  adversarial audit, 2026-07-19: independently re-ran `dod-fixture-selfcheck.sh` — 15/15 fixtures
  PASS; read both new fixture files directly and confirmed the RED/GREEN split is genuinely isolated
  to Proposal/Plan content (clause0-7 output byte-identical between RED and GREEN, only clause8
  differs, naming both violations in the RED case); read `it0-dod-check.sh` in full and confirmed
  it's a pure delegate for ALL 9 clauses (no clause-specific `.sh` logic exists for any clause, so
  Clause 8's absence from `.sh` logic is not an asymmetry); grepped `it0-dod-check.mjs` directly and
  confirmed `"task-canonical-lifecycle-record"` is in `MECHANICALLY_UNCONDITIONAL_CLAUSES` and
  `clauseNames`; independently constructed and confirmed a self-exemption attempt is caught by
  Clause 5. CONCERN (non-blocking): the forward-only cutover mechanism has a fail-open edge case for
  future tasks lacking a `milestone:M<N>` label — see audit.md CONCERNS #1 for full analysis and
  repro. See audit.md AC3.)
- [x] `inherited-core.md` gains a new subsection documenting the clause, cross-referencing DIR-014
  item 6, without altering the two-class diversity policy's dev-class discretionary language.
  (Confirmed by adversarial audit, 2026-07-19: read the new subsection directly — placed immediately
  after Clause 0's own documentation block, before Clause 1's; follows the same four-field template;
  cross-references "DIR-014 item 6" by name. `git diff 8c3c2bf..HEAD -- inherited-core.md | grep
  "^@@"` shows all 3 hunks confined to lines 851-991; the two-class diversity policy sections (lines
  232, 378, independently grepped) show zero overlap. See audit.md AC4.)
- [x] This milestone's own ABSORB DoD check (`quay gate exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD`,
  or `it0-dod-check.sh` if the clause is not engine-wired this phase — state which) genuinely
  evaluates the new clause against THIS task's own body and PASSes because the `## Proposal`/
  `## Plan` sections above are present and well-formed. (Confirmed by adversarial audit, 2026-07-19:
  independently ran `it0-dod-check.sh exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD
  charters/M40-dir014-task-canonical-lifecycle-record.md <own fresh absorb-entry file>` — Clause 8
  PASSes, citing the real 4390-char count (matching iteration-0's own transcript, confirming it's
  not fabricated) and `[tasks/exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD.md]` as its source,
  proving it read the real task file, not a fixture fallback. `it0-dod-check.sh` used (Clause 8 is
  not yet `quay gate`-engine-wired this phase, per iteration-0's own explicit statement, confirmed
  correct). See audit.md AC5.)

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present
[checklist-aware; this milestone also adds a new sibling check — verify it doesn't regress
existing Clause 0 semantics], 1 per-milestone acceptance audit [unconditional], 2 V_meta
consolidation-lag, 3 line-budget, 4 impl-row — N/A [this milestone's own output IS the mechanism],
5 no-self-exemption, 6 escrow-Δv — N/A [not design-only in the DIR-016 sense; ships real, tested
script/doc changes], 7 test-floor — N/A [`surface:method-infra`, no `packages/quay*` product files
touched; `dod-fixture-selfcheck.sh` is the test evidence for this change]). No task-specific
exemption from any clause.

## Value type / cadence
governance-integrity (primary — closes DIR-009's "task = canonical record" decision's remaining
AC/DoD-only gap) + capability-growth (secondary — a genuinely new, reusable, mechanically-enforced
task shape). Δv̂ small-to-moderate, no VT chart cell expected (mirrors the DoD-program lineage's
own no-VT-cell precedent — M25/M32/M36/M38/M39), re-confirm at ABSORB rather than assume.

## Status mirror
SELECTed @m40 DRAIN/SELECT boundary, 2026-07-19, from DIR-014 (phase 1, item 6 only, of its
2/3/5/6 item set) — reverted to `pending` and scope-expanded the same day (commits `3aa40bd`,
`5c7ac2f`).
