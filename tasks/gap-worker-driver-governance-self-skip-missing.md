---
id: gap-worker-driver-governance-self-skip-missing
title: worker-driver.test.mjs 缺 governance 自跳守卫 ⇒ 每个默认套件轮都跑 121 题；加守卫 + 机械强制检查
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

worker-driver.test.mjs 声明 `// @test-group governance`，但全文件无 `QUAY_TEST_GROUPS` 自跳守卫。test.sh 默认 run 的 select_files（runner-grouping.ts:119）对 governance 文件无条件放行（`elif [ "$g" = "governance" ] && is_default_set` 分支，意图"visible skipped"），依赖各文件自带 in-file 守卫真正 skip。worker-driver 缺守卫 ⇒ 默认套件每轮跑全部 121 题 + driver spawn + wall-clock seam（kill/timeout/stop/suite-hang，~30–60s）——#709 前 5 慢文件的成因之一。已实测：默认 `--list-files` 含 worker-driver，且全文件无任何 QUAY_TEST_GROUPS 消费点。全仓审计：148 个 governance 文件仅 40 个有守卫，108 个无——该"放行+自跳"机制无任何机械强制，覆盖率洞。修复=给 worker-driver 加标准守卫（对齐 task-ac-carryover-check.test.mjs 既有实现）+ 加机械检查强制"每个 @test-group governance 文件必带守卫"（防第 109 个再犯）。

## Plan

1. worker-driver.test.mjs 加标准守卫：`if (QUAY_TEST_GROUPS && !QUAY_TEST_GROUPS.split(",").includes("governance")) { test("governance group skipped", { skip: ... }, () => {}) } else { 全部 121 题 }`（对照 plugin/test/task-ac-carryover-check.test.mjs:99 的既有模式）。
2. 新增静态检查：遍历全部 `@test-group governance` 文件，无 `QUAY_TEST_GROUPS` 守卫 ⇒ 报红（接入 run_static_checks / check_group_declarations 同族机制）。
3. 修完 worker-driver 后重跑审计：108 个无守卫文件作为已知清单登记（是否批量补守卫 = 后续决策，本任务只机械强制 + 修重灾区 worker-driver）。
4. 负控制：默认 {product,engine} run 中 worker-driver 仅报 skipped（非 absent）；`--group governance` 或显式文件调用仍全跑。

## Acceptance Criteria

- [ ] AC1（能取假，读生产载体）：默认 {product,engine} run 输出中 worker-driver 仅报 skipped（不再跑 121 题）。
- [ ] AC2（能取假，负控制）：`--group governance` 或显式调用时 worker-driver 仍全跑（守卫不挡显式请求）。
- [ ] AC3（机制强制）：静态检查对"无守卫的 governance 文件"报红；新增 governance 文件缺守卫即红。
- [ ] AC4（审计）：修后审计，worker-driver 进入 GUARDED 集合。

## Definition of Done

worker-driver 在默认套件中报告 skipped（不再跑 121 题与 driver spawn）；一个机械检查强制 governance 文件必带自跳守卫；--group governance 显式运行不受影响。

## Touches

- plugin/test/worker-driver.test.mjs（加守卫，121 题包进 else 分支）
- plugin/scripts/runner-grouping.ts（或新增 checker——governance 守卫机械检查）
- plugin/test/runner-grouping.test.mjs（或 checker 自测——新检查的测试）
- tasks/gap-worker-driver-governance-self-skip-missing.md（自身）