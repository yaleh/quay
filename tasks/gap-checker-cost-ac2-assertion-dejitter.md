---
id: gap-checker-cost-ac2-assertion-dejitter
title: "checker-cost AC2 断言去抖动——「跨 3 子进程 ms 严格单调」是抖动依赖，改「ms>=delayMs」确定性下界"
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

`checker-cost.test.mjs` AC2 断言「跨 3 子进程 ms 严格单调」依赖抖动（负载下 4 轮 > 60s 会破坏严格单调），被 suite-fix 越界修（dod-check-timing 的 b6e2f15d，第 5 例）。修法内容本身合法——把「跨 3 子进程 ms 严格单调」的抖动依赖断言改成「ms>=delayMs」确定性下界（人允许的「优化测试本身」方向）。该文件标 KNOWN-LOAD-SENSITIVE，应走 Path A release 而非越界修，但断言去抖动是独立正确项，应独立立案（非塞进任何 fan-in 任务）。

## Acceptance Criteria

- [ ] AC1: `checker-cost.test.mjs` AC2 断言改为「ms>=delayMs」确定性下界（不依赖跨子进程严格单调）。
- [ ] AC2: 负控制——负载下（多子进程并发）断言仍绿（不再因抖动红）。
- [ ] AC3: 该文件不再触发 suite-fix 越界修（KNOWN-LOAD-SENSITIVE 走 release）。

## Definition of Done

- [ ] 负载下 `checker-cost.test.mjs` AC2 断言绿（确定性下界，不依赖抖动），scoped 绿（真实输出）。

## Touches

- tasks/gap-checker-cost-ac2-assertion-dejitter.md（自身）
- plugin/test/checker-cost.test.mjs（AC2 断言去抖动）
