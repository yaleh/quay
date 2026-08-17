---
id: gap-fixture-hash-omits-workflows-dirs
title: quay-init-loop-helpers._fixtureHash() 漏 .claude/workflows/ + plugin/workflows/——workflow-only 变更复用陈旧 install fixture → real-target-verify 假冲突（发生率 2/日）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现象（inner 两次实测 + outer 复核确认）**：`quay-init-loop-helpers._fixtureHash()` 的 walk **漏了 `.claude/workflows/` 与 `plugin/workflows/`** 目录——只改 workflow 文件时，install fixture 的 hash 不变，复用**陈旧 fixture** → `real-target-verify` 报假冲突。

**发生率 2（2026-08-17 同日两次）**：
1. `ec434eb8`（10:06，fan-in-execute pre-verified-suite 落地）——改 `.claude/workflows/fan-in-execute.js` ⇒ 触发假冲突，删 `/var/tmp` fixtures 强制重装解当下；
2. `gap-fan-in-turn-budget-suite-timeout`（16:5x，改 fan-in-execute.js）——suite 首跑 4 失败全 real-target-verify 假冲突，删 stale fixtures + 重跑解当下。

**影响**：每次改 workflow 文件（fan-in-execute.js 是 suite 优化的高频触碰点）都撞这个假冲突，stall fan-in；且「删 fixtures 强制重装」是权宜——下次还会撞。**结构性补 hash walk 才是持久修法**（`.claude/workflows/` + `plugin/workflows/` 进 `_fixtureHash()` 的遍历范围）。

**能取假（⊢ 对照）**：修复后，一次仅改 `.claude/workflows/*.js`（或 `plugin/workflows/*.js`）的变更会改变 install fixture 的 hash，`real-target-verify` 不再假冲突（不再需要手动删 /var/tmp fixtures）；或者引入 fixture 版本戳/依赖清单使 workflow 变更可见。

## Plan

1. 读 `quay-init-loop-helpers._fixtureHash()` 的目录 walk 实现（定位它遍历了哪些目录、漏了哪两个）。
2. 把 `.claude/workflows/` 与 `plugin/workflows/` 加进 hash 遍历范围（或等价机制：fixture 依赖清单含 workflow 文件路径）。
3. 确认 `real-target-verify` 与 install-fixture 复用逻辑读到新 hash。
4. 对照：仅改 workflow 文件的变更 → hash 变化 → 不复用陈旧 fixture；`/var/tmp` fixtures 不再需要手动删。
5. scoped 门 + 全量验证，fan-in。

## Acceptance Criteria

- [ ] AC1: `_fixtureHash()`（或等价机制）覆盖 `.claude/workflows/` + `plugin/workflows/`——仅改 workflow 文件的变更使 install fixture hash 变化。
- [ ] AC2: `real-target-verify` 不再对 workflow-only 变更报假冲突（不需要手动删 /var/tmp fixtures）。
- [ ] AC3: 对照实测：改 `fan-in-execute.js`（不删 fixtures）→ verify 通过；既有 install 流程不受影响。
- [ ] AC4: 测试全绿 + `--for-task` scoped 门绿。

## Definition of Done

- [ ] workflow 目录进 fixture hash（或等价机制），workflow-only 变更不再触发 real-target-verify 假冲突，手动删 /var/tmp fixtures 的权宜不再需要，scoped + 全量绿。

## Touches

- plugin/test/quay-init-loop-helpers.mjs（**已定位正本**：_fixtureHash 的目录 walk——hash 安装面 = `plugin/scripts + loop/ + ...`，漏 `.claude/workflows/` + `plugin/workflows/`）
- plugin/scripts/（real-target-verify / quay-init install 消费面）
- plugin/test/quay-init-loop.test.mjs 等（fixture-hash 覆盖测试）
- tasks/gap-fixture-hash-omits-workflows-dirs.md（自身）
