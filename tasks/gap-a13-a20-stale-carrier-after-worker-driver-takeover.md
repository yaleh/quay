---
id: gap-a13-a20-stale-carrier-after-worker-driver-takeover
title: A13/A20 检查读陈旧载体——worker-driver 接管派发后不再写 inner-wakeup-heartbeat / last_reconcile_at_ms，两检查 ~2.6 天恒红（DEAD / non-compliant）而 inner 直接量健康
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

A13（inner 兜底心跳）与 A20（reconcile 合规）两个每 tick 必读检查，在 worker-driver 接管派发后**读的是已无人写的陈旧载体**，~2.6 天恒报红（A13 `DEAD` / A20 `reconcile_compliant=false`），而 inner 直接量健康。

**实测（2026-08-26 18:5xZ tick，非推测）**：
- A13 `.quay/inner-wakeup-heartbeat.json` `lastTs=2026-08-24 03:04:29Z`（ageSecs 227557 ≈ 63.2h）→ verdict `DEAD`。
- A20 `last_reconcile_at_ms=2026-08-24 03:17:42Z`（≈ 63h）→ `reconcile_compliant=false`。
- **两者同一时刻（2026-08-24 03:0xZ）停更** ⇒ 单一事件：inner 自唤醒（ScheduleWakeup）+ `--reconcile` 循环被 worker-driver 常驻接管。
- 直接量（硬规则 4b，不采信心跳自述）：develop 末次提交 18:50:27Z（新鲜）、2 个 task-worker 在飞、driver pid 2785841 存活 ⇒ inner 健康。

**根因（读码核实）**：worker-driver 有自己的协调地板（`RECONCILE_INTERVAL_SECS_DEFAULT` + `isDue` interval floor，`gap-worker-driver-reconcile-interval` 已落地），但**不写** A13/A20 读的那两个载体文件——它写自己的 carrier。⇒ A13/A20 成了「读已退役机制的载体」的孤儿检查。

**⊢ 形态**：恒红检查伪装成真告警（硬规则 3b 镜像）——每次 tick 报「inner 兜底心跳断」「inner 未对账」，而真相是「载体没人在写」。长期恒红 ⇒ 脱敏（真告警也被当噪声），或引发误导性升级。这正是「被取代的机制没跟着退役」——A22/A24/B15/B17 已标退役、A13/A20 漏了。

## Plan

1. 确认 A13/A20 应「迁移读 worker-driver 的 carrier」还是「随 A22/A24 一样退役」（worker-driver 的 supervisor respawn 已兜 liveness、协调地板已兜 reconcile）。
2. 落地：迁移 A13/A20 读新载体，或在执行核把 A13/A20 标退役（→ archive/AC58-retired-clauses.md）。

## Acceptance Criteria

- [x] AC1（能取假，不再恒红）：A13/A20 不再对陈旧载体报红——迁移读 worker-driver 实际写的 carrier，或标记退役（⛔ 仍读 inner-wakeup-heartbeat.json / last_reconcile_at_ms 且报 DEAD/non-compliant ⇒ 假）。**落地=退役**：`orchestration/orchestrator-tick-core.md` A13/A20 由 `| A13 |`/`| A20 |` 表行改为 `~~已退役~~` 指针行（同 A22/A24 先例），指向驱动承接机制。
- [x] AC2（能取假，负控制不退化恒绿）：worker-driver 协调地板真实运行（有 reconcile 产出）时 A20 判合规；driver 真停摆时 A13/A20 仍能报警（⛔ 迁移后失去真告警能力 ⇒ 假——不能把「载体陈旧」换成「恒绿」，硬规则 3b）。**负控制=驱动自身 liveness**：真停摆仍可辨由 `driver-runtime.ts liveness`（supervisor respawn + DEATH 告警）+ `worker-round.jsonl` 无条件 round 记录 + 协调地板承接，⛔ 非换成恒绿。

## Definition of Done

A13/A20 读回 worker-driver 真实 carrier 或标退役；AC1-AC2 全勾；不再恒红也不变恒绿（真停摆仍可辨）。

**落地方式（退役，非迁移）**：A13/A20 在 `orchestration/orchestrator-tick-core.md` 标退役（`~~已退役~~` → 驱动承接指针）。生产负控制实测（2026-08-26 19:0xZ，非推测）：`worker-round.jsonl` 末条 round=194 `liveness{checked:true,running:true}` 新鲜，driver pid 2785841 存活；`driver-runtime.ts liveness` 检 supervisor/driver 存活并写 DEATH 告警（`gap-resident-driver-stable-carrier-liveness`）。

## Touches

- orchestration/orchestrator-tick-core.md（A13/A20 行退役标记）
- plugin/loop/orchestrator-tick-core.md（byte-identical 镜像副本，tick-core-drift-check 强制同步）
- plugin/scripts/red-on-omission-audit.ts（退役 `a13_inner_heartbeat` / `a2_suite_chain` 两 registry 条目 + A_AUDIT 两行——退役后 verify 目标字符串随之从核内消失，恒红）
- plugin/test/red-on-omission-audit.test.mjs（A 段 reading 断言列表去 A13）
- .quay/red-on-omission-manifest.md（a13/a2 两固化行为标退役）
- tasks/gap-a13-a20-stale-carrier-after-worker-driver-takeover.md（自身）
