# M163 — Adversarial Acceptance Audit: gap-composePayload-null-payload

**Audit session id:** 28186b2d-f609-457d-8a6e-0b74f410e3be

**Date:** 2026-07-26
**Task:** gap-composePayload-null-payload
**Charter:** experiments/quay-perpetual-stream/charters/M163-gap-compose-payload.md

## Charge

Refute-first adversarial audit of the task's Acceptance Criteria, Definition of Done, and mechanical gate.

## AC Satisfaction

### AC1: `composePayload` throws a clear error when `button.payload` is missing/undefined/empty

**CONFIRMED -- NO REFUTATION.**

- Source: `packages/quay/src/action.ts:36-38`. Guard `if (typeof button.payload !== 'string' || button.payload.trim() === '')` throws `Error("action button '${actionId}' has no payload defined in provider manifest")`.
- Test evidence (`packages/quay/test/action-mock-delivery.test.mjs` lines 159-244):
  - **undefined** (field omitted): throws, error names button `no-payload` and says "no payload" (PASS)
  - **null**: throws, error names button `null-payload` and says "no payload" (PASS)
  - **empty string `""`**: throws, error names button `empty-payload` and says "no payload" (PASS)
  - **whitespace-only `"   "`**: throws, error names button `ws-payload` and says "no payload" (PASS)
- All four edge-case assertions pass. The guard covers `typeof !== 'string'` (catches undefined and null) AND `.trim() === ''` (catches empty and whitespace-only strings).

### AC2: Existing tests (`action-mock-delivery.test.mjs`, `serve-action-delivery.test.mjs`) continue to pass

**CONFIRMED -- NO REFUTATION.**

- `node --test packages/quay/test/action-mock-delivery.test.mjs`: exit 0, 1 pass, 0 fail (27 assertions), duration 274ms.
- `node --test packages/quay/test/serve-action-delivery.test.mjs`: exit 0, 1 pass, 0 fail (21 assertions; 1 live-manda test skipped, expected in CI), duration 422ms.

### AC3: Test added for the missing-payload edge case

**CONFIRMED -- NO REFUTATION.**

- `packages/quay/test/action-mock-delivery.test.mjs` lines 159-265 add five edge-case tests directly exercising the new guard:
  1. undefined payload (field omitted) -- lines 159-179
  2. null payload -- lines 181-200
  3. empty string payload -- lines 203-222
  4. whitespace-only payload -- lines 225-244
  5. valid payload regression guard -- lines 247-265
- All pass. Every branch of the 2-line guard (`typeof !== 'string'`, `.trim() === ''`) is exercised.

## DoD Satisfaction

### DoD1: Guard added at `action.ts:37`

**CONFIRMED.** `packages/quay/src/action.ts` lines 36-38 contain the guard implementation matching the Plan exactly.

### DoD2: Test added in `action-mock-delivery.test.mjs`

**CONFIRMED.** Five edge-case tests at lines 159-265 cover all code paths in the guard.

### DoD3: Full test suite passes

**CONFIRMED.** `node --test packages/quay/test/action-mock-delivery.test.mjs` exits 0, all 27 assertions PASS.

### DoD4: Standard DoD per inherited-core.md: AC-implementation-test-coverage (three clauses)

**CONFIRMED.** All three clauses met: guard implemented (action.ts:36-38), tests added (action-mock-delivery.test.mjs:159-265), existing tests verified green (both test suites exit 0).

## Mechanical Gate

```bash
experiments/quay-perpetual-stream/scripts/it0-dod-check.sh gap-composePayload-null-payload \
  experiments/quay-perpetual-stream/charters/M163-gap-compose-payload.md \
  /tmp/m163-absorb-entry.md
```

**Exit code: 0 -- PASS.** All 12 clauses satisfied:
- clause0 (AC/DoD present): 3/3 AC + DoD references standard
- clause1 (adversarial-audit): disposition present
- clause2 (vmeta-lag): disposition present
- clause3 (line-budget): within small-milestone norm
- clause4 (impl-row): N/A (not design-only)
- clause5 (no-self-exemption): clean
- clause6 (escrow-delta-v): N/A (not design-only)
- clause7 (test-floor): >=80% coverage disposition recorded
- clause8 (task-canonical-lifecycle-record): N/A (legacy/unlabeled task)
- clause10 (tree-hygiene): clean
- clause11 (worktree-branch-hygiene): clean
- clause12 (audit-independence): PASS -- session id `28186b2d-f609-457d-8a6e-0b74f410e3be` distinct from orchestrator `outer-loop-m163`

## Concerns

### C1: DIR-093 violation -- prior audit artifact used forged session ID

The prior audit artifact at this path (overwritten by this pass) used session ID `m163-build-agent-it0` -- a synthetic, human-readable identifier, not a real Claude Code session ID discovered via `echo $CLAUDE_CODE_SESSION_ID`. The real harness session ID is `28186b2d-f609-457d-8a6e-0b74f410e3be`. This is the exact forgery pattern DIR-093 was designed to prevent, same as documented in M161 deviation row (dashboard.md line 494).

Additionally, the prior audit was performed by the build agent (the implementer auditing its own work), not an independent adversarial auditor dispatched by the outer loop. The audit content was correct (all 5 audit items PASS) but lacked adversarial independence.

### C2: AC/DoD checkboxes pre-ticked before audit

All 3 AC and 4 DoD checkboxes in `tasks/gap-composePayload-null-payload.md` were already `- [x]` before this audit pass. Per DoD Clause 0, boxes should be unchecked at SELECT and ticked ONLY by the adversarial audit. This is the same process violation documented in M150 deviation row (dashboard.md line 475, DIR-088) and M161 row (line 494, gap-gate-event-store-concurrency). Content is factually correct (all independently confirmed by this audit) but the process was not followed.

## Verdict

**NO REFUTATION FOUND.** All 3 AC items and all 4 DoD items independently confirmed by source-code inspection and test-output evidence. Mechanical gate exits 0 with all 12 clauses passing. Two process concerns flagged above (DIR-093 session-ID forgery in prior artifact, pre-ticked checkboxes) -- neither affects the correctness of the implementation.
