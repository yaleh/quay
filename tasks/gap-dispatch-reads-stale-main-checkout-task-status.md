---
id: gap-dispatch-reads-stale-main-checkout-task-status
title: task 状态/body/updated 读面统一以 develop git ref 为单一正源（dispatch + web
  列表/详情/live；updated 与 status 同源；disk≠develop 显式标记）——对象库只读，不 checkout develop
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
> **RETREATED / 搁置（范围扩展为整体读面设计（人 2026-08-30 令）：原 dispatch 读面已落地 done；新增 web 显示 updated 同源 + 详情页 develop-first + disk≠develop 显式标记——补齐 gap-web-task-status-reads-stale-main-checkout 只修 status 半边留下的缺口（实证：shared-install-cache 列表 done 而 updated 显示 disk mtime、详情页显示 disk ready）。读法限对象库（git show/cat-file/log），⛔ 不 checkout develop（挡 fan-in）。）** **再扩展（2026-08-30）：dispatch 读面的 ready-pool-check `--apply`（晋升决策路径）仍读盘上 ⇒ 补全为读 develop（AC6），是 `gap-ff-propagate-structurally-broken-filing-must-target-develop` 写侧落地的硬前置。**

**type:** execution

## Proposal

task 的**状态/body/updated 三类读面应统一以 develop git ref 为单一正源**。现状是片面的——两个分立任务各修各的，且 web 侧只修了一半：

1. **dispatch 读面**：slot-refill + ready-pool-check **分析路径**已改读 develop ref（本任务原范围，done）。**⚠️ 但晋升决策路径（ready-pool-check `--apply`，promotion-driver 所用）仍读盘上**——`ready-pool-check.ts:2689` 的 `base` 不含 `taskReadRef`、`:2701` 只给**非 apply 的分析路径**补 `taskReadRef: develop`、`applyPromotions(base)` 走盘上解析（无 CLI 标志、无晋升单测断言读 develop）。**补全 = 晋升路径读 develop**（`applyPromotions` 补 `taskReadRef: develop` + 单测），是 `gap-ff-propagate-structurally-broken-filing-must-target-develop` 写侧（`1e7fb9be4`，翻转直接落 develop + 盘上 restore 旧状态）落地的**硬前置**——否则晋升每轮读盘上旧状态重复晋升、develop 累积同内容提交。
2. **web 显示读面**（`gap-web-task-status-reads-stale-main-checkout`，done）**只覆盖了 status**：`serve-task.ts:60` / `serve-board.ts:205` 用 `readTaskStatusMapAtRef(root,"develop")` 覆盖列表与 board 的 status；**`updated` 列与详情页仍读主检出 disk mtime**（`serve-task.ts:200` 列表 updatedAt、`handleTaskDetail` 直接 `client.taskGet` 读 disk）。

**实证 2026-08-30（本次审计）**：`gap-suite-extend-shared-install-cache` 05:12:41 被 driver 在 develop 翻 done，主检出 disk 在 done 之后被 05:02 的未提交 task_write（范围重写）与 05:14 的内容中立写两次 bump mtime ⇒ web 列表显示 `done`（develop 覆盖）而 `updated` 显示「10m ago」（disk mtime）——**同一行的 status 与 updated 读两个源**；点进详情页读 disk ⇒ 列表 `done`、详情页 `ready`，自相矛盾。根因同硬规则 4b：**status 有了两个可分歧的读源，web 按列各取一边**。

**设计原则（整体设计，非补丁）**：
- **develop 是 task 状态/body/updated 的唯一正源**；主检出 disk（main/manager-doc 工作树）只是**写入目标** + 未提交任务的兜底，永不作显示/决策读面。
- **读法只用对象库**：`git show develop:tasks/<id>.md` / `git cat-file --batch` / `git log -1 --format=%cI develop -- tasks/<id>.md`。**⛔ 不得 `git checkout develop` / `git worktree add ... develop`**——会把 develop 检出到工作树，与在飞 fan-in 冲突、挡 push develop（同 `gap-web-task-status-reads-stale-main-checkout` 的既有裁定）。
- **读面形态 = `readTaskStatusForLive` 泛化**（observation.ts:1109 已有正形）：develop 命中 → develop 值；develop 读不到（纯未提交任务）→ disk 兜底。
- **updated 与 status 同源**：develop 派生的 status ⇒ updated = 该文件在 develop 的末次提交时刻（`%cI`）；disk 兜底的 status ⇒ updated = disk mtime（现状不变）。merge/stash/未提交写不再污染显示。
- **分歧显式化**：disk 与 develop 的 status 或 title 不一致时，页面显式标记（如 `ready（disk 未提交）` vs develop `done`），不静默取一边——未提交 task_write 编辑必须可见，不得重演 05:02 范围重写隐形。

## Plan

1. **observation.ts 加批量 develop 提交时刻读** `readTaskCommitTimesAtRef(root,"develop")`：一次 `git log --format=%cI --name-only develop -- tasks/`（对象库只读，单子进程），解析 file→末次提交时刻 map，TTL 缓存（同 `TASK_STATUS_REF_CACHE_TTL_MS` 模式）；与 `readTaskStatusMapAtRef` 同构。磁盘读面不动 dispatch（已 done，仅回归）。
2. **serve-task.ts 列表**：status 读面保持 develop 覆盖；`updatedAt` 改同源——develop 有该文件 ⇒ 末次提交时刻，否则保留 disk mtime；行内分歧标记（status/title disk≠develop 时标 `⚠ disk:ready` 类）。
3. **serve-task.ts 详情页**：`handleTaskDetail` 的 status + `last updated` 同样 develop-first（与列表一致，消除 list=done/detail=ready 矛盾）；分歧时显示双值。
4. **serve-board.ts / serve-live.ts**：确认已 develop-first；live 的 `readTaskStatusForLive` 保持正形（不退化）。
5. **⛔ 无 checkout**：全部新读只走 `git show`/`cat-file`/`log`；变更集 grep 确认无 `git checkout develop` / `git worktree add ... develop`（AC4 强制）。
6. **晋升路径读 develop**（ff-propagate 写侧硬前置）：`ready-pool-check.ts:2701` 改 `applyPromotions({ ...base, taskReadRef: develop })`（或 base 加 taskReadRef）——晋升决策与 dispatch 同源读 develop；晋升单测断言 develop 前进时晋升读 develop 非盘上（AC6）。

## Acceptance Criteria

- [ ] AC1（能取假，主修）：构造「主检出 status=ready、develop status=done」的 fixture → /tasks 行 **与** /task/<id> 详情页都按 develop 显示 done；（⛔ 仍按主检出 ready ⇒ 假；列表 done/详情 ready 的自相矛盾即缺陷形）。— 单测：serve-task.test.mjs 断言两个读面读 develop。
- [ ] AC2（能取假，updated 同源）：develop 有该文件时，updated 显示 develop 末次提交时刻；**develop 翻 done 之后对 disk 写一次（bump disk mtime）→ 显示的 updated 不变**；（⛔ 若 updated 跟随 disk mtime ⇒ 假）。— 单测：写盘后断言相对时间输入仍是 develop 时刻。
- [ ] AC3（能取假，分歧显式）：disk 与 develop 的 status 或 title 不一致 → 列表与详情页渲染可见分歧标记（不静默取一边）；一致时无标记。— 单测：分歧 case 断言标记存在、收敛 case 断言无。
- [ ] AC4（能取假，机制）：变更集无 `git checkout develop` / `git worktree add *develop*`（grep 负向断言）；新增读函数只 exec `git show`/`git cat-file`/`git log`。
- [ ] AC5（回归）：fresh 任务（disk==develop）显示不变；既有 dispatch 单测（ready-pool-check 129 + slot-refill 113）与 web 单测全绿；1500+ 任务下 /tasks 渲染延迟可接受（批量读 + TTL 生效，不逐任务 git show）。
- [ ] AC6（能取假，晋升路径读 develop——ff-propagate 写侧硬前置）：`ready-pool-check --apply`（promotion-driver 晋升路径）决策读 develop——`applyPromotions` 走 `taskReadRef: develop`；单测：构造「develop 已翻 ready、盘上仍 todo」fixture → `--apply` 不重复晋升（develop 无新增同内容提交、晋升判定读 develop 非盘上）；（⛔ 仍读盘上、重复晋升 ⇒ 假）。

## Definition of Done

web /tasks、/task/<id>、/live 的 status 与 updated 全部 develop-first 同源（disk 兜底仅用于纯未提交任务）；disk≠develop 时页面显式标记；**晋升路径（ready-pool-check --apply）读 develop（ff-propagate 写侧硬前置）**；变更集无 `git checkout develop`；AC1-AC6 全勾；全量 suite 绿；对真实分歧任务（如 shared-install-cache：develop done + disk 未提交 ready）实测列表/详情显示一致 + 标记可见。

## Touches

- plugin/scripts/ready-pool-check.ts（**applyPromotions 补 taskReadRef: develop**——晋升路径读 develop）
- plugin/test/ready-pool-check.test.mjs（**AC6 单测：晋升读 develop、不重复晋升**）
- packages/quay/src/observation.ts（readTaskCommitTimesAtRef + 读面正形）
- packages/quay/src/serve-task.ts（列表 updated 同源 + 详情页 develop-first + 分歧标记）
- packages/quay/src/serve-render.ts（updated 渲染源扩展，如需要）
- packages/quay/src/serve-board.ts（确认/补齐 develop-first + updated 同源）
- packages/quay/src/serve-live.ts（确认正形，不退化）
- packages/quay/test/observation.test.mjs（AC2 单测）
- packages/quay/test/serve-task.test.mjs（AC1/AC3 单测）
- packages/quay/test/serve-board.test.mjs（回归）
- tasks/gap-dispatch-reads-stale-main-checkout-task-status.md（自身）