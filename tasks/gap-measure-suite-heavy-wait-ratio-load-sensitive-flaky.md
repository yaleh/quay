---
id: gap-measure-suite-heavy-wait-ratio-load-sensitive-flaky
title: measure-suite 的 heavy/wait 比值断言负载敏感，重载下翻转并挡住 fan-in
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（实测，2026-09-06）**：`plugin/test/measure-suite.test.mjs:329-331` 的断言
`heavy.cpuMs/durationMs > wait.cpuMs/durationMs` 在机器重载时翻转，实测报
`heavy ratio (0.211) must exceed wait ratio (0.239)`，**导致 fan-in 的全量 suite 变红**。

**代价已发生**：任务 `gap-goal-driver-mechanical-ring` 因此**连续 3 次 exited-not-landed、
触顶被标 `needs-human`**（`run_id: wk-prod-1788285192`），而它的改动只涉及 driver 注册面，
**与该测试文件毫无关系**。同类阻塞会命中任何一个恰好在高负载窗口 fan-in 的任务，
**单价高（一次 ≥3 轮重试 + 一次人工分诊）且与改动内容无关**。

**机制**：该测试 spawn 一个 CPU 密集子进程与一个 sleep 子进程，用两者的
`cpuMs/durationMs` 比值差来证明 `cpu_ms` 是真实测量而非从 duration 推导。
**重载时 CPU 密集那个被调度器抢占，比值塌陷；而 sleep 那个的比值被噪声抬高** ⇒ 断言翻转。
**它测的量本身是对的，但它的判据依赖一个外生变量（机器并发负载），在该变量未被控制时不成立。**

**能区分的对照（已实测，非推测）**：
- 隔离跑：`timeout 300 node --test plugin/test/measure-suite.test.mjs` ⇒ **9/9 全过**
  （当时 `load average 3.80`、运行中 worker 1 个）
- 失败时：并发 subagent **9 个**
⇒ **同一测试 + 低负载通过 / 高负载失败 ⇒ 成因是负载，不是被测代码。**

**两条候选修法（择一，实现者定，不预设）**：
1. **移入 `lowconc` 泳道**——该泳道正是为此设计的
   （`scripts/test.sh:29`「`gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive`」）。
   ⚠️ 该文件现为 `// @test-group engine`，`engine → lowconc` 会被
   `plugin/scripts/test-group-downgrade-check.ts` 判为**降级**（基线 = 该守卫落 develop 的提交），
   需在同一改动里给出正当化，不能静默降级。
2. **让判据不依赖外生负载**——例如改用 `heavy.cpuMs` 与其自身 wall clock 的**绝对下界**、
   或对两个子进程做同窗口对照并放宽到统计显著性，而不是裸比值大小。

⛔ **不要简单删除或放宽成恒真**——该断言防的是"`cpu_ms` 退化成 duration 推导值"这个真实缺陷
（硬规则 4：一个结构上不可能取假的量不是测量），把它改成恒真等于把一个真检查换成假保证。

## Acceptance Criteria

- [ ] 在**高并发负载下**连续跑该测试文件 5 次全部通过（负载可用并发 spawn 制造；这是本任务的核心判据，立案时取假）
- [ ] 负控制仍然成立：人为把 `cpu_ms` 改成从 `durationMs` 推导后，该测试**仍然报红**（证明没有把断言放宽成恒真）
- [ ] 若采用修法 1：`test-group-downgrade-check.ts` 对该降级给出正当化后退出 0，不是被静默绕过
- [ ] `bash scripts/test.sh --for-task gap-measure-suite-heavy-wait-ratio-load-sensitive-flaky` 退出 0

## Definition of Done

**验收对象是【在真实高负载窗口下不再翻转】，不是【断言被改得更宽】。**
必须同时满足两侧：高负载下连续 5 次通过（假阴性消除），且注入 duration-derived 的 `cpu_ms` 时仍报红
（真检查未被削弱）。**只做其中一侧不算完成**——只放宽会变成恒真的假保证，只加严会继续挡 fan-in。
落地后在 `.quay/` 的 fan-in suite 日志里不再出现该断言的失败记录。

## Touches

- plugin/test/measure-suite.test.mjs
- plugin/scripts/test-group-downgrade-check.ts
- tasks/gap-measure-suite-heavy-wait-ratio-load-sensitive-flaky.md
