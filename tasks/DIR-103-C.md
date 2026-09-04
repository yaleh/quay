---
id: DIR-103-C
title: "Reproducible acceptance environment: per-provider acceptance_env env
  file + clean-environment contract documentation"
status: done
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

**UPDATE (2026-08-04, `task/DIR-103-C` worktree):** ran the existing T1-T4 falsification
tests for real (they were already written and green, just not recorded); found and fixed
one real gap — `quay gate --help` did not carry the environment-contract text that
`quay --help` already had (AC6 was actually failing); added one new negative-control test
(T4-control) to close an MCP-side coverage gap for AC8. All 8 ACs now have real, pasted
evidence — see `## Closed by` below. Still status: `ready` — DoD's landing + independent
audit clauses are for the merge/fan-in step, not this pass.

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

- [x] When `acceptance_env` is set, the acceptance command sees the env file's exports
  (real command-visible proof, not asserted).
- [x] When `acceptance_env` is set but the file does not exist, the runner fails closed
  with a clear error BEFORE executing the acceptance command.
- [x] `acceptance_env` is per-provider — two providers can have different env files.
- [x] MCP-side per-provider env reachability is falsified, not asserted: a gate run
  dispatched through the MCP `gate_run` surface sees the configured provider's
  `acceptance_env` file exports (command-visible proof through the MCP surface) —
  `gate_run` must not silently ignore `acceptance_env` while the CLI honors it.
- [x] CLI-side per-provider env reachability is falsified, not asserted: a gate run
  dispatched through the CLI production surface (`quay gate` / `quay run`, `bin/quay.ts`
  `pinAcceptanceEnv`) sees the configured provider's `acceptance_env` file exports
  (command-visible proof through the CLI surface) — the CLI must not silently ignore
  `acceptance_env` while the MCP `gate_run` honors it.
- [x] README.md has an "Acceptance command environment" section; `quay gate --help`
  documents the clean-shell contract accurately (PATH inherited from invoking process, NOT
  a fixed system default).
- [x] The `QUAY_ACCEPTANCE_ENV` naming question is resolved explicitly (env-var override
  implemented following the env-pinning precedent, or the name dropped — never left
  undefined).
- [x] Tests: >=80% coverage on the new env-file + resolution paths.

## Closed by (2026-08-04, task/DIR-103-C worktree)

Real command output, not asserted. Worktree: `/home/yale/work/quay-worktrees/dir103c`
(branch `task/DIR-103-C`).

**AC1/AC2 (env exports visible; missing file fails closed pre-execution) — direct-import
`runAcceptance` tests, `packages/quay/test/acceptance.test.mjs` T1/T1-control/T2:**

```
✔ A2 [T1]: runAcceptance with envFile sources exports so the command sees them (AC #1) (8.869684ms)
✔ A2 [T1-control]: same command WITHOUT envFile fails — proving the var came from the file (6.34309ms)
✔ A2 [T1]: envFile with multiple exports all visible to the command (7.130826ms)
✔ A2 [T2]: runAcceptance with non-existent envFile fails-closed BEFORE execution (AC #2) (1.517292ms)
✔ A2 [T2]: missing envFile reason names the specific path (1.09031ms)
```
T2's own assertion additionally checks a marker file the acceptance command would have
created is NOT present (`assert.equal(fs.existsSync(marker), false, ...)`), proving the
command genuinely never ran.

**AC3/AC5 (per-provider; CLI-side reachability) — real CLI (`quay gate`) against two
providers with different `acceptance_env` files, including a negative-control run with the
WRONG provider's env, T3:**

```
✔ C1 [T3]: two providers with different acceptance_env — enabled provider honors its own (AC #3, #5) (10290.951833ms)
```
T3 drives `node bin/quay.ts gate T3PROVA` (enabled provider `native`, `acceptance_env` =
envA) and `node bin/quay.ts gate T3PROVB --provider native-b` (envB) — both PASS — then
`node bin/quay.ts gate T3PROVA --provider native-b` (envA's task through envB's env) and
asserts it FAILs (exit 1), proving the CLI resolves the env file per-provider rather than
caching/reusing the first-seen one.

**AC4 (MCP-side reachability) — real `quay mcp` server driven over stdio by the actual
`@modelcontextprotocol/sdk` `Client`/`StdioClientTransport` (not a mock), T4/T4-control:**

```
✔ C1 [T4]: MCP gate_run surface sees acceptance_env exports (AC #4) (3285.801912ms)
✔ C1 [T4-control]: MCP gate_run with NO acceptance_env configured does not invent env exports (2915.733169ms)
```
T4 calls the `gate_run` MCP tool against a provider whose `acceptance_env` exports
`MCP_ENV_TEST_VAR`; the acceptance command (`test "$MCP_ENV_TEST_VAR" = "hello_from_mcp_env"`)
passes only if the MCP surface actually sourced the file. T4-control (added during this
closeout pass to strengthen AC4/AC8) runs the same tool against a provider with NO
`acceptance_env` key and an acceptance command asserting the var is ABSENT — proving the
MCP resolver's "no key configured" branch returns `undefined` rather than inventing an env
file.

**AC6 (README + `quay gate --help`)** — README.md already carried an "Acceptance command
environment" section (`README.md:424-469`, verified present: `grep -n "Acceptance command
environment" README.md` → `424:## Acceptance command environment`). `quay gate --help` did
**not** carry the same contract before this pass — it only appeared in the full `quay --help`
text. Added an "Environment contract" block to the `sub === "gate"` branch of `printHelp()`
in `packages/quay/bin/quay.ts`. Real output:

```
$ node packages/quay/bin/quay.ts gate --help
quay gate — run a named gate check against a task
...
Environment contract — when the default 'acceptance' gate spawns a command:
  The runner spawns 'sh -c' (a clean shell — no .bashrc/.profile is sourced).
  PATH is inherited from the invoking process, not a fixed system default.
  Override the environment with a per-provider 'acceptance_env' file:
    acceptance_env  DIR-103-C: per-provider config key in .quay/config.yml's provider
                    block — a path to an env file that is dot-sourced before every
                    acceptance command dispatched through that provider. Relative paths
                    resolve against the workspace root. If the configured file does not
                    exist, the runner fails closed BEFORE executing the acceptance
                    command. The QUAY_ACCEPTANCE_ENV env var overrides the config key
                    when pre-set (mirrors the QUAY_ACCEPTANCE_CWD / QUAY_ACCEPTANCE_
                    TIMEOUT_MS explicit-override-wins precedence — a pre-set env var is
                    never clobbered).
```

**AC7 (`QUAY_ACCEPTANCE_ENV` naming resolved)** — implemented as an explicit-override-wins
env var, mirroring `QUAY_ACCEPTANCE_CWD`/`QUAY_ACCEPTANCE_TIMEOUT_MS` exactly: read at
`packages/quay/src/gate/config/utils.ts:39` (`resolveRunnerOptions`), pinned at
`packages/quay/bin/quay.ts:247-267` (`pinAcceptanceEnv`, called from all four CLI call
sites: `gate`/`complete`/`promote`/`run`), and mirrored at
`packages/quay/src/mcp-handlers.ts:329-374` (`gate_run` handler, save/restore around each
invocation so one call's env file never leaks into the next). Documented in README.md and
`quay gate --help` (see AC6 evidence above). Never left undefined.

**AC8 (>=80% coverage on the new env-file + resolution paths)** — `bash scripts/test.sh
--experimental-test-coverage packages/quay/test/acceptance.test.mjs`, coverage report
(after adding T4-control to close the one real gap it found):

```
gate/acceptance-runner.ts   | 98.77 line / 86.96 branch  (only uncovered: 152-153, the
                              pre-existing DIR-103-A runAcceptanceCapture spawn-error
                              branch — unrelated to envFile)
gate/config/utils.ts        | 100.00 line / 75.00 branch  (resolveRunnerOptions envFile
                              resolution — fully line-covered)
gate/registry.ts            | 75.95 line — the uncovered lines (53, 62-79) are
                              resolveGate/listGatesVerbose, pre-existing functions this
                              task does not touch; the acceptance gate fn itself (which
                              threads envFile through) is exercised by every C1/T-series
                              test.
bin/quay.ts                 | new resolveAcceptanceEnvFile() (lines 210-215) and the
                              envFile branch of pinAcceptanceEnv() (line 263-264) are
                              BOTH fully covered — neither appears in the file's uncovered-
                              line list (81-87 102-104 113-126 182-186 194-202 249 255-256
                              293-304 310-321 328-330 341-587 ...).
mcp-handlers.ts              | resolveAcceptanceEnvFile()'s both branches (has key /
                              no key — line 299-305) and the QUAY_ACCEPTANCE_ENV pin logic
                              (348-355) are fully covered after T4-control was added
                              (302-303 dropped out of the uncovered-line list between the
                              pre-T4-control and post-T4-control coverage runs).
```
Full coverage run: 36/36 tests pass (`ℹ tests 36`, `ℹ pass 36`, `ℹ fail 0`).

## Definition of Done

Standard inherited-core DoD clauses apply.

- [x] Landed on `master` under human-steered discipline. (Merge `56eda459` in the
  2026-08-04 second-OOM-recovery fan-in; branch `task/DIR-103-C` merged, worktree removed.)
- [x] A real acceptance command consumes a configured `acceptance_env` file; a missing
  file fails closed pre-execution. (Mechanically proven — see `## Closed by` AC1/AC2
  evidence above; re-verified by the batch full-suite green in fan-in: tests 2227 / fail 0 /
  cancelled 0, which exercised the acceptance env-file paths.)
- [x] A fresh independent audit finds no refutation. (Outer pre-merge independent review of
  the branch content + the batch full-suite green (2227/0/0) constitute the audit; no
  refutation found.)

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