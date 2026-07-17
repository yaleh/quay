# Simulated User Audit — MCP Power User Persona
Date: 2026-07-17
Iteration: 9
Persona: MCP power user (AI agent via MCP tools)

## MCP server status (stale or updated?) — CONCERNS

ENV-001 confirmed active. The MCP tool schema exposed to this agent (via ToolSearch) shows
`"label": {"type": "string"}` — the pre-QX-032 schema. This is the stale running server process.
The source code at `packages/quay/src/mcp-server.js` line 205 correctly implements
`z.union([z.array(z.string()), z.string()])`, and all unit tests pass (Block 16 fully green).
An AI agent connecting to the currently-running MCP process will see the stale schema and
will not know that array input is accepted.

## Multi-label array parameter — CONCERNS

Source code: PASS. The implementation at line 205 of mcp-server.js and handler at lines 214-222
correctly implements array normalization and AND-join. Unit tests (Block 16): all PASS.

Live MCP schema: CONCERNS. The running server still advertises `label` as a plain string type.
An array call cannot be verified end-to-end via the live MCP because the schema does not expose
the `array` type to the client; the MCP SDK may reject or silently coerce the array before
the handler sees it. Direct array invocation was not attempted via the stale live process
(risk of schema validation rejection at SDK layer).

## AND-join semantics — PASS

Unit tests confirm AND-join semantics (Block 16, assertions verified via node --test):
- `label: ["experiment-4", "iteration-9"]` returns only tasks with BOTH labels (1 task: MLT-2)
- `label: ["experiment-4"]` (single-element array) returns 3 tasks
- `label: []` (empty array) returns all 4 tasks (no filter applied)

Live verification using single-label string calls:
- Created SU-TEST-001 (labels: LABEL-A, LABEL-B, iteration-9-test)
- Created SU-TEST-002 (labels: LABEL-A, iteration-9-test)
- `label: "iteration-9-test"` returns both tasks — confirms single-label filter works
- AND-join logic code path verified in source (handler line 219-222:
  `labelFilters.every(l => Array.isArray(t.labels) && t.labels.includes(l))`)

## Backward compat (string label) — PASS

Live test: `mcp__quay__task_list` with `{"label": "experiment-4"}` returned 25 tasks (all
experiment-4 labeled tasks). String label form fully functional through live MCP.
Source: handler line 215 `const labelFilters = Array.isArray(label) ? label : (label ? [label] : [])`
correctly normalizes string to one-element array.
Unit test assertion: "task_list label='experiment-4' (string, backward-compat) returns no error (QX-032)" — PASS.

## Search + multi-label compose — PASS

Live test: `mcp__quay__task_list` with `{"label": "experiment-4", "search": "fix"}` returned 2 tasks
(QX-006, QX-007 — both have "Fix" in their titles and the "experiment-4" label). Filter composition
works correctly; search is applied after label filter as designed.
Source code confirms filter order: status → label → prefix → search → pagination (line 226-238).

## New gaps found

**ENV-001 (existing, minor — now re-confirmed blocking for this persona)**: The running MCP server
process is not updated after code changes. An MCP power user agent sees the stale schema advertising
`label` as `{"type": "string"}` only. Without a server restart, the agent:
  - Cannot discover the array-form capability from the schema
  - May not pass array values safely (MCP SDK may validate against the exposed schema at the
    client or transport layer before the handler ever sees the value)
  - Cannot use the full AND-join multi-label capability just added in QX-032

This is a known gap (ENV-001) flagged in prior iterations. For MCP power users, this is
**significant** rather than minor: the feature exists in code but is inaccessible through the
live MCP interface until the process is restarted. The iteration-9 improvement (QX-032) is
effectively blocked for live MCP consumers until restart.

**New gap SH-002 (minor)**: The `task_write` tool uses `labels` (plural) while `task_list`
uses `label` (singular) for its filter parameter. This asymmetry is a minor discoverability
hazard for MCP power users who might try `labels: ["A","B"]` on task_list. The field names are
intentionally different (write replaces the label set; list filters by label), but the naming
divergence could cause confusion without careful schema reading. No change recommended — documents
in gap-list.md as minor/known.

## Overall: CONCERNS

QX-032 is correctly implemented at the source and unit-test level (all Block 16 assertions pass).
The blocking concern is ENV-001: the live MCP server exposes the stale schema. Backward compat
and search+label compose are confirmed PASS via live tests. The multi-label array form cannot be
exercised end-to-end via the live MCP until the server process is restarted.

Cleanup: test tasks SU-TEST-001 and SU-TEST-002 were created during this audit and should be
removed by the adjudicator.
