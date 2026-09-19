---
id: gap-routine-freshness-refresh-stale-upgrade-face-goal-009-ac-238
title: "freshness-refresh: AC-238 evidence sits at d=172 of K=200 (margin 28)
  and the measured worst-hour advance rate (25 commits/h) can consume 59.5
  commits during the producer's (W+I)=2"
status: done
labels:
  - gap
  - routine-filed
  - freshness-refresh
parent: null
children: []
extra: {}
---
## Finding
AC-238 evidence sits at d=172 of K=200 (margin 28) and the measured worst-hour advance rate (25 commits/h) can consume 59.5 commits during the producer's (W+I)=2.38h window — more than twice the remaining margin.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1789815175705` · ts `2026-09-19T10:52:55.705Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`upgrade-face`、`GOAL-009-AC-238`、`develop-deliver-tgz.sh --verify-upgrade`
- 涉及文件：
- `plugin/freshness-producers.json:65`
- `plugin/freshness-producers.json:76`
- `.quay/goal-freshness-margin.json:1`
- `plugin/scripts/develop-deliver-tgz.sh:1`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
Re-run upgrade-face on host B — but first free disk on host B (root fs 100% full, measured 2026-09-19T06:10:14Z; the ⑦ cp -a leg dies on ENOSPC and appends zero records).

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `stale-upgrade-face-goal-009-ac-238`（routine `freshness-refresh`，runId `freshness-refresh-1789815175705`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**处置结论 = 【修掉】。⛔ 不是「已注意到」—— 证据真的刷新了：`d` 179 → 7（margin 21 → 193）。**

### ① finding 复核为真，且比立案时**更差**（判据本体独立重跑，⛔ 不采信 finding 自报值）

判据 = `goals/AC-214-交付证据必须新鲜-*.md` 的 `criterion`（探针读的正是它写出的 `.quay/goal-freshness-margin.json`）。交付面路径集按判据**同一规则机械推导**（`packages/quay/package.json` 的 `files` + `plugin` + `packages/quay-native/src`，⛔ 不手写清单）：

| 量 | finding 自报（10:52Z） | 本任务独立重算 |
|---|---|---|
| 最新 AC-238 证据 build_sha / ts | — | `b29affe9` @ `2026-09-17T06:40:51Z` |
| `d`（该 sha → develop tip，交付面） | 172 | **175 → 179**（本任务期间 develop 又前进 4 提交） |
| margin / K / fraction | 28 / 200 / 0.14 | **21 / 200 / 0.105** |
| 阈值 `(W+I)·R/K` | — | 0.2975（W=0.38 实测 / I=2 / R=25 最坏单小时桶） |

⇒ finding 成立且**正在恶化**（margin 28 → 25 → 21）。

### ② 阻塞前提已消失（直接量，⛔ 不是推断）

```
2026-09-19T06:10:14Z（失败那次）  /dev/sda1   96G   96G  4.1M  100%   ← 记录在案的阻塞
2026-09-19T11:18:16Z（本次实测）  /dev/sda1   96G   90G  6.7G   94%   ← ssh orangevps 'df -h /'
复现读数：ssh orangevps 'df -h /'      （inode 17% ⇒ 是【字节】不是 inode，与记录一致）
```
需要量：aged source `du -sb` = `735354088` 字节（**749M**）+ npm 前缀 ⇒ 7.16G 余量 ≈ **9×** 需求。
⇒ `plugin/freshness-producers.json` 的 `preconditions` 自己写的那句「空间清出来后本前置自动消失」**当场成立**。

### ③ 处置动作：补救**已在飞** —— 本任务**刻意不重跑**（本轮的关键判断）

机械核对 —— 正是上一轮 Evidence §② 指出「与产出者运行日志之间**没有任何机械核对**」的那一项；这次做了，且**结果方向与上次相反**（上次 0 条 ⇒ 重跑有意义；这次非 0）：

```
$ ps -o pid,ppid,lstart,cmd -p 3004698,3099341
3004698 3004693  Sat Sep 19 11:04:36 2026  bash plugin/scripts/develop-deliver-tgz.sh \
     --verify-upgrade --upgrade-source work/meta-cc-aged-ac238-copy --ac239-e2e --hosts B --force --root /home/yale/work/quay
3099341 3004698  Sat Sep 19 11:06:08 2026  （同一条命令行 —— PPID 3004698 ⇒ 父/子，**一次运行**，⛔ 不是两次）
```
发起方 = **兄弟任务 `gap-routine-freshness-refresh-stale-upgrade-face-goal-009-ac-239` 的派发链**（其 worker 日志 `/tmp/ac239-producer.log`），命令行 = mapping `upgrade-face.command` **逐字**（⛔ 未改任何参数）。

**⛔ 不重跑的判据（能取假）**：两次运行都 `--root /home/yale/work/quay`，而远端 ⑦ 是**先 `rm -rf "$root"` 再 `cp -a`**（`plugin/scripts/verify-deliver-coldstart.sh:1397` / `:1399`），`$root` 由 tip 机械派生（`quay-verify-upgrade-<tip8>-root`）。⇒ 并发的第二次运行会**删掉在飞那次正在往里拷的树**，并争用同一份 evidence 与 `deliver-worktree-<sha>` 路径 ⇒ 重跑在这里**不是「零边际收益」，是负的**。兄弟 finding 自己已写明「both records are written as an UPGRADE-PAIR on one run」⇒ 一次运行同时覆盖两个主体。

### ④ 结果：那次运行**成功**，AC-238 证据已刷新

读数取自远端 log `.quay/verify-upgrade-remote-B-fa1cae20.log`（⛔ 非本地自报）：

| 量 | 失败那次（tip 097fe2d7） | 本次（tip fa1cae20） |
|---|---|---|
| ⑦ `cp -a` leg | ✗ `No space left on device` × **12** | ✓ `isolated copy: /home/yale/work/meta-cc-aged-ac238-copy -> /home/yale/quay-verify-upgrade-fa1cae20-root`；ENOSPC 计数 **0** |
| `AC238_EVALUATED` | 0（未评估 ≠ 不合格） | **1** |
| `VERIFY-RC` | 1 | **0** |
| 载体 | `EVIDENCE-ABSENT`、**零追加** | `EVIDENCE-TRANSPORT appended=4`、268 → **272** 行、md5 `c5a0939f…` → `a7780318…` |
| `UPGRADE-PAIR` | — | **OK**（AC-238/239 同一 `project_root`） |

AC-238 四条直接量：`PRE/POST_TASK_COUNT=103/103`、`TASKSET_STABLE=1`、`RUNTIME_REPLACED=1`、`RETIRED_MATCHES_PRE=1`、`runtime_age=29.504d`。

**处置结论可核（一条命令）**：
```
$ python3 -c "<判据同一路径规则> ; git rev-list --count <sha>..develop -- <paths>"
BEFORE  b29affe9 : d = 179   margin = 21     fraction 0.105
AFTER   fa1cae202: d = 7     margin = 193    fraction 0.035
```
⇒ 新 fraction **0.035 ≪ 阈值 0.2975** ⇒ 探针按自己的规格**不再立案**。载体落在主检出 `.quay/productization-verification.jsonl`（gitignored，**正是探针读取的那一份**，⛔ 不是本任务 worktree 里的那份陈旧副本）。

### ⑤ 本任务**未**做的事（⛔ 逐条，不以沉默代替）

- ⛔ **未自己重跑产出者** —— 理由见 ③：在飞 ⇒ 重跑会破坏那次运行。
- ⛔ **未在 host B 上删任何文件**（清盘是目标机运维动作、需人授权；本次也**不需要** —— 余量已够）。
- ⛔ 未改 `plugin/freshness-producers.json`、未改 `develop-deliver-tgz.sh`、未改 `goals/`、未改 K/`criterion`/`expect`、未改探针及其阈值、未改 develop。
  **为什么 `preconditions` 不补一条「已清盘」**：该字段的设计是「环境要求 + **带观测日期**的实测读数」，其正文已逐字要求「引用本条目必须连同观测日期一起引」，并已写明「空间清出后本前置自动消失」⇒ 它**本来就是一条会过期的状态读数**；补第二次读数既非该字段职责，也会稀释「哪一条才是要求」的可读性。本次复核读数记在本 Evidence 里。
- ⛔ 未把任务置 `needs-human`。

### ⑥ 观察项（⛔ 无发生率读数者不升为前置 —— 硬规则 12）

1. **本主体已第三次走「立案 → 派发 → 跑产出者」全程**（09-17、09-19 上午两次）。证据老化是持续的：本次 margin 从 28 → 21 只用 ~30 分钟（develop 前进 4 提交）。⚠️ 未测「探针立案 → 派发 → 跑完」的端到端时延是否总小于 `W+I` ⇒ **只报读数、⛔ 不报因果**。
2. **AC-238/239 是同一次运行产出的配对记录，却在立案时被 rate 闸拆成两个任务** ⇒ 处置面天然重复（本轮即「一份产物、两处结论」）。发生率 2/2。⚠️ 未测 rate 闸窗口参数 ⇒ 不立前置。

## Touches
- `plugin/freshness-producers.json`
- `plugin/scripts/develop-deliver-tgz.sh`
- `tasks/gap-routine-freshness-refresh-stale-upgrade-face-goal-009-ac-238.md`
