---
id: gap-ac61-staleness-list-item-disposition
title: AC61 清单逐条处置——A-1…A-7/B-1…B-4 迁出或核实有效 + integration 命中逐条分类
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac58-retired-clauses-delete-and-archive
---

**type:** execution

## Proposal

**AC61（清单逐条处置——通则做完之后）判据（phase-goal 逐字）**：
- 判据1：manager 2026-08-14 交出的清单 **A-1…A-7 / B-1…B-4** 逐条处置：
  **要么已按 AC58 迁出（带落点映射），要么明写「经核实仍有效」并给出核实读数**。
- 判据2（补 manager 没做完的那半，明写而不装作已覆盖）：**inner loop 文档 39 处 / outer loop 文档 12 处 `integration` 命中，
  manager 只给了计数、没有逐条打印分类** ⇒ **必须逐条打印并分类（活指令 / 退役注记 / 历史记述）**，
  **不得只给计数**（硬规则② 与 A0b⑤(c)）。
- **已知最严重的一条（inner 核 `:65 C7`）**：`integration-branch-model.ts --overlaps-unverified` **不得传空串**
  —— **该模块已于 AC48 标 RETIRED、零生产调用者** ⇒ **活指令指向退役模块**，且它就在 inner 现在要读的那份文件里。
- ⚠️ 不阻塞 AC54–57（四条都不碰那条路径）——排在通则之后，不插队。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 逐条处置 A-1…A-7 / B-1…B-4：迁出（AC58 + 落点映射）或「经核实仍有效」+ 核实读数。
2. **逐条打印并分类** inner loop 39 处 + outer loop 12 处 `integration` 命中（活指令 / 退役注记 / 历史记述）——不得只给计数。
3. 修 inner 核 `:65 C7`：活指令指向退役的 integration-branch-model.ts —— 迁出或改指有效模块。
4. 检查器：清单逐条有处置记录（迁出带映射 或 核实读数）；integration 命中逐条分类。

## Acceptance Criteria

- [x] AC1 A-1…A-7 / B-1…B-4 逐条处置（迁出带落点映射 或 核实有效+读数）。
- [x] AC2 inner loop 39 处 + outer loop 12 处 `integration` 命中**逐条打印并分类**（活指令/退役注记/历史记述），不得只给计数。
- [x] AC3 inner 核 :65 C7 修（活指令指向退役模块）。
- [x] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] 清单逐条有处置记录 + integration 命中逐条分类 + :65 C7 修。
- [x] 负控制（某条无处置记录 ⇒ 红）。

## Touches

- plugin/loop/fast-mode-loop-tick.md（inner loop integration 命中逐条分类——注记）
- plugin/loop/fast-mode-tick-core.md（:65 C7 迁出 → R25；:68 C10 改指 → R26）
- orchestration/fast-mode-tick-core.md（同 C7/C10 迁移，instance 副本）
- orchestration/archive/AC58-retired-clauses.md（R25/R26 落点）
- plugin/scripts/retired-clause-check.ts（R25/R26 注册）
- orchestration/orchestrator-loop-tick.md（outer loop integration 命中逐条分类——**outer 独占，建议**）
- plugin/scripts/ac61-staleness-disposition-check.ts（检查器）
- plugin/scripts/capability-catalog.sh（新检查器注册）
- plugin/scripts/checker-mutation-cases/ac61-staleness-disposition-check.sh（负控制 fixture）
- plugin/test/ac61-staleness-disposition-check.test.mjs（负控制单测）
- scripts/test.sh（接线）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY 快照再生成）
- tasks/gap-ac61-staleness-list-item-disposition.md（自身）

## AC61 处置记录（A-1…A-7 / B-1…B-4 逐条）

> 判据1：每条要么「已按 AC58 迁出（带落点映射）」要么「明写「经核实仍有效」并给出核实读数」。
> A 项（outer 核/文档）属 outer 独占写（C17 ①），本条记录核实读数 + 处置建议，**outer 落盘**；B 项（inner 核/文档）本条直接落地。

### A-1 — outer 核 :4/:17「工作分支两线、integration 作 checkout」
- 处置：经核实仍有效（仍未迁出——outer 独占，C17）
- 核实读数：`grep -cn "工作分支两线" orchestration/orchestrator-tick-core.md` ⇒ **3**（:4/:17 等，均描述已随 AC48 删除的 integration 分支）
- 建议（outer 落盘）：改为「单线 develop」——integration 分支已删；属 A-1 的类型⑦（活指令指向退役物）

### A-2 — outer 核 :65 B16「任务文件在 develop/integration 间漂移」
- 处置：经核实仍有效（仍未标前提已死——outer 独占，C17）
- 核实读数：`grep -cn "develop/integration 间漂移" orchestration/orchestrator-tick-core.md` ⇒ **1**（B16 仍把 integration 当冲突源）
- 建议（outer 落盘）：标「前提已死」（integration 已删 ⇒ 该冲突源不存在）；**保留 A/B/C 三层归因**

### A-3 — outer 核 :54 B5「verification-round.jsonl 断言 N == last+1」
- 处置：经核实仍有效（仍未标来源已冻结——outer 独占，C17）
- 核实读数：`grep -cn "N == last+1" orchestration/orchestrator-tick-core.md` ⇒ **1**（B5 仍要求追加并断言连续编号）
- 建议（outer 落盘）：标「来源已冻结、不计入覆盖率分母」（per-task 模型下全局轮次记录源已停；与 manager A7 同处置）

### A-4 — outer 核 :32 A9「读 excluded[] 里 not-yet-flipped」
- 处置：经核实仍有效（仍未标输入已死——outer 独占，C17）
- 核实读数：`grep -cn "not-yet-flipped" orchestration/orchestrator-tick-core.md` ⇒ **4**（A9 及其派生仍按 nyf 判积压）
- 建议（outer 落盘）：标「输入已死」（翻 done 已随 (a2)+fan-in 同时发生 ⇒ nyf 结构上恒 0）

### A-5 — outer 核 :34 A11 / :52 B3「读 full-suite-state.json 无新鲜度」
- 处置：经核实仍有效（FAMILY-5 病仍在——outer 独占，C17）
- 核实读数：`grep -cn "full-suite-state.json" orchestration/orchestrator-tick-core.md` ⇒ **2**（A11/B3 均无 finishedAt 新鲜度限定）
- 建议（outer 落盘）：加新鲜度限定（`finishedAt` 距今 < 一个 tick 周期才算实时）；FAMILY-5 扫描面已由 AC59 覆盖三层核

### A-6 — outer 核 :100「红窗分诊外层独占…回退对应翻 done」
- 处置：经核实仍有效（归属描述仍未更新——outer 独占，C17）
- 核实读数：`grep -cn "红窗分诊外层独占" orchestration/orchestrator-tick-core.md` ⇒ **1**（:100 仍写「回退对应翻 done」）
- 建议（outer 落盘）：归属改 inner（翻 done 已移交 inner），或明写「回退由发起方执行」

### A-7 — outer 核 :53 B4【RETIRED — AC48】
- 处置：已迁出（AC58 落地，R01）
- 落点映射：`orchestration/archive/AC58-retired-clauses.md#R01`（outer B4 批量合 integration→develop 正身；现核内仅留一行指针）

### B-1 — inner 核 :65 C7「integration-branch-model.ts --overlaps-unverified 不得传空串」
- 处置：迁出（本任务落地，AC58 形态）
- 落点映射：`orchestration/archive/AC58-retired-clauses.md#R25`；核内 C7 改一行指针 → #R25
- 核实：`retired-clause-check`（R25 注册：marker 已从 `orchestration/fast-mode-tick-core.md` 消失、archive 有家）

### B-2 — inner 核 :68 C10「主检出对账只用 integration-batch-merge.sh --reconcile」
- 处置：改指有效模块（本任务落地；**安全规则「不得自己发明 git reset --hard」保留**）
- 落点映射：`orchestration/archive/AC58-retired-clauses.md#R26`（旧「只用 integration-batch-merge.sh --reconcile」正身）；核内 C10 改指 `fast-mode-telemetry.ts --reconcile`（见 A13）
- 核实：`retired-clause-check`（R26 注册）

### B-3 — inner 核 :28 A9「读外层 full-suite-state.json 判 running/green」
- 处置：经核实仍有效（FAMILY-5 病仍在；读数确认）
- 核实读数：`grep -cn "full-suite-state.json" plugin/loop/fast-mode-tick-core.md` ⇒ **1**（A9 无 finishedAt 新鲜度限定，同 A-5）
- 备注：FAMILY-5 扫描面已由 AC59 覆盖三层核；新鲜度限定属行为变更，归 inner/outer 后续裁决

### B-4 — inner loop 文档 39 处 integration（未逐条分类）
- 处置：已逐条分类（本任务落地，AC61 判据2）
- 核实读数：`grep -c "integration" plugin/loop/fast-mode-loop-tick.md` ⇒ **35**（原 39，AC58 已迁出 4 处）；全部 35 处见下节逐条表；docs/analysis 实例副本另 22 处亦已逐条分类

## integration 命中逐条分类

> 判据2：逐条打印并分类（活指令 / 退役注记 / 历史记述），不得只给计数。分类表锚=命中行逐字前 70 字符。
> 下表覆盖 4 份 loop 文档：inner/outer 模板（plugin/loop/，checker 强制）+ inner/outer 实例副本（docs/analysis/、orchestration/，补充/outer 建议）。
> 摘要：inner 模板 35 处 = 活指令（有效）2 / 活指令→退役物 10 / 退役注记 7 / 历史（含过时）16；outer 模板 12 处 = 活指令→退役物 8 / 历史（含过时）4。

### inner-template：`plugin/loop/fast-mode-loop-tick.md`（35 处, checker 强制）

| 分类 | 命中行（锚=逐字前 70 字符） | 说明 |
|---|---|---|
| 历史记述（过时） | `> quay 自身在 .quay/config.yml 覆盖成 fork_baseline: develop / merge_target:` | 描述 quay 旧两线配置 fork_baseline: develop / merge_target: integration；AC50 已切单线 |
| 活指令→退役物 | `开始晚于最近一次 integration fan-in；机械判定 = integration-batch-merge.sh 自带的 fres` | 机械判定引用已 RETIRED 的 integration-batch-merge.sh 自带 freshness gate |
| 活指令（有效） | `session-liveness-signals-kinds.test.mjs / session-liveness-signals-thr` | 测试文件名 session-liveness-signals-integration.test.mjs，仍存在 |
| 活指令（有效） | `全绿（fail 0 / cancelled 0，$TEST_COMMAND plugin/test/session-liveness-eve` | $TEST_COMMAND 测试清单含同一测试文件 |
| 历史记述 | `### 分支模型（两线：develop + integration，gap-branch-model-integration-branch-` | 两线分支模型节标题（gap-branch-model-…） |
| 历史记述 | `**结构根因**（orchestration/SPEC-branching-model-integration-branch-2026-08` | 结构根因：master 曾同时是分叉基线与汇入点（SPEC-branching-model…） |
| 历史记述 | `| **develop** | **已验证基线**（绿） | **所有任务从它分叉**（新模型一律 develop，gap-worktree` | 两线模型表（develop 行：已验证基线，integration→develop 批量合） |
| 历史记述 | `| **integration** | **待验证汇入点** | **不再有任务从它分叉**（依赖由派发闸 A15② 串行化）；**所有任务` | 两线模型表（integration 行：待验证汇入点、所有任务合回它——过渡期） |
| 退役注记 | `漂移由 A6 rebase-重跑循环吸收。旧 integration fork 判据退役说明 → orchestration/archive` | 旧 integration fork 判据退役说明 → AC58#R10；机械判定现恒 $FORK_BASELINE |
| 历史记述（过时） | `- **合并机制（AC3）**：任务合回 integration（步骤 2，git merge --no-ff task/<id>）；外层` | 合并机制：任务合回 integration——AC48 后任务合 develop |
| 历史记述 | `- **命名 = integration（AC6）**：gate（与 quay gate 概念打架）/ staging（暗示部署）/ nex` | 命名 = integration 的理由（gate/staging/next 均被否） |
| 历史记述 | `相对基线判据——develop 相对 integration 滞后不再触发断言噪声。` | 相对基线判据：develop 相对 integration 滞后不再触发断言噪声 |
| 历史记述 | `**两线分支模型（quay 自身配置启用；gap-branch-model-integration-branch-splits-fork-b` | 两线分支模型节（quay 自身配置启用；AC1/AC2/AC3） |
| 历史记述（过时） | `当 workspace 把 fork_baseline / merge_target 配置为 develop / integration（q` | workspace 配置 fork_baseline/merge_target 为 develop/integration |
| 历史记述（过时） | `| $MERGE_TARGET（quay: integration） | 待验证汇入点（含未验证前序工作） | **不再有任务从它分叉**（` | $MERGE_TARGET（quay: integration）表行 |
| 历史记述 | `- **分叉基线（新模型，gap-worktree-fork-baseline-always-integration）**：**所有任务一律` | 分叉基线新模型（任务名 gap-worktree-fork-baseline-always-integration） |
| 退役注记 | `后再派），任务文件漂移由 A6 rebase-重跑循环吸收。旧 fork 判据与 --force-integration 退役说明 → or` | 旧 fork 判据与 --force-integration 退役说明 → AC58#R12 |
| 活指令→退役物 | `plugin/scripts/integration-batch-merge.sh --develop "$FORK_BASELINE" -` | live 命令 plugin/scripts/integration-batch-merge.sh --develop … --sync --reconcile |
| 活指令→退役物 | `- **integration-batch-merge.sh --reconcile（主检出对账步骤由脚本提供，gap-batch-merg` | integration-batch-merge.sh --reconcile（主检出对账步骤由脚本提供） |
| 活指令→退役物 | `HEAD/index 变陈旧。**对账步骤由 integration-batch-merge.sh --reconcile 自己提供，调用方` | 对账步骤由 integration-batch-merge.sh --reconcile 自己提供（安全规则保留） |
| 活指令→退役物 | `- **对象闸门（integration-batch-merge.sh 自带，gap-batch-merge-gate-validates-` | 对象闸门 integration-batch-merge.sh 自带 |
| 活指令→退役物 | `- **新鲜度闸门（integration-batch-merge.sh 自带，gap-batch-merge-gate-reads-sta` | 新鲜度闸门 integration-batch-merge.sh 自带 |
| 活指令→退役物 | `开始晚于最近一次 integration fan-in。机械判定在脚本里（默认开启，非自判）；缺 state / 非 green / 旧绿` | integration fan-in 新鲜度机械判定在（退役）脚本里 |
| 历史/退役注记 | `分叉、合回 master」——fork-baseline.ts --develop master --integration master ` | fork-baseline.ts --develop master --integration master 恒返回 master（单线下游） |
| 历史/退役注记 | `（master..master 空，无未验证任务），integration-batch-merge.sh 为无操作——与未做 branch ` | integration-batch-merge.sh 为无操作（单线退化） |
| 活指令→退役物 | `（默认阈值 --landing-behind-threshold 可调）**且**合并目标 integration 冻结超窗（默认 2h，` | 合并目标 integration 冻结超窗（默认 2h）——两线模型残留活判据 |
| 活指令→退役物 | `闸门**（AC4：落地正常 = integration 在推进 ⇒ 不误报；landing_blocked 不打断派发——本步骤补晋与` | 落地正常 = integration 在推进 ⇒ 不误报（两线残留） |
| 历史/退役注记 | `develop/integration ref（单线下游）⇒ fail-safe 不报。` | develop/integration ref（单线下游）⇒ fail-safe 不报 |
| 历史记述 | `4. **分叉基线（新模型，gap-worktree-fork-baseline-always-integration）**：任务 work` | 分叉基线新模型步骤 4（任务名引用） |
| 退役注记 | `--force-integration 退役说明 → orchestration/archive/AC58-retired-clauses.` | --force-integration 退役说明 → AC58#R13 |
| 历史/退役注记 | `rebase 吸收，不再靠「fork 自 integration」绕开。依赖声明语义（fork_baseline_is_dependency` | 不再靠 fork 自 integration 绕开；fork_baseline_is_dependency 语义保留 |
| 历史记述 | `**分叉基线（新模型 = $FORK_BASELINE（develop HEAD），gap-worktree-fork-baseline-a` | 分叉基线新模型 = $FORK_BASELINE（develop HEAD） |
| 退役注记 | `--force-integration 退役说明 → orchestration/archive/AC58-retired-clauses.` | --force-integration 退役说明 → AC58#R14 |
| 退役注记 | `- **每个任务 worktree 都从 $FORK_BASELINE（develop HEAD）分叉**——--force-integra` | --force-integration 退役说明 → AC58#R15 |
| 历史记述 | `**任务代理完成时编辑自己的任务文件（AC2 派发词约定，gap-closure-could-not-run-in-task-grant-s` | 任务名 gap-task-file-develop-integration-drift-fan-in-conflicts（AC3 写所有权分离） |

### inner-instance：`docs/analysis/fast-mode-loop-tick.md`（22 处, 补充）

| 分类 | 命中行（锚=逐字前 70 字符） | 说明 |
|---|---|---|
| 活指令（有效） | `session-liveness-signals-kinds.test.mjs / session-liveness-signals-thr` | 测试文件名 session-liveness-signals-integration.test.mjs |
| 活指令（有效） | `全绿（fail 0 / cancelled 0，$TEST_COMMAND plugin/test/session-liveness-eve` | $TEST_COMMAND 测试清单含同一测试文件 |
| 历史记述 | `**两线分支模型（gap-branch-model-integration-branch-splits-fork-baseline-from` | 两线分支模型节标题 |
| 历史记述 | `| integration | 待验证汇入点（含未验证前序工作） | 声明依赖前序的任务 | 所有任务合并目标 |` | 两线模型表（integration 行：待验证汇入点、所有任务合并目标） |
| 历史记述（过时） | `- **分叉基线即依赖声明**（AC2）：独立任务从 develop 分叉；声明依赖的从 integration 分叉——` | 分叉基线即依赖声明：声明依赖的从 integration 分叉——AC48 后恒 develop |
| 历史记述（过时） | `机械判定 plugin/scripts/fork-baseline.ts（touches 与 integration 上未验证任务相交 ⇒ ` | fork-baseline.ts 机械判定 touches 与 integration 相交 ⇒ integration |
| 历史记述（过时） | `- **合并机制**（AC3）：任务合回 integration（红窗期照常接收——结构性消除停派）；外层` | 合并机制：任务合回 integration |
| 历史记述（过时） | `verification-round-N 批量合 integration→develop（fast-forward 无冲突，plugin/s` | verification-round-N 批量合 integration→develop（integration-batch-merge.sh） |
| 历史记述（过时） | `- 依赖约束：**fan-in 合到 integration，不合并到 develop**；develop 只由外层批量合推进。` | 依赖约束：fan-in 合到 integration，不合并到 develop |
| 历史记述（过时） | `0. **先 rebase 到当前 integration**（汇入点，含并发任务合并）：` | 先 rebase 到当前 integration |
| 历史记述（过时） | `git -C $WORKTREE_ROOT/<slug> rebase integration` | git -C worktree rebase integration |
| 历史记述（过时） | `worktree 建立时对分叉基线（develop 或 integration）取了快照，之后并发合并的其它任务它看不到。` | worktree 分叉基线快照（develop 或 integration） |
| 历史记述（过时） | `1. git merge --no-ff task/<taskId>（合并目标 = 当前检出的 integration——两线模型下内层共享` | git merge --no-ff task/<taskId>（合并目标 = 当前检出的 integration） |
| 历史记述（过时） | `立在 integration 上，不是 master；develop 只由外层批量合推进）` | 共享检出立在 integration 上，不是 master |
| 历史记述（过时） | `经认领协议认领过（QUAY_CLAIM_REMOTE 设置了共享裸仓库），合并进 integration 后**释放认领**：` | 认领协议：合并进 integration 后释放认领 |
| 历史记述（过时） | `merge + delete = release）。释放只删共享仓库上的 task/<id> 认领标记，不碰已合并进 integration` | 不碰已合并进 integration 的认领标记 |
| 历史记述（过时） | `integration→develop 的批量合**（两线模型 AC3：develop 是已验证基线，绝不被未验证树推进——` | integration→develop 批量合（两线模型 AC3） |
| 历史记述（过时） | `这是结构性消除红窗停派的关键；任务合 integration **不受**红窗阻挡，红窗只挡 develop 的推进，` | 任务合 integration 不受红窗阻挡 |
| 历史记述 | `4. **分叉基线判定（两线模型 AC2，gap-branch-model-integration-branch-splits-fork-b` | 分叉基线判定（两线模型 AC2） |
| 历史记述（过时） | `声明依赖 → integration，机械可查）：` | 声明依赖 → integration，机械可查 |
| 历史记述（过时） | `# stdout: develop（独立，从已验证基线分叉）或 integration（依赖未验证前序，从待验证汇入点分叉）` | # stdout: integration（依赖未验证前序，从待验证汇入点分叉） |
| 历史记述（过时） | `task/* 分支判触摸相交——**与单机串行是同一个约束，只是提前到认领时**。任务合并进 integration` | 任务合并进 integration |

### outer-template：`plugin/loop/orchestrator-loop-tick.md`（12 处, checker 强制）

| 分类 | 命中行（锚=逐字前 70 字符） | 说明 |
|---|---|---|
| 历史记述（过时） | `> 项目的具体分支取值**——quay 自身网络的两线取值（develop / integration）是本层实例状态，见 quay 仓库` | quay 自身网络两线取值（develop / integration）是本层实例状态 |
| 历史记述（过时） | `> 状态**（工作分支两线、integration 作 checkout、项目列表、tmux 布局、以及每一条判据的实测与代价）在` | 工作分支两线、integration 作 checkout（本层实例状态描述） |
| 历史记述（过时） | `> **本层实例状态**（工作分支两线、integration 作 checkout、项目列表、tmux 布局、本实验各 AC 的` | 工作分支两线、integration 作 checkout（本层实例状态） |
| 活指令→退役物 | `（默认 3600s）且 suite 开始晚于最近一次 $MERGE_TARGET fan-in。机械判定 = integration-bat` | 机械判定 = integration-batch-merge.sh 自带的 freshness gate（退役脚本） |
| 活指令→退役物 | `**suiteGreen 为 true 时**，跑 plugin/scripts/integration-batch-merge.sh --` | suiteGreen 时跑 integration-batch-merge.sh … --sync --reconcile（退役脚本） |
| 活指令→退役物 | `单线下两者同为 master ⇒ 无操作）。integration-batch-merge.sh 自带：` | integration-batch-merge.sh 自带（单线无操作退化） |
| 活指令→退役物 | `- **对象闸门（integration-batch-merge.sh 自带，gap-batch-merge-gate-validates-` | 对象闸门 integration-batch-merge.sh 自带 |
| 活指令→退役物 | `- **新鲜度闸门（integration-batch-merge.sh 自带，gap-batch-merge-gate-reads-sta` | 新鲜度闸门 integration-batch-merge.sh 自带 |
| 活指令→退役物 | `最近一次 integration fan-in 的 commit time——fan-in 在 suite 之后落地说明绿没测过当前待合 t` | 最近一次 integration fan-in 的 commit time |
| 活指令→退役物 | `- **integration-batch-merge.sh --reconcile（主检出对账步骤由脚本提供，gap-batch-merg` | integration-batch-merge.sh --reconcile（主检出对账步骤由脚本提供） |
| 历史记述 | `3.5 **批量合回 $FORK_BASELINE（两线模型的合并机制，gap-branch-model-integration-branc` | 批量合回 $FORK_BASELINE（两线模型的合并机制，AC3） |
| 历史记述（过时） | `见 .quay/config.yml loop: 节，quay 实例 = fork_baseline: develop / merge_ta` | quay 实例 = fork_baseline: develop / merge_target: integration |

### outer-instance：`orchestration/orchestrator-loop-tick.md`（21 处, outer 独占·建议）

| 分类 | 命中行（锚=逐字前 70 字符） | 说明 |
|---|---|---|
| 历史记述（过时） | `> FORK_BASELINE = develop（已验证基线）、MERGE_TARGET = integration（待验证汇入点）——见` | MERGE_TARGET = integration（待验证汇入点）——AC50 后 merge_target=develop |
| 历史记述（过时） | `> integration 作 checkout、项目列表、tmux 布局、以及每一条判据在本仓的实测与代价）；**产品行为正本**在` | integration 作 checkout（本层实例状态描述） |
| 历史记述（过时） | `> **⚠️ 2026-08-09 结构性修正（外层的 WORKING CHECKOUT 切到 integration）**：此前的故障链是` | 2026-08-09 结构性修正：外层 WORKING CHECKOUT 切到 integration |
| 历史记述（过时） | `> 提交落 develop ⇒ 不变式被破（develop-only 累积）⇒ ff 前需并回 integration ⇒ 验证期 tip ` | ff 前需并回 integration |
| 历史记述（过时） | `> 绿过期」——冻结窗口只是手段不是机制。长效解法：**外层工作 checkout = integration**，develop 只经 f` | 外层工作 checkout = integration |
| 历史记述（过时） | `> （batch-merge）前进。git checkout integration（如需临时 worktree 已占用 integrati` | git checkout integration |
| 历史记述（过时） | `> remove 它）。此后外层的一切提交（立项/记账/红窗修复）都落 integration；develop 保持 ff-only、无` | 一切提交落 integration；develop 保持 ff-only |
| 历史记述（过时） | `> develop-only 提交、不变式（is-ancestor develop integration）持久成立；验证跑在 integr` | 不变式 is-ancestor develop integration |
| 历史记述（过时） | `> integration），只是「当前 checkout 是哪个」变了。` | 验证跑在 integration |
| 退役注记 | `| 工作分支（**单线**，integration 退役说明 → orchestration/archive/AC58-retired-cl` | 工作分支单线，integration 退役说明 → AC58#R04 |
| 退役注记 | `| 外层工作 checkout | **develop**（AC50 已切；integration 退役说明 → orchestration` | 外层工作 checkout develop（AC50 已切；integration 退役说明 → AC58#R04） |
| 活指令→退役物 | `laneCount}）并把套件输出 tee 到 .quay/full-suite.log。当 --root 是被测 worktree / i` | 全量 suite 日志 tee 到被测 worktree / integration checkout |
| 历史记述（过时） | `3b. **批量合 integration→develop（两线模型 AC3，gap-branch-model-integration-br` | 3b 批量合 integration→develop（两线模型 AC3） |
| 活指令→退役物 | `**suiteGreen 为 true 时**，跑 plugin/scripts/integration-batch-merge.sh --` | suiteGreen 时跑 integration-batch-merge.sh（退役脚本） |
| 历史记述（过时） | `已验证的 integration 批量快进合回 develop——**integration 永远是 develop 后代 ⇒ fast-f` | integration 永远是 develop 后代 ⇒ fast-forward |
| 历史记述（过时） | `（develop 只被外层批量合推进，inner 任务只合 integration，见 fast-mode-loop-tick.md 步骤 ` | inner 任务只合 integration |
| 活指令→退役物 | `分支模型」）。integration-batch-merge.sh 自带：` | integration-batch-merge.sh 自带 |
| 活指令→退役物 | `- **pre-check**：git merge-base --is-ancestor develop integration 非 0（真` | pre-check git merge-base --is-ancestor develop integration |
| 活指令→退役物 | `- **measure**：git merge-base --is-ancestor integration develop 退出码（ban` | measure git merge-base --is-ancestor integration develop |
| 活指令→退役物 | `- **invoke**：git log --oneline develop..integration（红窗期不空——integration` | invoke git log --oneline develop..integration |
| 活指令→退役物 | `suiteGreen 为 false（red/aborted/缺 state）⇒ **不跑批量合**——红窗期 integration 照常` | 红窗期 integration 照常接收任务合并 |


## C17 —— outer 独占文件的改动建议（本任务不直接改，outer 落盘）

> 依 C17 ①：`orchestration/orchestrator-*.md` 与 `plugin/loop/orchestrator-loop-tick.md` 归 outer 独占。以下为 A-1…A-7 与 outer loop 文档的改动建议，outer 按 AC61 判据1/判据2 落盘并贴验证输出（AC65 判据2）。

1. **A-1**（orchestrator-tick-core.md :4/:17）：删「工作分支两线、integration 作 checkout」，改「单线 develop」。
2. **A-2**（:65 B16）：integration 冲突源前提已死——标「前提已死」并保留 A/B/C 三层归因。
3. **A-3**（:54 B5）：verification-round.jsonl 来源已冻结——标「来源已冻结、不计入覆盖率分母」。
4. **A-4**（:32 A9）：not-yet-flipped 输入已死（(a2)+fan-in 同时翻 done）——标「输入已死」。
5. **A-5**（:34 A11/:52 B3）：full-suite-state.json 加新鲜度限定（finishedAt 距今 < tick 周期才算实时）。
6. **A-6**（:100）：红窗分诊「回退对应翻 done」归属改 inner，或明写「回退由发起方执行」。
7. **A-7**（:53 B4）：已迁出（AC58 R01），无动作。
8. **outer loop 文档**（plugin/loop/orchestrator-loop-tick.md 12 处 + orchestration/orchestrator-loop-tick.md 21 处）：逐条分类见上节两表；其中「活指令→退役物」处（模板 8 处 / 实例 9 处）引用已 RETIRED 的 integration-batch-merge.sh 作活判据，建议按 AC58 迁出（删正文 + archive 落点）或改指 `fast-mode-telemetry.ts --reconcile` / `$FORK_BASELINE` 单线判据。
9. **内层 C7/C10 已由本任务直接落地**（fast-mode-tick-core 双副本 + R25/R26），outer 无需处理。

## Evidence

- `retired-clause-check: OK — 26 entries migrated (38 unique tokens: all gone from source, all present in archive)`（含新增 R25/R26）
- 处置读数：A-1=3 / A-2=1 / A-3=1 / A-4=4 / A-5=2 / A-6=1 / B-3=1（grep -c 实测，见上节）
- C7/C10 双副本修复：`orchestration/fast-mode-tick-core.md:66/69` + `plugin/loop/fast-mode-tick-core.md:79/82` 现为指针/改指，marker 归零（grep -c = 0）
- integration 逐条分类：inner 模板 35 + inner 实例 22 + outer 模板 12 + outer 实例 21 = 90 处（上节逐条表）
- 检查器负控制：`ac61-staleness-disposition-check` —— 删任一条处置记录 ⇒ exit 1（mutation case + 单测）
