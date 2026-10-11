---
id: gap-arch-discovery-not-wired-into-routine-track-report-only
title: Wire the arch-discovery scans into the quality-gate routine track as a
  report-only, bounded, killable mechanical routine
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-arch-discovery-instruments-have-no-bounded-scan-mode
---
## Proposal
The two arch-discovery instruments are verified on real data, but nothing runs them periodically.

I mapped the existing discovery paths on 2026-10-11. Findings, with file:line:
- **Probe routines (`probe-routine.ts`) are not usable as-is.**
  - `llmProbeRoutine` always spawns a `claude -p` session (`:839-847`).
  - Its finding records keep only `findingId, dupKind, subject, symbols, files, verdict, rationale, suggestedAction` (`:940-954`). That drops `subject_key`, provenance, counterexamples and outcome.
  - It has no production report-only switch. `filingEnabled` is documented as a test seam, always true in production (`:780-782`).
- **The quality-gate driver already hosts code-defined mechanical routines.** Examples are `architecture-review` and `packaging-hygiene`, at `quality-gate-driver.ts:955-975`. The driver already provides:
  - interval scheduling: `routine-scheduler.ts` `isDue`, plus `.quay/routine-last-run.json`;
  - a caller-side watchdog: `ROUTINE_WATCHDOG_MS_DEFAULT` 30 min (`:145`), race at `:1029-1045`;
  - halt through `.quay/quality-control.json`: `isHalted` (`:1075`);
  - per-round facts in `.quay/quality-round.jsonl` (`:1088-1091`).
- **Meta-driver** already consumes a cached, unthresholded external sensor (`action-record-scan.json`, `meta-driver.ts:589`, `:617-621`). Consuming the time-scan reading there is a possible follow-up. It is out of scope here; this task wires one path only.

## Plan
1. **New code-defined routine `arch-discovery`** in the quality-gate driver's routine table. It reuses the existing scheduler, watchdog, halt and `quality-round.jsonl` facts. It adds no new runner and no new scheduler.
   - Each due round spawns the two instruments' `--scan` modes as child `node` processes. The spawn uses the driver's existing bounded-spawn helper with a timeout, plus `--max-old-space-size` and the instruments' `--max-ms`/`--max-records`.
2. **Configuration** lives in `.quay/config.yml` under `loop.arch_discovery`:
   - `enabled` (bool)
   - `interval` (`interval:<N>m`, parsed by the existing trigger grammar)
   - `since_days`
   - `max_ms`
   - `max_records`
   - `max_old_space_mb`

   If the section is absent or `enabled: false`, the routine records `not-evaluated` with reason `disabled` and spawns nothing. This is the kill switch. Driver halt is honoured too: it records `not-evaluated` "halted" and spawns nothing.
   - **Off by default:** any project that has not declared the section gets nothing.
   - **Fail-closed on bad config:** a malformed section, or an out-of-range value such as an interval under 60 minutes, records `failed` with the reason and spawns nothing.
3. **Report-only, structurally.** The routine imports no filing function (`selectFilings`, `fileRoutineTask`, `driveItems`, goal/task writers). Its only persistence is:
   - append-only lines to one gitignored carrier, `.quay/arch-discovery-findings.jsonl`;
   - the existing quality-round fact.

   Declare the carrier in `docs/carrier-registry.json`.
4. **Dedup across rounds.** For each `finding_fp` (from the instruments), append a finding line only when that `finding_fp` is new. Every round also appends one `scan-round` line containing:
   - per-kind counts;
   - new / repeated / gone `finding_fp` counts;
   - recurrence per `subject_key`;
   - wall ms and peak RSS.

   A `subject_key` whose verdict changes produces a new `finding_fp`, and the round line records it as a transition.
5. **Fail-closed.** Any of the following makes the round `failed`, with a distinct reason, appends nothing to the carrier except the quality-round fact, and does not advance the last-run:
   - instrument exit ≠ 0, including the bound codes;
   - timeout;
   - unparseable output;
   - validator refused > 0;
   - unreadable carrier.

   Unreadable carrier is never shaped like "0 findings" (hard rule 3b).
6. **Deployment.** Declare the section in this repo's `.quay/config.yml`: `enabled: true`, `interval: interval:360m`, `since_days: 7`, plus bounds chosen from Task 1's measured wall/RSS, at least 2× headroom, with the measurement cited. Restarting the quality-gate driver so it loads the code is a deployment step for whoever holds driver lifecycle; record it as such.

## Acceptance Criteria
- [x] `node --test plugin/test/arch-discovery-routine.test.mjs` exits 0, covering, each as its own named case:
  - (1) section absent ⇒ `not-evaluated:disabled` and zero spawns;
  - (2) `enabled:false` ⇒ same;
  - (3) halted ⇒ `not-evaluated:halted` and zero spawns;
  - (4) malformed config and interval < 60m ⇒ `failed` and zero spawns;
  - (5) instrument non-zero exit / timeout / unparseable output / validator-refused ⇒ `failed`, the carrier stays byte-identical, and last-run is not advanced;
  - (6) two rounds on identical inputs ⇒ the second appends 0 finding lines and 1 scan-round line with `repeated = N`, `new = 0`;
  - (7) a changed verdict ⇒ exactly 1 new finding line and a transition counted;
  - (8) not due inside the interval ⇒ zero spawns;
  - (9) after a full round, `git status --porcelain tasks/ goals/` is empty and no file under `tasks/`/`goals/` changed (no task or goal created).

  Evidence — exit 0, `ℹ tests 14 / ℹ pass 14 / ℹ fail 0`:
  ```
  $ node --test plugin/test/arch-discovery-routine.test.mjs
  ✔ case (1)/(2)/(4) — parseArchDiscoverySection: disabled section, malformed section, interval floor
  ✔ case (1) — section absent ⇒ not-evaluated:disabled and ZERO spawns
  ✔ case (2) — enabled:false ⇒ not-evaluated:disabled and ZERO spawns
  ✔ case (4) — malformed section / interval < 60m ⇒ failed and ZERO spawns
  ✔ case (3) — halted ⇒ not-evaluated:halted and ZERO spawns
  ✔ case (8) — not due inside the interval ⇒ ZERO spawns
  ✔ case (5) — instrument failure modes ⇒ failed, carrier byte-identical, last-run NOT advanced
  ✔ case (6) — two rounds on identical inputs ⇒ round 2 appends 0 finding lines + 1 scan-round (new=0, repeated=N)
  ✔ argv — each instrument is bounded, and the time scan pins BOTH window ends
  ✔ case (7) — a changed verdict ⇒ exactly 1 new finding line and 1 transition
  ✔ case (9) — after a full round nothing under tasks/ or goals/ changed, and the source is filing-free
  ✔ RoutineSpec — buildArchDiscoveryRoutine wires config + ctx.halted into the round
  ✔ readArchDiscoveryConfig — an absent section is present:false with no error (off by default)
  ✔ archDiscoveryRoutineFromConfig — absent ⇒ NO routine assembled (the host's routine set is unchanged)
  ℹ tests 14 / ℹ pass 14 / ℹ fail 0
  ```
  Case (5) covers all five failure modes as separate assertions in one case: non-zero exit (code 4, a bound code, with the instrument writing NOTHING — the instruments' own fail-closed shape), timeout (the injected spawn returns a timeout error), unparseable output (the instrument writes `not json at all`), validator-refused (a row with `validator_ok: false`), and unreadable carrier (garbage pre-seeded in the carrier ⇒ `failed` BEFORE any spawn). Each asserts the carrier is byte-identical and `last-run` is not advanced.
  Case (8) is asserted through the DURABLE `.quay/routine-last-run.json` gate (the driver's own in-memory `lastRun` resets on restart, so the persisted window is what actually prevents a re-fire).
  An extra case pins the argv contract: each instrument gets `--scan --root --out --max-ms --max-records`, and the TIME scan gets BOTH `--since` and `--until` (see AC4's note on the pinned window).
- [x] Static control: `grep -nE 'selectFilings|fileRoutineTask|driveItems|task_write|goal_write|writeTask|writeGoal'` on the new routine file prints nothing. Mutation control: add one such import and show that the case (9) static assertion goes red, then revert. Paste the output.

  Evidence — static control (no output; `grep` exit 1 = no match):
  ```
  $ grep -nE 'selectFilings|fileRoutineTask|driveItems|task_write|goal_write|writeTask|writeGoal' plugin/scripts/arch-discovery-routine.ts
  grep exit=1 (1 = no match = PASS)
  ```

  Evidence — mutation control (added `import { selectFilings } from "./probe-routine.ts";`, a REAL export so the module still loads and the case runs):
  ```
  $ grep -nE '…' plugin/scripts/arch-discovery-routine.ts
  45:import { selectFilings } from "./probe-routine.ts";

  $ node --test --test-name-pattern='case \(9\)' plugin/test/arch-discovery-routine.test.mjs
  ✖ case (9) — after a full round nothing under tasks/ or goals/ changed, and the source is filing-free
    AssertionError [ERR_ASSERTION]: arch-discovery-routine.ts must import/call no filing or authoring symbol
  ℹ pass 0 / ℹ fail 1
  ```
  After revert:
  ```
  $ grep -nE '…' plugin/scripts/arch-discovery-routine.ts   # no output, exit 1
  $ node --test --test-name-pattern='case \(9\)' plugin/test/arch-discovery-routine.test.mjs
  ✔ case (9) — after a full round nothing under tasks/ or goals/ changed, and the source is filing-free
  ℹ pass 1 / ℹ fail 0
  ```
  ⚠️ Note for maintainers: the routine's own comments must not NAME those symbols either — the control reads POSITION over the whole source, so a comment mention is a false positive.
- [x] `node --test plugin/test/quality-gate-driver.test.mjs plugin/test/quality-gate-driver-loop-watchdog.test.mjs plugin/test/probe-routine.test.mjs plugin/test/routine-file-gate.test.mjs plugin/test/carrier-registry-completeness.test.mjs` exits 0. No existing routine behaviour changes.

  Evidence — exit 0:
  ```
  $ node --test plugin/test/quality-gate-driver.test.mjs plugin/test/quality-gate-driver-loop-watchdog.test.mjs plugin/test/probe-routine.test.mjs plugin/test/routine-file-gate.test.mjs plugin/test/carrier-registry-completeness.test.mjs
  ℹ tests 86 / ℹ pass 86 / ℹ fail 0
  ```
  "No existing routine behaviour changes" is enforced structurally, not just observed: the routine is assembled ONLY when `loop.arch_discovery:` is DECLARED (`archDiscoveryRoutineFromConfig` returns `routine: null` otherwise), so an undeclared workspace's routine set is byte-for-byte what it was — which is exactly what `quality-gate-driver.test.mjs`'s "first round ⇒ all four routines due" case pins (it uses an empty temp root, so it keeps seeing four). That test's own comment predicted this drift class; the fix is to not add a routine to a workspace that declared nothing, while still keeping a DECLARED-but-disabled section observable (`enabled:false` ⇒ `not-evaluated:disabled`).
- [x] Real one-shot run: invoke the routine once against `/data/home/yale/work/quay` with the deployed config, through the driver's existing one-shot or test entry, not a hand-rolled loop. Paste the `scan-round` line (counts, wall ms, RSS) and the first 3 finding lines. Run it a second time immediately and paste the second `scan-round` line, which must show `new = 0`.

  Evidence — run through the routine's own entry `runArchDiscovery`, with `root = /data/home/yale/work/quay` (the real carriers), the config read from the DEPLOYED `loop.arch_discovery:` section, and `carrierPath`/`lastRunPath` redirected to this task's worktree so the shared checkout gets no writes at all (the instruments only READ `/data/home/yale/work/quay`; their own `--out` goes to a routine-owned temp dir). Both rounds pin `started` to ONE instant, so `[since, until]` is identical and the second round really does see the same inputs — that is what makes `new = 0` a reading rather than a hope, with the live loop appending carriers throughout.

  Round 1:
  ```
  {"ts":"2026-10-11T15:18:46.400Z","since":"2026-10-04T15:18:40.598Z","until":"2026-10-11T15:18:40.598Z","wall_ms":5799,"peak_rss_kb":253348,"kinds":{"evidence":64,"hypothesis":39,"experiment":14,"outcome":18,"counterexample":25},"findings":{"new":41,"repeated":0,"gone":0,"total":41},"transitions":0,"recurrence_keys":33,"instruments":{"space":{"wall_ms":2716,"peak_rss_kb":168068,"exit":0,"ok":true,"records":120},"time":{"wall_ms":3083,"peak_rss_kb":253348,"exit":0,"ok":true,"records":40}}}
  ```
  Round 1, first 3 finding lines:
  ```
  {"kind":"finding","routine":"arch-discovery","ts":"2026-10-11T15:18:46.400Z","finding_fp":"d31f1edb61813bdf3eccc79aa8ce64dba4b7320c85ccf4a387045bab1153affc","subject_key":"enum-surface:driver-kind|plugin/scripts/start-drivers.ts#122","verdict":"undetermined","instrument":"space"}
  {"kind":"finding","routine":"arch-discovery","ts":"2026-10-11T15:18:46.400Z","finding_fp":"d13878530f91260674253d6448fee5d4d23cbbfabd800be0646691085143fc49","subject_key":"enum-surface:driver-kind|CLAUDE.md#114","verdict":"","instrument":"space"}
  {"kind":"finding","routine":"arch-discovery","ts":"2026-10-11T15:18:46.400Z","finding_fp":"829d10a5ebda9392fb62db02bab181d9bb74ef58869941b9260d18b78e07d6ed","subject_key":"enum-surface:driver-kind|CLAUDE.md#114","verdict":"drift-hypothesis","instrument":"space"}
  ```
  Round 2 (run immediately after; `new = 0`):
  ```
  {"ts":"2026-10-11T15:18:52.021Z","since":"2026-10-04T15:18:40.598Z","until":"2026-10-11T15:18:40.598Z","wall_ms":5619,"peak_rss_kb":254516,"kinds":{"evidence":64,"hypothesis":39,"experiment":14,"outcome":18,"counterexample":25},"findings":{"new":0,"repeated":41,"gone":0,"total":41},"transitions":0,"recurrence_keys":33,"instruments":{"space":{"wall_ms":2581,"peak_rss_kb":165072,"exit":0,"ok":true,"records":120},"time":{"wall_ms":3038,"peak_rss_kb":254516,"exit":0,"ok":true,"records":40}}}
  ```
  Carrier after two rounds: 2 `scan-round` lines + 41 `finding` lines (round 2 appended 0 findings + 1 scan-round, exactly as AC1 case (6) requires). Cross-round evidence that the dedup is by fingerprint and not by accident: the two rounds' `recurrence` maps are identical (33 subject keys) and every fingerprint is `repeated`.
  Measurement note: the run reproduces Task 1's readings closely (space ~2.6–2.7 s, time ~3.0–3.1 s; time peak RSS ~253 MB vs Task 1's 265432 kB) and the deployed bounds are derived from them — see the cited derivation in the deployed `.quay/config.yml` block.
  ⚠️ Two things the AC's literal text does not pin, stated plainly: (a) the persistence paths were redirected to the worktree (the shared checkout is never written by this task); (b) the routine passes `--until` to the time scan in addition to the `--since` in the Plan's bound list — without it, each round's window would extend to "now", and `new` would be dominated by the live loop's own carrier growth rather than by new findings.

- [ ] Production carrier, after deployment: `.quay/arch-discovery-findings.jsonl` contains at least 1 `scan-round` line with ts after this task lands, written by the resident quality-gate driver (the quality-round fact names the routine). If the driver has not been restarted yet, leave this AC unticked and write "未读到" (not yet read). （待外部）

  **未读到 （待外部）**. Two preconditions are not met on this host at the time of writing: (1) no resident quality-gate driver is running for `/data/home/yale/work/quay` (`ps aux` shows no `quality-gate-driver.ts` for this workspace), and (2) the code is not on `develop` yet, so a driver started now would load the pre-change routine table. The section IS declared (`loop.arch_discovery` with `enabled: true`, `interval: interval:360m`, `since_days: 7`, `max_ms: 60000`, `max_records: 1000`, `max_old_space_mb: 512`) — ⚠️ but `.quay/config.yml` is gitignored, so that declaration is per-checkout and travels by the `dispatch-worktree-setup.sh` worktree-include copy, NOT by git; the same block must be added to whichever checkout the driver is started from. Deployment = add the section + (re)start the quality-gate driver so it loads the routine; both are for whoever holds driver lifecycle.

## Definition of Done
- [x] AC1–AC4 ticked with output pasted.
- [x] AC5 read from production, or explicitly recorded as not yet read. — recorded as **未读到 （待外部）** (no resident quality-gate driver; code not yet on develop).
- [x] `scripts/test.sh --for-task gap-arch-discovery-not-wired-into-routine-track-report-only` green.

  Evidence — scoped gate exit 0 (`ℹ tests 65 / ℹ pass 65 / ℹ fail 0`) after merging `develop` (04fb2a5f) into the task branch:
  ```
  $ bash scripts/test.sh --for-task gap-arch-discovery-not-wired-into-routine-track-report-only --allow-thin
  …
  ℹ tests 65 / ℹ pass 65 / ℹ fail 0
  EXIT=0
  ```
  Two static checks were red on the first run and are now fixed (not baselined): `tmp-leak-pairing-check` and `test-isolation-check` R6 both flagged the new test's unpaired `mkdtempSync`. The test now routes every temp dir through a `tmpDir()` helper into an `after()` carrier array — the required pairing, so the shrink-only violation list is untouched.

## Touches
- tasks/gap-arch-discovery-not-wired-into-routine-track-report-only.md
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/arch-discovery-routine.ts (new)
- plugin/test/arch-discovery-routine.test.mjs (new)
- docs/carrier-registry.json
- plugin/scripts/capability-catalog.sh
- plugin/scripts/capability-catalog-declarations.json
- .gitignore
- .quay/config.yml

## Blocker

**2026-10-11T15:29:36.342Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=merge-develop: Auto-merging .gitignore
CONFLICT (content): Merge conflict in .gitignore
Automatic merge failed; fix conflicts and then commit the result.
- run_id：wk-prod-anchor
- session_id：34afca92-1eaf-407d-b5be-2e722adf1e93
