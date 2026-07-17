# V_meta Formula Reference — quay-continuous-bootstrap (Experiment 4)

**Created at:** iteration 14, 2026-07-17  
**Status:** redesigned formula active from iteration 14 onward  
**Directive:** DIR-008 (redesign V_meta for open-ended meta goal)

---

## Old Formula (Experiments 1–13, inherited at experiment start)

```
V_meta_old = completeness × effectiveness × reusability × validation
```

### Factor definitions (old)

| Factor | Definition | Value at switch point (iteration 13 FINAL) |
|--------|-----------|---------------------------------------------|
| `completeness` | Fraction of Skill Method steps present in the Skill file set | 0.77 |
| `effectiveness` | Speedup ratio of building feature N+1 via the tool vs. ad-hoc, on scope-matched tasks | **0.26** (frozen since experiment 1, iteration 23) |
| `reusability` | Whether the methodology transferred to a second Provider (GitHub) unmodified | **0.79** (frozen since experiment 1, iteration 25) |
| `validation` | σ_QX = (# native tasks) / (total done tasks) | 0.978 (45/46) |

### Value at switch point

```
V_meta_old (iteration 13 FINAL) = 0.77 × 0.26 × 0.79 × 0.978 = 0.154
```

### Why the old formula was problematic

1. **Two factors were structurally frozen.** `effectiveness` (0.26) measured a one-time
   bootstrap speedup from experiment 1; it has not moved across ~65+ subsequent iterations.
   `reusability` (0.79) measured transfer to a second Provider — a one-time event completed
   in experiment 1 that cannot repeat. Both were answers to already-answered questions.

2. **The ceiling was unreachable.** Because the formula is multiplicative and `effectiveness`
   is frozen at 0.26, the maximum possible `V_meta_old` = 0.26, well below the 0.80
   convergence threshold. V_meta ≥ 0.80 was arithmetically unreachable by construction.

3. **The central open question was unscored.** The stall analysis documented that late
   experiment gains came through ad-hoc engineering rather than the methodology being the
   active driver — "the central open question, not a footnote." That question was not
   a scored factor anywhere in V_meta_old.

---

## New Formula (Experiment 4, from iteration 14 onward)

```
V_meta_new = methodology_leverage × strategy_completeness × transfer_breadth × validation
```

Each factor is renewable: it can move up or down each iteration based on evidence gathered
within that iteration. No factor measures a frozen one-time past event.

### Factor definitions (new)

#### 1. `methodology_leverage` (replaces `effectiveness`)

**Question:** What fraction of this iteration's delivered improvement was driven by the
methodology loop vs. ad-hoc engineering that bypassed it?

**Scoring rubric (0.0 – 1.0):**
- Attribution is per closed gap, recorded at closure time.
- A gap closure is "methodology-driven" if: (a) the gap was surfaced via a simulated-user
  or directive lifecycle step, AND (b) the fix was authored via `quay:author`/`quay:execute`
  Skill invocation, AND (c) the result was subject to G3 audit.
- A gap closure is "ad-hoc" if it bypassed any of (a)/(b)/(c) — e.g., direct code edits
  without Skill authoring, gaps noticed inline rather than through the feedback loop, or
  fixes not submitted to G3.
- Score = (# methodology-driven closures this iteration) / (total closures this iteration).
- **Anti-inflation rule (G2 preserved):** invoking a Skill as a wrapper around code the
  executor would have written anyway does not count as methodology-driven. The Skill must
  have shaped the design decision, not merely been called as ceremony.
- If zero gaps closed this iteration, methodology_leverage = last iteration's value (carry).

#### 2. `strategy_completeness` (redefines `completeness`)

**Question:** Does the current Skill set cover strategy formation — deciding what to work
on next under an open-ended objective — not just execution of known objectives?

**Scoring rubric (0.0 – 1.0):**
- A Skill covers strategy formation if it explicitly addresses: (a) selecting the highest-
  value gap from a heterogeneous backlog, (b) encoding the "iteration feedback → next-priority"
  loop (simulated-user findings → gap list → directive lifecycle → work selection), and
  (c) pause/resume/convergence decisions without a fixed "Done when" target.
- Score assessed against a checklist of strategy-formation capabilities needed for this
  experiment's objective. Capabilities present and exercised = 1.0 contribution; missing or
  documented but not exercised = 0.0 contribution. Score = fraction of capabilities covered.
- Capabilities checklist (6 items, equal weight):
  1. Gap-list management (add, close, prioritize) — documented and exercised
  2. Directive lifecycle (pending → apply → archive) — documented and exercised
  3. Simulated-user feedback → priority translation — documented and exercised
  4. Open-ended objective tracking without fixed "Done when" ceiling — documented and exercised
  5. PAUSE/resume/convergence check — documented and exercised
  6. Cross-surface strategy (CLI + MCP + Web UI + packaging + docs in same iteration) — documented and exercised

#### 3. `transfer_breadth` (redefines `reusability`)

**Question:** Has the methodology transferred consistently across quay's CURRENT surface
types — CLI, MCP, Web UI, packaging/distribution, docs?

**Scoring rubric (0.0 – 1.0):**
- Five surface types in scope: CLI, MCP (MCP server), Web UI, packaging/distribution, docs.
- For each surface: has this experiment's methodology (gap-list, directive lifecycle,
  simulated-user, quay:author/execute) been applied to at least one meaningful change?
- Score = (# surfaces with methodology-driven changes) / 5.
- "Methodology-driven change" requires at least one: (a) gap sourced from simulated-user
  or directive lifecycle for that surface, AND (b) corresponding QX task authored and
  executed via native methodology path.
- This is a live, non-frozen question: adding a new surface type expands the denominator;
  neglecting a surface for multiple iterations degrades the score.

#### 4. `validation` (unchanged)

σ_QX = (# QX-* tasks with all three provenance fields = native) / (# QX-* tasks done).

**Same formula, same G3 independence requirement as the old formula.** Not redesigned.

### New ceiling

```
V_meta_ceiling_new = 1.0 × 1.0 × 1.0 × 1.0 = 1.0
```

**All four factors can reach 1.0.** V_meta ≥ 0.80 is now achievable in principle.

---

## Re-baseline at iteration 14 (non-retroactive)

The re-baseline scores the new formula honestly against experiment 4's current state
at the moment of adoption. It does NOT retroactively rescore iterations 1–13 using the
new formula.

### Scoring rationale

#### `methodology_leverage` at iteration 14 re-baseline

Looking at iterations 1–13 cumulatively as the adoption-point evidence:

- **Gap sourcing:** All 67 closed gaps came through the gap-list mechanism, and the majority
  were surfaced by simulated-user passes (which ran every iteration as mandated) or direct
  observation. The directive lifecycle (DIR-004 through DIR-009) sourced 6+ significant
  changes. This is genuinely methodology-driven gap discovery.
- **Execution path:** However, the execution path was mixed. The `quay:author`/`quay:execute`
  Skill was NOT the primary driver of individual code changes — changes were authored
  inline by the iteration-executor agent, with the Skill providing framing but not design
  decisions. The worktree isolation (PR-001/002/003) compliance fixes in iteration 13 were
  process compliance driven by directive enforcement, not capability improvements surfaced
  through the Skill's design loop.
- **Honest assessment:** Approximately 60% of closures were methodology-sourced (gap
  discovered through methodology loop) but only ~30–40% were methodology-executed (the
  Skill's design loop shaped the implementation, not just the ticketing). The higher standard
  (both sourcing AND execution) applies per G2.

**Score: 0.40** — honest attribution. The methodology drove gap discovery well; it drove
implementation design less consistently. This is a genuine finding, not a failure mode to
paper over.

#### `strategy_completeness` at iteration 14 re-baseline

Evaluating against the 6-item checklist:

1. Gap-list management — documented and exercised: **YES** (gap-list.md, every iteration)
2. Directive lifecycle — documented and exercised: **YES** (DIR-004 through DIR-009 all processed)
3. Simulated-user → priority translation — documented and exercised: **YES** (every iteration, explicit gap entries)
4. Open-ended tracking without fixed ceiling — documented and exercised: **YES** (ΔV primary signal, no fixed "Done when")
5. PAUSE/resume/convergence check — documented and exercised: **YES** (PAUSE triggered and explicitly managed)
6. Cross-surface strategy in same iteration — documented but NOT consistently exercised: **PARTIAL** — iterations 1–5 focused on CLI/MCP/Web UI together, but iterations 12–13 focused on narrower clusters (CLI formatting, UI polish) without cross-surface strategy.

**Score: 5/6 = 0.83** — five of six capabilities documented and exercised; cross-surface coverage inconsistent in recent iterations.

#### `transfer_breadth` at iteration 14 re-baseline

Evaluating against the 5 surface types:

1. **CLI** — methodology-driven changes: YES (QX-002, QX-005, QX-006, QX-022, many more)
2. **MCP** — methodology-driven changes: YES (QX-003, QX-029, QX-030, QX-031, QX-032)
3. **Web UI** — methodology-driven changes: YES (QX-004, QX-009 through QX-019, QX-020–027, many more)
4. **Packaging/distribution** — methodology-driven changes: YES (QX-033 via DIR-004, iteration 9 — but only ONE significant change, and CB-008 was declared "applied" though DIR-004 remains deferred for Node SEA work)
5. **Docs** — methodology-driven changes: PARTIAL (QX-027 doc staleness fix, QX-036 README restructure — surfaced by simulated-user and executed; but documentation coverage has been thin and irregular across iterations)

**Score: 3.75/5 = 0.75 (FINAL — revised in synthesis)** — CLI, MCP, and Web UI well-covered; packaging/distribution present but thin (one change, primary Node SEA work deferred); docs thin and irregular (QX-027/QX-036 are genuine methodology-driven changes but coverage has been sparse across 14 iterations). Provisional score was 4/5 = 0.80; downward correction made in iteration-14 synthesis after Persona C (cross-experiment maintainer) flagged the inconsistency between "covered" scoring and "thin and irregular" rationale for the docs surface. Honest revision: docs receive 0.75 credit (3.75/5 total → 0.75), not full credit. See synthesis note below.

#### `validation` at iteration 14 re-baseline

After closing QX-001 (now done, but seed provenance = 0 contribution) and adding QX-050 through QX-055 (all native):

σ_QX = 51/52 = **0.981**

Denominator: QX-001 through QX-055 done = 52 tasks (QX-001 seed + 51 native). Wait: QX-001 was seed (0 contribution); QX-002 through QX-049 = 48 native tasks (all done); QX-050 through QX-055 = 6 new native tasks. Total done: 1 (seed) + 48 + 6 = 55. Wait — recount:

- QX-001: seed (not native) — 1 task
- QX-002 through QX-049: 48 tasks, all native (done)
- QX-050 through QX-055: 6 tasks, all native (done this iteration)
- Total done: 55 tasks
- Native: 54 tasks
- σ_QX = 54/55 = **0.982**

Note: iteration-13 final had σ = 45/46 = 0.978 (45 native, 1 seed = 46 total done). After QX-050..055 (6 native) and QX-001 closure (seed, now done): 45+6 native = 51 native; 46+6+1 = 53 total. σ = 51/53 = 0.962.

Recalculating carefully:
- Before iteration 14: 45 native tasks done, 1 seed task done (QX-001 was todo) = 46 total done tasks with 45 native → σ = 45/46.
- This iteration: QX-001 closed (seed) + QX-050..055 closed (6 native) = 7 new done tasks.
- After: 45 + 6 = 51 native done; 46 + 7 = 53 total done.
- **σ_QX = 51/53 = 0.962** (provisional — QX-055/001 closure changes the denominator by adding QX-001 as seed).

Actually: QX-001 was already counted in the denominator at σ=45/46 only if it was `done`. But per gap-list entry UQ-039 it was at `todo` status, NOT done. So QX-001 was NOT in the denominator before. Now it's done (seed). After: 51 native / 53 total = 0.962.

**σ_QX (iteration 14 provisional) = 51/53 = 0.962**

### Synthesis-phase downward correction (iteration 14 FINAL)

Persona C (cross-experiment maintainer) in the iteration-14 synthesis review identified that `transfer_breadth = 0.80` was scored as "covered" for the docs surface while the rationale simultaneously described docs coverage as "thin and irregular across iterations." This inconsistency was flagged as "borderline honest inflation: honest in that it flags the weakness, but still claims the point."

The synthesis agent adopted a downward correction: docs surface is scored at 0.75 credit (not 1.0) within the 5-surface denominator, giving transfer_breadth = 3.75/5 = 0.75 rather than 4/5 = 0.80. This is the correct basis for the FINAL re-baseline since the re-baseline itself is being finalized at synthesis time, and Persona C's review is the intended mechanism for catching provisional over-scoring before values are trusted.

**transfer_breadth: 0.80 (provisional) → 0.75 (FINAL)**

### Re-baseline formula value

```
V_meta_new (iteration 14 re-baseline, PROVISIONAL):
  = 0.40 × 0.83 × 0.80 × 0.962 = 0.255

V_meta_new (iteration 14 re-baseline, FINAL — post-synthesis correction):
  = 0.40 × 0.83 × 0.75 × 0.962

  0.40 × 0.83  = 0.332
  0.332 × 0.75 = 0.249
  0.249 × 0.962 = 0.23954

  = 0.240
```

---

## Non-comparability statement

**ΔV_meta across the formula switch point is non-comparable.**

- Old formula value at switch point (iteration 13 FINAL): `V_meta_old = 0.154`
- New formula value at re-baseline (iteration 14 FINAL): `V_meta_new = 0.240`
  (Provisional was 0.255; revised in synthesis to 0.240 after transfer_breadth correction 0.80→0.75.)

The increase from 0.154 to 0.240 reflects the redesigned formula, not a real improvement.
The two numbers measure different things with different scales. They MUST NOT be compared
as if V_meta improved by 0.086 between iteration 13 and iteration 14.

From iteration 14 onward, `ΔV_meta` is computed within the new formula only. The
starting point for future ΔV calculations is `V_meta_14 = 0.240`.

---

## G3 audit requirement (per DIR-008)

The metric change itself (not just this iteration's development work) must be subject to
an independent G3 audit checking that the redesign "measures something more real, not
merely something looser." Specifically, G3 must assess:

1. Whether `methodology_leverage` is more honest than the old `effectiveness` (does it
   expose real attribution, or does it paper over ad-hoc work as methodology-driven?)
2. Whether the new factors can actually move over time (are they renewable in practice,
   not just in theory?)
3. Whether the re-baseline is genuinely non-retroactive and properly recorded (does it
   create perverse incentives to game the switch point?)
4. Whether the `transfer_breadth` scoring rubric is specific enough to resist inflation
   (can "methodology-driven docs change" be gamed to claim 5/5 surfaces trivially?)

The G3 co-sign on DIR-008's metric redesign is a prerequisite before V_meta_new values
are treated as trusted. Until G3 co-signs, V_meta_new values are marked PROVISIONAL.

---

## History

| Iteration | Formula | V_meta | Notes |
|-----------|---------|--------|-------|
| 0 | old (inherited) | 0.123 | Inherited from experiment 3 |
| 1 | old | 0.136 | σ_QX rise |
| ... | old | ... | (see provenance.md for full history) |
| 13 (FINAL) | old | 0.154 | Last value under old formula |
| **14 FINAL (re-baseline)** | **new** | **0.240** | **Switch point — non-comparable to prior values. transfer_breadth revised 0.80→0.75 in synthesis (Persona C critique: docs scored "covered" despite thin, irregular coverage). Provisional was 0.255.** |
| **15 FINAL** | **new** | **0.288** | methodology_leverage=0.45 (marginal bump from 0.40; directive lifecycle adherence improved; execution still ad-hoc); strategy_completeness=0.83 (unchanged; item 6 not exercised); transfer_breadth=0.80 (upward revision from 0.75; QX-056 is genuine methodology-driven packaging change, independently verified by G3 and Persona B — packaging surface solidly covered: CLI ✓ MCP ✓ Web UI ✓ packaging ✓ docs ✗ = 4/5); validation=55/57=0.965 (G3 PASS). 0.45×0.83×0.80×0.965=0.288. ΔV_meta=+0.048. |
| **16 FINAL** | **new** | **0.301** | methodology_leverage=0.47 (marginal bump from 0.45; CB-006 multi-surface delivery CLI+Web UI in same iteration; gaps consistently simulated-user-sourced; Persona C confirmed 0.47 honest; execution remains ad-hoc/inline); strategy_completeness=0.83 (unchanged; item 6 requires ALL surfaces — CLI+MCP+Web UI+packaging+docs — MCP not touched this iteration); transfer_breadth=0.80 (unchanged; no new surface coverage: CLI ✓ MCP ✓ Web UI ✓ packaging ✓ docs ✗ = 4/5); validation=57/59=0.966 (G3 PASS). 0.47×0.83×0.80×0.966=0.301. ΔV_meta=+0.013. |
