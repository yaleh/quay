---
id: gap-serial-lowconc-reclassify-post-waterline-cap
title: 水位线可靠性上限修复后重验：5 个历史脏 serial/lowconc 候选 130/130 转绿，重分类回 main（engine）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`gap-psi-shadow-admission-controller`（done）与本任务共同的前置调查链已经排除了"CPU 调度压力/schedule-out 概率"作为这批历史反复失败测试的病因：主动诱发实验用真实历史失败区间超时重跑最强候选 `worker-driver-fan-in.test.mjs`（历史 11 次失败，128~188s）**未复现**；被动历史联合（238 条真实失败样本）里，失败组的 `cpu_stall` 反而**低于**通过组——两条独立数据源都反驳"PSI/调度延迟对失败有增量预测力"。

**真正的病因，用真实时间线数据核实过**：`gap-suite-scheduler-reliability-cap-not-speed`（可靠性总量上限，2026-09-04T13:42:52Z 落地，与 PSI/run_delay 假设完全无关、纯按可靠性理由做）落地前后出现一条极干净的分界线：

| 候选文件 | @test-group | 修复前 | 修复后 |
|---|---|---|---|
| `plugin/test/help-contract-incompatible-behaviors.test.mjs` | serial | 15 次失败 | 0/26 |
| `plugin/test/worker-driver-fan-in.test.mjs` | lowconc | 11 次失败 | 0/26 |
| `plugin/test/worker-driver-resident.test.mjs` | lowconc | 7 次失败 | 0/26 |
| `plugin/test/full-suite-runner-phases.test.mjs` | lowconc | 2/177 次失败 | 0/26 |
| `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs` | serial | 0/216 次失败（从未失败过） | 0/10 |

（另外两个曾一并核实的候选 `writestate-atomicity-split.test.mjs`(engine,14x) 与 `suite-bucket-reattr-ratchet-check.test.mjs`(engine,5x) **已经是 `engine`＝main 桶成员，不是重分类对象**——它们修复后同样 0 失败，只是作为佐证：main 桶内的同名机制也被这次修复顺带治好了，说明真正的病根是旧调度器"main 用剩余容量"导致的**总并发不受控**（round #985 实测可达 28~29 并发，内存/fd/端口/IO/CPU 全套资源竞争叠加），不是可分离的"CPU 调度延迟"，新调度器把三组总并发封顶到当前活跃组最小预算后，这个病根已经消失。）

**这正是两次被搁置的评估**（`gap-suite-scheduler-reliability-cap-not-speed` 的 Proposal 里人当时指出"现有错误实现下测试能绿，暗示很多 serial/lowconc 测试本可以在 main 相下稳定通过"，与 `gap-psi-shadow-admission-controller` 讨论阶段再次提出，均因证据不足被搁置）——**现在有了 130 次真实生产运行（这 5 个候选文件）零失败的证据支撑**，本任务把它落实为一次真正的重分类操作 + 有真实反馈环的验证，而不是再一次方向性猜测。

**诚实的局限（如实写入，不回避）**：26 次/文件、约 15 小时窗口的样本量是有说服力但非穷尽的证据——不能排除极低频复发。本任务因此把验证拆成两层：落地时可机械核验的部分（AC1/AC2），和需要真实生产轮次积累才能确认的部分（AC3，明确标注"真·待外部"，不是逃逸舱——`gap-suite-scheduler-perfile-cpu-emitter-missing` 的 AC3/AC5 是本仓库里这个模式的正确先例）。

## Plan

1. **逐文件、非批量重分类**：对上述 5 个文件，逐一把文件头 `// @test-group serial|lowconc` 改为 `// @test-group engine`（对齐已经在 main 桶、同样修复后转绿的 `writestate-atomicity-split.test.mjs`/`suite-bucket-reattr-ratchet-check.test.mjs` 的分组选择）。**每个文件的改动在 diff 里必须可单独识别**（哪怕合并成一次提交，也要保证 `git diff` 逐文件可读）——这样如果监控窗口里某一个文件真的复发，能精确回滚那一个文件而不是全部撤回。
2. **落地前本地核验**：`scripts/test.sh` 本地跑一次全量，确认这 5 个文件加入 main 桶后没有跟 main 桶内其它文件产生新的资源冲突（共享临时路径/端口等，`plugin/test-isolation-violations.txt` 覆盖的那类问题，跟本任务修的病因是两回事，必须分开核对不能假设"不冲突"）。
3. **落地**：提交 `@test-group` 变更；在任务体里记录落地提交的 SHA 与真实墙钟时间戳（供 AC3 的监控窗口计算起点，不得用任务开始时间代替）。
4. **监控窗口（AC3，真·待外部，不阻塞本任务落地，但阻塞"本任务视为已确认稳定"）**：落地之后，需要 ≥20 轮真实生产全量套件运行（`.quay/verification-round.jsonl` 里 `startedAtMs` 晚于落地提交时间戳的记录）里，这 5 个文件在 `engine` 分组下全部通过。这一步不能在本次派发的单个 worker session 内完成（真实生产轮次需要真实时间积累，参照 `gap-suite-scheduler-perfile-cpu-emitter-missing` AC3/AC5 的先例）——本任务落地时诚实标注该 AC 为"真·待外部"，后续由任意一次核验（人工或另一次会话）补上读数；若监控期内某个文件真的复现失败，**只回滚那一个文件的分类**，并在任务体追加订正记录该反例（不得把它当噪音悄悄忽略——这正是本任务存在的意义：给出一个能被真实数据推翻的判断，而不是不可证伪的方向性猜测）。

## Acceptance Criteria

- [ ] AC1（能取假，重分类落地）：`git diff` 显示上述 5 个文件的 `@test-group` 头从 `serial`/`lowconc` 改为 `engine`，且逐文件可辨识；未改动 `plugin/scripts/runner-grouping.ts` 本身的分类逻辑（本任务只改文件标注，不改分类机制）；（⛔ 有文件遗漏、或误改了分类逻辑代码 ⇒ 假）。
- [ ] AC2（能取假，落地前本地核验）：落地前本地跑一次 `scripts/test.sh`，Measured 贴出真实命令与结果（0 failed/0 cancelled，或如实记录任何新失败并判断是否与本次重分类相关）；（⛔ 未真实跑过、或跑出新失败却未如实记录判断 ⇒ 假）。
- [ ] AC3（能取假，真·待外部——监控窗口，不阻塞落地，阻塞"已确认稳定"结论）：任务体记录落地提交 SHA 与真实时间戳；DoD 声明该窗口尚未验证时，本条留空/标"真·待外部"而不是伪造一个尚未发生的读数；一旦有 ≥20 轮真实生产记录可查（`verification-round.jsonl` 按落地时间戳过滤），须补一次真实核验并在此追加读数（全部通过 ⇒ 勾选；出现复现失败 ⇒ 如实记录哪个文件、哪次、错误信号，并回滚该文件分类，本条仍标注但连同回滚记录一并说明）；（⛔ 编造一个未真实核验过的"全部通过"⇒ 假；⛔ 出现复现失败却隐瞒/不回滚 ⇒ 假）。
- [ ] AC4（能取假，范围守卫）：`git diff` 不含 `plugin/scripts/suite-scheduler.ts` 的准入/调度逻辑改动，也不含 `plugin/scripts/runner-grouping.ts` 分类算法本身的改动——本任务只是把既有机制已经证明安全的 5 个文件挪进它们该在的分组，不新增/改动任何调度机制；（⛔ 动了调度或分类算法代码 ⇒ 超范围 ⇒ 假）。

## Definition of Done

5 个已用 130 次真实生产运行验证过"在新调度器下不再失败"的历史脏文件（3 个原生 serial/lowconc + 2 个历史证据薄弱/从未失败过的额外候选），逐一从 serial/lowconc 改标为 engine（main 桶），落地前有真实本地全量跑通核验（AC1/AC2）；落地后的真实监控窗口读数如实记录（AC3，真·待外部，不伪造），任何复现失败都精确回滚到那一个文件并留痕，不是笼统撤回或悄悄忽略；全程未改动调度/分类机制本身（AC4）。本任务不对"是否应该进一步扩大重分类范围到其它 serial/lowconc 文件"做结论——它只处理这 5 个已有充分证据支撑的候选。

## Touches

- plugin/test/help-contract-incompatible-behaviors.test.mjs（@test-group 头：serial → engine）
- plugin/test/worker-driver-fan-in.test.mjs（@test-group 头：lowconc → engine）
- plugin/test/worker-driver-resident.test.mjs（@test-group 头：lowconc → engine）
- plugin/test/full-suite-runner-phases.test.mjs（@test-group 头：lowconc → engine）
- experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs（@test-group 头：serial → engine）
- tasks/gap-serial-lowconc-reclassify-post-waterline-cap.md（自身）
