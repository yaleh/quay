---
id: gap-park-reason-mislabels-ac-precheck-as-suite-red
title: AC 预检失败被 judgeRetryExemption 归入「suite 红归因不出」——两轮即停派，停派注记与提交消息恒写「重试上限」而真因不是
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

- [x] `node --test plugin/test/worker-driver-retry-classification.test.mjs` 退出 0，且新增用例覆盖：outcome 为 AC 未全勾短路（`mechanical_fan_in` 为 null、原因含「AC 未全勾」）时，`judgeRetryExemption` 的 verdict 不等于 `insufficient-data-fallback`，且 `decideExitedNotLandedAction` 在已有 1 条同类 prior 的情况下返回 `kind: "count-and-retry"`（用例断言这两个取值）。
- [x] 取假：把新分支回退后上述用例红（在 `## Evidence` 附实跑输出）。
- [x] `node --test plugin/test/driver-filters.test.mjs` 退出 0，且新增用例断言：以 stop-terminal 种类调用 `markNeedsHuman` 时，写入的 `## Needs-Human` 段与提交消息都不含字符串「重试上限」；以重试上限种类调用时仍含（负控制，两臂都要有）。
- [x] `grep -c "连续修满重试上限仍不合格" plugin/scripts/driver-filters.ts` 与 `grep -c "重试上限机械翻转" plugin/scripts/driver-filters.ts` 的命中都只出现在按种类选择的分支内（在 `## Evidence` 打印命中行，逐行说明所属分支）。
- [x] 5b 邻近扫描：在 `plugin/scripts/worker-driver.ts` 内 grep 其它返回 `insufficient-data-fallback` 的分支，逐条判断其判词是否会在没有 suite 运行的情况下被下游写成「suite 红」；把命中数与前 3 条贴进提交。
- [x] `bash scripts/test.sh --for-task gap-park-reason-mislabels-ac-precheck-as-suite-red` 退出 0，且确实执行了 ≥1 个测试文件（非 thin）。
- [ ] 生产载体（待外部）：第三方项目 driver 重启到含本修复的版本之后，其 `.quay/worker-round.jsonl` 中「实现落地之后」时间窗内 `retry_exemptions[].reason` 为 `no mechanical fan-in result on the outcome` 且同轮存在 `exited_not_landed_stops[kind=="stop-terminal"]` 的记录数为 0，同时 AC 未全勾短路轮次数 ≥1（后者证明该窗口确有样本，零不是空转）（待外部）

## DoD

真实落地判据不是「fixture 用例绿」：修复落地 develop 后，AC 未全勾的任务在生产上不再以「suite 红归因不出」为由被停派，停派注记与提交消息如实写出停派种类。最后一条 AC 读第三方生产载体，须等第三方 driver 升级到含修复的版本后才能取数；在取到之前本任务可以 done，但须在完成记录里写明该条尚未读到、以及第三方 driver 当时运行的版本。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/scripts/driver-filters.ts
- plugin/test/worker-driver-retry-classification.test.mjs
- plugin/test/driver-filters.test.mjs
- tasks/gap-park-reason-mislabels-ac-precheck-as-suite-red.md

## Evidence

### AC1 — AC 未全勾短路独立分类 + 走 count-and-retry

`node --test plugin/test/worker-driver-retry-classification.test.mjs` ⇒ exit 0，`tests 30 / pass 30 / fail 0`（新增 3 条）。新增用例断言的两个取值：
- `AC1 — AC 未全勾短路（无 mechanical_fan_in + 已有 1 条同类 prior）⇒ verdict 独立，动作 count-and-retry（⛔ 不进 stop-terminal）`：断言 `j.verdict === "ac-not-checked-shortcircuit"`（≠ `insufficient-data-fallback`），且 `d.kind === "count-and-retry"`（已有 1 条同类 prior）。
- `AC1（旧记录·只有文本）— 无 short_circuit 字段、failure_reason 含「AC 未全勾」⇒ 仍独立分类`：历史记录（无结构化字段）也被正确分类。
- `AC1（双向控制）— 无 mechanical_fan_in 且【非】AC 短路 ⇒ 仍 insufficient-data-fallback，但 stop 判词不含「suite red」`。

判据两路（单一成因，非关键词猜）：① `outcome.short_circuit === "ac-not-checked"`（`computeOutcome` 新增的结构化字段，`finish()` 在短路时写入）；② `failure_reason` 含「AC 未全勾」（覆盖无该字段的历史记录）。

### AC2 — 取假：回退新分支后用例红（实跑输出）

把 `judgeRetryExemption` 的新分支条件临时改为 `if (false)`（= 回退该分支）后实跑：

```
$ node --test plugin/test/worker-driver-retry-classification.test.mjs
✖ AC1 — AC 未全勾短路（无 mechanical_fan_in + 已有 1 条同类 prior）⇒ verdict 独立，动作 count-and-retry（⛔ 不进 stop-terminal）
  AssertionError [ERR_ASSERTION]: AC 短路不得落 insufficient-data-fallback（⛔ 与「读不懂/没跑过 suite」同形）
    actual: 'insufficient-data-fallback'
    expected: 'insufficient-data-fallback'
✖ AC1（旧记录·只有文本）— 无 short_circuit 字段、failure_reason 含「AC 未全勾」⇒ 仍独立分类（历史记录可判）
  AssertionError [ERR_ASSERTION]: 只有文本的历史记录也必须被正确分类（⛔ 不依赖新字段）
    actual: 'insufficient-data-fallback'
    expected: 'ac-not-checked-shortcircuit'
ℹ tests 30  ℹ pass 28  ℹ fail 2
```

回退用 `cp` 备份恢复（备份 md5 `33fb32bda29e953cd9380dd0ef77ee3b`）；恢复后同一文件 `pass 30 / fail 0`。

### AC3 — markNeedsHuman 按停派种类选小标题与提交消息

`node --test plugin/test/driver-filters.test.mjs` ⇒ exit 0，`tests 69 / pass 69 / fail 0`（新增 3 条）：
- `AC3 — kind=stop-terminal：## Needs-Human 段与提交消息都不含「重试上限」`（两臂之一）。
- `AC3（首次登记臂）— kind=stop-terminal 且文件从未提交 ⇒ 首次登记消息也不含「重试上限」`（旧文案在首次登记支恒写「重试上限机械落盘」）。
- `AC3（负控制，retry-cap 臂）— kind=retry-cap：小标题与提交消息仍含「重试上限」`（另一臂）。

### AC4 — 两个写死字符串只在按种类选择的分支内

```
$ grep -n "连续修满重试上限仍不合格" plugin/scripts/driver-filters.ts
876:  if (kind === "retry-cap") return "连续修满重试上限仍不合格（标 needs-human）";
$ grep -n "重试上限机械翻转" plugin/scripts/driver-filters.ts
883:  if (kind === "retry-cap") return "重试上限机械翻转";
```
逐行说明所属分支：
- `876`：`needsHumanHeading(kind)` 内 `if (kind === "retry-cap")` 分支——⛔ 非重试上限种类走另一行返回不同小标题。
- `883`：`needsHumanCommitLabel(kind)` 内 `if (kind === "retry-cap")` 分支——⛔ 非重试上限种类走 `return "机械停派"`。

两条命中计数均为 **1**。旧实现这两串散在函数体正文与注释里（本次把文档串/注释改成不含该串的措辞）。

### AC5 — 5b 邻近扫描（命中数 = 9，前 3 条）

```
$ grep -c 'verdict: "insufficient-data-fallback"' plugin/scripts/worker-driver.ts
9
```
前 3 条（按行序）：
1. `judgeStaticPhaseAttribution`（delta 读不懂）——该函数**仅由** `mfi.step === "suite"` 的静态相位红调用 ⇒ 下游说「suite 红」**属实**。
2. `judgeStaticPhaseAttribution`（点名的 checker/文件都不在本任务 delta）——同上**属实**。
3. `judgeRetryExemption`（无 `mechanical_fan_in`，本次要害）——本无 suite 跑过；修复后下游 stop 判词按 `mfi.step` 分叉，**不再出现「suite 红」**，改说 `no suite ran`。

其余 6 处（`no suiteLog basename` / 日志读不到 / 无断言签名 / delta 读不懂 / 相关性判不出）全部落在 `mfi.step === "suite"` 之内 ⇒ 下游说「suite 红」**属实**。判定判据 = `mechanical_fan_in.step === "suite"`（suite 步真跑过），⛔ 不取「suiteLog basename 在不在」（那在「suite 跑了但日志名缺失」时为假）。

### AC6 — scoped 门

```
$ bash scripts/test.sh --for-task gap-park-reason-mislabels-ac-precheck-as-suite-red --allow-thin
exit 0
ℹ tests 210  ℹ pass 210  ℹ fail 0
```
非 thin：确实执行了 210 个测试文件（含本任务两条新测所在文件）。

### AC7 — （待外部）本轮未读到

第三方项目（claudecodeui）的 driver 尚未升级到含本修复的版本 ⇒ `.quay/worker-round.jsonl` 中「实现落地之后」的窗口尚不存在 ⇒ 该 AC 本轮**未读到**。本条保持未勾（`（待外部）`）。届时第三方 driver 运行的版本 = 本修复 ff 落地 develop 后的 develop 提交（落地前无法取数）。
