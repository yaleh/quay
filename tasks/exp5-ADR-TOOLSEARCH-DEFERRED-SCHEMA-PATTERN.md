---
id: exp5-ADR-TOOLSEARCH-DEFERRED-SCHEMA-PATTERN
title: "adr-draft: ToolSearch pre-fetch as mandatory first step for deferred tools — load-bearing but undocumented decision"
status: todo
labels:
  - adr-draft
---
## Proposal

The Claude Code harness defers tool schemas for most MCP tools; they are not loaded at session
start. Before any deferred tool can be called, `ToolSearch` must be invoked with a `select:<name>`
query to fetch its schema. This is a load-bearing architectural constraint that affects every
iteration using quay, meta-cc, manda, or playwright tools.

**Evidence:** `get_work_patterns` output, project scope (2026-07-15 to 2026-07-21):
```json
{"tool_name": "ToolSearch", "count": 116}
```
ToolSearch is the 7th most called tool across all 34 sessions in the project history — above
`mcp__quay__task_write` (64 calls). Every MCP tool invocation is preceded by a ToolSearch.

**Session reference:** Visible across all sessions including `a653b2e9-8c25-4560-8c85-bd3e757e56f3`
(current session, 2026-07-21) — first action in this very iteration was `ToolSearch` to fetch
meta-cc tool schemas before any meta-cc call could proceed.

**Why this warrants an ADR:**
- The ToolSearch-first pattern is implicit knowledge — charters do not document it, the OUTER-LOOP
  does not mention it, and there is no guidance on what to do if ToolSearch fails or returns no results
- It adds a mandatory overhead turn before any productive tool use (verified from the 116 count vs
  the substantive MCP work that follows each one)
- If the deferred-tool behavior changes in a Claude Code update, every charter's iteration sequence
  breaks without any documented mitigation
- There is no circuit-breaker: if `ToolSearch select:<name>` returns 0 results, the subsequent
  tool call fails with `InputValidationError` — the loop has no documented handling for this

## Plan

N/A — ADR authoring: record the decision, its rationale, its costs (one turn overhead per tool
type per session), and its failure modes + mitigations.

## Acceptance Criteria

- [ ] ADR filed as `adr/ADR-NNN-toolsearch-deferred-schema-pattern.md` covering: (a) why schemas are deferred, (b) the mandatory pre-fetch pattern, (c) known failure modes (ToolSearch returns no results), (d) mitigation (verify schema returned before calling tool)
- [ ] `OUTER-LOOP.md` or the iteration executor prompt references the ADR for any iteration that uses MCP tools
- [ ] ADR status: accepted

## Definition of Done

References the standard inherited-core DoD clauses.

- [ ] ADR file written and linked from `adr/` index
- [ ] Adversarial audit disposition recorded
