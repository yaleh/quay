---
id: gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing
title: fan-in 的 merge target 硬编码 develop——真实项目主线不是 develop 时任务结构上永远无法落地（AC-239
  真机实测被此摧毁）
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-239
---
## Finding

2026-09-11 实测（orangevps，外部可核，非主张）。`gap-aged-project-post-upgrade-driver-e2e` 的真机 e2e
（目标 = 已升级的 meta-cc 副本 `/home/yale/quay-verify-upgrade-289a49dc-root`）走完了升级【后】的
动态闭环全程，**并在一处此前从未被观测到的闸门前停下**：

```
# 该副本自己的 worker-driver 的机械 fan-in 步骤轨迹
{"ts":"2026-09-11T08:14:29.558Z","step":"acquire-fan-in-lock","exit":0,"ok":true}
{"ts":"2026-09-11T08:14:29.580Z","step":"merge-develop","exit":0,"ok":true}
{"ts":"2026-09-11T08:14:30.111Z","step":"anti-drift","exit":1,"wall_ms":525,"ok":false,
 "reason":"ANTI-DRIFT HARD FAIL: task ac239-subagent-session-id-scan — 1566 violation(s)"}
{"ts":"2026-09-11T08:14:30.124Z","step":"release-fan-in-lock","exit":0,"ok":true}
```

**根因（三条，全部实测）**：

① 该副本的 `develop` 是一支**远古分叉**：`git log -1 develop` = `d95dac8 docs: update documentation
   architecture ...`（2025-10-14）；`git merge-base main develop` = `4562c37a5d6d`，而 **main 领先该
   merge-base 571 个提交**。`git ls-tree -r --name-only develop` 里 **`tasks/*.md` = 0 个**（main 有 103 个）。
   ⇒ 它既不是任务板的权威，也不含可实现的源码树。

② 机械 fan-in 的 merge target **硬编码 `develop`**，且**没有任何项目侧配置旋钮**：
   - `plugin/scripts/worker-driver.ts:3701` `const mergeTarget = opts.mergeTarget ?? "develop";`
   - `plugin/scripts/anti-drift-touches-check.ts:213` `getArgValue(args, "--merge-target") ?? "develop"`
   - `plugin/scripts/fan-in-ts-typecheck-gate.ts:161` 同形默认
   实测该副本升级后的 `.quay/config.yml` 里**没有任何 branch/merge/landing 键**
   （`grep -nE "branch|merge|landing" .quay/config.yml` 只命中一条 gate 名）。
   ⚠️ 相关既有事实：`gap-config-key-consumer-check-mechanical-enumeration`（done）处理过 `merge_target`
   这个**零消费者配置键**——即「曾经有过一个无人读的键，后来被接线或删除」。本条是在那之后暴露的：
   现状是**没有键、默认值是字面量**。

③ anti-drift 的判据是 `git diff --name-only <mergeTarget>...HEAD`（`anti-drift-touches-check.ts:119-120`
   `computeActualFiles`）必须**逐路径**落在该任务的 `## Touches` 里。分支是从 `main` 分叉的（因为 ① 的
   develop 不可用）⇒ 三点 diff = **1566 个文件**（独立复算：`git diff --name-only develop...task/... | wc -l`
   = **1571**），**结构上不可能被任何 `## Touches` 覆盖**。

**为什么这不是「worker 没做对」**：同一次运行里该 worker **真的实现了修复并提交**——
`d8598f7 fix(mcp): honor include_subagents on the explicit session_id path`，+217/-16，
含两个新增/修改的测试文件（`internal/mcp/executor/query_session_subagents_test.go`、
`internal/mcp/query/query_files_test.go`），`go test` 相关包 `ok query`/`ok executor`。
它倒在的不是实现，是**落地路径对项目形态的假设**。

**为什么这是机制问题而不是配置问题**：`develop` 分支在真实项目里**常规含义就是「开发主线」**，
而本仓库的用法（develop = 权威基线、doc 工作分支是可弃投影）是**本仓库的私有约定**。任何一个
「有 develop 分支、且主线不是 develop」的项目，一旦被 quay 驱动，**每个任务都会在 anti-drift 上硬失败**
——与任务本身做得对不对无关。

**同族（不重复立案，三处都在同一条链上）**：
- `gap-doc-branch-hardcoded-author-breaks-third-party-develop-sync`（done）：硬编码 `author` ⇒ 同步不发生；
- `gap-develop-sync-reset-hard-destroys-third-party-project-tree`（done）：同步发生了，终局解
  `git reset --hard develop` 在第三方项目上是破坏性的；
- **本条**：落地闸门 `anti-drift`/`merge-develop` 以 `develop` 为基线 ⇒ 主线非 develop 的项目
  **永远无法落地**。
三者是同一条「quay 假设 develop 是权威主线」被逐层拆除的过程；本条是**第三层，且是唯一一层会
让任务永久卡死（不是丢数据、不是不同步，而是根本落不下）**。

## Proposal

**What/Why**：让「合并/落地基线」成为**从项目推导的量**，而不是本仓库字面量——使真实项目
（主线不是 develop）也能被 quay 驱动落地；`develop` 仍作为本仓库的默认值逐字不变。

**Approach（方向，⛔ 不由本任务预设最终裁定；执行者须自己取证）**：

1. 先取证：确认三处默认值是否都走到同一个判定函数；确认现有 `fork-baseline.ts` / `decideForkBaseline`
   是否已经是「从项目推导基线」的既有机制（若已存在则本条的修法是**接线**而非新造）。
2. 定义「落地基线」的判定：候选来源可包括项目默认分支（`git symbolic-ref refs/remotes/origin/HEAD`
   或 config）、任务的 `## Touches` 所依赖的基线、或既有 `fork-baseline` 的产物。
   ⛔ 不得再引入一个新的分支名字面量（硬规则 4 推论二：字面量换台机器/换项目即失效且静默）。
3. 判据须**能取假**：构造一个「主线非 develop 且有分叉 develop」的第三方项目夹具，
   证明修复前该形态任务在 anti-drift 硬失败、修复后能落地；同时证明本仓库（develop 权威）行为**逐字不变**。

**人裁定（2026-09-11，覆盖上面"不预设最终裁定"的开放性——落地基线的选择本身已被人定向）**：

不走"从目标项目自身分支结构推导基线"这条路。改为：**应用本项目自己的 git branch 模式**——
master = 项目默认分支；develop = 任务板权威基线/worktree 分叉点/fan-in 快进目标；author = doc-only
工作分支（见本仓库 CLAUDE.md「分支同步（author ↔ develop）」一节的角色定义）。

`quay init` 在为目标项目建仓时须**创建**符合此模式的分支（实测 2026-09-11：`packages/quay/src/init.ts`
当前对 `branch`/`develop`/`author` 零命中——`grep -n "branch\|develop\|author\b" packages/quay/src/init.ts`
无输出，即该文件当前完全不处理分支）。若目标项目尚无 `develop`/`author` 分支，`quay init` 建出来；
若目标项目已有同名分支但语义不同（例如目标项目自己的 `develop` 本来就是「主线」），需要一个可判定
的处理（不能悄悄复用同名分支去承载不同语义，那会重现本任务 Finding 里①描述的冲突）。

这套分支须在**后续实际开发过程中被真正使用**——fan-in/anti-drift/晋升写面等机制的基线落到这些
新建分支上，而不是目标项目原有的主线分支。

⇒ 本任务的落地范围因此扩大到 `quay init` 的建仓步骤（`packages/quay/src/init.ts` /
`packages/quay/src/cli/init.ts`），原 Touches 清单未覆盖，已在下面补充；执行者仍须自行核实具体
接线点，本裁定只定方向，不预设实现细节。

**Out of scope**：不重做前两条同族任务已修的东西；⛔ 不在本任务里改 AC-239 的判据。

## Acceptance Criteria

- [ ] 用一个**真实项目形态**（有分叉 `develop`、主线是 `main`）复现：任务在该项目里被 driver 驱动到
      fan-in 时 `anti-drift` 硬失败，且失败原因可归因到基线选择（不是任务越界）。命令与真实输出贴进本任务
      （判据取假：复现不出 ⇒ 本条判定前提不成立，须如实报出）
- [ ] 明确裁定「落地/合并基线」应如何判定，并在**机制**上实现（⛔ 不是只在文档里写一句），
      且不引入新的分支名字面量
- [ ] 新增/修改的测试**能取假**：把修复 revert 之后同一条测试必须失败；且覆盖两种形态
      （① 本仓库 develop 权威 ⇒ 行为逐字不变；② 第三方项目主线非 develop ⇒ 不硬失败）
- [ ] 端到端负控制：在 meta-cc 副本形态的项目上，一个**自身实现正确**的任务能走完 fan-in 落地
      （或至少：anti-drift 不再因基线选择而失败），读数不依赖 $PATH 辅助（硬规则 4b）
- [ ] 与 `gap-doc-branch-hardcoded-author-breaks-third-party-develop-sync`、
      `gap-develop-sync-reset-hard-destroys-third-party-project-tree` 的关系已写明（三层同链，本条是第三层）
- [ ] `quay init` 为目标项目创建符合本项目分支模式（master/develop/author）的分支，有真实跑过的
      命令与输出（不是文档描述）；且后续开发过程（fan-in/anti-drift/晋升写面）实际以这些新建分支
      为基线，而非目标项目原有的主线分支——用一个真实第三方项目形态（有自己的 `develop`/无 `develop`
      两种情况）各跑一次证明

## Definition of Done

- [ ] 复现与修复都已完成，且「第三方形态不再硬失败」有**真实跑过的**正/负两条输出
- [ ] 若新增检查器/判定：它在修复被 revert 后必须取假（硬规则 4：结构上不可能取假的量不是测量）
- [ ] 本条的发现与 `gap-aged-project-post-upgrade-driver-e2e` 的 AC-239 实测互相引用（后者在同一现场
      观测到本条；两侧都不许把它写成「worker 没实现」这种更弱的归因）

## Touches

- plugin/scripts/worker-driver.ts
- plugin/scripts/anti-drift-touches-check.ts
- plugin/scripts/fan-in-ts-typecheck-gate.ts
- tasks/gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing.md
- packages/quay/src/init.ts
- packages/quay/src/cli/init.ts