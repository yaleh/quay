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

- [ ] AC1: **复现固化**——任务体记录 20:48 实证（failures=[] 空 + 真因在日志）——可读性缺口（本任务 Proposal 已含）
- [ ] AC2: **静态违规进 state**——runner 在静态检查违规时写机器可读字段（reason:"static-check" + 计数 + ceiling），实跑验证
- [ ] AC3: **reason 区分**——静态检查红与测试失败红 `reason` 分离，消费方（suite-state-trigger / inner）能区分
- [ ] AC4: **failures 填充（若选候选 B）**——静态违规明细（任务 + 类型）填进 failures[]
- [ ] AC5: **不破坏测试失败路径**——真实测试失败仍写 failures[] + reason:"failed"（既有行为保留）

## Definition of Done

- [ ] AC1–AC5 全部勾上（按选定候选）
- [ ] 修后实跑：静态检查违规时 state 含机器可读字段（reason 区分 + 计数 + ceiling），贴任务体
- [ ] 既有 full-suite-runner 测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

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

## Contract

measure   static_violation_in_state = 静态检查红时 `.quay/full-suite-state.json` 含 reason/计数/ceiling 字段
band      static_violation_in_state = 1（reason:"static-check" 或等效，计数非空）
invariant test_failure_path_preserved = 1（真实测试失败仍 failures[] + reason:"failed"）
invariant consumer_can_distinguish = 1（suite-state-trigger / inner 能区分 static-check vs 测试失败）
invoke    `bash plugin/scripts/full-suite-runner.ts --fail-fast-check`（或对静态违规场景实跑贴回）
control   静态违规 ⇒ reason 区分 + 计数；测试失败 ⇒ failures[] 照旧
resume    字段写入 + 测试 + 文档分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-08
changed: 建任务（manager 指出可读性缺口 + 判据建议；方向已定候选 A/B/C，实现与测试归内层）
