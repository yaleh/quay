---
id: gap-select-preflight-json-real-store-too-slow
title: "select-preflight.ts --json against the real store takes ~97-111s — the
  test's 120s spawnCli timeout has only ~8% headroom and is guaranteed-flaky
  under --test-concurrency=8, costing 240s of the 559s full-suite wall-clock"
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

The layer-grouping glob extension (B3-2, `gap-test-suite-has-no-layer-grouping`) made
`experiments/quay-perpetual-stream/test/select-preflight.test.mjs` run in the default engine
group for the first time. Two of its CLI tests fail at 120,335ms / 120,320ms — both are killed at
the `spawnCli` timeout ceiling. This is NOT an occasional flake: it is a deterministically-flaky
test design, and it is the single largest cost source in the engine group (this file alone ≈ 240s
= **43% of the 559s authoritative full-suite wall-clock**).

## Finding (measured 2026-08-02)

Root cause is **not** "the test is slow" — it is that the command itself is slow against the real
store, and the test's timeout has almost no headroom:

- `time node --experimental-strip-types select-preflight.ts --json --workspace-root .` (real
  store, 559 tasks) → **97.5s**, exit 0 (orchestrator measured; user independently measured 111s).
- `spawnCli` in the test file passes `timeout: 120000` to `execFileSync`
  (`experiments/quay-perpetual-stream/test/select-preflight.test.mjs` line 345). Headroom is
  ~8% (120/111 or 120/97.5). Under `--test-concurrency=8` (scripts/test.sh default), competing
  processes push it past 120s → killed. **Guaranteed-flaky by construction**, not coincidence.
- The command runs against the **real workspace** (`--workspace-root .`), not a fixture, so it
  gets slower as the task store grows (now 559 tasks; up from 475 when the sibling timeout task
  measured getTaskList at 66-78s).

Cost structure (what makes the command slow — to be profiled precisely in implementation):
- `getTaskList()` shells out to `quay task list --json` (external CLI; the prior task
  `gap-select-preflight-getTaskList-timeout-too-short` raised THAT call's 60s→120s, done).
- `scanOrthogonalPairs()` (DIR-113 item 3) does pairwise `checkTouchesPair` over the pre-charter
  shortlist — an O(n²) cross-product over a growing store, each pair expanding Touches globs.
  A real run logged 9 orthogonal pairs.

**Explicitly NOT the fix:** raising the test's `spawnCli` timeout (or `getTaskList`'s again).
That only postpones the flake and makes the suite slower — the opposite direction from AC9
(≤416s target). The real defect is that `select-preflight.ts --json` legitimately needs ~100s
against the real store.

## Requested action

1. **Profile first**: break down the ~97-111s into its components (getTaskList external CLI vs
   scanOrthogonalPairs pairwise enumeration vs JSON serialization), on the real store. Record the
   per-phase timings in the task body.
2. Then fix the real cost (candidate directions, choose by profiling evidence):
   - Make the pairwise orthogonality scan bounded/pruned (e.g. top-N shortlist only, early-exit,
     or a cheaper pre-filter) — if profiling shows it dominates.
   - Cache/short-circuit the `quay task list --json` call — if profiling shows the external CLI
     dominates.
   - Prefer a fixture/`--workspace-root <tmp>` for the CLI-shape tests where a fixture genuinely
     exercises the same code path, so the test's wall-time is store-size-independent (only if a
     fixture is behaviorally equivalent — do NOT fake it).
3. Align the test's timeout with the NEW measured cost (only after the command is actually made
   fast, as the guard against regression, not as the fix).
4. Record the before/after timing: this file ≈240s now; target is a material fraction of that.

**Non-goals:** Do not just raise `spawnCli`'s timeout and call it done. Do not weaken the CLI-shape
assertions (they validate the real preflight JSON contract — `halt`, `pendingDirectives`,
`candidates`, `milestoneCounter`, `portfolio`).

## Acceptance Criteria

- [ ] AC1: Per-phase profiling of `select-preflight.ts --json` on the real store (getTaskList /
  scanOrthogonalPairs / serialization), timings recorded in the task body.
- [ ] AC2: The dominant cost is addressed with the profiling evidence cited (not guessed).
- [ ] AC3: The two CLI-shape tests pass with real headroom under `--test-concurrency=8` (not at
  the timeout ceiling) — measured wall-time and chosen timeout recorded.
- [ ] AC4: The file's contribution to the full-suite wall-clock is materially reduced from ~240s
  (record before/after; the 559s authoritative full-suite number is the reference).
- [ ] AC5: Assertions unchanged — CLI-shape contract tests still validate the full preflight JSON.

## Definition of Done

- [ ] Profiling data + chosen fix rationale in the task body.
- [ ] Full suite contribution measured before/after (target: well under 240s for this file).
- [ ] No test assertion weakened; no blanket timeout bump as the fix.

## Touches

- experiments/quay-perpetual-stream/scripts/select-preflight.ts
- experiments/quay-perpetual-stream/test/select-preflight.test.mjs

## Related

- [[gap-select-preflight-getTaskList-timeout-too-short]] — fixed the INNER getTaskList timeout
  (60s→120s, done `28870e5`); this task is the OUTER command-cost problem that sibling left open.
- Directly serves B3-2's AC9 (ordered goal ≤416s): this file is the largest single cost in the
  559s transitional full-suite wall-clock.
