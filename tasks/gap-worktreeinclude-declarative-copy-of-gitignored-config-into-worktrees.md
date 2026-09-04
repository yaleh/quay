---
id: gap-worktreeinclude-declarative-copy-of-gitignored-config-into-worktrees
title: "Build .worktreeinclude — official declarative mechanism (gitignore
  syntax) to copy gitignored files (.quay/config.yml etc.) into every new
  worktree; this repo has none (ls confirms absent); round-5's 72 file crashes
  root cause was .quay/config.yml missing from the verification worktree (Error:
  Cannot find repo root: no .quay/config.yml found upward, ×15); hand-copying
  misses, declarative doesn't"
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

- [x] AC1: `.worktreeinclude` 存在，声明 `.quay/config.yml`（.gitignore 语法）
      **实跑（2026-08-07，内层 worktree）：** `.worktreeinclude` 已建（gitignore 语法，repo 根）。
      内容声明两个 gitignored 类：
      ```
      /.quay/config.yml
      /plugin/vendor/*/dist/*.js
      ```
      `.quay/config.yml` 在 .gitignore 第 135 行（`/.quay/config.yml`）确认 gitignored。
- [x] AC2: 新 worktree 创建后自动含 config.yml——`git worktree add` + worktree-include 流程后
      `.quay/config.yml` 在位（隔离验证：临时 worktree 实测）
      **实跑（2026-08-07）：** `git worktree add --detach /tmp/quay-wt-include-test HEAD`
      （HEAD = 本机制提交 2dbd1b4f，`.worktreeinclude` 与 `scripts/worktree-include.sh` 均在）。
      复制前 `ls /tmp/quay-wt-include-test/.quay/config.yml` → ABSENT（正是 round-5 缺口）。随后
      `bash scripts/worktree-include.sh /tmp/quay-wt-include-test` 输出：
      ```
      worktree-include: copied .quay/config.yml -> /tmp/quay-wt-include-test/.quay/config.yml
      worktree-include: copied plugin/vendor/quay-native/dist/quay-native.js -> /tmp/quay-wt-include-test/plugin/vendor/quay-native/dist/quay-native.js
      worktree-include: copied plugin/vendor/quay/dist/quay.js -> /tmp/quay-wt-include-test/plugin/vendor/quay/dist/quay.js
      worktree-include: done — 3 file(s) copied into /tmp/quay-wt-include-test
      ```
      复制后 `.quay/config.yml` 在位（9593 bytes）、两个 vendor dist 在位。机制证明：脚本输出即证据。
- [x] AC3: **负控制/回归**——第五轮那种 72 文件崩溃不再发生：新 worktree 里测试能解析 repo root
      （`Cannot find repo root` 错误不再出现）
      **实跑（2026-08-07）：** 在 `/tmp/quay-wt-include-test/plugin/test`（round-5 崩溃的相同相对
      路径）复跑 run-identity.test.mjs 的 `_findRepoRoot`（向上找 `.quay/config.yml`）：
      ```
      REPO_ROOT resolved: /tmp/quay-wt-include-test
      AC3 PASS — no Cannot-find-repo-root error
      ```
      另一负控制（task Contract）：config.yml 声明了但**不在 gitignore 白名单**时不被复制——临时仓
      复测，`.worktreeinclude` 声明 `/.quay/config.yml` 但 .gitignore 不含它，脚本输出
      `nothing to copy (0 files declared AND gitignored)`，worktree 内无 config.yml（正确）。
- [x] AC4: 与 gap-gitignore-worktree-scratch-dirs-kills-round4-false-red（A1，gitignore 止血）、
      gap-assert-clean-tree-premise-void-under-concurrent-writers（B，断言差量化）交叉标注——A2 是
      "worktree 内缺 gitignored 文件"这一族的声明式根治
      **交叉标注已落地：** A1/B 任务体各加一行确认注记（见下方"交叉标注"）。B 任务体原有反向引用
      （"若验证移入 worktree，A2 的 .worktreeinclude 保证 config.yml 在位"）与本任务一致。
      **2026-08-07 更新（B 被 disable，复原路径含 A2）：** 人 17:1x 裁定 B 前提作废、外层裁定 disable
      非 delete——B 的调用已从全量套件路径摘掉，代码保留。**复原路径 = 单写入者 + A1 + A2 叠加**：
      (1) 验证 worktree 运行期单写入者达成（`git worktree lock`）→ B 的前提恢复；(2) A1 的 .gitignore
      （scratch 目录不假红）+ A2 的 .worktreeinclude（验证 worktree 内 config.yml 在位、repo root 可解析）
      → worktree 环境前提齐备。三者叠加后重新接回 B。A2 的 `.worktreeinclude` + `worktree-include.sh`
      继续保留，是复原环境的一部分。

## Definition of Done

- [x] AC1-AC4 实跑输出贴进任务体（含新 worktree config.yml 在位 + repo root 可解析）
      ——上方 AC1-AC3 已贴真实输出；A1/B 交叉注记已加。
- [ ] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）
      ——**DEFERRED（内层 scoped 验证：`scripts/test.sh --for-task <id>`，非全量套件）**；机制本身
      在临时 worktree 上端到端验证（AC2/AC3）。全量套件绿门归外层 verification-round gate，非内层
      实跑范围。

## 交叉标注

- → gap-gitignore-worktree-scratch-dirs-kills-round4-false-red（A1）：本任务（A2）已落地声明式机制
  ——`.worktreeinclude`（gitignore 语法）+ `scripts/worktree-include.sh`。A1 解决 worktree 脚手架
  **目录**被 git status 视为未跟踪（假红族），A2 解决 worktree **内缺 gitignored 必需文件**
  （config.yml 缺失 → 真红族）；同一"gitignored/未跟踪"族的两面。
- → gap-assert-clean-tree-premise-void-under-concurrent-writers（B）：B 的差量断言在共享检出运行；
  若验证移入 worktree，A2 的 `.worktreeinclude` 保证 `.quay/config.yml` 在位——与 B 任务体原有反向
  引用一致（其"交叉标注"段已列本任务）。

## 执行记录 (inner 2026-08-07)

**measure worktreeinclude_exists** = `ls .worktreeinclude | wc -l` → **1**（band=1 ✓）
**measure new_worktree_has_config** = `ls /tmp/quay-wt-include-test/.quay/config.yml | wc -l` → **1**
（临时 worktree 复制后 ✓）
**invoke** = `ls .worktreeinclude && bash scripts/worktree-include.sh /tmp/quay-wt-include-test; ls /tmp/quay-wt-include-test/.quay/config.yml` → 声明存在 + 复制 3 文件 + config.yml 在位 ✓
**control** = ①新 worktree 自动含 config.yml（实测 ✓，无需手搓复制）；②config.yml 声明但不在 gitignore
白名单时不被复制（临时仓实测：`nothing to copy (0 files declared AND gitignored)` ✓）

**机制文件（worktree 分支提交 2dbd1b4f）：**
- `.worktreeinclude`（新建，gitignore 语法声明 `/.quay/config.yml` + `/plugin/vendor/*/dist/*.js`）
- `scripts/worktree-include.sh`（新建；主检出解析 = `git worktree list` 首条目——git≥2.53 无
  `main true` 标记；匹配 = 临时仓唯一 .gitignore 即声明，走 git 自身 check-ignore；复制集 =
  声明 ∩ gitignored；node_modules 恒排除）
- `plugin/skills/loop-driver/SKILL.md` step 3（isolate）补 `.worktreeinclude` 声明式机制说明

## Touches
- .worktreeinclude（新建，声明 .quay/config.yml）
- scripts/worktree-include.sh（新建；或等价接入点，git worktree add 后复制流程）
- plugin/skills/loop-driver/SKILL.md（本仓 worktree 创建文档，step 3 isolate）
- tasks/gap-gitignore-worktree-scratch-dirs-kills-round4-false-red.md（AC4 交叉标注）
- tasks/gap-assert-clean-tree-premise-void-under-concurrent-writers.md（AC4 交叉标注，若已立）

## Dispatch review

reviewer: outer
at: 2026-08-07T15:2xZ
changed: 管理者 15:0x 裁定 + 实测：本仓无 .worktreeinclude；第五轮 72 崩溃根因 = config.yml 没进验证
  worktree（Cannot find repo root ×15）。官方声明式机制，替代手搓复制。
