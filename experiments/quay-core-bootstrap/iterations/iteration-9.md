# Iteration 9: QC-009 — README.md §2 update + §9 Practical Convergence Assessment

**Date**: 2026-07-16
**Driver**: native (degraded fallback) for QC-009 authoring/execution; native for gate_by
(Skill's own gate-check Method step). All three provenance fields = native (third consecutive
iteration with native triple).
**Instance objectives advanced**: none (V_instance stable at 1.0; maintained)
**V_meta triggers checked**: all four re-trigger conditions checked (9/12); none fired.
QC-009 is documentation-only (README.md); not scope-matched for effectiveness re-trigger.
No organic GitHub write demand (reusability). No new Skill gap discovered (completeness).
ToolSearch confirms `mcp__plugin_manda_manda__Agent` remains the only subagent primitive —
conditional, not unconditional (completeness + joint re-trigger 4).

---

## 1. Context from prior iteration

**σ_QC before**: 2/8 = 0.25 (QC-007 and QC-008 both native-gate)
**V scores entering iteration 9**:
- core_abi_symmetry = 1.0
- web_ui_verification = 1.0
- action_delivery_mode = 1.0
- native_backlog_health = 1.0
- V_instance = **1.0** (stable since iteration 3)
- V_meta = 0.77 × 0.26 × 0.79 × 0.64 = **0.1012** (ΔV_meta = 0.00 for iterations 6, 7, 8)

**Problems inherited from iteration 8**:
1. Mathematical ceiling: V_meta ceiling = 0.26 (effectiveness=0.26). Criterion 1 (V_meta ≥
   0.80) is mathematically unreachable without effectiveness moving.
2. ΔV_meta = 0.00 for three consecutive iterations (6, 7, 8). No score movement.
3. σ_QC = 2/8: two native-gate tasks (QC-007, QC-008). Inherited floor (0.8493) dominates.
4. Reusability same stall (8 consecutive iterations in experiment 2). No quay-github demand.
5. Effectiveness two missing preconditions (8 iterations). Standing timing-recording
   instruction in place from iteration 7/8.
6. Fallback count: 8/12. Four iterations remain before mandatory comprehensive search.
7. Practical convergence assessment from iteration 8 §11: if no re-trigger fires by iteration
   10, accept practical convergence.

**Tasks in directives/pending/**: NONE (confirmed by `ls` — empty directory).

---

## 2. Preconditions checked

**Daemon address** (read from `.manda/hub.addr`, not hardcoded):
```
cat /home/yale/work/quay/.manda/hub.addr
→ http://localhost:46215

curl -s http://localhost:46215/healthz
→ {"root":"/home/yale/work/quay"}  (exit 0)
```
Daemon live. CONFIRMED.

**Cord broker processes** (`ps aux | grep "manda monitor" | grep -v grep`):
```
PID 1065935: manda monitor cord --root . (started 16:23, orchestrator session)
PID 1301517: manda monitor cord --root . (started 17:45, second session)
PID 1302543: manda monitor cord --root . (started 17:46, third session)
```
Three cord brokers confirmed running. DIR-020 precondition satisfied — this session does
not own any broker.

**G6 assessment**: DIR-020 precondition MET. Daemon live. Non-self broker confirmed (three
orchestrator-session processes, PIDs confirmed). Practical precondition for manda Agent
calls satisfied.

**provenance.md**: read at session start (118 lines pre-update → well below 1,500 limit).
**iteration-8.md**: read in full at session start.
**Skill files**: quay:author/SKILL.md and quay:execute/SKILL.md read at session start.
**v-meta-stall-analysis.md**: read at session start.
**directives/pending/**: empty — confirmed by `ls`. No pending directives.

---

## 3. Observe

### 3a. Instance objective state (all four "Done when" clauses)

All four confirmed stable from iteration 8. No source changes this iteration.
- core_abi_symmetry: 1.0 — abi-symmetry script covers all three surfaces, runs in automated
  suite, all symmetry gaps filed as QC-* tasks (iteration 3). Unchanged.
- web_ui_verification: 1.0 — every reachable page/flow has at least one browser-automation
  test (iterations 1-2). Unchanged.
- action_delivery_mode: 1.0 — mock default + labeled live check (iteration 2). Unchanged.
- native_backlog_health: 1.0 — `node --test packages/*/test/*.test.mjs` → 30 pass, 0 fail.
  No source changes this iteration. Unchanged.

### 3b. V_meta re-trigger search (9/12, all four mandatory)

**Re-trigger 1 — effectiveness**: Is there any QC-* task in the backlog or about to be
created for QC-009+ that involves source-logic implementation matching QN-006's scope
(single-file, logic change, no network I/O)?

Checked: QC-009 is documentation-only (README.md update). No source-logic task is present
or planned. The backlog (`tasks/QC-001.md` through `tasks/QC-008.md`) is entirely done —
all tasks complete. The QC-009 creation for this iteration is itself documentation. No
scope-matched task arises. Re-trigger 1 **does NOT fire**.

Stall reason: SAME two dimensions as iterations 7-8. "Stage-0 QN-006 baseline confirmed at
`experiments/quay-native-bootstrap/timing/iteration-0.log` (author ~51s, execute ~2m59s).
No scope-matched QC-* task has arisen (iterations 1-9 produced only documentation and
browser-test tasks). Standing timing-recording instruction now in ITERATION-PROMPTS.md and
both Skill files. QC-009 timing recorded (author ~225s, execute ~465s) but not scope-matched
(documentation, not source logic)."

**Re-trigger 2 — reusability**: Is there any organic demand for quay-github Provider write
capability (body/title writes against real issues)?

Checked: no QC-* tasks involve GitHub issue creation or body/title modification. `grep`
of `packages/quay-github/src/github-client.js` confirms: no body/title write path exists
(confirmed iteration 7's code-level grep; no new writes added in iterations 8-9). No GitHub
issues or quay-native backlog entries reference `data.write` extension. Re-trigger 2 **does
NOT fire**.

Stall reason: SAME as experiment 1. 9th consecutive iteration. No organic demand for
body/title writes in `packages/quay-github/`.

**Re-trigger 3 — completeness (gap discovery)**: Was a new, previously-undocumented Skill
Method-step gap found during unrelated work on the Skill files?

Checked: no Skill file modifications this iteration (QC-009 touches only README.md). No
incidental discovery of an undocumented gap during README editing. Re-trigger 3 **does NOT
fire**.

**Re-trigger 4 — completeness + joint (unconditional primitive)**: Did a reliable,
unconditional native fresh-context subagent-dispatch primitive become available?

Checked via ToolSearch (query: "Agent spawn subagent unconditional"): result is
`mcp__plugin_manda_manda__Agent` — the same conditional manda-proxied Agent confirmed in
iterations 4-8. The tool description states "forwarded to the parent broker via the
agent.spawn capability." This remains conditional (daemon live + non-self broker required
per DIR-020). No unconditional primitive found. Re-trigger 4 **does NOT fire**.

**Fallback count**: 9/12. Three iterations remain before the mandatory dedicated full search
at iteration 12.

### 3c. Completeness ceiling re-assessment (tertiary objective)

Current completeness = 0.77. The ceiling is "conditionality not reliability":
- 6/6 manda trials (iterations 4-8) confirm reliable operation when preconditions met.
- Preconditions (daemon + non-self broker) remain required per DIR-020.
- ToolSearch (this iteration, §3b re-trigger 4) reconfirms: only conditional primitive
  (`mcp__plugin_manda_manda__Agent`) available.
- No additional manda trials were run this iteration (per the standing assessment: further
  trials do not change the conditionality gap — established iteration 8).

**Determination**: completeness ceiling assessment is unchanged. Score remains 0.77.
The gap is conditionality-only. Additional reliability trials would not move the score
and are explicitly not warranted (the 6/6 track record settled the reliability question).

---

## 4. Strategy

**Primary objective** (QC-009, σ_QC growth): Drive a new documentation task through the
full quay:author / quay:execute degraded-fallback Method sequence to earn a third
{native, native, native} provenance credit. Task chosen: update `experiments/quay-core-
bootstrap/README.md` §2 (stale V scores, σ_QC) and add §9 Practical Convergence Assessment
(missing from README; present in iteration-8.md §11).

Rationale for task choice:
- Small, bounded, clearly completable in one session (single file, no source changes).
- Does NOT require Core source logic implementation (stays outside this experiment's
  domain scope for Core).
- IS documentation/methodology work (in scope: the README is the experiment's own
  standing record).
- The gap is genuine (README §2 shows iteration-0 values, not current values).
- Recording timing serves the standing instruction even though scope-match will not fire.

**Secondary objective** (V_meta re-trigger search 9/12): all four re-trigger conditions
checked in §3b. None fire. Documented.

**Tertiary objective** (completeness ceiling re-assessment): confirmed unchanged at §3c.
No additional manda trials run.

**Quaternary objective** (practical convergence decision): documented at §11.

**G3 trigger assessment (pre-execution)**: QC-009 touches only README.md — a documentation
file in experiments/, not a source file in any package. No Core change → G3 not triggered
per §Core-scope constraints item 5. No V-factor lift anticipated (V_instance = 1.0 stable;
V_meta re-triggers not firing). G3 will be vacuously satisfied if execution confirms no
lift.

---

## 5. Execution

### 5a. Preconditions verified

`.manda/hub.addr` → `http://localhost:46215`. `curl -s .../healthz` → `{"root":...}`.
Broker PIDs 1065935, 1301517, 1302543 confirmed via `ps aux | grep "manda monitor cord"`.
Three brokers; none is a child of this session. DIR-020 MET.
`ls experiments/quay-core-bootstrap/directives/pending/` → empty. No pending directives.
`wc -l experiments/quay-core-bootstrap/provenance.md` → 118 lines (well below 1,500 limit).

### 5b. QC-009 authored via quay:author degraded-fallback Method

**Author phase start timestamp**: 2026-07-16T19:10:00Z

**Step 1 (write-proposal)**: `mcp__quay__task_write(id="QC-009", ...)` — task created
with Proposal identifying two specific gaps: (a) §2 code block shows iteration-0 state
values (σ_QC=0/0, V_meta=0.0973, V_instance=0) rather than current values; (b) §9
"Practical Convergence Assessment" is absent from README (present only in iteration-8.md §11).

**Step 2 (review-proposal)** — degraded-fallback checklist:
- (a) `## Proposal` heading present: YES
- (b) Content exceeds trivial floor, names specific gaps: YES — two gaps with file-level
  and iteration references; concrete stale values identified
- (c) Approach names specific, real gap: YES — primary source (README.md §2) confirmed
  by reading the file; stale values verified against current provenance.md state
- Checklist: PASS

**Step 3 (write-plan)**: Three phases. Decompose test: single file (README.md) — not ≥2
independently mergeable deliverables. Remain leaf (primitive role, confirmed by task_write
response).

**Step 4 (review-plan)** — degraded-fallback checklist:
- (a) Plan phases map onto AC items: Phase 1 → AC 1+2+3, Phase 2 → AC 4, Phase 3 → AC 5.
  YES
- (b) AC section contains ≥1 real checkbox: 5 items. YES
- (c) DoD is a real checklist, not restated AC: YES (DoD names functional outcomes; AC
  names mechanical verification checkboxes)
- Checklist: PASS

**Step 5 (author gate-check)**:
`mcp__quay__task_check(id="QC-009")` → `{"gate":"author->ready","ok":false,
"artifacts":{"proposal":true,"plan":true,"ac":true,"dod":true},"acTotal":5,
"acChecked":0,"reason":"0/5 AC checkboxes checked"}`
All artifacts present. AC not yet executed — correct pre-execution state.

**Author phase end timestamp**: 2026-07-16T19:13:45Z (~225 seconds for author phase)

### 5c. QC-009 executed via quay:execute degraded-fallback Method

**Execute phase start timestamp**: 2026-07-16T19:13:45Z

**implement-phase (Phase 1)**: Edited `experiments/quay-core-bootstrap/README.md` §2
"Inheritance baseline" code block:
- V_instance line: `0.0 × 0.0 × 0.0 × 1.0 = 0` → `1.0 × 1.0 × 1.0 × 1.0 = 1.0`
  with annotation "All four 'Done when' clauses satisfied since iteration 3."
- V_meta line: `0.74 × 0.26 × 0.79 × 0.64 = 0.0973` → `0.77 × 0.26 × 0.79 × 0.64 = 0.1012`
  with annotation "completeness raised 0.74→0.77 in iteration 6" and ceiling note.
- σ_QC line: `0/0 (no tasks yet)` → `2/8 = 0.25 (QC-007, QC-008 are first native-gate tasks)`
- Section header updated to note "Starting scores (iteration 0) and current state
  (iteration 9 in progress)."

**implement-phase (Phase 2)**: Added `## 9. Practical Convergence Assessment` section
to README.md (placed before §5 Guardrails to maintain reading order). Content:
- Source attribution: `iterations/iteration-8.md §11` (2026-07-16)
- Subsection "Criteria satisfied (criteria 2, 4, 5)": summarizes Done-when clauses
  complete (iteration 3), ΔV stable since iteration 5, G3 vacuously satisfied (iterations 4-8).
- Subsection "Criteria structurally unsatisfiable (criteria 1 and 3)": states arithmetic
  ceiling (V_meta_ceiling = 0.26 < 0.80), effectiveness stall since iteration 23, and
  external-event dependency for criteria 3 re-triggers.
- Subsection "Recommendation": if no re-trigger by iteration 10, accept practical
  convergence. Cross-reference to `iterations/iteration-8.md §11d`. Fallback rule noted:
  dedicated full search mandatory at iteration 12 if no re-trigger fires in 12 total
  iterations.

**implement-phase (Phase 3)**: `git diff --stat HEAD` → only
`experiments/quay-core-bootstrap/README.md | 54 ++++++++++++++++++++++++++++---` changed.
`node --test packages/*/test/*.test.mjs` → 30 pass, 0 fail.

**self-audit-ac** — degraded-fallback same-session re-verification:
- AC 1 (`1.0 × 1.0 × 1.0 × 1.0 = 1.0`): VERIFIED. `grep "1.0 × 1.0 × 1.0 × 1.0"
  README.md` → found in §2 code block. PASS.
- AC 2 (`0.77 × 0.26 × 0.79 × 0.64 = 0.1012`): VERIFIED. `grep "0.77 × 0.26 × 0.79
  × 0.64 = 0.1012" README.md` → found in §2 code block. PASS.
- AC 3 (`2/8 = 0.25`): VERIFIED. `grep "2/8 = 0.25" README.md` → found in §2 code block
  (σ_QC line). PASS.
- AC 4 (§9 with criteria 2/4/5 satisfied, 1/3 unsatisfiable, iteration-8 §11 cross-ref):
  VERIFIED. `grep "## 9\. Practical" README.md` → heading found. Subsections confirmed:
  "Criteria satisfied (criteria 2, 4, 5)" and "Criteria structurally unsatisfiable
  (criteria 1 and 3)" present. `grep "iteration-8.md §11" README.md` → found twice
  (source attribution and recommendation). PASS.
- AC 5 (30/30 tests pass; only README.md changed): VERIFIED. `node --test` → 30 pass, 0
  fail. `git diff --stat HEAD` → only README.md changed. PASS.

Updated task body with 5/5 AC checkboxes checked, DoD 4/4 checked.

**gate-check (quay:execute Method step 3 — THE SKILL'S OWN GATE STEP)**:

`mcp__quay__task_check(id="QC-009")` → `{"gate":"author->ready","ok":true,
"artifacts":{"proposal":true,"plan":true,"ac":true,"dod":true},"reason":"all four
artifacts present; eligible to move to ready"}`
Advanced to ready: `quay task edit QC-009 --status ready`.

`mcp__quay__task_check(id="QC-009")` → `{"gate":"execute->done","ok":true,
"acTotal":5,"acChecked":5,"reason":"all AC checkboxes checked; eligible to move to done"}`
Advanced to done: `quay task edit QC-009 --status done`.

This `mcp__quay__task_check` call is the final step of the quay:execute Method (step 3:
gate-check). The Skill's Method structure was the operative driver — status was advanced
TO DONE based on this gate's `ok: true` return. This is gate_by = native.

**Execute phase end timestamp**: 2026-07-16T19:21:30Z (~465 seconds for execute phase)

**QC-009: DONE.** Gate confirmed mechanically by the Skill's own gate-check Method step.

**QC-009 timing summary**:
- Author phase: 2026-07-16T19:10:00Z → 2026-07-16T19:13:45Z = **~225s (~3m45s)**
- Execute phase: 2026-07-16T19:13:45Z → 2026-07-16T19:21:30Z = **~465s (~7m45s)**
- Total: **~690s (~11m30s)**
- QN-006 baseline (from `experiments/quay-native-bootstrap/timing/iteration-0.log`):
  author ~51s, execute ~2m59s (179s), total ~3m47s (227s)
- Scope-match verdict: NOT scope-matched. QC-009 is documentation updates to README.md.
  QN-006 was a single source file (store.js), file-locking logic implementation, no
  network I/O. The timing comparison is recorded for methodological completeness but does
  NOT fire the effectiveness re-trigger.
- Notable: QC-009 total (~690s) is significantly longer than QN-006 (~227s). This is
  consistent with QC-009 being a multi-section documentation task (two distinct edit
  operations plus the Method sequence overhead) vs. QN-006's single-file logic change.
  The longer absolute time further confirms these are not scope-matched task types.

---

## 6. Provenance update

**QC-009** (2026-07-16, iteration 9):
- author_by: **native** (degraded fallback) — Method steps explicitly followed in sequence
  with SKILL.md as the operative guide (write-proposal → review-proposal → write-plan →
  review-plan → gate; each step explicitly named and executed per SKILL.md §5b above).
- execute_by: **native** (degraded fallback) — same: implement-phase (Phases 1-3) →
  self-audit-ac → gate-check; each step explicitly named and executed per SKILL.md §5c
  above.
- gate_by: **native** — gate-check (`mcp__quay__task_check`) was run as the FINAL step
  of the quay:execute Method sequence (step 3 of Method), with status advanced to `done`
  based on that gate's `ok: true` return. The Skill's own gate assertion was the operative
  driver.
- σ contribution: **3/9** — all three fields native; QC-009 is the third task contributing
  to the σ_QC numerator (after QC-007 and QC-008).

**σ_QC before this iteration**: 2/8 = 0.25
**σ_QC after this iteration**: 3/9 = 0.333

**Validation score impact**: σ_QC = 3/9 = 0.333. Inherited floor σ_strict = 0.8493.
0.333 < 0.8493 → inherited floor still dominates. Validation = 0.64 (unchanged).

**Inherited floor**: σ_strict = 0.8493 (experiment 1's final value — context only).

**σ_QC growth trajectory**: 0 → 1/7 → 2/8 → 3/9. Three consecutive native-gate tasks
(QC-007, QC-008, QC-009). Numerator grows at +1/iteration; denominator also grows at
+1/iteration. At this rate (all remaining tasks native-gate), reaching σ_QC ≥ 0.8493
requires approximately n/(9+n) ≥ 0.8493 → n ≥ 0.8493×(9+n) → n(1-0.8493) ≥ 7.6437 →
n ≥ 50.7. That is approximately 51 more consecutive native-gate tasks — a structural
impossibility within this experiment's natural scope.

---

## 7. V_instance

- **core_abi_symmetry**: 1.0 — unchanged. No source file changes this iteration.
  Confirmed by 30/30 test suite pass.

- **web_ui_verification**: 1.0 — unchanged. All routes covered.
  Confirmed by 30/30 test suite pass.

- **action_delivery_mode**: 1.0 — unchanged. Mock default + labeled live check.
  Confirmed by 30/30 test suite pass.

- **native_backlog_health**: 1.0 — `node --test packages/*/test/*.test.mjs` → 30 pass,
  0 fail. Only README.md (documentation file in experiments/) modified — no source files
  in packages/quay/, packages/quay-native/src/, or packages/quay-github/ were touched.
  `git diff --stat HEAD` confirms single-file change. No regression possible.

- **Total**: 1.0 × 1.0 × 1.0 × 1.0 = **1.0**
- **ΔV_instance**: 0.00 (held at 1.0 from iteration 3; ninth consecutive iteration at 1.0)

---

## 8. V_meta

All four re-trigger conditions checked (§3b above). None fired.

- **completeness**: **0.77** — no change.

  Re-trigger 4 checked: NOT fired. ToolSearch this iteration confirms only
  `mcp__plugin_manda_manda__Agent` available — same conditional primitive (daemon + non-
  self broker required per DIR-020). "Unconditional" gap remains. Completeness ceiling:
  gap is conditionality only (not reliability — 6/6 settled the reliability question in
  iteration 8). Further reliability trials or ToolSearch passes will not change this score
  unless a new unconditional primitive appears.

  Re-trigger 3 checked: NOT fired. No Skill file modifications this iteration. No incidental
  gap discovery.

  **Stall reason** (SAME dimension as iterations 7-8): "Conditional primitive confirmed
  reliable for all tiers (6/6 across diverse task types). The unconditional gap remains.
  Completeness ceiling: gap is conditionality only."

- **effectiveness**: **0.26** — re-trigger 1 checked; does not fire.

  **QC-009 timing recorded** (per standing timing-recording instruction):
  - Author phase: ~225s (vs QN-006 ~51s baseline)
  - Execute phase: ~465s (vs QN-006 ~179s baseline)
  - Total: ~690s (vs QN-006 ~227s baseline)

  **QC-009 scope-match verdict: NOT scope-matched.**
  QN-006 required source-logic implementation (store.js, file-locking). QC-009 is
  documentation updates to README.md. The timing data is recorded for methodological
  completeness but the comparison is invalid (different work types, different time
  profiles; QC-009's longer time is consistent with multi-section documentation, not
  source-logic efficiency differences).

  **Stall reason** (SAME two dimensions as iterations 7-8): "Stage-0 QN-006 timing
  baseline confirmed at `experiments/quay-native-bootstrap/timing/iteration-0.log`
  (author ~51s, execute ~2m59s). No scope-matched QC-* task has arisen (iterations 1-9
  produced only documentation and browser-test tasks). Timing-recording standing
  instruction in ITERATION-PROMPTS.md and both Skill files. QC-009 timing recorded
  (author ~225s, execute ~465s) but not scope-matched. Two preconditions remain absent:
  (1) scope-matched task (single source file, logic change, no network I/O); (2) timing
  for such a task."

  **9-iteration pattern**: no scope-matched task has arisen in 9 consecutive iterations
  (1-9). This is the longest continuous stall in the experiment's history — exceeding
  even experiment 1's standstill duration at comparable stage.

- **reusability**: **0.79** — re-trigger 2 checked; does not fire.

  **Stall reason**: SAME as experiment 1. 9th consecutive iteration. No organic demand
  for body/title writes in `packages/quay-github/`. v1 scope constraint (`data.write`
  status-only, QN-024) unchanged. Code-level confirmation (iteration 7 grep): no
  body/title write path in `github-client.js`.

- **validation**: **0.64** — σ_QC = 3/9 = 0.333; inherited floor still dominates.

  **Score arithmetic**: σ_QC = 3/9 = 0.333. Inherited floor σ_strict = 0.8493. 0.333 <
  0.8493 → inherited floor dominates. Validation = 0.64 (unchanged).

  **σ_QC trajectory analysis**: Three consecutive native-gate tasks (QC-007, QC-008,
  QC-009). At current rate (+1 numerator, +1 denominator per iteration), reaching
  σ_QC ≥ 0.8493 requires approximately 51 more consecutive native-gate tasks (calculation
  in §6). This is not achievable within this experiment's natural scope. The inherited
  floor will dominate validation for the remainder of this experiment.

  **Stall reason** (SAME dimension as iteration 8, updated numerically): "QC-007, QC-008,
  QC-009 are all native-gate; σ_QC = 3/9 = 0.333. Inherited floor 0.8493 still dominates.
  Score will not move until experiment 2's own σ_QC exceeds 0.8493 — requires approximately
  51 more consecutive native-gate tasks given current denominator trajectory (structural
  impossibility within this experiment's scope)."

- **Total**: 0.77 × 0.26 × 0.79 × 0.64

  Arithmetic:
  0.77 × 0.26 = 0.2002
  0.2002 × 0.79 = 0.158158
  0.158158 × 0.64 = 0.101221 → **0.1012**

- **ΔV_meta from iteration 8 (0.1012)**: 0.00
- **ΔV_meta from inherited baseline (0.0973)**: +0.0039
- **12-iteration fallback count**: 9/12 (three iterations remain before mandatory full search)

**MATHEMATICAL CEILING — UNCHANGED (arithmetic fact)**:
V_meta_ceiling = 1.0 × 0.26 × 1.0 × 1.0 = 0.26 < 0.80.
Criterion 1 (V_meta ≥ 0.80) cannot be satisfied without effectiveness moving from 0.26.

**Per-factor stall reason diagnosis** (ΔV_meta = 0.00 for fourth consecutive iteration):

1. **completeness (0.77)**: SAME dimension as iterations 7-8. Conditional primitive
   reliable (6/6). Conditionality gap unchanged.
2. **effectiveness (0.26)**: SAME two dimensions as iterations 7-9. QN-006 baseline
   confirmed. No scope-matched QC-* task (9 iterations, 1-9). Pattern now 9 consecutive.
3. **reusability (0.79)**: SAME as experiment 1. 9th consecutive iteration in experiment 2.
4. **validation (0.64)**: SAME dimension as iteration 8, updated numerically. σ_QC = 3/9.
   Inherited floor dominates. ~51 more native-gate tasks structurally needed.

**Stall character assessment**: All four stall reasons remain identical to their dimension
from iterations 7-8 (updated numerically). No new stall reason has emerged for any factor.
This is the 4th consecutive iteration (6, 7, 8, 9) with ΔV_meta = 0.00 and identical stall
reason dimensions. The pattern is stable.

---

## 9. Out-of-band audit

**G3 trigger assessment**: NOT triggered this iteration.

QC-009 modifies only `experiments/quay-core-bootstrap/README.md` — a documentation file in
the experiments/ directory, not a source file in any package's src/ directory. `git diff
--stat HEAD` confirms only README.md was changed by QC-009. No files in packages/quay/,
packages/quay-native/src/, or packages/quay-github/ were modified. No Core source change
→ G3 not triggered per §Core-scope constraints item 5.

No V-factor lift this iteration (V_instance = 1.0, unchanged since iteration 3; V_meta =
0.1012, unchanged since iteration 6). No lift → no adjudication required.

**Explicit statement per DIR-003 practice**: "G3 not triggered this iteration — no Core
source change, no V-factor lift. QC-009 is documentation-only (README.md). No independent
adjudication required. G3 vacuously satisfied."

---

## 10. Convergence Check

- **[ ] 1. Dual threshold (V_instance ≥ 0.80 AND V_meta ≥ 0.80)**: NOT MET.
  V_instance = 1.0 (met). V_meta = 0.1012 (far below 0.80).

  **MATHEMATICAL CEILING (carried from iteration 6 — arithmetic fact)**:
  V_meta_ceiling = 1.0 × 0.26 × 1.0 × 1.0 = 0.26. Criterion 1 cannot be satisfied
  without effectiveness moving from 0.26. Effectiveness requires a scope-matched task
  that has not arisen in 9 consecutive iterations.

- **[x] 2. All 4 "Done when" clauses**: ALL SATISFIED (carried from iteration 3).
  - core_abi_symmetry: 1.0 — confirmed by 30/30 test suite pass.
  - web_ui_verification: 1.0 — all routes covered.
  - action_delivery_mode: 1.0 — mock default + labeled live check.
  - native_backlog_health: 1.0 — 30/30 pass, confirmed this iteration.

- **[ ] 3. V_meta genuine movement (≥2 factors, different stall reason)**: NOT MET.
  V_meta = 0.1012, unchanged (ΔV_meta = 0.00, fourth consecutive iteration).
  No factor moved. All four stall reasons have the same dimension as iterations 7-8.

- **[ ] 4. Out-of-band audit (G3) green**: MET (vacuously). No Core change, no V-factor
  lift. G3 not triggered. No failing audit exists. Vacuously satisfied.

- **[x] 5. Diminishing returns (ΔV < 0.02 for 2+ iterations, both V's)**: MET.
  ΔV_instance = 0.00 (9th consecutive at 0.00). ΔV_meta = 0.00 (4th consecutive below
  0.02). Both criteria met continuously since iterations 3 and 6 respectively.

**Status**: NOT CONVERGED.

Criteria met: 2 (Done-when clauses), 4 (G3 audit green — vacuously), 5 (diminishing returns).
Criteria not met: 1 (V_meta threshold — mathematically unreachable), 3 (V_meta score
movement — ΔV_meta=0.00 for fourth consecutive iteration).

---

## 11. Practical Convergence Assessment

### 11a. Current state (iteration 9)

**Re-trigger status**: 9/12 iterations checked. All four re-trigger conditions have been
checked every iteration (1-9) with no fires. The pattern is stable:

| Re-trigger | Condition | Iterations checked | Fires |
|---|---|---|---|
| 1 (effectiveness) | Scope-matched task arises | 1-9 (9) | 0 |
| 2 (reusability) | Organic GitHub write demand | 1-9 (9) | 0 |
| 3 (completeness gap) | New undocumented Skill gap | 1-9 (9) | 0 |
| 4 (unconditional primitive) | Unconditional Agent spawn | 1-9 (9) | 0 |

**What changed since iteration 8**: σ_QC grew from 2/8 to 3/9 (QC-009 is the third
native-gate task). No re-trigger fired. ΔV_meta = 0.00 for the fourth consecutive
iteration. The structural analysis is unchanged.

### 11b. Criteria state (unchanged from iteration 8 §11)

- Criteria 2, 4, 5: SATISFIED (unchanged).
- Criteria 1, 3: STRUCTURALLY UNSATISFIABLE within this experiment's natural scope.

The mathematical ceiling has not changed. Effectiveness stall has extended to 9
consecutive iterations in experiment 2 (9 + 65 from experiment 1 = 74 total iterations
since last movement). Validation inherited floor gap has widened in estimated cost (~10
more native-gate tasks needed in iteration 8 → ~51 more needed in iteration 9, due to
denominator growth).

### 11c. Decision point statement (per iteration-8 §11d recommendation)

**Iteration 8 recommended**: if no scope-matched task arises organically by iteration 10,
accept practical convergence.

**Iteration 9 finding**: no re-trigger fired. Iteration 10 is now the decision point.

**If iteration 10 shows the same pattern — no re-trigger fires in any of the four
conditions — practical convergence acceptance is warranted.** The grounds:

1. All four instance "Done when" clauses are satisfied (criterion 2, held since iteration 3).
2. ΔV < 0.02 for 9+ consecutive iterations on both V values (criterion 5).
3. G3 audit is vacuously satisfied — no Core change, no V-factor lift in iterations 4-9
   (criterion 4).
4. The V_meta gap is structural: effectiveness requires an event (scope-matched task) that
   this experiment's own objectives do not generate; reusability requires external organic
   demand not present in 9 iterations; validation requires ~51 more native-gate tasks at
   current denominator growth.
5. The 12-iteration fallback rule (re-trigger 5) means a dedicated search MUST run at or
   before iteration 12. If practical convergence is accepted at iteration 10, the final
   session should include the comprehensive fallback search as its concluding step — this
   satisfies the fallback obligation before halting.

**Fallback rule obligation**: if iteration 10 is the convergence acceptance point, the
iteration-10 executor MUST run the dedicated comprehensive search (re-trigger condition 5
from v-meta-stall-analysis.md) as part of that iteration before declaring convergence.
The fallback is mandatory at 12 iterations; accepting convergence at iteration 10 does
not waive it — it must be run early as a closing obligation. The search has not been run
yet (iterations 1-9 each relied on the per-iteration re-trigger check, not a dedicated
comprehensive sweep).

---

## Problems identified for next iteration

1. **Mathematical ceiling (first-order, carried)**: V_meta cannot reach 0.80 with
   effectiveness at 0.26. Criterion 1 arithmetically unreachable. Human decision needed:
   practical convergence (Option A) or continued search (Option B).

2. **V_meta = 0.1012 (ΔV = 0.00 for four consecutive iterations: 6, 7, 8, 9)**: no score
   movement. Pattern now 4 consecutive iterations below 0.02 threshold (additional to the
   previous 5 iterations, for 9 total since iteration 1).

3. **σ_QC = 3/9 = 0.333**: three native-gate tasks (QC-007, QC-008, QC-009). Inherited
   floor (0.8493) still dominates. ~51 more native-gate tasks structurally needed to exceed
   inherited floor — far outside this experiment's scope.

4. **Reusability (9 consecutive iterations, SAME stall)**: no organic demand for
   `data.write` in `packages/quay-github/`. Same stall as experiment 1, now 9 consecutive
   iterations in experiment 2.

5. **Effectiveness — 9 iterations with same two missing preconditions**: (a) scope-matched
   task; (b) timing for such a task. Standing instruction in place. Pattern: 9 consecutive
   iterations of documentation and browser-test tasks only.

6. **Practical convergence decision**: per §11c, if iteration 10 shows the same pattern,
   practical convergence acceptance is warranted. The iteration-10 executor MUST run the
   dedicated comprehensive search (fallback rule 5 from v-meta-stall-analysis.md) before
   accepting convergence. The fallback cannot be waived.

7. **Fallback count: 9/12**: three iterations remain before the mandatory dedicated full
   search. The comprehensive search obligation can be discharged at iteration 10 (as a
   closing obligation) or deferred to iterations 10-12.
