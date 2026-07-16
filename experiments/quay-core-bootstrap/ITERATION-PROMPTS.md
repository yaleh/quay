# Iteration Prompts — Quay-Core Bootstrap (Experiment 2)

**Experiment**: quay-core-bootstrap
**Protocol**: [`docs/proposals/quay-core-bootstrap-experiment-v2.md`](../../docs/proposals/quay-core-bootstrap-experiment-v2.md) (authoritative — read it before running any iteration)
**Objectives**:
- *Instance* (§4 of protocol): Develop quay Core (`packages/quay`) and continue quay-native to a materially more complete state — four bounded "Done when" items, not an open-ended scope.
- *Meta* (§5 of protocol): Identify and fix the specific reasons experiment 1's `effectiveness`, `reusability`, `completeness`, and `validation` factors stalled, using Core + quay-native development as the proving ground.

**Inheritance baseline** (per §2.1/§5/§6 of protocol — not to be re-derived as if starting from zero):
- V_instance starts from 0 on experiment 2's own four factors (new objectives, no prior work yet).
- V_meta inherits experiment 1's final values: 0.74 × 0.26 × 0.79 × 0.64 = **0.0973**.

**Target**: V_instance ≥ 0.80 AND V_meta ≥ 0.80, all 4 instance "Done when" clauses satisfied, out-of-band audit green.

> Frozen vocabulary applies (`glossary.md`). BAIME terms (`V_instance`, `V_meta`, OCA, `A_n`, `M_n`, `O`) are used verbatim per the `methodology-bootstrapping` skill. The inherited methodology artifact lives in `.claude/skills/quay-native-methodology/` — read it, never re-derive it.

---

## How to use this document

- **Iteration 0** is fully concrete — execute it as written. Its job is NOT to build a walking skeleton from σ=0 (that was experiment 1's job); it is to confirm the inherited state, establish experiment 2's own baselines, and compute honest starting V scores FROM the inheritance.
- **Iterations 1..k** work toward the 4 instance objectives (§4 of protocol), while watching for V_meta re-trigger conditions from `.claude/skills/quay-native-methodology/reference/v-meta-stall-analysis.md`.
- Every iteration begins with **§0 Preconditions** and ends with the **Convergence Check**. Do not skip either.
- **Task IDs**: all new tasks in this experiment use the `QC-*` prefix — never continue the `QN-*` sequence. These are physically distinguishable populations in `tasks/`.

---

## §0. Preconditions (check before every iteration, from iteration 0 onward)

```
[ ] manda daemon is live for this workspace (http://localhost:28912)
[ ] a live `manda monitor <name> --root .` process is confirmed a DIRECT
    CHILD of the current session's own process tree — use the mechanized
    ps-based procedure from experiments/quay-native-bootstrap/ITERATION-PROMPTS.md
    §0 (G6 operational check); a bare daemon /healthz probe is NOT sufficient
[ ] experiments/quay-core-bootstrap/provenance.md has been read (before iteration 0:
    read the inheritance record already written there; after: confirm current state)
[ ] previous iteration's experiments/quay-core-bootstrap/iterations/iteration-{N-1}.md
    has been read in full
[ ] experiments/quay-core-bootstrap/directives/pending/ has been listed (`ls`) and
    every file in it read; each must reach an explicit applied/deferred/rejected
    outcome this iteration, recorded in this iteration's own report
[ ] The four V_meta re-trigger conditions (from .claude/skills/quay-native-methodology/
    reference/v-meta-stall-analysis.md §"Re-trigger conditions") have been checked
    against this iteration's planned work — do any fire? Record the answer either way.
[ ] (iteration subagent and G3 audit subagent, orchestrator-side) Both dispatches
    confirmed run_in_background=true — see §0a below
```

**DIR-025 explicitly deferred**: manda nested-subagent for concurrent work is not an active practice in this experiment. See `experiments/quay-native-bootstrap/directives/pending/DIR-025-*.md`'s 2026-07-16 progress note. Do not adopt it silently — if a concrete need arises, file a new QC-* directive.

---

## §0a. Non-blocking dispatch (inherited from experiment 1, applies unchanged)

The non-blocking-dispatch requirement (DIR-015 + DIR-016) applies verbatim:
- Both the iteration-executing subagent AND the G3 audit subagent must be dispatched `run_in_background=true` by the orchestrator.
- Neither subagent can observe its own dispatch mode — confirmation is the orchestrator's record, not either subagent's.
- Neither dispatch may default to synchronous mode.

Full text: `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` §0a. Not duplicated here to prevent drift — read that file, not this note.

---

## §0b. Manda nested-subagent guidance (inherited; DIR-025 deferred)

The guidance for manda nested-subagent use in development/testing operations (DIR-015, DIR-017, DIR-020) applies verbatim, including the hard rule: a manda depth-1 caller must never be synchronous same-session-as-broker (DIR-020).

**DIR-025 deferred** means: do not proactively adopt manda nested-subagent for concurrent work as an experiment-wide pattern. Per-task isolated use (where a specific capability is genuinely needed and the preconditions are satisfied) remains possible under the existing §0b guidance. Any such use must satisfy the mechanized preconditions in `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` §0b — do not re-derive them.

---

## Iteration 0: Baseline — inherited state, establish experiment 2's starting scores

**Objective**: Read and confirm the inherited methodology. Measure the current state of each of the 4 instance objectives (§4 of the protocol) to establish experiment 2's own V_instance baseline. Confirm V_meta inherits experiment 1's final values — do NOT re-derive from zero. Record the result in `provenance.md` and `iterations/iteration-0.md`.

**Driver**: Seed (no QC-* tasks have been through native authoring/execution/gating yet). This iteration is primarily observational — any gap-filling work done here is recorded as early seed-provenance evidence, not inflated to native.

**Prompt**:
```
You are running Iteration 0 of the quay-core-bootstrap experiment (experiment 2).
This is NOT a restart from σ=0 — a methodology is inherited, not invented.
Read before doing anything else:

INHERITANCE ARTIFACTS (read all, in order, before starting):
  experiments/quay-core-bootstrap/provenance.md
  experiments/quay-native-bootstrap/EXTRACTION-SUMMARY.md
  .claude/skills/quay-native-methodology/SKILL.md
  .claude/skills/quay-native-methodology/reference/patterns.md
  .claude/skills/quay-native-methodology/reference/v-meta-stall-analysis.md
  .claude/skills/quay-native-methodology/reference/gate-mechanics.md
  .claude/skills/quay-native-methodology/reference/g3-audit-discipline.md

PROTOCOL DOCUMENTS (read in full):
  docs/proposals/quay-core-bootstrap-experiment-v2.md  ← authoritative protocol
  docs/proposals/quay-proposal.md
  docs/proposals/quay-native-design.md
  docs/proposals/glossary.md

MOST RECENT EXPERIMENT 1 STATE (for native_backlog_health baseline):
  experiments/quay-native-bootstrap/CLOSING-REPORT.md
  experiments/quay-native-bootstrap/iterations/ (the highest-numbered iteration-N.md)

Precondition check (§0, G6): confirm manda daemon is live and a monitor process
is a DIRECT CHILD of this session's own process tree (ps-based check, not just
/healthz). Do not proceed until confirmed.

1. CONFIRM THE INHERITANCE BOUNDARY
   Re-read EXTRACTION-SUMMARY.md §"The four stalled V_meta factors" and
   v-meta-stall-analysis.md §"Re-trigger conditions."
   
   State verbatim what you are inheriting:
   - Experiment 1's final V_meta factors: completeness=0.74, effectiveness=0.26,
     reusability=0.79, validation=0.64 (product: 0.0973).
   - The four re-trigger conditions (v-meta-stall-analysis.md). Understand each
     precisely — they are the V_meta watchlist for every subsequent iteration.
   
   For each re-trigger condition: does it fire for THIS iteration's own observations?
   (Almost certainly not at baseline — but check each explicitly and record the answer.)

2. MEASURE EXPERIMENT 2's OWN V_instance BASELINE
   Survey the actual code in packages/quay/ and packages/quay-native/ for each:

   (a) core_abi_symmetry: Does a Core-level ABI symmetry script exist (analogous to
       the Provider-level abi-symmetry.mjs, but covering CLI ⟷ Core MCP ⟷ Web UI)?
       What is its current state vs. the §4 item 1 "Done when" clause? Be specific.
   
   (b) web_ui_verification: Are there any browser-automation-driven tests committed
       for packages/quay's Web UI (chrome-devtools or playwright)? Which pages/flows,
       if any? What fraction of currently reachable pages/flows have at least one test?
   
   (c) action_delivery_mode: Does packages/quay/src/action.js's deliverTrigger() have
       a deterministic mock/log-file recording mode? Is it the default in the test
       harness? Is a live-manda check present as a separate, labeled, non-blocking check?
   
   (d) native_backlog_health: What are experiment 1's final 8 V-factor values for
       quay-native? (Read from CLOSING-REPORT.md or the highest-numbered iteration-N.md.)
       Are any of those factors currently regressed from those values in the codebase?
       (Check the current test suite: run `npm test` or equivalent in packages/quay-native/
       and packages/quay-github/ and observe the result.)

   Compute V_instance = core_abi_symmetry × web_ui_verification × action_delivery_mode
                        × native_backlog_health
   using the factor definitions in §"V_instance for this experiment" in ITERATION-PROMPTS.md.
   Show your work — each factor must have concrete evidence, not a vague estimate.

3. CONFIRM V_meta INHERITED STARTING VALUES — DO NOT RE-DERIVE FROM ZERO
   A first iteration that re-derives low baseline V_meta numbers as if starting fresh
   is a scoring error (protocol §5, explicitly). Instead:
   
   - State the inherited starting values: completeness=0.74, effectiveness=0.26,
     reusability=0.79, validation=0.64, product=0.0973.
   - For `validation`: experiment 2's own σ_QC is 0/0 at iteration 0 (no QC-* tasks
     complete). Document this explicitly. The inherited methodology was validated to
     σ_strict=0.8493 in experiment 1; that is the inheritance floor for `validation`.
     Experiment 2's own QC-* tasks add new validation evidence as they complete.
   - For each of the other three factors: confirm the inherited stall reason still
     holds (cite the specific blocker from v-meta-stall-analysis.md, don't just say
     "same as experiment 1"). Or, if this iteration's own observations indicate a
     re-trigger condition fires, update the factor and show the evidence.

4. CHECK EXPERIMENT 1's OUTSTANDING ITEMS
   Read experiments/quay-native-bootstrap/CLOSING-REPORT.md §"Directive triage."
   For any directive triaged "carried-forward-to-experiment-2": confirm it appears
   in experiments/quay-core-bootstrap/directives/pending/, or file it now if absent.

5. RECORD IN provenance.md
   If any QC-* task was completed in this iteration, add it to provenance.md.
   If iteration 0 is purely observational (no tasks completed): add a narrative
   context note to provenance.md marking the inheritance record as confirmed and
   stating the initial V scores, but do NOT create phantom {QC-000, seed, seed, seed}
   entries for work not actually done.

6. WRITE experiments/quay-core-bootstrap/iterations/iteration-0.md
   Use the 10-section iteration report structure at the bottom of ITERATION-PROMPTS.md.
   
   Convergence Check (expect NOT CONVERGED for all 5 criteria at iteration 0):
   [ ] 1. Dual threshold: NO — V_instance near 0 on factors a/b/c; V_meta = 0.0973
   [ ] 2. All 4 "Done when" clauses: NO — none are complete yet
   [ ] 3. V_meta genuine movement: NO — this iteration establishes the inherited
          baseline; it does not claim movement
   [ ] 4. Out-of-band audit: N/A — no V-factor lift or Core change requiring
          independent adjudication (state explicitly)
   [ ] 5. Diminishing returns: N/A — no prior iteration to compare ΔV against
   Status: NOT CONVERGED.
```

**Expected Output**:
- Confirmed inheritance boundary (V_meta starting values stated; re-trigger conditions known and checked for this iteration).
- V_instance baseline for experiment 2's 4 factors (likely: core_abi_symmetry ≈ 0, web_ui_verification ≈ 0, action_delivery_mode ≈ 0, native_backlog_health ≈ 1).
- V_meta: inherited values stated (not re-derived); stall reasons confirmed or re-trigger conditions noted.
- `experiments/quay-core-bootstrap/iterations/iteration-0.md` with honest assessment and a concrete problem list for each instance objective.
- Convergence Check: NOT CONVERGED (expected and correct at iteration 0).

---

## V_instance for this experiment

```
V_instance = core_abi_symmetry × web_ui_verification × action_delivery_mode × native_backlog_health
```

### `core_abi_symmetry` — instance objective 1 (§4 item 1 of protocol)

Measures how far the Core-level three-way symmetry script is toward its "Done when" clause:
- 0.0: no script exists
- 0.3–0.5: script exists but gaps remain (not all three surfaces — CLI, Core MCP, Web UI — covered; or not in automated suite; or tracked gaps not all filed as tasks)
- 0.8: script exists, covers all Core MCP tools also reachable via CLI and Web UI, runs in automated suite
- 1.0: "Done when" clause fully satisfied — script exists, covers every surface, runs in automated suite, every symmetry gap either closed or explicitly tracked as its own QC-* task (mirroring the Provider-layer `abi-symmetry.mjs` discipline applied one layer up)

### `web_ui_verification` — instance objective 2 (§4 item 2 of protocol)

Measures browser-automation test coverage of `packages/quay` Web UI pages/flows:
- 0.0: no browser-automation tests committed
- 0.5: some pages/flows covered but not all currently reachable ones
- 1.0: "Done when" clause fully satisfied — every page/flow currently reachable in `packages/quay` has at least one committed browser-automation-driven test confirming current behavior; any appearance/interactivity changes discovered along the way are filed as separate QC-* tasks rather than folded in (G5)

### `action_delivery_mode` — instance objective 3 (§4 item 3 of protocol)

Measures the mock/log-file action-delivery recording mode for `deliverTrigger()`:
- 0.0: no recording mode exists; live manda delivery is the only test harness path
- 0.5: recording mode exists but is not the default in the test harness, or the live-manda check is absent as a separate labeled check
- 1.0: "Done when" clause fully satisfied — recording mode exists AND is the default in the CI-equivalent harness (run passes without a live manda daemon) AND at least one live-manda delivery check exists as a clearly-labeled, non-blocking separate check

### `native_backlog_health` — instance objective 4 (§4 item 4 of protocol)

Binary: **1** if none of quay-native's 8 V-factors has regressed below experiment 1's final (stop-time) snapshot values (from `experiments/quay-native-bootstrap/CLOSING-REPORT.md`); **0** if any has regressed.

This factor starts at 1 at iteration 0 (no regressions inherited). It must be re-confirmed every iteration by checking the current test suite against the snapshot. A Core change that silently breaks quay-native must be caught here.

---

## V_meta for this experiment

```
V_meta = completeness × effectiveness × reusability × validation
```

**Formula shape**: inherited unchanged from experiment 1.

**Starting values** (per §5 of protocol — do NOT score these lower at iteration 0 without evidence of genuine regression):

| Factor | Inherited value | Inherited stall reason (from v-meta-stall-analysis.md) |
|---|---|---|
| completeness | 0.74 | Every Method-step gap has explicit resolution annotations except one: no native fresh-context subagent-dispatch primitive (environmental, not a Skill-content gap) |
| effectiveness | 0.26 | No organically-arising, scope-matched marginal-increment timing comparison since iteration 22; manufacturing one would corrupt G2/G5 |
| reusability | 0.79 | GitHub Provider `data.write` blocked by deliberate v1 scope decision (QN-024); independently confirmed at code level (no body/title write path in `github-client.js`) |
| validation | 0.64 | Tracks σ_strict; experiment 1 ended at σ_strict=0.8493, treated as the inheritance floor. Experiment 2's own σ_QC starts at 0/0 — stated separately |
| **V_meta** | **0.0973** | Product of above four |

**What must change** (per §5 of protocol): each factor must show either (a) genuine movement with evidence, or (b) a **different** stalling reason than experiment 1 recorded. Repeating the same stall reason after a supposed refinement is itself a finding (the refinement didn't work) requiring escalation — not a "held flat" note.

### V_meta re-trigger watchlist (check all four, every iteration)

1. **effectiveness re-trigger**: did any QC-* task arise that is organically scope-matched to stage-0 QN-006's shape (single-file, no/minimal source change, no network I/O)? If yes: measure the timing comparison and update.
   - **Timing baseline confirmed** (iteration 6, primary source):
     `experiments/quay-native-bootstrap/timing/iteration-0.log` — QN-006
     author ~51s (04:23:03→04:23:54), execute ~2m59s (04:24:18→04:27:17).
     Do not re-derive; cite this file directly.
   - **Standing timing-recording instruction** (added iteration 7, carried
     to Skill files): when a scope-matched task arises organically, record
     wall-clock start/end times for each Method phase (write-proposal,
     review-proposal, write-plan, review-plan, implement, gate) in the
     iteration report. This is the precondition for firing this re-trigger.
2. **reusability re-trigger**: did organic external demand appear for wider GitHub Provider `data.write` capability (AC/DoD-checkbox or body/title writes against a real issue, not a legacy fixture)? If yes: re-open.
3. **completeness re-trigger (gap discovery)**: was a new, previously-undocumented Skill Method-step gap found during *unrelated* work on the Skill files? If yes: re-open.
4. **completeness + reusability/effectiveness joint re-trigger**: did a reliable, unconditional native fresh-context subagent-dispatch primitive become available (not the conditional async/background workaround from iterations 78-87)? If yes: re-open completeness, and reusability/effectiveness jointly against full design-§5 fidelity.
   - **Manda conditional primitive reliability track record** (as of
     iteration 8): 6/6 calls SUCCESS across six distinct task types:
     - Trivial (PONG echo): 1/1, 90s timeout, iteration 4
     - Medium (file read + structured JSON verdict): 1/1, 150s, iteration 5
     - Complex (multi-file + adversarial + verdict): 1/1, 150s, iteration 6
     - Documentation-reading (read provenance.md, return structured JSON):
       1/1, 150s, iteration 8 (~107s wall-clock)
     - Computation (arithmetic, return JSON): 1/1, 150s, iteration 8 (~20s)
     - Code-reading (read store.js, line count + first function): 1/1,
       150s, iteration 8 (~28s)
     The primitive remains **conditional** (daemon live + non-self broker
     required per DIR-020). Conditionality is unchanged; reliability is now
     empirically confirmed across six calls with no failures. This does NOT
     close the completeness gap (requires unconditional), but narrows the
     characterization from "unknown reliability" to "confirmed reliable
     conditional primitive." See §Completeness ceiling assessment below.
5. **Fallback rule**: if none of 1-4 fire within roughly 12 iterations of experiment 2, run one more dedicated full search rather than letting the standing-fact note calcify.

**Completeness ceiling assessment** (established iteration 8): The manda
conditional primitive has accumulated 6/6 successful calls across diverse
task types. The remaining completeness gap is **conditionality only** —
daemon + non-self broker are required preconditions. The gap is not
reliability (6/6 across 6 tiers confirms reliable operation). This
distinction matters for honest scoring: additional reliability trials beyond
6/6 do not move completeness, because the blocker is the unconditional/
conditional distinction, not the reliability track record.

**Validation mechanics**: report two numbers separately every iteration —
- *Inherited floor*: σ_strict = 0.8493 (experiment 1's final value; this is the baseline the inheritance gives)
- *Experiment 2's own*: σ_QC = (# QC-* tasks with all three fields = native) / (total QC-* tasks)

`validation` score tracks experiment 2's own σ_QC as it grows; the inherited floor is context, not a substitution.

---

## Iterations 1..k: Work toward instance objectives (template)

**Objective (recurring)**: Advance one or more of the 4 instance objectives toward their "Done when" clauses. Watch for V_meta re-trigger conditions. Update `provenance.md` with any newly completed QC-* tasks. Do not pre-plan which objective to advance in which order — that emerges from each iteration's observed state.

### Context extraction (do this first, every iteration)

```
Read, in full, before doing anything else:
  experiments/quay-core-bootstrap/iterations/iteration-{N-1}.md  — prior state, V scores, problems
  experiments/quay-core-bootstrap/provenance.md                   — current QC-* task provenance
  experiments/quay-core-bootstrap/audits/                         — prior adjudicate sign-offs
  .claude/skills/quay-native-methodology/reference/v-meta-stall-analysis.md  — re-trigger watchlist
  packages/quay-native/skills/author/SKILL.md                     — inherited Layer-2 Skills (fresh read)
  packages/quay-native/skills/execute/SKILL.md

Extract:
  - current σ_QC (recompute from provenance.md QC-* entries only; do not mix with QN-*)
  - which instance objective is closest to its "Done when" clause, with specific evidence
  - the specific problems iteration {N-1} identified as blocking progress
  - whether any V_meta re-trigger condition fired last iteration or is imminent
  - any new QC-* directives in experiments/quay-core-bootstrap/directives/pending/
```

### Lifecycle capability-reading protocol (inherited, unchanged)

- Read all relevant Skill definitions before the iteration starts (even ones not expected to be touched — drift is caught this way).
- Re-read the specific Skill/capability being modified immediately before using it.
- Read `.claude/skills/quay-native-methodology/reference/` files fresh each iteration (especially `v-meta-stall-analysis.md`) — no caching of prior-iteration readings.

### Iteration cycle (Observe → Codify → Automate → Evaluate → Convergence Check)

```
1. OBSERVE
   - What is the precise current state of each instance objective vs. its "Done when" clause?
     Measure each item (a)-(d) against its specific criterion — not "mostly done" but
     "distance from the exact acceptance condition."
   - Which gap specifically blocks the natural next advance? (Cite {N-1}'s problem list;
     do not invent a new gap without evidence.)
   - Which V_meta re-trigger conditions apply to the planned work? Check all four.
   - What does the QC-* task backlog show? (`quay-native task list` or file-based survey.)

2. STRATEGY FORMATION
   - Choose the smallest increment that advances one instance objective toward its
     "Done when" clause. One clear objective per iteration.
   - If the chosen increment organically bears on a V_meta re-trigger condition (e.g.
     a scope-matched task providing timing data; a GitHub Provider write exercise):
     note this now and plan to record the evidence at EVALUATE time.
   - Do NOT manufacture V_meta evidence (G2/G5) — but do not ignore genuine organic
     evidence either.
   - For any work touching packages/quay: read §Core-scope constraints below first.

3. EXECUTION
   - Drive the chosen QC-* task(s) using the inherited Skill set where possible
     (quay:author / quay:execute). Record provenance honestly:
     {author_by, execute_by, gate_by} ∈ {seed, native}.
   - Seed-driven or ad-hoc work is recorded as seed provenance — never back-filled
     to native to inflate σ_QC.
   - For any Core (packages/quay) change: G3 out-of-band audit is mandatory per
     §Core-scope constraints item 5.

4. EVALUATE — compute both V's from evidence gathered this iteration

   V_instance = core_abi_symmetry × web_ui_verification × action_delivery_mode × native_backlog_health
   - Re-check ALL four factors, not just the one touched. Regressions in
     native_backlog_health (broken quay-native tests from a Core change) are
     possible and must be caught here.
   - Show the before/after for any factor that moved.

   V_meta = completeness × effectiveness × reusability × validation
   - For EACH factor:
     * Check the re-trigger watchlist item for that factor.
     * If a trigger fired: update with evidence and show the movement.
     * If no trigger fired: state the inherited stall reason explicitly (not just
       "still the same" — cite the specific blocker from v-meta-stall-analysis.md).
   - Stall diagnosis: is the current stall reason the SAME as experiment 1 recorded,
     or a new one? (A new reason is still useful data; repeating the same reason
     without noting it is a reporting failure.)
   - Report σ_QC (experiment 2's own) and the inherited floor (0.8493) separately.

5. OUT-OF-BAND AUDIT (G3 — mandatory for any Core change or V-factor lift)
   - Dispatch an independent epicd `adjudicate` pass via the native Agent/Task tool
     (run_in_background=true per §0a), not by the session that authored/executed the task.
   - Write the verdict to experiments/quay-core-bootstrap/audits/iteration-{N}-adjudicate.md.
   - If G3 finds problems: the V-factor lift for the affected tasks does not count;
     fix and re-audit before claiming the lift.
   - If no Core change and no V-factor lift this iteration: explicitly state "G3 not
     triggered this iteration" rather than silently omitting the step.

6. CONVERGENCE CHECK — all 5 criteria, every iteration, no partial credit:
   [ ] 1. Dual threshold: V_instance ≥ 0.80 AND V_meta ≥ 0.80
   [ ] 2. All 4 "Done when" clauses (§4 of protocol): each independently satisfied
          with evidence (not "mostly" — the literal "Done when" wording)
   [ ] 3. V_meta genuine movement: ≥2 of the 4 stalled factors show real movement,
          with a DIFFERENT stalling reason (if still flat) than experiment 1 documented
   [ ] 4. Out-of-band audit (G3) green: all Core and V-lift tasks have adjudicate
          co-signs in experiments/quay-core-bootstrap/audits/
   [ ] 5. Diminishing returns: ΔV < 0.02 for 2+ consecutive iterations on BOTH
          V_instance and V_meta
   Status: NOT CONVERGED unless all five are YES with evidence.

7. Write experiments/quay-core-bootstrap/iterations/iteration-N.md (10-section structure below).

8. Evolution guidance (for the Skill set A_n and methodology M_n):
   - Evolve a Skill/methodology element only when: retrospective OBSERVE evidence
     demonstrates a gap + a documented alternative was attempted and failed.
   - For any methodology change: state explicitly (a) which V_meta factor it targets,
     (b) which inherited stall reason it addresses, (c) how the resulting movement
     will be distinguishable from merely re-measuring the same inherited stall.
   - Do NOT evolve on: pattern-matching to what "seems complete," anticipatory design,
     or theoretical completeness alone.
```

---

## §Convergence criteria for this experiment

All five, every iteration, no partial credit:

1. **Dual threshold**: V_instance ≥ 0.80 AND V_meta ≥ 0.80.
2. **All 4 "Done when" clauses** (protocol §4 items 1–4): each independently satisfied with direct evidence — not "nearly," not "in spirit."
3. **V_meta genuine movement**: ≥2 of the 4 stalled factors show real, evidence-backed movement FROM the inherited 0.0973 baseline. If a factor is still flat, its current stall reason must differ from experiment 1's — a repeat of the same reason is itself a finding (the methodology refinement didn't work) requiring escalation.
4. **Out-of-band audit (G3) green**: all Core-touching and V-factor-lift tasks have independent adjudicate co-signs in `experiments/quay-core-bootstrap/audits/`.
5. **Diminishing returns**: ΔV < 0.02 for 2+ consecutive iterations on BOTH V_instance and V_meta.

Note: experiment 1's σ→1 fixpoint criterion is **not** the convergence signal here — this experiment's convergence is defined by the 4 instance "Done when" clauses and V_meta genuine movement, not by a self-hosting fixpoint. Quay-native's self-hosting loop is inherited infrastructure for this experiment, not its object.

---

## §Core-scope constraints (inherited verbatim, apply to every iteration touching `packages/quay`)

These constraints carry over from `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` §Core-scope work (established iteration 29 / DIR-008 / DIR-013). Read the underlying reasoning there; only the operative constraints are listed here.

1. **Terminology discipline**: keep "MCP" (Provider ABI transport: `quay-native mcp`, `quay-github mcp`, `quay mcp`) and "browser-automation tooling (chrome-devtools / playwright MCP)" unambiguous — never use bare "MCP testing" where both meanings could apply.

2. **G5 for Web UI verification**: `packages/quay/src/serve.js`'s Web UI is "crude but real." Scope browser-automation verification to confirming *existing* behavior only — do not improve appearance or interactivity as a side effect of a verification pass. Any improvement discovered belongs in a separate, explicitly scoped QC-* task.

3. **Manda-investigation reuse discipline**: iterations 13-18 of experiment 1 established the reliability envelope for manda dispatch. Cite `experiments/quay-native-bootstrap/directives/archive/DIR-004-*.md` and `DIR-005-*.md` rather than re-discovering from scratch. Do not make automated test pass/fail hinge on live manda delivery succeeding.

4. **V-factor attribution for Core work**: new Core capability code → `core_abi_symmetry`; new Core CLI/MCP schema-symmetry proof (extending the discipline from `abi-symmetry.mjs` one layer up) → `core_abi_symmetry`; new Core gate-logic change → inherited `gate_correctness` (tracked via `native_backlog_health`). Do not attribute Core structural work to `effectiveness` — that factor has specific, narrow evidentiary requirements.

5. **G3 extends to Core** (DIR-013): any task touching `packages/quay` source files (`mcp-server.js`, `serve.js`, `bin/quay.js`, `provider-env.js`, `action.js`, `config.js`, `provider-client.js`, or any new Core source) requires the same independent adjudicate dispatch as a Provider-layer change. No self-certification exemption for Core code on the theory that it is "infrastructure."

---

## §Inherited methodology constraints

The following mechanics are inherited from `.claude/skills/quay-native-methodology/` and apply as-is. Do not re-derive — read the source files.

- **Gate mechanics** (`reference/gate-mechanics.md`): `task check` / `checkGate()` — artifact-completeness + checked-state + recursive children-done. The "presence not checked-state" (iteration 7/8) and "one-level-deep children" (iteration 6/7) regressions were already found and fixed — do not reintroduce them.
- **Directive lifecycle** (`reference/directive-lifecycle.md`): pending → archive, one-time consumed, never silently dropped. This experiment's own directives live in `experiments/quay-core-bootstrap/directives/` — experiment 1's pending directives (DIR-021, DIR-025) stay in `experiments/quay-native-bootstrap/directives/pending/` and are not repeated here.
- **G3 out-of-band audit discipline** (`reference/g3-audit-discipline.md`): native Agent/Task tool (not manda) is the permanent G3 mechanism. Three caught overclaims in experiment 1 (iterations 29, 59, 61) demonstrate this guardrail finds real problems. Treat it as genuinely independent — not a formality.
- **Layer-1/Layer-2 Skill structure** (`reference/patterns.md` §"Layer-1 / Layer-2"): the inline, degraded-fallback structure is the proven artifact — do not assume a cleaner split is "just not yet built." Re-verify any subagent-dispatch assumption live before building on top of it.

---

## Iteration report structure

```markdown
# Iteration N: [title — which instance objective was targeted and what work was done]

**Date**: YYYY-MM-DD
**Driver**: [seed | quay:author + quay:execute (native) | mixed — specify per task]
**Instance objectives advanced**: [which of items 1–4, or "none — observational"]
**V_meta triggers checked**: [which of 4 re-trigger conditions were checked; any fired?]

## 1. Context from prior iteration
[σ_QC before, V scores before, which instance objective was targeted, problems inherited]

## 2. Preconditions checked
[§0 checklist — every item, confirmed or explicitly N/A; G6 ps-output as evidence]

## 3. Observe
[Precise state of each instance objective vs. its "Done when" clause; V_meta re-trigger
check results; gap analysis; evidence for what blocks the next advance]

## 4. Strategy
[The one advance chosen; why; whether it organically bears on any V_meta factor]

## 5. Execution
[What was actually built/run — cite real runs and outputs, not projections]

## 6. Provenance update
[Per-QC-* task {author_by, execute_by, gate_by} diffs this iteration;
σ_QC before → after; inherited floor (0.8493) noted separately]

## 7. V_instance
- core_abi_symmetry: 0.XX — [evidence against "Done when" clause; specific gap remaining]
- web_ui_verification: 0.XX — [pages/flows covered vs. total reachable]
- action_delivery_mode: 0.XX — [recording mode status; CI-default status; live check status]
- native_backlog_health: 0 or 1 — [compared to experiment 1's final snapshot values]
- **Total**: 0.XX (product of the four factors)

## 8. V_meta
- completeness: 0.XX — [re-trigger check: condition 3 or 4 fired? If not: cite specific inherited blocker]
- effectiveness: 0.XX — [re-trigger check: condition 1 fired? If not: cite specific inherited blocker]
- reusability: 0.XX — [re-trigger check: condition 2 fired? If not: cite specific inherited blocker]
- validation: 0.XX — [experiment 2's σ_QC = X/Y; inherited floor = 0.8493/0.64]
- **Total**: 0.XX
- **ΔV_meta from inherited baseline** (0.0973): [+/–]0.XX
- **Stall diagnosis**: [for any factor still flat — is the stall reason SAME as experiment 1, or new?]

## 9. Out-of-band audit
[adjudicate verdict; link to experiments/quay-core-bootstrap/audits/iteration-N-adjudicate.md;
OR: "G3 not triggered this iteration — no Core change, no V-factor lift" (state explicitly)]

## 10. Convergence Check
- [ ] 1. Dual threshold (V_instance ≥ 0.80 AND V_meta ≥ 0.80): [evidence]
- [ ] 2. All 4 "Done when" clauses: [each item's status with direct evidence]
- [ ] 3. V_meta genuine movement (≥2 factors, different stall reason): [evidence]
- [ ] 4. Out-of-band audit (G3) green for all Core/lift tasks: [evidence]
- [ ] 5. Diminishing returns (ΔV < 0.02 for 2+ iterations, both V's): [evidence]

**Status**: NOT CONVERGED | CONVERGED

## Problems identified for next iteration
[concrete, evidence-based — feeds directly into the next iteration's context extraction]
```

---

## Execution guidance

- **Perspective**: you are simultaneously developing quay Core and refining the inherited methodology. Keep both visible in the writeup — do not silently focus on only one or collapse them together.
- **Rigor**: honest dual-layer calculation, every factor grounded in evidence from this iteration. The V_meta stall is structural — don't inflate to paper over the inheritance, but don't let the structural explanation become an excuse for not searching.
- **V_meta honesty**: the inherited starting value is 0.0973. Neither defend it nor treat it as a floor to protect. Each iteration must either show movement with evidence or document a different, more specific stall reason.
- **Thoroughness**: no token-limit shortcuts. A partial provenance update or a partial audit is worse than a smaller iteration scope.
- **Authenticity**: the 4 instance "Done when" clauses define the work. Do not expand scope beyond them (gold-plating) or collapse below them (skipping).

### Common mistakes specific to this experiment

- **Re-deriving V_meta from zero** (scoring V_meta < 0.0973 at iteration 0 without evidence of genuine regression) — a scoring error per §5 of the protocol.
- **Inflating V_meta on Core implementation work** — claiming a Core change moved `effectiveness` or `reusability` without checking the specific re-trigger conditions those factors require. Core work is not a substitute for scope-matched timing data or organic GitHub Provider write demand.
- **Letting native_backlog_health silently regress** — Core changes can break quay-native indirectly. Run the quay-native and quay-github test suites after every Core change.
- **Filing G3 as a formality** — three caught overclaims in experiment 1 show the audit finds real problems. Treat it as genuinely independent.
- **Mixing QC-* and QN-* task populations** — experiment 2's provenance tracks QC-* tasks only. New experiment-2 tasks (including quay-native continuation work) get QC-* IDs, never a continuation of the QN-* sequence.
- **Assuming DIR-025 is available** — manda nested-subagent for concurrent work is explicitly deferred. Do not build workflows that implicitly depend on it without filing a new directive first.
- **Letting the 12-iteration fallback lapse** — if no V_meta re-trigger fires within 12 consecutive iterations, run a dedicated full search. This is a standing obligation, not a suggestion.
