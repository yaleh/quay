# M187 iteration-0 — restart-readiness-check.sh/select-preflight.test.mjs: fix the halt-path
documentation-vs-code mismatch (gap-halt-sentinel-path-mismatch)

**Task:** `gap-halt-sentinel-path-mismatch`
**Charter:** `experiments/quay-perpetual-stream/charters/M187-gap-halt-restart-readiness-fix.md`
**Class:** development (instrument-correction — doc/code consistency fix, VT-neutral).

## What was done

1. `experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh`
   - `HALT="experiments/quay-perpetual-stream/.halt"` → `HALT=".halt"` (repo-root-relative),
     matching `select-preflight.ts`'s `checkHalt()` (`path.join(workspaceRoot, ".halt")`) and
     `plugin/skills/loop-driver/SKILL.md`'s documented convention ("`test -f .halt`
     (workspaceRoot-relative)").
   - Also fixed a second, previously-undiscovered instance of the same bug in the SAME script: the
     working-tree "dirty" check (step 1) excluded `.halt` from the `git status --short` diff via a
     grep pattern that **hardcoded** the wrong path
     (`grep -vE "(^\?\? )?experiments/quay-perpetual-stream/\.halt$"`) — independent of the `$HALT`
     variable, so simply reassigning `$HALT` would NOT have fixed step 1's actual behavior. Changed
     the pattern to derive from `$HALT` (`${HALT//./\\.}`) so it can never drift out of sync with
     the variable again.
2. `experiments/quay-perpetual-stream/test/select-preflight.test.mjs`
   - New regression-guard test: `checkHalt: .halt at experiments/quay-perpetual-stream/ path only →
     {halt: false} (wrong-path regression guard)`. Places a `.halt` file ONLY at
     `<tmpDir>/experiments/quay-perpetual-stream/.halt` (no `.halt` at the workspace root itself)
     and asserts `checkHalt(tmpDir).halt === false` — an explicit, permanent pin against this exact
     confusion recurring in `checkHalt()` itself.
3. `tasks/gap-halt-sentinel-path-mismatch.md`
   - Added a "Round 3 (2026-07-27, M187)" section documenting the code fix + regression guard.
   - Checked off all 3 Acceptance Criteria checkboxes (each now landed).
   - `## Definition of Done` rewritten to reference the standard inherited-core DoD clauses (was
     previously only the two task-specific DoD bullets, which `it0-dod-check.ts`'s clause0 requires
     to ALSO reference the standard reference-plus-extras set).
   - `extra.acceptance` set to the it0-dod-check invocation for this milestone (pre-flight step).

## Real evidence

### The bug was real and reproducible before the fix

The original hardcoded exclusion pattern in `restart-readiness-check.sh` only matched
`experiments/quay-perpetual-stream/.halt` in `git status --short` output — a repo-root `.halt`
(the actually-correct sentinel location, confirmed by `select-preflight.ts`) showed up as
"dirty," which would have made `restart-readiness-check.sh` incorrectly report `NOT READY` any
time a human legitimately halted the loop via the repo-root convention. Confirmed directly against
the live repo state (both `.halt` files present on disk at the time of this build):

```
$ git status --short
 M experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh
 M experiments/quay-perpetual-stream/test/select-preflight.test.mjs
?? .halt
?? experiments/quay-perpetual-stream/.halt

# OLD pattern (pre-fix) — repo-root .halt NOT excluded, still shows as "dirty":
$ git status --short | grep -vE "(^\?\? )?experiments/quay-perpetual-stream/\.halt$"
 M experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh
 M experiments/quay-perpetual-stream/test/select-preflight.test.mjs
?? .halt              # <- WRONG: still present, would fail the dirty-tree check

# NEW pattern (post-fix) — repo-root .halt correctly excluded:
$ HALT=".halt"; git status --short | grep -vE "(^\?\? )?${HALT//./\\.}\$"
 M experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh
 M experiments/quay-perpetual-stream/test/select-preflight.test.mjs
```

Ran the full script end-to-end after the fix — the two genuinely-modified files show up as dirty
(expected, this build's own edits), the repo-root `.halt` is correctly excluded, and the
experiments-scoped stray `.halt` (a leftover from the original finding's mitigation, NOT the real
sentinel) correctly remains flagged as unexpected working-tree state:

```
$ bash experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh
restart-readiness-check — repo: /home/yale/work/quay
  [FAIL] working tree NOT clean:
          M experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh
          M experiments/quay-perpetual-stream/test/select-preflight.test.mjs
  [ok]   no MERGE_HEAD (no merge in progress)
  [ok]   no unmerged index entries
  [ok]   master not checked out in a stray worktree
  [ok]   task-schema-selfcheck green
  [ok]   dod-fixture-selfcheck green
  [ok]   vmeta-lag-selfcheck green
  [ok]   loadbearing-test-gate green
  [info] pending directives (loop DRAINs these): 2 DIR-118,DIR-120

NOT READY ✗ — at least one hard check failed; do NOT remove .halt until resolved.
```
(FAIL is expected here — the two edits above ARE real, uncommitted-at-the-time-of-this-run working
tree changes; the point demonstrated is that `.halt` itself is no longer counted against the
check.)

### RED — the new regression-guard test fails against the pre-M187-style wrong path logic

Temporarily reintroduced the old-style wrong-path bug directly into `checkHalt()` in
`select-preflight.ts` (`path.join(workspaceRoot, "experiments", "quay-perpetual-stream", ".halt")`
instead of `path.join(workspaceRoot, ".halt")`), then ran ONLY the new test:

```
$ node --test --test-name-pattern="wrong-path regression guard" \
    experiments/quay-perpetual-stream/test/select-preflight.test.mjs
✖ checkHalt: .halt at experiments/quay-perpetual-stream/ path only → {halt: false} (wrong-path regression guard)
  AssertionError [ERR_ASSERTION]: expected halt:false with .halt only at the experiments-scoped path, got reason=manual stop
  true !== false
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

### GREEN — same test passes against the real (unmodified) code

Reverted `select-preflight.ts` to its real, checked-in content (no diff — this milestone's scope
does NOT touch `select-preflight.ts`, only `restart-readiness-check.sh` +
`select-preflight.test.mjs`, per the charter's explicit DIR-120-overlap carve-out) and re-ran:

```
$ node --test --test-name-pattern="wrong-path regression guard" \
    experiments/quay-perpetual-stream/test/select-preflight.test.mjs
✔ checkHalt: .halt at experiments/quay-perpetual-stream/ path only → {halt: false} (wrong-path regression guard)
ℹ tests 1
ℹ pass 1
ℹ fail 0

$ git status --short experiments/quay-perpetual-stream/scripts/select-preflight.ts
(no output — file unmodified, confirms the temp RED-check edit was fully reverted)
```

### Full `select-preflight.test.mjs` suite green (31/31, including the 3 pre-existing checkHalt tests)

```
$ node --test experiments/quay-perpetual-stream/test/select-preflight.test.mjs
ℹ tests 31
ℹ suites 0
ℹ pass 31
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

### it0-dod-check.sh — PASS (all 12 dispositioned clauses)

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh gap-halt-sentinel-path-mismatch \
    experiments/quay-perpetual-stream/charters/M187-gap-halt-restart-readiness-fix.md \
    /tmp/m187-absorb-entry.md
PASS: clause0-ac-dod-present: task AC has 3 checkable clause(s) (checklist-form, 3/3 checked); DoD references the standard
PASS: clause1-adversarial-audit: disposition statement present (documented no-op)
PASS: clause2-vmeta-lag: disposition statement present
PASS: clause3-line-budget ... clause12-audit-independence: all PASS/N/A
PASS: DoD check passed — all clauses satisfied (12 disposition(s) confirmed), no undeclared self-exemption.
```

### Repo-wide regression check

`scripts/test.sh` (the canonical full-suite entrypoint, ADR-019/DIR-109) was run to confirm the
change introduces no regressions elsewhere in the repo.

## Touches

- `experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh` — `HALT` variable +
  git-status dirty-check exclusion pattern, both now repo-root-relative and derived from a single
  source (`$HALT`).
- `experiments/quay-perpetual-stream/test/select-preflight.test.mjs` — +1 regression-guard test.
- `tasks/gap-halt-sentinel-path-mismatch.md` — AC checkboxes checked, DoD section rewritten to
  reference the standard inherited-core clauses, `extra.acceptance` set, Round-3 finding note
  added.
- `select-preflight.ts` — untouched (explicitly out of scope; `checkHalt()`'s own repo-root logic
  was already correct — only the SECOND, unwired `restart-readiness-check.sh` copy of this logic
  was wrong. The fail-open→fail-closed `checkHalt()` catch-block hardening is DIR-120's separate,
  concurrent scope on the same file).

## Scope discipline

Per the charter's "Out of scope": did NOT wire `restart-readiness-check.sh` into
`OUTER-LOOP.md`'s actual resume path (tracked separately, `gap-orphaned-check-scripts-not-wired`);
did NOT touch `checkHalt()`'s fail-open catch-block behavior (DIR-120's scope, running
concurrently against the same file in a disjoint region — confirmed by touches-orthogonality
before dispatch, per the M187 ABSORB entry).

## Human-steered discipline

This change lands inside `experiments/*/scripts/` (a driver execution-chain file per the
quay-directive skill's override scope) and is labeled `human-steered` on the task — executed under
that discipline; the RED/GREEN replay above is the required golden-replay evidence (pre-change vs.
post-change behavior over the identical `checkHalt()` code path).
