---
id: gap-a-widened-wait-window-was-closed-on-evidence-that-cannot-discriminate
title: "A RESUMED wait window was widened 8s→25s and closed on 'the suite went green' — the one evidence that cannot tell a fix from a dilution"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`gap-session-liveness-stage-2-screen-signal-and-payload` 在 2026-08-03 21:48Z 关闭。
它的 `AC6/AC7 — RESUMED carries the cause AND the last-input time from the transcript`
在两次全量套件里真红（suite7、suite12），修法是 `cfbc7459 20:51Z`：
**把 RESUMED 等待窗口从 8s 放宽到 25s。**

任务体给出的结案理由，逐字是：

> RESUMED 等待窗口 8s→25s（`cfbc7459`，争抢下 8s 不足、机制正确），**suite14 绿覆盖**。

**「suite14 绿覆盖」不能支撑「机制正确」这个结论**——这正是本条要修的东西：

| 真实情况 | 8s 窗口 | 25s 窗口 | suite 结果 |
|---|---|---|---|
| 机制正确，只是竞争下慢 | 红 | 绿 | **绿** |
| 断言被稀释（载荷根本不出现，只是等得久了才不检查） | 红 | 绿 | **绿** |

**两行的观测结果完全一样。** 放宽窗口后的一次绿，对这两种情况的区分力是零。

**这不是说修法错了**——「争抢下 8s 不足」很可能是真的，`cfbc7459` 也许完全正确。
**问题是结案时没有任何证据能把它与稀释区分开**，而外层在 21:42Z 明确要过这个证据
（21:43 发出，21:48 fan-in，其间无提交增加该控制）。

### 为什么值得单独立一条

**放宽超时是本仓最容易发生、也最难事后察觉的降级形态**：它不报错、不留痕、且每次都伴随一次绿。
今天已经有三次同族记录（假绿 `cancelled` 掩盖真红、变异体污染 gate 测试、监视器跑过时副本），
**共同点都是「从外面看，好的和坏的长得一样」**。

## Contract

```
measure payload_absent_result = `scripts/test.sh plugin/test/session-liveness.test.mjs` 在载荷被移除后输出的 fail 计数字段
measure window_ms = `grep -nE 'RESUMED.*(2500|25000|25s)' plugin/test/session-liveness.test.mjs` 命中的等待窗口毫秒字段
band payload_absent_result = red
invariant 放宽等待窗口只能改变「等多久」，不得改变「不满足时会不会红」
invoke `scripts/test.sh plugin/test/session-liveness.test.mjs`
control 移除 transcript 载荷（读空）或使 cause 字段缺失 ⇒ 必须红；恢复载荷 ⇒ 必须绿
resume 先在 25s 窗口下做载荷缺失控制，再决定窗口值是否需要回调
```

## Chosen mechanism

1. **在当前 25s 窗口下做载荷缺失负控制**：让 transcript 读取返回空、或让 `cause` 字段缺失，
   **测试必须仍然红**。实跑输出贴任务体。
2. **若它在载荷缺失时也绿** ⇒ 25s 不是容忍竞争，是稀释断言 ⇒ 修断言本身，不是调窗口。
3. **若它仍红** ⇒ `cfbc7459` 被证实，把这次实跑输出补进 sl2 的任务体，
   **让那句「机制正确」第一次有支撑**。
4. **顺带定一条通用纪律**（写进 `plugin/test/session-liveness.test.mjs` 文件头或测试策略文档）：
   **任何放宽等待窗口的改动，必须同时给出「被等待物缺失时仍然红」的实跑证据**——
   否则放宽与稀释不可区分。

**不做**：不回退 `cfbc7459`（没有证据说它错）；不把窗口调回 8s（那只会让真实竞争重新致红）。

## Acceptance Criteria

- [ ] AC1: **载荷缺失负控制**——25s 窗口 + transcript 读空 ⇒ 测试**红**（实跑输出贴任务体）
- [ ] AC2: **正向对照**——同一窗口 + 载荷正常 ⇒ 测试**绿**（实跑输出贴任务体）。
      **两个方向都贴，缺一不可**——只有 AC1 说明它会红，只有 AC2 说明它会绿，
      **只有两条同时成立才说明它在看载荷**
- [ ] AC3: `cause` 字段缺失（与 transcript 读空是两条不同路径）单独做一次 ⇒ 必须红
- [ ] AC4: **窗口值有据**——记录 25s 是怎么定出来的（实测竞争下的真实到达时延），
      而不是「调到过为止」；若无实测依据，如实写明它是经验值
- [ ] AC5: **通用纪律落到文件里**——放宽等待窗口须附「缺失仍红」证据，写进测试文件头
- [ ] AC6: 结果回填 sl2 任务体，替换掉「suite14 绿覆盖」这个不能区分的理由
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1 与 AC2 两个方向的实跑输出都贴进任务体
- [ ] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**——
      本仓 2026-08-03 已发生一次 `fail 0 / cancelled 2` 的假绿）
- [ ] 任务体记录：**关闭一个任务时，「套件绿了」对「放宽窗口 vs 稀释断言」的区分力是零**

## Touches

- plugin/test/session-liveness.test.mjs
- plugin/scripts/session-liveness.sh
- tasks/gap-session-liveness-stage-2-screen-signal-and-payload.md

## Dispatch review

reviewer: outer
at: 2026-08-03T21:50:00Z
changed: **不重开 sl2**——它其余证据充分（AC2/AC5 双向负控制都在、DoD 如实标了 `[~]` 仅 1 次全量绿），
重开一个已绿的任务代价大于收益。**但这条缺口必须留下记录**，因为它正是外层今晚
明确要过、而在 fan-in 前没有被补上的那一条（21:43 发出请求，21:48 fan-in，其间无相关提交）。
**本条的立案理由不是「内层没听」**，而是**结案理由本身没有区分力**：
放宽窗口后的一次绿，对「机制正确」与「断言被稀释」的区分力是零——两种情况观测完全一样。
**并且明写不做什么**：不回退 `cfbc7459`（没有证据说它错）、不把窗口调回 8s（真实竞争会重新致红）。
**AC1+AC2 必须成对**：只有红的一半说明它会红，只有绿的一半说明它会绿，
**两条同时成立才说明它在看载荷**——这是本仓今天反复用到的双向控制纪律。
**AC5 把这次的教训一般化**：任何放宽等待窗口的改动都须附「被等待物缺失时仍然红」的证据，
否则**放宽与稀释在观测上不可区分**——这是今天第四次「从外面看，好的和坏的长得一样」。
