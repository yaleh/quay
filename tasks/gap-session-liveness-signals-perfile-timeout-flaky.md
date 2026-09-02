---
id: gap-session-liveness-signals-perfile-timeout-flaky
title: session-liveness-signals integration/thresholds 超 perfile-timeout（260s/254s）——A 类超时 flaky
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`plugin/test/session-liveness-signals-integration.test.mjs`（260421ms = 260s）+ `plugin/test/session-liveness-signals-thresholds.test.mjs`（254006ms = 254s）远超 60s perfile-timeout 阈值，超时（非 assertion）。pre-existing（integration 2 次 + thresholds 1 次）。与 test-file-snapshot 任务改动无关（它改 `--list-files` 漏列）。属 flaky 集群第 10 组，超时类（同第 5 组 runner-grouping 78s）。

**系统性归类**：这两组（runner-grouping 78s / session-liveness 260s）根是「并发 16 核下测试超 60s perfile-timeout」的超时类，与第 2/3 组（claude child/进程启动时序）不同子类。单条修超时/加 retry 是治标；根因是 perfile-timeout 阈值系统性偏紧（见 `gap-suite-perfile-timeout-global-widening`）。

## Plan

1. 该两个文件 perfile-timeout 处置：加长阈值 / 拆分慢用例到 serial/lowconc / 白名单（三选一）。
2. 若 `gap-suite-perfile-timeout-global-widening`（全局放宽）先行落地，本条可被其覆盖——实现时先查全局任务是否已 done。

## Acceptance Criteria

- [ ] AC1（能取假）：并发 load 下 session-liveness-signals 两文件不再 perfile-timeout 判 failed（duration 不超阈值或白名单豁免）；（⛔ 仍 failed ⇒ 假）。
- [ ] AC2（能取假，无回归）：两文件内部 pass/fail 不变（只改超时/分组，不改断言）；（⛔ 改断言 ⇒ 假）。

## Definition of Done

session-liveness-signals 两文件 perfile-timeout 处置落地（或由全局放宽覆盖）；AC1/AC2 勾；并发下稳定绿；内部 pass/fail 不变；全量 suite 绿。

## Touches

- plugin/test/session-liveness-signals-integration.test.mjs（超时/分组/白名单）
- plugin/test/session-liveness-signals-thresholds.test.mjs（超时/分组/白名单）
- tasks/gap-session-liveness-signals-perfile-timeout-flaky.md（自身）
