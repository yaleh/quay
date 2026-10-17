---
id: gap-arch-coverage-report-report-only-not-run-in-production
title: arch-coverage-report 是 report-only、生产从不跑——「哪些目录没有任何分析器到达」仍不可查
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`plugin/scripts/arch-coverage-report.ts:26` 自证「REPORT ONLY, NEVER A GATE」，且只有其自身测试引用它、无生产调用。它存在的理由正是回答「哪些语言/目录没有任何 scope 到达」——这个量在生产上仍然不可查。ClaudeCodeUI 侧的教训（`.mjs`/`.sh`/`.jsx` 不可见、整仓 scope 冒充覆盖）说明「未评估≠干净」在覆盖面维度需要生产读数。⚠️ 本任务不做 ratchet——保留 report-only 语义，只补生产触发 + 基线。

## Plan

1. 把 arch-coverage-report 作为例程或 suite 报表跑起来（挂进 quality-gate-driver 的例程轨或 test.sh 报表位，report-only、不 ratchet）。
2. 存基线：每次跑把 per-language/per-directory 覆盖读数 append 进一个可查载体（如 `.quay/arch-coverage-history.jsonl`）。
3. 报表顶部显式输出 NOT-EVALUATED 目录/语言数（已有三态：analyzed / NOT-EVALUATED / evaluated:false），作为「覆盖未完成」的可见读数。

## Acceptance Criteria

- [ ] AC1（能取假·生产产出）落地后一条 post-landing 例程轮在覆盖率载体里产生新记录（真跑，非仅实现）；无新记录即假。
- [ ] AC2（未评估可见）载体记录含 NOT-EVALUATED 计数，且对无分析器的语言（mjs/js/sh/py）非零。
- [ ] AC3（非 ratchet）report-only：NOT-EVALUATED 非零不使例程轮 failed（区别于「红了」）。

## Definition of Done

arch-coverage-report 在例程/报表位真跑并留可查基线；NOT-EVALUATED 计数在生产可读；AC1–AC3 勾。

## Touches

- plugin/scripts/quality-gate-driver.ts（例程轨接线，或 scripts/test.sh 报表位）
- plugin/scripts/arch-coverage-report.ts（追加基线载体写入）
- tasks/gap-arch-coverage-report-report-only-not-run-in-production.md