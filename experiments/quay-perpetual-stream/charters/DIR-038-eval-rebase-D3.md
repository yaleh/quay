# Charter DIR-038-eval-rebase-D3 — re-base exp5's OWN evaluation mechanism
# (rolling-window slope + governance:product hard-halt) under the D3
# behavior-preserving + golden-replay discipline, with the RECORDED HISTORICAL
# LEDGER as the golden oracle. SPLIT: DIR-038-A (first) → DIR-038-B.

**Milestone id:** assigned at human dispatch (the next free `M<NN>` at a clean loop window —
DIR-anchored, NOT loop-numbered, to avoid racing `milestone_counter`).
**Surface:** cli / method-infra (adds `scripts/rolling-slope-check.mjs` +
`scripts/governance-product-ratio-check.mjs`, each `quay gate`-wrappable per the M39 registry
precedent; edits `OUTER-LOOP.md:484` self-halt clause + `inherited-core.md:281-321` value-typed
ledger + the checkpoint template + `dashboard.md`'s slope reporting).
**Type:** governance-integrity (PRIMARY — makes the loop's own value ruler + halt criterion tell the
truth) + instrument-correction. NO VT chart cell expected (the DoD-program lineage's no-VT-cell
precedent).
**Source:** `DIR-038` (`tasks/DIR-038.md`, human-authored directive; human-steered removed
2026-07-20 → milestone-candidate; deferred 8 passes M62–M69 as "D3 driver-rewrite class needing a
dedicated scoped dispatch"). This charter IS that dispatch.
**Charter authored:** 2026-07-21, off-loop per DIR-027, during the human `.halt` window. Base commit:
`master` HEAD `ea8b000` (M73 ABSORB).
**Human-steered:** YES — this rewrites the loop's OWN value ruler (VT model, value-typed ledger) AND
halt criterion (self-halt slope denominator). It is the SHARPEST driver-self-rewrite hazard in the
backlog: a loop editing its own halt test could re-score itself favorably (`OUTER-LOOP.md:78`,
DIR-030 fence). Executed under the fence's named exception — **the D3 behavior-preserving +
golden-replay discipline** — under explicit human direction, in the `.halt` window. NOT a precedent
for autonomous SELECT.

## SELECT reasoning
Not a cadence SELECT. `DIR-038` was human-authorized for autonomous SELECT (2026-07-20) yet the loop
correctly deferred it 8 straight passes — each note: "Still D3 driver-rewrite class (rewrites the
loop's own evaluation/halt mechanism), golden-replay mandatory; needs dedicated scoped dispatch."
The irony is the point: DIR-038 is the fix for the EXHAUSTED RULER that is itself causing the defer
loop (VT saturated at 0.93 → new capability scores 0 → everything reads low-value → loop picks the
smallest safe crystallization task each pass). Fixing the ruler is the highest-leverage move to
unstick the whole backlog. This charter supplies the dedicated, human-dispatched, golden-replay pass
the 8 defer notes asked for, and takes the `.halt` window (opened for the DIR-044 dispatch) to do it
alongside DIR-044.

## The D3 discipline for THIS milestone (the operational core)

The subject is the loop's own MEASUREMENT instrument, so "behavior-preserving" has an unusual meaning:
the re-based ruler must NOT change what actually happened — it must reproduce the HONEST numbers the
stream ALREADY hand-computed as cross-checks but never fed to the halt. The oracle is not a milestone
pair (as in DIR-044) but the **recorded historical ledger**.

### Step 1 — Freeze the golden baseline (the recorded ledger, BEFORE any code)
Freeze, from git + dashboard at `ea8b000`, the per-milestone Realized-Δv sequence (m1…m73 from
`dashboard.md`'s ABSORB log) AND the honest cross-check numbers the stream already computed by hand:

- **DIR-038-A oracle (rolling slope):** `dashboard.md:341-342` ALREADY computes the honest rolling
  rate — recent window **m29–m35 = 0.90 total / 7 → ≈0.643 Δv per 5**, and the finding records
  **m41–m49 ≈ 0**. The self-halt currently reports the qualifying-only frozen **3.80** instead. The
  golden assertion: the NEW rolling-window check, run over the recorded sequence, reproduces
  **≈0.643 (m29–m35)** and **≈0 (m41–m49)** — NOT 3.80. Second frozen fact: **16 consecutive
  zero-VT milestones (M34–M49)** never tripped the halt; replayed through the honest denominator they
  MUST cross the `< +1.0` threshold (the detector that structurally could not see the stall now sees
  it).
- **DIR-038-B oracle (governance:product ratio):** the finding records **≈8:1 (≈6249:756 prose:code
  lines)** for the restart window. The golden assertion: the NEW ratio check, run over the same
  recorded git window (`git diff --numstat` classified), reproduces **≈8:1**, and a synthetic
  over-threshold fixture trips the hard-halt clause.

These frozen numbers are the oracle. They are pinned to commit `ea8b000`'s dashboard so they cannot
drift as `master` advances (capture them into the fixture at authoring time).

### Step 2 — Build A then B, increment-by-increment, single-source
Order is fixed by the task (A first: highest leverage, smallest change, pure honesty):
1. **DIR-038-A** — `scripts/rolling-slope-check.mjs`: ONE definition of "VT slope over a rolling window
   of the last K≥5 milestones INCLUDING zero-Δv ones"; a mechanical check that exits non-zero if any
   checkpoint's stated slope uses the qualifying-only (zeros-excluded) denominator. Retire the
   qualifying-only convention across `dashboard.md` / `inherited-core.md` / the checkpoint template
   (single-source — the script IS the definition; docs point at it, never restate the arithmetic).
2. **DIR-038-B** — `scripts/governance-product-ratio-check.mjs`: computes governance:product for a
   checkpoint window (milestone-type mix and/or code:prose line ratio), writes it into the checkpoint,
   exits non-zero over a declared threshold; wire the `OUTER-LOOP.md:484` self-halt
   "hypothesis-falsified/degradation" clause to reference it so a breach CAN trip the hard halt.
DUAL-SOURCE GUARD (fatal): each check is check-logic-as-ONE-script; the doc edits are code-pointers,
never a second implementation. Each increment is split-or-commit (A can land alone).

### Step 3 — Golden-replay over the recorded history (the terminal proof)
Run each new check over the FROZEN recorded sequence and assert equality with the Step-1 oracle:
- A: rolling-slope-check over m1…m73 reproduces ≈0.643 (m29–m35) and ≈0 (m41–m49); and the M34–M49
  zero-run crosses the halt threshold. If it instead reproduces 3.80, or fails to trip on the zero-run,
  it is NOT the honest ruler → send back.
- B: ratio-check over the recorded window reproduces ≈8:1; the over-threshold fixture trips halt.
The terminal real-landing (DIR-038 DoD): a real `cp-NN` checkpoint is generated THROUGH the re-based
mechanism, pasting the honest rolling slope (not 3.80).

### Step 4 — Never un-halt the live loop (inherently replay-safe here)
The oracle is RECORDED history, so the entire golden-replay is read-only over past data — no live
milestone runs, `milestone_counter` untouched. The `.halt` stays in place; the whole pass runs off-loop
(private worktree off `master`). This is the safest D3 class: the replay cannot perturb the subject.

### Step 5 — NON-WAIVABLE anti-gaming guardrail (the crux of a ruler-rewrite)
Because a loop rewriting its own ruler could re-score itself favorably, the guardrail is a
**single-directional monotonicity check, non-waivable**:
- The re-based ruler must NEVER re-score any past milestone or window MORE favorably than the honest
  cross-check already on record: the new rolling slope must be **≤** the old reported qualifying-only
  slope (retiring an inflated denominator can only LOWER or hold the number, never raise it); the new
  governance:product signal must not shrink the recorded ≈8:1 concern. A change that makes the loop
  look BETTER is presumptively gaming and is REJECTED unless independently justified.
- The intended-HALT clause is explicit: once the honest metrics are wired, a genuinely-low rate MAY
  fire `HALT-RECOMMENDED` at the next checkpoint — **that firing is the intended safety behavior, a
  PASS of this milestone, not a failure** (`tasks/DIR-038.md` extra.authorized).
- Fresh-context adversarial audit before merge (ADR-005): an independent subagent that did NOT write
  the checks attempts to refute (a) the golden-replay equality (new numbers == hand-computed honest
  numbers) and (b) the monotonicity guardrail (no window re-scored more favorably). Any surviving
  refutation blocks land → `needs-human`. (The D3 lineage: independent review caught 3 rounds of
  fail-open bugs in the vmeta-lag-check that the builder's own tests passed over — a ruler-rewrite
  gets the same scrutiny or more.)

## Acceptance Criteria
Mirrors `tasks/DIR-038.md`'s own AC EXACTLY (single-source — the task is canonical; do not fork here).
This charter dispatches the **#3 → DIR-038-A** and **#2 → DIR-038-B** criteria; **#1 (outward VT term)
→ DIR-038-C is OUT of scope for this pass** (see below). In brief: A = rolling all-milestone slope +
retire qualifying-only denominator, single-sourced, mechanical check bites; B = governance:product
ratio check written into the checkpoint + wired to the hard-halt clause, breach trips on a fixture.
Each fix lands its executable check WITH the change (ADR-011) + RED/GREEN fixture (ADR-001),
single-sourced (ADR-004); it0 DoD meta-enforcer passes.

## Definition of Done
References `tasks/DIR-038.md`'s own DoD + the standard `inherited-core.md` clauses (0 AC/DoD present,
1 acceptance audit UNCONDITIONAL, 2 V_meta-lag, 3 line-budget, 4 impl-row, 5 no-self-exemption, 6
escrow-Δv, 7 test-floor APPLIES [new method-infra scripts → strict TDD ≥80%], 8 canonical-lifecycle,
9 split-or-commit). Real-landing bar: a real `cp-NN` generated through the re-based mechanism pastes
the honest rolling slope (not 3.80); each of A/B has its check + RED/GREEN fixture; the monotonicity
guardrail held (no window re-scored more favorably); the governance fence + DIR-027 hygiene honored.
Parent DIR-038 is done only when A/B/C all land — this pass lands A/B; C is a separate follow-on.

## Value hypothesis
- Value type: **governance-integrity** (the loop's ruler + halt tell the truth) + instrument-correction.
- **Δv̂:** no VT chart cell (method-infra/eval-layer). Value = the golden-replay equality result + the
  monotonicity guardrail + a real honest checkpoint. This is the LAST necessary inward fix
  (`tasks/DIR-038.md`): it makes the ruler stop rewarding inward churn.

## Golden baseline (frozen, at `ea8b000`)
- Per-milestone Realized-Δv sequence m1…m73 from `dashboard.md` ABSORB log.
- Honest rolling rate: **m29–m35 ≈ 0.643 / 5**, **m41–m49 ≈ 0** (already on `dashboard.md:341-342`).
- Frozen mis-report: self-halt currently states **3.80** (qualifying-only denominator).
- Zero-VT run: **M34–M49 = 16 consecutive zero-Δv milestones** that never tripped `< +1.0`.
- Governance:product: **≈8:1 (≈6249:756 prose:code lines)** restart window.

## In scope
- **DIR-038-A** (fix #3): rolling all-milestone slope check + retire qualifying-only denominator,
  single-sourced across dashboard / inherited-core / checkpoint template.
- **DIR-038-B** (fix #2): governance:product ratio check wired to the `OUTER-LOOP.md:484` hard-halt.
- The `OUTER-LOOP.md` / `inherited-core.md` edits reducing the ruler prose to code-pointers
  (golden-diff: every uncoded eval/halt invariant preserved, independent LOSSLESS review).
- The golden-replay harness over the frozen recorded ledger + a real honest `cp-NN`.

## Explicitly OUT of scope
- **DIR-038-C (fix #1, unbounded outward VT term)** — deferred to a separate follow-on: it is
  entangled with [[DIR-036]] external-deployment (the outward term reads the external signal DIR-036
  produces), so it should land after/with the DIR-036 transfer, not in this eval-honesty pass. This
  charter dispatches A/B only, per the human scope decision.
- Any change to SELECT weights or hard selection rules — DIR-038 fixes the SIGNAL, never selection.
- Any re-score that makes the loop look better (Step-5 monotonicity fence).
- Un-halting the loop / advancing the live counter (Step-4 fence).

## Increment plan (SPLIT-OR-COMMIT, DIR-026)
Each increment done-or-`needs-human`; A lands first and can stand alone.
1. **DIR-038-A** — rolling-slope-check.mjs + doc single-source + golden-replay (reproduce 0.643 / ~0,
   trip on M34–M49) + monotonicity guardrail. Smallest, pure honesty, highest leverage.
2. **DIR-038-B** — governance-product-ratio-check.mjs + OUTER-LOOP hard-halt wire + over-threshold
   fixture trips halt.
3. Real honest `cp-NN` generated through the re-based mechanism (terminal proof) + fresh-context audit.

## it0 checks (run at charter-authoring time, before dispatch)
- `scripts/task-schema-check.sh tasks/DIR-038.md` → must PASS before dispatch (fix the task, not the
  script).
- Enforcement-with-design (ADR-011): each fix ships its executable check in the SAME increment —
  never a prose-only "the slope should be honest" without `rolling-slope-check.mjs`.
- Size/ceiling: ≤2000-line ceiling per increment; A and B are the split points.

## Note for ABSORB — the reflexivity is EXTREME here
This milestone rewrites the very evaluation/halt mechanism that would normally judge it. Two
safeguards make its acceptance objective rather than self-referential:
1. **The golden-replay equality is an OBJECTIVE oracle** — the new numbers must equal numbers the
   stream ALREADY hand-computed and recorded (0.643, ~0, 8:1) BEFORE this milestone existed; the
   milestone cannot move that goalpost.
2. **The monotonicity guardrail + fresh-context audit** — the independent auditor's single most
   important charge is to confirm the re-based ruler did NOT re-score any window more favorably. If
   an independent auditor cannot be dispatched, that BLOCKS `milestone_counter++` (no self-audit
   license — and this is the milestone where self-audit would be most dangerous).
If the honest metrics fire `HALT-RECOMMENDED` at the terminal checkpoint, record it as a PASS and
leave it for async human review — do NOT tune the threshold to avoid the halt (that would be the
exact gaming this milestone exists to prevent). DIR-027 hygiene: authored off-loop at `ea8b000`;
land via ff-merge at a clean window.

## Dispatcher notes
- Human dispatch only, in the current `.halt` window (do not remove `.halt`; the loop is paused for
  this and the DIR-044 dispatch).
- Assign the concrete `M<NN>` at dispatch from the then-current `milestone_counter`; rename this
  charter to `M<NN>-dir038a-eval-rebase.md` (A) at that time.
- Recommended sequencing in the halt window: **DIR-038-A first** (pure honesty, unblocks the ruler),
  then DIR-038-B, then optionally the DIR-044 concurrent-scheduler dispatch (its charter is ready).
- The frozen dashboard numbers (`dashboard.md:341-342` at `ea8b000`) are the oracle — capture them
  into the replay fixture at Step 1 so they cannot drift.
