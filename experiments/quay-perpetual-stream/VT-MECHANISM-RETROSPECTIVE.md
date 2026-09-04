# VT 机制归档与停用记录

**状态**：VT 机制及其全部依赖机制已于 2026-09-03 由人裁定停用（作为 `gap-outer-bg-job-migration-
proposal` 的一部分）。本文档是归档 + 移除依据的记录，也是**为未来可能新建的探索机制**留的
设计参考——保留原设计的完整说明、移除的实证依据、以及从这套机制的生命周期里能提炼的教训。

**不要**把本文档当作仍在生效的机制说明来读——它描述的是**历史设计**，末尾单独标注了"给未来
探索机制的参考点"。

---

## 一、VT 是什么（历史设计，来自 `docs/proposals/quay-perpetual-stream-experiment-v5.md` §4.1/§6.2）

**VT = Value Trajectory（价值轨迹）**：exp5（`quay-perpetual-stream`）outer 循环用来判断
"要不要继续、往哪走"的核心健康信号，2026-07-18 决议（§8）确立。

### 1.1 计算公式

```
VT = Σ_surface (weight_surface × coverage_surface)
```

chart-0（初始版本）的 surface 权重表：

| Surface | Weight | 含义 |
|---|---|---|
| CLI | 25 | 核心交互面 |
| MCP | 20 | 集成/消费者面 |
| Web UI | 20 | 可视化交互面 |
| Packaging / Distribution | 20 | 当时最大缺口（DIR-004） |
| Docs | 15 | 可用性面 |
| **Σ** | **100** | chart-0 满分 |

2026-07-23（M121/DIR-064）触发 **chart-1 → chart-2 transition**（chart-1 冻结于 108.65/120，
108 个 milestone 未移动——VT 饱和信号的实证）：chart-2 引入 S1（Distribution-reliability）/
S2（Delivery-completeness）/S3（External-validation）/S4（Methodology-executability，SOFT）
四个新 surface，用 chart2-s1/s2/s3-*.ts 三个独立"value ruler"脚本计算。

### 1.2 校准循环（predict-then-measure）

- 每个 milestone 启动前，outer 承诺一个数值假设 `Δv̂`（预计这个 milestone 能带来多少 VT 增量）
  + 一个度量指标 `Y`
- milestone 完成时（checkpoint），实测 `Δv`，计算校准误差 `|Δv − Δv̂| / Δv̂`
- **健康度 = VT 斜率**（边际增量，marginal value per milestone），不是绝对值高低
- 退出信号 = 斜率跌破预设阈值（`rolling-slope-check.ts`，DIR-038-A，K≥5 含零-Δv 窗口）
- 终止判据（`termination-delta-v-check.ts`，CRYST-D3 R7）：ΔV < 0.02 连续 K=2 次

### 1.3 无界化机制

单个 chart 内 VT 饱和趋近 100；饱和后要么开辟新 chart（explore milestone 新增一个 surface，
`chart-headroom.ts` 判断余量），要么斜率持续下降就是诚实的外部 HALT 信号。这是 VT 设计里
解决"有界覆盖率 vs 无界价值追踪"张力的核心思路。

### 1.4 治理配套

- **explore/exploit 强制配比**：`explore-exploit-cadence.ts`，`I₈: explore ≥1 per 5`（每 5 个
  milestone 至少 1 个 explore 类）——防止方法论核心固化，只吃已知表面
- **deliverable-governor**（DIR-066，SOFT）：shortlist 组装时的可交付性分类，不是硬阻断
- **governance-product-ratio-check**：治理类 vs 产品类工作的比例（后来降级为 INFORMATIONAL only）

---

## 二、依赖 VT 的机制完整清单（2026-09-03 逐一核实，非关键词匹配——按位置判定）

### 2.1 A 类：纯 VT/milestone-only 机制（人 2026-09-03 裁定：随 VT 与 milestone 编排一并停用）

全部核实为**只被 `OUTER-LOOP.md`（已 RETIRED 于 2026-08-03）的 checkpoint 阶段 `invoke()`
调用**，无其它生产调用点；过去 7 天（2026-08-27~09-03）git 提交历史全部为 0（除
`vmeta-lag-check.ts` 的 1 次，见下方说明,该次也与 VT 执行无关）：

| 脚本 | 职能 | 唯一调用点 | 过去 7 天提交 |
|---|---|---|---|
| `outward-vt-check.ts` | VT 值本身的检查器 | OUTER-LOOP.md checkpoint | 0 |
| `rolling-slope-check.ts` | VT 斜率（DIR-038-A，K≥5） | `OUTER-LOOP.md:322` | 0 |
| `termination-delta-v-check.ts` | 终止判据（CRYST-D3 R7） | `OUTER-LOOP.md:326`（+`:308` C₅） | 0 |
| `chart-headroom.ts` | chart 余量（DIR-063） | `OUTER-LOOP.md:323` | 0 |
| `chart2-s1-distribution-reliability.ts` | chart-2 S1 覆盖率计算 | checkpoint（chart-2 专属） | 0 |
| `chart2-s2-delivery-completeness.ts` | chart-2 S2 覆盖率计算 | checkpoint（chart-2 专属） | 0 |
| `chart2-s3-external-validation.ts` | chart-2 S3 覆盖率计算 | checkpoint（chart-2 专属） | 0 |
| `deliverable-governor.ts` | 可交付治理分类（DIR-066） | `OUTER-LOOP.md:38,294` SELECT 阶段 | 0 |
| `governance-product-ratio-check.ts` | 治理/产品比例（已 INFORMATIONAL only） | `OUTER-LOOP.md:336` | 0 |
| `explore-exploit-cadence.ts` | explore/exploit 配比（I₈） | `OUTER-LOOP.md:291,307` | 0 |
| `milestones-since-transition.ts` | 距上次 chart transition 的 milestone 数 | checkpoint | 0 |
| `experiments/.../it0-dod-check.ts`（+`.sh`） | DoD 元强制器（milestone Land 专属 clauses 0-14） | milestone Land 步骤 | 0 |
| `experiments/.../concurrent-batch-scheduler.ts`（milestone-only 原版） | milestone 并发调度 | classic loop Build 阶段 | 0 |
| `serial-fanin-absorb.ts` | milestone_counter 推进 + dashboard 条目写入 | fan-in absorb 步骤 | 0 |
| `golden-replay-dir044.ts` | milestone 执行管线回归 fixture（DIR-044） | 单元测试专用（验证已死管线） | 0 |

**⚠️ `vmeta-lag-check.ts` 说明**：过去 7 天有 1 次提交（2026-08-29，`e99ec8711`），但内容是
"help-contract 补齐 experiments 镜像 helpExit"——纯粹的**技术性维护**（响应 help-contract 检查
契约要求补一个 `--help` 早退分支），不是 VT/V_meta 检查逻辑被真实调用产出数据。该脚本本身检查
的是"V_meta"（比 VT 更早的指标名，exp1-4 遗留），与本文档的 VT 属同族但非同一物——**归档范围
包含它是因为它的调用点同样只在已停摆的 milestone/checkpoint 路径上**，不是因为它计算 VT 本身。

### 2.2 B 类：名称/历史相关但已被两层 fast-mode 独立复用，**不受本次停用影响，继续保留**

排查中发现几个脚本因为名字或历史渊源被最初的 grep 命中，但核实后确认它们**已经从 milestone
时代的实现里被提取成独立副本**，供两层 fast-mode 直接使用，与 VT 无关：

| 脚本 | 独立副本位置 | 被谁用 | 结论 |
|---|---|---|---|
| `concurrent-batch-scheduler.ts` | `plugin/scripts/concurrent-batch-scheduler.ts` | `ready-pool-check.ts` 等 6+ 个两层 fast-mode 文件 import | **保留**——`computeTouchesExpansion` 等纯函数已被两层 fast-mode 复用（CLAUDE.md 已记录此事实） |
| `it0-split-or-commit-check.ts` | `plugin/scripts/it0-split-or-commit-check.ts` | fast-mode split 判定 | **保留**——独立副本，非 milestone 专属 |
| `vmeta-lag-check.ts`（判定逻辑本身） | `plugin/scripts/vmeta-lag-check.ts` | 通用"文档声明落后于实测"检测 | **保留**——vendored pair，供多项目复用；只是它的**milestone-only 调用点**（checkpoint 阶段读 dashboard.md 的 V_meta 记录）随 milestone 一起停用 |
| `loadbearing-test-gate.ts` | 仅一份，非 vendored | ADR-001 通用规则（load-bearing 方法基础设施 fixture-first） | **保留**——与 VT/milestone 无关，最初被 grep 命中是 false positive |
| `workflow-baseline-metrics.ts` | 仅一份 | DIR-124-A1 工作流事件流 baseline metrics（通用） | **保留**——与 VT/milestone 无关，false positive |

**核查方法说明（硬规则 2 的应用）**：最初用 `grep -l` 按关键词（`milestone_counter`、`chart`、
`VT`）扫描命中了这些文件，但按位置判定（读文件头注释 + 追踪真实 import 关系）后确认它们不属于
VT 依赖范畴。**这是本次调查里唯一的一处"零计数配套动作"**——排除 false positive 前，先对每个
候选打印了它实际匹配到的内容（文件头注释）与真实调用图，而非仅凭文件名/关键词命中就归类。

---

## 三、VT 停摆的实证依据（2026-09-03 核查，直接量，非文档自述）

| 载体 | 最后一次真实更新 | 距 2026-09-03 |
|---|---|---|
| `dashboard.md`（VT 唯一状态载体） | 2026-08-02 18:06 | 32 天 |
| `milestone_counter` 数值（206） | 2026-07-31（M209 Land 写入） | 34 天 |
| `checkpoints/` 目录最新文件 | cp-95（2026-08-11） | 与 counter=206 之间约 111 个 milestone 的 checkpoint 完全缺失 |
| `milestones/` 子目录最新创建 | 2026-08-11 之前 | 34 天无新 milestone 目录 |
| `quay-0` tmux 会话 | 无独立 outer 窗口 | 当前（2026-09-03 实测，只有 `claude`/`bash` 两个窗口） |
| 14 个 A 类 VT/milestone-only 脚本，过去 7 天（08-27~09-03）提交 | 全部 0（除 1 次无关技术维护） | — |

**结论**：VT 机制及其全部专属依赖机制，在生产意义上已停摆 32 天以上——不是"运行但产出慢"，
而是唯一状态载体完全没有新记录，且过去 7 天没有任何一个依赖脚本产生真实执行输出。项目的实际
开发驱动力已完全转移到两层 fast-mode（manager/inner，`gap-*` 任务）。

---

## 四、移除决定记录（人 2026-09-03，三次追加裁定）

1. **VT 机制本身不迁移，彻底移除**——迁移提案（`gap-outer-bg-job-migration-proposal`）不复活
   VT 追踪；新的 outer job 状态机不含 `vt` 字段。
2. **"Milestone"作为编排颗粒度整体移除**——milestone 唯一剩下的作用（build/audit/land 执行
   编排）与两层 fast-mode 的 `gap-*` 任务派发/fan-in 机制职能重复；outer 收窄为纯发现/立案层。
3. **原则上，一切依赖 VT 的机制都取消**——本文档 §2.1 的 15 个 A 类脚本全部纳入停用范围；
   §2.2 的 5 个 B 类脚本因已独立于 VT 服务两层 fast-mode，明确排除在停用范围外，继续保留。
4. **`waiting-for-human` 状态取消**——outer job 状态机定案为纯 `idle`/`running` 两态；需要
   人判断的候选走既有的"立案任务"出口，不由 outer job 自身挂起等待。

**停用的具体动作**（在 `gap-outer-bg-job-migration-proposal.md` Phase 4 Step 5 中追踪）：
`experiments/quay-perpetual-stream/{dashboard.md,checkpoints/,milestones/}` 目录与 §2.1 列出
的 15 个脚本评估归档或标注"已停用"横幅——不物理删除（保留作历史参考 + 满足硬规则 5 的"来源
完备性"，删除前需要走批量删除的落点映射流程）。

---

## 五、给未来"探索机制"的设计参考（这是本文档存在的主要理由）

用户已表示未来可能另建一个探索机制。以下是从 VT 机制近 2 个月生命周期（2026-07-18 决议
至 2026-09-03 停用）里能提炼的经验，供设计参考——**不是建议直接复用 VT 的具体公式**，而是
标注哪些设计思路值得借鉴、哪些是导致它悄然停摆而无人发现的结构性问题。

### 5.1 值得借鉴的设计思路

- **预测-测量循环（predict-then-measure）**：每次行动前先承诺一个可检验的数值假设 `Δv̂`，
  完成后实测校准误差——这个纪律本身是好的（它逼迫"声称有价值"必须可验证），比"做完了就是
  有价值"的隐式假设更诚实。
- **健康度用斜率不用绝对值**：避免了"分数很高但已经不再增长"这种虚假健康的假象。
- **无界化 via chart transition**：解决了"覆盖率有界（≤100%）但价值应该无界增长"的张力，
  设计本身是自洽的。
- **explore/exploit 强制配比**（`I₈: explore ≥1 per 5`）：用一个简单的计数规则防止方法论
  核心固化，这类"结构性强制"比"记得要多样化"这种自觉性要求更可靠（同 CLAUDE.md 硬规则 9：
  可见性≠执行，得给产物）。

### 5.2 导致停摆而无人发现的结构性问题（新探索机制应规避）

1. **单点状态载体，无独立活性监控**：VT 的全部状态压缩进一个文件（`dashboard.md`），没有
   任何独立于该文件自身的"这套机制是否还在运行"的检测器。它停止更新的 32 天里，没有任何
   一层（outer/manager/inner）的常规巡检点名过这件事——**同 CLAUDE.md 硬规则 4b**：判断
   一个机制是否活着，不能只看它自己维护的状态，要有外部可核的直接量（这份文档本身的 §3
   核查就是这样一次事后补课）。**新探索机制应该从第一天起就有一个不依赖自身状态文件的
   独立心跳/新鲜度检测**，而不是等一个月后被动核查才发现。

2. **编排颗粒度（milestone）与价值追踪（VT）耦合过紧**：milestone 既是"执行单位"又是"VT 计
   量单位"，当两层 fast-mode 提供了一套更好的执行编排（worktree 隔离、fan-in、gate 引擎）
   后，milestone 的执行职能被架空，而 VT 因为耦合在 milestone 上，**没有独立生存的路径**，
   跟着一起停摆。**新探索机制应该让"发现/评估价值"与"执行编排"解耦**——探索机制只负责
   产出候选和判断，不要重新发明一套执行管线（build/audit/land）去跟两层 fast-mode 竞争。

3. **新旧体系并存但无交接仪式**：两层 fast-mode 事实上取代了 VT/milestone 驱动的开发方式，
   但没有一次明确的"从今天起，新开发流量全部走两层 fast-mode"的裁定和记录——这个转移是
   隐性发生的（可能是逐渐的资源倾斜，而非一次决策），导致 VT 侧的停摆长期没有被识别为
   "已被取代"而只是被误读为"暂时安静"。**新探索机制若与既有机制存在功能重叠，转移决策
   应该显式记录时间点**，而不是任其自然发生。

4. **发现是好的，但"发现引擎"不该重新长出一整套执行分身**：VT/milestone 时代的 outer 既
   做发现（§4.4 discovery engine 的三层渠道）又做执行编排（SELECT→prepare→dispatch→land），
   这个"既要又要"的设计在两层 fast-mode 出现后成了冗余的另一半。**新探索机制的职责边界
   应该更早地划定为纯发现/立案**（本次 outer 迁移提案已经吸取了这条教训，直接把新 outer
   job 设计为薄的发现层）。

### 5.3 §4.4 discovery engine 的三层渠道（仍是有效参考，独立于 VT 计分公式）

VT 停用不代表"outer 该发现什么"这个问题的历史思考作废。§4.4 提出的三层探索渠道设计本身
与 VT 计分公式解耦，值得未来探索机制参考：

1. **Exploit channel**——标准仿真用户探索（polish 已知表面，不指望它产出结构性发现）
2. **Systematic-explore channels**——机械化的 it0 诊断 + 常续 gate（ceiling/floor 算术、
   gate-hash/transclusion 检查、dogfooding evidence-gate、domain-misfit audit-channel）——
   这四项本身是纯诊断逻辑，不依赖 VT 数值，理论上仍可独立复用
3. **Human-insight frontier**——不可机械化的部分，只能通过人类洞察邀请（`/quay-directive`
   的原始用途，现已改由 `SendMessage`/`task_write` 承接）

---

## 参考

- `docs/proposals/quay-perpetual-stream-experiment-v5.md` §4.1/§4.4/§6.2 — VT 与 discovery
  engine 的原始设计
- `experiments/quay-perpetual-stream/OUTER-LOOP.md` — 经典 outer driver（已 RETIRED,
  ADR-022），本文档 §2.1 清单里全部脚本的唯一调用点
- `tasks/gap-outer-bg-job-migration-proposal.md` — 本次迁移提案,Resolved Decision #3/#6/#7
  对应本文档的移除裁定
- `CLAUDE.md` 硬规则 4b（代理量 vs 直接量）、硬规则 2（按位置判定）、硬规则 5（来源完备性）—
  本文档的核查方法论
