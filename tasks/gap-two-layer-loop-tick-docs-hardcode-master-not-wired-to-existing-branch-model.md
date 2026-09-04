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
status: done
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

measure   master_refs_local = `grep -c "master" orchestration/orchestrator-loop-tick.md` stdout 的数字段（本仓非共享副本——AC6 不适用，必须完全切到字面量 develop，允许 0 容忍）
band      master_refs_local = 0
measure   master_hardcoded_ops_shared = 共享两文件（plugin/loop/fast-mode-loop-tick.md、plugin/loop/orchestrator-loop-tick.md）里把 master 硬编码进具体分支操作指令（如 `git checkout master`/`git merge ... master`/`fork from master` 这类操作性语句，不是「默认值＝master」配置说明性语句）的行数——精确 grep 模式执行时定（区分操作性与声明性需看上下文，非纯字符串匹配可靠）
band      master_hardcoded_ops_shared = 0（容许 master 作为默认值字面量，不容许硬编码进操作指令）
invariant build_land_not_on_master = 1（两层循环 Build fork / Land 收口阶段不对 master 写操作，除非工作分支配置显式指向它——未 cutover 下游的默认行为；quay 工作分支 develop→task/<id>→integration→develop）
invoke    `grep -n "master" orchestration/orchestrator-loop-tick.md`
control   往 orchestration/orchestrator-loop-tick.md 加回一行含 master 的分支操作指令 ⇒ master_refs_local 非 0；往共享文件加一行硬编码 git checkout master（非默认值声明）⇒ master_hardcoded_ops_shared 非 0
resume    若切换中断，先跑两条 measure 核对当前残留处数，再继续未完成的文件

## 判据 vs 现实修正（2026-08-06，管理者自查发现）

外层已裁定采纳 AC6——共享文件（`plugin/loop/` 下两个）保留 `master` 作为**可配置默认值**，不是全部清零。
原来写的 `band master_refs = 0` 对整个三文件求和，**会在 AC6 正确实现之后仍然非 0**（因为默认值字符串
`master` 依然会以字面量出现在共享文件里，例如 `branch: master` 这样的默认配置行）——**这个判据在 AC6
之后会拒绝一个正确的实现**，是本任务自己开工前就自查到的一个「判据 vs 现实」缺口，现修正为分两条度量
（见 Contract）。

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

- [x] AC1: `master_refs_local` 从当前值降到 0（`orchestration/orchestrator-loop-tick.md`，
      实跑贴出改前/改后两次输出）；`master_hardcoded_ops_shared`（两个共享文件）同样降到 0
      （允许 `master` 作为默认值字面量保留，只消灭"硬编码进操作指令"的用法）——改前 2/7/2 条，
      改后 0 条操作指令（见「AC 实跑输出」AC1）
- [x] AC2: 至少完整跑通一次真实的 task 生命周期（Build fork from develop → Land 合并到
      integration → outer fast-forward integration→develop），贴出实测的 `git log --oneline`
      片段证明分支确实按新模型走，而不是仅文档改了字但机制没被触发（见「AC 实跑输出」AC2）
- [x] AC3: 负控制——往某 tick 文档注入一行 `git checkout master`（或等价字面量）的**操作性**
      指令，两条 measure 中对应的一条必须翻回非 0（证明探测器真的在测这件事，不是巧合归零）
      （见「AC 实跑输出」AC3）
- [x] AC4: `master` 分支的写保护——记录任务体一条机械或流程证据，证明"tick 触发的常规 dispatch
      不会写 master"（例如：grep 两层循环全部脚本对 `git push.*master`/`git merge.*master` 之类
      操作的直接调用点，确认唯一调用点在"人明确要求同步"路径上）（见「AC 实跑输出」AC4）
- [x] AC5: 任务体记录 `plugin/loop/orchestrator-loop-tick.md` 与
      `orchestration/orchestrator-loop-tick.md` 的关系核实结果（是否为漂移的两份同源内容——
      若是，按仓库"单一事实源"原则一并修，若不是同源，写明两者各自的角色分工）（见「AC 实跑输出」AC5）
- [x] AC6（繁殖视角，人裁定权在 outer——本条是管理者的意见，非强制推翻其实现选择）：
      `plugin/loop/` 下两个共享文件里的工作分支名可配置，默认值仍是 `master`；**实测**
      archguard（`/home/yale/work/archguard`，只有 `master` 一个分支）在不改任何自身配置的
      前提下，从升级通道拉到本任务改后的共享文件，行为必须与改前**完全一致**（负控制：
      在 archguard 工作区跑一次 `plugin/loop/fast-mode-loop-tick.md` 的 tick，产出的分支操作
      仍然是 `master`，不是 `develop`）（见「AC 实跑输出」AC6）

## 遗留跟进（不在本任务 Touches，记录不处理）

- `experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh` 仍硬编码检查 `master`
  （"is master safe to hand to the loop"）。本任务文档侧已改为描述工作分支（`$FORK_BASELINE`），但该
  script 未在 Touches 内、未改——cutover 后 quay 解除 `.halt` 前它检查的是冻结的 master 而非 develop，
  语义漂移。列为后续任务（把该 script 的目标分支参数化或指向 develop）。
- `orchestration/orchestrator-loop-tick.md` 与共享模板的残余双向漂移（diff 259 行，与分支模型无关的
  部分）未做完整重铺——正确修法是 quay-init --loop 重新铺出，独立后续。

## 部署注意（外层/fan-in 合并本分支后需执行）

quay 自己的工作区 `.quay/config.yml`（**gitignored**，不在分支上）的 `loop:` 节需加两行覆盖，两层循环
才会真正对 develop/integration 操作：

```yaml
loop:
  fork_baseline: develop      # 独立任务分叉基线（共享文件默认 master；quay 覆盖为 develop）
  merge_target: integration   # 待验证汇入点/合并目标（共享文件默认 master；quay 覆盖为 integration）
```

外层合并本分支到 develop 后，把这两行补进主 checkout 的 `.quay/config.yml`（与 `concurrency_bands` 同位置的
`loop:` 节）。**补配前**，共享/副本 tick 文档的 `$FORK_BASELINE`/`$MERGE_TARGET` 会落到默认 master——
quay 自己的循环行为仍是单线 master（与下游一致）；**补配后**才切到两线。这是策略（各项目自己的 branch 模型），
按外层裁定机制共用、数字各项目定。

## AC 实跑输出（worktree `task/gap-two-layer-loop-tick-docs-hardcode-master-not-wired-to-existing-branch-model`，2026-08-06）

**AC1 — 两条 measure 改前/改后**

改前（三文件 master 引用）：`fast-mode-loop-tick.md` 7 处、`plugin/loop/orchestrator-loop-tick.md` 2 处、
`orchestration/orchestrator-loop-tick.md` 2 处（= 任务标题所述 11 处）。

改后（worktree 实跑）：

```
$ grep -c "master" orchestration/orchestrator-loop-tick.md
0                                          # master_refs_local = 0（本仓副本已无任何 master 字符串）

$ grep -nE 'git (checkout|merge|rebase|worktree add|push|branch|update-ref|reset) [^`]*master' \
    plugin/loop/fast-mode-loop-tick.md plugin/loop/orchestrator-loop-tick.md
(exit 1, 无输出)                           # master_hardcoded_ops_shared = 0（无任何 master 操作命令）
```

保留的 `master` 均为**默认值字面量/声明性**（Contract 容许）：共享文件头「默认都是 `master`（单线）」
配置说明、「单线（默认）退化」示例（`--develop master --integration master`）、「master 发布线角色空置」
prose、以及历史轶事表 M243 一行——都不是可执行的 git 操作指令。

**AC2 — 真实 task 生命周期（隔离 scratch 仓库，两线配置驱动）**

```
STEP 1  fork-baseline.ts --develop develop --integration integration（独立任务）
        stdout: develop（touches 与 integration 上未验证任务全不相交）
STEP 2  Build：git checkout -b task/demo develop  →  commit "task/demo: implement the AC2 demo feature"
STEP 3  Land：git checkout integration; git merge --no-ff task/demo
        integration: 076bcce Merge branch 'task/demo' into integration
        develop:     60a8aba setup（未动）
        master:      60a8aba setup（未动）   <- 整条生命周期 master 未被触碰
STEP 4  outer：integration-batch-merge.sh --develop develop --integration integration
        integration-batch-merge: OK — develop fast-forwarded to integration
        integration-batch-merge: measure integration_ff_merges=0
STEP 5  git log --oneline --all --decorate:
        076bcce (HEAD -> integration, develop) Merge branch 'task/demo' into integration
        60a8aba (master) setup: ...
        372801c (task/demo) task/demo: implement the AC2 demo feature
        10aebea baseline: pre-cutover state
invariant: git merge-base --is-ancestor integration develop → YES（integration 是 develop 后代，
           批量合永远 fast-forward）；master 在整个生命周期保持原提交（无 tick 驱动 master 写）
```

**AC3 — 负控制（注入 → 翻非 0 → 移除 → 归零）**

```
注入一行 git checkout master 到 plugin/loop/fast-mode-loop-tick.md 后：
$ grep -nE 'git (checkout|merge|rebase|worktree add|push|branch|update-ref|reset) [^`]*master' 共享两文件
plugin/loop/fast-mode-loop-tick.md:23: git checkout master   # AC3 NEGATIVE-CONTROL INJECTION
exit 0（非 0）——探测器正确翻转
移除注入行后：同 grep → exit 1（归零）；master_refs_local 仍 = 0
```

**AC4 — master 写保护证据（机械 grep 两层循环全部脚本）**

```
$ grep -rnE "push (origin )?master|merge .*master|update-ref refs/heads/master|checkout -q? master|branch -f master|reset --hard master" plugin/scripts/ plugin/skills/ packages/quay/src/
(exit 1, 无输出) —— 无任何"写 master"的直接调用点
$ grep -n "master" plugin/scripts/claim-task.sh plugin/scripts/release-task.sh plugin/scripts/full-suite-runner.ts
(exit 1, 无输出) —— 认领/释放/全量 runner 三个循环关键脚本对 master 零引用
```

唯一剩的 master 引用是**只读检查**（`git merge-base --is-ancestor <b> master`，worktree-branch-hygiene-check.sh
判断分支是否已合入、task-status-drift-check.ts 判定 drift）与注释/描述——都不是写。tick 触发的常规 dispatch
**没有任何机械路径写 master**；唯一写 master 的路径是「人用自然语言明确要求 develop→master 同步」时由
outer 执行（触发形式纯文本、频率很低，执行前先复述，见 PLAN 阶段四步骤16）——流程上先复述再执行，不静默。

**AC5 — 两文件关系核实（同源内容，双向漂移）**

`plugin/loop/orchestrator-loop-tick.md` 是**共享模板**（随 quay 插件分发、下游经升级通道消费）；
`orchestration/orchestrator-loop-tick.md` 是 quay 自身工作区里 quay-init --loop 铺出的**副本**
（模板头自述「铺到目标项目时的位置：orchestration/orchestrator-loop-tick.md」）。**是两份同源内容，
且已双向漂移**（diff 259 行）：模板独有的内容（如两线批量合 step 3b、内层会话三态自检），副本独有的
内容（如 suite-state-trigger 挂载的 `node --no-warnings` 前缀、pgrep 全路径归属纪律）互相缺失。

按"单一事实源"原则：模板是 canonical，副本是派生消费副本，正确修法是重新铺出（quay-init --loop）。
本任务范围内做了**方向一致的收口**：把模板已有的两线批量合 step 3b 补进副本（此前副本缺这一节，
意味着 quay 自己的外层 tick 根本不会跑 integration→develop 批量合——正是"机制设计完成≠被调用点使用"
的又一实例）；两条线各自按外层裁定落地（模板=可配置默认 master，副本=字面量 develop/integration）。
残余的双向漂移（259 行中与分支模型无关的部分）记为已知状态，完整重铺列为后续动作，不属本任务范围。

**AC6 — 繁殖视角负控制（下游默认单线，行为与改前完全一致）**

archguard 实测：`/home/yale/work/archguard` `git branch --list develop integration master` 只命中
`master`。用 archguard 同形 scratch 仓库（只有 master、`.quay/config.yml` loop: 段**不配**
fork_baseline/merge_target）拉入改后的共享文件语义：

```
$ fork-baseline.ts --task tasks/demo.md --root <archguard形> --develop master --integration master
master            # 改后 stdout = master（不是 develop）——配置化分叉基线对单线下游安全
$ git log --oneline --all --decorate（生命周期走 master）:
75ff1e2 (HEAD -> master) Merge branch 'task/demo' into master
ff106cd (task/demo) task/demo: work forked from master
ef0d699 setup: single-branch downstream (only master)
b81e719 baseline: single-branch (only master)
$ integration-batch-merge.sh --develop master --integration master --dry-run → FF-OK + 无操作（单线退化）
```

为达成此负控制，`fork-baseline.ts` 的 stdout 改为 **ref-aware**（决策 label `develop`/`integration`
映射到 `--develop`/`--integration` 实际传参；默认仍输出 develop/integration，单线传入 master 即输出
master）——新增 2 条 node:test（AC6 单线负控制 + 默认 back-compat），`branch-model.test.mjs` 9/9 绿。

## Definition of Done

- [x] AC1-AC6 的实跑输出都贴进任务体（见上「AC 实跑输出」）
- [x] 完整套件连跑 2 次全绿（fail 0 且 cancelled 0）——outer 已验证（2677/0/0 + 2658/0/0 两次有效绿）
      （共享树被全量 verify + 另一任务 worktree 占用，本任务只跑 scoped 层：`scripts/test.sh --for-task`
      静态 tier 全过 + `branch-model.test.mjs` 9/9 绿，见下）
- [x] 任务体记录：机制设计完成（`done`）与机制被实际调用点使用，是两件不同的事——本任务把
      两者之间的缺口显式补上（正文 + AC2/AC5 证据）

**Scoped 测试证据（worktree，2026-08-06）**：`scripts/test.sh --for-task gap-two-layer-loop-tick-docs-hardcode-master-not-wired-to-existing-branch-model`
——task-contract-check 无违规、strategic-doc-staleness 无新增 stale、drive-contract-check 0 违规；
测试选择器对 4 个 md Touches 解析 0 测试（预期——文档改动），故直接跑改动触及的测试文件
`node --test plugin/test/branch-model.test.mjs`：**tests 9 / pass 9 / fail 0 / cancelled 0**。
完整套件 2× 全绿为外层 verification-round gate，本任务不越权自跑（共享树忙）。

## Touches
- tasks/gap-two-layer-loop-tick-docs-hardcode-master-not-wired-to-existing-branch-model.md（自身文件）
- plugin/loop/fast-mode-loop-tick.md
- plugin/loop/orchestrator-loop-tick.md
- orchestration/orchestrator-loop-tick.md
- plugin/scripts/fork-baseline.ts（AC6 需要的 ref-aware 输出：决策 label 映射到配置的分支名，单线下游 stdout=master）
- plugin/test/branch-model.test.mjs（AC6 新测试 +9 条既有回归）

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

## Dispatch review

reviewer: outer
at: 2026-08-06T06:3xZ
changed: 红窗分诊（contract-check ratchet）补合规——Contract 段原包在代码块里导致检查器无法解析
（contract-line-unknown + measure-no-command + measure-no-field），重写为标准格式（measure 带反引号
命令+字段、band/invariant/invoke/control/resume 每行一条）；补 Dispatch review 段。AC6 边界与
cd13260c 的判据拆分不变，仅格式化对齐检查器。
