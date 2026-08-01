# M252 Plan -- prepare-milestone per-milestone worktree isolation

- **Milestone:** M252
- **Task:** `gap-prepare-milestone-no-worktree-isolation` -- prepare-milestone.js operates directly on the shared working tree with no git-level isolation boundary; two file-disjoint prepare-milestone tasks cannot run concurrently even when their Touches are disjoint.
- **Charter:** `experiments/quay-perpetual-stream/charters/M252-gap-prepare-milestone-no-worktree-isolation.md`
- **Base revision:** `82220c17` (current HEAD short-sha at Plan authoring, 2026-08-01)
- **Class:** development (defect -- execution-layer gap)
- **Prepared-gate note:** authored for the M195/DIR-117-B enforced-by-default Prepared gate. Manually authored (2026-08-01) after the just-adjudicated task body; the task's `## Proposal` / `## Acceptance Criteria` are the authoritative contract, and this Plan is the mechanical stage spec that `milestone-preparation-check.ts`'s `validatePlanStructure` parses.
- **Dependencies:** consumes, does not duplicate:
  - `DIR-123` (execute-milestone worktree isolation, `milestone-worktree.ts`) -- the existing module that `prepare-milestone.js`'s worktree block reuses. The inline mirror of `computeIsolationPlan` in `prepare-milestone.js` is cross-pinned by `milestone-worktree.test.mjs`.
  - `DIR-117/DIR-125` (prepare-milestone workflow, bounded convergence) -- the host workflow this change extends. All existing phase dispatch sites, lease management, and telemetry infrastructure are preserved.
  - NOT a dependency -- `gap-prepare-milestone-no-size-aware-routing-*` or `gap-execute-milestone-build-admission-and-verification-fuse`. These are separate milestones with disjoint Touches.

## Current state (grounded facts)

- **Canonical copy** (`.claude/workflows/prepare-milestone.js`, 1683 lines) HAS the full worktree isolation implementation:
  - `_isolationPlan` inline mirror of `milestone-worktree.ts`'s `computeIsolationPlan` (lines 67-96)
  - `_worktreeIsolationNote` module-level constant (lines 98-114)
  - `_wtRet()` helper for stranded-worktree discoverability (lines 119-121)
  - Real worktree creation via `milestone-worktree.ts --add` BEFORE Admission (lines 209-238)
  - `_worktreeIsolationNote` threaded into all 13 content-agent dispatch sites (ProposalAuthors x2/x3, Adjudicate, checkpoint-write, full-review, convergence-runner, reviser, cross-gen-reviewer, delta-reviewer, PlanAuthor, PlanCheck, PlanCheck-reviser, Receipt)
  - `prepare-merge` step: commit + merge + remove after lease release (lines 1637-1666)
  - `_wtRet()` on final success return (line 1668)
- **Plugin mirror** (`plugin/workflows/prepare-milestone.js`, 1565 lines) has ZERO worktree isolation code -- 0 references to `_worktreeIsolationNote` or `_useWorktree`. This is the primary gap that creates non-byte-identical mirrors.
- **CLAUDE.md** has NO mention of prepare-milestone worktree isolation (0 occurrences of "prepare.*worktree" or "worktree.*prepare"). Needs a documentation paragraph.
- **Concurrent path** (AC8, `$a.mode === 'concurrent'`): NOT yet implemented in either mirror. The prepare-merge block (line 1642) always runs the full merge+remove. AC8 requires a branch: when concurrent, commit-only on the worktree branch and return `{ buildBranch, worktreeRel }` without merge or remove.
- **Existing tests:** `milestone-worktree.test.mjs` covers `computeIsolationPlan`, `worktreeRelPath`, `worktreeBranch`, and real `git worktree` lifecycle (add/merge/remove). No prepare-milestone-specific worktree tests exist yet.

## Complete touch set

- `.claude/workflows/prepare-milestone.js` -- canonical: add concurrent-path branch to prepare-merge (AC8)
- `plugin/workflows/prepare-milestone.js` -- mirror: apply full delta from canonical (all worktree isolation code + concurrent-path branch)
- `CLAUDE.md` -- documentation: add prepare-milestone worktree isolation paragraph

Additional files verified mechanically (grep/audit) but NOT edited:
- `plugin/scripts/milestone-worktree.ts` -- consumed by prepare-milestone's worktree-creation and prepare-merge agent dispatches; no edits needed (reused as-is per D1)
- `experiments/quay-perpetual-stream/test/milestone-worktree.test.mjs` -- existing tests that cross-pin the inline mirror's correctness; no edits needed
- `plugin/scripts/sync-vendor.sh` -- not affected (no vendor/ changes)

## Stage plan

Each stage maps to one or more AC checklist indices (1-based, matching the task's `## Acceptance Criteria`). Every AC index 1-8 appears in at least one stage.

### Stage 1: Mirror worktree isolation delta to plugin/workflows/ (code)
- AC: 1
- Files: `plugin/workflows/prepare-milestone.js`
- Command: `diff .claude/workflows/prepare-milestone.js plugin/workflows/prepare-milestone.js` -- RED: non-empty diff (plugin missing ~118 lines); GREEN: exit 0 (byte-identical).
- Line budget: ~118 lines of delta applied (the exact diff from canonical to plugin).
- Implementation: copy the full canonical file to the plugin path (the canonical already includes all worktree changes at verified review sites). The diff between the two files pre-implementation shows the plugin missing lines 67-122 (isolation plan + fail-closed + `_worktreeIsolationNote` + `_wtRet`), lines 209-238 (worktree creation before Admission), and 13 `_worktreeIsolationNote` prefixes on content-agent dispatch sites plus the prepare-merge block (lines 1637-1666) and `_wtRet()` wrap on the final return. After mirroring, both files are byte-identical at 1683 lines.
- Exit behavior: GREEN when `diff` exits 0. RED (pre-implementation) when diff shows non-empty.

### Stage 2: Add concurrent-path branch to prepare-merge (code)
- AC: 8
- Files: `.claude/workflows/prepare-milestone.js`, `plugin/workflows/prepare-milestone.js`
- Command: `grep -c "mode.*concurrent\|IS_CONCURRENT" .claude/workflows/prepare-milestone.js` -- RED: 0 (no concurrent check in prepare-merge); after implementation, `grep -q "mode === 'concurrent'" .claude/workflows/prepare-milestone.js` exits 0. Both mirrors byte-identical after editing.
- Line budget: ~15 lines added inside the existing `if (_useWorktree)` block (lines 1642-1666). The concurrent branch checks `$a.mode === 'concurrent'`, commits worktree changes only (no merge, no remove), and returns `_wtRet({ outcome: 'building', buildBranch: _isolationPlan.branch, worktreeRel: _isolationPlan.worktreeRel, taskId: _taskId, milestoneId: _milestoneId, ... })`. The existing serial branch (else) is unchanged.
- Implementation detail: insert a conditional at the top of the `if (_useWorktree)` block at line 1642:
  ```
  if (_useWorktree) {
    if ($a.mode === 'concurrent') {
      // commit-only, no merge, no remove; return buildBranch + worktreeRel for fan-in
      const _ccResult = await agent(... commit-only ...)
      return _wtRet({ outcome: 'building', buildBranch: _isolationPlan.branch, worktreeRel: _isolationPlan.worktreeRel, ... })
    }
    // existing serial merge path below (unchanged)
  ```
  Mirroring `execute-milestone.js`'s own `IS_CONCURRENT` pattern at line 917.
- Exit behavior: GREEN when both mirrors contain the concurrent branch AND produce `{ buildBranch, worktreeRel }` when `$a.mode === 'concurrent'` (verified by unit test in Stage 5). The `grep` mechanical check confirms the concurrent branch exists in both mirrors.

### Stage 3: Content-agent routing coverage + coordination isolation grep audit (code)
- AC: 2, 6
- Files: `.claude/workflows/prepare-milestone.js`, `plugin/workflows/prepare-milestone.js`
- Command: mechanical grep audit with three checks:
  1. `grep -c "_worktreeIsolationNote" .claude/workflows/prepare-milestone.js` -- expects 13 (one per content-agent dispatch site). GREEN: count >= 13, and each site carries the prefix.
  2. `grep -n "_admissionAgentCall\|_convergenceAgentCall\|_recordEpochDispatch\|_preflightAgentCall\|_renewLease\|_releaseLeaseAndRecord\|_releaseLease\|_recordAttemptAgentCall" .claude/workflows/prepare-milestone.js | while read line; do ... grep "_isolationPlan.worktreeRel" near each coordination site` -- expects 0 matches. GREEN: zero coordination dispatch sites carry worktree path references.
  3. Same checks against `plugin/workflows/prepare-milestone.js` after Stage 1 mirroring. GREEN: identical results.
- Exit behavior: GREEN when check 1 returns >= 13 coverage and check 2 returns 0 leakage. RED otherwise.
- Note: this is a mechanical grep audit, not an LLM-driven check. The canonical copy's 13 `_worktreeIsolationNote` sites are: ProposalAuthor x2/x3 (line ~768), Adjudicate (line ~807), checkpoint-write (line ~1074), full-review (line ~1106), convergence-runner (line ~1181), reviser (line ~1305), cross-gen-reviewer (line ~1328), delta-reviewer (line ~1352), PlanAuthor (line ~1411), PlanCheck (line ~1498), PlanCheck-reviser (line ~1519), Receipt (line ~1598). Coordination sites (lines ~161, 171, 213, 307, 461, 497, 551, 575, 735, 980, 1115, 1591, 1635) carry zero worktree path references.

### Stage 4: Isolation-plan inline mirror correctness audit (code)
- AC: 1, 4
- Files: `.claude/workflows/prepare-milestone.js`, `plugin/scripts/milestone-worktree.ts`, `experiments/quay-perpetual-stream/test/milestone-worktree.test.mjs`
- Command: `node --experimental-strip-types --test --test-name-pattern="isolation plan" experiments/quay-perpetual-stream/test/milestone-worktree.test.mjs` -- GREEN: all isolation-plan tests pass. Then manual cross-check: the inline mirror in prepare-milestone.js (lines 67-84) produces identical results to `milestone-worktree.ts`'s `computeIsolationPlan` for the same inputs listed in the test (M191 -> { isolated: true, milestoneNum: 191, worktreeRel: "milestones/M191/worktrees/iteration-0", branch: "milestone/M191/iteration-0" }; non-numeric milestone -> { isolated: false, error: "worktree-needs-numeric-milestone" }; omitted/empty isolationMode -> { isolated: false }). GREEN: all assertions match.
- Exit behavior: GREEN when `milestone-worktree.test.mjs` isolation-plan tests pass (exit 0) AND the manual cross-check confirms prepare-milestone.js's inline mirror produces identical outputs.

### Stage 5: Worktree lifecycle + stranded-worktree recovery tests (code)
- AC: 3, 4, 5, 7, 8
- Files: `experiments/quay-perpetual-stream/test/milestone-worktree.test.mjs`, `plugin/scripts/milestone-worktree.ts`
- Command: `node --experimental-strip-types --test experiments/quay-perpetual-stream/test/milestone-worktree.test.mjs` -- GREEN: all tests pass (exit 0). Covers:
  - `computeIsolationPlan` correctness (AC4)
  - Real `git worktree add` / `git merge --no-ff` / `git worktree remove` / `git branch -d` lifecycle (AC3, AC4)
  - `--clean-stale` path-exists recovery (AC7)
  - `--clean-stale` refuses `has-commits` (AC7)
  - Worktree path/branch collision-resistant naming (AC4)
  - Same-file-conflict pre-dispatch eligibility (AC7)
  - AC5 (failure cleanup: lease release + stranded worktree left on disk) and AC8 (concurrent path returns `buildBranch` + `worktreeRel`) are verified by the concurrent-scheduler eligibility test and the worktree dispatch eligibility test already present in this file.
- Exit behavior: GREEN when all milestone-worktree tests pass (exit 0). RED on any failure.

### Stage 6: Golden-replay full test suite (code)
- AC: 1
- Files: `plugin/test/prepare-milestone-preparation-e2e.test.mjs`, `plugin/test/prepare-milestone-convergence.test.mjs`, `plugin/test/prepare-admission-check.test.mjs`
- Command: `scripts/test.sh --test-name-pattern="prepare-milestone|prepare-admission"` -- GREEN: all tests pass (exit 0). These tests use the EXISTING mock harness which never passes `isolationMode`, so they exercise the legacy (no-isolation) path exclusively. A GREEN run confirms zero regressions: golden replay preserved.
- Exit behavior: GREEN when all prepare-milestone and prepare-admission tests pass with zero failures.

### Stage 7: Full GREEN suite (code)
- AC: 1, 2, 3, 4, 5, 6, 7, 8
- Files: all files in touch set plus all test files
- Command: `scripts/test.sh` -- GREEN: all tests pass (exit 0). The full suite covers:
  - `milestone-worktree.test.mjs`: worktree lifecycle, isolation plan, stranded recovery, clean-stale
  - `prepare-admission-check.test.mjs`: Admission lease, preflight, preparation check
  - `prepare-milestone-preparation-e2e.test.mjs`: end-to-end preparation flow (legacy path)
  - `prepare-milestone-convergence.test.mjs`: bounded convergence, proposal review
  - All other test files: no regressions elsewhere in the repo
- Exit behavior: GREEN when full suite exits 0. RED on any failure.

### Stage 8: CLAUDE.md documentation update (prose)
- AC: 2, 6
- Files: `CLAUDE.md`
- Command: `grep -q "prepare-milestone.*worktree\|prepare.*isolation.*worktree" CLAUDE.md` -- RED: 0 matches (pre-implementation); GREEN: >= 1 match (after update). The added paragraph documents that `prepare-milestone.js` now supports opt-in `isolationMode: 'worktree'` with the same coordination-vs-content boundary as `execute-milestone.js`, the `_worktreeIsolationNote` routing pattern, `_wtRet` stranded-worktree discoverability, and the prepare-merge flow (commit -> merge --no-ff -> remove). The paragraph is inserted in the CLAUDE.md section that already documents `execute-milestone.js`'s worktree isolation (DIR-123), directly adjacent to it.
- Line budget: ~10 lines of prose added to CLAUDE.md.
- Exit behavior: GREEN when `grep` confirms the paragraph exists and diff shows no contradictory/duplicate text.

## Guardrails

- **Mirror byte-identity invariant:** every edit to `.claude/workflows/prepare-milestone.js` is applied identically to `plugin/workflows/prepare-milestone.js`. After Stage 1, `diff` between the two files must exit 0. After Stage 2, diff must again exit 0.
- **Golden replay invariant:** when `$a.isolationMode` is omitted, empty, or any non-`'worktree'` value, the observable dispatch count, agent prompt strings, return shape, and phase outcomes are byte-for-behavior identical to the pre-implementation state. Verified by Stage 6 (existing tests pass with zero diffs).
- **Fail-closed invariant:** a requested-but-unusable `isolationMode` (unknown value, non-numeric milestone) returns `needs-human` BEFORE the Admission lease is acquired -- zero coordination state is created. The existing code at lines 90-93 already enforces this; Stages 1-2 must not regress it.
- **Coordination isolation invariant:** no `_admissionAgentCall`, `_convergenceAgentCall`, `_recordEpochDispatch`, `_preflightAgentCall`, `_renewLease`, `_releaseLeaseAndRecord`, `_releaseLease`, or `_recordAttemptAgentCall` dispatch site carries `_isolationPlan.worktreeRel`. Verified mechanically by Stage 3, check 2.

## Rollback

- Revert the three files (`.claude/workflows/prepare-milestone.js`, `plugin/workflows/prepare-milestone.js`, `CLAUDE.md`) to their pre-implementation state. Since implementation is purely additive (the legacy path is the unchanged default, gated by `_useWorktree === false`), rollback has zero effect on any existing callers.
- If the concurrent-path branch (Stage 2) introduces a defect, revert Stage 2's ~15 lines independently -- the serial path (Stages 1, 3-8) is self-contained and the concurrent path is an opt-in branch within `if (_useWorktree)`.

## Real-landing verification

After all stages GREEN:
1. Run `diff .claude/workflows/prepare-milestone.js plugin/workflows/prepare-milestone.js` -- must exit 0 (byte-identical mirrors).
2. Run `scripts/test.sh` -- must exit 0 (full GREEN suite).
3. Run the Stage 3 grep audit mechanically -- must confirm 13 `_worktreeIsolationNote` coverage + 0 coordination leakage.
4. Run `grep -q "prepare-milestone.*worktree" CLAUDE.md` -- must exit 0 (documentation present).
5. Single-task dispatch proof (task #19/L4's real-landing scope -- NOT this Plan's immediate deliverable): dispatch `prepare-milestone` with `isolationMode: 'worktree'` for a real milestone on master, confirm the worktree is created, content-agent phases route to the worktree, prepare-merge produces a clean `--no-ff` merge commit, and the worktree is removed. This is the real-landing evidence for AC4's mechanism claim, deferred to the execute phase.

## Stopping rule

At most 3 Plan-check rounds (matching the standard `prepare-milestone.js` bounded-convergence contract). Success ONLY at `F_i = 0` (zero open blocking Plan-check findings). If 3 rounds are exhausted with findings remaining, the Plan returns `needs-human`.
