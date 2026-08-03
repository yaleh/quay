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

## Implementation (gap-ac11, 2026-08-03)

**选层与修法**：成因分流落在「嵌套构建」支路 → **`QUAY_TEST_SKIP_DIST_BUILD=1` 环境变量**，由嵌套
调用方（`spawnTestSh`）设置，`scripts/test.sh` 的 `build_dist_once()` 顶部识别并跳过重建。嵌套运行
仍走完整 test.sh 分发（`run_static_checks` → `exec node --test ...`），只省掉重复的 dist 重建
（2×esbuild + vendor mirror）。这些嵌套测试从不消费 dist bundle（AC10/AC11-smoke 钉
`--test-name-pattern` 到纯 selector/0 匹配；2 个 REGRESSION 在 `--for-task` 分支于 `build_dist_once`
之前就退出），所以跳过重建不可能测到旧代码——真实消费 bundle 的路径仍由 cli-entry.mjs 的 mtime
门槛与 sync-vendor --check 把关。

**AC1**：断言消息**本来就**嵌入了嵌套 stdout/stderr（`\nstdout: ${res.stdout}\nstderr: ${res.stderr}`），
经受控失败复现验证会完整渲染。外层报告只见 `got 1` 是**报告截断**（多行断言消息只留第一行），非断言缺失。

**AC2（成因证据）**：
- 嵌套运行全量成本：隔离 3.7s → 8 路套件+兄弟批次下 9–16s（实测 AC10 16.1s、AC11 4.5s）；失败形态
  `got 1`（真退出码 1，非 timeout 的 null）说明是某一步在争抢下失败，而 build_dist_once 是最重、
  最受争抢影响的步骤（B5-1 起每次 test.sh 都重建）。
- 外层 run 2（01:20Z）时机器上同时有 3 个兄弟 worktree 批次在跑各自的套件（外层 commit f0f03896 证实）
  —— 4 套件并发，2–5×过订（B6-1：concurrency 8 在 4 核已是 2×）。
- 隔离/worktree 下 3 次全绿（19/19）无法复现 —— 与任务描述一致。

**AC5（其它「runner 内跑 runner」调用点）**：
| 文件 | 调用 | 判断 |
|---|---|---|
| `plugin/test/select-tests-for-touches.test.mjs` | `spawnTestSh`（AC10/AC11/2×REGRESSION） | **已修**：设置 `QUAY_TEST_SKIP_DIST_BUILD=1` |
| `plugin/test/runner-grouping.test.mjs` | `runTestSh`/`runTestShRaw`（line 29/43, timeout 120s/300s） | **同病但较轻**：预算更大、跑 `--group governance/product` 子集（非全量 product,engine）、且有意跑真实 fixture 测试（跳过构建会改变其验证对象）——本次未改（不在 Touches） |
| `experiments/.../test/*.test.mjs` | 无真实重复 spawner（均为 symlink 镜像，realpath 去重） | 无病 |

其余 `grep -l "TEST_SH\|scripts/test.sh"` 命中均为注释/字符串引用，非 spawn。

**AC6（为什么不是 timeout/skip/降级）**：
- **不加大 timeout**：60s 预算不是缺陷；缺陷是内层为验一个分发分支而付全量 runner 成本。加 timeout 只会
  给一台已 2–5×过订的机器（B6-1 实测 2×；失败 run 2 为 4 套件并发）更宽的墙钟窗口。任务体明确不做。
- **不 skip**：smoke 仍然跑——仍 spawn test.sh、仍走完整显式文件分发、仍断言 exit 0；只跳过**冗余的**
  重建（这些嵌套测试从不消费 dist bundle，跳过后不可能测到旧代码）。验证目标（分发 → node --test
  直通）完整保留。
- **不降级/不标 flaky**：这是真实结构性缺陷（runner-in-runner），不是偶发。今晚 M136、relation-sync 两次
  证明这类失败是可修的真实缺陷——我们修机制，不糊症状。

**AC7**：`// @test-group engine` 在文件第 1 行（既有）。

## Acceptance Criteria

- [x] AC1: 断言失败时输出嵌套 `scripts/test.sh` 的 stdout/stderr（受控失败复现验证渲染完整）
- [x] AC2: 成因证据=嵌套成本实测（3.7s→9–16s）+ 退出码 1 非 null + 外层 4 套件并发的结构分析
- [x] AC3: 修复后全量套件**连跑 2 次全绿**（2344/0 fail 两次，见 DoD 实测表）
- [x] AC4: 隔离下仍绿（3 次 19/19）
- [x] AC5: 其它调用点已记录并逐个判断（select-tests 已修 / runner-grouping 同病较轻未改）
- [x] AC6: 方案=跳过冗余重建；不是 timeout/skip/降级（理由见上）
- [x] AC7: 测试带 `// @test-group engine` 声明（第 1 行，既有）

## Definition of Done

### AC3 实测（worktree task/ac11-runner-fix，脚本 `scripts/test.sh` 无参全量）

| 次 | tests | pass | fail | exit | AC10 | AC11-smoke |
|---|---|---|---|---|---|---|
| run 1 | 2344 | 2326 | 0 | 0 | 8305ms | 4172ms |
| run 2 | 2344 | 2326 | 0 | 0 | 8263ms | 1886ms |

AC4 隔离实测（`--for-task gap-ac11-spawns-the-runner-inside-the-runner`，3 次）：
19/19 pass ×3（AC10 ~2.2s、AC11-smoke ~1.1s）。

### AC1 实际子进程输出（受控复现）

断言消息（`select-tests-for-touches.test.mjs:399`）本就嵌入嵌套 stdout/stderr；受控失败复现渲染为：

```
explicit-file form must exit 0, got 1
stdout: BUILD-OUTPUT-LINE
stderr: ERROR-LINE
```

外层报告只见 `got 1` 是**多行断言消息被外层报告截断到第一行**，非断言缺失——AC1 由既有断言满足，
本任务未改断言（只改嵌套构建路径）。

- [x] AC1 的实际子进程输出与 AC3 的两次全量结果贴进任务体（上表 + 受控输出）
- [x] `scripts/test.sh` 绿（AC3 两次全量 2344/0 + AC4 隔离 3×19/19）
- [x] 明确记录：**AC1「可重现」这条要求今晚第一次兑现了价值**——第一次全量 0 失败，
      若据此宣布达成即为错误；第二次才暴露（本任务正是该证据的产物）

## Touches

- plugin/test/select-tests-for-touches.test.mjs
- scripts/test.sh
