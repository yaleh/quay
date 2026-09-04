---
id: gap-full-suite-runner-marks-test-sh-gate-wait-as-failed
title: "full-suite-runner marks scripts/test.sh's INTERNAL resource-gate WAIT as
  reason=failed (false RED / spurious stop-dispatch) instead of aborted:
  measured 17:46Z — runner's own gate said GO at start, test.sh's internal gate
  check seconds later saw PSI some avg10=45.15 (>40 limit) → test.sh fail-closed
  exit 1 (NEVER ran tests) → runner reason=failed; the reason axis
  (failed|aborted, runner line 34/74) exists but does NOT detect test.sh's
  'resource gate says WAIT — not running' marker in the output; fix: detect the
  marker → reason=aborted (no correctness conclusion), so a run that produced
  ZERO tests never sets the stop-dispatch signal"
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**full-suite-runner 把 test.sh 内部资源闸 WAIT 标成 reason=failed（假红/假 stop-dispatch）而非 aborted。**

**【实测（2026-08-05 17:46Z，红窗分诊产出）】**：
1. 外层起 full-suite-runner（state=running, laneCount=1）；runner 自己的闸检查 **GO**（17:46:26）；
2. runner 调 `scripts/test.sh`（canonical 全量），test.sh **内部**再查一次闸（几秒后）——PSI some
   **avg10=45.15**（>40 上限）→ test.sh fail-closed exit 1，**一行测试都没跑**；
3. runner 把 test.sh 的 exit 1 判为 `reason=failed` + state=red → **SUITE-RED + stop-dispatch 信号**。

**【判定】**：**假红**——该运行产生 ZERO 测试、ZERO 正确性结论，按 reason 轴语义（runner line 34：
`aborted = the run produced NO correctness conclusion`）应为 **reason=aborted**，不设 stop-dispatch。

**【根因】**：runner 有 reason 轴（failed|aborted，line 34/74），但**不检测 test.sh 输出里的
`resource gate says WAIT — not running` 标记**——把 gate-WAIT 的 exit 1 当真失败。

**【为什么重要】**：假 stop-dispatch 让 inner 停派发 + 暂缓 fan-in（红窗规则），代价是「一次资源抖动停掉
整个推进」。且这是 ABORT #4/#5 原因轴教训（aborted ≠ failed）的**再现**——runner 自己那侧修了，但
test.sh 内部的 gate-WAIT 路径没接入原因轴。

**【fix 方向】**：
1. runner 检测 test.sh 输出中的 `resource gate says WAIT` / `not running the full suite` 标记 →
   reason=aborted（不设 stop-dispatch）；
2. 或 test.sh 对 gate-WAIT 用**专门的退出码**（区别于真测试失败），runner 按码分类；
3. 真失败（有测试跑、有 not ok/✖）仍 reason=failed（不回归）。

### 选定机制

1. runner 解析 test.sh 输出：检测 gate-WAIT 标记 → reason=aborted
2. gate-WAIT 的 aborted 不设 stop-dispatch（state 可标 green-with-note 或 aborted，inner 不停止）
3. 负控制：真测试失败仍 reason=failed + stop-dispatch

## Acceptance Criteria

- [x] AC1: test.sh 内部闸 WAIT（无测试运行）⇒ reason=aborted，**不设 stop-dispatch**（实测，同 17:46 场景）
- [x] AC2: 真测试失败（有 not ok/✖）⇒ 仍 reason=failed + stop-dispatch（不回归）
- [x] AC3: gate-WAIT 的 aborted 有 note/可读标记（外层分诊可辨「没跑」vs「跑了失败」）
- [x] AC4: 与 gap-full-suite-runner-concurrency-default-and-gate（done）交叉标注——原因轴在该任务范围外的
      残余缺口

## Evidence (2026-08-06, task execution)

**先行落地说明（honest）**：WAIT 标记检测的**机制本体**由原因轴任务
`gap-suite-state-has-no-reason-axis-failed-aborted-infra`（commit 561388d9）先行落地——`ABORT_PATTERNS`
（`/resource gate says WAIT/` + `/not running the full suite/`）、`isAbortLine()`、流上 ABORT 标记 →
早期 `state=red reason=aborted`、终态 `noCorrectnessConclusion → aborted`、`suite-state-trigger.ts`
的 `routeRed()`（aborted → resource-gate，不设 stop-dispatch）都在该任务内实现。本任务核查该机制并补齐
其 ABORT 侧可运行 CLI 控制（`--wait-check`，FAILED 侧 `--fail-fast-check` 的孪生）。

- **AC1（gate-WAIT ⇒ aborted + 不设 stop-dispatch）**：
  - `plugin/test/full-suite-runner.test.mjs` `"AC1/AC3 — an early-EXIT red (test.sh internal resource-gate WAIT fail-closed) is reason=aborted, NOT failed"` —— 构造 17:46 同形 fake suite（`resource gate says WAIT — not running the full suite ...` + exit 1）⇒ 断言 `s.reason === "aborted"` 且 `runOnce(root).stopSignal === false`。
  - 新增 Contract invoke 控制：`node --experimental-strip-types plugin/scripts/full-suite-runner.ts --wait-check` ⇒ 输出 `wait-check OK: runner wrote state=red reason=aborted → trigger recorded SUITE-RED → stopSignal absent (no stop-dispatch)`（退出 0）。真实 test.sh 标记文本（`scripts/test.sh:406`，2026-08-07 重验时实测行号）与 `ABORT_PATTERNS` 逐字匹配。
- **AC2（真失败不回归 reason=failed + stop-dispatch）**：
  - `full-suite-runner.test.mjs` `"AC5 — a REAL failure after an abort marker is NOT downgraded"`（`resource gate says WAIT` 后 `not ok 1 - boom` ⇒ reason 仍 failed）；`"AC5 — a generic non-zero exit with NO failure/abort marker stays reason=failed"`（fail-closed catch-all）。
  - `--fail-fast-check`（已有）证明 failure suite ⇒ state=red reason=failed ⇒ stopSignal=true（`suite-state-trigger.test.mjs` Contract invoke 测试）。`--wait-check` 与 `--fail-fast-check` 在 stopSignal 上相反，证明两路正确分叉。
- **AC3（可读标记）**：结构化 `reason: "aborted"` 字段即可读标记——外层分诊读 `state` + `reason` 即可辨「没跑（aborted）vs 跑了失败（failed）」；`.quay/full-suite.log` 保留真实 WAIT 标记行；runner stderr 打 `ABORT marker detected ... reason=aborted`。不新增 ad-hoc `note` 字段（`orchestration/SPEC-state-crystallization-2026-08-05.md` §5.3 明令禁止手写逃生舱——schema 不够就补 schema，`reason` 就是那次 schema 扩展）。
- **AC4（交叉标注）**：原因轴三值枚举（failed|aborted|infra-error）的 schema + 路由是
  `gap-full-suite-runner-concurrency-default-and-gate`（done）**范围之外**的残余缺口，由
  `gap-suite-state-has-no-reason-axis-failed-aborted-infra` 落地（本任务核查并补 CLI 控制）。交叉标注见
  `full-suite-runner.ts:97-98`（reason 轴注释同时引用两个任务 id）与 `suite-state-trigger.ts:82-83`（2026-08-07 重验时实测行号）。

**Scoped test run**：`bash scripts/test.sh --for-task gap-full-suite-runner-marks-test-sh-gate-wait-as-failed`
⇒ 24 pass / 0 fail；scoped static checks（test-framework-policy-check、adr016-screen-use-check 等）PASS。

**Re-verify 2026-08-07（本 dispatch）**：fresh `--wait-check` ⇒ `state=red reason=aborted stopSignal=false`（exit 0）；fresh
`--fail-fast-check` ⇒ `state=red reason=failed stopSignal=true failures=1`（exit 0）；`bash scripts/test.sh plugin/test/full-suite-runner.test.mjs`
⇒ 24 pass / 0 fail；`--for-task ... --allow-thin` scoped static tier（含 task-contract-check strict-subset on this task）EXIT=0。
`scripts/test.sh` 相对 develop 零 diff（未改）。机制本体 + `--wait-check` 已由 commit `ac2506b6`（本任务）+ `f460d07b`（merge）落地。

## Touches

- tasks/gap-full-suite-runner-marks-test-sh-gate-wait-as-failed.md
- plugin/scripts/full-suite-runner.ts（WAIT 标记检测 + reason 分类；本任务补 `--wait-check` CLI 控制）
- plugin/scripts/test.sh（未改——gate-WAIT 仍 exit 1，靠 runner 的标记检测分类为 aborted，非专门退出码）
- plugin/test/full-suite-runner.test.mjs（WAIT-aborted 负控制 + `--wait-check` Contract invoke 测试）

## Contract

measure   wait_reason = `node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --wait-check`（构造 gate-WAIT 场景，ABORT 链端到端）后断言输出 `reason=aborted` + `stopSignal absent`；等价于 `cat .quay/full-suite-state.json | grep -c '"reason":"aborted"'`（≥1）
band      wait_reason >= 1（gate-WAIT ⇒ aborted 非 failed）
invoke    `grep -n 'resource gate says WAIT\|reason.*aborted\|FAILURE_PATTERNS' plugin/scripts/full-suite-runner.ts`
control   真失败场景 reason=failed（AC2 不回归，`--fail-fast-check`）
resume    标记检测与退出码分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T17:4xZ
changed: 红窗分诊产出——17:46Z 起全量 3 秒即红，日志证实 test.sh 内部闸 WAIT（avg10=45.15）fail-closed
未跑任何测试，runner 标 failed（假红）。外层已重置 state=green(reason=aborted) 撤回 stop-dispatch。
立案：runner 原因轴对 test.sh 内部 gate-WAIT 路径缺失。
