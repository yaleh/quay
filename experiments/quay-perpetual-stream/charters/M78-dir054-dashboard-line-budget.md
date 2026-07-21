# Charter M78-dir054-dashboard-line-budget — dashboard.md context-budget discipline

**Milestone id:** M78  
**Task:** `tasks/DIR-054.md` (milestone-candidate, directive)  
**Surface:** `experiments/quay-perpetual-stream/` (dashboard.md + OUTER-LOOP.md + scripts/)  
**Type:** governance-integrity (method-infra) + explore (new standing gate)  
**Charter authored:** 2026-07-21  
**Base commit:** `e6fc2675476f57570ffa00707b125ebfabe5fe0b`  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Scope

`dashboard.md` is 6505 lines / ~545 KB. The `## Log` section (line 380→EOF, ~6125 lines, 94%) is an unbounded append-only narrative that grows by hundreds of lines per milestone. Every agent that opens the dashboard for context pays the full 545 KB cost, and the live signal (latest milestones) is buried past the `Read` default 2000-line window. This is the same pathology exp5 retired from exp3's `provenance.md` — and which has silently regrown.

**In scope:**
1. `scripts/it0-dashboard-line-budget-check.sh` — new gate: HARD-FAIL when `dashboard.md` exceeds **1200 lines** (a generous ceiling above the ~380-line head + ~10-line summary log); exit 0 when under. Fixture-pinned by `scripts/it0-dashboard-line-budget-check-selfcheck.sh` (RED fixture → gate exits non-zero; GREEN fixture → gate exits 0), exactly like `it0-ceiling-line-budget-check.sh`.
2. Wire the gate into `experiments/quay-perpetual-stream/OUTER-LOOP.md` ABSORB step as a **HARD block on `milestone_counter++`** — alongside the Clause-3 charter line-budget and V_meta-lag ALARM. An over-cap dashboard MUST NOT advance the counter.
3. Amend the OUTER-LOOP.md ABSORB write-step instruction to emit a **ONE-LINE summary row** per milestone into `## Log`:
   `m<NN> · <task-id> · Δv=<realized> (v̂=<estimate>) · audit=<verdict> · merge=<sha> · → milestones/M<NN>/`
   The multi-section per-milestone block is retired for FUTURE milestones. The first milestone that uses this format is M78 itself (its ABSORB writes its own one-line row, proving the amendment is live).
4. Apply the **rolling window ONCE** now: `## Log` retains only the last **N=5** milestones live (M73-M77). Everything prior (m25→m72) moves to `experiments/quay-perpetual-stream/dashboard-archive/log-m25-m72.md` (git history cited as authoritative provenance for the detail). `dashboard.md` is brought under the 1200-line cap.

**Out of scope:**
- Head sections (VT curve, health tracks, control limits, homeostatic variables) — **byte-for-byte unchanged** except legitimate milestone-boundary updates in step 4 (none expected for a methodology milestone with Δv=0).
- No change to VT arithmetic, any gate verdict, or the eval ruler.
- Restoring `milestones/M<NN>/` dirs for M48–M76 — flagged as a separate follow-up per DIR-054 Notes.
- Any product code (`packages/`) — **DO NOT TOUCH**.
- The portable loop-driver skill — this is exp5's bespoke dashboard, not the portable skill.

## Value hypothesis

- **Y (metric):** `dashboard.md` < 1200 lines, gate PASSES, `it0-dashboard-line-budget-check-selfcheck.sh` RED+GREEN, OUTER-LOOP ABSORB amended, M78's own one-line ABSORB row written
- **Δv̂ = 0** (method-infra, no VT chart cell — same class as M36/M39/M46)
- **Value type:** governance-integrity (explore — new standing gate prevents third recurrence of this pathology; per OUTER-LOOP §4.5: method infrastructure = explore)
- **Explore slot:** M73–M77 were all exploit-typed; the ≥1 explore per 5 rule requires an explore pick at M78.

## Pre-dispatch it0 checks

**(a) ceiling/floor arithmetic:** N/A — this milestone cites no `gap-list.md` gap or numeric floor; `it0-ceiling-check.sh` not applicable. Directive directive-sourced, not gap-sourced.

**(b) gate-hash / transclusion (by-reference):**  
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

Gate-hash check: `bash experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference experiments/quay-perpetual-stream/charters/M78-dir054-dashboard-line-budget.md` → PASS (re-confirm at dispatch).

**(c) dogfooding evidence gate:** N/A at charter time — runs against each iteration's report as produced.

**(d) domain-misfit audit-channel:** Deliverables are script files + OUTER-LOOP.md edits + dashboard.md cut. Independent mechanism IS reachable: auditor can run `wc -l dashboard.md`, run `bash scripts/it0-dashboard-line-budget-check.sh`, read the OUTER-LOOP.md diff to confirm the ABSORB write-step change is live, and verify the archive file exists with the cut content. Does NOT apply — standard development-class, independently runnable acceptance.

**(e) plan-time line-budget gate:** This charter is ~130 lines, single-phase, well under the ≤2000-line ceiling.

**Sizing (SPLIT-OR-COMMIT):** Bounded scope: 2 new script files (≤30 lines each), 2 OUTER-LOOP.md edits (~5 lines each), one dashboard.md cut + archive. Iteration-0 should land all Done-when in one pass.

## Class routing

**Development-class** (deliverables = script files + OUTER-LOOP.md edits + dashboard.md transformation). Direct-to-implementation: the task's `## Requested action` enumerates all 4 steps precisely; no further planning required.

## Done-when (binary)

1. `scripts/it0-dashboard-line-budget-check.sh` exists: exits non-zero when given an over-cap input (fixture), exits 0 when given an under-cap input (live dashboard after cut). `scripts/it0-dashboard-line-budget-check-selfcheck.sh` fixture-pins RED+GREEN and passes. Pasted stdout confirms.
2. The gate is referenced in `OUTER-LOOP.md` ABSORB step as a HARD block on `milestone_counter++` (alongside Clause-3 charter line-budget + V_meta-lag ALARM). Pasted diff confirms the exact edit.
3. `OUTER-LOOP.md` ABSORB write-step instruction is amended to emit ONE-LINE summary rows (format: `m<NN> · <id> · Δv=<x> (v̂=<y>) · audit=<verdict> · merge=<sha> · → milestones/M<NN>/`). Pasted diff confirms.
4. `## Log` in `dashboard.md` retains EXACTLY the last 5 milestones (M73–M77) as one-line summary rows (or the existing block for the 5 prior milestones — see note below). Earlier content (m25→m72) is in `experiments/quay-perpetual-stream/dashboard-archive/log-m25-m72.md`. `wc -l dashboard.md` < 1200. `it0-dashboard-line-budget-check.sh` exits 0 on `dashboard.md`.
5. Head sections (VT curve/health tracks/control-limits/homeostatic) diff shows NO change (or only the M78 milestone-boundary update consistent with Δv=0). Pasted diff confirms no ruler/arithmetic change.

**Note on format for the retained M73-M77 Log blocks:** Converting the existing 5 blocks to one-liners is permitted but not required — retaining them as-is while pruning m25-m72 is acceptable for the one-time cut (the important change is the FUTURE ABSORB format in OUTER-LOOP.md). The mandatory constraint is that `dashboard.md` < 1200 lines after the cut. If retaining 5 full blocks exceeds 1200 lines, convert the oldest to one-liners until under-cap.

## Inner termination (§3.2)

Terminate inner iteration on the FIRST of:
1. All 5 Done-when confirmed with pasted evidence.
2. ΔV < 0.02 both layers, K=2 consecutive (stall).
3. Ceiling exceeded → redesign.
4. Past budget ~10 iterations with nothing advancing.
5. External HALT (`.halt` sentinel).

## HARD GATES (by-reference — see `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines 100-131 for the full literal text; the dispatched iteration-0 prompt MUST include the full literal gate text — NOT just this hash reference):
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

The manda healthz gate and port-4173 reachability gate are **N/A** this milestone (no Web UI surface touched). State N/A explicitly in the iteration report — do not silently omit.

## Per-milestone acceptance audit (UNCONDITIONAL, `inherited-core.md` Clause 1)

Every ABSORB dispatches a fresh-context adversarial audit subagent. The audit's specific charge:
1. Independently run `wc -l experiments/quay-perpetual-stream/dashboard.md` — confirm < 1200 lines.
2. Independently run `bash experiments/quay-perpetual-stream/scripts/it0-dashboard-line-budget-check.sh` on the live dashboard — confirm exit 0. Run it on the RED fixture — confirm non-zero exit.
3. Read the OUTER-LOOP.md diff (ABSORB step and write-step sections) — confirm the gate is wired as HARD block AND the write-step emits ONE-LINE rows going forward.
4. Confirm `experiments/quay-perpetual-stream/dashboard-archive/log-m25-m72.md` exists (the archive file with the cut content).
5. Confirm head sections (VT curve / health tracks / control limits / homeostatic) are byte-unchanged (or only have Δv=0 M78 updates). NO ruler/arithmetic change — REFUTE any VT re-scoring.
6. Confirm no load-bearing still-live fact was lost: any fact in the cut Log that has no other authoritative home (not in git commit, not in `milestones/M<NN>/`, not in a task) is either in the archive file or was migrated to its proper source.

Output to `milestones/M78/audits/iteration-0-acceptance-audit.md`. Verdict: REFUTED / CONCERNS / NO REFUTATION FOUND.

## Note for ABSORB

- `it0-dod-check.sh` invocation: `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-054 experiments/quay-perpetual-stream/charters/M78-dir054-dashboard-line-budget.md /tmp/m78-absorb-entry.md`
- `quay gate DIR-054` (uses `extra.acceptance` seeded at SELECT above)
- Worktree: `milestones/M78/worktrees/iteration-0` off master HEAD at dispatch time
- milestone_counter: do NOT increment until audit + vmeta-lag + impl-row + DoD meta-enforcer gates ALL clear
- Dashboard ABSORB row format (NEW — this milestone introduces this format): `m78 · DIR-054 · Δv=0 (v̂=0) · audit=<verdict> · merge=<sha> · → milestones/M78/`
- Backlog: regenerate via `node experiments/quay-perpetual-stream/scripts/it0-backlog-regen.mjs experiments/quay-perpetual-stream --write` after status update
- No Web UI verification required (no UI surface touched)
- VT Δ = 0 (method-infra, no cov-cell change — same class as M36/M39)
