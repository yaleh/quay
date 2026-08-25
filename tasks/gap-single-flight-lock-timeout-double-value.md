---
id: gap-single-flight-lock-timeout-double-value
title: single-flight 锁超时双值（fan-in 900s vs 其余 600s）+ 600s 线已被跨越（活 suite 被误杀
  fail-closed）
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

single-flight 锁超时在同一队列上有两套值：`FULL_SUITE_LOCK_TIMEOUT` 默认 **600s**（`scripts/test.sh:651` + `:697-708`），fan-in 启动 detached suite 经 env 覆盖 **900s**（`fan-in-execute.js:141` `suiteLockTimeoutSecs ?? 900`，`:217`/`:244` 传入）。**同一把锁、同一队列，两套超时。**

**设计意图与风险错位**（`test.sh:618-625` 注释）：要同时防「绝不给第 (S+1) 个 GO」（正确性）与「绝不无限挂起」（活性）。但正确性是 flock 守的；注释自己写明 `flock's crash-autorelease is PRESERVED: a dead suite can never leak a slot` ⇒ **「死持有者泄漏槽」结构上不可能**。真正能触发超时的只剩：**活着的持有者跑得比超时久**——而这是当前常态（full bucket 实测 819-1619s）。

**12h 实测**（verification-round.jsonl，16:35→04:35Z）：46 轮、13 轮（28%）等锁、合计 4937s；max 等待 **781s**（距 900s 杀线仅 13%）；>600s 的 3 轮（764/766/781s）、>900s 的 0。⇒ 那 3 轮若走默认 600s 路径会全部 fail-closed，它们活下来只因恰好是 fan-in 启动的。

**窗口内 1 次真实 900s fail-closed**（worker-driver.log:3907）：「not starting (single-flight lock; waited 900s)」「Zero __PERFILE__ passed=false across all 4 attempts — no test ever actually ran」——4 个 fix round 全红、一个测试没跑，纯 3 任务 fan-in 抢 1 slot。受害 `gap-suite-concurrent-session-liveness-cross-contamination` 至今 ready 未落地，烧 3 次派发 ≈ 5.3 worker-hours。

## Plan

三选一（或组合）：
① 消除双值——两条路径读同一来源；
② 值不字面常量（依赖 suite 时长 + slot 数，硬规则 4 推论二同族），从实测 suite 上界派生，或直接不设上界靠 flock 自身 crash-autorelease（注释已确认该保证成立）；
③ 若保留有界等待，判据：**超时值 ≥ 近 N 轮 suite 时长 p99**，否则它守的不是活性而是制造假红。

⛔ **注意 fixture 红是对的**：`plugin/test/fan-in-execute-paths.test.mjs:2199/:2206` 的 fixture 把 `600` 字面量与 fail-closed 文案写死在断言里——AC1 改成单一来源时该 fixture 会红，这是【对的】（硬规则 4 推论二检测半边：检查通过恰恰证明用了即将失效的字面量），连同判据一起更新，不要当噪声绕过。

## Acceptance Criteria

- [ ] AC1（能取假，无双值）：fan-in 与其余路径读同一超时来源（⛔ 仍有 600/900 双值 ⇒ 假）。
- [ ] AC2（能取假，超时不误杀）：超时值 ≥ 近 N 轮 suite 时长 p99（或直接不设上界靠 flock crash-autorelease）；（⛔ 超时值仍 < p99 会误杀活 suite ⇒ 假）。

## Definition of Done

超时双值消除；AC1-2 全勾；不再有「活 suite 被超时误杀 → fail-closed 假红 → 重试放大」。

## Touches

- scripts/test.sh（FULL_SUITE_LOCK_TIMEOUT）
- plugin/workflows/fan-in-execute.js（suiteLockTimeoutSecs ?? 900）
- plugin/test/fan-in-execute-paths.test.mjs（:2142-2279 负控制 fixture，改 AC1 必碰）
- tasks/gap-single-flight-lock-timeout-double-value.md（自身）