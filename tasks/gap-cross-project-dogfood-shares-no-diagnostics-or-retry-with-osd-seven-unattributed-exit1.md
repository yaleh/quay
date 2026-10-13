---
id: gap-cross-project-dogfood-shares-no-diagnostics-or-retry-with-osd-seven-unattributed-exit1
title: cross-project-dogfood-routine.ts imports NOTHING of OSD's
  attributable-diagnostics/retry machinery
  (callFailureClass/streamDiagnostics/writeCallCapture/RETRYABLE_CALL_FAILURES)
  — all 7 historical exit:1 calls (5 verifier+2 refuter) are permanently
  unattributed, zero retry; OSD's own path on the same host resolves the
  identical exit:1 to a real cause with a retained capture
status: ready
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

## Acceptance Criteria
- [ ] AC1: a fixture spawn returning each of the 7 historical shapes (no-stdout, stream-without-result, api-error-event, truncated-json, error_max_turns, a genuinely clean exit 1 with real stderr, a budget refusal) is classified correctly by the REUSED `callFailureClass`/`streamDiagnostics` — not a second copy. Negative control: call the dogfood routine's OWN pre-fix `reservingStep` on the same fixtures — it must NOT distinguish any of them (all collapse to `not-evaluated:exit-1`), proving the fix changes something real.
- [ ] AC2: exactly one retry fires for each RETRYABLE class, through a fresh reservation on the existing ledger; `budget_24h`/`budget_usd_24h` caps are read UNCHANGED from `.quay/config.yml` (pasted, byte-identical to before this task). A fixture retry that ALSO fails is recorded as such (not laundered into a clean pass) and the cluster stays `undetermined`.
- [ ] AC3: no retry for a non-retryable class (e.g. a genuinely clean `exit 1` with real stderr naming a real error) — pasted, so the retry is bounded to the classes it is meant for.
- [ ] AC4: a real resident round (naturally due, NOT `--force`'d for this task) that happens to hit a retryable failure shows the new capture file and classification in the production carrier — pasted when/if one occurs within a stated observation window; if none occurs, the fixture coverage in AC1-AC3 stands alone and this box states that plainly rather than fabricating a production occurrence.
- [ ] AC5: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC3, AC5 checked with pasted evidence (fixture-based, since production occurrence is rare by nature — AC4 explicitly allows this and says so, per hard rule 4 corollary 3's own carve-out for a measurement that needs a stated production window).
- No change to `max_model_calls_per_24h`/`max_usd_per_24h` or any other budget value in `.quay/config.yml`'s `cross_project_dogfood:` section.
- The historical 7 unattributed calls are NOT retroactively re-attributed (the raw bytes are gone — this task fixes forward, it does not fabricate a past explanation).

## Touches
- tasks/gap-cross-project-dogfood-shares-no-diagnostics-or-retry-with-osd-seven-unattributed-exit1.md
- plugin/scripts/cross-project-dogfood-routine.ts
- plugin/test/cross-project-dogfood-routine.test.mjs
