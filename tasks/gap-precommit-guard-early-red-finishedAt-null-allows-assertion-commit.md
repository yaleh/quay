---
id: gap-precommit-guard-early-red-finishedAt-null-allows-assertion-commit
title: precommit-guard early-red 缺口——state=red 但 finishedAt=null（runner 仍活收集）时守卫放行断言面提交
status: todo
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

**实证（manager 2026-08-12 精确判据，probe 已证）**：`plugin/scripts/precommit-guard.ts` 的 running 判定是
`isRunning = state === "running"`，但 suite-state 的权威「轮是否结束」字段是 **`finishedAt`**——
`state=red` 且 `finishedAt=null` 时 runner 仍在活收集（early-red），此刻提交断言面文件同样会翻转轮结论，
却因 `state !== "running"` 被守卫放行（reason="not-running"）。

**早期实例**：round 60/63 形态——早红后 runner 仍在收集，提交 tasks/ 会让该轮结论不可用。守卫当前只挡
`state="running"`，early-red 窗口漏过。manager probe 已证明：early-red 状态下守卫产不出拒绝记录。

**修法（manager 裁定）**：`isRunning = state === "running" || finishedAt == null`（与
`parseTerminalFinishedAt` 同判据——trigger 那边逐字写着的权威语义）。另：`--json` 输出加
`finishedAt` + `isRunning`（零成本，「为什么放行」可查）。

## Plan

1. `plugin/scripts/precommit-guard.ts`：把 running 判定从 `state !== RUNNING ⇒ allow` 改为
   `isRunning = (state === RUNNING || finishedAt == null)` 决定 reject/allow 分支。
2. `--json` 输出加 `finishedAt` + `isRunning` 字段。
3. 测试补 early-red 用例（state=red + finishedAt=null ⇒ reject；state=green + finishedAt 有值 ⇒ allow）。
4. scoped 门绿 + 下轮验证。

## AC

- [x] AC1: `isRunning = state === "running" || finishedAt == null`——early-red（red+finishedAt null）提交断言面被拒
- [x] AC2: 终态（green/red 且 finishedAt 有值）放行
- [x] AC3: `--json` 输出含 `finishedAt` + `isRunning`（「为什么放行」可查）
- [x] AC4: 既有用例不回归；`--for-task` scoped 门绿
- [ ] AC5: 下轮验证（守卫完整）

## Evidence

**修复（2026-08-12，外层裁定窗口内直接提交）**：`plugin/scripts/precommit-guard.ts` 的 running 判定从
`state !== RUNNING ⇒ allow` 改为 `isRunning = (state === "running" || finishedAt == null)`——
early-red（state=red + finishedAt=null，runner 仍活收集）提交断言面现在被拒；终态（green/red + finishedAt
有值）放行。`--json` 输出加 `finishedAt` + `isRunning`（「为什么放行」可查）。

**测试**：`plugin/test/precommit-guard.test.mjs` 加 AC1-early-red（state=red+finishedAt=null ⇒ reject +
isRunning=true + finishedAt=null）与 AC1-terminal（state=red+finishedAt set ⇒ allow + isRunning=false）。

**scoped 门**：`scripts/test.sh --for-task gap-precommit-guard-early-red-finishedAt-null-allows-assertion-commit`
→ **20 pass / 0 fail / EXIT 0**（原 18 + 新 2）。`npx tsc` 该文件 0 错。task-contract-check 0 违规。
下轮验证（AC5）归外层 verification-round。

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修复 diff + early-red 拒绝实测贴出（见 Evidence）
- [ ] 既有测试全绿（`--for-task` scoped）

## Touches

- plugin/scripts/precommit-guard.ts（isRunning 判定 + --json finishedAt/isRunning）
- plugin/test/precommit-guard.test.mjs（early-red 用例）
- tasks/gap-precommit-guard-early-red-finishedAt-null-allows-assertion-commit.md（自身：勾 AC + 贴证据）
