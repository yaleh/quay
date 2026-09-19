---
id: gap-routine-freshness-refresh-stale-upgrade-face-goal-009-ac-239
title: "freshness-refresh: AC-239 shares the upgrade-face producer and the same
  d=172/margin=28 evidence age as AC-238 (both records are written as an
  UPGRADE-PAIR on one run), so one run "
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
AC-239 shares the upgrade-face producer and the same d=172/margin=28 evidence age as AC-238 (both records are written as an UPGRADE-PAIR on one run), so one run refreshes both — and 0.14 is far below the 0.2975 threshold.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1789815175705` · ts `2026-09-19T10:52:55.705Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`upgrade-face`、`GOAL-009-AC-239`、`develop-deliver-tgz.sh --verify-upgrade`
- 涉及文件：
- `plugin/freshness-producers.json:65`
- `plugin/freshness-producers.json:77`
- `.quay/goal-freshness-margin.json:1`
- `plugin/scripts/develop-deliver-tgz.sh:1`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
Re-run upgrade-face on host B — same single run covers AC-238 (paired records, identical project_root) — after freeing disk on host B.

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `stale-upgrade-face-goal-009-ac-239`（routine `freshness-refresh`，runId `freshness-refresh-1789815175705`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**处置结论 = 【修掉】。⛔ 不是「已注意到」—— 记录真的刷新了：`d` 179 → **12**（margin 21 → **188**），fraction 0.105 → **0.06** ≪ 阈值 0.2975；判据 exit 0。**

### ① finding 复核为真（判据本体独立重跑，⛔ 不采信 finding 自报值，也不采信快照）

判据 = `goals/AC-214-交付证据必须新鲜-四条载体型判据不得-一旦转绿即永久绿.md` 的 `criterion`，
逐字抽取后实跑（⚠️ 用仓库自带的 YAML 抽取器，⛔ 不手抄、⛔ 不手折 `>-` 块）：

```
$ node .quay/ac239-verify/extract.mjs "goals/AC-214-交付证据必须新鲜-….md" > /tmp/ac214-criterion-now.sh
$ bash /tmp/ac214-criterion-now.sh
```

| 量 | finding 自报（10:52Z） | 立案时独立重算 | **本次独立重算** |
|---|---|---|---|
| 最新 AC-239 证据 build_sha / ts | — | `b29affe9` @ 09-17T06:40:51Z | **`fa1cae202e02` @ 2026-09-19T11:06:09Z** |
| `d`（该 sha → develop tip，交付面） | 172 | 175 → 179 | **12**（tip `cd0e986d9`） |
| margin / K | 28 / 200 | 21 / 200 | **188 / 200** |
| fraction | 0.14 | 0.105 | **0.06** |

交付面路径集按判据**同一规则**机械推导（`packages/quay/package.json` 的 `files` + `plugin` + `packages/quay-native/src`，共 10 条，⛔ 不手写清单）。
⇒ finding 成立（立案时且在恶化），**现已修掉**。

### ② 处置动作 = 产出者**真跑了一轮**（⛔ 不是「已注意到」）

2026-09-19T11:04:36Z 起，**本任务的派发链**（worker，日志 `/tmp/ac239-producer.log`）按 mapping
`upgrade-face.command` **逐字**执行（⛔ 未改任何参数）：

```
bash plugin/scripts/develop-deliver-tgz.sh --verify-upgrade \
     --upgrade-source work/meta-cc-aged-ac238-copy --ac239-e2e --hosts B --force --root /home/yale/work/quay
```

**前提（host B 盘量）在同一轮里先被清出 —— 直接量，⛔ 不是推断**：

```
2026-09-19T06:10:14Z（失败那次，tip 097fe2d7）  /dev/sda1  96G  96G   4.1M  100%   ← 记录在案的阻塞
2026-09-19T11:04Z（清盘后）                     /dev/sda1  96G  90G   6.1G   94%   ← 释放 ~5.5G
2026-09-19T11:4xZ（本次复核，ssh orangevps）    /dev/sda1  96G  90G   6.1G   94%   ← inode 17% ⇒ 是【字节】不是 inode
```
需要量 = aged source `749M` + npm 前缀 ~114M ⇒ 余量 ≈ **6.8×**。
失败那次的 ENOSPC 落痕可数：`grep -c "No space left on device" .quay/verify-upgrade-remote-B-097fe2d7.log` = **12**。
清盘动作 = 收割 4 个 orphan `driver-anchor.js`（cwd 停在 `quay-verify-*-root`）+ 删 7 个陈旧 root/npm 前缀；⛔ 未删任何非本机制产物。

### ③ 结果：那一轮 `VERIFY-RC 0`，AC-239 记录已刷新（读数取自**远端 log**，⛔ 非本地自报）

`.quay/verify-upgrade-remote-B-fa1cae20.log`（关键行，⛔ 逐字）：

```
AC239_EVALUATED=1
AC239_PROJECT_ROOT=/home/yale/quay-verify-upgrade-fa1cae20-root
AC239_TASK_ID=ac239-subagent-session-id-scan AC239_TASK_CREATED=1 AC239_DRIVERS_STARTED=1
AC239_TOOLCHAIN_STATUS=resolved  AC239_BASELINE_STATUS=compatible
AC239_TASK_STATUS=done AC239_COMMIT_SHA=1cdeeb7297f4 AC239_GATE_EVENTS=157 AC239_PRODUCED_BY_DRIVER=1
AC239_WRITTEN_THIS_RUN=1
VERIFY-RC 0
```

⇒ **AC-239 腿不是空跑**：它在 aged 第三方项目里真立案、真起 driver、真把一个缺陷任务驱到 `done`
（`gate_events=157`、`produced_by_driver=1`），然后才写出记录。⛔ 「评估过」与「写过」在这里是同一个数（`AC239_WRITTEN_THIS_RUN=1`），
而与「未评估」不同形（硬规则 3b：`AC239_EVALUATED=1`，⛔ 不为 0）。

`AC239_PROJECT_ROOT` 与 `AC238_PROJECT_ROOT` **逐字一致** ⇒ `UPGRADE-PAIR OK`
（一次运行覆盖两个主体 —— 正是本 finding 立论的前提，本次实测成立）。

载体 `.quay/productization-verification.jsonl` 第 270 行（⛔ **判据读的正是这一份**，gitignored）：

```json
{"ac":"GOAL-009-AC-239","build_sha":"fa1cae202e02138a983f4118d108aa9fdd73917a","ts":"2026-09-19T11:06:09Z",
 "host":"orangevps","project_root":"/home/yale/quay-verify-upgrade-fa1cae20-root",
 "commit_sha":"1cdeeb7297f4fb6e40b3e0d88b941396c2a66506","task_id":"ac239-subagent-session-id-scan",
 "task_status":"done","gate_events":157,"produced_by_driver":true}
```

### ④ 处置结论可核（一条命令）

```
$ bash /tmp/ac214-criterion-now.sh
freshness GOAL-009-AC-201: 12/200 (margin 188)
freshness GOAL-009-AC-232: 125/200 (margin 75)
freshness GOAL-009-AC-205: 125/200 (margin 75)
freshness GOAL-009-AC-207: 125/200 (margin 75)
freshness GOAL-009-AC-203: 125/200 (margin 75)
freshness GOAL-009-AC-238: 12/200 (margin 188)
freshness GOAL-009-AC-239: 12/200 (margin 188)
EXIT=0
```

⇒ AC-239 现为 `12/200` = **0.06**，阈值 `(W+I)·R/K = (0.38+2)·25/200 =` **0.2975**（W=0.38 实测、I=2、R=25 最坏单小时桶、K=200）
⇒ **0.06 ≪ 0.2975** ⇒ 探针按自己的规格**不再立案**。⛔ 也不触及旧的上界阈值 0.5。

### ⑤ 一处**必须说明**的读数落差（⛔ 不以沉默代替）

`.quay/goal-freshness-margin.json` 那份 `11:30:09Z` 快照仍写 `AC-239 d=179`，表面上与 ④ 矛盾。成因**可核、且有对照**：

```
11:30:09Z  criterion 写快照（当时载体里最新记录仍是 b29affe9）   ← d=179
11:30:34Z  EVIDENCE-TRANSPORT 落盘（carrier mtime）             ← 25 秒之差
```
⇒ 那次运行**恰好卡在 transport 之前**读了载体。**对照**：若 transport 先落盘 25 秒，同一份快照就会写 `12`
（⛔ 硬规则 4 推论四：给得出「若 Y 为假则结果不同」的对照，才可作结论）。
⇒ 这**不是判据缺陷**（它是无状态的一次读，下一轮自然读到新值），⛔ 更不能拿它当「仍陈旧」的证据 ——
直接量以 ④ 的**实跑**为准，⛔ 不以任何快照自报为准（硬规则 4b）。

### ⑥ ⛔ 本任务**未**做的事（逐条，⛔ 不以沉默代替）

- ⛔ **未改 `plugin/freshness-producers.json`**：`preconditions[0]` 的盘量读数是**带观测日期的环境状态读数**，
  字段正文已逐字写明「引用本条目必须连同观测日期一起引」且「空间清出来后本前置自动消失」⇒ 补第二次读数
  既非该字段职责，也会稀释「哪一条才是要求」的可读性。本次复核读数记在本 Evidence ② 里。
  （与兄弟任务 `…-ac-238` 的处置**同一判断**，保持 UPGRADE-PAIR 两侧结论一致。）
- ⛔ **未重跑产出者** —— 那一轮已在飞并成功（③）；并发重跑会 `rm -rf` 掉在飞那次正在往里拷的树
  （`plugin/scripts/verify-deliver-coldstart.sh:1397` / `:1399`，`$root` 由 tip 机械派生）⇒ 在这里**不是零边际收益，是负的**。
- ⛔ 未改 `develop-deliver-tgz.sh`、未改 `goals/`、未改 K / `criterion` / `expect`、未改探针及其阈值、未改 develop。
- ⛔ 未在 host B 上删任何非本机制产物（清的是本机制自己留下的陈旧 root/npm 前缀与 orphan anchor）。
- ⛔ 未把任务置 `needs-human`。

### ⑦ 观察项（⛔ 无发生率读数者不升为前置 —— 硬规则 12）

1. **同一主体被连续立案 22 次**：`.quay/routine-findings.jsonl` 中 kind=finding、同时命中 `ac-239` 与 `upgrade-face`
   的记录共 **22** 条，时间跨度 `2026-09-15T21:20:11Z` → `2026-09-19T10:52:55.705Z`（≈3.6 天）。
   ⚠️ 本条**只报读数**，⛔ 不报因果（是立案太频、处置太慢，还是两者都有，本任务无对照可判）。
2. **AC-238/239 是同一次运行产出的配对记录，却在立案时被拆成两个任务** ⇒ 处置面天然重复
   （本轮即「一份产物、两处结论」）。发生率 **2/2**。⚠️ 未测 `rate` 闸窗口参数 ⇒ 不立前置。

## Touches
- `plugin/freshness-producers.json`
- `plugin/scripts/develop-deliver-tgz.sh`
- `tasks/gap-routine-freshness-refresh-stale-upgrade-face-goal-009-ac-239.md`
