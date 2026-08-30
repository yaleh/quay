---
id: gap-suite-metadata-query-subprocess-spawn
title: metadata 查询 30s 的逐文件子进程 spawn——group_of/realpath 合成单次 in-process
  pass，--list-files 30s→<3s
status: done
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`scripts/test.sh --list-files`（纯元数据查询）实测 **30.7s**（user 13.5s / sys 35.8s——sys 高 = 子进程 spawn 开销）。成因：metadata 路径对**每个测试文件** spawn 子进程——`build_deduped_files`（test.sh）逐文件 `realpath`（~550 spawn），`group_of`（runner-grouping.ts:32）逐文件 `grep -m1 | awk`（select_files/list_groups/check_group_declarations 各调一遍，再 ×550），外加 `check_group_declarations` 的 TS downgrade-check node 启动。合计每 metadata 查询 ~1100-1600 次子进程 spawn。这 30s 就是 runner-grouping-* serial 文件（list-groups 276s / anti-stomp 187s / flags-only 159s / governance 123s，6-9 次嵌套 spawn × 30s ≈ 745s lane-time/轮）的主导成本，也是所有 --list-files/--list-groups 消费者的固定开销。机制级修复：把 glob+realpath+group_of 合并成**单次 in-process Node pass**（glob 字面量保留在 test.sh——ADR-004 单一来源，被四个 checker 解析），预期 --list-files 30s → ~1-2s，runner-grouping serial 家族 745s lane-time 大幅下降。

## Plan

1. 单次 Node pass 替代逐文件子进程：一个 TS/mjs helper 接收 glob 模式数组，在进程内做 glob 展开 + `fs.realpathSync` 去重 + 读文件头做 `@test-group` 判定（替换 `group_of` 的 grep|awk）。
2. test.sh 的 `build_deduped_files` / metadata 路径改为调用该 helper；`local glob=(...)` 字面量行原样保留（四个 checker 解析正本不动）。
3. `check_group_declarations` 复用同一 in-process 判定（不再逐文件 grep）。
4. 负控制：metadata 输出与现行为逐字节一致（AC3 已 pin --list-files count + serial == --list-groups total）；四个解析 glob 的 checker 不回归。
5. 前后对照：`--list-files` 30s → 目标 <3s；runner-grouping serial 家族墙钟下降。

## Acceptance Criteria

- [x] AC1（能取假，读生产载体）：`--list-files` / `--list-groups` 输出与改前逐字节一致（553 文件 `realpath\tgroup` diff 为空，旧 build_deduped_files+group_of 逐文件重建比对）；墙钟 30.7s→~7.5s（warm，3–4×）。**<3s 立案预期未达成**——残余 ~7s 为 test-group-downgrade-check 的 96 次 git spawn（非本任务 Touches，另立 gap 追）。
- [x] AC2（能取假，负控制）：`--list-files count + serial == --list-groups total` 实测 537+17=554=total；`--list-groups` 各计数不回归（product 208 / engine 163 / governance 146 / serial 17 / lowconc 20）。
- [x] AC3（机制）：glob 字面量仍在 test.sh 且未被复制（`local glob=(...)` 行原样保留，四 checker 解析正本不动）；group_of 判定与现行为一致（553 文件逐字节 diff 为空；未知组 fail-closed exit 3、缺声明默认 engine、二进制→engine 均有自测 pin）。
- [x] AC4（测量）：serial 家族墙钟下降（每 metadata 查询 30.7s→~7.5s，list-groups/anti-stomp 按查询次数成比例下降）；0-cancelled 由 fan-in 全量 suite 验证。

## Definition of Done

metadata 查询（--list-files / --list-groups）从 ~30.7s 降到 ~7.5s（warm，3–4×）且输出逐字节不变；glob 单一来源未破坏；runner-grouping serial 家族 lane-time 按查询次数成比例下降；四 checker 解析不回归。<3s 残余为 test-group-downgrade-check 的 96 次 git spawn（非本任务机制，另立 gap）。

## Touches

- scripts/test.sh（build_deduped_files / metadata 路径改调 in-process helper；glob 字面量保留）
- plugin/scripts/runner-grouping.ts（group_of 改 in-process 判定）
- plugin/scripts/runner-grouping-metadata.mjs（新——glob+realpath+group_of 单 pass helper）
- plugin/scripts/capability-catalog.sh（注册新 helper 六表）
- plugin/test/runner-grouping-metadata.test.mjs（新 helper 自测——输出与旧 grep|awk group_of 逐字节一致 + 二进制/缺声明/未知组 fail-closed/realpath 去重）
- tasks/gap-suite-metadata-query-subprocess-spawn.md（自身）