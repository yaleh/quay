---
id: gap-suite-blocking-red-window-unattributable
title: "suite_blocking 红窗信号活着却映射不到任务——round-210 红失败文件 send-keys-verified.sh
  不在任何任务 ## Touches ⇒ window_active=true consecutive_red=4 但 tasks=[] 空 ⇒
  红窗信号连改排序的作用都没有,红对派发影响严格为零；与 CROSSCUT plugin/scripts 零覆盖同根(plugin/scripts
  机制层不被索引)；补归因映射+未归因清单"
status: ready
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal（范围已重定，2026-08-10 manager STOP-AND-RESCOPE）

**原任务基于错误前提：以为 suite_blocking.tasks=[] 是归因盲区。实跑核实：`computeSuiteBlocking` 只把 ready/todo 当候选（ready-pool-check.ts:634「Only dispatchable-status tasks (ready/todo) are candidates」），而 round-210 失败文件 send-keys-verified.sh 对应的任务 `gap-send-keys-verified-hash-check...` 是 `status: done`——机制是对的，tasks=[] 是因为候选是 done 不是 ready/todo。原前提作废。真实缺口在别处：verification-round.jsonl 从未写过 failures 字段（209 轮逐行统计，含 failures 的轮数 = 0），所以红窗归因只有 full-suite-state.json 最新一轮这一个来源，历史红轮无法参与归因。**

### 实证（manager 2026-08-10 STOP-AND-RESCOPE + outer 复核）

- **原前提错误**：computeSuiteBlocking 只把 ready/todo 当候选（ready-pool-check.ts:634）。round-210 失败文件 send-keys-verified.sh 对应任务 `gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted` 是 `status: done`——done 任务正确排除，tasks=[] 是机制正确行为。
- **真实缺口（实）**：`verification-round.jsonl` 209 轮逐行统计，**含 failures 字段的轮数 = 0**。`SuiteRoundRecord` 接口（full-suite-runner.ts:465）无 failures 字段——round 记录只有计数（fail/cancelled）无失败明细。failures[] 只进 `writeSuiteState`（state 文件，line 1221/1269/1300），`appendVerificationRound` 不写。
- **后果**：`computeSuiteBlocking` 读「full-suite-state.json failures[] 或 per-round failures」，但历史轮无 failures ⇒ 红窗归因只有最新一轮一个来源，历史红轮无法参与。
- **manager 错因自述**：又读局部（CROSSCUT_CHECKS 触发器 / 单个 suite_blocking 读数）外推到全集，没跑选择器/没读机制。

**为什么重要**：红窗归因缺历史维度——连续 5 轮红但每轮失败文件不同时，只有最新一轮能被归因到任务。补上 failures 字段，历史红轮都能参与归因，suite_blocking 才能反映「一段时间内的红窗模式」而非「最新一轮」。

### 选定机制方向（实现归内层，接法留执行时）

1. **round 记录加 failures 字段**：`SuiteRoundRecord` 加 `failures?: SuiteFailure[]`，`appendVerificationRound` 写入（与 state 文件的 failures 同源）。向后兼容（缺失时读者容忍）。
2. **computeSuiteBlocking 消费历史 failures**：读 verification-round.jsonl 的 per-round failures（现在能读到了）参与归因——不止最新一轮。
3. **回归验证**：构造历史轮 failures → 归因覆盖历史轮；无 failures 轮不参与（负控制）。

**验证锚**：修后 (a) verification-round.jsonl 红轮带 failures 字段；(b) 历史红轮参与归因（连续红窗 + 不同失败文件 → tasks 反映各轮）；(c) 向后兼容。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录实证（209 轮 failures 字段 = 0、SuiteRoundRecord 无 failures、computeSuiteBlocking 只读最新 state、done 任务正确排除）（本任务 Proposal 已含）
- [ ] AC2: **round 记录加 failures**——SuiteRoundRecord 加 failures?: SuiteFailure[]，appendVerificationRound 写入（与 state 同源）
- [ ] AC3: **归因消费历史 failures**——computeSuiteBlocking 读 per-round failures 参与归因（不止最新一轮）
- [ ] AC4: **负控制**——无 failures 轮不参与归因
- [ ] AC5: **向后兼容**——缺失 failures 的旧行读者容忍
- [ ] AC6: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC6 全部勾上
- [ ] 修后实跑：verification-round.jsonl 红轮带 failures（贴任务体）；历史轮参与归因
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/full-suite-runner.ts（SuiteRoundRecord 加 failures 字段 + appendVerificationRound 写入）
- plugin/scripts/ready-pool-check.ts（computeSuiteBlocking 读 per-round failures 参与归因）
- plugin/test/full-suite-runner.test.mjs（AC2 测试）
- plugin/test/ready-pool-check.test.mjs（AC3/AC4 测试）
- tasks/gap-suite-blocking-red-window-unattributable.md（范围重定为真实缺口：round 记录缺 failures 字段）
- tasks/gap-ready-relevance-blind-to-suite-blocking-signal.md（交叉标注——红窗信号机制源）

## Contract

measure   round_failures_field_present = `python3 -c "import json;rs=[json.loads(l) for l in open('.quay/verification-round.jsonl') if l.strip()];print(sum(1 for r in rs if 'failures' in r))"` 的 stdout 数字
band      round_failures_field_present > 0（红轮带 failures 字段）
invariant historical_rounds_in_attribution = 1（历史轮参与归因）
invariant backward_compatible = 1（缺失 failures 旧行读者容忍）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root <repo> --json`（历史轮 failures fixture 贴回）
control   红轮带 failures；历史轮参与归因；向后兼容
resume    字段写入 / 归因消费分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager STOP-AND-RESCOPE——原前提错误（suite_blocking tasks=[] 是 done 任务正确排除,机制对的）。真实缺口：verification-round.jsonl 209 轮含 failures 字段 = 0（SuiteRoundRecord 无该字段,failures 只进 state 文件）⇒ 红窗归因只有最新一轮一个来源。范围重定为「round 记录加 failures 字段 + 归因消费历史 failures」。实现归内层
