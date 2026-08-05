---
id: gap-delivery-surface-grows-but-target-freezes-no-upgrade
title: "no upgrade channel — meta-cc is missing 8 derived scripts, 7 of them
  built AFTER 08-03, so the drift is not misinstall but the delivery surface
  GROWING while the target project stays frozen at install time (measured: 漂移 10
  / 缺失 68 / 一致 8); the quay-init install is a snapshot, not a version — add an
  upgrade/refresh path (re-run quay-init detects + updates drifted/missing
  derived scripts) + a drift report as an L2 continuous-health criterion"
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`SPEC-complete-delivery-surface-2026-08-05.md` 五处实测缺口之**升级通道全缺**：meta-cc 缺的 8 个派生脚本
里 **7 个是 08-03 之后造的** ⇒ **漂移不是装错，是交付面自己长大了而目标项目冻结在装的那一刻**
（实测 **漂移 10 / 缺失 68 / 一致 8**）。

**根因**：`quay-init` 是一次性安装快照，不是版本——交付面（`plugin/scripts` 派生脚本）持续增长，
目标项目没有升级路径，装完就冻在那一刻。

**后果**：目标项目跑的是旧机件；新机制（派生脚本）不出现；「装了 quay」不等于「能用最新 quay」。

### 选定机制

**加升级/刷新通道 + 漂移报告（作为 L2 持续健康判据）**：

1. **升级/刷新路径**：`quay-init`（或 `quay upgrade`）重跑时**检测并更新**目标项目的派生脚本——与当前
   交付物的差异（漂移 = 内容旧、缺失 = 不在、一致 = 最新）逐项列出，自动更新缺失/漂移的派生脚本。
2. **漂移报告**：升级时输出 `漂移 N / 缺失 N / 一致 N` 清单（meta-cc 实测 10/68/8 的机械版）——
   L2 持续健康判据的「升级正确性」维度（目标项目机件与当前交付物的差异）。
3. **不静默覆盖**：本地改动的派生脚本 = 漂移（列出，需确认才覆盖）；缺失的自动补。

**与 L1/L2 的关系**：升级正确性是 L2 持续健康三类之一（`gap-quality-criteria-are-point-in-time` 的
§3 类别）；本条是它的机制实现 + 升级通道。

## Acceptance Criteria

- [ ] AC1: **升级/刷新路径**——`quay-init` 重跑检测并更新目标项目派生脚本（差异逐项：漂移/缺失/一致）
- [ ] AC2: **漂移报告**——输出 `漂移 N / 缺失 N / 一致 N`（meta-cc 实测 10/68/8 的机械版）；L2「升级
      正确性」维度
- [ ] AC3: **不静默覆盖**——本地改动的派生脚本 = 漂移（列出需确认），缺失的自动补
- [ ] AC4: 与 L2 交叉标注——升级正确性补进 `gap-quality-criteria-are-point-in-time-no-trend-criteria`
- [ ] AC5: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1–AC5 全部勾上；AC2 实测输出贴任务体
- [ ] 目标项目可升级（重跑检测 + 更新）；漂移报告可读；「装了 quay」= 能用最新 quay
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/scripts/quay-init.sh（或等价：升级/刷新 + 漂移检测）
- plugin/scripts/（漂移报告 helper，若成脚本）
- plugin/test/（AC1/AC2/AC3 fixture）
- tasks/gap-quality-criteria-are-point-in-time-no-trend-criteria.md（AC4 交叉标注）

## Contract

measure   drift_report = `bash plugin/scripts/quay-init.sh --check-drift` stdout 的 漂移/缺失/一致 数字段
band      drift_report 可解析（三数字齐全；缺失/漂移可升级到 0 或列明）
invariant not_snapshot = 1（安装是版本可升级，非一次性快照）
invoke    `bash plugin/scripts/quay-init.sh --check-drift`
control   构造目标项目缺一个派生脚本 ⇒ 升级必补 + 报告缺失-1；本地改动脚本 ⇒ 列漂移不静默覆盖
resume    升级路径与漂移报告分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T06:1xZ
changed: 外层读 SPEC 五处缺口之升级通道裁定立案。四处收紧：
(1) **根因 = 交付面生长 vs 目标冻结**——7/8 缺失脚本是 08-03 后造的，漂移非装错；
(2) **升级/刷新路径**——重跑检测 + 更新派生脚本（差异逐项）；
(3) **漂移报告 = L2 升级正确性维度**——漂移/缺失/一致 机械输出（10/68/8 的机械版）；
(4) **不静默覆盖**——本地改动列漂移需确认，缺失自动补。
status: todo——升级通道；排 delivery-surface umbrella 后。
