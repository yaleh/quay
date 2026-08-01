---
id: DIR-103-B
title: "MCP surface: gate_run dryRun: true executes the acceptance command without recording a GateEvent"
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

Add a `dryRun` parameter to the MCP `gate_run` tool. When `dryRun: true`, the tool
executes the acceptance command (same shared `runAcceptance()` path as the CLI) and
returns `{ ok, reason, ... }` WITHOUT appending a GateEvent and WITHOUT mutating task
status.

The original DIR-103 Proposal claimed this in DoD1 ("both CLI and MCP gate_run with
dryRun: true") but had NO Acceptance Criterion covering the MCP surface — all 8 ACs were
CLI-only. This child closes that gap with a real, falsifiable MCP AC (production
callsite + no-GateEvent proof). Second child of the DIR-103 split.

## Chosen mechanism

Extend the `gate_run` tool schema in `packages/quay/src/mcp-handlers.ts` (the gate_run
handler at mcp-handlers.ts:286-303 today exposes provider/id/gate/timeoutMs/file/cwd only)
with an optional `dryRun: boolean` param. When true, the handler invokes the same
acceptance runner the CLI `--dry-run` uses (shared module, identical verdicts), skips the
gate-event store append, and returns the execution result. `dryRun: false`/omitted
behaves exactly as today (GateEvent appended, status lifecycle as normal).

## Plan

N/A — resolved via a human-steered milestone. The resolving milestone authors a checked
`docs/plans/*.md` plan (DIR-117-B prepared-gate artifact) before implementation.

## Finding

`packages/quay/src/mcp-handlers.ts:286-303` — the `gate_run` tool schema exposes
provider/id/gate/timeoutMs/file/cwd only, no `dryRun` param today. DoD1's original MCP
claim had no AC demanding a real production-callsite / no-GateEvent proof. DIR-117's
mechanism-claim wiring coverage would reject the "MCP dryRun" claim if it remains
un-AC'd — this child makes it real.

## Requested action

1. Add `dryRun?: boolean` to the `gate_run` tool schema in `mcp-handlers.ts`.
2. When `dryRun: true`: run acceptance via the shared runner, return the result, append
   zero GateEvents, mutate zero lifecycle state.
3. RED/GREEN tests driving the real `quay mcp` subprocess: `dryRun:true` appends no
   GateEvent and leaves status unchanged; `dryRun:false` behaves as today.

## Acceptance Criteria

- [ ] MCP `gate_run` with `dryRun: true` executes the acceptance command and returns the
  result WITHOUT appending a GateEvent (real gate-event-log before/after).
- [ ] MCP `gate_run` with `dryRun: true` leaves the task's status unchanged.
- [ ] MCP `gate_run` with `dryRun: false` or omitted behaves byte-identically to
  pre-change (GateEvent appended, normal lifecycle).
- [ ] `dryRun` is a real parameter in the `gate_run` tool schema (grep-confirmable in
  `mcp-handlers.ts`), not prompt-guidance.
- [ ] The MCP dry-run path shares the same acceptance-runner module as the CLI
  `--dry-run` (no second implementation).
- [ ] Tests: driving the real `quay mcp` subprocess, >=80% coverage on the dryRun path.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] A real MCP `gate_run` `dryRun:true` dispatch shows execution with zero GateEvents
  and zero status mutation.
- [ ] A fresh independent audit finds no refutation.

## Human verification

1. Does MCP `gate_run` with `dryRun:true` genuinely skip the GateEvent append?
2. Is `dryRun` a real schema parameter with a production callsite, not prompt prose?

## Touches

- `packages/quay/src/mcp-handlers.ts`
- `packages/quay/test/acceptance.test.mjs` (or sibling MCP-surface test)
- `docs/plans/M224-dir-103-b.md`
