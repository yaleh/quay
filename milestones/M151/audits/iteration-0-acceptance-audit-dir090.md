# M151 Iteration 0 Adversarial Acceptance Audit -- DIR-090

**Audit session id:** 28186b2d-f609-457d-8a6e-0b74f410e3be

**Task:** DIR-090 -- Audit Bash timeouts -- 6 occurrences of 2m default timeout
**Charter:** experiments/quay-perpetual-stream/charters/M151-dir090-bash-timeouts.md
**Date:** 2026-07-25
**Auditor:** adversarial-acceptance-audit agent (DIR-017 Step 1)

## Acceptance Criteria verification

### AC 1: All gate scripts invoking `npm install`, `npm test`, or `git clone` have explicit `timeout` >=5m

**VERDICT: CONFIRMED**

Evidence:
- Grep across all `.sh` files under `experiments/quay-perpetual-stream/scripts/` returns zero matches for `npm install`, `npm test`, or `git clone`. The AC is vacuously satisfied for gate scripts (no such scripts invoke the named commands).
- The one gate-referenced script that does invoke `npm install` is `packages/quay/test/delivery-standalone-smoke.sh` (line 29: `npm install --omit=dev --no-audit --no-fund`). Its gate entry in `.quay/gates.yml` (fixed gate `delivery-standalone-smoke`) has `timeoutMs: 300000` (5 minutes).
- TestPass gate `it0-dod-check-tests` (command: `node --test`) has `timeoutMs: 300000` in `.quay/gates.yml`.
- TestPass gate `ts-typecheck` (command: `npx tsc --noEmit`) has `timeoutMs: 300000` in `.quay/gates.yml`.
- The `timeoutMs` value flows through the gate engine properly: `resolveRunnerOptions()` in `packages/quay/src/gate/config/utils.ts` reads `gateConfig.timeoutMs` from the gates.yml entry (lines 30-36), passes it to `runAcceptance()` in `packages/quay/src/gate/acceptance-runner.ts` (line 40: `timeout: timeoutMs`), which enforces it via Node's `execSync` timeout option.
- Unit test B in `packages/quay/test/gate-ergonomics.test.mjs` confirms the wiring: test B [unit] (line 141) verifies that a testPass gate with `timeoutMs: 5000` correctly allows a 300ms sleep command to pass; test B [RED] (line 165) verifies that without a per-gate timeoutMs, a command exceeding the env-provided default properly times out. Both pass (2/2).
- Gate test suite: `packages/quay/test/gate.test.mjs` -- 25/25 PASS.
- ts-typecheck gate tests: `packages/quay/test/ts-typecheck-gate.test.mjs` -- 5/5 PASS.
- Selfcheck: `dod-fixture-selfcheck.sh` -- 17/17 fixtures PASS.

### AC 2: All identified Bash calls in workflow scripts have explicit `timeout` >=5m

**VERDICT: CONFIRMED**

Evidence:
- `.claude/workflows/execute-milestone.js` Build phase IMPLEMENT step now includes a TIMEOUT DISCIPLINE (DIR-090) block at lines 69-74, instructing the build agent:
  ```
  TIMEOUT DISCIPLINE (DIR-090): when using the Bash tool to run long-running commands --
  `npm install`, `npm test`, `npm ci`, `node --test`, `npx`, `git clone`, `git fetch`
  -- you MUST pass `timeout: 300000` (5 minutes) or higher. The Bash tool's default
  is 120s which is insufficient. If a test suite or install takes longer than 5m,
  raise the timeout further. Never run these commands with the Bash tool's implicit
  default timeout.
  ```
- This change is confirmed by the diff in commit `67ff578`:
  ```
  diff --git a/.claude/workflows/execute-milestone.js
  +   TIMEOUT DISCIPLINE (DIR-090): when using the Bash tool ...
  ```
- Other workflow scripts audited:
  - `.claude/workflows/drain-directives.js`: Agent prompts instruct running `node .../drain-scheduler.ts` (fast classification script, not npm/test/git). No identified long-running Bash commands.
  - `.claude/workflows/run-routines.js`: Delegates to the `quay:run-routines` skill. No direct Bash commands.
- The Verify phase agents (ceiling-check, gate-hash, domain-misfit, line-budget, dogfood-evidence) run shell scripts that delegate to node for fast in-process computation -- no npm install/test or git clone.
- The Gate phase agents (vmeta-lag, dashboard-budget, tree-hygiene, worktree-branch-hygiene, split-or-commit) run shell scripts that perform fast checks (grep, git status, etc.) -- no npm install/test or git clone.
- The Land phase agents perform git merge/worktree remove/branch delete operations, which are fast (sub-minute) for this repo's size.

## Definition of Done verification

| DoD item | Verdict | Evidence |
|---|---|---|
| All gate scripts with long-running Bash calls have explicit timeout >=5m | CONFIRMED | Vacuously satisfied for scripts/ dir; gates.yml entries have timeoutMs:300000; gate-ergonomics test B confirms wiring |
| All workflow scripts with long-running Bash calls have explicit timeout >=5m | CONFIRMED | execute-milestone.js Build phase TIMEOUT DISCIPLINE block at lines 69-74, confirmed by commit `67ff578` diff |
| Selfchecks pass for all modified scripts | CONFIRMED | dod-fixture-selfcheck 17/17, gate tests 25/25, ts-typecheck-gate 5/5, gate-ergonomics timeoutMs tests 2/2 |
| AC items independently verified by adversarial audit | CONFIRMED | This audit pass -- AC 1 and AC 2 both confirmed with concrete evidence |

## Mechanical gate (it0-dod-check.sh)

**Result: FAIL (exit code 2)**

```
ERROR: no backlog row found for milestone id 'DIR-090' in /tmp/it0-dod-check-backlog-*.md
ERROR: it0-impl-row-check.sh usage/environment error (exit 2)
```

**Root cause analysis:** Same pre-existing absorb-entry `## Backlog row` first-column clerical mismatch documented in M144 (dashboard line 466), M145 (line 469), M148 (line 472), and M151/DIR-089 (line 476).

The absorb entry `/tmp/m151-absorb-entry.md` uses `| M151 | DIR-090 |` as the first column, but `it0-dod-check.ts` clause 4 invokes `it0-impl-row-check.sh` with the task ID `DIR-090` as the milestone ID argument. The script searches for `^\| DIR-090 \|` (first-column exact match), which fails because the first column is `M151`.

The real `backlog.md` uses `| DIR-090 |` as the first column (verified: `grep 'DIR-090' tasks/backlog.md` returns `| DIR-090 | ...`). The absorb entry template was drafted with the milestone number (`M151`) instead of the task ID (`DIR-090`) as the first column.

This is NOT a DIR-090 implementation defect. The Bash-timeout code changes are correct and confirmed:
- `.quay/gates.yml`: 3 gates get `timeoutMs: 300000`
- `.claude/workflows/execute-milestone.js`: Build phase gets TIMEOUT DISCIPLINE block

The gate failure is a clerical error in the absorb entry template. Fix options:
1. Change absorb entry first column from `M151` to `DIR-090`
2. Change `extra.acceptance` first arg from `DIR-090` to `M151`

Per audit charge clause 3: "Non-zero exit = REFUTED by construction."

## Overall verdict

**REFUTED** -- Mechanical gate `it0-dod-check.sh` exits 2 (non-zero) due to a pre-existing absorb-entry template first-column clerical mismatch (same pattern as M144, M145, M148, M151/DIR-089). The underlying Bash-timeout implementation is correct: both AC items are independently confirmed with concrete evidence (diff inspection, test results, source-code analysis). The gate failure does not indicate a defect in DIR-090's implementation.

Required fix: Align the absorb entry's `## Backlog row` first column with the task ID used in `extra.acceptance` (either change absorb entry column from `M151` to `DIR-090`, or change acceptance first arg from `DIR-090` to `M151`).
