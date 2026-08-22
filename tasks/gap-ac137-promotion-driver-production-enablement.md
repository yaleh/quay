---
id: gap-ac137-promotion-driver-production-enablement
title: AC137 驱动的生产启用（在跑 + 载体在长 + 重启存活）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac130-promotion-driver-resident-loop
---

**type:** execution

## Proposal

**来源**：manager 投立案（判据正本在 `orchestration/manager-phase-goal.md` `### AC137`，提交 `e9e73928`，⛔ 不在此复制，读那一段）。

**缺口（实测，非推断）**：AC130–136 七条全 done 时，`ps | grep promotion-driver` = 零命中、`.quay/promotion-outcome.jsonl` 不存在 ⇒ 驱动「机制存在但没在跑」。三条「待外部」判据（AC134-AC2 / AC135-AC2 / AC135-AC3）结构上【无法起算】——它们都要求驱动在生产中实际运行，而没有任何一条 AC 要求把它启动起来。

**同形**：AC126 的立条理由「机制存在 ≠ 生产启用」——本阶段漏了「谁按下开关」这一层。AC137 是那三条的前提，三者的窗口自 AC137-1 成立之时起算。

## Plan

1. 在生产中启动 `promotion-driver` 为常驻进程（启动形态落笔方定：systemd / 会话内常驻 / 其它皆可，⛔ 判据不规定形态）。
2. 确认 `.quay/promotion-outcome.jsonl` 产生且记录数随时间增长。
3. 重启存活：kill 驱动后能重新起来（守护/告警）。
4. ⛔ 不改 `promotion-driver.ts` 逻辑本身（AC130-133 已覆盖）。

## Acceptance Criteria

- [ ] AC1（在跑）：`promotion-driver` 在生产中作为常驻进程运行（`ps` 可见）。
- [ ] AC2（载体在长）：`.quay/promotion-outcome.jsonl` 存在且记录数随时间增长（⛔ 非「文件被创建」，是「有新记录持续写入」）。
- [ ] AC3（重启存活）：驱动异常退出/机器重启后能重新起来（⛔ 否则窗口被静默中断无人察觉）。

## Definition of Done

- [ ] 驱动生产启用（在跑 + 载体在长 + 重启存活）；AC1-3 全勾；land 到 develop。

## Retires

- net-add（本条是启用，不退役既有机件）

## Touches

- plugin/scripts/promotion-driver-launch.sh (new)（常驻启动/守护，形态落笔方定：systemd/会话内常驻皆可）
- tasks/gap-ac137-promotion-driver-production-enablement.md（自身）

> **注意**：若启动形态为 systemd（无 repo 文件），launch 脚本 Touches 可替换为实际部署面；判据不规定形态，只要求 `ps` 可见 + 载体在长 + 重启存活。
