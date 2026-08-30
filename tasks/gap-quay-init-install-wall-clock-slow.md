---
id: gap-quay-init-install-wall-clock-slow
title: quay-init --loop 单次安装 32.8s 墙钟——逐文件 spawn 子进程（6265 fork / 2921 execve）是主因
status: todo
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

8 个 real-install/session-liveness 测试文件封顶 serial+lowconc 重叠窗口 226s（总套件 642s）。单次真 `quay-init --loop` 安装实测 **32.8s 墙钟**（user 6.7s + system 23.4s，~75 万 minor page faults）；strace：85% CPU 时间在 wait4、~6265 fork / ~2921 execve——**逐文件 spawn 子进程是主因**。`copy_one` 对每个文件 spawn `cp`（多分支各一次）；per-file `cmp` 已批处理成单次 python3 pass（先例 gap-suite-serial-install-copy-one-subprocess-batching）。旧注释「~6s in-suite」已过期。8 文件合计 ~40 个真安装、文件内 node:test 串行 → 单文件是 ~33s×N 延迟链。

## Plan

1. 先做安装子阶段 profile：把 23s system time 按 cp/git/python/node 归属，归属贴进任务体——**不预设数值阈值**（硬规则 4 推论：成本结构未知前不设阈值）。
2. 按 profile 归因优化（预期：copy_one 逐文件 spawn cp 批量化、或减 fork/execve 次数）。
3. 安装后字节一致性 + verify_referenced_landed / 升级路径 / residue 逻辑全不变；负控制 = 现有 quay-init 测试族仍绿。

## Acceptance Criteria

- [ ] AC1（能取假，profile）：安装子阶段 system time 按 cp/git/python/node 归属已贴进任务体；（⛔ 无归属贴入 ⇒ 假）。
- [ ] AC2（能取假，正确性不变）：优化后字节一致性 + verify_referenced_landed / 升级路径 / residue 逻辑不变，现有 quay-init 测试族全绿；（⛔ 任一变 ⇒ 假）。
- [ ] AC3（能取假，墙钟）：真实安装（⛔ 非 fixture 注入）墙钟前后对照下降。

## Definition of Done

安装子阶段 profile 归属贴入；优化落地；AC1-AC3 全勾；真实安装墙钟下降 + 套件绿。

## Touches

- plugin/scripts/quay-init.sh（copy_one 逐文件 spawn 批量化 / 减 fork-execve）
- tasks/gap-quay-init-install-wall-clock-slow.md（自身）
