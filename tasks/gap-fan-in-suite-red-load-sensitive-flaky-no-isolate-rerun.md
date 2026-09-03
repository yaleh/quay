---
id: gap-fan-in-suite-red-load-sensitive-flaky-no-isolate-rerun
title: 机械 fan-in suite red 未隔离重跑 KNOWN-LOAD-SENSITIVE flaky，直接误杀任务
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

机械 fan-in 的 suite 步骤（step 7，跑全量 `scripts/test.sh --buckets <task>`）在 suite red 时**直接判 `exited-not-landed`**，不区分「真产品回归」与「KNOWN-LOAD-SENSITIVE 测试在并发负载下的 flaky」。实测 3 个任务（gap-mechanical-fan-in-writes-no-complete-gateevent / gap-suite-scheduler-legacy-phase-splitting-cleanup / gap-test-file-snapshot-worktree-drops-realinstall）fan-in 全部 suite red，失败全是已声明 `@load-sensitive wall-clock` 的 session-liveness 测试（scd-busy / target / signals-kinds 的「probe must be alive」「inner pane foreground must become claude stand-in」），非任务自身改动回归——三个 worker 各自诊断出「failure 全在无关的 session-liveness 测试，branch-lag 非本任务缺陷」，仍被误杀。「分区 + 隔离重跑」机制已存在于 `red-window-triage.ts`（`full-suite-runner.ts` 在 red time 写 KNOWN-LOAD-SENSITIVE partition，`red-window-triage.ts` 读它做 isolate-rerun），但 worker-driver 的 fan-in 路径只 `import { parseLoadSensitiveAnnotation }`（worker-driver.ts:130），**未接隔离重跑**——机制已实现但未接入 fan-in suite 路径。与 `gap-mech-fan-in-suite-silence-watchdog-fired`（done）不同机制：那是「suite 无输出被 15min 静默看门狗 SIGKILL」，这是「有输出、真实 fail 3、但是 load-sensitive flaky 非回归」。

## Plan

1. 核实 fan-in suite red 路径（worker-driver 的 mechanical-fan-in step 7）在 suite red 后**是否读** full-suite-runner 写的 KNOWN-LOAD-SENSITIVE partition、是否做隔离重跑——用 grep 确认对 `red-window-triage` / `isolate-rerun` / partition 的引用现状（预期 0）。
2. 接入：suite red 且**失败全在** KNOWN-LOAD-SENSITIVE 族 ⇒ 隔离重跑该族（复用 red-window-triage 的 isolate-rerun 语义）；隔离重跑绿 ⇒ 判「load-sensitive flaky 非真回归」，不 exited-not-landed（放行 fan-in 或标记为 flaky 重试）；隔离重跑仍红 ⇒ 真回归，维持现状 exited-not-landed。**三态不得压平**（硬规则 3b：真回归 / flaky / 未评估三分，勿与「真回归」同形），且 worker-outcome 的 `mechanical_fan_in.reason` / `failure_reason` **携带成因区分**（不再裸「suite red」，见 AC6）。
3. 负控制：一个非 load-sensitive 的真回归失败仍判 exited-not-landed（关闭隔离重跑分支后重跑必须仍报出）；一个 load-sensitive flaky（隔离重跑绿）不再误杀。数字是止血非结论（硬规则 4 推论），落笔当轮取真实读数（硬规则 4c）。

## Acceptance Criteria

- [ ] AC1（能取假）：grep worker-driver.ts（或 mechanical-fan-in 相关文件）对 `red-window-triage` / `isolate-rerun` / KNOWN-LOAD-SENSITIVE partition 的引用由 0 变 ≥1，打印命中行。
- [ ] AC2（生产载体）：构造一个「suite red 且失败全在 load-sensitive 族」的真实样本，隔离重跑绿 ⇒ 该任务不判 exited-not-landed（不误杀）。
- [ ] AC3（负控制，能取假）：关闭隔离重跑分支后重跑同一 load-sensitive flaky 样本，必须重新报出 exited-not-landed；且一个非 load-sensitive 的真回归失败仍判 exited-not-landed。
- [ ] AC4（三态）：suite red 判定输出能区分「真回归」「load-sensitive flaky（隔离重跑绿）」「读不到 partition ⇒ NOT-EVALUATED」三态，不得让「读不到」与「flaky」或「真回归」同形。
- [ ] AC5（既有不回归）：`--for-task` scoped 门 + 全量 suite 绿；fan-in 的既有路径（真回归仍 exited-not-landed）不退化。
- [ ] AC6（成因区分，能取假）：fan-in suite red 时 `worker-outcome` 的 `mechanical_fan_in.reason` / `failure_reason` 携带成因，不再把「真回归」「load-sensitive flaky（隔离重跑绿）」「silence watchdog」压平成同一个裸「suite red」标签（cause-carrier 有损投影，硬规则 3b）；判据：一条真实 fan-in suite red 样本的 reason/failure_reason 含成因词（如「load-sensitive flaky」/「真回归」），grep 该记录能区分成因。

## Definition of Done

fan-in suite red 的判定能区分「真产品回归」与「KNOWN-LOAD-SENSITIVE flaky」——load-sensitive 族失败**经隔离重跑确认后才判 exit**；实测 3 个误杀任务（mechanical-fan-in / scheduler-legacy / test-file-snapshot）不再因 load-sensitive flaky 反复 exited-not-landed。生产载体验证（非 fixture）：真实 fan-in suite red 样本中 load-sensitive 族失败触发隔离重跑，重跑绿 ⇒ 不误杀。

## Touches

- plugin/scripts/worker-driver.ts（fan-in suite red 路径接隔离重跑判定 + reason/failure_reason 携带成因）
- plugin/scripts/red-window-triage.ts（复用 isolate-rerun 语义，如扩展）
- plugin/scripts/full-suite-runner.ts（KNOWN-LOAD-SENSITIVE partition 写入侧，如需扩展）
- plugin/test/worker-driver-fan-in.test.mjs（隔离重跑不误杀断言 + 负控制 + 三态 + 成因区分）
- tasks/gap-fan-in-suite-red-load-sensitive-flaky-no-isolate-rerun.md（自身）
