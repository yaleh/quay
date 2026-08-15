---
id: DIR-103-B
title: "MCP surface: gate_run dryRun: true executes the acceptance command
  without recording a GateEvent"
status: ready
labels:
  - directive
  - human-steered
  - milestone-candidate
parent: DIR-103
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    DIR-103-B experiments/quay-perpetual-stream/charters/M224-dir-103-b.md
    milestones/M224/absorb-entry.md
---
**type:** execution

## Proposal

Add a `dryRun` parameter to the MCP `gate_run` tool. When `dryRun: true`, the tool
executes the acceptance command via the shared `runAcceptance()` path the `acceptance`
gate itself uses (registry.ts) and returns `{ ok, reason, ... }` WITHOUT appending a
GateEvent and WITHOUT mutating task status.

The skip-append lives in the ENGINE, not the handler: `runGate` (engine.ts) gains a
`dryRun` option in `RunGateArgs` that gates the `appendGateEvent` call at engine.ts:64 —
the single place any dry-run traverses. The MCP handler is a thin pass-through that
forwards `dryRun` to `runGate` and performs no local skip logic (no second
implementation).

This child is self-contained and falsifiable against the CURRENT codebase — the engine
`runGate` dryRun option plus the existing `acceptance` gate's `runAcceptance()` runner —
without requiring any CLI surface. The CLI `--dry-run` (`quay gate --dry-run <task-id>`)
is the unlanded sibling DIR-103-A's scope; that cross-child dependency is declared in the
parent DIR-103, not in this child's own Proposal.

The original DIR-103 Proposal claimed this in DoD1 ("both CLI and MCP gate_run with
dryRun: true") but had NO Acceptance Criterion covering the MCP surface — all 8 ACs were
CLI-only. This child closes that gap with a real, falsifiable MCP AC (production
callsite + no-GateEvent proof). Second child of the DIR-103 split.

## Chosen mechanism

Extend the `gate_run` tool schema in `packages/quay/src/mcp-handlers.ts` (the gate_run
handler at mcp-handlers.ts:286-303 today exposes provider/id/gate/timeoutMs/file/cwd only)
with an optional `dryRun: boolean` param. When `dryRun: true`, the handler forwards it to
the engine: add a `dryRun?: boolean` field to `RunGateArgs` in
`packages/quay/src/gate/engine.ts`, and in `runGate` skip the `appendGateEvent` call
(engine.ts:64) when `dryRun: true`. The acceptance command is still executed by the same
`runAcceptance()` runner the `acceptance` gate uses (registry.ts, identical verdicts) —
the engine is the single place the skip-append lives, shared by any dry-run surface; the
handler performs no local skip logic. `dryRun: false`/omitted behaves exactly as today
(GateEvent appended, status lifecycle as normal).

## Plan

Resolved via milestone M224. Checked Plan: `docs/plans/M224-dir-103-b.md` (base revision
`96123543`, 2026-08-01) — manually authored after 4 prepare-milestone attempts exhausted
the epoch full-review cap; the task body (corrected through PlanCheck rounds) is
authoritative. 4 mechanical stages (RED → engine+handler wiring → GREEN/coverage →
real-callsite evidence + audit), all 6 AC indices mapped.
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

- [x] MCP `gate_run` with `dryRun: true` executes the acceptance command and returns the
  result WITHOUT appending a GateEvent (real gate-event-log before/after).
- [x] MCP `gate_run` with `dryRun: true` leaves the task's status unchanged.
- [x] MCP `gate_run` with `dryRun: false` or omitted behaves byte-identically to
  pre-change (GateEvent appended, normal lifecycle).
- [x] `dryRun` is a real parameter in the `gate_run` tool schema (grep-confirmable in
  `mcp-handlers.ts`), not prompt-guidance.
- [x] The dryRun skip-append lives in exactly ONE place — `runGate`'s engine path, via a
  `dryRun?: boolean` field in `RunGateArgs` that gates the `appendGateEvent` call — and
  the MCP `gate_run` handler is a thin pass-through with no local skip logic
  (grep-confirmed: `appendGateEvent` appears in the engine only, not in the handler).
  The shared `runAcceptance()` runner executes the command (no second implementation).
- [x] Tests: driving the real `quay mcp` subprocess, >=80% coverage on the dryRun path.

## Evidence (2026-08-15, inner impl on `task/DIR-103-B`)

**before/after gate-event-log 实测** (real `quay mcp` subprocess, `<workspaceRoot>/.quay/gate-events.jsonl`):

```
=== BEFORE dryRun:true ===   log lines: 0
=== dryRun:true verdict ===  ok:true, event id 1164aaff-… generated in the return, NOT written
=== AFTER dryRun:true  ===   log lines: 0   (zero GateEvents appended)
=== status after dryRun:true ===  ready     (unchanged)
=== dryRun omitted verdict ===  ok:true
=== AFTER dryRun omitted ===   log lines: 1   (exactly one GateEvent appended)
log content: {"id":"7762e599-…","pipeline_id":"EVIDENCE","gate":"acceptance","verdict":"pass",…}
```

New test `mcp-gate-dryrun.test.mjs` (12 assertions green): `dryRun:true` on PASS (ok:true, 0→0 events) and FAIL (ok:false, 0→0 events) + status `ready` unchanged; `dryRun` omitted (0→1) and `dryRun:false` explicit (0→1) both append exactly one GateEvent. Clean-exit teardown via `transport.close()` (stdin.end → clean child exit; never `child.kill`).

**grep 证据 (AC4/AC5)**:
- `mcp-handlers.ts:328` `dryRun: z.boolean().optional()…` — real schema param.
- `mcp-handlers.ts:331` destructured param `…, cwd, dryRun` binds the value (three-edit wiring complete).
- `mcp-handlers.ts:360` pure forward: `runGate({…, dryRun })` — no local skip logic.
- `grep -n appendGateEvent mcp-handlers.ts` → **ZERO** matches; `engine.ts` → `:116` the single skip-append site behind `if (!dryRun)` (engine.ts:115).
- `runAcceptance` still the shared runner: `registry.ts:53` (the `acceptance` gate) calls `runAcceptance` from `acceptance-runner.ts` — one definition, no second implementation.

**Coverage (AC6)** — `node --experimental-test-coverage --test packages/quay/test/mcp-gate-dryrun.test.mjs`:
`engine.ts` 96.64% lines (only uncovered: unrelated fail-open catch lines 29-30/39-40); `mcp-handlers.ts` 68.83% overall (large file; dryRun-specific lines 328/331/360 are NOT in the uncovered list → 100% on the dryRun path). DryRun guard `if (!dryRun)` engine.ts:115 covered (child coverage merged via clean exit).

**Related suites green**: `gate/gate-ergonomics/lifecycle/gate-config-loader/mcp-config-validate` (106 tests), `mcp-server.test.mjs` (full pass), `tsc --noEmit` clean. `acceptance.test.mjs` untouched (not a touch).

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
- `packages/quay/src/gate/engine.ts`
- `packages/quay/test/mcp-gate-dryrun.test.mjs (new)`
- `docs/plans/M224-dir-103-b.md`
**Grounded facts for Plan authors (2026-08-01, from real PlanCheck rounds):**

1. **`runAcceptance` has SIX production call sites** — registry.ts:100 (the `acceptance`
   gate), gate/factories/{adr.ts:49, fixed-script.ts:21, it0.ts:31, red-green.ts:28+32,
   test-pass.ts:23}. The invariant is ONE runner DEFINITION
   (acceptance-runner.ts:36, no duplicated implementation) — the AC5 evidence must grep the
   DEFINITION site, never claim "a single call site" (that grep would be refuted).
2. **AC2's RED premise is vacuous**: `gate_run` on the current codebase never mutates task
   status regardless of dryRun (the dryRun:true status-unchanged case PASSES pre-change).
   The real RED/GREEN differentiator is AC1 — a GateEvent IS appended without dryRun and is
   NOT with dryRun:true. AC2 is a safety assertion that happens to already hold; do not
   frame it as RED-then-GREEN.
3. **Node `--experimental-test-coverage` merges child-process coverage only on a CLEAN
   child exit.** A child terminated by SIGTERM/SIGKILL contributes ZERO coverage — the
   per-file table is empty. If the real-`quay mcp` subprocess test teardown uses
   `child.kill`, engine.ts's `if (!dryRun) appendGateEvent` guard and the handler's
   `dryRun,` forward never appear in the coverage report and AC6 is undemonstrable. Use a
   clean-exit teardown (send a graceful quit command, or assert coverage on the parts not
   gated behind the killed subprocess).

5. **The MCP gate_run handler needs THREE edits, not two**: (a) inputSchema `dryRun:
   z.boolean().optional()` after the `cwd` field (mcp-handlers.ts:300), (b) add `dryRun`
   to the handler's DESTRUCTURED parameter list at mcp-handlers.ts:303 (`async ({

   provider, id, gate, timeoutMs, file, cwd }) =>`) — WITHOUT this, `dryRun` is not bound
   in handler scope and the forward always passes undefined (silent no-op), and (c) add
   `dryRun,` to the forwarded `runGate({...})` args at mcp-handlers.ts:321.
6. **mcp-server.test.mjs line anchors**: gate_run callTool assertions at 1394-1410
   (GATE-PASS 1396, GATE-FAIL 1402, NOPE-999 1408); cwd-threading assertions at
   1435-1452 (callTool 1437/1443/1449). Lines 1417-1430 are GATE-CWD task-creation
   execFileSync, not threading assertions.

4. **`packages/quay/test/acceptance.test.mjs` is NOT a DIR-103-B touch** — the MCP dry-run
   test lives in the new `mcp-gate-dryrun.test.mjs`; the `(or sibling MCP-surface test)`
   parenthetical was removed. Keep acceptance.test.mjs out of Touches (it is not edited by
   this child).
