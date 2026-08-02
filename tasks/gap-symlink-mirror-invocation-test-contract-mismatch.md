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

### Implemented fix (2026-08-02, branch `task/gap-symlink-mirror-invocation-test-contract-mismatch`)

Fixed the TEST's contract model, not the scripts:

1. **Non-silent contract (AC1/AC4):** replaced the uniform "nonzero exit + some output"
   assertion with `assertLegitimateNoArgsSignature()`, a general signature contract:
   - Output is mandatory for ANY exit code — exit 0 + zero output is the silent-no-op defect
     class and fails loudly.
   - An exit-0 no-args path is only accepted when stdout contains a deliberate `Usage:` block
     (the report-tool contract; fast-mode-telemetry's B2-1 usage listing). This is a GENERAL
     rule — "a script whose no-args output contains `Usage:` is legitimately non-silent even at
     exit 0" — not a per-script hardcode of the script name.
   - Nonzero-exit signatures (exit 1 real-check scripts, exit 2 usage-on-stderr scripts) pass as
     before.
2. **Equality contract (AC2):** the symlink-vs-real byte-equality comparison redacts `\d{13}`
   clock fields (e.g. milestone-worktree's `nowMs`) on BOTH stdout and stderr before comparing.
   Any NON-clock difference still fails — the comparison is not skipped and not blanket-weakened.
3. **Regression guard (AC3):** discovery + the 5 known-affected scripts sanity check unchanged;
   equality proofs for all 11 discovered scripts stay green. Added unit tests proving (a) clock
   redaction preserves non-clock differences and (b) the silent-no-op defect class still fails
   loudly.

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

- [x] AC1: `[fast-mode-telemetry.ts] symlink-path invocation is non-silent` passes with a
  legitimate-usage signature accepted (exit 0 + usage marker on stdout), not by hardcoding the
  script name into the assertion. — implemented via the general `Usage:`-on-stdout rule in
  `assertLegitimateNoArgsSignature()`; green.
- [x] AC2: `[milestone-worktree.ts] symlink-path and real-path invocations produce identical
  stdout/stderr/exit code` passes with clock-field normalization (not by skipping the comparison).
  — `redactClockFields()` (`\d{13}` → `<CLOCK>`) applied to both stdout and stderr before the
  equality assertion; green, and the equality proof is kept for every script.
- [x] AC3: The 5 known-affected scripts sanity check and all OTHER discovered scripts' equality
  proofs stay green (no blanket weakening). — 25/25 tests pass; 11 discovered scripts each get
  both the non-silent and the equality assertion.
- [x] AC4: The original guard-never-fires defect class remains detected (a symlinked script whose
  guard does not fire still fails loudly). — unit test on `assertLegitimateNoArgsSignature()` +
  live mutation test (synthetic silent-no-op symlink) both confirmed loud failure with the exact
  "guard did not fire (silent no-op, the original defect)" message.

## Definition of Done

- [x] Contract-model fix described in the task body (per-script allowed signatures + timestamp
  normalization approach). — see "Implemented fix" above.
- [x] Test green for all discovered scripts; full-suite contribution recorded (this file was ~5s).
  — scoped run: tests 25, pass 25, fail 0 (~12s). Full-suite delta unchanged in character (this
  file adds ~12s when it runs).
- [x] No change to fast-mode-telemetry.ts or milestone-worktree.ts behavior. — only the test file
  is modified.

## Evidence (2026-08-02)

- RED on master: 2 failures exactly as diagnosed — `[fast-mode-telemetry.ts] ... exited 0 with
  no args — guard did not fire` and `[milestone-worktree.ts] stdout differs` (`nowMs`
  1785673919246 vs 1785673919549).
- GREEN after fix: `node --experimental-strip-types --test
  experiments/quay-perpetual-stream/test/symlink-mirror-invocation.test.mjs` → tests 25, pass
  25, fail 0.
- AC4 mutation: temporarily added `plugin/scripts/synthetic-silent-guard.ts` (guard expression
  `isDirectEntry = () => false` → silent no-op) + symlink under
  `experiments/quay-perpetual-stream/scripts/` → test FAILED loudly ("...produced no output at
  all — guard did not fire (silent no-op, the original defect)"); synthetic files removed after.
- Adversarial review: 2 rounds (REFUTE-focused). Round 1: AC1 PASS (signature-general, not
  name-hardcoded), AC2 PASS (redaction keeps equality proof), AC3 PASS, AC4 PASS for the
  silent-no-op class but with a documented residual boundary — an exit-0 script printing `Usage:`
  from top-level code OUTSIDE the guard with byte-identical output via both paths would pass
  (task-sanctioned trade-off for admitting fast-mode-telemetry; the historical silent-no-op is
  still caught loudly). Round 1 also flagged: the `\d{13}` redaction hides ANY 13-digit difference
  (not only clocks) — no current-script impact (only `nowMs` matches); and a pre-existing discovery
  scope note (`gate-dispatch-coverage.ts` uses an inline guard, invisible to `GUARD_PATTERN`).
  Both documentation issues fixed (comments now state the honest boundaries). Round 2 re-challenge:
  verdict in the task branch commit.

## Touches

- experiments/quay-perpetual-stream/test/symlink-mirror-invocation.test.mjs

## Related

- B3-2 `gap-test-suite-has-no-layer-grouping` surfaced this test (was invisible before the glob
  extension).
- [[gap-symlink-mirror-invocation-isDirectEntry]] (the original defect this test guards).
