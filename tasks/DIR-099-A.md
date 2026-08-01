---
id: DIR-099-A
title: "config validate core: YAML/provider/gate/loop/routine checks + CLI
  command + --check-files/--json output"
status: todo
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

Add the core `quay config validate` (alias `check`) command in
`packages/quay/bin/quay.ts`, backed by a reusable shared module
`packages/quay/src/config-validate.ts` with signature
`validateConfig({ workspaceRoot, checkFiles }) -> { ok, issues }` (JSON formatting is the
CLI surface's job; no `json` option on the module). It performs fail-closed validation of
`.quay/config.yml`:

1. YAML syntax (line number on failure)
2. required provider fields (`enabled` providers must have `mcp_entry`)
3. gate shape (each entry matches its type schema: it0 name+script+argsKey, testPass
   name+command, fixed name+script, coverageFloor name+command+floor, redGreen
   name+red+green, adr non-empty strings)
4. gate reference resolution (loop.gates names resolve to registered gates)
5. gate entry placement (wrong YAML nesting detected)
6. loop required fields (board, gates present)
7. loop field validation (execution ∈ {dispatched,inline}; audit ∈
   {adversarial,none}; concurrency integer ≥1; stop pattern)
8. routine shape (name + trigger + probe/dispatch)

Output modes: human-readable report with file:line refs (exit 0 clean / exit 1 issues),
`--json` (machine-readable issues array), `--check-files` (file existence — see the
grounded facts for the PATH-binary heuristic). First child of the DIR-099 split
(`split-multi-mechanism` finding). No dependencies within the split.

## Chosen mechanism

New `packages/quay/src/config-validate.ts` with `validateConfig({workspaceRoot,
checkFiles})` calling per-domain check functions (YAML, provider, gates, loop, routines),
each returning `{severity, field, message, suggestion?}` issues. CLI `config validate`/
`check` subcommand in `bin/quay.ts` reads the config, calls the module, formats output.
`--check-files` resolves `it0`/`fixed` script paths and — for testPass/coverageFloor —
the command's first token ONLY when it is a plausible workspace-relative path (a PATH
binary / shell keyword like `node`, `npx`, `for` is a NON-file, never flagged; grounded
fact #5).

## Plan

Resolved via the M229 human-steered milestone. The checked Plan lives at
`docs/plans/M229-dir-099-a.md` (DIR-117-B prepared-gate artifact).

## Finding

No pre-runtime validation of `.quay/config.yml` exists. Concrete failure modes from
meta-cc (2026-07-25/26): a malformed `gates: vitest:` entry silently skipped (gate
doesn't exist at runtime), a gate reference to a non-existent gate found only after
BUILD, and loop-section errors caught only when the driver starts. CLI binary is
`packages/quay/bin/quay.ts` (NOT `.js`); Node coverage output prints basename rows with
no `%` after numbers (grounded for the coverage gate).

## Requested action

1. `validateConfig({workspaceRoot, checkFiles}) -> {ok, issues}` module implementing
   checks 1-8 (+ check #10 file-existence when `checkFiles`).
2. `config validate`/`check` subcommand in `bin/quay.ts` (both `--json` and default
   human modes).
3. `--check-files` first-token heuristic: PATH binaries / shell keywords are non-files
   (grounded fact #5).
4. RED/GREEN tests covering checks 1-8 + AC17 (clean workspace with npx/node/for first
   tokens exits 0 under --check-files).

## Acceptance Criteria

- [ ] `quay config validate` on a valid config exits 0 with "Config valid".
- [ ] Malformed YAML → exit 1 with line number.
- [ ] Gate at wrong nesting (e.g. `gates: vitest:`) → exit 1 with correct-shape hint.
- [ ] Gate entry violating its type schema (e.g. `it0` missing `script`/`argsKey`,
  `testPass` missing `command`) → exit 1 with correct-shape hint (check #3 negative,
  distinct from the wrong-nesting AC).
- [ ] loop.gates referencing non-existent gate → exit 1 "unresolved gate" + hint.
- [ ] Missing loop.board → exit 1 specific message.
- [ ] A valid config whose enabled provider is missing `mcp_entry` → exit 1 with a
  message naming the provider and the missing field (check #2).
- [ ] Invalid loop field values (execution outside {dispatched,inline}; audit outside
  {adversarial,none}; concurrency non-integer or < 1; malformed stop pattern) → exit 1
  with a field-specific message (check #7).
- [ ] A malformed routine entry (missing `name`/`trigger`/`probe`/`dispatch` shape) →
  exit 1 with a field-specific message (check #8).
- [ ] `--json` outputs `[{severity, field, message, suggestion?}]` (empty on valid).
- [ ] **Warn-exit contract (upstream of DIR-099-B):** `warn`-severity issues are NON-FATAL
  — `config validate` exits 0 when the only issues are `warn`; only `error` severity
  forces exit 1. DIR-099-B's AC1/AC2/AC7 depend on this, so it is an AC here, not prose.
- [ ] `--check-files` on a missing gate script → exit 1 with file path; a clean workspace
  whose gate commands start with `npx`/`node`/`for` → exit 0 (AC17, the PATH-binary
  negative).
- [ ] Works on unified config.yml (DIR-050) AND legacy gates.yml+loop.yml workspaces.
- [ ] Tests: `packages/quay/test/config-validate.test.mjs` RED/GREEN, >=80% coverage.
- [ ] Wiring (DIR-117 mechanism-claim coverage): a test in `config-validate.test.mjs`
  exercises the real CLI `config validate`/`check` handler in `bin/quay.ts` and asserts
  it calls `validateConfig` imported from `src/config-validate.ts` (spy/mock observed
  invoked), so the shared module is reached from a production callsite — not dead code.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] A real `quay config validate` run on this repo's config exits 0; a malformed
  fixture exits 1 with diagnostics.
- [ ] A fresh independent audit finds no refutation.

## Human verification

1. Does `config validate` catch the meta-cc vitest-gate shape error with a usable hint?

## Touches

- `packages/quay/bin/quay.ts`
- `packages/quay/src/config-validate.ts (new)`
- `packages/quay/test/config-validate.test.mjs (new)`
- `README.md`
- `docs/plans/M229-dir-099-a.md`
