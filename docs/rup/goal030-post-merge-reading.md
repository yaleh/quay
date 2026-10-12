# GOAL-030 ⑥ — 并入后生产读数 (AC-341)

**Status:** recorded reading, criterion `exit 0` (PASS). ⚠️ **§1–§4 are the 2026-10-09 reading of the
PRE-FIX criterion (sha256 `74bb00ab…`) and are retained as the historical record; §5 supersedes them.**
**Task:** `gap-goal030-post-merge-promotion-events-reading` (2026-10-09); revised by
`gap-ac341-criterion-blind-to-v1-status-event-dialect` (2026-10-13, see §5)
**Goal:** GOAL-030 (§AC-341, `phase: post-merge`)
**Recorded:** 2026-10-09 (UTC 2026-10-08T23:3x–23:4xZ); §5 revised 2026-10-13
**Evaluation root:** the **shared main checkout** `/data/home/yale/work/quay`
(⛔ **not** a task worktree — `.quay/` is the main checkout's runtime carrier;
the resident promotion-driver loads from the main-checkout worktree and writes there).

This file records the **only** GOAL-030 AC whose evaluation surface is the *production*
promotion-driver on `develop` after the merge. ①–⑤ evidence branch-tip / sandbox behaviour;
this one is the production reading. It is **read-only**: no source file, no criterion, no
kernel module, and no `.quay/` carrier was modified, and no event line was written by hand.

## 1. What was run

The criterion is taken **from the Provider ABI**, not retyped:

```
node --experimental-strip-types packages/quay/bin/quay.ts goal show AC-341   # → cmd.criterion
```

- criterion source: `goals/AC-341-并入后生产读数-….md` (`criterion: |` block scalar)
- extracted script `sha256` = `74bb00abdf89e305bddb2e6d2252623ab329fa726801b51b5fb516d9d5efca39`
- executed with `bash` from `/data/home/yale/work/quay` (the criterion `git rev-parse --show-toplevel`s
  and `cd`s there itself)
- the criterion is **verbatim, unmodified** — the same extracted script was also used for the
  negative control in §4

**Production reading (main checkout root, 2026-10-09T07:3x+08:00):**

```
EXIT=0
STDOUT: PASS: all 2 production promotion-driver todo→ready flips since the merge carry a promote event
STDERR: (empty)
```

## 2. Merge instant `t` and the flip set

| quantity | value |
|---|---|
| GOAL-030 landed `goal-merge-result` timestamp **t** | `2026-10-08T18:35:54.646Z` |
| `landedSha` | `d71d2bde4a74d35ce6981157f82a2710a2dab810` |
| main checkout == develop tip at reading time | `cf4c9acef41ce7cdf92e937e8ab837c5f6cdeb03` (fork `0/0`) |

`git log develop --since=t --format='%s' | sed -nE 's/^tasks: ([^ ]+) todo→ready（promotion-driver 机械晋升）.*/\1/p'`

**dedup count = 2** — the id list:

| # | id | commit | commit time (UTC) |
|---|---|---|---|
| 1 | `gap-routine-filing-rate-global-window-starves-freshness-refresh` | `6ef104600c4f39a8dd955cad4b5914dc81c3d81a` | 2026-10-08T23:30:43Z |
| 2 | `gap-goal030-post-merge-promotion-events-reading` | `56bf2883b42f4b3965155c9dedd6bf90291cc9d3` | 2026-10-08T23:32:44Z |

`.quay/task-status-events.jsonl` (2 lines, both `kind=promote ∧ to=ready ∧ ts ≥ t−60000`):

```json
{"ts":"2026-10-08T23:30:43.072Z","taskId":"gap-routine-filing-rate-global-window-starves-freshness-refresh","from":"todo","to":"ready","kind":"promote","actor":"ready-pool-check --apply","writerModule":"/data/home/yale/work/quay/packages/quay/src/kernel/task-transition.ts","entry":"/data/home/yale/work/quay/plugin/scripts/ready-pool-check.ts","pid":456478}
{"ts":"2026-10-08T23:32:44.203Z","taskId":"gap-goal030-post-merge-promotion-events-reading","from":"todo","to":"ready","kind":"promote","actor":"ready-pool-check --apply","writerModule":"/data/home/yale/work/quay/packages/quay/src/kernel/task-transition.ts","entry":"/data/home/yale/work/quay/plugin/scripts/ready-pool-check.ts","pid":603284}
```

Both commits carry a matching event (1 flip → 1 event, same task id, ts within ~1 s of the
commit). Note the event `writerModule` / `entry` are the **main checkout's** absolute paths —
i.e. the production `ready-pool-check --apply` on the shared checkout wrote through the
kernel transition module, which is exactly the property AC-341 tests.

**AC2 root-cause arm is `N/A`:** the criterion returned `exit 0`, so the `exit 1`
direct-reading root-cause clause does not apply. (Direct readings are still given above:
carrier exists, 2 lines, kernel module present in the main worktree.)

## 3. Criterion strength — negative control (AC3)

Three one-off fixture git repos were built under `/tmp/ac341-fixtures` (independent `develop`
branch, self-made `tasks: <id> todo→ready（promotion-driver 机械晋升）` subject, self-made
`.quay/gate-events.jsonl` + `.quay/task-status-events.jsonl`), and the **verbatim** AC-341
criterion (same `sha256` as §1) was run in each. Harness:
`.quay/ac341-negctl/run.sh` (worktree, gitignored). ⛔ No production `.quay/` / `tasks/` was
touched and no `git checkout` was used to restore anything.

| arm | fixture | expected | observed |
|---|---|---|---|
| (a) flip with no event | promo commit + carrier present but no matching event | `exit 1` + `CAUSE=flip-without-event` | **`exit 1`**, stderr = `CAUSE=flip-without-event — 1/1 production todo→ready flips since the merge have no promote event: fixture-task-a` |
| (b) flip, carrier absent | promo commit + `.quay/task-status-events.jsonl` missing | `exit 1` + `CAUSE=event-carrier-absent` | **`exit 1`**, stderr = `CAUSE=event-carrier-absent — .quay/task-status-events.jsonl missing while 1 production promotions happened since the merge` |
| (c) flips and events agree | promo commit + matching promote event | `exit 0` + `PASS:` | **`exit 0`**, stdout = `PASS: all 1 production promotion-driver todo→ready flips since the merge carry a promote event` |

Arm (c) is the known-true sample: the predicate fires positively on a consistent fixture, so the
`exit 1` arms in (a)/(b) are real negative control, not a predicate that can only ever go red.

**Exit codes: (a) exit 1 · (b) exit 1 · (c) exit 0. Production reading: exit 0.**

## 4. Verdict

`exit 0` ⇒ AC-341 is satisfied **in production**: every production promotion-driver
`todo→ready` flip on `develop` since GOAL-030 landed carries a corresponding
`kind=promote` event in `.quay/task-status-events.jsonl`. GOAL-030's wiring is live on the
shared checkout (the resident promotion-driver's promotions at 23:30Z and 23:32Z both wrote
events through `packages/quay/src/kernel/task-transition.ts`).

⛔ No criterion change, event back-fill, or PASS fabrication was performed; this file records a
reading, not a green-making edit.

---

## 5. Revision — 2026-10-13: the carrier has TWO dialects, the judge read one

**Task:** `gap-ac341-criterion-blind-to-v1-status-event-dialect`
**Evaluation root:** the shared main checkout `/data/home/yale/work/quay` (same surface as §1).
**Criterion:** re-installed from the goal store on 2026-10-13; read-back bytes
`sha256 = 0df4104081d62e2955dea6e68df1b216f6fc555072cd5f21c6adbfdc9bda9308` (2290 bytes; the
writer emits the block scalar as `criterion: |-`, so the stored value carries **no** trailing
newline — the hand-held draft, which did, hashes `cc5779aa…`). It is *not* the `74bb00ab…` script
§1–§4 record.

### 5.1 What went wrong

§1–§4's criterion keyed its event scan on `Date.parse(e.ts)` — the **v0** dialect. On
2026-10-12T18:21Z the writer side switched to the **v1** dialect (`schema:
"task-status-event/v1"`, `packages/quay/src/kernel/task-transition.ts`, landed by
`gap-task-status-events-abi-writes-and-creation` /
`gap-task-status-events-contract-v1-all-driver-writers`). v1 rows carry their timestamp in `at`,
NOT `ts` — so `Date.parse(undefined)` was `NaN`, the `>= t−60000` comparison was permanently false,
and **every v1-written flip was reported as missing**. The judge could not read its input and
returned the same shape it returns for "read it and it is bad" (hard rule 3b).

The pre-fix reading on 2026-10-13 was:

```
EXIT=1
STDERR: CAUSE=flip-without-event — 7/154 production todo→ready flips since the merge have no promote event:
  gap-goal030-ac337-provenance-shape-drift, gap-open-discovery-consumes-task-status-events-optional-context, …
```

**All 7 carry a v1 promote event.** Production was never broken; the judge was.

### 5.2 The dialect timeline in `.quay/task-status-events.jsonl`

| dialect | row shape | time field | time range (2026-10-13 reading) | `to=ready ∧ kind=promote` ids |
|---|---|---|---|---|
| v0 | no `schema` key | `ts` | 2026-10-08T23:30:43.072Z .. **2026-10-12T18:04:47.339Z** | 147 |
| v1 | `schema: "task-status-event/v1"` | `at` | **2026-10-12T18:21:18.303Z** .. 2026-10-12T20:43:56.330Z | 8 |

150 v0 rows + 29 v1 rows; 147 + 8 = **155 = the id set the criterion checks**. Both dialects are
official and both are understood by the repo's own canonical readers
(`plugin/scripts/task-status-events-reconcile.ts` maps `at` for v1 / `ts` for v0;
`packages/quay/src/cli/task-log.ts` normalises both). Only the AC-341 criterion read one.

The 7 ids that the pre-fix judge called missing (all `actor.kind = "promotion-driver"`):

| id | v1 event `at` |
|---|---|
| `gap-driver-round-carriers-unbounded-growth-retention-design` | 2026-10-12T18:31:05.841Z |
| `gap-fan-in-baseline-comparison-blind-to-spec-reporter-misparks-develop-wide-red` | 2026-10-12T18:31:05.931Z |
| `gap-prod-data-audit-whole-file-read-crashes-on-carrier-over-v8-string-limit` | 2026-10-12T18:31:06.030Z |
| `gap-open-semantic-discovery-investigator-exits-before-hypotheses-zero-semantic-output` | 2026-10-12T18:31:06.126Z |
| `gap-status-sync-priority-drops-superseded-resurrects-or-loses-retired-tasks` | 2026-10-12T18:47:27.197Z |
| `gap-open-discovery-consumes-task-status-events-optional-context` | 2026-10-12T19:12:45.313Z |
| `gap-goal030-ac337-provenance-shape-drift` | 2026-10-12T20:25:02.089Z |

One of the seven, verbatim — the proof that these events come from the **production**
promotion-driver (`entry: …/plugin/scripts/ready-pool-check.ts`, main-checkout absolute paths):

```json
{"schema":"task-status-event/v1","eventId":"32636e5e22aa71477079115f03423897","seq":6,
 "carrierEpoch":"f0abc6d11b8c4c6aefdd687eb6b308dc",
 "taskId":"gap-driver-round-carriers-unbounded-growth-retention-design",
 "from":"todo","to":"ready","kind":"promote","at":"2026-10-12T18:31:05.841Z",
 "actor":{"kind":"promotion-driver","id":"ready-pool-check --apply"},
 "evidence":{"commit":"29dce667498360e114c01f97aea075703112329c"},
 "producer":{"writerModule":"/data/home/yale/work/quay/packages/quay/src/kernel/task-transition.ts",
             "entry":"/data/home/yale/work/quay/plugin/scripts/ready-pool-check.ts","pid":1969074}}
```

### 5.3 The fix

Two halves, both required: (1) read **both** dialects — `at` when it is a string, else `ts`;
(2) give *"cannot read the input"* its **own** value — a candidate row (`to=ready ∧ kind=promote`)
with neither field now exits **3 / NOT-EVALUATED** instead of falling through to `exit 1`, so a third
dialect fails loudly rather than masquerading as a red. Unchanged: the `to=ready ∧ kind=promote`
predicate, the `t−60000` window, `CAUSE=flip-without-event` / `CAUSE=event-carrier-absent`, `PASS:`.

### 5.4 Revised production reading (main checkout root, 2026-10-13)

```
EXIT=0
STDOUT: PASS: all 155 production promotion-driver todo→ready flips since the merge carry a promote event
STDERR: (empty)
```

(`t` is unchanged: `2026-10-08T18:35:54.646Z`, one landed `goal-merge-result` for GOAL-030. The set
grew 154 → 155 because this task's own `todo→ready` flip is itself a production promotion —
`at: 2026-10-12T20:39:46.371Z`, `actor.kind: "promotion-driver"` — i.e. the criterion is measured
against a moving production population, not a frozen one.)

`quay goal gate AC-341 --dry-run` from the main checkout records `verdict: "pass"`,
`evaluationRoot: "/data/home/yale/work/quay"`, `timeoutMs: 60000`.

### 5.5 Strength not relaxed — negative controls (AC3 / AC4)

Fixture git repos (independent `develop`, self-made `tasks: <id> todo→ready（promotion-driver
机械晋升）` subject, self-made `.quay/gate-events.jsonl` + `.quay/task-status-events.jsonl`), the
criterion run **as stored** in each:

| arm | fixture | observed |
|---|---|---|
| v1-only carrier | v1 rows, matching | `exit 0` |
| v0-only carrier | v0 rows, matching | `exit 0` |
| mixed v0+v1 | one of each | `exit 0` |
| flip, no matching event | carrier present, no match | `exit 1` · `CAUSE=flip-without-event` |
| carrier absent | no `.quay/task-status-events.jsonl` | `exit 1` · `CAUSE=event-carrier-absent` |
| only pre-merge events | `ts` older than `t−60000` | `exit 1` (the window still applies) |
| only `ready→done` promote | `to:"done"` | `exit 1` (the `to=ready` predicate still applies) |
| candidate row with neither `at` nor `ts` | unreadable dialect | `exit 3` · `NOT-EVALUATED` |

The regression pin `plugin/test/ac341-post-merge-promotion-events-dialect.test.mjs` drives these arms
from the **goal store** (never a criterion copy); with the pre-fix bytes (`74bb00ab…`) substituted for
the stored criterion, exactly the three dialect-dependent arms (v1-only, mixed, unreadable) go red and
the dialect-independent ones stay green — the signature that separates a pin from an echo.

