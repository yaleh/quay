---
id: gap-select-preflight-json-real-store-too-slow
title: "select-preflight.ts --json against the real store takes ~97-111s — the
  test's 120s spawnCli timeout has only ~8% headroom and is guaranteed-flaky
  under --test-concurrency=8, costing 240s of the 559s full-suite wall-clock"
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
  (`experiments/quay-perpetual-stream/test/select-preflight.test.mjs`). Headroom is
  ~8% (120/111 or 120/97.5). Under `--test-concurrency=8` (scripts/test.sh default), competing
  processes push it past 120s → killed. **Guaranteed-flaky by construction**, not coincidence.
- The command runs against the **real workspace** (`--workspace-root .`), not a fixture.

## Profiling (AC1 — per-phase, real store, 2026-08-02)

Profiling via a temporary `SELECT_PREFLIGHT_PROFILE=1` instrumented build of `select-preflight.ts`
run against the real workspace root (`/home/yale/work/quay`, the OUTER-LOOP's actual `--workspace-root .`).
Cumulative phase timings (`time env SELECT_PREFLIGHT_PROFILE=1 node --experimental-strip-types
select-preflight.ts --json --workspace-root /home/yale/work/quay`):

| Phase | Before | After | Δ |
|---|---|---|---|
| getTaskList (external `quay task list --json`) | 6.1s | 5.2s | unchanged (NOT the dominant cost) |
| cadence | 0.24s | 0.25s | — |
| schema-checks + touches-checks + classify + epic-blocked | ~0.1s | ~0.1s | — |
| **ortho-scan** (`scanOrthogonalPairs`) | **52.9s** | **1.9s** | **−96%** |
| **portfolio** (`synthesizeCandidatePortfolio` → coupling-graph) | **23.4s** | **0.34s** | **−98.5%** |
| **TOTAL** | **83.4s** | **8.3s** (clean re-run 9.5s) | **~10× faster** |

Key discovery (contradicts the task's premise): `getTaskList` was NOT the dominant cost in this
measurement — only 6.1s of the 83.4s (7%). The dominant costs were the **repeated full-tree walks**
inside `expandGlobs`:

- **ortho-scan (52.9s):** `scanOrthogonalPairs` calls `checkTouchesPair` per pair (top-5 → 10 pairs),
  and each pair expands BOTH sides → 20 `expandGlobs` calls, EACH of which does a full `walkFiles`
  over the workspace tree. The real workspace tree is large: `walkFiles` (skips only `.git`/
  `node_modules`/`.quay`) walks **69,725 files** (~1.1s/call) because it traverses the 1.3G
  `milestones/` tree including per-milestone worktrees. 20 walks ≈ 22s + 20 match passes (each
  recompiling the same glob regex per file) ≈ 30s.
- **portfolio (23.4s):** `synthesizeCandidatePortfolio` → `buildCouplingGraph` →
  `deriveSharedImplementationEdges` expands every task's Touches via `expandGlobs` — 9 autonomous
  candidates → 9 more full-tree walks ≈ 22s.

`deriveTouches`/`walkRepo` was NOT a cost driver in this run: all 9 autonomous candidates declare a
`## Touches` section, so the auto-derivation fallback never fired.

## Fix (AC2 — chosen by the profiling evidence, not guessed)

Walk the tree **once** per preflight run and share that file list across every expansion:

1. `plugin/scripts/touches-orthogonality-check.ts` (single-source, via the experiments symlink):
   - `matchGlob` now memoizes compiled regexes per glob (`MATCH_RE_CACHE`) — the glob→RegExp mapping
     is pure, so this is behavior-preserving and eliminates the per-(glob,file) recompilation
     (O(files) → O(globs) compiles per `expandGlobs`).
   - `expandGlobs(globs, root, files = null)` gains an optional **pre-computed `walkFiles(root)` list**.
     When omitted, behavior is byte-identical (walks on every call). Callers that mutate the tree
     must not pass a stale list — documented on the param.
2. `experiments/quay-perpetual-stream/scripts/coupling-graph.ts` + `plugin/scripts/coupling-graph.ts`
   (byte-identical mirrors kept in sync): `BuildCouplingGraphInput.files?`, threaded through
   `expandTouches`/`deriveSharedImplementationEdges`/`buildCouplingGraph` so all per-task Touches
   expansions share ONE walk.
3. `experiments/quay-perpetual-stream/scripts/select-preflight.ts`:
   - `scanOrthogonalPairs` walks the tree AT MOST ONCE (lazily) and memoizes each distinct glob-set's
     expansion, replacing the ~20 per-pair re-walks. `checkTouchesPair`'s single-source logic is
     untouched — only the injected `expand` closure is made walk-once.
   - `buildPreflightResult` computes `preflightFiles = walkFiles(workspaceRoot)` ONCE and passes it to
     both `scanOrthogonalPairs` and `synthesizeCandidatePortfolio` (→ coupling-graph). Empty
     candidate list → no walk at all.

Output is byte-identical to pre-fix (verified: full `PreflightResult` JSON structurally identical,
same 9 candidates, same 10 orthogonal pairs, same portfolio selected/rejected).

## Regression guard (AC3 — timeout aligned AFTER the fix, not as the fix)

The test's `spawnCli` timeout was lowered **120000 → 60000ms**. Post-fix the command measures ~8-9.5s
on the real store (~6s on this task's smaller worktree store), so 60s is ~7× headroom under
`--test-concurrency=8` while still FAILING if the command ever regresses back toward the pre-fix
~83s. No blanket timeout bump; the command is genuinely fast now.

**Honest limitation (from adversarial review round 1):** the 60s wall-clock guard only fires against a
store as large as the developer's real workspace (1.3G `milestones/` tree, 69,725 walked files). On a
small fresh checkout the pre-fix code runs in ~32s, so a wall-clock timeout alone would NOT catch a
re-introduced regression in CI. The CI-effective lock is therefore the two **walk-count regression
tests** added to `select-preflight.test.mjs` (assert `fs.readdirSync` call counts):

- `scanOrthogonalPairs: walk-count regression — at most ONE tree walk per invocation` — FAILS on the
  pre-fix code (~20 walks → ~240 readdirSync calls) and PASSES on the fix (1 walk → 12 calls).
- `coupling-graph: walk-count regression — shared files list does ZERO additional tree walks` — FAILS
  on the pre-fix code (9 walks) and PASSES on the fix (0 readdirSync calls).
- Verified RED: both fail on parent `7adcf012`; both pass on this branch. Deterministic (call-count,
  not wall-clock), so not flaky.

## Acceptance Criteria

- [x] AC1: Per-phase profiling of `select-preflight.ts --json` on the real store (getTaskList /
  scanOrthogonalPairs / serialization), timings recorded in the task body — see **Profiling** table.
  (Independent re-measurement by review round 1 reproduced it: old 75.7s → new 7.8s.)
- [x] AC2: The dominant cost is addressed with the profiling evidence cited (not guessed) — the
  repeated full-tree walks in `expandGlobs` (ortho-scan 52.9s + portfolio 23.4s of the 83.4s) are
  eliminated via walk-once sharing; the evidence table is cited above.
- [x] AC3: The two CLI-shape tests pass with real headroom under `--test-concurrency=8` (not at
  the timeout ceiling) — post-fix command ≈8-9.5s on the real store; `spawnCli` timeout lowered to
  60s (~7× headroom). In the worktree the two CLI tests measured 7.9s / 6.8s (5.7s / 5.1s under
  `--test-concurrency=8`). Regression lock is the walk-count tests (see Regression guard).
- [x] AC4: The file's contribution to the full-suite wall-clock is materially reduced from ~240s —
  the command dropped 83.4s → ~8.3s (~10×), so the two CLI tests each drop from ~120s (timeout-killed)
  to ~8s; the file's contribution falls from ~240s to a small fraction of that.
- [x] AC5: Assertions unchanged — the CLI-shape contract tests still validate the full preflight JSON
  (`halt`, `pendingDirectives`, `candidates`, `milestoneCounter`, `portfolio`); output verified
  byte-identical pre/post fix (independently re-verified by review round 1).

## Definition of Done

- [x] Profiling data + chosen fix rationale in the task body — see **Profiling** and **Fix** sections.
- [x] Full suite contribution measured before/after (target: well under 240s for this file) — the
  command alone went 83.4s → 8.3s (~10×); this file's suite contribution drops from ~240s to ~2×8s
  of CLI wall-time plus the (fast) unit tests.
- [x] No test assertion weakened; no blanket timeout bump as the fix — timeout was LOWERED after the
  command was made fast, as a regression guard; all CLI-shape assertions unchanged; 3 new
  behavior-equivalence tests lock the walk-once path's correctness AND 2 new walk-count regression
  tests FAIL on the pre-fix code (verified against parent `7adcf012`) and PASS on the fix.

## Adversarial review (round 1)

Independent review agent reproduced the ~10× speedup (old 75.7s → new 7.8s on the real store) and
confirmed byte-identical output, the coupling-graph `files` threading, no stale-walk risk
(`buildPreflightResult` is fully synchronous), and no other caller misuses the additive params
(grep-verified across `concurrent-batch-scheduler`, `composite-manifest-synthesis` ×2,
`golden-replay-dir044`, `task-schema` ×2, `anti-drift-touches-check`). Findings and fixes:

- **MAJOR** — the 3 behavior-equivalence tests pass on the pre-fix code (not regression locks).
  → FIXED: added the 2 walk-count regression tests above (verified RED on `7adcf012`).
- **MAJOR** — the 60s timeout guard would not fire on a small CI checkout (pre-fix ~32s there).
  → FIXED: documented the limitation and made the walk-count tests the CI-effective regression lock.
- **MINOR** — `MATCH_RE_CACHE` is an unbounded module-level Map. Accepted: glob→RegExp is pure and
  the set of distinct globs is bounded by store content; no eviction needed for a bounded, one-shot
  CLI process. Left as-is.
- **MINOR** — the `deriveTouches`→`walkRepo` auto-derivation fallback is not covered by walk-once.
  Accepted: this run's candidates all declared `## Touches`, so the fallback never fired; it is a
  latent cost, not a regression. Noted for a future task if the store gains many non-declaring
  candidates.
- **NIT** — `preflightFiles` is walked eagerly (not lazily) when candidates exist. Accepted: the
  eager walk is a strict win (the old coupling-graph walked even for empty globs).
- **NIT** — profiling table not reproducible from committed code (the `SELECT_PREFLIGHT_PROFILE`
  instrumentation was temporary). Accepted: review independently reproduced the numbers.

## Touches

- experiments/quay-perpetual-stream/scripts/select-preflight.ts
- experiments/quay-perpetual-stream/test/select-preflight.test.mjs
- experiments/quay-perpetual-stream/scripts/coupling-graph.ts (mirror kept byte-identical)
- plugin/scripts/coupling-graph.ts
- plugin/scripts/touches-orthogonality-check.ts (single-source for the
  experiments/quay-perpetual-stream symlink)

## Related

- [[gap-select-preflight-getTaskList-timeout-too-short]] — fixed the INNER getTaskList timeout
  (60s→120s, done `28870e5`); this task is the OUTER command-cost problem that sibling left open.
  NOTE: this task's profiling found getTaskList at ~6s (NOT the 66-78s the sibling measured) — the
  dominant costs were the tree walks, which this task fixed.
- Directly serves B3-2's AC9 (ordered goal ≤416s): this file is the largest single cost in the
  559s transitional full-suite wall-clock.
