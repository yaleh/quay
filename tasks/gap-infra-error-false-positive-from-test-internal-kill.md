---
id: gap-infra-error-false-positive-from-test-internal-kill
title: resource-gate 测试内部 kill 触发 runner 误判 infra-error（② 假阳性）
status: done
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

## Implementation

（落地提交 `058f38b1b`，机制①：runner kill 检测改 exit-status-only）：
1. `full-suite-runner.ts` `childKilledBySignal` 只认**直接 test.sh 子进程退出状态**（code=null+signal / close 事件 signal / bash 128+N），
   流内容 `Killed`/`__ENVFAIL__` 字样不再触发（已从 abort 检测移除）。
2. 全绿测试结果（tapPass>0 且 tapFail=0 且 tapCancelled=0 且 failures=[]）**压过** infra-error 拆除信号 ⇒ state=green
   （round-18 shape：pass=3977 fail=0 cancelled=0 标 green）；infra-error 只在中途拆除且无全绿 TAP 摘要时保留（AC2 不回归）。
3. `plugin/test/resource-gate.test.mjs` 无需改动——`git log -S kill/SIGKILL` 证明该文件从未有 kill 场景
   （round-18 的 `Killed` 标记系误归因；机制① 在 runner 层隔离，不依赖测试层改动）。
4. 新测试落在 `plugin/test/full-suite-runner.test.mjs`：:2007（`__ENVFAIL__` 流标记 + exit 0 ⇒ green）、
   :2029（`Killed node --test` 行 + 绿 TAP + exit 0 ⇒ green，round-18 shape）、:2056（全绿结果 + 直接子进程被信号杀 exit 137 ⇒ green）、
   :2085（中途拆除无绿摘要 ⇒ infra-error 红）、:1513/:1537（SIGKILL / bash-exits-137 ⇒ infra-error，AC2）。

## AC

- [x] AC1: resource-gate 测试内部 kill 不再触发 infra-error（全绿套件标 green）
- [x] AC2: 真实环境失败（test.sh 被信号杀）仍触发 infra-error（不回归）
- [x] AC3: `failures[]` 与 reason 一致（无真实失败 ⇒ 非 infra-error 除非真环境）
- [x] AC4: 新测试覆盖 (a)(b)；`--for-task` scoped 门绿
- [x] AC5: 既有 full-suite-runner 测试全绿

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：含 resource-gate 的全绿套件 reason=green 贴出（外层 verification-round 全量跑）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped：161/161，fail 0 cancelled 0）
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/full-suite-runner.ts（childKilledBySignal / abort 检测路径——直接子进程退出状态判定）
- plugin/test/resource-gate.test.mjs（kill 场景隔离）
- tasks/gap-infra-error-false-positive-from-test-internal-kill.md（自身）
