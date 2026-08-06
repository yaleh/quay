---
id: gap-the-token-measures-the-wait-and-throws-it-away
title: "The token already computes waited_ms and prints it to stdout, where it evaporates — so the halt-or-not decision its own header deferred cannot be made"
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

人问：**有没有必要 halt archguard 和 meta-cc 来给 quay 让路？**
管理者查完发现**这个问题现在答不出来**——**重活令牌的等待时长一条都没被记录**。

### 实测（管理者，外层复核）

`$QUAY_GLOBAL_DIR/heavy-op/` 只有两个文件：

```
stale_reclaims   3 bytes
token           57 bytes
```

**没有任何 wait 或 queue 记录。**

### 外层复核发现：那个数已经在算了，只是被扔掉

```bash
# plugin/scripts/heavy-op-token.sh:278
printf 'waited_ms=%d holder=%s acquired=yes\n' "$(( waited * 1000 ))" "$project"
```

- **:34** 把 `waited_ms` 明确声明为 **Contract measure**；
- **:288** 注释写明失败时也发出（*emitted on failure too*）；
- **落盘处数 = 0**（`grep -cE 'waited_ms.*>>|events\.jsonl'` ⇒ **0**）。

**⇒ 这不是「缺一个测量」，是「一个已经在做的测量被打到 stdout 然后蒸发」。**

### 脚本自己的设计注释，已经把这个决定挂起等这份数据

```
# heavy-op-token.sh:61
#   - no fair queue / FIFO: starvation is observable first (waited_ms),
#     the policy decision waits
```

**「先让饥饿可观测，策略决定往后放」——而人现在要做的，正是那个被往后放的策略决定。**
**它做不了，因为那份观测从未被保留。**

**⇒ 这与「事件落盘 + 零触发报告」是同一件事的两面**：
**都是让一个原本问不出来的问题变得可提问。**

### 管理者当前的判断，及它为什么需要这条来加固

管理者最近十二轮 tick 记的 `cpu some avg10`：**31 7 31 5 85 10 6 2 78 7 23 3**
⇒ **双峰**：大部分时间闲，套件重叠时尖到 78–91（记录时正在尖上 90.87 / load 17.68）。

**管理者据此判定不 halt**，理由：**为间歇尖峰停掉两个项目是拿钝器解决尖刺**，
而那两个项目**一个在做自己的产品工作、一个是唯一在真实运行已安装 quay 的地方**。

**但管理者自陈**：这是**基于压力的间接推断，不是基于争用成本的直接测量**。

**有了这条之后的判据（人/管理者给定）**：
**quay 每小时因等令牌损失几分钟 ⇒ 不值得停任何东西；损失半小时 ⇒ 是另一个结论。**

## Contract

```
measure wait_ms_per_hour = `jq -s '[.[]|select(.event=="ACQUIRED")|.waited_ms]|add/1000/60' $QUAY_GLOBAL_DIR/heavy-op/events.jsonl` 每小时因等令牌损失的分钟数字段
measure persisted_acquires = `wc -l < $QUAY_GLOBAL_DIR/heavy-op/events.jsonl` 已落盘的 acquire 记录数字段
band persisted_acquires = >0
invariant 每次 acquire（成功与失败）都留下它等了多久；测量已存在，落盘不得改变令牌语义
invoke `bash plugin/scripts/heavy-op-token.sh --acquire quay --timeout 0`
control 一次真实等待后事件行的 waited_ms 与 stdout 输出一致；令牌本身的行为不因落盘改变
resume 先落盘既有的 waited_ms，再谈 halt 与否
```

## Chosen mechanism

1. **复用 45 分钟前刚落地的形状**：写 `$QUAY_GLOBAL_DIR/heavy-op/events.jsonl`，
   **与 `session-liveness/events.jsonl` 同形**（AC20c 刚建立的约定）——
   **不要新发明一种格式**。
2. **成功与失败都记**（`:288` 已说明失败时也发出 `waited_ms`）——
   **只记成功会让「等到超时放弃」这类损失完全不可见**，而那恰恰是最贵的一类。
3. **落盘不得改变令牌语义**：这是纯增记录；
   **`--acquire` 的返回码、回收判据、超时行为一律不动**（AC4 是它的负控制）。
4. **报告面**：一条命令给出「每小时因等令牌损失多少分钟」，按项目分组——
   **那才是能回答 halt 与否的形状**，原始行本身回答不了。

**不做**：不在本任务里加公平队列 / FIFO（**`:61` 明写策略决定等观测**，
观测还没有，现在加策略是把顺序again倒过来）；
不改令牌的回收判据；**不用「压力」代替「等待时长」**——
**压力是间接推断，本任务存在的理由就是把它换成直接测量**。

## Acceptance Criteria

- [ ] AC1: **落盘**——每次 `--acquire`（**成功与失败都记**）在
      `$QUAY_GLOBAL_DIR/heavy-op/events.jsonl` 追加一行，含 `project` / `waited_ms` / `acquired` / `ts`
- [ ] AC2: **与 stdout 一致**——同一次 acquire 的事件行 `waited_ms` 与 stdout 输出**逐字一致**（实跑贴出）
- [ ] AC3: **报告命令**——一条命令给出**每项目每小时因等令牌损失的分钟数**（实跑输出贴任务体）
- [ ] AC4: **负控制（语义不变）**——落盘前后，
      `--acquire` 的**返回码、回收行为、超时行为完全一致**（实跑对照贴出）。
      **这条不过，AC1 不算数**——**为了观测而改变了被观测者，测到的就不是原来那件事**
- [ ] AC5: **负控制（零等待也要有记录）**——`waited_ms=0` 的 acquire **同样落一行**。
      **只记非零等待会让「从不等待」与「从没跑过」不可区分**——
      本仓今晚已记过这个形态（零触发报告存在的理由）
- [ ] AC6: **失败路径**——超时放弃的 acquire **必须留下记录**（实跑贴出）
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC4 与 AC5 的实跑输出都贴进任务体
- [ ] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）
- [ ] 任务体记录：**`heavy-op-token.sh:61` 早就写明「先让饥饿可观测，策略决定往后放」**——
      **而那个策略决定（halt 与否）今天被问到了，答不出来，因为观测被打到 stdout 然后蒸发**

## Touches
- tasks/gap-the-token-measures-the-wait-and-throws-it-away.md（自身文件：勾 AC + 贴 invoke 证据授权）


- plugin/scripts/heavy-op-token.sh
- plugin/test/heavy-op-token.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-04T01:15:00Z
changed: 管理者报的机件缺口，外层复核后**把它从「加一个测量」改写为「停止扔掉一个已有的测量」**：
`waited_ms` **已经在算**（`:278` 的 `printf`）、**已被声明为 Contract measure**（`:34`）、
**失败时也发出**（`:288`），而**落盘处数为 0**。
**最有说服力的一条是脚本自己的注释**（`:61`）：
**「先让饥饿可观测（waited_ms），策略决定往后放」**——
**而人现在要做的正是那个被往后放的策略决定，它做不了，因为观测从未被保留。**
**外层加了两条负控制**：**AC4**——落盘不得改变令牌语义，
**为了观测而改变被观测者，测到的就不是原来那件事**（AC4 不过则 AC1 不算数）；
**AC5**——`waited_ms=0` 也要落一行，否则**「从不等待」与「从没跑过」不可区分**，
那正是零触发报告存在的理由。
**机制上复用 45 分钟前刚落地的 `events.jsonl` 形状**（AC20c 的约定），**不新发明格式**。
**排序如实说明**：按管理者 01:05Z 的裁定「只做门槛相关的」，
**本条不在四条断言与十条缺陷清单内 ⇒ 排在那六条之后**。
**外层不为它破例**——尽管它很便宜（数已经在算，只差一次写）且能了结一个反复出现的争论。
**破例的成本不是这一条的工时，是「门槛优先」这条裁定本身失去约束力。**
