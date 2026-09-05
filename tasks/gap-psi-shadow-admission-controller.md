---
id: gap-psi-shadow-admission-controller
title: PSI 反馈准入——影子模式验证（先用现有数据测增量预测力，再决定是否上实时观察字段）
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

`gap-perfile-cpu-cost-collection`/`gap-suite-scheduler-perfile-cpu-emitter-missing` 建立了 `cost_f`（每文件真实 CPU 消耗）；讨论延伸到一个更根本的假设（人 2026-09-05）：真正需要低并发运行的测试，敏感的不是"当时有多少并发测试"，而是**自己（或自己的子进程）被 schedule out 的概率**——这是一个可以直接用 `/proc/self/schedstat` 的 `run_delay` 字段测量的量，且已经用对照实验验证（安静环境 `runDelayMs=0.29`，16 核 2x 超订阅环境 `runDelayMs=188.4`，约 650 倍差异，`onCpuMs` 几乎不变）。

**由此引出的问题**：本仓库现有的水位线机制（`gap-suite-scheduler-reliability-cap-not-speed`）用**并发文件数**做准入约束；PSI（`/proc/pressure/cpu` 的 `cpu_stall`）才是更直接的因果量。人要求"像当初 `gap-suite-dynamic-waterline-scheduler` 用历史数据模拟 min-lock vs 组预算那次的方法"，做一次 PSI 反馈控制 vs 当前水位线的历史模拟对比。

**已实测但结论是：那个方法在这个问题上不成立，不能照搬**。用 40 轮、2315 个真实采样点（`.quay/verification-round.jsonl` 的 perFile 时间戳重建并发 + `.quay/suite-load-*.jsonl` 的真实 `cpu_stall` 采样）算出 Pearson r(并发数, cpu_stall) = **0.918**——表面很强，但专门找解耦点后发现：

- **并发数 0~2 但 cpu_stall 32%~64%**（8 轮里出现，如 round 985 的 `t0+149s 并发=2 cpu_stall=58.9%`，round 1017 的 `t0+132s 并发=1 cpu_stall=63.6%`）——定位在 `tmax` 前后的 fan-in 机械开销窗口（doc-check/scoped-gate/typecheck）或本机其它非本轮 claude/agent 进程（实测此刻本机同时有 **25 个** claude/agent 进程）——**这些负载源完全在"并发文件数"的记账范围之外，PSI 却能看见**。
- **并发数≥25 但 cpu_stall<3%**（如 round 979 并发=28 时 cpu_stall=0.1%）——main 独占相里 28 个并发文件大多轻量，并发数**误报**成"高负载"。

**为什么不能直接照搬历史模拟法**：`gap-suite-dynamic-waterline-scheduler` 当年的模拟只需要 `durationMs`——一个不受调度策略本身反作用影响的量，可以在事件驱动模拟器里安全重放。PSI 反馈控制模拟有**反事实问题**：拿到的历史 `cpu_stall` 序列是"当前策略产生的结果"（内生量），不是外生输入；换一个准入策略，真实 PSI 轨迹本身就会不同（更严格的准入会让高负载窗口来得更晚/更短）。用旧策略产生的轨迹去评价新策略，要么需要假设一个"并发→PSI"映射模型去外推（而我们刚证明这个映射在最要紧的地方——外部负载源——失效），要么是拿因变量冒充自变量。这跟 `gap-suite-cost-model-is-wrong-optimizations-buy-nothing` 否定的模型是同一类错误：一个从未在真实反馈环里验证过的推算被当结论用。

**本任务改做安全、有真实反馈环的替代方案，分两阶段**，Phase 1 是否值得做由 Phase 0 的真实数据决定，不预设。

## Plan

**Phase 0（回溯分析，零新增运行时代码，零风险，全部用现有数据）**：写一个可复现的分析脚本，联合 `.quay/verification-round.jsonl` 的 perFile `{file, startedAtMs, endedAtMs, passed}` 与对应 `.quay/suite-load-<runId>.jsonl` 的 `{t, cpu_stall}`，回答一个比"并发数~PSI 相关性"更尖锐的问题：**在同一个并发区间内（控制并发这个已知混杂变量），真实失败（`passed:false`）的文件，其执行窗口内的 PSI 读数是否显著高于同区间内通过的文件？** 如果是，PSI 对失败有超出并发数的增量预测力，值得建 Phase 1；如果样本不足或无增量信号，如实记录、本任务到此为止。

已知的样本稀疏性（如实写入，不回避）：全历史 `perFile` 记录 190620 条，`passed:false` 仅 **240 条（0.126%）**——脚本必须按并发区间/PSI 分档report 各档的失败样本数，样本数低于脚本自定的门槛时输出"样本不足，无法判定"而不是勉强给出方向性结论（硬规则 3b：读不懂/测不出不能伪装成有结论）。

**Phase 1（仅当 Phase 0 判定"有信号，值得继续"时才做；否则本任务在 Phase 0 结束，Phase 1 相关 AC 标 N/A）**：给已经在每轮全量套件常驻运行的 `plugin/scripts/suite-load-sampler.ts` 加一个纯观察字段——在每次采样时，用一个显式命名、写明依据的 PSI 阈值（依据本任务 Proposal 里已经测出的"安静~8% vs 满载~68%"分布，具体取值由实现者结合 Phase 0 数据定，不预设），派生一个 `would_throttle: boolean` 字段随 `{t, loadavg, cpu_stall, mem_avail}` 一起落盘。**这个字段只读、只记录，不接入任何真实调度/准入逻辑**——它的作用是让"如果当时有 PSI 反馈准入，会不会拦"这个判断，从此变成每轮自动产出的标准数据，供未来（另立任务）决定要不要真的把它接进 `suite-scheduler.ts` 的准入逻辑时使用，而不必每次都重新做一次回溯分析。

**明确不做的事**（划界，防范围膨胀）：不修改 `suite-scheduler.ts` 的 `nextDispatch`/`currentCap`，不让 `would_throttle` 产生任何真实的准入/节流效果——那是一个需要 Phase 1 数据积累之后才能做判断的、独立的后续任务。

## Acceptance Criteria

- [ ] AC1（能取假，Phase 0 分析脚本产出真实结论）：新增脚本联合 ≥100 轮真实历史轮次（perFile + suite-load 采样都存在的轮次，已核实 ≥255 轮可用）的 `passed:false` 记录与其执行窗口内的 PSI 读数，按并发区间分档，输出各档失败样本数、通过组 vs 失败组的 PSI 均值/分布对比，以及一个明确写在 Measured 里的 go/no-go 结论（"有增量信号，进入 Phase 1" 或 "样本不足/无信号，Phase 1 不做"）；（⛔ 只给相关性数字不给按失败/通过分组的对比 ⇒ 假；⛔ 样本不足却给出方向性结论 ⇒ 假）。
- [ ] AC2（能取假，诚实的样本量报告）：AC1 的输出必须逐档给出样本数 N，且脚本自身定义并在 Measured 里写明"判定所需的最小 N"，N 低于该门槛的档位一律报"样本不足"而不是给方向；（⛔ 任何档位 N 低于自定门槛却仍给出正/负判定 ⇒ 假）。
- [ ] AC3（能取假，Phase 1，仅当 AC1 判定为"进入 Phase 1"时适用；若 AC1 判定"不做"，本条标 `[x]` 并注明"N/A——Phase 0 判定不做，正确地未尝试 Phase 1"）：`suite-load-sampler.ts` 在每条采样行追加 `would_throttle` 字段，派生自一个命名常量阈值（代码注释写明依据 Phase 0/本任务 Proposal 的分布数据）；grep 全仓确认该字段未被 `suite-scheduler.ts` 或任何调度/准入代码读取——它是纯观察字段；新增单测覆盖派生函数本身（纯函数，不需要真实进程）。
- [ ] AC4（能取假，Phase 1 生产核验，仅当 AC3 适用时适用；否则同 AC3 标 N/A）：Phase 1 落地之后，至少一轮真实全量套件产出的 `.quay/suite-load-*.jsonl` 文件里出现该字段，且 true/false 两个值都真实出现过（不是恒定值——恒定值携带零信息，与硬规则 3b 的"cpuMs 最低 10 个文件必须有分辨力"同一类判据）；（⛔ 该字段只出现一种取值 ⇒ 假）。
- [ ] AC5（能取假，范围守卫）：`git diff` 不含 `suite-scheduler.ts` 的 `nextDispatch`/`currentCap` 或任何准入/调度逻辑改动——本任务全程只产出观察数据，不改变任何真实调度行为；（⛔ 动了调度逻辑 ⇒ 超范围 ⇒ 假）。

## Definition of Done

Phase 0 用 ≥100 轮真实历史数据交付一个诚实的、给出具体样本数的 go/no-go 结论（不是没有数据支撑的方向性猜测）；若判定进入 Phase 1，`suite-load-sampler.ts` 落地一个零效应的纯观察字段并在至少一轮真实生产轮里验证其有分辨力；全程未改动任何真实调度/准入逻辑（AC5）；AC1-5 全部勾选（Phase 1 不适用时对应 AC 标 N/A 而非留空）；本任务不对"PSI 准入控制是否真的该上线"做出结论——它只交付：(a) 一次有真实数据支撑的初步判断，和 (b)（如果判断支持）一个供未来任务积累更多真实前瞻数据的被动观察机制。

## Touches

- plugin/scripts/psi-failure-correlation-check.ts（新，Phase 0 回溯分析脚本）
- plugin/scripts/capability-catalog.sh（新脚本六表注册）
- plugin/scripts/suite-load-sampler.ts（Phase 1，仅当 AC1 判定进入 Phase 1 时改动：追加 would_throttle 派生字段）
- plugin/test/suite-load-sampler.test.mjs（新，Phase 1 单测：would_throttle 派生函数，仅当 Phase 1 适用时新增）
- tasks/gap-psi-shadow-admission-controller.md（自身）
