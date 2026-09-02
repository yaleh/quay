---
id: gap-runner-grouping-list-groups-perfile-timeout-flaky
title: runner-grouping-list-groups.test.mjs perfile-timeout 78s 超阈值——A 类时序敏感（内部全绿，文件级超时），pre-existing 6 次
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

`plugin/test/runner-grouping-list-groups.test.mjs` 在并发 suite 下文件级 perfile-timeout 超时：`__PERFILE__ duration_ms=77891 passed=false`（78s > 阈值），但测试内部 `pass 3 / fail 0`（3 用例全过）——**用例绿，是文件整体慢超 perfile-timeout 阈值判 failed**，非 assertion 失败。

**pre-existing 高频 flaky**：verification-round 历史失败 6 次（比 vendor-freshness 1、suite-driver 2、outer-session-check 2 都高）。是 flaky 集群第 5 组（vendor-freshness✓ → suite-driver → outer-session-check✓ → spec-declaration✓ → 本条）。A 类时序敏感（文件整体慢、并发 16 核下超 60s perfile-timeout）。

## Plan

三选一（或组合）：
1. **加长 perfile-timeout 阈值**：`full-suite-runner.ts` 的 per-file 阈值对该文件（或整体）放宽。
2. **拆分慢用例**到 serial/lowconc 组（`@test-group` 标注），让慢用例在低并发组跑不被主组并发拖慢。
3. **perfile-timeout 白名单**：该文件加入白名单（已知慢、内部绿）。

验证：并发 suite 下该文件不再 perfile-timeout 判 failed；内部 pass/fail 不变（pass 3）。

## Acceptance Criteria

- [ ] AC1（能取假）：并发 load 下 runner-grouping-list-groups.test.mjs 不再 perfile-timeout 判 failed（duration 不超阈值或白名单豁免）；（⛔ 仍 perfile-timeout failed ⇒ 假）。
- [ ] AC2（能取假，无回归）：该文件内部 pass/fail 不变（3 用例仍全绿，只改超时/分组，不改断言）；（⛔ 改断言/改测试集 ⇒ 假）。

## Definition of Done

perfile-timeout 阈值/分组/白名单处置落地；AC1/AC2 勾；runner-grouping-list-groups 并发下稳定绿；内部 pass/fail 不变；全量 suite 绿。

## Touches

- plugin/scripts/full-suite-runner.ts（perfile-timeout 阈值 / 白名单）
- plugin/test/runner-grouping-list-groups.test.mjs（如拆分慢用例到 serial/lowconc）
- tasks/gap-runner-grouping-list-groups-perfile-timeout-flaky.md（自身）
