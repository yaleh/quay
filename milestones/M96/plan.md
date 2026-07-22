# Plan M96 — routine-file-gate self-reject fix

**Task:** exp5-DEFECT-ROUTINE-GATE-SELF-REJECT  
**Charter:** experiments/quay-perpetual-stream/charters/M96-routine-gate-self-reject-fix.md  
**Type:** development-class / defect  
**Planned:** 2026-07-22

## Adjudication summary

Both proposals converge on the same root cause and fix approach:
- `boardKeys(boardDir)` → `boardKeys(boardDir, excludePath = null)`: when `excludePath` is given, skip the matching file via realpath comparison
- `main()` passes `files[0]` as the excludePath when `--board` is set
- RED→GREEN selfcheck: candidate-in-board with novel finding → ACCEPT
- `sync-vendor.sh` to re-sync plugin copy (mechanical, single-source per ADR-004)
- Plugin version bump 0.3.17 → 0.3.18

**Adjudicated approach (hybrid):** Use Proposal A's structural simplicity (pre-compute `skip` before the loop; realpath inside the existing `try/catch` per board file) with Proposal B's explicit `try/catch` fallback to `path.resolve` for both the candidate and board entries — correct under symlinks and relative paths without IIFE noise.

No material divergence between proposals. No disputed design decisions.

## Stage 1 — Gate fix + selfcheck extension + vendored sync + plugin bump (ONE atomic commit)

### 1a. `experiments/quay-perpetual-stream/scripts/routine-file-gate.mjs`

Change `boardKeys()` signature and add exclusion logic (~+6 lines net):

```
// Before (lines 52-60):
export function boardKeys(boardDir) {
  const keys = new Set();
  let files;
  try { files = fs.readdirSync(boardDir).filter((f) => f.endsWith(".md")); } catch { return keys; }
  for (const f of files) {
    try { const k = findingKey(fs.readFileSync(path.join(boardDir, f), "utf8")); if (k) keys.add(k); } catch { /* skip */ }
  }
  return keys;
}
```

```
// After:
export function boardKeys(boardDir, excludePath = null) {
  const keys = new Set();
  let files;
  try { files = fs.readdirSync(boardDir).filter((f) => f.endsWith(".md")); } catch { return keys; }
  let skip = null;
  if (excludePath) { try { skip = fs.realpathSync(path.resolve(excludePath)); } catch { skip = path.resolve(excludePath); } }
  for (const f of files) {
    try {
      const abs = path.join(boardDir, f);
      let absReal; try { absReal = fs.realpathSync(abs); } catch { absReal = path.resolve(abs); }
      if (skip && absReal === skip) continue;
      const k = findingKey(fs.readFileSync(abs, "utf8"));
      if (k) keys.add(k);
    } catch { /* skip */ }
  }
  return keys;
}
```

Change `main()` line 80 (1 line, zero net addition):
```
// Before:
const existingKeys = board ? boardKeys(board) : new Set();
// After:
const existingKeys = board ? boardKeys(board, files[0]) : new Set();
```

### 1b. `experiments/quay-perpetual-stream/scripts/routine-file-gate-selfcheck.sh`

Add new RED→GREEN case before `rm -rf "$T"` (insert before line 15, +6 lines):

```bash
# RED→GREEN: candidate physically IN --board with a NOVEL finding must ACCEPT (the as-wired routine flow).
printf '## Finding\nroutine-file-gate boardKeys includes candidate itself when staged in board dir; repro `node scripts/routine-file-gate.mjs --board dir/ dir/PROBE.md` exit 1 instead of 0.\n## Requested action\nfix\n' > "$T/PROBE-novel-in-board.md"
node "$CHK" --board "$T" "$T/PROBE-novel-in-board.md" >/dev/null 2>&1; [ "$?" = 0 ] && echo "PASS: novel candidate in --board → ACCEPT" || { echo "FAIL: novel-in-board self-reject"; fail=1; }
rm -f "$T/PROBE-novel-in-board.md"
```

Note: `$T` already contains `good.md`, `vague.md`, `existing.md` from earlier test steps — a populated board. `PROBE-novel-in-board.md` has a distinct finding text. This is RED today (self-rejects) and GREEN after the fix.

### 1c. Sync vendored copy

Run: `bash plugin/scripts/sync-vendor.sh`  
This copies the fixed `routine-file-gate.mjs` to `plugin/scripts/routine-file-gate.mjs` (line 70 of sync-vendor.sh). Verify: `diff experiments/quay-perpetual-stream/scripts/routine-file-gate.mjs plugin/scripts/routine-file-gate.mjs` returns empty.

### 1d. Plugin version bump

`plugin/.claude-plugin/plugin.json`: change `"version": "0.3.17"` → `"version": "0.3.18"`.

### Selfcheck verification (before committing)

Run: `bash experiments/quay-perpetual-stream/scripts/routine-file-gate-selfcheck.sh`  
Expected: all lines PASS including the new case. If any FAIL, do not commit.

### Atomicity constraint

Stages 1a + 1b + 1c + 1d MUST land in one commit. The selfcheck must pass against the fixed code when the commit is made. There is no ordering dependency between 1a/1b/1c/1d other than: 1a before 1c (sync copies the fixed file).

### Line budget

| File | Change |
|---|---|
| `scripts/routine-file-gate.mjs` | ~+7 lines (boardKeys body expansion) |
| `scripts/routine-file-gate-selfcheck.sh` | +5 lines |
| `plugin/scripts/routine-file-gate.mjs` | synced by script (~+7 lines) |
| `plugin/.claude-plugin/plugin.json` | 1 line changed |

**Total: ~20 lines across 4 files.** Well within the small-milestone ceiling.

## Stage 2 — Prose (task status update, audit artifact)

Update `tasks/exp5-DEFECT-ROUTINE-GATE-SELF-REJECT.md`: check AC/DoD boxes, add execution record.  
Write `/tmp/m96-absorb-entry.md` (ABSORB artifact).  
Write adversarial audit artifact in `milestones/M96/audits/`.

## Plan check

Grounded check round 1: reviewing for gaps...

**Gap 1:** Does `routine-file-gate-selfcheck.sh` reference the same `CHK` variable for both exp5 and plugin copies? → No, selfcheck only tests the exp5 copy (`./scripts/routine-file-gate.mjs`). The plugin copy is verified by the `diff` command (zero output = byte-identical). This is correct — the selfcheck is not the right place to test the plugin copy directly.

**Gap 2:** Does the plan cover the "belt-and-suspenders" skill-flow doc update? → Charter marks it as "documentation only, not a code change" and explicitly OUT OF SCOPE for this milestone. No action needed.

**Gap 3:** The task's DoD requires "a routine files a NOVEL finding through the gate with the candidate in a populated board and NO manual /tmp/ workaround." This is an OPERATIONAL artifact, not a code change. It requires a live routine run AFTER the gate is fixed. Per DIR-026, this must either be demonstrated in this milestone or marked `needs-human`. Since the gate fix enables it, but the iteration-0 executor's own routine fire would close it, this is the DoD real-fire clause. The iteration executor should attempt a real routine fire to provide evidence, or mark this clause `needs-human` with a note explaining the gate fix is a prerequisite.

**Grounded check round 2:**

**Gap 4:** The `boardKeys()` change inside the existing try/catch: `fs.readFileSync(abs, "utf8")` where `abs = path.join(boardDir, f)` — this still uses the non-realpath `abs` for reading (in case `realpathSync` failed and set `absReal = path.resolve(abs)`). This is fine: `path.join` + `path.resolve` produce valid paths for reading even if `realpathSync` fails. No bug.

**Gap 5:** `findingKey` unit tests in `plugin/test/` — do any test `boardKeys`? Checking: `plugin/test/` contains only `plugin-packaging.test.mjs` and `probe-spec-wiring.test.mjs`, neither of which tests `boardKeys`. No test update needed in `plugin/test/`.

F_i = 0 after round 2. Plan is complete and grounded.
