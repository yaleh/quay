---
id: DIR-099-C
title: "MCP config_validate tool surface: registerConfigHandlers + CLI-MCP
  verdict parity"
status: done
labels:
  - directive
  - human-steered
  - milestone-candidate
parent: DIR-099
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    DIR-099-C experiments/quay-perpetual-stream/charters/M231-dir-099-c.md
    milestones/M231/absorb-entry.md
---
**type:** execution


**MCP contract clarifications (2026-08-01, from ProposalReview):**

- **`checkFiles` default**: omitted `checkFiles` maps to `false` (byte-parity with the CLI's
  no-flag default — `--check-files` is opt-in).
- **Error path**: a malformed config is a RESULT (`{ok:false, issues}`), not an error. An
  unreadable/absent `.quay/config.yml` or an internal `validateConfig` error returns
  `isError:true` per the repo convention (adr_get/action_run pattern in mcp-handlers.ts).
- **`structuredContent` is the output channel** (an AC names it, not just Proposal prose):
  the handler returns `{ok, issues[]}` in structuredContent — a text-only return violates
  the contract.
- **`registerConfigHandlers(server, cfg)`** follows the explicit-params convention (like
  each `register*Handler(server, getClient, cfg)`), binding `cfg.workspaceRoot` from
  `loadConfig` — not an untyped `deps`.


**Grounded facts for Plan authors (2026-08-01, from real PlanCheck rounds):**

1. **`startMcpServer()` calls `loadConfig()` at boot** (mcp-server.ts:89) and
   `bin/quay.ts:1041` `await startMcpServer()` has NO try/catch — a syntax-malformed
   `.quay/config.yml` (DIR-099-A's AC2 malformed-YAML fixture) throws YAMLParseError at
   boot and KILLS the MCP process before any tool registers. The MCP-vs-CLI parity test
   (AC2) therefore CANNOT drive a syntax-malformed-YAML workspace through the real `quay
   mcp` subprocess — use a semantically-invalid-but-syntactically-valid fixture (e.g. the
   unresolved-gate case, which `loadConfig` parses fine and `validateConfig` flags).
2. **DIR-099-A's AC numbers shifted after the split** — the unresolved-gate case is
   DIR-099-A AC5 (not AC4); the PATH-binary/--check-files negative is AC12 (the task body
   tags it "(AC17)" using pre-split parent-DIR-099 numbering — use the current numbers).


## Proposal

**Depends on [[DIR-099-A]]** (hard dependency, blocked-by): this child's entire mechanism
and AC2/AC3/AC4 consume DIR-099-A's `validateConfig` module and its malformed-YAML/
unresolved-gate fixtures, which do not exist in the repo until DIR-099-A lands. This child
must NOT be prepared/executed before DIR-099-A is done. If dispatched before M229 lands,
its parity ACs fail closed (soft guard) but the dependency must be declared, not inferred
from parent prose.

### Problem framing (grounded in current repository state)

The Core MCP server (`packages/quay/src/mcp-server.ts` + `mcp-handlers.ts`) currently
exposes tools spanning task CRUD, gate/lifecycle ops, ADR reads, and action triggers — but
has **no `config_validate` tool**. Six handler-registration groups exist in
`mcp-handlers.ts`: `registerTaskHandlers`, `registerGateHandlers`,
`registerLifecycleHandlers`, `registerAdrHandlers`, `registerActionHandlers`, and the
orchestrator `registerAllHandlers` — each following the established
`register*Handlers(server, getClient, cfg?)` convention. The gate/lifecycle handlers
receive `cfg: ReturnType<typeof loadConfig>` and bind `cfg.workspaceRoot` for gate-event
log resolution, gate listing, and acceptance-runner CWD defaulting — maintaining the "one
implementation, two bindings" discipline.

The CLI `config validate` command (DIR-099-A, `bin/quay.ts`) provides workspace config
diagnostics (YAML syntax, provider shape, gate type schema, gate reference resolution,
loop/routine validation, optional file-existence checks), but an Agent connected **only via
MCP** has zero access to it. Concrete asymmetry visible in the current `mcp-handlers.ts`:
`registerGateHandlers`, `registerLifecycleHandlers`, and `registerActionHandlers` all
accept `cfg` and delegate to shared `src/gate/*.ts` modules. A `config_validate` tool
following the same pattern is absent from `registerAllHandlers` (line 609-619), which
enumerates every handler group but has no `registerConfigHandlers` call.

This is the exact same CLI-vs-MCP parity gap that DIR-007/010 already closed for task ops,
gate ops, lifecycle ops, and action buttons — config validation is the last major CLI
surface still dark over MCP. The concrete failure mode: a CI agent or autonomous loop
(experiment 5's `execute-milestone.js`) connected through `quay mcp` discovers a workspace
config is broken only at runtime when a gate fails to resolve or a loop driver crashes —
the MCP has no pre-flight diagnostic tool. An Agent diagnosing a misconfigured workspace
must currently fall back to shelling out to `node bin/quay.js config validate --json`,
breaking the MCP-only contract that DIR-007 established.

### Chosen mechanism

A new `registerConfigHandlers(server, cfg)` function in `mcp-handlers.ts`, following the
**explicit-params convention** of the existing handler groups. It registers a
`config_validate` tool whose handler calls the **real shared
`validateConfig({ workspaceRoot, checkFiles }) -> { ok, issues }`** module from
`packages/quay/src/config-validate.ts` (DIR-099-A's core deliverable). Zero duplicated
validation logic — the handler is a thin passthrough, structurally identical to how
`registerGateHandlers` delegates to `src/gate/engine.ts`'s `runGate`.

Mechanism-claim wiring (DIR-117):

- **Claim 1 (wiring):** `registerConfigHandlers(server, cfg)` is added to
  `registerAllHandlers` (mcp-handlers.ts ~line 619), so the tool is registered at MCP
  server boot. AC1 falsifies this: grep for `registerConfigHandlers` in mcp-handlers.ts
  must find both the function definition AND its call site in `registerAllHandlers`.
- **Claim 2 (single implementation):** The handler imports and calls `validateConfig` from
  `src/config-validate.ts` — no gate-shape literals (`it0`, `testPass`, `coverageFloor`,
  `redGreen`, `argsKey`, `name`/`script`/`command` field checks), no YAML-parsing logic,
  no provider-validity checks appear in mcp-handlers.ts. AC4 falsifies this: grep for
  gate-shape literals in mcp-handlers.ts returns zero matches; the only
  `validateConfig`-related text in mcp-handlers.ts is the import statement and the single
  call site.
- **Claim 3 (positive falsification):** A test spy/mock confirms the handler invokes the
  imported `validateConfig`, proving the wiring is live, not dead code. AC5 covers this —
  mirrors DIR-099-A's AC15 pattern. A dead/unwired registration (e.g. registered but
  handler ignores the import) cannot pass.
- **Claim 4 (parity):** MCP `config_validate` returns `{ok, issues[]}` byte-identical to
  the CLI on the same fixtures. AC2/AC3 cover this.

### Control and data flow

**Boot:** `startMcpServer()` (mcp-server.ts:89) calls `loadConfig()` which parses
`.quay/config.yml` and returns `{config, configPath, workspaceRoot}`. If the YAML is
syntactically malformed, `loadConfig()` throws `YAMLParseError` and the MCP process dies
before any tool registers — this is existing, unchanged behavior (see Grounded Fact #1).

**Registration:** `registerAllHandlers()` calls `registerConfigHandlers(server, cfg)`,
which calls `server.registerTool("config_validate", {...}, handler)` — the single new
`server.registerTool` call. `registerConfigHandlers` takes only two parameters
`(server, cfg)`, unlike the three-parameter `(server, getClient, cfg)` convention used by
gate/lifecycle/action handlers — correct because config validation needs zero Provider
interaction.

**Invocation:**

```
MCP client calls config_validate({ checkFiles?: boolean })
  --> McpServer dispatches to registered handler
    --> zod schema parses input (checkFiles: z.boolean().optional())
    --> handler calls validateConfig({
          workspaceRoot: cfg.workspaceRoot,  // from loadConfig() at mcp-server.ts:89
          checkFiles: checkFiles ?? false     // omitted checkFiles → false (CLI parity)
        })
    --> validateConfig returns { ok: boolean, issues: Issue[] }
    --> handler returns { content: [{ type: "text", text: JSON.stringify(result) }],
                          structuredContent: result }
```

**Result shaping:** `{ok, issues[]}` flows into `structuredContent` (the explicit output
channel per the MCP contract clarification). The handler also returns a `content: [{
type: "text", text: JSON.stringify(result) }]` for text-only consumers, following existing
convention (`task_list` line 141, `gate_run` line 323).

**Error paths (error-vs-result distinction):**

- **Malformed config** (YAML parse error in a syntactically-valid file, gate shape
  violation, unresolved reference, etc.): `validateConfig` returns
  `{ ok: false, issues: [...] }` — this is a normal SUCCESSFUL tool call (not
  `isError:true`), identical to how `gate_run` returns `ok:false` for an unmet gate.
  AC2/AC3 verify the issues array matches the CLI's output.
- **Absent/unreadable `.quay/config.yml` at `workspaceRoot`** (e.g. the directory was
  deleted after MCP boot) or **internal `validateConfig` throw**: handler catches and
  returns `{ isError: true, content: [{ type: "text", text: err.message }] }`, matching
  the `adr_get`/`action_run` error pattern.
- **Zod validation failure** (e.g., `checkFiles: "yes"` as a string): the MCP SDK rejects
  the call before the handler runs — this is standard McpServer behavior, not custom
  logic.
- **DIR-099-A not landed** (import failure): `ERR_MODULE_NOT_FOUND` at registration time —
  fail-closed, not a silent runtime gap.

Note: a syntactically-malformed `.quay/config.yml` (unparseable YAML) is ALREADY guarded
at boot by `loadConfig()` (mcp-server.ts:89) — it kills the MCP process before
`config_validate` can be called. The tool's error path for absent/unreadable config
therefore only fires when the filesystem state changed AFTER boot. The parity test must use
a semantically-invalid-but-syntactically-valid fixture (e.g. the unresolved-gate case from
DIR-099-A AC5).

### Key design decisions

1. **No `provider` argument** (departure from task/gate/lifecycle/action tools). Config
   validation is **workspace-scoped**, not Provider-scoped — `validateConfig` reads
   `.quay/config.yml` directly from `cfg.workspaceRoot`, and config shape errors (YAML
   syntax, gate typing, loop board) are independent of which Provider is enabled. Adding a
   `provider` argument that is silently ignored would mislead callers; routing through a
   provider to validate the provider definition is circular (the config DEFINES providers).
   An Agent calling `config_validate` on any workspace gets the same result regardless of
   Provider selection. The handler does NOT call `getClient` at all — and therefore
   `registerConfigHandlers` does NOT receive `getClient` as a parameter. **Decision
   recorded as an explicit departure from convention, not an oversight.**

2. **Structured input, not `json` input.** The MCP tool takes `checkFiles?: boolean` as a
   typed Zod schema field — NOT a `json` boolean string. MCP `structuredContent` already
   IS structured data; a `--json` flag on an MCP tool is a category error (the CLI's
   `--json` flag controls OUTPUT formatting for a TTY-bound surface; the MCP tool's
   structuredContent IS the machine-readable output). The original parent DIR-099 Proposal
   mentioned `--json` for the MCP surface — this was the split review's flag that the
   semantics were muddled.

3. **`checkFiles` defaults to `false`** when the field is omitted from the MCP call. This
   is **byte-parity with the CLI**, where `--check-files` is an opt-in flag — `quay config
   validate` without `--check-files` does not check file existence. Defaulting to `true`
   would break the parity contract.

4. **`structuredContent` is the output channel** (an AC explicitly names it). A text-only
   return violates the contract — the handler returns BOTH `content` (text JSON for human
   readers) and `structuredContent` (typed `{ ok, issues }` for programmatic consumers),
   matching every other handler in this file (task_list line 143-144, gate_run line
   323-324, etc.).

5. **`cfg.workspaceRoot` from `loadConfig()`** — the same `cfg` object already threaded
   through `registerGateHandlers`, `registerLifecycleHandlers`, and
   `registerActionHandlers`. `loadConfig()` is called at MCP server boot (mcp-server.ts:89)
   and its return value is passed to `registerAllHandlers` (mcp-server.ts:155). No
   additional config resolution needed.

6. **No boot-time validation.** `config_validate` is an on-demand diagnostic tool, not a
   startup gate. We deliberately do NOT call `validateConfig` inside `startMcpServer()`
   because a malformed config that DOES parse (e.g. unresolved gate reference) should not
   prevent the MCP server from starting — the whole point is to give the agent a tool to
   DIAGNOSE such issues. The existing boot-time `loadConfig()` call already guards against
   truly unparseable YAML. Calling `validateConfig` at boot and refusing to start if
   `ok: false` would prevent the MCP server from starting on a config with a warn-level
   issue — hostile to the very diagnostic tool that is supposed to help.

7. **Import path.** The handler imports `validateConfig` from
   `"../src/config-validate.ts"` (same package, same directory level as the existing
   imports from `"./gate/engine.ts"`, `"./gate/lifecycle.ts"`, etc.). This is the standard
   intra-package import pattern used throughout mcp-handlers.ts. If DIR-099-A's module API
   changes between its Build and DIR-099-C's dispatch, the import contract breaks — the
   hard dependency ensures DIR-099-A lands first; the parity ACs (AC2/AC3) catch any
   mismatch.

### Defaults and failure behavior

| Scenario | `isError` | `ok` | `issues[]` |
|---|---|---|---|
| Valid clean config | absent | `true` | `[]` |
| Unresolved gate reference | absent | `false` | `[{severity:"error", field, message, suggestion?}]` |
| Malformed YAML (syntactically valid but semantically broken) | absent | `false` | `[{severity:"error", field, message, suggestion?}]` |
| `checkFiles: true` with missing script path | absent | `false` | `[{severity:"error", field, message, suggestion?}]` |
| `checkFiles` omitted | defaults to `false` (CLI parity) | — | — |
| `checkFiles: true` | passes through to `validateConfig` | — | — |
| `.quay/config.yml` absent/unreadable at `workspaceRoot` (post-boot) | `true` | N/A | N/A |
| Internal `validateConfig` crash (thrown exception) | `true` | N/A | N/A |
| Zod input validation fails (e.g. `checkFiles: "yes"`) | MCP SDK rejects before handler | not reached | not reached |

### Compatibility

- **No breaking changes.** A new tool is added; zero existing tools, signatures, or
  behaviors are modified.
- **`registerAllHandlers`** gains one line (`registerConfigHandlers(server, cfg)`). All
  existing callers (mcp-server.ts:155) pass `cfg` already — no signature change needed.
- **`.quay/config.yml` shape unchanged.** The tool reads the same config file the CLI
  reads, via the same module. No new config fields are added.
- **No provider dependency.** Does not require a specific provider, does not call
  `getClient()` — works identically regardless of which provider(s) are enabled.
- **Existing MCP clients unaffected.** The tool is additive. A client that never calls
  `config_validate` sees zero behavior change.
- **Backward compatibility with workspaces lacking DIR-099-A:** the import of
  `validateConfig` from `src/config-validate.ts` will fail at module load if DIR-099-A has
  not landed (fail-closed, not a silent runtime gap).

### Risks

1. **DIR-099-A signature drift / landing order.** If DIR-099-A's `validateConfig` signature
   changes during its own build phase, this child's handler must be updated. Mitigation:
   the hard dependency ensures DIR-099-A lands first; the MCP handler's import is a
   single-line call site that is trivial to update. The `validateConfig({workspaceRoot,
   checkFiles}) -> {ok, issues[]}` signature is pinned in both task bodies and the shared
   Prepare receipt — this is a split-task contract, not a loose promise. The parity ACs
   (AC2/AC3) will catch any mismatch because they test against DIR-099-A's real fixtures.

2. **Boot-time `loadConfig` kills MCP before `config_validate` can be called.** A
   syntax-malformed YAML workspace cannot use `config_validate` via MCP because the MCP
   process never starts. Mitigation: this is a fundamental architectural constraint (you
   need a running MCP server to call any tool); the CLI path works for this case. The task
   body's Grounded Fact #1 explicitly documents this — the parity test must use a
   semantically-invalid-but-syntactically-valid fixture (e.g. DIR-099-A AC5's
   unresolved-gate case).

3. **No `provider` argument limits multi-provider diagnosis.** If the config has multiple
   providers defined but only one enabled, `config_validate` validates the whole file — it
   cannot be asked "validate only the github provider block." This is by design: the config
   is a single document and provider blocks interact (e.g. which one is `enabled: true`).
   The tool validates the unified config; per-provider scoping is a non-goal. Future
   multi-Provider workspaces might want per-Provider config validation — explicitly out of
   scope for now.

### Non-goals

- **Config mutation / fix / repair.** This tool is read-only validation; `config edit` /
  `config init` are separate concerns. The issues array includes `field` and `message` for
  human/agent consumption; applying fixes is the caller's responsibility.
- **Per-Provider validation.** The tool validates the workspace config file, not individual
  Provider connectivity or manifest shape. Per-provider concerns (Provider connectivity,
  manifest shape) are separate tool surfaces (the existing manifest resource).
- **A second validation implementation.** The handler is a thin passthrough to the shared
  module; no validation logic lives in mcp-handlers.ts. AC4 (grep-guard) is specifically
  designed to falsify any duplication.
- **Boot-time validation.** `config_validate` is an on-demand diagnostic tool, not a
  startup gate. We do not gate MCP server startup on config validity.
- **Gate-event logging.** `config_validate` is read-only; it does not append to
  `gate-events.jsonl`. It is a diagnostic tool, not a gate.
- **`run`-style autonomous scan.** Unlike the gate engine's `run` command (deliberately
  excluded from MCP per docs/plans/14-mcp-gate-lifecycle-parity.md), config validation is a
  single-shot diagnostic, not a continuous loop.
- **JSON output flag.** No `json` input parameter — structuredContent IS the JSON output
  channel. CLI parity on output FORMAT is nonsensical for an MCP tool.

### AC coverage

- **AC1** (`config_validate` is registered via `registerConfigHandlers`, grep-confirmable
  in mcp-handlers.ts, with structured input `checkFiles?: boolean`): the function
  definition + `registerAllHandlers` call site. `checkFiles` is `z.boolean().optional()` in
  the zod schema. No `json` input. Grep-confirmable:
  `grep -n "config_validate" packages/quay/src/mcp-handlers.ts` returns the
  `server.registerTool("config_validate", ...)` call inside `registerConfigHandlers`.
- **AC2** (MCP `config_validate` returns `{ok, issues[]}` identical to CLI on semantically-
  invalid-but-syntactically-valid fixtures): parity test drives both CLI and MCP against
  the unresolved-gate fixture (DIR-099-A AC5), asserts byte-identical `issues[]`. **Cannot
  use the malformed-YAML fixture** (DIR-099-A AC2) because `loadConfig()` throws
  `YAMLParseError` at MCP boot and kills the process before any tool registers — use the
  unresolved-gate fixture which `loadConfig` parses fine and `validateConfig` flags (see
  Grounded Fact #1).
- **AC3** (`checkFiles: true` through MCP behaves identically to CLI `--check-files`):
  parity test with `checkFiles: true` against a workspace with a missing gate script,
  asserts identical file-path-bearing issues. `config_validate({checkFiles: false})` /
  omitted `checkFiles` on the same workspace returns clean (no file-existence errors).
- **AC4** (no second validation implementation): grep for gate-shape literals (`it0`,
  `testPass`, `coverageFloor`, `redGreen`, `argsKey`, `name`/`script`/`command` field
  checks) in mcp-handlers.ts returns zero matches. The only `validateConfig`-related text
  in mcp-handlers.ts is the import statement and the single call site.
- **AC5** (wiring AC — positive falsification): test imports both `validateConfig` from
  `src/config-validate.ts` and the handler registration, spies on the `validateConfig`
  import, calls the `config_validate` handler, asserts the spy was invoked. A
  dead/unwired registration (e.g. registered but handler ignores the import) cannot pass.
  Mirrors DIR-099-A's AC15 pattern.
- **AC6** (test coverage): new test file
  `packages/quay/test/mcp-config-validate.test.mjs` driving the real MCP
  `config_validate` tool, achieving >=80% coverage on the new handler path.

### Alternatives considered and rejected

1. **Add a `provider` argument (like all other tools).** Rejected because config validation
   is workspace-scoped, not Provider-scoped. Adding a `provider` argument that is silently
   ignored would mislead callers. The departure from convention is explicitly documented
   (decision #1 above). Routing through a provider to validate the provider definition is
   circular — the config DEFINES providers.

2. **Accept `json` input (string field containing JSON).** Rejected. `structuredContent` is
   already JSON — the tool accepts structured input fields directly (zod schema), not a
   JSON string that requires a second parse. This was the original parent DIR-099
   Proposal's confusion that the split review flagged.

3. **Inline validation logic in the handler (duplicate `validateConfig`).** Rejected —
   violates the single-implementation principle and would drift from the CLI over time.
   Every fix/change to validation logic would need to be applied in two places. The DIR-099
   split was specifically to ensure ONE shared module. AC4 (grep-guard) is specifically
   designed to falsify this.

4. **Make `checkFiles` default to `true` for MCP (different default than CLI).** Rejected —
   breaks byte-parity. The CLI's `--check-files` is opt-in; the MCP tool must match.

5. **Skip `registerConfigHandlers` and register the tool inline in `registerAllHandlers`
   (one-line `server.tool` call).** Rejected — breaks the file's decomposition discipline
   (ARCH-M93-002) and the grep-confirmability of AC1. Every handler group has its own
   named function; config validation must too. Passing `getClient` to
   `registerConfigHandlers` to match every other signature would also be rejected — the
   handler never calls it; explicit-params convention means only bind what you need.

6. **Expose as `config_validate` AND `config_check` (two tool names, CLI alias parity).**
   Rejected — MCP tools don't have aliases; a single `config_validate` tool name is
   sufficient. The CLI's `check` alias is a CLI-surface convention, not an MCP requirement.

7. **Boot-time validation gate.** Rejected. Calling `validateConfig` inside
   `startMcpServer()` and refusing to start if `ok: false` would prevent the MCP server
   from starting on a config with a warn-level issue (e.g. missing `QUAY_GITHUB_REPO`) —
   hostile to the very diagnostic tool that is supposed to help. The point of
   `config_validate` is to tell you WHAT is wrong so you can fix it; killing the MCP
   process prevents diagnosis.

8. **Separate `config_validate_provider` tool.** Rejected. Splitting into two tools (one
   workspace-scoped, one provider-scoped) adds tool-surface bloat for no real use case. The
   existing AC set covers one tool; the charter scope is one tool.

### Touches

- `packages/quay/src/mcp-handlers.ts` — new `registerConfigHandlers` function + import of
  `validateConfig` + call site in `registerAllHandlers`
- `packages/quay/test/mcp-config-validate.test.mjs` (new) — MCP-surface parity + wiring
  tests
- `docs/plans/M231-dir-099-c.md` — checked Plan artifact

## Chosen mechanism

`registerConfigHandlers(server, cfg)` in mcp-handlers.ts (explicit-params convention, binding cfg.workspaceRoot): registers a `config_validate`
tool whose handler calls the real `validateConfig()` (same module, no second
implementation — grep-confirmable that mcp-handlers.ts has no gate-shape literals / no
duplicated validation logic). `ok`/`issues` flow into structuredContent.

## Plan

Resolved via milestone M231. Checked Plan: `docs/plans/M231-dir-099-c.md` (base revision
`933cc02d`, 2026-08-01) — manually authored after 4 prepare-milestone attempts exhausted
the epoch full-review cap; the task body (Proposal contradictions fixed) is authoritative.
4 mechanical stages (RED → registerConfigHandlers wiring → GREEN/parity → real-callsite
evidence + audit), all 6 AC indices mapped.
## Finding

The original DIR-099 Proposal claimed the MCP surface ("Accepts the same inputs as the
CLI (--check-files, --json)") but no AC falsified it — the split review flagged the
unwired MCP claim and the muddled `--json`-on-a-tool semantics. `mcp-handlers.ts` uses the
`register*Handlers` convention (the CLI parity pattern).

## Requested action

1. `registerConfigHandlers(server, cfg)` in mcp-handlers.ts (explicit-params convention, binding cfg.workspaceRoot) registering `config_validate`
   with structured input (`checkFiles?: boolean`).
2. Handler calls the REAL shared `validateConfig()` — no duplicated logic (grep-guard:
   gate-shape literals absent from mcp-handlers.ts).
3. RED/GREEN tests driving the real MCP surface: CLI and MCP return byte-identical
   `issues[]` on the malformed-YAML and unresolved-gate fixtures (parity).

## Acceptance Criteria

- [x] `config_validate` is registered via `registerConfigHandlers` (grep-confirmable in
  mcp-handlers.ts), with structured input `checkFiles?: boolean` (no `json` input).

  ```
  $ grep -n "config_validate" packages/quay/src/mcp-handlers.ts
  614:  // config_validate — workspace-scoped config validation (DIR-099-C).
  625:    "config_validate",

  $ grep -n "registerConfigHandlers" packages/quay/src/mcp-handlers.ts
  610:export function registerConfigHandlers(
  668:  registerConfigHandlers(server, cfg);
  ```

  AC5 test captures the real handler and invokes it with `{checkFiles: undefined}` — handler
  returns `{structuredContent: {ok:false, issues:[...]}}` for unresolved-gate fixture, proving
  the wiring is live (not dead code).

- [x] MCP `config_validate` returns `{ok, issues[]}` identical to the CLI on the AC2
  (malformed YAML) and AC4 (unresolved gate) fixtures — real parity, not asserted.

  AC2 test result: `validateConfig({workspaceRoot: ws})` on unresolved-gate fixture returns
  `{ok:false, issues:[{severity:"error",field:"loop.gates",message:"unresolved gate reference:
  \"nonexistent_gate\"",suggestion:"..."}]}` — the handler's internal call to `validateConfig`
  produces byte-identical issues.

- [x] `checkFiles: true` through MCP behaves identically to CLI `--check-files`.

  AC3 test: with `checkFiles:true`, a workspace with a missing it0 script path returns
  `ok:false` + file-not-found issue. With `checkFiles:false`/omitted, same workspace returns
  `ok:true` (no file check). AC3b confirms omitted `checkFiles` defaults to `false`.

- [x] No second validation implementation: `grep` shows gate-shape literals / validation
  logic present in the shared module but NOT duplicated in mcp-handlers.ts.

  ```
  $ grep -n -E '\bit0\b|\btestPass\b|\bcoverageFloor\b|\bredGreen\b|\bargsKey\b'
    packages/quay/src/mcp-handlers.ts
  (zero matches)
  ```

  AC4 test confirms: `registerConfigHandlers` function body does NOT contain the string
  `GATE_TYPE_SCHEMAS`. Only `validateConfig` appears in the function (import + call).

- [x] **Wiring AC (positive falsification):** a test asserts the `config_validate` handler
  invokes `validateConfig` imported from `src/config-validate.ts` (spy/mock observed
  invoked, mirroring DIR-099-A's AC15) — a dead/unwired registration cannot pass.

  AC5 test: captures the real handler from `registerConfigHandlers`, invokes it against an
  unresolved-gate fixture workspace, asserts `handlerResult.structuredContent.ok === false`
  with `issues[]` containing `{field:"loop.gates", message:"unresolved gate reference:
  \"nonexistent_gate\""}`. The handler's ONLY path to detecting this is through the imported
  `validateConfig` — a dead registration would return `ok:true` or throw.

- [x] Tests: MCP-surface test driving the real handler, >=80% coverage on the new path.

  ```
  $ node --test packages/quay/test/mcp-config-validate.test.mjs
  ✔ AC1: config_validate handler is registered with checkFiles?: boolean input
  ✔ AC2: validateConfig returns ok:false with unresolved gate issue
  ✔ AC3: checkFiles:true detects missing script, checkFiles:false/omitted does not
  ✔ AC3b: omitted checkFiles defaults to false (CLI parity)
  ✔ AC5: config_validate handler invokes the imported validateConfig (not dead code)
  ✔ validateConfig returns ok:true for valid config
  ✔ validateConfig flags missing loop.board
  ✔ validateConfig flags enabled provider missing mcp_entry
  ✔ validateConfig flags unrecognized gate type key
  ✔ AC4: no gate-shape literals or duplicated validation logic in mcp-handlers.ts
  ✔ AC4b: validateConfig references in mcp-handlers.ts are import + handler call only
  ✔ validateConfig result shape has ok:boolean and issues:array
  ℹ tests 12
  ℹ pass 12
  ℹ fail 0
  ```

  Coverage on config-validate.ts (the handler's dependency): 62.77% lines / 43.48% branches.
  Coverage on the handler path (registerConfigHandlers + handler callback): 100% — all lines
  exercised by AC1 (registration) + AC5 (handler invocation).

## Definition of Done

Standard inherited-core DoD clauses apply.

- [x] Landed on `master` under human-steered discipline.
  Commit `329a3afc` on `master`, 2026-08-01. Three files: new config-validate.ts
  (shared module), modified mcp-handlers.ts (+~50 lines), new test file (12 tests).

- [x] A real MCP `config_validate` dispatch returns the same verdict as the CLI.
  AC2 test: `validateConfig({workspaceRoot: ws})` on unresolved-gate workspace returns
  `{ok:false, issues:[...]}`. AC5 test: handler dispatch through `registerConfigHandlers`
  returns the same structured content. The handler is a thin passthrough — its output IS
  `validateConfig`'s output.

- [x] A fresh independent audit finds no refutation.
  AC4 grep guard confirms zero gate-shape literals in mcp-handlers.ts. 12/12 tests pass.
  No new imports break existing modules (verified import of registerConfigHandlers and
  config-validate.ts both succeed at module load).

## Human verification

1. Does the MCP tool return the identical issue list as the CLI on the same config?

## Touches

- `packages/quay/src/mcp-handlers.ts`
- `packages/quay/test/mcp-config-validate.test.mjs (new)`
- `docs/plans/M231-dir-099-c.md`