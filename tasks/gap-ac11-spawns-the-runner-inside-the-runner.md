---
id: gap-ac11-spawns-the-runner-inside-the-runner
title: "AC11 spawns a full scripts/test.sh inside the suite — isolation-green,
  suite-red, and it blocks AC1's reproducibility"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

exp6 阶段 1 的 **AC1 要求「全量 0 失败，且在 fan-in 后可重现」**。外层在同一 commit 上连跑两次：

| 次 | tests | pass | fail | 墙钟 | exit |
|---|---|---|---|---|---|
| 1（01:05Z） | 2344 | 2326 | **0** | 443s | 0 |
| 2（01:20Z） | 2344 | 2325 | **1** | 472s | 1 |

**同一 commit，两次结果不同 ⇒ AC1 不可重现，未达成。**

失败项：

```
✖ AC11 — scripts/test.sh explicit-file form still runs (smoke, pinned name pattern)
  AssertionError: explicit-file form must exit 0, got 1
```

（`plugin/test/select-tests-for-touches.test.mjs:384`）

### 隔离下 100% 绿

```
第 1 次: tests 19 · pass 19 · fail 0
第 2 次: tests 19 · pass 19 · fail 0
第 3 次: tests 19 · pass 19 · fail 0
```

**这是今晚第三个「隔离绿、套件红」实例**（前两个：M136 已修、relation-sync 已修）。

### 但这个的机制比前两个清楚

该测试**在套件内部又 spawn 一个完整的 `scripts/test.sh`**：

```js
// plugin/test/select-tests-for-touches.test.mjs:73
return spawnSync("bash", [TEST_SH, ...args], { timeout: 60_000, ... });
```

而 `scripts/test.sh` 自 B5-1 起会先跑 `build_dist_once`，**构建失败即致命**
（`refusing to run tests against a possibly-stale bundle`）。

于是在外层套件以 `--test-concurrency=8` 跑在 **4 核**机器上时（B6-1 实测：这已是 2 倍过订），
嵌套的那次运行要在争抢中完成一次 esbuild 构建 + 一轮测试，60 秒预算下**失败是可预期的**，
不是偶发。

**这是一个结构性问题，不是这一个测试的 bug**：在 runner 内部起 runner，就把外层的负载状况变成了
内层的成败条件。

## Chosen mechanism

**先确认成因，再决定改哪一层。不要先加 timeout。**

1. **拿到嵌套运行的实际失败输出**。当前断言只报 `got 1`，丢掉了子进程的 stdout/stderr——
   与 relation-sync 的 harness 缺陷同族（**一个说不出自己为何失败的测试，其调查成本由所有后来者
   承担**）。第一步是把子进程输出打进断言消息。
2. **按成因分流**：
   - 若是 `build_dist_once` 在争抢下失败 → 嵌套调用应跳过构建（新增一个「已构建，勿重建」的入口
     或环境变量），而不是加大 timeout
   - 若是 60 秒预算本身不够 → 那也说明「在 runner 内跑 runner」的成本不可控，应改为**不 spawn**：
     该 smoke 想验的是「显式文件形态仍然工作」，可以用更便宜的方式验证（例如只验 dispatch 分支的
     选择结果，不真正跑测试）
3. **明确不做**：不加大 timeout、不 skip、不标 flaky。今晚已有两次证明这类失败是可修的真实缺陷。

## Acceptance Criteria

- [ ] AC1: 断言失败时输出嵌套 `scripts/test.sh` 的 stdout/stderr（当前只有 `got 1`）
- [ ] AC2: 给出成因，证据是嵌套运行的实际输出，不是推测
- [ ] AC3: 修复后全量套件**连跑 2 次全绿**（一次不算——本任务的存在正是因为一次绿骗过了外层）
- [ ] AC4: 隔离下仍绿
- [ ] AC5: 若成因是嵌套构建，记录「在 runner 内跑 runner」的其它调用点并逐个判断是否同病
      （`grep -l "TEST_SH\|scripts/test.sh" plugin/test/*.test.mjs`）
- [ ] AC6: 不加大 timeout、不 skip、不降级——任务体写明所选方案为什么不是这三者
- [ ] AC7: 测试带 `// @test-group engine` 声明

## Definition of Done

- [ ] AC1 的实际子进程输出与 AC3 的两次全量结果贴进任务体
- [ ] `scripts/test.sh` 绿
- [ ] 明确记录：**AC1「可重现」这条要求今晚第一次兑现了价值**——第一次全量 0 失败，
      若据此宣布达成即为错误；第二次才暴露

## Touches

- plugin/test/select-tests-for-touches.test.mjs
- scripts/test.sh
