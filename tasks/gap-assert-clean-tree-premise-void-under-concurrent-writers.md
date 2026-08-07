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
status: done
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

**assert-clean-tree 的前提（协调者在干净树上跑）已作废——人 17:1x 裁定「修好困难就 disable/delete 它」，
外层裁定：disable（非 delete），保留代码 + 差量版，写复原条件。**

### 为什么修好困难（管理者实测，三条路都不便宜）

①**按写入者归因**（只把「由测试进程创建的路径」算测试产物）——需进程级归因，不便宜。
②**按路径归因**（排除 tasks/ orchestration/ docs/ adr/ 产品数据目录，各 836/53/160/32 个已跟踪文件）
——**错**：R7 规则的存在理由正是「一个测试把 M-FAKE-*.md 写进真实的 tasks/」
（gap-r1-cannot-see-tests-writing-into-the-live-task-store）。排除 tasks/ 等于让断言对 R7 那一整类
**失明**，而 R7 正是它被扩展出来专门要抓的。
③**运行期单写入者**（git worktree lock + 专用验证 worktree）——最干净但要改编排，不是改这个脚本。

### 成本收益实测（悬殊）

**今晚代价**：r4（1386s）2991 用例 fail 0，红【纯粹】来自脏树断言，整轮白跑；r5（284s）为消除 r4
告警而清理、误删 .quay/config.yml 致 72 文件启动即挂（r5 的损坏是 r4 那次"修复"造成的）；r6 22s
aborted。合计约 **28 分钟套件时间 + 三轮分诊**。**历史收益**：脚本头部记录在案的只有 1 次——2026-08-03
抓到 `REPO_ROOT/.quay-tmp-test-`。

### 人的更根本判断（管理者核实后同意）

「之前一直在 develop 跑的 suite 根本没有保障任务执行的安全」——真：任务落在 integration，套件测的
是 develop，integration 独有 28 条真内容从没被套件覆盖过。外层 13:20 后改跑 /tmp/quay-suite-int 才
修正。分支合并前验证链条本身是断的，一条断言的得失不能与之相比。

### 外层裁定：disable 而非 delete

1. **从全量套件路径摘掉**（`run_selected` 里 assert-clean-tree 那一步），不再参与判红；
2. **代码保留**（assert-clean-tree.sh + 差量版 174badc0 原样保留——它是复原后的正确形态之一）；
3. **在原处写死复原条件**：「当验证 worktree 在运行期只有一个写入者时（git worktree lock 达成），
   重新接回」。单写入者机制（③）成为**未来复原路径**，不是当前修复；
4. 为什么不清 delete：它是唯一能抓【未知新形态】的网（不认拼法只认结果，R1/R7 两条静态规则当年都
   漏掉了 .quay-tmp-test-）。删掉就要重写。一旦复原条件满足，它立刻重新正确且有价值。

## Contract

measure assert_called = `grep -c "assert-clean-tree" scripts/test.sh` stdout 数字段（disable 后 run_selected 调用应为 0，脚本文件本身保留）
measure assert_script_kept = `ls plugin/scripts/assert-clean-tree.sh 2>/dev/null | wc -l` stdout 数字段（应 = 1，代码保留）
measure restore_condition = `grep -c "single.writer\|运行期单写入者\|worktree lock" scripts/test.sh plugin/scripts/assert-clean-tree.sh 2>/dev/null` stdout 数字段（复原条件写明后应 ≥1）
band assert_called = 0 且 assert_script_kept = 1 且 restore_condition = ≥1（摘掉调用、保留代码、写复原条件）
invoke `grep -n "assert-clean-tree\|单写入者\|worktree lock" scripts/test.sh plugin/scripts/assert-clean-tree.sh`
control 全量套件路径不再因 assert-clean-tree 假红（摘掉调用）；脚本文件仍在（可复原）；复原条件写死在代码里
resume 若中断，先跑 measure 读三字段（调用/保留/复原条件）

## Acceptance Criteria

- [x] AC1: **从全量套件路径摘掉**——`run_selected` 不再调用 assert-clean-tree（不再参与判红）；
      差量版（174badc0）留在代码里
      **实跑（2026-08-07，worktree disable-assert-clean-tree）：**
      `grep -c "assert-clean-tree" scripts/test.sh` → **0**。摘掉前：`run_selected` 全量路径在
      `node --test` 后跑 `if [ "$code" -eq 0 ] && ! bash .../assert-clean-tree.sh ...`（绝对版，
      脏树即 exit 1 → `code=1` 翻红）；摘掉后 scripts/test.sh 无任何 "assert-clean-tree" 引用。
      脚本文件本身保留（见 AC2）。
- [x] AC2: **代码保留 + 复原条件写死**——assert-clean-tree.sh 原样保留；在原处（scripts/test.sh 或
      脚本头部）写复原条件「验证 worktree 运行期单写入者达成（git worktree lock）时重新接回」
      **实跑：** `ls plugin/scripts/assert-clean-tree.sh | wc -l` → **1**（代码保留）。复原条件写死在
      `plugin/scripts/assert-clean-tree.sh` 头部：
      `# RE-ENABLE CONDITION: 当验证 worktree 运行期单写入者达成（git worktree lock）时重新接回。`
      （含 RUNTIME SINGLE-WRITER / `git worktree lock` 原文；scripts/test.sh 摘掉处两处注释同记）。
      `grep -c "single.writer\|运行期单写入者\|worktree lock" scripts/test.sh plugin/scripts/assert-clean-tree.sh`
      → **scripts/test.sh:2 + plugin/scripts/assert-clean-tree.sh:2**（band ≥1 ✓）。
- [x] AC3: **假红类消除**——r4/r5/r6 那类（脏树断言制造假红 + 误清 config 连锁）不再发生；全量套件
      判红不再被 assert-clean-tree 主导
      **摘掉前后判红对照：** 摘掉前，run_selected 在 node --test 后跑绝对版断言
      （`git status --porcelain` 非空 → exit 1 → `code=1`）；协调者树上有任一并发写入者的未提交状态
      （manager tick-log 追加 / 外层 worktree 脚手架 / inner 未提交改动）即把「通过」翻红（r4/r5/r6，
      及 r5 为清 r4 告警而误删 .quay/config.yml 的连锁）。摘掉后该步不存在：
      `grep -n "assert-clean-tree" scripts/test.sh` 无输出 → 脏树**不再能**翻红全量套件判红，误清连锁
      无由发生。脚本若被人工调用仍按原行为工作（保留，见 AC2）。
- [x] AC4: **负控制**——测试真写进验证树（泄漏）的抓取能力**暂缺**（已摘掉），记录为已知让渡：
      复原条件达成前不靠此断言抓泄漏；tmux-leak-scan 仍抓 tmux 类
      **让渡记录：** suite-after clean-tree 断言是唯一能抓【测试真写进验证树】的网（不认拼法只认结果，
      当年 R1/R7 两条静态规则都漏掉 `.quay-tmp-test-` 靠它抓到）。disable 期间该负控制**暂缺**——
      复原条件（AC2）达成前不靠此断言抓泄漏；`tmux-leak-scan.sh` 调用仍保留在 run_selected 全量路径
      （`if [ "$code" -eq 0 ] && ! bash .../tmux-leak-scan.sh`），继续抓 tmux 类泄漏。
- [x] AC5: 与 gap-r1-cannot-see-tests-writing-into-the-live-task-store（R7 来源）、
      gap-gitignore-worktree-scratch-dirs-kills-round4-false-red（A1）、
      gap-worktreeinclude-declarative-copy-of-gitignored-config-into-worktrees（A2）交叉标注——
      复原路径（单写入者）+ A1/A2 三者叠加后重新接回
      **实跑（交叉标注已落地）：** 三个任务体各加 2026-08-07 交叉标注段——gap-r1 新增
      「## 交叉标注」段（指明 R7 来源、AC4 让渡、复原路径）；A1（gap-gitignore…）AC3 补
      「2026-08-07 更新」段；A2（gap-worktreeinclude…）AC4 补「2026-08-07 更新」段——均写明：
      **复原路径 = 运行期单写入者（git worktree lock）+ A1（.gitignore 止血）+ A2（.worktreeinclude
      config 在位）三者叠加后重新接回。**

## Definition of Done

- [x] AC1-AC5 实跑输出贴进任务体（摘掉前后判红对照、复原条件文本）
      **已贴：** 上方 AC1/AC2/AC3 内嵌 measure 输出（assert_called=0、assert_script_kept=1、
      restore_condition=scripts/test.sh:2 + assert-clean-tree.sh:2）、摘掉前后判红对照（AC3）、
      复原条件文本（AC2 引用脚本头部原文）。
- [ ] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）——不再因脏树断言假红
      ——**DEFERRED（内层 scoped 验证：`scripts/test.sh --for-task <id>`，非全量套件）**；全量套件绿门
      归外层 verification-round gate（gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge）。

## Touches
- scripts/test.sh（run_selected 摘掉 assert-clean-tree 调用 + 复原条件）
- plugin/scripts/assert-clean-tree.sh（保留；可加复原条件注释）
- tasks/gap-r1-cannot-see-tests-writing-into-the-live-task-store.md（AC5 交叉标注）
- tasks/gap-gitignore-worktree-scratch-dirs-kills-round4-false-red.md（AC5 交叉标注）
- tasks/gap-worktreeinclude-declarative-copy-of-gitignored-config-into-worktrees.md（AC5 交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-07T15:2xZ
changed: 管理者 15:0x 裁定 + 实测：断言前提作废（三层并发写入）；排除表修补削弱唯一优点。
追加 2026-08-07 17:0x：人裁定「那这个断言就是错的。改了它或者删了它。」差量版单独不够。
追加 2026-08-07 17:1x：人裁定「修好困难就 disable/delete」。管理者成本收益悬殊（今晚 28 分钟 + 三轮
  分诊 vs 历史 1 次收益）+ 路径归因毁 R7 半边。**外层裁定：disable 非 delete**——摘掉全量套件路径调用、
  保留代码 + 差量版、写复原条件（验证 worktree 运行期单写入者时重新接回）。单写入者（③）成为未来
  复原路径。
