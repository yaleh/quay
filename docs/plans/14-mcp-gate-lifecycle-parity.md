# Plan 14 — MCP parity for the QENG gate/lifecycle engine

Source task: `tasks/exp5-M-GATE-MCP-PARITY-GAP.md`. Milestone M53.

## Decision

Of the 7 QENG CLI commands (`gate`, `gate-log`, `complete`, `adjudicate`, `promote`, `retreat`,
`run`), **6 become MCP tools; `run` is deliberately excluded.**

| command | MCP tool? | reasoning |
|---|---|---|
| `gate` | yes → `gate_run` | single call, single verdict, single GateEvent append — fits MCP's request/response contract exactly like `task_check` already does. |
| `gate-log` | yes → `gate_log` | pure read-only query, no side effect — same shape as `task_list`. |
| `complete` | yes → `lifecycle_complete` | single guarded status write (ready→done) + one gate run — same shape as `task_write` plus a precondition. |
| `adjudicate` | yes → `lifecycle_adjudicate` | read-only audit pass, one GateEvent append, never writes status — bounded single call. |
| `promote` | yes → `lifecycle_promote` | one legal forward step, bounded, single call (delegates to complete for ready→done, runs the `dod` gate for todo→ready). |
| `retreat` | yes → `lifecycle_retreat` | one legal backward step, single call, `reason` is a required argument already (natural fit for a tool input field). |
| `run` | **no** | `run` (no `--once`) is an **unbounded, potentially long-lived autonomous loop** (`runLoop`, up to `maxIterations` iterations, each with I/O + a stop-sentinel check) — the opposite of MCP's single-call/single-response contract; a tool call that could run for an unbounded number of iterations blocks the calling agent's turn with no incremental feedback and no cancellation hook over MCP's stdio transport. `--once` (`runOnce`) is a single bounded observation, and _could_ be argued into a tool, but it does not add any capability an agent doesn't already have via `gate_run`/`lifecycle_complete` (an agent that wants "do the next actionable task" can already `task_list --status ready`, inspect `extra.acceptance`, then call `lifecycle_complete` on the one it picks — with the added benefit of being able to see and reason about *which* task it's advancing, rather than delegating that scan to an opaque tool call). Keeping `run` CLI-only preserves it as the "autonomous driver, run out-of-band" surface (its own doc comment: "this is what would eventually replace a hand-run prose outer-loop driver") — an AI agent's own MCP session is exactly the caller `run` is meant to stand in for, not a caller of it. This is recorded here per the task's AC4 exclusion-reasoning requirement. |

No new gate/lifecycle logic is written — every new tool's handler calls straight into the existing
`packages/quay/src/gate/{engine.js,gate-log.js,lifecycle.js}` exports (`runGate`, `runGateLogQuery`,
`resolveGateLogPath`, `runComplete`, `runAdjudicate`, `runPromote`, `runRetreat`), the same functions
`bin/quay.js`'s own `gate`/`gate-log`/`complete`/`adjudicate`/`promote`/`retreat` branches call — zero
duplicated logic, mirroring the CLI's own reuse discipline (task AC2).

## Design notes carried from the CLI branches into the MCP tools

- **`provider` argument** — every new tool takes the same optional `provider` argument as the
  existing 6 tools (routes through `getClient()`), for the same multi-Provider-workspace reasons
  documented at the top of `mcp-server.js`.
- **Gate-log path resolution** — `resolveGateLogPath(cfg.workspaceRoot, { file })` exactly as the CLI
  does; an optional `file` tool argument overrides the default `<workspaceRoot>/.quay/gate-events.jsonl`,
  mirroring `--file`.
- **`QUAY_ACCEPTANCE_CWD`** — `gate_run` (any gate) and `lifecycle_complete`/`lifecycle_promote`
  (which may delegate to the acceptance gate) set `process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot`
  before calling into the engine, exactly as the CLI's `gate`/`complete`/`promote` branches do — this is
  process-global state the CLI already relies on, so the MCP tool must set it identically or a relative
  `extra.acceptance` meter would resolve against the wrong cwd.
- **`gate` default** — `gate_run`'s tool-level default gate name is `"acceptance"`, matching the CLI's
  `vf.gate ?? "acceptance"` (the *engine's* own default, used by direct programmatic callers, stays `"dod"`
  — untouched, per engine.js's own doc comment). An explicit `gate` tool argument (e.g. `"dod"`) overrides it.
- **Exit-code → isError mapping** — the CLI's `process.exitCode = ok ? 0 : 1` pattern has no meaning over
  MCP; instead each tool returns `{ content, structuredContent: { ok, reason, ... } }` on both pass AND
  fail (a gate FAIL is a normal, successful tool call reporting `ok:false` — not an `isError:true`, exactly
  as `task_check`'s existing MCP tool already treats a failing gate as a successful read, not a crash).
  `isError:true` is reserved for genuine call failures: unknown task id, unknown gate name, illegal
  transition (`assertTransition` throws), missing task, and `retreat`'s missing/empty `reason` guard
  (mirrors `task_write`'s existing `try { ... } catch` → `isError:true` shape).
- **`retreat`'s `reason`** — required tool argument (`z.string()`, not `.optional()`), enforced at the
  zod-schema level in addition to `runRetreat`'s own internal guard, so a missing reason is rejected by
  MCP's own input validation before the handler even runs (fails closed earlier than the CLI, which
  only checks inside `runRetreat`).

## Test plan

New tests are added to `packages/quay/test/mcp-server.test.mjs` (the file's existing style: a real
`quay mcp` subprocess + a real MCP client, spawned against a temp native-provider workspace), covering
per new tool:
- one happy path (state transition / verdict observed, cross-checked against a direct `gate-log`/task
  read where relevant)
- at least one guarded-failure path (illegal transition / missing reason / gate fail / unknown task)

Fixture tasks are created via `quay-native task create` with an `extra.acceptance` meter seeded via
`task edit --acceptance` (a trivial `exit 0` / `exit 1` shell command), mirroring `docs/plans/12-exp5-
quay-gate-wiring.md`'s committed-fixture precedent, but ephemeral (temp workspace, not committed) since
these are pure regression tests, not a reproducible-by-hand demo command.

## Line budget

This plan's own scope: ~6 new `server.registerTool` blocks in `mcp-server.js` (each ~30-50 lines,
mirroring the existing tools' size) + one new test block in `mcp-server.test.mjs` (~150-250 lines).
Well under the 2000-line milestone ceiling; single phase, no stage split needed.
