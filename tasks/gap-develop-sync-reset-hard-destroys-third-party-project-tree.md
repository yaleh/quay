---
id: gap-develop-sync-reset-hard-destroys-third-party-project-tree
title: develop 双向同步的终局解 `git reset --hard develop` 在第三方项目上摧毁它自己的分支与全部任务文件（真实项目
  develop 与 main 分叉是常态）
status: todo
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---
## Finding

2026-09-11 实测（orangevps，外部可核，非主张）。`gap-doc-branch-hardcoded-author-breaks-third-party-develop-sync`（status: done）
把 doc 分支从硬编码 `author` 改成运行时派生（= 当前 checked-out 分支），让第三方项目也并入 develop 同步。
**本条的残留正是那次修复的直接后果**：同步一旦对第三方项目生效，它的**终局解**
（`takeDevelopDiscardingDoc`，`plugin/scripts/driver-filters.ts:290` 附近的 `git reset --hard develop`）
就会在**真实项目**上摧毁它自己的分支。

现场（`gap-aged-project-post-upgrade-driver-e2e` 的真机 e2e，目标 = 已升级的 meta-cc 副本
`/home/yale/quay-verify-upgrade-5ddbcf80-root`，源项目 `/home/yale/work/meta-cc` 只被 `cp -a` 读、未受影响）：

驱动的任务提交路径 `commitTaskFile` 调 `syncDocDevelopBidirectional(root)`（`driver-filters.ts:913`），
它读到的 doc 分支 = 项目当前分支 `main`，而 meta-cc 另有一个**早已分叉的 `develop` 分支**。于是：

```
$ git -C <copy> reflog -6
794ab28 HEAD@{2}: commit: tasks: ac239-subagent-session-id-scan todo→ready（promotion-driver 机械晋升）
50e5d2d HEAD@{3}: commit: tasks: ac239-subagent-session-id-scan task_write by cli:2329001
a8c57f5 HEAD@{4}: commit: chore: release v3.8.4
...
d95dac8 HEAD@{0}: reset: moving to develop          ← 终局解

$ cat <copy>/.quay/doc-develop-sync.jsonl
{"event":"doc-develop-sync-semantic","phase":"begin","branch":"main"}
{"event":"doc-develop-sync-semantic-conflict","phase":"merge","branch":"main"}
{"event":"doc-develop-sync-semantic-resolved","phase":"take-develop","branch":"main",
 "resolution":"discarded-doc-commits","discardedCount":50,
 "discarded":["794ab28 tasks: ac239-subagent-session-id-scan todo→ready…","50e5d2d tasks: ac239…task_write by cli:2329001",
              "a8c57f5 chore: release v3.8.4","0d896ab build(make): …","…","ebdfc85 …"]}
{"event":"doc-develop-sync-bidirectional","phase":"done","developToDoc":"not-ff","docToDevelop":"true"}
```

后果（同一次实测）：
- `discardedCount: 50` —— 项目 `main` 的 **50 个提交**（含 v3.8.2/3.8.3/3.8.4 三个 release 提交）被判为可丢；
- `git reset --hard develop` 之后 **`tasks/` 目录空了**：`ls <copy>/tasks/*.md | wc -l` = **0**（源项目 102 个任务文件）；
- `.quay/config.yml` 也随 HEAD 一起消失（`develop` 树里没有它）——项目**连自己的 provider 绑定都没有了**；
- 驱动仍在跑（`promotion-driver`/`worker-driver` 常驻进程在 06:11 起，`quay-selector` 06:12 已在为
  `ac239-subagent-session-id-scan` 选任务）——**它们现在服务的是一棵没有任务板、没有 config 的树**。

**为什么这不是「一次误操作」而是机制问题**：`resolveDocBranch(root)` 就是 `currentBranchName(root)`
（`driver-filters.ts:442`），而 `develop` 分支在**真实项目里几乎总是存在且与主线分叉的**——这正是
「develop 分支」这个命名的常规含义。所以任何一个有 `develop` 分支、且主线不是 develop 的项目，
只要它的 driver 提交一次任务文件，就可能触发 `reset --hard develop`。

**与该修复的分工（不重复立案）**：那条管的是「doc 分支认错（恒 no-refs ⇒ 同步根本不发生）」；
本条管的是「同步**发生了**，而它的终局解在一个它不是为其设计的项目里是破坏性的」。
本仓库（quay 自己）里 develop 是权威基线、doc 分支是可弃的工作分支——那条裁定在本仓库成立；
搬到第三方项目上，`main` 是**项目自己的主线**、不是可弃物。

⛔ 裁定方向不由本任务预设（可能的方向：只在项目显式声明 author/develop 模型时才启用终局解 /
终局解前先做「doc 侧独有提交是否可弃」的判定并把不可弃的情形升级为 needs-human /
第三方项目根本不该并入该同步）。执行者需自己取证并给出裁定，不得照抄本段。

## Acceptance Criteria

- [ ] 用一个**第三方项目**（任意有分叉 `develop` 分支、主线非 develop 的 git 仓库）复现：
      让 `commitTaskFile` 路径跑一次，`git reset --hard develop` 被执行、主线提交被丢弃、
      任务文件消失。命令与真实输出贴进本任务（判据取假：复现不出即本条的判定前提不成立，须如实报出）
- [ ] 明确裁定该机制在「非本仓库形态的项目」上应如何表现，并在**机制**上实现（⛔ 不是只在文档里写一句）
- [ ] 新增/修改的测试必须**能取假**：把修复 revert 之后同一条测试必须失败；且测试覆盖两种形态
      （① 项目声明/处于 author-develop 模型 ⇒ 旧行为逐字不变；② 普通第三方项目 ⇒ 不执行破坏性终局解）
- [ ] 端到端负控制：在 meta-cc 副本形态的项目上跑一次任务提交，`tasks/*.md` 计数与提交数**不减少**，
      且该读数**不依赖 $PATH 辅助**（硬规则 4b）
- [ ] 与 `gap-doc-branch-hardcoded-author-breaks-third-party-develop-sync` 的关系已在本任务里写明
      （本条是它的后果，不是它的重复；两处 AC 都在同一条链上可核）

## Definition of Done

- [ ] 复现与修复都已完成，且 `tasks/*.md` 不减少这一读数有**真实跑过的**正/负两条输出
- [ ] 若新增检查器/守卫：它在修复被 revert 后必须取假（硬规则 4：结构上不可能取假的量不是测量）
- [ ] 本条的发现与 `gap-aged-project-post-upgrade-driver-e2e` 的 AC-239 实测互相引用（后者在同一个
      现场观测到本条；两边都不许把它写成「driver 起不来」这种更弱的归因）

## Touches

- plugin/scripts/driver-filters.ts
- plugin/scripts/worker-driver.ts
- tasks/gap-develop-sync-reset-hard-destroys-third-party-project-tree.md