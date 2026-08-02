---
id: gap-symlink-mirror-invocation-test-contract-mismatch
title: "symlink-mirror-invocation.test.mjs asserts a uniform no-args CLI contract
  that two real scripts legitimately violate — fast-mode-telemetry (exit 0 +
  usage on no-args) and milestone-worktree (output embeds Date.now())"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

The layer-grouping glob extension (B3-2) made `experiments/quay-perpetual-stream/test/
symlink-mirror-invocation.test.mjs` run in the default engine group. Two of its per-script
assertions fail against real scripts that were never exercised by this test before. Neither is a
regression from B3-2 (both reproduce on master; the test and the scripts predate the grouping) —
they are a **contract mismatch between the test's implicit uniform assumption and two scripts'
legitimate divergent behavior**. They were invisible until the glob made the test run.

## Finding (measured 2026-08-02)

The test assumes every discovered symlinked CLI has the same no-args contract: **nonzero exit + some
output** (`symlink-path invocation is non-silent`), and **byte-identical stdout/stderr/exit between
symlink and real invocation paths**.

Two real scripts violate one assumption each:

1. **`fast-mode-telemetry.ts` — `symlink-path invocation is non-silent` fails.** No-args invocation
   (via either path) prints the usage block to **stdout and exits 0**:
   ```
   $ node --experimental-strip-types experiments/quay-perpetual-stream/scripts/fast-mode-telemetry.ts
   fast-mode-telemetry.ts — fast-mode (direct) execution metering ...
   Usage: ...
   symlink exit=0
   ```
   This is a **legitimate deliberate design** (B2-1, `gap-fast-mode-no-telemetry`): the tool is a
   REPORT utility whose no-args path prints usage and exits 0 — the exact contract the 
   `--report`/`--task-start`/`--task-end` CLI uses, and one the test's assumption cannot
   distinguish from the "guard did not fire" defect class it exists to catch.
2. **`milestone-worktree.ts` — `symlink-path and real-path invocations produce identical
   stdout/stderr/exit code` fails.** `emit()` at line 351 embeds `nowMs: Date.now()` in its JSON
   output. Two invocations milliseconds apart necessarily differ, so the byte-equality assertion
   cannot pass for this script regardless of any real defect.

**These are not regressions** — they are the test's implicit uniform contract not holding for two
scripts the glob newly surfaced. The value of the test (catching the original `isDirectEntry`
guard-never-fires defect class for future symlinked scripts) is intact; its scope is just wider
than its assumptions.

## Requested action

Fix the TEST's contract model (not the two scripts), keeping the defect class it catches:

1. For scripts whose no-args path legitimately exits 0 with usage (fast-mode-telemetry): refine
   "non-silent" to accept **exit 0 + stdout containing a usage/`Usage:` marker** as a legitimate
   signature, OR classify per-script allowed exit codes. The decisive signal must stay "the guard
   fired and produced output", which it does.
2. For scripts whose output embeds a timestamp (milestone-worktree): make the byte-equality
   comparison **timestamp-agnostic** — e.g. normalize/redact `nowMs` (and any other
   `\d{13}`-shaped clock field) on both outputs before comparing, OR skip the byte-equality branch
   for scripts that emit clock fields while keeping the non-silent branch. Do NOT remove the
   symlink-vs-real comparison wholesale — the equality proof is the stronger half of this test.
3. Regression: the 5 known-affected scripts sanity check and the equality proofs for all OTHER
   discovered scripts must stay green.

**Non-goals:** Do not change fast-mode-telemetry's no-args exit-0 design (it is correct for a
report tool and B2-1's documented contract). Do not remove milestone-worktree's `nowMs` field (it
is load-bearing telemetry for the lock/land path). Do not weaken the original defect-class detection.

## Acceptance Criteria

- [ ] AC1: `[fast-mode-telemetry.ts] symlink-path invocation is non-silent` passes with a
  legitimate-usage signature accepted (exit 0 + usage marker on stdout), not by hardcoding the
  script name into the assertion.
- [ ] AC2: `[milestone-worktree.ts] symlink-path and real-path invocations produce identical
  stdout/stderr/exit code` passes with clock-field normalization (not by skipping the comparison).
- [ ] AC3: The 5 known-affected scripts sanity check and all OTHER discovered scripts' equality
  proofs stay green (no blanket weakening).
- [ ] AC4: The original guard-never-fires defect class remains detected (a symlinked script whose
  guard does not fire still fails loudly).

## Definition of Done

- [ ] Contract-model fix described in the task body (per-script allowed signatures + timestamp
  normalization approach).
- [ ] Test green for all discovered scripts; full-suite contribution recorded (this file was ~5s).
- [ ] No change to fast-mode-telemetry.ts or milestone-worktree.ts behavior.

## Touches

- experiments/quay-perpetual-stream/test/symlink-mirror-invocation.test.mjs

## Related

- B3-2 `gap-test-suite-has-no-layer-grouping` surfaced this test (was invisible before the glob
  extension).
- [[gap-symlink-mirror-invocation-isDirectEntry]] (the original defect this test guards).
