---
id: gap-ac115-spec-phase1-drive-single-worker
title: AC115 SPEC §5 阶段 1——驱动 spawn 单 claude -p worker 跑完整任务（选择→worktree→开发→suite→ff）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 投「结晶」阶段 AC115（编号绑定：`orchestration/SPEC-worker-driven-inner-2026-08-16.md` §5 阶段 1，判据正本在 SPEC，⛔ 不在此复制）。

**形态**：驱动 spawn 一个 `claude -p` worker 跑完整任务（选择→worktree→开发→suite→ff）。

**为什么 inner 执行**：驱动脚本 + outcome 记录属产品机件 → inner 域。

## Plan

1. 实现驱动脚本：spawn 一个 `claude -p` worker 跑完整任务链路（选择→worktree→开发→suite→ff）。
2. 结构化 outcome 落盘字段齐全（SPEC §4③ 形态）。
3. 取假验证：杀 worker ⇒ 驱动察觉并记录，不静默丢任务。

## Acceptance Criteria

- [x] AC1：在飞 = 驱动子进程数（直接量，⛔ 非代理量；不一致以驱动为准）。
- [x] AC2：worker 退出码 + 结构化 outcome 落盘字段齐全（SPEC §4③）。
- [x] AC3（能取假）：杀 worker ⇒ 驱动察觉并记录，⛔ 不静默丢任务。

## Definition of Done

- [x] 单 worker 驱动落地 + outcome 字段齐全 + 杀 worker 取假通过；AC1-3 全勾；land 到 develop。

## Retires

- `--in-flight` 参数传递（slot-refill）
- 遥测括号的「在飞」用途

## Touches

- plugin/scripts/worker-driver.ts (new)（驱动脚本，落点 inner 定）
- .quay/worker-outcome.jsonl (new)（outcome 记录；gitignored 运行时日志）
- plugin/scripts/slot-refill.ts（--in-flight 退役面）
- plugin/test/worker-driver.test.mjs (new)（AC1-3 单测，含杀 worker 取假）
- plugin/test/slot-refill.test.mjs（退役面同步：--in-flight/--running/--closed-but-live CLI 测试 → --in-flight-count / 纯函数）
- plugin/scripts/capability-catalog.sh（worker-driver.ts 进 catalog 声明——新 shipped 脚本必须声明，否则 AC1c 入口闸 exit 1 → mechanism-vitality-check / slot-free-trigger 全量红）
- plugin/test/supervisor-preempt.test.mjs（退役面同步：裸 slot-refill 调用改为 --in-flight-count 0——裸调用已 fail-closed null，.halt 断言需一个「已测 0 在飞」视图）
- .gitignore（新增 `**/.quay/worker-outcome.jsonl` 忽略）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY 快照 274→275——新增 shipped 脚本 worker-driver.ts 的跨文件效应，第三次遗漏）
- tasks/gap-ac115-spec-phase1-drive-single-worker.md（自身）

> **Touches 扩充说明**：原 Touches 只列 worker-driver.ts / worker-outcome.jsonl / slot-refill.ts / 自身。
> 实现时「退役 slot-refill 的 --in-flight 参数传递 + 遥测括号在飞测量」必须同步更新其 CLI 测试
> （slot-refill.test.mjs，否则全量 suite 红），并新增 worker-driver 单测（worker-driver.test.mjs）与
> .gitignore 忽略项（outcome 是 gitignored 运行时日志，与 gate-events.jsonl 同族）。故扩为七项。
> **fan-in 阶段二次扩充（2026-08-22，硬规则 5b——修好一个≠只有那一个）**：全量 suite 暴露出两处
> 未在七项内、但由本任务改动直接引起的跨文件回归——① 新增 shipped 脚本 worker-driver.ts 未在
> capability-catalog.sh 声明 ⇒ AC1c 入口闸 exit 1 ⇒ mechanism-vitality-check / slot-free-trigger 红；
> ② slot-refill 裸调用（supervisor-preempt.test.mjs 的 slotRefill helper）在退役后 fail-closed null ⇒
> .halt 断言红。两处根因都属本任务 Touches 内源文件（worker-driver.ts / slot-refill.ts）的跨文件效应，
> 修正需触碰 capability-catalog.sh 与 supervisor-preempt.test.mjs，故扩为九项。
> **fan-in 阶段三次扩充（2026-08-22，anti-drift HARD FAIL 触发）**：fix commit 29e6dffd 刷新
> DELIVERY-INVENTORY 快照 274→275（worker-driver.ts 进 catalog 声明后 inventory 同步增一），
> 宿主 doc `docs/proposals/quay-product-outline.md` 未声明进 Touches ⇒ anti-drift 越界 HARD FAIL。
> 该快照 bump 是 Touches 内源文件 worker-driver.ts 的跨文件效应，属合法改动（非 revert），
> 故将宿主 doc 补入 Touches，扩为十项。
