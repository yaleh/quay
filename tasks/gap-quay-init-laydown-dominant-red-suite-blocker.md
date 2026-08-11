---
id: gap-quay-init-laydown-dominant-red-suite-blocker
title: quay-init laydown breaks the full-suite gate (dominant of 178 fails) — no
  open task tracks it, so all dispatch stays gated
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
## Finding

The full-suite gate has been `red, reason=failed` since 2026-08-06 15:53, and the DOMINANT failure cluster is the quay-init laydown/install — yet NO open task on the board tracks it (grep-verified 2026-08-06 16:5x: the quay-init tasks in tasks/ are all `done`; `gap-quay-init-never-commits-broken-committed-state` is `todo` but a different angle). Because the red gate is `reason=failed` (not `aborted`), it sets `stopSignal:true` → **ALL dispatch is held**, including critical ready tasks (e.g. `gap-session-liveness-session-pid-blind-to-claude-as-pane-process`, which the human escalated 2026-08-06 as blocking manager→outer observability).

## Measured (2026-08-06 16:4x, .quay/full-suite.log of the 15:53 run)

- 178 assertion failures (`ERR_ASSERTION`), dominant cluster:
  - `quay-init-loop.test.mjs` — **44**
  - `install-config-driven-e2e.test.mjs` — 9
  - `runtime-landing.test.mjs` — 5
  - `quay-init-drift-report.test.mjs` 4, `quay-init-check-drift.test.mjs` 4, `quay-init-tmux-detection.test.mjs` 3, `laydown-set-check.test.mjs` 3 → quay-init family ≈ 58+ of 178
- Secondary: `worktree-root-fs-check.test.mjs` — expected 0 stranded worktrees, found 4: `quay-worktrees/manager-productization` (task/manager-productization), `quay-worktrees/resource-aware`, `milestones/M239/worktrees/iteration-0` (RETIRED classic-loop, safe to remove), `/tmp/quay-intg2` (integration)
- Resource gate is now GO (cpu_stall 4.69/40, mem 12GB, rc=0) — so the 15:53 red was NOT a resource-WAIT false-red; the suite genuinely ran and genuinely failed. Re-running without fixing the root cause re-reds (nothing fixed since 15:53).
- `gap-full-suite-runner-marks-test-sh-gate-wait-as-failed` (ready) covers the gate-WAIT→aborted misclassification, but the CURRENT red is real failures, not gate-WAIT — the two are distinct.

## Why it matters

The quay-init laydown is the single biggest lever on the loop right now: it gates ALL dispatch. The human's escalated session-pid task is ready and in the pool but cannot be dispatched until this red clears. A verified finding with no open task = the exact "shipped but not tracked" shape the loop keeps filing.

## Suggested shape

This is a development-class fix (quay-init laydown + its tests). It needs a Plan (root-cause the 44 quay-init-loop failures), so promote to `ready` only after a Plan/AC/DoD are written. Until then it is a triage pointer.

## AC (draft)

- [ ] Root-cause the quay-init-loop.test.mjs 44-failure cluster (laydown install artifacts vs. test drift) and state the verdict in the task body
- [ ] `scripts/test.sh` green with the quay-init family passing
- [ ] Stranded worktrees reconciled (M239 retired worktree removed; task worktrees verified in-flight or cleaned with worktree-branch-hygiene gate)

## DoD (draft)

- [ ] `.quay/full-suite-state.json` = `green` after the fix run
- [ ] The inner's next dispatch round sees the ready pool (gate cleared)
- [ ] Full suite green (`scripts/test.sh`) including the quay-init family

## Evidence

- `.quay/full-suite-state.json` = `{"state":"red","reason":"failed","finishedAt":"2026-08-06T15:53:32.148Z"}`
- `.quay/full-suite.log`: `grep -cE 'not ok|ERR_ASSERTION'` = 178; per-file: quay-init-loop 44 (top)
- `git worktree list`: 4 worktrees beyond main checkout
- resource-gate: `=> GO`

## Root-cause verdict (inner, 2026-08-07 06:3x — verified, not inferred)

**The 44-failure cluster root cause has TWO layers, both now understood:**

1. **Laydown/referenced-not-landed gaps — ALREADY FIXED on current tree.** Verified: all 5 mechanisms (task-contract-check.ts, inner-blocked-signal.ts, inner-forensics.mjs, task-status-drift-check.ts, touches-orthogonality-check.ts) are laid down by a real `quay-init --loop`; `verify-referenced-landed: OK`; the previously-failing `AC4 — loop-driver-check.sh is laid down` test now passes (6.7s). The 05:37 suite's `referenced-not-landed: SPEC-branching-model...` was against a stale pre-fix tree.

2. **quay-init-loop.test.mjs "90s timeout" = node:test worker event-loop exhaustion, NOT a test-logic failure.** The file has 54 tests, 37 of which each spawn a real `quay-init --loop` (~5.5s, each spawning python3 children). Full-file run self-fails at **167s** with `'Promise resolution is still pending but the event loop has already resolved'` (cancelled 1). Pattern-runs UNDER the exhaustion threshold pass: AC1+AC3 (19 tests) = 86s green; AC1 (12 tests) = 51s green; individual tests = 2-7s green. The "hang"/"timeout" is the node:test worker being torn down when its event loop empties mid-Promise under heavy blocking spawnSync — matching `gap-suite-cutoff-what-tears-test-process-at-session-topology.md`'s finding (same message ×35 in the 04:0x suite red).

**Recommended fix (mechanical, aligns with gap-suite-cutoff):** split `quay-init-loop.test.mjs` (1286 lines) into 2-3 smaller files (each ~18 tests, ~80-90s, under the exhaustion threshold), extracting the shared helpers (`makeTmp`/`cleanup`/`diskWorktreeRoot`/`runInit`/`extractRefs`/`declaredSet`) into a `quay-init-loop-helpers.mjs` module. Each split file then runs green within the node:test worker's event-loop budget.
