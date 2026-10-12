---
id: gap-discovery-method-per-round-quota-verify-reserve-deep-reflection
title: "discovery-method per-round quota after 24h=240: verification reserve,
  bounded code-reading reflection, partial persistence on wall breach"
status: todo
labels:
  - gap
  - discovery-method
  - budget-safety
parent: null
children: []
extra: {}
depends_on:
  - gap-discovery-method-24h-budget-hard-reservation
---
## Proposal
The user raised the discovery-method 24h ceiling from 24 to 240 on 2026-10-12, judging 6 calls per round too few for deep semantic reflection. The operator applied 240 in `.quay/config.yml` and reloaded the quality driver: its assembly line now prints `max_model_calls_per_24h=240`.

The per-round limits (`max_experiences: 8`, `max_model_calls: 6`, `max_wall_ms: 900000`) were not changed, so production still uses at most about 6 calls in each round that has new input. Measured on the 2026-10-12 14:59:56Z resident round:
- 119 reflection units were eligible; 8 were selected and `skipped_cap` was 111.
- 6 calls were made, all returning `decision:"no-method"`; 2 units were skipped (`BUDGET_MAX_MODEL_CALLS`).
- Wall time was 63s, about 10s per reflection call.
- At this rate the backlog takes about 15 rounds just to be looked at once.

Three structural limits need deciding:
1. **No verification reserve.** Reflection and generalization share ONE per-round counter (`modelCalls >= config.maxModelCalls`). A round whose reflection uses the whole quota and mints a candidate has nothing left to validate it, so a candidate can never be tested in the round that minted it.
2. **Reflection is text-only** (contrary to SEMANTIC FIRST). The live seam is `liveModelFactory({tools:"", maxTurns:null})`. The model sees an Experience's summary and components, but cannot read the code at the pin. Deep semantic reflection that inspects the actual code needs bounded read access. That must not degrade into a mechanical scan, and it must stay inside the hard budget.
3. **A wall breach discards the whole round.** "nothing appended, last-run not advanced": a longer, deeper round risks losing all of its spent calls' results, though the hard-budget task makes sure they are still COUNTED.

**Recommendation, to be confirmed by measurement in this task rather than taken as given:**

| Setting | Recommended | Why |
|---|---|---|
| `max_model_calls` (per round) | 16, of which `verify_reserve` 4 is held back for generalization | — |
| `max_experiences` / batch | 16 | — |
| `max_wall_ms` | 1800000 | — |

- 240/24h at a 60m cadence averages 10/round. Rounds with no new input spend 0, so a 16-call ceiling is a burst limit, and the 24h hard reservation bounds the day.
- Remaining-budget rule: a round may start reflection only if at least `verify_reserve + 1` units remain in the 24h ledger, so reflection never consumes the last calls that validation needs.

## Plan
1. Add a `verify_reserve` config key (integer ≥ 0, ≤ `max_model_calls`).
   - Reflection may use at most `max_model_calls − verify_reserve`; generalization may use the remainder plus anything reflection left unused.
   - Both still go through the hard 24h reservation from the dependency task, one reservation per subprocess.
2. Code access for reflection, **ON by default** under SEMANTIC FIRST, MECHANIZE LATER (user ruling 2026-10-12). Reflection that cannot read the code it reflects on is a mechanical summary-shuffler. Config key `reflection_tools`, default `Read,Grep,Glob`; `""` is the explicit fallback and the baseline arm:
   - when on, reflection runs with `--tools Read,Grep` against a pinned, stripped tree (the same pin materialisation the verifier uses) and an explicit `reflection_max_turns`;
   - realized turns are recorded per call;
   - the anti-leak/no-hand-coding rules of `discovery-reflection.mjs` still hold;
   - the prompt stays a semantic question (transferable method or no-method), not a scan recipe.
3. **Partial persistence on wall breach.** Results of completed calls are persisted with the round marked `partial:true` and the breach reason. The last-run is still not advanced, so the next round retries the unfinished units.
4. **Apply the recommended values** only after (1)–(3) land, and record the before/after config diff. If the measurements in AC contradict the recommendation, apply the measured values instead and say why.

## Acceptance Criteria
- [ ] Unit tests (stub model) exit 0, covering:
  - (a) `verify_reserve` holds back calls: reflection stops at `max_model_calls − verify_reserve` and a minted candidate is validated in the same round;
  - (b) `verify_reserve > max_model_calls` is a config error;
  - (c) default config ⇒ reflection argv carries `Read,Grep,Glob`, the pin dir and `--max-turns <reflection_max_turns>`;
  - (d) `reflection_tools: ""` ⇒ argv identical to today (`--tools ""`), kept as fallback/baseline;
  - (e) a wall breach after k calls ⇒ k results persisted with `partial:true`, last-run not advanced, all k calls present in the 24h reservation ledger.
- [ ] Negative control: set `verify_reserve` to 0 in a scratch copy with a stub that mints a candidate on the last allowed call ⇒ (a) goes red. Paste the output.
- [ ] Measurement:
  - one real round (resident-driver after landing, or a manual `--force` round that does NOT advance last-run and counts against the same 24h ledger) with the applied per-round values;
  - paste units selected, calls made (reflection versus verification), realized turns per call, wall ms and gateway cost;
  - state whether the 1800000 ms wall is sufficient given the measured per-call time.
- [ ] Config: paste the `.quay/config.yml` `discovery_method` diff, and the driver assembly line after the reload showing the per-round values and `verify_reserve`.
  - The reload must actually fire: a delta touching only routine modules does not trigger the anchor self-refresh, so touch `quality-gate-driver.ts` or reload with `quay driver restart --kind quality`; never `pkill -f`.
- [ ] Report-only, kill switch (`enabled:false` ⇒ zero spawns), manual-never-advances-last-run and other routines' cadence: existing tests still green; paste them.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-discovery-method-per-round-quota-verify-reserve-deep-reflection` green.
- 240 is documented in code/config comments as THIS routine's launcher-subprocess ceiling, not a Quay-wide session or API budget.

## Touches
- tasks/gap-discovery-method-per-round-quota-verify-reserve-deep-reflection.md
- plugin/scripts/discovery-method-routine.ts
- plugin/scripts/quality-gate-driver.ts
- plugin/test/discovery-method-routine.test.mjs
- docs/analysis/discovery-reflection.mjs
- plugin/test/discovery-reflection.test.mjs
- .quay/config.yml
