# M78 iteration-0 report — DIR-054 dashboard context-budget discipline

**Branch:** exp5-m78-iteration-0  
**Worktree:** milestones/M78/worktrees/iteration-0  
**Date:** 2026-07-21

---

## §1 What was done

Four changes delivered per charter:

### 1. New gate script
`experiments/quay-perpetual-stream/scripts/it0-dashboard-line-budget-check.sh`  
HARD-FAILS (exit 1) when `dashboard.md` total lines ≥ 1200. Takes dashboard path as argument, defaults to `experiments/quay-perpetual-stream/dashboard.md` relative to repo root. Modeled on the existing `it0-ceiling-line-budget-check.sh` shape.

### 2. Gate selfcheck
`experiments/quay-perpetual-stream/scripts/it0-dashboard-line-budget-check-selfcheck.sh`  
Creates two synthetic FIXTURE files (over-cap: 1201 lines; under-cap: 100 lines), runs the gate on each, asserts RED+GREEN. Exits 0 if both hold, non-zero otherwise. DIR-019 discipline: fix belongs in the gate, not the fixtures.

### 3. OUTER-LOOP.md amendments
`experiments/quay-perpetual-stream/OUTER-LOOP.md` — two additions:
- **ABSORB write-step (step 6 header):** added one-line summary row format instruction for `## Log` section, retiring the multi-section per-milestone block format for all future milestones. Format: `m<NN> · <task-id> · Δv=<realized> (v̂=<estimate>) · audit=<verdict> · merge=<sha> · → milestones/M<NN>/`
- **New HARD block gate:** dashboard context-budget gate (DIR-054/M78) added after the DoD meta-enforcer gate and before "ABSORB lands the milestone's work", as a `milestone_counter++` HARD block.

### 4. Rolling window applied to dashboard.md + archive created
- `experiments/quay-perpetual-stream/dashboard-archive/log-m25-m72.md` — 6006 lines archived (Bootstrap m0 through m72 log content)
- `experiments/quay-perpetual-stream/dashboard.md` — trimmed from 6517 lines to 511 lines; head sections (lines 1–379) completely untouched; `## Log` header retained; content from `## M73 SELECT` onward kept

---

## §2 HARD GATES

**directives/pending/ gate:** N/A — exp4 artifact, not applicable to exp5 (exp5 uses task-canonical directives, no `directives/pending/` directory).

**manda healthz gate:** N/A — no Web UI surface touched this milestone.

**port-4173 reachability gate:** N/A — no Web UI surface touched this milestone.

**worktree gate:** N/A — using exp5 worktree at `milestones/M78/worktrees/iteration-0`, not the exp4 `experiments/quay-continuous-bootstrap/worktrees/` pattern.

---

## §3 Done-when evidence

### Done-when 1: selfcheck passes (RED+GREEN)

```
$ cd experiments/quay-perpetual-stream && ./scripts/it0-dashboard-line-budget-check-selfcheck.sh
PASS (RED): over-cap fixture correctly exited non-zero (exit 1)
PASS (GREEN): under-cap fixture correctly exited 0

PASS: both dashboard line-budget fixtures behaved as asserted (RED+GREEN).
```

### Done-when 2: OUTER-LOOP.md diff

```diff
diff --git a/experiments/quay-perpetual-stream/OUTER-LOOP.md b/experiments/quay-perpetual-stream/OUTER-LOOP.md
index fd671c6..372e860 100644
--- a/experiments/quay-perpetual-stream/OUTER-LOOP.md
+++ b/experiments/quay-perpetual-stream/OUTER-LOOP.md
@@ -245,6 +245,15 @@ per-milestone charters** — it is not itself a big per-iteration prompt.
    adaptations to the log; check φ — if a prior adaptation was just reused unchanged by THIS
    (different-domain) milestone, **CONSOLIDATE**: merge it into `inherited-core.md` and retire the
    citation (§4.2).
+   **Log write format (DIR-054/M78 — rolling-window discipline; replaces the multi-section per-milestone
+   block format for ALL future milestones):** emit ONE LINE into `dashboard.md`'s `## Log` section per
+   milestone ABSORB, using this exact format:
+   `m<NN> · <task-id> · Δv=<realized> (v̂=<estimate>) · audit=<verdict> · merge=<sha> · → milestones/M<NN>/`
+   where `<verdict>` is one of `NO REFUTATION FOUND` / `CONCERNS` / `REFUTED`. Example:
+   `m78 · DIR-054 · Δv=0 (v̂=0) · audit=NO REFUTATION FOUND · merge=abc1234 · → milestones/M78/`
+   Full ABSORB narrative lives in `milestones/M<NN>/iteration-0.md` (the iteration report); the `## Log`
+   row is a pointer only — do NOT expand it into a multi-section block. The dashboard-context-budget gate
+   enforces the 1200-line cap; a fat ## Log entry that busts the cap is a gate failure.
    - **SPLIT-OR-COMMIT — two terminal outcomes ONLY, no partial/pending (DIR-026, inherited-core
      Clause 9):** once a milestone has started, at ABSORB it is in exactly ONE of two outcomes:
      (i) **`done`** — every AC/DoD clause satisfied (Clauses 0-8 below; a "partial" ABSORB with an
@@ -415,6 +424,15 @@ per-milestone charters** — it is not itself a big per-iteration prompt.
        against the FINAL charter (see step 1 / step 4e). Smoke-test the wiring anytime:
        `quay gate QENG-5-DEMO-PASS` → 0, `quay gate QENG-5-DEMO-FAIL` → 1 (fixture tasks) — NOT a
        substitute for gating the REAL milestone.
+   - **Dashboard context-budget gate (DIR-054/M78; HARD-BLOCKS step 7's `milestone_counter++`):**
+     run `bash experiments/quay-perpetual-stream/scripts/it0-dashboard-line-budget-check.sh` and
+     paste stdout as evidence; non-zero exit HARD-BLOCKS `milestone_counter++`. The gate enforces a
+     1200-line cap on `experiments/quay-perpetual-stream/dashboard.md` — the ## Log section must
+     retain only the last ~5 milestones (rolling window); older entries are archived to
+     `experiments/quay-perpetual-stream/dashboard-archive/`. If the gate fires, apply the rolling
+     cut (archive m25..m<NN-5> content) THIS ABSORB before proceeding. Selfcheck:
+     `experiments/quay-perpetual-stream/scripts/it0-dashboard-line-budget-check-selfcheck.sh`
+     (RED+GREEN fixture pair, DIR-019 discipline).
    - **ABSORB lands the milestone's work on `master` directly (DIR-027 retired DIR-018's
      driver→master publish sub-step; runs AFTER the adversarial-audit, V_meta consolidation-lag,
      design-only-milestone impl-row, AND DoD meta-enforcer gates above all clear, and BEFORE step 7's
```

(a) Gate wired as HARD block before `milestone_counter++`: YES — added after DoD meta-enforcer, before "ABSORB lands".  
(b) ABSORB write-step amended to ONE-LINE summary row format: YES — added at step 6 header before SPLIT-OR-COMMIT.

### Done-when 3: dashboard.md wc -l < 1200 + gate run

```
$ wc -l experiments/quay-perpetual-stream/dashboard.md
511 experiments/quay-perpetual-stream/dashboard.md

$ cd experiments/quay-perpetual-stream && ./scripts/it0-dashboard-line-budget-check.sh ./dashboard.md
PASS: ./dashboard.md — 511 lines (cap 1200). Dashboard is within the line budget.
```

511 < 1200. Gate exits 0. PASS.

### Done-when 4: archive file exists with cut content

```
$ wc -l experiments/quay-perpetual-stream/dashboard-archive/log-m25-m72.md
6006 experiments/quay-perpetual-stream/dashboard-archive/log-m25-m72.md
```

6006 lines archived. File exists at `experiments/quay-perpetual-stream/dashboard-archive/log-m25-m72.md`.

### Done-when 5: head sections diff (lines 1–379 unchanged)

```
$ git diff HEAD -- experiments/quay-perpetual-stream/dashboard.md | head -50
diff --git a/experiments/quay-perpetual-stream/dashboard.md b/experiments/quay-perpetual-stream/dashboard.md
index 64fc1a0..eee0960 100644
--- a/experiments/quay-perpetual-stream/dashboard.md
+++ b/experiments/quay-perpetual-stream/dashboard.md
@@ -378,6012 +378,6 @@ at its existing `OUTER-LOOP.md` step-6 dispatch point, not a new separately-sche
 - explore cadence: ≥1 explore milestone per 5
 
 ## Log
-- Bootstrap (m0): confirmed exp4 stopped, carry-by-reference verified (backlog.md → exp4 reopened
-  DIRs + open gaps; inherited-core.md → 3 extracted skills + exp4 methodology). Scored VT₀=82.25
-  from exp4 gap-list.md. state → RUNNING. Selecting M-DIST next per backlog guidance (explore,
-  URGENT).
```

The diff starts at line 378 (the line before `## Log`). Lines 1–377 show NO change — only the `## Log` body content (lines 381+) is removed. Head sections lines 1–379 are completely untouched.

### Test suite

```
$ cd packages/quay && node --test $(ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance|web-ui-browser') 2>&1 | grep -E "^ℹ (tests|pass|fail)"
ℹ tests 342
ℹ pass 338
ℹ fail 4
```

4 failures are pre-existing (adr-gate.test.mjs E3/A1A3 and dir032-audit-independence.test.mjs M44 A2/C1) — not introduced by this milestone. Confirmed by running same tests against master: same 4 failures.

---

## §4 Outcome

**DONE**

All four charter deliverables landed:
1. Gate script created and exits non-zero on over-cap, 0 on under-cap.
2. Selfcheck passes RED+GREEN.
3. OUTER-LOOP.md diff shows gate wired as HARD block + ABSORB write-step amended to one-line format.
4. dashboard.md trimmed to 511 lines (< 1200 cap); gate exits 0 on it.
5. Archive `dashboard-archive/log-m25-m72.md` created with 6006 lines.
6. Head sections (lines 1–379) unchanged — diff starts at line 378 with no head-section removals.
