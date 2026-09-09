---
id: gap-git-graph-task-view-aggregate-commits-by-task-id
title: git-history 缺少任务视图——fan-in 后 git ref 即删（27 条 ref 中仅 4 条 7
  天内有独有提交），而本仓库的开发单元是 quay 任务；按 subject 里的 task id 聚合才是用户想看的分支，作为可切换视图、默认仍为 git
  拓扑
status: ready
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

**用户诉求（2026-09-08）**：想在图上看到「这段时间有活动的所有分支」。核对下来，用户心里的「分支」≈ **一个任务的工作全貌**，而 git ref 层面的分支在本仓库是**短命的**——fan-in 之后 ref 立即删除：`git for-each-ref refs/heads` 只剩 **27** 条，其中 7 天活跃窗口内**有独有提交的仅 4 条**。换句话说，把「分支」等同于 git ref，在本仓库注定只能看到极少数还没被清理掉的残余。

**本仓库的提交 subject 高度结构化，task id 可机械提取**（实测样本，四种形态）：

```
Merge branch 'develop' into task/<id>                       ← dev-merge，被 ff 带上主干
tasks: 翻 <id> done（driver 机械 fan-in）                    ← fan-in 落地
tasks: <id> task_write / <id> todo→ready（promotion-driver） ← 立案与晋升
<id>: <实现说明>                                            ← 实现提交，冒号前是 task id
```

⇒ 可以按 task id 把提交聚成**任务泳道**：一条泳道 = 一个任务从立案、晋升、实现到 fan-in 的完整轨迹，**跨越它在 git 里被 ff 拍平掉的那些边界**。这正是 git ref 视图看不到、而用户想看的东西。

**定位（重要，不可省）**：这是**项目特定启发式**（依赖本仓库 driver 的提交文案约定），**不是 git 语义**。因此必须作为**可切换视图**，**默认仍是 git 拓扑视图**——不要让一个启发式冒充 git 真值（硬规则 4b：别用未经验证的派生量替代直接量）。文案约定一旦变化，任务视图会退化，而 git 视图不受影响。

**与 `gap-git-graph-ref-partition-collapses-all-topology-to-one-lane` 的分工（不重复）**：那条修的是 **git 视图**本身的拓扑与命名（默认视图必须忠于 git 的 DAG）；本条是**另加一个视图**。两者不互相替代：git 视图回答「仓库的 DAG 长什么样」，任务视图回答「这段时间哪些任务在推进」。

## Plan

1. 抽纯函数 `taskIdFromSubject(subject): string | null`，覆盖上述四种文案形态；**无法识别返回 `null`，不猜**（fail-visible）。
2. 任务视图的泳道 = 按 task id 分组的提交；无法归属任何 task id 的提交归入一条「未归属」泳道，**其条数显式显示**——不与「没有未归属」同形（硬规则 3b）。
3. 视图切换：`?view=task` / `?view=git`（**默认 git**），页面上提供切换控件；两个视图**共用同一套行模型与渲染代码**，只替换分组函数，不产生第二份渲染实现。
4. 任务泳道的 chip 链接到 `/task/<id>` 详情页（复用已有的 `taskIdFromBranchRef` 同类映射）。

## AC

- [ ] AC1 `taskIdFromSubject` 对四种文案形态各返回正确 task id，对无关 subject（如 `chore: re-anchor quay-init-closure-ratchet baseline`）返回 `null`：`node --test packages/quay/test/gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs` 退出码 0。
- [ ] AC2 负控制：喂一条 `Merge branch 'develop' into develop`，断言返回 `null` 而不是把 `develop` 当成 task id ⇒ 判据能取假。
- [ ] AC3 任务视图确实多看见东西：对真实仓库输入，`?view=task` 的泳道数 **>** 同窗口 git 视图的泳道数（证明它看到了被 ff 拍平掉的任务边界）。
- [ ] AC4 未归属显式化：任务视图输出含 `unattributedCount`，且满足恒等式 `总提交数 − Σ各任务泳道提交数 = unattributedCount`（差为 0）；且该值在**生产数据**上 > 0（不是只在 fixture 里非零，硬规则 4 推论三）。
- [ ] AC5 默认视图不变：不带 `?view=` 参数时返回的 `#git-graph-data` 与 `?view=git` **逐字节一致**——启发式不冒充默认真值。
- [ ] AC6 与 git 对账：任取一个近期完成的任务泳道，其提交条数与 `git log --oneline --all --grep=<task-id>` 的条数一致（差为 0）。

## DoD

生产 `/git-history?view=task` 上，点开一个近期完成的任务泳道，它的提交覆盖该任务从 `task_write` 到 `翻 … done` 的完整轨迹（用 AC6 的 `git log --grep` 对账，差为 0）；而 `/git-history` 不带参数时仍是 git 拓扑视图（AC5 的逐字节一致）。以一次真实浏览器读数为证。把分组函数换回 git 视图会让 AC3 变红。

## Touches

- packages/quay/src/serve-git.ts（taskIdFromSubject；任务视图分组；?view= 切换控件；复用同一行模型与渲染）
- packages/quay/src/serve-handlers.ts（`/git-history` 与 `/git-history.json` 的 `?view=` 参数透传）
- packages/quay/test/gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs（本任务的回归测试）
- packages/quay/test/serve-handlers.test.mjs（?view= 路由与默认值用例）
- tasks/gap-git-graph-task-view-aggregate-commits-by-task-id.md
