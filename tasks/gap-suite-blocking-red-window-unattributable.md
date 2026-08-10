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

## Proposal（范围已重定，2026-08-10 manager STOP-AND-RESCOPE + 归因缺口新增实证）

**原任务基于错误前提：以为 suite_blocking.tasks=[] 是归因盲区。实跑核实：`computeSuiteBlocking` 只把 ready/todo 当候选（ready-pool-check.ts:634），round-210 失败文件 send-keys-verified.sh 对应任务 `gap-send-keys-verified-hash-check...` 是 `status: done`——机制对的，tasks=[] 是 done 任务正确排除。真实缺口：verification-round.jsonl 从未写过 failures 字段（209 轮含 failures = 0），历史红轮无法参与归因。归因缺口新增实证（2026-08-10 01:41）：failures[].file 形状不一致——本轮（branch-model）是仓库相对路径 `plugin/test/branch-model.test.mjs`，上一轮（send-keys-verified）是裸 basename `send-keys-verified.sh`；computeSuiteBlocking 拿它跟 ## Touches 展开集做 `has()` 精确匹配，裸 basename 永不命中。**

### 实证（manager 2026-08-10 STOP-AND-RESCOPE + 归因形状核实 + outer 复核）

- **原前提错误**：computeSuiteBlocking 只把 ready/todo 当候选（ready-pool-check.ts:634）。round-210 失败文件 send-keys-verified.sh 对应任务是 `status: done`——done 任务正确排除，tasks=[] 是机制正确行为。
- **真实缺口（实）**：`verification-round.jsonl` 209 轮逐行统计，**含 failures 字段的轮数 = 0**。`SuiteRoundRecord` 接口（full-suite-runner.ts:465）无 failures 字段——round 记录只有计数（fail/cancelled）无失败明细。failures[] 只进 `writeSuiteState`（state 文件），`appendVerificationRound` 不写。
- **归因缺口新增实证（failures[].file 形状不一致）**：
  - 本轮（round-212）failures[].file = **仓库相对路径** `plugin/test/branch-model.test.mjs`。
  - 上一轮（round-210）failures[].file = **裸 basename** `send-keys-verified.sh`。
  - `computeSuiteBlocking` 拿 `failure_files` 跟任务的 `## Touches` 展开集做 `has()` **精确匹配**——裸 basename 与 Touches 里的仓库相对路径（`plugin/scripts/send-keys-verified.sh`）永不命中。
  - 即使任务 Touches 正确声明了文件，裸 basename 形式也会归因失败——**形状不一致本身就是归因缺陷**，与候选过滤无关。
- **manager 错因自述**：又读局部外推到全集，没跑选择器/没读机制。

**为什么重要**：红窗归因缺两个维度——①历史轮（verification-round.jsonl 无 failures 字段，只有最新一轮 state 文件可用）；②文件形状（failures[].file 裸 basename vs 相对路径不一致，`has()` 精确匹配永不命中裸 basename）。两者都补上，suite_blocking 才能把「阻塞 suite 的缺陷」排到 inner 面前。

### 选定机制方向（实现归内层，接法留执行时）

1. **round 记录加 failures 字段**：`SuiteRoundRecord` 加 `failures?: SuiteFailure[]`，`appendVerificationRound` 写入（与 state 文件的 failures 同源）。向后兼容（缺失时读者容忍）。
2. **computeSuiteBlocking 消费历史 failures**：读 verification-round.jsonl 的 per-round failures（现在能读到了）参与归因——不止最新一轮。
3. **文件形状归一**：failures[].file 统一为仓库相对路径（或 computeSuiteBlocking 对裸 basename 做解析/归一后再匹配）——裸 basename 与 Touches 相对路径一致化。

**验证锚**：修后 (a) verification-round.jsonl 红轮带 failures 字段；(b) 历史红轮参与归因；(c) 裸 basename 失败文件能命中 Touches（形状归一）。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录实证（209 轮 failures=0、SuiteRoundRecord 无 failures、done 任务正确排除、failures[].file 形状不一致：相对路径 vs 裸 basename）（本任务 Proposal 已含）
- [ ] AC2: **round 记录加 failures**——SuiteRoundRecord 加 failures?: SuiteFailure[]，appendVerificationRound 写入（与 state 同源）
- [ ] AC3: **归因消费历史 failures**——computeSuiteBlocking 读 per-round failures 参与归因（不止最新一轮）
- [ ] AC4: **文件形状归一**——failures[].file 统一相对路径，或 computeSuiteBlocking 对裸 basename 解析后匹配（裸 basename 能命中 Touches）
- [ ] AC5: **负控制**——无 failures 轮不参与归因
- [ ] AC6: **向后兼容**——缺失 failures 的旧行读者容忍
- [ ] AC7: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC7 全部勾上
- [ ] 修后实跑：verification-round.jsonl 红轮带 failures（贴任务体）；裸 basename 命中 Touches
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/full-suite-runner.ts（SuiteRoundRecord 加 failures 字段 + appendVerificationRound 写入 + failures[].file 相对路径归一）
- plugin/scripts/ready-pool-check.ts（computeSuiteBlocking 读 per-round failures + 裸 basename 解析匹配）
- plugin/test/full-suite-runner.test.mjs（AC2/AC4 测试）
- plugin/test/ready-pool-check.test.mjs（AC3-AC5 测试）
- tasks/gap-suite-blocking-red-window-unattributable.md（范围重定为真实缺口：round 记录缺 failures + 文件形状不一致）
- tasks/gap-ready-relevance-blind-to-suite-blocking-signal.md（交叉标注——红窗信号机制源）

## Contract

measure   round_failures_field_present = `python3 -c "import json;rs=[json.loads(l) for l in open('.quay/verification-round.jsonl') if l.strip()];print(sum(1 for r in rs if 'failures' in r))"` 的 stdout 数字
band      round_failures_field_present = > 0（红轮带 failures 字段）
invariant historical_rounds_in_attribution = 1（历史轮参与归因）
invariant basename_shape_normalized = 1（裸 basename 命中 Touches）
invariant backward_compatible = 1（缺失 failures 旧行读者容忍）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root <repo> --json`（历史轮 failures + 裸 basename fixture 贴回）
control   红轮带 failures；历史轮参与归因；裸 basename 命中；向后兼容
resume    字段写入 / 归因消费 / 形状归一分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager STOP-AND-RESCOPE——原前提错误（suite_blocking tasks=[] 是 done 任务正确排除,机制对的）。真实缺口：①verification-round.jsonl 209 轮含 failures=0（SuiteRoundRecord 无该字段）⇒ 红窗归因只有最新一轮;②failures[].file 形状不一致（round-212 相对路径 vs round-210 裸 basename,computeSuiteBlocking 的 has() 精确匹配永不命中裸 basename）。范围重定:round 记录加 failures + 归因消费历史 + 文件形状归一。实现归内层
