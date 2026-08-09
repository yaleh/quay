---
id: gap-gitignore-worktree-scratch-dirs-kills-round4-false-red
title: "One-line .gitignore fix: .quay-worktree-local* / .quay-wtl* are NOT
  gitignored (git check-ignore confirms all three un-ignored while
  .claude/worktrees is ignored) — round-4's 2991 tests fail 0 red was ENTIRELY
  these untracked dirs tripping the suite-after dirty-tree assertion; Claude
  Code official worktree requirement is exactly 'Add .claude/worktrees/ to your
  .gitignore'; add one gitignore line, no more exclusion-table entries (B task
  fixes the assertion mechanism shape)"
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

**一行 .gitignore，消掉第四轮那次假红。** 管理者实测（2026-08-07 15:0x）：`.quay-worktree-local` /
`.quay-worktree-local2` / `.quay-wtl3` **未被 gitignore**（`git check-ignore` 三者均"未忽略"，而
`.claude/worktrees` 已忽略）。第四轮 2991 用例 fail 0，红的全部原因就是这几个未跟踪目录触发 suite-after
脏树断言。Claude Code 官方文档对 worktree 的唯一配套要求正是：「Add `.claude/worktrees/` to your
.gitignore so worktree contents don't appear as untracked files in your main checkout」——同款加
.gitignore 一行即可，**不需要再往排除表（assert-clean-tree）里加条目**（B 类任务另修断言机制形状）。

这些目录是本仓验证/收尾在 worktree 内保存协调脚手架时产生的（外层建 worktree 时把 .quay 换软链、旧
数据挪到 .quay-worktree-*）；它们不是测试产物，不该让 suite-after 脏树断言背锅。

## Contract

measure worktree_scratch_ignored = `git check-ignore -v .quay-worktree-local .quay-worktree-local2 .quay-wtl3 2>/dev/null | wc -l` stdout 数字段（应 = 3，三者都忽略）
band worktree_scratch_ignored = 3（三目录全部被 gitignore）
invoke `git check-ignore -v .quay-worktree-local .quay-worktree-local2 .quay-wtl3`
control 人为在 worktree 建 .quay-worktree-local 目录 ⇒ git status 不再显示为 ??（被忽略）；suite-after 脏树断言不再因它们红
resume 若中断，先跑 measure 读当前忽略状态

## Acceptance Criteria

- [x] AC1: `.gitignore` 加一行覆盖 `.quay-worktree-local*` / `.quay-wtl*`（模式如 `**/.quay-worktree-local*/` 与 `**/.quay-wtl*/` 或合并写法），`git check-ignore` 三者全过
      **实跑（2026-08-07，内层 worktree 执行）：** `.gitignore` 新增
      `**/.quay-worktree-local*` 与 `**/.quay-wtl*`（无尾斜杠——`git check-ignore` 需在
      路径不存在时也匹配，Contract measure 才算 3；尾斜杠目录限定形式在路径缺失时返回 0）。
      `git check-ignore -v .quay-worktree-local .quay-worktree-local2 .quay-wtl3` 输出：
      ```
      .gitignore:39:**/.quay-worktree-local*	.quay-worktree-local
      .gitignore:39:**/.quay-worktree-local*	.quay-worktree-local2
      .gitignore:40:**/.quay-wtl*	.quay-wtl3
      ```
      `| wc -l` = 3（三目录全部被忽略）。已验证无已跟踪文件匹配该模式（`git ls-files | grep -E
      "\.quay-worktree-local|\.quay-wtl"` 为空）。
- [x] AC2: 负控制——在 worktree 建这些目录，`git status --porcelain` 不显示它们（不再触发 suite-after 脏树断言）
      **实跑（2026-08-07）：**
      ```
      $ mkdir -p .quay-worktree-local .quay-worktree-local2 .quay-wtl3 && touch .quay-worktree-local/marker .quay-worktree-local2/marker .quay-wtl3/marker
      $ git status --porcelain
       M .gitignore        # 仅预期改动；三个 scratch 目录均不出现
      ```
      真残留负控制：`touch .stray-residue-xyz` ⇒ `git status --porcelain` 仍显示
      `?? .stray-residue-xyz`（gitignore 不误吞真实残留）。
- [x] AC3: 与 gap-assert-clean-tree-premise-void-under-concurrent-writers（B 类任务）交叉标注——本任务是止血（gitignore），B 是根治（断言改差量/单写入者）
      **交叉标注（双向）：** B 侧 `gap-assert-clean-tree-premise-void-under-concurrent-writers.md`
      的 AC4 已列出本任务（A1，gitignore 止血）。本侧确认：A1 的 .gitignore 一行已落地并实跑验证
      （AC1/AC2）；B 是断言机制形态的根治（差量快照或 worktree lock），A 不替代 B。B 文件已存在
      （status: ready），已在本任务 Touches 内交叉引用。
      **2026-08-07 更新（B 被 disable，非根治）：** 人 17:1x 裁定 B 前提作废、外层裁定 disable 非 delete——
      B 的调用已从全量套件路径摘掉（不再参与判红），代码保留。**复原路径 = 单写入者 + A1 + A2 叠加**：
      (1) 验证 worktree 运行期单写入者达成（`git worktree lock`）——B 的前提恢复；(2) A1 的 .gitignore
      止血（scratch 目录不再假红）+ A2 的 .worktreeinclude（config.yml 在位）——worktree 环境两个前提
      齐备。三者叠加后重新接回 B。A1 的 .gitignore 行继续保留，是复原环境的一部分。

## Definition of Done

- [x] AC1-AC3 实跑输出贴进任务体（check-ignore 输出 + git status 负控制）
      **已贴：** AC1/AC2 内嵌 `git check-ignore -v` 输出（3 行，count=3）与负控制
      `git status --porcelain`（仅 ` M .gitignore`，scratch 目录不出现）；真残留负控制
      `?? .stray-residue-xyz` 仍显示。
- [x] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）
      **证据（2026-08-08）：** 外层验证 round 120/123/125 连跑绿——laneCount 8、canonical
      全量套件闸，full-suite.log 三阶段 TAP 均 fail 0 / cancelled 0（main 2792 / serial 42 /
      lowconc 186，总 3020 tests，skipped 45）。gitignore 修复（7d410a50b，2026-08-07）
      在这些 round 全程生效，scratch 目录不再触发 suite-after 脏树假红。
      **本任务 worktree 复验（`gitignore-scratch`，scratch 目录 `.quay-worktree-local/`
      `.quay-worktree-local2/` `.quay-wtl3/` 在位）：** `git check-ignore -v` count=3；
      `git status --porcelain` 全程干净；真残留 `.stray-residue-xyz` 仍显示 `??`。
      scoped gate（`bash scripts/test.sh --for-task gap-gitignore-worktree-scratch-dirs-kills-round4-false-red
      --allow-thin`）EXIT=0，task-contract-check strict-subset 对两个 touched 任务文件 0 violation。
      **环境约束（如实记录，为什么不用任务 worktree 自身的全量跑作 DoD 证据）：** 裸 worktree
      fork develop 缺少 gitignored 运行时态（`.quay/config.yml` 等），gate 类测试
      `Error: no .quay/config.yml found` 失败（实测并发-8 主相 73 fail / cancelled 0）——这是
      worktree 环境局限（非 gitignore 缺陷，与 scratch 目录无关）；canonical 全量套件闸由外层
      验证 round 在 integration checkout（运行时态齐备）上执行并保持绿。

## Touches
- .gitignore（加 worktree 脚手架忽略行）
- tasks/gap-assert-clean-tree-premise-void-under-concurrent-writers.md（AC3 交叉标注，若已立）

## Dispatch review

reviewer: outer
at: 2026-08-07T15:2xZ
changed: 管理者 15:0x 裁定 + 实测：.quay-worktree-local* 未忽略致第四轮假红。官方 worktree 配套要求
  （.gitignore 忽略 worktree 内容）。一行止血，B 类任务根治断言机制。
