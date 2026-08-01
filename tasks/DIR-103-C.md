---
id: DIR-103-C
title: "Reproducible acceptance environment: per-provider acceptance_env env file + clean-environment contract documentation"
status: todo
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

## Proposal

Give acceptance commands a reproducible baseline environment two ways:

1. **`acceptance_env` per-provider config key**: `.quay/config.yml` may declare a
   per-provider env file that the acceptance runner sources before every acceptance
   command (e.g. `.quay/acceptance.env` with `export PATH=...`). Missing configured file
   fails closed BEFORE the acceptance command runs. Per-provider (AC7): different
   providers can have different env files — resolution happens at the CLI/MCP layer where
   the enabled-provider id is known.
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

N/A — resolved via a human-steered milestone. The resolving milestone authors a checked
`docs/plans/*.md` plan (DIR-117-B prepared-gate artifact) before implementation.

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
- `packages/quay/src/gate/config/` (config-utils / readLoopParams)
- `packages/quay/bin/quay.ts`
- `packages/quay/test/acceptance.test.mjs`
- `README.md`
- `packages/quay-native/examples/sample-workspace/.quay/config.yml`
