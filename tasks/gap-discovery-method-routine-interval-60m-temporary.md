---
id: gap-discovery-method-routine-interval-60m-temporary
title: "discovery-method routine: temporary 60m cadence (user-requested,
  expiring), timed from the last REAL driver invocation, with a 24h model-call
  cap"
status: done
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-discovery-holdout-cross-experiment-leak-and-contaminated-promotion
---
## Proposal
The user explicitly asked (2026-10-12) to temporarily run ONLY the `discovery-method` routine every 60 minutes instead of 360, to support development validation. Every other routine's cadence stays as is, and no global scheduling change is made.

Facts, read on production at 2026-10-12T12:50Z:
- `plugin/scripts/discovery-method-routine.ts` hard-codes `MIN_INTERVAL_MINUTES = 360` (around line 102) and refuses any configured interval below it (around line 166: "below the 360m floor … refused rather than silently rounded"). So `interval:60m` in config would fail closed today.
- `.quay/config.yml` `loop.discovery_method` = `{enabled: true, interval: interval:360m, max_experiences: 8, max_model_calls: 6, max_wall_ms: 900000}`.
- The config is read once at quality-gate driver start (`plugin/scripts/quality-gate-driver.ts` around line 1315, `discoveryMethodRoutineFromConfig`). A config change only takes effect after the driver reloads.
- `.quay/routine-last-run.json` `discovery-method = 1791796240114` (09:10:40Z) was written by a worker acceptance run before the fix in done task `gap-discovery-method-routine-manual-run-advances-production-last-run` landed. It is not a real driver invocation.
- No `scan-round` with `invoked_by:"resident-driver"` exists yet in `.quay/discovery-method-findings.jsonl`. Its 4 lines are all worker or manual runs; the latest manual one is at 12:49:23Z.

## Plan
1. **Per-routine floor.** Lower the `discovery-method` floor to 60m. The default stays 360m when `interval` is absent. Other routines' floors and intervals are untouched.
2. **Temporary override, fail-safe.**
   - New optional config key `interval_until: <ISO-8601>`. While now < `interval_until`, the configured interval applies; after it, the routine reverts to the 360m default and records the revert in its Fact.
   - An interval below 360m WITHOUT `interval_until` ⇒ config error (`failed`, zero spawns). So a 60m cadence can never become permanent silently.
3. **Production timing from the last real driver invocation.**
   - A resident round computes "due" from the latest `scan-round` line with `invoked_by:"resident-driver"` in `.quay/discovery-method-findings.jsonl`. When there is none, it uses `.quay/routine-last-run.json` only if that entry is stamped as written by the resident driver. Stamp new resident writes, e.g. a sibling key `discovery-method@invoked_by`.
   - An unstamped legacy entry, like today's 09:10:40Z one, is treated as "no real driver invocation". The routine records that it was ignored and why.
   - Do NOT edit or delete the existing legacy value. Manual rounds still never write last-run.
4. **Safety limits for the faster cadence.**
   - New key `max_model_calls_per_24h` (required when the interval is < 360m), enforced across rounds from the `scan-round` lines in the trailing 24h. Hitting it ⇒ `not-evaluated:budget-24h`, zero spawns.
   - The existing per-round `max_experiences` / `max_model_calls` / `max_wall_ms` and the `enabled` kill switch are unchanged.
5. **Deployment.**
   - Set `.quay/config.yml` `loop.discovery_method` to `interval: interval:60m`, `interval_until` = landing time + 7 days, `max_model_calls_per_24h: 24`. Keep the other keys.
   - Reload the quality-gate driver so the config is read. Use the documented driver lifecycle (manager standing authority, CLAUDE.md); verify no in-flight worker would be affected; never `pkill -f`. Record the reload and the driver's startup line naming the assembled interval.

## Acceptance Criteria
- [x] `node --test plugin/test/discovery-method-routine.test.mjs` exits 0, with new cases:
  - (a) `interval:60m` + a future `interval_until` ⇒ accepted, due after 60m;
  - (b) `interval:60m` without `interval_until` ⇒ config error, zero spawns;
  - (c) after `interval_until` passes ⇒ 360m applies and the Fact says so;
  - (d) a legacy unstamped last-run entry is ignored for due-computation, and a resident-stamped one is honoured;
  - (e) a manual round between two resident rounds does not shift the resident due time;
  - (f) `max_model_calls_per_24h` reached ⇒ `not-evaluated:budget-24h`, zero spawns;
  - (g) `arch-discovery` and other routine intervals are unaffected (fixture with both routines).
  - **READ** — `EXIT=0`, `ℹ tests 34 / pass 34 / fail 0`. Every refusal arm carries its positive control in the same file: (c) re-reads the config at a clock BEFORE the expiry and still gets 60m (the revert is re-derived per round, not memoized); (f) runs the identical fixture one call under the ceiling and it RUNS, plus an out-of-window call that is not counted; (e)'s discriminating instant is 30m after the MANUAL line but 91m after the RESIDENT one — with the manual line as the basis the round would refuse; (g) reads arch-discovery's floor/interval from ITS OWN module and asserts that a 60m arch-discovery declaration with no `interval_until` is still valid, i.e. the temporary rule does not leak. Two further cases pin `latestResidentRoundTs` (legacy/manual lines never count; an unreadable `ts` on a resident line is a NAMED refusal) and the "same spec, two clocks" expiry.
- [x] `node --test plugin/test/quality-gate-driver.test.mjs plugin/test/arch-discovery-routine.test.mjs` exits 0.
  - **READ** — `EXIT=0`, `ℹ tests 46 / pass 46 / fail 0` (re-read on the final tree, after both develop merges).
- [x] Deployment, real: paste the `.quay/config.yml` `loop.discovery_method` section, the reload command and its output, and the driver stderr line reporting the assembled discovery-method interval. Also paste `jq -c . .quay/routine-last-run.json` before and after the reload, with every key unchanged.
  - **READ** — see ## Evidence §Deployment for the four pastes and, ⛔ more importantly, for why the reload is the ONE step this worker must not run (running it now would reload the OLD parser against the NEW config ⇒ fail-closed config error, not a deployment). The reload that deploys is the anchor's own source self-refresh, which this landing triggers.
- [x] Production reading: at least two `scan-round` lines with `invoked_by:"resident-driver"` after landing, about 60m apart, with their matching quality-round facts. If not yet observed, write 未读到 with the computed next due time. （待外部）
  - **READ** — **未读到**（待外部）. Computed next due time: the durable basis resolves to `due.source:"none"` (production's unstamped legacy entry is ignored; the carrier has no resident line) ⇒ `last=null` ⇒ **due immediately at the driver's first round after the reload**, and the driver's in-memory interval is 60m ⇒ the SECOND line ≈ the first + 60m. So: first resident line ≈ T_reload, second ≈ T_reload + 60m, where T_reload is the anchor self-refresh that follows this landing. A NON-resident proof that both readings are reachable on this code revision is in ## Evidence §Effect (a real scratch round that landed `invoked_by:"resident-driver"` from this exact `due.source:"none"` state and stamped the map).

## Definition of Done
- AC1–AC3 ticked with output pasted; AC4 read from production or recorded as not yet read.
- `scripts/test.sh --for-task gap-discovery-method-routine-interval-60m-temporary` green.
  - **READ** — `EXIT=0`, `ℹ tests 67 / pass 67 / fail 0`, zero `FAIL`/`not ok` lines, on the FINAL tree (both develop merges done, the mis-propagated peer file dropped) — log `<worktree>/.quay/ac-method-60m-scoped-gate-final.txt`. develop was 15 commits ahead of the fork point at the first merge and moved again before the second (it absorbs the task_write commits themselves); both merged clean, no unmerged paths.
  - **READ (independent)** — the fan-in's own after-the-fact guardrail, run directly: `ANTI-DRIFT OK: task … — 3 actual file(s), all within declared Touches (5 glob(s))`. ⛔ It was a HARD FAIL (`out-of-declared: task wrote tasks/gap-p4-guard-…md`) while a peer's propagated task file sat at the tip — see the second disclosure; that is why it was dropped.
  - **CACHE** — `--write-scoped-gate-cache --task … --develop-sha "$(git -C <wt> rev-parse develop)"` was written; ⛔ expect a MISS rather than a skip (develop is re-pointed at the `task_write` commits themselves, so the sha the fan-in reads usually differs from any recorded one). A miss only re-runs a gate that is green.

## Evidence

**What shipped** — branch `task/gap-discovery-method-routine-interval-60m-temporary`:

| commit | file | what |
|---|---|---|
| `c0ffb8fc0` | `plugin/scripts/discovery-method-routine.ts` | floor 60m (per-routine); `interval_until` window + revert; REQUIRED `max_model_calls_per_24h` ⇒ `not-evaluated:budget-24h`; due basis = newest `invoked_by:"resident-driver"` carrier line, else a resident-STAMPED last-run entry; resident advance writes `<name>@invoked_by` in the SAME write |
| `c0ffb8fc0` | `plugin/scripts/quality-gate-driver.ts` | the startup line now NAMES the assembled interval (before, the assembly was not reportable at all) |
| `c0ffb8fc0` | `plugin/test/discovery-method-routine.test.mjs` | cases (a)–(g) + `latestResidentRoundTs` + the expiry control |
| `9aa461ffe`, `d2a2b1b71` | `tasks/<id>.md` | the ABI-written task file (Touches += `plugin/scripts/quality-gate-driver.ts`, then the AC ticks + this Evidence), transported onto the branch — no checkbox hand-edited |

**⛔ Why `quality-gate-driver.ts` is in this delta AND why that is what makes the deploy land.** The anchor's AC-184 self-refresh watches `DRIVER_KINDS[kind].driver` **plus six shared kernel files** (`driver-runtime.ts:2522-2535`); `discovery-method-routine.ts` is NOT in that set. A change confined to the routine module would therefore have sat inert — the driver-startup-line change is what makes the anchor reload. The measured pair below is the same mechanism firing for the previous routine landing.

**The due basis in one line**: `due` is computed from the newest `invoked_by:"resident-driver"` `scan-round` line; only when the carrier has none does it fall back to `.quay/routine-last-run.json`, and then only to an entry carrying the `discovery-method@invoked_by: resident-driver` stamp. Production's `discovery-method = 1791796240114` carries no stamp ⇒ it is recorded as IGNORED (`due.legacy_ignored`) and grants no window. It is never edited or deleted.

### §Deployment

**(1) The deployed section — `.quay/config.yml` in the MAIN checkout** (gitignored workspace config: it travels with no branch, and the main checkout is the root the resident driver reads; the task worktree's copy was refreshed to be byte-identical because `worktree-include` copies it):

```yaml
  discovery_method:
    enabled: true
    interval: interval:60m
    interval_until: 2026-10-19T14:00:00Z
    max_model_calls_per_24h: 24
    max_experiences: 8
    max_model_calls: 6
    max_wall_ms: 900000
```
(the comment block above it was updated too — the old one still taught "interval 下限 360m")
`md5`: `3f340d94872131dd6cf79aa8628288f4` → `599d36125d45ec2040a6fa078bbe2953`; worktree copy `599d36125d45ec2040a6fa078bbe2953` (identical). Read back through THIS revision's parser: `{trigger:{kind:"interval",minutes:60}, intervalUntil:1792418400000, maxModelCallsPer24h:24, error:null}`.

**(2) The reload — the one step this worker must NOT run, and why.** The command is `quay driver restart --kind quality` (documented lifecycle, CLAUDE.md; never `pkill -f`). I did not run it, and the reason is mechanical rather than a skip: the resident driver is an in-process task of the anchor (`/data/home/yale/work/quay/plugin/scripts/driver-anchor.ts`, pid 342010), and it imports its kind's modules from the **main checkout**, where this implementation does not exist until the fan-in lands it and `syncDevelopToDoc` brings develop over. Reloading NOW would make the **old** parser read the **new** config: the old floor is 360m, so `main()` would print `discovery-method 例程配置无效 — … interval 60m is below the 360m floor …` and every round would record `failed` with zero spawns. That is the correct fail-closed reading of a code/config skew — but it is the deployment's failure mode, not its execution.
The reload that DOES deploy is the anchor's own AC-184 source self-refresh, and this landing is what triggers it. Measured on the previous routine landing, same mechanism (lines from `.quay/anchor.log`):
```
plugin/scripts/quality-gate-driver.ts   mtime 2026-10-12T09:42:47Z
2026-10-12T09:42:54Z anchor: restarting anchor (AC-184 self-refresh; kinds=[quality])
2026-10-12T09:46:09Z anchor: host pid=342010 root=/data/home/yale/work/quay kinds=[promotion,worker,goal,quality,outer,meta] reconcile=500ms
```
So the new code and the new config arrive together on one refresh, with no manual step. **Disclosed skew window**: between this config edit and the landing, the config is ahead of the code in the main checkout; if the anchor self-refreshes for an unrelated reason in that window (i.e. some other landing advances one of those seven watched files), the routine records `failed` (config invalid, zero spawns) until this branch lands. Visible and self-healing — the only cost of not being able to land and deploy atomically from a worker.

**(3) The driver stderr line reporting the assembled interval** — read from the REAL driver on THIS code revision, against a scratch root carrying a **byte-identical** copy of the deployed config (`md5 599d3612…` on both sides). The production root itself cannot host a second run: its four built-in routines would be due on round 1 with an empty in-memory `lastRun` and would spawn the LLM judge / gap-filing passes against production.
```
node --experimental-strip-types <wt>/plugin/scripts/quality-gate-driver.ts \
  --root <scratch> --once --run-id ac-method-60m-deploy-reading --json
→
quality-gate-driver: arch-discovery 例程已装配（enabled）
quality-gate-driver: discovery-method 例程已装配（enabled, interval=60m, interval_until=2026-10-19T14:00:00.000Z, max_model_calls_per_24h=24）
```
(that run was `--halted` in the scratch root ⇒ all 8 routines `not-evaluated`, zero spawns, and the discovery-method Fact reached the halt gate — i.e. the config was ACCEPTED; a rejected config returns `failed` before that gate).

### §Effect — the same config end-to-end, second run, NOT halted
Fresh scratch (`git init`, production's `routine-last-run.json` copied verbatim, empty evidence store): the round is DUE — the legacy entry really is ignored — runs as `invoked_by:"resident-driver"`, and advances the map WITH the stamp:
```
fact: round ran (invoked_by:resident-driver, interval 60m): ingested 0 experience(s), reflected 0 unit(s), minted 0 candidate(s),
      0 evaluated verdict(s), 0 promotion(s), 0 retirement(s), 0 model call(s), wall 25ms; appended 1 scan-round line to
      .quay/discovery-method-findings.jsonl and advanced the production last-run (the legacy .quay/routine-last-run.json entry
      1791796240114 was NOT written by the resident driver and is ignored for due-computation)

carrier line: {"kind":"scan-round","routine":"discovery-method","invoked_by":"resident-driver","ts":"2026-10-12T13:25:47.307Z","model_calls":0,
  "interval":{"minutes":60,"declared_minutes":60,"reverted":false,"until":"2026-10-19T14:00:00.000Z"},
  "due":{"source":"none","basis":"routine-last-run.json holds 1791796240114, but it carries no invoked_by:resident-driver stamp on
  'discovery-method@invoked_by' and the carrier has no resident-driver round, so it is a legacy/unattributed entry and is IGNORED
  for due-computation","last_resident_run":null,"legacy_ignored":1791796240114}}

last-run before: {"self-validation":1786552318938,"semantic-dedup-scan":1791733865369,"freshness-refresh":1791805753860,"arch-discovery":1791778563897,"discovery-method":1791796240114}
last-run after:  {"self-validation":1786552318938,"semantic-dedup-scan":1791733865369,"freshness-refresh":1791805753860,"arch-discovery":1791778563897,"discovery-method":1791811547308,"discovery-method@invoked_by":"resident-driver"}
```

**(4) `jq -c . .quay/routine-last-run.json` on PRODUCTION, before and after everything above — byte-identical, every key unchanged**:
```
before: {"self-validation":1786552318938,"semantic-dedup-scan":1791733865369,"freshness-refresh":1791805753860,"arch-discovery":1791778563897,"discovery-method":1791796240114}
after:  {"self-validation":1786552318938,"semantic-dedup-scan":1791733865369,"freshness-refresh":1791805753860,"arch-discovery":1791778563897,"discovery-method":1791796240114}
```
The production carrier is likewise still its original 4 lines, and `git status -- tasks/ goals/` in the main checkout stayed empty — the deployment touched exactly one file, `.quay/config.yml`.

### Two disclosures
- **Production was touched only by `.quay/config.yml`.** No driver was restarted, nothing was `pkill`ed, and no production carrier or task file was written by any reading above (the readings ran against scratch roots; the one run against production state was read-only).
- **A mis-invoked command, contained to this worktree — and the one side effect that reached this branch.** `scripts/test.sh --scoped <file...>` passes its arguments to `node --test` as TEST FILES, so naming a direct-entry script among them (`plugin/scripts/quality-gate-driver.ts`) *starts* that script instead of testing it: it ran one quality round against the task worktree and stayed resident until I killed it (~3 min). Its writes landed in the worktree's own `.quay/` (round record, arch-discovery carrier, one arch-review submission); it filed no task and no goal (`git status -- tasks/ goals/` in the worktree is empty) and it never touched production. **That round also ran the store-commit PROPAGATION step, which committed a PEER task's pending body — `gap-p4-guard-lineage-worktree-root-phantom-missing-object` — onto this branch as `e1a8de956`.** Nothing else carries it (absent from `author`, `develop` and every other ref, and not on the main checkout's disk), and it hard-fails the fan-in's `anti-drift-touches-check` as `out-of-declared`, so it was dropped from the tip in `37f8cc950`. ⛔ The peer's body is NOT lost: `e1a8de956` stays in this branch's history, so after the merge lands on develop,
  `git show e1a8de956:tasks/gap-p4-guard-lineage-worktree-root-phantom-missing-object.md` reproduces it (57 lines), and its owner or a re-dispatch can restore it from there. A convenience copy also sits at `<worktree>/.quay/ac-method-60m-rescued-peer-task.md`. ⛔ **Not** something I fixed here: the peer task's own `## Touches` names `plugin/scripts/quality-gate-driver.ts` — the same file this task touches — so the two must be serialized, not run concurrently.

## Touches
- tasks/gap-discovery-method-routine-interval-60m-temporary.md
- plugin/scripts/discovery-method-routine.ts
- plugin/scripts/quality-gate-driver.ts
- plugin/test/discovery-method-routine.test.mjs
- .quay/config.yml
