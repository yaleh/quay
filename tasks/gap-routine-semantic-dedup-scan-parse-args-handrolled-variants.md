---
id: gap-routine-semantic-dedup-scan-parse-args-handrolled-variants
title: "semantic-dedup-scan: three identical if/else flag loops plus three
  spelling variants, none importing the spec-driven shared parseArgs
  (gate-script-base's own docstring already reco"
status: done
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
three identical if/else flag loops plus three spelling variants, none importing the spec-driven shared parseArgs (gate-script-base's own docstring already recorded 21 private parseArgs with only 3 importing the shared one); convergence is blocked because the shared one process.exit()s on --help

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791536153223` · ts `2026-10-09T08:55:53.223Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`parseArgs`
- 涉及文件：
- `plugin/scripts/gate-script-base.ts:83`
- `plugin/scripts/perfile-failure-rate.ts:274`
- `plugin/scripts/psi-failure-correlation-check.ts:188`
- `plugin/scripts/psi-window-join.ts:148`
- `plugin/scripts/self-report-vocab-check.ts:137`
- `plugin/scripts/workflow-invariant-ownership.mjs:22`
- `plugin/scripts/workflow-metadata-conformance.mjs:699`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
merge — give the shared parser a non-exiting help mode

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `parse-args-handrolled-variants`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791536153223`）所描述的问题被复核并处置 —— 已修掉：`CliSpec.help: "exit"|"return"` 给共享 `parseArgs` 加了非退出 help 态，六个手搓 flag 循环（三个 if/else + 一个 switch + 两个 while）全部改为薄适配层调用它（commit 0f32d205e）
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— 修掉，且每条可核：新 `plugin/test/gate-script-base-help-mode.test.mjs` 5/5（返回态进程内钉、退出态子进程钉，带 `REACHED-AFTER-HELP` 反控制）；六个受影响套件 126/126；help-contract 扫描 4/4（psi-failure-correlation-check 是 `-check.ts`，受其约束）；`--for-task` scoped 门 174/174 exit 0，anti-drift 无 out-of-declared

## DoD
- [x] 上面的判据实跑通过 —— `bash scripts/test.sh --for-task gap-routine-semantic-dedup-scan-parse-args-handrolled-variants --allow-thin` 在本 worktree 实测 exit 0（174 pass / 0 fail，静态层含 test-file-snapshot / import-graph / mirror-pair-drift / checked-in-write 全绿）
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 相符：例程只经 `plugin/scripts/routine-file-gate.ts` 三闸立案，修复由派发链（本 worker）执行，探针未改任何文件

## Touches
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/perfile-failure-rate.ts`
- `plugin/scripts/psi-failure-correlation-check.ts`
- `plugin/scripts/psi-window-join.ts`
- `plugin/scripts/self-report-vocab-check.ts`
- `plugin/scripts/workflow-invariant-ownership.mjs`
- `plugin/scripts/workflow-metadata-conformance.mjs`
- `plugin/test/gate-script-base-help-mode.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-parse-args-handrolled-variants.md`
