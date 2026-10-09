---
id: gap-routine-semantic-dedup-scan-task-check-flag-loops-duplicate
title: "semantic-dedup-scan: near-identical flag-parsing loops
  (root/json/write-ratchet/allow-growth/reset-baseline/strict-subset/no-block/f\
  iles) in the two task checkers — a separate real"
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
near-identical flag-parsing loops (root/json/write-ratchet/allow-growth/reset-baseline/strict-subset/no-block/files) in the two task checkers — a separate real duplication discovered while dismissing the runCli name collision

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791536153223` · ts `2026-10-09T08:55:53.223Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`runCli`
- 涉及文件：
- `plugin/scripts/task-ac-carryover-check.ts:336`
- `plugin/scripts/task-contract-check.ts:544`
- kind：`divergent-implementation`
- verdict：`real-duplication`

## Requested action
extract the shared flag loop (and fold onto gate-script-base.parseArgs)

## 处置
**修掉**——两个 task checker 各自的私有 flag 循环已删除，改为调用
`plugin/scripts/gate-script-base.ts` 的 `parseArgs`（本仓库唯一 spec-driven 参数解析器）。

- `task-ac-carryover-check.ts` / `task-contract-check.ts` 的 `runCli` 不再手写
  `--root/--json/--write-ratchet/--allow-growth/--reset-baseline/--no-block`（contract 另有
  `--strict-subset`）的 if/else 循环；改用 `parseArgs(argv, { minArgs: 0, strict: true, flags: {…} })`。
  `strict:true` 保留原循环的未知 `--flag` 守卫（exit 2）；`minArgs:0` 因全量扫描即零 positional 默认。
  contract 的入口改传 `process.argv` 原值（`parseArgs` 自己拥有 `slice(2)` 约定）。
- 控制（按位置判定，硬规则 2）：两文件的测试各新增
  `disposition: runCli uses the SHARED parseArgs and carries no private flag loop`（断言实际 import 绑定
  + 私循环字面头缺席）与 `disposition: an unknown --flag exits 2`。
- 证据：`grep -c "for (let i = 0; i < args.length; i++)"` 在两文件各为 0；两测试套 89 tests / 87 pass / 0 fail；
  scoped gate `bash scripts/test.sh --for-task gap-routine-semantic-dedup-scan-task-check-flag-loops-duplicate --allow-thin` exit 0。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `task-check-flag-loops-duplicate`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791536153223`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/task-ac-carryover-check.ts`
- `plugin/scripts/task-contract-check.ts`
- `plugin/test/task-ac-carryover-check.test.mjs`
- `plugin/test/task-contract-check.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-task-check-flag-loops-duplicate.md`