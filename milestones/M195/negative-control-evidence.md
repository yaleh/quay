# M195 negative-control #1 evidence (pre-flip, stale receipt)

Real `execute-milestone.js` dispatch (scriptPath `/home/yale/work/quay/.claude/workflows/execute-milestone.js`,
run `wf_d9cf4f54-0f5`, 2026-07-28) with a doctored-stale copy of the real M195 receipt
(`milestones/M195/negative-control/preparation-tampered.json` — `hashes.proposal` first hex char
flipped) supplied via `preparationReceiptFile`. No `cacheFingerprints`/`priorVerifyCache` supplied
(per charter grounding note 6).

**Workflow return value (verbatim):**

```json
{"outcome":"revision-needed","reason":"FAIL: proposal-stale","phase":"Prepared","verifyCacheUpdates":{}}
```

- 7 agents total: 6 Verify-phase it0 checks (all passed) + 1 Prepared-phase checker agent.
- Returned BEFORE Build — no Build/Audit/Gate/Land agent was dispatched (journal
  `wf_d9cf4f54-0f5/journal.jsonl` contains no Build-phase entry).
- The reason code `proposal-stale` is the checker's own actionable code
  (`milestone-preparation-check.ts:280-281`), surfaced through the workflow's fail-closed
  `{outcome, phase}` shape — the exact return shape DIR-117-B AC #2's negative half demands.

**Standalone checker cross-check (same inputs, outside the workflow):**

```
FAIL: proposal-stale — task '## Proposal' has changed since preparation — rerun the full Proposal→Plan preparation
exit 1
```

Real receipt cross-check (control of the control): `milestones/M195/preparation.json` with the same
task/charter → `PASS: prepared — ... (3 round(s))`, exit 0.
