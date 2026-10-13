---
id: gap-osd-stream-without-result-recurs-past-the-one-counted-retry-needs-correlated-signal
title: "OSD's call_failure=stream-without-result can recur on its own
  one-counted retry (real production: 1 of 2 retries hit the identical class
  again) — raw capture shows the CLI stream cut off mid-thinking with no
  result/error event; test the anchor-handoff-timing correlation before deciding
  whether to add a correlated second retry"
status: ready
labels:
  - gap
  - discovery-method
  - investigation
parent: null
children: []
extra: {}
---
## Proposal
**Split out of `gap-cross-project-dogfood-shares-no-diagnostics-or-retry-with-osd-seven-unattributed-exit1` (hard rule 5b: a narrower, separately-scoped half of the same audit) — a gap in OSD's EXISTING retry mechanism, not an absence of one.**

OSD's one-counted-retry (`RETRYABLE_CALL_FAILURES = ["no-stdout", "stream-without-result", "api-error-event"]`) is implemented and firing correctly. But real production data (ClaudeCodeUI local OSD, round `osd-675243-1791901051486-zw524m`, `invoked_by:"resident-driver"`, 2026-10-13T14:17:32Z) shows the SAME failure class can recur ON the retry itself: of 2 first-attempt verifier calls classified `stream-without-result`, one retry resolved to a different, understood cause (`error_max_turns`), but the OTHER retry hit `call_failure:"stream-without-result"` **again** — the cluster then has no further chance and reads `undetermined`.

**What the raw capture shows (`.quay/open-semantic-discovery-call-captures/osd-675243-…-verifier-dmr-675243-1-ue3ckmf2.txt`, read directly):** the stream is a long run of real `{"type":"system","subtype":"thinking_tokens",...}` events (counting up to 451), then stops — no `result` event, no error event, stderr carries only the two benign startup warnings (claude.ai connectors notice, `unrecognized_model`). This is NOT a JSON parse failure or an API error event; it looks like the underlying CLI process was cut off while still generating (killed or disconnected), not a graceful CLI-level failure.

**Hypothesis, explicitly not yet tested** (hard rule 4 corollary 4 — the claim below needs a counterfactual before being treated as a conclusion): this round's timing (14:17:32Z) is right after the ClaudeCodeUI anchor handoff completed (old anchor exited ~14:17:21Z). A brief window of dual-anchor cgroup/resource overlap during a handoff could plausibly kill a child process mid-stream. This is a correlation observed from a SINGLE occurrence; it has not been compared against a steady-state baseline, and no other cause (host load from an unrelated process, a provider-side transient, an SDK bug) has been ruled out.

## Plan
1. **Get a counterfactual before asserting a cause.** Compare `stream-without-result` incidence in rounds that occurred within N minutes of a recorded anchor start/takeover/restart event (`anchor.log` has these timestamps) against rounds in steady state. If the host carries a cheap load signal (`/proc/loadavg`, or the sibling-scope count OSD's own envelope logging already reads), log it alongside the call record — this makes future recurrence self-diagnosing instead of requiring a fresh manual capture-file read each time.
2. **Decide, from the counterfactual, whether to do anything to the retry policy itself** — e.g. a SECOND bounded retry gated specifically on "the correlated signal says this was likely transient" (never gated on nothing, which would just spend money hoping), or leaving the policy as one retry and instead only improving the diagnosis. Do not assume escalation is warranted before the counterfactual is in.
3. **No change to the hard budget ceilings** (`max_model_calls_per_24h`, `max_usd_per_24h`) regardless of which option is chosen — any added retry capacity must be counted and capped on the SAME ledger, never a parallel allowance.
4. `undetermined` stays `undetermined` when every available attempt (first + any retries this task adds) still fails — this task must not lower the confirmation bar to compensate for a flaky transport.

## Acceptance Criteria
- [ ] AC1: the correlation hypothesis is tested against real carrier data (OSD findings across quay + claudecodeui, cross-referenced with `anchor.log` restart timestamps) and the result — supported, refuted, or insufficient-samples — is pasted plainly, with the counts on both sides of the comparison.
- [ ] AC2: whatever the decision in Plan step 2, it is implemented with a negative control (a fixture round with the correlated signal absent must NOT trigger the new behavior if one was added) and the hard budget ceilings are shown unchanged in `.quay/config.yml` before/after.
- [ ] AC3: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC3 checked with pasted evidence. If AC1 comes back "insufficient samples," this task documents that honestly and proposes what signal to log going forward (Plan step 1) rather than guessing at a fix for an uncharacterized cause (hard rule 4: a structurally-unfalsifiable guess is not a measurement).

## Touches
- tasks/gap-osd-stream-without-result-recurs-past-the-one-counted-retry-needs-correlated-signal.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/scripts/driver-anchor.ts
- plugin/test/open-semantic-discovery-routine.test.mjs
