---
id: gap-hypgen-model-identity-and-token-cost-are-not-measured
title: "arch-hypothesis-generation: the investigator cannot be run on a chosen
  model, and no model call records its actual model identity or token cost"
status: todo
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
- [ ] `node --test plugin/test/arch-hypothesis-generation.test.mjs` exits 0. New cases use a stubbed stream:
  - (a) `--model X` puts `X` into the argv of investigate/verify/review, and nothing else changes.
  - (b) An init event with model `Y` records `actual_model: Y`.
  - (c) A stream without an init model ⇒ `not-evaluated:model-unverified`.
  - (d) The usage numbers from the result event are recorded.
  - (e) The hypotheses parsed from the stream's result text equal those parsed from the same text given as plain stdout.
  - (f) A prereg `models` map whose value differs from the run's requested model makes scoring refuse.
- [ ] Real calls:
  - one `investigate --runs 1` with no `--model`;
  - one with `--model v4pro-anthropic`;
  - both on a tiny 3-component inventory fixture and an empty neutral cwd.

  Paste each run's `requested_model`, `actual_model`, `usage` and wall_ms. Report whatever the gateway returns, including a mismatch or an error.
- [ ] Mutation control: make the recorder copy `requested_model` into `actual_model`, and show case (c) goes red. Paste the output, then revert.

## Definition of Done
- All AC ticked with outputs pasted.
- `scripts/test.sh --for-task gap-hypgen-model-identity-and-token-cost-are-not-measured` green.
- No change to frozen prompt files or to global launcher config.

## Touches
- tasks/gap-hypgen-model-identity-and-token-cost-are-not-measured.md
- docs/analysis/arch-hypothesis-generation.mjs
- plugin/test/arch-hypothesis-generation.test.mjs
