---
id: ADR-001
title: TDD scope — product code red→green ≥80%/stage; load-bearing method-infra
  gates fixture-first + covered
status: accepted
date: 2026-07-19
tags:
  - testing
  - method-infra
---
## Context
TDD is a real hard gate in exp5, but its policy is scattered across ≥5 places — `docs/proposals/exp5-quay-task-proposal-plan-skill.md` §15, `OUTER-LOOP.md`, `inherited-core.md`, `docs/plans/*`, and the enforcement half in `it0-dod-check.mjs` Clause 7 — with a "product code only" nuance (`docs/plans/2` line 25). That nuance let a load-bearing method-infra validator (`scripts/task-schema.mjs`, now a gate other code imports and depends on) ship with acceptance fixtures but no unit tests, no coverage, and no red→green cycle — landed off-loop, so the Clause-7 test-floor never even ran. A load-bearing decision re-interpreted per cycle instead of pinned once is exactly the molten-prose disease; this ADR is its single source.

## Decision
1. **Product code** (`packages/**`, and any shell/JS shipped as product): strict TDD — **red→green per stage, ≥80% line coverage per stage, HARD gate** (as already stated in quay-task-to-plan §15 and enforced by Clause-7 test-floor at ABSORB).
2. **Load-bearing method-infra** (any executable under `experiments/**/scripts/` whose correctness something else relies on — imported by another script, wraps/backs a `quay gate`, or gates `milestone_counter++`; validators, meters, gates): MUST be **fixture-first (a RED fail-case per assertion before GREEN) AND unit-tested with ≥80% coverage.** The "load-bearing" trigger is independent of the `surface:` product labels — it extends the test-floor's reach.
3. **Throwaway / one-shot scripts and pure docs:** exempt (fixture-pin if cheap; not required).
4. **Red-then-green is the substance, not the ceremony:** a test/fixture that only ever saw GREEN is not TDD. The fix for a failing check belongs in the module, never in the fixture (DIR-019).

## Consequences
- **Forbids:** landing a load-bearing gate with only after-the-fact acceptance fixtures and no unit coverage; asserting a coverage/TDD claim without pasted `node --test --experimental-test-coverage` output.
- **Enables:** the Clause-7 test-floor trigger to extend beyond `surface:cli|web-ui|provider-abi|mcp` to the mechanical "load-bearing" criterion above.
- **Debt paid at adoption:** `scripts/task-schema.mjs` backfilled with 20 unit tests (`test/task-schema.test.mjs`) reaching **100% function + ~99% line coverage (far past the ≥80% floor)** via a genuine RED-then-GREEN cycle for the new `adr` kind — retroactively meeting this ADR. (Exact figure varies by hundredths per edit; run `node --test --experimental-test-coverage` for the current value — the invariant is ≥80%, not a pinned digit.)
- **Scope / refs:** supersedes the scattered statements in exp5-quay-task-proposal-plan-skill.md §15, OUTER-LOOP.md, inherited-core.md, it0-dod-check.mjs Clause 7 as the SINGLE decision of record; those remain the enforcement sites, this ADR the rationale.
- **Mechanization of Decision clause 2 (per ADR-DILUTION, a rule enforced nowhere is molten prose):** Decision clause 2 (load-bearing method-infra must be fixture-first + covered) is now MECHANICALLY ENFORCED by `experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.mjs` (wrapper `scripts/loadbearing-test-gate.sh`, selfcheck `scripts/loadbearing-test-gate-selfcheck.sh`; wrappable by a future `quay gate --gate loadbearing-test`). It flags any load-bearing `scripts/*.mjs` — load-bearing iff (a) imported by another module, (b) wrapped/registered by `packages/quay/src/gate/registry.js`, or (c) named by `OUTER-LOOP.md` as a `milestone_counter++` gate — that lacks a sibling `<name>.test.mjs`. Run on the real repo it confirms `task-schema.mjs` PASSes (the debt above, paid by the gate not by assertion). The one OPEN finding it originally surfaced — `it0-dod-check.mjs` (a counter-gate) had a fixture selfcheck but no `it0-dod-check.test.mjs` unit test — has since been PAID: `it0-dod-check.mjs` was restructured to export a pure `runDodCheck(...)` engine behind a thin CLI wrapper (behavior-preserving; golden-diff empty, `dod-fixture-selfcheck.sh` still 17/17) and now carries `test/it0-dod-check.test.mjs` (29 tests, 88.9% line coverage — the remaining uncovered lines are the CLI wrapper + the missing-sibling-script env-error branches that can't fire in-process). The B7 gate now reports `[PASS] it0-dod-check.mjs` and exits 0 with no remaining load-bearing script lacking a test. (Gate landed by `exp5-M-CRYST-B7-LOADBEARING-TEST-GATE`; the it0-dod-check test/restructure paid the finding afterward.)
