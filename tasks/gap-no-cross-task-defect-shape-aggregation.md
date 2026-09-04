---
id: gap-no-cross-task-defect-shape-aggregation
title: 没有任何机制回答「最近 N 条已落地缺陷是不是共享同一个根」——架构债只以「N 条同形缺陷」的形态出现，而聚合只发生在人来问的时候
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

这个循环的输入是**单条缺陷**（全部任务族名为 `gap-*`，触发器是"观测到一次失败"）。而架构债**从不以
单次失败的形态出现**——它以"N 次失败共享同一个根"的形态出现。**今天没有任何机制做这个跨任务聚合。**

后果不是理论的：每一条缺陷单独看，用局部补丁 + 一个守卫修都是**正确的**；没有任何一条单独的缺陷会
"要求"那个抽象；**而每条缺陷的记录里也不包含"我是这个形状的第 N 个"这个信息**。

**本次会话的三个实证（全部是跨任务聚合才看得见，任何单条任务记录里都看不出来）**：
1. `readTaskStatusAtRef` 被**逐字复制 3 次**（`driver-filters.ts` / `ready-pool-check.ts` /
   `worker-driver.ts`），另有 ≥10 个文件各自手搓任务状态解析；`ready-pool-check.ts:1979` 的注释
   甚至写明"worker-driver.ts 的异步版本是同一个判定"——**承认过，从未统一**；
2. AC 复选框计数有 **4 个独立实现**，其中 `worker-driver.ts:readAcCheckState` 与规范实现
   `countAcCheckboxes` 对 `- [~]`（部分完成）的处理**已经产生行为分歧**；
3. 主检出根路径推导的 bug（`git worktree list --porcelain` 第一行不保证是主检出）在
   `refresh-worktree-quay.sh` 修过一次（`gap-refresh-worktree-quay-main-derive`，done），
   **另外 3 处仍在犯**，其中两处的注释还把错误当成不变量写着"guaranteed first"。

同族的聚合信号今天也全部无人报告：`plugin/scripts/*-check.{ts,sh}` 全历史新建 **185** / 删除 **13**
（14:1）；**120 个 checker 手工实现同一份被机械验证的契约**（`checker-mechanical-spine-check.ts --json`
→ `{"ok":true,"checkers":114}`），而共享基座的行为契约 `emitPass`/`emitFail` 取用 **0 个文件**、
`parseArgs` 仅 5 个。**数据一直都在，只是没有任何东西把它读成一个信号。**

**与既有任务的关系（已查，均非重复）**：
- `gap-audit-findings-not-backpropagated-to-earlier-detectors`（**superseded** 2026-08-19，判据写在
  已退役的经典循环术语上）方向**相反**——它是把一条已确认 finding 提升成**更早阶段的检测器**（即
  产出更多检测器）；本任务是反过来：识别 N 条缺陷共享一个根、需要**收敛**，产出架构候选。相关，不重复。
- `gap-dir126d-deferred-phase-timing-recurrence-tracking`（done）的 recurrence 跟踪是
  FindingEnvelope 内的 `recurrenceKey`，作用域是 prepare 阶段的 finding，不是已落地 `gap-*` 任务的跨任务聚类。

**形态参照（不要新造范式）**：`plugin/scripts/trend-check.ts` 是一个**被动读者**——只读已存在的
append-only 账本，算趋势、报出"每个点单独看都是绿的，但窗口整体在恶化"。本任务应当照抄这个形态：
被动、不新增写手、只读已经存在的 `tasks/*.md` 与 git 历史。

**修法方向**：一个被动聚合器，把最近落地的 `gap-*` 按"共享形状"聚类——候选信号：①共同触及的文件、
②标题/正文里的机制词、③共同载体；当一个窗口内 ≥N（如 3）条已落地缺陷落进同一簇时，输出一条
"这 N 条共享此根"的候选报告。**首版只输出、不自动立案**（避免造出一个往池子里灌任务的写手）。

**⚠️ 与"别再造工具"的张力，明写在此**：本任务确实新增一个脚本。但它**不是守卫**（不 gate 任何东西、
不产生红），而是**输入通道**——补上这个循环结构上唯一缺失的那类输入。若它落地后无人调用，它就退化成
本仓库反复批评过的"存在但不生效"，所以 AC5 强制它必须有真实调用点。

## AC

- [ ] AC1：实现被动聚合器并对本仓库真实历史跑一遍，输出前 5 个簇及其成员任务 id（贴真实输出）
- [ ] AC2（对已知真样本干跑，硬规则 2b）：聚合器须**独立重新发现**本次会话中人工找到的 3 个簇里的
      **至少 2 个**（状态解析重写 / AC 计数器 / 主检出根路径推导），且只使用这些发现被写下来**之前**
      就已存在的数据；重现不出来 ⇒ 说明聚类没有测到它声称在测的东西，必须先修聚类再算通过
- [ ] AC3（负控制，防假阳性）：不得把"仅仅因为不相干的原因触及同一个文件"的任务群报成一个簇
      （例：几十条任务都改过 `worker-driver.ts`，但根因各不相同）——贴出一个它**正确地没有**报出的
      真实例子，或给出在一个人工标注样本上的精确率读数
- [ ] AC4：首版为**被动**——本任务范围内不写任务库、不自动立案；输出是给人/manager 读的报告
      （范围声明写进任务体，避免下一个实现者顺手加写手）
- [ ] AC5：接入一个真实节奏（不是"存在但没人调"）——点名调用点，并贴出一次真实运行记录作为证据

## DoD

AC1 的真实簇输出、AC2 的"重新发现已知簇"的成员清单对照、AC3 的负控制样本、AC5 的调用点证据，
全部贴进任务体。**AC2 是硬要求**：一个聚合器如果连已知为真的三个簇都重现不出来，它报出的新簇没有
任何可信度——这正是本仓库硬规则 2b 要求的"把谓词对着已知为真的样本干跑一次"。

## Touches

- plugin/scripts/defect-shape-aggregate.ts（新增）
- plugin/test/defect-shape-aggregate.test.mjs（新增）
- plugin/scripts/capability-catalog.sh（登记新脚本）
- tasks/gap-no-cross-task-defect-shape-aggregation.md
