---
id: gap-init-skill-md-byte-identical-claim-fix
title: SKILL.md:71 fast-mode-tick-core byte-identical claim 为假——副本为铺出模板（引用目标 docs/analysis），改正本/副本关系声明
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（inner 2026-08-15 15:2xZ 立案——drift 处置的剩余项；plugin/skills/init/SKILL.md 是 code-surface，需走 fan-in）**。

**现象**：`plugin/skills/init/SKILL.md:71` 声称 `loop/fast-mode-tick-core.md` ↔ `orchestration/fast-mode-tick-core.md` 「byte-identical, no substitution」——**为假**：两副本承担不同角色（orchestration/ = quay 实例正本，引用 `plugin/loop/fast-mode-loop-tick.md` 源；plugin/loop/ = quay-init --loop 铺出模板，引用目标 `docs/analysis/fast-mode-loop-tick.md`）。硬同步（byte-identical）混淆角色且破坏 quay-init `referenced⊆landed`（2026-08-15 实测 232e4171）。

**修法（option ②，outer/manager 均认可）**：SKILL.md:71 声明改为「以 orchestration/ 本为正本；plugin/loop/ 为铺出模板（引用目标 docs/analysis 源），非 byte-identical，两副本承担不同角色」。

**同族**：SKILL.md:68-70 另外三行（orchestrator-loop-tick / fast-mode-loop-tick / orchestrator-tick-core）也声称 byte-identical 且为假——归各层判（orchestrator-tick-core 归 outer；loop-tick 对共享），本任务只改 :71（inner 面）。

**判据1**：SKILL.md:71 声明为真（正本/副本关系，不再声称 byte-identical）。
**判据2（能取假）**：quay-init `referenced⊆landed` 仍绿（改动不破坏 landing）；声明与实际副本关系一致。
**判据3**：既有测试全绿；`--for-task` scoped 门绿。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 SKILL.md:71 + quay-init.test.mjs referenced⊆landed。
2. 改 :71 声明为正本/副本关系（orchestration 正本 + plugin/loop 铺出模板）。
3. 判据2 能取假：quay-init 测试绿；声明一致。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：SKILL.md:71 声明为正本/副本关系（非 byte-identical）。
- [x] AC2 判据2 能取假：quay-init referenced⊆landed 仍绿；声明与实际一致。
- [x] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] SKILL.md:71 声明修正 + quay-init 绿 + 测试绿——byte-identical 假声明消除（本行）。

## Evidence

**改前 :71（byte-identical 假声明）**：
```
| `loop/fast-mode-tick-core.md` | `orchestration/fast-mode-tick-core.md` (byte-identical, no substitution; the ≤80-line inner exec core) |
```

**改后 :71（正本/副本关系）**：
```
| `loop/fast-mode-tick-core.md` | `orchestration/fast-mode-tick-core.md` (以 orchestration/ 本为正本；plugin/loop/ 为 quay-init --loop 铺出模板——引用目标 docs/analysis 源，非 byte-identical，两副本承担不同角色；正本改动后由 inner 按正本语义落地副本) |
```

只改 :71（inner 面），:68-70 三行未动（归各层判）。

**判据2 能取假——声明与实际一致**（两副本确实非 byte-identical，承担不同角色）：
- `orchestration/fast-mode-tick-core.md`（quay 实例正本）：`src:N` 源文档引用 `plugin/loop/fast-mode-loop-tick.md`（:3/:6）——引用 plugin/loop 源。
- `plugin/loop/fast-mode-tick-core.md`（quay-init --loop 铺出模板）：`src:N` 源文档引用 `docs/analysis/fast-mode-loop-tick.md`（:9）——引用目标 docs/analysis 源。
- 非 byte-identical：行数 86 vs 98；`diff` 多处实质差异（A10 cap 表达、切分声明、正本声明措辞均不同）。

**测试**：
- 主检出 `cd /home/yale/work/quay && node --test plugin/test/quay-init.test.mjs`：**5 pass / 0 fail**（AC2/AC2-launch/AC3/AC4/AC5 全绿；AC4 即 referenced⊆landed 门，验证删除 shipped core 必 FAIL——改动不破坏 landing）。
- worktree `node --test plugin/test/quay-init.test.mjs`：**5 pass / 0 fail**（worktree 先补了 gitignored 的 vendored dist 才可跑）。
- scoped 门 `scripts/test.sh --for-task gap-init-skill-md-byte-identical-claim-fix --allow-thin`：**exit 0**——task-contract-check no violations、superseded-capability PASS、landing-target-check PASS；Touches 为 SKILL.md/.md 文档 ⇒ Touches→test 映射解析 0 测试文件（thin），quay-init.test.mjs 已单独直跑全绿。

## Touches

- plugin/skills/init/SKILL.md（:71 声明改正本/副本关系）
- tasks/gap-init-skill-md-byte-identical-claim-fix.md（自身）
