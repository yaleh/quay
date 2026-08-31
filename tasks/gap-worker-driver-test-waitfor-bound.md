---
id: gap-worker-driver-test-waitfor-bound
title: worker-driver.test.mjs waitFor 上限收紧（5s×17 / 60s×7 → 3s / 30s）——只降慢机最坏情况（Tier 1）
status: ready
labels:
  - gap
  - test-wall-clock
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`worker-driver.test.mjs` :230 `waitFor(fn, timeoutMs = 10000, stepMs = 20)` 上限偏宽（5s×17 / 60s×7 调用点），慢机最坏情况把墙钟顶高。收紧上限（→ 3s / 30s）只降最坏情况，快乐路径早退不变。**⛔ 先量「快乐路径实际耗时」再设新上限**（硬规则 4：成本结构未知不设数值阈值）——收紧的是上限不是等待本身。

## Plan

1. 量快乐路径实际耗时（跑该文件、打印 waitFor 实际等到的最大步数）。
2. 按实测设新上限（建议 3s/30s，但以实测为准），快乐路径早退不受影响。

## Acceptance Criteria

- [x] AC1（能取假）：waitFor 上限按实测收紧——贴「快乐路径实际耗时」读数 + 新上限 + 理由；（⛔ 无实测读数就设新值 ⇒ 假，硬规则 4）。
- [x] AC2（能取假）：收紧后单测全绿（scoped 跑该文件）；（⛔ 红 ⇒ 假）。

## Definition of Done

waitFor 上限收紧落地（带实测读数）；AC1-AC2 全勾；scoped 全绿。

## Touches

- plugin/test/worker-driver.test.mjs（waitFor 上限 + 调用点）
- tasks/gap-worker-driver-test-waitfor-bound.md（自身）

## Implementation（AC1 实测读数 + 决定）

实测法：临时在 `waitFor` 内记录每次调用的 `elapsed/steps/ok`，`process.on("exit")` 汇总按上限桶打印；跑全文件 3 次（机器满载 load≈11–17/16 核、27 node 进程）：

- **60s 桶（7 调用点）快乐路径 max elapsed = 2.3s / 2.3s / 5.0s**（3 次跑）。全部 ≪ 30s（6× 余量）。
  → **60s→30s 落地**。另：liveness 接线测试的一个 60s waitFor（`readOutcomeLines>=2`）**每次都满窗超时**（谓词永不满足、但断言不依赖它），60s 白烧——收紧后省 30s 墙钟。
- **5s 桶（19 调用点）快乐路径 max elapsed = 1.9s / 4.2s / 4.6s**（第 3 次跑还有 1 次 5.0s 边际超时）。
  → **保持 5s，⛔ 不收紧到 3s**：实测否决建议的 3s——满载下快乐路径已到 4.6s（92% 上限），3s 会 flaky。
  注释 :230 说冷启动「可 >1s」，实测满载下冷启动≈3–4s ⇒ 5s 是正确上限而非偏宽。

决定：只收紧 60s→30s（7 处）；5s→3s 不落地（建议值被实测否决）。AC2 绿：`node --experimental-strip-types --test plugin/test/worker-driver.test.mjs` → 133 pass / 0 fail。
