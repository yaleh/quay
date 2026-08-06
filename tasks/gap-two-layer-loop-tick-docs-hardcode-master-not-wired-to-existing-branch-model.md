---
id: gap-two-layer-loop-tick-docs-hardcode-master-not-wired-to-existing-branch-model
title: "two-layer loop tick docs hardcode `master` as the working branch (11 refs:
  plugin/loop/fast-mode-loop-tick.md ×7, plugin/loop/orchestrator-loop-tick.md ×2,
  orchestration/orchestrator-loop-tick.md ×2) even though the fork/integration
  branch model (gap-branch-model-integration-branch-splits-fork-baseline-from-
  merge-point) has been DONE and CODED for hours — it was never wired into the
  actual tick-driven loop, so every real dispatch still forks/lands on master;
  human directive 2026-08-06 (PLAN-develop-branch-cutover): develop/integration
  are now the sole working branches, master is frozen (human-triggered-only sync)"
status: todo
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

管理者按人 2026-08-06 直接指令（`orchestration/PLAN-develop-branch-cutover-2026-08-06.md`）立案。
人的原话："高优先级落地 branch 策略。develop 和 integration 两个分支都用于持续开发；master
branch 应仅在我要求时才从 develop 同步。" 已确认执行（"按 orchestration/PLAN-develop-branch-
cutover-2026-08-06.md 方案开始执行。持续推进，直至完成。"）。

**核心发现（管理者已实测，不是推测）**：`gap-branch-model-integration-branch-splits-fork-
baseline-from-merge-point`（fork develop→integration，outer 验证后 integration→develop
fast-forward）**已经 `done`**——机制本身早就写好了。但**两层循环真正跑起来读的 tick 文档
从来没有切换到这个机制上**：

```
plugin/loop/fast-mode-loop-tick.md          7 处硬编码 master
plugin/loop/orchestrator-loop-tick.md       2 处硬编码 master
orchestration/orchestrator-loop-tick.md     2 处硬编码 master（workspace 本地副本——
                                             与 plugin/loop/ 下同名文件的关系本身需要
                                             本任务顺带核实，是否又是一个"两处同源内容"漂移实例）
```

结果：机制设计完成 ≠ 机制被使用。每一次真实 dispatch（Build fork、Land 合并）至今仍然
直接对 `master` 操作。这正是本仓反复出现的那类缺陷（"写在文件里但不在决策时被调用"）
的又一实例——只是这次不是文档没被读，而是**新机制没有替换旧机制的唯一调用点**。

**阶段一已完成（管理者，2026-08-06，A 机）**：GitHub `origin` 上已新建 `develop`/`integration`
分支（均指向 A 机当前 `master` 的最新提交 `926d771b`），`origin/master` 本身**未动**
（仍在旧点，等待人明确要求时才同步）。本任务是**阶段三**：把 tick 文档的调用点切过去。

## Contract

**判据 vs 现实修正（管理者，2026-08-06 第二轮 tick，使用视角提问自查发现，非推测）**：
外层已裁定采纳 AC6——共享文件（`plugin/loop/` 下两个）保留 `master` 作为**可配置默认值**，
不是全部清零。原来写的 `band master_refs = 0` 对整个三文件求和，**会在 AC6 正确实现之后
仍然非 0**（因为默认值字符串 `master` 依然会以字面量出现在共享文件里，例如
`branch: master` 这样的默认配置行）——**这个判据在 AC6 之后会拒绝一个正确的实现**，
是本任务自己开工前就自查到的一个「判据 vs 现实」缺口，现修正为分两条度量：

```
measure master_refs_local = `grep -c "master" orchestration/orchestrator-loop-tick.md`
band master_refs_local = 0
  （本仓非共享副本，AC6 不适用——必须完全切到字面量 develop，允许 0 容忍）

measure master_hardcoded_ops_shared = 共享两文件（plugin/loop/fast-mode-loop-tick.md、
  plugin/loop/orchestrator-loop-tick.md）里，**把 master 硬编码进具体分支操作指令**
  （如 `git checkout master`/`git merge ... master`/`fork from master` 这类操作性语句，
  而不是"默认值＝master"这类配置说明性语句）的行数——精确 grep 模式留给执行时定
  （区分"操作性硬编码"与"默认值声明"需要看上下文，不是纯字符串匹配能可靠做到的）
band master_hardcoded_ops_shared = 0
  （容许 master 作为默认值的字面量出现，不容许它被直接硬编码进操作指令）

invariant 两层循环的 Build（fork）/Land（合并收口）阶段不对 `master` 分支做任何写操作
  （除非工作分支配置显式指向它，即未做 cutover 的下游项目的默认行为）；
  quay 自己的工作分支为 develop（Build fork 起点）→ task/<id>（Build）→ integration
  （Land 收口）→ develop（outer 批量 fast-forward，按已有
  SPEC-branching-model-integration-branch-2026-08-05.md 设计）
invoke `grep -n "master" orchestration/orchestrator-loop-tick.md`（本仓副本）；
  共享文件的 invoke 命令由执行时按上面的"操作性 vs 声明性"区分标准编写
control 往 `orchestration/orchestrator-loop-tick.md` 手工加回一行含字面量 `master` 的分支
  操作指令 ⇒ `master_refs_local` 必须非 0；往共享文件加一行硬编码 `git checkout master`
  的操作指令（不是默认值声明）⇒ `master_hardcoded_ops_shared` 必须非 0
resume 若切换中断，先跑两条 measure 核对当前残留处数，再继续未完成的文件；不要从头假设
```

## Chosen mechanism

**繁殖视角修正（管理者，2026-08-06，tick 强制使用视角提问实测发现，非推测）**：
`plugin/loop/fast-mode-loop-tick.md`/`plugin/loop/orchestrator-loop-tick.md` 是**下游项目消费的
共享 shipped 文件**（CLAUDE.md 已明确的既有原则："MECHANISM…是 shared quay infrastructure
downstream projects adopt via the upgrade channel"）。**实测**：`archguard`（同一台机器，
`/home/yale/work/archguard`）**只有 `master` 一个分支**（`git branch --list develop integration
master` 只命中 `master`）——它没有做过、大概率也不会做这次 branch cutover。**若直接把这两个
共享文件里的字面量 `master` 替换成字面量 `develop`/`integration`，archguard 下次从升级通道拉取
这两个文件时会指向它根本没有的分支，直接断链**——与"dist 不随 clone → package.json ENOENT →
mcp_entry 路径形态错"同一形态的遗传丢失，只是这次丢的是"工作分支名"这段遗传物质。

**因此硬约束新增一条**：工作分支名是**策略**（各项目自身的 branch 模型现状），不是**机制**
（CLAUDE.md 归属边界原则："策略＝各项目按自身负载特征定，不要让下游各自发明机制"）——
`plugin/loop/` 下的两个共享文件里，工作分支名**必须可配置**（例如从 `.quay/config.yml` 的
`loop:` 段读一个新字段，默认值仍是 `master`，保证未做 cutover 的下游项目行为不变），
**quay 自己的 workspace 在 `.quay/config.yml` 里覆盖成 `develop`/`integration`**——不能是
两个共享文件里的字面量硬替换。`orchestration/orchestrator-loop-tick.md`（本仓库自己的工作区
副本，非共享文件）不受此约束，可以直接改字面量。

以下两条仍是硬约束：

- `master` 分支在切换后**只能被一种情况写入**：人用自然语言明确要求同步时，由 outer 执行
  `develop → master`（人已裁定触发形式：纯文本，不定具体格式，频率很低——不需要固定命令）。
  建议 outer 收到这类请求后先复述一遍将要执行的操作，等人确认，而不是静默执行——但这是建议，
  执行时的具体确认机制由 inner/outer 自己设计，只要满足"master 不会被 tick 自动触碰"这条 invariant。
- 不要求这次切换处理 A/B 两机历史分叉的合并本身（那是 B 机自己在并行做的事，
  `orchestration/PLAN-develop-branch-cutover-2026-08-06.md` 阶段二，另一条独立的工作）——
  本任务只管"两层循环下一次 dispatch 该对哪个分支操作"。

## Acceptance Criteria

- [ ] AC1: `master_refs_local` 从当前值降到 0（`orchestration/orchestrator-loop-tick.md`，
      实跑贴出改前/改后两次输出）；`master_hardcoded_ops_shared`（两个共享文件）同样降到 0
      （允许 `master` 作为默认值字面量保留，只消灭"硬编码进操作指令"的用法）
- [ ] AC2: 至少完整跑通一次真实的 task 生命周期（Build fork from develop → Land 合并到
      integration → outer fast-forward integration→develop），贴出实测的 `git log --oneline`
      片段证明分支确实按新模型走，而不是仅文档改了字但机制没被触发
- [ ] AC3: 负控制——往某 tick 文档注入一行 `git checkout master`（或等价字面量）的**操作性**
      指令，两条 measure 中对应的一条必须翻回非 0（证明探测器真的在测这件事，不是巧合归零）
- [ ] AC4: `master` 分支的写保护——记录任务体一条机械或流程证据，证明"tick 触发的常规 dispatch
      不会写 master"（例如：grep 两层循环全部脚本对 `git push.*master`/`git merge.*master` 之类
      操作的直接调用点，确认唯一调用点在"人明确要求同步"路径上）
- [ ] AC5: 任务体记录 `plugin/loop/orchestrator-loop-tick.md` 与
      `orchestration/orchestrator-loop-tick.md` 的关系核实结果（是否为漂移的两份同源内容——
      若是，按仓库"单一事实源"原则一并修，若不是同源，写明两者各自的角色分工）
- [ ] AC6（繁殖视角，人裁定权在 outer——本条是管理者的意见，非强制推翻其实现选择）：
      `plugin/loop/` 下两个共享文件里的工作分支名可配置，默认值仍是 `master`；**实测**
      archguard（`/home/yale/work/archguard`，只有 `master` 一个分支）在不改任何自身配置的
      前提下，从升级通道拉到本任务改后的共享文件，行为必须与改前**完全一致**（负控制：
      在 archguard 工作区跑一次 `plugin/loop/fast-mode-loop-tick.md` 的 tick，产出的分支操作
      仍然是 `master`，不是 `develop`）

## Definition of Done

- [ ] AC1-AC5 的实跑输出都贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
- [ ] 任务体记录：机制设计完成（`done`）与机制被实际调用点使用，是两件不同的事——本任务把
      两者之间的缺口显式补上

## Touches
- tasks/gap-two-layer-loop-tick-docs-hardcode-master-not-wired-to-existing-branch-model.md（自身文件）
- plugin/loop/fast-mode-loop-tick.md
- plugin/loop/orchestrator-loop-tick.md
- orchestration/orchestrator-loop-tick.md

## 外层裁定 AC6（2026-08-06 05:5xZ——采纳，繁殖边界正确）

**裁定：采纳 AC6。** 管理者的繁殖视角是对的——`plugin/loop/` 两个共享 tick 文件是下游经升级通道消费的，
archguard 实测只有 master（+ feat/* 特性分支），直接改字面量 develop 会让下游 tick 操作不存在的分支而
断链（与 dist/package.json/mcp_entry 三层遗传丢失同形）。

**边界（采纳的关键）**：
- **共享文件**（`plugin/loop/fast-mode-loop-tick.md` + `orchestrator-loop-tick.md`）：工作分支名**可配置、
  默认 master**——下游不配即保持 master 行为，改前改后完全一致（AC6 负控制：archguard tick 仍产出
  master 分支操作）。
- **本仓副本**（`orchestration/orchestrator-loop-tick.md`）：可直接改字面量 develop——本仓自己消费，
  无下游兼容负担。

**与 PLAN-develop-branch-cutover 的关系**：PLAN 阶段一已执行（GitHub develop/integration 已建、
指向 926d771b，外层核实）。本任务实现「工作分支转 develop/integration」时，共享文件走可配置默认 master
路径，本仓副本走字面量改路径——两条线互不破坏。与 gap-two-peer-quay-developers 任务（双向合并）交叉：
develop 成为权威汇合点后，共享文件的 master 默认对 archguard 仍安全。
