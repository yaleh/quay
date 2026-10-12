---
id: gap-discovery-method-per-round-quota-verify-reserve-deep-reflection
title: "discovery-method per-round quota after 24h=240: verification reserve,
  bounded code-reading reflection, partial persistence on wall breach"
status: ready
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
- [x] Unit tests (stub model) exit 0, covering:
  - (a) `verify_reserve` holds back calls: reflection stops at `max_model_calls − verify_reserve` and a minted candidate is validated in the same round;
  - (b) `verify_reserve > max_model_calls` is a config error;
  - (c) default config ⇒ reflection argv carries `Read,Grep,Glob`, the pin dir and `--max-turns <reflection_max_turns>`;
  - (d) `reflection_tools: ""` ⇒ argv identical to today (`--tools ""`), kept as fallback/baseline;
  - (e) a wall breach after k calls ⇒ k results persisted with `partial:true`, last-run not advanced, all k calls present in the 24h reservation ledger.
- [x] Negative control: set `verify_reserve` to 0 in a scratch copy with a stub that mints a candidate on the last allowed call ⇒ (a) goes red. Paste the output.
- [x] Measurement:
  - one real round (resident-driver after landing, or a manual `--force` round that does NOT advance last-run and counts against the same 24h ledger) with the applied per-round values;
  - paste units selected, calls made (reflection versus verification), realized turns per call, wall ms and gateway cost;
  - state whether the 1800000 ms wall is sufficient given the measured per-call time.
- [x] Config: paste the `.quay/config.yml` `discovery_method` diff, and the driver assembly line after the reload showing the per-round values and `verify_reserve`.
  - The reload must actually fire: a delta touching only routine modules does not trigger the anchor self-refresh, so touch `quality-gate-driver.ts` or reload with `quay driver restart --kind quality`; never `pkill -f`.
- [x] Report-only, kill switch (`enabled:false` ⇒ zero spawns), manual-never-advances-last-run and other routines' cadence: existing tests still green; paste them.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-discovery-method-per-round-quota-verify-reserve-deep-reflection` green.
- 240 is documented in code/config comments as THIS routine's launcher-subprocess ceiling, not a Quay-wide session or API budget.

## Evidence

### AC1 — unit tests (stub model), exit 0
```
$ node --test --experimental-strip-types plugin/test/discovery-method-routine.test.mjs
ℹ tests 56   ℹ pass 56   ℹ fail 0
$ node --test --experimental-strip-types plugin/test/discovery-reflection.test.mjs
ℹ tests 52   ℹ pass 52   ℹ fail 0
```
New cases, routine test: `AC(a) verify_reserve holds reflection at max_model_calls − verify_reserve (real engine, 24h ledger)` · `AC(a) a candidate minted on reflection's LAST allowed call is validated in the SAME round` · `AC(b) verify_reserve > max_model_calls is a config error, and the round spawns nothing` · `AC(c) default config ⇒ reflection argv carries Read,Grep,Glob, the pin dir AND --max-turns <reflection_max_turns>` · `AC(d) reflection_tools:"" ⇒ argv byte-identical to the pre-change launcher (--tools ""), no pin, one turn` · `AC(e) a wall breach after k calls persists k results with partial:true …` · `AC(e) boundary — a wall breach with ZERO completed calls appends nothing, exactly as before` · `a round that gets its seams from modelFactory NAMES the reflection pin in the prompt and records it on the carrier`.
New cases, reflection test: `reflectionLaunchArgv — --add-dir <pin> exactly when a pin is given; otherwise byte-identical to hardenedArgv` · `buildReflectionPrompt — code access NAMES the pinned tree, stays a semantic question, and is byte-identical when absent`.
The two pre-change cases whose CONTRACT this task changes were updated, not deleted: `AC1(e) — a wall-breach round PERSISTS a partial line … AND its calls are counted exactly once` and `COUNTING SEMANTICS — …` (the default arm now carries tools; the empty-tools arm is asserted alongside it).

### AC2 — negative control output
`/tmp/dm-negctl/negctl.mjs` (one variable: `verify_reserve` 2 → 0; same round, same stub, which spends the whole reflection budget it is handed and mints on its last allowed call):
```
verify_reserve=2  → reflection handed 4 calls; candidates minted 1 ; VERIFICATIONS IN THIS ROUND: 1
verify_reserve=0  → reflection handed 6 calls; candidates minted 1 ; VERIFICATIONS IN THIS ROUND: 0
AC(a) is REFUTABLE: with verify_reserve=0 the minted candidate is NEVER validated in the round that minted it (control RED as required).
```
And the same mutation applied to the suite test itself (`reserveYaml(240, 2)` → `0` in that one case, run from a scratch copy of the test with the relative specifiers rewritten absolute):
```
✖ AC(a) — a candidate minted on reflection's LAST allowed call is validated in the SAME round
  AssertionError [ERR_ASSERTION]: the candidate minted by THIS round was validated IN THIS round
  0 !== 1
ℹ tests 1   ℹ pass 0   ℹ fail 1
```

### AC3 — measurement (one real round, per-round values applied)
Round 1 — **production root, manual `--force`** (counts against the production 24h ledger; last-run NOT advanced — verified: `.quay/routine-last-run.json` still holds `discovery-method: 1791822142523` + `discovery-method@invoked_by: resident-driver`, i.e. the 16:22:22Z RESIDENT round, while the carrier's newest line is `invoked_by: manual`):
```
command: node --experimental-strip-types <worktree>/plugin/scripts/discovery-method-routine.ts \
           --once --root /data/home/yale/work/quay --force --json --pin-tmp /tmp/dm-measure-pins
state=verified  wall_ms=63357  model_calls=12  cost_usd=1.711225
tokens={input:302125, output:8024, cache_read:0, cache_creation:0}
ingested={experiences:12, scanned:14, duplicates:2, advanced_to:300}
reflected={decisions:16, skipped_budget:4, model_calls:12,
           selection:{units_evaluated:138, batch_size:16, skipped_prior:16, skipped_cap:106, merged_within_batch:10}}
reservations={cap:240, used_at_start:12, remaining_at_start:228, requested_max_model_calls:16,
              effective_max_model_calls:16, reflection_max_model_calls:12, verify_reserve:4,
              granted:12, refused:0}
candidates={minted:0}  verdicts={total:0}      → 12 reflection calls, 0 verification calls
realized turns per call (ledger outcomes, all 12): 1,1,1,1,1,1,1,1,1,1,1,1
```
⛔ **THIS ROUND EXPOSED A DEFECT AND ITS NUMBERS ARE THE PRE-FIX ONES.** `reflection_launcher` came back `null` and the prompt named no tree: the `--once` CLI built its two launchers ITSELF instead of going through `modelFactory`, so the round never saw the pin the launcher's argv had been given (`--add-dir /tmp/dm-measure-pins/dm-reflect-pin-515e6baa-yYksU1` WAS created). Every call answered in ONE turn — tools the model is not told about are decorative, and its cwd is the live checkout. Fixed in the second commit (`main()` now passes `modelFactory`, lazily, as the driver does) and pinned by a test.

Round 2 — **isolated live root** (a shallow clone of this repo at `ef904edc`, the production evidence store copied in, the production `discovery_method` values; run by the worktree's code with `--root <clone>`, so the pin is real code and the carriers are the clone's own):
```
state=verified  wall_ms=257572  model_calls=11  cost_usd=3.402399
tokens={input:404201, output:41378, cache_read:693888, cache_creation:0}
model_id=v4.1flash-anthropic
reflection_launcher={"tools":"Read,Grep,Glob","max_turns":10,
                     "pin":{"rev":"ef904edca038f0345a2376a347cb8fb913268179",
                            "dir":"../../../../tmp/dm-measure-pins/dm-reflect-pin-ef904edc-ZECqz1"}}
ingested={experiences:11, scanned:16, duplicates:0, advanced_to:109}
reflected={decisions:11, skipped_budget:0, model_calls:11,
           selection:{units_evaluated:11, batch_size:11, skipped_prior:0, skipped_cap:0, merged_within_batch:0}}
candidates={minted:6, persisted:6}
verdicts={total:0}                              → 11 reflection calls, 0 verification calls

per call (reserve → outcome, seconds; turns from the launcher's stream):
#  1  22.5s turns=5      #  5  28.3s turns=6      #  9  36.9s turns=9
#  2  19.9s turns=5      #  6  34.8s turns=8      # 10  13.2s turns=2
#  3  10.6s turns=1      #  7  20.5s turns=5      # 11  19.2s turns=3
#  4  24.2s turns=8      #  8  26.0s turns=3
calls=11  sum=256.2s  mean=23.3s  max=36.9s   (projected for max_model_calls=16 at this mean: 373s)
```
The fix is confirmed on the live path by three independent readings: the carrier records the launcher + pin; realized turns per call went from a flat `1` (round 1, pre-fix) to 1–9 (mean 5.0); and the round MINTED 6 candidates where every text-only production round minted 0 — the code-reading arm is not just the same pipeline with a bigger quota.

**Is the 1800000 ms wall sufficient?** Sufficient, but NOT APPLICABLE — and it is the one recommended value this task changes. `1800000` EQUALS the caller-side routine watchdog `ROUTINE_WATCHDOG_MS_DEFAULT` (`quality-gate-driver.ts:158`, 30 min). A wall budget that is not strictly BELOW the watchdog is never the thing that fires: the round would be abandoned by the watchdog, so the `partial` persistence and the not-advancing last-run this task adds would never execute. Applied instead: **`max_wall_ms: 1200000` (20 min, 2/3 of the watchdog)**. Against the measured per-call time that is ~3.2× headroom over the projected 16-call round (373s) and ~2.0× over the pessimistic 16 × 36.9s = 590s. Measured caveat: `max_wall_ms` is checked BETWEEN steps, never inside a call, so a single call can still overshoot by up to the 300s per-call launcher timeout — 20 min of wall slack absorbs that; a wall equal to the watchdog would not.
`verify_reserve` was NOT exercised in either live round — round 2 minted 6 candidates but the clone has no held-out pool, so `verdicts.total = 0` and no verification call was made. It is covered by the unit cases and the negative control above, and it binds in production exactly when a candidate is minted AND a held-out case exists.

### AC4 — config diff + assembly line
Production `/data/home/yale/work/quay/.quay/config.yml` (`discovery_method`; the file is gitignored, so fan-in cannot carry it — applied directly, and INERT until the driver reload because the routine spec closes over the parsed config at driver startup):
```diff
--- .quay/config.yml (before)
+++ .quay/config.yml (after)
     max_experiences: 8        →      max_experiences: 16
     max_model_calls: 6        →      max_model_calls: 16
                                      verify_reserve: 4
                                      reflection_tools: Read,Grep,Glob
                                      reflection_max_turns: 10
     max_wall_ms: 900000       →      max_wall_ms: 1200000
```
Live read-back of the section (values verbatim):
```
  discovery_method:
    enabled: true
    interval: interval:60m
    interval_until: 2026-10-19T14:00:00Z
    max_model_calls_per_24h: 240
    max_experiences: 16
    max_model_calls: 16
    verify_reserve: 4
    reflection_tools: Read,Grep,Glob
    reflection_max_turns: 10
    max_wall_ms: 1200000
```
The driver's assembly line, rendered by the driver's OWN `discoveryMethodRoutineFromConfig` + `formatDiscoveryMethodAssembly` against the production root (the same string `main()` prints at startup):
```
quality-gate-driver: discovery-method 例程已装配（enabled, interval=60m, interval_until=2026-10-19T14:00:00.000Z, max_model_calls_per_24h=240 (HARD: pre-spawn reservation per call, trailing-24h; a reservation with no outcome still counts as spent), max_experiences=16, max_model_calls=16 (per round), verify_reserve=4 (held back from reflection ⇒ reflection <= 12), max_wall_ms=1200000, reflection_tools="Read,Grep,Glob" (SEMANTIC FIRST: reflection reads a stripped pin at HEAD), reflection_max_turns=10, verifier_max_turns=12, worst_case_api_turns_per_24h=2880 (cap × max(effective reflection turns, verifier turns))）
```
**The reload fires on landing, by construction**: the self-refresh watches `DRIVER_KINDS[kind].driver` + the shared kernel files (`driver-runtime.ts:2534` `watchedSourceFiles`), and this delta touches `plugin/scripts/quality-gate-driver.ts` — exactly the trigger the AC names. `quay driver restart --kind quality` was NOT run by this worker (the reload happens on its own when the delta lands; restarting a resident production driver is the manager's standing action, and restarting before the code is in the main checkout would have reloaded the OLD code and printed a line without `verify_reserve`). No `pkill -f` was used.

### AC5 — report-only / kill switch / manual / other cadences
```
$ bash scripts/test.sh --for-task gap-discovery-method-per-round-quota-verify-reserve-deep-reflection --allow-thin
EXIT=0      ℹ tests 141   ℹ pass 141   ℹ fail 0
```
Contains the cases that assert these properties: case (2) `enabled:false ⇒ not-evaluated:disabled and ZERO spawns`, case (3) `halted ⇒ … and ZERO spawns`, case (8) `after a full round nothing under tasks/ or goals/ changed, and the source is filing-free`, case (a) `a MANUAL round leaves routine-last-run.json BYTE-IDENTICAL (and really ran)`, case (g) `arch-discovery's own interval and floor are UNTOUCHED by this routine's temporary cadence`, plus AC1(g) `enabled:false, halted and --no-model ⇒ ZERO reservations`.
Independently confirmed on the live production round: the manual round's line landed with `invoked_by: manual` and `.quay/routine-last-run.json` still holds the resident round's `1791822142523` / `resident-driver` stamp.

### Deviations, and what a reviewer should look at
1. `max_wall_ms` **1200000**, not the recommended 1800000 — reasoned above (it equals the watchdog). This is the one recommended value changed.
2. The measurement round found a real defect (the CLI's duplicate seam builder) and it was fixed IN this task; the first round's numbers are therefore the pre-fix floor and the second round is the post-fix one. The first round's data is kept above rather than replaced, because deleting it would hide how the defect was found.
3. `plugin/scripts/capability-catalog-declarations.json` was touched: its `discovery-method-routine.ts` declaration said a budget breach "appends nothing", which partial persistence makes false.
4. The pin the reflection reads is materialised per round and, like the verifier's per-case pins, is NOT removed by the round — it follows the existing discipline (`PIN_TMP_ENV` / `--pin-tmp` point it at a managed root); it is 37MB for this repo and takes 0.8s to build.
5. `latestResidentRoundTs` now SKIPS `partial:true` lines. Without that the un-advanced last-run would be undone on the due-side and the promised retry would silently not happen.

## Touches
- tasks/gap-discovery-method-per-round-quota-verify-reserve-deep-reflection.md
- plugin/scripts/discovery-method-routine.ts
- plugin/scripts/quality-gate-driver.ts
- plugin/test/discovery-method-routine.test.mjs
- docs/analysis/discovery-reflection.mjs
- plugin/test/discovery-reflection.test.mjs
- plugin/scripts/capability-catalog-declarations.json
- .quay/config.yml

## Blocker

**2026-10-12T18:21:17.342Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: __PERFILE__ duration_ms=32924 plugin/test/prod-data-audit.test.mjs passed=false end_ms=1791829065438 cpu_ms=34036.67 mem_peak_kb=1873720
- run_id：wk-prod-anchor
- session_id：93355eb5-4eb6-4a83-90dd-85a89407a2b7

## Needs-Human

**执行 2026-10-12T18:21:18.302Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：exited-not-landed 失败无法归因（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser attributed 1 failing file(s) in this round: plugin/test/prod-data-audit.test.mjs); stopping instead of spending another worker session
- 失败步/判词：step=suite: __PERFILE__ duration_ms=32924 plugin/test/prod-data-audit.test.mjs passed=false end_ms=1791829065438 cpu_ms=34036.67 mem_peak_kb=1873720
- run_id：wk-prod-anchor
- session_id：93355eb5-4eb6-4a83-90dd-85a89407a2b7
- suite 日志：/data/home/yale/work/quay/.quay/fan-in-suite-gap-discovery-method-per-round-quota-verify-reserve-deep-reflection~wk-prod-anchor~1791828953643-00613d.log
- fan-in 日志：/data/home/yale/work/quay/.quay/fan-in-gap-discovery-method-per-round-quota-verify-reserve-deep-reflection-wk-prod-anchor.log


**2026-10-12T18:40Z: needs-human cause resolved; restored to ready for a fresh fan-in (NOT done).** The suite red was develop-wide and outside this task's delta: plugin/test/prod-data-audit.test.mjs threw ERR_STRING_TOO_LONG because .quay/meta-driver-round.jsonl (538,347,520 B) exceeded V8's string limit. The develop baseline had the same 2 failures, and the 'unattributable' verdict came from the baseline comparator only parsing TAP (fix tracked in gap-fan-in-baseline-comparison-blind-to-spec-reporter-misparks-develop-wide-red). With user authorization, the carrier was rotated at 18:35:39Z with full history preserved (archive + verified backup in /data/home/yale/work/quay-carrier-archive/meta-driver-round/, identity sha256 verified). Afterwards prod-data-audit.test.mjs reads 10/10 pass. All AC were already ticked. The task still has to pass its own fan-in (suite included) before it can be done.