---
id: gap-routine-freshness-refresh-freshness-goal-009-ac-232
title: "freshness-refresh: Same coldstart-face run as AC-203/207 (d=173, margin
  27); filing it is required because refreshing that run does not happen by
  itself."
status: ready
labels:
  - gap
  - routine-filed
  - freshness-refresh
parent: null
children: []
extra: {}
---
## Finding
Same coldstart-face run as AC-203/207 (d=173, margin 27); filing it is required because refreshing that run does not happen by itself.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1792489168017` · ts `2026-10-20T09:39:28.017Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`coldstart-face`、`GOAL-009-AC-232`
- 涉及文件：
- `.quay/goal-freshness-margin.json:1`
- `.quay/productization-verification.jsonl`
- `plugin/freshness-producers.json:148`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run coldstart-face on this host against hosts B and C (both ssh-authorized, reachability rc=0) supplying a target-recognized --driving-profiles

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `freshness-goal-009-ac-232`（routine `freshness-refresh`，runId `freshness-refresh-1792489168017`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**处置 = 【修掉】：finding 所指的「AC-232 证据陈旧（d=173 / margin 27）」已由同一次 `coldstart-face` 运行刷新，主体 AC-232 在两台主机上都落了新记录。**
⛔ 不是「已注意到」。下面每一格都是本轮当场从载体取出的读数（⛔ 不是转述兄弟任务的散文）。

### ① 复核：finding 的三条断言逐条复现

载体 `.quay/routine-findings.jsonl`（本轮 `grep -n` 命中第 2826 行，runId `freshness-refresh-1792489168017`）中 findingId `freshness-goal-009-ac-232` 的逐字记录：

> "findingId":"freshness-goal-009-ac-232","dupKind":"stale-subject","subject":"GOAL-009-AC-232","symbols":["coldstart-face","GOAL-009-AC-232"],"files":[".quay/goal-freshness-margin.json:1",".quay/productization-verification.jsonl","plugin/freshness-producers.json:148"],"verdict":"act-now","rationale":"Same coldstart-face run as AC-203/207 (d=173, margin 27); filing it is required because refreshing that run does not happen by itself.","margin":27

| finding 的断言 | 本轮读数 | 复现方式（同一谓词、同一载体） |
|---|---|---|
| `d=173` | `distance=173`（`content-commits=171` + `content-merges=2`，92 条记账 merge 剔除） | `node --experimental-strip-types plugin/scripts/freshness-producer-coverage-check.ts --delivery-face-distance --from 61a1ebb0600f --tip develop` |
| 最新证据 `ts=2026-10-12T22:06:56Z` | 该条仍在载体中（`build_sha=61a1ebb0600f…`，`host=instance-20221019-1509`，`project_root=/home/yale/quay-verify-coldstart-61a1ebb0-root`） | 用 `python3` 读 `.quay/productization-verification.jsonl` 中 `ac=="GOAL-009-AC-232"` 的全部 **32** 条，按 `ts` 排序 |
| `margin 27` | `K=200 − d=173 = 27` | 同上；`K` 见 `.quay/goal-freshness-margin.json` 的 `"k": 200` |

⇒ 案由成立。

### ② 处置：所需的产出者运行已经发生，且本主体在其覆盖范围内

finding 自己写明它与 AC-203/207 是**同一次 `coldstart-face` 运行**；`plugin/freshness-producers.json` 的
`coldstart-face.subjects` 逐字含 `"GOAL-009-AC-232"`。⇒ 该运行**必然**刷新本主体，无需为 AC-232 单独再跑一遍。

本轮从载体核对到的那次运行（`build_sha=ce13d764f90b…`，即运行起点的 develop tip）：

- `.quay/verify-coldstart-remote-B-ce13d764.log:39`：`== ⑨ goal carrier write+read-back (AC-232): goal write + show/list read-back into the third-party project ==`；
  `:41` `goal_write_ok=1 goal_read_back_ok=1 goal_records=2 evaluated=1 host=orangevps project_root=/home/yale/quay-verify-coldstart-ce13d764-root`；
  `ac232 record written → /home/yale/quay-verify-coldstart-evidence-ce13d764.jsonl`；`:144` `VERIFY-RC 0`。
- `.quay/verify-coldstart-remote-C-ce13d764.log:39`：同一条腿，`:41` `host=instance-20221019-1509`；`:149` `VERIFY-RC 0`。

### ③ 载体侧读数：AC-232 的新证据晚于 finding 立案时刻

`.quay/productization-verification.jsonl` 中 `ac == "GOAL-009-AC-232"` 的记录共 **32** 条，最后三条：

| ts | build_sha | host |
|---|---|---|
| `2026-10-12T22:06:56Z` | `61a1ebb0600f…` | `instance-20221019-1509` |
| `2026-10-20T09:48:21Z` | `ce13d764f90b…` | `orangevps` (B) |
| `2026-10-20T10:03:31Z` | `ce13d764f90b…` | `instance-20221019-1509` (C) |

finding 立案 `ts = 2026-10-20T09:39:28.017Z` ⇒ **两条新记录的 ts 都晚于它**；且
`--delivery-face-distance --from ce13d764f90b --tip develop` ⇒ **distance=0**（新证据就是 develop tip）。

### ④ 处置后读数（同一谓词、同一载体）

`.quay/goal-freshness-margin.json`（`at=2026-10-20T10:18:11Z`）逐字：

```
"GOAL-009-AC-232": {"K":200,"d":0,"evidence_age_hours":0.24,"evidence_ts":"2026-10-20T10:03:31Z","margin":200}
"producer_latest_ts": "2026-10-20T10:03:31Z"
```

**对照面（⛔ 反方向读数，用于排除「整个快照被重置」这一解释）**：同一快照里 `GOAL-009-AC-205` 仍为
`d=173 / margin 27`（其产出者 `session-delivery` 有自身前置），`GOAL-009-AC-238` 仍为 `d=135 / margin 65`
（另一条产出者 `upgrade-face`）。⇒ 快照只对 `coldstart-face` 覆盖的主体前进了，**AC-232 的 `0/200` 是本次运行带来的**。

### ⑤ 为什么本轮没有为 AC-232 再跑一次产出者（⛔ 不是省略，给出判据）

1. 判据本体（④）已取到 `d=0 / margin=200`；再跑一遍只会给载体追加同 `build_sha` 的**重复**记录，不改变任何读数
   （硬规则 4 推论三：判据读的是生产载体，不是运行次数）。
2. finding 的 Requested action 目标是【刷新该主体的证据】；该目标已由 ② 的同一次运行达成，而 AC-232 明确是它的覆盖主体。
3. 重复跑要再动两台远端主机约 30 分钟，并稀释 `.quay/productization-verification.jsonl` 的可读性。
   ⇒ 本轮**不重复执行**；若后续再变陈旧，下一次例行立案会照常触发（freshness-refresh 例程仍在）。

### ⑥ ⛔ 本任务未改 `plugin/freshness-producers.json`（该文件虽在 Touches 内），逐条说明

本轮复核没有发现该文件对 AC-232 有任何失真：

- **`command`**：与 ② 那次运行实际使用的命令一致（含 `--driving-profiles <target-recognized>` 位）。
- **`subjects`**：`coldstart-face.subjects` 逐字含 `GOAL-009-AC-232`，⛔ 无归属缺口。
- **`preconditions[0]`（finding 引用的 `:148`）**：说的正是「必须给目标主机网关认得的 profile」；这次运行满足它并成功
  ⇒ 现状正确，⛔ 无新前置可登记。
- **`wallclock_hours: 0.34`**：该量是**全局阈值输入**（`THRESHOLD=(W+I)×R/K`），改动会同时移动七个主体的立案点；
  本任务没有取到「它现在为假」的判据（同类样本跨 16.2–35.5 分钟）⇒ ⛔ 不做单源改动（硬规则 12）。

### ⑦ 附：本轮观察到、但不在本任务 Touches 内、因而未处置的一条

同一轮 finding 把**同一条** `coldstart-face` 命令立成了三条可派发任务（`ac-203 / ac-207 / ac-232`），
三者一次运行即可全部覆盖 ⇒ AC-232 的处置天然是「随 AC-203 那次运行一起完成」。
去重/限流逻辑在 `plugin/scripts/probe-routine.ts` / `routine-file-gate.ts`，⛔ 不在 Touches 内，记录不处置。

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-232.md`