# Charter M25-dod-meta-enforcer — DIR-017 Step 1: the DoD meta-enforcer (Tier-A)

**Milestone id:** M25-dod-meta-enforcer · **surface:** method infra (`inherited-core.md`,
`OUTER-LOOP.md`, `scripts/it0-dod-check.{sh,mjs}`, 2 fixtures) · **type:** explore
**Source:** `tasks/exp5-M-DOD-META-ENFORCER.md` (SELECTed m25, `milestone:M25-dod-meta-enforcer`) —
implements DIR-017 Step 1 ONLY, the human-flagged "load-bearing foothold." Full source:
`directives/pending/DIR-017-dod-installation-program-mandatory-order-and-the-meta-enforcer-human-
verified-foothold.md` (stays `pending` after this milestone — DIR-017 is not resolved until its own
Steps 2-3 land, gated behind human confirmation of this step, see "Note for ABSORB" below).
**Charter authored:** m24→m25 boundary, 2026-07-18.

## Value hypothesis
- Value type (per `inherited-core.md`'s value-typed SELECT ledger): **governance-integrity**
  (primary — directly closes the Goodhart/self-exemption hole DIR-017's Finding names: the
  "designed-not-wired" disease M17/M18 exhibited, and DIR-015's own multi-milestone re-deferral
  pattern). Governance/infra hard floor check: this row's scope already includes BOTH the enabling
  half (the unified DoD section + no-self-exemption clause in `inherited-core.md`) AND the
  enforcement half (the standing `it0-dod-check` script pair, fixture-tested, wired into ABSORB as a
  HARD BLOCK) — not dispatched partial.
- Δv̂: **zero VT points** (method infra, no VT chart cell — mirrors M07/M10/M18/M21/M23/M24's
  zero-VT precedent). State this explicitly at ABSORB.
- Metric `Y`: none (no VT chart move). Success is DIR-017's own "Human verification gate" checklist
  items 1-5 (quoted verbatim below) landing in full, with live PASS/FAIL evidence from both a
  synthetic VIOLATING fixture and a synthetic COMPLIANT fixture.

## DIR-017's own Human-verification checklist (transcluded verbatim — this IS the Done-when source)
Quoted directly from DIR-017's "Human verification when exp5 marks this DIR done" section, because
this milestone's entire job is to make each item true, not merely claim it:
1. "It exists as executable, not prose." A new `scripts/it0-dod-*.{sh,mjs}` exists and runs;
   `inherited-core.md` has a single "Definition of Done" section, not scattered gate references.
2. "It actually blocks." Run it against a synthetic VIOLATING milestone stub — it must exit
   non-zero/FAIL. Then a COMPLIANT stub — it must PASS.
3. "It is wired into the loop as a HARD block." `OUTER-LOOP.md`'s ABSORB step references it as
   blocking `milestone_counter++`, in the same shape as the existing V_meta-lag/audit HARD blocks.
4. "The three existing gates are folded in" (DIR-017's own text says three; this milestone's actual
   scope per the SELECTed task and DIR-017's Requested-action item 1 is **four** — adversarial-audit,
   V_meta-lag, line-budget, impl-row — see "Scope note" below for the reconciliation), not left as
   separate conditional checks.
5. "The no-self-exempt clause is present and testable" — the synthetic self-exemption case in
   check #2 fails.
6. Only after #1-#5 hold does a human greenlight Steps 2-3 — explicitly OUT of scope here (see below).

**Reconciling item 4's "three" vs. DIR-017's Requested-action item 1's "four" (adversarial-audit,
V_meta-lag, line-budget, impl-row):** DIR-017's Requested-action §Step 1 item 1 (the authoritative
scope statement, and the one the SELECTed task's own Scope note cites) names **four** gates; the
Human-verification checklist's item 4 undercounts to "three" — read as a drafting slip in DIR-017
itself, not a scope-narrowing instruction. This charter follows the four-gate Requested-action text
(also matching the SELECTed task body and the m25 SELECT dashboard entry verbatim) — collecting
all four, not three.

## In-scope work (top-level; maps 1:1 to the 3 phases below)
1. Phase 1 — one unified "Definition of Done" section in `inherited-core.md`, collecting all 4
   existing gates as named clauses (trigger / what it checks / pass-fail semantics / current
   OUTER-LOOP.md invocation point each) + the no-self-exemption meta-clause.
2. Phase 2 — `scripts/it0-dod-check.sh` / `.mjs` script pair (exit 0/1/2) + 2 fixtures (VIOLATING,
   COMPLIANT), both fixtures verified to produce the correct exit code.
3. Phase 3 — wire `it0-dod-check.sh` into `OUTER-LOOP.md`'s ABSORB step as a HARD BLOCK on
   `milestone_counter++`, in the same gate sequence/position as the 3 existing HARD BLOCKs; run the
   updated ABSORB text's check end-to-end against both fixtures as final verification.

## Explicitly OUT of scope this milestone (per DIR-017 itself)
- **DIR-017 Steps 2-3** — the escrow-Δv clause, the product-work test-floor clause, and the leakage
  metrics onto `dashboard.md` — are explicitly deferred. DIR-017's own "Human-verification gate"
  section states these steps may only proceed **after a human confirms Step 1 (this milestone) is
  operative, not merely designed.** This milestone does not claim that confirmation for itself —
  it produces the artifact and evidence a human then reviews; DIR-017 itself stays `pending`,
  unresolved, after this milestone's ABSORB (see "Note for ABSORB" below). No work toward Steps 2-3
  is performed here — not even a stub.
- **Do not** retroactively re-run the DoD check against every past milestone (M01-M24) as a bulk
  sweep — this milestone builds the standing forward-looking check; a retroactive audit sweep (if
  ever wanted) is separate, larger scope, not requested by DIR-017 Step 1 or the SELECTed task.
- **Do not** modify the 4 existing gates' own underlying scripts (`it0-impl-row-check.sh`,
  `it0-ceiling-line-budget-check.sh`) beyond what's needed for `it0-dod-check.mjs` to call/wrap
  them — no behavior change to those scripts' own PASS/FAIL semantics.
- **Do not** touch `v-meta-ledger.md` rows or the adversarial-audit/V_meta-lag gates' own narrative
  text in `OUTER-LOOP.md` beyond adding the new DoD-check HARD BLOCK into the same step-6 sequence —
  this milestone unifies/names the 4 gates, it does not redesign any of their individual mechanics.
- **Do not** build a `-IMPL` follow-up row for this milestone at ABSORB — this milestone is itself
  operational/enforcement work (a standing script wired as a HARD BLOCK), not a design-only
  deliverable; the design-only-milestone impl-row gate does not apply to it (self-check per Phase 3).

## Line budget: ceiling-expansion regime invoked — 3-phase plan (mirrors M24's structure)
This milestone's scope (new `inherited-core.md` DoD section covering 4 gates in named-clause detail
+ a no-self-exemption meta-clause + a new script pair + 2 fixtures + an `OUTER-LOOP.md` wiring
change + end-to-end fixture verification) plausibly exceeds the small-milestone norm's item-count
proxy (more than 8 top-level in-scope items once each gate-clause and fixture is counted
individually) even though the in-scope list above is compressed to 3 top-level items by grouping
per-phase — following M18/M24's own precedent, this charter is chartered under the ceiling-expansion
regime (`inherited-core.md`'s "Milestone ceiling expansion" subsection) with an explicit phase/stage
plan below, each phase independently sized to the ≤500-line phase budget, no phase further requiring
stage-level splitting (each phase is a single coherent build+verify unit at the ≤200-line stage
grain already, per M24's own phase-sizing precedent).

### Phase 1 — `inherited-core.md` "Definition of Done" section (≤500 lines)
Stage 1.1: author ONE new top-level "## Definition of Done" section in `inherited-core.md`,
collecting all 4 gates as explicitly named clauses. Each clause states, at minimum:
  - **trigger condition** (when does this clause fire — mirrors the gate's existing "cadence rule"/
    "HARD BLOCK" trigger text already in `inherited-core.md`/`OUTER-LOOP.md`);
  - **what it checks** (one-paragraph restatement, citing not re-deriving, the existing section);
  - **pass/fail semantics** (what a PASS vs FAIL/REFUTED/FLAG verdict means for this clause);
  - **where it's currently invoked from** (the exact `OUTER-LOOP.md` step/sub-step name and line
    range, e.g. "step 6, Adversarial-audit gate sub-step").
  The four clauses:
  1. **Adversarial-audit gate** (DIR-007/M10) — cite `inherited-core.md`'s existing "Adversarial-
     audit role" + "Adversarial-audit cadence rule" sections; invoked from `OUTER-LOOP.md` step 6.
  2. **V_meta consolidation-lag gate** (DIR-005/M07) — cite `v-meta-ledger.md`'s schema + the K=2
     alarm threshold; invoked from `OUTER-LOOP.md` step 6.
  3. **Line-budget gate** (M18) — cite `scripts/it0-ceiling-line-budget-check.sh`'s own header
     comment (exit 0/1/2 semantics already documented there); invoked from `OUTER-LOOP.md` step 1
     (plan-time, BEFORE dispatch — note this is the one gate that fires at charter-authoring time,
     not ABSORB, and state that distinction explicitly in the clause text).
  4. **Design-only-milestone impl-row gate** (DIR-016/M21) — cite `inherited-core.md`'s existing
     "Design-only milestone → mandatory `-IMPL` row rule" section + `scripts/it0-impl-row-check.sh`;
     invoked from `OUTER-LOOP.md` step 6.
Stage 1.2: add the **no-self-exemption meta-clause** to the same DoD section: no milestone charter
or ABSORB step may declare itself exempt from a DoD clause without an explicit, human-visible
**waiver line** logged in `dashboard.md` (i.e., a charter's "Explicitly OUT of scope" section
narrating away a gate that should fire, with no corresponding dashboard waiver line, is NOT a valid
exemption — the gate must still be evaluated and its outcome recorded, per the existing "documented
no-op" discipline the adversarial-audit gate's non-blanket cadence rule already models). State the
exact waiver-line shape required (milestone id, clause name, one-line reason, dated) and that its
absence is itself a DoD violation the standing check (Phase 2) can detect mechanically for the
line-budget/impl-row clauses (charter-text-inspectable) and that the adversarial-audit/V_meta-lag
clauses' existing "documented no-op" ABSORB-log requirement already satisfies the same discipline by
construction (cite, don't re-derive).

### Phase 2 — `scripts/it0-dod-check.sh` / `.mjs` + 2 fixtures (≤500 lines)
Stage 2.1: build `scripts/it0-dod-check.mjs`, following the established `it0-*-check.mjs` shape
(see `it0-backlog-projection-check.mjs`, `it0-dir-projection-check.mjs` as direct precedent): given
a milestone id + its charter file path + its dashboard ABSORB-entry text (or a path to a fixture
file standing in for that text), runs all 4 DoD clauses' logic:
  - **line-budget clause**: shell out to (or re-implement calling) `it0-ceiling-line-budget-check.sh
    <charter-file>` — reuse the existing script directly, do not re-derive its logic.
  - **impl-row clause**: shell out to (or re-implement calling) `it0-impl-row-check.sh <milestone-id>
    backlog.md` — reuse directly; N/A-passes if the milestone is not design-only (existing script's
    own semantics).
  - **adversarial-audit clause + V_meta-lag clause**: no existing standalone `it0-*.sh` script exists
    for either (both are narrative HARD BLOCKs in `OUTER-LOOP.md` step 6, evaluated by the ABSORB
    author's own judgment + `v-meta-ledger.md` row inspection) — for these two, `it0-dod-check.mjs`
    checks the **documentation discipline**, not the underlying judgment call: does the milestone's
    ABSORB-entry text (fixture input) contain an explicit disposition statement for each of these two
    gates (a stated verdict — "N/A/no-op", "PASS", "REFUTED", "clear", etc. — matching the existing
    "documented no-op" / row-update discipline already required by `inherited-core.md`)? A missing
    disposition statement for either gate is a DoD FAIL (mirrors the no-self-exemption clause: an
    absent disposition is indistinguishable from an undeclared silent skip). State this scope
    explicitly in the script's own header comment — it does NOT re-run the adversarial-audit
    subagent or re-derive V_meta-ledger math; it checks that the record shows the gate was actually
    evaluated and dispositioned, which is exactly what DoD-clause 2 (no-self-exemption) requires.
  - **no-self-exemption meta-check**: scan the charter's "Explicitly OUT of scope" section (and the
    dashboard ABSORB-entry fixture) for language that narrows/exempts a DoD clause (heuristic
    string/pattern match, e.g. "exempt", "skip the gate", "does not apply" adjacent to a named gate,
    OR any of the 4 clauses' own FAIL/FLAG signal firing) with NO corresponding waiver line (a line
    matching the Stage 1.2-defined waiver shape) present in the dashboard fixture text — if scope-
    exemption language is found with no waiver line, FAIL.
  Exit codes: **0** = all 4 gate clauses PASS or legitimately N/A (with disposition present), AND no
  undeclared self-exemption found; **1** = at least one gate clause FAILs, OR a self-exemption is
  found with no waiver line; **2** = usage/environment error (missing args, files not found, node
  unavailable — mirrors every sibling `it0-*.mjs` script's exit-2 convention).
Stage 2.2: build `scripts/it0-dod-check.sh` as a thin wrapper (mirrors `it0-backlog-projection-
check.sh`'s exact wrapper shape: usage/arg check, `node` availability check, delegates to the
`.mjs`, propagates its exit code) — same `it0-*-check.sh` wraps `it0-*-check.mjs` convention as
every existing pair in `scripts/`.
Stage 2.3: author **two fixtures** under `experiments/quay-perpetual-stream/fixtures/dod/` (new
subdirectory, mirroring the existing `milestones/M<NN>/` per-milestone artifact convention but
scoped as shared test fixtures, not a real milestone):
  - `fixtures/dod/violating-stub.md` — a synthetic charter+ABSORB-entry stub for a fake milestone
    (e.g. `M99-fake-violating`) that: is design-only per the impl-row gate's own trigger text (e.g.
    contains "design delivered") with NO corresponding `-IMPL` backlog row anywhere, AND separately
    declares itself "exempt from the adversarial-audit gate" in its "Explicitly OUT of scope" section
    with no waiver line in its paired dashboard-entry fixture text — a DOUBLE violation (impl-row
    FAIL + self-exemption FAIL) deliberately, so the check has more than one way to legitimately fire
    non-zero, making the fixture robust to either individual clause's exact wording changing later.
  - `fixtures/dod/compliant-stub.md` — a synthetic charter+ABSORB-entry stub for a fake milestone
    (e.g. `M98-fake-compliant`) that: is NOT design-only (ships operational work, mirroring this very
    milestone's own self-check), declares explicit dispositions for all 4 gate clauses (adversarial-
    audit: documented no-op, N/A per cadence rule; V_meta-lag: clear, no rows past threshold;
    line-budget: PASS, small-scope charter under the norm; impl-row: N/A, not design-only), and
    contains no undeclared self-exemption language.
Stage 2.4: run `it0-dod-check.sh` against both fixtures and paste the raw PASS/FAIL output for each
— `violating-stub.md` MUST exit 1 (FAIL), `compliant-stub.md` MUST exit 0 (PASS). This is the direct
mechanical satisfaction of DIR-017's Human-verification checklist item 2.

### Phase 3 — `OUTER-LOOP.md` ABSORB wiring + end-to-end verification (≤500 lines)
Stage 3.1: edit `OUTER-LOOP.md` step 6 (ABSORB) to add a new **"DoD meta-enforcer gate (DIR-017 /
M25-dod-meta-enforcer, HARD BLOCK on step 7's `milestone_counter++`)"** sub-step, positioned in the
SAME gate sequence as the 3 existing HARD BLOCKs — immediately after the adversarial-audit gate,
V_meta consolidation-lag gate, and design-only-milestone impl-row gate all individually clear, and
BEFORE (or folded into, stated explicitly which) the driver→master publish sub-step, exactly
mirroring how M21's impl-row gate itself was added into this same sequence at its own boundary.
State plainly: `scripts/it0-dod-check.sh <milestone-id> <charter-file> <absorb-entry-text-or-file>`
must PASS (exit 0) before `milestone_counter++` (step 7) may execute; a non-zero exit is the SAME
HARD BLOCK shape/placement as the 3 gates it wraps — it does not replace their individual HARD
BLOCKs (each individual gate's own text in step 6 stays as-is), it adds ONE more standing check that
the record of all 4 (plus the no-self-exemption discipline) is actually complete and undrifted.
Stage 3.2: run the updated `OUTER-LOOP.md` ABSORB text's new check against both Phase 2 fixtures one
more time in the exact invocation shape the ABSORB step now documents (end-to-end sanity — the
wiring text's own command line, not just the raw script call from Stage 2.4) and paste that output.
Stage 3.3: apply this milestone's OWN self-check — run `it0-dod-check.sh` against M25's own charter
(this file) + a drafted ABSORB-entry excerpt (this milestone is not itself design-only; states
dispositions for all 4 clauses) and confirm it PASSes, demonstrating the tool works on a REAL
milestone, not only synthetic fixtures.

**Gauge note:** the verify-iteration size gauge (`inherited-core.md`) applies per-phase — each phase
above is judged as its own "iteration-0 lands it in one pass, iteration-1 independently re-derives"
unit, mirroring M24's own precedent.

## Binary Done-when (§3.4 — mandatory, freezes this milestone's shape)
1. `[ ]` `inherited-core.md` has ONE new "Definition of Done" section (Stage 1.1) collecting all 4
   gates (adversarial-audit, V_meta-lag, line-budget, impl-row) as named clauses, each stating
   trigger / what-it-checks / pass-fail semantics / current invocation point — pasted diff.
2. `[ ]` No-self-exemption meta-clause present in the same section (Stage 1.2), defining the
   mandatory waiver-line shape and stating its absence is itself a violation — pasted diff.
3. `[ ]` `scripts/it0-dod-check.mjs` exists, implements all 4 gate-clause checks (wrapping the 2
   existing scripts directly for line-budget/impl-row, documentation-discipline checks for
   adversarial-audit/V_meta-lag, plus the self-exemption/waiver-line scan) with exit 0/1/2 semantics
   (Stage 2.1).
4. `[ ]` `scripts/it0-dod-check.sh` exists as a thin wrapper delegating to the `.mjs`, mirroring the
   established `it0-*-check.sh`/`.mjs` pair convention (Stage 2.2).
5. `[ ]` Two fixtures exist under `experiments/quay-perpetual-stream/fixtures/dod/`
   (`violating-stub.md`, `compliant-stub.md`) per Stage 2.3's spec.
6. `[ ]` `it0-dod-check.sh` run against `violating-stub.md` exits non-zero (FAIL) — pasted raw output
   (Stage 2.4). This satisfies DIR-017 checklist item 2's "it must exit non-zero/FAIL" half.
7. `[ ]` `it0-dod-check.sh` run against `compliant-stub.md` exits 0 (PASS) — pasted raw output
   (Stage 2.4). This satisfies DIR-017 checklist item 2's "then a compliant stub — it must PASS" half.
8. `[ ]` `OUTER-LOOP.md` step 6 (ABSORB) updated with the new DoD meta-enforcer HARD BLOCK sub-step,
   positioned in the same gate sequence as the 3 existing HARD BLOCKs, sequenced relative to the
   driver→master publish sub-step (Stage 3.1) — pasted diff.
9. `[ ]` The updated `OUTER-LOOP.md` ABSORB text's own invocation shape re-run against both fixtures,
   end-to-end (Stage 3.2) — pasted raw output for both.
10. `[ ]` `it0-dod-check.sh` run against THIS milestone's own charter + a drafted ABSORB-entry excerpt
    PASSes (Stage 3.3) — pasted raw output, demonstrating real-milestone applicability.
11. `[ ]` Full existing test suite passes post-change (no regressions from the `OUTER-LOOP.md` edit or
    the new script pair) — pasted raw output.
12. `[ ]` `git diff --stat` against the pre-charter base commit shows only the expected files touched
    (`inherited-core.md`, `OUTER-LOOP.md`, `scripts/it0-dod-check.{sh,mjs}`,
    `fixtures/dod/{violating,compliant}-stub.md`) — no unrelated product code.

Milestone is DONE when all twelve are met and stable ≥1 iteration (§3.2 condition 1). Terminate
early per §3.2 conditions 2-5 if they fire first. Real independent-re-derivation material for
iteration-1 exists per phase: whether the DoD section's 4 clauses (Phase 1) actually cite the correct
current invocation points (not stale line numbers/section names once iteration-0's own edits shift
`OUTER-LOOP.md`'s text), whether the script (Phase 2) genuinely reuses rather than silently
re-implements-and-diverges-from the 2 existing scripts, whether the fixtures (Phase 2) are
constructed so the VIOLATING stub fails for the RIGHT reason (not an unrelated usage error) and the
COMPLIANT stub passes without any clause being silently skipped, and whether the ABSORB wiring
(Phase 3) is precise enough to survive a skeptical re-read against the actual gate sequence (correct
ordering relative to the driver→master publish sub-step) — all independently checkable, not empty
verification.

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
consecutive · (3) ceiling→redesign-OR-stop · (4) budget≈10 backstop, past→default HALT ·
(5) external HALT.

## it0 systematic-explore checks (§4.4 — run and record BEFORE first work)
a. **Ceiling/floor arithmetic** — N/A this milestone (DIR-017/task-store-sourced, not a
   `gap-list.md` gap id — same confirmed limitation as M13/M21/M22/M23/M24). DIR-017's own text and
   `tasks/exp5-M-DOD-META-ENFORCER.md` are the direct sources, both confirmed present at
   charter-authoring time.
b. **Gate-hash/transclusion** — verified above via `--by-reference` mode; re-run before dispatch.
c. **Dogfooding evidence-gate** — every Done-when clause requires pasted output evidence (diffs,
   raw script PASS/FAIL output, test-suite output, `git diff --stat`) — no clause is narrative-only.
d. **Domain-misfit audit-channel** — this milestone edits `inherited-core.md` prose, builds a new
   script pair, and edits `OUTER-LOOP.md` prose; the audit channel is direct script re-execution
   against fixtures with real PASS/FAIL exit codes (mechanically independent of any self-report,
   the exact shape DIR-017 itself demands via its own Human-verification checklist item 2) — no
   domain-misfit risk, same class as M02/M05/M21/M24's own script-based audit channels.
e. **Plan-time line-budget gate** — this charter declares the ceiling-expansion regime explicitly
   (see "Line budget" section above) with a 3-phase plan inline (Phase 1-3, each with Stage
   sub-numbering) satisfying the phase/stage-plan requirement; run
   `scripts/it0-ceiling-line-budget-check.sh charters/M25-dod-meta-enforcer.md` and record PASS
   before dispatch. (Per the task instructions, this script is run by the orchestrator after this
   charter is returned, not by the charter author.)

## Adversarial-audit gate — evaluate at ABSORB (state explicitly)
Per `inherited-core.md`'s Adversarial-audit cadence rule: condition (a) requires a capability-growth-
typed milestone with a NONZERO realized VT Δv — this milestone is typed governance-integrity with
Δv̂=0 by design (method infra, no VT chart cell), so condition (a) does not apply regardless of
outcome UNLESS the realized Δv turns out nonzero at ABSORB (re-check then, not assumed here).
Condition (b) requires iteration-0 to recommend skipping iteration-1 — not authorized; both
iterations run regardless. **Note the self-referential stakes here**: this milestone is itself
building the mechanism DIR-017 requires precisely BECAUSE prior milestones' documented-no-op
dispositions for this gate were themselves at risk of drifting into shelfware — so this ABSORB's own
disposition statement for this gate must be unusually precise (state plainly which condition, if
either, fired and why), since M25's own record is the first real test corpus the new DoD check
(Phase 2/3) will be run against in Stage 3.3.

## V_meta consolidation-lag gate — evaluate at ABSORB (state explicitly)
Check every `v-meta-ledger.md` row with status `confirmed`-but-not-`consolidated` against the K=2
alarm threshold at ABSORB time (current `milestone_counter` minus the row's confirming-milestone
number). Record the check's outcome explicitly in the ABSORB log entry — this is now itself one of
the DoD clauses this milestone's own script (Phase 2) mechanically checks was dispositioned, so
skipping this statement would be a live self-exemption on the very first ABSORB after the checker
exists.

## Design-only-milestone impl-row gate — evaluate at ABSORB (state explicitly)
This milestone is NOT design-only: it ships operational artifacts (a working script pair wired as a
HARD BLOCK), not a design doc with a "Done-when clauses a future implementing milestone would need"
checklist. `it0-impl-row-check.sh M25-dod-meta-enforcer backlog.md` is expected to PASS (N/A —
row not design-only) at ABSORB; paste that output as part of Done-when clause 12's closing evidence.

## Note for ABSORB — DIR-017 stays `pending`, human confirmation required before Steps 2-3
Per DIR-017's own "Human-verification gate (irreducible, not delegable)" clause, this milestone's
ABSORB must NOT mark DIR-017 itself `applied`/archived, and must NOT create or SELECT any Step-2/3
candidate row. State explicitly in the ABSORB log entry: "DIR-017 Step 1 artifact delivered
(inherited-core.md DoD section, it0-dod-check script pair, 2 fixtures, OUTER-LOOP.md wiring) —
awaiting human confirmation per DIR-017's own irreducible verification-gate clause before Steps 2-3
may be SELECTed. DIR-017 remains `pending`." This mirrors M23's own precedent of stating a directive
remains open/deferred rather than silently marking it resolved.

## Dispatcher notes
Standard 2-iteration pattern: iteration-0 (build) + iteration-1 (fresh worktree, independent
re-derivation, NOT reading iteration-0's report/materials). **Both worktrees created off
`exp5-outer-driver` HEAD, not `master`** — per the M23-outer-driver-isolation discipline now
standing (DIR-018): at DRAIN (before this milestone's SELECT), `master` was already merged into
`exp5-outer-driver`; both iteration worktrees for M25 branch from that current `exp5-outer-driver`
HEAD. Worktree/branch paths: `milestones/M25-dod-meta-enforcer/worktrees/iteration-{0,1}`, branches
`exp5-m25-iteration-{0,1}`. Merge iteration-0/iteration-1 results into `exp5-outer-driver` first
(per-file conflict resolution, reconciliation notes per DIR-018 item 3's no-silent-drop discipline);
only THEN merge `exp5-outer-driver` → `master` as the single ABSORB publish commit (`git checkout
master && git merge --no-ff exp5-outer-driver`), sequenced after the adversarial-audit gate, V_meta
consolidation-lag gate, design-only-milestone impl-row gate, AND this milestone's own new DoD
meta-enforcer gate (Phase 3, self-applicable per Stage 3.3) all clear. iteration-0 builds all 3
phases in one pass (single build+verify pass across Phase 1-3, per the ceiling-expansion regime's
"one whole plan, multiple phases" framing — NOT three separate BAIME iterations); iteration-1
independently re-derives/verifies across all three phases in its own fresh worktree, per the
standard 2-iteration pattern's shape, not per-phase re-derivation. Given this milestone's explicitly
self-referential character (building the mechanism that will audit future milestones, including
itself), iteration-1 should pay particular attention to whether iteration-0's own fixtures are
rigged to trivially pass/fail (i.e., whether the VIOLATING fixture is REALLY caught for the stated
reason, and the COMPLIANT fixture REALLY has no clause silently skipped) rather than accepting
iteration-0's own claimed pasted output at face value — this is exactly the kind of claim DIR-017's
Finding warns the drifting mechanism is prone to overstating about itself.
