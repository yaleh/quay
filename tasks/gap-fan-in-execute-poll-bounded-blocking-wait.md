---
id: gap-fan-in-execute-poll-bounded-blocking-wait
title: "fan-in-execute 轮询 agent 内有界阻塞等待（timeout 540）——收益最大，需设计边界判定 + 取假测试"
status: ready
labels:
  - gap
  - performance
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

fan-in-execute 轮询每次「看一眼 marker 在不在」必须借一个 agent 的身体（脚本沙箱零 I/O，无 require/process/fetch——`fan-in-execute.js:53-55` 注释实测），`pollIntervalMs=60_000` 固定 60s 起轮，suite 实测 11–19min ⇒ 头 11–15 次结构上必然 not-done 纯空转（~21 次/轮 suite 等待）。这个「脚本 setTimeout 轮询 + agent 短促只读」设计本身不该推翻——它解决了两个有实证的事故（`gap-fan-in-turn-budget-suite-timeout` 回合预算耗尽 + ab380c5e agent 挂死）。

**②有界阻塞等待**（收益最大 ~21→~3 次，但需设计判定）：把 `timeout 540 bash -c 'while [ ! -f marker ]; do sleep 15; done'` 放进轮询 agent（Bash 工具上限 600s，540 安全）。

**必须回答的反例问题**：这会不会重演 ab380c5e（agent 挂死）？manager 初步判断**不会**——那次是「agent 自己决定等多久」，这里 `timeout 540` 是硬边界、「要不要继续等」的决策权仍在脚本手里。但这条削弱了原注释承诺的「短促只读、一回合内返回」，**不能只靠推理判定安全**——必须先加一条取假测试守住「等待有硬边界、决策权在脚本」这条边界。

## Acceptance Criteria

- [x] AC1: 轮询 agent 内做有界阻塞等待（`timeout 540` + `sleep 15` 循环），轮询次数 ~21→~3（硬边界 540s < Bash 600s 上限）。
- [x] AC2: 取假测试——`plugin/test/fan-in-execute-paths.test.mjs` 加一条守「等待有硬边界（timeout 540）、决策权仍在脚本」的测试（能取假：把 timeout 去掉/放宽 >600s ⇒ 测试红，证明不是靠推理）。
- [x] AC3: 反例问题（ab380c5e）的判定依据写进任务体并附对照——「agent 自决等待」vs「脚本控制流硬边界 + timeout 540」是两类，前者是事故、后者是脚本手里有界等待。

## Definition of Done

- [x] 一轮真实 suite 等待：轮询次数 ~3（有界阻塞等待生效），取假测试绿（边界被测试守住而非靠推理），scoped 绿（真实输出，非 fixture）。

## Evidence

**AC1**：`pollSuite()` 轮询 prompt 现为 `timeout 540 bash -c 'while [ ! -f "$1" ]; do sleep 15; done' _ "$suite_exit_marker" || true`——agent 一次最多阻塞 540s（硬边界 < Bash 600s 上限）、每 15s 看一眼 marker，21min suite 的 ~21 次空转压到 ~3 次；硬边界与粒度经 `pollBlockSeconds`/`pollBlockSleep` 参数化（默认 540/15，测试可覆盖）。scoped 真实输出（`bash scripts/test.sh --for-task gap-fan-in-execute-poll-bounded-blocking-wait --allow-thin`，EXIT=0）：`tests 56 / pass 56 / fail 0 / duration_ms 24914.2`。

**AC2**：新增 ⑩ 两条——wiring（断言 `timeout <N> bash -c` 存在、`<600`、`===540`、`while [ ! -f "$1" ]; do sleep 15; done` 循环等 marker、「不要做任何等待决策」）+ REAL（后台进程 1s 后写 marker，poll 在【一次】阻塞内 ~1214ms 等到，证明「阻塞等待生效」而非 N 次空转）。负控制实测：把默认 `pollBlockSeconds` 由 540 放宽到 1200 ⇒ 测试红（`AssertionError: the blocking-wait hard bound must be < Bash 600s limit, got 1200s`），恢复后两拷贝字节一致。

**AC3**：ab380c5e = agent **自决**等多久、无硬边界 ⇒ 挂死；本实现 = 脚本给**硬边界** `timeout 540`、超时交还脚本（not-done）、`maxSuitePolls` 循环上限 + `pollIntervalMs` 外层间隔仍在脚本手里 ⇒ 两类不同：前者事故、后者脚本手里有界等待。AC2 的取假测试把这条边界从「推理」变成「被测试守住」。

## Touches

- tasks/gap-fan-in-execute-poll-bounded-blocking-wait.md（自身）
- plugin/workflows/fan-in-execute.js（轮询 agent 内有界阻塞等待）
- .claude/workflows/fan-in-execute.js（与 plugin/workflows 同步）
- plugin/test/fan-in-execute-paths.test.mjs（等待边界取假测试）
