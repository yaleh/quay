---
id: gap-ts-touching-fan-in-needs-typecheck-gate
title: fan-in 准入只看 scoped 绿——新增/移动 .ts 文件的场景漏掉 ts-typecheck 闸
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（2026-08-12，round 52 红）**：cli-import-migration fan-in 依据「scoped 79/0 绿」通过，
但**scoped 检查没覆盖 ts-typecheck 闸**——17 verb handler 搬进 20 个新 `.ts` 文件（类型图改变，
不只是行为），`npx tsc --noEmit` 报 **73 错全在 src/cli/**（ctx 类型迁移丢失）。
3 分钟后全量套件 round 52 红在 ts-typecheck-gate。

**这不是「谁马虎」——是 scoped 覆盖面与 fan-in 准入条件不匹配**：
一次大规模文件搬迁（新增/移动 `.ts`）恰恰是 scoped 最不该被信任的场景（改变的是类型图）。
**scoped 全绿 + 全量红** 的成本 = 550s 红轮 + 阻塞 batch-merge。

## Plan

1. 在 fan-in 前置加判据：**任务的 `## Touches` 含新增/移动 `.ts` 文件 ⇒ 先跑一次 `ts-typecheck` 闸**
   （`quay gate <task> --gate ts-typecheck`，现成机件，~20s）。
2. 纳入 fan-in 准入检查（与 scoped 绿并列，不替代）。

## AC

- [x] AC1: fan-in 前置识别「Touches 含新增/移动 .ts」的任务
- [x] AC2: 此类任务 fan-in 前必跑 ts-typecheck 闸（现成机件 ~20s）
- [x] AC3: 负控制——cli-import-migration 这类任务在修复前被该闸挡住（不再以 scoped 绿通过）
- [x] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] 复现用例（新增 .ts 任务 → fan-in 前置跑闸）贴出（见 Evidence）
- [ ] 全量套件绿

## Evidence

**复现用例（本任务自证）**——`plugin/scripts/fan-in-ts-typecheck-gate.ts` 本身就是一个新增 `.ts` 文件：

```
$ node --experimental-strip-types plugin/scripts/fan-in-ts-typecheck-gate.ts \
    --task gap-ts-touching-fan-in-needs-typecheck-gate --worktree <wt> --merge-target develop --check-only --json
{ "touches": [ ..., "plugin/scripts/fan-in-ts-typecheck-gate.ts", ... ],
  "newMovedTsFiles": ["plugin/scripts/fan-in-ts-typecheck-gate.ts"],
  "required": true, "reason": "new-moved-ts-in-touches" }
```

**AC2 —— 命中 ⇒ 先跑 ts-typecheck 闸（真实 `npx tsc --noEmit`，cwd=worktree），绿才准入：**

```
$ fan-in-ts-typecheck-gate.ts --task gap-ts-touching-fan-in-needs-typecheck-gate --worktree <wt> --merge-target develop
fan-in-ts-typecheck-gate: task … — Touches cover new/moved .ts files (1); type graph changed
fan-in-ts-typecheck-gate: running ts-typecheck gate in worktree <wt>...
fan-in-ts-typecheck-gate: typecheck GREEN — ADMITTED (exit 0)
```

**AC3 —— 负控制（合成 repo，`--fake-gate` 短路不执行 tsc；`src/new-verb.ts` 是新增 .ts、Touches=`src/`）：**
`--fake-gate fail` ⇒ exit 1 BLOCKED；`--fake-gate pass` ⇒ exit 0 ADMITTED；无新增/移动 .ts 的任务在
`--fake-gate fail` 下仍 exit 0 且**不跑闸**（AC1 负控制：闸只在触发时付）。单测 `plugin/test/fan-in-ts-typecheck-gate.test.mjs` 17/17 绿。

**AC4 —— scoped 门：** `scripts/test.sh --for-task gap-ts-touching-fan-in-needs-typecheck-gate --allow-thin` ⇒ 33 tests / fail 0 / exit 0。

## Touches

- plugin/scripts/fan-in-ts-typecheck-gate.ts（新：fan-in 前置准入检查——Touches ∩ diff(new/moved .ts) ⇒ 先跑 ts-typecheck 闸）
- plugin/test/fan-in-ts-typecheck-gate.test.mjs（新：@test-group governance 单测，16/16）
- plugin/scripts/capability-catalog.sh（fan-in-ts-typecheck-gate.ts 五表声明）
- docs/proposals/quay-product-outline.md（delivery-inventory 再生成）
- plugin/loop/fast-mode-loop-tick.md（A6 fan-in 步骤接线：cd <wt> 内先验 ts-typecheck）
- orchestration/fast-mode-tick-core.md（A6 行同步）
- tasks/gap-ts-touching-fan-in-needs-typecheck-gate.md（自身）

## Test-Files

- plugin/test/fan-in-ts-typecheck-gate.test.mjs
