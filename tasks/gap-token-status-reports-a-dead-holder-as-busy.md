---
id: gap-token-status-reports-a-dead-holder-as-busy
title: "heavy-op-token --status says a project holds the token when its process is dead — staleness is only evaluated on acquire"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

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

## Definition of Done

- [ ] AC3 与 AC4 的实跑输出贴进任务体——**一个会顺手回收的 `--status`，把读操作变成了写操作**
- [ ] 完整套件连跑 2 次全绿（若只到 1 次，如实标 `[~]` 并写明）
- [ ] 任务体记录：**懒回收是对的、acquire 路径是对的**，本任务只修 `--status` 的诚实性

## Touches

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
