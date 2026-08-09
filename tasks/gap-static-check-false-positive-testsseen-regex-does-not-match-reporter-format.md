---
id: gap-static-check-false-positive-testsseen-regex-does-not-match-reporter-format
title: "e1f34338 静态检查假红：testsSeen 的 `^# tests` regex 不匹配 reporter 的 `ℹ tests`——testsSeen 恒 0，守卫失效，测试 fixture 输出误命中"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**manager 逃生舱挑到 develop 的 e1f34338（static-check 诊断）有假红缺陷：runner 的 `testsSeen` 计数 regex 是 `^#\s*tests\s+(\d+)`（full-suite-runner.ts:1037），但本仓套件的 measure-suite-reporter 输出的是 `ℹ tests N`（info 字形，非 `#`）——`testsSeen` 从不递增、恒为 0。于是 `testsSeen === 0` 守卫（本意是把 static-check pattern 限制在测试前静态检查相位，line 1065/1071）彻底失效，`STATIC_CHECK_FAILURE_PATTERNS` 能在全运行期的任何匹配行上触发——包括测试文件跑自己 fixture 时打印的失败行。**

**实证（round-6，00:46:43 早期假红）**：
- runner 写 `state=red reason=static-check`，日志行：`STATIC-CHECK violation detected on stream -> state=red reason=static-check (run still in progress)` + `ANTI-DRIFT HARD FAIL: 1 violation(s)`。
- 该 `ANTI-DRIFT HARD FAIL` 行是 **candidate-contracts.test.mjs 的 fixture 输出**（该测试在跑 anti-drift-touches-check 的构造失败场景——`shared/s.js` / `pkg/OTHER/stray.js` / `nope.json` 全是测试 fixture），随后 `__PERFILE__ candidate-contracts.test.mjs passed=true`（line 301）——**测试通过**。
- **静态检查层全净**：`.quay/full-suite.log` 里 task-contract-check `violations: 0`、split-or-commit `PASS`、test-framework-policy `PASS`、instrument-failure `PASS`、ratchet `new since baseline: 0`。
- state 文件：`staticCheck={violations:0, details:[]}`、`failures=[]`——**假红，且说不出具体违规**（ANTI-DRIFT 格式不在 extractStaticCheckDetail 的解析 pattern 里）。
- **终态判据（full-suite-runner.ts:1191）**：`staticCheckDetected && testsSeen === 0 ? "static-check"`——因 testsSeen 恒 0，**即使测试全过，终态也是 `state=red reason=static-check`**（假红挡批量合）。

**为什么 testsSeen 不递增**：measure-suite-reporter 的汇总行是 `ℹ tests 212`（info 字形，round-4/5 日志实证），runner 的 `^#\s*tests` 只认 `#` 前缀。同一族：manager 曾 grep `^# tests|^# pass|^# fail` 报「日志没有 node:test 汇总块」，实际是 `ℹ` 前缀。

**后果**：诊断机制本身会制造假红——静态检查净 + 测试全过仍 `state=red reason=static-check`，stopSignal 挡派发、挡批量合。这是 e1f34338 的缺陷，不是被测代码的问题。

**修的方向（实现归内层）**：
- 候选 A：**testsSeen 认 reporter 格式**——regex 同时认 `# tests` 与 `ℹ tests`（及可能的 `# pass`/`ℹ pass`），测试相位开始后 testsSeen>0，守卫恢复生效。
- 候选 B：**static-check 相位收敛**——static-check pattern 只在测试相位开始前匹配（首个测试文件 `__PERFILE__` / 首个汇总出现即停），测试输出的 fixture 失败行不再误命中。
- 候选 C：**提取兜底**——假红时 `staticCheckDetails` 空 ⇒ 不应判 static-check 红（violations=0 不是「静态违规」，是「没解析出违规」——区分开）。

**验证锚**：修后，(a) 测试相位开始后 testsSeen>0（注入 `ℹ tests 5` 行可验证）；(b) candidate-contracts.test.mjs 的 `ANTI-DRIFT HARD FAIL` fixture 行不再触发 static-check 红；(c) 真实静态违规仍 reason=static-check + 计数；(d) 静态检查净 + 测试全过 ⇒ 终态 green。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 round-6 假红实证（ANTI-DRIFT fixture 行 + testsSeen 恒 0 + 静态层全净 + 终态判据）+ 根因（`^# tests` vs `ℹ tests`）（本任务 Proposal 已含；内层补构造复现：注入 `ℹ tests N` 汇总行 + ANTI-DRIFT fixture 行）
- [x] AC2: **testsSeen 认 reporter 格式**——`# tests` 与 `ℹ tests` 都递增 testsSeen（或等效机制），测试相位后 testsSeen>0
- [x] AC3: **测试输出不触发 static-check 假红**——candidate-contracts.test.mjs 的 ANTI-DRIFT fixture 行不再误命中（静态检查净 ⇒ 不红）
- [x] AC4: **假红不阻塞**——静态检查净 + 测试全过 ⇒ 终态 green（非 reason=static-check）；构造此场景 e2e 验证
- [x] AC5: **真实静态违规检测保留**——真实静态违规仍 reason=static-check + 计数 + violations 填 failures[]（e1f34338 语义不回归；`--static-check-check` 仍 PASS）

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：构造「静态净+测试过」场景终态 green；构造「真实静态违规」场景仍 static-check 红（贴任务体）
- [x] 既有 full-suite-runner 测试（含 e1f34338 新增 6 个）+ 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/full-suite-runner.ts（testsSeen regex / static-check 相位收敛 / 提取兜底）
- plugin/test/full-suite-runner.test.mjs（新增：ℹ 格式 testsSeen、fixture 行不触发、静态净+测试过⇒green）
- tasks/gap-static-check-false-positive-testsseen-regex-does-not-match-reporter-format.md（自身：勾 AC + 贴证据）

## Contract

measure   tests_seen_after_test_phase = 注入 `ℹ tests N` 汇总行后 runner 的 testsSeen（`--static-check-check` 或 scoped 测试断言）
band      tests_seen_after_test_phase = > 0（`ℹ tests` 也被认，守卫恢复）
invariant fixture_line_no_false_red = 1（ANTI-DRIFT fixture 行不触发 static-check 红，静态净 ⇒ 不红）
invariant real_static_violation_preserved = 1（真实静态违规仍 reason=static-check + 计数）
invoke    `node plugin/scripts/full-suite-runner.ts --static-check-check`（真实静态违规链仍 PASS）+ scoped 测试
control   `ℹ tests` 行 ⇒ testsSeen>0；fixture 失败行 ⇒ 不红；真实违规 ⇒ 红+计数
resume    regex 修正 + 相位收敛 + 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（manager 逃生舱挑 e1f34338 后 round-6 早期假红实证 + 根因定位：testsSeen `^# tests` 不匹配 reporter `ℹ tests` ⇒ 守卫失效 ⇒ ANTI-DRIFT fixture 行误命中；静态层全净仍假红；终态判据证实假红挡批量合。实现归内层）

## Evidence (inner 2026-08-09)

**核心修复已由 outer 以 commit `42aad5fe` 落盘**（本任务 fork 的 integration tip 已含）：
`full-suite-runner.ts` 新增专用 `testPhaseStarted` 相位门——在 (a) test.sh 的 `selected N files (groups=…)` 测试相位开始标记，或 (b) TAP/ℹ 测试计数汇总（`testsSeen > 0`）时置位；static-check 内联守卫 + 终态判据改用 `!testPhaseStarted`（替换失效的 `testsSeen === 0`）。`testsMatch` 正则改为 `/^[#ℹ]\s*tests\s+(\d+)/` 同时认 `# tests` 与 `ℹ tests`。

**内层补 AC2 复现测试**（`plugin/test/full-suite-runner.test.mjs`）：
新增「AC2 — both testsSeen summary forms」参数化测试——`# tests 5` 与 `ℹ tests 5` 各单独注入（无 `selected N files` 标记），后随 `ANTI-DRIFT HARD FAIL: 1 violation(s)` fixture 行 + `# pass 5`/`# fail 0` + exit 0 ⇒ 终态 green。证明 ℹ 字形单独即可递增 testsSeen>0 ⇒ 相位门武装 ⇒ fixture 行不再误命中（AC2 带宽 `tests_seen_after_test_phase > 0`）。

**验证锚（实跑）**：
- (a) 测试相位后 testsSeen>0：AC2 测试注入 `ℹ tests 5` ⇒ green（ℹ 字形被认，相位门恢复）
- (b) ANTI-DRIFT fixture 行不触发 static-check 红：AC2b（selected 标记）+ AC2（ℹ 汇总）两测试均 green
- (c) 真实静态违规仍 reason=static-check + 计数：既有 AC2/AC3/AC4 e2e + `--static-check-check`（`violations=11 ceiling=6 newSinceBaseline=6 failures=2 stopSignal=true`）
- (d) 静态检查净 + 测试全过 ⇒ 终态 green：AC2b/AC2 fake-suite 均 `exit 0` ⇒ state=green
- `node --experimental-strip-types --test plugin/test/full-suite-runner.test.mjs` ⇒ `ℹ tests 52 / ℹ pass 52 / ℹ fail 0`
- `node plugin/scripts/full-suite-runner.ts --static-check-check` ⇒ `static-check-check OK`（exit 0，Contract invoke 链 PASS）
- `bash scripts/test.sh --for-task ... --allow-thin` ⇒ 通过（见 scoped gate 结果）
