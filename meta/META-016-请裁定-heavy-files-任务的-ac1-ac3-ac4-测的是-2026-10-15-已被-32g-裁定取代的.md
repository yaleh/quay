---
id: META-016
title: 请裁定：heavy-files 任务的 AC1/AC3/AC4 测的是 2026-10-15 已被 32G 裁定取代的 16 GiB 基线——三选一
status: proposed
handler: meta-driver
---
**只报告、不代裁** —— 阻塞点是三条 AC 描述了一个项目已经离开的工作点；改写 AC 是作者面，不在 worker 授权面内。本 worker 未改 AC 文本、未勾选、未标 `（待外部）`。

## 一、需要决定的一件事

任务 `gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison`（ready，AC 2/5）剩余三条 AC 都要求「**16 GiB** 压力基线下、由 driver 在安静时段调度的完整测量轮」：

- **AC1** = ac341 单文件反事实，64 路 × ≥2 轮（4 轮全量套件）
- **AC3** = 32/48/64 × ≥3 完整轮（9 轮全量套件）
- **AC4** = 把上面那张表作为 "the chosen setting" 的依据引用

⇒ 合计 **13 轮全量套件**。而 **16 GiB 这个基线已于 2026-10-15 被人自己的裁定取代**：主检出 `.quay/config.yml` 现声明 `suite: memory_max: 32G`（注释逐字记「人 2026-10-15 裁定：可接受把套件上限放大到 32G」），且 `gap-suite-declared-memory-max-swallowed-by-shared-host-split`（done）已落地、声明值不再被分摊护栏吞掉 ⇒ 32 GiB 生效。本任务 Proposal 的立案前提（人 2026-10-14：「16 GiB 是刻意的压力约束，不得靠提到 24/26 来修」）**次日就被人自己的 32G 裁定取代**。

## 二、为什么 worker 不能自己把它跑出来（不是「懒得跑」）

1. **这些轮按任务自己的 Plan §3 属 driver 的安静时段调度**（逐字：「These runs are deliberate measurement runs, scheduled by the driver in quiet slots, not stacked on top of live fan-ins」）。worker 在共享单飞锁上连跑 13 轮正是它禁止的形态，还会把生产 fan-in 堵住数小时（一轮 ≥19 分钟）。
2. **手跑的全量套件在本机是受污染的读数**：hand-run suite 继承 anchor cgroup 的内存封套，而不是它自己声明的 16 GiB ⇒ 测出来的 oom_kill 不是「16 GiB 下」的读数（该形态已有记录）。
3. **这些读数在「等」里不会出现**：它不是「某个外部生产者会机械补上」的读数，而是「要不要按这个基线测」本身需要人先决定（ruling-dependent，⛔ 不是 external producer）⇒ 标 `（待外部）` 会把「没人裁定」改名成「正在采集」（硬规则 3b）。

## 三、本轮（第 3 轮）实测：前提未变，其余全部已就绪

- `.quay/config.yml` 仍 `suite: memory_max: 32G`（未变）。
- 分支 `task/gap-suite-…` 已有 6 提交、已 merge develop（无冲突）；**AC2/AC5 已实测并勾选**：`packages/quay/src/goal-store.ts` 改成逐行分块扫 ledger（生产 ledger 156 MB / 561,167 行），五个重型测试文件实测峰值 RSS **1.8 GB → ~0.33 GB（5×）**，等价性控制 **goalsBefore 268 / goalsAfter 268 / goalsDiffering 0**，scoped 门 **271/271**。
- **AC4 的机制半边已在门内**：`suite.heavy_threshold_mb` / `suite.heavy_max_concurrent` 进了 `suite-params.ts` 的 CLOSED schema（未知/错型/越界 ⇒ fail-closed），经 env 传到 `full-suite-runner.ts`（从**本项目自己的** `memPeakKb` 轮次记录算出重型集）与 `suite-scheduler.ts` 的**尾部桶**（body 全排空后才派发、最多 `heavy_max_concurrent` 个并发）。**两键都不声明 ⇒ 机制 OFF**（代码里刻意没有阈值字面量，硬规则 4 推论二）。
- **缺的只有**：那张 AC3 的表 ＋ `.quay/config.yml` 里的声明值（config 是 gitignored 运维面，声明本身是 ops/人 的动作）。

## 四、三选一（一行即可）

- **(a) 重定范围**：把 AC1/AC3 改到**当前基线**（32 GiB 或本机有效值）重跑对比 ⇒ 请连「由谁在安静时段跑」一起定（driver？ops？）。
- **(b) 认账退役**：承认 16 GiB 基线已被 2026-10-15 裁定取代，**撤 AC1/AC3**，AC4 改为「机制已可声明」而不引用表 ⇒ 本任务随即可落地。
- **(c) 授权原样跑**：授权 worker/ops **在安静时段**按原样跑那 13 轮（用 env 强制 16 GiB 基线），并接受它们阻塞生产 fan-in 数小时。

## 五、一个附带的可核读数（供判断，不是请求）

**本任务的 blocker 在板上不可见**：分支任务体带 2 个 `- [x]` 与整段 `## Evidence`，但 `git show author:tasks/<id>.md | grep -c "## Evidence"` ⇒ **0**、`develop` 同理 ⇒ **0**。⇒ 主检出（人读的板）显示 0/5、无原因；develop 上 driver 写的 `## Blocker` 只写「AC 未全勾」。**真因（前提被裁定取代）只活在保留的 worktree 里**——这解释了为什么前两轮各烧一个会话而板上看不出变化。

（本轮已另行 `SendMessage` 通知 manager 会话，并 `PushNotification`。）
