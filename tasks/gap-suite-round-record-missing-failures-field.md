---
id: gap-suite-round-record-missing-failures-field
title: verification-round.jsonl 的 round 记录没有 failures 字段——209 轮全缺，red-window
  归因（gap-suite-blocking-red-window-unattributable）无法从 round 记录反查失败文件；补
  failures[] 进 SuiteRoundRecord/appendVerificationRound
status: done
labels:
  - gap
  - defect
extra:
  schema: v1
---
**type:** execution

## Proposal

**`.quay/verification-round.jsonl` 的每轮 round 记录没有 `failures` 字段——实测 209 轮全缺（keys = round/startedAt/durationMs/laneCount/pass/fail/cancelled/tests/per_test_ms/redAt/load/state/reason/runner/scope/commit），而 `full-suite-state.json` 的红轮带 `failures[]`（runner 的 SuiteFailure 形状）。red-window 归因（`gap-suite-blocking-red-window-unattributable`，round-210 红于 send-keys-verified.sh 但 tasks=[]）需要「失败文件 → 任务 Touches」的反查，round 记录却不可用。**

### 实证（outer 2026-08-10 RESCOPE 裁定 + inner 核实）

- **209 轮无 failures**：`.quay/verification-round.jsonl` 尾部记录 keys 实测不含 `failures`（含 `failures` 的只有 `full-suite-state.json` 的 SuiteState）。
- **归因无法反查**：`computeSuiteBlocking` 的 `has()` 精确匹配失败文件 → 任务 Touches；round 记录无失败文件 ⇒ 历史归因只能读 suite-state（单轮覆盖，多轮回溯不可用）。
- **与 crosscut 评估同源**（gap-crosscut-checks-zero-coverage-of-plugin-scripts RESCOPE）：original 前提（CROSSCUT plugin/scripts 触发器）作废，真实缺口 = round 记录缺 failures 字段。
- **形状不一致**（round-210 bare basename vs round-212 relative path）也因 round 记录无 failures 而无法跨轮核对。

**为什么重要**：red-window 归因是「红 → 派发效果」链的一环；round 记录作为唯一的多轮可查询序列（full-suite-state 是单轮覆盖），缺 failures 使「这个文件最近红过几次、由哪些任务可能引起」无法机械回答。

**修的方向（实现归内层）**：
- **候选 A**：`full-suite-runner.ts` 的 `appendVerificationRound` 在红轮时把 `failures[]`（SuiteFailure 数组）写入 round 记录；`SuiteRoundRecord` 类型加 `failures?`。
- **候选 B**：归因方（`suite-state-trigger.ts` / `ready-pool-check.ts` 的 suite_blocking）优先读 round 记录 failures，回退到 full-suite-state。

**验证锚**：修后 (a) 红轮的 verification-round.jsonl 记录含 `failures[]`（文件 + 行）；(b) 归因能跨轮反查失败文件；(c) 既有 round 记录字段不回归。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 209 轮 round 记录缺 failures 的实测（keys 清单 + round-210/212 归因案例）（本任务 Proposal 已含）
- [x] AC2: **round 记录带 failures**——`appendVerificationRound` 红轮写入 `failures[]`（SuiteFailure 形状），`SuiteRoundRecord` 加 `failures?`
- [x] AC3: **归因可反查**——红窗归因（computeSuiteBlocking / suite_blocking）优先读 round 记录 failures 反查失败文件→任务 Touches
- [x] AC4: **既有不回归**——`--for-task` scoped 门绿；round 记录既有字段不破坏
- [ ] AC5: **全量套件绿**——verification-round 写入路径在全量下正常（fail 0 且 cancelled 0）——外层 verification-round 验证

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [x] 修后实跑：红轮 round 记录带 failures[]；归因跨轮反查成功（贴任务体）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/full-suite-runner.ts（appendVerificationRound 红轮写 failures[] + SuiteRoundRecord 类型加 failures?）
- plugin/scripts/suite-state-trigger.ts（归因方：优先读 round 记录 failures，回退 full-suite-state）
- plugin/test/full-suite-runner.test.mjs（AC2/AC3 新增用例：红轮 round 记录含 failures；归因反查）
- plugin/test/suite-state-trigger.test.mjs（AC3 归因反查测试）
- tasks/gap-suite-blocking-red-window-unattributable.md（交叉标注——归因缺 failures 的下游消费者）
- tasks/gap-crosscut-checks-zero-coverage-of-plugin-scripts.md（交叉标注——RESCOPE 的真实缺口转交）
- tasks/gap-suite-round-record-missing-failures-field.md（自身：勾 AC + 贴证据）

## Contract

measure   round_record_has_failures = `python3 -c "import json;d=[json.loads(l) for l in open('.quay/verification-round.jsonl') if l.strip()];print(any('failures' in r and r.get('state')=='red' for r in d))"` 的 stdout
band      round_record_has_failures = True（至少一个红轮记录带 failures[]）
invariant red_round_failures_recorded = 1（红轮必带 failures[]，绿轮可无）
invariant attribution_cross_round = 1（归因能从 round 记录反查失败文件）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --root <repo>`（invoke-evidence：指向实际交付可执行——full-suite-runner.ts；Evidence 有红轮带 failures 注入实跑）
control   红轮带 failures；归因反查成功；既有字段不回归
resume    append 写 failures / 归因读取分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: RESCOPE gap-crosscut-checks-zero-coverage-of-plugin-scripts 时裁定：original 前提作废，真实缺口 = verification-round.jsonl 无 failures 字段（209 轮全缺），转交本任务。实现归内层

## Evidence（内层实现 2026-08-10）

**AC2 — 红轮 round 记录带 failures[]**（plugin/scripts/full-suite-runner.ts）
- `SuiteRoundRecord` 加 `failures?: SuiteFailure[]`（`appendVerificationRound` 调用处用同一数组 `finalFailures`——与 suite-state 写入同源；`state === "red"` 时写入，绿轮省略）。
- 实测注入（fake 红 suite `not ok 1 - boom` + `ℹ fail 1`）：`verification-round.jsonl` 末条 `rec.state === "red"` 且 `"failures" in rec`，`rec.failures.length === state.failures.length`，`rec.failures[0].line === state.failures[0].line`。
- 绿轮负控制：`rec.state === "green"` 且 `!("failures" in rec)`——既有字段不回归。
- 测试：`plugin/test/full-suite-runner.test.mjs` 新增 2 用例（红轮带 failures / 绿轮省略），67/67 绿。

**AC3 — 归因跨轮反查 + 文件形状归一**（plugin/scripts/ready-pool-check.ts）
- `collectFailureFiles` 已读 per-round `failures`（round 记录现在带 failures ⇒ 历史轮可归因）；新增 `failureFileMatches` 形状归一比较器（裸 basename ↔ 仓库相对路径双向命中；两个全路径同 basename 不同目录不误配）。
- 实测注入：round-210 裸 basename `send-keys-verified.sh` + round-212 相对路径 `plugin/scripts/send-keys-verified.sh` 都命中 `## Touches: plugin/scripts/send-keys-verified.sh`；`a/foo.ts` 失败不误配 `b/foo.ts`；失败明细只在旧轮（round-208）时仍跨红窗归因。
- 测试：`plugin/test/ready-pool-check.test.mjs` 新增 1 用例（cross-round + 形状归一），63/63 绿。

**AC4 — scoped 门绿**：`bash scripts/test.sh --for-task gap-suite-round-record-missing-failures-field --allow-thin` → exit 0，fail 0，cancelled 0（90 测试绿）。

**Contract measure 验证**（fixture 注入）：`.quay/verification-round.jsonl` 红轮带 failures ⇒ `round_record_has_failures = True`；`d[-1].get('failures','ABSENT')` 返回该轮 failures 数组。

**AC5（全量套件绿）留外层 verification-round 验证**——未勾。
