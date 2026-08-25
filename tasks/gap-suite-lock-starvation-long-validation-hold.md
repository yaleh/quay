---
id: gap-suite-lock-starvation-long-validation-hold
title: 验证型长任务（如 serial-lowconc 33 文件 N 次重跑）持单飞锁数小时饿死全仓 fan-in，且与「worker 慢」在 outcome 里同形不可区分
status: todo
labels:
  - gap
  - defect
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

## Plan

给验证型长任务的锁持有设上限，或让它走独立锁——两选一（或组合，落笔方定）：
- **锁持有上限**：一个 suite 持 `full-suite.lock` 超过 T 分钟（如 30min）⇒ 释放 + 记「lock-hold-exceeded」告警（fail-loud，不静默）；
- **独立锁**：验证型任务（`--buckets` 的主动重跑类 / 明确标 `@long-validation` 的）走独立锁，不与普通 fan-in 的 full-suite 锁竞争。
⛔ 关键判据：outcome 记录里「长时间持锁」必须与「worker 慢」**可区分**（加 wall_clock 分段 / lock_wait / lock_hold 字段），否则观测者仍会重走今天这条三层全错链。

## Acceptance Criteria

- [ ] AC1（能取假，锁持有上限或独立锁）：验证型长任务不再独占 full-suite 锁数小时（锁持有超 T 释放，或走独立锁）；（⛔ 仍 5 小时独占 ⇒ 假）。
- [ ] AC2（能取假，outcome 可区分）：outcome 记录里「长时间持锁」与「worker 慢」可区分（含 lock_wait / lock_hold 字段）；（⛔ 仍同形不可区分 ⇒ 假）。
- [ ] AC3（能取假，负控制回放）：回放 serial-lowconc 今天 5.2 小时持锁场景，改造后其它 fan-in 不再被饿死（能在 T 内拿到锁）；（⛔ 仍饿死 ⇒ 假）。

## Definition of Done

锁持有上限或独立锁落地；AC1/AC2/AC3 全勾；outcome 记录含 lock_hold/lock_wait 分段；serial-lowconc 场景回放不再饿死其它 fan-in。

## Touches

- plugin/scripts/（full-suite 锁语义：持有上限 / 独立锁 + outcome 记录加 lock_hold/lock_wait 字段）
- scripts/test.sh 或 driver-runtime.ts（锁获取/释放 + 上限）
- plugin/scripts/worker-outcome 记录（lock_hold/lock_wait 分段）
- tasks/gap-suite-lock-starvation-long-validation-hold.md（自身）
