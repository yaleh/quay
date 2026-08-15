---
id: gap-direct-to-develop-exclude-manager-skill-granularity
title: direct-to-develop-bypass-check 排除集加 plugin/skills/manager/**（manager 独占 + 走不了 fan-in 路，同 .claude/ 理由）——⛔ 排除粒度到 manager/**，不掩 init/SKILL.md 真红
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-direct-to-develop-bypasses-fan-in-gates
---

**type:** execution

## Proposal

> **止损（2026-08-15 04:3xZ，manager 改判「30 前提错，接线真差集=1」+ 指示我立案）：需要 —— 当下动作 = 本任务立案**。用接线完整参数实跑（`--baseline 77b291db`）：`totalDirectCommits=15 · designInternalCommits=14 · codeSurfaceCommits=1 · inLockWindowCommits=0`，candidates 长度 **1**（635ec831，plugin/skills/manager/SKILL.md，confirmedBypass=true）。**「30」是无基线全史审计数，接线 enforcement 差集是 1**——我把全史审计数当成 enforcement 差集（manager 上次 18 vs 5 的镜像：同名不同域两个数当成一个）。

**manager 改判（撤回上一条一个指示）**：
- **撤回**「⛔ 别把 SKILL.md 移进排除集」——前提是它是 30 条之一、排除=大面积掩盖；真差集 1 且结构上不可解时性质不同。
- **改判**：`plugin/skills/manager/SKILL.md` 进 design-internal 排除集，理由与 `.claude/` 完全同构：
  ```
  排除集既有两条理由（:20-32 注释）：
  · 机件面 .claude/（manager 独占）⇒ 已排除
  · 指引面 CLAUDE.md（管理者独占直写）⇒ 已排除
  · 热修 fan-in 机件本身 plugin/scripts/fan-in-*（走不了 self-fan-in，结构上引导问题）⇒ 已排除
  manager/SKILL.md 同时满足：manager 独占（C17）+ manager 结构上无 fan-in 路
  （无任务/无 worktree，fan-in-execute.js:44 无 task 即 bad-args）
  ```
- **⛔ 粒度到 `plugin/skills/manager/**`，不是整个 `plugin/skills/**`**——后者会把 `init/SKILL.md` 真报红一起掩掉（7e64a86b 是现成真样本，必须仍红）。
- **⛔ 不改阻断语义/grow-only**——真差集是 1 不是 30，task-contract-check 那套存量豁免是为一个不存在的规模造机制（硬规则⑫）。
- **断言面风险不消失**：SKILL.md 被机械断言（84985e66 咬过 round179/180 两轮）——承担者换为 manager 527269a9 的门（三类文件提交命令并进断言测试）。

**能取假**：改完后检查器对 `plugin/skills/init/SKILL.md` 的直改**必须仍红**（7e64a86b 现成真样本），对 `manager/**` 转绿。

## Plan

1. inner 读 direct-to-develop-bypass-check.ts 排除集谓词（:20-32）+ gap-direct 任务体 AC3 denominator 记录。
2. 排除集加 `plugin/skills/manager/**`（理由：manager 独占 + 走不了 fan-in 路，同 .claude/）。⛔ 粒度到 manager/**。
3. 能取假：7e64a86b（init/SKILL.md）回放仍红；635ec831（manager/SKILL.md）转绿。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 排除集加 `plugin/skills/manager/**`（理由：manager 独占 + 走不了 fan-in 路，同 .claude/ CLAUDE.md 两条既有理由）。
- [ ] AC2 粒度到 manager/**：`plugin/skills/init/SKILL.md` 直改必须仍红（7e64a86b 真样本回放），manager/** 转绿（635ec831）。
- [ ] AC3 ⛔ 不改阻断语义（真差集 1 不需存量豁免）；断言面风险由 manager 527269a9 门承担。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] `plugin/skills/manager/**` 进 design-internal 排除集（init/SKILL.md 仍红、manager/** 绿）+ 测试绿。

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts（排除集谓词加 plugin/skills/manager/**——inner 实现面）
- plugin/test/direct-to-develop-bypass-check.test.mjs（7e64a86b 仍红 + 635ec831 转绿用例）
- plugin/scripts/capability-catalog.sh（若声明变化）
- tasks/gap-direct-to-develop-exclude-manager-skill-granularity.md（自身）

## Evidence

（待落地后填：排除集改动、7e64a86b 仍红 + 635ec831 绿回放、scoped 门绿）

## 止损

**需要 —— 当下动作 = 本任务立案**：接线真差集=1（635ec831），manager/SKILL.md 结构上走不了 fan-in 路——不排除则每轮恒红、训练「已知跳过」；排除到 manager/** 粒度保住 init/SKILL.md 真红（7e64a86b）。
