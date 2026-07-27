---
id: gap-halt-sentinel-path-mismatch
title: CLAUDE.md/restart-readiness-check.sh incorrectly documented .halt at
  experiments/quay-perpetual-stream/ — the real, product-wide convention
  (select-preflight.ts + plugin/skills/loop-driver/SKILL.md) is
  repo-root-relative
status: done
labels:
  - gap
  - defect
  - human-steered
  - milestone-candidate
parent: null
children: []
extra:
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    gap-halt-sentinel-path-mismatch
    experiments/quay-perpetual-stream/charters/M187-gap-halt-restart-readiness-fix.md
    /tmp/m187-absorb-entry.md
---
## Finding

Discovered 2026-07-27 while answering "如果现在恢复 exp5，会执行哪些任务" — ran a real
`select-preflight.ts --json --workspace-root . --milestone-counter 184` dry run and got
`"halt": false` back, **despite `experiments/quay-perpetual-stream/.halt` existing on disk** (mtime
2026-07-26T12:42:43Z, present continuously since before this session's first milestone).

Root-caused directly from the source, not guessed:

1. **`select-preflight.ts`'s own `checkHalt()`** (line ~98): `const haltPath =
   path.join(workspaceRoot, ".halt")` — checks `<workspaceRoot>/.halt`, i.e. the REPO ROOT when
   `workspaceRoot` is the repo root (which it always is — see next point).
2. **`.claude/workflows/select-preflight.js`** (the dispatched Workflow wrapper) instructs the
   agent: `node ... select-preflight.ts --json --workspace-root ${$a.workspaceRoot || '.'} ...` —
   `$a.workspaceRoot` is whatever `OUTER-LOOP.md` passes through its own `λ(workspaceRoot: Path)`
   signature (line 7), which every real invocation this session used as the REPO ROOT
   (`/home/yale/work/quay`), matching `drain(D) = invoke(..., {workspaceRoot})` and
   `preflight = invoke(..., {workspaceRoot})` (lines 12/19) — the same `workspaceRoot` value is
   threaded through unchanged.
3. **`OUTER-LOOP.md`'s own top-level invariant**, `halt_human() = exists(".halt") → clean exit at
   boundary` (line 186) and `human_stop() = touch(".halt")` (line 252) — both use a BARE relative
   path, which resolves against the driver session's CWD (the repo root), not against
   `experiments/quay-perpetual-stream/`.
4. **Only ONE script in the entire repo actually reads the `experiments/`-scoped path**:
   `restart-readiness-check.sh` (`HALT="experiments/quay-perpetual-stream/.halt"`) — but this
   script's own header says it is "the mechanical go/no-go for **un-halting** exp5" (a human-run
   pre-flight BEFORE removing the sentinel), and it is **never invoked anywhere** in
   `OUTER-LOOP.md` or any workflow script. It is not part of the automatic loop-resume path at all.

## Round 2 (2026-07-27, config-file survey) — direction of the fix, confirmed

A broader survey of quay's configuration files found the deciding evidence: **`plugin/skills/
loop-driver/SKILL.md`** — the generic, portable, product-shipped loop driver used by OTHER
workspaces (e.g. archguard), not exp5-specific — states explicitly (line 85): *"If `params.stop =
until(.halt)`: `test -f .halt` (workspaceRoot-relative)."* This is the SAME convention
`select-preflight.ts` implements. Independently re-swept every real (non-test, non-orphaned)
reference to `.halt` across `experiments/quay-perpetual-stream/scripts/*.{sh,ts}` — the ONLY hit
using the experiments-scoped path is the already-known orphaned `restart-readiness-check.sh`.

**Conclusion (supersedes round 1's "pick either direction" framing): the repo-root convention is
the real, consistent, product-wide standard. `CLAUDE.md`'s prose (`experiments/
quay-perpetual-stream/.halt`) and `restart-readiness-check.sh`'s hardcoded path are the anomaly —
they should be corrected to match the code, not the other way around.**

**Mitigation already applied**: `/home/yale/work/quay/.halt` (repo root, empty) created as the now
confirmed-correct sentinel location, alongside the pre-existing (now known-ineffective)
`experiments/quay-perpetual-stream/.halt` — both left in place, untracked. `CLAUDE.md`'s `.halt`
sentinel line corrected in place (2026-07-27) to document the real repo-root convention and flag
the previous documentation as wrong.

## Round 3 (2026-07-27, M187) — code fix + regression guard landed

1. `restart-readiness-check.sh`'s `HALT` variable changed from
   `"experiments/quay-perpetual-stream/.halt"` to `".halt"` (repo-root-relative), matching
   `select-preflight.ts`'s `checkHalt()`. Also fixed the script's git-status dirty-check exclusion
   regex (line ~26), which had hardcoded the same wrong `experiments/quay-perpetual-stream/\.halt$`
   pattern independent of the `$HALT` variable — now derived from `$HALT` so it can't drift again.
2. New regression-guard test added to `select-preflight.test.mjs`: a `.halt` placed ONLY at
   `experiments/quay-perpetual-stream/.halt` (workspace root's `.halt` absent) asserts
   `checkHalt(tmpDir).halt === false`. Verified RED against a temporarily-reintroduced old-style
   wrong-path `checkHalt()` implementation, and GREEN against the real (already-correct) code —
   both states confirmed by actually running the test both ways, not asserted.

## Requested action

1. Fix `restart-readiness-check.sh`'s `HALT="experiments/quay-perpetual-stream/.halt"` → repo-root
   `.halt`, matching the real, live convention. — DONE (M187, see Round 3 above).
2. `CLAUDE.md` — DONE (corrected 2026-07-27, see above).
3. Add a selftest fixture to `select-preflight.test.mjs` confirming a `.halt` at the
   `experiments/quay-perpetual-stream/` path does NOT satisfy the check (documents the footgun
   explicitly, guards against future regression/re-confusion). — DONE (M187, see Round 3 above).
4. Consider wiring `restart-readiness-check.sh` into `OUTER-LOOP.md`'s actual resume path (it is
   currently a real, correct, but never-invoked script) — same shape as the `delivery-manifest-
   check.ts` orphan found in the same survey; may be worth folding into the broader "audit orphaned
   `*-check.{ts,sh}` scripts" cleanup this survey recommended (see
   `gap-orphaned-check-scripts-not-wired`, filed separately). — OUT OF SCOPE for M187 (explicitly,
   per the M187 charter's Scope section); tracked in `gap-orphaned-check-scripts-not-wired`.
5. **Safety hardening, independent of the path question**: `checkHalt()`'s `catch { return {
   halt: false } }` fail-open behavior should be reconsidered — any read failure (permissions,
   transient FS error, wrong path due to a FUTURE version of this same class of bug) currently
   defaults to "not halted, proceed" rather than the safer "cannot confirm safety, treat as
   halted." — OUT OF SCOPE for M187 (explicitly, per the M187 charter's Scope section — this is
   DIR-120's scope, a different concurrent milestone touching the same file's `checkHalt()`
   catch-block body).

## Acceptance Criteria
- [x] `restart-readiness-check.sh` checks the same repo-root path `select-preflight.ts` does.
  (Audit evidence, session 13efe277-45ff-4563-bcfe-fd2c3db3e2a5, 2026-07-27: `HALT=".halt"` at
  line 17 of `experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh` as of commit
  `615d4c0` on `master`; matches `select-preflight.ts`'s `checkHalt()` `path.join(workspaceRoot,
  ".halt")`.)
- [x] `CLAUDE.md` documents the real, current code's convention — DONE 2026-07-27.
  (Audit evidence: `CLAUDE.md` line 57 states the repo-root `.halt` convention and flags the
  prior `experiments/quay-perpetual-stream/.halt` documentation as wrong — confirmed by `grep`.)
- [x] New selftest fixture: `.halt` at the experiments-scoped path alone → `halt: false` (explicit
  regression guard, not just fixed silently).
  (Audit evidence: `experiments/quay-perpetual-stream/test/select-preflight.test.mjs` line 65,
  "checkHalt: .halt at experiments/quay-perpetual-stream/ path only → {halt: false}
  (wrong-path regression guard)" — re-ran the full file via `scripts/test.sh`, 31/31 pass
  including this case.)

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv N/A, test-floor N/A (method-infra surface),
task-canonical-lifecycle-record, tree-hygiene, worktree-branch-hygiene, audit-independence).
- [x] Landed on `master`, verified via a real `select-preflight.ts` dry run, not asserted.
  (Audit evidence: `git merge-base --is-ancestor 615d4c0 HEAD` confirms landed on `master`;
  real dry run `node --experimental-strip-types select-preflight.ts --json --workspace-root .
  --milestone-counter 0` against the actual repo-root `.halt` sentinel present on disk returned
  `halt: true, haltReason: ".halt sentinel present (empty)"` — i.e. the repo-root path is the one
  actually consulted, as claimed.)
- [x] Because this touches `experiments/quay-perpetual-stream/scripts/*` (driver execution-chain
  files), resolving it must run under human-steered discipline — labeled `human-steered`.
  (Audit evidence: task frontmatter `labels:` includes `human-steered`, confirmed by direct read
  of `tasks/gap-halt-sentinel-path-mismatch.md`.)

## Human verification when exp5 marks this task done
1. Does `restart-readiness-check.sh` now agree with `select-preflight.ts` on where `.halt` lives?
2. Is there a regression-guard test for the wrong-path case?

## Touches

- experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh
- experiments/quay-perpetual-stream/test/select-preflight.test.mjs (or wherever checkHalt's fixtures live)
- CLAUDE.md (already landed, 2026-07-27)

## Execution record

- **Milestone:** M187
- **Iteration count:** 1 (direct commit on `master`, no separate worktree/branch — small
  single-inner-iteration instrument-correction, self-verified: RED/GREEN test run +
  `restart-readiness-check.sh` re-run against the real repo state + full `scripts/test.sh` suite
  green)
- **Realized Δv:** 0 (VT-neutral — instrument-correction, no chart-2 surface cell moves; the real
  value is the halt-path consistency fix + regression guard, not a chart-2-scored capability)
- **Merge commit:** `615d4c0` (already on `master` at ABSORB time — built directly on `master`, no
  merge conflict to resolve)
- **Audit verdict:** NO REFUTATION FOUND (adversarial acceptance audit, session
  `13efe277-45ff-4563-bcfe-fd2c3db3e2a5`, 2026-07-27)
- **Outcome:** `restart-readiness-check.sh` now checks the same repo-root `.halt` path
  `select-preflight.ts`'s `checkHalt()` does (both the `HALT` variable and the previously
  independently-hardcoded git-status exclusion regex), with a regression-guard test pinning the
  wrong-path case to `halt: false` — closes the mismatch `CLAUDE.md` had already documented
  in-place earlier the same day.
