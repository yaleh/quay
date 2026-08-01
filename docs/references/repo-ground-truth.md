# Repo Ground-Truth Registry (runtime-contract facts)

Seed reference for [[DIR-124-F]] (ADR-020). Each entry is a repo-invariant FACT that
PlanAuthor/PlanCheck must know; versioned/hash-bound per DIR-124-B once the registry is
mechanized. Decisions with rationale live in ADRs (referenced below); this file holds
reference data.

## 1. CLI binary paths

- `packages/quay/bin/quay.ts` is the Core CLI source — there is NO `packages/quay/bin/
  quay.js` and NO build step ("plain ESM Node ≥20, no build", CLAUDE.md). Test harnesses
  spawn `node packages/quay/bin/quay.ts` (acceptance.test.mjs:22 `quayBin`,
  mcp-server.test.mjs:95 `coreBin`). `dist/quay.js` is a gitignored build artifact
  (`packages/quay/scripts/build-dist.mjs`, package-relative). A plan command using
  `quay.js` fails ENOENT.
- `packages/quay-native/bin/quay-native.ts` is the native provider CLI.

## 2. Node `--test --experimental-test-coverage` output format

- Text output prints a TREE with **basename rows only** (e.g.
  `    config-validate.ts | 98.21 | 98.33 | 100.00 | 68-71`) — no directory path, and NO
  `%` after the numeric values (only the column headers carry `%`). A coverage-gate regex
  requiring `\d+%` after the filename deterministically fails even at ≥80%.
- **Child-process coverage merges only on a CLEAN child exit.** A child terminated by
  SIGTERM/SIGKILL contributes ZERO coverage — per-file table is empty. Test teardown must
  use clean exits for coverage assertions.

## 3. Touches matching (preflight `preflightTouchesMismatch`)

- Parenthetical comments after a backticked path (e.g. `.quay/config.yml (this repo's
  own...)`) break the exact-path match — the whole line is treated as the path. Touches
  entries must be clean paths.
- Directory entries (e.g. `packages/quay/src/gate/config/`) do NOT satisfy exact-file
  matching — list the concrete files.
- Content appended AFTER `## Touches` is parsed as Touches entries and can trip
  `touches-overbroad` — grounded facts must live in `## Finding`, never after `## Touches`.

## 4. Provider runtime defaults (validate vs runtime parity)

- **native**: `QUAY_NATIVE_TASKS_DIR`/`tasks_dir` optional — `resolveTasksDir()` defaults
  to repo-root `./tasks` (findRepoRoot then cwd `tasks/`). Missing → warn, not error.
- **github**: `QUAY_GITHUB_REPO` optional — `resolveRepo()` defaults to `yaleh/quay` when
  absent (`(envRepo || "yaleh/quay").split("/")`); the throw fires only for PRESENT-but-
  malformed values (`foo`, `foo/`, `/repo`); empty-string is treated as absent; `a/b/c`
  is ACCEPTED (first two segments). Missing → warn; present-malformed → error.
  (Decision/rationale: see ADR for the check-#9 correction.)

## 5. Shared-module signatures

- `validateConfig({ workspaceRoot, checkFiles }) -> { ok, issues }` — no `json` option, no
  array return; JSON formatting is the CLI surface's job.
- `runAcceptance` has FIVE production call sites (registry.ts:100, gate/factories/{adr,
  fixed-script,it0,red-green}.ts); the invariant is ONE runner DEFINITION
  (acceptance-runner.ts:36) — grep the definition site, never claim a single call site.

## 6. Workflow evidence surfaces

- `journal.jsonl` entries: `{type:"started"|"result", key:"v2:<hash>", agentId[, result]}`
  — no `.label`; typed returns persist in `.result`. `workflows/wf_*.json`
  `workflowProgress[]` carries `{type:"workflow_agent", label, phaseIndex}`; `logs[]`
  carries `log()` output. (See inherited-core.md `evidenceSurface`.)
