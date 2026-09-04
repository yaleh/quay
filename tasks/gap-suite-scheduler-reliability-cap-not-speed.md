---
id: gap-suite-scheduler-reliability-cap-not-speed
title: 水位线调度器重定义为可靠性总量上限——三组总并发不超过当前活跃组的最小预算（速度不是它的 AC）
status: ready
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

现状：`plugin/scripts/suite-scheduler.ts` 的水位线调度器语义是"main 用剩余容量填满"（`mainCapacity = main_budget − active_serial − active_lowconc`）。main 自己的并发预算远大于 serial/lowconc（round #985 实测 main_budget=28 而 serial/lowconc 各≤8），所以只要 serial/lowconc 还有文件在跑，main 立刻顶到自己的大预算，与 serial/lowconc 一起把全部核占满——round #985 真实时间线显示 t=5s 时 main 已是 20 并发、serial(2)+lowconc(6) 同时在跑，全程 92% 的时间总并发钉在 28~29。

这个设计当初（`gap-suite-dynamic-waterline-scheduler`，status: done）选择"main 用剩余容量"而非"全局 min 锁死"，给出的唯一理由是**速度**：一次性模拟数据显示 min 锁死 706s 比"main 用剩余"515s 慢 37%。但**验证这组数字在真实生产全量轮里是否成立的 AC4（"全量轮 durationMs 中位 ≤ 基线"）和 AC5（无回归）从未被验证**——直接读该任务体核实：两条 AC 复选框都是空的（`- [ ]`）、都标注"（待外部）"，而任务的 Definition of Done 文字却宣称"AC1-AC5 全勾"，任务状态已被标记 done。status/DoD 文字/AC 勾选状态三者互相矛盾。也就是说，"min 锁死更慢"这个结论从一开始就只是一次性离线模拟（`simulateSchedule`/`simulateMinLock`，喂历史 per-file 时长做 LPT 排程模拟）的输出，从未被真实全量套件核对过，却被写成了设计依据、并压过了可靠性目标。

与此同时，"main 用剩余容量"这个设计造成了一个真实、已被生产数据确认的可靠性问题：`gap-suite-waterline-main-overlap-starves-lowconc-probes`（2026-09-02 立案，status: superseded）实测到 main+lowconc 并发占满核期间 `loadavg 22-26`、`cpu_stall 37-62%`，导致 B 类等待型探针测试（session-liveness 家族，真实 tmux+claude-probe 进程）间歇性建立失败。该任务被 superseded，人当时的裁定理由是"水位设计正确...serial 相 ALONE 先跑于 main 之前...正确修法是把这些测试从 lowconc 移到 serial"——但这个裁定依据的前提（"serial 相 ALONE 先跑"）已被同一天立案的兄弟任务 `gap-session-liveness-bclass-move-to-serial`（status: done）自己的"已证伪的"一节明确否定："也不是『serial 相 ALONE 先跑隔离 main』（那是 QUAY_SUITE_SCHEDULER=0 legacy fallback 注释，非默认统一调度器；统一调度器下 serial∥lowconc∥main 并发）"。"移到 serial 能解决"这个修法从一开始就建立在一个自相矛盾、且被真实数据（round #985：serial 从 t=0 起就与 main 同时跑，未被隔离）证伪的前提上。落地后的残留归因（`gap-lowconc-concurrency-8-starves-bclass-waiting` 任务体 2026-09-02 追记）也确认："该失败非 lowconc 值决定...负载源是水位调度：main 用剩余容量把核占满——lowconc 值只改 main 头寸，不改总负载。"

人 2026-09-04 裁定（本任务立案的直接依据）：**min 锁死式的总量约束才是水位线机制期望的行为**——目标是可靠性（任意时刻，三组总并发不超过当前有活跃测试的那些组里预算最小的一个），**速度从来不该是它的 AC**。约束范围覆盖全部三组的总和（不只是 main 相对 serial+lowconc；serial 和 lowconc 彼此之间同样受总量约束——人 2026-09-04 明确选择这一更严格的口径，而非只约束 main）。人同时指出：在现有错误实现下测试能绿，暗示当前被分到 serial/lowconc 相的许多测试本可以在 main 相下也稳定通过（只是因为旧实现把它们错误地判为"需要隔离"）——这个观察留给后续任务评估，本任务不做该评估。

## Plan

1. **新语义函数**：`suite-scheduler.ts` 新增 `currentCap(budgets, active)`——只统计 `active[g] > 0` 的组，取其预算最小值；无人在跑时不设限（交给队列/组预算决定谁先起）。删除/废弃 `mainCapacity` 的"用剩余容量"语义。
2. **新派发循环**：`nextDispatch` 改为固定点循环——每次尝试起一个文件前，都以当前 `active` 状态重算 `currentCap`，`serial+lowconc+main` 总数不得超过它；仍按 serial→lowconc→main 的组优先级顺序尝试（保留"低并发组先起、先在相边界判红"的既有性质）。
3. `simulateSchedule` 复用新 `nextDispatch`；`simulateMinLock`（现有"被否决对照组"）转正为新语义的核心模拟或改名，去掉"被否决备选"的历史包袱。
4. **单元测试改写**（`plugin/test/suite-scheduler.test.mjs`）：删除或反转 `AC2 control — waterline makespan < min-lock makespan`（现在断言的方向是错的——它在断言"水位线必须比 min 锁快"，这正是要被推翻的旧目标）；新增断言——对模拟调度产出的每个事件时刻采样 `active.serial+active.lowconc+active.main`，必须 `≤ min(当前活跃组预算)`；新增"低并发组排空后 main 恢复满预算"的回归断言（防止可靠性约束意外变成永久限速）。
5. **源码头部注释重写**：`THE WATERLINE ... NOT a global min lock` 整段改写，明确目标是可靠性（不是墙钟），min 锁死式总量约束是当前语义而非被否决备选；标注旧的 706s/653s/515s 速度对比为"历史上错误的判据依据、从未被真实数据验证"。
6. **关联任务留痕更正**（不在本任务内实现其修复，只记录关联，供各自任务或后续任务处理）：`gap-suite-dynamic-waterline-scheduler`（done，DoD/AC 不一致，706 vs 515 判据依据已被本任务推翻）；`gap-suite-waterline-main-overlap-starves-lowconc-probes`（superseded，其 Plan"给 lowconc 留 reserve 或 gate main 直到排空"与本任务方向一致，理由已被推翻）；`gap-session-liveness-bclass-move-to-serial`（done，AC2 长期"待外部"，机制修复落地后应重新核验）。
7. **验证**：全量套件跑通（0 failed/0 cancelled）；贴出改动前后墙钟对照（不设速度上限，只如实记录数字，按人 2026-09-04 裁定"更快不是 AC"）；用与本任务发现阶段相同的方法（`.quay/verification-round.jsonl` 的 `perFile` 真实 `startedAtMs`/`endedAtMs`）重建至少一轮真实全量套件的并发时间线，确认总并发未突破 cap。

## Acceptance Criteria

- [ ] AC1（能取假，机制级）：`suite-scheduler.ts` 新增 `currentCap` 且 `nextDispatch`/`simulateSchedule` 改用它——grep 源码确认 `mainCapacity` 的"用剩余容量"语义已被替换；（⛔ 仍是 `main_budget − active_serial − active_lowconc` 无总量上限 ⇒ 假）。
- [ ] AC2（能取假，单元测试，方向与旧 AC2 相反）：`plugin/test/suite-scheduler.test.mjs` 新增/替换断言——对模拟调度产出的每个事件时刻，`active.serial+active.lowconc+active.main ≤ min(当前活跃组预算)` 恒成立；旧的"waterline makespan < min-lock makespan"断言已删除或反转；`node --test plugin/test/suite-scheduler.test.mjs` 全绿。
- [ ] AC3（能取假，回归）：低并发组（serial/lowconc）排空后，main 的并发能恢复到自己的完整预算（不被历史上曾经活跃过的组永久限速）——单元测试覆盖此场景。
- [ ] AC4（能取假，生产载体，真实数据不是模拟）：改动落地后，用真实 `.quay/verification-round.jsonl` `perFile` 时间戳重建至少一轮全量套件的并发时间线，确认全程 `serial+lowconc+main` 总并发未超过当时活跃组的最小预算；（⛔ 仍观测到总并发突破 cap ⇒ 假）。
- [ ] AC5（能取假，文档/任务体订正，不设速度阈值）：`suite-scheduler.ts` 头部注释与 `gap-suite-dynamic-waterline-scheduler.md` 都已订正，不再以"min 锁死更慢"作为设计依据；本 AC 不要求也不允许写任何墙钟数值上限（人 2026-09-04 裁定"更快不是 AC"）——只要求前后墙钟对照数字被如实记录在 Measured 里。
- [ ] AC6（能取假，回归）：全量 `scripts/test.sh` 跑通，0 failed、0 cancelled。

## Definition of Done

`suite-scheduler.ts` 的调度语义从"main 用剩余容量"改为"三组总并发不超过当前活跃组的最小预算"；单元测试断言方向已反转（可靠性优先，不再断言"必须比 min 锁快"）；AC1-AC6 全部勾选且勾选状态与 DoD 文字一致（不重蹈 `gap-suite-dynamic-waterline-scheduler` 的 status/AC 不一致覆辙）；至少一轮真实全量套件的并发时间线证实总量约束生效；改动前后墙钟对照数字如实记录，不设速度目标；三个关联任务已留痕更正记录。

## Touches

- plugin/scripts/suite-scheduler.ts（currentCap 替换 mainCapacity 的剩余容量语义；nextDispatch 固定点循环；头部注释重写）
- plugin/test/suite-scheduler.test.mjs（AC2 方向反转；新增总量上限断言 + 低并发组排空回归断言）
- tasks/gap-suite-dynamic-waterline-scheduler.md（更正记录：706 vs 515 判据依据已被推翻）
- tasks/gap-suite-waterline-main-overlap-starves-lowconc-probes.md（更正记录：superseded 理由的前提已被证伪，方向与本任务一致）
- tasks/gap-session-liveness-bclass-move-to-serial.md（落地后重新核验 AC2）
- tasks/gap-suite-scheduler-reliability-cap-not-speed.md（自身）
