---
id: gap-assert-clean-tree-premise-void-under-concurrent-writers
title: "assert-clean-tree.sh's premise (coordinator runs on a clean tree) is
  void under three concurrent writers — tonight's three false reds were manager
  tick-log append / outer worktree scaffolding / inner uncommitted change (one
  each); the 0e4eff84/be0cca93 exclusion-table patches weaken the assertion's
  ONLY advantage (it degrades into a static rule that only knows known spellings
  — the form R1/R7 failed with); two correct directions: ①delta-not-absolute
  (snapshot porcelain before the run, only newly-added items count as test
  products; no list needed) ②runtime single-writer (git worktree lock during
  agent runs — official existing implementation)"
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

**assert-clean-tree.sh 的前提（协调者在干净树上跑）已作废——改差量而非绝对，或运行期单写入者。**
管理者实测（2026-08-07 15:0x）：断言头部自述优点「不认拼法只认结果，比任何静态规则都硬」（当年
R1/R7 都漏掉的 `.quay-tmp-test-` case 靠它抓到），但前提写死在注释里——「全量套件（协调者在干净树上
跑）才是欠这个保证的地方」——**该前提在三层并发写入下已作废**：今晚三次假红分别由管理者的 tick-log
追加、外层的 worktree 脚手架、inner 的未提交改动各贡献一次。

而 0e4eff84 / be0cca93 两次修补都是**加排除表**，恰恰削弱它唯一的优点：一旦列名单，它就退化成又
一个只认已知拼法的静态规则——正是 R1/R7 已经失败过的形态。

### 两个正确方向（实现归内层定，选一或都做）

1. **差量而非绝对（止血且不需要任何名单）**：跑前拍一次 `git status --porcelain` 快照，跑后只把
   **新增项**算作测试产物（此前已存在的脏项不算本轮测试的锅）。快照文件放 gitignored 位置。
2. **运行期单写入者（根治）**：agent 运行期间 `git worktree lock` 住它的 worktree，并发清理动不了。
   官方现成实现：git worktree lock。

## Contract

measure assertion_delta = `grep -c "snapshot\|before_run\|porcelain.*before\|delta" plugin/scripts/assert-clean-tree.sh` stdout 数字段（差量实现后应 ≥1）
band assertion_delta = ≥1（断言有差量/单写入者机制，非纯绝对 + 排除表）
invoke `grep -n "snapshot\|before\|lock" plugin/scripts/assert-clean-tree.sh`
control 人为在跑前就弄脏树（预存脏项）⇒ 跑后断言不因预存脏项红（差量只算新增）；人为跑中新写文件 ⇒ 断言红（新增项仍是测试产物）
resume 若中断，先跑 measure 读断言当前实现形态

## Acceptance Criteria

- [x] AC1: **断言改差量或单写入者**——`plugin/scripts/assert-clean-tree.sh` 改为差量：新增 `--snapshot`（跑前拍 `git status --porcelain` 到 gitignored `.quay/assert-clean-tree.snapshot`）与 `--check`（跑后只把快照里没有的新增项算测试产物）；同族 `tmux-leak-scan.sh` 一并差量化（`--snapshot`/`--check`）。不再需要排除表（旧 0e4eff84/be0cca93 名单被快照取代）。
      scripts/test.sh 全量套件路径：跑前 `--snapshot`、跑后 `--check`。绝对形式保留为无 flag 的历史行为（standalone/能力目录）。
- [x] AC2: **今晚三次假红不复现**——预存脏项（manager tick-log 未提交追加 / 外层 worktree 脚手架 / inner 未提交改动）在跑前快照里即存在，`--check` 只算快照外的新增项，故预存脏项不再红；新写入（快照后出现）仍触发红。实测：`M seed.txt` 预存 + `?? test-residue.txt` 新增 → 红且只列新增；移除新增 → 绿。
- [x] AC3: **负控制**——真测试残留仍被抓到：快照干净后测试写 `.quay-tmp-test-dir/` → `--check` 红（差量不放过真泄漏）。
- [x] AC4: 与 gap-gitignore-worktree-scratch-dirs-kills-round4-false-red（A1，gitignore 止血）、
      gap-worktreeinclude-declarative-copy-of-gitignored-config-into-worktrees（A2，worktree 配置）交叉标注——
      本任务是脏树断言机制形态的根治（B 类）。A1/A2 任务体已反向引用本任务（其 AC3/AC4）；本任务执行时在
      A1/A2 任务体各加一行确认注记（见下方"交叉标注"）。gap-two-layer-dispatch-gate 未立，跳过。

## 交叉标注

- → gap-gitignore-worktree-scratch-dirs-kills-round4-false-red（A1）：本任务（B，断言差量化）已落地，
  `.gitignore` 同时新增 `**/.quay/assert-clean-tree.snapshot` / `**/.quay/tmux-leak-scan.snapshot`（快照 gitignored 位置，A1 族类）。
- → gap-worktreeinclude-declarative-copy-of-gitignored-config-into-worktrees（A2）：差量断言在共享检出（非 worktree）
  上运行，`--snapshot` 快照文件放 gitignored `.quay/`；若验证移入 worktree，A2 的 .worktreeinclude 保证 config.yml 在位。

## 执行记录 (inner 2026-08-07)

**measure assertion_delta** = `grep -c "snapshot\|before_run\|porcelain.*before\|delta" plugin/scripts/assert-clean-tree.sh` → **21**（band ≥1 ✓）

**三对照实跑**（临时 git 仓库直接跑 `plugin/scripts/assert-clean-tree.sh`）：

预存脏项不红（快照含 `M seed.txt`，无新增 → `--check` 绿）：
```
PASS: git status --porcelain gained no NEW items after the full suite (clean-tree DELTA assertion)
```
新写入红（快照含 `M seed.txt`，后新增 `?? test-residue.txt` → `--check` 红，只列新增不列预存）：
```
FAIL: the working tree is DIRTY after the full suite — a test added NEW artifact(s) ...
?? test-residue.txt
OK: new file listed / OK: pre-existing NOT listed
```
真残留红（快照干净，测试写 `.quay-tmp-test-dir/` → `--check` 红）：
```
FAIL: the working tree is DIRTY after the full suite — a test added NEW artifact(s) ...
?? .quay-tmp-test-dir/
```

**tmux-leak-scan 同族三对照**（`/tmp/skv-*`）：预存 match 不红；新增 match 红且只列新增；绝对形式仍红。环境实测含
一处真实残留 `/tmp/session-liveness-Z05CAM`——预存进快照，`--check` 不误报。

**测试**：`scripts/test.sh plugin/test/test-isolation-check.test.mjs` → 15/15 pass（新增
`AC5/clean-tree DELTA` + `AC5/tmux-leak-scan DELTA`，原有绝对形式用例仍绿）。

## Definition of Done

- [x] AC1-AC4 实跑输出贴进任务体（含预存脏项不红、新写入红、真残留红的三个对照）——见"执行记录"
- [ ] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）——按执行规则仅做 scoped 验证（`--for-task` + 直接跑断言），
      全量套件 gate 留给协调者/外层；差量机制改动不影响 node 测试本身，全量 gate 走既有 full-suite 路径

## Touches
- plugin/scripts/assert-clean-tree.sh（差量快照或 worktree lock 逻辑）
- plugin/scripts/tmux-leak-scan.sh（若同族，一并考虑差量）
- tasks/gap-gitignore-worktree-scratch-dirs-kills-round4-false-red.md（AC4 交叉标注）
- tasks/gap-worktreeinclude-declarative-copy-of-gitignored-config-into-worktrees.md（AC4 交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-07T15:2xZ
changed: 管理者 15:0x 裁定 + 实测：断言前提作废（三层并发写入、今晚三次假红各贡献一次）；排除表修补
  削弱断言唯一优点（退化成静态规则）。方向：差量而非绝对 / 运行期单写入者（worktree lock）。
