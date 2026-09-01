---
id: gap-retire-inner-hygiene-catalog-tests
title: inner 会话卫生退役 step3——同步 capability-catalog 六表 + 测试去留（无「无测试的活脚本」/「无脚本的活测试」）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-retire-inner-hygiene-delete-session-face
    - gap-retire-inner-session-check-script
---
**type:** execution

## Proposal

step2（收窄后，见其任务体"范围收窄说明"）落地后，同步 `capability-catalog.sh` 六表（CADENCE 标退役 / LAST_REAFFIRMED 更新到 2026-09-01 后——这批脚本 CADENCE 仍标"每轮"、LAST_REAFFIRMED 停 2026-08-10，裁定从未同步进唯一清单）。

**⛔ 范围收窄（2026-09-01 复核）**：原 Touches 里的 `inner-session-check.test.mjs`/`inner-idle-log.test.mjs`/`inner-forensics.test.mjs` 三项移出本任务：
- `inner-session-check.test.mjs` 的去留已随 `inner-session-check.sh` 一起移交给独立任务 `gap-retire-inner-session-check-script`（避免两条任务同时改同一测试文件）。
- `inner-idle-log.test.mjs`/`inner-forensics.test.mjs` 经复核**不是"去留待判"，是已确认应保持不动**——它们测的 `inner-idle-log.ts`/`inner-forensics.mjs` 仍被 `quay-init.sh`/`build-plugin-dist.mjs`/`quay-deliver.ts`/`session-liveness.sh`/`loop-shipping-exclusion-data.mjs` 实调（①类 inner 层引用，非会话卫生面），不属于本次退役范围，不需要"去留判断"这个动作。

## Plan

1. `capability-catalog.sh` 六表同步：`gap-retire-inner-hygiene-migrate-helper` + `gap-retire-inner-hygiene-delete-session-face` 两步落地后退役/迁移的脚本，CADENCE 改退役标记、LAST_REAFFIRMED 更新到 2026-09-01 后。
2. 全仓最终扫描：确认整个 inner 会话卫生退役链（migrate-helper → delete-session-face → 本任务 → `gap-manager-adopt-outer-role-check-broken` → `gap-retire-inner-session-check-script`）落地后，无"无测试的活脚本"或"无脚本的活测试"孤儿残留（脚本↔测试一一对应扫描）。

## Acceptance Criteria

- [x] AC1（能取假，catalog 同步）：catalog 六表里退役脚本 CADENCE 标退役、LAST_REAFFIRMED 更新到 2026-09-01 后；⛔ 仍标"每轮"/旧日期 ⇒ 假。
  - 实测：3 个退役（已删）脚本 `inner-panel-stale-check.ts` / `inner-exec-mode-report.ts` / `inner-session-check.sh` 的 catalog 六表条目数均为 0（CADENCE「每轮」随条目删除 = 标退役，grep -c 全为 0）；6 个复核后仍活的脚本 LAST_REAFFIRMED 2026-08-10/11 → 2026-09-01（`monitor-mount-check.sh` / `inner-blocked-signal.ts` / `inner-forensics.mjs` / `inner-idle-log.ts` / `inner-wakeup-heartbeat.ts` / `inner-wakeup-heartbeat-check.ts`）。`capability-catalog.sh --summary` = 309 scripts / 309 declared / 0 unclassified / exit 0；`capability-catalog.test.mjs` 16/16 绿；`--superseded-check` PASS。
- [x] AC2（能取假，全链最终扫描，非"去留判断"）：全仓脚本↔测试一一对应扫描，无孤儿残留；⛔ 存在孤儿 ⇒ 假。**本条判据只在 `gap-retire-inner-session-check-script` 也已落地后才可判定**（它是全链的最后一环）。
  - 实测（前置 `gap-retire-inner-session-check-script` 已 done）：`test-impl-census-check` = 562 test files / impl-deleted 0（test→impl 方向无孤儿）；6 个仍活脚本 ↔ 测试一一对应（`inner-blocked-signal` / `inner-forensics` / `inner-idle-log` / `inner-wakeup-heartbeat` / `inner-wakeup-heartbeat-check` / `monitor-mount-check` 的 `.test.mjs` 均在）；3 个已删脚本 ↔ 测试同删（`inner-panel-stale-check` / `inner-exec-mode-report` / `inner-session-check` 的 `.test.mjs` 均 gone）；`plugin/test/` 内对已删脚本的引用仅剩注释（无功能性 import）。

## Definition of Done

capability-catalog 六表 CADENCE/LAST_REAFFIRMED 同步、全链（含 `gap-manager-adopt-outer-role-check-broken`/`gap-retire-inner-session-check-script`）落地后脚本↔测试无孤儿残留、typecheck 与相关测试绿。

## Touches

- plugin/scripts/capability-catalog.sh（六表同步）
- tasks/gap-retire-inner-hygiene-catalog-tests.md（自身）
