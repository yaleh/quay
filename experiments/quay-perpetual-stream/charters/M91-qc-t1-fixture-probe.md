# Charter M91-qc-t1-fixture-probe — QC-T1 healthcheck fixture idempotency (exp5-DEFECT-QC-T1-FIXTURE-PROBE-LOSS)

**Milestone id:** M91  
**Task:** `tasks/exp5-DEFECT-QC-T1-FIXTURE-PROBE-LOSS.md` (milestone-candidate, defect)  
**Surface:** `experiments/quay-perpetual-stream/OUTER-LOOP.md` session-start section + `tasks/QC-T1.md`  
**Type:** governance-integrity / instrument-correction  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

M88 history-mining surfaced: `mcp__quay__task_get` was called 3× for `QC-T1` in session
`e0fb1192` (2026-07-20), returning `no such task: QC-T1 (provider: native)` each time. The
loop continued running — the error was silently swallowed instead of triggering fixture
re-creation or a `needs-human` halt.

Root cause: two gaps:
1. `OUTER-LOOP.md` has no explicit session-start healthcheck step documenting how to handle
   `no such task: QC-T1` (the fixture being absent is a valid failure mode — the fixture may
   be deleted between sessions or never created).
2. The `QC-T1` fixture task does not currently exist in the task store (confirmed: `ls tasks/QC-T1*` → not found; `task_get QC-T1` → no such task).

The healthcheck probe is meant to be a liveness signal for the native task store. A silent fail
(loop continues despite "no such task") is invisible degradation.

## Scope

**In scope:**

1. **OUTER-LOOP.md session-start section** — add an explicit QC-T1 healthcheck step under the
   "Pinned references (read once at session start)" section:
   - Probe `task_get QC-T1` at session start
   - If "no such task": re-create the fixture with `task_write` (idempotent — the fixture is
     a simple liveness marker with known content)
   - Never silently swallow the error; the re-creation step IS the error handler

2. **`tasks/QC-T1.md` fixture task** — create (or re-create) with a clear marker:
   - `id: QC-T1`
   - `title: healthcheck fixture — native task store liveness probe`
   - `status: todo` (never done — it's a permanent fixture)
   - `labels: [fixture, healthcheck]`
   - Body: brief explanation of its purpose (loop healthcheck, not a real task)

**Out of scope:**
- Changes to any gate logic or scripts
- Mechanizing the probe (no new script; the fix is an operator procedure in OUTER-LOOP.md)
- QC-T2 / other fixtures
- Changes to the manda healthz gate (different mechanism)

**Behavior-preserving constraints:**
- `task_get QC-T1` returns a valid task after this milestone (not "no such task")
- OUTER-LOOP.md session-start section remains thinnable (this is a brief 2-4 line addition)

## Pre-dispatch it0 checks

**(a) ceiling/floor arithmetic:** ~15L OUTER-LOOP.md text + ~10L QC-T1 fixture task = ~25L. Under 2000L ceiling.

**(b) gate-hash (by-reference):**  
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

**(c) dogfooding evidence gate:** N/A at charter time.

**(d) domain-misfit audit-channel:** Standard methodology-class audit channel: read OUTER-LOOP.md and confirm the healthcheck step is present and correct; run `task_get QC-T1` to verify fixture exists.

**(e) plan-time line-budget gate:** ~25L estimated. Under 2000L ceiling.

## Class routing

**Methodology/design-class** (deliverable is a methodology doc edit to OUTER-LOOP.md + a fixture task file). Whole-milestone independent dual-iteration. No `quay-task-to-plan` pipeline.

## Value hypothesis

- **Y:** OUTER-LOOP.md session-start section documents QC-T1 healthcheck with idempotent re-create; `task_get QC-T1` returns valid task; no silent swallow
- **Δv̂ = 0** (governance-integrity / instrument-correction — no VT chart cell)
- **Value type:** governance-integrity / instrument-correction

## Done-when (binary)

1. `OUTER-LOOP.md` session-start section includes an explicit QC-T1 healthcheck step with idempotent re-create logic — paste the diff.
2. `tasks/QC-T1.md` exists in the task store; `task_get QC-T1` (or `ls tasks/QC-T1.md`) returns a valid fixture — paste confirmation.
3. Documented healthcheck procedure is idempotent: an absent QC-T1 triggers re-creation, never silent pass.
4. Adversarial audit verdict recorded.
5. `quay gate exp5-DEFECT-QC-T1-FIXTURE-PROBE-LOSS` exits 0 — paste exit code.

## Inner termination (§3.2)

1. All 5 Done-when confirmed.
2. ΔV < 0.02 both layers, K=2 consecutive.
3. Ceiling exceeded → `needs-human`.
4. Past budget ~10 iterations.
5. External HALT.

## HARD GATES (by-reference):

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

The manda healthz gate and port-4173 reachability gate are **N/A** this milestone (no Web UI or manda surface change). State N/A explicitly.

## Per-milestone acceptance audit (UNCONDITIONAL)

Specific charge:
1. Read the updated OUTER-LOOP.md session-start section; confirm QC-T1 healthcheck step is present with explicit re-create-on-missing logic.
2. Run `ls tasks/QC-T1.md` or `task_get QC-T1` — confirm valid fixture exists (not "no such task").
3. Confirm the procedure is idempotent: re-reading OUTER-LOOP.md after a hypothetical QC-T1 deletion would trigger re-creation, not silent pass.
4. Run `quay gate exp5-DEFECT-QC-T1-FIXTURE-PROBE-LOSS` — confirm exit 0.
5. Check `it0-dod-check.mjs` was NOT modified.

Output to `milestones/M91/audits/iteration-0-acceptance-audit.md`. Verdict: REFUTED / CONCERNS / NO REFUTATION FOUND.

## Note for ABSORB

- `it0-dod-check.sh` invocation: `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-DEFECT-QC-T1-FIXTURE-PROBE-LOSS experiments/quay-perpetual-stream/charters/M91-qc-t1-fixture-probe.md /tmp/m91-absorb-entry.md`
- `quay gate exp5-DEFECT-QC-T1-FIXTURE-PROBE-LOSS`
- Worktree: `milestones/M91/worktrees/iteration-0` off master HEAD
- milestone_counter: do NOT increment until all gates clear
- Dashboard row: `m91 · exp5-DEFECT-QC-T1-FIXTURE-PROBE-LOSS · Δv=0 (v̂=0) · audit=<verdict> · merge=<sha> · → milestones/M91/`
- No Web UI verification required (no Web UI surface change)
- VT Δ = 0
