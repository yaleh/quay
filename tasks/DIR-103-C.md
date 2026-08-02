---
id: DIR-103-C
title: "Reproducible acceptance environment: per-provider acceptance_env env
  file + clean-environment contract documentation"
status: ready
labels:
  - directive
  - human-steered
  - milestone-candidate
parent: DIR-103
children: []
extra:
  schema: v1
---
**type:** execution

**CLOSEOUT STATUS (2026-08-02, dev-session-handoff-2026-08-02b item 3):** the per-provider acceptance_env mechanism IS landed (pinAcceptanceEnv/QUAY_ACCEPTANCE_ENV wired; task-status-drift-check confirms 4/4 symbols resolve). Stays **ready**: the ACs are unchecked — they demand REAL GATE-RUN falsification (an acceptance_env gate run reaching the env file's exports, a missing-file run failing closed, MCP- and CLI-side reachability) plus README documentation, which have not been recorded as verified. Remaining: run the falsification tests against the real gate-run path and record them, or promote the ACs a reviewer can prove mechanically.

## Proposal

Give acceptance commands a reproducible baseline environment two ways:

1. **`acceptance_env` per-provider config key**: `.quay/config.yml` may declare a
   per-provider env file that the acceptance runner sources before every acceptance
   command (e.g. `.quay/acceptance.env` with `export PATH=...`). Missing configured file
   fails closed BEFORE the acceptance command runs. Per-provider (AC7): different
   providers can have different env files — resolution happens where the enabled-provider
   id is known, and BOTH real acceptance surfaces must honor it: the CLI (`quay gate` /
   `quay run`, `bin/quay.ts` `pinAcceptanceEnv`) and the MCP `gate_run` handler
   (`packages/quay/src/mcp-handlers.ts`, which already mirrors pinAcceptanceEnv per
   invocation for `QUAY_ACCEPTANCE_CWD`/`QUAY_ACCEPTANCE_TIMEOUT_MS`). No acceptance
   surface may silently ignore `acceptance_env`.
2. **Environment contract documentation**: a README "Acceptance command environment"
   section + `quay gate --help` documenting the clean-shell contract (no .bashrc/.profile
   sourced; PATH is inherited from the invoking process, not a fixed system default — the
   original Proposal's "/usr/bin:/bin" claim was imprecise and would mislead the loop
   driver), default timeout, and cwd defaults.

Third child of the DIR-103 split. Resolves the `QUAY_ACCEPTANCE_ENV` env-var naming
question: the config key is `acceptance_env`; mirror the existing
`QUAY_ACCEPTANCE_CWD`/`QUAY_ACCEPTANCE_TIMEOUT_MS` env-pinning precedent if an env-var
override is wanted, otherwise drop the `QUAY_ACCEPTANCE_ENV` name entirely.

## Chosen mechanism

- Config: `readLoopParams`/config-utils reads `acceptance_env` from the enabled
  provider's block.
- Runner: `runAcceptance()` gains an optional `envFile` — when set, it sources the file
  (or prepends its exports to the child env) before spawning the acceptance command.
  Missing file → fail-closed error before execution.
- Documentation: README section + `quay gate --help` lines.

## Plan

Resolved via milestone M225. Checked Plan: `docs/plans/M225-dir-103-c.md` — manually
revalidated after 4 prepare-milestone attempts exhausted the epoch full-review cap
(reset quota 3/3); the task body (with grounded facts) is authoritative.
## Finding

`packages/quay/src/gate/acceptance-runner.ts:36-44` — `runAcceptance({command,cwd,
timeoutMs})` spawns with stdio captured but discarded (no env, no output return); no env
file path exists. `packages/quay/src/gate/registry.ts:91-102` — the `acceptance` gate fn
receives only `task`, never the config or provider id; per-provider resolution needs the
enabled-provider id known only at the CLI/MCP layer. `packages/quay/src/gate/config/
utils.ts:25-36` — existing `QUAY_ACCEPTANCE_CWD`/`QUAY_ACCEPTANCE_TIMEOUT_MS` env-pinning
precedent exists. The original Proposal's "Default PATH is the system default (typically
/usr/bin:/bin)" is factually wrong — the runner inherits `process.env` from the invoking
process, not a fixed default.

## Requested action

1. Read `acceptance_env` per-provider from `.quay/config.yml` (resolved where the
   enabled-provider id is known — CLI/MCP layer).
2. `runAcceptance()` sources the configured env file before the acceptance command;
   missing file → fail-closed error before execution.
3. Decide the `QUAY_ACCEPTANCE_ENV` naming: either mirror the env-pinning precedent with a
   real env-var override, or remove the name (config key `acceptance_env` is authoritative).
4. README "Acceptance command environment" section + `quay gate --help` documenting the
   clean-shell contract (PATH inherited from invoking process), timeout, cwd defaults.
5. RED/GREEN tests: env file sourced (command sees exported vars); missing file fails
   closed; per-provider resolution; docs grep-able.

## Acceptance Criteria

- [ ] When `acceptance_env` is set, the acceptance command sees the env file's exports
  (real command-visible proof, not asserted).
- [ ] When `acceptance_env` is set but the file does not exist, the runner fails closed
  with a clear error BEFORE executing the acceptance command.
- [ ] `acceptance_env` is per-provider — two providers can have different env files.
- [ ] MCP-side per-provider env reachability is falsified, not asserted: a gate run
  dispatched through the MCP `gate_run` surface sees the configured provider's
  `acceptance_env` file exports (command-visible proof through the MCP surface) —
  `gate_run` must not silently ignore `acceptance_env` while the CLI honors it.
- [ ] CLI-side per-provider env reachability is falsified, not asserted: a gate run
  dispatched through the CLI production surface (`quay gate` / `quay run`, `bin/quay.ts`
  `pinAcceptanceEnv`) sees the configured provider's `acceptance_env` file exports
  (command-visible proof through the CLI surface) — the CLI must not silently ignore
  `acceptance_env` while the MCP `gate_run` honors it.
- [ ] README.md has an "Acceptance command environment" section; `quay gate --help`
  documents the clean-shell contract accurately (PATH inherited from invoking process, NOT
  a fixed system default).
- [ ] The `QUAY_ACCEPTANCE_ENV` naming question is resolved explicitly (env-var override
  implemented following the env-pinning precedent, or the name dropped — never left
  undefined).
- [ ] Tests: >=80% coverage on the new env-file + resolution paths.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] A real acceptance command consumes a configured `acceptance_env` file; a missing
  file fails closed pre-execution.
- [ ] A fresh independent audit finds no refutation.

## Human verification

1. Does a configured `acceptance_env` file actually change the acceptance command's
   environment?
2. Is the README's environment contract accurate (inherited PATH, not a fixed default)?

## Touches

- `packages/quay/src/gate/acceptance-runner.ts`
- `packages/quay/src/gate/registry.ts`
- `packages/quay/src/gate/config/utils.ts`
- `packages/quay/src/gate/config/types.ts`
- `packages/quay/bin/quay.ts`
- `packages/quay/src/mcp-handlers.ts`
- `packages/quay/src/mcp-server.ts`
- `packages/quay/test/acceptance.test.mjs`
- `README.md`
- `packages/quay-native/examples/sample-workspace/.quay/config.yml`
- `docs/plans/M225-dir-103-c.md

**Grounded facts for Plan authors (2026-08-01, from real PlanCheck rounds):**

1. **CLI binary is `packages/quay/bin/quay.ts`**, NOT `quay.js` — the repo has no
   `packages/quay/bin/quay.js` and no build step (CLAUDE.md: "plain ESM Node ≥20, no
   build"). All test harnesses invoke `bin/quay.ts` (acceptance.test.mjs:22 `quayBin`,
   mcp-server.test.mjs:95 `coreBin`). A plan command using `quay.js` fails ENOENT.
2. **`## Touches` has ELEVEN concrete entries** — `packages/quay/src/gate/config/utils.ts`
   and `types.ts` are SEPARATE entries (there is no `gate/config/` subdirectory entry to
   "expand"), plus `docs/plans/M225-dir-103-c.md`. Count is 11, not "ten with expansion".
3. **Stage exit-code discipline**: a full-file `scripts/test.sh packages/quay/test/
   acceptance.test.mjs` cannot exit 0 while per-provider tests T3/T4 still fail (node
   --test exits non-zero on any failing test). A stage that is "partially RED" must expect
   `!= 0` or scope its command to the runner-level tests only — never assert exit 0 on a
   file with known-failing cases.
4. **No circular module import**: `packages/quay/src/mcp-server.ts:51` already imports
   `registerAllHandlers` from `mcp-handlers.ts` (used at :155). Do NOT add a
   `resolveAcceptanceEnvFile` export to mcp-server.ts that mcp-handlers.ts then imports —
   that creates mcp-server → mcp-handlers → mcp-server. Put a shared env-file resolver in a
   neutral module (e.g. gate/config/utils.ts) that both can import, or inline the tiny
   resolution in each caller.
5. **Line-budget arithmetic must be self-consistent**: the "Total" row must equal the sum
   of the per-stage budgets (262 > 255 is a defect the mechanical validator will flag).