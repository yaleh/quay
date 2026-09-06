# SPEC：能力面分层与机制生命周期 —— probe 驱动化 · Layer 0 强制继承 · 机制注册表

**作者**：manager｜**日期**：2026-09-05｜**状态**：proposal，**待人裁定**（§6.3 与 §9 各有一处必须由人裁定的分岔）
**⚠️ 2026-09-06 追加见 §12**：§6.3 已有裁定方向（不是选项A/B，是第三个方向——见 §12.1），
另有两个人在本轮新提出、本 SPEC 原稿未覆盖的缺口已补齐设计（§12.2 候选提名管线 / §12.3 创建前查重机械化）。
**读者应先读 §12 再读正文，避免把 §6.3 当悬置项处理**——正文本身未改一字（不重开已有分析），
新内容全部追加在文件末尾。
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
---

## 12. 2026-09-06 追加：人裁定 §6.3 + 两个新缺口（候选提名 · 创建前查重）

**来源**：人 2026-09-06 讨论轮。人的原始问题不是"§6.3 怎么选"，而是更上游的两条：
①"新的 driver 如何提出——完全依赖人类吗？"；②"自动提出和创建的 driver 是否会无节制膨胀（我们已经在 checker 上看到这样的情况）——
且这不只是数量问题：Claude Code 在发现问题时倾向于创建新任务/新机制，而不是找到原有的任务和机制把它改对做好"。
本节回答这两条，并顺带把 §6.3 的分岔往前推了一步（不是替代人裁定，是记录裁定方向 + 补裁定所需的前置条件）。

### 12.1 §6.3 的裁定方向（⚠️ 方向已定，落地前置未完成——见 12.1.3）

人的原话（大意）："我倾向退役 `capability-catalog.sh`。它就是和 checker 一样在膨胀、却几乎没发挥作用的又一个机制。"

**这不是 §6.3 给出的选项 A 或 B，是第三个方向**：
- 选项 A（吸收进 `capability-catalog.sh`）—— 人否决，理由与 SPEC 原文一致（basename 键 vs 能力 id 冲突、体量已过大）。
- 选项 B（新建独立登记面，明确另外四面的归属，`capability-catalog.sh` 保留但降级）—— 人也不选这个"保留但降级"的中间态。
- **选项 C（本节新增，人的实际裁定）**：新建以能力 id 为键的 Plane 3 登记面（= 选项 B 的"新建"部分），
  但 **`capability-catalog.sh` 本身进入 retired，不是保留降级**——它的十张表的职责按下表迁入 Plane 3 或就近的机械检查，
  不留一个"名义上还在但没人当正本读"的旧文件。

#### 12.1.1 裁定前必须核实的事实（本会话已核实，见 12.1.2）

`capability-catalog.sh` 现状：**2243 行**（比本 SPEC 09-05 落笔时的"1900+"一个月内又长了 300+ 行——
**它自己就是本 SPEC 要解决的那个问题的一个实例**：体量随时间单调增长，没有任何机制会让它变小）。
被 **40+ 个文件**引用（`plugin/scripts/*.ts`/`*.sh`、`plugin/test/*`、`orchestration/*.md`、`CLAUDE.md`）。

**⛔ 但"被 40+ 处引用"本身不构成"退役成本高"的结论**——同硬规则 5b 的镜像：多数引用是文档散文里的一句指针
（"参见 capability-catalog.sh"），只有其中程序化 `execFileSync`/解析其 stdout 的才是真依赖，退役会打穿的只有这一小类。
本会话把 40+ 处逐一分类为 (M) 机械消费者 / (D) 文档性引用 / (R) 反向登记，结果见 12.1.2。

#### 12.1.2 分类结果（本会话实测，只读调查，未改任何文件）

**表数据占比**：2243 行中，十张表的 `declare -A` 赋值行 ≈ 1840 行（~82%），生成/校验/输出逻辑（`--json`/`--table`/
`--summary`/`--entry-surface`/`--superseded-check` 五种模式 + AC1c 入口闸 + AC5 反注入静态扫描）+ 头注释 ≈ 400 行（~18%）。
**⊢ 体量增长的结构性成因**：`plugin/scripts/` 每新增一个脚本，就会在 `QUESTION`/`CADENCE`/`INVALIDATION`/
`LAST_REAFFIRMED`/`MATCHING` 五张表各添一行 ⇒ 与脚本总数（当前约300+）**同步线性增长**，不是逻辑代码本身在膨胀
——这与 checker 的膨胀是**同一根问题的两个症状**（"每发现一件事就登记/新建一条"，登记的边际成本看似很低，
但从未有对应的机制让它收缩）。

**40+ 引用者的真实分类**（逐一读码核实，非猜测）：
- **(M) 机械消费者，共 7 个**，退役后果轻重不一：

| 消费者 | 依赖什么 | 文件消失后的行为 | 严重度 |
|---|---|---|---|
| `runner-static-gate.ts:226` | `run_checker "superseded-capability-check" bash capability-catalog.sh --superseded-check`，挂在 `@static-tier always`（**每任务每轮都跑，不分是否涉及新脚本**） | `bash <不存在文件>` → exit 127 → **全仓库每个任务每一轮全部变红** | **最高** |
| `select-static-checks-for-touches.ts` | `CAPABILITY_CATALOG_CHECKER`（Touches 声明新脚本时注入 scoped 闸）+ `NEW_SCRIPT_REGISTRATION_REQUIRED`+`checkTouchesRegistration()`（派发前置：新脚本任务的 Touches 必须同时列 capability-catalog.sh 才放行） | 这正是"新脚本必须注册"这条既有保障的**真正执行者**（不是 `registry-bare-filename-scan`——见12.1.2下方订正）；文件消失后，要么所有新脚本任务永久变红，要么这道防线随之消失 | **高** |
| `mechanism-vitality-check.ts:240` | `execFileSync`（**无 try/catch**）跑 `--json` 解析行数据 | 非零退出即**抛出未捕获异常，整个检查器崩溃**，比"变红"更差——是硬崩溃耦合 | **高** |
| `rhythm-consumer-check.ts` | `spawnSync` 解析 `--json` 的 cadence/consumer/matching 字段，每轮跑，覆盖全部约300条声明 | stdout 为空时代码退回 `JSON.parse(r.stdout \|\| "[]")` ⇒ **零行 ⇒ 零违规 ⇒ 静默假绿**——这正是 CLAUDE.md 硬规则 3b 警告的"读不懂伪装成合格"，是四个 M 类里**最危险**的退化形态（不是崩溃、不是变红，是无声地骗过去） | **中，但方向最坏** |
| `deliver-verify-usage.sh` | `VERIFY_SET` 两行硬编码断言 `capability-catalog.sh --json`/`--entry-surface` 存在且非空输出（AC92 交付验证） | 文件缺失即两行 FAIL，AC92 交付验证整体非零退出 | 中高 |
| `guard-lineage-check.ts` | `fs.existsSync` 有守卫，缺失时回退空 Map，报出真实的 `declaredRatio:0` | **优雅且诚实地降级**（GUARD_OBJECT 本来就只是 5 条 pilot 表） | 低 |
| `quay-init.sh:1161` | 硬编码进新工作区的 laydown 清单 | 新建工作区时清单里引用一个不存在的文件，需同步删这一行 | 低 |

- **(D) 纯文档性引用**（orchestration/*.md 全部、CLAUDE.md、多数 plugin/scripts 注释）：删除或重指向只需改散文，零代码风险。
- **(R) 反向登记**（约17个抽样脚本全部命中，判断是全体现存脚本的共性）：capability-catalog.sh 的 QUESTION 表在描述这些脚本，
  不是这些脚本在依赖它——这类"引用"在退役清单里不构成阻力，是 Plane 3 要接管的**内容**，不是要清理的**依赖**。

**⊢ 订正**：memory 记录"新增 plugin/scripts 文件登记的门"最初印象指向 `registry-bare-filename-scan`，
实测**真正的执行者是 `select-static-checks-for-touches.ts`**（`registry-bare-filename-scan.ts` 反而明确把
capability-catalog.sh 列入 `EXCLUDED_CARRIER_BASENAMES`——"描述不是使用"，即它自己拒绝把"被目录表提到"算作真实引用，
这条判断本身是对的，但意味着 12.1.3 第3条的"既有保障"具体要在 `select-static-checks-for-touches.ts` 上重建，不是别处）。

**⊢ 结论（回应 12.1.1 提出的问题）**：真实退役阻力**不在"被40+文件引用"，集中在4个点**：
`runner-static-gate.ts:226`（全局血半径）· `select-static-checks-for-touches.ts`（注册闸本体）·
`mechanism-vitality-check.ts:240`（硬崩溃）· `rhythm-consumer-check.ts`（静默假绿，方向最危险）。
其余 30+ 处引用是文档指针，一次性批量改写即可，不构成技术阻力。

#### 12.1.3 落地前置（⛔ 不满足不得删除文件——硬规则 5：批量删除前必须先有落点映射）

在实际执行"退役 `capability-catalog.sh`"这个动作之前，必须先完成：
1. **逐表迁移映射**：十张表（`QUESTION`/`GUARD_OBJECT`/`CADENCE`/`INVALIDATION`/`LAST_REAFFIRMED`/`MATCHING`/`CONSUMER`/
   `SUPERSEDED`/`NOT_SHIPPED`/`PUBLIC_ENTRYPOINTS`）各自的字段职责 → Plane 3 新登记面里的对应字段/新检查，
   一对一列出，不允许"这张表没人用所以不迁"这种未经验证的省略（每张表的"没人用"结论需要 12.1.2 的 M 类清单支持，不能靠印象）。
2. **M 类消费者逐个改造**（数量以 12.1.2 为准）：每个机械消费者的调用点从"跑 capability-catalog.sh 解析 stdout"
   改为"读 Plane 3 新登记面"，并对改造后的每个消费者跑一次它自己的既有测试，确认行为不变或按预期变化（不是删了旧脚本再看谁报错）。
3. **"新脚本必须登记"这条既有保障不能空档**：真正的执行者是 `select-static-checks-for-touches.ts`
   （`CAPABILITY_CATALOG_CHECKER` 注入的 scoped 闸 + `NEW_SCRIPT_REGISTRATION_REQUIRED`/`checkTouchesRegistration()`
   的派发前置——见 12.1.2 的订正，不是最初印象里的 `registry-bare-filename-scan`）。这条防线必须先在 Plane 3 上重建
   并验证生效，再删旧脚本，不允许出现"旧闸已拆、新闸未起"的空窗（对照 ADR-035 的退役纪律：退役前枚举消费者面，
   不是退役后再找断的地方）。
4. **CLAUDE.md 自身的指针要同步**："每轮必经"表第一行"有哪些机件、各自回答什么问题 → `capability-catalog.sh`（唯一清单）"
   这句话本身要改指向 Plane 3 的新入口，否则出现"正本已经不是正本了，但仓库里最高频读的文件还在教旧的"（与本 SPEC §2.4
   诊断的"沉默保留废弃机制"同构——如果连发起这次讨论的 CLAUDE.md 自己都没跟上，就是在示范反面教材）。

**⊢ 判据**：这四条任一未完成，`capability-catalog.sh` 只能标 `deprecated(→Plane 3)`，不能标 `retired`——
沿用 §6.2 的五态词表，deprecated 与 retired 的区别正是"后继是否已经真正接管全部职责"。

### 12.2 缺口一：候选从哪里来——driver-candidate 提名管线（回答人的问题①）

**现状**（本会话核实）：本 SPEC 及其前作 `SPEC-unified-driver-architecture-2026-08-23.md` 都回答了
"候选出现后该不该被吸收成 driver/routine"（§3 的四问判据、§8 的取代/驱动/不驱动判准表），
**但没有回答候选从哪里来**——目前唯一的产生方式是人在讨论轮里指出方向，本 SPEC 本身就是这样诞生的。

**⊢ 这不该被自动化成"发现问题就自己建"**（那正是人在本轮要求警惕的倾向，§12.3 另述）——
**该自动化的是"发现候选并提名"，不是"发现候选并实现"**。提名与裁定/实现分离，是防止膨胀的关键分工：

```
提名（机械/例程，可自动）──→ label:driver-candidate 任务（人在环裁定）──→ 走既有质量闸实现
```

**提名例程的形状**（复用既有基础设施，不新增 kind——同 §5.1 的既有教训）：
- 挂在 `quality-gate-driver.ts` 已有的例程模式下（同 `pool-quality-judge` 先例，§5.1），新增一个
  `driver-candidate-scan` routine，`schedule: interval:<N>m`（数值不设——硬规则 4 推论一，成本结构未跑出来之前不设阈值）。
- `run()` 的判断逻辑复用本 SPEC §8 已有判准表（取代/驱动/不驱动三分类），对象来源三个既有信号，不新增数据源：
  1. `mechanism-vitality-check.ts` 已经在算的"最后触碰/调用面"读数里，连续多轮被人工重复执行的同一段机械步骤
     （即 §8"取代"类的判据："存在理由=定期/按条件做事，且自带私有常驻/轮询/状态"）。
  2. meta-cc 历史里同一模式的手工操作重复出现 N 次（具体 N 由硬规则 12 的"发生率"要求——**给不出发生率就不提名，
     降为观察项**，不是"看起来该做就先提名"）。
  3. `orchestration/*tick-core.md` 等执行核文档里标注为"机械但仍由 Claude Code 会话执行"的段落（现成的候选池，
     不需要新发明识别方法——这类段落在文档里已经用固定短语标注，如"机械（非-LLM）"）。
- **产出是 Fact，不是实现**：命中判据 ⇒ 写一条 `label:driver-candidate` 任务（走 `quay-task` 立案，四件套完备性照旧要求），
  任务体必须包含"依据 §8 哪一类判准""引用的发生率读数""如果不做，代价是什么（继续手工执行的单价×频率，同硬规则⑫的量级要求）"。
  **不自动进入 ready，只到 todo**——晋升到 ready 仍走既有的 author→ready 闸，人/quay-task 审的是"这个候选值不值得做"，
  不是"这个候选有没有被正确识别"（后者已经由判准表机械保证）。

**⊢ 取假形态**：该例程若连续 N 轮跑，产出的 `driver-candidate` 任务里 superseded/needs-human（即"提名错了"）的比例
持续偏高，说明判准表（§8）或发生率阈值需要收紧——**这条本身就是 12.3 的查重机制要覆盖的对象**（提名管线自己也可能提名重复）。

### 12.3 缺口二：创建前查重的机械化（回答人的问题②的"不只是数量，是倾向"）

**现状实证**（本会话核实，与 checker 膨胀同源）：
- `plugin/skills/quay-file-task/SKILL.md` 的 Step 2（"查重——按机制不按症状词"）**是 prose 指令，没有机械闸验证它真的被执行过**。
- 真实案例：`gap-suite-lane-budget-*` 与 `gap-suite-serial-lowconc-*` 两个任务是同一根因，因为立案时的查重用了症状词
  而非机制词，**至今仍是两个独立 done 任务，从未合并**——查重规则本身"守"与"不守"在记录上无法区分（硬规则 9 的教科书形态）。
- 有正面先例：`gap-5b-brother-grep-mechanical-check` 被人明确裁定退役——原方案是"新增一个检查器保证两处同步"，
  裁定是"解耦+简化，不是加检查"。**这条判例应当被固化成机械前置，而不是只留在个案记忆里**——
  这正是人本轮要求的"改进方向应重点是修好原有任务和机制，而不是创建新的"。

**⊢ 建议的机械闸**（形状复用既有先例，不新发明检查手法——同硬规则①"用机件不手搓"）：
1. **立案侧**：`quay-file-task` skill 的 Step 2 从 prose 升级为可验证产物——任务体新增一个必填字段
   （类似现有 Touches/AC 完备性检查的形状），内容是"已检索的机制关键词 + 检索命中的既有任务清单（可以为空，但字段本身不能缺）"。
   `ready-pool-check.ts` 的四件套完备性检查（todo→ready 闸）增加第五项：该字段缺失 ⇒ 视同四件套不完整，不予晋升。
   **⊢ 取假**：对一个已知重复的历史案例（如上面 `gap-suite-lane-budget-*`）重放这条检查，必须能在立案当时就报出候选重叠
   ——不能重放出"通过"才叫判据写对（硬规则②的"零计数配套动作"：用已知为真的样本干跑谓词）。
2. **checker/driver 新增侧**：比立案更需要收紧，因为 checker 是机械机制，一旦建成很少被回头审视（120 个现存 checker
   里能确认有 mutation-test 验证过"真的会失败"的比例，SPEC-methodology-layer 已经点出过缺口）。新增
   `plugin/scripts/*-check.ts` 时，`new-plugin-scripts-file` 既有的四道注册闸（见 memory
   "New plugin/scripts file trips 3 gates"）追加第五道：头注释必须包含"为什么现有 N 个 checker 里没有一个能覆盖这个判据"
   的一句话理由 + 具体点名比较过的 1-2 个最接近的现有 checker（哪怕结论是"确实不够，需要新建"）。
   **不是不让新建，是强制"看过了"这个动作留下可核对的产物**——同硬规则②的既有纪律，只是把适用范围从"引用一个计数"
   扩到"新建一个机制"。
3. **两者共用的负控制**：`gap-5b-brother-grep-mechanical-check` 的退役理由（"能不能用解耦/复用既有实现代替新增检查器"）
   应当被写成 12.2 提名管线判准表（§8）之外的第四类否决判据——**在"取代/驱动/不驱动"三分类判完之后，新建 checker 还要多问一句
   "能不能通过修改/复用已有的一个检查器达到同样效果，而不是新增一个"**。

**⊢ 与 §6 Plane 3 的关系**：12.2/12.3 都是"创建前"的机械闸，Plane 3（§6）管的是"创建后，机制的生命周期状态"——
两者互补，缺一个仓库仍会膨胀：只有创建后审查（Plane 3），不能阻止再生速度（checker 8月新增161个的月度节奏）；
只有创建前把关（12.2/12.3），不能处理存量里已经沉默失效的机制。**这正是人本轮问题的完整闭环：
"提出机制"（12.2）+"防膨胀"（12.3 创建前 + §6 创建后）一起，才是"driver of driver"这个要求的完整回答，
而不是只做 §6 这一半。**

### 12.4 本节的证据纪律

12.1.2 的分类表由本会话在 2026-09-06 亲自 grep/读码核实，方法与本 SPEC §11 一致（先干跑负控制、
不采信转述）。12.2/12.3 的三个实证（`gap-suite-lane-budget-*`重复案例 / `quay-file-task` Step 2 现状 /
`gap-5b-brother-grep-mechanical-check` 判例）均引自同日两个只读调查 agent 的 grep 结果，原始任务文件路径可核对。
