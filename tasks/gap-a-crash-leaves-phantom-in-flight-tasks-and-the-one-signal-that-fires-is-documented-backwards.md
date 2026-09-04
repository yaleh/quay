---
id: gap-a-crash-leaves-phantom-in-flight-tasks-and-the-one-signal-that-fires-is-documented-backwards
title: a crash leaves phantom in-flight tasks forever, and the shipped tick doc
  defines ORPHAN as the exact opposite of what the code detects
status: done
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**2026-08-04 03:35Z 由一条 `OVER90` 事件查出，外层逐条实测。**

### 事实一：崩溃留下的在飞记录永远不会被关闭

02:15Z 整机 OOM 杀死所有执行者。三条 `--task-start` 早于 OOM 写下，`--task-end` 永远不会来：

| 任务 | `--task-start` | OOM 时已跑 | 现在「在飞」 |
|---|---|---|---|
| `gap-the-one-condition-...` | **02:03:46Z** | 11 分钟 | **91.5 分钟** |
| `gap-init-guesses-the-tmux-session-...` | 02:10:51Z | 4 分钟 | 84.4 分钟 |
| `gap-the-finding-shape-...` | 02:13:36Z | 1 分钟 | 81.7 分钟 |

**其中 `gap-the-one-condition-...` 的分支早已合并进 master、worktree 已移除、`status: todo`**
——**没有任何东西在跑它**，而遥测把它算作在飞已 91 分钟。

⇒ `inProgress` **长度 3，真实在飞 0**（那一刻）。**没有任何机制对账。**

### 事实二：唯一会因此发声的信号，在出厂文档里被写反了

`OVER90` 于 91 分钟触发——**算术正确，含义为假**：它说「单任务超 90 分钟」，
而真相是「执行者 80 分钟前就死了」。**这两件事在信号上不可区分。**

那么本该覆盖这一类的 `ORPHAN` 呢？**它报了零，而且这是正确行为**：

| 出处 | 定义 |
|---|---|
| `plugin/scripts/fast-mode-telemetry.ts:624` | 逐字打印 `orphaned (end without start)` |
| 同文件 `:420` 文档 | `A start with no end → inProgress`；`:399` `An end with no unmatched start is an orphan` |
| `plugin/scripts/inner-state.sh:74-75` | `ORPHAN` **直接派生自 `d["orphaned"]`** |
| **`plugin/loop/orchestrator-loop-tick.md` §0b 表格** | **`ORPHAN` \| 有 `--task-start` 无 `--task-end`** ← **正好相反** |

**⇒ 出厂 tick 文档教每一个目标项目的外层：「有始无终会报 ORPHAN」。代码从不这样做。**
有始无终的落进 `inProgress`，**只在 90 分钟后以 OVER90 露头，而那与「一个真的很慢的任务」同形。**

### 为什么这一条值得单独立

**外层今晚差点据此判错两次**：先按文档以为 ORPHAN 会覆盖崩溃遗留，后又以为「`orphaned: []` 说明检测器坏了」
——**两次都是文档把人带偏，而代码一直是对的**。**读代码才发现文档反了。**

**一般形态**：**文档与代码各自自洽，只有把两者对照才暴露**——
与本仓 [[gap-the-loop-driver-check-reads-a-self-declared-registry-nobody-writes]] 同族
（那条是「文档漏了一步」，这条是「文档写反了一个方向」）。

**不夸大的部分（外层实测后如实缩小范围）**：
`tasksPerHour` **未被污染**——`:446` 明写 `open/orphan lines subtract nothing`，
崩溃遗留的 start 不进 `tasks[]`、不减 `windowHours`。**受影响的是 `inProgress` 与由它派生的信号，不是吞吐。**

## Contract

```
measure phantom_in_flight = `node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json | python3 -c "import json,sys; print(len(json.load(sys.stdin)['inProgress']))"` 输出的计数字段
measure doc_orphan_direction = `grep -c "有 .--task-start. 无 .--task-end." plugin/loop/orchestrator-loop-tick.md` 输出的计数字段
measure reconcile_closes = `node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --reconcile --json | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('closed',[])))"` 输出的计数字段
measure real_in_flight_kept = `node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json | python3 -c "import json,sys; print(len(json.load(sys.stdin)['inProgress']))"` 输出的计数字段
band doc_orphan_direction = 0
band reconcile_closes >= 1
invariant 对账只关闭「执行者确实不存在」的记录；一个真在跑的任务绝不被关闭
invoke `bash scripts/test.sh plugin/test/fast-mode-telemetry.test.mjs`
control 一个真正在跑的在飞任务必须在对账后仍然在飞——否则对账把幽灵问题换成了失明问题
resume 先改文档方向（一行、且随交付物走），再做对账
```

## Chosen mechanism

**两件事，先后不可颠倒。**

**一、改文档方向**（一行，最便宜且随交付物铺到每个项目）：
`plugin/loop/orchestrator-loop-tick.md` §0b 的 `ORPHAN` 行改为**代码实际的定义**（有 end 无 start），
**并补一行说明有始无终去了哪里**（`inProgress`，只在 90 分钟后以 `OVER90` 露头，
**而那与真正的慢任务同形**）——**否则读者会以为改了定义就覆盖了那一类**。

**二、崩溃对账**：给遥测一个 `--reconcile`，把「执行者确实不存在」的在飞记录关闭并标注原因
（如 `outcome: "abandoned-executor-gone"`），**判据必须是可观测的**——
worktree 不存在 / 进程不存在 / 分支已合并，**不能只用「时龄超过 N 分钟」**
（那与一个真的很慢的任务同形，正是本条要修的病）。

**不做**：**不删除记录**（它们是真实发生过的事，`--task-start` 写下时是真的）；
不把 `OVER90` 阈值调高（**那只是让幽灵更晚出现**）；
**不在本任务里改 `inner-state.sh` 的 ORPHAN 语义**——代码是对的，错的是文档。

## Acceptance Criteria

- [x] AC1: **文档方向改对**——tick 文档的 `ORPHAN` 定义与 `fast-mode-telemetry.ts:624` 的
      `end without start` 一致；且**同处写明有始无终落进 `inProgress`**（贴 diff）
- [x] AC2: **对账关掉今晚这三条**——`--reconcile` 后 `inProgress` 从 3 降到真实值，
      每条关闭都带可观测理由（实跑贴出三条记录原文）
- [x] AC3: **负控制（不过则 AC2 不算数）**——**构造一个真正在跑的在飞任务**（真进程、真 worktree），
      `--reconcile` 后它**必须仍在 `inProgress`**。
      **对账把幽灵问题换成失明问题是更坏的交易**（实跑贴出）
- [x] AC4: **判据不是时龄**——证明对账对「时龄 91 分钟但执行者活着」的任务不关闭（实跑贴出）
- [x] AC5: **OVER90 的文案区分两类**——对已对账关闭的不再发声；对真慢任务照常发声（实跑贴出两个方向）
- [x] AC6: 测试用 `node:test` 且带 `// @test-group governance`
- [x] AC7: **补记的 `--task-start` 产生的是失真，不是缺失——这一形态原任务没覆盖**。
      **实测（外层 2026-08-04 05:06Z）**：崩溃后重启的会话恢复遥测括号时，对**代码早已落地**的任务
      补写了 `--task-start`（`tmpfs` 记 05:06:33Z 而代码 04:25Z 落地、工作始于 03:0xZ；
      `token` 记 05:06:34Z 而代码 04:26Z 落地、工作始于 02:47Z）⇒ **收尾算出的耗时是几分钟而非约两小时**。
      同期 `finding-shape` 那条 02:13:36Z 的幽灵记录仍开着，**若直接补 end 则算出约三小时**——
      **三条的失真方向还不一样**。
      **判据**：对账必须能**识别并标注**这类记录（起始时刻晚于该任务已知的首个提交时刻 ⇒ 标为
      `startedAtMs-unreliable`），**且被标注的记录不得进入吞吐统计的分子或分母**（实跑贴出）。
      **这条比幽灵本身更危险**：幽灵让遥测**冻结且明显不可信**，失真让它**在动且看起来合理**——
      **一个看起来合理的错数会被直接拿去用**，而人排的第三步正要拿它做吞吐前后对比。

      **删除与保留的界线必须写死（外层 2026-08-04 05:1xZ 补，因为已经发生过一次）**：
      内层删掉了那两条补记文件，**这次是对的**，但理由不是「记录错了就能删」——
      **两类记录性质不同**：
      | 类别 | 它断言了什么 | 处置 |
      |---|---|---|
      | **幽灵**（02:03/02:10/02:13 那三条） | **一件真发生过的事**——任务确实在那一刻开工了，只是执行者中途被杀 | **保留 + 标注**。本任务「不做」一节已写明不删除 |
      | **补记**（05:06 那两条） | **一件没发生过的事**——任务并没有在 05:06 开工 | **可删**，但**必须在任务体留痕**（内层已在两条任务体写下 `## 遥测记录` 段） |
      **⇒ 判据是「这条记录断言的事是否真发生过」，不是「这个数字是否好看」。**
      **没有这条界线，下一个人会删掉一条他只是不喜欢的记录，而审计日志的价值正在于不能这样删。**

## Definition of Done

- [x] AC3 与 AC4 的实跑输出都贴进任务体（真在跑的不被关、时龄大的不被误关）
- [x] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
- [x] 任务体记录**外层今晚因这条文档反向差点判错两次**的经过——
      先以为 ORPHAN 会覆盖崩溃遗留，后以为 `orphaned: []` 说明检测器坏了
- [x] 任务体明写**未受影响的部分**：`tasksPerHour` 不被污染（`:446` open/orphan 不减 windowHours）

### invoke 实跑证据（task-contract-check 消费者）

Contract `invoke` 入口路径 **`scripts/test.sh`**（本段展示在 `## Contract` 块之外，供
task-contract-check 的 invoke-evidence 检查消费）。

`scripts/test.sh plugin/test/fast-mode-telemetry.test.mjs` → ℹ tests 40 / pass 40 / fail 0 / cancelled 0 / skipped 0。
该文件按 AC6 声明 `// @test-group governance`，在默认 product,engine 批量运行中报 skipped；
此处显式单独调用时全绿（与 Contract `invoke` 的 `bash scripts/test.sh ...` 入口路径一致）。
批量 fan-in 全量：tests 2283 / fail 0 / cancelled 0 / skipped 28（新参考计数）。

## Touches

- plugin/loop/orchestrator-loop-tick.md
- plugin/scripts/fast-mode-telemetry.ts
- plugin/test/fast-mode-telemetry.test.mjs

## Cross-annotation (2026-08-08, from [[gap-over-90m-false-signal-source-reads-telemetry-not-task-status]])

**对账判据缺陷确认（AC4 交叉标注）**：`makeDefaultExecutorGone`（`plugin/scripts/fast-mode-telemetry.ts`）
把「worktree 存在」当作 mid-flight 的 KEEP 信号（reason `worktree-present`），但 **worktree 存在 ≠
mid-flight**。2026-08-05 的 phantom in-flight（`gap-loop-has-no-os-level-anchor` / `gap-web-board`）
正是 **0-commit 死 worktree + 进程已死**：对账因 worktree 存在而保留 phantom，`inProgress` 永不收敛。
**应有 mtime/进程佐证**：worktree 存在仅当其最近 mtime 新鲜（或相关进程存活）才应作 KEEP；一个
0-commit、mtime 数小时前、无进程的 worktree 不是 mid-flight。

本条（over-90m 信号侧止血）已用 task-status 闸消除 status=ready 陈旧 bracket 的假 OVER90；但
`--reconcile` 报告侧的判据缺陷仍在——`inProgress` 仍会把死 worktree 计入，reconcile 仍会保留它。
worktree 存在 ≠ mid-flight 的判据修正（mtime/进程佐证）超出本条 `## Touches`，留作后续任务。

## Dispatch review

reviewer: outer
at: 2026-08-04T03:35:00Z
changed: **由一条 `OVER90` 事件起，全程按「先证伪再采信」办，结果推翻了外层自己的两个前提。**

**第一个被推翻的前提是「这是幽灵事件」**：外层先以为 91 分钟是 OOM 之后重启造成的错误计时。
实测三条 `--task-start` 的写入时刻分别是 02:03:46Z / 02:10:51Z / 02:13:36Z，**全部早于 02:15Z 的 OOM**
⇒ **`OVER90` 的算术完全正确**，错的是它的含义——它说「任务跑了 91 分钟」，
真相是「执行者 80 分钟前死了」。**这两件事在信号上不可区分，这正是本条的核心。**

**第二个被推翻的前提是「检测器坏了」**：外层看到 `orphaned: []` 面对三条有始无终的记录，
**几乎据此立案说 orphan 检测器失效**。查代码才发现 `orphaned` 的定义是 **end without start**
（`:624` 逐字如此打印），**报零是正确行为**。**差一步就把一条正确的实现写成缺陷。**

**真正的缺陷因此变成另一条，而且更重**：**出厂 tick 文档把 `ORPHAN` 定义写反了**，
而它随 `plugin/` 子树铺进每一个目标项目。**外层今晚两次判错都是被这份文档带偏的，代码一直是对的。**
⇒ **AC1（改文档方向）排在 AC2（做对账）之前**，因为它一行、最便宜、且错误正在向每个装了 quay 的项目复制。

**外层如实缩小了范围，没有把结论说得比证据大**：查过 `:446` 后确认
**`tasksPerHour` 未被污染**（open/orphan 不减 `windowHours`、不进 `tasks[]`），
**受影响的只有 `inProgress` 及其派生信号**。这一点写进 DoD，免得后续把一个吞吐数字也算到这条头上。

**AC3/AC4 是本条最硬的两条，都是防「对账变成失明」**：对账必须用**可观测判据**
（worktree/进程/分支），**不许用时龄**——用时龄就等于把「幽灵」换成「真慢任务被静默关闭」，
**而那正是本条要修的同一个病，只是换了方向**。

**排期**：**与 [[gap-the-loop-driver-check-reads-a-self-declared-registry-nobody-writes]]
同动 `plugin/loop/orchestrator-loop-tick.md`，两者必须串行**（外层逐条对过 `## Touches`）。
与第一步（tmpfs）、与在飞的 3a / token 均不相交。
