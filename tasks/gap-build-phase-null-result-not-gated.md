---
id: gap-build-phase-null-result-not-gated
title: "execute-milestone.js's Build-phase check only rejects outcome==='needs-human' —
  a terminally-errored agent() call (null result) silently passes through to
  Audit/Gate/Land as if Build succeeded"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
  - human-steered
parent: null
children: []
extra:
  schema: v1
---
## Proposal

Change the Build-phase result check in `execute-milestone.js` (both `.claude/workflows/` and
`plugin/workflows/` mirrors) from a needs-human-only check to a positive-outcome check: proceed
past Build ONLY when `buildResult?.outcome === 'done'`; any other value (including `null`/
`undefined` from a terminally-errored `agent()` call, or any unexpected string) returns
`{ outcome: 'needs-human', reason: 'build-agent-no-result' }` instead of silently continuing.

## Plan

N/A — directive resolved via a human-steered milestone (this touches
`.claude/workflows/execute-milestone.js`, a driver execution-chain script — quay-directive skill
step-4 override applies). Small, surgical change (the Build-phase gate condition, both mirrors);
no separate `docs/plans/*.md` needed.

## Finding

Discovered 2026-07-28 while independently auditing the M192/DIR-120 `execute-milestone` dispatch
(run `wf_b57d3610-224`). The workflow's own completion notification reported `agents_error: 1`
(the Build-phase agent) yet the overall `outcome` was `"done"` with a real, coherent landed commit
— worth explaining, not just accepting at face value.

Reconstructed the real timeline from each agent's own `.jsonl` transcript under
`~/.claude/projects/.../subagents/workflows/wf_b57d3610-224/`:

1. `13:01:46.192Z` — the Build-phase agent (`agent-ad4f8fe6b10e6a9f2.jsonl`, 436 lines) hit a real
   Anthropic API transient error (`"API Error: Server error mid-response"`) immediately after
   confirming "All 103 tests pass, selftest still 22/22, and verify-readers still agrees. Now
   let's run the full suite again in background" — i.e. BEFORE its own prompt's step 5 ("COMMIT
   all changes"). The transcript ends there; no retry, no recovery, no final structured result.
   Per the Workflow tool's own contract, a terminally-errored `agent()` call resolves to `null`.
2. `13:01:46.307Z` (the very same second) — the script dispatched the Audit-phase agent
   (`agent-a295a2f6975acd936.jsonl`) immediately. The script never paused or branched on the
   Build failure.
3. Root cause, directly read from `execute-milestone.js`:
   ```js
   // execute-milestone.js:269-272
   log(`Build phase complete: outcome=${buildResult?.outcome}`)
   if (buildResult?.outcome === 'needs-human') {
     return { outcome: 'needs-human', reason: buildResult?.reason || 'build-failed', phase: 'Build', verifyCacheUpdates }
   }
   ```
   `buildResult` is `null`. `null?.outcome` is `undefined`, which is not `=== 'needs-human'`, so
   the check passes and the script falls straight through to Audit/Gate/Land. The Land-phase
   prompt even interpolates this literally: `Build outcome: ${JSON.stringify(buildResult)}` →
   the Land agent was told, in its own prompt, `Build outcome: null`.
4. Why the milestone still landed correctly this time, and why that is NOT a designed safety net:
   because `execute-milestone.js`'s Build phase has no worktree isolation (a separate, already-
   tracked gap — [[gap-execute-milestone-no-worktree-isolation]], promoted to DIR-123 — not yet
   executed), the crashed Build agent's real, mostly-complete file edits were still sitting
   uncommitted directly in the shared working tree, not lost. The Audit agent reviewed that
   uncommitted diff and rendered a verdict against it. The Land agent (`agent-
   abd21f5593cbf7515.jsonl`, `13:14:01Z`-`13:28:56Z`), on its own initiative — not because the
   script instructed it to check for a missing Build commit — noticed the working tree had real
   uncommitted changes matching the milestone's charter, independently re-ran the full test suite
   itself (confirmed real exit code 0 in its own transcript) before committing them as `f359aa4`
   at `13:24:20Z`, then made its own separate ABSORB commit `8c096e9`.

This is a real, structural gap: the outcome depended on (a) no worktree isolation happening to
preserve the crashed agent's edits, and (b) the Land agent happening to be diligent enough to
notice `Build outcome: null` was wrong and verify before committing. Neither is guaranteed. If the
API error had landed earlier (mid-edit, before tests were run) or the Land agent had trusted the
`null` at face value and proceeded to write dashboard/ABSORB entries without an actual Build
commit to point at, this exact code path would have silently landed incomplete or unverified work
as `"done"`.

## Requested action

1. Change the Build-phase gate in `execute-milestone.js` (both `.claude/workflows/` and
   `plugin/workflows/` mirrors, currently lines ~269-272) from a needs-human-only check to a
   positive-outcome check:
   ```js
   log(`Build phase complete: outcome=${buildResult?.outcome}`)
   if (buildResult?.outcome !== 'done') {
     return { outcome: 'needs-human', reason: buildResult?.reason || (buildResult ? 'build-outcome-not-done' : 'build-agent-no-result'), phase: 'Build', verifyCacheUpdates }
   }
   ```
2. Add a regression test (alongside the existing `execute-milestone-preparation-gate.test.mjs`-
   style harness) that mocks a Build-phase `agent()` call returning `null` (simulating a
   terminally-errored dispatch) and asserts the workflow returns `{ outcome: 'needs-human', reason:
   'build-agent-no-result' }` WITHOUT dispatching Audit/Gate/Land — the exact scenario that
   silently passed in the M192 run.
3. Keep the composite/concurrent Build path (if it has an equivalent check) consistent — grep for
   any other `buildResult?.outcome === 'needs-human'`-shaped check in the same file and apply the
   same fix if found.

## Acceptance Criteria
- [ ] The Build-phase gate rejects any `buildResult?.outcome !== 'done'` (not just the literal
  string `'needs-human'`), grep-confirmable in both mirrors.
- [ ] A new unit test simulates a `null` Build result and asserts the workflow halts with
  `outcome: 'needs-human'` before any Audit/Gate/Land agent is dispatched — real test output
  pasted, not asserted.
- [ ] Existing `execute-milestone-preparation-gate.test.mjs` / `prepare-milestone-preparation-e2e.test.mjs`
  (and any other test exercising the Build phase) still pass unchanged.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on `master`, verified via the new regression test's real output, not asserted.
- [ ] Because this touches `.claude/workflows/execute-milestone.js` (driver execution-chain
  script), resolving it must run under human-steered discipline.

## Human verification when exp5 marks this task done
1. Does the Build-phase gate now reject a `null`/non-`'done'` result instead of only the literal
   string `'needs-human'`?
2. Does the new regression test actually simulate the M192 scenario (Build agent errors →
   `null` result) and confirm Audit/Gate/Land are never dispatched in that case?

## Touches

- .claude/workflows/execute-milestone.js
- plugin/workflows/execute-milestone.js
