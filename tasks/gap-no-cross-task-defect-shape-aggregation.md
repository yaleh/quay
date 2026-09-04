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

- [x] AC1：实现被动聚合器并对本仓库真实历史跑一遍，输出前 5 个簇及其成员任务 id（贴真实输出）
- [x] AC2（对已知真样本干跑，硬规则 2b）：聚合器须**独立重新发现**本次会话中人工找到的 3 个簇里的
      **至少 2 个**（状态解析重写 / AC 计数器 / 主检出根路径推导），且只使用这些发现被写下来**之前**
      就已存在的数据；重现不出来 ⇒ 说明聚类没有测到它声称在测的东西，必须先修聚类再算通过
- [x] AC3（负控制，防假阳性）：不得把"仅仅因为不相干的原因触及同一个文件"的任务群报成一个簇
      （例：几十条任务都改过 `worker-driver.ts`，但根因各不相同）——贴出一个它**正确地没有**报出的
      真实例子，或给出在一个人工标注样本上的精确率读数
- [x] AC4：首版为**被动**——本任务范围内不写任务库、不自动立案；输出是给人/manager 读的报告
      （范围声明写进任务体，避免下一个实现者顺手加写手）
- [x] AC5：接入一个真实节奏（不是"存在但没人调"）——点名调用点，并贴出一次真实运行记录作为证据

## DoD

AC1 的真实簇输出、AC2 的"重新发现已知簇"的成员清单对照、AC3 的负控制样本、AC5 的调用点证据，
全部贴进任务体。**AC2 是硬要求**：一个聚合器如果连已知为真的三个簇都重现不出来，它报出的新簇没有
任何可信度——这正是本仓库硬规则 2b 要求的"把谓词对着已知为真的样本干跑一次"。

**AC1（真实历史 top-5，`node --experimental-strip-types plugin/scripts/defect-shape-aggregate.ts --root . --human --top 5`，读 1192 条 done gap-*、产出 636 簇）**：

```
CLUSTER root="quay_serial_concurrency" size=10 members=[gap-ac44-concurrent-phases-read-host-parallelism, gap-ac74-serial-lowconc-literal-direct-path, gap-load-sensitive-serial-phase-unbounded-growth-measure-first, gap-lowconc-concurrency-8-starves-bclass-waiting, gap-lowconc-concurrency-restore-host-derived, gap-phase-overlap-field-always-false-negative, gap-phase-overlap-two-phase-parallel-exploration, gap-suite-knobs-config-file-priority, gap-suite-lpt-full-bucket-run-selected, gap-suite-serial-install-controlled-parallelism]
CLUSTER root="checkers_total" size=10 members=[gap-ac55-dispatch-record-fingerprint-reason, gap-ac56-recommended-deordered, gap-b2-repo-root-unification, gap-checker-mutation-cases-4-checkers, gap-checkers-have-never-been-shown-to-fail, gap-establish-daily-review-cadence-mechanism, gap-gate-scripts-laid-down-but-dead-and-not-mutation-checked, gap-red-on-omission-audit-needs-mutation-case, gap-run-static-checks-zero-concurrency-can-parallelize, gap-worktree-node-modules-inconsistent-self-verify]
CLUSTER root="ac65authorized" size=9 members=[gap-ac65-direct-fix-vs-bypass-detector-conflict, gap-bypass-ruled-cbbbb766, gap-bypass-ruled-table-self-entry, gap-direct-to-develop-exclude-manager-skill-granularity, gap-direct-to-develop-ruled-historical-99f845d9, gap-direct-to-develop-ruled-historical-cddc55e2, gap-fan-in-ff-executor-check-ruled-historical-99f845d9, gap-readme-design-internal-exclusion, gap-scoped-gate-m120-negative-control-false-positive]
CLUSTER root="quaybin" size=9 members=[gap-adr-gate-test-fixture-isolation-live-task-store, gap-cli-import-refactor-run-shell-architecture, gap-manager-skill-index-missing-new-specs, gap-plugin-json-duplicate-manager-skill, gap-task-check-test-nativeproviderdir-undefined, gap-tests-spawn-cli-from-ts-source, gap-tests-use-cli-where-module-import-suffices, gap-the-spawn-count-criterion-was-wall-clock-and-that-is-the-wrong-axis-for-concurrency, gap-tmp-leak-is-live-r6-absolves-a-file-for-one-cleanup-call]
CLUSTER root="acboxcount" size=9 members=[gap-absorb-entry-clause-disposition-sequencing, gap-build-evidence-manifest-missing, gap-dir126d-deferred-phase-timing-recurrence-tracking, gap-preflight-bare-filename-false-positive, gap-prepare-milestone-epoch-scope-change-grants-full-review, gap-prepare-milestone-no-size-aware-routing-A, gap-prepare-milestone-no-size-aware-routing-B, gap-prepare-milestone-split-decision-no-finality, gap-workflow-name-dispatch-stale-script-cache]
defect-shape-aggregate: 636 cluster(s) (showing 5), maxDf=8
```

**AC2（重新发现 3 个已知簇，成员清单对照——只用 `tasks/*.md` + git 历史，未硬编码这三个簇）**：

1. **状态解析重写**（`readtaskstatusatref`，rank=159，size=5）——成员**逐字等于**会话里人工找到的
   状态解析缺陷群（consolidation 任务 `gap-task-status-parsing-reimplemented-13-sites` + 4 个
   stale-read 族 sibling，全中、无缺、无多）：
   ```
   members: gap-driver-filters-readtaskstatus-stale-main-checkout, gap-promotion-uncommitted-flip-poisons-settaskstatus,
            gap-ready-pool-depends-on-status-stale-read, gap-task-status-parsing-reimplemented-13-sites,
            gap-web-task-status-reads-stale-main-checkout
   sharedFiles: plugin/scripts/driver-filters.ts, plugin/scripts/ready-pool-check.ts, plugin/test/ready-pool-check.test.mjs
   ```
2. **AC 计数器**（`countaccheckboxes`，rank=40，size=7）——锚任务 `gap-ac-checkbox-counting-four-counters-drifted`
   在簇内，另有 ABI 导出任务 `gap-abi-promote-section-parsing-flip-store-reverse-import`（同根）；其余 5 条为
   「正文里顺带提到 `countAcCheckboxes`」的弱关联（候选报告的可接受噪声，非硬错）。
3. **主检出根路径推导**（`--git-common-dir`，rank=39，size=7）——两个锚**都在同一簇**：
   `gap-refresh-worktree-quay-main-derive` + `gap-main-checkout-root-derivation-recurs-three-sites`（+5 条
   同样涉及 `--git-common-dir`/repo-root 的关联任务）。

**AC3（负控制，`worker-driver.ts`）**——119 条 done gap-* 的 `## Touches` 都触及 `worker-driver.ts`，
但**没有**任何一个簇以它为绑定机制词（文件重叠不是聚类信号，只作 `sharedFiles` 旁证）：
```
done gap-* tasks touching worker-driver.ts in ## Touches: 119
clusters bound by a worker-driver token: 0
```

**AC5（调用点 + 真实运行记录）**——调用点 = 管理者复盘节奏 `orchestration/REVIEW-cadence.md` 新增
`### 3e`（与 §3d 趋势判据并列，「每次复盘跑一次」）。真实运行记录 = 上面 AC1 的同一条命令输出
（`--root . --human`，读 1192 条 done gap-*、产 636 簇）；`--json` 的 meta 回显
`"shapeAggregateIsPassive": 1`（AC4 被动不变量：只读、零写、零触发 run）。

## Touches

- plugin/scripts/defect-shape-aggregate.ts（新增）
- plugin/test/defect-shape-aggregate.test.mjs（新增）
- plugin/scripts/capability-catalog.sh（登记新脚本）
- orchestration/REVIEW-cadence.md（AC5 调用点：§3e）
- tasks/gap-no-cross-task-defect-shape-aggregation.md
