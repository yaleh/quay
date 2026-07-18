# Charter M10-audit-consolidation — Methodology-infra: dispose DIR-006/007/008, complete the kickoff-commit's "first consolidation target" trio (Tier-A)

**Milestone id:** M10-audit-consolidation · **surface:** none (methodology-infra, no VT weight — like
M02-gates/M-DIR-PROJECTION/M-SIZING/M07-vmeta-gate) · **type:** explore
**Source:** DIR-006 (`directives/pending/DIR-006-webui-browser-verification-regression.md`) + DIR-007
(`directives/pending/DIR-007-g3-adversarial-audit-role-dropped.md`) + DIR-008
(`directives/pending/DIR-008-sigma-inherited-floor-consolidation-and-citation-drift.md`).
**Charter authored:** m9→m10 boundary, 2026-07-18, chart-1.
**Pinned Tier-B pointer:** `experiments/quay-perpetual-stream/inherited-core.md` @ this repo's current
HEAD at charter-authoring time (re-read only if that file's SHA changes mid-milestone).

## Why bundled (recorded BEFORE dispatch)
All three directives are the SAME finding, discovered incrementally: `inherited-core.md`'s own
kickoff-commit (`8b994f8`) "Known weakness" line named exactly three φ edges as the "First
consolidation target" — "§0c visual-review; dispatch/G3 discipline; σ-floor handling." DIR-006 covers
the first (visual-review), DIR-007 the second (G3), DIR-008 the third (σ-floor) plus one related minor
citation-drift instance (manda reliability envelope). Disposing them separately would re-fragment a
single, already-named consolidation debt across three milestones for no benefit — bundling matches
DIR-004's own method-ROI framing better than three thin methodology-infra milestones in a row.

## Value hypothesis
- Value type (per `inherited-core.md`'s value-typed SELECT ledger): **governance-integrity** (primary
  — closes the exact debt the kickoff commit itself pre-named) + **risk/option** (secondary — DIR-006
  found a live claim-vs-evidence mismatch that iteration-1 re-verification did not catch; DIR-007
  found G3's adversarial-audit function has no mechanized equivalent anywhere in exp5).
- No VT Δv̂ — pure methodology-infra, same class as M02/M05/M06/M07. Ranking justification is the
  value-typed ledger, not VT (governance/infra hard floor: this candidate's scope must cover its own
  enforcement half, not just declaration — see Done-when 1/4/6 below, each pairs a decision with an
  operational artifact, not a citation).
- Metric `Y`: binary Done-when completion (below), each independently pasted-evidence checkable.

## In-scope work (verbatim requested actions from all three directives, organized as 8 Done-when items)

**DIR-006 (Web UI verification regression):**
1. Add a real, mechanically-checkable Web UI verification requirement to `inherited-core.md` (new
   section) + note it in the charter-authoring checklist (`OUTER-LOOP.md` step 3): any future
   milestone scoping Web UI work must paste an actual `mcp__playwright__*`/`mcp__chrome-devtools__*`
   tool-call trace (navigation + ≥1 screenshot or DOM snapshot, at both configured viewports) as
   literal Done-when evidence — `curl` remains valid for liveness/HARD-GATES only, never a substitute.
2. Flag M04-discover's existing Web UI cov numbers (dashboard.md VT table, 0.92/0.95) as
   **provisionally uncertain** pending real re-verification — add an explicit dashboard.md annotation,
   do NOT silently leave them looking authoritative. Do not attempt the actual re-verification itself
   this milestone (DIR-006 item 3 explicitly scopes that as separate follow-up work) — record it as a
   new backlog.md candidate instead (e.g. `M-WEBUI-REVERIFY`).
3. Perform the requested systematic audit of exp1-4 for OTHER silently-dropped-enforcement
   requirements (the same failure class, generalized). Record findings either as amendments to this
   charter's own resolution or as new directives — whichever is cleaner per-finding. Time-box this to
   what's discoverable via direct grep/read of exp1-4's charters/reports/DIRs against
   inherited-core.md's delta chain; this is not a full re-run of every historical milestone.

**DIR-007 (G3 adversarial-audit role):**
4. Add a genuinely distinct, adversarially-scoped audit role to `inherited-core.md` + `OUTER-LOOP.md`:
   a NEW out-of-band step the outer loop dispatches itself (NOT folded into iteration-1's
   build-and-reverify template), explicitly charged to try to REFUTE a milestone's Done-when claims
   and VT delta — cross-role adversarial audit, not same-template independent re-run. Name it
   concretely (e.g. `iteration-N-adversarial-audit.md`, dispatched via a fresh-context
   `baime:iteration-executor` call with a distinctly-worded refutation-focused prompt) so a future
   charter-author has worked steps, not an abstract citation.
5. Require this new role as a mechanized Done-when clause or HARD GATE on: (a) every VT-scoring
   (capability-growth-typed) milestone, and (b) any milestone whose own iteration-0 recommends
   skipping iteration-1 (the M06-sizing self-exemption precedent). Write this into `OUTER-LOOP.md`'s
   ABSORB/DISPATCH steps as an actual gate condition, mirroring M07-vmeta-gate's gate-writing pattern
   — not merely a new citation sentence.
6. Explicitly do NOT require it on every milestone (methodology-infra/governance milestones like this
   one are exempt by default) — record the cadence/scope judgment call and its rationale directly in
   `inherited-core.md`'s new section, so it's a checkable rule, not left to per-milestone improvisation.

**DIR-008 (σ-inherited-floor + citation drift):**
7. Record an explicit reset-vs-carry-forward decision for `VT₀` (and any other still-live inherited
   baseline found by a quick audit — chart-transition carry-forwards, any health-track starting value)
   in `inherited-core.md`, with rationale — not just a citation phrase. Consolidate the
   σ-inherited-floor trap itself into `inherited-core.md` as operational content (the concept, the
   concrete "reset vs. carry-forward" decision procedure, and the m4 case study where it already bit —
   Δv=−6.60 at m4, MD-001), completing the kickoff commit's third named consolidation target (alongside
   items 1 and 4 above).
8. Consolidate the manda-dispatch discipline into `inherited-core.md` at its CORRECT narrow scope —
   DIR-020's self-deadlock condition (never synchronously call manda `Agent`/`Dispatch`/`request` as
   the caller side of the session's own bound-broker channel) plus DIR-015/016/024's background-dispatch
   requirement for result-dependent/nested paths — explicitly stating fire-and-forget dispatch (e.g.
   Action Button's `manda-dispatch submit --async`) is UNAFFECTED and remains valid. Decide and record
   (briefly, this is DIR-008's own "minor, not blocking" item) whether a lightweight standing practice
   (grep the delta chain before drafting a new cross-cutting proposal/charter section) is warranted.

## Binary Done-when (§3.4 — mandatory, freezes this milestone's shape)
1. `[ ]` `inherited-core.md` gains an operational Web UI verification-requirement section (mechanized
   playwright/chrome-devtools evidence rule, not a citation) — pasted diff.
2. `[ ]` `dashboard.md` gains an explicit "provisionally uncertain" annotation on M04-discover's Web UI
   cov numbers, and `backlog.md` gains a new `M-WEBUI-REVERIFY`-shaped candidate row — pasted diff.
3. `[ ]` The exp1-4 systematic audit is performed and its findings recorded (as charter-resolution
   amendments or new directive files) — pasted summary of what was found, even if the finding is
   "nothing further beyond DIR-006/007/008 themselves."
4. `[ ]` `inherited-core.md` + `OUTER-LOOP.md` gain the new adversarial-audit-role step, concretely
   named and worked (not an abstract citation) — pasted diff.
5. `[ ]` `OUTER-LOOP.md` gains the mechanized gate requiring the adversarial-audit role on
   VT-scoring/self-exemption-attempting milestones, with the explicit non-blanket cadence rule — pasted
   diff.
6. `[ ]` `inherited-core.md` gains the VT₀ reset-vs-carry-forward decision (with rationale) AND the
   σ-inherited-floor trap consolidated as operational content (concept + decision procedure + m4 case
   study) — pasted diff. Any other uncritically-inherited baseline found by the required audit gets an
   explicit recorded disposition in the same section.
7. `[ ]` `inherited-core.md` gains the manda-dispatch discipline at its correct narrow scope (DIR-020 +
   DIR-015/016/024), explicitly noting fire-and-forget dispatch is unaffected — pasted diff.
8. `[ ]` No product code is touched by this milestone (pure methodology-infra); if any script IS
   touched, full existing test suite passes (pasted raw output). All three source directive files
   (`DIR-006`, `DIR-007`, `DIR-008`) get their `## Resolution` sections filled in, each citing the
   specific Done-when clause(s) and diff(s) that dispose them.

Milestone is DONE when all eight are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
per §3.2 conditions 2–5 if they fire first (ΔV plateau K=2, ceiling, budget≈10 past with nothing
climbing, external HALT). Given the number of items (8), this milestone is sized larger than the recent
norm (M06-sizing's own gauge) — justified because it disposes three directives already explicitly
scoped by the human to be handled together, all pure documentation/consolidation work (no live
external mutation, unlike M09), and each item maps to a directive's own already-itemized requested
action rather than newly-invented scope.

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
a. **Ceiling/floor arithmetic** — not applicable (no VT/ceiling for methodology-infra milestones); but
   re-verify at it0 that all three source directives are still `status: pending` (not already disposed
   by a concurrent process) before dispatch.
b. **Gate-hash/transclusion** — verified above via `--by-reference` mode; re-run before dispatch.
c. **Dogfooding evidence-gate** — every Done-when clause requires a pasted diff or pasted summary; no
   clause may be marked met on narrative alone.
d. **Domain-misfit audit-channel** — this milestone edits only markdown/methodology files, no code; the
   audit channel is iteration-1's own independent re-read of every claimed diff against the actual
   `git diff` output (not the iteration-0 prose) — same discipline already used for M02/M05/M06/M07's
   own methodology-infra milestones, now a 5th same-domain reuse (methodology-infra self-review via
   independent fresh-worktree diff re-read).

## Dispatcher
Run via `baime:iteration-executor`, one inner iteration at a time, non-blocking dispatch
(`run_in_background=true`), reading only this charter (Tier-A) + the pinned Tier-B pointer above +
the literal gate text resolved by the dispatcher. Record each iteration under
`experiments/quay-perpetual-stream/milestones/M10-audit-consolidation/iterations/`. Worktree:
`experiments/quay-perpetual-stream/milestones/M10-audit-consolidation/worktrees/iteration-N`, branch
`exp5-m10-iteration-N`.
