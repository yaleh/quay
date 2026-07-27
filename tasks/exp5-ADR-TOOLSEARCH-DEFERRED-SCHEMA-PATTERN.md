---
id: exp5-ADR-TOOLSEARCH-DEFERRED-SCHEMA-PATTERN
title: "adr-draft: ToolSearch pre-fetch as mandatory first step for deferred
  tools — load-bearing but undocumented decision"
status: done
labels:
  - milestone-candidate
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

- [ ] ADR filed as `adr/ADR-NNN-toolsearch-deferred-schema-pattern.md` covering: (a) why schemas are deferred, (b) the mandatory pre-fetch pattern, (c) known failure modes (ToolSearch returns no results), (d) mitigation (verify schema returned before calling tool) -- [audit M-DIR119-C-CANARY: NOT satisfied as literally worded — `ls adr/ | grep -i toolsearch` returns nothing, no ADR file exists. Superseded by this task's own "Scope narrowed (2026-07-26)" section, which explicitly redirects the deliverable to a CLAUDE.md paragraph instead of an ADR. Left unchecked rather than ticked-against-a-different-deliverable — the AC text itself was never updated to match the pivot, which is a real checklist/narrative inconsistency, not just a formality.]
- [ ] `OUTER-LOOP.md` or the iteration executor prompt references the ADR for any iteration that uses MCP tools -- [audit: N/A under the narrowed scope (no ADR exists to reference); CLAUDE.md itself now carries the operational rule directly (see redefined-scope evidence below), which arguably serves the same purpose more directly than an OUTER-LOOP pointer would have]
- [ ] ADR status: accepted -- [audit: N/A, no ADR filed under the narrowed scope]

## Redefined-scope deliverable (audit-added citation, not an AC rewrite)

- [x] CLAUDE.md paragraph documenting the ToolSearch→deferred-tool dependency, per the "Scope
  narrowed (2026-07-26)" section's own redefinition -- [audit: `CLAUDE.md` lines 41-49 (the
  "`ToolSearch` is a mandatory pre-fetch step for deferred MCP tools" bullet, directly under the
  Tests section, M148-precedent style as the narrowed scope requested): covers why schemas are
  deferred, the mandatory pre-fetch pattern, the zero-results failure mode, and the
  verify-before-call mitigation — the same four elements (a)-(d) the original ADR AC asked for,
  just landed as prose in CLAUDE.md rather than a standalone ADR file.]

## Definition of Done

References the standard inherited-core DoD clauses.

- [ ] ADR file written and linked from `adr/` index -- [audit: not applicable under narrowed scope; no ADR file exists or was ever intended once scope narrowed]
- [ ] Adversarial audit disposition recorded -- [audit: recorded by this very audit pass, see this milestone's `audits/iteration-0-acceptance-audit.md`]


## Scope narrowed (2026-07-26)

Per review of stale-todo backlog: the ToolSearch pre-fetch pattern remains load-bearing
(required before every deferred MCP tool call). Rather than a full ADR, document it in
CLAUDE.md following the M148 precedent (Glob unavailability documented at lines 80-84).
Scope: one paragraph in CLAUDE.md documenting the ToolSearch→deferred-tool dependency.

## Touches

- `CLAUDE.md`

## Execution record

- **Milestone:** M-DIR119-C-CANARY (composite, 7 member tasks; DIR-119-C proof)
- **Iteration count:** 1 (direct-to-master build, no separate worktree — precedent: M187/M188/M189)
- **Realized Δv:** deliverable=yes under the narrowed scope — the CLAUDE.md paragraph (real
  deliverable per the 2026-07-26 scope narrowing) is confirmed landed; the original AC checklist
  text was never rewritten to match the pivot (disclosed drift, non-blocking).
- **Merge commit:** 23f43d5 (Build, direct on master) + this Land's Reconcile/write-back commit
- **Outcome:** DONE with disclosed CONCERNS — real narrowed-scope deliverable landed and confirmed;
  stale AC text flagged for a future cleanup pass rather than blocking closure.