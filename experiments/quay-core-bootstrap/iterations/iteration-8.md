# Iteration 8: QC-008 + manda reliability 6/6 + practical convergence assessment

**Date**: 2026-07-16
**Driver**: native (degraded fallback) for QC-008 authoring/execution; native
for gate_by (Skill's own gate-check Method step). All three provenance fields
= native (second consecutive iteration with native triple).
**Instance objectives advanced**: none (V_instance stable at 1.0; maintained)
**V_meta triggers checked**: all four re-trigger conditions checked; none fired.
New findings: (1) manda reliability track record extended to 6/6 — three new
trials (documentation-reading, computation, code-reading) all SUCCESS; (2)
completeness ceiling diagnosis finalized: gap is conditionality only, not
reliability — further reliability trials do not move completeness; (3) QC-008
timing recorded (author 39s, execute 128s) but not scope-matched — re-trigger
1 does not fire; (4) σ_QC = 2/8 (second native-gate task); validation floor
still dominates; (5) PRACTICAL CONVERGENCE ASSESSMENT written — see §11.

---

## 1. Context from prior iteration

**σ_QC before**: 1/7 (QC-007 was the first native-gate task)
**Note**: QC-005, QC-006, QC-007 all have native/native but QC-005 and QC-006
have gate_by=seed. Only QC-007 had gate_by=native. σ_QC = 1/7 = 0.1429.

**V scores entering iteration 8**:
- core_abi_symmetry = 1.0
- web_ui_verification = 1.0
- action_delivery_mode = 1.0
- native_backlog_health = 1.0
- V_instance = **1.0** (stable since iteration 3)
- V_meta = 0.77 × 0.26 × 0.79 × 0.64 = **0.1012**
  Arithmetic: 0.77 × 0.26 = 0.2002; 0.2002 × 0.79 = 0.158158;
  0.158158 × 0.64 = 0.101221 → 0.1012

**Problems inherited from iteration 7**:
1. Mathematical ceiling: V_meta ceiling = 0.26 (with effectiveness=0.26 and
   all others at 1.0). Criterion 1 (V_meta ≥ 0.80) is mathematically
   unreachable without effectiveness moving.
2. σ_QC = 1/7: one native-gate task (QC-007). Score will not move until
   experiment 2's own σ_QC substantially exceeds the inherited floor (0.8493).
3. Effectiveness stall: "timing not recorded" (second dimension) + "not
   scope-matched" (first dimension). Two missing preconditions.
4. Reusability same stall (7 consecutive iterations). No quay-github demand.
5. Fallback count: 7/12. Five iterations remain before mandatory full search.
6. Objectives: per iteration-8 prompt, run 3 more manda trials (reliability
   push), drive QC-008 with timing, assess practical convergence.

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

**Cord broker processes**:
```
ps aux | grep "manda monitor cord" | grep -v grep
→ PID 1065935: manda monitor cord --root . (started 16:23, orchestrator session)
→ PID 1301517: manda monitor cord --root . (started 17:45, second session)
→ PID 1302543: manda monitor cord --root . (started 17:46, third session)
```
Three cord brokers confirmed running. DIR-020 precondition satisfied — calling
session does not own any broker.

**G6 assessment**: DIR-020 precondition MET. Daemon live. Non-self broker
confirmed (three orchestrator-session processes, PIDs confirmed). Practical
precondition for manda Agent calls satisfied.

**provenance.md**: read at session start (116 lines pre-update → well below
1,500 limit).
**iteration-7.md**: read in full at session start.
**Skill files**: quay:author/SKILL.md and quay:execute/SKILL.md read at session
start.
**v-meta-stall-analysis.md**: read at session start.
**directives/pending/**: empty — confirmed by `ls`. No pending directives.

---

## 3. Observe

### 3a. Objective A: Manda reliability push — three additional trials

**Preconditions re-verified**: daemon live at http://localhost:46215; three
cord brokers (PIDs 1065935, 1301517, 1302543) confirmed non-self. DIR-020 MET.

**Trial 4 — Documentation-reading task (medium-documentation)**:
- Prompt: read provenance.md, return JSON with line_count, last_task_id, gate_by
- Start: 18:04:14 UTC
- Result: `{"line_count":117,"last_task_id":"QC-007","last_gate_by":"native"}`
- End: 18:06:01 UTC — wall-clock ~107s
- Verification: `wc -l provenance.md` → 117 (at time of call; since updated);
  last table row was QC-007 with gate_by=native. FACTUALLY CORRECT.
- Outcome: **SUCCESS**

**Trial 5 — Computation task (arithmetic)**:
- Prompt: compute 1337 × 42 + 7, return JSON `{"result": N}`
- Start: 18:06:06 UTC
- Result: `{"result":56161}`
- End: 18:06:26 UTC — wall-clock ~20s
- Verification: `python3 -c "print(1337*42+7)"` → 56161. CORRECT.
- Outcome: **SUCCESS**

**Trial 6 — Code-reading task (store.js survey)**:
- Prompt: read store.js, report line_count and first function name
- Start: 18:06:30 UTC
- Result: `{"first_function":"createStore","line_count":496}`
- End: 18:06:58 UTC — wall-clock ~28s
- Verification: `wc -l packages/quay-native/src/store.js` → 496;
  first named export function at line 42: `export function createStore`.
  FACTUALLY CORRECT.
- Outcome: **SUCCESS**

**Cumulative manda reliability track record — 6/6**:

| Call | Task type | Result | Timeout | Wall-clock | Iteration |
|------|-----------|--------|---------|------------|-----------|
| 1 | Trivial (PONG echo) | SUCCESS | 90s | <90s | 4 |
| 2 | Medium (file read + structured JSON) | SUCCESS | 150s | <150s | 5 |
| 3 | Complex (multi-file + adversarial + verdict) | SUCCESS | 150s | <150s | 6 |
| 4 | Documentation-reading (provenance.md) | SUCCESS | 150s | ~107s | 8 |
| 5 | Computation (arithmetic) | SUCCESS | 150s | ~20s | 8 |
| 6 | Code-reading (store.js) | SUCCESS | 150s | ~28s | 8 |

**Completeness ceiling diagnosis — does 6/6 move completeness?**

The completeness gap (from v-meta-stall-analysis.md §completeness) is:
"no native subagent-dispatch (fresh-context spawn) primitive existed...
This is an out-of-quay-native's-control environmental limitation." The
specific wording from iteration 4's update: "conditional, not unconditional
— it does not close the completeness gap (which requires a *reliable,
unconditional* native fresh-context spawn)."

The gap has two components:
1. Reliability of the conditional path
2. Conditionality itself (daemon + non-self broker required)

Six trials across diverse task types confirms component 1 empirically:
the conditional primitive is reliable. Component 2 (conditionality) is
unchanged — daemon + non-self broker are still required by DIR-020.

**Honest determination**: 6/6 trials address component 1 (reliability), not
component 2 (conditionality). The iteration-8 prompt asks explicitly: "does
accumulating more reliability trials change the fundamental 'conditional vs
unconditional' gap? The gap is about conditionality (daemon required), not
reliability per se." Answer: NO. Accumulating trials beyond 3/3 does not
change the conditionality gap. The score was moved from 0.74 → 0.77 in
iteration 6 specifically for the complex trial (demonstrating the conditional
primitive handles adversarial workloads). That was the reliability component's
contribution. There is no additional score component attributable to "6 vs 3
trials" — the conditionality gap remains, and the reliability question was
answered at 3/3.

**Completeness score**: remains **0.77** (unchanged). The 6/6 track record
is methodologically useful (it finalizes the reliability characterization and
enables the "confirmed reliable conditional primitive" language in ITERATION-
PROMPTS.md), but does not change the fundamental conditionality gap that is
the remaining score blocker.

### 3b. Objective B: QC-008 — timing capture and scope-match assessment

**QC-008 timing** (wall-clock recorded at Method phase boundaries):
- Author phase start: 18:07:08 UTC
- Author phase end / Execute phase start: 18:07:47 UTC
- Execute phase end: 18:09:55 UTC

**Phase durations**:
- write-proposal + review-proposal + write-plan + review-plan + author gate:
  18:07:08 → 18:07:47 = **39 seconds**
- implement-phase + self-audit-ac + gate-check:
  18:07:47 → 18:09:55 = **2m8s (128 seconds)**
- Total end-to-end: **2m47s (167 seconds)**

**QN-006 baseline** (from `experiments/quay-native-bootstrap/timing/
iteration-0.log`):
- Author phase: 04:23:03 → 04:23:54 = ~51s
- Execute phase: 04:24:18 → 04:27:17 = ~2m59s (179s)
- Total: ~3m47s (227s)

**Scope-match assessment — QC-008 vs QN-006**:

QN-006 shape: single source file (store.js), file-locking logic implementation,
no network I/O. QN-006 was a genuine engineering task that changed operational
logic in a source file.

QC-008 shape: single documentation file (ITERATION-PROMPTS.md), text updates
to a watchlist section (adding citations, reliability data, a standing
instruction), no network I/O. No source file modified; no logic changed.

**Verdict: NOT scope-matched.**

The scope-matching criterion is "single source file, logic change, no network
I/O." QC-008 fails the "logic change" element — it is a documentation update,
the same disqualification as QC-004, QC-005, QC-007. The timing comparison
(QC-008 author 39s vs QN-006 author 51s; QC-008 execute 128s vs QN-006
execute 179s) cannot be used for the effectiveness re-trigger because the
task types are not comparable.

**Timing recording value**: even though the scope-match fails, recording
timing for QC-008 is methodologically useful for two reasons:
1. It demonstrates the standing timing-recording instruction works in practice
   (this is the first QC-* iteration report to contain phase-level timing).
2. It provides a reference data point: documentation tasks of this shape
   take author ~40s, execute ~2m — substantially shorter than source-logic
   tasks would be expected to take, which explains why they are not
   scope-matched (different work type, different time profile).

**Effectiveness re-trigger**: does NOT fire.

### 3c. Objective C: V_meta re-trigger search (8/12, all four mandatory)

1. **Effectiveness (re-trigger 1)**: QC-008 has recorded timing (author 39s,
   execute 128s). QC-008 is NOT scope-matched (documentation, not source
   logic). Re-trigger 1 **does NOT fire**. Stall reason: SAME two dimensions
   as iteration 7 — "no scope-matched QC-* task (documentation tasks
   disqualified)" + "timing not recorded for scope-matched tasks (standing
   instruction now in place for when one arises)."

2. **Reusability (re-trigger 2)**: no work on `packages/quay-github/`. No
   QC-* tasks require body/title writes against GitHub issues. `github-
   client.js` still status-only for data.write (confirmed by code grep).
   Re-trigger 2 **does NOT fire**. 8th consecutive iteration with identical
   stall reason — SAME as experiment 1.

3. **Completeness — gap discovery (re-trigger 3)**: no new, previously-
   undocumented Skill Method-step gap found during QC-008 execution (which
   was documentation-only). The manda reliability finding (6/6) was
   anticipated. No organic gap discovery during unrelated work. Re-trigger 3
   **does NOT fire**.

4. **Completeness + joint (re-trigger 4)**: ToolSearch for "Agent spawn
   subagent" finds only `mcp__plugin_manda_manda__Agent` (the conditional
   manda-proxied Agent). No unconditional native fresh-context spawn primitive
   available. DIR-020 hard rule unchanged. Re-trigger 4 **does NOT fire**.

**Fallback count**: 8/12. Four iterations remain before the mandatory
dedicated full search.

### 3d. V_instance factors (confirmed stable)

QC-008 changes: only ITERATION-PROMPTS.md modified (documentation, not a
source file in any package). `node --test packages/*/test/*.test.mjs` →
30 pass, 0 fail (run before and after QC-008 edits). `git diff --stat`
confirms no source files in packages/quay/, packages/quay-native/src/, or
packages/quay-github/ were touched.

---

## 4. Strategy

**Objective A** (completeness ceiling assessment): run three manda trials
to extend reliability track record to 6/6. Assess honestly whether 6/6
moves completeness (verdict: NO — conditionality gap unchanged).

**Objective B** (timing capture for effectiveness): drive QC-008 via
quay:author + quay:execute native Method with wall-clock timestamps recorded
at each phase boundary. Assess scope-match honestly (verdict: NOT scope-
matched — documentation, not source logic). Record timing for methodological
completeness regardless.

**Objective C** (V_meta re-trigger search): all four checked (§3c).

**Objective D** (practical convergence assessment): mandatory this iteration
per the iteration-8 prompt. See §11.

---

## 5. Execution

### 5a. Precondition verification

Read `.manda/hub.addr` → `http://localhost:46215`.
`curl -s http://localhost:46215/healthz` → `{"root":"/home/yale/work/quay"}`.
Broker PIDs 1065935, 1301517, 1302543 confirmed via `ps aux | grep "manda
monitor cord"`. Three brokers; none is a child of this session. DIR-020 MET.
`ls experiments/quay-core-bootstrap/directives/pending/` → empty. No pending
directives.

### 5b. Manda reliability trials (3 new calls)

See §3a for the full trial records. Summary:
- Trial 4 (documentation-reading): SUCCESS ~107s
- Trial 5 (computation): SUCCESS ~20s
- Trial 6 (code-reading): SUCCESS ~28s
All three: SUCCESS. Cumulative: 6/6.

### 5c. QC-008 authored via quay:author degraded-fallback Method

**Phase start timestamp**: 18:07:08 UTC

**Step 1 (write-proposal)**: `mcp__quay__task_write(id="QC-008", ...)` —
task created with Proposal identifying three specific gaps: (a) timing
baseline reference absent from ITERATION-PROMPTS.md watchlist; (b) standing
timing-recording instruction missing from watchlist (only in Skill files);
(c) manda reliability count stale (3/3 vs 6/6 after this iteration's trials).

**Step 2 (review-proposal)** — degraded-fallback checklist:
- (a) `## Proposal` heading present: YES
- (b) Content exceeds trivial floor, names specific gap: YES — three gaps
  with file-level and iteration references
- (c) Approach names specific, real gap: YES — primary sources confirmed
  (ITERATION-PROMPTS.md read; timing baseline location confirmed;
  current manda count = 3/3 before iteration 8's trials)
- Checklist: PASS

**Step 3 (write-plan)**: Three phases. Decompose test: single file
(ITERATION-PROMPTS.md) — not ≥2 independently mergeable deliverables.
Remain leaf.

**Step 4 (review-plan)** — degraded-fallback checklist:
- (a) Plan phases map onto AC items: Phase 1 → AC 1+2, Phase 2 → AC 3,
  Phase 3 → AC 4. YES
- (b) AC section contains ≥1 real checkbox: 4 items. YES
- (c) DoD is a real checklist, not restated AC: YES
- Checklist: PASS

**Step 5 (gate check — author→ready)**:
`mcp__quay__task_check(id="QC-008")` → `{"gate":"author->ready","ok":false,
"artifacts":{"proposal":true,"plan":true,"ac":true,"dod":true},"acTotal":4,
"acChecked":0,"reason":"0/4 AC checkboxes checked"}`
All artifacts present. AC not yet executed — correct pre-execution state.

**Author phase end timestamp**: 18:07:47 UTC (39 seconds for author phase)

### 5d. QC-008 executed via quay:execute degraded-fallback Method

**Execute phase start timestamp**: 18:07:47 UTC

**implement-phase (Phase 1)**: Updated §V_meta re-trigger watchlist item 1
in `experiments/quay-core-bootstrap/ITERATION-PROMPTS.md` to add:
- Timing baseline confirmed sub-bullet: cites `experiments/quay-native-
  bootstrap/timing/iteration-0.log` with specific timestamps (04:23:03→
  04:23:54 = ~51s author; 04:24:18→04:27:17 = ~2m59s execute).
- Standing timing-recording instruction sub-bullet: instructs executors to
  record wall-clock start/end for each Method phase in the iteration report
  when a scope-matched task arises organically.

**implement-phase (Phase 2)**: Updated §V_meta re-trigger watchlist item 4
in the same file to add:
- Manda conditional primitive reliability track record sub-bullet: lists
  all 6/6 calls with task types, iteration numbers, timeouts, and approximate
  wall-clock times for the three iteration-8 trials.
- Added §Completeness ceiling assessment paragraph after item 5 (Fallback
  rule): explicitly states that 6/6 confirms reliability but not
  conditionality; further trials beyond 6/6 do not move completeness.

**implement-phase (Phase 3)**: `node --test packages/*/test/*.test.mjs` →
30 pass, 0 fail. No regressions.

**self-audit-ac** — degraded-fallback same-session re-verification:
- AC 1 (timing baseline citation): VERIFIED. `grep "iteration-0.log"
  ITERATION-PROMPTS.md` → line 257, cites the correct file path with
  timestamps.
- AC 2 (timing-recording instruction): VERIFIED. `grep "timing-recording
  instruction" ITERATION-PROMPTS.md` → line 260, contains "Standing timing-
  recording instruction" with the wall-clock recording guidance.
- AC 3 (manda 6/6 updated): VERIFIED. `grep "6/6" ITERATION-PROMPTS.md`
  → line 269 "6/6 calls SUCCESS across six distinct task types"; lines 273-
  277 list the three iteration-8 trial types (Documentation-reading,
  Computation, Code-reading).
- AC 4 (30/30 test suite): VERIFIED. Run in Phase 3 above.

Updated task body with 4/4 AC checkboxes checked, DoD 3/3 checked.

**gate-check (quay:execute Method step 3 — THE SKILL'S OWN GATE STEP)**:

`mcp__quay__task_check(id="QC-008")` → `{"gate":"author->ready","ok":true,
"artifacts":{"proposal":true,"plan":true,"ac":true,"dod":true},"reason":"all
four artifacts present; eligible to move to ready"}`
Advanced to ready: `quay task edit QC-008 --status ready`.

`mcp__quay__task_check(id="QC-008")` → `{"gate":"execute->done","ok":true,
"acTotal":4,"acChecked":4,"reason":"all AC checkboxes checked; eligible to
move to done"}`
Advanced to done: `quay task edit QC-008 --status done`.

This `mcp__quay__task_check` call is the final step of the quay:execute Method
(step 3: gate-check). The Skill's Method structure was the operative driver —
status was advanced TO DONE based on this gate's `ok: true` return. This is
gate_by = native (the Skill's gate assertion, not an ad-hoc verification).

**Execute phase end timestamp**: 18:09:55 UTC (128 seconds for execute phase)

**QC-008: DONE.** Gate confirmed mechanically by the Skill's own gate-check
Method step.

**QC-008 timing summary**:
- Author phase: 18:07:08 → 18:07:47 = **39s** (vs QN-006 ~51s — documentation
  authoring is faster than source-logic authoring, consistent with simpler task)
- Execute phase: 18:07:47 → 18:09:55 = **128s** (vs QN-006 ~179s — same direction)
- Total: **167s** (vs QN-006 ~227s)
- Scope-match verdict: NOT scope-matched (see §3b). The comparison is noted
  for the record but does NOT fire the effectiveness re-trigger.

---

## 6. Provenance update

**QC-008** (2026-07-16, iteration 8):
- author_by: native (degraded fallback) — Method steps explicitly followed
  in sequence with SKILL.md as the operative guide (write-proposal →
  review-proposal → write-plan → review-plan → gate; each step explicitly
  named and executed per SKILL.md §5c above).
- execute_by: native (degraded fallback) — same: implement-phase →
  self-audit-ac → gate-check; each step explicitly named and executed per
  SKILL.md §5d above.
- gate_by: **native** — gate-check (`mcp__quay__task_check`) was run as the
  FINAL step of the quay:execute Method sequence (step 3 of Method), with
  status advanced to `done` based on that gate's `ok: true` return. The
  Skill's own gate assertion was the operative driver.
- σ contribution: **2/8** — all three fields native; QC-008 is the second
  task contributing to the σ_QC numerator.

**σ_QC before this iteration**: 1/7 = 0.1429
**σ_QC after this iteration**: 2/8 = 0.25

**Validation score impact**: σ_QC = 2/8 = 0.25. Inherited floor σ_strict =
0.8493 maps to validation = 0.64. 0.25 < 0.8493 → inherited floor still
dominates. Validation = 0.64 (unchanged despite σ_QC numerator gain).

σ_QC growth: 0 → 1/7 → 2/8. The numerator is growing (one native-gate task
per iteration for two consecutive iterations). The denominator is also growing.
At this rate (1 native-gate task per iteration), reaching σ_QC ≥ 0.8493
requires approximately 6 more native-gate tasks while the denominator grows
at the same rate — which would require σ_QC = n/n+8 ≥ 0.8493, solved at
approximately n=11 native-gate tasks in a row after this point (with
denominator = 8+11 = 19).

**Inherited floor**: σ_strict = 0.8493 (experiment 1's final value — context
only).

---

## 7. V_instance

- **core_abi_symmetry**: 1.0 — unchanged. No source file changes this
  iteration. Confirmed by 30/30 test suite pass.

- **web_ui_verification**: 1.0 — unchanged. All three routes covered.
  Confirmed by 30/30 test suite pass.

- **action_delivery_mode**: 1.0 — unchanged. Mock default + labeled live check.
  Confirmed by 30/30 test suite pass.

- **native_backlog_health**: 1.0 — `node --test packages/*/test/*.test.mjs` →
  30 pass, 0 fail. Only ITERATION-PROMPTS.md (documentation file) modified —
  no source file changes in any package. No regression possible.

- **Total**: 1.0 × 1.0 × 1.0 × 1.0 = **1.0**
- **ΔV_instance**: 0.00 (held at 1.0 from iteration 3)

---

## 8. V_meta

All four re-trigger conditions checked (§3c above). None fired.

- **completeness**: **0.77** — no change.

  Re-trigger 4 checked: NOT fired (conditional ≠ unconditional).
  Re-trigger 3 checked: NOT fired (no new undocumented gap from unrelated work).

  **Score movement rationale**: Six trials (6/6) confirm the conditional
  manda-proxied Agent is reliable across diverse task types. The remaining
  completeness gap is conditionality (not reliability): daemon + non-self
  broker are required preconditions. Per the honest determination in §3a,
  accumulating further reliability trials does not close the conditionality
  gap. Completeness = 0.77 (unchanged; score moved from 0.74→0.77 in
  iteration 6 for the complex-tier reliability confirmation, and that credit
  was already taken).

  **Stall reason** (SAME dimension as iteration 7): "Conditional primitive
  confirmed reliable for all tiers (now 6/6 across diverse task types). The
  unconditional gap remains. Completeness ceiling diagnosis: gap is
  conditionality only, not reliability — further trials do not move score."

- **effectiveness**: **0.26** — re-trigger 1 checked; does not fire.

  **QC-008 timing recorded** (first QC-* iteration with explicit phase timing):
  - Author phase: 39s (vs QN-006 ~51s baseline)
  - Execute phase: 128s (vs QN-006 ~179s baseline)
  - Total: 167s (vs QN-006 ~227s baseline)

  **QC-008 scope-match verdict: NOT scope-matched.**
  QN-006 required source-logic implementation (store.js, file-locking).
  QC-008 is documentation updates to ITERATION-PROMPTS.md. The timing data
  is recorded for methodological completeness but the comparison is invalid
  because the task types differ fundamentally.

  **Stall reason** (SAME two dimensions as iteration 7): "Stage-0 QN-006
  timing baseline confirmed at experiments/quay-native-bootstrap/timing/
  iteration-0.log (author ~51s, execute ~2m59s). No scope-matched QC-* task
  has arisen (iterations 1-8 produced only documentation and browser-test
  tasks). Timing-recording standing instruction now in ITERATION-PROMPTS.md
  and both Skill files. QC-008 timing recorded (author 39s, execute 128s)
  but not scope-matched. Two preconditions remain absent: (1) scope-matched
  task (single source file, logic change, no network I/O); (2) timing for
  such a task. The standing instruction is ready for when one arises."

- **reusability**: **0.79** — re-trigger 2 checked; does not fire.

  **Stall reason**: SAME as experiment 1. 8th consecutive iteration. No
  organic demand for body/title writes in `packages/quay-github/`. v1 scope
  constraint (`data.write` status-only, QN-024) unchanged. Code-level
  confirmation (iteration 7 grep): no body/title write path in
  github-client.js.

- **validation**: **0.64** — σ_QC = 2/8; inherited floor still dominates.

  **Score arithmetic**: σ_QC = 2/8 = 0.25. Inherited floor σ_strict =
  0.8493. 0.25 < 0.8493 → inherited floor dominates. Validation = 0.64
  (unchanged).

  **Genuine progress despite score stasis**: σ_QC numerator has grown from
  0 (iterations 0-6) to 1/7 (iteration 7) to 2/8 (iteration 8). Two
  consecutive iterations with native gate. The inherited floor's dominance
  requires approximately 11 more consecutive native-gate tasks to be
  overcome (σ_QC must reach ≥0.8493 = n/n+8 → n≈11 at current denominator).

  **Stall reason** (SAME dimension as iteration 7, updated numerically):
  "QC-007 and QC-008 are both native-gate; σ_QC = 2/8 = 0.25. Inherited
  floor 0.8493 still dominates. Score will not move until experiment 2's own
  σ_QC exceeds 0.8493 — requires approximately 11 more native-gate tasks
  given current denominator trajectory."

- **Total**: 0.77 × 0.26 × 0.79 × 0.64

  Arithmetic:
  0.77 × 0.26 = 0.2002
  0.2002 × 0.79 = 0.158158
  0.158158 × 0.64 = 0.101221 → **0.1012**

- **ΔV_meta from iteration 7 (0.1012)**: 0.00
- **ΔV_meta from inherited baseline (0.0973)**: +0.0039
- **12-iteration fallback count**: 8/12

**V_meta arithmetic check**:
  0.77 × 0.26 = 0.2002
  0.2002 × 0.79 = 0.158158
  0.158158 × 0.64 = 0.101221
  **V_meta = 0.1012** (unchanged from iteration 7)

**MATHEMATICAL CEILING FINDING — CARRIED FORWARD (arithmetic fact)**:

V_meta = completeness × effectiveness × reusability × validation
       = 0.77 × **0.26** × 0.79 × 0.64 = 0.1012

With effectiveness = 0.26 and ALL other factors at their theoretical maximum
of 1.0:
  V_meta_ceiling = 1.0 × 0.26 × 1.0 × 1.0 = **0.26**

0.26 < 0.80 (the dual-threshold target). The gap is 0.54.

For V_meta to reach 0.80 with current completeness and reusability:
  V_meta = 0.77 × effectiveness × 0.79 × 1.0 = 0.80
  effectiveness = 0.80 / (0.77 × 0.79) = 0.80 / 0.6083 = 1.315

Effectiveness would need to exceed 1.0 (impossible). This is an arithmetic
fact: convergence criterion 1 CANNOT be satisfied without effectiveness
moving from 0.26.

**Per-factor stall reason diagnosis**:

1. **completeness (0.77)**: SAME dimension as iteration 7. "Conditional
   primitive confirmed reliable (6/6, diverse task types). Completeness gap
   is conditionality only. Further reliability trials do not move score."

2. **effectiveness (0.26)**: SAME two dimensions as iteration 7. "QN-006
   baseline confirmed (author ~51s, execute ~2m59s). No scope-matched QC-*
   task (iterations 1-8). QC-008 timing recorded (author 39s, execute 128s)
   but not scope-matched (documentation vs source-logic). Standing instruction
   in place for when a scope-matched task arises organically."

3. **reusability (0.79)**: SAME as experiment 1. 8th consecutive iteration.

4. **validation (0.64)**: SAME dimension as iteration 7, updated numerically.
   "σ_QC = 2/8 = 0.25. Inherited floor 0.8493 still dominates. Needs ~11
   more native-gate tasks to exceed inherited floor."

---

## 9. Out-of-band audit

**G3 trigger assessment**: NOT triggered this iteration.

QC-008 modifies only `experiments/quay-core-bootstrap/ITERATION-PROMPTS.md`
— a documentation file in the experiments/ directory, not a source file in
any package's src/ directory. No files in packages/quay/, packages/quay-
native/src/, or packages/quay-github/ were modified. `git diff --stat`
confirms only ITERATION-PROMPTS.md was changed by QC-008. No Core source
change → G3 not triggered per §Core-scope constraints item 5.

No V-factor lift this iteration (V_instance = 1.0, unchanged; V_meta = 0.1012,
unchanged). No lift → no adjudication required.

**Explicit statement per DIR-003 practice**: "G3 not triggered this iteration
— no Core source change, no V-factor lift. QC-008 is documentation-only
(ITERATION-PROMPTS.md). No independent adjudication required."

**G3 for QC-008 dispatched by orchestrator**: As per DIR-003, G3 audit must
be dispatched by the orchestrator via the native Agent/Task tool, not from
inside the iteration-executor. This iteration's G3 status:

"G3 requested: see experiments/quay-core-bootstrap/audits/iteration-8-
adjudicate.md once serviced."

No file written to `experiments/quay-core-bootstrap/audits/` this iteration
(no trigger; G3 is requested but not triggered by this session's own scope).

---

## 10. Convergence Check

- **[ ] 1. Dual threshold (V_instance ≥ 0.80 AND V_meta ≥ 0.80)**: NOT MET.
  V_instance = 1.0 (met). V_meta = 0.1012 (far below 0.80).

  **MATHEMATICAL CEILING FINDING (carried from iteration 6 — arithmetic fact)**:

  V_meta_ceiling = 1.0 × 0.26 × 1.0 × 1.0 = **0.26**

  With current completeness = 0.77 and reusability = 0.79:
  V_meta = 0.77 × effectiveness × 0.79 × 1.0 = 0.80
  requires effectiveness = 1.315 > 1.0 (impossible).

  Criterion 1 is mathematically unreachable under the current formula and
  scope. This is a structural impossibility, not a temporary stall.

- **[x] 2. All 4 "Done when" clauses**: ALL SATISFIED (carried from iteration 3).
  - core_abi_symmetry: 1.0 — confirmed by 30/30 test suite pass.
  - web_ui_verification: 1.0 — all three routes covered.
  - action_delivery_mode: 1.0 — mock default + labeled live check.
  - native_backlog_health: 1.0 — 30/30 pass, confirmed this iteration.

- **[ ] 3. V_meta genuine movement (≥2 factors, different stall reason)**:
  NOT MET for score movement. V_meta = 0.1012, unchanged (ΔV_meta = 0.00).
  No factor moved.

  Stall reasons: all four factors have stall reasons documented, updated
  through iteration 8. None changed sufficiently to constitute a "different"
  stall reason from the prior iteration's — the same fundamental blockers
  apply (conditionality for completeness; no scope-matched task for
  effectiveness; no organic demand for reusability; inherited floor for
  validation). Criterion 3 requires score movement — NOT MET.

- **[ ] 4. Out-of-band audit (G3) green for all Core/lift tasks**: N/A —
  no Core change, no V-factor lift. G3 not triggered. Criterion 4 is
  satisfied vacuously (no trigger ≡ no audit required ≡ no failing audit).
  State: MET (vacuously).

- **[x] 5. Diminishing returns (ΔV < 0.02 for 2+ iterations, both V's)**:
  MET (carried from iteration 5; confirmed again this iteration).
  - ΔV_instance: 0.00 (5th consecutive at 0.00). CRITERION MET.
  - ΔV_meta: 0.00 this iteration (< 0.02). All 8 iterations have shown
    ΔV_meta < 0.02. CRITERION MET.
  Both ΔVs = 0.00 this iteration. Criterion 5 definitively met.

**Status**: NOT CONVERGED.

Criteria met: 2 (Done-when clauses), 4 (G3 audit green — vacuously), 5
(diminishing returns).
Criteria not met: 1 (V_meta threshold — mathematically unreachable), 3
(V_meta score movement — ΔV_meta=0.00 this iteration).

---

## 11. Practical Convergence Assessment

**MANDATORY per iteration-8 prompt.**

### 11a. Three criteria already satisfied

1. **Criterion 2 (Done-when clauses)**: ALL FOUR instance "Done when" clauses
   are independently satisfied with direct evidence:
   - core_abi_symmetry = 1.0: abi-symmetry script covers all three surfaces,
     runs in automated suite, all symmetry gaps filed as tasks (iteration 3).
   - web_ui_verification = 1.0: every reachable page/flow has at least one
     browser-automation test (iterations 1-2).
   - action_delivery_mode = 1.0: mock default + labeled live check (iteration 2).
   - native_backlog_health = 1.0: 30/30 test suite confirms no regression from
     experiment 1's final snapshot (confirmed every iteration 3-8).
   The instance objectives of this experiment are COMPLETE.

2. **Criterion 5 (Diminishing returns)**: ΔV_instance = 0.00 and ΔV_meta =
   0.00 for eight consecutive iterations. The threshold is ΔV < 0.02 for
   2+ consecutive iterations on both V's. This criterion has been met since
   iteration 5 (V_meta plateau) and confirmed in every subsequent iteration.
   Both V values are stable.

3. **Criterion 4 (G3 audit)**: No Core source change and no V-factor lift have
   occurred in iterations 4-8 (the last five iterations were all documentation
   and Skill file updates). No G3 audit has been triggered. No failing audit
   exists. Criterion 4 is vacuously satisfied.

### 11b. What is needed for standard convergence, and why it is not achievable

**Criterion 1** (V_meta ≥ 0.80): Mathematically impossible without
effectiveness moving from 0.26. With completeness=0.77 and reusability=0.79:
  effectiveness needed = 0.80 / (0.77 × 0.79) = 1.315 > 1.0.
Even if completeness and reusability both reached 1.0:
  effectiveness needed = 0.80 / (1.0 × 1.0) = 0.80.
Effectiveness's structural stall (65+ iterations, same blocker from experiment
1): no organically-arising scope-matched task has appeared in eight iterations
of experiment 2. The experiment's own task history produces documentation and
browser-test tasks — not single-file source-logic tasks comparable to QN-006.
Manufacturing a scope-matched task solely to generate a timing comparison
would be metric-manufacturing (G2/G5 violation), explicitly prohibited.

**Criterion 3** (V_meta genuine movement in ≥2 factors): Requires score
movement. Completeness moved once (0.74→0.77, iteration 6, for the complex-
tier manda trial). No other factor has moved in experiment 2. Effectiveness
requires a scope-matched task. Reusability requires organic GitHub write demand.
Validation requires σ_QC > 0.8493 (approximately 11 more native-gate tasks at
current denominator trajectory). None of these conditions are achievable within
the experiment's natural scope — they require either external events (organic
GitHub demand, a scope-matched task arising) or an extended timeline (11 more
native-gate tasks).

### 11c. What has been learned and documented

The experiment has produced concrete, useful findings even without reaching
standard convergence:

1. **Manda conditional primitive confirmed**: The conditional manda-proxied
   Agent is reliably available (6/6, diverse task types) when preconditions
   are met (daemon live + non-self broker). This is a concrete capability
   characterization that did not exist at experiment start.

2. **Completeness gap diagnosed precisely**: The gap is conditionality, not
   reliability. This is a sharper characterization than "no primitive" (the
   inherited stall reason from experiment 1).

3. **Timing methodology established**: The standing instruction for recording
   wall-clock timing is now in both Skill files and ITERATION-PROMPTS.md.
   The first iteration-report timing record exists (QC-008: author 39s,
   execute 128s). The baseline for comparison (QN-006: author ~51s, execute
   ~179s) is explicitly cited in the watchlist.

4. **Mathematical ceiling documented explicitly**: V_meta cannot reach 0.80
   with effectiveness=0.26. This is now documented in the experiment record
   as an arithmetic fact, not a judgment call.

5. **Native gate discipline established**: σ_QC = 2/8 (two consecutive
   native-gate tasks). The distinction between gate_by=seed and gate_by=
   native is now operational practice, not just theory.

### 11d. Recommendation to human owner

Three conditions are satisfied (criteria 2, 4, 5). Two conditions are
structurally unsatisfiable within this experiment's natural scope:
- Criterion 1: mathematical impossibility given effectiveness=0.26 floor.
- Criterion 3: requires external events (organic demand, scope-matched task)
  not generated by this experiment's own objectives.

**Option A (accept practical convergence — halt with findings)**: The
instance objectives are complete. The experiment has documented concrete
findings on all four V_meta factors. The mathematical ceiling is explicit.
The remaining V_meta gap (effectiveness, reusability) is an environmental
and scope constraint, not a methodology failure. Accepting practical
convergence acknowledges that the instance work is done and the V_meta
factors that can be addressed within this scope have been addressed.

**Option B (continue to 12-iteration fallback — 4 more iterations)**: The
standing fallback rule (re-trigger 5 in v-meta-stall-analysis.md) requires
a dedicated full search if no V_meta re-trigger fires within 12 consecutive
iterations. At 8/12, four iterations remain. If a scope-matched task can be
generated within 4 iterations, effectiveness moves. If not, the fallback
search confirms the structural stall.

**The iteration-8 executor recommends**: if no scope-matched task arises
organically in the next two iterations (9-10), accept practical convergence
at iteration 10 rather than running four more documentation-only iterations.
The standard convergence criteria cannot be met under this experiment's scope.
The practical convergence case is that criteria 2, 4, and 5 are satisfied,
the instance objectives are complete, and the meta-layer stall is structural.

---

## Problems identified for next iteration

1. **Mathematical ceiling (first-order, carried)**: V_meta cannot reach 0.80
   with effectiveness at 0.26. Arithmetic fact requiring a human decision.
   Practical convergence assessment provided in §11.

2. **V_meta = 0.1012 (ΔV = 0.00 this iteration and previous)**: No score
   movement. ΔV_meta = 0.00 for iterations 6, 7, and 8 — three consecutive
   iterations below 0.02 threshold.

3. **σ_QC = 2/8**: Two native-gate tasks (QC-007, QC-008). Inherited floor
   (0.8493) still dominates validation score. Approximately 11 more native-
   gate tasks needed to exceed inherited floor.

4. **Reusability (8 consecutive iterations, SAME stall)**: No organic demand
   for `data.write` in `packages/quay-github/`. Same stall as experiment 1,
   now 8 consecutive iterations in experiment 2.

5. **Effectiveness — two missing preconditions (8 iterations)**: (a) scope-
   matched task (single source file, logic change, no network I/O); (b)
   timing for such a task. Standing instruction now in both Skill files and
   ITERATION-PROMPTS.md. No scope-matched QC-* task has arisen in 8 iterations.

6. **V_instance = 1.0 (stable)**: All four "Done when" clauses confirmed.
   No remaining instance objectives. No regressions.

7. **Fallback count: 8/12**: Four iterations remain before the mandatory
   dedicated full search.

8. **No pending directives**: `experiments/quay-core-bootstrap/directives/
   pending/` is empty. Next iteration should confirm again.

9. **Practical convergence assessment**: provided in §11. Human owner should
   decide: Option A (halt with findings) or Option B (continue to 12-iteration
   fallback). If Option B, next iteration should attempt to generate or wait
   for a scope-matched task.
