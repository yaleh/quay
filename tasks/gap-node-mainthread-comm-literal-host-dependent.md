---
id: gap-node-mainthread-comm-literal-host-dependent
title: node-MainThread comm 字面量在 boheidc 恒 0（真 comm=MainThread）——resource-gate/process-budget/orphan 静默失效，机械检查背书错误字面量
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（manager 2026-08-12，读数在前）**：本机（boheidc，Node v24.19.0）node 进程的 comm 是 `MainThread`，
不是 `node-MainThread`：
```
/proc/<pid>/comm = MainThread（5 样本全同）
ps -e -o comm= | grep -cx node-MainThread => 0
ps -e -o comm= | grep -cx MainThread      => 96
pgrep -xc node-MainThread => 0；pgrep -cf 'bin/node' => 26（真值同量级非零）
```

**命中面（按位置枚举）**：
- `resource-gate.sh:172` read_node_procs `pgrep -xc node-MainThread` ⇒ 恒 0（仅 printf 显示）
- `resource-gate.sh:186` read_orphans `pgrep -x node-MainThread` ⇒ 枚举源恒空 ⇒ AC10 孤儿检测【永不报】
- `resource-gate.sh:228` worktree-scoped `pgrep -x node-MainThread` ⇒ 恒 0 ⇒ 「worktree 负载可延后 vs 主仓套件」区分【恒不成立】
- `process-budget.sh:94` `awk $2=="node-MainThread"` ⇒ 恒空 ⇒ budget_in_use 恒 0、budget_available 恒=nproc ⇒ 跨层进程预算【从不节流】

**历史证据（它自己打印的）**：仓库根 `./undefined`（17:15:39Z，300KB，一次 test.sh 输出）里逐字写着
`nproc=16  node_procs=0` 与 `total_budget=16 budget_in_use=0 budget_available=16`——那一刻正有整套件在跑。

**机械检查在背书错误字面量**：`instrument-failure-check.ts` + `instrument-failure-check.test.mjs:68/96/97/168`
把 `pgrep -xc node-MainThread` / `grep -cx node-MainThread` 断言为「正确形式」（`famsOn(...) == []`），
`resource-gate.test.mjs:202-207` 钉死该字面量 ⇒ **在 boheidc 上检查通过恰恰证明用的是恒 0 读法**。
硬规则 4 推论二家族：宿主/运行时版本依赖事实写成普适字面量（`resource-gate.sh:41` 注释「stepped on both twice」
是 vhs 上量的；`resource-gate.test.mjs:377`「17 node-MainThread」是 2026-08-08 vhs 实测）。换机/换 Node 静默失效。

**范围事实（非归因）**：今天调 serial/lowconc 时预算层从未兜底——并发调参的实际约束只有显式设的数，没有预算层兜底。

## Plan

1. **候选 pid 列表来源不写死 comm 字面量**：cmdline 取候选 → 既有 `is_test_cmdline` 分类（process-budget.sh 已有该层）；
   或运行时解析一次真实 comm 并**自检「命中数 > 0 否则报仪器故障」**（把「仪器坏了」变成可报）。
2. **AC4 禁 `pgrep -f` 的理由保留**（会把 MCP 等非测试 node 算成测试 worker）——不能简单改 `-f`。
3. 机械检查（instrument-failure-check / resource-gate.test）同步修正——不背书恒 0 字面量。

## AC

- [ ] AC1: 候选 pid 获取不依赖 comm 字面量（cmdline 取候选走 is_test_cmdline，或运行时解析真 comm + 自检命中>0 否则报仪器故障）
- [ ] AC2: resource-gate node_procs / orphan / worktree-scoped 三个读数非恒 0（真套件跑时有值）
- [ ] AC3: process-budget budget_in_use 非恒 0（真测试进程跑时有值）
- [ ] AC4: 机械检查修正（不背书 node-MainThread 字面量）；负控：旧字面量被报仪器故障
- [ ] AC5: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 读数样例贴出（见 Evidence：真套件跑时 node_procs/budget_in_use 非零）
- [ ] 全量套件绿

## Touches

- plugin/scripts/resource-gate.sh（node_procs / read_orphans / worktree-scoped）
- plugin/scripts/process-budget.sh（list_node_mainthread_pids）
- plugin/test/resource-gate.test.mjs（字面量断言修正）
- plugin/scripts/instrument-failure-check.ts（「正确形式」断言修正）
- tasks/gap-node-mainthread-comm-literal-host-dependent.md（自身）
