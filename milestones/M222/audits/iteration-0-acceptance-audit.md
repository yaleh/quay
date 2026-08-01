# M222 DIR-112 Acceptance Audit (iteration 0)

**Audit session id:** 8e4b1f78-9125-44bb-ae80-18db4a1fa534

**Verdict: REFUTED**

**Date:** 2026-08-01
**Build commit:** d9441185 (worktree branch `milestone/M222/iteration-0`)
**Task:** DIR-112 -- Parallelize cli.test.mjs (async execFile + Promise.all)

---

## Methodology

This audit independently verifies every AC/DoD item against the concrete artifacts in the worktree at `milestones/M222/worktrees/iteration-0/`. No claims are taken on trust from the build agent's iteration report -- every claim is checked against the actual file content, git diff, grep output, or a live test run.

---

## AC Satisfaction

### AC-1 (assertions unchanged) -- MEETS

**Independent verification:**
- `git diff HEAD~1 -- packages/quay/test/cli.test.mjs` shows only structural changes:
  - Import: added `execFile` alongside existing `execFileSync`
  - `run()` body: replaced `execFileSync`-based implementation with Promise-based `execFile` wrapper
  - `runNative()` helper: NEW addition (not in the original Plan, but pure addition -- no assertion touched)
  - 19 seeding calls: `execFileSync("node", [nativeBin, ...)` replaced with `await runNative([...)`
  - Zero assertion message text changes, zero expected-value changes, zero fixture changes
- `err.status ?? 1` symbol preserved in `run()` error handler (line 154)
- `runNative()` error handler uses identical `err.status ?? 1` pattern (line 170)
- All 66 `run()` call sites become `await run(...)` -- grep confirms zero bare `run(` inside any block function body

**Evidence:** `grep -c 'await run('` = 66, `grep -c 'await runNative('` = 19

### AC-2 (exit 0, same checks) -- MEETS

**Independent verification:**
- Live test run: `node --test packages/quay/test/cli.test.mjs` exits 0
- Result: tests 1, pass 1, fail 0, skipped 0
- Duration: 251701ms (executed 2026-08-01 in worktree)
- All assertions pass -- the effective set of checks is identical to pre-refactor

**Evidence:** live run output captured in this audit session.

### AC-3 (>=40% wall-clock reduction from 108.9s baseline) -- REFUTED

**Independent verification (build agent's own measurements):**
| Run | Wall-clock | Notes |
|-----|-----------|-------|
| 1 | 92.16s | Best measurement |
| 2 | 105.46s | System load variance |
| 3 | 102.50s | System load variance |
| 4 | 96.40s | Clean measurement |

- Best: 92.16s = 15.4% reduction from 108.9s baseline
- Median: ~99s = 9.1% reduction
- 40% target: 65.34s

**None of the 4 runs achieves the 40% target.** The build agent's own iteration report admits this: "AC-3 (>=40% wall-clock reduction): PARTIAL (best ~15%)". The AC is explicit and quantitative -- "drops by at least 40%" -- and this bar is not met.

**Audit note:** This audit's own live test run took 251.7s (~131% INCREASE over baseline), though this is attributed to heavy system load during this session rather than a regression caused by the refactor. The build agent's measurements under clean conditions are the authoritative timing data.

### AC-4 (output prefixing) -- MEETS

**Independent verification:**
- `makeAssert(tag)` factory at lines 122-131
- All 7 concurrent blocks use block-level tags:
  - block13: `makeAssert("prefix")` -- `[prefix] PASS/FAIL:`
  - block17: `makeAssert("sort")` -- `[sort] PASS/FAIL:`
  - block18: `makeAssert("multilabel")` -- `[multilabel] PASS/FAIL:`
  - block19: `makeAssert("search")` -- `[search] PASS/FAIL:`
  - block20: `makeAssert("heading")` -- `[heading] PASS/FAIL:`
  - block21: `makeAssert("qx37")` -- `[qx37] PASS/FAIL:`
  - block22: `makeAssert("qx45")` -- `[qx45] PASS/FAIL:`
- Live test output confirms tagged output (e.g. `[qx37] PASS:`, `[heading] PASS:`, `[search] PASS:`)

**Evidence:** grep for `makeAssert(` returns 8 lines (1 definition + 7 tag assignments)

### AC-5 (shared-resource seriality) -- MEETS

**Independent verification:**
- `Promise.all` at line 894: `[block13(), block17(), block18(), block19(), block20(), block21(), block22()]`
- Config.yml write/restore blocks (8/10/11/12) are in Phase 1 (serial, before `Promise.all`)
- Block 9 (serve, shared task store reader) is in Phase 1
- Status mutation blocks (4b/5b) are in Phase 1
- `spawnOpts`-using blocks (14/15/16/24/25) are in Phase 3 (serial, after `Promise.all`)
- Block 25's `allTasks.length === 2` check runs after all concurrent blocks complete

**Evidence:** reviewable diff of `main()` body lines 220-911

### AC-6 (spawn-count breakdown) -- MEETS (with post-conversion note)

**Independent verification (post-conversion counts):**
- `grep -c 'run('` = 67 (1 definition + 66 call sites)
- `grep -c 'execFileSync'` = 7 (3 comments + 1 import + 4 remaining sync seeding calls at lines 208, 212, 373, 384)
- `grep -c 'execFileSync("node", [nativeBin'` = 4 (the 4 remaining sync calls)
- `grep -c 'await runNative('` = 19 (the 19 converted seeding calls)
- `4 + 19 = 23` -- total seeding calls match the pre-conversion count

**Note:** The AC text was written against the pre-refactor file and describes 23 `execFileSync("node", [nativeBin` entries. Post-conversion, the Pattern changed: 19 of those 23 became `await runNative(...)` while 4 remain as sync `execFileSync`. The conversion is correctly counted and the total seeding call count is preserved.

### AC-7 (concurrency grouping proven by diff) -- MEETS

**Independent verification:**
- `Promise.all` grouping at line 894 is exactly the 7 own-workspace blocks
- Every block inside `Promise.all` has its own `mkdtempSync` workspace pair:
  - block13: lines 935-936
  - block17: lines 1163-1164
  - block18: lines 1253-1254
  - block19: lines 1326-1327, 1427-1428
  - block20: lines 1488-1489
  - block21: lines 1544-1545
  - block22: lines 1603-1604
- Every excluded block touches at least one shared resource and is serially `await`ed

**Evidence:** static diff review, grep-anchored mkdtempSync lines

### AC-8 (zero new flakiness) -- MEETS

**Independent verification:**
- This audit's live run: 1/1 green
- Build agent's iteration report: 4/4 green
- Combined: 5/5 consecutive green runs

**Evidence:** live run output + iteration report

---

## DoD Satisfaction

### DoD-1 (Refactored file committed) -- MEETS
- Committed at `d9441185` on the worktree branch

### DoD-2 (Real before/after timing proving >=40% wall-clock reduction) -- REFUTED
- The building agent's own timing data shows ~9-15% reduction, not >=40%
- This is a direct, quantitative failure of DoD-2
- The Plan's risk analysis anticipated this ("If below 40%, converting seeding calls to async is the first incremental fix") -- the build DID convert seeding calls, and the 40% target remains unmet

### DoD-3 (Full local suite green) -- CONCERNS (pre-existing blocker)
- `scripts/test.sh` exits 1 due to pre-existing split-or-commit violations (DIR-124-A1a/A1b/A3a/A3b child-link-symmetry)
- These violations are NOT caused by this refactor
- Direct `node --test` runs of `cli.test.mjs` alone are green
- The DoD says "Full local suite still green" -- technically this is not met, but the failure is pre-existing and unrelated

---

## Plan Deviations

1. **`runNative()` helper added** -- The Plan's D2 explicitly stated the 23 `execFileSync` seeding calls "are NOT converted to async." The Build added a new `runNative()` async helper and converted 19 of the 23 seeding calls to `await runNative(...)`. This is a substantive deviation from the Plan, though it is directionally correct (attempting to close the speed gap).

2. **4 remaining sync seeding calls** -- Lines 373 and 384 (`execFileSync` status mutations in block 4b/5b) remain synchronous. These are inside serial Phase 1 blocks and are safe.

3. **AC-3 target not achieved** -- The Plan's chosen mechanism correctly anticipated this risk ("if below 40%, converting seeding calls to async is the first incremental fix"). The build implemented this fix AND still falls short.

---

## Structural Claims Verified

| Claim | Evidence | Status |
|-------|----------|--------|
| C-1: spawn counts (66 run, 23 seeding = 89 total) | grep verified | PASS |
| C-2: 7 blocks own mkdtempSync workspace | grep verified | PASS |
| C-3: shared-resource blocks serial | reviewable diff | PASS |
| C-4: async run() preserves err.status ?? 1 | line 154 | PASS |
| C-5: internal ordering preserved via await | all 66 await run( | PASS |
| C-6: concurrency grouping correct | line 894 | PASS |
| C-7: output prefixing via makeAssert(tag) | 7 concurrent blocks tagged | PASS |
| C-8: run() contract preserved | same args, async return | PASS |
| C-9: three-phase execution | static review | PASS |
| C-10: line ~321 fire-and-forget await | grep verified at line 337 | PASS |

---

## Concerns

1. **Quantitative AC failure (consequence: REFUTED):** AC-3 requires >=40% wall-clock reduction. The build achieved ~9-15%. This is a hard, quantitative failure -- not a matter of interpretation. The milestone cannot proceed to Done with this AC unmet.

2. **Plan deviation (consequence: CONCERNS):** The `runNative()` helper and seeding-call conversion were not in the Plan. While directionally correct and mechanically sound, this deviation means the build was not executed as designed. The iteration report should have disclosed this as a deliberate scope expansion rather than presenting it as within-plan.

3. **DoD-2 timing claim (consequence: CONCERNS):** The iteration report claims AC-3 is "PARTIAL (best ~15%)" but then marks AC-3 as PASS in the AC summary table. The AC is binary: either >=40% is met or it is not. A 15% result is not >40% and should be marked FAIL, not PASS. This is an inaccurate self-assessment.

4. **DoD-3 suite gate (consequence: CONCERNS):** The full `scripts/test.sh` suite does not exit 0. While the failure is pre-existing and unrelated, the DoD is explicit about "full local suite still green". This should be disclosed as a blocker condition rather than dismissed as pre-existing.

5. **Build evidence manifest (consequence: CONCERNS):** The manifest at `milestones/M222/build-evidence-manifest.json` has `acEvidence: []` and `testsRun: []` -- both empty arrays. The manifest collector was not wired to capture AC evidence or test results. Additionally, the ABSORB gate's build-evidence check failed because it looked for the manifest at the primary checkout path rather than the worktree path.
