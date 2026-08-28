---
id: gap-full-suite-lock-hold-watchdog-threshold-shorter-than-fan-in
title: FULL_SUITE_LOCK_HOLD_MAX_S=1800 锁持有看门狗阈值结构性短于全量 fan-in 时长——每轮 ff
  落在锁释放后（无锁 ff、ff-race 重暴露）
status: done
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

**实时恶化 + 新增形态（2026-08-27 18:5x，fan-in suite watchdog 证据，已逐条核实）**：
- **实锤 1（占槽者身份）**：占槽闷死 serial-install r1 的是 fan-in **workflow 路径**任务 poll-timeout（workflow-lock runId=fm-…-igm7j2 16:17:53 acquire；其 worker-outcome 今天无任何机械记录；suite 日志带 `__FANIN_SUITE_START__ head=` 标记——全仓无代码写它，workflow 烘焙脚本独有）。它 16:48:12 被 1800s 切（未落地）后 suite 16:51:32 起**无锁空跑 30min、占单飞槽 960s、ff 未落**（merge-lock 无条目、任务仍 ready）。
- **实锤 2（刚发生）**：serial-install round-2（fm-…-k07mni）18:08:22 acquire → **18:38:40 被 1800s 切**（1818s，同签名），其 suite（18:27:51 起）此刻仍在无锁跑。
- **新增形态（⛔ 危害范围扩大）**：切锁危害不止 ff-race——**僵尸 suite 继续占着单飞槽，闷死下一个排队的 fan-in**（serial-install r1 正是死于排在 poll-timeout 的无锁 suite 后面）。切锁 ⇒ **零落地 + 槽污染双重浪费**。
- **实时读数**：16:17:53 后 `fan-in-merge-lock-events.jsonl` 零新增（~2.5h 零 ff 落地），每个 ≥30min 持有者全被切。

**dedup（机制词不重复）**：`gap-suite-lock-starvation-long-validation-hold` = 设 1800s 的 feature（done）；`gap-fan-in-workflow-lock-and-S1` = 扩锁 scope（done）；`gap-suite-lane-budget-structural-guarantee-broken-buckets-no-lock` = 漏口②「让槽不让 lane」（ready，本条下游）；`gap-mech-fan-in-suite-silence-watchdog-fired` = 另一个看门狗（15min 静默 SIGKILL，不同对象）。**无人点名「阈值 < fan-in 时长」这个上游机制。**

## Plan

修法收敛（2026-08-27，fan-in lock watchdog 修订）：**option 2 为主**——suite-slot-lib.sh watchdog 路径 (b)（kill -0 失败 → ≤1s 崩溃自动释放）已原生覆盖死 holder；路径 (c)（纯 1800s 计时）对「alive 且在跑」也切，是误伤源。对 fan-in 锁：去掉 (c) 或改「alive 且不推进才切」，只留 (b)。理由：driver 持锁不会 hang 不崩（崩溃即 flock fd 自动释放）；suite 挂死已由静默 watchdog 兜（SIGKILL → suite 终 → fan-in 终 → 锁释放），(c) 对 fan-in 锁冗余且有害。

**option 3 作框架**（死持有者 watchdog vs 正常长跑不断锁分离）。**option 1 降级为止血**（仅若必须留计时器）：≥ 真实全量 fan-in 上界 = 退役 SUITE_MAX_RUNTIME_MS(45min) + 开销(~10min) ≈ 55min → 3600s(60min)，⚠️ 挪悬崖非修复，61min 仍被切。

**⛔ 关键边界**：1800s 对 suite 锁原用途（cap 5.2h validation）仍正确，别动；要修的是 fan-in 锁复用了它——fan-in 锁阈值应与 FULL_SUITE_LOCK_HOLD_MAX_S **解耦**，而非再抬一个共享常量。数字是止血不是结论，落笔当轮各取一次真实读数核对（硬规则 4c）。

## Acceptance Criteria

- [ ] AC1（能取假，ff 在锁内）：全量 fan-in 的 ff-merge 时刻在锁 release 之前（交叉 lock-events 与 merge-lock-events 判）；（⛔ ff 在 release 后 ⇒ 假）。（待外部）
- [x] AC2（能取假，阈值匹配时长）：FULL_SUITE_LOCK_HOLD_MAX_S ≥ 真实全量 fan-in 时长，或看门狗只对死 holder 切锁（⛔ 仍 30min 切活 holder ⇒ 假）。
- [ ] AC3（能取假，不再重派循环）：30min+ 全量 fan-in 不再因无锁 ff 而 exited-not-landed；（⛔ 仍切锁后补落地/没落地 ⇒ 假）。（待外部）

## Definition of Done

看门狗阈值/语义修复；AC1-AC3 全勾；全量 fan-in 的 ff 落在锁内；30min 任务不再被看门狗中途切锁。

## Touches

- plugin/scripts/suite-slot-lib.sh（spawn_suite_lock_hold_watchdog 加 `timer-cut` 参数，路径 (c) 可关）
- plugin/scripts/fan-in-ff-merge.sh（fan-in 锁看门狗解耦 FULL_SUITE_LOCK_HOLD_MAX_S，`workflow_lock_timer_cut="0"` dead-holder-only）
- plugin/test/resource-gate.test.mjs（dead-holder-only 负控制：timer-cut=0 不切活 holder）
- plugin/test/fan-in-workflow-lock.test.mjs（解耦结构断言：无 suite 锁阈值复用、spawn 传 timer-cut=0）
- tasks/gap-full-suite-lock-hold-watchdog-threshold-shorter-than-fan-in.md（自身）

## Evidence

- **AC2（看门狗只对死 holder 切锁）**：修法 = Plan option 2（去路径 (c)，只留 (b)），对 fan-in 锁解耦 `FULL_SUITE_LOCK_HOLD_MAX_S`、不复用。实现：
  1. `suite-slot-lib.sh` `spawn_suite_lock_hold_watchdog` 加第 5 参 `timer-cut`（缺省 "1" = suite 锁原 1800s cap 不变）；`timer-cut=0` 走 dead-holder-only 分支（只轮询 (a) flag 删 / (b) kill -0 失败，永不计时切锁）。原 timer 循环（路径 c）逐字保留，suite 锁行为零改变。
  2. `fan-in-ff-merge.sh` 删 `--workflow-lock-hold-max-s` / `workflow_lock_hold_max_s` / `FANIN_WORKFLOW_LOCK_HOLD_MAX_S` 缝（无数字阈值可再长），`workflow_lock_timer_cut="0"`，holder 内 `spawn_suite_lock_hold_watchdog "${_wfl_fd}" "$9" "$$" "0" "${10}"`。
- **测试（`env -u FORCE_COLOR`，绕过已知 FORCE_COLOR 污染 `node console.log` 解析的既有问题）**：
  - `resource-gate.test.mjs` **59/59 绿**，含新增 dead-holder-only 负控制：`timer-cut=0` + max-s=2s，sleep 3s 后 probe 仍 `PROBE-STILL-HELD`、`FLAG-PRESENT`、无 `lock_hold_exceeded=1`（对照：既有的 timer-cut=1 AC1/AC3 测试同窗口 `PROBE-ACQUIRED`）。
  - `fan-in-workflow-lock.test.mjs` **8/8 绿**，含新增 AC2 解耦结构断言（`doesNotMatch /\$\{FULL_SUITE_LOCK_HOLD_MAX_S\}/`、`doesNotMatch /FANIN_WORKFLOW_LOCK_HOLD_MAX_S/`、`match /workflow_lock_timer_cut="0"/`、`match /spawn... "0" "\${10}"/`）；AC5（holder SIGKILL ⇒ watchdog 释放锁）在 dead-holder 模式下仍绿 = 路径 (b) 保留。
  - `fan-in-ff-merge.test.mjs` + `fan-in-ff-executor-check.test.mjs` + `fan-in-ff-protocol-check.test.mjs` **117/117 绿**、`suite-slot-ssot-check.test.mjs` **20/20 绿**（bash/TS 双正本不漂移）。
- **AC1/AC3（待外部）**：二者判据 = 生产观察（交叉 `fan-in-workflow-lock-events.jsonl` 与 `fan-in-merge-lock-events.jsonl`、30min+ fan-in 不再 exited-not-landed），须真实 fan-in 落地后读载体核实——不在本 worker 回合内可测（本回合不跑全量 suite / fan-in）。机制上已闭环：锁不再被 30min 切 ⇒ ff 必在锁内 ⇒ 无锁 ff / exited-not-landed 结构上归零；`（待外部）` 留待 driver fan-in 后核对。
