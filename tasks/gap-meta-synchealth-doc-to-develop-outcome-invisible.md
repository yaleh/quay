---
id: gap-meta-synchealth-doc-to-develop-outcome-invisible
title: syncHealth/readingsDigest 无法区分「doc→develop 被拒」与「同步健康」——阻塞态进不了摘要，语义半永不被唤醒
status: ready
labels:
  - meta-driver
parent: null
children: []
extra: {}
---
## Proposal
`meta-driver` 的两类同步结局在读数上不可区分：doc→develop 被 `takeDevelopDiscardingDoc` 的守卫拒绝时，每轮只落一条 `doc-develop-sync-bidirectional`（`docToDevelop:"false"`），而 `collectSyncHealth`（`plugin/scripts/meta-driver.ts`）不读这个值，`readingsDigest`（同文件）只取 `lastEvent`。于是「阻塞中」与「健康」在摘要里同形（都是 `sync:doc-develop-sync-bidirectional`），摘要不变 ⇒ 语义半不被唤醒 ⇒ 2026-10-31 那次 30+ 分钟的冻结全程静默（21 条同因拒绝已由消抖收敛为 1 条，见 `tasks/gap-cross-project-dogfood-quay-self-usage-c2-rk5czv.md`）。
人 2026-11-06 裁定（记录在 `tasks/gap-meta-call-author-develop-take-develop-30.md`）：⛔ 不新增通知路径，改为让阻塞态在既有读数里可见，由既有 meta-driver 语义半在阻塞开始/结束时各判读一次。

## Plan
1. `SyncHealth` 增加 `lastDocToDevelop: "ok" | "refused" | "unknown"`（三态，⛔ 不用布尔）：从窗口内最后一条 `doc-develop-sync-bidirectional` 的 `docToDevelop` 派生 —— `true`/`"true"` ⇒ `ok`；`false`/`"false"` ⇒ `refused`；无该事件 / 值非布尔 / 行坏 / 文件读不懂 ⇒ `unknown`（硬规则 3b/6：读不懂不得与 `ok` 同形）。
2. `readingsDigest` 的 sync token 带上该三态（形如 `sync:<lastEvent>:<lastDocToDevelop>`）：阻塞开始与结束时摘要各变一次、阻塞持续期间不变 ⇒ 语义半至多各判读一次，天然消抖。⛔ 不引入计数或时间阈值（硬规则 4 推论一：成本结构未实测前不设阈值）。
3. `plugin/probes/meta-driver.md` 的 `syncHealth` 段补该字段与处置口径：`refused` ⇒ 阻塞成因在共享检出的未提交/会被覆盖状态，属人的领地；「哪个机制拥有它」的判读次序不变。⛔ 不留一个只有代码知道的字段。
4. 单测覆盖：三态派生、digest 正/负两臂、真实生产载体段落复算。

## AC
- [x] 三态派生可区分：临时构造三个目录各自写入 `.quay/doc-develop-sync.jsonl` —— 含 `{"event":"doc-develop-sync-bidirectional","docToDevelop":"true"}` / 含同事件 `docToDevelop:"false"` / 不含该事件，`collectSyncHealth` 的 `lastDocToDevelop` 分别为 `ok` / `refused` / `unknown`（三条同时断言，缺一不算）
- [x] digest 正臂：其余读数完全相同、仅 `lastDocToDevelop` 不同（`ok` vs `refused`）⇒ `readingsDigest` 返回值不同
- [x] digest 负臂（消抖）：同一 `refused` 阻塞再采集一轮（窗口内只多一条同值 `doc-develop-sync-bidirectional`）⇒ `readingsDigest` 返回值相同
- [x] 真实生产载体复算：用 `git worktree list --porcelain | awk 'NR==1{print $2}'` 定位主检出，从其真实 `.quay/doc-develop-sync.jsonl` 抽取 `2026-10-31T09:16`–`09:41` 段落复算 ⇒ `refused`；抽取 `2026-11-06T05:10:13Z` 之后含 `ff-synced` 的段落复算 ⇒ `ok`（输入是真实载体切片，⛔ 不是构造数据）
- [x] 负控制：把派生改成恒返回 `"unknown"`（或把新 token 从 digest 去掉）⇒ 上一条真实载体 AC 与 digest 正臂必须变红；把改前/改后两次读数贴进任务体

## DoD
- [x] 上面 AC 全部实跑通过，且负控制确实让判据变红（判据能取假，⛔ 不以「测试文件存在」或「断言写好了」充当）
- [x] 新读数在真实生产载体上至少复算过一次（真实载体 AC），⛔ 不以单测绿充当生产证据（硬规则 4 推论三）
- [x] `plugin/probes/meta-driver.md` 已描述该字段与处置口径，语义半不需要读代码就知道它意味着什么

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `plugin/probes/meta-driver.md`
- `tasks/gap-meta-synchealth-doc-to-develop-outcome-invisible.md`

## Evidence（AC 实跑记录，2026-11-06，续做轮复算）

工作树：`/data/home/yale/work/quay-worktrees/gap-meta-synchealth-doc-to-develop-outcome-invisible`，分支 `task/gap-meta-synchealth-doc-to-develop-outcome-invisible`。实现提交 `4cce808e7`；本轮先把 `develop` 合并进来（`1f5bea0d2`，唯一冲突 `tasks/<id>.md` 按 per-hunk union 解：保留本分支 AC 勾与 Evidence + 保留 develop 的 Blocker 段），随后**独立复算**下列全部判据（⛔ 不是复述上一轮）。

**AC1（三态派生）** — `node --experimental-strip-types --test --test-name-pattern="lastDocToDevelop" plugin/test/meta-driver.test.mjs`：
```
✔ collectSyncHealth: lastDocToDevelop 三态派生 —— ok / refused / unknown（三条同时断言）
```
同测试另断言：原生布尔 `false` ⇒ `refused`；`undefined/null/1/"yes"` ⇒ `unknown`；坏行在最后一条 bidirectional 之后 ⇒ `unknown`、在之前 ⇒ `ok`（按位置判定）；载体缺失 ⇒ `unknown`；并断言 `refused` 的 `lastEvent` 与健康态**同形**（正是本字段必须存在的理由）。

**AC2（digest 正臂）**：
```
✔ readingsDigest 正臂: lastDocToDevelop ok vs refused ⇒ 摘要不同（阻塞开始/结束各判读一次）
```
前提断言在内：两轮读数 `deepEqual`（除该字段），且字段结构缺失 ⇒ 与 `unknown` 同 token、⛔ 不与 `ok` 同形。

**AC3（digest 负臂 / 消抖）**：
```
✔ readingsDigest 负臂（消抖）: 同一 refused 阻塞再采集一轮（只多一条同值事件）⇒ 摘要相同
```
同测试内正向对照：追加一条 `docToDevelop:"true"` ⇒ 摘要必须变（证明负臂不是恒真）。

**AC4（真实生产载体复算）** — 主检出 `git worktree list --porcelain | awk 'NR==1{print $2}'` = `/data/home/yale/work/quay`；其真实 `.quay/doc-develop-sync.jsonl` 复算时 **12212 行**（上一轮 12066 行，载体在增长）。按 ts 窗口切片写入临时目录后调生产函数 `collectSyncHealth`：
```
{"label":"blocked-20261031","sliceLines":129,"bidirectionalEvents":21,"lastBidirectionalTs":"2026-10-31T09:41:12.337Z","lastBidirectionalDocToDevelop":"false","ffSyncedInSlice":0,"collectSyncHealth.lastDocToDevelop":"refused","collectSyncHealth.lastEvent":"doc-develop-sync-semantic"}
{"label":"healthy-20261106","sliceLines":155,"bidirectionalEvents":59,"lastBidirectionalTs":"2026-11-06T14:02:55.604Z","lastBidirectionalDocToDevelop":"true","ffSyncedInSlice":7,"collectSyncHealth.lastDocToDevelop":"ok","collectSyncHealth.lastEvent":"doc-develop-sync-bidirectional"}
```

**改前/改后两次读数（同一份固定读数，只把 `syncHealth` 换成真实载体切片；摘要由 `readingsDigest` 实算）**：
| 真实载体切片 | lastEvent | lastDocToDevelop | 改前 digest（token 只有 lastEvent） | 改后 digest（带三态） |
|---|---|---|---|---|
| 阻塞前 `2026-10-31T06:00–09:15:59` | `doc-develop-sync-bidirectional` | `ok` | `e32371a6970c67f2` | `fb5265052280cc79` |
| 阻塞中 `2026-10-31T09:16:00–09:16:36` | `doc-develop-sync-bidirectional` | `refused` | `e32371a6970c67f2` | `67f23da4324b5f1c` |
| 健康 `2026-11-06T05:10:13Z–14:59:59` | `doc-develop-sync-bidirectional` | `ok` | `e32371a6970c67f2` | `fb5265052280cc79` |

⇒ 改前**阻塞开始前后摘要逐字相同**（`e32371a6970c67f2`——这就是 2026-10-31 那 30 分钟静默的机制）；改后阻塞开始变一次（`fb52…` → `67f2…`）、阻塞持续不变、健康态回到与阻塞前相同的 token。

**AC5（负控制，本轮两次实跑）**：
1. 把派生改成恒 `"unknown"`（改的是真实源文件，跑完 `git checkout --` 复原并核对 md5 `13b56a4b94616a852155a27ca9443694` 与改前一致）：
   - `✖ collectSyncHealth: lastDocToDevelop 三态派生` — `AssertionError: docToDevelop:"true" ⇒ ok / actual: 'unknown', expected: 'ok'`（`ℹ pass 1 / fail 2`）
   - `✖ readingsDigest 负臂（消抖）` — `actual: 'unknown', expected: 'refused'`
   - 真实载体复算两段同时变红：`blocked-20261031 ⇒ "unknown"`、`healthy-20261106 ⇒ "unknown"`（即 AC4 的两条判据取不到假是不可能的——改坏它当场红）。
2. 把新 token 从 digest 去掉：
   - `✖ readingsDigest 正臂` — `doc→develop 从 ok 变 refused（阻塞开始）必须改变摘要`：`actual: 'f64e379f3d29920c', expected: 'f64e379f3d29920c'`（两者相等 ⇒ 正臂红）
   - `✖ readingsDigest 负臂（消抖）` — `阻塞结束 ⇒ 摘要必须变`：`actual: 'e32371a6970c67f2', expected: 'e32371a6970c67f2'`
   - 同一次运行里 AC1 仍绿（`✔ 三态派生`），证明两条负控制各自只打中它该打中的那半。
   - 真实切片摘要同时退化为三行同值 `e32371a6970c67f2`（见上表「改前」列）。

**回归**：`node --experimental-strip-types --test plugin/test/meta-driver.test.mjs` ⇒ `ℹ tests 149 / pass 149 / fail 0`（合并 develop 之后重跑）。

## ADR-007 暗轴记录

- 该轴仍暗,理由:本任务只在既有的 `meta-driver` 读数聚合面上加一个三态字段（无新模块、无新包依赖、无并发/资源行为变更），L_D/L_G 结构量按构造不变，故未单跑 archguard；`fan-in-ts-typecheck-gate` 对 `develop...HEAD` 判 ADMITTED。

## Blocker

**2026-11-06T06:40:16.485Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=merge-develop: exit null
- run_id：wk-prod-anchor


2026-11-06 人工暂停（宿主降载期间）：本机 128 vCPU 被 quay 套件并发与 esbuild 子进程打满（loadavg 103→485，88 次 cgroup OOM）。本任务每次落地都要跑一整轮全量 suite（约 20 分钟、峰值 60+ 核），而它属于重复代码清理，**不是**当前的降载工作。恢复条件：gap-process-budget-in-use-undercounts-real-test-load 与 gap-anchor-polling-git-fork-storm 落地、宿主 loadavg 稳定低于核数后，把 status 改回 ready 重派。

2026-11-06 人工暂停（宿主降载期间，第 2 次挂起）：上一轮挂 needs-human 后被在飞 worker 的 task_write 覆盖回 ready（17:28:47 的 todo→ready 提交）。本任务属 doc/sync 语义修复，每次落地要跑一整轮全量 suite，不是当前降载工作。恢复条件：gap-process-budget-in-use-undercounts-real-test-load 与 gap-anchor-polling-git-fork-storm 落地、宿主 loadavg 稳定低于核数后改回 ready。

2026-11-06 人工暂停（第 3 次）：前两次都被在飞 worker 的 task_write 覆盖（17:34:24 cli:2771566 写回 todo，17:35:28 promotion-driver 随即 todo→ready）。本次挂起时该任务已无在飞 worker。恢复条件：宿主降载任务落地后改回 ready。