---
id: gap-meta-call-heavy-files-ac1-ac3-ac4-2026-10-15-32g-1
title: 裁定：heavy-files 任务的 AC1/AC3/AC4 是否还按已被 2026-10-15 32G 裁定取代的 16 GiB 基线收口
status: needs-human
labels:
  - meta-human-call
  - meta-driver
parent: null
children: []
extra: {}
---
## Finding
任务 gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison 的 AC1/AC3（16 GiB 基线上的对照测量，合计约 13 轮全量套件）与 AC4（把那张表作为依据引用）该如何收口——重定范围到当前生效基线、认账退役、还是按原基线原样跑？

**要人裁决的是什么**：裁定：heavy-files 任务的 AC1/AC3/AC4 是否还按已被 2026-10-15 32G 裁定取代的 16 GiB 基线收口
**选项与代价**：(a) 重定范围：把 AC1/AC3 改到当前生效基线（32 GiB）重跑对比——成本：仍要 13 轮全量套件，仍须人先定「由谁在安静时段跑」（driver？ops？），且换了基线后 AC4 引用的表与任务立案时的工作点不再是同一件事。(b) 认账退役：承认 16 GiB 基线已被 2026-10-15 裁定取代，撤 AC1/AC3，AC4 改为「机制已可声明」而不引用表——成本：放弃唯一计划中的内存压力基线对照测量，`suite.heavy_threshold_mb`/`suite.heavy_max_concurrent` 以「可声明但从未在任何压力基线下测过」的姿态落地；本任务随即可落地。(c) 原样跑：授权 worker/ops 在安静时段按 16 GiB 强制基线跑那约 13 轮——成本：与 2026-10-15 的 32G 裁定方向相反，且按任务自己的 Plan §3 这些轮须由 driver 在安静时段调度，会长时间占用共享单飞锁、阻塞生产 fan-in 数小时。
**为什么机器不能自决**：metaRecords 中唯一的 META-016：该任务现为 ready、AC 2/5，其三条剩余 AC 全部要求「16 GiB 压力基线下、driver 在安静时段调度的完整测量轮」；而该基线已被 2026-10-15 的裁定取代——`.quay/config.yml` 逐字记「人 2026-10-15 裁定：可接受把套件上限放大到 32G。」且现声明 `memory_max: 32G`。两条已写下的立场相互矛盾（见 conflict，两条引文均逐字取自各自文件）。worker 明确报告「改写 AC 是作者面，不在 worker 授权面内」，并已拒绝用 `（待外部）` 把「没人裁定」改名成「正在采集」（硬规则 3b）——故这不是 worker 能自决、也不是本驱动能代裁的，只能路由给人。
**若机器自行选错，什么难以撤销**：选 (b) 而事后仍需要该压力基线下对照读数时，那份唯一计划中的测量就此消失——机制以「已可声明」姿态落地，日后再发现无基线对照，安静的十几轮全量套件成本要重付，且此前任何按该未测机制做的调参都不可回溯。选 (a) 而该任务实际是「压力约束驱动的优化」而非「基线对比」时，32 GiB 下的表会替换掉 AC4 原本要引用的工作点，任务的结论被静默改写。
**实测依据**：`metaRecords` = [{"id":"META-016","title":"请裁定：heavy-files 任务的 AC1/AC3/AC4 测的是 2026-10-15 已被 32G 裁定取代的 16 GiB 基线——三选一","status":"proposed","handler":"meta-driver","reply":null,"body":"**只报告、不代裁** —— 阻塞点是三条 AC 描述了一个项目已经离开的工作点；改写 AC 是作者面，不在 worker 授权面内。本 worker 未改 AC 文本、未勾选、未标 `（待外部）`。\n\n## 一、需要决定的一件事\n\n任务 `gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison`（ready，AC 2/5）剩余三条 AC 都要求「**16 GiB** 压力基线下、由 driver 在安静时段调度的完整测量轮」：\n\n- **AC1** = ac341 单文件反事实，64 路 × ≥2 轮（4 轮全量套件）\n- **AC3** = 32/48/64 × ≥3 完整轮（9 轮全量套件）\n- **AC4** = 把上面那张表作为 \"the chosen setting\" 的依据引用\n\n⇒ 合计 **13 轮全量套件**。而 **16 GiB 这个基线已于 2026-10-15 被人自己的裁定取代**：主检出 `.quay/config.yml` 现声明 `suite: memory_max: 32G`（注释逐字记「人 2026-10-15 裁定：可接受把套件上限放大到 32G」），且 `gap-suite-declared-memory-max-swallowed-by-shared-host-split`（done）已落地、声明值不再被分摊护栏吞掉 ⇒ 32 GiB 生效。本任务 Proposal 的立案前提（人 2026-10-14：「16 GiB 是刻意的压力约束，不得靠提到 24/26 来修」）**次日就被人自己的 32G 裁定取代**。\n\n## 二、为什么 worker 不能自己把它跑出来（不是「懒得跑」）\n\n1. **这些轮按任务自己的 Plan §3 属 driver 的安静时段调度**（逐字：「These runs are deliberate measurement runs, scheduled by the driver in quiet slots, not stacked on top of live fan-ins」）。worker 在共享单飞锁上连跑 13 轮正是它禁止的形态，还会把生产 fan-in 堵住数小时（一轮 ≥19 分钟）。\n2. **手跑的全量套件在本机是受污染的读数**：hand-run suite 继承 anchor cgroup 的内存封套，而不是它自己声明的 16 GiB ⇒ 测出来的 oom_kill 不是「16 GiB 下」的读数（该形态已有记录）。\n3. **这些读数在「等」里不会出现**：它不是「某个外部生产者会机械补上」的读数，而是「要不要按这个基线测」本身需要人先决定（ruling-dependent，⛔ 不是 external producer）⇒ 标 `（待外部）` 会把「没人裁定」改名成「正在采集」（硬规则 3b）。\n\n## 三、本轮（第 3 轮）实测：前提未变，其余全部已就绪\n\n- `.quay/config.yml` 仍 `suite: memory_max: 32G`（未变）。\n- 分支 `task/gap-suite-…` 已有 6 提交、已 merge develop（无冲突）；**AC2/AC5 已实测并勾选**：`packages/quay/src/goal-store.ts` 改成逐行分块扫 ledger（生产 ledger 156 MB / 561,167 行），五个重型测试文件实测峰值 RSS **1.8 GB → ~0.33 GB（5×）**，等价性控制 **goalsBefore 268 / goalsAfter 268 / goalsDiffering 0**，scoped 门 **271/271**。\n- **AC4 的机制半边已在门内**：`suite.heavy_threshold_mb` / `suite.heavy_max_concurrent` 进了 `suite-params.ts` 的 CLOSED schema（未知/错型/越界 ⇒ fail-closed），经 env 传到 `full-suite-runner.ts`（从**本项目自己的** `memPeakKb` 轮次记录算出重型集）与 `suite-scheduler.ts` 的**尾部桶**（body 全排空后才派发、最多 `heavy_max_concurrent` 个并发）。**两键都不声明 ⇒ 机制 OFF**（代码里刻意没有阈值字面量，硬规则 4 推论二）。\n- **缺的只有**：那张 AC3 的表 ＋ `.quay/config.yml` 里的声明值（config 是 gitignored 运维面，声明本身是 ops/人 的动作）。\n\n## 四、三选一（一行即可）\n\n- **(a) 重定范围**：把 AC1/AC3 改到**当前基线**（32 GiB 或本机有效值）重跑对比 ⇒ 请连「由谁在安静时段跑」一起定（driver？ops？）。\n- **(b) 认账退役**：承认 16 GiB 基线已被 2026-10-15 裁定取代，**撤 AC1/AC3**，AC4 改为「机制已可声明」而不引用表 ⇒ 本任务随即可落地。\n- **(c) 授权原样跑**：授权 worker/ops **在安静时段**按原样跑那 13 轮（用 env 强制 16 GiB 基线），并接受它们阻塞生产 fan-in 数小时。\n\n## 五、一个附带的可核读数（供判断，不是请求）\n\n**本任务的 blocker 在板上不可见**：分支任务体带 2 个 `- [x]` 与整段 `## Evidence`，但 `git show author:tasks/<id>.md | grep -c \"## Evidence\"` ⇒ **0**、`develop` 同理 ⇒ **0**。⇒ 主检出（人读的板）显示 0/5、无原因；develop 上 driver 写的 `## Blocker` 只写「AC 未全勾」。**真因（前提被裁定取代）只活在保留的 worktree 里**——这解释了为什么前两轮各烧一个会话而板上看不出变化。\n\n（本轮已另行 `SendMessage` 通知 manager 会话，并 `PushNotification`。）\n"}]（meta-driver 机械采集于 2026-10-15T21:32:29Z）

**互相矛盾的既有立场（逐字引用，已机械核对确实存在于对应文件）**：
- `tasks/gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison.md`：「the 16 GiB suite MemoryMax is a deliberate pressure constraint meant to drive test optimization」
- `.quay/config.yml`：「人 2026-10-15 裁定：可接受把套件上限放大到 32G。」

## AC（draft）
- [ ] 人在上述选项中作出选择，并把选择写进本任务体（或以 DIR 记录该裁定）
- [ ] 依该选择产生的后续工作已立案或已落地（⛔ 不以「已回答」本身充当完成）

## DoD（draft）
- [ ] 裁定已记录在可被后续读到的正本里，⛔ 不只存在于本任务的对话中
- [ ] 上面两条互相矛盾的立场中，落败的一方已被就地更正或标注，⛔ 不留着继续制造同一次冲突

## Touches
- `tasks/gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison.md`
- `tasks/gap-meta-call-heavy-files-ac1-ac3-ac4-2026-10-15-32g-1.md`