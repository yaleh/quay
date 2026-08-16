# SPEC：inner 改造为「机械驱动进程 + per-task worker 会话」

**作者**：manager｜**日期**：2026-08-16｜**状态**：proposal，**待人裁定排期**
**来源**：人 2026-08-16 03:1xZ 提出方案 + 03:3xZ 逐条裁定六个设计点（原文见 §1）。

---

## 0. 一句话

**把 inner 从「一个长命会话 + N 个 subagent」改成「一个机械驱动进程 + N 个 per-task `claude -p` worker 会话」，
并发由驱动进程数子进程控制，而不再由模型自己数 subagent。**

---

## 1. 人的裁定（本 SPEC 的来源，逐字）

> **工作范围**：从 ready 中选取可执行任务（并修改不符合 ready 要求的任务状态，让 outer 等可以接手处理）派发；
> 为派发的每个任务运行任务 subagent 进行开发；为开发完的任务运行相应 workflow 执行 suite 测试和 merge 回 develop。

> **驱动机制**：一个持续运行的进程，选择任务，然后为该任务启动一个 claude -p 会话（worker 会话），
> 调用一个 workflow 执行上述任务检查（包括修改状态）、开发、suite 测试和 merge 工作。
> 每个任务一个 claude -p 会话，并发会话数由外层进程机械控制（不再控制 subagent 数）。

**六个设计点的裁定（2026-08-16 03:3xZ，逐字）**：
1. **选择权**：「同意 B 方案（短命 selector worker）。**选择仍应是语义的**，选择后由驱动机械记录选择并再启动 worker 会话，这样更好控制。」
2. **状态写入 / 主检出**：「驱动 checkout 时发现未提交变更即 **stash**；manager/outer 的变更也在**自己的 worktree** 工作
   （且时间应尽可能短，尽快合并到 develop），**主检出纯粹是驱动的镜像**。」
   「**worker 只管 merge 到 develop**」「**驱动进程不应自己做任何 commit**」
   「除了最后的 merge，**worker 不应再对 develop 做其它操作**」
   「**接受暂不在任务上增加「开发中」状态。仅由驱动在自己的内存中记录正在开发的任务。**」
3. **时长**：「设 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`」+「**驱动有外部超时（单任务墙钟）。超时即杀 worker 会话，但保留 worktree。**」
4. **跨任务模式识别**：「这些 inner 的行为检查，**应由 outer 执行**。」
5. **孤儿进程**：「**接受这一风险，由驱动检查。**」
6. **MCP 控制面**：「`.halt` 的边界语义**同意**保持」「**调用方身份必须显式传**（header 或 tool 参数）」

**⊕ 一条贯穿性的设计原则（人 2026-08-16 逐字，本 SPEC 的方向盘）**：
> **「现有许多检查机制是为了在现有模式下给不可靠的 LLM 驱动的开发过程做保底。
> 我希望这样的操作在新模式下可以减少，或者集中到驱动内部，而不是散落在多个工具相关的机制中。」**

⇒ **本 SPEC 的成功判据之一，是【检查机制的净减少】，不只是「跑起来了」。** 见 §5。

---

## 2. 它消掉了什么（2026-08-15/16 的实测，不是理论）

```
① AC76 整个问题类
   现状：「在飞」有三个代理量，实测双向偏差 —— worktree 4 / subagent 2（高估 2）；worktree 1 / subagent 2（低估 1）
   根因：让被测对象自己数自己（硬规则 4b）
   新模型：在飞 = 驱动进程自己 fork 的子进程数 ⇒ 直接量，不是估的

② subagent 预算天花板
   CLAUDE.md 实测：会话级累计 spawn 上限、燃烧率 ~60/天、默认额度约 3 天、触顶后【静默】降级为主线程串行
   已付代价：三层 + 人花数小时反复误诊为「outer 不派发 / inner 自锁 / 唤醒链断」，全错
   新模型：每 worker 一个会话，预算各自独立且几乎不 spawn

③ 「空槽 + 池里有货 + 就是不派」的两个成因
   CLAUDE.md 记的两个：subagent 预算触顶；inner 长时间占用回合做主线程编辑
   （实测一夜 4 段 54–149 分钟空档、占窗口 52%）—— 两个都是单会话病理

④ 义务随【会话长度】衰减 → 改为随【任务长度】衰减
   SPEC-tick-mechanical-checks-mcp §8 实测规律：「凡每轮从上下文外部重新物化的都 100%，
   凡需跨轮存活在上下文内的都衰减」
   活样本：manager 自己 2026-08-16 判准逐条【连续 13-14 小时零应用】（自审抓到），因忙于死锁协调
```

---

## 3. 目标形态

### 3.1 组件

```
驱动进程（常驻，机械，无 LLM）
  ├── 选择环：调 ready-pool-check 取可行集 → 减去内存中的在飞集 → 打散 → 交 selector
  ├── selector worker（claude -p，短命，秒级）：读倾向文件 + 无序可行集 ⇒ 返回一个 task id + 一句理由
  ├── 记录：驱动机械记下「选了谁、理由是什么」（结构化，outer 可消费）
  ├── task worker（claude -p，一任务一个）：worktree → 开发 → suite → ff merge develop
  ├── 并发控制：驱动数自己的子进程，达 cap 则不再起新 worker
  ├── 超时：单任务墙钟超时 ⇒ SIGTERM worker，【保留 worktree】
  └── MCP 面（HTTP/SSE）：halt / setPreference / forceDispatch（调用方身份显式传）
```

### 3.2 权责边界（人裁定的硬线）

```
驱动    ⛔ 不做任何 commit      ⛔ 不调用 LLM 做判断      ✅ 起/杀 worker、数并发、超时、stash 主检出、记录 outcome
worker  ✅ 自己的 worktree 内全权（开发/改任务状态/跑 suite）  ✅ 最后 ff merge 到 develop
        ⛔ 除最后的 merge 外，不对 develop 做任何操作
主检出  纯粹是驱动的镜像 —— 驱动 checkout 最新 develop 前，若发现未提交变更即 **stash**（⛔ 不 discard）
manager/outer  在【自己的 worktree】工作，时间尽可能短，尽快合并到 develop
```

**⊢ 为什么主检出必须干净（机制根源，实读）**：`plugin/scripts/fan-in-ff-merge.sh:155-158` 在**主检出**上跑
`git merge --ff-only`，`:174-177` 硬性要求 `git status --porcelain` 为空。**这就是 2026-08-16 死锁的机制根源**
（三层未提交改动 → 主检出恒脏 → inner 的 ff 被 dirty-check 挡 exit 2 → 修闸的 fix 进不去 → guard 恒红）。

**⊢ 为什么是 stash 不是 discard（人裁定，且有实证支撑）**：2026-08-16 实测，manager 的 AC63 勾选因
**别层造成的** guard 红（`red-on-omission c3_resource_gate uncov=1`，根因是 outer 退役 C3 漏了消费者 + inner 的
audit fix 未 land）被挡约 1 小时。**「及时 commit」在 guard 红期间结构上做不到**；discard 会销毁在飞工作，
stash 同样让主检出干净但**可逆**——那次正是 stash 救回了 AC63。

### 3.3 「开发中」状态：不加（人裁定）

**裁定**：不在任务上增加该状态；**仅由驱动在自己的内存中记录**正在开发的任务。

**⊢ 由此产生的两条实现约束**：
```
① 驱动必须在【传给 selector 之前】从可行集里减去内存中的在飞集
   —— 否则 selector 会选到已在跑的任务（ready-pool-check 不知道在飞）
② 驱动重启 ⇒ 内存态丢失。恢复只能靠【扫描】（worktrees + task/* 分支），
   而「一棵 worktree」既可能是在飞、也可能是超时保留的残留 ⇒ 恢复规则必须显式定义，⛔ 不能默认
```

---

## 4. 必须定的实现约束（人已同意的四条 + 恢复规则）

```
① selector 拿到的可行集必须【无序】
   AC56（去锚）逐字：「机制输出不再携带有意义的序」——理由是 recommended 的序退化成 1/cost，
   selector 拿到有序列表会被锚定。⇒ 驱动打散或显式标注「序无意义」后再传。

② 状态修复的重试必须有上限
   worker 退出后驱动机械检查任务状态；若不对则再起会话修复。
   ⚠️ 若 worker 写错状态是因为它 crash，修复会话也可能 crash ⇒ 必须「重试 N 次后标 needs-human 并停止自动重试」，
   否则是无限循环。

③ 驱动必须发出【可消费的结构化 outcome 记录】（JSON）
   人裁定「跨任务的行为检查由 outer 执行」⇒ outer 不再像今天的 inner 那样亲历每个任务，
   它只能读记录。⇒ 每任务一条：{task, selector 理由, worker exit code, 墙钟, 终态, 失败原因}。
   **没有这个记录，outer 无从做跨任务检查** —— 而今天 inner 正是靠跨任务记忆抓到
   「delivery-inventory drift 是第三个漏索引，全指向 send-to-session.ts」。

④ 单任务墙钟超时值 ⛔ 不得拍脑袋
   硬规则 4 推论：成本结构未知前不设阈值。
   可用基线（2026-08-15/16 实测）：per-task suite 单轮 95.3s–565s；完整任务（开发+suite+merge）量级为十几分钟到一小时。
   ⇒ 先【无阈值 + 记录时长分布】跑一段，再据分布定值。
   ⚠️ `BG_WAIT_CEILING_MS=0` 移除了 Claude Code 的内部等待上限 ⇒ 外部超时是【唯一】的兜底，不设 = 卡死的 workflow 永久占槽。

⑤ 驱动重启的恢复规则（§3.3② 的展开，必须显式定义）
   内存态丢失后，如何区分「在飞的 worktree」与「超时保留的残留 worktree」？
   ⛔ 不得默认「有 worktree = 在飞」（今天实测：worktree 数与真实在飞双向偏差）。
```

---

## 5. 成功判据（三阶段，每阶段单独可证伪）

**⊕ 贯穿判据（人的设计原则，§1 ⊕）**：**检查机制净减少** —— 每阶段必须列出「本阶段【退役】了哪些为兜底 LLM 不可靠而存在的检查」。
⛔ 只报「新机制跑起来了」而不报退役清单，不算达成。

### 阶段 1：驱动 + 单 worker（风险最低，可立即做）

```
形态  驱动 spawn 一个 claude -p worker 跑一个完整任务（选择 → worktree → 开发 → suite → ff）
判据1 在飞 = 驱动的子进程数（直接量，非估计）——与任何代理量读数比对，不一致时以驱动为准
判据2 worker 退出码 + 结构化 outcome 记录落盘，字段齐全（§4③）
判据3（能取假）杀掉 worker ⇒ 驱动必须察觉并记录，⛔ 不得静默丢失该任务
退役清单  本阶段应能退役：--in-flight 参数传递（slot-refill）、遥测括号的「在飞」用途
```

### 阶段 2：并发 N + stash 镜像

```
形态  驱动控并发数、超时杀 worker（保留 worktree）、checkout 前 stash
判据1 N 个 worker 并发跑，主检出 git status --porcelain 恒为空（除 ff 持锁段的瞬时）
判据2（能取假）故意在主检出留一个未提交改动 ⇒ 驱动必须 stash 它（可从 stash list 核实），⛔ 不得 discard
判据3 超时路径：构造一个卡死 worker ⇒ 驱动在墙钟超时后 SIGTERM，且 worktree 仍在
退役清单  本阶段应能退役：cap-from-gate / process-budget 的并发裁决用途、A6「检查 fan-in 是否走 workflow」
          （驱动直接调 workflow ⇒ 不需要事后检查它有没有走）
```

### 阶段 3：MCP 控制面

```
形态  驱动暴露 HTTP/SSE MCP：halt / setPreference / forceDispatch
判据1 halt 的语义 = 停止新派发、⛔ 不杀在飞（与现 .halt 边界语义一致）
判据2 调用方身份显式传且可核 —— MCP 的 Mcp-Session-Id 只能区分「连接」，
      2026-08-16 实测：它【不知道】调用方是 outer 还是 manager ⇒ 身份必须走 header 或 tool 参数
判据3（能取假）用一个不带身份的调用 ⇒ 必须被拒，⛔ 不得按默认身份放行
退役清单  本阶段应能退役：.halt 文件机制（被 MCP halt 取代后，⛔ 不得两者并存——那会变成两个真相源）
```

---

## 6. 可行性已验证的部分（2026-08-16 实测，非推断）

```
✅ claude -p 的工具集与交互式会话【完全相同】
   实测 system/init：Task/Bash/CronCreate/CronList/ListAgents/Monitor/ScheduleWakeup/SendMessage/
   Skill/Task*/WebFetch/WebSearch/Workflow/Write/Edit + 5 个 MCP server
   ⚠️ 前提：非 --bare（--bare 只有 Bash/Read/Edit）
✅ -p 会话能收消息并执行并发回
   实测：SendMessage → p-worker → Bash(ls) → SendMessage 发回，全链路通
✅ 从 shell 给 -p 会话发消息（send-to-session.ts）
   实测：send-to-session.ts --pid <p-worker pid> → 收到并执行 ⇒ 外部驱动可注入指令
✅ per-task worktree 隔离 + ff 锁已存在
   plugin/scripts/fan-in-ff-merge.sh + .quay/fan-in-merge-lock-events.jsonl + fan-in-execute.js（无锁段/持锁段）
```

---

## 7. 会变差的两件事（人已显式接受）

```
① 跨任务模式识别丢失
   今天的实例：inner 抓到「delivery-inventory drift 是第三个漏索引」——需要跨任务记忆。
   per-task worker 只看见自己那一个任务，【没有任何 worker 能说出「这是第三次」】。
   人裁定：由 outer 执行 ⇒ 依赖 §4③ 的结构化记录。
② 孤儿进程风险 × N
   memory 记录：TaskStop 清了 subagent 主进程但留下 ppid=1 的孙进程。
   人裁定：接受，由驱动检查。
```

---

## 8. 不覆盖

- **不改 manager 的 tick 机制**：manager 仍是交互式会话 + CronCreate 锚（`claude -p` 不能自带长期 cron —— 2026-08-16 实测确认 cron 是 session-only）。
- **不改 outer 的层定位**：outer 仍负责语义倾向、needs-human 裁定、跨任务模式检查。
- **不规定驱动的实现语言与部署形态**：那属实现面。
- **不在本 SPEC 内立 AC**：按人的排期裁定再立。
