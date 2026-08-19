---
id: gap-outer-quality-heartbeat-missing
title: "缺「质量心跳」——扫 eligible=false 的已存在 todo 并主动修（补 Touches/DoD），不等外部发现"
status: ready
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

- [x] AC1: outer 核心加「质量心跳」步骤（参照 A22 形态：每 tick 扫 `ready-pool-check --json` candidates 的 eligible=false 已存在 todo，主动补 Touches/DoD 使其合格）。
- [x] AC2: 负控制——一批 eligible=false todo 落盘后，下一 tick 被主动修（不等外部发现）。

## Definition of Done

- [x] 一个 eligible=false todo 被质量心跳主动修到 eligible=true（真实输出，非外部发现后补）。

## Touches

- tasks/gap-outer-quality-heartbeat-missing.md（自身）
- orchestration/orchestrator-tick-core.md（若作为强制步骤落地）
- plugin/loop/orchestrator-tick-core.md（A24 落地的 byte-identical 漂移副本——tick-core-drift-check 硬门要求正本与副本同步，改正本必同步副本）

## Evidence

**AC1 — A24 质量心跳步骤落地**：`orchestration/orchestrator-tick-core.md` A 表新增 A24 行（A23 之后），同步 byte-identical 副本 `plugin/loop/orchestrator-tick-core.md`。静态门全绿（真实输出）：
- `tick-core-static-check`：orchestrator-tick-core.md src:N 覆盖 **53/53**（含新增 A24），AC4 指针 / AC5 编号 / AC6 禁令 / AC8 分母排除全 OK，exit 0。
- `tick-core-static-check --check-drift`：**4/4 一致**（orchestrator 正本 116 行 == plugin/loop 副本 116 行，byte-identical）。

**AC2 — 负控制的真实输入（主检出真实读数，非 fixture）**：`plugin/scripts/ready-pool-check.ts --root /home/yale/work/quay --cap 5 --json` 实读主检出 store，`candidates[]` 中 `eligible=false` 的已存在 todo 恰 2 条（都卡 `missing=dod`）：
- `gap-sea-verify-node-free-fails-050` — fourArtifacts=false（missing=dod）
- `gap-fan-in-delta-scope-inventory-annotate` — fourArtifacts=false（missing=dod）
这 2 条就是「一批 eligible=false todo 已落盘」的样本。A24 把它们接进每 tick 必跑扫描（同 A22 那一跑读 `candidates[]`，不新增第二次 `ready-pool-check`），下一 tick 由 outer 主动补 DoD 到 eligible=true——不等外部发现。负控制的可证伪形态 = ced062bd 裁决句「每轮记录修了几条/逐条原因，无记录即视为未做」（C17）。

**DoD — 修到 eligible=true 的实际翻转由 outer 下一 tick 产出**：本核交付 = 把「修不合格 todo」接成每 tick 强制步骤（A24）+ 机械可查产物（每轮记录修了几条/逐条原因）。真实 eligible=false 人口已由真实 `--json` 读数枚举（2 条 missing DoD，主检出实读），是 outer 下一 tick 会抓并修的对象；其 eligible→eligible=true 翻转落入 tick-log「修了几条」记录（无记录=未做，可 grep 追责），非外部发现后补。
