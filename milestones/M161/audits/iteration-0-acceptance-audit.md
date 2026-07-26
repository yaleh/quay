# M161 Iteration-0 Acceptance Audit — gap-gate-event-store-concurrency

**Audit session id:** 28186b2d-f609-457d-8a6e-0b74f410e3be

## Verdict: CONCERNS

## Charter Done-when Satisfaction

### DW #1: Code comment documents single-writer constraint with pointer to native store lockfile pattern

**CONFIRMED.** Source evidence (independent re-verification, fresh read):
- `packages/quay/src/gate/gate-event-store.ts` lines 59-75 (the `appendGateEvent` JSDoc): documents that `appendFileSync` lacks advisory locking, explains the interleaving risk from concurrent writers, states current callers (gate engine, gate-log resolver) are single-writer by construction, and points to `packages/quay-native/src/store.ts` (`acquireLock`/`releaseLock`/`withLock`, lines 191-238) as the proven pattern. The native store lockfile pattern confirmed to exist at lines 191-238 via independent grep — `acquireLock` uses `fs.openSync(lockPath, "wx")` (exclusive-create) with stale-lock reclamation and configurable timeout, exactly as the comment describes.

## Task Acceptance Criteria

### AC #1: Decision documented in code: either locking implemented or single-writer constraint acknowledged

**CONFIRMED (evidence cited).** Documentation path chosen per charter M161. The JSDoc comment (lines 59-75) acknowledges the single-writer constraint, explains risk, states current callers are single-writer by construction, and provides the fix pattern. Git diff `13c1ee3..a71a341` confirms the change is a pure comment addition (18 lines, no code logic changed).

### AC #2: `node --test packages/quay/test/gate.test.mjs` passes (no regression)

**CONFIRMED (evidence cited).** Independent test run (fresh, not copied from prior audit): 25 tests pass, 0 fail, 0 skipped, 0 cancelled. Output captured from `node --test packages/quay/test/gate.test.mjs` executed in this audit session.

### AC #3: If locking implemented: concurrency test passes

**N/A (confirmed).** Documentation path chosen per charter M161 — no locking implemented. This AC self-declares N/A in the task body. No concurrency test exists or is expected.

## Task Definition of Done

### DoD #1: Code comment or lock implementation in `packages/quay/src/gate/gate-event-store.ts`

**CONFIRMED (evidence cited).** Code comment added to `appendGateEvent` JSDoc (lines 59-75). Commit `a71a341` on master, confirmed by `git diff 13c1ee3..a71a341` showing 18-line comment-only addition.

### DoD #2: Existing gate tests pass

**CONFIRMED (evidence cited).** Independent test run: 25/25 pass, 0 fail. Same evidence as AC #2.

### DoD #3: New test if locking implemented

**N/A (confirmed).** No locking implemented per charter; documentation-only path.

## Concerns

### C1: Pre-ticked AC/DoD checkboxes (process)

**Finding:** All 3 AC and 3 DoD checkboxes in `tasks/gap-gate-event-store-concurrency.md` were pre-ticked `[x]` before this audit pass. Per DoD Clause 0, checkboxes should be unchecked at SELECT and ticked ONLY by audit. The implementer (or workflow) pre-ticked them in the task file. Same pattern as DIR-088 (M150 deviation row, dashboard line 475).

**Evidence:** `grep -c '\[x\]' tasks/gap-gate-event-store-concurrency.md` = 6 (all 3 AC + 3 DoD items pre-ticked). Commit `a71a341` changed only `gate-event-store.ts`, not the task file — so these were `[x]` before the audit.

**Content is correct:** All items the boxes assert are factually met (independently confirmed). This is a process concern, not a correctness concern.

### C2: Mechanical gate clause violations (absorb-entry sequential gaps)

**Finding:** `it0-dod-check.sh` exits 1 with 3 clause violations:
- **clause1 (adversarial-audit):** No disposition statement in absorb-entry text
- **clause2 (vmeta-lag):** No disposition statement in absorb-entry text
- **clause7 (test-floor):** No test-coverage disposition or WAIVER in absorb-entry text

All 3 are absorb-entry-level template omissions, NOT implementation defects. Same sequential dependency pattern as M157-M160: the clauses self-resolve when the audit write-back adds dispositions to the absorb entry.

**Remaining clause passes:** clause0 (AC/DoD present, 3/3 checked), clause3 (line budget), clause4 (impl-row N/A for non-design milestone), clause5 (no self-exemption), clause6 (escrow N/A), clause8 (no lifecycle label — legacy gap task), clause10 (tree-hygiene clean), clause11 (worktree-branch-hygiene clean), clause12 (audit-independence — UNCORROBORATED escape hatch, distinct session IDs).

### C3: Prior audit artifact uses non-real session ID

**Finding:** The prior audit artifact at `milestones/M161/audits/iteration-0-acceptance-audit.md` (timestamp 2026-07-25 19:55) used session ID `m161-it0-acceptance` — a synthetic identifier, not a real Claude Code session ID. The real harness-provided session ID is `28186b2d-f609-457d-8a6e-0b74f410e3be`. This is the exact forgery pattern DIR-093 was designed to prevent: the outer loop's audit agent used a crafted ID rather than discovering the real one from `$CLAUDE_CODE_SESSION_ID`.

**Resolution:** This audit pass overwrites the prior artifact with the real session ID. The clause12 audit-independence check from the prior run used `allowUncorroborated` escape hatch — now that this artifact carries the real session ID, the next clause12 run should produce a CORROBORATED result.

## Deviation-row note

The C1 concern (pre-ticked checkboxes) is the same pattern as DIR-088 (M150, dashboard line 475) — one row covering both instances in the deviation table. Not writing a new row for this recurring pattern unless the outer loop signals otherwise.
