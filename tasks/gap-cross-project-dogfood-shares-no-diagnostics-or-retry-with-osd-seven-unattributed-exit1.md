---
id: gap-cross-project-dogfood-shares-no-diagnostics-or-retry-with-osd-seven-unattributed-exit1
title: cross-project-dogfood-routine.ts imports NOTHING of OSD's
  attributable-diagnostics/retry machinery
  (callFailureClass/streamDiagnostics/writeCallCapture/RETRYABLE_CALL_FAILURES)
  — all 7 historical exit:1 calls (5 verifier+2 refuter) are permanently
  unattributed, zero retry; OSD's own path on the same host resolves the
  identical exit:1 to a real cause with a retained capture
status: done
labels:
  - gap
  - defect
  - discovery-method
  - cross-project-dogfood
parent: null
children: []
extra: {}
---
## Proposal
**Root-cause audit, 2026-10-13, requested specifically to explain 7 unattributed `exit:1` calls in cross-project-dogfood's production history (5 verifier + 2 refuter, across the 4 real resident-driver rounds `cpd-3283888`/`cpd-3716725`/`cpd-943549`/`cpd-1241325`) plus the sibling local-OSD `exit-1`/`verdict-not-in-vocab` cases on ClaudeCodeUI.**

**Finding, confirmed by reading the code, not guessed:** `cross-project-dogfood-routine.ts` imports only `spawnModelCall, stepArgv, usdBudgetUsage` from `open-semantic-discovery-routine.ts` (`cross-project-dogfood-routine.ts:73`). It does **NOT** import `callFailureClass`, `streamDiagnostics`, `writeCallCapture`, `RETRYABLE_CALL_FAILURES`, or the one-counted-retry wrapper that `gap-open-discovery-model-calls-exit-without-result-are-unattributed-zero-token` and `gap-open-discovery-refutation-chain-undetermined-is-unattributable-and-budget-truncated` built and landed for OSD. Its own `CallRecord` interface (`:779`) is `{ step, reservation_id, ok, not_evaluated, turns, exit }` — no stdout/stderr bytes, no token/model info, no `call_failure` classification, no capture file. Its `reservingStep` function (`:895-915`) DOES receive `res.stdout`/`res.stderr` from the spawn result, but discards both before building the persisted `CallRecord` — the raw diagnostic bytes exist in memory for the one call that used them and are then lost forever, never written to disk.

**Consequence, verified against the real carrier (`.quay/cross-project-dogfood-findings.jsonl`):** every one of the 7 historical `exit:1` calls reads, in full, as
```
{"step": "cross-project-verifier", "reservation_id": "dmr-3716725-1-165jinxk", "ok": false, "not_evaluated": "not-evaluated:exit-1", "turns": null, "exit": 1}
```
— no stdout, no stderr, no wall time, no signal, no timeout flag, no model. There is no way, post-hoc, to tell a crashed `claude` process from a non-JSON reply from a provider API error from an environment fault. **Zero of the 7 were retried** — the routine has no retry path for anything.

**By contrast, OSD's own call path (same engine, same provider, same host) DOES capture and classify.** A fresh, real round on ClaudeCodeUI's local OSD carrier (`.quay/open-semantic-discovery-findings.jsonl`, round `osd-675243-1791901051486-zw524m`, `invoked_by:"resident-driver"`, 2026-10-13T14:17:32Z — occurred on its own after an already-authorized anchor handoff completed in the background, NOT forced for this investigation) shows the SAME `exit:1` symptom resolved to a real root cause:
```
verifier dmr-675243-1-ue3ckmf2: call_failure="stream-without-result", has_result=false, stdout_bytes=693942,
  stdout_events_by_type={"system":2251,"assistant":22,"user":14}, api_error_event=false
```
Reading the retained capture file (`.quay/open-semantic-discovery-call-captures/osd-675243-…-verifier-dmr-675243-1-ue3ckmf2.txt`), the stream ends mid-reasoning — a run of `{"type":"system","subtype":"thinking_tokens",...}` events counting up to 451, then nothing: no `result` event, no error event, stderr carries only the two benign startup warnings. **This is not a JSON parse failure, not a budget refusal, not an API error event — the underlying CLI process stopped emitting output abruptly while still generating, consistent with the process being killed or the connection dropping, not with a graceful CLI-level failure.** The routine's own one-counted-retry DID fire (`retry_of: "dmr-675243-1-ue3ckmf2"`); one retry (`dmr-675243-2`) then hit `error_max_turns` (a different, understood cause) and the other retry (`dmr-675243-5`) hit the **SAME** `call_failure:"stream-without-result"` again. So even where the diagnostics+retry machinery is present and working as designed, this specific failure class can recur past the one counted retry — this round's own 3 of its 4 first-attempt verifier calls hit it.

**Hypothesis, not yet tested** (hard rule 4 corollary 4 — stated as a hypothesis, not a conclusion): the timing of this round (14:17:32Z) sits immediately after the ClaudeCodeUI anchor handoff completed (old anchor exited ~14:17:21Z) — a window of resource/cgroup contention from the brief dual-anchor overlap could plausibly cause a child process to be killed mid-stream. This is a correlation observed ONCE; it has NOT been tested against a steady-state baseline.

## Plan
1. **Reuse, do not reinvent.** `cross-project-dogfood-routine.ts`'s call path imports `callFailureClass`, `streamDiagnostics` (via the hypothesis module it already loads), `writeCallCapture`, `RETRYABLE_CALL_FAILURES`, and the same one-counted-retry wrapper shape OSD uses — the SAME functions, not a parallel reimplementation (hard rule 5b: a fixed instance is not a fixed class).
2. `CallRecord` gains the same fields OSD's call records carry (`stdout_bytes`, `stdout_events_by_type`, `has_result`, `call_failure`, `stdout_capture`, `tokens`, `actual_model`) — a capture directory sibling to OSD's (`.quay/cross-project-dogfood-call-captures/`).
3. A call whose `call_failure` is in `RETRYABLE_CALL_FAILURES` gets exactly ONE retry, through a fresh reservation on the SAME 24h/USD ledger (counted and capped — no change to the hard budget ceilings), after the SAME backoff OSD uses. A refusal at the retry's own reservation throws the ordinary budget-refused path (no retry when the ledger refuses).
4. `undetermined` stays `undetermined` on a retry that fails again — this task does not relax the confirmation bar, and must not let a retried-but-still-failed call read as a clean pass.
5. **Separately** (own task, not blocking this one — scope kept narrow per hard rule 5b's OTHER half: don't over-widen one fix into a second investigation): log whatever signal is cheaply available (host load average, whether an anchor handoff occurred in the preceding N minutes) alongside a `stream-without-result`/`no-stdout` capture, so a FUTURE recurrence can be correlated with a cause rather than re-litigated from scratch each time. Filed separately as `gap-osd-stream-without-result-recurs-past-the-one-counted-retry-needs-correlated-signal`.

## Outcome
The call path now imports OSD's attribution machinery and consumes the engine's own structural readers through the `hypModule` seam it already loads — `callFailureClass`, `callNotEvaluatedToken`, `writeCallCapture`, `boundedTail`, `RETRYABLE_CALL_FAILURES`, `RETRY_BACKOFF_MS` from `open-semantic-discovery-routine.ts`, plus `classifyModelFailure` (discovery-method's reader, the same one OSD uses at `osd:3686`). `HypothesisModuleLike` gained REQUIRED `streamDiagnostics` and `parseVerifierStream` members (required, not optional: a module that cannot say what the bytes were would silently degrade every class to `null` — hard rule 3b).

`reservingStep` was split: `attemptCall` does reserve → spawn → read the bytes → record, and `reservingStep` wraps it with AT MOST ONE retry keyed on `RETRYABLE_CALL_FAILURES`, taking a FRESH reservation on the SAME ledger after `RETRY_BACKOFF_MS`. The first record stays on the round, a retry that fails again is recorded as failed, and a refusal at the retry's own reservation throws the ordinary `BUDGET_REFUSED` path. `CallRecord` gained `call_failure`, `stdout_bytes`, `stdout_lines`, `stdout_events_by_type`, `stdout_capture`, `has_result`, `api_error_event`, `stderr_*`, `tokens`, `actual_model`, `subtype`, `is_error`, `signal`, `timed_out`, `spawn_error`, `wall_ms` (and the retry markers), and `summarizeCalls` now carries the WHOLE record to the carrier instead of a six-field projection — the projection is what made the historical seven unattributable after the fact, when the bytes were already gone. Captures live in `.quay/cross-project-dogfood-call-captures/`, a sibling of OSD's own directory.

Two things this task deliberately did NOT do: it did not change any budget value, and it did not retroactively re-attribute the seven historical calls — their raw bytes are gone, and this fix is forward-only.

## Acceptance Criteria
- [x] AC1: a fixture spawn returning each of the 7 historical shapes (no-stdout, stream-without-result, api-error-event, truncated-json, error_max_turns, a genuinely clean exit 1 with real stderr, a budget refusal) is classified correctly by the REUSED `callFailureClass`/`streamDiagnostics` — not a second copy. Negative control: call the dogfood routine's OWN pre-fix `reservingStep` on the same fixtures — it must NOT distinguish any of them (all collapse to `not-evaluated:exit-1`), proving the fix changes something real.
  **Evidence.** `plugin/test/cross-project-dogfood-routine.test.mjs` → `AC1: each historical shape is classified by the REUSED callFailureClass/streamDiagnostics…` (32/32 tests green in the scoped gate, AC5 below). The two structural readers and the verdict mapper are IMPORTED from `docs/analysis/arch-hypothesis-generation.mjs` into the injected `hypModule` — the routine consumes the engine's readers through the seam it already loads, and the test delegates to the SAME functions rather than re-implementing them, so the class assertions are about the engine's own reader and not about a fixture's opinion.
  **Negative control, both halves, both asserted.** `preFixNotEvaluated(status, error)` is the two pre-task lines quoted verbatim from `reservingStep`. Over the six `exit 1` shapes it collapses to exactly `["not-evaluated:exit-1"]` — the same single token the production carrier shows for all seven historical calls — and its ENTIRE resolving power across all seven fixtures is two values (`not-evaluated:exit-1`, `not-evaluated:spawn-timeout`). The fixed path yields 7 distinct `call_failure` classes and `call_failure`/token pairs the old reading could not express.
  Reads from real rounds (temp workspace, fixture verifier bytes, persisted carrier lines — one per shape):
  ```
  no-stdout              exit=1 stdout_bytes=0   events={}                 has_result=false call_failure="no-stdout"
                         -> not-evaluated:uninstrumented-exit-1 ; capture written ; RETRY fired
  stream-without-result  exit=1 stdout_bytes=145 events={system:1,assistant:1} has_result=false call_failure="stream-without-result"
                         -> not-evaluated:uninstrumented-exit-1 ; capture written ; RETRY fired
  api-error-event        exit=1 stdout_bytes=130 events={system:1,result:1}   has_result=true  api_error_event=true
                         call_failure="api-error-event" -> not-evaluated:api-error-event ; capture written ; RETRY fired
  truncated-json         exit=1 stdout_bytes=115 events={system:1}            has_result=false call_failure="truncated-json"
                         -> not-evaluated:uninstrumented-exit-1 ; capture written ; NO retry
  error_max_turns        exit=1 stdout_bytes=139 events={system:1,result:1}   has_result=true subtype="error_max_turns"
                         call_failure=null -> not-evaluated:error_max_turns ; capture written ; NO retry
  unclassified           exit=1 stdout is plain text (not the launcher's envelope) + real stderr naming the error
                         call_failure="unclassified" -> not-evaluated:uninstrumented-exit-1 ; NO retry
  killed-by-timeout      spawn error (no exit code at all) call_failure="killed-by-timeout"
                         -> not-evaluated:killed-by-timeout ; NO retry
  budget refusal         not a spawn shape: cap 2 -- investigator reserved 1, verifier's first attempt reserved 2,
                         the RETRY's own reservation is REFUSED -> round state=failed, reason names
                         `BUDGET_REFUSED:BUDGET_24H`, spawns=2 (no third subprocess)
  ```
  Full persisted record for one of them (`.quay/cross-project-dogfood-findings.jsonl` round line, `calls[1]`), which is the shape that replaces the seven-field historical record:
  ```
  {"step":"cross-project-verifier","reservation_id":"dmr-3349748-1-imb4grkj","exit":1,"signal":null,"timed_out":false,
   "spawn_error":null,"wall_ms":0,"turns":null,"actual_model":"claude-fixture-1","tokens":{"input":0,"output":0},
   "stdout_bytes":145,"stdout_lines":2,"stdout_events_by_type":{"system":1,"assistant":1},"has_result":false,
   "api_error_event":false,"stderr_chars":0,"stderr_tail_truncated":false,"subtype":null,"is_error":null,
   "call_failure":"stream-without-result","stdout_capture":{"path":".quay/cross-project-dogfood-call-captures/
   cpd-3349748-1800000000000-43f5x7-cross-project-verifier-dmr-3349748-1-imb4grkj.txt","bytes":390,
   "stdout_bytes":145,"stdout_head_chars":143,"stdout_head_truncated":false,"stdout_tail_chars":143,
   "stdout_tail_truncated":false,"stderr_chars":0,"stderr_tail_truncated":false},"ok":false,
   "not_evaluated":"not-evaluated:uninstrumented-exit-1"}
  ```
  The capture file was stat-ed on disk for every result-less shape (`capture exists=true`), and its content matches `/# stdout head/` — "no bytes to show" and "no capture file" stay different readings (hard rule 3b). `AC1(b)` pins `CALL_CAPTURE_DIR_REL === ".quay/cross-project-dogfood-call-captures"` and asserts it differs from OSD's own directory.
- [x] AC2: exactly one retry fires for each RETRYABLE class, through a fresh reservation on the existing ledger; `budget_24h`/`budget_usd_24h` caps are read UNCHANGED from `.quay/config.yml` (pasted, byte-identical to before this task). A fixture retry that ALSO fails is recorded as such (not laundered into a clean pass) and the cluster stays `undetermined`.
  **Evidence.** `AC2:` + `AC2(b):` + `AC2(c):` in the same test file.
  (i) One retry, fresh reservation, same ledger — `stream-without-result` fixture: `seen.length === 3` (investigator + verifier + exactly ONE retry, never two); `retry.reservation_id !== first.reservation_id` (fresh) and `retry.retry_of === first.reservation_id` (names what it repeats), `retry.retry_cause === "stream-without-result"`, `retry.retry_of_kind === "cross-project-verifier"`. The ledger read back off disk holds 3 `reserve` lines and 3 `outcome` lines with `new Set(reserves.map(r => r.round)).size === 1` — the retry is COUNTED and CAPPED like any other call, on the round's own ledger.
  (ii) A retry that fails again is NOT laundered: `retry.ok === false`, `retry.not_evaluated === "not-evaluated:uninstrumented-exit-1"`, and the round line's own `not_evaluated` carries the loss. The cluster record reads `verifier_verdict: "undetermined"` and `confirmed: false`, and that verdict is the ENGINE's own — this test swaps the injected `runVerifier` for the real `runVerifier` from `docs/analysis/arch-hypothesis-generation.mjs`, which maps the returned bytes through `verifierVerdict`, so the reading is of this failure and not of a value a fixture queued.
  (iii) Budget refusal at the RETRY's own reservation: `AC2(b)` drives cap 2 so the investigator takes one reservation and the verifier's first attempt takes the other; the retry's reservation is then refused, and the round ends `state=failed` with `BUDGET_REFUSED:BUDGET_24H` in the reason, `seen.length === 2` (no third subprocess) and NO round line — "no retry when the ledger refuses", and a round that never reached an outcome is not counted as a completed one.
  (iv) Caps read UNCHANGED from `.quay/config.yml`'s `cross_project_dogfood:` section, pasted byte-identical to before this task:
  ```
  max_projects_per_round: 2
  max_records_per_file: 60
  max_file_bytes: 4194304
  max_artifact_bytes_per_project: 8388608
  investigator_max_turns: 30
  verifier_max_turns: 12
  refutation_max_turns: 10
  max_clusters_verified: 3
  max_wall_ms: 1800000
  max_model_calls_per_24h: 60
  max_usd_per_24h: 15
  file_confirmed: true
  ```
  `git diff develop -- .quay/config.yml` is empty for this task (`.quay/` is not in Touches and no budget value was touched). `AC2(c)` pins that these numbers are READ from the section rather than hardcoded, with a negative control asserting a different section yields a different reading (hard rule 4 corollary 2: a literal that means "unlimited on this host" is a host-dependent constant).
  (v) `RETRYABLE_CALL_FAILURES` is asserted to be exactly OSD's list `["no-stdout", "stream-without-result", "api-error-event"]`, and every fixture's retryability is asserted to be that list's verdict rather than a second predicate.
- [x] AC3: no retry for a non-retryable class (e.g. a genuinely clean `exit 1` with real stderr naming a real error) — pasted, so the retry is bounded to the classes it is meant for.
  **Evidence.** `AC3:` in the same test file, over `["truncated-json", "clean-named-failure", "unclassified-plain-text", "killed-by-timeout"]`. Each one: round completes `verified`, `seen.length === 2` (investigator + verifier ONLY), `roundLine.calls.length === 2`, `calls[1].retry_of === undefined` — no retry record exists at all. The pasted readings:
  ```
  truncated-json      call_failure="truncated-json"      (deliberately ABSENT from RETRYABLE_CALL_FAILURES:
                                                          a stream cut mid-write usually means the ceiling
                                                          was reached, and re-spending cuts it in the same place)
  clean-named-failure call_failure=null, subtype="error_max_turns", stderr="Error: Reached max turns (12)"
                      -> not-evaluated:error_max_turns    (the CLI ran and its OWN stream names the cause)
  unclassified-plain  call_failure="unclassified", stderr="Error: unable to resolve project root '/nope'"
                      -> not-evaluated:uninstrumented-exit-1
  killed-by-timeout   call_failure="killed-by-timeout"   -> not-evaluated:killed-by-timeout
  ```
  ⛔ One reading is deliberately NOT in that list and is called out rather than quietly dropped: a `result` event carrying `is_error:true` with any subtype other than the turn-cap kill is, by the ENGINE's own `streamDiagnostics` definition, an `api-error-event` — i.e. retryable BY DESIGN (it is the gateway-error arm). So "a genuinely clean `exit 1` with real stderr naming a real error" is realised here as the two arms whose bytes name their own cause (`error_max_turns` via the stream, `unclassified` via a non-envelope stdout), and the retry stays bounded to the three classes OSD's list names.
- [x] AC4: a real resident round (naturally due, NOT `--force`'d for this task) that happens to hit a retryable failure shows the new capture file and classification in the production carrier — pasted when/if one occurs within a stated observation window; if none occurs, the fixture coverage in AC1-AC3 stands alone and this box states that plainly rather than fabricating a production occurrence.
  **No production occurrence was observed, and this box states that plainly rather than fabricating one.** Observation window: the whole of this task's execution, 2026-10-13. Two independent readings say a production occurrence was structurally IMPOSSIBLE in that window, not merely unlucky:
  - the production carrier `.quay/cross-project-dogfood-findings.jsonl` still holds exactly its four historical round lines, the newest at `2026-10-13T11:10:00.935Z` (`cpd-1241325-…`) — no round has run since;
  - the change had not landed: `grep -c callFailureClass plugin/scripts/cross-project-dogfood-routine.ts` on the main checkout returns `0`, and `.quay/cross-project-dogfood-call-captures/` does not exist there. The resident driver loads the production routine from the main checkout, so it cannot emit the new fields until fan-in merges this branch to `develop` and `develop` reaches the main checkout.
  ⇒ Per this AC's own carve-out, the fixture coverage in AC1-AC3 stands alone. Whatever a first post-landing resident round records will be the real test of this fix, and it will be readable rather than re-litigated from scratch.
- [x] AC5: `scripts/test.sh --for-task <this task>` green.
  **Evidence.** `bash scripts/test.sh --for-task gap-cross-project-dogfood-shares-no-diagnostics-or-retry-with-osd-seven-unattributed-exit1 --allow-thin` → **EXIT=0**, run inside the task worktree after `git merge --no-edit develop` reported "Already up to date". Tail:
  ```
  ℹ tests 32
  ℹ suites 0
  ℹ pass 32
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 699.032484
  ```
  The scoped static tier (28 change-relevant checkers) also ran in the same invocation with no failure.
  The anti-drift gate the fan-in runs was green too:
  `node --no-warnings --experimental-strip-types plugin/scripts/anti-drift-touches-check.ts --task <this> --worktree <wt> --merge-target develop`
  → `ANTI-DRIFT OK: … 2 actual file(s), all within declared Touches (3 glob(s))`, exit 0.

## Definition of Done
- AC1-AC3, AC5 checked with pasted evidence (fixture-based, since production occurrence is rare by nature — AC4 explicitly allows this and says so, per hard rule 4 corollary 3's own carve-out for a measurement that needs a stated production window).
- No change to `max_model_calls_per_24h`/`max_usd_per_24h` or any other budget value in `.quay/config.yml`'s `cross_project_dogfood:` section.
- The historical 7 unattributed calls are NOT retroactively re-attributed (the raw bytes are gone — this task fixes forward, it does not fabricate a past explanation).

## Touches
- tasks/gap-cross-project-dogfood-shares-no-diagnostics-or-retry-with-osd-seven-unattributed-exit1.md
- plugin/scripts/cross-project-dogfood-routine.ts
- plugin/test/cross-project-dogfood-routine.test.mjs
