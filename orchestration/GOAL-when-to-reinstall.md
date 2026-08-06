# 目标:什么时候重装 quay 并冷启动 archguard 与 meta-cc

**人 2026-08-04 定的形状**:「这台机器的环境就是为了 quay 开发准备的,
archguard 和 meta-cc 也是为了验证 quay 的能力。不要再另外搞两个项目。
判据限制在 quay 项目内,准备好就重装和冷启动。」

⇒ **门槛是 quay 自己套件里的一个 e2e 测试。它绿了,就重装两个项目。**
不做预演项目,不造临时目标——**archguard 和 meta-cc 本来就是验证目标**。

---

## 门槛:quay 套件里的一个 e2e,四条断言

测试自己建两个临时工作区(和现有测试的 `makeWorkspace()` 同一手法,随测试销毁),
一个带 `package.json`、一个带 `go.mod`,**使它们的测试命令真的不同**。

| # | 断言 | 它挡住什么 |
|---|---|---|
| **A1** | 两个工作区落地的文件**互相字节相同**,只有那个配置文件不同 | 文本替换。**一旦成立,替换在结构上就不存在** |
| **A2** | 落地文件**与产物字节相同**;紧接着再装一次,**无任何文件变化** | `CONFLICT ... skip`——升级静默失效 |
| **A3** | 在一个**已有旧版落地**的工作区上升级:所有文件变成新产物,**且既有 `.workflow-events/`、`tick-log.md`、gate 事件仍可读** | 升级抹掉既有度量基线 |
| **A4** | `## Finding` 无 `## Plan` 的任务**能过 author→ready 闸**;含 `## Plan` 的仍走严格契约 | 41 个任务堵死循环 |

**防空过(必须有,否则 A1 可以在两边都没装成的情况下通过)**:
- 两个工作区的配置文件**内容确实不同**(测试命令、会话名、仓库根)
- 落地文件数 **> 0 且等于产物应铺的集合大小**

**A4 单独说一句**:它是唯一能让「装上的是方法论」而不只是「装得上」的那条。
meta-cc 此刻循环活着、cron 在跳、tick 已 4 行,但 **ready 0 / 遥测 0 / 完成任务 0**——
**只证明了装得上。**

---

## 绿了之后:重装两个项目,那两次才是真验证

1. `user scope` 重装(本地 build → 展开到开发树之外 → `marketplace add` → `install`)
2. 在 archguard 和 meta-cc 各跑一次文档化流程
3. **两次都要求人工补丁数 = 0,六键全 true**
4. 各自 **通过闸完成 ≥1 个任务**

**第 3、4 条不放进 e2e**——它们要的是真实项目的复杂度,那正是这两个项目存在的理由。

---

## 必须先关掉的 10 条(2026-08-03 冷启动实测)

| # | 缺陷 | 对应断言 |
|---|---|---|
| 1 | **落地时文本替换**(人裁定:错的、太脏) | A1 |
| 2 | `init` 的 `LOOP_SCRIPTS` 硬编码,不含 cold-start 步骤 3/5 用的两个脚本 | 重装 |
| 3 | `init` 不检测真实 tmux 会话,写猜测值 ⇒ 活着的内层被误报 gone | 重装 |
| 4 | `init` 不铺 `tick-log.md` / `escalations.md`,而 tick 步骤 5/8 假设它们存在 | 重装 |
| 5 | tick 文档内**三套互斥驱动机制**(CronCreate / ScheduleWakeup / `/loop`) | 重装 |
| 6 | 外层 tick 文档引用的 **6 个编排文件全缺** | 重装 |
| 7 | init skill 步骤 3 不传 `--plugin-root` ⇒ fail-closed | 重装 |
| 8 | `monitor-mount-check` 的 `ownedByThisSession` 判据比现实严 | 重装 |
| 9 | **dod 闸拒绝 Finding 模板任务**(meta-cc 41 个,14 个 todo 全堵) | **A4** |
| 10 | `vendor/quay/dist/quay.js` 1.3MB **撞常见的大文件 pre-commit 钩子** | 重装 |
| **12** | **tick 文档教每个项目把 worktree 建在 `/tmp`**(`fast-mode-loop-tick.md:188,299`),而 `/tmp` 是 tmpfs ⇒ **2026-08-04 全机 OOM 的放大器**。本仓的活 worktree 已挪到磁盘,**但文档仍在传播这个做法** | **新增 A6** |
| **11** | **`vendor/` 是 Go 的保留目录**——非 Go 的 `vendor/` 打断 Go 项目构建(meta-cc DIR-103 实测)。**只有异构目标能暴露它** | **A1 + 新增 A5** |

> **第 10 + 第 11 条已合并修复(gap-the-runtime-has-nowhere-safe-to-land,2026-08-06)**:
> 运行时不再铺进目标的 `vendor/`,改铺 `.quay/runtime/`(quay 自己的命名空间,无任何目标语言保留),
> 由 `quay-init` 自己写 gitignore 条目把 `.quay/runtime/` 排除出目标的 git(AC10)。
> 落地路径分段避开 `vendor`/`node_modules`/`target`/`build`/`dist`(AC9)。
> 判定记录在下文「落地集合与 G2(第 10/11 条修复的判定)」。

---

## 不构成重装理由

单条缺陷修好(攒批) · 版本号变了或重新构建过 · 「感觉好多了」

## 收敛才是判据,不是小时数(2026-08-04 实测)

**今晚 6 小时**:新建任务 **18** · 关闭 **6** —— **发现速率是关闭速率的 3 倍**,
队列 `todo 53 / ready 11 / in_progress 0` **从未收缩**。

⇒ **把队列做空不是通往重装的路。** 只做门槛相关的,其余押后。

### 该盯的那个数字

**每做一次冷启动,产出多少条新缺陷。**

| 轮次 | 新缺陷 |
|---|---|
| meta-cc 首次冷启动(约 40 分钟) | **10** |
| 下一次 | 待测 |

**门槛要求「人工补丁数 = 0」。若下一次仍是 10 条,就没有收敛;若是 3 条,就在收敛。**
**这个数字比小时数有用得多**——小时数假设缺陷总量固定,而实测它在增长。

### 时间估算(附带,不可靠)

门槛相关未完成任务约 **10–15 个**,quay 速率 **1 任务/小时**(已含三项目争令牌)
⇒ 约 **10–15 小时**到门槛绿,重装加两次冷启动再 **2–3 小时**。
**但上面那条说明这个数字的前提(缺陷总量固定)现在不成立。**

### A5(2026-08-04 新增,由 `vendor/` 冲突触发)

**两个目标各自的构建在落地后仍然能通过。**

**为什么 A1 不够**:A1 只要求两边落地文件**字节相同**。
但 `vendor/quay/dist/quay.js` 在 Node 目标上无害,在 Go 目标上**打断构建**——
**字节相同,后果不同**,因为目标语言对目录名有自己的语义。

**⇒ 落地的正确性不能只由「文件内容」定义,还要由「落地后目标仍然可构建」定义。**

**判据**:Node 目标 `npm test` / Go 目标 `go build ./...` 在 `quay-init` 之后仍通过。

### A5 的 Go 半边已补入门槛 e2e(gap-the-runtime-has-nowhere-safe-to-land AC11,2026-08-06)

`install-config-driven-e2e.test.mjs` 现含三条 A5 相关断言:
`A5 — Node target still builds (npm test)`、`A5 — Go target still builds (go build ./...)`
(缺 `go` 工具链时按 ADR-019 决策 #1 就地 skip,本机实跑变绿)、
`AC9 — runtime path contains no reserved segment`。

## 门槛已被编码成一个测试(2026-08-04 02:xxZ)

`packages/quay/test/install-config-driven-e2e.test.mjs` 断言
`byte-identical` / `idempot` / `upgrade` / `finding` / `npm test` / **`go build`**(AC11)。

**⇒ 门槛过没过不再需要管理者判断,那个测试变绿就是过了。**

## 落地集合与 G2(第 10/11 条修复的判定,2026-08-06)

**运行时(gap-the-runtime-has-nowhere-safe-to-land AC2/AC6)落地在 `.quay/runtime/`,不进目标的 git。**

**「落地集合」的定义**:落地集合 = `quay-init` 铺进目标工作区的**全部文件**,无论 git 是否跟踪。
运行时是落地集合的一员——它被铺进目标、且与产物字节相同。

**G2 判据怎么算**:G2 的「落地文件全部与产物字节相同」是**对磁盘上的文件**逐字节比较,
不是对 git 跟踪状态比较。`.quay/runtime/` 不进 git 只改变 `git status`,不改变字节。
`quay-init` 仍从插件产物逐字节复制(`plugin/vendor/quay/dist/quay.js` → `.quay/runtime/quay/quay.js`),
A2 断言(落地文件与产物字节相同)原样覆盖它。
**⇒ 非 git 文件仍是落地集合的一员;G2 成立,因为 G2 看的是磁盘字节,不是 git 跟踪。**

**大文件钩子为什么不再撞(AC3/AC4)**:钩子扫描的是**暂存区**;`.quay/runtime/` 被 gitignore
排除,1.3MB 产物从不进入暂存区,所以任何阈值的 `check-added-large-files` 都看不见它。
AC4 负控制把阈值降到 1KB 并 `git add -f` 强推运行时,提交必失败、钩子点名那个文件——
证明钩子真在跑,也证明保护它的是 gitignore 而不是尺寸。

**缺口已关闭(2026-08-06,`gap-the-runtime-has-nowhere-safe-to-land` AC11)**:
`install-config-driven-e2e.test.mjs` 新增 `A5/AC11` 测试,用本地 `replace` 依赖的 Go module(全离线)
断言:基线 `go build ./...` 过 → 旧 `vendor/` 布局 `go build ./...` 必须失败(`inconsistent vendoring`,
即 meta-cc DIR-103 根因)→ quay-init 落地后 `.quay/runtime/` 落点、无 `vendor/`、`go build ./...` 过。
**同时该任务把运行时落点从 `vendor/` 改为 `.quay/runtime/`(AC9/AC10),A5 的碰撞源本身被移除。**

### 进度指标改为「红断言数」,不再用小时数

**红断言数是可数的、单调的、不需要外推。** 已要求 quay 外层每轮 tick 报一次。

### 实测进展(2026-08-04 02:xxZ)

| 项 | 状态 |
|---|---|
| 两道闸读同一份证据 | **已修**(`store.ts:991`:`execute->done reads the DoD checked-state`) |
| 勾选规则形状无关 | **已修**(`acAllChecked` 已不存在) |
| **meta-cc 的 todo 能否过闸** | **11/14**(先前 **0/15**)——**堵塞已清** |
| 仍未动 | `LOOP_SCRIPTS`(#2)、tmux 检测(#3)、`--plugin-root`(#7)、`ownedByThisSession`(#8)、`inner-state` 退役 |
| 已修(2026-08-06) | 大文件钩子(#10)+ `vendor` 保留目录(#11)——运行时改铺 `.quay/runtime/` 并 gitignore(见上「落地集合与 G2」);A5 的 Go 半边补入 e2e |

**估计约 5 小时到门槛绿 + 2–3 小时重装(上一版是 10–15 小时)。**
**但要警告**:近 3 小时关掉的六条都是**概念上有趣**的(闸、信道、分派);
剩下的是不有趣的管道活,**至今 0 提交**。
**注意力按有趣程度分配是这类工作固有的偏斜**——我自己也一样,
给两道闸缺陷写了大段分析,给那两条各留一行。

### A6(2026-08-04 新增,由全机 OOM 触发)

**落地后,目标项目的 worktree 根不在 tmpfs 上。**

**为什么它比看起来重要**:`/tmp` 在不同机器上是磁盘还是内存**不确定**,
而 worktree 的语义假定它在磁盘上。这次实测:`/tmp` 占 4.4GB 全部是内存,
是 16GB 机器被打死的放大器。**回收它只用了删一周前的构建缓存,几分钟的事。**

**判据**:`quay-init` 落地时校验 worktree 根的文件系统类型,是 `tmpfs` 则拒绝并说明原因;
负控制是真磁盘路径必须正常建成。

**这是十二条里唯一一条已经造成过全机停摆的**——排序时不该按有趣程度排。
