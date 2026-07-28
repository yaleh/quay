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

---

# M195 negative-control #2 evidence (POST-FLIP, omitted receipt — the enforced default)

After the DIR-117-B/M195 flip (both `execute-milestone.js` mirrors now make `phase('Prepared')`
unconditional and fail closed on a MISSING `preparationReceiptFile`), the real, UNMODIFIED workflow
source of BOTH byte-identical mirrors was driven with `preparationReceiptFile` OMITTED. Method: load
each mirror as a real AsyncFunction (the same load-the-real-source method
`plugin/test/execute-milestone-preparation-gate.test.mjs` documents), stub the 6 Verify-phase it0
checks (independently covered elsewhere), sentinel the Build phase so "never reached" is provable.
Capture script: `/tmp/m195-postflip-control.mjs`; verbatim journal:
`milestones/M195/negative-control/post-flip-omitted-receipt-journal.jsonl`.

**Workflow return values (verbatim, one line per mirror):**

```json
{"mirror":".claude/workflows/execute-milestone.js","argsPreparationReceiptFile":null,"outcome":"revision-needed","reason":"preparation-receipt-missing","phase":"Prepared","buildReached":false,"phasesDispatched":["Verify","Prepared"]}
{"mirror":"plugin/workflows/execute-milestone.js","argsPreparationReceiptFile":null,"outcome":"revision-needed","reason":"preparation-receipt-missing","phase":"Prepared","buildReached":false,"phasesDispatched":["Verify","Prepared"]}
```

- BOTH mirrors return `{outcome:"revision-needed", reason:"preparation-receipt-missing",
  phase:"Prepared"}` — the new, distinct, caller-fixable reason code (NOT the checker's file-level
  `receipt-missing`, NOT `needs-human`).
- `buildReached: false` and `phasesDispatched` is exactly `["Verify","Prepared"]` — NO Build (nor
  Audit/Gate/Land) agent was dispatched. The flip fails closed BEFORE Build, which is exactly the
  AC #2 `{outcome, phase}` return-shape demand applied to the post-flip omitted-parameter variant.
- This complements negative-control #1 (pre-flip, stale receipt → `proposal-stale`): together they
  prove the shipped gate enforced a supplied-but-broken receipt (#1) and the flipped gate now also
  enforces a MISSING receipt (#2) — the back-compat hole DIR-117-B exists to close is shut.

The same two assertions are also encoded RED-then-GREEN honest in
`plugin/test/execute-milestone-preparation-gate.test.mjs` (the former "SKIPPED (back-compat) —
reaches Build" case is now "FAILS CLOSED … Build never dispatched"), one case per mirror, and pass.
