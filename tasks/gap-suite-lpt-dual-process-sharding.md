---
id: gap-suite-lpt-dual-process-sharding
title: LPT 重排交付无效（node --test 无视 argv 顺序，A/B 证伪）⇒ 改双进程分片：最长 K 文件独立子进程 + 其余文件另一子进程
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**设计性失效（manager 2026-08-24 10:0xZ A/B 实验 + outer 独立复核）**：`gap-m-bucket-long-tail-lpt-scheduling`（已 superseded）落地的 LPT 重排**机制完全不起作用**。`suite-lpt-order.ts` 计算正确，但 `scripts/test.sh:1377-1380` 把重排结果喂给 `node --test "${files[@]}"`——**node --test 不看 argv 顺序，有自己的内部发现/排序（字母序）**。outer 独立复核：`node --test z-long.test.mjs a-short.test.mjs` 与 `a-short.test.mjs z-long.test.mjs` 两种相反顺序 → 起跑顺序完全相同（a-short 先、z-long 后）。

**生产数据（10:01:05Z，140 文件 16 车道）**：实测 span 702.8s，理论下界 451.9s（sum/lanes）/ 硬下界 491.4s（最长单文件）——多花 250s/55%；并发>1 只剩最后 98s（14% 墙钟，15 车道闲置只有 1 文件跑）；最长 5 文件（400-500s）实际 113-291s 才起跑，前 5 秒起跑的 23 文件全是短文件——与计算顺序完全相反。

## Plan

**结构性绕过（不依赖 node 尊重顺序）**：LPT 算出的最长 K 文件拆成**独立一个 `node --test` 子进程**，"其余文件"开**另一个子进程**，各分车道预算、同时后台起、一起 wait。两个真并行进程，长文件从 t=0 就在跑。**辅助（一起做，非二选一）**：拆分长测试本身（install-config-driven-e2e-*.test.mjs / quay-init-loop-*.test.mjs 单文件 400-500s 是硬下界，拆小硬下界跟着降）。

## Acceptance Criteria

- [ ] AC1（能取假，结构性并行）：最长 K 文件从 t=0 起跑（独立子进程，不再等 argv 顺序）——⛔ 仍 113-291s 才起跑 ⇒ 假。
- [ ] AC2（能取假，生产验证）：P bucket 轮 span 逼近下界——并发>1 的墙钟占比显著 >14%（⛔ 仍 ~14% 或更差 ⇒ 假）。

## Definition of Done

双进程分片落地 develop；AC1-2 全勾；生产一轮 span 从 702.8s 逼近下界、长文件 t=0 起跑（AC1/AC2 复现）。

## Touches

- scripts/test.sh（1377-1380 交付：双进程分片替代 argv 重排喂单进程）
- plugin/scripts/suite-lpt-order.ts（如适配：输出最长 K 拆分点）
- plugin/test/suite-lpt-order.test.mjs（或对应测试）
- tasks/gap-suite-lpt-dual-process-sharding.md（自身）