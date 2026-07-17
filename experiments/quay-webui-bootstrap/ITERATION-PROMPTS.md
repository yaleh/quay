# Iteration Prompts — Quay Web UI Bootstrap (Experiment 3)

**Experiment**: quay-webui-bootstrap
**Protocol**: [`docs/proposals/quay-webui-bootstrap-experiment-v3.md`](../../docs/proposals/quay-webui-bootstrap-experiment-v3.md) (authoritative — read it before running any iteration)
**Objectives**:
- *Instance* (§4 of protocol): Develop `packages/quay`'s Web UI into genuine functional and visual/design quality — four factors, multiplied: `ui_read_capability × visual_design_quality × verified_by_construction × backlog_health`, plus an explicit parallel-advancement stall guard (§4.5).
- *Meta* (§5 of protocol): Test whether the inherited methodology (Skill files, directive lifecycle, provenance/gate mechanics, G3-style audit discipline) transfers to frontend/visual/UX-shaped work, where completion criteria are inherently softer than backend logic correctness — and, if adaptation is needed (the independent holistic visual-review mechanism, §4.2, has no precedent in experiments 1/2), record concretely what had to change.

> **STATUS AT TIME OF WRITING THIS FILE**: none of `docs/proposals/quay-webui-bootstrap-experiment-v3.md` §7's five preconditions are satisfied yet (precondition 4 — this directory's scaffold — is partially done; `ITERATION-PROMPTS.md` itself is being written as part of completing precondition 4/getting ready for precondition 5). **Iteration 0 has NOT run.** This document must not be read as implying the experiment has started. A human must explicitly authorize starting iteration 0 (§7 precondition 5) after preconditions 1–4 are confirmed satisfied.

**Inheritance baseline** (per §2, §5, §6 of protocol — not to be re-derived as if starting from zero):
- **V_instance** starts from 0 on experiment 3's own four factors (new objectives, no prior UI-quality work credited yet — the existing three routes' *functional* baseline is inherited as a starting point for measurement, not as pre-earned V_instance credit).
- **V_meta does NOT reset to zero.** It continues from wherever `quay-core-bootstrap` (experiment 2) holds it at its own stopping point. Experiment 2 **halted at iteration 10 with practical convergence accepted (NOT formally CONVERGED)**:
  ```
  V_meta = completeness × effectiveness × reusability × validation
         = 0.77 × 0.26 × 0.79 × 0.64 = 0.1012
  ```
  This is experiment 3's **inherited starting V_meta**, exactly as experiment 2 inherited experiment 1's `0.0973` starting value. See `experiments/quay-core-bootstrap/iterations/iteration-10.md` §8, §11 and `.claude/skills/quay-core-bootstrap-methodology/SKILL.md` "Status" section for the authoritative citation — do not re-derive these numbers from scratch.
- **σ resets to a fresh count** scoped to experiment 3's own task population, using the **`QW-*`** prefix (quay-Web) — distinct from experiment 1's `QN-*` and experiment 2's `QC-*`. σ_QW starts at 0/0. Per `.claude/skills/quay-core-bootstrap-methodology/reference/sigma-inherited-floor-trap.md`, experiment 3 MUST make an **explicit, recorded, design-time choice** about the `validation` factor's relationship to the inherited `σ_strict` floor rather than letting it default silently — see "σ_QW and the inherited floor" section below.

**Target**: V_instance ≥ 0.80 AND V_meta ≥ 0.80, all instance "Done when" clauses (§4.1–§4.4 of protocol) satisfied, parallel-advancement stall guard (§4.5) never in an unexplained-violation state, out-of-band audit green, independent holistic visual review green for every page/flow claimed under `visual_design_quality`.

> Frozen vocabulary applies (`glossary.md`). BAIME terms (`V_instance`, `V_meta`, OCA, `A_n`, `M_n`, `O`) are used verbatim per the `methodology-bootstrapping` skill. The inherited methodology artifacts live in `.claude/skills/quay-native-methodology/` (Layer-1/Layer-2 Skill mechanics, gate mechanics, directive lifecycle, G3 audit discipline — read these, never re-derive them) and `.claude/skills/quay-core-bootstrap-methodology/` (the experiment-2 delta: manda daemon address bug, G3-dispatch-drift case study, manda reliability envelope, V_meta ceiling diagnostic, σ-vs-floor trap — read this skill's SKILL.md first, then its `reference/` files as needed). This document does not repeat either skill's content; it cites and applies it.

---

## How to use this document

- **Iteration 0** is fully concrete — execute it as written, once a human has authorized starting it (§7 precondition 5 of the protocol). Its job is NOT to build UI capability from σ=0 in the sense of methodology (that was experiment 1's job); it is to confirm the double inheritance (methodology AND a continuing V_meta baseline), establish experiment 3's own V_instance baseline against the four "Done when" clauses, and record an honest starting point.
- **Iterations 1..k** work toward the four instance objectives (§4 of protocol) in parallel — the product formula and the explicit stall guard (§4.5) both exist to prevent one of `ui_read_capability` / `visual_design_quality` racing ahead of the other. Watch for V_meta re-trigger conditions inherited from `.claude/skills/quay-native-methodology/reference/v-meta-stall-analysis.md`, now additionally informed by experiment 2's ceiling/floor findings.
- Every iteration begins with **§0 Preconditions** and ends with the **Convergence Check**. Do not skip either. Two new required checks not present in experiment 2's §0 are baked in from iteration 0: the daemon-address-from-file rule (correcting the experiment-2 bug) and the parallel-advancement stall-guard check.
- **Task IDs**: all new tasks in this experiment use the **`QW-*`** prefix — never continue the `QN-*` or `QC-*` sequences. These are three physically distinguishable populations in `tasks/`.
- **G3 audit dispatch — correct from iteration 0, not rediscovered**: the out-of-band audit is dispatched by the **orchestrator**, using the **native Agent/Task tool** — **never** via manda nested-subagent, and **never** from inside the iteration-executor's own session. This was already correct in experiment 2's protocol text but drifted in practice for three iterations before a directive (DIR-003) corrected it — see `.claude/skills/quay-core-bootstrap-methodology/reference/g3-audit-dispatch-drift-case-study.md`. Experiment 3 must not repeat that drift. Treat "which tool/dispatcher combination is authoritative" as something to re-state at the start of every iteration, not something assumed to be remembered.

---

## §0. Preconditions (check before every iteration, from iteration 0 onward)

```
[ ] manda daemon address read LIVE from .manda/hub.addr — NEVER hardcode a port.
    (`cat .manda/hub.addr` then `curl -s <that address>/healthz`.) Experiment 2's
    iterations 0-3 recorded three consecutive false-negative "daemon unreachable"
    findings because the probe used a hardcoded port (28912) instead of reading the
    live address — see .claude/skills/quay-core-bootstrap-methodology/reference/
    manda-daemon-address-bug.md. Do not carry that bug forward.
[ ] a live `manda monitor <name> --root .` process is confirmed a DIRECT CHILD of
    the current session's own process tree — use the mechanized ps-based procedure
    from experiments/quay-native-bootstrap/ITERATION-PROMPTS.md §0 (G6 operational
    check); a bare daemon /healthz probe is NOT sufficient
[ ] experiments/quay-webui-bootstrap/provenance.md has been read (before iteration 0:
    read the inheritance record already written there; after: confirm current state)
[ ] previous iteration's experiments/quay-webui-bootstrap/iterations/iteration-{N-1}.md
    has been read in full
[ ] experiments/quay-webui-bootstrap/directives/pending/ has been listed (`ls`) and
    every file in it read; each must reach an explicit applied/deferred/rejected
    outcome this iteration, recorded in this iteration's own report
[ ] The V_meta re-trigger conditions (from .claude/skills/quay-native-methodology/
    reference/v-meta-stall-analysis.md §"Re-trigger conditions", AS REFINED by
    experiment 2's own findings in .claude/skills/quay-core-bootstrap-methodology/
    reference/v-meta-ceiling-diagnostic.md and reference/transfer-test-outcome.md)
    have been checked against this iteration's planned work — do any fire? Record
    the answer either way. If `effectiveness` is still frozen at 0.26 with no fresh
    scope-matched task, RUN THE CEILING DIAGNOSTIC (see "V_meta ceiling" section
    below) before investing further iterations chasing criterion 1 unexamined.
[ ] Parallel-advancement stall guard (protocol §4.5): has EITHER ui_read_capability
    OR visual_design_quality shown NO movement for 3 or more consecutive iterations
    while the other factor advanced? If yes: this iteration's report MUST explicitly
    justify why (not merely note it) — treat an unexplained one-sided run as a
    violation requiring escalation, the same discipline experiment 1 applies to an
    unexplained repeated V_meta stall reason.
[ ] verified_by_construction spot-check (protocol §4.3): does every capability/visual
    change delivered SO FAR (not just this iteration) have a committed
    browser-automation test? This is a continuous requirement, re-checked every
    iteration boundary — a gap here is a factor regression, not merely "still in
    progress."
[ ] backlog_health regression check (protocol §4.4): re-confirm no regression against
    BOTH inherited snapshots — quay-native's 8 V-factors (experiment 1's final
    snapshot) AND quay-core-bootstrap's own V-factors at the state they held when
    experiment 3 started (core_abi_symmetry=1.0, web_ui_verification=1.0,
    action_delivery_mode=1.0, native_backlog_health=1.0, per iteration-10.md §7 —
    cite the specific snapshot, do not assume).
[ ] (iteration subagent and G3 audit subagent, orchestrator-side) Both dispatches
    confirmed run_in_background=true — see §0a below
[ ] (independent holistic visual-review subagent, orchestrator-side) Any visual-review
    dispatch this iteration is a FRESH-CONTEXT agent, dispatched by the orchestrator
    via the native Agent/Task tool — not the same session/context that made the
    visual change, and not via manda — see §0c below
```

**Scope boundary reminder (protocol §3, checked every iteration)**: read-only browsing plus existing action-button triggering only. No task creation/editing from the browser. No new write surface beyond the existing action-button trigger. "Core stays dumb" — no backend-specific conditional rendering (no `if backend === 'github'`, no hardcoded per-backend components). **Any violation is scope creep — file it as a separate task/directive, do not just do it.** This is the same discipline experiment 2's G5 guardrail applies to appearance/interactivity changes discovered during verification-only work, mirrored here for the write-surface boundary.

---

## §0a. Non-blocking dispatch (inherited from experiment 1, applies unchanged)

The non-blocking-dispatch requirement (DIR-015 + DIR-016) applies verbatim:
- Both the iteration-executing subagent AND the G3 audit subagent must be dispatched `run_in_background=true` by the orchestrator.
- Neither subagent can observe its own dispatch mode — confirmation is the orchestrator's record, not either subagent's.
- Neither dispatch may default to synchronous mode.

Full text: `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` §0a. Not duplicated here to prevent drift — read that file, not this note.

---

## §0b. Manda nested-subagent guidance (inherited; DIR-025 deferred; G3 exclusion is absolute)

The guidance for manda nested-subagent use in development/testing operations (DIR-015, DIR-017, DIR-020) applies verbatim, including the hard rule: a manda depth-1 caller must never be synchronous same-session-as-broker (DIR-020).

**DIR-025 deferred** means: do not proactively adopt manda nested-subagent for concurrent work as an experiment-wide pattern. Per-task isolated use (where a specific capability is genuinely needed and the preconditions are satisfied) remains possible under the existing §0b guidance. Any such use must satisfy the mechanized preconditions in `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` §0b — do not re-derive them.

**G3 exclusion is absolute, correct from iteration 0** (net-new emphasis for this experiment, learned the hard way in experiment 2 — see `.claude/skills/quay-core-bootstrap-methodology/reference/g3-audit-dispatch-drift-case-study.md`): regardless of §0b's general manda guidance, **the G3 out-of-band audit itself must never be attempted via manda nested-subagent, by any session, for any reason.** The protocol text in experiment 2 already said this and it drifted anyway for three iterations before a directive corrected it. Do not treat "manda is available and plausible-looking for this" as a reason to route G3 through it. See §5 (Out-of-band audit) below for the correct mechanism.

**Manda daemon-address discipline (net-new, correcting experiment 2's iterations 0-3 bug)**: any manda healthz/liveness probe — for G6 preconditions, for §0b task dispatch, or otherwise — must read the current daemon address from `.manda/hub.addr` at runtime. Never hardcode a port number in a prompt, Skill file, or script. The daemon's port is assigned dynamically per-run; a hardcoded port produces a false "daemon unreachable" negative, not evidence the daemon is actually down.

---

## §0c. Independent holistic visual review (NEW — no precedent in experiments 1/2)

Every claim of `visual_design_quality` movement (protocol §4.2) requires an independent holistic visual review, dispatched the same way G3 is dispatched: **by the orchestrator, using the native Agent/Task tool, run_in_background=true, from a fresh context** — never the same session/context that made the visual change, and never via manda.

**What the reviewing agent must do**:
1. Navigate the real page/flow via the `chrome-devtools` MCP (or `playwright` MCP, whichever is in active use this iteration — do not mix tools within a single review without saying so) and take a real screenshot.
2. Judge the page/flow **as a whole first** — the way a human looks at a finished screen and judges whether it coheres — before commenting on specifics. This explicitly must NOT degrade into an isolated-detail checklist (font size here, color there) as the primary mode of review; details are secondary commentary, not the verdict's basis.
3. Render a **PASS / CONCERNS / FAIL** verdict with reasoning, written to `experiments/quay-webui-bootstrap/audits/iteration-{N}-visual-review-{page-or-flow}.md`.
4. A **CONCERNS or FAIL verdict blocks crediting movement on `visual_design_quality` for that page/flow** until addressed — the same blocking discipline G3 applies to Core changes, applied here to visual coherence instead of functional correctness.

**Relationship to the mechanical Lighthouse threshold**: the two checks are independent and both mandatory (protocol §4.2). A page can pass Lighthouse (accessibility ≥ 90, best-practices ≥ 90, via `mcp__chrome-devtools__lighthouse_audit`) and still get a CONCERNS/FAIL holistic verdict (e.g., technically accessible but visually incoherent), or vice versa (visually polished but failing a mechanical check). Both must be green for `visual_design_quality` to credit that page/flow — do not treat either as a substitute for the other.

**Do not conflate this with G3.** G3 (§5 below) audits functional correctness / Core-touching changes. The visual review audits visual coherence. Keep them as separate dispatches with separate report sections (§9 for G3, a new §9a for visual review — see report template) even in an iteration where both trigger, exactly as the g3-audit-dispatch-drift case study warns against conflating "probing whether a primitive can do X-shaped work" with "using that primitive to actually do X" for two different X's.

---

## σ_QW and the inherited floor — explicit design-time decision (required before iteration 1 advances validation)

Per `.claude/skills/quay-core-bootstrap-methodology/reference/sigma-inherited-floor-trap.md`, experiment 2 discovered that inheriting a high `σ_strict` floor (0.8493, from experiment 1) while starting a fresh experiment's own count at 0/0 dominates the `validation` factor for the entire experiment's life, unless deliberately designed against — reaching σ ≥ 0.8493 from a small denominator requires on the order of 50+ additional all-native tasks, which experiment 2 confirmed is structurally out of reach for a documentation/browser-test-heavy experiment.

**This decision is NOT made for experiment 3 by this document** — it is a design-time choice iteration 0 must make explicitly and record in `provenance.md`, choosing one of:

1. **Reset the floor to 0** for `validation`'s own scoring in this experiment — treat validation as measuring only experiment 3's own `σ_QW` native-task discipline, no cross-experiment carry-forward.
2. **Design for high native-task throughput** — deliberately structure iterations so enough `QW-*` tasks per iteration earn the full `{author_by, execute_by, gate_by} = {native, native, native}` triple to plausibly approach or exceed the inherited floor within the experiment's realistic iteration budget (do the `n ≥ ...` arithmetic from `sigma-inherited-floor-trap.md` against experiment 3's own floor value before committing).

Iteration 0 must run this arithmetic against whichever `σ_strict` value is inherited (experiment 2's own `σ_QC = 4/10 = 0.40`, NOT experiment 1's `0.8493` — check `.claude/skills/quay-core-bootstrap-methodology/SKILL.md` and `experiments/quay-core-bootstrap/provenance.md` for the exact value to inherit; experiment 3 inherits from the *immediately preceding* experiment's own final σ, not by skipping back to experiment 1's), and record the choice and the arithmetic in `provenance.md`. **Do not let this default silently** — that is exactly the failure mode the sigma-inherited-floor-trap file documents.

---

## V_meta ceiling — check early, cite forward

Experiment 2 established (`.claude/skills/quay-core-bootstrap-methodology/reference/v-meta-ceiling-diagnostic.md`) that for a multiplicative `V_meta = completeness × effectiveness × reusability × validation`, if one factor is confirmed structurally frozen, the product's ceiling (substituting 1.0 for every other factor) may already be below the convergence threshold — an arithmetic fact derivable immediately, not something to wait for a formal halt decision to discover.

Experiment 3 **inherits** `effectiveness = 0.26` as still-frozen at the moment of inheritance (experiment 2's own 10-iteration comprehensive search found no scope-matched task and confirmed the same structural blocker experiment 1 documented). **Compute the ceiling at iteration 0**:

```
V_meta_ceiling = completeness_max × 0.26 × reusability_max × validation_max
              = 1.0 × 0.26 × 1.0 × 1.0 = 0.26   (if effectiveness stays frozen)
```

If `effectiveness` remains frozen through experiment 3 (plausible but NOT assumed — frontend/visual/UX work is a genuinely different domain and is exactly the kind of "organically different scenario" that experiment 1's own hypothesis, cited in the v3 protocol §5, predicts might re-trigger a stalled factor), **criterion 1 (V_meta ≥ 0.80) is arithmetically unreachable** for as long as the ceiling holds. State this explicitly and as early as it is confirmed — do not wait for a late iteration to notice it, and do not assume it fires without evidence (an iteration that asserts effectiveness re-triggered without evidence is a scoring error, per protocol §5 explicitly).

This is a live, testable hypothesis for experiment 3 specifically — record whichever way it resolves (frozen or re-triggered) with concrete evidence in the first iteration where it becomes decidable, not just at a terminal halt decision.

---

## Iteration 0: Baseline — confirm double inheritance, establish experiment 3's own V_instance baseline

**Objective**: Read and confirm the inherited methodology (from both `.claude/skills/quay-native-methodology/` and `.claude/skills/quay-core-bootstrap-methodology/`). Measure the current state of each of the four instance objectives (§4 of protocol) to establish experiment 3's own V_instance baseline. Confirm V_meta inherits experiment 2's stopping values (0.1012, NOT experiment 1's 0.0973, and NOT re-derived from zero). Make and record the explicit σ_QW-vs-inherited-floor design decision. Record the result in `provenance.md` and `iterations/iteration-0.md`.

**Driver**: Seed (no QW-* tasks have been through native authoring/execution/gating yet). This iteration is primarily observational — any gap-filling work done here is recorded as early seed-provenance evidence, not inflated to native.

**Prompt**:
```
You are running Iteration 0 of the quay-webui-bootstrap experiment (experiment 3).
This is NOT a restart from σ=0 or from V_meta=0 — methodology AND a continuing
V_meta baseline are both inherited, not invented. Do not run this iteration until
a human has explicitly confirmed docs/proposals/quay-webui-bootstrap-experiment-v3.md
§7 preconditions 1-4 are satisfied and has explicitly authorized starting iteration 0
(§7 precondition 5). If that authorization has not happened, STOP and report that
fact rather than proceeding.

Read before doing anything else:

INHERITANCE ARTIFACTS (read all, in order, before starting):
  docs/proposals/quay-webui-bootstrap-experiment-v3.md          ← authoritative protocol (read in full)
  docs/proposals/quay-core-bootstrap-experiment-v2.md            ← experiment 2's protocol
  docs/proposals/quay-bootstrap-experiment.md                    ← experiment 1's protocol
  .claude/skills/quay-native-methodology/SKILL.md
  .claude/skills/quay-native-methodology/reference/patterns.md
  .claude/skills/quay-native-methodology/reference/v-meta-stall-analysis.md
  .claude/skills/quay-native-methodology/reference/gate-mechanics.md
  .claude/skills/quay-native-methodology/reference/g3-audit-discipline.md
  .claude/skills/quay-native-methodology/reference/directive-lifecycle.md
  .claude/skills/quay-core-bootstrap-methodology/SKILL.md         ← read in full, this is experiment 2's delta
  .claude/skills/quay-core-bootstrap-methodology/reference/manda-daemon-address-bug.md
  .claude/skills/quay-core-bootstrap-methodology/reference/g3-audit-dispatch-drift-case-study.md
  .claude/skills/quay-core-bootstrap-methodology/reference/manda-reliability-envelope.md
  .claude/skills/quay-core-bootstrap-methodology/reference/v-meta-ceiling-diagnostic.md
  .claude/skills/quay-core-bootstrap-methodology/reference/sigma-inherited-floor-trap.md
  .claude/skills/quay-core-bootstrap-methodology/reference/transfer-test-outcome.md

PROTOCOL DOCUMENTS (read in full):
  docs/proposals/quay-proposal.md
  docs/proposals/quay-native-design.md
  docs/proposals/glossary.md

MOST RECENT EXPERIMENT 1 STATE (for the quay-native half of backlog_health):
  experiments/quay-native-bootstrap/CLOSING-REPORT.md
  experiments/quay-native-bootstrap/iterations/ (the highest-numbered iteration-N.md)

MOST RECENT EXPERIMENT 2 STATE (for the quay-core-bootstrap half of backlog_health,
AND for the V_meta inheritance record):
  experiments/quay-core-bootstrap/provenance.md
  experiments/quay-core-bootstrap/iterations/iteration-10.md   ← AUTHORITATIVE closing report
  experiments/quay-core-bootstrap/README.md

Precondition check (§0, G6): read .manda/hub.addr for the live daemon address (DO NOT
use a hardcoded port), confirm the daemon healthz endpoint at that address, and confirm
a monitor process is a DIRECT CHILD of this session's own process tree (ps-based check).
Do not proceed until confirmed.

1. CONFIRM THE DOUBLE INHERITANCE BOUNDARY
   State verbatim what you are inheriting:
   - Experiment 2's final V_meta factors (from iteration-10.md §8, §11):
     completeness=0.77, effectiveness=0.26, reusability=0.79, validation=0.64
     (product: 0.1012). This is experiment 3's OWN starting V_meta — not experiment 1's
     0.0973 (that is experiment 2's inheritance, already superseded).
   - Experiment 2's status: HALT with practical convergence accepted, NOT formally
     CONVERGED (criteria 1 and 3 unmet; criteria 2, 4, 5 met). Cite iteration-10.md §11e.
   - Experiment 2's own final σ_QC = 4/10 = 0.40. This — NOT experiment 1's σ_strict=0.8493
     — is the immediately-preceding experiment's own floor value relevant to the
     σ_QW-vs-inherited-floor decision below (do the arithmetic against BOTH values if
     ambiguous which one experiment 3's validation factor should track; if genuinely
     ambiguous per the protocol text, STATE the ambiguity explicitly rather than picking
     silently — this is a human-decision point if the protocol doesn't resolve it).
   - The V_meta re-trigger conditions (v-meta-stall-analysis.md) as refined by experiment
     2's transfer-test-outcome.md and v-meta-ceiling-diagnostic.md.
   For each re-trigger condition: does it fire for THIS iteration's own observations?
   Run the V_meta ceiling diagnostic NOW (see ITERATION-PROMPTS.md "V_meta ceiling"
   section) — compute and record the ceiling given effectiveness=0.26's inherited
   frozen status, before assuming criterion 1 is pursuable without qualification.

2. MAKE AND RECORD THE σ_QW-vs-INHERITED-FLOOR DESIGN DECISION
   Per ITERATION-PROMPTS.md's "σ_QW and the inherited floor" section: choose EITHER
   (a) reset the floor to 0 for this experiment's own validation scoring, OR
   (b) design for high native-task throughput and do the arithmetic against whichever
   floor value applies (see ambiguity note in step 1). Record the choice AND the
   arithmetic explicitly in provenance.md. Do not let this default silently.

3. MEASURE EXPERIMENT 3's OWN V_instance BASELINE
   Survey the actual code and current UI state in packages/quay/ for each:

   (a) ui_read_capability (protocol §4.1): For each bounded capability-list item —
       task list filter by status/label, sort by id/status, pagination (if the
       fixture task count exceeds a single-page-reasonable threshold — measure and
       record that threshold now, do not assume it), task detail page rendering of
       all frontmatter fields + rendered markdown body + back-navigation, action
       button trigger behavior preserved exactly — what currently exists? Be specific
       per bullet, not a single aggregate estimate.

   (b) visual_design_quality (protocol §4.2): For each currently-reachable page, run
       `mcp__chrome-devtools__lighthouse_audit` and record the accessibility and
       best-practices scores. Is there a consistent, applied styling system, or is
       any page an unstyled raw HTML dump (serve.js's own "crude but real" v0
       description makes this the likely current baseline)? Do NOT yet claim
       visual_design_quality movement without ALSO an independent holistic visual
       review per §0c — if no review has been dispatched yet, state that plainly and
       score this factor at its evidenced floor (likely 0.0 or near it at baseline).

   (c) verified_by_construction (protocol §4.3): what fraction of currently-existing
       capabilities (inherited from experiment 2's web_ui_verification work) has a
       committed browser-automation test confirming it? This is the regression
       safety net experiment 3 builds on — confirm it is intact, not assumed.

   (d) backlog_health (protocol §4.4): binary. Re-confirm BOTH inherited snapshots have
       not regressed — quay-native's 8 V-factors (experiment 1 final snapshot) AND
       quay-core-bootstrap's own 4 V-factors at their iteration-10 stopping values
       (core_abi_symmetry=1.0, web_ui_verification=1.0, action_delivery_mode=1.0,
       native_backlog_health=1.0). Run the actual test suites; do not assume.

   Compute V_instance = ui_read_capability × visual_design_quality ×
                        verified_by_construction × backlog_health
   using the factor definitions in the "V_instance for this experiment" section below.
   Show your work — each factor must have concrete evidence, not a vague estimate.

4. CONFIRM V_meta INHERITED STARTING VALUES — DO NOT RE-DERIVE FROM ZERO, AND DO NOT
   RE-DERIVE FROM EXPERIMENT 1's VALUES (experiment 2 already superseded those)
   - State the inherited starting values: completeness=0.77, effectiveness=0.26,
     reusability=0.79, validation=0.64, product=0.1012.
   - For `validation`: experiment 3's own σ_QW is 0/0 at iteration 0. Document this
     explicitly, alongside the design decision made in step 2 above.
   - For each of the other three factors: confirm the inherited stall reason still
     holds (cite the specific blocker from transfer-test-outcome.md / iteration-10.md,
     don't just say "same as experiment 2"). Or, if this iteration's own observations
     indicate a re-trigger condition fires (frontend/visual/UX work is a plausible
     candidate per protocol §5's own hypothesis, but this must be OBSERVED, not
     assumed), update the factor and show the evidence.

5. CHECK EXPERIMENT 2's OUTSTANDING ITEMS
   Read experiments/quay-core-bootstrap/iterations/iteration-10.md §"Problems identified
   for next iteration" (the "for any experiment 3 design" findings). For each of the
   5 findings listed there, confirm whether/how experiment 3's design as instantiated
   in this ITERATION-PROMPTS.md addresses it, or record explicitly that it remains open.

6. RECORD IN provenance.md
   Write the inheritance record: experiment 1's final provenance state and closing
   report citation, experiment 2's provenance state at the point experiment 3 starts
   (iteration-10.md, HALT-not-CONVERGED, cite exact values) and the σ_QW-vs-floor
   decision from step 2. If any QW-* task was completed in this iteration, add it.
   If iteration 0 is purely observational (no tasks completed): add a narrative
   context note marking the inheritance record as confirmed and stating the initial
   V scores, but do NOT create phantom {QW-000, seed, seed, seed} entries for work
   not actually done.

7. WRITE experiments/quay-webui-bootstrap/iterations/iteration-0.md
   Use the 11-section iteration report structure at the bottom of ITERATION-PROMPTS.md
   (one more section than experiment 2's — the new §9a independent holistic visual
   review, and §10a parallel-advancement stall guard check).

   Convergence Check (expect NOT CONVERGED for all criteria at iteration 0):
   [ ] 1. Dual threshold: NO — V_instance near 0 on factors a/b/c; V_meta = 0.1012
   [ ] 2. All 4 "Done when" clauses: NO — none are complete yet
   [ ] 3. V_meta genuine movement: NO — this iteration establishes the inherited
          baseline; it does not claim movement
   [ ] 4. Out-of-band audit (G3): N/A — no V-factor lift or Core change requiring
          independent adjudication (state explicitly)
   [ ] 5. Independent holistic visual review: N/A or CONCERNS-pending — no visual
          change has been claimed yet to review (state explicitly)
   [ ] 6. Parallel-advancement stall guard: N/A — no prior iterations to compare
          against yet (state explicitly)
   [ ] 7. Diminishing returns: N/A — no prior iteration to compare ΔV against
   Status: NOT CONVERGED.
```

**Expected Output**:
- Confirmed double-inheritance boundary (V_meta starting values stated as experiment 2's 0.1012, NOT experiment 1's 0.0973; re-trigger conditions known and checked; V_meta ceiling diagnostic run).
- The σ_QW-vs-inherited-floor design decision made and recorded explicitly, with arithmetic.
- V_instance baseline for experiment 3's four factors (likely: ui_read_capability ≈ low-but-nonzero given experiment 2's existing routes, visual_design_quality ≈ 0 pending both mechanical and holistic review, verified_by_construction ≈ inherited-high from experiment 2's own web_ui_verification work but re-confirmed not assumed, backlog_health ≈ 1).
- V_meta: inherited values stated as experiment 2's stopping point (not experiment 1's, not re-derived); stall reasons confirmed or re-trigger conditions noted; ceiling computed.
- `experiments/quay-webui-bootstrap/iterations/iteration-0.md` with honest assessment and a concrete problem list for each instance objective.
- Convergence Check: NOT CONVERGED (expected and correct at iteration 0).

---

## V_instance for this experiment

```
V_instance = ui_read_capability × visual_design_quality × verified_by_construction × backlog_health
```

### `ui_read_capability` — instance objective 1 (§4.1 of protocol)

Measures progress against the fixed, bounded capability list (task list filter/sort/pagination, task detail full-frontmatter+rendered-markdown+back-nav, action-button trigger behavior preserved exactly, no new write surface):
- 0.0: none of the bounded list implemented beyond the pre-existing three routes' bare functionality
- 0.3–0.6: some bullets implemented, gaps remain, not all confirmed via `verified_by_construction`
- 0.8: all bullets implemented, most confirmed via browser-automation test
- 1.0: "Done when" clause fully satisfied — every bullet implemented AND confirmed via `verified_by_construction` (not merely coded, but covered by a browser-automation test in the same iteration it landed)

**Do not expand this list without an explicit protocol amendment** — this is a fixed, bounded list per protocol §4.1, the same discipline experiments 1/2 apply to their own instance objectives. An iteration that wants to add a new read-capability bullet must file that as a proposed protocol amendment, not silently implement it.

### `visual_design_quality` — instance objective 2 (§4.2 of protocol)

Measures BOTH the mechanical Lighthouse threshold AND the independent holistic visual review, for every reachable page/flow — both are mandatory, neither substitutes for the other:
- 0.0: no page meets the mechanical threshold; no holistic review has been dispatched
- 0.3–0.6: some pages meet the mechanical threshold (accessibility ≥ 90, best-practices ≥ 90) but holistic review is pending, OR a holistic review returned CONCERNS/FAIL not yet addressed
- 0.8: most reachable pages pass both checks; a consistent styling system is applied across most pages
- 1.0: "Done when" clause fully satisfied — every reachable page/flow passes BOTH the mechanical Lighthouse threshold AND the independent holistic PASS verdict, with a consistent, applied styling system across all pages (no unstyled raw HTML dump remaining)

**A CONCERNS or FAIL verdict on any page/flow caps this factor** — it cannot credit movement for that page/flow until addressed, regardless of that page's mechanical score. A later regression on either check (mechanical or holistic) for a previously-passing page re-opens the gap for that page, the same way experiment 2 treats `native_backlog_health` regressions.

### `verified_by_construction` — instance objective 3 (§4.3 of protocol)

Measures the fraction of ALL capabilities/visual changes delivered so far (cumulative, not just this iteration) with a committed browser-automation test:
- 0.0: no browser-automation tests committed for any delivered capability/visual change
- <1.0: some fraction of cumulative delivered capabilities/visual changes lack a corresponding committed test — record the exact fraction, e.g. "9/10 capabilities covered, gap: X"
- 1.0: 100% of capabilities/visual changes delivered so far have a corresponding committed browser-automation test

**This factor is checked at EVERY iteration boundary, not just claimed once.** Unlike experiment 2's `web_ui_verification` (a one-time terminal target), this is a continuous per-iteration requirement — a gap discovered at any iteration boundary is a factor regression from whatever value it held before, checked with the same rigor `backlog_health` regressions are checked.

### `backlog_health` — instance objective 4 (§4.4 of protocol)

Binary: **1** if neither quay-native's 8 V-factors (experiment 1's final snapshot, from `experiments/quay-native-bootstrap/CLOSING-REPORT.md`) NOR quay-core-bootstrap's own 4 V-factors (at the state they held when experiment 3 started — `core_abi_symmetry=1.0, web_ui_verification=1.0, action_delivery_mode=1.0, native_backlog_health=1.0`, per `experiments/quay-core-bootstrap/iterations/iteration-10.md` §7) has regressed; **0** if any has regressed.

This factor starts at 1 at iteration 0 (no regressions inherited). It must be re-confirmed every iteration by checking the current test suites against BOTH snapshots. A UI change that silently breaks either inherited baseline must be caught here.

### Parallel-advancement stall guard (§4.5 of protocol — not a fifth multiplied factor, a standing check)

If either `ui_read_capability` or `visual_design_quality` shows no movement for 3 or more consecutive iterations while the other factor advances, that iteration's report must explicitly state why. An unexplained one-sided run is a violation of the human's parallel-advancement requirement requiring escalation — not routine, not merely noted and passed over. This is checked and reported every iteration from iteration 0 onward (vacuously at first, since there is no 3-iteration run to evaluate yet), the same way experiment 1 treats a repeated unexplained V_meta stall reason as a finding requiring escalation.

---

## V_meta for this experiment

```
V_meta = completeness × effectiveness × reusability × validation
```

**Formula shape**: inherited unchanged from experiments 1 and 2.

**Starting values** (per §5 of protocol — do NOT score these lower at iteration 0 without evidence of genuine regression, and do NOT re-derive from experiment 1's values — experiment 2's are the operative inheritance):

| Factor | Inherited value (from experiment 2's iteration 10) | Inherited stall reason (from `.claude/skills/quay-core-bootstrap-methodology/reference/transfer-test-outcome.md` and `iteration-10.md` §8) |
|---|---|---|
| completeness | 0.77 | Conditionality gap only (manda daemon + non-self broker required); reliability is settled (6/6 across six task-type tiers) but the primitive remains conditional, not unconditional. Environmental, not a Skill-content gap. |
| effectiveness | 0.26 | No organically-arising, scope-matched marginal-increment task (single-file, minimal source change, no network I/O, matching stage-0 QN-006's shape) arose in 10 consecutive experiment-2 iterations, confirmed by exhaustive comprehensive search at iteration 10. Nearest candidate found was a pre-existing QN-* GitHub issue, not a QC-* task. |
| reusability | 0.79 | GitHub Provider `data.write` blocked by deliberate v1 scope decision (QN-024); confirmed at code level (no body/title write path in `github-client.js`); confirmed with 10-iteration depth and code-level audit that no organic demand exists. |
| validation | 0.64 | Tracks σ; experiment 2 ended at σ_QC=4/10=0.40, still below the inherited σ_strict=0.8493 floor from experiment 1 — the floor dominates. Experiment 3's own σ_QW starts at 0/0 — see the explicit design decision required at iteration 0 (§"σ_QW and the inherited floor" above) about which floor value validation tracks going forward. |
| **V_meta** | **0.1012** | Product of above four |

**What must change** (per §5 of protocol): each factor must show either (a) genuine movement with evidence, or (b) a **different** stalling reason than experiments 1/2 recorded. Repeating the same stall reason after a supposed refinement is itself a finding (the refinement didn't work) requiring escalation — not a "held flat" note. Per protocol §5's explicit hypothesis (not a guaranteed outcome): a domain as different as frontend/visual/UX work is a plausible candidate to organically re-trigger one or more of the four factors that have been flat since experiment 1's iteration 66 (`effectiveness`, `reusability` in particular) — but this must be **observed**, not assumed; an iteration asserting re-triggering without evidence is a scoring error.

### V_meta re-trigger watchlist (check all applicable, every iteration)

1. **effectiveness re-trigger**: did any QW-* task arise that is organically scope-matched to stage-0 QN-006's shape (single-file, no/minimal source change, no network I/O)? Frontend source-logic tasks (e.g. a single-component rendering fix) are plausible candidates in this domain in a way documentation/browser-test tasks were not in experiment 2 — watch for this specifically. If yes: measure the timing comparison against the QN-006 baseline (`experiments/quay-native-bootstrap/timing/iteration-0.log`: author ~51s, execute ~2m59s) and update.
   - **Standing timing-recording instruction** (inherited from experiment 2): when a scope-matched task arises organically, record wall-clock start/end times for each Method phase in the iteration report. This is the precondition for firing this re-trigger.
2. **reusability re-trigger**: did organic external demand appear for wider GitHub Provider `data.write` capability? Low a priori likelihood for a UI-scoped experiment (this factor is about the GitHub Provider's write surface, not the Web UI's), but check every iteration regardless — do not assume irrelevance without checking.
3. **completeness re-trigger (gap discovery)**: was a new, previously-undocumented Skill Method-step gap found during *unrelated* work on the Skill files? If yes: re-open.
4. **completeness + reusability/effectiveness joint re-trigger**: did a reliable, unconditional native fresh-context subagent-dispatch primitive become available (not the conditional manda primitive characterized in experiment 2's reliability envelope)? If yes: re-open completeness, and reusability/effectiveness jointly.
5. **visual/UX-domain-specific re-trigger (NEW for this experiment, watch for explicitly)**: does the introduction of the independent holistic visual-review mechanism (§0c) itself surface a Skill Method-step gap not previously documented — e.g., a review-dispatch pattern that experiments 1/2's G3 discipline did not anticipate? This is the concrete form protocol §5's "does the methodology need adaptation" question is most likely to take. Record findings here explicitly, whichever way they resolve.
6. **Fallback rule**: if none of 1-5 fire within roughly 12 iterations of experiment 3, run one dedicated comprehensive full search (per experiment 2's iteration-10 precedent, §3b of that report) rather than letting the standing-fact note calcify. Experiment 2 discharged this obligation EARLY (at iteration 10 of 12) — treat early discharge as the preferred pattern, not last-minute.

**Ceiling note (carried forward as a standing fact — do not re-derive each iteration)**: with `effectiveness` inherited frozen at 0.26, `V_meta_ceiling = 1.0 × 0.26 × 1.0 × 1.0 = 0.26 < 0.80`. Criterion 1 (V_meta ≥ 0.80) is arithmetically unreachable unless `effectiveness` moves. State this in every V_meta section as a standing fact until/unless re-trigger 1 fires with evidence, per `.claude/skills/quay-core-bootstrap-methodology/reference/v-meta-ceiling-diagnostic.md`'s consuming-scope guidance.

**Validation mechanics**: report two numbers separately every iteration —
- *Inherited floor*: whichever value the iteration-0 design decision (§"σ_QW and the inherited floor") settled on tracking — either 0 (reset choice) or a cited specific value (throughput choice, with its own arithmetic) — cite the decision, do not re-derive it each iteration.
- *Experiment 3's own*: σ_QW = (# QW-* tasks with all three fields = native) / (total QW-* tasks)

`validation` score tracks experiment 3's own σ_QW as it grows, against whichever floor the design decision established.

---

## Iterations 1..k: Work toward instance objectives (template)

**Objective (recurring)**: Advance the four instance objectives (§4 of protocol) toward their "Done when" clauses, IN PARALLEL — the product formula and the explicit stall guard (§4.5) both structurally require this; do not treat one factor as "the current priority" for more than 2 consecutive iterations without checking the stall guard. Watch for V_meta re-trigger conditions. Update `provenance.md` with any newly completed QW-* tasks. Do not pre-plan which objective to advance in which order beyond the parallel-advancement constraint — the rest emerges from each iteration's observed state.

### Context extraction (do this first, every iteration)

```
Read, in full, before doing anything else:
  experiments/quay-webui-bootstrap/iterations/iteration-{N-1}.md  — prior state, V scores, problems
  experiments/quay-webui-bootstrap/provenance.md                   — current QW-* task provenance
  experiments/quay-webui-bootstrap/audits/                         — prior G3 adjudicate sign-offs
                                                                       AND prior visual-review verdicts
  .claude/skills/quay-native-methodology/reference/v-meta-stall-analysis.md  — re-trigger watchlist
  .claude/skills/quay-core-bootstrap-methodology/reference/v-meta-ceiling-diagnostic.md — ceiling reminder
  packages/quay-native/skills/author/SKILL.md                     — inherited Layer-2 Skills (fresh read)
  packages/quay-native/skills/execute/SKILL.md

Extract:
  - current σ_QW (recompute from provenance.md QW-* entries only; do not mix with QN-*/QC-*)
  - which instance objective is closest to its "Done when" clause, with specific evidence
  - the specific problems iteration {N-1} identified as blocking progress
  - whether the parallel-advancement stall guard is at risk (has one of
    ui_read_capability/visual_design_quality been flat for 2 iterations already,
    meaning this iteration is the last chance before an explicit-justification
    requirement triggers?)
  - whether any V_meta re-trigger condition fired last iteration or is imminent
  - any new QW-* directives in experiments/quay-webui-bootstrap/directives/pending/
```

### Lifecycle capability-reading protocol (inherited, unchanged)

- Read all relevant Skill definitions before the iteration starts (even ones not expected to be touched — drift is caught this way).
- Re-read the specific Skill/capability being modified immediately before using it.
- Read `.claude/skills/quay-native-methodology/reference/` and `.claude/skills/quay-core-bootstrap-methodology/reference/` files fresh each iteration — no caching of prior-iteration readings.

### Iteration cycle (Observe → Codify → Automate → Evaluate → Convergence Check)

```
1. OBSERVE
   - What is the precise current state of each instance objective vs. its "Done when"
     clause? Measure each item (a)-(d) against its specific criterion — not "mostly
     done" but "distance from the exact acceptance condition."
   - Which gap specifically blocks the natural next advance? (Cite {N-1}'s problem list;
     do not invent a new gap without evidence.)
   - Parallel-advancement check: is ui_read_capability or visual_design_quality at risk
     of a 3-iteration stall? If this iteration would make it 3, that fact alone should
     weigh into strategy selection below.
   - Which V_meta re-trigger conditions apply to the planned work? Check all 5 (including
     the new visual/UX-domain-specific one).
   - What does the QW-* task backlog show? (`quay task list` or file-based survey.)

2. STRATEGY FORMATION
   - Choose the smallest increment(s) that advance the instance objectives toward their
     "Done when" clauses, respecting the parallel-advancement constraint — if one factor
     has been advancing for 2+ iterations running while the other sits still, prefer an
     increment on the stalled one this iteration, or explicitly justify why not.
   - If the chosen increment organically bears on a V_meta re-trigger condition (e.g.
     a scope-matched task providing timing data): note this now and plan to record the
     evidence at EVALUATE time.
   - Do NOT manufacture V_meta evidence (G2/G5) — but do not ignore genuine organic
     evidence either.
   - Any capability/visual change chosen must ship WITH a browser-automation test in
     THIS SAME iteration (protocol §4.3) — do not plan a change without also planning
     its test in the same increment.
   - Scope-boundary check: does the planned increment stay strictly read-only plus
     existing action-button triggering? Any hint of new write surface or
     backend-specific conditional rendering is out of scope — file it separately,
     do not fold it in.
   - For any work touching packages/quay: read §Core-scope constraints below first.

3. EXECUTION
   - Drive the chosen QW-* task(s) using the inherited Skill set where possible
     (quay:author / quay:execute). Record provenance honestly:
     {author_by, execute_by, gate_by} ∈ {seed, native}.
   - Seed-driven or ad-hoc work is recorded as seed provenance — never back-filled
     to native to inflate σ_QW.
   - For any Core (packages/quay) change: G3 out-of-band audit is mandatory per
     §Core-scope constraints item 5.
   - For any visual/design change: independent holistic visual review is mandatory
     per §0c — dispatch it this same iteration, not deferred.

4. EVALUATE — compute both V's from evidence gathered this iteration

   V_instance = ui_read_capability × visual_design_quality × verified_by_construction
                × backlog_health
   - Re-check ALL four factors, not just the one(s) touched. Regressions in
     backlog_health (broken inherited-snapshot tests from a UI change) are possible
     and must be caught here.
   - Show the before/after for any factor that moved.
   - verified_by_construction: re-verify the CUMULATIVE fraction, not just this
     iteration's own new tests — a gap anywhere in the cumulative set is a regression.

   V_meta = completeness × effectiveness × reusability × validation
   - For EACH factor:
     * Check the re-trigger watchlist item for that factor (all 5, including the
       visual/UX-domain-specific one).
     * If a trigger fired: update with evidence and show the movement.
     * If no trigger fired: state the inherited stall reason explicitly (not just
       "still the same" — cite the specific blocker from transfer-test-outcome.md
       or the earlier v-meta-stall-analysis.md as appropriate).
   - Restate the ceiling (0.26, if effectiveness still frozen) as a standing fact.
   - Stall diagnosis: is the current stall reason the SAME as experiment 2 (or
     experiment 1) recorded, or a new one? (A new reason is still useful data;
     repeating the same reason without noting it is a reporting failure.)
   - Report σ_QW (experiment 3's own) and the inherited floor (per the iteration-0
     design decision) separately.

5. OUT-OF-BAND AUDIT (G3 — mandatory for any Core change or V-factor lift)
   - Dispatch an independent epicd `adjudicate` pass (or equivalent adversarial
     verification) via the NATIVE Agent/Task tool (run_in_background=true per §0a),
     dispatched by the ORCHESTRATOR — never by the session that authored/executed the
     task, and NEVER via manda nested-subagent (see §0b's absolute exclusion).
   - Write the verdict to experiments/quay-webui-bootstrap/audits/iteration-{N}-adjudicate.md.
   - If G3 finds problems: the V-factor lift for the affected tasks does not count;
     fix and re-audit before claiming the lift.
   - If no Core change and no V-factor lift this iteration: explicitly state "G3 not
     triggered this iteration" rather than silently omitting the step.

5a. INDEPENDENT HOLISTIC VISUAL REVIEW (mandatory for any visual_design_quality claim)
   - Dispatch a fresh-context agent via the NATIVE Agent/Task tool (run_in_background=true),
     dispatched by the ORCHESTRATOR — never the same session that made the change, never
     via manda. See §0c for the full mechanism.
   - The agent takes a real screenshot via chrome-devtools/playwright MCP, judges the
     page/flow AS A WHOLE first, then renders PASS/CONCERNS/FAIL with reasoning.
   - Write the verdict to
     experiments/quay-webui-bootstrap/audits/iteration-{N}-visual-review-{page}.md.
   - Also run the mechanical Lighthouse check (`mcp__chrome-devtools__lighthouse_audit`)
     for the same page/flow — both are required, neither substitutes for the other.
   - CONCERNS/FAIL blocks crediting visual_design_quality movement for that page/flow.
   - If no visual change this iteration: explicitly state "visual review not triggered
     this iteration" rather than silently omitting the step.

6. CONVERGENCE CHECK — all criteria, every iteration, no partial credit:
   [ ] 1. Dual threshold: V_instance ≥ 0.80 AND V_meta ≥ 0.80
   [ ] 2. All 4 "Done when" clauses (§4.1-§4.4 of protocol): each independently satisfied
          with evidence (not "mostly" — the literal "Done when" wording)
   [ ] 3. V_meta genuine movement: ≥2 of the 4 factors show real movement, with a
          DIFFERENT stalling reason (if still flat) than experiments 1/2 documented
   [ ] 4. Out-of-band audit (G3) green: all Core and V-lift tasks have adjudicate
          co-signs in experiments/quay-webui-bootstrap/audits/
   [ ] 5. Independent holistic visual review green: every page/flow claimed under
          visual_design_quality has a PASS verdict on file (no open CONCERNS/FAIL)
   [ ] 6. Parallel-advancement stall guard: no unexplained 3+-consecutive-iteration
          one-sided run between ui_read_capability and visual_design_quality
   [ ] 7. Diminishing returns: ΔV < 0.02 for 2+ consecutive iterations on BOTH
          V_instance and V_meta
   Status: NOT CONVERGED unless all seven are YES with evidence.

7. Write experiments/quay-webui-bootstrap/iterations/iteration-N.md (11-section structure below).

8. Evolution guidance (for the Skill set A_n and methodology M_n):
   - Evolve a Skill/methodology element only when: retrospective OBSERVE evidence
     demonstrates a gap + a documented alternative was attempted and failed.
   - For any methodology change: state explicitly (a) which V_meta factor it targets,
     (b) which inherited stall reason it addresses, (c) how the resulting movement
     will be distinguishable from merely re-measuring the same inherited stall.
   - Do NOT evolve on: pattern-matching to what "seems complete," anticipatory design,
     or theoretical completeness alone.
   - Any adaptation to the visual-review mechanism (§0c) itself is exactly the kind of
     evidence protocol §5's meta objective is asking for — document it explicitly as
     "what concretely had to change" material, not just as an operational tweak.
```

---

## §Convergence criteria for this experiment

All seven, every iteration, no partial credit:

1. **Dual threshold**: V_instance ≥ 0.80 AND V_meta ≥ 0.80.
2. **All 4 "Done when" clauses** (protocol §4.1–§4.4): each independently satisfied with direct evidence — not "nearly," not "in spirit."
3. **V_meta genuine movement**: ≥2 of the 4 factors show real, evidence-backed movement FROM the inherited 0.1012 baseline. If a factor is still flat, its current stall reason must differ from experiments 1/2's — a repeat of the same reason is itself a finding (the methodology refinement didn't work) requiring escalation.
4. **Out-of-band audit (G3) green**: all Core-touching and V-factor-lift tasks have independent adjudicate co-signs in `experiments/quay-webui-bootstrap/audits/`, dispatched correctly (orchestrator, native Agent/Task tool, never manda — see §0b).
5. **Independent holistic visual review green**: every page/flow with a claimed `visual_design_quality` improvement has an on-file PASS verdict (§0c), with no open CONCERNS/FAIL.
6. **Parallel-advancement stall guard**: no unexplained 3-or-more-consecutive-iteration one-sided run between `ui_read_capability` and `visual_design_quality` (protocol §4.5).
7. **Diminishing returns**: ΔV < 0.02 for 2+ consecutive iterations on BOTH V_instance and V_meta.

Note: neither experiment 1's σ→1 fixpoint criterion nor experiment 2's dual-threshold-only shape is the convergence signal here — this experiment's convergence is defined by the four instance "Done when" clauses, the two visual-quality verification mechanisms, the parallel-advancement guard, and V_meta genuine movement, not by a self-hosting fixpoint. Quay-native's self-hosting loop and quay-core-bootstrap's Core-symmetry work are both inherited infrastructure for this experiment, not its object.

**Ambiguity flag (state explicitly if reached, do not silently resolve)**: the v3 protocol does not specify what happens if the V_meta ceiling (0.26, per the ceiling diagnostic above) is confirmed to hold through this experiment as well — i.e., whether experiment 3 should also reach a HALT-with-practical-convergence-accepted state analogous to experiments 1 and 2, and under what evidentiary bar. If experiment 3 reaches that decision point, treat it as requiring the same kind of explicit, evidence-backed recommendation experiment 2's iteration-10 §11 modeled — but do not assume in advance that this outcome is either the goal or the expected result; state it as a live possibility only when the evidence warrants it.

---

## §Core-scope constraints (inherited verbatim, apply to every iteration touching `packages/quay`)

These constraints carry over from `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` §Core-scope work (established iteration 29 / DIR-008 / DIR-013 of experiment 1) and were re-applied unchanged in experiment 2. Read the underlying reasoning there; only the operative constraints are listed here, with one addition (item 6, new for this experiment's write-surface boundary).

1. **Terminology discipline**: keep "MCP" (Provider ABI transport: `quay-native mcp`, `quay-github mcp`, `quay mcp`) and "browser-automation tooling (chrome-devtools / playwright MCP)" unambiguous — never use bare "MCP testing" where both meanings could apply.

2. **G5 discipline extends to this experiment's own read-side scope**: experiment 2 scoped its Web UI verification pass to confirming *existing* behavior only, filing any discovered improvement as a separate task. Experiment 3 inverts this for the read/visual dimension (improving IS the point, within the bounded capability list and the visual-quality mechanisms) but the underlying G5 discipline — do not silently fold an out-of-scope discovery into the current task — still applies to anything outside the bounded `ui_read_capability` list or outside the visual-quality mechanisms themselves.

3. **Manda-investigation reuse discipline**: experiment 1's iterations 13-18 and experiment 2's iterations 4-6 established the reliability envelope for manda dispatch (trivial/medium/complex tiers, 150s floor for anything above trivial). Cite `.claude/skills/quay-core-bootstrap-methodology/reference/manda-reliability-envelope.md` rather than re-discovering from scratch. Do not make automated test pass/fail hinge on live manda delivery succeeding.

4. **V-factor attribution for UI work**: new read-capability code → `ui_read_capability`; new styling/visual-system code → `visual_design_quality`; new browser-automation test → `verified_by_construction`; do not attribute UI structural work to `effectiveness` or `reusability` — those V_meta factors have specific, narrow evidentiary requirements unrelated to UI feature work.

5. **G3 extends to Core** (inherited from DIR-013): any task touching `packages/quay` source files (`mcp-server.js`, `serve.js`, `bin/quay.js`, `provider-env.js`, `action.js`, `config.js`, `provider-client.js`, or any new Core source, including new frontend/rendering source under this experiment's own scope) requires the same independent adjudicate dispatch as any other Core change. No self-certification exemption for UI code on the theory that it is "just presentation."

6. **Write-surface boundary (NEW, specific to this experiment's scope)**: no task creation from the browser, no field editing from the browser, no new write path beyond the existing action-button trigger. Any backend-specific conditional rendering (`if backend === 'github'`, hardcoded per-backend components) is excluded per the unchanged "Core stays dumb" principle (`quay-proposal.md`). Any change that would cross this boundary is scope creep — file it as a separate task/directive for a future, differently-scoped decision; do not implement it under this experiment's authority.

---

## §Inherited methodology constraints

The following mechanics are inherited from `.claude/skills/quay-native-methodology/` and `.claude/skills/quay-core-bootstrap-methodology/` and apply as-is. Do not re-derive — read the source files.

- **Gate mechanics** (`quay-native-methodology/reference/gate-mechanics.md`): `task check` / `checkGate()` — artifact-completeness + checked-state + recursive children-done. The "presence not checked-state" and "one-level-deep children" regressions were already found and fixed in experiment 1 — do not reintroduce them.
- **Directive lifecycle** (`quay-native-methodology/reference/directive-lifecycle.md`): pending → archive, one-time consumed, never silently dropped. This experiment's own directives live in `experiments/quay-webui-bootstrap/directives/` — experiment 1's and experiment 2's pending directives stay in their own experiments' `directives/pending/` and are not repeated here.
- **G3 out-of-band audit discipline** (`quay-native-methodology/reference/g3-audit-discipline.md` + `quay-core-bootstrap-methodology/reference/g3-audit-dispatch-drift-case-study.md`): native Agent/Task tool (not manda), dispatched by the orchestrator (not the iteration-executor), is the permanent G3 mechanism. Three caught overclaims in experiment 1 (iterations 29, 59, 61) demonstrate this guardrail finds real problems; experiment 2's own dispatch-drift (iterations 3-5, corrected by DIR-003) demonstrates the drift risk is real even when the protocol text is already correct. Treat it as genuinely independent — not a formality, and re-state the correct dispatcher/mechanism at the start of every iteration rather than assuming it will be remembered.
- **Layer-1/Layer-2 Skill structure** (`quay-native-methodology/reference/patterns.md` §"Layer-1 / Layer-2"): the inline, degraded-fallback structure is the proven artifact — do not assume a cleaner split is "just not yet built." Re-verify any subagent-dispatch assumption live before building on top of it.
- **manda daemon address discovery** (`quay-core-bootstrap-methodology/reference/manda-daemon-address-bug.md`): read `.manda/hub.addr` at runtime, never hardcode a port. This bug cost experiment 2 three consecutive false-negative iterations before being found.
- **manda reliability envelope** (`quay-core-bootstrap-methodology/reference/manda-reliability-envelope.md`): trivial@90s=success, medium@150s=success, complex@90s=timeout, complex@150s=success. Use 150s as the floor timeout for anything above trivial complexity if manda dispatch is used for any purpose in this experiment (it is NOT to be used for G3 — see above).
- **V_meta ceiling diagnostic** (`quay-core-bootstrap-methodology/reference/v-meta-ceiling-diagnostic.md`): compute the ceiling the first iteration any factor is confirmed frozen with a structural blocker; state it as a standing fact thereafter.
- **σ-vs-inherited-floor trap** (`quay-core-bootstrap-methodology/reference/sigma-inherited-floor-trap.md`): make the reset-vs-throughput design decision explicitly at iteration 0; do not let it default silently.

---

## Iteration report structure

```markdown
# Iteration N: [title — which instance objective(s) were targeted and what work was done]

**Date**: YYYY-MM-DD
**Driver**: [seed | quay:author + quay:execute (native) | mixed — specify per task]
**Instance objectives advanced**: [which of ui_read_capability / visual_design_quality /
  verified_by_construction / backlog_health, or "none — observational"]
**V_meta triggers checked**: [which of the 5 re-trigger conditions were checked; any fired?]
**Parallel-advancement status**: [ui_read_capability last moved iteration X; visual_design_quality
  last moved iteration Y; stall guard triggered? Y/N — if Y, justification required]

## 1. Context from prior iteration
[σ_QW before, V scores before, which instance objective(s) were targeted, problems inherited]

## 2. Preconditions checked
[§0 checklist — every item, confirmed or explicitly N/A; G6 ps-output as evidence;
daemon address confirmed read from .manda/hub.addr, not hardcoded]

## 3. Observe
[Precise state of each instance objective vs. its "Done when" clause; V_meta re-trigger
check results; parallel-advancement stall-guard check; gap analysis; evidence for what
blocks the next advance]

## 4. Strategy
[The advance(s) chosen; why; whether it organically bears on any V_meta factor; scope-
boundary self-check (read-only + action-button-only, no backend-specific rendering)]

## 5. Execution
[What was actually built/run — cite real runs and outputs, not projections. Confirm every
capability/visual change shipped WITH its browser-automation test in this same iteration.]

## 6. Provenance update
[Per-QW-* task {author_by, execute_by, gate_by} diffs this iteration;
σ_QW before → after; inherited floor (per iteration-0 design decision) noted separately]

## 7. V_instance
- ui_read_capability: 0.XX — [evidence against "Done when" clause; specific gap remaining]
- visual_design_quality: 0.XX — [per-page Lighthouse scores; holistic review verdicts; gap]
- verified_by_construction: 0.XX — [cumulative fraction covered; specific gap if any]
- backlog_health: 0 or 1 — [compared to BOTH inherited snapshots]
- **Total**: 0.XX (product of the four factors)

## 8. V_meta
- completeness: 0.XX — [re-trigger check: condition 3 or 4 fired? If not: cite specific inherited blocker]
- effectiveness: 0.XX — [re-trigger check: condition 1 fired? If not: cite specific inherited blocker]
- reusability: 0.XX — [re-trigger check: condition 2 fired? If not: cite specific inherited blocker]
- validation: 0.XX — [experiment 3's σ_QW = X/Y; inherited floor per iteration-0 decision]
- **Total**: 0.XX
- **ΔV_meta from inherited baseline** (0.1012): [+/–]0.XX
- **V_meta ceiling** (if effectiveness still frozen): 0.26 — [restate as standing fact]
- **Stall diagnosis**: [for any factor still flat — is the stall reason SAME as experiments 1/2, or new?]

## 9. Out-of-band audit (G3)
[adjudicate verdict; link to experiments/quay-webui-bootstrap/audits/iteration-N-adjudicate.md;
OR: "G3 not triggered this iteration — no Core change, no V-factor lift" (state explicitly).
Confirm dispatcher: orchestrator, native Agent/Task tool, NOT manda.]

## 9a. Independent holistic visual review
[Per-page/flow PASS/CONCERNS/FAIL verdicts; links to
experiments/quay-webui-bootstrap/audits/iteration-N-visual-review-{page}.md;
Lighthouse scores alongside each; OR: "visual review not triggered this iteration —
no visual change claimed" (state explicitly). Confirm dispatcher: orchestrator,
native Agent/Task tool, fresh context, NOT manda.]

## 10. Convergence Check
- [ ] 1. Dual threshold (V_instance ≥ 0.80 AND V_meta ≥ 0.80): [evidence]
- [ ] 2. All 4 "Done when" clauses: [each item's status with direct evidence]
- [ ] 3. V_meta genuine movement (≥2 factors, different stall reason): [evidence]
- [ ] 4. Out-of-band audit (G3) green for all Core/lift tasks: [evidence]
- [ ] 5. Independent holistic visual review green (no open CONCERNS/FAIL): [evidence]
- [ ] 6. Parallel-advancement stall guard (no unexplained 3+-iteration one-sided run): [evidence]
- [ ] 7. Diminishing returns (ΔV < 0.02 for 2+ iterations, both V's): [evidence]

**Status**: NOT CONVERGED | CONVERGED

## Problems identified for next iteration
[concrete, evidence-based — feeds directly into the next iteration's context extraction]
```

---

## Execution guidance

- **Perspective**: you are simultaneously developing quay's Web UI (both functionally and visually) and refining the inherited methodology for a genuinely different domain. Keep all three visible in the writeup — do not silently focus on only one or collapse them together.
- **Rigor**: honest four-factor V_instance and four-factor V_meta calculation, every factor grounded in evidence from this iteration. The V_meta ceiling (0.26, if effectiveness stays frozen) is structural — don't inflate to paper over the inheritance, but don't let the structural explanation become an excuse for not searching, and don't assume the ceiling holds without checking whether this domain re-triggers it (protocol §5's own hypothesis).
- **V_meta honesty**: the inherited starting value is 0.1012 (from experiment 2's iteration 10), not experiment 1's 0.0973. Neither defend it nor treat it as a floor to protect. Each iteration must either show movement with evidence or document a different, more specific stall reason.
- **Visual quality honesty**: a mechanical Lighthouse pass is necessary but not sufficient. Do not credit `visual_design_quality` movement for a page without an on-file independent holistic PASS verdict. Do not let the holistic reviewer degrade into a checklist-only pass — the brief is whole-page/whole-flow coherence judgment first.
- **Parallel-advancement honesty**: the product formula and the §4.5 stall guard both exist because the human explicitly required neither `ui_read_capability` nor `visual_design_quality` to race ahead unchecked. Treat a 3-iteration one-sided run as a real finding requiring real justification, not paperwork.
- **Scope-boundary honesty**: read-only + existing action-button triggering only, every iteration. Any temptation to add a write affordance "since we're already in that file" is scope creep — file it, don't do it.
- **Thoroughness**: no token-limit shortcuts. A partial provenance update, a partial audit, or a partial visual review is worse than a smaller iteration scope.
- **Authenticity**: the four instance "Done when" clauses (plus the two visual-quality mechanisms and the stall guard) define the work. Do not expand scope beyond them (gold-plating) or collapse below them (skipping).

### Common mistakes specific to this experiment

- **Re-deriving V_meta from zero, or from experiment 1's 0.0973** (instead of experiment 2's 0.1012) at iteration 0 without evidence of genuine regression — a scoring error per §5 of the protocol.
- **Hardcoding the manda daemon port** — always read `.manda/hub.addr` at runtime; this exact bug cost experiment 2 three consecutive false-negative iterations.
- **Dispatching G3 (or the visual review) via manda, or from inside the iteration-executor's own session** — the protocol text will already say the correct thing (orchestrator, native Agent/Task tool); the drift happens in execution, not in what's written down. Re-state the correct dispatcher explicitly at the start of every iteration.
- **Crediting `visual_design_quality` movement on a mechanical Lighthouse pass alone**, without an on-file independent holistic PASS verdict — both are mandatory, neither substitutes for the other.
- **Letting the holistic visual reviewer degrade into an isolated-detail checklist** rather than a whole-page/whole-flow coherence judgment — this is explicitly disallowed by protocol §4.2.
- **Treating `verified_by_construction` as a one-time terminal target** (as experiment 2's `web_ui_verification` was) rather than a continuous, every-iteration-boundary requirement covering the cumulative delivered set.
- **Letting one of `ui_read_capability`/`visual_design_quality` race ahead unchecked for 3+ iterations** without recording an explicit justification — this triggers the §4.5 stall-guard violation.
- **Crossing the write-surface boundary** ("just adding a small edit affordance while I'm in this file") — any new write path beyond the existing action-button trigger, or any backend-specific conditional rendering, is scope creep; file it, don't implement it.
- **Letting `backlog_health` silently regress** — UI changes can break either quay-native's inherited snapshot or quay-core-bootstrap's inherited snapshot indirectly. Run both inherited test suites after every change.
- **Mixing QW-*, QC-*, and QN-* task populations** — experiment 3's provenance tracks QW-* tasks only. New experiment-3 tasks get QW-* IDs, never a continuation of the QN-* or QC-* sequences.
- **Letting the σ_QW-vs-inherited-floor design decision default silently** — this must be made explicitly at iteration 0 and cited thereafter, not re-derived or assumed each iteration.
- **Letting the 12-iteration fallback lapse** — if no V_meta re-trigger fires within 12 consecutive iterations, run a dedicated full search. Experiment 2 discharged this obligation early (iteration 10 of 12); treat early discharge as the preferred pattern.
