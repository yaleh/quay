---
id: gap-retire-inner-hygiene-catalog-tests
title: inner 会话卫生退役 step3——同步 capability-catalog 六表 + 测试去留（无「无测试的活脚本」/「无脚本的活测试」）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-retire-inner-hygiene-delete-session-face
---
**type:** execution

## Proposal

step2 删完②类面后，同步 `capability-catalog.sh` 六表（CADENCE 标退役 / LAST_REAFFIRMED 更新到 2026-09-01 后——这批脚本 CADENCE 仍标「每轮」、LAST_REAFFIRMED 停 2026-08-10，裁定从未同步进唯一清单）+ `inner-session-check` / `inner-idle-log` / `inner-forensics` 测试去留，无「无测试的活脚本」或「无脚本的活测试」残留。

## Plan

1. `capability-catalog.sh` 六表同步：退役脚本 CADENCE 改退役标记、LAST_REAFFIRMED 更新到 2026-09-01 后。
2. 测试去留：`inner-session-check.test.mjs` / `inner-idle-log.test.mjs` / `inner-forensics.test.mjs` 随脚本退役而删或随活功能而留，与脚本/机件一一对应。

## Acceptance Criteria

- [ ] AC1（能取假，catalog 同步）：catalog 六表里退役脚本 CADENCE 标退役、LAST_REAFFIRMED 更新到 2026-09-01 后；（⛔ 仍标「每轮」/旧日期 ⇒ 假）。
- [ ] AC2（能取假，测试去留一致）：无「无测试的活脚本」或「无脚本的活测试」残留（grep 脚本↔测试一一对应）；（⛔ 残留孤儿 ⇒ 假）。

## Definition of Done

capability-catalog 六表 CADENCE/LAST_REAFFIRMED 同步、inner 测试去留与脚本一一对应、无「无测试的活脚本」或「无脚本的活测试」残留、typecheck 与相关测试绿。

## Touches

- plugin/scripts/capability-catalog.sh（六表同步）
- plugin/test/inner-session-check.test.mjs（去留）
- plugin/test/inner-idle-log.test.mjs（去留）
- plugin/test/inner-forensics.test.mjs（去留）
- tasks/gap-retire-inner-hygiene-catalog-tests.md（自身）
