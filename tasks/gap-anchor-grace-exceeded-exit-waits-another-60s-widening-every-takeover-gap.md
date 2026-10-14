---
id: gap-anchor-grace-exceeded-exit-waits-another-60s-widening-every-takeover-gap
title: anchor 宽限超时「exiting anyway」后又白等 min(60s,grace)：每次接管多出 ~60s 无 driver
  间隙（ClaudeCodeUI 7/7、quay 多数）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal
**Measured 2026-10-14 across every anchor takeover in the two hosts' `.quay/anchor.log`.** The interval between the old anchor's `shutdown grace …ms exceeded … — exiting anyway` and the new anchor's `takeover <pid> exited — taking over` is:
- **ClaudeCodeUI: 7/7 takeovers at 60–61s** (`[61, 61, 60, 60, 60, 61, 61]`), including the human-authorized r5 and r6 swaps of 2026-10-14 (06:31:45 → 06:32:46, 08:04:17 → 08:05:18).
- **quay: last 12 of 79**: `[60, 60, 61, 72, 60, 27, 60, 60, 30, 60, 61, 60]`.

During those ~60s, **no worker loop dispatches or adopts on the host**. The old anchor has stopped its loops, and the new one is blocked in its takeover wait. This is the exact window in which a finishing worker becomes an orphan (2026-10-14 06:32:32Z, `gap-voice-close-trace-row-removed-from-transcript`, booked `failed: orphaned`).

**Cause (`driver-anchor.ts`, end of the anchor body).** When the reconcile loop decides the grace is exhausted (`Date.now() - stopRequestedAt > shutdownGraceMs`), it logs "exiting anyway" and `break`s. The code right after the loop then waits **again** for the same still-draining loops: `const deadline = Date.now() + Math.min(60_000, shutdownGraceMs); while (active.size > 0 && Date.now() < deadline) …`. Those loops have just been declared not-finishing, so on the grace-exceeded path that second wait almost always runs its full 60s. `oldAnchorWorstExitMs(grace) = grace + min(60000, grace)` (`:241`) even budgets for it, so the takeover side has adapted to the delay instead of the delay being removed.

## Plan
1. On the grace-exceeded exit path, skip the post-loop wait. It still matters on the normal stop path, where loops are expected to finish shortly. Keep the cleanup (pid carriers, state file, `exited` log) unchanged.
2. Re-derive `oldAnchorWorstExitMs` / `takeoverBudgetMs` from the new worst case. Do not leave a stale `+ min(60000, grace)` term behind (硬规则 5b: the budget and the wait are the same fact in two places).
3. No change to grace length, to SIGTERM semantics, or to the "in-flight children are not killed" invariant.

## Acceptance Criteria
- [ ] AC1: before the fix, a dist scratch host where one kind's loop ignores stop (fixture), plus a takeover via `spawnAnchor({takeoverPid})` + SIGTERM. Paste the measured "exiting anyway" → "takeover … exited" lag (expect ~60s with the default 60s cap, or `min(60000, grace)` with a short `QUAY_ANCHOR_SHUTDOWN_GRACE_MS`).
- [ ] AC2: after the fix, same harness: lag ≤ one reconcile tick plus cleanup, i.e. a few seconds (pasted). The normal (non-grace-exceeded) stop path still waits for loops that do finish (fixture pasted).
- [ ] AC3: `oldAnchorWorstExitMs` and its test reflect the new bound; the takeover still succeeds on the fixture (pasted).
- [ ] AC4: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC4 checked with pasted evidence; in-flight children still survive the old anchor's exit.

## Touches
- tasks/gap-anchor-grace-exceeded-exit-waits-another-60s-widening-every-takeover-gap.md
- plugin/scripts/driver-anchor.ts
- plugin/test/driver-anchor-takeover.test.mjs
