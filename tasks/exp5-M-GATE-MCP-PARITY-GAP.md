---
id: exp5-M-GATE-MCP-PARITY-GAP
title: "The entire QENG-1..4 gate/lifecycle/driver engine is reachable ONLY
  via raw CLI — quay's own MCP server (the surface an AI agent, quay's
  stated primary user, actually drives) exposes just the pre-QENG
  task_list/get/write/check + action_list/run tools, none of gate/complete/
  promote/retreat/adjudicate/run/gate-log"
status: todo
labels:
  - milestone-candidate
  - surface:mcp
  - milestone:M37-discover-post-qeng
extra: {}
---
## Provenance
Materialized at the M37-discover-post-qeng discovery milestone (2026-07-19), from direct inspection
of `packages/quay/src/mcp-server.js`'s `server.registerTool(...)` call sites, cross-checked against
this very session's own live `mcp__quay__*` tool list (independent corroboration from a second
source: the actual MCP tools available to this Claude Code session against this same repo's `.quay/
config.yml` are `action_list, action_run, task_check, task_get, task_list, task_write` — exactly the
6 pre-QENG tools, nothing from `gate/*.js`).

## Source
Live source inspection + live corroboration via this session's own available MCP tool set, this
milestone's report (`report.iteration-0.md`, "QENG survey" section).

## Value type / cadence
explore (identifies a design gap; the fix requires deciding an MCP tool surface, not a 1-line patch).

## Finding
`packages/quay/src/mcp-server.js` registers exactly 6 tools (grep for `server.registerTool(`, 6 call
sites, lines 203/274/309/352/395/434): `task_list`, `task_get`, `task_write`, `task_check`,
`action_list`, `action_run`. None of the QENG-1..4 surface — `runGate` (engine.js), `runComplete`/
`runAdjudicate`/`runPromote`/`runRetreat` (lifecycle.js), `runOnce`/`runLoop` (driver.js),
`runGateLogQuery` (gate-log.js) — is registered as an MCP tool. This is architecturally significant,
not a cosmetic gap: `quay`'s own README states it is "provider-agnostic Core: a CLI, a small web UI,
and an MCP client" — i.e. MCP is one of the three first-class surfaces, and per this experiment's own
methodology (Claude Code driving quay via MCP tools is the primary mode this whole BAIME apparatus
runs in), an AI agent working through MCP literally cannot invoke `quay gate`, `quay complete`,
`quay promote`, `quay retreat`, `quay adjudicate`, `quay run`, or query `gate-log` — the entire
DoD-as-runnable-meter mechanism (`OUTER-LOOP.md`'s own "Engine route" sub-note, exercised and
confirmed working THIS milestone via CLI: `quay gate QENG-5-DEMO-PASS` → exit 0,
`quay gate QENG-5-DEMO-FAIL` → exit 1) is invisible to exactly the kind of agent-driven workflow it
was built to serve — only reachable by a human, or an agent shelling out to the raw CLI binary
outside its normal MCP tool-call discipline (which this experiment's own directives, e.g. DIR-009's
insistence on quay-native tooling over ad hoc scripts, generally discourage as a pattern).

This is presented as a genuine architectural gap warranting a decision (not a demand to blindly wire
all 7 as MCP tools) — the AC below asks for that decision to be made explicitly and reasoned, because
some of the 7 (e.g. `run`'s long-lived autonomous loop) may not map cleanly onto MCP's typical
single-call-response tool shape and could legitimately warrant a narrower MCP surface (e.g. `gate`/
`complete`/`adjudicate`/`gate-log` as tools, `run`/`promote`/`retreat` deliberately left CLI-only)
rather than a 1:1 port.

## Acceptance Criteria
- [ ] A reasoned decision is made and documented on which of the 7 QENG commands (`gate`,
  `gate-log`, `complete`, `adjudicate`, `promote`, `retreat`, `run`) should become MCP tools, with
  the tradeoffs stated per command (e.g. `run`'s long-running-loop shape vs. MCP's single-call
  contract) — not a blanket "port everything" or "port nothing" without reasoning.
- [ ] The commands selected for MCP exposure are implemented as `server.registerTool(...)` entries in
  `packages/quay/src/mcp-server.js`, following the existing 6 tools' style (zod schema, description,
  handler delegating to the same underlying `src/gate/*.js` functions the CLI already uses — no
  duplicated gate/lifecycle logic, mirroring the CLI's own reuse discipline).
- [ ] New MCP-level tests (mirroring `packages/quay/test/mcp-server.test.mjs`'s existing style) cover
  each newly-registered tool's happy path and at least one guarded-failure path.
- [ ] If any of the 7 commands is deliberately EXCLUDED from MCP exposure, the exclusion reasoning is
  written down in this task's own resolution notes (or a follow-up doc it references) so a future
  milestone doesn't have to re-derive it from scratch.

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present, 1
per-milestone acceptance audit, 2 V_meta-lag, 3 line-budget, 4 impl-row, 5 no-self-exemption, 6
escrow-Δv, 7 test-floor — APPLIES, `surface:mcp` is product-touching, ≥80% coverage disposition or a
stated waiver required). No task-specific exemption from any clause.
- [ ] All standard clauses satisfied or explicitly N/A per their own trigger condition (re-verified at
  ABSORB, not assumed).

## Not selected (M51)
Considered at M51 SELECT (2026-07-20) alongside `exp5-M-GATE-README-DOCS` and
`exp5-M-GATE-CLI-ERROR-UX`, against `exp5-M-GATE-HELP-SYNOPSIS-GAP` (the winner). Per checkpoint
cp-50's recommendation to break a 5-milestone exploit-typed-pick drought, M51 picked the smallest,
most concrete, directly VT-moving exploit-typed fix available — a ~15-line, mechanically-testable
CLI-help synopsis gap. This MCP-parity gap is `explore`-typed (a design gap requiring a reasoned
decision on which QENG commands become MCP tools, not a 1-line patch) — a poor fit for this pass's
exploit slot, and larger in scope besides. Remains a live `milestone-candidate` for a future SELECT.
