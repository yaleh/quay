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

**原任务基于错误前提：以为 suite_blocking.tasks=[] 是归因盲区。实跑核实：`computeSuiteBlocking` 只把 ready/todo 当候选（ready-pool-check.ts:634），round-210 失败文件 send-keys-verified.sh 对应任务 `gap-send-keys-verified-hash-check...` 是 `status: done`——机制对的，tasks=[] 是 done 任务正确排除。真实缺口：verification-round.jsonl 从未写过 failures 字段（209 轮含 failures = 0），历史红轮无法参与归因。归因缺口新增实证（2026-08-10 01:41）：failures[].file 形状不一致已确认（本轮 branch-model 是仓库相对路径，上一轮 send-keys-verified 是裸 basename，两种形态各观测到一次）；其效果尚未证实（上轮唯一声明该路径的任务当时 status:done，done 解释与 basename 解释同时成立未分离——需声明该路径的 ready/todo 任务才能分离）。**

### 实证（manager 2026-08-10 STOP-AND-RESCOPE + 归因形状核实 + outer 复核）

- **原前提错误**：computeSuiteBlocking 只把 ready/todo 当候选（ready-pool-check.ts:634）。round-210 失败文件 send-keys-verified.sh 对应任务是 `status: done`——done 任务正确排除，tasks=[] 是机制正确行为。
- **真实缺口（实）**：`verification-round.jsonl` 209 轮逐行统计，**含 failures 字段的轮数 = 0**。`SuiteRoundRecord` 接口（full-suite-runner.ts:465）无 failures 字段——round 记录只有计数（fail/cancelled）无失败明细。failures[] 只进 `writeSuiteState`（state 文件），`appendVerificationRound` 不写。
- **归因形状不一致（已确认，效果未证实）**：
  - 本轮（round-212）failures[].file = **仓库相对路径** `plugin/test/branch-model.test.mjs`。
  - 上一轮（round-210）failures[].file = **裸 basename** `send-keys-verified.sh`。
  - **形状不一致本身已确认**（两种形态各观测到一次）。**其效果尚未证实**：上一轮唯一声明 send-keys-verified 路径的任务当时 `status: done`，而 computeSuiteBlocking 本就跳过 done——done 解释与 basename 解释同时成立、未被分离。要分离需要一个声明该路径的 ready/todo 任务（`gap-send-keys-verified-leaks-tmux-servers-unincorporated` 是 01:17 才立的，晚于 01:07 的读数）。`has()` 精确匹配对裸 basename 的行为需在该前提下再验证——**不作为 basename 假说的证明**。
- **manager 错因自述**：又读局部外推到全集，没跑选择器/没读机制。

**为什么重要**：红窗归因缺两个维度——①历史轮（verification-round.jsonl 无 failures 字段，只有最新一轮 state 文件可用）；②文件形状不一致（已确认观测到两种形态，效果待分离验证）。两者都补上，suite_blocking 才能把「阻塞 suite 的缺陷」排到 inner 面前。

### 选定机制方向（实现归内层，接法留执行时）

1. **round 记录加 failures 字段**：`SuiteRoundRecord` 加 `failures?: SuiteFailure[]`，`appendVerificationRound` 写入（与 state 文件的 failures 同源）。向后兼容（缺失时读者容忍）。
2. **computeSuiteBlocking 消费历史 failures**：读 verification-round.jsonl 的 per-round failures（现在能读到了）参与归因——不止最新一轮。
3. **文件形状归一**：failures[].file 统一为仓库相对路径（或 computeSuiteBlocking 对裸 basename 做解析/归一后再匹配）——裸 basename 与 Touches 相对路径一致化。

**验证锚**：修后 (a) verification-round.jsonl 红轮带 failures 字段；(b) 历史红轮参与归因；(c) 裸 basename 失败文件能命中 Touches（形状归一）。

**交叉标注（内层实现 2026-08-10，落地于 gap-suite-round-record-missing-failures-field）**：上述选定的机制方向已由实现任务落地——`SuiteRoundRecord` 加 `failures?: SuiteFailure[]` 且红轮写入（与 state 同源）；`computeSuiteBlocking` 经 `collectFailureFiles` 消费 per-round failures（历史轮可归因）+ `failureFileMatches` 做裸 basename ↔ 相对路径形状归一匹配。实测：round-210 裸 basename 与 round-212 相对路径都命中同一 Touches；`a/foo.ts` 失败不误配 `b/foo.ts`。本任务 AC2/AC3/AC4 的复现与实现证据见实现任务 Evidence 段。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录实证（209 轮 failures=0、SuiteRoundRecord 无 failures、done 任务正确排除、failures[].file 形状不一致：相对路径 vs 裸 basename）（本任务 Proposal 已含）
- [x] AC2: **round 记录加 failures**——SuiteRoundRecord 加 failures?: SuiteFailure[]，appendVerificationRound 写入（与 state 同源）
- [x] AC3: **归因消费历史 failures**——computeSuiteBlocking 读 per-round failures 参与归因（不止最新一轮）
- [x] AC4: **文件形状归一**——failures[].file 统一相对路径，或 computeSuiteBlocking 对裸 basename 解析后匹配（裸 basename 能命中 Touches）
- [x] AC5: **负控制**——无 failures 轮不参与归因
- [x] AC6: **向后兼容**——缺失 failures 的旧行读者容忍
- [x] AC7: **既有不回归**——`--for-task` scoped 门绿

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
changed: manager STOP-AND-RESCOPE——原前提错误（suite_blocking tasks=[] 是 done 任务正确排除,机制对的）。真实缺口：①verification-round.jsonl 209 轮含 failures=0（SuiteRoundRecord 无该字段）⇒ 红窗归因只有最新一轮;②failures[].file 形状不一致已确认（相对路径 vs 裸 basename 各观测一次）,效果未证实（上轮唯一声明该路径任务当时 done,两解释未分离）。范围重定:round 记录加 failures + 归因消费历史 + 形状归一（后者效果待分离验证）。实现归内层

## Evidence（inner 核实收尾 2026-08-10 —— 机制已由 gap-suite-round-record-missing-failures-field 落地，本任务验证归因缺口闭合）

**AC1 — 复现固化**：Proposal 已含（209 轮 failures=0 实测、SuiteRoundRecord 原无 failures、done 任务正确排除、failures[].file 形状不一致：相对路径 vs 裸 basename）。

**AC2 — round 记录加 failures**：`SuiteRoundRecord.failures?: SuiteFailure[]`（full-suite-runner.ts:513）+ `appendVerificationRound` 红轮写入（与 suite-state 同源，full-suite-runner.ts:1552）。实测：live `.quay/verification-round.jsonl` 含 failures 的轮数 = **32**（round 248/250 红轮带仓库相对路径失败文件）。测试：`full-suite-runner.test.mjs`「红轮带 failures / 绿轮省略」2 用例绿。

**AC3 — 归因消费历史 failures**：`computeSuiteBlocking` 经 `collectFailureFiles`（ready-pool-check.ts:614）读 per-round failures（不止最新一轮 state 文件）。fixture 实测：round-208/210/212 的失败明细跨 5 轮红窗（208-212）归因成功（见下 invoke）。

**AC4 — 文件形状归一**：`failureFileMatches`（ready-pool-check.ts:638）裸 basename ↔ 相对路径双向命中、两全路径同 basename 不同目录不误配。fixture 实测：round-210 裸 basename `send-keys-verified.sh` 与 round-208/212 相对路径 `plugin/scripts/send-keys-verified.sh` 命中同一 Touches。

**AC5 — 负控制**：无 failures 轮不参与归因——fixture round-209/211 无 failures，不贡献 failure_files、不误配，只保持红窗连续。

**AC6 — 向后兼容**：`collectFailureFiles` 以 `Array.isArray(r && r.failures)` 守卫，缺失 failures 的旧行读者容忍（fixture 209/211 无 failures 不炸）。

**AC7 — scoped 门绿**：`./scripts/test.sh --for-task gap-suite-blocking-red-window-unattributable` → EXIT=0，**132 pass / 0 fail / 0 cancelled**（含本归因链相关用例：consecutiveRedRounds/collectFailureFiles、computeSuiteBlocking 负控制、cross-round+形状归一、analyzeTasks suite-blocking）。

**Contract invoke（fixture 注入，历史轮 failures + 裸 basename）**：
```
node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root /tmp/gap-sbrw-fixture --json
suite_blocking: {
  "consecutive_red": 5,
  "min_red_window": 3,
  "window_active": true,
  "failure_files": ["plugin/scripts/send-keys-verified.sh", "send-keys-verified.sh"],
  "tasks": ["gap-script"]
}
```
（fixture：round-208 相对路径 + round-210 裸 basename + round-212 相对路径；gap-script Touches=`plugin/scripts/send-keys-verified.sh` 被归因；gap-other Touches=`unrelated.ts` 未误配。ready_relevance：gap-script `blocking=True blocking_suite=True value=5 reason=…suite-blocking Y…`，gap-other 不变。）

**Contract measure（live）**：`round_failures_field_present = 32`（band > 0 满足）——红轮已带 failures 字段。

**invariant**：historical_rounds_in_attribution = 1（fixture 跨 5 轮归因）；basename_shape_normalized = 1（round-210 裸 basename 命中）；backward_compatible = 1（209/211 无 failures 容忍）。
