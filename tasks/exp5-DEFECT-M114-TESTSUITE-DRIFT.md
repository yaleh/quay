---
id: exp5-DEFECT-M114-TESTSUITE-DRIFT
title: "defect: 3 pre-existing test-suite drift issues found at M114
  verification (ADR-001 test misplacement, DIR-034 fixture staleness, DIR-025
  <li> assertion staleness)"
status: done
labels:
  - milestone-candidate
  - defect
parent: null
children: []
extra:
  schema: v1
---
## Proposal

While verifying "full suite green" as part of M114 (`exp5-M-TS-MIGRATION` overall program close), the
full non-flaky test suite was run for the first time in a while
(`node --test $(ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')` from `packages/quay`).
Result: 354 tests, 346 pass, **8 fail**. All 8 failures are PRE-EXISTING and unrelated to the TS
migration program (verified by ancestry/git-blame — none were introduced by P0-P4's `.mjs`→`.ts`
renames). They fall into 4 categories; 3 are previously undocumented drift, filed here so they are
not silently dropped (repo's no-silent-drop discipline):

1. **TS2589 type-instantiation-depth (3 failures, `test/ts-typecheck-gate.test.mjs`)** — already
   known/documented (M107/M81/M111/M112 evidence): `packages/quay-github/src/mcp-server.ts` and
   `packages/quay-native/src/mcp-server.ts` each have 2 pre-existing `TS2589` errors from the MCP
   SDK's generic type depth. Not a new finding — no action needed here beyond this pointer.

2. **ADR-001 loadbearing-test-gate misplacement (2 failures, `test/adr-gate.test.mjs` E3 A2 /
   E3 A1/A3)** — `experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.test.mjs`
   and `it0-split-or-commit-check.test.mjs` live **colocated in `scripts/`** (since their creation at
   M66/M67), but ADR-001's enforcement command (`loadbearing-test-gate.sh --tests
   experiments/quay-perpetual-stream/test`) and every OTHER load-bearing script's test file follow the
   convention of living under `experiments/quay-perpetual-stream/test/`. The gate's `hasSiblingTest()`
   only looks in `--tests` dir, so it reports these 2 real (existing, passing) test files as MISSING —
   a real, mechanically-detected drift, not a missing-coverage issue. Fix: move (or symlink) the 2
   `.test.mjs` files from `scripts/` to `test/`, matching every other load-bearing script's convention;
   re-run `loadbearing-test-gate.sh` to confirm 0 fail.

3. **DIR-034 dispatch-record fixture staleness (2 failures, `test/dir032-audit-independence.test.mjs`
   M44 A2/C1)** — the `genuinely-independent.md` fixture predates DIR-034 (M90's dispatch-record
   corroboration requirement): a bare distinct session id with no `--dispatch-record` now fails-closed
   by design.

4. **DIR-025 checklist-rendering `<li>` assertion staleness (1 failure, `test/web-ui-browser.test.mjs`
   QW-002)** — the test asserts `body.includes("<li>")` (bare tag) against a fixture whose only list
   items are `- [x]` checklist items, which always render as `<li class="task-list-item">`.

None of these 3 findings block `exp5-M-TS-MIGRATION`'s own program-level AC2 — they are unrelated to
the migration and predate it.

## Plan
N/A — 3 small independent test/fixture fixes, each fully scoped above; no design doc needed.

## Acceptance Criteria
- [x] Item 2 (ADR-001 misplacement): the 2 test files live under `experiments/quay-perpetual-stream/test/`; `bash experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.sh --scripts experiments/quay-perpetual-stream/scripts --tests experiments/quay-perpetual-stream/test` exits 0.
- [x] Item 3 (DIR-034 fixture staleness): `test/dir032-audit-independence.test.mjs` M44 A2 and C1 PASS against a fixture+args that supply a real corroborating `--dispatch-record`.
- [x] Item 4 (`<li>` assertion staleness): `test/web-ui-browser.test.mjs` QW-002 PASSes without weakening what it actually verifies (checklist rendering still exercised).
- [x] Full suite (`node --test $(ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')` from `packages/quay`) shows only the 3 known pre-existing TS2589 failures remaining (0 fail from items 2-4).

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence).
- [x] All 3 AC items above verified true with pasted command output.
- [x] it0 DoD meta-enforcer passes all clauses.




## Not selected (M115)

Not selected M115 — exp5-DEFECT-M114-AUDIT-SESSION-ID-MECHANISM selected instead (higher leverage: affects every future ABSORB's audit-independence gate, not just test-suite cleanliness). Still a good small exploit pick for a near-future pass.



## Not selected (M116)

Not selected M116 — exp5-M-TS-MIGRATION-P5-A selected instead (capability-growth: real product TS migration work, diversifying value type from the last two governance-integrity/instrument-correction picks M114/M115). Good next pick.

## Resolution

**Closed as a side effect of DIR-059's landed fix (commit `6f183ef`, same session that produced
M116), NOT a separately-selected/dispatched milestone.** DIR-059's primary scope was splitting the
`ts-typecheck` gate per-package + deduping a duplicate `zod` install to fix 3 confirmed host OOM
kills; while root-causing that, its author also fixed the exact 8 failing tests this task
catalogued:

- Items 1 (3x TS2589): eliminated entirely by DIR-059's zod-dedup fix (root `overrides` pinning a
  single `zod@3.25.76`) — the duplicate-zod-driven type-instantiation-depth explosion was the real
  cause, not an unfixable MCP-SDK limitation as previously assumed.
- Item 2 (2x ADR-001 misplacement): DIR-059 found and fixed a DIFFERENT root cause for the same
  observed failure — `makeAdrGate` ran its enforcement command against `process.cwd()` instead of
  the workspace root, breaking any in-process `gate()` caller — plus fixed the stale pre-M107 `.mjs`
  filenames the enforcement commands still referenced (matching `exp5-DEFECT-CONFIG-YML-STALE-MJS-REFS`).
  New copies of the 2 test files were ALSO added directly under `experiments/quay-perpetual-stream/test/`
  (`it0-split-or-commit-check.test.mjs`, `it0-enforcement-with-design-check.test.mjs`) — re-verified
  live this ABSORB (2026-07-23): `loadbearing-test-gate.sh --scripts experiments/quay-perpetual-stream/scripts --tests experiments/quay-perpetual-stream/test` → `PASS: every load-bearing script has a sibling *.test.mjs`.
- Item 3 (2x DIR-034 fixture staleness): fixed directly per DIR-059's commit message ("2x
  dir032-audit-independence.test.mjs: DIR-034 added dispatch-record corroboration but the test was
  never updated to pass `--dispatch-record` against the fixture pair").
- Item 4 (1x `<li>` staleness): fixed directly per DIR-059's commit message ("assertion checked for
  the literal `<li>` substring, made stale by DIR-025's checkbox-rendering").

**Re-verified live this ABSORB (2026-07-23, M116):**
```
$ cd packages/quay && node --test $(ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')
ℹ tests 354
ℹ pass 354
ℹ fail 0
```
354/354 — better than this task's own AC4 bar (which only required the 3 TS2589 failures to remain;
those are now gone too, via DIR-059's independent zod fix). All 4 AC items satisfied.

- resolved_by: DIR-059 (commit `6f183ef`), disposition recorded at M116 ABSORB
- outcome: applied (side-effect closure)
- evidence: `git show 6f183ef`; live re-run pasted above
