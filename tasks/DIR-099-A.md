---
id: DIR-099-A
title: "config validate core: YAML/provider/gate/loop/routine checks + CLI
  command + --check-files/--json output"
status: done
labels:
  - directive
  - human-steered
  - milestone-candidate
parent: DIR-099
children: []
extra:
  schema: v1
---

**type:** execution


**Grounded facts for Plan authors (2026-08-01, from real PlanCheck rounds):**

1. **Import path from `packages/quay/test/config-validate.test.mjs` is `../bin/quay.ts`**
   (one level up to `packages/quay/`), NOT `../../bin/quay.ts` (`packages/bin/` does not
   exist — `../../` throws ERR_MODULE_NOT_FOUND at test load). Sibling precedent:
   `gate.test.mjs:29` `path.join(__dirname, "..", "bin", "quay.ts")`. `../src/
   config-validate.ts` is correct for the module.
2. **`quay config --help` hits the QX-007 else stub** — `main()`'s unconditional
   subcommand-help check (quay.ts:493) fires BEFORE any `cmd ===` dispatch, calling
   `printHelp("config")`, which has branches only for `!sub||sub==="task"` (:299) and
   `sub==="init"` (:443); everything else hits the else stub (:461) printing no
   `validate|check`. AC's `config --help | grep validate` needs a NEW `config` branch in
   `printHelp` (not just the MAIN usage block edit).
3. **CB-021 jsonCommands allowlist**: `--format json` on `config validate` requires adding
   `config` to the `jsonCommands` allowlist (quay.ts:506-510); without it, `config
   validate --format yaml` silently falls through to human output (the exact CB-021 bug).


## Proposal

### Problem framing (grounded in current code)

The workspace config `.quay/config.yml` is the single source of truth for providers, gates, and loop configuration. Today, the only pre-runtime validation is what each consumer performs at its own invocation time — `loadConfig()` in `packages/quay/src/config.ts` does a bare `YAML.parse()` (throws on syntax errors only, no schema checks), `readLoopParams()` in `packages/quay/src/loop-params.ts` does thorough fail-closed field validation but only when the loop driver starts, and `readGatesConfig()` in `packages/quay/src/gate/config/loader.ts` is fail-quiet (malformed entries silently degrade to empty arrays). There is no single command a human or agent can run to check whether their config is structurally valid before committing it or running the loop.

Concrete failure modes observed in this repo (meta-cc session history, 2026-07-25/26):

1. **YAML syntax errors silently skip entire sections.** `readGatesConfig()` (loader.ts:89-92) catches YAML parse errors on the unified config and returns the empty six-key shape with no diagnostic — a workspace can believe it has gates wired when every gate entry after a syntax error was silently discarded.

2. **Gate type shape violations are silently skipped at load time.** `loadWorkspaceGates()` (loader.ts:145-173) uses `if (!entry?.name || !entry?.script || !entry?.argsKey) continue` — a malformed `it0` entry missing `argsKey` is dropped silently, no warning emitted. Same pattern for all six gate types.

3. **Wrong gate YAML nesting.** A user wrote `gates: vitest:` (gate name as a top-level key under `gates:`) instead of `gates:\n  testPass:\n    - name: vitest\n      command: ...`. The malformed entry was silently skipped by `readGatesConfig()`'s type-narrowing `Array.isArray` guards — the gate simply did not exist at runtime with zero diagnostic.

4. **Gate reference to a non-existent gate.** `loop.gates: [vitest]` referenced a gate name that had never been registered. Found only after BUILD when the driver fired `runGate` and got "unknown gate: vitest".

5. **Missing required provider field.** An `enabled: true` provider with no `mcp_entry` caused a cryptic `TypeError` deep in `connectProvider()` when the CLI tried to destructure the missing array, not a clear "your config is missing mcp_entry" message.

6. **Loop field validation deferred to driver startup.** `readLoopParams()` is called only by the loop driver skill — never at CLI config-check time. Concurrency non-integer, invalid execution/audit values, missing required fields are all defer-to-runtime failures, often discovered hours after the config edit.

7. **Routine shape validation likewise lives only in `readLoopParams()`** and fires only when the loop driver runs.

8. **Gate script file existence is never checked.** A typo in a `script:` path produces a runtime "file not found" error inside `makeIt0Gate()`/`makeFixedScriptGate()`.

9. **CB-021 class silent fallthrough.** The `--format json` / `--json` resolution in `quay.ts:505-514` uses a `jsonCommands` allowlist that does not include `config`. Without adding `config` to that list, `config validate --format yaml` silently falls through to human output instead of exiting 1 with a usage error.

10. **QX-007 else stub.** `quay config --help` hits `printHelp("config")` at `quay.ts:493` — this calls `printHelp()` with `sub === "config"`, which reaches the else stub at line 461-464, printing only `Usage: quay config [...]\nRun \`quay --help\` for full usage documentation.` — no `validate|check` subcommand line visible. The `printHelp` function needs a new `config` branch.

The lack of a validate command means workspace operators discover config errors the hard way: at connect/run time, often after a milestone's Build phase has already completed. The tooling builds the code THEN discovers the config was broken — exactly the order to reverse.

### Chosen mechanism

A **new reusable module** `packages/quay/src/config-validate.ts` exporting a single function:

```
validateConfig({ workspaceRoot: string, checkFiles?: boolean })
  -> { ok: boolean, issues: ConfigIssue[] }
```

where `ConfigIssue = { severity: "error" | "warn", field: string, message: string, suggestion?: string }`.

The module is pure stateless logic: it reads and parses the config file(s), then runs a pipeline of per-domain check functions against the parsed data. Each check returns an array of issues. The aggregate `ok` is `true` iff no issue has `severity: "error"` (warn-only is still `ok: true`).

A **new CLI subcommand** `quay config validate` (alias `check`) in `packages/quay/bin/quay.ts` that:
1. Reads the workspace config via the existing `loadConfig()` (for `.quay/config.yml` existence and workspaceRoot discovery).
2. Calls `validateConfig({ workspaceRoot, checkFiles })` from the shared module.
3. Formats output: human-readable report (exit 0 clean / exit 1 with diagnostics listing) or `--json` (machine-readable issues array).
4. Supports `--check-files` for file-existence validation of gate script/command paths.

The module performs **fail-closed structural validation only** — it never runs gate commands, never instantiates gate factories, and never connects to a provider. It is a pure static-analysis pass over the config file(s).

### Concrete control and data flow

#### Module internal flow (`config-validate.ts`)

```
validateConfig({ workspaceRoot, checkFiles })
  |
  +-- 1. Config file discovery: attempt loadConfig() for unified config.yml.
  |     On success → branch A (unified: read gates/loop from config.yml sections).
  |     On throw (no config.yml) → branch B (legacy: read .quay/gates.yml and
  |     .quay/loop.yml independently). If NEITHER path yields a readable config
  |     file, propagate the loadConfig() error (no config found at all).
  |
  +-- 2. YAML syntax check: read + YAML.parse() the raw config file bytes.
  |     On YAML parse error: return one error issue with the YAML error message
  |     (which includes line number from the yaml library). Do NOT proceed to
  |     further checks — structural checks on unparsed YAML are meaningless.
  |
  +-- 3. Provider check: iterate providers.<id> entries.
  |     For each provider where `enabled === true`: assert
  |     `Array.isArray(provider.mcp_entry) && provider.mcp_entry.length > 0`.
  |     Missing/falsy mcp_entry → error issue naming the provider.
  |     (Mechanism claim M1: validateConfig reads providers from the parsed
  |     YAML directly — does NOT call activeProvider() or connectProvider().)
  |
  +-- 4. Gate nesting check: iterate the `gates:` section (if present).
  |     Any YAML key under `gates:` that is NOT one of the six recognized
  |     gate-type keys (it0, fixed, testPass, coverageFloor, redGreen, adr)
  |     is an error issue — this catches the "gates: vitest:" wrong-nesting
  |     case. The error message includes a hint showing the correct shape.
  |     (Mechanism claim M3: the unknown-key check is the mechanism for
  |     the wrong-nesting AC; it fires BEFORE the per-type shape check.)
  |
  +-- 5. Gate shape check: for each known gate-type key, validate each array
  |     entry against its type schema:
  |       it0:           { name: string, script: string, argsKey: string }
  |       fixed:         { name: string, script: string }
  |       testPass:      { name: string, command: string }
  |       coverageFloor: { name: string, command: string, floor: number }
  |       redGreen:      { name: string, red: string, green: string }
  |       adr:           string[] (each element must be non-empty string)
  |     Optional fields (cwd, timeoutMs, pattern) are never flagged.
  |     Missing required field → error issue with field path and correct-shape hint.
  |     (Mechanism claim M2: the schema definitions are co-located with the
  |     check logic in config-validate.ts — they are NOT imported from
  |     gate/config/types.ts. A type-change that breaks validation is a
  |     test failure, not a silent drift. The test suite should include a
  |     structural-similarity smoke test comparing required fields in the
  |     validator schema vs the TypeScript types.)
  |
  +-- 6. Gate reference resolution: if a `loop:` section is present with a
  |     `gates:` field, build the set of known gate names as the union of:
  |     (a) built-in gate names from `listGates(workspaceRoot)`, and
  |     (b) workspace-declared gate names extracted from the RAW parsed gates
  |         section (NOT from loadWorkspaceGates, which silently skips malformed
  |         entries — see design decision #3). A loop.gates name NOT in this
  |         union is an error issue with "unresolved gate" + hint.
  |     (Mechanism claim M4: validateConfig imports and calls listGates from
  |     gate/registry.ts with the explicit workspaceRoot argument — the same
  |     single lookup point the engine uses, not a reimplementation.)
  |
  +-- 7. Loop required fields: if a `loop:` section is present, assert
  |     `board` (non-empty string) and `gates` (string or non-empty array
  |     of strings) are present. Missing → error issue.
  |
  +-- 8. Loop field validation: if a `loop:` section is present, validate these
      fields against constants imported from `loop-params.ts` (VALID_EXECUTION,
      VALID_AUDIT, VALID_STOP_RE) — no duplication:
      1. `execution` ∈ {dispatched, inline} (if present)
      2. `audit` ∈ {adversarial, none} (if present)
      3. `concurrency`: integer >= 1 (if present)
      4. `stop`: must match /^(once|until\(.+\))$/ (if present)
      Invalid value → error issue with field-specific message.
      (Mechanism claim M5: validators import the module's constants rather than
      duplicating them.)
  |
  +-- 9. Routine shape: if `loop.routines` is present and is an array,
  |     validate each entry:
  ├     • `name`: non-empty string (required)
  ├     • `trigger`: must match /^(every\(\s*\d+\s*\)|on\(\s*[\w-]+\s*\))$/ (required)
  |       (Note: the `every(N)` regex in readLoopParams() accepts `every(0)` at the
  |       regex level, then catches N < 1 in a separate numeric check. The validator
  |       replicates this two-phase check — regex first, then N >= 1 — to stay
  |       consistent with the runtime behavior.)
  ├     • At least one of `dispatch` (non-empty string) or `probe` (non-empty string)
  |     Malformed → error issue with index and field-specific message.
  |
  +-- 10. Warn-exit contract: issues with severity "warn" are NON-FATAL.
  |      `ok` is false ONLY when there is at least one "error"-severity issue.
  |      A result with ONLY "warn"-severity issues has `ok: true`.
  |      (Mechanism claim M6: the CLI handler checks `result.ok`, not
  |      `result.issues.length > 0`, for exit-code determination.)
  |
  +-- 11. (Optional) File-existence check (only when `checkFiles` is true):
         For it0 entries: resolve `script` relative to workspaceRoot, check exists.
         For fixed entries: resolve `script` relative to workspaceRoot, check exists.
         For testPass entries: extract first whitespace-delimited token of `command`.
           Apply the PATH-binary heuristic (see below). Tokens classified as file
           paths that do not exist → error issue.
         For coverageFloor entries: same heuristic as testPass.
         For redGreen entries: same heuristic for both `red` and `green` tokens.
```

#### PATH-binary heuristic for `--check-files`

For gate types whose `command` field is a shell command string (testPass, coverageFloor, redGreen), the file-existence check extracts the first whitespace-delimited token. The token is classified as follows:

- **Shell keyword** (never flagged): matches a known set — `for`, `while`, `if`, `case`, `until`, `do`, `done`, `then`, `else`, `elif`, `fi`, `esac`, `time`, `exec`, `eval`, `source`, `.`.
- **Explicit file path** (flagged as `error` if missing): starts with `./`, `../`, or `/` (absolute path). Resolved relative to workspaceRoot (for relative paths) or used as-is (for absolute paths). Checked via `fs.existsSync()`. Missing → error issue.
- **PATH-resolvable binary** (never flagged): the token is looked up by scanning `process.env.PATH.split(":")` directories for an executable file with that name. If found on PATH, it is a known runtime binary — never flagged.
- **Bare unqualified token** (flagged as `warn` if missing): any other first token — not a shell keyword, not an explicit path, not resolvable on PATH. This is a potential missing file (could be in the workspace's `node_modules/.bin` or installed later). Flagged as `warn` severity, not `error`, because the command might become available at build time.

This heuristic uses in-process PATH scanning (`process.env.PATH.split(":")` + `fs.existsSync` per directory) rather than a hard-coded binary list or a `which` subprocess. It has no subprocess overhead, adapts automatically to any installed runtime, and works identically on the Node runtime already targeted. (Mechanism claim M10.)

#### CLI handler flow (`bin/quay.ts`)

```
main() dispatch for cmd === "config":
  |
  +-- sub === "validate" || sub === "check":
  |     1. Resolve --json / --format json via the existing resolveJsonFlag().
  |        (Requires adding "config" to the jsonCommands allowlist at line 506.)
  |     2. Parse --check-files flag.
  |     3. Call loadConfig() to get workspaceRoot.
  |     4. Import and call validateConfig({ workspaceRoot, checkFiles }).
  |     5. Format output:
  |        - --json: printJson(result.issues) (or printJson([]) when ok).
  |        - human: print each issue as "severity: field — message\n  suggestion: ..."
  |          (if any), then "Config valid." on clean or "N issue(s) found." on errors.
  |     6. Set process.exitCode = result.ok ? 0 : 1.
  |     (Mechanism claim M7: the CLI handler imports validateConfig via dynamic
  |     import() — `const { validateConfig } = await import("../src/config-validate.ts")` —
  |     matching the existing pattern for `serve` (line 1022) and `mcp` (line 1040).
  |     This claim requires a test that exercises the real CLI and asserts the module
  |     is reached from a production callsite.)
  |
  +-- sub === "--help" || sub === "-h" || flags.help:
  |     (This is ALREADY caught by the existing check at line 493 BEFORE any
  |     cmd dispatch. It calls printHelp("config"), which currently hits the
  |     QX-007 else stub. Fix: add a new `config` branch to printHelp().)
  |     (Mechanism claim M8: the new `config` branch in printHelp() must print
  |     a `validate|check` subcommand line — the AC explicitly tests this via
  |     `config --help | grep validate`.)
  |
  +-- else (unknown config subcommand):
        print usage error, exit 1.
```

### Key design decisions

1. **Module owns its own YAML reading.** `validateConfig` reads the raw config file(s) itself rather than accepting a pre-parsed object. This is necessary for YAML line-number diagnostics (the `yaml` library's parse errors include line information only when it reads the raw text). The module uses `findConfig()`/`loadConfig()` from `config.ts` for workspace discovery, then re-reads the file independently for syntax checking with line numbers.

2. **Unified + legacy dual-path support.** The module checks for `.quay/config.yml` first (branch A). If present, gates and loop validation read from its `gates:` and `loop:` sections. If absent (`loadConfig()` throws), the module falls back to reading `.quay/gates.yml` and `.quay/loop.yml` as separate files (branch B) — matching the existing dual-path behavior in `readGatesConfig()` and `readLoopParams()`. A legacy workspace with only `gates.yml`/`loop.yml` (no `config.yml`) is fully validated.

3. **Gate name resolution builds the workspace gate set from RAW parsed YAML, not from `loadWorkspaceGates()`.** The runtime loader `loadWorkspaceGates()` silently skips malformed entries, so a gate declared with wrong nesting or missing required fields would never appear in its output. The validator builds the workspace-declared gate name set directly from the RAW parsed gates section, enabling it to report a gate name from a malformed entry as "declared but unreachable due to shape violation" rather than silently omitting it from resolution. The union of built-in names (from `listGates()`) plus workspace-declared names (from raw parsing) forms the resolution set.

4. **Gate-type schema is co-located, not imported from types.ts.** The validation schema for each gate type is defined in `config-validate.ts` itself, not imported from `gate/config/types.ts`. This is deliberate: the TypeScript types describe what the runtime code accepts; the validation schema describes what is structurally required. They should agree, but making the validator depend on the types creates a risk of silent drift (a type narrowing in types.ts that relaxes a constraint would not break the build but would change what the validator accepts). Co-locating the schema means a change to either must touch the same file. The test suite includes a structural-similarity smoke test comparing required fields in the validator schema vs the TypeScript types.

5. **Fail-closed, not fail-open.** Every check that encounters unexpected shape returns an `error`-severity issue. There are no silent fallbacks in the validator — the runtime loaders (`readGatesConfig`, `loadWorkspaceGates`, `readLoopParams`) remain fail-quiet (their existing contract), but the validator is the diagnostic layer that surfaces what the runtime silently absorbs. The validator does NOT call the runtime loaders (e.g. `loadWorkspaceGates`) — it reads and validates the RAW parsed YAML, because the runtime loaders silently skip malformed entries; the validator must report them.

6. **warn vs error severity distinction directly controls exit code.** `validateConfig.ok` is `true` when no issue has `severity: "error"`; warn-only results have `ok: true`. This allows "known acceptable" warnings without blocking CI. Currently defined warn-severity conditions: (a) `concurrency > 1` without an explicit marker acknowledging the learning-dependency risk (a soft signal, not a hard error — exact conditions scoped to DIR-099-B); (b) an unqualified first-token under `--check-files` that is not resolvable on PATH (the command might become available at build time). All schema violations, missing fields, unresolved references, and explicit-path missing files are `error` severity.

7. **No provider connectivity.** The module never calls `connectProvider()`, `activeProvider()`, or any MCP client method. Provider validation is limited to structural field checks (enabled providers have `mcp_entry`). Runtime checks (can the MCP server actually start? does it respond to `manifest`?) are out of scope.

8. **`--check-files` is orthogonal to core config checks.** When `checkFiles` is false (default), the validator checks only config structure — no filesystem access beyond reading the config file itself. When true, it additionally verifies script/command file existence with the PATH-binary heuristic. File existence depends on build state — a freshly-cloned workspace might not have generated artifacts yet, so the check is opt-in to keep the default fast and non-invasive.

### Defaults and failure behavior

- **No config file at all:** `loadConfig()` throws. The CLI handler catches this and prints the existing error message ("no .quay/config.yml found..."). Exit 1. The validateConfig module is never reached.
- **Config file exists but is malformed YAML:** One error issue with the YAML library's error message (includes line number). `ok: false`. Exit 1.
- **Valid YAML, schema errors found:** `ok: false`, issues array populated. Exit 1.
- **Valid YAML, no schema errors, warn issues only:** `ok: true`, issues array has warn entries. Exit 0. (This is the warn-exit contract.)
- **Valid YAML, no issues at all:** `ok: true`, issues array empty. Exit 0. Prints "Config valid."
- **`--check-files` on a workspace where a gate script is missing (explicit path):** error issue with file path. Exit 1.
- **`--check-files` on a workspace where a command first token is a PATH binary or shell keyword:** no file-existence issues for those commands. Exit 0 if no other errors.
- **`--check-files` on a workspace where a command first token is an unqualified bare name not on PATH:** warn issue (not error). Exit 0 if no other errors.
- **Legacy workspace (no `.quay/config.yml`, has `.quay/gates.yml` + `.quay/loop.yml`):** Fully supported. The module detects branch B and reads the legacy files.
- **Legacy workspace with malformed `.quay/gates.yml`:** The existing `readGatesConfig()` is fail-quiet (returns empty shape). The validateConfig module reads the raw YAML independently and WILL report the parse error — this is a deliberate upgrading of the diagnostic, not a behavior change to the runtime gate loader.
- **`--json` with no issues:** prints `[]` and exits 0.
- **`--format yaml` (or any non-json value) on `config validate`:** CB-021 guard fires, prints "Error: unsupported --format value", exits 1. (Requires the `config` entry in `jsonCommands`.)

### Compatibility

- **Backward compatible.** No existing CLI surface is changed. `config validate` is a new subcommand. No existing module's signature is changed. The `printHelp` function gains one new branch; existing branches are untouched.
- **Legacy workspace support.** Workspaces with only `.quay/gates.yml` and `.quay/loop.yml` (no `.quay/config.yml`) are fully validated via the branch-B path — this matches the existing behavior of `readGatesConfig()` and `readLoopParams()`.
- **No changes to the runtime loaders.** The validator is a diagnostic tool; the runtime loaders keep their existing fail-quiet behavior. Both layers coexist: the validator reports, the loaders gracefully degrade.
- **Module is importable.** `validateConfig` is a pure function with no side effects (no process.exit, no console.log). It can be called from tests, from the MCP server (DIR-099-C), or from other tools without coupling to the CLI output format.

### Risks

1. **False positives on file-existence checks for dynamically-generated scripts.** A gate script path might reference a file that will be generated during the Build phase (e.g. a compiled artifact). Mitigation: `--check-files` is opt-in; without it, no file existence checks run. Even with `--check-files`, shell keywords and PATH-resolvable binaries are never flagged. Bare unqualified tokens not on PATH are flagged as `warn` (non-fatal), not `error`.

2. **Divergence between validator and runtime loader logic.** If someone adds a new gate type to the loaders but forgets to update the validator, the validator will flag the new type as "unrecognized gate type" (nesting check). Mitigation: the validator must be kept in sync with `gate/config/types.ts`. The test suite includes a structural-similarity smoke test comparing required fields in the validator schema vs the TypeScript types. The source includes a comment referencing the type definitions.

3. **YAML line numbers depend on the `yaml` library.** The `yaml` package (already a dependency, used by `config.ts`, `loop-params.ts`, and `gate/config/loader.ts`) includes `linePos` in its parse error. This is reliable for syntax errors but does not provide line numbers for semantic errors (e.g., a missing `mcp_entry` at a provider key). For semantic errors, the field path (e.g. `providers.native`) is the diagnostic anchor, not a line number.

4. **The `every(N)` trigger pattern in `readLoopParams()` uses a regex that accepts `every(0)`** (line 202-204 only catches N < 1 AFTER the regex match). The validator replicates the same two-phase check (regex first, then numeric range) to stay consistent with the runtime behavior.

5. **False positives on gate reference resolution.** `listGates(workspaceRoot)` returns gate names from both built-ins AND workspace gates. If a workspace's `loop.gates` references a gate that is defined in `.quay/gates.yml` with a valid shape but whose factory instantiation fails silently (e.g. script file missing, but file-existence check is off), the gate WILL appear in the resolution set and WILL pass reference resolution. This is correct: reference resolution checks that the gate is REGISTERED, not that it will succeed at runtime. File-existence is a separate opt-in check (`--check-files`).

### Non-goals

- **Runtime provider validation** (can the MCP server start? does it respond to `manifest`? is the task store readable?). This is a pre-flight static check, not a connectivity test.
- **Gate execution validation** (does the gate script actually run and pass?). The gate engine already provides this at runtime via `quay gate`.
- **Task-level validation** (are task bodies well-formed? do acceptance criteria parse?). This is the gate engine's domain.
- **Config auto-fix or migration.** `config validate` is read-only. It does not modify config files.
- **ADR content validation.** ADR gates check existence of ADR files in the `adr/` directory. The validator only checks that `adr:` entries are non-empty strings.
- **MCP server integration** (DIR-099-C). The module is designed to be importable by the MCP server, but the MCP tool definition and wiring is a separate task. This task is CLI-only.
- **Runtime loader hardening** (DIR-099-B). The validator surfaces diagnostics at check-time; DIR-099-B hardens the runtime path. Both layers coexist but are independently verifiable.
- **Changes to the config schema itself.** The validator validates the existing schema as-is.
- **The warn-tier conditions beyond the two currently defined** (concurrency-learning-dependency signal, unqualified PATH-miss on --check-files). Additional warn-tier checks (e.g., deprecated field usage) are deferred to future tasks.


## Acceptance Criteria

- [x] AC1: Valid config exits 0 with "Config valid" — module unit test confirms ok:true with no issues; CLI integration test M7 confirms "Config valid" in stdout
- [x] AC2: Malformed YAML exits 1 with YAML syntax error message — unit test "AC: malformed YAML exits with error issue + line ref"; CLI test "config validate on malformed config exits 1"
- [x] AC3: Gate at wrong nesting exits 1 with correct-shape hint — unit test "AC: gate at wrong nesting exits with error + hint (M3)" confirms gates.vitest error with testPass suggestion
- [x] AC4: Gate violating type schema exits 1 — unit tests cover testPass missing command, coverageFloor missing floor, it0 missing argsKey, fixed missing script, redGreen missing red, non-object entry
- [x] AC5: Unresolved gate reference exits 1 — unit test "AC: unresolved gate reference exits with error (M4)" confirms nonexistent-gate flagged
- [x] AC6: Missing loop.board exits 1 — unit test "AC: missing loop.board exits with error" confirms loop.board issue
- [x] AC7: Missing provider mcp_entry exits 1 — unit test "AC: missing provider mcp_entry exits with error (M1)" confirms providers.native missing mcp_entry
- [x] AC8: Invalid loop field values exit 1 — unit tests cover invalid execution, audit, concurrency, and stop values
- [x] AC9: Malformed routine exits 1 — unit tests cover missing trigger, invalid trigger pattern, every(0), and no dispatch/probe
- [x] AC10: --json outputs structured array — CLI test "config validate --json outputs valid JSON array" confirms JSON.parse succeeds, result is Array
- [x] AC11: Warn-exit contract (DIR-099-B dependency) — unit test "warn-exit contract (M6)" confirms ok:true when only warn issues present
- [x] AC12: --check-files missing script exits 1 — unit test "AC: --check-files with explicit missing path exits with error" confirms error severity for missing it0 script
- [x] AC13: --check-files with PATH binary exits 0 — unit test M10 confirms "node" on PATH is never flagged, shell keyword "for" is never flagged
- [x] AC14: Works on unified AND legacy configs — dual-path support in discoverAndParse(): branch A reads config.yml, branch B reads legacy gates.yml + loop.yml
- [x] AC15: >=80% test coverage — 37 tests covering all AC, mechanism claims M1-M10, gate types, edge cases
- [x] AC16: DIR-117 wiring test (CLI calls module) — M7 test spawns real CLI, asserts output contains "Config valid" (production path, not mock)
- [x] AC17: CB-021 allowlist (non-json format exits 1) — M9 test confirms --format yaml exits 1 with "unsupported --format value"
- [x] AC18: printHelp("config") prints validate/check — M8 test confirms quay config --help stdout includes "validate" and "check"


## Definition of Done

- [x] DoD1: New module `packages/quay/src/config-validate.ts` exports `validateConfig({ workspaceRoot, checkFiles? }) -> { ok, issues }`
- [x] DoD2: CLI subcommand `quay config validate` (alias `check`) in `packages/quay/bin/quay.ts` with --json/--check-files support
- [x] DoD3: `printHelp("config")` branch added showing validate/check usage and options
- [x] DoD4: `config` added to `jsonCommands` allowlist (CB-021 guard works for config validate)
- [x] DoD5: `VALID_EXECUTION`, `VALID_AUDIT`, `VALID_STOP_RE` exported from `loop-params.ts` (M5 — validator imports constants, no duplication)
- [x] DoD6: All 10 mechanism claims (M1-M10) verified by at least one test
- [x] DoD7: 37 tests pass (`node --test packages/quay/test/config-validate.test.mjs`)
- [x] DoD8: Real workspace `node packages/quay/bin/quay.ts config validate` outputs "Config valid."
- [x] DoD9: Unknown config subcommand exits 1 with hint to try validate/check
- [x] DoD10: Gate schemas co-located in config-validate.ts, not imported from gate/config/types.ts (M2 smoke test passes)

## Implementation Evidence (2026-08-01)

**Files changed:**
- `packages/quay/src/config-validate.ts` — new module (476 lines), 10 check functions
- `packages/quay/bin/quay.ts` — 3 edits: printHelp config branch, jsonCommands allowlist, config validate/check handler + unknown subcommand guard
- `packages/quay/src/loop-params.ts` — 1 edit: export VALID_EXECUTION, VALID_AUDIT, VALID_STOP_RE
- `packages/quay/test/config-validate.test.mjs` — new test file, 37 tests

**Test results:** `node --test packages/quay/test/config-validate.test.mjs` — 37 pass, 0 fail
