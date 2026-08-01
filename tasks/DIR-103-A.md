---
id: DIR-103-A
title: "CLI dry-run: quay gate --dry-run <task-id> executes the acceptance
  command without recording a GateEvent or mutating status"
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


**Grounded facts for Plan authors (2026-08-01, from real PlanCheck round findings):**

1. **`parseFlags` greedily consumes a flag's value** — `quay gate --dry-run <task-id>`
   (flag-first) parses to `{flags:{dry-run:"<task-id>"}, id:undefined}` → the gate
   branch's `if (!id)` emits the "missing required <task-id>" usage error. Only
   id-first `gate <id> --dry-run` works today. The implementation MUST make `--dry-run`/
   `-n` a **non-value-taking boolean flag** (a known-boolean-flags set in `parseFlags`),
   not just a `-n`→`--dry-run` token rewrite — otherwise every test block and the
   real-dispatch proof use a form the CLI cannot parse.
2. **`quay gate --help` routes to a generic stub** (`printHelp("gate")`'s else-branch,
   quay.ts:463; dispatch :493) that prints only "Usage: quay gate [...] / Run
   `quay --help`...". The detailed usage line (:313) and flag-description block
   (:385-397) render only under top-level `quay --help`. AC4 (`gate --help` lists
   `--dry-run`) therefore requires adding a gate-specific flag-list rendering to
   `printHelp`'s gate branch (or a help entry in the else-stub).
3. **CLI binary path is `packages/quay/bin/quay.ts`**, NOT `quay.js` — no
   `packages/quay/bin/quay.js` exists (only the gitignored `dist/quay.js` build
   artifact, built by `packages/quay/scripts/build-dist.mjs`, package-relative — NOT a
   repo-root `scripts/build-dist.mjs`). Test-suite convention: `node
   packages/quay/bin/quay.ts ...` (acceptance.test.mjs:29, gate.test.mjs:29).
4. **`quay task get <id>` does NOT exist** — valid task subcommands are
   `list|view|create|edit|check` only; `task get` prints usage and exits 1. Use
   `task view <id> --json` (real) or read the native task file frontmatter for a
   task-status assertion.


## Proposal

Add `--dry-run` to `quay gate <task-id>` (NOT `quay run` — the original Proposal's
`quay run --dry-run DIR-NNN` contradicts the existing verb-less board-scan driver that
takes no positional id; the correct surface is the gate command, which already accepts a
`<task-id>` plus `--cwd`/`--timeout`).

`quay gate --dry-run <task-id>` executes `task.extra.acceptance` in the EXACT runner
environment a real gate run would use (same cwd, same timeout, same clean env), prints
stdout/stderr + exit code, but:
- does NOT append a GateEvent to the gate-event log;
- does NOT mutate task status (the safety invariant the original Proposal omitted —
  a dry-run must leave `status` untouched, not just skip the GateEvent).

This is the first child of the DIR-103 split (5-mechanism split-recommended finding).
First independently landable mechanism; no dependencies within the split.

## Chosen mechanism

Extend the `gate` command's flag parsing to accept `--dry-run` (short `-n`): BOTH
spellings MUST be registered as NON-value-taking boolean flags in `parseFlags`'
known-boolean-flags set, so `-n` is parsed as a flag there (never a gate-local
`-n`→`--dry-run` token rewrite, never left to fall through to `positional` where it
would be misread as the task id). When set,
the gate runner resolves the same runner options a real run would use (same cwd, same
timeout, via `resolveRunnerOptions`), spawns the acceptance command DIRECTLY with its own
stdout/stderr capture (a small sibling helper mirroring `coverage-floor`'s
`spawnSyncCapture`), prints stdout/stderr + exit code to the terminal, and returns
WITHOUT calling the gate-event store or the lifecycle status writer. It deliberately does
NOT go through `runAcceptance()`: `AcceptanceResult` reports only
{ok, reason, code, signal, timedOut} and discards stdout/stderr, and the codebase has
explicitly chosen not to change that return shape (coverage-floor.ts keeps its output
capture as "a tiny sibling rather than changing `runAcceptance`'s return shape"). Surfacing
the command's output is the whole point of a dry-run, so the dry-run branch captures it
directly. The dry-run result is not recorded anywhere durable; its only observable effect
is the printed output and the process exit code. The CLI's own process exit code mirrors
the acceptance command's code (`process.exitCode = r.code ?? 1`): 0 when the command
exits 0, non-zero (the command's code, or 1) when it fails.

`quay gate --help` documents `--dry-run`.

## Plan

Resolved via milestone M223. Checked Plan: `docs/plans/M223-dir-103-a.md` — manually
revalidated after 3 prepare-milestone attempts exhausted the epoch full-review cap
(reset quota 3/3); the task body (with grounded facts) is authoritative. 7 mechanical
stages, all 8 AC indices mapped (AC3 `-n` short-flag coverage added).
## Finding

`packages/quay/bin/quay.ts:1256-1299` — the `run` branch documents "NO positional id:
run scans the board itself" and parses only flags; a positional `DIR-NNN` is dropped by
`parseFlags`. The natural surface is `quay gate --dry-run <id>` (`gate` already takes
`<task-id>` plus `--cwd`/`--timeout` at quay.ts:313/385-397). No `--dry-run` exists on
any gate surface today. `packages/quay/src/gate/lifecycle.ts:119-136` — `runComplete`
runs the acceptance gate then writes `status: done`; a dry-run that reuses that path
without an explicit no-write guard would mutate the task. The safety invariant must be
asserted, not assumed.

## Requested action

1. Add `--dry-run`/`-n` to the `quay gate <task-id>` flag set, both registered as
   non-value-taking boolean flags in `parseFlags`' known-boolean-flags set (never a
   gate-local token rewrite), so `-n` is parsed as a flag and never misread as the
   task id.
2. When set: spawn the acceptance command directly with its own stdout/stderr capture,
   using the same resolved cwd/timeout as a real run (NOT via `runAcceptance()`, whose
   result carries no output text), print stdout/stderr + exit code and mirror that code
   in the CLI's own `process.exitCode` (`process.exitCode = r.code ?? 1`), do NOT append
   a GateEvent, do NOT write any lifecycle status field.
3. Document `--dry-run` in `quay gate --help`.
4. RED/GREEN tests: dry-run executes the command, prints result, appends zero GateEvents
   (`gate-log` empty), leaves `status` unchanged; a real `gate <id>` afterwards still
   behaves byte-identically.

## Acceptance Criteria

- [ ] `quay gate --dry-run <task-id>` runs `task.extra.acceptance` with the same
  cwd/timeout/env as a real gate run and prints stdout/stderr + exit code.
- [ ] `quay gate --dry-run <task-id>` mirrors the acceptance command's exit code in the
  CLI's own `process.exitCode` (`process.exitCode = r.code ?? 1`): 0 when the command
  exits 0, non-zero (the command's code, or 1) when it fails.
- [ ] `quay gate -n <task-id>` behaves identically to `quay gate --dry-run <task-id>`
  (`-n` is parsed as a non-value-taking boolean flag, never misread as the task id).
- [ ] `quay gate --dry-run <task-id>` appends ZERO GateEvents (gate-event log unchanged —
  real before/after, not asserted).
- [ ] `quay gate --dry-run <task-id>` leaves the task's `status` field unchanged (a
  status-writing fixture task — a `ready` task, since `runComplete` at
  `lifecycle.ts:124` refuses a `todo` task via `illegal transition` at :131-133, so a
  `todo` fixture would never be flipped and would not test the invariant — stays
  `ready`, never `done`).
- [ ] `quay gate --help` lists `--dry-run`.
- [ ] `quay gate <task-id>` (no dry-run) is byte-identical in behavior to pre-change
  (golden-replay).
- [ ] Tests: `packages/quay/test/acceptance.test.mjs` gains RED/GREEN dry-run blocks
  (>=80% coverage on new paths).

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] A real `quay gate --dry-run` dispatch shows the command executed, exit code
  surfaced, zero GateEvents appended, status untouched.
- [ ] A fresh independent audit finds no refutation.

## Human verification

1. Does `quay gate --dry-run <id>` leave both the GateEvent log and task status untouched?
2. Is `--dry-run` on the `gate` surface (not the verb-less `run` board-scan driver)?

## Touches

- `packages/quay/bin/quay.ts`
- `packages/quay/src/gate/acceptance-runner.ts`
- `packages/quay/test/acceptance.test.mjs`
- `docs/plans/M223-dir-103-a.md`