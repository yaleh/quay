---
id: gap-architecture-review-judge-call-shares-no-diagnostics-or-retry-with-osd
title: architecture-review 的 claude -p judge 调用是第三套独立实现——与 OSD 零共享失败归因/重试
status: todo
labels:
  - gap
parent: null
children: []
extra: {}
---
## Proposal
**Part of the approved "Quay architecture analysis as a shipped capability" consolidation (2026-10-13) — sibling audit to `gap-cross-project-dogfood-shares-no-diagnostics-or-retry-with-osd-seven-unattributed-exit1` (hard rule 5b: a fixed instance is not a fixed class; this is the SAME class of defect found in a THIRD independent implementation).**

`runArchitectureReview` (`plugin/scripts/quality-gate-driver.ts:747-`, read in full) spawns FOUR model/subprocess calls per fired round — three mechanical detectors (`identity-replication-check`, `guard-lineage-check`, `deletion-closure-check`, each via `runAsync(argv, {timeoutMs: ROUTINE_TIMEOUT_MS})`) and one real `claude -p` LLM judge call (`runAsync(argv, {timeoutMs: judgeTimeoutMs, collectStderr: true})`, `judgeTimeoutMs` defaulting to `Infinity` in production — confirmed from the function signature and its own doc-comment, so this is NOT a timeout-cliff bug, only a diagnostics/retry gap). **None of the four spawns share OSD's `callFailureClass`/`streamDiagnostics`/`writeCallCapture`/`RETRYABLE_CALL_FAILURES`/one-counted-retry machinery** (`open-semantic-discovery-routine.ts`) — confirmed by reading every failure branch in the function:
- detector spawn error → `reason: "<name> spawn error: ${identityR.error.message}"` (terminal, `not-evaluated`, no retry)
- detector unparseable output → `reason: "unparseable <name> output (exit ${status}): ${diagnosticExcerpt(stdout)}"` (terminal, `not-evaluated`, no retry)
- judge spawn error/non-zero exit → `reason: "judge exited ${status}: ${error?.message ?? stderr.slice(0,200)}"` (terminal, `failed`, no retry — this DOES retain up to 200 chars of real stderr, better than cross-project-dogfood's completely bare `not-evaluated:exit-1` record, but still no `call_failure` taxonomy, no token/model info, no capture file, and critically **no retry at all**, even for failure shapes OSD's own taxonomy already knows are often transient — `no-stdout`/`stream-without-result`/`api-error-event`)
- judge non-JSON stdout → `reason: "judge output not a JSON array: ${diagnosticExcerpt(stdout)}"` (terminal, `failed`, no retry)
- judge produced zero valid cluster verdicts → `reason: "judge produced no valid cluster verdicts: ${diagnosticExcerpt(stdout)}"` (terminal, `failed`, no retry)

This is a THIRD independently-built "spawn a model/subprocess call and interpret the result" implementation in this codebase (OSD's, cross-project-dogfood's, and this one), each with its own ad hoc reason-string shape and its own blind spot. The user's directive for the shipped-capability consolidation explicitly calls for "共享模型调用失败归因、预算和有界重试" (SHARED call-failure attribution, budget, and bounded retry) across OSD + architecture-review + arch-discovery + Method/Portfolio/Experience — this task is the architecture-review leg of that.

Confirmed not a duplicate of `gap-quality-gate-driver-pool-judge-spawn-timeout` (done) — that task fixed a DIFFERENT routine's DIFFERENT call site (B15 `pool-quality-judge`'s blocking `spawnSync`+fixed-180s-timeout, converted to async `spawn`), explicitly scoped ("本条是把同一个已验证的修法应用到 quality-gate-driver 的 B15") and does not touch `runArchitectureReview`'s judge call, which was already async (`runAsync`) with an unbounded default timeout from the start. Also not a duplicate of `gap-arch-review-judge-verdicts-never-reach-the-existing-gap-filing-channel` (done) — that fixed verdict routing to the gap-filing channel, a downstream concern from this one (diagnosability/retry of the call itself, upstream of whether a verdict is produced at all).

## Plan
1. **Reuse, do not reinvent** (same discipline as the cross-project-dogfood sibling task): import `callFailureClass`, `streamDiagnostics`, `writeCallCapture`, `RETRYABLE_CALL_FAILURES` from `open-semantic-discovery-routine.ts` into `quality-gate-driver.ts`'s judge-call path. The three mechanical detectors are local script spawns, not LLM calls — `callFailureClass`'s taxonomy (`no-stdout`/`stream-without-result`/`api-error-event`) is specific to a `claude -p` stream and does not apply to them; scope the classification+retry to the ONE call that is actually an LLM call (the judge), leaving the three detector spawns' existing terminal-on-error behavior as-is (a local script spawn error is not the same class of transient-failure problem OSD's taxonomy exists for).
2. On a judge `call_failure` that is in `RETRYABLE_CALL_FAILURES`, retry exactly once through a fresh reservation (same backoff shape OSD uses) before giving up and recording `failed`. A capture file sibling to OSD's (`.quay/architecture-review-call-captures/`) is written for every judge call (success or failure), same as OSD.
3. The `ArchReviewRoundRecord` written for a `failed` judge call gains the same diagnostic fields OSD's call records carry where applicable (`call_failure`, `stdout_bytes`, `has_result`) — keep the existing `reason` string field too (downstream consumers of `.quay/architecture-review-round.jsonl` read it; do not remove a field without checking consumers, hard rule 5/5b).
4. No change to the budget/resource-gate logic already in place (`resourceGateCheck` before the judge spawn is unchanged; any retry's spend is counted on the same ledger the judge's own call already uses — no new parallel allowance).
5. No change to detector argv resolution (that is `gap-architecture-review-wrong-root-detector-argv-and-no-config-driven-host-entry`'s scope, filed separately) or to gap-filing wiring (already landed).

## Acceptance Criteria
- [ ] AC1: a fixture judge-spawn returning each of OSD's known failure shapes (no-stdout, stream-without-result, api-error-event, a genuinely clean exit-1 with real stderr naming a real error, a non-JSON stdout, a budget refusal) is classified by the REUSED `callFailureClass`/`streamDiagnostics` — not a second copy. Negative control: run the SAME fixtures through the pre-fix judge-call path — it must collapse all of them to the current bare `judge exited ${status}: ...`/`judge output not a JSON array: ...` strings with no classification, proving the fix changes something real.
- [ ] AC2: exactly one retry fires for each RETRYABLE class, through a fresh reservation on the existing ledger (no change to `max_model_calls_per_24h`/`max_usd_per_24h` or any other config value — pasted byte-identical before/after). A fixture retry that ALSO fails is recorded as `failed` (not laundered into `judged`), with the capture file present for inspection.
- [ ] AC3: no retry for a non-retryable class (e.g. a genuinely clean exit-1 with real stderr naming a real error, or non-JSON stdout) — pasted, so the retry is bounded to the classes it is meant for, same discipline as the OSD/cross-project-dogfood tasks.
- [ ] AC4: the three mechanical detector spawns are UNCHANGED by this task (still terminal-on-error, no retry) — pasted to confirm scope was respected per Plan step 1's explicit carve-out.
- [ ] AC5: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC5 checked with pasted evidence (fixture-based — a real production judge-call failure is rare by nature, same carve-out used by the cross-project-dogfood sibling task).
- No change to any budget ceiling in `.quay/config.yml`.
- `gap-architecture-review-wrong-root-detector-argv-and-no-config-driven-host-entry` and this task can land in either order (independent files/concerns within `quality-gate-driver.ts`) but both are prerequisites for the broader shipped-capability clean-room acceptance task.

## Touches
- tasks/gap-architecture-review-judge-call-shares-no-diagnostics-or-retry-with-osd.md
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/test/quality-gate-driver.test.mjs
