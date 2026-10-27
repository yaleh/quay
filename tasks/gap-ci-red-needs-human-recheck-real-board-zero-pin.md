---
id: gap-ci-red-needs-human-recheck-real-board-zero-pin
title: needs-human-parking-recheck 真实 store 测试把 needs_human_total>0 当不变量，board 为 0 时恒红
status: done
labels:
  - gap
  - ci-red
  - defect
parent: null
children: []
extra: {}
---
## Proposal

CI test job 里 `plugin/test/needs-human-parking-recheck.test.mjs` 的 `AC1 — the REAL store` 反复红：
断言 `needs_human_total > 0`。真实 board 的 needs-human 任务数随循环修复判据而波动，当前正好 0
（循环把最后一个 needs-human 翻成了 done）。这不是产品缺陷，是测试把数据态当成了不变量。

## Plan

`needs_human_total === 0` 时用 `t.skip(...)` 显式跳过（跳过 ≠ 空转合格，也 ≠ 数据漂移红），并 return；
分区断言只在有 needs-human 任务时执行。保留该测试「对真实 store 分区」的验证意图与
needs_human_total 的非空转护栏语义。

## AC

- [x] 本地该测试在 board=0 时报告 skipped（不红）。
- [x] board>0 时仍执行四条分区断言（sum == total、stale==parking-reason-stale、judge 齐、无 current hits）。

## DoD

修复提交（377000a60）落地后，board 暂时 0 个 needs-human 任务不再红 CI；循环翻出新 needs-human
任务时该测试恢复真实分区验证。

该轴仍暗,理由:纯测试断言修复，不改动 L_D/L_G 依赖结构，本次提交未记录读数