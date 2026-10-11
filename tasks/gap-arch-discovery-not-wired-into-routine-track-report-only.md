---
id: gap-arch-discovery-not-wired-into-routine-track-report-only
title: Wire the arch-discovery scans into the quality-gate routine track as a
  report-only, bounded, killable mechanical routine
status: todo
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
- [ ] `node --test plugin/test/arch-discovery-routine.test.mjs` exits 0, covering, each as its own named case:
  - (1) section absent ⇒ `not-evaluated:disabled` and zero spawns;
  - (2) `enabled:false` ⇒ same;
  - (3) halted ⇒ `not-evaluated:halted` and zero spawns;
  - (4) malformed config and interval < 60m ⇒ `failed` and zero spawns;
  - (5) instrument non-zero exit / timeout / unparseable output / validator-refused ⇒ `failed`, the carrier stays byte-identical, and last-run is not advanced;
  - (6) two rounds on identical inputs ⇒ the second appends 0 finding lines and 1 scan-round line with `repeated = N`, `new = 0`;
  - (7) a changed verdict ⇒ exactly 1 new finding line and a transition counted;
  - (8) not due inside the interval ⇒ zero spawns;
  - (9) after a full round, `git status --porcelain tasks/ goals/` is empty and no file under `tasks/`/`goals/` changed (no task or goal created).
- [ ] Static control: `grep -nE 'selectFilings|fileRoutineTask|driveItems|task_write|goal_write|writeTask|writeGoal'` on the new routine file prints nothing. Mutation control: add one such import and show that the case (9) static assertion goes red, then revert. Paste the output.
- [ ] `node --test plugin/test/quality-gate-driver.test.mjs plugin/test/quality-gate-driver-loop-watchdog.test.mjs plugin/test/probe-routine.test.mjs plugin/test/routine-file-gate.test.mjs plugin/test/carrier-registry-completeness.test.mjs` exits 0. No existing routine behaviour changes.
- [ ] Real one-shot run: invoke the routine once against `/data/home/yale/work/quay` with the deployed config, through the driver's existing one-shot or test entry, not a hand-rolled loop. Paste the `scan-round` line (counts, wall ms, RSS) and the first 3 finding lines. Run it a second time immediately and paste the second `scan-round` line, which must show `new = 0`.
- [ ] Production carrier, after deployment: `.quay/arch-discovery-findings.jsonl` contains at least 1 `scan-round` line with ts after this task lands, written by the resident quality-gate driver (the quality-round fact names the routine). If the driver has not been restarted yet, leave this AC unticked and write "未读到" (not yet read). （待外部）

## Definition of Done
- AC1–AC4 ticked with output pasted.
- AC5 read from production, or explicitly recorded as not yet read.
- `scripts/test.sh --for-task gap-arch-discovery-not-wired-into-routine-track-report-only` green.

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
