---
id: gap-infra-error-false-positive-from-test-internal-kill
title: resource-gate 测试内部 kill 触发 runner 误判 infra-error（② 假阳性）
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实证（outer 2026-08-12，round 18）**：round 18 `tests=3977 pass=3977 fail=0 cancelled=0`——**全部测试通过**，但 runner 标 `reason=infra-error`。日志：`suite log shows 1 SIGKILL/Killed marker(s) — process torn down mid-run`。来源是 `plugin/test/resource-gate.test.mjs`（8.8s，passed=true）**故意杀一个子进程来测资源闸**——它的 stderr 出现 `Killed`，runner 的 kill/abort 检测（`childKilledBySignal`）把它当**真实环境失败** ⇒ reason=infra-error。

**影响**：resource-gate 测试每轮都跑 ⇒ 每次套件都被标 infra-error ⇒ `full-suite-state.json` 恒非 green ⇒ batch-merge freshness 门被挡（develop 不前进），即使 tests 全绿。② 的本意是「环境失败不冒充产品红」，但它把**测试内部的 kill 场景**误判成环境失败。

**选定机制**：runner 的 kill 检测应基于**直接子进程（test.sh）的退出状态**（test.sh 是否被信号杀死），而不是流内容里的 `Killed` 字样——测试内部的子进程 kill 会输出 `Killed`，不应触发。或把 `resource-gate.test.mjs` 的 kill 场景隔离（不让 `Killed` 进 runner 的检测流）。

**验证锚**：(a) round 全绿但含 resource-gate 测试 ⇒ reason 非 infra-error（green）；(b) 真环境失败（test.sh 被杀）⇒ 仍 infra-error；(c) `--for-task` scoped 门绿。

## Plan

1. 读 `full-suite-runner.ts` 的 `childKilledBySignal` / abort 检测路径（kill 判定基于什么）。
2. 判定：改为基于 test.sh 退出状态（子进程 signal），排除流内容里的 `Killed` 字样（测试内部 kill）。
3. 修 + 单测（构造 resource-gate 测试 kill 场景 ⇒ 不触发；真 test.sh 被杀 ⇒ 触发）。
4. 回归：full-suite-runner 测试 + `--for-task` scoped + 一轮确认。

## AC

- [ ] AC1: resource-gate 测试内部 kill 不再触发 infra-error（全绿套件标 green）
- [ ] AC2: 真实环境失败（test.sh 被信号杀）仍触发 infra-error（不回归）
- [ ] AC3: `failures[]` 与 reason 一致（无真实失败 ⇒ 非 infra-error 除非真环境）
- [ ] AC4: 新测试覆盖 (a)(b)；`--for-task` scoped 门绿
- [ ] AC5: 既有 full-suite-runner 测试全绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：含 resource-gate 的全绿套件 reason=green 贴出
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证
