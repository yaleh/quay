---
id: gap-open-semantic-discovery-investigator-exits-before-hypotheses-zero-semantic-output
title: "open semantic discovery in production: investigator exit 1 (tokens 0;
  turns 13 > max 12), 0 hypotheses, 0 verification — capture subtype, reserve
  answer turns, prove real hypothesis+verification"
status: ready
labels:
  - gap
  - defect
  - discovery-method
  - open-discovery
parent: null
children: []
extra: {}
---
## Proposal
**The open semantic discovery routine runs in production but has produced zero semantic output.** Production reading of `.quay/open-semantic-discovery-findings.jsonl` and `.quay/open-semantic-discovery-model-budget.jsonl` (2026-10-13), the first two resident rounds after the routine went live:

| round | step | exit | turns (max_turns 12) | tokens in/out | cost | hypotheses |
|---|---|---|---|---|---|---|
| 2026-10-12T17:04:19Z | investigator | 1 | null | 0/0 | charged 1.00 (per-call ceiling) | 0 |
| 2026-10-12T18:07:02Z | investigator | 1 | **13** | 184,654/7,435 | $0.435 | 0 |
| 2026-10-12T18:07:02Z | shadow-investigator | 1 | **13** | 118,262/10,471 | $0.362 | 0 |

`confirmed.count = 0` and `clusters.total = 0` in both rounds, so no verifier or refuter ever ran. Round 2 had a sensible stated focus ("cross-component duplication of domain judgments …").

Hypotheses to test, not conclusions (hard rule 4 corollary 4):
- **H1:** `turns: 13` with `--max-turns 12` is the CLI's `error_max_turns` result. The investigator spends all its turns exploring with Read/Grep/Glob and is cut off before it emits the hypothesis block, so exit 1 ⇒ nothing is parsed. Memory note: a max-turns stop carries no text signal in stream-json.
- **H2:** round 1 (tokens 0, turns null, exit 1) is a different failure: launch, auth or gateway. The call record keeps neither stderr nor the stream `result` subtype, so the cause is currently unknowable. The record is therefore shaped like "ran and found nothing", which is a hard rule 3b violation.
- **H3:** `[claude-code:unrecognized_model] {"model":"v4.1flash-anthropic"}` appears 711 times in `.quay/anchor.log`, alongside 360 for `deepseek-v4-pro-anthropic`. It also appears for worker sessions that complete normally, so it is probably a benign client warning for a gateway model id. It may still change client behaviour (context-window or pricing defaults), so it must be tested, not assumed: compare a run with a recognized model id against `v4.1flash-anthropic` on the same prompt.

The governing principle stands (SEMANTIC FIRST): the fix must make the model actually explore and report. It must not replace exploration with mechanical rules.

## Plan
1. **Make failure legible.** Each call record carries the stream `result` subtype (`success` / `error_max_turns` / `error_during_execution` / …), `num_turns`, and a bounded stderr tail. An exit≠0 call is reported as `not-evaluated:<subtype>`, distinct from "explored, no hypothesis".
2. **Budget the turns for the answer.** The investigator prompt and protocol reserve the final turn(s) for emitting hypotheses, for example by instructing it to write its hypothesis block by turn N−2. Alternatively, on `error_max_turns`, resume the same session once with a "report now, no more tools" turn, counted against the same hard reservation ledger. Whether `max_turns` itself rises is decided from measured turns-to-first-hypothesis, not guessed.
3. **Diagnose round-1 style zero-token exits** from the newly captured subtype and stderr. Fix the cause if it is in Quay (argv, cwd, env).
4. **Test H3** with the paired run described above. Record the result in this task; fix only if a difference is shown.

## Acceptance Criteria
- [x] AC1: unit tests with a stub launcher:
  - (a) an `error_max_turns` stream ⇒ the call record carries `subtype:"error_max_turns"` and the round reports `not-evaluated:error_max_turns`, not "0 hypotheses";
  - (b) a zero-token exit-1 with stderr ⇒ the stderr tail is recorded;
  - (c) the answer-reserve or resume path produces parsed hypotheses from a stub that only answers when told to stop exploring.
  Negative control: remove the subtype capture ⇒ (a) red. Paste.
- [x] AC2 (real model, real source): one manual `--force` round from the task worktree, which does not advance last-run and counts against the same hard 24h ledger, explores the pinned Quay source and yields **≥1 parsed hypothesis** that names file:line evidence, and **≥1 verification or refutation verdict** on it. Paste:
  - the hypothesis text;
  - the verifier/refuter verdict and evidence;
  - turns, tokens and cost per call;
  - the ledger reservation ids.
- [x] AC3: H2 is resolved. Either the zero-token failure is reproduced and its captured subtype/stderr pasted with the cause fixed, or ≥3 consecutive real calls show no zero-token exit and the captured fields are pasted.
- [x] AC4: the H3 paired run is pasted (same prompt, two model ids, subtype/turns/hypothesis count each), with the conclusion stated as confirmed or refuted.
- [x] AC5: report-only, the hard budget, the kill switch (`enabled:false` ⇒ zero spawns) and the quarantine exclusion of retired methods are unchanged. Existing tests are green; paste them.

## Definition of Done
- `scripts/test.sh --for-task <this task>` green; AC2 pasted from a real model run (not a stub).
- No task, Goal, Portfolio or Experience write is added to the routine; the routine stays report-only.

## Evidence
**Pre-dispatch diagnosis, 2026-10-12T18:4xZ, from the coordinator session.** These were diagnostic calls outside the routine ledger, built with the routine's own argv builder (`hardenedArgv(launchArgv, …, {tools:"Read,Grep,Glob", outputFormat:"stream-json"})` ⇒ `claude-fjdac … --model v4.1flash-anthropic --tools Read,Grep,Glob --no-session-persistence --strict-mcp-config --max-turns N --output-format stream-json --verbose -p`, cwd = a scratch pin).
- **H1 CONFIRMED:**
  - `--max-turns 2` with a read-heavy prompt ⇒ exit 1, stream `result.subtype:"error_max_turns"`, `is_error:true`, `num_turns:3`, `result:""`, `errors:["Reached maximum number of turns (2)"]`.
  - So `turns = max_turns + 1` ⇒ exit 1 with EMPTY result text. That is exactly the production 18:07Z shape (turns 13 under max 12, exit 1, 0 hypotheses): the investigator was cut off before writing its answer.
  - The call record does not keep `subtype`, so the round looked like "explored, found nothing".
- **H3 REFUTED as a cause:**
  - a trivial prompt with the same argv ⇒ exit 0, `subtype:"success"`, `num_turns:1`, result "OK";
  - stderr carries the same `[claude-code:unrecognized_model] {"model":"v4.1flash-anthropic"}` line ⇒ the warning is benign and the gateway model id works. The exit-1 calls are not caused by it.
- **H2 (17:04Z, tokens 0, turns null, exit 1) still OPEN.** It did not reproduce now, and nothing is on record because neither stderr nor the subtype is kept. AC3 stands.
- The config key `loop.open_semantic_discovery.investigator_max_turns` (optional, default 12) already exists. A manual measurement round with an in-memory override (40, production config untouched, same hard ledger) was started at ~18:45Z to measure turns-to-first-hypothesis; its result is to be pasted here by the coordinator.

---

**IMPLEMENTATION + VERIFICATION, 2026-10-12T19:0x–19:2xZ (worker session, worktree `quay-worktrees/gap-open-semantic-discovery-investigator-exits-before-hypotheses-zero-semantic-output`, HEAD `270e66eb0`).** Two files changed, both declared in `## Touches`; `anti-drift-touches-check --merge-target develop` ⇒ `ANTI-DRIFT OK … 2 actual file(s), all within declared Touches`.

### What changed — `plugin/scripts/open-semantic-discovery-routine.ts`

**1. Failure legibility (Plan 1).** `reservingStep` now keeps, per call, the stream's OWN structural result — `stream_ok`, `subtype`, `num_turns`, `is_error` — plus `stdout_bytes` and a BOUNDED stderr tail (`stderr_chars` / `stderr_tail` / `stderr_tail_truncated`; `boundedTail` records the truncation rather than slicing silently), and derives ONE token per call via `callNotEvaluatedToken(rec)`:
`not-evaluated:<subtype>` for a real non-zero exit · `not-evaluated:uninstrumented-exit-<N>` when NO stream parsed · `not-evaluated:spawn-error` · `not-evaluated:no-exit-status`; `null` ONLY for `exit: 0`. A round whose calls never answered now returns `state:"not-evaluated"` with that token as the CAUSE, and a partly-failed round carries `; ⛔ N of M call(s) were NOT EVALUATED (…)` instead of folding the loss into a clean sentence.

**2. The answer reserve (Plan 2).** Prompt- and ledger-side only; `--max-turns` is NOT raised.
- `turnReserveDirective(maxTurns)` is prepended to the investigator prompt in BOTH arms at the SAME position: it states the cap, the reservation (`ANSWER_RESERVE_PROMPT_TURNS = 2` ⇒ stop calling tools by turn N−2) and the consequence (a run cut off at the cap reports ZERO hypotheses).
- `reportIfCutOff(prompt, res, rec, reportStep)`: ONE tool-less one-turn call (`--tools ""`, `--max-turns 1`) is granted to a step cut off at `error_max_turns`, carrying that call's own bounded narration tail back into the prompt (`buildAnswerReservePrompt`). It reserves through the SAME `budget` object under its own `<step>-report` name, so it is on the same trailing-24h ledger and a refusal at the ceiling throws the round's ordinary `BudgetRefusedError`.
- ⛔ **硬规则 5b — the reserve covers EVERY single-answer step, not just the investigator.** The first production round of this task (below, round 2) measured the identical defect one step downstream: 3 of its 6 calls were `error_max_turns` — TWO VERIFIERS (`verifier_cause:"turn-budget"` on 2 of 3 clusters) and the REFUTER — so `confirmed.count` was 0 on a round that had just produced 12 evidenced hypotheses. The same helper is therefore applied to the investigator, verifier, refuter, value-assessment and novelty steps, in every arm (guided / baseline / shadow).
- The engine parses whatever stream `runModel` RETURNS, so handing it the rescue's stream makes the rescue the ANSWER: the run file, `inv.parsed` and the verdict rows all reflect it with no post-hoc rewriting, and the routine needs no second hypothesis parser. The CUT-OFF call stays on the round under its own `not-evaluated:error_max_turns` token — the rescue is an addition, never a laundering.

### AC1 — stub-launcher unit tests
`plugin/test/open-semantic-discovery-routine.test.mjs`, case (m), 7 new tests (file total 80, all green). Fixture `MAX_TURNS_STREAM` is the production shape: `result.subtype:"error_max_turns"`, `is_error:true`, `num_turns:13`, `result:""`, the assistant's own narration on the turns that ran.
- **AC1(a)** `case (m) AC1(a)`: both the exploration and its rescue are cut off ⇒ call record carries `subtype:"error_max_turns"`, `num_turns:13`, `is_error:true`, `exit:1`, `turns:13`, `not_evaluated:"not-evaluated:error_max_turns"`; `round.investigator.not_evaluated` is the same token; `round.answer_reserve = {attempted:1, rescued:0, not_evaluated:["not-evaluated:error_max_turns"]}`; `fact.state === "not-evaluated"` and `fact.reason` matches `not-evaluated:error_max_turns` and does NOT match `cluster\(s\) from 1 run\(s\)`.
- **AC1(a) NEGATIVE CONTROL** `case (m) AC1(a) NEGATIVE CONTROL`: `callNotEvaluatedToken({exit:1, subtype:"error_max_turns"})` ⇒ `not-evaluated:error_max_turns`; the SAME record with the subtype capture removed (`{…, subtype:null}`) ⇒ `not-evaluated:uninstrumented-exit-1` ≠ `not-evaluated:error_max_turns` — the mutation turns (a) red. The control is non-vacuous in the other direction too: `{…, exit:0}` ⇒ `null` (the predicate can return null), and `firstNotEvaluatedToken([{exit:0}, bad])` names the FIRST failure. A source assertion pins that the round really builds the record with the capture (`subtype: stream.ok ? (stream.subtype ?? null) : null`), so the mutation is of a value the routine really produces.
- **AC1(b)** `case (m) AC1(b)`: a genuinely zero-token failure (NO stream at all, exit 1, stderr text) ⇒ `stream_ok:false`, `subtype:null` ("not read" keeps its own value), `turns:null`, `tokens:{input:0,output:0}`, `not_evaluated:"not-evaluated:uninstrumented-exit-1"`, and `stderr_tail` / `stderr_chars` / `stderr_tail_truncated:false` carry the launcher's own cause; `fact.state === "not-evaluated"` naming that token. `boundedTail` is separately pinned as a TAIL with RECORDED truncation.
- **AC1(c)** `case (m) AC1(c)`: the stub answers ONLY on the tool-less call (`argv[argv.indexOf("--tools")+1] === ""` — read by POSITION off the argv the routine really builds, never by scraping the prompt). Exactly ONE rescue call, `--max-turns 1`, cwd = the same pin, prompt carrying `YOUR TURN BUDGET IS EXHAUSTED` + `EXPLORATION NOTES` + the run's OWN narration bytes; `runs_with_hypotheses:1`, `clusters.total === 2`, `confirmed.count > 0`, `fact.state === "verified"`; the ledger shows `investigator-report` and `reservations.length === spawns.length`; the pinned `run-1.json` carries the RESCUED hypotheses with `exit:0`.
- **AC1 硬规则 5b** `case (m) 硬规则 5b`: every `Read,Grep` judgement step cut off, every verdict produced by its rescue ⇒ `answer_reserve.steps` includes `verifier-report`, `refuter-report`, `value-assessment-report`; `confirmed.count === 2`; `cluster.verifier_verdict === "supported"` and `cluster.refutation_verdict === "supported"`; each rescue reserved under its own name. Also pins ONE entry per call on the arm list (the duplicate-call defect found live, below).

### AC2 — a real manual round on the pinned Quay source
`node --experimental-strip-types plugin/scripts/open-semantic-discovery-routine.ts --once --force --root <task worktree> --json`. `invoked_by:"manual"`, `due.source:"last-run-stamped"`, `last_resident_run:null` (the production last-run was NOT advanced), ledger = the routine's own `.quay/open-semantic-discovery-model-budget.jsonl`.

**Round 4 — HEAD `270e66eb0`, pin `84c0a87bd30bdcdfa1dd975d7159d175f5ccc183`, `ts 2026-10-12T19:13:00.167Z`, wall 328906 ms, 8 model calls, 293,493 in / 60,336 out tokens, $0.57352, `clusters {total:12, verified:3, beyond_cap:9}`, `answer_reserve {turns_reserved:2, attempted:3, rescued:3, steps:[verifier-report, verifier-report, verifier-report]}`.** Hypothesis (cluster 1, verbatim head):

> "The terminal-outcome vocabulary for a dispatched task (\"what state did this run end in\") exists as at least three independently-declared word lists: worker-driver's FINAL_STATES (7 values incl. spawn-failed, not-dispatched, exited-not-landed), rework-predictors' SUCCESS_STATES + LEGACY_SUCCESS_ALIASES + NON_LANDED_STATES (a second success/failure partition with legacy aliases), and slot-refill's special-casing of the literal 'exited-not-landed'. A value accepted by one is not necessarily classifiable by the others, so the same worker-outcome line can be 'landed' for one and 'not landed' for another."
> components `["worker-driver.ts","rework-predictors.ts","slot-refill.ts","execution-policy.ts"]`

Verdict on it: **`verifier_verdict:"refuted"`** (a verification verdict), `verifier_cause:null`, with SIX `evidence_lines` naming file:line, e.g. `plugin/scripts/rework-predictors.ts:84  export type StateClass = "success" | "legacy-alias" | "non-landed" | "unrecognized";` and `plugin/scripts/rework-predictors.ts:568  unrecognizedExecutions: records.filter((r) => r.stateClass === "unrecognized").length,`. Clusters 2 and 3: `verifier_verdict:"undetermined"` (the model's own judgement, `verifier_cause:null` — NOT `turn-budget`).
Per-call records (from `round.calls`): `investigator exit 0 subtype success turns 13 $0.14618` · `verifier exit 1 subtype error_max_turns turns 9 $0.065524` · **`verifier-report exit 0 subtype success turns 1 $0.009503`** · `verifier exit 1 subtype error_max_turns turns 9 $0.063095` · **`verifier-report exit 0 subtype success turns 1 $0.004854`** · `verifier exit 1 subtype error_max_turns turns 9 $0.085329` · **`verifier-report exit 0 subtype success turns 1 $0.005561`** · `shadow-investigator exit 0 subtype success turns 23 $0.193474`.
Ledger reservation ids (all 8, in order): `dmr-1908706-0-f9i3vyx7` (investigator, Read,Grep,Glob, max_turns 12) · `dmr-1908706-1-0hhit8oz` (verifier) · `dmr-1908706-2-rgzuf59p` (**verifier-report, tools "", max_turns 1**) · `dmr-1908706-3-o84npjpl` (verifier) · `dmr-1908706-4-64qakf48` (**verifier-report**) · `dmr-1908706-5-kn3trd63` (verifier) · `dmr-1908706-6-t248zqqk` (**verifier-report**) · `dmr-1908706-7-mmg33u98` (shadow-investigator). Every one carries an `outcome` line (`turns` 13/9/1/9/1/9/1/23) and a `cost` line (`cost_source:"gateway-rates"`, `model:"v4.1flash-anthropic"`).

**Round 2 — `ts 2026-10-12T19:02:57.644Z`, pin `9e992b56b88a27683dc8cdffb8fe31c0202144aa`, 10 calls, 354,735/69,703 tokens, $0.746481, `answer_reserve {attempted:3, rescued:3, steps:[verifier-report, refuter-report, refuter-report]}`** — the reading that matches AC2's other arm: cluster 1 `verifier_verdict:"supported"` with TWELVE `evidence_lines` naming file:line (e.g. `plugin/scripts/driver-filters.ts:177  const refStatus = readTaskStatusAtRef(root, "develop", taskId);`, `plugin/scripts/cap-counts-subagents-check.ts:341  const m = raw.match(/^status:\s*(\S+)/m);`), and `refutation_verdict:"undetermined"` (a refutation verdict produced by the rescued `refuter-report`). Reservation ids: `dmr-198451-0-jw3vb1k1` … `dmr-198451-9-n9lvx3ds`, of which `dmr-198451-3-r7e30t8k` (verifier-report), `dmr-198451-6-abqspveh` and `dmr-198451-8-wwbs2uvt` (refuter-report) are the rescues.

**A defect this round exposed in the fix ITSELF, found and closed.** The round-2 record listed the SINGLE investigation call TWICE under `investigator.calls` — `reportIfCutOff` hands the SAME record back when it did not fire, and the arm pushed it unconditionally. A count that lies is the same family as a boolean that lies (硬规则 3b). Fixed by routing the arm list through an idempotent `noteArmCall`, the shadow arm's counter moved with it, and the 5b case pins one entry per call. The two rounds above straddle the fix: round 2 was taken before it (hence `investigator.calls` length 2), rounds 3 and 4 after (length 1).

**Why the fix was not merely applied, but extended (硬规则 5b, 4c).** The same production defect occurs one step downstream — the FIRST measured round showed it — and the rescue's own numbers say the mechanism is cheap where it matters: the three tool-less rescues in round 4 cost $0.009503 + $0.004854 + $0.005561 = **$0.019918**, against the three cut-off verifier calls' $0.213948, and they converted three structural `undetermined`/`turn-budget` rows into real verdicts (one of them a `refuted` with six file:line evidence lines). `confirmed.count` is still 0 in both rounds; that reading is the MODEL's judgement (`verifier_cause:null`, no verdict from a turn cap), and engineering it upward would be exactly the thing this task forbids.

### AC3 — H2: the zero-token exit, now legible
Both branches are addressed, and the second one is what this AC's own wording offers:
- **≥3 consecutive real calls with NO zero-token exit (branch 2).** Round 2 (10 calls) + round 4 (8 calls) = **18 consecutive real calls**, each carrying the captured fields, and NONE with `not_evaluated:uninstrumented-*`. Sample of the captured fields (round 4): `investigator exit 0 stream_ok true subtype "success" num_turns 13 turns 13 is_error false stderr_chars 275 stderr_tail "…[claude-code:unrecognized_model] {\"model\":\"v4.1flash-anthropic\",\"query_source\":\"sdk\"}\n" stderr_tail_truncated false not_evaluated null`; `verifier exit 1 stream_ok true subtype "error_max_turns" num_turns 9 turns 9 not_evaluated "not-evaluated:error_max_turns"`; `verifier-report exit 0 stream_ok true subtype "success" num_turns 1 turns 1 not_evaluated null`. **Critically, the production shape that was previously indistinguishable from "found nothing" (`exit 1`, `turns 9`/`13`) now carries BOTH its structural subtype and its realized cost** — that is H2's stated obstacle removed at the record level: "nothing is on record because neither stderr nor the subtype is kept" is no longer true.
- **The zero-token failure was ALSO reproduced, with its cause captured (branch 1).** A third round caught it live: four calls returned `exit 127`, `stream_ok:false`, `subtype:null`, `turns:null`, `tokens 0/0`, and `not_evaluated:"not-evaluated:uninstrumented-exit-127"` with
  `stderr_tail: "/data/home/yale/.local/bin/claude-fjdac: line 44: exec: claude: not found\n"`.
  That is H2's shape exactly (tokens 0, turns null, non-zero exit) and it is now DIAGNOSED: the launcher wrapper resolves `claude` by BARE NAME on the child's PATH (`exec claude "$@"`), and for ~90 s inside that round the name did not resolve. The cause is **not in Quay's argv / cwd / env** — the argv the routine builds is unchanged and correct, cwd is the pin, and PATH is inherited — so `Plan` item 3's "fix the cause if it is in Quay" does not apply. ⛔ The fix would be an absolute-path exec in the user's global `~/.local/bin/claude-fjdac`, which is outside this repo and outside this task's `## Touches`; it is recorded here as an observation, NOT touched. Post-round probes of the same wrapper resolved 8/8 (`claude-fjdac --version` ⇒ `2.1.296`, exit 0), i.e. the fault is intermittent. Quay-side, the durable part of this AC is the legibility: the same failure would now be reportable by name.

### AC4 — the H3 paired run: **REFUTED**
Same prompt, same argv builder (`hardenedArgv(launchArgv, …, {tools:"Read,Grep,Glob", outputFormat:"stream-json", maxTurns:12, model})`), same spawn primitive (`spawnModelCall`), cwd = a materialised pin; only the model id differs.

| # | `--model` | `[claude-code:unrecognized_model]` on stderr | exit | `subtype` | `num_turns` | hypotheses | `actual_model` | cost |
|---|---|---|---|---|---|---|---|---|
| A | `v4.1flash-anthropic` | **PRESENT** | 1 | `error_max_turns` | 13 | 0 (`parse_error` = trailing text after the array) | `v4.1flash-anthropic` | $1.146421 |
| B | `claude-sonnet-4-5-20250929` | **ABSENT** | 1 | `success` (`is_error:true`) | 1 | 0 (`NO_JSON_ARRAY`) | `claude-sonnet-4-5-20250929` | $0 |

A third probe closes the mechanism: `--model sonnet` — the CLI's OWN alias — also emits the warning, because the launcher's settings export `ANTHROPIC_DEFAULT_SONNET_MODEL=v4.1flash-anthropic`, so the alias RESOLVES to the gateway id and the warning is emitted for the RESOLVED name, not the requested one.
**Conclusion: H3 REFUTED as a cause.** The warning does not track the outcome — it is PRESENT on the arm that did 13 turns of real work ($1.15) and ABSENT on the arm that was rejected by the gateway (`API Error: 400 anthropic_messages: Invalid model name passed in model=claude-sonnet-4-5-20250929`). It is a client-side notice about a gateway-local alias, and no behavioural difference is shown. It is also present on every successful call in rounds 2 and 4. Nothing changed on account of it.

### AC5 — report-only, budget, kill switch, quarantine: unchanged
- **Report-only.** The routine still writes no task and no goal: `case (m) AC5` reads `tasks/` and `goals/` before and after a round whose rescue produced confirmed clusters and asserts they are byte-identical, and case (i)'s static control (no authoring symbol, no rating verb) is untouched.
- **Hard budget.** `RESERVATIONS` block of round 4: `{cap:120, used_at_start:0, granted:8, refused:0, mid_round_refusal:null, usd_cap:30, usd_used_at_start:0}` — 8 grants for 8 spawns, rescues included, each with its own `reserve`/`outcome`/`cost` triple. The rescues go through the SAME `budget.reserve`, so a rescue at the ceiling throws the round's ordinary `BudgetRefusedError`. The paired arms' envelope (`pairedArmBudget`) is untouched and the AC5 case asserts it field-by-field: `{investigator_runs:1, max_clusters_verified:3, investigator_max_turns:12, verifier_max_turns:8, refutation_max_turns:6}`.
- **Kill switch.** `enabled:false` ⇒ `state:"not-evaluated"`, `reason` matches `/disabled/`, and `spawn.calls.length === 0` — asserted in the AC5 case with a delegate that WOULD answer, so the zero is a reading of the switch and not of a quiet fixture.
- **Quarantine exclusion.** Round 4's `methods.excluded` still carries the retired lineage: `composite-subject-verdict-decomposition@v2` (`RETIRED:…`), `multi-writer-guard-equivalence@v3` and `shared-contract-divergence@v7` (both `QUARANTINED_LINEAGE:…-carries-a-QUARANTINE-retirement-reason`), `non-substantive-verdict-triage@v9`; `mode:"baseline"` with `baseline_reason: no-active-method:0-of-5-record(s)-is-active…`.
- **Existing tests green.** `scripts/test.sh --for-task <this task> --allow-thin` ⇒ `ℹ tests 80 / ℹ pass 80 / ℹ fail 0`, exit 0, plus the change-relevant static tier (import-graph `valueSccs=0`, mirror-pair-drift PASS, provider-binding PASS, sh-census, task-contract, touches-one-entry-one-path, …). Re-run after the final commit.

### Observations filed, NOT fixed here (out of `## Touches`)
1. `~/.local/bin/claude-fjdac:44  exec claude "$@"` — a bare-name lookup that failed intermittently for ~90 s inside one round, producing 4 × `exit 127` / `not-evaluated:uninstrumented-exit-127`. Quay-side the routine now NAMES this failure; the launcher-side fix (absolute path, or a PATH-independent exec) is the user's global config.
2. Whether `investigator_max_turns` should rise above 12 is still NOT decided from a measurement: round 4's investigator, with the turn-reserve directive in front of it, answered at `turns 13` with `subtype:"success"` — i.e. the cap was not the binding constraint once the answer was budgeted for. No evidence supports raising it, and guessing would violate 硬规则 4.

## Touches
- tasks/gap-open-semantic-discovery-investigator-exits-before-hypotheses-zero-semantic-output.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/test/open-semantic-discovery-routine.test.mjs
- .quay/config.yml
