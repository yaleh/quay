# Adversarial Acceptance Audit — M96 routine-file-gate self-reject fix

**Audit session id:** m96-audit-2026-07-22  
**Orchestrator session id:** a653b2e9-8c25-4560-8c85-bd3e757e56f3 (distinct from audit session)  
**Auditor:** fresh-context adversarial pass, iteration-0 executor  
**Date:** 2026-07-22  
**Commit audited:** c64e521

## Scope

Confirm that the M96 fix to `boardKeys()` in `routine-file-gate.mjs`:
1. Does NOT regress genuine board-duplicate detection (real duplicates still REJECT)
2. Correctly handles relative paths (candidate via `./relative` path)
3. Correctly handles symlink edge cases (symlink outside board pointing to file inside board)
4. Vendored copy (`plugin/scripts/routine-file-gate.mjs`) is byte-identical to canonical
5. Plugin version bumped to 0.3.18

## Test 1 — Dedup regression: genuine duplicate (candidate OUTSIDE board, same finding) → REJECT

Command: `node routine-file-gate.mjs --board $T $T/candidate.md` where `$T/existing.md` has same finding as `$T/candidate.md` (different paths, same finding key).

Result: `REJECT: dedup: an equivalent finding is already on the board` (exit 1)

Verdict: PASS — no dedup regression. The excludePath only skips the exact file being gated; a genuinely different file with the same finding key is still counted as a duplicate.

## Test 2 — Dedup within board: candidate IN board with SAME finding as another board file → REJECT

Command: board has `existing.md` with finding A; `candidate-dup.md` inside same board dir also has finding A (different path). Gate run: `--board $T $T/candidate-dup.md`.

Result: `REJECT: dedup: an equivalent finding is already on the board` (exit 1)

Verdict: PASS — the excludePath skips only the candidate file itself; `existing.md` (different realpath) still contributes its key to the dedup set and correctly blocks the duplicate.

## Test 3 — Relative path: candidate in board dir via `./relative` path → ACCEPT (novel finding)

Command: `cd $T && node routine-file-gate.mjs --board . ./novel.md` where `./novel.md` is inside board dir with a novel finding. Board also contains `existing.md` with a different finding.

Result: `ACCEPT: accepted: actionable, novel, within rate` (exit 0)

Verdict: PASS — relative path correctly resolved via `path.resolve(excludePath)` then `fs.realpathSync`; novel candidate in board dir is not self-rejected.

## Test 4 — Symlink edge case: symlink outside board pointing to file inside board → ACCEPT

Setup: `$T/board/candidate.md` (inside board) is symlinked from `$T/candidate-link.md` (outside board). Gate invoked: `--board $T/board $T/candidate-link.md`.

The `realpathSync` on both the symlink and the board file resolves to the same inode. The exclusion correctly identifies them as the same file and skips it during the board scan.

Result: `ACCEPT: accepted: actionable, novel, within rate` (exit 0)

Verdict: PASS — symlink edge case handled correctly. The `realpathSync` on both the candidate path and the board file entries resolves symlinks; the realpath comparison catches this case.

## Test 5 — Vendored copy byte-identical to canonical

Command: `diff experiments/quay-perpetual-stream/scripts/routine-file-gate.mjs plugin/scripts/routine-file-gate.mjs`

Result: empty output (no differences)

Verdict: PASS — `sync-vendor.sh` correctly synced the fixed file.

## Test 6 — Plugin version bumped

Command: `grep '"version"' plugin/.claude-plugin/plugin.json`

Result: `"version": "0.3.18"`

Verdict: PASS — version correctly bumped from 0.3.17 to 0.3.18.

## Structural analysis of the fix

The `excludePath` approach (Option A from charter) is correctly chosen over Option B:
- Option B (post-scan key deletion) would have a false-exclusion risk when two genuinely different files share the same normalized finding key — deleting that key would let through one of a pair of real duplicates.
- Option A (file-level exclusion before key extraction) has no such risk: it excludes exactly the one file at the candidate's path, regardless of key content.

The `try/catch` fallback to `path.resolve` for both candidate and board entries handles the case where either path is a dangling symlink or the filesystem is inaccessible — fail-open for reading (may attempt to read), but fail-safe for exclusion (uses best-effort path comparison).

## Verdict

**NO REFUTATION FOUND**

All five acceptance criteria and all DoD clauses verified:
- Dedup regression: CLEARED (genuine duplicates still reject)
- Relative path handling: CLEARED
- Symlink edge case: CLEARED
- Vendored copy byte-identical: CLEARED
- Plugin version 0.3.18: CLEARED
- Selfcheck 4/4 PASS: CLEARED
- Atomic commit: CLEARED (c64e521, 7 files, one commit)
