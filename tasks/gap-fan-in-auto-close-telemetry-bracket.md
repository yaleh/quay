---
id: gap-fan-in-auto-close-telemetry-bracket
title: fan-in land 后不自动关 telemetry bracket——每次 land 留 stale bracket 到下一轮 reconcile（occurrence 3：ac76/ac81+touches/ac85，outer A20 驱动观察）
status: done
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

**（inner 2026-08-16 立案——outer A20 驱动第三次同形观察：fan-in land 后不自动 `--reconcile`，每 land 一条就留一个 stale bracket 到下一轮。occurrence 3 超过硬规则⑫阈值，可立案。）**

**现象**：`fan-in-execute.js` + `fan-in-ff-merge.sh` 的 flip/ff 流程**不写 `--task-end`、不调 `--reconcile`**——dispatch 时 `--task-start` 开的 telemetry bracket 从不在 land 时闭合 ⇒ 每次 land 留一个 stale bracket（`reconcile_compliant=false`），直到下一次手动/外层驱动 `--reconcile`。实测三次：ac76（08-16 02:2xZ）、ac81+touches（03:04Z）、ac85（04:09Z）。

**修法**：fan-in 流程末尾（ff-merge 成功后）自动闭合 bracket——`fast-mode-telemetry.ts --task-end --taskId <id>`（经 `closure-lag-check.sh --close-task`，A16 统一闭合点）或 `--reconcile --cap 5`。放在 ff 成功之后、返回之前。

**⛔ 注意**：fan-in workflow 是 AC78 核心机制，改动需小心（不破坏 flip/ff 主流程）；`.claude/workflows/` 是 DESIGN-INTERNAL（直修合法），但建议走 task+fan-in 以保记录（或直修 + 测试）。

**判据1**：fan-in land 后 bracket 自动闭合（land 后立即 `reconcile_compliant=true`，无需外部驱动）。
**判据2（能取假）**：不 land 的任务 bracket 不被误闭（在飞任务保留）；land 任务 bracket 闭合。
**判据3**：既有测试全绿；`--for-task` scoped 门绿。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 fan-in-execute.js（flip/ff 流程末尾）+ closure-lag-check.sh --close-task 用法。
2. 在 ff 成功后加 bracket 闭合（--task-end 或 --reconcile），不碰 flip/ff 主逻辑。
3. 判据2 能取假：在飞任务不被误闭。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：fan-in land 后 bracket 自动闭合（reconcile_compliant=true，无外部驱动）。
- [x] AC2 判据2 能取假：在飞任务 bracket 保留；land 任务闭合。
- [x] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] fan-in land 自动闭 bracket（occurrence 3 根治），A20 驱动不再因 fan-in 落地重复出现。

## Touches

- .claude/workflows/fan-in-execute.js（ff 成功后加 step 5.5 bracket 闭合）
- plugin/workflows/fan-in-execute.js（双副本，与 .claude/ 逐字一致）
- plugin/test/fan-in-execute-paths.test.mjs（bracket-close 组测试：真实闭 bracket + 在飞保留 + 幂等）
- tasks/gap-fan-in-auto-close-telemetry-bracket.md（自身）

## Evidence

**实现**：fan-in-execute.js 持锁段新增 **step 5.5**（ff 成功、清理前）——`closure-lag-check.sh --close-task --taskId ${task} --outcome done --root ${root}`（A16 统一闭合点，写 `--task-end done`）。只按 `--taskId` 关【本任务】的 bracket（telemetry report 的 `inProgress[]` 按 taskId 定位 runId），**绝不 `--reconcile` 全局扫**（判据2 能取假：在飞/未 land 任务保留）。ff 失败 ⇒ 不执行 5.5。`if ! …; then FATAL + exit 1` 是 5.5 的结果信号：exit 0 ⇒ bracketClose=true；exit 1 ⇒ bracketClose=false（ff 已成功、landing 完成，**不得**重试 ff / 不得判 needs-human，照常清理，note 标注 `bracketClose=FAILED`）。返回对象增 `bracketClosed`（true/false/null）。

**AC1 — 判据1（land 后自动闭合，无外部驱动）**：测试「⑥ REAL bracket-close」在真实 temp workspace（真实 `tasks/` + 符号链接真实 `plugin/`）经真实 `--task-start` 开 bracket → 从【vm 实执行 fan-in-execute.js 发出的真实 prompt】提取 5.5 block 实跑 → `fast-mode-telemetry.ts --report --json` 断言 task A 离开 `inProgress`、进入 completed 对（start+end）。exit 0。

**AC2 — 判据2 能取假（在飞保留）**：同一测试断言 task B（在飞、未 land）的 bracket 保留在 `inProgress`、未进 completed；「⑥ wiring」测试断言 5.5 block 的可执行行（非 `#` 注释）不含 `--reconcile`（只按 `--taskId` 关本任务）。

**AC3 — 既有测试全绿 + scoped 门绿**：
- `node --test plugin/test/fan-in-execute-paths.test.mjs` ⇒ **24 pass / 0 fail**（含 ⑥ 组 3 条：wiring / REAL bracket-close / REAL idempotent）。
- `bash scripts/test.sh --for-task gap-fan-in-auto-close-telemetry-bracket --allow-thin` ⇒ **exit 0**；24/24 pass；静态检查全 PASS（test-framework-policy / test-isolation / tmp-leak / test-impl-census / task-contract-check / malformed / landing-target）。
- 相关测试：`node --test plugin/test/fan-in-workflow-check.test.mjs plugin/test/workflows-dual-copy-drift-check.test.mjs` ⇒ **66 pass / 0 fail**（A6 workflow 覆盖 + 双副本漂移检查）。
- 双副本逐字一致：`diff .claude/workflows/fan-in-execute.js plugin/workflows/fan-in-execute.js` 无输出。
- **注**：scoped 选择器按 basename 启发式只解析 1/4 Touches（`plugin/workflows/*.js` 无同名 `fan-in-execute.test.mjs`）⇒ 报告 `test-selection-thin`，需 `--allow-thin`（既有选择器限制，非本任务缺陷；fan-in 时全量 suite 仍会跑上述相关测试）。

**DoD**：机制已落地并被真实 bash 测试覆盖（闭 bracket + 在飞保留 + 幂等），`--task-end done` 写走后 task 离开 `inProgress` ⇒ 无 stale bracket；「A20 不再重复」为该机制的构造效果。

**意外（pre-existing，非本任务引入）**：`plugin/test/direct-to-develop-bypass-check.test.mjs` 的「AC3 回放·CLI — 全量扫描（生产基线 b11ce720）」红一条——develop 上 `f9577da16`（inner AC81 锚重建，touches `plugin/scripts/outer-cron-registry.json`，非豁免直投）被 bypass 检查命中。该 commit 不在本分支、检查扫的是 develop 历史，与本任务改动无关。
