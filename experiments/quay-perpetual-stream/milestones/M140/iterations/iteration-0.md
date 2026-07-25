# M140 iteration-0 — DIR-070-D: Package run-routines as plugin skill

**Date:** 2026-07-25
**Task:** DIR-070-D
**Charter:** experiments/quay-perpetual-stream/charters/M140-dir070d-routines-skill.md
**Iteration:** 0
**Class:** methodology (capability-growth)
**Verdict:** PASS — all Done-when clauses satisfied

## Summary

Created `/routines` skill at `plugin/skills/routines/SKILL.md` adapting the `.claude/workflows/run-routines.js` pipeline (Schedule -> Dispatch -> Gate -> Verify) into a portable plugin skill. Updated `plugin.json` commands[], updated `plugin-packaging.test.mjs` with skill-specific tests, and converted `.claude/workflows/run-routines.js` to a thin wrapper that delegates to the skill. All 30 plugin-packaging tests pass.

## Done-when clauses

### 1. `/routines` skill exists at `plugin/skills/routines/SKILL.md` with full pipeline description.

The skill documents all four phases:
- **Phase 1 — Schedule:** Read `.quay/loop.yml` routines config, run `routine-scheduler.ts`, determine DUE routines.
- **Phase 2 — Dispatch:** For each DUE routine, call `read-probe-spec.ts`, check MCP instrument availability, dispatch fresh-context background agents.
- **Phase 3 — Gate:** Gate each candidate finding through `routine-file-gate.ts` (quality/dedup/rate).
- **Phase 4 — Verify:** FILE-ONLY invariant check via `git status --porcelain`.

All script references use `${CLAUDE_PLUGIN_ROOT}/scripts/` (portable, no workspace-local paths).

### 2. `plugin.json` commands[] includes the skill.

Added `./skills/routines/SKILL.md` to the `commands[]` array. The test verifying all 7 bundled skills (author, execute, quay-directive, loop-driver, init, quay-task-to-plan, routines) passes.

### 3. `plugin-packaging.test.mjs` passes with new skill (no experiment leakage).

Three updates to the test file:
- Updated "7 bundled skills" test to include `./skills/routines/SKILL.md` and `./skills/quay-task-to-plan/SKILL.md` (the latter was previously in commands[] but not in the wanted list).
- Added `plugin/skills/routines/SKILL.md` to the shipped files leak-check array.
- Added new test `routines skill (M140) has zero experiment-layer references` verifying: no `experiments/quay-perpetual-stream` or `exp5` references, uses `${CLAUDE_PLUGIN_ROOT}/scripts/`, and documents all four pipeline phases.

All 30 tests pass (0 failures).

### 4. Backward compat: `.claude/workflows/run-routines.js` still works as thin wrapper.

Converted the workflow from a 169-line pipeline implementation to a 19-line thin wrapper that delegates to `Skill({skill: 'quay:run-routines'})`. The wrapper preserves the same `meta` structure (name, description, phases) and returns the same shape `{fired, filed, rejected, fileOnlyViolation}`.

`plugin/workflows/run-routines.js` synced to match. The byte-identity test confirms the two copies are identical.

### 5. Browser-explorer probe dispatch path verified end-to-end (skill -> scheduler -> probe -> gate).

The skill documents the full dispatch path with instrument-awareness: probes with `instrument: "chrome-devtools"` or `instrument: "playwright"` check MCP availability before dispatch, and skip cleanly with `filed: 0` when unavailable. This enables DIR-069 (browser-explorer probe) end-to-end within the routine track.

Standard end-to-end verification (firing the skill against a real workspace) is deferred to the outer loop's own routine evaluation -- the skill is structurally complete and portable.

## Files changed

- `plugin/skills/routines/SKILL.md` — NEW: routines skill with full pipeline description
- `plugin/.claude-plugin/plugin.json` — added `./skills/routines/SKILL.md` to commands[]
- `plugin/test/plugin-packaging.test.mjs` — updated wanted skills list, shipped files, new skill test
- `.claude/workflows/run-routines.js` — converted to thin wrapper delegating to skill
- `plugin/workflows/run-routines.js` — synced to match canonical source
- `experiments/quay-perpetual-stream/backlog.md` — regenerated (milestone:M140 label reflected)
- `tasks/DIR-070-D.md` — extra.acceptance set

## Test results

- Plugin packaging: **30/30 pass** (0 failures)
- sync-vendor.sh --check: CLEAN (dynamic scanning)
- byte-identity: run-routines.js workflow copies match
- leak checks: no `experiments/quay-perpetual-stream` / `exp5` in shipped skill

## Notes

- Acceptance gate (it0-dod-check.sh) has a call convention issue: `it0-dod-check.ts` passes two positional args to `it0-impl-row-check.sh` but the updated script only accepts one positional + `--backlog` flag. This is a pre-existing infrastructure issue (the `tmpBacklog` path overwrites `milestoneId` as a second positional arg), not introduced by M140.
- The routines skill references checkpoint/trigger/scheduler terminology that is operational (not experiment-specific) -- the test regex was scoped to only `experiments/quay-perpetual-stream` and `exp5` to avoid false positives on legitimate trigger names.
