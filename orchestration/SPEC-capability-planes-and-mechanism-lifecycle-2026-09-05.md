# SPEC：能力面分层与机制生命周期 —— probe 驱动化 · Layer 0 强制继承 · 机制注册表

**作者**：manager｜**日期**：2026-09-05｜**状态**：proposal，**待人裁定**（§6.3 与 §9 各有一处必须由人裁定的分岔）
**来源**：人 2026-09-05 讨论轮，逐条要求：①「需要一个更统一的事件（包括时间事件）驱动的机制（现在看就是 driver），
并在这一机制上进一步构建更多能力」；②「probe 也应当使用 driver 驱动（如 probe-driver）；archguard 应当用到一个架构 probe 中」；
③「有哪些机制应当被 driver 替代？哪些应当使用 driver 驱动？」；④「建议一个更有层次的且能支撑更长期演化的架构，
而不是像现在这样平铺出很多机制……机制的演进将持续存在，但我希望更清晰，而不是像现在这样沉默地保留了大量废弃的机制」。

**⛔ 本 SPEC 的第一约束：它不是第二份 driver 架构正本。**
`SPEC-unified-driver-architecture-2026-08-23.md`（546 行）是 driver 架构的正本，
其 §5（2026-08-24 人裁定「同意上述方案」）已经裁定了事件模型。**本 SPEC 不重开该 SPEC 已裁定的任何一条**，
分工见 §1。本 SPEC 只做三件它没有覆盖的事：**能力面（probe）· Layer 0 继承的强制化 · 机制生命周期面**。

---

## 0. 一句话

**把「能力」而不是「文件」作为架构的单元**：一个能力 = 一个 `RoutineSpec` 或一个 task-processing kind，
挂在已有的 driver 运行时上（**不新增 kind，probe 是 routine 的 LLM 形态**）；
**并给每个机制一个显式的生命周期状态**——因为今天「文件还在、但没人消费」这个状态在系统里**无法被表示**，
而这正是「沉默保留大量废弃机制」的机械成因，不是纪律问题。

---

## 1. 与既有 SPEC 的分工（先划界，防止本文件成为第二份正本）

| 08-23 SPEC 的裁定 | 本 SPEC 是否重开 | 本 SPEC 做什么 |
|---|---|---|
| §2.1 两级抽象 Layer 0 / 1a / 1b | ⛔ 不重开 | 记录它**未被强制**的实测证据，补一条可取假的继承判据（§4） |
| §2.2 + §5 事件模型（水平触发的协调循环；事件携带触发不携带决策；定时器是地板） | ⛔ **绝不重开**（人 2026-08-24 已裁定） | 只记录 §5 的**落地状态**与补齐判据（§3.1） |
| §2.3 出站通知 / §2.5 profile / §2.6 配置与控制态分界 | ⛔ 不重开 | 不涉及 |
| §4.2 manager 定时任务下沉 | ⛔ 不重开 | 不涉及；但 §6 的注册表会覆盖其产出物的消费面 |
| §5.8 落地顺序 1–5 | ⛔ 不重开 | 本 SPEC 的落地顺序（§10）**排在其后**，不与之竞争 |
| —— | —— | **新增**：能力面（§5，probe 驱动化 + archguard 落位） |
| —— | —— | **新增**：注册/生命周期面（§6，ADR-035 的实施形态） |
| —— | —— | **新增**：kind 声明收敛（§7，实测新增成本 16 处） |

**⊢ 判据（本节的取假形态）**：若本 SPEC 的任何一节对 08-23 SPEC 已裁定的问题给出了**不同**的答案，
说明分工失败 ⇒ 应删除该节而不是并存两份说法。**两份正本比没有正本更贵**（CLAUDE.md 开篇实证：
`:204` 教了三天已被 ruling F 取代的做法，339 次绕过由此而来）。

---

## 2. 现状实测（本会话直读代码与载体，逐条自核，非转述）

### 2.1 已裁定但未实现：事件面

| 读数 | 证据 |
|---|---|
| Layer 0 的 `trigger 兜底轮询 + 事件订阅` 一行**只存在于注释** | `plugin/scripts/driver-runtime.ts:15`；全文件 `subscribe`/`EventEmitter`/`fs.watch` **零命中**（本会话 grep 实测） |
| `on(<event>)` 的**解析器与匹配器已实现，生产者未实现** | `routine-scheduler.ts` 解析 `/^on\(\s*([\w-]+)\s*\)$/`；事件名文法为任意 `[\w-]+`，**无枚举词表、无校验** |
| 一个 driver 在对空气产出结构化 Fact | `.quay/outer-round.jsonl` 自 2026-08-26 每轮写入；除 `outer-driver.ts` 自身外，全仓库仅 `driver-runtime.ts:175`（carriers 登记，供 `carrierStats` 做**存活统计**）引用它 ⇒ **Fact 的内容无任何程序消费者**；`outer-driver.ts:8` 自述「manager/语义层可消费」——即设计上的消费者是一个**人/LLM 按需去读**的路径，而它没有发生 |

**⊢ 结论**：事件面不是「要不要做」的问题（08-23 §5 已裁定要做），是**「已裁定 12 天、Layer 0 侧零实现」**的问题。
本 SPEC 不重新设计它，只在 §3.1 给出补齐判据。

### 2.2 声明了但未强制：Layer 0 继承

`outer-driver.ts`（532 行，2026-09-04 落地的最新 kind）实测：

- 仅从 Layer 0 import **6 个符号**（`splitArgs, ts, appendHeartbeatLine, scheduleIsDue, collectFacts, Fact, RoutineSpec`），其中 `splitArgs` **导入未使用**。
- **自持常驻循环**（`:385-449`：自己的 round 计数、SIGINT/SIGTERM、sleep、halt 读）——而 Layer 0 的 `loop`/`stopCondition`/`supervisor` 正是为此存在。
- **自建同步 spawn**（`:154 runJson` / `:169 runExit`，用 `spawnSync`）——**这与 08-23 SPEC §5.7 的明文裁定直接冲突**：
  「慢操作必须改 spawn（异步）……一个卡住的 selector 会连定时器一起冻住，于是"地板"这张安全网本身失效」。
  `driver-runtime.ts:505` 亦有同样警告，且 Layer 0 已提供 `runAsync`。
- 55 行手写 argv 解析 + 13 行 HELP，在 `quality-gate-driver.ts` / `suite-driver.ts` 各有一份同形副本。

**⊢ 结论**：「继承 Layer 0」目前是**文档事实，不是代码事实**。
**⊢ 这不是新缺陷，是一条已裁定条款在最新落地里的回归**——比未实现更值得报，因为它会随每个新 kind 复制。

### 2.3 从未被机械接线：probe 轨道

| 读数 | 证据（本会话实测） |
|---|---|
| probe 轨道在现行执行核里**只有一个调用点，且在已退役的层** | `grep "routines" orchestration/*tick-core.md` ⇒ **唯一命中** `fast-mode-tick-core.md:34`（A14）。fast-mode = inner，**已退役**（CLAUDE.md:17） |
| 该调用点用的是**已被自己的 SKILL 标为 LEGACY** 的触发形态 | A14 写 `routine-scheduler.ts --iteration <tick 计数>`；而 `plugin/skills/routines/SKILL.md` 明载两层模式应用 `interval:<N>m` / `on(<event>)`，「`every(N)` 无迭代计数器」 |
| 生产配置与上一条矛盾 | `.quay/config.yml` 四条 routine **全部** `trigger: every(5)` / `every(10)` |
| last-run 状态的写者是**一段交给 LLM 执行的散文** | `plugin/workflows/run-routines.js` 全长 51 行，函数体即 `await agent(<prompt>)`；prompt `:29` 指示「After firing, write each fired routine's last-run epoch-ms back into `.quay/routine-last-run.json`」 |
| 该状态的实况 | `.quay/routine-last-run.json` = **37 字节、一个键**（`self-validation`），mtime **2026-08-12 16:31** |

**⊢ 结论（本 SPEC 最重要的一条实测）**：probe 轨道**不是"接错了层"，是从来没有被机械接线过**——
它的调度状态的持久性，建立在「某个 LLM agent 记得把一个 epoch-ms 写回文件」之上。
**⊢ 这正是硬规则 9 的教科书形态**：一条规则若「守」与「不守」在记录上无法区分，它就只能靠意志。
这里连意志的载体（那个 agent）都已随 inner 退役而消失。

**⊢ 对人的问题②的直接回答**：`architecture-analysis` probe（`plugin/probes/architecture-analysis.md`，
指示 agent 用 archguard 枚举**环路径 + 具体文件 + 修法建议**）**存在且形态正确，但从未确认触发过**。
所以「archguard 应当用到一个架构 probe 中」**已经是设计事实**，缺的不是这个 probe，是让它跑起来的机械触发。

### 2.4 无法被表示的状态：机制生命周期

| 读数 | 证据 |
|---|---|
| 最接近"机制清单"的产物有 **10 张平行表，无任何生命周期/状态列** | `capability-catalog.sh` 的 `declare -A`：`QUESTION`/`GUARD_OBJECT`/`CADENCE`/`INVALIDATION`/`LAST_REAFFIRMED`/`MATCHING`/`CONSUMER`/`SUPERSEDED`/`NOT_SHIPPED`/`PUBLIC_ENTRYPOINTS`（本会话 grep 全列） |
| 退役的表达方式是**倒置的**：删文件 + 在 `SUPERSEDED` 里断言它**不存在** | 设计意图自述：「一个能力=一个实现，被取代的实现不存在于仓库，不被教学」 |
| ⇒ **「文件还在、但没人消费」这个状态没有任何地方可以表示** | 存在于文件系统 = 唯一的状态位 |
| `mechanism-vitality-check.ts` **结构性拒绝退役任何东西** | 其头注释：禁止「最近没用」作为唯一退休理由；默认处置是「待观察」不是「退休」 |
| ADR-035 已经提出正解，但**未实现** | `status: proposed`（2026-09-03）；全仓库 `ADR-035` 仅命中它自己的 front-matter；其 Consequences 自述**载体未定**；无实施任务 |
| 该问题的代价已被量化 | ADR-035 实证：退役 `session-liveness` 触及 **147 文件 / 其中 141 处直接路径引用** |

**⊢ 结论**：「沉默保留废弃机制」有一个精确的机械成因——
**机制的身份是文件路径，而它的生命周期只有一位（文件存不存在）。**
**⊢ 这与硬规则 3b 同形**：词表里没有「无法评估」态 ⇒ 读不懂与合格同形；
这里是词表里没有「活着但无人消费」态 ⇒ **僵尸与在役同形**。

---

## 3. 目标架构：四个平面（这是对人的要求④的回答）

```
┌ Plane 3 · 注册/生命周期面 ───────────────────────────────────────────┐
│  身份 = 能力 id（⛔ 非文件路径，ADR-035）                              │
│  状态 = 五态词表（含【活着但无人消费】）                                │
│  判据 = 声明态 ⟂ 派生证据 的【矛盾】报红（双向可取假）                    │
└──────────────────────────────┬───────────────────────────────────────┘
┌ Plane 2 · 能力面 ────────────▼───────────────────────────────────────┐
│  task-processing（Layer 1a）      routine（Layer 1b）                 │
│    promotion · worker              机械例程  run() → Fact[]           │
│                                    LLM probe run() = 派 agent + FILE  │
│                                                 -ONLY 闸 → Fact[]     │
│  ⛔ probe 不是新 kind，是 routine 的一种 run() 实现                    │
└──────────────────────────────┬───────────────────────────────────────┘
┌ Plane 1 · 事件面 ────────────▼─── 08-23 SPEC §5 已裁定，本 SPEC 不重开 ┐
│  协调循环（水平触发）· 事件携带【触发】非【决策】· 定时器是地板          │
│  ⚠️ 实测：Layer 0 侧零实现（§2.1）                                     │
└──────────────────────────────┬───────────────────────────────────────┘
┌ Plane 0 · 运行时面 ──────────▼─── 08-23 SPEC §2.1 已裁定，本 SPEC 只强制 ┐
│  supervisor · loop · stopCondition · heartbeat · controlPlane          │
│  · notify · profile · ResultVocab                                      │
└────────────────────────────────────────────────────────────────────────┘
         ▼ 调用（⛔ 不是它的一部分）
   Domain（产品）：Provider ABI · gate engine · task store
```

**⊢ 为什么是「面」而不是「机制列表」**：今天的蔓延不是因为机制多，
是因为**每个机制自带一套触发、一套状态载体、一套消费约定**，三者都没有共同的落点。
四个平面各自回答一个正交问题：**怎么活（0）· 何时醒（1）· 干什么（2）· 是否还该在（3）**。
一个新能力若不能在这四问上各落一格，它就不该被加进来——**这是本 SPEC 提供的准入判据，也是防止再次平铺的机制。**

### 3.1 Plane 1 的补齐判据（不重开设计，只定验收）

08-23 SPEC §5 已裁定模型。本 SPEC 只增加两条**可取假**的补齐判据：

1. **词表必须枚举**：`on(<event>)` 的事件名必须来自一个显式词表，未知事件名 ⇒ **报错，不得静默不匹配**。
   **⊢ 取假**：传一个拼错的事件名，若行为与「该事件未发生」不可区分 ⇒ 未达成（硬规则 3b）。
2. **双向闭合**：每个被发射的事件种类必须有 ≥1 个声明的订阅者；每个声明的订阅必须指向一个真会被发射的事件种类。
   **⊢ 取假**：把 `.quay/outer-round.jsonl` 今日形态（有生产者、零内容消费者，§2.1）喂给该检查，
   **若不报红 ⇒ 判据无效**。**⊢ 这条是用一个【已知为真】的样本干跑谓词**（硬规则②零计数配套动作）。

⛔ **不在本 SPEC 定义任何具体事件的 schema**——沿用 08-23 SPEC §2.2 的裁定：等第一个真实需求出现再定义。

---

## 4. Plane 0：把「继承」从文档变成代码（针对 §2.2）

**目标形态**：Layer 0 暴露**一个** `runDriver(spec)` 入口并独占循环；
kind 文件只提供一个 spec 对象（routines 表或 task-processing 三段），**不自持循环 / 信号 / sleep / argv 解析 / HELP / 同步 spawn**。

**⊢ 取假形态（一条机械检查即可）**：任一 `plugin/scripts/*-driver.ts` 中出现
`while (true)` 主循环、`process.on("SIGINT"…)`、自建 HELP 常量、或 `spawnSync` 于循环体内 ⇒ 红。
**⊢ 该检查必须先对 `outer-driver.ts` 当前状态干跑并【报红】**——若不红，说明谓词没写对（§2.2 已实测它四项全中）。

**⊢ 收益量化（实测）**：`outer-driver.ts` 532 行中约 **70% 是逐 kind 重复实现的样板**
（循环 ~95 行 · CLI/HELP ~75 行 · spawn/fact helper ~35 行），kind 独有逻辑仅约 150–170 行。

---

## 5. Plane 2：probe 驱动化（对人的问题②的正式回答）

### 5.1 结论：⛔ 不新增 `probe-driver` kind

**理由是成本与既有抽象，不是偏好**：

- Layer 1b 的 `RoutineSpec { name, schedule, run(): Fact[] }`（`driver-runtime.ts:762`）**已经就是 probe 抽象**。
  缺的只是一种 `run()` 实现：派 LLM 而非机械读数。
- 新增 kind 的实测成本是 **16 处接线 / 11 个文件**（§7），外加约 350 行样板；
  新增一个 routine 的成本是**一个函数 + 若干配置行**。
- **已有跑通的先例，不是新发明**：`pool-quality-judge` 正是一个「派 LLM 判断」的 routine，
  挂在 quality kind 上（`quality-gate-driver.ts:371-384`，`schedule: {kind:"interval", minutes:…}`）。

### 5.2 目标形态

```
llmProbeRoutine(probeFile) → RoutineSpec
  name     ← probe 名
  schedule ← interval:<N>m（⛔ 不用 every(N)：两层模式无迭代计数器）
  run()    ← ① readProbeSpec(probe)：instrument 不可用 ⇒ 返回 not-evaluated
             ② 派 fresh-context subagent 执行 probe 的 objective
             ③ routine-file-gate.ts（既有）做去重/限速/证据闸
             ④ FILE-ONLY 校验（既有）：只允许新增 tasksDir 文件，其余一律回滚
             ⑤ → Fact[]
```

**⊢ 四个零件里有三个已经存在**（`readProbeSpec` / `routine-file-gate.ts` / FILE-ONLY 校验），
本节新增的只有「把它们串成一个 `RoutineSpec.run()`」。

**⊢ 它顺带结构性修掉 §2.3 的四条实测缺陷**：
last-run 由 driver 拥有（不再靠 agent 记得写回）· 触发形态从 LEGACY `every(N)` 归位 `interval:<N>m` ·
调用点脱离已退役的 inner 核 · instrument 不可用时报 `not-evaluated` 而非静默跳过。

**⊢ 取假形态**：停掉那个 LLM 派发 seam 后该 routine 仍能产出 `verified` ⇒ 它测的不是 probe（硬规则 4 推论三）。
**⊢ 落地判据必须读生产载体**：形如「`.quay/routine-last-run.json` 中 `architecture-analysis` 的时间戳
晚于本实现落地时刻」——**⛔ 不接受只有 fixture 通过**（同推论三：只能被注入数据满足的判据不是测量）。

### 5.3 archguard 的落位（人的问题②后半）

| 面 | 消费什么 | 角色 | 依据 |
|---|---|---|---|
| **架构 probe（语义面）** | archguard 的**结构化输出**：环路径、涉及的具体包/文件、fan-in/fan-out、并给出修法（split/extract/merge） | **主用途** | `plugin/probes/architecture-analysis.md` 已如此写 |
| `archguard-runner.ts`（机械面） | **单一标量** `metricVector.sccCount`，`>0` ⇒ exit 1（本会话读码确认 `:11/:17-18/:29-30/:115`） | **按需证据采集，⛔ 不作闸** | 已由 `gap-fan-in-remove-archguard-gate`（done, 2026-09-01）从 fan-in 关键路径摘除 |

**⊢ 从那次移除中应当提取的通则（本 SPEC 主张把它上升为准入规则，而非一次性教训）**：
该门被移除的理由**两条并列**——「244 条记录 sccCount 从未非零」（频率）+「不枚举环/不给文件/不给修法，零指引价值」（形态）。
**⊢ 是后者让前者致命**：一个罕见但可指导的闸值得它的成本；一个即使触发也说不出「哪里错了」的闸不值得。
⇒ **通则：原始工具输出的裸标量不得单独 gate 流水线；语义解读归 LLM probe，机械层只做证据采集与结构性不变式。**

---

## 6. Plane 3：机制注册与生命周期（对人的要求④「不要沉默保留废弃机制」的回答）

### 6.1 身份：能力 id，不是文件路径

即 ADR-035 的主张，本 SPEC 不重述其论证，只引用其实证：`session-liveness` 退役触及 147 文件 / 141 处直接路径引用。
**⊢ 本 SPEC 对 ADR-035 的增量 = 下面 6.2 的状态词表**（ADR-035 只谈消费者面登记，未谈生命周期状态）。

### 6.2 状态词表必须包含今天无法表示的那一态

```
active               在役，有消费者，有调用证据
dormant-by-design    按设计只在特定条件下触发（⛔ 必须写出该条件，否则不是本态）
alive-but-unconsumed ⚠️ 文件在、无消费者/无调用证据  ← 今天【无法表示】的态
deprecated(→后继)    已有后继，处于迁移期，必须写出后继 id
retired              已退役（历史留在记录层）
```

**⊢ 判据形态（双向可取假，⛔ 不是「最近没用就退役」）**：
**报红条件 = 声明态与派生证据【矛盾】**——声称 `active` 却零调用证据；声称 `retired` 却仍被引用。
派生证据侧已有现成实现（`mechanism-vitality-check.ts` 已在算最后触碰/调用面引用），**缺的是声明侧**。

**⊢ 必须保留的保守性**：`mechanism-vitality-check.ts` 结构性拒绝自动退役（「最近没用」不是合法理由）——**这个设计是对的，本 SPEC 不改它**。
**⊢ 今天的失败不是退役得太慢，是没人能枚举候选。** 注册表的目标是让未决集合**可枚举且有年龄**，
**⛔ 不是让它自动缩小**。

### 6.3 ⚠️ 必须由人裁定的分岔：吸收 vs 新建

本仓库已有**四个**登记面：`capability-catalog.sh`（10 表）· `red-on-omission-audit.ts`（41 条自有 registry）·
`retired-clause-check.ts`（34 条）· `observer-registry`（3 个被观测仓库）。

**⊢ 若 Plane 3 成为第五个，本 SPEC 就亲手制造了它自己要消除的那种漂移。**
而 ADR-035 **明确拒绝**了「`capability-catalog.sh` 就是这一层」的说法 ⇒ **这不是可以顺手带过的实现细节，是一个方向裁定**：

- **选项 A（吸收）**：给 `capability-catalog.sh` 增加生命周期列 + 消费者面列，其余登记面逐步并入。
  代价：该文件已 1900+ 行、10 张表，继续加列会加剧其体量；且它的键是**文件 basename**，与 6.1 的「能力 id」冲突。
- **选项 B（新建承载 + 吸收既有）**：新建一个以能力 id 为键的登记面，**并明确把上述四面逐个迁入或标注归属**。
  代价：迁移期存在两份，必须有一条「不得新增第五面」的硬约束与迁移完成判据。

**⛔ 本 SPEC 不替人做这个裁定。** 但主张：**无论选哪个，都必须在同一个决定里写明另外四面的归属**——
否则结果必然是第五面（硬规则 5b：在某处修好 X ≠ X 只在那一处）。

---

## 7. kind 声明收敛（实测成本，及它已经造成的两次损害）

**新增一个 kind 今天要动 16 处 / 11 个文件**（`DriverKind` 联合 · `DRIVER_KINDS` 十字段行 · `driver-config.ts` 四处 ·
`drivers.yml` · `cli/driver.ts` 的 `KINDS` + 4 处 help 文案 · `capability-catalog.sh` **6 张表** · `.gitignore` 13 行 ·
两个测试文件 · 执行核文档 · product-outline）。

**⊢ 它已经造成两次真实损害（本会话实测复核）**：
1. `quality` kind 落地后需要一个**补接线提交**才真正可用；
2. **`suite` kind 至今半登记**：`driver-runtime.ts:194` 的 `DRIVER_KINDS` 里有它，
   而 `packages/quay/src/cli/driver.ts:30` 的 `KINDS` 只有四个（无 suite）、`drivers.yml` 的 `kinds:` 只有四段（无 suite）、
   `driver-config.ts` 无 suite ⇒ `suite-driver.ts:48` 退回硬编码 `INTERVAL_MS_DEFAULT = 1000`，
   **绕过 AC155「间隔单一正本」且无任何检查报红**。

**⊢ 目标**：kind = **一个声明**，登记面由该声明派生。
**⊢ 取假**：新增一个 kind 后，若上述任一登记面仍需手工补写才能生效 ⇒ 未达成。
**⊢ 负控制**：把今天的 `suite` 喂给收敛后的机制，**应当报出它的四处缺登记**；不报 ⇒ 判据无效。

---

## 8. 对人的问题③的正式回答：取代 / 驱动 / 不驱动

**⊢ 判准（先给判准，再给清单——清单会过期，判准不会）**：
```
该被 driver【取代】：一个机制的存在理由就是「定期或按条件去做某事」，而它自带了一套私有的常驻/轮询/状态
该被 driver【驱动】：一件必须在【无人索取时也发生】的义务，但其判断逻辑本身应保持独立可测
⛔ 不该 driver 化：按需被调用的库/证据采集器/声明性产物/领域实现
                   —— 常驻化它们只增加一个进程、一个载体、一个存活面，不增加任何保证
```

| 类别 | 对象 | 依据 |
|---|---|---|
| **取代** | `suite-state-trigger.ts --monitor`（对单文件的定制轮询器） | 正是 Plane 1 的职责；且它已被列入退役档案 R32 |
| **取代** | `routine-last-run.json` 的 agent 散文维护 | §2.3 实测：持久性靠「agent 记得写」 |
| **取代** | 各 kind 自持的循环/信号/CLI/同步 spawn | §2.2；且与 08-23 SPEC §5.7 裁定冲突 |
| **取代** | 执行核文档里剩余的机械步骤 | 已在发生（outer 的 A/B 段 → `outer-driver.ts`），继续做完 |
| **驱动** | 四个 LLM probe（含 `architecture-analysis`） | §2.3：从未确认触发 |
| **驱动** | meta-cc 历史挖掘 | 全仓库无任何 driver/routine 机械调用它 |
| **驱动** | ADR-007 要求的周期性架构复核 | 无人执行 |
| **驱动** | `pool-quality-judge` | **已经是**（§5.1 的先例） |
| **⛔ 不驱动** | `pane-state-classify`（被 import 的判定库）· `archguard-runner` 标量（按需证据）· checker 语料库（由套件/闸调用）· `capability-catalog.sh`（声明性产物）· Provider ABI 与 gate engine（**Domain**，driver 调用它们） | 见判准 |

**⊢ 一个需要人裁定的悬置项**：`packages/quay/src/gate/driver.ts` 的 `quay run` 独立 board-scan 循环
**零 driver 调用**（本会话确认唯一调用方是人工 CLI 入口），但它很可能是**产品面向外部使用者的最小参考驱动**
（不跑本项目 harness 的第三方 provider 使用者要用的正是它）。
**⇒ 这是产品决策，不是清理决策。⛔ 不要在没有裁定前把它当死代码删除。**
**⊢ 而它现在既未标为「产品面」也未标为「废弃」，这本身就是 §6 注册表缺失的一个实例。**

---

## 9. 非目标

- ⛔ 不重开 08-23 SPEC 已裁定的任何一条（事件模型 / Layer 分层 / 配置分界 / 出站通知 / profile）。
- ⛔ 不定义任何具体事件的 schema（沿用 08-23 §2.2：等第一个真实需求）。
- ⛔ 不裁定 §6.3 的「吸收 vs 新建」——**该项必须由人裁定**，本 SPEC 只列出两个选项及各自代价。
- ⛔ 不裁定 §8 悬置项（`quay run` 是产品面还是废弃面）——**同样需要人裁定**。
- ⛔ 不设任何数值阈值（巡检频率、未决集合上限等）——成本结构未知前不设阈值（硬规则 4 推论一）。
- ⛔ 不要求现有机制一次性全部迁入新平面；迁移期允许并存，但**必须有迁移完成判据**（§6.3 选项 B 的附带约束）。

---

## 10. 落地顺序与取假点（排在 08-23 SPEC §5.8 之后，不与之竞争）

| # | 步骤 | 取假点（⛔ 必须能取假，且优先用已知为真的样本干跑） |
|---|---|---|
| 1 | **probe 轨道机械化**（§5.2） | `.quay/routine-last-run.json` 中 `architecture-analysis` 的时间戳晚于实现落地时刻；**关掉 LLM 派发 seam 后该 routine 不得再产出 `verified`** |
| 2 | **Layer 0 继承强制化**（§4） | 该检查对**今天的 `outer-driver.ts`** 干跑必须报红（四项全中）；不红 ⇒ 谓词没写对 |
| 3 | **事件面补齐**（§3.1，08-23 §5 已裁定的模型） | 拼错的事件名必须与「事件未发生」可区分；把今日 `.quay/outer-round.jsonl` 形态喂给双向闭合检查**必须报红** |
| 4 | **kind 声明收敛**（§7） | 把今天的 `suite` 喂给它，必须报出四处缺登记 |
| 5 | **注册/生命周期面**（§6） | 先有 §6.3 的人裁定；落地后，一个「文件在、零消费者」的机制必须能被**枚举出来**（用 §2.1 的 `outer-round.jsonl` 或 §8 的 `quay run` 作为已知为真的样本） |

**⊢ 顺序理由**：1 最便宜且直接解锁人所要求的架构能力探索；2 是 4 的前置（不先收回循环，收敛声明只会收敛一个空壳）；
3 是「统一事件驱动」的实体但依赖 08-23 §5.8 的异步化先行；5 依赖 3–4（订阅关系与 kind 声明本身就是最好的「是否在役」证据）。

**⊢ 与 08-23 SPEC §5.8 的关系**：那五步（观测化 `actual` / 去 latch / 定时器地板 / 异步化 / 退役两个 Monitor）
是本表的**前置**，本表**不重复也不覆盖**它们。

---

## 11. 本 SPEC 自身的证据纪律说明

本文件 §2 的每一条读数均由作者在本会话**亲自 grep/读码/读载体核实**，不是转述调查结论。
**⊢ 过程中确实修正了一条**：初查结论为「`routine-last-run.json` 无任何写者」，
实查为「有写者，但写者是 `run-routines.js:29` 里一段**交给 LLM 执行的散文指令**」——
结论方向不变（持久性不由机械保证）但成因不同，**而成因不同会导致修法不同**，故必须更正后再落笔
（硬规则②：引用一个计数之前先打印它匹配到的实际内容）。
