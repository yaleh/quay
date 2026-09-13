---
id: gap-checker-claim-vs-actual-cadence-and-count-drift
title: 两处 checker 自述与实际脱节：cadence 声明未被调度消费 + 头注释数量与实测不符
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: finding
---
**type:** finding

## Finding

两处独立但同族的证据，均为一手核实（读码 + 现场跑注册表统计），非转述：

1. **cadence 声明无调度落点**：`plugin/scripts/capability-catalog.sh:706` 声明
   `task-status-drift-check.ts` 的 cadence 为「每轮」，但 `plugin/scripts/routine-scheduler.ts`
   全文没有任何一处读取 catalog 的 cadence 字段去驱动调度——这个声明没有任何机械消费者，是纯文档，
   与实际调度行为脱节。进一步核实：`task-status-drift-check.ts` 本身**没有被**
   `runner-static-gate.ts` 的 `run_static_checks()`/`run_operational_checks()` 任何一个注册表
   `run_checker` 调用注册，也不在 `ready-pool-check.ts`/`slot-refill.ts`/`worker-driver.ts` 的任何
   阻塞派发路径里被整体调用（这几个文件里只有个别导出的纯函数被 `ready-pool-check.ts` 局部借用于别的
   判断，不构成「该检测器被机械调度」）。即：它既没有被声明的 cadence 调度，也没有被任何写入路径
   调用——是一个完全悬空的检测器，声明的 cadence 是它唯一存在过的「调度承诺」，而这个承诺从未兑现。

2. **头注释数量与实测不符**：`plugin/scripts/runner-static-gate.ts` 文件头注释自称
   "35 checkers" 与 "11 runtime-state checkers"。现场实测：`run_static_checks()` 函数体
   （59-783 行区间）含 **54** 个 `run_checker` 调用标签（对应 **51** 个不同的底层脚本文件，
   个别脚本被多次以不同标签调用）；`run_operational_checks()` 函数体（795-991 行区间）含
   **13** 个 `run_checker` 调用标签。两个数字（35 / 11）都与实测值（54或51 / 13）不符，且差距不小
   （前者相差 16-19，后者相差 2）。这正是 CLAUDE.md 硬规则 2「按位置判定，不按关键词」与文档漂移
   模式的一个新实例——文件自己头部写死的数字从未随后续新增的 checker 同步更新，且没有任何机械检查
   会发现这种漂移（`capability-manifest-check.ts` 一类的一致性检查器覆盖的是别的载体，不覆盖
   `runner-static-gate.ts` 自己的头注释）。

## Acceptance Criteria

- [ ] AC1（cadence 归宿二选一，能取假）：要么把 `task-status-drift-check.ts` 真正接入
  `routine-scheduler.ts` 使其按 `capability-catalog.sh:706` 声明的 cadence（每轮）被实际调度
  ——落地后需现场证明「跑一轮 routine-scheduler，该 checker 确实被调用」（如打印/日志/exit code
  可核）；要么修正 `capability-catalog.sh:706` 的 cadence 声明为与实际相符的值（如标注为
  「未接入调度，仅供人工/其它路径按需调用」）。二选一必须落地一个，不能两者都不做——落地后
  贴出改动前后的 catalog 声明原文对比。
- [ ] AC2（头注释数量修正，能取假）：修正 `plugin/scripts/runner-static-gate.ts` 头注释的
  checker 数量为实测值。修正后跑一遍统计命令核对头注释数字与统计结果一致（如对
  `run_static_checks()`/`run_operational_checks()` 函数体逐行统计 `run_checker` 调用次数），
  贴出统计命令与输出、以及修正后的头注释原文。
- [ ] AC3（防再漂移，能取假）：新增或扩展一个机械检查（可挂在既有静态检查框架内），断言
  `runner-static-gate.ts` 头注释声明的 checker 数量与函数体内实际 `run_checker` 调用次数一致，
  不一致则该检查报红。跑一次「故意改错头注释数字」的负控制，确认检查器真的会报红（不是恒绿）。
- [ ] AC4（既有测试不回归）：`node --experimental-strip-types --test plugin/test/runner-static-gate*.test.mjs`
  （或覆盖 runner-static-gate 的既有测试文件）exit 0；新增检查器若有对应测试文件，一并跑绿。

## Definition of Done

`task-status-drift-check.ts` 的 cadence 归宿（接入调度 或 声明改实）已落地且可现场验证；
`runner-static-gate.ts` 头注释数量与实测值一致；新增的一致性检查器落地并通过负控制验证
（故意制造漂移能报红）；相关既有测试全绿。不是「看代码逻辑上应该修好」，要有真实命令输出为证。

## Touches

- plugin/scripts/capability-catalog.sh
- plugin/scripts/routine-scheduler.ts
- plugin/scripts/task-status-drift-check.ts
- plugin/scripts/runner-static-gate.ts
- plugin/test/runner-static-gate.test.mjs
- tasks/gap-checker-claim-vs-actual-cadence-and-count-drift.md
