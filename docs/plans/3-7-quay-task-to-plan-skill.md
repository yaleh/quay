# Plan: A quay-task-native `quay-task-to-plan` skill + the exp5 milestone-model changes it requires

- **Source proposal:** `docs/proposals/exp5-quay-task-proposal-plan-skill.md`
  (MATURED, dispatch-ready skill design, post-M17-merge status — see
  **Authoritative-artifact note** below). This plan decomposes the two
  deliverable strands the proposal describes (§8's flat list + Part II §§12-19
  the skill; §4/§5/§6/§7 the milestone-model changes) into dependency-ordered
  phases/stages. Scope is drawn **strictly** from the proposal — nothing here
  extends it.
  - **Authoritative-artifact note (added at M19-task-to-plan-docs-reconcile,
    per DIR-013 item 3):** the proposal's Part II (§§12-19) is the
    dispatch-ready OPERATIONAL SPEC an implementer needs (exact tool names, the
    `## Proposal` body shape, N-independent-proposal adjudication mechanics, the
    plan-check stop condition, and — above all — **§17's Done-when checklist**).
    This plan (`docs/plans/3-7-…`) is the BUILD-ROUTE ELABORATION: it decomposes
    §§12-19's spec into dependency-ordered phases/stages with line budgets. If
    this plan's phase/stage decomposition and the proposal's §17 checklist ever
    drift (e.g. after further edits to either document), **the proposal's §17
    checklist is the acceptance authority; this plan's phase/stage breakdown is
    advisory build-route elaboration and must be reconciled to match §17, not
    the other way around.** (DIR-013's own recommendation, adopted here — no
    concrete reason found during this reconciliation pass to prefer the
    opposite.) Every phase below MUST be read alongside proposal §§12-19, not
    only the pre-merge §8 flat list this plan was originally drafted against.

- **⚠ THIS IS A PLAN, NOT AN AUTHORIZATION TO EXECUTE.** Consistent with the sibling
  plan `docs/plans/2-exp5-driver-deliverability-packaging.md` and the proposal's
  §19 (bootstrap resolution, preserved from the original draft's §11 — see the
  Authoritative-artifact note above): exp5 (`experiments/quay-perpetual-stream/`)
  is a RUNNING perpetual loop.
  Strand 2's edits touch that live harness (`OUTER-LOOP.md`, `inherited-core.md`,
  `scripts/`) and MUST enter through `/quay-directive` at a milestone boundary
  (OUTER-LOOP §4.7, consumed at the next boundary, never mid-milestone), one phase
  at a time. The origin directive already exists and is applied: **`DIR-012`**
  (`experiments/quay-perpetual-stream/directives/archive/DIR-012-quay-task-native-proposal-plan-skill-and-milestone-model-for-development-work.md`),
  from which the design-doc milestone `M17-task-to-plan-skill-design` has already
  been chartered (`charters/M17-task-to-plan-skill-design.md`).
  This plan exists so that when a milestone SELECTs this work, the decomposition is
  already reviewable and small-stage.
  - **Stale-frontmatter note (harness bug, out of scope for this plan):** the
    DIR-012 file is physically in `directives/archive/` (consumed/applied) yet its
    own `- status: pending` frontmatter line was not flipped to `archived` when it
    moved. `it0-dir-projection-check.sh` would flag this as a STATUS-DISAGREEMENT.
    Fixing that frontmatter line is a harness housekeeping task, not part of this
    plan; it is recorded here only so a reader who greps the file's `status:` line
    is not misled into thinking DIR-012 is still pending.

- **Nature of this deliverable — read before applying any "coverage" target.**
  Strand 1 (the skill) is a `SKILL.md` + subagent prompt bodies (prose/config) with
  **no executable code of its own** except any small helper it needs to invoke the
  provider CLI/MCP. Strand 2 is Markdown/methodology edits **plus one new executable
  gate script** (the plan-time line-budget check). Therefore, exactly as plan 2
  established, the verification target is **split by asset type** (see "Test /
  verification strategy"): the literal **TDD ≥80% line coverage** number applies
  **only to executable code** (the new gate script, any JS/shell helper); for
  prose/skill/template/methodology assets, verification is defined as **mechanical
  checkable artifacts** (the gate script runs and FAILS on an over-budget fixture,
  PASSES on an under-budget one; existing `it0-*.sh` still pass; `grep`-checkable
  structural assertions). This is the proposal's own §15.2 code-vs-prose
  classifier, applied to the plan's own stages. Pretending 80% coverage applies to
  prose is the failure both plan 2 and proposal §15.2 explicitly warn against.

- **Grounded state (verified against the codebase 2026-07-18):**
  - `~/.claude/skills/proposal-to-plan/SKILL.md` exists — the 5-step
    proposal→architect-review→plan→architect-review→commit prior art the new skill
    is analogous to; it writes free markdown under `docs/`, not quay tasks.
  - The in-repo skill shape is `.claude/skills/<name>/SKILL.md` with YAML
    frontmatter (`name:`, `description:`, `allowed-tools:`) — verified against
    `.claude/skills/quay-directive/SKILL.md`, which is also the closest existing
    example of a skill that reads/writes quay tasks via the provider tool.
  - The provider WRITE surface the skill needs is **already landed** (DIR-011/M14,
    M12): the Core CLI write command is **`packages/quay/bin/quay.js task edit`** —
    there is **no** separate `task write` subcommand. QN-024 (iteration 10) made
    `task edit` a generic provider-agnostic `task_write`-passthrough (not a
    status-only edit), and M16-cli-edit-parity-impl then relaxed its guard from
    status-only to **full-field parity**, so `task edit` now carries the full flag
    surface `--title/--body/--body-file/--labels/--extra/--parent/--children/
    --expect-status/--append-notes` and requires at least one patch-producing flag
    (verified `packages/quay/bin/quay.js` lines ~401-468). The MCP `task_write`
    tool accepts `parent`/`children`/`body`/`extra` (verified
    `packages/quay/src/mcp-server.js` lines 303-347). The native provider's own
    CLI write command is also `packages/quay-native/bin/quay-native.js task edit`
    (verified line ~115). `task_get` returns `parent`/`children`/`body`/`extra`
    (mcp-server.js line ~279). **The skill consumes these WRITE paths; it does not
    build them** — so strand 1 is skill/prose authoring, not Core CLI code.
    **NOTE (grounding correction):** an earlier draft of this plan named a
    non-existent `task write` subcommand and a "status-only `task edit`" to avoid.
    Neither exists in the current code — `task edit` *is* the full-field write. All
    references below use `task edit`.
  - The gate-script style to mirror is
    `experiments/quay-perpetual-stream/scripts/it0-*.sh`: `#!/usr/bin/env bash`,
    `set -u`, a usage block, exit codes `0=PASS / 1=FAIL / 2=usage-error`, and an
    **optional pre-fetched-JSON/fixture arg** so the check can be run
    deterministically in a test without a live MCP round-trip (verified
    `it0-dir-projection-check.sh`, `it0-ceiling-check.sh`).
  - The milestone-sizing text strand 2 edits lives in `inherited-core.md`
    "## Milestone size definition + verify-iteration size gauge" (line ~137) and
    "## Value-typed SELECT ledger + governance/infra hard floor" (line ~209); the
    SELECT/grouping/size-gate wiring lives in `OUTER-LOOP.md` "Outer cycle" step 1
    (SELECT, ~line 46) and step 3 (AUTHOR CHARTER, ~line 65). These are the exact
    insertion points for the ≤2000-line ceiling, the nested ≤500/≤200 budgets, the
    plan-time budget GATE, and the two-class diversity policy.

- **Size budget:** each Stage ≤ ~200 lines of change; each Phase ≤ ~500 lines.
  "Lines" counts files-touched + approximate added/changed lines across Markdown,
  prompts, scripts, and manifests (same convention as plan 2 and `proposal-to-plan`).
  **This plan obeys the very ≤2000/≤500/≤200 convention it defines (Phase 3).**
  Per-strand totals (each strand is a separate milestone-worth of work, so the
  ≤2000 milestone ceiling applies per strand, not to the plan as a whole):
  **strand 2 = Phases 3+4+5 ≈ 220+410+360 = ~990 lines**;
  **strand 1 = Phases 6+7 ≈ 460+420 = ~880 lines**. Every phase is ≤500 and every
  stage ≤200; both strands are well under the ~2000 milestone ceiling.

---

## Phase overview and mandatory ordering

| Phase | Title | est. lines | Nature | depends-on |
|---|---|---|---|---|
| 3 | Define the milestone sizing convention (≤2000 nested ≤500/≤200) in the methodology core | ~320 | methodology / doc | — |
| 4 | Plan-time line-budget GATE script (executable, `it0-*`-style) | ~410 | shell + JS (code) + tests | 3 |
| 5 | Two-class diversity policy + two-ends-clamp pipeline, wired into OUTER-LOOP | ~380 | methodology / doc | 3 (concept), 4 (gate exists) |
| 6 | The `quay-task-to-plan` skill — proposal step (N-subagents + adjudication) | ~460 | skill / prose + provider I/O | — (skill independent of strand 2; see graph) |
| 7 | The `quay-task-to-plan` skill — plan step (grounded convergent check) + TDD ≥80% hard gate + dogfood wiring | ~470 | skill / prose + provider I/O | 6; consumes 3/4/5 conventions |

### Dependency ordering graph

```
        strand 2 (exp5 milestone-model)              strand 1 (the skill)
        ─────────────────────────────               ────────────────────
              Phase 3  (sizing convention)                 Phase 6  (proposal step)
                 │        │                                     │
                 ▼        ▼                                     ▼
       Phase 4          Phase 5                            Phase 7  (plan step + TDD gate)
    (budget GATE)   (diversity + clamp)                        │
         │               ▲                                     │
         └──────gate─────┘                                     │
                                                               │
   Phase 7 CONSUMES-BY-REFERENCE the sizing convention (Phase 3),
   the budget gate (Phase 4) as its per-stage line check, and the
   diversity/clamp policy (Phase 5) as the pipeline it enacts. ───┘
```

**Cross-strand dependency rule (proposal §4 "must ship together", §9):**
- **The skill (Phases 6–7) can be built first / in parallel with strand 2** — it is
  a standing artifact under `.claude/skills/` and does not perturb the live loop.
- **The model-changes gate (Phase 4) depends on the sizing convention (Phase 3)**
  being defined — the gate enforces a ceiling that must first exist as a written
  rule (else it is the DIR-002 "enforcement half never built" *or* the inverse
  "rule with no enforcement" anti-pattern; proposal §9 M06-sizing note).
- **Phase 5 depends conceptually on Phase 3** (the two-class policy is keyed on the
  value-typed ledger the sizing section formalizes) and **operationally on Phase 4**
  (the clamp pipeline's plan-check stage cites the budget gate).
- **Phase 7 references the Phase 3/4/5 conventions** but does not require them to be
  *merged into the live loop* first — the skill can reference the convention as
  authored in this plan even if the live-loop adoption (via `/quay-directive`) lands
  later. This is the "skill first, gate after the convention" ordering the proposal
  §4 requires without forcing a big-bang.

**Ordering within strand 2 is `3 → 4 → 5`** (mandatory). **Within strand 1,
`6 → 7`** (the plan step consumes the reconciled proposals the proposal step
produces). The two strands are otherwise independent and may be executed in either
interleaving.

---

## Phase 3 — Define the milestone sizing convention (≤2000, nested ≤500/≤200)

**Goal (proposal §4, §9 M06-sizing):** set the sizing decision M06-sizing (DIR-004)
left open — **a milestone is a whole plan, not a single phase** — by writing the
`milestone ≤ ~2000 / phase ≤ ~500 / stage ≤ ~200` convention into the methodology
core, plus the SELECT grouping criterion ("group tasks by value coherence, cap by
~2000-line cost — first bound to bind stops the group"). This is a **doc/methodology
phase**: it defines the rule the Phase-4 gate later enforces.

**Dependencies:** none (entry phase for strand 2). Stages sequential (3.2 edits the
section 3.1 amends; 3.3 wires SELECT to it).

### Stage 3.1 — Amend the milestone-size definition with the nested line budgets
- **Files:** edit `experiments/quay-perpetual-stream/inherited-core.md`
  ("## Milestone size definition + verify-iteration size gauge", ~line 137). (~90
  lines added.)
- **Work:** add the explicit `milestone ≤ ~2000 lines = one whole plan (multiple
  phases); phase ≤ ~500; stage ≤ ~200` budget block (proposal §4 code fence
  verbatim in intent), stating it answers M06-sizing's open question and that the
  expansion is **only safe because of the plan decomposition** (proposal §4: the
  13/13 inner-convergence record held only because milestones were small; 2000
  lines without phase/stage structure would force mid-milestone re-scope). Preserve
  the existing UNDER/OVER/correctly-sized gauge — the new budget is additive, not a
  replacement. State how "lines" are counted (files-touched + added/changed, per
  `proposal-to-plan`; proposal §10 open item) as the counting rule the Phase-4 gate
  will implement.
- **Acceptance:** the `≤2000 / ≤500 / ≤200` block is present with the three nested
  levels named; it explicitly references M06-sizing/DIR-004 as the question it
  closes; the "safe only because of plan decomposition + must ship with the skill"
  rationale (proposal §4) is stated; `grep -E '2000|500|200'` finds the three
  budgets in one block; the existing size gauge text is retained (not deleted).

### Stage 3.2 — Record the empirical basis for the ≤500/≤200 nesting
- **Files:** edit the same `inherited-core.md` section (~60 lines added). (~60 lines.)
- **Work:** capture proposal §4/§12's rationale that the nested budgets are sized to
  the unit at which the grounded plan-check and per-stage TDD gate can actually catch
  errors (reviewers degrade on 1000+-line diffs; ~200-line single-scope changes get
  useful defect-catching feedback; "too large" is a top-three agentic-PR rejection
  reason). Keep it as a short cited rationale note, not a re-derivation of §12.
- **Acceptance:** the rationale paragraph is present and attributes the budgets to
  the review-effectiveness window (not "arbitrary"); it cross-references proposal
  §4/§12; no numeric budget is introduced that contradicts Stage 3.1.

### Stage 3.3 — Wire the two-sided SELECT grouping criterion into OUTER-LOOP
- **Files:** edit `experiments/quay-perpetual-stream/OUTER-LOOP.md` (Outer cycle
  step 1 SELECT, ~line 46; and step 3 AUTHOR CHARTER's size pointer, ~line 65).
  (~70 lines.)
- **Work:** extend SELECT's DIR-009 grouping rule with the concrete two-sided
  criterion (proposal §4): **group tasks by value coherence, cap by ~2000-line
  cost; the first bound to bind stops the group.** Point the "Size the candidate
  BEFORE dispatch" step at the new `inherited-core.md` budget block and forward-
  reference the Phase-4 plan-time budget gate as the mechanical enforcement (so the
  rule and its enforcer are cross-linked, not orphaned).
- **Acceptance:** SELECT step 1 states the value-coherence + ≤2000-cost two-sided
  rule and the "first bound to bind" stop; the AUTHOR-CHARTER size step references
  the `inherited-core.md` budget block; a forward pointer to the Phase-4 gate
  script exists (no dangling "enforcement TBD" without a named target).

**Phase 3 acceptance (all must hold):**
1. `inherited-core.md` carries the `≤2000 / ≤500 / ≤200` nested budget as an
   explicit block, closing M06-sizing's open question, with the "safe only via plan
   decomposition, ships with the skill" rationale.
2. The empirical basis for the nesting is recorded and cited (proposal §4/§12).
3. OUTER-LOOP SELECT carries the two-sided value-coherence + ≤2000-cost grouping
   criterion and cross-links the (Phase-4) enforcing gate.
4. The line-counting convention is stated (basis for Phase 4).
5. Existing size gauge / SELECT text preserved; existing `it0-*.sh` still pass
   (`experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh` unchanged
   pin). Total change ≤ ~500 lines.

---

## Phase 4 — Plan-time line-budget GATE (executable check)

**Goal (proposal §9 M06-sizing "A plan-time line-budget gate is required — else it
is the DIR-002 enforcement-half-never-built pattern again"):** implement an
executable check, mirroring the `it0-*.sh` style, that reads a plan document's
per-stage / per-phase / per-milestone line estimates and FAILS if any exceeds the
Phase-3 budget. This is the **one genuinely executable deliverable of strand 2** —
TDD ≥80% applies here.

**Dependencies:** requires Phase 3 (the gate enforces the budget Phase 3 defines and
uses the line-counting convention Phase 3 states). Stages sequential: 4.1 writes the
failing tests + fixtures, 4.2 implements to green, 4.3 wires it into the loop.

### Stage 4.1 — TDD: budget-gate tests + over/under-budget fixtures (RED)
- **Files:** new `experiments/quay-perpetual-stream/scripts/test/it0-plan-budget-check.test.mjs`
  (node `--test`, ~110 lines) plus fixtures: an **over-budget** plan fixture
  (a stage > 200 or a phase > 500 or a milestone total > 2000) and an
  **under-budget** plan fixture, under
  `experiments/quay-perpetual-stream/scripts/test/fixtures/`. (~150 lines total.)
- **Work:** write the tests first (they fail because the script does not exist yet).
  Assert: (a) under-budget fixture → exit 0 / PASS; (b) over-budget fixture → exit 1
  / FAIL naming the offending stage/phase; (c) malformed input → exit 2. Model the
  fixture format on the per-stage `~line` estimates this very plan uses (a plan
  doc with `Stage N.M ... (~NNN lines)` markers), so the parser target is concrete.
- **Acceptance:** the test file exists and, run before Stage 4.2, **fails**
  (script/module absent) — the RED state is demonstrated and recorded; fixtures
  encode at least one over-budget and one under-budget plan.

### Stage 4.2 — Implement `it0-plan-budget-check.sh` (+ `.mjs` parser) to GREEN
- **Files:** new `experiments/quay-perpetual-stream/scripts/it0-plan-budget-check.sh`
  (~110 lines, bash wrapper mirroring `it0-dir-projection-check.sh`: `set -u`, usage
  block, exit `0/1/2`, optional pre-parsed-JSON/plan-file arg for deterministic
  testing) and its `it0-plan-budget-check.mjs` helper (~80 lines, does the
  parse+compare so no `jq` dependency, same node-delegation pattern as the existing
  dir-projection check). (~190 lines total.)
- **Work:** parse a plan doc's stage/phase/milestone line estimates; compare against
  the Phase-3 budgets (≤200 stage / ≤500 phase / ≤2000 milestone); FAIL listing
  each violation. Take the budgets as defaults but allow `--file`-style override for
  testability, consistent with `it0-ceiling-check.sh`'s `--file` convention.
- **Acceptance:** all Stage-4.1 tests pass (GREEN); the script FAILS (exit 1) on the
  over-budget fixture naming the offender and PASSES (exit 0) on the under-budget
  fixture; malformed input exits 2; **≥80% line coverage** on the `.sh`+`.mjs`
  (measured, since these are code); style matches the existing `it0-*` scripts
  (`set -u`, usage, exit codes, fixture arg).

### Stage 4.3 — Wire the budget gate into charter-authoring + gate-hash pin
- **Files:** edit `experiments/quay-perpetual-stream/OUTER-LOOP.md` (AUTHOR CHARTER
  step, ~line 65, alongside the existing `it0-gate-hash-check.sh` reference) and
  `experiments/quay-perpetual-stream/inherited-core.md` "Systematic-explore it0
  checks" list (~line 44). (~70 lines.)
- **Work:** register `it0-plan-budget-check.sh` as a plan-time gate the charter/plan
  author must run before dispatch for a **development-class** milestone (methodology
  milestones that carry no plan doc are exempt — proposal §5). Note it is a *plan-
  time* check (fires on the plan doc), distinct from the existing charter-time it0
  checks.
- **Acceptance:** OUTER-LOOP names the budget gate as a plan-time gate for dev-class
  milestones with the exemption for plan-less methodology milestones; the it0-checks
  list in `inherited-core.md` includes it; `it0-gate-hash-check.sh` still passes
  (the pinned HARD-GATES source is unchanged).

**Phase 4 acceptance (all must hold):**
1. `it0-plan-budget-check.{sh,mjs}` exists, style-matches the existing `it0-*`
   scripts, and is TDD'd with ≥80% coverage.
2. It **FAILS on an over-budget fixture** (naming the offending stage/phase/
   milestone) and **PASSES on an under-budget fixture** — the concrete checkable
   artifact this doc/methodology-adjacent gate is defined by.
3. Malformed input exits 2; the check supports a deterministic fixture/`--file`
   input for testing.
4. The gate is wired into charter/plan authoring as a plan-time, dev-class gate
   with the methodology-milestone exemption stated.
5. Total change ≤ ~500 lines.

---

## Phase 5 — Two-class diversity policy + two-ends-clamp pipeline (methodology)

**Goal (proposal §5, §6, §7):** write into the methodology core the two-class
diversity policy (keyed on the value-typed ledger) and the two-ends-clamp pipeline —
so the OUTER loop knows, per milestone class, *where* to spend the diversity budget
and *what pipeline shape* a development milestone runs. Doc/methodology phase.

**Dependencies:** conceptually depends on Phase 3 (keyed on the sizing convention +
value-typed ledger the size section formalizes) and operationally on Phase 4 (the
clamp's plan-check stage cites the budget gate). Stages sequential.

### Stage 5.1 — Author the two-class diversity policy, keyed on the value-typed ledger
- **Files:** edit `experiments/quay-perpetual-stream/inherited-core.md`, in/after
  the "Value-typed SELECT ledger" section (~line 209). (~110 lines.)
- **Work:** record proposal §5's table: **methodology/design class** (value-type
  discovery/governance-integrity) → **whole-milestone independent re-derivation**
  (kept as-is, cheap because the deliverable is a doc); **development/test class**
  (value-type capability-growth, ≤2000 lines of code) → **independent re-derivation
  of the proposal only** (approach is the expensive error), implement once, verify
  at the tail. State the key insight (re-deriving 2000 lines is waste; re-deriving
  the approach is not) and cite M13's design-level divergence as the existence proof
  (proposal §5). Explicitly key the class selection on the value-typed ledger entry
  the milestone already carries.
- **Acceptance:** both classes are defined with their value-type key, their
  diversity locus, and their deliverable; the "review proportional to risk / axis =
  where the expensive error lives" framing (proposal §5) is present; the M13
  existence proof is cited; class selection is stated to key on the value-typed
  ledger (not a new orthogonal field).

### Stage 5.2 — Author the two-ends-clamp pipeline for development milestones
- **Files:** edit `experiments/quay-perpetual-stream/inherited-core.md` (new
  subsection, ~110 lines) and add the dispatch shape into
  `experiments/quay-perpetual-stream/OUTER-LOOP.md` DISPATCH INNER / ABSORB steps
  (~line 105 / ~line 121, ~50 lines). (~160 lines total.)
- **Work:** encode proposal §6's pipeline for a dev milestone: **[UPSTREAM
  INDEPENDENCE]** N-independent-subagent proposal re-derivation + adjudication
  (M13-style) → milestone (≤2000, grouped by value coherence) → plan (independent
  subagent) → **PLAN CHECK** (one heavily codebase-grounded subagent, iterated to
  convergence, a CHECK not a re-derivation, §7) → **single implementation TDD ≥80%
  per stage** → **light tail self-check** (no separate independent verifier — because
  independence is already provided at both ends) → ABSORB → **[DOWNSTREAM
  INDEPENDENCE]** the existing out-of-band adversarial-audit gate
  (DIR-007/M10, fires on capability-growth + Δv≠0 — unchanged, not merged into the
  tail). Record the per-role grounding differentiation (proposal §6): proposal
  subagents blank-slate-leaning (independent, no inter-agent communication, so
  divergence is a real signal; persona differentiation OK); plan-check subagent
  maximally codebase-grounded. Set `N=2` default (proposal §10, matching prior art +
  M13), raised only for genuinely high-stakes approach decisions.
- **Acceptance:** the clamp pipeline is documented end-to-end with independence at
  **both ends** and single implementation in the middle; the tail is a **light
  self-check**, not a spawned independent verifier; the adversarial-audit gate is
  referenced as the reused downstream end (kept distinct, not merged); role-specific
  grounding (blank-slate proposal vs. grounded plan-check) is stated; `N=2` default
  is recorded; OUTER-LOOP DISPATCH/ABSORB reference this pipeline for dev-class.

### Stage 5.3 — Author the plan-check stopping rule (check-not-re-derive) + decline plan re-derivation
- **Files:** edit `experiments/quay-perpetual-stream/inherited-core.md` (~90 lines).
- **Work:** record proposal §7: plan-class errors (signatures, call-sites, stage
  ordering, sizing, TDD semantics) are **verifiable against ground truth**, so at
  the plan stage **check > re-derive** (two plans could both misread the same code
  the same way; a grounded single check catches them). State the stopping rule
  borrowed from BAIME's convergence discipline: **iterate the plan check until a
  round produces no material change (convergence), cap ~2–3 rounds** — reusing
  exp5's ΔV-small-and-stable stop condition, not a new one. Record that optional
  plan **re-derivation is declined by default** for the dev class (available ad hoc
  only if a decomposition is genuinely contested). Cross-reference the Phase-4
  budget gate as one of the ground-truth checks the plan-check applies.
- **Acceptance:** the check-not-re-derive rationale is stated with the "both misread
  the same code" failure mode (proposal §7); the ~2–3-round convergence stop rule is
  recorded and tied to exp5's existing ΔV stop condition; plan re-derivation is
  explicitly declined-by-default with the ad-hoc escape; the budget gate is
  referenced as a ground-truth check.

**Phase 5 acceptance (all must hold):**
1. The two-class diversity policy is in the core, keyed on the value-typed ledger,
   with both classes' diversity locus defined and the M13 existence proof cited.
2. The two-ends-clamp pipeline is documented (independence both ends, single
   implementation, light tail self-check, reused adversarial-audit downstream) with
   per-role grounding and `N=2` default; OUTER-LOOP references it for dev-class.
3. The plan-check stopping rule (check-not-re-derive, ~2–3-round convergence) is
   recorded and reuses exp5's ΔV stop condition; plan re-derivation declined by
   default.
4. Existing `it0-*.sh` still pass; the adversarial-audit gate (DIR-007/M10) text is
   referenced but not modified/merged. Total change ≤ ~500 lines.

---

## Phase 6 — `quay-task-to-plan` skill: proposal step (N-subagents + adjudication)

**Goal (proposal §12 read/write behavior, §13 N-independent-proposal step, §16
GitHub degradation, §8's point 6 feature-developer reuse):** create the new skill's scaffold and its
**proposal step** — the half that reads a milestone's grouped tasks from the
provider, runs N independent subagents to author proposals + adjudicates, and writes
each reconciled proposal back to its task `body` (portable, DIR-011). This phase is
**skill/prose authoring** (a `SKILL.md` + subagent prompt bodies) plus provider I/O
that *consumes* the already-landed WRITE surface — no Core CLI code is written.

**Dependencies:** none against strand 2 for construction (the skill is a standing
artifact and can be built first, proposal §4/§9). Stages sequential (6.2 needs the
frontmatter+I/O contract of 6.1; 6.3 needs the proposal subagents of 6.2 to adjudicate).

### Stage 6.1 — Skill scaffold: frontmatter, I/O contract, provider read/write path
- **Files:** new `.claude/skills/quay-task-to-plan/SKILL.md` (frontmatter +
  overview + "Steps" skeleton, ~130 lines), modeled on
  `.claude/skills/quay-directive/SKILL.md`'s shape (YAML `name`/`description`/
  `allowed-tools: Bash, Read, Write`) and `~/.claude/skills/proposal-to-plan/
  SKILL.md`'s 5-step isolated-agent structure. (~130 lines.)
- **Work:** define the skill's contract: input = a milestone's grouped task set;
  the provider read is `task_get` / `task_list` (MCP tool preferred in-session,
  else `packages/quay/bin/quay.js task list/get --json`); the write is
  `task_write` (MCP) / `packages/quay/bin/quay.js task edit --body/--extra/...`
  (or the native `packages/quay-native/bin/quay-native.js task edit`) — the
  full-field `task edit` write path (QN-024 + M16 parity), never a status-only
  patch (per the quay-directive precedent). Encode
  the portability rule (DIR-011): proposal → task `body` (portable across
  providers); `extra{}` only as a native-only mirror; **degrade correctly on GitHub**
  (no `extra`; parent/children via checkbox body per M12). State the M12 milestone→
  task grouping is built via parent/children WRITE.
- **Acceptance:** `SKILL.md` exists with valid frontmatter matching the in-repo
  shape; the provider read/write paths are named with the correct tool/CLI (MCP
  `task_write`/`task_get` preferred, `packages/quay/bin/quay.js task edit`
  (full-field) / native CLI as fallback); the write path uses the full-field
  `task edit` surface (`--body/--extra/--parent/--children`), **not** a status-only
  patch; the
  body-portable / extra-native-only / GitHub-degradation rule (DIR-011) is stated;
  the M12 parent/children grouping WRITE is referenced.

### Stage 6.2 — Proposal step: N independent subagent prompts (blank-slate-leaning)
- **Files:** edit `.claude/skills/quay-task-to-plan/SKILL.md` to add the proposal
  step, and add `N` subagent prompt bodies under
  `.claude/skills/quay-task-to-plan/prompts/proposal-subagent.md` (a single
  parametrized prompt template, default `N=2`, with persona differentiation notes).
  (~170 lines total.)
- **Work:** encode the proposal step as **N independent Task-agent runs**
  (proposal §13, §6): blank-slate-leaning (minimize shared context; no
  inter-agent communication so divergence is a real signal; persona differentiation
  as a cheap diversity widener), each authoring a proposal for the task(s).
  Default `N=2` (proposal §10). Keep `proposal-to-plan`'s architect-review as an
  **additional** adversarial pass, not a replacement.
- **Acceptance:** the proposal step spawns N isolated agents (default 2) with the
  no-inter-agent-communication / blank-slate discipline stated; the prompt template
  exists and is parametrized by N + persona; architect-review is retained as an
  additional pass; the step is documented as writing nothing to the task until
  adjudication (Stage 6.3).

### Stage 6.3 — Adjudication + write-back to task body (portable, regenerated)
- **Files:** edit `.claude/skills/quay-task-to-plan/SKILL.md` (adjudication +
  write-back step) and add
  `.claude/skills/quay-task-to-plan/prompts/adjudicate-proposal.md`. (~160 lines.)
- **Work:** encode the M13-style adjudication (reconcile the N proposals; on
  design-level divergence, adjudicate — proposal §5) and the write-back: the
  reconciled proposal is written to the task `body` via `task_write`, with a
  **regeneration discipline** (proposal §3: task granularity is variable per
  DIR-009, so a task's proposal is not write-once — it must be regeneratable like
  the M05 projection when a task is re-grouped). Read back with `task_get` as
  evidence (same discipline as quay-directive step 5d).
- **Acceptance:** the adjudication step reconciles N proposals and handles design-
  level divergence explicitly; write-back targets task `body` (portable) with
  `extra` only as native mirror; the regeneration-not-write-once discipline is
  stated (proposal §3); a `task_get` readback evidence step is present.

**Phase 6 acceptance (all must hold):**
1. `.claude/skills/quay-task-to-plan/SKILL.md` exists with correct frontmatter and
   a provider read/write contract using the right tools/CLI (the full-field
   `task edit` write path / MCP `task_write`, not a status-only patch).
2. The proposal step runs N independent blank-slate-leaning subagents (default 2,
   no inter-agent communication) + retains architect-review; the prompt template
   exists.
3. Adjudication reconciles the N proposals (M13-style divergence handling) and
   writes the reconciled proposal to task `body` portably (extra = native mirror),
   with the regeneration discipline and a `task_get` readback.
4. Verification is by the prose-asset mechanical checks (see strategy): frontmatter
   valid, `grep`-checkable that the write path names the full-field `task edit` /
   MCP `task_write` (and that no non-existent `task write` subcommand is invoked),
   all referenced provider commands/tools resolve. Total change ≤ ~500 lines.

---

## Phase 7 — `quay-task-to-plan` skill: plan step (grounded check) + TDD ≥80% hard gate + dogfood wiring

**Goal (proposal §14 plan step, §15 TDD ≥80% hard gate, §8's point 6
feature-developer reuse, §19 bootstrap resolution):** complete the skill with the **plan step**
(author + grounded convergent check producing a milestone-level plan record kept
**out of the task tree**), the **TDD ≥80% hard gate** with the code-vs-prose
classifier, and the dogfooding wiring per §19 (the bootstrap-resolution paragraph
preserved from the original draft's §11).

**Dependencies:** requires Phase 6 (the plan step consumes the reconciled proposals
the proposal step produces). References the Phase 3/4/5 conventions (budget, clamp,
stopping rule) but does not require their live-loop adoption first. Stages sequential.

### Stage 7.1 — Plan step: author + grounded convergent check (milestone-level, out of task tree)
- **Files:** edit `.claude/skills/quay-task-to-plan/SKILL.md` (plan step) and add
  `.claude/skills/quay-task-to-plan/prompts/plan-check-subagent.md`. (~170 lines.)
- **Work:** encode the plan step (proposal §14, §7): one subagent authors a
  milestone-level plan record (phases/stages, dependency order, per-stage line
  budgets, per-stage TDD ≥80% acceptance — the exact shape of *this* document); then
  one **maximally codebase-grounded** check subagent iterates to convergence
  (~2–3 rounds, Phase-5 stopping rule), reading real signatures/call-sites to catch
  the mechanical errors proposal §2 documents. State the plan is **milestone-level
  and NOT written as a child-task tree** (proposal §3: the board tracks value; the
  plan tracks process; **process is deliberately invisible in the Web UI/task
  board** — must be stated so no one later expects stage progress to render there).
  The plan-check applies the Phase-4 budget gate as one of its ground-truth checks.
- **Acceptance:** the plan step produces a milestone-level plan record with
  phases/stages/dependency-order/per-stage budgets/per-stage TDD acceptance; the
  grounded check iterates to convergence per the Phase-5 stopping rule; the "plan is
  NOT a child-task tree / process invisible in the Web UI" consequence (proposal §3)
  is stated explicitly; the check is documented as consuming the Phase-4 budget
  gate.

### Stage 7.2 — TDD ≥80% hard gate with the code-vs-prose classifier
- **Files:** edit `.claude/skills/quay-task-to-plan/SKILL.md` (hard-gate section)
  and its `Constraints` block. (~140 lines.)
- **Work:** encode proposal §15.1/§15.2: **TDD ≥80% per stage is a HARD GATE**, stricter
  than exp5's current "paste test output" evidence gate — because single-
  implementation makes it the primary correctness net (§6). Add the per-stage
  **classifier**: "is this stage code or prose?" — literal ≥80% line coverage applies
  **only to executable code (JS/shell/etc.)**; for prose/skill/template/manifest
  stages the gate **degrades to the mechanical-check discipline plan 2 established**
  (gate-hash / projection-check `it0-*` runs, scaffold-lint, isolation test), not a
  coverage percentage. State that the skill's own implementation is largely prose,
  so this classifier applies to the skill itself. Encode the constraint block in the
  `∧`-form the existing skills use.
- **Acceptance:** the ≥80% hard gate is stated as stricter-than-current with the
  single-implementation rationale; the code-vs-prose classifier is present with both
  branches (coverage % for code; mechanical checks for prose, citing plan 2's
  discipline); the constraint block forbids skipping the gate; `grep`-checkable that
  both the "80%" and the "mechanical-check for prose" branches appear.

### Stage 7.3 — Dogfooding wiring, bootstrap resolution, and `feature-developer` reuse note
- **Files:** edit `.claude/skills/quay-task-to-plan/SKILL.md` (a "Relationship /
  bootstrap" section) and its `Output` block. (~110 lines.)
- **Work:** encode proposal §8's point 6 (reuse/wrap `feature-developer`'s orchestration
  where it fits rather than reinventing the review loop) and §19's **preserved
  bootstrap resolution** (carried forward, unchanged, from the original draft's
  §11): the skill-implementation milestone itself **cannot** run through
  `quay-task-to-plan` (it is its own deliverable), so that first milestone runs
  through the existing `proposal-to-plan`, and `quay-task-to-plan`'s design is
  cross-checked against `proposal-to-plan` step-by-step; only the **second** dev-
  class milestone onward runs through the new skill (the still-deferred
  M-TASK-BACKLOG-PROJECTION impl / release-cadence impl are the first true-dogfood
  customers — **not** M16-cli-edit-parity-impl, which is already complete at
  `milestone_counter → 16` and is the milestone that landed the `task edit` write
  surface this skill consumes). Record the `Output` contract (tasks with proposals in `body`; a
  milestone-level plan record) and non-goals (proposal §10: not deleting/forking
  `proposal-to-plan`; not rendering stage process in the Web UI).
- **Acceptance:** the bootstrap chicken-and-egg is resolved explicitly (first
  milestone on `proposal-to-plan`, second onward on the new skill); the
  `feature-developer` reuse note is present; the `Output` block and non-goals are
  stated; the named first true-dogfood customers are listed.

**Phase 7 acceptance (all must hold):**
1. The plan step authors a milestone-level plan record (kept out of the task tree,
   process-invisible-in-Web-UI stated) and runs a grounded convergent check per the
   Phase-5 stopping rule, consuming the Phase-4 budget gate.
2. The TDD ≥80% hard gate is encoded with the code-vs-prose classifier (coverage %
   for code; mechanical checks for prose per plan 2).
3. Bootstrap resolution (proposal §19, preserved from original §11), `feature-developer` reuse, `Output`, and
   non-goals are all present.
4. Prose-asset mechanical checks pass (frontmatter valid, all referenced tools/
   commands/skills resolve, `grep`-checkable presence of the load-bearing rules).
   Total change ≤ ~500 lines.

---

## Test / verification strategy (scope stated honestly)

Split by asset type, exactly as `docs/plans/2-exp5-driver-deliverability-packaging.md`
and proposal §15.2 require — **not** a single blanket coverage number.

- **Executable code — TDD, ≥80% line coverage applies.** This is the Phase-4
  `it0-plan-budget-check.{sh,mjs}` (and any small helper the skill needs to invoke
  the provider). Written test-first (Stage 4.1 RED → Stage 4.2 GREEN), with unit
  tests covering: under-budget PASS, over-budget FAIL (naming the offender),
  malformed-input exit 2. Coverage measured on the `.sh`/`.mjs`.

- **Markdown / methodology / skill / prompt / manifest assets — verification =
  concrete checkable artifacts, NOT a coverage number:**
  - The **budget gate runs and FAILS on an over-budget fixture, PASSES on an
    under-budget one** (Phase 4) — the load-bearing checkable artifact that gives
    strand 2 its enforcement, replacing "coverage" for the methodology work.
  - Existing `experiments/quay-perpetual-stream/scripts/it0-*.sh`
    (`it0-gate-hash-check.sh`, `it0-ceiling-check.sh`, `it0-dogfood-evidence-gate.sh`,
    `it0-dir-projection-check.{sh,mjs}`) still PASS after every phase that touches
    the harness (esp. the gate-hash pin must be unchanged by Phases 3/5).
  - `grep`-checkable structural assertions per stage (the `≤2000/≤500/≤200` block
    present; the two classes + both diversity loci present; the clamp's both-ends
    independence present; the code-vs-prose classifier's two branches present; the
    write path names the full-field `task edit` / MCP `task_write` and no
    non-existent `task write` subcommand appears in the skill).
  - Skill frontmatter is valid and matches the in-repo shape; every provider
    tool/CLI and every sibling skill the new skill references resolves.

- **What is NOT automatically testable (stated honestly):** whether a *different*
  Claude Code session actually follows `quay-task-to-plan` as operating instructions
  is not unit-testable — it is verified the way exp5 itself is verified: by the
  milestone-boundary review of the next dev-class milestone's output once the work
  is adopted via `/quay-directive`. This plan does not pretend otherwise.

---

## Dogfooding note (proposal §19, preserving the original draft's §11 bootstrap resolution)

**This plan is itself intended to be the dogfooding subject.** Per proposal §19
(which preserves, unchanged, the original draft's §11 bootstrap-resolution
paragraph), the first *development-class* milestone that builds this skill runs through the
**existing `proposal-to-plan`** skill (the bootstrap substrate — the new skill
cannot run through itself before it exists), and `quay-task-to-plan`'s design is
cross-checked against `proposal-to-plan` step-by-step. From the **second** dev-class
milestone onward (the still-deferred M-TASK-BACKLOG-PROJECTION implementation and
release-cadence implementation — **not** the already-complete
M16-cli-edit-parity-impl), the very pipeline this
plan defines — N-subagent proposal re-derivation + adjudication, grounded convergent
plan-check, the ≤2000/≤500/≤200 budget gate, and the TDD ≥80% hard gate — becomes
the standing route. The clean dogfooding loop therefore begins one milestone after
the skill build; the build itself is bootstrapped on the proven prior-art skill.
