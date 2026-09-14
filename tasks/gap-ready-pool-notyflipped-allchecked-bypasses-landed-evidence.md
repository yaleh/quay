---
id: gap-ready-pool-notyflipped-allchecked-bypasses-landed-evidence
title: notYetFlipped() 的 allChecked 分支绕过一切落地证据独立触发误判——AC 预勾选的新任务一进 ready 就被判"已落地只是漏翻转"
status: ready
labels:
  - gap
  - mechanism
  - dispatch
parent: null
children: []
extra:
  schema: finding
---
**type:** finding

## Finding

`plugin/scripts/ready-pool-check.ts` 的 `notYetFlipped()`（:1059）最后一行：

```js
const doneFlipReady = !hasTouchAbsentFromRef(task.body, repoRoot, o) && (workLandedReady || commitTraceReady);
return doneFlipReady || allChecked;
```

`doneFlipReady` 本身经过精心设计（文件里大段注释、多个历史缺陷修复记录都在强调这一点）：真实落地证据（`workLanded`/`traced`）必须和"AC checkbox 是否全勾"配对使用，单独一个信号都不够（"commit-trace alone is never enough"、"a subject hit only proves..."）。

但函数返回值在 `doneFlipReady` 之外，又单独把 `allChecked` OR 了一次——**只要任务 body 的 AC/DoD checkbox 全部是 `[x]`，哪怕 `workLanded`/`traced` 都是 false（零落地证据：没有实现分支、没有任何 inner:/fan-in: 提交），`notYetFlipped()` 依然返回 true**，把该任务当成"已落地只是漏了状态翻转"处理，从而被排除出可派发的 ready 池。

从大段注释的演进历史看，这条独立 OR 分支很可能是在 `doneFlipReady` 内部逐步加固各种落地证据门槛（`gap-ready-pool-commit-trace-subject-not-proof-of-done` 等）之前遗留下来的旧兜底分支，后续修复只收紧了 `doneFlipReady` 内部，没有注意到 `:1059` 这行独立的 `|| allChecked` 仍然完全绕开它——同硬规则 5b（"在某处修好 X ≠ X 只在那一处"）。

**与本仓两个已 done 的相邻任务的区别（已核实非重复）**：
- `gap-ready-pool-notyflipped-allchecked-leftover-worktree-exemption`（done）给 `allChecked` 臂加了「残留 worktree」豁免——但只覆盖「fan-in 失败、worktree 还敞着」的场景。
- `gap-nyf-doneflipready-arm-bypasses-leftover-worktree-exemption`（done）把该 worktree 豁免提到了所有臂之上（现 `:1006-1007` `if (hasLeftoverWorktree) return false;`）——但同样只处理"worktree 曾经开过"的情形。

本条描述的场景是**worktree 从未开过**（任务刚建立，从未被派发实现过）——`hasLeftoverWorktree` 为 false，两个已修复的臂都不触发；`workLanded`/`traced` 也都是 false（零落地证据）；纯粹靠 `allChecked` 单独一臂把任务误判为「已落地」。经逐行读 :987-1059 确认，这条独立 OR 分支从未被上述两次修复覆盖，是同一函数里另一处、机制不同的缺陷。

**影响面**：任何 quay-native 消费方，只要立案习惯是"AC checkbox 预先写成完成后应满足的条件"（而不是逐步勾选的进度标记——这正是 quay-fleet 自己的立案惯例，用来描述"完成时应当怎样"），新建的 ready 态任务只要 AC 全勾选就会立刻被误判为已落地，dispatch 循环拿到空池、任务永远不会被真正派发实现。

## Evidence

fleet-warden（quay-fleet 项目）报告并附初步代码定位；本任务立案前独立复核：

1. 逐行读 `ready-pool-check.ts:987-1059`（见上方引用块），确认 `:1059` 的 `allChecked` 分支确实完全独立于 `doneFlipReady`（不经过 `workLandedReady`/`commitTraceReady`/`hasTouchAbsentFromRef` 任一道门槛），也不经过 `:1006-1007` 的 `hasLeftoverWorktree` 前置（该前置只在 worktree 存在时才短路返回 false，worktree 从未开过时不生效）。
2. 在 quay-fleet 仓库（/home/yale/work/quay-fleet）上实测复现：`git log --all --oneline | grep fleet-agent-pwa-message-send-via-keys` 只有 `task_write by cli:...` 登记提交，无任何实现提交；该任务 `status: ready`，body 里 AC checkbox 全部 `[x]`（`checked=2/2`）——与该缺陷描述的触发条件逐字吻合。

## Touches

- plugin/scripts/ready-pool-check.ts
- plugin/test/ready-pool-check.test.mjs
- tasks/gap-ready-pool-notyflipped-allchecked-bypasses-landed-evidence.md

## Acceptance Criteria

- [ ] AC1 复现：构造一个 `status:ready`、AC 全勾选、零落地证据（无 `task/<id>` 分支/worktree、无 inner:/fan-in: 提交）的任务夹具，跑 `notYetFlipped()` ⇒ 当前应为 true（复现缺陷），贴改动前的红/异常读数（排除恒真，硬规则 推论四）。
- [ ] AC2 修复：`:1059` 的返回值改为不再允许 `allChecked` 单独绕过 `doneFlipReady`（具体做法由实现者判断——可能是把 `allChecked` 也纳入需要落地证据陪同的门槛，或明确论证并保留该分支但需要另一个独立证据陪同；⛔ 不得简单删掉 `allChecked` 整个语义如果它在其它地方仍有必要用途，需先读全部调用点）；修复后同一夹具 ⇒ `notYetFlipped()` 应为 false（保持可派发）。
- [ ] AC3 负控制：一个真实已落地（有实现提交、AC 全勾）的任务，修复后 `notYetFlipped()` 行为不变（仍为 true）——证明本修复没有误伤正常的"漏翻转"检测路径。
- [ ] AC4 单测覆盖上面两条用例；`scripts/test.sh` 对应泳道绿。

## Definition of Done

修复落地后，`notYetFlipped()` 对「AC 全勾但零落地证据」的任务不再误判为已落地；`ready-pool-check.test.mjs` 新增用例（改动前先红）+ 既有用例不回归；`--for-task` scoped 门绿；对一个真实已落地任务跑同一函数行为不变（AC3 负控制通过）。
