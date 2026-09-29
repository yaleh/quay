---
id: gap-routine-semantic-dedup-scan-concurrency-parse-divergence
title: "semantic-dedup-scan: Gated on Number.isInteger vs Number.isFinite, so
  --test-concurrency=1.5 yields 1 in the runner and 1.5 in the reporter even
  though the runner comment claims th"
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
Gated on Number.isInteger vs Number.isFinite, so --test-concurrency=1.5 yields 1 in the runner and 1.5 in the reporter even though the runner comment claims they are the same parse so the two can never disagree.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790678624535` · ts `2026-09-29T10:43:44.535Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readConcurrencyFromExecArgv`、`readConcurrency`
- 涉及文件：
- `plugin/scripts/suite-lpt-runner.mjs:61`
- `plugin/scripts/measure-suite-reporter.mjs:120`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
merge

## Disposition（复核结论：**已修掉**，不是「已注意到」）

**复核**：finding 描述属实。两处各自手抄了同一段 `process.execArgv` 的 `--test-concurrency=N` 解析，只有有效性谓词不同 —— `suite-lpt-runner.mjs` 用 `Number.isInteger`，`measure-suite-reporter.mjs` 用 `Number.isFinite`。于是 `--test-concurrency=1.5`：runner 得 1（回退串行默认），reporter 打印 `__GROUP__ concurrency=1.5`。runner 自己的注释却声称两者是 "the SAME parse … can never disagree" —— 注释断言的同一性不是同一性。

**谓词取 `Number.isInteger` 是实测判据，不是偏好**：node:test 的 `run()` 对非整数抛 `ERR_OUT_OF_RANGE: The value of "options.concurrency" is out of range. It must be an integer. Received 1.5`（本机 node v24.21.0 实跑确认）。runner 把这个值直接喂给 `run({concurrency})`，所以小数 flag 必须退回串行默认 —— 报 1.5 等于报一个从未存在的 lane 数。

**处置（requested action: merge → 合并成单一定义）**：
- `plugin/scripts/measure-suite-reporter.mjs` 导出 `readConcurrency()`（唯一定义，整数谓词）。
- `plugin/scripts/suite-lpt-runner.mjs` 改为 `export { readConcurrency as readConcurrencyFromExecArgv }`，⛔ 不再有本地副本。

**产物（可核）**：`plugin/test/concurrency-parse-single-source.test.mjs`，3 条断言 —— ① 同一性 `readConcurrencyFromExecArgv === readConcurrency`；② 解析行为表（`1.5`/`2.5`/`0`/`-2`/`abc` → 1；`=4`/` 3` → 4/3；首个合法 flag 胜出）；③ 真跑 reporter 生成器，读它**实际打印**的 `__GROUP__ concurrency=`，断言 1.5 打 1（而非 1.5）且恒等于 runner 的解析值。
**负控制（判据能取假，两个方向都实跑过）**：把谓词改回 `Number.isFinite` ⇒ ②③ 变红；把 runner 改回本地副本 ⇒ ①③ 变红。

**5b 扫描（同原则的其它落点）**：把 `--test-concurrency` 参数解析成**数字**的站点共 3 处 —— ① `measure-suite-reporter.mjs:readConcurrency`（现唯一源）；② `suite-lpt-runner.mjs`（现为 re-export，无副本）；③ `runner-concurrency.ts:bucketTestConcurrency`（`/^[0-9]+$/`，本就只收整数，且它是**选值**方、不是**读值**方 ⇒ 不在本 divergence 类）。`suite-scheduler.ts:507` 只 **strip** 该 flag、不做数字解析。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `concurrency-parse-divergence`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790678624535`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/suite-lpt-runner.mjs`
- `plugin/scripts/measure-suite-reporter.mjs`
- `plugin/test/concurrency-parse-single-source.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-concurrency-parse-divergence.md`
