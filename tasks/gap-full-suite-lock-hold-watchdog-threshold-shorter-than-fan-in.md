---
id: gap-full-suite-lock-hold-watchdog-threshold-shorter-than-fan-in
title: FULL_SUITE_LOCK_HOLD_MAX_S=1800 锁持有看门狗阈值结构性短于全量 fan-in 时长——每轮 ff
  落在锁释放后（无锁 ff、ff-race 重暴露）
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

`FULL_SUITE_LOCK_HOLD_MAX_S=1800` 的锁持有看门狗阈值，在 `gap-fan-in-workflow-lock-and-S1` 把锁扩到 merge→全量 suite→ff 整段之后，已**结构性短于全量 fan-in 时长** ⇒ 每轮全量 fan-in 都在 30min 被看门狗中途切锁，ff-merge 落在锁释放之后（无锁 ff，ff-race 重新暴露），一部分直接 exited-not-landed → 重派循环。

**机制链**：
1. `gap-fan-in-workflow-lock-and-S1`（done）把锁 scope 扩到 merge→全量 suite→ff 整段；
2. `gap-suite-lock-starvation-long-validation-hold`（done）设的 `FULL_SUITE_LOCK_HOLD_MAX_S=1800`（`scripts/test.sh:657-663`，实际 `:671`）看门狗，在 30min 强制 `flock -u` + `rm flag`（`plugin/scripts/suite-slot-lib.sh:106-175` `spawn_suite_lock_hold_watchdog` 路径 (c)），但 suite 还在跑；
3. ⇒ ff-merge 在锁已没了之后才做。判别器 = 交叉 `.quay/fan-in-workflow-lock-events.jsonl`（锁持有）与 `.quay/fan-in-merge-lock-events.jsonl`（ff landedSha 时刻）。

**证据（14 个 ~30min 锁持有者，按 ff 时刻 vs 锁释放时刻分类）**：
- 正常落地（ff 在锁内）：**2** 个，且都踩边界（test-isolation-race ff 在 release 前 74s；archguard-zero-prod-calls 第 3 次才落、前 2 次 30min 持有无 ff）。
- 切锁后补落地（ff 在 release 后）：**5** 个 —— suite-lifecycle +7min、fan-in-driver-mech +7min、suite-load-sampler-orphan +24min、suite-serial-lowconc-recheck +35min、fan-in-workflow-lock-and-S1 自己 +43min。
- 没落地：**7** 个 —— 含 web-session 连续两轮 30min 持有仍 ready、lane-budget 被 driver 重启杀。
- 对照：fast 任务（10–21min，bucket 档）全部 ff 在锁内 release 前几秒 ⇒ 设计流程就是「ff 在锁内」，30min 任务的「ff 在锁外」是异常。

**dedup（机制词不重复）**：`gap-suite-lock-starvation-long-validation-hold` = 设 1800s 的 feature（done）；`gap-fan-in-workflow-lock-and-S1` = 扩锁 scope（done）；`gap-suite-lane-budget-structural-guarantee-broken-buckets-no-lock` = 漏口②「让槽不让 lane」（ready，本条下游）；`gap-mech-fan-in-suite-silence-watchdog-fired` = 另一个看门狗（15min 静默 SIGKILL，不同对象）。**无人点名「阈值 < fan-in 时长」这个上游机制。**

## Plan

修法三选一（实现方定，不代拍）：
1. 阈值按真实全量 fan-in 时长重测（不写死 1800）。
2. 看门狗只在 holder 真死（路径 (b)）时切锁，对「仍存活且在跑」不切。
3. 把「饿死防护看门狗」与「正常长 suite」分开（死持有者 watchdog vs 正常长跑不断锁）。

## Acceptance Criteria

- [ ] AC1（能取假，ff 在锁内）：全量 fan-in 的 ff-merge 时刻在锁 release 之前（交叉 lock-events 与 merge-lock-events 判）；（⛔ ff 在 release 后 ⇒ 假）。
- [ ] AC2（能取假，阈值匹配时长）：FULL_SUITE_LOCK_HOLD_MAX_S ≥ 真实全量 fan-in 时长，或看门狗只对死 holder 切锁（⛔ 仍 30min 切活 holder ⇒ 假）。
- [ ] AC3（能取假，不再重派循环）：30min+ 全量 fan-in 不再因无锁 ff 而 exited-not-landed；（⛔ 仍切锁后补落地/没落地 ⇒ 假）。

## Definition of Done

看门狗阈值/语义修复；AC1-AC3 全勾；全量 fan-in 的 ff 落在锁内；30min 任务不再被看门狗中途切锁。

## Touches

- scripts/test.sh（FULL_SUITE_LOCK_HOLD_MAX_S :657-663/:671 阈值或语义）
- plugin/scripts/suite-slot-lib.sh（spawn_suite_lock_hold_watchdog :106-175 路径 (b)/(c) 分叉）
- plugin/scripts/full-suite-runner.ts（lane 公式/看门狗集成）
- plugin/test/（看门狗切锁负控制 + ff-在锁内断言）
- tasks/gap-full-suite-lock-hold-watchdog-threshold-shorter-than-fan-in.md（自身）
