---
id: gap-ac225-kernel-sibling-naive-anchor-migration-zero
title: A域枚举归零：迁移 9 处 kernel sibling naive 锚点至
  resolveKernelSibling/resolveKernelPluginRoot，使 kernel-sibling-resolution-check
  exit 0（AC-225）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-225
---
## Proposal

正本判据 `goals/AC-225-a域枚举归零-kernel-sibling-解析违例-0-处-完整性由机械枚举证明而非手工清单-goal-012-退出条.md`（goal=GOAL-012，2026-09-10 人裁定三条后授权激活）：`test -f plugin/scripts/kernel-sibling-resolution-check.ts && node --no-warnings --experimental-strip-types plugin/scripts/kernel-sibling-resolution-check.ts --root . --json` exit 0 —— 即 KERNEL 域违例（把自己的 sibling 脚本锚在 target root / worktree / naive `__dirname` 而非经 `resolveKernelSibling`/`resolveKernelPluginRoot`）**枚举为 0 处**。与 AC-224（`gap-ac224-kernel-sibling-resolution-check-mutation-covered`，ready）双向：AC-224 建检查器并证其会红（能取假）；本条迁移残量使其绿（此刻是绿）。

**现状（实测，位置判定）**：检查器 `plugin/scripts/kernel-sibling-resolution-check.ts` 尚不存在（AC-224 的 Plan 建它，本条为前置依赖）。A 域残量实测 **9 处** naive 锚点，分布 4 个 shipped kernel 文件：`full-suite-runner.ts` 6 处（`PER_FILE_CPU_PRELOAD = path.join(REPO_ROOT, "plugin", "scripts", "per-file-cpu-report.mjs")` 1 处 + `provision-verify-worktree.sh` ×2 + `resource-gate.sh` + `worktree-process-reaper.ts` + `suite-load-sampler.ts`）、`runner-tree-state.ts:50` `assert-clean-tree.sh`、`suite-state-trigger.ts:1284` `full-suite-runner.ts`、`runner-concurrency.ts:70` `process-budget.sh`。⛔ **完整性由检查器的机械枚举给出，不是本条的手工清单**——人工枚举已做过 3 次（gap-plugin-root-resolution-{non-skill-entrypoints,remaining-callsites,remaining-callsites-round2}）、3 次都有遗漏。解析器 helper 实际落在 `plugin/scripts/driver-runtime.ts`（`resolveKernelSibling(name)` / `resolveKernelPluginRoot()`，worker-driver.ts / promotion-driver.ts / cap-from-gate.ts 已 import），以 AC-224 检查器认定的正解为准。

## Plan

1. 前置：等 AC-224 落地（`plugin/scripts/kernel-sibling-resolution-check.ts` + 突变用例 + `test.sh`/`capability-catalog.sh` 登记）。
2. 跑 `node --no-warnings --experimental-strip-types plugin/scripts/kernel-sibling-resolution-check.ts --root . --json` 得全量违例清单——**该输出是完整性 oracle**，⛔ 不只改「被报出来的」几处（硬规则 5b）。
3. 逐处迁移：sibling `.ts`/`.sh` 经 `resolveKernelSibling(name)`（.ts→dist/*.js 回退由 helper 统一处理）；scripts 目录经 `resolveKernelPluginRoot()` 拼接；⛔ 各 spawn 点不各自重写 .ts/.js 回退。
4. 已知残量（预扫描，供实现起点，⛔ 以第 2 步输出为准）：`full-suite-runner.ts` 6 处（`PER_FILE_CPU_PRELOAD` 改为经 kernel 安装位置而非 `REPO_ROOT`；`provision-verify-worktree.sh` ×2、`resource-gate.sh`、`worktree-process-reaper.ts`、`suite-load-sampler.ts` 改 `resolveKernelSibling`）；`runner-tree-state.ts:50` `assert-clean-tree.sh`、`suite-state-trigger.ts:1284` `full-suite-runner.ts`、`runner-concurrency.ts:70` `process-budget.sh` 同法。
5. 双向负控制：无 `plugin/` 的第三方项目根夹具下，受影响 sibling 解析命中 shipped `dist/*.js`/`scripts/*.sh`；本仓库场景解析结果与迁移前逐字一致（GOAL-012 退出条件④，回归不变）。
6. 干跑 AC-225 criterion 至 exit 0；全量 `scripts/test.sh` 绿。

## Acceptance Criteria

- [x] AC1 判据翻转（判据本体）：`test -f plugin/scripts/kernel-sibling-resolution-check.ts && node --no-warnings --experimental-strip-types plugin/scripts/kernel-sibling-resolution-check.ts --root . --json` exit 0，violations 数组长度为 0（枚举 0 处）；贴完整命令与输出。
- [x] AC2 九处残量迁移（位置判定）：4 个源文件里 9 处 naive sibling 锚点改经 `resolveKernelSibling`/`resolveKernelPluginRoot`，`grep -nE 'path\.join\(__dirname, "(assert-clean-tree|full-suite-runner|process-budget|provision-verify-worktree|resource-gate|worktree-process-reaper|suite-load-sampler)\.(sh|ts)"|PER_FILE_CPU_PRELOAD = path\.join\(REPO_ROOT' plugin/scripts/full-suite-runner.ts plugin/scripts/runner-tree-state.ts plugin/scripts/suite-state-trigger.ts plugin/scripts/runner-concurrency.ts` 归零（⛔ 注释/字符串 fixture 不计——实现时同步更新/删除过时注释）。
- [x] AC3 双向负控制：无 `plugin/` 的第三方项目根夹具下，受影响 sibling 解析命中 shipped `dist/*.js` / `scripts/*.sh`（非 `Cannot find module` / `No such file`）；本仓库场景解析结果与迁移前逐字一致（回归）。
- [x] AC4 全量绿：`scripts/test.sh` 全量绿（含受迁移影响的 `full-suite-runner.test.mjs` / `suite-state-trigger.test.mjs` / `runner-concurrency.test.mjs`）。

## Definition of Done

AC1–AC4 全绿；AC-225 criterion exit 0（检查器**机械枚举 0 处**，⛔ 非手工清单）；9 处残量迁移完成 + 无 `plugin/` 第三方负控制通过 + 本仓库行为逐字不变（退出条件④）；全量 suite 绿。⛔ 本任务不建检查器/突变用例/双向单测（AC-224 职责）；⛔ 不把「全量 suite 绿」的检查器正确标红期当作本任务缺陷（检查器落地后会标红这 9 处直至本条完成）。

## Touches

- `plugin/scripts/axis-generator.ts`
- `plugin/scripts/full-suite-runner.ts`
- `plugin/scripts/goal-driver.ts`
- `plugin/scripts/guard-lineage-check.ts`
- `plugin/scripts/outer-driver.ts`
- `plugin/scripts/precommit-guard.ts`
- `plugin/scripts/quality-gate-driver.ts`
- `plugin/scripts/quay-init-closure-assertion.ts`
- `plugin/scripts/quay-init-closure-ratchet.ts`
- `plugin/scripts/registry-bare-filename-scan.ts`
- `plugin/scripts/rhythm-consumer-check.ts`
- `plugin/scripts/runner-concurrency.ts`
- `plugin/scripts/runner-tree-state.ts`
- `plugin/scripts/suite-driver.ts`
- `plugin/scripts/suite-slot-ssot-check.ts`
- `plugin/scripts/suite-state-trigger.ts`
- `plugin/scripts/workflow-journal.ts`
- `plugin/test/full-suite-runner.test.mjs`
- `plugin/test/suite-state-trigger.test.mjs`
- `plugin/test/runner-concurrency.test.mjs`
- `plugin/test/registry-bare-filename-scan.test.mjs`
- `tasks/gap-ac225-kernel-sibling-naive-anchor-migration-zero.md`
- `experiments/quay-perpetual-stream/scripts/workflow-journal.ts`
