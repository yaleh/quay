---
id: DIR-124-A1a
title: Stage-event schema v1 module (workflow-event-schema.mjs)
status: done
labels:
  - directive
  - milestone-candidate
parent: DIR-124-A1
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

Split from DIR-124-A1 (3 independently landable mechanisms). This child owns the **canonical schema module** — the first-class home of the v1 stage-event schema that every downstream consumer (A1's workflow instrumentation, A2's golden replay corpus, A5's baseline metrics, DIR-124-B's stage scheduler, DIR-124-C's pipeline reorder, DIR-124-E's resource-aware scheduling) imports or consumes as its single source of truth for event shape. The schema is never embedded in an emission script or duplicated in workflow files.

### Problem framing (grounded in current repository state, 2026-08-01)

The two milestone-workflow files at HEAD — `execute-milestone.js` (1257 lines) and `prepare-milestone.js` (1565 lines) — drive the full milestone lifecycle from SELECT through Land. Between them they define multiple phase boundaries, each demarcated by a DSL `phase('Name')` call: `phase('Verify')` at execute-milestone.js line 66, `phase('Prepared')` at line 234, `phase('Build')` at line 389, `phase('Build-Evidence')` at line 501, `phase('Audit')` at line 719, `phase('Gate')` at line 817, `phase('Reconcile')` at line 919, `phase('Land')` at line 961; plus `phase('Admission')` at prepare-milestone.js line 164, and Preflight / ProposalAuthors / Adjudicate / ProposalReview / PlanAuthor / PlanCheck / Receipt boundaries within prepare-milestone.js. Byte-identical mirrors exist at `plugin/workflows/` (confirmed by `diff` exit 0 at HEAD, commit `059b5b16`).

Yet no canonical stage-event schema exists anywhere in the repository. Confirmed by grep: zero hits for `workflow-event-schema`, `recordStageEvent`, or `stage-event` outside DIR-124 task bodies. The `.workflow-events/` directory does not exist. The workflow DSL's `meta.phases[]` metadata block is declaration-only — it describes phases to the runtime harness but produces no runtime event trail. The runner's own `log()` calls are unstructured diagnostic strings.

Existing telemetry is partial and purpose-specific, each with its own schema, storage path, and commit policy:

- **M207 `_phaseTimings`** in `prepare-milestone.js` accumulates per-boundary timing spans, but it is prepare-workflow-only, agent-mediated (clock values from lease-renewal CLI responses, not JS-emitted `Date.now()`), carries only a partial field set (phase name, round, startedAtMs, endedAtMs), and does not cover `execute-milestone.js` at all.
- **`proposal-convergence.ts`** writes committed telemetry to `milestones/prepare-telemetry/` (git-committed JSON). Its schema serves cross-generation resume decisions, not stage lifecycle observability.
- **Gate events** at `.quay/gate-events.jsonl` (gitignored) serve the gate engine's immutable append-only log — a different purpose, different schema, different storage path, different consumers.

Without a canonical stage-event schema, every downstream consumer must invent its own format or parse unstructured `log()` output:

- **A1b** (emission instrumentation) needs a schema to validate events at emit time.
- **A2** (golden replay corpus) needs a schema to validate and parse event logs for replay assertions.
- **A5** (workflow-baseline-metrics) needs a schema to mechanically derive 10 crystallization metrics from event streams.
- **DIR-124-B** (stage journal + migration) needs a versioned, importable schema for its `migrateDir124AEvent(event)` adapter.

Each of these consumers would otherwise copy-paste field definitions from the parent task's prose description, reproducing the exact fragmentation this child prevents. The split review's `no-schema-home` finding explicitly forbids this: the schema must live in a first-class module that downstream code can import, validate against, and extend.

**WIRING-CLAIM (A1a-SCHEMA-HOME):** `experiments/quay-perpetual-stream/scripts/workflow-event-schema.mjs` is the single canonical home of the stage-event schema v1 — the schema is never embedded in an emission script, duplicated in workflow files, or copy-pasted by downstream consumers.

### Chosen mechanism

A single canonical `workflow-event-schema.mjs` module (Node ESM, zero npm dependencies — using only `node:fs`, `node:path`, `node:readline`, and `node:child_process` from the standard library) as the **first-class home** of the v1 stage-event schema, exporting:

1. **`SCHEMA_VERSION = "1"`** — explicit version marker for DIR-124-B's `migrateDir124AEvent(event)` adapter.
2. **`VALID_STAGES` / `VALID_OUTCOMES` / `VALID_WAIT_REASONS` / `VALID_ISOLATION_MODES` / `VALID_DISPATCH_MODES`** — enumerated value sets used by `validateEvent()` and importable by downstream consumers (A2 replay assertions, A5 metrics field coverage) so they reference canonical names rather than hard-coding string literals.
3. **`StageEvent` type** — JSDoc-annotated type definition for the v1 event object shape (20 fields, see table below).
4. **`validateEvent(obj, lineNumber?)` → `{ok: true, event}` | `{ok: false, error: string, lineNumber?: number}`** — structural validation: required fields present, types correct (string/number/array/null), value constraints (stage is one of the known names, outcome is one of the known values when non-null, timing sub-fields numeric, observedWrites is array, attempt is number). Fail-soft: returns structured result, never throws. Unknown additional properties are allowed (forward-compat for v2 extension by DIR-124-B).
5. **`parseEventStream(jsonlPath)` → `AsyncIterator<{ok: true, event} | {ok: false, error: string, lineNumber: number}>`** — stream reader using `node:readline` over a JSONL file, with per-line `JSON.parse` + `validateEvent`. Malformed lines (bad JSON, missing fields, invalid stage) produce `{ok: false, error, lineNumber}` in the stream — never crash, never abort iteration. Empty lines and whitespace-only lines are skipped silently. The async iterator interface (`for await (const result of parseEventStream(path))`) integrates naturally with Node.js stream processing and allows early termination by the consumer. File reading is line-by-line — never loads the full file into memory, handling event logs of arbitrary length (months of accumulated milestones).
6. **`emitEvent(event)` → `string`** — deterministic JSON serialization: `JSON.stringify(event, Object.keys(event).sort())` produces single-line output with sorted keys and no extra whitespace, no trailing newline. Two calls with the same event object produce byte-identical strings, enabling mechanical diff comparison of event streams (A2's golden replay assertions depend on this). This function is pure — it returns a string, does NOT write to disk (the caller owns I/O).
7. **CLI surface** (invoked via `node --no-warnings workflow-event-schema.mjs <mode>`, re-implementing the established `isDirectEntry`/`parseArgs` pattern (originating in `gate-script-base.ts`; the `.mjs` module re-implements rather than imports from that `.ts` source, avoiding `--experimental-strip-types` overhead)):
   - `--validate <file>` — reads a JSONL file, validates every line via `parseEventStream`, prints a summary (total lines, valid count, invalid count) to stdout, writes per-line errors to stderr. Exit 0 if all lines valid, exit 1 if any validation failure.
   - `--selftest` — runs an internal self-test: constructs a minimal valid event, round-trips through `emitEvent` → `JSON.parse` → `validateEvent`, validates all VALID_STAGES/VALID_OUTCOMES value ranges, checks that missing-required-field events are rejected, checks that invalid-stage events are rejected. Prints a `{passed, failed, details}` summary to stdout. Exit 0 on all pass, exit 1 on any failure with diagnostic to stderr. This is the same pattern `build-evidence-manifest.ts --selftest` uses: a built-in smoke test that any agent or human can run without setting up test fixtures.
   - `--json` — reads a single JSON object from stdin, validates it as a StageEvent via `validateEvent`, prints `{ok, error?}` to stdout. Exit 0 on valid, exit 1 on invalid.
   - `--emit-event '<json>'` — parses the JSON argument, validates it via `validateEvent`, and on success appends one JSON line to the per-run event log at `<repoRoot>/.workflow-events/<runId>.jsonl` (the `runId` is derived from the event's own `runId` field — the CALLER injects it). Creates `.workflow-events/` directory if missing. On validation failure, writes error to stderr and exits 0 (fail-soft — the event log is a best-effort observability channel, never a gate). The `_emitStageEvent` helper in A1b dispatches this via the established workflow-to-TypeScript dispatch pattern: `node --no-warnings experiments/quay-perpetual-stream/scripts/workflow-event-schema.mjs --emit-event '<json>'`.
   - No args / `--help` — prints usage and exits 0 (module loaded for import only; no-op).

Byte-identical mirror at `plugin/scripts/workflow-event-schema.mjs`.

**WIRING-CLAIM (A1a-MIRROR):** Both copies of `workflow-event-schema.mjs` (`experiments/` and `plugin/`) are byte-identical at Land; a mirror-diff `diff` check (same pattern the existing workflow mirrors use) passes at Land.

**WIRING-CLAIM (A1a-IMPORT):** Downstream consumers (A2, A5, B) import from the schema module via standard ESM `import { SCHEMA_VERSION, validateEvent, parseEventStream, emitEvent } from '../scripts/workflow-event-schema.mjs'`. The module is a plain `.mjs` file with zero transpilation — `node` loads it directly.

**WIRING-CLAIM (A1a-DUAL-SURFACE):** The schema module supports TWO consumption modes: (a) direct `import` for downstream `.ts`/`.mjs` modules that run in a Node.js context with real module resolution; (b) CLI `--emit-event` invocation via `node --no-warnings` for workflow JS files where the DSL has no `import` capability (documented constraint at execute-milestone.js lines 23-25). Both modes exercise the same `validateEvent` function — the CLI mode is a thin adapter over the exported API, not a separate implementation.

**WIRING-CLAIM (A1a-DISPATCH-PATTERN):** The CLI `--emit-event` mode follows the established workflow-to-TypeScript dispatch pattern already used by `prepare-admission-check.ts` (prepare-milestone.js line 171), `milestone-worktree.ts` (execute-milestone.js lines 398-399), `composite-reconcile.ts` (execute-milestone.js line 940), `composite-preflight.ts`, and `proposal-convergence.ts` — the `node --no-warnings <script> <flags>` command invoked via the workflow's `agent()` primitive.

#### Schema shape (v1 — 20 fields)

Each v1 StageEvent object carries:

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `"1"` | Explicit version marker |
| `runId` | string | Run identifier: `M<NN>` or `prepare-M<NN>` |
| `candidateId` | string | `M<NN>-<taskId>` candidate identifier |
| `taskId` | string | Primary task id |
| `stage` | string | One of the known stage names (see VALID_STAGES) |
| `attempt` | number | Attempt ordinal (0-based) |
| `timing` | object | `{queuedAtMs, startedAtMs, endedAtMs}` — wall-clock timestamps (`endedAtMs` null for start events; any field may be null if unknown) |
| `agentLabel` | string | The `label` field of the agent dispatch for this stage, or `"workflow-runner"` for pre-agent boundaries |
| `commandIdentity` | string\|null | Command or agent prompt label executed at this stage |
| `executionCwd` | string | Working directory at stage entry |
| `worktreePath` | string\|null | Populated from `_isolationPlan.worktreeRel` under worktree isolation; null otherwise |
| `baseCommit` | string\|null | Git commit SHA at stage entry |
| `candidateCommit` | string\|null | Git commit SHA at stage exit (populated by Build/Land) |
| `outcome` | `"done"` \| `"needs-human"` \| `"skipped"` \| `"error"` \| null | null for start-of-stage events; populated for end-of-stage events |
| `waitReason` | string\|null | `"admission-contention"` \| `"cache-hit"` \| `"prepared-blocked"` \| null |
| `resourceClaim` | string\|null | Lease fencing token (populated at Admission; null elsewhere) |
| `observedWrites` | string[] | File paths written during this stage (from `git diff --name-only`) |
| `isolationMode` | `"worktree"` \| null | Whether worktree isolation was active |
| `dispatchMode` | `"serial"` \| `"concurrent"` \| null | Dispatch mode; null for prepare stages |
| `recordedAtMs` | number | `Date.now()` at the moment the event object was created |

All 20 fields are required to be present (value may be null where indicated). `validateEvent` checks presence of every field, type correctness, and enumerated-value membership for constrained fields.

### Concrete control and data flow

```
                    workflow-event-schema.mjs
                    ┌──────────────────────────┐
                    │ SCHEMA_VERSION = "1"     │
                    │ StageEvent (JSDoc type)  │
                    │ VALID_STAGES / _OUTCOMES │
                    │   / _WAIT_REASONS        │
                    │ validateEvent(obj)       │
                    │ parseEventStream(path)   │
                    │ emitEvent(obj) → string  │
                    │ main() CLI dispatcher    │
                    └──────────┬───────────────┘
                               │
            ┌──────────────────┼──────────────────┐
            │ consumed via     │ consumed via      │
            │ import { ... }   │ node --no-warnings│
            │ (downstream      │ --emit-event      │
            │  .ts/.mjs        │ '<json>'          │
            │  modules)        │ (workflow JS via  │
            │                  │  agent() dispatch)│
            ▼                  ▼                   │
   ┌────────────────┐  ┌──────────────────┐        │
   │ A2 golden      │  │ execute-milestone│        │
   │ replay corpus  │  │ .js + prepare-   │        │
   │ A5 baseline    │  │ milestone.js     │        │
   │ metrics        │  │ (A1b's boundary  │        │
   │ DIR-124-B      │  │  instrumentation)│        │
   │ stage scheduler│  └────────┬─────────┘        │
   └────────────────┘           │                  │
                                ▼                  │
                    .workflow-events/              ◄┘
                    <runId>.jsonl
                    (gitignored, append-only)
```

Event data flow (per-stage lifecycle):
1. A1b's `_emitStageEvent` constructs an event object in workflow JS
2. Serialized to JSON string, shell-escaped, dispatched via `agent()`
3. Schema module's `--emit-event` mode validates + appends deterministic JSON to `.workflow-events/<runId>.jsonl`
4. A2/A5/B later read + import-validate the event log via `parseEventStream`

### Key design decisions

**DD1: Single canonical schema module, not embedded.** The schema lives in `workflow-event-schema.mjs` as a first-class module with an explicit `SCHEMA_VERSION = "1"` export. The split review's `no-schema-home` finding forbids embedding the schema in an emission script. DIR-124-B's plan (M236) references consuming A1a's schema as an importable migration source via `migrateDir124AEvent(event)`. Embedding it in an emission-only file would force B to copy-paste the schema, reproducing the exact fragmentation this child prevents. Following the established pattern of `proposal-convergence.ts` (pure logic module, imported by both workflow agents and test files), the schema module is a plain ESM import target.

**DD2: Versioned schema, forward-migratable.** `SCHEMA_VERSION = "1"` is explicit and exported. The `schemaVersion` field is required on every event. DIR-124-B may add a v2 schema shape in the same module with a `migrateDir124AEvent` adapter that maps v1 fields into canonical envelopes. Unknown additional properties pass validation (forward-compat). No second journal format is introduced.

**DD3: Fail-soft validation, never a gate.** `validateEvent` returns a structured `{ok, error}` result and never throws. `parseEventStream` yields `{ok: false, error, lineNumber}` for bad lines but continues iteration — never crashes. The `--emit-event` CLI mode writes to stderr on failure but exits 0. The event log is a best-effort observability channel — an event-emission failure must never crash the workflow or block the phase. The consumer decides the failure policy, not the schema module. This is the same semantic as `_convergenceAgentCall`'s `--record-attempt` dispatch (M203/DIR-126-D): telemetry is additive, its own result is never inspected or branched on.

**DD4: Zero npm dependencies, plain Node ESM.** The module uses only Node built-ins: `node:fs`, `node:path`, `node:readline`, `node:child_process` (only in `--selftest` for `git rev-parse` to find the repo root). No `package.json`, no `node_modules`, no transitive dependency risk. Following the established repo pattern: `proposal-convergence.ts`, `gate-script-base.ts`, `composite-preflight.ts` are all zero-dependency plain Node scripts.

**DD5: `.mjs` with JSDoc, not TypeScript.** The schema module is simple enough (data definitions, validation function, JSON parsing/serialization, CLI arg parsing) that `.mjs` with JSDoc type annotations suffices. This avoids `--experimental-strip-types` overhead on the emission path itself: the WORKFLOW still uses `--experimental-strip-types` to invoke other `.ts` modules, but the event schema module loads directly with `node`. A1b's per-event `agent()` dispatch runs `node workflow-event-schema.mjs --emit-event '...'`, which loads and executes in tens of milliseconds. The task's own `## Touches` confirms `.mjs`.

**DD6: `emitEvent` produces deterministic output (single-line JSONL).** `JSON.stringify` is called with sorted keys (`Object.keys(event).sort()`) and no extra whitespace. This makes the output byte-for-byte deterministic for the same input object, enabling mechanical diff comparison of event streams. No trailing newline in the returned string — the caller (or CLI `--emit-event` mode) appends one when writing a JSONL line.

**DD7: Stream-based JSONL reader, not in-memory.** `parseEventStream` uses `node:readline` to stream lines one at a time — it never loads the full file into memory. This handles event logs of arbitrary length (months of accumulated milestones) without unbounded memory growth. The async iterator interface allows early termination by the consumer. Malformed lines (bad JSON, failed validation) are yielded as `{ok: false, error, lineNumber}` and iteration continues — the stream never aborts on a single bad line.

**DD8: No I/O coupling in exported functions.** `validateEvent`, `emitEvent`, and the core logic behind `parseEventStream` are pure functions of their inputs — they do not access `process.env` or call `process.exit()`. `emitEvent` returns a string and does not write to disk. `parseEventStream` is the one exception: it takes a file path and reads line-by-line via `node:readline`, because streaming large files inherently requires file I/O. The CLI `main()` entry point is the sole owner of `process.exit()` calls. This makes the core functions testable with minimal filesystem mocking and keeps the module importable by downstream code that wants to validate in-memory objects.

**DD9: Byte-identical dual mirrors.** Both `experiments/quay-perpetual-stream/scripts/workflow-event-schema.mjs` and `plugin/scripts/workflow-event-schema.mjs` are byte-identical copies. The existing mirror-diff check (already running in the Gate phase's parallel array) enforces byte-level identity at Land. The canonical source is the `experiments/` copy; the `plugin/` copy is the mirror. This follows the established mirror convention used by `build-evidence-collector.ts`, `composite-args.ts`, `milestone-worktree.ts`, and others.

**DD10: CLI self-testability.** `--selftest` provides a zero-dependency, zero-fixture validation that the module loads correctly and its core functions (validate, emit, round-trip) work. This is the same pattern `build-evidence-manifest.ts --selftest` uses: a built-in smoke test that any agent or human can run without setting up test fixtures. Selftest is the ONE case where the CLI exits non-zero on failure — selftest is a correctness check, not an observability emission.

**DD11: The module is the home of the field-name constants.** `VALID_STAGES`, `VALID_OUTCOMES`, `VALID_WAIT_REASONS`, `VALID_ISOLATION_MODES`, `VALID_DISPATCH_MODES` are exported arrays. Downstream code (A2 replay assertions, A5 metrics field coverage) references these rather than hard-coding string literals. This follows the single-source-of-truth principle: if a new stage is added, only the schema module changes.

**DD12: Schema shape is the 20-field minimal set.** The v1 event carries the fields needed by all known downstream consumers (A2's replay identity, A5's timing metrics, DIR-124-B's stage scheduling, DIR-124-E's resource queue) without speculative field addition. No `eventKind` (start/end discrimination is a consumer concern — the consumer knows from call-site position), no `stageIndex` (ordinal is derivable from log order by replay), no `observedDurationMs` (derivable from `timing.endedAtMs - timing.startedAtMs`), no `errorDetail` (the `outcome: "error"` + stage context suffice). Minimalism reduces the schema surface that v1 consumers must handle and v2 must migrate. **Schema contract with A1b:** the excluded fields (`eventKind`, `stageIndex`, `observedDurationMs`, `errorDetail`) are not rejected by `validateEvent` — unknown additional properties pass through for forward-compat, so if A1b includes them the events still validate. Conversely, `recordedAtMs` is a MANDATORY v1 field: the caller (A1b) MUST populate it with `Date.now()` at event-construction time; events missing `recordedAtMs` fail validation and are silently dropped by the fail-soft `--emit-event` path.

### Defaults and failure behavior

**Normal path:** `validateEvent(validEvent)` returns `{ok: true, event}`. `parseEventStream(validJsonlPath)` yields `{ok: true, event}` for every valid line. `emitEvent(event)` returns a deterministic single-line JSON string (no trailing newline).

**Missing required field:** `validateEvent({runId: "M248"})` returns `{ok: false, error: 'missing required field "schemaVersion"', lineNumber: undefined}`. The error message names the specific missing field.

**Wrong type:** `validateEvent({schemaVersion: "1", ..., attempt: "0"})` returns `{ok: false, error: 'attempt must be a number'}`. Each field has a specific type constraint.

**Invalid value:** `validateEvent({schemaVersion: "1", ..., stage: "UnknownPhase"})` returns `{ok: false, error: 'invalid stage "UnknownPhase"; must be one of: ...'}`. Enum-like fields are checked against the exported constant sets.

**Bad JSON in stream:** `parseEventStream` catches `JSON.parse` errors and yields `{ok: false, error: "JSON parse error at line <N>: <message>", lineNumber: N}` — continues to the next line. The stream never aborts on a single bad line.

**Empty lines / whitespace-only lines:** skipped silently by `parseEventStream`.

**Schema version mismatch:** `validateEvent({schemaVersion: "2", ...})` returns `{ok: false, error: 'schemaVersion "2" is not "1"'}`. This is safe: DIR-124-B will introduce v2 as an additive version in the same module; v1 consumers reject v2 events rather than silently misinterpreting them.

**`--emit-event` with invalid JSON:** CLI writes error to stderr and exits 0 (fail-soft). The event is NOT appended to the log. The caller (A1b's `_emitStageEvent`) is fire-and-forget — it never parses the result, so a non-zero exit is silently dropped. The event log may have a gap; this is intentional (observability channel, not a gate).

**`--emit-event` with no `runId` in event:** CLI reads `runId` from the event object itself to determine the log file path. If `runId` is missing or not a string, writes to stderr and exits 0. The CALLER (workflow JS) is responsible for injecting a valid `runId`.

**Missing `.workflow-events/` directory:** `--emit-event` creates it (`fs.mkdirSync({recursive: true})`) on first write. If creation fails (permissions, disk full), writes to stderr and exits 0.

**Disk full on append:** `fs.appendFileSync` throws → caught by the CLI's try/catch → stderr message → exit 0. The log is best-effort.

**`--validate` with missing file:** CLI exits 1 with error to stderr. This is a caller error (wrong file path), not a validation failure.

**`--selftest` failure:** CLI exits 1 with diagnostic to stderr. Indicates the module itself is broken (bad install, corrupted file, Node version incompatibility). This should never happen in a deployed module.

**No args:** CLI exits 0 silently. This is the normal case when the module is loaded via `import` — `main()` sees no matching CLI flags and returns 0, so `process.exit(0)` is a no-op (the module is already loaded, the import is done).

### Compatibility

A1a is **strictly additive** — it creates new files, touches nothing existing:

- **No existing file is modified.** The four files in `## Touches` are all `(new)`. The module does not import from, monkey-patch, or otherwise interact with any existing script.
- **No behavioral change to any existing system.** The schema module is inert until invoked — it does not register hooks, patch prototypes, or install signal handlers. Loading the module (via `import`) has zero side effects beyond exporting its API surface.
- **No workflow file is touched.** The emission instrumentation lives in A1b, a separate child. A1a's module is import-only — it sits on disk ready for downstream consumers but does not modify any workflow behavior.
- **No interaction with M207 `_phaseTimings` / `proposal-convergence.ts` / `gate-events.jsonl`.** The schema module writes to `.workflow-events/` (a new, separate directory) and never reads from or writes to any existing telemetry path. Each system serves a different purpose with different schemas and storage policies.
- **No new npm dependency.** Zero npm packages required. The module uses only Node built-ins available since Node 18 (`node:fs`, `node:path`, `node:readline`, `node:child_process`).
- **No new directory creation by the module itself.** `.workflow-events/` is created by the CLI `--emit-event` mode on first write; the schema module's exported functions write nothing to disk.
- **Downstream consumers unaffected until they import.** Existing scripts that do not import `workflow-event-schema.mjs` see zero change. Downstream consumers (A2, A5) fail informatively if the module is absent (import error with clear message), rather than silently producing wrong results.
- **Test runner compatibility:** `.mjs` test files are compatible with `scripts/test.sh`'s existing `--experimental-strip-types` pattern (the test file `import`s the `.mjs` module, which Node.js resolves natively). Test files follow the established naming convention (`workflow-event-schema.test.mjs`).
- **Node.js version compatibility:** Uses only Node.js standard library modules available since Node 18. No `--experimental` flags beyond what the workflow runner already uses.

### Risks

**R1: Schema field divergence from actual emission.** The schema module defines 20 required fields, but A1b's emission instrumentation may not populate all of them at every boundary. Mitigation: A1a and A1b are sibling children of the same parent; their charters are authored from the same parent specification. A1a's field set is the contract A1b must fulfill. The cross-child schema-compliance test in A1b (or a shared integration test) validates that every emitted event passes `validateEvent`. AC items in both children reference the same field set.

**R2: Competes with or duplicates existing telemetry.** The schema adds a new observability layer alongside `_phaseTimings`, `proposal-convergence.ts`, and `gate-events.jsonl`. Mitigation: explicit non-goal — the schema module is a new, separate system. It does not replace, extend, unify with, or dual-write to any existing telemetry path. Each system serves a different purpose with a different schema, storage path, and commit policy. The schema module's fields are intentionally NOT a superset of any existing schema.

**R3: Mirror drift.** A future edit to one mirror without updating the other produces a divergence. Mitigation: the byte-identical mirror pattern is already enforced by the existing mirror-diff check in the Gate phase; A1a's test file includes a mirror-parity assertion that `diff` exits 0. The `## Touches` list explicitly names both paths so the directive-resolution mechanism knows to track both.

**R4: Forward-compat breaks v2.** Unknown additional properties pass v1 validation, but v2 may add required fields or change types. Mitigation: `SCHEMA_VERSION` is explicit and immutable. v2 events carry `schemaVersion: "2"` and are validated against a separate v2 schema shape in the same module. v1 consumers reject v2 events (schema version mismatch) rather than silently misinterpreting them.

**R5: The module becomes the single source of truth for field names but downstream code hard-codes strings anyway.** Mitigation: the exported constant sets (`VALID_STAGES`, etc.) make it easy and natural for downstream code to reference the canonical names. The schema definition object (a frozen `const`) is the programmatic source of field names. Tests in A2/A5 explicitly import these constants rather than hard-coding.

**R6: `--emit-event` CLI argument quoting issues.** The event JSON is passed as a single-quoted CLI argument with shell escaping. Mitigation: (a) the workflow JS's `_emitStageEvent` helper uses `JSON.stringify` + `replace(/'/g, "'\\\\''")` (the standard single-quote escape for shell); (b) this is the same pattern used by `_convergenceAgentCall`'s `--record-attempt` and `composite-reconcile.ts`'s JSON input — proven over dozens of workflow runs; (c) `stdin`-based `--json` mode is available as an alternative for callers that prefer piping over argument passing.

**R7: The `--emit-event` CLI is slow under high-throughput.** A `node` process startup per event emission adds overhead. Mitigation: (a) per the parent task's Proposal, there are at most 16 events per run (8 boundaries x 2 events start+end) — the total overhead is ~16 x 50ms Node startup = ~800ms per run, negligible compared to agent dispatch latency; (b) the event dispatch is fire-and-forget so it does not add to critical-path latency; (c) if a future stage-pipelining design requires sub-second emission, the `--emit-event` mode can be optimized to a persistent process or the event emission moved to direct `import` in the outer loop driver (which runs in Node.js and can import the module directly).

**R8: Event log disk growth.** Per-run JSONL files accumulate under `.workflow-events/`. Mitigation: (a) gitignored — never committed, so it does not pollute repo history; (b) a single run produces approximately 16 events x ~600 bytes = ~10KB; (c) the `cleanup_temp_files` MCP tool (meta-cc) handles stale files; (d) the per-run file naming (`<runId>.jsonl`) means old runs are independently deletable without affecting current data.

### Non-goals

Explicitly excluded from A1a's scope:

1. **Emission instrumentation in workflow files** — A1b's scope. A1a provides the schema; A1b calls `--emit-event`. A1a does not touch `execute-milestone.js` or `prepare-milestone.js`.
2. **Creating `.workflow-events/` directory or writing event logs** — the CLI `--emit-event` mode creates the directory and appends to the log as a convenience for the workflow-dispatch path, but the module's exported API (`emitEvent` returns a string, `validateEvent` returns `{ok, error}`) is storage-agnostic. The storage path is a consumer decision.
3. **Stage scheduling, pipeline reordering, or resource-aware dispatch** — DIR-124-C/E's scopes.
4. **New lifecycle policy, gate addition, or post-Land Wiring Audit** — DIR-124-B/DIR-118's scopes.
5. **Golden replay corpus or baseline metrics** — A2 and A5 are separate children; A1a provides the schema they consume.
6. **Unifying with gate-events.jsonl, prepare-telemetry, or `_phaseTimings`** — separate systems, separate purposes.
7. **TypeScript compilation, build step, or npm packaging** — the module is plain `.mjs`, loaded directly by Node.
8. **Adding `import` support to the workflow DSL** — the workflow DSL's `import`-less constraint remains; A1b invokes the schema module via the established `agent()`-dispatched CLI pattern, not via `import`.
9. **A second journal format** — the schema defines event shapes, not a journal. The journal (`.workflow-events/*.jsonl`) is an implementation detail of `--emit-event`; DIR-124-B may store events differently.
10. **Migration or unification of existing telemetry** — M207 `_phaseTimings`, `proposal-convergence.ts` telemetry, and `gate-events.jsonl` are separate systems with separate purposes — A1a does not migrate, extend, or dual-write any of them.
11. **Inferring delivered value or changing pass/fail policy from event data** — A5's scope.
12. **Real workflow execution evidence** — A1a's tests are unit-level (schema validation, round-trip, stream parsing). Real-workflow evidence is the parent A1's territory.

### AC coverage

| AC | Mechanism | Evidence |
|----|-----------|----------|
| Schema module validates required fields and rejects malformed events | `validateEvent(obj)` checks all 20 required fields + types + value constraints; returns `{ok: false, error}` for missing/wrong-type/invalid-value fields; never throws | Test: valid event passes, event missing "stage" fails with specific error, event with wrong type fails, event with invalid enum value fails, unknown additional properties allowed |
| parseEventStream handles malformed lines with parseWarnings (never crashes) | `parseEventStream(jsonlPath)` uses `node:readline` + try/catch per line; bad JSON / validation failures yield `{ok: false, error, lineNumber}`; iteration continues; empty/whitespace lines skipped | Test: valid 3-line JSONL produces 3 ok results; mixed valid+invalid produces 2 ok + 1 error; empty file produces 0 results; non-existent file throws distinct error |
| emitEvent produces deterministic output (sorted keys) | `JSON.stringify(event, Object.keys(event).sort())` — no extra whitespace, single-line output; two calls with same object produce byte-identical output | Test: emit same event twice → identical strings; emit event with keys in different insertion order → identical output; output is single-line (no embedded newline) |
| Byte-identical mirror at plugin/scripts/ | Second copy at `plugin/scripts/workflow-event-schema.mjs`; `diff` exit 0 at Land | `diff` between mirrors at Land; mirror-parity assertion in test |
| Tests RED/GREEN in both mirrors | Test file validates schema functions in the experiments/ mirror; second invocation against the plugin/ mirror confirms identical behavior | `scripts/test.sh experiments/quay-perpetual-stream/test/workflow-event-schema.test.mjs` GREEN; `scripts/test.sh plugin/test/workflow-event-schema.test.mjs` GREEN (or a single test file that tests both mirrors) |
| No post-Land Wiring Audit, lifecycle-promotion policy, worktree redesign, stage scheduler, or resource lease | A1a adds NO new workflow phases, gates, lifecycle statuses, scheduling decisions, or lease mechanisms. Touches list (4 new files, 0 modifications) confirms | `git diff --stat` at Land: only new files; grep for WiringAudit/promote/worktree/scheduler/lease in new files returns empty |

### Mechanism-claim wiring coverage (DIR-117)

Each claim listed below maps to an AC item or test assertion. The review phase checks each against the delivered code:

| Claim ID | Claim | Verification |
|----------|-------|-------------|
| A1a-SCHEMA-HOME | `experiments/.../workflow-event-schema.mjs` is the single canonical schema home | AC1: schema module exists and is the only file defining the stage-event schema v1; `grep -r 'schemaVersion.*"1"'` finds only this file and its mirror |
| A1a-MIRROR | `plugin/scripts/workflow-event-schema.mjs` is byte-identical | AC4: `diff` exit 0 between mirrors at Land; mirror-parity test assertion |
| A1a-IMPORT | Downstream consumers import from the schema module | AC1: the module exports `SCHEMA_VERSION`, `validateEvent`, `parseEventStream`, `emitEvent`; test validates that `import` succeeds and exports are functions/constants |
| A1a-DUAL-SURFACE | Schema supports both direct import and CLI dispatch | AC1 + AC3: import test validates direct consumption; CLI `--emit-event` test validates dispatch path; both exercise the same `validateEvent` |
| A1a-DISPATCH-PATTERN | CLI dispatch follows established workflow-to-TypeScript pattern | AC5: `--emit-event` uses `node --no-warnings <script> <flags>`, matching `prepare-admission-check.ts`, `milestone-worktree.ts`, `composite-reconcile.ts` patterns |
| A1a-VALIDATE-SOFT | `validateEvent` returns `{ok, error}`, never throws | AC1: test passes invalid/missing-field events through validateEvent without try/catch; validates return shape |
| A1a-PARSE-RESILIENT | `parseEventStream` handles malformed lines with warnings | AC2: test passes mixed valid/malformed JSONL; error results yielded for bad lines; ok results yielded for good lines; iteration continues |
| A1a-EMIT-DETERMINISTIC | `emitEvent` produces sorted-key, single-line output | AC3: test emits same object twice, asserts byte-identical; test emits object with non-sorted key insertion order, asserts sorted single-line output |
| A1a-VERSIONED | `SCHEMA_VERSION = "1"` is explicit and exported | AC5: test asserts `SCHEMA_VERSION === "1"`; every test event carries `schemaVersion: "1"`; B's migrate adapter references v1 |
| A1a-SELFTEST | `--selftest` validates internal round-trip | AC1: `node workflow-event-schema.mjs --selftest` exits 0; test invokes it and asserts exit code |
| A1a-NO-SCOPE-CREEP | No Wiring Audit, lifecycle policy, worktree, scheduler, lease, or workflow DSL `import` support | AC6: `grep` for those terms in the module returns empty; `git diff --stat` at Land shows only new files in declared Touches |
| A1a-PURE-FUNCTIONS | `validateEvent`, `emitEvent`, `parseEventStream` are pure functions; `main()` is sole owner of `process.exit()` | AC7: test asserts no `process.env` or `process.exit()` in pure functions; `process.exit()` only appears in `main()` |
| A1a-SCHEMA-EXCLUSIONS | v1 schema excludes `eventKind`, `stageIndex`, `observedDurationMs`, `errorDetail`; `recordedAtMs` is mandatory | AC8: test validates schema excludes those fields; events missing `recordedAtMs` fail validation; `recordedAtMs` is populated by the caller |
| A1a-PHASE-REFERENCES | Phase boundary references in problem framing match actual `phase()` calls | AC9: grep for phase names confirms line numbers are accurate at Land |

### Alternatives considered and rejected

**Alt1: Embedding the schema inside A1b's emission script (no separate module).** The field definitions would live as a local constant inside the script that does the emitting. Rejected per the split review's `no-schema-home` finding: A2, A5, and B must all consume the SAME schema without copy-pasting from an emission-only file. A first-class module at `workflow-event-schema.mjs` with explicit `SCHEMA_VERSION` export is the single canonical home. B's plan (M236) already treats A1a's schema as an importable migration source — embedding it would force B to copy-paste, reproducing the exact fragmentation this child prevents.

**Alt2: Schema as TypeScript (.ts) rather than .mjs.** Using `.ts` with `--experimental-strip-types`. Rejected: the schema module is simple enough (data definitions, validation function, CLI arg parsing, file I/O) that `.mjs` with JSDoc type annotations suffices. Using `.mjs` avoids the `--experimental-strip-types` overhead on the emission path itself — A1b's per-event `agent()` dispatch runs `node workflow-event-schema.mjs --emit-event '...'`, which loads and executes in tens of milliseconds. Adding `--experimental-strip-types` to 16 per-run event-emission dispatches is unnecessary overhead. Downstream TypeScript consumers can still import `.mjs` modules (Node.js resolves `.mjs` extensions). The task's own `## Touches` specifies `.mjs`, confirming this decision.

**Alt3: Making validateEvent throw on failure.** Rejected: fail-soft is essential. A1b's event emission is fire-and-forget — a validation failure must never throw and crash the workflow. By returning `{ok, error}` rather than throwing, the caller always controls the failure policy. The `parseEventStream` function would be unusable for partial streams if it threw on the first bad line.

**Alt4: Storing the schema as a JSON Schema document rather than executable code.** A static `.schema.json` file that consumers load and interpret. Rejected: the schema is consumed by executable code (A2's replay runner, A5's metrics, B's migrator). An executable module that exports both the schema definition AND the validation/parsing/emission functions is strictly more useful than a passive JSON document. A JSON Schema document would additionally require a JSON Schema validator dependency — violating the zero-dependency constraint.

**Alt5: In-memory JSONL parsing instead of streaming.** Reading the full file with `fs.readFileSync` + `split('\n')`. Rejected: the event log grows over months of accumulated milestone runs. A streaming reader via `node:readline` handles arbitrary-length logs without unbounded memory growth. `node:readline` is the standard Node.js mechanism for line-by-line file reading — zero extra dependencies, well-tested.

**Alt6: Including I/O in the exported functions (writing to .workflow-events/).** Making `emitEvent` write to disk. Rejected: the module is a schema definition + validation library, not an event logger. I/O policies (gitignored path, file naming convention, append semantics) belong to the consumer, not the schema module. The CLI `--emit-event` mode provides storage as a convenience for the workflow-dispatch path, but the module's exported API (`emitEvent` returns a string, `validateEvent` returns `{ok, error}`) does not assume any particular storage mechanism. Keeping the exported functions pure makes them testable without filesystem mocking and keeps the module reusable across storage backends.

**Alt7: Including `eventKind` (start/end) and `stageIndex` in the v1 schema.** Adding fields to discriminate start vs end events and track ordinal position. Rejected: (a) `eventKind` is derivable from call-site position (the workflow JS knows whether it is emitting a start or end event) — embedding it in the schema couples the schema to a single emission pattern; (b) `stageIndex` is derivable from log order in replay — it is a property of the log, not of the event; (c) minimalism per DD12 — the 20-field set is the intersection of what all known consumers actually need.

**Alt8: Combining A1a and A1b into a single child (schema + emission in one deliverable).** Rejected per the split review's core finding: A1a and A1b are independently landable mechanisms. A1b depends on A1a (it imports the schema module), but A1a is independently testable and reviewable. Separating them keeps each child's scope tight: A1a is ~200 lines of pure schema logic; A1b is ~200 lines of workflow instrumentation. Combined, the review surface is wider and harder to audit. The parent DIR-124-A1's ordered-child split encodes this boundary explicitly.

**Alt9: Skipping the byte-identical mirror.** Only maintaining the schema module in `experiments/`. Rejected: the established repo discipline requires byte-identical mirrors for any script that appears in both locations. A2, A5, and B live primarily in `experiments/`; `plugin/test/` tests validate against the `plugin/` mirror. Asymmetry in what each mirror contains creates confusion and drift. The mirror-diff gate check catches drift at Land; a single-mirror design would have no such check.

**Alt10: Adding a build step (e.g., generating the mirror from a canonical source).** Rejected: the mirror is maintained by byte-identical copy, not by code generation. No build step exists in this repo (explicitly: "No `package.json` scripts and no build step" per CLAUDE.md). Adding a build step for a single module is disproportionate complexity. The `diff` check at Land is the enforcement mechanism.

**Alt11: Using `Date.now()` inside the schema module to set `recordedAtMs`.** The `--emit-event` CLI would compute `recordedAtMs` internally rather than expecting it to be in the event object. Rejected: (a) the CALLER (workflow JS) is the authoritative source of timing — it knows when the event was logically created, which may differ from when the CLI process started; (b) the `--emit-event` CLI may run seconds after the event logically occurred (agent dispatch latency, shell startup), so its own `Date.now()` would be wrong; (c) keeping `recordedAtMs` as a required field in the event object makes the caller explicitly responsible for timing accuracy.

**Alt12: Making the schema module write to git-committed storage.** Committing `.workflow-events/` would add transient diagnostic data to the repository. Rejected: gitignored, following `.quay/gate-events.jsonl`'s pattern. Committed provenance belongs in `milestones/prepare-telemetry/` (a separate system with a different schema and different consumers).

## Acceptance Criteria

- [ ] AC1: `validateEvent(obj)` checks all 20 required fields for presence, type correctness, and enumerated-value membership; returns `{ok: false, error}` for missing/wrong-type/invalid-value fields; never throws; `node workflow-event-schema.mjs --selftest` exits 0 and validates internal round-trip (construct, emit, parse, validate, value-range checks)
- [ ] AC2: `parseEventStream(jsonlPath)` uses `node:readline` streaming; handles valid, invalid, and mixed JSONL lines without crashing; skips empty/whitespace lines; yields `{ok: false, error, lineNumber}` for bad lines with iteration continuing
- [ ] AC3: `emitEvent` produces deterministic, sorted-key, single-line output; two calls with same event object produce byte-identical strings regardless of key insertion order
- [ ] AC4: Byte-identical mirror at `plugin/scripts/workflow-event-schema.mjs`; `diff` exits 0 between mirrors at Land
- [ ] AC5: Tests RED/GREEN per `scripts/test.sh` against both mirrors; test imports `SCHEMA_VERSION`, `validateEvent`, `parseEventStream`, `emitEvent` and asserts correct types and `SCHEMA_VERSION === "1"`; `--emit-event` CLI mode uses `node --no-warnings <script> <flags>` matching established workflow-to-TypeScript dispatch patterns (`prepare-admission-check.ts`, `milestone-worktree.ts`, `composite-reconcile.ts`)
- [ ] AC6: No scope creep — no Wiring Audit, lifecycle policy, worktree, scheduler, lease, or workflow DSL `import` support; `git diff --stat` at Land shows only new files in declared Touches
- [ ] AC7: `validateEvent`, `emitEvent`, and the core logic behind `parseEventStream` are pure functions of their inputs — no `process.env` access, no `process.exit()` calls; the CLI `main()` entry point is the sole owner of `process.exit()`
- [ ] AC8: The v1 20-field schema excludes `eventKind`, `stageIndex`, `observedDurationMs`, `errorDetail` from the required field set; `recordedAtMs` is a REQUIRED field populated by the caller with `Date.now()` at event-construction time (events missing `recordedAtMs` fail validation and are silently dropped by the fail-soft `--emit-event` path)
- [ ] AC9: Phase boundaries listed in the Proposal problem framing match the actual `phase('Name')` calls in `execute-milestone.js` and `prepare-milestone.js` at the cited line numbers at Land

## Plan

See [docs/plans/M248-dir-124-a1a.md](docs/plans/M248-dir-124-a1a.md) for the full milestone plan (M248, base revision `295dbfdb`).