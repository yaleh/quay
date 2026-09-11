---
id: gap-develop-sync-reset-hard-destroys-third-party-project-tree
title: develop 双向同步的终局解 `git reset --hard develop` 在第三方项目上摧毁它自己的分支与全部任务文件（真实项目
  develop 与 main 分叉是常态）
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
  goal_ac: AC-207
goal_ac: AC-207
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

## 复现与修复（真实输出）

**复现脚本**：`/home/yale/work/quay-repro-ac207/repro.mjs` —— 构造第三方项目形态（`main` = 项目自己的
主线，含 `chore: release v3.8.4`；`develop` 早已分叉并删掉一个产品文件 ⇒ `develop..main` 含代码路径），
再调用生产入口 `syncDocDevelopBidirectional`（`commitTaskFile` 的两个调用点
——`commitTaskFile` 后的 `markNeedsHuman`（`driver-filters.ts`）与 `applyPromotions`
（`ready-pool-check.ts`）——都经它）。

**BEFORE（把本条的守卫 revert 掉：`discardedCommitsAreDisposable` 恒返回 disposable）**：

```
AFTER: { "branch": "main", "head": "7bd2f46", "tasks": "...",
         "log": ["7bd2f46 develop: drop legacy lib", "b40b6ba baseline"],
         "reflog": ["7bd2f46 HEAD@{0}: reset: moving to develop",
                    "48f3d9b HEAD@{1}: reset: moving to HEAD",
                    "48f3d9b HEAD@{2}: commit: tasks: e2e-verify todo→ready（promotion-driver 机械晋升）"] }
EVENT: {"event":"doc-develop-sync-semantic-resolved","phase":"take-develop","branch":"main",
        "resolution":"discarded-doc-commits","discardedCount":2,
        "discarded":["48f3d9b tasks: e2e-verify todo→ready（promotion-driver 机械晋升）",
                     "6823737 chore: release v3.8.4"]}
```
⇒ `git reset --hard develop` 被执行（reflog `reset: moving to develop`）、`main` 的 2 个提交（含
release 提交）被丢弃、HEAD 落到 develop 的树。

**AFTER（守卫在位）**——同一脚本、同一个现场：

```
AFTER: { "branch": "main", "head": "32a7027", "tasks": "...",
         "log": ["32a7027 tasks: e2e-verify todo→ready（promotion-driver 机械晋升）",
                 "f8b5b7f chore: release v3.8.4", "3137a74 baseline"],
         "reflog": ["32a7027 HEAD@{0}: reset: moving to HEAD", ...] }
EVENT: {"event":"doc-develop-sync-semantic-take-develop-refused","phase":"take-develop","branch":"main",
        "reason":"non-doc-paths","offendingPaths":["CHANGELOG.md","src/lib.js"],
        "discardedCount":2,"discarded":[...],"resolution":"refused-non-disposable-commits"}
```
⇒ HEAD 不变、提交数不减、`tasks/` 与 `.quay/config.yml` 俱在，且落一条**可区分**的拒绝事件。

**第三种形态（`develop` 无任务板）**：分叉侧只碰文档面（只丢弃 `tasks/gap-a.md` 的翻转），但 develop
的树里根本没有 `tasks/` ⇒ 拒绝、`reason: develop-missing-task-board`（与上一条成因可区分）、
`tasks/*.md` 计数 1→1、`.quay/config.yml` 仍在。

**取假（硬规则 3/4：结构上不可能取假的量不是测量）**：把守卫 revert 掉后，
`plugin/test/driver-filters.test.mjs` 的 **AC2(位置判定) / AC3② / AC3②b / AC4 四条即失败**
（`pass 60 / fail 4`）；守卫在位 ⇒ `pass 64 / fail 0`。`meta-driver.test.mjs` 110 项全绿。

## 裁定与机制

**裁定**：`git reset --hard develop` 丢弃的是**当前 checked-out 分支**的独有提交。它在本仓库成立的
唯一前提是「doc 工作分支是 develop 的一次性投影」——而 `resolveDocBranch`（`driver-filters.ts:442`）
把这个前提实现成了「当前分支」，于是它在**任何**项目上都自动为真。人 2026-09-06 的「merge 冲突时可以
损失 author 分支的变更」裁定，其授权对象是**本仓库的 doc 投影分支**，不是一个可以套到任意分支上的
通行证。

**机制**（`plugin/scripts/driver-filters.ts`，⛔ 不是文档里写一句）：终局解执行前先过
`discardedCommitsAreDisposable(root)`（纯读探测），**两条同时成立**才允许 reset：
① 被丢弃的提交只碰任务板/文档面（复用既有 `DOC_SURFACES` 单一定义，⛔ 不重写第二份清单）⇒ 没有任何
项目代码会丢失；② `develop` 的 `tasks/` 非空（当当前分支有任务板时）⇒ develop 是任务板的**有效
权威**，而不是一棵从未见过任务板的树（实测现场 reset 后 `tasks/*.md` 计数 = 0）。
任一条不成立 ⇒ **拒绝**：工作树原样不动 + 落 `doc-develop-sync-semantic-take-develop-refused` 事件
（携带成因、被逐条枚举的提交、越界面）+ 返回 false（未同步；`promotion-driver.ts:687-690` 明示该
返回值**仅供观测、不阻断本轮**，故拒绝不会让循环停摆）。

**为什么不用分支名判**：`author` 是逐项目不同的字面量（硬规则 4 推论二），且前一条任务正是为消除它
才把硬编码 `DOC_BRANCH` 改成运行时派生——再引入一个新的分支名字面量等于把那个缺陷换个方向重犯。
判据落在**即将被丢弃的东西本身**（直接量，硬规则 4b）。

**本仓库旧行为逐字不变的实证**：生产载体 `.quay/doc-develop-sync.jsonl` 的 3 次 `take-develop`，
唯一非空的一次丢弃的 14 条全是 `goals: AC-NNN 写盘即提交（goal-store）` ⇒ ① 成立；develop 有任务板
⇒ ② 成立 ⇒ reset 照旧执行（`AC3①` 测试钉住这一路径）。即：**本条不改变任何已观测到的生产结局**。

**5b 同族（同载体）**：拒绝态若不入 `SyncHealth` 聚合面，则它既不入桶也不是最后事件（其后还跟着
双向同步汇总事件）⇒ 与「一切正常」同形（硬规则 3b）⇒ 补 `semanticTakeDevelopRefused`
（`plugin/scripts/meta-driver.ts`）。同载体 grep：
`takeDevelopDiscardingDoc` / `discarded-doc-commits` / `doc-develop-sync-semantic-resolved` 的引用点
只有 `driver-filters.ts` + `meta-driver.ts` + 两个测试文件，均已覆盖。

**收窄了一处既有断言（如实记账）**：`driver-filters.test.mjs` 的「机械 ff 失败 + 语义合并冲突 ⇒
终局解成立」原以 `code.ts`（代码路径）作冲突文件——那正是本条要禁掉的形态。夹具改用文档面文件；
它真正钉的性质（结构冲突不得卡死 + 丢弃逐条可查）不变。非文档面的形态由新增的 AC3② 钉住。

**与 `gap-doc-branch-hardcoded-author-breaks-third-party-develop-sync` 的关系（AC5，可核）**：那条
（status: done）把 doc 分支从硬编码 `author` 改为运行时派生 `currentBranchName` ——本条是它的**直接
后果**：同步一旦对第三方项目生效，终局解才第一次在真实项目上被触发。链条在代码里可核：那条的产物
是 `resolveDocBranch`（`driver-filters.ts:442`，恒等于「当前分支」），本条消费同一函数并证明
「当前分支」≠「可弃投影分支」，故在其下游加了可弃性判定。⛔ 不是重复立案。

**与 AC-239 实测的互引（DoD）**：本条现场 = `gap-aged-project-post-upgrade-driver-e2e` 的真机 e2e
（目标 = 已升级的 meta-cc 副本）；该任务已把本条列为 `depends_on` 并在其 AC-239 记录里引用本条路径。
两边都如实归因：**驱动仍在跑**（`promotion-driver`/`worker-driver` 常驻、selector 正常选任务），
它们服务的是**一棵被 reset 掉任务板与 config 的树** —— ⛔ 不是「driver 起不来」这种更弱的归因。

## Acceptance Criteria

- [x] 用一个**第三方项目**（任意有分叉 `develop` 分支、主线非 develop 的 git 仓库）复现：
      让 `commitTaskFile` 路径跑一次，`git reset --hard develop` 被执行、主线提交被丢弃、
      任务文件消失。命令与真实输出贴进本任务（判据取假：复现不出即本条的判定前提不成立，须如实报出）
- [x] 明确裁定该机制在「非本仓库形态的项目」上应如何表现，并在**机制**上实现（⛔ 不是只在文档里写一句）
- [x] 新增/修改的测试必须**能取假**：把修复 revert 之后同一条测试必须失败；且测试覆盖两种形态
      （① 项目声明/处于 author-develop 模型 ⇒ 旧行为逐字不变；② 普通第三方项目 ⇒ 不执行破坏性终局解）
- [x] 端到端负控制：在 meta-cc 副本形态的项目上跑一次任务提交，`tasks/*.md` 计数与提交数**不减少**，
      且该读数**不依赖 $PATH 辅助**（硬规则 4b）
- [x] 与 `gap-doc-branch-hardcoded-author-breaks-third-party-develop-sync` 的关系已在本任务里写明
      （本条是它的后果，不是它的重复；两处 AC 都在同一条链上可核）

## Definition of Done

- [x] 复现与修复都已完成，且 `tasks/*.md` 不减少这一读数有**真实跑过的**正/负两条输出
- [x] 若新增检查器/守卫：它在修复被 revert 后必须取假（硬规则 4：结构上不可能取假的量不是测量）
- [x] 本条的发现与 `gap-aged-project-post-upgrade-driver-e2e` 的 AC-239 实测互相引用（后者在同一个
      现场观测到本条；两边都不许把它写成「driver 起不来」这种更弱的归因）

## Touches

- plugin/scripts/driver-filters.ts
- plugin/scripts/meta-driver.ts
- plugin/test/driver-filters.test.mjs
- plugin/test/meta-driver.test.mjs
- tasks/gap-develop-sync-reset-hard-destroys-third-party-project-tree.md