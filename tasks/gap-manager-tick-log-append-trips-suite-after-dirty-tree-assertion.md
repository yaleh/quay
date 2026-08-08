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
measure dirty_files_after_suite = `git status --porcelain | grep -vE '^.. \.quay/|^.. orchestration/manager-tick-log\.md$' | wc -l` stdout 数字段（套件后**测试残留**脏文件数；已知并发写入者已从原始 porcelain 中排除）
band dirty_files_after_suite = 0（修复后，含 manager tick-log 并发追加时）
invariant suite-after 断言必须区分「测试残留」与「已知并发写入者」（manager tick-log / .quay scratch），不得对合法并发写入判红
invoke `git status --porcelain`
control 人为在套件期间追加 manager-tick-log ⇒ 断言必须不红（已知写入者被排除）；人为放一个测试残留 ⇒ 必须仍红
resume 若中断，先跑 measure 读当前脏文件数
```

## Acceptance Criteria

- [x] AC1: **断言区分已知写入者**——manager-tick-log 追加 + .quay scratch 在套件后不判红（测试残留仍判红）
      —— `assert-clean-tree.sh` 在 `git status --porcelain` 后过滤已知并发写入者
      （`^.. \.quay/` + `^.. orchestration/manager-tick-log\.md$`），残留才是测试残留；实测 STEP 2/3 PASS、STEP 4/5 FAIL
- [x] AC2: **负控制**——人为放一个测试残留（mkdtemp 文件）⇒ 断言必须仍红
      —— 实测 STEP 4：根级 `.quay-tmp-test-abc` ⇒ `FAIL exit=1`（`?? .quay-tmp-test-abc`）；STEP 5：非写入者跟踪文件 `M src.txt` ⇒ `FAIL exit=1`
- [x] AC3: manager 继续正常追加（不暂停）⇒ 套件仍能绿（协调非依赖 manager 自觉）
      —— 机制不依赖 manager 自觉：断言过滤 manager 的 tick-log 追加，无需暂停/协调；实测 STEP 2（`M orchestration/manager-tick-log.md`）PASS。
      **完整套件含 live manager 追加的证明在批量合边界闸门**（见 DoD 注 + gap-suite-green-gate 交叉标注），非本任务自跑
- [x] AC4: 与 `gap-quay-last-pane-txt-untracked-dirties-tree`（.quay scratch）、
      `gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge`（套件闸门错粒度）交叉标注
      —— 已在两任务体加交叉标注（见下）

## Definition of Done

- [x] AC1-AC4 实跑输出贴进任务体 —— 见下方 `## Execution evidence`（STEP 1-6 实测 + scoped 套件 14/14 pass）
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`），含 manager 正常追加期间
      —— **按外层执行规则 2（scoped-only，完整套件延后到外层）+ 交叉标注
      `gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge`（完整套件绿闸门在批量合边界，非任务 DoD）**
      ⇒ 本任务不自跑完整套件；由外层批量合闸门承担。机制侧已证明：套件后断言不再对 manager 并发追加判红
- [x] 未来套件不再因 manager 并发追加被判红 —— 断言现排除已知并发写入者；8 月 22 日红窗的两个脏文件
      （`M orchestration/manager-tick-log.md`、`?? .quay/last-pane.txt`）实测均不再触发 FAIL（STEP 2/3）

## Touches
- scripts/test.sh（suite-after 断言：排除已知并发写入者）
- plugin/scripts/assert-clean-tree.sh（实际断言：过滤已知并发写入者）
- plugin/test/test-isolation-check.test.mjs（AC5/AC1/AC2 clean-tree 断言测试）
- tasks/gap-manager-tick-log-append-trips-suite-after-dirty-tree-assertion.md（自身文件）
- tasks/gap-quay-last-pane-txt-untracked-dirties-tree.md（交叉标注）
- tasks/gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge.md（交叉标注）

## Execution evidence

**实现（工作树 `quay-worktrees/manager-tick-log-append-trips-suite-after-dirty-tree-assertion`，branch `task/manager-...`）**

- `plugin/scripts/assert-clean-tree.sh`：在 `git status --porcelain` 后过滤已知并发写入者再判残留——
  `exclude_regex='^.. \.quay/|^.. orchestration/manager-tick-log\.md$'`；可经 `ASSERT_CLEAN_TREE_EXCLUDES` 扩展。
  FAIL 输出只列测试残留（不再把 manager/scratch 列成测试残留）；PASS 时说明排除的已知写入者。
- `scripts/test.sh` suite-after 分支：注释更新为「clean of TEST RESIDUE modulo KNOWN CONCURRENT WRITERS」。
- `plugin/test/test-isolation-check.test.mjs`：新增 `AC1/AC2 clean-tree` 测试（manager tick-log 追加 + .quay scratch
  PASS；根级残留 + 非写入者跟踪修改 FAIL）。

**实测 STEP 1-6（`assert-clean-tree.sh` 对真实 git 仓库）**

```
STEP 1 clean baseline            → PASS: git status --porcelain is empty...        exit=0
STEP 2 AC1 M orchestration/manager-tick-log.md     → PASS (excluded 1 entry)        exit=0
STEP 3 AC1 + ?? .quay/last-pane.txt                → PASS (excluded 2 entries)       exit=0
STEP 4 AC2 ?? .quay-tmp-test-abc（根级残留）        → FAIL: ...DIRTY after the full suite  exit=1
STEP 5 AC2 M src.txt（非写入者跟踪修改）            → FAIL: ... M src.txt                 exit=1
STEP 6 env 扩展 ASSERT_CLEAN_TREE_EXCLUDES 排除 orchestration/tick-log.md → PASS（无 override 则 FAIL）
```

**scoped 验证（`scripts/test.sh --for-task gap-manager-tick-log-append-trips-suite-after-dirty-tree-assertion --allow-thin`）**

- scoped 静态层全绿：test-impl-census（252 clean）、task-contract-check strict-subset（0 violations）、
  adr016-screen-use（0 active）、dead-code-after-return（0）。
- 选中测试 `plugin/test/test-isolation-check.test.mjs`：**14/14 pass，fail 0 cancelled 0**（含新增 AC1/AC2 clean-tree 用例）。

**交叉标注（AC4）**

- `gap-quay-last-pane-txt-untracked-dirties-tree`（todo）：本任务把 `.quay/*` scratch 列入 suite-after 断言豁免 ⇒
  对 last-pane 类两检查器已一致（tree-hygiene 本就 clean）；该任务剩余工作=gitignore 补规则 + 检查器口径共享来源。
- `gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge`（ready）：完整套件绿闸门在**批量合边界**，
  本任务 DoD 的「完整套件连跑 2 次全绿」按外层执行规则延后到外层批量合闸门，不自跑。

## Dispatch review

reviewer: none
at: 2026-08-07T09:0xZ
changed: 外层 2026-08-07 09:02 分诊——套件 0 测试失败但 suite-after 脏树断言红（manager tick-log
  并发追加 + .quay scratch），判为假阳性（合法并发写入）；立案防复发。
