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

- [x] AC1: `checker-cost.test.mjs` AC2 断言改为「ms>=delayMs」确定性下界（不依赖跨子进程严格单调）。
- [x] AC2: 负控制——负载下（多子进程并发）断言仍绿（不再因抖动红）。
- [x] AC3: 该文件不再触发 suite-fix 越界修（KNOWN-LOAD-SENSITIVE 走 release）。

## Definition of Done

- [x] 负载下 `checker-cost.test.mjs` AC2 断言绿（确定性下界，不依赖抖动），scoped 绿（真实输出）。

## Evidence（内层实现 2026-08-19）

AC1/AC2 改动：`plugin/test/checker-cost.test.mjs` 的 AC2 断言由「跨 3 子进程 ms 严格单调
（`rows[2].ms > rows[1].ms > rows[0].ms`）」改为「每轮 `ms >= delayMs` 确定性下界」，同步把 stale 阈值
`400/800/1200` 改为与已拓宽 delay seam 一致的 `500/1500/3000`；并移除同族的 `a.ms < b.ms`
（run1 500ms vs run2 1500ms，1000ms gap 也会被 node 启动抖动反向）。下界可靠性：`checker-cost.sh`
在 `sleep delayMs` 之后重读时钟，`ms = command_time + sleep >= delayMs`（`command_time >= 0`、
`sleep >= 请求时长`）。KNOWN-LOAD-SENSITIVE 标记与 header 注释保留（更新为下界语义）。

负控制（AC2）：scoped 全绿 + 单测在真实负载下 3 连绿。

```
# scoped（此时机器 loadavg 1min ≈ 30，两路 full-suite 并发跑）
$ bash scripts/test.sh --for-task gap-checker-cost-ac2-assertion-dejitter
EXIT_CODE=0
✔ AC2 — ready-pool-check run 3x (35.8→91.2→157.0) yields a readable cost+load sequence; same-n points distinguished by load (9020.683711ms)
ℹ tests 12
ℹ pass 12
ℹ fail 0
ℹ duration_ms 25053.427586

# 负控制 3 连跑（loadavg 1min = 34.24 / 32.78 / 30.33）
$ node --no-warnings --experimental-strip-types --test --test-name-pattern "ready-pool-check run 3x" plugin/test/checker-cost.test.mjs
RUN 1 (load 34.24): ✔ AC2 — ready-pool-check run 3x ... (10486.849686ms)  pass 1 fail 0
RUN 2 (load 32.78): ✔ AC2 — ready-pool-check run 3x ... (10602.079112ms)  pass 1 fail 0
RUN 3 (load 30.33): ✔ AC2 — ready-pool-check run 3x ... (9206.905909ms)   pass 1 fail 0
```

AC3：文件 header 第 4 行 `KNOWN-LOAD-SENSITIVE` 标记保留；断言已确定性化，负载下不再产生
「ms is monotonically increasing」红——即不再有负载诱发的红可触发 suite-fix 越界修（Path A release）。

## Touches

- tasks/gap-checker-cost-ac2-assertion-dejitter.md（自身）
- plugin/test/checker-cost.test.mjs（AC2 断言去抖动）
