---
id: exp5-DEFECT-M114-TESTSUITE-DRIFT
title: "defect: 3 pre-existing test-suite drift issues found at M114
  verification (ADR-001 test misplacement, DIR-034 fixture staleness, DIR-025
  <li> assertion staleness)"
status: todo
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

2. **ADR-001 loadbearing-test-gate misplacement (2 failures, `test/adr-gate.test.mjs` E3 A2 / E3
   A1/A3)** — `experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.test.mjs`
   and `it0-split-or-commit-check.test.mjs` live **colocated in `scripts/`** (since their creation at
   M66/M67), but ADR-001's enforcement command (`loadbearing-test-gate.sh --tests
   experiments/quay-perpetual-stream/test`) and every OTHER load-bearing script's test file follow the
   convention of living under `experiments/quay-perpetual-stream/test/`. The gate's `hasSiblingTest()`
   only looks in `--tests` dir, so it reports these 2 real (existing, passing) test files as MISSING —
   a real, mechanically-detected drift, not a missing-coverage issue. Fix: move (or symlink) the 2
   `.test.mjs` files from `scripts/` to `test/`, matching every other load-bearing script's convention;
   re-run `loadbearing-test-gate.sh` to confirm 0 fail.

3. **DIR-034 dispatch-record fixture staleness (2 failures, `test/dir032-audit-independence.test.mjs`
   M44 A2/C1)** — the `genuinely-independent.md` fixture
   (`experiments/quay-perpetual-stream/fixtures/audit-independence/genuinely-independent.md`) and its
   test predate DIR-034 (M90's dispatch-record corroboration requirement): a bare distinct session id
   with no `--dispatch-record` now fails-closed by design (confirmed: running
   `audit-independence-check.ts` directly against the fixture returns `FAIL: ... NO dispatch-record was
   supplied`). The M44 test asserting this fixture should PASS is now stale — either update the fixture
   to include a corroborating dispatch-record file + pass `--dispatch-record` in the test's args, or
   retitle/re-scope the M44 A2/C1 assertions to reflect DIR-034's tightened contract.

4. **DIR-025 checklist-rendering `<li>` assertion staleness (1 failure, `test/web-ui-browser.test.mjs`
   QW-002)** — predates the TS migration entirely (confirmed: `cd3941b`, the commit that introduced
   `<li class="task-list-item">` checkbox rendering for GFM task-list items, is an ancestor of `a630814`
   /M77, the first TS-migration commit). The test asserts `body.includes("<li>")` (bare tag, no
   attributes) against a fixture body (`VALID_SECTIONS`) whose only list items are `- [x] ...`
   checklist items — which **always** render as `<li class="task-list-item">`, never a bare `<li>`.
   The renderer behavior (DIR-025) is intentional; the test assertion is what's stale. Fix: either
   change the assertion to `includes("<li")` (tag-open, attribute-agnostic) or add a non-checklist
   `- item` bullet to the fixture body so a bare `<li>` is also exercised.

None of these 3 findings block `exp5-M-TS-MIGRATION`'s own program-level AC2 (behavior-preserving
*per TS-migration phase*) — they are unrelated to the migration and predate it. They are filed here
so a future milestone closes them (small, bounded, mechanical fixes).

## Plan
N/A — 3 small independent test/fixture fixes, each fully scoped above; no design doc needed.

## Acceptance Criteria
- [ ] Item 2 (ADR-001 misplacement): the 2 test files live under `experiments/quay-perpetual-stream/test/`; `bash experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.sh --scripts experiments/quay-perpetual-stream/scripts --tests experiments/quay-perpetual-stream/test` exits 0.
- [ ] Item 3 (DIR-034 fixture staleness): `test/dir032-audit-independence.test.mjs` M44 A2 and C1 PASS against a fixture+args that supply a real corroborating `--dispatch-record`.
- [ ] Item 4 (`<li>` assertion staleness): `test/web-ui-browser.test.mjs` QW-002 PASSes without weakening what it actually verifies (checklist rendering still exercised).
- [ ] Full suite (`node --test $(ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')` from `packages/quay`) shows only the 3 known pre-existing TS2589 failures remaining (0 fail from items 2-4).

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence).
- [ ] All 3 AC items above verified true with pasted command output.
- [ ] it0 DoD meta-enforcer passes all clauses.
