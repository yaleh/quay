---
id: gap-manager-tick-readings-constant-zero-instruments
title: manager-tick-readings 两仪器恒值——node_count /node/ 对 MainThread 恒零 + ticklog 谓词不匹配行形恒读 no-tick-row
status: ready
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

**两个恒值仪器（manager 2026-08-13 A0 查出，都在 `plugin/scripts/manager-tick-readings.ts`）**：

**① `:183` node_count 恒零**：
```
代码：if (/node/.test(comm)) nodeCount++;
注释：与 `pgrep -c node` 同语义（node 进程 comm=node-MainThread）
真实 population：MainThread×78 / sleep×43 / bash×20，含 'node' 子串者 0；pgrep -c -f 'bin/node' = 25
```
两读法互校 ⇒ 报【仪器故障】不是「机器空闲」——与 `resource-gate.sh:172/186/228` +
`process-budget.sh:94` 同族（node-MainThread 任务已修那些），**这是新位置**。

**② `:261-264` outer.ticklog 恒报 no-tick-row**：
```
四谓词：DATED_RE(YYYY-MM-DD HH:MM) / UNDATED_QUOTE(> **HH:MM) / UNDATED_HEADER(# HH:MM) / UNDATED_TABLE(| N |)
quay 实际行形：` - \`04:09Z\` \`unblock\` — …`
干跑已知为真样本：文件 348 行、真 tick 行 291 行、四谓词命中 0，且 5 分钟前才更新
```
⇒ 恒真读数与「全停摆」同形，携带零信息——**我永远无法察觉你真的停写 tick 行**。

**⭐ 陷阱（硬规则② 按位置判定）**：`instrument-failure-check.ts --scan` 对 manager-tick-readings.ts
FAMILY-4 命中 :181 的【注释】（含 pgrep 字样），非 :183 的真代码（无 pgrep/grep 关键字，五族全不命中）。
**`git rm` 掉注释行 = 检测器「干净」而恒零代码原地不动**——删注释不能作为验收（判据见下）。

**⭐ --gate 扫描面缺口（比①②更值钱，manager 2026-08-13）**：`--gate` 模式（接进 run_static_checks）
只扫 `DEFAULT_SURFACE` 5 份驱动 markdown（orchestration/manager-loop-tick.md、
orchestrator-loop-tick.md、plugin/loop/{fast-mode,manager,orchestrator}-loop-tick.md），
**一个 .ts/.sh 都不在面上**——而仪器全部住在 `plugin/scripts/*.{ts,sh}` ⇒ **检测器从不看缺陷所在处**。
今晚两个恒值仪器是手工发现的，不是它发现的——它在 gate 里绿着，被保护对象带两个恒值读数跑了一整天。

**历史**：node_count 恒零自 08-07（49f8272b 引入 /node/ 谓词）。曾被用来【检测读法坏】（manager-tick-log
:3373/:5100/:5107：node_count=0 vs load1=9.40 vs pgrep=27 ⇒ 读法坏）——正向未误导，但仪器从未被修。

## Plan

1. 修 :183 读法：cmdline 枚举 + 双读互校，复用 `resource-gate.sh:213/262` 已修的 host-independent 形态
   （instrument-failure-check.ts:79-80 已把 pgrep -xc node-MainThread / pgrep -c node 纳入 family-4）。
2. 修 :261-264 ticklog 谓词匹配实际行形（`- \`HH:MMZ\` \`action\``）或改行形。
3. **--gate 扫描面纳入 plugin/scripts/ 仪器脚本** + 加「/proc/*/comm 语言内读法」位置级谓词
   （否则纳入也只会命中注释）。

## AC

- [ ] AC1: :183 node_count 读法修正（cmdline 枚举 + 双读互校）
- [ ] AC1b: **验收 = 本机真实进程表 node_count 与 `pgrep -cf 'bin/node'` 同量级（0 vs 25）**，
  非「检测器不再报」（删注释也能达成后者）
- [ ] AC2: :261-264 ticklog 谓词匹配实际行形（对当前真实文件能亮红）
- [ ] AC3: --gate 扫描面纳入 plugin/scripts/ 仪器 + /proc/*/comm 语言内读法谓词
- [ ] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 两仪器对当前真实文件/进程表能亮红的自检贴出
- [ ] 全量套件绿

## Touches

- plugin/scripts/manager-tick-readings.ts（:183 读法 / :261-264 谓词）
- plugin/scripts/instrument-failure-check.ts（--gate 扫描面 + 语言内读法谓词）
- tasks/gap-manager-tick-readings-constant-zero-instruments.md（自身）
