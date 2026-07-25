# M151 Iteration 1 Report

**Task:** DIR-090 -- Audit Bash timeouts -- 6 occurrences of 2m default timeout
**Date:** 2026-07-25
**Outcome:** done

## What was done

Audited all gate scripts and workflow scripts for Bash calls invoking long-running commands without explicit timeout. Added explicit `timeout` parameters >=5m (300000ms) to all identified locations.

## Changes

### 1. `.quay/gates.yml` -- Added `timeoutMs: 300000` to three gates

- **`delivery-standalone-smoke`** (fixed gate): The script `packages/quay/test/delivery-standalone-smoke.sh` calls `npm pack` and `npm install` internally. Without an explicit `timeoutMs`, the gate engine's acceptance runner defaults to 60000ms, which is insufficient for npm operations.
- **`it0-dod-check-tests`** (testPass gate): Runs `node --test experiments/quay-perpetual-stream/test/it0-dod-check.test.mjs` -- the Node test runner can exceed 60s on large suites.
- **`ts-typecheck`** (testPass gate): Runs `npx tsc --noEmit` across all packages -- TypeScript compilation across 4 packages can easily exceed 60s and was routinely timing out.

### 2. `.claude/workflows/execute-milestone.js` -- Added TIMEOUT DISCIPLINE to Build phase prompt

Added a TIMEOUT DISCIPLINE (DIR-090) block to the Build phase IMPLEMENT step, instructing the build agent to pass `timeout: 300000` (5 minutes) or higher when using the Bash tool for long-running commands: `npm install`, `npm test`, `npm ci`, `node --test`, `npx`, `git clone`, `git fetch`.

### 3. Audit findings

Comprehensive audit of `experiments/quay-perpetual-stream/scripts/*.sh` and `experiments/quay-perpetual-stream/scripts/*.ts`:

- **No gate shell scripts invoke `npm install`, `npm test`, or `git clone` internally.** All `.sh` scripts in this directory are thin wrappers delegating to `.ts`/`.mjs` modules via `node`, which complete in under a second.
- **No gate TypeScript modules invoke npm or git internally.** The `.ts`/`.mjs` modules perform in-process computation (JSON parsing, markdown analysis, file checks).
- **The primary timeout risks are:**
  - Gates registered in `.quay/gates.yml` that run shell commands via the gate engine's acceptance runner (60s default timeout)
  - Build agents dispatched by `.claude/workflows/execute-milestone.js` that invoke `npm install`, `npm test`, or `node --test` via the Bash tool (120s default timeout)

## Done-when verification

1. **All gate scripts invoking `npm install`, `npm test`, or `git clone` have explicit `timeout` >=5m.** -- DONE (vacuously satisfied: no gate scripts in `experiments/quay-perpetual-stream/scripts/` invoke these commands; the one gate-referenced script that does (`delivery-standalone-smoke.sh`) has `timeoutMs: 300000` in its gates.yml entry)
2. **All workflow scripts with long-running Bash calls have explicit `timeout` >=5m.** -- DONE (`execute-milestone.js` Build phase prompt now includes an explicit TIMEOUT DISCIPLINE instruction)

## Test results

- `packages/quay/test/gate.test.mjs`: 25/25 PASS
- `packages/quay/test/ts-typecheck-gate.test.mjs`: 5/5 PASS (includes test B [unit] that explicitly verifies `loadWorkspaceGates` wires a `testPass` gate's `timeoutMs`)
- `packages/quay/test/gate-ergonomics.test.mjs`: 13/13 PASS
- `packages/quay/test/dir022-remaining-gates.test.mjs`: 25/25 PASS (includes vmeta-lag, dogfood-evidence, line-budget gates)
- `packages/quay/test/adr-gate.test.mjs`: 11/11 PASS
- `quay gate --list`: all 20 gates registered successfully
