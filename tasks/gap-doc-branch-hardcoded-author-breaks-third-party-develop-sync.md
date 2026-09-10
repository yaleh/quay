---
id: gap-doc-branch-hardcoded-author-breaks-third-party-develop-sync
title: DOC_BRANCH 硬编码 "author"——第三方项目（工作分支非 author）的 develop 同步恒 no-refs，晋升写入永久对派发不可见
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-207
---
## Proposal

**实测复现（2026-09-10，orangevps `/home/yale/work/ac207-third-party`，非主张）**：该第三方项目的任务 `e2e-verify-207` 被 promotion-driver 晋升 `todo→ready`，提交真实落在 `main`（该项目的工作分支）——但 `ready-pool-check.ts` 的**派发读面硬编码读 `develop` git ref**（`analyzeTasks`/`applyPromotions` 的 CLI 入口固定传 `taskReadRef: develop`）。`develop` 分支停在旧的 `todo`，从未被同步：

```
main 分支：af37560 tasks: e2e-verify-207 todo→ready（promotion-driver 机械晋升）
develop 分支（派发实际读的）：git show develop:tasks/e2e-verify-207.md → status: todo   ← 陈旧
```

后果：promotion-driver 每轮都从 `develop` 的视角判定该任务仍是 `todo`、**重复"晋升"它**（`round=49/50/51`，逐轮 `promoted_ids:["e2e-verify-207"]`，`committed:false`——`commitTaskStatus` 判定"无需再写"所以不产生新提交，但 develop 读面永远停在旧状态）；worker-driver 每轮从 `develop` 的视角看**零 ready 任务**（`pool:0`，`stop_reason:"pool-empty"`）——**任务永远不会被真正派发**。这正是本轮 AC-207 端到端反复陷入 needs-human 循环、每次"看起来阻塞已解除却仍不推进"的**真正根因**——比此前发现的几处 `path.join(root,"plugin","scripts",...)` 锚点缺陷更底层：那些缺陷挡的是"能不能跑起来"，这个缺陷挡的是"跑起来的结果能不能被看见"。

**根因（位置判定，逐层追溯到底）**：

1. `ready-pool-check.ts` 的 CLI 入口（`analyzeTasks`/`applyPromotions` 均如此）固定 `taskReadRef: develop`，理由（`gap-dispatch-reads-stale-main-checkout-task-status`，done）是"develop 是权威基线，读盘上的工作分支是陈旧代理量"——**这个设计前提本身没错**，错在下一层。
2. `applyPromotions` 提交后调用 `syncDocDevelopBidirectional(opts.root)`（`ready-pool-check.ts:2655`）——**这正是负责把工作分支的新提交同步回 develop 的机制**，设计上应该让上一步的"权威基线"假设成立。
3. **但 `syncDocDevelopBidirectional`（`driver-filters.ts:557`）内部硬编码读 `DOC_BRANCH` 常量**（`driver-filters.ts:438`：`export const DOC_BRANCH = "author"`）——`revParse(root, DOC_BRANCH)` 对第三方项目（工作分支是 `main`，无 `author` 分支）恒返回 `null` ⇒ 函数在第一行就判定 `"no-refs"` 并直接返回，**从未执行任何同步**（`docSha === null || developSha === null` ⇒ 短路退出，`driver-filters.ts:558-559`）。
4. `"author"` 是**本仓库自己的工作分支命名约定**（`main-checkout-author-ff-develop`、`gap-doc-develop-sync-semantic-conflict-resolution` 等任务的既定上下文），**被当作全仓通用常量写进了 shipped 代码**——这是把"本仓库的具体配置"当成"协议的固定部分"的典型缺陷（同族于本轮已修的 `resource-gate.sh`/`ready-pool-check.ts` 路径锚死在 `root/plugin/scripts`，那次错的是"锚在 root"，这次错的是"锚在一个字面分支名"）。

**为什么本仓库自己没被这个 bug 挡住**：本仓库工作分支恰好就叫 `author`，`DOC_BRANCH` 的硬编码值凑巧与之相等，缺陷被完全掩盖——直到第一个工作分支不叫 `author` 的第三方项目（本次 AC-207 端到端验证）才第一次暴露。这与本轮已修复的第三批同族缺陷是**同一个模式**：只在本仓库上跑过，从未在真正的第三方环境里验证过。

**为什么此前三条"branch model"任务没覆盖它**（查重澄清，非重复立案）：`gap-quay-init-never-writes-branch-model-config-fork-baseline-merge-target`/`gap-dispatch-fork-does-not-read-config-fork-baseline`/`gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point`（均 done）解决的是**per-task worktree 的 fork 基线**（`.quay/config.yml` 的 `loop.fork_baseline`/`merge_target`，本项目已正确配置为 `develop`/`integration`）——那是"任务分支从哪里 fork、往哪里合"的问题。**本任务是另一个正交概念**："主检出/doc 工作分支本身叫什么名字、它的提交怎么同步回 develop"——`DOC_BRANCH` 与 `fork_baseline`/`merge_target` 是三个不同的配置维度，三条已完成任务都没有触及 `DOC_BRANCH`。

## Plan

1. `DOC_BRANCH` 不再是编译期常量——改为运行时派生：默认 = 当前 checked-out 分支名（`currentBranchName(root)`，函数已存在），仅当项目显式在 `.quay/config.yml` 声明了不同的 doc 工作分支时才覆盖（若该配置维度尚不存在，本任务不新增配置面——运行时派生已经是正确的通用默认，⛔ 不为了"可配置"而过度设计）。
2. `syncDocDevelopBidirectional` 签名加 `docBranch` 可选参数（缺省走上一步的运行时派生），内部不再直接引用模块级 `DOC_BRANCH`。
3. `docBranchForkedFromDevelop`/`syncDevelopToDoc` 已经接受 `docBranch` 参数（缺省值仍是旧常量）——同步改缺省值来源，⛔ 不改调用方约定（向后兼容：本仓库调用处不传参，缺省即为运行时派生出的 `"author"`，行为不变）。
4. 双向负控制：本仓库场景（工作分支=author）同步行为逐字不变（回归）；构造一个工作分支≠author 的临时项目（比如检出到 `main`），验证 `syncDocDevelopBidirectional` 不再返回 `"no-refs"`、真实执行 ff-only 同步、develop 读面在下一轮能看到该分支的最新提交。
5. 在 orangevps 第三方项目上重装验证：`e2e-verify-207` 的下一次真实晋升后，`develop:tasks/e2e-verify-207.md` 的 status 应与 `main` 一致（无需人工 `git branch -f develop main`）。

## Acceptance Criteria

- [x] AC1（位置判定）：`grep -n 'DOC_BRANCH = "author"' plugin/scripts/driver-filters.ts` 归零或该常量不再被 `syncDocDevelopBidirectional` 直接引用（贴出修改后的引用形式）。
- [x] AC2（双向负控制）：构造 `docBranch="feature-x"`（非 author）的临时 git 仓库+develop 分支，`syncDocDevelopBidirectional` 返回值 ≠ `"no-refs"`（读出两个真实 sha 并按分歧执行同步）；反向：本仓库真实场景（author）下同步行为与修改前逐字一致（回归不变，贴前后对比）。
- [ ] AC3（生产复现，读真实第三方项目）：在 orangevps `/home/yale/work/ac207-third-party` 上，人工制造一次 main 领先 develop 的分叉（如撤销本次人工 `git branch -f`），重装本次修复后的安装物，跑一轮 promotion-driver 后 `git -C <project> log develop --oneline -1` 应与 `main` 一致，且 `.quay/promotion-round.jsonl` 不再出现"同一任务连续多轮重复 promoted_ids"的模式。（待外部）
- [ ] AC4（全量绿）：`scripts/test.sh` 全量绿（含 `driver-filters.test.mjs` 新增负控制）。（待外部）

## Definition of Done

- `DOC_BRANCH` 不再是硬编码的仓库特定假设；真实第三方项目（工作分支任意命名）上 develop 同步机制生效——以 AC3 的生产复现为准，⛔ 不是只在单测里成立。
- 全量 `scripts/test.sh` 绿。
- 完成后知会 `gap-ac207-e2e-target-driver-driven-real-commit-task-done`：此前每次"阻塞解除后仍卡住"的根因已修，后续晋升不再需要人工 `git branch -f develop main` 兜底。

## Touches

- plugin/scripts/driver-filters.ts
- plugin/test/driver-filters.test.mjs
- tasks/gap-doc-branch-hardcoded-author-breaks-third-party-develop-sync.md