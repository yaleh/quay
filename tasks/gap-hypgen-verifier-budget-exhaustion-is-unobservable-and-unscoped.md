---
id: gap-hypgen-verifier-budget-exhaustion-is-unobservable-and-unscoped
title: "arch-hypothesis-generation verifier: turn-budget exhaustion is
  unobservable (no per-turn record), searches are unscoped, and there is no
  mechanical evidence pack or budget-aware ordering"
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-hypgen-inventory-lacks-import-provenance-so-reuse-reads-as-duplication
---
## Proposal
Measured from the acceptance verify file `/data/home/yale/work/quay-scratch/hg-accept-run/verify.json` (pin `e3163e519`, 8 turns, 300 s):
- **Budget exhaustion is common.** 7 of 15 clusters were `undetermined` because they reached the 8-turn limit; each output was exactly 28 bytes, `Error: Reached max turns (8)`. In round 1 it was 5 of 15.
- **Exhausted runs were faster, not slower.** They took 16-37 s, while decided runs took 20-70 s. Component counts were similar (mostly 5). So the turns went on many cheap tool calls, not on slow ones.
- **A real defect was among the exhausted clusters.** c13 claimed the routine quota window/K is declared both in config and in the gate. At the pin, `routine_quota.window_ms` really was parsed but inert; this was later fixed by the done task `gap-routine-quota-window-ms-parsed-but-inert`. The budget limit therefore hid a true positive, and it serves as an independent regression case.
- **The cause cannot be observed.** Verifier runs use `--no-session-persistence` and record only the final stdout. The only surviving traces are 4 tool-result overflow files under `~/.claude/projects/-data-home-yale-work-quay-scratch-hg-pin/`, each 24-40 KB.
  - Their content shows repo-wide searches that hit `.quay/goal-031-evidence/arch-layer-review-output.json` and `scripts/test.sh` comments, although the verifier prompt limits it to `plugin/scripts/` and `packages/`.
  - The stripped pin tree still contained tracked `.quay/` evidence files.
- This is a HYPOTHESIS, not yet a conclusion: unscoped searches produce oversized results that consume turns.

## Plan
1. **Instrumentation.** Capture each verifier call's per-turn tool calls (tool name, arguments, result byte size), for example by running with stream-json output. Store them next to the result. A call that ends with no record is reported as `not-evaluated:uninstrumented`.
2. **Scope enforcement.** The verify step refuses if `--pin-dir` contains `.quay/`, `tasks/`, `goals/`, `docs/`, `orchestration/`, `archive/`, `milestones/` or `measurements/`. This complements the strippedness check owned by the dependency task; do not duplicate it.
3. **Mechanical evidence pack**, an opt-in verifier strategy. Before the model call, deterministically assemble for each named component:
   - the definition line of each symbol cited in the claim;
   - the import lines among the named components;
   - bounded grep hits, at most N lines.

   Pass these in the prompt, through a NEW verifier prompt file. The frozen verifier prompt (`dba2e671…`) stays the default and unchanged.
4. **Budget-aware ordering**, opt-in. Run first the clusters whose evidence pack already decides them mechanically. Give each remaining cluster a fixed turn budget. Record the turns used.
5. **No hard-coding of any regression case.** Neither c13 nor any other label is named in code or prompts.

## Acceptance Criteria
- [x] `node --test plugin/test/arch-hypothesis-generation.test.mjs` exits 0, with new cases:
  - (a) A pin dir containing `.quay/` is refused.
  - (b) A stubbed verifier that exhausts its turns leaves a per-turn record, and the cluster is `undetermined` with cause `turn-budget`.
  - (c) The evidence pack for a fixture names the definition lines and the import lines, and respects the line cap.
  - (d) The default verifier prompt file is byte-identical: its sha256 equals the frozen value.

  ```
  $ node --test plugin/test/arch-hypothesis-generation.test.mjs
  ✔ AC(a): a pin dir containing .quay/ (or any scope dir) is refused, and no model call happens
  ✔ AC(b): an exhausted verifier leaves a per-turn record, cause turn-budget, and is never refuted
  ✔ AC(c): the evidence pack names definition lines and import lines, and respects the line cap
  ✔ AC(d): the default verifier prompt is byte-identical to the frozen value and carries no pack slot
  ✔ Plan 5: neither the module nor the verifier prompts name a regression case label
  ℹ tests 29 / pass 29 / fail 0
  ```

- [x] One instrumented diagnostic run on the real acceptance cluster c13 (from `/data/home/yale/work/quay-scratch/hg-accept-run/`), using a properly stripped pin at `e3163e519`, the default verifier, and 8 turns.

  Pin: `git -C /data/home/yale/work/quay archive e3163e519 | tar -x -C <dir>`, then `tasks goals docs orchestration archive milestones measurements .quay` removed — all eight absent. Runs/prereg/inventory are the real acceptance artifacts (`runs/run-{1,2,3}.json`, `prereg.json`, `inventory-A.txt`); the cluster is addressed by POSITION (`--only-cluster 13`), no case label appears in the command or the code. Strategy `default` (frozen `verifier.txt`), 8 turns, 300 s, cwd = the stripped pin (so the scope check runs on a pin that carries no `.quay/`).

  ```
  cluster 13  kind policy  comps [driver-config.ts, routine-file-gate.ts, routine-scheduler.ts, probe-routine.ts]
  verdict undetermined  reason TURN_LIMIT  cause turn-budget
  instrumentation stream-json  turns_used 14  cli_num_turns 9  wall_ms 17459  out_bytes 355786  exit 1
   1 Grep bytes= 1180 {"pattern":"DEFAULT_ROUTINE_QUOTA|loadRoutineQuotaConfig|routineQuotaDecision|DEFAULT_RATE|selectProbeRoutines|dueRoutines|isDue","output_mode":"files_with_matc…
   2 Grep bytes=  345 {"pattern":"routineQuotaDecision|DEFAULT_RATE|loadRoutineQuotaConfig|DEFAULT_ROUTINE_QUOTA","output_mode":"files_with_matches"}
   3 Grep bytes= 2148 {"pattern":"DEFAULT_ROUTINE_QUOTA|loadRoutineQuotaConfig|RoutineQuota|quota","output_mode":"content","path":"<PIN>/plugin/scr…
   4 Grep bytes= 1501 {"pattern":"DEFAULT_RATE|routineQuotaDecision|loadRoutineQuotaConfig|DEFAULT_ROUTINE_QUOTA","output_mode":"content","path":"<PIN>/plugin/scr…
   5 Read bytes= 6232 {"file_path":"<PIN>/plugin/scripts/routine-file-gate.ts","offset":240,"limit":70}
   6 Grep bytes= 2216 {"pattern":"loadRoutineQuotaConfig|routerQuota|routineQuotaDecision|DEFAULT_RATE|FILING_WINDOW_MS|quota","output_mode":"content","path":"<PIN>/plugin/scr…
   7 Grep bytes= 1939 {"pattern":"isDue|dueRoutines|DEFAULT_RATE|quota|Quota|window|WINDOW|interval|Interval|cadence|Cadence","output_mode":"content","path":"<PIN>/plugin/scr…
   8 Grep bytes= 2261 {"pattern":"selectProbeRoutines|DEFAULT_RATE|quota|Quota|window|WINDOW|gateFinding|routineQuotaDecision|loadRoutineQuotaConfig|isDue|dueRoutines","output_mode":"…
   9 Read bytes= 8257 {"file_path":"<PIN>/plugin/scripts/probe-routine.ts","offset":40,"limit":130}
  10 Read bytes= 1449 {"file_path":"<PIN>/plugin/scripts/probe-routine.ts","offset":169,"limit":30}
  11 Read bytes= 2532 {"file_path":"<PIN>/plugin/scripts/routine-file-gate.ts","offset":1,"limit":30}
  12 Read bytes= 2879 {"file_path":"<PIN>/plugin/scripts/probe-routine.ts","offset":440,"limit":30}
  13 Read bytes= 2060 {"file_path":"<PIN>/plugin/scripts/probe-routine.ts","offset":970,"limit":30}
  14 Read bytes= 8489 {"file_path":"<PIN>/plugin/scripts/driver-config.ts","offset":114,"limit":130}
  (<PIN> = /data/home/yale/work/quay-scratch/hg-vbudget/pin-e3163e519; args_head is the recorded 160-char head, shown here truncated with …)
  ```

  Reading: 14 cheap tool calls in 17 s, every one SCOPED to the pin (`plugin/scripts/*` only — no `.quay/**`, no `scripts/test.sh`), result payloads 345–8489 bytes, and the run STILL exhausted 8 turns. Final verdict: `undetermined` / `TURN_LIMIT` (cause `turn-budget`).

  This AC only records what happened. It does not need a particular verdict.

- [x] The same c13 run with the evidence-pack strategy.

  Same pin / runs / prereg / `--only-cluster 13`, `--strategy evidence-pack` (prompt = the NEW `verifier-evidence-pack.txt`), 8 turns, 300 s. The deterministic pack assembled for this cluster before the call (`--evidence-max-lines 40`):

  ```
  ## Mechanical evidence pack (assembled deterministically BEFORE the model call)
  components: plugin/scripts/driver-config.ts, plugin/scripts/routine-file-gate.ts, plugin/scripts/routine-scheduler.ts, plugin/scripts/probe-routine.ts
  cited symbols: DEFAULT_ROUTINE_QUOTA_WINDOW_MS, DEFAULT_ROUTINE_QUOTA_K, DEFAULT_ROUTINE_QUOTA_GLOBAL_CEILING, loadRoutineQuotaConfig, DEFAULT_RATE, routineQuotaDecision, isDue, dueRoutines
  sections: definitions=8 imports=5 hits=0
  - DEF plugin/scripts/driver-config.ts:128  DEFAULT_ROUTINE_QUOTA_WINDOW_MS | export const DEFAULT_ROUTINE_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
  - IMP plugin/scripts/probe-routine.ts:42 -> plugin/scripts/routine-scheduler.ts | import { parseTrigger } from "./routine-scheduler.ts";
  - DEF plugin/scripts/driver-config.ts:131  DEFAULT_ROUTINE_QUOTA_K | export const DEFAULT_ROUTINE_QUOTA_K = 3;
  - IMP plugin/scripts/probe-routine.ts:50 -> plugin/scripts/routine-file-gate.ts | import {
  - DEF plugin/scripts/driver-config.ts:135  DEFAULT_ROUTINE_QUOTA_GLOBAL_CEILING | export const DEFAULT_ROUTINE_QUOTA_GLOBAL_CEILING = 12;
  - IMP plugin/scripts/probe-routine.ts:74 -> plugin/scripts/routine-file-gate.ts | import type { BoardKeys, DedupReading, ExecutionProbeDecl, RemedyAvailability } from "./routine-file-gate.ts";
  - DEF plugin/scripts/driver-config.ts:173  loadRoutineQuotaConfig | export function loadRoutineQuotaConfig(root: string): RoutineQuotaConfig {
  - IMP plugin/scripts/probe-routine.ts:78 -> plugin/scripts/driver-config.ts | import { routineK, routineGlobalCeiling } from "./driver-config.ts";
  - DEF plugin/scripts/routine-file-gate.ts:22  DEFAULT_RATE | export const DEFAULT_RATE = DEFAULT_ROUTINE_QUOTA_K; // ≤ K routine-filed tasks per window (tunable)
  - IMP plugin/scripts/routine-file-gate.ts:17 -> plugin/scripts/driver-config.ts | import { DEFAULT_ROUTINE_QUOTA_K, DEFAULT_ROUTINE_QUOTA_WINDOW_MS } from "./driver-config.ts";
  - DEF plugin/scripts/routine-file-gate.ts:260  routineQuotaDecision | export function routineQuotaDecision(
  - DEF plugin/scripts/routine-scheduler.ts:61  isDue | export function isDue(trigger: any, state: { iteration?: number; event?: string; now?: number; lastRun?: number } = {}) {
  - DEF plugin/scripts/routine-scheduler.ts:81  dueRoutines | export function dueRoutines(routines: any[], state: { iteration?: number; event?: string; now?: number; lastRun?: Record<string, number> } = {}) {
  counts: {definitions:8, imports:5, hits:0, rendered:13, total:13} capped: false
  ```

  ```
  verdict refuted  verdict_reason null  verdict_cause null
  instrumentation stream-json  turns_used 8  cli_num_turns 9  wall_ms 27875  exit 0
   1 Read bytes= 6883 {"file_path":"<PIN>/plugin/scripts/driver-config.ts","offset":110,"limit":100}
   2 Read bytes= 5266 {"file_path":"<PIN>/plugin/scripts/routine-file-gate.ts","offset":1,"limit":60}
   3 Read bytes=10760 {"file_path":"<PIN>/plugin/scripts/routine-file-gate.ts","offset":240,"limit":120}
   4 Read bytes= 5071 {"file_path":"<PIN>/plugin/scripts/routine-scheduler.ts","offset":50,"limit":70}
   5 Grep bytes= 7508 {"pattern":"FILING_WINDOW_MS|routineK|routineGlobalCeiling|loadRoutineQuotaConfig|routineQuotaDecision|DEFAULT_RATE","path":"<PIN>/plugin/scripts","output_mode":"conte…
   6 Read bytes= 1717 {"file_path":"<PIN>/plugin/scripts/driver-config.ts","offset":209,"limit":70}
   7 Grep bytes=  246 {"pattern":"selectProbeRoutines|function selectFilings|export function selectFilings","path":"<PIN>/plugin/scripts","output_mode":"cont…
   8 Read bytes= 1985 {"file_path":"<PIN>/plugin/scripts/probe-routine.ts","offset":164,"limit":40}
  ```

  **Turns used: 8** (vs 14 for the default strategy on the same cluster) — it did NOT exhaust the budget. **Verdict: `refuted`.** Recorded as it happened; the strategy was not tuned to make the cluster pass. Note the outcome honestly: this cluster is the one the Proposal calls a true positive at the pin, and the evidence-pack run returned `refuted`, i.e. it did not recover that positive — but it DID reach a decision inside the budget where the default strategy reached none.

- [x] Mutation control: remove `.quay/` from the refusal list and show case (a) goes red.

  ```
  $ # SCOPE_FORBIDDEN_DIRS: [".quay", "archive", "milestones", "measurements"] -> ["archive", "milestones", "measurements"]
  $ node --test --test-name-pattern="AC\(a\): a pin dir containing" plugin/test/arch-hypothesis-generation.test.mjs
  ✖ AC(a): a pin dir containing .quay/ (or any scope dir) is refused, and no model call happens
    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
    + actual - expected
    + null
    - 'PIN_NOT_STRIPPED:.quay'
  ℹ pass 0
  ℹ fail 1
  ```

  Reverted (module restored from a copy, `git diff` clean); AC(a) green again: `ℹ pass 1 / ℹ fail 0`. The mutation proves the check is the thing making `.quay/` refused — the test is not passing for some other reason (硬规则 4 推论四).

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-hypgen-verifier-budget-exhaustion-is-unobservable-and-unscoped` green.
- Frozen prompt files are unchanged.

## Touches
- tasks/gap-hypgen-verifier-budget-exhaustion-is-unobservable-and-unscoped.md
- docs/analysis/arch-hypothesis-generation.mjs
- docs/analysis/arch-hypothesis-generation-prompts/verifier-evidence-pack.txt (new)
- plugin/test/arch-hypothesis-generation.test.mjs
