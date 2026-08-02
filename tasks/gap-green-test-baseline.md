---
id: gap-green-test-baseline
title: "Restore a green scripts/test.sh baseline — 18 failures across 7 root
  causes, at least 4 of them real defects"
status: done
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`scripts/test.sh` has 18 failures. They have been treated as an accepted baseline ("pre-existing,
out of scope") across recent work — including by me. That treatment is wrong on two counts:

1. **It destroys the signal.** With a non-zero baseline, "did my change break something?" requires
   diffing failure *counts* against a moving target. A new failure hides among 18. Every task
   executed against this baseline carries an undetected-regression risk.
2. **At least 4 of the 7 root causes are real defects**, not stale-but-harmless tests. One of them
   is a golden-replay sentinel whose entire purpose is to catch the drift it is currently
   reporting — and being ignored for.

This is 1 mechanism (a green baseline). The 7 root causes below are coverage items, not
independent mechanisms.

### Root-cause taxonomy (measured 2026-08-02)

| # | Root cause | Failures | Real defect? |
|---|---|---|---|
| 1 | `tsc --noEmit` reports 2 errors: `packages/quay/src/gate/config/loader.ts:178` (`Type '{}' has no call signatures`) and `packages/quay/src/mcp-handlers.ts:673` (`ValidateConfigResult` → `Record<string, unknown>` conversion) | 3 (M63 A2/C1/D1) | **YES — product type errors** |
| 2 | Gate config loader now returns a `srcFile` field; three `deepEqual` tests still expect the shape without it | 3 | Test lag (contract change from DIR-104) |
| 3 | Diagnostic severity moved WARNING→ERROR (DIR-100-C) but tests expect WARNING — **and the implementation is self-inconsistent**: the header prints `## Diagnostics (2 warnings)` while the body lines print `ERROR:` | 2 | **YES — output contradicts itself** |
| 4 | `plugin/scripts/tree-hygiene-check.sh` contains `experiments/quay-perpetual-stream` / `exp5` references | 2 | **YES — breaks plugin portability** |
| 5 | `sync-vendor.sh --check` exits non-zero | 1 | Likely same source as #4 |
| 6 | `execute-milestone.js` golden replay: "phase sequence must be unchanged in legacy mode" fails on both mirrors, plus WORKTREE MODE deepEqual | 4 | **YES — the anti-drift sentinel is firing** |
| 7 | `quay-native adr list --applies-to` in/out-of-scope filtering | 2 | Unknown — needs diagnosis |
| 8 | `plugin/test/prepare-milestone-size-estimate.test.mjs` | 1 | Unknown — needs diagnosis |

Root cause #6 deserves emphasis: golden-replay tests exist for exactly one purpose — to fail when
a phase sequence changes without an intentional decision. It is failing. Treating that as
background noise defeats the mechanism.

## Chosen mechanism

Fix each root cause at its source, in this order (cheapest/most-blocking first). For each: decide
whether the IMPLEMENTATION or the TEST encodes the correct contract, fix that side, and state the
decision in the commit message. Never relax an assertion merely to get green.

1. **#1 tsc** — fix the two type errors in product code.
2. **#3 severity** — resolve the header/body contradiction first (that is a real bug), then align
   tests to whichever severity the resolved implementation emits.
3. **#2 srcFile** — decide whether `srcFile` belongs in the returned shape; update tests or the
   implementation accordingly.
4. **#4/#5 portability** — remove the experiment-path references from the vendored
   `tree-hygiene-check.sh`; re-run `sync-vendor.sh --check`.
5. **#6 golden replay** — diagnose what changed the phase sequence. If intentional, regenerate the
   golden with an explicit note; if not, revert the drift.
6. **#7/#8** — diagnose, then fix.

## Acceptance Criteria

- [x] AC1: `npx tsc --noEmit` exits 0 (root cause #1)
- [x] AC2: M63 A2/C1/D1 ts-typecheck gate tests pass
- [x] AC3: Diagnostic header count-label and body severity labels agree (root cause #3)
- [x] AC4: Section 1 / Section 4 diagnostic tests pass against the resolved severity
- [x] AC5: The three gate-config-loader `deepEqual` tests pass (root cause #2)
- [x] AC6: `grep -E 'experiments/quay-perpetual-stream|exp5' plugin/scripts/tree-hygiene-check.sh` returns nothing (root cause #4)
- [x] AC7: `sync-vendor.sh --check` exits 0 (root cause #5)
- [x] AC8: Both `execute-milestone.js` golden-replay tests pass, with the phase-sequence change either reverted or the golden regenerated under an explicit recorded decision (root cause #6)
- [x] AC9: `adr list --applies-to` tests pass (root cause #7)
- [x] AC10: `prepare-milestone-size-estimate.test.mjs` passes (root cause #8)
- [x] AC11: `scripts/test.sh` reports **0 failures**
- [x] AC12: No assertion was weakened to reach green — every test-side change is justified in its commit message as a contract decision

## Definition of Done

- [ ] `scripts/test.sh` green (0 failures), reproducible on a clean checkout
- [ ] Each of the 8 root causes has a commit stating which side (impl vs test) was authoritative and why
- [ ] Mirrors byte-identical where touched

## Touches

- packages/quay/src/gate/config/loader.ts
- packages/quay/src/mcp-handlers.ts
- plugin/scripts/tree-hygiene-check.sh
- experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh
- plugin/test/execute-milestone-worktree.test.mjs
- plugin/test/prepare-milestone-size-estimate.test.mjs
