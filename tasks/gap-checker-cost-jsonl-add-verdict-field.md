---
id: gap-checker-cost-jsonl-add-verdict-field
title: checker-cost.jsonl 缺 verdict 字段——_run_checker_one 已经算出退出码 _rc 但
  checker_cost_append 不接收也不记录它，P4 守卫谱系今天算不出「曾变红比例」的直接原因
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

现场核实（本次立案时读码确认）：`plugin/scripts/checker-cost-lib.sh:61-73`（`_run_checker_one`）
在调用 `checker_cost_append` **之前**就已经算出 `_rc`（命令的真实退出码），但 `checker_cost_append`
（:44-56）只接受 `name/ms/n`，不接受也不记录 `_rc`，写出的行固定是
`{"name":...,"ms":...,"n":...,"load":...,"at":...}`——`verdict` 字段结构上缺失，不是没想到，是
`_rc` 已经算出来了但没被传下去。

仓库已有现成的三态退出码约定就在同一文件里（`checker-cost-lib.sh:24` `RUN_CHECKER_EXIT_NOT_EVALUATED=3`
——`run_checker_parallel_wait` 已经用这套约定区分 `STATIC_CHECK_FAILED` 与
`STATIC_CHECK_NOT_EVALUATED`）。补 `verdict` 字段就是把这个已经存在的三态判断多传一步，不是新设计
一套判定逻辑。

这正是 `docs/proposals/archguard-generation-era-primitives.md` §3 P4（守卫谱系）指出的具体缺口原文：
"`checker-cost.jsonl` 记 name/ms/load **不记裁决**"——P4 的 `last-fired`/裁决轴今天算不出来，直接
原因就是这个字段缺失。本任务只做记录格式这一步，不做 P4 的声明块/谱系查询（那是更大的
[[gap-archguard-p4-guard-lineage-declaration-and-registry]]，依赖本任务）。

同源写手至少 3 处需要同步（`checker-cost-lib.sh` 头部注释明写"JSONL shape 与
`plugin/scripts/checker-cost.ts` + `packages/quay/src/gate/engine.ts` 内联的 gate recorder 相同，
被 `plugin/test/checker-cost.test.mjs` 钉住"）：

1. `plugin/scripts/checker-cost-lib.sh`（`checker_cost_append` + `_run_checker_one` 传参，以及
   `run_checker_parallel_wait` 附近的并行路径）
2. `plugin/scripts/checker-cost.ts`（TS 侧对应写手）
3. `packages/quay/src/gate/engine.ts`（内联的 gate cost recorder）

## AC

- [x] AC1：`checker_cost_append` 新增第 4 个参数 `verdict`（取值 `pass`/`fail`/`not-evaluated`，由
      调用方按 `RUN_CHECKER_EXIT_NOT_EVALUATED` 同款三态约定算出：0→pass，3→not-evaluated，其它非零
      →fail），写出的行含 `"verdict":"<值>"`；`_run_checker_one` 与并行路径都要把已经算出的 `_rc`
      映射成 verdict 传下去，不是重新计算一遍
- [x] AC2：`plugin/scripts/checker-cost.ts` 与 `packages/quay/src/gate/engine.ts` 的对应写手同步加
      `verdict` 字段，三处 schema 保持一致（这是 header 注释自己承诺的不变量）
- [x] AC3：`plugin/test/checker-cost.test.mjs`（现有，钉住 shape 的那个测试）更新以覆盖新字段，三种
      verdict 取值（pass/fail/not-evaluated）各至少一个测例
- [x] AC4：向后兼容——旧格式（无 `verdict`）的历史行仍可被现有消费者（若有）正常解析，不因新增字段
      而崩；`.quay/checker-cost.jsonl` 是 gitignored 运行时文件，新旧行混存是正常状态，不需要迁移
      脚本
- [x] AC5：真跑 `bash scripts/test.sh`（或至少 `--for-task` scoped）触发若干真实 checker 执行，
      `tail -3 .quay/checker-cost.jsonl` 贴出的真实新行含 `verdict` 字段且值正确对应各 checker 的
      真实退出码

## DoD

`tail` 出的真实新写入行（不是构造的样例）贴进任务体，三处写手（bash/ts/engine.ts）全部同步且测试
绿。不是"加了参数但没人传"就算——AC5 的真实输出是硬要求。

**AC5 实测**（`bash scripts/test.sh --for-task gap-checker-cost-jsonl-add-verdict-field`，102 条静态
检查全绿后，`tail -5 .quay/checker-cost.jsonl`）：

```json
{"name":"concurrency-literal-check","ms":4236,"n":1,"load":3.61,"at":"2026-09-04T12:13:11Z","verdict":"pass"}
{"name":"suite-slot-ssot-check","ms":1081,"n":1,"load":3.61,"at":"2026-09-04T12:13:12Z","verdict":"pass"}
{"name":"suite-bucket-reattr-ratchet-check","ms":445,"n":1,"load":3.61,"at":"2026-09-04T12:13:13Z","verdict":"pass"}
{"name":"landing-target-check","ms":1610,"n":1,"load":3.61,"at":"2026-09-04T12:13:14Z","verdict":"pass"}
{"name":"test-file-snapshot-check","ms":5678,"n":1,"load":3.72,"at":"2026-09-04T12:13:20Z","verdict":"pass"}
```

本轮 16 个被 `run_checker` 包裹的静态 checker 全部真实退出 0 ⇒ 新行 `verdict` 全部为 `pass`，值正确
对应各 checker 的真实退出码。同文件 52794 条历史行（无 `verdict`）与新行混存，`readCheckerCost`
照常解析（AC4 由单测 `AC4 — old-format rows …` + 上述实测混存共同覆盖）。

## Touches

- plugin/scripts/checker-cost-lib.sh
- plugin/scripts/checker-cost.ts
- packages/quay/src/gate/engine.ts
- plugin/test/checker-cost.test.mjs
- tasks/gap-checker-cost-jsonl-add-verdict-field.md
