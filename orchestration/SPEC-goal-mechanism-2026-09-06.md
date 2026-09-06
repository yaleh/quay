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
| **G2** | **先迁移**：当前阶段 + 下一阶段迁成真实记录；`draft` 有真实载体 | AC-171 |
| **G3** | **断权威**：`manager-phase-goal.md` 降级归档 + prompt 指针 repoint | AC-174 |
| **G4** | I1′ 硬上限 + I3 三态 + I4 分歧 | AC-172、AC-173 |
| **G5** | ABI 封装（§5.2 全部） | AC-175 |
| **G6** | goal-driver 机械环 | AC-176 |
| **G7** | `goal_ac` 关联 + 缺口计算 + 语义环 | AC-177 |
| **G8** | Web 卡片 + `quay goal` 子命令 | AC-178 |

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
