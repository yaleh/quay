# Charter M96-routine-gate-self-reject-fix — routine-file-gate self-reject bug fix

**Milestone id:** M96  
**Task:** `tasks/exp5-DEFECT-ROUTINE-GATE-SELF-REJECT.md` (milestone-candidate, defect)  
**Surface:** `experiments/quay-perpetual-stream/scripts/routine-file-gate.mjs` + vendored `plugin/scripts/routine-file-gate.mjs`  
**Type:** development-class / defect  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

`routine-file-gate.mjs`'s `boardKeys(boardDir)` scans ALL `.md` files in `--board` to build the dedup key set — including the candidate file itself, if the caller wrote it into `--board` before running the gate. The skill's routine flow does exactly that: writes `quay-tasks/PROBE-*.md` and then calls `routine-file-gate.mjs --board <boardDir> <candidate>`. Result: the candidate's own finding-key is "already on the board" → gate REJECTS it as a duplicate of itself → 0 filed.

Surfaced by the DIR-051 real routine-fire on archguard (2026-07-22): 3 real defects self-rejected (FIRST fire); the SECOND fire only filed because the probe agent manually staged to `/tmp/` first (workaround, not a fix).

Root cause: `boardKeys()` at `scripts/routine-file-gate.mjs:52` includes every `.md` file in `boardDir` with no exclusion for the candidate being gated.

Both copies are affected:
- `experiments/quay-perpetual-stream/scripts/routine-file-gate.mjs` (exp5 canonical)
- `plugin/scripts/routine-file-gate.mjs` (vendored plugin copy, ADR-004 requires re-sync)

## Scope

**In scope:**

Two implementation options for the gate-side fix (preferred per the task's own ADR-004 framing):
- **Option A (excludePath param):** `boardKeys(boardDir, excludePath?)` — when `excludePath` is provided, skip that file during the scan (realpath comparison to handle relative/absolute path variants). `main()` passes `path.resolve(files[0])` as excludePath. The caller's staging location is now irrelevant.
- **Option B (skip-by-candidate):** Inside `main()`, after reading `boardKeys(board)`, delete the candidate's own key from the set before calling `gateFinding()`. Avoids changing `boardKeys()`'s signature but is less robust (key collision: two genuinely different files with the same normalized finding-key would both be excluded).

Adjudicator selects Option A (realpath-exclude param) — it is the single-source gate-side fix with no false-exclusion risk.

1. Add optional `excludePath` parameter to `boardKeys(boardDir, excludePath?)`. When set, skip files whose `path.join(boardDir, f)` resolved via `fs.realpathSync()` matches `fs.realpathSync(excludePath)` (guard with try/catch — if either realpath fails, do not skip).
2. In `main()`, pass `excludePath = path.resolve(files[0])` to `boardKeys(board, ...)` when `board` is set.
3. Re-sync the vendored plugin copy (`plugin/scripts/routine-file-gate.mjs`) to be byte-identical to the exp5 canonical.
4. Bump plugin version: `plugin/.claude-plugin/plugin.json` `"version"` `0.3.17` → `0.3.18`.
5. Add a RED→GREEN selfcheck case to `scripts/routine-file-gate-selfcheck.sh`: candidate with a NOVEL finding physically IN a populated `--board` (board also contains a different-finding `existing.md`) → gate must ACCEPT. (This case currently REJECTs as self-duplicate — the bug; it must ACCEPT after the fix.)

**Belt-and-suspenders (documentation only, not a code change):** The skill's routine flow may additionally document stage-outside-board → gate → move-on-ACCEPT as the preferred caller pattern, but this is NOT a hard requirement for this milestone — the gate-side fix is sufficient and makes caller staging location irrelevant.

**Out of scope:**
- Skill code changes (the gate fix renders them optional)
- Changing the RATE or QUALITY gate logic
- `plugin/test/routine-file-gate.test.mjs` (if it exists — add there only if one already exists; do not create new test files outside the established pattern)

## Class routing

**Development-class** — code change in `experiments/quay-perpetual-stream/scripts/`. MUST go through `quay-task-to-plan` pipeline (N=2 independent blank-slate proposals → adjudication → write-back → plan author → grounded check rounds → converge) BEFORE dispatch to `baime:iteration-executor`. Per OUTER-LOOP.md step 5a.

## Acceptance Criteria

- [ ] `boardKeys()` accepts an optional `excludePath` param; when passed the candidate's path, it skips that file — so a candidate physically in `--board` with a NOVEL finding ACCEPTS (not self-rejected).
- [ ] `routine-file-gate-selfcheck.sh` passes including the new RED→GREEN case (candidate-in-board, novel finding → ACCEPT).
- [ ] `plugin/scripts/routine-file-gate.mjs` is byte-identical to `experiments/quay-perpetual-stream/scripts/routine-file-gate.mjs` after the fix.
- [ ] Plugin version bumped to 0.3.18 in `plugin/.claude-plugin/plugin.json`.
- [ ] Regression: existing dedup case (a genuine board-duplicate, staged OUTSIDE `--board`) still REJECTS.

## Definition of Done

References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [ ] `routine-file-gate-selfcheck.sh` exits 0 with all cases including new RED→GREEN; pasted output confirms.
- [ ] Gate fix + vendored copy re-sync + plugin bump land in a single atomic commit.
- [ ] TDD per ADR-001: the RED→GREEN selfcheck case was failing before the fix and passes after.
- [ ] Plugin re-vendored + bumped (0.3.17 → 0.3.18) per ADR-004 single-source invariant.
- [ ] Fresh-context adversarial audit confirms no dedup regression (genuine duplicates still reject) and the fix handles the realpath edge case (candidate path relative vs absolute).
- [ ] Per DIR-026 SPLIT-OR-COMMIT: gate fix + sync + bump land done-or-`needs-human`.

## GATE-HASH-REF

`33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`  
(SHA-256 of `experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs` at charter time — the iteration-0 agent MUST verify this matches before running gates)
