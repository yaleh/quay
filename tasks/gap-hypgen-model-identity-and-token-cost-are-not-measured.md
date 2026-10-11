---
id: gap-hypgen-model-identity-and-token-cost-are-not-measured
title: "arch-hypothesis-generation: the investigator cannot be run on a chosen
  model, and no model call records its actual model identity or token cost"
status: done
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra:
  schema: execution
---
## Proposal
A pre-registered experiment needs to compare the current investigator model with a stronger one, and to measure the real cost of every call. In `docs/analysis/arch-hypothesis-generation.mjs` at develop `8ff91ba41`, read on 2026-10-12, it cannot:
- **No model override.** `investigate` takes its model only from `launchArgv("meta-driver")` (around lines 1451-1454: `const model = modelFromArgv(hardenedArgv(launchArgv, "", root))`). There is no flag to choose another model, so a model comparison is impossible without editing global launcher config, which would also change production drivers.
- **Requested, not actual.** The recorded `model` is the one that was REQUESTED (`modelFromArgv` parses `--model` from argv), not the one the gateway actually served. This is hard rule 4b: a proxy recorded as if it were the direct reading.
- **Cost is not observable.** No model call records token usage. `investigate` and `review` run plain `-p` text output. `verify` uses `--output-format stream-json`, but `parseVerifierStream` keeps only per-turn tool calls (no `usage`). Every cost figure so far has been wall time and bytes only.
- **Measured fact.** The local gateway behind the launcher serves `v4.1flash`, `v4.1flash-anthropic`, `v4pro` and `v4pro-anthropic`, according to the comments in `~/.local/bin/claude-fjdac`.

## Plan
1. Add an optional `--model <id>` to `investigate`, `verify` and `review`. It overrides only that call's `--model` in the hardened argv, never global config. Without it, behaviour is byte-identical.
2. Run every model call (investigate, verify, review) with `--output-format stream-json --verbose`, and parse two events from the stream:
   - the `system`/`init` event's `model` field, which is the ACTUAL model;
   - the final `result` event's `usage` (input/output/cache tokens) and `total_cost_usd` (if present).
3. Record `requested_model`, `actual_model`, `usage` and `cost_usd` on every run, verify and review record.
   - `actual_model` absent ⇒ `not-evaluated:model-unverified`.
   - requested ≠ actual ⇒ recorded as a mismatch, never silently passed.
4. The investigator's parsed hypotheses must stay identical. Extract the final assistant text from the stream (the `result` event's `result` text), not raw stdout.
5. Pre-registration: when `--model` is used, the run records the model, and a prereg `models` map (if present) must match the run's requested model, or scoring refuses.

## Acceptance Criteria
- [x] `node --test plugin/test/arch-hypothesis-generation.test.mjs` exits 0. New cases use a stubbed stream:
  - (a) `--model X` puts `X` into the argv of investigate/verify/review, and nothing else changes.
  - (b) An init event with model `Y` records `actual_model: Y`.
  - (c) A stream without an init model ⇒ `not-evaluated:model-unverified`.
  - (d) The usage numbers from the result event are recorded.
  - (e) The hypotheses parsed from the stream's result text equal those parsed from the same text given as plain stdout.
  - (f) A prereg `models` map whose value differs from the run's requested model makes scoring refuse.

  Output (`node --test plugin/test/arch-hypothesis-generation.test.mjs`): `ℹ tests 40 / ℹ pass 40 / ℹ fail 0`, with the 6 new cases green:
  ```
  ✔ AC-model(a): --model overrides only the model in the hardened argv, for every verb
  ✔ AC-model(b): the init event's model is recorded as actual_model, and a mismatch is recorded
  ✔ AC-model(c): a stream without an init model records not-evaluated:model-unverified
  ✔ AC-model(d): the result event's token usage and total_cost_usd are recorded on the call
  ✔ AC-model(e): hypotheses from the stream's result text equal those from the same plain stdout
  ✔ AC-model(f): a prereg models map that contradicts the run's requested model refuses scoring
  ```
  (a) asserts the override changes ONLY the `--model` value (`deepEqual(withX, base` with the one slot swapped `)`) and that no override is byte-identical; (c) asserts the requested proxy `requested-x` is NEVER copied into `actual_model`.
- [x] Real calls:
  - one `investigate --runs 1` with no `--model`;
  - one with `--model v4pro-anthropic`;
  - both on a tiny 3-component inventory fixture and an empty neutral cwd.

  Fixture: 3 lines `alpha.ts`/`beta.ts`/`gamma.ts`, neutral dir empty; `cd neutral && node --experimental-strip-types docs/analysis/arch-hypothesis-generation.mjs investigate --inventory inventory.txt --neutral-dir neutral --runs 1 …`.
  Run 1 (no `--model`):
  ```
  {"run":1,"exit":0,"n_hyps":8,"parse_error":null,"wall_ms":23532,
   "requested_model":"v4.1flash-anthropic","actual_model":"v4.1flash-anthropic","model_mismatch":false,
   "usage":{"input_tokens":19112,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":3809,...},
   "cost_usd":0.190785}
  ```
  Run 2 (`--model v4pro-anthropic`):
  ```
  {"run":1,"exit":0,"n_hyps":4,"parse_error":null,"wall_ms":25129,
   "requested_model":"v4pro-anthropic","actual_model":"v4pro-anthropic","model_mismatch":false,
   "usage":{"input_tokens":19163,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":2121,...},
   "cost_usd":0.14884}
  ```
  Reported as the gateway returned it: in BOTH runs the init event's `model` equals the requested alias (`v4pro-anthropic` served as `v4pro-anthropic`), so `model_mismatch:false`; no error. The cost is now directly observed (wall time only before).
- [x] Mutation control: make the recorder copy `requested_model` into `actual_model`, and show case (c) goes red. Paste the output, then revert.

  Mutation (`modelCallFields`, line 715): `actual_model: actual ?? MODEL_UNVERIFIED,` → `actual_model: actual ?? (requested ?? MODEL_UNVERIFIED),`.
  ```
  ✖ AC-model(c): a stream without an init model records not-evaluated:model-unverified
    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
    + actual - expected
    + 'requested-x'
    - 'not-evaluated:model-unverified'
  ℹ tests 6 / ℹ pass 5 / ℹ fail 1
  ```
  Reverted from a `cp` backup ⇒ `AC-model(c)` ✔ again, 6/6 pass; `git status` clean.

## Definition of Done
- [x] All AC ticked with outputs pasted.
- [x] `scripts/test.sh --for-task gap-hypgen-model-identity-and-token-cost-are-not-measured` green (exit 0; 40/40; scoped-gate cache written for develop `97b08eb91`).
- [x] No change to frozen prompt files or to global launcher config.

## Touches
- tasks/gap-hypgen-model-identity-and-token-cost-are-not-measured.md
- docs/analysis/arch-hypothesis-generation.mjs
- plugin/test/arch-hypothesis-generation.test.mjs
