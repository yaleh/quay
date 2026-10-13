---
id: gap-architecture-review-judge-call-shares-no-diagnostics-or-retry-with-osd
title: architecture-review 的 claude -p judge 调用是第三套独立实现——与 OSD 零共享失败归因/重试
status: done
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
- [x] AC1: a fixture judge-spawn returning each of OSD's known failure shapes (no-stdout, stream-without-result, api-error-event, a genuinely clean exit-1 with real stderr naming a real error, a non-JSON stdout, a budget refusal) is classified by the REUSED `callFailureClass`/`streamDiagnostics` — not a second copy. Negative control: run the SAME fixtures through the pre-fix judge-call path — it must collapse all of them to the current bare `judge exited ${status}: ...`/`judge output not a JSON array: ...` strings with no classification, proving the fix changes something real.
  **Evidence.** `plugin/test/quality-gate-driver.test.mjs` → `AC1 — 每个 judge 失败形状由【复用的】callFailureClass/streamDiagnostics 分类…` + `AC1(b) — 超时是【自己的】收尾…` (168/168 tests green in the scoped gate, AC5 below). The class is read by `callFailureClass` and the stream by `streamDiagnostics` — BOTH consumed, not re-derived: the two are IMPORTED from `open-semantic-discovery-routine.ts` / reached through its new `loadStreamDiagnostics()`, which resolves the SAME `docs/analysis/arch-hypothesis-generation.mjs` export via the SAME `resolveEngineModule` + `_engineModuleCache` OSD itself uses (`grep -c 'function streamDiagnostics' plugin/scripts/` → 0: no second reader).
  Per-shape readings (temp workspace, fixture judge bytes, persisted `.quay/architecture-review-round.jsonl` lines):
  ```
  shape                   call_failure           has_result  stdout_bytes  spawns  captures  retry_attempted  state
  no-stdout               no-stdout              false       0             2       2         true             failed
  stream-without-result   stream-without-result  false       81            2       2         true             failed
  api-error-event         api-error-event        true        104           2       2         true             failed
  truncated-json          truncated-json         false       33            1       1         false            failed
  unclassified-plain-text unclassified           false       45            1       1         false            failed
  killed-by-timeout       killed-by-timeout      false       0             1       -         false            failed
  ```
  `RETRYABLE_CALL_FAILURES = ["no-stdout","stream-without-result","api-error-event"]` — asserted to be exactly OSD's list, and every shape's retryability is asserted to be THAT list's verdict rather than a second predicate. The "budget refusal" arm is realised as the routine's OWN spend gate (`resourceGateCheck`): `AC2(b)` drives a stateful gate (GO before the judge, WAIT before the retry) ⇒ no second subprocess, `retry_refused:"busy-on-retry"` (arch-review has no budget ledger, so the gate IS the arm — stated rather than papered over).
  **Negative control, both halves, both asserted (能取假).** `preFixReason(status, stderr)` is the pre-task failure string quoted verbatim from the old judge branch. Over the five exit-1 shapes it resolves to exactly **2** values (`"judge exited 1: "` for empty stderr, `"judge exited 1: Error: unable to resolve project root '/nope'"` for the one with real stderr) — and the three **byte-distinct** retryable shapes (`no-stdout` / `stream-without-result` / `api-error-event`) all collapse to the SAME single string, `Set.size === 1`. The fixed path yields 5 distinct classes from the same 5 fixtures, and none of the pre-fix strings contains any `call_failure` class token.
- [x] AC2: exactly one retry fires for each RETRYABLE class, through a fresh reservation on the existing ledger (no change to `max_model_calls_per_24h`/`max_usd_per_24h` or any other config value — pasted byte-identical before/after). A fixture retry that ALSO fails is recorded as `failed` (not laundered into `judged`), with the capture file present for inspection.
  **Evidence.** `AC2 —` + `AC2(b) —` in the same test file. The arch-review judge is a single `runAsync` spawn, not a ledgered reservation (this routine has NO model-budget ledger — its spend gate is `resourceGateCheck`), so the retry is expressed on the mechanism that actually exists here: ONE retry through a fresh spawn, after the OSD backoff (`RETRY_BACKOFF_MS`, seam-overridable as the 12th param), preceded by a FRESH `resourceGateCheck`. ⛔ No new ledger, no new allowance.
  (i) Exactly one retry — `stream-without-result` fixture: `spawnCount(judge.log) === 2` (the call + exactly ONE retry, never two); `rec.retry_attempted === true`; `rec.call_failure === "stream-without-result"` (unchanged by the retry, ⛔ not laundered clean); `rec.reason` carries `[call_failure=stream-without-result; retried once (first=stream-without-result)]`.
  (ii) A retry that fails again stays failed: `fact.state === "failed"`, the carrier holds exactly ONE line and it is `state:"failed"` (⛔ no second `judged` record), and both capture files exist (`captureCount === 2`, each containing `# stdout head` + `# stderr tail`) with `rec.stdout_capture.path` resolving to a real file on disk.
  ⚠️ **一处刻意偏差，记录而不是掩盖**：Plan step 2 的括注写作「a capture file … is written for every judge call (success or failure), **same as OSD**」。实现取的是**「same as OSD」那一半**——捕获只在**未产出可用判词**的调用上写（OSD 自己的判据是 `rec.not_evaluated !== null`）。理由是 OSD 在同一处的注释：成功调用的判词已逐簇落在载体上，再存一份流就是 transcript 而不是诊断。AC2 只要求「重试再失败时捕获文件在盘上」（已满足），故此处取更严的那一半并无判据损失。
  (iii) Caps UNCHANGED, pasted: `git diff develop -- .quay/config.yml` is **empty** (byte-identical); `git diff --stat develop...HEAD` touches only `plugin/scripts/{open-semantic-discovery-routine,quality-gate-driver}.ts` + `plugin/test/quality-gate-driver.test.mjs` (418 insertions, 35 deletions, `.quay/config.yml` NOT among them). The retry adds no parallel allowance — it goes through the same gate the judge's own call already went through.
- [x] AC3: no retry for a non-retryable class (e.g. a genuinely clean exit-1 with real stderr naming a real error, or non-JSON stdout) — pasted, so the retry is bounded to the classes it is meant for, same discipline as the OSD/cross-project-dogfood tasks.
  **Evidence.** `AC3 — 不可重试类零重试…` over `["truncated-json", "unclassified-plain-text"]` (plus the `killed-by-timeout` arm in `AC1(b)`). Each one: `spawnCount(judge.log) === 1`, `rec.retry_attempted === false`, `rec.retry_refused === null` (⛔「没到重试那一步」≠「被闸拒绝了」— the two states stay different, 硬规则 3b), and `RETRYABLE_CALL_FAILURES.includes(rec.call_failure) === false`. Pasted readings:
  ```
  truncated-json           call_failure="truncated-json"  spawns=1  (deliberately ABSENT from RETRYABLE_CALL_FAILURES:
                                                            a stream cut mid-write would be cut in the same place again)
  unclassified-plain-text  call_failure="unclassified"    spawns=1  reason="judge exited 1: Error: unable to resolve
                                                            project root '/nope' [call_failure=unclassified]"
  killed-by-timeout        call_failure="killed-by-timeout" spawns=1 (the timeout reaper's own class; precedence given
                                                            by the reused classifier, not by a local predicate)
  ```
  ⛔ One reading is deliberately NOT in that list and is called out rather than quietly dropped: the ONE shape with real stderr here (`unclassified-plain-text`) is a genuinely clean `exit 1` whose bytes name their own cause — it is NOT retried, because the bytes put it in `unclassified`, not in any of the three retryable classes.
- [x] AC4: the three mechanical detector spawns are UNCHANGED by this task (still terminal-on-error, no retry) — pasted to confirm scope was respected per Plan step 1's explicit carve-out.
  **Evidence.** `AC4 — 三个机械检测器的 spawn 面【逐字未动】…`, two halves. (a) A detector that cannot be spawned at all ⇒ the routine returns `not-evaluated` with reason `identity-replication spawn error: …`, the judge is **never** spawned (`spawnCount(judge.log) === 0`) and **zero** captures are written — a local-script spawn failure still never enters the new attribution/retry machinery. (b) On the judge-retry path the identity detector is spawned exactly once (`spawnCount(detLog) === 1`) while the judge is spawned twice — the mechanical clustering is not re-run by a judge retry. `git diff develop -- plugin/scripts/quality-gate-driver.ts` shows steps 1-3 (the three detector `runAsync` calls and their `spawn error` / `unparseable … output` branches) byte-unchanged; the only edits are in step 7 (the judge call) and the two new module-scope declarations.
- [x] AC5: `scripts/test.sh --for-task <this task>` green.
  **Evidence.** `bash scripts/test.sh --for-task gap-architecture-review-judge-call-shares-no-diagnostics-or-retry-with-osd --allow-thin` (run inside the task worktree, after `git merge --no-edit develop` reported "Already up to date") → **EXIT=0**. Tail:
  ```
  ℹ tests 168
  ℹ suites 0
  ℹ pass 168
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 13304.13779
  ```
  The scoped static tier ran in the same invocation with every selected checker PASS (including `import-graph-check` valueSccs=0≤0, `checked-in-write-check` 0 writes inside the tree, `test-file-snapshot-check`, `task-contract-check` strict-subset). The fan-in anti-drift gate was green too:
  `node --no-warnings --experimental-strip-types plugin/scripts/anti-drift-touches-check.ts --task <this> --worktree <wt> --merge-target develop`
  → `ANTI-DRIFT OK: … 3 actual file(s), all within declared Touches (4 glob(s))`, exit 0.

## Definition of Done
- AC1-AC5 checked with pasted evidence (fixture-based — a real production judge-call failure is rare by nature, same carve-out used by the cross-project-dogfood sibling task).
- No change to any budget ceiling in `.quay/config.yml`.
- `gap-architecture-review-wrong-root-detector-argv-and-no-config-driven-host-entry` and this task can land in either order (independent files/concerns within `quality-gate-driver.ts`) but both are prerequisites for the broader shipped-capability clean-room acceptance task.

## Touches
- tasks/gap-architecture-review-judge-call-shares-no-diagnostics-or-retry-with-osd.md
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/test/quality-gate-driver.test.mjs