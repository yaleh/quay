---
id: gap-park-reason-mislabels-ac-precheck-as-suite-red
title: AC 预检失败被 judgeRetryExemption 归入「suite 红归因不出」——两轮即停派，停派注记与提交消息恒写「重试上限」而真因不是
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**机制**：`plugin/scripts/worker-driver.ts` 的 `judgeRetryExemption` 第一个分支——outcome 上没有 `mechanical_fan_in` 时返回 `insufficient-data-fallback: "no mechanical fan-in result on the outcome (cannot attribute)"`。AC 未全勾短路（未 spawn fan-in）恰好产出 `mechanical_fan_in = null` 的 outcome ⇒ 它落进这个分支 ⇒ `decideExitedNotLandedAction` 把它当成「suite 红但归因不出」，只给一次重试，第二次即 `stop-terminal` ⇒ `markNeedsHuman`，阻碍原因写「suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）」。真因是 AC 未全勾，与 suite 无关（硬规则 3b：读不懂的输入不得与另一个已知成因同形）。

同一条停派路径上还有两处写死的标签与真因不符：
1. `plugin/scripts/driver-filters.ts` `markNeedsHuman` 追加的 `## Needs-Human` 段小标题恒为「连续修满重试上限仍不合格（标 needs-human）」；
2. 同函数的提交消息恒为 `tasks: <id> <from>→needs-human（重试上限机械翻转）`。

**生产读数（claudecodeui，2026-09-24→10-01，`.quay/worker-round.jsonl` 的 `exited_not_landed_stops` 与同轮 `retry_exemptions` join）**：stop-terminal 75 条，其中 `retry_exemptions[].reason` = `no mechanical fan-in result on the outcome (cannot attribute)` 的 **9 条**；另一独立计数——`## Needs-Human` 段里「失败步/判词」写 `AC 未全勾（checked N/M）` 而「阻碍原因」写 suite 归因不出的也是 **9 条**，两数吻合。同窗口走 RETRY-CAP(3) 路径的停派 **0 条**，而 73 段 `## Needs-Human` 的小标题与 73 条提交消息全部写「重试上限」。

**修法（方向，实现者可调）**：
1. `judgeRetryExemption` 对「未 spawn fan-in 的 AC 未全勾短路」返回独立 verdict（不是 `insufficient-data-fallback`），`decideExitedNotLandedAction` 对它走既有 count-and-retry 路径，⛔ 不进 stop-terminal；判词写真因。
2. `mechanical_fan_in` 缺失且又不是 AC 短路的情形保持「无法评估」的独立取值，判词不得出现「suite 红」字样（没有 suite 跑过）。
3. `markNeedsHuman` 的小标题与提交消息由调用方传入的停派种类决定（重试上限 / stop-terminal / 其它），⛔ 不再写死「重试上限」。

<!-- dedup-ref -->相关但机制不同：`gap-fan-in-suite-red-with-no-attributable-test-still-redispatches-worker`（done）定义了归因不出时的动作，本任务修的是「不该进入该动作的输入被送了进去」；`gap-suite-failure-attribution-third-party-layout`（done）修 suite 日志解析，本任务的 9 条根本没有 suite 日志；`gap-worker-ac-check-shortcircuit`（done）建立了 AC 短路，本任务修它的 outcome 在下游被误分类。

## AC

- [ ] `node --test plugin/test/worker-driver-retry-classification.test.mjs` 退出 0，且新增用例覆盖：outcome 为 AC 未全勾短路（`mechanical_fan_in` 为 null、原因含「AC 未全勾」）时，`judgeRetryExemption` 的 verdict 不等于 `insufficient-data-fallback`，且 `decideExitedNotLandedAction` 在已有 1 条同类 prior 的情况下返回 `kind: "count-and-retry"`（用例断言这两个取值）。
- [ ] 取假：把新分支回退后上述用例红（在 `## Evidence` 附实跑输出）。
- [ ] `node --test plugin/test/driver-filters.test.mjs` 退出 0，且新增用例断言：以 stop-terminal 种类调用 `markNeedsHuman` 时，写入的 `## Needs-Human` 段与提交消息都不含字符串「重试上限」；以重试上限种类调用时仍含（负控制，两臂都要有）。
- [ ] `grep -c "连续修满重试上限仍不合格" plugin/scripts/driver-filters.ts` 与 `grep -c "重试上限机械翻转" plugin/scripts/driver-filters.ts` 的命中都只出现在按种类选择的分支内（在 `## Evidence` 打印命中行，逐行说明所属分支）。
- [ ] 5b 邻近扫描：在 `plugin/scripts/worker-driver.ts` 内 grep 其它返回 `insufficient-data-fallback` 的分支，逐条判断其判词是否会在没有 suite 运行的情况下被下游写成「suite 红」；把命中数与前 3 条贴进提交。
- [ ] `bash scripts/test.sh --for-task gap-park-reason-mislabels-ac-precheck-as-suite-red` 退出 0，且确实执行了 ≥1 个测试文件（非 thin）。
- [ ] 生产载体（待外部）：第三方项目 driver 重启到含本修复的版本之后，其 `.quay/worker-round.jsonl` 中「实现落地之后」时间窗内 `retry_exemptions[].reason` 为 `no mechanical fan-in result on the outcome` 且同轮存在 `exited_not_landed_stops[kind=="stop-terminal"]` 的记录数为 0，同时 AC 未全勾短路轮次数 ≥1（后者证明该窗口确有样本，零不是空转）（待外部）

## DoD

真实落地判据不是「fixture 用例绿」：修复落地 develop 后，AC 未全勾的任务在生产上不再以「suite 红归因不出」为由被停派，停派注记与提交消息如实写出停派种类。最后一条 AC 读第三方生产载体，须等第三方 driver 升级到含修复的版本后才能取数；在取到之前本任务可以 done，但须在完成记录里写明该条尚未读到、以及第三方 driver 当时运行的版本。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/scripts/driver-filters.ts
- plugin/test/worker-driver-retry-classification.test.mjs
- plugin/test/driver-filters.test.mjs
- tasks/gap-park-reason-mislabels-ac-precheck-as-suite-red.md
