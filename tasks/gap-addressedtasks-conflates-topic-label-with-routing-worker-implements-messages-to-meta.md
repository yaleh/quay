---
id: gap-addressedtasks-conflates-topic-label-with-routing-worker-implements-messages-to-meta
title: addressedTasks 把「关于 meta-driver 的任务」当成「寄给 meta-driver 的消息」——probe 规格逐字写
  things sent TO you 而实测 6 条无一是消息，且它们全被 worker 派发实现（32 次）
status: superseded
labels:
  - gap
  - defect
  - meta-driver
parent: null
children: []
extra:
  schema: execution
  acceptance: node --experimental-strip-types --test plugin/test/meta-driver.test.mjs
---
## Finding

**人 2026-09-07 指出：「这是非常脏的设计」。核准后属实，且这个设计是我（manager 会话）引入的——`addressedTasks` 入口是我加的，`meta-driver` 标签也是我当主题标签用的。本条记录事实与修法。**

### 一、同一个对象有两个意图冲突的消费者（实测）

`meta-driver` 这个标签在整条派发链里**一次都没出现**：

```
grep -n 'meta-driver' plugin/scripts/ready-pool-check.ts plugin/scripts/worker-driver.ts plugin/scripts/driver-filters.ts
  → 零命中
```

派发只认 `priority:p1|p2`（`ready-pool-check.ts:1029-1030`）等承重标签。⇒ **对流水线而言，带 `meta-driver` 标签的任务就是普通任务**：promotion-driver 照常晋升，worker-driver 照常派 worker 去**实现**它。

实测（`.quay/worker-outcome.jsonl`，当前 6 条 addressedTasks）：

```
gap-goal-driver-draft-ac-invisible-yet-blocking           worker 派发  8 次  末次=completed
gap-goal-evidence-cache-should-not-enter-git              worker 派发  3 次  末次=completed
gap-meta-carrierstats                                     worker 派发 13 次  末次=completed
gap-meta-divergence-recommendation-recurrence-invisible    worker 派发  5 次  末次=exited-not-landed
gap-meta-divergences-not-routed-by-handler-existence       worker 派发  2 次  末次=completed
gap-meta-goal-supervisor                                   worker 派发  1 次  末次=completed
                                                    合计 32 次派发
```

⇒ **worker-driver 要「实现」它，meta-driver 要「评论」它，彼此都不知道对方存在。**

### 二、规格里那句话是假的

`plugin/probes/meta-driver.md:64` 逐字：

> `addressedTasks`: OPEN tasks (todo / ready / needs-human) labelled `meta-driver` — **things sent TO you**. This is how a bare defect reaches you…

**当前 6 条里没有一条是「寄给它」的**：`gap-meta-carrierstats`、`gap-goal-evidence-cache-should-not-enter-git` 等全是**关于 meta/goal 机件的普通工作任务**。标签被我按「主题」用，机制按「路由」读——**两种含义共用一个标签**：

| 含义 | 我实际用的 | 机制读成的 |
|---|---|---|
| 主题：这条任务**关于** meta-driver 子系统 | ✓ 全部 6 条 | — |
| 路由：这条任务**寄给** meta-driver | — | ✓ 机制这样读，并据此要求逐条表态 |

⇒ probe 被要求对一堆本不是发给它的东西逐条给 `hasOpinion`；而**真要给它提要求的人，提出来的东西会被一个 worker 拿去实现**——那可能完全不是发件人想要的，还会占一个 fan-in 槽、一个 worktree、一整轮全量 suite。

### 三、它同时违反了本项目已确立的「单一处理者」

人 2026-09-06 确立、我当时也背书过的模型：**每一条输出必须落在一个已有唯一处理者、且该处理者具备相应动作的对象上**。而这里：一个 task 同时被 worker（实现）与 meta-driver（评论）消费，**没有任何机制协调二者**。这与我自己立的 `gap-needs-human-overloaded-two-populations-one-state`（一个状态承载两个处理者相反的群体）是**同一形状的第二个实例**，只是那条在状态上，这条在对象上。

### 四、方案空间（新事实使其收窄）

**⚠️ 两个今天刚落地的事实改变了取舍**：
1. **人工转向通道已存在**：`orchestration/meta-driver-focus.md` 覆盖段（2026-09-07 09:19 落地，`readFocusFile` 每轮读、内容进摘要按变化触发、**完全不经过 worker**）。给 meta-driver 提要求**已经有一条干净通道了**。
2. **排除机制有先例但不是标签**：`**PARKED` 正文标记可把任务挡在晋升外（`ready-pool-check.ts:30/52`）。

**方向倾向（供执行者判断，非强制；二选一并写明理由）**：

- **甲（推荐：承认它是主题视图，要求通道交给 focus 文件）**——零新机制：
  - 把 `addressedTasks` 的**规格描述改成实情**：「**关于你所观测机制的、未关闭的任务**」——这是**真有用**的上下文（它让 probe 知道哪些缺陷已有任务在管，正是 dedup 纪律「已有任务在管 vs 无人管，修法完全不同」的输入），⛔ 但它**不是**收件箱。
  - 逐条表态的要求随之改语义：从「你对这条寄给你的消息有什么意见」改成「这条在管的任务与你本轮发现是否相关」。
  - 「给 meta-driver 提要求」**明确指向 focus 文件覆盖段**，probe 规格与相关 skill 两处都写明。
  - ⊢ 好处：不新增登记面（SPEC §6.3）、不与 worker 争对象、不需要 meta-driver 具备关闭任务的能力。

- **乙（给它真正的路由语义）**：另立一个**路由**标签（如 `meta-inbox`，与主题标签 `meta-driver` 分开），并把它加进派发排除集（仿 PARKED 的位置）。
  - ⚠️ **必须同时回答「谁关闭它」**：probe 规格明写 `⛔ you cannot modify a task's status/labels/body`。若无关闭者，这些任务会**永远堆积**——这正是规格自己记着的 `escalations.md` 死法（12 条未答、死 10 天）。
  - ⇒ 选乙**必须**连带设计关闭路径，否则不达标。

- ⛔ **不接受**：①保持现状（规格在说假话，且真消息会被 worker 误实现）；②只改规格措辞而不改逐条表态的语义（表态问题仍然问错）；③把 `meta-driver` 标签直接加进派发排除集（会把 6 条**真正需要 worker 实现**的工作任务一并挡死——它们恰恰应该被实现）。

## AC

- [ ] 规格与实情一致：`plugin/probes/meta-driver.md` 中对 `addressedTasks` 的描述不再声称是「寄给你的消息」（选乙则相反：确有一条真正只寄给它的输入）；判据须**引用改后的原文**并说明它与机制行为逐条对应。
- [ ] **双消费者冲突消失，且可机械判定**：给出一条命令，读出「当前有多少条任务同时被 worker 派发过且出现在 addressedTasks 里」——选甲后该数**可以非零但语义正当**（主题相关），须在规格里写明为何正当；选乙后**路由标签那一类的该数必须为 0**。⛔ 不是断言，是读数。
- [ ] 逐条表态的问题与新语义一致：`addressedTaskOpinions` 的提问语义与第一条的描述对齐（⛔ 不得规格改了而输出仍按旧语义要求）。
- [ ] 「提要求」的唯一入口被明确写死：probe 规格 + 立案 skill 两处都写明该走哪条通道；给出一条命令验证两处措辞一致（⛔ 不得只改一处——硬规则 5b：同一原则在第二个载体上的适用点必须一起改）。
- [ ] **能取假**：构造一条「真要求」（内容只有 meta-driver 该处理、worker 无从下手），按新入口投递 ⇒ 下一轮 probe 读到它，且**未产生 worker 派发**（读 `.quay/worker-outcome.jsonl` 证明）；按旧入口（打 `meta-driver` 标签立 task）投递 ⇒ **产生 worker 派发**。两个方向都实跑。
- [ ] 选乙时的关闭路径：给出「这类任务由谁、按什么条件关闭」的机械答案与一次实跑；⛔ 无关闭路径不得选乙。

## DoD

- [ ] 上述判据本轮实跑并贴出输出（⛔ 不是转述），能取假那条两个方向都实跑。
- [ ] **生产载体证据（非 fixture）**：用真实的 addressedTasks 集合跑一轮真实判读，贴出新语义下的逐条表态；⛔ 不得以单测通过冒充（硬规则④推论三）。
- [ ] 甲/乙 选了哪个、为何另一个不合适，写进任务体；选乙必须附关闭路径设计。
- [ ] 与三条相关任务的关系写入任务体，逐条说明不重叠：
  - `gap-meta-addressedtasks-input-truncates-body-only-title-reaches-probe`（同一入口的**内容宽度**问题）
  - `gap-meta-driver-has-no-visible-carrier-or-tools-unlike-task-goal-adr`（**输出侧**载体不可见）
  - `gap-needs-human-overloaded-two-populations-one-state`（同形：一个对象/状态承载两个处理者）
- [ ] ⛔ 未把 `meta-driver` 主题标签加进派发排除集（会误挡真正需要实现的工作任务）；⛔ 未新建只写不读的登记面（SPEC §6.3）；⛔ 未新增 driver kind（SPEC §5.1）。
- [ ] **落地后重启 meta-driver 并确认新语义出现在真实轮记录里**——本会话已实测「代码落地但 driver 未重启 ⇒ 生产跑旧代码」，⛔ 不可跳过。

## Touches

- `plugin/probes/meta-driver.md`
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `tasks/gap-addressedtasks-conflates-topic-label-with-routing-worker-implements-messages-to-meta.md`
