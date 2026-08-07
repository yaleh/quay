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

- [ ] AC1: **断言改差量或单写入者**——跑前快照 porcelain（或 agent 运行期 worktree lock），跑后只把新增项算测试产物；不再需要排除表
- [ ] AC2: **今晚三次假红不复现**——预存 tick-log/脚手架/未提交改动不再触发断言红（预存脏项不算新增）；新写入仍触发（新增项算测试产物）
- [ ] AC3: **负控制**——真测试残留（测试写进共享检出）仍被抓到（差量不放过真泄漏）
- [ ] AC4: 与 gap-gitignore-worktree-scratch-dirs-kills-round4-false-red（A1，gitignore 止血）、
      gap-worktreeinclude-declarative-copy-of-gitignored-config-into-worktrees（A2，worktree 配置）、
      gap-two-layer-dispatch-gate（若有）交叉标注——本任务是脏树断言机制形态的根治

## Definition of Done

- [ ] AC1-AC4 实跑输出贴进任务体（含预存脏项不红、新写入红、真残留红的三个对照）
- [ ] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）

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
