---
id: gap-token-status-reports-a-dead-holder-as-busy
title: heavy-op-token --status says a project holds the token when its process
  is dead — staleness is only evaluated on acquire
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## 规模更正（管理者裁定，2026-08-03 20:55Z）——本任务是对的，但比原稿小得多

原稿把受众写成「程序」，暗示有代码路径因 `--status` 的不诚实而卡住。**实测不成立**：
管理者查过 `--status` 的全部调用点——**测试、文档、和一个同名无关工具 `inner-blocked-signal.ts`**；
**已发布代码里真正的等待者只有 `scripts/test.sh` 与 `prepare-admission-check.ts`，两个都走 `--acquire`**，
而 `--acquire` 在条件满足时会当场回收（管理者实测 mtime 292s ⇒ `RECLAIMED reclaim #17`）。

**⇒ 被 `--status` 误导的从来不是程序，是读的人。** 而今晚被误导的正是管理者与外层：
tick 扫描里那句「令牌: archguard pid 死」是唯一的真实受害者。

**规模因此缩小为**：`--status` 做与 `--acquire` **同样的存活判定，但只读、绝不回收**。
不涉及等待策略（那已拆给 [[gap-the-only-token-waiter-refuses-to-wait-at-all]]），
不涉及令牌公平性（无饥饿证据）。

**下面 AC7 的措辞据此更正**：它要防的是**人**照着 `--status` 去等一个不会来的事件，
不是防某个程序被卡住。判据本身不变——**「轮询等不到」这句话仍必须印出来**。

## Proposal

**现场（外层 2026-08-03 17:42Z tick）**：

```
bash plugin/scripts/heavy-op-token.sh --status
  holder=archguard
  pid=2353912
  held_ms=1138616        ← 19 分钟
  stale_reclaims=2

kill -0 2353912   →  进程不存在
/proc/2353912     →  不存在
```

**⇒ 令牌被一个已死进程持有了 19 分钟，而 `--status` 报的是「archguard 持有中」。**

### 陈旧判定只发生在 acquire 路径，不发生在 status 路径

外层今早 09:13Z 复核过 acquire 路径的安全属性，它是对的：
**两条条件（mtime 陈旧 **且** pid 不存活）同时成立才回收，且消息把两条的值都打出来**。
15:42Z 外层实测过一次真实回收，消息为
`RECLAIMED stale token (mtime 450s old, pid ... not alive) — reclaim #2`。

**但 `--status` 不做这件事**：它只读文件字段并原样打印，
**不检查 pid 是否存活**，于是「活着的持有者」与「一具尸体」在输出上完全同形。

### 为什么这条重要：`--status` 正是仲裁时被读的那个

管理者今天多次用 `--status` 判断跨项目资源状态（决定谁能跑重活、要不要等）。
**一个把死进程报成忙的输出，会让仲裁者以为邻居在跑重活而主动让路**——
**而实际上没有人在跑，槽位白白空着**。

**并且它与本仓数了十一次的那一族同形**：输出技术上正确（文件里确实写着 archguard），
**但它声称的东西（有人在持有）与它测的东西（文件里有一行）不是一回事**。

**懒回收本身没问题**（下一个 acquire 会正确回收，外层 15:42Z 亲自验证过），
**要修的是 `--status` 的诚实性**，不是回收时机。

## Contract

```
measure status_holder = `bash plugin/scripts/heavy-op-token.sh --status` 输出的 holder 字段
measure holder_alive = `bash plugin/scripts/heavy-op-token.sh --status` 输出中新增的持有者存活布尔字段
band holder_alive = 与 `kill -0 <pid>` 的实际结果一致
invariant status 只读不写（不得在 status 路径回收，那会让读操作产生副作用）
invoke `bash plugin/scripts/heavy-op-token.sh --status`
control 持有者进程存活 ⇒ 报 alive；kill 掉它 ⇒ 同一命令必须报 stale/dead 且不改变令牌文件
resume 单点改动，无阶段
```

## Chosen mechanism

**`--status` 增加持有者存活判定并如实打印，不改变回收时机。**

1. `--status` 对 `pid` 做 `kill -0`，输出 `holder_alive=yes|no`；
   若 `no`，同时打印它按 acquire 的判据会不会被回收（mtime 是否也已陈旧），
   **让读者一眼看出「下一个 acquire 会拿到它」还是「它还在保护期内」**。
2. **`--status` 必须保持只读**——**不得顺手回收**。
   观察命令改变被观察对象是本仓明文禁止的（`fast-mode-telemetry --report` 那次死锁的教训）。
3. 文案给出下一步：死持有者 ⇒ 「下一个 acquire 会自动回收，无需人工干预」。

**不做**：不改回收条件（两条件同时成立才回收，那条是刻意的安全属性）；
不让 `--status` 有副作用；不引入心跳或看门狗（懒回收已被实测证明够用）。

## Acceptance Criteria

- [ ] AC1: `--status` 输出持有者存活状态，与 `kill -0 <pid>` 一致
- [ ] AC2: **负控制（活）**——持有者进程存活时报 alive（实跑输出贴任务体）
- [ ] AC3: **负控制（死）**——kill 掉持有者后，同一命令报 dead/stale（实跑输出贴任务体）
- [ ] AC4: **只读负控制**——AC3 跑完后令牌文件**未被修改**（比对 mtime 与内容），
      `--status` 不得产生副作用
- [ ] AC5: 死持有者时，输出还要说明「按 acquire 判据是否已可回收」，并给出下一步文案
- [ ] AC6: 测试用 `node:test` 且带 `// @test-group governance`，扩进 `plugin/test/heavy-op-token.test.mjs`
- [ ] AC7: **`--status` 必须说明「等待是无效策略」**——死持有者时输出要点明
      **回收是拉取式的（只在 `--acquire` 那一刻发生），轮询 `--status` 等它变空闲永远等不到**，
      并直接给出该跑的那条 `--acquire` 命令。
      **负控制**：造一个死持有者 + mtime 超时的令牌，连续调 `--status` N 次
      ⇒ 输出**始终**是持有中（证明轮询确实等不到），随后一次 `--acquire` ⇒ 立刻成功（实跑两段都贴）

## 活体事故（续，19:47Z）——同一事故的第二跳，比第一跳更硬

外层解开第一跳后，内层改用 **Monitor 轮询 token 变空闲**。**那个事件永远不会来**：

**回收是拉取式的——只发生在有人调 `--acquire` 的那一刻。死持有者不会释放，
于是 `--status` 会永远显示 `holder=<别人>`，任何轮询者都被无限期困住。**

实测（19:47Z）：持有者已换成**另一个死 pid** 2917738（`stale_reclaims` 7→9，说明回收确在发生，
但只在别人 acquire 时），mtime 时龄 380s > 30s ⇒ **两个条件仍满足、仍无人回收**。

**⇒ 真正的缺陷不止「`--status` 不报存活」，而是它把一个「你现在就能拿」的状态，
显示成一个「等着就会好」的状态。** 前者让人多花一次判断，后者让人永远等下去——
本次事故里内层连续两跳都落进了后者。**AC7 是这一跳的判据。**

**懒回收本身仍是对的**（见 DoD），不要改成后台清扫；要改的是它在读侧的呈现。（2026-08-03 19:42Z）——本任务此前只有推理，现在有真实代价

内层的 fan-in 需要绿套件，套件需要 heavy-op token。`--status` 报：

```
holder=archguard
pid=2898949
held_ms=368859
stale_reclaims=7
```

外层实测三个量：

| 量 | 实测 | 回收判据 |
|---|---|---|
| `/home/yale/.quay-global/heavy-op/token` mtime 时龄 | **405s** | `> HEAVY_OP_STALE_TIMEOUT_S=30` ✔ |
| `/proc/2898949` | **不存在**（持有者已死） | pid 不活 ✔ |

**⇒ 脚本自己的两个回收条件此刻都已满足，任何一次前台 `--acquire` 都会立刻收回。**
而 `--status` 只印 `holder=archguard`，**对「pid 已死、此刻可回收」只字不提。**

**代价（这是本任务的真实分母）**：内层读 `--status` 得出「忙，得等」，把等待包成后台任务；
后台任务被 kill，于是它**转去二分「后台任务能活多久」**（T0/T90/T150/T210/T270 分段报时）——
**约 20 分钟的偏离路径取证，fan-in 三个任务同时停摆**，直到外层量出 mtime 与 pid 才解开。

**这条事故把 AC5 从「锦上添花」提为主判据**：光报 alive/dead 还不够，
**必须直接说「按 acquire 判据现在是否已可回收」并给出下一步命令**——
本次内层缺的正是这一句，而它就在脚本自己的判据里，只是没被印出来。
**又一次「存在≠生效」：存活知识在 acquire 路径里是对的，只是没出现在人会去读的那个出口。**

## Definition of Done

- [ ] AC3 与 AC4 的实跑输出贴进任务体——**一个会顺手回收的 `--status`，把读操作变成了写操作**
- [ ] 完整套件连跑 2 次全绿（若只到 1 次，如实标 `[~]` 并写明）
- [ ] 任务体记录：**懒回收是对的、acquire 路径是对的**，本任务只修 `--status` 的诚实性

## Touches

- tasks/gap-token-status-reports-a-dead-holder-as-busy.md
- plugin/scripts/heavy-op-token.sh
- plugin/test/heavy-op-token.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-03T17:45:00Z
changed: 外层 tick 时实测到：令牌 `holder=archguard`、`held_ms=1138616`（19 分钟），
而 `kill -0 2353912` 显示该进程**已不存在**、`/proc` 无该项。
**acquire 路径是对的**（外层 09:13Z 复核过安全属性、15:42Z 实测过一次真实回收，
消息把 mtime 秒数与 pid not alive 两条值都打了出来）；**问题只在 `--status` 不做存活判定**，
于是「活着的持有者」与「一具尸体」在输出上同形。
**这条之所以值得修**：`--status` 正是管理者做跨项目仲裁时读的那个——
**把死进程报成忙，会让仲裁者主动让路给一个不存在的重活**。
**范围钉死两条**：不改回收条件（两条件同时成立是刻意的安全属性）、
**`--status` 必须保持只读**（观察命令改变被观察对象，是 `--report` 那次死锁的教训，AC4 是其负控制）。
