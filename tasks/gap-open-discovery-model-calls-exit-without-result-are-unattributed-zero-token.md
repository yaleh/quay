---
id: gap-open-discovery-model-calls-exit-without-result-are-unattributed-zero-token
title: "open discovery: model calls that run minutes but leave no result event
  (exit 0/1, 0 tokens, subtype null) are unattributed and recorded like success
  — minimal attributable diagnostics, enumerated call_failure, one counted
  retry, cost proof, unrecognized_model paired test"
status: done
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
- [x] AC1 (unit, stub launcher): one fixture per `call_failure` class (empty stdout; stream without result; truncated last line; an API-error event; a timeout kill) ⇒ the right class. Exit 0 + no result ⇒ `not-evaluated:no-result-event`, never null. Negative control: drop the classifier ⇒ red. Paste. — **EVIDENCE §AC1**
- [x] AC2 (retry is counted): fixture ⇒ exactly one retry, its own reservation id in the ledger, no retry when the ledger refuses. Paste the ledger lines. — **EVIDENCE §AC2**
- [x] AC3 (production carrier): after the change, ≥3 real resident or manual rounds append call records carrying the new fields. Paste them. For every 0-token call in that window, paste its class plus the stdout/stderr head and tail that justify it. `unclassified` count and examples are pasted, not hidden. — **EVIDENCE §AC3** (3 production-carrier rounds: **0 zero-token calls** in that window, `unclassified` = 0; the 0-token instance is pasted from a real fault-injected round + the AC5 measured call)
- [x] AC4 (cost reconciliation): for the same window, the sum of per-call charged USD equals the round `cost_usd`, and the ledger reservation count equals the round `model_calls` (paste the arithmetic). — **EVIDENCE §AC4**
- [x] AC5 (unrecognized_model): the paired run outputs are pasted, with the conclusion stated as one of: no difference / difference in X. — **EVIDENCE §AC5** (conclusion: **no difference attributable to `unrecognized_model`**; a difference IS measured for a CLI-recognized id, which the gateway refuses with a 400)

## Definition of Done
- `scripts/test.sh --for-task <this task>` green. — **measured**: scoped gate `--for-task <this task> --allow-thin` exit 0 (148 tests, 0 fail; the new `(n)` family is 8 of them), plus `npx tsc --noEmit -p tsconfig.json` exit 0.
- Report-only, the hard budget and the kill switch are unchanged; retries never bypass the ledger. — **measured**: the retry goes through `budget.reserve()` (its own `reserve`/`outcome`/`cost` lines on the same ledger, counted by `model_calls`), and a refusal at the retry's reservation still throws `BudgetRefusedError`. No gating path, no kill-switch path and no cap was touched.

## Evidence

### AC1 — the enumerated `call_failure`, read from the bytes; and exit 0 + no result

The classifier is `callFailureClass(diag)` where `diag` is the **engine's own** `streamDiagnostics(stdout)`
(`docs/analysis/arch-hypothesis-generation.mjs`), consumed through the module interface — one stream reader,
not a second. Exact fixture readings (printed by a script over the built files):

```
stdout fixture                                        | bytes | lines | json_lines | unparsed | truncated_json | api_error_event | has_result | class
(empty stdout)                                        |     0 |     0 |          0 |        0 | false          | false           | false      | no-stdout
init+assistant, no result                             |   145 |     2 |          2 |        0 | false          | false           | false      | stream-without-result
success stream + cut last line                        |   202 |     3 |          2 |        1 | true           | false           | true       | truncated-json
result is_error (error_during_execution)              |   199 |     2 |          2 |        0 | false          | true            | true       | api-error-event
result subtype success + is_error [measured gateway 400] | 272 |     2 |          2 |        0 | false          | true            | true       | api-error-event
plain non-JSON text                                   |    20 |     1 |          0 |        0 | false          | false           | false      | unclassified
half a stream, timed_out                              |    13 |     1 |          0 |        0 | false          | false           | false      | killed-by-timeout
success stream (answered)                             |   188 |     2 |          2 |        0 | false          | false           | true       | (null — a call that answered)
```

- Precedence is stated (timeout → no-stdout → truncated-json → api-error → stream-without-result → unclassified),
  because more than one can be true of the same bytes; `unclassified` is a REAL value, never folded to success.
- `truncated-json` requires the LAST non-empty line to be cut mid-write; an unparseable line in the MIDDLE
  is its own reading (`unparsed_json_lines:1, truncated_json:false`), pinned by the same test.

**Exit 0 + no `result` ⇒ `not-evaluated:no-result-event`, never null**:
```
callNotEvaluatedToken({exit:0, spawn_error:null, subtype:null, has_result:false, is_error:null}) === "not-evaluated:no-result-event"   (≠ null)
callNotEvaluatedToken({exit:0, spawn_error:null, subtype:null})                                    === "not-evaluated:no-result-event"   (an UNCAPTURED has_result is «not queried», 硬规则 6)
callNotEvaluatedToken({exit:0, spawn_error:null, subtype:null, has_result:true})                   === null                            (the ONE shape that ran)
callNotEvaluatedToken({exit:1, spawn_error:null, subtype:"error_max_turns", has_result:true})      === "not-evaluated:error_max_turns"   (unchanged)
callNotEvaluatedToken({exit:null, spawn_error:"spawn timeout …", timed_out:true})                  === "not-evaluated:killed-by-timeout"
```

**Negative control — drop the classifier ⇒ red** (same predicate, mutated, in
`plugin/test/open-semantic-discovery-routine.test.mjs`):
```
the pre-fix rule  preFix({exit:0, has_result:false, …})            === null   ← the production shape reads as SUCCESS
the fixed rule    callNotEvaluatedToken(same record)              === "not-evaluated:no-result-event"
callFailureClass(classInputOf(API_ERROR_STREAM))                  === "api-error-event"
callFailureClass({…same bytes, api_error_event:false})            === null   ← without the capture the SAME bytes read CLEAN
+ static controls: the round really writes `api_error_event: diag.api_error_event`, `has_result: hasResult`,
  and derives `rec.call_failure = callFailureClass(…)` from them (so the mutation is of a produced value).
```

**A REAL round's record of exactly the production shape** (real manual round of this routine,
`osd-2485488-1791852380783-h4fp4c`, launcher seam pointed at `/bin/true` — a real subprocess that exits 0
and prints nothing; recorded in a scratch workspace, NOT in the production carrier):
```
{"step":"investigator","exit":0,"signal":null,"timed_out":false,"wall_ms":5,"stdout_bytes":0,
 "stdout_lines":0,"stdout_events_by_type":{},"has_result":false,"tokens":{"input":0,"output":0},
 "cost_usd":null,"cost_source":"per-call-ceiling","cost_charged_usd":1,
 "call_failure":"no-stdout","not_evaluated":"not-evaluated:no-result-event",
 "reservation_id":"dmr-2485488-0-duxby4cd","retry_of":null,
 "stdout_capture":{"path":".quay/open-semantic-discovery-call-captures/osd-2485488-1791852380783-h4fp4c-investigator-dmr-2485488-0-duxby4cd.txt","bytes":100,"stdout_bytes":0,"stdout_head_chars":0,"stdout_head_truncated":false,"stdout_tail_chars":0,"stdout_tail_truncated":false,"stderr_chars":0,"stderr_tail_truncated":false}}
```
`stdout_capture.bytes:100` with `stdout_bytes:0` is the intended reading: the capture file carries the three
labelled sections and nothing else, and the record distinguishes «the capture is short because the stream was
short» from «because the bound cut it».

### AC2 — one counted retry, its own reservation id, and no retry when the ledger refuses

**Unit (stub launcher), exactly one retry** — `(n) AC2 — a retryable call is retried EXACTLY ONCE…`:
```
round.calls.filter(c => c.step === "investigator").length === 2          (the LOST call + its ONE retry)
inv[0].call_failure === "no-stdout"; inv[0].not_evaluated === "not-evaluated:no-result-event"; inv[0].retry_of === undefined
inv[1].retry_of === inv[0].reservation_id                               (the retry NAMES the call it repeats)
inv[1].retry_cause === "no-stdout"
inv[1].reservation_id !== inv[0].reservation_id                         (a FRESH reservation, never a reuse)
inv[1].not_evaluated === null                                           (the retry answered; the round reads it)
fact.state === "verified"
ledgerReserves(ws).filter(l => l.round === round.round_id).map(l => l.id).sort()
  deepEqual round.calls.map(c => c.reservation_id).sort()               (every record resolves in the ledger)
```

**Ledger lines, a REAL round** (fault-injected round above — the ledger is the round's OWN, named on the record):
```
{"kind":"reserve","id":"dmr-2485488-0-duxby4cd","ts":"2026-10-13T…","pid":2485488,"step":"investigator","tools":"Read,Grep,Glob","max_turns":12,"round":"osd-2485488-1791852380783-h4fp4c","used_before":0}
{"kind":"reserve","id":"dmr-2485488-1-9e968off","ts":"2026-10-13T…","pid":2485488,"step":"investigator","tools":"Read,Grep,Glob","max_turns":12,"round":"osd-2485488-1791852380783-h4fp4c","used_before":1}
⇒ TWO reservations, each its own id, the second one the retry (`retry_of` names the first). round.model_calls === 2.
```

**No retry when the ledger refuses** — `(n) AC2 — NO retry when the ledger refuses…`, with
`max_model_calls_per_24h: 1`:
```
spawn count n === 1          (the refusal stopped the retry BEFORE a second subprocess)
ledgerReserves(ws).length === 1   (a refused reserve appends NO ledger line — the retry left none)
round.model_calls === 1; round.calls.length === 1
round.calls[0].call_failure === "no-stdout"   (the lost call is still CLASSIFIED, not hidden by the refusal)
fact.state === "not-evaluated"; /budget-24h/ matches fact.reason
```

### AC3 — the production carrier (3 real manual rounds), and the 0-token reading

Three real **manual** rounds of this routine run against the **production root**
(`--root /data/home/yale/work/quay`, executing this branch's code), appending to the production carrier
`.quay/open-semantic-discovery-findings.jsonl`. Each line below is one call record, field-for-field:

```
--- round_id=osd-1475464-1791851145747-3kvspv ts=2026-10-13T00:25:46.754Z invoked_by=manual ---
    model_calls=12  cost_usd=0.814876  wall_ms=441387
    ledger reservations with round_id=osd-1475464-1791851145747-3kvspv: 12
      investigator        exit=1 signal=None wall_ms=49956  has_result=True tok=79130/7908  class=None not_evaluated=not-evaluated:error_max_turns rid=dmr-1475464-0-5zw23b1l
      investigator-report exit=0 signal=None wall_ms=48936  has_result=True tok=52243/8732  class=None not_evaluated=None rid=dmr-1475464-1-cf4u0nfx
      verifier            exit=0 signal=None wall_ms=45084  has_result=True tok=24105/7849  class=None not_evaluated=None rid=dmr-1475464-2-5nl0ddzn
      verifier            exit=1 signal=None wall_ms=24872  has_result=True tok=39003/3621  class=None not_evaluated=not-evaluated:error_max_turns rid=dmr-1475464-3-kvspunm5
      verifier-report     exit=0 signal=None wall_ms=3828   has_result=True tok=12923/386   class=None not_evaluated=None rid=dmr-1475464-4-xv6kiepf
      verifier            exit=1 signal=None wall_ms=57031  has_result=True tok=42548/9470  class=None not_evaluated=not-evaluated:error_max_turns rid=dmr-1475464-5-i03uoqgu
      verifier-report     exit=0 signal=None wall_ms=5651   has_result=True tok=12848/728   class=None not_evaluated=None rid=dmr-1475464-6-4d60365l
      refuter             exit=0 signal=None wall_ms=46237  has_result=True tok=28822/7260  class=None not_evaluated=None rid=dmr-1475464-7-szl4xb1q
      value-assessment    exit=1 signal=None wall_ms=23806  has_result=True tok=26170/3107  class=None not_evaluated=not-evaluated:error_max_turns rid=dmr-1475464-8-855auuwb
      value-assessment-report exit=0 signal=None wall_ms=11307 has_result=True tok=13936/1387 class=None not_evaluated=None rid=dmr-1475464-9-x7czov06
      novelty-check       exit=0 signal=None wall_ms=18519  has_result=True tok=19812/2483  class=None not_evaluated=None rid=dmr-1475464-10-6x7xd6zs
      shadow-investigator exit=0 signal=None wall_ms=103705 has_result=True tok=82717/15041 class=None not_evaluated=None rid=dmr-1475464-11-lbhvzfo7
    0-token calls: 0

--- round_id=osd-1910817-1791851588503-zm5n4s ts=2026-10-13T00:33:09.537Z invoked_by=manual ---
    model_calls=8  cost_usd=0.862171  wall_ms=354894
    ledger reservations with round_id=osd-1910817-1791851588503-zm5n4s: 8
      investigator        exit=0 signal=None wall_ms=120167 has_result=True tok=99075/18471 class=None not_evaluated=None rid=dmr-1910817-0-xyaj8dw9
      verifier            exit=1 signal=None wall_ms=30208  has_result=True tok=29823/4998  class=None not_evaluated=not-evaluated:error_max_turns rid=dmr-1910817-1-6ojlanhe
      verifier-report     exit=0 signal=None wall_ms=6621   has_result=True tok=13155/798   class=None not_evaluated=None rid=dmr-1910817-2-groliyb7
      verifier            exit=1 signal=None wall_ms=36889  has_result=True tok=32165/6294  class=None not_evaluated=not-evaluated:error_max_turns rid=dmr-1910817-3-pfsbz546
      verifier-report     exit=0 signal=None wall_ms=8887   has_result=True tok=13256/1118  class=None not_evaluated=None rid=dmr-1910817-4-15cnl10y
      verifier            exit=1 signal=None wall_ms=32329  has_result=True tok=39717/5245  class=None not_evaluated=not-evaluated:error_max_turns rid=dmr-1910817-5-th1lg9q6
      verifier-report     exit=0 signal=None wall_ms=3910   has_result=True tok=14338/435   class=None not_evaluated=None rid=dmr-1910817-6-cpkqxdxo
      shadow-investigator exit=0 signal=None wall_ms=114636 has_result=True tok=94539/18317 class=None not_evaluated=None rid=dmr-1910817-7-fv9t7ek9
    0-token calls: 0

--- round_id=osd-2148501-1791851943742-grjk7o ts=2026-10-13T00:39:04.752Z invoked_by=manual ---
    model_calls=7  cost_usd=0.663122  wall_ms=408368
    ledger reservations with round_id=osd-2148501-1791851943742-grjk7o: 7
      investigator        exit=0 signal=None wall_ms=130050 has_result=True tok=117636/20564 class=None not_evaluated=None rid=dmr-2148501-0-dkiwmsq9
      verifier            exit=0 signal=None wall_ms=102148 has_result=True tok=34292/16712 class=None not_evaluated=None rid=dmr-2148501-1-2m1zj64d
      verifier            exit=1 signal=None wall_ms=54156  has_result=True tok=33134/9093  class=None not_evaluated=not-evaluated:error_max_turns rid=dmr-2148501-2-apdx3qe0
      verifier-report     exit=0 signal=None wall_ms=6754   has_result=True tok=14407/987   class=None not_evaluated=None rid=dmr-2148501-3-cec3fbx7
      verifier            exit=1 signal=None wall_ms=16147  has_result=True tok=23450/2333  class=None not_evaluated=not-evaluated:error_max_turns rid=dmr-2148501-4-gpzl59az
      verifier-report     exit=0 signal=None wall_ms=4003   has_result=True tok=13052/441   class=None not_evaluated=None rid=dmr-2148501-5-4kr6sb21
      shadow-investigator exit=0 signal=None wall_ms=93837  has_result=True tok=91914/17077 class=None not_evaluated=None rid=dmr-2148501-6-ehtiazcb
    0-token calls: 0
```

Every record above carries the new fields (`wall_ms`, `signal`, `timed_out`, `stdout_bytes`, `stdout_lines`,
`stdout_events_by_type`, `has_result`, `reservation_id`, `round_id`, `call_failure`) — pasted condensed to the
decisive columns for width; the full records are on the carrier under those `round_id`s.

**0-token calls in that window: 0 of 27 total; `unclassified`: 0.** The Plan's `exit:0`/no-`result` shape did
NOT reproduce in these three rounds (the session's hang-prone shape did appear 7 times on 2026-10-12 and never
in this window) — so the conditional clause is discharged by pasting the count, and the class/capture reading
for the shape is pasted instead from the two places it WAS produced:

(a) the **real** fault-injected round above — `exit:0 has_result:false stdout_bytes:0`, 0 tokens,
`call_failure:"no-stdout"`, `not_evaluated:"not-evaluated:no-result-event"`, capture file `/... -dmr-2485488-0-duxby4cd.txt`
whose content is exactly:
```
# stdout head (first 2048 chars)

# stdout tail (last 2048 chars)

# stderr tail (last 4096 chars)
```
(stderr empty too — the launcher printed nothing; the head/tail ARE the justification);

(b) the **measured** 0-token gateway refusal (AC5 below), whose real stream is 4 336 bytes and classifies as
`api-error-event` by the routine's own classifier:
```
{bytes:4336, lines:4, json_lines:4, unparsed_json_lines:0, truncated_json:false, has_result:true,
 events_by_type:{system:2, assistant:1, result:1}, api_error_event:true}
call_failure === "api-error-event"   not_evaluated === "not-evaluated:api-error-event"
result text: "API Error: 400 anthropic_messages: Invalid model name passed in model=claude-sonnet-5-5. Call `/v1/models` to view avail…"
```
Here the stream's own `subtype` is **`success`** while `is_error` is `true` and usage is 0/0 — reading the
subtype verbatim would have minted the self-contradictory `not-evaluated:success`; the transport-error
predicate is what names it. (Both readings are pinned in the test file.)

### AC4 — the arithmetic

For every round in the window, over that round's own call records and the ledger the round NAMES
(`round.reservations.ledger`), counting `kind:"reserve"` lines whose `round` equals the round's published
`round_id`:

```
round osd-1475464-1791851145747-3kvspv : ledger reservations=12  == model_calls=12 ; sum(cost_charged_usd)=0.814876 == cost_usd=0.814876
round osd-1910817-1791851588503-zm5n4s : ledger reservations=8   == model_calls=8  ; sum(cost_charged_usd)=0.862171 == cost_usd=0.862171
round osd-2148501-1791851943742-grjk7o : ledger reservations=7   == model_calls=7  ; sum(cost_charged_usd)=0.663122 == cost_usd=0.663122
window totals: 27 calls, $2.340169 charged; 27 ledger reservations
```
and the set of ids matches one-for-one in both directions:
```
sorted(ledger reserve ids with round_id=r) == sorted(record.reservation_id for record in r.calls)   → True for all three
```
The charge per call is the realized gateway cost when the stream's usage AND the served model are both
readable (`cost_source:"gateway-rates"`, 27/27 above), else the `$1.00` per-call ceiling
(`cost_source:"per-call-ceiling"` — the fault-injected round's two calls, which is why that round reads
`cost_usd: 2`), so an unreadable price is counted AT or ABOVE its plausible cost, never as free.

### AC5 — the paired `unrecognized_model` run

Same prompt, same argv shape (`hardenedArgv(launchArgv(…), prompt, root, {tools:"", maxTurns:1,
outputFormat:"stream-json", model:<id>})`), only the model id differs:

```
id                    | wall_ms | exit | signal | subtype | num_turns | is_error | usage in/out | cost_usd | served_model          | has_result | unrecognized_model in stderr
v4.1flash-anthropic   |    2579 |    0 | null   | success |         1 | false    | 18855/204    | 0.099375 | v4.1flash-anthropic   | true       | yes
claude-sonnet-5-5     |     876 |    1 | null   | success |         1 | TRUE     |     0/0      | 0        | claude-sonnet-5-5     | true       | no
v4.1flash             |    1685 |    0 | null   | success |         1 | false    | 18852/49     | 0.095485 | v4.1flash           | true       | yes
```
(`result` text: `v4.1flash-anthropic` → `OK`; `v4.1flash` → `OK`; `claude-sonnet-5-5` → the 400 message above.)

Gateway `/v1/models` (read 2026-10-13) lists exactly: `v4.1flash, v4.1flash-anthropic, v4pro,
v4pro-anthropic, gpt-5.6-luna, gpt-5.6-terra, gpt-5.6-sol, gpt-6-astra, qwen3.8-max, qwen3.8-flash, glm-5.2,
glm-5.3`.

**Conclusion: no difference attributable to `unrecognized_model`.** The warning is emitted on calls that
succeed identically (`v4.1flash-anthropic` and `v4.1flash` both exit 0, `subtype:"success"`,
`num_turns:1`, full usage, non-empty result text) — so it is NOT the cause of the no-result calls, confirming
the coordinator's earlier observation on this task's own argv. **No id exists that is BOTH CLI-recognized and
gateway-accepted**: every id the gateway serves is non-`claude-*`, and the one CLI-recognized id tried
(`claude-sonnet-5-5`) is refused by the gateway with a 400. **The one measured difference is between
gateway-accepted and gateway-refused ids, not between "recognized" and "unrecognized"**: the refused id comes
back `exit 1`, `subtype:"success"`, `is_error:true`, `usage 0/0`, `has_result:true` — which is exactly why
AC1/AC2 key the failure on the stream's transport-error reading rather than on the subtype or the exit code.
**The production model was NOT changed.**

### What is still dark

- The **cause** of the original no-result calls remains unobserved in this window (the shape did not
  reproduce in 27 production calls). What changed is that it can no longer be read as a success, and that its
  bytes are now on the record when it does occur. No cause is asserted (硬规则 4 推论四).
- `streamDiagnostics` reads the launcher's envelope (`type`/`subtype`/`is_error`), so a future CLI that
  reports transport errors only on stderr would land in `unclassified` rather than `api-error-event` — the
  `unclassified` bucket is the place that would show it, and its count is now on every round.

## Touches
- tasks/gap-open-discovery-model-calls-exit-without-result-are-unattributed-zero-token.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/test/open-semantic-discovery-routine.test.mjs
- docs/analysis/arch-hypothesis-generation.mjs
