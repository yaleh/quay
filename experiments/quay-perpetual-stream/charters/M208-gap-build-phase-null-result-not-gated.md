# M208 — gap-build-phase-null-result-not-gated: positive-outcome Build-phase gate

**Task:** gap-build-phase-null-result-not-gated · **Class:** development
**Value type:** defectFix · **Deliverable:** yes · **Charter tokens:** ~0.1 K
**type:** execution · **highRisk:** no

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ > 0 (defect-fix, deliverable). The Build-phase gate in `execute-milestone.js` currently only
rejects `outcome === 'needs-human'` — a terminally-errored `agent()` call returning `null` silently
passes through to Audit/Gate/Land. This was observed live in M192 (DIR-120 dispatch,
`wf_b57d3610-224`): the Build agent hit an API error mid-response, `agent()` returned `null`, and
the workflow advanced through Audit and Land with `Build outcome: null` in its own prompt. The only
reason that milestone survived was the Land agent's independent diligence. Fix: change to a
positive-outcome check (`outcome !== 'done'`) — surgical, 2 lines in both mirrors, regression-tested.

## Scope

Per `tasks/gap-build-phase-null-result-not-gated.md`'s own Requested action / Acceptance Criteria
/ Definition of Done — not duplicated here. Tiny scope: one condition change in
`.claude/workflows/execute-milestone.js` + `plugin/workflows/execute-milestone.js`, plus a
regression test fixture for the null-result path.

## Touches

Per the task's own `## Touches` list — not duplicated here.

## Done-when

Per the task's own AC/DoD. Real test output (not asserted) proves the null-result path returns
`needs-human` before Audit/Gate/Land dispatch.

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
