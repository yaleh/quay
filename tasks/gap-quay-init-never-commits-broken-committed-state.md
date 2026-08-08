---
id: gap-quay-init-never-commits-broken-committed-state
title: "quay-init lays files but NEVER commits (0 git add/commit hits) —
  consumer mechanism lives in uncommitted worktree, committed state
  self-consistency is luck (archguard: ready-pool-check committed, its 3 helpers
  never → broken fresh-clone); meta-cc 22 plugin/scripts uncommitted = same
  risk; fix: quay-init auto-commits (chore(quay-init): prefix) = delivery
  contract 铺设→版本→提交→升级"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**quay-init 铺文件但从不 commit——consumer 仓库机制默认活在未提交工作树（archguard 12:36 报告 + 外层独立验证 + B 机对照）**：

**现象（archguard）**：master 从干净检出是断的——提交 080c667 提交了 ready-pool-check.ts，但它 import 的
taskWorkLanded / checkTaskTouchesResolve / expandDeclaredTouches 三函数**从未提交**。机制能跑只因工作树有
未提交改动（+429 行）⇒ fresh-clone + checkout 拿到 broken 的 ready-pool-check。archguard 自裁处置
（提交地基 d9dbd75，16 文件 +2947 行）。

**根因（外层独立验证，非 archguard 操作失误）**：quay-init.sh 里 git add / git commit 命中 **0 次**
⇒ **quay-init 铺文件但从不 commit**。consumer 仓库的机制默认活在未提交工作树里，committed 态是否自洽
纯属运气——一旦机制脚本有依赖关系（ready-pool-check → 三 helper），就出现「提交了消费者、没提交依赖」。

**B 机对照更正（2026-08-05 13:3xZ，管理者实测）**：B 机（orangevps）从**干净 clone** 直接跑通
ready-pool-check（pool 22/floor 12/criterion_met true）+ resource-gate（GO）⇒ **quay 仓库自身的
committed 态是自洽的**。archguard 报的 broken committed 态属于 **quay-init 的铺设形态问题**（铺文件
但不 commit），**不是 quay 仓库的问题**——这个区分此前没有证据。本任务范围收紧为：quay-init 的
铺设行为（不 commit），不涉及 quay 仓库自身内容。

**同型风险（meta-cc 实测确认）**：meta-cc 46 处未提交改动，其中 22 处在 plugin/scripts。⇒ 不是孤例，
是 quay-init 交付形态的通病。meta-cc 停着，一旦重启/fresh-clone 同样可能拿到 broken committed 态。

**与升级通道同根**：quay-init 只管「把文件放下去」，不管「放下去之后处于什么状态」——不 commit（本条）、
不记版本（无 VERSION/package.json）、不提供升级路径（gap-delivery-surface-grows 已立案）。三者合成完整
交付契约：**铺设 → 版本标记 → 提交 → 可升级**。

**归属裁定（管理者建议 + 外层采纳）**：quay-init 自己提交（固定 commit message 前缀如
`chore(quay-init):`）——机制文件不是该项目产物，让项目 outer/inner commit 会让「谁改了机制」和「谁用了
机制」混在同一条历史；quay-init 提交让 git log 直接回答「装的是哪一版机制」（补无版本标记那条）。

### 选定机制

1. quay-init 铺完机制后**自动 commit**（固定前缀 `chore(quay-init):`），consumer 仓库 committed 态自洽
2. 若 consumer 仓库已有未提交改动（如 meta-cc 的 46 处），quay-init 检测并提示（不静默覆盖，与 delivery-surface AC3 一致）
3. 验证：fresh-clone consumer + quay-init ⇒ committed 态完整（ready-pool-check 依赖齐全，无 broken）

## Acceptance Criteria

- [x] AC1: quay-init 铺完机制自动 commit（`chore(quay-init):` 前缀），consumer 仓库 committed 态自洽
- [x] AC2: fresh-clone + quay-init ⇒ 机制完整（ready-pool-check 依赖齐全，无 broken committed 态，实测）
- [x] AC3: 已有未提交改动时 quay-init 不静默覆盖（提示 + 待确认）
- [x] AC4: 与 gap-delivery-surface-grows-but-target-freezes-no-upgrade 交叉标注（同根：交付契约 铺设→版本→提交→升级）
- [x] AC5: 记录 B 机对照——quay 仓库自身 committed 态自洽（干净 clone 跑通），本任务只修 quay-init 铺设形态

## Definition of Done

- [x] AC1-AC5 全勾（quay-init 铺完自动 commit `chore(quay-init):` 前缀；fresh-clone 机制完整无 broken committed 态；已有未提交改动不静默覆盖；与 delivery-surface-grows 交叉标注；B 机对照 quay 自身 committed 态自洽）
- [x] fresh-clone + quay-init 实测机制完整；已有改动时提示待确认
- [x] scoped 门 `scripts/test.sh --for-task gap-quay-init-never-commits-broken-committed-state` 绿（GATE EXIT=0，tests 5 / pass 5 / fail 0 / cancelled 0；task-contract-check strict-subset 无 violations）

## Touches

- plugin/scripts/quay-init.sh（铺完自动 commit + 冲突检测）
- plugin/test/quay-init-loop.test.mjs（AC1-AC3 测试）
- tasks/gap-delivery-surface-grows-but-target-freezes-no-upgrade.md（AC4 交叉标注）
- tasks/gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them.md（AC4 交叉标注）

## Contract

measure   committed_complete = `git -C <fresh-clone-consumer> log --oneline -3 2>&1 | grep -c 'chore(quay-init)'` stdout 数字段
band      committed_complete >= 1（quay-init 有自动提交记录）
invoke    `grep -n 'git add\|git commit' plugin/scripts/quay-init.sh`
control   fresh-clone + quay-init ⇒ committed 态完整（AC2）；已有未提交 ⇒ 提示不覆盖（AC3）
resume    自动 commit 与冲突检测分步提交，任一步完成即写盘

## Evidence（2026-08-08，`task/gap-quay-init-never-commits-broken-committed-state`）

**机制改动（`plugin/scripts/quay-init.sh`）**：新增 `auto_commit_laid_down()`——任一真实铺设 category
（`--loop`/`--workflows`/`--agents`/默认 `--all`）跑完后，若工作区是 git 仓库且有改动，则 stage **只限
本机件铺设的路径**（`.gitignore` / `.quay/config.yml` / `.quay/quay-init-state.json` / `plugin/scripts` /
`orchestration` / `docs/analysis` / `.claude/{workflows,agents}` / `tasks`，绝不 `git add -A`）并
`git commit -m "chore(quay-init): lay down quay plugin mechanism files (v<version>)"`。`.quay/runtime/`
bundle 已被 `ensure_runtime_gitignore` 写进 `.gitignore`（AC10），不入提交面。非 git 工作区 SKIP
（安装本身仍成功，exit 0）；`--dry-run` 不提交。

**AC3（已有未提交改动 ⇒ 提示 + 待确认）**：铺设前快照 `PRE_EXISTING_CHANGES`（`git status --porcelain`
vs HEAD）；有未提交改动时打印 WARNING + 列清单 + 显式声明「只 stage quay-init 铺设路径，预存改动留在工作
树」，默认只在 TTY 上 `read` 交互确认，非交互无 `--auto-commit-confirm` 时 **fail-closed 不提交**
（`DECLINED (non-interactive)`，exit 0——安装成功，提交环节被搁置）。`--auto-commit-confirm` / 
`--auto-commit-skip` 两个显式旗标。

**AC1/AC2/AC3 测试（`plugin/test/quay-init-loop.test.mjs`，新文件，`node:test` + `// @test-group product`，
5 用例）**：
```
✔ AC1 — quay-init --loop auto-commits the laid-down mechanisms with a chore(quay-init): prefix
✔ AC2 — a fresh clone of the committed state carries the FULL mechanism set (ready-pool-check and its helper modules together)
✔ AC3 — pre-existing uncommitted changes: quay-init detects + prompts; non-interactive declines, --auto-commit-confirm commits ONLY its own laid-down files
✔ AC1/control — a non-git workspace skips auto-commit but still lays the mechanisms down (exit 0)
✔ AC1/control — --dry-run never auto-commits
ℹ tests 5  ℹ pass 5  ℹ fail 0  ℹ cancelled 0
```
- AC1 实测：fresh git repo + `--loop` ⇒ `git log --oneline -3` 出现 `chore(quay-init)`，`git ls-files` 含
  `plugin/scripts/resource-gate.sh` / 两个 tick 文档 / `.quay/config.yml`，且不含 `quay/runtime/`。
- AC2 实测：`git clone` 该 committed 态后 `git ls-files` 同时含 `ready-pool-check.ts` + 它的三个 helper
  （`task-status-drift-check.ts`（taskWorkLanded）/ `touches-orthogonality-check.ts`（checkTaskTouchesResolve）/
  `concurrent-batch-scheduler.ts`（expandDeclaredTouches）），clone 工作树干净 ⇒ 无 broken committed 态。
- AC3 实测：预存未提交改动（untracked `notes.txt` + tracked `app.txt` 编辑）下，非交互运行 ⇒ `DECLINED
  (non-interactive)` + 无 chore commit + 两个预存改动原样保留；`--auto-commit-confirm` 重跑 ⇒ committed 70
  文件，`notes.txt`/`app.txt` 仍在 `git status`（未被卷进提交）。

**AC4 交叉标注**：`tasks/gap-delivery-surface-grows-but-target-freezes-no-upgrade.md` 与
`tasks/gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them.md` 各加
`## 交叉标注（AC4，gap-quay-init-never-commits-broken-committed-state，2026-08-08）`——交付契约
铺设→版本→提交→升级 三环分工（install-rewrites=铺设、delivery-surface=可升级、本条=提交；「版本标记」仍欠账）。

**AC5 B 机对照**：quay 仓库自身 committed 态自洽（干净 clone 跑通 ready-pool-check + resource-gate，管理者
实测已记录在本任务 Proposal）；本任务只修 quay-init 铺设形态（不 commit），不涉及 quay 仓库自身内容。

**前置修复（引用完整性，非本任务主线）**：develop 上 `quay-init --loop` 因 `verify_referenced_landed`
对 `orchestration/SPEC-inbox-service-2026-08-08.md`（`plugin/skills/manager/SKILL.md` 引用但未声明）fail-closed，
先于 auto-commit 退出。补 `<!-- reference-doc: orchestration/SPEC-inbox-service-2026-08-08.md -->` 到
`plugin/skills/init/SKILL.md`（reference-doc 声明，机制性修复），使 --loop 能跑完并触达 auto-commit。
该 SPEC 无在飞任务持有此声明（`gap-outer-message-bus-needs-file-inbox-transport` 的 Touches 不含
init/SKILL.md）。

**scoped 门**：`bash scripts/test.sh --for-task gap-quay-init-never-commits-broken-committed-state --allow-thin`
GATE EXIT=0；scoped static（test-framework-policy / test-isolation(44 基线) / test-impl-census(272 clean) /
task-contract strict-subset 无 violation / adr016 / dead-code-after-return）全过；tests 5 / pass 5 / fail 0 /
cancelled 0。

## Dispatch review

reviewer: none
at: 2026-08-05T18:2xZ
changed: contract-ratchet compliance，外层 18:2xZ 补齐（未审）
