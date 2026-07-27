---
id: gap-halt-sentinel-path-mismatch
title: CLAUDE.md/restart-readiness-check.sh incorrectly documented .halt at
  experiments/quay-perpetual-stream/ — the real, product-wide convention
  (select-preflight.ts + plugin/skills/loop-driver/SKILL.md) is
  repo-root-relative
status: todo
labels:
  - gap
  - defect
  - human-steered
  - milestone-candidate
parent: null
children: []
extra: {}
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

## Requested action

1. Fix `restart-readiness-check.sh`'s `HALT="experiments/quay-perpetual-stream/.halt"` → repo-root
   `.halt`, matching the real, live convention.
2. `CLAUDE.md` — DONE (corrected 2026-07-27, see above).
3. Add a selftest fixture to `select-preflight.test.mjs` confirming a `.halt` at the
   `experiments/quay-perpetual-stream/` path does NOT satisfy the check (documents the footgun
   explicitly, guards against future regression/re-confusion).
4. Consider wiring `restart-readiness-check.sh` into `OUTER-LOOP.md`'s actual resume path (it is
   currently a real, correct, but never-invoked script) — same shape as the `delivery-manifest-
   check.ts` orphan found in the same survey; may be worth folding into the broader "audit orphaned
   `*-check.{ts,sh}` scripts" cleanup this survey recommended (see
   `gap-orphaned-check-scripts-not-wired`, filed separately).
5. **Safety hardening, independent of the path question**: `checkHalt()`'s `catch { return {
   halt: false } }` fail-open behavior should be reconsidered — any read failure (permissions,
   transient FS error, wrong path due to a FUTURE version of this same class of bug) currently
   defaults to "not halted, proceed" rather than the safer "cannot confirm safety, treat as
   halted."

## Acceptance Criteria
- [ ] `restart-readiness-check.sh` checks the same repo-root path `select-preflight.ts` does.
- [x] `CLAUDE.md` documents the real, current code's convention — DONE 2026-07-27.
- [ ] New selftest fixture: `.halt` at the experiments-scoped path alone → `halt: false` (explicit
  regression guard, not just fixed silently).

## Definition of Done
- [ ] Landed on `master`, verified via a real `select-preflight.ts` dry run, not asserted.
- [ ] Because this touches `experiments/quay-perpetual-stream/scripts/*` (driver execution-chain
  files), resolving it must run under human-steered discipline.

## Human verification when exp5 marks this task done
1. Does `restart-readiness-check.sh` now agree with `select-preflight.ts` on where `.halt` lives?
2. Is there a regression-guard test for the wrong-path case?

## Touches

- experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh
- experiments/quay-perpetual-stream/test/select-preflight.test.mjs (or wherever checkHalt's fixtures live)
- CLAUDE.md (already landed, 2026-07-27)
