---
id: gap-suite-lock-starvation-long-validation-hold
title: 验证型长任务（如 serial-lowconc 33 文件 N 次重跑）持单飞锁数小时饿死全仓 fan-in，且与「worker 慢」在
  outcome 里同形不可区分
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

全局单飞锁（`.git/full-suite.lock.0`，`full-suite.lock.concurrency=1`）在「无界排队」语义下，被**验证型长任务**长时间独占，饿死全仓库其它 fan-in。实证 2026-08-25（manager CONFIRMED，第一手 /proc flock 扫描）：
- `gap-suite-serial-lowconc-classification-recheck` 的 Plan 就是「33 个 serial/lowconc 文件主并发池 N 次重跑」——`node --test --test-concurrency=16` 扫 407 文件，**单次 wall_clock = 312.6 分钟 = 5.2 小时**，全程持锁；
- 期间其它 fan-in（gap-ac148 / suite-load-sampler / split-long 等）全堵在「single-flight lock」排不上；
- `suite-load-sampler` 07:20 的 detached suite 等锁等成孤儿（ppid=1），12:18 才手工 `kill -9` 清掉——**它在等自己修复对象的同类故障时，被同一类故障拖了 5 小时**（自指）。

**最危险的一点**：这类「长时间持锁」在 `worker-outcome.jsonl` 里与「worker 自己慢」**完全同形**（长 wall_clock、无 error、最终 exit 0/not-landed）——观测者无法区分「验证型任务在设计上就慢」vs「worker 卡死占锁」。今天这条诊断链三层（worker spawnSync→spawn → 我「另一个 hang」→ manager 转写 memory）全错，推翻只用了一条 `--test worker-driver.test.mjs` 对照（79/79 pass 147s）。

**量化升级（manager 08-25 实算当日 21 轮 lock_wait_ms，非单案例）**：当日锁等待占【全量轮 buckets=full】总墙钟 **46.2%**（Σlock=13878.1s / Σwall=30014.8s = 3.86h/8.34h；⛔ 分母只计 21 个 full 轮——当日 70 轮中 49 轮 M/P/P+M 结构上不取锁、0/49 无 lock_wait_ms）。关键在 `work_s`（实际测试时间）列几乎不变——早段 494–683s、近段 1035–1164s（测试量自身增长），而同期 wall 从 530s 摆到 7349s ⇒ **墙钟方差几乎全来自锁等待，不是套件变慢**。最坏 round 615 单轮等锁 **104.6 分钟**、`effective_parallelism` 掉到 **0.859**。交叉核（⛔ 不单信 runner 自报）：`wall ≈ work + lock + 小额开销` 逐轮成立（615: 7314 vs 7349 残差 35s）。可复算判据形态：按日 `Σlock_wait_ms / ΣdurationMs`（基准 46.2%）——⛔ 但该比值随当日并发需求变、与修复无关也会动（4 轮 lock_wait=0.0 全在清晨低峰、lock%>50% 全在忙时段），作判据须同争用条件对照。该读数**能取假**（4 轮 lock_wait=0.0 ⇒ 非结构恒有、是争用依赖）。

**因果链补全（manager 08-26 实测，⛔ 推翻「exited-not-landed=ff churn」归因）**：44 次 exited-not-landed 中 **66%（29 次）根本没到 ff**，卡在单飞锁排队（当场 5 任务 4 个等锁 7-83 分钟、只 1 个在跑）。锁等待不只让轮变慢，它**直接制造 exited-not-landed + 重派循环**：worker 派发 → 等锁 → 超 worker 回合 → end_turn → exited-not-landed → 重派 → 重新排队 → 队列更长 → 更易超时，自放大。ff churn 只占 34% 且有界收敛（34 失败 vs 32 落地 ≈1:1）。

## Plan

给验证型长任务的锁持有设上限，或让它走独立锁——两选一（或组合，落笔方定）：
- **锁持有上限**：一个 suite 持 `full-suite.lock` 超过 T 分钟（如 30min）⇒ 释放 + 记「lock-hold-exceeded」告警（fail-loud，不静默）；
- **独立锁**：验证型任务（`--buckets` 的主动重跑类 / 明确标 `@long-validation` 的）走独立锁，不与普通 fan-in 的 full-suite 锁竞争。
⛔ **实现约束（manager 钉死，落笔必守）**：锁是 OS 级 flock，被 `scripts/test.sh` 进程的**文件描述符**持有，且该进程可脱离触发它的 worker session 独立存活（`suite-load-sampler` 孤儿化就是它活得比 worker 久的实例）。⇒ **T 分钟释放必须实现在持锁进程自己身上（test.sh 内部自超时）**，⛔ **不能实现成「worker-driver 发现某任务在飞太久就去杀它」**——后者依赖 worker-driver 对该进程的追踪，而追踪失效正是孤儿化那条 bug 本身，会在这里重蹈覆辙。
⛔ 关键判据：outcome 记录里「长时间持锁」必须与「worker 慢」**可区分**（加 wall_clock 分段 / lock_wait / lock_hold 字段），否则观测者仍会重走今天这条三层全错链。

## Acceptance Criteria

- [x] AC1（能取假，锁持有上限或独立锁）：验证型长任务不再独占 full-suite 锁数小时（锁持有超 T 释放，或走独立锁）；（⛔ 仍 5 小时独占 ⇒ 假）。
- [x] AC2（能取假，outcome 可区分）：outcome 记录里「长时间持锁」与「worker 慢」可区分（含 lock_wait / lock_hold 字段）；（⛔ 仍同形不可区分 ⇒ 假）。
- [x] AC3（能取假，负控制回放）：回放 serial-lowconc 今天 5.2 小时持锁场景，改造后其它 fan-in 不再被饿死（能在 T 内拿到锁）；（⛔ 仍饿死 ⇒ 假）。
- [ ] AC4（能取假，锁等待下降-同争用对照）：修复后在【同期并发 fan-in 数 ≥ N】的轮上，`lock_wait_ms` 下降（同争用条件对照，排除「并发需求」混淆变量——该比值随当日并发任务数变、与修复无关也会动）；**`N` 须在测量前钉死并写进 Evidence，⛔ 不得事后择 N**（防 gate-gameability）；并报出原始 Σlock_wait_ms / ΣdurationMs + 轮集供读者复算；（⛔ 无同争用对照、仅占比下降、或事后择 N ⇒ 假）（待外部）

## Evidence

**实现（AC1/AC2/AC3，全部落地并被测试守着）：**
- **AC1 锁持有上限（走「锁持有超 T 释放」分支，非独立锁）**：`FULL_SUITE_LOCK_HOLD_MAX_S`（缺省 1800s=30min）在 `scripts/test.sh` 顶定义；`full_suite_lock_acquire` 拿到槽后 spawn `spawn_suite_lock_hold_watchdog`（在 `plugin/scripts/suite-slot-lib.sh` 单一实现，被 test.sh source 进持锁进程自身——⛔ 不是 worker-driver 杀）。watchdog 每秒轮询 flag 文件：正常释放（flag 删）⇒ 立即退出；持锁进程崩溃（pid 消失）⇒ 立即 `flock -u` 释放（继承同一 open-file-description，crash-autorelease ≤1s）；持满 T 秒仍持有 ⇒ `flock -u` 释放 + `lock_hold_exceeded=1` fail-loud 告警。cap 只让出【槽】，长 suite 继续跑（已过启动 resource gate），接受 (S+1)-th suite 加入的争用风险，不再串行化全仓。
- **AC2 outcome 可区分**：`full_suite_lock_release` 发 `__OVERHEAD__ lock_hold_ms=N`（acquire→release 墙）；`full-suite-runner.ts` 与 `pre-verified-round-record.ts` 把它写进 verification-round.jsonl 的 `lock_hold_ms`（与既有 `lock_wait_ms` 并列）；`worker-driver.ts` 新增 `readLockMetricsForRun(root, runId, taskId)` 读 verification-round.jsonl 最后一个 runId+taskId 匹配记录的 `lock_wait_ms`/`lock_hold_ms`，经 `computeOutcome` 落进 worker-outcome.jsonl。⇒ `lock_wait_ms`（排队饿死）+ `lock_hold_ms`（持锁）两段，与 `wall_clock_ms` 三分，观测者可区分「验证型长任务（高 lock_hold）」vs「排队饿死（高 lock_wait 低 lock_hold）」vs「worker 慢（两低高 wall）」。

**测试（全部绿，`node --test` 直接跑）：**
- `resource-gate.test.mjs`（56/56）：新增 AC1/AC2 结构钉 + AC1/AC3 行为（watchdog 持满 T 后释放、waiter ~T 内拿到槽、`lock_hold_exceeded=1` fail-loud）+ AC3 负控制（无 watchdog 仍持）。行为测试用 `FULL_SUITE_LOCK_HOLD_MAX_S` 由真实 `spawn_suite_lock_hold_watchdog` 驱动（T=2s 缩时回放，非 mock）。
- `pre-verified-round-record.test.mjs`（54/54）：新增 `lock_hold_ms` 从 `__OVERHEAD__ lock_hold_ms=N` 解析、缺键（无 marker / 无 log）⇒ 缺省。
- `worker-driver.test.mjs`（87/87）：新增 `computeOutcome` 带/不带 lock 字段的落盘 + `readLockMetricsForRun`（runId+taskId 匹配、末条覆盖、坏行跳过、miss/null）。
- `full-suite-runner.test.mjs`（165/165）+ `suite-slot-ssot-check.test.mjs`（20/20）：不回归（lock_hold_ms 条件展开 + suite-slot-lib 新增函数不破坏 SSoT I1-I5）。

**AC4（待外部，生产测量）：** 判据能力已落地（verification-round.jsonl 每轮带 `lock_wait_ms`+`lock_hold_ms`）。**N 在测量前钉死 = 2**（同期并发 fan-in 数 ≥ 2，即 ≥2 个 full-bucket suite 同时在飞/排队——本缺陷的争用形状）。测量协议：取修复落地后【连续 full-bucket 轮】中 `concurrentSuitesRunning ≥ 2`（或同窗口 ≥2 个 fan-in 在飞）的轮集，算 `Σlock_wait_ms / ΣdurationMs`，与 Proposal 已钉死的基准 **46.2%**（Σlock=13878.1s / Σwall=30014.8s，2026-08-25 当日 21 个 full 轮）同争用条件对照；报原始 Σ + 轮集（round 号）供复算。⛔ 单次 worker 跑无法制造「多 fan-in 并发争用」的生产窗口，此 AC 需落地后由 outer/manager 在生产载体上量，故标待外部。

## Definition of Done

锁持有上限或独立锁落地；AC1-AC4 全勾；outcome 记录含 lock_hold/lock_wait 分段；serial-lowconc 场景回放不再饿死其它 fan-in；同争用条件下 lock_wait 下降（报原始 Σ + 轮集可复算）。

## Touches

- plugin/scripts/（full-suite 锁语义：持有上限 / 独立锁 + outcome 记录加 lock_hold/lock_wait 字段）
- scripts/test.sh（锁获取/释放 + T 分钟自超时——⛔ 实现在持锁进程自身，非 worker-driver 杀）
- plugin/scripts/worker-outcome 记录（lock_hold/lock_wait 分段）
- tasks/gap-suite-lock-starvation-long-validation-hold.md（自身）
