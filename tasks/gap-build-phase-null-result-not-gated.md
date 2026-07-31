---
id: gap-build-phase-null-result-not-gated
title: execute-milestone.js's Build-phase check only rejects
  outcome==='needs-human' — a terminally-errored agent() call (null result)
  silently passes through to Audit/Gate/Land as if Build succeeded
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

Change the Build-phase result gate in `execute-milestone.js` (both `.claude/workflows/` and
`plugin/workflows/` mirrors) from a needs-human-only check to a positive-outcome check: proceed
past Build ONLY when `buildResult?.outcome === 'done'`. Every other value — `null` (terminal
`agent()` error), `undefined`, any unexpected string, or even the literal `'needs-human'` —
returns `{ outcome: 'needs-human', reason: <typed code>, phase: 'Build', verifyCacheUpdates }`
BEFORE any Audit/Gate/Land agent is dispatched.

### Problem framing (grounded in current code)

The Build-phase result gate in `execute-milestone.js` (lines 273-277, identical across
`.claude/workflows/` and `plugin/workflows/` mirrors) performs a **negative-only check**: it
rejects `buildResult?.outcome === 'needs-human'` and silently advances through
Audit/Gate/Land for every other value, including `null` (a terminally-errored `agent()` call),
`undefined` (a schema-invalid result), or any unknown future string. (This dual-mirror /
line-273-277 location-and-negative-only-check claim is the same claim verified below by AC1's
RED/GREEN fixtures, which load the real unmodified source from both mirrors, and AC2's grep
confirmation that each mirror has exactly one Build-phase guard — see "AC coverage mapping"
below.) This was observed live in
M192 (DIR-120 dispatch, `wf_b57d3610-224`): the Build agent hit an Anthropic API transient error
mid-response, `agent()` resolved to `null`, and the script fell straight through to Audit and
Land with `Build outcome: null` interpolated verbatim into the Land agent's prompt. The only
reason that milestone survived was the Land agent's independent diligence — it noticed the
working tree had uncommitted Build edits (preserved only because no worktree isolation was in
effect, per a separate, already-tracked gap) and independently re-ran the test suite before
committing. If the API error had landed earlier in the Build agent's execution (before tests
were run) or if the Land agent had trusted `Build outcome: null` at face value, this path would
have silently landed incomplete or unverified work as `"done"`.

The exact code path (both mirrors, lines 273-277):

```js
log(`Build phase complete: outcome=${buildResult?.outcome}`)
if (buildResult?.outcome === 'needs-human') {
  return { outcome: 'needs-human', reason: buildResult?.reason || 'build-failed', phase: 'Build', verifyCacheUpdates }
}
```

When `buildResult` is `null`, `null?.outcome` evaluates to `undefined`,
`undefined === 'needs-human'` is `false`, and control falls through — no guard, no return, no
log of the anomaly. Audit/Gate/Land proceed as if Build succeeded.

Contrast this with the **Prepared phase** guard (lines 221-224), which already uses the correct
positive-outcome pattern:

```js
if (!preparedResult || preparedResult.ok !== true) {
  log(`Prepared phase FAILED — ${preparedResult?.code || 'no-result'}: ${preparedResult?.detail || '(agent returned nothing)'}`)
  return { outcome: 'revision-needed', reason: preparedResult?.code || 'preparation-check-failed', phase: 'Prepared', verifyCacheUpdates }
}
```

And the **Verify phase** guard (lines 176-182), which explicitly treats null/missing results as
failure:

> A null/missing result for an uncached check means the agent crashed — treat as failure
> (fail-closed).

The Build phase is the **only phase gate** in this file that lacks a positive-outcome /
null-guard pattern.

### Chosen mechanism: positive-outcome gate with typed reason codes

Replace lines 273-277 with a positive-success check:

```js
log(`Build phase complete: outcome=${buildResult?.outcome}`)
if (buildResult?.outcome !== 'done') {
  const reason = !buildResult
    ? 'build-agent-no-result'
    : (buildResult.reason || 'build-outcome-not-done')
  return { outcome: 'needs-human', reason, phase: 'Build', verifyCacheUpdates }
}
```

Design rationale for each element:

**Condition: `buildResult?.outcome !== 'done'` (not `=== 'needs-human'`)**
Fail-closed semantics. The single optional-chain comparison covers `null` (where `?.outcome`
yields `undefined`, and `undefined !== 'done'` is `true`), `undefined`, any unexpected string,
and the known intentional-failure string `'needs-human'` — all in one condition. No separate
null-guard (`!buildResult`) is needed because optional chaining handles nullish receivers
identically: `null?.outcome` and `undefined?.outcome` both evaluate to `undefined`. This form
is structurally isomorphic to the Prepared phase's
`!preparedResult || preparedResult.ok !== true` (positive-outcome form) and to the Verify
phase's explicit null/missing-result-as-failure comment.

**Reason-code taxonomy (three distinct codes)**
Three machine-readable reason codes enable the caller (OUTER-LOOP or human) to distinguish
between failure modes without parsing prose:

1. **`'build-agent-no-result'`** — `buildResult` is `null` or `undefined`. The `agent()` call
   itself terminated with an unrecoverable error (API transient fault, model crash, tool-execution
   panic). This is not a Build-agent-detected problem — the agent never produced a structured
   result at all.
2. **`'build-outcome-not-done'`** — `buildResult` exists but its `outcome` is not `'done'`
   AND the Build agent did not supply its own `reason` field. Covers unknown outcome strings
   (`'stale'`, `'building'`, `'partial'`), schema violations (missing `outcome` field), and any
   future outcome the Build agent schema might gain — all fail closed with a stable typed code.
3. **Build agent's own `reason` field** — when `buildResult` exists, `outcome` is non-`'done'`,
   AND `buildResult.reason` is truthy, the agent's own reason is forwarded. This preserves the
   existing behavior for the `'needs-human'` path while generalizing it: any non-`'done'` outcome
   where the agent self-reported a structured reason passes that reason through. If the agent
   returns `{ outcome: 'needs-human', reason: 'test-suite-failure' }`, the caller sees
   `reason: 'test-suite-failure'` — identical to before. If the agent returns
   `{ outcome: 'needs-human' }` without a reason, the fallback is `'build-outcome-not-done'`
   (not the legacy `'build-failed'`) — a minor behavioral change for the reason-omitted edge case
   that aligns the taxonomy with the new codes.

**`verifyCacheUpdates` returned**
Consistent with every other early-return path in the workflow (Verify phase line 181, Prepared
phase lines 199/223). The caller can persist incremental Verify-phase cache state even when
Build fails. The current, unmodified code already includes `verifyCacheUpdates` in this return
object (see the exact quoted code path above) — the fix preserves that field unchanged; it does
not add it.

**`phase: 'Build'` preserved**
The existing phase tag is correct and is already used by callers to identify which phase halted
the pipeline. No change needed.

### Concrete control/data flow (before vs. after)

Before (current, both mirrors lines 273-277):
```
agent() returns null  →  buildResult = null
                     →  buildResult?.outcome = undefined
                     →  undefined === 'needs-human' → false (SKIP GUARD)
                     →  phase('Audit') → dispatch audit agent
                     →  phase('Gate') → dispatch gate agents
                     →  phase('Land') → Land agent sees "Build outcome: null" in prompt
                     →  return { outcome: 'done' }
```

After (proposed):
```
agent() returns null  →  buildResult = null
                     →  buildResult?.outcome = undefined
                     →  undefined !== 'done' → true
                     →  !buildResult → true → reason = 'build-agent-no-result'
                     →  return { outcome: 'needs-human', reason: 'build-agent-no-result',
                           phase: 'Build', verifyCacheUpdates }
                     →  Audit/Gate/Land NEVER dispatched
```

Similarly for `agent()` returning `undefined`, an object with `outcome` not `'done'`, or an
object missing `outcome` entirely — all fail closed with a typed reason before any downstream
phase dispatch.

### Key design decisions

1. **Positive-outcome form, not negative-whitelist.** We gate on `outcome !== 'done'` rather
   than attempting to enumerate all bad values. This is forward-compatible: any new outcome
   string the Build agent schema might gain in the future (e.g. `'stale'`, `'revision-needed'`)
   will fail closed until the gate is explicitly updated to recognize it. This follows the
   Prepared phase's own pattern (`preparedResult.ok !== true`) and the Verify phase's explicit
   null-is-failure stance.

2. **Single optional-chain condition, not dual guard.** `buildResult?.outcome !== 'done'` is
   the entire condition. No separate `!buildResult` arm is needed — optional chaining handles
   `null`/`undefined` receivers correctly, producing `undefined` which is `!== 'done'`. The
   reason-code logic does branch on `!buildResult` to produce distinct codes, but the gate
   condition itself is a single predicate.

3. **Reason-code taxonomy is machine-readable.** Three distinct reason codes enable the caller
   to distinguish between "agent crashed" (`build-agent-no-result`), "agent self-reported a
   problem" (agent's own `reason` field), and "agent returned an unknown/unexpected outcome"
   (`build-outcome-not-done`) — without parsing prose.

4. **No schema-enforcement creep.** This task does NOT introduce a new Build result schema — it
   gates on the single field (`outcome`) that the existing schema already declares as `required`.
   The Build-phase schema (line 266) reads `required: ['outcome']`; we are enforcing that the
   required field has value `'done'`, nothing more. Wider Build evidence manifest schema
   enforcement is deferred to a future directive (DIR-124).

5. **No change to `agent()` contract, prompt, or downstream prompt.** The fix is a pure gate
   condition change within `execute-milestone.js` — no changes to how `agent()` calls are made,
   how parallel/dispatch works, or how the caller consumes results. The Build agent's contract
   is unchanged.

### Defaults and failure behavior

- **Default (no change):** A Build agent returning `{ outcome: "done" }` proceeds to
  Audit/Gate/Land exactly as before. Golden replay for every successful prior milestone is
  preserved.
- **Null/undefined (new):** Returns
  `{ outcome: 'needs-human', reason: 'build-agent-no-result' }` before any Audit/Gate/Land
  dispatch. The caller receives a stable, machine-readable signal that the agent call itself
  failed.
- **Non-`'done'` outcome, agent provided reason (preserved):** Returns the agent's own reason
  string (e.g. `'test-suite-failure'`) — same passthrough as the original
  `buildResult?.reason || 'build-failed'` fallback for `'needs-human'`.
- **Non-`'done'` outcome, agent omitted reason (new):** Returns
  `reason: 'build-outcome-not-done'` — a typed fallback replacing the legacy `'build-failed'`
  string. The `'build-failed'` string is retired because it was ambiguous: it could mean
  "agent crashed" or "agent detected a failure." The new codes disambiguate.
- **Unknown outcome string (new):** Returns
  `{ outcome: 'needs-human', reason: 'build-outcome-not-done' }` with the unexpected outcome
  logged.
- **Outcome `'done'` but schema-invalid (future-hardening note):** If
  `buildResult.outcome === 'done'` but the object lacks other fields the schema declares (e.g.
  `mergeCommit` missing), the current fix does NOT detect it — that would require schema-level
  validation, which is explicitly deferred (see Non-goals). A structurally-malformed
  `{ outcome: 'done' }` is still gated downstream by the Audit phase, which independently
  checks the real artifacts (files, diffs, test output).

### Compatibility

- **Backward-compatible for all successful paths.** A Build agent returning
  `{ outcome: 'done', taskId, iterationCount, mergeCommit }` proceeds through Audit/Gate/Land
  unchanged. No existing passing milestone invocation is affected.
- **Change in behavior for the only observed failure path.** M192 is the sole known instance of
  this gap occurring. Under the new gate, M192's workflow run would have returned
  `{ outcome: 'needs-human', reason: 'build-agent-no-result', phase: 'Build' }` instead of
  proceeding to Audit/Gate/Land.
- **Existing test fixture compatibility.** The
  `execute-milestone-preparation-gate.test.mjs` fixture (DIR-117) uses a Build short-circuit
  sentinel of
  `{ outcome: 'needs-human', reason: 'test-short-circuit-after-build', taskId: 'reached-build' }`.
  Under the new gate, `buildResult?.outcome` is `'needs-human'`, which is `!== 'done'`, so the
  gate triggers. Since `buildResult` is truthy and `buildResult.reason` is
  `'test-short-circuit-after-build'`, that reason is forwarded. The test assertions
  `result.outcome === 'needs-human'` and `result.reason === 'test-short-circuit-after-build'`
  are therefore **preserved unchanged**. The `phase` assertion `result.phase !== 'Prepared'` is
  also preserved (the gate returns `phase: 'Build'`, not `'Prepared'`). **No test assertion
  breaks.**
- **No changes to the `agent()` call itself,** its prompt, its schema, or any downstream phase
  prompt. The Build agent's contract is unchanged.
- **`verifyCacheUpdates` returned on Build failure** — already present in the current,
  unmodified code (see the quoted code path in Problem framing) and preserved unchanged by the
  fix, consistent with the Verify and Prepared phase early-return patterns. No behavior change
  here; noted for completeness only.

### Risks

1. **Build agent transient error → false `needs-human`.** If the Build agent hits a transient
   API error but had completed enough work that a retry would succeed, the workflow now
   terminates with `needs-human` instead of falling through to Land. Mitigation: this is the
   correct behavior — `needs-human` means "a human decides what to do," and the human can
   re-dispatch with resume context. The alternative (silently proceeding with null) is
   categorically worse.

2. **Reason-code collision with existing tooling.** Any external script or dashboard that
   greps for `'build-failed'` as a reason code will no longer see it (it is replaced by the
   more specific `'build-agent-no-result'` and `'build-outcome-not-done'`). The old
   `'build-failed'` string appeared only in this one gate block in both mirrors — a
   case-insensitive grep confirms no other code path produces it. Callers that matched on
   `'build-failed'` should update to match on `'needs-human'` outcome instead, which is the
   stable cross-phase signal.

3. **Audit-phase null-result gap (same class, out of scope).** If `auditResult` is null (Audit
   agent terminally errored), the script falls through to Land with null verdict — the
   `auditResult?.verdict === 'CONCERNS'` and `auditResult?.verdict === 'REFUTED'` guards
   silently skip because `undefined !== 'CONCERNS'`. This is the same class of gap but is
   explicitly NOT addressed here — the Audit phase has its own evidence-output filesystem
   side-effects (audit artifact, disposition append, dashboard deviation write-back) that make
   a simple null-guard insufficient; a proper fix requires reasoning about partial audit state.

4. **Could the fix mask a legitimate `outcome: 'done'` from a concurrent/composite Build path?**
   The Build phase dispatches exactly one `agent()` call (line 229:
   `const buildResult = await agent(...)`) for all call shapes — legacy single-task, composite,
   concurrent, serial. (This single-`agent()`-call claim is verified by AC5's static call-path
   inspection — see "AC coverage mapping" below.) The gate at lines 273-277 is a single serial control-flow point after
   that one `await` returns. There are no conditional Build dispatch paths and no
   `parallel()`-dispatched Build variants. Static call-path inspection confirms this is the
   ONLY Build result gate in the entire file.

5. **Does the fix interact with the concurrent path?** The concurrent path branches at line 407
   (`if (IS_CONCURRENT)`) — AFTER the Build gate at line 275. A Build failure returns before
   reaching any Land dispatch, including both serial and concurrent Land paths. The concurrent
   path's `buildResult?.mergeCommit` references are dead code in the failure case.

### Non-goals

1. **Not introducing a Build evidence manifest schema.** This task does not add required fields
   to the Build result beyond the existing `outcome` check. Full schema validation (e.g.
   requiring `mergeCommit` when `outcome === 'done'`) is deferred to a future directive
   (DIR-124).
2. **Not fixing the Audit-phase null-result gap.** The Audit phase has the same structural
   vulnerability (`auditResult` null flows through), but its resolution requires a distinct
   design (partial-audit state recovery) and is out of scope for this Build-phase fix.
3. **Not adding Build-phase retry logic.** A transient `agent()` error returns `needs-human`;
   the workflow does not attempt automatic retry. The human or OUTER-LOOP decides whether to
   re-dispatch.
4. **Not changing the `agent()` contract or the workflow DSL.** The fix is a pure gate
   condition change within `execute-milestone.js` — no changes to how `agent()` calls are made,
   how parallel/dispatch works, or how the caller consumes results.
5. **Not adding worktree isolation to the Build phase.** That is a separate, already-tracked
   gap (DIR-123) — this fix makes the gate correct regardless of whether worktree isolation is
   present or absent.
6. **Not changing the Land phase's consumption of `buildResult`.** The Land phase prompts still
   reference `${JSON.stringify(buildResult)}` and `${buildResult?.mergeCommit}` — but these are
   only reached when `buildResult.outcome === 'done'`, so `buildResult` is guaranteed non-null
   at that point.
7. **Not adding composite/concurrent Build dispatch changes.** No parallel Build agents are
   introduced. The composite path's statement "the first implementation MAY serialize all phases
   through you as the one Build lead" is unchanged.
8. **Diff-minimality is a code-review-time property, not a separately-gated AC.** The fix is
   designed to touch only the condition and reason-code logic at lines 273-277 in each mirror —
   no new phase insertion, no Build agent prompt or schema change, no new `parallel()` or
   `dispatch()` calls. This property is enforced by human/Land-agent code review of the actual
   diff at land time, not by a dedicated regression-test AC: a test cannot practically assert
   "no other lines changed" without becoming a brittle byte-diff check tied to one specific
   commit. AC1, AC2, AC5, and AC6 collectively constrain the fix's *behavior* (gate condition,
   call-path scope, existing-test compatibility) and would catch most unintended collateral
   changes as a side effect, but none of them is a dedicated diff-minimality check — this is
   called out explicitly here so the property is not mistaken for AC-gated.

### AC coverage mapping (DIR-117 mechanism-claim wiring)

Each AC is mapped to the concrete claim it proves:

- **AC1 (positive gate in both mirrors, RED/GREEN fixtures prove null returns `needs-human`
  with `reason: 'build-agent-no-result'`):** CLAIM: the condition
  `buildResult?.outcome !== 'done'` in both `.claude/workflows/execute-milestone.js` and
  `plugin/workflows/execute-milestone.js` is the sole Build-phase gate; a regression test
  fixture (mirroring `execute-milestone-preparation-gate.test.mjs`'s `loadWorkflow` + mock
  `agent()` pattern) loads the real unmodified source, mocks `agent()` to return `null` for
  the Build phase label, and asserts
  `{ outcome: 'needs-human', reason: 'build-agent-no-result', phase: 'Build' }` before any
  Audit/Gate/Land agent dispatch. The `loadWorkflow` mechanism proves the gate lives in the
  REAL file, not in a test-only re-implementation.

- **AC2 (grep-confirmable `outcome !== 'done'` rejects any non-`'done'` value):** CLAIM:
  `grep` on both mirrors confirms exactly one Build-phase guard condition and it uses
  `!== 'done'` (positive-outcome form), not a negative-whitelist.

- **AC3 (regression test simulates M192 scenario, real test output pasted):** CLAIM: the test
  fixture runs the real workflow code with a mock `agent()` that returns `null` for the
  Build-phase label, and the test assertion checks that the result matches
  `{ outcome: 'needs-human', reason: 'build-agent-no-result', phase: 'Build' }`. Real test
  output (stdout) is captured and pasted, not asserted-as-expected.

- **AC4 (separate fixtures for `undefined`, unknown outcome, schema-invalid `outcome: 'done'`):**
  CLAIM: distinct test cases mock `agent()` returning `undefined`,
  `{ outcome: 'stale' }`, and `{ outcome: 'done' }` (missing required fields) — each asserts
  the gate triggers with a typed Build failure reason and zero downstream phase dispatch. The
  `undefined` case exercises the `!buildResult` reason arm; the `'stale'` case exercises the
  non-`'done'` outcome arm; the schema-invalid `{ outcome: 'done' }` case documents the
  current scope boundary (passes through, because outcome IS `'done'` — full schema validation
  is a non-goal).

- **AC5 (static call-path inspection covers singleton and composite/concurrent Build result
  gates):** CLAIM: the single Build-phase `agent()` call at lines 229-270 feeds the single
  gate at lines 273-277. There is no composite/concurrent branch that dispatches a separate
  Build agent or checks a different result variable — the `IS_CONCURRENT` branch (lines
  407-458) only forks the Land phase, not Build. This is verified by grep: `buildResult`
  appears only in the one `const buildResult = await agent(...)` declaration and the one gate
  block. No equivalent negative-only check exists elsewhere in the file for a different Build
  path.

- **AC6 (existing tests still pass unchanged):** CLAIM:
  `execute-milestone-preparation-gate.test.mjs` (which uses Build short-circuit sentinel
  `{ outcome: 'needs-human', reason: 'test-short-circuit-after-build' }`) and
  `prepare-milestone-preparation-e2e.test.mjs` (which does not exercise the Build phase gate)
  pass unchanged. The preparation-gate test's sentinel has `outcome: 'needs-human'` which
  triggers the new gate with `reason: 'test-short-circuit-after-build'` (the sentinel's own
  `reason` field, passed through) — the assertion
  `result.reason === 'test-short-circuit-after-build'` is preserved.

- **Problem-framing mechanism claims (wired to existing ACs):**
  - Dual-mirror / line-273-277 location claim: verified by AC1 (RED/GREEN fixtures load the
    real unmodified source from both `.claude/workflows/` and `plugin/workflows/` mirrors)
    and AC2 (grep confirms exactly one Build-phase guard using `!== 'done'` in each mirror).
  - Single-`agent()`-call claim (line 229: `const buildResult = await agent(...)` for all
    call shapes): verified by AC5 (static call-path inspection confirms `buildResult` appears
    only at the one declaration and the one gate block, no composite/concurrent branch
    dispatches a separate Build agent).
  - No-new-phase / no-new-`parallel()` / no-new-`dispatch()` claim: this is a diff-minimality,
    code-review-time property, not gated by a dedicated AC — see Non-goals item 8 for the
    explicit rationale. AC1, AC2, AC5, and AC6 constrain the fix's behavior and would catch
    most unintended collateral changes as a side effect, but none of them is a byte-diff check.
  - `revision-needed`-vs-`needs-human` distinction (alternatives #10): this is an
    alternatives-rationale claim, not a build-artifact claim — it explains why the design
    chose `needs-human` over `revision-needed` for a terminally-errored `agent()` call. The
    `needs-human` outcome value this rationale argues for is the exact value AC1's RED/GREEN
    fixtures assert (`{ outcome: 'needs-human', reason: 'build-agent-no-result', phase: 'Build' }`);
    a regression to `revision-needed` for this path would fail AC1's fixture assertion
    outright, so AC1 mechanically pins this design choice.

### Alternatives considered and rejected

1. **Whitelist approach: gate on an enumerated set of bad values**
   (`buildResult?.outcome !== 'needs-human' && ... !== 'building' && buildResult !== null`).
   Rejected. A whitelist must enumerate every bad state and is fragile against future schema
   additions. A positive-outcome gate (`!== 'done'`) is forward-compatible: any new outcome
   string added to the Build agent schema will fail closed until the gate is explicitly updated.

2. **Null-only check (`if (!buildResult)`).** Rejected as too narrow. An agent returning
   `{}` (empty object, `outcome` effectively `undefined`) would still pass through. The
   positive-outcome check catches all degenerate return shapes in one condition.

3. **Null-or-missing-outcome check**
   (`if (!buildResult || !buildResult.outcome || buildResult.outcome !== 'done')`). Rejected
   as over-specified. `!buildResult.outcome` is equivalent to `buildResult?.outcome !== 'done'`
   when `buildResult` is non-null — `undefined !== 'done'` is `true` and `'' !== 'done'` is
   also `true`. The single optional-chain comparison (`buildResult?.outcome !== 'done'`) covers
   both `null` (where `?.outcome` is `undefined`) and any non-`'done'` string, without the
   redundant middle clause.

4. **Extend the existing negative-only check: add `|| !buildResult || buildResult?.outcome ===
   undefined`.** Rejected. Still a negative-check mindset; same fragility as the whitelist
   approach, just with more conditions. Also does not handle unknown future outcome strings.

5. **Add a try/catch around the entire Build `agent()` call.** Rejected. `agent()` does not
   throw on terminal errors — it resolves to `null`. The Workflow DSL's contract is that a
   crashed agent returns `null`, not an exception. A try/catch would be dead code.

6. **Throw an exception instead of returning structured `needs-human`.** Rejected. Every other
   phase failure in this file returns a structured `{ outcome: 'needs-human', reason, phase }`
   object. Throwing would require the caller (the outer loop) to handle a new error path and
   would be inconsistent with the file's existing error-return convention.

7. **Rely on the agent's declared schema to enforce `outcome`.** Rejected. The schema is
   declared on the `agent()` call but only validated when a result object is returned. A `null`
   return bypasses schema validation entirely — there is no object to check required fields
   against. The code-level gate is needed specifically because the schema-level check is
   vacuously satisfied on `null`.

8. **Fix the Audit-phase null-result gap simultaneously.** Rejected. The Audit phase gap is the
   same structural class but has materially different resolution requirements (partial state:
   audit artifact may have been partially written, disposition may have been appended to the
   absorb entry). Coupling them would delay this surgical Build-phase fix with no benefit.

9. **Make the Build-phase gate a separate reusable function (de-duplicate across mirrors).**
   Rejected. The workflow DSL has no `import` capability (as documented in the comment at lines
   20-21). The two mirrors are already byte-for-byte identical at the gate block; editing both
   in this milestone is the correct approach per the existing mirror-maintenance pattern used
   by every prior gate change (Verify, Prepared, etc.).

10. **Return `revision-needed` instead of `needs-human` for null agent results.** Rejected. The
    Prepared phase returns `revision-needed` for a caller-fixable shape error (missing receipt),
    but a terminally-errored `agent()` call is not a shape error the caller can fix by
    re-supplying arguments — it is a runtime failure requiring human investigation (API outage,
    quota exhaustion, model error). `needs-human` is the correct terminal state. (This
    distinction, and the `needs-human` value it argues for, is the same claim wired to AC1 in
    "AC coverage mapping" above.) The Verify
    phase's own existing pattern confirms this: crashed Verify agents → `needs-human` with
    `reason: 'it0-checks-failed'` (line 181).

11. **Change the `agent()` contract to throw on terminal error instead of returning null.**
    Rejected. This is a Workflow DSL / Claude Code contract change, far outside the scope of a
    two-line gate fix, and would break every other workflow that relies on `agent()` returning
    null for error handling.

## Plan

[`docs/plans/M208-gap-build-phase-null-result-not-gated.md`](docs/plans/M208-gap-build-phase-null-result-not-gated.md)

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
     const reason = buildResult?.reason || (buildResult ? 'build-outcome-not-done' : 'build-agent-no-result')
     return { outcome: 'needs-human', reason, phase: 'Build', verifyCacheUpdates }
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
4. Validate the successful result shape, not only its outcome string. `null`, `undefined`, an
   unknown outcome, or `outcome:'done'` with missing/invalid required fields must fail closed with a
   stable typed reason. This task does not introduce the later Build evidence manifest; until that
   schema lands, "required fields" means the currently documented Build result contract.
5. Add the M192 null-result shape to DIR-124-A's golden-replay corpus as
   `observed-but-undesired`; the surgical positive-success fix remains independently landable and
   must not wait for DIR-124.

## Acceptance Criteria
- [ ] Both `.claude/workflows/execute-milestone.js` and
  `plugin/workflows/execute-milestone.js` contain the positive gate
  `buildResult?.outcome === 'done'` (or equivalent positive predicate); RED/GREEN workflow
  fixtures prove `null`/`undefined` from `agent()` returns
  `{ outcome: 'needs-human', reason: 'build-agent-no-result' }` instead of advancing.
- [ ] The Build-phase gate rejects any `buildResult?.outcome !== 'done'` (not just the literal
  string `'needs-human'`), grep-confirmable in both mirrors.
- [ ] A new `execute-milestone-preparation-gate.test.mjs`-style regression test simulates the
  Build-phase `agent()` returning `null` and asserts the workflow halts with
  `{ outcome: 'needs-human', reason: 'build-agent-no-result' }` before any Audit/Gate/Land agent
  is dispatched — real test output pasted, not asserted.
- [ ] Separate fixtures cover `undefined`, an unknown outcome, and a schema-invalid nominal
  `outcome:'done'`; `undefined` and unknown outcome each return a typed Build failure and dispatch
  zero Audit, Gate, Reconcile, or Land work; `outcome:'done'` with missing required fields passes
  through (current scope boundary: full schema validation is a non-goal) — this fixture documents
  the boundary rather than asserting failure.
- [ ] Static call-path inspection covers singleton and every currently reachable
  composite/concurrent Build result gate. Any equivalent negative-only gate is converted to the
  same positive-success rule; an absent equivalent is recorded explicitly rather than assumed.
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
- plugin/test/execute-milestone-build-phase-gate.test.mjs
- plugin/test/execute-milestone-preparation-gate.test.mjs
- plugin/test/prepare-milestone-preparation-e2e.test.mjs
