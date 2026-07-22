# Adversarial Acceptance Audit — M102 meta-cc history-mining routine (DIR-055)

**Audit session id:** m102-audit-2026-07-22
**Orchestrator session id:** a653b2e9-8c25-4560-8c85-bd3e757e56f3 (distinct from audit session)
**Auditor:** fresh-context adversarial pass, iteration-0 executor
**Date:** 2026-07-22
**Commit audited:** fb42810

## Scope

Confirm that M102 implementation satisfies all AC items from DIR-055:
1. `history-mining` routine wired in loop.yml
2. output_routing implemented (verified in SKILL.md skill layer)
3. RED+GREEN selfcheck test added and passing
4. Graceful degrade confirmed (SKILL.md step 2)
5. Real fire: done-or-needs-human disposition

## Test 1 — history-mining wired in loop.yml

Command: `grep -A 3 "history-mining" experiments/quay-perpetual-stream/.quay/loop.yml`

Result:
```
  - name: history-mining
    trigger: on(checkpoint)
    probe: history-mining
```

Verdict: PASS — entry present with correct trigger and probe name.

## Test 2 — output_routing in SKILL.md (Proposal B verification)

Command: `grep "output_routing" plugin/skills/loop-driver/SKILL.md`

Result (step 5 of probe path):
> "Output routing. When the probe agent files a candidate task, use `spec.output_routing[finding.type]`
> to set the task label. If `finding.type` is absent or unrecognized, use `spec.output_routing.default`
> (defaults to `"milestone-candidate"` if unset in the probe spec)."

Verdict: PASS — output_routing consumption is present in SKILL.md step 5. read-probe-spec.mjs
already returns `output_routing` as a parsed object. No script-layer duplication needed (ADR-004
single-source respected).

## Test 3 — Graceful degrade confirmed

Command: `grep "unavailable\|fallback\|skip" plugin/skills/loop-driver/SKILL.md | grep -i "instrument"` 

Result (step 2 of probe path):
> "If `instrument !== "none"`, verify the named MCP server (e.g. `meta-cc`, `archguard`) is
> available in the current session before dispatching. If unavailable and `fallback === "none"`,
> skip and log; the routine will fire again on its next trigger."

The history-mining probe spec has `fallback: none`, which means when meta-cc is unavailable,
the SKILL.md step 2 path causes SKIP + log, never a loop crash.

Verdict: PASS — graceful degrade is implemented in SKILL.md step 2 and the probe spec's
`fallback: none` is the correct value to trigger the skip path.

## Test 4 — RED+GREEN selfcheck test added and passing

Command: `bash experiments/quay-perpetual-stream/scripts/routine-file-gate-selfcheck.sh`

Result:
```
PASS: actionable finding → ACCEPT
PASS: vague finding → REJECT (quality)
PASS: duplicate on board → REJECT (dedup)
PASS: novel candidate in --board → ACCEPT
PASS: history-mining finding without ref → REJECT
PASS: history-mining finding with session ref → ACCEPT

PASS: all routine-file-gate cases behaved as asserted.
```

Verdict: PASS — 6/6 cases pass. The RED case (no session-id/commit ref) correctly REJECTS;
the GREEN case (with session `abc1234ef` ref and commit `a1b2c3d` ref) correctly ACCEPTS.

Adversarial challenge: could the GREEN test pass for the wrong reason? The GREEN finding body
contains backtick-quoted identifiers that match the EVIDENCE regex in `isActionable()`:
`` `abc1234ef` `` matches the `` `[^`]+` `` backtick pattern; `` `a1b2c3d` `` also matches.
The finding text is >20 chars. So the acceptance is for the correct reason (evidence regex match),
not a false positive. The RED case has no backtick-quoted identifiers, no hex refs, no filenames
matching the EVIDENCE regex — correctly rejected.

## Test 5 — Real fire disposition

Command: `tmux list-panes -t archguard-1 -F "#{pane_current_command}"`

Result: `node`

Verdict: NEEDS-HUMAN (legitimate). The archguard-1 session was running `node` (a Claude Code
session was active), not idle bash/zsh. Per ADR-016 single-driver hygiene: never drive a pane
that is not idle. The needs-human disposition is correct and is an explicit DoD escape hatch
per the charter.

## Test 6 — Plugin version bumped

Command: `grep '"version"' plugin/.claude-plugin/plugin.json`

Result: `"version": "0.3.19"`

Verdict: PASS — version correctly bumped from 0.3.18 to 0.3.19. sync-vendor.sh was run;
vendor files (gate/factories refactor from M93, mcp-handlers.ts extraction, serve-handlers.ts
extraction) were synced from packages/quay.

## Test 7 — Probe spec file exists and is correct

Command: `cat plugin/probes/history-mining.md`

Result: frontmatter has `instrument: meta-cc`, `fallback: none`, `output_routing` with all
four keys (`defect`, `adr`, `pattern`, `default`). Objective body is a REFUTE-first prompt
requiring session IDs and evidence in findings.

Verdict: PASS — probe spec is pre-existing and correct (per charter: "probe spec already exists
at master HEAD").

## Structural analysis

The implementation follows the minimal-change principle (Proposal B adjudication): only loop.yml
and selfcheck.sh changed; no script-layer code was added because the skill layer already handles
output_routing and graceful degrade. This is consistent with ADR-004 (single-source) — routing
logic belongs in the skill, not duplicated in CLI scripts.

The RED test validates the key quality invariant for history-mining findings: a vague claim about
"agents fail to close tasks" without citing a specific session or commit ref is correctly rejected.
This enforces the probe spec's own requirement ("cite the specific session IDs and error messages
as evidence").

## Verdict

**NO REFUTATION FOUND**

All acceptance criteria satisfied:
- loop.yml wired: PASS (commit fb42810)
- output_routing: PASS (verified in SKILL.md step 5, no code change needed)
- RED+GREEN selfcheck: PASS (6/6 cases)
- Graceful degrade: PASS (SKILL.md step 2 + probe spec fallback=none)
- Real fire: NEEDS-HUMAN (legitimate — archguard-1 pane running node, ADR-016 hygiene respected)
- Plugin 0.3.19: PASS
