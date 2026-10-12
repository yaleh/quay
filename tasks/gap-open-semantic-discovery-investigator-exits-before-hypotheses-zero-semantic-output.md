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
- [ ] AC1: unit tests with a stub launcher:
  - (a) an `error_max_turns` stream ⇒ the call record carries `subtype:"error_max_turns"` and the round reports `not-evaluated:error_max_turns`, not "0 hypotheses";
  - (b) a zero-token exit-1 with stderr ⇒ the stderr tail is recorded;
  - (c) the answer-reserve or resume path produces parsed hypotheses from a stub that only answers when told to stop exploring.
  Negative control: remove the subtype capture ⇒ (a) red. Paste.
- [ ] AC2 (real model, real source): one manual `--force` round from the task worktree, which does not advance last-run and counts against the same hard 24h ledger, explores the pinned Quay source and yields **≥1 parsed hypothesis** that names file:line evidence, and **≥1 verification or refutation verdict** on it. Paste:
  - the hypothesis text;
  - the verifier/refuter verdict and evidence;
  - turns, tokens and cost per call;
  - the ledger reservation ids.
- [ ] AC3: H2 is resolved. Either the zero-token failure is reproduced and its captured subtype/stderr pasted with the cause fixed, or ≥3 consecutive real calls show no zero-token exit and the captured fields are pasted.
- [ ] AC4: the H3 paired run is pasted (same prompt, two model ids, subtype/turns/hypothesis count each), with the conclusion stated as confirmed or refuted.
- [ ] AC5: report-only, the hard budget, the kill switch (`enabled:false` ⇒ zero spawns) and the quarantine exclusion of retired methods are unchanged. Existing tests are green; paste them.

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

## Touches
- tasks/gap-open-semantic-discovery-investigator-exits-before-hypotheses-zero-semantic-output.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/test/open-semantic-discovery-routine.test.mjs
- .quay/config.yml
