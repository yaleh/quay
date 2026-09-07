---
id: gap-delivery-critical-mechanical-axis-orphaned-needs-ruling
title: delivery-critical 机械排序轴（slot-refill/concurrent-batch-scheduler,
  AC36）是孤儿——outer-driver 不在标准启动集，产出无消费者，需人裁定接入 worker-driver 或正式退役
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Finding

**背景（本次对话已查证，非猜测）**：调查发现 `delivery-critical` 标签在派发决策上存在两条互不相通的路径：

**路径 A（机械，写得完整但接不到生产）**：
- `plugin/scripts/slot-refill.ts:1030`（`dcLabels`）+ `:1159-1175`（`candidates.sort`）把排序键从 `(blocking_suite, id)` 改成 `(blocking_suite, delivery_critical, id)`——这是 `gap-ac36-delivery-critical-priority-axis`（已 done）落地的真实机械代码，AC5 证据称有 102 条测试覆盖。
- `plugin/scripts/concurrent-batch-scheduler.ts:85-119`（`parseCandidate`）读 frontmatter `labels`，暴露 `deliveryCritical` 布尔。
- **但** `slot-refill.ts:1201-1212`（AC56 `gap-ac56-recommended-deordered`，已 done）把这条优先序从输出的 `recommended` 数组里去掉——`recommended` 被重新按字典序排列，`ranking`（携带 `deliveryCritical`）只作为"验证面"保留，注释逐字：「the inner tick does NOT consume for dispatch」（`slot-refill.ts:1209`）。
- 唯一真正把 `slot-refill.ts` 接入"读数→动作"链条的调用方是 `plugin/scripts/outer-driver.ts:223-234`（`slotRefillRoutine`）。
- **`outer-driver.ts` 不在标准启动集里**：`plugin/scripts/start-drivers.ts:30` `const DRIVER_KINDS = ["promotion", "worker"] as const;`——标准冷启动（`quay:drivers` skill）只起 `promotion`/`worker` 两种 driver kind，不起 `outer`（尽管 `outer` 仍是 `packages/quay/src/cli/driver.ts:33` 里注册的合法 kind）。
- 即使起了，读数也无消费者：`orchestration/SPEC-capability-planes-and-mechanism-lifecycle-2026-09-05.md:56` 逐字——「一个 driver 在对空气产出结构化 Fact｜`.quay/outer-round.jsonl` 自 2026-08-26 每轮写入；除 `outer-driver.ts` 自身外，全仓库仅 `driver-runtime.ts:175`（carriers 登记，供 `carrierStats` 做存活统计）引用它 ⇒ Fact 的内容无任何程序消费者」。

**路径 B（真实在跑，纯靠 LLM 自觉）**：
- `worker-driver.ts` 对 `slot-refill` 零 import/零调用。
- 候选集来自 `driver-runtime.ts:704-711`（`readyPoolCheck`）调用 `ready-pool-check.ts` 的 `pool.ready`——这个数组在 `ready-pool-check.ts:2147` 只是 `ready.sort()`（纯字典序，无 delivery-critical 轴）。
- 真正"挑一个"的动作由 `driver-runtime.ts:731-740`（`defaultSelectorArgv`）构造 prompt，spawn 一个 LLM 子代理（`worker-default` profile），指示它读 `orchestration/dispatch-preference.md` 并按其覆盖段谓词判断——**prompt 里只传了 candidate id 列表，没有传任何 `labels` 字段**，delivery-critical 判断完全交给这个 LLM 子代理自己去读文件。
- 实证（生产读数，非猜测）：`.quay/worker-dispatch.json` 里 selector 实际写下的 `selectorReason` 字段确实包含按 delivery-critical 谓词推理的痕迹——证明这条纯 prompt/自觉路径在真实生产环境里"目前碰巧在跑"，但机制上没有任何代码强制它一定会这么做。

**核心问题**：这是同一个语义目标（delivery-critical 任务优先派发）的两套实现，**一套有测试保证但是孤儿，一套是生产路径但无机制保证**。这不是"要不要修"的技术问题，是"往哪个方向统一"的架构取舍，需要人拍板。

## AC

- [ ] 人/manager 就"接入 worker-driver 真实链路" vs "正式退役 slot-refill/concurrent-batch-scheduler 的 delivery-critical 排序功能"做出裁定，裁定文本与理由记入本任务或对应 ADR/directive。
- [ ] 若选接入：worker-driver.ts 的候选池排序（或 selector prompt 的输入）实际读取该机械轴的结果，有一条端到端测试证明"delivery-critical 任务在候选集中被排到非 delivery-critical 任务之前"是由机械代码保证，而非仅靠 LLM 自觉（可以是：先跑机械预排序缩小/排序候选集，再交给 selector 在同优先级内做语义选择，两层不冲突）。
- [ ] 若选退役：移除/标注 `slot-refill.ts` 与 `concurrent-batch-scheduler.ts` 中不再被消费的 delivery-critical 排序代码路径及其测试（不留孤儿代码增加认知负担），并在 `dispatch-preference.md` 明确"该轴不存在，排序完全由 selector 语义判断"。
- [ ] 二选一落地后，`SPEC-capability-planes-and-mechanism-lifecycle-2026-09-05.md` 中关于 `outer-driver` Fact"无消费者"的记录同步更新（若接入，该判断需要撤销或补充说明；若退役，该判断保持但补上"已确认退役，孤儿代码已清理"的结论）。

## DoD

- [ ] 上述判据本轮实跑并贴出输出，不是转述。
- [ ] 无论哪个方向，`git log` 上能看到一次真实的端到端验证（接入：真派发一次带 delivery-critical 标签的任务观察排序；退役：确认移除后全量 suite 仍绿）。

## Touches

- `plugin/scripts/slot-refill.ts`
- `plugin/scripts/concurrent-batch-scheduler.ts`
- `plugin/scripts/outer-driver.ts`
- `plugin/scripts/worker-driver.ts`
- `plugin/scripts/driver-runtime.ts`
- `orchestration/dispatch-preference.md`
- `orchestration/SPEC-capability-planes-and-mechanism-lifecycle-2026-09-05.md`
- `tasks/gap-delivery-critical-mechanical-axis-orphaned-needs-ruling.md`
