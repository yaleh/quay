---
id: exp5-DEFECT-M114-AUDIT-SESSION-ID-MECHANISM
title: "defect: Agent-tool audit dispatch doesn't produce a genuinely distinct
  session id for audit-independence self-report"
status: todo
labels:
  - milestone-candidate
  - defect
parent: null
children: []
extra:
  schema: v1
---
## Proposal

While dispatching M114's mandatory adversarial acceptance audit (`Agent` tool, `general-purpose`
subagent, fresh context, `run_in_background=true`), the dispatched subagent's own env var
introspection (`CLAUDE_CODE_SESSION_ID`) read back **identical** to the orchestrator's own session
id — not a fresh/distinct value. Confirmed via the actual audit artifact
(`milestones/M114/audits/iteration-0-acceptance-audit.md`, pre-fix) and via
`audit-independence-check.ts`, which correctly FAILed closed on it ("audit artifact carries NO
recorded session/agent id" — the self-reported line didn't even match the required `Audit session
id:` pattern, and once corrected to the literal self-reported env var, would have FAILed as
"EQUALS the orchestrator's own id — self-audit, not independent").

**Root cause:** this harness's `Agent` tool spawns subagents as nested contexts within the SAME
underlying session process — they inherit `CLAUDE_CODE_SESSION_ID` from the parent rather than
getting a freshly-assigned one. The audit-role instructions (in `inherited-core.md`'s
"Adversarial-audit role" section and/or the ad-hoc dispatch prompts written at each ABSORB) assume
a dispatched subagent CAN self-report a genuinely distinct session id by reading its own env — that
assumption does not hold for `Agent`-tool dispatch in this harness. It may have held for whatever
mechanism produced M105's audit (`milestones/M105/audits/iteration-0-acceptance-audit.md` shows a
genuinely different-looking UUID, `8c2e96ff-...` vs orchestrator `a653b2e9-...` — worth checking
that milestone's actual dispatch method, since it's inconsistent with what M114 observed).

**What actually IS a reliable distinct identifier for `Agent`-tool dispatch:** the `agentId` the
`Agent` tool itself returns to the orchestrator at dispatch time (e.g. `a9fcee6a21cbf655b` for
M114's audit) — a harness-assigned handle for that specific dispatch, captured by the orchestrator
BEFORE the subagent produces any output (satisfying DIR-034's anti-forgery dispatch-record
requirement exactly). M114 worked around this by overwriting the audit artifact's self-reported
(non-distinct) session line with the orchestrator-observed `agentId`, corroborated via the existing
dispatch-record file — this got M114's own audit-independence gate to PASS, but is a per-ABSORB
manual workaround, not a fix to the underlying instruction/mechanism.

**Fix needed (one of):**
1. Update the audit-dispatch instructions (wherever the "Adversarial-audit role" prompt template
   lives — `inherited-core.md`, and/or a per-ABSORB dispatch-prompt convention in `OUTER-LOOP.md`)
   to tell the ORCHESTRATOR (not the subagent) to record the `Agent`-tool-assigned `agentId` as the
   audit's session id in the artifact, rather than instructing the subagent to introspect its own
   env var for a value that won't be distinct in this harness.
2. Investigate whether OTHER dispatch mechanisms (a literal separate `claude -p` CLI subprocess via
   Bash, if that's what produced M105's genuinely-distinct id) DO get a fresh `CLAUDE_CODE_SESSION_ID`
   and, if so, document which dispatch mechanism to prefer for audit-independence purposes.

## Plan
N/A — small documentation/instruction fix once the preferred mechanism is confirmed; no code changes
to `audit-independence-check.ts` itself required (its corroboration logic already works correctly
once given the right distinct id — verified against M114's corrected artifact, which PASSed).

## Acceptance Criteria
- [ ] `inherited-core.md`'s "Adversarial-audit role" section (or wherever the dispatch-prompt
      convention lives) is updated to direct the ORCHESTRATOR to record the `Agent`-tool `agentId`
      (captured at dispatch time) as the audit's session id, not to rely on subagent self-report via
      env var.
- [ ] Confirmed (by testing or by reading M105's actual dispatch method) whether any OTHER dispatch
      mechanism in current use produces a genuinely fresh `CLAUDE_CODE_SESSION_ID`; documented which
      mechanism is authoritative going forward.
- [ ] A future milestone's real audit dispatch, following the corrected instructions, produces an
      artifact whose session id is correct WITHOUT requiring an orchestrator post-hoc correction (the
      M114 workaround pattern should not need to repeat).

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence).
- [ ] All 3 AC items above verified true.
- [ ] it0 DoD meta-enforcer passes all clauses.
