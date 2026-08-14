# SPEC — 「在飞」的完整语义与派发量的单一定义（2026-08-14）

**立此 SPEC 的裁定**：人 2026-08-14 12:5xZ「如果保持当前的 in-flight 语义，则应明确派发任务不应看这个值，
而应看『当前 inner 在跑的任务 subagent』」+ 12:5xZ「请检查本项目在这一点上发生过的错误，
完整考虑 inner 派发任务相关的语义，给 outer / inner 明确和完整的建议」。

**边界**：本 SPEC 由 manager 维护。**实现全部归 outer（立案）/ inner（落地）**，我只给定义、判据与读法。

---

## §1 为什么需要这份 SPEC —— 同一个量被修过 **10 次**，今天又从两个相反方向各错一次

**逐条枚举（非抽查，全部已立案）**：

| # | 任务 | status | 偏差方向 |
|---|---|---|---|
| 1 | `gap-slot-refill-inflight-disconnected-from-worktrees` | done | 低报（`in_flight=0` 而 worktree 有） |
| 2 | `gap-telemetry-brackets-vs-subagents-no-slot-visibility` | done | 括号不反映真实并发 |
| 3 | `gap-telemetry-underreport-nontask-subagents-not-counted-in-slots` | done | **低报**（非任务 subagent 没计） |
| 4 | `gap-closed-bracket-leaves-live-agent-consuming-slots` | done | **低报**（括号关了 agent 还活） |
| 5 | `gap-worktree-leak-after-fan-in-occupies-slot-permanently` | done | **高报**（合并后没删树，永久占槽） |
| 6 | `gap-ac76-cap-counts-subagents-not-worktrees` | done | 计量对象错（worktree 当 subagent） |
| 7 | `gap-in-flight-resolve-by-task-id-not-worktree-name` | **ready** | **低报**（目录名截断 ⇒ 少算 1） |
| 8 | `gap-dispatch-gate-blind-to-inflight-merge-worktree` | done | 低报（看不见 merge worktree） |
| 9 | `gap-fixed-cap-5-dynamic-cap-retired` | done | cap 本身算错（布尔被包装成数字） |
| 10 | `gap-test-concurrency-cap-does-not-scope-nested-spawns` | done | 作用域错（只管单层） |

**2026-08-14 当天再加两次，方向相反、根相同**：
```
① worktree 目录名截断（缺 -unchecked）⇒ 在飞【少算 1】⇒ slots_free 虚高
   ⇒ AC53 END 闸误拒心跳 ⇒ 观测面全黑 4.7 小时
② 把 awaiting-retry 的任务算进在飞 ⇒ 在飞【多算 2】⇒ slots_free 虚低
   ⇒ inner 以为槽满不派（实测真实并发 subagent 3 · 自述 5 · 五棵 worktree 内活进程全 0）
```

**⇒ 根因不是任何一次的实现 bug，是【这个量从来没有一个单一定义 + 单一读法】。**
**十次修的都是某一个读法的某一处偏差，而下一个消费者又用了另一个读法。**

---

## §2 完整语义地图 —— 八个候选量，各自答什么、各自会怎么骗人

| 量 | 读法 | 它答的问题 | 已实证的骗人方式 |
|---|---|---|---|
| **Q1 worktree 数** | `git worktree list` | 有多少任务**未落地** | **高报**：泄漏树永久占（#5）；**低报**：主线程直改无树 |
| **Q2 遥测开括号** | `.workflow-events/fm-*.jsonl` | 有多少任务**被派发过** | **单调增**：`--task-end` 实测 0/3 写过 ⇒ 只增不减（2026-08-14 实证） |
| **Q3 任务 status** | `tasks/*.md` frontmatter | 任务的**结局** | 在飞期间恒为 `ready`，**不区分「在跑」与「等重跑」** |
| **Q4 任务 subagent** | `<session>/subagents/agent-*.jsonl` 近 N 分钟有写入 | **此刻有几个任务 agent 在跑** | **窗口敏感**：≤5min 与 ≤20min 给不同的数 ⇒ **必带窗口** |
| **Q5 workflow agent** | `subagents/workflows/<run>/agent-*.jsonl` 同上 | **此刻有几个 fan-in 在跑** | 同 Q4；**且 meta-cc 搜不到它**（须 `grep -r`） |
| **Q6 非任务 subagent** | 调查型 agent | 它们**也占并发** | 曾完全没计入（#3） |
| **Q7 worktree 内活进程** | `/proc/*/cwd` 前缀匹配 | 该任务**有没有真的在算** | 长命令间隙为 0；**只能证伪不能证实** |
| **Q8 cap** | 固定 5 | 上限 | 曾是被包装成数字的布尔（#9） |

**⚠️ 八个量互不等价，且今天同刻实测出现过 3 / 4 / 5 三个不同的「在飞数」**
（`--in-flight` 分别传 worktree 目录名 / 分支名 / 真任务 id）。

---

## §3 裁定的落法 —— **两个消费者，两个定义，都保留**

**人 12:5xZ 的裁定不是「修 in-flight」，是【把一个被两个消费者共用的量拆成两个】。**

```
消费者 A · 触碰面不相交判定（dispatchable_disjoint / checkTouchesPair）
   定义 := 所有【未落地】任务（Q1 worktree ∪ Q3 status≠done），含 awaiting retry
   理由   := 等待中的任务 worktree 还在，新任务碰同样文件会撞 —— 这里必须【宽】
   ⊢ 若它漏掉一个未落地任务 ⇒ 派发会撞（#8 就是这个）

消费者 B · 槽位计数（slots_free / should_refill / cap 判定）
   定义 := 当前在跑的任务 subagent 数 = Q4 + Q5（+ Q6 非任务 subagent，若也吃并发）
   理由   := 人 07:3xZ「cap=5 就是为了保护 subagent」+ 09:1xZ「在飞应当查 inner 任务 subagent」
             awaiting retry 没有 subagent ⇒ 不占 cap
   ⊢ 若它把没有 subagent 的任务算进去 ⇒ 槽空转（今天 ② 就是这个）

消费者 C · spawn 预算
   定义 := 【不自建计数】——只检测 harness 报错 `Subagent spawn limit reached`（AC77 人裁定）
   ⊢ 任何层出现 subagent 计数代码 ⇒ 违反 AC77

消费者 D · 观测/升级（心跳、A3、A13）
   定义 := 读产物（心跳 jsonl 行数、dispatch-record 的 reason、slot-refill 调用记录）
   ⊢ ⛔ 用受闸影响的量当活性信号（今天实证：`.json` 的 mtime 受 AC53 END 闸影响）
```

---

## §4 给 outer / inner 的明确建议（可直接落判据）

### 建议 1（最高价值）：**把「在飞」这个词从代码与文档里拆成两个词**

**⊢ 判据**：代码/核里出现裸 `in-flight` / `在飞` **而未标明是 A 还是 B** ⇒ 未落地。
**建议命名**：`unlanded_tasks`（A）/ `running_subagents`（B）。
**理由**：**十次修都发生在「同一个词、不同读法」上**。改名是唯一能让下一个消费者不再猜的动作。

### 建议 2：**`slot-refill` 的两个分母必须允许不等**

**⊢ 判据**：同一时刻 `dispatchable_disjoint` 的分母与 `slots_free` 的分母若取自同一集合 ⇒ 未落地。
**⊢ 能取假·真样本不构造**：今天两条现成 ——
`gap-workflows-dual-copy-drift`（名字截断 ⇒ A 对 B 错）与 `awaiting retry` 两条（A 对 B 错，方向相反）。

### 建议 3：**B 的读法写死为直接量，并强制带窗口**

```
running_subagents := |{ f ∈ <session>/subagents/agent-*.jsonl
                        ∪ <session>/subagents/workflows/*/agent-*.jsonl
                      : mtime(f) 距今 ≤ W }|
```
**⊢ 报数必带 W**（今天实测 ≤5min=1、≤20min=4，同一时刻）。**⛔ 用 Q1/Q2/Q3 代替。**

### 建议 4：**给「等重跑」一个独立状态，别让它借住在「在飞」里**

今天两条 `awaiting retry` 任务：**有 worktree、有 ready 状态、没有 subagent、没有活进程**。
**⇒ 它们对 A 是「未落地」（正确），对 B 是「不占槽」（正确），而现在两者共用一个集合 ⇒ 必然有一头错。**
**⊢ 判据**：任务存在一个可机械读的「是否有活执行体」标记；**⛔ 靠 status 或 worktree 推断**。

### 建议 5：**AC53 闸不要动，动的是喂给它的量**

闸本身经核实是对的（判在直接量上、明文拒读自报字段、有第 7 次同形的负控制）。
**今天它两次「误动作」都是输入错**：少算 ⇒ 误拒；多算 ⇒ 该拒时它其实该放行。
**⊢ 判据**：任何「闸误报」的立案，**必须先给出【喂给它的量】与【它期望的量】的对照**，否则不得改闸。

### 建议 6（给 inner，顺序性的）：**先落建议 2/3，再做那次空槽测量**

我和 outer 约好「下次空槽 outer 先等一轮，看 inner 自不自驱」。
**⚠️ 空槽【现在就有】（真值 2），而 inner 因多算看不见** ⇒ 照原计划测，会得到
「inner 不派 ⇒ 自驱没恢复」的**错误结论**。**⇒ 先修 B，再测。**


---

## §6 全系统的间接表征普查（人 2026-08-14 13:0xZ「尽可能用直接的观测量，避免间接的表征；系统检查这些表征和引用，建议改进方案」）

### §6.1 机械读数：三层记录间接表征的能力极不对称

```
manager-tick-core.md        34 条 ⛔（每条都是一个已识别的间接表征禁令）
orchestrator-tick-core.md    0 条
fast-mode-tick-core.md       0 条
```
**⚠️ 这不表示 outer/inner 没有代理量** —— 今天两条实证正相反：inner 用 **worktree 目录名/分支名**当任务 id、
outer 报池数**不减在飞**。**⇒ 差别在于【有没有把踩过的代理量登记下来】，不在于有没有踩。**

### §6.2 全系统代理量分类（按「它代理的直接量」归并，每条都有实证）

| 代理量（间接） | 它代理的直接量 | 已实证的失效方向 |
|---|---|---|
| **A 谁在跑 / 几个在跑** | | |
| `git worktree list` 条数 | 并发任务 subagent 数 | **双向**：泄漏树高报；主线程直改低报；awaiting-retry 高报（今日） |
| 遥测开括号 `.workflow-events/` | 同上 | **单调增**（`--task-end` 实测 0/3 写过） |
| pane 忙闲（`esc to interrupt`） | 会话是否在处理 | pane 在而 tick 停 21 分钟（已实证） |
| worktree 内活进程 `/proc/*/cwd` | 该任务是否在算 | **秒级波动**：同刻 outer 测 9/1、我两次测全 0 ⇒ **只能证伪不能证实** |
| `process-budget` / `cap-from-gate` | 可用并发 | 报 `in_use=5` 而实测 2 ⇒ 已降为**纯观测，不参与裁决** |
| **B 某事做没做** | | |
| 任务 `status: done` | AC 是否满足 | **13/27 背离**（今日实测，6 条零勾） |
| tick-log 里记了一笔 | 是否升级/处置 | **我自己 8 轮记笔零升级** |
| 「>N 周期未调用就要记」 | 是否调用 | 空档 4h12m、12 轮零调用而条款一次没报 |
| 心跳自述字段 | 层是否在自驱 | **受 AC53 闸影响**：闸拒 ⇒ 不写 ⇒ 与「没跑」同形 |
| **C 某物是不是那个物** | | |
| 凭记忆猜的文件名 | 声明它的那一行 | 三次实证（`preference-change-notify.ts` 等全不存在） |
| worktree 目录名 / 分支名 | 任务 id | 同刻三写法得 `in_flight_count` **3/4/5**（今日） |
| 关键词匹配 | 按位置判定 | 首跑 3 次假阳性；`grep -c` 把自己数进去 |
| 「提及次数」 | `Agent.description` | 票差 35:36 噪声级，**100% 错** |
| **D 时间 / 新鲜度** | | |
| 文件 `mtime` | 内容里的时间戳 | 合并重写元数据不重写文件名（99 封信被读成「12 分钟前刚到」） |
| 固定周期常数（`17 min`） | 上一条实际触发时刻 | `*/17` 实为 0/17/34/51，**最短间隔 8.2 分钟** |
| `cache_read_input_tokens` | 会话是否饱和 | **单调增、永不回落 ⇒ 判别力贡献 0** |

### §6.3 建议：不是「消灭代理量」，是**给每个代理量登记它的三件事**

**⚠️ 消灭不现实**：有些直接量不可得（跨会话的 subagent 内部状态）或太贵（每轮翻 126 个 transcript）。
**⇒ 可执行的目标是：代理量可以用，但【必须声明】。**

**建议 A（产物·最高价值）：建一张【代理量登记表】，三层共用一份**
每个代理量一行，三栏缺一不可：
```
代理量 | 它代理的直接量 | 失效条件（已实证的偏差方向）
```
**⊢ 判据**：任何判定/条款引用一个量，**而该量在登记表里没有行** ⇒ 未登记，不得作为裁决依据（可作观察项）。
**⊢ 能取假**：本 SPEC §6.2 的 14 行就是**现成的初始表**，且每行都带实证 —— **回放任一行，若判定仍把它当直接量用 ⇒ 红**。

**建议 B：三层核统一用 `⛔` 标记代理量禁令**
现状 34 / 0 / 0。**⊢ 判据**：核里出现「用 X 判 Y」而 X 在登记表里是 Y 的代理 **且该行无 `⛔` 或无失效条件** ⇒ 未落地。
**理由**：`⛔` 是唯一一个**一条 grep 就能盘点**的标记，manager 的 34 条正是这样被我今天一次性盘出来的。

**建议 C：优先替换「双向失效」的那几个**
表里多数代理量**只往一个方向偏**（可用保守侧兜底）；**而 `worktree 条数` 与 `worktree 内活进程` 是双向的**
—— 双向偏差**无法用任何单侧余量兜底**，必须换直接量。**⇒ 这两个是替换优先级最高的。**

**建议 D：给「只能证伪不能证实」的量单独标注**
`worktree 内活进程` 今天同刻给出 9/1 与 0/0 两组读数（不同时刻）。
**⊢ 判据**：这类量**只允许出现在「若为真则 X」的前件**，**⛔ 出现在「若为假则 Y」的前件**。
**理由**：它为 0 可能只是长命令之间的间隙。

**建议 E（给 outer/inner 的顺序）**：**先登记，再替换。**
登记是一次性的（表已有初始 14 行），替换是逐个的。**先登记的收益**：下一次有人引用一个代理量时，
**「它代理什么、什么时候会骗人」是查得到的**，而不是像今天这样——**同一个量被修 10 次，每次修一处偏差。**

---

## §5 本 SPEC 自身的失效条件

- **cap 语义再次改变**（如从「并发 subagent」改回别的） ⇒ §3 消费者 B 的定义须重写。
- **AC77「不自建计数」被推翻** ⇒ 消费者 C 整条作废。
- **§1 的十次实例中任何一条被证明不属本族** ⇒ 发生率读数须重算（本 SPEC 的立条依据是发生率，硬规则 12）。
- **本 SPEC 自己适用 C28**：上面每个量都写了「它答什么问题」；
  **⊢ 若某个量的「它答什么问题」写不出来，它就不该出现在任何判据里。**
