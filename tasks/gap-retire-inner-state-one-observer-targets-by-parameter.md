---
id: gap-retire-inner-state-one-observer-targets-by-parameter
title: "Retire inner-state.sh — its one irreplaceable signal never fired in three projects, including the night we hit exactly what it was for"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

人问 `inner-state.sh` 还有没有用，管理者查完的结论是**没有**。**三条证据，第一条最硬。**

### 一、它的招牌信号从来没响过

`.quay/inner-blocked.json` 在 **quay、archguard、meta-cc 三个项目里全部从未产生**——
而那是它**唯一不可替代**的东西：**内层主动声明「我卡住了」的显式信道**。

**更要命的是**：管理者今晚查到过一次**内层等外层批准卡了 68 分钟**的真实事故，
**那次也没有写这个文件**。

**⇒ 机制存在、从未生效，而且我们已经撞上过它本该拦下的那一次。**

（外层补一句第一人称的记录：**那 68 分钟里的外层就是我**。
我在 17:42 与 18:16 两次读到「1 个提交、0 脏、50 分钟前」，两次判为正常推进——
**而 80 分钟前我刚诊断过同样的形状**。）

### 二、它不观测会话

`tmux` 命中数 **0**。人已裁定：**观测只有一个工具，就是 `session-liveness.sh`**——
管理者看三个 outer、每个 outer 看自己的 inner，**四个挂载全靠参数，已经在跑**。

### 三、其余信号本来就看得见

`TASKS` / `MAJOR` / `MINOR` / `REVERT` / `MASSDELETE` **全来自 `git log`**，
而**外层的工作目录就是那个仓库，它自己就能看**。

### 不要直接删：它缠进 27 个文件，四处要害

| 要害 | 现状 |
|---|---|
| `monitor-mount-check.sh` | 把「它挂没挂」当成**冷启动六键之一** |
| `quay-init.sh` 的 `LOOP_SCRIPTS` | 把它**铺进每个目标项目** |
| cold-start `SKILL.md` | 明写**挂两个监视器** |
| `session-liveness.test.mjs:811` | 断言 **tick 文档同时提到两者** |

## Contract

```
measure observer_mounts = `ps -eo args | grep -c '[s]ession-liveness.sh'` 的挂载进程数字段
measure inner_state_mounts = `ps -eo args | grep -c '[i]nner-state.sh'` 的挂载进程数字段
measure residual_refs = `git grep -l inner-state -- . | wc -l` 的残留引用文件数字段
band inner_state_mounts = 0
invariant 观测只有一个工具，目标靠参数给；退役不得让任何一类信号静默消失
invoke `bash plugin/scripts/monitor-mount-check.sh --json`
control 退役后六键仍能判定冷启动是否完成；每一类原有信号要么有新路径要么被明确记录为不再报
resume 先改判据与文档，再摘 LOOP_SCRIPTS，最后删脚本并停挂载
```

## Chosen mechanism

**按管理者建议的次序，不可颠倒**（先让依赖它的东西不再依赖，再删）：

1. **先改判据与文档**：六键从「两个监视器」收成**一个**；
   `SKILL.md` 与 tick 文档同步；`session-liveness.test.mjs:811` 的断言跟着改。
2. **再从 `LOOP_SCRIPTS` 摘掉**（不再铺进新目标项目）。
3. **最后删脚本本身**，并**停掉三个现存挂载**。

**收口判据（规格 AC3）**：观测挂载数 = 观察者数 = **4**；`inner-state` 挂载数 = **0**。

**不做**：**不与 `inner-blocked-signal.ts` 的处置混在一起**——
那是[[gap-the-blocked-channel-has-a-writer-nobody-calls]]，**两者处置相反**
（本条是清理一个从没生效的**观测工具**；那条是一个**真实需求配了没人调用的实现**）；
不把它的 git 信号打包搬进 `session-liveness.sh`（**观测工具不背仓库告警**）；
不因为「留着也不碍事」而保留——**一个没有观察者的挂载仍然消耗轮询、仍被六键计数**。

## Acceptance Criteria

- [ ] AC1: **六键收成一个监视器**——`monitor-mount-check` 不再把 `inner-state` 挂载当成通过条件；
      **负控制：六键仍能判出「冷启动未完成」**（人为不挂 `session-liveness` ⇒ 必须判不通过）
- [ ] AC2: `SKILL.md` 与 tick 文档同步为**一个监视器**；`session-liveness.test.mjs:811` 断言跟着改
- [ ] AC3: 从 `LOOP_SCRIPTS` 摘掉，**新目标项目不再收到它**（实跑输出贴任务体）
- [ ] AC4: 删除脚本并**停掉三个现存挂载**；`residual_refs` 归零或逐个说明为何保留（**27 个文件逐个处置**）
- [ ] AC5: **可判的收口**——`observer_mounts == 4` 且 `inner_state_mounts == 0`（改动前后都实测贴出）
- [ ] AC6: **反向负控制（信号不得静默消失）**——原有每一类信号
      （`BLOCKED`/`UNBLOCKED`/`TASKS`/`MAJOR`/`MINOR`/`REVERT`/`MASSDELETE`）
      **逐类给出去向**：有新路径、或**明确记录为「已决定不再报」及理由**。
      **这条不过，AC4 不算数**——**退役一个工具最容易的失败方式，是它的信号一起消失而没人注意**
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1 的负控制与 AC5 的前后数字都贴进任务体
- [ ] AC6 的信号去向清单**逐类**贴出（**不得只写「已迁移」**）
- [ ] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）
- [ ] 任务体记录：**它的招牌信号在三个项目里从未产生，且我们已经撞上过它本该拦下的那一次**——
      **「机制存在」与「机制生效」之间隔着一次真实事故，而那次事故已经发生过了**

## Touches

- plugin/scripts/inner-state.sh
- plugin/scripts/monitor-mount-check.sh
- plugin/scripts/quay-init.sh
- plugin/test/session-liveness.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-04T00:40:00Z
changed: **本文件是重写**——上一版 `gap-observers-are-split-by-layer-not-by-surface`
（外层 00:25Z 写的「会话面 vs 工作区面，两个面都正当」）**被人推翻**，
文件名与 id 一并更改，**因为旧 id 本身在固化那个错误框架**。
**外层的自陈不打折**：外层当时**逐项复核了全部数字并全部对上**
（714/136 行、`tmux` 0 次、`INNER_STATE_WORK_ROOT` 是测试接缝），**然后照单采纳了推论**。
**⇒ 核的是测量，没核推论。一个被验证过的测量，不会让长在它上面的结论也变得被验证过。**
**管理者给的一般形态原样保留**：**同一份测量既能推出「退役它」，也能推出「它是另一类」——
后者听起来更周全，而且不用动任何东西，这正是它危险的地方。**
**次序照管理者的建议落地**（先改判据与文档、再摘 `LOOP_SCRIPTS`、最后删脚本与停挂载），
理由是它缠进 **27 个文件、四处要害**，直接删会让六键与冷启动文档同时失真。
**AC6 是外层新增的真判据**：退役最容易的失败方式是信号一起消失而没人注意，
**要求逐类给出去向，不得只写「已迁移」**。
**AC1 的负控制同样是外层加的**：六键少一个条件之后，**必须仍能判出「冷启动未完成」**——
否则这次退役就把一个判据改成了一句永远为真的话。
**明确与 [[gap-the-blocked-channel-has-a-writer-nobody-calls]] 分开**：两者处置相反。
