# 规格：goal 机制启用与改造（PHASE→GOAL、多目标并发、ABI 封装、driver 驱动）

**日期**：2026-09-06
**触发**：人「当前本项目中仍在使用（字面上的）milestone 概念/机制吗？…我想把当前的『阶段』机制命名改为 milestone。可行吗？」
→ 调研后人改判「考虑到会同时推进多条，**goal 这个名字比 milestone 好**」，并给出四条裁定（§0）。
**前身**：`orchestration/SPEC-goal-store-2026-08-09.md`（下称 **SPEC-0809**）。
**本规格是 SPEC-0809 的修订与启用，不是替代**——SPEC-0809 的 §0/§1/§2.1-4/§3/§4 全部继续有效。
**定义者**：管理者。**实现者**：待定（本规格自身已立为 `GOAL-001`，人手动驱动）。

---

## 0. 人 2026-09-06 的四条裁定（逐条，本规格的授权基础）

| # | 裁定原文 | 影响的既有结论 |
|---|---|---|
| 1 | 「考虑到会同时推进多条，**goal 这个名字比 milestone 好**」 | SPEC-0809 §2b 的 `PHASE-NNN` 定案 → 改为 `GOAL-NNN`（§2） |
| 2 | 「同意复用 goal-store 扩展，但 **ABI 封装是必要的**」 | goal 由 **Core-owned** 改为 **Provider-backed**（§5） |
| 3 | 「goal 的晋升（即激活）**暂不做**类似 promotion-driver 这样的自动晋升机制」 | driver 职责收窄；**推出 `draft` 状态**（§3.2、§6） |
| 4 | 「接受 **硬上限 + 强制关闭** 机制」；初始值 **cap=3 / stale=7 天** | **I1 被 I1′ 取代**（§4.1） |
| 5 | 「`active → achieved` 的机械 flip **不算**自动晋升，它是 I2 的确定性推导」 | driver 可做该 flip（§6.1） |

**⚠️ 裁定 1 与 SPEC-0809 §2b 的关系必须说清，否则会被读成"推翻了人自己的裁定"**：

- SPEC-0809 §2b 用数据**否决的是 `MILESTONE-NNN`**，理由是①语义污染②层级倒置③`Phase 2` 与 `PHASE-003` 不同形。
  **该否决继续成立，本规格不使用 `MILESTONE-NNN`。** §1 给出 2026-09-06 的重算，其中理由①的生产依据已消失、
  **而理由②反而更强了**——正是理由②使 `milestone` 至今不可用。
- SPEC-0809 §2b 同时**定案了 `PHASE-NNN`**。**本规格修订的是这一条**，且换的方向不是被否决的 milestone，
  而是 SPEC-0809 自己列在候选表里、当时统计为「`GOAL-` 3 处占用」的 `GOAL-`。
- 换名的实质理由（不是品味）：**「阶段」这个词在语义上排斥并发**——没有人会说「当前有 3 个当前阶段」，
  而裁定 4 恰恰要求同时存在多条。**词表必须能表达机制允许的状态，否则文档与机制必然分叉。**
- 附带收益：store 叫 `goal-store`、路由 `/goal`、导航 `Goals`，**而记录 id 前缀是 `PHASE-`**——
  命名今天就是内部打架的。改完之后「阶段 / phase」作为系统词汇全面退场，
  这正是人提出本轮讨论的第一动机（三个"阶段"候选并存）。

---

## 1. 命名地基重算（SPEC-0809 §2b:114 要求「重开前请先推翻上表的数据」）

| 量 | SPEC-0809（2026-08-09） | 本规格实测（2026-09-06） | 判定 |
|---|---|---|---|
| `M<NNN>` 编号 | 4215 次、`milestones/` 190 目录、最新 M254 | **编号冻结**：`milestone_counter` 停在 206，**最后自增 2026-07-31**（M209 ABSORB）；分配器 `prepare-milestone.js`/`execute-milestone.js`/`milestone-worktree.ts` **已随 ADR-022 退役、文件已删除**；无任何活跃代码分配新 M 编号；153 个历史目录纯只读 | **理由①的生产依据消失** |
| `label:milestone-candidate` | 569 个任务、近 7 天 226 提交 | 577 个任务；`task-schema.ts:315` `deriveKind()` 仍以它为**一等 kind 判别键**（决定 `## Plan` 必需、`## Touches` 缺失即 `touches-absent-milestone-candidate`），每次 `task check` 都走；**但生产管线已停**——最后一次「标签 + `dirStatus: applied` 同步打上」是 **DIR-101，2026-08-19**，其后 `DIR-130`(09-02, applied) 未打标签、`DIR-127/128` 从未 drain | **分类定义活、生产管线死** |
| 其他活跃占用 | — | worktree 分支命名 `milestones/<ws>/<task.id>`（loop-driver）；`CLAUDE.md` 的 "milestone granularity" / "before calling a milestone done"；`quay-task-to-plan` skill 的 "development-class milestones" | **词义"一次开发批次"仍活** |

**⇒ 结论：理由②（层级倒置）不但没失效，反而更强。** 今天 `milestone` 在生产中稳定指
**一个任务大小的开发批次**，而本规格要命名的对象**横跨几十个任务**。若改名 milestone，
系统里会同时存在 `milestone`（跨几十任务的目标）与 `milestone-candidate`（一条待办任务）——
**层级倒置本身**。人 2026-09-06 独立地选择了 `goal`，与该数据一致。

**`label:milestone-candidate` 的处置不在本规格范围内**，但应单独立观察项：
它是一个「分类定义仍被 `task check` 每轮执行、而生产管线已停摆 2.5 周」的状态，本身就是缺陷候选。

---

## 2. 词表与 id

| 概念 | id | 变更 |
|---|---|---|
| 目标 | `GOAL-NNN` | ← `PHASE-NNN`（`goal-store.ts:48` `PHASE_ID_RE`） |
| 判据 | `AC-NNN` | **不变** |
| 归属字段 | AC 记录的 `goal: GOAL-NNN` | ← `phase:`（`goal-store.ts:54, 261, 270-272`） |
| 派生 kind | `goal` \| `criterion` | ← `phase` \| `criterion`（`goal-store.ts:260`） |

### 2.1 `AC-NNN` 必须**保号迁移**，这是硬约束不是偏好

`AC143` → `AC-143`，数字段不变、不重排、不复用。理由是可核的：

- 约 20 处生产代码注释是 `// WHY THIS EXISTS（manager-phase-goal.md ### ACxxx）` 形态的溯源引用
  （`driver-runtime.ts:4`、`promotion-driver.ts:9,57,185`、`quality-gate-driver.ts:4,20`、
  `suite-bucket-attribution.ts:5,25`、`tick-core-static-check.ts:17,40,105` 等）
- 4 个测试文件断言 AC 编号（`semantic-observer-judge.test.mjs:343`、`tick-core-static-check.test.mjs:420-433`、
  `suite-bucket-attribution.test.mjs:16`、`integration-batch-merge.test.mjs:482,535-549`）

**编号断裂 ⇒ 这些溯源全部静默失效**（硬规则 8：编号不得复用/移动，否则缺席被伪装成在场）。
保号迁移则零损失，且 `AC_ID_RE = /^AC-\d{3,}$/` 已经接受三位数，无需改正则。

### 2.2 编号分配

- **`GOAL-NNN` 按创建顺序分配**，含义在 `title`，id 永不移动（SPEC-0809 §2b 的四名一致规则，第五次沿用）。
  本规格自身 = **`GOAL-001`**（§8）。迁移产生 `GOAL-002`（当前阶段）、`GOAL-003`（下一阶段）。
- **`AC-NNN` 接全局最大值，不复用**（沿用 `manager-phase-goal.md:1121` 明写的既有纪律）。
  **实测全局最大 = `AC169`** ⇒ 本规格的 AC 从 **`AC-170`** 起。

---

## 3. 数据模型

### 3.1 frontmatter

**GOAL 记录**（`kind: goal`，**无 `criterion` 字段**——其判据是所属 AC 的合取，SPEC-0809 §2b 保留）：

```yaml
id: GOAL-001
title: <目标陈述>
status: draft | active | achieved | superseded | retired
kind: goal                    # 从 id 前缀派生，永不由调用方给
origin: <必填：哪次裁定/实测造出了它>
activatedAt: <新增：进入 active 的时刻，ISO8601>
labels: [<新增，可选：分组/筛选>]
supersedes / superseded-by
```

**AC 记录**（`kind: criterion`）：

```yaml
id: AC-170
goal: GOAL-001                # ← 原 phase:，必填，缺则拒写
title: <判据陈述>
status: draft | active | achieved | superseded | retired
criterion: <可跑 shell 命令；空 ⇒ gate fail-closed>
expect: <期望，描述性>
origin: <必填>
evidence: { at, verdict, reading }   # 由 gate 写回
```

`OWNED_KEYS`（`goal-store.ts:53-56`）增加 `activatedAt` / `labels`；未知 key 原样保留的既有纪律不变。

### 3.2 `draft` 状态：不是可选项，是裁定 3+4 相乘推出来的硬性缺口

现词表 `active / achieved / superseded / retired`（`goal-store.ts:46`）**没有「写好但未启动」态**，
而 `write()` 的 `status` 默认值是 `"active"`（`:258`）⇒ **写入即激活**。

叠加裁定 4 的硬上限，后果是：**cap=3 且已有 3 条 active 时，连第 4 条 goal 都写不进去**——
上限会把**撰写**堵死，而它本该只约束**激活**。

**这个状态在现实里已经存在，只是 store 没有它**：`manager-phase-goal.md:174` 的
「📋 下一阶段（**已创建，未启动** …）」，`44f8813d2`(09-02) 创建 AC156–169 时明写
「未切换、未启动、不得据此派发」。⇒ 加 `draft`，并把 `write()` 的默认 status 由 `active` 改为 **`draft`**
（**默认不激活**，与裁定 3「不自动晋升」同向）。

**撰写顺序：AC 先、GOAL 后**（2026-09-17 补，`gap-goal-born-draft-zero-ac-escapes-standing-invariant`）。
P6-goal 的 AC 覆盖闸（§4 的 I1′ 同族）作用域 = 不变式 AC-217 自己的 `{draft, active}`：一条 GOAL
**不得以这两个状态之一出生/存在而名下零 AC**。⇒ 「写好但未启动」的三步顺序是：

```
① goal-store write AC-NNN --goal GOAL-NNN --status draft --criterion '<…>' --expect '<…>' --origin '<…>'
② goal-store write GOAL-NNN --status draft --title … --origin … --body '<≥40 非空白>'
③ goal-store write GOAL-NNN --status active          ← 人裁定（裁定 3）
```

⚠️ ① **不构成循环**：AC 记录的完整性契约只要求 `goal:` 是**非空字符串**，⛔ 不要求被指名的 GOAL
已经存在（`goal-store.ts` 的 criterion 完整性分支只查 `criterion`/`expect`）。**这条曾经被写反**：
旧正文与旧闸的拒绝讯息都教「先建 draft GOAL、再补 AC」，而那正是被禁态本身 —— 2026-09-17
GOAL-022 走的正是这条被推荐的路径，以 draft ∧ 零 AC 流通 ≥101 秒，并烧掉一个无物可修的 gap-filing
worker。⛔ 判据未收窄：窗口是**被关掉**的（状态不可达），不是被合法化的。

### 3.3 正文 section（新增能力）

**GOAL 记录正文必需**，单点校验、fail-closed、每节 ≥40 非空白字符（沿用 task 的 `MIN_SECTION_CHARS` 约定）：

- `## 背景`（为什么是现在）
- `## 范围与非目标`
- `## 退出条件`（散文版；**机器判据在 AC 记录的 `criterion` 里，不在这**）
- `## 风险`
- `## 与其他 goal 的关系`（可选）

AC 记录正文保留既有论证结构（`**判据（能取假）**` / `**取假**`）。

> **三条纪律（每条都有本仓实证）**
> 1. **AC 绝不回到正文复选框。** `manager-phase-goal.md` 已烧过一次：当前阶段 AC143–155 的状态在
>    一个 markdown 表格里、**一个复选框都没有**，而下一阶段 AC156–169 用复选框——同文件两种表示法并存，
>    `manager-tick-readings.ts:262-269` 的 `goal.phase_ac_checked` 因此恒零，**已于 2026-08-14 `75d1da743` 被人令删除**
>    （「零消费者 + 已知失准」）。AC 状态只在 AC 记录的 `status` 字段。
> 2. **正文若要显示 AC，必须是从 AC 记录生成的视图**，不是手写来源。
> 3. **section 校验只写一处**（store 的 write 路径）。task 的 shape 定义现有**三份并行镜像**
>    （`quay-native/src/store.ts:46-95` / `ready-pool-check.ts:682-715` / `task-schema.ts:26-50`）靠漂移检查器兜着——
>    **不要复制这个结构。**

### 3.4 派生量（一律不存储，硬规则 4b）

`achieved`（I2）、`lastProgressAt`（= 其 AC `evidence.at` 的最大值）、`acTotal`/`acAchieved`、
`stale`（I3）、`activeCount`。

**`lastProgressAt` 必须从 AC 的 evidence 派生，不得存 GOAL 自己的 `updatedAt`**——
后者是"被测对象自己产生的量"，goal 停摆时它恰好也停止更新，**与"一切正常"同形**。

---

## 4. 不变式

| 编号 | 内容 | 实施点 |
|---|---|---|
| **I1′** | `status: active` 的 GOAL 数 **≤ `cap`**（默认 3，可配），**写时 fail-closed 拒绝**；拒绝信息必须**枚举当前 active 集合**（硬规则 3：枚举不布尔） | 取代 `goal-store.ts:282-304` 的单例逻辑与 `:203-206` 的 `ok = (count === 1)` |
| **I2** | GOAL achieved ⟺ 其全部 AC achieved，**读时推导，永不存储**；零 AC ⇒ `false` | `goal-store.ts:192-200`，**不变** |
| **I3** | 对 active GOAL：`now - lastProgressAt > stale`（默认 7 天）⇒ `stale`；**无 AC ⇒ `NOT-EVALUATED`**；否则 `fresh` | 新增，goal-driver + `check --staleness` |
| **I4** | `status` 与 I2 推导不一致（status=active 而推导 achieved）⇒ 报出分歧 | 新增，`check` |

### 4.1 I1 → I1′ 是对一条**人已同意的不变式**的推翻，必须显式记账

SPEC-0809 §2b「两条不变式（人已同意）」的 I1 是**「同一时刻只能有一条 `status: active` 的 PHASE」**，
且 §落实第 1 条把「fail-closed 拒绝第二条 active」定为**那个 store 的核心设计**。
**其动机是实测出来的**：`manager-phase-goal.md` 里曾有**四条**自称"本阶段主判据"的 AC 同时存在
（AC10/AC12/AC20/AC28），且「设目标的裁定六次，只加不关」。**I1 是防目标通胀的。**

⇒ **推翻它必须补上等效守卫，否则通胀会原样回来。** 人裁定 4 给的正是这个补丁：

- **硬上限**保证"多"不等于"无限"
- **强制关闭**（I3 陈旧）专门抓"只加不关"

**两者不是独立旋钮：上限是关闭的执行力。** 单独的陈旧报红没有牙齿（报了可以不理）；
是 cap 让"该关"变成"不得不关"——三条占满时，想开新目标就必须先关掉一条。

### 4.2 `cap` / `stale` 是**策略值**，不是测量值

硬规则 4 推论明禁「成本结构未知前设数值阈值」。⇒

- 两者**必须可配**（`plugin/scripts/drivers.yml`，人写、版本化、重启生效），**不得写死字面量**
- 初始值 `cap=3` / `stale=7d` 由人 2026-09-06 给出，**在本规格中标注为未测量的初始策略值**
- **复核点**：goal-driver 跑满 30 个自然日后，用 `.quay/goal-round.jsonl` 的真实分布重估两值，
  并把重估结果贴回本节。在此之前，**任何"这个值太松/太紧"的论断都是无数据的**

---

## 5. ABI 封装（人裁定 2）

### 5.1 路线变更：从 Core-owned 改为 Provider-backed

本仓现有**两类**一等对象，走**两条不同的路**：

| 类型 | 例子 | 是否穿 Provider ABI |
|---|---|---|
| Provider-backed | task、**ADR** | ✅ MCP verb + provider-client |
| Core-owned | **goal（现状）**、document | ❌ Core 直读 workspace 目录（`serve-goal.ts:8-14` 明写） |

⇒ **实现模板是 ADR，不是 goal 自己**：ADR 已经是「provider-backed + frontmatter 存储 +
三个 MCP verb + github 侧显式 stub + Core 侧优雅降级」的完整实例。

### 5.2 改动面

| # | 面 | 动作 | 照抄对象 |
|---|---|---|---|
| 1 | 存储归属 | `goal-store.ts` 由 `packages/quay/src/` 迁至 **`packages/quay-native/src/`** | adr 的归属 |
| 2 | view-model | `abi.ts` 加 `GoalRecord` + `GOAL_STATUSES` | `AdrRecord`（`abi.ts:46-51`） |
| 3 | client | `provider-client.ts` 加 verb + capability 降级 | `:138-168` |
| 4 | native MCP | `quay-native/src/mcp-server.ts` 加 `goal_list`/`goal_get`/`goal_write`（+ `goal_gate`） | `:223-260` |
| 5 | github MCP | 显式 stub：`goal_list → []`、`goal_get`/`goal_write → not supported` | `quay-github/src/mcp-server.ts:286-305` |
| 6 | capabilities | 两份 `provider.yml` 的 `capabilities:` 块加 `goal` | adr 同款 |
| 7 | 一致性 | `provider-abi-conformance.test.mjs` 加一组；**I1′ 由 provider 的 write 路径执行**，conformance 断言每个 provider 都执行 | 现成 |
| 8 | Web | `serve-goal.ts` 由直读 store 改为走 client（签名加 `client`） | `serve-adr.ts:60` |

### 5.3 ABI 封装是 driver 语义环的**前置条件**，不是锦上添花

**agent 现在读不到 goal**——全仓 `goal_list` 零命中，唯一入口是直跑
`node packages/quay/src/goal-store.ts`。而 §6.2 的语义环要 spawn 短命 agent 去立案子任务，
那个 agent 必须能读当前 active goal 及其 AC。没有 MCP verb 就只能 shell-out 手搓，
**违反硬规则 1（用机件，不手搓）**。⇒ ABI 封装排在 driver 之前（§7 的 G4 → G5）。

### 5.4 遗留不一致（记账，本规格不处理）

改完后 goal 是 provider-backed 而 `document-store` 仍是 Core-owned。
GitHub 原生有 milestone API（title/description/state/due_on），未来若做真映射而非 stub 是可行的，
但 AC 子记录无对应物 ⇒ 长期也建议按 capabilities 声明部分支持。

---

## 6. driver 设计（新 kind `goal`）

### 6.1 职责边界（由裁定 3 与 5 划定）

| 动作 | 谁做 |
|---|---|
| `draft → active`（**激活**） | **人 / manager 手动**，driver 不碰。受 I1′ 硬上限拦截 |
| `active → achieved` | **driver 机械 flip**（裁定 5：I2 的确定性推导，不算晋升） |
| `active → retired`（**放弃**） | **人裁定**。driver 只报红，不翻状态（与裁定 3 对称：放弃是判断不是计算） |
| 跑 AC `criterion`、写 `evidence` | **driver 机械环** |
| 立案子任务填补缺口 | **driver 算缺口 → spawn 短命 agent 经 ABI 写** |

### 6.2 循环体（例程型 / Layer 1b）

```
每轮：对每个 active GOAL
  ① 对其每条 AC：跑 criterion → verdict → 写 evidence（落 GateEvent）
  ② I2 推导 → 全达成则 flip achieved
  ③ I3 判陈旧 → fresh | stale | NOT-EVALUATED
  ④ I4 查 status 与推导的分歧
  ⑤ 算缺口：对每条未达成 AC，count(task where goal_ac == AC and status ∈ {todo,ready,in-flight}) == 0 ⇒ 缺口
     缺口非空 ⇒ spawn 短命 agent 带【结构化清单】立案 children
→ 一条 Fact[] 写 .quay/goal-round.jsonl；reportFacts 上报
```

`Fact.state ∈ verified | not-evaluated | failed`（`driver-runtime.ts:762`）**正好承载 I3 的三态**——
不需要新增表达形态。

**⑤ 的纪律（照 `promotion-driver.ts:210-266` fix-worker 的现成模式）**：
driver **只记 `spawned: true`，不信 agent 自述**，下一轮用 `task_list` 独立复核。

### 6.3 硬边界

- driver **不直接改 task 状态**——那是 lifecycle / promotion-driver 的写点，多写者撞 `expectedStatus` CAS
- driver **不机械写 `tasks/*.md`**——全仓四个 driver 零先例，只有"spawn agent 经 ABI 写"

### 6.4 新增 kind 的改动面

`driver-runtime.ts:110`（`DriverKind` 联合类型）+ `:138-207`（`DRIVER_KINDS` 加一条，照 `quality`/`suite` 的例程型形状）
+ 新 `plugin/scripts/goal-driver.ts` + `drivers.yml` + `driver-config.ts:36-42,45-58,100-107`
+ **`packages/quay/src/cli/driver.ts:31` 的 `KINDS` 白名单**。

> ⚠️ **最后一处已经漂移过一次**：`cli/driver.ts:31` 的 `KINDS` 是 `["promotion","worker","outer","quality"]`，
> **缺 `suite`**，而 kernel 的 `DRIVER_KINDS` 有 5 个。新增 kind 必踩，提前记账。

---

## 7. 分期与验收

> **总纪律（直接针对上一次的死法）**：每期 AC 必须形如「**生产载体中满足 X 的记录数 ≥ N，
> 且只计实现落地之后的时间窗**」。**反例判据：把 fixture / 注入 seam 关掉后仍能通过的 AC 才是测量**
> （硬规则 4 推论三）。**上一次就是"实现了 + 测试绿 + 标 done"而生产零记录。**

| 期 | 内容 | AC |
|---|---|---|
| **G1** | 词表与 id 改造：`GOAL-NNN` + `draft` + `goal:` 字段 + 默认 status 改 `draft` | AC-170 |
| **G2** | **先迁移**：当前阶段 + 下一阶段迁成真实记录；`draft` 有真实载体 | AC-171、AC-172 |
| **G3** | **断权威**：`manager-phase-goal.md` 降级归档 + prompt 指针 repoint | AC-173 |
| **G4** | I1′ 硬上限 + I3 三态 + I4 分歧 | AC-174、AC-175 |
| **G5** | ABI 封装（§5.2 全部） | AC-176 |
| **G6** | goal-driver 机械环 | AC-177 |
| **G7** | `goal_ac` 关联 + 缺口计算 + 语义环 | AC-178 |
| **G8** | Web 卡片 + `quay goal` 子命令 | AC-179 |
| **G9** | 缺口语义环：driver 派短命 agent 经 ABI 立案，下一轮独立复核 | AC-185 |

### 7.1 为什么迁移（G2）排在 ABI（G5）之前

**上一次的死因就是"建好了没人迁"**：`goal-store.ts` 功能完整、有测试、有 `/goal` 路由、
`gap-spec-goal-store-third-sibling-kind` **标 done**，而 `goals/` 目录**在任何分支上从未存在过**，
`.quay/gate-events.jsonl` 中 `"gate":"goal"` **零条**，落地后 **28 天零改动**。

⇒ **先让 store 里有真实数据、并断掉散文文件的权威地位，机制才有"不用就疼"的消费者。**
此后每一期都在一个活的载体上加东西，而不是给一个空目录加功能。
记录是 markdown 文件，G5 的重构不会让它们丢失。

---

## 8. 本规格自身立为 `GOAL-001`（人 2026-09-06：「将其自己创建成一个 GOAL…我们将手动驱动这个 GOAL 的实现，同时为其更详细的设计和实现提供经验」）

`goals/GOAL-001-*.md` + `goals/AC-170..AC-178-*.md` 与本规格同批落盘。

**⚠️ 这些记录在 G1 落地前【机器读不到】，这是有意的**：
`goal-store.ts:48` 的 `PHASE_ID_RE` 不匹配 `GOAL-001`，`list()`（`:168`）只收
`PHASE-`/`AC-` 前缀的文件 ⇒ **`GOAL-001-*.md` 会被静默跳过**，而 `AC-17x-*.md` 能被列出但
`goal:` 字段不被 `listActive()`（`:186-189`）认识。**AC-170 的达成就是"让它们能被读到"。**
这不是缺陷，是 bootstrap：**本规格的第一条判据，是让承载本规格的记录变得可读。**

**GOAL-001 自身即 I1′ 的第一个证据**：它与迁移进来的 `GOAL-002`（当前阶段「三层塌缩」）
**必然同时 active** —— **在旧 I1 下这是非法的**。

---

## 9. 已知影响面与风险

| 项 | 说明 |
|---|---|
| `manager-phase-goal.md` **不能删** | `outer-anchor-check.ts:81` 与 `manager-anchor-check.py:32` 要求它存在 ⇒ 只能降级为归档 |
| 测试 fixture 依赖 | `integration-batch-merge.test.mjs:482,535-549` 拿它当「manager 未提交编辑必须被拒」的 fixture。文件停止被编辑后需换 fixture |
| 其他断言者 | `semantic-observer-judge.test.mjs:343`、`tick-core-static-check.test.mjs:420-433`、`suite-bucket-attribution.test.mjs:16` |
| 代码注释溯源 | ~20 处 `// WHY THIS EXISTS（manager-phase-goal.md ### ACxxx）`。**AC 保号迁移后仍指向归档文件，有效**，不必批量改 |
| prompt 指针需 repoint | `manager-tick-prompt.txt:1`、`manager-loop-tick.md:66,80`、`manager-tick-core.md:33`(A20)、`REVIEW-cadence.md:27,93,155` |
| **散文文件的范围标注已漂** | 当前阶段标题写「AC143–**AC149**」，而该段实际含到 **AC155**（`39617238e` 追加 AC150-155 未更新标题）。**这是"散文不能继续当权威"的直接物证**，也是 G2 迁移必须逐条核对而非按标题范围批量搬的理由 |
| `gateFactories` 缺口 | `makeGoalGate` 已 export 但未进 `gate/factories/index.ts:28-35` 的 dispatch map ⇒ 不可经 `gates.yml` 配置。照抄会继承该缺口，本轮一并补 |
| `cli/driver.ts:31` | `KINDS` 白名单已与 kernel `DRIVER_KINDS` 漂移（缺 `suite`） |
| ⛔ **不要做成 `role: compound` task** | 三处机械排除使其永不被 driver 驱动：`ready-pool-check.ts:1921-1929`（永不晋升）、`slot-refill.ts:1050`（永不派发）、`touches-orthogonality-check.ts:386-405`（compound 不带 self-file ⇒ **goal 自己的文件无人有权改**）；且 `it0-split-or-commit-check.ts:172-180` 使"刚创建未分解"成为非法态；`role` 还是派生量（`children.length > 0`）不可自定义 |
| 去重 | 无既有任务主张此事。最近邻居 `gap-spec-goal-store-third-sibling-kind`（**done**，机制已建、迁移未做）——本规格**不是重建 store，是把它从零使用变成生产使用** |

---

## 10. 本规格的判据来源与其局限

- §1 的重算是 2026-09-06 实测，`n=1` 时点；`label:milestone-candidate` 的「生产管线已停」结论
  基于 DIR-* 文件的最后触碰时间排序，**若 DRAIN 恢复运行则该结论即刻失效**，应重测。
- §4.2 的 `cap=3` / `stale=7d` **没有成本结构支撑**，是人给的初始策略值，复核点已写死。
- 本规格未处理 `label:milestone-candidate` 本身的存废，也未处理 `document-store` 的归属不一致——
  两者都应单独立观察项，不在本规格的 AC 内。

---

## 10b. 总纲（§11–§13 的共同前提）：**goal 是语义的，机械判据是它的封装而非定义**

**一句话立场**：目标本身是语义的；`criterion` 这类机械判据是**为了让它被稳定地实现与复核而采用的手段**。
⛔ 反过来理解——把「AC 的合取」当成目标的定义——会系统性地产出两类错误：为了凑出可判的 AC 而
**缩小目标**，以及 AC 全绿时**宣告一个并未达成的目标**。

**本机制在两个层级上是同构的**，每一层都是「语义核心 + 机械封装 + 一道专门盯封装是否失真的闸」：

| 层级 | 语义核心 | 机械封装 | 盯封装的闸 | 闸问的问题 |
|---|---|---|---|---|
| **AC 层** | `expect`——这条判据**声称要证明什么** | `criterion` | **保真闸**（GOAL-013，`criterion-fidelity.ts`） | criterion 能否在 **expect 声称的对象**上取假？恒真 ⇒ `vacuous` ⇒ 拒绝激活 |
| **GOAL 层** | `## 退出条件`（散文） | **AC 集合** | **充分性闸**（`goal-driver.ts:629`） | 退出条件是否被在域 AC **覆盖**？`insufficient` ⇒ 不 flip |

`criterion-fidelity.ts` 头注释逐字给出了 AC 层的这组关系：「`expect` — the outcome the criterion
**PROVES (its claimed object)**」「can this criterion be FALSE **on the object its `expect` claims
to measure**?」。

**最硬的证据是 `achieved` 需要【两个】条件**：在域 AC 全部 achieved **∧** 充分性 `verdict === "covered"`。
**若 AC 的合取就是目标的定义，第二个条件在逻辑上多余。** 它不多余 ⇒ **机制自己承认「AC 集合可能不等于目标」**，
并把这条缝隙交给一道语义闸看守。⇒ 「机械 AC 只是手段」不是一种态度，是这套机制已经写进代码的结构。

**§11–§13 在这个框架里的位置**（三者是一条链，不是三条独立规则）：

- **§11** 决定**哪些语义保证值得长期维持**（⇒ 上移 goal 层）。
- **§12（含 §12b）** 决定**其中哪些能被机械封装而不失真**（会回退的量若无 `long-term` 复验通道，
  封装后会永久声称一件已不成立的事 ⇒ 封装失真）。
- **§13** 处理**语义核心本身判不出布尔值**的情形——此时封装的对象不是"事实"，而是"那个语义判断
  的可信度"。

---

## 11. task 层判据是一次性的，需长期维持的保证上移 goal 层

**这是 GOAL-007（done 任务的判据后来变假无人再评估，三例实测）方向【丁】的落点**，不是新提案。

**层级不对称（根因，逐字记录）**：goal 层【有】再评估——goal-driver 每轮（约 42 秒）对每条
active AC 跑 `gateCriterion`，产出 pass/fail，achieved 与 fail 的分歧会被报为
`achieved-but-failing`；task 层【没有】任何等价物——`extra.acceptance` 只在 fan-in 当轮跑一次、
此后再不重跑，「能取假」的负控制在当轮验证一次即被丢弃，不成为常驻判据。同一个洞在两层都存在，
但 goal 层至少能【看见】它（其处理者已立 gap-goal-achieved-but-failing-no-handler），
task 层连检测者都没有。

**结论：task 层判据是一次性的验收**——它回答「这次实现对不对」，不回答「这个保证以后还成不成立」。
task 翻 done 后，其判据不再被任何机制重新评估（GOAL-007 三例实测：全部 status: done、全部由人
手工发现而非机制发现，且常驻测试因 fixture 钉死前提而恒绿）。

**上移规则：凡需要长期维持的保证，一律显式上移为 goal 层 AC**（`kind: criterion`），那里
goal-driver 每轮已有再评估。上移把「哪些保证值得长期维持」变成一个显式选择，而不是默认所有
task AC 都长期有效。这条不对称必须进正本，否则它只活在一次对话里。

**这是对四条候选（甲/乙/丙/丁）的取舍**：甲（撰写纪律，取假条件成常驻测试）守与不守在记录上
无法区分（硬规则⑨，应造产物而非写得更醒目）；乙（比对测试 fixture 取值与生产载体取值）只覆盖
三例中的①，②是 abort 分支未覆盖、③是绕闸，都不是 fixture 与生产的取值不一致；丙（task 层
仿 goal-driver 重跑判据）有先例、形态清楚，但成本与判据选择未决。丁（上移 goal 层）不新增机制，
把长期性保证的归属一次性摆正，且与已有 goal-driver 再评估环直接衔接——它是唯一一个既不需新契约、
又不把「维持」当默认的选项。

**成本边界（硬规则④推论一：成本结构未知前不设采样率/周期）**：task 数以百计、多数 acceptance 是
suite 规模命令，不能周期性重跑全部 done 任务的 acceptance。上移之后，长期保证的重跑成本由
goal-driver 每轮对 active AC 的轻量 criterion 承担，而非对 task acceptance 的全量重放。

---

## 12. 什么样的量可以当 goal AC——「会回退的量不得作 AC」筛子

**§11 的上移规则缺一个过滤器**：不是每条「需长期维持的保证」都能上移成 goal AC。上移之前必须先问
一个可当场回答的问题——**这个量会不会回退？** 答案分两岔：

- **会回退（活性量）**：进程在线与否、载体新鲜与否、某个常驻消费者是否存活——进程一停、载体一冷，
  判据即假。这类量**天然属于监控面**（`quay driver status` 的 `alive`/`supervisor_stale`、
  drivers 读数的 `staleSecs`），**不得作为 goal AC**。
- **不会回退（单调达成量）**：记录数只增不减、某物一旦建成即不再撤销、一次性迁移完成——达成即终态。
  这类量**可以作 goal AC**。

**为什么这条是硬约束而非品味**：`goal-driver.ts:633` 对 active AC 判据 pass 时机械 flip
`active→achieved`，而 `:640-643` 明写**驱动不做反向翻转**（achieved→active 与裁定 3「激活归人」打架）。
⇒ 一个会回退的量一旦被翻成 achieved 即**永久锁死**——此后量回退了也没有任何东西把它翻回来，
记录永久声称一件已不成立的事。这正是硬规则 4 要防的形态：一个结构上不可能再取假的判据不是测量。
**AC-181（2026-09-06 退役）、AC-184、AC-186（2026-09-09 退役）是三个已归档实例**——三条都是
「常驻进程/载体新鲜」形状的活性量，照原样激活都会永久锁死。

**单调达成型的正例（筛子不是一律否决）**：AC-177「`.quay/goal-round.jsonl` 有 ≥3 条带 verdict 的
记录」。把它套进筛子：这个量会不会回退？**不会**——`goal-round.jsonl` 是 append-only 载体，记录数
只增不减，一旦 ≥3 条就永远 ≥3。⇒ 判定为「可作 AC」。这是筛子的负控制：它能区分「会回退」与
「不会回退」，不是把一切 AC 都否决。

**操作纪律（与 §11 合读）**：§11 决定「哪些保证值得长期维持」，本节决定「其中哪些形态能成为
goal AC」。两步都过，才是一条合法的 goal 层判据；只过 §11 不过本节（活性量上移），是
AC-181/AC-184/AC-186 的类别错误。

### 12b. ⚠️ 更正（2026-09-15）：`long-term: true` 把上面的二岔改成三岔

**本节写于 `long-term` 复验域机制落地之前 6.5 小时,其绝对禁令的前提已经变了**——两个时刻都可当场核：

```
§12 落地            ee105a4b9  2026-09-09T04:25:10Z  docs: 新增 §12「会回退的量不得作 goal AC」筛子
long-term 复验域落地             2026-09-09T10:51:39Z  gap-goal-standing-ac-reverify-scope: I5 复验域加 long-term 显式声明 + inScope 枚举
```

⇒ 本节推理链上的那一步「achieved 即**永久**锁死，此后没有任何东西把它翻回来」，在
`long-term: true` 存在之后**不再无条件成立**：该字段把 AC 送进 AC-216 复验域
（`achieved ∧ long-term ∧ GOAL 非 active`），goal-driver 每轮重跑它，回归时以
`standing-violated` 自动立案。⛔ 注意 `writeGoalStatus` 仍然只写 `"achieved"`、仍无反向翻转——
**变的不是"能不能翻回来"，而是"翻不回来这件事还要不要紧"**：复验域让一条已 achieved 的 AC
在回归时重新产生动作，所以它不再是一个结构上不可能取假的记录。

**筛子因此从二岔变三岔**：

| 量会回退？ | 带 `long-term: true`？ | 判定 |
|---|---|---|
| 会 | ❌ 否 | **仍然不得作 AC**（本节原结论不变，AC-181/184/186 即此类） |
| 会 | ✅ 是 | **可作 AC**，进复验域每轮复验 |
| 不会 | — | **可作 AC**（本节原结论不变，AC-177 即此类） |

**⛔ `long-term` 不是免费的**：它把成本从「一次判定」变成「每轮复验」，故 §11 的成本边界
（判据必须轻量，⛔ 不得是 suite 规模命令）对它加倍适用。**先例**：GOAL-020 的
AC-265/266/267/269 四条都是会回退的量（CI 会再红、release 会再挂），全部写 `long-term: true`
并把判据做成「读本地载体 + 静态断言」的轻量形态；AC-268（一次性发版）不带。

---

## 13. 语义核心判不出布尔值时——**封装的对象是「判断的可信度」，不是判断本身**

**承 §10b**：§11/§12 默认语义核心能被翻译成一个事实断言；本节处理**翻译不成**的情形。
有些目标的语义核心天然不是布尔量：「Web UI 与设计 mockup 视觉一致」「这个 API 好不好用」。
本仓库自己的
`plugin/skills/quay-webui-bootstrap-methodology/reference/visual-review-mechanism.md` 开篇即逐字承认：

> `visual_design_quality` is a soft criterion — "visually coherent and accessible" has no binary
> pass/fail definition the way a logic test does.

**⛔ 不要把 LLM 判定直接写进 criterion。** 两个结构性理由：①**预算不够**——criterion 的
`timeoutMs` 是 **60s**（`goal-store.ts` gate 调 `runAcceptance` 处），而两个 LLM 判官各自的预算是
**180s**（`SUFFICIENCY_TIMEOUT_MS` / `FIDELITY_JUDGE_TIMEOUT_MS`）：**判据的预算比判官短三倍，
设计上就没打算让 criterion 调 LLM**；②硬规则 4——不确定性判定倾向给出肯定答案，写进 criterion
会得到一个看起来绿、却取不了假的判据。

### 13.1 决策入口：先问「语义核心有没有**稳定的结构对应物**」，⛔ 不是先试机械再退而求其次

这个问题有且只有两种答案，**决定形态的是它，不是判据写起来方不方便**：

- **有** ⇒ 用 **(a)/(b)**：把语义意图编码成产生它的结构断言 / 客观分量阈值。
  它们是**廉价替代**——正当性来自「这个意图恰好有稳定的结构对应物，替代损失可忽略」，
  ⛔ **不是因为它们比语义判断更严谨**。
- **没有** ⇒ **必须用 (c)**：保住语义判断本身，只给它加封装。**(c) 才是忠实形态。**

**⛔ 最重要的一条禁令**：语义核心没有结构对应物时，**不许把它强行拆成一组 (a)+(b) 的代理量**。
后果不是「判得粗一点」，而是**一组分量全绿、而目标并未达成，且记录上看起来已经被判过了**
——这是硬规则 3b 的形态（没测到却与合格同形），**比根本没有判据更贵**。
`visual-review-mechanism.md` 的那句「Both are mandatory; **neither substitutes for the other**」
说的正是这件事：机械分量与整体判断互不替代。

### 13.2 (c) 忠实形态：语义判断照做，机械只封装它的**可信度**

**可机读的软判定长什么样，仓库里已有正确范式**：`plugin/scripts/pool-quality-judge.ts:45`
`export const VERDICTS = ["ready","needs-work","should-remove","uncertain"] as const;`，
其头注释逐字「**脚本只做算术，判定交给 agent**」；AC 记录自带的 `fidelity: {verdict, reason, at}`
字段同形。⇒ **人/LLM 判定 → 闭集枚举 + 理由 + 时刻 → 落 jsonl → 确定性 criterion 读枚举。**

**三条约束只碰判断的【来源、时效、形式】，一律不碰判断的【内容】**——这就是「保持语义核心」的确切含义：

| 约束 | 管什么 | ⛔ 不管什么 |
|---|---|---|
| ① 判词在闭集 | 让语义判断**可被机器读取** | 不规定该判 PASS 还是 FAIL |
| ② 判定晚于实现 | 让判断**对应当前状态** | 不规定判断标准 |
| ③ 判定者独立 | 让判断**不是自证** | 不替判断者做判断 |

⇒ 「把判断与判断的记录分离」**不是一种损失或妥协，而是正确的分工**：criterion 本来就不该判语义，
它的职责是**保障那个语义判断可信**。**封装不是替代。**

**(c) 的 criterion 必须同时断言三件事，缺一条即退化为自证：**

```
① 判词在闭集里    rec["verdict"] == "PASS"（⛔ 散文不行——criterion 读不了自然语言）
② 判定晚于实现     rec["ts"] > git log -1 --format=%cI -- <实现文件>   ⛔ 不写死 sha
③ 判定者独立       rec["reviewer_session"] != <实现者会话>              ← 承重墙
```

**⚠️ 现状记账（2026-09-15 实测，⛔ 不要以为 (c) 已经能用）**：§0c 双重强制检查机制
（Lighthouse 阈值 + fresh-context 整体评审、四模式视口网格、Lighthouse 必须先跑）确实存在，
但**整个在 goal/AC 机器之外**，三个读数：
`grep -rn "CONCERNS" --include=*.ts --include=*.mjs --include=*.sh plugin/ scripts/ packages/` = **0**
（零计数已做正控制：同一谓词对 `.md` 有命中 ⇒ 是真 0，不是谓词失效）；
`goals/*.md` 中引用视觉评审的 AC = **0**；评审 verdict 是 `.md` 散文（`The page as a whole: PASS.`）
而非结构化枚举，**criterion 读不了**。**且约束③在实测中塌了**：
`experiments/quay-webui-bootstrap/audits/` 的 11 份评审里 9 份带 `Reviewer` 字段，
7 份明确是 `Inline (same session…)` / `Orchestrator inline (degraded-fallback mode)`，
2 份声称 fresh-context 的里还有 1 份自陈 `same session` ⇒ **真正独立的只有 1 份**。

### 13.3 (a)/(b) 廉价替代的写法与其损失

⚠️ 仅当 13.1 的答案是「**有**稳定结构对应物」时才可用。

- **(a) 意图 → 产生它的结构断言。** 这是本仓库既有的、唯一被真正执行过的做法。
  `tasks/QX-017.md`（纯视觉 bug「actions 列在手机上要粘住右边」）把视觉意图编码成产生该效果的
  那条 CSS 声明：`pageStyles() 在 @media (max-width: 600px) 块内对 .col-actions 含
  position: sticky; right: 0`；`tasks/QW-001.md`（标题逐字含 `(visual_design_quality)`）同形，
  7 条 AC 全是可 grep 的结构断言。**替代损失要写进 `expect`**：它判的不是「看起来像不像」，而是
  「产生那个效果的机制在不在」——对「粘住右边」几乎无损，对「整体气质一致」**不成立**。
- **(b) 客观可量化的分量 → 阈值。** 如 Lighthouse `accessibility ≥ 90`。⛔ 阈值不得凭空设
  （硬规则 4 推论：成本结构未知前不设数值阈值）——先量基线，或改用**关系而非快照**
  （`plugin/scripts/test-file-baseline.ts` 的规矩：断言「不得比基线更差」，⛔ 永不写 `== <常量>`）。

### 13.4 约束③（判定者独立）无法保证时怎么办——⛔ **不是**退回 (a)+(b)

评审者就是实现者时，那条 AC 是自证而非测量（硬规则 4），此时**问题出在评审流程，不在判据形态**，
所以修的也应该是评审流程：**建立一条真正独立的评审通道**（fresh context / 另一个会话 / 另一个人），
而不是换一种判据写法。

⛔ **此时【不得】退回 (a)+(b) 的组合**——若该目标的语义核心本就没有结构对应物（13.1 的第二种答案），
用一组代理量顶上，正是 13.1 那条禁令要防的事：分量全绿、目标未达成、而记录上像是判过了。
⇒ **独立通道修不了时，正确动作是【不立这条 goal AC】**，并把这个缺口显式记账
（该目标此刻没有可信的 goal 级判据），语义判断留在 task 层的 AC 复选框上由人勾。
**⛔ 一个诚实的空白，好过一条读自证载体的 criterion。**

**⇒ 本节总结（承 §10b）**：criterion 必须可执行，这一点不因目标偏语义而松动；但它封装的对象
随目标性质而变——目标可翻译成事实断言时封装「事实」，不能翻译时封装「**那个语义判断的可信度**」。
**两种情况下语义核心都没有被机械判据取代，只是被它保护起来。**

**已对了一半的现成件**：`orchestration/manager-visual-check.py` 的 `stdout` 已是 JSON、
退出码只表示调用成败（`0=调用成功（无论视觉判断内容）`，⛔ 不把「仪器失败」与「判断为否」混同）
——形态正确。它离 (c) 还差的是：verdict 未约束为闭集、结果不落载体、无 reviewer 身份字段。
⛔ 但它依赖操作者**个人的**阿里云订阅（manager SKILL §10），**不得原样搬进产品判据**；
要产品化须走正常路径（转 outer → inner 实现 → 用项目自己的服务账号 key）。
