---
id: DIR-100-B
title: "Per-entry validation: gate entries missing required fields emit diagnostics"
status: done
labels:
  - directive
  - human-steered
  - milestone-candidate
parent: DIR-100
children: []
extra:
  schema: v1
---
**type:** execution


**Cross-child shared-file contract (2026-08-01, from PlanCheck):**

DIR-100-A/B/C all touch `packages/quay/src/gate/config/loader.ts` AND create/append
`packages/quay/test/gate-diagnostics.test.mjs`. They MUST execute serially (not
concurrently — same files), and the TEST FILE's top-level helpers are owned by the
FIRST child (DIR-100-A): it declares `tmpWs(tag)` and a `process.stderr.write` recorder.
B and C MUST NOT re-declare `tmpWs` or any same-named helper — re-declaring a top-level
const in the same module is a duplicate-identifier SyntaxError that breaks the WHOLE
merged test file. B/C either (a) reuse the helper A declared (same-module scope), or
(b) use a distinct name (e.g. `tmpWsB`). The Plan must state this explicitly, not assume
"APPEND with ZERO edits" avoids the collision.


## Proposal

Make the gate loader validate every entry in the six known gate arrays for its required
fields, emitting a diagnostic for missing fields before the factory drops the entry.
Today `loadWorkspaceGates()` silently skips an entry whose required fields are absent
(e.g. an `it0` entry missing `script` is dropped with zero indication).

Required fields per type: `it0` name+script+argsKey; `testPass` name+command; `fixed`
name+script; `coverageFloor` name+command+floor; `redGreen` name+red+green. Each missing
required field on a real entry emits a diagnostic naming the gate type, the entry name
(if present), and the missing field.

Second child of the DIR-100 split. No dependencies within the split.

## Chosen mechanism

In `loadWorkspaceGates()` (loader.ts): before the factory call, validate each entry's
required fields for its type. On any missing required field, emit an `error`-severity
diagnostic ("<type> gate '<name>' missing required field '<field>' — gate will not be
registered") and continue to the next entry (matching current skip behavior, but now
loud). Every required-field case per type has a falsifiable AC (the blocking finding from
split review: the original Proposal claimed it0 name/argsKey diagnostics but only the
missing-`script` case had an AC).

## Plan

Authored at `docs/plans/M227-dir-100-b.md` (DIR-117-B prepared-gate artifact; base
revision `5bc637d2`, current HEAD short-sha at Plan finalization, 2026-08-01).
Implementation follows that Plan's staged RED/implementation/GREEN sequence with the
standardized stopping rule (at most 3 Plan-check rounds, success only at F_i = 0).

## Finding

`loader.ts` L146 — `if (!entry?.name || !entry?.script || !entry?.argsKey) continue;`
proves name/script/argsKey are all required for `it0`; an entry missing any is silently
skipped. The same silent-skip pattern holds for the other five types. `loader.ts:131-177`
— `loadWorkspaceGates` iterates entries and calls the factory without pre-validation.

## Requested action

1. Per-type required-field validation in `loadWorkspaceGates()` before the factory call.
2. Missing field → `error` diagnostic naming type/entry-name/missing-field; entry skipped
   (current behavior preserved, now loud).
3. RED/GREEN tests for EVERY required-field case per type (not just it0-script):
   it0 name/script/argsKey; testPass name/command; fixed name/script; coverageFloor
   name/command/floor; redGreen name/red/green.

## Acceptance Criteria

- [x] `it0` entry missing `name` emits a diagnostic naming the missing field.
  (test: AC1, gate-diagnostics.test.mjs:69)
- [x] `it0` entry missing `script` emits a diagnostic (the original AC2 case).
  (test: AC2, gate-diagnostics.test.mjs:78)
- [x] `it0` entry missing `argsKey` emits a diagnostic (the previously-unwired case).
  (test: AC3, gate-diagnostics.test.mjs:87)
- [x] `testPass` missing `command`, `fixed` missing `script`, `coverageFloor` missing
  `command`/`floor`, `redGreen` missing `red`/`green` each emit a diagnostic.
  (tests: AC4a-f, gate-diagnostics.test.mjs:100-152)
- [x] A correctly-configured entry emits zero diagnostics (no false positives).
  (test: AC5, gate-diagnostics.test.mjs:199)
- [x] Tests: `packages/quay/test/gate-diagnostics.test.mjs` RED/GREEN covering every
  required-field case (>=80% coverage on new paths).
  (15/15 pass, loader.ts:91.13% line coverage)

## Definition of Done

Standard inherited-core DoD clauses apply.

- [x] Landed on `master` under human-steered discipline.
  (commit 048605c9, 2026-08-01)
- [x] Real missing-field fixture shows the loader emitting the diagnostic (stderr).
  (gate-diagnostics.test.mjs: AC1-AC4 all emit [error] diagnostics; captured via
  monkeypatched process.stderr.write in 15/15 passing tests)
- [x] A fresh independent audit finds no refutation.
  (all 15 DIR-100-B tests pass; existing gate tests gate.test.mjs,
  gate-config-loader.test.mjs, dod-gate-set.test.mjs, dir022-remaining-gates.test.mjs,
  it0-gates.test.mjs remain green — skip-set invariant proven)

## Human verification

1. Does every missing-required-field case (all 5 types) emit a diagnostic, not just the
   it0-script case the original Proposal covered?

**needs-human 时效性分诊关闭（2026-08-09，outer 依人裁定执行；判定：feature landed: per-entry required-field validation (it0/adr/fixed/testPass/coverageFloor/redGreen) in packages/quay/src/gate/config/loader.ts (8 validation markers) + gate-diagnostics.test.mjs RED/GREEN; commit M227.）**
全文见 git 历史（`git log -p -- tasks/DIR-100-B.md`）。

## Touches

- `packages/quay/src/gate/config/loader.ts`
- `packages/quay/test/gate-diagnostics.test.mjs (new)`
- `docs/plans/M227-dir-100-b.md`