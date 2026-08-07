---
id: gap-worktreeinclude-declarative-copy-of-gitignored-config-into-worktrees
title: "Build .worktreeinclude — official declarative mechanism (gitignore
  syntax) to copy gitignored files (.quay/config.yml etc.) into every new
  worktree; this repo has none (ls confirms absent); round-5's 72 file crashes
  root cause was .quay/config.yml missing from the verification worktree (Error:
  Cannot find repo root: no .quay/config.yml found upward, ×15); hand-copying
  misses, declarative doesn't"
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

**建 `.worktreeinclude`——官方声明式机制，让 gitignored 的必需文件（.quay/config.yml 等）随新
worktree 自动复制。** 管理者实测（2026-08-07 15:0x）：本仓库**没有这个文件**（`ls` 实测不存在）。
第五轮 72 个文件崩溃的根因正是 **.quay/config.yml 没进验证 worktree**（真错文本：
`Error: Cannot find repo root: no .quay/config.yml found upward from /tmp/quay-suite-int/plugin/test`，
15 次）。config.yml 是 gitignored（`/.quay/config.yml`），git worktree add 不复制 gitignored 文件，
外层手搓复制会漏（今晚就漏了，第四轮干净、第五轮崩）。

**官方机制**：`.worktreeinclude` 用 .gitignore 语法声明哪些 gitignored 文件要被复制进每个新
worktree（官方例子：`.env` / `config/secrets.json`）。声明式不会漏。

### 修复方向（实现归内层定）

1. 建 `.worktreeinclude` 文件（.gitignore 语法列出要复制进 worktree 的 gitignored 文件，至少
   `.quay/config.yml`）；
2. 接入 worktree 创建流程（quay 自己的 worktree 创建脚本/文档——`git worktree add` 后按
   .worktreeinclude 复制）；若官方 CLI 无直接支持，自建一个脚本（如 `worktree-include.sh`）在
   `git worktree add` 后执行；
3. 本仓验证 worktree（外层 /tmp/quay-suite-int 类）不再手搓复制 config.yml。

## Contract

measure worktreeinclude_exists = `ls .worktreeinclude 2>/dev/null | wc -l` stdout 数字段（应 = 1）
measure new_worktree_has_config = `ls /tmp/quay-wt-include-test/.quay/config.yml 2>/dev/null | wc -l` stdout 数字段（用临时 worktree 验证，应 = 1）
band worktreeinclude_exists = 1（机制存在）
invoke `ls .worktreeinclude && bash scripts/worktree-include.sh /tmp/quay-wt-include-test 2>/dev/null; ls /tmp/quay-wt-include-test/.quay/config.yml`
control 新 worktree 创建后自动含 config.yml（无需手搓复制）；config.yml 不在 gitignore 白名单时不被复制
resume 若中断，先跑 measure 读 .worktreeinclude 是否存在

## Acceptance Criteria

- [ ] AC1: `.worktreeinclude` 存在，声明 `.quay/config.yml`（.gitignore 语法）
- [ ] AC2: 新 worktree 创建后自动含 config.yml——`git worktree add` + worktree-include 流程后
      `.quay/config.yml` 在位（隔离验证：临时 worktree 实测）
- [ ] AC3: **负控制/回归**——第五轮那种 72 文件崩溃不再发生：新 worktree 里测试能解析 repo root
      （`Cannot find repo root` 错误不再出现）
- [ ] AC4: 与 gap-gitignore-worktree-scratch-dirs-kills-round4-false-red（A1，gitignore 止血）、
      gap-assert-clean-tree-premise-void-under-concurrent-writers（B，断言差量化）交叉标注——A2 是
      "worktree 内缺 gitignored 文件"这一族的声明式根治

## Definition of Done

- [ ] AC1-AC4 实跑输出贴进任务体（含新 worktree config.yml 在位 + repo root 可解析）
- [ ] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）

## Touches
- .worktreeinclude（新建，声明 .quay/config.yml）
- scripts/worktree-include.sh 或等价接入点（git worktree add 后复制流程）
- 本仓 worktree 创建文档/脚本（外层验证 worktree 流程）
- tasks/gap-gitignore-worktree-scratch-dirs-kills-round4-false-red.md（AC4 交叉标注）
- tasks/gap-assert-clean-tree-premise-void-under-concurrent-writers.md（AC4 交叉标注，若已立）

## Dispatch review

reviewer: outer
at: 2026-08-07T15:2xZ
changed: 管理者 15:0x 裁定 + 实测：本仓无 .worktreeinclude；第五轮 72 崩溃根因 = config.yml 没进验证
  worktree（Cannot find repo root ×15）。官方声明式机制，替代手搓复制。
