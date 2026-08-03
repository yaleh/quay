# Quay Web 观察面 — 在现有 `serve` 上的增量

- **Status:** Proposal — 未采纳。这是对**已有实现**的增量设计，不是新建一个界面。
- **Date:** 2026-08-03
- **Origin:** 2026-08-02/03 的双层持续开发实测。人指出一个整晚都被漏掉的维度：
  「无人值守」被实现成了「人只能通过问编排会话来了解状态」——那不是同一件事。
- **Relates:** [`quay-webui-bootstrap-experiment-v3.md`](./quay-webui-bootstrap-experiment-v3.md)
  （**不同范围**：那是一份实验协议，讲用实验流程把 Web UI 做到可用；本文是对当前
  `packages/quay/src/serve-handlers.ts` 的功能增量），
  [`exp6-queue-driven-concurrent-executor.md`](./exp6-queue-driven-concurrent-executor.md) §0
  （阶段 2 交付范围），`orchestration/exp6-phase1-sustained-unattended-operation.md` §D
  （双层机制产品化的两个缺口）

---

## 0. 要解决的问题

人希望**持续看到**整体任务列表与状态、尽可能新的信息、以及当前在执行的任务（含最近输出与时间），
**而不用反复向编排会话提问**，并且**不引入额外的推理成本**。

实测依据：2026-08-02 23:58Z 人问「12 小时目标进展如何」，编排会话跑了六七条命令才拼出答案——
而那些数据**全都已经在磁盘上**，只是没有界面。

## 1. 现状（增量的基线）

| 组成 | 现状 |
|---|---|
| `packages/quay/src/serve.ts` | 103 行，启动 + provider host |
| `packages/quay/src/serve-handlers.ts` | 1073 行，全部 handler 与渲染 |
| 路由 | `/`（任务列表）、`/adr`、`/adr/<id>`、`/task/<id>`、`POST /task/<id>/action/<id>` |
| 数据源 | **仅** Provider ABI，每请求实时读任务库 |
| 已渲染字段 | status、labels、role、parent/children、body（markdown） |

**现有实现是好的基线**：每请求实时读、无缓存、provider 无关。增量不应破坏这三条。

## 2. 三条来自实测的设计结论

### 2.1 只读任务库会给出**错误**的状态——今天有硬证据

`DIR-124-A2` 与 `DIR-124-A5` 的 frontmatter 是 `status: done`，而代码在**未合并的 worktree 分支上**，
master 一行都没有。**一个只读 `tasks/*.md` 的看板会理直气壮地显示「已完成」**——那正是这两批
（合计 17,512 行）滞留一整天没被发现的原因。

⇒ **有用的视图必须 join 三个源**：任务库（**意图**）+ 遥测（**执行**）+ git（**落地**）。
而且**三者不一致本身是最有价值的显示项**——2026-08-02 的每一个真发现都来自这种不一致。

### 2.2 实时视图必须读**原始事件**，不能读日聚合

`gap-telemetry-report-writes-and-deadlocks-readiness` 落地后，`--report` 是纯读、
日聚合**只在显式 `--snapshot` 时更新**。实测 2026-08-03 00:46Z：聚合的最后更新是 23:54Z，
**落后 52 分钟**。

⇒ 读 `.workflow-events/*.jsonl`（gitignored、实时、18 个文件），**不要读**
`milestones/fast-mode-telemetry/<date>.json`。这条必须写死在实现里——聚合文件「看起来更整洁」，
不写明的话几乎必然被选中。

### 2.3 显示**已被记录的判断**，不要现场生成新判断

最有用的信息往往是判断（「这个卡住了因为 X」「这条声称未验证」），而判断正是要花推理成本的部分。

2026-08-02/03 的全部判断**已经落盘**：`orchestration/escalations.md`（攒给人的决定，含选项与建议）、
`orchestration/tick-log.md`（每次介入及其证据）、任务体的实测记录段。它们是**当时带着证据写下的**，
比事后重新总结既便宜又可靠。

⇒ 观察面渲染这些已有文件，**不调用任何模型**。「不需要额外推理成本」不是妥协，是正确的约束。

## 3. 架构张力：Core 不该知道工作区细节

CLAUDE.md 的约束是明确的：**Core 只针对任务视图模型编写，从不针对具体后端**。而遥测、git、
会话 transcript **都不是 provider 数据**——它们是工作区本地的产物。

若把它们直接读进 `serve-handlers.ts`，就是让 Core 长出对某种工作区布局的依赖。

**处置：做成一个明确分层的可选观察源，而不是把它混进任务渲染路径。**

- 新增 `packages/quay/src/observation.ts`：**唯一**知道 `.workflow-events/`、`git`、
  `orchestration/*.md` 存在的地方；导出纯函数，输入是工作区根路径，输出是普通对象
- **全部可缺省**：任一源不存在时返回空，页面照常渲染，只是少一列。
  一个只有任务库的 quay 工作区（产品用户的常态）必须完全可用
- `serve-handlers.ts` 只消费它的输出，不知道数据怎么来的
- **provider 路径完全不变**——任务本身仍然只经 Provider ABI 读

这样阶段 2 产品化时，观察面是一个**可插拔的能力**，不是 Core 的新依赖。

## 4. 增量（分两步，第二步依赖一个尚不存在的契约）

### 第一步：三源 join 的只读看板（零推理成本，数据全现成）

**不改任何现有路由**，新增：

| 路由 | 内容 | 数据源 |
|---|---|---|
| `/board` | 任务列表 + **意图/执行/落地三列** + 不一致高亮 | 任务库 + `.workflow-events/` + `git log` |
| `/live` | 当前在飞任务、各自已运行时长、并发数、当前负载 | `.workflow-events/` 的 start/end 配对 |
| `/journal` | 升级项、tick 记录、最近落地的提交 | `escalations.md`、`tick-log.md`、`git log` |

**不一致的定义**（这是 `/board` 的核心，不是装饰）：

| 显示 | 判据 |
|---|---|
| `done 但未落地` | frontmatter `done` + `## Touches` 的代码根条目在 master 上不存在 |
| `已落地但未收尾` | 代码在 master + 遥测无 `--task-end` |
| `在飞超时` | `--task-start` 后超过阈值仍无 end |
| `孤儿` | 有 start 无 end 且进程已不存在 |

刷新用服务端渲染 + `<meta http-equiv="refresh">` 或小轮询。**不需要 WebSocket**——
数据变化的时间尺度是分钟。

### 第二步：当前执行的动态信息（**先要契约，不要先做**）

人还希望看到「最近的 Claude Code 输出」。这一步**不建议立刻做**，理由是实测出来的：

- **transcript 不是稳定接口**。它是 Claude Code 的内部格式。2026-08-02 逆向时撞到两个坑：
  subagent 的工具调用**不在主 transcript 里**（在 `<会话 UUID>/subagents/`），
  以及 `/clear` 会新建会话文件导致历史**静默截断**。两者都已在
  `orchestration/watch/inner-forensics.mjs` 里处理，但那是逆向出来的，不是契约
- **「当前在执行」这个概念本身需要定义**。遥测的 `inProgress` 在 2026-08-02 误导过三次：
  任务已合并但 `--task-end` 未调、修复类工作跑在任务括号之外、测试污染造出幽灵记录
- **展示 transcript 尾部有泄露面**：agent 打印过的任何东西都会进那个文件

**更好的路径**：让内层**主动写一个稳定的状态文件**，观察面读它。
`gap-no-explicit-blocked-signal-from-inner-layer` 正在做的 `.quay/inner-blocked.json`
就是这个形状的第一个实例——存在性信号、结构化、不依赖内部格式。
把「当前在做什么」用同样的方式表达，比解析 transcript 稳固得多。

## 5. 与产品化的关系

`orchestration/exp6-phase1-sustained-unattended-operation.md` §D 记录了双层机制产品化的两个缺口，
其一是**层间通信不能靠读屏**（ADR-016 已判定 TUI 抓取是权宜手段）。

**本提案的第一步就是那个缺口的正解**：一个 HTTP 表面既给人看、也给外层用、还能给未来的产品用户用。
`inner-forensics.mjs`（解析 transcript、合并 subagent、处理 `/clear` 断裂）实际上已经是这个视图的
数据层原型——它该被吸收进 `observation.ts`，而不是长期作为编排会话的私有脚本。

## 6. 明确不做

- **不调用模型**。观察面是文件读取加算术。任何需要推理的显示项，改为渲染**已经落盘的判断**
- **不改现有路由与 provider 路径**。`/`、`/adr`、`/task/<id>` 的行为逐字节不变
- **不引入缓存**。现有实现每请求实时读，这是对的；观察面同样每请求读
- **不做 WebSocket / SSE**。数据变化尺度是分钟
- **不把观察源做成必需**。缺任一源时页面少一列，不是报错

## 7. 开放问题

1. `/board` 的不一致判据需要读 `## Touches` 并解析路径——那是
   `task-status-drift-check.ts` 已有的逻辑。是复用它（引入对 `plugin/scripts/` 的依赖）
   还是在 `observation.ts` 里重实现（重复逻辑，会漂移）？倾向复用，但要确认依赖方向可接受
2. 多工作区/多 provider 时，观察源的根路径怎么定？当前假设「一个工作区一个 serve」
3. 第二步的稳定状态文件，格式是否应与 `.quay/inner-blocked.json` 统一为一族
   （如 `.quay/agent-state.json`），还是各自独立
