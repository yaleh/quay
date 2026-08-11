---
id: gap-quay-last-pane-txt-untracked-dirties-tree
title: .quay/last-pane.txt (tick-doc §1 artifact) is un-gitignored → dirties
  tree; assert-clean-tree (suite-after, any porcelain) vs tree-hygiene-check
  (known patterns only) diverge on "clean"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
## Finding

`.quay/last-pane.txt`（**tick 文档 §1 observe 的产物**：`tmux capture-pane -p -t "$TMUX_SESSION" > .quay/last-pane.txt`，orchestrator-loop-tick.md 3 处 / fast-mode-loop-tick.md 2 处）**未被 gitignore**，默认弄脏工作树；而两个检查器对"干净"的定义不一致，其中一个会在全量套件之后判脏。

## 实测（2026-08-06 19:17Z）

1. **`.quay/` 的 gitignore 是逐文件/逐目录枚举**（19 条规则），**无目录级默认**——每新增一个运行时文件都默认脏，直到有人补第 20 条。
2. `.quay/` 下 20 项：17 项被忽略，3 项不被忽略——`manager-inbox` / `prepare-epochs` 是**已跟踪**协调状态（有意），但 `.quay/last-pane.txt`（未跟踪，mtime 19:07:38）与 `.quay/experiments`（未跟踪）**未跟踪且未忽略**，正在弄脏工作树。
3. **两个检查器不一致**：
   - `tree-hygiene-check.sh` 实跑报 clean（exit 0）——它只 flag **KNOWN SCRATCH patterns**（第 21 行清单），`last-pane.txt` 不在清单里。
   - `assert-clean-tree.sh:46` 用 `git status --porcelain` **非空即 exit 1**（`--porcelain` 默认含未跟踪项）——它自述是「the suite-AFTER assertion: after a FULL-SUITE run」，**每次全量套件后都跑**。
4. **不夸大因果**：`last-pane.txt` mtime 19:07:38，套件 18:47:46 结束——它**没有**造成本次红；但机制对**下一次**成立。

## 为什么值得修（不只是卫生）

`publish-dist-branch.sh` 也依赖树干净，且它在发布路径上（AC16 GitHub release）。套件后判脏 + 发布路径依赖干净 = 一个被 tick 文档自己产出的未忽略文件可以打断两条链。

## 来源

`last-pane.txt` 是**手写命令的产物**（tick 文档 §1 observe 的命令），不是任何 plugin 脚本写的（`grep` 零命中）。它是文档化 tick 步骤的输出，落点在未忽略的 `.quay/` 下。

## 修复方向（接法留执行时）

1. **gitignore 补规则**：把 `.quay/last-pane.txt`（及同类 tick 运行时产物）加进 `.gitignore` 枚举。
2. **检查器口径对齐**：`assert-clean-tree.sh` 的 suite-after 断言要么把已知 scratch（last-pane）列入豁免，要么两个检查器共享同一个"干净"定义（`tree-hygiene-check` 的 KNOWN SCRATCH 清单应是唯一来源）。
3. 或改产物落点：tick §1 observe 写到 gitignored 位置（如 `/tmp` 或 `.quay/.scratch/`）。

## AC（draft）

- [x] `git status --porcelain` 在 tick §1 observe 后干净（last-pane.txt 不再显示为 untracked）
      —— `.gitignore` 现含 `**/.quay/last-pane.txt`（sibling gap b292ddb2 已加）**及同类 tick 产物
      `**/.quay/last-outer-pane.txt`（本任务补，orchestrator-loop-tick.md:739 管理者盯外层的
      capture-pane 写入）。实测：构造两文件 ⇒ `git status --porcelain` 空、`git check-ignore` 两文件全命中。
- [x] `tree-hygiene-check.sh` 与 `assert-clean-tree.sh` 对同一工作树给出**一致**的 clean/dirty 结论
      —— 两检查器都读 `git status --porcelain`；gitignore 让 pane 产物对 porcelain 不可见 ⇒ 两者对
      同一树同判。实测：两 pane 文件存在时 `tree-hygiene-check` exit 0（clean）、`assert-clean-tree --check`
      exit 0（DELTA PASS）。
- [x] 负控制：构造 last-pane.txt 存在 ⇒ 两个检查器都判干净（或都判脏），不一致即失败
      —— 实测：仅 pane 文件（无其它 dirt）⇒ `tree-hygiene-check` clean exit 0、`assert-clean-tree`
      DELTA PASS exit 0（两检查器都判干净）；修前对照（gitignore 移除时）`?? .quay/last-outer-pane.txt`
      使 tree-hygiene clean 而 assert-clean-tree FAIL exit 1 —— 正是本任务记录的 divergence。

## DoD（draft）

- [ ] 一次 tick §1 observe + 全量套件后 `git status --porcelain` 干净
- [ ] `assert-clean-tree.sh` 不再因 last-pane.txt 假红
- [ ] 完整套件绿

## Cross-annotation（2026-08-07）

`gap-manager-tick-log-append-trips-suite-after-dirty-tree-assertion`（已执行）把 `.quay/*` 未跟踪项列入
**suite-after 断言（assert-clean-tree.sh）的已知并发写入者豁免**——对 last-pane.txt 这一具体类，两检查器已对齐：
`assert-clean-tree.sh` 对 `?? .quay/last-pane.txt` 判 PASS（排除），`tree-hygiene-check.sh` 本就判 clean。
本任务剩余工作收窄为：gitignore 补规则（last-pane.txt 及同类 tick 运行时产物）+ 可选「两检查器共享 KNOWN SCRATCH 单一来源」。
参考本任务的实测：STEP 3（`?? .quay/last-pane.txt` 存在时 assert-clean-tree PASS）已在
`tasks/gap-manager-tick-log-append-trips-suite-after-dirty-tree-assertion.md` 记录。

## Evidence

- `git check-ignore .quay/last-pane.txt` = 未忽略；`git status --porcelain` 显示 `?? .quay/last-pane.txt`
- `assert-clean-tree.sh:46`：`dirty="$(git status --porcelain)"; if [ -n "$dirty" ]`
- `tree-hygiene-check.sh:21-22`：KNOWN SCRATCH patterns 清单（last-pane 不在）
- 两 tick 文档共 5 处 `last-pane.txt` 写入命令

## Touches

- tasks/gap-quay-last-pane-txt-untracked-dirties-tree.md（自身文件：self-touch，2026-08-10 outer 补——缺此条被 C8 拒派发，见 touches-orthogonality-check --self-touch-scan）
- .gitignore（补 `**/.quay/last-outer-pane.txt` —— last-pane.txt 的同类 tick §1 observe 产物；last-pane.txt 本身已由 sibling gap b292ddb2 加）
- plugin/test/gitignore.test.mjs（guard test 扩展：RUNTIME_STATE_FILES 5→6，纳入 last-outer-pane.txt，维持 per-file gitignore 可执行不变量）

## Execution evidence（2026-08-11，worktree `quay-worktrees/gap-quay-last-pane-txt-untracked-dirties-tree`）

**实现**

- `.gitignore`：在 `**/.quay/last-pane.txt` 行后新增 `**/.quay/last-outer-pane.txt`（带注释，标注
  orchestrator-loop-tick.md:739 「管理者盯外层」AC5 capture-pane 写入，同一运行时状态族）。
- `plugin/test/gitignore.test.mjs`：RUNTIME_STATE_FILES 数组 5→6（加入 `.quay/last-outer-pane.txt`），
  测试名/注释同步 5→6。修前此 guard 只守 5 条 per-file 规则，新同类文件会静默漏过。

**scoped 套件（`scripts/test.sh --for-task gap-quay-last-pane-txt-untracked-dirties-tree --allow-thin`）**

- 选择器：0 test file(s)（thin，任务 Touches 原只有 self-file）——scoped 静态层全绿：
  task-contract-check（strict-subset，0 violations）/ superseded-capability-check（PASS）/
  tick-core-static-check（AC3 100%、AC4/AC5/AC6 OK）⇒ **EXIT 0**。
- 显式跑 guard test（`scripts/test.sh plugin/test/gitignore.test.mjs`）：`✔ AC2 — all 6 runtime-state
  files are gitignored`（1 pass / 0 fail / 0 cancelled）⇒ **EXIT 0**；checker-mutation-check 全绿
  （22 checkers，0 uncovered）。

**手工验证（负控制）**

- 隔离 temp git repo（自含 tree-hygiene-check 副本）：构造 `.quay/last-pane.txt` + `.quay/last-outer-pane.txt`
  且 gitignore 含两规则 ⇒ `git status --porcelain` 空、`tree-hygiene-check` clean exit 0、
  `assert-clean-tree` absolute PASS exit 0、DELTA PASS exit 0 —— **两检查器一致判干净**。
- 修前对照（移除 gitignore 规则时）：`?? .quay/last-outer-pane.txt` ⇒ `tree-hygiene-check` clean exit 0
  而 `assert-clean-tree` absolute FAIL exit 1 —— 正是本任务 Finding 记录的 divergence（同类文件复现）。
