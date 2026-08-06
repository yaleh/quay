# 消息总线：把人接进网络，而不是让人守在会话前

- **Status:** Proposal（管理者，人给出方向）
- **Date:** 2026-08-06
- **性质**：架构提案。**核心主张：人是 `deliver()`/`observe()` 的第三个 target，不是一个新子系统。**
- **Relates:** [`orchestration/SPEC-integration-architecture-2026-08-05.md`](../../orchestration/SPEC-integration-architecture-2026-08-05.md)
  （两个窄接口 + 消息总线一栏），
  [`quay-web-human-is-not-an-operator.md`](./quay-web-human-is-not-an-operator.md)（腾出来的那一面），
  [`quay-saas-remote-access-to-an-onprem-loop.md`](./quay-saas-remote-access-to-an-onprem-loop.md)（第三种传输），
  [`quay-web-observation-surface.md`](./quay-web-observation-surface.md)（只读观察面的增量）

**AC/DoD 与立案由外层判断。**

---

## 0. 触发

人：**「可以考虑实现一个或多个 chat 信道以支持人类用户与 manager/outer 的通信（其频率可以低些，
实时性可以差一些）。也可以考虑把我们讨论过的 manager/outer/inner 的通信信道调整与此结合。」**

---

## 1. 它补的不是便利，是一个正在裸奔的单点

**人 ↔ network 现在只有一条通道：那一个 Claude Code 会话。**

| 方向 | 现状 | 会话死了会怎样 |
|---|---|---|
| 人 → manager | 在会话里打字 | **完全失联** |
| manager → 人 | 会话的输出 | **完全失联** |
| manager → outer/inner | `tmux send-keys` | 尚可（但见 §3） |
| 项目 → manager | `.quay/manager-inbox/`（**临时建的**，无 schema、无回执） | 文件还在，但没人读 |

**2026-08-05 一夜四次全灭，每一次都是「人碰巧注意到不对劲」才恢复的**——
「人发现问题」这件事本身**没有任何机制支撑**。

### 1.1 已经自发长出来了一半

`.quay/manager-inbox/` 目前有 3 条 archguard 投来的消息（`archguard-20260805-*.md`）。
**这是管理者当晚临时建的目录**：没有 schema、没有读取回执、没有任何东西保证有人读。

⇒ **本提案不是发明一个新东西，是把一个已经自发出现的、形态粗糙的东西正规化。**
（「逃生舱出现的位置就是缺失字段的位置」——`SPEC-state-crystallization` §5.3。）

---

## 2. 「低频率、弱实时」是设计优点，不是妥协

| 理由 | 依据 |
|---|---|
| **匹配真实节奏** | 人 ↔ manager 的自然频率是**分钟到小时级**。2026-08-05 全天，人的每条输入间隔都在这个量级 |
| **绕开最脆的通道** | `tmux send-keys` 有 6 种已知失败模式（NBSP 判空、ghost 建议污染、Enter 丢失…）；HTTP POST + 文件落盘 + 轮询的失败模式简单且可观测 |
| **天然是存在信号** | 消息落盘 = 消息存在，**不需要从缺席推断**——正好避开本仓反复踩的那类坑（见 §5） |

**推论**：不要为它引入秒级轮询或 WebSocket。
**信号频率必须匹配决策频率**——这条今晚已在 PSI `avg10` vs `avg300` 上验证过一次
（avg10 秒级抖动追不上分钟级决策，换 avg300 后误判消失）。

---

## 3. 与层间通信合流：人只是第三个 target

`SPEC-integration-architecture` 已经定了两个窄接口：

```
deliver(target, payload) -> delivered | failed
observe(target)          -> {busy, idle, blocked, last_at}
```

**如果人也是一个 target，那么 chat 信道与层间驱动是同一个机制的两种实例，不该做成两套。**

| target | `deliver` 怎么实现 | `observe` 怎么实现 |
|---|---|---|
| inner | `send-keys` → 校验目标 transcript | `classifyPaneState`（已参数化，`--target`） |
| outer | 同上 | 同上（今晚已实测 manager 盯 outer 可用） |
| **human** | **写进收件箱 / web 推送** | **「他读了没有」——见 §5** |

**唯一的实质差别**：人这个 target **不能被注入**，只能等他自己来读。
⇒ `deliver(human, …)` 的语义是「投递成功」，不是「已送达意识」——这两者必须分开，见 §5。

**同一条已在今晚被验证过一次**：`inner-blocked-signal.ts` 的 `--target` 参数化
（inner/outer/manager 各一次调用，不新写代码）——**观测方向的通用化已经做过了，
投递方向应当同构，而不是另起炉灶。**

---

## 4. 最被低估的价值：AC12b 第一次变得可机械测量

**这是我认为本提案最强的论据。**

主判据 AC12b = **两层无人干预区间**。它现在**测不了**：

- 「这段时间有没有人干预过」要靠翻管理者自己的行动记录逐条核对；
- **今晚因此出过一次真实的错**：管理者一度背书了 archguard「11:40→12:10 全程无真人干预」，
  后来核对自己的行动日志才发现**自己 12:01 驱动过它**——那个断言是假的。

有了信道之后：

```
每一条 人 → 机器 的消息 = 一条带时间戳、带发送方身份、可计数的记录
⇒ 「无人干预区间」 = max(相邻两条人类消息的时间差)
⇒ 从「需要人工回忆的判断」变成「一次查询」
```

**并且它是 fail-safe 的**：如果人绕过信道直接在 tmux 里打字（今晚的常态），
那条消息**不会**出现在记录里 ⇒ 会**高估**无人干预区间。
⇒ 因此配套判据必须是：**AC12b 的测量只在「人只走信道」的约束下有效**，
这个约束本身要写进测量协议，不能默认成立。

---

## 5. 设计上必须防的坑：不要重蹈「从缺席推断」

**本仓的核心教训**（`inner-blocked-signal.ts` 头注释逐字）：

> *"File exists == inner is waiting. This is an **existence signal, not an absence inference**."*

对信道的直接含义：

| 错误形态 | 正确形态 |
|---|---|
| 「发出去了，没回复 ⇒ 大概在忙」 | **manager 读取后写一条明确的回执记录**（读了 / 在处理 / 已完成） |
| 「收件箱里有文件 ⇒ 对方会看到」 | **消费者必须有机械挂载点**（tick 的某一步显式读收件箱），否则就是「写了但不在决策时被调用」 |
| 「没有新消息 ⇒ 没有新指令」 | 区分**没有消息**与**信道断了**——同 `dead-loop-check.sh` 的思路 |

**第二行是重点**：`.quay/manager-inbox/` 今晚就是这个失败形态——
**文件在，无人读**。信道正规化的**第一优先级不是投递，是消费者的机械挂载点**。

---

## 6. 与 SaaS 的关系：一个在写第一行代码前就定死的选择

> **如果信道从一开始按「传输层无关的消息总线」设计，SaaS 版就是换一个传输实现，不是第二个产品。
> 如果按「web server 直接读本地文件」实现，SaaS 就得重写一遍。**

这个分叉**不可能事后补救**，必须在动手前决定。详见
[`quay-saas-remote-access-to-an-onprem-loop.md`](./quay-saas-remote-access-to-an-onprem-loop.md)。

---

## 7. 未验证的部分（AC11：不要读成已完成）

- 信道**不存在**，本文所有形态都是设计意图，无一被跑过；
- `.quay/manager-inbox/` 的 3 条消息**从未被机械读取过**（管理者是手工 `ls` 看见的）；
- §4 的 AC12b 可测量性**依赖「人只走信道」这个尚未成立的约束**——
  今晚人的全部输入都走 tmux，信道即使建好，不改变习惯就测不到。

**落地后第一个该测的**：不是投递成功率，是
> **人发一条消息 → manager 的下一个 tick 是否在无人提醒的情况下读到并回执。**

因为失败的从来不是投递，是**没有消费者**。

---

**本文件不建 AC/DoD、不排优先级——那是外层的活。**
管理者提供：单点失联的实测、manager-inbox 这个自发逃生舱的证据、
「人是第三个 target」的合流论据、AC12b 可测量性这条被低估的价值（含它自身的 fail-safe 缺陷）、
以及「先有消费者挂载点，再谈投递」的次序判断。
