---
id: gap-git-graph-task-view-aggregate-commits-by-task-id
title: git-history 缺少任务视图——fan-in 后 git ref 即删（27 条 ref 仅 4 条 7 天内有独有提交、带 %D
  decoration 的提交仅 4 个），而本仓库的开发单元是 quay 任务；按 subject 里的 task id
  聚合才是用户想看的分支，作为可切换视图、默认仍为 git 视图；判据已改写为跨模型成立，不再依赖即将被主任务删除的「泳道」概念
status: done
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-git-graph-ref-partition-collapses-all-topology-to-one-lane
---
## Proposal

**用户诉求（2026-09-08）**：想在图上看到「这段时间有活动的所有分支」。核对下来，用户心里的「分支」≈ **一个任务的工作全貌**，而 git ref 层面的分支在本仓库是**短命的**——fan-in 之后 ref 立即删除：`git for-each-ref refs/heads` 只剩 27 条，其中 7 天活跃窗口内**有独有提交的仅 4 条**；同窗口带 `%D` decoration 的提交更是只有 **4 个**。把「分支」等同于 git ref，在本仓库注定只能看到极少数还没被清理掉的残余。

**本仓库的提交 subject 高度结构化，task id 可机械提取**（实测样本，四种形态）：

```
Merge branch 'develop' into task/<id>                       ← dev-merge，被 ff 带上主干
tasks: 翻 <id> done（driver 机械 fan-in）                    ← fan-in 落地
tasks: <id> task_write / <id> todo→ready（promotion-driver） ← 立案与晋升
<id>: <实现说明>                                            ← 实现提交，冒号前是 task id
```

⇒ 按 task id 把提交聚成**任务分组**：一组 = 一个任务从立案、晋升、实现到 fan-in 的完整轨迹，**跨越它在 git 里被 ff 拍平掉的那些边界**。这正是 git ref 视图看不到、而用户想看的东西。

**定位（重要，不可省）**：这是**项目特定启发式**（依赖本仓库 driver 的提交文案约定），**不是 git 语义**。因此必须是**可切换视图**，**默认仍是 git 视图**——不让启发式冒充 git 真值（硬规则 4b）。文案约定一旦变化，任务视图会退化，而 git 视图不受影响。

**⚠️ 与在飞主任务的耦合（2026-09-09 补，本次改写的原因）**：`gap-git-graph-adopt-git-column-algorithm-and-decorate-labels`（ready，在飞）会把 git 视图的模型从「泳道对象数组」换成「每提交一行 + 该行的边集合」，并**删除 `GitGraphLayout` 的泳道对象与 `fork`/`merge`/`open`/`overflow` 字段**。本任务原先的 AC3（「`?view=task` 的泳道数 > git 视图的泳道数」）与 AC6（「任取一个任务泳道」）都建立在「泳道」这个即将消失的概念上，主任务落地后**结构上不再可判定**。

本次改写把全部判据换成**跨模型成立**的形式：`taskIdFromSubject` 是纯函数、`unattributedCount` 是恒等式、视图切换是路由行为，三者都与布局模型无关；原 AC3 的价值主张（「任务视图能看到 git 视图看不到的东西」）改用一个模型无关的表述——**同一 task id 的提交在 git 视图里散落在 ≥2 个不同列，而在任务视图里聚为一组**。并新增一条结构判据，禁止任务视图的输出依赖即将被删除的泳道字段。

**已完成的实现（worker 提交 `474743997`）**：`taskIdFromSubject` + `layoutTaskGraph` + `?view=` 切换（默认 git）+ 回归测试。其中纯函数与路由部分不受主任务影响；`layoutTaskGraph` 当前返回 `GitGraphLayout`，需按 AC7 解除对泳道字段的依赖。

## Plan

1. 保留 `taskIdFromSubject(subject): string | null`，覆盖四种文案形态；**无法识别返回 `null`，不猜**（fail-visible）。
2. 任务视图按 task id 分组；无法归属的提交进「未归属」组，**其条数显式显示**——不与「没有未归属」同形（硬规则 3b）。
3. 视图切换 `?view=task` / `?view=git`（**默认 git**），两个视图共用同一套行模型与渲染代码，不产生第二份渲染实现。
4. 任务分组的标签链接到 `/task/<id>` 详情页（复用已有的 `taskIdFromBranchRef` 同类映射）。
5. **解除对泳道对象的依赖**：任务视图的输出结构只承诺「每提交一行 + 分组归属 + `unattributedCount`」，不引用 `fork`/`merge`/`open`/`overflow`，使它在主任务替换布局模型后仍然成立。

## AC

- [x] AC1 `taskIdFromSubject` 对四种文案形态各返回正确 task id，对无关 subject（如 `chore: re-anchor quay-init-closure-ratchet baseline`）返回 `null`：`node --test packages/quay/test/gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs` 退出码 0。
- [x] AC2 负控制：喂一条 `Merge branch 'develop' into develop`，断言返回 `null` 而不是把 `develop` 当成 task id ⇒ 判据能取假。
- [x] AC3（**改写，跨模型成立**）任务视图确实多看见东西：取一个真实 task id，断言它的提交在 **git 视图里占据 ≥2 个不同的列号**，而在**任务视图里属于同一组**。这条不依赖「泳道」概念，在旧的泳道模型与主任务的每行列号模型下都可判定。
- [x] AC4 未归属显式化：任务视图输出含 `unattributedCount`，且满足恒等式 `总提交数 − Σ各任务分组提交数 = unattributedCount`（差为 0）；且该值在**生产数据**上 > 0（不是只在 fixture 里非零，硬规则 4 推论三）。
- [x] AC5 默认视图不变：不带 `?view=` 参数时返回的 `#git-graph-data` 与 `?view=git` **逐字节一致**——启发式不冒充默认真值。
- [x] AC6（**改写措辞**）与 git 对账：任取一个近期完成的任务**分组**，其提交条数与 `git log --oneline --all --grep=<task-id>` 的条数一致（差为 0）。
- [x] AC7（**新增，防主任务落地后失效**）任务视图的输出不依赖即将被删除的泳道字段：`grep -nE "\.(fork|merge|open|overflow)\b"` 在任务视图的实现路径（`layoutTaskGraph` 及其调用链）中命中数 = 0；负控制：显式引用其中任一字段应使该计数 > 0。

## DoD

生产 `/git-history?view=task` 上，点开一个近期完成的任务分组，其提交覆盖该任务从 `task_write` 到 `翻 … done` 的完整轨迹（AC6 的 `git log --grep` 对账差为 0）；`/git-history` 不带参数时仍是 git 视图（AC5 逐字节一致）；且在主任务 `gap-git-graph-adopt-git-column-algorithm-and-decorate-labels` 落地、泳道对象被删除之后，本任务的全部 AC **仍然可判定且仍为绿**（AC7 是这条的结构保证）。以一次真实浏览器读数为证。

## Touches

- packages/quay/src/serve-git.ts（taskIdFromSubject；任务视图分组；?view= 切换；解除对泳道字段的依赖）
- packages/quay/src/serve-handlers.ts（`/git-history` 与 `/git-history.json` 的 `?view=` 参数透传）
- packages/quay/test/gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs（本任务的回归测试）
- packages/quay/test/serve-handlers.test.mjs（?view= 路由与默认值用例）
- tasks/gap-git-graph-task-view-aggregate-commits-by-task-id.md
