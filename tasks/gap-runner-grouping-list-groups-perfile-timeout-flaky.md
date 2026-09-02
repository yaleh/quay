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

`plugin/test/runner-grouping-list-groups.test.mjs` 在并发 suite 下间歇性 `__PERFILE__ ... passed=false`（历史 8 轮：32/756/758/810/819/824/858/879）。

**修案更正（根因非超时）**：`passed=false` 不是 perfile-timeout，而是**真实测试失败**——每轮的具体失败行都是 `✖ AC6: --group product,engine ∪ --group lowconc selects the same files as no-args`。`measure-suite-reporter.mjs` 透传 node test runner 的 `details.passed`（gate 名 `perfile-timeout` 是误称，见 memory `perfile-timeout-gate-name-misleads`）。真实根因是 **transient 跨文件竞态**：本文件与 `runner-grouping-serial-anti-stomp.test.mjs` 同为 serial 组、主机推导并发下并发运行，后者的 AC0c 在共享 `plugin/test/` 写 `zz-unknown-group-anti-stomp.test.mjs`（`@test-group bogus`），存活约 1.5s 期间 `scripts/test.sh` 的元数据查询（`--list-files`/`--list-groups`）对未知 group FAIL-CLOSED（exit 3）→ `runTestSh` 的 `assert.equal(r.status, 0)` 抛异常，且 `readStable` 不捕异常 ⇒ AC6 判 failed。

## Plan

原三选一（加长 perfile-timeout 阈值 / 拆分慢用例 / perfile-timeout 白名单）全部基于「perfile-timeout」误诊而作废——白名单/加阈值会造一个「恒绿检查」掩盖真实失败（硬规则 3b）。实际修法：

`runTestSh` 对 FAIL-CLOSED（exit 3）做**有界重读**（4 次）：exit 3 只来自 sibling 的 transient bogus fixture（存活 ~1.5s，fail-closed 快至 ~1.4s）；真实 fail-closed（已提交的 bogus 声明）每次重读都失败 ⇒ 越过界仍浮出，transient fixture 清除则恢复。不改断言、不改测试集（仍 3 用例）。

验证：并发 suite 下该文件不再 `passed=false` 判 failed；内部 pass/fail 不变（pass 3）。

## Acceptance Criteria

- [x] AC1（能取假）：并发 load 下 runner-grouping-list-groups.test.mjs 不再 `passed=false` 判 failed——transient bogus fixture 的 FAIL-CLOSED（exit 3）被有界重读吸收，真实 fail-closed 仍浮出；（⛔ 仍因该文件 `passed=false` 判 failed ⇒ 假）。
- [x] AC2（能取假，无回归）：该文件内部 pass/fail 不变（3 用例仍全绿，不改断言、不改测试集）；（⛔ 改断言/改测试集 ⇒ 假）。

## Definition of Done

`runTestSh` 对 exit 3 的有界重读落地；AC1/AC2 勾；runner-grouping-list-groups 并发下稳定绿；内部 pass/fail 不变（pass 3）；全量 suite 绿。

## Touches

- plugin/test/runner-grouping-list-groups.test.mjs（runTestSh 对 FAIL-CLOSED exit 3 有界重读）
- tasks/gap-runner-grouping-list-groups-perfile-timeout-flaky.md（自身）
