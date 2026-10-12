---
id: gap-discovery-method-routine-manual-run-advances-production-last-run
title: "discovery-method routine: a manual/acceptance --once run advances the
  PRODUCTION last-run and suppressed the resident 360m cycle"
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
---
## Proposal
Production acceptance check, 2026-10-12. The resident quality-gate driver (pid 342010, started 09:42:53Z) never ran the `discovery-method` routine. Its only fact in `.quay/quality-round.jsonl`, at 09:46:57Z, is `not-evaluated: "not due: ran 36m ago within the 360m interval — nothing spawned"`.

The cause is a manual test run, not the schedule:
- `.quay/routine-last-run.json` holds `discovery-method = 1791796240114` (09:10:40Z). That is the timestamp of a `--once` acceptance run made by the worker of the done task `gap-discovery-method-routine-report-only` against `--root /home/yale/work/quay`.
- `plugin/scripts/discovery-method-routine.ts` derives `lastRunPath` from the caller's root (`path.join(root, ROUTINE_LAST_RUN_REL)`, around line 429) and calls `writeLastRun` at around line 691 for EVERY run. A manual or acceptance run therefore advances the production schedule.
- The two `scan-round` lines in `.quay/discovery-method-findings.jsonl` (09:10:40Z, 09:33:09Z) both come from those test runs. Nothing on that line says who ran them.

## Plan
1. Every round records `invoked_by`: `"resident-driver"` when called through the quality-gate driver's routine table, `"manual"` for the `--once` CLI and tests. The `scan-round` line and the routine Fact carry it.
2. Only `invoked_by:"resident-driver"` rounds read and advance the production entry in `.quay/routine-last-run.json`. A manual round:
   - ignores the due gate only when `--force` is given;
   - never writes `.quay/routine-last-run.json`;
   - writes its `scan-round` line with `invoked_by:"manual"`.
3. Manual rounds may still ingest and reflect into the persistent carriers, since report-only output is real data. But they must not change WHEN production runs next.
4. Do not edit, clear or backdate the existing `discovery-method` entry in `.quay/routine-last-run.json`, and do not touch any other routine's entry. The real production round is expected once the 360m interval from 09:10:40Z elapses (about 15:10Z); this task records what actually happens, it does not force it.

## What landed (how the Plan was realised)
`plugin/scripts/discovery-method-routine.ts`:
- `invokedBy: "resident-driver" | "manual"` is a round option, DEFAULT `"manual"` — an undeclared caller must not be able to move production's clock (硬规则 3b: the two states must not be shaped alike).
- The durable due gate's **read** is shared by both kinds (so a manual round still answers its own "is it due?" against the same production entry, and a hand-run inside the window is a no-op unless `--force`); its **advance** is the resident round's alone — `if (resident) writeLastRun(...)`, line ⑨ of the round.
- `buildDiscoveryMethodRoutine` (the driver's routine table) declares `invokedBy: "resident-driver"` and OMITS `invokedBy`/`force` from its options type, so a routine spec cannot be talked out of being the production scheduler. The `--once` CLI declares `"manual"` and gained `--force`.
- `invoked_by` is stamped on the `scan-round` line AND on the Fact's value (including the `not-evaluated` facts), so the carrier itself says who ran each round without cross-referencing anything (硬规则 9).

## Acceptance Criteria
- [x] `node --test plugin/test/discovery-method-routine.test.mjs` exits 0, with new cases:
  - (a) a manual round leaves a fixture `routine-last-run.json` byte-identical;
  - (b) a resident-driver round advances only the `discovery-method` key, and the other keys stay byte-identical;
  - (c) a manual round followed by a resident-driver round in the same interval: the resident round is still DUE, because it reads the last PRODUCTION time, not the manual one;
  - (d) a manual round's `scan-round` line carries `invoked_by:"manual"`, a resident one `"resident-driver"`.
  - **Evidence — 25/25 green**: `node --test plugin/test/discovery-method-routine.test.mjs` ⇒ `ℹ tests 25 / ℹ pass 25 / ℹ fail 0`. The four named cases: `✔ case (a) — a MANUAL round leaves routine-last-run.json BYTE-IDENTICAL (and really ran)`, `✔ case (b) — a RESIDENT-DRIVER round advances only the discovery-method key; the others are untouched`, `✔ case (c) — manual then resident INSIDE the same interval: the resident round is still DUE`, `✔ case (d) — the carrier line names its caller: manual vs resident-driver, side by side`. Two further cases cover Plan 2's other halves: `✔ the due gate for a MANUAL round: an in-window run is a no-op, --force runs one and STILL does not advance last-run` and `✔ the --once CLI is a MANUAL round: it appends its line and never advances the production last-run`.
  - **Non-vacuity**: (a)/(c) assert the round really RAN (state `verified` + its carrier line + `ingest.calls.length === 2`) BEFORE asserting the file is untouched — a "not due ⇒ nothing happened" no-op would also leave the file identical and is excluded by those assertions. (b) writes its fixture with the SAME serializer `writeLastRun` uses and then compares the other keys as TEXT too, so a formatting-only rewrite is caught.
- [x] Real check, read-only on production: paste `jq` of `.quay/routine-last-run.json` before and after one manual `--once` run of the landed code against `/home/yale/work/quay`. The `discovery-method` value and every other key must be unchanged. Paste the new `scan-round` line showing `invoked_by:"manual"`.
  - **Run** (this worktree's script, i.e. the code being landed): `node plugin/scripts/discovery-method-routine.ts --once --root /home/yale/work/quay --no-model --force --json` ⇒ exit 0, `state: "verified"`, `wall_ms: 25`, `model_calls: 0`. `--force` because production is not due until 15:10:40Z; `--no-model` because the ingest watermark (`{"line":270,…}`) already equals the store's length (270 lines) ⇒ 0 new Experiences ⇒ the model seam is never reached (so this run cost no model call).
  - **BEFORE** `jq . .quay/routine-last-run.json` = `{"self-validation":1786552318938,"semantic-dedup-scan":1791733865369,"freshness-refresh":1791793239519,"arch-discovery":1791778563897,"discovery-method":1791796240114}`; `md5sum` = `e7915523fea5742f0703f52fdd3fa99d`
  - **AFTER** — same five keys and values; md5 unchanged `e7915523fea5742f0703f52fdd3fa99d`; `diff` of the before/after copy is EMPTY (byte-identical, Plan 4: the `discovery-method` entry is still the pre-existing 1791796240114 — not edited, cleared or backdated, and no other routine's entry moved).
  - **New carrier line** (`.quay/discovery-method-findings.jsonl`, now 3 lines; the two earlier ones untouched): `{"kind":"scan-round","routine":"discovery-method","invoked_by":"manual","ts":"2026-10-12T11:15:37.610Z"}`
  - **The Fact**: `round ran (invoked_by:manual): ingested 0 experience(s), … 0 model call(s), wall 25ms; appended 1 scan-round line to .quay/discovery-method-findings.jsonl — MANUAL: the production last-run in .quay/routine-last-run.json was NOT advanced (this round did not move production's clock) [--force: the due gate was ignored for this round only]`
- [x] Mutation control: make manual rounds write last-run again and show case (a) goes red. Paste, then revert.
  - **M1** (the required one): `if (resident) writeLastRun(...)` → `if (resident || true) writeLastRun(...)` ⇒ `ℹ pass 21 / ℹ fail 4`, with `✖ case (a) — a MANUAL round leaves routine-last-run.json BYTE-IDENTICAL (and really ran) … AssertionError: a MANUAL round must not touch the production last-run map at all`. The same mutation also reds case (c) (`…and left NO production entry behind`), the `--force` case (`⛔ forcing past the window must not CONSUME the window`) and the CLI case (`⛔ the CLI — the very path that caused the defect — must not move production's clock`).
  - **M2** (case (d)'s own control, since AC3 only names (a)): the carrier line's stamp hardcoded to `"resident-driver"` ⇒ `ℹ pass 22 / ℹ fail 3`: `✖ case (d) … AssertionError: a round invoked by hand says so on the carrier`.
  - **Reverted**: both mutations reverted ⇒ `ℹ tests 25 / ℹ pass 25 / ℹ fail 0`.
- [x] Production reading: at least one `scan-round` line with `invoked_by:"resident-driver"` and ts after this task lands, plus the matching quality-round fact (state and reason). If none yet, write 未读到 with the next expected due time computed from `.quay/routine-last-run.json`. （待外部）
  - **未读到** (待外部) as of 2026-10-12T11:16Z. `.quay/discovery-method-findings.jsonl` has 3 lines and NONE carries `invoked_by:"resident-driver"`: the two pre-existing ones predate the key (⇒ `null`), the third is this task's `"manual"` run.
  - **Next expected due time, computed from `.quay/routine-last-run.json`**: `discovery-method = 1791796240114` = `2026-10-12T09:10:40.114Z`, + 360m ⇒ **`2026-10-12T15:10:40.114Z`**. A resident round firing after that reads it as due, appends a line with `invoked_by:"resident-driver"` and advances the entry.
  - **The matching quality-round fact so far** is exactly the one that reported this defect: `.quay/quality-round.jsonl` `{"round":1,"ts":"2026-10-12T09:46:57.580Z","facts":[{"name":"discovery-method","state":"not-evaluated","reason":"not due: ran 36m ago within the 360m interval — nothing spawned"}]}`. The 90 rounds since carry `facts: []`.
  - **Why not sooner — a second, PRE-EXISTING scheduler (reported, not fixed: outside this task's Touches)**: the resident loop keeps its own in-memory `lastRun` and does `lastRun[r.name] = state.now` when it INVOKES a routine, whether or not that routine ran (`quality-gate-driver.ts:1105-1113`). It invoked discovery-method once, in round 1 (09:46:57Z), so its in-memory gate next allows a round at 09:46:57+360m = **15:46:57Z** — i.e. the routine is not even called between now and then, and the first resident `scan-round` line is expected near 15:47Z rather than 15:11Z. Left alone deliberately: making that gate read the durable map instead of its own memory is a change to `quality-gate-driver.ts`, which this task does not touch.

## Definition of Done
- AC1–AC3 ticked with output pasted; AC4 read from production or recorded as not yet read.
- `scripts/test.sh --for-task gap-discovery-method-routine-manual-run-advances-production-last-run` green.
- `.quay/routine-last-run.json` was never hand-edited by this task.

## Touches
- tasks/gap-discovery-method-routine-manual-run-advances-production-last-run.md
- plugin/scripts/discovery-method-routine.ts
- plugin/test/discovery-method-routine.test.mjs
