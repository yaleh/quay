---
id: gap-manager-tick-log-append-trips-suite-after-dirty-tree-assertion
title: the manager's periodic tick-log append (orchestration/manager-tick-log.md
  in the SHARED checkout) trips the suite-after dirty-tree assertion — the 08:22
  full suite ran 39.7min with 0 test failures but went red because `M
  orchestration/manager-tick-log.md` (manager's concurrent append) + `??
  .quay/last-pane.txt` (outer's capture-pane scratch) dirtied the tree; the
  suite-after assertion
  (gap-mkdtemp-rooted-in-the-shared-checkout-dirties-the-tree) treats any dirty
  file as a test artifact — a false positive for a legitimate concurrent writer;
  every suite the manager appends during will be red
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**manager 的周期性 tick-log 追加（共享检出里的 `orchestration/manager-tick-log.md`）会触发 suite-after 脏树断言——套件绿也被判红。**

### 实测（2026-08-07 09:02）

08:22 主仓套件跑满 **39.7min（2380749ms）、0 测试失败**（✖=0、Promise-pending=0、cancelled=0），
但 suite-after 断言红：

```
FAIL: the working tree is DIRTY after the full suite — a test left an artifact in the shared checkout:
 M orchestration/manager-tick-log.md
?? .quay/last-pane.txt
```

**脏的两个文件都不是测试残留**：
- `M orchestration/manager-tick-log.md` = **manager 的并发追加**（manager 的 tick 周期与套件重叠，追加
  tick-log 是它的正常活动）；
- `?? .quay/last-pane.txt` = **外层的 capture-pane scratch**（已知，`gap-quay-last-pane-txt-untracked-dirties-tree` 已立案）。

⇒ **suite-after 断言把"任何脏文件"当测试残留**——对合法并发写入者（manager 的 tick-log）是假阳性。

### 为什么是复发阻塞

manager 的 tick 周期（~20min）< 套件时长（~39min）⇒ **每个套件期间 manager 都会追加一次** ⇒
**只要 manager 活着，套件永远过不了 suite-after 断言**。这不是一次性事故。

### 修复方向（接法留执行时）

1. **suite-after 断言排除已知并发写入者**：`orchestration/manager-tick-log.md`（manager 的合法追加）、
   `.quay/` 下的 scratch——断言应区分「测试残留」与「已知并发写入」；
2. **或 manager 套件期间暂停追加**（协调，但脆弱——manager 是独立周期）；
3. **或 manager-tick-log 移出共享检出**（如 `.quay-global/`，与主仓解耦）。

## Contract

```
measure dirty_files_after_suite = `git status --porcelain | wc -l` stdout 数字段（套件后脏文件数；当前 0 已清）
band dirty_files_after_suite = 0（修复后，含 manager tick-log 并发追加时）
invariant suite-after 断言必须区分「测试残留」与「已知并发写入者」（manager tick-log / .quay scratch），不得对合法并发写入判红
invoke `git status --porcelain`
control 人为在套件期间追加 manager-tick-log ⇒ 断言必须不红（已知写入者被排除）；人为放一个测试残留 ⇒ 必须仍红
resume 若中断，先跑 measure 读当前脏文件数
```

## Acceptance Criteria

- [ ] AC1: **断言区分已知写入者**——manager-tick-log 追加 + .quay scratch 在套件后不判红（测试残留仍判红）
- [ ] AC2: **负控制**——人为放一个测试残留（mkdtemp 文件）⇒ 断言必须仍红
- [ ] AC3: manager 继续正常追加（不暂停）⇒ 套件仍能绿（协调非依赖 manager 自觉）
- [ ] AC4: 与 `gap-quay-last-pane-txt-untracked-dirties-tree`（.quay scratch）、
      `gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge`（套件闸门错粒度）交叉标注

## Definition of Done

- [ ] AC1-AC4 实跑输出贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`），含 manager 正常追加期间
- [ ] 未来套件不再因 manager 并发追加被判红

## Touches
- scripts/test.sh（suite-after 断言：排除已知并发写入者）
- plugin/scripts/full-suite-runner.ts（若断言在 runner）
- tasks/gap-manager-tick-log-append-trips-suite-after-dirty-tree-assertion.md（自身文件）
- tasks/gap-quay-last-pane-txt-untracked-dirties-tree.md（交叉标注）
- tasks/gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge.md（交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-07T09:0xZ
changed: 外层 2026-08-07 09:02 分诊——套件 0 测试失败但 suite-after 脏树断言红（manager tick-log
  并发追加 + .quay scratch），判为假阳性（合法并发写入）；立案防复发。
