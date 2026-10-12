---
id: gap-open-discovery-model-calls-exit-without-result-are-unattributed-zero-token
title: "open discovery: model calls that run minutes but leave no result event
  (exit 0/1, 0 tokens, subtype null) are unattributed and recorded like success
  — minimal attributable diagnostics, enumerated call_failure, one counted
  retry, cost proof, unrecognized_model paired test"
status: ready
labels:
  - gap
  - defect
  - open-discovery
  - discovery-method
parent: null
children: []
extra: {}
---
## Proposal
**Production reading: model calls that spend wall time but leave nothing parseable.** In `.quay/open-semantic-discovery-findings.jsonl` call records (2026-10-12):

| round (UTC) | step | exit | subtype | tokens | recorded `not_evaluated` |
|---|---|---|---|---|---|
| 17:04:19 | investigator | 1 | — | 0/0 | (field not yet present) |
| 20:40:00 | verifier | 1 | null | 0/0 | `uninstrumented-exit-1` |
| 21:47:31 | verifier | **0** | null | 0/0 | null |
| 21:47:31 | refuter | 1 | null | 0/0 | `uninstrumented-exit-1` |
| 21:47:31 | shadow-investigator | **0** | null | 0/0 | null |
| 22:48:23 | investigator | **0** | null | 0/0 | null |
| 22:48:23 | shadow-investigator | 1 | null | 0/0 | `uninstrumented-exit-1` |

- The 22:48 round took **194,759 ms of wall for these 2 calls alone**, so the processes ran for minutes. This is not an instant launch failure.
- Their `stderr_tail` holds only the two benign lines: the claude.ai connectors notice and `[claude-code:unrecognized_model] {"model":"v4.1flash-anthropic"}`.
- **Exit 0 with no `result` event and 0 usage is recorded with `not_evaluated: null`**, i.e. in the same shape as an ordinary success. That is a hard rule 3b violation.
- Each such call is charged the per-call USD ceiling: the 22:48 round was charged $2 for no output.

What is already known (coordinator diagnostics, 2026-10-12T18:4xZ, same argv):
- `unrecognized_model` also appears on calls that succeed (exit 0, `success`), so it is not by itself the cause;
- `error_max_turns` is distinguishable when a `result` event exists.

The cause of the no-result calls is **unknown**; candidate hypotheses are listed in Plan step 2. **No cause may be asserted without the evidence this task adds** (hard rule 4 corollary 4).

## Plan
1. **Minimal attributable diagnostics per call** (always, not only on failure):
   - wall_ms, exit code and signal;
   - stdout byte count, stdout line count, count of parseable JSON events by `type`, and whether a `result` event exists;
   - the first and last 2 KB of stdout and the last 4 KB of stderr, for failed or no-result calls only (bounded);
   - the served model from the `system/init` event.
   Persist these on the call record, with the raw head/tail in a bounded side file under `.quay/`.
2. **Classify** each no-result call into an enumerated `call_failure` from the captured bytes:
   - `no-stdout`;
   - `stream-without-result`;
   - `truncated-json`;
   - `api-error-event` (an error event in the stream: rate limit / overload / auth);
   - `killed-by-timeout`;
   - `unclassified` (never collapsed into success).
   Exit 0 + no `result` ⇒ `not-evaluated:no-result-event`, not null.
3. **Safe retry:** a call classified `api-error-event`/`stream-without-result`/`no-stdout` is retried ONCE after a backoff, through a fresh reservation in the same hard 24h ledger, so it is counted and capped. No retry for `killed-by-timeout` or when the budget refuses.
4. **Cost proof:** a no-result call is charged its realized usage when a usage figure exists, else the ceiling, and the record says which. The per-round and 24h totals reconcile with the ledger.
5. **unrecognized_model:** test it rather than assume. Run a paired call (same prompt and argv) with the gateway id `v4.1flash-anthropic` and with an id the CLI recognizes and the gateway accepts (if none exists, say so). Paste subtype, num_turns, usage and wall for both. If behaviour differs, record what differs; do not change the production model in this task.

## Acceptance Criteria
- [ ] AC1 (unit, stub launcher): one fixture per `call_failure` class (empty stdout; stream without result; truncated last line; an API-error event; a timeout kill) ⇒ the right class. Exit 0 + no result ⇒ `not-evaluated:no-result-event`, never null. Negative control: drop the classifier ⇒ red. Paste.
- [ ] AC2 (retry is counted): fixture ⇒ exactly one retry, its own reservation id in the ledger, no retry when the ledger refuses. Paste the ledger lines.
- [ ] AC3 (production carrier): after the change, ≥3 real resident or manual rounds append call records carrying the new fields. Paste them. For every 0-token call in that window, paste its class plus the stdout/stderr head and tail that justify it. `unclassified` count and examples are pasted, not hidden.
- [ ] AC4 (cost reconciliation): for the same window, the sum of per-call charged USD equals the round `cost_usd`, and the ledger reservation count equals the round `model_calls` (paste the arithmetic).
- [ ] AC5 (unrecognized_model): the paired run outputs are pasted, with the conclusion stated as one of: no difference / difference in X.

## Definition of Done
- `scripts/test.sh --for-task <this task>` green.
- Report-only, the hard budget and the kill switch are unchanged; retries never bypass the ledger.

## Touches
- tasks/gap-open-discovery-model-calls-exit-without-result-are-unattributed-zero-token.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/test/open-semantic-discovery-routine.test.mjs
- docs/analysis/arch-hypothesis-generation.mjs
