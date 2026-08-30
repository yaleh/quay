---
id: gap-quay-init-install-wall-clock-slow
title: quay-init --loop 单次安装 32.8s 墙钟——逐文件 spawn 子进程（6265 fork / 2921 execve）是主因
status: done
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

8 个 real-install/session-liveness 测试文件封顶 serial+lowconc 重叠窗口 226s（总套件 642s）。单次真 `quay-init --loop` 安装实测 **32.8s 墙钟**（user 6.7s + system 23.4s，~75 万 minor page faults）；strace：85% CPU 时间在 wait4、~6265 fork / ~2921 execve——**逐文件 spawn 子进程是主因**。`copy_one` 对每个文件 spawn `cp`（多分支各一次）；per-file `cmp` 已批处理成单次 python3 pass（先例 gap-suite-serial-install-copy-one-subprocess-batching）。旧注释「~6s in-suite」已过期。8 文件合计 ~40 个真安装、文件内 node:test 串行 → 单文件是 ~33s×N 延迟链。

## Profile（安装子阶段 system time 归属，AC1）

**方法**：真 `--loop` 安装（fresh `/tmp` target + disk worktree-root，`CLAUDE_PLUGIN_ROOT` = plugin 正本），`/usr/bin/time -v` + `strace -f -e trace=execve`。本机（16 核 dev box）实测基线 **11.11s 墙钟**（user 4.16s + system 11.50s，~79.3 万 minor faults）——与立案时 32.8s 同形（system ≫ user、wait4 主导），绝对值随机器/缓存而异。

**execve 归属（2921 次，逐程序）**：

| program | execve | 占比 |
|---|---|---|
| grep | 808 | 27.7% |
| sort | 561 | 19.2% |
| sed | 559 | 19.1% |
| basename | 288 | 9.9% |
| mkdir | 150 | 5.1% |
| dirname | 148 | 5.1% |
| cp | 146 | 5.0% |
| cmp | 127 | 4.3% |
| stat | 87 | 3.0% |
| head/find/rm/mktemp/cat | 33 | 1.1% |
| python3 | 6 | 0.2% |
| git | 3 | 0.1% |
| node | 1 | <0.1% |

**归因结论（⛔ 推翻了立案假设）**：`cp` 只有 **146 次 execve（5%）**，不是主因——per-file `cmp` 已被前序 gap 批处理（`_precompute_states`），`cp` 逐文件 spawn 只剩 ~146。**真正主因是 `derive_loop_scripts` 的 (d) dependency-closure 循环**：对每个 derived script 逐文件 spawn `grep -oE … | sed … | sort -u` + 逐 dep `grep -qxF`（grep+sort+sed 合计 **1928 次 execve = 66%**，×2 稳定性 pass 即 ~2000）。次因是 copy 循环的逐文件 `basename`/`dirname`（**436 次 = 15%**）。

**优化落点（按归因，非按假设）**：
1. (d) closure 整段改写为 **单次 python3 pass**（同一 regex/过滤/存在性/round<20/排序语义，逐一镜像原 loop）→ 消 ~574 grep + ~496 sort + ~496 sed。
2. copy 循环 `basename`/`dirname` → bash 参数展开 `${dst##*/}` / `${dst%/*}`（builtin，零 subprocess）→ 消 ~161 basename + ~145 dirname。

**前后对照（真安装，非 fixture）**：execve **2921 → 1047（−64%）**；墙钟 **11.11s → 4.90s（−56%）**；system **11.50s → 3.93s（−66%）**；user 4.16s → 1.87s。字节一致性：before/after 两棵 laid-down 树 `diff -r`（排除 config.yml / quay-init-state.json / session-liveness.env 三个内嵌目标路径的文件）**逐字节一致**。

## Plan

1. 先做安装子阶段 profile：把 23s system time 按 cp/git/python/node 归属，归属贴进任务体——**不预设数值阈值**（硬规则 4 推论：成本结构未知前不设阈值）。
2. 按 profile 归因优化（预期：copy_one 逐文件 spawn cp 批量化、或减 fork/execve 次数）。
3. 安装后字节一致性 + verify_referenced_landed / 升级路径 / residue 逻辑全不变；负控制 = 现有 quay-init 测试族仍绿。

## Acceptance Criteria

- [x] AC1（能取假，profile）：安装子阶段 system time 按 cp/git/python/node 归属已贴进任务体（## Profile 节：2921 execve 逐程序表 + 归因结论）；（⛔ 无归属贴入 ⇒ 假）。
- [x] AC2（能取假，正确性不变）：优化后字节一致性（before/after 两棵 laid-down 树 `diff -r` 逐字节一致，仅 config.yml/quay-init-state.json/session-liveness.env 内嵌目标路径）+ verify_referenced_landed / 升级路径 / residue 逻辑不变，现有 quay-init 测试族全绿（93 + install-config e2e 11 pass / 1 skip-go-absent）；（⛔ 任一变 ⇒ 假）。
- [x] AC3（能取假，墙钟）：真实安装（⛔ 非 fixture 注入）墙钟前后对照下降（11.11s → 4.90s，−56%；execve 2921 → 1047）。（⛔ fixture 注入 ⇒ 假）。

## Definition of Done

安装子阶段 profile 归属贴入；优化落地；AC1-AC3 全勾；真实安装墙钟下降 + 套件绿。

## Touches

- plugin/scripts/quay-init.sh（derive_loop_scripts (d) closure 逐脚本 grep/sed/sort → 单次 python3 pass；copy 循环 basename/dirname → 参数展开）
- tasks/gap-quay-init-install-wall-clock-slow.md（自身）
