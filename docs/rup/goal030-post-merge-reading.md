# GOAL-030 ⑥ — 并入后生产读数 (AC-341)

**Status:** recorded reading, criterion `exit 0` (PASS).
**Task:** `gap-goal030-post-merge-promotion-events-reading`
**Goal:** GOAL-030 (§AC-341, `phase: post-merge`)
**Recorded:** 2026-10-09 (UTC 2026-10-08T23:3x–23:4xZ)
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
