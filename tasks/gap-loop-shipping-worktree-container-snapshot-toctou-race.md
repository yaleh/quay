---
id: gap-loop-shipping-worktree-container-snapshot-toctou-race
title: loop-shipping.test.mjs 的 worktreeContainerPaths 快照与实际 walk 之间存在 TOCTOU：新建
  worktree 在两者之间出现即误判多份物理拷贝
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Finding

**现象**：`quay goal merge GOAL-030` 第二轮(人工重试后)在 §4.7 suite 步骤**连续 8-10 次全部红**，全部是同一条测试、同一原因：

```
✖ AC2 — fast-mode-telemetry.ts has ONE physical copy; plugin/scripts/ is authoritative,
  experiments/ is a symlink re-export    [plugin/test/loop-shipping.test.mjs:307]
```

（`.quay/gate-events.jsonl` `gate:"goal-merge-result"`, `item_id:"GOAL-030"`, 连续 8 条 `verdict:"fail"` `step:"suite"`，同一 reason，跨约 90 分钟窗口。）

**已排除「这是 gap-goal-merge-suite-concurrent-npm-pack-staging-race-blocks-fan-in 没修干净」**：那个任务修的是 `adr016-screen-use-check.test.mjs` 的 walk→read ENOENT race——修后那条测试已**不再**出现在失败列表里（本轮 8-10 次红只剩这一条，证明上一个修复确实生效）。这是一个**不同**的、新的根因。

**已排除「merge 内容冲突 / 单文件逻辑 bug」**：独立在 `/tmp/goal030-merge-repro2`（`git worktree add --detach develop` + `git merge --no-ff goal/GOAL-030`，当前 goal tip `3f232bcc2`/develop tip `ecd9568fb`）单独跑 `plugin/test/loop-shipping.test.mjs`——**24/24 全绿**，包括这条 AC2 测试。同一棵树，单文件隔离跑通过。

**根因（读码确认，`plugin/test/loop-shipping.test.mjs:57-72` + `plugin/scripts/loop-shipping-exclusion-data.mjs:93`）**：AC2 测试（:321-323）调用 `walkCorpus(repoRoot, {excluded:[...]})`，默认 `containerRoot = repoRoot`（函数签名 :57 默认值）。`walkCorpus` 内部先调 `worktreeContainerPaths(containerRoot)`——该函数对 `containerRoot` 跑 `git worktree list`，取一份**快照**，然后才去递归遍历文件系统做实际 walk。这两步之间**没有任何原子性保证**。

本机 `git worktree list` 当前有 **34** 个注册项（`ls -dt /data/home/yale/work/quay-worktrees/*/` 显示创建时间横跨多天，持续在变），worker-driver 持续、高频地创建/销毁任务 worktree（本会话内已亲眼见证数个 worktree 在分钟级窗口内出现/消失）。**每一个 worktree 天然都是完整检出，自带一份 `fast-mode-telemetry.ts` 物理拷贝**——这正是为什么 `walkCorpus` 必须把它们全部排除。若在 `worktreeContainerPaths` 拍快照**之后**、实际 walk**之前**的窗口内（§4.7 全量 suite 跑 ~3 分钟，期间 worker-driver 很可能派发新任务、建新 worktree），有一个**快照时还不存在**的新 worktree 冒出来，它不在排除集合里 ⇒ walk 会把它视为普通目录递归进去 ⇒ 读到它自带的 `fast-mode-telemetry.ts` ⇒ `physicalTelemetryCopies` 多出一条 ⇒ `assert.deepEqual(copies, [canonical], ...)` 严格相等断言必红。

这解释了两个关键观察：①单文件隔离跑（~1.5 秒，且不触发任何 worktree 创建）命中该窗口的概率接近零 ⇒ 总是绿；②全量 suite 跑（~3 分钟，跨越本机持续的 worktree 创建/销毁节奏）命中窗口的概率很高 ⇒ 连续 8-10 次全红，不是偶发而是几乎必中。

**影响面**：与上一个任务同族——任何 `quay goal merge` 的 suite 步骤都会被这条 TOCTOU 间歇性（实为"几乎总是"）挡住，不是 GOAL-030 专属。

## Acceptance Criteria

- [ ] 修复方向：让排除判断与实际 walk 之间不再有 TOCTOU 窗口——候选做法之一是 walk 时对每个候选目录**实时**核验是否仍是一个注册的 worktree 根（而不是只查一次性快照），或在 walk 入口处对"这是不是一个 worktree 根"做**按需**判定（如检测 `.git` 是文件而非目录、内容指向 `gitdir:`——这是 git worktree 的结构性特征，不需要依赖一次性 `git worktree list` 快照就能识别，具体实现由执行者定）
- [ ] 取假负控制：构造一个在"快照"之后才出现的新 worktree（测试里可用 `git worktree add` 在调用 `worktreeContainerPaths` 之后、`walkCorpus` 真正遍历之前插入），验证修复前该新 worktree 会被误判为物理拷贝（红），修复后被正确跳过（绿）
- [ ] 回归验证：`plugin/test/loop-shipping.test.mjs` 既有全部用例（尤其 AC2 的两条 worktree-container 用例、plugin-staging 用例）在修复后仍然全绿——不能为了堵这个 TOCTOU 而弱化"真实残留副本仍必须被抓到"的核心语义
- [ ] 在 `/tmp/goal030-merge-repro2`（或等效复现树）上，人工制造一次"walk 过程中出现新 worktree"的场景（而不是只在单元测试里 mock），确认修复后不再红
- [ ] `scripts/test.sh` 全量跑绿
- [ ] 本任务落地（develop 上）后，`quay goal merge GOAL-030` 的下一次尝试在 suite 步骤不再复现这条失败

## Definition of Done

`walkCorpus`/`worktreeContainerPaths` 对"排除集合是一次性快照、实际遍历不是原子操作"这一结构性缺陷有了不依赖时序的修复（不是加重试、不是加延时赌概率），`scripts/test.sh` 全绿，且验证过 GOAL-030（或任一其它 goal 分支）的并入不再被这条 TOCTOU 间歇性挡住。

<!-- dedup-ref -->同族前作：`gap-goal-merge-suite-concurrent-npm-pack-staging-race-blocks-fan-in`（done）修的是 walk→read 之间文件消失的 ENOENT race，本任务修的是 worktree 容器排除集合快照与实际遍历之间的 TOCTOU——两者都是"全量 suite 并发执行下的环境伪影挡住 goal merge"这一大类下的不同具体机制，不是同一个缺陷的重复。

## Touches

- plugin/test/loop-shipping.test.mjs
- plugin/scripts/loop-shipping-exclusion-data.mjs
- tasks/gap-loop-shipping-worktree-container-snapshot-toctou-race.md
