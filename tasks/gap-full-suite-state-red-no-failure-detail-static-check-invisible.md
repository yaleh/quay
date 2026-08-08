---
id: gap-full-suite-state-red-no-failure-detail-static-check-invisible
title: "full-suite-state.json 静态检查违规时 state=red / reason=failed / failures=[] 空——红窗成因不可读，消费方只能翻日志"
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

**全量套件因静态检查（task-contract-check ratchet）转红时，`.quay/full-suite-state.json` 的 `failures:[]` 是空的、`reason:"failed"`——任何只读状态文件的消费方（manager/外层/触发者）只能得到「红了、原因未知」，必须翻日志才知道是静态检查拦下。**

**实证（2026-08-08 20:48Z，外层 + manager）**：全量套件启动 10s 转红，`failures=[]` 空 + `durationMs=10070`。真因在 `/tmp/full-suite-run.log` 末尾：`violations: 11 unique across 9 task(s)`、`ratchet ceiling: 6; new since baseline: 6`——**静态检查层违规**，非测试失败。manager 靠翻日志才拿到这两行。

**后果（可读性缺口）**：
1. `state=red` + `reason="failed"` + `failures=[]` 空 + `durationMs=10s` 的组合，第一眼看像「运行被中断」而不是「静态检查拦下」——红窗分诊的第一步（判断 red 类型）需要翻日志。
2. 任何读 state 的消费方（inner 停止条件 / suite-state-trigger / 外层 tick）都拿不到违规明细。
3. **判据建议（manager）**：静态检查层的违反要进 state 文件的**机器可读字段**——如 `reason:"static-check"` + 违反计数 + ceiling，让红窗成因不需翻日志。

**修的方向（实现归内层，方向外层/manager 已定）**：
- 候选 A：**state 加 static-check 字段**——runner 在静态检查违规时写 `reason:"static-check"` + `violations`（计数）+ `ceiling`（ratchet ceiling）+ `newSinceBaseline`。
- 候选 B：**failures 填充静态违规**——把 task-contract-check 的违规明细（任务 id + 类型）填进 `failures[]`（当前只收测试失败）。
- 候选 C：**区分 reason**——`reason:"static-check"` 与 `reason:"failed"`（测试失败）分离，消费方（trigger/inner）能区分处理（static-check 红 = 修 contract，非回滚代码）。

**验证锚**：修后，套件因静态检查红时 `.quay/full-suite-state.json` 含机器可读的静态违规字段（reason 区分 + 计数），消费方不需翻日志即可定位成因。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 20:48 实证（failures=[] 空 + 真因在日志）——可读性缺口（本任务 Proposal 已含；见下方「实跑证据（2026-08-08 20:48Z）」）
- [x] AC2: **静态违规进 state**——runner 在静态检查违规时写机器可读字段（reason:"static-check" + 计数 + ceiling），实跑验证（`--static-check-check` 链 + e2e 断言，见 Evidence）
- [x] AC3: **reason 区分**——静态检查红与测试失败红 `reason` 分离，消费方（suite-state-trigger / inner）能区分（`SuiteStateReason` 增 `"static-check"`；routeRed/shouldStopDispatch/classifyFailure 已接线，见 Evidence）
- [x] AC4: **failures 填充（若选候选 B）**——静态违规明细（任务 + 类型）填进 failures[]（选定候选 B：`VIOLATION:` 明细以 `staticCheck:true` 条目进 failures[]，见 Evidence）
- [x] AC5: **不破坏测试失败路径**——真实测试失败仍写 failures[] + reason:"failed"（既有行为保留；`--fail-fast-check` 原样绿 + 「真实测试失败压过 static-check 标记」负控制，见 Evidence）

## Definition of Done

- [x] AC1–AC5 全部勾上（按选定候选：A + B + C 全做——机器可读字段、failures 填充、reason 区分）
- [x] 修后实跑：静态检查违规时 state 含机器可读字段（reason 区分 + 计数 + ceiling），贴任务体（见 Evidence）
- [x] 既有 full-suite-runner 测试 + 新增测试全绿（`--for-task` scoped，EXIT=0 / 64 pass / 0 fail / 0 cancelled）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 的批量合闸门，非任务级 scoped（`gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge` 已移除任务级那份；本任务只跑 `--for-task`）

## Touches

- plugin/scripts/full-suite-runner.ts（state 写入：静态违规字段）
- plugin/test/full-suite-runner.test.mjs（新增断言）
- plugin/scripts/suite-state-trigger.ts（若 reason 区分影响其判定）
- tasks/gap-full-suite-state-red-no-failure-detail-static-check-invisible.md（自身：勾 AC + 贴证据）

## 实跑证据（2026-08-08 20:48Z）

```json
{
  "state": "red",
  "reason": "failed",
  "runner": "outer",
  "startedAt": "2026-08-08T20:48:07.002Z",
  "durationMs": 10070,
  "failures": []
}
// 真因（/tmp/full-suite-run.log）：violations: 11 unique across 9 task(s)
//   ratchet ceiling: 6; new since baseline: 6  ← 静态检查 ratchet 违规，非测试失败
```

## Evidence（修后实跑 2026-08-08，内层任务实现）

**实现（选定候选 A+B+C 全做）**：
- `plugin/scripts/full-suite-runner.ts`：
  - `SuiteStateReason` 增第四值 `"static-check"`（AC3——与测试失败 `"failed"` 分离）。
  - 新增 `STATIC_CHECK_FAILURE_PATTERNS`（`new since baseline: K>0` / `over|exceed the ratchet ceiling` / `ceiling was RAISED` / `CEILING BREACH` / `FAIL: N violation(s)`——全为通过运行绝不出现的 exit-1 信号）+ `extractStaticCheckDetail`（解析 `VIOLATION:` / `violations: N unique across M task(s)` / `ratchet ceiling: C; new since baseline: K` 三行）。
  - onLine 对 static-check 失败行**提前写** `state=red reason=static-check`（AC2 早期红，与测试失败同性质），`testsSeen === 0` 守卫确保是测试前静态检查阶段。
  - 终局 reason 优先级：真实测试失败（failed）> 静态检查（static-check）> 中止（aborted）> fail-closed（failed）；AC5 保证真实测试失败**永不被** static-check 降级。
  - state 增 `staticCheck: {violations, taskCount, ceiling, newSinceBaseline, details}` 机器可读字段（AC2）+ `failures[]` 以 `{line, file, staticCheck:true}` 填违规明细（AC4 候选 B）。
- `plugin/scripts/suite-state-trigger.ts`：`classifyFailure` 对 `staticCheck:true` 条目直接分类为 `shared-gate`（静态检查红 ⇒ 停派发）；`routeRed`/`shouldStopDispatch` 对 `"static-check"` 走 `red-window-triage`（真失败结论，停派发——但 reason 让分诊能区分「修 contract」vs「回滚代码」）。
- `plugin/test/full-suite-runner.test.mjs`：新增 6 个测试（`isStaticCheckFailureLine` 单测、`extractStaticCheckDetail` 单测、static-check-red e2e、真实测试失败压过 static-check 标记的 AC5 负控制、routeRed/shouldStopDispatch 区分、`--static-check-check` Contract invoke）。

**修后实跑（`node plugin/scripts/full-suite-runner.ts --static-check-check`，复现 20:48 形状：VIOLATION×2 + violations:11 + ratchet ceiling:6; new since baseline:6 + exit 1）**：

```json
{
  "state": "red",
  "reason": "static-check",
  "failures": [
    { "line": "VIOLATION: tasks/gap-foo.md — V1: Contract block missing invariant line", "file": "tasks/gap-foo.md", "staticCheck": true },
    { "line": "VIOLATION: tasks/gap-bar.md — V2: band value out of range", "file": "tasks/gap-bar.md", "staticCheck": true }
  ],
  "staticCheck": {
    "violations": 11,
    "taskCount": 9,
    "ceiling": 6,
    "newSinceBaseline": 6,
    "details": [
      { "file": "tasks/gap-foo.md", "code": "V1", "what": "Contract block missing invariant line", "line": "VIOLATION: tasks/gap-foo.md — V1: Contract block missing invariant line" },
      { "file": "tasks/gap-bar.md", "code": "V2", "what": "band value out of range", "line": "VIOLATION: tasks/gap-bar.md — V2: band value out of range" }
    ]
  }
}
```

`static-check-check` 输出：`suite exit=1 state=red reason=static-check stopSignal=true violations=11 ceiling=6 newSinceBaseline=6 failures=2 suiteRedEvent=recorded events=1` → `static-check-check OK`。

**消费方可区分（AC3）**：`shouldStopDispatch({state:"red", reason:"static-check"})` = true（共享闸门失败停派发）、`routeRed` = `red-window-triage`、`classifyFailure(staticCheck:true 条目)` = `shared-gate`；`reason:"failed"`（测试失败）路径原样保留（AC5：`--fail-fast-check` OK + 「not ok 在 static-check 标记后出现 ⇒ reason 仍 failed」负控制）。

**Scoped 门（`--for-task gap-full-suite-state-red-no-failure-detail-static-check-invisible`）**：EXIT=0，`tests 64 / pass 64 / fail 0 / cancelled 0`，全绿（含既有 full-suite-runner 测试 + 新增 6 个 + suite-state-trigger 测试 + 既有 `--fail-fast-check`/`--wait-check` Contract invoke）。

**分支基线说明**：本任务 ## Touches 与 integration 未验证工作相交（full-suite-runner.ts），按指令从 `integration` 分叉（task/gap-full-suite-state-red-no-failure-detail-static-check-invisible），任务文件从 develop 复制入 worktree 以跑 scoped + 自编辑。只 commit，未 merge 未 push。

## Contract

measure   static_violation_in_state = 静态检查红时 `.quay/full-suite-state.json` 含 reason/计数/ceiling 字段
band      static_violation_in_state = 1（reason:"static-check" 或等效，计数非空）
invariant test_failure_path_preserved = 1（真实测试失败仍 failures[] + reason:"failed"）
invariant consumer_can_distinguish = 1（suite-state-trigger / inner 能区分 static-check vs 测试失败）
invoke    `node plugin/scripts/full-suite-runner.ts --static-check-check`（静态违规链，修后实跑贴回；`--fail-fast-check` 保留验证测试失败路径不变）
control   静态违规 ⇒ reason 区分 + 计数；测试失败 ⇒ failures[] 照旧
resume    字段写入 + 测试 + 文档分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-08
changed: 建任务（manager 指出可读性缺口 + 判据建议；方向已定候选 A/B/C，实现与测试归内层）
