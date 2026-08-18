---
id: gap-outer-quality-heartbeat-missing
title: "缺「质量心跳」——扫 eligible=false 的已存在 todo 并主动修（补 Touches/DoD），不等外部发现"
status: todo
labels:
  - gap
  - process
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

「把不合格 todo 改到合格」（写 `## Touches` / 补 DoD 这类内容编辑）人 2026-08-13 有明确裁定「执行者=outer」（commit ced062bd），但**从未进 orchestrator-tick-core.md 变成强制步骤**（grep「不合格」/selfTouchOk/fourArtifacts 全文档零命中）。历史上仅两次一次性清扫：86dacd51（08-13，AC46 任务本身触发）+ 今天（manager 发现后路由）——都是被动触发，不是主动巡检。gap-ac46 自己在 08-13 判据3 写过「不靠 outer 轮巡」——今天 13 条卡 5 天正是这句话 5 天后应验。

## Acceptance Criteria

- [ ] AC1: outer 核心加「质量心跳」步骤（参照 A22 形态：每 tick 扫 `ready-pool-check --json` candidates 的 eligible=false 已存在 todo，主动补 Touches/DoD 使其合格）。
- [ ] AC2: 负控制——一批 eligible=false todo 落盘后，下一 tick 被主动修（不等外部发现）。

## Definition of Done

- [ ] 一个 eligible=false todo 被质量心跳主动修到 eligible=true（真实输出，非外部发现后补）。

## Touches

- tasks/gap-outer-quality-heartbeat-missing.md（自身）
- orchestration/orchestrator-tick-core.md（若作为强制步骤落地）
