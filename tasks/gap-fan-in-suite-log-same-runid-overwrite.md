---
id: gap-fan-in-suite-log-same-runid-overwrite
title: 机械 fan-in suite 日志按 (task, runId) 命名、无尝试序号——同 runId 内多次触发 suite
  时后一次覆盖前一次，历史败因不可回溯
status: todo
labels:
  - gap
  - observability
parent: null
children: []
extra:
  schema: execution
---
**type:** finding

## Finding

机械 fan-in 主路径（`plugin/scripts/worker-driver.ts:2359-2360`）里 suite 日志路径生成为：

```
const suiteLogFile = opts.suiteLogFile ?? path.join(root, ".quay", `fan-in-suite-${task}-${runIdSafe}.log`);
```

只按 `task` + `runId` 命名，不含尝试序号/时间戳。而【同一个 `runId` 在其生命周期内可以对同一任务发起多次独立的 suite 运行】——机械 fan-in 失败（`exited-not-landed`）后 worktree/分支被保留，下一轮 ready-pool 会用**同一个 runId** 重新派发"续做"会话（`worker-driver.ts:1198` 一带的续做 prompt 明确要求复用现有 worktree），重新走一遍 merge→...→suite；suite 若再次跑起，会用**同一个文件路径**把上一次的内容整体覆盖。

**实测（2026-09-01，过去24小时活跃期分析中发现）**：`gap-dashboard-taskcard-multistatus-minitable` 在同一 `runId=wk-prod-1788275557` 下发生 2 次独立 suite red（用 `.quay/fan-in-lock-events.jsonl` + `.quay/worker-outcome.jsonl` 交叉核实：15:55:37 与 16:09:07 两次独立 `exited-not-landed`、`mechanical_fan_in.step=suite`），但对应的 suite 日志文件 `.quay/fan-in-suite-gap-dashboard-taskcard-multistatus-minitable-wk-prod-1788275557.log` 只有一份、只反映【最后一次】（16:09 那次）的内容——15:55 那次具体败在哪条测试、耗时多少，已被覆盖、无法回溯，只能靠"同任务同时段、任务自身测试全绿"这类旁证做间接推断。另一个 `runId=wk-prod-1788280091` 下同任务又发生 3 次 suite red，同样只留最后一份日志。

**与既有任务的关系（已按机制查重，非重复）**：这与已 done 的 `gap-fan-in-suite-log-cross-relaunch-reuse`（2026-08-19，`/tmp/fan-in-suite-<task>.log` 跨 relaunch/跨 runId 复用）是**同一类问题在不同粒度上的重现**——那次修复把日志路径从"跨 runId 共享"改成"按 runId 命名并迁到 `.quay/`"（`worker-driver.ts:2360` 注释明确引用该任务号），解决了**跨 runId** 的覆盖问题，但没有覆盖**同一 runId 内多次独立 suite 运行仍共享同一路径**这个更细的粒度——续做重派不换 runId（是同一个"逻辑任务尝试"下的续做），而 suite 却可能在同一 runId 下被调用多次。`gap-fan-in-suite-time-file-cross-relaunch-reuse` 是另一个不相关的 bug（`.time` 文件 cpu_s 守卫缺失），也非重复。

## 影响

- 事后追因（诊断"为什么这个任务失败了这么多次""失败模式是否一致，是同一根因还是不同根因"）只能读到最后一次尝试的日志，前几次具体败在哪条测试/哪个文件无法直读。
- 续做 prompt 本身依赖 `verdict.logFile`/`suiteLog` 这类指针——如果要把"历史 attempt 的具体失败内容"喂给续做会话做更精准诊断（而不是每次都重新从头诊断），当前的文件覆盖机制会让这个信息在到达时已经丢失。
- 影响面：凡是【同一 runId 内多次触发 suite】的任务都会中招——过去24小时活跃期抽样至少 2 个 runId、共 5 次 suite red 中有 3 次的具体内容已不可恢复。

## Acceptance Criteria

- [ ] AC1（能取假，按尝试区分）：suite 日志路径包含尝试序号/时间戳（如 epoch 或从1开始的 attempt 计数），同一 runId 内连续两次触发 suite 时两份日志文件各自独立、互不覆盖；（⛔ 第二次仍覆盖第一次 ⇒ 假）。
- [ ] AC2（能取假，下游指针可回溯）：`worker-outcome.jsonl` 里 `mechanical_fan_in.verdict.logFile`/`suiteLog` 等指针指向的是【本次尝试自己的】日志文件，而非可能已被后续尝试覆盖的共享路径；（⛔ 指针在后续尝试后失效或指向被覆盖内容 ⇒ 假）。
- [ ] AC3（能取假，不引入无限增长）：需要有轮转/清理策略（如任务落地后清理该任务名下的历史 attempt 日志、或只保留最近 N 份），不能让 `.quay/` 无限堆积孤儿日志文件；（⛔ 长期运行后 `.quay/fan-in-suite-*.log` 文件数只增不减 ⇒ 假）。
- [ ] AC4（能取假，真实回放负控制）：用一个真实发生过的多次-suite-red runId（如上面 `gap-dashboard-taskcard-multistatus-minitable` 的 `wk-prod-1788275557`）模拟同 runId 两次触发 suite，验证两份日志各自独立、都可读；（⛔ 只在合成 fixture 上验证、无真实数据回放 ⇒ 假，同硬规则3b）。

## Definition of Done

同一 runId 内多次 suite 运行的日志互不覆盖、下游指针可回溯到本次尝试自己的文件；AC1-AC4 全勾；有轮转/清理策略避免 `.quay/` 无限堆积；用真实发生过的多 attempt runId 做过回放验证（不仅是合成 fixture）。

## Touches

- plugin/scripts/worker-driver.ts（`suiteLogFile` 路径生成逻辑，`:2359-2360` 附近；`step()`/`spawnSuiteAndWait`/`defaultMechanicalSuiteCommand` 调用点；轮转/清理逻辑）
- plugin/test/worker-driver.test.mjs（同 runId 多次触发 suite → 日志不覆盖 + 下游 `verdict.logFile`/`suiteLog` 指针正确性测试；轮转/清理负控制）
- tasks/gap-fan-in-suite-log-same-runid-overwrite.md（自身）
