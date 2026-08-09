---
id: gap-runner-no-kill-on-red-and-no-max-runtime-hang-leak
title: full-suite-runner 判定 red 后不终止 test.sh 子进程且无最大运行时限——round-164 子进程挂起导致
  runner 泄漏 20+ 分钟，与 round-165 并发争抢/串写同一 full-suite.log ⇒ round-165 幻影式
  red（failures=[]、日志截断）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  defect_chain: round-164 leak → round-165 lock-blocked (never ran) →
    misclassified as reason=failed failures=[]
---
**type:** execution

## Proposal

**round-164（021c5cc0）runner 判定 red 后没有终止自己的 test.sh 子进程，且 runner 对套件子进程无最大运行时限——node --test 子进程挂起 ⇒ runner+test.sh 泄漏 20+ 分钟并持续持有 single-flight flock。round-165（37fb35b0）随后起跑，其 test.sh 被 flock 挡 600s 后退出（`another full suite holds .git/full-suite.lock — not starting (single-flight lock; waited 600s)`），日志里 0 行测试输出，runner 走 catch-all ⇒ `state=red reason=failed failures=[]`——应判 `reason=aborted`（无正确性结论）。**

### 实证（outer 2026-08-09 10:4x-10:52 红窗分诊）

- **round-164**：10:30 起跑（runId 021c5cc0）→ 10:34 判 red（proposal-convergence 20-child 并发失败）→ **runner 写 red 后没有 kill test.sh** → test.sh 继续跑；某 node --test 子进程（734860）挂起 → test.sh 永不退出 → runner 卡 `ep_poll` 等子进程（无时限）。
- **泄漏时长**：10:30 起跑到 10:52 手动 `kill -KILL`，>20 分钟。ps：469444 `Sl`(ep_poll)、469838 `S`(anon_pipe_read)、CPU 0——阻塞，非工作。
- **round-165 未跑测试**：10:39 起跑 → **其 test.sh 第一行即 lock-WAIT 消息**（`.quay/full-suite.log` 首行 `another full suite holds .git/full-suite.lock — not starting (single-flight lock; waited 600s)`）→ 等待 600s 后退出，**0 行测试输出**。runner 见非 0 退出 + 无 abort/failure 标记 ⇒ catch-all `reason=failed failures=[]`。durationMs=608814 ≈ 600s lock wait + overhead。
- **ABORT_PATTERNS 缺 lock-WAIT**：`const ABORT_PATTERNS = [/resource gate says WAIT/, /not running the full suite/]`——**没有** `another full suite holds` / `single-flight lock`。锁阻塞（无正确性结论）应判 aborted，却被 catch-all 判 failed。
- **runner 无最大时限**：`grep timeout` 只有辅助子进程的 2-10s timeout；**套件主子进程无运行时限、无挂起检测**。子进程挂起 = runner 永久泄漏。
- **泄漏链**：round-164 泄漏 → 持有 flock → round-165 锁阻塞未跑 → 误判 failed。根修复 = runner 不再泄漏（kill-on-red + 最大时限），则 flock 不会长期被占，round-165 类锁阻塞自然消失。

**为什么重要**：runner 是外层判定 suiteGreen 的唯一权威。它泄漏 = 后续轮次被锁阻塞 + 判定不可信（failures=[] 是「未跑」不是「失败」）。红窗分诊必须能识别「锁阻塞未跑」这条路径：`failures=[]` + 日志首行 lock-WAIT = aborted（无结论），不是 failed。

**修的方向（实现归内层）**：
- 候选 A：**red 判定后 kill 子进程树**——判 red/aborted 时 `child.kill('SIGTERM')` + 超时后 `SIGKILL`（进程组），不等子进程自然退出。
- 候选 B：**最大运行时限**——套件主子进程超上限（如 30-40 分钟，实测 ~15min）⇒ kill + `reason=timeout`，杜绝永久挂起。
- 候选 C：**挂起检测**——子进程长时间无 stdout（如 >15min 静默）⇒ kill + `reason=hung`。
- 候选 D：**ABORT_PATTERNS 补 lock-WAIT**——`/another full suite holds/` 与 `/single-flight lock; waited/` 进 ABORT_PATTERNS ⇒ 锁阻塞判 `reason=aborted` 而非 failed（与 resource-gate WAIT 同族：无正确性结论）。

**验证锚**：修后，(a) 构造「test.sh 挂起的 fake 套件」⇒ runner 时限内 kill 退出无泄漏；(b) 构造「red 后子进程不退出」⇒ kill 进程组；(c) 构造「锁阻塞」⇒ `reason=aborted` 非 failed；(d) 正常绿/红轮次不回归。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 round-164 泄漏 + round-165 锁阻塞实证（runner 卡 ep_poll 20+ 分钟 + 泄漏持 flock + round-165 test.sh 首行 lock-WAIT 0 测试输出 + failures=[] 误判 failed）（本任务 Proposal 已含；内层补：构造挂起 fake + 锁阻塞 fake 复现）
- [x] AC2: **red/aborted 判定后 kill 子进程树**——判 red 后 test.sh 子进程被终止（TERM→KILL 进程组），runner 正常退出
- [x] AC3: **最大运行时限或挂起检测**——超时/静默 ⇒ kill + `reason=timeout`/`hung`，绝不永久挂起
- [x] AC4: **锁阻塞判 aborted**——`/another full suite holds/` 进 ABORT_PATTERNS；构造锁阻塞 ⇒ `reason=aborted` 非 failed（与 resource-gate WAIT 同族）
- [x] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 runner 测试契约检查）；正常绿/红轮次不回归

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：构造挂起 fake ⇒ 时限内退出无泄漏；构造 red 后不退出 ⇒ kill；构造锁阻塞 ⇒ aborted（贴任务体）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/full-suite-runner.ts（red 后 kill 子进程树 / 最大时限 / 挂起检测 / ABORT_PATTERNS 补 lock-WAIT）
- plugin/test/full-suite-runner.test.mjs（新增：挂起 fake ⇒ kill；red 后不退出 ⇒ kill；锁阻塞 ⇒ aborted）
- scripts/test.sh（候选 D：lock-WAIT 消息形状核实）
- tasks/gap-proposal-convergence-load-flake-20-child-concurrency.md（交叉标注——round-164 红的真因是它，泄漏是它之后的新缺陷）
- tasks/gap-runner-no-kill-on-red-and-no-max-runtime-hang-leak.md（自身：勾 AC + 贴证据）

## Contract

measure   leak_duration_after_fix = `timeout 60 node --no-warnings --experimental-strip-types --test --test-name-pattern="killed at the|red-grace" plugin/test/full-suite-runner.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"` 通过/失败计数（3 条 kill 测试 ≤60s 全通过 = runner 正常退出，无泄漏）
band      leak_duration_after_fix = ≥ 3（kill 后 runner ≤60s 正常退出，无泄漏）
invariant runner_exits_after_red = 1（判 red 后 kill 子进程树并退出）
invariant lock_block_classified_aborted = 1（构造锁阻塞 ⇒ reason=aborted 非 failed）
invoke    `node --no-warnings --experimental-strip-types --test plugin/test/full-suite-runner.test.mjs`（新增挂起/泄漏/锁阻塞测试全绿贴回）
control   构造挂起 fake ⇒ 时限内退出；锁阻塞 ⇒ aborted；正常轮次不回归
resume    kill-on-red + 最大时限 + ABORT_PATTERNS 补 lock-WAIT 分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（round-164 runner 泄漏：判 red 后不 kill test.sh + 无最大时限 ⇒ 泄漏 20+ 分钟持续持 flock；round-165 test.sh 被 flock 挡 600s 0 测试输出，ABORT_PATTERNS 缺 lock-WAIT ⇒ 误判 reason=failed failures=[]。实现归内层）
