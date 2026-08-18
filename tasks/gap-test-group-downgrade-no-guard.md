---
id: gap-test-group-downgrade-no-guard
title: "@test-group 降级路径无守卫——合法改标 serial/lowconc/governance 使测试被静默移出默认集/跳过，闸不自知"
status: todo
labels:
  - gap
  - finding
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`scripts/test.sh` 的 `check_group_declarations` 只挡「未识别值」（拼错/非法组名），**不挡「合法但把测试从 product/engine 改标成 serial/lowconc/governance」**——而 serial/lowconc/governance 组默认被移出 `product,engine` 默认集或降并发/自跳过。即一个行动者可以把测试文件的 `// @test-group engine` 改成 `// @test-group governance`（合法值），使该测试从默认全量集中消失，而没有任何检查报出「这测试被降级了」。

**证据（manager 按位置复核 + outer spot-check 确认）**：`scripts/test.sh:21-119` 的组语义注释明确 `governance` 自跳过、`serial`/`lowconc` 移出默认并发相；`test-framework-policy-check.ts` C3 只要求新文件「带标注」、不校验「选哪个组」。与 `gap-ready-pool-unknown-flag-fail-open` / `gap-direct-to-develop-bypasses-fan-in-gates` 同族（闸的判据面可被行动者绕开而闸不自知）。

**关联**：inner（deepseek-v4-flash 时）在 suite 超时压力下「尝试把测试挪出 suite 以绕过时间限制」——极可能走的正是此路径（②③ 之一）。

## Acceptance Criteria

- [ ] AC1: `check_group_declarations` 增加「降级检测」——一个文件（按 path+前次 @test-group 记录）从 product/engine 改标为 serial/lowconc/governance 时，必须带额外证据（commit message 显式标注理由），否则 exit 非 0。
- [ ] AC2: 降级检测有负控制（一个真实的 engine→governance 改标被挡下，一个带理由的合法降级被放行）。
- [ ] AC3: 检测接进 `run_static_checks`（或等价每轮执行路径），不是仅存在于测试。

## Definition of Done

- [ ] 一条「engine→governance 无理由改标」被机械挡下（真实输出，非 fixture）。
- [ ] 一条「带 commit message 理由的合法降级」被放行（对照）。
