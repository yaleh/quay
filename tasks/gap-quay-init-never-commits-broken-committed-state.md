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

- [ ] AC1: quay-init 铺完机制自动 commit（`chore(quay-init):` 前缀），consumer 仓库 committed 态自洽
- [ ] AC2: fresh-clone + quay-init ⇒ 机制完整（ready-pool-check 依赖齐全，无 broken committed 态，实测）
- [ ] AC3: 已有未提交改动时 quay-init 不静默覆盖（提示 + 待确认）
- [ ] AC4: 与 gap-delivery-surface-grows-but-target-freezes-no-upgrade 交叉标注（同根：交付契约 铺设→版本→提交→升级）
- [ ] AC5: 记录 B 机对照——quay 仓库自身 committed 态自洽（干净 clone 跑通），本任务只修 quay-init 铺设形态

## Definition of Done

- [ ] AC1-AC5 全勾（quay-init 铺完自动 commit `chore(quay-init):` 前缀；fresh-clone 机制完整无 broken committed 态；已有未提交改动不静默覆盖；与 delivery-surface-grows 交叉标注；B 机对照 quay 自身 committed 态自洽）
- [ ] fresh-clone + quay-init 实测机制完整；已有改动时提示待确认
- [ ] scoped 门 `scripts/test.sh --for-task gap-quay-init-never-commits-broken-committed-state` 绿

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
## Dispatch review

reviewer: none
at: 2026-08-05T18:2xZ
changed: contract-ratchet compliance，外层 18:2xZ 补齐（未审）
