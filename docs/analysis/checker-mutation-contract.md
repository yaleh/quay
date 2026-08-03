# checker-mutation-contract.md — mutation-testing the checkers themselves (the `L_S` instrument)

**Task**: `gap-checkers-have-never-been-shown-to-fail` (spec AC1 priority, 2026-08-03).
**立案**: two real failures that day, neither theoretical — a negative control whose probe
could not fail (#6), and an acceptance that only tested one direction (#10).
**This doc is the analysis/contract behind `plugin/scripts/checker-mutation-check.sh` and its
cases. Everything here must be scripted or a field; §0 of the task forbids doc-lines as the
deliverable — the script is the deliverable, this doc is the map.**

---

## 1. What L_S is

`L_S` = the axis "behavioral variance under perturbation" (ADR-006/007). Its instrument is:
**for every registered checker, deliberately break what it claims to check and assert the
checker goes RED; restore; assert GREEN.** A checker that never goes red under a defect it
claims to catch is indistinguishable from a checker that always returns "pass" — which is
exactly the #6 failure (the rename negative control whose zero-dependency probe could not
fail, reported "passed" twice) and the #10 failure (/live's acceptance only tested the
data-missing direction, so "activity exists but telemetry empty" was never covered).

The object being mutated is the **guard**, not the product code. Product-code mutation testing
is a different, far more expensive instrument with zero instances pointing at it that day.

## 2. The manifest is parsed, never hand-written (AC1b)

`checker-mutation-check.sh --list` builds the checker manifest from two live sources:

| source | parser | example |
|---|---|---|
| `scripts/test.sh` `run_static_checks()` | awk over the function body, then grep `${repo_root}/plugin/scripts/<name>.(sh|ts)` | `it0-split-or-commit-check`, `test-framework-policy-check`, `test-isolation-check`, `task-contract-check`, `task-ac-carryover-check`, `checker-mutation-check` |
| `.github/workflows/*.yml` | grep `node --experimental-strip-types scripts/<name>.ts` gate steps | `test-coverage-check`, `version-consistency-check`, `delivery-manifest-check` |

A checker added to either surface **appears in the manifest automatically**. The `--check`
gate then fails if that checker has no mutation case in `plugin/scripts/checker-mutation-cases/`
— "a new checker with no mutation case" can never silently slip through (the AC1 negative
control in the test proves a fake checker injected into `run_static_checks` shows up).

## 3. Case-script contract

Each mutation case is a standalone executable `plugin/scripts/checker-mutation-cases/<name>.sh`
that receives a fresh `mktemp -d` workdir and exits:

| exit | meaning |
|---|---|
| 0 | mutation behaved: baseline GREEN → inject → RED → restore → GREEN all proven |
| 3 | **STAYED-GREEN** — defect present, checker still exited 0 (counts toward `mutations_that_stayed_green`) |
| 4 | **ALWAYS-RED** — object restored, checker still exits non-zero (the "永远红" shape) |
| 2 | infrastructure error |

The runner (`--run` / `--check`) runs every registered checker's case plus the two AC5
regression cases, reports per-case result lines, and prints the aggregate:
`checkers_total`, `checkers_with_mutation`, `mutations_that_stayed_green`, `mutations_that_always_red`,
`uncovered`, `duration_ms`.

`--run --json` emits a machine-readable report; `--check` is the fail-closed gate wired into
`run_static_checks` (exit 1 on any stayed-green / always-red / uncovered / empty manifest).

## 4. The cases

Nine registered checkers + two AC5 regressions. Each case is one of two shapes:

- **`--selftest` shape** (ADR-018 selfcheck-fixture): the checker's own `--selftest` already
  builds violating and compliant fixtures and asserts RED+GREEN — it IS the mutation case.
  Used for: `it0-split-or-commit-check`, `test-framework-policy-check`, `test-isolation-check`,
  `test-coverage-check`.
- **temp-fixture shape**: the case builds a broken object in the workdir, runs the real checker
  against it expecting RED, restores, expects GREEN. Used for:
  - `task-contract-check` — a task whose `## Contract` declares a measure with no backtick
    command → a NEW violation → ratchet growth → exit 1.
  - `task-ac-carryover-check` — a done task with an unchecked AC and no carrier → exit 1.
  - `version-consistency-check` — one of the 8 version artifacts bumped → drift → exit 1.
  - `delivery-manifest-check` — manifest `$schema` corrupted → exit 1.
  - `checker-mutation-check` — the mechanism mutates ITSELF (AC4): break parser / case loop /
    RED inversion → the gate must fail. This is both the meta-mutation and the mechanism's own
    coverage case (it is a registered checker, so it must have one).

## 5. The AC5 regressions (the day's two real failures)

- **`regression-rename-negative-control-probe` (#6)**: the rename negative control. The case
  builds a minimal quay dev tree and a **quay-dependent** probe (greps a path quay's structure
  guarantees). Renaming the tree away MUST make the probe RED; renaming back MUST make it GREEN.
  The zero-dependency-probe shape (e.g. `resource-gate.sh`, which exits 0 regardless) is the
  #6 bug; `checker-mutation-check.test.mjs` proves the framework FLAGS such a probe as
  `stayed-green` — the mechanism catches the exact shape it exists to prevent.
- **`regression-live-telemetry-empty-activity` (#10)**: `/live`'s previously-missing direction.
  A contract checker imports `decideLiveState` and asserts activity-present + telemetry-empty
  ⇒ `running-unwired`. Injecting a MUTATED discriminator that ignores activity MUST make the
  checker RED; pointing back at the real discriminator GREEN.

## 6. Wiring, cost, incremental policy (AC6)

`checker-mutation-check.sh --check` is wired into `run_static_checks` (same site as the other
whole-store checkers), so every `scripts/test.sh` invocation — and CI, whose only test step is
`bash scripts/test.sh` — inherits it for free.

Measured cost (2026-08-03, this worktree): a full `--check` is **~11.7 s** (9 checker cases +
2 regressions). Of that, `test-coverage-check --selftest` is the dominant term (~5.7 s), then
`test-isolation-check --selftest` (~0.7 s), the rest sub-second. On the full suite this is
~2% of wall time; on a scoped run it is a fixed one-time gate cost, same class as the existing
whole-store static checks.

The incremental path is available but not the default: the **coverage check** (every registered
checker has a case) is the cheap ~0.3 s part and is what stops "new checker, no mutation case".
The **full mutation run** (stayed-green enforcement) is the ~12 s part. If the full run is ever
judged too expensive for per-invocation cost, the incremental criterion is exactly AC1b: the
coverage check still fails on a new checker without a case, and the full mutation verification
runs at milestone cadence / in CI. The default is the strictest form (full `--check` on every
invocation).

## 7. Adding a checker / a mutation case

1. Add the checker invocation to `run_static_checks` or a CI workflow.
2. `bash plugin/scripts/checker-mutation-check.sh --list` — the new checker appears, reported
   `uncovered` (covered: NO).
3. Write `plugin/scripts/checker-mutation-cases/<name>.sh` per the contract in §3.
4. `bash plugin/scripts/checker-mutation-check.sh --check` — must PASS (coverage + all cases
   RED/GREEN). If a checker genuinely cannot be made to fail under any injected defect, that is
   the finding AC3 exists to surface — a checker that cannot go red is indistinguishable from
   always-pass.
