# Iteration 0: Baseline — confirm double inheritance, establish experiment 3's own V_instance baseline

**Date**: 2026-07-17
**Driver**: Seed (no QW-* tasks have been through native authoring/execution/gating yet; this iteration is purely observational)
**Instance objectives advanced**: none — observational baseline measurement only
**V_meta triggers checked**: all five re-trigger conditions checked (re-triggers 1–5 per ITERATION-PROMPTS.md V_meta re-trigger watchlist); none fired at this baseline iteration
**Parallel-advancement status**: ui_read_capability last moved: N/A (iteration 0 is the baseline); visual_design_quality last moved: N/A; stall guard triggered: N/A — no prior iterations to compare against

---

## 1. Context from prior iteration

No prior experiment-3 iteration. Experiment 3 starts fresh from the inheritance boundary established by experiments 1 and 2.

**Inherited V_meta** (from experiment 2's iteration-10.md §8, §11 — AUTHORITATIVE):
- completeness = 0.77, effectiveness = 0.26, reusability = 0.79, validation = 0.64
- product = 0.1012

**Inherited σ** (experiment 2's own final): σ_QC = 4/10 = 0.40 (experiment 3's own σ_QW starts at 0/0).

**Problems inherited**: none from prior iterations (this is iteration 0). Problems inherited from experiment 2's iteration-10.md closing section are addressed in §5 below.

---

## 2. Preconditions checked

**§0 checklist:**

**[ G6 daemon ] manda daemon address read LIVE from .manda/hub.addr:**
```
cat /home/yale/work/quay/.manda/hub.addr
→ http://localhost:46215

curl -s http://localhost:46215/healthz
→ {"root":"/home/yale/work/quay"}  (exit 0)
```
Daemon live at http://localhost:46215. CONFIRMED. Address was read from .manda/hub.addr at runtime — not hardcoded. (Experiment 2's iterations 0–3 lost three consecutive iterations to the hardcoded-port bug; this check is the first action in every iteration per manda-daemon-address-bug.md.)

**[ G6 monitor ] manda monitor is a DIRECT CHILD of this session's own process tree:**

ps output (relevant extract):
```
PID 1013487  PPID 3175631  claude --model sonnet --permission-mode bypassPermissions
PID 1065915  PPID 1013487  /bin/bash -c ... manda monitor cord --root .
PID 1065935  PPID 1065915  manda monitor cord --root .
```

The current bash process (PPID 1013487) and the manda monitor cord process (PID 1065935, PPID 1065915, which is PPID 1013487) are both direct children of the claude session (PID 1013487). The manda monitor cord (1065935) is a direct child of a bash shell (1065915) that is itself a direct child of this session. G6 direct-child precondition: CONFIRMED.

A second manda monitor terminal process (PID 203534, PPID 203514) is also present — a separate session's terminal monitor, not this session's. Ignored per G6 (only direct-child of THIS session matters).

DIR-020 precondition: non-self cord broker confirmed. This session does not own the cord broker.

**[ provenance.md ] experiments/quay-webui-bootstrap/provenance.md has been read:**
CONFIRMED — read at session start (the full inheritance record and placeholder section).

**[ prior iteration ] Previous iteration report:** N/A — this is iteration 0. No prior experiment-3 iteration exists.

**[ directives ] experiments/quay-webui-bootstrap/directives/pending/ listed:**
```
ls /home/yale/work/quay/experiments/quay-webui-bootstrap/directives/pending/
→ (empty — no output)
```
No pending directives. CONFIRMED.

**[ V_meta re-trigger ] V_meta re-trigger conditions checked against this iteration's planned work:**
This iteration is observational — no new QW-* tasks, no source changes, no visual changes. All five re-trigger conditions are inapplicable (no work to trigger against). Documented in §3 below.

**[ stall guard ] Parallel-advancement stall guard:**
N/A — no prior iterations to compare against. Vacuously satisfied at iteration 0.

**[ verified_by_construction spot-check ] Every capability/visual change delivered SO FAR has a committed browser-automation test:**
Experiment 2 delivered web_ui_verification at 1.0 (all three routes covered). Confirmed by `node --test packages/*/test/*.test.mjs` → 30 pass, 0 fail (see §3c below). CONFIRMED.

**[ backlog_health regression check ] Both inherited snapshots confirmed not regressed:**
`node --test packages/*/test/*.test.mjs` → 30 pass, 0 fail. CONFIRMED (see §3d below).

**[ G3 / visual review dispatch ] Both dispatches confirmed run_in_background=true:**
N/A — no G3 trigger and no visual review trigger this iteration (no Core change, no V-factor lift, no visual change). Both vacuously satisfied.

**G3 out-of-band audit dispatcher: orchestrator, native Agent/Task tool, NOT manda** (restated per ITERATION-PROMPTS.md §0 guidance, not assumed to be remembered):
This is the permanent G3 mechanism inherited from experiment 1 (g3-audit-discipline.md) and confirmed correct by experiment 2's DIR-003 case study (g3-audit-dispatch-drift-case-study.md). The iteration-executor must NEVER dispatch its own G3 audit; the orchestrator must dispatch it via the native Agent/Task tool. No G3 trigger fires this iteration.

---

## 3. Observe

### 3a. Precise state of each instance objective vs. "Done when" clause

**ui_read_capability (§4.1 of protocol):**

Current serve.js (packages/quay/src/serve.js) implements:
- GET / — task list page: renders id, status, role, title for all tasks. NO filter by status, NO filter by label, NO sort by id or status, NO pagination.
- GET /task/:id — task detail page: renders id, title, status in heading; role and labels in a paragraph (`role: X · labels: Y`); task body in a `<pre>` block (raw text, NOT rendered markdown); back-navigation link (`← back to list`).
- POST /task/:id/action/:actionId — action button trigger: fires deliverTrigger(), returns 302 redirect. Action buttons shown per `whenStatus` visibility. Behavior preserved exactly as experiment 2 verifies.

Gap analysis against the bounded capability list (§4.1):

| Capability | Implemented? | Gap |
|---|---|---|
| Task list filter by `status` | NO | No filter query param or UI element |
| Task list filter by `label` | NO | No filter query param or UI element |
| Task list sort by `id` | NO | No sort param; renders in store order |
| Task list sort by `status` | NO | No sort param |
| Task list pagination (if count > threshold) | Unmeasured | Threshold not yet set; pagination not implemented |
| Task detail: all frontmatter fields rendered | PARTIAL | `status`, `labels`, `role` rendered; `parent` and `children` NOT rendered |
| Task detail: rendered markdown body | NO | Body rendered in `<pre>` block (raw text dump) |
| Task detail: back-navigation | YES | `← back to list` link to `/` present |
| Action button trigger behavior preserved | YES | Confirmed by experiment 2's QC-002 and `web-ui-browser.test.mjs` |
| No new write surface | YES | No write surface beyond existing action-button trigger |

Pagination threshold: not yet set. Protocol §4.1 says "threshold to be set by the first iteration that measures it, recorded explicitly, not assumed." The task count in the test fixture (web-ui-browser.test.mjs) uses 3 tasks. No single-page-reasonable count threshold has been established yet — this is a gap to close at iteration 1.

**Score assessment**: ui_read_capability ≈ 0.20. The back-navigation and action-button trigger exist, but the core read-capability bullets (filter, sort, pagination, rendered markdown, parent/children) are all absent or incomplete. The existing implementation matches serve.js's own stated v0 "crude but real" boundary, which experiment 3 exists to improve.

**visual_design_quality (§4.2 of protocol):**

No Lighthouse audit has been run this iteration (the server is not started in a browser context — running it would require starting the quay serve process and running chrome-devtools against it, which is out of scope for an observational iteration). No independent holistic visual review has been dispatched (no visual change claimed this iteration). Score: 0.0.

Per protocol §4.2 and ITERATION-PROMPTS.md: "Do NOT yet claim visual_design_quality movement without ALSO an independent holistic visual review per §0c — if no review has been dispatched yet, state that plainly and score this factor at its evidenced floor (likely 0.0 or near it at baseline)."

Current styling: serve.js uses `border="1" cellpadding="4"` on the task list table and `display:inline` on action button forms. No CSS framework, no consistent styling system — exactly the v0 "crude but real... no framework, no styling beyond what's needed to prove the loop" boundary serve.js's own comment documents. A Lighthouse audit at this state would almost certainly score low on both accessibility (no ARIA labels, no semantic structure beyond basic HTML, no heading hierarchy beyond h1) and best-practices (no meta viewport, no modern HTML conventions).

Score: 0.0 — no page meets the mechanical threshold, no holistic review dispatched. This is the honest floor.

**verified_by_construction (§4.3 of protocol):**

The capabilities currently existing in the Web UI (GET /, GET /task/:id, POST /task/:id/action/:actionId) were all verified by experiment 2's QC-001 and QC-002 tasks, with committed browser-automation tests in `packages/quay/test/web-ui-browser.test.mjs`. Running these tests confirms:

```
node --test packages/*/test/*.test.mjs
→ 30 pass, 0 fail (confirmed this iteration)
```

The web-ui-browser.test.mjs file covers:
- GET / (task list): page title, h1 heading, table rows with task ids/statuses, task id links
- GET /task/:id (detail, todo status): page title, h1 with status bracket, back link, role/labels, action button presence
- GET /task/:id (detail, done status): negative control — no action button
- GET /task/NONEXISTENT-999: 404
- POST /task/:id/action/:actionId: 302 redirect, mock log record verification
- Content-Type charset assertion

All currently-existing capabilities/visual aspects of the Web UI have a committed browser-automation test. The fraction is 3/3 routes covered = 1.0 coverage.

Note: the body is rendered in `<pre>` block (raw text), which IS what the test verifies — it checks that `detail1.body.includes(...)` for the body text. This is correct per G5 — the test verifies current behavior, not ideal behavior.

Score: 1.0 — 100% of currently-existing capabilities have committed tests. This is the inherited floor from experiment 2's work, confirmed intact.

**backlog_health (§4.4 of protocol):**

Binary check against BOTH inherited snapshots:

**Quay-native snapshot (experiment 1 final, 8 V-factors):**
`node --test packages/*/test/*.test.mjs` → 30 pass, 0 fail. No source changes have been made this iteration. All test files confirm no regression:
- packages/quay/test/serve.test.mjs (QN-031 and related)
- packages/quay/test/web-ui-browser.test.mjs (QC-001, QC-002)
- packages/quay/test/core-three-way-symmetry.test.mjs (QC-003)
- packages/quay-native/test/ (experiment 1's suite)
- packages/quay-github/test/ (transfer target)
All 30 tests pass. No quay-native V-factor regressed below experiment 1's final snapshot.

**Quay-core-bootstrap snapshot (experiment 2 final, 4 V-factors):**
From iteration-10.md §7: core_abi_symmetry=1.0, web_ui_verification=1.0, action_delivery_mode=1.0, native_backlog_health=1.0. The same 30-test run above covers all four experiment-2 Done-when clauses (core-three-way-symmetry.test.mjs covers core_abi_symmetry; web-ui-browser.test.mjs covers web_ui_verification; serve-action-delivery.test.mjs covers action_delivery_mode; the full suite covers native_backlog_health). 30 pass, 0 fail confirms no regression.

Score: 1 (binary — no regression confirmed).

### 3b. V_meta re-trigger watchlist check

**Re-trigger 1 (effectiveness):** Did any QW-* task arise that is scope-matched to stage-0 QN-006's shape (single-file, no/minimal source change, no network I/O)?
NO — this iteration is observational. No QW-* tasks exist. The scope-matched task candidate watch begins at iteration 1.

**Re-trigger 2 (reusability):** Did organic external demand appear for wider GitHub Provider data.write capability?
NO — no demand observed. Same structural situation as experiment 2's 10-iteration absence.

**Re-trigger 3 (completeness gap discovery):** Was a new, previously-undocumented Skill Method-step gap found during unrelated work on the Skill files?
NO — both Skill files (quay:author/SKILL.md and quay:execute/SKILL.md) were read this iteration. No new undocumented gap found.

**Re-trigger 4 (unconditional primitive):** Did a reliable, unconditional native fresh-context subagent-dispatch primitive become available?
NO — ToolSearch deferred list confirms mcp__plugin_manda_manda__Agent is still the only primitive, and it remains conditional (daemon + non-self broker required).

**Re-trigger 5 (visual/UX-domain-specific):** Does the introduction of the independent holistic visual-review mechanism (§0c) itself surface a Skill Method-step gap not previously documented?
NOT YET DECIDABLE — the visual review mechanism is new to experiment 3 and has not yet been used (no visual change claimed, no review dispatched). The earliest this re-trigger can fire is iteration 1, when the first visual change is claimed and a visual review is dispatched. Will watch explicitly from iteration 1 onward.

**Re-trigger 5 (12-iteration fallback):** Has none of 1-5 fired within 12 iterations?
N/A — this is iteration 0. The fallback clock starts now; fallback obligation due by iteration 12 (or earlier, following experiment 2's precedent of early discharge at iteration 10).

### 3c. Parallel-advancement stall guard

N/A — iteration 0 is the baseline. No prior iterations exist. The stall guard begins tracking at iteration 1. Both factors (ui_read_capability, visual_design_quality) are at their starting values (0.20 and 0.0 respectively). Neither has "advanced" yet — there is no run to evaluate. Stall guard: NOT TRIGGERED (vacuously satisfied).

### 3d. Backlog health — test run evidence

```
node --test packages/*/test/*.test.mjs 2>&1 | tail -5
→ ℹ tests 30
  ℹ pass 30
  ℹ fail 0
  ℹ duration_ms ~23796
```

30 tests, 0 failures. Both inherited snapshots confirmed intact.

---

## 4. Strategy

This iteration is purely observational (per ITERATION-PROMPTS.md Iteration 0 design). No strategy for work execution is needed — the iteration's sole purpose is:
1. Confirm double inheritance boundary.
2. Make and record the σ_QW-vs-inherited-floor design decision.
3. Measure experiment 3's own V_instance baseline.
4. Run the V_meta ceiling diagnostic.
5. Check experiment 2's outstanding items.
6. Record in provenance.md and write this report.

No capability or visual change is planned. No QW-* tasks are created. No V_meta re-trigger evidence is claimed (none observed). No G3 or visual review dispatch is needed.

**Scope-boundary self-check**: no new write surface, no backend-specific conditional rendering considered. Read-only survey only. CONFIRMED.

---

## 5. Execution

Survey of packages/quay/src/serve.js and packages/quay/test/web-ui-browser.test.mjs read in full. Test suite run (30/30 pass). No source changes. No tasks created. No audits dispatched. All work is observational/measurement.

**Experiment 2's outstanding items check** (from iteration-10.md closing section, §"Problems identified for next iteration — For any experiment 3 design"):

1. **Effectiveness**: "any experiment targeting effectiveness improvement should design objectives that organically generate scope-matched source-logic tasks (single-file, logic change, no network I/O)."
   **Experiment 3's design**: the UI capability work (filter/sort/pagination, rendered markdown, frontmatter rendering) DOES generate source-logic tasks targeting packages/quay/src/serve.js — typically single-file changes to that file. Whether these organically match QN-006's shape (single-file, minimal source change, no network I/O) will be tested from iteration 1 onward. This is the concrete form protocol §5's own hypothesis predicts: "a domain as different as frontend/visual/UX work is a plausible candidate to organically re-trigger one or more of the four factors." This remains a LIVE HYPOTHESIS, not yet confirmed or denied.

2. **Reusability**: "any experiment targeting reusability improvement should design objectives that organically require GitHub Provider body/title writes."
   **Experiment 3's design**: UI visual/read work does NOT generate GitHub Provider body/title write demand. Re-trigger 2 is not expected to fire from this experiment's own objectives — this is acknowledged upfront, not a surprise. If it fires at all, it would be from an unrelated organic demand, not from experiment 3's own scope.

3. **Completeness**: "the conditionality gap (manda daemon + non-self broker required) can only be closed by an environment change providing an unconditional fresh-context primitive."
   **Experiment 3's design**: this is environmental and outside experiment 3's scope. No Skill evolution can fix this. Completeness will remain at 0.77 unless the environment changes.

4. **Validation**: "experiment 3 should either (a) reconsider the validation scoring formula's floor mechanics, or (b) design for more native-gate tasks per iteration by including work that naturally generates native-triple-provenance."
   **Experiment 3's design**: addressed by the explicit σ_QW-vs-inherited-floor design decision (§6 below, provenance.md context note). Decision: RESET the floor to 0. Validation tracks experiment 3's own σ_QW from a clean baseline. This addresses finding 4 directly: the floor mechanics are reconfigured at design time, not inherited silently.

5. **σ_QC growth pattern confirmed**: "four consecutive native-gate documentation tasks confirm the {native,native,native} provenance pattern is reproducible."
   **Experiment 3 implication**: this confirms native-triple provenance is achievable in this codebase's tooling environment. Experiment 3 can earn σ_QW credits for genuine UI source-logic tasks.

All 5 findings addressed or acknowledged. None blocked.

---

## 6. Provenance update

No QW-* tasks created or driven this iteration. σ_QW before: 0/0. σ_QW after: 0/0 (unchanged).

**σ_QW-vs-inherited-floor design decision (formally recorded here, cited from provenance.md):**

Decision: RESET the floor to 0 for experiment 3's own validation scoring.

Arithmetic for both floor candidates:

**Floor candidate A: experiment 2's own σ_QC = 4/10 = 0.40**
From σ_QW = 0/0, to reach 0.40 requires:
  n_native / n_total ≥ 0.40
  If all tasks are native: n_native / n_native = 1.0 ≥ 0.40 immediately.
  If some tasks are seed: e.g. 2 native / 5 total = 0.40 exactly.
  This is trivially achievable — the floor is low enough that experiment 3
  could exceed it within a few iterations. But using this floor as a target
  still creates a cross-experiment blending that obscures experiment 3's own
  native discipline. Not preferred.

**Floor candidate B: experiment 1's σ_strict = 62/73 = 0.8493**
From σ_QW = 0/0, if all QW tasks are native: n/n = 1.0 > 0.8493 always.
If any seed tasks exist in the denominator, the situation mirrors experiment
2: n/(non-native + n) ≥ 0.8493 → requires approximately
0.8493 × (non-native + n) ≤ n → non-native × 0.8493 ≤ n × (1 - 0.8493)
→ non-native × 0.8493 ≤ n × 0.1507 → n ≥ non-native × 5.63.
So 3 seed tasks require ≥ 17 native tasks to exceed this floor — possible
if UI work generates many native-triple tasks, but a trap if it does not.

**Decision rationale**: reset to 0. Validation = σ_QW (experiment 3's own).
- This is the honest choice: experiment 3's own native discipline is measured
  directly, without contamination from prior experiments' different task
  populations.
- It avoids the structural trap (sigma-inherited-floor-trap.md) where the
  inherited floor dominates indefinitely if seed tasks appear.
- It is most consistent with the principle that "σ resets to a fresh count
  scoped to experiment 3's own task population" (v3 proposal §6).
- If validation matters, every QW-* task should aim for native-triple
  provenance — this is the right incentive structure for experiment 3's UI
  source-logic work.

**Subsequent iterations cite this decision, not re-derive it.**

Inherited floor (context only, not operative): σ_QC = 4/10 = 0.40 (experiment 2's own).

---

## 7. V_instance

- **ui_read_capability**: **0.20** — the back-navigation link and action-button trigger behavior exist and are verified. All filter/sort/pagination capabilities absent. Task detail body rendered in raw `<pre>` block (not rendered markdown). `parent` and `children` frontmatter fields not rendered. Pagination threshold not yet established. This is 1 of ~5 substantive capability groups partially implemented. Score reflects the walking-skeleton v0 state.

- **visual_design_quality**: **0.0** — no Lighthouse audit run (no visual change claimed, observational iteration). No independent holistic visual review dispatched (§0c requirement explicitly not triggered — no visual change). The current UI is an unstyled raw HTML dump using table borders, no CSS, no consistent styling system. This score cannot be non-zero without both (a) a Lighthouse accessibility ≥ 90 / best-practices ≥ 90 mechanical threshold AND (b) an independent holistic PASS verdict, neither of which exists at baseline. Score: 0.0 (floor).

- **verified_by_construction**: **1.0** — 3/3 currently-existing routes (GET /, GET /task/:id, POST /task/:id/action/:actionId) have committed browser-automation tests in `packages/quay/test/web-ui-browser.test.mjs`, confirmed passing by this iteration's test run (30/30 pass). This factor is 1.0 at the inherited baseline because experiment 2's QC-001 and QC-002 specifically targeted this coverage. Note: this is the CUMULATIVE fraction of currently-existing capabilities covered — new capabilities added in future iterations must be covered in the same iteration they land, or this factor drops below 1.0.

- **backlog_health**: **1** — both inherited snapshots confirmed unregressed by `node --test packages/*/test/*.test.mjs` → 30 pass, 0 fail. No source changes made this iteration.

- **Total**: 0.20 × 0.0 × 1.0 × 1.0 = **0.0**

The product collapses to zero because `visual_design_quality = 0.0`. This is the correct, honest baseline — the product formula structurally enforces that zero visual quality scores as zero experiment quality, which is the human's intent (parallel advancement required). The baseline is not alarming; it simply reflects that no visual work has been done yet.

---

## 8. V_meta

**Inherited starting values (from experiment 2's iteration-10.md §8, §11 — NOT re-derived from zero, NOT from experiment 1's 0.0973):**

- **completeness**: **0.77** — re-trigger check 3 and 4: NOT fired. Both Skill files read; no new undocumented gap found. ToolSearch confirms mcp__plugin_manda_manda__Agent is the only subagent primitive; it remains conditional (daemon + non-self broker per DIR-020). The conditionality-only gap is unchanged.
  Stall reason (SAME dimension as experiment 2's stall): "Conditional primitive confirmed reliable across six task types (6/6 across three tiers). The unconditional gap remains — daemon + non-self broker required per DIR-020." This is the same characterization as experiment 2's iteration 10 §8, narrowed from experiment 1's "no primitive" to "conditional primitive, conditionality-only gap." No further narrowing occurred this iteration (observational only).

- **effectiveness**: **0.26** — re-trigger check 1: NOT fired (no QW-* tasks exist). The re-trigger watchlist is active from iteration 1 onward. The live hypothesis (protocol §5) that frontend/visual/UX work will organically re-trigger this factor is noted and will be tested.
  Stall reason (SAME dimension as experiments 1 and 2): "No scope-matched QW-* task has arisen (σ_QW = 0/0). Re-trigger requires a QW-* task with shape: single source file, logic change, no network I/O. This has not arisen in any prior experiment either; experiment 3 is the first with scope that could organically generate such tasks (single-component serve.js edits). Will check re-trigger 1 at every iteration from iteration 1 onward."
  
  **Standing timing-recording instruction** (inherited): when a scope-matched task arises organically, record wall-clock start/end times for each Method phase. QN-006 baseline: author ~51s, execute ~2m59s (179s).

- **reusability**: **0.79** — re-trigger check 2: NOT fired (no organic GitHub Provider body/title write demand observed). Same structural situation as experiment 2's 10-iteration absence. Experiment 3's own UI-scope objectives do not generate this demand by design.
  Stall reason (SAME dimension as experiments 1 and 2): "No organic demand for GitHub Provider body/title writes. v1 scope constraint (QN-024, status-only data.write) unchanged. github-client.js code-level confirmation carried forward from experiment 2's iteration-10 §3b re-trigger 2 — no code-level change has occurred."

- **validation**: **0.64** — σ_QW = 0/0. Floor: RESET TO 0 (see §6, provenance.md context note). With the floor reset to 0, validation WILL track σ_QW directly from the first QW-* task. At σ_QW = 0/0, validation is indeterminate (no tasks yet). The inherited value of 0.64 is carried forward as the starting value for bookkeeping consistency (matching experiment 2's stopping point), but from iteration 1 onward, validation = σ_QW where σ_QW = (all-native QW-* tasks) / (total QW-* tasks).
  
  Inherited floor (context only, not operative): σ_QC = 4/10 = 0.40.

- **Total**: 0.77 × 0.26 × 0.79 × 0.64

  Arithmetic:
  0.77 × 0.26 = 0.2002
  0.2002 × 0.79 = 0.158158
  0.158158 × 0.64 = 0.101221 → **0.1012**

- **ΔV_meta from inherited baseline (0.1012)**: 0.00 (this iteration is observational; no factors changed)
- **12-iteration fallback count**: 0/12 (clock starts now; obligation due by iteration 12 or earlier)

**MATHEMATICAL CEILING (carried as standing fact from experiment 2, first stated at experiment 2's iteration 6, now confirmed as inherited):**
V_meta_ceiling = 1.0 × 0.26 × 1.0 × 1.0 = **0.26 < 0.80**.
Criterion 1 (V_meta ≥ 0.80) is arithmetically unreachable unless `effectiveness` moves from 0.26. This is a pure arithmetic fact, not a judgment. It remains a standing fact until/unless re-trigger 1 fires with evidence (a QW-* task organically scope-matched to QN-006's shape — single-file, logic change, no network I/O).

**Stall diagnosis (per-factor):**
1. completeness (0.77): SAME dimension as experiment 2 (and experiment 1). No change.
2. effectiveness (0.26): SAME dimension as experiments 1 and 2. The stall reason in experiment 3 may become DIFFERENT if a scope-matched QW-* task arises — this is the live hypothesis. Not yet fired.
3. reusability (0.79): SAME dimension as experiments 1 and 2. No change expected from experiment 3's scope.
4. validation (0.64): Design choice made this iteration (floor RESET). From iteration 1, the stall reason changes: validation will track σ_QW directly (floor = 0), not against an inherited floor. This is a DIFFERENT stall reason than experiment 2's ("inherited floor dominates σ_QC"). If validation stays at 0.64 after several iterations, the new stall reason will be "σ_QW < 0.64, meaning fewer than 64% of QW-* tasks have native-triple provenance" — a different characterization than experiment 2's arithmetic impossibility.

---

## 9. Out-of-band audit (G3)

G3 not triggered this iteration — no Core change (no files in packages/quay/src/ or packages/quay-native/src/ or packages/quay-github/ were modified; this iteration is observational only), and no V-factor lift (V_meta = 0.1012 unchanged from inheritance; V_instance baseline established at 0.0, which is not a lift from any prior value).

**Dispatcher reminder (re-stated per §0 / ITERATION-PROMPTS.md §0 requirement):** G3 audit dispatched by the ORCHESTRATOR via the NATIVE Agent/Task tool (run_in_background=true). Never by the iteration-executor's own session. Never via manda nested-subagent. This is the permanent G3 mechanism (g3-audit-discipline.md + DIR-003 correction). No drift from this mechanism has occurred this iteration (no G3 dispatch attempted at all).

---

## 9a. Independent holistic visual review

Visual review not triggered this iteration — no visual change claimed. The baseline state of the Web UI (unstyled raw HTML table) is documented in §3a as the starting point, but no claim of visual_design_quality movement is made. Per protocol §4.2 and ITERATION-PROMPTS.md §0c, a visual review is only dispatched when a visual change is claimed — and none has been made.

**Dispatcher reminder:** independent holistic visual review dispatched by the ORCHESTRATOR via the NATIVE Agent/Task tool (run_in_background=true), from a FRESH CONTEXT — never the same session that made the change, never via manda. The review agent takes a real screenshot via chrome-devtools/playwright MCP, judges the page/flow AS A WHOLE FIRST (not checklist-first), renders PASS/CONCERNS/FAIL. CONCERNS/FAIL blocks crediting visual_design_quality movement for that page/flow.

No review dispatched, none needed this iteration.

---

## 10. Convergence Check

- **[ ] 1. Dual threshold (V_instance ≥ 0.80 AND V_meta ≥ 0.80)**: NOT MET.
  V_instance = 0.0 (visual_design_quality collapses product to zero at baseline).
  V_meta = 0.1012 (far below 0.80; mathematically ceilinged at 0.26 while effectiveness stays frozen).
  Neither criterion met.

- **[ ] 2. All 4 "Done when" clauses**:
  - ui_read_capability "Done when": NOT SATISFIED — filter, sort, pagination, rendered markdown, parent/children rendering all absent.
  - visual_design_quality "Done when": NOT SATISFIED — no page passes Lighthouse threshold, no holistic review dispatched.
  - verified_by_construction "Done when": PARTIALLY SATISFIED — 3/3 currently-existing capabilities covered (1.0), but this factor degrades to <1.0 the moment any new capability ships without a test.
  - backlog_health "Done when": SATISFIED each iteration — 30/30 tests pass, no regression. But binary — it stays 1 only if re-confirmed each iteration.
  Overall: NOT SATISFIED (first two "Done when" clauses not met).

- **[ ] 3. V_meta genuine movement (≥2 factors, different stall reason)**: NOT MET.
  V_meta = 0.1012, unchanged from inheritance (ΔV_meta = 0.00). No factor moved this iteration (observational only). Re-trigger 5 (visual/UX-domain-specific) is the key new candidate to watch — not yet fired. Criterion 3 requires ≥2 factors to show real movement from the inherited 0.1012 baseline.

- **[ ] 4. Out-of-band audit (G3) green for all Core/lift tasks**: MET (vacuously).
  No Core change, no V-factor lift. G3 not triggered. No failing audit exists. Vacuously satisfied, same as experiment 2's iteration 10's criterion 4.

- **[ ] 5. Independent holistic visual review green (no open CONCERNS/FAIL)**: N/A.
  No visual change claimed, no review dispatched, no open CONCERNS/FAIL. Vacuously satisfied.

- **[ ] 6. Parallel-advancement stall guard (no unexplained 3+-iteration one-sided run)**: N/A.
  No prior iterations; no run to evaluate. Vacuously satisfied.

- **[ ] 7. Diminishing returns (ΔV < 0.02 for 2+ iterations, both V's)**: NOT MET.
  Only one iteration of data (iteration 0). Need 2+ consecutive iterations of ΔV < 0.02 on BOTH V_instance and V_meta.

**Status**: NOT CONVERGED.
Expected and correct at iteration 0. All seven criteria either not met or vacuously satisfied at baseline. No criterion is met with positive evidence yet.

---

## Problems identified for next iteration

1. **V_instance = 0.0**: visual_design_quality = 0.0 collapses the product. Iteration 1 must advance at least one capability/visual change to move the product off zero — but BOTH ui_read_capability AND visual_design_quality must advance together (parallel-advancement constraint). A single iteration that advances only one is permissible, but must not become a pattern exceeding 2 consecutive iterations.

2. **visual_design_quality must be established before ui_read_capability racing ahead**: the product formula and §4.5 stall guard both require parallel advancement. Iteration 1 should plan to advance both factors simultaneously, or explicitly justify why one lags.

3. **ui_read_capability gaps to close (in priority order for "Done when" clause progress)**:
   a. Rendered markdown body (body in `<pre>` is raw text — render as HTML)
   b. Filter by status (add query param + UI affordance)
   c. Sort by id / status (add sort param)
   d. Filter by label
   e. Pagination threshold establishment + implementation
   f. parent/children frontmatter rendering

4. **visual_design_quality work needed**: a consistent styling system must be applied before any holistic review is worth dispatching. The current state (bare HTML, `border="1"` table) would receive a FAIL holistic verdict. A minimal CSS reset/theme is the prerequisite for a Lighthouse run worth reporting.

5. **verified_by_construction continuity requirement**: every new capability or visual change must ship with a browser-automation test IN THE SAME ITERATION it lands. Iteration 1's plan must include the test alongside the implementation, not as a follow-up. Failure to do so would immediately reduce verified_by_construction from 1.0.

6. **Pagination threshold**: the protocol says "threshold to be set by the first iteration that measures it, recorded explicitly, not assumed." Iteration 1 should measure and record the single-page-reasonable count threshold. Suggested approach: use 20 tasks as the threshold (a standard "one screenful" heuristic), to be confirmed when the task list is actually rendered in a real browser session during visual review.

7. **visual review dispatch mechanism**: iteration 1 must dispatch the independent holistic visual review via the orchestrator/native Agent/Task tool when the first visual change is claimed. Re-state the dispatcher mechanism explicitly in iteration 1's §2 preconditions, per the §0 requirement ("re-state the correct dispatcher/mechanism at the start of every iteration rather than assuming it will be remembered").

8. **effectiveness re-trigger watch**: if iteration 1 implements a single-file change to serve.js (e.g., adding rendered markdown or a filter UI) that qualifies as scope-matched to QN-006 (single source file, logic change, no network I/O), record wall-clock timing. This is the first real opportunity for effectiveness re-trigger in experiment 3's history.
