---
id: gap-fanin-rerun-attribution-blind-to-spec-reporter
title: fan-in in-round rerun attribution parses only TAP — node spec-reporter
  logs (test at <file>:line + ✖) are never attributed ⇒ every flake is parked as
  unattributable needs-human after 2 rounds
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**2026-11-01 quay-fleet 实测：spec reporter 格式的 suite 红点永远归因不到文件，两轮后被机械停派。** 这与被停派任务的实现无关，是 fan-in 自身的归因/重跑缺陷。

现场读数（quay-fleet `.quay/worker-outcome.jsonl`，2026-11-01T08:49:20.731Z，任务 `gap-knowledge-live-carrier-derivation`，`run_id=wk-prod-anchor`）：

- `mechanical_fan_in.failedTestFiles = {"evaluated":false,"reason":"no-failing-lines-in-suite-log"}`；
- `mechanical_fan_in.rerun = {"state":"rerun-not-evaluated","reason":"no-failing-lines-in-suite-log"}`；
- Round 259 的真实红点在 suite 日志里写作 `test at test/notification-pipeline-resolution-gate.test.mjs:645:1` + `✖ AC-064(1) DoD: on the REAL persistent home, …`；Round 260 是 `test at test/dogfood-p0.test.mjs:344:1` + `✖ AC-012's criterion pipeline runs verbatim through sh -c against the real checkout and exits 0`。两条都点名了文件，但解析器一条都没归因。
- `worker-round.jsonl` round 40157：`retry_exemptions: [{verdict:"insufficient-data-fallback", reason:"no failing test file extracted from the suite log (parser extracted 0 of 0 failing lines)"}]`，随后 `stop-terminal`。

根因链（本仓源码）：

1. `plugin/scripts/worker-fan-in.ts` 的 `parseSuiteLogFailures`：`suiteNotOkRest` 只匹配 `^not ok`（TAP），另一支只匹配含 `passed=false` 的行；node spec reporter 的 `test at <file>:<line>:<col>` 与 `✖ <name> (<ms>)` 一行都不匹配。
2. `plugin/scripts/worker-driver.ts` 在 suite 红后调用 `readFailedTestFiles(suiteLogText, worktree)`，得到 `evaluated:false`。
3. `runInRoundRerun` 的第一道门是 `if (!failed2.evaluated) return notEvaluated2(failed2.reason)` ⇒ **即使声明了 `loop.rerun_command` 也走不到重跑**。既有 done 任务 `gap-in-round-suite-rerun-never-executed-in-production` 只解决了「重跑命令解析」，没有解决「先要能点名失败文件」。

与既有任务的关系（⛔ 不是重复立案）：

- `gap-fan-in-baseline-comparison-blind-to-spec-reporter-misparks-develop-wide-red`（done）修的是 `parseFailureSignatures` / 基线比较；同一文件里已有 spec 配对读取（`test at` + 紧随 `✖` 的有界前瞻，见 `parseFailureSignatures` 的 spec 分支），可直接复用/抽成叶函数。
- 本任务修的是**第二个消费者**：in-round rerun 的失败文件归因（`readFailedTestFiles` 的输入），而不是基线比较。

影响面：任何使用 node spec reporter 的项目，任意抖动红点都会在两轮后变成 `stop-terminal` 的 needs-human；quay-fleet 2026-11-01 已真实发生。

## Plan

1. 在 `parseSuiteLogFailures` 增加 spec 分支：以 `test at <file>:<line>:<col>` 为身份源，在有界前瞻内配对紧随的 `✖ <name> (<ms>)`；找不到配对就不归因（⛔ 不伪造）。文件 token 经既有 `toRepoRelToken` 转 repo-relative。
2. 复用同文件已有的 spec 配对解析，⛔ 不写第二份正则；若两处逻辑重合，抽成一个叶函数供 `parseFailureSignatures` 与 `parseSuiteLogFailures` 共用。
3. 保持 TAP `not ok` 与 `passed=false` 两支逐字节不变；混合输出取并集去重。
4. 「没有配对 `test at` 的独立 `✖` 行」与「只有 `ℹ fail N` 摘要行」仍然不归因，reason 保持 `no-failing-lines-in-suite-log`。

## Acceptance Criteria

- [x] AC1 正控：把 quay-fleet 生产 suite 日志的逐字摘录（`test at test/notification-pipeline-resolution-gate.test.mjs:645:1` + 紧随的 `✖ AC-064(1) …`，以及 `test at test/dogfood-p0.test.mjs:344:1` + `✖ AC-012's criterion pipeline …`）喂给 `readFailedTestFiles` ⇒ `{evaluated:true, files:["test/notification-pipeline-resolution-gate.test.mjs","test/dogfood-p0.test.mjs"]}`；同一份摘录走 in-round rerun 路径时不再落到 `rerun-not-evaluated: no-failing-lines-in-suite-log`。
- [x] AC2 负控（逐条贴读数）：
  (a) 只有 `✖ failing tests:` 块头或独立 `✖ name`、没有任何 `test at` ⇒ 仍 `evaluated:false, reason:"no-failing-lines-in-suite-log"`；
  (b) 只有 `ℹ fail 1` 摘要行 ⇒ 仍不归因；
  (c) `test at` 后没有配对的 `✖` ⇒ 不归因；
  (d) 既有 TAP `not ok` 夹具与 `passed=false` 夹具结果逐字节不变（现有用例全绿）；
  (e) 变异臂：去掉新增的 spec 分支 ⇒ AC1 变红，其余负控不变。
- [x] AC3 真实重放：把 quay-fleet 的 `.quay/fan-in-suite-gap-knowledge-live-carrier-derivation~wk-prod-anchor~1793522910959-bda3e2.log` 只读拷贝为本仓 fixture，跑 `parseSuiteLogFailures` 断言归因到 `test/dogfood-p0.test.mjs`；粘贴 verdict JSON。
- [x] AC4 回归：`node --test plugin/test/worker-driver.test.mjs plugin/test/worker-driver-fan-in-s04.test.mjs plugin/test/worker-driver-fan-in-s07.test.mjs plugin/test/worker-fan-in-spec-attribution.test.mjs` 退出码 0。
- [x] AC5 文档：`docs/evidence/2026-11-01-fanin-rerun-spec-attribution.md`（新）记录上面每条命令、退出码与真实日志摘录，并注明本修复只让红点可归因/可重跑，⛔ 不豁免任何真实红。

## Definition of Done

一条 spec 格式的 suite 日志的失败块被 `readFailedTestFiles` 逐字点名到文件，并在真实 in-round rerun 路径上产生 `rerun-green`（用既有 fan-in 重跑夹具端到端跑通）；TAP / `passed=false` 旧行为与所有既有负控不变。落地的证据是测试读数与真实日志重放，不是「代码改了」。

## Touches

- plugin/scripts/worker-fan-in.ts
- plugin/test/worker-fan-in-spec-attribution.test.mjs (new)
- plugin/test/fixtures/spec-reporter-suite-log-bda3e2.txt (new)
- docs/evidence/2026-11-01-fanin-rerun-spec-attribution.md (new)
- tasks/gap-fanin-rerun-attribution-blind-to-spec-reporter.md (self)

## 暗轴（ADR-007）

该轴仍暗,理由:本任务只修 suite 日志解析器的 spec 归因分支，不改依赖结构/包边界，L_D/L_G 未产生可测变化